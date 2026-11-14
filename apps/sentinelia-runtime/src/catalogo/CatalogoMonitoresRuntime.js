import { MonitorRuntime } from './MonitorRuntime.js';
import { agruparMonitoresPorTipo } from '../../../../paquetes/monitores/src/CatalogoTiposMonitor.js';

export class CatalogoMonitoresRuntime {
  constructor({ generadoEn, monitores = [] }) {
    this.generadoEn = String(generadoEn || '').trim() || new Date().toISOString();
    this.monitores = monitores.map((monitor) =>
      monitor instanceof MonitorRuntime ? monitor : new MonitorRuntime(monitor)
    );
    this.monitoresPorId = new Map(
      this.monitores.map((monitor) => [monitor.id, monitor])
    );
  }

  get total() {
    return this.monitores.length;
  }

  buscarPorId(idMonitor) {
    return this.monitoresPorId.get(Number(idMonitor)) || null;
  }

  serializarResumen() {
    const porTipo = agruparMonitoresPorTipo(this.monitores);

    return {
      total: this.total,
      generadoEn: this.generadoEn,
      porTipo,
      totalPing: Number(porTipo.ping || 0),
      totalTcp: Number(porTipo.tcp || 0),
      totalEmpresa: this.monitores.filter(
        (monitor) => monitor.scope.nivelPertenencia === 'empresa'
      ).length,
      totalSitio: this.monitores.filter(
        (monitor) => monitor.scope.nivelPertenencia === 'sitio'
      ).length,
      totalActivos: this.monitores.filter((monitor) => monitor.activo).length
    };
  }

  serializar() {
    return {
      generadoEn: this.generadoEn,
      total: this.total,
      monitores: this.monitores.map((monitor) => monitor.serializar())
    };
  }
}
