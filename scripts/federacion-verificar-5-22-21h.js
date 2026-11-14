import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { crearPuertosCapturaTecnicaFederacion }
  from '../paquetes/federacion/aplicacion/crearPuertosCapturaTecnicaFederacion.js';
import { crearDefinicionAdaptadorMonitoresFederacion }
  from '../paquetes/federacion/adaptadores/AdaptadorMonitoresFederacion.js';
import { crearDefinicionAdaptadorTelemetriaFederacion }
  from '../paquetes/federacion/adaptadores/AdaptadorTelemetriaFederacion.js';
import { crearDefinicionAdaptadorTriggersInformativosFederacion }
  from '../paquetes/federacion/adaptadores/AdaptadorTriggersInformativosFederacion.js';
import { crearDefinicionAdaptadorEstructuraOrganizativaFederacion }
  from '../paquetes/federacion/adaptadores/AdaptadorEstructuraOrganizativaFederacionSql.js';
import { crearAdaptadorFamiliaFederacion }
  from '../paquetes/federacion/src/AdaptadoresFamiliasFederacion.js';
import {
  crearSolicitudCapturaFederacion,
  OPERACIONES_CAPTURA_FEDERACION,
  OPERACIONES_CAPTURA_TECNICA_FEDERACION
}
  from '../paquetes/federacion/src/OperacionesCapturaTecnicaFederacion.js';
import { AdaptadorCoordinacionOutboxAuditoriaRuntime }
  from '../paquetes/auditoria/src/AdaptadorCoordinacionOutboxAuditoriaRuntime.js';
import { ServicioTriggers } from '../paquetes/triggers/src/ServicioTriggers.js';

const conexion = Object.freeze({
  nombre: 'conexion-local-prestada',
  execute: async (sql) => sql.includes('identidades_elementos_telemetria_federacion')
    ? [[]]
    : (() => { throw new Error(`SQL inesperado: ${sql}`); })()
});
const llamadas = [];
const capturador = {
  async capturarEnTransaccion({ familia, prepararCapturas }, opciones) {
    assert.equal(opciones.conexion, conexion);
    const producidas = [];
    const interfazCaptura = {
      prepararCapturaEnTransaccion: registrarCapturaComun(producidas)
    };
    const resultado = await prepararCapturas({
      selector: {
        permiteContenidoSensible: true,
        campos: ['contenidoSensibleEjecucion']
      },
      interfazCaptura
    });
    llamadas.push({ familia, producidas, resultado });
    return { estado: 'capturada', ocurrencias: [], posiciones: [] };
  }
};
const puertos = crearPuertosCapturaTecnicaFederacion({ capturador });

await puertos.monitores.capturarRuntimeEnTransaccion(
  { estadoMonitorIds: ['1'], eventoIds: ['2'] }, { conexion }
);
await puertos.telemetria.capturarIngestaEnTransaccion(
  { agenteId: '3', observacionIds: ['4'] }, { conexion }
);
await puertos.telemetria.capturarReglaEnTransaccion(
  { reglaId: '5' }, { conexion }
);
await puertos.telemetria.capturarEvaluacionEnTransaccion({
  reglaId: '5', estadoActualizado: true,
  eventoCreado: true, eventoDerivadoId: '6'
}, { conexion });
const sinCambio = await puertos.telemetria.capturarEvaluacionEnTransaccion({
  reglaId: '5', estadoActualizado: false, eventoCreado: false
}, { conexion });
await puertos.triggers.capturarEjecucionEnTransaccion(
  { ejecucionId: '7' }, { conexion }
);
await puertos.auditoria.capturarEventoEnTransaccion(
  { eventoId: '018f1000-0000-7000-8000-000000000008' }, { conexion }
);
await verificarEjecucionTriggerAtomica();
await verificarAuditoriaRuntimeAtomica();
await verificarFuenteCompartidaEntreVistas();
await verificarDespachoTrasFachadaComun();

assert.deepEqual(llamadas.map(({ familia }) => familia), [
  'monitores', 'telemetria', 'telemetria', 'telemetria', 'triggersInformativos',
  'auditoria'
]);
assert.deepEqual(llamadas[0].producidas[0], {
  metodo: 'runtimeMonitores',
  solicitud: { estadoMonitorIds: ['1'], eventoIds: ['2'] },
  conexion
});
assert.equal(llamadas[1].producidas[0].solicitud.incluirFuente, true);
assert.equal(llamadas[3].producidas.length, 2,
  'estado derivado y evento nuevo son ocurrencias distintas');
assert.deepEqual(llamadas[3].producidas.map(({ solicitud }) => solicitud), [
  { tipoRegistro: 'reglaDerivacion', idLocal: '5' },
  { tipoRegistro: 'eventoDerivado', idLocal: '6' }
]);
assert.equal(sinCambio.estado, 'sinCambiosFederables');
assert.equal(llamadas[4].producidas[0].solicitud.incluirContenidoSensible, true);
assert.equal(llamadas[4].producidas[0].solicitud.puedeFederarContenidoSensible, true);

await verificarComposicion();

console.log(
  '[federacion] OK 5.22.21h: runtime=productores_reales ' +
  'monitores=estado+eventos+alertas+historico telemetria=ingesta+derivacion ' +
  'triggers=terminales transaccion=local+ocurrencia+outbox'
);

function registrarCapturaComun(producidas) {
  return async (entrada, opciones) => {
    const metodos = {
      [OPERACIONES_CAPTURA_TECNICA_FEDERACION.MONITORES_RUNTIME]: 'runtimeMonitores',
      [OPERACIONES_CAPTURA_TECNICA_FEDERACION.TELEMETRIA_INGESTA]: 'ingestaTelemetria',
      [OPERACIONES_CAPTURA_TECNICA_FEDERACION.TRIGGERS_EJECUCION]: 'ejecucionTrigger'
    };
    const metodo = metodos[entrada?.operacionCapturaTecnica] || 'registroTelemetria';
    const solicitud = entrada?.operacionCapturaTecnica ? entrada.solicitud : entrada;
    producidas.push({ metodo, solicitud, conexion: opciones.conexion });
    return { metodo, solicitud };
  };
}

async function verificarComposicion() {
  const [bootstrap, runtime, web, ingesta, procesador, triggers, telemetriaLocal,
    adaptadorAuditoria] =
    await Promise.all([
      leer('../apps/sentinelia-runtime/src/BootstrapRuntime.js'),
      leer('../apps/sentinelia-runtime/src/RuntimeSentinelia.js'),
      leer('../apps/sentinelia-web/src/index.js'),
      leer('../paquetes/agentes/src/ServicioIngestaTelemetriaAgentes.js'),
      leer('../paquetes/agentes/src/ProcesadorTrabajosEvaluacionTelemetria.js'),
      leer('../paquetes/triggers/src/ServicioTriggers.js'),
      leer('../paquetes/federacion/adaptadores/RepositorioTelemetriaLocalSql.js'),
      leer('../paquetes/auditoria/src/AdaptadorCoordinacionOutboxAuditoriaRuntime.js')
    ]);
  assert.match(bootstrap, /capturadorFederacionMonitores: capturadoresTecnicosFederacion\.monitores/u);
  assert.match(runtime, /contextoBootstrap\.capturadorFederacionMonitores/u);
  assert.match(bootstrap, /capturadorFederacionTelemetria: capturadoresTecnicosFederacion\.telemetria/u);
  assert.match(bootstrap, /capturadorFederacionEjecuciones: capturadoresTecnicosFederacion\.triggers/u);
  assert.match(web, /capturadorFederacionTelemetria: capturadoresTecnicosFederacion\.telemetria/u);
  assert.match(ingesta, /capturarIngestaEnTransaccion/u);
  assert.ok(
    procesador.indexOf('capturarEvaluacionEnTransaccion') <
      procesador.indexOf('marcarCompletado'),
    'la ocurrencia derivada debe persistirse antes de completar el trabajo'
  );
  assert.match(triggers, /capturadorFederacionEjecuciones\.capturarEjecucionEnTransaccion/u);
  assert.match(telemetriaLocal, /seleccion\.unshift\(\{ tipo: 'fuente', id: agente \}\)/u,
    'la primera ingesta debe poder materializar también su fuente');
  assert.match(telemetriaLocal, /if \(incluirFuente\)/u,
    'las ingestas posteriores no deben repetir la definición de fuente');
  assert.match(await leer('../paquetes/federacion/aplicacion/crearPuertosCapturaTecnicaFederacion.js'),
    /requiereFuenteTelemetria/u,
    'la decisión de fuente debe fijarse antes de preparar las vistas contractuales');
  assert.match(telemetriaLocal,
    /\['fotografiaSenal', 'fotografiaPol'\]\.includes\(tipo\)[\s\S]*'operativaActual'[\s\S]*'reconstruccion'/u,
    'solo las fotografías vigentes deben usar la prioridad operativa');
  assert.ok(
    adaptadorAuditoria.indexOf(
      'await this.capturadorFederacionAuditoria.capturarEventoEnTransaccion'
    ) <
      adaptadorAuditoria.indexOf('marcarCompletada'),
    'la auditoría runtime debe capturarse antes de completar su outbox local'
  );
}

async function verificarEjecucionTriggerAtomica() {
  const pasos = [];
  const conexionTrigger = { nombre: 'trigger' };
  const servicio = new ServicioTriggers({
    repositorioTriggers: {},
    repositorioAsignacionesTriggerMonitor: {},
    repositorioEjecucionesTrigger: {
      actualizarResultado: async (_entrada, { conexion: recibida }) => {
        assert.equal(recibida, conexionTrigger);
        pasos.push('resultado');
        return { serializarResumen: () => ({ id: 7, estadoEjecucion: 'ok' }) };
      }
    },
    validadorTrigger: {},
    fronteraTransaccional: {
      ejecutar: (operacion) => operacion(conexionTrigger)
    },
    capturadorFederacionEjecuciones: {
      capturarEjecucionEnTransaccion: async (_entrada, { conexion: recibida }) => {
        assert.equal(recibida, conexionTrigger);
        pasos.push('captura');
      }
    }
  });
  const resultado = await servicio.finalizarEjecucionTrigger({
    idEjecucion: 7,
    estadoEjecucion: 'ok'
  });
  assert.deepEqual(pasos, ['resultado', 'captura']);
  assert.equal(resultado.estadoEjecucion, 'ok');
}

async function verificarAuditoriaRuntimeAtomica() {
  const pasos = [];
  const conexionAuditoria = {
    beginTransaction: async () => pasos.push('begin'),
    commit: async () => pasos.push('commit'),
    rollback: async () => pasos.push('rollback'),
    release: () => pasos.push('release')
  };
  const eventoId = '018f1000-0000-7000-8000-000000000009';
  const adaptador = new AdaptadorCoordinacionOutboxAuditoriaRuntime({
    repositorioOutbox: {
      clienteSql: { obtenerConexion: async () => conexionAuditoria },
      reclamarSiguienteConLease: async () => null,
      bloquearLeaseVigente: async () => ({ eventoId, intencion: { eventoId } }),
      marcarCompletada: async () => pasos.push('completada')
    },
    repositorioAuditoria: {
      incorporarEnTransaccion: async () => ({
        eventos: [{ eventoId, estado: 'incorporado', secuencia: '1' }]
      })
    },
    capturadorFederacionAuditoria: {
      capturarEventoEnTransaccion: async (_entrada, { conexion: recibida }) => {
        assert.equal(recibida, conexionAuditoria);
        pasos.push('captura');
      }
    }
  });
  await adaptador.consolidarConLease({
    operacionId: '1',
    instanciaId: 'runtime-1',
    leaseToken: Buffer.alloc(16, 1),
    fencingToken: '1'
  });
  assert.deepEqual(pasos, ['begin', 'captura', 'completada', 'commit', 'release']);
}

async function verificarFuenteCompartidaEntreVistas() {
  let consultasIdentidad = 0;
  const inclusiones = [];
  const conexionVistas = {
    execute: async () => {
      consultasIdentidad += 1;
      return [[]];
    }
  };
  const puertosVistas = crearPuertosCapturaTecnicaFederacion({
    capturador: {
      capturarEnTransaccion: async ({ prepararCapturas }) => {
        const interfazCaptura = {
          prepararCapturaEnTransaccion: async (entrada) => {
            inclusiones.push(entrada.solicitud.incluirFuente);
            return [];
          }
        };
        await prepararCapturas({ interfazCaptura });
        await prepararCapturas({ interfazCaptura });
        return { estado: 'capturada', ocurrencias: [], posiciones: [] };
      }
    }
  });
  await puertosVistas.telemetria.capturarIngestaEnTransaccion(
    { agenteId: '3' },
    { conexion: conexionVistas }
  );
  assert.equal(consultasIdentidad, 1);
  assert.deepEqual(inclusiones, [true, true],
    'todas las vistas del mismo hecho deben compartir la decisión de fuente');
}

async function verificarDespachoTrasFachadaComun() {
  const recibidas = [];
  const opciones = { conexion };
  const capturaRetiradaEstructura = Object.freeze({
    definicion: Object.freeze({ familia: 'estructuraOrganizativa' })
  });
  const definiciones = [
    crearDefinicionAdaptadorMonitoresFederacion({
      repositorioLocal: productorLocal({
        prepararCapturasRuntimeEnTransaccion: registrarEspecializada('monitores.runtime', recibidas),
        prepararCapturasAdministracionEnTransaccion: registrarEspecializada('monitores.administracion', recibidas),
        prepararRetiradaEnTransaccion: registrarEspecializada('monitores.retirada', recibidas)
      })
    }),
    crearDefinicionAdaptadorTelemetriaFederacion({
      repositorioLocal: productorLocal({
        prepararCapturasIngestaEnTransaccion: registrarEspecializada('telemetria.ingesta', recibidas)
      })
    }),
    crearDefinicionAdaptadorTriggersInformativosFederacion({
      repositorioLocal: productorLocal({
        prepararCapturasEjecucionesEnTransaccion: registrarEspecializada('triggers.ejecucion', recibidas),
        prepararCapturasAdministracionEnTransaccion: registrarEspecializada('triggers.administracion', recibidas),
        prepararRetiradaEnTransaccion: registrarEspecializada('triggers.retirada', recibidas)
      })
    }),
    crearDefinicionAdaptadorEstructuraOrganizativaFederacion({
      repositorio: { materializarEnTransaccion: async () => null },
      repositorioLocal: productorLocal({
        prepararCapturasMovimientoEnTransaccion: registrarEspecializada('estructura.movimiento', recibidas),
        prepararRetiradaEnTransaccion: async (solicitud, opcionesRetirada) => {
          recibidas.push({
            familia: 'estructura.retirada',
            solicitud,
            conexion: opcionesRetirada.conexion
          });
          return {
            entidadRaiz: solicitud.entidad,
            idRaiz: solicitud.id,
            orden: 'hojasAntesRaiz',
            retiradas: [capturaRetiradaEstructura]
          };
        }
      })
    })
  ];
  const fachadas = new Map(definiciones.map((definicion) => {
    const adaptador = crearAdaptadorFamiliaFederacion(definicion);
    assert.deepEqual(Object.keys(adaptador.interfaces.captura), [
      'prepararCapturaEnTransaccion'
    ]);
    return [adaptador.familia, adaptador.interfaces.captura];
  }));
  const puertosFachada = crearPuertosCapturaTecnicaFederacion({
    capturador: {
      capturarEnTransaccion: async ({ familia, prepararCapturas }) => {
        await prepararCapturas({
          selector: {
            permiteContenidoSensible: false,
            campos: []
          },
          interfazCaptura: fachadas.get(familia)
        });
        return { estado: 'capturada', ocurrencias: [], posiciones: [] };
      }
    }
  });
  await puertosFachada.monitores.capturarRuntimeEnTransaccion(
    { estadoMonitorIds: ['11'] }, opciones
  );
  await puertosFachada.telemetria.capturarIngestaEnTransaccion(
    { agenteId: '12', observacionIds: ['13'] }, opciones
  );
  await puertosFachada.triggers.capturarEjecucionEnTransaccion(
    { ejecucionId: '14' }, opciones
  );
  const despachar = (familia, operacion, solicitud) =>
    fachadas.get(familia).prepararCapturaEnTransaccion(
      crearSolicitudCapturaFederacion(operacion, solicitud),
      opciones
    );
  await despachar('monitores', OPERACIONES_CAPTURA_FEDERACION.MONITORES_ADMINISTRACION,
    { monitorIds: ['15'] });
  await despachar('monitores', OPERACIONES_CAPTURA_FEDERACION.MONITORES_RETIRADA,
    { monitorId: '15' });
  await despachar('triggersInformativos', OPERACIONES_CAPTURA_FEDERACION.TRIGGERS_ADMINISTRACION,
    { triggerIds: ['16'] });
  await despachar('triggersInformativos', OPERACIONES_CAPTURA_FEDERACION.TRIGGERS_RETIRADA,
    { triggerId: '16' });
  await despachar('estructuraOrganizativa', OPERACIONES_CAPTURA_FEDERACION.ESTRUCTURA_MOVIMIENTO,
    { entidad: 'sitio', id: '17' });
  const retiradasEstructura = await despachar(
    'estructuraOrganizativa', OPERACIONES_CAPTURA_FEDERACION.ESTRUCTURA_RETIRADA,
    { entidad: 'sitio', id: '17' });
  assert.deepEqual(retiradasEstructura, [capturaRetiradaEstructura]);
  assert.deepEqual(recibidas.map(({ familia }) => familia), [
    'monitores.runtime', 'telemetria.ingesta', 'triggers.ejecucion',
    'monitores.administracion', 'monitores.retirada',
    'triggers.administracion', 'triggers.retirada',
    'estructura.movimiento', 'estructura.retirada'
  ]);
  assert.deepEqual(recibidas[0].solicitud.estadoMonitorIds, ['11']);
  assert.deepEqual(recibidas[1].solicitud.observacionIds, ['13']);
  assert.deepEqual(recibidas[2].solicitud.ejecucionIds, ['14']);
}

function productorLocal(especializadas = {}) {
  return {
    prepararCapturaEnTransaccion: async () => ({ definicion: {} }),
    prepararCapturasAdministracionEnTransaccion: async () => [],
    prepararCapturasRuntimeEnTransaccion: async () => [],
    prepararCapturasIngestaEnTransaccion: async () => [],
    prepararCapturasEjecucionesEnTransaccion: async () => [],
    prepararCapturasMovimientoEnTransaccion: async () => [],
    listarCapturasEnTransaccion: async () => [],
    prepararRetiradaEnTransaccion: async () => [],
    ...especializadas
  };
}

function registrarEspecializada(familia, recibidas) {
  return async (solicitud, opciones) => {
    recibidas.push({ familia, solicitud, conexion: opciones.conexion });
    return [];
  };
}

function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}
