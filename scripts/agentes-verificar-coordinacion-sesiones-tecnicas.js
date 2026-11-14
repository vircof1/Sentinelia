import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createClient } from 'redis';
import { generarUuidV7Auditoria } from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import { RepositorioOperacionesSesionAgentes } from '../paquetes/agentes/src/RepositorioOperacionesSesionAgentes.js';
import { RepositorioSesionesTecnicasCoordinadasRedis } from '../paquetes/agentes/src/RepositorioSesionesTecnicasCoordinadasRedis.js';
import { ConsolidadorSesionesTecnicasAgentesSql } from '../paquetes/agentes/src/ConsolidadorSesionesTecnicasAgentesSql.js';
import { AdaptadorCoordinacionSesionesTecnicasAgentes } from '../paquetes/agentes/src/AdaptadorCoordinacionSesionesTecnicasAgentes.js';
import { ProcesadorOperacionesSesionTecnicaAgentes } from '../paquetes/agentes/src/ProcesadorOperacionesSesionTecnicaAgentes.js';
import { ProgramadorRetiradaSesionTecnicaAgentes } from '../paquetes/agentes/src/ProgramadorRetiradaSesionTecnicaAgentes.js';
import {
  ServicioVigenciaSesionesTecnicasAgentes,
  SesionTecnicaAgenteNoViva
} from '../paquetes/agentes/src/ServicioVigenciaSesionesTecnicasAgentes.js';
import { CoordinadorOperacionesDurables } from '../paquetes/coordinacion-durable/src/CoordinadorOperacionesDurables.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { obtenerConfiguracionAplicacion } from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

const sufijo = `${Date.now()}-${process.pid}`;
const prefijoRedis = `sentinelia:fixture:5215g:${sufijo}:`;
const creados = { tenantId: null, agenteId: null };
const proyecciones = new Map();

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true, 'La verificación de coordinación requiere SQL.');
  const clienteSql = new ClienteSql(configuracion.sql);
  const redis = createClient({ url: configuracion.redis.url });
  redis.on('error', () => {});
  await redis.connect();
  let errorPrincipal = null;
  try {
    const agente = await crearAgente(clienteSql);
    const repositorioOperaciones = new RepositorioOperacionesSesionAgentes(clienteSql);
    const repositorioRedis = new RepositorioSesionesTecnicasCoordinadasRedis({
      clienteRedis: redis,
      prefijo: prefijoRedis
    });
    const obligaciones = new RegistradorObligacionesFixture();
    const consolidador = new ConsolidadorSesionesTecnicasAgentesSql({
      registradorObligaciones: obligaciones
    });
    const adaptador = new AdaptadorCoordinacionSesionesTecnicasAgentes({
      repositorioOperaciones,
      consolidadorSql: consolidador
    });
    const coordinador = new CoordinadorOperacionesDurables({
      repositorio: adaptador,
      instanciaId: `fixture-5g-${process.pid}`,
      ttlSegundos: 10
    });
    const procesador = new ProcesadorOperacionesSesionTecnicaAgentes({
      coordinador,
      adaptadorCoordinacion: adaptador,
      repositorioRedis,
      resolverProyeccionInicial: async (operacion) => proyecciones.get(operacion.operacionId) ?? null
    });
    const procesadorConcurrente = new ProcesadorOperacionesSesionTecnicaAgentes({
      coordinador: new CoordinadorOperacionesDurables({
        repositorio: adaptador,
        instanciaId: `fixture-5g-b-${process.pid}`,
        ttlSegundos: 10
      }),
      adaptadorCoordinacion: adaptador,
      repositorioRedis,
      resolverProyeccionInicial: async (operacion) => proyecciones.get(operacion.operacionId) ?? null
    });

    const login = await reservarLogin(repositorioOperaciones, agente);
    const tokenLogin = registrarProyeccion(login);
    await verificarCaidaDespuesDeRedis(
      procesador,
      repositorioOperaciones,
      repositorioRedis,
      login
    );
    const finalLogin = await procesador.procesarSiguiente();
    assert.equal(finalLogin.estado, 'consolidada');
    assert.equal(finalLogin.liberarRespuesta, true);
    await verificarConsolidacionSql(clienteSql, login, obligaciones);
    const vigencia = crearServicioVigencia(clienteSql, repositorioRedis);
    await verificarVigenciaSinRenovacion(redis, repositorioRedis, vigencia, tokenLogin, agente.id);

    const refreshAjeno = await reservarRefresh(
      repositorioOperaciones,
      agente,
      generarUuidV7Auditoria()
    );
    const rechazoRefreshAjeno = await procesador.procesarSiguiente();
    assert.equal(rechazoRefreshAjeno.operacionId, refreshAjeno.operacionId);
    assert.equal(rechazoRefreshAjeno.estado, 'reemplazada');
    assert.equal((await repositorioRedis.obtenerActual(agente.id)).operacionId, login.operacionId);

    const refresh = await reservarRefresh(repositorioOperaciones, agente, login.sesionAuditoriaId);
    const tokenRefresh = registrarProyeccion(refresh);
    await procesarHastaTerminal(procesador, repositorioOperaciones, refresh.operacionId);
    await assert.rejects(() => vigencia.validarBearer(tokenLogin), SesionTecnicaAgenteNoViva);
    assert.equal((await vigencia.validarBearer(tokenRefresh)).sesionAuditoriaId, login.sesionAuditoriaId);

    await verificarEscritorAntiguo({
      repositorioOperaciones,
      repositorioRedis,
      procesador,
      procesadorConcurrente,
      agente
    });
    await verificarCaidaAntesDeRedis({ repositorioOperaciones, procesador, agente });
    await verificarInvalidacionYDiscordancia({
      clienteSql,
      repositorioOperaciones,
      repositorioRedis,
      procesador,
      agente
    });
    await verificarSqlSinMaterialSesion(clienteSql);
  } catch (error) {
    errorPrincipal = error;
  } finally {
    await limpiarRedis(redis);
    await redis.quit();
    await limpiarSql(clienteSql);
    await clienteSql.cerrar();
  }
  if (errorPrincipal) throw errorPrincipal;
  console.log('[agentes] OK: coordinador=comun fencing=atomico recuperacion=antes_y_despues_sql autoridad=versiones invalidacion=sin_replay bearer=solo_redis');
}

async function verificarCaidaDespuesDeRedis(
  procesador,
  repositorio,
  repositorioRedis,
  operacion
) {
  const preparada = await procesador.procesarSiguiente();
  assert.equal(preparada.operacionId, operacion.operacionId);
  assert.equal(preparada.estado, 'redis_preparada');
  assert.equal((await repositorio.buscarPorId(operacion.operacionId)).estado, 'redis_preparada');
  const actual = await repositorioRedis.obtenerActual(operacion.agenteId);
  const conflicto = await repositorioRedis.aplicar({
    agenteId: operacion.agenteId,
    operacionId: operacion.operacionId,
    sesionAuditoriaId: operacion.sesionAuditoriaId,
    fencingToken: operacion.fencingToken,
    proyeccion: { ...actual, sessionId: `${actual.sessionId}-alterada` },
    ttlSegundos: actual.ttlSegundos
  });
  assert.equal(conflicto.estado, 'conflicto_repeticion_payload');
  assert.equal((await repositorioRedis.obtenerActual(operacion.agenteId)).sessionId, actual.sessionId);
  const recuperada = await procesador.procesarSiguiente();
  assert.equal(recuperada.estado, 'respuesta_pendiente');
}

async function verificarConsolidacionSql(clienteSql, operacion, obligaciones) {
  const [agente] = await clienteSql.consultar(
    `SELECT sesion_auditoria_id, ultima_sesion_id_diagnostico,
            ultima_sesion_huella_sha256
       FROM agentes_sentinelia WHERE id = ?`,
    [operacion.agenteId]
  );
  assert.ok(agente.sesion_auditoria_id);
  assert.equal(agente.ultima_sesion_id_diagnostico, null);
  assert.equal(agente.ultima_sesion_huella_sha256, null);
  const [pol] = await clienteSql.consultar(
    `SELECT COUNT(*) AS total FROM periodos_vida_pol_agentes
      WHERE agente_id = ? AND sesion_auditoria_id = ? AND fin_utc IS NULL
        AND sesion_id_diagnostico IS NULL AND sesion_huella_sha256 IS NULL`,
    [operacion.agenteId, agente.sesion_auditoria_id]
  );
  assert.equal(Number(pol.total), 1);
  assert.equal(obligaciones.operaciones.includes(operacion.operacionId), true);
}

async function verificarVigenciaSinRenovacion(redis, repositorioRedis, servicio, token, agenteId) {
  const actual = await repositorioRedis.obtenerActual(agenteId);
  const clave = repositorioRedis.claveToken(actual.sessionTokenHash);
  const ttlAntes = await redis.ttl(clave);
  const contexto = await servicio.validarBearer(token);
  const ttlDespues = await redis.ttl(clave);
  assert.equal(contexto.agenteId, String(agenteId));
  assert.ok(ttlDespues <= ttlAntes, 'Autorizar no renueva TTL de sesión.');
}

async function verificarEscritorAntiguo({
  repositorioOperaciones,
  repositorioRedis,
  procesador,
  procesadorConcurrente,
  agente
}) {
  const antigua = await reservarLogin(repositorioOperaciones, agente);
  registrarProyeccion(antigua);
  const sucesora = await reservarLogin(repositorioOperaciones, agente);
  registrarProyeccion(sucesora);
  const resultados = await Promise.all([
    procesador.procesarSiguiente(),
    procesadorConcurrente.procesarSiguiente()
  ]);
  const reemplazada = resultados.find(({ operacionId }) => operacionId === antigua.operacionId);
  assert.equal(reemplazada.estado, 'reemplazada');
  await procesarHastaTerminal(procesador, repositorioOperaciones, sucesora.operacionId);
  const actual = await repositorioRedis.obtenerActual(agente.id);
  assert.equal(actual.operacionId, sucesora.operacionId);
  assert.equal(await repositorioRedis.retirarSiCoincide({
    agenteId: agente.id,
    operacionId: antigua.operacionId,
    fencingToken: antigua.fencingToken
  }), false);
  assert.equal((await repositorioRedis.obtenerActual(agente.id)).operacionId, sucesora.operacionId);
}

async function verificarCaidaAntesDeRedis({ repositorioOperaciones, procesador, agente }) {
  const operacion = await reservarLogin(repositorioOperaciones, agente);
  const terminal = await procesador.procesarSiguiente().catch((error) => error.resultado);
  assert.ok(terminal);
  assert.equal((await repositorioOperaciones.buscarPorId(operacion.operacionId)).estado, 'fallida');
}

async function verificarInvalidacionYDiscordancia({
  clienteSql,
  repositorioOperaciones,
  repositorioRedis,
  procesador,
  agente
}) {
  const login = await reservarLogin(repositorioOperaciones, agente);
  const token = registrarProyeccion(login);
  await procesarHastaTerminal(procesador, repositorioOperaciones, login.operacionId);
  const invalidacion = await crearInvalidacion(repositorioOperaciones, clienteSql, agente, login);
  assert.equal(invalidacion.loginRequestId, null);
  assert.equal(invalidacion.refreshRequestId, null);
  await procesarHastaTerminal(procesador, repositorioOperaciones, invalidacion.operacionId);
  assert.equal(await repositorioRedis.obtenerActual(agente.id), null);

  const nueva = await reservarLogin(repositorioOperaciones, agente);
  const tokenNuevo = registrarProyeccion(nueva);
  await procesarHastaTerminal(procesador, repositorioOperaciones, nueva.operacionId);
  await enTransaccion(clienteSql, (conexion) =>
    repositorioOperaciones.incrementarScopeYFencingEnTransaccion(agente.id, { conexion })
  );
  let programadas = 0;
  const programador = new ProgramadorRetiradaSesionTecnicaAgentes({
    repositorioOperaciones,
    async crearSiAusente({ sesionAuditoriaId }) {
      programadas += 1;
      return crearInvalidacion(
        repositorioOperaciones,
        clienteSql,
        agente,
        { sesionAuditoriaId }
      );
    }
  });
  const vigencia = crearServicioVigencia(clienteSql, repositorioRedis, programador);
  await assert.rejects(() => vigencia.validarBearer(tokenNuevo), SesionTecnicaAgenteNoViva);
  assert.equal(programadas, 1);
  assert.equal(await repositorioRedis.obtenerActual(agente.id), null);
  await assert.rejects(() => vigencia.validarBearer(token), SesionTecnicaAgenteNoViva);
}

function crearServicioVigencia(clienteSql, repositorioRedis, programadorInvalidacion = null) {
  return new ServicioVigenciaSesionesTecnicasAgentes({
    clienteSql,
    repositorioRedis,
    programadorInvalidacion
  });
}

async function procesarHastaTerminal(procesador, repositorio, operacionId) {
  for (let paso = 0; paso < 4; paso += 1) {
    const resultado = await procesador.procesarSiguiente();
    assert.equal(resultado.operacionId, operacionId);
    const operacion = await repositorio.buscarPorId(operacionId);
    if (['consolidada', 'reemplazada', 'fallida'].includes(operacion.estado)) return resultado;
  }
  throw new Error(`La operación ${operacionId} no alcanzó estado terminal.`);
}

async function reservarLogin(repositorio, agente) {
  const operacionId = generarUuidV7Auditoria();
  const entrada = datosBase(agente, {
    tipo: 'login',
    operacionId,
    sesionAuditoriaId: generarUuidV7Auditoria(),
    loginRequestId: registrarRequest(generarUuidV7Auditoria()),
    huellaIntencion: hashTexto(`login:${operacionId}`)
  });
  return repositorio.reservarRequestAtomica(entrada, { ventanaSegundos: 300 });
}

async function reservarRefresh(repositorio, agente, sesionAuditoriaId) {
  const operacionId = generarUuidV7Auditoria();
  return repositorio.reservarRequestAtomica(datosBase(agente, {
    tipo: 'refresh',
    operacionId,
    sesionAuditoriaId,
    refreshRequestId: registrarRequest(generarUuidV7Auditoria()),
    huellaIntencion: hashTexto(`refresh:${operacionId}`)
  }), { ventanaSegundos: 300 });
}

async function crearInvalidacion(repositorio, clienteSql, agente, sesion) {
  const operacionId = generarUuidV7Auditoria();
  return enTransaccion(clienteSql, (conexion) =>
    repositorio.crearInvalidacionEnTransaccion(datosBase(agente, {
      operacionId,
      sesionAuditoriaId: sesion.sesionAuditoriaId,
      causaOperacionId: generarUuidV7Auditoria(),
      huellaIntencion: hashTexto(`invalidacion:${operacionId}`)
    }), { conexion })
  );
}

function registrarProyeccion(operacion) {
  const token = `sat_fixture_${operacion.operacionId}`;
  const proyeccion = {
    agenteId: operacion.agenteId,
    operacionId: operacion.operacionId,
    sesionAuditoriaId: operacion.sesionAuditoriaId,
    fencingToken: operacion.fencingToken,
    versionScopeAgente: operacion.versionScopeObservada,
    versionAutorizacionAgente: operacion.versionAutorizacionObservada,
    scope: operacion.scope,
    sessionId: `ags_fixture_${operacion.operacionId}`,
    sessionTokenHash: hashTexto(token),
    estadoToken: 'actual',
    ttlSegundos: 30
  };
  proyecciones.set(operacion.operacionId, proyeccion);
  return token;
}

function datosBase(agente, datos) {
  return {
    agenteId: agente.id,
    actor: { tipo: 'sistema', id: 'prueba-5.21.5g' },
    origen: 'runtime',
    scope: agente.scope,
    ...datos
  };
}

class RegistradorObligacionesFixture {
  constructor() { this.operaciones = []; }
  async registrarEnTransaccion({ operacion }, { conexion }) {
    assert.equal(typeof conexion?.execute, 'function');
    this.operaciones.push(operacion.operacionId);
  }
}

async function crearAgente(clienteSql) {
  const alias = `sesion-5g-${sufijo}`.slice(0, 120);
  const [tenant] = await clienteSql.ejecutar(
    'INSERT INTO tenants (nombre, alias) VALUES (?, ?)',
    [`Tenant sesión 5g ${sufijo}`, alias]
  );
  creados.tenantId = String(tenant.insertId);
  const [empresa] = await clienteSql.ejecutar(
    'INSERT INTO empresas (tenant_id, nombre, alias) VALUES (?, ?, ?)',
    [creados.tenantId, `Empresa sesión 5g ${sufijo}`, alias]
  );
  const [sitio] = await clienteSql.ejecutar(
    'INSERT INTO sitios (tenant_id, empresa_id, nombre, alias) VALUES (?, ?, ?, ?)',
    [creados.tenantId, empresa.insertId, `Sitio sesión 5g ${sufijo}`, alias]
  );
  const [agente] = await clienteSql.ejecutar(
    `INSERT INTO agentes_sentinelia (
       guid, tenant_id, empresa_id, sitio_id, nombre, secreto_hash
     ) VALUES (?, ?, ?, ?, ?, ?)`,
    [generarUuidV7Auditoria(), creados.tenantId, empresa.insertId, sitio.insertId, `Agente 5g ${sufijo}`, 'hash-no-utilizable']
  );
  creados.agenteId = String(agente.insertId);
  return {
    id: creados.agenteId,
    scope: {
      tenantId: creados.tenantId,
      empresaId: String(empresa.insertId),
      sitioId: String(sitio.insertId)
    }
  };
}

async function verificarSqlSinMaterialSesion(clienteSql) {
  const columnas = await clienteSql.consultar(
    `SELECT COLUMN_NAME AS nombre FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'operaciones_sesion_agentes'`
  );
  assert.equal(
    columnas.some(({ nombre }) => /bearer|session_token|token_hash|material_validacion/i.test(nombre)),
    false
  );
}

async function limpiarSql(clienteSql) {
  const identidades = await clienteSql.consultar(
    `SELECT i.digest_request_id, i.operacion_id
       FROM identidades_request_id_sesion_agentes i
       JOIN operaciones_sesion_agentes o ON o.operacion_id = i.operacion_id
      WHERE o.actor_id = 'prueba-5.21.5g'`
  );
  const operaciones = await clienteSql.consultar(
    `SELECT operacion_id FROM operaciones_sesion_agentes WHERE actor_id = 'prueba-5.21.5g'`
  );
  if (operaciones.length) {
    const ids = operaciones.map(({ operacion_id }) => operacion_id);
    await clienteSql.ejecutar(
      `DELETE FROM identidades_request_id_sesion_agentes
        WHERE operacion_id IN (${ids.map(() => '?').join(', ')})`,
      ids
    );
    if (identidades.length) {
      await clienteSql.ejecutar(
        `DELETE FROM reservas_request_id_sesion_agentes
          WHERE digest_request_id IN (${identidades.map(() => '?').join(', ')})`,
        identidades.map(({ digest_request_id }) => digest_request_id)
      );
    }
    await clienteSql.ejecutar(
      `UPDATE operaciones_sesion_agentes
          SET estado = CASE WHEN estado = 'pendiente' THEN 'fallida' ELSE 'reemplazada' END,
              instancia_id = NULL, lease_token = NULL, lease_expira_utc = NULL,
              replay_cifrado_disponible = FALSE, key_id = NULL,
              terminada_en_utc = UTC_TIMESTAMP(3), actualizada_en_utc = UTC_TIMESTAMP(3)
        WHERE actor_id = 'prueba-5.21.5g'
          AND estado IN ('pendiente', 'redis_preparada', 'respuesta_pendiente')`
    );
    await clienteSql.ejecutar(
      `DELETE FROM operaciones_sesion_agentes WHERE actor_id = 'prueba-5.21.5g'`
    );
  }
  if (creados.agenteId) {
    await clienteSql.ejecutar(
      'DELETE FROM cabeceras_coordinacion_sesion_agentes WHERE agente_id = ?',
      [creados.agenteId]
    );
  }
  if (creados.tenantId) {
    await clienteSql.ejecutar('DELETE FROM tenants WHERE id = ?', [creados.tenantId]);
  }
}

async function limpiarRedis(redis) {
  const claves = [];
  for await (const clave of redis.scanIterator({ MATCH: `${prefijoRedis}*`, COUNT: 100 })) claves.push(clave);
  if (claves.length) await redis.del(claves);
}

async function enTransaccion(clienteSql, trabajo) {
  const conexion = await clienteSql.obtenerConexion();
  try {
    await conexion.beginTransaction();
    const resultado = await trabajo(conexion);
    await conexion.commit();
    return resultado;
  } catch (error) {
    try { await conexion.rollback(); } catch {}
    throw error;
  } finally {
    conexion.release();
  }
}

function registrarRequest(id) {
  return id;
}

function hashTexto(valor) {
  return createHash('sha256').update(String(valor)).digest('hex');
}

main().catch((error) => {
  console.error('[agentes] Falló la verificación de coordinación de sesiones');
  console.error(error);
  process.exitCode = 1;
});
