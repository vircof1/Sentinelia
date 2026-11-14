import { calcularHuellaSesionAgente } from './GeneradorSesionAgenteSentinelia.js';
import { validarUuidV7Auditoria } from '../../auditoria/src/UuidV7Auditoria.js';
import { errorCredencialesInvalidas } from './ErroresAutenticacionAgente.js';
import { SesionTecnicaAgenteNoViva } from './ServicioVigenciaSesionesTecnicasAgentes.js';
import { RespuestaSesionTecnicaNoRecuperable } from './CifradorReplaySesionTecnicaAgente.js';

export class RequestIdSesionTecnicaRequerido extends Error {
  constructor(tipo) {
    super(`${tipo === 'login' ? 'loginRequestId' : 'refreshRequestId'} es obligatorio.`);
    this.name = 'RequestIdSesionTecnicaRequerido';
    this.codigo = 'REQUEST_ID_SESION_REQUERIDO';
    this.statusCode = 400;
  }
}

export class ServicioReplaySesionesTecnicasAgentes {
  constructor({
    autenticarLogin,
    repositorioOperaciones,
    repositorioRedis,
    servicioVigencia,
    cifrador
  } = {}) {
    if (typeof autenticarLogin !== 'function' ||
        !repositorioOperaciones?.buscarPorRequestId ||
        !repositorioRedis?.obtenerReplay ||
        !repositorioRedis?.obtenerPorTokenHash ||
        !repositorioRedis?.obtenerActual ||
        !servicioVigencia?.validarBearer ||
        !cifrador?.descifrar) {
      throw new Error('El servicio de replay requiere autenticación, SQL, Redis y cifrado.');
    }
    this.autenticarLogin = autenticarLogin;
    this.repositorioOperaciones = repositorioOperaciones;
    this.repositorioRedis = repositorioRedis;
    this.servicioVigencia = servicioVigencia;
    this.cifrador = cifrador;
  }

  async recuperarLogin({ credenciales, loginRequestId } = {}) {
    const autenticada = await this.autenticarLogin(credenciales);
    if (!autenticada?.agenteId) throw errorCredencialesInvalidas();
    const requestId = requestIdObligatorio(loginRequestId, 'login');
    const localizada = await this.repositorioOperaciones.buscarPorRequestId(requestId);
    if (localizada.estado === 'ausente') return null;
    if (localizada.estado !== 'disponible') throw new RespuestaSesionTecnicaNoRecuperable();
    const operacion = localizada.operacion;
    if (operacion?.tipo !== 'login' || operacion.loginRequestId !== requestId ||
        operacion.agenteId !== String(autenticada.agenteId)) {
      throw errorCredencialesInvalidas();
    }
    const actual = await this.repositorioRedis.obtenerActual(operacion.agenteId);
    if (actual?.operacionId !== operacion.operacionId) {
      throw new RespuestaSesionTecnicaNoRecuperable();
    }
    return this.#recuperar(operacion, requestId);
  }

  async recuperarRefresh({ sessionToken, refreshRequestId } = {}) {
    let huella;
    try {
      if (typeof sessionToken !== 'string' || sessionToken.length === 0) throw new Error();
      huella = calcularHuellaSesionAgente(sessionToken);
    } catch {
      const error = errorCredencialesInvalidas();
      error.codigo = 'Unauthorized';
      throw error;
    }
    const indice = await this.repositorioRedis.obtenerPorTokenHash(huella);
    if (!indice || !['actual', 'solo_replay'].includes(indice.estadoToken)) {
      throw new SesionTecnicaAgenteNoViva();
    }
    if (indice.estadoToken === 'actual') {
      await this.servicioVigencia.validarBearer(sessionToken);
    }
    const requestId = requestIdObligatorio(refreshRequestId, 'refresh');
    if (indice.estadoToken === 'solo_replay' && indice.refreshRequestId !== requestId) {
      throw new SesionTecnicaAgenteNoViva();
    }
    if (indice.estadoToken === 'solo_replay') {
      const actual = await this.repositorioRedis.obtenerActual(indice.agenteId);
      if (actual?.operacionId !== indice.operacionId ||
          actual?.sesionAuditoriaId !== indice.sesionAuditoriaId) {
        throw new SesionTecnicaAgenteNoViva();
      }
    }
    const localizada = await this.repositorioOperaciones.buscarPorRequestId(requestId);
    if (localizada.estado === 'ausente') {
      if (indice.estadoToken === 'solo_replay') {
        throw new RespuestaSesionTecnicaNoRecuperable();
      }
      return null;
    }
    if (localizada.estado !== 'disponible') {
      throw new RespuestaSesionTecnicaNoRecuperable();
    }
    const operacion = localizada.operacion;
    const coincide = operacion?.tipo === 'refresh' &&
      operacion.refreshRequestId === requestId &&
      operacion.agenteId === String(indice.agenteId) &&
      operacion.sesionAuditoriaId === indice.sesionAuditoriaId &&
      operacion.operacionId === indice.operacionId;
    if (!coincide) throw new SesionTecnicaAgenteNoViva();
    return this.#recuperar(operacion, requestId);
  }

  async #recuperar(operacion, requestId) {
    if (operacion.estado !== 'consolidada') return null;
    const replay = await this.repositorioRedis.obtenerReplay(operacion.operacionId);
    if (!replay || replay.requestId !== requestId || replay.tipo !== operacion.tipo ||
        replay.agenteId !== operacion.agenteId ||
        replay.sesionAuditoriaId !== operacion.sesionAuditoriaId) {
      throw new RespuestaSesionTecnicaNoRecuperable();
    }
    return Object.freeze(this.cifrador.descifrar({
      aad: aadOperacion(operacion, requestId),
      sobre: replay.sobre
    }));
  }
}

export function prepararMaterialReplaySesionTecnica({
  operacion,
  proyeccion,
  respuesta,
  tokenAnterior = null,
  ttlSegundos = 300,
  cifrador
} = {}) {
  if (!operacion || !proyeccion || !cifrador?.cifrar) {
    throw new Error('No hay material suficiente para preparar el replay técnico.');
  }
  const requestId = requestIdOperacion(operacion);
  if (!respuesta || typeof respuesta !== 'object' || Array.isArray(respuesta) ||
      respuesta.requestId !== requestId ||
      typeof respuesta.sessionToken !== 'string' || respuesta.sessionToken.length === 0) {
    throw new Error('La respuesta debe contener el request id y el token nuevos exactos.');
  }
  if (calcularHuellaSesionAgente(respuesta.sessionToken) !== proyeccion.sessionTokenHash) {
    throw new Error('El token cifrado no coincide con la proyección Redis preparada.');
  }
  const replay = {
    tipo: operacion.tipo,
    requestId,
    ttlSegundos,
    sobre: cifrador.cifrar({ aad: aadOperacion(operacion, requestId), respuesta })
  };
  if (operacion.tipo === 'refresh') {
    if (typeof tokenAnterior !== 'string' || tokenAnterior.length === 0) {
      throw new Error('Refresh requiere el token anterior para su gracia de replay.');
    }
    replay.tokenAnteriorHash = calcularHuellaSesionAgente(tokenAnterior);
  }
  return Object.freeze({ proyeccion, replay: Object.freeze(replay) });
}

function aadOperacion(operacion, requestId) {
  return {
    agenteId: operacion.agenteId,
    operacionId: operacion.operacionId,
    requestId,
    sesionAuditoriaId: operacion.sesionAuditoriaId,
    tipo: operacion.tipo
  };
}

function requestIdOperacion(operacion) {
  if (operacion?.tipo === 'login') return requestIdObligatorio(operacion.loginRequestId, 'login');
  if (operacion?.tipo === 'refresh') return requestIdObligatorio(operacion.refreshRequestId, 'refresh');
  throw new Error('Solo login y refresh conservan replay.');
}

function requestIdObligatorio(valor, tipo) {
  if (valor === null || valor === undefined) throw new RequestIdSesionTecnicaRequerido(tipo);
  try {
    return validarUuidV7Auditoria(valor, tipo === 'login' ? 'loginRequestId' : 'refreshRequestId');
  } catch {
    throw new RequestIdSesionTecnicaRequerido(tipo);
  }
}
