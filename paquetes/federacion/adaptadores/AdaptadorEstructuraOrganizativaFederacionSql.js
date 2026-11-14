import {
  PERFIL_PAYLOAD_ESTRUCTURA_ORGANIZATIVA_FEDERACION,
  VERSION_PAYLOAD_ESTRUCTURA_ORGANIZATIVA_FEDERACION,
  validarPayloadEstructuraOrganizativaFederacion
} from '../src/PayloadEstructuraOrganizativaFederacion.js';
import { OPERACIONES_CAPTURA_FEDERACION }
  from '../src/OperacionesCapturaTecnicaFederacion.js';

export class AdaptadorEstructuraOrganizativaFederacionSql {
  constructor({ repositorio, repositorioLocal = null } = {}) {
    if (typeof repositorio?.materializarEnTransaccion !== 'function') {
      throw new Error('El adaptador organizativo requiere su repositorio remoto.');
    }
    if (repositorioLocal !== null && (
      typeof repositorioLocal?.prepararCapturaEnTransaccion !== 'function' ||
      typeof repositorioLocal?.listarCapturasEnTransaccion !== 'function' ||
      typeof repositorioLocal?.prepararRetiradaEnTransaccion !== 'function' ||
      typeof repositorioLocal?.prepararCapturasMovimientoEnTransaccion !== 'function'
    )) {
      throw new Error('El adaptador organizativo requiere su productor local completo.');
    }
    this.repositorio = repositorio;
    this.repositorioLocal = repositorioLocal;
  }

  validarPayload(payload, contexto) {
    return validarPayloadEstructuraOrganizativaFederacion(payload, contexto);
  }

  materializarEnTransaccion(solicitud, opciones) {
    return this.repositorio.materializarEnTransaccion(solicitud, opciones);
  }

  async prepararCapturaEnTransaccion(solicitud, opciones) {
    if (solicitud?.operacionCapturaTecnica ===
        OPERACIONES_CAPTURA_FEDERACION.ESTRUCTURA_MOVIMIENTO) {
      return this.#exigirRepositorioLocal().prepararCapturasMovimientoEnTransaccion(
        solicitud.solicitud,
        opciones
      );
    }
    if (solicitud?.operacionCapturaTecnica ===
        OPERACIONES_CAPTURA_FEDERACION.ESTRUCTURA_RETIRADA) {
      const resultado = await this.#exigirRepositorioLocal()
        .prepararRetiradaEnTransaccion(solicitud.solicitud, opciones);
      if (!Array.isArray(resultado?.retiradas)) {
        throw new Error(
          'El productor organizativo local devolvió una retirada inválida.'
        );
      }
      return resultado.retiradas;
    }
    return this.#exigirRepositorioLocal().prepararCapturaEnTransaccion(
      solicitud,
      opciones
    );
  }

  listarCapturasEnTransaccion(solicitud, opciones) {
    return this.#exigirRepositorioLocal().listarCapturasEnTransaccion(
      solicitud,
      opciones
    );
  }

  prepararRetiradaEnTransaccion(solicitud, opciones) {
    return this.#exigirRepositorioLocal().prepararRetiradaEnTransaccion(
      solicitud,
      opciones
    );
  }

  prepararCapturasMovimientoEnTransaccion(solicitud, opciones) {
    return this.#exigirRepositorioLocal().prepararCapturasMovimientoEnTransaccion(
      solicitud,
      opciones
    );
  }

  #exigirRepositorioLocal() {
    if (!this.repositorioLocal) {
      throw new Error('La producción organizativa local todavía no está configurada.');
    }
    return this.repositorioLocal;
  }
}

export function crearDefinicionAdaptadorEstructuraOrganizativaFederacion({
  repositorio,
  repositorioLocal = null
} = {}) {
  const adaptador = new AdaptadorEstructuraOrganizativaFederacionSql({
    repositorio,
    repositorioLocal
  });
  const interfaces = {
    payload: adaptador,
    materializacion: adaptador
  };
  if (repositorioLocal) {
    interfaces.captura = adaptador;
    interfaces.fotografiaInicial = adaptador;
    interfaces.retirada = adaptador;
  }
  return Object.freeze({
    familia: 'estructuraOrganizativa',
    versionFamilia: VERSION_PAYLOAD_ESTRUCTURA_ORGANIZATIVA_FEDERACION,
    perfilPayload: PERFIL_PAYLOAD_ESTRUCTURA_ORGANIZATIVA_FEDERACION,
    productivo: Boolean(repositorioLocal),
    interfaces: Object.freeze(interfaces)
  });
}
