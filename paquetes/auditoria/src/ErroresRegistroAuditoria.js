export const CODIGOS_ERROR_REGISTRO_AUDITORIA = Object.freeze({
  ENTRADA_INVALIDA: 'entrada_auditoria_invalida',
  FRONTERA_INVALIDA: 'frontera_transaccional_auditoria_invalida',
  CONFLICTO_IDEMPOTENCIA: 'conflicto_idempotencia_auditoria',
  INCOHERENCIA_CADENA: 'incoherencia_cadena_auditoria',
  PERSISTENCIA_FALLIDA: 'persistencia_auditoria_fallida'
});

export class ErrorRegistroAuditoria extends Error {
  constructor(mensaje, {
    codigo,
    causa = null,
    reintentable = false
  } = {}) {
    super(mensaje, causa ? { cause: causa } : undefined);
    this.name = 'ErrorRegistroAuditoria';
    this.codigo = codigo;
    this.reintentable = Boolean(reintentable);
  }
}
