import { createHmac, timingSafeEqual } from 'node:crypto';
import canonicalize from 'canonicalize';
import {
  CODIGOS_ERROR_CONSULTA_AUDITORIA,
  CONTRATO_PARAMETROS_CONSULTA_AUDITORIA,
  ErrorContratoConsultaAuditoria,
  VERSION_CONTRATO_CONSULTA_AUDITORIA
} from './ContratoConsultaAuditoria.js';
import { validarUuidV7Auditoria } from './UuidV7Auditoria.js';

const MODOS_CURSOR = Object.freeze(['eventos', 'correlacion']);
const NIVELES_SCOPE = Object.freeze(['portal', 'tenant', 'empresa', 'sitio']);
const CAMPOS_PAYLOAD_CURSOR = Object.freeze(['identidad', 'posicion', 'v']);
const CAMPOS_POSICION_CURSOR = Object.freeze(['eventoId', 'registradoEnUtc']);

export function construirIdentidadCursorAuditoriaV2({
  modo,
  contextoUsuarioActual,
  sesionActual,
  consultaNormalizada,
  correlacionId = null
} = {}) {
  exigir(MODOS_CURSOR.includes(modo), 'El modo del cursor de auditoría no es válido.');
  exigirConsultaNormalizada(consultaNormalizada);
  const sesion = normalizarSesion(sesionActual, contextoUsuarioActual);
  const scope = normalizarScope(contextoUsuarioActual);
  const correlacion = modo === 'correlacion'
    ? validarCorrelacion(correlacionId)
    : null;
  exigir(
    modo !== 'eventos' || correlacionId == null,
    'El modo eventos no admite una correlación externa en su identidad.'
  );

  return congelar({
    v: VERSION_CONTRATO_CONSULTA_AUDITORIA,
    modo,
    sesion,
    autorizacion: {
      verAuditoria: Boolean(contextoUsuarioActual?.permisos?.verAuditoria),
      scope
    },
    consulta: {
      filtros: consultaNormalizada.filtros,
      orden: consultaNormalizada.orden,
      limite: consultaNormalizada.limite,
      correlacionId: correlacion
    }
  });
}

export function codificarCursorAuditoriaV2({ identidad, posicion, secreto } = {}) {
  exigirIdentidadV2(identidad);
  exigirSecreto(secreto);
  const posicionNormalizada = normalizarPosicion(posicion);
  const cuerpo = Buffer.from(canonicalize({
    v: VERSION_CONTRATO_CONSULTA_AUDITORIA,
    identidad,
    posicion: posicionNormalizada
  }), 'utf8').toString('base64url');
  return `${cuerpo}.${firmar(cuerpo, secreto)}`;
}

export function decodificarCursorAuditoriaV2({ cursor, identidad, secreto } = {}) {
  exigirIdentidadV2(identidad);
  exigirSecreto(secreto);
  if (!CONTRATO_PARAMETROS_CONSULTA_AUDITORIA.cursor.validar(cursor)) {
    throw errorCursor(CODIGOS_ERROR_CONSULTA_AUDITORIA.CURSOR_INVALIDO);
  }
  const partes = cursor.split('.');
  if (partes.length !== 2) {
    throw errorCursor(CODIGOS_ERROR_CONSULTA_AUDITORIA.CURSOR_INVALIDO);
  }
  const [cuerpo, firma] = partes;
  if (!seguroIgual(firma, firmar(cuerpo, secreto))) {
    throw errorCursor(CODIGOS_ERROR_CONSULTA_AUDITORIA.CURSOR_INVALIDO);
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(cuerpo, 'base64url').toString('utf8'));
  } catch {
    throw errorCursor(CODIGOS_ERROR_CONSULTA_AUDITORIA.CURSOR_INVALIDO);
  }
  if (
    !esObjetoPlano(payload) ||
    !clavesExactas(payload, CAMPOS_PAYLOAD_CURSOR) ||
    payload.v !== VERSION_CONTRATO_CONSULTA_AUDITORIA ||
    payload.identidad?.v !== VERSION_CONTRATO_CONSULTA_AUDITORIA
  ) {
    throw errorCursor(CODIGOS_ERROR_CONSULTA_AUDITORIA.CURSOR_INVALIDO);
  }
  if (canonicalize(payload.identidad) !== canonicalize(identidad)) {
    throw errorCursor(CODIGOS_ERROR_CONSULTA_AUDITORIA.CURSOR_INCOMPATIBLE);
  }
  try {
    return normalizarPosicion(payload.posicion);
  } catch {
    throw errorCursor(CODIGOS_ERROR_CONSULTA_AUDITORIA.CURSOR_INVALIDO);
  }
}

function normalizarSesion(sesionActual, contextoUsuarioActual) {
  const sesionAuditoriaId = String(sesionActual?.sesionAuditoriaId ?? '');
  validarUuidV7Auditoria(sesionAuditoriaId, 'sesionAuditoriaId');
  const idUsuarioEfectivo = textoObligatorio(
    sesionActual?.idUsuarioEfectivo ?? contextoUsuarioActual?.idUsuario,
    'idUsuarioEfectivo'
  );
  const idUsuarioReal = textoObligatorio(
    sesionActual?.idUsuarioReal ?? contextoUsuarioActual?.idUsuarioReal ?? idUsuarioEfectivo,
    'idUsuarioReal'
  );
  const versionSesionEfectiva = versionSesion(
    sesionActual?.versionSesionEfectiva ?? sesionActual?.versionSesion,
    'versionSesionEfectiva'
  );
  const versionSesionReal = versionSesion(
    sesionActual?.versionSesionReal ?? versionSesionEfectiva,
    'versionSesionReal'
  );
  return {
    sesionAuditoriaId,
    idUsuarioReal,
    idUsuarioEfectivo,
    versionSesionReal,
    versionSesionEfectiva
  };
}

function normalizarScope(contexto) {
  const nivelScope = String(contexto?.nivelScope ?? '');
  exigir(NIVELES_SCOPE.includes(nivelScope), 'El nivel de scope del cursor no es válido.');
  return {
    nivelScope,
    tenantId: idScope(contexto?.tenantId),
    empresaId: idScope(contexto?.empresaId),
    sitioId: idScope(contexto?.sitioId),
    esOperadorSistema: Boolean(contexto?.esOperadorSistema)
  };
}

function normalizarPosicion(posicion) {
  exigir(
    esObjetoPlano(posicion) && clavesExactas(posicion, CAMPOS_POSICION_CURSOR),
    'La posición del cursor de auditoría no es válida.'
  );
  const registradoEnUtc = String(posicion.registradoEnUtc ?? '');
  exigir(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(registradoEnUtc) &&
      new Date(registradoEnUtc).toISOString() === registradoEnUtc,
    'registradoEnUtc no es una fecha canónica del cursor.'
  );
  const eventoId = validarUuidV7Auditoria(String(posicion.eventoId ?? ''), 'eventoId');
  return congelar({ registradoEnUtc, eventoId });
}

function exigirConsultaNormalizada(consulta) {
  exigir(esObjetoPlano(consulta), 'La consulta normalizada es obligatoria para construir el cursor.');
  exigir(esObjetoPlano(consulta.filtros) && Object.isFrozen(consulta.filtros), 'Los filtros deben estar normalizados y congelados.');
  exigir(['asc', 'desc'].includes(consulta.orden), 'El orden normalizado no es válido.');
  exigir(Number.isInteger(consulta.limite) && consulta.limite >= 1 && consulta.limite <= 100, 'El límite normalizado no es válido.');
}

function exigirIdentidadV2(identidad) {
  exigir(
    esObjetoPlano(identidad) && identidad.v === VERSION_CONTRATO_CONSULTA_AUDITORIA,
    'La identidad del cursor debe pertenecer al contrato v2.'
  );
}

function validarCorrelacion(valor) {
  const correlacionId = String(valor ?? '');
  exigir(
    CONTRATO_PARAMETROS_CONSULTA_AUDITORIA.correlacionId.validar(correlacionId),
    'El modo correlación exige un correlacionId UUIDv7.'
  );
  return correlacionId;
}

function textoObligatorio(valor, nombre) {
  const texto = String(valor ?? '');
  exigir(texto.length > 0, `${nombre} es obligatorio para la identidad del cursor.`);
  return texto;
}

function versionSesion(valor, nombre) {
  const version = String(valor ?? '');
  exigir(/^[1-9][0-9]*$/.test(version), `${nombre} debe ser una versión positiva.`);
  return version;
}

function idScope(valor) {
  if (valor == null) return null;
  const id = String(valor);
  exigir(/^[1-9][0-9]*$/.test(id), 'Los ids de scope deben ser decimales positivos.');
  return id;
}

function clavesExactas(valor, esperadas) {
  return canonicalize(Object.keys(valor).sort()) === canonicalize([...esperadas].sort());
}

function firmar(cuerpo, secreto) {
  return createHmac('sha256', secreto).update(cuerpo).digest('base64url');
}

function seguroIgual(a, b) {
  const bufferA = Buffer.from(String(a));
  const bufferB = Buffer.from(String(b));
  return bufferA.length === bufferB.length && timingSafeEqual(bufferA, bufferB);
}

function exigirSecreto(secreto) {
  exigir(typeof secreto === 'string' && secreto.length >= 16, 'El codec exige un secreto estable de al menos 16 caracteres.');
}

function errorCursor(codigo) {
  const incompatible = codigo === CODIGOS_ERROR_CONSULTA_AUDITORIA.CURSOR_INCOMPATIBLE;
  return new ErrorContratoConsultaAuditoria(
    incompatible
      ? 'El cursor no pertenece a esta sesión, autorización o consulta; reinicia la navegación.'
      : 'El cursor de auditoría no es válido.',
    { codigo, campo: 'cursor' }
  );
}

function esObjetoPlano(valor) {
  return valor != null && typeof valor === 'object' && !Array.isArray(valor) && Object.getPrototypeOf(valor) === Object.prototype;
}

function congelar(valor) {
  if (valor && typeof valor === 'object' && !Object.isFrozen(valor)) {
    Object.freeze(valor);
    for (const hijo of Object.values(valor)) congelar(hijo);
  }
  return valor;
}

function exigir(condicion, mensaje) {
  if (!condicion) throw new Error(mensaje);
}

export const __testablesCodecCursorConsultaAuditoria = Object.freeze({
  MODOS_CURSOR,
  NIVELES_SCOPE
});
