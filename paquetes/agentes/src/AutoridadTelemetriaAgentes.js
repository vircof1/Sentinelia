import {
  ORIGEN_TELEMETRIA_RUNTIME_SERVIDOR,
  SENALES_RUNTIME_SERVIDOR_AGENTE
} from './ContratoPerfilServidorAgente.js';

export const AUTORIDADES_INGESTA_TELEMETRIA = Object.freeze({
  AGENTE: 'agente',
  RUNTIME: 'runtime'
});

export const CODIGO_ERROR_NAMESPACE_RUNTIME_RESERVADO =
  'namespace_telemetria_runtime_reservado';

const IDENTIDADES_RUNTIME_SERVIDOR = new Map(
  Object.values(SENALES_RUNTIME_SERVIDOR_AGENTE).map((senal) => [
    identidadRuntime(senal),
    senal
  ])
);

export class ErrorAutoridadTelemetriaAgentes extends Error {
  constructor(mensaje, {
    codigo = CODIGO_ERROR_NAMESPACE_RUNTIME_RESERVADO,
    statusCode = 422
  } = {}) {
    super(mensaje);
    this.name = 'ErrorAutoridadTelemetriaAgentes';
    this.code = codigo;
    this.codigo = codigo;
    this.statusCode = statusCode;
  }
}

export function asegurarAutoridadLoteTelemetria(lote, {
  autoridad = AUTORIDADES_INGESTA_TELEMETRIA.AGENTE
} = {}) {
  if (autoridad === AUTORIDADES_INGESTA_TELEMETRIA.AGENTE) {
    asegurarLoteDeclaradoPorAgente(lote);
    return lote;
  }
  if (autoridad === AUTORIDADES_INGESTA_TELEMETRIA.RUNTIME) {
    asegurarLoteDeclaradoPorRuntime(lote);
    return lote;
  }

  throw new Error(`La autoridad de ingesta ${autoridad || '(vacía)'} no existe.`);
}

export function esCategoriaRuntimeReservada(categoria) {
  const normalizada = String(categoria || '').trim().toLowerCase();
  return normalizada === 'runtime' || normalizada.startsWith('runtime.');
}

function asegurarLoteDeclaradoPorAgente(lote) {
  for (const [indice, definicion] of (lote?.catalogo?.senales || []).entries()) {
    if (esCategoriaRuntimeReservada(definicion.categoria)) {
      lanzarSuplantacion(`catalogo.senales.${indice}.categoria`);
    }
  }

  for (const [indice, observacion] of (lote?.observaciones || []).entries()) {
    if (observacion.origen === ORIGEN_TELEMETRIA_RUNTIME_SERVIDOR) {
      lanzarSuplantacion(`observaciones.${indice}.origen`);
    }
    if (esCategoriaRuntimeReservada(observacion.categoria)) {
      lanzarSuplantacion(`observaciones.${indice}.categoria`);
    }
    if (esCategoriaRuntimeReservada(observacion.definicionSenal?.categoria)) {
      lanzarSuplantacion(`observaciones.${indice}.definicionSenal.categoria`);
    }
  }
}

function asegurarLoteDeclaradoPorRuntime(lote) {
  for (const [indice, definicion] of (lote?.catalogo?.senales || []).entries()) {
    asegurarDefinicionRuntimeConocida(
      definicion,
      `catalogo.senales.${indice}`
    );
  }

  for (const [indice, observacion] of (lote?.observaciones || []).entries()) {
    const campo = `observaciones.${indice}`;
    const esperada = asegurarDefinicionRuntimeConocida(observacion, campo);
    if (observacion.origen !== ORIGEN_TELEMETRIA_RUNTIME_SERVIDOR) {
      lanzarRuntimeInvalido(`${campo}.origen`);
    }
    if (typeof observacion.valorBooleano !== 'boolean') {
      lanzarRuntimeInvalido(`${campo}.valorBooleano`);
    }
    if (observacion.definicionSenal) {
      const declarada = asegurarDefinicionRuntimeConocida(
        observacion.definicionSenal,
        `${campo}.definicionSenal`
      );
      if (declarada.codigoSenal !== esperada.codigoSenal) {
        lanzarRuntimeInvalido(`${campo}.definicionSenal`);
      }
    }
  }
}

function asegurarDefinicionRuntimeConocida(definicion, campo) {
  const esperada = IDENTIDADES_RUNTIME_SERVIDOR.get(identidadRuntime(definicion));
  if (
    !esperada ||
    definicion.tipoDato !== esperada.tipoDato ||
    (definicion.unidad || null) !== esperada.unidad
  ) {
    lanzarRuntimeInvalido(campo);
  }
  return esperada;
}

function identidadRuntime({ categoria, clave, tag = null } = {}) {
  return `${String(categoria || '').trim()}\u0000${String(clave || '').trim()}\u0000${tag || ''}`;
}

function lanzarSuplantacion(campo) {
  throw new ErrorAutoridadTelemetriaAgentes(
    `El campo ${campo} intenta declarar telemetría reservada al runtime de Sentinelia.`
  );
}

function lanzarRuntimeInvalido(campo) {
  throw new ErrorAutoridadTelemetriaAgentes(
    `El publicador runtime no está autorizado a declarar ${campo}.`,
    { codigo: 'telemetria_runtime_interna_invalida' }
  );
}
