export class ErrorFederacionDesactivada extends Error {
  constructor(operacion) {
    super('La federación está desactivada por la configuración vigente del portal.');
    this.name = 'ErrorFederacionDesactivada';
    this.codigo = 'FEDERACION_DESACTIVADA';
    this.statusCode = 503;
    this.operacion = operacion;
  }
}

export class GuardiaActivacionFederacion {
  constructor({ servicioConfiguracionPortal } = {}) {
    if (typeof servicioConfiguracionPortal?.asegurarActualizada !== 'function' ||
        typeof servicioConfiguracionPortal?.obtenerConfiguracionActual !== 'function') {
      throw new Error('La guardia federada requiere configuración de portal viva.');
    }
    this.servicioConfiguracionPortal = servicioConfiguracionPortal;
    Object.freeze(this);
  }

  async estaActiva() {
    await this.servicioConfiguracionPortal.asegurarActualizada();
    return this.servicioConfiguracionPortal.obtenerConfiguracionActual()
      .obtenerConfiguracionFederacion().activacionFederacion === true;
  }

  async exigirActiva(operacion = 'operacion_federada') {
    if (!await this.estaActiva()) throw new ErrorFederacionDesactivada(operacion);
  }
}
