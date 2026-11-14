const CONSTANTES_SHA256 = Object.freeze([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);

export function codificarUtf8Federacion(valor) {
  if (typeof valor !== 'string') {
    throw new TypeError('La codificación UTF-8 federada exige texto.');
  }
  return new TextEncoder().encode(valor);
}

export function calcularSha256Federacion(partes) {
  if (!Array.isArray(partes) || partes.some((parte) => !(parte instanceof Uint8Array))) {
    throw new TypeError('SHA-256 federado exige una lista de octetos.');
  }
  const longitud = partes.reduce((total, parte) => total + parte.byteLength, 0);
  const longitudRellenada = Math.ceil((longitud + 9) / 64) * 64;
  const mensaje = new Uint8Array(longitudRellenada);
  let desplazamiento = 0;
  for (const parte of partes) {
    mensaje.set(parte, desplazamiento);
    desplazamiento += parte.byteLength;
  }
  mensaje[longitud] = 0x80;
  const bits = BigInt(longitud) * 8n;
  for (let indice = 0; indice < 8; indice += 1) {
    mensaje[longitudRellenada - 1 - indice] = Number(
      (bits >> BigInt(indice * 8)) & 0xffn
    );
  }

  const estado = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
  ]);
  const palabras = new Uint32Array(64);
  for (let bloque = 0; bloque < mensaje.byteLength; bloque += 64) {
    for (let indice = 0; indice < 16; indice += 1) {
      const posicion = bloque + indice * 4;
      palabras[indice] = ((mensaje[posicion] << 24) |
        (mensaje[posicion + 1] << 16) |
        (mensaje[posicion + 2] << 8) |
        mensaje[posicion + 3]) >>> 0;
    }
    for (let indice = 16; indice < 64; indice += 1) {
      const s0 = rotarDerecha(palabras[indice - 15], 7) ^
        rotarDerecha(palabras[indice - 15], 18) ^ (palabras[indice - 15] >>> 3);
      const s1 = rotarDerecha(palabras[indice - 2], 17) ^
        rotarDerecha(palabras[indice - 2], 19) ^ (palabras[indice - 2] >>> 10);
      palabras[indice] = (palabras[indice - 16] + s0 +
        palabras[indice - 7] + s1) >>> 0;
    }
    comprimir(estado, palabras);
  }
  const salida = new Uint8Array(32);
  for (let indice = 0; indice < estado.length; indice += 1) {
    salida[indice * 4] = estado[indice] >>> 24;
    salida[indice * 4 + 1] = estado[indice] >>> 16;
    salida[indice * 4 + 2] = estado[indice] >>> 8;
    salida[indice * 4 + 3] = estado[indice];
  }
  return salida;
}

export function calcularSha256HexFederacion(texto) {
  return [...calcularSha256Federacion([codificarUtf8Federacion(texto)])]
    .map((valor) => valor.toString(16).padStart(2, '0'))
    .join('');
}

function comprimir(estado, palabras) {
  let [a, b, c, d, e, f, g, h] = estado;
  for (let indice = 0; indice < 64; indice += 1) {
    const suma1 = (h + (rotarDerecha(e, 6) ^ rotarDerecha(e, 11) ^
      rotarDerecha(e, 25)) + ((e & f) ^ (~e & g)) +
      CONSTANTES_SHA256[indice] + palabras[indice]) >>> 0;
    const suma2 = ((rotarDerecha(a, 2) ^ rotarDerecha(a, 13) ^
      rotarDerecha(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
    h = g; g = f; f = e; e = (d + suma1) >>> 0;
    d = c; c = b; b = a; a = (suma1 + suma2) >>> 0;
  }
  estado[0] = (estado[0] + a) >>> 0;
  estado[1] = (estado[1] + b) >>> 0;
  estado[2] = (estado[2] + c) >>> 0;
  estado[3] = (estado[3] + d) >>> 0;
  estado[4] = (estado[4] + e) >>> 0;
  estado[5] = (estado[5] + f) >>> 0;
  estado[6] = (estado[6] + g) >>> 0;
  estado[7] = (estado[7] + h) >>> 0;
}

function rotarDerecha(valor, bits) {
  return ((valor >>> bits) | (valor << (32 - bits))) >>> 0;
}
