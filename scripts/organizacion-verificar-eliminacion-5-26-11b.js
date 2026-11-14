import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { crearMotorEliminacionAdministrativaAgentesRuntime }
  from '../apps/sentinelia-runtime/src/agentes/crearMotorEliminacionAdministrativaAgentesRuntime.js';
import {
  CAPACIDADES_RUNTIME_ELIMINACION_ADMINISTRATIVA_ORGANIZACIONES,
  crearDeclaracionCapacidadesRuntimeEliminacionOrganizaciones
} from '../paquetes/jerarquia-organizativa/src/CapacidadesRuntimeEliminacionAdministrativaOrganizaciones.js';

verificarDeclaracionCompatible();
verificarComposicionProductiva();
await verificarEnsambladoYGate();

console.log(
  '[organizacion] OK 5.26.11b: runtime=agente_y_organizacion ' +
  'preparador=compartido capacidades=publicadas contrato=actual'
);

function verificarDeclaracionCompatible() {
  const declaracion =
    crearDeclaracionCapacidadesRuntimeEliminacionOrganizaciones({
      instanciaId: 'runtime-52611b'
    });
  assert.deepEqual(declaracion, {
    familia: 'eliminacion_administrativa_organizaciones',
    estadoPublicacion: 'publica',
    versionContrato: 1,
    instanciaId: 'runtime-52611b',
    capacidades: [
      'reservas_jerarquicas_v1',
      'ejecutor_eliminar_organizacion_v1',
      'preparador_dependencias_agente_compartido_v1',
      'postcommit_organizacion_v1'
    ],
    capacidadesWebEmpaquetadas: [
      'http_organizacion_desacoplada_v1',
      'consulta_operaciones_transversal_v1',
      'websocket_buzon_usuario_v1',
      'sin_camino_sincrono_organizacion_v1'
    ]
  });
  assert.equal(Object.isFrozen(declaracion), true);
  assert.equal(Object.isFrozen(
    CAPACIDADES_RUNTIME_ELIMINACION_ADMINISTRATIVA_ORGANIZACIONES
  ), true);
  assert.equal(Object.hasOwn(declaracion, 'perfil'), false);
  assert.throws(
    () => crearDeclaracionCapacidadesRuntimeEliminacionOrganizaciones(),
    /instanciaId/u
  );
}

function verificarComposicionProductiva() {
  const motor = crearMotorEliminacionAdministrativaAgentesRuntime({
    clienteSql: {
      async obtenerConexion() {},
      async consultar() { return []; }
    },
    clienteRedis: {
      async publish() { return 1; },
      duplicate() { return this; },
      async eval() {},
      async get() {},
      async hGetAll() {},
      async del() {},
      async incr() { return 1; },
      async *scanIterator() {},
      multi() { return {}; }
    },
    instanciaId: 'runtime-52611b',
    servicioAuditoria: { async registrarEnTransaccion() {} },
    capturadorFederacion: {
      async capturarPreparadasEnTransaccion() {},
      async capturarEnTransaccion() {}
    },
    repositoriosFederacion: {
      contextoOperativoAgentesSesiones: {
        local: { async prepararRetiradaPublicadaEnTransaccion() {} }
      },
      telemetria: {
        local: { async prepararRetiradaAgenteEnTransaccion() {} }
      },
      monitores: {
        local: { async prepararRetiradaPublicadaEnTransaccion() {} }
      }
    },
    repositorioControlFederacion: {
      async cortarDependenciasEnTransaccion() {}
    },
    repositorioSesionesWeb: {
      async invalidarVigentesPorUsuariosEnTransaccion() {}
    },
    versionadorCatalogoMonitoresRedis: {
      async incrementarVersion() {}
    }
  });
  assert.deepEqual(motor.catalogoEjecutores.listarContratos(), [
    'eliminar_agente@1',
    'eliminar_organizacion@1'
  ]);
  assert.deepEqual(motor.catalogoEjecutores.listarEjecutores(), [
    'eliminar_agente@1',
    'eliminar_organizacion@1'
  ]);
  assert.equal(typeof motor.despachador.arrancar, 'function');
}

async function verificarEnsambladoYGate() {
  const [fabrica, bootstrap, runtime, configuracion, web] = await Promise.all([
    leer('../apps/sentinelia-runtime/src/agentes/' +
      'crearMotorEliminacionAdministrativaAgentesRuntime.js'),
    leer('../apps/sentinelia-runtime/src/BootstrapRuntime.js'),
    leer('../apps/sentinelia-runtime/src/RuntimeSentinelia.js'),
    leer('../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js'),
    leer('../apps/sentinelia-web/src/index.js')
  ]);
  assert.equal(
    fabrica.match(/new NucleoPreparacionDependenciasAgenteEnTransaccion\(/gu)
      ?.length,
    1
  );
  assert.match(fabrica,
    /repositorioObligacionesPostcommit:\s*repositorioObligaciones,[\s\S]{0,80}nucleoPreparacionDependencias/u);
  assert.match(fabrica,
    /nucleoPreparacionDependenciasAgente:\s*nucleoPreparacionDependencias/u);
  assert.equal(
    fabrica.match(/new RepositorioObligacionesPostcommitOrganizacionSql\(/gu)
      ?.length,
    1,
    'Preparador y finalizador deben compartir un único repositorio organizativo.'
  );
  assert.match(fabrica,
    /new PreparadorEfectosEliminacionOrganizacionEnTransaccion\([\s\S]{0,1000}repositorioObligacionesOrganizacion/u);
  assert.match(fabrica,
    /new FinalizadorResultadoEliminacionOrganizacionEnTransaccion\([\s\S]{0,300}repositorioObligaciones:\s*repositorioObligacionesOrganizacion/u);
  assert.match(bootstrap, /new RepositorioControlFederacionSql\(/u);
  assert.match(bootstrap, /new RepositorioSesionesWebAuditoria\(this\.clienteSql\)/u);
  assert.match(runtime,
    /publicarCapacidadDespliegue\([\s\S]{0,100}'eliminacionAdministrativaOrganizaciones'/u);
  assert.doesNotMatch(configuracion,
    /ORGANIZACION_ELIMINACION_ADMINISTRATIVA_(?:HTTP_HABILITADA|PERFIL_COMPATIBILIDAD)/u);
  assert.match(web, /resolverActivacionEliminacionAdministrativaOrganizaciones/u);
}

function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}
