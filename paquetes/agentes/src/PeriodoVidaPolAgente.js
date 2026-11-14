import { normalizarMarcaUtc } from '../../utilidades/src/fechas/normalizarMarcaUtc.js';
import { bytesAUuidV7Auditoria } from '../../auditoria/src/UuidV7Auditoria.js';

function normalizarEntero(valor, porDefecto = null) {
  const convertido = Number.parseInt(String(valor ?? ''), 10);
  return Number.isInteger(convertido) ? convertido : porDefecto;
}

export class PeriodoVidaPolAgente {
  constructor(fila) {
    this.id = fila.id;
    this.agenteId = fila.agente_id;
    this.sesionIdDiagnostico = fila.sesion_id_diagnostico || null;
    this.sesionHuellaSha256 = fila.sesion_huella_sha256 || null;
    this.sesionAuditoriaId = fila.sesion_auditoria_id
      ? bytesAUuidV7Auditoria(fila.sesion_auditoria_id, 'sesionAuditoriaId')
      : null;
    this.bootId = fila.boot_id || null;
    this.inicioUtc = normalizarMarcaUtc(fila.inicio_utc);
    this.finUtc = normalizarMarcaUtc(fila.fin_utc);
    this.heartbeatsRecibidos = normalizarEntero(
      fila.heartbeats_recibidos,
      0
    );
    this.ultimoHeartbeatUtc = normalizarMarcaUtc(fila.ultimo_heartbeat_utc);
    this.ultimoSeq = normalizarEntero(fila.ultimo_seq, null);
    this.motivoCierre = fila.motivo_cierre || null;
    this.fechaCreacion = normalizarMarcaUtc(fila.fecha_creacion);
    this.fechaActualizacion = normalizarMarcaUtc(fila.fecha_actualizacion);
  }

  estaAbierto() {
    return this.finUtc == null;
  }

  serializar() {
    return {
      id: this.id,
      agenteId: this.agenteId,
      sesionIdDiagnostico: this.sesionIdDiagnostico,
      sesionHuellaSha256: this.sesionHuellaSha256,
      sesionAuditoriaId: this.sesionAuditoriaId,
      bootId: this.bootId,
      inicioUtc: this.inicioUtc,
      finUtc: this.finUtc,
      heartbeatsRecibidos: this.heartbeatsRecibidos,
      ultimoHeartbeatUtc: this.ultimoHeartbeatUtc,
      ultimoSeq: this.ultimoSeq,
      motivoCierre: this.motivoCierre,
      abierto: this.estaAbierto(),
      fechaCreacion: this.fechaCreacion,
      fechaActualizacion: this.fechaActualizacion
    };
  }
}

export function crearPeriodoVidaPolAgenteDesdeFila(fila) {
  return fila ? new PeriodoVidaPolAgente(fila) : null;
}
