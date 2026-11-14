import { canonicalizarJsonFederacion } from './CanonicalizadorFederacion.js';
import { VERSION_PROTOCOLO_FEDERACION } from './CatalogosFederacion.js';
import { validarSelectorFamiliaFederacion }
  from './ContratosFamiliasFederacion.js';
import {
  crearIdentidadFederada,
  TIPOS_IDENTIDAD_FEDERADA
} from './IdentidadFederada.js';
import { hidratarDeclaracionConcesionFederacion }
  from './RevisionConcesionFederacion.js';
import {
  calcularSha256HexFederacion,
  codificarUtf8Federacion
} from './HuellaSha256Federacion.js';

export const PERFIL_INTERCAMBIO_DECLARACION_CONCESION_FEDERACION =
  'sentinelia-federacion-intercambio-declaracion-concesion-v1';
const VERSION_AUTORIDAD_MAXIMA = 18_446_744_073_709_551_615n;
const BYTES_MAXIMOS_SELECCION = 65_535;

export class ErrorIntercambioDeclaracionConcesionFederacion extends Error {
  constructor(codigo, mensaje, { statusCode = 400 } = {}) {
    super(mensaje);
    this.name = 'ErrorIntercambioDeclaracionConcesionFederacion';
    this.codigo = codigo;
    this.statusCode = statusCode;
  }
}

export function validarIntercambioDeclaracionConcesionFederacion(valor) {
  exigirObjetoExacto(valor, [
    'emitidaEnUtc', 'installationEmisoraId', 'installationReceptoraId',
    'intercambioId', 'papel', 'perfil', 'protocoloVersion', 'relacionId',
    'revisionId', 'revisionOrdinal', 'seleccion', 'versionAutoridad'
  ]);
  if (valor.perfil !== PERFIL_INTERCAMBIO_DECLARACION_CONCESION_FEDERACION ||
      valor.protocoloVersion !== VERSION_PROTOCOLO_FEDERACION) {
    fallar('VERSION_PROTOCOLO_FEDERACION_INCOMPATIBLE',
      'La declaración usa un perfil o versión de protocolo incompatible.', 409);
  }
  uuidV7(valor.intercambioId, 'intercambioId');
  const relacionId = identidad(valor.relacionId, TIPOS_IDENTIDAD_FEDERADA.RELACION);
  const revisionId = identidad(
    valor.revisionId,
    TIPOS_IDENTIDAD_FEDERADA.REVISION_CONCESION
  );
  const installationEmisoraId = identidad(
    valor.installationEmisoraId,
    TIPOS_IDENTIDAD_FEDERADA.INSTALACION
  );
  const installationReceptoraId = identidad(
    valor.installationReceptoraId,
    TIPOS_IDENTIDAD_FEDERADA.INSTALACION
  );
  if (!['oferta', 'aceptacion'].includes(valor.papel)) {
    fallar('PAPEL_DECLARACION_FEDERACION_INVALIDO',
      'El intercambio solo admite oferta o aceptación.');
  }
  if (typeof valor.versionAutoridad !== 'string' ||
      !/^[1-9][0-9]*$/u.test(valor.versionAutoridad) ||
      BigInt(valor.versionAutoridad) > VERSION_AUTORIDAD_MAXIMA) {
    fallar('VERSION_AUTORIDAD_FEDERACION_INVALIDA',
      'versionAutoridad debe ser decimal canónica positiva.');
  }
  if (typeof valor.revisionOrdinal !== 'string' ||
      !/^[1-9][0-9]*$/u.test(valor.revisionOrdinal) ||
      BigInt(valor.revisionOrdinal) > VERSION_AUTORIDAD_MAXIMA) {
    fallar('ORDINAL_REVISION_FEDERACION_INVALIDO',
      'revisionOrdinal debe ser decimal canónico positivo.');
  }
  const emitidaEnUtc = fechaUtc(valor.emitidaEnUtc, 'emitidaEnUtc');
  let seleccion;
  try {
    seleccion = hidratarDeclaracionConcesionFederacion(valor.seleccion).toJSON();
    for (const [familia, selector] of Object.entries(seleccion.familias)) {
      validarSelectorFamiliaFederacion({ familia, ...selector });
    }
  } catch {
    fallar('SELECCION_DECLARACION_FEDERACION_INVALIDA',
      'La selección de la declaración federada no es válida.');
  }
  const seleccionCanonica = canonicalizarJsonFederacion(seleccion);
  if (codificarUtf8Federacion(seleccionCanonica).byteLength > BYTES_MAXIMOS_SELECCION) {
    fallar('SELECCION_DECLARACION_FEDERACION_EXCESIVA',
      'La selección de la declaración federada excede el límite durable.');
  }
  return Object.freeze({
    perfil: valor.perfil,
    protocoloVersion: valor.protocoloVersion,
    intercambioId: valor.intercambioId,
    relacionId,
    installationEmisoraId,
    installationReceptoraId,
    papel: valor.papel,
    revisionId,
    revisionOrdinal: valor.revisionOrdinal,
    versionAutoridad: valor.versionAutoridad,
    seleccion,
    huellaSeleccion: calcularSha256HexFederacion(seleccionCanonica),
    emitidaEnUtc
  });
}

function identidad(valor, tipo) {
  try {
    return String(crearIdentidadFederada({ tipo, valor }));
  } catch {
    fallar('IDENTIDAD_INTERCAMBIO_FEDERACION_INVALIDA',
      'El intercambio contiene una identidad no canónica.');
  }
}

function uuidV7(valor, campo) {
  if (typeof valor !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
        .test(valor)) {
    fallar('IDENTIDAD_INTERCAMBIO_FEDERACION_INVALIDA',
      `${campo} no es una identidad UUIDv7 canónica.`);
  }
}

function fechaUtc(valor, campo) {
  if (typeof valor !== 'string' || !Number.isFinite(Date.parse(valor)) ||
      new Date(valor).toISOString() !== valor) {
    fallar('FECHA_INTERCAMBIO_FEDERACION_INVALIDA', `${campo} debe ser UTC canónica.`);
  }
  return valor;
}

function exigirObjetoExacto(valor, claves) {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor) ||
      Object.getPrototypeOf(valor) !== Object.prototype) {
    fallar('DECLARACION_FEDERACION_JSON_INVALIDA',
      'La declaración federada debe ser un objeto JSON plano.');
  }
  const observadas = Object.keys(valor).sort();
  const esperadas = [...claves].sort();
  if (observadas.length !== esperadas.length ||
      observadas.some((clave, indice) => clave !== esperadas[indice])) {
    fallar('DECLARACION_FEDERACION_JSON_INVALIDA',
      'La declaración federada contiene campos ausentes o desconocidos.');
  }
}

function fallar(codigo, mensaje, statusCode = 400) {
  throw new ErrorIntercambioDeclaracionConcesionFederacion(
    codigo,
    mensaje,
    { statusCode }
  );
}
