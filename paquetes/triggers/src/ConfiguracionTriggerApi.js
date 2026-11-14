export class ConfiguracionTriggerApi {
  constructor({
    url,
    metodo,
    timeoutMs,
    reintentos,
    permiteTlsInseguro,
    cabeceras,
    plantillaCuerpo,
    parametroOpcional
  }) {
    this.url = String(url || '').trim();
    this.metodo = String(metodo || '').trim().toUpperCase();
    this.timeoutMs = Number(timeoutMs || 0);
    this.reintentos = Number(reintentos || 0);
    this.permiteTlsInseguro = Boolean(permiteTlsInseguro);
    this.cabeceras =
      cabeceras && typeof cabeceras === 'object' && !Array.isArray(cabeceras)
        ? { ...cabeceras }
        : {};
    this.plantillaCuerpo =
      plantillaCuerpo == null || String(plantillaCuerpo).trim() === ''
        ? null
        : String(plantillaCuerpo);
    this.parametroOpcional =
      parametroOpcional == null || String(parametroOpcional).trim() === ''
        ? null
        : String(parametroOpcional).trim();
  }

  serializar() {
    return {
      url: this.url,
      metodo: this.metodo,
      timeoutMs: this.timeoutMs,
      reintentos: this.reintentos,
      permiteTlsInseguro: this.permiteTlsInseguro,
      cabeceras: { ...this.cabeceras },
      plantillaCuerpo: this.plantillaCuerpo,
      parametroOpcional: this.parametroOpcional
    };
  }
}
