import crypto from 'node:crypto';
import { esBuzonCorreoValido } from '../../../../paquetes/correo/src/NormalizadorBuzonCorreo.js';

const TTL_VERIFICACION_SEGUNDOS = 20 * 60;

export class ServicioVerificacionCorreoOperativo {
  constructor({
    clienteRedis,
    repositorioUsuarios,
    servicioConfiguracionPortal,
    servicioCorreoPortal,
    perfilSmtpCorreo = null,
    evaluadorAutoridadCorreoSql = null,
    prefijoRedis = 'sentinelia:correo:verificacion_operativa:',
    ttlSegundos = TTL_VERIFICACION_SEGUNDOS
  }) {
    this.clienteRedis = clienteRedis;
    this.repositorioUsuarios = repositorioUsuarios;
    this.servicioConfiguracionPortal = servicioConfiguracionPortal;
    this.servicioCorreoPortal = servicioCorreoPortal;
    this.perfilSmtpCorreo = perfilSmtpCorreo;
    this.evaluadorAutoridadCorreoSql = evaluadorAutoridadCorreoSql;
    this.prefijoRedis = prefijoRedis;
    this.ttlSegundos = ttlSegundos;
  }

  async iniciarVerificacion({ idUsuario }) {
    await this.servicioConfiguracionPortal.asegurarActualizada();

    const usuario = await this.obtenerUsuarioValido(idUsuario);
    const estadoCorreo = this.servicioCorreoPortal.obtenerEstadoConfiguracion();

    if (!estadoCorreo.configurado) {
      throw new Error(
        'Completa la configuración de correo antes de iniciar la prueba empírica.'
      );
    }

    const token = this.generarToken();
    const configuracionCorreo =
      this.servicioCorreoPortal.obtenerConfiguracionCorreoActual();
    const origenPublico = this.obtenerOrigenPublicoEfectivo();
    const payload = {
      token,
      usuarioId: usuario.id,
      email: usuario.email,
      versionConfiguracion: this.servicioConfiguracionPortal.obtenerVersionActual(),
      ...this.calcularHuellaConfiguracionCorreo(configuracionCorreo),
      creadoEnUtc: new Date().toISOString()
    };
    const claveToken = this.obtenerClaveToken(token);
    const claveUsuario = this.obtenerClaveUsuario(usuario.id);
    const tokenAnterior = await this.clienteRedis.get(claveUsuario);

    if (tokenAnterior) {
      await this.clienteRedis.del(this.obtenerClaveToken(tokenAnterior));
    }

    await this.clienteRedis.set(claveToken, JSON.stringify(payload), {
      EX: this.ttlSegundos
    });
    await this.clienteRedis.set(claveUsuario, token, {
      EX: this.ttlSegundos
    });

    try {
      await this.servicioCorreoPortal.enviarCorreoVerificacionOperativa({
        destinatarioEmail: usuario.email,
        destinatarioNombre: usuario.obtenerNombreVisible(),
        enlaceVerificacion: this.construirUrlVerificacion(origenPublico, token),
        ttlMinutos: Math.ceil(this.ttlSegundos / 60)
      });
    } catch (error) {
      await this.limpiarToken({ token, usuarioId: usuario.id });
      throw error;
    }

    return {
      email: usuario.email,
      ttlSegundos: this.ttlSegundos,
      ttlMinutos: Math.ceil(this.ttlSegundos / 60)
    };
  }

  async abrirVerificacion({ token, idUsuario, contextoUsuarioActual }) {
    await this.servicioConfiguracionPortal.asegurarActualizada();

    if (this.esPerfilSmtpAutoritativo()) {
      return this.prepararConfirmacion({ token, idUsuario });
    }
    return this.confirmarVerificacionLegacy({
      token,
      idUsuario,
      contextoUsuarioActual
    });
  }

  async prepararConfirmacion({ token, idUsuario }) {
    const { tokenNormalizado, payload } = await this.cargarPrueba({ token, idUsuario });
    this.exigirPruebaVigente(payload);
    const backlog = await this.servicioCorreoPortal.resumirBacklogDetenido();
    return Object.freeze({
      requiereConfirmacion: true,
      email: payload.email,
      creadoEnUtc: payload.creadoEnUtc,
      expiraEnUtc: calcularExpiracion(payload.creadoEnUtc, this.ttlSegundos),
      backlog,
      tokenValido: Boolean(tokenNormalizado)
    });
  }

  async confirmarVerificacion({
    token,
    idUsuario,
    contextoUsuarioActual,
    aceptaReanudacion
  }) {
    await this.servicioConfiguracionPortal.asegurarActualizada();
    if (!this.esPerfilSmtpAutoritativo()) {
      throw errorVerificacion(
        'La confirmación smtp@1 permanece cerrada por el perfil de despliegue.',
        'correo_verificacion_smtp_no_autoritativa',
        409
      );
    }
    if (aceptaReanudacion !== true) {
      throw errorVerificacion(
        'Debes aceptar expresamente la reanudación del backlog antes de verificar.',
        'correo_reanudacion_no_aceptada',
        400
      );
    }
    const { tokenNormalizado, payload } = await this.cargarPrueba({ token, idUsuario });
    try {
      this.exigirPruebaVigente(payload);
      const backlog = await this.servicioCorreoPortal.resumirBacklogDetenido();
      const promocion = await this.servicioConfiguracionPortal
        .promoverCorreoSmtpVerificado({
          pruebaToken: payload,
          contextoUsuarioActual
        });
      await this.limpiarToken({
        token: tokenNormalizado,
        usuarioId: payload.usuarioId
      });
      return Object.freeze({
        requiereConfirmacion: false,
        email: payload.email,
        backlog,
        promocion
      });
    } catch (error) {
      if (error?.codigo === 'correo_prueba_smtp_obsoleta' ||
          error?.codigo === 'correo_clave_hmac_ausente') {
        await this.limpiarToken({
          token: tokenNormalizado,
          usuarioId: payload.usuarioId
        });
      }
      throw error;
    }
  }

  async confirmarVerificacionLegacy({ token, idUsuario, contextoUsuarioActual }) {
    const { tokenNormalizado, payload } = await this.cargarPrueba({ token, idUsuario });

    try {
      this.exigirPruebaVigente(payload);
    } catch (error) {
      await this.limpiarToken({
        token: tokenNormalizado,
        usuarioId: payload.usuarioId
      });
      throw error;
    }

    await this.servicioConfiguracionPortal.marcarCorreoOperativoVerificado(
      contextoUsuarioActual
    );
    await this.limpiarToken({
      token: tokenNormalizado,
      usuarioId: payload.usuarioId
    });

    return Object.freeze({
      requiereConfirmacion: false,
      email: payload.email,
      legado: true
    });
  }

  async cargarPrueba({ token, idUsuario }) {

    const tokenNormalizado = String(token || '').trim();

    if (!tokenNormalizado) {
      throw new Error('El enlace de verificación no contiene token.');
    }

    const bruto = await this.clienteRedis.get(
      this.obtenerClaveToken(tokenNormalizado)
    );

    if (!bruto) {
      throw new Error('El enlace de verificación ha caducado o ya no es válido.');
    }

    const payload = this.parsearPayload(bruto);

    if (Number(payload.usuarioId) !== Number(idUsuario)) {
      throw new Error(
        'El enlace de verificación pertenece a otro usuario de configuración.'
      );
    }

    return Object.freeze({ tokenNormalizado, payload });
  }

  exigirPruebaVigente(payload) {
    const configuracionCorreo =
      this.servicioCorreoPortal.obtenerConfiguracionCorreoActual();
    let huellaActual;
    try {
      huellaActual = this.calcularHuellaConfiguracionCorreo(
        configuracionCorreo,
        payload.keyId
      );
    } catch {
      throw errorVerificacion(
        'La prueba usa un perfil o una clave que ya no están disponibles. Inicia una verificación nueva.',
        'correo_clave_hmac_ausente',
        409
      );
    }

    if (
      payload.perfilSmtp !== huellaActual.perfilSmtp ||
      payload.perfilBuzon !== huellaActual.perfilBuzon ||
      payload.huellaConfiguracion !== huellaActual.huellaConfiguracion
    ) {
      throw errorVerificacion(
        'La configuración de correo cambió después de emitir la prueba. Inicia una verificación nueva.',
        'correo_prueba_smtp_obsoleta',
        409
      );
    }
    return true;
  }

  async obtenerUsuarioValido(idUsuario) {
    const usuario = await this.repositorioUsuarios.buscarPorId(idUsuario);

    if (!usuario || !usuario.activo) {
      throw new Error('El usuario que inicia la verificación no está activo.');
    }

    if (!esBuzonCorreoValido(usuario.email)) {
      throw new Error(
        'Tu usuario necesita un email válido antes de verificar el correo operativo.'
      );
    }

    return usuario;
  }

  calcularHuellaConfiguracionCorreo(configuracionCorreo, keyId = null) {
    if (!this.perfilSmtpCorreo) {
      throw new Error('La verificación SMTP requiere el perfil HMAC smtp@1.');
    }
    const valores = new Map([
      ['correo.activo', configuracionCorreo.activo],
      ['correo.smtp_host', configuracionCorreo.smtpHost],
      ['correo.smtp_puerto', configuracionCorreo.smtpPuerto],
      ['correo.smtp_secure', configuracionCorreo.smtpSecure],
      ['correo.smtp_usuario', configuracionCorreo.smtpUsuario],
      ['correo.smtp_password', configuracionCorreo.smtpPassword],
      ['correo.smtp_auth_method', configuracionCorreo.smtpAuthMethod],
      ['correo.smtp_timeout_conexion_ms', configuracionCorreo.smtpTimeoutConexionMs],
      ['correo.smtp_timeout_saludo_ms', configuracionCorreo.smtpTimeoutSaludoMs],
      ['correo.smtp_timeout_socket_ms', configuracionCorreo.smtpTimeoutSocketMs],
      ['correo.smtp_tls_permitir_inseguro', configuracionCorreo.smtpTlsPermitirInseguro],
      ['correo.remitente_email', configuracionCorreo.remitenteEmail],
      ['correo.remitente_nombre', configuracionCorreo.remitenteNombre]
    ]);
    const prueba = keyId
      ? this.perfilSmtpCorreo.crearPruebaConKeyId(valores, keyId)
      : this.perfilSmtpCorreo.crearPrueba(valores);
    return Object.freeze({
      perfilSmtp: prueba.perfilVersion,
      perfilBuzon: prueba.perfilBuzon,
      keyId: prueba.keyId,
      huellaConfiguracion: prueba.huellaHmac.toString('hex')
    });
  }

  construirUrlVerificacion(baseUrl, token) {
    const base = normalizarOrigenPublico(baseUrl);
    return `${base}/configuracion/correo/verificar/${encodeURIComponent(token)}`;
  }

  obtenerOrigenPublicoEfectivo() {
    return normalizarOrigenPublico(
      this.servicioConfiguracionPortal
        .obtenerConfiguracionActual()
        .obtenerOrigenPublicoPortal()
    );
  }

  esPerfilSmtpAutoritativo() {
    const estado = this.servicioConfiguracionPortal
      .obtenerEstadoDespliegueCorreoActual?.();
    return Number(estado?.verificacion_smtp_autoritativa) === 1 &&
      Number(estado?.guard_verificacion_legacy_activo) === 1;
  }

  async limpiarToken({ token, usuarioId }) {
    await this.clienteRedis.del(this.obtenerClaveToken(token));
    await this.clienteRedis.del(this.obtenerClaveUsuario(usuarioId));
  }

  parsearPayload(bruto) {
    try {
      return JSON.parse(bruto);
    } catch (_error) {
      throw new Error('El enlace de verificación contiene datos inválidos.');
    }
  }

  generarToken() {
    return crypto.randomBytes(32).toString('base64url');
  }

  obtenerClaveToken(token) {
    return `${this.prefijoRedis}token:${token}`;
  }

  obtenerClaveUsuario(idUsuario) {
    return `${this.prefijoRedis}usuario:${idUsuario}`;
  }
}

function normalizarOrigenPublico(valor) {
  let url;
  try {
    url = new URL(String(valor || ''));
  } catch {
    throw errorVerificacion(
      'Define un origen público HTTPS canónico antes de verificar el correo.',
      'correo_origen_publico_no_disponible',
      409
    );
  }
  const entrada = String(valor);
  if (url.protocol !== 'https:' ||
      ![url.origin, `${url.origin}/`].includes(entrada) ||
      url.username || url.password || url.pathname !== '/' ||
      url.search || url.hash) {
    throw errorVerificacion(
      'Define un origen público HTTPS canónico antes de verificar el correo.',
      'correo_origen_publico_no_disponible',
      409
    );
  }
  return url.origin;
}

function calcularExpiracion(creadoEnUtc, ttlSegundos) {
  const creada = new Date(creadoEnUtc);
  if (Number.isNaN(creada.getTime())) {
    throw errorVerificacion(
      'La prueba SMTP contiene una fecha inválida.',
      'correo_prueba_smtp_invalida',
      400
    );
  }
  return new Date(creada.getTime() + Number(ttlSegundos) * 1000).toISOString();
}

function errorVerificacion(mensaje, codigo, statusCode) {
  return Object.assign(new Error(mensaje), { codigo, statusCode });
}
