import { normalizarMarcaUtc } from '../../../../paquetes/utilidades/src/fechas/normalizarMarcaUtc.js';

export class RehidratadorEstado {
  constructor({ repositorioEstadoActualMonitores }) {
    this.repositorioEstadoActualMonitores = repositorioEstadoActualMonitores;
  }

  async rehidratar({ catalogoOperativo, almacenEstadoActual }) {
    const resumen = {
      registrosPersistidos: 0,
      rehidratados: 0,
      sinEstadoPrevio: 0,
      versionIncompatible: 0,
      descartadosInactivos: 0,
      persistidosTrasRehidratacion: 0
    };

    resumen.descartadosInactivos =
      await this.repositorioEstadoActualMonitores.eliminarEstadosHuerfanosOInactivos();

    const idsMonitor = catalogoOperativo.monitores.map((monitor) => monitor.id);
    const filasPersistidas =
      await this.repositorioEstadoActualMonitores.listarPorMonitorIds(idsMonitor);

    resumen.registrosPersistidos = filasPersistidas.length;

    const filasPorMonitorId = new Map(
      filasPersistidas.map((fila) => [Number(fila.monitor_id), fila])
    );

    for (const estadoActual of almacenEstadoActual.listar()) {
      const filaPersistida = filasPorMonitorId.get(estadoActual.monitorId);

      if (!filaPersistida) {
        resumen.sinEstadoPrevio += 1;
        continue;
      }

      if (
        String(filaPersistida.version_catalogo || '').trim() !==
        String(estadoActual.versionCatalogo || '').trim()
      ) {
        resumen.versionIncompatible += 1;
        continue;
      }

      estadoActual.actualizar({
        estado: filaPersistida.estado,
        ejecutadoTodavia: Boolean(filaPersistida.ejecutado_todavia),
        pendienteScheduler: Boolean(filaPersistida.pendiente_scheduler),
        fechaUltimaEjecucionUtc: normalizarMarcaUtc(
          filaPersistida.fecha_ultima_ejecucion_utc
        ),
        fechaUltimoCambioUtc: normalizarMarcaUtc(
          filaPersistida.fecha_ultimo_cambio_utc
        ),
        resultadoActual: this.parsearResultadoActual(filaPersistida.resultado_actual),
        motivoInicial: filaPersistida.motivo_inicial || 'rehidratado_sql'
      });
      resumen.rehidratados += 1;
    }

    resumen.persistidosTrasRehidratacion =
      await this.repositorioEstadoActualMonitores.guardarEstadosActuales(
        almacenEstadoActual.listar()
      );

    return resumen;
  }

  parsearResultadoActual(valor) {
    if (!valor) {
      return null;
    }

    if (typeof valor === 'object') {
      return valor;
    }

    try {
      return JSON.parse(String(valor));
    } catch (_error) {
      return null;
    }
  }
}
