export const TTL_ESTADO_OPERATIVO_FEDERADO_PREDETERMINADO_MS = 15 * 60 * 1000;

export function calcularVigenciaEstadoOperativoFederado({
  fila = {},
  ttlMaximoMs
} = {}) {
  const ttl = enteroPositivo(ttlMaximoMs, 'ttlMaximoMs');
  const baseMs = resolverBaseTemporal(fila);
  return new Date(baseMs + ttl).toISOString();
}

function resolverBaseTemporal(fila) {
  for (const candidata of [
    fila?.ultima_ejecucion_utc,
    fila?.ultima_confirmacion_utc,
    fila?.fecha_ultima_ejecucion_utc,
    fila?.ultimaEjecucionUtc,
    fila?.ultimaConfirmacionUtc,
    fila?.fechaOcurrenciaUtc
  ]) {
    const marcaMs = Date.parse(String(candidata || ''));
    if (Number.isFinite(marcaMs)) return marcaMs;
  }
  throw new TypeError(
    'El estado operativo federado requiere una observacion temporal de origen valida.'
  );
}

function enteroPositivo(valor, campo) {
  const numero = Number(valor);
  if (!Number.isSafeInteger(numero) || numero <= 0) {
    throw new TypeError(`${campo} debe ser un entero positivo.`);
  }
  return numero;
}
