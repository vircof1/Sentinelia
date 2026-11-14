import {
  esBuzonCorreoValido,
  normalizarBuzonCorreo,
  normalizarNombrePresentacionCorreo
} from './NormalizadorBuzonCorreo.js';

export class ValidadorConfiguracionCorreo {
  evaluar(configuracionCorreo, { validarCoordinacionRuntime = true } = {}) {
    const errores = [];
    const advertencias = [];
    const usaAutenticacion = Boolean(
      configuracionCorreo.smtpUsuario ||
      configuracionCorreo.smtpPassword ||
      configuracionCorreo.smtpAuthMethod
    );

    if (!configuracionCorreo.activo) {
      advertencias.push('El subsistema de correo está desactivado.');
    }

    if (configuracionCorreo.activo) {
      if (!configuracionCorreo.smtpHost) {
        errores.push('Falta correo.smtp_host.');
      }

      if (
        !Number.isFinite(configuracionCorreo.smtpPuerto) ||
        configuracionCorreo.smtpPuerto < 1 ||
        configuracionCorreo.smtpPuerto > 65535
      ) {
        errores.push('correo.smtp_puerto no es válido.');
      }

      if (
        !Number.isFinite(configuracionCorreo.smtpTimeoutConexionMs) ||
        configuracionCorreo.smtpTimeoutConexionMs < 1000
      ) {
        errores.push('correo.smtp_timeout_conexion_ms debe ser mayor o igual a 1000.');
      }

      if (
        !Number.isFinite(configuracionCorreo.smtpTimeoutSaludoMs) ||
        configuracionCorreo.smtpTimeoutSaludoMs < 1000
      ) {
        errores.push('correo.smtp_timeout_saludo_ms debe ser mayor o igual a 1000.');
      }

      if (
        !Number.isFinite(configuracionCorreo.smtpTimeoutSocketMs) ||
        configuracionCorreo.smtpTimeoutSocketMs < 1000
      ) {
        errores.push('correo.smtp_timeout_socket_ms debe ser mayor o igual a 1000.');
      }

      if (usaAutenticacion && !configuracionCorreo.smtpUsuario) {
        errores.push('Falta correo.smtp_usuario.');
      }

      if (usaAutenticacion && !configuracionCorreo.smtpPassword) {
        errores.push('Falta correo.smtp_password.');
      }

      if (
        configuracionCorreo.smtpAuthMethod &&
        !['LOGIN', 'PLAIN', 'CRAM-MD5', 'XOAUTH2'].includes(
          configuracionCorreo.smtpAuthMethod
        )
      ) {
        errores.push('correo.smtp_auth_method no es un método soportado.');
      }

      if (!configuracionCorreo.remitenteEmail) {
        errores.push('Falta correo.remitente_email.');
      }
    }

    let remitenteEmailCanonico = null;
    if (configuracionCorreo.remitenteEmail) {
      try {
        remitenteEmailCanonico = this.normalizarCorreo(
          configuracionCorreo.remitenteEmail
        );
      } catch {
        errores.push('correo.remitente_email no es un correo válido para buzon@1.');
      }
    }

    if (!configuracionCorreo.remitenteNombre) {
      errores.push('Falta correo.remitente_nombre.');
    } else {
      try {
        normalizarNombrePresentacionCorreo(configuracionCorreo.remitenteNombre, {
          permitirVacio: false
        });
      } catch {
        errores.push('correo.remitente_nombre contiene caracteres de cabecera no permitidos.');
      }
    }

    if (
      !Number.isFinite(configuracionCorreo.maxReintentos) ||
      configuracionCorreo.maxReintentos < 0
    ) {
      errores.push('correo.max_reintentos debe ser un entero mayor o igual a 0.');
    }

    if (
      !Number.isFinite(configuracionCorreo.reintentoBaseSegundos) ||
      configuracionCorreo.reintentoBaseSegundos < 15
    ) {
      errores.push('correo.reintento_base_segundos debe ser un entero mayor o igual a 15.');
    }

    if (validarCoordinacionRuntime && (
      !Number.isFinite(configuracionCorreo.bloqueoTtlSegundos) ||
      configuracionCorreo.bloqueoTtlSegundos < 15
    )) {
      errores.push('correo.bloqueo_ttl_segundos debe ser un entero mayor o igual a 15.');
    }

    if (validarCoordinacionRuntime && (
      !Number.isFinite(configuracionCorreo.runtimeLoteMaximo) ||
      configuracionCorreo.runtimeLoteMaximo < 1 ||
      configuracionCorreo.runtimeLoteMaximo > 100
    )) {
      errores.push('correo.runtime_lote_maximo debe ser un entero entre 1 y 100.');
    }

    if (
      configuracionCorreo.smtpTlsPermitirInseguro &&
      !configuracionCorreo.smtpSecure
    ) {
      advertencias.push(
        'correo.smtp_tls_permitir_inseguro está activo; úsalo solo en entornos controlados.'
      );
    }

    const configurado = configuracionCorreo.activo && errores.length === 0;
    const operativo = configurado && configuracionCorreo.operativoVerificado;

    if (configurado && !configuracionCorreo.operativoVerificado) {
      advertencias.push(
        'La configuración de correo aún no tiene prueba empírica vigente.'
      );
    }

    return {
      activa: configuracionCorreo.activo,
      valida: errores.length === 0,
      configurado,
      operativo,
      operativoVerificado: configuracionCorreo.operativoVerificado,
      puedeDespachar: operativo,
      remitenteEmailCanonico,
      errores,
      advertencias
    };
  }

  esCorreoValido(valor) {
    return esBuzonCorreoValido(valor);
  }

  normalizarCorreo(valor) {
    return normalizarBuzonCorreo(valor).canonico;
  }
}
