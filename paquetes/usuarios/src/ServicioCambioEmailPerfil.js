import { ErrorAutogestionPerfil } from './ErrorAutogestionPerfil.js';
import { generarUuidV7Auditoria } from '../../auditoria/src/UuidV7Auditoria.js';
import { PERFIL_JCS_AUDITORIA_V1 } from '../../auditoria/src/PerfilJcsAuditoria.js';
import { VERSION_ENCADENADO_AUDITORIA_V1 } from '../../auditoria/src/SobreCanonicoAuditoria.js';

export class ServicioCambioEmailPerfil {
  constructor({
    repositorioUsuarios,
    repositorioOperacionesEmail,
    servicioEmailPerfil,
    servicioAutorizacionPerfil,
    servicioCorreoPortal,
    servicioConfiguracionPortal,
    coordinadorEmisionEmailPerfil = null,
    fronteraTransaccional = null,
    servicioAuditoria = null,
    ahora = () => new Date()
  }) {
    if (typeof servicioConfiguracionPortal?.obtenerConfiguracionActual !== 'function') {
      throw new Error(
        'El cambio de correo exige el origen público neutral del portal.'
      );
    }
    if (['encolarInicial', 'encolarReenvio'].some((metodo) =>
      typeof coordinadorEmisionEmailPerfil?.[metodo] !== 'function')) {
      throw new Error('El cambio de correo exige el coordinador de emisión.');
    }
    this.repositorioUsuarios = repositorioUsuarios;
    this.repositorioOperacionesEmail = repositorioOperacionesEmail;
    this.servicioEmailPerfil = servicioEmailPerfil;
    this.servicioAutorizacionPerfil = servicioAutorizacionPerfil;
    this.servicioCorreoPortal = servicioCorreoPortal;
    this.servicioConfiguracionPortal = servicioConfiguracionPortal;
    this.coordinadorEmisionEmailPerfil = coordinadorEmisionEmailPerfil;
    this.fronteraTransaccional = fronteraTransaccional;
    this.servicioAuditoria = servicioAuditoria;
    this.ahora = ahora;
  }

  async solicitarCambio({
    contextoUsuarioActual,
    idSesion,
    email
  }) {
    await this.servicioAutorizacionPerfil.exigirAutorizacion({
      contextoUsuarioActual,
      idSesion
    });

    const emailCandidato = this.servicioEmailPerfil.validarEmail(email);
    const idUsuario = Number(contextoUsuarioActual.idUsuarioReal);
    const usuario = await this.repositorioUsuarios.buscarPorId(idUsuario);
    this.exigirUsuarioVigente(usuario);
    if (usuario.email === emailCandidato && usuario.emailValidado) {
      return this.servicioEmailPerfil.construirResultadoSinCambios({
        email: usuario.email,
        emailValidado: true
      });
    }
    return this.coordinadorEmisionEmailPerfil.encolarInicial({
      idUsuario: String(idUsuario),
      emailCandidato
    });
  }

  async obtenerEstadoPerfil({ contextoUsuarioActual }) {
    const idUsuario = Number(contextoUsuarioActual?.idUsuarioReal);
    this.exigirPropietarioOrdinario(contextoUsuarioActual, idUsuario);

    const usuario = await this.repositorioUsuarios.buscarPorId(idUsuario);
    this.exigirUsuarioVigente(usuario);
    const diagnostico =
      await this.repositorioOperacionesEmail.obtenerOperacionActual(idUsuario);
    const operacion = ['pendiente_aceptacion_smtp', 'activa', 'consumiendo']
      .includes(diagnostico.estado)
      ? diagnostico.operacion
      : null;
    const operacionVigente = Boolean(
      operacion &&
      usuario.email === operacion.emailOrigen &&
      this.repositorioOperacionesEmail.coincideHuellaCredencial(
        operacion,
        usuario.hashPassword
      )
    );
    const estadoCorreo = await obtenerEstadoCorreo(this.servicioCorreoPortal);

    return {
      email: usuario.email,
      emailValidado: usuario.emailValidado,
      correoOperativo: Boolean(estadoCorreo.operativo),
      operacionPendiente: operacionVigente
        ? {
            emailCandidato: operacion.emailCandidato,
            expiraEn: operacion.expiraEn,
            pendienteAceptacionSmtp:
              diagnostico.estado === 'pendiente_aceptacion_smtp',
            esValidacionEmailActual:
              operacion.emailOrigen === operacion.emailCandidato,
            reenviable: diagnostico.estado === 'activa'
          }
        : null
    };
  }

  async validarEmailActual({
    contextoUsuarioActual,
    idSesion
  }) {
    await this.servicioAutorizacionPerfil.exigirAutorizacion({
      contextoUsuarioActual,
      idSesion
    });
    const idUsuario = Number(contextoUsuarioActual.idUsuarioReal);
    const usuario = await this.repositorioUsuarios.buscarPorId(idUsuario);
    this.exigirUsuarioVigente(usuario);
    if (usuario.emailValidado) {
      return this.servicioEmailPerfil.construirResultadoSinCambios({
        email: usuario.email,
        emailValidado: true
      });
    }
    return this.coordinadorEmisionEmailPerfil.encolarInicial({
      idUsuario: String(idUsuario),
      emailCandidato: usuario.email
    });
  }

  async reenviarValidacion({
    contextoUsuarioActual,
    idSesion
  }) {
    await this.servicioAutorizacionPerfil.exigirAutorizacion({
      contextoUsuarioActual,
      idSesion
    });
    const idUsuario = Number(contextoUsuarioActual.idUsuarioReal);
    return this.coordinadorEmisionEmailPerfil.encolarReenvio({
      idUsuario: String(idUsuario)
    });
  }

  async registrarEnlace(token) {
    const diagnostico =
      await this.repositorioOperacionesEmail.diagnosticarTokenOhuella(token);
    this.exigirTokenUtilizable(diagnostico, { permitirConsumiendo: false });
    return {
      huellaToken: diagnostico.huellaToken,
      idUsuario: diagnostico.operacion.idUsuario
    };
  }

  async obtenerConfirmacion({ huellaToken, contextoUsuarioActual }) {
    const diagnostico =
      await this.repositorioOperacionesEmail.diagnosticarTokenOhuella(
        huellaToken,
        { esHuella: true }
      );
    this.exigirTokenUtilizable(diagnostico, { permitirConsumiendo: false });
    this.exigirPropietarioOrdinario(
      contextoUsuarioActual,
      diagnostico.operacion.idUsuario
    );

    return {
      emailCandidato: diagnostico.operacion.emailCandidato,
      expiraEn: diagnostico.operacion.expiraEn,
      esValidacionEmailActual:
        diagnostico.operacion.emailOrigen ===
        diagnostico.operacion.emailCandidato
    };
  }

  async confirmar({ huellaToken, contextoUsuarioActual }) {
    const referenciaInicial =
      await this.repositorioOperacionesEmail.diagnosticarTokenOhuella(
        huellaToken,
        { esHuella: true }
      );
    this.exigirTokenUtilizable(referenciaInicial, {
      permitirConsumiendo: false
    });
    this.exigirPropietarioOrdinario(
      contextoUsuarioActual,
      referenciaInicial.operacion.idUsuario
    );
    const idUsuario = referenciaInicial.operacion.idUsuario;
    const bloqueo =
      await this.repositorioOperacionesEmail.adquirirBloqueoUsuario(idUsuario);
    if (!bloqueo) {
      throw this.crearError(
        'operacion_email_en_conflicto',
        'Ya existe otra operación de correo en curso.',
        409
      );
    }

    try {
      return await this.confirmarBajoBloqueo({
        huellaToken,
        contextoUsuarioActual
      });
    } finally {
      await this.repositorioOperacionesEmail
        .liberarBloqueoUsuario(idUsuario, bloqueo)
        .catch(() => {});
    }
  }

  async confirmarBajoBloqueo({ huellaToken, contextoUsuarioActual }) {
    const diagnostico =
      await this.repositorioOperacionesEmail.diagnosticarTokenOhuella(
        huellaToken,
        { esHuella: true }
      );
    this.exigirTokenUtilizable(diagnostico, { permitirConsumiendo: false });
    const operacion = diagnostico.operacion;
    this.exigirPropietarioOrdinario(contextoUsuarioActual, operacion.idUsuario);

    const usuarioActual = await this.repositorioUsuarios.buscarPorId(
      operacion.idUsuario
    );
    this.exigirUsuarioVigente(usuarioActual);

    if (
      usuarioActual.email === operacion.emailCandidato &&
      usuarioActual.emailValidado
    ) {
      await this.repositorioOperacionesEmail.finalizarConsumo({ operacion });
      return this.resultadoEmailValidado(
        operacion.emailCandidato,
        false,
        operacion.emailOrigen === operacion.emailCandidato
      );
    }

    if (
      usuarioActual.email !== operacion.emailOrigen ||
      !this.repositorioOperacionesEmail.coincideHuellaCredencial(
        operacion,
        usuarioActual.hashPassword
      )
    ) {
      await this.repositorioOperacionesEmail.invalidarOperacionUsuario(
        operacion.idUsuario,
        { idOperacion: operacion.idOperacion, estado: 'sustituida' }
      );
      throw this.crearError(
        'operacion_email_en_conflicto',
        'La identidad sensible cambió antes de confirmar la operación.',
        409
      );
    }

    const reserva = await this.repositorioOperacionesEmail.reservarConsumo({
      operacion,
      huellaToken: diagnostico.huellaToken
    });

    if (reserva.estado !== 'reservada') {
      throw this.errorEstadoReserva(reserva.estado);
    }

    let persistencia;
    try {
      persistencia = await this.confirmarEmailAuditable({
        operacion,
        contextoUsuarioActual
      });
    } catch (error) {
      await this.repositorioOperacionesEmail
        .restaurarConsumo({ operacion, reserva: reserva.reserva })
        .catch(() => {});
      throw error;
    }

    if (persistencia.estado === 'sesion_no_vigente') {
      await this.repositorioOperacionesEmail
        .restaurarConsumo({ operacion, reserva: reserva.reserva })
        .catch(() => {});
      throw this.crearError(
        'sesion_no_vigente',
        'La cuenta ya no está disponible.',
        401
      );
    }

    if (persistencia.estado === 'conflicto') {
      await this.repositorioOperacionesEmail.invalidarOperacionUsuario(
        operacion.idUsuario,
        { idOperacion: operacion.idOperacion, estado: 'sustituida' }
      );
      throw this.crearError(
        'operacion_email_en_conflicto',
        'El correo efectivo cambió durante la confirmación.',
        409
      );
    }

    let finalizacion;
    try {
      finalizacion = await this.repositorioOperacionesEmail.finalizarConsumo({
        operacion,
        reserva: reserva.reserva
      });
    } catch (error) {
      await this.repositorioOperacionesEmail
        .restaurarConsumo({ operacion, reserva: reserva.reserva })
        .catch(() => {});
      throw error;
    }
    if (!['consumida', 'ya_consumida'].includes(finalizacion)) {
      await this.repositorioOperacionesEmail
        .restaurarConsumo({ operacion, reserva: reserva.reserva })
        .catch(() => {});
      throw new Error(
        `No se pudo cerrar la verificación de correo (${finalizacion}).`
      );
    }

    return this.resultadoEmailValidado(
      operacion.emailCandidato,
      persistencia.estado === 'actualizado',
      operacion.emailOrigen === operacion.emailCandidato
    );
  }

  async confirmarEmailAuditable({ operacion, contextoUsuarioActual }) {
    if (!this.auditoriaActiva()) {
      return this.repositorioUsuarios.confirmarEmailValidadoPendiente({
        idUsuario: operacion.idUsuario,
        emailOrigen: operacion.emailOrigen,
        emailCandidato: operacion.emailCandidato
      });
    }
    const ejecutar = async (conexion = null) => {
      const usuario = conexion && this.repositorioUsuarios.buscarPorIdEnTransaccion
        ? await this.repositorioUsuarios.buscarPorIdEnTransaccion(
            operacion.idUsuario,
            { conexion, forUpdate: true }
          )
        : await this.repositorioUsuarios.buscarPorId(operacion.idUsuario);
      const persistencia =
        await this.repositorioUsuarios.confirmarEmailValidadoPendienteEnTransaccion({
          idUsuario: operacion.idUsuario,
          emailOrigen: operacion.emailOrigen,
          emailCandidato: operacion.emailCandidato
        }, { conexion });
      if (persistencia.estado === 'actualizado') {
        await this.registrarEmailValidado({
          conexion,
          contextoUsuarioActual,
          usuario,
          idUsuario: operacion.idUsuario
        });
      }
      return persistencia;
    };
    if (this.auditoriaActiva()) {
      return this.fronteraTransaccional.ejecutar(ejecutar);
    }
    return ejecutar(null);
  }

  auditoriaActiva() {
    return Boolean(
      this.fronteraTransaccional?.ejecutar &&
      this.servicioAuditoria?.registrarEnTransaccion
    );
  }

  async registrarEmailValidado({ conexion, contextoUsuarioActual, usuario, idUsuario }) {
    if (!conexion || !this.servicioAuditoria?.registrarEnTransaccion) {
      return null;
    }
    return this.servicioAuditoria.registrarEnTransaccion({
      cambioEfectivo: true,
      intencion: crearIntencionUsuario({
        tipo: 'usuario.email_validado',
        contextoUsuarioActual,
        sujetoId: idUsuario,
        scope: scopeUsuario(usuario),
        payload: {
          estadoAntes: 'no_validado',
          estadoDespues: 'validado',
          motivo: 'confirmacion_email'
        },
        fecha: this.ahora()
      })
    }, { conexion });
  }

  exigirTokenUtilizable(diagnostico, { permitirConsumiendo }) {
    if (diagnostico.estado === 'activa') return;
    if (permitirConsumiendo && diagnostico.estado === 'consumiendo') return;

    const definicion = {
      expirada: ['token_email_expirado', 'El enlace de verificación ha expirado.', 410],
      consumida: ['token_email_consumido', 'El enlace de verificación ya fue utilizado.', 410],
      sustituida: ['token_email_sustituido', 'El enlace fue sustituido por una solicitud posterior.', 409],
      consumiendo: ['operacion_email_en_conflicto', 'La verificación ya se está procesando.', 409]
    }[diagnostico.estado] || [
      'token_email_invalido',
      'El enlace de verificación no es válido.',
      400
    ];
    throw this.crearError(...definicion);
  }

  exigirPropietarioOrdinario(contexto, idPropietario) {
    const idReal = Number(contexto?.idUsuarioReal);
    const idEfectivo = Number(contexto?.idUsuario);
    if (contexto?.impersonacionActiva || idReal !== idEfectivo) {
      throw this.crearError(
        'impersonacion_no_permitida',
        'No se permite confirmar un correo durante una impersonación.',
        403
      );
    }
    if (idReal !== Number(idPropietario)) {
      throw this.crearError(
        'token_email_otro_propietario',
        'El enlace pertenece a otra cuenta.',
        403
      );
    }
  }

  exigirUsuarioVigente(usuario) {
    if (!usuario || !usuario.activo) {
      throw this.crearError(
        'sesion_no_vigente',
        'La cuenta ya no está disponible.',
        401
      );
    }
  }

  errorEstadoReserva(estado) {
    if (estado === 'sustituida') {
      return this.crearError(
        'token_email_sustituido',
        'El enlace fue sustituido por una solicitud posterior.',
        409
      );
    }
    return this.crearError(
      'operacion_email_en_conflicto',
      'La verificación ya se está procesando.',
      409
    );
  }

  resultadoEmailValidado(email, modificado, esValidacionEmailActual) {
    return {
      codigo: 'email_validado',
      mensaje: esValidacionEmailActual
        ? 'El correo electrónico ha quedado validado.'
        : 'El cambio de correo electrónico ha quedado confirmado.',
      datos: { email, email_validado: true, modificado }
    };
  }

  crearError(codigo, mensaje, estadoHttp) {
    return new ErrorAutogestionPerfil({ codigo, mensaje, estadoHttp });
  }
}

function obtenerEstadoCorreo(servicioCorreoPortal) {
  if (typeof servicioCorreoPortal?.obtenerEstadoConfiguracionAutoritativo ===
      'function') {
    return servicioCorreoPortal.obtenerEstadoConfiguracionAutoritativo();
  }
  return servicioCorreoPortal.obtenerEstadoConfiguracion();
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
  return {
    eventoId: generarUuidV7Auditoria(),
    tipo,
    versionContrato: 1,
    flujo: 'usuarios',
    claveCadena: scope?.tenantId ? `usuarios:tenant:${scope.tenantId}` : 'usuarios:portal',
    actorReal: { tipo: 'usuario', id: actorRealId },
    actorEfectivo: impersonado ? { tipo: 'usuario', id: actorEfectivoId } : null,
    modoActuacion: impersonado ? 'impersonado' : 'directo',
    sujeto: { tipo: 'usuario', id: idDecimal(sujetoId, 'sujeto') },
    origen: 'web',
    scope,
    correlacionId: generarUuidV7Auditoria(),
    causalidad: null,
    productor: 'portal_web',
    claveOperacion: generarUuidV7Auditoria(),
    rolEvento: 'principal',
    efectivoEnUtc: normalizarFecha(fecha),
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
    throw new Error('El instante auditable de email no es válido.');
  }
  return fecha.toISOString();
}
