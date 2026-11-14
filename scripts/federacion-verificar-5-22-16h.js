import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { FronteraTransaccionalLocal } from '../paquetes/persistencia-sql/src/FronteraTransaccionalLocal.js';
import { RepositorioEjecucionesTrigger } from '../paquetes/triggers/src/RepositorioEjecucionesTrigger.js';
import { obtenerConfiguracionAplicacion } from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';
import { EjecutorMonitorBooleano } from '../apps/sentinelia-runtime/src/ejecucion/EjecutorMonitorBooleano.js';
import { TIPOS_IDENTIDAD_FEDERADA } from '../paquetes/federacion/src/IdentidadFederada.js';
import { id, migrar } from './federacion-verificar-5-22-15g.js';

await main();

async function main() {
  await verificarContrato();
  await verificarReplayCausalLocal();
  await verificarPlanDurableIdempotente();
  console.log('[federacion] OK 5.22.16h: causalidad=extremo_a_extremo alertas=idempotentes planes_trigger=durables reclamacion=unica replay=sin_duplicados');
}

async function verificarReplayCausalLocal() {
  const proyeccionId = id(TIPOS_IDENTIDAD_FEDERADA.PROYECCION);
  const monitor = {
    id: 9,
    nombre: 'Lógico causal',
    tipo: 'booleano',
    configuracion: {
      version: 4,
      expresion: 'A',
      estadoInicial: 'disponible',
      retardoSenalSegundos: 0,
      dependencias: [{
        variable: 'A',
        fuente: 'monitor_federado',
        proyeccionId,
        etiqueta: 'Texto humano inicial',
        estadoInicial: 'correcto',
        inversion: false,
        retardoCambioSegundos: 0,
        politicaPerdidaEnFallo: 'conservar',
        politicaPerdidaEnCorrecto: 'conservar'
      }]
    }
  };
  let valor = false;
  const repositorio = {
    observarEntradasOperativasPorMonitorId: async () => [{
      entradaId: 7,
      variable: 'A',
      fuente: 'monitor_federado',
      proyeccionId,
      revisionConfiguracion: 1,
      valorBinarioEfectivo: valor,
      condicionFuente: 'vigente',
      bloqueaEvaluacion: false,
      interpretacionDurable: true,
      evidenciaEfectiva: {
        generacionId: 'generacion-1',
        secuenciaElemento: valor ? '2' : '1',
        ocurrenciaOrigenId: valor ? 'ocurrencia-2' : 'ocurrencia-1',
        transicionTemporalId: valor ? 'temporal-2' : 'temporal-1'
      }
    }]
  };
  const ejecutor = new EjecutorMonitorBooleano({ repositorioEntradasFederadas: repositorio });
  const estado = {
    ejecutadoTodavia: false,
    estado: 'desconocido',
    resultadoActual: null
  };
  const almacen = { buscarPorMonitorId: () => estado };
  const primera = await ejecutor.ejecutar(monitor, {
    almacenEstadoActual: almacen,
    ejecutadoEnUtc: '2026-08-08T00:00:00.000Z'
  });
  assert.equal(primera.efectosDerivadosHabilitados, true);
  estado.ejecutadoTodavia = true;
  estado.estado = primera.estadoDetectado;
  estado.resultadoActual = { causalidadFederada: primera.causalidadFederada };
  monitor.configuracion.dependencias[0].etiqueta = 'Texto humano cambiado';
  const replay = await ejecutor.ejecutar(monitor, {
    almacenEstadoActual: almacen,
    ejecutadoEnUtc: '2026-08-08T00:01:00.000Z'
  });
  assert.equal(replay.efectosDerivadosHabilitados, false);
  assert.equal(replay.causalidadFederada.transicionMonitorId,
    primera.causalidadFederada.transicionMonitorId);
  valor = true;
  const recuperacion = await ejecutor.ejecutar(monitor, {
    almacenEstadoActual: almacen,
    ejecutadoEnUtc: '2026-08-08T00:02:00.000Z'
  });
  assert.equal(recuperacion.efectosDerivadosHabilitados, true);
  assert.notEqual(recuperacion.causalidadFederada.transicionMonitorId,
    primera.causalidadFederada.transicionMonitorId);
}

async function verificarContrato() {
  const [ejecutor, runtime] = await Promise.all([
    leer('../apps/sentinelia-runtime/src/ejecucion/EjecutorMonitorBooleano.js'),
    leer('../apps/sentinelia-runtime/src/RuntimeSentinelia.js')
  ]);
  assert.match(ejecutor, /transicionMonitorId/u);
  assert.match(runtime, /planificarDesdePersistenciaAlertas/u);
  assert.match(runtime, /ejecutarPendientes/u);
  const repositorio = await leer(
    '../paquetes/triggers/src/RepositorioEjecucionesTrigger.js'
  );
  assert.match(repositorio, /bloquear: Boolean\(conexion\)/u);
  assert.match(repositorio, /FOR UPDATE/u);
}

async function verificarPlanDurableIdempotente() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true);
  const base = `sentinelia_fixture_52216h_${randomBytes(6).toString('hex')}`;
  const administrador = new ClienteSql(configuracion.sql);
  let sql;
  try {
    await administrador.ejecutar(
      `CREATE DATABASE ${administrador.escaparIdentificador(base)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    sql = new ClienteSql({ ...configuracion.sql, baseDatos: base });
    await migrar(sql);
    await sql.ejecutar("INSERT INTO tenants (id,nombre,alias) VALUES (1,'Tenant','tenant')");
    await sql.ejecutar("INSERT INTO empresas (id,tenant_id,nombre,alias) VALUES (2,1,'Empresa','empresa')");
    await sql.ejecutar(`INSERT INTO monitores
      (id,tenant_id,empresa_id,nombre,tipo,activo,configuracion)
      VALUES (3,1,2,'Monitor causal','booleano',1,JSON_OBJECT())`);
    await sql.ejecutar(`INSERT INTO triggers
      (id,nombre,tipo,activo,configuracion)
      VALUES (4,'Trigger causal','api',1,JSON_OBJECT())`);
    await sql.ejecutar(`INSERT INTO asignaciones_triggers_monitores
      (id,monitor_id,trigger_id,activo,orden_ejecucion)
      VALUES (5,3,4,1,100)`);

    const repositorio = new RepositorioEjecucionesTrigger(sql);
    const definicion = {
      asignacionTriggerMonitorId: 5,
      triggerId: 4,
      monitorId: 3,
      tenantId: 1,
      empresaId: 2,
      versionCatalogo: 'fixture',
      claveIdempotencia: 'a'.repeat(64),
      eventoDisparo: 'apertura_alerta',
      estadoEjecucion: 'pendiente',
      tipoTrigger: 'api',
      triggerNombre: 'Trigger causal',
      monitorNombre: 'Monitor causal',
      codigoResultado: 'pendiente',
      mensajeResultado: 'Ejecución planificada.',
      payloadSolicitud: {
        transicion: {
          causalidadFederada: {
            transicionMonitorId: `monitor-federado:${'b'.repeat(64)}`
          }
        }
      },
      iniciadoEnUtc: new Date(),
      finalizadoEnUtc: null
    };
    await assert.rejects(
      new FronteraTransaccionalLocal(sql).ejecutar(async (conexion) => {
        await repositorio.crearIdempotente(definicion, { conexion });
        throw new Error('rollback_fixture_16h');
      }),
      /rollback_fixture_16h/u
    );
    assert.equal((await repositorio.listarPendientes()).length, 0);
    const primera = await repositorio.crearIdempotente(definicion);
    const replay = await repositorio.crearIdempotente(definicion);
    assert.equal(primera.creada, true);
    assert.equal(replay.creada, false);
    assert.equal(replay.ejecucion.id, primera.ejecucion.id);
    assert.equal((await repositorio.listarPendientes()).length, 1);
    const reclamada = await repositorio.marcarEjecutando(primera.ejecucion.id);
    assert.equal(reclamada.estadoEjecucion, 'ejecutando');
    assert.equal(await repositorio.marcarEjecutando(primera.ejecucion.id), null);
    assert.equal((await repositorio.listarPendientes()).length, 0);
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(base)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}
