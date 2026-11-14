import { CatalogoDnsRuntime } from './CatalogoDnsRuntime.js';

export class CargadorCatalogoDnsRuntime {
  constructor({ servicioDns }) {
    this.servicioDns = servicioDns;
  }

  async cargarInicial() {
    const exportacion = await this.servicioDns.exportarDefinicionesRuntime();

    return new CatalogoDnsRuntime({
      generadoEn: exportacion.generadoEn,
      resumen: exportacion.resumen,
      zonas: exportacion.zonas || []
    });
  }
}
