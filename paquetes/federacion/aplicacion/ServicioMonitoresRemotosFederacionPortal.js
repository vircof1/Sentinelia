import {
  crearIdentidadFederada,
  TIPOS_IDENTIDAD_FEDERADA
} from '../src/IdentidadFederada.js';

export class ServicioMonitoresRemotosFederacionPortal {
  constructor({ repositorio, repositorioTriggers = null, servicioAutorizacion } = {}) {
    if (typeof repositorio?.listar !== 'function') {
      throw new Error('El inventario remoto de monitores requiere un repositorio de lectura.');
    }
    if (typeof servicioAutorizacion?.puedeVerMonitores !== 'function') {
      throw new Error('El inventario remoto de monitores requiere autorización explícita.');
    }
    this.repositorio = repositorio;
    this.repositorioTriggers = repositorioTriggers;
    this.autorizacion = servicioAutorizacion;
  }

  async obtener(contextoUsuarioActual, {
    installationOrigenId, monitorOrigenId = null, vista = 'inventario'
  } = {}) {
    if (!this.autorizacion.puedeVerMonitores(contextoUsuarioActual)) {
      throw errorHttp(403, 'monitores_remotos_no_autorizados',
        'Los monitores remotos no son visibles.');
    }
    const procedencia = validarInstalacion(installationOrigenId);
    const monitorId = monitorOrigenId === null ? null : validarMonitor(monitorOrigenId);
    const scope = scopeEfectivo(contextoUsuarioActual);
    const monitores = await this.repositorio.listar({
      installationOrigenId: procedencia,
      scope,
      limite: 200
    });
    const monitorSeleccionado = monitorId === null
      ? null
      : monitores.find((monitor) => monitor.elementoOrigenId === monitorId) ?? null;
    if (monitorId !== null && monitorSeleccionado === null) {
      throw errorHttp(404, 'monitor_remoto_no_visible',
        'El monitor remoto seleccionado no existe o queda fuera de tu concesión y scope.');
    }
    const historico = vista === 'historico' && monitorSeleccionado
      ? await this.repositorio.listarHistorico({
        installationOrigenId: procedencia,
        monitorOrigenId: monitorId,
        scope,
        limite: 100
      })
      : Object.freeze([]);
    const alertas = vista === 'alertas' && monitorSeleccionado
      ? await this.repositorio.listarAlertas({
        installationOrigenId: procedencia,
        monitorOrigenId: monitorId,
        scope,
        limite: 100
      })
      : Object.freeze([]);
    const referenciasPublicadasMonitor = vista === 'triggers' && monitorSeleccionado
      ? await this.repositorio.listarReferenciasTriggers({
        installationOrigenId: procedencia,
        monitorOrigenId: monitorId,
        scope,
        limite: 100
      })
      : Object.freeze([]);
    const puedeResolverTriggers = vista === 'triggers' && monitorSeleccionado &&
      typeof this.autorizacion.puedeVerTriggers === 'function' &&
      this.autorizacion.puedeVerTriggers(contextoUsuarioActual) &&
      typeof this.repositorioTriggers?.listarAsignaciones === 'function' &&
      typeof this.repositorioTriggers?.listarDefiniciones === 'function';
    const asignacionesTriggers = puedeResolverTriggers
      ? await this.repositorioTriggers.listarAsignaciones({
        installationOrigenId: procedencia,
        monitorOrigenId: monitorId,
        scope,
        limite: 100
      })
      : Object.freeze([]);
    const triggerIds = [...new Set(asignacionesTriggers.map((asignacion) =>
      asignacion.triggerOrigenId))];
    const definicionesTriggers = triggerIds.length > 0
      ? await this.repositorioTriggers.listarDefiniciones({
        installationOrigenId: procedencia,
        triggerOrigenIds: triggerIds,
        scope,
        limite: triggerIds.length
      })
      : Object.freeze([]);
    const referenciasTriggers = asignacionesTriggers.length > 0
      ? presentarAsignacionesTriggers(asignacionesTriggers, definicionesTriggers)
      : referenciasPublicadasMonitor;
    return Object.freeze({
      installationOrigenId: procedencia,
      monitores,
      monitorSeleccionado,
      historico,
      alertas,
      referenciasTriggers,
      fuenteReferenciasTriggers: asignacionesTriggers.length > 0
        ? 'asignacionesTriggers'
        : 'referenciasMonitor',
      resumenReferenciasTriggers: Object.freeze({
        total: referenciasTriggers.length,
        activas: referenciasTriggers.filter((referencia) => referencia.activo).length,
        visibles: referenciasTriggers.filter((referencia) => referencia.visibilidad === 'visible').length,
        opacas: referenciasTriggers.filter((referencia) => referencia.visibilidad === 'opaca').length,
        limiteAlcanzado: asignacionesTriggers.length === 100 ||
          referenciasPublicadasMonitor.length === 100
      }),
      resumenAlertas: Object.freeze({
        total: alertas.length,
        activas: alertas.filter((alerta) => alerta.estado === 'activa').length,
        vigentes: alertas.filter((alerta) => alerta.condicion === 'vigente').length,
        cerradas: alertas.filter((alerta) => alerta.estado === 'cerrada').length,
        descartadasEnOrigen: alertas.filter((alerta) => alerta.descarteOrigen.descartada).length,
        limiteAlcanzado: alertas.length === 100
      }),
      resumen: Object.freeze({
        total: monitores.length,
        activos: monitores.filter((monitor) => monitor.activo).length,
        conEstado: monitores.filter((monitor) => monitor.estadoActual !== null).length,
        vigentes: monitores.filter((monitor) => monitor.estadoActual?.condicion === 'vigente').length,
        conIncidencia: monitores.filter((monitor) =>
          monitor.estadoActual && !['ok', 'normal'].includes(monitor.estadoActual.estado)
        ).length,
        limiteAlcanzado: monitores.length === 200
      })
    });
  }
}

function presentarAsignacionesTriggers(asignaciones, definiciones) {
  const definicionesPorId = new Map(definiciones.map((definicion) =>
    [definicion.triggerOrigenId, definicion]));
  return Object.freeze(asignaciones.map((asignacion) => {
    const definicion = definicionesPorId.get(asignacion.triggerOrigenId) ?? null;
    return Object.freeze({
      proyeccionId: asignacion.proyeccionId,
      elementoOrigenId: asignacion.elementoOrigenId,
      triggerOrigenId: asignacion.triggerOrigenId,
      visibilidad: definicion === null ? 'opaca' : 'visible',
      activo: asignacion.payload.activo,
      ordenEjecucion: asignacion.payload.ordenEjecucion,
      eventosDisparo: Object.freeze([...asignacion.payload.eventosDisparo]),
      completitud: asignacion.completitud,
      triggerFederado: definicion === null ? null : Object.freeze({
        elementoOrigenId: definicion.triggerOrigenId,
        nombre: definicion.payload.nombre,
        tipo: definicion.payload.tipo,
        activo: definicion.payload.activo
      }),
      visibilidadMonitorEnAsignacion:
        asignacion.payload.monitorReferencia.visibilidad
    });
  }));
}

function validarMonitor(valor) {
  try {
    return String(crearIdentidadFederada({
      valor: String(valor || ''),
      tipo: TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN
    }));
  } catch {
    throw errorHttp(400, 'monitor_remoto_invalido',
      'Selecciona una identidad de monitor remoto válida.');
  }
}

function scopeEfectivo(contexto) {
  return Object.freeze({
    nivel: contexto?.nivelScope,
    tenantId: contexto?.tenantId ?? null,
    empresaId: contexto?.empresaId ?? null,
    sitioId: contexto?.sitioId ?? null
  });
}

function validarInstalacion(valor) {
  try {
    return String(crearIdentidadFederada({
      valor: String(valor || ''),
      tipo: TIPOS_IDENTIDAD_FEDERADA.INSTALACION
    }));
  } catch {
    throw errorHttp(400, 'installation_monitores_remotos_invalida',
      'Selecciona una instalación remota válida.');
  }
}

function errorHttp(statusCode, codigo, mensaje) {
  return Object.assign(new Error(mensaje), { statusCode, codigo });
}
