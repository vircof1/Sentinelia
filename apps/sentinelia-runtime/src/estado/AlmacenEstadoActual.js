import { EstadoActualMonitorRuntime } from './EstadoActualMonitorRuntime.js';
import { agruparMonitoresPorTipo } from '../../../../paquetes/monitores/src/CatalogoTiposMonitor.js';

export class AlmacenEstadoActual {
  constructor({ catalogoOperativo }) {
    if (!catalogoOperativo) {
      throw new Error(
        'El almacén de estado actual requiere un catálogo operativo para inicializarse.'
      );
    }

    this.catalogoOperativo = catalogoOperativo;
    this.creadoEn = new Date().toISOString();
    this.estadosPorMonitorId = new Map();

    for (const monitor of this.catalogoOperativo.monitores) {
      this.estadosPorMonitorId.set(
        monitor.id,
        new EstadoActualMonitorRuntime({ monitor })
      );
    }
  }

  get total() {
    return this.estadosPorMonitorId.size;
  }

  buscarPorMonitorId(idMonitor) {
    return this.estadosPorMonitorId.get(Number(idMonitor)) || null;
  }

  listar() {
    return Array.from(this.estadosPorMonitorId.values());
  }

  actualizarEstadoMonitor(idMonitor, parcial = {}) {
    const estado = this.buscarPorMonitorId(idMonitor);

    if (!estado) {
      throw new Error(
        `No existe un estado runtime materializado para el monitor ${idMonitor}.`
      );
    }

    estado.actualizar(parcial);
    return estado;
  }

  crearSnapshot() {
    return {
      creadoEn: this.creadoEn,
      catalogoGeneradoEn: this.catalogoOperativo.generadoEn,
      total: this.total,
      estados: this.listar().map((estado) => estado.serializar())
    };
  }

  serializarResumen() {
    const estados = this.listar();
    const porTipo = agruparMonitoresPorTipo(estados);
    const proximosIntentos = estados
      .map((estado) => estado.proximoIntentoEn)
      .filter(Boolean)
      .sort();

    return {
      creadoEn: this.creadoEn,
      catalogoGeneradoEn: this.catalogoOperativo.generadoEn,
      total: this.total,
      totalDesconocidos: estados.filter((estado) => estado.estado === 'desconocido')
        .length,
      totalPendientesScheduler: estados.filter(
        (estado) => estado.pendienteScheduler
      ).length,
      totalVencidosParaEjecucion: estados.filter(
        (estado) => estado.vencidoParaEjecucion
      ).length,
      totalSinEjecutar: estados.filter((estado) => !estado.ejecutadoTodavia).length,
      porTipo,
      totalPing: Number(porTipo.ping || 0),
      totalTcp: Number(porTipo.tcp || 0),
      proximoIntentoGlobalEn: proximosIntentos[0] || null
    };
  }
}
