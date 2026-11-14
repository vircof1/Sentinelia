function normalizarEntero(valor, porDefecto = null) {
  const convertido = Number.parseInt(String(valor ?? ''), 10);
  return Number.isInteger(convertido) ? convertido : porDefecto;
}

function normalizarFechaUtc(valor) {
  if (!valor) {
    return null;
  }

  const fecha = new Date(valor);
  return Number.isNaN(fecha.getTime()) ? null : fecha.toISOString();
}

function seleccionarFechaMasReciente(...valores) {
  return valores
    .map((valor) => normalizarFechaUtc(valor))
    .filter(Boolean)
    .sort()
    .at(-1) || null;
}

export class LecturaOperativaAgente {
  constructor({
    agente,
    referenciaSesionRedis = null
  }) {
    if (!agente) {
      throw new Error('El agente de la lectura operativa es obligatorio.');
    }

    const resumen = typeof agente.obtenerResumenAdministrativo === 'function'
      ? agente.obtenerResumenAdministrativo()
      : agente;
    const sesionRedis = normalizarReferenciaSesionRedis(referenciaSesionRedis);

    this.id = resumen.id;
    this.guid = resumen.guid;
    this.nombre = resumen.nombre;
    this.descripcion = resumen.descripcion || null;
    this.tenantId = resumen.tenantId;
    this.tenantNombre = resumen.tenantNombre || null;
    this.empresaId = resumen.empresaId;
    this.empresaNombre = resumen.empresaNombre || null;
    this.sitioId = resumen.sitioId;
    this.sitioNombre = resumen.sitioNombre || null;
    this.versionSecreto = normalizarEntero(resumen.versionSecreto, 1);
    this.estadoAdministrativo = resumen.estadoAdministrativo;
    this.estadoAcceso = resumen.estadoAcceso;
    this.estadoVidaPol = resumen.estadoVidaPol;
    this.estadoEfectivo = resumen.estadoEfectivo;
    this.cuarentenaHastaUtc = normalizarFechaUtc(resumen.cuarentenaHastaUtc);
    this.ultimoLoginUtc = normalizarFechaUtc(resumen.ultimoLoginUtc);
    this.ultimoHeartbeatUtc = normalizarFechaUtc(resumen.ultimoHeartbeatUtc);
    this.ultimoBootId = resumen.ultimoBootId || null;
    this.ultimaVersionAgente = resumen.ultimaVersionAgente || null;
    this.ultimoHostname = resumen.ultimoHostname || null;
    this.ultimoSeq = normalizarEntero(resumen.ultimoSeq, null);
    this.tieneSesionDiagnostica = Boolean(resumen.tieneSesionDiagnostica);
    this.fechaCreacion = normalizarFechaUtc(resumen.fechaCreacion);
    this.fechaActualizacion = normalizarFechaUtc(resumen.fechaActualizacion);
    this.sesionRedis = sesionRedis;
    this.ultimaConexionUtc = seleccionarFechaMasReciente(
      this.ultimoLoginUtc,
      this.ultimoHeartbeatUtc,
      sesionRedis.sesion?.creadoEnUtc,
      sesionRedis.sesion?.ultimoHeartbeatUtc
    );
  }

  serializar() {
    return {
      id: this.id,
      guid: this.guid,
      nombre: this.nombre,
      descripcion: this.descripcion,
      tenantId: this.tenantId,
      tenantNombre: this.tenantNombre,
      empresaId: this.empresaId,
      empresaNombre: this.empresaNombre,
      sitioId: this.sitioId,
      sitioNombre: this.sitioNombre,
      versionSecreto: this.versionSecreto,
      estadoAdministrativo: this.estadoAdministrativo,
      estadoAcceso: this.estadoAcceso,
      estadoVidaPol: this.estadoVidaPol,
      estadoEfectivo: this.estadoEfectivo,
      cuarentenaHastaUtc: this.cuarentenaHastaUtc,
      ultimoLoginUtc: this.ultimoLoginUtc,
      ultimoHeartbeatUtc: this.ultimoHeartbeatUtc,
      ultimoBootId: this.ultimoBootId,
      ultimaVersionAgente: this.ultimaVersionAgente,
      ultimoHostname: this.ultimoHostname,
      ultimoSeq: this.ultimoSeq,
      tieneSesionDiagnostica: this.tieneSesionDiagnostica,
      fechaCreacion: this.fechaCreacion,
      fechaActualizacion: this.fechaActualizacion,
      ultimaConexionUtc: this.ultimaConexionUtc,
      sesionRedis: this.sesionRedis
    };
  }
}

export function crearLecturaOperativaAgente({ agente, referenciaSesionRedis }) {
  return new LecturaOperativaAgente({ agente, referenciaSesionRedis });
}

function normalizarReferenciaSesionRedis(referenciaSesionRedis) {
  const estado = String(referenciaSesionRedis?.estado || 'sin_sesion').trim();
  const sesion = referenciaSesionRedis?.sesion || null;

  return {
    estado,
    viva: estado === 'viva' && Boolean(sesion),
    ttlRestanteSegundos: Math.max(
      0,
      normalizarEntero(referenciaSesionRedis?.ttlRestanteSegundos, 0)
    ),
    sesion: sesion
      ? normalizarSesionPublica(sesion)
      : null
  };
}

function normalizarSesionPublica(sesion) {
  const publica = typeof sesion.obtenerRespuestaPublica === 'function'
    ? sesion.obtenerRespuestaPublica()
    : sesion;

  return {
    agenteId: normalizarEntero(publica.agenteId, null),
    guid: publica.guid || null,
    tenantId: normalizarEntero(publica.tenantId, null),
    empresaId: normalizarEntero(publica.empresaId, null),
    sitioId: normalizarEntero(publica.sitioId, null),
    sessionId: publica.sessionId || null,
    bootId: publica.bootId || null,
    hostname: publica.hostname || null,
    versionAgente: publica.versionAgente || null,
    sessionIdAnterior: publica.sessionIdAnterior || null,
    sospechas: Array.isArray(publica.sospechas) ? publica.sospechas : [],
    ultimoHeartbeatUtc: normalizarFechaUtc(publica.ultimoHeartbeatUtc),
    ultimoSeq: normalizarEntero(publica.ultimoSeq, null),
    uptimeSeconds: normalizarEntero(publica.uptimeSeconds, null),
    creadoEnUtc: normalizarFechaUtc(publica.creadoEnUtc),
    expiraEnUtc: normalizarFechaUtc(publica.expiraEnUtc),
    ttlSegundos: Math.max(0, normalizarEntero(publica.ttlSegundos, 0))
  };
}
