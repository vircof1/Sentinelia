const TIPO_AVISO_FOTOGRAFIAS = 'fotografias_telemetria_actualizadas';
const TIPO_AVISO_REGLAS = 'estados_reglas_telemetria_actualizados';

export class SuscriptorInvalidacionesMonitoresTelemetriaRedis {
  constructor({ clienteRedis, canal, onInvalidacion } = {}) {
    if (!clienteRedis || typeof clienteRedis.duplicate !== 'function') {
      throw new Error('El suscriptor requiere un cliente Redis duplicable.');
    }
    if (typeof onInvalidacion !== 'function') {
      throw new Error('El suscriptor requiere un procesador de invalidaciones.');
    }
    this.clienteRedis = clienteRedis;
    this.canal = String(canal || '').trim();
    this.onInvalidacion = onInvalidacion;
    if (!this.canal) {
      throw new Error('El canal Redis de invalidaciones es obligatorio.');
    }
    this.clienteSuscriptor = null;
    this.totalAvisos = 0;
    this.ultimoAvisoEnUtc = null;
    this.colaInvalidaciones = Promise.resolve();
  }

  async arrancar() {
    if (this.clienteSuscriptor) {
      return this.serializarResumen();
    }
    const cliente = this.clienteRedis.duplicate();
    cliente.on('error', (error) => {
      console.error('[sentinelia-runtime] Error en invalidaciones de monitores de telemetría');
      console.error(error);
    });
    try {
      await cliente.connect();
      await cliente.subscribe(this.canal, (mensaje) => this.recibirAviso(mensaje));
      this.clienteSuscriptor = cliente;
      return this.serializarResumen();
    } catch (error) {
      if (cliente.isOpen) {
        await cliente.quit();
      }
      throw error;
    }
  }

  recibirAviso(mensaje) {
    const aviso = parsearAviso(mensaje);
    if (!aviso) {
      return;
    }
    this.totalAvisos += 1;
    this.ultimoAvisoEnUtc = new Date().toISOString();
    this.colaInvalidaciones = this.colaInvalidaciones
      .then(() => this.onInvalidacion(aviso))
      .catch((error) => {
        console.error('[sentinelia-runtime] Error procesando invalidación de telemetría');
        console.error(error);
      });
  }

  async detener() {
    if (!this.clienteSuscriptor) {
      return this.serializarResumen();
    }
    const cliente = this.clienteSuscriptor;
    this.clienteSuscriptor = null;
    await cliente.unsubscribe(this.canal);
    await this.colaInvalidaciones;
    await cliente.quit();
    return this.serializarResumen();
  }

  serializarResumen() {
    return {
      activo: Boolean(this.clienteSuscriptor),
      canal: this.canal,
      totalAvisos: this.totalAvisos,
      ultimoAvisoEnUtc: this.ultimoAvisoEnUtc
    };
  }
}

function parsearAviso(mensaje) {
  let bruto;
  try {
    bruto = JSON.parse(mensaje);
  } catch (_error) {
    return null;
  }
  if (bruto?.tipo === TIPO_AVISO_FOTOGRAFIAS && Array.isArray(bruto.senales)) {
    const senales = bruto.senales
      .map((senal) => ({
        agenteId: normalizarId(senal?.agenteId),
        senalId: normalizarId(senal?.senalId),
        ultimaObservacionId: normalizarId(senal?.ultimaObservacionId)
      }))
      .filter((senal) => senal.agenteId && senal.senalId);
    return senales.length > 0
      ? {
          tipo: TIPO_AVISO_FOTOGRAFIAS,
          totalSenales: senales.length,
          senales,
          reglas: [],
          publicadoEnUtc: bruto.publicadoEnUtc || null
        }
      : null;
  }
  if (bruto?.tipo === TIPO_AVISO_REGLAS && Array.isArray(bruto.reglas)) {
    const reglas = bruto.reglas
      .map((regla) => ({
        reglaId: normalizarId(regla?.reglaId),
        revisionId: normalizarId(regla?.revisionId),
        observacionId: normalizarId(regla?.observacionId)
      }))
      .filter((regla) => regla.reglaId);
    return reglas.length > 0
      ? {
          tipo: TIPO_AVISO_REGLAS,
          totalReglas: reglas.length,
          senales: [],
          reglas,
          publicadoEnUtc: bruto.publicadoEnUtc || null
        }
      : null;
  }
  return null;
}

function normalizarId(valor) {
  if (typeof valor === 'boolean' || String(valor ?? '').trim() === '') {
    return null;
  }
  const id = Number(valor);
  return Number.isInteger(id) && id > 0 ? id : null;
}
