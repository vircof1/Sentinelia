import {
  PERFIL_PAYLOAD_TELEMETRIA_FEDERACION,
  VERSION_PAYLOAD_TELEMETRIA_FEDERACION,
  validarPayloadTelemetriaFederacion
} from '../src/PayloadTelemetriaFederacion.js';
import { OPERACIONES_CAPTURA_TECNICA_FEDERACION }
  from '../src/OperacionesCapturaTecnicaFederacion.js';

export class AdaptadorTelemetriaFederacion {
  constructor({
    repositorioLocal = null,
    repositorioRemoto = null,
    permitirMomentoUtcRelativo = false
  } = {}) {
    if (repositorioLocal !== null && (
      typeof repositorioLocal?.prepararCapturaEnTransaccion !== 'function' ||
      typeof repositorioLocal?.prepararCapturasIngestaEnTransaccion !== 'function' ||
      typeof repositorioLocal?.listarCapturasEnTransaccion !== 'function' ||
      typeof repositorioLocal?.prepararRetiradaEnTransaccion !== 'function'
    )) {
      throw new Error('El adaptador de telemetría requiere un productor local completo.');
    }
    if (repositorioRemoto !== null && (
      typeof repositorioRemoto?.materializarEnTransaccion !== 'function' ||
      typeof repositorioRemoto?.listarActuales !== 'function' ||
      typeof repositorioRemoto?.listarObservaciones !== 'function' ||
      typeof repositorioRemoto?.listarEstadosSenalSeleccionables !== 'function' ||
      typeof repositorioRemoto?.listarEstadosPolSeleccionables !== 'function' ||
      typeof repositorioRemoto?.listarRangosHistoricos !== 'function'
    )) {
      throw new Error('El adaptador de telemetría requiere un repositorio remoto completo.');
    }
    this.repositorioLocal = repositorioLocal;
    this.repositorioRemoto = repositorioRemoto;
    this.permitirMomentoUtcRelativo = Boolean(permitirMomentoUtcRelativo);
  }

  validarPayload(payload, contexto) {
    return validarPayloadTelemetriaFederacion(payload, {
      ...contexto,
      permitirMomentoUtcRelativo: this.permitirMomentoUtcRelativo
    });
  }

  prepararCapturaEnTransaccion(solicitud, opciones) {
    if (
      solicitud?.operacionCapturaTecnica ===
      OPERACIONES_CAPTURA_TECNICA_FEDERACION.TELEMETRIA_INGESTA
    ) {
      return this.#local().prepararCapturasIngestaEnTransaccion(
        solicitud.solicitud,
        opciones
      );
    }
    return this.#local().prepararCapturaEnTransaccion(solicitud, opciones);
  }

  prepararCapturasIngestaEnTransaccion(solicitud, opciones) {
    return this.#local().prepararCapturasIngestaEnTransaccion(solicitud, opciones);
  }

  capturarIngestaEnTransaccion(solicitud, opciones) {
    return this.prepararCapturasIngestaEnTransaccion(solicitud, opciones);
  }

  listarCapturasEnTransaccion(solicitud, opciones) {
    return this.#local().listarCapturasEnTransaccion(solicitud, opciones);
  }

  prepararRetiradaEnTransaccion(solicitud, opciones) {
    return this.#local().prepararRetiradaEnTransaccion(solicitud, opciones);
  }

  materializarEnTransaccion(solicitud, opciones) {
    return this.#remoto().materializarEnTransaccion(solicitud, opciones);
  }

  listarActuales(filtros) {
    return this.#remoto().listarActuales(filtros);
  }

  listarObservaciones(filtros) {
    return this.#remoto().listarObservaciones(filtros);
  }

  listarEstadosSenalSeleccionables(filtros) {
    return this.#remoto().listarEstadosSenalSeleccionables(filtros);
  }

  listarEstadosPolSeleccionables(filtros) {
    return this.#remoto().listarEstadosPolSeleccionables(filtros);
  }

  listarRangosHistoricos(filtros) {
    return this.#remoto().listarRangosHistoricos(filtros);
  }

  #local() {
    if (!this.repositorioLocal) {
      throw new Error('La producción local de telemetría todavía no está configurada.');
    }
    return this.repositorioLocal;
  }

  #remoto() {
    if (!this.repositorioRemoto) {
      throw new Error('La materialización remota de telemetría todavía no está configurada.');
    }
    return this.repositorioRemoto;
  }
}

export function crearDefinicionAdaptadorTelemetriaFederacion({
  repositorioLocal = null,
  repositorioRemoto = null,
  permitirMomentoUtcRelativo = false
} = {}) {
  const adaptador = new AdaptadorTelemetriaFederacion({
    repositorioLocal,
    repositorioRemoto,
    permitirMomentoUtcRelativo
  });
  const interfaces = { payload: adaptador };
  if (repositorioLocal) {
    interfaces.captura = adaptador;
    interfaces.fotografiaInicial = adaptador;
    interfaces.retirada = adaptador;
  }
  if (repositorioRemoto) interfaces.materializacion = adaptador;
  return Object.freeze({
    familia: 'telemetria',
    versionFamilia: VERSION_PAYLOAD_TELEMETRIA_FEDERACION,
    perfilPayload: PERFIL_PAYLOAD_TELEMETRIA_FEDERACION,
    productivo: Boolean(repositorioLocal && repositorioRemoto),
    interfaces: Object.freeze(interfaces)
  });
}
