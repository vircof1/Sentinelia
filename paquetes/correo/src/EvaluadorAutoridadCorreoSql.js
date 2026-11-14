import { ConfiguracionCorreo } from './ConfiguracionCorreo.js';

export class EvaluadorAutoridadCorreoSql {
  constructor({
    repositorioConfiguracion,
    perfilSmtpCorreo,
    validadorConfiguracionCorreo
  }) {
    if (!repositorioConfiguracion?.bloquearAutoridadCorreoEnTransaccion ||
        !perfilSmtpCorreo?.evaluarPrueba ||
        !validadorConfiguracionCorreo?.evaluar) {
      throw new Error('La evaluación SMTP autoritativa requiere todos sus puertos.');
    }
    this.repositorioConfiguracion = repositorioConfiguracion;
    this.perfilSmtpCorreo = perfilSmtpCorreo;
    this.validadorConfiguracionCorreo = validadorConfiguracionCorreo;
  }

  async evaluarEnTransaccion({ conexion } = {}) {
    const lectura = await this.repositorioConfiguracion
      .bloquearAutoridadCorreoEnTransaccion({ conexion, modo: 'compartido' });
    const configuracion = construirConfiguracionCorreo(lectura.valores);
    const estructural = this.validadorConfiguracionCorreo.evaluar(configuracion, {
      validarCoordinacionRuntime: false
    });
    const prueba = this.perfilSmtpCorreo.evaluarPrueba({
      filasConfiguracion: lectura.valores,
      estadoVerificacion: lectura.estadoVerificacion,
      versionConfiguracion: lectura.versionConfiguracion
    });
    const perfilAutoritativo =
      Number(lectura.estadoDespliegue.verificacion_smtp_autoritativa) === 1 &&
      Number(lectura.estadoDespliegue.guard_verificacion_legacy_activo) === 1;
    const puedeDespachar = perfilAutoritativo &&
      estructural.configurado && prueba.puedeDespachar;
    return Object.freeze({
      perfil: 'smtp@1',
      configurado: estructural.configurado,
      puedeDespachar,
      codigo: !perfilAutoritativo
        ? 'correo_perfil_smtp_no_autoritativo'
        : !estructural.configurado
        ? 'correo_configuracion_smtp_invalida'
        : prueba.codigo,
      errores: Object.freeze([...estructural.errores]),
      advertencias: Object.freeze([...estructural.advertencias]),
      remitenteEmailCanonico: estructural.remitenteEmailCanonico,
      versionConfiguracion: lectura.versionConfiguracion,
      prueba,
      configuracion,
      lectura
    });
  }
}

function construirConfiguracionCorreo(valores) {
  const valor = (clave) => valores.get(clave);
  return new ConfiguracionCorreo({
    activo: booleano(valor('correo.activo')),
    operativoVerificado: false,
    smtpHost: valor('correo.smtp_host'),
    smtpPuerto: valor('correo.smtp_puerto'),
    smtpSecure: booleano(valor('correo.smtp_secure')),
    smtpUsuario: valor('correo.smtp_usuario'),
    smtpPassword: valor('correo.smtp_password'),
    smtpAuthMethod: valor('correo.smtp_auth_method'),
    smtpTimeoutConexionMs: valor('correo.smtp_timeout_conexion_ms'),
    smtpTimeoutSaludoMs: valor('correo.smtp_timeout_saludo_ms'),
    smtpTimeoutSocketMs: valor('correo.smtp_timeout_socket_ms'),
    smtpTlsPermitirInseguro: booleano(
      valor('correo.smtp_tls_permitir_inseguro')
    ),
    remitenteEmail: valor('correo.remitente_email'),
    remitenteNombre: valor('correo.remitente_nombre'),
    maxReintentos: valor('correo.max_reintentos'),
    reintentoBaseSegundos: valor('correo.reintento_base_segundos'),
    bloqueoTtlSegundos: valor('correo.bloqueo_ttl_segundos'),
    runtimeLoteMaximo: valor('correo.runtime_lote_maximo'),
    desuscripcionTtlDias: valor('correo.desuscripcion_ttl_dias'),
    destinatariosTriggerMaximos: valor('correo.destinatarios_trigger_maximos'),
    retencionSalidasDias: valor('correo.retencion_salidas_dias')
  });
}

function booleano(valor) {
  return ['1', 'true', 'si', 'yes', 'on'].includes(
    String(valor ?? '').trim().toLowerCase()
  );
}
