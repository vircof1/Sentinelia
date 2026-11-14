export class ServicioLecturaTriggersPortal {
  constructor({
    repositorioMonitores,
    servicioTriggers
  }) {
    this.repositorioMonitores = repositorioMonitores;
    this.servicioTriggers = servicioTriggers;
  }

  async construirVistaLecturaAdministrativa(contextoUsuarioActual) {
    const monitores = await this.repositorioMonitores.listarVisibles(
      contextoUsuarioActual
    );
    const monitorIds = monitores
      .map((monitor) => Number(monitor.id))
      .filter((id) => Number.isInteger(id) && id > 0);
    const asignaciones = await this.servicioTriggers.listarAsignacionesPorMonitorIds(
      monitorIds,
      { soloActivas: false }
    );
    const triggerIds = Array.from(
      new Set(
        asignaciones
          .map((asignacion) => Number(asignacion.triggerId))
          .filter((id) => Number.isInteger(id) && id > 0)
      )
    );
    const [triggers, ejecuciones] = await Promise.all([
      this.servicioTriggers.listarTriggersVisiblesPorIds(
        contextoUsuarioActual,
        triggerIds
      ),
      this.servicioTriggers.listarEjecucionesRecientesPorMonitorIds(monitorIds, {
        limit: 30
      })
    ]);

    const monitoresPorId = new Map(monitores.map((monitor) => [monitor.id, monitor]));
    const triggersPorId = new Map(triggers.map((trigger) => [trigger.id, trigger]));
    const ejecucionRecientePorAsignacion = new Map();

    for (const ejecucion of ejecuciones) {
      const asignacionId = Number(ejecucion.asignacionTriggerMonitorId || 0);

      if (
        Number.isInteger(asignacionId) &&
        asignacionId > 0 &&
        !ejecucionRecientePorAsignacion.has(asignacionId)
      ) {
        ejecucionRecientePorAsignacion.set(asignacionId, ejecucion);
      }
    }

    const bloquesMonitor = monitores
      .map((monitor) => {
        const asignacionesMonitor = asignaciones
          .filter((asignacion) => Number(asignacion.monitorId) === Number(monitor.id))
          .map((asignacion) => {
            const trigger = triggersPorId.get(asignacion.triggerId) || null;
            const ultimaEjecucion =
              ejecucionRecientePorAsignacion.get(Number(asignacion.id)) || null;

            return this.serializarAsignacionVisible({
              ...asignacion,
              trigger,
              ultimaEjecucion
            });
          })
          .sort((a, b) =>
            Number(a.ordenEjecucion || 0) - Number(b.ordenEjecucion || 0) ||
            Number(a.id || 0) - Number(b.id || 0)
          );

        return {
          monitor: monitor.serializarResumen(),
          totalAsignaciones: asignacionesMonitor.length,
          asignacionesActivas: asignacionesMonitor.filter((item) => item.activo).length,
          asignaciones: asignacionesMonitor
        };
      })
      .filter((bloque) => bloque.totalAsignaciones > 0);

    return {
      alcanceActual: this.construirAlcanceActual(contextoUsuarioActual),
      resumen: {
        totalMonitoresVisibles: monitores.length,
        totalMonitoresConTriggers: bloquesMonitor.length,
        totalTriggers: triggers.length,
        totalTriggersActivos: triggers.filter((trigger) => trigger.activo).length,
        totalAsignaciones: asignaciones.length,
        totalAsignacionesActivas: asignaciones.filter((item) => item.activo).length,
        totalEjecucionesRecientes: ejecuciones.length,
        totalErroresRecientes: ejecuciones.filter(
          (ejecucion) => ejecucion.estadoEjecucion === 'error'
        ).length
      },
      triggers,
      monitoresConAsignaciones: bloquesMonitor,
      ejecucionesRecientes: ejecuciones.map((ejecucion) =>
        this.serializarEjecucionVisible({
          ...ejecucion,
          monitor:
            monitoresPorId.get(ejecucion.monitorId)?.serializarResumen?.() || null,
          trigger: triggersPorId.get(ejecucion.triggerId) || null
        })
      )
    };
  }

  serializarAsignacionVisible(asignacion) {
    if (asignacion?.trigger) {
      return {
        ...asignacion,
        triggerVisible: true
      };
    }

    return {
      ...asignacion,
      triggerVisible: false,
      triggerNombre: `Trigger #${asignacion?.triggerId || '?'}`,
      triggerTipo: '',
      triggerDescripcion: 'Detalle oculto por alcance.'
    };
  }

  serializarEjecucionVisible(ejecucion) {
    if (ejecucion?.trigger) {
      return {
        ...ejecucion,
        triggerVisible: true,
        triggerScopeDescripcion:
          ejecucion.trigger?.alcanceDescripcion || 'Alcance del trigger no disponible'
      };
    }

    return {
      ...ejecucion,
      triggerVisible: false,
      triggerNombre: `Trigger #${ejecucion?.triggerId || '?'}`,
      tipoTrigger: '',
      triggerScopeDescripcion: 'Alcance del trigger oculto por alcance',
      codigoResultado: ejecucion?.codigoResultado || null,
      mensajeResultado: ejecucion?.mensajeResultado || 'Trigger no visible con tu alcance actual.'
    };
  }

  construirAlcanceActual(contextoUsuarioActual) {
    const nivel = contextoUsuarioActual?.nivelScope || 'desconocido';
    const partes = [];

    if (contextoUsuarioActual?.tenantNombre) {
      partes.push(contextoUsuarioActual.tenantNombre);
    }

    if (contextoUsuarioActual?.empresaNombre) {
      partes.push(contextoUsuarioActual.empresaNombre);
    }

    if (contextoUsuarioActual?.sitioNombre) {
      partes.push(contextoUsuarioActual.sitioNombre);
    }

    return {
      nivelScope: nivel,
      descripcion: partes.length > 0 ? partes.join(' / ') : 'Portal completo'
    };
  }
}
