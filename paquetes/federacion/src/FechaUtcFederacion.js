const PATRON_FECHA_UTC_CANONICA =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

export function esFechaUtcCanonicaFederacion(valor) {
  if (typeof valor !== 'string' || !PATRON_FECHA_UTC_CANONICA.test(valor)) {
    return false;
  }
  const instante = Date.parse(valor);
  return Number.isFinite(instante) && new Date(instante).toISOString() === valor;
}
