import { ErrorAutogestionPerfil } from '../../../../paquetes/usuarios/src/ErrorAutogestionPerfil.js';
import { ErrorContratoReinicioPasswordAdministrativo }
  from '../../../../paquetes/usuarios/src/ContratoReinicioPasswordAdministrativo.js';
import { ErrorViaReinicioPasswordAdministrativo }
  from '../../../../paquetes/usuarios/src/ServicioReinicioPasswordAdministrativo.js';

export class ControladorUsuarios {
  constructor({
    servicioUsuarios,
    servicioAutorizacionPerfil = null,
    servicioAutogestionPerfil = null,
    servicioCambioEmailPerfil = null,
    servicioSesion = null,
    servicioReinicioPasswordAdministrativo = null
  }) {
    this.servicioUsuarios = servicioUsuarios;
    this.servicioAutorizacionPerfil = servicioAutorizacionPerfil;
    this.servicioAutogestionPerfil = servicioAutogestionPerfil;
    this.servicioCambioEmailPerfil = servicioCambioEmailPerfil;
    this.servicioSesion = servicioSesion;
    this.servicioReinicioPasswordAdministrativo =
      servicioReinicioPasswordAdministrativo;
  }

  async mostrarUsuarios(requisicion, respuesta, next) {
    try {
      const vista = await this.servicioUsuarios.construirVistaListado(
        requisicion.contextoUsuarioActual,
        {
          tenantId: requisicion.query.tenant_id,
          empresaId: requisicion.query.empresa_id,
          sitioId: requisicion.query.sitio_id
        }
      );

      respuesta.render('portal/usuarios', {
        titulo: 'Usuarios',
        usuarioActual: requisicion.session?.usuarioAutenticado ?? null,
        ...vista
      });
    } catch (error) {
      next(error);
    }
  }

  async mostrarMiPerfil(requisicion, respuesta, next) {
    try {
      const vista = await this.servicioUsuarios.construirVistaPerfilActual(
        requisicion.contextoUsuarioActual
      );
      const contexto = requisicion.contextoUsuarioActual;
      const estaImpersonado = Boolean(
        contexto?.impersonacionActiva ||
        Number(contexto?.idUsuarioReal) !== Number(contexto?.idUsuario)
      );
      let autogestionPerfil = {
        disponible: false,
        motivo: 'impersonacion',
        autorizada: false,
        expiraEn: null,
        email: {
          email: vista.perfil.email,
          emailValidado: vista.perfil.emailValidado,
          correoOperativo: false,
          operacionPendiente: null
        }
      };

      if (!estaImpersonado) {
        const [autorizacion, estadoEmail] = await Promise.all([
          this.servicioAutorizacionPerfil.obtenerEstado({
            contextoUsuarioActual: contexto,
            idSesion: requisicion.sessionID
          }),
          this.servicioCambioEmailPerfil.obtenerEstadoPerfil({
            contextoUsuarioActual: contexto
          })
        ]);
        autogestionPerfil = {
          disponible: true,
          motivo: null,
          autorizada: autorizacion.autorizada,
          expiraEn: autorizacion.expiraEn,
          email: estadoEmail
        };
      }

      respuesta.render('portal/mi-perfil', {
        titulo: 'Mi perfil',
        usuarioActual: requisicion.session?.usuarioAutenticado ?? null,
        autogestionPerfil,
        ...vista
      });
    } catch (error) {
      next(error);
    }
  }

  async mostrarNuevoUsuario(requisicion, respuesta, next) {
    try {
      const vista = await this.servicioUsuarios.construirVistaFormulario(
        requisicion.contextoUsuarioActual
      );

      respuesta.render('portal/usuario-formulario', {
        titulo: 'Nuevo usuario',
        usuarioActual: requisicion.session?.usuarioAutenticado ?? null,
        ...vista
      });
    } catch (error) {
      next(error);
    }
  }

  async apiDesbloquearPerfil(requisicion, respuesta) {
    await this.ejecutarOperacionPerfilJson(
      requisicion,
      respuesta,
      ['password_actual'],
      async () => this.servicioAutorizacionPerfil.desbloquear({
        contextoUsuarioActual: requisicion.contextoUsuarioActual,
        idSesion: requisicion.sessionID,
        passwordActual: requisicion.body.password_actual
      })
    );
  }

  async apiCerrarEdicionPerfil(requisicion, respuesta) {
    await this.ejecutarOperacionPerfilJson(
      requisicion,
      respuesta,
      [],
      async () => this.servicioAutorizacionPerfil.cerrarEdicion({
        contextoUsuarioActual: requisicion.contextoUsuarioActual,
        idSesion: requisicion.sessionID
      })
    );
  }

  async apiActualizarNombreVisiblePerfil(requisicion, respuesta) {
    await this.ejecutarOperacionPerfilJson(
      requisicion,
      respuesta,
      ['nombre_visible'],
      async () => this.servicioAutogestionPerfil.actualizarNombreVisible({
        contextoUsuarioActual: requisicion.contextoUsuarioActual,
        idSesion: requisicion.sessionID,
        nombreVisible: requisicion.body.nombre_visible
      })
    );
  }

  async apiActualizarNombreCompletoPerfil(requisicion, respuesta) {
    await this.ejecutarOperacionPerfilJson(
      requisicion,
      respuesta,
      ['nombre_completo'],
      async () => this.servicioAutogestionPerfil.actualizarNombreCompleto({
        contextoUsuarioActual: requisicion.contextoUsuarioActual,
        idSesion: requisicion.sessionID,
        nombreCompleto: requisicion.body.nombre_completo
      })
    );
  }

  async apiActualizarPreferenciaAlertasRemotas(requisicion, respuesta) {
    await this.ejecutarOperacionPerfilJson(
      requisicion, respuesta, ['mostrar'],
      async () => this.servicioAutogestionPerfil.actualizarPreferenciaAlertasRemotas({
        contextoUsuarioActual: requisicion.contextoUsuarioActual,
        idSesion: requisicion.sessionID,
        mostrar: requisicion.body.mostrar
      })
    );
  }

  async apiCambiarPasswordPerfil(requisicion, respuesta) {
    await this.ejecutarOperacionPerfilJson(
      requisicion,
      respuesta,
      ['password_nuevo', 'password_confirmacion'],
      async () => this.servicioAutogestionPerfil.cambiarPassword({
        contextoUsuarioActual: requisicion.contextoUsuarioActual,
        idSesion: requisicion.sessionID,
        passwordNuevo: requisicion.body.password_nuevo,
        passwordConfirmacion: requisicion.body.password_confirmacion
      })
    );
  }

  async apiCambiarEmailPerfil(requisicion, respuesta) {
    await this.ejecutarOperacionPerfilJson(
      requisicion,
      respuesta,
      ['email'],
      async () => this.servicioCambioEmailPerfil.solicitarCambio({
        contextoUsuarioActual: requisicion.contextoUsuarioActual,
        idSesion: requisicion.sessionID,
        email: requisicion.body.email
      })
    );
  }

  async apiValidarEmailPerfil(requisicion, respuesta) {
    await this.ejecutarOperacionPerfilJson(
      requisicion,
      respuesta,
      [],
      async () => this.servicioCambioEmailPerfil.validarEmailActual({
        contextoUsuarioActual: requisicion.contextoUsuarioActual,
        idSesion: requisicion.sessionID
      })
    );
  }

  async apiReenviarValidacionEmailPerfil(requisicion, respuesta) {
    await this.ejecutarOperacionPerfilJson(
      requisicion,
      respuesta,
      [],
      async () => this.servicioCambioEmailPerfil.reenviarValidacion({
        contextoUsuarioActual: requisicion.contextoUsuarioActual,
        idSesion: requisicion.sessionID
      })
    );
  }

  async abrirConfirmacionEmail(requisicion, respuesta, _next) {
    endurecerRespuestaCapacidadEmail(respuesta);
    try {
      const enlace = await this.servicioCambioEmailPerfil.registrarEnlace(
        requisicion.params.token
      );
      await this.servicioSesion.guardarContinuacionEmailPerfil(
        requisicion,
        enlace.huellaToken
      );
      respuesta.redirect(
        requisicion.contextoUsuarioActual
          ? '/mi-perfil/email/confirmar'
          : '/login'
      );
    } catch (error) {
      this.renderizarErrorConfirmacionEmail(respuesta, error);
    }
  }

  async mostrarConfirmacionEmail(requisicion, respuesta, _next) {
    endurecerRespuestaCapacidadEmail(respuesta);
    try {
      const continuacion =
        this.servicioSesion.obtenerContinuacionEmailPerfil(requisicion);
      if (!continuacion) {
        throw new ErrorAutogestionPerfil({
          codigo: 'token_email_invalido',
          mensaje: 'No hay una verificación de correo pendiente en esta sesión.',
          estadoHttp: 400
        });
      }

      const confirmacion =
        await this.servicioCambioEmailPerfil.obtenerConfirmacion({
          huellaToken: continuacion.huellaToken,
          contextoUsuarioActual: requisicion.contextoUsuarioActual
        });
      respuesta.render('portal/email-confirmar', {
        titulo: confirmacion.esValidacionEmailActual
          ? 'Validar correo electrónico'
          : 'Confirmar cambio de correo',
        usuarioActual: requisicion.session?.usuarioAutenticado ?? null,
        confirmacion,
        errorConfirmacion: null
      });
    } catch (error) {
      this.renderizarErrorConfirmacionEmail(respuesta, error);
    }
  }

  async apiConfirmarEmailPerfil(requisicion, respuesta) {
    endurecerRespuestaCapacidadEmail(respuesta);
    await this.ejecutarOperacionPerfilJson(
      requisicion,
      respuesta,
      [],
      async () => {
        const continuacion =
          this.servicioSesion.obtenerContinuacionEmailPerfil(requisicion);
        if (!continuacion) {
          throw new ErrorAutogestionPerfil({
            codigo: 'token_email_invalido',
            mensaje: 'No hay una verificación de correo pendiente en esta sesión.',
            estadoHttp: 400
          });
        }
        const resultado = await this.servicioCambioEmailPerfil.confirmar({
          huellaToken: continuacion.huellaToken,
          contextoUsuarioActual: requisicion.contextoUsuarioActual
        });
        await this.servicioSesion.limpiarContinuacionEmailPerfil(requisicion);
        return resultado;
      }
    );
  }

  renderizarErrorConfirmacionEmail(respuesta, error) {
    const esDominio = error instanceof ErrorAutogestionPerfil;
    if (!esDominio) {
      console.error('[sentinelia-web] Error al resolver la confirmación de email');
      console.error(error);
    }
    respuesta.status(esDominio ? error.estadoHttp : 500).render(
      'portal/email-confirmar',
      {
        titulo: 'Verificar correo electrónico',
        usuarioActual: respuesta.locals.usuarioActual ?? null,
        confirmacion: null,
        errorConfirmacion: {
          codigo: esDominio
            ? error.codigo
            : 'infraestructura_no_disponible',
          mensaje: esDominio
            ? error.message
            : 'No se ha podido comprobar el enlace de verificación.'
        }
      }
    );
  }

  async mostrarEditarUsuario(requisicion, respuesta, next) {
    try {
      const idUsuario = Number.parseInt(String(requisicion.params.id || ''), 10);
      const vista = await this.servicioUsuarios.construirVistaFormulario(
        requisicion.contextoUsuarioActual,
        { idUsuario }
      );
      const reinicioPasswordAdministrativo =
        this.servicioReinicioPasswordAdministrativo
          ? await this.servicioReinicioPasswordAdministrativo
            .construirProyeccionEdicion({
              contextoUsuarioActual: requisicion.contextoUsuarioActual,
              usuarioId: idUsuario
            })
          : null;

      respuesta.render('portal/usuario-formulario', {
        titulo: 'Editar usuario',
        usuarioActual: requisicion.session?.usuarioAutenticado ?? null,
        ...vista,
        reinicioPasswordAdministrativo
      });
    } catch (error) {
      next(error);
    }
  }

  async apiListarUsuarios(requisicion, respuesta, next) {
    try {
      const vista = await this.servicioUsuarios.listarUsuariosAdministracion(
        requisicion.contextoUsuarioActual,
        {
          textoBusqueda: String(requisicion.query.q || '').trim(),
          tenantId: requisicion.query.tenant_id,
          empresaId: requisicion.query.empresa_id,
          sitioId: requisicion.query.sitio_id,
          activo: String(requisicion.query.activo || 'solo_activos'),
          pagina: requisicion.query.page,
          tamanoPagina: requisicion.query.page_size,
          ordenarPor: String(requisicion.query.sort_by || 'creado'),
          direccionOrden: String(requisicion.query.sort_dir || 'desc')
        }
      );

      respuesta.json({
        ok: true,
        ...vista
      });
    } catch (error) {
      next(error);
    }
  }

  async apiOpcionesEmpresas(requisicion, respuesta, next) {
    try {
      const opciones = await this.servicioUsuarios.obtenerOpcionesEmpresas(
        requisicion.contextoUsuarioActual,
        requisicion.query.tenant_id
      );

      respuesta.json({
        ok: true,
        opciones
      });
    } catch (error) {
      next(error);
    }
  }

  async apiOpcionesSitios(requisicion, respuesta, next) {
    try {
      const opciones = await this.servicioUsuarios.obtenerOpcionesSitios(
        requisicion.contextoUsuarioActual,
        requisicion.query.tenant_id,
        requisicion.query.empresa_id
      );

      respuesta.json({
        ok: true,
        opciones
      });
    } catch (error) {
      next(error);
    }
  }

  async apiCrearUsuario(requisicion, respuesta, _next) {
    await this.ejecutarOperacionJson(respuesta, async () => {
      const usuario = await this.servicioUsuarios.crearUsuarioAdministrativo(
        requisicion.contextoUsuarioActual,
        requisicion.body
      );

      return {
        mensaje:
          `Usuario ${usuario.usuario} creado con clave temporal y cambio obligatorio pendiente.`,
        usuarioId: usuario.id,
        redireccion: '/usuarios'
      };
    });
  }

  async apiActualizarUsuario(requisicion, respuesta, _next) {
    await this.ejecutarOperacionJson(respuesta, async () => {
      const idUsuario = Number.parseInt(String(requisicion.params.id || ''), 10);
      const resultado =
        await this.servicioUsuarios.actualizarUsuarioAdministrativo(
          requisicion.contextoUsuarioActual,
          idUsuario,
          requisicion.body
        );

      return {
        mensaje: resultado.cambioAutorizacion
          ? `Usuario ${resultado.usuario.usuario} actualizado y versión de sesión incrementada.`
          : `Usuario ${resultado.usuario.usuario} actualizado.`,
        usuarioId: resultado.usuario.id,
        redireccion: '/usuarios'
      };
    });
  }

  async apiEliminarUsuario(requisicion, respuesta, _next) {
    await this.ejecutarOperacionJson(respuesta, async () => {
      const idUsuario = Number.parseInt(String(requisicion.params.id || ''), 10);
      const resultado = await this.servicioUsuarios.eliminarUsuario(
        requisicion.contextoUsuarioActual,
        idUsuario
      );

      return {
        mensaje: resultado.limpiezaRedis?.error
          ? `Usuario ${idUsuario} eliminado en SQL, pero quedó pendiente limpiar Redis.`
          : `Usuario ${idUsuario} eliminado y estado efímero limpiado.`,
        redireccion: '/usuarios'
      };
    });
  }

  async apiReiniciarPasswordAdministrativo(requisicion, respuesta, _next) {
    endurecerRespuestaSensible(respuesta);
    let password = null;
    let passwordConfirmacion = null;
    try {
      if (!requisicion.is?.('application/json')) {
        throw new ErrorContratoReinicioPasswordAdministrativo(
          'La petición debe utilizar JSON.'
        );
      }
      const cuerpo = requisicion.body;
      if (!cuerpo || typeof cuerpo !== 'object' || Array.isArray(cuerpo)) {
        throw new ErrorContratoReinicioPasswordAdministrativo(
          'El cuerpo JSON no es válido.'
        );
      }
      const viaEsperada = cuerpo.via_esperada;
      const propiedadesEsperadas = viaEsperada === 'manual'
        ? ['reinicio_id', 'via_esperada', 'password', 'password_confirmacion']
        : ['reinicio_id', 'via_esperada'];
      validarPropiedadesExactas(cuerpo, propiedadesEsperadas);
      password = viaEsperada === 'manual' ? cuerpo.password : null;
      passwordConfirmacion = viaEsperada === 'manual'
        ? cuerpo.password_confirmacion
        : null;
      limpiarPasswordRequisicion(requisicion);

      const idUsuario = Number.parseInt(String(requisicion.params.id || ''), 10);
      const ejecucion = await this.servicioReinicioPasswordAdministrativo
        .reiniciar({
          contextoUsuarioActual: requisicion.contextoUsuarioActual,
          reinicioId: cuerpo.reinicio_id,
          usuarioId: idUsuario,
          viaEsperada,
          password,
          passwordConfirmacion
        });
      const resultado = ejecucion.resultado;
      respuesta.json({
        ok: true,
        codigo: ejecucion.resultado.replay
          ? 'reinicio_password_administrativo_repetido'
          : 'reinicio_password_administrativo_aplicado',
        mensaje: mensajeReinicioPasswordAdministrativo(resultado.operacion.via),
        datos: {
          reinicio_id: resultado.operacion.reinicioId,
          via: resultado.operacion.via,
          replay: resultado.replay,
          convergencia_completa: ejecucion.convergenciaPostcommit.completa,
          ...(resultado.salidaCorreo?.id
            ? { salida_correo_id: resultado.salidaCorreo.id }
            : {})
        }
      });
    } catch (error) {
      responderErrorReinicioPasswordAdministrativo(respuesta, error);
    } finally {
      password = null;
      passwordConfirmacion = null;
      limpiarPasswordRequisicion(requisicion);
    }
  }

  async ejecutarOperacionJson(respuesta, operacion) {
    try {
      const payload = await operacion();
      respuesta.json({
        ok: true,
        ...payload
      });
    } catch (error) {
      respuesta.status(400).json({
        ok: false,
        mensaje: error.message
      });
    }
  }

  async ejecutarOperacionPerfilJson(
    requisicion,
    respuesta,
    propiedadesEsperadas,
    operacion
  ) {
    try {
      this.validarCuerpoJsonExacto(requisicion, propiedadesEsperadas);
      const resultado = await operacion();
      respuesta.json({
        ok: true,
        codigo: resultado.codigo,
        mensaje: resultado.mensaje,
        ...(resultado.datos ? { datos: resultado.datos } : {})
      });
    } catch (error) {
      if (error instanceof ErrorAutogestionPerfil) {
        respuesta.status(error.estadoHttp).json({
          ok: false,
          codigo: error.codigo,
          mensaje: error.message,
          ...(error.datos || {})
        });
        return;
      }

      console.error('[sentinelia-web] Error de autogestión del perfil');
      console.error(error);
      respuesta.status(500).json({
        ok: false,
        codigo: 'infraestructura_no_disponible',
        mensaje: 'No se ha podido completar la operación del perfil.'
      });
    }
  }

  validarCuerpoJsonExacto(requisicion, propiedadesEsperadas) {
    if (!requisicion.is?.('application/json')) {
      throw new ErrorAutogestionPerfil({
        codigo: 'peticion_invalida',
        mensaje: 'La petición debe utilizar JSON.',
        estadoHttp: 400
      });
    }

    const cuerpo = requisicion.body;

    if (!cuerpo || typeof cuerpo !== 'object' || Array.isArray(cuerpo)) {
      throw new ErrorAutogestionPerfil({
        codigo: 'peticion_invalida',
        mensaje: 'El cuerpo JSON no es válido.',
        estadoHttp: 400
      });
    }

    const recibidas = Object.keys(cuerpo).sort();
    const esperadas = [...propiedadesEsperadas].sort();
    const coincide =
      recibidas.length === esperadas.length &&
      recibidas.every((propiedad, indice) => propiedad === esperadas[indice]);

    if (!coincide) {
      throw new ErrorAutogestionPerfil({
        codigo: 'peticion_invalida',
        mensaje: 'La petición contiene atributos ausentes o no permitidos.',
        estadoHttp: 400
      });
    }
  }
}

function endurecerRespuestaCapacidadEmail(respuesta) {
  respuesta
    .set('Cache-Control', 'private, no-store, max-age=0')
    .set('Pragma', 'no-cache')
    .set('Referrer-Policy', 'no-referrer');
}

function endurecerRespuestaSensible(respuesta) {
  respuesta
    .set('Cache-Control', 'private, no-store, max-age=0')
    .set('Pragma', 'no-cache')
    .set('Referrer-Policy', 'no-referrer');
}

function validarPropiedadesExactas(cuerpo, esperadas) {
  const recibidas = Object.keys(cuerpo).sort();
  const ordenadas = [...esperadas].sort();
  if (recibidas.length !== ordenadas.length ||
      !recibidas.every((propiedad, indice) => propiedad === ordenadas[indice])) {
    throw new ErrorContratoReinicioPasswordAdministrativo(
      'La petición contiene atributos ausentes o no permitidos.'
    );
  }
}

function mensajeReinicioPasswordAdministrativo(via) {
  return via === 'correo'
    ? 'Contraseña provisional sustituida y correo aceptado para su envío.'
    : 'Contraseña provisional sustituida; el usuario deberá cambiarla al iniciar sesión.';
}

function responderErrorReinicioPasswordAdministrativo(respuesta, error) {
  if (error instanceof ErrorViaReinicioPasswordAdministrativo) {
    respuesta.status(error.statusCode).json({
      ok: false,
      codigo: error.codigo,
      mensaje: error.message,
      ...(error.statusCode === 409 ? { recargar: true } : {})
    });
    return;
  }
  if (error instanceof ErrorContratoReinicioPasswordAdministrativo) {
    respuesta.status(400).json({
      ok: false,
      codigo: error.codigo,
      mensaje: error.message
    });
    return;
  }
  console.error('[sentinelia-web] Error de reinicio administrativo de contraseña');
  console.error(error);
  respuesta.status(500).json({
    ok: false,
    codigo: 'infraestructura_no_disponible',
    mensaje: 'No se ha podido completar el reinicio de contraseña.'
  });
}

function limpiarPasswordRequisicion(requisicion) {
  const cuerpo = requisicion?.body;
  if (!cuerpo || typeof cuerpo !== 'object') return;
  try {
    if ('password' in cuerpo) cuerpo.password = '';
    if ('password_confirmacion' in cuerpo) cuerpo.password_confirmacion = '';
  } catch {
    // Un cuerpo inmutable no debe alterar el resultado ni prolongar copias locales.
  }
}
