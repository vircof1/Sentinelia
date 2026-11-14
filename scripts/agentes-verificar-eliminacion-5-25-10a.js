import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createClient } from 'redis';

import { AdaptadorCoordinacionSesionesTecnicasAgentes }
  from '../paquetes/agentes/src/AdaptadorCoordinacionSesionesTecnicasAgentes.js';
import { ConsolidadorSesionesTecnicasAgentesSql }
  from '../paquetes/agentes/src/ConsolidadorSesionesTecnicasAgentesSql.js';
import { ProcesadorOperacionesSesionTecnicaAgentes }
  from '../paquetes/agentes/src/ProcesadorOperacionesSesionTecnicaAgentes.js';
import { ReconciliadorOperacionesSesionTecnicaAgentes }
  from '../paquetes/agentes/src/ReconciliadorOperacionesSesionTecnicaAgentes.js';
import {
  AutoridadRuntimeAgenteNoVigente,
  RepositorioFronteraRuntimeAgentesSql
} from '../paquetes/agentes/src/RepositorioFronteraRuntimeAgentesSql.js';
import { RepositorioOperacionesSesionAgentes }
  from '../paquetes/agentes/src/RepositorioOperacionesSesionAgentes.js';
import { RepositorioSesionesTecnicasCoordinadasRedis }
  from '../paquetes/agentes/src/RepositorioSesionesTecnicasCoordinadasRedis.js';
import { generarUuidV7Auditoria }
  from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import { CoordinadorOperacionesDurables }
  from '../paquetes/coordinacion-durable/src/CoordinadorOperacionesDurables.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones }
  from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

const TIPOS = Object.freeze(['login', 'refresh', 'heartbeat', 'lote']);
const RETARDO_BARRERA_MS = 80;

await main();

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true, '5.25.10a necesita MySQL real.');
  const baseDatos = `sentinelia_fixture_52510a_${randomBytes(6).toString('hex')}`;
  const administrador = new ClienteSql(configuracion.sql);
  await administrador.ejecutar(
    `CREATE DATABASE ${administrador.escaparIdentificador(baseDatos)} ` +
      'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
  );
  const sql = new ClienteSql({ ...configuracion.sql, baseDatos });
  const redis = createClient({ url: configuracion.redis.url });
  redis.on('error', () => {});
  const prefijoRedis = `sentinelia:fixture:52510a:${Date.now()}:${process.pid}:`;
  try {
    await redis.connect();
    await new EjecutorMigraciones({
      clienteSql: sql,
      repositorioMigraciones: new RepositorioMigraciones(sql),
      rutaMigraciones: obtenerRutaMigraciones()
    }).ejecutarPendientes();
    const scope = await crearScope(sql);
    const frontera = new RepositorioFronteraRuntimeAgentesSql(sql);
    await verificarFotografiaAutoridad(
      sql,
      frontera,
      await crearAgente(sql, scope, 'autoridad')
    );
    for (const tipo of TIPOS) {
      await verificarSolicitudGana(sql, frontera, await crearAgente(sql, scope, tipo), tipo);
      await verificarEliminacionGana(
        sql,
        frontera,
        await crearAgente(sql, scope, `${tipo}-tardia`),
        tipo
      );
    }
    await verificarReconciliacionHuerfana({
      sql,
      redis,
      prefijoRedis,
      scope,
      frontera
    });
    await verificarReconciliadorNoSolapaCiclos();
    console.log(
      '[agentes] OK 5.25.10a: login=serializado refresh=serializado ' +
      'heartbeat=serializado lote=serializado orden_solicitud_primero=probado ' +
      'orden_delete_primero=tipado reapariciones=0 invalidacion_huerfana=consolidada ' +
      'autoridad=identidad_scope_generacion_sesion reconciliador=periodico_sin_solape'
    );
  } finally {
    if (redis.isOpen) {
      await limpiarRedis(redis, prefijoRedis).catch(() => {});
      await redis.quit().catch(() => {});
    }
    await sql.cerrar();
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(baseDatos)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

async function verificarFotografiaAutoridad(sql, frontera, agente) {
  const casos = [
    [{ guid: randomUUID() }, 'identidad_agente_cambiada'],
    [{ sitioId: String(BigInt(agente.scope.sitioId) + 1n) }, 'scope_agente_cambiado'],
    [{ versionAutorizacionAgente: '2' }, 'autorizacion_agente_cambiada'],
    [{ sesionAuditoriaId: generarUuidV7Auditoria() }, 'sesion_agente_cambiada']
  ];
  for (const [cambio, motivo] of casos) {
    const conexion = await sql.obtenerConexion();
    try {
      await conexion.beginTransaction();
      await assert.rejects(
        frontera.bloquearYValidarEnTransaccion(
          { ...autoridadDe(agente), ...cambio },
          { conexion }
        ),
        (error) => error instanceof AutoridadRuntimeAgenteNoVigente &&
          error.motivo === motivo
      );
    } finally {
      await conexion.rollback().catch(() => {});
      conexion.release();
    }
  }
  await sql.ejecutar('DELETE FROM agentes_sentinelia WHERE id=?', [agente.id]);
}

async function verificarSolicitudGana(sql, frontera, agente, tipo) {
  const solicitud = await sql.obtenerConexion();
  try {
    await solicitud.beginTransaction();
    await frontera.bloquearYValidarEnTransaccion(
      autoridadDe(agente),
      { conexion: solicitud }
    );
    const borrado = borrarEnTransaccionNueva(sql, agente.id);
    await exigirPromesaBloqueada(borrado, `${tipo}: el DELETE debía esperar`);
    await persistirEfecto(solicitud, agente, tipo);
    await solicitud.commit();
    await borrado;
  } catch (error) {
    await solicitud.rollback().catch(() => {});
    throw error;
  } finally {
    solicitud.release();
  }
  await exigirSinReaparicion(sql, agente.id, `${tipo}:solicitud_primero`);
}

async function verificarEliminacionGana(sql, frontera, agente, tipo) {
  const eliminacion = await sql.obtenerConexion();
  const solicitud = await sql.obtenerConexion();
  try {
    await eliminacion.beginTransaction();
    await eliminacion.execute('DELETE FROM agentes_sentinelia WHERE id=?', [agente.id]);
    const tardia = (async () => {
      await solicitud.beginTransaction();
      try {
        await frontera.bloquearYValidarEnTransaccion(
          autoridadDe(agente),
          { conexion: solicitud }
        );
        await persistirEfecto(solicitud, agente, tipo);
        await solicitud.commit();
      } catch (error) {
        await solicitud.rollback().catch(() => {});
        throw error;
      }
    })();
    await exigirPromesaBloqueada(tardia, `${tipo}: la petición tardía debía esperar`);
    await eliminacion.commit();
    await assert.rejects(
      tardia,
      (error) => error instanceof AutoridadRuntimeAgenteNoVigente &&
        error.motivo === 'agente_eliminado'
    );
  } catch (error) {
    await eliminacion.rollback().catch(() => {});
    throw error;
  } finally {
    eliminacion.release();
    solicitud.release();
  }
  await exigirSinReaparicion(sql, agente.id, `${tipo}:delete_primero`);
}

async function verificarReconciliacionHuerfana({
  sql,
  redis,
  prefijoRedis,
  scope
}) {
  const agente = await crearAgente(sql, scope, 'reconciliacion');
  const repositorioOperaciones = new RepositorioOperacionesSesionAgentes(sql);
  const repositorioRedis = new RepositorioSesionesTecnicasCoordinadasRedis({
    clienteRedis: redis,
    prefijo: prefijoRedis
  });
  const proyecciones = new Map();
  const adaptador = new AdaptadorCoordinacionSesionesTecnicasAgentes({
    repositorioOperaciones,
    consolidadorSql: new ConsolidadorSesionesTecnicasAgentesSql()
  });
  const procesador = new ProcesadorOperacionesSesionTecnicaAgentes({
    coordinador: new CoordinadorOperacionesDurables({
      repositorio: adaptador,
      instanciaId: `fixture-52510a-${process.pid}`,
      ttlSegundos: 10
    }),
    adaptadorCoordinacion: adaptador,
    repositorioRedis,
    resolverProyeccionInicial: async (operacion) =>
      proyecciones.get(operacion.operacionId) ?? null
  });
  const login = await repositorioOperaciones.reservarRequestAtomica({
    tipo: 'login',
    operacionId: generarUuidV7Auditoria(),
    agenteId: agente.id,
    sesionAuditoriaId: generarUuidV7Auditoria(),
    loginRequestId: generarUuidV7Auditoria(),
    huellaIntencion: hash(`login:${agente.id}`),
    actor: { tipo: 'agente', id: agente.id },
    origen: 'api_agentes',
    scope
  });
  const token = `fixture-${login.operacionId}`;
  proyecciones.set(login.operacionId, {
    agenteId: login.agenteId,
    operacionId: login.operacionId,
    sesionAuditoriaId: login.sesionAuditoriaId,
    fencingToken: login.fencingToken,
    versionScopeAgente: login.versionScopeObservada,
    versionAutorizacionAgente: login.versionAutorizacionObservada,
    scope: login.scope,
    sessionId: `session-${login.operacionId}`,
    sessionTokenHash: hash(token).toString('hex'),
    estadoToken: 'actual',
    ttlSegundos: 30
  });
  const reconciliador = new ReconciliadorOperacionesSesionTecnicaAgentes({
    procesador,
    maximoPorCiclo: 10
  });
  await reconciliador.reconciliar();
  assert.equal((await repositorioOperaciones.buscarPorId(login.operacionId)).estado,
    'consolidada');
  assert.ok(await repositorioRedis.obtenerActual(agente.id));

  const invalidacion = await enTransaccion(sql, (conexion) =>
    repositorioOperaciones.crearInvalidacionEnTransaccion({
      tipo: 'invalidacion',
      operacionId: generarUuidV7Auditoria(),
      agenteId: agente.id,
      sesionAuditoriaId: login.sesionAuditoriaId,
      causaOperacionId: generarUuidV7Auditoria(),
      huellaIntencion: hash(`invalidacion:${agente.id}`),
      actor: { tipo: 'sistema', id: 'eliminacion_agente' },
      origen: 'runtime',
      scope
    }, { conexion })
  );
  await sql.ejecutar('DELETE FROM agentes_sentinelia WHERE id=?', [agente.id]);
  await reconciliador.reconciliar();
  assert.equal(
    (await repositorioOperaciones.buscarPorId(invalidacion.operacionId)).estado,
    'consolidada'
  );
  assert.equal(await repositorioRedis.obtenerActual(agente.id), null);
  await exigirSinReaparicion(sql, agente.id, 'reconciliacion_huerfana');
}

async function verificarReconciliadorNoSolapaCiclos() {
  let llamadas = 0;
  let liberar;
  const barrera = new Promise((resolve) => { liberar = resolve; });
  const reconciliador = new ReconciliadorOperacionesSesionTecnicaAgentes({
    procesador: {
      async procesarSiguiente() {
        llamadas += 1;
        await barrera;
        return null;
      }
    }
  });
  const primero = reconciliador.reconciliar();
  const segundo = reconciliador.reconciliar();
  assert.equal(primero, segundo);
  liberar();
  await primero;
  assert.equal(llamadas, 1);
}

async function persistirEfecto(conexion, agente, tipo) {
  if (tipo === 'login') {
    await conexion.execute(
      `UPDATE agentes_sentinelia SET ultimo_login_utc=UTC_TIMESTAMP(3)
        WHERE id=?`,
      [agente.id]
    );
    await insertarPol(conexion, agente.id, 'login');
    return;
  }
  if (tipo === 'refresh') {
    await conexion.execute(
      `UPDATE agentes_sentinelia SET fecha_actualizacion=UTC_TIMESTAMP(3)
        WHERE id=?`,
      [agente.id]
    );
    return;
  }
  if (tipo === 'heartbeat') {
    const periodoId = await insertarPol(conexion, agente.id, 'heartbeat');
    await conexion.execute(
      `UPDATE periodos_vida_pol_agentes
          SET heartbeats_recibidos=1, ultimo_seq=1,
              ultimo_heartbeat_utc=UTC_TIMESTAMP(3)
        WHERE id=?`,
      [periodoId]
    );
    await conexion.execute(
      `UPDATE agentes_sentinelia SET ultimo_heartbeat_utc=UTC_TIMESTAMP(3),
              ultimo_seq=1 WHERE id=?`,
      [agente.id]
    );
    return;
  }
  await conexion.execute(
    `INSERT INTO observaciones_telemetria_agentes (
       agente_id,senal_id,categoria,clave,tag,codigo_senal,tipo_dato,unidad,
       valor_booleano,observado_en_utc,recibido_en_utc
     ) VALUES (?,?,?,?,?,?, 'booleano','',1,UTC_TIMESTAMP(6),UTC_TIMESTAMP(6))`,
    [agente.id, agente.senalId, 'runtime', 'lote', '', 'runtime.lote:principal']
  );
}

async function insertarPol(conexion, agenteId, sufijo) {
  const [resultado] = await conexion.execute(
    `INSERT INTO periodos_vida_pol_agentes (agente_id,boot_id,inicio_utc)
     VALUES (?,?,UTC_TIMESTAMP(3))`,
    [agenteId, `boot-${sufijo}`]
  );
  return resultado.insertId;
}

async function crearScope(sql) {
  const sufijo = randomBytes(4).toString('hex');
  const [tenant] = await sql.ejecutar(
    'INSERT INTO tenants (nombre,alias) VALUES (?,?)',
    ['Tenant 5.25.10a', `t-52510a-${sufijo}`]
  );
  const [empresa] = await sql.ejecutar(
    'INSERT INTO empresas (tenant_id,nombre,alias) VALUES (?,?,?)',
    [tenant.insertId, 'Empresa 5.25.10a', `e-52510a-${sufijo}`]
  );
  const [sitio] = await sql.ejecutar(
    'INSERT INTO sitios (tenant_id,empresa_id,nombre,alias) VALUES (?,?,?,?)',
    [tenant.insertId, empresa.insertId, 'Sitio 5.25.10a', `s-52510a-${sufijo}`]
  );
  return Object.freeze({
    tenantId: String(tenant.insertId),
    empresaId: String(empresa.insertId),
    sitioId: String(sitio.insertId)
  });
}

async function crearAgente(sql, scope, etiqueta) {
  const guid = randomUUID();
  const [resultado] = await sql.ejecutar(
    `INSERT INTO agentes_sentinelia (
       guid,tenant_id,empresa_id,sitio_id,nombre,secreto_hash
     ) VALUES (?,?,?,?,?,?)`,
    [guid, scope.tenantId, scope.empresaId, scope.sitioId,
      `Agente ${etiqueta}`, 'hash-no-utilizable']
  );
  const id = String(resultado.insertId);
  const [senal] = await sql.ejecutar(
    `INSERT INTO senales_telemetria_agentes (
       agente_id,categoria,clave,tag,codigo_senal,tipo_dato,unidad,nombre_humano
     ) VALUES (?,?,?,?,?,'booleano','','Lote')`,
    [id, 'runtime', 'lote', '', 'runtime.lote:principal']
  );
  return Object.freeze({
    id,
    guid,
    senalId: String(senal.insertId),
    scope,
    versionSecreto: 1,
    versionScopeAgente: '1',
    versionAutorizacionAgente: '1'
  });
}

function autoridadDe(agente) {
  return {
    agenteId: agente.id,
    guid: agente.guid,
    tenantId: agente.scope.tenantId,
    empresaId: agente.scope.empresaId,
    sitioId: agente.scope.sitioId,
    versionSecreto: agente.versionSecreto,
    versionScopeAgente: agente.versionScopeAgente,
    versionAutorizacionAgente: agente.versionAutorizacionAgente,
    sesionAuditoriaId: null
  };
}

async function borrarEnTransaccionNueva(sql, agenteId) {
  const conexion = await sql.obtenerConexion();
  try {
    await conexion.beginTransaction();
    await conexion.execute(
      'SELECT id FROM agentes_sentinelia WHERE id=? FOR UPDATE',
      [agenteId]
    );
    await conexion.execute('DELETE FROM agentes_sentinelia WHERE id=?', [agenteId]);
    await conexion.commit();
  } catch (error) {
    await conexion.rollback().catch(() => {});
    throw error;
  } finally {
    conexion.release();
  }
}

async function exigirPromesaBloqueada(promesa, mensaje) {
  const resultado = await Promise.race([
    promesa.then(() => 'terminada', () => 'fallida'),
    new Promise((resolve) => setTimeout(() => resolve('bloqueada'), RETARDO_BARRERA_MS))
  ]);
  assert.equal(resultado, 'bloqueada', mensaje);
}

async function exigirSinReaparicion(sql, agenteId, contexto) {
  const [fila] = await sql.consultar(
    `SELECT
       (SELECT COUNT(*) FROM agentes_sentinelia WHERE id=?) raiz,
       (SELECT COUNT(*) FROM periodos_vida_pol_agentes WHERE agente_id=?) pol,
       (SELECT COUNT(*) FROM senales_telemetria_agentes WHERE agente_id=?) catalogo,
       (SELECT COUNT(*) FROM estado_actual_telemetria_agentes WHERE agente_id=?) foto,
       (SELECT COUNT(*) FROM observaciones_telemetria_agentes WHERE agente_id=?) observaciones`,
    [agenteId, agenteId, agenteId, agenteId, agenteId]
  );
  assert.deepEqual(
    Object.fromEntries(Object.entries(fila).map(([clave, valor]) => [clave, Number(valor)])),
    { raiz: 0, pol: 0, catalogo: 0, foto: 0, observaciones: 0 },
    contexto
  );
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

async function limpiarRedis(redis, prefijo) {
  let cursor = '0';
  do {
    const resultado = await redis.scan(cursor, { MATCH: `${prefijo}*`, COUNT: 100 });
    cursor = String(resultado.cursor);
    if (resultado.keys.length > 0) await redis.del(resultado.keys);
  } while (cursor !== '0');
}

function hash(texto) {
  return createHash('sha256').update(texto, 'utf8').digest();
}
