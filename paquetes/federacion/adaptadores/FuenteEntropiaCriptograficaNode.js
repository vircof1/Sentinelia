import { randomBytes } from 'node:crypto';

export class FuenteEntropiaCriptograficaNode {
  constructor() {
    this.entropiaBitsPorIdentidad = 128;
    Object.freeze(this);
  }

  generarBytes({ cantidadBytes } = {}) {
    if (!Number.isSafeInteger(cantidadBytes) || cantidadBytes < 1) {
      throw new Error('La fuente criptográfica exige una cantidad positiva de bytes.');
    }
    return new Uint8Array(randomBytes(cantidadBytes));
  }
}
