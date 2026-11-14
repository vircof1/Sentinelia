import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  EstadoRuntimeServidorAgente,
  EvidenciaPolServidorAgente
} from '../paquetes/agentes/src/EstadoRuntimeServidorAgente.js';
import {
  RepositorioEstadoRuntimeServidorAgentes
} from '../paquetes/agentes/src/RepositorioEstadoRuntimeServidorAgentes.js';
import {
  ProcesadorSenalesServidorRuntime
} from '../apps/sentinelia-runtime/src/agentes/ProcesadorSenalesServidorRuntime.js';

const RAIZ = new URL('../', import.meta.url);
const AHORA = new Date('2026-08-24T14:10:00.000Z');

await main();

async function main() {
  await verificarRecorridoSqlCronologico();
  await verificarMismoBootIdNoDeclaraReinicio();
  await verificarCambioVigenteDeclaraReinicio();
  await verificarCambiosRepetidosConservanOcurrencias();
  await verificarVentanaCompletaCaidaSeCompacta();
  await verificarBacklogNoCierraUnaVentanaQueSigueVigente();
  await verificarDocumentacionYComposicion();

  console.log(
    '[agentes] OK 5.23.5: bootid=referencia_causal ' +
    'reinicio=ocurrencia_repetible ventana=duracion_capturada ' +
    'backlog=cronologico expirado=sin_historia_inventada ' +
    'checkpoint=monotono indice=agente_periodo'
  );
}

async function verificarRecorridoSqlCronologico() {
  const operaciones = [];
  const conexion = {
    async execute(sql, parametros) {
      operaciones.push({ sql, parametros });
      if (sql.includes('INNER JOIN periodos_vida_pol_agentes pol')) {
        return [[], []];
      }
      if (sql.includes('UPDATE estados_runtime_servidor_agentes')) {
        return [{ affectedRows: 1 }, []];
      }
      if (sql.includes('FROM estados_runtime_servidor_agentes e')) {
        return [[filaEstadoSql({
          boot_id_referencia: 'boot-b',
          ultimo_periodo_pol_id: 41,
          ultimo_seq: 8,
          ultimo_pol_utc: '2026-08-24 14:09:00.000',
          valor_reinicio_reciente: 1,
          vence_reinicio_reciente_utc: '2026-08-24 14:13:00.000',
          duracion_reinicio_capturada_segundos: 300,
          ultimo_cambio_boot_id_utc: '2026-08-24 14:08:00.000'
        })], []];
      }
      throw new Error(`SQL no esperado: ${sql}`);
    }
  };
  const repositorio = new RepositorioEstadoRuntimeServidorAgentes({});
  await repositorio.bloquearCandidatosPolEnTransaccion(
    { limite: 20 },
    { conexion }
  );
  const seleccion = operaciones[0];
  assert.match(seleccion.sql, /ORDER BY pol_candidato\.id ASC/u);
  assert.match(
    seleccion.sql,
    /pol_candidato\.id > e\.ultimo_periodo_pol_id/u
  );
  assert.match(
    seleccion.sql,
    /TRIM\(e\.boot_id_referencia\) <>\s+TRIM\(pol_candidato\.boot_id\)/u
  );
  assert.match(seleccion.sql, /FOR UPDATE SKIP LOCKED/u);

  await repositorio.aplicarPolEnTransaccion({
    agenteId: 7,
    generacion: 2,
    bootIdReferencia: 'boot-b',
    reemplazarBootIdReferencia: true,
    periodoVidaPolId: 41,
    ultimoSeq: 8,
    ultimoPolUtc: '2026-08-24T14:09:00.000Z',
    tipoUltimoPol: 'heartbeat',
    valorSinPol: false,
    venceSinPolUtc: '2026-08-24T14:11:00.000Z',
    histeresisSinPolCapturadaSegundos: 120,
    valorReinicioReciente: true,
    venceReinicioRecienteUtc: '2026-08-24T14:13:00.000Z',
    duracionReinicioCapturadaSegundos: 300,
    ultimoCambioBootIdUtc: '2026-08-24T14:08:00.000Z',
    checkpointCausal: 'reinicio:periodo:41'
  }, { conexion });
  const actualizacion = operaciones.find(({ sql }) =>
    sql.includes('UPDATE estados_runtime_servidor_agentes')
  );
  assert.match(actualizacion.sql, /WHEN \? THEN \? ELSE COALESCE/u);
  assert.match(actualizacion.sql, /vence_reinicio_reciente_utc = \?/u);
  assert.match(actualizacion.sql, /ultimo_cambio_boot_id_utc = \?/u);
  assert.match(
    actualizacion.sql,
    /\?\s+AND ultimo_periodo_pol_id = \?\s+AND/u
  );

  const migracion = await leer(
    'migraciones/sql/0001_esquema_inicial.sql'
  ).then(normalizarSqlConsolidado);
  assert.match(
    migracion,
    /idx_periodos_pol_agente_checkpoint\s*\(agente_id, id, ultimo_seq\)/u
  );
}

async function verificarMismoBootIdNoDeclaraReinicio() {
  const entorno = crearEntorno({
    estadoInicial: crearEstado(),
    evidencias: [crearEvidencia({
      id: 41,
      boot_id: 'boot-a',
      inicio_utc: '2026-08-24 14:08:00.000',
      ultimo_heartbeat_utc: '2026-08-24 14:09:00.000'
    })]
  });
  const resultado = await entorno.procesador.procesarPendientes();
  assert.equal(resultado.totalEvidenciasPolReducidas, 1);
  assert.equal(resultado.totalReiniciosDetectados, 0);
  assert.equal(resultado.totalTransiciones, 0);
  assert.equal(entorno.estadoActual.bootIdReferencia, 'boot-a');
  assert.equal(entorno.aplicaciones[0].reemplazarBootIdReferencia, false);
}

async function verificarCambioVigenteDeclaraReinicio() {
  const entorno = crearEntorno({
    estadoInicial: crearEstado(),
    evidencias: [crearEvidencia({
      id: 41,
      boot_id: 'boot-b',
      inicio_utc: '2026-08-24 14:08:00.000',
      ultimo_heartbeat_utc: '2026-08-24 14:09:00.000'
    })]
  });
  const resultado = await entorno.procesador.procesarPendientes();
  assert.equal(resultado.totalReiniciosDetectados, 1);
  assert.equal(resultado.totalVentanasReinicioDescartadas, 0);
  assert.equal(resultado.totalTransiciones, 1);
  const transicion = entorno.publicaciones[0].transiciones[0];
  assert.equal(transicion.codigoSenal, 'runtime.servidor.reinicio_reciente');
  assert.equal(transicion.valor, true);
  assert.equal(transicion.observadoEnUtc, '2026-08-24T14:08:00.000Z');
  assert.equal(transicion.vigenteHastaUtc, '2026-08-24T14:13:00.000Z');
  assert.match(transicion.detalleHumano, /cambio de identidad de arranque/u);
  assert.doesNotMatch(transicion.detalleHumano, /causa|eléctric|legítim/iu);
  assert.equal(entorno.estadoActual.bootIdReferencia, 'boot-b');
  assert.equal(entorno.estadoActual.valorReinicioReciente, true);
  assert.equal(
    entorno.estadoActual.venceReinicioRecienteUtc,
    '2026-08-24T14:13:00.000Z'
  );
  assert.equal(entorno.estadoActual.duracionReinicioCapturadaSegundos, 300);
  assert.equal(
    entorno.estadoActual.ultimoCambioBootIdUtc,
    '2026-08-24T14:08:00.000Z'
  );
}

async function verificarCambiosRepetidosConservanOcurrencias() {
  const entorno = crearEntorno({
    estadoInicial: crearEstado(),
    evidencias: [
      crearEvidencia({
        id: 41,
        boot_id: 'boot-b',
        inicio_utc: '2026-08-24 14:06:00.000',
        ultimo_heartbeat_utc: '2026-08-24 14:07:00.000'
      }),
      crearEvidencia({
        id: 42,
        boot_id: 'boot-c',
        inicio_utc: '2026-08-24 14:08:00.000',
        ultimo_heartbeat_utc: '2026-08-24 14:09:00.000'
      })
    ]
  });
  const resultado = await entorno.procesador.procesarPendientes();
  assert.equal(resultado.totalEvidenciasPolReducidas, 2);
  assert.equal(resultado.totalReiniciosDetectados, 2);
  assert.equal(resultado.totalTransiciones, 2);
  assert.deepEqual(
    entorno.publicaciones.flatMap(({ transiciones }) => transiciones)
      .map(({ valor, observadoEnUtc, vigenteHastaUtc }) => ({
        valor,
        observadoEnUtc,
        vigenteHastaUtc
      })),
    [
      {
        valor: true,
        observadoEnUtc: '2026-08-24T14:06:00.000Z',
        vigenteHastaUtc: '2026-08-24T14:11:00.000Z'
      },
      {
        valor: true,
        observadoEnUtc: '2026-08-24T14:08:00.000Z',
        vigenteHastaUtc: '2026-08-24T14:13:00.000Z'
      }
    ]
  );
  assert.equal(new Set(entorno.clavesCausales).size, 2);
  assert.equal(entorno.estadoActual.bootIdReferencia, 'boot-c');
  assert.equal(
    entorno.estadoActual.venceReinicioRecienteUtc,
    '2026-08-24T14:13:00.000Z'
  );
}

async function verificarVentanaCompletaCaidaSeCompacta() {
  const entorno = crearEntorno({
    estadoInicial: crearEstado({
      valor_sin_pol: 1,
      vence_sin_pol_utc: null
    }),
    evidencias: [crearEvidencia({
      id: 41,
      boot_id: 'boot-b',
      inicio_utc: '2026-08-24 13:00:00.000',
      ultimo_heartbeat_utc: '2026-08-24 13:01:00.000'
    })]
  });
  const resultado = await entorno.procesador.procesarPendientes();
  assert.equal(resultado.totalReiniciosDetectados, 0);
  assert.equal(resultado.totalVentanasReinicioDescartadas, 1);
  assert.equal(resultado.totalTransiciones, 0);
  assert.equal(entorno.estadoActual.bootIdReferencia, 'boot-b');
  assert.equal(entorno.estadoActual.valorSinPol, true);
  assert.equal(entorno.estadoActual.valorReinicioReciente, false);
  assert.equal(entorno.estadoActual.venceReinicioRecienteUtc, null);
  assert.equal(
    entorno.estadoActual.ultimoCambioBootIdUtc,
    '2026-08-24T13:00:00.000Z'
  );
}

async function verificarBacklogNoCierraUnaVentanaQueSigueVigente() {
  const entorno = crearEntorno({
    estadoInicial: crearEstado({
      valor_reinicio_reciente: 1,
      vence_reinicio_reciente_utc: '2026-08-24 14:05:00.000',
      duracion_reinicio_capturada_segundos: 300,
      ultimo_cambio_boot_id_utc: '2026-08-24 14:00:00.000'
    }),
    evidencias: [
      crearEvidencia({
        id: 41,
        boot_id: 'boot-b',
        inicio_utc: '2026-08-24 13:30:00.000',
        ultimo_heartbeat_utc: '2026-08-24 13:31:00.000'
      }),
      crearEvidencia({
        id: 42,
        boot_id: 'boot-c',
        inicio_utc: '2026-08-24 14:09:00.000',
        ultimo_heartbeat_utc: null,
        ultimo_seq: null,
        heartbeats_recibidos: 0
      })
    ],
    comprobarVencimientos: true
  });
  const resultado = await entorno.procesador.procesarPendientes();
  const transiciones = entorno.publicaciones
    .flatMap(({ transiciones: lote }) => lote);
  assert.equal(resultado.totalVentanasReinicioDescartadas, 1);
  assert.equal(resultado.totalReiniciosDetectados, 1);
  assert.deepEqual(transiciones.map(({ valor }) => valor), [true]);
  assert.equal(entorno.resoluciones.length, 0);
  assert.equal(entorno.estadoActual.bootIdReferencia, 'boot-c');
  assert.equal(
    entorno.estadoActual.venceReinicioRecienteUtc,
    '2026-08-24T14:14:00.000Z'
  );
}

async function verificarDocumentacionYComposicion() {
  const [paquete, procesador] = await Promise.all([
    leer('package.json'),
    leer('apps/sentinelia-runtime/src/agentes/ProcesadorSenalesServidorRuntime.js')
  ]);
  assert.match(paquete, /agentes:verificar-perfil-servidor-5-23-5/u);
  assert.match(procesador, /causa: 'boot_id_cambiado'/u);
  assert.match(procesador, /vigenteHastaUtc: nuevoVencimientoReinicio/u);
}

function crearEntorno({
  estadoInicial,
  evidencias,
  perfil = crearPerfil(),
  comprobarVencimientos = false
}) {
  let estadoActual = estadoInicial;
  const cola = [...evidencias];
  const aplicaciones = [];
  const publicaciones = [];
  const clavesCausales = [];
  const resoluciones = [];
  let siguienteTransicionId = 1;
  let siguienteObservacionId = 101;
  let vencimientosConsultados = false;

  const repositorio = {
    async bloquearCandidatosPolEnTransaccion() {
      const evidencia = cola.shift();
      return evidencia ? [{ perfil, estado: estadoActual, evidencia }] : [];
    },
    async bloquearCandidatosEnTransaccion() {
      if (!comprobarVencimientos || vencimientosConsultados) return [];
      vencimientosConsultados = true;
      return [{ perfil, estado: estadoActual }];
    },
    async crearParaPerfilEnTransaccion() {
      throw new Error('La prueba exige una proyección existente.');
    },
    async registrarTransicionEnTransaccion(datos) {
      clavesCausales.push(datos.claveCausal);
      return {
        creada: true,
        transicion: {
          id: siguienteTransicionId++,
          materializadaEnUtc: null,
          observacionTelemetriaId: null
        }
      };
    },
    async confirmarTransicionEnTransaccion() {},
    async aplicarPolEnTransaccion(datos) {
      aplicaciones.push(datos);
      estadoActual = crearEstadoDesdeAplicacion(estadoActual, datos);
      entorno.estadoActual = estadoActual;
      return estadoActual;
    },
    async resolverVencimientosEnTransaccion(datos) {
      resoluciones.push(datos);
      estadoActual = crearEstado({
        ...estadoActual.serializar(),
        valor_sin_pol: datos.resolverSinPol ? 1 : estadoActual.valorSinPol,
        vence_sin_pol_utc: datos.resolverSinPol
          ? null
          : estadoActual.venceSinPolUtc,
        valor_reinicio_reciente: datos.resolverReinicioReciente
          ? 0
          : estadoActual.valorReinicioReciente,
        vence_reinicio_reciente_utc: datos.resolverReinicioReciente
          ? null
          : estadoActual.venceReinicioRecienteUtc,
        version_estado: estadoActual.versionEstado + 1
      });
      entorno.estadoActual = estadoActual;
      return estadoActual;
    }
  };
  const procesador = new ProcesadorSenalesServidorRuntime({
    repositorioEstadoRuntime: repositorio,
    publicadorTelemetriaRuntime: {
      async publicarTransicionesEnTransaccion(datos) {
        publicaciones.push(datos);
        return {
          persistencia: {
            observaciones: datos.transiciones.map(() => ({
              id: siguienteObservacionId++
            }))
          },
          efectosPostCommit: {
            trabajosEvaluacionIds: [],
            fotografiasActualizadas: []
          }
        };
      }
    },
    fronteraTransaccional: {
      async ejecutar(operacion) {
        return operacion({ execute: async () => [[], []] });
      }
    },
    reloj: () => AHORA
  });
  const entorno = {
    procesador,
    estadoActual,
    aplicaciones,
    publicaciones,
    clavesCausales,
    resoluciones
  };
  return entorno;
}

function crearEstadoDesdeAplicacion(anterior, datos) {
  return crearEstado({
    agente_id: datos.agenteId,
    generacion: datos.generacion,
    boot_id_referencia: datos.bootIdReferencia,
    ultimo_periodo_pol_id: datos.periodoVidaPolId,
    ultimo_seq: datos.ultimoSeq,
    ultimo_pol_utc: datos.ultimoPolUtc,
    tipo_ultimo_pol: datos.tipoUltimoPol,
    valor_sin_pol: datos.valorSinPol ? 1 : 0,
    vence_sin_pol_utc: datos.venceSinPolUtc,
    histeresis_sin_pol_capturada_segundos:
      datos.histeresisSinPolCapturadaSegundos,
    valor_reinicio_reciente: datos.valorReinicioReciente ? 1 : 0,
    vence_reinicio_reciente_utc: datos.venceReinicioRecienteUtc,
    duracion_reinicio_capturada_segundos:
      datos.duracionReinicioCapturadaSegundos,
    ultimo_cambio_boot_id_utc: datos.ultimoCambioBootIdUtc,
    checkpoint_causal: datos.checkpointCausal,
    version_estado: anterior.versionEstado + 1
  });
}

function crearPerfil(sobrescritura = {}) {
  return {
    agenteId: 7,
    generacion: 2,
    estado: 'activo',
    histeresisSinPolSegundos: 120,
    duracionReinicioRecienteSegundos: 300,
    generadaEnUtc: '2026-08-24T13:00:00.000Z',
    ...sobrescritura
  };
}

function crearEvidencia(sobrescritura = {}) {
  return new EvidenciaPolServidorAgente({
    id: 41,
    agente_id: 7,
    boot_id: 'boot-a',
    inicio_utc: '2026-08-24 14:08:00.000',
    ultimo_heartbeat_utc: '2026-08-24 14:09:00.000',
    ultimo_seq: 8,
    heartbeats_recibidos: 8,
    ...sobrescritura
  });
}

function crearEstado(sobrescritura = {}) {
  const normalizada = normalizarSobrescrituraEstado(sobrescritura);
  return new EstadoRuntimeServidorAgente({
    agente_id: 7,
    generacion: 2,
    boot_id_referencia: 'boot-a',
    ultimo_periodo_pol_id: 40,
    ultimo_seq: 7,
    ultimo_pol_utc: '2026-08-24 14:04:00.000',
    tipo_ultimo_pol: 'heartbeat',
    valor_sin_pol: 0,
    vence_sin_pol_utc: '2026-08-24 14:06:00.000',
    histeresis_sin_pol_capturada_segundos: 120,
    valor_reinicio_reciente: 0,
    vence_reinicio_reciente_utc: null,
    duracion_reinicio_capturada_segundos: null,
    ultimo_cambio_boot_id_utc: null,
    checkpoint_causal: 'pol:40|seq:7',
    version_estado: 3,
    fecha_creacion: '2026-08-24 13:00:00.000',
    fecha_actualizacion: '2026-08-24 14:04:00.000',
    ...normalizada
  });
}

function normalizarSobrescrituraEstado(datos) {
  const mapa = {
    agenteId: 'agente_id',
    bootIdReferencia: 'boot_id_referencia',
    ultimoPeriodoPolId: 'ultimo_periodo_pol_id',
    ultimoSeq: 'ultimo_seq',
    ultimoPolUtc: 'ultimo_pol_utc',
    tipoUltimoPol: 'tipo_ultimo_pol',
    valorSinPol: 'valor_sin_pol',
    venceSinPolUtc: 'vence_sin_pol_utc',
    histeresisSinPolCapturadaSegundos:
      'histeresis_sin_pol_capturada_segundos',
    valorReinicioReciente: 'valor_reinicio_reciente',
    venceReinicioRecienteUtc: 'vence_reinicio_reciente_utc',
    duracionReinicioCapturadaSegundos:
      'duracion_reinicio_capturada_segundos',
    ultimoCambioBootIdUtc: 'ultimo_cambio_boot_id_utc',
    checkpointCausal: 'checkpoint_causal',
    versionEstado: 'version_estado',
    fechaCreacion: 'fecha_creacion',
    fechaActualizacion: 'fecha_actualizacion'
  };
  return Object.fromEntries(Object.entries(datos).map(([clave, valor]) => [
    mapa[clave] || clave,
    valor
  ]));
}

function filaEstadoSql(sobrescritura = {}) {
  return {
    agente_id: 7,
    generacion: 2,
    boot_id_referencia: 'boot-a',
    ultimo_periodo_pol_id: 40,
    ultimo_seq: 7,
    ultimo_pol_utc: '2026-08-24 14:04:00.000',
    tipo_ultimo_pol: 'heartbeat',
    valor_sin_pol: 0,
    vence_sin_pol_utc: '2026-08-24 14:11:00.000',
    histeresis_sin_pol_capturada_segundos: 120,
    valor_reinicio_reciente: 0,
    vence_reinicio_reciente_utc: null,
    duracion_reinicio_capturada_segundos: null,
    ultimo_cambio_boot_id_utc: null,
    checkpoint_causal: 'checkpoint',
    version_estado: 4,
    fecha_creacion: '2026-08-24 13:00:00.000',
    fecha_actualizacion: '2026-08-24 14:09:00.000',
    ...sobrescritura
  };
}

function leer(ruta) {
  return readFile(new URL(ruta, RAIZ), 'utf8');
}

function normalizarSqlConsolidado(contenido) {
  return contenido.replaceAll('`', '').replace(/,(?!\s)/g, ', ');
}
