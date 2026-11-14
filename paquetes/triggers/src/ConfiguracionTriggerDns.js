export class ConfiguracionTriggerDns {
  constructor({
    zonaId,
    registroId,
    operacion,
    valorPrincipal = null,
    rolGobernanza = null
  } = {}) {
    this.zonaId = Number(zonaId || 0);
    this.registroId = Number(registroId || 0);
    this.operacion = String(operacion || '').trim().toLowerCase();
    this.valorPrincipal =
      valorPrincipal == null || String(valorPrincipal).trim() === ''
        ? null
        : String(valorPrincipal).trim();
    this.rolGobernanza =
      rolGobernanza == null || String(rolGobernanza).trim() === ''
        ? null
        : String(rolGobernanza).trim();
  }

  serializar() {
    return {
      zonaId: this.zonaId,
      registroId: this.registroId,
      operacion: this.operacion,
      valorPrincipal: this.valorPrincipal,
      rolGobernanza: this.rolGobernanza
    };
  }
}
