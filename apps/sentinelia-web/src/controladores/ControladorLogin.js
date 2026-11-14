import {
  ErrorPreautenticacionCambioPasswordNoVigente
} from '../../../../paquetes/usuarios/src/ServicioAutenticacion.js';

export class ControladorLogin {
  constructor({
    servicioAutenticacion,
    servicioSesion,
    configuracionSesion,
    servicioPow,
    servicioDisponibilidadRecuperacionPassword = null
  }) {
    this.servicioAutenticacion = servicioAutenticacion;
    this.servicioSesion = servicioSesion;
    this.configuracionSesion = configuracionSesion;
    this.servicioPow = servicioPow;
    this.servicioDisponibilidadRecuperacionPassword =
      servicioDisponibilidadRecuperacionPassword;
  }

  async mostrarFormulario(requisicion, respuesta, next) {
    try {
      const tokenCSRFPortal =
        await this.servicioSesion.asegurarTokenCsrfPublico(requisicion);
      respuesta.locals.tokenCSRFPortal = tokenCSRFPortal;

      if (requisicion.session?.usuarioAutenticado) {
        respuesta.redirect('/panel');
        return;
      }

      if (requisicion.session?.usuarioCambioPassword) {
        respuesta.redirect('/cambio-password-obligatorio');
        return;
      }

      respuesta.render('login', {
        titulo: 'Acceso',
        error: null,
        formulario: {
          usuario: ''
        },
        recuperacionPasswordDisponible:
          await this.obtenerRecuperacionPasswordDisponible()
      });
    } catch (error) {
      next(error);
    }
  }

  async procesarLogin(requisicion, respuesta, next) {
    try {
      const tokenCSRFPortal =
        await this.servicioSesion.asegurarTokenCsrfPublico(requisicion);
      respuesta.locals.tokenCSRFPortal = tokenCSRFPortal;
      const usuario = String(requisicion.body.usuario || '').trim();
      const password = String(requisicion.body.password || '');

      if (!usuario || !password) {
        respuesta.status(400).render('login', {
          titulo: 'Acceso',
          error: 'Debes indicar usuario y contraseña.',
          formulario: { usuario },
          recuperacionPasswordDisponible:
            await this.obtenerRecuperacionPasswordDisponible()
        });
        return;
      }

      const resultadoPow = await this.servicioPow.validarEntrega({
        ip: this.resolverIpCliente(requisicion),
        idDesafio: String(requisicion.body.pow_desafio_id || '').trim(),
        nonce: requisicion.body.pow_nonce,
        duracionClienteMs: requisicion.body.pow_duracion_ms,
        hashrateCliente: requisicion.body.pow_hashrate_cliente
      });

      if (!resultadoPow.exito) {
        respuesta.status(400).render('login', {
          titulo: 'Acceso',
          error: resultadoPow.mensaje,
          formulario: { usuario },
          powActivo: true,
          recuperacionPasswordDisponible:
            await this.obtenerRecuperacionPasswordDisponible()
        });
        return;
      }

      const resultado = await this.servicioAutenticacion.autenticarPorCredenciales({
        usuario,
        password
      });

      if (resultado.codigo === 'cambio_password_requerido' && resultado.usuario) {
        await this.servicioPow.registrarLoginExitoso(
          this.resolverIpCliente(requisicion)
        );
        await this.servicioSesion.crearSesionCambioPasswordPendiente(
          requisicion,
          resultado.usuario
        );
        respuesta.redirect('/cambio-password-obligatorio');
        return;
      }

      if (!resultado.exito) {
        await this.servicioPow.registrarLoginFallido(
          this.resolverIpCliente(requisicion)
        );

        respuesta.status(401).render('login', {
          titulo: 'Acceso',
          error: resultado.mensaje,
          formulario: { usuario },
          powActivo: true,
          recuperacionPasswordDisponible:
            await this.obtenerRecuperacionPasswordDisponible()
        });
        return;
      }

      await this.servicioPow.registrarLoginExitoso(
        this.resolverIpCliente(requisicion)
      );
      await this.servicioAutenticacion.registrarAccesoExitoso(
        resultado.usuario.id
      );

      await this.servicioSesion.crearSesionUsuario(
        requisicion,
        resultado.usuario
      );

      respuesta.redirect(
        this.servicioSesion.obtenerDestinoTrasAutenticacion(requisicion)
      );
    } catch (error) {
      next(error);
    }
  }

  async procesarLogout(requisicion, respuesta, next) {
    try {
      await this.servicioSesion.destruirSesion(requisicion);
      respuesta.clearCookie(this.configuracionSesion.nombreCookie);
      respuesta.redirect('/login');
    } catch (error) {
      next(error);
    }
  }

  resolverIpCliente(requisicion) {
    return String(requisicion.ip || '')
      .replace('::ffff:', '')
      .trim();
  }

  async obtenerRecuperacionPasswordDisponible() {
    try {
      const estado = await this.servicioDisponibilidadRecuperacionPassword
        ?.evaluar?.();
      return estado?.disponible === true;
    } catch (error) {
      console.error(
        `[sentinelia-web] Disponibilidad de recuperación no evaluable (${String(error?.codigo || error?.name || 'Error')}).`
      );
      return false;
    }
  }

  async mostrarCambioPasswordObligatorio(requisicion, respuesta, next) {
    try {
      const tokenCSRFPortal =
        await this.servicioSesion.asegurarTokenCsrfPublico(requisicion);
      respuesta.locals.tokenCSRFPortal = tokenCSRFPortal;

      if (requisicion.session?.usuarioAutenticado) {
        respuesta.redirect('/panel');
        return;
      }

      const usuarioPendiente = await this.obtenerUsuarioPendienteValido(
        requisicion,
        respuesta
      );

      if (!usuarioPendiente) {
        return;
      }

      respuesta.render('cambio-password-obligatorio', {
        titulo: 'Cambio obligatorio de contraseña',
        error: null,
        formulario: {
          usuario: usuarioPendiente.usuario
        }
      });
    } catch (error) {
      next(error);
    }
  }

  async procesarCambioPasswordObligatorio(requisicion, respuesta, next) {
    try {
      const tokenCSRFPortal =
        await this.servicioSesion.asegurarTokenCsrfPublico(requisicion);
      respuesta.locals.tokenCSRFPortal = tokenCSRFPortal;
      const usuarioPendiente = await this.obtenerUsuarioPendienteValido(
        requisicion,
        respuesta
      );

      if (!usuarioPendiente) {
        return;
      }

      try {
        const actualizado =
          await this.servicioAutenticacion.completarCambioPasswordObligatorio({
            idUsuario: usuarioPendiente.idUsuario,
            versionSesionObservada: usuarioPendiente.versionSesion,
            passwordNuevo: String(requisicion.body.password_nuevo || ''),
            passwordConfirmacion: String(
              requisicion.body.password_confirmacion || ''
            )
          });

        await this.servicioSesion.consumirSesionCambioPasswordPendiente(
          requisicion,
          actualizado.id
        );
        await this.servicioSesion.crearSesionUsuario(
          requisicion,
          actualizado
        );

        respuesta.redirect(
          this.servicioSesion.obtenerDestinoTrasAutenticacion(requisicion)
        );
      } catch (error) {
        if (error instanceof ErrorPreautenticacionCambioPasswordNoVigente) {
          await this.servicioSesion.destruirSesion(requisicion);
          respuesta.clearCookie(this.configuracionSesion.nombreCookie);
          respuesta.redirect('/login');
          return;
        }

        respuesta.status(400).render('cambio-password-obligatorio', {
          titulo: 'Cambio obligatorio de contraseña',
          error: error.message,
          formulario: {
            usuario: usuarioPendiente.usuario
          }
        });
      }
    } catch (error) {
      next(error);
    }
  }

  async obtenerUsuarioPendienteValido(requisicion, respuesta) {
    const usuarioPendiente = requisicion.session?.usuarioCambioPassword ?? null;

    if (!usuarioPendiente) {
      respuesta.redirect('/login');
      return null;
    }

    const sesionVigente =
      await this.servicioSesion.validarVersionSesionCambioPassword(requisicion);

    if (!sesionVigente) {
      await this.servicioSesion.destruirSesion(requisicion);
      respuesta.clearCookie(this.configuracionSesion.nombreCookie);
      respuesta.redirect('/login');
      return null;
    }

    return usuarioPendiente;
  }
}
