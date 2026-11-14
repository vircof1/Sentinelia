import {
  canonicalizarJsonFederacion,
  normalizarJsonFederacion
} from './CanonicalizadorFederacion.js';
import { esFechaUtcCanonicaFederacion } from './FechaUtcFederacion.js';

export const VERSION_PAYLOAD_AUDITORIA_FEDERADA = 1;
export const PERFIL_PAYLOAD_AUDITORIA_FEDERADA =
  'sentinelia-federacion-auditoria-v1';

const CAUSAS_NO_VERIFICABLE = new Set([
  'vistaParcialOrigen',
  'versionNoSoportadaOrigen',
  'evidenciaNoDisponibleOrigen',
  'retencionOrigen'
]);

export class ErrorPayloadAuditoriaFederada extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.name = 'ErrorPayloadAuditoriaFederada';
    this.codigo = codigo;
  }
}

export function crearPayloadAuditoriaFederadaDesdeVista({
  vistaAutorizada,
  evidenciaOrigen
} = {}) {
  const vista = validarVista(vistaAutorizada);
  const evidencia = validarEvidencia(evidenciaOrigen, vista);
  return normalizarJsonFederacion({
    perfil: PERFIL_PAYLOAD_AUDITORIA_FEDERADA,
    version: VERSION_PAYLOAD_AUDITORIA_FEDERADA,
    tipoRegistro: 'evento',
    eventoOrigenId: vista.eventoId,
    vistaAutorizada: vista,
    evidenciaOrigen: evidencia
  });
}

export function validarPayloadAuditoriaFederada(
  payload,
  { operacion = 'actualizacion' } = {}
) {
  if (operacion !== 'actualizacion') {
    fallar(
      'operacion_auditoria_federada_invalida',
      'Un evento auditable federado solo admite actualización inmutable.'
    );
  }
  payload = normalizarJsonFederacion(payload);
  exigirClaves(payload, [
    'eventoOrigenId', 'evidenciaOrigen', 'perfil', 'tipoRegistro',
    'version', 'vistaAutorizada'
  ]);
  if (
    payload.perfil !== PERFIL_PAYLOAD_AUDITORIA_FEDERADA ||
    payload.version !== VERSION_PAYLOAD_AUDITORIA_FEDERADA ||
    payload.tipoRegistro !== 'evento'
  ) {
    fallar(
      'version_payload_auditoria_federada_incompatible',
      'Perfil, versión o tipo de auditoría federada incompatibles.'
    );
  }
  const vista = validarVista(payload.vistaAutorizada);
  const eventoOrigenId = uuidV7(payload.eventoOrigenId, 'eventoOrigenId');
  if (eventoOrigenId !== vista.eventoId) {
    fallar(
      'identidad_evento_auditoria_federada_incoherente',
      'La identidad exterior no coincide con la vista autorizada.'
    );
  }
  return normalizarJsonFederacion({
    perfil: PERFIL_PAYLOAD_AUDITORIA_FEDERADA,
    version: VERSION_PAYLOAD_AUDITORIA_FEDERADA,
    tipoRegistro: 'evento',
    eventoOrigenId,
    vistaAutorizada: vista,
    evidenciaOrigen: validarEvidencia(payload.evidenciaOrigen, vista)
  });
}

function validarVista(valor) {
  if (!objeto(valor)) {
    fallar('vista_auditoria_federada_invalida', 'La vista autorizada debe ser un objeto.');
  }
  const camposObligatorios = [
    'eventoId', 'versionContrato', 'flujo', 'sujeto', 'scope',
    'efectivoEnUtc', 'registradoEnUtc', 'payload'
  ];
  if (camposObligatorios.some((campo) => !Object.hasOwn(valor, campo))) {
    fallar(
      'vista_auditoria_federada_incompleta',
      'La vista debe conservar identidad, tipo, versión, contexto, tiempos y contenido.'
    );
  }
  const tieneTipoCanonico = Object.hasOwn(valor, 'tipo');
  const tieneTipoLectura = Object.hasOwn(valor, 'tipoEvento');
  if (tieneTipoCanonico === tieneTipoLectura) {
    fallar(
      'tipo_vista_auditoria_federada_invalido',
      'La vista debe declarar exactamente uno de tipo o tipoEvento.'
    );
  }
  const vista = { ...valor, eventoId: uuidV7(valor.eventoId, 'vistaAutorizada.eventoId') };
  const tipo = String(tieneTipoCanonico ? vista.tipo : vista.tipoEvento);
  if (!tipo || tipo.length > 128) {
    fallar('tipo_vista_auditoria_federada_invalido', 'El tipo del evento no es válido.');
  }
  if (!Number.isSafeInteger(vista.versionContrato) || vista.versionContrato < 1) {
    fallar('version_evento_auditoria_federada_invalida', 'La versión contractual no es válida.');
  }
  if (typeof vista.flujo !== 'string' || !vista.flujo || vista.flujo.length > 64) {
    fallar('flujo_evento_auditoria_federada_invalido', 'El flujo auditable no es válido.');
  }
  if (!objeto(vista.sujeto) || !objeto(vista.scope)) {
    fallar('contexto_evento_auditoria_federada_invalido', 'Sujeto y scope deben conservarse.');
  }
  if (!objeto(vista.payload)) {
    fallar('payload_evento_auditoria_federada_invalido', 'El contenido auditable debe ser un objeto.');
  }
  vista.efectivoEnUtc = fecha(vista.efectivoEnUtc, 'efectivoEnUtc');
  vista.registradoEnUtc = fecha(vista.registradoEnUtc, 'registradoEnUtc');
  return vista;
}

function validarEvidencia(valor, vista) {
  if (!objeto(valor) || !['verificable', 'noVerificable'].includes(valor.estado)) {
    fallar('evidencia_auditoria_federada_invalida', 'La evidencia debe declarar su verificabilidad.');
  }
  if (valor.estado === 'noVerificable') {
    exigirClaves(valor, ['causa', 'estado']);
    if (!CAUSAS_NO_VERIFICABLE.has(valor.causa)) {
      fallar('causa_no_verificable_desconocida', 'La limitación de origen no está catalogada.');
    }
    return { estado: 'noVerificable', causa: valor.causa };
  }
  exigirClaves(valor, [
    'estado', 'hashActual', 'hashAnterior', 'hashPayload', 'sobreCanonico'
  ]);
  if (!objeto(valor.sobreCanonico)) {
    fallar('sobre_auditoria_federada_invalido', 'La evidencia verificable exige su sobre canónico.');
  }
  if (uuidV7(valor.sobreCanonico.eventoId, 'sobreCanonico.eventoId') !== vista.eventoId) {
    fallar('sobre_auditoria_federada_ajeno', 'El sobre verificable pertenece a otro evento.');
  }
  if (
    canonicalizarJsonFederacion(valor.sobreCanonico) !==
    canonicalizarJsonFederacion(vista)
  ) {
    fallar(
      'evidencia_auditoria_federada_fuera_de_vista',
      'La evidencia verificable no puede revelar ni proteger contenido ajeno a la vista autorizada.'
    );
  }
  return {
    estado: 'verificable',
    sobreCanonico: valor.sobreCanonico,
    hashPayload: hashHex(valor.hashPayload, 'hashPayload'),
    hashAnterior: hashHex(valor.hashAnterior, 'hashAnterior'),
    hashActual: hashHex(valor.hashActual, 'hashActual')
  };
}

function hashHex(valor, campo) {
  const texto = String(valor || '').toLowerCase();
  if (!/^[0-9a-f]{64}$/u.test(texto)) {
    fallar('hash_auditoria_federada_invalido', `${campo} debe ser SHA-256 hexadecimal.`);
  }
  return texto;
}

function uuidV7(valor, campo) {
  const texto = String(valor || '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(texto)) {
    fallar('uuidv7_auditoria_federada_invalido', `${campo} debe ser un UUIDv7.`);
  }
  return texto;
}

function fecha(valor, campo) {
  const texto = String(valor || '');
  if (!esFechaUtcCanonicaFederacion(texto)) {
    fallar('fecha_auditoria_federada_invalida', `${campo} debe ser UTC canónico.`);
  }
  return texto;
}

function exigirClaves(valor, esperadas) {
  if (!objeto(valor)) fallar('forma_auditoria_federada_invalida', 'Se esperaba un objeto.');
  const actuales = Object.keys(valor).sort();
  const objetivo = [...esperadas].sort();
  if (actuales.length !== objetivo.length || actuales.some((clave, indice) => clave !== objetivo[indice])) {
    fallar('forma_auditoria_federada_invalida', 'Existen campos ausentes o desconocidos.');
  }
}

function objeto(valor) {
  return Boolean(valor) && typeof valor === 'object' && !Array.isArray(valor);
}

function fallar(codigo, mensaje) {
  throw new ErrorPayloadAuditoriaFederada(codigo, mensaje);
}
