import { createClient } from 'redis';

export class ServicioConexionRedis {
  constructor(configuracionRedis) {
    this.configuracionRedis = configuracionRedis;
    this.cliente = null;
  }

  async conectar() {
    if (this.cliente) {
      return this.cliente;
    }

    this.cliente = createClient({
      url: this.configuracionRedis.url
    });

    this.cliente.on('error', (error) => {
      console.error('[redis] Error de cliente');
      console.error(error);
    });

    await this.cliente.connect();
    return this.cliente;
  }

  async comprobarSalud() {
    const cliente = await this.conectar();
    return cliente.ping();
  }

  async cerrar() {
    if (!this.cliente) {
      return;
    }

    await this.cliente.quit();
    this.cliente = null;
  }
}
