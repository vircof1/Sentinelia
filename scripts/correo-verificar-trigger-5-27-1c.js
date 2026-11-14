import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import {
  CLAVES_ADMISION_TRIGGER_CORREO,
  CLAVES_CORREO_REQUIEREN_REVERIFICACION
} from '../paquetes/correo/src/CatalogoConfiguracionCorreo.js';
import { EvaluadorAutoridadCorreoSql }
  from '../paquetes/correo/src/EvaluadorAutoridadCorreoSql.js';
import { KeyringTecnicoCorreo }
  from '../paquetes/correo/src/KeyringTecnicoCorreo.js';
import { PerfilSmtpCorreo } from '../paquetes/correo/src/PerfilSmtpCorreo.js';
import { ServicioCorreoPortal }
  from '../paquetes/correo/src/ServicioCorreoPortal.js';
import { ValidadorConfiguracionCorreo }
  from '../paquetes/correo/src/ValidadorConfiguracionCorreo.js';
import { obtenerDefinicionesConfiguracionPortal }
  from '../paquetes/configuracion/src/obtenerDefinicionesConfiguracionPortal.js';
import { RepositorioConfiguracion }
  from '../paquetes/configuracion/src/RepositorioConfiguracion.js';
import { ServicioConfiguracionPortal }
  from '../paquetes/configuracion/src/ServicioConfiguracionPortal.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { FronteraTransaccionalLocal }
  from '../paquetes/persistencia-sql/src/FronteraTransaccionalLocal.js';
import { RepositorioMigraciones }
  from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

const CONTEXTO_ADMIN = Object.freeze({
  idUsuario: 1,
  idUsuarioReal: 1,
  nivelScope: 'portal',
  permisos: Object.freeze({ administrarConfiguracion: true, verAuditoria: true })
});

await main();

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true, '5.27.1c necesita MariaDB real.');
  const definiciones = obtenerDefinicionesConfiguracionPortal(configuracion);
  verificarCatalogos(definiciones);
  await verificarProyeccionPortalAutoritativa();

  const administrador = new ClienteSql(configuracion.sql);
  const nombre = `sentinelia_fixture_5271c_${randomBytes(5).toString('hex')}`;
  let sql;
  try {
    await administrador.ejecutar(
      `CREATE DATABASE ${administrador.escaparIdentificador(nombre)} ` +
        'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
    );
    sql = new ClienteSql({ ...configuracion.sql, baseDatos: nombre });
    const ejecutor = new EjecutorMigraciones({
      clienteSql: sql,
      repositorioMigraciones: new RepositorioMigraciones(sql),
      rutaMigraciones: obtenerRutaMigraciones()
    });
    await ejecutor.ejecutarPendientes();
    await ejecutor.auditarIntegridadAplicadas();

    const repositorio = new RepositorioConfiguracion(sql);
    const servicio = crearServicioConfiguracion({ sql, repositorio, definiciones });
    await servicio.bootstrapYcargar();
    await verificarMetadatosSql(sql, repositorio);
    await configurarSmtpValido(sql);

    const keyringRotado = crearKeyring(true);
    const perfil = new PerfilSmtpCorreo({ keyringTecnicoCorreo: keyringRotado });
    const evaluador = crearEvaluador(repositorio, perfil);
    await sembrarPruebaSmtp({ sql, repositorio, perfil, keyId: 'anterior' });

    const inicial = await evaluar(sql, evaluador);
    assert.equal(inicial.puedeDespachar, false, JSON.stringify({
      codigo: inicial.codigo,
      errores: inicial.errores,
      codigoPrueba: inicial.prueba.codigo
    }));
    assert.equal(inicial.codigo, 'correo_perfil_smtp_no_autoritativo');
    assert.equal(inicial.prueba.puedeDespachar, true);
    assert.equal(inicial.prueba.prueba.keyId, 'anterior');
    assert.equal(JSON.stringify(inicial.prueba),
      JSON.stringify(inicial.prueba).replaceAll('secreto-fixture-smtp', '***'));

    await servicio.actualizarValor({
      clave: 'correo.max_reintentos',
      valor: 4,
      contextoUsuarioActual: CONTEXTO_ADMIN
    });
    const trasPolitica = await evaluar(sql, evaluador);
    assert.equal(trasPolitica.prueba.puedeDespachar, true,
      'La versión global es traza; una política ajena al transporte no invalida smtp@1.');
    assert.notEqual(trasPolitica.versionConfiguracion, inicial.versionConfiguracion);

    await verificarLocksBinarios(sql, repositorio);

    await servicio.actualizarValor({
      clave: 'correo.smtp_host',
      valor: 'smtp-nuevo.example',
      contextoUsuarioActual: CONTEXTO_ADMIN
    });
    const invalidada = await cargarEstado(sql);
    assert.equal(Number(invalidada.verificado), 0);
    assert.equal(invalidada.codigo_invalidacion, 'configuracion_smtp_modificada');
    assert.equal(Number(invalidada.invalidado_por_usuario_id), 1);
    assert.equal((await cargarValor(sql, 'correo.operativo_verificado')), 'false');
    assert.equal((await evaluar(sql, evaluador)).puedeDespachar, false);

    await sembrarPruebaSmtp({ sql, repositorio, perfil, keyId: 'anterior' });
    const sinClaveHistorica = crearEvaluador(repositorio, new PerfilSmtpCorreo({
      keyringTecnicoCorreo: crearKeyring(false)
    }));
    assert.equal((await evaluar(sql, sinClaveHistorica)).prueba.codigo,
      'correo_clave_hmac_ausente');
    assert.equal((await evaluar(sql, evaluador)).prueba.puedeDespachar, true,
      'Rotar la activa no retira la autoridad de una clave histórica conservada.');

    await activarGuardsPreparados(sql);
    assert.equal((await evaluar(sql, evaluador)).puedeDespachar, true);
    await sql.ejecutar(
      "UPDATE configuracion_portal SET valor='smtp-guard.example' " +
        "WHERE clave='correo.smtp_host'"
    );
    const invalidadaPorGuard = await cargarEstado(sql);
    assert.equal(Number(invalidadaPorGuard.verificado), 0);
    assert.equal(invalidadaPorGuard.codigo_invalidacion,
      'guard_sql_configuracion_smtp');
    await assert.rejects(
      sql.ejecutar(
        "UPDATE configuracion_portal SET valor='true' " +
          "WHERE clave='correo.operativo_verificado'"
      ),
      /verificaci.n legacy de correo ya no es autoridad/iu
    );
    await assert.rejects(
      sql.ejecutar(
        "UPDATE configuracion_portal SET valor='https:\/\/otro.example' " +
          "WHERE clave='federacion.origen_publico'"
      ),
      /origen federado legacy ya no es autoridad/iu
    );

    await ejecutor.auditarIntegridadAplicadas();
    console.log(
      '[correo-trigger] OK 5.27.1c: catalogos=cerrados locks=coherentes ' +
        'smtp@1=hmac_rotatoria invalidacion=atomica guards=preparados gate=cerrado'
    );
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(nombre)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

async function verificarProyeccionPortalAutoritativa() {
  const avisoLegacy =
    'La configuración de correo aún no tiene prueba empírica vigente.';
  const servicio = new ServicioCorreoPortal({
    servicioConfiguracionPortal: {
      async asegurarActualizada() {},
      obtenerEstadoDespliegueCorreoActual() {
        return {
          verificacion_smtp_autoritativa: 1,
          guard_verificacion_legacy_activo: 1
        };
      }
    },
    validadorConfiguracionCorreo: {},
    repositorioColaCorreo: {},
    bloqueadorEnvioCorreoRedis: {},
    clienteSmtp: {},
    evaluadorAutoridadCorreoSql: {
      async evaluarEnTransaccion() {
        return {
          perfil: 'smtp@1',
          codigo: 'correo_smtp_verificado',
          configurado: true,
          puedeDespachar: true,
          configuracion: { activo: true },
          remitenteEmailCanonico: 'alertas@example.com',
          errores: [],
          advertencias: [avisoLegacy],
          prueba: { puedeDespachar: true }
        };
      }
    },
    fronteraTransaccional: {
      ejecutar(trabajo) { return trabajo({}); }
    }
  });
  const estado = await servicio.obtenerEstadoConfiguracionAutoritativo();
  assert.equal(estado.perfil, 'smtp@1');
  assert.equal(estado.operativo, true);
  assert.equal(estado.operativoVerificado, true);
  assert.equal(estado.puedeDespachar, true);
  assert.deepEqual(estado.advertencias, []);
}

function verificarCatalogos(definiciones) {
  assert.deepEqual(
    definiciones.filter((entrada) => entrada.participaAdmisionCorreo)
      .map((entrada) => entrada.clave).sort(compararBinario),
    CLAVES_ADMISION_TRIGGER_CORREO
  );
  assert.deepEqual(
    definiciones.filter((entrada) => entrada.invalidaPruebaSmtp)
      .map((entrada) => entrada.clave).sort(compararBinario),
    CLAVES_CORREO_REQUIEREN_REVERIFICACION
  );
}

function crearServicioConfiguracion({ sql, repositorio, definiciones }) {
  let version = null;
  return new ServicioConfiguracionPortal({
    repositorioConfiguracion: repositorio,
    definiciones,
    fronteraTransaccional: new FronteraTransaccionalLocal(sql),
    versionadorConfiguracionRedis: {
      async obtenerVersionActual() { return version; },
      async publicarVersion(nueva) {
        version = Number(nueva);
        return version;
      }
    },
    servicioAuditoria: { async registrarEnTransaccion() {} },
    ahora: () => new Date('2026-09-03T12:00:00.000Z')
  });
}

function crearKeyring(conHistorica) {
  const keyring = {
    actual: Buffer.alloc(32, 0x42).toString('base64')
  };
  if (conHistorica) keyring.anterior = Buffer.alloc(32, 0x24).toString('base64');
  return new KeyringTecnicoCorreo({ keyring, keyIdActiva: 'actual' });
}

function crearEvaluador(repositorio, perfilSmtpCorreo) {
  return new EvaluadorAutoridadCorreoSql({
    repositorioConfiguracion: repositorio,
    perfilSmtpCorreo,
    validadorConfiguracionCorreo: new ValidadorConfiguracionCorreo()
  });
}

async function verificarMetadatosSql(sql, repositorio) {
  await enTransaccion(sql, async (conexion) => {
    const filas = await repositorio.cargarMetadatosCorreoEnTransaccion({ conexion });
    assert.equal(filas.length, CLAVES_ADMISION_TRIGGER_CORREO.length);
  });
}

async function configurarSmtpValido(sql) {
  const valores = new Map([
    ['correo.activo', 'true'],
    ['correo.smtp_host', 'smtp.example'],
    ['correo.smtp_puerto', '587'],
    ['correo.smtp_secure', 'false'],
    ['correo.smtp_usuario', 'sentinelia'],
    ['correo.smtp_password', 'secreto-fixture-smtp'],
    ['correo.smtp_auth_method', 'PLAIN'],
    ['correo.smtp_timeout_conexion_ms', '10000'],
    ['correo.smtp_timeout_saludo_ms', '10000'],
    ['correo.smtp_timeout_socket_ms', '30000'],
    ['correo.smtp_tls_permitir_inseguro', 'false'],
    ['correo.remitente_email', 'Alertas@Example.com'],
    ['correo.remitente_nombre', 'Sentinelia'],
    ['correo.operativo_verificado', 'true']
  ]);
  await enTransaccion(sql, async (conexion) => {
    for (const [clave, valor] of valores) {
      await conexion.execute(
        'UPDATE configuracion_portal SET valor = ? WHERE clave = ?',
        [valor, clave]
      );
    }
    await conexion.execute(
      'UPDATE cabecera_configuracion_portal SET version = version + 1 WHERE id = 1'
    );
  });
}

async function sembrarPruebaSmtp({ sql, repositorio, perfil, keyId }) {
  return enTransaccion(sql, async (conexion) => {
    const lectura = await repositorio.bloquearAutoridadCorreoEnTransaccion({
      conexion,
      modo: 'exclusivo'
    });
    const prueba = perfil.crearPruebaConKeyId(lectura.valores, keyId);
    assert.equal(Object.hasOwn(prueba, 'material'), false,
      'El perfil no debe exponer material que contiene credenciales SMTP.');
    const dominioCanonico = new Map(lectura.valores);
    dominioCanonico.set('correo.remitente_email', 'Alertas@example.com');
    assert.deepEqual(
      perfil.crearPruebaConKeyId(dominioCanonico, keyId).huellaHmac,
      prueba.huellaHmac,
      'La huella comparte la canonicalización buzon@1.'
    );
    const passwordDistinta = new Map(lectura.valores);
    passwordDistinta.set(
      'correo.smtp_password',
      ` ${lectura.valores.get('correo.smtp_password')}`
    );
    assert.notDeepEqual(
      perfil.crearPruebaConKeyId(passwordDistinta, keyId).huellaHmac,
      prueba.huellaHmac,
      'La contraseña SMTP es opaca y conserva whitespace significativo.'
    );
    await conexion.execute(
      `UPDATE estado_verificacion_correo
          SET verificado = 1,
              perfil_version = ?, huella_hmac = ?, key_id = ?,
              configuracion_version = ?, verificado_por_usuario_id = 1,
              verificado_en_utc = UTC_TIMESTAMP(3),
              invalidado_por_usuario_id = NULL, invalidado_en_utc = NULL,
              codigo_invalidacion = NULL
        WHERE id = 1`,
      [prueba.perfilVersion, prueba.huellaHmac, prueba.keyId,
        lectura.versionConfiguracion]
    );
  });
}

async function evaluar(sql, evaluador) {
  return enTransaccion(sql, (conexion) =>
    evaluador.evaluarEnTransaccion({ conexion }));
}

async function verificarLocksBinarios(sql, repositorio) {
  for (const [primero, segundo] of [
    ['compartido', 'exclusivo'],
    ['exclusivo', 'compartido']
  ]) {
    const conexionA = await sql.obtenerConexion();
    const conexionB = await sql.obtenerConexion();
    try {
      await conexionA.beginTransaction();
      await repositorio.bloquearAutoridadCorreoEnTransaccion({
        conexion: conexionA,
        modo: primero
      });
      await conexionB.beginTransaction();
      await conexionB.execute('SET innodb_lock_wait_timeout = 1');
      await assert.rejects(
        repositorio.bloquearAutoridadCorreoEnTransaccion({
          conexion: conexionB,
          modo: segundo
        }),
        /Lock wait timeout|ER_LOCK_WAIT_TIMEOUT/iu
      );
    } finally {
      await conexionB.rollback().catch(() => {});
      await conexionA.rollback().catch(() => {});
      conexionB.release();
      conexionA.release();
    }
  }
}

async function activarGuardsPreparados(sql) {
  await sql.ejecutar(
    `UPDATE estado_despliegue_trigger_correo
        SET estado = 'corte_origen',
            guard_metadatos_activo = 1,
            origen_portal_autoritativo = 1,
            verificacion_smtp_autoritativa = 1,
            guard_verificacion_legacy_activo = 1,
            cortado_en_utc = UTC_TIMESTAMP(3)
      WHERE id = 1`
  );
}

async function cargarEstado(sql) {
  const [fila] = await sql.consultar(
    'SELECT * FROM estado_verificacion_correo WHERE id = 1'
  );
  return fila;
}

async function cargarValor(sql, clave) {
  const [fila] = await sql.consultar(
    'SELECT valor FROM configuracion_portal WHERE clave = ?',
    [clave]
  );
  return fila?.valor;
}

async function enTransaccion(sql, trabajo) {
  const conexion = await sql.obtenerConexion();
  try {
    await conexion.beginTransaction();
    const resultado = await trabajo(conexion);
    await conexion.commit();
    return resultado;
  } catch (error) {
    await conexion.rollback().catch(() => {});
    throw error;
  } finally {
    conexion.release();
  }
}

function compararBinario(a, b) {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}
