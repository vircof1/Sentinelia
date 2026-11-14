import { VERSIONES_FAMILIA_FEDERACION, FAMILIAS_FEDERACION }
  from './CatalogosFederacion.js';
import { normalizarContextoFlujoFederacion } from './FlujoFederacion.js';
import { TIPOS_IDENTIDAD_FEDERADA, crearIdentidadFederada }
  from './IdentidadFederada.js';

export const PERFIL_MANIFIESTO_FLUJO_INICIAL_FEDERACION =
  'sentinelia-federacion-manifiesto-flujo-inicial-v1';
export const VERSION_MANIFIESTO_FLUJO_INICIAL_FEDERACION = 1;

export function crearManifiestoFlujoInicialFederacion(entrada = {}) {
  exigirObjetoExacto(entrada, [
    'aceptacionId', 'familia', 'flujoId', 'fronteraInicial', 'generacionId',
    'installationEmisoraId', 'bootEmisorId', 'ofertaId', 'perfil',
    'relacionId', 'scopeOrigenDeclarado', 'version', 'versionFamilia'
  ]);
  if (entrada.perfil !== PERFIL_MANIFIESTO_FLUJO_INICIAL_FEDERACION ||
      entrada.version !== VERSION_MANIFIESTO_FLUJO_INICIAL_FEDERACION) {
    const error = new Error('El manifiesto de flujo inicial es incompatible.');
    error.codigo = 'MANIFIESTO_FLUJO_INICIAL_INCOMPATIBLE';
    error.statusCode = 409;
    throw error;
  }
  const familia = FAMILIAS_FEDERACION.exigir(entrada.familia, { campo: 'familia' });
  if (entrada.versionFamilia !== VERSIONES_FAMILIA_FEDERACION[familia]) {
    const error = new Error('La versión contractual de la familia es incompatible.');
    error.codigo = 'VERSION_FAMILIA_FEDERACION_INCOMPATIBLE';
    error.statusCode = 409;
    throw error;
  }
  return Object.freeze({
    perfil: entrada.perfil,
    version: entrada.version,
    relacionId: identidad(entrada.relacionId, TIPOS_IDENTIDAD_FEDERADA.RELACION),
    ofertaId: identidad(entrada.ofertaId, TIPOS_IDENTIDAD_FEDERADA.REVISION_CONCESION),
    aceptacionId: identidad(
      entrada.aceptacionId, TIPOS_IDENTIDAD_FEDERADA.REVISION_CONCESION
    ),
    familia,
    versionFamilia: entrada.versionFamilia,
    scopeOrigenDeclarado: scopeOrigen(entrada.scopeOrigenDeclarado),
    flujoId: identidad(entrada.flujoId, TIPOS_IDENTIDAD_FEDERADA.FLUJO),
    generacionId: identidad(entrada.generacionId, TIPOS_IDENTIDAD_FEDERADA.GENERACION),
    installationEmisoraId: identidad(
      entrada.installationEmisoraId, TIPOS_IDENTIDAD_FEDERADA.INSTALACION
    ),
    bootEmisorId: identidad(entrada.bootEmisorId, TIPOS_IDENTIDAD_FEDERADA.ARRANQUE),
    fronteraInicial: enteroNoNegativo(entrada.fronteraInicial)
  });
}

function identidad(valor, tipo) {
  try { return String(crearIdentidadFederada({ tipo, valor })); } catch (error) {
    error.statusCode = 400;
    throw error;
  }
}

function enteroNoNegativo(valor) {
  if (!/^(0|[1-9][0-9]*)$/u.test(String(valor)) ||
      BigInt(String(valor)) > 18446744073709551615n) {
    const error = new Error('fronteraInicial debe ser un entero no negativo.');
    error.statusCode = 400;
    throw error;
  }
  return String(valor);
}

function scopeOrigen(valor) {
  let scope;
  try { scope = normalizarContextoFlujoFederacion(valor); } catch (error) {
    error.statusCode = 400;
    throw error;
  }
  for (const id of [scope.tenantId, scope.empresaId, scope.sitioId]) {
    if (id !== null && BigInt(id) > 18446744073709551615n) {
      const error = new Error('El scope de origen excede el rango contractual.');
      error.codigo = 'SCOPE_ORIGEN_MANIFIESTO_INVALIDO';
      error.statusCode = 400;
      throw error;
    }
  }
  return scope;
}

function exigirObjetoExacto(valor, claves) {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor) ||
      Object.getPrototypeOf(valor) !== Object.prototype ||
      Object.keys(valor).sort().join('|') !== [...claves].sort().join('|')) {
    const error = new Error('El manifiesto contiene campos ausentes o desconocidos.');
    error.codigo = 'MANIFIESTO_FLUJO_INICIAL_INVALIDO';
    error.statusCode = 400;
    throw error;
  }
}
