import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { EjecutorMonitorTelemetria } from '../apps/sentinelia-runtime/src/ejecucion/EjecutorMonitorTelemetria.js';
import { DespachadorEvaluacionesTelemetriaRuntime } from '../apps/sentinelia-runtime/src/telemetria/DespachadorEvaluacionesTelemetriaRuntime.js';
import { SelectorMonitoresTelemetriaReactivos } from '../apps/sentinelia-runtime/src/telemetria/SelectorMonitoresTelemetriaReactivos.js';
import { SuscriptorInvalidacionesMonitoresTelemetriaRedis } from '../apps/sentinelia-runtime/src/telemetria/SuscriptorInvalidacionesMonitoresTelemetriaRedis.js';
import { PublicadorInvalidacionesMonitoresTelemetriaRedis } from '../paquetes/agentes/src/PublicadorInvalidacionesMonitoresTelemetriaRedis.js';
import { EvaluadorFuenteReglaMonitorTelemetria } from '../paquetes/monitores/src/EvaluadorFuenteReglaMonitorTelemetria.js';
import { VinculoMonitorTelemetriaPersistido } from '../paquetes/monitores/src/RepositorioVinculosMonitoresTelemetria.js';

const CANAL = 'sentinelia:prueba:telemetria:monitores:invalidacion';

async function main() {
  verificarMapeoTernarioYAutoridad();
  await verificarEjecutorDerivadoYRetardoComun();
  await verificarPublicacionPosteriorAlCommit();
  await verificarFalloPublicacionNoRevierteTrabajo();
  await verificarObservacionDiferidaSoloHistorica();
  await verificarAvisoYSeleccionDerivados();
  await verificarFronterasEIntegracionRuntime();

  console.log(
    '[monitores-telemetria] OK consumo de reglas 5.20a verificado hasta 5.20b.7'
  );
}

async function verificarFalloPublicacionNoRevierteTrabajo() {
  const despachador = crearDespachador({
    publicador: {
      async publicarEstadosReglasActualizados() {
        throw new Error('Redis no disponible');
      }
    },
    procesar: async () => crearResultadoProcesado({ actualizado: true })
  });
  const resumen = await despachador.procesarPendientes({ origen: 'sin_redis' });

  assert.equal(resumen.totalCompletados, 1);
  assert.equal(resumen.totalErrores, 0);
  assert.equal(resumen.invalidacionMonitores.publicado, false);
  assert.equal(
    resumen.invalidacionMonitores.motivo,
    'error_publicacion_redis'
  );
}

function verificarMapeoTernarioYAutoridad() {
  const evaluador = new EvaluadorFuenteReglaMonitorTelemetria();
  const vinculo = crearVinculoDerivado();
  const coincide = evaluador.evaluar({
    vinculo,
    estadoActualRegla: crearEstadoRegla({ resultado: 'coincide' })
  });
  const noCoincide = evaluador.evaluar({
    vinculo,
    estadoActualRegla: crearEstadoRegla({ resultado: 'no_coincide' })
  });
  const noEvaluable = evaluador.evaluar({
    vinculo,
    estadoActualRegla: crearEstadoRegla({ resultado: 'no_evaluable' })
  });

  assert.equal(coincide.esFallo(), true);
  assert.equal(coincide.codigoMotivo, 'regla_derivacion_coincide');
  assert.equal(noCoincide.esNormal(), true);
  assert.equal(noEvaluable.esDesconocido(), true);
  assert.equal(coincide.evidencia.regla.severidadCalculada, 'critica');
  assert.equal(coincide.evidencia.observacion.id, 9001);
  assert.equal(coincide.evidencia.observacion.recibidoEnUtc, '2026-07-20T12:00:00.000Z');

  const sinEstado = evaluador.evaluar({ vinculo, estadoActualRegla: null });
  assert.equal(sinEstado.codigoMotivo, 'regla_derivacion_sin_estado_actual');

  const deshabilitada = evaluador.evaluar({
    vinculo: crearVinculoDerivado({ estadoRegla: 'deshabilitada' }),
    estadoActualRegla: crearEstadoRegla({ resultado: 'coincide' })
  });
  assert.equal(deshabilitada.codigoMotivo, 'regla_derivacion_deshabilitada');

  const incompatible = evaluador.evaluar({
    vinculo,
    estadoActualRegla: crearEstadoRegla({ resultado: 'coincide', reglaId: 99 })
  });
  assert.equal(incompatible.codigoMotivo, 'identidad_estado_regla_incompatible');
}

async function verificarEjecutorDerivadoYRetardoComun() {
  const vinculo = crearVinculoDerivado();
  const ejecutor = new EjecutorMonitorTelemetria({
    repositorioVinculos: {
      async buscarPorMonitorId() { return vinculo; }
    },
    repositorioEstadoActualEvaluacionReglas: {
      async buscarPorRegla(reglaId) {
        assert.equal(reglaId, 73);
        return crearEstadoRegla({ resultado: 'coincide' });
      }
    },
    reloj: () => new Date('2026-07-20T12:00:10.000Z')
  });
  const resultado = await ejecutor.ejecutar(crearMonitorDerivado(), {
    ejecutadoEnUtc: '2026-07-20T12:00:10.000Z',
    almacenEstadoActual: { buscarPorMonitorId: () => null }
  });

  assert.equal(resultado.estadoDetectado, 'desconocido');
  assert.equal(resultado.codigoResultado, 'retardo_fallo_pendiente');
  assert.equal(resultado.protocolo.tipoFuente, 'regla_derivacion');
  assert.equal(resultado.protocolo.condicionTipo, null);
  assert.equal(resultado.metricaPrincipal.retardoSenal.iniciadoEnUtc, '2026-07-20T12:00:00.000Z');
  assert.equal(resultado.metricaPrincipal.retardoSenal.venceEnUtc, '2026-07-20T12:00:30.000Z');
  assert.equal(resultado.metricaPrincipal.resultadoEvaluado.estado, 'fallo');
}

async function verificarPublicacionPosteriorAlCommit() {
  const orden = [];
  const publicaciones = [];
  const publicador = new PublicadorInvalidacionesMonitoresTelemetriaRedis({
    clienteRedis: {
      async publish(canal, mensaje) {
        orden.push('publicar_invalidacion');
        publicaciones.push({ canal, aviso: JSON.parse(mensaje) });
        return 2;
      }
    },
    canal: CANAL,
    reloj: () => new Date('2026-07-20T12:00:05.000Z')
  });
  const despachador = crearDespachador({
    publicador,
    procesar: async () => {
      orden.push('commit');
      return crearResultadoProcesado({ actualizado: true });
    }
  });
  const resumen = await despachador.procesarPendientes({ origen: 'prueba' });

  assert.deepEqual(orden, ['commit', 'publicar_invalidacion']);
  assert.equal(resumen.invalidacionMonitores.publicado, true);
  assert.deepEqual(publicaciones[0], {
    canal: CANAL,
    aviso: {
      tipo: 'estados_reglas_telemetria_actualizados',
      totalReglas: 1,
      reglas: [{ reglaId: 73, revisionId: 101, observacionId: 9001 }],
      publicadoEnUtc: '2026-07-20T12:00:05.000Z'
    }
  });
}

async function verificarObservacionDiferidaSoloHistorica() {
  let publicaciones = 0;
  const despachador = crearDespachador({
    publicador: {
      async publicarEstadosReglasActualizados() {
        publicaciones += 1;
      }
    },
    procesar: async () => crearResultadoProcesado({ actualizado: false })
  });
  const resumen = await despachador.procesarPendientes({ origen: 'diferida' });

  assert.equal(publicaciones, 0);
  assert.equal(resumen.totalCompletados, 1);
  assert.deepEqual(resumen.invalidacionMonitores, {
    publicado: false,
    totalReglas: 0,
    motivo: 'sin_estados_actualizados'
  });
}

async function verificarAvisoYSeleccionDerivados() {
  const clienteSuscriptor = new ClienteSuscriptorRedisFalso();
  const avisos = [];
  const suscriptor = new SuscriptorInvalidacionesMonitoresTelemetriaRedis({
    clienteRedis: { duplicate: () => clienteSuscriptor },
    canal: CANAL,
    onInvalidacion: async (aviso) => avisos.push(aviso)
  });
  await suscriptor.arrancar();
  clienteSuscriptor.emitir(JSON.stringify({
    tipo: 'estados_reglas_telemetria_actualizados',
    reglas: [{ reglaId: 73, revisionId: 101, observacionId: 9001 }]
  }));
  await suscriptor.detener();
  assert.equal(avisos.length, 1);
  assert.equal(avisos[0].reglas[0].reglaId, 73);

  const consultas = [];
  const selector = new SelectorMonitoresTelemetriaReactivos({
    repositorioVinculos: {
      async listarPorSenalDirecta() { return []; },
      async listarPorReglaDerivacion(reglaId) {
        consultas.push(reglaId);
        return [{ monitorId: 501 }, { monitorId: 502 }];
      }
    }
  });
  const seleccion = await selector.seleccionar({
    catalogoOperativo: {
      buscarPorId(id) {
        return id === 501
          ? { ...crearMonitorDerivado(), id: 501, activo: true, version: 'v501' }
          : { ...crearMonitorDerivado(), id: 502, activo: false, version: 'v502' };
      }
    },
    aviso: avisos[0],
    fechaEvaluacionUtc: '2026-07-20T12:00:06.000Z'
  });
  assert.deepEqual(consultas, [73]);
  assert.equal(seleccion.totalReglas, 1);
  assert.equal(seleccion.totalVinculos, 2);
  assert.deepEqual(seleccion.candidatos.map(({ monitorId }) => monitorId), [501]);
  assert.equal(
    seleccion.candidatos[0].motivoProgramacion,
    'invalidacion_telemetria_regla'
  );
}

async function verificarFronterasEIntegracionRuntime() {
  const [procesador, proyector, ejecutor, runtime] = await Promise.all([
    readFile(new URL('../paquetes/agentes/src/ProcesadorTrabajosEvaluacionTelemetria.js', import.meta.url), 'utf8'),
    readFile(new URL('../paquetes/agentes/src/ProyectorEvaluacionesDerivadasTelemetria.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/sentinelia-runtime/src/ejecucion/EjecutorMonitorTelemetria.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/sentinelia-runtime/src/RuntimeSentinelia.js', import.meta.url), 'utf8')
  ]);
  assert.ok(procesador.indexOf('await conexion.commit()') < procesador.indexOf('return proyeccion'));
  assert.ok(proyector.includes('OBSERVACION_DIFERIDA'));
  assert.ok(ejecutor.includes('repositorioEstadoActualEvaluacionReglas'));
  assert.equal(ejecutor.includes('RepositorioEventosDerivadosTelemetria'), false);
  assert.equal(ejecutor.includes('EvaluadorCondicionesDerivacionTelemetria'), false);
  assert.equal(runtime.match(/this\.aplicarCicloOperativoMonitores\(\{/g)?.length, 2);
  assert.ok(runtime.includes('publicadorInvalidacionesMonitoresTelemetriaRedis'));
}

function crearDespachador({ publicador, procesar }) {
  return new DespachadorEvaluacionesTelemetriaRuntime({
    repositorioTrabajos: {
      async reclamarSiguientes() { return [{ id: 1, intentos: 1 }]; }
    },
    procesadorTrabajos: { procesar },
    publicadorInvalidacionesMonitores: publicador,
    instanciaId: 'runtime-prueba',
    reloj: () => new Date('2026-07-20T12:00:05.000Z'),
    generarIdReclamacion: () => 'reclamo-prueba'
  });
}

function crearResultadoProcesado({ actualizado }) {
  return {
    ok: true,
    trabajoId: 1,
    intentos: 1,
    resultado: { resultado: 'coincide', codigoMotivo: 'valor_mayor_que' },
    persistencia: {
      estadoActualizado: actualizado,
      gobiernaEstadoActual: actualizado,
      estadoActual: crearEstadoRegla({ resultado: 'coincide' }),
      cambioEstadoActual() { return actualizado; }
    }
  };
}

function crearVinculoDerivado({ estadoRegla = 'activa' } = {}) {
  return new VinculoMonitorTelemetriaPersistido({
    monitor_id: 501,
    tipo_fuente: 'regla_derivacion',
    tenant_id: 1,
    empresa_id: 2,
    sitio_id: 3,
    agente_id: 31,
    senal_id: null,
    regla_id: 73,
    senal_origen_id: 47,
    senal_origen_tipo_dato: 'numero',
    senal_origen_unidad: 'ºC',
    regla_estado: estadoRegla,
    fecha_creacion: new Date('2026-07-20T10:00:00.000Z'),
    fecha_actualizacion: new Date('2026-07-20T10:00:00.000Z')
  });
}

function crearEstadoRegla({ resultado, reglaId = 73 } = {}) {
  return {
    reglaId,
    revisionId: 101,
    observacionId: 9001,
    agenteId: 31,
    senalId: 47,
    tenantId: 1,
    empresaId: 2,
    sitioId: 3,
    resultado,
    codigoMotivo: resultado === 'no_evaluable' ? 'calidad_no_evaluable' : 'comparacion_realizada',
    explicacion: 'Resultado vigente calculado por la regla 5.20a.',
    condicionCanonica: '{"tipo":"numero"}',
    valorEvaluado: 96,
    tipoDato: 'numero',
    unidad: 'ºC',
    calidad: 'buena',
    severidadCalculada: resultado === 'coincide' ? 'critica' : null,
    mensajeOperativo: 'Temperatura derivada fuera de tolerancia.',
    evidenciaContextual: { origen: 'regla' },
    observadoEnUtc: '2026-07-20T11:59:59.000Z',
    recibidoEnUtc: '2026-07-20T12:00:00.000Z',
    evaluadoEnUtc: '2026-07-20T12:00:01.000Z'
  };
}

function crearMonitorDerivado() {
  return {
    id: 501,
    nombre: 'Temperatura derivada',
    tipo: 'telemetria',
    activo: true,
    scope: { tenantId: 1, empresaId: 2, sitioId: 3 },
    configuracion: { version: 1, retardoFalloSegundos: 30 }
  };
}

class ClienteSuscriptorRedisFalso {
  async connect() { this.isOpen = true; }
  on() {}
  async subscribe(_canal, receptor) { this.receptor = receptor; }
  emitir(mensaje) { this.receptor(mensaje); }
  async unsubscribe() {}
  async quit() { this.isOpen = false; }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
