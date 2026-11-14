import { createHash } from 'node:crypto';

import { generarUuidV7Auditoria }
  from '../../auditoria/src/UuidV7Auditoria.js';
import { crearMensajeReinicioPasswordAdministrativo }
  from '../../correo/src/CodecMensajeReinicioPasswordAdministrativo.js';
import { normalizarBuzonCorreo }
  from '../../correo/src/NormalizadorBuzonCorreo.js';
import {
  PERFILES_REINICIO_PASSWORD_ADMINISTRATIVO,
  VERSION_CONTRATO_REINICIO_PASSWORD_ADMINISTRATIVO,
  VIAS_REINICIO_PASSWORD_ADMINISTRATIVO,
  crearComandoReinicioPasswordAdministrativo,
  decidirViaReinicioPasswordAdministrativo,
  exigirObjetivoAjenoReinicioPasswordAdministrativo,
  exigirReplayCompatibleReinicioPasswordAdministrativo
} from './ContratoReinicioPasswordAdministrativo.js';
import { construirIntencionAuditoriaReinicioPasswordAdministrativo }
  from './EventosAuditoriaReinicioPasswordAdministrativo.js';
import { GeneradorPasswordProvisional }
  from './GeneradorPasswordProvisional.js';

export class ErrorViaReinicioPasswordAdministrativo extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.name = 'ErrorViaReinicioPasswordAdministrativo';
    this.codigo = codigo;
    this.statusCode = codigo === 'VIA_REINICIO_PASSWORD_CAMBIADA' ? 409 : 503;
  }
}

export class ServicioReinicioPasswordAdministrativo {
  constructor({
    repositorioUsuarios,
    repositorioOperaciones,
    repositorioCoordinacionCorreo = null,
    repositorioSesionesWeb,
    servicioSesion,
    evaluadorAutoridadCorreoSql,
    servicioAutenticacion,
    servicioEstadoSensibleUsuario,
    servicioAuditoria,
    fronteraTransaccional,
    ahora = () => new Date(),
    generarEventoId = generarUuidV7Auditoria,
    generadorPasswordProvisional = new GeneradorPasswordProvisional()
  } = {}) {
    exigirMetodo(repositorioUsuarios,
      'buscarPorIdParaAdministracionEnTransaccion', 'repositorioUsuarios');
    exigirMetodo(repositorioUsuarios,
      'buscarPorIdParaAdministracion', 'repositorioUsuarios');
    exigirMetodo(repositorioUsuarios,
      'reiniciarPasswordAdministrativaEnTransaccion', 'repositorioUsuarios');
    exigirMetodo(repositorioOperaciones, 'reservarEnTransaccion',
      'repositorioOperaciones');
    exigirMetodo(repositorioOperaciones, 'confirmarEnTransaccion',
      'repositorioOperaciones');
    exigirMetodo(repositorioOperaciones, 'buscarPorId',
      'repositorioOperaciones');
    exigirMetodo(repositorioOperaciones, 'buscarPorIdEnTransaccion',
      'repositorioOperaciones');
    exigirMetodo(repositorioSesionesWeb,
      'invalidarVigentesPorUsuariosEnTransaccion', 'repositorioSesionesWeb');
    exigirMetodo(servicioSesion, 'invalidarSesionesUsuario', 'servicioSesion');
    exigirMetodo(evaluadorAutoridadCorreoSql, 'evaluarEnTransaccion',
      'evaluadorAutoridadCorreoSql');
    exigirMetodo(servicioAutenticacion, 'validarPasswordNueva',
      'servicioAutenticacion');
    exigirMetodo(servicioAutenticacion, 'crearHashPassword',
      'servicioAutenticacion');
    exigirMetodo(servicioAutenticacion, 'obtenerLongitudMinimaPassword',
      'servicioAutenticacion');
    exigirMetodo(servicioEstadoSensibleUsuario, 'ejecutarConExclusion',
      'servicioEstadoSensibleUsuario');
    exigirMetodo(servicioAuditoria, 'registrarEnTransaccion',
      'servicioAuditoria');
    exigirMetodo(fronteraTransaccional, 'ejecutar', 'fronteraTransaccional');
    if (typeof ahora !== 'function' || typeof generarEventoId !== 'function' ||
        typeof generadorPasswordProvisional?.generar !== 'function') {
      throw new Error('El reinicio administrativo requiere tiempo e identidad.');
    }
    this.usuarios = repositorioUsuarios;
    this.operaciones = repositorioOperaciones;
    this.coordinacionCorreo = repositorioCoordinacionCorreo;
    this.sesiones = repositorioSesionesWeb;
    this.servicioSesion = servicioSesion;
    this.evaluadorCorreo = evaluadorAutoridadCorreoSql;
    this.autenticacion = servicioAutenticacion;
    this.estadoSensible = servicioEstadoSensibleUsuario;
    this.auditoria = servicioAuditoria;
    this.frontera = fronteraTransaccional;
    this.ahora = ahora;
    this.generarEventoId = generarEventoId;
    this.generadorPasswordProvisional = generadorPasswordProvisional;
  }

  async reiniciarManual({
    contextoUsuarioActual,
    reinicioId,
    usuarioId,
    viaEsperada,
    password,
    passwordConfirmacion
  } = {}) {
    const comando = crearComandoReinicioPasswordAdministrativo({
      perfil: PERFILES_REINICIO_PASSWORD_ADMINISTRATIVO.COMANDO,
      version: VERSION_CONTRATO_REINICIO_PASSWORD_ADMINISTRATIVO,
      reinicioId,
      usuarioId,
      viaEsperada,
      password,
      passwordConfirmacion
    });
    if (comando.viaEsperada !== VIAS_REINICIO_PASSWORD_ADMINISTRATIVO.MANUAL) {
      throw new ErrorViaReinicioPasswordAdministrativo(
        'VIA_REINICIO_PASSWORD_NO_IMPLEMENTADA',
        'Esta unidad solo admite la vía manual.'
      );
    }
    exigirContexto(contextoUsuarioActual);
    exigirObjetivoAjenoReinicioPasswordAdministrativo({
      usuarioIdObjetivo: comando.usuarioId,
      idUsuarioEfectivo: contextoUsuarioActual.idUsuario,
      idUsuarioReal: contextoUsuarioActual.impersonacionActiva
        ? contextoUsuarioActual.idUsuarioReal
        : null
    });
    const replay = await this.#resolverReplayPrevio({
      comando, contextoUsuarioActual
    });
    if (replay) return replay;
    this.autenticacion.validarPasswordNueva(
      comando.password, comando.passwordConfirmacion
    );
    const hashPasswordNuevo = await this.autenticacion
      .crearHashPassword(comando.password);
    const eventoId = this.generarEventoId();
    const efectivoEnUtc = fechaUtc(this.ahora());

    return this.#ejecutarSensible(
      comando.usuarioId,
      () => this.frontera.ejecutar((conexion) => this.#aplicarManual({
        comando,
        contextoUsuarioActual,
        hashPasswordNuevo,
        eventoId,
        efectivoEnUtc,
        conexion
      }))
    );
  }

  async reiniciar({
    contextoUsuarioActual,
    reinicioId,
    usuarioId,
    viaEsperada,
    password = null,
    passwordConfirmacion = null
  } = {}) {
    if (viaEsperada === VIAS_REINICIO_PASSWORD_ADMINISTRATIVO.CORREO) {
      return this.reiniciarCorreo({
        contextoUsuarioActual,
        reinicioId,
        usuarioId,
        viaEsperada
      });
    }
    return this.reiniciarManual({
      contextoUsuarioActual,
      reinicioId,
      usuarioId,
      viaEsperada,
      password,
      passwordConfirmacion
    });
  }

  async construirProyeccionEdicion({
    contextoUsuarioActual,
    usuarioId
  } = {}) {
    exigirContexto(contextoUsuarioActual);
    exigirMetodo(this.operaciones, 'buscarUltimoProyectadoPorUsuario',
      'repositorioOperaciones');
    const objetivo = await this.usuarios.buscarPorIdParaAdministracion(
      contextoUsuarioActual, usuarioId
    );
    if (!objetivo) {
      throw new Error('No existe el usuario solicitado en tu alcance visible.');
    }
    const esObjetivoPropio = [
      contextoUsuarioActual.idUsuario,
      contextoUsuarioActual.impersonacionActiva
        ? contextoUsuarioActual.idUsuarioReal
        : null
    ].filter(Boolean).some((id) => String(id) === String(objetivo.id));
    const canal = await this.#proyectarCanalActual();
    const ultimo = await this.operaciones
      .buscarUltimoProyectadoPorUsuario(String(objetivo.id));
    return Object.freeze({
      canal,
      admiteAccion: objetivo.activo && !esObjetivoPropio &&
        canal.via !== 'no_evaluable',
      objetivo: Object.freeze({
        activo: objetivo.activo,
        emailValidado: objetivo.emailValidado
      }),
      advertencias: Object.freeze(objetivo.emailValidado
        ? []
        : ['email_no_validado']),
      ultimoResultado: proyectarUltimoResultado(ultimo)
    });
  }

  async reiniciarCorreo({
    contextoUsuarioActual,
    reinicioId,
    usuarioId,
    viaEsperada
  } = {}) {
    exigirMetodo(this.coordinacionCorreo, 'crearSalidaEnTransaccion',
      'repositorioCoordinacionCorreo');
    const comando = crearComandoReinicioPasswordAdministrativo({
      perfil: PERFILES_REINICIO_PASSWORD_ADMINISTRATIVO.COMANDO,
      version: VERSION_CONTRATO_REINICIO_PASSWORD_ADMINISTRATIVO,
      reinicioId,
      usuarioId,
      viaEsperada,
      password: null,
      passwordConfirmacion: null
    });
    if (comando.viaEsperada !== VIAS_REINICIO_PASSWORD_ADMINISTRATIVO.CORREO) {
      throw new ErrorViaReinicioPasswordAdministrativo(
        'VIA_REINICIO_PASSWORD_NO_IMPLEMENTADA',
        'Esta unidad solo admite la vía de correo.'
      );
    }
    exigirContexto(contextoUsuarioActual);
    exigirObjetivoAjenoReinicioPasswordAdministrativo({
      usuarioIdObjetivo: comando.usuarioId,
      idUsuarioEfectivo: contextoUsuarioActual.idUsuario,
      idUsuarioReal: contextoUsuarioActual.impersonacionActiva
        ? contextoUsuarioActual.idUsuarioReal
        : null
    });
    const replay = await this.#resolverReplayPrevio({
      comando, contextoUsuarioActual
    });
    if (replay) return replay;
    const passwordProvisional = this.generadorPasswordProvisional.generar({
      longitudMinima: this.autenticacion.obtenerLongitudMinimaPassword()
    });
    this.autenticacion.validarPasswordNueva(
      passwordProvisional, passwordProvisional
    );
    const hashPasswordNuevo = await this.autenticacion
      .crearHashPassword(passwordProvisional);
    const eventoId = this.generarEventoId();
    const efectivoEnUtc = fechaUtc(this.ahora());

    return this.#ejecutarSensible(
      comando.usuarioId,
      () => this.frontera.ejecutar((conexion) => this.#aplicarCorreo({
        comando,
        contextoUsuarioActual,
        passwordProvisional,
        hashPasswordNuevo,
        eventoId,
        efectivoEnUtc,
        conexion
      }))
    );
  }

  async #aplicarManual({
    comando,
    contextoUsuarioActual,
    hashPasswordNuevo,
    eventoId,
    efectivoEnUtc,
    conexion
  }) {
    const reserva = await this.operaciones.reservarEnTransaccion({
      reinicioId: comando.reinicioId,
      usuarioId: comando.usuarioId,
      via: comando.viaEsperada
    }, { conexion });
    if (!reserva.creada) {
      return this.#resolverReplayEnTransaccion({
        comando, contextoUsuarioActual, operacion: reserva.operacion, conexion
      });
    }

    let autoridadCorreo;
    try {
      autoridadCorreo = await this.evaluadorCorreo.evaluarEnTransaccion({ conexion });
    } catch {
      throw new ErrorViaReinicioPasswordAdministrativo(
        'AUTORIDAD_CORREO_NO_EVALUABLE',
        'No se pudo evaluar la vía autoritativa de reinicio.'
      );
    }
    const decision = decidirViaReinicioPasswordAdministrativo({
      evaluable: true,
      puedeDespachar: autoridadCorreo.puedeDespachar === true,
      viaEsperada: comando.viaEsperada
    });
    if (decision.resultado !== 'aplicable') {
      throw new ErrorViaReinicioPasswordAdministrativo(
        'VIA_REINICIO_PASSWORD_CAMBIADA',
        'La vía autoritativa cambió; recarga la operación antes de continuar.'
      );
    }

    const objetivo = await this.usuarios
      .buscarPorIdParaAdministracionEnTransaccion(
        contextoUsuarioActual,
        comando.usuarioId,
        { conexion, forUpdate: true }
      );
    if (!objetivo || !objetivo.activo) {
      throw new Error('El usuario objetivo no está activo dentro del alcance vigente.');
    }
    exigirObjetivoAjenoReinicioPasswordAdministrativo({
      usuarioIdObjetivo: String(objetivo.id),
      idUsuarioEfectivo: contextoUsuarioActual.idUsuario,
      idUsuarioReal: contextoUsuarioActual.impersonacionActiva
        ? contextoUsuarioActual.idUsuarioReal
        : null
    });
    const actualizado = await this.usuarios
      .reiniciarPasswordAdministrativaEnTransaccion({
        idUsuario: comando.usuarioId,
        hashPasswordNuevo
      }, { conexion });
    if (!actualizado) {
      throw new Error('El usuario perdió autoridad antes de sustituir la contraseña.');
    }

    const intencion = construirIntencionAuditoriaReinicioPasswordAdministrativo({
      contextoUsuarioActual,
      efectivoEnUtc,
      eventoId,
      reinicioId: comando.reinicioId,
      scope: scopeUsuario(actualizado),
      usuarioId: comando.usuarioId,
      via: comando.viaEsperada
    });
    const auditoria = await this.auditoria.registrarEnTransaccion({
      cambioEfectivo: true,
      intencion
    }, { conexion });
    const sesionesInvalidadas = await this.sesiones
      .invalidarVigentesPorUsuariosEnTransaccion(
        [comando.usuarioId], { conexion }
      );
    const confirmacion = await this.operaciones.confirmarEnTransaccion({
      reinicioId: comando.reinicioId,
      eventoAuditoriaId: eventoId,
      salidaCorreoId: null,
      versionSesionResultante: String(actualizado.versionSesion),
      generacionRecuperacionResultante:
        String(actualizado.generacionRecuperacion)
    }, { conexion });
    return Object.freeze({
      operacion: confirmacion.operacion,
      usuario: Object.freeze({
        id: String(actualizado.id),
        activo: actualizado.activo,
        requiereCambioPassword: actualizado.requiereCambioPassword,
        versionSesion: String(actualizado.versionSesion),
        generacionRecuperacion: String(actualizado.generacionRecuperacion)
      }),
      auditoria,
      sesionesInvalidadas: Object.freeze([...sesionesInvalidadas]),
      replay: false
    });
  }

  async #aplicarCorreo({
    comando,
    contextoUsuarioActual,
    passwordProvisional,
    hashPasswordNuevo,
    eventoId,
    efectivoEnUtc,
    conexion
  }) {
    const reserva = await this.operaciones.reservarEnTransaccion({
      reinicioId: comando.reinicioId,
      usuarioId: comando.usuarioId,
      via: comando.viaEsperada
    }, { conexion });
    if (!reserva.creada) {
      return this.#resolverReplayEnTransaccion({
        comando, contextoUsuarioActual, operacion: reserva.operacion, conexion
      });
    }

    const autoridadCorreo = await evaluarAutoridadCorreo(
      this.evaluadorCorreo, conexion
    );
    exigirViaAplicable(autoridadCorreo, comando.viaEsperada);

    const objetivo = await this.usuarios
      .buscarPorIdParaAdministracionEnTransaccion(
        contextoUsuarioActual,
        comando.usuarioId,
        { conexion, forUpdate: true }
      );
    if (!objetivo || !objetivo.activo) {
      throw new Error('El usuario objetivo no está activo dentro del alcance vigente.');
    }
    exigirObjetivoAjenoReinicioPasswordAdministrativo({
      usuarioIdObjetivo: String(objetivo.id),
      idUsuarioEfectivo: contextoUsuarioActual.idUsuario,
      idUsuarioReal: contextoUsuarioActual.impersonacionActiva
        ? contextoUsuarioActual.idUsuarioReal
        : null
    });
    const buzonCanonico = normalizarBuzonCorreo(objetivo.email).canonico;
    const actualizado = await this.usuarios
      .reiniciarPasswordAdministrativaEnTransaccion({
        idUsuario: comando.usuarioId,
        hashPasswordNuevo
      }, { conexion });
    if (!actualizado) {
      throw new Error('El usuario perdió autoridad antes de sustituir la contraseña.');
    }

    const mensaje = crearMensajeReinicioPasswordAdministrativo({
      nombrePortal: autoridadCorreo.lectura.valores.get('portal.nombre_visible'),
      passwordProvisional,
      aplicadoEnUtc: efectivoEnUtc
    });
    const salidaCorreo = await this.coordinacionCorreo.crearSalidaEnTransaccion({
      reinicioId: comando.reinicioId,
      buzonCanonico,
      destinatarioNombre: objetivo.obtenerNombreVisible(),
      claveBuzonSha256: sha256(buzonCanonico),
      asunto: mensaje.asunto,
      cuerpoTexto: mensaje.cuerpoTexto,
      smtpMessageId: `<${comando.reinicioId}@correo.sentinelia>`,
      creadoPorUsuarioId: String(contextoUsuarioActual.idUsuario),
      creadaEnUtc: efectivoEnUtc
    }, { conexion });
    const intencion = construirIntencionAuditoriaReinicioPasswordAdministrativo({
      contextoUsuarioActual,
      efectivoEnUtc,
      eventoId,
      reinicioId: comando.reinicioId,
      scope: scopeUsuario(actualizado),
      usuarioId: comando.usuarioId,
      via: comando.viaEsperada
    });
    const auditoria = await this.auditoria.registrarEnTransaccion({
      cambioEfectivo: true,
      intencion
    }, { conexion });
    const sesionesInvalidadas = await this.sesiones
      .invalidarVigentesPorUsuariosEnTransaccion(
        [comando.usuarioId], { conexion }
      );
    const confirmacion = await this.operaciones.confirmarEnTransaccion({
      reinicioId: comando.reinicioId,
      eventoAuditoriaId: eventoId,
      salidaCorreoId: String(salidaCorreo.salida.id),
      versionSesionResultante: String(actualizado.versionSesion),
      generacionRecuperacionResultante:
        String(actualizado.generacionRecuperacion)
    }, { conexion });
    return Object.freeze({
      operacion: confirmacion.operacion,
      usuario: Object.freeze({
        id: String(actualizado.id),
        activo: actualizado.activo,
        requiereCambioPassword: actualizado.requiereCambioPassword,
        versionSesion: String(actualizado.versionSesion),
        generacionRecuperacion: String(actualizado.generacionRecuperacion)
      }),
      salidaCorreo: Object.freeze({
        id: String(salidaCorreo.salida.id),
        estado: salidaCorreo.salida.estado
      }),
      auditoria,
      sesionesInvalidadas: Object.freeze([...sesionesInvalidadas]),
      replay: false
    });
  }

  async #resolverReplayPrevio({ comando, contextoUsuarioActual }) {
    const existente = await this.operaciones.buscarPorId(comando.reinicioId);
    if (!existente) return null;
    exigirReplayConfirmado(comando, existente);
    return this.#ejecutarSensible(
      comando.usuarioId,
      () => this.frontera.ejecutar((conexion) =>
        this.operaciones.buscarPorIdEnTransaccion(
          comando.reinicioId, { conexion, forUpdate: true }
        ).then((operacion) => this.#resolverReplayEnTransaccion({
          comando, contextoUsuarioActual, operacion, conexion
        })))
    );
  }

  async #resolverReplayEnTransaccion({
    comando, contextoUsuarioActual, operacion, conexion
  }) {
    exigirReplayConfirmado(comando, operacion);
    const objetivo = await this.usuarios
      .buscarPorIdParaAdministracionEnTransaccion(
        contextoUsuarioActual,
        comando.usuarioId,
        { conexion }
      );
    if (!objetivo) {
      throw new Error('No existe el usuario solicitado en tu alcance visible.');
    }
    exigirObjetivoAjenoReinicioPasswordAdministrativo({
      usuarioIdObjetivo: String(objetivo.id),
      idUsuarioEfectivo: contextoUsuarioActual.idUsuario,
      idUsuarioReal: contextoUsuarioActual.impersonacionActiva
        ? contextoUsuarioActual.idUsuarioReal
        : null
    });
    return Object.freeze({
      operacion,
      usuario: proyectarUsuario(objetivo),
      salidaCorreo: operacion.salidaCorreoId === null
        ? null
        : Object.freeze({ id: operacion.salidaCorreoId }),
      auditoria: null,
      sesionesInvalidadas: Object.freeze([]),
      replay: true
    });
  }

  async #ejecutarSensible(usuarioId, operacionDurable) {
    const ejecucion = await this.estadoSensible.ejecutarConExclusion(
      usuarioId, operacionDurable
    );
    const fallos = [];
    if (!ejecucion.limpieza.completa) {
      fallos.push(Object.freeze({ componente: 'estado_sensible' }));
    }
    let sesionesRedis = null;
    try {
      sesionesRedis = await this.servicioSesion.invalidarSesionesUsuario(
        usuarioId, ejecucion.resultado.usuario.versionSesion
      );
    } catch {
      fallos.push(Object.freeze({ componente: 'sesiones_redis' }));
    }
    return Object.freeze({
      resultado: ejecucion.resultado,
      limpiezaEstadoSensible: ejecucion.limpieza,
      convergenciaPostcommit: Object.freeze({
        completa: fallos.length === 0,
        sesiones: sesionesRedis,
        fallos: Object.freeze(fallos)
      })
    });
  }

  async #proyectarCanalActual() {
    try {
      const autoridad = await this.frontera.ejecutar((conexion) =>
        this.evaluadorCorreo.evaluarEnTransaccion({ conexion }));
      return Object.freeze({
        via: autoridad.puedeDespachar
          ? VIAS_REINICIO_PASSWORD_ADMINISTRATIVO.CORREO
          : VIAS_REINICIO_PASSWORD_ADMINISTRATIVO.MANUAL,
        evaluable: true
      });
    } catch {
      return Object.freeze({ via: 'no_evaluable', evaluable: false });
    }
  }
}

function exigirReplayConfirmado(comando, operacion) {
  if (!operacion || operacion.estado !== 'confirmado') {
    throw new ErrorViaReinicioPasswordAdministrativo(
      'REPLAY_REINICIO_PASSWORD_INDETERMINADO',
      'La operación no posee todavía un resultado confirmado.'
    );
  }
  exigirReplayCompatibleReinicioPasswordAdministrativo({
    comando,
    resultado: {
      perfil: PERFILES_REINICIO_PASSWORD_ADMINISTRATIVO.RESULTADO_DURABLE,
      version: VERSION_CONTRATO_REINICIO_PASSWORD_ADMINISTRATIVO,
      reinicioId: operacion.reinicioId,
      usuarioId: operacion.usuarioId,
      via: operacion.via,
      salidaCorreoId: operacion.salidaCorreoId,
      eventoAuditoriaId: operacion.eventoAuditoriaId,
      versionSesionResultante: operacion.versionSesionResultante,
      generacionRecuperacionResultante:
        operacion.generacionRecuperacionResultante,
      aplicadoEnUtc: operacion.aplicadoEnUtc
    }
  });
}

function proyectarUsuario(usuario) {
  return Object.freeze({
    id: String(usuario.id),
    activo: usuario.activo,
    requiereCambioPassword: usuario.requiereCambioPassword,
    versionSesion: String(usuario.versionSesion),
    generacionRecuperacion: String(usuario.generacionRecuperacion)
  });
}

function proyectarUltimoResultado(resultado) {
  if (!resultado) return null;
  return Object.freeze({
    via: resultado.via,
    estado: resultado.estado,
    aplicadoEnUtc: resultado.aplicadoEnUtc
  });
}

async function evaluarAutoridadCorreo(evaluador, conexion) {
  try {
    return await evaluador.evaluarEnTransaccion({ conexion });
  } catch {
    throw new ErrorViaReinicioPasswordAdministrativo(
      'AUTORIDAD_CORREO_NO_EVALUABLE',
      'No se pudo evaluar la vía autoritativa de reinicio.'
    );
  }
}

function exigirViaAplicable(autoridadCorreo, viaEsperada) {
  const decision = decidirViaReinicioPasswordAdministrativo({
    evaluable: true,
    puedeDespachar: autoridadCorreo.puedeDespachar === true,
    viaEsperada
  });
  if (decision.resultado !== 'aplicable') {
    throw new ErrorViaReinicioPasswordAdministrativo(
      'VIA_REINICIO_PASSWORD_CAMBIADA',
      'La vía autoritativa cambió; recarga la operación antes de continuar.'
    );
  }
}

function sha256(valor) {
  return createHash('sha256').update(valor, 'utf8').digest('hex');
}

function scopeUsuario(usuario) {
  return Object.freeze({
    tenantId: usuario.tenantId == null ? null : String(usuario.tenantId),
    empresaId: usuario.empresaId == null ? null : String(usuario.empresaId),
    sitioId: usuario.sitioId == null ? null : String(usuario.sitioId)
  });
}

function exigirContexto(contexto) {
  if (!contexto || !contexto.idUsuario) {
    throw new Error('El reinicio administrativo exige contexto de usuario.');
  }
}

function fechaUtc(valor) {
  const fecha = valor instanceof Date ? new Date(valor.getTime()) : new Date(valor);
  if (Number.isNaN(fecha.getTime())) {
    throw new Error('El reloj del reinicio administrativo no es válido.');
  }
  return fecha.toISOString();
}

function exigirMetodo(objeto, metodo, nombre) {
  if (typeof objeto?.[metodo] !== 'function') {
    throw new Error(`ServicioReinicioPasswordAdministrativo requiere ${nombre}.${metodo}().`);
  }
}
