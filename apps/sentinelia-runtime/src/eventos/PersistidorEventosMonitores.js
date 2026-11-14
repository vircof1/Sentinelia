export class PersistidorEventosMonitores {
  constructor({ servicioEventosMonitores, capturadorFederacionMonitores = null }) {
    this.servicioEventosMonitores = servicioEventosMonitores;
    this.capturadorFederacionMonitores = capturadorFederacionMonitores;
  }

  async persistirDesdeLote(
    { catalogoOperativo, loteEjecucion = null },
    { conexion = null } = {}
  ) {
    if (!loteEjecucion || !Array.isArray(loteEjecucion.resultados)) {
      return {
        totalResultados: 0,
        totalConstruidos: 0,
        totalPersistidos: 0,
        totalDescartados: 0,
        monitorIdsPersistidos: [],
        resultadosDescartados: []
      };
    }

    const resumen = await this.servicioEventosMonitores.guardarResultadosEjecucion({
      catalogoOperativo,
      resultados: loteEjecucion.resultados
    }, { conexion });
    if (conexion && this.capturadorFederacionMonitores && resumen.totalPersistidos > 0) {
      resumen.capturasFederadas = await this.capturadorFederacionMonitores
        .capturarRuntimeEnTransaccion({
          eventoIds: resumen.eventosPersistidos.map(({ id }) => id).filter(Boolean)
        }, { conexion });
    }
    return resumen;
  }
}
