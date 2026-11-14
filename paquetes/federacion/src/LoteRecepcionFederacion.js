import {
  canonicalizarJsonFederacion,
  codificarUtf8CanonicoFederacion
} from './CanonicalizadorFederacion.js';
import {
  ERRORES_TEMPORALES_FEDERACION,
  RESULTADOS_OCURRENCIA_FEDERACION
} from './CatalogosFederacion.js';
import {
  TIPOS_IDENTIDAD_FEDERADA,
  crearIdentidadFederada
} from './IdentidadFederada.js';

export class ErrorLoteRecepcionFederacion extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.name = 'ErrorLoteRecepcionFederacion';
    this.codigo = codigo;
  }
}

export function crearLoteRecepcionFederacion({
  loteId,
  relacionId,
  flujoId,
  generacionId,
  revisionConcesionEfectiva = null,
  entregas
} = {}) {
  if (!Array.isArray(entregas) || entregas.length === 0) {
    throw new ErrorLoteRecepcionFederacion(
      'lote_vacio',
      'Un lote federado debe contener al menos una entrega.'
    );
  }
  const identidades = new Set();
  const posiciones = new Set();
  const normalizadas = entregas.map((entrega, indice) => {
    const entregaId = identidad(
      entrega?.entregaId,
      TIPOS_IDENTIDAD_FEDERADA.ENTREGA,
      `entregas[${indice}].entregaId`
    );
    const posicionFlujo = enteroDecimalPositivo(
      entrega?.posicionFlujo,
      `entregas[${indice}].posicionFlujo`
    );
    if (identidades.has(entregaId) || posiciones.has(posicionFlujo)) {
      throw new ErrorLoteRecepcionFederacion(
        'composicion_lote_duplicada',
        'Un lote no puede repetir una entrega ni una posición de flujo.'
      );
    }
    identidades.add(entregaId);
    posiciones.add(posicionFlujo);
    const ocurrenciaJson = convertirRepresentacionJson(entrega?.ocurrencia);
    const ocurrenciaCanonica = canonicalizarJsonFederacion(ocurrenciaJson);
    const procedencia = entrega?.procedencia == null
      ? null
      : convertirRepresentacionJson(entrega.procedencia);
    const procedenciaCanonica = procedencia === null
      ? null
      : canonicalizarJsonFederacion(procedencia);
    const bytes = codificarUtf8CanonicoFederacion(ocurrenciaJson).byteLength;
    if (bytes > 16 * 1024 * 1024 - 1) {
      throw new ErrorLoteRecepcionFederacion(
        'ocurrencia_excede_limite_fisico',
        'La representación no cabe en el contenedor durable del lote.'
      );
    }
    return Object.freeze({
      entregaId,
      ordinalLote: indice + 1,
      posicionFlujo,
      // A partir de aquí solo circula la fotografía JSON que se canonicalizó.
      // Conservar el objeto original permitiría que toJSON() y sus propiedades
      // directas describieran dos ocurrencias distintas durante el proceso.
      ocurrencia: ocurrenciaJson,
      ocurrenciaCanonica,
      procedencia,
      procedenciaCanonica
    });
  });
  return Object.freeze({
    loteId: identidad(loteId, TIPOS_IDENTIDAD_FEDERADA.LOTE, 'loteId'),
    relacionId: identidad(relacionId, TIPOS_IDENTIDAD_FEDERADA.RELACION, 'relacionId'),
    flujoId: identidad(flujoId, TIPOS_IDENTIDAD_FEDERADA.FLUJO, 'flujoId'),
    generacionId: identidad(
      generacionId,
      TIPOS_IDENTIDAD_FEDERADA.GENERACION,
      'generacionId'
    ),
    revisionConcesionEfectiva: revisionConcesionEfectiva === null
      ? null
      : identidad(
        revisionConcesionEfectiva,
        TIPOS_IDENTIDAD_FEDERADA.REVISION_CONCESION,
        'revisionConcesionEfectiva'
      ),
    entregas: Object.freeze(normalizadas)
  });
}

export function crearAplazamientoEntregaFederacion({ resultado, errorTemporal } = {}) {
  const resultadoValidado = RESULTADOS_OCURRENCIA_FEDERACION.exigir(resultado, {
    campo: 'resultado'
  });
  if (!['aplazadaCapacidad', 'aplazadaValidacion'].includes(resultadoValidado)) {
    throw new ErrorLoteRecepcionFederacion(
      'aplazamiento_invalido',
      'Una decisión previa solo puede aplazar temporalmente la entrega.'
    );
  }
  return Object.freeze({
    clasificacion: 'temporal',
    resultado: resultadoValidado,
    errorTemporal: ERRORES_TEMPORALES_FEDERACION.exigir(errorTemporal, {
      campo: 'errorTemporal'
    }),
    errorTerminal: null,
    inboxId: null,
    confirmada: false,
    reutilizado: false
  });
}

function identidad(valor, tipo, campo) {
  try {
    return String(crearIdentidadFederada({ tipo, valor: String(valor || '') }));
  } catch (error) {
    throw new ErrorLoteRecepcionFederacion(
      'identidad_lote_invalida',
      `${campo} no contiene una identidad federada canónica: ${error.message}`
    );
  }
}

function enteroDecimalPositivo(valor, campo) {
  if (!/^[1-9][0-9]*$/u.test(String(valor ?? ''))) {
    throw new ErrorLoteRecepcionFederacion(
      'posicion_lote_invalida',
      `${campo} debe ser un entero decimal positivo.`
    );
  }
  const normalizado = BigInt(String(valor)).toString();
  if (BigInt(normalizado) > 18446744073709551615n) {
    throw new ErrorLoteRecepcionFederacion(
      'posicion_lote_fuera_de_rango',
      `${campo} supera el rango durable admitido.`
    );
  }
  return normalizado;
}

function convertirRepresentacionJson(valor) {
  let serializado;
  try {
    serializado = JSON.stringify(valor);
  } catch (error) {
    throw new ErrorLoteRecepcionFederacion(
      'ocurrencia_no_representable',
      `La entrega no contiene una representación JSON transportable: ${error.message}`
    );
  }
  if (serializado === undefined) {
    throw new ErrorLoteRecepcionFederacion(
      'ocurrencia_ausente',
      'Toda entrega debe contener una ocurrencia JSON.'
    );
  }
  return JSON.parse(serializado);
}
