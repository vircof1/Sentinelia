export class ControladorPow {
  constructor({ servicioPow }) {
    this.servicioPow = servicioPow;
  }

  async emitirDesafio(requisicion, respuesta, next) {
    try {
      const hashrateCliente = Number(
        requisicion.body?.hashrateCliente || requisicion.query?.hashrateCliente || 0
      );

      const desafio = await this.servicioPow.emitirDesafio({
        ip: this.resolverIpCliente(requisicion),
        hashrateCliente
      });

      respuesta.json(desafio);
    } catch (error) {
      next(error);
    }
  }

  resolverIpCliente(requisicion) {
    return String(requisicion.ip || '')
      .replace('::ffff:', '')
      .trim();
  }
}
