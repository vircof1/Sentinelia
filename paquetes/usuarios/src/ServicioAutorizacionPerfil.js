import { ErrorAutogestionPerfil } from './ErrorAutogestionPerfil.js';

export class ServicioAutorizacionPerfil {
  constructor({ repositorioAutorizacionPerfil, servicioAutenticacion }) {
    this.repositorioAutorizacionPerfil = repositorioAutorizacionPerfil;
    this.servicioAutenticacion = servicioAutenticacion;
  }

  async desbloquear({ contextoUsuarioActual, idSesion, passwordActual }) {
    const identidad = this.validarIdentidadOrdinaria(contextoUsuarioActual);
    const password = String(passwordActual || '');

    if (!password) {
      throw this.crearError({
        codigo: 'peticion_invalida',
        mensaje: 'Debes indicar tu contraseña actual.'
      });
    }

    const cadencia =
      await this.repositorioAutorizacionPerfil.intentarRegistrarReautenticacion(
        identidad.idUsuarioReal
      );

    if (!cadencia.permitido) {
      throw this.crearError({
        codigo: 'reauth_limitada',
        mensaje: 'Espera antes de volver a comprobar la contraseña.',
        estadoHttp: 429,
        datos: {
          reintentar_en_segundos: cadencia.reintentarEnSegundos
        }
      });
    }

    const comprobacion =
      await this.servicioAutenticacion.verificarPasswordActual({
        idUsuario: identidad.idUsuarioReal,
        password
      });

    if (!comprobacion.usuarioVigente) {
      throw this.crearError({
        codigo: 'sesion_no_vigente',
        mensaje: 'La cuenta ya no está disponible. Vuelve a iniciar sesión.',
        estadoHttp: 401
      });
    }

    if (!comprobacion.passwordValida) {
      throw this.crearError({
        codigo: 'password_actual_incorrecta',
        mensaje: 'La contraseña actual no es correcta.'
      });
    }

    const autorizacion =
      await this.repositorioAutorizacionPerfil.guardarAutorizacion({
        idUsuarioReal: identidad.idUsuarioReal,
        idSesion
      });

    return {
      codigo: 'perfil_edicion_autorizada',
      mensaje: 'La edición del perfil está autorizada durante 15 minutos.',
      datos: {
        expira_en: autorizacion.expiraEn
      }
    };
  }

  async cerrarEdicion({ contextoUsuarioActual, idSesion }) {
    const identidad = this.validarIdentidadOrdinaria(contextoUsuarioActual);
    const revocada =
      await this.repositorioAutorizacionPerfil.revocarAutorizacion({
        idUsuarioReal: identidad.idUsuarioReal,
        idSesion
      });

    return {
      codigo: 'perfil_edicion_cerrada',
      mensaje: revocada
        ? 'La autorización de edición se ha revocado.'
        : 'La edición del perfil ya estaba cerrada.',
      datos: {
        revocada
      }
    };
  }

  async revocarTodasLasAutorizaciones(idUsuarioReal) {
    return this.repositorioAutorizacionPerfil.revocarAutorizacionesUsuario(
      idUsuarioReal
    );
  }

  async obtenerEstado({ contextoUsuarioActual, idSesion }) {
    const identidad = this.validarIdentidadOrdinaria(contextoUsuarioActual);
    const autorizacion =
      await this.repositorioAutorizacionPerfil.obtenerAutorizacion({
        idUsuarioReal: identidad.idUsuarioReal,
        idSesion
      });

    return {
      autorizada: Boolean(autorizacion),
      expiraEn: autorizacion?.expiraEn || null
    };
  }

  async exigirAutorizacion({ contextoUsuarioActual, idSesion }) {
    const estado = await this.obtenerEstado({ contextoUsuarioActual, idSesion });

    if (!estado.autorizada) {
      throw this.crearError({
        codigo: 'perfil_edicion_requerida',
        mensaje: 'Vuelve a introducir tu contraseña para editar el perfil.',
        estadoHttp: 403
      });
    }

    return estado;
  }

  validarIdentidadOrdinaria(contextoUsuarioActual) {
    const idUsuarioReal = Number(contextoUsuarioActual?.idUsuarioReal);
    const idUsuarioEfectivo = Number(contextoUsuarioActual?.idUsuario);
    const impersonacionActiva = Boolean(
      contextoUsuarioActual?.impersonacionActiva ||
      idUsuarioReal !== idUsuarioEfectivo
    );

    if (
      !Number.isInteger(idUsuarioReal) ||
      idUsuarioReal <= 0 ||
      !Number.isInteger(idUsuarioEfectivo) ||
      idUsuarioEfectivo <= 0
    ) {
      throw this.crearError({
        codigo: 'sesion_no_vigente',
        mensaje: 'La sesión no contiene una identidad válida.',
        estadoHttp: 401
      });
    }

    if (impersonacionActiva) {
      throw this.crearError({
        codigo: 'impersonacion_no_permitida',
        mensaje: 'No se permite editar perfiles durante una impersonación.',
        estadoHttp: 403
      });
    }

    return {
      idUsuarioReal,
      idUsuarioEfectivo
    };
  }

  crearError({ codigo, mensaje, estadoHttp = 400, datos = null }) {
    return new ErrorAutogestionPerfil({
      codigo,
      mensaje,
      estadoHttp,
      datos
    });
  }
}
