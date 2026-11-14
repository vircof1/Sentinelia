import {
  crearIdentidadFederada,
  TIPOS_IDENTIDAD_FEDERADA
} from '../src/IdentidadFederada.js';

const VISTAS = new Set(['inventario', 'resumen', 'asignaciones', 'ejecuciones']);
const CLAVES_SENSIBLES =
  /password|passwd|contrasena|secret|secreto|token|api[_-]?key|authorization|credential|credencial/iu;

export class ServicioTriggersRemotosFederacionPortal {
  constructor({ repositorio, repositorioMonitores, servicioAutorizacion,
    evaluarCapacidadLocalTrigger = null } = {}) {
    if (['listarDefiniciones', 'listarAsignaciones', 'listarEjecucionesTerminadas']
      .some((metodo) => typeof repositorio?.[metodo] !== 'function')) {
      throw new Error('El visor remoto de triggers requiere un repositorio de lectura completo.');
    }
    if (typeof repositorioMonitores?.listar !== 'function') {
      throw new Error('El visor remoto de triggers requiere resolver monitores federados visibles.');
    }
    if (typeof servicioAutorizacion?.puedeVerTriggers !== 'function' ||
        typeof servicioAutorizacion?.puedeVerMonitores !== 'function') {
      throw new Error('El visor remoto de triggers requiere autorización explícita.');
    }
    this.repositorio = repositorio;
    this.repositorioMonitores = repositorioMonitores;
    this.autorizacion = servicioAutorizacion;
    this.evaluarCapacidadLocalTrigger = evaluarCapacidadLocalTrigger;
  }

  async obtener(contextoUsuarioActual, {
    installationOrigenId,
    triggerOrigenId = null,
    vista = 'inventario'
  } = {}) {
    if (!this.autorizacion.puedeVerTriggers(contextoUsuarioActual)) {
      throw errorHttp(403, 'triggers_remotos_no_autorizados',
        'Los triggers remotos no son visibles.');
    }
    if (!VISTAS.has(vista)) {
      throw errorHttp(400, 'vista_triggers_remotos_invalida',
        'La vista de triggers remotos solicitada no existe.');
    }
    const procedencia = validarIdentidad(
      installationOrigenId,
      TIPOS_IDENTIDAD_FEDERADA.INSTALACION,
      'installation_triggers_remotos_invalida',
      'Selecciona una instalación remota válida.'
    );
    const triggerId = triggerOrigenId === null
      ? null
      : validarIdentidad(
        triggerOrigenId,
        TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN,
        'trigger_remoto_invalido',
        'Selecciona una identidad de trigger remoto válida.'
      );
    const scope = scopeEfectivo(contextoUsuarioActual);
    const filtros = { installationOrigenId: procedencia, scope };
    const [definicionesRecibidas, asignaciones, ejecuciones] = await Promise.all([
      this.repositorio.listarDefiniciones({ ...filtros, limite: 200 }),
      this.repositorio.listarAsignaciones({
        ...filtros,
        triggerOrigenId: triggerId,
        limite: 500
      }),
      this.repositorio.listarEjecucionesTerminadas({
        ...filtros,
        triggerOrigenId: triggerId,
        limite: 200
      })
    ]);
    const puedeAbrirMonitores = this.autorizacion.puedeVerMonitores(
      contextoUsuarioActual
    );
    const referenciasMonitor = referenciasMonitores(asignaciones, ejecuciones);
    const monitoresVisibles = puedeAbrirMonitores && referenciasMonitor.length > 0
      ? await this.repositorioMonitores.listar({
        installationOrigenId: procedencia,
        scope,
        monitorOrigenIds: referenciasMonitor,
        limite: referenciasMonitor.length
      })
      : Object.freeze([]);
    const monitoresPorId = new Map(monitoresVisibles.map((monitor) =>
      [monitor.elementoOrigenId, monitor]));
    let definiciones = definicionesRecibidas;
    let registroSeleccionado = triggerId === null
      ? null
      : definiciones.find((registro) => registro.triggerOrigenId === triggerId) ?? null;
    if (triggerId !== null && registroSeleccionado === null) {
      const exactas = await this.repositorio.listarDefiniciones({
        ...filtros,
        triggerOrigenId: triggerId,
        limite: 1
      });
      registroSeleccionado = exactas[0] ?? null;
      if (registroSeleccionado === null) {
        throw errorHttp(404, 'trigger_remoto_no_visible',
          'El trigger remoto seleccionado no existe o queda fuera de tu concesión y scope.');
      }
      definiciones = Object.freeze([...definicionesRecibidas, registroSeleccionado]);
    }
    const capacidadCorreoLocal = definiciones.some(({ payload }) => payload.tipo === 'correo')
      ? await evaluarCapacidadCorreoLocal(this.evaluarCapacidadLocalTrigger)
      : CAPACIDAD_NO_APLICABLE;
    const definicionesPresentadas = definiciones.map((registro) => presentarDefinicion(
      registro,
      asignaciones.filter((asignacion) =>
        asignacion.triggerOrigenId === registro.triggerOrigenId),
      ejecuciones.filter((ejecucion) =>
        ejecucion.triggerOrigenId === registro.triggerOrigenId),
      monitoresPorId,
      capacidadCorreoLocal
    ));
    const triggerSeleccionado = registroSeleccionado === null
      ? null
      : definicionesPresentadas.find((trigger) =>
        trigger.triggerOrigenId === registroSeleccionado.triggerOrigenId);
    const asignacionesPresentadas = asignaciones.map((registro) =>
      presentarAsignacion(registro, monitoresPorId));
    const ejecucionesPresentadas = ejecuciones.map((registro) =>
      presentarEjecucion(registro, monitoresPorId));
    return Object.freeze({
      installationOrigenId: procedencia,
      puedeAbrirMonitores,
      triggers: Object.freeze(definicionesPresentadas),
      triggerSeleccionado,
      asignaciones: Object.freeze(asignacionesPresentadas),
      ejecuciones: Object.freeze(ejecucionesPresentadas),
      resumen: Object.freeze({
        total: definicionesRecibidas.length,
        activos: definicionesRecibidas.filter((registro) => registro.payload.activo).length,
        interpretables: definicionesRecibidas.filter((registro) =>
          registro.completitud.interpretable === 'completa').length,
        conAsignaciones: new Set(asignaciones.map((registro) =>
          registro.triggerOrigenId)).size,
        limiteDefinicionesAlcanzado: definicionesRecibidas.length === 200,
        limiteAsignacionesAlcanzado: asignaciones.length === 500,
        limiteEjecucionesAlcanzado: ejecuciones.length === 200
      })
    });
  }
}

function presentarDefinicion(registro, asignaciones, ejecuciones, monitoresPorId,
  capacidadCorreoLocal) {
  const payload = registro.payload;
  const correo = payload.tipo === 'correo';
  const definicionCorreo = correo && payload.contenidoSensible?.estado === 'presente'
    ? payload.contenidoSensible.contenido?.definicionMensaje ?? null
    : null;
  const reutilizablePorContenido = !correo || definicionCorreo !== null;
  const capacidadLocal = correo ? capacidadCorreoLocal : CAPACIDAD_NO_APLICABLE;
  const ultimaEjecucion = ejecuciones[0]
    ? presentarEjecucion(ejecuciones[0], monitoresPorId)
    : null;
  return Object.freeze({
    proyeccionId: registro.proyeccionId,
    installationOrigenId: registro.installationOrigenId,
    elementoOrigenId: registro.elementoOrigenId,
    triggerOrigenId: registro.triggerOrigenId,
    nombre: payload.nombre,
    tipo: payload.tipo,
    descripcion: payload.descripcion,
    activo: payload.activo,
    configuracionVisible: sanearConfiguracion(
      definicionCorreo ?? payload.configuracionOperativa
    ),
    configuracionCorreo: correo ? Object.freeze({
      forma: sanearConfiguracion(payload.configuracionOperativa),
      definicionReusableDisponible: definicionCorreo !== null
    }) : null,
    contenidoSensible: presentarDeclaracionSensible(payload.contenidoSensible),
    scopeOrganizativo: payload.scopeOrganizativo,
    scopeRecepcion: registro.scopeRecepcion,
    completitud: registro.completitud,
    estadoProyeccion: registro.estadoProyeccion,
    utilizableComoPlantilla:
      registro.completitud.interpretable === 'completa' &&
      registro.estadoProyeccion.vigencia === 'vigente' &&
      registro.estadoProyeccion.autorizacion === 'autorizada' &&
      reutilizablePorContenido &&
      (!correo || capacidadLocal.disponible),
    capacidadPlantilla: Object.freeze({
      contenidoReusable: reutilizablePorContenido,
      local: capacidadLocal
    }),
    resumenAsignaciones: Object.freeze({
      total: asignaciones.length,
      activas: asignaciones.filter((asignacion) => asignacion.payload.activo).length,
      visibles: asignaciones.filter((asignacion) =>
        asignacion.payload.monitorReferencia.visibilidad === 'visible').length,
      opacas: asignaciones.filter((asignacion) =>
        asignacion.payload.monitorReferencia.visibilidad === 'opaca').length
    }),
    ultimaEjecucion
  });
}

function presentarAsignacion(registro, monitoresPorId) {
  const payload = registro.payload;
  const monitor = monitoresPorId.get(payload.monitorReferencia.elementoOrigenId) ?? null;
  return Object.freeze({
    proyeccionId: registro.proyeccionId,
    elementoOrigenId: registro.elementoOrigenId,
    triggerOrigenId: registro.triggerOrigenId,
    monitorReferencia: payload.monitorReferencia,
    monitorFederado: presentarMonitorResuelto(monitor),
    activo: payload.activo,
    ordenEjecucion: payload.ordenEjecucion,
    eventosDisparo: Object.freeze([...payload.eventosDisparo]),
    tieneConfiguracionOverride: payload.configuracionOverride !== null,
    contenidoSensible: presentarDeclaracionSensible(payload.contenidoSensible),
    completitud: registro.completitud,
    estadoProyeccion: registro.estadoProyeccion
  });
}

function presentarEjecucion(registro, monitoresPorId) {
  const payload = registro.payload;
  const monitor = payload.monitorReferencia
    ? monitoresPorId.get(payload.monitorReferencia.elementoOrigenId) ?? null
    : null;
  return Object.freeze({
    proyeccionId: registro.proyeccionId,
    elementoOrigenId: registro.elementoOrigenId,
    triggerOrigenId: registro.triggerOrigenId,
    nombre: payload.triggerNombre,
    tipo: payload.tipoTrigger,
    estado: payload.estadoEjecucion,
    eventoDisparo: payload.eventoDisparo,
    codigoResultado: payload.codigoResultado,
    mensajeResultado: payload.mensajeResultado,
    versionCatalogo: payload.versionCatalogo,
    iniciadoEnUtc: payload.iniciadoEnUtc,
    finalizadoEnUtc: payload.finalizadoEnUtc,
    duracionMs: Math.max(0,
      Date.parse(payload.finalizadoEnUtc) - Date.parse(payload.iniciadoEnUtc)),
    monitorReferencia: payload.monitorReferencia,
    monitorFederado: presentarMonitorResuelto(monitor),
    asignacionReferencia: payload.asignacionReferencia,
    contenido: Object.freeze({
      solicitud: presentarDeclaracionSensible(payload.payloadSolicitud),
      respuesta: presentarDeclaracionSensible(payload.payloadRespuesta),
      error: presentarDeclaracionSensible(payload.payloadError)
    }),
    resultadoCorreo: payload.tipoTrigger === 'correo'
      ? presentarResultadoCorreo(payload.resultadoCorreo)
      : null,
    completitud: registro.completitud
  });
}

function presentarResultadoCorreo(resultado) {
  return Object.freeze({
    detalleEstado: resultado?.detalleEstado || 'ausente',
    totalResultadosDestinatarios:
      resultado?.totalResultadosDestinatarios ?? null,
    totalSalidas: resultado?.totalSalidas ?? null
  });
}

const CAPACIDAD_NO_APLICABLE = Object.freeze({
  disponible: true,
  codigo: 'no_aplicable'
});

async function evaluarCapacidadCorreoLocal(evaluar) {
  if (typeof evaluar !== 'function') {
    return Object.freeze({
      disponible: false,
      codigo: 'capacidad_local_no_evaluable'
    });
  }
  try {
    const resultado = await evaluar({ tipo: 'correo' });
    return Object.freeze({
      disponible: resultado?.disponible === true,
      codigo: String(resultado?.codigo || (
        resultado?.disponible === true ? 'capacidad_local_disponible' :
          'capacidad_local_no_disponible'
      ))
    });
  } catch (error) {
    return Object.freeze({
      disponible: false,
      codigo: String(error?.codigo || 'capacidad_local_no_disponible')
    });
  }
}

function referenciasMonitores(asignaciones, ejecuciones) {
  return [...new Set([
    ...asignaciones.map((registro) =>
      registro.payload.monitorReferencia.elementoOrigenId),
    ...ejecuciones.map((registro) =>
      registro.payload.monitorReferencia?.elementoOrigenId).filter(Boolean)
  ])];
}

function presentarMonitorResuelto(monitor) {
  if (monitor === null) return null;
  return Object.freeze({
    elementoOrigenId: monitor.elementoOrigenId,
    nombre: monitor.nombre,
    tipo: monitor.tipo,
    activo: monitor.activo
  });
}

function presentarDeclaracionSensible(declaracion) {
  return Object.freeze({
    estado: declaracion?.estado || 'omitido',
    causa: declaracion?.estado === 'omitido' ? declaracion.causa : null
  });
}

function sanearConfiguracion(valor) {
  if (Array.isArray(valor)) return Object.freeze(valor.map(sanearConfiguracion));
  if (!valor || typeof valor !== 'object') return valor;
  return Object.freeze(Object.fromEntries(Object.entries(valor)
    .filter(([clave]) => !CLAVES_SENSIBLES.test(clave))
    .map(([clave, contenido]) => [
      clave,
      /^(?:url|uri|endpoint)$/iu.test(clave) && typeof contenido === 'string'
        ? sanearUrl(contenido)
        : sanearConfiguracion(contenido)
    ])));
}

function sanearUrl(valor) {
  try {
    const url = new URL(valor);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    url.username = '';
    url.password = '';
    for (const clave of [...url.searchParams.keys()]) {
      if (CLAVES_SENSIBLES.test(clave)) url.searchParams.delete(clave);
    }
    return url.toString();
  } catch {
    return '';
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

function validarIdentidad(valor, tipo, codigo, mensaje) {
  try {
    return String(crearIdentidadFederada({ valor: String(valor || ''), tipo }));
  } catch {
    throw errorHttp(400, codigo, mensaje);
  }
}

function errorHttp(statusCode, codigo, mensaje) {
  return Object.assign(new Error(mensaje), { statusCode, codigo });
}
