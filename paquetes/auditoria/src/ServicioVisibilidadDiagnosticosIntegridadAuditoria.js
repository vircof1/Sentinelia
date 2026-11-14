const ESTADOS_PROBLEMATICOS = new Set(['rota', 'incompleta', 'sin_datos', 'pendiente']);
const NIVELES_SCOPE = new Set(['portal', 'tenant', 'empresa', 'sitio']);

export class ServicioVisibilidadDiagnosticosIntegridadAuditoria {
  construirVista({ contextoUsuarioActual, diagnosticos = [], incidentes = [] } = {}) {
    validarContexto(contextoUsuarioActual);
    if (!contextoUsuarioActual.permisos?.verAuditoria) {
      return Object.freeze({
        autorizado: false,
        resumen: Object.freeze({ total: 0, problematicos: 0, pendientes: 0 }),
        cadenas: Object.freeze([]),
        incidentes: Object.freeze([])
      });
    }

    const diagnosticosVisibles = diagnosticos.filter((diagnostico) =>
      cadenaVisibleParaContexto(diagnostico.claveCadena, contextoUsuarioActual)
    );
    const incidentesVisibles = incidentes.filter((incidente) =>
      cadenaVisibleParaContexto(incidente.claveCadena, contextoUsuarioActual)
    );
    return Object.freeze({
      autorizado: true,
      resumen: Object.freeze({
        total: diagnosticosVisibles.length,
        problematicos: diagnosticosVisibles.filter((diagnostico) =>
          ESTADOS_PROBLEMATICOS.has(diagnostico.estadoVerificacion)
        ).length,
        pendientes: diagnosticosVisibles.filter((diagnostico) =>
          diagnostico.pendienteRevision === true ||
          diagnostico.estadoVerificacion === 'pendiente'
        ).length
      }),
      cadenas: Object.freeze(diagnosticosVisibles.map((diagnostico) =>
        serializarDiagnostico(diagnostico, contextoUsuarioActual)
      )),
      incidentes: Object.freeze(incidentesVisibles.map((incidente) =>
        serializarIncidente(incidente, contextoUsuarioActual)
      ))
    });
  }

  planificarNotificaciones({ diagnosticoAnterior = null, diagnosticoActual, incidentesActivos = [], contextoDestino } = {}) {
    validarContexto(contextoDestino);
    if (!contextoDestino.permisos?.verAuditoria) return Object.freeze([]);
    if (!diagnosticoActual || !cadenaVisibleParaContexto(diagnosticoActual.claveCadena, contextoDestino)) {
      return Object.freeze([]);
    }
    const estadoAnterior = diagnosticoAnterior?.estadoVerificacion ?? null;
    const estadoActual = diagnosticoActual.estadoVerificacion;
    const nuevaTransicionProblematica =
      ESTADOS_PROBLEMATICOS.has(estadoActual) &&
      estadoAnterior !== estadoActual &&
      !ESTADOS_PROBLEMATICOS.has(estadoAnterior);
    if (!nuevaTransicionProblematica) return Object.freeze([]);

    const incidentesNotificables = incidentesActivos
      .filter((incidente) =>
        incidente.estadoDeteccion === 'activo' &&
        !incidente.reconocidoEnUtc &&
        incidente.claveCadena === diagnosticoActual.claveCadena
      )
      .filter((incidente, indice, lista) =>
        lista.findIndex((actual) => actual.huella === incidente.huella) === indice
      );

    if (incidentesNotificables.length === 0) {
      return Object.freeze([Object.freeze({
        claveCadena: diagnosticoActual.claveCadena,
        estado: estadoActual,
        severidad: severidadEstado(estadoActual),
        resumen: resumenPublico(diagnosticoActual, contextoDestino)
      })]);
    }
    return Object.freeze(incidentesNotificables.map((incidente) => Object.freeze({
      claveCadena: incidente.claveCadena,
      episodioId: incidente.episodioId,
      estado: estadoActual,
      severidad: severidadEstado(estadoActual),
      resumen: resumenPublico(diagnosticoActual, contextoDestino),
      incidente: serializarIncidente(incidente, contextoDestino)
    })));
  }
}

function serializarDiagnostico(diagnostico, contexto) {
  const completo = tieneAlcanceCompletoCadena(diagnostico.claveCadena, contexto);
  const base = {
    claveCadena: diagnostico.claveCadena,
    estadoVerificacion: diagnostico.estadoVerificacion,
    pendienteRevision: Boolean(diagnostico.pendienteRevision),
    alcanceDetalle: completo ? 'completo' : 'resumen'
  };
  if (!completo) return Object.freeze(base);
  return Object.freeze({
    ...base,
    desdeSecuencia: diagnostico.desdeSecuencia ?? null,
    hastaSecuencia: diagnostico.hastaSecuencia ?? null,
    ultimaSecuenciaVerificada: diagnostico.ultimaSecuenciaVerificada ?? null,
    hashFinalVerificado: diagnostico.hashFinalVerificado ?? null,
    hashFinalEsperado: diagnostico.hashFinalEsperado ?? null,
    cabeceraUltimaSecuencia: diagnostico.cabeceraUltimaSecuencia ?? null,
    cabeceraUltimoHash: diagnostico.cabeceraUltimoHash ?? null,
    actualizadoEnUtc: diagnostico.actualizadoEnUtc ?? null,
    diagnostico: diagnostico.diagnostico ?? null
  });
}

function serializarIncidente(incidente, contexto) {
  const completo = tieneAlcanceCompletoCadena(incidente.claveCadena, contexto);
  const base = {
    episodioId: incidente.episodioId,
    claveCadena: incidente.claveCadena,
    codigo: incidente.codigo,
    estadoDeteccion: incidente.estadoDeteccion,
    reconocido: Boolean(incidente.reconocidoEnUtc),
    alcanceDetalle: completo ? 'completo' : 'resumen'
  };
  if (!completo) return Object.freeze(base);
  return Object.freeze({
    ...base,
    huella: incidente.huella,
    primeraDeteccionUtc: incidente.primeraDeteccionUtc ?? null,
    ultimaDeteccionUtc: incidente.ultimaDeteccionUtc ?? null,
    resueltoEnUtc: incidente.resueltoEnUtc ?? null,
    reconocidoEnUtc: incidente.reconocidoEnUtc ?? null,
    reconocidoPorUsuarioId: incidente.reconocidoPorUsuarioId ?? null,
    detalle: incidente.detalle ?? null
  });
}

function resumenPublico(diagnostico, contexto) {
  if (tieneAlcanceCompletoCadena(diagnostico.claveCadena, contexto)) {
    return Object.freeze({
      claveCadena: diagnostico.claveCadena,
      estadoVerificacion: diagnostico.estadoVerificacion,
      hastaSecuencia: diagnostico.hastaSecuencia ?? null,
      cabeceraUltimaSecuencia: diagnostico.cabeceraUltimaSecuencia ?? null
    });
  }
  return Object.freeze({
    claveCadena: diagnostico.claveCadena,
    estadoVerificacion: diagnostico.estadoVerificacion
  });
}

export function cadenaVisibleParaContexto(claveCadena, contexto) {
  if (contexto.nivelScope === 'portal') return true;
  const tenantCadena = tenantDeClaveCadena(claveCadena);
  if (tenantCadena === null) return false;
  return String(contexto.tenantId) === tenantCadena;
}

export function tieneAlcanceCompletoCadena(claveCadena, contexto) {
  if (contexto.nivelScope === 'portal') return true;
  const tenantCadena = tenantDeClaveCadena(claveCadena);
  return contexto.nivelScope === 'tenant' && tenantCadena !== null &&
    String(contexto.tenantId) === tenantCadena;
}

function tenantDeClaveCadena(claveCadena) {
  const coincidencia = String(claveCadena).match(/^[a-z_]+:tenant:([1-9][0-9]*)$/);
  return coincidencia ? coincidencia[1] : null;
}

function severidadEstado(estado) {
  if (estado === 'rota') return 'critica';
  if (estado === 'incompleta' || estado === 'sin_datos') return 'alta';
  if (estado === 'pendiente') return 'media';
  return 'informativa';
}

function validarContexto(contexto) {
  if (!contexto || !NIVELES_SCOPE.has(contexto.nivelScope)) {
    throw new Error('Contexto de visibilidad de auditoría no válido.');
  }
}
