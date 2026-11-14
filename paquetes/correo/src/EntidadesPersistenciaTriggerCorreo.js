import { bytesAUuidV7Auditoria }
  from '../../auditoria/src/UuidV7Auditoria.js';
import { normalizarMarcaUtc }
  from '../../utilidades/src/fechas/normalizarMarcaUtc.js';

export class DestinatarioTriggerCorreo {
  constructor(fila) {
    this.id = id(fila.id);
    this.triggerId = id(fila.trigger_id);
    this.tipo = texto(fila.tipo);
    this.usuarioId = idOpcional(fila.usuario_id);
    this.emailManualPresentacion = textoOpcional(fila.email_manual);
    this.emailManualCanonico = textoOpcional(fila.email_manual_canonico);
    this.nombreManual = textoOpcional(fila.nombre_manual);
    this.normalizacionBuzonVersion = texto(fila.normalizacion_buzon_version);
    this.estadoParticipacion = texto(fila.estado_participacion);
    this.causaUltimaDesuscripcion = textoOpcional(
      fila.causa_ultima_desuscripcion
    );
    this.desuscritaEnUtc = normalizarMarcaUtc(fila.desuscrita_en_utc);
    this.reincorporadaEnUtc = normalizarMarcaUtc(fila.reincorporada_en_utc);
    this.cambiadaEnUtc = normalizarMarcaUtc(fila.cambiada_en_utc);
    this.creadaEnUtc = normalizarMarcaUtc(fila.fecha_creacion_utc);
    this.actualizadaEnUtc = normalizarMarcaUtc(fila.fecha_actualizacion_utc);
    Object.freeze(this);
  }

  serializarPrivado() {
    return { ...this };
  }
}

export class NotificacionTriggerCorreo {
  constructor(fila) {
    this.id = id(fila.id);
    this.ejecucionTriggerId = id(fila.ejecucion_trigger_id);
    this.claveIdempotencia = hash(fila.clave_idempotencia);
    this.perfilVersion = numero(fila.perfil_version);
    this.revisionDeclaracion = id(fila.revision_declaracion);
    this.triggerId = idOpcional(fila.trigger_id);
    this.triggerIdFotografia = id(fila.trigger_id_fotografia);
    this.asignacionId = idOpcional(fila.asignacion_trigger_monitor_id);
    this.asignacionIdFotografia = id(fila.asignacion_id_fotografia);
    this.monitorId = idOpcional(fila.monitor_id);
    this.monitorIdFotografia = id(fila.monitor_id_fotografia);
    this.alertaAuditoriaId = bytesAUuidV7Auditoria(
      fila.alerta_auditoria_id,
      'alertaAuditoriaId'
    );
    this.eventoDisparo = texto(fila.evento_disparo);
    this.fechaOcurrenciaUtc = normalizarMarcaUtc(fila.fecha_ocurrencia_utc);
    this.validoDesdeUtc = normalizarMarcaUtc(fila.valido_desde_utc);
    this.nombreMonitor = texto(fila.nombre_monitor);
    this.tipoMonitor = texto(fila.tipo_monitor);
    this.estadoMonitor = texto(fila.estado_monitor);
    this.origenCausal = texto(fila.origen_causal);
    this.codigoResultado = textoOpcional(fila.codigo_resultado);
    this.mensajeResultado = textoOpcional(fila.mensaje_resultado);
    this.contextoHumano = Object.freeze({
      descripcionFallo: textoOpcional(fila.descripcion_fallo),
      posibleSolucion: textoOpcional(fila.posible_solucion)
    });
    this.scopeTrigger = scope(fila, 'scope_trigger');
    this.scopeMonitor = scope(fila, 'scope_monitor');
    this.referencias = Object.freeze({
      estadoUrl: texto(fila.referencia_estado_url),
      historicoUrl: texto(fila.referencia_historico_url)
    });
    this.definicionMensaje = Object.freeze({
      version: numero(fila.definicion_mensaje_version),
      asuntoPlantilla: texto(fila.asunto_plantilla),
      textoIntroduccion: textoOpcional(fila.texto_introduccion),
      textoCierre: textoOpcional(fila.texto_cierre)
    });
    this.mensajeMaterializado = Object.freeze({
      version: this.perfilVersion,
      renderizadorVersion: texto(fila.renderizador_version),
      asunto: texto(fila.asunto),
      cuerpoBaseTexto: texto(fila.cuerpo_base_texto),
      origenPublico: texto(fila.origen_publico),
      renderizadoEnUtc: normalizarMarcaUtc(fila.renderizado_en_utc)
    });
    this.aceptadaEnUtc = normalizarMarcaUtc(fila.aceptada_en_utc);
    Object.freeze(this);
  }

  serializarPrivado() {
    return { ...this };
  }
}

export class ResultadoDestinatarioTriggerCorreo {
  constructor(fila) {
    this.id = id(fila.id);
    this.ejecucionTriggerId = id(fila.ejecucion_trigger_id);
    this.notificacionId = idOpcional(fila.notificacion_trigger_correo_id);
    this.claveProcedencia = hash(fila.clave_procedencia);
    this.relacionDestinatarioId = idOpcional(fila.relacion_destinatario_id);
    this.tipo = texto(fila.tipo);
    this.usuarioId = idOpcional(fila.usuario_id);
    this.usuarioIdFotografia = idOpcional(fila.usuario_id_fotografia);
    this.emailManualPresentacion = textoOpcional(fila.email_manual);
    this.emailManualCanonico = textoOpcional(fila.email_manual_canonico);
    this.normalizacionBuzonVersion = texto(fila.normalizacion_buzon_version);
    this.estadoObservado = texto(fila.estado_observado);
    this.emailResueltoCanonico = textoOpcional(fila.email_resuelto_canonico);
    this.claveBuzonSha256 = hashOpcional(fila.clave_buzon_sha256);
    this.codigoInicial = texto(fila.codigo_inicial);
    this.salidaId = idOpcional(fila.salida_correo_id);
    this.creadaEnUtc = normalizarMarcaUtc(fila.creada_en_utc);
    Object.freeze(this);
  }

  serializarPrivado() {
    return { ...this };
  }
}

export class CapacidadDesuscripcionCorreo {
  constructor(fila) {
    this.id = id(fila.id);
    this.salidaId = id(fila.salida_correo_id);
    this.triggerId = idOpcional(fila.trigger_id);
    this.triggerIdFotografia = id(fila.trigger_id_fotografia);
    this.perfilVersion = numero(fila.perfil_version);
    this.tokenHashSha256 = hash(fila.token_hash_sha256);
    this.ttlDias = numero(fila.ttl_dias);
    this.estado = texto(fila.estado);
    this.emitidaEnUtc = normalizarMarcaUtc(fila.emitida_en_utc);
    this.expiraEnUtc = normalizarMarcaUtc(fila.expira_en_utc);
    this.creadaEnUtc = normalizarMarcaUtc(fila.creada_en_utc);
    Object.freeze(this);
  }

  serializarPrivado() {
    return { ...this };
  }
}

export class ArbolPersistenciaTriggerCorreo {
  constructor({ ejecucionTriggerId, notificacion, resultados, capacidades }) {
    this.ejecucionTriggerId = id(ejecucionTriggerId);
    this.notificacion = notificacion || null;
    this.resultados = Object.freeze([...resultados]);
    this.capacidades = Object.freeze([...capacidades]);
    Object.freeze(this);
  }

  serializarPrivado() {
    return {
      ejecucionTriggerId: this.ejecucionTriggerId,
      notificacion: this.notificacion?.serializarPrivado() || null,
      resultados: this.resultados.map((item) => item.serializarPrivado()),
      capacidades: this.capacidades.map((item) => item.serializarPrivado())
    };
  }
}

function scope(fila, prefijo) {
  return Object.freeze({
    nivel: texto(fila[`${prefijo}_nivel`]),
    tenantId: idOpcional(fila[`${prefijo}_tenant_id`]),
    empresaId: idOpcional(fila[`${prefijo}_empresa_id`]),
    sitioId: idOpcional(fila[`${prefijo}_sitio_id`])
  });
}

function hash(valor) {
  const normalizado = Buffer.isBuffer(valor)
    ? valor.toString('hex')
    : String(valor || '').toLowerCase();
  if (!/^[0-9a-f]{64}$/u.test(normalizado)) {
    throw new Error('La huella SQL de correo no es SHA-256.');
  }
  return normalizado;
}

function hashOpcional(valor) {
  return valor == null ? null : hash(valor);
}

function id(valor) {
  const normalizado = String(valor ?? '');
  if (!/^[1-9][0-9]*$/u.test(normalizado)) {
    throw new Error('La identidad SQL de correo no es válida.');
  }
  return normalizado;
}

function idOpcional(valor) {
  return valor == null ? null : id(valor);
}

function numero(valor) {
  const normalizado = Number(valor);
  if (!Number.isSafeInteger(normalizado) || normalizado < 0) {
    throw new Error('El entero SQL de correo no es válido.');
  }
  return normalizado;
}

function texto(valor) {
  if (typeof valor !== 'string' || valor.length === 0) {
    throw new Error('El texto SQL de correo no es válido.');
  }
  return valor;
}

function textoOpcional(valor) {
  return valor == null ? null : String(valor);
}
