export class ResultadoHeartbeatAgente {
  constructor({
    agente,
    sesion,
    ttlRestanteSegundos,
    renewBeforeSeconds,
    heartbeat,
    periodoVidaPol = null,
    estadoVidaPol = 'vivo',
    coordinacion
  }) {
    this.agente = agente;
    this.sesion = sesion;
    this.ttlRestanteSegundos = normalizarEntero(ttlRestanteSegundos, 0);
    this.renewBeforeSeconds = normalizarEntero(renewBeforeSeconds, 120);
    this.heartbeat = normalizarHeartbeat(heartbeat);
    this.periodoVidaPol = periodoVidaPol;
    this.estadoVidaPol = String(estadoVidaPol || 'vivo').trim() || 'vivo';
    this.coordinacion = normalizarCoordinacion(coordinacion);
  }

  obtenerRespuestaPublica() {
    return {
      agente: this.agente,
      sesion: {
        sessionId: this.sesion.sessionId,
        expiresInSeconds: Math.max(0, this.ttlRestanteSegundos),
        renewBeforeSeconds: this.renewBeforeSeconds
      },
      heartbeat: this.heartbeat,
      pol: {
        estadoVidaPol: this.estadoVidaPol,
        periodoId: this.periodoVidaPol?.id || null,
        heartbeatsRecibidos: normalizarEntero(
          this.periodoVidaPol?.heartbeatsRecibidos,
          0
        ),
        ultimoSeq:
          this.periodoVidaPol?.ultimoSeq == null
            ? null
            : normalizarEntero(this.periodoVidaPol.ultimoSeq, null)
      },
      coordinacion: this.coordinacion
    };
  }
}

function normalizarHeartbeat(heartbeat = {}) {
  return {
    seqAceptado: normalizarEntero(heartbeat.seqAceptado, 0),
    recibidoEnUtc: normalizarFechaServidor(heartbeat.recibidoEnUtc),
    desfaseClienteMs:
      heartbeat.desfaseClienteMs == null
        ? null
        : normalizarEntero(heartbeat.desfaseClienteMs, 0)
  };
}

function normalizarCoordinacion(coordinacion = {}) {
  return {
    accion: normalizarAccion(coordinacion.accion),
    requiereRefreshSesion: Boolean(coordinacion.requiereRefreshSesion),
    requiereConfiguracion: Boolean(coordinacion.requiereConfiguracion),
    revisionConfiguracionActual:
      normalizarTextoOpcional(coordinacion.revisionConfiguracionActual),
    requierePolitica: Boolean(coordinacion.requierePolitica),
    revisionPoliticaActual:
      normalizarTextoOpcional(coordinacion.revisionPoliticaActual)
  };
}

function normalizarAccion(valor) {
  const normalizada = String(valor || '').trim();
  return ['continue', 'refresh_session', 'refresh_config', 'login_required'].includes(
    normalizada
  )
    ? normalizada
    : 'continue';
}

function normalizarEntero(valor, porDefecto) {
  const convertido = Number.parseInt(String(valor ?? ''), 10);
  return Number.isInteger(convertido) ? convertido : porDefecto;
}

function normalizarFechaServidor(valor) {
  const fecha = valor instanceof Date ? valor : new Date(valor);
  return Number.isNaN(fecha.getTime())
    ? new Date().toISOString()
    : fecha.toISOString();
}

function normalizarTextoOpcional(valor) {
  const normalizado = String(valor || '').trim();
  return normalizado || null;
}
