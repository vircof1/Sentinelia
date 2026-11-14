import { createHash, randomBytes } from 'node:crypto';
import {
  validarCredencialTemporalFederacion,
  validarInvitacionIdFederacion
} from '../src/InvitacionEstablecimientoFederacion.js';

export class GeneradorCredencialInvitacionFederacion {
  constructor({ generarBytes = randomBytes } = {}) {
    if (typeof generarBytes !== 'function') {
      throw new Error('El generador de invitaciones requiere entropía criptográfica.');
    }
    this.generarBytes = generarBytes;
  }

  generar() {
    const invitacionId = `sfinv1_${base64url(this.generarBytes(16), 16)}`;
    const credencialTemporal = `sft1_${base64url(this.generarBytes(32), 32)}`;
    validarInvitacionIdFederacion(invitacionId);
    validarCredencialTemporalFederacion(credencialTemporal);
    return Object.freeze({
      invitacionId,
      credencialTemporal,
      credencialHash: calcularHuellaCredencialTemporalFederacion(
        credencialTemporal
      )
    });
  }
}

export function calcularHuellaCredencialTemporalFederacion(credencialTemporal) {
  validarCredencialTemporalFederacion(credencialTemporal);
  return createHash('sha256').update(credencialTemporal, 'utf8').digest();
}

function base64url(valor, bytesEsperados) {
  if (!Buffer.isBuffer(valor) || valor.length !== bytesEsperados) {
    throw new Error(`La fuente de entropía debe entregar ${bytesEsperados} bytes.`);
  }
  return valor.toString('base64url');
}
