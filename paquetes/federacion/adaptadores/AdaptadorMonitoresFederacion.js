import {
  PERFIL_PAYLOAD_MONITORES_FEDERACION,
  VERSION_PAYLOAD_MONITORES_FEDERACION,
  validarPayloadMonitoresFederacion
} from '../src/PayloadMonitoresFederacion.js';
import { OPERACIONES_CAPTURA_FEDERACION }
  from '../src/OperacionesCapturaTecnicaFederacion.js';

export class AdaptadorMonitoresFederacion {
  constructor({ repositorioLocal = null, repositorioRemoto = null } = {}) {
    if (repositorioLocal !== null && (
      typeof repositorioLocal?.prepararCapturaEnTransaccion !== 'function' ||
      typeof repositorioLocal?.prepararCapturasAdministracionEnTransaccion !== 'function' ||
      typeof repositorioLocal?.prepararCapturasRuntimeEnTransaccion !== 'function' ||
      typeof repositorioLocal?.listarCapturasEnTransaccion !== 'function' ||
      typeof repositorioLocal?.prepararRetiradaEnTransaccion !== 'function'
    )) {
      throw new Error('El adaptador de monitores requiere un productor local completo.');
    }
    if (repositorioRemoto !== null && (
      typeof repositorioRemoto?.materializarEnTransaccion !== 'function' ||
      typeof repositorioRemoto?.listarActuales !== 'function' ||
      typeof repositorioRemoto?.listarDefiniciones !== 'function' ||
      typeof repositorioRemoto?.listarFotografiasOperativas !== 'function' ||
      typeof repositorioRemoto?.listarEstadosActualesSeleccionables !== 'function' ||
      typeof repositorioRemoto?.listarAlertasSeleccionables !== 'function' ||
      typeof repositorioRemoto?.listarEventos !== 'function' ||
      typeof repositorioRemoto?.listarTramosHistoricos !== 'function' ||
      typeof repositorioRemoto?.listarRangosHistoricos !== 'function' ||
      typeof repositorioRemoto?.listarReferenciasTriggers !== 'function'
    )) {
      throw new Error('El adaptador de monitores requiere un repositorio remoto completo.');
    }
    this.repositorioLocal = repositorioLocal;
    this.repositorioRemoto = repositorioRemoto;
  }

  validarPayload(payload, contexto) {
    return validarPayloadMonitoresFederacion(payload, contexto);
  }

  prepararCapturaEnTransaccion(solicitud, opciones) {
    const operacion = solicitud?.operacionCapturaTecnica;
    if (operacion === OPERACIONES_CAPTURA_FEDERACION.MONITORES_RUNTIME) {
      return exigirRepositorio(this.repositorioLocal).prepararCapturasRuntimeEnTransaccion(
        solicitud.solicitud,
        opciones
      );
    }
    if (operacion === OPERACIONES_CAPTURA_FEDERACION.MONITORES_ADMINISTRACION) {
      return exigirRepositorio(this.repositorioLocal)
        .prepararCapturasAdministracionEnTransaccion(solicitud.solicitud, opciones);
    }
    if (operacion === OPERACIONES_CAPTURA_FEDERACION.MONITORES_RETIRADA) {
      return exigirRepositorio(this.repositorioLocal)
        .prepararRetiradaEnTransaccion(solicitud.solicitud, opciones);
    }
    return exigirRepositorio(this.repositorioLocal)
      .prepararCapturaEnTransaccion(solicitud, opciones);
  }

  prepararCapturasAdministracionEnTransaccion(solicitud, opciones) {
    return exigirRepositorio(this.repositorioLocal)
      .prepararCapturasAdministracionEnTransaccion(solicitud, opciones);
  }

  prepararCapturasRuntimeEnTransaccion(solicitud, opciones) {
    return exigirRepositorio(this.repositorioLocal)
      .prepararCapturasRuntimeEnTransaccion(solicitud, opciones);
  }

  capturarRuntimeEnTransaccion(solicitud, opciones) {
    return this.prepararCapturasRuntimeEnTransaccion(solicitud, opciones);
  }

  listarCapturasEnTransaccion(solicitud, opciones) {
    return exigirRepositorio(this.repositorioLocal)
      .listarCapturasEnTransaccion(solicitud, opciones);
  }

  prepararRetiradaEnTransaccion(solicitud, opciones) {
    return exigirRepositorio(this.repositorioLocal)
      .prepararRetiradaEnTransaccion(solicitud, opciones);
  }

  materializarEnTransaccion(solicitud, opciones) {
    return exigirRepositorioRemoto(this.repositorioRemoto)
      .materializarEnTransaccion(solicitud, opciones);
  }

  listarActuales(filtros) { return exigirRepositorioRemoto(this.repositorioRemoto).listarActuales(filtros); }
  listarDefiniciones(filtros) { return exigirRepositorioRemoto(this.repositorioRemoto).listarDefiniciones(filtros); }
  listarFotografiasOperativas(filtros) { return exigirRepositorioRemoto(this.repositorioRemoto).listarFotografiasOperativas(filtros); }
  listarEstadosActualesSeleccionables(filtros) { return exigirRepositorioRemoto(this.repositorioRemoto).listarEstadosActualesSeleccionables(filtros); }
  listarAlertasSeleccionables(filtros) { return exigirRepositorioRemoto(this.repositorioRemoto).listarAlertasSeleccionables(filtros); }
  listarEventos(filtros) { return exigirRepositorioRemoto(this.repositorioRemoto).listarEventos(filtros); }
  listarTramosHistoricos(filtros) { return exigirRepositorioRemoto(this.repositorioRemoto).listarTramosHistoricos(filtros); }
  listarRangosHistoricos(filtros) { return exigirRepositorioRemoto(this.repositorioRemoto).listarRangosHistoricos(filtros); }
  listarReferenciasTriggers(filtros) { return exigirRepositorioRemoto(this.repositorioRemoto).listarReferenciasTriggers(filtros); }
}

export function crearDefinicionAdaptadorMonitoresFederacion({
  repositorioLocal = null,
  repositorioRemoto = null
} = {}) {
  const adaptador = new AdaptadorMonitoresFederacion({ repositorioLocal, repositorioRemoto });
  const interfaces = { payload: adaptador };
  if (repositorioLocal) {
    interfaces.captura = adaptador;
    interfaces.fotografiaInicial = adaptador;
    interfaces.retirada = adaptador;
  }
  if (repositorioRemoto) interfaces.materializacion = adaptador;
  return Object.freeze({
    familia: 'monitores',
    versionFamilia: VERSION_PAYLOAD_MONITORES_FEDERACION,
    perfilPayload: PERFIL_PAYLOAD_MONITORES_FEDERACION,
    productivo: Boolean(repositorioLocal && repositorioRemoto),
    interfaces: Object.freeze(interfaces)
  });
}

function exigirRepositorio(repositorio) {
  if (!repositorio) {
    throw new Error('El adaptador de monitores no tiene productor local configurado.');
  }
  return repositorio;
}

function exigirRepositorioRemoto(repositorio) {
  if (!repositorio) {
    throw new Error('La materialización remota de monitores todavía no está configurada.');
  }
  return repositorio;
}
