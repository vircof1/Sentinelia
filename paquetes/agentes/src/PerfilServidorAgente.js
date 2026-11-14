import { normalizarMarcaUtc } from '../../utilidades/src/fechas/normalizarMarcaUtc.js';
import {
  ESTADOS_PERFIL_SERVIDOR_AGENTE
} from './ContratoPerfilServidorAgente.js';

const ESTADOS_PERMITIDOS = new Set(
  Object.values(ESTADOS_PERFIL_SERVIDOR_AGENTE)
);

export class PerfilServidorAgente {
  constructor(fila = {}) {
    this.agenteId = normalizarEnteroPositivo(
      fila.agente_id ?? fila.agenteId,
      'agenteId'
    );
    this.generacion = normalizarEnteroPositivo(
      fila.generacion,
      'generacion'
    );
    this.estado = normalizarEstado(fila.estado);
    this.histeresisSinPolSegundos = normalizarEnteroPositivo(
      fila.histeresis_sin_pol_segundos ?? fila.histeresisSinPolSegundos,
      'histeresisSinPolSegundos'
    );
    this.duracionReinicioRecienteSegundos = normalizarEnteroPositivo(
      fila.duracion_reinicio_reciente_segundos ??
        fila.duracionReinicioRecienteSegundos,
      'duracionReinicioRecienteSegundos'
    );
    this.generadaEnUtc = normalizarMarcaUtc(
      fila.generada_en_utc ?? fila.generadaEnUtc
    );
    this.armadaEnUtc = normalizarMarcaUtc(
      fila.armada_en_utc ?? fila.armadaEnUtc
    );
    this.cerradaEnUtc = normalizarMarcaUtc(
      fila.cerrada_en_utc ?? fila.cerradaEnUtc
    );
    this.codigoCierre = normalizarTextoOpcional(
      fila.codigo_cierre ?? fila.codigoCierre
    );
    this.detalleCierre = normalizarTextoOpcional(
      fila.detalle_cierre ?? fila.detalleCierre
    );
    this.versionEstado = normalizarEnteroPositivo(
      fila.version_estado ?? fila.versionEstado ?? 1,
      'versionEstado'
    );
    this.fechaCreacion = normalizarMarcaUtc(
      fila.fecha_creacion ?? fila.fechaCreacion
    );
    this.fechaActualizacion = normalizarMarcaUtc(
      fila.fecha_actualizacion ?? fila.fechaActualizacion
    );

    if (!this.generadaEnUtc) {
      throw new Error('La generación del perfil servidor exige una fecha UTC.');
    }
  }

  estaVigente() {
    return [
      ESTADOS_PERFIL_SERVIDOR_AGENTE.PENDIENTE_PRIMERA_EVIDENCIA,
      ESTADOS_PERFIL_SERVIDOR_AGENTE.ACTIVO
    ].includes(this.estado);
  }

  serializar() {
    return {
      agenteId: this.agenteId,
      generacion: this.generacion,
      estado: this.estado,
      histeresisSinPolSegundos: this.histeresisSinPolSegundos,
      duracionReinicioRecienteSegundos:
        this.duracionReinicioRecienteSegundos,
      generadaEnUtc: this.generadaEnUtc,
      armadaEnUtc: this.armadaEnUtc,
      cerradaEnUtc: this.cerradaEnUtc,
      codigoCierre: this.codigoCierre,
      detalleCierre: this.detalleCierre,
      versionEstado: this.versionEstado,
      fechaCreacion: this.fechaCreacion,
      fechaActualizacion: this.fechaActualizacion
    };
  }
}

export function crearPerfilServidorAgenteDesdeFila(fila) {
  return fila ? new PerfilServidorAgente(fila) : null;
}

function normalizarEnteroPositivo(valor, campo) {
  const numero = Number(valor);

  if (!Number.isSafeInteger(numero) || numero <= 0) {
    throw new Error(`${campo} debe ser un entero positivo.`);
  }

  return numero;
}

function normalizarEstado(valor) {
  const estado = String(valor || '').trim();

  if (!ESTADOS_PERMITIDOS.has(estado)) {
    throw new Error(`El estado ${estado || '(vacío)'} del perfil no es válido.`);
  }

  return estado;
}

function normalizarTextoOpcional(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  return String(valor);
}
