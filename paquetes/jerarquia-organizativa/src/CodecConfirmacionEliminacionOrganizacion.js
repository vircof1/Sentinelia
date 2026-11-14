import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import { canonicalizarRfc8785 } from '../../auditoria/src/PerfilJcsAuditoria.js';
import { validarUuidV7Auditoria } from '../../auditoria/src/UuidV7Auditoria.js';
import {
  TIPOS_OPERACION_ADMINISTRATIVA_ORGANIZACION,
  TIPOS_SUJETO_ELIMINACION_ORGANIZACION,
  VERSION_CONTRATO_ELIMINACION_ADMINISTRATIVA_ORGANIZACION,
  crearFraseConfirmacionEliminacionOrganizacion,
  crearSujetoEliminacionAdministrativaOrganizacion
} from './ContratoEliminacionAdministrativaOrganizacion.js';

const PREFIJO = 'seo1';
const PERFIL = 'sentinelia-confirmacion-eliminacion-organizacion-v1';
const CAMPOS = Object.freeze([
  'perfil', 'version', 'tipoOperacion', 'versionOperacion',
  'actorRealId', 'actorEfectivoId', 'sujetoTipo', 'sujetoId',
  'fraseConfirmacion', 'operacionId', 'claveOperacion', 'correlacionId',
  'eventoId', 'csrfSha256', 'emitidoEnUtc', 'expiraEnUtc'
]);
const TIPOS_SUJETO = new Set(
  Object.values(TIPOS_SUJETO_ELIMINACION_ORGANIZACION)
);

export class ErrorConfirmacionEliminacionOrganizacion extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.name = 'ErrorConfirmacionEliminacionOrganizacion';
    this.codigo = codigo;
  }
}

export class CodecConfirmacionEliminacionOrganizacion {
  constructor({ secreto, ttlSegundos = 600, ahora = () => new Date() } = {}) {
    const material = Buffer.from(String(secreto || ''), 'utf8');
    if (material.length < 32) {
      throw new Error('La confirmación organizativa exige al menos 32 bytes de secreto.');
    }
    if (!Number.isInteger(ttlSegundos) || ttlSegundos < 30 || ttlSegundos > 3600) {
      throw new Error('La confirmación debe expirar entre 30 y 3600 segundos.');
    }
    if (typeof ahora !== 'function') throw new Error('El codec exige un reloj.');
    Object.assign(this, { secreto: material, ttlSegundos, ahora });
  }

  emitir(datos, { csrfToken } = {}) {
    const sujeto = crearSujetoEliminacionAdministrativaOrganizacion({
      tipo: datos?.sujeto?.tipo,
      id: datos?.sujeto?.id,
      scope: datos?.sujeto?.scope
    });
    const emitidoEnUtc = fechaUtc(this.ahora(), 'reloj de confirmación');
    const expiraEnUtc = new Date(
      Date.parse(emitidoEnUtc) + this.ttlSegundos * 1000
    ).toISOString();
    const payload = validarPayload({
      perfil: PERFIL,
      version: 1,
      tipoOperacion: TIPOS_OPERACION_ADMINISTRATIVA_ORGANIZACION.ELIMINAR_ORGANIZACION,
      versionOperacion: VERSION_CONTRATO_ELIMINACION_ADMINISTRATIVA_ORGANIZACION,
      actorRealId: datos?.actorRealId,
      actorEfectivoId: datos?.actorEfectivoId,
      sujetoTipo: sujeto.tipo,
      sujetoId: sujeto.id,
      fraseConfirmacion: crearFraseConfirmacionEliminacionOrganizacion(sujeto),
      operacionId: datos?.operacionId,
      claveOperacion: datos?.claveOperacion,
      correlacionId: datos?.correlacionId,
      eventoId: datos?.eventoId,
      csrfSha256: hashCsrf(csrfToken),
      emitidoEnUtc,
      expiraEnUtc
    });
    const cuerpo = Buffer.from(canonicalizarRfc8785(payload), 'utf8').toString('base64url');
    return Object.freeze({
      token: `${PREFIJO}.${cuerpo}.${this.#firmar(cuerpo)}`,
      emitidoEnUtc,
      expiraEnUtc,
      payload
    });
  }

  verificar(token, {
    csrfToken,
    actorRealId,
    actorEfectivoId = actorRealId,
    sujeto
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
      const raiz = identidadSujeto(sujeto?.tipo, sujeto?.id);
      if (!compararSeguro(payload.csrfSha256, hashCsrf(csrfToken)) ||
          payload.actorRealId !== idDecimal(actorRealId, 'actorRealId') ||
          payload.actorEfectivoId !== idDecimal(actorEfectivoId, 'actorEfectivoId') ||
          payload.sujetoTipo !== raiz.tipo || payload.sujetoId !== raiz.id) {
        fallarInvalida();
      }
      const ahora = this.ahora().getTime();
      if (!Number.isFinite(ahora)) fallarInvalida();
      if (Date.parse(payload.expiraEnUtc) <= ahora) {
        throw new ErrorConfirmacionEliminacionOrganizacion(
          'organizacion_eliminacion_confirmacion_expirada',
          'La confirmación ha expirado; revisa de nuevo el impacto.'
        );
      }
      if (Date.parse(payload.emitidoEnUtc) > ahora + 30_000) fallarInvalida();
      return payload;
    } catch (error) {
      if (error instanceof ErrorConfirmacionEliminacionOrganizacion) throw error;
      fallarInvalida();
    }
  }

  #firmar(cuerpo) {
    return createHmac('sha256', this.secreto).update(cuerpo, 'utf8').digest('base64url');
  }
}

function validarPayload(entrada) {
  if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)) fallarInvalida();
  const esperadas = [...CAMPOS].sort();
  const recibidas = Object.keys(entrada).sort();
  if (recibidas.length !== esperadas.length ||
      recibidas.some((clave, indice) => clave !== esperadas[indice])) fallarInvalida();
  if (entrada.perfil !== PERFIL || entrada.version !== 1 ||
      entrada.tipoOperacion !==
        TIPOS_OPERACION_ADMINISTRATIVA_ORGANIZACION.ELIMINAR_ORGANIZACION ||
      entrada.versionOperacion !==
        VERSION_CONTRATO_ELIMINACION_ADMINISTRATIVA_ORGANIZACION) fallarInvalida();
  const sujeto = identidadSujeto(entrada.sujetoTipo, entrada.sujetoId);
  if (entrada.fraseConfirmacion !== `ELIMINAR ${sujeto.tipo} ${sujeto.id}`) {
    fallarInvalida();
  }
  const ids = [entrada.operacionId, entrada.claveOperacion,
    entrada.correlacionId, entrada.eventoId]
    .map((valor) => validarUuidV7Auditoria(valor));
  if (new Set(ids).size !== ids.length) fallarInvalida();
  const emitidoEnUtc = fechaUtc(entrada.emitidoEnUtc, 'emitidoEnUtc');
  const expiraEnUtc = fechaUtc(entrada.expiraEnUtc, 'expiraEnUtc');
  if (Date.parse(expiraEnUtc) <= Date.parse(emitidoEnUtc)) fallarInvalida();
  return congelar({
    perfil: PERFIL,
    version: 1,
    tipoOperacion: entrada.tipoOperacion,
    versionOperacion: entrada.versionOperacion,
    actorRealId: idDecimal(entrada.actorRealId, 'actorRealId'),
    actorEfectivoId: idDecimal(entrada.actorEfectivoId, 'actorEfectivoId'),
    sujetoTipo: sujeto.tipo,
    sujetoId: sujeto.id,
    fraseConfirmacion: entrada.fraseConfirmacion,
    operacionId: ids[0],
    claveOperacion: ids[1],
    correlacionId: ids[2],
    eventoId: ids[3],
    csrfSha256: sha256(entrada.csrfSha256),
    emitidoEnUtc,
    expiraEnUtc
  });
}

function identidadSujeto(tipo, id) {
  const tipoNormalizado = String(tipo ?? '');
  if (!TIPOS_SUJETO.has(tipoNormalizado)) fallarInvalida();
  return Object.freeze({
    tipo: tipoNormalizado,
    id: idDecimal(id, 'sujetoId')
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
  throw new ErrorConfirmacionEliminacionOrganizacion(
    'organizacion_eliminacion_confirmacion_invalida',
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
