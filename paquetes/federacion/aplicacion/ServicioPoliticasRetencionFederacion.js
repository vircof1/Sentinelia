export class ServicioPoliticasRetencionFederacion {
  constructor({ repositorioPoliticas, servicioConfiguracionPortal } = {}) {
    if (
      typeof repositorioPoliticas?.reconciliarLimiteGlobal !== 'function' ||
      typeof repositorioPoliticas?.configurarFamilia !== 'function' ||
      typeof servicioConfiguracionPortal?.asegurarActualizada !== 'function' ||
      typeof servicioConfiguracionPortal?.obtenerConfiguracionActual !== 'function'
    ) {
      throw new Error(
        'Las políticas de retención requieren repositorio y configuración viva.'
      );
    }
    this.repositorioPoliticas = repositorioPoliticas;
    this.servicioConfiguracionPortal = servicioConfiguracionPortal;
  }

  async reconciliarLimiteGlobal() {
    const configuracion = await this.#obtenerConfiguracionViva();
    return this.repositorioPoliticas.reconciliarLimiteGlobal(configuracion);
  }

  async configurarFamilia({
    relacionId,
    familia,
    retencionRecepcionDias
  } = {}) {
    const configuracion = await this.#obtenerConfiguracionViva();
    return this.repositorioPoliticas.configurarFamilia({
      relacionId,
      familia,
      retencionRecepcionDias,
      ...configuracion
    });
  }

  obtener(entrada) {
    return this.repositorioPoliticas.obtener(entrada);
  }

  listarHistorial(entrada) {
    return this.repositorioPoliticas.listarHistorial(entrada);
  }

  async #obtenerConfiguracionViva() {
    await this.servicioConfiguracionPortal.asegurarActualizada();
    const actual = this.servicioConfiguracionPortal.obtenerConfiguracionActual();
    const federacion = actual.obtenerConfiguracionFederacion();
    return {
      retencionGlobalDias: String(federacion.retencionMaximaDias),
      versionConfiguracionPortal: String(actual.version)
    };
  }
}
