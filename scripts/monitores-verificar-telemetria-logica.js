import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { CatalogoMonitoresRuntime } from '../apps/sentinelia-runtime/src/catalogo/CatalogoMonitoresRuntime.js';
import { AlmacenEstadoActual } from '../apps/sentinelia-runtime/src/estado/AlmacenEstadoActual.js';
import { AplicadorResultadosEstadoActual } from '../apps/sentinelia-runtime/src/estado/AplicadorResultadosEstadoActual.js';
import { EjecutorMonitorBooleano } from '../apps/sentinelia-runtime/src/ejecucion/EjecutorMonitorBooleano.js';
import { RuntimeSentinelia } from '../apps/sentinelia-runtime/src/RuntimeSentinelia.js';
import { PlanificadorMonitoresLogicosReactivos } from '../apps/sentinelia-runtime/src/scheduler/PlanificadorMonitoresLogicosReactivos.js';
import { ServicioMonitores } from '../paquetes/monitores/src/ServicioMonitores.js';

async function main() {
  await verificarSalidaEstableYPersistenciaPendiente();
  await verificarScopeYCiclosConTelemetria();
  await verificarFronterasGenericas();

  console.log(
    '[monitores-telemetria] OK integración con monitores lógicos verificada hasta 5.20b.8'
  );
}

async function verificarSalidaEstableYPersistenciaPendiente() {
  const catalogo = crearCatalogo();
  const almacen = new AlmacenEstadoActual({ catalogoOperativo: catalogo });
  const aplicador = new AplicadorResultadosEstadoActual({
    repositorioEstadoActualMonitores: {
      async guardarEstadosActuales(estados) { return estados.length; }
    }
  });
  const planificador = new PlanificadorMonitoresLogicosReactivos();
  const ejecutorLogico = new EjecutorMonitorBooleano();
  const telemetria = catalogo.buscarPorId(1);
  const logico = catalogo.buscarPorId(2);

  almacen.actualizarEstadoMonitor(telemetria.id, {
    estado: 'disponible',
    ejecutadoTodavia: true,
    pendienteScheduler: false,
    fechaUltimaEjecucionUtc: '2026-07-20T12:00:00.000Z'
  });

  const persistenciaPendiente = await aplicador.aplicar({
    almacenEstadoActual: almacen,
    resultados: [crearResultadoTelemetria({ pendiente: true })]
  });
  assert.equal(persistenciaPendiente.totalCambiosEstado, 0);
  assert.equal(
    persistenciaPendiente.monitoresActualizados[0].cambioSalidaEstable,
    false
  );
  assert.deepEqual(
    RuntimeSentinelia.prototype.extraerMonitoresConCambioSalidaEstable(
      persistenciaPendiente
    ),
    []
  );
  assert.equal(
    planificador.seleccionarDependientes({
      catalogoOperativo: catalogo,
      monitorIdsOrigen: [],
      monitoresYaEjecutados: [1]
    }).totalCandidatos,
    0,
    'Un candidato pendiente no debe iniciar una oleada lógica.'
  );

  const resultadoLogicoDuranteRetardo = await ejecutorLogico.ejecutar(logico, {
    almacenEstadoActual: almacen,
    ejecutadoEnUtc: '2026-07-20T12:00:11.000Z'
  });
  const entradaPendiente =
    resultadoLogicoDuranteRetardo.intentos[0].detalle.entradas[0];
  assert.equal(resultadoLogicoDuranteRetardo.estadoDetectado, 'disponible');
  assert.equal(entradaPendiente.valor, true);
  assert.equal(entradaPendiente.estado, 'disponible');
  assert.equal(entradaPendiente.retardoSenalDependencia.pendiente, true);
  assert.equal(entradaPendiente.retardoSenalDependencia.salidaEstable, true);
  assert.equal(entradaPendiente.retardoSenalDependencia.salidaCandidata, false);

  const persistenciaAplicada = await aplicador.aplicar({
    almacenEstadoActual: almacen,
    resultados: [crearResultadoTelemetria({ pendiente: false })]
  });
  assert.equal(persistenciaAplicada.totalCambiosEstado, 1);
  assert.equal(
    persistenciaAplicada.monitoresActualizados[0].cambioSalidaEstable,
    true
  );
  const origenes =
    RuntimeSentinelia.prototype.extraerMonitoresConCambioSalidaEstable(
      persistenciaAplicada
    );
  assert.deepEqual(origenes, [1]);

  const seleccion = planificador.seleccionarDependientes({
    catalogoOperativo: catalogo,
    monitorIdsOrigen: origenes,
    monitoresYaEjecutados: [1],
    fechaReferenciaUtc: '2026-07-20T12:00:31.000Z'
  });
  assert.deepEqual(seleccion.candidatos.map(({ monitorId }) => monitorId), [2]);
  assert.equal(
    seleccion.candidatos[0].motivoProgramacion,
    'dependencia_logica_actualizada'
  );

  const resultadoLogicoTrasAplicar = await ejecutorLogico.ejecutar(logico, {
    almacenEstadoActual: almacen,
    ejecutadoEnUtc: '2026-07-20T12:00:31.000Z'
  });
  assert.equal(resultadoLogicoTrasAplicar.estadoDetectado, 'indisponible');
  assert.equal(
    resultadoLogicoTrasAplicar.intentos[0].detalle.entradas[0].valor,
    false
  );
}

async function verificarScopeYCiclosConTelemetria() {
  const catalogoPersistido = new Map([
    [
      1,
      {
        id: 1,
        tipo: 'telemetria',
        tenantId: 1,
        empresaId: 10,
        sitioId: 20,
        configuracion: {}
      }
    ],
    [
      3,
      {
        id: 3,
        tipo: 'telemetria',
        tenantId: 2,
        empresaId: 30,
        sitioId: 40,
        configuracion: {}
      }
    ]
  ]);
  const servicio = new ServicioMonitores({
    repositorioMonitores: {
      async listarPorIds(ids) {
        return ids.map((id) => catalogoPersistido.get(Number(id))).filter(Boolean);
      }
    },
    resolutorScopeUsuario: {
      puedeAlcanzarEmpresa(contexto, empresaId, tenantId) {
        return Number(contexto.tenantId) === Number(tenantId) &&
          Number(contexto.empresaId) === Number(empresaId);
      },
      puedeAlcanzarSitio(contexto, sitioId, empresaId, tenantId) {
        return Number(contexto.tenantId) === Number(tenantId) &&
          Number(contexto.empresaId) === Number(empresaId) &&
          Number(contexto.sitioId) === Number(sitioId);
      }
    }
  });
  const contexto = {
    nivelScope: 'sitio',
    tenantId: 1,
    empresaId: 10,
    sitioId: 20
  };

  await servicio.validarDependenciasMonitorLogicoSegunScope(
    contexto,
    crearDefinicionLogicaPersistible(1),
    { idMonitorActual: 2 }
  );
  await assert.rejects(
    () => servicio.validarDependenciasMonitorLogicoSegunScope(
      contexto,
      crearDefinicionLogicaPersistible(3),
      { idMonitorActual: 2 }
    ),
    /fuera de tu alcance visible/
  );
  await assert.rejects(
    () => servicio.validarDependenciasMonitorLogicoSegunScope(
      contexto,
      crearDefinicionLogicaPersistible(2),
      { idMonitorActual: 2 }
    ),
    /no puede depender de sí mismo/
  );
}

async function verificarFronterasGenericas() {
  const [runtime, aplicador, ejecutorLogico, servicio] = await Promise.all([
    readFile(new URL('../apps/sentinelia-runtime/src/RuntimeSentinelia.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/sentinelia-runtime/src/estado/AplicadorResultadosEstadoActual.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/sentinelia-runtime/src/ejecucion/EjecutorMonitorBooleano.js', import.meta.url), 'utf8'),
    readFile(new URL('../paquetes/monitores/src/ServicioMonitores.js', import.meta.url), 'utf8')
  ]);
  assert.ok(aplicador.includes('cambioSalidaEstable: cambioEstado'));
  assert.ok(runtime.includes('extraerMonitoresConCambioSalidaEstable'));
  assert.equal(runtime.includes('propagarCandidatoTelemetria'), false);
  assert.equal(ejecutorLogico.includes("tipo === 'telemetria'"), false);
  assert.equal(servicio.includes('dependenciaTelemetriaEspecial'), false);
  assert.ok(servicio.includes('validarCiclosDependenciasMonitorLogico'));
  assert.ok(servicio.includes('puedeAlcanzarMonitor'));
}

function crearCatalogo() {
  return new CatalogoMonitoresRuntime({
    generadoEn: '2026-07-20T12:00:00.000Z',
    monitores: [
      crearDefinicionRuntime({
        id: 1,
        tipo: 'telemetria',
        nombre: 'Temperatura cámara',
        configuracion: { version: 1, retardoFalloSegundos: 30 }
      }),
      crearDefinicionRuntime({
        id: 2,
        tipo: 'booleano',
        nombre: 'Condición ambiental',
        configuracion: {
          expresion: 'TEMP',
          mensajeFallo: 'La condición ambiental no es segura.',
          estadoInicial: 'disponible',
          retardoSenalSegundos: 0,
          dependencias: [
            {
              variable: 'TEMP',
              fuente: 'monitor',
              monitorId: 1,
              etiqueta: 'Temperatura estable'
            }
          ]
        }
      }),
      crearDefinicionRuntime({
        id: 3,
        tipo: 'booleano',
        nombre: 'Fuente reservada',
        configuracion: {
          expresion: 'AGENTE',
          mensajeFallo: 'Fuente reservada.',
          dependencias: [
            {
              variable: 'AGENTE',
              fuente: 'agente',
              monitorId: 1,
              referencia: 'agente:31'
            }
          ]
        }
      })
    ]
  });
}

function crearDefinicionRuntime({ id, tipo, nombre, configuracion }) {
  return {
    id,
    tipo,
    nombre,
    interpretacionEstado: 'normal',
    descripcionFallo: `Fallo de ${nombre}`,
    posibleSolucion: `Revisar ${nombre}`,
    activo: true,
    version: `v-${id}`,
    scope: {
      tenantId: 1,
      empresaId: 10,
      sitioId: 20,
      nivelPertenencia: 'sitio'
    },
    programacion: {
      intervaloEjecucionSegundos: 60,
      desfaseInicialSegundos: 0
    },
    configuracion
  };
}

function crearResultadoTelemetria({ pendiente }) {
  return {
    monitorId: 1,
    tipo: 'telemetria',
    ejecutadoEnUtc: pendiente
      ? '2026-07-20T12:00:10.000Z'
      : '2026-07-20T12:00:30.000Z',
    finalizadoEnUtc: pendiente
      ? '2026-07-20T12:00:10.100Z'
      : '2026-07-20T12:00:30.100Z',
    duracionTotalMs: 100,
    exito: pendiente,
    estadoDetectado: pendiente ? 'disponible' : 'indisponible',
    codigoResultado: pendiente
      ? 'retardo_fallo_pendiente'
      : 'regla_derivacion_coincide',
    mensajeResultado: pendiente
      ? 'El fallo permanece pendiente.'
      : 'El fallo sostenido queda aplicado.',
    metricaPrincipal: {
      estadoEvaluacion: pendiente ? 'pendiente' : 'fallo',
      estadoCandidato: pendiente ? 'fallo' : null,
      retardoSenal: {
        activo: true,
        pendiente,
        aplicado: !pendiente,
        retardoSegundos: 30,
        salidaEstable: !pendiente ? false : true,
        salidaCandidata: false,
        iniciadoEnUtc: '2026-07-20T12:00:00.000Z',
        venceEnUtc: '2026-07-20T12:00:30.000Z',
        restanteSegundos: pendiente ? 20 : 0
      }
    },
    protocolo: { nombre: 'telemetria', tipoFuente: 'regla_derivacion' },
    intentosRealizados: 1,
    intentoExitoso: 1,
    intentos: []
  };
}

function crearDefinicionLogicaPersistible(monitorId) {
  return {
    tipo: 'booleano',
    configuracion: {
      dependencias: [
        { variable: 'TEMP', fuente: 'monitor', monitorId }
      ]
    }
  };
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
