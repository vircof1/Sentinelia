import { CompactadorHistorico } from './CompactadorHistorico.js';
import { enlazarRepositorioAConexion } from '../persistencia/RepositorioEnTransaccion.js';

function normalizarEnteroNoNegativo(valor, porDefecto = 0) {
  const convertido = Number.parseInt(String(valor ?? ''), 10);

  if (!Number.isInteger(convertido)) {
    return porDefecto;
  }

  return Math.max(0, convertido);
}

export class GestorHistoricoMonitores {
  constructor({
    repositorioHistoricoMonitores,
    servicioConfiguracionPortal,
    capturadorFederacionMonitores = null
  }) {
    this.repositorioHistoricoMonitores = repositorioHistoricoMonitores;
    this.servicioConfiguracionPortal = servicioConfiguracionPortal;
    this.capturadorFederacionMonitores = capturadorFederacionMonitores;
    this.compactadorHistorico = new CompactadorHistorico();
  }

  async aplicarResultados({
    catalogoOperativo,
    resultados = [],
    persistenciaEventos = null
  }, { conexion = null } = {}) {
    const resumen = {
      totalResultados: Array.isArray(resultados) ? resultados.length : 0,
      totalEvaluados: 0,
      totalAperturas: 0,
      totalExtensiones: 0,
      totalTransiciones: 0,
      totalPersistidos: 0,
      totalActualizados: 0,
      totalDescartados: 0,
      monitorIdsNuevos: [],
      monitorIdsActualizados: [],
      resultadosDescartados: []
    };

    if (!Array.isArray(resultados) || resultados.length === 0) {
      return resumen;
    }

    const configuracionPortal =
      await this.servicioConfiguracionPortal.asegurarActualizada();
    const configuracionMonitores =
      configuracionPortal.obtenerConfiguracionMonitores();
    const eventosPersistidos = Array.isArray(persistenciaEventos?.eventosPersistidos)
      ? persistenciaEventos.eventosPersistidos
      : [];
    const eventosPorMonitor = new Map(
      eventosPersistidos.map((evento) => [evento.monitorId, evento])
    );
    const idsMonitor = [
      ...new Set(
        resultados
          .map((resultado) => normalizarEnteroNoNegativo(resultado?.monitorId, 0))
          .filter((id) => id > 0)
      )
    ];
    const repositorio = enlazarRepositorioAConexion(
      this.repositorioHistoricoMonitores,
      conexion
    );
    const tramosActuales = await repositorio.listarUltimosPorMonitorIds(
      idsMonitor
    );
    const tramosPorMonitor = new Map(
      tramosActuales.map((tramo) => [tramo.monitorId, tramo])
    );
    const nuevosTramos = [];
    const tramosActualizados = [];

    for (const resultado of resultados) {
      const monitorId = normalizarEnteroNoNegativo(resultado?.monitorId, 0);
      const snapshot = this.compactadorHistorico.resolverSnapshotResultado({
        catalogoOperativo,
        resultado,
        eventoPersistido: eventosPorMonitor.get(monitorId) || null,
        configuracionMonitores
      });

      if (!snapshot) {
        resumen.totalDescartados += 1;
        resumen.resultadosDescartados.push({
          monitorId: monitorId || null,
          codigoResultado: String(resultado?.codigoResultado || 'sin_resultado'),
          motivo: 'resultado_sin_snapshot_minimo'
        });
        continue;
      }

      const decision = this.compactadorHistorico.resolverDecision({
        snapshot,
        tramoActual: tramosPorMonitor.get(snapshot.monitorId) || null
      });

      if (decision.accion === 'descartar') {
        resumen.totalDescartados += 1;
        resumen.resultadosDescartados.push({
          monitorId: snapshot.monitorId,
          codigoResultado: snapshot.codigoResultado,
          motivo: decision.motivo
        });
        continue;
      }

      resumen.totalEvaluados += 1;

      if (decision.accion === 'extender') {
        resumen.totalExtensiones += 1;
        resumen.monitorIdsActualizados.push(snapshot.monitorId);
        tramosActualizados.push(decision.tramoActualizado);
        tramosPorMonitor.set(snapshot.monitorId, decision.tramoActualizado);
        continue;
      }

      if (decision.motivo === 'transicion_compactacion') {
        resumen.totalTransiciones += 1;
      }

      resumen.totalAperturas += 1;
      resumen.monitorIdsNuevos.push(snapshot.monitorId);
      nuevosTramos.push(decision.nuevoTramo);
      tramosPorMonitor.set(snapshot.monitorId, decision.nuevoTramo);
    }

    for (const tramo of tramosActualizados) {
      resumen.totalActualizados +=
        await repositorio.actualizarTramo(tramo);
    }

    if (nuevosTramos.length > 0) {
      resumen.totalPersistidos =
        await repositorio.guardarTramos(nuevosTramos);
    }

    if (
      conexion && this.capturadorFederacionMonitores &&
      (resumen.totalPersistidos > 0 || resumen.totalActualizados > 0)
    ) {
      resumen.capturasFederadas = await this.capturadorFederacionMonitores
        .capturarRuntimeEnTransaccion({
          historicoMonitorIds: [
            ...new Set([
              ...resumen.monitorIdsNuevos,
              ...resumen.monitorIdsActualizados
            ])
          ]
        }, { conexion });
    }

    return resumen;
  }
}
