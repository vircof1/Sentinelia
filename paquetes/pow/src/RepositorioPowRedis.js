import { DesafioPow } from './DesafioPow.js';

export class RepositorioPowRedis {
  constructor({ clienteRedis, servicioConfiguracionPortal }) {
    this.clienteRedis = clienteRedis;
    this.servicioConfiguracionPortal = servicioConfiguracionPortal;
  }

  async obtenerPerfilIp(ip) {
    const [desafiosRecientes, fallosLoginRecientes, hashrateObservada] =
      await this.clienteRedis.mGet([
        this.obtenerClaveDesafiosIp(ip),
        this.obtenerClaveFallosLoginIp(ip),
        this.obtenerClaveHashrateIp(ip)
      ]);

    return {
      desafiosRecientes: Number(desafiosRecientes || 0),
      fallosLoginRecientes: Number(fallosLoginRecientes || 0),
      hashrateObservada: Number(hashrateObservada || 0)
    };
  }

  async registrarDesafioEmitido(ip) {
    const configuracionPow = this.obtenerConfiguracionPow();
    const multi = this.clienteRedis.multi();
    multi.incr(this.obtenerClaveDesafiosIp(ip));
    multi.expire(
      this.obtenerClaveDesafiosIp(ip),
      configuracionPow.ventanaIntentosSegundos
    );
    await multi.exec();
  }

  async registrarLoginFallido(ip) {
    const configuracionPow = this.obtenerConfiguracionPow();
    const multi = this.clienteRedis.multi();
    multi.incr(this.obtenerClaveFallosLoginIp(ip));
    multi.expire(
      this.obtenerClaveFallosLoginIp(ip),
      configuracionPow.ventanaIntentosSegundos
    );
    await multi.exec();
  }

  async limpiarFallosLogin(ip) {
    await this.clienteRedis.del(this.obtenerClaveFallosLoginIp(ip));
  }

  async guardarHashrateObservada(ip, hashrateHps) {
    const configuracionPow = this.obtenerConfiguracionPow();
    await this.clienteRedis.set(
      this.obtenerClaveHashrateIp(ip),
      String(hashrateHps),
      {
        EX: configuracionPow.ventanaIntentosSegundos * 4
      }
    );
  }

  async guardarUltimoResultado(ip, resumen) {
    const configuracionPow = this.obtenerConfiguracionPow();
    await this.clienteRedis.set(
      this.obtenerClaveUltimoResultadoIp(ip),
      JSON.stringify(resumen),
      {
        EX: configuracionPow.ventanaIntentosSegundos
      }
    );
  }

  async guardarDesafio(desafioPow) {
    const configuracionPow = this.obtenerConfiguracionPow();
    await this.clienteRedis.set(
      this.obtenerClaveDesafio(desafioPow.id),
      desafioPow.serializar(),
      {
        EX: configuracionPow.ttlDesafioSegundos
      }
    );
  }

  async consumirDesafio(idDesafio) {
    const valor = await this.clienteRedis.getDel(
      this.obtenerClaveDesafio(idDesafio)
    );

    if (!valor) {
      return null;
    }

    return DesafioPow.desdeJson(valor);
  }

  obtenerClaveDesafio(idDesafio) {
    return `${this.obtenerConfiguracionPow().redisPrefijo}desafio:${idDesafio}`;
  }

  obtenerClaveDesafiosIp(ip) {
    return `${this.obtenerConfiguracionPow().redisPrefijo}ip:${ip}:desafios_recientes`;
  }

  obtenerClaveFallosLoginIp(ip) {
    return `${this.obtenerConfiguracionPow().redisPrefijo}ip:${ip}:fallos_login_recientes`;
  }

  obtenerClaveHashrateIp(ip) {
    return `${this.obtenerConfiguracionPow().redisPrefijo}ip:${ip}:hashrate_hps`;
  }

  obtenerClaveUltimoResultadoIp(ip) {
    return `${this.obtenerConfiguracionPow().redisPrefijo}ip:${ip}:ultimo_resultado`;
  }

  obtenerConfiguracionPow() {
    return this.servicioConfiguracionPortal
      .obtenerConfiguracionActual()
      .obtenerConfiguracionPow();
  }
}
