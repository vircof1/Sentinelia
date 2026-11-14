const COBERTURAS_POR_UNIDAD = Object.freeze([
  Object.freeze(['contrato', 'openapi', 'tipos_previos']),
  Object.freeze(['migraciones', 'sql', 'idempotencia', 'concurrencia']),
  Object.freeze(['lectura', 'reglas', 'proyeccion']),
  Object.freeze(['federacion', 'snapshot', 'retirada', 'refederacion']),
  Object.freeze(['http', 'openapi', 'replay', 'purga']),
  Object.freeze(['ui', 'graficas', 'duracion']),
  Object.freeze(['ui', 'graficas', 'momento_utc', 'fechas_locales']),
  Object.freeze(['reglas', 'duracion', 'monitores']),
  Object.freeze(['reglas', 'momento_utc', 'monitores', 'fechas_locales']),
  Object.freeze(['reglas', 'regex', 'seguridad', 'permisos', 'monitores']),
  Object.freeze(['reglas', 'regex', 'limites', 'federacion', 'monitores']),
  Object.freeze(['cierre_adversarial', 'matriz_completa'])
]);

export const IDS_UNIDADES_TELEMETRIA_5_24 = Object.freeze(
  Array.from({ length: 12 }, (_, fase) => `5.24.${fase}`)
);

export const IDS_REGRESIONES_TELEMETRIA_5_24 = Object.freeze([
  'contrato-api-telemetria-previo',
  'reglas-derivadas',
  'monitores-telemetria',
  'triggers',
  'federacion-telemetria',
  'fechas-locales'
]);

const unidades = IDS_UNIDADES_TELEMETRIA_5_24.map((id, fase) =>
  congelarVerificacion({
    tipo: 'unidad',
    id,
    archivo: `scripts/agentes-verificar-telemetria-5-24-${fase}.js`,
    marcador: new RegExp(`\\[agentes\\] OK 5\\.24\\.${fase}:`, 'u'),
    smoke: fase === 0 ? 'openapi' : fase === 1 ? 'migraciones' : null,
    coberturas: COBERTURAS_POR_UNIDAD[fase]
  })
);

const regresiones = [
  {
    tipo: 'regresion',
    id: 'contrato-api-telemetria-previo',
    archivo: 'scripts/agentes-verificar-login-tecnico.js',
    marcador:
      /OK sesiones tecnicas, contrato OpenAPI, ingesta y lectura telemetria/u,
    coberturas: ['contrato', 'openapi', 'tipos_previos', 'ui', 'pol']
  },
  {
    tipo: 'regresion',
    id: 'reglas-derivadas',
    archivo: 'scripts/agentes-verificar-eventos-derivados-cierre.js',
    marcador: /OK cierre estructural completo verificado hasta 5\.20a\.11/u,
    coberturas: ['reglas', 'proyeccion', 'outbox', 'permisos']
  },
  {
    tipo: 'regresion',
    id: 'monitores-telemetria',
    archivo: 'scripts/monitores-verificar-telemetria-cierre.js',
    marcador: /OK cierre estructural completo verificado hasta 5\.20b\.10/u,
    coberturas: ['monitores', 'triggers', 'pol']
  },
  {
    tipo: 'regresion',
    id: 'triggers',
    archivo: 'scripts/triggers-verificar-administracion-auditable.js',
    marcador: /\[triggers\] OK 5\.21\.11a/u,
    coberturas: ['triggers', 'permisos', 'auditoria']
  },
  {
    tipo: 'regresion',
    id: 'federacion-telemetria',
    archivo: 'scripts/federacion-verificar-5-22-15f.js',
    marcador: /\[federacion\] OK 5\.22\.15f/u,
    coberturas: ['federacion', 'snapshot', 'retirada', 'sql']
  },
  {
    tipo: 'regresion',
    id: 'fechas-locales',
    archivo: 'scripts/ui-verificar-fechas-locales.js',
    marcador: /\[ui\] OK fechas locales/u,
    coberturas: ['ui', 'fechas_locales']
  }
].map(congelarVerificacion);

export const VERIFICACIONES_CIERRE_TELEMETRIA_5_24 = Object.freeze([
  ...unidades,
  ...regresiones
]);

export const COBERTURAS_OBLIGATORIAS_TELEMETRIA_5_24 = Object.freeze([
  'auditoria',
  'cierre_adversarial',
  'concurrencia',
  'contrato',
  'duracion',
  'fechas_locales',
  'federacion',
  'graficas',
  'http',
  'idempotencia',
  'lectura',
  'limites',
  'matriz_completa',
  'migraciones',
  'momento_utc',
  'monitores',
  'openapi',
  'outbox',
  'permisos',
  'pol',
  'proyeccion',
  'purga',
  'refederacion',
  'regex',
  'reglas',
  'replay',
  'retirada',
  'seguridad',
  'snapshot',
  'sql',
  'tipos_previos',
  'triggers',
  'ui'
]);

function congelarVerificacion(verificacion) {
  return Object.freeze({
    ...verificacion,
    coberturas: Object.freeze([...(verificacion.coberturas || [])])
  });
}
