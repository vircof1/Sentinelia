import bcrypt from 'bcrypt';

export class ErrorValidacionPassword extends Error {
  constructor(mensaje) {
    super(mensaje);
    this.name = 'ErrorValidacionPassword';
    this.codigo = 'PASSWORD_INVALIDA';
  }
}

export class ErrorPreautenticacionCambioPasswordNoVigente extends Error {
  constructor() {
    super('La autorización temporal para cambiar la contraseña ya no es válida.');
    this.name = 'ErrorPreautenticacionCambioPasswordNoVigente';
    this.codigo = 'PREAUTENTICACION_CAMBIO_PASSWORD_NO_VIGENTE';
  }
}

export class ServicioAutenticacion {
  constructor({ repositorioUsuarios, servicioConfiguracionPortal = null }) {
    this.repositorioUsuarios = repositorioUsuarios;
    this.servicioConfiguracionPortal = servicioConfiguracionPortal;
  }

  async autenticarPorCredenciales({ usuario, password }) {
    const usuarioPersistido =
      await this.repositorioUsuarios.buscarPorUsuario(usuario);

    if (!usuarioPersistido) {
      return {
        exito: false,
        codigo: 'credenciales_invalidas',
        mensaje: 'Usuario o contraseña incorrectos.'
      };
    }

    if (!usuarioPersistido.activo) {
      return {
        exito: false,
        codigo: 'usuario_inactivo',
        mensaje: 'La cuenta está inactiva.'
      };
    }

    const passwordValida = await bcrypt.compare(
      password,
      usuarioPersistido.hashPassword
    );

    if (!passwordValida) {
      return {
        exito: false,
        codigo: 'credenciales_invalidas',
        mensaje: 'Usuario o contraseña incorrectos.'
      };
    }

    if (usuarioPersistido.requiereCambioPassword) {
      return {
        exito: false,
        codigo: 'cambio_password_requerido',
        mensaje:
          'La cuenta requiere cambio de contraseña antes de poder acceder.',
        usuario: usuarioPersistido
      };
    }

    return {
      exito: true,
      usuario: usuarioPersistido
    };
  }

  async crearHashPassword(password) {
    return bcrypt.hash(password, 12);
  }

  async verificarPasswordActual({ idUsuario, password }) {
    const usuario = await this.repositorioUsuarios.buscarPorId(idUsuario);

    if (!usuario || !usuario.activo) {
      return {
        usuarioVigente: false,
        passwordValida: false
      };
    }

    return {
      usuarioVigente: true,
      usuario,
      passwordValida: await bcrypt.compare(
        String(password || ''),
        usuario.hashPassword
      )
    };
  }

  async registrarAccesoExitoso(idUsuario) {
    await this.repositorioUsuarios.registrarAccesoExitoso(idUsuario);
  }

  async completarCambioPasswordObligatorio({
    idUsuario,
    versionSesionObservada,
    passwordNuevo,
    passwordConfirmacion
  }) {
    const usuario = await this.repositorioUsuarios.buscarPorId(idUsuario);

    if (!usuario) {
      throw new Error('La cuenta ya no existe.');
    }

    if (!usuario.activo) {
      throw new Error('La cuenta está inactiva.');
    }

    if (!usuario.requiereCambioPassword) {
      throw new Error('La cuenta ya no requiere cambio obligatorio.');
    }

    this.validarPasswordNueva(passwordNuevo, passwordConfirmacion);

    const repiteActual = await bcrypt.compare(
      passwordNuevo,
      usuario.hashPassword
    );

    if (repiteActual) {
      throw new ErrorValidacionPassword(
        'La nueva contraseña no puede coincidir con la temporal o reiniciada.'
      );
    }

    const hashPasswordNuevo = await this.crearHashPassword(passwordNuevo);
    const actualizado =
      await this.repositorioUsuarios.actualizarPasswordObligatoria({
        idUsuario: usuario.id,
        hashPasswordNuevo,
        versionSesionObservada
      });

    if (!actualizado) {
      throw new ErrorPreautenticacionCambioPasswordNoVigente();
    }

    await this.registrarAccesoExitoso(actualizado.id);

    return actualizado;
  }

  validarPasswordNueva(passwordNuevo, passwordConfirmacion) {
    const clave = String(passwordNuevo || '');
    const confirmacion = String(passwordConfirmacion || '');
    const longitudMinima = this.obtenerLongitudMinimaPassword();

    if (Array.from(clave).length < longitudMinima) {
      throw new ErrorValidacionPassword(
        `La nueva contraseña debe tener al menos ${longitudMinima} caracteres.`
      );
    }

    if (Buffer.byteLength(clave, 'utf8') > 72) {
      throw new Error(
        'La nueva contraseña no puede superar 72 bytes codificados en UTF-8.'
      );
    }

    if (clave !== confirmacion) {
      throw new ErrorValidacionPassword(
        'La confirmación de contraseña no coincide.'
      );
    }
  }

  obtenerLongitudMinimaPassword() {
    if (!this.servicioConfiguracionPortal) {
      return 8;
    }

    const configuracion = this.servicioConfiguracionPortal
      .obtenerConfiguracionActual()
      .obtenerConfiguracionUsuarios();
    const longitudMinima = Number(configuracion.passwordLongitudMinima);

    if (
      !Number.isInteger(longitudMinima) ||
      longitudMinima < 1 ||
      longitudMinima > 72
    ) {
      throw new Error(
        'La configuración usuarios.password_longitud_minima debe estar entre 1 y 72.'
      );
    }

    return longitudMinima;
  }
}
