import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { generarUuidV7Auditoria } from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import { crearKeyringSesionesTecnicasAgentesDesdeEntorno } from '../paquetes/agentes/src/KeyringSesionesTecnicasAgentes.js';
import { ServicioAutenticacionAgentes } from '../paquetes/agentes/src/ServicioAutenticacionAgentes.js';
import { ControladorApiAgentes } from '../apps/sentinelia-web/src/controladores/ControladorApiAgentes.js';

await verificarServicioExigeLoginRequestIdTrasAutenticar();
await verificarControladorPropagaYEcoaRequestIds();
await verificarOpenApiDeclaraContratoVivo();
await verificarEnvEjemploActivaKeyring();
await verificarAliasOperativoKeyring();

console.log('[agentes] OK: contrato=request_ids eco=estable precedencia=post_auth keyring=bootstrap openapi=actualizado');

async function verificarServicioExigeLoginRequestIdTrasAutenticar() {
  let consultasCredenciales = 0;
  let bloqueosLogin = 0;
  const servicio = new ServicioAutenticacionAgentes({
    repositorioAgentes: {
      async buscarCredencialesPorGuid() {
        consultasCredenciales += 1;
        return {
          id: 42,
          guid: '123e4567-e89b-42d3-a456-426614174000',
          tenantId: 1,
          empresaId: 2,
          sitioId: 3,
          estadoAdministrativo: 'activo',
          estadoAcceso: 'normal',
          secretoHash: 'hash-verificador'
        };
      },
      async liberarCuarentenaExpirada() {},
      async registrarLoginFallido() {
        throw new Error('No debe registrar fallo cuando el secreto es válido.');
      }
    },
    repositorioSesionesAgentesRedis: {
      async intentarBloquearLoginAgente() {
        bloqueosLogin += 1;
        throw new Error('No debe adquirir bloqueo sin loginRequestId válido.');
      }
    },
    compararSecreto: async () => true
  });

  await assert.rejects(
    () => servicio.autenticar({
      guid: '123e4567-e89b-42d3-a456-426614174000',
      secreto: 'secreto-correcto',
      bootId: 'boot-contrato',
      requerirRequestIdSesion: true
    }),
    (error) =>
      error.codigo === 'REQUEST_ID_SESION_REQUERIDO' &&
      error.statusCode === 400
  );

  assert.equal(consultasCredenciales, 2);
  assert.equal(bloqueosLogin, 0);
}

async function verificarControladorPropagaYEcoaRequestIds() {
  const loginRequestId = generarUuidV7Auditoria();
  const refreshRequestId = generarUuidV7Auditoria();
  const llamadas = [];
  const controlador = new ControladorApiAgentes({
    servicioAutenticacionAgentes: {
      async autenticar(datos) {
        llamadas.push({ metodo: 'autenticar', datos });
        return {
          loginRequestId: datos.loginRequestId,
          agente: agente(),
          sesion: {
            sessionId: 'ags_login',
            sessionToken: 'sat_login'
          },
          ttlSegundos: 900,
          periodoVidaPol: { id: 55 }
        };
      },
      async renovarSesion(datos) {
        llamadas.push({ metodo: 'renovarSesion', datos });
        return {
          obtenerRespuestaPublica() {
            return {
              agente: agente(),
              sesion: {
                sessionId: 'ags_refresh',
                sessionToken: 'sat_refresh',
                previousSessionId: datos.sessionIdActual,
                expiresInSeconds: 900,
                renewBeforeSeconds: 120
              },
              coordinacion: {},
              pol: { estadoVidaPol: 'vivo', periodoId: 55 }
            };
          }
        };
      }
    }
  });

  const respuestaLogin = crearRespuesta();
  await controlador.login(
    crearRequisicion({
      body: {
        guid: '123e4567-e89b-42d3-a456-426614174000',
        secreto: 'sa_verificador_'.padEnd(40, 'x'),
        loginRequestId,
        bootId: 'boot-login'
      }
    }),
    respuestaLogin
  );

  assert.equal(respuestaLogin.estado, 200);
  assert.equal(respuestaLogin.cuerpo.requestId, loginRequestId);
  assert.equal(llamadas[0].datos.loginRequestId, loginRequestId);
  assert.equal(llamadas[0].datos.requerirRequestIdSesion, true);

  const respuestaRefresh = crearRespuesta();
  await controlador.refresh(
    crearRequisicion({
      headers: { authorization: 'Bearer sat_login' },
      body: {
        refreshRequestId,
        sessionIdActual: 'ags_login',
        bootId: 'boot-login'
      }
    }),
    respuestaRefresh
  );

  assert.equal(respuestaRefresh.estado, 200);
  assert.equal(respuestaRefresh.cuerpo.requestId, refreshRequestId);
  assert.equal(llamadas[1].datos.refreshRequestId, refreshRequestId);
  assert.equal(llamadas[1].datos.requerirRequestIdSesion, true);
}

async function verificarOpenApiDeclaraContratoVivo() {
  const yaml = await readFile(new URL('../openapi/agentes.v1.yaml', import.meta.url), 'utf8');
  assert.match(yaml, /- loginRequestId/);
  assert.match(yaml, /- refreshRequestId/);
  assert.match(yaml, /SessionRequestId:/);
  assert.match(yaml, /REQUEST_ID_SESION_REQUERIDO/);
  assert.match(yaml, /SessionResponseGone:/);
  assert.match(yaml, /RESPUESTA_SESION_NO_RECUPERABLE/);
  assert.doesNotMatch(yaml, /requestId: "req_01K02X1A6W8P4J9TXB2B7W1H90"/);
  assert.doesNotMatch(yaml, /requestId: "req_01K02X1D6W8P4J9TXB2B7W1H93"/);
}

async function verificarEnvEjemploActivaKeyring() {
  const env = await readFile(new URL('../.env.ejemplo', import.meta.url), 'utf8');
  assert.match(
    env,
    /^AGENTES_SESION_KEYRING=\{"bootstrap-1":"REEMPLAZAR_POR_BASE64_CANONICO_DE_32_BYTES"\}$/m
  );
  /*
  assert.match(env, /^AGENTES_SESION_KEYRING=\{"desarrollo-2026-01":/m);
  */
  assert.match(env, /^AGENTES_SESION_KEY_ID_ACTIVA=bootstrap-1$/m);
}

async function verificarAliasOperativoKeyring() {
  const keyring = crearKeyringSesionesTecnicasAgentesDesdeEntorno({
    AGENTES_SESSION_KEYRING: '{"local-2026":"MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY="}',
    AGENTES_SESSION_KEY_ID_ACTIVA: 'local-2026'
  });
  assert.equal(keyring.keyIdActiva, 'local-2026');
  assert.deepEqual(keyring.listarIds(), ['local-2026']);

  const dobleCodificado = crearKeyringSesionesTecnicasAgentesDesdeEntorno({
    AGENTES_SESSION_KEYRING: '"{\\"debug-2026\\":\\"MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=\\"}"',
    AGENTES_SESSION_KEY_ID_ACTIVA: 'debug-2026'
  });
  assert.equal(dobleCodificado.keyIdActiva, 'debug-2026');
  assert.deepEqual(dobleCodificado.listarIds(), ['debug-2026']);

  const base64Suelto = crearKeyringSesionesTecnicasAgentesDesdeEntorno({
    AGENTES_SESSION_KEYRING: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
    AGENTES_SESSION_KEY_ID_ACTIVA: 'suelto-2026'
  });
  assert.equal(base64Suelto.keyIdActiva, 'suelto-2026');
  assert.deepEqual(base64Suelto.listarIds(), ['suelto-2026']);

  const base64JsonString = crearKeyringSesionesTecnicasAgentesDesdeEntorno({
    AGENTES_SESSION_KEYRING: '"MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY="',
    AGENTES_SESSION_KEY_ID_ACTIVA: 'string-2026'
  });
  assert.equal(base64JsonString.keyIdActiva, 'string-2026');
  assert.deepEqual(base64JsonString.listarIds(), ['string-2026']);

  const canonico = crearKeyringSesionesTecnicasAgentesDesdeEntorno({
    AGENTES_SESION_KEYRING: '{"canonico-2026":"MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY="}',
    AGENTES_SESION_KEY_ID_ACTIVA: 'canonico-2026',
    AGENTES_SESSION_KEYRING: '{"alias-2026":"YWJjZGVmMDEyMzQ1Njc4OWFiY2RlZjAxMjM0NQ=="}',
    AGENTES_SESSION_KEY_ID_ACTIVA: 'alias-2026'
  });
  assert.equal(canonico.keyIdActiva, 'canonico-2026');
  assert.deepEqual(canonico.listarIds(), ['canonico-2026']);
}

function crearRequisicion({ headers = {}, body = {} } = {}) {
  return {
    body,
    get(nombre) {
      return headers[String(nombre).toLowerCase()] || '';
    }
  };
}

function crearRespuesta() {
  return {
    estado: 200,
    cuerpo: null,
    status(estado) {
      this.estado = estado;
      return this;
    },
    json(cuerpo) {
      this.cuerpo = cuerpo;
      return this;
    }
  };
}

function agente() {
  return {
    id: 42,
    guid: '123e4567-e89b-42d3-a456-426614174000',
    nombre: 'Agente contrato',
    tenantId: 1,
    empresaId: 2,
    sitioId: 3,
    estadoAdministrativo: 'activo',
    estadoAcceso: 'normal'
  };
}
