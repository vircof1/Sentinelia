export const EVENTOS_DISPARO_TRIGGER = Object.freeze([
  'apertura_alerta',
  'cierre_alerta'
]);

export function normalizarEventoDisparoTrigger(valor) {
  const normalizado = String(valor || '').trim().toLowerCase();

  if (!EVENTOS_DISPARO_TRIGGER.includes(normalizado)) {
    throw new Error(
      `El evento de disparo debe ser uno de: ${EVENTOS_DISPARO_TRIGGER.join(', ')}.`
    );
  }

  return normalizado;
}

export function normalizarEventosDisparoTrigger(
  valor,
  { porDefecto = ['apertura_alerta'] } = {}
) {
  const origen = Array.isArray(valor)
    ? valor
    : (valor == null || valor === '' ? porDefecto : [valor]);
  const unicos = new Set();

  for (const evento of origen) {
    unicos.add(normalizarEventoDisparoTrigger(evento));
  }

  if (unicos.size === 0) {
    throw new Error(
      `Debe existir al menos un evento de disparo: ${EVENTOS_DISPARO_TRIGGER.join(', ')}.`
    );
  }

  return EVENTOS_DISPARO_TRIGGER.filter((evento) => unicos.has(evento));
}

export function tieneEventoDisparoTrigger(eventos = [], evento) {
  const eventoNormalizado = normalizarEventoDisparoTrigger(evento);

  return normalizarEventosDisparoTrigger(eventos, {
    porDefecto: ['apertura_alerta']
  }).includes(eventoNormalizado);
}
