import { normalizarMarcaUtc } from '../../utilidades/src/fechas/normalizarMarcaUtc.js';

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

function normalizarBooleanoOpcional(valor) {
  if (valor == null) {
    return null;
  }

  return Boolean(valor);
}

function extraerInterpretacionOperativa(payload = {}) {
  return {
    descripcionFallo: normalizarTexto(payload?.descripcionFallo, ''),
    posibleSolucion: normalizarTexto(payload?.posibleSolucion, ''),
    interpretacionEstado: normalizarTexto(payload?.interpretacionEstado, 'normal'),
    exitoTecnico: normalizarBooleanoOpcional(payload?.exitoTecnico),
    estadoTecnicoDetectado: normalizarTexto(payload?.estadoTecnicoDetectado, null),
    codigoResultadoTecnico: normalizarTexto(payload?.codigoResultadoTecnico, null),
    mensajeResultadoTecnico: normalizarTexto(payload?.mensajeResultadoTecnico, null),
    interpretacionResultado: payload?.interpretacionResultado || null,
    detalleErrorTecnico: payload?.detalleErrorTecnico || null
  };
}

export class EventoMonitor {
  constructor(fila) {
    this.id = normalizarEntero(fila.id, null);
    this.monitorId = normalizarEntero(fila.monitor_id, null);
    this.tenantId = normalizarEntero(fila.tenant_id, null);
    this.empresaId = normalizarEntero(fila.empresa_id, null);
    this.sitioId = normalizarEntero(fila.sitio_id, null);
    this.versionCatalogo = normalizarTexto(fila.version_catalogo, '');
    this.tipoMonitor = normalizarTexto(fila.tipo_monitor, '').toLowerCase();
    this.estadoDetectado = normalizarTexto(fila.estado_detectado, 'desconocido')
      .toLowerCase();
    this.codigoResultado = normalizarTexto(fila.codigo_resultado, 'sin_resultado');
    this.mensajeResultado = normalizarTexto(
      fila.mensaje_resultado,
      'Sin mensaje de resultado.'
    );
    this.exito = Boolean(fila.exito);
    this.duracionTotalMs = Math.max(0, normalizarEntero(fila.duracion_total_ms, 0));
    this.ejecutadoEnUtc = fila.ejecutado_en_utc || null;
    this.payloadEvento = parsearJson(fila.payload_evento);
    this.interpretacionOperativa = extraerInterpretacionOperativa(
      this.payloadEvento
    );
    this.fechaCreacion = fila.fecha_creacion || null;
  }

  serializarResumen() {
    return {
      id: this.id,
      monitorId: this.monitorId,
      tenantId: this.tenantId,
      empresaId: this.empresaId,
      sitioId: this.sitioId,
      versionCatalogo: this.versionCatalogo,
      tipoMonitor: this.tipoMonitor,
      estadoDetectado: this.estadoDetectado,
      codigoResultado: this.codigoResultado,
      mensajeResultado: this.mensajeResultado,
      exito: this.exito,
      duracionTotalMs: this.duracionTotalMs,
      ejecutadoEnUtc: normalizarMarcaUtc(this.ejecutadoEnUtc),
      ...this.interpretacionOperativa,
      payloadEvento: this.payloadEvento,
      fechaCreacion: normalizarMarcaUtc(this.fechaCreacion)
    };
  }

  serializarPersistencia() {
    return this.serializarResumen();
  }
}
