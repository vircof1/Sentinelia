import assert from 'node:assert/strict';
import { createClient } from 'redis';
import { readFile } from 'node:fs/promises';

import { RepositorioAuditoria } from '../paquetes/auditoria/src/RepositorioAuditoria.js';
import { generarUuidV7Auditoria } from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import { AdaptadorAuditoriaSesionesFederacion } from '../paquetes/federacion/adaptadores/AdaptadorAuditoriaSesionesFederacion.js';
import { GeneradorSecretoPersistenteFederacion } from '../paquetes/federacion/adaptadores/GeneradorSecretoPersistenteFederacion.js';
import { VerificadorSecretoPersistenteFederacion } from '../paquetes/federacion/adaptadores/ProtectorSecretoPersistenteFederacion.js';
import { RepositorioCredencialesPersistentesFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioCredencialesPersistentesFederacionSql.js';
import { RepositorioSesionesFederacionRedis } from '../paquetes/federacion/adaptadores/RepositorioSesionesFederacionRedis.js';
import { RepositorioSesionesFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioSesionesFederacionSql.js';
import { ServicioSesionesFederacion } from '../paquetes/federacion/aplicacion/ServicioSesionesFederacion.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones } from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

const RELACION = `sfid1.relacion.${'g'.repeat(21)}w`;
const INSTALACION_LOCAL = `sfid1.instalacion.${'h'.repeat(21)}A`;
const INSTALACION_REMOTA = `sfid1.instalacion.${'i'.repeat(21)}Q`;
const BOOT = `sfid1.arranque.${'j'.repeat(21)}g`;
const BOOT_AJENO = `sfid1.arranque.${'k'.repeat(21)}w`;
const USUARIO = 915;
const PREFIJO = `sentinelia:fixture:52211f:${Date.now()}:${process.pid}`;
const ACTOR = Object.freeze({
  real: Object.freeze({ tipo: 'usuario', id: String(USUARIO) }),
  efectivo: null,
  modo: 'directo'
});

await main();

async function main() {
  await verificarRegistro();
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true, '5.22.11f requiere SQL local.');
  const sql = new ClienteSql(configuracion.sql);
  const redis = createClient({ url: configuracion.redis.url });
  redis.on('error', () => {});
  await redis.connect();
  try {
    await migrar(sql);
    await limpiarSql(sql);
    await limpiarRedis(redis);
    const secreto = await crearFixture(sql);
    await verificarCicloSesion(sql, redis, secreto);
  } finally {
    await limpiarRedis(redis);
    await redis.quit();
    await limpiarSql(sql);
    await sql.cerrar();
  }
  console.log(
    '[federacion] OK 5.22.11f: login=secreto_persistente redis=ttl ' +
    'refresh=solapamiento_controlado fencing=sql_monotono revocacion=inmediata ' +
    'perdida_redis=relogin'
  );
}

async function verificarRegistro() {
  const [openapi, rutas, factory] = await Promise.all([
    leer('../openapi/federacion-control.v1.yaml'),
    leer('../apps/sentinelia-web/src/rutas/crearRutasApiFederacion.js'),
    leer('../paquetes/federacion/aplicacion/crearPlanoControlFederacionLocal.js')
  ]);
  assert.match(openapi, /\/api\/federacion\/v1\/sesion\/login/u);
  assert.match(openapi, /\/api\/federacion\/v1\/sesion\/refresh/u);
  assert.doesNotMatch(openapi, /secretoPersistente:[\s\S]{0,100}(?:in:|readOnly:)/u);
  assert.match(rutas, /sesion\/login/u);
  assert.match(rutas, /sesion\/refresh/u);
  assert.match(factory, /ServicioSesionesFederacion/u);
}

async function verificarCicloSesion(sql, redis, secretoPersistente) {
  const verificadorSecretos = new VerificadorSecretoPersistenteFederacion();
  const repositorioCredenciales =
    new RepositorioCredencialesPersistentesFederacionSql(sql);
  const repositorioRedis = new RepositorioSesionesFederacionRedis({
    clienteRedis: redis,
    prefijo: PREFIJO,
    ttlSegundos: 60,
    graciaRefreshSegundos: 10
  });
  const repositorioSql = new RepositorioSesionesFederacionSql(sql, {
    repositorioCredenciales,
    verificadorSecretos,
    adaptadorAuditoria: new AdaptadorAuditoriaSesionesFederacion({
      repositorioAuditoria: new RepositorioAuditoria(sql)
    })
  });
  const servicio = new ServicioSesionesFederacion({
    repositorioSql,
    repositorioRedis,
    installationLocalId: INSTALACION_LOCAL
  });
  const loginRequestId = generarUuidV7Auditoria();
  const login = {
    relacionId: RELACION,
    installationEmisoraId: INSTALACION_REMOTA,
    bootEmisorId: BOOT,
    loginRequestId,
    nombreEmisorDeclarado: 'Emisora federada renombrada',
    secretoPersistente
  };
  await assert.rejects(
    () => servicio.login({
      ...login,
      secretoPersistente: `${secretoPersistente.slice(0, -1)}${
        secretoPersistente.endsWith('A') ? 'B' : 'A'
      }`
    }),
    /autenticación técnica/u
  );
  const primera = await servicio.login(login);
  assert.match(primera.sesion.token, /^sfop1_[A-Za-z0-9_-]{64}$/u);
  assert.equal(primera.requestId, loginRequestId);
  assert.equal((await sql.consultar(
    'SELECT nombre_remoto_declarado FROM relaciones_federacion WHERE relacion_id=?',
    [RELACION]
  ))[0].nombre_remoto_declarado, 'Emisora federada renombrada');
  assert.equal((await servicio.validarBearer(primera.sesion.token)).bootRemotoId, BOOT);
  const replayLogin = await servicio.login(login);
  assert.deepEqual(replayLogin, primera, 'El mismo request recupera exactamente el token original.');
  await assert.rejects(
    () => servicio.login({ ...login, bootEmisorId: BOOT_AJENO }),
    /otra intención/u
  );

  const segundo = await servicio.login({
    ...login,
    loginRequestId: generarUuidV7Auditoria()
  });
  assert.notEqual(segundo.sesion.token, primera.sesion.token);
  assert.ok(BigInt(segundo.sesion.fencingToken) > BigInt(primera.sesion.fencingToken));
  await assert.rejects(() => servicio.validarBearer(primera.sesion.token), /no está viva/u);
  await assert.rejects(
    () => servicio.login(login),
    (error) => error?.statusCode === 410,
    'El replay de un login sustituido no puede resucitar su token.'
  );

  const refreshRequestId = generarUuidV7Auditoria();
  const refresh = {
    token: segundo.sesion.token,
    relacionId: RELACION,
    sesionId: segundo.sesion.sessionId,
    bootEmisorId: BOOT,
    nombreEmisorDeclarado: 'Emisora federada renombrada',
    refreshRequestId
  };
  await assert.rejects(
    () => servicio.refresh({ ...refresh, bootEmisorId: BOOT_AJENO }),
    /no está viva/u
  );
  const renovada = await servicio.refresh(refresh);
  assert.equal(renovada.sesion.sessionId, segundo.sesion.sessionId);
  assert.notEqual(renovada.sesion.token, segundo.sesion.token);
  assert.ok(BigInt(renovada.sesion.fencingToken) > BigInt(segundo.sesion.fencingToken));
  const replayRefresh = await servicio.refresh(refresh);
  assert.deepEqual(replayRefresh, renovada);
  await assert.rejects(
    () => servicio.refresh({ ...refresh, refreshRequestId: generarUuidV7Auditoria() }),
    /no está viva/u
  );
  assert.equal((await servicio.validarBearer(renovada.sesion.token)).sesionId,
    segundo.sesion.sessionId);

  const revocacionesAntes = await contarEventos(sql, 'federacion.sesion_revocada');
  const solicitudRevocacion = {
    relacionId: RELACION,
    installationRemotaId: INSTALACION_REMOTA,
    requestId: generarUuidV7Auditoria(),
    actor: ACTOR
  };
  const revocada = await servicio.revocar(solicitudRevocacion);
  assert.ok(BigInt(revocada.fencingToken) > BigInt(renovada.sesion.fencingToken));
  const replayRevocacion = await servicio.revocar(solicitudRevocacion);
  assert.equal(replayRevocacion.fencingToken, revocada.fencingToken);
  assert.equal(await contarEventos(sql, 'federacion.sesion_revocada'), revocacionesAntes + 1);
  await assert.rejects(() => servicio.validarBearer(renovada.sesion.token), /no está viva/u);

  const trasRevocacion = await servicio.login({
    ...login,
    loginRequestId: generarUuidV7Auditoria()
  });
  assert.ok(BigInt(trasRevocacion.sesion.versionRevocacion) >
    BigInt(renovada.sesion.versionRevocacion));
  await limpiarRedis(redis);
  await assert.rejects(() => servicio.validarBearer(trasRevocacion.sesion.token), /no está viva/u);
  const trasPerdidaRedis = await servicio.login({
    ...login,
    loginRequestId: generarUuidV7Auditoria()
  });
  assert.ok(BigInt(trasPerdidaRedis.sesion.fencingToken) >
    BigInt(trasRevocacion.sesion.fencingToken));

  const requestIrrecuperable = generarUuidV7Auditoria();
  const respuestaIrrecuperable = await servicio.login({
    ...login,
    loginRequestId: requestIrrecuperable
  });
  await redis.del(repositorioRedis.claveReplay(RELACION, requestIrrecuperable));
  await assert.rejects(
    () => servicio.login({ ...login, loginRequestId: requestIrrecuperable }),
    (error) => error?.statusCode === 410
  );
  assert.equal(
    (await servicio.validarBearer(respuestaIrrecuperable.sesion.token)).relacionId,
    RELACION
  );

  const eventos = await sql.consultar(
    `SELECT tipo_evento,COUNT(*) AS total FROM eventos_auditoria
      WHERE sujeto_tipo='relacion_federada' AND sujeto_id=?
        AND tipo_evento IN ('federacion.sesion_iniciada','federacion.sesion_revocada')
      GROUP BY tipo_evento`,
    [RELACION]
  );
  const conteos = new Map(eventos.map((fila) => [fila.tipo_evento, Number(fila.total)]));
  assert.ok((conteos.get('federacion.sesion_iniciada') || 0) >= 5);
  assert.ok((conteos.get('federacion.sesion_revocada') || 0) >= 1);
  const [control] = await sql.consultar(
    'SELECT fencing_token,version_revocacion FROM estado_sesiones_federacion WHERE relacion_id=?',
    [RELACION]
  );
  assert.equal(String(control.fencing_token), respuestaIrrecuperable.sesion.fencingToken);
  assert.equal(String(control.version_revocacion), respuestaIrrecuperable.sesion.versionRevocacion);
  const [relacionFinal] = await sql.consultar(
    'SELECT estado_ciclo FROM relaciones_federacion WHERE relacion_id=?',
    [RELACION]
  );
  assert.equal(relacionFinal.estado_ciclo, 'pendienteAutenticacion');
  const sqlSaneado = JSON.stringify(await sql.consultar(
    `SELECT o.*,e.fencing_token,e.version_revocacion
       FROM operaciones_sesion_federacion o
       JOIN estado_sesiones_federacion e ON e.relacion_id=o.relacion_id
      WHERE o.relacion_id=?`,
    [RELACION]
  ));
  for (const token of [
    primera.sesion.token, segundo.sesion.token, renovada.sesion.token,
    trasRevocacion.sesion.token, trasPerdidaRedis.sesion.token,
    respuestaIrrecuperable.sesion.token
  ]) assert.equal(sqlSaneado.includes(token), false);
}

async function contarEventos(sql, tipo) {
  const [fila] = await sql.consultar(
    `SELECT COUNT(*) AS total FROM eventos_auditoria
      WHERE sujeto_tipo='relacion_federada' AND sujeto_id=? AND tipo_evento=?`,
    [RELACION, tipo]
  );
  return Number(fila.total);
}

async function crearFixture(sql) {
  await sql.ejecutar(
    `INSERT INTO usuarios (
       id,usuario,email,hash_password,activo,permiso_configurar_recepciones_federacion
     ) VALUES (?, ?, ?, 'fixture-no-login', 1, 1)`,
    [USUARIO, `fixture-fed-${USUARIO}`, `fixture-fed-${USUARIO}@invalid.local`]
  );
  const ahora = '2020-01-01 00:00:00.000';
  await sql.ejecutar(
    `INSERT INTO relaciones_federacion (
       relacion_id,direccion,estado_ciclo,estado_autoridad,estado_identidad,
       estado_compatibilidad,installation_remota_candidata_id,
       installation_remota_id,nombre_remoto_declarado,responsable_usuario_id,
       responsable_original_usuario_id,scope_tenant_id,scope_empresa_id,
       scope_sitio_id,version_autoridad,corte_autoridad_utc,
       creada_por_usuario_id,creada_en_utc,actualizada_en_utc,revision
     ) VALUES (
       ?,'recepcion','pendienteAutenticacion','autorizada','valida',NULL,?,?,
       'Emisor de sesión 11f',?,?,NULL,NULL,NULL,1,NULL,?,?,?,1
     )`,
    [
      RELACION, INSTALACION_REMOTA, INSTALACION_REMOTA,
      USUARIO, USUARIO, USUARIO, ahora, ahora
    ]
  );
  const secreto = new GeneradorSecretoPersistenteFederacion().generar();
  const repositorio = new RepositorioCredencialesPersistentesFederacionSql(sql);
  const conexion = await sql.obtenerConexion();
  try {
    await conexion.beginTransaction();
    await repositorio.guardarVerificadorReceptorEnTransaccion({
      relacionId: RELACION,
      installationLocalId: INSTALACION_LOCAL,
      installationRemotaId: INSTALACION_REMOTA,
      secreto,
      efectivoEnUtc: ahora
    }, {
      conexion,
      verificadorSecretos: new VerificadorSecretoPersistenteFederacion()
    });
    await conexion.commit();
  } catch (error) {
    await conexion.rollback();
    throw error;
  } finally {
    conexion.release();
  }
  return secreto;
}

async function migrar(sql) {
  const ejecutor = new EjecutorMigraciones({
    clienteSql: sql,
    repositorioMigraciones: new RepositorioMigraciones(sql),
    rutaMigraciones: obtenerRutaMigraciones()
  });
  await ejecutor.ejecutarPendientes();
  assert.equal((await ejecutor.ejecutarPendientes()).pendientesAplicadas, 0);
}

async function limpiarRedis(redis) {
  const claves = [];
  for await (const clave of redis.scanIterator({ MATCH: `${PREFIJO}:*`, COUNT: 100 })) {
    claves.push(clave);
  }
  if (claves.length) await redis.del(claves);
}

async function limpiarSql(sql) {
  await sql.ejecutar('DELETE FROM operaciones_sesion_federacion WHERE relacion_id=?', [RELACION]);
  await sql.ejecutar('DELETE FROM estado_sesiones_federacion WHERE relacion_id=?', [RELACION]);
  await sql.ejecutar('DELETE FROM credenciales_persistentes_federacion WHERE relacion_id=?', [RELACION]);
  await sql.ejecutar('DELETE FROM candidaturas_identidad_federacion WHERE relacion_id=?', [RELACION]);
  await sql.ejecutar('DELETE FROM invitaciones_establecimiento_federacion WHERE relacion_id=?', [RELACION]);
  await sql.ejecutar('DELETE FROM historico_estados_relaciones_federacion WHERE relacion_id=?', [RELACION]);
  await sql.ejecutar('DELETE FROM relaciones_federacion WHERE relacion_id=?', [RELACION]);
  await sql.ejecutar('DELETE FROM usuarios WHERE id=?', [USUARIO]);
}

function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}
