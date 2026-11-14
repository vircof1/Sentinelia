import { CatalogoMonitoresRuntime } from './CatalogoMonitoresRuntime.js';

export class CargadorCatalogoMonitoresRuntime {
  constructor({ servicioMonitores }) {
    this.servicioMonitores = servicioMonitores;
  }

  async cargarInicial() {
    const exportacion = await this.servicioMonitores.exportarDefinicionesRuntime();

    return new CatalogoMonitoresRuntime({
      generadoEn: exportacion.generadoEn,
      monitores: exportacion.monitores || []
    });
  }
}
