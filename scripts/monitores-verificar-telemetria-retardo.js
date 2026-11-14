import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { GestorAlertasActivasMonitor } from '../apps/sentinelia-runtime/src/alertas/GestorAlertasActivasMonitor.js';
import { MotorMonitores } from '../apps/sentinelia-runtime/src/ejecucion/MotorMonitores.js';
import { EjecutorMonitorTelemetria } from '../apps/sentinelia-runtime/src/ejecucion/EjecutorMonitorTelemetria.js';
import { RegistroEjecutoresMonitor } from '../apps/sentinelia-runtime/src/ejecucion/RegistroEjecutoresMonitor.js';
import { AplicadorResultadosEstadoActual } from '../apps/sentinelia-runtime/src/estado/AplicadorResultadosEstadoActual.js';
import { AlmacenEstadoActual } from '../apps/sentinelia-runtime/src/estado/AlmacenEstadoActual.js';
import { RehidratadorEstado } from '../apps/sentinelia-runtime/src/estado/RehidratadorEstado.js';
import { PersistidorEventosMonitores } from '../apps/sentinelia-runtime/src/eventos/PersistidorEventosMonitores.js';
import { ServicioEventosMonitores } from '../apps/sentinelia-runtime/src/eventos/ServicioEventosMonitores.js';
import { GestorHistoricoMonitores } from '../apps/sentinelia-runtime/src/historico/GestorHistoricoMonitores.js';
import { SelectorMonitoresVencidos } from '../apps/sentinelia-runtime/src/scheduler/SelectorMonitoresVencidos.js';
import { MotorTriggersRuntime } from '../apps/sentinelia-runtime/src/triggers/MotorTriggersRuntime.js';
import {
  crearConfiguracionMonitorTelemetria,
  RETARDO_FALLO_MAXIMO_SEGUNDOS_MONITOR_TELEMETRIA
} from '../paquetes/monitores/src/ConfiguracionMonitorTelemetria.js';
import {
  ESTADOS_MONITOR_TELEMETRIA,
  ResultadoMonitorTelemetria
} from '../paquetes/monitores/src/MonitorTelemetriaAgente.js';
import { PlanificadorTransicionesTelemetriaPendientes } from '../paquetes/monitores/src/PlanificadorTransicionesTelemetriaPendientes.js';
import { VinculoMonitorTelemetriaPersistido } from '../paquetes/monitores/src/RepositorioVinculosMonitoresTelemetria.js';

const MONITOR_ID = 501;
const planificador = new PlanificadorTransicionesTelemetriaPendientes();

async function main() {
  verificarContratoConfiguracion();
  verificarPlanificacionPura();
  await verificarCicloPersistenciaYVencimiento();
  await verificarFronterasTemporales();

  console.log(
    '[monitores-telemetria] OK retardo sostenido y vencimiento autónomo verificados hasta 5.20b.6'
  );
}

function verificarContratoConfiguracion() {
  const inmediata = crearConfiguracionMonitorTelemetria(configuracion(0));
  const sostenida = crearConfiguracionMonitorTelemetria(configuracion(30));
  assert.equal(inmediata.retardoFalloSegundos, 0);
  assert.equal(sostenida.retardoFalloSegundos, 30);
  assert.deepEqual(sostenida.serializar(), configuracion(30));
  for (const valor of [-1, 1.5, 'treinta', 86401]) {
    assert.throws(
      () => crearConfiguracionMonitorTelemetria(configuracion(valor)),
      /retardo de fallo/
    );
  }
  assert.equal(RETARDO_FALLO_MAXIMO_SEGUNDOS_MONITOR_TELEMETRIA, 86400);
}

function verificarPlanificacionPura() {
  const fallo = crearResultadoEvaluado('fallo', '2026-07-20T12:00:00.000Z');
  const normal = crearResultadoEvaluado('normal', '2026-07-20T12:00:20.000Z');
  const estadoNormal = {
    ejecutadoTodavia: true,
    estado: 'disponible',
    resultadoActual: null
  };
  const iniciado = planificador.resolver({
    resultadoEvaluado: fallo,
    estadoActualMonitor: estadoNormal,
    retardoFalloSegundos: 30,
    recibidoEnUtc: '2026-07-20T12:00:00.000Z',
    evaluadoEnUtc: '2026-07-20T12:00:10.000Z'
  });
  assert.equal(iniciado.resultado.esPendiente(), true);
  assert.equal(iniciado.resultado.estadoCandidato, 'fallo');
  assert.equal(iniciado.estadoEstableRuntime, 'disponible');
  assert.equal(iniciado.retardoSenal.pendiente, true);
  assert.equal(iniciado.retardoSenal.iniciadoEnUtc, '2026-07-20T12:00:00.000Z');
  assert.equal(iniciado.retardoSenal.venceEnUtc, '2026-07-20T12:00:30.000Z');
  assert.equal(iniciado.retardoSenal.restanteSegundos, 20);
  assert.equal(iniciado.retardoSenal.evento.tipo, 'retardo_senal_iniciado');

  const estadoPendiente = {
    ...estadoNormal,
    resultadoActual: { metricaPrincipal: { retardoSenal: iniciado.retardoSenal } }
  };
  const repetido = planificador.resolver({
    resultadoEvaluado: crearResultadoEvaluado(
      'fallo',
      '2026-07-20T12:00:18.000Z'
    ),
    estadoActualMonitor: estadoPendiente,
    retardoFalloSegundos: 30,
    recibidoEnUtc: '2026-07-20T12:00:18.000Z',
    evaluadoEnUtc: '2026-07-20T12:00:20.000Z'
  });
  assert.equal(repetido.retardoSenal.iniciadoEnUtc, '2026-07-20T12:00:00.000Z');
  assert.equal(repetido.retardoSenal.evento.tipo, 'retardo_senal_pendiente');
  assert.equal(repetido.retardoSenal.restanteSegundos, 10);

  const cancelado = planificador.resolver({
    resultadoEvaluado: normal,
    estadoActualMonitor: estadoPendiente,
    retardoFalloSegundos: 30,
    recibidoEnUtc: '2026-07-20T12:00:20.000Z',
    evaluadoEnUtc: '2026-07-20T12:00:20.000Z'
  });
  assert.equal(cancelado.resultado.esNormal(), true);
  assert.equal(cancelado.retardoSenal.pendiente, false);
  assert.equal(cancelado.retardoSenal.evento.tipo, 'retardo_senal_cancelado');
  assert.equal(cancelado.retardoSenal.evento.motivo, 'senal_en_tolerancia');

  const aplicado = planificador.resolver({
    resultadoEvaluado: fallo,
    estadoActualMonitor: estadoPendiente,
    retardoFalloSegundos: 30,
    recibidoEnUtc: '2026-07-20T12:00:00.000Z',
    evaluadoEnUtc: '2026-07-20T12:00:30.000Z'
  });
  assert.equal(aplicado.resultado.esFallo(), true);
  assert.equal(aplicado.estadoEstableRuntime, 'indisponible');
  assert.equal(aplicado.retardoSenal.aplicado, true);
  assert.equal(aplicado.retardoSenal.evento.tipo, 'retardo_senal_aplicado');

  const inmediata = planificador.resolver({
    resultadoEvaluado: fallo,
    retardoFalloSegundos: 0,
    recibidoEnUtc: '2026-07-20T12:00:00.000Z',
    evaluadoEnUtc: '2026-07-20T12:00:00.000Z'
  });
  assert.equal(inmediata.resultado.esFallo(), true);
  assert.equal(inmediata.retardoSenal.activo, false);

  const yaVencidaAlConocerse = planificador.resolver({
    resultadoEvaluado: fallo,
    retardoFalloSegundos: 30,
    recibidoEnUtc: '2026-07-20T12:00:00.000Z',
    evaluadoEnUtc: '2026-07-20T12:01:00.000Z'
  });
  assert.equal(yaVencidaAlConocerse.resultado.esFallo(), true);
  assert.equal(yaVencidaAlConocerse.retardoSenal.aplicado, true);

  const sinFechaControlada = planificador.resolver({
    resultadoEvaluado: fallo,
    estadoActualMonitor: estadoNormal,
    retardoFalloSegundos: 30,
    recibidoEnUtc: null,
    evaluadoEnUtc: '2026-07-20T12:00:10.000Z'
  });
  assert.equal(sinFechaControlada.resultado.esDesconocido(), true);
  assert.equal(
    sinFechaControlada.resultado.codigoMotivo,
    'retardo_fallo_sin_fecha_recibida'
  );

  const desconocido = new ResultadoMonitorTelemetria({
    estado: ESTADOS_MONITOR_TELEMETRIA.DESCONOCIDO,
    codigoMotivo: 'fotografia_no_evaluable',
    evidencia: { detalle: 'La fotografía no es evaluable.' }
  });
  const falloEstable = {
    ejecutadoTodavia: true,
    estado: 'indisponible',
    resultadoActual: null
  };
  const noEvaluable = planificador.resolver({
    resultadoEvaluado: desconocido,
    estadoActualMonitor: falloEstable,
    retardoFalloSegundos: 30,
    evaluadoEnUtc: '2026-07-20T12:00:20.000Z'
  });
  assert.equal(noEvaluable.resultado.esDesconocido(), true);
  assert.equal(noEvaluable.retardoSenal.estadoEstable, 'fallo');
  const falloTrasDesconocido = planificador.resolver({
    resultadoEvaluado: fallo,
    estadoActualMonitor: {
      ejecutadoTodavia: true,
      estado: 'desconocido',
      resultadoActual: {
        metricaPrincipal: { retardoSenal: noEvaluable.retardoSenal }
      }
    },
    retardoFalloSegundos: 30,
    recibidoEnUtc: '2026-07-20T12:00:21.000Z',
    evaluadoEnUtc: '2026-07-20T12:00:21.000Z'
  });
  assert.equal(falloTrasDesconocido.resultado.esFallo(), true);
  assert.equal(falloTrasDesconocido.retardoSenal.pendiente, false);
}

async function verificarCicloPersistenciaYVencimiento() {
  const monitor = crearMonitor();
  const catalogo = crearCatalogo(monitor);
  const repositorioEstado = new RepositorioEstadoMemoria();
  let ahoraUtc = '2026-07-20T11:59:50.000Z';
  let lectura = crearLectura(42, '2026-07-20T11:59:49.000Z', 9000);
  const ejecutor = new EjecutorMonitorTelemetria({
    repositorioVinculos: {
      async buscarPorMonitorId() {
        return crearVinculo();
      }
    },
    repositorioEstadoActualTelemetria: {
      async buscarPorSenalId() {
        return lectura;
      }
    },
    reloj: () => new Date(ahoraUtc)
  });
  const motor = new MotorMonitores({
    registroEjecutores: new RegistroEjecutoresMonitor({ ejecutores: [ejecutor] })
  });
  const aplicador = new AplicadorResultadosEstadoActual({
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
  const motorTriggers = new MotorTriggersRuntime({
    servicioTriggers: {
      async resolverDisparosDesdeTransiciones() {
        return { totalDisparos: 0, disparos: [] };
      }
    }
  });
  let almacen = new AlmacenEstadoActual({ catalogoOperativo: catalogo });

  async function ejecutar() {
    const lote = await motor.ejecutarMonitores({
      catalogoOperativo: catalogo,
      almacenEstadoActual: almacen,
      candidatos: [crearCandidato(ahoraUtc)]
    });
    const persistenciaEstado = await aplicador.aplicar({
      almacenEstadoActual: almacen,
      resultados: lote.resultados
    });
    const persistenciaEventos = await persistidorEventos.persistirDesdeLote({
      catalogoOperativo: catalogo,
      loteEjecucion: lote
    });
    const persistenciaAlertas = await gestorAlertas.aplicarResultados({
      catalogoOperativo: catalogo,
      resultados: lote.resultados
    });
    const persistenciaHistorico = await gestorHistorico.aplicarResultados({
      catalogoOperativo: catalogo,
      resultados: lote.resultados,
      persistenciaEventos
    });
    const persistenciaTriggers = await motorTriggers.ejecutarDesdePersistenciaAlertas({
      persistenciaAlertas,
      origen: 'verificacion_5_20b_6'
    });
    return {
      resultado: lote.resultados[0],
      persistenciaEstado,
      persistenciaEventos,
      persistenciaAlertas,
      persistenciaHistorico,
      persistenciaTriggers
    };
  }

  const normal = await ejecutar();
  assert.equal(normal.resultado.estadoDetectado, 'disponible');

  lectura = crearLectura(96, '2026-07-20T12:00:00.000Z', 9001);
  ahoraUtc = '2026-07-20T12:00:10.000Z';
  const pendiente = await ejecutar();
  assert.equal(pendiente.resultado.estadoDetectado, 'disponible');
  assert.equal(pendiente.resultado.codigoResultado, 'retardo_fallo_pendiente');
  assert.equal(
    pendiente.resultado.metricaPrincipal.resultadoEvaluado.estado,
    'fallo'
  );
  assert.equal(
    pendiente.resultado.metricaPrincipal.retardoSenal.evento.tipo,
    'retardo_senal_iniciado'
  );
  assert.equal(pendiente.persistenciaEstado.totalCambiosEstado, 0);
  assert.equal(pendiente.persistenciaEventos.totalPersistidos, 1);
  assert.equal(
    repositorioEventos.eventos.at(-1).payloadEvento.metricaPrincipal
      .retardoSenal.evento.tipo,
    'retardo_senal_iniciado'
  );
  assert.equal(pendiente.persistenciaAlertas.totalAperturas, 0);
  assert.equal(pendiente.persistenciaAlertas.totalCierres, 0);
  assert.equal(pendiente.persistenciaTriggers.omitido, true);
  assert.equal(pendiente.persistenciaHistorico.totalTransiciones, 1);
  assert.equal(
    repositorioHistorico.tramos.at(-1).payloadTramo.metricaPrincipal
      .resultadoEvaluado.estado,
    'fallo'
  );
  assert.equal(repositorioAlertas.alertas.size, 0);

  const almacenRehidratado = new AlmacenEstadoActual({
    catalogoOperativo: catalogo
  });
  const resumenRehidratacion = await new RehidratadorEstado({
    repositorioEstadoActualMonitores: repositorioEstado
  }).rehidratar({
    catalogoOperativo: catalogo,
    almacenEstadoActual: almacenRehidratado
  });
  assert.equal(resumenRehidratacion.rehidratados, 1);
  assert.equal(
    almacenRehidratado.buscarPorMonitorId(MONITOR_ID).resultadoActual
      .metricaPrincipal.retardoSenal.venceEnUtc,
    '2026-07-20T12:00:30.000Z'
  );

  lectura = crearLectura(42, '2026-07-20T12:00:20.000Z', 9002);
  ahoraUtc = '2026-07-20T12:00:20.000Z';
  const cancelacion = await ejecutar();
  assert.equal(cancelacion.resultado.estadoDetectado, 'disponible');
  assert.equal(
    cancelacion.resultado.metricaPrincipal.retardoSenal.evento.tipo,
    'retardo_senal_cancelado'
  );
  assert.equal(cancelacion.persistenciaEventos.totalPersistidos, 1);
  assert.equal(
    repositorioEventos.eventos.at(-1).payloadEvento.metricaPrincipal
      .retardoSenal.evento.tipo,
    'retardo_senal_cancelado'
  );
  assert.equal(cancelacion.persistenciaAlertas.totalAperturas, 0);
  assert.equal(cancelacion.persistenciaAlertas.totalCierres, 0);
  assert.equal(cancelacion.persistenciaTriggers.omitido, true);
  assert.equal(cancelacion.persistenciaHistorico.totalTransiciones, 1);
  assert.equal(repositorioAlertas.alertas.size, 0);

  almacen = almacenRehidratado;
  lectura = crearLectura(96, '2026-07-20T12:00:00.000Z', 9001);

  const antesDeVencer = new SelectorMonitoresVencidos().seleccionar({
    catalogoOperativo: catalogo,
    almacenEstadoActual: almacen,
    fechaEvaluacionUtc: '2026-07-20T12:00:20.000Z'
  });
  assert.equal(antesDeVencer.totalVencidos, 0);
  assert.equal(antesDeVencer.proximoIntentoGlobalEn, '2026-07-20T12:00:30.000Z');
  assert.equal(
    antesDeVencer.programaciones[0].motivoProgramacion,
    'retardo_senal_vencido'
  );

  const alVencer = new SelectorMonitoresVencidos().seleccionar({
    catalogoOperativo: catalogo,
    almacenEstadoActual: almacen,
    fechaEvaluacionUtc: '2026-07-20T12:00:30.000Z'
  });
  assert.equal(alVencer.totalVencidos, 1);
  assert.equal(alVencer.monitoresVencidos[0].motivoProgramacion, 'retardo_senal_vencido');

  ahoraUtc = '2026-07-20T12:00:30.000Z';
  const falloAplicado = await ejecutar();
  assert.equal(falloAplicado.resultado.estadoDetectado, 'indisponible');
  assert.equal(
    falloAplicado.resultado.metricaPrincipal.retardoSenal.evento.tipo,
    'retardo_senal_aplicado'
  );
  assert.equal(falloAplicado.persistenciaEstado.totalCambiosEstado, 1);
  assert.equal(falloAplicado.persistenciaAlertas.totalAperturas, 1);
  assert.equal(repositorioAlertas.alertas.size, 1);
}

async function verificarFronterasTemporales() {
  const [planificadorFuente, selectorFuente, ejecutorFuente] = await Promise.all([
    readFile(
      new URL('../paquetes/monitores/src/PlanificadorTransicionesTelemetriaPendientes.js', import.meta.url),
      'utf8'
    ),
    readFile(
      new URL('../apps/sentinelia-runtime/src/scheduler/SelectorMonitoresVencidos.js', import.meta.url),
      'utf8'
    ),
    readFile(
      new URL('../apps/sentinelia-runtime/src/ejecucion/EjecutorMonitorTelemetria.js', import.meta.url),
      'utf8'
    )
  ]);
  assert.ok(planificadorFuente.includes('recibidoEnUtc'));
  assert.equal(planificadorFuente.includes('observadoEnUtc'), false);
  assert.equal(/muestras|contadorMuestras/i.test(planificadorFuente), false);
  assert.ok(selectorFuente.includes("motivoProgramacion = 'retardo_senal_vencido'"));
  assert.ok(ejecutorFuente.includes('almacenEstadoActual?.buscarPorMonitorId?.('));
}

function crearResultadoEvaluado(estado, recibidoEnUtc) {
  return new ResultadoMonitorTelemetria({
    estado: estado === 'fallo'
      ? ESTADOS_MONITOR_TELEMETRIA.FALLO
      : ESTADOS_MONITOR_TELEMETRIA.NORMAL,
    codigoMotivo: estado === 'fallo' ? 'valor_sobre_maximo' : 'valor_en_tolerancia',
    evidencia: {
      observacion: {
        id: 9001,
        valor: estado === 'fallo' ? 96 : 42,
        recibidoEnUtc
      },
      detalle: estado === 'fallo' ? 'Fuera de tolerancia.' : 'En tolerancia.'
    }
  });
}

function configuracion(retardoFalloSegundos) {
  return {
    version: 1,
    retardoFalloSegundos,
    condicion: {
      tipo: 'rango_numerico',
      tipoDato: 'numero',
      version: 1,
      minimo: 20,
      maximo: 95
    }
  };
}

function crearMonitor() {
  return {
    id: MONITOR_ID,
    nombre: 'Temperatura cámara',
    tipo: 'telemetria',
    interpretacionEstado: 'normal',
    descripcionFallo: 'Temperatura fuera de tolerancia.',
    posibleSolucion: 'Revisar la refrigeración.',
    activo: true,
    version: 'v-501',
    scope: {
      tenantId: 1,
      empresaId: 2,
      sitioId: 3,
      nivelPertenencia: 'sitio'
    },
    programacion: {
      intervaloEjecucionSegundos: 300,
      desfaseInicialSegundos: 0
    },
    configuracion: configuracion(30)
  };
}

function crearCatalogo(monitor) {
  return {
    generadoEn: '2026-07-20T11:00:00.000Z',
    monitores: [monitor],
    buscarPorId(id) {
      return Number(id) === monitor.id ? monitor : null;
    }
  };
}

function crearCandidato(proximoIntentoEn) {
  return {
    monitorId: MONITOR_ID,
    nombre: 'Temperatura cámara',
    tipo: 'telemetria',
    versionCatalogo: 'v-501',
    scope: crearMonitor().scope,
    proximoIntentoEn,
    retrasoSegundos: 0,
    motivoProgramacion: 'invalidacion_telemetria_directa'
  };
}

function crearLectura(valor, recibidoEnUtc, ultimaObservacionId) {
  return {
    agenteId: 31,
    senalId: 47,
    ultimaObservacionId,
    tipoDato: 'numero',
    unidad: 'ºC',
    valorNumero: valor,
    valorBooleano: null,
    valorEstado: null,
    valorTexto: null,
    calidad: 'valida',
    severidadDeclarada: 'info',
    observadoEnUtc: recibidoEnUtc,
    recibidoEnUtc
  };
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

class RepositorioEstadoMemoria {
  estados = new Map();

  async guardarEstadosActuales(estados) {
    for (const estado of estados) {
      this.estados.set(estado.monitorId, estado.serializar());
    }
    return estados.length;
  }

  async eliminarEstadosHuerfanosOInactivos() {
    return 0;
  }

  async listarPorMonitorIds(ids) {
    return ids.map((id) => this.estados.get(id)).filter(Boolean).map((estado) => ({
      monitor_id: estado.monitorId,
      version_catalogo: estado.versionCatalogo,
      estado: estado.estado,
      ejecutado_todavia: estado.ejecutadoTodavia ? 1 : 0,
      pendiente_scheduler: estado.pendienteScheduler ? 1 : 0,
      fecha_ultima_ejecucion_utc: estado.fechaUltimaEjecucionUtc,
      fecha_ultimo_cambio_utc: estado.fechaUltimoCambioUtc,
      resultado_actual: JSON.stringify(estado.resultadoActual),
      motivo_inicial: estado.motivoInicial
    }));
  }
}

class RepositorioEventosMemoria {
  eventos = [];

  async guardarEventosDetallado(eventos) {
    this.eventos.push(...eventos);
    return { totalPersistidos: eventos.length, eventosPersistidos: eventos };
  }

  async listarUltimosPorMonitorIds(ids) {
    return ids.map((id) => this.eventos.findLast((evento) => evento.monitorId === id))
      .filter(Boolean);
  }
}

class RepositorioAlertasMemoria {
  alertas = new Map();

  async listarPorMonitorIds(ids) {
    return ids.map((id) => this.alertas.get(id)).filter(Boolean);
  }

  async guardarAlertas(alertas) {
    for (const alerta of alertas) {
      this.alertas.set(alerta.monitorId, alerta);
    }
    return alertas.length;
  }

  async eliminarPorMonitorIds(ids) {
    let total = 0;
    for (const id of ids) {
      total += this.alertas.delete(id) ? 1 : 0;
    }
    return total;
  }
}

class RepositorioHistoricoMemoria {
  tramos = [];

  async listarUltimosPorMonitorIds(ids) {
    return ids.map((id) => this.tramos.findLast((tramo) => tramo.monitorId === id))
      .filter(Boolean);
  }

  async guardarTramos(tramos) {
    this.tramos.push(...tramos);
    return tramos.length;
  }

  async actualizarTramo(tramo) {
    const indice = this.tramos.findIndex((actual) => actual.id === tramo.id);
    if (indice >= 0) {
      this.tramos[indice] = tramo;
    } else {
      this.tramos.push(tramo);
    }
    return 1;
  }
}

await main();
