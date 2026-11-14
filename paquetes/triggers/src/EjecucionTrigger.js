import { normalizarMarcaUtc } from '../../utilidades/src/fechas/normalizarMarcaUtc.js';
import { normalizarEstadoEjecucionTrigger } from './estadosEjecucionTrigger.js';

function parsearJson(valor) {
  if (!valor) {
    return null;
  }

  if (typeof valor === 'object') {
    return valor;
  }

  try {
    return JSON.parse(valor);
  } catch (_error) {
    return null;
  }
}

function normalizarTexto(valor, porDefecto = '') {
  if (valor == null || valor === '') {
    return porDefecto;
  }

  return String(valor).trim();
}

function normalizarEntero(valor, porDefecto = null) {
  const convertido = Number.parseInt(String(valor ?? ''), 10);
  return Number.isInteger(convertido) ? convertido : porDefecto;
}

function clonarJsonSeguro(valor) {
  if (!valor || typeof valor !== 'object') {
    return null;
  }

  return JSON.parse(JSON.stringify(valor));
}

function resolverNivelScope({ tenantId = null, empresaId = null, sitioId = null }) {
  if (tenantId == null && empresaId == null && sitioId == null) {
    return 'portal';
  }

  if (tenantId != null && empresaId == null && sitioId == null) {
    return 'tenant';
  }

  if (tenantId != null && empresaId != null && sitioId == null) {
    return 'empresa';
  }

  if (tenantId != null && empresaId != null && sitioId != null) {
    return 'sitio';
  }

  return 'invalido';
}

export class EjecucionTrigger {
  constructor(fila) {
    this.id = normalizarEntero(fila.id, null);
    this.asignacionTriggerMonitorId = normalizarEntero(
      fila.asignacion_trigger_monitor_id,
      null
    );
    this.triggerId = normalizarEntero(fila.trigger_id, null);
    this.monitorId = normalizarEntero(fila.monitor_id, null);
    this.tenantId = normalizarEntero(fila.tenant_id, null);
    this.empresaId = normalizarEntero(fila.empresa_id, null);
    this.sitioId = normalizarEntero(fila.sitio_id, null);
    this.monitorTenantId = normalizarEntero(
      fila.monitor_tenant_id ?? this.tenantId,
      this.tenantId
    );
    this.monitorEmpresaId = normalizarEntero(
      fila.monitor_empresa_id ?? this.empresaId,
      this.empresaId
    );
    this.monitorSitioId = normalizarEntero(
      fila.monitor_sitio_id ?? this.sitioId,
      this.sitioId
    );
    this.triggerTenantId = normalizarEntero(
      fila.trigger_tenant_id,
      null
    );
    this.triggerEmpresaId = normalizarEntero(
      fila.trigger_empresa_id,
      null
    );
    this.triggerSitioId = normalizarEntero(
      fila.trigger_sitio_id,
      null
    );
    this.versionCatalogo = normalizarTexto(fila.version_catalogo, '') || null;
    this.claveIdempotencia = normalizarTexto(fila.clave_idempotencia, '') || null;
    this.eventoDisparo = normalizarTexto(fila.evento_disparo, '').toLowerCase();
    this.estadoEjecucion = normalizarEstadoEjecucionTrigger(
      fila.estado_ejecucion,
      { porDefecto: 'pendiente' }
    );
    this.tipoTrigger = normalizarTexto(fila.tipo_trigger, '').toLowerCase();
    this.triggerNombre = normalizarTexto(fila.trigger_nombre, '');
    this.monitorNombre = normalizarTexto(fila.monitor_nombre, '') || null;
    this.codigoResultado = normalizarTexto(fila.codigo_resultado, '') || null;
    this.mensajeResultado = normalizarTexto(fila.mensaje_resultado, '') || null;
    this.payloadSolicitud = parsearJson(fila.payload_solicitud);
    this.payloadRespuesta = parsearJson(fila.payload_respuesta);
    this.payloadError = parsearJson(fila.payload_error);
    this.iniciadoEnUtc = fila.iniciado_en_utc || null;
    this.finalizadoEnUtc = fila.finalizado_en_utc || null;
    this.fechaCreacion = fila.fecha_creacion || null;
    this.fechaActualizacion = fila.fecha_actualizacion || null;
  }

  serializarResumen() {
    return {
      id: this.id,
      asignacionTriggerMonitorId: this.asignacionTriggerMonitorId,
      triggerId: this.triggerId,
      monitorId: this.monitorId,
      tenantId: this.tenantId,
      empresaId: this.empresaId,
      sitioId: this.sitioId,
      monitorTenantId: this.monitorTenantId,
      monitorEmpresaId: this.monitorEmpresaId,
      monitorSitioId: this.monitorSitioId,
      triggerTenantId: this.triggerTenantId,
      triggerEmpresaId: this.triggerEmpresaId,
      triggerSitioId: this.triggerSitioId,
      monitorScope: {
        tenantId: this.monitorTenantId,
        empresaId: this.monitorEmpresaId,
        sitioId: this.monitorSitioId,
        nivelPertenencia: resolverNivelScope({
          tenantId: this.monitorTenantId,
          empresaId: this.monitorEmpresaId,
          sitioId: this.monitorSitioId
        })
      },
      triggerScope: {
        tenantId: this.triggerTenantId,
        empresaId: this.triggerEmpresaId,
        sitioId: this.triggerSitioId,
        nivelPertenencia: resolverNivelScope({
          tenantId: this.triggerTenantId,
          empresaId: this.triggerEmpresaId,
          sitioId: this.triggerSitioId
        })
      },
      versionCatalogo: this.versionCatalogo,
      claveIdempotencia: this.claveIdempotencia,
      eventoDisparo: this.eventoDisparo,
      estadoEjecucion: this.estadoEjecucion,
      tipoTrigger: this.tipoTrigger,
      triggerNombre: this.triggerNombre,
      monitorNombre: this.monitorNombre,
      codigoResultado: this.codigoResultado,
      mensajeResultado: this.mensajeResultado,
      payloadSolicitud: clonarJsonSeguro(this.payloadSolicitud),
      payloadRespuesta: clonarJsonSeguro(this.payloadRespuesta),
      payloadError: clonarJsonSeguro(this.payloadError),
      iniciadoEnUtc: normalizarMarcaUtc(this.iniciadoEnUtc),
      finalizadoEnUtc: normalizarMarcaUtc(this.finalizadoEnUtc),
      fechaCreacion: normalizarMarcaUtc(this.fechaCreacion),
      fechaActualizacion: normalizarMarcaUtc(this.fechaActualizacion)
    };
  }

  serializarPersistencia() {
    const resumen = this.serializarResumen();

    return {
      id: resumen.id,
      asignacionTriggerMonitorId: resumen.asignacionTriggerMonitorId,
      triggerId: resumen.triggerId,
      monitorId: resumen.monitorId,
      tenantId: resumen.tenantId,
      empresaId: resumen.empresaId,
      sitioId: resumen.sitioId,
      monitorTenantId: resumen.monitorTenantId,
      monitorEmpresaId: resumen.monitorEmpresaId,
      monitorSitioId: resumen.monitorSitioId,
      triggerTenantId: resumen.triggerTenantId,
      triggerEmpresaId: resumen.triggerEmpresaId,
      triggerSitioId: resumen.triggerSitioId,
      versionCatalogo: resumen.versionCatalogo,
      claveIdempotencia: resumen.claveIdempotencia,
      eventoDisparo: resumen.eventoDisparo,
      estadoEjecucion: resumen.estadoEjecucion,
      tipoTrigger: resumen.tipoTrigger,
      triggerNombre: resumen.triggerNombre,
      monitorNombre: resumen.monitorNombre,
      codigoResultado: resumen.codigoResultado,
      mensajeResultado: resumen.mensajeResultado,
      payloadSolicitud: resumen.payloadSolicitud,
      payloadRespuesta: resumen.payloadRespuesta,
      payloadError: resumen.payloadError,
      iniciadoEnUtc: resumen.iniciadoEnUtc,
      finalizadoEnUtc: resumen.finalizadoEnUtc
    };
  }
}
