export class SolicitudRefreshSesionAgente {
  constructor({
    sessionIdActual,
    bootId,
    revisionConfiguracionConocida = null,
    revisionPoliticaConocida = null,
    timestampClienteUtc = null
  }) {
    this.sessionIdActual = normalizarTexto(
      sessionIdActual,
      96,
      'La sesión actual del agente es obligatoria.'
    );
    this.bootId = normalizarTexto(
      bootId,
      120,
      'El bootId del agente es obligatorio.'
    );
    this.revisionConfiguracionConocida = normalizarTextoOpcional(
      revisionConfiguracionConocida,
      120
    );
    this.revisionPoliticaConocida = normalizarTextoOpcional(
      revisionPoliticaConocida,
      120
    );
    this.timestampClienteUtc = normalizarFechaOpcional(timestampClienteUtc);
  }

  comprobarCoherenciaConSesion(sesionViva) {
    if (!sesionViva) {
      return 'sesion_no_vigente';
    }

    if (this.sessionIdActual !== sesionViva.sessionId) {
      return 'session_id_actual_no_coincide';
    }

    if (normalizarTextoOpcional(sesionViva.bootId, 120) !== this.bootId) {
      return 'boot_id_incoherente';
    }

    return null;
  }

  obtenerCoordinacion({
    revisionConfiguracionActual = null,
    revisionPoliticaActual = null
  } = {}) {
    const revisionConfiguracion = normalizarTextoOpcional(
      revisionConfiguracionActual,
      120
    );
    const revisionPolitica = normalizarTextoOpcional(revisionPoliticaActual, 120);

    return {
      requiereConfiguracion:
        Boolean(revisionConfiguracion) &&
        revisionConfiguracion !== this.revisionConfiguracionConocida,
      revisionConfiguracionActual: revisionConfiguracion,
      requierePolitica:
        Boolean(revisionPolitica) &&
        revisionPolitica !== this.revisionPoliticaConocida,
      revisionPoliticaActual: revisionPolitica
    };
  }
}

export function crearSolicitudRefreshSesionAgente(datos) {
  return datos instanceof SolicitudRefreshSesionAgente
    ? datos
    : new SolicitudRefreshSesionAgente(datos || {});
}

function normalizarTexto(valor, longitudMaxima, mensaje) {
  const normalizado = String(valor || '').trim();

  if (!normalizado) {
    throw new Error(mensaje);
  }

  return normalizado.slice(0, longitudMaxima);
}

function normalizarTextoOpcional(valor, longitudMaxima) {
  const normalizado = String(valor || '').trim();
  return normalizado ? normalizado.slice(0, longitudMaxima) : null;
}

function normalizarFechaOpcional(valor) {
  const normalizado = String(valor || '').trim();

  if (!normalizado) {
    return null;
  }

  const fecha = new Date(normalizado);
  return Number.isNaN(fecha.getTime()) ? null : fecha.toISOString();
}
