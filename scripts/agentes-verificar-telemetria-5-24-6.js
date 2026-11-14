import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

import {
  construirPresentacionTelemetriaAgente,
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
const momentos = Object.freeze([
  Object.freeze({
    observadoEnUtc: '2026-08-26T08:00:00Z',
    valorMomentoUtc: '2026-08-25T20:00:00Z'
  }),
  Object.freeze({
    observadoEnUtc: '2026-08-26T09:00:00Z',
    valorMomentoUtc: '2026-08-27T03:30:00Z'
  }),
  Object.freeze({
    observadoEnUtc: '2026-08-26T10:00:00Z',
    valorMomentoUtc: '2026-08-27T03:30:00Z'
  }),
  Object.freeze({
    observadoEnUtc: '2026-08-26T11:00:00Z',
    valorMomentoUtc: '2026-08-26T22:15:00Z'
  })
]);

await main();

async function main() {
  verificarPresentacionTipada();
  await verificarLecturaComparacionYMiniatura();
  verificarAdaptacionGrafica();
  verificarActividadFederada();
  verificarZonasLocales();
  await verificarContratoUi();
  console.log(
    '[agentes] OK 5.24.6: momento_utc=escalera_local ' +
    'ejes=x_observado_y_valor comparacion=homogenea miniatura=escalonada ' +
    'federacion=canonica zonas=utc_madrid_nueva_york pol=ultimo_carril'
  );
}

function verificarPresentacionTipada() {
  const valor = formatearValorPresentacionTelemetria({
    tipoDato: 'momento_utc',
    valorMomentoUtc: '2030-01-02T03:04:05Z'
  });
  assert.equal(valor.texto, '2030-01-02T03:04:05Z');
  assert.equal(valor.textoCompleto, '2030-01-02T03:04:05Z');
  assert.equal(valor.valorBruto, '2030-01-02T03:04:05Z');
  assert.equal(valor.aptaVisualizacionTemporal, true);

  const presentacion = construirPresentacionTelemetriaAgente({
    historico: momentos.map((momento) => ({
      tipoDato: 'momento_utc',
      ...momento
    }))
  });
  assert.equal(presentacion.historico.tieneSerieTemporal, true);
  assert.equal(presentacion.historico.tipoSerieTemporal, 'momento_utc');
  assert.deepEqual(
    presentacion.historico.observaciones.map(({ observadoEnUtc, valor }) => ({
      observadoEnUtc,
      valor: valor.valorBruto
    })),
    momentos.map(({ observadoEnUtc, valorMomentoUtc }) => ({
      observadoEnUtc,
      valor: valorMomentoUtc
    }))
  );
}

async function verificarLecturaComparacionYMiniatura() {
  const agente = { id: 17, tenantId: 1, empresaId: 2, sitioId: 3 };
  const senales = [
    senal(21, 'momento_utc', null, 'copias.siguiente:a'),
    senal(22, 'momento_utc', null, 'copias.siguiente:b'),
    senal(23, 'duracion', null, 'copias.duracion:a'),
    senal(24, 'texto', null, 'copias.detalle:a')
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
      listarPorSenalYRango: async ({ senalId }) => [...momentos].reverse().map((momento) => ({
        agenteId: agente.id,
        senalId,
        codigoSenal: senales.find((item) => item.id === Number(senalId)).codigoSenal,
        tipoDato: 'momento_utc',
        ...momento,
        recibidoEnUtc: '2026-08-26T11:00:01Z'
      }))
    }
  });
  const comparacion = servicio.construirComparacionSenales({
    catalogoSenales: senales,
    filtros: {
      senalId: 21,
      senalIdsComparadas: [22, 23],
      limite: 10,
      orden: 'asc'
    }
  });
  assert.deepEqual(comparacion.senalesAceptadas.map(({ id }) => id), [22]);
  assert.deepEqual(comparacion.senalesRechazadas.map(({ id }) => id), [23]);

  const miniatura = await servicio.consultarMuestraSenal({}, agente.id, {
    senalId: 21
  });
  assert.equal(miniatura.senal.tipoDato, 'momento_utc');
  assert.deepEqual(
    miniatura.observaciones.map(({ observadoEnUtc, valorMomentoUtc }) => ({
      observadoEnUtc,
      valorMomentoUtc
    })),
    momentos
  );
  await assert.rejects(
    () => servicio.consultarMuestraSenal({}, agente.id, { senalId: 24 }),
    (error) => error?.codigo === 'senal_miniatura_no_graficable'
  );
}

function verificarAdaptacionGrafica() {
  const adaptada = ServicioAdministracionAgentesPortal.prototype
    .construirObservacionGraficoTelemetria({
      tipoDato: 'momento_utc',
      valor: {
        tipoDato: 'momento_utc',
        valorBruto: '2030-01-02T03:04:05Z',
        texto: '2030-01-02T03:04:05Z'
      },
      observadoEnUtc: '2026-08-26T10:00:00Z',
      recibidoEnUtc: '2026-08-26T10:00:01Z'
    });
  assert.equal(adaptada.valorMomentoUtc, '2030-01-02T03:04:05Z');
  assert.equal(adaptada.valorNumero, null);
  assert.equal(adaptada.valorDuracion, null);
  assert.equal(adaptada.observadoEnUtc, '2026-08-26T10:00:00Z');
  assert.equal(adaptada.recibidoEnUtc, '2026-08-26T10:00:01Z');
}

function verificarActividadFederada() {
  const entradas = momentos.map((momento, indice) => ({
    tipo: 'observacion',
    elementoOrigenId: `observacion-${indice}`,
    senalOrigenId: 'senal-momento',
    nombre: 'Siguiente copia',
    tipoDato: 'momento_utc',
    unidad: null,
    valor: momento.valorMomentoUtc,
    fechaUtc: momento.observadoEnUtc,
    recibidoEnUtc: '2026-08-26T11:00:01Z'
  }));
  entradas.push({
    tipo: 'observacion',
    elementoOrigenId: 'observacion-numero',
    senalOrigenId: 'senal-numero',
    nombre: 'Conteo',
    tipoDato: 'numero',
    unidad: null,
    valor: 4,
    fechaUtc: '2026-08-26T11:00:00Z'
  });
  const grafico = presentarGraficoActividadTelemetriaRemota(entradas);
  const grupo = grafico.unidades.find(({ tipoDato }) =>
    tipoDato === 'momento_utc');
  assert.ok(grupo);
  assert.equal(grupo.etiqueta, 'Momento UTC');
  assert.equal(grupo.series[0].puntos.length, 4);
  assert.deepEqual(
    grupo.series[0].puntos.map(({ fechaUtc, valor }) => ({ fechaUtc, valor })),
    momentos.map(({ observadoEnUtc, valorMomentoUtc }) => ({
      fechaUtc: observadoEnUtc,
      valor: valorMomentoUtc
    }))
  );
  assert.notEqual(
    grupo.clave,
    grafico.unidades.find(({ tipoDato }) => tipoDato === 'numero').clave
  );
}

function verificarZonasLocales() {
  const codigo = [
    "const valor = new Intl.DateTimeFormat('es-ES', {",
    "dateStyle: 'short', timeStyle: 'medium'",
    "}).format(new Date('2030-01-02T03:04:05Z'));",
    'process.stdout.write(valor);'
  ].join('\n');
  const representar = (zona) => execFileSync(process.execPath, ['-e', codigo], {
    encoding: 'utf8',
    env: { ...process.env, TZ: zona }
  });
  const utc = representar('UTC');
  const madrid = representar('Europe/Madrid');
  const nuevaYork = representar('America/New_York');
  assert.notEqual(utc, madrid);
  assert.notEqual(utc, nuevaYork);
  assert.notEqual(madrid, nuevaYork);
}

async function verificarContratoUi() {
  const [
    vista,
    js,
    miniaturas,
    servicioFederado,
    vistaRemota,
    jsRemoto,
    portal
  ] = await Promise.all([
    leer('apps/sentinelia-web/src/views/portal/agente-telemetria.ejs'),
    leer('apps/sentinelia-web/src/public/js/agente-telemetria.js'),
    leer('apps/sentinelia-web/src/public/js/agente-telemetria-miniaturas.js'),
    leer('paquetes/federacion/aplicacion/ServicioTelemetriaRemotaFederacionPortal.js'),
    leer('apps/sentinelia-web/src/views/portal/parciales/federacion-telemetria-remota.ejs'),
    leer('apps/sentinelia-web/src/public/js/federacion-telemetria-remota-actividad.js'),
    leer('apps/sentinelia-web/src/public/js/portal.js')
  ]);

  assert.match(vista, /data-fecha-utc="<%= senal\.valor\.valorBruto %>"/u);
  assert.match(vista, /title="UTC: <%= senal\.valor\.textoCompleto %>"/u);
  assert.match(vista, /'momento_utc'/u);
  assert.match(js, /fechaAMilisegundos\(observacion\.valorMomentoUtc\)/u);
  assert.match(js, /x: fecha\.getTime\(\)/u);
  assert.match(js, /stepped: esMomentoUtc \? 'after' : false/u);
  assert.match(js, /esMomentoUtc && !contexto\.raw\?\.observacion/u);
  assert.match(js, /spanGaps: false/u);
  assert.match(js, /formatearMomentoUtcEje/u);
  assert.match(js, /observacion\.valorMomentoUtc \?\? valorAlternativo/u);
  assert.ok(
    js.indexOf('detallePunto.observado') !== js.indexOf('detallePunto.recibido') &&
      js.includes('observacion.observadoEnUtc') &&
      js.includes('observacion.recibidoEnUtc'),
    'Observado y recibido deben conservar campos y etiquetas independientes.'
  );
  assert.match(miniaturas, /campoValor: 'valorMomentoUtc'/u);
  assert.match(miniaturas, /normalizarValor: fechaMs/u);
  assert.match(miniaturas, /escalonada: true/u);
  assert.match(miniaturas, /H \$\{punto\.x\} V \$\{punto\.y\}/u);
  assert.match(servicioFederado, /tipoDato === 'momento_utc'[\s\S]*observacion\.valor/u);
  assert.match(vistaRemota, /momentos UTC/u);
  assert.match(jsRemoto, /Date\.parse\(punto\.valor\)/u);
  assert.match(jsRemoto, /stepped: esMomentoUtc \? 'after' : false/u);
  assert.match(jsRemoto, /punto\.observacion\.valor/u);
  assert.match(portal, /Intl\.DateTimeFormat\('es-ES'/u);
  assert.match(portal, /nodo\.dateTime = fecha\.toISOString\(\)/u);
  assert.ok(
    vista.indexOf('data-agente-telemetria-pol-linea') >
      vista.indexOf('data-agente-telemetria-canvas') &&
    vistaRemota.indexOf('data-telemetria-remota-actividad-pol-linea') >
      vistaRemota.indexOf('data-telemetria-remota-actividad-canvas'),
    'POL debe seguir siendo el último carril tras la serie local y remota.'
  );
}

function senal(id, tipoDato, unidad, codigoSenal) {
  return {
    id,
    agenteId: 17,
    codigoSenal,
    categoria: 'copias',
    clave: codigoSenal,
    tag: null,
    tipoDato,
    unidad,
    nombreHumano: codigoSenal
  };
}

async function leer(ruta) {
  return readFile(new URL(ruta, raiz), 'utf8');
}
