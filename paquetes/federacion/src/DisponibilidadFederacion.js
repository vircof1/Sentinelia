import {
  canonicalizarJsonFederacion,
  normalizarJsonFederacion
} from './CanonicalizadorFederacion.js';
import { FAMILIAS_FEDERACION } from './CatalogosFederacion.js';
import { esFechaUtcCanonicaFederacion } from './FechaUtcFederacion.js';
import {
  TIPOS_IDENTIDAD_FEDERADA,
  crearIdentidadFederada
} from './IdentidadFederada.js';

const TIPOS = new Set([
  'rangoDisponible',
  'huecoRecuperable',
  'huecoIrrecuperable'
]);
const CAUSAS = new Set([
  'inventarioFuente',
  'retencionEmisor',
  'saturacionRetencion',
  'ausenciaConfirmada',
  'restauracionIncoherente'
]);

export class ErrorDisponibilidadFederacion extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.name = 'ErrorDisponibilidadFederacion';
    this.codigo = codigo;
  }
}

export function validarDeclaracionDisponibilidadFederacion(entrada = {}) {
  entrada = normalizarJsonFederacion(entrada);
  exigirObjetoExacto(entrada, [
    'perfil','version','declaracionId','relacionId','flujoId','generacionId',
    'installationDeclaranteId','familia','tipo','inicioPosicion','finPosicion',
    'causa','rutasAlternativasAgotadas','declaradaEnOrigenUtc'
  ]);
  exigir(
    entrada.perfil === 'sentinelia-federacion-disponibilidad-v1' &&
      entrada.version === 1,
    'contrato_disponibilidad_incompatible',
    'La declaración no usa el contrato de disponibilidad soportado.'
  );
  const declaracion = Object.freeze({
    perfil: entrada.perfil,
    version: 1,
    declaracionId: uuidV7(entrada.declaracionId),
    relacionId: identidad(entrada.relacionId, TIPOS_IDENTIDAD_FEDERADA.RELACION),
    flujoId: identidad(entrada.flujoId, TIPOS_IDENTIDAD_FEDERADA.FLUJO),
    generacionId: identidad(
      entrada.generacionId,
      TIPOS_IDENTIDAD_FEDERADA.GENERACION
    ),
    installationDeclaranteId: identidad(
      entrada.installationDeclaranteId,
      TIPOS_IDENTIDAD_FEDERADA.INSTALACION
    ),
    familia: FAMILIAS_FEDERACION.exigir(entrada.familia, { campo: 'familia' }),
    tipo: catalogo(entrada.tipo, TIPOS, 'tipo'),
    inicioPosicion: decimalPositivo(entrada.inicioPosicion, 'inicioPosicion'),
    finPosicion: decimalPositivo(entrada.finPosicion, 'finPosicion'),
    causa: catalogo(entrada.causa, CAUSAS, 'causa'),
    rutasAlternativasAgotadas: booleano(
      entrada.rutasAlternativasAgotadas,
      'rutasAlternativasAgotadas'
    ),
    declaradaEnOrigenUtc: fechaUtc(entrada.declaradaEnOrigenUtc)
  });
  exigir(
    BigInt(declaracion.finPosicion) >= BigInt(declaracion.inicioPosicion),
    'rango_disponibilidad_invalido',
    'El final del rango no puede preceder a su inicio.'
  );
  if (declaracion.tipo === 'rangoDisponible') {
    exigir(
      declaracion.causa === 'inventarioFuente' &&
        !declaracion.rutasAlternativasAgotadas,
      'rango_disponible_incoherente',
      'Un rango disponible es inventario y no agota rutas alternativas.'
    );
  } else {
    exigir(
      declaracion.causa !== 'inventarioFuente',
      'hueco_sin_causa',
      'Un hueco exige una causa de indisponibilidad.'
    );
    exigir(
      declaracion.rutasAlternativasAgotadas ===
        (declaracion.tipo === 'huecoIrrecuperable'),
      'recuperabilidad_hueco_incoherente',
      'Solo un hueco irrecuperable puede declarar agotadas las rutas.'
    );
  }
  return declaracion;
}

export function canonicalizarDeclaracionDisponibilidadFederacion(entrada) {
  return canonicalizarJsonFederacion(
    validarDeclaracionDisponibilidadFederacion(entrada)
  );
}

function identidad(valor, tipo) {
  try {
    return String(crearIdentidadFederada({ tipo, valor: String(valor || '') }));
  } catch {
    fallar('identidad_disponibilidad_invalida', 'Una identidad de la declaración no es válida.');
  }
}

function uuidV7(valor) {
  const texto = String(valor || '').toLowerCase();
  exigir(
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(texto),
    'declaracion_id_invalida',
    'declaracionId debe ser UUIDv7 canónico.'
  );
  return texto;
}

function decimalPositivo(valor, campo) {
  const texto = String(valor ?? '');
  exigir(/^[1-9][0-9]*$/u.test(texto), 'rango_disponibilidad_invalido', `${campo} no es positivo.`);
  return texto;
}

function fechaUtc(valor) {
  const texto = String(valor || '');
  exigir(
    esFechaUtcCanonicaFederacion(texto),
    'fecha_disponibilidad_invalida',
    'La declaración exige una fecha UTC con milisegundos.'
  );
  return texto;
}

function catalogo(valor, valores, campo) {
  exigir(valores.has(valor), 'catalogo_disponibilidad_invalido', `${campo} no pertenece al contrato.`);
  return valor;
}

function booleano(valor, campo) {
  exigir(typeof valor === 'boolean', 'declaracion_disponibilidad_invalida', `${campo} debe ser booleano.`);
  return valor;
}

function exigirObjetoExacto(valor, claves) {
  exigir(
    valor && typeof valor === 'object' && !Array.isArray(valor) &&
      Object.getPrototypeOf(valor) === Object.prototype,
    'declaracion_disponibilidad_invalida',
    'La declaración debe ser un objeto JSON plano.'
  );
  const actuales = Object.keys(valor).sort();
  const esperadas = [...claves].sort();
  exigir(
    actuales.length === esperadas.length &&
      actuales.every((clave, indice) => clave === esperadas[indice]),
    'declaracion_disponibilidad_invalida',
    'La declaración contiene campos ausentes o desconocidos.'
  );
}

function exigir(condicion, codigo, mensaje) {
  if (!condicion) fallar(codigo, mensaje);
}

function fallar(codigo, mensaje) {
  throw new ErrorDisponibilidadFederacion(codigo, mensaje);
}
