import {
  ESTADOS_FLUJO_FEDERACION,
  ESTADOS_GENERACION_FEDERACION,
  FAMILIAS_FEDERACION,
  NIVELES_SCOPE_FEDERACION,
  VERSIONES_FAMILIA_FEDERACION
} from './CatalogosFederacion.js';
import {
  TIPOS_IDENTIDAD_FEDERADA,
  crearIdentidadFederada
} from './IdentidadFederada.js';

export const CLASES_GENERACION_FEDERACION = Object.freeze([
  'inicial',
  'resincronizacion',
  'reconstruccion'
]);

const TRANSICIONES_GENERACION = Object.freeze({
  preparada: new Set(['transfiriendo', 'cancelada']),
  transfiriendo: new Set([
    'fronteraOperativaValidada',
    'completa',
    'degradada',
    'cancelada'
  ]),
  fronteraOperativaValidada: new Set([
    'completa',
    'degradada',
    'cancelada',
    'sustituida'
  ]),
  completa: new Set(['degradada', 'cancelada', 'sustituida']),
  degradada: new Set([
    'transfiriendo',
    'fronteraOperativaValidada',
    'completa',
    'cancelada',
    'sustituida'
  ]),
  cancelada: new Set(),
  sustituida: new Set()
});

export class ErrorFlujoFederacion extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.name = 'ErrorFlujoFederacion';
    this.codigo = codigo;
  }
}

export function crearDefinicionFlujoFederacion({
  flujoId,
  relacionId,
  direccion,
  familia,
  versionFamilia = null,
  contexto
} = {}) {
  return Object.freeze({
    flujoId: identidad(flujoId, TIPOS_IDENTIDAD_FEDERADA.FLUJO, 'flujoId'),
    relacionId: identidad(
      relacionId,
      TIPOS_IDENTIDAD_FEDERADA.RELACION,
      'relacionId'
    ),
    direccion: exigirTextoCatalogo(direccion, ['emision', 'recepcion'], 'direccion'),
    familia: FAMILIAS_FEDERACION.exigir(familia, { campo: 'familia' }),
    versionFamilia: enteroPositivo(
      versionFamilia ?? VERSIONES_FAMILIA_FEDERACION[familia],
      'versionFamilia'
    ),
    contexto: normalizarContextoFlujoFederacion(contexto)
  });
}

export function crearDefinicionGeneracionFederacion({
  generacionId,
  clase,
  fronteraInicial,
  propietario
} = {}) {
  return Object.freeze({
    generacionId: identidad(
      generacionId,
      TIPOS_IDENTIDAD_FEDERADA.GENERACION,
      'generacionId'
    ),
    clase: exigirTextoCatalogo(clase, CLASES_GENERACION_FEDERACION, 'clase'),
    fronteraInicial: enteroNoNegativo(fronteraInicial, 'fronteraInicial'),
    propietario: crearPropietarioEmisorFederacion(propietario)
  });
}

export function crearPropietarioEmisorFederacion({
  installationId,
  bootId,
  version = 1
} = {}) {
  return Object.freeze({
    installationId: identidad(
      installationId,
      TIPOS_IDENTIDAD_FEDERADA.INSTALACION,
      'installationId'
    ),
    bootId: identidad(bootId, TIPOS_IDENTIDAD_FEDERADA.ARRANQUE, 'bootId'),
    version: enteroPositivo(version, 'versionPropietario')
  });
}

export function normalizarContextoFlujoFederacion(contexto = {}) {
  const tenantId = decimalNullable(contexto.tenantId, 'contexto.tenantId');
  const empresaId = decimalNullable(contexto.empresaId, 'contexto.empresaId');
  const sitioId = decimalNullable(contexto.sitioId, 'contexto.sitioId');
  const nivel = contexto.nivel ?? inferirNivel({ tenantId, empresaId, sitioId });
  NIVELES_SCOPE_FEDERACION.exigir(nivel, { campo: 'contexto.nivel' });
  const esperado = inferirNivel({ tenantId, empresaId, sitioId });
  if (nivel !== esperado) {
    throw new ErrorFlujoFederacion(
      'contexto_incoherente',
      `El contexto ${nivel} no coincide con sus identidades organizativas.`
    );
  }
  return Object.freeze({ nivel, tenantId, empresaId, sitioId });
}

export function exigirTransicionGeneracionFederacion(actual, siguiente) {
  ESTADOS_GENERACION_FEDERACION.exigir(actual, { campo: 'estadoActual' });
  ESTADOS_GENERACION_FEDERACION.exigir(siguiente, { campo: 'estadoSiguiente' });
  if (!TRANSICIONES_GENERACION[actual].has(siguiente)) {
    throw new ErrorFlujoFederacion(
      'transicion_generacion_invalida',
      `La generación no puede transicionar de ${actual} a ${siguiente}.`
    );
  }
  return siguiente;
}

export function exigirEstadoFlujoFederacion(estado) {
  return ESTADOS_FLUJO_FEDERACION.exigir(estado, { campo: 'estadoFlujo' });
}

function identidad(valor, tipo, campo) {
  try {
    return String(crearIdentidadFederada({ tipo, valor: String(valor || '') }));
  } catch (error) {
    throw new ErrorFlujoFederacion(
      'identidad_invalida',
      `${campo} no es una identidad federada canónica: ${error.message}`
    );
  }
}

function inferirNivel({ tenantId, empresaId, sitioId }) {
  if (tenantId === null && empresaId === null && sitioId === null) return 'portal';
  if (tenantId !== null && empresaId === null && sitioId === null) return 'tenant';
  if (tenantId !== null && empresaId !== null && sitioId === null) return 'empresa';
  if (tenantId !== null && empresaId !== null && sitioId !== null) return 'sitio';
  throw new ErrorFlujoFederacion(
    'contexto_incoherente',
    'El contexto organizativo debe respetar la jerarquía portal/tenant/empresa/sitio.'
  );
}

function decimalNullable(valor, campo) {
  if (valor === null || valor === undefined || valor === '') return null;
  if (!/^[1-9][0-9]*$/u.test(String(valor))) {
    throw new ErrorFlujoFederacion('contexto_invalido', `${campo} no es válido.`);
  }
  return String(valor);
}

function enteroPositivo(valor, campo) {
  if (!Number.isSafeInteger(Number(valor)) || Number(valor) < 1) {
    throw new ErrorFlujoFederacion('version_invalida', `${campo} debe ser positivo.`);
  }
  return Number(valor);
}

function enteroNoNegativo(valor, campo) {
  const texto = String(valor ?? '');
  if (!/^(0|[1-9][0-9]*)$/u.test(texto) ||
      BigInt(texto) > 18446744073709551615n) {
    throw new ErrorFlujoFederacion(
      'posicion_invalida',
      `${campo} debe ser un entero decimal no negativo dentro del rango durable.`
    );
  }
  return texto;
}

function exigirTextoCatalogo(valor, admitidos, campo) {
  if (!admitidos.includes(valor)) {
    throw new ErrorFlujoFederacion(
      'valor_no_admitido',
      `${campo} no pertenece al contrato cerrado.`
    );
  }
  return valor;
}
