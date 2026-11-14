import { createHash, randomBytes } from 'node:crypto';

export class GeneradorRecuperacionFederacion {
  constructor({ generarBytes = randomBytes } = {}) {
    this.generarBytes = generarBytes;
  }

  generar() {
    const id = this.generarBytes(16);
    const secreto = this.generarBytes(32);
    if (!Buffer.isBuffer(id) || id.length !== 16 ||
        !Buffer.isBuffer(secreto) || secreto.length !== 32) {
      throw new Error('La recuperación exige 128 bits de identidad y 256 bits de secreto.');
    }
    const recuperacionId = `sfrec1_${id.toString('base64url')}`;
    const credencialTemporal = `sfrt1_${secreto.toString('base64url')}`;
    return Object.freeze({
      recuperacionId,
      credencialTemporal,
      credencialHash: huellaRecuperacionFederacion(credencialTemporal)
    });
  }
}

export function huellaRecuperacionFederacion(valor) {
  return createHash('sha256').update(String(valor), 'utf8').digest();
}
