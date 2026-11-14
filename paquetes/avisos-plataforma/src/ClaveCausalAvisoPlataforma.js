import { createHash } from 'node:crypto';

import {
  obtenerCausaAvisoPlataforma
} from './CatalogoAvisosPlataforma.js';

const CAMPOS = Object.freeze([
  'versionCatalogo',
  'tipoCodigo',
  'causaCodigo',
  'objetoTipo',
  'objetoId',
  'relacionId',
  'flujoId',
  'scope'
]);
const PATRON_CODIGO = /^[a-z][a-z0-9_]{0,63}$/;
const PATRON_ID_VISIBLE = /^[\x21-\x7e]{1,191}$/;
const MATERIAL_SFID = '[A-Za-z0-9_-]{21}[AQgw]';
const PATRON_RELACION = new RegExp(`^sfid1\\.relacion\\.${MATERIAL_SFID}$`);
const PATRON_FLUJO = new RegExp(`^sfid1\\.flujo\\.${MATERIAL_SFID}$`);

export function construirClaveCausalAvisoPlataforma(entrada = {}) {
  exigirObjetoPlano(entrada, 'clave causal');
  exigirClavesExactas(entrada, CAMPOS, 'clave causal');
  exigir(
    obtenerCausaAvisoPlataforma(entrada),
    'La pareja tipo/causa no pertenece al catálogo de avisos.'
  );
  validarCodigo(entrada.tipoCodigo, 'tipoCodigo');
  validarCodigo(entrada.causaCodigo, 'causaCodigo');
  validarCodigo(entrada.objetoTipo, 'objetoTipo');
  exigir(
    typeof entrada.objetoId === 'string' && PATRON_ID_VISIBLE.test(entrada.objetoId),
    'objetoId debe ser una identidad ASCII visible y acotada.'
  );
  validarIdFederadoOpcional(entrada.relacionId, PATRON_RELACION, 'relacionId');
  validarIdFederadoOpcional(entrada.flujoId, PATRON_FLUJO, 'flujoId');
  const scope = validarScope(entrada.scope);
  const material = JSON.stringify({
    versionCatalogo: entrada.versionCatalogo,
    tipoCodigo: entrada.tipoCodigo,
    causaCodigo: entrada.causaCodigo,
    objetoTipo: entrada.objetoTipo,
    objetoId: entrada.objetoId,
    relacionId: entrada.relacionId,
    flujoId: entrada.flujoId,
    scope
  });
  return Object.freeze({
    version: 1,
    algoritmo: 'sha256',
    material,
    hashHex: createHash('sha256').update(material, 'utf8').digest('hex')
  });
}

function validarScope(scope) {
  exigirObjetoPlano(scope, 'scope');
  exigirClavesExactas(scope, ['tenantId', 'empresaId', 'sitioId'], 'scope');
  const normalizado = {};
  for (const campo of ['tenantId', 'empresaId', 'sitioId']) {
    const valor = scope[campo];
    exigir(
      valor === null || (typeof valor === 'string' && /^[1-9][0-9]*$/.test(valor)),
      `${campo} debe ser null o un id decimal canónico positivo.`
    );
    normalizado[campo] = valor;
  }
  exigir(
    normalizado.tenantId !== null ||
      (normalizado.empresaId === null && normalizado.sitioId === null),
    'Un scope portal no admite empresa ni sitio.'
  );
  exigir(
    normalizado.empresaId !== null || normalizado.sitioId === null,
    'Un sitio exige empresa.'
  );
  return normalizado;
}

function validarCodigo(valor, nombre) {
  exigir(
    typeof valor === 'string' && PATRON_CODIGO.test(valor),
    `${nombre} no usa el formato de código cerrado.`
  );
}

function validarIdFederadoOpcional(valor, patron, nombre) {
  exigir(
    valor === null || (typeof valor === 'string' && patron.test(valor)),
    `${nombre} debe ser null o una identidad federada canónica.`
  );
}

function exigirObjetoPlano(valor, nombre) {
  exigir(
    valor !== null &&
      typeof valor === 'object' &&
      !Array.isArray(valor) &&
      Object.getPrototypeOf(valor) === Object.prototype,
    `${nombre} debe ser un objeto JSON plano.`
  );
}

function exigirClavesExactas(valor, claves, nombre) {
  const actuales = Object.keys(valor).sort();
  const esperadas = [...claves].sort();
  exigir(
    actuales.length === esperadas.length &&
      actuales.every((clave, indice) => clave === esperadas[indice]),
    `${nombre} contiene campos ausentes o desconocidos.`
  );
}

function exigir(condicion, mensaje) {
  if (!condicion) throw new Error(mensaje);
}
