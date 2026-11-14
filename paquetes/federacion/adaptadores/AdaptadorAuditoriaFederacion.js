import {
  PERFIL_PAYLOAD_AUDITORIA_FEDERADA,
  VERSION_PAYLOAD_AUDITORIA_FEDERADA,
  crearPayloadAuditoriaFederadaDesdeVista,
  validarPayloadAuditoriaFederada
} from '../src/PayloadAuditoriaFederada.js';

export class AdaptadorAuditoriaFederacion {
  constructor({ repositorioLocal = null, repositorioRemoto = null } = {}) {
    if (repositorioLocal !== null && (
      typeof repositorioLocal?.prepararCapturaEnTransaccion !== 'function' ||
      typeof repositorioLocal?.listarCapturasEnTransaccion !== 'function' ||
      typeof repositorioLocal?.prepararRetiradaEnTransaccion !== 'function'
    )) {
      throw new Error('El productor local de auditoría federada está incompleto.');
    }
    if (repositorioRemoto !== null && (
      typeof repositorioRemoto?.materializarEnTransaccion !== 'function' ||
      typeof repositorioRemoto?.listarEventos !== 'function'
    )) {
      throw new Error('El repositorio remoto de auditoría está incompleto.');
    }
    this.repositorioLocal = repositorioLocal;
    this.repositorioRemoto = repositorioRemoto;
  }

  validarPayload(payload, contexto) {
    return validarPayloadAuditoriaFederada(payload, contexto);
  }

  crearPayloadDesdeVista(solicitud) {
    return crearPayloadAuditoriaFederadaDesdeVista(solicitud);
  }

  prepararCapturaEnTransaccion(solicitud, opciones) {
    return exigirLocal(this.repositorioLocal).prepararCapturaEnTransaccion(solicitud, opciones);
  }

  listarCapturasEnTransaccion(solicitud, opciones) {
    return exigirLocal(this.repositorioLocal).listarCapturasEnTransaccion(solicitud, opciones);
  }

  prepararRetiradaEnTransaccion(solicitud, opciones) {
    return exigirLocal(this.repositorioLocal).prepararRetiradaEnTransaccion(solicitud, opciones);
  }

  materializarEnTransaccion(solicitud, opciones) {
    return exigirRemoto(this.repositorioRemoto)
      .materializarEnTransaccion(solicitud, opciones);
  }

  listarEventos(filtros) {
    return exigirRemoto(this.repositorioRemoto).listarEventos(filtros);
  }
}

export function crearDefinicionAdaptadorAuditoriaFederacion({
  repositorioLocal = null,
  repositorioRemoto = null
} = {}) {
  const adaptador = new AdaptadorAuditoriaFederacion({ repositorioLocal, repositorioRemoto });
  const interfaces = { payload: adaptador };
  if (repositorioLocal) {
    interfaces.captura = adaptador;
    interfaces.fotografiaInicial = adaptador;
    interfaces.retirada = adaptador;
  }
  if (repositorioRemoto) interfaces.materializacion = adaptador;
  return Object.freeze({
    familia: 'auditoria',
    versionFamilia: VERSION_PAYLOAD_AUDITORIA_FEDERADA,
    perfilPayload: PERFIL_PAYLOAD_AUDITORIA_FEDERADA,
    productivo: Boolean(repositorioLocal && repositorioRemoto),
    interfaces: Object.freeze(interfaces)
  });
}

function exigirLocal(repositorio) {
  if (!repositorio) throw new Error('No hay productor local de auditoría federada.');
  return repositorio;
}

function exigirRemoto(repositorio) {
  if (!repositorio) throw new Error('No hay repositorio remoto de auditoría.');
  return repositorio;
}
