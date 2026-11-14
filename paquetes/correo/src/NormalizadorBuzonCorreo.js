import { domainToASCII } from 'node:url';

export const VERSION_NORMALIZACION_BUZON_CORREO = 'buzon@1';

const LIMITE_BUZON_BYTES = 190;
const LIMITE_LOCAL_BYTES = 64;
const LIMITE_DOMINIO_BYTES = 253;
const PATRON_LOCAL_DOT_ATOM =
  /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]+$/u;
const PATRON_ETIQUETA_HOSTNAME =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;

export class ErrorNormalizacionBuzonCorreo extends Error {
  constructor(mensaje, { codigo = 'buzon_correo_invalido' } = {}) {
    super(mensaje);
    this.name = 'ErrorNormalizacionBuzonCorreo';
    this.codigo = codigo;
  }
}

export function normalizarBuzonCorreo(valor) {
  if (typeof valor !== 'string') {
    fallar('El buzón debe ser una cadena de texto.');
  }

  const presentacion = valor.trim();
  if (!presentacion || /[\u0000-\u001f\u007f]/u.test(presentacion)) {
    fallar('El buzón está vacío o contiene caracteres de control.');
  }

  const separador = presentacion.indexOf('@');
  if (separador <= 0 || separador !== presentacion.lastIndexOf('@')) {
    fallar('El buzón debe contener una única separación entre local y dominio.');
  }

  const local = presentacion.slice(0, separador);
  const dominioEntrada = presentacion.slice(separador + 1);
  validarLocal(local);

  if (!dominioEntrada || dominioEntrada.endsWith('.') ||
      /[\s\u0000-\u001f\u007f]/u.test(dominioEntrada)) {
    fallar('El dominio del buzón no es un hostname válido.');
  }

  const dominio = domainToASCII(dominioEntrada).toLowerCase();
  if (!dominio || Buffer.byteLength(dominio, 'utf8') > LIMITE_DOMINIO_BYTES) {
    fallar('El dominio del buzón no admite una forma IDNA ASCII válida.');
  }

  const etiquetas = dominio.split('.');
  if (etiquetas.length < 2 ||
      etiquetas.some((etiqueta) => !PATRON_ETIQUETA_HOSTNAME.test(etiqueta))) {
    fallar('El dominio del buzón no está formado por etiquetas de hostname válidas.');
  }

  const canonico = `${local}@${dominio}`;
  if (Buffer.byteLength(canonico, 'utf8') > LIMITE_BUZON_BYTES) {
    fallar(`El buzón supera ${LIMITE_BUZON_BYTES} bytes.`);
  }

  return Object.freeze({
    version: VERSION_NORMALIZACION_BUZON_CORREO,
    presentacion,
    canonico
  });
}

export function exigirBuzonCanonicoCorreo(valor) {
  const normalizado = normalizarBuzonCorreo(valor);
  if (normalizado.canonico !== valor) {
    fallar(
      `El buzón no usa la representación canónica de ${VERSION_NORMALIZACION_BUZON_CORREO}.`,
      'buzon_correo_no_canonico'
    );
  }
  return normalizado.canonico;
}

export function esBuzonCorreoValido(valor) {
  try {
    normalizarBuzonCorreo(valor);
    return true;
  } catch (error) {
    if (error instanceof ErrorNormalizacionBuzonCorreo) return false;
    throw error;
  }
}

export function normalizarNombrePresentacionCorreo(
  valor,
  { permitirVacio = true } = {}
) {
  if (typeof valor !== 'string') {
    fallar('El nombre de presentación debe ser una cadena de texto.', 'nombre_correo_invalido');
  }
  const normalizado = valor.trim();
  if ((!permitirVacio && !normalizado) ||
      /[\u0000-\u001f\u007f]/u.test(normalizado) ||
      Buffer.byteLength(normalizado, 'utf8') > LIMITE_BUZON_BYTES) {
    fallar(
      'El nombre de presentación no es válido para una cabecera de correo.',
      'nombre_correo_invalido'
    );
  }
  return normalizado;
}

function validarLocal(local) {
  if (Buffer.byteLength(local, 'utf8') > LIMITE_LOCAL_BYTES ||
      !PATRON_LOCAL_DOT_ATOM.test(local) ||
      local.startsWith('.') || local.endsWith('.') || local.includes('..')) {
    fallar('La parte local del buzón no usa dot-atom ASCII válido.');
  }
}

function fallar(mensaje, codigo) {
  throw new ErrorNormalizacionBuzonCorreo(mensaje, { codigo });
}
