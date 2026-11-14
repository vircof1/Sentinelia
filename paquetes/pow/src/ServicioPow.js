import crypto from 'node:crypto';
import { DesafioPow } from './DesafioPow.js';

export class ServicioPow {
  constructor({
    repositorioPowRedis,
    servicioConfiguracionPortal,
    validadorPow
  }) {
    this.repositorioPowRedis = repositorioPowRedis;
    this.servicioConfiguracionPortal = servicioConfiguracionPortal;
    this.validadorPow = validadorPow;
  }

  async emitirDesafio({ ip, hashrateCliente }) {
    const configuracionPow = this.obtenerConfiguracionPow();

    if (!configuracionPow.activo) {
      return {
        activo: false
      };
    }

    const perfilIp = await this.repositorioPowRedis.obtenerPerfilIp(ip);
    await this.repositorioPowRedis.registrarDesafioEmitido(ip);

    const hashrateReferencia = this.calcularHashrateReferencia({
      hashrateCliente,
      hashrateObservada: perfilIp.hashrateObservada
    });

    const tiempoObjetivoMs = this.calcularTiempoObjetivoMs(perfilIp);
    const coste = this.calcularCoste({
      hashrateReferencia,
      tiempoObjetivoMs
    });

    const emitidoEn = Date.now();
    const desafio = new DesafioPow({
      id: crypto.randomUUID(),
      ip,
      reto: crypto.randomBytes(16).toString('hex'),
      sal: crypto.randomBytes(12).toString('hex'),
      coste,
      regla: this.describirReglaCoste(coste),
      tiempoObjetivoMs,
      hashrateReferencia,
      emitidoEn,
      expiraEn: emitidoEn + configuracionPow.ttlDesafioSegundos * 1000,
      benchmarkClienteMs: configuracionPow.benchmarkClienteMs
    });

    await this.repositorioPowRedis.guardarDesafio(desafio);

    return {
      activo: true,
      id: desafio.id,
      reto: desafio.reto,
      sal: desafio.sal,
      coste: desafio.coste,
      regla: desafio.regla,
      tiempoObjetivoMs: desafio.tiempoObjetivoMs,
      benchmarkClienteMs: desafio.benchmarkClienteMs
    };
  }

  async validarEntrega({
    ip,
    idDesafio,
    nonce,
    duracionClienteMs,
    hashrateCliente
  }) {
    const configuracionPow = this.obtenerConfiguracionPow();

    if (!configuracionPow.activo) {
      return {
        exito: true
      };
    }

    if (!idDesafio || nonce === undefined || nonce === null || nonce === '') {
      return {
        exito: false,
        codigo: 'pow_incompleto',
        mensaje: 'La prueba de trabajo no se ha entregado.'
      };
    }

    const desafio = await this.repositorioPowRedis.consumirDesafio(idDesafio);

    if (!desafio) {
      return {
        exito: false,
        codigo: 'pow_desafio_no_encontrado',
        mensaje: 'La prueba de trabajo ya no es válida. Repite el acceso.'
      };
    }

    if (desafio.ip !== ip) {
      return {
        exito: false,
        codigo: 'pow_ip_invalida',
        mensaje: 'La prueba de trabajo no corresponde a esta dirección IP.'
      };
    }

    if (Date.now() > desafio.expiraEn) {
      return {
        exito: false,
        codigo: 'pow_expirado',
        mensaje: 'La prueba de trabajo ha expirado. Repite el acceso.'
      };
    }

    const nonceNumerico = Number.parseInt(String(nonce), 10);

    if (!Number.isFinite(nonceNumerico) || nonceNumerico < 0) {
      return {
        exito: false,
        codigo: 'pow_nonce_invalido',
        mensaje: 'La prueba de trabajo entregada no es válida.'
      };
    }

    const hashHex = this.validadorPow.crearHashHex(
      desafio.reto,
      desafio.sal,
      nonceNumerico
    );

    if (
      !this.validadorPow.cumpleCosteHex(hashHex, desafio.coste)
    ) {
      await this.repositorioPowRedis.registrarLoginFallido(ip);

      return {
        exito: false,
        codigo: 'pow_invalido',
        mensaje: 'La prueba de trabajo no supera el coste requerido.'
      };
    }

    const duracionServidorMs = Math.max(Date.now() - desafio.emitidoEn, 1);
    const hashesProbados = nonceNumerico + 1;
    const hashrateObservada = this.normalizarHashrate(
      Math.round((hashesProbados / duracionServidorMs) * 1000)
    );

    await this.repositorioPowRedis.guardarHashrateObservada(
      ip,
      this.mezclarHashrates({
        hashrateObservada,
        hashrateCliente
      })
    );

    await this.repositorioPowRedis.guardarUltimoResultado(ip, {
      idDesafio: desafio.id,
      coste: desafio.coste,
      hashesProbados,
      duracionServidorMs,
      duracionClienteMs: Number(duracionClienteMs || 0)
    });

    return {
      exito: true,
      coste: desafio.coste,
      hashesProbados,
      duracionServidorMs
    };
  }

  async registrarLoginFallido(ip) {
    await this.repositorioPowRedis.registrarLoginFallido(ip);
  }

  async registrarLoginExitoso(ip) {
    await this.repositorioPowRedis.limpiarFallosLogin(ip);
  }

  calcularTiempoObjetivoMs(perfilIp) {
    const configuracionPow = this.obtenerConfiguracionPow();
    const aumentoIntentos =
      perfilIp.desafiosRecientes * configuracionPow.incrementoPorIntentoMs;
    const aumentoFallos =
      perfilIp.fallosLoginRecientes * configuracionPow.incrementoPorFalloMs;

    const tiempoObjetivo =
      configuracionPow.tiempoObjetivoMs + aumentoIntentos + aumentoFallos;

    return Math.max(
      configuracionPow.tiempoMinimoMs,
      Math.min(configuracionPow.tiempoMaximoMs, tiempoObjetivo)
    );
  }

  calcularCoste({ hashrateReferencia, tiempoObjetivoMs }) {
    const configuracionPow = this.obtenerConfiguracionPow();
    const hashesEsperados = Math.max(
      1,
      Math.round((hashrateReferencia * tiempoObjetivoMs) / 1000)
    );

    const coste = Math.round(Math.log2(hashesEsperados));

    return Math.max(
      configuracionPow.costeMinimo,
      Math.min(configuracionPow.costeMaximo, coste)
    );
  }

  describirReglaCoste(coste) {
    const longitud = 64;
    const vueltasCompletas = Math.floor(coste / longitud);
    const resto = coste % longitud;

    const etiqueta = (bits) => {
      if (bits <= 0) return '0-f';
      if (bits === 1) return '0-7';
      if (bits === 2) return '0-3';
      if (bits === 3) return '0-1';
      return '0';
    };

    if (coste <= 0) {
      return 'Cualquier hash es valido.';
    }

    if (vueltasCompletas === 0) {
      return `Primeros ${resto} nibbles entre ${etiqueta(1)}; resto libre.`;
    }

    if (resto === 0) {
      return `Todos los nibbles entre ${etiqueta(vueltasCompletas)}.`;
    }

    return `Todos los nibbles entre ${etiqueta(vueltasCompletas)} y primeros ${resto} entre ${etiqueta(vueltasCompletas + 1)}.`;
  }

  calcularHashrateReferencia({ hashrateCliente, hashrateObservada }) {
    const configuracionPow = this.obtenerConfiguracionPow();
    return this.normalizarHashrate(
      Math.max(
        configuracionPow.hashratePorDefecto,
        Number(hashrateObservada || 0),
        Number(hashrateCliente || 0)
      )
    );
  }

  mezclarHashrates({ hashrateObservada, hashrateCliente }) {
    const clienteNormalizado = this.normalizarHashrate(
      Number(hashrateCliente || 0)
    );

    if (!clienteNormalizado) {
      return hashrateObservada;
    }

    return this.normalizarHashrate(
      Math.round((hashrateObservada * 0.7) + (clienteNormalizado * 0.3))
    );
  }

  normalizarHashrate(hashrate) {
    const configuracionPow = this.obtenerConfiguracionPow();

    if (!hashrate || !Number.isFinite(hashrate)) {
      return configuracionPow.hashratePorDefecto;
    }

    return Math.max(
      configuracionPow.hashrateMinimo,
      Math.min(configuracionPow.hashrateMaximo, Math.round(hashrate))
    );
  }

  obtenerConfiguracionPow() {
    return this.servicioConfiguracionPortal
      .obtenerConfiguracionActual()
      .obtenerConfiguracionPow();
  }
}
