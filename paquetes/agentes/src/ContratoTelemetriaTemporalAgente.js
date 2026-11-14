import { createHash } from 'node:crypto';

import { canonicalizarRfc8785 } from '../../auditoria/src/PerfilJcsAuditoria.js';
import { validarUuidV7Auditoria } from '../../auditoria/src/UuidV7Auditoria.js';
import {
  CAMPOS_VALOR_POR_TIPO_TELEMETRIA_AGENTE,
  CAMPOS_VALOR_TELEMETRIA_AGENTE,
  TIPOS_DATO_INTERNOS_TELEMETRIA_AGENTE,
  TIPOS_DATO_PUBLICOS_TELEMETRIA_AGENTE,
  TIPOS_DATO_TEMPORALES_TELEMETRIA_AGENTE
} from './TiposDatoTelemetriaAgente.js';

export {
  CAMPOS_VALOR_POR_TIPO_TELEMETRIA_AGENTE,
  CAMPOS_VALOR_TELEMETRIA_AGENTE,
  TIPOS_DATO_INTERNOS_TELEMETRIA_AGENTE,
  TIPOS_DATO_PUBLICOS_TELEMETRIA_AGENTE,
  TIPOS_DATO_TEMPORALES_TELEMETRIA_AGENTE
} from './TiposDatoTelemetriaAgente.js';

export const PROPIEDADES_CONTRATO_TELEMETRIA_AGENTE = Object.freeze({
  SOLICITUD: Object.freeze([
    'telemetriaRequestId',
    'emitidoEnUtc',
    'revisionConfiguracionConocida',
    'revisionPoliticaConocida',
    'catalogo',
    'observaciones'
  ]),
  CATALOGO: Object.freeze(['revision', 'senales']),
  DEFINICION_SENAL: Object.freeze([
    'categoria',
    'clave',
    'tag',
    'tipoDato',
    'unidad',
    'nombreHumano',
    'descripcion',
    'metadatos'
  ]),
  OBSERVACION: Object.freeze([
    'categoria',
    'clave',
    'tag',
    'tipoDato',
    'unidad',
    'observadoEnUtc',
    ...CAMPOS_VALOR_TELEMETRIA_AGENTE,
    'calidad',
    'severidadDeclarada',
    'origen',
    'vigenteHastaUtc',
    'detalleHumano',
    'metadatos',
    'definicionSenal'
  ])
});

const TIPOS_INTERNOS_VALIDOS = new Set(
  Object.values(TIPOS_DATO_INTERNOS_TELEMETRIA_AGENTE)
);
const TIPOS_TEMPORALES_VALIDOS = new Set(
  Object.values(TIPOS_DATO_TEMPORALES_TELEMETRIA_AGENTE)
);
const PATRON_MOMENTO_UTC = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/;
const ANIO_MINIMO_MOMENTO_UTC = 1000;
const ANIO_MAXIMO_MOMENTO_UTC = 9999;
const ESCALA_MAXIMA_DURACION = 4;

export class ErrorContratoTelemetriaAgente extends Error {
  constructor(mensaje, { codigo, campo = null } = {}) {
    super(mensaje);
    this.name = 'ErrorContratoTelemetriaAgente';
    this.codigo = codigo || 'contrato_telemetria_invalido';
    this.campo = campo;
  }
}

export function obtenerCampoValorEsperadoTelemetriaAgente(tipoDato) {
  const campo = CAMPOS_VALOR_POR_TIPO_TELEMETRIA_AGENTE[tipoDato];

  if (!campo) {
    lanzarError(
      `El tipo de dato ${String(tipoDato || '(vacío)')} no pertenece al contrato interno de telemetría.`,
      'tipo_dato_telemetria_invalido',
      'tipoDato'
    );
  }

  return campo;
}

export function normalizarValorDuracionTelemetria(valor) {
  if (typeof valor !== 'number' || !Number.isFinite(valor) || valor < 0) {
    lanzarError(
      'La duración debe ser un número finito mayor o igual que cero.',
      'valor_duracion_invalido',
      'valorDuracion'
    );
  }

  const normalizado = Object.is(valor, -0) ? 0 : valor;
  if (obtenerEscalaDecimalEfectiva(normalizado) > ESCALA_MAXIMA_DURACION) {
    lanzarError(
      `La duración admite como máximo ${ESCALA_MAXIMA_DURACION} cifras decimales.`,
      'precision_duracion_invalida',
      'valorDuracion'
    );
  }

  return normalizado;
}

export function normalizarValorMomentoUtcTelemetria(valor) {
  const coincidencia = typeof valor === 'string'
    ? PATRON_MOMENTO_UTC.exec(valor)
    : null;
  const anio = coincidencia ? Number.parseInt(coincidencia[1], 10) : Number.NaN;

  if (
    !coincidencia ||
    anio < ANIO_MINIMO_MOMENTO_UTC ||
    anio > ANIO_MAXIMO_MOMENTO_UTC
  ) {
    lanzarErrorMomentoUtc();
  }

  const instante = Date.parse(valor);
  if (!Number.isFinite(instante)) {
    lanzarErrorMomentoUtc();
  }

  const reserializado = new Date(instante).toISOString().replace(/\.000Z$/u, 'Z');
  if (reserializado !== valor) {
    lanzarErrorMomentoUtc();
  }

  return valor;
}

export function normalizarUnidadTipoTemporalTelemetria(tipoDato, unidad) {
  if (!TIPOS_TEMPORALES_VALIDOS.has(tipoDato)) {
    lanzarError(
      `El tipo ${String(tipoDato || '(vacío)')} no posee canonicalización temporal de unidad.`,
      'tipo_dato_telemetria_invalido',
      'tipoDato'
    );
  }

  const ausente = unidad == null || unidad === '';
  const segundosCompatibles =
    tipoDato === TIPOS_DATO_TEMPORALES_TELEMETRIA_AGENTE.DURACION &&
    unidad === 's';

  if (!ausente && !segundosCompatibles) {
    lanzarError(
      `La unidad no es compatible con el tipo temporal ${tipoDato}.`,
      'unidad_tipo_temporal_invalida',
      'unidad'
    );
  }

  return null;
}

export function validarTelemetriaRequestId(valor) {
  try {
    return validarUuidV7Auditoria(valor, 'telemetriaRequestId');
  } catch (causa) {
    const error = new ErrorContratoTelemetriaAgente(
      causa.message,
      {
        codigo: 'telemetria_request_id_invalido',
        campo: 'telemetriaRequestId'
      }
    );
    error.cause = causa;
    throw error;
  }
}

export function validarPropiedadesExactasSolicitudTelemetria(solicitud) {
  validarClavesExactas(
    solicitud,
    PROPIEDADES_CONTRATO_TELEMETRIA_AGENTE.SOLICITUD,
    'body'
  );

  if (Object.hasOwn(solicitud, 'catalogo') && solicitud.catalogo != null) {
    validarPropiedadesExactasCatalogoTelemetria(solicitud.catalogo);
  }

  if (Object.hasOwn(solicitud, 'observaciones')) {
    exigirArray(solicitud.observaciones, 'body.observaciones');
    solicitud.observaciones.forEach((observacion, indice) => {
      validarPropiedadesExactasObservacionTelemetria(
        observacion,
        `body.observaciones[${indice}]`
      );
    });
  }

  return solicitud;
}

export function validarPropiedadesExactasCatalogoTelemetria(
  catalogo,
  ruta = 'body.catalogo'
) {
  validarClavesExactas(
    catalogo,
    PROPIEDADES_CONTRATO_TELEMETRIA_AGENTE.CATALOGO,
    ruta
  );

  if (Object.hasOwn(catalogo, 'senales')) {
    exigirArray(catalogo.senales, `${ruta}.senales`);
    catalogo.senales.forEach((definicion, indice) => {
      validarPropiedadesExactasDefinicionSenalTelemetria(
        definicion,
        `${ruta}.senales[${indice}]`
      );
    });
  }

  return catalogo;
}

export function validarPropiedadesExactasDefinicionSenalTelemetria(
  definicion,
  ruta = 'definicionSenal'
) {
  validarClavesExactas(
    definicion,
    PROPIEDADES_CONTRATO_TELEMETRIA_AGENTE.DEFINICION_SENAL,
    ruta
  );
  return definicion;
}

export function validarPropiedadesExactasObservacionTelemetria(
  observacion,
  ruta = 'observacion'
) {
  validarClavesExactas(
    observacion,
    PROPIEDADES_CONTRATO_TELEMETRIA_AGENTE.OBSERVACION,
    ruta
  );

  if (
    Object.hasOwn(observacion, 'definicionSenal') &&
    observacion.definicionSenal != null
  ) {
    validarPropiedadesExactasDefinicionSenalTelemetria(
      observacion.definicionSenal,
      `${ruta}.definicionSenal`
    );
  }

  return observacion;
}

export function normalizarCamposValorTelemetriaInterna(observacion) {
  const tipoDato = observacion?.tipoDato;
  if (!TIPOS_INTERNOS_VALIDOS.has(tipoDato)) {
    obtenerCampoValorEsperadoTelemetriaAgente(tipoDato);
  }

  const presentes = CAMPOS_VALOR_TELEMETRIA_AGENTE.filter((campo) =>
    valorTelemetriaEstaPresente(observacion?.[campo])
  );
  const esperado = obtenerCampoValorEsperadoTelemetriaAgente(tipoDato);

  if (presentes.length !== 1 || presentes[0] !== esperado) {
    lanzarError(
      `La observación de tipo ${tipoDato} debe declarar exclusivamente ${esperado}.`,
      'valor_telemetria_exclusivo_invalido',
      esperado
    );
  }

  const valores = Object.fromEntries(
    CAMPOS_VALOR_TELEMETRIA_AGENTE.map((campo) => [campo, null])
  );
  if (tipoDato === TIPOS_DATO_TEMPORALES_TELEMETRIA_AGENTE.DURACION) {
    valores[esperado] = normalizarValorDuracionTelemetria(observacion[esperado]);
  } else if (tipoDato === TIPOS_DATO_TEMPORALES_TELEMETRIA_AGENTE.MOMENTO_UTC) {
    valores[esperado] = normalizarValorMomentoUtcTelemetria(observacion[esperado]);
  } else {
    valores[esperado] = observacion[esperado];
  }

  return Object.freeze(valores);
}

export function crearRepresentacionLogicaLoteTelemetria(solicitud) {
  validarPropiedadesExactasSolicitudTelemetria(solicitud);
  validarTelemetriaRequestId(solicitud.telemetriaRequestId);

  if (!Array.isArray(solicitud.observaciones) || solicitud.observaciones.length === 0) {
    lanzarError(
      'El lote lógico debe contener al menos una observación.',
      'forma_telemetria_invalida',
      'observaciones'
    );
  }

  const representacion = {};
  for (const [campo, valor] of Object.entries(solicitud)) {
    if (campo === 'telemetriaRequestId') continue;
    if (campo === 'catalogo' && valor != null) {
      representacion[campo] = normalizarCatalogoParaHuella(valor);
    } else if (campo === 'observaciones') {
      representacion[campo] = valor.map(normalizarObservacionParaHuella);
    } else {
      representacion[campo] = clonarValorJson(valor, `body.${campo}`);
    }
  }

  canonicalizarRfc8785(representacion);
  return congelarArbol(representacion);
}

export function canonicalizarLoteTelemetriaParaHuella(solicitud) {
  return canonicalizarRfc8785(crearRepresentacionLogicaLoteTelemetria(solicitud));
}

export function calcularHuellaLoteTelemetriaSha256(solicitud) {
  const canonico = canonicalizarLoteTelemetriaParaHuella(solicitud);
  return createHash('sha256').update(canonico, 'utf8').digest();
}

function normalizarCatalogoParaHuella(catalogo) {
  const salida = {};
  for (const [campo, valor] of Object.entries(catalogo)) {
    salida[campo] = campo === 'senales'
      ? valor.map(normalizarDefinicionParaHuella)
      : clonarValorJson(valor, `body.catalogo.${campo}`);
  }
  return salida;
}

function normalizarDefinicionParaHuella(definicion) {
  const salida = clonarObjetoJson(definicion, 'definicionSenal');
  if (TIPOS_TEMPORALES_VALIDOS.has(salida.tipoDato)) {
    salida.unidad = normalizarUnidadTipoTemporalTelemetria(
      salida.tipoDato,
      salida.unidad
    );
  }
  return salida;
}

function normalizarObservacionParaHuella(observacion) {
  const salida = clonarObjetoJson(observacion, 'observacion');
  const valores = normalizarCamposValorTelemetriaInterna(observacion);

  for (const campo of CAMPOS_VALOR_TELEMETRIA_AGENTE) {
    salida[campo] = valores[campo];
  }
  if (TIPOS_TEMPORALES_VALIDOS.has(salida.tipoDato)) {
    salida.unidad = normalizarUnidadTipoTemporalTelemetria(
      salida.tipoDato,
      salida.unidad
    );
  }
  if (salida.definicionSenal != null) {
    salida.definicionSenal = normalizarDefinicionParaHuella(
      salida.definicionSenal
    );
  }

  return salida;
}

function obtenerEscalaDecimalEfectiva(valor) {
  const texto = String(valor).toLowerCase();
  const coincidencia = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/.exec(texto);
  if (!coincidencia) {
    return Number.POSITIVE_INFINITY;
  }

  const decimalesCoeficiente = coincidencia[2]?.length || 0;
  const exponente = Number.parseInt(coincidencia[3] || '0', 10);
  return Math.max(0, decimalesCoeficiente - exponente);
}

function validarClavesExactas(objeto, permitidas, ruta) {
  exigirObjetoJsonPlano(objeto, ruta);
  const conjunto = new Set(permitidas);

  for (const clave of Reflect.ownKeys(objeto)) {
    const descriptor = typeof clave === 'string'
      ? Object.getOwnPropertyDescriptor(objeto, clave)
      : null;
    if (
      typeof clave !== 'string' ||
      !conjunto.has(clave) ||
      descriptor?.enumerable !== true ||
      !Object.hasOwn(descriptor, 'value')
    ) {
      lanzarError(
        `${ruta} contiene la propiedad no admitida ${String(clave)}.`,
        'propiedad_telemetria_desconocida',
        typeof clave === 'string' ? `${ruta}.${clave}` : ruta
      );
    }
  }
}

function exigirObjetoJsonPlano(valor, ruta) {
  if (
    !valor ||
    typeof valor !== 'object' ||
    Array.isArray(valor) ||
    Object.getPrototypeOf(valor) !== Object.prototype
  ) {
    lanzarError(
      `${ruta} debe ser un objeto JSON.`,
      'forma_telemetria_invalida',
      ruta
    );
  }
}

function exigirArray(valor, ruta) {
  if (!Array.isArray(valor)) {
    lanzarError(
      `${ruta} debe ser un array JSON.`,
      'forma_telemetria_invalida',
      ruta
    );
  }
}

function valorTelemetriaEstaPresente(valor) {
  if (valor == null) return false;
  if (typeof valor === 'string') return valor.trim() !== '';
  return true;
}

function clonarObjetoJson(valor, ruta) {
  exigirObjetoJsonPlano(valor, ruta);
  return Object.fromEntries(
    Object.entries(valor).map(([campo, contenido]) => [
      campo,
      clonarValorJson(contenido, `${ruta}.${campo}`)
    ])
  );
}

function clonarValorJson(valor, ruta) {
  if (valor === null || typeof valor === 'string' || typeof valor === 'boolean') {
    return valor;
  }
  if (typeof valor === 'number') {
    if (!Number.isFinite(valor)) {
      lanzarError(`${ruta} debe ser finito.`, 'forma_telemetria_invalida', ruta);
    }
    return Object.is(valor, -0) ? 0 : valor;
  }
  if (Array.isArray(valor)) {
    return valor.map((item, indice) => clonarValorJson(item, `${ruta}[${indice}]`));
  }
  if (valor && typeof valor === 'object') {
    return clonarObjetoJson(valor, ruta);
  }

  lanzarError(
    `${ruta} no contiene un valor representable en JSON.`,
    'forma_telemetria_invalida',
    ruta
  );
}

function congelarArbol(valor) {
  if (!valor || typeof valor !== 'object' || Object.isFrozen(valor)) return valor;
  for (const contenido of Object.values(valor)) congelarArbol(contenido);
  return Object.freeze(valor);
}

function lanzarErrorMomentoUtc() {
  lanzarError(
    'El momento UTC debe usar YYYY-MM-DDTHH:mm:ssZ, ser real y quedar entre los años 1000 y 9999.',
    'valor_momento_utc_invalido',
    'valorMomentoUtc'
  );
}

function lanzarError(mensaje, codigo, campo) {
  throw new ErrorContratoTelemetriaAgente(mensaje, { codigo, campo });
}
