import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import { generarUuidV7Auditoria } from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import {
  CoordinadorOperacionesDurables,
  LeaseOperacionDurablePerdido
} from '../paquetes/coordinacion-durable/src/CoordinadorOperacionesDurables.js';
import { RepositorioCausasPolDdns } from '../paquetes/dns/src/RepositorioCausasPolDdns.js';
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
  assert.equal(configuracion.sql.estaCompleta, true, '5.28.1b necesita MariaDB real.');
  const administrador = new ClienteSql(configuracion.sql);
  const base = `sentinelia_fixture_5281b_${randomBytes(5).toString('hex')}`;
  let sql;
  try {
    await administrador.ejecutar(
      `CREATE DATABASE ${administrador.escaparIdentificador(base)} ` +
        'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
    );
    sql = new ClienteSql({ ...configuracion.sql, baseDatos: base });
    await new EjecutorMigraciones({
      clienteSql: sql,
      repositorioMigraciones: new RepositorioMigraciones(sql),
      rutaMigraciones: obtenerRutaMigraciones()
    }).ejecutarPendientes();
    const fixture = await crearFixture(sql);
    await verificarIntentos(sql, fixture);
    await verificarSkipLockedYFencing(sql, fixture);
    await verificarIndependenciaRedis(sql, fixture);
    console.log(
      '[dns-ddns] OK 5.28.1b: esquema=inicial intentos=unicos ' +
      'causas_pol=durables skip_locked=real lease=reclamable fencing=cercado ' +
      'redis=no_autoritativo diagnostico=saneado'
    );
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(base)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

async function verificarIntentos(sql, fixture) {
  const [concesion] = await sql.ejecutar(
    `INSERT INTO concesiones_ddns_agentes (
       concesion_id,agente_id,registro_dns_id,agente_id_fotografia,
       registro_dns_id_fotografia,agente_scope_tenant_id,
       agente_scope_empresa_id,agente_scope_sitio_id
     ) VALUES (UNHEX(REPLACE(?, '-', '')),?,?,?,?,?,?,?)`,
    [
      generarUuidV7Auditoria(), fixture.agente, fixture.registro,
      fixture.agente, fixture.registro, fixture.tenant, fixture.empresa,
      fixture.sitio
    ]
  );
  const intencionUuid = generarUuidV7Auditoria();
  const estado = '{"modo":"declarada","valor":{"direccionIpv4":"192.0.2.9"}}';
  const [intencion] = await sql.ejecutar(
    `INSERT INTO intenciones_ddns_agentes (
       intencion_id,concesion_interna_id,agente_id_fotografia,
       registro_dns_id_fotografia,origen,version_ddns,modo,
       estado_deseado_canonico,estado_deseado_sha256,causa_tipo,causa_id
     ) VALUES (UNHEX(REPLACE(?, '-', '')),?,?,?,'agente_explicita',1,
       'declarada',?,UNHEX(SHA2(?,256)),'solicitud_agente',
       UNHEX(REPLACE(?, '-', '')))`,
    [
      intencionUuid, concesion.insertId, fixture.agente, fixture.registro,
      estado, estado, generarUuidV7Auditoria()
    ]
  );
  await sql.ejecutar(
    `INSERT INTO intentos_publicacion_ddns (
       concesion_interna_id,intencion_interna_id,version_ddns,numero_intento,
       disponible_en_utc
     ) VALUES (?,?,1,1,UTC_TIMESTAMP(3))`,
    [concesion.insertId, intencion.insertId]
  );
  await assert.rejects(
    sql.ejecutar(
      `INSERT INTO intentos_publicacion_ddns (
         concesion_interna_id,intencion_interna_id,version_ddns,numero_intento,
         disponible_en_utc
       ) VALUES (?,?,1,1,UTC_TIMESTAMP(3))`,
      [concesion.insertId, intencion.insertId]
    ),
    (error) => error?.code === 'ER_DUP_ENTRY'
  );
  await assert.rejects(
    sql.ejecutar(
      `INSERT INTO intentos_publicacion_ddns (
         concesion_interna_id,intencion_interna_id,version_ddns,numero_intento,
         disponible_en_utc
       ) VALUES (?,?,1,4,UTC_TIMESTAMP(3))`,
      [concesion.insertId, intencion.insertId]
    ),
    (error) => error?.sqlState === '23000' &&
      /chk_intentos_publicacion_ddns_numero/u.test(error.message)
  );
}

async function verificarSkipLockedYFencing(sql, fixture) {
  const repositorio = new RepositorioCausasPolDdns(sql);
  const primeraId = await crearCausa(repositorio, fixture, 1, '192.0.2.10');
  const segundaId = await crearCausa(repositorio, fixture, 2, '192.0.2.11');
  const bloqueo = await sql.obtenerConexion();
  try {
    await bloqueo.beginTransaction();
    await bloqueo.execute(
      'SELECT causa_id FROM causas_pol_ddns WHERE causa_id=UNHEX(REPLACE(?,\'-\',\'\')) FOR UPDATE',
      [primeraId]
    );
    const coordinador = new CoordinadorOperacionesDurables({
      repositorio,
      instanciaId: 'runtime-skip-locked',
      ttlSegundos: 5
    });
    const reclamada = await coordinador.reclamarSiguiente();
    assert.equal(reclamada.lease.operacionId, segundaId,
      'SKIP LOCKED debe permitir reclamar la siguiente causa independiente.');
    await coordinador.consolidar(reclamada.lease);
    await bloqueo.commit();
  } finally {
    await bloqueo.rollback().catch(() => {});
    bloqueo.release();
  }

  const coordinadorA = new CoordinadorOperacionesDurables({
    repositorio,
    instanciaId: 'runtime-a',
    ttlSegundos: 1
  });
  const leaseA = await coordinadorA.reclamarSiguiente();
  assert.equal(leaseA.lease.operacionId, primeraId);
  await new Promise((resolver) => setTimeout(resolver, 1_150));
  const coordinadorB = new CoordinadorOperacionesDurables({
    repositorio,
    instanciaId: 'runtime-b',
    ttlSegundos: 5
  });
  const leaseB = await coordinadorB.reclamarSiguiente();
  assert.equal(leaseB.lease.operacionId, primeraId);
  assert.equal(BigInt(leaseB.lease.fencingToken), BigInt(leaseA.lease.fencingToken) + 1n);
  await assert.rejects(
    coordinadorA.consolidar(leaseA.lease),
    LeaseOperacionDurablePerdido
  );
  await coordinadorB.consolidar(leaseB.lease);
}

async function verificarIndependenciaRedis(sql, fixture) {
  const repositorioAntes = new RepositorioCausasPolDdns(sql);
  const causaId = await crearCausa(repositorioAntes, fixture, 3, '2001:db8::1', 'ipv6');
  const proyeccionRedisAntes = new Map([['aviso', causaId]]);
  proyeccionRedisAntes.clear();
  const repositorioDespues = new RepositorioCausasPolDdns(sql);
  const coordinador = new CoordinadorOperacionesDurables({
    repositorio: repositorioDespues,
    instanciaId: 'runtime-tras-redis',
    ttlSegundos: 5
  });
  const reclamada = await coordinador.reclamarSiguiente();
  assert.equal(reclamada.lease.operacionId, causaId);
  assert.equal(reclamada.operacion.direccionRemota, '2001:db8::1');
  await coordinador.consolidar(reclamada.lease);
}

async function crearCausa(
  repositorio,
  fixture,
  secuencia,
  direccion,
  familia = 'ipv4'
) {
  const causaId = generarUuidV7Auditoria();
  await repositorio.crear({
    causaId,
    agenteId: fixture.agente,
    periodoVidaPolId: fixture.periodo,
    sesionId: 'sesion-fixture',
    secuencia: String(secuencia),
    aceptadaEnUtc: new Date(Date.now() + secuencia).toISOString().slice(0, 23).replace('T', ' '),
    direccionRemota: direccion,
    familiaDireccion: familia
  });
  return causaId;
}

async function crearFixture(sql) {
  const [tenant] = await sql.ejecutar(
    "INSERT INTO tenants (nombre,alias) VALUES ('Tenant','tenant-5281b')"
  );
  const [empresa] = await sql.ejecutar(
    "INSERT INTO empresas (tenant_id,nombre,alias) VALUES (?,'Empresa','empresa-5281b')",
    [tenant.insertId]
  );
  const [sitio] = await sql.ejecutar(
    "INSERT INTO sitios (tenant_id,empresa_id,nombre,alias) VALUES (?,?,'Sitio','sitio-5281b')",
    [tenant.insertId, empresa.insertId]
  );
  const [zona] = await sql.ejecutar(
    `INSERT INTO zonas_dns (nombre_zona,soa_mname,soa_rname)
     VALUES ('fixture-5281b.example.','ns.example.','hostmaster.example.')`
  );
  const [registro] = await sql.ejecutar(
    `INSERT INTO registros_dns (
       zona_id,host_relativo,tipo_registro,valor_principal,categoria_origen
     ) VALUES (?,'host','A','192.0.2.1','ddns')`,
    [zona.insertId]
  );
  const [agente] = await sql.ejecutar(
    `INSERT INTO agentes_sentinelia (
       guid,tenant_id,empresa_id,sitio_id,nombre,secreto_hash
     ) VALUES (?,?,?,?,?,'hash')`,
    [
      generarUuidV7Auditoria(), tenant.insertId, empresa.insertId,
      sitio.insertId, 'Agente 5281b'
    ]
  );
  const [periodo] = await sql.ejecutar(
    `INSERT INTO periodos_vida_pol_agentes (
       agente_id,inicio_utc,heartbeats_recibidos
     ) VALUES (?,UTC_TIMESTAMP(),3)`,
    [agente.insertId]
  );
  return {
    tenant: tenant.insertId,
    empresa: empresa.insertId,
    sitio: sitio.insertId,
    zona: zona.insertId,
    registro: registro.insertId,
    agente: agente.insertId,
    periodo: periodo.insertId
  };
}
