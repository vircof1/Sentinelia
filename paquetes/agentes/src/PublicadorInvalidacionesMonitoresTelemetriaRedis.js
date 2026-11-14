const TIPO_AVISO_FOTOGRAFIAS = 'fotografias_telemetria_actualizadas';
const TIPO_AVISO_REGLAS = 'estados_reglas_telemetria_actualizados';

export class PublicadorInvalidacionesMonitoresTelemetriaRedis {
  constructor({
    clienteRedis,
    canal = 'sentinelia:runtime:telemetria:monitores:invalidacion',
    reloj = () => new Date()
  } = {}) {
    if (!clienteRedis || typeof clienteRedis.publish !== 'function') {
      throw new Error('El cliente Redis de invalidaciones de monitores es obligatorio.');
    }
    this.clienteRedis = clienteRedis;
    this.canal = String(canal || '').trim();
    this.reloj = reloj;
    if (!this.canal) {
      throw new Error('El canal Redis de invalidaciones de monitores es obligatorio.');
    }
  }

  async publicarFotografiasActualizadas({ fotografias = [] } = {}) {
    const senales = normalizarSenales(fotografias);
    if (senales.length === 0) {
      return { publicado: false, receptores: 0, totalSenales: 0 };
    }
    const receptores = await this.clienteRedis.publish(
      this.canal,
      JSON.stringify({
        tipo: TIPO_AVISO_FOTOGRAFIAS,
        totalSenales: senales.length,
        senales,
        publicadoEnUtc: this.reloj().toISOString()
      })
    );
    return {
      publicado: true,
      receptores: Number(receptores || 0),
      totalSenales: senales.length
    };
  }

  async publicarEstadosReglasActualizados({ estados = [] } = {}) {
    const reglas = normalizarReglas(estados);
    if (reglas.length === 0) {
      return { publicado: false, receptores: 0, totalReglas: 0 };
    }
    const receptores = await this.clienteRedis.publish(
      this.canal,
      JSON.stringify({
        tipo: TIPO_AVISO_REGLAS,
        totalReglas: reglas.length,
        reglas,
        publicadoEnUtc: this.reloj().toISOString()
      })
    );
    return {
      publicado: true,
      receptores: Number(receptores || 0),
      totalReglas: reglas.length
    };
  }
}

function normalizarSenales(fotografias) {
  const unicas = new Map();
  for (const fotografia of Array.isArray(fotografias) ? fotografias : []) {
    const agenteId = normalizarId(fotografia?.agenteId);
    const senalId = normalizarId(fotografia?.senalId);
    if (!agenteId || !senalId) {
      continue;
    }
    unicas.set(`${agenteId}:${senalId}`, {
      agenteId,
      senalId,
      ultimaObservacionId: normalizarId(fotografia?.ultimaObservacionId)
    });
  }
  return [...unicas.values()];
}

function normalizarReglas(estados) {
  const unicas = new Map();
  for (const estado of Array.isArray(estados) ? estados : []) {
    const reglaId = normalizarId(estado?.reglaId);
    if (!reglaId) {
      continue;
    }
    unicas.set(reglaId, {
      reglaId,
      revisionId: normalizarId(estado?.revisionId),
      observacionId: normalizarId(estado?.observacionId)
    });
  }
  return [...unicas.values()];
}

function normalizarId(valor) {
  if (typeof valor === 'boolean' || String(valor ?? '').trim() === '') {
    return null;
  }
  const id = Number(valor);
  return Number.isInteger(id) && id > 0 ? id : null;
}
