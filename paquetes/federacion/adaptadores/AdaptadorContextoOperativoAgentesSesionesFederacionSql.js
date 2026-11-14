import {
  PERFIL_PAYLOAD_CONTEXTO_OPERATIVO_AGENTES_SESIONES_FEDERACION,
  VERSION_PAYLOAD_CONTEXTO_OPERATIVO_AGENTES_SESIONES_FEDERACION,
  validarPayloadContextoOperativoAgentesSesionesFederacion
} from '../src/PayloadContextoOperativoAgentesSesionesFederacion.js';

export class AdaptadorContextoOperativoAgentesSesionesFederacionSql {
  constructor({ repositorio, repositorioLocal = null } = {}) {
    if (typeof repositorio?.materializarEnTransaccion !== 'function') {
      throw new Error('El adaptador de contexto de agentes requiere repositorio remoto.');
    }
    if (repositorioLocal !== null && (
      typeof repositorioLocal?.prepararCapturaEnTransaccion !== 'function' ||
      typeof repositorioLocal?.listarCapturasEnTransaccion !== 'function' ||
      typeof repositorioLocal?.prepararRetiradaEnTransaccion !== 'function'
    )) {
      throw new Error('El adaptador de contexto de agentes requiere productor local completo.');
    }
    this.repositorio = repositorio;
    this.repositorioLocal = repositorioLocal;
  }

  validarPayload(payload, contexto) {
    return validarPayloadContextoOperativoAgentesSesionesFederacion(payload, contexto);
  }
  materializarEnTransaccion(solicitud, opciones) {
    return this.repositorio.materializarEnTransaccion(solicitud, opciones);
  }
  prepararCapturaEnTransaccion(solicitud, opciones) {
    return this.#local().prepararCapturaEnTransaccion(solicitud, opciones);
  }
  listarCapturasEnTransaccion(solicitud, opciones) {
    return this.#local().listarCapturasEnTransaccion(solicitud, opciones);
  }
  prepararRetiradaEnTransaccion(solicitud, opciones) {
    return this.#local().prepararRetiradaEnTransaccion(solicitud, opciones);
  }
  #local() {
    if (!this.repositorioLocal) throw new Error('La producción local del contexto de agentes no está configurada.');
    return this.repositorioLocal;
  }
}

export function crearDefinicionAdaptadorContextoOperativoAgentesSesionesFederacion({
  repositorio,
  repositorioLocal = null
} = {}) {
  const adaptador = new AdaptadorContextoOperativoAgentesSesionesFederacionSql({
    repositorio, repositorioLocal
  });
  const interfaces = { payload: adaptador, materializacion: adaptador };
  if (repositorioLocal) {
    interfaces.captura = adaptador;
    interfaces.fotografiaInicial = adaptador;
    interfaces.retirada = adaptador;
  }
  return Object.freeze({
    familia: 'contextoOperativoAgentesSesiones',
    versionFamilia: VERSION_PAYLOAD_CONTEXTO_OPERATIVO_AGENTES_SESIONES_FEDERACION,
    perfilPayload: PERFIL_PAYLOAD_CONTEXTO_OPERATIVO_AGENTES_SESIONES_FEDERACION,
    productivo: Boolean(repositorioLocal),
    interfaces: Object.freeze(interfaces)
  });
}
