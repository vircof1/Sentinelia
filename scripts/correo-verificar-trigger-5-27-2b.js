import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { MotorTriggersRuntime }
  from '../apps/sentinelia-runtime/src/triggers/MotorTriggersRuntime.js';
import { ESTRATEGIA_EJECUCION_TRIGGER_CORREO }
  from '../paquetes/correo/src/ContratoTriggerCorreo.js';
import {
  ESTRATEGIAS_EJECUCION_TRIGGER,
  listarTiposTriggerPorEstrategia,
  obtenerEstrategiaEjecucionTrigger
} from '../paquetes/triggers/src/CatalogoTiposTrigger.js';
import { RepositorioEjecucionesTrigger }
  from '../paquetes/triggers/src/RepositorioEjecucionesTrigger.js';
import { ResolutorEjecutorTrigger }
  from '../paquetes/triggers/src/ResolutorEjecutorTrigger.js';
import { ServicioTriggers } from '../paquetes/triggers/src/ServicioTriggers.js';

const DIFERIDA = ESTRATEGIAS_EJECUCION_TRIGGER.EFECTO_EXTERNO_DIFERIDO;
const ATOMICA = ESTRATEGIAS_EJECUCION_TRIGGER.ACEPTACION_SQL_ATOMICA;

async function main() {
  verificarCatalogoEstrategias();
  verificarResolutorTipado();
  verificarPlanCorreoSinProductor();
  await verificarBifurcacionCausal();
  await verificarCierreDelRecorridoDiferido();
  await verificarFiltroSqlYDiagnostico();
  await verificarIntegracionDeArranque();
  console.log(
    '[correo-trigger] OK 5.27.2b: estrategias=cerradas ' +
      'diferido=api,dns atomico=correo productor_correo=registrado_en_5.27.8c ' +
      'corrupcion_no_terminal=fail_closed'
  );
}

function verificarPlanCorreoSinProductor() {
  const servicio = new ServicioTriggers({
    repositorioTriggers: {},
    repositorioAsignacionesTriggerMonitor: {},
    validadorTrigger: {
      construirConfiguracionEfectiva({ configuracionBase }) {
        return configuracionBase;
      }
    },
    resolutorEjecutorTrigger: new ResolutorEjecutorTrigger({
      ejecutores: [
        { tipoTrigger: 'api', async ejecutar() {} },
        { tipoTrigger: 'dns', async ejecutar() {} }
      ]
    })
  });
  const planCorreo = servicio.construirPlanDisparo({
    trigger: {
      id: 31,
      tipo: 'correo',
      nombre: 'Aviso',
      configuracion: { serializar: () => ({ version: 1 }) },
      serializarResumen: () => ({ id: 31, tipo: 'correo' })
    },
    asignacion: {
      id: 41,
      monitorId: 51,
      ordenEjecucion: 10,
      configuracionOverride: null,
      serializarResumen: () => ({ id: 41 })
    },
    transicion: { monitorId: 51 },
    eventoDisparo: 'apertura_alerta'
  });
  assert.equal(planCorreo.estrategiaEjecucion, ATOMICA);
  assert.equal(Object.hasOwn(planCorreo, 'ejecutorTipo'), false);
}

function verificarCatalogoEstrategias() {
  assert.deepEqual(Object.values(ESTRATEGIAS_EJECUCION_TRIGGER), [
    'efecto_externo_diferido',
    'aceptacion_sql_atomica'
  ]);
  assert.equal(Object.isFrozen(ESTRATEGIAS_EJECUCION_TRIGGER), true);
  assert.deepEqual(listarTiposTriggerPorEstrategia(DIFERIDA), ['api', 'dns']);
  assert.deepEqual(listarTiposTriggerPorEstrategia(ATOMICA), ['correo']);
  assert.equal(obtenerEstrategiaEjecucionTrigger('api'), DIFERIDA);
  assert.equal(obtenerEstrategiaEjecucionTrigger('dns'), DIFERIDA);
  assert.equal(obtenerEstrategiaEjecucionTrigger('correo'), ATOMICA);
  assert.equal(ESTRATEGIA_EJECUCION_TRIGGER_CORREO, ATOMICA);
  assert.throws(
    () => listarTiposTriggerPorEstrategia('inventada'),
    /estrategia de ejecución/u
  );
}

function verificarResolutorTipado() {
  const api = {
    tipoTrigger: 'api',
    estrategiaEjecucion: DIFERIDA,
    async ejecutar() {}
  };
  const dns = { tipoTrigger: 'dns', async ejecutar() {} };
  const resolutor = new ResolutorEjecutorTrigger({ ejecutores: [api, dns] });
  const descriptor = resolutor.resolverPorTipo('api');
  assert.equal(Object.isFrozen(descriptor), true);
  assert.equal(descriptor.estrategiaEjecucion, DIFERIDA);
  assert.equal(descriptor.manejador, api);
  assert.equal(resolutor.resolverManejadorDiferidoPorTipo('dns'), dns);
  assert.equal(resolutor.resolverEstrategiaPorTipo('correo'), ATOMICA);
  assert.deepEqual(resolutor.listarTiposRegistrados(), ['api', 'dns']);
  assert.throws(
    () => resolutor.resolverPorTipo('correo'),
    (error) => error?.codigo === 'manejador_trigger_no_registrado'
  );
  assert.throws(() => new ResolutorEjecutorTrigger({
    ejecutores: [{
      tipoTrigger: 'correo',
      estrategiaEjecucion: DIFERIDA,
      async ejecutar() {}
    }]
  }), /estrategia incompatible/u);
  assert.throws(() => new ResolutorEjecutorTrigger({
    ejecutores: [{
      tipoTrigger: 'correo',
      estrategiaEjecucion: ATOMICA,
      async ejecutar() {}
    }]
  }), /aceptarEnTransaccion/u);
}

async function verificarBifurcacionCausal() {
  const llamadas = [];
  const conexion = { id: 'conexion-causal' };
  const planes = [plan('api', 1), plan('correo', 2), plan('dns', 3)];
  const servicio = {
    async resolverDisparosDesdeTransiciones() {
      return { totalDisparos: planes.length, disparos: planes };
    },
    async registrarEjecucionPendiente({ planDisparo, conexion: recibida }) {
      llamadas.push(`diferida:${planDisparo.tipoTrigger}`);
      assert.equal(recibida, conexion);
      return { id: planDisparo.triggerId * 10, creada: true };
    },
    async aceptarPlanAtomicoEnTransaccion({ planDisparo, conexion: recibida }) {
      llamadas.push(`atomica:${planDisparo.tipoTrigger}`);
      assert.equal(recibida, conexion);
      return { id: planDisparo.triggerId * 10, aceptada: true };
    }
  };
  const resumen = await new MotorTriggersRuntime({ servicioTriggers: servicio })
    .planificarDesdePersistenciaAlertas({
      persistenciaAlertas: { aperturasAlerta: [{ monitorId: 9 }] },
      conexion
    });
  assert.deepEqual(llamadas, ['diferida:api', 'atomica:correo', 'diferida:dns']);
  assert.equal(resumen.totalPlanes, 3);
  assert.equal(resumen.totalDiferidosNuevos, 2);
  assert.equal(resumen.totalAceptacionesAtomicas, 1);
  assert.equal(resumen.totalNuevos, 3);
  assert.deepEqual(resumen.ejecucionIds, [10, 20, 30]);
}

async function verificarCierreDelRecorridoDiferido() {
  let reclamaciones = 0;
  let finalizaciones = 0;
  const motor = new MotorTriggersRuntime({
    servicioTriggers: {
      async listarEjecucionesPendientes() {
        return [{
          id: 71,
          tipoTrigger: 'correo',
          estadoEjecucion: 'pendiente',
          payloadSolicitud: {}
        }];
      },
      async marcarEjecucionEjecutando() {
        reclamaciones += 1;
      },
      async finalizarEjecucionTrigger() {
        finalizaciones += 1;
      }
    }
  });
  await assert.rejects(
    motor.ejecutarPendientes(),
    (error) => error?.codigo === 'ejecucion_trigger_atomica_en_motor_diferido'
  );
  assert.equal(reclamaciones, 0);
  assert.equal(finalizaciones, 0);

  const repositorio = {
    escrituras: 0,
    async crear() {
      this.escrituras += 1;
      return null;
    }
  };
  const servicio = crearServicio({ repositorioEjecucionesTrigger: repositorio });
  await assert.rejects(
    servicio.registrarEjecucionPendiente({ planDisparo: plan('correo', 8) }),
    (error) => error?.codigo === 'estrategia_trigger_incompatible'
  );
  assert.equal(repositorio.escrituras, 0);
  await assert.rejects(
    servicio.aceptarPlanAtomicoEnTransaccion({ planDisparo: plan('correo', 8) }),
    (error) => error?.codigo === 'conexion_sql_trigger_atomico_ausente'
  );
  await assert.rejects(
    servicio.aceptarPlanAtomicoEnTransaccion({
      planDisparo: plan('correo', 8),
      conexion: { id: 'prestada' }
    }),
    (error) => error?.codigo === 'manejador_trigger_no_registrado'
  );
}

async function verificarFiltroSqlYDiagnostico() {
  const consultas = [];
  const repositorioSql = new RepositorioEjecucionesTrigger({
    async consultar(sql, parametros) {
      consultas.push({ sql, parametros });
      return [];
    }
  });
  await repositorioSql.listarPendientes({
    tiposTrigger: ['api', 'dns'],
    limit: 25
  });
  assert.match(consultas[0].sql, /tipo_trigger IN \(\?,\?\)/u);
  assert.deepEqual(consultas[0].parametros, ['api', 'dns', 25]);
  await repositorioSql.listarNoTerminalesPorTipos({
    tiposTrigger: ['correo'],
    limit: 10
  });
  assert.match(
    consultas[1].sql,
    /estado_ejecucion IN \('pendiente', 'ejecutando'\)/u
  );
  assert.deepEqual(consultas[1].parametros, ['correo', 10]);

  const incompatibles = [
    { id: 81, tipoTrigger: 'correo', estadoEjecucion: 'pendiente' },
    { id: 82, tipoTrigger: 'correo', estadoEjecucion: 'ejecutando' }
  ];
  const servicioRoto = crearServicio({
    repositorioEjecucionesTrigger: {
      async listarNoTerminalesPorTipos({ tiposTrigger }) {
        assert.deepEqual(tiposTrigger, ['correo']);
        return incompatibles;
      }
    }
  });
  const diagnostico = await servicioRoto.diagnosticarIntegridadEstrategiasEjecucion();
  assert.equal(diagnostico.ok, false);
  assert.equal(diagnostico.totalIncompatibles, 2);
  await assert.rejects(
    servicioRoto.exigirIntegridadEstrategiasEjecucion(),
    (error) => error?.codigo === 'ejecucion_trigger_atomica_no_terminal' &&
      error?.diagnostico?.ejecuciones?.length === 2
  );
  const servicioLimpio = crearServicio({
    repositorioEjecucionesTrigger: {
      async listarNoTerminalesPorTipos() { return []; }
    }
  });
  assert.equal((await servicioLimpio.exigirIntegridadEstrategiasEjecucion()).ok, true);
}

async function verificarIntegracionDeArranque() {
  const [bootstrap, motor, servicio] = await Promise.all([
    leer('../apps/sentinelia-runtime/src/BootstrapRuntime.js'),
    leer('../apps/sentinelia-runtime/src/triggers/MotorTriggersRuntime.js'),
    leer('../paquetes/triggers/src/ServicioTriggers.js')
  ]);
  assert.match(bootstrap, /exigirIntegridadEstrategiasEjecucion/u);
  assert.match(bootstrap, /ServicioAceptacionTriggerCorreo/u);
  assert.match(motor, /aceptarPlanAtomicoEnTransaccion/u);
  assert.match(motor, /ejecucion_trigger_atomica_en_motor_diferido/u);
  assert.match(servicio, /listarNoTerminalesPorTipos/u);
}

function crearServicio({ repositorioEjecucionesTrigger }) {
  return new ServicioTriggers({
    repositorioTriggers: {},
    repositorioAsignacionesTriggerMonitor: {},
    repositorioEjecucionesTrigger,
    validadorTrigger: {},
    resolutorEjecutorTrigger: new ResolutorEjecutorTrigger({
      ejecutores: [
        { tipoTrigger: 'api', async ejecutar() {} },
        { tipoTrigger: 'dns', async ejecutar() {} }
      ]
    })
  });
}

function plan(tipoTrigger, id) {
  return {
    eventoDisparo: 'apertura_alerta',
    monitorId: 100 + id,
    triggerId: id,
    asignacionId: 200 + id,
    tipoTrigger,
    estrategiaEjecucion: obtenerEstrategiaEjecucionTrigger(tipoTrigger),
    nombreTrigger: `trigger-${tipoTrigger}`,
    ordenEjecucion: id,
    configuracionEfectiva: {},
    transicion: { alertaAuditoriaId: `alerta-${id}` }
  };
}

function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}

await main();
