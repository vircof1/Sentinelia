import { normalizarMarcaUtc } from '../../utilidades/src/fechas/normalizarMarcaUtc.js';

export class EstadoRuntimeServidorAgente {
  constructor(fila = {}) {
    this.agenteId = enteroPositivo(fila.agente_id ?? fila.agenteId, 'agenteId');
    this.generacion = enteroPositivo(fila.generacion, 'generacion');
    this.bootIdReferencia = textoOpcional(
      fila.boot_id_referencia ?? fila.bootIdReferencia
    );
    this.ultimoPeriodoPolId = enteroPositivoONulo(
      fila.ultimo_periodo_pol_id ?? fila.ultimoPeriodoPolId,
      'ultimoPeriodoPolId'
    );
    this.ultimoSeq = enteroNoNegativoONulo(
      fila.ultimo_seq ?? fila.ultimoSeq,
      'ultimoSeq'
    );
    this.ultimoPolUtc = normalizarMarcaUtc(
      fila.ultimo_pol_utc ?? fila.ultimoPolUtc
    );
    this.tipoUltimoPol = tipoPolOpcional(
      fila.tipo_ultimo_pol ?? fila.tipoUltimoPol
    );
    this.valorSinPol = booleanoONulo(fila.valor_sin_pol ?? fila.valorSinPol);
    this.venceSinPolUtc = normalizarMarcaUtc(
      fila.vence_sin_pol_utc ?? fila.venceSinPolUtc
    );
    this.histeresisSinPolCapturadaSegundos = enteroPositivoONulo(
      fila.histeresis_sin_pol_capturada_segundos ??
        fila.histeresisSinPolCapturadaSegundos,
      'histeresisSinPolCapturadaSegundos'
    );
    this.valorReinicioReciente = booleanoONulo(
      fila.valor_reinicio_reciente ?? fila.valorReinicioReciente
    );
    this.venceReinicioRecienteUtc = normalizarMarcaUtc(
      fila.vence_reinicio_reciente_utc ?? fila.venceReinicioRecienteUtc
    );
    this.duracionReinicioCapturadaSegundos = enteroPositivoONulo(
      fila.duracion_reinicio_capturada_segundos ??
        fila.duracionReinicioCapturadaSegundos,
      'duracionReinicioCapturadaSegundos'
    );
    this.ultimoCambioBootIdUtc = normalizarMarcaUtc(
      fila.ultimo_cambio_boot_id_utc ?? fila.ultimoCambioBootIdUtc
    );
    this.checkpointCausal = textoOpcional(
      fila.checkpoint_causal ?? fila.checkpointCausal
    );
    this.versionEstado = enteroPositivo(
      fila.version_estado ?? fila.versionEstado ?? 1,
      'versionEstado'
    );
    this.fechaCreacion = normalizarMarcaUtc(
      fila.fecha_creacion ?? fila.fechaCreacion
    );
    this.fechaActualizacion = normalizarMarcaUtc(
      fila.fecha_actualizacion ?? fila.fechaActualizacion
    );

    if (this.venceSinPolUtc && !this.histeresisSinPolCapturadaSegundos) {
      throw new Error('El vencimiento sin POL exige una histéresis capturada.');
    }
    if (this.venceReinicioRecienteUtc && !this.duracionReinicioCapturadaSegundos) {
      throw new Error('El vencimiento de reinicio exige una duración capturada.');
    }
  }

  tieneFotografia() {
    return typeof this.valorSinPol === 'boolean' &&
      typeof this.valorReinicioReciente === 'boolean';
  }

  serializar() {
    return {
      agenteId: this.agenteId,
      generacion: this.generacion,
      bootIdReferencia: this.bootIdReferencia,
      ultimoPeriodoPolId: this.ultimoPeriodoPolId,
      ultimoSeq: this.ultimoSeq,
      ultimoPolUtc: this.ultimoPolUtc,
      tipoUltimoPol: this.tipoUltimoPol,
      valorSinPol: this.valorSinPol,
      venceSinPolUtc: this.venceSinPolUtc,
      histeresisSinPolCapturadaSegundos:
        this.histeresisSinPolCapturadaSegundos,
      valorReinicioReciente: this.valorReinicioReciente,
      venceReinicioRecienteUtc: this.venceReinicioRecienteUtc,
      duracionReinicioCapturadaSegundos:
        this.duracionReinicioCapturadaSegundos,
      ultimoCambioBootIdUtc: this.ultimoCambioBootIdUtc,
      checkpointCausal: this.checkpointCausal,
      versionEstado: this.versionEstado,
      fechaCreacion: this.fechaCreacion,
      fechaActualizacion: this.fechaActualizacion
    };
  }
}

export function crearEstadoRuntimeServidorAgenteDesdeFila(fila) {
  return fila ? new EstadoRuntimeServidorAgente(fila) : null;
}

export class TransicionRuntimeServidorAgente {
  constructor(fila = {}) {
    this.id = enteroPositivo(fila.id, 'id');
    this.agenteId = enteroPositivo(fila.agente_id ?? fila.agenteId, 'agenteId');
    this.generacion = enteroPositivo(fila.generacion, 'generacion');
    this.claveCausal = textoObligatorio(
      fila.clave_causal ?? fila.claveCausal,
      'claveCausal'
    );
    this.codigoSenal = textoObligatorio(
      fila.codigo_senal ?? fila.codigoSenal,
      'codigoSenal'
    );
    this.valor = booleanoONulo(fila.valor_booleano ?? fila.valor);
    this.causa = textoObligatorio(fila.causa, 'causa');
    this.efectivaEnUtc = normalizarMarcaUtc(
      fila.efectiva_en_utc ?? fila.efectivaEnUtc
    );
    this.materializadaEnUtc = normalizarMarcaUtc(
      fila.materializada_en_utc ?? fila.materializadaEnUtc
    );
    this.checkpointCausal = textoObligatorio(
      fila.checkpoint_causal ?? fila.checkpointCausal,
      'checkpointCausal'
    );
    this.observacionTelemetriaId = enteroPositivoONulo(
      fila.observacion_telemetria_id ?? fila.observacionTelemetriaId,
      'observacionTelemetriaId'
    );

    if (typeof this.valor !== 'boolean' || !this.efectivaEnUtc) {
      throw new Error('La transición runtime no está completa.');
    }
  }

  estaMaterializada() {
    return Boolean(this.materializadaEnUtc && this.observacionTelemetriaId);
  }

  serializar() {
    return {
      id: this.id,
      agenteId: this.agenteId,
      generacion: this.generacion,
      claveCausal: this.claveCausal,
      codigoSenal: this.codigoSenal,
      valor: this.valor,
      causa: this.causa,
      efectivaEnUtc: this.efectivaEnUtc,
      materializadaEnUtc: this.materializadaEnUtc,
      checkpointCausal: this.checkpointCausal,
      observacionTelemetriaId: this.observacionTelemetriaId
    };
  }
}

export function crearTransicionRuntimeServidorAgenteDesdeFila(fila) {
  return fila ? new TransicionRuntimeServidorAgente(fila) : null;
}

export class EvidenciaPolServidorAgente {
  constructor(fila = {}) {
    this.periodoVidaPolId = enteroPositivo(
      fila.id ?? fila.periodo_vida_pol_id ?? fila.periodoVidaPolId,
      'periodoVidaPolId'
    );
    this.agenteId = enteroPositivo(
      fila.agente_id ?? fila.agenteId,
      'agenteId'
    );
    this.bootId = textoObligatorio(fila.boot_id ?? fila.bootId, 'bootId');
    this.inicioUtc = normalizarMarcaUtc(fila.inicio_utc ?? fila.inicioUtc);
    this.ultimoHeartbeatUtc = normalizarMarcaUtc(
      fila.ultimo_heartbeat_utc ?? fila.ultimoHeartbeatUtc
    );
    this.ultimoSeq = enteroNoNegativoONulo(
      fila.ultimo_seq ?? fila.ultimoSeq,
      'ultimoSeq'
    );
    this.heartbeatsRecibidos = enteroNoNegativo(
      fila.heartbeats_recibidos ?? fila.heartbeatsRecibidos ?? 0,
      'heartbeatsRecibidos'
    );

    if (!this.inicioUtc) {
      throw new Error('La evidencia POL exige el inicio durable de su periodo.');
    }
    if (this.heartbeatsRecibidos > 0 && !this.ultimoHeartbeatUtc) {
      throw new Error('La evidencia POL declara heartbeats sin su última fecha.');
    }
    if (this.ultimoHeartbeatUtc && this.ultimoSeq === null) {
      throw new Error('La evidencia POL con heartbeat exige una secuencia durable.');
    }
  }

  obtenerUltimaPresencia() {
    if (this.ultimoHeartbeatUtc) {
      return Object.freeze({
        tipo: 'heartbeat',
        observadoEnUtc: this.ultimoHeartbeatUtc,
        seq: this.ultimoSeq
      });
    }
    return Object.freeze({
      tipo: 'login',
      observadoEnUtc: this.inicioUtc,
      seq: null
    });
  }

  obtenerPrimeraPresenciaPosterior(marcaUtc) {
    const limite = Date.parse(String(marcaUtc || ''));
    if (!Number.isFinite(limite)) {
      throw new Error('La marca causal del perfil servidor no es válida.');
    }
    if (Date.parse(this.inicioUtc) > limite) {
      return Object.freeze({
        tipo: 'login',
        observadoEnUtc: this.inicioUtc,
        seq: null
      });
    }
    if (this.ultimoHeartbeatUtc && Date.parse(this.ultimoHeartbeatUtc) > limite) {
      return Object.freeze({
        tipo: 'heartbeat',
        observadoEnUtc: this.ultimoHeartbeatUtc,
        seq: this.ultimoSeq
      });
    }
    return null;
  }

  serializar() {
    return {
      periodoVidaPolId: this.periodoVidaPolId,
      agenteId: this.agenteId,
      bootId: this.bootId,
      inicioUtc: this.inicioUtc,
      ultimoHeartbeatUtc: this.ultimoHeartbeatUtc,
      ultimoSeq: this.ultimoSeq,
      heartbeatsRecibidos: this.heartbeatsRecibidos
    };
  }
}

export function crearEvidenciaPolServidorAgenteDesdeFila(fila) {
  return fila ? new EvidenciaPolServidorAgente(fila) : null;
}

function enteroPositivo(valor, campo) {
  const numero = Number(valor);
  if (!Number.isSafeInteger(numero) || numero <= 0) {
    throw new Error(`${campo} debe ser un entero positivo.`);
  }
  return numero;
}

function enteroPositivoONulo(valor, campo) {
  return valor === null || valor === undefined
    ? null
    : enteroPositivo(valor, campo);
}

function enteroNoNegativoONulo(valor, campo) {
  if (valor === null || valor === undefined) return null;
  const numero = Number(valor);
  if (!Number.isSafeInteger(numero) || numero < 0) {
    throw new Error(`${campo} debe ser un entero no negativo.`);
  }
  return numero;
}

function enteroNoNegativo(valor, campo) {
  const numero = Number(valor);
  if (!Number.isSafeInteger(numero) || numero < 0) {
    throw new Error(`${campo} debe ser un entero no negativo.`);
  }
  return numero;
}

function booleanoONulo(valor) {
  if (valor === null || valor === undefined) return null;
  if (valor === true || Number(valor) === 1) return true;
  if (valor === false || Number(valor) === 0) return false;
  throw new Error('El valor runtime debe ser booleano o null.');
}

function textoOpcional(valor) {
  const texto = String(valor ?? '').trim();
  return texto || null;
}

function textoObligatorio(valor, campo) {
  const texto = textoOpcional(valor);
  if (!texto) throw new Error(`${campo} es obligatorio.`);
  return texto;
}

function tipoPolOpcional(valor) {
  const tipo = textoOpcional(valor);
  if (tipo !== null && !['login', 'heartbeat'].includes(tipo)) {
    throw new Error(`El tipo de POL ${tipo} no es válido.`);
  }
  return tipo;
}
