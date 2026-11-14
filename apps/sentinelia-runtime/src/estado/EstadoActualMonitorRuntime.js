function clonarObjetoPlano(valor) {
  if (!valor || typeof valor !== 'object') {
    return {};
  }

  return { ...valor };
}

export class EstadoActualMonitorRuntime {
  constructor({ monitor }) {
    if (!monitor) {
      throw new Error(
        'El estado actual runtime requiere un monitor materializado para inicializarse.'
      );
    }

    this.monitorId = monitor.id;
    this.nombre = monitor.nombre;
    this.tipo = monitor.tipo;
    this.versionCatalogo = monitor.version;
    this.activoCatalogo = Boolean(monitor.activo);
    this.scope = clonarObjetoPlano(monitor.scope);
    this.programacion = clonarObjetoPlano(monitor.programacion);
    this.configuracion = clonarObjetoPlano(monitor.configuracion);
    this.inferenciasIndisponibleConsecutivas = Number(
      monitor.inferenciasIndisponibleConsecutivas || 1
    );
    this.inferenciasDisponibleConsecutivas = Number(
      monitor.inferenciasDisponibleConsecutivas || 1
    );
    this.estado = 'desconocido';
    this.ejecutadoTodavia = false;
    this.pendienteScheduler = true;
    this.vencidoParaEjecucion = false;
    this.proximoIntentoEn = null;
    this.fechaUltimaEjecucionUtc = null;
    this.fechaUltimoCambioUtc = null;
    this.resultadoActual = null;
    this.motivoInicial = 'pendiente_de_scheduler';
    this.motivoProgramacion = 'sin_calcular';
  }

  actualizar(parcial = {}) {
    if (parcial.estado) {
      this.estado = String(parcial.estado).trim().toLowerCase();
    }

    if (typeof parcial.ejecutadoTodavia === 'boolean') {
      this.ejecutadoTodavia = parcial.ejecutadoTodavia;
    }

    if (typeof parcial.pendienteScheduler === 'boolean') {
      this.pendienteScheduler = parcial.pendienteScheduler;
    }

    if (typeof parcial.vencidoParaEjecucion === 'boolean') {
      this.vencidoParaEjecucion = parcial.vencidoParaEjecucion;
    }

    if (parcial.proximoIntentoEn !== undefined) {
      this.proximoIntentoEn = parcial.proximoIntentoEn || null;
    }

    if (parcial.fechaUltimaEjecucionUtc !== undefined) {
      this.fechaUltimaEjecucionUtc = parcial.fechaUltimaEjecucionUtc || null;
    }

    if (parcial.fechaUltimoCambioUtc !== undefined) {
      this.fechaUltimoCambioUtc = parcial.fechaUltimoCambioUtc || null;
    }

    if (parcial.resultadoActual !== undefined) {
      this.resultadoActual = parcial.resultadoActual ?? null;
    }

    if (parcial.motivoInicial) {
      this.motivoInicial = String(parcial.motivoInicial).trim();
    }

    if (parcial.motivoProgramacion) {
      this.motivoProgramacion = String(parcial.motivoProgramacion).trim();
    }

    return this;
  }

  serializar() {
    return {
      monitorId: this.monitorId,
      nombre: this.nombre,
      tipo: this.tipo,
      versionCatalogo: this.versionCatalogo,
      activoCatalogo: this.activoCatalogo,
      scope: clonarObjetoPlano(this.scope),
      programacion: clonarObjetoPlano(this.programacion),
      configuracion: clonarObjetoPlano(this.configuracion),
      estado: this.estado,
      ejecutadoTodavia: this.ejecutadoTodavia,
      pendienteScheduler: this.pendienteScheduler,
      vencidoParaEjecucion: this.vencidoParaEjecucion,
      proximoIntentoEn: this.proximoIntentoEn,
      fechaUltimaEjecucionUtc: this.fechaUltimaEjecucionUtc,
      fechaUltimoCambioUtc: this.fechaUltimoCambioUtc,
      resultadoActual: this.resultadoActual,
      motivoInicial: this.motivoInicial,
      motivoProgramacion: this.motivoProgramacion
    };
  }
}
