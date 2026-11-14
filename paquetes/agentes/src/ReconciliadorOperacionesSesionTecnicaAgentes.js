export class ReconciliadorOperacionesSesionTecnicaAgentes {
  constructor({
    procesador,
    intervaloMs = 1000,
    maximoPorCiclo = 25,
    informarError = () => {}
  } = {}) {
    if (typeof procesador?.procesarSiguiente !== 'function') {
      throw new Error('El reconciliador requiere un procesador de sesión técnica.');
    }
    this.procesador = procesador;
    this.intervaloMs = enteroPositivo(intervaloMs, 'intervaloMs');
    this.maximoPorCiclo = enteroPositivo(maximoPorCiclo, 'maximoPorCiclo');
    this.informarError = informarError;
    this.temporizador = null;
    this.cicloActivo = null;
  }

  async arrancar() {
    if (this.temporizador) return;
    await this.reconciliar();
    this.temporizador = setInterval(
      () => void this.reconciliar(),
      this.intervaloMs
    );
    this.temporizador.unref?.();
  }

  detener() {
    if (this.temporizador) clearInterval(this.temporizador);
    this.temporizador = null;
  }

  reconciliar() {
    if (this.cicloActivo) return this.cicloActivo;
    this.cicloActivo = this.#procesarCiclo()
      .catch((error) => {
        this.informarError(error);
        return Object.freeze({ procesadas: 0, interrumpido: true });
      })
      .finally(() => {
        this.cicloActivo = null;
      });
    return this.cicloActivo;
  }

  async #procesarCiclo() {
    let procesadas = 0;
    while (procesadas < this.maximoPorCiclo) {
      const resultado = await this.procesador.procesarSiguiente();
      if (!resultado) break;
      procesadas += 1;
    }
    return Object.freeze({
      procesadas,
      limiteAlcanzado: procesadas === this.maximoPorCiclo
    });
  }
}

function enteroPositivo(valor, nombre) {
  const entero = Number.parseInt(String(valor), 10);
  if (!Number.isInteger(entero) || entero < 1) {
    throw new TypeError(`${nombre} debe ser un entero positivo.`);
  }
  return entero;
}
