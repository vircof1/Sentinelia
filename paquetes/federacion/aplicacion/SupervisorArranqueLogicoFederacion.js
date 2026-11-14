export class SupervisorArranqueLogicoFederacion {
  constructor({
    coordinador,
    intervaloRenovacionMs,
    programarIntervalo = setInterval,
    cancelarIntervalo = clearInterval,
    alFallarRenovacion = () => {}
  } = {}) {
    if (typeof coordinador?.asegurarActual !== 'function') {
      throw new Error('El supervisor requiere un coordinador de arranque lógico.');
    }
    if (!Number.isSafeInteger(intervaloRenovacionMs) || intervaloRenovacionMs < 1) {
      throw new Error('El intervalo de renovación federada debe ser positivo.');
    }
    for (const [nombre, funcion] of [
      ['programarIntervalo', programarIntervalo],
      ['cancelarIntervalo', cancelarIntervalo],
      ['alFallarRenovacion', alFallarRenovacion]
    ]) {
      if (typeof funcion !== 'function') throw new Error(`${nombre} debe ser una función.`);
    }
    this.coordinador = coordinador;
    this.intervaloRenovacionMs = intervaloRenovacionMs;
    this.programarIntervalo = programarIntervalo;
    this.cancelarIntervalo = cancelarIntervalo;
    this.alFallarRenovacion = alFallarRenovacion;
    this.contexto = null;
    this.temporizador = null;
    this.renovacionPendiente = null;
    this.ultimoError = null;
  }

  async arrancar({ bootIdConocido = null } = {}) {
    if (this.contexto) return this.contexto;
    this.contexto = await this.coordinador.asegurarActual({ bootIdConocido });
    this.temporizador = this.programarIntervalo(() => {
      void this.renovar().catch((error) => this.alFallarRenovacion(error));
    }, this.intervaloRenovacionMs);
    this.temporizador?.unref?.();
    return this.contexto;
  }

  renovar() {
    if (!this.contexto) {
      return Promise.reject(new Error('El arranque federado todavía no está supervisado.'));
    }
    if (this.renovacionPendiente) return this.renovacionPendiente;
    this.renovacionPendiente = this.#renovarActual().finally(() => {
      this.renovacionPendiente = null;
    });
    return this.renovacionPendiente;
  }

  async #renovarActual() {
    try {
      const renovado = await this.coordinador.asegurarActual({
        bootIdConocido: this.contexto.bootId
      });
      if (!renovado.installationId.esIgual(this.contexto.installationId) ||
          !renovado.bootId.esIgual(this.contexto.bootId)) {
        throw new Error('La renovación intentó sustituir la identidad del arranque vivo.');
      }
      this.contexto = renovado;
      this.ultimoError = null;
      return renovado;
    } catch (error) {
      this.ultimoError = error;
      throw error;
    }
  }

  async detener() {
    if (this.temporizador !== null) {
      this.cancelarIntervalo(this.temporizador);
      this.temporizador = null;
    }
    if (this.renovacionPendiente) {
      await this.renovacionPendiente;
    }
  }

  construirResumen() {
    return Object.freeze({
      installationId: this.contexto?.installationId?.serializar?.() || null,
      bootId: this.contexto?.bootId?.serializar?.() || null,
      origen: this.contexto?.origen || null,
      ttlSegundos: this.contexto?.ttlSegundos || null,
      intervaloRenovacionMs: this.intervaloRenovacionMs,
      renovacionSaludable: this.ultimoError === null
    });
  }
}
