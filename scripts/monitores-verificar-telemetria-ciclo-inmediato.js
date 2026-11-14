import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CatalogoMonitoresRuntime } from '../apps/sentinelia-runtime/src/catalogo/CatalogoMonitoresRuntime.js';
import { AlmacenEstadoActual } from '../apps/sentinelia-runtime/src/estado/AlmacenEstadoActual.js';
import { AplicadorResultadosEstadoActual } from '../apps/sentinelia-runtime/src/estado/AplicadorResultadosEstadoActual.js';
import { EjecutorMonitorTelemetria } from '../apps/sentinelia-runtime/src/ejecucion/EjecutorMonitorTelemetria.js';
import { MotorMonitores } from '../apps/sentinelia-runtime/src/ejecucion/MotorMonitores.js';
import { RegistroEjecutoresMonitor } from '../apps/sentinelia-runtime/src/ejecucion/RegistroEjecutoresMonitor.js';
import { GestorAlertasActivasMonitor } from '../apps/sentinelia-runtime/src/alertas/GestorAlertasActivasMonitor.js';
import { GestorHistoricoMonitores } from '../apps/sentinelia-runtime/src/historico/GestorHistoricoMonitores.js';
import { PersistidorEventosMonitores } from '../apps/sentinelia-runtime/src/eventos/PersistidorEventosMonitores.js';
import { ServicioEventosMonitores } from '../apps/sentinelia-runtime/src/eventos/ServicioEventosMonitores.js';
import { MotorTriggersRuntime } from '../apps/sentinelia-runtime/src/triggers/MotorTriggersRuntime.js';
import { VinculoMonitorTelemetriaPersistido } from '../paquetes/monitores/src/RepositorioVinculosMonitoresTelemetria.js';
import { crearMonitorDesdeFila } from '../paquetes/monitores/src/Monitor.js';

const MONITOR_ID = 501;

class RepositorioEstadoActualMonitoresMemoria {
  estados = new Map();

  async guardarEstadosActuales(estados) {
    for (const estado of estados) {
      this.estados.set(estado.monitorId, estado.serializar());
    }
    return estados.length;
  }
}

class RepositorioEventosMemoria {
  eventos = [];

  async listarUltimosPorMonitorIds(idsMonitor) {
    return idsMonitor
      .map((monitorId) => this.eventos.findLast(
        (evento) => evento.monitorId === monitorId
      ))
      .filter(Boolean);
  }

  async guardarEventosDetallado(eventos) {
    this.eventos.push(...eventos);
    return {
      totalPersistidos: eventos.length,
      eventosPersistidos: eventos
    };
  }
}

class RepositorioAlertasMemoria {
  alertas = new Map();

  async listarPorMonitorIds(idsMonitor) {
    return idsMonitor.map((id) => this.alertas.get(id)).filter(Boolean);
  }

  async guardarAlertas(alertas) {
    for (const alerta of alertas) {
      this.alertas.set(alerta.monitorId, alerta);
    }
    return alertas.length;
  }

  async eliminarPorMonitorIds(idsMonitor) {
    let total = 0;
    for (const monitorId of idsMonitor) {
      total += this.alertas.delete(monitorId) ? 1 : 0;
    }
    return total;
  }
}

class RepositorioHistoricoMemoria {
  tramos = new Map();

  async listarUltimosPorMonitorIds(idsMonitor) {
    return idsMonitor.map((id) => this.tramos.get(id)).filter(Boolean);
  }

  async guardarTramos(tramos) {
    for (const tramo of tramos) {
      this.tramos.set(tramo.monitorId, tramo);
    }
    return tramos.length;
  }

  async actualizarTramo(tramo) {
    this.tramos.set(tramo.monitorId, tramo);
    return 1;
  }
}

class ServicioTriggersMemoria {
  eventosDisparados = [];
  secuencia = 0;

  async resolverDisparosDesdeTransiciones({ aperturasAlerta, cierresAlerta }) {
    const disparos = [
      ...aperturasAlerta.map((transicion) => this.crearDisparo(
        'apertura_alerta',
        transicion
      )),
      ...cierresAlerta.map((transicion) => this.crearDisparo(
        'cierre_alerta',
        transicion
      ))
    ];
    return { totalDisparos: disparos.length, disparos };
  }

  crearDisparo(eventoDisparo, transicion) {
    return {
      eventoDisparo,
      monitorId: transicion.monitorId,
      triggerId: eventoDisparo === 'apertura_alerta' ? 71 : 72,
      asignacionId: eventoDisparo === 'apertura_alerta' ? 81 : 82,
      tipoTrigger: 'api',
      nombreTrigger: `trigger-${eventoDisparo}`,
      ordenEjecucion: 1,
      configuracionEfectiva: {},
      transicion
    };
  }

  async registrarEjecucionPendiente() {
    this.secuencia += 1;
    return { id: this.secuencia };
  }

  async marcarEjecucionEjecutando() {}

  resolverEjecutorParaPlanDisparo(planDisparo) {
    return {
      ejecutar: async () => {
        this.eventosDisparados.push(planDisparo.eventoDisparo);
        return {
          estadoEjecucion: 'ok',
          codigoResultado: 'trigger_telemetria_ok',
          mensajeResultado: 'Trigger de telemetría ejecutado.'
        };
      }
    };
  }

  async finalizarEjecucionTrigger({ idEjecucion, estadoEjecucion }) {
    return { id: idEjecucion, estadoEjecucion };
  }
}

async function verificarCicloComunInmediato() {
  const catalogoOperativo = crearCatalogo();
  const almacenEstadoActual = new AlmacenEstadoActual({ catalogoOperativo });
  const fuenteActual = { lectura: null };
  let relojMs = Date.parse('2026-07-20T12:00:00.000Z');
  const ejecutor = new EjecutorMonitorTelemetria({
    repositorioVinculos: {
      async buscarPorMonitorId() {
        return crearVinculo();
      }
    },
    repositorioEstadoActualTelemetria: {
      async buscarPorSenalId({ agenteId, senalId }) {
        assert.equal(agenteId, 31);
        assert.equal(senalId, 47);
        return fuenteActual.lectura;
      }
    },
    reloj: () => {
      relojMs += 1000;
      return new Date(relojMs);
    }
  });
  const motor = new MotorMonitores({
    registroEjecutores: new RegistroEjecutoresMonitor({ ejecutores: [ejecutor] })
  });
  const repositorioEstado = new RepositorioEstadoActualMonitoresMemoria();
  const aplicadorEstado = new AplicadorResultadosEstadoActual({
    repositorioEstadoActualMonitores: repositorioEstado
  });
  const repositorioEventos = new RepositorioEventosMemoria();
  const persistidorEventos = new PersistidorEventosMonitores({
    servicioEventosMonitores: new ServicioEventosMonitores({
      repositorioEventosMonitor: repositorioEventos,
      servicioConfiguracionPortal: null
    })
  });
  const repositorioAlertas = new RepositorioAlertasMemoria();
  const gestorAlertas = new GestorAlertasActivasMonitor({
    repositorioAlertasActivasMonitor: repositorioAlertas
  });
  const repositorioHistorico = new RepositorioHistoricoMemoria();
  const gestorHistorico = new GestorHistoricoMonitores({
    repositorioHistoricoMonitores: repositorioHistorico,
    servicioConfiguracionPortal: {
      async asegurarActualizada() {
        return {
          obtenerConfiguracionMonitores() {
            return { compactacionCercaFalloPorcentaje: 0 };
          }
        };
      }
    }
  });
  const servicioTriggers = new ServicioTriggersMemoria();
  const motorTriggers = new MotorTriggersRuntime({ servicioTriggers });

  async function ejecutar(lectura) {
    fuenteActual.lectura = lectura;
    const loteEjecucion = await motor.ejecutarMonitores({
      catalogoOperativo,
      almacenEstadoActual,
      candidatos: [{
        monitorId: MONITOR_ID,
        tipo: 'telemetria',
        proximoIntentoEn: new Date(relojMs).toISOString(),
        retrasoSegundos: 0,
        motivoProgramacion: 'intervalo_desde_ultima_ejecucion'
      }]
    });
    const persistenciaEstadoActual = await aplicadorEstado.aplicar({
      almacenEstadoActual,
      resultados: loteEjecucion.resultados
    });
    const persistenciaEventos = await persistidorEventos.persistirDesdeLote({
      catalogoOperativo,
      loteEjecucion
    });
    const persistenciaAlertas = await gestorAlertas.aplicarResultados({
      catalogoOperativo,
      resultados: loteEjecucion.resultados
    });
    const persistenciaHistorico = await gestorHistorico.aplicarResultados({
      catalogoOperativo,
      resultados: loteEjecucion.resultados,
      persistenciaEventos
    });
    const persistenciaTriggers = await motorTriggers.ejecutarDesdePersistenciaAlertas({
      persistenciaAlertas,
      origen: 'verificacion_5_20b_4',
      numeroTick: 1
    });
    return {
      loteEjecucion,
      persistenciaEstadoActual,
      persistenciaEventos,
      persistenciaAlertas,
      persistenciaHistorico,
      persistenciaTriggers
    };
  }

  const inicial = await ejecutar(null);
  assert.equal(resultadoDe(inicial).estadoDetectado, 'desconocido');
  assert.equal(almacenEstadoActual.buscarPorMonitorId(MONITOR_ID).estado, 'desconocido');
  assert.equal(inicial.persistenciaEstadoActual.totalPersistidos, 1);
  assert.equal(inicial.persistenciaEventos.totalPersistidos, 1);
  assert.equal(inicial.persistenciaHistorico.totalPersistidos, 1);
  assert.equal(inicial.persistenciaAlertas.totalNoConcluyentes, 1);
  assert.equal(inicial.persistenciaAlertas.totalAperturas, 0);
  assert.equal(repositorioAlertas.alertas.size, 0);
  assert.equal(inicial.persistenciaTriggers.omitido, true);

  const apertura = await ejecutar(crearLectura(96, 9001));
  assert.equal(resultadoDe(apertura).estadoDetectado, 'indisponible');
  assert.equal(resultadoDe(apertura).codigoResultado, 'valor_sobre_maximo');
  assert.equal(almacenEstadoActual.buscarPorMonitorId(MONITOR_ID).estado, 'indisponible');
  assert.equal(apertura.persistenciaEstadoActual.totalCambiosEstado, 1);
  assert.equal(apertura.persistenciaEventos.totalPersistidos, 1);
  assert.equal(apertura.persistenciaAlertas.totalAperturas, 1);
  assert.equal(apertura.persistenciaAlertas.totalConfirmaciones, 0);
  assert.equal(apertura.persistenciaHistorico.totalTransiciones, 1);
  assert.equal(apertura.persistenciaTriggers.totalEjecutados, 1);
  assert.deepEqual(servicioTriggers.eventosDisparados, ['apertura_alerta']);
  assert.equal(repositorioAlertas.alertas.get(MONITOR_ID).contadorRepeticiones, 1);
  assert.equal(
    repositorioAlertas.alertas.get(MONITOR_ID).payloadAlerta.descripcionFallo,
    'La temperatura está fuera del rango operativo.'
  );

  const confirmacion = await ejecutar(crearLectura(97, 9002));
  assert.equal(confirmacion.persistenciaAlertas.totalAperturas, 0);
  assert.equal(confirmacion.persistenciaAlertas.totalConfirmaciones, 1);
  assert.equal(confirmacion.persistenciaAlertas.totalCierres, 0);
  assert.equal(confirmacion.persistenciaHistorico.totalExtensiones, 1);
  assert.equal(confirmacion.persistenciaTriggers.omitido, true);
  assert.deepEqual(servicioTriggers.eventosDisparados, ['apertura_alerta']);
  assert.equal(repositorioAlertas.alertas.get(MONITOR_ID).contadorRepeticiones, 2);

  const noConcluyente = await ejecutar(null);
  assert.equal(resultadoDe(noConcluyente).estadoDetectado, 'desconocido');
  assert.equal(noConcluyente.persistenciaAlertas.totalNoConcluyentes, 1);
  assert.equal(noConcluyente.persistenciaAlertas.totalAperturas, 0);
  assert.equal(noConcluyente.persistenciaAlertas.totalConfirmaciones, 0);
  assert.equal(noConcluyente.persistenciaAlertas.totalCierres, 0);
  assert.equal(
    noConcluyente.persistenciaAlertas.resultadosNoConcluyentes[0]
      .alertaActivaConservada,
    true
  );
  assert.equal(repositorioAlertas.alertas.get(MONITOR_ID).contadorRepeticiones, 2);
  assert.equal(noConcluyente.persistenciaTriggers.omitido, true);
  assert.deepEqual(servicioTriggers.eventosDisparados, ['apertura_alerta']);

  const cierre = await ejecutar(crearLectura(42, 9003));
  assert.equal(resultadoDe(cierre).estadoDetectado, 'disponible');
  assert.equal(cierre.persistenciaAlertas.totalCierres, 1);
  assert.equal(cierre.persistenciaAlertas.totalEliminadas, 1);
  assert.equal(repositorioAlertas.alertas.size, 0);
  assert.equal(cierre.persistenciaHistorico.totalTransiciones, 1);
  assert.equal(cierre.persistenciaTriggers.totalEjecutados, 1);
  assert.deepEqual(servicioTriggers.eventosDisparados, [
    'apertura_alerta',
    'cierre_alerta'
  ]);
  assert.equal(repositorioEventos.eventos.length, 5);
  assert.equal(repositorioEstado.estados.get(MONITOR_ID).estado, 'disponible');
}

async function verificarRegistroProductivoYFronteras() {
  const [runtimeFuente, ejecutorFuente, verificadorFuente] = await Promise.all([
    readFile(
      new URL('../apps/sentinelia-runtime/src/RuntimeSentinelia.js', import.meta.url),
      'utf8'
    ),
    readFile(
      new URL(
        '../apps/sentinelia-runtime/src/ejecucion/EjecutorMonitorTelemetria.js',
        import.meta.url
      ),
      'utf8'
    ),
    readFile(
      new URL(
        '../apps/sentinelia-runtime/src/VerificadorCierreRuntime.js',
        import.meta.url
      ),
      'utf8'
    )
  ]);
  assert.ok(runtimeFuente.includes('new EjecutorMonitorTelemetria({'));
  assert.ok(runtimeFuente.includes('repositorioVinculosMonitoresTelemetria'));
  assert.ok(runtimeFuente.includes('repositorioEstadoActualTelemetria'));
  assert.equal(
    /\b(?:INSERT\s+INTO|UPDATE\s+[a-z_]|DELETE\s+FROM)\b/iu.test(
      ejecutorFuente
    ),
    false
  );
  assert.equal(ejecutorFuente.includes('periodos_vida_pol_agentes'), false);
  assert.ok(verificadorFuente.includes('esEstadoNoConcluyente(estadoSql)'));
  assert.ok(verificadorFuente.includes('segunda_desconocidos_estables'));
}

function verificarPresentacionNoConcluyente() {
  const monitor = crearMonitorDesdeFila({
    id: MONITOR_ID,
    tenant_id: 1,
    empresa_id: 2,
    sitio_id: 3,
    nombre: 'Temperatura cámara frigorífica',
    tipo: 'telemetria',
    descripcion: 'Temperatura interior.',
    interpretacion_estado: 'normal',
    descripcion_fallo: 'Temperatura fuera de rango.',
    posible_solucion: 'Revisar la cámara.',
    activo: 1,
    intervalo_ejecucion_segundos: 60,
    desfase_inicial_segundos: 0,
    configuracion: crearCatalogo().buscarPorId(MONITOR_ID).configuracion,
    fecha_creacion: '2026-07-20T10:00:00.000Z',
    fecha_actualizacion: '2026-07-20T10:00:00.000Z',
    estado_actual_monitor_monitor_id: MONITOR_ID,
    estado_actual_monitor_estado: 'desconocido',
    estado_actual_monitor_ejecutado_todavia: 1,
    estado_actual_monitor_fecha_ultima_ejecucion_utc:
      '2026-07-20T12:00:00.000Z',
    estado_actual_monitor_fecha_ultimo_cambio_utc:
      '2026-07-20T12:00:00.000Z',
    estado_actual_monitor_resultado_actual: JSON.stringify({
      codigoResultado: 'sin_observacion_actual',
      mensajeResultado: 'La señal todavía no dispone de fotografía SQL.'
    })
  });
  assert.equal(monitor.estadoActualRuntime.resumenHumano.tono, 'pendiente');
  assert.equal(
    monitor.estadoActualRuntime.resumenHumano.etiquetaEstado,
    'Desconocido'
  );
}

function crearCatalogo() {
  return new CatalogoMonitoresRuntime({
    generadoEn: '2026-07-20T12:00:00.000Z',
    monitores: [{
      id: MONITOR_ID,
      nombre: 'Temperatura cámara frigorífica',
      tipo: 'telemetria',
      interpretacionEstado: 'normal',
      descripcionFallo: 'La temperatura está fuera del rango operativo.',
      posibleSolucion: 'Revisar la refrigeración y el cierre de la cámara.',
      activo: true,
      version: 'v-501',
      scope: {
        tenantId: 1,
        empresaId: 2,
        sitioId: 3,
        nivelPertenencia: 'sitio'
      },
      programacion: {
        intervaloEjecucionSegundos: 60,
        desfaseInicialSegundos: 0
      },
      configuracion: {
        version: 1,
        condicion: {
          tipo: 'rango_numerico',
          tipoDato: 'numero',
          version: 1,
          minimo: 20,
          maximo: 95
        }
      }
    }]
  });
}

function crearVinculo() {
  return new VinculoMonitorTelemetriaPersistido({
    monitor_id: MONITOR_ID,
    tipo_fuente: 'senal_directa',
    tenant_id: 1,
    empresa_id: 2,
    sitio_id: 3,
    agente_id: 31,
    senal_id: 47,
    regla_id: null,
    senal_origen_id: 47,
    senal_origen_tipo_dato: 'numero',
    senal_origen_unidad: 'ºC',
    regla_estado: null,
    fecha_creacion: new Date('2026-07-20T10:00:00.000Z'),
    fecha_actualizacion: new Date('2026-07-20T10:00:00.000Z')
  });
}

function crearLectura(valorNumero, ultimaObservacionId) {
  return {
    agenteId: 31,
    senalId: 47,
    ultimaObservacionId,
    tipoDato: 'numero',
    unidad: 'ºC',
    valorNumero,
    valorBooleano: null,
    valorEstado: null,
    valorTexto: null,
    calidad: 'buena',
    severidadDeclarada: 'informativa',
    observadoEnUtc: '2026-07-20T11:59:00.000Z',
    recibidoEnUtc: '2026-07-20T12:00:00.000Z'
  };
}

function resultadoDe(ciclo) {
  return ciclo.loteEjecucion.resultados[0];
}

async function main() {
  await verificarCicloComunInmediato();
  await verificarRegistroProductivoYFronteras();
  verificarPresentacionNoConcluyente();
  console.log(
    'OK: ciclo operativo común inmediato de monitores de telemetría verificado.'
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
