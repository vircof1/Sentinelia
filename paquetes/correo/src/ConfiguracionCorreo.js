export class ConfiguracionCorreo {
  constructor({
    activo,
    operativoVerificado,
    smtpHost,
    smtpPuerto,
    smtpSecure,
    smtpUsuario,
    smtpPassword,
    smtpAuthMethod,
    smtpTimeoutConexionMs,
    smtpTimeoutSaludoMs,
    smtpTimeoutSocketMs,
    smtpTlsPermitirInseguro,
    remitenteEmail,
    remitenteNombre,
    maxReintentos,
    reintentoBaseSegundos,
    bloqueoTtlSegundos,
    runtimeLoteMaximo,
    desuscripcionTtlDias,
    destinatariosTriggerMaximos,
    retencionSalidasDias
  }) {
    this.activo = Boolean(activo);
    this.operativoVerificado = Boolean(operativoVerificado);
    this.smtpHost = String(smtpHost || '').trim();
    this.smtpPuerto = Number(smtpPuerto || 0);
    this.smtpSecure = Boolean(smtpSecure);
    this.smtpUsuario = String(smtpUsuario || '').trim();
    this.smtpPassword = String(smtpPassword || '');
    this.smtpAuthMethod = String(smtpAuthMethod || '').trim().toUpperCase();
    this.smtpTimeoutConexionMs = Number(smtpTimeoutConexionMs || 0);
    this.smtpTimeoutSaludoMs = Number(smtpTimeoutSaludoMs || 0);
    this.smtpTimeoutSocketMs = Number(smtpTimeoutSocketMs || 0);
    this.smtpTlsPermitirInseguro = Boolean(smtpTlsPermitirInseguro);
    this.remitenteEmail = String(remitenteEmail || '').trim();
    this.remitenteNombre = String(remitenteNombre || '').trim();
    this.maxReintentos = Number(maxReintentos || 0);
    this.reintentoBaseSegundos = Number(reintentoBaseSegundos || 0);
    this.bloqueoTtlSegundos = Number(bloqueoTtlSegundos || 0);
    this.runtimeLoteMaximo = Number(runtimeLoteMaximo || 0);
    this.desuscripcionTtlDias = Number(desuscripcionTtlDias || 0);
    this.destinatariosTriggerMaximos = Number(destinatariosTriggerMaximos || 0);
    this.retencionSalidasDias = Number(retencionSalidasDias || 0);
  }
}
