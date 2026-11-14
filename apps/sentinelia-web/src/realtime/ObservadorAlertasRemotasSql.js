export class ObservadorAlertasRemotasSql {
  constructor({ repositorio, difusorWebSocketPortal, intervaloMs = 2000 }) {
    this.repositorio = repositorio; this.difusor = difusorWebSocketPortal;
    this.intervaloMs = intervaloMs; this.firma = null; this.temporizador = null;
  }
  async arrancar() {
    this.firma = await this.repositorio.obtenerFirmaGlobal();
    if (this.temporizador) return;
    this.temporizador = setInterval(() => void this.comprobar().catch((error) => {
      console.error('[sentinelia-web] Error observando alertas remotas'); console.error(error);
    }), this.intervaloMs);
    this.temporizador.unref?.();
  }
  async comprobar() {
    const siguiente = await this.repositorio.obtenerFirmaGlobal();
    if (siguiente === this.firma) return;
    this.firma = siguiente; this.difusor.emitirAlertasRemotasActualizadas();
  }
  detener() { if (this.temporizador) clearInterval(this.temporizador); this.temporizador = null; }
}
