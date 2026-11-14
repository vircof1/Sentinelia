import { ErrorAutogestionPerfil } from './ErrorAutogestionPerfil.js';
import { generarUuidV7Auditoria } from '../../auditoria/src/UuidV7Auditoria.js';
import { PERFIL_JCS_AUDITORIA_V1 } from '../../auditoria/src/PerfilJcsAuditoria.js';
import { VERSION_ENCADENADO_AUDITORIA_V1 } from '../../auditoria/src/SobreCanonicoAuditoria.js';

const DEFINICIONES_NOMBRES = {
  nombre_visible: {
    maximo: 120,
    actualizar: 'actualizarNombreMostrarPropio',
    propiedadRepositorio: 'nombreMostrar',
    codigo: 'nombre_visible_actualizado',
    etiqueta: 'nombre visible'
  },
  nombre_completo: {
    maximo: 160,
    actualizar: 'actualizarNombreCompletoPropio',
    propiedadRepositorio: 'nombreCompleto',
    codigo: 'nombre_completo_actualizado',
    etiqueta: 'nombre completo'
  }
};

export class ServicioAutogestionPerfil {
  constructor({
    repositorioUsuarios,
    servicioAutorizacionPerfil,
    servicioAutenticacion = null,
    servicioSesion = null,
    servicioEstadoSensibleUsuario = null,
    fronteraTransaccional = null,
    servicioAuditoria = null,
    ahora = () => new Date(),
    invalidadoresOperacionesSensibles = []
  }) {
    this.repositorioUsuarios = repositorioUsuarios;
    this.servicioAutorizacionPerfil = servicioAutorizacionPerfil;
    this.servicioAutenticacion = servicioAutenticacion;
    this.servicioSesion = servicioSesion;
    this.servicioEstadoSensibleUsuario = servicioEstadoSensibleUsuario;
    this.fronteraTransaccional = fronteraTransaccional;
    this.servicioAuditoria = servicioAuditoria;
    this.ahora = ahora;
    this.invalidadoresOperacionesSensibles = invalidadoresOperacionesSensibles;
  }

  async actualizarNombreVisible({
    contextoUsuarioActual,
    idSesion,
    nombreVisible
  }) {
    return this.actualizarNombre({
      contextoUsuarioActual,
      idSesion,
      campo: 'nombre_visible',
      valor: nombreVisible
    });
  }

  async actualizarNombreCompleto({
    contextoUsuarioActual,
    idSesion,
    nombreCompleto
  }) {
    return this.actualizarNombre({
      contextoUsuarioActual,
      idSesion,
      campo: 'nombre_completo',
      valor: nombreCompleto
    });
  }

  async actualizarPreferenciaAlertasRemotas({
    contextoUsuarioActual, idSesion, mostrar
  }) {
    await this.servicioAutorizacionPerfil.exigirAutorizacion({
      contextoUsuarioActual, idSesion
    });
    if (typeof mostrar !== 'boolean') {
      throw new ErrorAutogestionPerfil({ codigo: 'preferencia_invalida',
        mensaje: 'La preferencia debe ser booleana.', estadoHttp: 400 });
    }
    const idUsuario = Number(contextoUsuarioActual.idUsuarioReal);
    const ejecutar = async (conexion = null) => {
      const usuario = conexion
        ? await this.repositorioUsuarios.buscarPorIdEnTransaccion(idUsuario, {
            conexion, forUpdate: true
          })
        : await this.repositorioUsuarios.buscarPorId(idUsuario);
      const resultado = await this.repositorioUsuarios
        .actualizarPreferenciaAlertasRemotasPropiaEnTransaccion(
          { idUsuario, mostrar }, { conexion }
        );
      if (resultado.modificado) await this.#registrarAuditoria({
        conexion, contextoUsuarioActual, tipo: 'usuario.perfil_cambiado',
        sujetoId: idUsuario, scope: scopeUsuario(usuario), payload: {
          resultado: 'actualizado',
          camposCambiados: ['preferenciaMostrarAlertasRemotas'],
          antes: {
            preferenciaMostrarAlertasRemotas: Boolean(
              usuario.preferenciaMostrarAlertasRemotas
            )
          },
          despues: { preferenciaMostrarAlertasRemotas: mostrar }
        }
      });
      return resultado;
    };
    const resultado = await this.#conAuditoria(ejecutar);
    if (!resultado.usuarioActivo) throw new ErrorAutogestionPerfil({
      codigo: 'sesion_no_vigente', mensaje: 'La cuenta ya no está disponible.', estadoHttp: 401
    });
    return { codigo: 'preferencia_alertas_remotas_actualizada',
      mensaje: mostrar
        ? 'Las alertas remotas se incluirán en tu dashboard.'
        : 'Las alertas remotas dejan de incluirse en tu dashboard.',
      datos: { modificado: resultado.modificado,
        preferencia_mostrar_alertas_remotas: mostrar } };
  }

  async cambiarPassword({
    contextoUsuarioActual,
    idSesion,
    passwordNuevo,
    passwordConfirmacion
  }) {
    await this.servicioAutorizacionPerfil.exigirAutorizacion({
      contextoUsuarioActual,
      idSesion
    });

    this.validarPasswordNueva(passwordNuevo, passwordConfirmacion);
    const idUsuario = Number(contextoUsuarioActual.idUsuarioReal);
    const comprobacionActual =
      await this.servicioAutenticacion.verificarPasswordActual({
        idUsuario,
        password: passwordNuevo
      });

    if (!comprobacionActual.usuarioVigente) {
      throw new ErrorAutogestionPerfil({
        codigo: 'sesion_no_vigente',
        mensaje: 'La cuenta ya no está disponible. Vuelve a iniciar sesión.',
        estadoHttp: 401
      });
    }

    if (comprobacionActual.passwordValida) {
      throw new ErrorAutogestionPerfil({
        codigo: 'password_reutilizada',
        mensaje: 'La contraseña nueva no puede coincidir con la actual.',
        estadoHttp: 400
      });
    }

    const hashPasswordNuevo =
      await this.servicioAutenticacion.crearHashPassword(passwordNuevo);
    const ejecutarCambioPassword = (conexion = null) => {
      if (this.#auditoriaActiva()) {
        return this.repositorioUsuarios.actualizarPasswordPropioEnTransaccion({
          idUsuario,
          hashPasswordActual: comprobacionActual.usuario.hashPassword,
          hashPasswordNuevo,
          versionSesionActual: comprobacionActual.usuario.versionSesion
        }, { conexion });
      }
      return this.repositorioUsuarios.actualizarPasswordPropio({
        idUsuario,
        hashPasswordActual: comprobacionActual.usuario.hashPassword,
        hashPasswordNuevo,
        versionSesionActual: comprobacionActual.usuario.versionSesion
      });
    };
    const ejecucionSensible = this.servicioEstadoSensibleUsuario
      ? await this.servicioEstadoSensibleUsuario.ejecutarConExclusion(
          idUsuario,
          () => this.#ejecutarPasswordAuditable({
            contextoUsuarioActual,
            idUsuario,
            ejecutarCambioPassword
          }),
          {
            debeInvalidar: (resultado) => resultado.estado === 'actualizado'
          }
        )
      : null;
    const persistencia = ejecucionSensible
      ? ejecucionSensible.resultado
      : await this.#ejecutarPasswordAuditable({
          contextoUsuarioActual,
          idUsuario,
          ejecutarCambioPassword
        });

    if (persistencia.estado === 'sesion_no_vigente') {
      throw new ErrorAutogestionPerfil({
        codigo: 'sesion_no_vigente',
        mensaje: 'La cuenta ya no está disponible. Vuelve a iniciar sesión.',
        estadoHttp: 401
      });
    }

    if (persistencia.estado !== 'actualizado') {
      throw new ErrorAutogestionPerfil({
        codigo: 'operacion_password_en_conflicto',
        mensaje: 'La contraseña cambió durante la operación. Inicia sesión de nuevo.',
        estadoHttp: 409
      });
    }

    const sesiones = await this.servicioSesion.invalidarSesionesUsuario(
      idUsuario,
      persistencia.versionSesion
    );
    let autorizaciones = ejecucionSensible?.limpieza?.autorizaciones ?? null;
    if (!this.servicioEstadoSensibleUsuario) {
      autorizaciones =
        await this.servicioAutorizacionPerfil.revocarTodasLasAutorizaciones(
          idUsuario
        );
      for (const invalidar of this.invalidadoresOperacionesSensibles) {
        await invalidar(idUsuario);
      }
    }

    if (ejecucionSensible && !ejecucionSensible.limpieza.completa) {
      throw new Error(
        'La contraseña cambió, pero no pudo limpiarse todo el estado sensible.'
      );
    }

    return {
      codigo: 'password_actualizado_sesion_cerrada',
      mensaje: 'La contraseña se ha actualizado y todas las sesiones se han cerrado.',
      datos: {
        sesion_cerrada: true,
        sesiones_invalidadas: sesiones.sesionesEliminadas,
        autorizaciones_revocadas:
          autorizaciones?.autorizacionesRevocadas || 0
      }
    };
  }

  async actualizarNombre({
    contextoUsuarioActual,
    idSesion,
    campo,
    valor
  }) {
    await this.servicioAutorizacionPerfil.exigirAutorizacion({
      contextoUsuarioActual,
      idSesion
    });

    const definicion = DEFINICIONES_NOMBRES[campo];
    const nombre = this.validarNombre(valor, campo, definicion);
    const resultado = await this.#ejecutarNombreAuditable({
      contextoUsuarioActual,
      definicion,
      nombre
    });

    if (!resultado.usuarioActivo) {
      throw new ErrorAutogestionPerfil({
        codigo: 'sesion_no_vigente',
        mensaje: 'La cuenta ya no está disponible. Vuelve a iniciar sesión.',
        estadoHttp: 401
      });
    }

    return {
      codigo: definicion.codigo,
      mensaje: resultado.modificado
        ? `El ${definicion.etiqueta} se ha actualizado.`
        : `El ${definicion.etiqueta} ya tenía ese valor.`,
      datos: {
        modificado: resultado.modificado,
        [campo]: nombre
      }
    };
  }

  async #ejecutarNombreAuditable({ contextoUsuarioActual, definicion, nombre }) {
    if (!this.#auditoriaActiva()) {
      return this.repositorioUsuarios[definicion.actualizar]({
        idUsuario: Number(contextoUsuarioActual.idUsuarioReal),
        [definicion.propiedadRepositorio]: nombre
      });
    }
    const idUsuario = Number(contextoUsuarioActual.idUsuarioReal);
    const columna = definicion.actualizar === 'actualizarNombreMostrarPropio'
      ? 'nombre_mostrar'
      : 'nombre_completo';
    const ejecutar = async (conexion = null) => {
      const usuario = conexion && this.repositorioUsuarios.buscarPorIdEnTransaccion
        ? await this.repositorioUsuarios.buscarPorIdEnTransaccion(idUsuario, {
            conexion,
            forUpdate: true
          })
        : await this.repositorioUsuarios.buscarPorId(idUsuario);
      const resultado =
        await this.repositorioUsuarios.actualizarNombrePropioEnTransaccion(
          { idUsuario, columna, valor: nombre },
          { conexion }
        );
      if (resultado.modificado) {
        await this.#registrarAuditoria({
          conexion,
          contextoUsuarioActual,
          tipo: 'usuario.perfil_cambiado',
          sujetoId: idUsuario,
          scope: scopeUsuario(usuario),
          payload: {
            resultado: 'actualizado',
            camposCambiados: [definicion.propiedadRepositorio],
            antes: {},
            despues: {}
          }
        });
      }
      return resultado;
    };
    return this.#conAuditoria(ejecutar);
  }

  async #ejecutarPasswordAuditable({
    contextoUsuarioActual,
    idUsuario,
    ejecutarCambioPassword
  }) {
    if (!this.#auditoriaActiva()) {
      return ejecutarCambioPassword(null);
    }
    const ejecutar = async (conexion = null) => {
      const usuario = conexion && this.repositorioUsuarios.buscarPorIdEnTransaccion
        ? await this.repositorioUsuarios.buscarPorIdEnTransaccion(idUsuario, {
            conexion,
            forUpdate: true
          })
        : await this.repositorioUsuarios.buscarPorId(idUsuario);
      const resultado = await ejecutarCambioPassword(conexion);
      if (resultado.estado === 'actualizado') {
        await this.#registrarAuditoria({
          conexion,
          contextoUsuarioActual,
          tipo: 'usuario.password_cambiado',
          sujetoId: idUsuario,
          scope: scopeUsuario(usuario),
          payload: {
            operacion: 'cambio',
            resultado: 'actualizada',
            causa: 'voluntario'
          }
        });
      }
      return resultado;
    };
    return this.#conAuditoria(ejecutar);
  }

  async #conAuditoria(ejecutar) {
    if (this.#auditoriaActiva()) {
      return this.fronteraTransaccional.ejecutar(ejecutar);
    }
    return ejecutar(null);
  }

  #auditoriaActiva() {
    return Boolean(
      this.fronteraTransaccional?.ejecutar &&
      this.servicioAuditoria?.registrarEnTransaccion
    );
  }

  async #registrarAuditoria({
    conexion,
    contextoUsuarioActual,
    tipo,
    sujetoId,
    scope,
    payload
  }) {
    if (!this.servicioAuditoria?.registrarEnTransaccion || !conexion) {
      return null;
    }
    return this.servicioAuditoria.registrarEnTransaccion({
      cambioEfectivo: true,
      intencion: crearIntencionUsuario({
        tipo,
        contextoUsuarioActual,
        sujetoId,
        scope,
        payload,
        fecha: this.ahora()
      })
    }, { conexion });
  }

  validarNombre(valor, campo, definicion) {
    if (typeof valor !== 'string') {
      throw this.crearErrorValor({
        campo,
        mensaje: 'El valor debe ser una cadena de texto.'
      });
    }

    const nombre = valor.trim();
    const longitud = [...nombre].length;

    if (longitud === 0) {
      throw this.crearErrorValor({
        campo,
        mensaje: 'El valor no puede estar vacío.'
      });
    }

    if (longitud > definicion.maximo) {
      throw this.crearErrorValor({
        campo,
        mensaje: `El valor no puede superar ${definicion.maximo} caracteres.`
      });
    }

    return nombre;
  }

  validarPasswordNueva(passwordNuevo, passwordConfirmacion) {
    if (
      typeof passwordNuevo !== 'string' ||
      typeof passwordConfirmacion !== 'string'
    ) {
      throw this.crearErrorPassword(
        'La contraseña nueva y su confirmación deben ser cadenas de texto.'
      );
    }

    const longitudMinima =
      this.servicioAutenticacion.obtenerLongitudMinimaPassword();

    if ([...passwordNuevo].length < longitudMinima) {
      throw this.crearErrorPassword(
        `La contraseña debe tener al menos ${longitudMinima} caracteres.`
      );
    }

    if (Buffer.byteLength(passwordNuevo, 'utf8') > 72) {
      throw this.crearErrorPassword(
        'La contraseña no puede superar 72 bytes codificados en UTF-8.'
      );
    }

    if (passwordNuevo !== passwordConfirmacion) {
      throw this.crearErrorPassword(
        'La confirmación no coincide con la contraseña nueva.',
        'password_confirmacion'
      );
    }
  }

  crearErrorValor({ campo, mensaje }) {
    return new ErrorAutogestionPerfil({
      codigo: 'valor_invalido',
      mensaje: 'El nombre indicado no es válido.',
      estadoHttp: 400,
      datos: {
        errores: [
          {
            campo,
            codigo: 'valor_invalido',
            mensaje
          }
        ]
      }
    });
  }

  crearErrorPassword(mensaje, campo = 'password_nuevo') {
    return new ErrorAutogestionPerfil({
      codigo: 'valor_invalido',
      mensaje: 'La contraseña nueva no cumple los requisitos.',
      estadoHttp: 400,
      datos: {
        errores: [
          {
            campo,
            codigo: 'valor_invalido',
            mensaje
          }
        ]
      }
    });
  }
}

function crearIntencionUsuario({
  tipo,
  contextoUsuarioActual,
  sujetoId,
  scope,
  payload,
  fecha
}) {
  const actorRealId = idDecimal(contextoUsuarioActual?.idUsuarioReal, 'actor real');
  const actorEfectivoId = idDecimal(contextoUsuarioActual?.idUsuario, 'actor efectivo');
  const impersonado = actorRealId !== actorEfectivoId;
  const efectivoEnUtc = normalizarFecha(fecha);
  const correlacionId = generarUuidV7Auditoria();
  return {
    eventoId: generarUuidV7Auditoria(),
    tipo,
    versionContrato: 1,
    flujo: 'usuarios',
    claveCadena: claveCadenaUsuarios(scope),
    actorReal: { tipo: 'usuario', id: actorRealId },
    actorEfectivo: impersonado ? { tipo: 'usuario', id: actorEfectivoId } : null,
    modoActuacion: impersonado ? 'impersonado' : 'directo',
    sujeto: { tipo: 'usuario', id: idDecimal(sujetoId, 'sujeto') },
    origen: 'web',
    scope,
    correlacionId,
    causalidad: null,
    productor: 'portal_web',
    claveOperacion: generarUuidV7Auditoria(),
    rolEvento: 'principal',
    efectivoEnUtc,
    versionCanonicalizador: PERFIL_JCS_AUDITORIA_V1,
    versionEncadenado: VERSION_ENCADENADO_AUDITORIA_V1,
    payload
  };
}

function scopeUsuario(usuario) {
  return Object.freeze({
    tenantId: usuario?.tenantId == null ? null : String(usuario.tenantId),
    empresaId: usuario?.empresaId == null ? null : String(usuario.empresaId),
    sitioId: usuario?.sitioId == null ? null : String(usuario.sitioId)
  });
}

function claveCadenaUsuarios(scope) {
  return scope?.tenantId ? `usuarios:tenant:${scope.tenantId}` : 'usuarios:portal';
}

function idDecimal(valor, nombre) {
  const texto = String(valor ?? '');
  if (!/^[1-9][0-9]*$/.test(texto)) {
    throw new Error(`${nombre} debe ser un id decimal positivo.`);
  }
  return texto;
}

function normalizarFecha(valor) {
  const fecha = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(fecha.getTime())) {
    throw new Error('El instante auditable de usuario no es válido.');
  }
  return fecha.toISOString();
}
