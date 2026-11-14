import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { FronteraTransaccionalLocal } from '../paquetes/persistencia-sql/src/FronteraTransaccionalLocal.js';
import { obtenerConfiguracionAplicacion } from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';
import { RepositorioMonitores } from '../paquetes/monitores/src/RepositorioMonitores.js';
import { RepositorioEstadoActualMonitores } from '../paquetes/monitores/src/RepositorioEstadoActualMonitores.js';
import { RepositorioEventosMonitor } from '../paquetes/monitores/src/RepositorioEventosMonitor.js';
import { RepositorioHistoricoMonitores } from '../paquetes/monitores/src/RepositorioHistoricoMonitores.js';
import { RepositorioAlertasActivasMonitor } from '../paquetes/monitores/src/RepositorioAlertasActivasMonitor.js';
import { TIPOS_IDENTIDAD_FEDERADA } from '../paquetes/federacion/src/IdentidadFederada.js';
import { CatalogoMonitoresRuntime } from '../apps/sentinelia-runtime/src/catalogo/CatalogoMonitoresRuntime.js';
import { AlmacenEstadoActual } from '../apps/sentinelia-runtime/src/estado/AlmacenEstadoActual.js';
import { AplicadorResultadosEstadoActual } from '../apps/sentinelia-runtime/src/estado/AplicadorResultadosEstadoActual.js';
import { MotorMonitores } from '../apps/sentinelia-runtime/src/ejecucion/MotorMonitores.js';
import { RegistroEjecutoresMonitor } from '../apps/sentinelia-runtime/src/ejecucion/RegistroEjecutoresMonitor.js';
import { EjecutorMonitorBooleano } from '../apps/sentinelia-runtime/src/ejecucion/EjecutorMonitorBooleano.js';
import { PersistidorEventosMonitores } from '../apps/sentinelia-runtime/src/eventos/PersistidorEventosMonitores.js';
import { ServicioEventosMonitores } from '../apps/sentinelia-runtime/src/eventos/ServicioEventosMonitores.js';
import { GestorHistoricoMonitores } from '../apps/sentinelia-runtime/src/historico/GestorHistoricoMonitores.js';
import { GestorAlertasActivasMonitor } from '../apps/sentinelia-runtime/src/alertas/GestorAlertasActivasMonitor.js';
import { SelectorMonitoresVencidos } from '../apps/sentinelia-runtime/src/scheduler/SelectorMonitoresVencidos.js';
import { RuntimeSentinelia } from '../apps/sentinelia-runtime/src/RuntimeSentinelia.js';
import { id, migrar } from './federacion-verificar-5-22-15g.js';

await main();

async function main() {
  await verificarContrato();
  await verificarRecorridoOrdinarioSql();
  verificarDespertarCandidato();
  await verificarInvalidacionReactiva();
  console.log('[federacion] OK 5.22.16g: estado, evento e histórico ordinarios integrados');
}

async function verificarContrato() {
  const runtime = await leer('../apps/sentinelia-runtime/src/RuntimeSentinelia.js');
  assert.match(runtime, /repositorioEntradasFederadasMonitoresLogicos/u);
}

async function verificarRecorridoOrdinarioSql() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true);
  const base = `sentinelia_fixture_52216g_${randomBytes(6).toString('hex')}`;
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
    const proyeccionId = id(TIPOS_IDENTIDAD_FEDERADA.PROYECCION);
    const repositorioMonitores = new RepositorioMonitores(sql);
    const monitor = await repositorioMonitores.crear({
      tenantId: 1, empresaId: 2, sitioId: null, nombre: 'Lógico federado',
      tipo: 'booleano', descripcion: 'Fixture 16g', interpretacionEstado: 'normal',
      descripcionFallo: 'La entrada remota está en fallo.', posibleSolucion: 'Revisar origen.',
      activo: true, intervaloEjecucionSegundos: 60, desfaseInicialSegundos: 0,
      configuracion: {
        version: 4, expresion: 'A', estadoInicial: 'disponible',
        retardoSenalSegundos: 0, dependencias: [{
          variable: 'A', fuente: 'monitor_federado', proyeccionId,
          estadoInicial: 'correcto', inversion: false, retardoCambioSegundos: 0,
          politicaPerdidaEnFallo: 'conservar',
          politicaPerdidaEnCorrecto: 'conservar'
        }]
      }
    });
    const catalogo = new CatalogoMonitoresRuntime({
      generadoEn: new Date().toISOString(),
      monitores: [monitor.serializarDefinicionRuntime()]
    });
    const almacen = new AlmacenEstadoActual({ catalogoOperativo: catalogo });
    const entrada = {
      entradaId: 11, variable: 'A', fuente: 'monitor_federado', proyeccionId,
      revisionConfiguracion: 1, interpretacionDurable: true,
      valorBinarioEfectivo: false, condicionFuente: 'vigente',
      bloqueaEvaluacion: false, candidatoPendiente: false,
      transicionAplicada: true, generacionId: id(TIPOS_IDENTIDAD_FEDERADA.GENERACION),
      secuenciaElemento: '7', ocurrenciaOrigenId: id(TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN),
      transicionTemporalId: null
    };
    const motor = new MotorMonitores({
      registroEjecutores: new RegistroEjecutoresMonitor({ ejecutores: [
        new EjecutorMonitorBooleano({
          repositorioEntradasFederadas: {
            observarEntradasOperativasPorMonitorId: async () => [entrada]
          }
        })
      ] })
    });
    const lote = await motor.ejecutarMonitores({
      catalogoOperativo: catalogo,
      almacenEstadoActual: almacen,
      candidatos: [{ monitorId: monitor.id, tipo: 'booleano',
        proximoIntentoEn: new Date().toISOString(), retrasoSegundos: 0,
        motivoProgramacion: 'fixture_16g' }]
    });
    const resultado = lote.resultados[0];
    assert.equal(resultado.estadoDetectado, 'indisponible');
    assert.equal(resultado.efectosDerivadosHabilitados, true);
    assert.match(resultado.causalidadFederada.transicionMonitorId, /^monitor-federado:[0-9a-f]{64}$/);
    assert.equal(resultado.metricaPrincipal.totalTransicionesEntradasFederadas, 1);

    const repositorioEstado = new RepositorioEstadoActualMonitores(sql);
    const repositorioEventos = new RepositorioEventosMonitor(sql);
    const repositorioHistorico = new RepositorioHistoricoMonitores(sql);
    const repositorioAlertas = new RepositorioAlertasActivasMonitor(sql);
    const aplicador = new AplicadorResultadosEstadoActual({
      repositorioEstadoActualMonitores: repositorioEstado
    });
    const persistidor = new PersistidorEventosMonitores({
      servicioEventosMonitores: new ServicioEventosMonitores({
        repositorioEventosMonitor: repositorioEventos,
        servicioConfiguracionPortal: null
      })
    });
    const historico = new GestorHistoricoMonitores({
      repositorioHistoricoMonitores: repositorioHistorico,
      servicioConfiguracionPortal: configuracionMonitoresSinCompactacion()
    });
    const alertas = new GestorAlertasActivasMonitor({
      repositorioAlertasActivasMonitor: repositorioAlertas
    });
    const persistencia = await new FronteraTransaccionalLocal(sql)
      .ejecutar(async (conexion) => {
        const estado = await aplicador.aplicar({
          almacenEstadoActual: almacen, resultados: lote.resultados
        }, { conexion });
        const eventos = await persistidor.persistirDesdeLote({
          catalogoOperativo: catalogo, loteEjecucion: lote
        }, { conexion });
        const resultadoAlertas = await alertas.aplicarResultados({
          catalogoOperativo: catalogo, resultados: lote.resultados
        }, { conexion });
        const tramos = await historico.aplicarResultados({
          catalogoOperativo: catalogo, resultados: lote.resultados,
          persistenciaEventos: eventos
        }, { conexion });
        return { estado, eventos, alertas: resultadoAlertas, tramos };
      });
    assert.equal(persistencia.estado.totalPersistidos, 1);
    assert.equal(persistencia.estado.totalCambiosEstado, 1);
    assert.equal(persistencia.estado.monitoresActualizados[0].cambioSalidaEstable, true);
    assert.equal(persistencia.eventos.totalPersistidos, 1);
    assert.equal(persistencia.tramos.totalPersistidos, 1);
    assert.equal(persistencia.alertas.totalAperturas, 1);
    assert.equal(persistencia.alertas.totalNoConcluyentes, 0);
    assert.equal((await repositorioEventos.listarPorMonitorId(monitor.id)).length, 1);
    assert.equal((await repositorioHistorico.listarPorMonitorId(monitor.id)).length, 1);
    assert.equal((await repositorioAlertas.listarPorMonitorIds([monitor.id])).length, 1);
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(base)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

function verificarDespertarCandidato() {
  const monitor = {
    id: 8, nombre: 'Candidato', tipo: 'booleano', version: '2026-01-01T00:00:00.000Z',
    scope: {}, programacion: { intervaloEjecucionSegundos: 60,
      desfaseInicialSegundos: 0 }
  };
  const programacion = new SelectorMonitoresVencidos().calcularProgramacion({
    monitor, ordenCatalogo: 0, fechaEvaluacionMs: Date.parse('2026-01-01T00:00:10.000Z'),
    estadoActual: {
      fechaUltimaEjecucionUtc: '2026-01-01T00:00:00.000Z',
      resultadoActual: { metricaPrincipal: {
        proximoVencimientoEntradaFederadaUtc: '2026-01-01T00:00:10.000Z'
      } }
    }
  });
  assert.equal(programacion.vencido, true);
  assert.equal(programacion.motivoProgramacion, 'retardo_entrada_federada_vencido');
}

async function verificarInvalidacionReactiva() {
  const runtime = Object.create(RuntimeSentinelia.prototype);
  runtime.monitoresFederadosPendientes = new Set();
  runtime.contexto = {
    repositorioEntradasFederadasMonitoresLogicos: {
      async listarMonitorIdsPorProyeccionIds(ids) {
        assert.deepEqual(ids, ['proyeccion-a']);
        return [8];
      }
    }
  };
  runtime.catalogoOperativo = {
    buscarPorId: () => ({
      id: 8, nombre: 'Reactivo', tipo: 'booleano', activo: true,
      version: 'v1', scope: { tenantId: 1, empresaId: 2 }
    })
  };
  const total = await runtime.registrarTransicionesFederadasPendientes({
    tiempoEstadosRemotos: { transiciones: [{ proyeccionId: 'proyeccion-a' }] }
  });
  assert.equal(total, 1);
  const seleccion = runtime.incorporarMonitoresFederadosPendientes({
    seleccion: { totalVencidos: 0, monitoresVencidos: [] },
    fechaReferenciaUtc: '2026-01-01T00:00:00.000Z'
  });
  assert.equal(seleccion.monitoresVencidos[0].monitorId, 8);
  assert.equal(seleccion.monitoresVencidos[0].motivoProgramacion,
    'entrada_federada_actualizada');
}

function configuracionMonitoresSinCompactacion() {
  return { async asegurarActualizada() { return {
    obtenerConfiguracionMonitores() {
      return { compactacionCercaFalloPorcentaje: 0,
        compactacionSerieVariacionPorcentaje: 0 };
    }
  }; } };
}

function leer(ruta) { return readFile(new URL(ruta, import.meta.url), 'utf8'); }
