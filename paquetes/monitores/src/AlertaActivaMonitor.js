import { normalizarMarcaUtc } from '../../utilidades/src/fechas/normalizarMarcaUtc.js';
import { bytesAUuidV7Auditoria } from '../../auditoria/src/UuidV7Auditoria.js';

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

  if (typeof valor === 'boolean') {
    return valor;
  }

  const normalizado = String(valor).trim().toLowerCase();

  if (['1', 'true', 'si', 'sí', 'yes', 'on'].includes(normalizado)) {
    return true;
  }

  if (['0', 'false', 'no', 'off'].includes(normalizado)) {
    return false;
  }

  return Boolean(valor);
}

function normalizarBooleano(valor, porDefecto = false) {
  const normalizado = normalizarBooleanoOpcional(valor);
  return normalizado == null ? porDefecto : normalizado;
}

function estaDescarteVigente({ descartadaDashboard, descartadaHastaUtc }) {
  if (!descartadaDashboard) {
    return false;
  }

  if (!descartadaHastaUtc) {
    return true;
  }

  const hastaMs = Date.parse(descartadaHastaUtc);

  if (!Number.isFinite(hastaMs)) {
    return false;
  }

  return hastaMs > Date.now();
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

export class AlertaActivaMonitor {
  constructor(fila) {
    this.monitorId = normalizarEntero(fila.monitor_id, null);
    this.alertaAuditoriaId = fila.alerta_auditoria_id
      ? bytesAUuidV7Auditoria(fila.alerta_auditoria_id, 'alertaAuditoriaId')
      : null;
    this.tenantId = normalizarEntero(fila.tenant_id, null);
    this.empresaId = normalizarEntero(fila.empresa_id, null);
    this.sitioId = normalizarEntero(fila.sitio_id, null);
    this.versionCatalogo = normalizarTexto(fila.version_catalogo, '');
    this.tipoMonitor = normalizarTexto(fila.tipo_monitor, '').toLowerCase();
    this.estadoAlerta = normalizarTexto(fila.estado_alerta, 'activa').toLowerCase();
    this.estadoDetectado = normalizarTexto(
      fila.estado_detectado,
      'indisponible'
    ).toLowerCase();
    this.codigoUltimoResultado = normalizarTexto(
      fila.codigo_ultimo_resultado,
      'sin_resultado'
    );
    this.mensajeUltimoResultado = normalizarTexto(
      fila.mensaje_ultimo_resultado,
      'Sin mensaje de resultado.'
    );
    this.validoDesdeUtc = fila.valido_desde_utc || null;
    this.ultimaConfirmacionUtc = fila.ultima_confirmacion_utc || null;
    this.ultimaEjecucionUtc = fila.ultima_ejecucion_utc || null;
    this.contadorRepeticiones = Math.max(
      1,
      normalizarEntero(fila.contador_repeticiones, 1)
    );
    this.payloadAlerta = parsearJson(fila.payload_alerta);
    this.descartadaDashboard = normalizarBooleano(
      fila.descartada_dashboard,
      false
    );
    this.motivoDescarte = normalizarTexto(fila.motivo_descarte, '');
    this.descartadaPorUsuarioId = normalizarEntero(
      fila.descartada_por_usuario_id,
      null
    );
    this.descartadaEnUtc = fila.descartada_en_utc || null;
    this.descartadaHastaUtc = fila.descartada_hasta_utc || null;
    this.interpretacionOperativa = extraerInterpretacionOperativa(
      this.payloadAlerta
    );
    this.fechaCreacion = fila.fecha_creacion || null;
    this.fechaActualizacion = fila.fecha_actualizacion || null;
  }

  obtenerDescarteOperativo() {
    const vigente = estaDescarteVigente({
      descartadaDashboard: this.descartadaDashboard,
      descartadaHastaUtc: this.descartadaHastaUtc
    });

    return {
      descartada: this.descartadaDashboard,
      vigente,
      indefinida: this.descartadaDashboard && !this.descartadaHastaUtc,
      motivo: this.motivoDescarte,
      usuarioId: this.descartadaPorUsuarioId,
      descartadaEnUtc: normalizarMarcaUtc(this.descartadaEnUtc),
      descartadaHastaUtc: normalizarMarcaUtc(this.descartadaHastaUtc)
    };
  }

  serializarResumen() {
    return {
      monitorId: this.monitorId,
      alertaAuditoriaId: this.alertaAuditoriaId,
      tenantId: this.tenantId,
      empresaId: this.empresaId,
      sitioId: this.sitioId,
      versionCatalogo: this.versionCatalogo,
      tipoMonitor: this.tipoMonitor,
      estadoAlerta: this.estadoAlerta,
      estadoDetectado: this.estadoDetectado,
      codigoUltimoResultado: this.codigoUltimoResultado,
      mensajeUltimoResultado: this.mensajeUltimoResultado,
      validoDesdeUtc: normalizarMarcaUtc(this.validoDesdeUtc),
      ultimaConfirmacionUtc: normalizarMarcaUtc(this.ultimaConfirmacionUtc),
      ultimaEjecucionUtc: normalizarMarcaUtc(this.ultimaEjecucionUtc),
      contadorRepeticiones: this.contadorRepeticiones,
      descarteOperativo: this.obtenerDescarteOperativo(),
      ...this.interpretacionOperativa,
      payloadAlerta: this.payloadAlerta,
      fechaCreacion: normalizarMarcaUtc(this.fechaCreacion),
      fechaActualizacion: normalizarMarcaUtc(this.fechaActualizacion)
    };
  }

  serializarPersistencia() {
    return this.serializarResumen();
  }
}
