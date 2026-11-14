import {
  createHash,
  createHmac,
  timingSafeEqual
} from 'node:crypto';

import { canonicalizarRfc8785 } from '../../auditoria/src/PerfilJcsAuditoria.js';
import { validarUuidV7Auditoria } from '../../auditoria/src/UuidV7Auditoria.js';

const PREFIJO = 'sea1';
const PERFIL = 'sentinelia-confirmacion-eliminacion-agente-v1';
const CAMPOS = Object.freeze([
  'perfil',
  'version',
  'actorRealId',
  'actorEfectivoId',
  'agenteId',
  'agenteGuid',
  'huellaEstructuralSha256',
  'operacionId',
  'claveOperacion',
  'correlacionId',
  'eventoId',
  'csrfSha256',
  'emitidoEnUtc',
  'expiraEnUtc'
]);

export class ErrorConfirmacionEliminacionAgente extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.name = 'ErrorConfirmacionEliminacionAgente';
    this.codigo = codigo;
  }
}

export class CodecConfirmacionEliminacionAgente {
  constructor({ secreto, ttlSegundos = 600, ahora = () => new Date() } = {}) {
    const material = Buffer.from(String(secreto || ''), 'utf8');
    if (material.length < 32) {
      throw new Error('La confirmación destructiva exige un secreto de al menos 32 bytes.');
    }
    if (!Number.isInteger(ttlSegundos) || ttlSegundos < 30 || ttlSegundos > 3600) {
      throw new Error('La confirmación debe expirar entre 30 y 3600 segundos.');
    }
    if (typeof ahora !== 'function') throw new Error('El codec exige un reloj.');
    this.secreto = material;
    this.ttlSegundos = ttlSegundos;
    this.ahora = ahora;
  }

  emitir(datos, { csrfToken } = {}) {
    const emitido = fechaUtc(this.ahora(), 'reloj de confirmación');
    const expira = new Date(Date.parse(emitido) + this.ttlSegundos * 1000).toISOString();
    const payload = validarPayload({
      perfil: PERFIL,
      version: 1,
      actorRealId: datos?.actorRealId,
      actorEfectivoId: datos?.actorEfectivoId,
      agenteId: datos?.agenteId,
      agenteGuid: datos?.agenteGuid,
      huellaEstructuralSha256: datos?.huellaEstructuralSha256,
      operacionId: datos?.operacionId,
      claveOperacion: datos?.claveOperacion,
      correlacionId: datos?.correlacionId,
      eventoId: datos?.eventoId,
      csrfSha256: hashCsrf(csrfToken),
      emitidoEnUtc: emitido,
      expiraEnUtc: expira
    });
    const cuerpo = Buffer.from(canonicalizarRfc8785(payload), 'utf8').toString('base64url');
    return Object.freeze({
      token: `${PREFIJO}.${cuerpo}.${this.#firmar(cuerpo)}`,
      emitidoEnUtc: emitido,
      expiraEnUtc: expira,
      payload
    });
  }

  verificar(token, {
    csrfToken,
    actorRealId,
    actorEfectivoId = actorRealId,
    agenteId
  } = {}) {
    try {
      const partes = String(token || '').split('.');
      if (partes.length !== 3 || partes[0] !== PREFIJO) fallarInvalida();
      const [, cuerpo, firma] = partes;
      if (!compararSeguro(firma, this.#firmar(cuerpo))) fallarInvalida();
      const bytes = Buffer.from(cuerpo, 'base64url');
      if (bytes.toString('base64url') !== cuerpo) fallarInvalida();
      const payload = validarPayload(JSON.parse(bytes.toString('utf8')));
      if (canonicalizarRfc8785(payload) !== bytes.toString('utf8')) fallarInvalida();
      if (!compararSeguro(payload.csrfSha256, hashCsrf(csrfToken))) fallarInvalida();
      if (
        payload.actorRealId !== idDecimal(actorRealId, 'actorRealId') ||
        payload.actorEfectivoId !== idDecimal(actorEfectivoId, 'actorEfectivoId') ||
        payload.agenteId !== idDecimal(agenteId, 'agenteId')
      ) {
        fallarInvalida();
      }
      const ahora = this.ahora().getTime();
      if (!Number.isFinite(ahora)) fallarInvalida();
      if (Date.parse(payload.expiraEnUtc) <= ahora) {
        throw new ErrorConfirmacionEliminacionAgente(
          'agente_eliminacion_confirmacion_expirada',
          'La confirmación ha expirado; revisa de nuevo el impacto.'
        );
      }
      if (Date.parse(payload.emitidoEnUtc) > ahora + 30_000) fallarInvalida();
      return payload;
    } catch (error) {
      if (error instanceof ErrorConfirmacionEliminacionAgente) throw error;
      fallarInvalida();
    }
  }

  #firmar(cuerpo) {
    return createHmac('sha256', this.secreto).update(cuerpo, 'utf8').digest('base64url');
  }
}

function validarPayload(entrada) {
  if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)) fallarInvalida();
  const claves = Object.keys(entrada).sort();
  if (claves.length !== CAMPOS.length ||
      claves.some((clave, indice) => clave !== [...CAMPOS].sort()[indice])) {
    fallarInvalida();
  }
  if (entrada.perfil !== PERFIL || entrada.version !== 1) fallarInvalida();
  const idsCausales = [
    entrada.operacionId,
    entrada.claveOperacion,
    entrada.correlacionId,
    entrada.eventoId
  ].map((valor) => validarUuidV7Auditoria(valor));
  if (new Set(idsCausales).size !== idsCausales.length) fallarInvalida();
  const emitido = fechaUtc(entrada.emitidoEnUtc, 'emitidoEnUtc');
  const expira = fechaUtc(entrada.expiraEnUtc, 'expiraEnUtc');
  if (Date.parse(expira) <= Date.parse(emitido)) fallarInvalida();
  return congelar({
    perfil: PERFIL,
    version: 1,
    actorRealId: idDecimal(entrada.actorRealId, 'actorRealId'),
    actorEfectivoId: idDecimal(entrada.actorEfectivoId, 'actorEfectivoId'),
    agenteId: idDecimal(entrada.agenteId, 'agenteId'),
    agenteGuid: guid(entrada.agenteGuid),
    huellaEstructuralSha256: sha256(entrada.huellaEstructuralSha256),
    operacionId: idsCausales[0],
    claveOperacion: idsCausales[1],
    correlacionId: idsCausales[2],
    eventoId: idsCausales[3],
    csrfSha256: sha256(entrada.csrfSha256),
    emitidoEnUtc: emitido,
    expiraEnUtc: expira
  });
}

function hashCsrf(valor) {
  const texto = String(valor ?? '');
  if (!texto || Buffer.byteLength(texto, 'utf8') > 1024) fallarInvalida();
  return createHash('sha256').update(texto, 'utf8').digest('hex');
}

function idDecimal(valor, campo) {
  const texto = String(valor ?? '');
  if (!/^[1-9][0-9]*$/u.test(texto)) throw new TypeError(`${campo} no es válido.`);
  return texto;
}

function guid(valor) {
  const texto = String(valor || '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(texto)) {
    fallarInvalida();
  }
  return texto;
}

function sha256(valor) {
  const texto = String(valor || '');
  if (!/^[0-9a-f]{64}$/u.test(texto)) fallarInvalida();
  return texto;
}

function fechaUtc(valor, campo) {
  const fecha = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(fecha.getTime())) throw new TypeError(`${campo} no es una fecha.`);
  return fecha.toISOString();
}

function compararSeguro(izquierda, derecha) {
  const a = Buffer.from(String(izquierda || ''), 'utf8');
  const b = Buffer.from(String(derecha || ''), 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

function fallarInvalida() {
  throw new ErrorConfirmacionEliminacionAgente(
    'agente_eliminacion_confirmacion_invalida',
    'La confirmación de eliminación no es válida.'
  );
}

function congelar(valor) {
  if (valor && typeof valor === 'object' && !Object.isFrozen(valor)) {
    for (const hijo of Object.values(valor)) congelar(hijo);
    Object.freeze(valor);
  }
  return valor;
}
