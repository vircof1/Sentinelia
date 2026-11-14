import assert from 'node:assert/strict';
import { createClient } from 'redis';
import { readFile } from 'node:fs/promises';

import { RepositorioAuditoria } from '../paquetes/auditoria/src/RepositorioAuditoria.js';
import { generarUuidV7Auditoria } from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import { AdaptadorAuditoriaHeartbeatFederacion } from '../paquetes/federacion/adaptadores/AdaptadorAuditoriaHeartbeatFederacion.js';
import { AdaptadorAuditoriaSesionesFederacion } from '../paquetes/federacion/adaptadores/AdaptadorAuditoriaSesionesFederacion.js';
import { GeneradorSecretoPersistenteFederacion } from '../paquetes/federacion/adaptadores/GeneradorSecretoPersistenteFederacion.js';
import { VerificadorSecretoPersistenteFederacion } from '../paquetes/federacion/adaptadores/ProtectorSecretoPersistenteFederacion.js';
import { RepositorioCredencialesPersistentesFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioCredencialesPersistentesFederacionSql.js';
import { RepositorioHeartbeatFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioHeartbeatFederacionSql.js';
import { RepositorioPresenciaFederacionRedis } from '../paquetes/federacion/adaptadores/RepositorioPresenciaFederacionRedis.js';
import { RepositorioSesionesFederacionRedis } from '../paquetes/federacion/adaptadores/RepositorioSesionesFederacionRedis.js';
import { RepositorioSesionesFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioSesionesFederacionSql.js';
import { ServicioHeartbeatFederacion } from '../paquetes/federacion/aplicacion/ServicioHeartbeatFederacion.js';
import { ServicioSesionesFederacion } from '../paquetes/federacion/aplicacion/ServicioSesionesFederacion.js';
import { FAMILIAS_FEDERACION, VERSIONES_FAMILIA_FEDERACION } from '../paquetes/federacion/src/CatalogosFederacion.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones } from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import { obtenerConfiguracionAplicacion, obtenerRutaMigraciones } from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

const RELACION = `sfid1.relacion.${'l'.repeat(21)}A`;
const LOCAL = `sfid1.instalacion.${'m'.repeat(21)}Q`;
const REMOTA = `sfid1.instalacion.${'n'.repeat(21)}g`;
const BOOT = `sfid1.arranque.${'o'.repeat(21)}w`;
const USUARIO = 916;
const PREFIJO = `sentinelia:fixture:52211g:${Date.now()}:${process.pid}`;

await main();

async function main() {
  await verificarRegistro();
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true);
  const sql = new ClienteSql(configuracion.sql);
  const redis = createClient({ url: configuracion.redis.url });
  redis.on('error', () => {});
  await redis.connect();
  try {
    await new EjecutorMigraciones({
      clienteSql: sql,
      repositorioMigraciones: new RepositorioMigraciones(sql),
      rutaMigraciones: obtenerRutaMigraciones()
    }).ejecutarPendientes();
    await limpiar(sql, redis);
    const secreto = await crearFixture(sql);
    await verificarHeartbeat(sql, redis, secreto);
  } finally {
    await limpiar(sql, redis);
    await redis.quit();
    await sql.cerrar();
  }
  console.log('[federacion] OK 5.22.11g: heartbeat=idempotente presencia=redis-ttl ' +
    'tiempo=rtt-cuatro-instantes compatibilidad=exacta vinculacion=consolidada avisos=temporales');
}

async function verificarRegistro() {
  const [openapi, rutas] = await Promise.all([
    leer('../openapi/federacion-control.v1.yaml'),
    leer('../apps/sentinelia-web/src/rutas/crearRutasApiFederacion.js')
  ]);
  assert.match(openapi, /sesion\/heartbeat/u);
  assert.match(rutas, /sesion\/heartbeat/u);
}

async function verificarHeartbeat(sql, redis, secreto) {
  const auditoria = new RepositorioAuditoria(sql);
  const credenciales = new RepositorioCredencialesPersistentesFederacionSql(sql);
  const sesionesRedis = new RepositorioSesionesFederacionRedis({
    clienteRedis: redis, prefijo: PREFIJO, ttlSegundos: 60, graciaRefreshSegundos: 10
  });
  const sesiones = new ServicioSesionesFederacion({
    repositorioSql: new RepositorioSesionesFederacionSql(sql, {
      repositorioCredenciales: credenciales,
      verificadorSecretos: new VerificadorSecretoPersistenteFederacion(),
      adaptadorAuditoria: new AdaptadorAuditoriaSesionesFederacion({ repositorioAuditoria: auditoria })
    }),
    repositorioRedis: sesionesRedis,
    installationLocalId: LOCAL
  });
  const sesion = await sesiones.login({
    relacionId: RELACION, installationEmisoraId: REMOTA, bootEmisorId: BOOT,
    loginRequestId: generarUuidV7Auditoria(), secretoPersistente: secreto
  });
  const presencia = new RepositorioPresenciaFederacionRedis({
    clienteRedis: redis, prefijo: PREFIJO, ttlSegundos: 30
  });
  const avisos = { detectados: [], resueltos: [],
    async detectar(valor) { this.detectados.push(valor); },
    async resolver(valor) { this.resueltos.push(valor); }
  };
  const repositorioHeartbeat = new RepositorioHeartbeatFederacionSql(sql, {
    adaptadorAuditoria: new AdaptadorAuditoriaHeartbeatFederacion({
      repositorioAuditoria: auditoria
    })
  });
  const servicio = new ServicioHeartbeatFederacion({
    servicioSesiones: sesiones,
    repositorioSql: repositorioHeartbeat,
    repositorioPresencia: presencia,
    resolverConfiguracion: async () => ({ toleranciaTemporalMs: 5000 }),
    servicioAvisos: avisos
  });
  const compatibilidad = {
    protocoloVersion: 1,
    productoVersion: '0.1.0-beta.1',
    familiasSoportadas: [...FAMILIAS_FEDERACION.valores],
    versionesFamilia: { ...VERSIONES_FAMILIA_FEDERACION }
  };
  const base = {
    token: sesion.sesion.token, relacionId: RELACION,
    sesionId: sesion.sesion.sessionId, bootEmisorId: BOOT, compatibilidad
  };
  const incompatibilidad = { ...compatibilidad, protocoloVersion: 2 };
  const primero = await servicio.registrar({
    ...base, compatibilidad: incompatibilidad,
    heartbeatRequestId: generarUuidV7Auditoria(), seq: '1',
    clienteEnviaEnUtc: new Date().toISOString(), muestraTemporalAnterior: null
  });
  assert.equal(primero.relacion.estado, 'pendienteAutenticacion');
  assert.equal(primero.relacion.compatibilidad, 'incompatible');
  assert.equal(primero.relacion.temporal.estado, 'pendiente');
  const replay = await servicio.registrar({
    ...base, compatibilidad: incompatibilidad,
    heartbeatRequestId: primero.heartbeatRequestId, seq: '1',
    clienteEnviaEnUtc: primero.muestraTemporal.clienteEnviaEnUtc,
    muestraTemporalAnterior: null
  });
  assert.deepEqual(replay, primero);

  const segundo = await servicio.registrar({
    ...base, heartbeatRequestId: generarUuidV7Auditoria(), seq: '2',
    clienteEnviaEnUtc: new Date().toISOString(),
    muestraTemporalAnterior: cerrarMuestra(primero, 10)
  });
  assert.equal(segundo.relacion.estado, 'vinculada');
  assert.equal(segundo.relacion.temporal.estado, 'tolerable');
  assert.ok(segundo.relacion.temporal.rttEstimadoMs !== null);
  assert.equal((await presencia.consultar(RELACION)).seq, '2');

  const tercero = await servicio.registrar({
    ...base, heartbeatRequestId: generarUuidV7Auditoria(), seq: '3',
    clienteEnviaEnUtc: new Date().toISOString(),
    muestraTemporalAnterior: cerrarMuestra(segundo, 20000)
  });
  assert.equal(tercero.relacion.estado, 'vinculada');
  assert.equal(tercero.relacion.temporal.estado, 'noTolerable');
  assert.equal(avisos.detectados.length, 1);

  const cuarto = await servicio.registrar({
    ...base, heartbeatRequestId: generarUuidV7Auditoria(), seq: '4',
    clienteEnviaEnUtc: new Date().toISOString(),
    muestraTemporalAnterior: cerrarMuestra(tercero, 10)
  });
  assert.equal(cuarto.relacion.temporal.estado, 'tolerable');
  assert.equal(avisos.resueltos.length, 2, 'Las muestras tolerables cierran idempotentemente el aviso.');

  let fallarPublicacion = true;
  const presenciaIntermitente = {
    ttlSegundos: presencia.ttlSegundos,
    async publicar(valor, opciones) {
      if (fallarPublicacion) {
        fallarPublicacion = false;
        throw new Error('Fallo Redis posterior al commit SQL simulado.');
      }
      return presencia.publicar(valor, opciones);
    }
  };
  const servicioIntermitente = new ServicioHeartbeatFederacion({
    servicioSesiones: sesiones,
    repositorioSql: repositorioHeartbeat,
    repositorioPresencia: presenciaIntermitente,
    resolverConfiguracion: async () => ({ toleranciaTemporalMs: 5000 }),
    servicioAvisos: avisos
  });
  const heartbeatReparable = {
    ...base,
    heartbeatRequestId: generarUuidV7Auditoria(),
    seq: '5',
    clienteEnviaEnUtc: new Date().toISOString(),
    muestraTemporalAnterior: cerrarMuestra(cuarto, 10)
  };
  await assert.rejects(
    () => servicioIntermitente.registrar(heartbeatReparable),
    /Fallo Redis posterior/u
  );
  const replayReparado = await servicioIntermitente.registrar(heartbeatReparable);
  assert.equal(replayReparado.seq, '5');
  assert.equal((await presencia.consultar(RELACION)).seq, '5',
    'El replay debe reparar la presencia sin crear otro heartbeat SQL.');

  await assert.rejects(() => servicio.registrar({
    ...base, heartbeatRequestId: generarUuidV7Auditoria(), seq: '3',
    clienteEnviaEnUtc: new Date().toISOString(), muestraTemporalAnterior: null
  }), /no avanza/u);
  const sesionNueva = await sesiones.login({
    relacionId: RELACION, installationEmisoraId: REMOTA, bootEmisorId: BOOT,
    loginRequestId: generarUuidV7Auditoria(), secretoPersistente: secreto
  });
  const reinicioSecuencia = await servicio.registrar({
    ...base,
    token: sesionNueva.sesion.token,
    sesionId: sesionNueva.sesion.sessionId,
    heartbeatRequestId: generarUuidV7Auditoria(),
    seq: '1',
    clienteEnviaEnUtc: new Date().toISOString(),
    muestraTemporalAnterior: null
  });
  assert.equal(reinicioSecuencia.seq, '1', 'La secuencia pertenece a la sesión, no a la relación.');
  assert.equal(reinicioSecuencia.relacion.temporal.estado, 'pendiente');
  assert.equal((await presencia.consultar(RELACION)).fencingToken,
    sesionNueva.sesion.fencingToken);
  const [relacion] = await sql.consultar(
    'SELECT estado_ciclo,estado_compatibilidad FROM relaciones_federacion WHERE relacion_id=?',
    [RELACION]
  );
  assert.deepEqual([relacion.estado_ciclo, relacion.estado_compatibilidad], ['vinculada', 'compatible']);
  const [arranque] = await sql.consultar(
    'SELECT contador_heartbeats FROM arranques_remotos_federacion WHERE relacion_id=? AND boot_remoto_id=?',
    [RELACION, BOOT]
  );
  assert.equal(Number(arranque.contador_heartbeats), 6,
    'El replay reparador no duplica el histórico de presencia.');
}

function cerrarMuestra(respuesta, demoraMs) {
  return {
    ...respuesta.muestraTemporal,
    clienteRecibeEnUtc: new Date(
      Date.parse(respuesta.muestraTemporal.servidorEnviaEnUtc) + demoraMs
    ).toISOString()
  };
}

async function crearFixture(sql) {
  await sql.ejecutar(`INSERT INTO usuarios (
    id,usuario,email,hash_password,activo,permiso_configurar_recepciones_federacion
  ) VALUES (?, ?, ?, 'fixture-no-login', 1, 1)`,
  [USUARIO, `fixture-fed-${USUARIO}`, `fixture-fed-${USUARIO}@invalid.local`]);
  const ahora = '2020-01-01 00:00:00.000';
  await sql.ejecutar(`INSERT INTO relaciones_federacion (
    relacion_id,direccion,estado_ciclo,estado_autoridad,estado_identidad,
    estado_compatibilidad,installation_remota_candidata_id,installation_remota_id,
    nombre_remoto_declarado,responsable_usuario_id,responsable_original_usuario_id,
    scope_tenant_id,scope_empresa_id,scope_sitio_id,version_autoridad,corte_autoridad_utc,
    creada_por_usuario_id,creada_en_utc,actualizada_en_utc,revision
  ) VALUES (?,'recepcion','pendienteAutenticacion','autorizada','valida',NULL,?,?,
    'Emisor heartbeat 11g',?,?,NULL,NULL,NULL,1,NULL,?,?,?,1)`,
  [RELACION, REMOTA, REMOTA, USUARIO, USUARIO, USUARIO, ahora, ahora]);
  const secreto = new GeneradorSecretoPersistenteFederacion().generar();
  const conexion = await sql.obtenerConexion();
  try {
    await conexion.beginTransaction();
    await new RepositorioCredencialesPersistentesFederacionSql(sql)
      .guardarVerificadorReceptorEnTransaccion({
        relacionId: RELACION, installationLocalId: LOCAL,
        installationRemotaId: REMOTA, secreto, efectivoEnUtc: ahora
      }, { conexion, verificadorSecretos: new VerificadorSecretoPersistenteFederacion() });
    await conexion.commit();
  } catch (error) {
    await conexion.rollback();
    throw error;
  } finally { conexion.release(); }
  return secreto;
}

async function limpiar(sql, redis) {
  const claves = [];
  for await (const clave of redis.scanIterator({ MATCH: `${PREFIJO}:*`, COUNT: 100 })) claves.push(clave);
  if (claves.length) await redis.del(claves);
  for (const tabla of [
    'arranques_remotos_federacion', 'estado_salud_relaciones_federacion',
    'operaciones_sesion_federacion', 'estado_sesiones_federacion',
    'credenciales_persistentes_federacion', 'candidaturas_identidad_federacion',
    'invitaciones_establecimiento_federacion', 'historico_estados_relaciones_federacion'
  ]) await sql.ejecutar(`DELETE FROM ${tabla} WHERE relacion_id=?`, [RELACION]);
  await sql.ejecutar('DELETE FROM relaciones_federacion WHERE relacion_id=?', [RELACION]);
  await sql.ejecutar('DELETE FROM usuarios WHERE id=?', [USUARIO]);
}

function leer(ruta) { return readFile(new URL(ruta, import.meta.url), 'utf8'); }
