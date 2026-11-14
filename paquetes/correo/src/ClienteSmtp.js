import nodemailer from 'nodemailer';
import { exigirProcedenciaDespachoCorreo }
  from './ContratoSalidaCorreo.js';
import {
  CLASIFICACIONES_INTENTO_SMTP_CORREO as C,
  ESTADOS_INTENTO_SMTP_CORREO as E
} from './ContratoSalidaCorreo.js';

export class ClienteSmtp {
  constructor({ fabricaTransport = null } = {}) {
    this.fabricaTransport = fabricaTransport;
  }

  crearTransport(configuracionCorreo) {
    const opciones = {
      host: configuracionCorreo.smtpHost,
      port: configuracionCorreo.smtpPuerto,
      secure: configuracionCorreo.smtpSecure,
      disableFileAccess: true,
      disableUrlAccess: true,
      connectionTimeout: configuracionCorreo.smtpTimeoutConexionMs,
      greetingTimeout: configuracionCorreo.smtpTimeoutSaludoMs,
      socketTimeout: configuracionCorreo.smtpTimeoutSocketMs,
      tls: {
        rejectUnauthorized: !configuracionCorreo.smtpTlsPermitirInseguro
      }
    };

    if (configuracionCorreo.smtpUsuario || configuracionCorreo.smtpPassword) {
      opciones.auth = {
        user: configuracionCorreo.smtpUsuario,
        pass: configuracionCorreo.smtpPassword
      };
    }

    if (configuracionCorreo.smtpAuthMethod) {
      opciones.authMethod = configuracionCorreo.smtpAuthMethod;
    }

    return this.fabricaTransport
      ? this.fabricaTransport(opciones)
      : nodemailer.createTransport(opciones);
  }

  async enviar(configuracionCorreo, correoPendiente) {
    const transporter = this.crearTransport(configuracionCorreo);

    const resultado = await transporter.sendMail({
      from: {
        name: correoPendiente.remitenteNombre || configuracionCorreo.remitenteNombre,
        address: correoPendiente.remitenteEmail || configuracionCorreo.remitenteEmail
      },
      to: {
        name: correoPendiente.destinatarioNombre || undefined,
        address: correoPendiente.destinatarioEmail
      },
      subject: correoPendiente.asunto,
      text: correoPendiente.cuerpoTexto
    });

    return {
      messageId: resultado.messageId,
      accepted: resultado.accepted || [],
      rejected: resultado.rejected || [],
      response: resultado.response || ''
    };
  }

  async enviarIntentoTrigger(configuracionCorreo, correoPendiente) {
    return this.enviarIntentoSql(configuracionCorreo, correoPendiente, {
      origenEsperado: 'trigger'
    });
  }

  async enviarIntentoSql(configuracionCorreo, correoPendiente, {
    origenEsperado,
    secretosAdicionales = []
  } = {}) {
    validarMensajeSql(correoPendiente);
    exigirProcedenciaDespachoCorreo({
      esperada: origenEsperado,
      observada: correoPendiente.origenTipo
    });
    const transporter = this.crearTransport(configuracionCorreo);
    try {
      const resultado = await transporter.sendMail({
        from: {
          name: configuracionCorreo.remitenteNombre,
          address: configuracionCorreo.remitenteEmail
        },
        to: [correoPendiente.destinatarioNombre
          ? {
              name: correoPendiente.destinatarioNombre,
              address: correoPendiente.destinatarioEmail
            }
          : { address: correoPendiente.destinatarioEmail }],
        envelope: {
          from: configuracionCorreo.remitenteEmail,
          to: [correoPendiente.destinatarioEmail]
        },
        messageId: correoPendiente.smtpMessageId,
        subject: correoPendiente.asunto,
        text: correoPendiente.cuerpoTexto
      });
      return clasificarResultadoSmtpTrigger(resultado, {
        destinatarioEmail: correoPendiente.destinatarioEmail,
        secretos: secretosIntento(configuracionCorreo, secretosAdicionales)
      });
    } catch (error) {
      return clasificarErrorSmtpTrigger(error, {
        secretos: secretosIntento(configuracionCorreo, secretosAdicionales)
      });
    } finally {
      transporter.close?.();
    }
  }
}

export function clasificarResultadoSmtpTrigger(resultado, {
  destinatarioEmail,
  secretos = []
} = {}) {
  const aceptados = normalizarBuzonesProveedor(resultado?.accepted);
  const rechazados = normalizarBuzonesProveedor(resultado?.rejected);
  const respuesta = sanearEvidenciaSmtp(resultado?.response || 'Respuesta SMTP sin detalle.',
    secretos);
  if (aceptados.length === 1 && aceptados[0] === destinatarioEmail &&
      rechazados.length === 0) {
    return resultadoClasificado(E.ACEPTADO, C.ACEPTACION_DEMOSTRADA,
      'smtp_aceptado', respuesta);
  }
  if (aceptados.length === 0 && rechazados.includes(destinatarioEmail)) {
    if (/^5\d\d(?:\s|$)/u.test(respuesta)) {
      return resultadoClasificado(E.RECHAZADO, C.RECHAZO_PERMANENTE,
        'smtp_rechazo_permanente', respuesta);
    }
    if (/^4\d\d(?:\s|$)/u.test(respuesta)) {
      return resultadoClasificado(E.FALLIDO_REINTENTABLE, C.FALLO_REINTENTABLE,
        'smtp_fallo_temporal', respuesta);
    }
  }
  return resultadoClasificado(E.AMBIGUO, C.RESULTADO_AMBIGUO,
    'smtp_resultado_ambiguo', respuesta);
}

export function clasificarErrorSmtpTrigger(error, { secretos = [] } = {}) {
  const respuestaCodigo = Number(error?.responseCode || 0);
  const comando = String(error?.command || '').trim().toUpperCase();
  const codigoLibreria = String(error?.code || '').trim().toUpperCase();
  const evidencia = sanearEvidenciaSmtp(
    error?.response || error?.message || 'Fallo SMTP sin detalle.',
    secretos
  );
  const rechazoMensaje = respuestaCodigo >= 500 &&
    ['RCPT TO', 'DATA'].includes(comando);
  if (rechazoMensaje) {
    return resultadoClasificado(E.RECHAZADO, C.RECHAZO_PERMANENTE,
      'smtp_rechazo_permanente', evidencia);
  }
  const fasePreviaDemostrada = [
    'CONN', 'CONNECT', 'EHLO', 'HELO', 'STARTTLS', 'AUTH', 'MAIL FROM', 'RCPT TO'
  ].includes(comando) || [
    'ECONNECTION', 'EDNS', 'ETLS'
  ].includes(codigoLibreria);
  if (respuestaCodigo >= 400 && respuestaCodigo < 500 && fasePreviaDemostrada) {
    return resultadoClasificado(E.FALLIDO_REINTENTABLE, C.FALLO_REINTENTABLE,
      'smtp_fallo_temporal', evidencia);
  }
  if (!respuestaCodigo && fasePreviaDemostrada) {
    return resultadoClasificado(E.FALLIDO_REINTENTABLE, C.FALLO_REINTENTABLE,
      'smtp_fallo_previo_datos', evidencia);
  }
  if (respuestaCodigo >= 500 && fasePreviaDemostrada) {
    return resultadoClasificado(E.FALLIDO_FINAL, C.FALLO_FINAL,
      'smtp_fallo_configuracion', evidencia);
  }
  return resultadoClasificado(E.AMBIGUO, C.RESULTADO_AMBIGUO,
    'smtp_resultado_ambiguo', evidencia);
}

function validarMensajeSql(correo) {
  if (!correo || typeof correo.destinatarioEmail !== 'string' ||
      !correo.destinatarioEmail || typeof correo.smtpMessageId !== 'string' ||
      !correo.smtpMessageId || typeof correo.asunto !== 'string' ||
      typeof correo.cuerpoTexto !== 'string') {
    throw new Error('El intento SQL requiere un único mensaje materializado.');
  }
}

function normalizarBuzonesProveedor(valores) {
  if (!Array.isArray(valores)) return [];
  return valores.map((valor) => String(valor?.address || valor || '').trim());
}

function secretosConfiguracion(configuracion) {
  return [configuracion?.smtpPassword, configuracion?.smtpUsuario]
    .map((valor) => String(valor || ''))
    .filter((valor) => valor.length >= 3);
}

function secretosIntento(configuracion, adicionales) {
  if (!Array.isArray(adicionales)) {
    throw new Error('Los secretos adicionales del intento SMTP no son válidos.');
  }
  return [...secretosConfiguracion(configuracion), ...adicionales]
    .map((valor) => String(valor || ''))
    .filter((valor) => valor.length >= 3);
}

function sanearEvidenciaSmtp(valor, secretos) {
  let texto = String(valor ?? '')
    .replace(/[\u0000-\u001f\u007f]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  for (const secreto of secretos || []) {
    texto = texto.split(String(secreto)).join('[redactado]');
  }
  if (!texto) texto = 'Respuesta SMTP sin detalle.';
  while (Buffer.byteLength(texto, 'utf8') > 2000) texto = texto.slice(0, -1);
  return texto;
}

function resultadoClasificado(estado, clasificacion, codigo, respuestaSaneada) {
  return Object.freeze({ estado, clasificacion, codigo, respuestaSaneada });
}
