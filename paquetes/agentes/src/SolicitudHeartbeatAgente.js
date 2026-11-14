export class SolicitudHeartbeatAgente {
  constructor({
    seq,
    bootId,
    timestampClienteUtc = null,
    uptimeSeconds = null
  }) {
    this.seq = normalizarEnteroMinimo(
      seq,
      0,
      'La secuencia del heartbeat es obligatoria.'
    );
    this.bootId = normalizarTexto(
      bootId,
      120,
      'El bootId del heartbeat es obligatorio.'
    );
    this.timestampClienteUtc = normalizarFechaOpcional(timestampClienteUtc);
    this.uptimeSeconds = normalizarEnteroOpcional(uptimeSeconds, 0);
  }

  comprobarCoherenciaConSesion(sesionViva) {
    if (!sesionViva) {
      return 'sesion_no_vigente';
    }

    if (normalizarTextoOpcional(sesionViva.bootId, 120) !== this.bootId) {
      return 'boot_id_incoherente';
    }

    return null;
  }

  comprobarSecuencia({ ultimoSeq = null } = {}) {
    const ultimo = normalizarEnteroOpcional(ultimoSeq, 0);

    if (ultimo != null && this.seq <= ultimo) {
      return 'heartbeat_seq_antiguo';
    }

    return null;
  }

  obtenerHeartbeatAceptado({ recibidoEnUtc = new Date() } = {}) {
    const recibido = normalizarFechaServidor(recibidoEnUtc);

    return {
      seqAceptado: this.seq,
      recibidoEnUtc: recibido,
      desfaseClienteMs: this.calcularDesfaseClienteMs(recibido)
    };
  }

  obtenerCoordinacion({
    ttlRestanteSegundos = null,
    renewBeforeSeconds = 120,
    revisionConfiguracionActual = null,
    revisionConfiguracionConocida = null,
    revisionPoliticaActual = null,
    revisionPoliticaConocida = null
  } = {}) {
    const ttl = normalizarEnteroOpcional(ttlRestanteSegundos, 0);
    const margenRefresh = normalizarEnteroMinimo(
      renewBeforeSeconds,
      1,
      'El margen de renovación debe ser positivo.'
    );
    const revisionConfiguracion = normalizarTextoOpcional(
      revisionConfiguracionActual,
      120
    );
    const revisionPolitica = normalizarTextoOpcional(
      revisionPoliticaActual,
      120
    );
    const configuracionConocida = normalizarTextoOpcional(
      revisionConfiguracionConocida,
      120
    );
    const politicaConocida = normalizarTextoOpcional(
      revisionPoliticaConocida,
      120
    );
    const requiereRefreshSesion = ttl != null && ttl <= margenRefresh;
    const requiereConfiguracion =
      Boolean(revisionConfiguracion) &&
      revisionConfiguracion !== configuracionConocida;
    const requierePolitica =
      Boolean(revisionPolitica) &&
      revisionPolitica !== politicaConocida;

    return {
      accion: resolverAccionCoordinacion({
        requiereRefreshSesion,
        requiereConfiguracion,
        requierePolitica
      }),
      requiereRefreshSesion,
      requiereConfiguracion,
      revisionConfiguracionActual: revisionConfiguracion,
      requierePolitica,
      revisionPoliticaActual: revisionPolitica
    };
  }

  calcularDesfaseClienteMs(recibidoEnUtc) {
    if (!this.timestampClienteUtc) {
      return null;
    }

    return (
      new Date(this.timestampClienteUtc).getTime() -
      new Date(recibidoEnUtc).getTime()
    );
  }
}

export function crearSolicitudHeartbeatAgente(datos) {
  return datos instanceof SolicitudHeartbeatAgente
    ? datos
    : new SolicitudHeartbeatAgente(datos || {});
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

function normalizarEnteroMinimo(valor, minimo, mensaje) {
  const convertido = Number.parseInt(String(valor ?? ''), 10);

  if (!Number.isInteger(convertido) || convertido < minimo) {
    throw new Error(mensaje);
  }

  return convertido;
}

function normalizarEnteroOpcional(valor, minimo) {
  if (valor == null || String(valor).trim() === '') {
    return null;
  }

  const convertido = Number.parseInt(String(valor), 10);

  if (!Number.isInteger(convertido) || convertido < minimo) {
    return null;
  }

  return convertido;
}

function normalizarFechaOpcional(valor) {
  const normalizado = String(valor || '').trim();

  if (!normalizado) {
    return null;
  }

  const fecha = new Date(normalizado);
  return Number.isNaN(fecha.getTime()) ? null : fecha.toISOString();
}

function normalizarFechaServidor(valor) {
  const fecha = valor instanceof Date ? valor : new Date(valor);
  return Number.isNaN(fecha.getTime())
    ? new Date().toISOString()
    : fecha.toISOString();
}

function resolverAccionCoordinacion({
  requiereRefreshSesion,
  requiereConfiguracion,
  requierePolitica
}) {
  if (requiereRefreshSesion) {
    return 'refresh_session';
  }

  if (requiereConfiguracion || requierePolitica) {
    return 'refresh_config';
  }

  return 'continue';
}
