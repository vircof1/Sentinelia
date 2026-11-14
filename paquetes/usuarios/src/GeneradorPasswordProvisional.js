import { randomBytes as generarBytesAleatorios } from 'node:crypto';

export const LONGITUD_BASE_PASSWORD_PROVISIONAL = 24;
export const LONGITUD_MAXIMA_PASSWORD_BCRYPT_BYTES = 72;

const ALFABETO =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';

export class GeneradorPasswordProvisional {
  constructor({ randomBytes = generarBytesAleatorios } = {}) {
    if (typeof randomBytes !== 'function') {
      throw new Error('El generador provisional requiere una fuente CSPRNG.');
    }
    this.randomBytes = randomBytes;
  }

  generar({ longitudMinima } = {}) {
    const minima = normalizarLongitudMinima(longitudMinima);
    const longitud = Math.max(LONGITUD_BASE_PASSWORD_PROVISIONAL, minima);
    const bytes = this.randomBytes(longitud);
    if (!Buffer.isBuffer(bytes) || bytes.length !== longitud) {
      throw new Error('La fuente CSPRNG no entregó el material solicitado.');
    }
    let password = '';
    for (const byte of bytes) password += ALFABETO[byte & 63];
    return password;
  }
}

function normalizarLongitudMinima(valor) {
  const numero = Number(valor);
  if (
    !Number.isInteger(numero) ||
    numero < 1 ||
    numero > LONGITUD_MAXIMA_PASSWORD_BCRYPT_BYTES
  ) {
    throw new Error(
      'La longitud mínima debe ser un entero entre 1 y 72 caracteres.'
    );
  }
  return numero;
}
