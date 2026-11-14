import { isDeepStrictEqual } from 'node:util';

import {
  CALIDADES_TELEMETRIA_AGENTE,
  ORIGENES_TELEMETRIA_AGENTE,
  SEVERIDADES_DECLARADAS_TELEMETRIA_AGENTE
} from './TelemetriaAgente.js';
import {
  SENALES_RUNTIME_SERVIDOR_AGENTE
} from './ContratoPerfilServidorAgente.js';
import {
  AUTORIDADES_INGESTA_TELEMETRIA
} from './AutoridadTelemetriaAgentes.js';
import {
  crearRepositoriosTelemetriaEnTransaccion
} from './InfraestructuraTransaccionalTelemetriaAgentes.js';
import {
  construirSolicitudCapturaFederadaTelemetria
} from './CapturaFederadaTelemetriaAgentes.js';

const SENALES_POR_CODIGO = new Map(
  Object.values(SENALES_RUNTIME_SERVIDOR_AGENTE).map((senal) => [
    senal.codigoSenal,
    senal
  ])
);

export class ErrorCatalogoTelemetriaRuntimeIncompatible extends Error {
  constructor(codigoSenal) {
    super(
      `La identidad reservada ${codigoSenal} ya existe con una definición incompatible.`
    );
    this.name = 'ErrorCatalogoTelemetriaRuntimeIncompatible';
    this.code = 'senal_runtime_incompatible';
    this.codigo = this.code;
    this.statusCode = 409;
  }
}

/**
 * Puerto interno para publicar telemetría de Sentinelia sin fingir una petición
 * del agente. El llamador conserva la transacción y ejecuta los efectos Redis
 * devueltos únicamente después del commit.
 */
export class PublicadorTelemetriaRuntimeEnTransaccion {
  constructor({ servicioIngestaTelemetriaAgentes, reloj = () => new Date() } = {}) {
    if (
      typeof servicioIngestaTelemetriaAgentes?.ingestarLoteConRepositorios !==
      'function'
    ) {
      throw new Error('El publicador runtime requiere el núcleo de ingesta de telemetría.');
    }
    if (!servicioIngestaTelemetriaAgentes.repositorioObservaciones) {
      throw new Error('El publicador runtime requiere persistencia de observaciones.');
    }
    if (!servicioIngestaTelemetriaAgentes.repositorioEstadoActual) {
      throw new Error('El publicador runtime requiere la fotografía actual de telemetría.');
    }

    this.servicioIngesta = servicioIngestaTelemetriaAgentes;
    this.reloj = reloj;
  }

  async asegurarCatalogoServidorEnTransaccion({
    agenteId,
    declaradaEnUtc = null
  } = {}, { conexion } = {}) {
    const repositorios = this.crearRepositorios(conexion);
    const declarada = declaradaEnUtc || this.reloj();
    const senales = [];
    const creadas = [];

    for (const contrato of SENALES_POR_CODIGO.values()) {
      let catalogada = await repositorios.repositorioCatalogoSenales
        .buscarPorIdentidad({
          agenteId,
          categoria: contrato.categoria,
          clave: contrato.clave,
          tag: contrato.tag
        });

      if (catalogada) {
        asegurarCatalogoCompatible(catalogada, contrato);
      } else {
        catalogada = await repositorios.repositorioCatalogoSenales
          .guardarDeclaracionSenal({
            agenteId,
            definicion: construirDefinicionCatalogo(contrato),
            declaradaEnUtc: declarada
          });
        asegurarCatalogoCompatible(catalogada, contrato);
        creadas.push(catalogada);
      }
      senales.push(catalogada);
    }

    if (creadas.length > 0 && this.servicioIngesta.capturadorFederacionTelemetria) {
      await this.servicioIngesta.capturadorFederacionTelemetria
        .capturarIngestaEnTransaccion(
          construirSolicitudCapturaFederadaTelemetria({
            agenteId,
            resultado: null,
            senalIdsAdicionales: creadas.map((senal) => senal.id),
            incluirFotografiaPol: false
          }),
          { conexion }
        );
    }

    return Object.freeze({
      senales: Object.freeze(senales.map(serializar)),
      creadas: Object.freeze(creadas.map(serializar))
    });
  }

  async publicarTransicionesEnTransaccion({
    agenteId,
    transiciones,
    emitidoEnUtc = null,
    recibidoEnUtc = null,
    requestId = null
  } = {}, { conexion } = {}) {
    if (!Array.isArray(transiciones) || transiciones.length === 0) {
      throw new Error('La publicación runtime requiere al menos una transición.');
    }

    await this.asegurarCatalogoServidorEnTransaccion(
      { agenteId, declaradaEnUtc: emitidoEnUtc || recibidoEnUtc || this.reloj() },
      { conexion }
    );
    const repositorios = this.crearRepositorios(conexion);
    const trabajosEncolados = [];
    const resultado = await this.servicioIngesta.ingestarLoteConRepositorios({
      agenteId,
      lote: {
        emitidoEnUtc,
        observaciones: transiciones.map(construirObservacionRuntime)
      },
      requestId,
      recibidoEnUtc: recibidoEnUtc || this.reloj(),
      periodoVidaPolId: null,
      sesionIdDiagnostico: null,
      sesionHuellaSha256: null,
      ...repositorios,
      trabajosEncolados,
      conexion,
      autoridad: AUTORIDADES_INGESTA_TELEMETRIA.RUNTIME
    });

    if (this.servicioIngesta.capturadorFederacionTelemetria) {
      await this.servicioIngesta.capturadorFederacionTelemetria
        .capturarIngestaEnTransaccion(
          construirSolicitudCapturaFederadaTelemetria({
            agenteId,
            resultado,
            incluirFotografiaPol: false
          }),
          { conexion }
        );
    }

    const fotografias = resultado.persistencia?.fotografiaActual?.fotografias || [];
    return Object.freeze({
      ...resultado,
      efectosPostCommit: Object.freeze({
        trabajosEvaluacionIds: Object.freeze(trabajosEncolados
          .map((trabajo) => trabajo?.id)
          .filter((id) => id !== null && id !== undefined)
          .map(String)),
        fotografiasActualizadas: Object.freeze(fotografias.map((foto) => ({
          ...foto
        })))
      })
    });
  }

  crearRepositorios(conexion) {
    return crearRepositoriosTelemetriaEnTransaccion({
      repositorioCatalogoSenales: this.servicioIngesta.repositorioCatalogoSenales,
      repositorioObservaciones: this.servicioIngesta.repositorioObservaciones,
      repositorioEstadoActual: this.servicioIngesta.repositorioEstadoActual,
      repositorioReglasDerivacion: this.servicioIngesta.repositorioReglasDerivacion,
      repositorioTrabajosEvaluacion:
        this.servicioIngesta.repositorioTrabajosEvaluacion
    }, conexion);
  }
}

function construirDefinicionCatalogo(contrato) {
  return {
    categoria: contrato.categoria,
    clave: contrato.clave,
    tag: contrato.tag,
    tipoDato: contrato.tipoDato,
    unidad: contrato.unidad,
    nombreHumano: contrato.nombreHumano,
    descripcion: contrato.descripcion,
    metadatos: contrato.metadatos
  };
}

function construirObservacionRuntime(transicion, indice) {
  const contrato = SENALES_POR_CODIGO.get(String(transicion?.codigoSenal || ''));
  if (!contrato) {
    throw new Error(`La transición runtime ${indice} no pertenece al perfil servidor.`);
  }
  if (typeof transicion.valor !== 'boolean') {
    throw new TypeError(`La transición runtime ${indice} debe contener un valor booleano.`);
  }

  return {
    categoria: contrato.categoria,
    clave: contrato.clave,
    tag: contrato.tag,
    tipoDato: contrato.tipoDato,
    unidad: contrato.unidad,
    observadoEnUtc: transicion.observadoEnUtc,
    valorBooleano: transicion.valor,
    calidad: CALIDADES_TELEMETRIA_AGENTE.VALIDA,
    severidadDeclarada: SEVERIDADES_DECLARADAS_TELEMETRIA_AGENTE.INFO,
    origen: ORIGENES_TELEMETRIA_AGENTE.RUNTIME,
    vigenteHastaUtc: transicion.vigenteHastaUtc || null,
    detalleHumano: transicion.detalleHumano || null,
    metadatos: transicion.metadatos || null
  };
}

function asegurarCatalogoCompatible(catalogada, contrato) {
  const actual = serializar(catalogada);
  const compatible =
    actual.categoria === contrato.categoria &&
    actual.clave === contrato.clave &&
    (actual.tag || null) === contrato.tag &&
    actual.codigoSenal === contrato.codigoSenal &&
    actual.tipoDato === contrato.tipoDato &&
    (actual.unidad || null) === contrato.unidad &&
    actual.nombreHumano === contrato.nombreHumano &&
    actual.descripcion === contrato.descripcion &&
    isDeepStrictEqual(actual.metadatos, contrato.metadatos);

  if (!compatible) {
    throw new ErrorCatalogoTelemetriaRuntimeIncompatible(contrato.codigoSenal);
  }
}

function serializar(valor) {
  return typeof valor?.serializar === 'function' ? valor.serializar() : { ...valor };
}
