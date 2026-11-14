import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import {
  CoordinadorEmisionFederacionRuntime
} from '../apps/sentinelia-runtime/src/federacion/CoordinadorEmisionFederacionRuntime.js';
import {
  ProcesadorFlujoEmisionFederacionRuntime
} from '../apps/sentinelia-runtime/src/federacion/ProcesadorFlujoEmisionFederacionRuntime.js';
import {
  crearMiddlewareInterpretarLoteDatosFederacion
} from '../apps/sentinelia-web/src/middleware/interpretarLoteDatosFederacion.js';
import {
  FuenteEntropiaCriptograficaNode
} from '../paquetes/federacion/adaptadores/FuenteEntropiaCriptograficaNode.js';
import {
  LIMITES_DUROS_RECURSOS_FEDERACION,
  medirRecursosCanonicosFederacion,
  validarRecursosLoteFederacion
} from '../paquetes/federacion/src/ConfiguracionFederacion.js';
import {
  GeneradorIdentidadesFederadas,
  TIPOS_IDENTIDAD_FEDERADA
} from '../paquetes/federacion/src/IdentidadFederada.js';
import {
  crearContratoFragmentacionTipadaFederacion,
  fragmentarOcurrenciaTipadaFederacion,
  planificarLotesFederacion,
  reagruparFragmentosTipadosFederacion
} from '../paquetes/federacion/src/PlanificacionLotesFederacion.js';

const generador = new GeneradorIdentidadesFederadas({
  fuenteEntropia: new FuenteEntropiaCriptograficaNode()
});

await main();

async function main() {
  await verificarAdmisionPreviaYMedicion();
  verificarFragmentacionAcotadaAntesDeAsignar();
  await verificarConcurrenciaSinSolape();
  await verificarFrecuenciaReintentoAcotada();
  console.log(
    '[federacion] OK 5.22.19c: payload=medido lote=pre_sql ' +
    'fragmentos=preacotados concurrencia=limitada frecuencia=backoff ' +
    'almacenamiento=estimacion_canonica_sin_agotamiento ' +
    'procedencia=contabilizada'
  );
}

async function verificarAdmisionPreviaYMedicion() {
  const valor = { texto: 'á🙂', activo: true };
  assert.equal(
    medirRecursosCanonicosFederacion(valor).bytesCanonicos,
    new TextEncoder().encode(JSON.stringify({ activo: true, texto: 'á🙂' })).byteLength
  );

  assert.throws(
    () => validarRecursosLoteFederacion({
      ocurrencias: [{ dato: 1 }, { dato: 2 }],
      configuracion: {
        loteMaximoOcurrencias: 1,
        loteMaximoBytes: 1024,
        ocurrenciaMaximaBytes: 512
      }
    }),
    (error) => error.codigo === 'lote_excede_limites'
  );
  assert.throws(
    () => validarRecursosLoteFederacion({
      ocurrencias: [{ dato: 'á'.repeat(300) }],
      configuracion: {
        loteMaximoOcurrencias: 1,
        loteMaximoBytes: 1024,
        ocurrenciaMaximaBytes: 512
      }
    }),
    (error) => error.codigo === 'ocurrencia_excede_limite'
  );

  const capacidad = Object.freeze({
    aplicada: Object.freeze({ maximoBytesPorLote: 1024 })
  });
  let resoluciones = 0;
  const middleware = crearMiddlewareInterpretarLoteDatosFederacion({
    resolutorCapacidad: {
      async resolver() {
        resoluciones += 1;
        return capacidad;
      }
    }
  });
  const limiteFisico = LIMITES_DUROS_RECURSOS_FEDERACION.loteMaximoBytes +
    LIMITES_DUROS_RECURSOS_FEDERACION.loteMaximoOcurrencias * 512 +
    64 * 1024;
  const error = await ejecutarMiddleware(middleware, {
    configuracionPortalActual: {},
    get(nombre) {
      return nombre === 'content-length' ? String(limiteFisico + 1) : undefined;
    }
  });
  assert.equal(error.codigo, 'lote_excede_limites');
  assert.equal(error.statusCode, 413);
  assert.equal(resoluciones, 1);

  const ids = crearIds();
  const plan = planificarLotesFederacion({
    relacionId: ids.relacionId,
    flujoId: ids.flujoId,
    generacionId: ids.generacionId,
    candidatos: [{
      entregaId: ids.entregaId,
      posicionFlujo: '1',
      prioridad: 'operativaActual',
      ocurrencia: { dato: '🙂'.repeat(20) }
    }],
    capacidad: {
      maximoOcurrenciasPorLote: 1,
      maximoBytesPorLote: 64,
      maximoBytesPorOcurrencia: 64
    },
    generarLoteId: () => generar(TIPOS_IDENTIDAD_FEDERADA.LOTE)
  });
  assert.equal(plan.lotes.length, 0);
  assert.equal(plan.excedidas.length, 1);

  const planConProcedencia = planificarLotesFederacion({
    relacionId: ids.relacionId,
    flujoId: ids.flujoId,
    generacionId: ids.generacionId,
    candidatos: [{
      entregaId: ids.entregaId,
      posicionFlujo: '1',
      prioridad: 'operativaActual',
      ocurrencia: { dato: true },
      procedencia: { recorrido: ['p'.repeat(80)] }
    }],
    capacidad: {
      maximoOcurrenciasPorLote: 1,
      maximoBytesPorLote: 1024,
      maximoBytesPorOcurrencia: 64
    },
    generarLoteId: () => generar(TIPOS_IDENTIDAD_FEDERADA.LOTE)
  });
  assert.equal(planConProcedencia.lotes.length, 0);
  assert.equal(planConProcedencia.excedidas.length, 1);
}

function verificarFragmentacionAcotadaAntesDeAsignar() {
  const ids = crearIds();
  const contrato = crearContratoFragmentacionTipadaFederacion({
    familia: 'monitores',
    versionFamilia: 1,
    tipo: 'monitor-completo-v1',
    maximoFragmentos: 8,
    maximoBytesReagrupados: 4096
  });
  const ocurrencia = {
    familia: 'monitores',
    familiaVersion: 1,
    installationOrigenId: ids.installationId,
    elementoOrigenId: ids.elementoId,
    ocurrenciaOrigenId: ids.ocurrenciaId,
    secuenciaElemento: '1',
    contenido: 'á'.repeat(500)
  };
  const fragmentacion = fragmentarOcurrenciaTipadaFederacion({
    ocurrencia,
    entregaId: ids.entregaId,
    contrato,
    maximoBytesFragmento: 256,
    calcularHuella: sha256
  });
  assert.deepEqual(
    reagruparFragmentosTipadosFederacion({
      fragmentos: [...fragmentacion.fragmentos].reverse(),
      contrato,
      calcularHuella: sha256
    }),
    ocurrencia
  );

  const contratoDos = crearContratoFragmentacionTipadaFederacion({
    familia: 'monitores',
    versionFamilia: 1,
    tipo: 'monitor-limitado-v1',
    maximoFragmentos: 2,
    maximoBytesReagrupados: 1024
  });
  const noTocar = Array.from({ length: 3 }, () => Object.defineProperty({}, 'contenido', {
    get() { throw new Error('No debe inspeccionar fragmentos fuera de cota.'); }
  }));
  assert.throws(
    () => reagruparFragmentosTipadosFederacion({
      fragmentos: noTocar,
      contrato: contratoDos,
      calcularHuella: () => { throw new Error('No debe calcular huellas.'); }
    }),
    (error) => error.codigo === 'fragmentos_incompletos'
  );

  let huellas = 0;
  assert.throws(
    () => fragmentarOcurrenciaTipadaFederacion({
      ocurrencia: { ...ocurrencia, contenido: 'x'.repeat(2000) },
      entregaId: ids.entregaId,
      contrato: contratoDos,
      maximoBytesFragmento: 256,
      calcularHuella: () => { huellas += 1; return '0'.repeat(64); }
    }),
    (error) => error.codigo === 'fragmentacion_excede_limite'
  );
  assert.equal(huellas, 0, 'El exceso total debe fallar antes de crear fragmentos o huellas.');

  assert.throws(
    () => reagruparFragmentosTipadosFederacion({
      fragmentos: [
        { contenido: 'x'.repeat(600) },
        { contenido: 'y'.repeat(600) }
      ],
      contrato: contratoDos,
      calcularHuella: () => { huellas += 1; return '0'.repeat(64); }
    }),
    (error) => error.codigo === 'fragmentacion_excede_limite'
  );
  assert.equal(huellas, 0, 'El exceso reagrupado debe fallar antes de ordenar o hashear.');
}

async function verificarConcurrenciaSinSolape() {
  const pendientes = [];
  let reclamaciones = 0;
  const repositorio = {
    async reclamarSiguiente() {
      reclamaciones += 1;
      if (reclamaciones > 3) return null;
      const indice = reclamaciones;
      return {
        lease: {
          propietarioId: String(indice),
          instanciaId: 'runtime-19c',
          leaseToken: 'ab'.repeat(32),
          fencingToken: String(indice)
        },
        flujo: { flujoId: `flujo-${indice}` }
      };
    },
    async renovarLease() { return true; },
    async comprobarLeaseVigente() { return true; },
    async liberarLease() { return true; }
  };
  const coordinador = new CoordinadorEmisionFederacionRuntime({
    repositorioCoordinacion: repositorio,
    instanciaId: 'runtime-19c',
    concurrencia: 2,
    procesarFlujo: () => new Promise((resolve) => pendientes.push(resolve))
  });
  const primera = coordinador.procesarPendientes({ origen: 'adversario' });
  await esperar(() => pendientes.length === 2);
  const solapada = coordinador.procesarPendientes({ origen: 'solape' });
  assert.equal(reclamaciones, 2);
  pendientes.forEach((resolver) => resolver());
  const [resultado, mismoResultado] = await Promise.all([primera, solapada]);
  assert.equal(resultado, mismoResultado);
  assert.equal(resultado.totalReclamados, 2);
  assert.throws(
    () => new CoordinadorEmisionFederacionRuntime({
      repositorioCoordinacion: repositorio,
      instanciaId: 'runtime-19c',
      concurrencia: 101
    }),
    /concurrencia debe estar entre 1 y 100/
  );
}

async function verificarFrecuenciaReintentoAcotada() {
  const demoras = [];
  const ids = crearIds();
  const errorTransporte = new Error('sin conexión');
  errorTransporte.codigo = 'transporte_federado_no_disponible';
  errorTransporte.reintentable = true;
  const procesador = new ProcesadorFlujoEmisionFederacionRuntime({
    repositorioCoordinacion: {
      async prepararCandidatos(_lease, opciones) {
        return [{
          entregaId: String(opciones.generarEntregaId()),
          posicionFlujo: '1',
          prioridad: 'operativaActual',
          intentos: 0,
          identidadOcurrencia: {
            installationOrigenId: ids.installationId,
            familia: 'monitores',
            elementoOrigenId: ids.elementoId,
            ocurrenciaOrigenId: ids.ocurrenciaId
          }
        }];
      },
      async aplicarResultados() {},
      async pausarFlujo(_lease, entrada) { demoras.push(entrada.demoraReintentoSegundos); }
    },
    repositorioOcurrencias: {
      async buscarOcurrenciaPorIdentidad() {
        return {
          familia: 'monitores',
          familiaVersion: 1,
          installationOrigenId: ids.installationId,
          elementoOrigenId: ids.elementoId,
          ocurrenciaOrigenId: ids.ocurrenciaId,
          secuenciaElemento: '1',
          operacion: 'actualizacion',
          tiempoOrigenUtc: '2030-01-01T00:00:00.000Z',
          scopeOrigenDeclarado: {
            nivel: 'portal', tenantId: null, empresaId: null, sitioId: null
          },
          vigenciaRestanteMs: '300000',
          campos: {},
          evidenciaIntegridad: []
        };
      }
    },
    servicioCliente: {
      async obtenerCapacidad() { throw errorTransporte; },
      async entregarLote() { throw new Error('No debe enviar lotes.'); }
    },
    gestorSesiones: { async obtenerToken() { return 'token-opaco'; } },
    generadorIdentidades: { generar() { return ids.entregaId; } },
    reintentoBaseSegundos: 2,
    reintentoMaximoSegundos: 60,
    aleatorio: () => 0.5
  });
  const entrada = {
    lease: {},
    flujo: {
      relacionId: ids.relacionId,
      flujoId: ids.flujoId,
      generacionId: ids.generacionId,
      familia: 'monitores',
      versionFamilia: 1
    },
    renovar: async () => true,
    exigirVigente: async () => true
  };
  assert.equal((await procesador.procesar({ ...entrada, intentos: 1 })).pausado, true);
  assert.equal((await procesador.procesar({ ...entrada, intentos: 17 })).pausado, true);
  assert.deepEqual(demoras, [2, 60]);
}

function ejecutarMiddleware(middleware, requisicion) {
  return new Promise((resolve) => middleware(requisicion, {}, resolve));
}

function crearIds() {
  return {
    relacionId: generar(TIPOS_IDENTIDAD_FEDERADA.RELACION),
    flujoId: generar(TIPOS_IDENTIDAD_FEDERADA.FLUJO),
    generacionId: generar(TIPOS_IDENTIDAD_FEDERADA.GENERACION),
    entregaId: generar(TIPOS_IDENTIDAD_FEDERADA.ENTREGA),
    installationId: generar(TIPOS_IDENTIDAD_FEDERADA.INSTALACION),
    elementoId: generar(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN),
    ocurrenciaId: generar(TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN)
  };
}

function generar(tipo) {
  return String(generador.generar(tipo));
}

function sha256(texto) {
  return createHash('sha256').update(texto, 'utf8').digest('hex');
}

async function esperar(predicado) {
  for (let intento = 0; intento < 100; intento += 1) {
    if (predicado()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error('La condición concurrente no se alcanzó.');
}

function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}
