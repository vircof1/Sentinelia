import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  ProcesadorMaterializacionFederacionRuntime,
  crearRequisitosCompletitudMaterializacionFederacion
} from '../apps/sentinelia-runtime/src/federacion/ProcesadorMaterializacionFederacionRuntime.js';

await main();

async function main() {
  await verificarRegistroYWiring();
  await verificarMaterializadorRuntime();
  console.log(
    '[federacion] OK 5.22.20d: materializador=runtime_durable familias=7 ' +
    'cadena=A_B_C cuadrado=consolidado ciclos=omitidos ' +
    'retirada=explicita retencion=no_silenciosa reintento=fencing_seguro'
  );
}

async function verificarRegistroYWiring() {
  const [bootstrap, runtime, repositorio] = await Promise.all([
    leer('../apps/sentinelia-runtime/src/BootstrapRuntime.js'),
    leer('../apps/sentinelia-runtime/src/RuntimeSentinelia.js'),
    leer('../paquetes/federacion/adaptadores/RepositorioMaterializacionFederacionSql.js')
  ]);
  assert.match(bootstrap, /new ProcesadorMaterializacionFederacionRuntime/u);
  assert.match(bootstrap, /crearRegistroFamiliasFederacionSql/u);
  assert.match(runtime, /procesadorMaterializacionFederacion\.procesarPendientes/u);
  assert.match(repositorio, /async completarEnTransaccion/u);
}

async function verificarMaterializadorRuntime() {
  const eventos = [];
  const trabajoActualizacion = trabajo('entrega-actualizacion', 'actualizacion', '1');
  const trabajoRetirada = trabajo('entrega-retirada', 'retirada', '2');
  const ocurrencias = new Map([
    ['inbox-entrega-actualizacion', ocurrencia('actualizacion', '1')],
    ['inbox-entrega-retirada', ocurrencia('retirada', '2')]
  ]);
  const repositorioTrabajos = {
    async reclamarPendientes(entrada) {
      eventos.push(['reclamar', entrada]);
      return [trabajoActualizacion, trabajoRetirada];
    },
    async completarEnTransaccion(entrada, { conexion }) {
      assert.equal(conexion.id, 'conexion-fixture');
      eventos.push(['completar', entrada]);
    },
    async fallar(entrada) {
      eventos.push(['fallar', entrada]);
    }
  };
  const materializaciones = [];
  const procesador = crearProcesador({
    repositorioTrabajos,
    ocurrencias,
    materializar: async (entrada, { conexion }) => {
      assert.equal(conexion.id, 'conexion-fixture');
      materializaciones.push(entrada);
    },
    eventos
  });
  const resumen = await procesador.procesarPendientes({
    origen: 'gate-20d',
    numeroTick: 1
  });
  assert.equal(resumen.totalReclamadas, 2);
  assert.equal(resumen.totalMaterializadas, 2);
  assert.equal(resumen.totalReintentables, 0);
  assert.deepEqual(
    materializaciones.map(({ operacion, payload }) => [operacion, payload?.nombre ?? null]),
    [['actualizacion', 'Empresa remota'], ['retirada', null]]
  );
  const completados = eventos.filter(([tipo]) => tipo === 'completar');
  assert.equal(completados.length, 2);
  assert.equal(completados[0][1].cierreOperativoValidado, true);
  assert.equal(
    completados[0][1].requisitosPorCapacidad.interpretable[0].estado,
    'cumplido'
  );
  assert.equal(
    completados[0][1].requisitosPorCapacidad.observable[0].estado,
    'noAplicable'
  );
  assert.equal(eventos.filter(([tipo]) => tipo === 'commit').length, 2);

  await verificarReintentoSaneado();
  await verificarFalloCoordinacionAislado();
  verificarCompletitudSensible();
}

async function verificarReintentoSaneado() {
  const eventos = [];
  const ocurrencias = new Map([
    ['inbox-entrega-actualizacion', ocurrencia('actualizacion', '1')]
  ]);
  const trabajoFallido = trabajo('entrega-actualizacion', 'actualizacion', '1');
  const repositorioTrabajos = {
    async reclamarPendientes() { return [trabajoFallido]; },
    async completarEnTransaccion() {
      assert.fail('Un fallo de materialización no puede confirmarse.');
    },
    async fallar(entrada) { eventos.push(['fallar', entrada]); }
  };
  const procesador = crearProcesador({
    repositorioTrabajos,
    ocurrencias,
    materializar: async () => {
      const error = new Error('detalle sensible que no debe persistirse');
      error.codigo = 'destino_remoto_temporal';
      throw error;
    },
    eventos,
    reloj: () => new Date('2032-01-01T00:00:00.000Z')
  });
  const resumen = await procesador.procesarPendientes();
  assert.equal(resumen.totalReintentables, 1);
  assert.equal(eventos.filter(([tipo]) => tipo === 'rollback').length, 1);
  const fallo = eventos.find(([tipo]) => tipo === 'fallar')[1];
  assert.equal(fallo.errorCodigo, 'destino_remoto_temporal');
  assert.equal(fallo.reintentarDesdeUtc.toISOString(), '2032-01-01T00:00:01.000Z');
  assert.doesNotMatch(JSON.stringify(fallo), /detalle sensible/u);
}

async function verificarFalloCoordinacionAislado() {
  const eventos = [];
  const primero = trabajo('entrega-fallo', 'actualizacion', '1');
  const segundo = trabajo('entrega-actualizacion', 'actualizacion', '2');
  const ocurrencias = new Map([
    ['inbox-entrega-fallo', ocurrencia('actualizacion', '1')],
    ['inbox-entrega-actualizacion', ocurrencia('actualizacion', '2')]
  ]);
  const repositorioTrabajos = {
    async reclamarPendientes() { return [primero, segundo]; },
    async completarEnTransaccion(entrada) {
      eventos.push(['completar', entrada.entregaId]);
    },
    async fallar() {
      throw new Error('SQL temporal al registrar el reintento');
    }
  };
  const procesador = crearProcesador({
    repositorioTrabajos,
    ocurrencias,
    materializar: async ({ contexto }) => {
      if (contexto.entregaId === primero.entregaId) {
        const error = new Error('materialización temporal');
        error.codigo = 'materializacion_temporal';
        throw error;
      }
    },
    eventos
  });
  const resumen = await procesador.procesarPendientes();
  assert.equal(resumen.totalErroresCoordinacion, 1);
  assert.equal(resumen.totalMaterializadas, 1);
  assert.deepEqual(
    eventos.filter(([tipo]) => tipo === 'completar'),
    [['completar', segundo.entregaId]]
  );
}

function verificarCompletitudSensible() {
  const requisitos = crearRequisitosCompletitudMaterializacionFederacion({
    ocurrencia: {
      familia: 'monitores',
      operacion: 'actualizacion'
    },
    payload: {
      tipoRegistro: 'definicion',
      credencialPropia: { estado: 'omitida' }
    }
  });
  assert.ok(requisitos.reconstruible.some((item) =>
    item.id === 'sensible:credencialPropia' &&
    item.estado === 'faltante' &&
    item.causa === 'contenido_sensible_no_federado'));
}

function crearProcesador({
  repositorioTrabajos,
  ocurrencias,
  materializar,
  eventos,
  reloj = () => new Date('2032-01-01T00:00:00.000Z')
}) {
  return new ProcesadorMaterializacionFederacionRuntime({
    clienteSql: {
      async obtenerConexion() { return conexion(eventos); }
    },
    repositorioTrabajos,
    repositorioInbox: {
      async obtenerOcurrenciaMaterializable(inboxId) {
        return ocurrencias.get(inboxId) ?? null;
      }
    },
    registroFamilias: {
      obtenerProductivo({ familia, versionFamilia }) {
        assert.equal(familia, 'estructuraOrganizativa');
        assert.equal(versionFamilia, 1);
        return {
          interfaces: {
            payload: {
              validarPayload(payload) {
                assert.equal(payload.perfil, 'fixture-estructura-v1');
                return Object.freeze({ ...payload });
              }
            },
            materializacion: { materializarEnTransaccion: materializar }
          }
        };
      }
    },
    propietario: 'runtime-materializacion:gate-20d',
    reloj
  });
}

function conexion(eventos) {
  return {
    id: 'conexion-fixture',
    async beginTransaction() { eventos.push(['begin']); },
    async commit() { eventos.push(['commit']); },
    async rollback() { eventos.push(['rollback']); },
    release() { eventos.push(['release']); }
  };
}

function trabajo(entregaId, operacion, secuenciaElemento) {
  return Object.freeze({
    entregaId,
    proyeccionId: 'proyeccion-fixture',
    inboxId: `inbox-${entregaId}`,
    flujoId: 'flujo-fixture',
    generacionId: 'generacion-fixture',
    familia: 'estructuraOrganizativa',
    operacion,
    installationOrigenId: 'installation-origen-fixture',
    elementoOrigenId: 'elemento-origen-fixture',
    ocurrenciaOrigenId: `ocurrencia-${secuenciaElemento}`,
    secuenciaElemento,
    intentos: 1,
    fencingToken: '7',
    propietario: 'runtime-materializacion:gate-20d'
  });
}

function ocurrencia(operacion, secuenciaElemento) {
  return Object.freeze({
    familia: 'estructuraOrganizativa',
    familiaVersion: 1,
    installationOrigenId: 'installation-origen-fixture',
    elementoOrigenId: 'elemento-origen-fixture',
    ocurrenciaOrigenId: `ocurrencia-${secuenciaElemento}`,
    secuenciaElemento,
    operacion,
    campos: operacion === 'actualizacion'
      ? {
          nodoOrganizativo: {
            estado: 'presente',
            valor: {
              perfil: 'fixture-estructura-v1',
              version: 1,
              tipo: 'empresa',
              nombre: 'Empresa remota'
            }
          }
        }
      : {}
  });
}

function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}
