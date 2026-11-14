export class ObservadorDashboardRedis {
  constructor({
    clienteRedis,
    claveDashboard,
    intervaloMs = 2000,
    difusorWebSocketPortal
  }) {
    this.clienteRedis = clienteRedis;
    this.claveDashboard = claveDashboard;
    this.intervaloMs = intervaloMs;
    this.difusorWebSocketPortal = difusorWebSocketPortal;
    this.temporizador = null;
    this.firmaActual = null;
    this.estadoInicialSincronizado = false;
  }

  async arrancar() {
    await this.sincronizarEstadoInicial();

    if (this.temporizador) {
      return;
    }

    this.temporizador = setInterval(() => {
      void this.comprobarCambios().catch((error) => {
        console.error('[sentinelia-web] Error observando dashboard Redis');
        console.error(error);
      });
    }, this.intervaloMs);

    if (typeof this.temporizador.unref === 'function') {
      this.temporizador.unref();
    }
  }

  detener() {
    if (this.temporizador) {
      clearInterval(this.temporizador);
      this.temporizador = null;
    }
  }

  async sincronizarEstadoInicial() {
    const payload = await this.leerDashboardRedis();
    this.firmaActual = payload ? this.construirFirma(payload) : null;
    this.estadoInicialSincronizado = true;
  }

  async comprobarCambios() {
    const payload = await this.leerDashboardRedis();
    const firmaNueva = payload ? this.construirFirma(payload) : null;

    if (!firmaNueva) {
      this.firmaActual = null;
      return;
    }

    if (this.firmaActual == null) {
      this.firmaActual = firmaNueva;

      if (this.estadoInicialSincronizado) {
        this.difusorWebSocketPortal.emitirDashboardActualizado(payload);
      }

      return;
    }

    if (firmaNueva === this.firmaActual) {
      return;
    }

    this.firmaActual = firmaNueva;
    this.difusorWebSocketPortal.emitirDashboardActualizado(payload);
  }

  async leerDashboardRedis() {
    const bruto = await this.clienteRedis.get(this.claveDashboard);

    if (!bruto) {
      return null;
    }

    try {
      return JSON.parse(bruto);
    } catch (_error) {
      return null;
    }
  }

  construirFirma(payload) {
    if (payload?.firmaDashboard) {
      return String(payload.firmaDashboard);
    }

    return [
      Number(payload?.versionOperativa || 0) || 0,
      Number(payload?.versionCatalogoMonitores || 0) || 0
    ].join(':');
  }
}
