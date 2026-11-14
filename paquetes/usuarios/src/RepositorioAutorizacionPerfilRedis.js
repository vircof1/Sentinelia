import crypto from 'node:crypto';

const PROPOSITO_EDICION_PERFIL = 'editar_perfil_propio';

export class RepositorioAutorizacionPerfilRedis {
  constructor({
    clienteRedis,
    prefijoRedis = 'sentinelia:perfil:autorizacion:',
    ttlAutorizacionSegundos = 15 * 60,
    cadenciaReautenticacionSegundos = 2,
    obtenerAhoraMs = () => Date.now()
  }) {
    this.clienteRedis = clienteRedis;
    this.prefijoRedis = prefijoRedis;
    this.ttlAutorizacionSegundos = ttlAutorizacionSegundos;
    this.cadenciaReautenticacionSegundos =
      cadenciaReautenticacionSegundos;
    this.obtenerAhoraMs = obtenerAhoraMs;
  }

  async intentarRegistrarReautenticacion(idUsuarioReal) {
    const clave = this.obtenerClaveCadencia(idUsuarioReal);
    const resultado = await this.clienteRedis.set(clave, '1', {
      NX: true,
      EX: this.cadenciaReautenticacionSegundos
    });

    if (resultado === 'OK') {
      return {
        permitido: true,
        reintentarEnSegundos: 0
      };
    }

    const ttlRestante = await this.clienteRedis.ttl(clave);

    return {
      permitido: false,
      reintentarEnSegundos: Math.max(
        1,
        Number(ttlRestante) > 0
          ? Number(ttlRestante)
          : this.cadenciaReautenticacionSegundos
      )
    };
  }

  async guardarAutorizacion({ idUsuarioReal, idSesion }) {
    const ahoraMs = Number(this.obtenerAhoraMs());
    const creadaEn = new Date(ahoraMs).toISOString();
    const expiraEn = new Date(
      ahoraMs + this.ttlAutorizacionSegundos * 1000
    ).toISOString();
    const autorizacion = {
      idUsuarioReal: Number(idUsuarioReal),
      huellaSesion: this.calcularHuellaSesion(idSesion),
      proposito: PROPOSITO_EDICION_PERFIL,
      creadaEn,
      expiraEn
    };

    await this.clienteRedis.set(
      this.obtenerClaveAutorizacion({ idUsuarioReal, idSesion }),
      JSON.stringify(autorizacion),
      { EX: this.ttlAutorizacionSegundos }
    );

    return autorizacion;
  }

  async obtenerAutorizacion({ idUsuarioReal, idSesion }) {
    const clave = this.obtenerClaveAutorizacion({ idUsuarioReal, idSesion });
    const bruto = await this.clienteRedis.get(clave);

    if (!bruto) {
      return null;
    }

    let autorizacion;

    try {
      autorizacion = JSON.parse(bruto);
    } catch (_error) {
      await this.clienteRedis.del(clave);
      return null;
    }

    const coincide =
      Number(autorizacion.idUsuarioReal) === Number(idUsuarioReal) &&
      autorizacion.huellaSesion === this.calcularHuellaSesion(idSesion) &&
      autorizacion.proposito === PROPOSITO_EDICION_PERFIL &&
      Date.parse(autorizacion.expiraEn) > Number(this.obtenerAhoraMs());

    if (!coincide) {
      await this.clienteRedis.del(clave);
      return null;
    }

    return autorizacion;
  }

  async revocarAutorizacion({ idUsuarioReal, idSesion }) {
    const eliminadas = await this.clienteRedis.del(
      this.obtenerClaveAutorizacion({ idUsuarioReal, idSesion })
    );

    return Number(eliminadas || 0) > 0;
  }

  async revocarAutorizacionesUsuario(idUsuarioReal) {
    const idUsuario = this.normalizarIdUsuario(idUsuarioReal);
    const claves = [];

    for await (const clave of this.clienteRedis.scanIterator({
      MATCH: `${this.prefijoRedis}usuario:${idUsuario}:sesion:*`,
      COUNT: 100
    })) {
      claves.push(clave);
    }

    const autorizacionesRevocadas = claves.length > 0
      ? await this.clienteRedis.del(claves)
      : 0;
    const cadenciaEliminada = await this.clienteRedis.del(
      this.obtenerClaveCadencia(idUsuario)
    );

    return {
      autorizacionesRevocadas: Number(autorizacionesRevocadas || 0),
      estadoCadenciaEliminado: Number(cadenciaEliminada || 0) > 0
    };
  }

  obtenerClaveAutorizacion({ idUsuarioReal, idSesion }) {
    return `${this.prefijoRedis}usuario:${this.normalizarIdUsuario(idUsuarioReal)}:sesion:${this.calcularHuellaSesion(idSesion)}`;
  }

  obtenerClaveCadencia(idUsuarioReal) {
    return `${this.prefijoRedis}cadencia:usuario:${this.normalizarIdUsuario(idUsuarioReal)}`;
  }

  calcularHuellaSesion(idSesion) {
    const normalizado = String(idSesion || '').trim();

    if (!normalizado) {
      throw new Error('La autorización de perfil requiere una sesión válida.');
    }

    return crypto.createHash('sha256').update(normalizado).digest('hex');
  }

  normalizarIdUsuario(idUsuario) {
    const normalizado = Number(idUsuario);

    if (!Number.isInteger(normalizado) || normalizado <= 0) {
      throw new Error('La autorización de perfil requiere un usuario válido.');
    }

    return normalizado;
  }
}
