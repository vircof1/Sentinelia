(function () {
  const formulario = document.querySelector('[data-formulario-pow]');
  if (!formulario) {
    return;
  }

  const boton = formulario.querySelector('[data-boton-pow]');
  const estado = formulario.querySelector('[data-pow-estado]');
  const campoDesafio = formulario.querySelector('input[name="pow_desafio_id"]');
  const campoNonce = formulario.querySelector('input[name="pow_nonce"]');
  const campoDuracion = formulario.querySelector('input[name="pow_duracion_ms"]');
  const campoHashrate = formulario.querySelector('input[name="pow_hashrate_cliente"]');
  const tokenCSRF = obtenerTokenCSRF();

  let enviando = false;

  formulario.addEventListener('submit', async function (evento) {
    if (enviando) {
      return;
    }

    evento.preventDefault();
    enviando = true;
    boton.disabled = true;

    try {
      actualizarEstado('Midiendo capacidad de cálculo...');
      const hashrateCliente = await medirHashrate();
      campoHashrate.value = String(hashrateCliente);

      actualizarEstado('Solicitando desafío...');
      const respuestaDesafio = await fetch(
        formulario.dataset.powEndpoint || '/pow/desafio', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(tokenCSRF ? { 'X-CSRF-Token': tokenCSRF } : {})
          },
          body: JSON.stringify({
            hashrateCliente
          })
        }
      );

      if (!respuestaDesafio.ok) {
        throw new Error('No se pudo obtener un desafío PoW.');
      }

      const desafio = await respuestaDesafio.json();

      if (!desafio.activo) {
        formulario.submit();
        return;
      }

      const tiempoEstimado = Math.max(
        0.1,
        Math.pow(2, desafio.coste) / hashrateCliente
      );
      actualizarEstado(
        `Resolviendo prueba de trabajo, coste ${desafio.coste} (~${tiempoEstimado.toFixed(1)} s)...`
      );

      const resultado = await resolverDesafio(desafio);

      campoDesafio.value = desafio.id;
      campoNonce.value = String(resultado.nonce);
      campoDuracion.value = String(resultado.duracionMs);

      actualizarEstado(`Prueba resuelta. ${desafio.regla} Enviando formulario...`);
      formulario.submit();
    } catch (error) {
      console.error(error);
      actualizarEstado('No se pudo completar la prueba de trabajo.');
      boton.disabled = false;
      enviando = false;
    }
  });

  function actualizarEstado(mensaje) {
    if (estado) {
      estado.hidden = false;
      estado.textContent = mensaje;
    }
  }

  async function medirHashrate() {
    const inicio = performance.now();
    let hashes = 0;
    let nonce = 0;

    while ((performance.now() - inicio) < 180) {
      await sha256(`benchmark:${nonce}`);
      nonce += 1;
      hashes += 1;
    }

    const duracionMs = Math.max(performance.now() - inicio, 1);
    return Math.max(1, Math.round((hashes / duracionMs) * 1000));
  }

  async function resolverDesafio(desafio) {
    const inicio = performance.now();
    let nonce = 0;

    while (true) {
      const hash = await sha256Bytes(`${desafio.reto}:${desafio.sal}:${nonce}`);

      if (cumpleCoste(hash, desafio.coste)) {
        return {
          nonce,
          duracionMs: Math.round(performance.now() - inicio)
        };
      }

      nonce += 1;

      if (nonce % 500 === 0) {
        actualizarEstado(`Resolviendo prueba de trabajo (${nonce.toLocaleString()} intentos)...`);
      }
    }
  }

  async function sha256(valor) {
    await sha256Bytes(valor);
  }

  async function sha256Bytes(valor) {
    const bytes = new TextEncoder().encode(valor);
    if (globalThis.crypto?.subtle?.digest) {
      return new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
    }

    return sha256BytesJavascript(bytes);
  }

  function sha256BytesJavascript(bytesEntrada) {
    const constantesK = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
      0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
      0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
      0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
      0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
      0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
      0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
      0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
      0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ];
    const longitudBitsAlta = Math.floor((bytesEntrada.length * 8) / 0x100000000);
    const longitudBitsBaja = (bytesEntrada.length * 8) >>> 0;
    const longitudRelleno = (((bytesEntrada.length + 9 + 63) >> 6) << 6);
    const bytes = new Uint8Array(longitudRelleno);
    const palabras = new Uint32Array(64);
    let h0 = 0x6a09e667;
    let h1 = 0xbb67ae85;
    let h2 = 0x3c6ef372;
    let h3 = 0xa54ff53a;
    let h4 = 0x510e527f;
    let h5 = 0x9b05688c;
    let h6 = 0x1f83d9ab;
    let h7 = 0x5be0cd19;

    bytes.set(bytesEntrada);
    bytes[bytesEntrada.length] = 0x80;
    bytes[longitudRelleno - 8] = (longitudBitsAlta >>> 24) & 0xff;
    bytes[longitudRelleno - 7] = (longitudBitsAlta >>> 16) & 0xff;
    bytes[longitudRelleno - 6] = (longitudBitsAlta >>> 8) & 0xff;
    bytes[longitudRelleno - 5] = longitudBitsAlta & 0xff;
    bytes[longitudRelleno - 4] = (longitudBitsBaja >>> 24) & 0xff;
    bytes[longitudRelleno - 3] = (longitudBitsBaja >>> 16) & 0xff;
    bytes[longitudRelleno - 2] = (longitudBitsBaja >>> 8) & 0xff;
    bytes[longitudRelleno - 1] = longitudBitsBaja & 0xff;

    for (let offset = 0; offset < bytes.length; offset += 64) {
      for (let indice = 0; indice < 16; indice += 1) {
        const posicion = offset + (indice * 4);
        palabras[indice] =
          ((bytes[posicion] << 24) |
            (bytes[posicion + 1] << 16) |
            (bytes[posicion + 2] << 8) |
            bytes[posicion + 3]) >>> 0;
      }

      for (let indice = 16; indice < 64; indice += 1) {
        const s0 = rotarDerecha(palabras[indice - 15], 7) ^
          rotarDerecha(palabras[indice - 15], 18) ^
          (palabras[indice - 15] >>> 3);
        const s1 = rotarDerecha(palabras[indice - 2], 17) ^
          rotarDerecha(palabras[indice - 2], 19) ^
          (palabras[indice - 2] >>> 10);
        palabras[indice] = (
          palabras[indice - 16] + s0 + palabras[indice - 7] + s1
        ) >>> 0;
      }

      let a = h0;
      let b = h1;
      let c = h2;
      let d = h3;
      let e = h4;
      let f = h5;
      let g = h6;
      let h = h7;

      for (let indice = 0; indice < 64; indice += 1) {
        const s1 = rotarDerecha(e, 6) ^ rotarDerecha(e, 11) ^ rotarDerecha(e, 25);
        const ch = (e & f) ^ ((~e) & g);
        const temp1 = (h + s1 + ch + constantesK[indice] + palabras[indice]) >>> 0;
        const s0 = rotarDerecha(a, 2) ^ rotarDerecha(a, 13) ^ rotarDerecha(a, 22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const temp2 = (s0 + maj) >>> 0;

        h = g;
        g = f;
        f = e;
        e = (d + temp1) >>> 0;
        d = c;
        c = b;
        b = a;
        a = (temp1 + temp2) >>> 0;
      }

      h0 = (h0 + a) >>> 0;
      h1 = (h1 + b) >>> 0;
      h2 = (h2 + c) >>> 0;
      h3 = (h3 + d) >>> 0;
      h4 = (h4 + e) >>> 0;
      h5 = (h5 + f) >>> 0;
      h6 = (h6 + g) >>> 0;
      h7 = (h7 + h) >>> 0;
    }

    return palabrasABytes([h0, h1, h2, h3, h4, h5, h6, h7]);
  }

  function rotarDerecha(valor, bits) {
    return (valor >>> bits) | (valor << (32 - bits));
  }

  function palabrasABytes(palabras) {
    const bytes = new Uint8Array(palabras.length * 4);

    for (let indice = 0; indice < palabras.length; indice += 1) {
      const palabra = palabras[indice];
      const posicion = indice * 4;
      bytes[posicion] = (palabra >>> 24) & 0xff;
      bytes[posicion + 1] = (palabra >>> 16) & 0xff;
      bytes[posicion + 2] = (palabra >>> 8) & 0xff;
      bytes[posicion + 3] = palabra & 0xff;
    }

    return bytes;
  }

  function cumpleCoste(hash, coste) {
    const restricciones = calcularRestriccionesHex(coste, hash.length * 2);
    const hex = Array.from(hash, (byte) => byte.toString(16).padStart(2, '0')).join('');

    for (let indice = 0; indice < hex.length; indice += 1) {
      const nibble = Number.parseInt(hex[indice], 16);
      if (nibble > restricciones[indice]) {
        return false;
      }
    }

    return true;
  }

  function calcularRestriccionesHex(coste, longitudHex) {
    const vueltasCompletas = Math.floor(coste / longitudHex);
    const resto = coste % longitudHex;
    const restricciones = [];

    for (let indice = 0; indice < longitudHex; indice += 1) {
      const bits = vueltasCompletas + (indice < resto ? 1 : 0);
      restricciones.push(obtenerValorMaximoNibble(bits));
    }

    return restricciones;
  }

  function obtenerValorMaximoNibble(bitsExigidos) {
    if (bitsExigidos <= 0) return 0xf;
    if (bitsExigidos === 1) return 0x7;
    if (bitsExigidos === 2) return 0x3;
    if (bitsExigidos === 3) return 0x1;
    return 0x0;
  }

  function obtenerTokenCSRF() {
    const meta = document.querySelector('meta[name="csrf-token"]');
    const desdeMeta = String(meta?.getAttribute('content') || '').trim();

    if (desdeMeta) {
      return desdeMeta;
    }

    return String(document.body?.dataset?.csrfToken || '').trim();
  }
})();
