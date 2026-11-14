import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import { generarUuidV7Auditoria } from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import { RepositorioUsuarios } from '../paquetes/usuarios/src/RepositorioUsuarios.js';
import {
  ErrorAplicacionDdnsAgentes,
  ServicioAplicacionDdnsAgentes
} from '../paquetes/dns/src/ServicioAplicacionDdnsAgentes.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones } from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

await main();

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true, '5.28.3a necesita MariaDB real.');
  const administrador = new ClienteSql(configuracion.sql);
  const base = `sentinelia_fixture_5283a_${randomBytes(5).toString('hex')}`;
  let sql;
  try {
    await administrador.ejecutar(
      `CREATE DATABASE ${administrador.escaparIdentificador(base)} ` +
        'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
    );
    sql = new ClienteSql({ ...configuracion.sql, baseDatos: base });
    await migrar(sql);
    const fixture = await crearFixture(sql);
    const servicio = new ServicioAplicacionDdnsAgentes({
      clienteSql: sql,
      repositorioUsuarios: new RepositorioUsuarios(sql)
    });
    const generacionesAntes = await fotografiarGeneraciones(sql);

    await verificarScopesYBaselines(servicio, fixture);
    await verificarDobleSubmit(servicio, fixture);
    await verificarPerdidaPermiso(sql, servicio, fixture);

    assert.deepEqual(
      await fotografiarGeneraciones(sql),
      generacionesAntes,
      'Crear concesiones no puede producir una generación DNS.'
    );
    console.log(
      '[dns-ddns] OK 5.28.3a: autoridad=bilateral-viva ' +
      'scopes=iguales+cruzados carrera=permiso_revalidado doble_submit=serializado ' +
      'baseline=confirmada+desconocida version=0 dns_generaciones=0'
    );
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(base)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

async function migrar(sql) {
  await new EjecutorMigraciones({
    clienteSql: sql,
    repositorioMigraciones: new RepositorioMigraciones(sql),
    rutaMigraciones: obtenerRutaMigraciones()
  }).ejecutarPendientes();
}

async function verificarScopesYBaselines(servicio, fixture) {
  const misma = await servicio.crearConcesion({
    contextoUsuarioActual: contexto(fixture.usuarioTenant, fixture.scopeTenant),
    agenteId: fixture.agente,
    registroDnsId: fixture.registroMismoScope
  });
  assert.equal(misma.version, '0');
  assert.equal(misma.decision, 'pendiente_decision_agente');
  assert.equal(misma.condicion, 'pendiente_decision_agente');
  assert.deepEqual(misma.contenidoDeseado, {
    modo: 'declarada', tipo: 'A', valor: { direccionIpv4: '192.0.2.10' }
  });
  assert.deepEqual(misma.contenidoPublicado, misma.contenidoDeseado);
  assert.equal(misma.generacionDnsPublicada, '1');
  assert.equal(misma.scopeAgente.sitioId, String(fixture.sitio));
  assert.equal(misma.scopeRegistro.sitioId, String(fixture.sitio));

  const cruzada = await servicio.crearConcesion({
    contextoUsuarioActual: contexto(fixture.usuarioPortal, fixture.scopePortal),
    agenteId: fixture.agente,
    registroDnsId: fixture.registroPortalPendiente
  });
  assert.equal(cruzada.scopeAgente.sitioId, String(fixture.sitio));
  assert.equal(cruzada.scopeRegistro.tenantId, null);
  assert.equal(cruzada.condicion, 'publicacion_previa_desconocida');
  assert.equal(cruzada.contenidoPublicado, null);
  assert.equal(cruzada.generacionDnsPublicada, null);
}

async function verificarDobleSubmit(servicio, fixture) {
  const entrada = {
    contextoUsuarioActual: contexto(fixture.usuarioPortal, fixture.scopePortal),
    agenteId: fixture.agente,
    registroDnsId: fixture.registroCarrera
  };
  const resultados = await Promise.allSettled([
    servicio.crearConcesion(entrada),
    servicio.crearConcesion(entrada)
  ]);
  assert.equal(resultados.filter(({ status }) => status === 'fulfilled').length, 1);
  assert.equal(resultados.filter(({ status }) => status === 'rejected').length, 1);
  const [conteo] = await fixture.sql.consultar(
    `SELECT COUNT(*) AS total FROM concesiones_ddns_agentes
      WHERE registro_dns_id=? AND estado='vigente'`,
    [fixture.registroCarrera]
  );
  assert.equal(Number(conteo.total), 1);
}

async function verificarPerdidaPermiso(sql, servicio, fixture) {
  const bloqueo = await sql.obtenerConexion();
  try {
    await bloqueo.beginTransaction();
    await bloqueo.execute(
      'SELECT id FROM usuarios WHERE id=? FOR UPDATE',
      [fixture.usuarioPortal]
    );
    const intento = servicio.crearConcesion({
      contextoUsuarioActual: contexto(fixture.usuarioPortal, fixture.scopePortal),
      agenteId: fixture.agente,
      registroDnsId: fixture.registroPermiso
    });
    await new Promise((resolver) => setTimeout(resolver, 80));
    await bloqueo.execute(
      'UPDATE usuarios SET permiso_modificar_agentes=0 WHERE id=?',
      [fixture.usuarioPortal]
    );
    await bloqueo.commit();
    await assert.rejects(
      intento,
      (error) => error instanceof ErrorAplicacionDdnsAgentes &&
        error.codigo === 'autoridad_insuficiente'
    );
  } finally {
    await bloqueo.rollback().catch(() => {});
    bloqueo.release();
  }
  const [conteo] = await sql.consultar(
    `SELECT COUNT(*) AS total FROM concesiones_ddns_agentes
      WHERE registro_dns_id=? AND estado='vigente'`,
    [fixture.registroPermiso]
  );
  assert.equal(Number(conteo.total), 0);
}

async function crearFixture(sql) {
  const [tenant] = await sql.ejecutar(
    "INSERT INTO tenants (nombre,alias) VALUES ('Tenant 5.28.3a','tenant-5283a')"
  );
  const [empresa] = await sql.ejecutar(
    "INSERT INTO empresas (tenant_id,nombre,alias) VALUES (?,'Empresa 5.28.3a','empresa-5283a')",
    [tenant.insertId]
  );
  const [sitio] = await sql.ejecutar(
    "INSERT INTO sitios (tenant_id,empresa_id,nombre,alias) VALUES (?,?,'Sitio 5.28.3a','sitio-5283a')",
    [tenant.insertId, empresa.insertId]
  );
  const usuarioPortal = await crearUsuario(sql, 'portal', {});
  const usuarioTenant = await crearUsuario(sql, 'tenant', {
    tenantId: tenant.insertId
  });
  const [agente] = await sql.ejecutar(
    `INSERT INTO agentes_sentinelia (
       guid,tenant_id,empresa_id,sitio_id,nombre,secreto_hash
     ) VALUES (?,?,?,?,?,'hash-fixture-5283a')`,
    [generarUuidV7Auditoria(), tenant.insertId, empresa.insertId, sitio.insertId, 'Agente 5.28.3a']
  );
  const zonaSitio = await crearZona(sql, 'sitio', {
    tenantId: tenant.insertId,
    empresaId: empresa.insertId,
    sitioId: sitio.insertId,
    estadoPublicacion: 'publicado'
  });
  const zonaPortal = await crearZona(sql, 'portal', {
    estadoPublicacion: 'pendiente'
  });
  await establecerGeneracionObservada(sql);
  const registroMismoScope = await crearRegistro(sql, zonaSitio, '10', {
    tenantId: tenant.insertId,
    empresaId: empresa.insertId,
    sitioId: sitio.insertId
  });
  const registroPortalPendiente = await crearRegistro(sql, zonaPortal, '20');
  const registroCarrera = await crearRegistro(sql, zonaPortal, '30');
  const registroPermiso = await crearRegistro(sql, zonaPortal, '40');
  return Object.freeze({
    sql,
    tenant: tenant.insertId,
    empresa: empresa.insertId,
    sitio: sitio.insertId,
    usuarioPortal,
    usuarioTenant,
    agente: agente.insertId,
    registroMismoScope,
    registroPortalPendiente,
    registroCarrera,
    registroPermiso,
    scopePortal: { tenantId: null, empresaId: null, sitioId: null },
    scopeTenant: { tenantId: tenant.insertId, empresaId: null, sitioId: null }
  });
}

async function crearUsuario(sql, sufijo, {
  tenantId = null,
  empresaId = null,
  sitioId = null
}) {
  const [resultado] = await sql.ejecutar(
    `INSERT INTO usuarios (
       usuario,email,hash_password,tenant_id,empresa_id,sitio_id,
       permiso_modificar_agentes,permiso_administrar_dns_avanzado
     ) VALUES (?,?,?,?,?,?,1,1)`,
    [`usuario-${sufijo}-5283a`, `${sufijo}@example.test`, 'hash', tenantId, empresaId, sitioId]
  );
  return resultado.insertId;
}

async function crearZona(sql, sufijo, {
  tenantId = null,
  empresaId = null,
  sitioId = null,
  estadoPublicacion
}) {
  const [resultado] = await sql.ejecutar(
    `INSERT INTO zonas_dns (
       tenant_id,empresa_id,sitio_id,nombre_zona,soa_mname,soa_rname,
       estado_publicacion
     ) VALUES (?,?,?,?,?,?,?)`,
    [
      tenantId, empresaId, sitioId, `${sufijo}-5283a.example.`,
      'ns.example.', 'hostmaster.example.', estadoPublicacion
    ]
  );
  return resultado.insertId;
}

async function crearRegistro(sql, zonaId, octeto, {
  tenantId = null,
  empresaId = null,
  sitioId = null
} = {}) {
  const [resultado] = await sql.ejecutar(
    `INSERT INTO registros_dns (
       zona_id,tenant_id,empresa_id,sitio_id,host_relativo,tipo_registro,
       valor_principal,categoria_origen,publicar_en_bind,activo
     ) VALUES (?,?,?,?,'host','A',?,'ddns',1,1)`,
    [zonaId, tenantId, empresaId, sitioId, `192.0.2.${octeto}`]
  );
  return resultado.insertId;
}

async function establecerGeneracionObservada(sql) {
  await sql.ejecutar(
    `UPDATE cabecera_generacion_dns
        SET ultima_generacion_dns=1,generacion_observada=1,
            actualizada_en_utc=UTC_TIMESTAMP(3)
      WHERE id=1`
  );
  await sql.ejecutar(
    `INSERT INTO operaciones_publicacion_dns (
       generacion_dns,causa,generacion_raiz_recuperacion,estado,
       efecto_posible,generacion_leida,perfil_proyeccion,hash_proyeccion,
       generacion_observada,intentos,proximo_intento_utc,
       creada_en_utc,actualizada_en_utc,efecto_iniciado_en_utc,
       recarga_confirmada_en_utc
     ) VALUES (
       1,'mutacion_catalogo',1,'recarga_confirmada',1,1,
       'fixture-5283a',?,1,1,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),
       UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3)
     )`,
    [Buffer.alloc(32, 3)]
  );
}

async function fotografiarGeneraciones(sql) {
  const [cabecera] = await sql.consultar(
    `SELECT CAST(ultima_generacion_dns AS CHAR) AS ultima,
            CAST(generacion_observada AS CHAR) AS observada,
            CAST(fencing_token AS CHAR) AS fencing
       FROM cabecera_generacion_dns WHERE id=1`
  );
  const [operaciones] = await sql.consultar(
    'SELECT COUNT(*) AS total FROM operaciones_publicacion_dns'
  );
  return {
    ultima: cabecera.ultima,
    observada: cabecera.observada,
    fencing: cabecera.fencing,
    operaciones: String(operaciones.total)
  };
}

function contexto(idUsuario, scope) {
  return Object.freeze({
    idUsuario,
    idUsuarioReal: idUsuario,
    nivelScope: scope.tenantId === null ? 'portal' : 'tenant',
    esOperadorSistema: scope.tenantId === null,
    ...scope,
    permisos: Object.freeze({ modificarAgentes: true, administrarDnsAvanzado: true })
  });
}
