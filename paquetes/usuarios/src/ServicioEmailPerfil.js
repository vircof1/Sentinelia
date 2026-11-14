import { ErrorAutogestionPerfil } from './ErrorAutogestionPerfil.js';
import { normalizarBuzonCorreo } from '../../correo/src/NormalizadorBuzonCorreo.js';

export class ServicioEmailPerfil {
  constructor({ repositorioUsuarios }) {
    this.repositorioUsuarios = repositorioUsuarios;
  }

  async establecerEmailNoValidado({ idUsuario, email }) {
    const emailNormalizado = this.validarEmail(email);
    const usuario = await this.repositorioUsuarios.buscarPorId(idUsuario);

    if (!usuario || !usuario.activo) {
      throw new ErrorAutogestionPerfil({
        codigo: 'sesion_no_vigente',
        mensaje: 'La cuenta ya no está disponible.',
        estadoHttp: 401
      });
    }

    if (usuario.email === emailNormalizado) {
      return this.construirResultadoSinCambios({
        email: emailNormalizado,
        emailValidado: usuario.emailValidado
      });
    }

    const persistencia =
      await this.repositorioUsuarios.actualizarEmailNoValidado({
        idUsuario: usuario.id,
        emailActual: usuario.email,
        emailNuevo: emailNormalizado
      });

    if (persistencia.estado === 'sesion_no_vigente') {
      throw new ErrorAutogestionPerfil({
        codigo: 'sesion_no_vigente',
        mensaje: 'La cuenta ya no está disponible.',
        estadoHttp: 401
      });
    }

    if (persistencia.estado === 'conflicto') {
      throw new ErrorAutogestionPerfil({
        codigo: 'operacion_email_en_conflicto',
        mensaje: 'El email cambió durante la operación.',
        estadoHttp: 409
      });
    }

    if (persistencia.estado === 'sin_cambios') {
      return this.construirResultadoSinCambios({
        email: emailNormalizado,
        emailValidado: persistencia.emailValidado
      });
    }

    return {
      codigo: 'email_actualizado_no_validado',
      mensaje: 'El email se ha actualizado y permanece sin validar.',
      datos: {
        modificado: true,
        email: emailNormalizado,
        email_validado: false
      }
    };
  }

  validarEmail(email) {
    try {
      return normalizarBuzonCorreo(email).canonico;
    } catch {
      throw this.crearErrorEmail(
        'El email debe cumplir el perfil buzon@1 y no superar 190 bytes.'
      );
    }
  }

  construirResultadoSinCambios({ email, emailValidado }) {
    return {
      codigo: 'email_sin_cambios',
      mensaje: emailValidado
        ? 'La dirección de correo indicada ya está guardada y validada.'
        : 'La dirección de correo indicada ya está guardada, pero sigue sin validar.',
      datos: {
        modificado: false,
        email,
        email_validado: Boolean(emailValidado)
      }
    };
  }

  crearErrorEmail(mensaje) {
    return new ErrorAutogestionPerfil({
      codigo: 'valor_invalido',
      mensaje: 'El email indicado no es válido.',
      estadoHttp: 400,
      datos: {
        errores: [
          {
            campo: 'email',
            codigo: 'valor_invalido',
            mensaje
          }
        ]
      }
    });
  }
}
