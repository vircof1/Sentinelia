import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import { obtenerDefinicionesConfiguracionPortal }
  from '../paquetes/configuracion/src/obtenerDefinicionesConfiguracionPortal.js';
import { RepositorioConfiguracion }
  from '../paquetes/configuracion/src/RepositorioConfiguracion.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones } from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

const CLAVES_ADMISION = [
  'correo.activo',
  'correo.desuscripcion_ttl_dias',
  'correo.max_reintentos',
  'correo.reintento_base_segundos',
  'correo.remitente_email',
  'correo.remitente_nombre',
  'correo.smtp_auth_method',
  'correo.smtp_host',
  'correo.smtp_password',
  'correo.smtp_puerto',
  'correo.smtp_secure',
  'correo.smtp_timeout_conexion_ms',
  'correo.smtp_timeout_saludo_ms',
  'correo.smtp_timeout_socket_ms',
  'correo.smtp_tls_permitir_inseguro',
  'correo.smtp_usuario',
  'portal.nombre_visible',
  'portal.origen_publico'
].sort();
const CLAVES_REVERIFICACION = [
  'correo.activo',
  'correo.remitente_email',
  'correo.remitente_nombre',
  'correo.smtp_auth_method',
  'correo.smtp_host',
  'correo.smtp_password',
  'correo.smtp_puerto',
  'correo.smtp_secure',
  'correo.smtp_timeout_conexion_ms',
  'correo.smtp_timeout_saludo_ms',
  'correo.smtp_timeout_socket_ms',
  'correo.smtp_tls_permitir_inseguro',
  'correo.smtp_usuario'
].sort();

await main();

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true, '5.27.1b necesita MariaDB real.');
  const definiciones = verificarDefiniciones(configuracion);

  const administrador = new ClienteSql(configuracion.sql);
  const nombre = `sentinelia_fixture_5271b_${randomBytes(5).toString('hex')}`;
  let sql;
  try {
    await administrador.ejecutar(
      `CREATE DATABASE ${administrador.escaparIdentificador(nombre)} ` +
        'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
    );
    sql = new ClienteSql({ ...configuracion.sql, baseDatos: nombre });
    const ejecutor = crearEjecutor(sql);
    await ejecutor.ejecutarPendientes();
    await sincronizarDefiniciones(sql, definiciones);
    await sembrarConfiguracion(sql);
    await verificarPersistencia(sql);
    await ejecutor.ejecutarPendientes();

    console.log(
      '[correo-trigger] OK 5.27.1b: esquema_inicial origen=explicito ' +
        'smtp_nuevo=denegado guards=inactivos metadatos=coherentes'
    );
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(nombre)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

function verificarDefiniciones(configuracion) {
  const definiciones = obtenerDefinicionesConfiguracionPortal(configuracion);
  const porClave = new Map(definiciones.map((entrada) => [entrada.clave, entrada]));
  assert.equal(porClave.get('portal.origen_publico').editable, false);
  assert.equal(porClave.get('portal.origen_publico').visibleEnListado, false);
  assert.deepEqual(
    definiciones.filter((entrada) => entrada.participaAdmisionCorreo)
      .map((entrada) => entrada.clave).sort(),
    CLAVES_ADMISION
  );
  assert.deepEqual(
    definiciones.filter((entrada) => entrada.invalidaPruebaSmtp)
      .map((entrada) => entrada.clave).sort(),
    CLAVES_REVERIFICACION
  );
  assert.deepEqual(
    ['correo.desuscripcion_ttl_dias', 'correo.destinatarios_trigger_maximos',
      'correo.retencion_salidas_dias'].map((clave) => ({
      clave,
      valor: porClave.get(clave).valorPorDefecto,
      minimo: porClave.get(clave).minimo,
      maximo: porClave.get(clave).maximo
    })),
    [
      { clave: 'correo.desuscripcion_ttl_dias', valor: 30, minimo: 1, maximo: 3650 },
      { clave: 'correo.destinatarios_trigger_maximos', valor: 100, minimo: 1, maximo: 1000 },
      { clave: 'correo.retencion_salidas_dias', valor: 90, minimo: 1, maximo: 3650 }
    ]
  );
  return definiciones;
}

function crearEjecutor(sql) {
  return new EjecutorMigraciones({
    clienteSql: sql,
    repositorioMigraciones: new RepositorioMigraciones(sql),
    rutaMigraciones: obtenerRutaMigraciones()
  });
}

async function sembrarConfiguracion(sql) {
  await sql.ejecutar("UPDATE configuracion_portal SET valor='https://portal.example' WHERE clave='portal.origen_publico'");
  await sql.ejecutar(
    `INSERT INTO configuracion_portal (
       clave, valor, tipo_dato, descripcion, creado_automaticamente
     ) VALUES
       ('federacion.origen_publico','https://legado.example','url','fixture',1),
       ('correo.operativo_verificado','true','booleano','fixture',1),
       ('correo.smtp_host','smtp.legado.example','host','fixture',1),
       ('correo.max_reintentos','3','entero','fixture',1),
       ('correo.runtime_lote_maximo','3','entero','fixture',1)
     ON DUPLICATE KEY UPDATE valor=VALUES(valor)`
  );
}

async function sincronizarDefiniciones(sql, definiciones) {
  const conexion = await sql.obtenerConexion();
  try {
    await conexion.beginTransaction();
    await new RepositorioConfiguracion(sql).sincronizarDefinicionesEnTransaccion(
      definiciones,
      { conexion }
    );
    await conexion.commit();
  } catch (error) {
    await conexion.rollback();
    throw error;
  } finally {
    conexion.release();
  }
}

async function verificarPersistencia(sql) {
  const filas = await sql.consultar(
    `SELECT clave, valor, participa_admision_correo, invalida_prueba_smtp
       FROM configuracion_portal
      WHERE clave IN (
        'portal.origen_publico', 'federacion.origen_publico',
        'correo.operativo_verificado', 'correo.smtp_host',
        'correo.max_reintentos', 'correo.runtime_lote_maximo',
        'correo.desuscripcion_ttl_dias',
        'correo.destinatarios_trigger_maximos',
        'correo.retencion_salidas_dias'
      )`
  );
  const porClave = new Map(filas.map((fila) => [fila.clave, fila]));
  assert.equal(porClave.get('portal.origen_publico').valor, 'https://portal.example');
  assert.equal(porClave.get('federacion.origen_publico').valor, 'https://legado.example');
  assert.equal(porClave.get('correo.operativo_verificado').valor, 'true');
  assert.deepEqual(
    [porClave.get('correo.desuscripcion_ttl_dias').valor,
      porClave.get('correo.destinatarios_trigger_maximos').valor,
      porClave.get('correo.retencion_salidas_dias').valor],
    ['30', '100', '90']
  );
  assert.deepEqual(metadatos(porClave, 'correo.smtp_host'), [1, 1]);
  assert.deepEqual(metadatos(porClave, 'correo.max_reintentos'), [1, 0]);
  assert.deepEqual(metadatos(porClave, 'correo.runtime_lote_maximo'), [0, 0]);
  assert.deepEqual(metadatos(porClave, 'correo.operativo_verificado'), [0, 0]);
  const admisionPersistida = await sql.consultar(
    `SELECT clave FROM configuracion_portal
      WHERE participa_admision_correo = 1 ORDER BY clave ASC`
  );
  const reverificacionPersistida = await sql.consultar(
    `SELECT clave FROM configuracion_portal
      WHERE invalida_prueba_smtp = 1 ORDER BY clave ASC`
  );
  assert.deepEqual(admisionPersistida.map((fila) => fila.clave), CLAVES_ADMISION);
  assert.deepEqual(
    reverificacionPersistida.map((fila) => fila.clave),
    CLAVES_REVERIFICACION
  );

  const [verificacion] = await sql.consultar('SELECT * FROM estado_verificacion_correo');
  assert.equal(Number(verificacion.id), 1);
  assert.equal(Number(verificacion.verificado), 0);
  assert.equal(verificacion.perfil_version, null);
  assert.equal(verificacion.huella_hmac, null);

  const [despliegue] = await sql.consultar(
    'SELECT * FROM estado_despliegue_trigger_correo'
  );
  assert.equal(despliegue.estado, 'preparacion');
  for (const clave of [
    'guard_metadatos_activo', 'origen_portal_autoritativo',
    'verificacion_smtp_autoritativa', 'guard_verificacion_legacy_activo',
    'guard_revision_trigger_activo', 'cola_sql_autoritativa',
    'tipo_correo_habilitado'
  ]) assert.equal(Number(despliegue[clave]), 0, clave);

  await assert.rejects(
    sql.ejecutar('UPDATE estado_verificacion_correo SET verificado=1 WHERE id=1'),
    /constraint|CONSTRAINT|verificacion_correo_prueba/u
  );
  await assert.rejects(
    sql.ejecutar(
      "UPDATE estado_despliegue_trigger_correo SET tipo_correo_habilitado=1 WHERE id=1"
    ),
    /constraint|CONSTRAINT|despliegue_correo_activacion/u
  );
}

function metadatos(porClave, clave) {
  const fila = porClave.get(clave);
  return [Number(fila.participa_admision_correo), Number(fila.invalida_prueba_smtp)];
}
