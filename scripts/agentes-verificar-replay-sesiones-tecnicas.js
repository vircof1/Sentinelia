import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { inspect } from 'node:util';
import { createClient } from 'redis';
import { generarUuidV7Auditoria } from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import { KeyringSesionesTecnicasAgentes } from '../paquetes/agentes/src/KeyringSesionesTecnicasAgentes.js';
import {
  CifradorReplaySesionTecnicaAgente,
  RespuestaSesionTecnicaNoRecuperable
} from '../paquetes/agentes/src/CifradorReplaySesionTecnicaAgente.js';
import { RepositorioSesionesTecnicasCoordinadasRedis } from '../paquetes/agentes/src/RepositorioSesionesTecnicasCoordinadasRedis.js';
import {
  RequestIdSesionTecnicaRequerido,
  ServicioReplaySesionesTecnicasAgentes,
  prepararMaterialReplaySesionTecnica
} from '../paquetes/agentes/src/ServicioReplaySesionesTecnicasAgentes.js';
import { SesionTecnicaAgenteNoViva } from '../paquetes/agentes/src/ServicioVigenciaSesionesTecnicasAgentes.js';
import { obtenerConfiguracionAplicacion } from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

const prefijo = `sentinelia:fixture:5215h:${Date.now()}-${process.pid}:`;

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();
  const redis = createClient({ url: configuracion.redis.url });
  redis.on('error', () => {});
  await redis.connect();
  try {
    await verificarKeyringYCifrado();
    await verificarReplayAtomico(redis);
  } finally {
    const claves = [];
    for await (const clave of redis.scanIterator({ MATCH: `${prefijo}*`, COUNT: 100 })) {
      claves.push(clave);
    }
    if (claves.length) await redis.del(claves);
    await redis.quit();
  }
  console.log('[agentes] OK: a256gcm=JCS keyring=renovable requestId=obligatorio refresh=solo_replay expiracion=atomica errores=401_403_410');
}

async function verificarKeyringYCifrado() {
  const antigua = randomBytes(32).toString('base64');
  const nueva = randomBytes(32).toString('base64');
  const keyringInicial = new KeyringSesionesTecnicasAgentes({
    keyring: { anterior: antigua },
    keyIdActiva: 'anterior'
  });
  assert.deepEqual(keyringInicial.toJSON(), {
    keyIdActiva: 'anterior',
    keyIds: ['anterior']
  });
  assert.equal(JSON.stringify(keyringInicial).includes(antigua), false);
  assert.equal(inspect(keyringInicial).includes(antigua), false);
  assert.throws(() => new KeyringSesionesTecnicasAgentes({
    keyring: { rota: randomBytes(31).toString('base64') },
    keyIdActiva: 'rota'
  }));

  const operacion = operacionBase('login');
  const aad = aadDe(operacion);
  const respuesta = { ok: true, sessionToken: 'sat_cifrado', requestId: operacion.loginRequestId };
  const cifradorInicial = new CifradorReplaySesionTecnicaAgente({ keyring: keyringInicial });
  const sobre = cifradorInicial.cifrar({ aad, respuesta });
  assert.equal(JSON.stringify(sobre).includes('sat_cifrado'), false);
  const keyringRotado = new KeyringSesionesTecnicasAgentes({
    keyring: { anterior: antigua, vigente: nueva },
    keyIdActiva: 'vigente'
  });
  const cifradorRotado = new CifradorReplaySesionTecnicaAgente({ keyring: keyringRotado });
  assert.deepEqual(cifradorRotado.descifrar({ aad, sobre }), respuesta);
  assert.throws(
    () => cifradorRotado.descifrar({ aad: { ...aad, operacionId: generarUuidV7Auditoria() }, sobre }),
    RespuestaSesionTecnicaNoRecuperable
  );
  const sinAnterior = new CifradorReplaySesionTecnicaAgente({
    keyring: new KeyringSesionesTecnicasAgentes({
      keyring: { vigente: nueva },
      keyIdActiva: 'vigente'
    })
  });
  assert.throws(() => sinAnterior.descifrar({ aad, sobre }), RespuestaSesionTecnicaNoRecuperable);
}

async function verificarReplayAtomico(redis) {
  const repositorioRedis = new RepositorioSesionesTecnicasCoordinadasRedis({
    clienteRedis: redis,
    prefijo
  });
  const cifrador = new CifradorReplaySesionTecnicaAgente({
    keyring: new KeyringSesionesTecnicasAgentes({
      keyring: { fixture: randomBytes(32).toString('base64') },
      keyIdActiva: 'fixture'
    })
  });
  const agenteId = '5215';
  const sesionAuditoriaId = generarUuidV7Auditoria();
  const login = operacionBase('login', { agenteId, sesionAuditoriaId, fencingToken: '1' });
  const tokenLogin = `sat_login_${login.operacionId}`;
  const respuestaLogin = { ok: true, sessionToken: tokenLogin, requestId: login.loginRequestId };
  const materialLogin = prepararMaterialReplaySesionTecnica({
    operacion: login,
    proyeccion: proyeccionDe(login, tokenLogin),
    respuesta: respuestaLogin,
    ttlSegundos: 20,
    cifrador
  });
  assert.equal((await repositorioRedis.aplicar({
    ...identidadAplicacion(login),
    proyeccion: materialLogin.proyeccion,
    replay: materialLogin.replay,
    ttlSegundos: 20
  })).aplicada, true);
  const repetidaLogin = await repositorioRedis.aplicar({
    ...identidadAplicacion(login),
    proyeccion: materialLogin.proyeccion,
    replay: materialLogin.replay,
    ttlSegundos: 20
  });
  assert.equal(repetidaLogin.repetida, true);
  const sobreAlterado = {
    ...materialLogin.replay,
    sobre: { ...materialLogin.replay.sobre, tag: randomBytes(16).toString('base64url') }
  };
  const conflicto = await repositorioRedis.aplicar({
    ...identidadAplicacion(login),
    proyeccion: materialLogin.proyeccion,
    replay: sobreAlterado,
    ttlSegundos: 20
  });
  assert.equal(conflicto.estado, 'conflicto_repeticion_replay');

  const operaciones = new Map([[login.loginRequestId, login]]);
  let consultas = 0;
  let autenticar = true;
  const servicio = new ServicioReplaySesionesTecnicasAgentes({
    autenticarLogin: async () => autenticar ? { agenteId } : null,
    repositorioOperaciones: {
      async buscarPorRequestId(requestId) {
        consultas += 1;
        return operaciones.has(requestId)
          ? { estado: 'disponible', operacion: operaciones.get(requestId) }
          : { estado: 'ausente', operacion: null };
      }
    },
    repositorioRedis,
    servicioVigencia: {
      async validarBearer(token) {
        const indice = await repositorioRedis.obtenerPorTokenHash(hash(token));
        if (indice?.estadoToken !== 'actual') throw new SesionTecnicaAgenteNoViva();
        return indice;
      }
    },
    cifrador
  });
  assert.deepEqual(await servicio.recuperarLogin({
    credenciales: {}, loginRequestId: login.loginRequestId
  }), respuestaLogin);
  const antesAuth = consultas;
  autenticar = false;
  await assert.rejects(
    () => servicio.recuperarLogin({ credenciales: {}, loginRequestId: null }),
    (error) => error.statusCode === 401
  );
  assert.equal(consultas, antesAuth, 'Login no consulta requestId antes de autenticar.');
  autenticar = true;
  await assert.rejects(
    () => servicio.recuperarLogin({ credenciales: {}, loginRequestId: null }),
    RequestIdSesionTecnicaRequerido
  );
  assert.equal(consultas, antesAuth, 'Un requestId ausente no consulta identidades.');

  const refresh = operacionBase('refresh', {
    agenteId,
    sesionAuditoriaId,
    fencingToken: '2'
  });
  operaciones.set(refresh.refreshRequestId, refresh);
  const tokenRefresh = `sat_refresh_${refresh.operacionId}`;
  const respuestaRefresh = {
    ok: true,
    sessionToken: tokenRefresh,
    requestId: refresh.refreshRequestId
  };
  const materialRefresh = prepararMaterialReplaySesionTecnica({
    operacion: refresh,
    proyeccion: proyeccionDe(refresh, tokenRefresh),
    respuesta: respuestaRefresh,
    tokenAnterior: tokenLogin,
    ttlSegundos: 20,
    cifrador
  });
  assert.equal((await repositorioRedis.aplicar({
    ...identidadAplicacion(refresh),
    proyeccion: materialRefresh.proyeccion,
    replay: materialRefresh.replay,
    ttlSegundos: 20
  })).aplicada, true);
  const anterior = await repositorioRedis.obtenerPorTokenHash(hash(tokenLogin));
  assert.equal(anterior.estadoToken, 'solo_replay');
  assert.equal(anterior.refreshRequestId, refresh.refreshRequestId);
  await assert.rejects(
    () => servicio.servicioVigencia.validarBearer(tokenLogin),
    SesionTecnicaAgenteNoViva
  );
  assert.deepEqual(await servicio.recuperarRefresh({
    sessionToken: tokenLogin,
    refreshRequestId: refresh.refreshRequestId
  }), respuestaRefresh);

  const antesDiscordancia = consultas;
  await assert.rejects(
    () => servicio.recuperarRefresh({
      sessionToken: tokenLogin,
      refreshRequestId: generarUuidV7Auditoria()
    }),
    SesionTecnicaAgenteNoViva
  );
  assert.equal(consultas, antesDiscordancia, 'solo_replay discordante no consulta otra operación.');

  await redis.del(repositorioRedis.claveReplay(refresh.operacionId));
  await assert.rejects(
    () => servicio.recuperarRefresh({
      sessionToken: tokenLogin,
      refreshRequestId: refresh.refreshRequestId
    }),
    RespuestaSesionTecnicaNoRecuperable
  );

  const refreshCorto = operacionBase('refresh', {
    agenteId,
    sesionAuditoriaId,
    fencingToken: '3'
  });
  const materialCorto = prepararMaterialReplaySesionTecnica({
    operacion: refreshCorto,
    proyeccion: proyeccionDe(refreshCorto, `sat_${refreshCorto.operacionId}`),
    respuesta: {
      ok: true,
      requestId: refreshCorto.refreshRequestId,
      sessionToken: `sat_${refreshCorto.operacionId}`
    },
    tokenAnterior: tokenRefresh,
    ttlSegundos: 1,
    cifrador
  });
  await repositorioRedis.aplicar({
    ...identidadAplicacion(refreshCorto),
    proyeccion: materialCorto.proyeccion,
    replay: materialCorto.replay,
    ttlSegundos: 20
  });
  await new Promise((resolve) => setTimeout(resolve, 1_100));
  assert.equal(await repositorioRedis.obtenerPorTokenHash(hash(tokenRefresh)), null);
  assert.equal(await repositorioRedis.obtenerReplay(refreshCorto.operacionId), null);
}

function operacionBase(tipo, cambios = {}) {
  const requestId = generarUuidV7Auditoria();
  return {
    agenteId: '1',
    estado: 'consolidada',
    fencingToken: '1',
    loginRequestId: tipo === 'login' ? requestId : null,
    operacionId: generarUuidV7Auditoria(),
    refreshRequestId: tipo === 'refresh' ? requestId : null,
    sesionAuditoriaId: generarUuidV7Auditoria(),
    tipo,
    versionAutorizacionObservada: '1',
    versionScopeObservada: '1',
    scope: { tenantId: '1', empresaId: '1', sitioId: '1' },
    ...cambios
  };
}

function proyeccionDe(operacion, token) {
  return {
    agenteId: operacion.agenteId,
    estadoToken: 'actual',
    fencingToken: operacion.fencingToken,
    operacionId: operacion.operacionId,
    scope: operacion.scope,
    sesionAuditoriaId: operacion.sesionAuditoriaId,
    sessionId: `ags_${operacion.operacionId}`,
    sessionTokenHash: hash(token),
    ttlSegundos: 20,
    versionAutorizacionAgente: operacion.versionAutorizacionObservada,
    versionScopeAgente: operacion.versionScopeObservada
  };
}

function identidadAplicacion(operacion) {
  return {
    agenteId: operacion.agenteId,
    operacionId: operacion.operacionId,
    sesionAuditoriaId: operacion.sesionAuditoriaId,
    fencingToken: operacion.fencingToken
  };
}

function aadDe(operacion) {
  return {
    agenteId: operacion.agenteId,
    operacionId: operacion.operacionId,
    requestId: operacion.loginRequestId ?? operacion.refreshRequestId,
    sesionAuditoriaId: operacion.sesionAuditoriaId,
    tipo: operacion.tipo
  };
}

function hash(valor) {
  return createHash('sha256').update(valor).digest('hex');
}

main().catch((error) => {
  console.error('[agentes] Falló la verificación de replay de sesiones');
  console.error(error);
  process.exitCode = 1;
});
