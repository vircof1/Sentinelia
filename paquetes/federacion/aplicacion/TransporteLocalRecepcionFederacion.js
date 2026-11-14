export class TransporteLocalRecepcionFederacion {
  constructor({ repositorioInbox } = {}) {
    if (typeof repositorioInbox?.recibir !== 'function') {
      throw new Error('El transporte local requiere la inbox federada durable.');
    }
    this.repositorioInbox = repositorioInbox;
    Object.freeze(this);
  }

  async entregar({ ocurrencia } = {}) {
    const resultado = await this.repositorioInbox.recibir(ocurrencia);
    return Object.freeze({
      codigo: resultado.codigo,
      confirmada: resultado.confirmada,
      persistidaDurablemente: resultado.persistidaDurablemente,
      identidad: resultado.identidad,
      estadoIntegridad: resultado.estadoIntegridad
    });
  }
}
