import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { RuntimeSentinelia } from '../apps/sentinelia-runtime/src/RuntimeSentinelia.js';
import { SelectorMonitoresVencidos } from '../apps/sentinelia-runtime/src/scheduler/SelectorMonitoresVencidos.js';
import { SelectorMonitoresTelemetriaReactivos } from '../apps/sentinelia-runtime/src/telemetria/SelectorMonitoresTelemetriaReactivos.js';
import { SuscriptorInvalidacionesMonitoresTelemetriaRedis } from '../apps/sentinelia-runtime/src/telemetria/SuscriptorInvalidacionesMonitoresTelemetriaRedis.js';
import { PublicadorInvalidacionesMonitoresTelemetriaRedis } from '../paquetes/agentes/src/PublicadorInvalidacionesMonitoresTelemetriaRedis.js';
import { ServicioIngestaTelemetriaAgentes } from '../paquetes/agentes/src/ServicioIngestaTelemetriaAgentes.js';

const CANAL = 'sentinelia:prueba:telemetria:monitores:invalidacion';

async function main() {
  await verificarAvisoPosteriorYMinimo();
  await verificarFalloAvisoNoRevierteIngesta();
  await verificarSuscripcionSerializada();
  await verificarColaOperativaLocal();
  await verificarSeleccionIndexada();
  await verificarEjecucionReactivaEnRuntime();
  verificarSchedulerComoReconciliacion();
  await verificarFronterasYCicloComun();

  console.log(
    '[monitores-telemetria] OK invalidación, evaluación reactiva y reconciliación verificadas hasta 5.20b.5'
  );
}

async function verificarAvisoPosteriorYMinimo() {
  const publicaciones = [];
  const publicador = new PublicadorInvalidacionesMonitoresTelemetriaRedis({
    clienteRedis: {
      async publish(canal, contenido) {
        publicaciones.push({ canal, contenido: JSON.parse(contenido) });
        return 2;
      }
    },
    canal: CANAL,
    reloj: () => new Date('2026-07-20T16:00:00.000Z')
  });
  const resultado = await publicador.publicarFotografiasActualizadas({
    fotografias: [
      { agenteId: 31, senalId: 47, ultimaObservacionId: 9001, valorNumero: 96 },
      { agenteId: 31, senalId: 47, ultimaObservacionId: 9002, valorNumero: 97 },
      { agenteId: 31, senalId: 48, ultimaObservacionId: 9003, valorTexto: 'abierta' },
      { agenteId: null, senalId: 49, ultimaObservacionId: 9004 }
    ]
  });

  assert.deepEqual(resultado, { publicado: true, receptores: 2, totalSenales: 2 });
  assert.equal(publicaciones[0].canal, CANAL);
  assert.deepEqual(publicaciones[0].contenido, {
    tipo: 'fotografias_telemetria_actualizadas',
    totalSenales: 2,
    senales: [
      { agenteId: 31, senalId: 47, ultimaObservacionId: 9002 },
      { agenteId: 31, senalId: 48, ultimaObservacionId: 9003 }
    ],
    publicadoEnUtc: '2026-07-20T16:00:00.000Z'
  });
  assert.equal(JSON.stringify(publicaciones[0]).includes('valorNumero'), false);
  assert.equal(JSON.stringify(publicaciones[0]).includes('valorTexto'), false);

  const omitido = await publicador.publicarFotografiasActualizadas();
  assert.deepEqual(omitido, { publicado: false, receptores: 0, totalSenales: 0 });
  assert.equal(publicaciones.length, 1);
}

async function verificarFalloAvisoNoRevierteIngesta() {
  let intentos = 0;
  const servicio = new ServicioIngestaTelemetriaAgentes({
    repositorioCatalogoSenales: {},
    publicadorInvalidacionesMonitores: {
      async publicarFotografiasActualizadas() {
        intentos += 1;
        throw new Error('Redis no disponible');
      }
    }
  });
  await servicio.publicarInvalidacionesMonitoresSinAfectarIngesta({
    persistencia: {
      fotografiaActual: {
        fotografias: [{ agenteId: 31, senalId: 47, ultimaObservacionId: 9001 }]
      }
    }
  });
  assert.equal(intentos, 1);
  await servicio.publicarInvalidacionesMonitoresSinAfectarIngesta({
    persistencia: { fotografiaActual: { fotografias: [] } }
  });
  assert.equal(intentos, 1);
}

async function verificarSuscripcionSerializada() {
  const cliente = new ClienteSuscriptorRedisFalso();
  const orden = [];
  let liberarPrimera;
  const primeraPendiente = new Promise((resolve) => {
    liberarPrimera = resolve;
  });
  const suscriptor = new SuscriptorInvalidacionesMonitoresTelemetriaRedis({
    clienteRedis: { duplicate: () => cliente },
    canal: CANAL,
    onInvalidacion: async (aviso) => {
      const senalId = aviso.senales[0].senalId;
      orden.push(`inicio:${senalId}`);
      if (senalId === 47) {
        await primeraPendiente;
      }
      orden.push(`fin:${senalId}`);
    }
  });

  assert.equal((await suscriptor.arrancar()).activo, true);
  cliente.emitir('no-json');
  cliente.emitir(JSON.stringify({ tipo: 'otro', senales: [{ agenteId: 31, senalId: 47 }] }));
  cliente.emitir(crearMensajeAviso(47));
  cliente.emitir(crearMensajeAviso(48));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(orden, ['inicio:47']);
  liberarPrimera();
  const resumen = await suscriptor.detener();
  assert.deepEqual(orden, ['inicio:47', 'fin:47', 'inicio:48', 'fin:48']);
  assert.equal(resumen.activo, false);
  assert.equal(resumen.totalAvisos, 2);
  assert.equal(cliente.desuscrito, true);
  assert.equal(cliente.cerrado, true);
}

async function verificarColaOperativaLocal() {
  const runtime = new RuntimeSentinelia({
    configuracion: { runtime: { instanciaId: 'runtime-cola' } },
    bootstrapRuntime: {}
  });
  const orden = [];
  let liberarPrimera;
  const primeraPendiente = new Promise((resolve) => {
    liberarPrimera = resolve;
  });
  const primera = runtime.encolarOperacionMonitores(async () => {
    orden.push('tick_inicio');
    await primeraPendiente;
    orden.push('tick_fin');
  });
  const segunda = runtime.encolarOperacionMonitores(async () => {
    orden.push('invalidacion');
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(orden, ['tick_inicio']);
  liberarPrimera();
  await Promise.all([primera, segunda]);
  assert.deepEqual(orden, ['tick_inicio', 'tick_fin', 'invalidacion']);

  await assert.rejects(
    runtime.encolarOperacionMonitores(async () => {
      throw new Error('fallo operativo simulado');
    }),
    /fallo operativo simulado/
  );
  await runtime.encolarOperacionMonitores(async () => orden.push('recuperada'));
  assert.equal(orden.at(-1), 'recuperada');
}

async function verificarSeleccionIndexada() {
  const consultas = [];
  const selector = new SelectorMonitoresTelemetriaReactivos({
    repositorioVinculos: {
      async listarPorSenalDirecta(senal) {
        consultas.push(senal);
        return senal.senalId === 47
          ? [{ monitorId: 501 }, { monitorId: 502 }]
          : [{ monitorId: 501 }, { monitorId: 503 }, { monitorId: 504 }];
      },
      async listarPorReglaDerivacion() {
        return [];
      }
    }
  });
  const monitores = new Map([
    [501, crearMonitor(501, 'telemetria', true)],
    [502, crearMonitor(502, 'telemetria', false)],
    [503, crearMonitor(503, 'ping', true)]
  ]);
  const seleccion = await selector.seleccionar({
    catalogoOperativo: { buscarPorId: (id) => monitores.get(id) || null },
    aviso: {
      senales: [
        { agenteId: 31, senalId: 47 },
        { agenteId: 31, senalId: 47 },
        { agenteId: 31, senalId: 48 }
      ]
    },
    fechaEvaluacionUtc: '2026-07-20T16:01:00.000Z'
  });

  assert.deepEqual(consultas, [
    { agenteId: 31, senalId: 47 },
    { agenteId: 31, senalId: 48 }
  ]);
  assert.equal(seleccion.totalVinculos, 4);
  assert.deepEqual(seleccion.candidatos.map((item) => item.monitorId), [501]);
  assert.equal(seleccion.candidatos[0].motivoProgramacion, 'invalidacion_telemetria_directa');
  assert.deepEqual(
    seleccion.descartados.map((item) => item.motivo).sort(),
    ['monitor_fuera_catalogo', 'monitor_inactivo', 'tipo_monitor_incompatible']
  );
}

async function verificarEjecucionReactivaEnRuntime() {
  const runtime = new RuntimeSentinelia({
    configuracion: { runtime: { instanciaId: 'runtime-prueba' } },
    bootstrapRuntime: {}
  });
  const candidato = {
    monitorId: 501,
    nombre: 'Temperatura',
    tipo: 'telemetria',
    versionCatalogo: 'v501',
    scope: { tenantId: 1, empresaId: 2, sitioId: 3 },
    proximoIntentoEn: '2026-07-20T16:02:00.000Z',
    retrasoSegundos: 0,
    motivoProgramacion: 'invalidacion_telemetria_directa'
  };
  const llamadas = [];
  runtime.contexto = { sincronizacionRedis: {} };
  runtime.catalogoOperativo = {};
  runtime.estadoVivo = {};
  runtime.selectorMonitoresTelemetriaReactivos = {
    async seleccionar() {
      llamadas.push('seleccionar_vinculos');
      return {
        totalSenales: 1,
        totalVinculos: 1,
        totalCandidatos: 1,
        totalDescartados: 0,
        candidatos: [candidato],
        descartados: []
      };
    }
  };
  runtime.sincronizarCatalogoSiHaCambiado = async () => llamadas.push('catalogo');
  runtime.bloqueadorEjecucionMonitorRedis = {
    async bloquearCandidatos({ origen }) {
      llamadas.push(`bloquear:${origen}`);
      return {
        candidatosBloqueados: [candidato],
        candidatosSaltados: [],
        bloqueos: [{ clave: 'monitor:501' }],
        resumen: { totalCandidatos: 1, totalBloqueados: 1, totalSaltados: 0 }
      };
    },
    async liberarBloqueos() {
      llamadas.push('liberar');
      return { totalBloqueos: 1, totalLiberados: 1, totalNoLiberados: 0 };
    }
  };
  runtime.motorMonitores = {
    async ejecutarMonitores({ candidatos }) {
      llamadas.push('ejecutar');
      assert.deepEqual(candidatos, [candidato]);
      return {
        ejecutadoEnUtc: '2026-07-20T16:02:00.000Z',
        finalizadoEnUtc: '2026-07-20T16:02:01.000Z',
        totalCandidatos: 1,
        totalEjecutados: 1,
        totalExitosos: 0,
        totalFallidos: 1,
        resultados: [{ monitorId: 501 }]
      };
    }
  };
  runtime.aplicarCicloOperativoMonitores = async ({ origen, candidatos }) => {
    llamadas.push(`ciclo:${origen}`);
    assert.deepEqual(candidatos, [candidato]);
    return { persistenciaAlertas: { totalAperturas: 1 } };
  };
  runtime.selectorMonitoresVencidos = {
    seleccionar() {
      llamadas.push('reprogramar');
      return { programaciones: [] };
    }
  };
  runtime.aplicarProgramacionesEnEstado = () => llamadas.push('aplicar_programacion');
  runtime.actualizarResumenScheduler = () => llamadas.push('resumen');
  runtime.sincronizarRedisOperativo = async () => llamadas.push('redis_operativo');
  runtime.suscriptorInvalidacionesMonitoresTelemetriaRedis = {
    serializarResumen: () => ({ activo: true, canal: CANAL })
  };

  const resumen = await runtime.procesarInvalidacionMonitoresTelemetria({
    senales: [{ agenteId: 31, senalId: 47 }]
  });
  assert.equal(resumen.totalEjecutados, 1);
  assert.deepEqual(resumen.monitorIdsEjecutados, [501]);
  assert.deepEqual(llamadas, [
    'catalogo',
    'seleccionar_vinculos',
    'bloquear:invalidacion_telemetria_directa',
    'ejecutar',
    'ciclo:invalidacion_telemetria_directa',
    'liberar',
    'reprogramar',
    'aplicar_programacion',
    'resumen',
    'redis_operativo'
  ]);
}

function verificarSchedulerComoReconciliacion() {
  const monitor = crearMonitor(501, 'telemetria', true);
  monitor.programacion = {
    intervaloEjecucionSegundos: 60,
    desfaseInicialSegundos: 0
  };
  monitor.version = '2026-07-20T15:00:00.000Z';
  const seleccion = new SelectorMonitoresVencidos().seleccionar({
    catalogoOperativo: { monitores: [monitor] },
    almacenEstadoActual: {
      buscarPorMonitorId() {
        return {
          fechaUltimaEjecucionUtc: '2026-07-20T15:58:00.000Z',
          resultadoActual: null
        };
      }
    },
    fechaEvaluacionUtc: '2026-07-20T16:00:00.000Z'
  });
  assert.equal(seleccion.totalVencidos, 1);
  assert.equal(seleccion.monitoresVencidos[0].monitorId, 501);
  assert.equal(
    seleccion.monitoresVencidos[0].motivoProgramacion,
    'intervalo_desde_ultima_ejecucion'
  );
}

async function verificarFronterasYCicloComun() {
  const [servicio, runtime, web] = await Promise.all([
    readFile(
      new URL('../paquetes/agentes/src/ServicioIngestaTelemetriaAgentes.js', import.meta.url),
      'utf8'
    ),
    readFile(
      new URL('../apps/sentinelia-runtime/src/RuntimeSentinelia.js', import.meta.url),
      'utf8'
    ),
    readFile(
      new URL('../apps/sentinelia-web/src/index.js', import.meta.url),
      'utf8'
    )
  ]);
  assert.ok(
    servicio.indexOf('await conexion.commit()') <
      servicio.lastIndexOf('publicarInvalidacionesMonitoresSinAfectarIngesta(resultado)')
  );
  assert.ok(servicio.includes('fotografiaActual?.fotografias'));
  assert.ok(web.includes('PublicadorInvalidacionesMonitoresTelemetriaRedis'));
  assert.equal(web.includes('aplicarCicloOperativoMonitores'), false);
  assert.equal(
    runtime.match(/this\.aplicarCicloOperativoMonitores\(\{/g)?.length,
    2,
    'Scheduler e invalidación deben compartir exactamente el mismo ciclo operativo.'
  );
  assert.ok(runtime.includes('new SuscriptorInvalidacionesMonitoresTelemetriaRedis({'));
  assert.ok(runtime.includes('new SelectorMonitoresTelemetriaReactivos({'));
}

function crearMonitor(id, tipo, activo) {
  return {
    id,
    nombre: `Monitor ${id}`,
    tipo,
    activo,
    version: `v${id}`,
    scope: {
      tenantId: 1,
      empresaId: 2,
      sitioId: 3,
      nivelPertenencia: 'sitio'
    }
  };
}

function crearMensajeAviso(senalId) {
  return JSON.stringify({
    tipo: 'fotografias_telemetria_actualizadas',
    senales: [{ agenteId: 31, senalId, ultimaObservacionId: 9000 + senalId }]
  });
}

class ClienteSuscriptorRedisFalso {
  isOpen = false;
  desuscrito = false;
  cerrado = false;
  callback = null;

  on() {}

  async connect() {
    this.isOpen = true;
  }

  async subscribe(canal, callback) {
    assert.equal(canal, CANAL);
    this.callback = callback;
  }

  emitir(mensaje) {
    this.callback(mensaje);
  }

  async unsubscribe(canal) {
    assert.equal(canal, CANAL);
    this.desuscrito = true;
  }

  async quit() {
    this.isOpen = false;
    this.cerrado = true;
  }
}

await main();
