import { normalizarMarcaUtc } from '../../utilidades/src/fechas/normalizarMarcaUtc.js';
import { bytesAUuidV7Auditoria } from '../../auditoria/src/UuidV7Auditoria.js';

export class CorreoPendiente {
  constructor(fila) {
    this.id = fila.id;
    this.origenTipo = fila.origen_tipo || 'prueba';
    this.productorVersion = fila.productor_version || 'legacy';
    this.notificacionTriggerCorreoId = fila.notificacion_trigger_correo_id == null
      ? null
      : String(fila.notificacion_trigger_correo_id);
    this.ejecucionTriggerId = fila.ejecucion_trigger_id == null
      ? null
      : String(fila.ejecucion_trigger_id);
    this.propositoRecuperacionPassword =
      fila.proposito_recuperacion_password ?? null;
    this.solicitudRecuperacionPasswordId = uuidOpcional(
      fila.solicitud_recuperacion_password_id,
      'solicitudRecuperacionPasswordId'
    );
    this.eventoEmisionRecuperacionPasswordId = uuidOpcional(
      fila.evento_emision_recuperacion_password_id,
      'eventoEmisionRecuperacionPasswordId'
    );
    this.claveOperacionRecuperacionPasswordSha256 =
      fila.clave_operacion_recuperacion_password_sha256
        ? Buffer.from(fila.clave_operacion_recuperacion_password_sha256).toString('hex')
        : null;
    this.direccionIpOrigen = fila.direccion_ip_origen ?? null;
    this.materialPreparacionRecuperacionPassword = parsearJsonOpcional(
      fila.material_preparacion_recuperacion_password
    );
    this.reinicioPasswordAdministrativoId = uuidOpcional(
      fila.reinicio_password_administrativo_id,
      'reinicioPasswordAdministrativoId'
    );
    this.operacionEmailPerfilId = uuidCanonicoOpcional(
      fila.operacion_email_perfil_id,
      'operacionEmailPerfilId'
    );
    this.emisionEmailPerfilId = uuidOpcional(
      fila.emision_email_perfil_id,
      'emisionEmailPerfilId'
    );
    this.claseEmisionEmailPerfil = fila.clase_emision_email_perfil ?? null;
    this.destinatarioEmail = fila.destinatario_email;
    this.destinatarioNombre = fila.destinatario_nombre;
    this.normalizacionBuzonVersion = fila.normalizacion_buzon_version ?? null;
    this.claveBuzonSha256 = fila.clave_buzon_sha256
      ? Buffer.from(fila.clave_buzon_sha256).toString('hex')
      : null;
    this.modoRemitente = fila.modo_remitente || 'fotografiado';
    this.remitenteEmail = fila.remitente_email;
    this.remitenteNombre = fila.remitente_nombre;
    this.asunto = fila.asunto;
    this.cuerpoTexto = fila.cuerpo_texto;
    this.smtpMessageId = fila.smtp_message_id ?? null;
    this.estado = fila.estado;
    this.intentos = fila.intentos;
    this.errorUltimo = fila.error_ultimo;
    this.proximoIntentoEn = fila.proximo_intento_en;
    this.creadoPorUsuarioId = fila.creado_por_usuario_id;
    this.fechaCreacion = fila.fecha_creacion;
    this.fechaActualizacion = fila.fecha_actualizacion;
    this.fechaUltimoIntento = fila.fecha_ultimo_intento;
    this.fechaEnvio = fila.fecha_envio;
    this.estadoPrevioReclamacion = fila.estado_previo_reclamacion ?? null;
    this.claimId = fila.claim_id ? Buffer.from(fila.claim_id).toString('hex') : null;
    this.propietarioClaim = fila.propietario_claim ?? null;
    this.leaseToken = fila.lease_token
      ? Buffer.from(fila.lease_token).toString('hex')
      : null;
    this.leaseExpiraUtc = fila.lease_expira_utc ?? null;
    this.fencingToken = String(fila.fencing_token ?? 0);
    this.reclamadaEnUtc = fila.reclamada_en_utc ?? null;
    this.enviandoEnUtc = fila.enviando_en_utc ?? null;
    this.configuracionVersionUltimoIntento =
      fila.configuracion_version_ultimo_intento == null
        ? null
        : String(fila.configuracion_version_ultimo_intento);
    this.codigoResultado = fila.codigo_resultado ?? null;
    this.causaDescarte = fila.causa_descarte ?? null;
    this.respuestaSaneada = fila.respuesta_saneada ?? null;
    this.fechaTerminalUtc = fila.fecha_terminal_utc ?? null;
  }

  serializarResumen() {
    return {
      id: this.id,
      destinatarioEmail: this.destinatarioEmail,
      destinatarioNombre: this.destinatarioNombre,
      remitenteEmail: this.remitenteEmail,
      remitenteNombre: this.remitenteNombre,
      asunto: this.asunto,
      estado: this.estado,
      intentos: this.intentos,
      errorUltimo: this.errorUltimo,
      proximoIntentoEn: normalizarMarcaUtc(this.proximoIntentoEn),
      creadoPorUsuarioId: this.creadoPorUsuarioId,
      fechaCreacion: normalizarMarcaUtc(this.fechaCreacion),
      fechaActualizacion: normalizarMarcaUtc(this.fechaActualizacion),
      fechaUltimoIntento: normalizarMarcaUtc(this.fechaUltimoIntento),
      fechaEnvio: normalizarMarcaUtc(this.fechaEnvio)
    };
  }
}

function uuidOpcional(valor, campo) {
  return valor == null
    ? null
    : bytesAUuidV7Auditoria(Buffer.from(valor), campo);
}

function uuidCanonicoOpcional(valor, campo) {
  if (valor == null) return null;
  const hex = Buffer.from(valor).toString('hex');
  if (hex.length !== 32) {
    throw new Error(`${campo} binario debe contener exactamente 16 bytes.`);
  }
  const uuid = [
    hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16),
    hex.slice(16, 20), hex.slice(20)
  ].join('-');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
    .test(uuid)) {
    throw new Error(`${campo} no es un UUID canónico.`);
  }
  return uuid;
}

function parsearJsonOpcional(valor) {
  if (valor == null) return null;
  const parseado = typeof valor === 'object' && !Buffer.isBuffer(valor)
    ? structuredClone(valor)
    : JSON.parse(String(valor));
  if (!parseado || typeof parseado !== 'object' || Array.isArray(parseado)) {
    throw new Error('El material privado de preparación no es un objeto JSON.');
  }
  return Object.freeze(parseado);
}
