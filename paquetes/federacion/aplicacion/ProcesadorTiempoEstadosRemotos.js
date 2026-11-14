export class ProcesadorTiempoEstadosRemotos {
  constructor({ repositorioTiempo, repositorioMonitoresRemotos } = {}) {
    exigirMetodo(repositorioTiempo, 'iniciarConsolidacion', 'repositorioTiempo');
    exigirMetodo(repositorioTiempo, 'materializar', 'repositorioTiempo');
    exigirMetodo(repositorioTiempo, 'listarAvisosPendientes', 'repositorioTiempo');
    exigirMetodo(repositorioTiempo, 'confirmarAviso', 'repositorioTiempo');
    exigirMetodo(
      repositorioMonitoresRemotos,
      'listarFotografiasOperativas',
      'repositorioMonitoresRemotos'
    );
    this.repositorioTiempo = repositorioTiempo;
    this.repositorioMonitoresRemotos = repositorioMonitoresRemotos;
    this.bootId = null;
  }

  async iniciarTrasRehidratacion({ bootId, consolidacionReinicioMs } = {}) {
    const ciclo = await this.repositorioTiempo.iniciarConsolidacion({
      bootId,
      duracionMs: consolidacionReinicioMs
    });
    this.bootId = ciclo.bootId;
    return ciclo;
  }

  async procesar() {
    if (!this.bootId) {
      throw new Error('El tiempo remoto no comienza antes de completar la rehidratación.');
    }
    const fotografias = await this.repositorioMonitoresRemotos
      .listarFotografiasOperativas();
    return this.repositorioTiempo.materializar({
      bootId: this.bootId,
      fotografias
    });
  }

  listarAvisosPendientes(opciones) {
    return this.repositorioTiempo.listarAvisosPendientes(opciones);
  }

  confirmarAviso(solicitud) {
    return this.repositorioTiempo.confirmarAviso(solicitud);
  }
}

function exigirMetodo(valor, metodo, campo) {
  if (typeof valor?.[metodo] !== 'function') {
    throw new Error(`${campo} requiere ${metodo}().`);
  }
}
