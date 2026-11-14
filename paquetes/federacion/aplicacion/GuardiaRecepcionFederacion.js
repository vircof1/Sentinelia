import {
  proyectarCapacidadesConfiguracionFederacion
} from '../src/ConfiguracionFederacion.js';

export class ErrorRecepcionFederacionNoPreparada extends Error {
  constructor({ operacion, bloqueos } = {}) {
    super(
      'La recepción federada no está preparada por la configuración vigente del portal.'
    );
    this.name = 'ErrorRecepcionFederacionNoPreparada';
    this.codigo = 'RECEPCION_FEDERACION_NO_PREPARADA';
    this.statusCode = 503;
    this.operacion = String(operacion || 'operacion_receptora');
    this.bloqueos = Object.freeze([...(bloqueos || [])]);
    Object.freeze(this);
  }
}

export class GuardiaRecepcionFederacion {
  constructor({ servicioConfiguracionPortal } = {}) {
    if (typeof servicioConfiguracionPortal?.asegurarActualizada !== 'function') {
      throw new Error(
        'La guardia receptora federada requiere configuración de portal viva.'
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
        'La guardia receptora no pudo obtener la configuración vigente del portal.'
      );
    }
    const configuracion = configuracionPortal.obtenerConfiguracionFederacion();
    const capacidades = proyectarCapacidadesConfiguracionFederacion(configuracion);
    return Object.freeze({ configuracionPortal, configuracion, capacidades });
  }

  async exigirPreparada(operacion = 'operacion_receptora') {
    const evaluacion = await this.evaluar();
    if (!evaluacion.capacidades.recepcionPreparada) {
      throw new ErrorRecepcionFederacionNoPreparada({
        operacion,
        bloqueos: evaluacion.capacidades.bloqueos.recepcion
      });
    }
    return evaluacion;
  }
}
