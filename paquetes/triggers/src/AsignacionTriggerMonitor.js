import { normalizarMarcaUtc } from '../../utilidades/src/fechas/normalizarMarcaUtc.js';
import { normalizarEventosDisparoTrigger } from './eventosDisparoTrigger.js';

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
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) {
    return null;
  }

  return JSON.parse(JSON.stringify(valor));
}

export class AsignacionTriggerMonitor {
  constructor(fila) {
    this.id = normalizarEntero(fila.id, null);
    this.monitorId = normalizarEntero(fila.monitor_id, null);
    this.triggerId = normalizarEntero(fila.trigger_id, null);
    this.activo = Boolean(fila.activo);
    this.ordenEjecucion = Math.max(
      0,
      normalizarEntero(fila.orden_ejecucion, 100)
    );
    this.eventosDisparo = normalizarEventosDisparoTrigger(
      parsearJson(fila.eventos_disparo),
      { porDefecto: ['apertura_alerta'] }
    );
    this.configuracionOverride = parsearJson(fila.configuracion_override);
    this.fechaCreacion = fila.fecha_creacion || null;
    this.fechaActualizacion = fila.fecha_actualizacion || null;
    this.monitorNombre = normalizarTexto(fila.monitor_nombre, '');
    this.monitorTipo = normalizarTexto(fila.monitor_tipo, '').toLowerCase();
    this.monitorActivo =
      fila.monitor_activo === undefined || fila.monitor_activo === null
        ? null
        : Boolean(fila.monitor_activo);
    this.tenantId = normalizarEntero(fila.tenant_id, null);
    this.empresaId = normalizarEntero(fila.empresa_id, null);
    this.sitioId = normalizarEntero(fila.sitio_id, null);
    this.tenantNombre = normalizarTexto(fila.tenant_nombre, '') || null;
    this.empresaNombre = normalizarTexto(fila.empresa_nombre, '') || null;
    this.sitioNombre = normalizarTexto(fila.sitio_nombre, '') || null;
    this.triggerNombre = normalizarTexto(fila.trigger_nombre, '');
    this.triggerTipo = normalizarTexto(fila.trigger_tipo, '').toLowerCase();
    this.triggerDescripcion = normalizarTexto(fila.trigger_descripcion, '') || null;
    this.triggerActivo =
      fila.trigger_activo === undefined || fila.trigger_activo === null
        ? null
        : Boolean(fila.trigger_activo);
  }

  serializarResumen() {
    return {
      id: this.id,
      monitorId: this.monitorId,
      triggerId: this.triggerId,
      activo: this.activo,
      ordenEjecucion: this.ordenEjecucion,
      eventosDisparo: [...this.eventosDisparo],
      configuracionOverride: clonarJsonSeguro(this.configuracionOverride),
      fechaCreacion: normalizarMarcaUtc(this.fechaCreacion),
      fechaActualizacion: normalizarMarcaUtc(this.fechaActualizacion),
      monitorNombre: this.monitorNombre,
      monitorTipo: this.monitorTipo,
      monitorActivo: this.monitorActivo,
      tenantId: this.tenantId,
      empresaId: this.empresaId,
      sitioId: this.sitioId,
      tenantNombre: this.tenantNombre,
      empresaNombre: this.empresaNombre,
      sitioNombre: this.sitioNombre,
      triggerNombre: this.triggerNombre,
      triggerTipo: this.triggerTipo,
      triggerDescripcion: this.triggerDescripcion,
      triggerActivo: this.triggerActivo
    };
  }

  serializarPersistencia() {
    return {
      id: this.id,
      monitorId: this.monitorId,
      triggerId: this.triggerId,
      activo: this.activo,
      ordenEjecucion: this.ordenEjecucion,
      eventosDisparo: [...this.eventosDisparo],
      configuracionOverride: clonarJsonSeguro(this.configuracionOverride)
    };
  }
}
