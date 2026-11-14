export const VERSION_CONFIGURACION_TRIGGER_CORREO = 1;
export const ASUNTO_PLANTILLA_TRIGGER_CORREO_POR_DEFECTO =
  '[Sentinelia] {{transicion}} · {{monitor}}';
export const TOKENS_ASUNTO_TRIGGER_CORREO = Object.freeze([
  'portal',
  'transicion',
  'monitor',
  'estado'
]);

export class ConfiguracionTriggerCorreo {
  constructor({
    version = VERSION_CONFIGURACION_TRIGGER_CORREO,
    asuntoPlantilla = ASUNTO_PLANTILLA_TRIGGER_CORREO_POR_DEFECTO,
    textoIntroduccion = null,
    textoCierre = null
  } = {}) {
    this.version = Number(version);
    this.asuntoPlantilla = String(asuntoPlantilla);
    this.textoIntroduccion = textoIntroduccion == null ? null : String(textoIntroduccion);
    this.textoCierre = textoCierre == null ? null : String(textoCierre);
  }

  serializar() {
    return {
      version: this.version,
      asuntoPlantilla: this.asuntoPlantilla,
      textoIntroduccion: this.textoIntroduccion,
      textoCierre: this.textoCierre
    };
  }
}
