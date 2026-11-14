import { normalizarMarcaUtc } from '../../utilidades/src/fechas/normalizarMarcaUtc.js';

export class SesionAgenteSentinelia {
  constructor({
    agenteId,
    guid,
    tenantId,
    empresaId,
    sitioId,
    sessionId,
    sessionTokenHash,
    versionSecreto,
    bootId = null,
    hostname = null,
    versionAgente = null,
    sessionIdAnterior = null,
    sospechas = [],
    ultimoHeartbeatUtc = null,
    ultimoSeq = null,
    uptimeSeconds = null,
    creadoEnUtc = new Date(),
    expiraEnUtc = null,
    ttlSegundos = 900
  }) {
    this.agenteId = normalizarEntero(agenteId, 'El agente de la sesión es obligatorio.');
    this.guid = normalizarTexto(guid, 80, 'El GUID de la sesión es obligatorio.');
    this.tenantId = normalizarEntero(tenantId, 'El tenant de la sesión es obligatorio.');
    this.empresaId = normalizarEntero(empresaId, 'La empresa de la sesión es obligatoria.');
    this.sitioId = normalizarEntero(sitioId, 'El sitio de la sesión es obligatorio.');
    this.sessionId = normalizarTexto(sessionId, 80, 'El identificador de sesión es obligatorio.');
    this.sessionTokenHash = normalizarHash(sessionTokenHash);
    this.versionSecreto = normalizarEntero(versionSecreto, 'La versión del secreto es obligatoria.');
    this.bootId = normalizarTextoOpcional(bootId, 120);
    this.hostname = normalizarTextoOpcional(hostname, 255);
    this.versionAgente = normalizarTextoOpcional(versionAgente, 80);
    this.sessionIdAnterior = normalizarTextoOpcional(sessionIdAnterior, 80);
    this.sospechas = normalizarListaSospechas(sospechas);
    this.ultimoHeartbeatUtc = normalizarMarcaUtc(ultimoHeartbeatUtc);
    this.ultimoSeq = normalizarEnteroOpcional(ultimoSeq);
    this.uptimeSeconds = normalizarEnteroOpcional(uptimeSeconds);
    this.ttlSegundos = Math.max(1, Number.parseInt(String(ttlSegundos), 10) || 900);
    this.creadoEnUtc = normalizarMarcaUtc(creadoEnUtc) || new Date().toISOString();
    this.expiraEnUtc =
      normalizarMarcaUtc(expiraEnUtc) || calcularExpiracion(this.creadoEnUtc, this.ttlSegundos);
  }

  serializarRedis() {
    return {
      agenteId: this.agenteId,
      guid: this.guid,
      tenantId: this.tenantId,
      empresaId: this.empresaId,
      sitioId: this.sitioId,
      sessionId: this.sessionId,
      sessionTokenHash: this.sessionTokenHash,
      versionSecreto: this.versionSecreto,
      bootId: this.bootId,
      hostname: this.hostname,
      versionAgente: this.versionAgente,
      sessionIdAnterior: this.sessionIdAnterior,
      sospechas: this.sospechas,
      ultimoHeartbeatUtc: this.ultimoHeartbeatUtc,
      ultimoSeq: this.ultimoSeq,
      uptimeSeconds: this.uptimeSeconds,
      creadoEnUtc: this.creadoEnUtc,
      expiraEnUtc: this.expiraEnUtc,
      ttlSegundos: this.ttlSegundos
    };
  }

  obtenerIndiceActualRedis() {
    return {
      agenteId: this.agenteId,
      guid: this.guid,
      sessionId: this.sessionId,
      sessionTokenHash: this.sessionTokenHash,
      bootId: this.bootId,
      hostname: this.hostname,
      versionAgente: this.versionAgente,
      ultimoHeartbeatUtc: this.ultimoHeartbeatUtc,
      ultimoSeq: this.ultimoSeq,
      creadoEnUtc: this.creadoEnUtc,
      expiraEnUtc: this.expiraEnUtc
    };
  }

  obtenerRespuestaPublica() {
    return {
      agenteId: this.agenteId,
      guid: this.guid,
      tenantId: this.tenantId,
      empresaId: this.empresaId,
      sitioId: this.sitioId,
      sessionId: this.sessionId,
      bootId: this.bootId,
      hostname: this.hostname,
      versionAgente: this.versionAgente,
      sessionIdAnterior: this.sessionIdAnterior,
      sospechas: this.sospechas,
      ultimoHeartbeatUtc: this.ultimoHeartbeatUtc,
      ultimoSeq: this.ultimoSeq,
      uptimeSeconds: this.uptimeSeconds,
      creadoEnUtc: this.creadoEnUtc,
      expiraEnUtc: this.expiraEnUtc,
      ttlSegundos: this.ttlSegundos
    };
  }
}

export function crearSesionAgenteDesdeRedis(payload) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  return new SesionAgenteSentinelia(payload);
}

function normalizarEntero(valor, mensaje) {
  const convertido = Number.parseInt(String(valor ?? ''), 10);

  if (!Number.isInteger(convertido) || convertido <= 0) {
    throw new Error(mensaje);
  }

  return convertido;
}

function normalizarEnteroOpcional(valor) {
  if (valor == null || String(valor).trim() === '') {
    return null;
  }

  const convertido = Number.parseInt(String(valor), 10);
  return Number.isInteger(convertido) && convertido >= 0 ? convertido : null;
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

function normalizarHash(valor) {
  const normalizado = String(valor || '').trim().toLowerCase();

  if (!/^[0-9a-f]{64}$/.test(normalizado)) {
    throw new Error('La huella de sesión del agente no es válida.');
  }

  return normalizado;
}

function normalizarListaSospechas(sospechas) {
  if (!Array.isArray(sospechas)) {
    return [];
  }

  return [...new Set(
    sospechas
      .map((sospecha) => String(sospecha || '').trim().toLowerCase())
      .filter(Boolean)
  )];
}

function calcularExpiracion(creadoEnUtc, ttlSegundos) {
  const base = new Date(creadoEnUtc);
  const fechaBase = Number.isNaN(base.getTime()) ? new Date() : base;
  return new Date(fechaBase.getTime() + ttlSegundos * 1000).toISOString();
}
