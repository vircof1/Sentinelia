export class ObservadorAvisosPlataformaSql {
  constructor({ repositorio, difusorWebSocketPortal, intervaloMs = 2000 }) {
    this.repositorio = repositorio;
    this.difusorWebSocketPortal = difusorWebSocketPortal;
    this.intervaloMs = intervaloMs;
    this.firma = null;
    this.temporizador = null;
  }

  async arrancar() {
    this.firma = await this.repositorio.obtenerFirmaGlobal();
    if (this.temporizador) return;
    this.temporizador = setInterval(() => void this.comprobar().catch((error) => {
      console.error('[sentinelia-web] Error observando avisos de plataforma');
      console.error(error);
    }), this.intervaloMs);
    this.temporizador.unref?.();
  }

  detener() {
    if (this.temporizador) clearInterval(this.temporizador);
    this.temporizador = null;
  }

  async comprobar() {
    const siguiente = await this.repositorio.obtenerFirmaGlobal();
    if (siguiente === this.firma) return;
    this.firma = siguiente;
    this.difusorWebSocketPortal.emitirAvisosPlataformaActualizados();
  }
}
