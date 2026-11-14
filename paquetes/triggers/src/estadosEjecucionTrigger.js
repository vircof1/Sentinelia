export const ESTADOS_EJECUCION_TRIGGER = Object.freeze([
  'pendiente',
  'ejecutando',
  'ok',
  'error'
]);

export function normalizarEstadoEjecucionTrigger(
  valor,
  { porDefecto = 'pendiente' } = {}
) {
  const normalizado = String(valor || porDefecto).trim().toLowerCase();

  if (!ESTADOS_EJECUCION_TRIGGER.includes(normalizado)) {
    throw new Error(
      `El estado de ejecución del trigger debe ser uno de: ${ESTADOS_EJECUCION_TRIGGER.join(', ')}.`
    );
  }

  return normalizado;
}
