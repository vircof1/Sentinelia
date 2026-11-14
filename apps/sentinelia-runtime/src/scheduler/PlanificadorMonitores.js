function calcularDuracionMs(inicioIso, finIso) {
  if (!inicioIso || !finIso) {
    return 0;
  }

  const inicioMs = Date.parse(inicioIso);
  const finMs = Date.parse(finIso);

  if (Number.isNaN(inicioMs) || Number.isNaN(finMs)) {
    return 0;
  }

  return Math.max(0, finMs - inicioMs);
}

export class PlanificadorMonitores {
  constructor({ configuracionRuntime, onTick, onTickFinalizado }) {
    this.configuracionRuntime = configuracionRuntime;
    this.onTick = typeof onTick === 'function' ? onTick : async () => {};
    this.onTickFinalizado =
      typeof onTickFinalizado === 'function' ? onTickFinalizado : async () => {};
    this.temporizadorTick = null;
    this.tickEnCurso = null;
    this.arrancadoEn = null;
    this.ultimoTickInicioEn = null;
    this.ultimoTickFinEn = null;
    this.ultimaDuracionMs = 0;
    this.ultimoOrigenTick = null;
    this.ticksEjecutados = 0;
    this.ticksConError = 0;
    this.ticksOmitidosPorSolape = 0;
  }

  get intervaloTickMs() {
    return this.configuracionRuntime.schedulerTickMs;
  }

  async arrancar() {
    if (this.temporizadorTick) {
      return this.serializarResumen();
    }

    this.arrancadoEn = new Date().toISOString();
    await this.ejecutarTick({ origen: 'inicio' });
    this.temporizadorTick = setInterval(() => {
      void this.ejecutarTick({ origen: 'intervalo' }).catch((error) => {
        console.error('[sentinelia-runtime] Error en tick del scheduler');
        console.error(error);
      });
    }, this.intervaloTickMs);

    return this.serializarResumen();
  }

  async detener() {
    if (this.temporizadorTick) {
      clearInterval(this.temporizadorTick);
      this.temporizadorTick = null;
    }

    if (this.tickEnCurso) {
      await this.tickEnCurso;
    }

    return this.serializarResumen();
  }

  async ejecutarTick({ origen = 'intervalo' } = {}) {
    if (this.tickEnCurso) {
      this.ticksOmitidosPorSolape += 1;
      return this.tickEnCurso;
    }

    this.tickEnCurso = this.ejecutarTickInterno({ origen }).finally(() => {
      this.tickEnCurso = null;
    });

    return this.tickEnCurso;
  }

  async ejecutarTickInterno({ origen }) {
    const iniciadoEn = new Date().toISOString();
    const numeroTick = this.ticksEjecutados + 1;

    this.ultimoOrigenTick = origen;
    this.ultimoTickInicioEn = iniciadoEn;

    try {
      await this.onTick({
        origen,
        numeroTick,
        iniciadoEn
      });
      this.ticksEjecutados += 1;
    } catch (error) {
      this.ticksConError += 1;
      throw error;
    } finally {
      this.ultimoTickFinEn = new Date().toISOString();
      this.ultimaDuracionMs = calcularDuracionMs(
        this.ultimoTickInicioEn,
        this.ultimoTickFinEn
      );
      await this.onTickFinalizado({
        origen,
        numeroTick,
        iniciadoEn,
        finalizadoEn: this.ultimoTickFinEn
      });
    }
  }

  serializarResumen() {
    return {
      activo: Boolean(this.temporizadorTick),
      intervaloTickMs: this.intervaloTickMs,
      arrancadoEn: this.arrancadoEn,
      tickEnCurso: Boolean(this.tickEnCurso),
      ticksEjecutados: this.ticksEjecutados,
      ticksConError: this.ticksConError,
      ticksOmitidosPorSolape: this.ticksOmitidosPorSolape,
      ultimoOrigenTick: this.ultimoOrigenTick,
      ultimoTickInicioEn: this.ultimoTickInicioEn,
      ultimoTickFinEn: this.ultimoTickFinEn,
      ultimaDuracionMs: this.ultimaDuracionMs
    };
  }
}
