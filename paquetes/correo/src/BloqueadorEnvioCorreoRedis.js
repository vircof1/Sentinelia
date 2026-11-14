export class BloqueadorEnvioCorreoRedis {
  constructor({ clienteRedis, prefijoBloqueoCorreo }) {
    this.clienteRedis = clienteRedis;
    this.prefijoBloqueoCorreo = prefijoBloqueoCorreo;
  }

  async intentarBloquear({ idCorreo, ttlSegundos, identificadorInstancia }) {
    const clave = this.obtenerClaveBloqueo(idCorreo);
    const resultado = await this.clienteRedis.set(
      clave,
      identificadorInstancia,
      {
        NX: true,
        EX: ttlSegundos
      }
    );

    return resultado === 'OK';
  }

  async liberar(idCorreo) {
    await this.clienteRedis.del(this.obtenerClaveBloqueo(idCorreo));
  }

  obtenerClaveBloqueo(idCorreo) {
    return `${this.prefijoBloqueoCorreo}${idCorreo}`;
  }
}
