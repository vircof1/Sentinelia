export const ESTRATEGIAS_EJECUCION_TRIGGER = Object.freeze({
  EFECTO_EXTERNO_DIFERIDO: 'efecto_externo_diferido',
  ACEPTACION_SQL_ATOMICA: 'aceptacion_sql_atomica'
});

const CATALOGO = Object.freeze({
  api: Object.freeze({
    tipo: 'api',
    admiteConfiguracionOverride: true,
    estrategiaEjecucion:
      ESTRATEGIAS_EJECUCION_TRIGGER.EFECTO_EXTERNO_DIFERIDO
  }),
  dns: Object.freeze({
    tipo: 'dns',
    admiteConfiguracionOverride: false,
    estrategiaEjecucion:
      ESTRATEGIAS_EJECUCION_TRIGGER.EFECTO_EXTERNO_DIFERIDO
  }),
  correo: Object.freeze({
    tipo: 'correo',
    admiteConfiguracionOverride: false,
    estrategiaEjecucion:
      ESTRATEGIAS_EJECUCION_TRIGGER.ACEPTACION_SQL_ATOMICA
  })
});

export const TIPOS_TRIGGER = Object.freeze(Object.keys(CATALOGO));

export function esTipoTrigger(valor) {
  return Object.hasOwn(CATALOGO, String(valor || '').trim().toLowerCase());
}

export function normalizarTipoTrigger(valor, { opcional = false } = {}) {
  const tipo = String(valor || '').trim().toLowerCase();
  if (opcional && !tipo) return null;
  if (!esTipoTrigger(tipo)) {
    throw new Error(`El tipo de trigger debe ser uno de: ${TIPOS_TRIGGER.join(', ')}.`);
  }
  return tipo;
}

export function obtenerTipoTrigger(tipo) {
  return CATALOGO[normalizarTipoTrigger(tipo)];
}

export function admiteConfiguracionOverrideTrigger(tipo) {
  return obtenerTipoTrigger(tipo).admiteConfiguracionOverride;
}

export function obtenerEstrategiaEjecucionTrigger(tipo) {
  return obtenerTipoTrigger(tipo).estrategiaEjecucion;
}

export function listarTiposTriggerPorEstrategia(estrategia) {
  const normalizada = String(estrategia || '').trim().toLowerCase();
  if (!Object.values(ESTRATEGIAS_EJECUCION_TRIGGER).includes(normalizada)) {
    throw new Error(`La estrategia de ejecución de trigger "${normalizada || '(vacía)'}" no existe.`);
  }
  return Object.freeze(TIPOS_TRIGGER.filter(
    (tipo) => CATALOGO[tipo].estrategiaEjecucion === normalizada
  ));
}
