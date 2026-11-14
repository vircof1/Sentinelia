export class CatalogoDnsRuntime {
  constructor({ generadoEn, resumen = {}, zonas = [] }) {
    this.generadoEn = String(generadoEn || '').trim() || new Date().toISOString();
    this.resumen = {
      totalZonas: Number(resumen.totalZonas || 0),
      totalZonasActivas: Number(resumen.totalZonasActivas || 0),
      totalZonasPublicables: Number(resumen.totalZonasPublicables || 0),
      totalZonasEspeciales: Number(resumen.totalZonasEspeciales || 0),
      totalRegistros: Number(resumen.totalRegistros || 0),
      totalRegistrosPublicables: Number(resumen.totalRegistrosPublicables || 0),
      totalRegistrosEspeciales: Number(resumen.totalRegistrosEspeciales || 0)
    };
    this.zonas = Array.isArray(zonas) ? zonas : [];
  }

  serializarResumen() {
    return {
      generadoEn: this.generadoEn,
      ...this.resumen
    };
  }
}
