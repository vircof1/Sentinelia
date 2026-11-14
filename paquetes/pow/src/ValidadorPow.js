import crypto from 'node:crypto';

export class ValidadorPow {
  crearHashHex(reto, sal, nonce) {
    return crypto
      .createHash('sha256')
      .update(`${reto}:${sal}:${nonce}`)
      .digest('hex');
  }

  cumpleCosteHex(hashHex, coste) {
    const restricciones = this.calcularRestriccionesHex(coste, hashHex.length);

    for (let indice = 0; indice < hashHex.length; indice += 1) {
      const nibble = Number.parseInt(hashHex[indice], 16);

      if (nibble > restricciones[indice]) {
        return false;
      }
    }

    return true;
  }

  calcularRestriccionesHex(coste, longitudHex) {
    const costeSeguro = Math.max(0, Number.parseInt(String(coste), 10) || 0);
    const vueltasCompletas = Math.floor(costeSeguro / longitudHex);
    const resto = costeSeguro % longitudHex;

    return Array.from({ length: longitudHex }, (_valor, indice) =>
      this.obtenerValorMaximoNibble(
        vueltasCompletas + (indice < resto ? 1 : 0)
      )
    );
  }

  obtenerValorMaximoNibble(bitsExigidosEnNibble) {
    if (bitsExigidosEnNibble <= 0) {
      return 0xf;
    }

    if (bitsExigidosEnNibble === 1) {
      return 0x7;
    }

    if (bitsExigidosEnNibble === 2) {
      return 0x3;
    }

    if (bitsExigidosEnNibble === 3) {
      return 0x1;
    }

    return 0x0;
  }
}
