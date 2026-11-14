export class ServicioEstadoSensibleUsuario {
  constructor({
    repositorioOperacionesEmail,
    servicioAutorizacionPerfil
  }) {
    this.repositorioOperacionesEmail = repositorioOperacionesEmail;
    this.servicioAutorizacionPerfil = servicioAutorizacionPerfil;
  }

  async ejecutarConExclusion(
    idUsuario,
    operacionDurable,
    { debeInvalidar = () => true } = {}
  ) {
    const bloqueo =
      await this.repositorioOperacionesEmail.adquirirBloqueoUsuario(idUsuario);
    if (!bloqueo) {
      throw new Error(
        'Existe otra operación sensible en curso para este usuario.'
      );
    }

    try {
      const resultado = await operacionDurable();
      const limpieza = debeInvalidar(resultado)
        ? await this.invalidarBajoExclusion(idUsuario)
        : this.construirLimpiezaOmitida();
      return { resultado, limpieza };
    } finally {
      await this.repositorioOperacionesEmail
        .liberarBloqueoUsuario(idUsuario, bloqueo)
        .catch(() => {});
    }
  }

  async invalidar(idUsuario) {
    return this.ejecutarConExclusion(idUsuario, async () => null);
  }

  async invalidarBajoExclusion(idUsuario) {
    const limpieza = {
      completa: true,
      autorizaciones: null,
      pruebaEmailInvalidada: false,
      errores: []
    };

    try {
      limpieza.autorizaciones =
        await this.servicioAutorizacionPerfil.revocarTodasLasAutorizaciones(
          idUsuario
        );
    } catch (error) {
      limpieza.completa = false;
      limpieza.errores.push({
        componente: 'autorizacion_perfil',
        mensaje: String(error?.message || 'No se pudo revocar la autorización.')
      });
    }

    try {
      const invalidadas =
        await this.repositorioOperacionesEmail.invalidarOperacionUsuario(
          idUsuario,
          { estado: 'sustituida' }
        );
      limpieza.pruebaEmailInvalidada = Number(invalidadas || 0) > 0;
    } catch (error) {
      limpieza.completa = false;
      limpieza.errores.push({
        componente: 'operacion_email',
        mensaje: String(error?.message || 'No se pudo invalidar la prueba de email.')
      });
    }

    return limpieza;
  }

  construirLimpiezaOmitida() {
    return {
      completa: true,
      omitida: true,
      autorizaciones: null,
      pruebaEmailInvalidada: false,
      errores: []
    };
  }
}
