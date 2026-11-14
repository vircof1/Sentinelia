import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  AUTORIDADES_INGESTA_TELEMETRIA,
  CODIGO_ERROR_NAMESPACE_RUNTIME_RESERVADO,
  asegurarAutoridadLoteTelemetria
} from '../paquetes/agentes/src/AutoridadTelemetriaAgentes.js';
import {
  SENALES_RUNTIME_SERVIDOR_AGENTE
} from '../paquetes/agentes/src/ContratoPerfilServidorAgente.js';
import {
  ErrorCatalogoTelemetriaRuntimeIncompatible,
  PublicadorTelemetriaRuntimeEnTransaccion
} from '../paquetes/agentes/src/PublicadorTelemetriaRuntimeEnTransaccion.js';
import {
  ServicioIngestaTelemetriaAgentes
} from '../paquetes/agentes/src/ServicioIngestaTelemetriaAgentes.js';
import {
  ORIGENES_TELEMETRIA_AGENTE,
  crearLoteTelemetriaAgente
} from '../paquetes/agentes/src/TelemetriaAgente.js';
import {
  FuenteEntropiaCriptograficaNode
} from '../paquetes/federacion/adaptadores/FuenteEntropiaCriptograficaNode.js';
import {
  GeneradorIdentidadesFederadas,
  TIPOS_IDENTIDAD_FEDERADA,
  validarPayloadTelemetriaFederacion
} from '../paquetes/federacion/src/index.js';

const RAIZ = new URL('../', import.meta.url);
const FECHA = '2026-08-24T12:00:00.000Z';
const CONEXION = { async execute() { throw new Error('SQL inesperado en el doble.'); } };

await main();

async function main() {
  await verificarReservaExternaPreviaAEscrituras();
  await verificarCatalogoRuntimeEstableEIdempotente();
  await verificarPublicacionInternaYFronteraFederada();
  verificarContratoFederadoAceptaOrigenRuntime();
  await verificarComposicionYDocumentacion();

  console.log(
    '[agentes] OK 5.23.2: autoridad=runtime_interna namespace=reservado ' +
    'catalogo=estable_idempotente publicacion=historico_fotografia_reglas ' +
    'federacion=definicion_observacion_fotografia feature_flag=off'
  );
}

async function verificarReservaExternaPreviaAEscrituras() {
  let escrituras = 0;
  const repositorioCatalogoSenales = {
    async guardarDeclaracionSenal() { escrituras += 1; },
    async buscarPorIdentidad() { escrituras += 1; return null; }
  };
  const servicio = new ServicioIngestaTelemetriaAgentes({
    repositorioCatalogoSenales,
    reloj: () => new Date(FECHA)
  });

  await assert.rejects(
    servicio.prepararLote({
      agenteId: 7,
      lote: loteConObservacion({ origen: 'runtime' })
    }),
    (error) =>
      error.code === CODIGO_ERROR_NAMESPACE_RUNTIME_RESERVADO &&
      error.statusCode === 422
  );
  await assert.rejects(
    servicio.prepararLote({
      agenteId: 7,
      lote: loteConObservacion({ categoria: 'Runtime.servidor' })
    }),
    (error) => error.code === CODIGO_ERROR_NAMESPACE_RUNTIME_RESERVADO
  );
  await assert.rejects(
    servicio.prepararLote({
      agenteId: 7,
      lote: {
        catalogo: {
          revision: 1,
          senales: [{
            categoria: 'runtime.servidor',
            clave: 'sin_pol',
            tipoDato: 'booleano'
          }]
        },
        observaciones: loteConObservacion().observaciones
      }
    }),
    (error) => error.code === CODIGO_ERROR_NAMESPACE_RUNTIME_RESERVADO
  );
  assert.equal(escrituras, 0);

  const interno = crearLoteTelemetriaAgente({
    observaciones: [{
      ...observacionBase(),
      categoria: 'runtime.servidor',
      clave: 'sin_pol',
      codigoSenal: undefined,
      tipoDato: 'booleano',
      unidad: null,
      valorNumero: null,
      valorBooleano: true,
      origen: 'runtime'
    }]
  });
  assert.doesNotThrow(() => asegurarAutoridadLoteTelemetria(interno, {
    autoridad: AUTORIDADES_INGESTA_TELEMETRIA.RUNTIME
  }));
  assert.throws(
    () => asegurarAutoridadLoteTelemetria(interno, {
      autoridad: AUTORIDADES_INGESTA_TELEMETRIA.AGENTE
    }),
    /reservada al runtime/u
  );
  assert.equal(ORIGENES_TELEMETRIA_AGENTE.RUNTIME, 'runtime');
}

async function verificarCatalogoRuntimeEstableEIdempotente() {
  const entorno = crearEntornoPublicador();
  const primera = await entorno.publicador.asegurarCatalogoServidorEnTransaccion(
    { agenteId: 7, declaradaEnUtc: FECHA },
    { conexion: CONEXION }
  );

  assert.equal(primera.senales.length, 2);
  assert.equal(primera.creadas.length, 2);
  assert.deepEqual(
    primera.senales.map(({ codigoSenal }) => codigoSenal).sort(),
    [
      'runtime.servidor.reinicio_reciente',
      'runtime.servidor.sin_pol'
    ]
  );
  assert(primera.senales.every((senal) =>
    senal.tipoDato === 'booleano' &&
    senal.tag === null &&
    senal.unidad === null &&
    senal.metadatos.contrato === 'perfil-servidor-v1'
  ));
  assert.equal(entorno.guardados.length, 2);
  assert.equal(entorno.capturas.length, 1);
  assert.deepEqual([...entorno.capturas[0].senalIds].sort(), ['1', '2']);
  assert.equal(entorno.capturas[0].incluirFotografiaPol, false);
  assert.deepEqual(entorno.capturas[0].observacionIds, []);
  assert.deepEqual(entorno.capturas[0].fotografiaSenalIds, []);

  const segunda = await entorno.publicador.asegurarCatalogoServidorEnTransaccion(
    { agenteId: 7, declaradaEnUtc: FECHA },
    { conexion: CONEXION }
  );
  assert.equal(segunda.creadas.length, 0);
  assert.equal(entorno.guardados.length, 2);
  assert.equal(entorno.capturas.length, 1);

  const incompatible = crearEntornoPublicador({
    senalesIniciales: [{
      ...crearSenalCatalogada(SENALES_RUNTIME_SERVIDOR_AGENTE.SIN_POL, 9),
      descripcion: 'Definición ocupada por otro productor'
    }]
  });
  await assert.rejects(
    incompatible.publicador.asegurarCatalogoServidorEnTransaccion(
      { agenteId: 7 },
      { conexion: CONEXION }
    ),
    (error) =>
      error instanceof ErrorCatalogoTelemetriaRuntimeIncompatible &&
      error.statusCode === 409
  );
  assert.equal(incompatible.guardados.length, 0);
  assert.equal(incompatible.capturas.length, 0);
}

async function verificarPublicacionInternaYFronteraFederada() {
  const entorno = crearEntornoPublicador();
  const resultado = await entorno.publicador.publicarTransicionesEnTransaccion({
    agenteId: 7,
    emitidoEnUtc: FECHA,
    recibidoEnUtc: FECHA,
    requestId: 'runtime-perfil-servidor-7-1',
    transiciones: [{
      codigoSenal: 'runtime.servidor.sin_pol',
      valor: true,
      observadoEnUtc: FECHA,
      detalleHumano: 'Venció la histéresis configurada.',
      metadatos: { generacion: 1 }
    }]
  }, { conexion: CONEXION });

  assert.equal(entorno.ingestas.length, 1);
  const ingesta = entorno.ingestas[0];
  assert.equal(ingesta.autoridad, AUTORIDADES_INGESTA_TELEMETRIA.RUNTIME);
  assert.equal(ingesta.periodoVidaPolId, null);
  assert.equal(ingesta.sesionIdDiagnostico, null);
  assert.equal(ingesta.lote.observaciones[0].categoria, 'runtime.servidor');
  assert.equal(ingesta.lote.observaciones[0].clave, 'sin_pol');
  assert.equal(ingesta.lote.observaciones[0].origen, 'runtime');
  assert.equal(ingesta.lote.observaciones[0].valorBooleano, true);
  assert.equal(ingesta.lote.observaciones[0].definicionSenal, undefined);

  assert.equal(entorno.capturas.length, 2);
  assert.deepEqual(entorno.capturas[1].observacionIds, ['101']);
  assert.deepEqual(entorno.capturas[1].fotografiaSenalIds, ['11']);
  assert.equal(entorno.capturas[1].incluirFotografiaPol, false);
  assert.deepEqual(resultado.efectosPostCommit.trabajosEvaluacionIds, ['77']);
  assert.deepEqual(
    resultado.efectosPostCommit.fotografiasActualizadas.map(({ id }) => id),
    [11]
  );

  await assert.rejects(
    entorno.publicador.publicarTransicionesEnTransaccion({
      agenteId: 7,
      transiciones: [{
        codigoSenal: 'runtime.servidor.inventada',
        valor: true,
        observadoEnUtc: FECHA
      }]
    }, { conexion: CONEXION }),
    /no pertenece al perfil servidor/u
  );
}

function verificarContratoFederadoAceptaOrigenRuntime() {
  const generador = new GeneradorIdentidadesFederadas({
    fuenteEntropia: new FuenteEntropiaCriptograficaNode()
  });
  const id = () => String(
    generador.generar(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN)
  );
  const normalizado = validarPayloadTelemetriaFederacion({
    perfil: 'sentinelia-federacion-telemetria-v1',
    version: 1,
    tipoRegistro: 'observacion',
    fuenteOrigenId: id(),
    senalOrigenId: id(),
    periodoPolOrigenId: null,
    categoria: 'runtime.servidor',
    clave: 'sin_pol',
    tag: '',
    codigoSenal: 'runtime.servidor.sin_pol',
    tipoDato: 'booleano',
    unidad: '',
    valor: true,
    calidad: 'valida',
    severidadDeclarada: 'info',
    origen: 'runtime',
    vigenteHastaUtc: null,
    detalleHumano: null,
    metadatosContextuales: { generacion: 1 },
    emitidoEnUtc: FECHA,
    observadoEnUtc: FECHA,
    recibidoEnUtc: FECHA
  });

  assert.equal(normalizado.origen, 'runtime');
  assert.equal(normalizado.valor, true);
}

async function verificarComposicionYDocumentacion() {
  const [openapi, web, runtime, configuracion] = await Promise.all([
    leer('openapi/agentes.v1.yaml'),
    leer('apps/sentinelia-web/src/index.js'),
    leer('apps/sentinelia-runtime/src/BootstrapRuntime.js'),
    leer('paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js')
  ]);
  const origenExterno = openapi.match(
    /TelemetryOrigin:[\s\S]*?(?=\n    [A-Z][A-Za-z]+:)/u
  )?.[0] || '';

  assert.match(origenExterno, /- directa/u);
  assert.doesNotMatch(origenExterno, /- runtime/u);
  assert.match(web, /new PublicadorTelemetriaRuntimeEnTransaccion/u);
  assert.match(web, /publicadorTelemetriaRuntimeEnTransaccion,/u);
  assert.match(runtime, /this\.publicadorTelemetriaRuntimeEnTransaccion/u);
  assert.match(
    configuracion,
    /AGENTES_PERFIL_SERVIDOR_HABILITADO[\s\S]*true/u
  );
}

function crearEntornoPublicador({ senalesIniciales = [] } = {}) {
  const senales = senalesIniciales.map((senal) => ({ ...senal }));
  const guardados = [];
  const capturas = [];
  const ingestas = [];
  const repositorioCatalogoSenales = {
    senales,
    async buscarPorIdentidad({ categoria, clave, tag }) {
      return this.senales.find((senal) =>
        senal.categoria === categoria &&
        senal.clave === clave &&
        (senal.tag || null) === (tag || null)
      ) || null;
    },
    async guardarDeclaracionSenal({ agenteId, definicion }) {
      const contrato = Object.values(SENALES_RUNTIME_SERVIDOR_AGENTE)
        .find(({ categoria, clave }) =>
          categoria === definicion.categoria && clave === definicion.clave
        );
      const guardada = {
        ...crearSenalCatalogada(contrato, this.senales.length + 1),
        agenteId
      };
      this.senales.push(guardada);
      guardados.push(guardada);
      return guardada;
    }
  };
  const servicioIngestaTelemetriaAgentes = {
    repositorioCatalogoSenales,
    repositorioObservaciones: {},
    repositorioEstadoActual: {},
    repositorioReglasDerivacion: {},
    repositorioTrabajosEvaluacion: {},
    capturadorFederacionTelemetria: {
      async capturarIngestaEnTransaccion(solicitud) {
        capturas.push(solicitud);
      }
    },
    async ingestarLoteConRepositorios(datos) {
      ingestas.push(datos);
      asegurarAutoridadLoteTelemetria(
        crearLoteTelemetriaAgente(datos.lote),
        { autoridad: datos.autoridad }
      );
      datos.trabajosEncolados.push({ id: 77 });
      return {
        resultado: { ok: true },
        senalesModificadas: [],
        persistencia: {
          observaciones: [{ id: 101 }],
          fotografiaActual: {
            fotografias: [{ id: 11, ultimaObservacionId: 101 }]
          }
        }
      };
    }
  };
  return {
    publicador: new PublicadorTelemetriaRuntimeEnTransaccion({
      servicioIngestaTelemetriaAgentes,
      reloj: () => new Date(FECHA)
    }),
    guardados,
    capturas,
    ingestas
  };
}

function crearSenalCatalogada(contrato, id) {
  return {
    id,
    agenteId: 7,
    categoria: contrato.categoria,
    clave: contrato.clave,
    tag: contrato.tag,
    codigoSenal: contrato.codigoSenal,
    tipoDato: contrato.tipoDato,
    unidad: contrato.unidad,
    nombreHumano: contrato.nombreHumano,
    descripcion: contrato.descripcion,
    metadatos: { ...contrato.metadatos }
  };
}

function loteConObservacion(sobrescritura = {}) {
  return { observaciones: [{ ...observacionBase(), ...sobrescritura }] };
}

function observacionBase() {
  return {
    categoria: 'sistema',
    clave: 'cpu',
    tipoDato: 'numero',
    unidad: 'porcentaje',
    observadoEnUtc: FECHA,
    valorNumero: 25,
    origen: 'directa'
  };
}

function leer(ruta) {
  return readFile(new URL(ruta, RAIZ), 'utf8');
}
