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

export class TramoHistoricoMonitor {
  constructor(fila) {
    this.id = normalizarEntero(fila.id, null);
    this.monitorId = normalizarEntero(fila.monitor_id, null);
    this.tenantId = normalizarEntero(fila.tenant_id, null);
    this.empresaId = normalizarEntero(fila.empresa_id, null);
    this.sitioId = normalizarEntero(fila.sitio_id, null);
    this.versionCatalogo = normalizarTexto(fila.version_catalogo, '');
    this.tipoMonitor = normalizarTexto(fila.tipo_monitor, '').toLowerCase();
    this.estadoTramo = normalizarTexto(fila.estado_tramo, 'desconocido').toLowerCase();
    this.codigoUltimoResultado = normalizarTexto(
      fila.codigo_ultimo_resultado,
      'sin_resultado'
    );
    this.mensajeUltimoResultado = normalizarTexto(
      fila.mensaje_ultimo_resultado,
      'Sin mensaje de resultado.'
    );
    this.validoDesdeUtc = fila.valido_desde_utc || null;
    this.validoHastaUtc = fila.valido_hasta_utc || null;
    this.contadorRepeticiones = Math.max(
      1,
      normalizarEntero(fila.contador_repeticiones, 1)
    );
    this.ultimoEventoId = normalizarEntero(fila.ultimo_evento_id, null);
    this.payloadTramo = parsearJson(fila.payload_tramo);
    this.interpretacionOperativa = extraerInterpretacionOperativa(
      this.payloadTramo
    );
    this.fechaCreacion = fila.fecha_creacion || null;
    this.fechaActualizacion = fila.fecha_actualizacion || null;
    this.monitorNombre = normalizarTexto(
      fila.monitor_nombre,
      this.payloadTramo?.nombreMonitor || ''
    );
    this.tenantNombre = normalizarTexto(fila.tenant_nombre, '');
    this.empresaNombre = normalizarTexto(fila.empresa_nombre, '');
    this.sitioNombre = normalizarTexto(fila.sitio_nombre, '');
    this.monitorActivo = fila.monitor_activo == null
      ? null
      : Boolean(normalizarEntero(fila.monitor_activo, 0));
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
      estadoTramo: this.estadoTramo,
      codigoUltimoResultado: this.codigoUltimoResultado,
      mensajeUltimoResultado: this.mensajeUltimoResultado,
      validoDesdeUtc: normalizarMarcaUtc(this.validoDesdeUtc),
      validoHastaUtc: normalizarMarcaUtc(this.validoHastaUtc),
      contadorRepeticiones: this.contadorRepeticiones,
      ultimoEventoId: this.ultimoEventoId,
      ...this.interpretacionOperativa,
      payloadTramo: this.payloadTramo,
      fechaCreacion: normalizarMarcaUtc(this.fechaCreacion),
      fechaActualizacion: normalizarMarcaUtc(this.fechaActualizacion),
      monitorNombre: this.monitorNombre || null,
      tenantNombre: this.tenantNombre || null,
      empresaNombre: this.empresaNombre || null,
      sitioNombre: this.sitioNombre || null,
      monitorActivo: this.monitorActivo
    };
  }

  serializarPersistencia() {
    return this.serializarResumen();
  }
}
