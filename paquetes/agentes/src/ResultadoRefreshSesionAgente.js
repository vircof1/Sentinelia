export class ResultadoRefreshSesionAgente {
  constructor({
    agente,
    sesion,
    sessionToken,
    previousSessionId,
    ttlSegundos,
    renewBeforeSeconds,
    coordinacion,
    periodoVidaPol = null
  }) {
    this.agente = agente;
    this.sesion = sesion;
    this.sessionToken = String(sessionToken || '').trim();
    this.previousSessionId = String(previousSessionId || '').trim() || null;
    this.ttlSegundos = normalizarEntero(ttlSegundos);
    this.renewBeforeSeconds = normalizarEntero(
      renewBeforeSeconds,
      Math.max(1, Math.floor(this.ttlSegundos / 5))
    );
    this.coordinacion = normalizarCoordinacion(coordinacion);
    this.periodoVidaPol = periodoVidaPol;
  }

  obtenerRespuestaPublica() {
    return {
      agente: this.agente,
      sesion: {
        sessionId: this.sesion.sessionId,
        sessionToken: this.sessionToken,
        previousSessionId: this.previousSessionId,
        expiresInSeconds: this.ttlSegundos,
        renewBeforeSeconds: this.renewBeforeSeconds
      },
      coordinacion: this.coordinacion,
      pol: {
        estadoVidaPol: this.agente?.estadoVidaPol || 'vivo',
        periodoId: this.periodoVidaPol?.id || null
      }
    };
  }
}

function normalizarEntero(valor, porDefecto = 900) {
  const convertido = Number.parseInt(String(valor ?? ''), 10);
  return Number.isInteger(convertido) && convertido > 0 ? convertido : porDefecto;
}

function normalizarCoordinacion(coordinacion = {}) {
  return {
    requiereConfiguracion: Boolean(coordinacion.requiereConfiguracion),
    revisionConfiguracionActual:
      normalizarTextoOpcional(coordinacion.revisionConfiguracionActual),
    requierePolitica: Boolean(coordinacion.requierePolitica),
    revisionPoliticaActual:
      normalizarTextoOpcional(coordinacion.revisionPoliticaActual)
  };
}

function normalizarTextoOpcional(valor) {
  const normalizado = String(valor || '').trim();
  return normalizado || null;
}
