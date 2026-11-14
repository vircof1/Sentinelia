export class VersionadorDnsRedis {
  constructor({ clienteRedis, claveVersion }) {
    this.clienteRedis = clienteRedis;
    this.claveVersion = claveVersion;
    this.validarClaveVersion();
  }

  async asegurarVersionInicial() {
    const versionActual = await this.obtenerVersionActual();

    if (versionActual != null) {
      return versionActual;
    }

    await this.clienteRedis.set(this.claveVersion, '1');
    return 1;
  }

  async obtenerVersionActual() {
    const versionActual = await this.clienteRedis.get(this.claveVersion);

    if (!versionActual) {
      return null;
    }

    return Number(versionActual);
  }

  async incrementarVersion() {
    return this.clienteRedis.incr(this.claveVersion);
  }

  validarClaveVersion() {
    if (!this.claveVersion || typeof this.claveVersion !== 'string') {
      throw new Error(
        'La clave Redis de versionado DNS no está configurada correctamente.'
      );
    }
  }
}
