import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createClient } from 'redis';
import { readFile } from 'node:fs/promises';

import { RepositorioAuditoria } from '../paquetes/auditoria/src/RepositorioAuditoria.js';
import {
  generarUuidV7Auditoria,
  uuidV7AuditoriaABytes
} from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import { AdaptadorAuditoriaSeguridadFederacion } from '../paquetes/federacion/adaptadores/AdaptadorAuditoriaSeguridadFederacion.js';
import { AdaptadorAuditoriaSesionesFederacion } from '../paquetes/federacion/adaptadores/AdaptadorAuditoriaSesionesFederacion.js';
import { GeneradorRecuperacionFederacion } from '../paquetes/federacion/adaptadores/GeneradorRecuperacionFederacion.js';
import { GeneradorSecretoPersistenteFederacion } from '../paquetes/federacion/adaptadores/GeneradorSecretoPersistenteFederacion.js';
import { VerificadorSecretoPersistenteFederacion } from '../paquetes/federacion/adaptadores/ProtectorSecretoPersistenteFederacion.js';
import { RepositorioConflictosIdentidadFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioConflictosIdentidadFederacionSql.js';
import { RepositorioContinuidadFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioContinuidadFederacionSql.js';
import { RepositorioCredencialesPersistentesFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioCredencialesPersistentesFederacionSql.js';
import { RepositorioSesionesFederacionRedis } from '../paquetes/federacion/adaptadores/RepositorioSesionesFederacionRedis.js';
import { RepositorioSesionesFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioSesionesFederacionSql.js';
import { ServicioConflictosIdentidadFederacion } from '../paquetes/federacion/aplicacion/ServicioConflictosIdentidadFederacion.js';
import { ServicioContinuidadFederacion } from '../paquetes/federacion/aplicacion/ServicioContinuidadFederacion.js';
import { ServicioSesionesFederacion } from '../paquetes/federacion/aplicacion/ServicioSesionesFederacion.js';
import {
  validarRepresentacionRecuperacionFederacion
} from '../paquetes/federacion/src/RecuperacionRelacionFederacion.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones } from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import { obtenerConfiguracionAplicacion, obtenerRutaMigraciones } from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

const R1 = `sfid1.relacion.${'p'.repeat(21)}A`;
const R2 = `sfid1.relacion.${'q'.repeat(21)}Q`;
const R3 = `sfid1.relacion.${'r'.repeat(21)}g`;
const R4 = `sfid1.relacion.${'y'.repeat(21)}Q`;
const LOCAL = `sfid1.instalacion.${'s'.repeat(21)}w`;
const REMOTA = `sfid1.instalacion.${'t'.repeat(21)}A`;
const OTRA = `sfid1.instalacion.${'u'.repeat(21)}Q`;
const CLON_NUEVA = `sfid1.instalacion.${'v'.repeat(21)}g`;
const BOOT1 = `sfid1.arranque.${'w'.repeat(21)}w`;
const BOOT2 = `sfid1.arranque.${'x'.repeat(21)}A`;
const USUARIO = 917;
const PREFIJO = `sentinelia:fixture:52211h:${Date.now()}:${process.pid}`;
const ACTOR = Object.freeze({
  real: Object.freeze({ tipo: 'usuario', id: String(USUARIO) }),
  efectivo: null,
  modo: 'directo'
});

async function main() {
  await verificarRegistro();
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true);
  const baseDatos = `sentinelia_fixture_52211h_${randomBytes(6).toString('hex')}`;
  const administrador = new ClienteSql(configuracion.sql);
  await administrador.ejecutar(
    `CREATE DATABASE ${administrador.escaparIdentificador(baseDatos)} ` +
    'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
  );
  const sql = new ClienteSql({ ...configuracion.sql, baseDatos });
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
    const secretoInicial = await crearFixture(sql);
    await verificarContinuidadYLocalizacion(sql, redis, secretoInicial);
    await verificarConflicto(sql, redis);
  } finally {
    await limpiar(sql, redis);
    await redis.quit();
    await sql.cerrar();
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(baseDatos)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
  console.log('[federacion] OK 5.22.11h: rotacion=irrepetible recuperacion=bilateral ' +
    'localizacion=aprobada clon=sospecha-cuarentena-resolucion resincronizacion=obligatoria');
}

async function verificarRegistro() {
  const [openapi, rutas] = await Promise.all([
    leer('../openapi/federacion-control.v1.yaml'),
    leer('../apps/sentinelia-web/src/rutas/crearRutasApiFederacion.js')
  ]);
  assert.throws(() => validarRepresentacionRecuperacionFederacion({
    perfil: 'sentinelia-federacion-recuperacion-v1',
    version: 1,
    destino: {
      origenPublico: 'https://receptor.invalid',
      installationId: LOCAL,
      relacionId: R1
    },
    recuperacionId: `sfrec1_${'A'.repeat(21)}B`,
    credencialTemporal: `sfrt1_${'A'.repeat(43)}`,
    expiraEnUtc: '2030-01-01T00:00:00.000Z'
  }), /recuperacionId/u);
  assert.match(openapi, /continuidad\/recuperacion\/canje/u);
  assert.match(openapi, /continuidad\/credencial\/rotacion/u);
  assert.match(rutas, /continuidad\/recuperacion\/canje/u);
}

async function verificarContinuidadYLocalizacion(sql, redis, secretoInicial) {
  const dependencias = crearDependencias(sql, redis);
  await assert.rejects(() => dependencias.continuidad.emitirRecuperacion({
    relacionId: R1,
    actor: { real: ACTOR.real, efectivo: { tipo: 'usuario', id: '918' }, modo: 'impersonacion' },
    eventoId: generarUuidV7Auditoria(), correlacionId: generarUuidV7Auditoria()
  }), /sesión humana directa/u);
  const sesion = await dependencias.sesiones.login({
    relacionId: R1, installationEmisoraId: REMOTA, bootEmisorId: BOOT1,
    loginRequestId: generarUuidV7Auditoria(), secretoPersistente: secretoInicial
  });
  const rotacionId = generarUuidV7Auditoria();
  const rotada = await dependencias.continuidad.rotarCredencial({
    token: sesion.sesion.token, relacionId: R1, sesionId: sesion.sesion.sessionId,
    bootEmisorId: BOOT1, solicitudRotacionId: rotacionId
  });
  assert.equal(rotada.estado, 'rotada');
  assert.equal(await verificarSecreto(dependencias.credenciales, secretoInicial), false);
  assert.equal(await verificarSecreto(dependencias.credenciales, rotada.secretoPersistente), true);
  await assert.rejects(() => dependencias.continuidad.rotarCredencial({
    token: sesion.sesion.token, relacionId: R1, sesionId: sesion.sesion.sessionId,
    bootEmisorId: BOOT1, solicitudRotacionId: rotacionId
  }), /sesión federada no está viva/u);
  const sesionRotada = await dependencias.sesiones.login({
    relacionId: R1, installationEmisoraId: REMOTA, bootEmisorId: BOOT1,
    loginRequestId: generarUuidV7Auditoria(), secretoPersistente: rotada.secretoPersistente
  });
  await assert.rejects(() => dependencias.continuidad.rotarCredencial({
    token: sesionRotada.sesion.token, relacionId: R1,
    sesionId: sesionRotada.sesion.sessionId, bootEmisorId: BOOT1,
    solicitudRotacionId: rotacionId
  }), (error) => error.statusCode === 410);

  const emisionId = generarUuidV7Auditoria();
  const emitida = await dependencias.continuidad.emitirRecuperacion({
    relacionId: R1, actor: ACTOR, eventoId: emisionId,
    correlacionId: emisionId, ttlSegundos: 900
  });
  const recuperada = await dependencias.continuidad.canjearRecuperacion({
    recuperacion: emitida.representacionTransportable,
    installationEmisoraId: REMOTA,
    bootEmisorId: BOOT2,
    solicitudCanjeId: generarUuidV7Auditoria()
  });
  assert.equal(recuperada.estado, 'recuperada');
  assert.equal(await verificarSecreto(dependencias.credenciales, rotada.secretoPersistente), false);
  assert.equal(await verificarSecreto(dependencias.credenciales, recuperada.secretoPersistente), true);
  await assert.rejects(() => dependencias.continuidad.canjearRecuperacion({
    recuperacion: emitida.representacionTransportable,
    installationEmisoraId: REMOTA,
    bootEmisorId: BOOT2,
    solicitudCanjeId: generarUuidV7Auditoria()
  }), /recuperación federada fue rechazada/u);

  const localizacionId = generarUuidV7Auditoria();
  const eventoPropuesta = generarUuidV7Auditoria();
  await assert.rejects(() => dependencias.continuidad.proponerLocalizacion({
    relacionId: R3, localizacionId: generarUuidV7Auditoria(),
    endpoint: 'https://hostil.example.test',
    actor: { real: { tipo: 'instancia_remota', id: REMOTA }, efectivo: null, modo: 'directo' },
    eventoId: generarUuidV7Auditoria(), correlacionId: generarUuidV7Auditoria()
  }), /contraparte autenticada/u);
  const localizacionAnteriorId = generarUuidV7Auditoria();
  await dependencias.continuidad.proponerLocalizacion({
    relacionId: R3, localizacionId: localizacionAnteriorId,
    endpoint: 'https://anterior.example.test',
    actor: { real: { tipo: 'instancia_remota', id: OTRA }, efectivo: null, modo: 'directo' },
    eventoId: generarUuidV7Auditoria(), correlacionId: generarUuidV7Auditoria()
  });
  await dependencias.continuidad.proponerLocalizacion({
    relacionId: R3, localizacionId, endpoint: 'https://nuevo.example.test',
    actor: { real: { tipo: 'instancia_remota', id: OTRA }, efectivo: null, modo: 'directo' },
    eventoId: eventoPropuesta, correlacionId: eventoPropuesta
  });
  const [anterior] = await sql.consultar(
    `SELECT estado FROM localizaciones_relaciones_federacion
      WHERE localizacion_id=?`,
    [uuidV7AuditoriaABytes(localizacionAnteriorId)]
  );
  assert.equal(anterior.estado, 'rechazada',
    'Una contraparte no puede mantener dos propuestas simultáneas elegibles.');
  const eventoAprobacion = generarUuidV7Auditoria();
  const aprobada = await dependencias.continuidad.aprobarLocalizacion({
    relacionId: R3, localizacionId, actor: ACTOR,
    eventoId: eventoAprobacion, correlacionId: eventoPropuesta
  });
  assert.deepEqual([aprobada.estado, aprobada.endpoint],
    ['activa', 'https://nuevo.example.test']);
}

async function verificarConflicto(sql, redis) {
  const auditoria = new AdaptadorAuditoriaSeguridadFederacion({
    repositorioAuditoria: new RepositorioAuditoria(sql)
  });
  const avisos = new AvisosFixture();
  const sesionesRedis = new RepositorioSesionesFederacionRedis({
    clienteRedis: redis, prefijo: PREFIJO, ttlSegundos: 60, graciaRefreshSegundos: 10
  });
  let ahora = Date.now();
  const servicio = new ServicioConflictosIdentidadFederacion({
    repositorio: new RepositorioConflictosIdentidadFederacionSql(sql, {
      adaptadorAuditoria: auditoria, servicioAvisos: avisos
    }),
    repositorioSesionesRedis: sesionesRedis,
    reloj: () => ahora
  });
  const primero = new Date(ahora - 5000).toISOString();
  const segundo = new Date(ahora).toISOString();
  const presencias = [
    { relacionId: R1, bootRemotoId: BOOT1, primeroObservadoEnUtc: primero, fencingToken: '1' },
    { relacionId: R2, bootRemotoId: BOOT2, primeroObservadoEnUtc: segundo, fencingToken: '1' }
  ];
  const reinicioMismaRelacion = await servicio.observar({
    installationRemotaId: REMOTA,
    presencias: [
      presencias[0],
      { ...presencias[1], relacionId: R1, fencingToken: '2' }
    ],
    consolidacionReinicioMs: 0
  });
  assert.equal(reinicioMismaRelacion.estado, 'sin_conflicto',
    'El fencing nuevo sustituye el pulso antiguo de la misma relación.');
  const sospecha = await servicio.observar({
    installationRemotaId: REMOTA, presencias, consolidacionReinicioMs: 1000
  });
  assert.equal(sospecha.estado, 'sospecha');
  assert.equal(avisos.gravedades.get(R1), 'advertencia');
  ahora += 1500;
  const conflicto = await servicio.observar({
    installationRemotaId: REMOTA, presencias, consolidacionReinicioMs: 1000
  });
  assert.equal(conflicto.estado, 'conflicto');
  assert.deepEqual([...conflicto.relacionesCuarentena].sort(), [R1, R2].sort());
  const estados = await sql.consultar(
    'SELECT relacion_id,estado_identidad FROM relaciones_federacion WHERE relacion_id IN (?,?)',
    [R1, R2]
  );
  assert.ok(estados.every((fila) => fila.estado_identidad === 'conflictiva'));
  assert.equal(avisos.gravedades.get(R2), 'critica');
  const evento = generarUuidV7Auditoria();
  await assert.rejects(() => servicio.resolver({
    incidenteId: conflicto.incidenteId,
    eventoId: generarUuidV7Auditoria(), correlacionId: generarUuidV7Auditoria(),
    actor: ACTOR, relacionesLegitimas: [R1], relacionesClon: [R2],
    relacionesNuevasClon: [], installationClonNuevaId: CLON_NUEVA
  }), /relación nueva inequívoca/u);
  const resuelto = await servicio.resolver({
    incidenteId: conflicto.incidenteId,
    eventoId: evento,
    correlacionId: evento,
    actor: ACTOR,
    relacionesLegitimas: [R1],
    relacionesClon: [R2],
    relacionesNuevasClon: [R4],
    installationClonNuevaId: CLON_NUEVA
  });
  assert.equal(resuelto.requiereResincronizacion, true);
  const finales = await sql.consultar(
    'SELECT relacion_id,estado_identidad FROM relaciones_federacion WHERE relacion_id IN (?,?)',
    [R1, R2]
  );
  assert.equal(finales.find((fila) => fila.relacion_id === R1).estado_identidad, 'valida');
  assert.equal(finales.find((fila) => fila.relacion_id === R2).estado_identidad, 'conflictiva');
  assert.equal(avisos.resueltas.has(R1), true);
  assert.equal(avisos.resueltas.has(R2), false,
    'La rama clon permanece señalada hasta reidentificación y resincronización.');
}

function crearDependencias(sql, redis) {
  const repositorioAuditoria = new RepositorioAuditoria(sql);
  const credenciales = new RepositorioCredencialesPersistentesFederacionSql(sql);
  const sesionesRedis = new RepositorioSesionesFederacionRedis({
    clienteRedis: redis, prefijo: PREFIJO, ttlSegundos: 60, graciaRefreshSegundos: 10
  });
  const sesiones = new ServicioSesionesFederacion({
    repositorioSql: new RepositorioSesionesFederacionSql(sql, {
      repositorioCredenciales: credenciales,
      verificadorSecretos: new VerificadorSecretoPersistenteFederacion(),
      adaptadorAuditoria: new AdaptadorAuditoriaSesionesFederacion({ repositorioAuditoria })
    }),
    repositorioRedis: sesionesRedis,
    installationLocalId: LOCAL
  });
  const continuidad = new ServicioContinuidadFederacion({
    repositorio: new RepositorioContinuidadFederacionSql(sql, {
      repositorioCredenciales: credenciales,
      verificadorSecretos: new VerificadorSecretoPersistenteFederacion(),
      adaptadorAuditoria: new AdaptadorAuditoriaSeguridadFederacion({ repositorioAuditoria })
    }),
    servicioSesiones: sesiones,
    repositorioSesionesRedis: sesionesRedis,
    generadorRecuperacion: new GeneradorRecuperacionFederacion(),
    generadorSecretoPersistente: new GeneradorSecretoPersistenteFederacion(),
    installationLocalId: LOCAL,
    resolverOrigenPublico: () => 'https://receptor.example.test'
  });
  return { credenciales, sesiones, continuidad };
}

async function crearFixture(sql) {
  await sql.ejecutar(`INSERT INTO usuarios (
    id,usuario,email,hash_password,activo,permiso_configurar_recepciones_federacion,
    permiso_configurar_emisiones_federacion,permiso_gestionar_credenciales_federacion,
    permiso_resolver_conflictos_federacion
  ) VALUES (?, ?, ?, 'fixture-no-login',1,1,1,1,1)`,
  [USUARIO, `fixture-fed-${USUARIO}`, `fixture-fed-${USUARIO}@invalid.local`]);
  await insertarRelacion(sql, R1, 'recepcion', REMOTA);
  await insertarRelacion(sql, R2, 'recepcion', REMOTA);
  await insertarRelacion(sql, R3, 'emision', OTRA);
  await insertarRelacion(sql, R4, 'recepcion', CLON_NUEVA);
  const secreto = new GeneradorSecretoPersistenteFederacion().generar();
  const conexion = await sql.obtenerConexion();
  try {
    await conexion.beginTransaction();
    await new RepositorioCredencialesPersistentesFederacionSql(sql)
      .guardarVerificadorReceptorEnTransaccion({
        relacionId: R1, installationLocalId: LOCAL,
        installationRemotaId: REMOTA, secreto, efectivoEnUtc: '2020-01-01 00:00:00.000'
      }, { conexion, verificadorSecretos: new VerificadorSecretoPersistenteFederacion() });
    await conexion.commit();
  } catch (error) {
    await conexion.rollback();
    throw error;
  } finally { conexion.release(); }
  return secreto;
}

async function insertarRelacion(sql, relacionId, direccion, installationId) {
  const ahora = '2020-01-01 00:00:00.000';
  await sql.ejecutar(`INSERT INTO relaciones_federacion (
    relacion_id,direccion,estado_ciclo,estado_autoridad,estado_identidad,
    estado_compatibilidad,installation_remota_candidata_id,installation_remota_id,
    nombre_remoto_declarado,responsable_usuario_id,responsable_original_usuario_id,
    scope_tenant_id,scope_empresa_id,scope_sitio_id,version_autoridad,corte_autoridad_utc,
    creada_por_usuario_id,creada_en_utc,actualizada_en_utc,revision
  ) VALUES (?,?,'vinculada','autorizada','valida','compatible',?,?,
    'Fixture continuidad',?,?,NULL,NULL,NULL,1,NULL,?,?,?,1)`,
  [relacionId, direccion, installationId, installationId,
    USUARIO, USUARIO, USUARIO, ahora, ahora]);
}

function verificarSecreto(repositorio, secreto) {
  return repositorio.verificarSecretoReceptor({
    relacionId: R1, installationLocalId: LOCAL,
    installationRemotaId: REMOTA, secreto
  }, { verificadorSecretos: new VerificadorSecretoPersistenteFederacion() });
}

class AvisosFixture {
  constructor() { this.gravedades = new Map(); this.resueltas = new Set(); }
  async detectar(entrada) {
    this.gravedades.set(entrada.claveCausal.relacionId,
      entrada.claveCausal.causaCodigo.startsWith('sospecha_') ? 'advertencia' : 'critica');
  }
  async cambiarGravedad(entrada) {
    this.gravedades.set(entrada.claveCausal.relacionId, entrada.gravedad);
  }
  async resolver(entrada) {
    if (entrada.claveCausal.causaCodigo === 'conflicto_identidad_instalacion') {
      this.resueltas.add(entrada.claveCausal.relacionId);
    }
  }
}

async function limpiar(sql, redis) {
  const claves = [];
  for await (const clave of redis.scanIterator({ MATCH: `${PREFIJO}:*`, COUNT: 100 })) claves.push(clave);
  if (claves.length) await redis.del(claves);
  await sql.ejecutar(
    'DELETE FROM relaciones_incidente_identidad_federacion WHERE relacion_id IN (?,?,?)',
    [R1, R2, R3]
  );
  await sql.ejecutar(
    'DELETE FROM incidentes_identidad_federacion WHERE installation_remota_id IN (?,?)',
    [REMOTA, OTRA]
  );
  for (const tabla of [
    'cortes_autoridad_federacion',
    'operaciones_credencial_federacion', 'recuperaciones_relacion_federacion',
    'localizaciones_relaciones_federacion', 'arranques_remotos_federacion',
    'estado_salud_relaciones_federacion', 'operaciones_sesion_federacion',
    'estado_sesiones_federacion', 'credenciales_persistentes_federacion',
    'candidaturas_identidad_federacion', 'invitaciones_establecimiento_federacion',
    'historico_estados_relaciones_federacion'
  ]) await sql.ejecutar(`DELETE FROM ${tabla} WHERE relacion_id IN (?,?,?,?)`, [R1, R2, R3, R4]);
  await sql.ejecutar('DELETE FROM relaciones_federacion WHERE relacion_id IN (?,?,?,?)',
    [R1, R2, R3, R4]);
  await sql.ejecutar('DELETE FROM usuarios WHERE id=?', [USUARIO]);
}

function leer(ruta) { return readFile(new URL(ruta, import.meta.url), 'utf8'); }

await main();
