import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  construirPresentacionTelemetriaAgente,
  formatearDuracionExactaTelemetria,
  formatearDuracionHumanaTelemetria,
  formatearValorPresentacionTelemetria
} from '../paquetes/agentes/src/PresentacionTelemetriaAgentes.js';
import {
  ServicioLecturaTelemetriaAgentes
} from '../paquetes/agentes/src/ServicioLecturaTelemetriaAgentes.js';
import {
  ServicioAdministracionAgentesPortal
} from '../apps/sentinelia-web/src/servicios/ServicioAdministracionAgentesPortal.js';
import {
  presentarGraficoActividadTelemetriaRemota
} from '../paquetes/federacion/aplicacion/ServicioTelemetriaRemotaFederacionPortal.js';

const raiz = new URL('../', import.meta.url);

await main();

async function main() {
  verificarPresentacionHumana();
  await verificarLecturaYComparacion();
  verificarAdaptacionGrafica();
  verificarAgrupacionFederada();
  await verificarContratoUi();
  console.log(
    '[agentes] OK 5.24.5: duracion=humana_exacta ' +
    'historico=comparacion_homogenea miniaturas=ajax_progresivo ' +
    'visores=local_federado pol=ultimo_carril momento_utc=abierto_por_5_24_6'
  );
}

function verificarPresentacionHumana() {
  const casos = [
    [0, '0 s'],
    [0.0001, '0,1 ms'],
    [0.125, '125 ms'],
    [45.125, '45,125 s'],
    [90, '1 min 30 s'],
    [3723.4567, '1 h 2 min'],
    [86_400, '1 d'],
    [31_536_000, '1 a']
  ];

  for (const [valor, esperado] of casos) {
    assert.equal(formatearDuracionHumanaTelemetria(valor), esperado);
  }

  assert.equal(formatearDuracionExactaTelemetria(3723.4567), '3723.4567 s');
  assert.equal(
    formatearDuracionExactaTelemetria(Number.MAX_VALUE),
    `${String(Number.MAX_VALUE)} s`
  );
  assert.equal(formatearDuracionHumanaTelemetria(-1), 'sin valor');

  const duracion = formatearValorPresentacionTelemetria({
    tipoDato: 'duracion',
    valorDuracion: 3723.4567
  });
  const momento = formatearValorPresentacionTelemetria({
    tipoDato: 'momento_utc',
    valorMomentoUtc: '2030-01-02T03:04:05Z'
  });
  assert.equal(duracion.texto, '1 h 2 min');
  assert.equal(duracion.textoCompleto, '3723.4567 s');
  assert.equal(duracion.aptaVisualizacionTemporal, true);
  assert.equal(momento.aptaVisualizacionTemporal, true);
  assert.equal(
    construirPresentacionTelemetriaAgente({
      historico: [{ tipoDato: 'duracion', valorDuracion: 1 }]
    }).historico.tipoSerieTemporal,
    'duracion'
  );
}

async function verificarLecturaYComparacion() {
  const agente = { id: 7, tenantId: 1, empresaId: 2, sitioId: 3 };
  const senales = [
    senal(11, 'duracion', null, 'copias.duracion:a'),
    senal(12, 'duracion', 's', 'copias.duracion:b'),
    senal(13, 'numero', null, 'copias.conteo:a'),
    senal(14, 'texto', null, 'copias.detalle:a')
  ];
  const servicio = new ServicioLecturaTelemetriaAgentes({
    servicioProvisionamientoAgentes: {
      listarAgentesVisibles: async () => [agente]
    },
    repositorioCatalogoSenales: {
      listarPorAgente: async () => senales,
      buscarPorId: async (id) => senales.find((item) => item.id === Number(id))
    },
    repositorioEstadoActual: { listarPorAgente: async () => [] },
    repositorioObservaciones: {
      listarPorSenalYRango: async ({ senalId }) => [{
        agenteId: agente.id,
        senalId,
        codigoSenal: senales.find((item) => item.id === Number(senalId)).codigoSenal,
        tipoDato: 'duracion',
        valorDuracion: 1.25,
        observadoEnUtc: '2026-08-26T10:00:00.000Z'
      }]
    }
  });
  const filtros = {
    senalId: 11,
    senalIdsComparadas: [12, 13],
    limite: 10,
    orden: 'asc'
  };
  const comparacion = servicio.construirComparacionSenales({
    catalogoSenales: senales,
    filtros
  });
  assert.deepEqual(comparacion.senalesAceptadas.map(({ id }) => id), [12]);
  assert.deepEqual(comparacion.senalesRechazadas.map(({ id }) => id), [13]);

  const miniatura = await servicio.consultarMuestraSenal({}, agente.id, {
    senalId: 11
  });
  assert.equal(miniatura.senal.tipoDato, 'duracion');
  assert.equal(miniatura.observaciones[0].valorDuracion, 1.25);
  await assert.rejects(
    () => servicio.consultarMuestraSenal({}, agente.id, { senalId: 14 }),
    (error) => error?.codigo === 'senal_miniatura_no_graficable'
  );
}

function verificarAdaptacionGrafica() {
  const adaptada = ServicioAdministracionAgentesPortal.prototype
    .construirObservacionGraficoTelemetria({
      tipoDato: 'duracion',
      valor: { tipoDato: 'duracion', valorBruto: 12.5, texto: '12,5 s' },
      observadoEnUtc: '2026-08-26T10:00:00.000Z'
    });
  assert.equal(adaptada.valorDuracion, 12.5);
  assert.equal(adaptada.valorNumero, null);
  for (const metadatos of [null, {}, { disco: { libre: 0, activo: false }, etiquetas: ['a', 'b'], texto: '<img src=x onerror=alert(1)>' }]) {
    const presentacion = construirPresentacionTelemetriaAgente({
      historico: [{ tipoDato: 'numero', valorNumero: 42, metadatos }]
    });
    const observacion = presentacion.historico.observaciones[0];
    const grafico = ServicioAdministracionAgentesPortal.prototype
      .construirObservacionGraficoTelemetria(observacion);
    assert.deepEqual(grafico.metadatos, metadatos,
      'El histórico debe preservar los metadatos estructurados hasta el gráfico.');
  }
  assert.equal(adaptada.metadatos, null);
}

function verificarAgrupacionFederada() {
  const grafico = presentarGraficoActividadTelemetriaRemota([
    observacionRemota('senal-duracion', 'duracion', null, 30),
    observacionRemota('senal-numero', 'numero', null, 30),
    observacionRemota('senal-texto', 'texto', null, 'treinta')
  ]);
  assert.equal(grafico.totalPuntos, 2);
  assert.equal(grafico.unidades.length, 2);
  assert.deepEqual(
    new Set(grafico.unidades.map(({ tipoDato }) => tipoDato)),
    new Set(['duracion', 'numero'])
  );
  assert.notEqual(grafico.unidades[0].clave, grafico.unidades[1].clave);
  assert.equal(grafico.unidades.find(({ tipoDato }) =>
    tipoDato === 'duracion').etiqueta, 'Duración · segundos');
}

async function verificarContratoUi() {
  const [vista, js, miniaturas, vistaRemota, jsRemoto] = await Promise.all([
    leer('apps/sentinelia-web/src/views/portal/agente-telemetria.ejs'),
    leer('apps/sentinelia-web/src/public/js/agente-telemetria.js'),
    leer('apps/sentinelia-web/src/public/js/agente-telemetria-miniaturas.js'),
    leer('apps/sentinelia-web/src/views/portal/parciales/federacion-telemetria-remota.ejs'),
    leer('apps/sentinelia-web/src/public/js/federacion-telemetria-remota-actividad.js')
  ]);

  assert.match(vista, /const tiposSerieTemporal = new Set\([\s\S]*?'momento_utc'/u);
  assert.match(vista, /valor exacto <%= senal\.valor\.textoCompleto %>/u);
  assert.ok(
    vista.indexOf('data-agente-telemetria-pol-linea') >
      vista.indexOf('data-agente-telemetria-canvas'),
    'POL debe conservarse después de la representación de la señal.'
  );
  assert.match(js, /portal:themechange/u);
  assert.match(js, /formatearDuracionHumana/u);
  assert.match(js, /observacion\.valorDuracion/u);
  assert.match(miniaturas, /IntersectionObserver/u);
  assert.match(miniaturas, /limiteConcurrencia = 3/u);
  assert.match(miniaturas, /campoValor: 'valorDuracion'/u);
  assert.match(miniaturas, /tendencia aún no demostrable/u);
  assert.match(vistaRemota, /separada por semántica/u);
  assert.match(jsRemoto, /grupo\?\.tipoDato !== 'duracion'/u);
  assert.match(jsRemoto, /portal:themechange/u);
}

function senal(id, tipoDato, unidad, codigoSenal) {
  return {
    id,
    agenteId: 7,
    codigoSenal,
    categoria: 'copias',
    clave: codigoSenal,
    tag: null,
    tipoDato,
    unidad,
    nombreHumano: codigoSenal
  };
}

function observacionRemota(senalOrigenId, tipoDato, unidad, valor) {
  return {
    tipo: 'observacion',
    elementoOrigenId: `observacion-${senalOrigenId}`,
    senalOrigenId,
    nombre: senalOrigenId,
    tipoDato,
    unidad,
    valor,
    fechaUtc: '2026-08-26T10:00:00.000Z'
  };
}

async function leer(ruta) {
  return readFile(new URL(ruta, raiz), 'utf8');
}
