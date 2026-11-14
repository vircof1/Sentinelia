import {
  crearIdentidadFederada,
  TIPOS_IDENTIDAD_FEDERADA
} from '../src/IdentidadFederada.js';
import {
  proyectarCapacidadesConfiguracionFederacion
} from '../src/ConfiguracionFederacion.js';

export class ServicioDiagnosticoFederacionPortal {
  constructor({
    repositorio,
    servicioAutorizacion,
    servicioConfiguracionPortal = null
  } = {}) {
    if (typeof repositorio?.obtener !== 'function') {
      throw new Error('El diagnóstico federado requiere un repositorio de lectura.');
    }
    if (typeof servicioAutorizacion?.puedeVerDiagnosticoFederacion !== 'function') {
      throw new Error('El diagnóstico federado requiere autorización explícita.');
    }
    if (servicioConfiguracionPortal !== null &&
        typeof servicioConfiguracionPortal?.asegurarActualizada !== 'function') {
      throw new Error('El diagnóstico federado requiere configuración de portal viva.');
    }
    this.repositorio = repositorio;
    this.autorizacion = servicioAutorizacion;
    this.servicioConfiguracionPortal = servicioConfiguracionPortal;
  }

  async obtener(contextoUsuarioActual, { relacionId = null } = {}) {
    if (!this.autorizacion.puedeVerDiagnosticoFederacion(contextoUsuarioActual)) {
      throw errorEstado(403, 'diagnostico_federacion_no_autorizado',
        'No tienes permiso para ver el diagnóstico federado.');
    }
    const relacion = validarRelacionOpcional(relacionId);
    const resultado = await this.repositorio.obtener({
      scope: Object.freeze({
        nivel: contextoUsuarioActual?.nivelScope,
        tenantId: contextoUsuarioActual?.tenantId ?? null,
        empresaId: contextoUsuarioActual?.empresaId ?? null,
        sitioId: contextoUsuarioActual?.sitioId ?? null
      }),
      relacionId: relacion
    });
    if (relacion && !resultado.detalle) {
      throw errorEstado(404, 'relacion_diagnostico_no_visible',
        'La relación solicitada no existe dentro del scope visible.');
    }
    const capacidadesConfiguracion = await this.#obtenerCapacidadesConfiguracion();
    return Object.freeze({
      ...resultado,
      capacidadesConfiguracion,
      resumen: resumir(resultado.detalle)
    });
  }

  async #obtenerCapacidadesConfiguracion() {
    if (this.servicioConfiguracionPortal === null) return null;
    const portal = await this.servicioConfiguracionPortal.asegurarActualizada();
    return proyectarCapacidadesConfiguracionFederacion(
      portal.obtenerConfiguracionFederacion()
    );
  }
}

function resumir(detalle) {
  if (!detalle) {
    return Object.freeze({
      flujos: 0, generaciones: 0, huecosAbiertos: 0,
      divergenciasAbiertas: 0, restauracionesDetenidas: 0
    });
  }
  return Object.freeze({
    flujos: detalle.flujos.length,
    generaciones: detalle.generaciones.length,
    huecosAbiertos: detalle.huecos.filter((hueco) => !hueco.aplicadaAlCursor).length,
    divergenciasAbiertas: detalle.divergencias.filter((divergencia) =>
      ['abierta', 'esperandoResincronizacion'].includes(divergencia.estado)
    ).length,
    restauracionesDetenidas: detalle.huecos.filter((hueco) =>
      hueco.restauracionDetenida
    ).length
  });
}

function validarRelacionOpcional(valor) {
  const texto = String(valor ?? '').trim();
  if (!texto) return null;
  if (Buffer.byteLength(texto, 'utf8') > 64) {
    throw errorEstado(400, 'relacion_diagnostico_invalida',
      'La identidad de relación supera el límite permitido.');
  }
  try {
    return String(crearIdentidadFederada(texto, TIPOS_IDENTIDAD_FEDERADA.RELACION));
  } catch {
    throw errorEstado(400, 'relacion_diagnostico_invalida',
      'La identidad de relación no es válida.');
  }
}

function errorEstado(statusCode, codigo, mensaje) {
  const error = new Error(mensaje);
  error.statusCode = statusCode;
  error.codigo = codigo;
  return error;
}
