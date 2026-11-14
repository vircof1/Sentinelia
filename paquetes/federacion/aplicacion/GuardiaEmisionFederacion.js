import {
  proyectarCapacidadesConfiguracionFederacion
} from '../src/ConfiguracionFederacion.js';

export class ErrorEmisionFederacionNoDisponible extends Error {
  constructor({ operacion, bloqueos } = {}) {
    super(
      'La emisión federada no está disponible por la configuración vigente del portal.'
    );
    this.name = 'ErrorEmisionFederacionNoDisponible';
    this.codigo = 'EMISION_FEDERACION_NO_DISPONIBLE';
    this.statusCode = 503;
    this.operacion = String(operacion || 'operacion_emisora');
    this.bloqueos = Object.freeze([...(bloqueos || [])]);
    Object.freeze(this);
  }
}

export class GuardiaEmisionFederacion {
  constructor({ servicioConfiguracionPortal } = {}) {
    if (typeof servicioConfiguracionPortal?.asegurarActualizada !== 'function') {
      throw new Error(
        'La guardia emisora federada requiere configuración de portal viva.'
      );
    }
    this.servicioConfiguracionPortal = servicioConfiguracionPortal;
    Object.freeze(this);
  }

  async evaluar() {
    const actualizada = await this.servicioConfiguracionPortal.asegurarActualizada();
    const configuracionPortal =
      typeof actualizada?.obtenerConfiguracionFederacion === 'function'
        ? actualizada
        : this.servicioConfiguracionPortal.obtenerConfiguracionActual?.();
    if (typeof configuracionPortal?.obtenerConfiguracionFederacion !== 'function') {
      throw new Error(
        'La guardia emisora no pudo obtener la configuración vigente del portal.'
      );
    }
    const configuracion = configuracionPortal.obtenerConfiguracionFederacion();
    const capacidades = proyectarCapacidadesConfiguracionFederacion(configuracion);
    return Object.freeze({ configuracionPortal, configuracion, capacidades });
  }

  async estaDisponible() {
    return (await this.evaluar()).capacidades.emisionDisponible;
  }

  async exigirDisponible(operacion = 'operacion_emisora') {
    const evaluacion = await this.evaluar();
    if (!evaluacion.capacidades.emisionDisponible) {
      throw new ErrorEmisionFederacionNoDisponible({
        operacion,
        bloqueos: evaluacion.capacidades.bloqueos.emision
      });
    }
    return evaluacion;
  }
}
