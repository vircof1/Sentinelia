import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  LIMITES_TELEMETRIA_AGENTE,
  RESULTADOS_ACTUALIZACION_FOTOGRAFIA_TELEMETRIA,
  TIPOS_DATO_TELEMETRIA_AGENTE,
  crearLecturaActualTelemetriaAgente,
  crearLoteTelemetriaAgente,
  crearResultadoIngestaTelemetria,
  crearSenalTelemetriaAgente,
  resolverActualizacionFotografiaTelemetria
} from '../paquetes/agentes/src/TelemetriaAgente.js';

const RUTA_SCRIPT = fileURLToPath(import.meta.url);
const IMPORTS_INFRAESTRUCTURA_PROHIBIDOS = Object.freeze([
  'ClienteSql',
  'ServicioConexionRedis',
  'express',
  'mysql2',
  'redis'
]);

async function main() {
  await verificarQueElScriptEsDominioPuro();
  verificarCasosValidosPorTipo();
  verificarCasosInvalidosPorTipo();
  verificarCardinalidadLoteYCatalogo();
  verificarLimitesTextoYJson();
  verificarSemanticaYResultadoIngesta();
  verificarReglasFotografiaActual();

  console.log('[agentes-telemetria] OK: dominio puro verificado.');
}

async function verificarQueElScriptEsDominioPuro() {
  const fuente = await readFile(RUTA_SCRIPT, 'utf8');
  const imports = fuente
    .split(/\r?\n/)
    .filter((linea) => linea.trim().startsWith('import '))
    .join('\n');

  for (const importProhibido of IMPORTS_INFRAESTRUCTURA_PROHIBIDOS) {
    assert.equal(
      imports.includes(importProhibido),
      false,
      `La verificacion de dominio puro no debe importar ${importProhibido}.`
    );
  }
}

function verificarCasosValidosPorTipo() {
  const base = {
    categoria: 'sistema',
    clave: 'senal.prueba',
    observadoEnUtc: '2026-07-07T11:00:00Z'
  };
  const casos = [
    {
      tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.NUMERO,
      valorNumero: -12.5,
      campoEsperado: 'valorNumero'
    },
    {
      tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.BOOLEANO,
      valorBooleano: false,
      campoEsperado: 'valorBooleano'
    },
    {
      tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.TEXTO,
      valorTexto: 'texto vivo',
      campoEsperado: 'valorTexto'
    },
    {
      tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.ESTADO,
      valorEstado: 'cerrada',
      campoEsperado: 'valorEstado'
    },
    {
      tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.JSON,
      valorJson: {
        usadoGb: 4.4,
        totalGb: 10
      },
      campoEsperado: 'valorJson'
    }
  ];

  for (const { campoEsperado, ...caso } of casos) {
    const lectura = crearLoteTelemetriaAgente({
      observaciones: [
        {
          ...base,
          ...caso
        }
      ]
    }).serializar().observaciones[0];

    assert.equal(lectura.tipoDato, caso.tipoDato);
    assert.notEqual(lectura[campoEsperado], null);
  }
}

function verificarCasosInvalidosPorTipo() {
  const base = {
    categoria: 'sistema',
    clave: 'senal.invalida',
    observadoEnUtc: '2026-07-07T11:05:00Z'
  };

  assert.throws(
    () =>
      crearLoteTelemetriaAgente({
        observaciones: [
          {
            ...base,
            tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.NUMERO
          }
        ]
      }),
    /exactamente un campo de valor/
  );
  assert.throws(
    () =>
      crearLoteTelemetriaAgente({
        observaciones: [
          {
            ...base,
            tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.NUMERO,
            valorNumero: 10,
            valorTexto: 'sobrante'
          }
        ]
      }),
    /exactamente un campo de valor/
  );
  assert.throws(
    () =>
      crearLoteTelemetriaAgente({
        observaciones: [
          {
            ...base,
            tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.BOOLEANO,
            valorTexto: 'true'
          }
        ]
      }),
    /debe usar valorBooleano/
  );
  assert.throws(
    () =>
      crearLoteTelemetriaAgente({
        observaciones: [
          {
            ...base,
            tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.NUMERO,
            valorNumero: Number.NaN
          }
        ]
      }),
    /valor numérico/
  );
  assert.throws(
    () =>
      crearLoteTelemetriaAgente({
        observaciones: [
          {
            ...base,
            tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.JSON,
            valorJson: ['array-no-admitido']
          }
        ]
      }),
    /valor JSON/
  );
}

function verificarLimitesTextoYJson() {
  const textoLargo = 'x'.repeat(LIMITES_TELEMETRIA_AGENTE.VALOR_TEXTO + 50);
  const detalleLargo = 'd'.repeat(LIMITES_TELEMETRIA_AGENTE.DETALLE_HUMANO + 50);
  assert.throws(
    () =>
      crearLoteTelemetriaAgente({
        observaciones: [
          {
            categoria: 'sistema',
            clave: 'texto.largo',
            tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.TEXTO,
            observadoEnUtc: '2026-07-07T11:10:00Z',
            valorTexto: textoLargo
          }
        ]
      }),
    /texto.*límite/i
  );
  assert.throws(
    () =>
      crearLoteTelemetriaAgente({
        observaciones: [
          {
            categoria: 'sistema',
            clave: 'detalle.largo',
            tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.NUMERO,
            observadoEnUtc: '2026-07-07T11:10:00Z',
            valorNumero: 1,
            detalleHumano: detalleLargo
          }
        ]
      }),
    /texto.*límite/i
  );
  assert.throws(
    () =>
      crearLoteTelemetriaAgente({
        observaciones: [
          {
            categoria: 'sistema',
            clave: 'json.excesivo',
            tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.JSON,
            observadoEnUtc: '2026-07-07T11:11:00Z',
            valorJson: {
              relleno: 'j'.repeat(LIMITES_TELEMETRIA_AGENTE.JSON_SERIALIZADO)
            }
          }
        ]
      }),
    /JSON/
  );
  assert.throws(
    () =>
      crearLoteTelemetriaAgente({
        observaciones: [
          {
            categoria: 'sistema',
            clave: 'metadatos.excesivos',
            tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.NUMERO,
            observadoEnUtc: '2026-07-07T11:12:00Z',
            valorNumero: 1,
            metadatos: {
              relleno: 'm'.repeat(LIMITES_TELEMETRIA_AGENTE.JSON_SERIALIZADO)
            }
          }
        ]
      }),
    /JSON/
  );
}

function verificarCardinalidadLoteYCatalogo() {
  assert.throws(
    () => crearLoteTelemetriaAgente({ observaciones: [] }),
    /al menos una observación/
  );
  assert.throws(
    () =>
      crearLoteTelemetriaAgente({
        observaciones: Array.from(
          { length: LIMITES_TELEMETRIA_AGENTE.OBSERVACIONES_LOTE + 1 },
          (_, indice) => ({
            categoria: 'sistema',
            clave: `cpu.${indice}`,
            tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.NUMERO,
            observadoEnUtc: '2026-07-07T11:13:00Z',
            valorNumero: indice
          })
        )
      }),
    /lote.*límite/i
  );
  assert.throws(
    () =>
      crearLoteTelemetriaAgente({
        catalogo: {
          senales: []
        },
        observaciones: [
          {
            categoria: 'sistema',
            clave: 'cpu.uso',
            tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.NUMERO,
            observadoEnUtc: '2026-07-07T11:14:00Z',
            valorNumero: 12
          }
        ]
      }),
    /catálogo.*al menos una señal/i
  );
  assert.throws(
    () =>
      crearLoteTelemetriaAgente({
        catalogo: {
          senales: Array.from(
            { length: LIMITES_TELEMETRIA_AGENTE.OBSERVACIONES_LOTE + 1 },
            (_, indice) => ({
              categoria: 'sistema',
              clave: `senal.${indice}`,
              tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.NUMERO
            })
          )
        },
        observaciones: [
          {
            categoria: 'sistema',
            clave: 'cpu.uso',
            tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.NUMERO,
            observadoEnUtc: '2026-07-07T11:14:00Z',
            valorNumero: 12
          }
        ]
      }),
    /catálogo.*límite/i
  );
}

function verificarSemanticaYResultadoIngesta() {
  const senal = crearSenalTelemetriaAgente({
    categoria: 'ambiente',
    clave: 'temperatura',
    tag: 'camara-frigorifica',
    tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.NUMERO,
    unidad: 'ºC',
    consolidadaEnUtc: '2026-07-07T11:15:00Z'
  }).serializar();

  assert.equal(senal.codigoSenal, 'ambiente.temperatura:camara-frigorifica');
  assert.equal(senal.consolidadaEnUtc, '2026-07-07T11:15:00.000Z');
  assert.throws(
    () =>
      crearLoteTelemetriaAgente({
        observaciones: [
          {
            categoria: 'ambiente',
            clave: 'temperatura',
            tag: 'camara-frigorifica',
            tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.NUMERO,
            unidad: 'ºC',
            observadoEnUtc: '2026-07-07T11:16:00Z',
            valorNumero: 3.8,
            definicionSenal: {
              categoria: 'ambiente',
              clave: 'temperatura',
              tag: 'camara-frigorifica',
              tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.NUMERO,
              unidad: '%'
            }
          }
        ]
      }),
    /no coincide.*unidad/
  );

  const resultado = crearResultadoIngestaTelemetria({
    requestId: 'req_telemetria_dominio',
    aceptadas: 2,
    rechazadas: 1,
    errores: [
      {
        indice: 2,
        code: 'valor_invalido',
        message: 'Valor incompatible con el tipo declarado.',
        campo: 'valorNumero'
      }
    ],
    recibidoEnUtc: '2026-07-07T11:17:00Z'
  }).serializar();

  assert.equal(resultado.ok, false);
  assert.equal(resultado.resultado, 'parcial');
  assert.equal(resultado.errores[0].indice, 2);
  assert.throws(
    () =>
      crearResultadoIngestaTelemetria({
        requestId: 'req_incoherente',
        aceptadas: 1,
        rechazadas: 1,
        errores: []
      }),
    /rechazadas.*errores/
  );
}

function verificarReglasFotografiaActual() {
  const actual = crearLecturaActualTelemetriaAgente({
    id: 1,
    agenteId: 7,
    senalId: 11,
    ultimaObservacionId: 100,
    categoria: 'sistema',
    clave: 'cpu',
    tag: 'socket0',
    tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.NUMERO,
    unidad: '%',
    valorNumero: 42,
    detalleHumano: 'Lectura visible al operador.',
    observadoEnUtc: '2026-07-07T11:00:00Z',
    recibidoEnUtc: '2026-07-07T11:00:05Z'
  }).serializar();

  const primera = resolverActualizacionFotografiaTelemetria({
    actual: null,
    candidata: {
      ...actual,
      id: null,
      ultimaObservacionId: 101,
      valorNumero: 43
    }
  });
  assert.equal(primera.actualizar, true);
  assert.equal(
    primera.resultado,
    RESULTADOS_ACTUALIZACION_FOTOGRAFIA_TELEMETRIA.CREAR
  );

  const masReciente = resolverActualizacionFotografiaTelemetria({
    actual,
    candidata: {
      ...actual,
      ultimaObservacionId: 101,
      valorNumero: 44,
      emitidoEnUtc: '2026-07-07T10:59:59Z',
      observadoEnUtc: '2026-07-07T11:01:00Z',
      recibidoEnUtc: '2026-07-07T11:00:04Z'
    }
  });
  assert.equal(masReciente.actualizar, true);
  assert.equal(masReciente.motivo, 'observacion_mas_reciente');

  const antiguaAunqueLlegueDespues = resolverActualizacionFotografiaTelemetria({
    actual,
    candidata: {
      ...actual,
      ultimaObservacionId: 102,
      valorNumero: 40,
      observadoEnUtc: '2026-07-07T10:59:00Z',
      recibidoEnUtc: '2026-07-07T11:30:00Z'
    }
  });
  assert.equal(antiguaAunqueLlegueDespues.actualizar, false);
  assert.equal(
    antiguaAunqueLlegueDespues.resultado,
    RESULTADOS_ACTUALIZACION_FOTOGRAFIA_TELEMETRIA.IGNORAR_ANTIGUA
  );

  const mismaFechaConIdPosterior = resolverActualizacionFotografiaTelemetria({
    actual,
    candidata: {
      ...actual,
      ultimaObservacionId: 101,
      valorNumero: 45,
      recibidoEnUtc: '2026-07-07T11:00:07Z'
    }
  });
  assert.equal(mismaFechaConIdPosterior.actualizar, true);
  assert.equal(
    mismaFechaConIdPosterior.motivo,
    'misma_fecha_observada_observacion_posterior'
  );

  const mismaFechaSinDesempate = resolverActualizacionFotografiaTelemetria({
    actual,
    candidata: {
      ...actual,
      ultimaObservacionId: 100,
      recibidoEnUtc: '2026-07-07T11:00:09Z'
    }
  });
  assert.equal(mismaFechaSinDesempate.actualizar, false);
  assert.equal(
    mismaFechaSinDesempate.resultado,
    RESULTADOS_ACTUALIZACION_FOTOGRAFIA_TELEMETRIA.IGNORAR_MISMA_OBSERVACION
  );

  assert.equal(actual.valorNumero, 42);
  assert.equal(actual.detalleHumano, 'Lectura visible al operador.');

  assert.throws(
    () =>
      resolverActualizacionFotografiaTelemetria({
        actual,
        candidata: {
          ...actual,
          clave: 'ram',
          ultimaObservacionId: 103
        }
      }),
    /no coincide.*clave/
  );
}

main().catch((error) => {
  console.error('[agentes-telemetria] ERROR', error);
  process.exitCode = 1;
});
