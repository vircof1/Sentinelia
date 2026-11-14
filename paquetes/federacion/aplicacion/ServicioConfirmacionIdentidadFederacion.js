export class ServicioConfirmacionIdentidadFederacion {
  constructor({ repositorioCandidaturas } = {}) {
    if (typeof repositorioCandidaturas?.confirmar !== 'function') {
      throw new Error('La confirmación exige repositorio de candidaturas.');
    }
    this.repositorioCandidaturas = repositorioCandidaturas;
  }

  confirmar(entrada = {}) {
    return this.repositorioCandidaturas.confirmar(entrada);
  }

  obtenerPendiente(relacionId) {
    return this.repositorioCandidaturas.buscarPendienteSaneada(relacionId);
  }
}
