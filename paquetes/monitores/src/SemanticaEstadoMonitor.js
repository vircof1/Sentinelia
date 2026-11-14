export const INTERPRETACIONES_ESTADO_MONITOR = Object.freeze([
  'normal',
  'invertida'
]);

const TIPOS_CON_INTERPRETACION_FIJA = new Set([
  'booleano',
  'telemetria'
]);

export function normalizarInterpretacionEstadoMonitor(valor, porDefecto = 'normal') {
  const normalizado = String(valor || '')
    .trim()
    .toLowerCase();

  if (INTERPRETACIONES_ESTADO_MONITOR.includes(normalizado)) {
    return normalizado;
  }

  return porDefecto;
}

export function normalizarInterpretacionEstadoMonitorPorTipo({
  tipo,
  valor,
  porDefecto = 'normal'
} = {}) {
  const tipoNormalizado = String(tipo || '')
    .trim()
    .toLowerCase();

  if (TIPOS_CON_INTERPRETACION_FIJA.has(tipoNormalizado)) {
    return 'normal';
  }

  return normalizarInterpretacionEstadoMonitor(valor, porDefecto);
}

export function validarInterpretacionEstadoMonitor(valor) {
  const normalizado = normalizarInterpretacionEstadoMonitor(valor, null);

  if (!normalizado) {
    throw new Error(
      `La interpretación del estado debe ser una de: ${INTERPRETACIONES_ESTADO_MONITOR.join(', ')}.`
    );
  }

  return normalizado;
}

export function validarInterpretacionEstadoMonitorPorTipo({
  tipo,
  valor
} = {}) {
  const tipoNormalizado = String(tipo || '')
    .trim()
    .toLowerCase();

  if (TIPOS_CON_INTERPRETACION_FIJA.has(tipoNormalizado)) {
    return 'normal';
  }

  return validarInterpretacionEstadoMonitor(valor);
}

export function esInterpretacionEstadoInvertida(valor) {
  return normalizarInterpretacionEstadoMonitor(valor) === 'invertida';
}
