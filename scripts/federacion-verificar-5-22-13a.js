import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  ERRORES_TEMPORALES_FEDERACION,
  ERRORES_TERMINALES_FEDERACION,
  FAMILIAS_FEDERACION,
  RESULTADOS_OCURRENCIA_FEDERACION
} from '../paquetes/federacion/src/CatalogosFederacion.js';
import {
  LIMITES_DUROS_RECURSOS_FEDERACION
} from '../paquetes/federacion/src/ConfiguracionFederacion.js';

await main();

async function main() {
  const [openapi, rutas, aplicacion] = await Promise.all([
    leer('../openapi/federacion-control.v1.yaml'),
    leer('../apps/sentinelia-web/src/rutas/crearRutasApiFederacion.js'),
    leer('../apps/sentinelia-web/src/crearAplicacion.js')
  ]);

  verificarSuperficieHttp(openapi);
  verificarContratoEjecutable(openapi);
  verificarReferencias(openapi);
  verificarPublicacionAcumulativa({ rutas, aplicacion });

  console.log(
    '[federacion] OK 5.22.13a: openapi=control_y_datos ' +
    'lotes=resultados_parciales cursor=prefijo_continuo ' +
    'capacidad=dinamica errores=catalogos_ejecutables controladores=no_anticipados'
  );
}

function verificarSuperficieHttp(openapi) {
  for (const marca of [
    'title: API federada Sentinelia',
    '- name: Datos federados',
    '/api/federacion/v1/datos/capacidad:',
    'operationId: obtenerCapacidadRecepcionFederadaV1',
    '/api/federacion/v1/datos/lotes:',
    'operationId: entregarLoteFederadoV1',
    '/api/federacion/v1/datos/flujos/{flujoId}/generaciones/{generacionId}/progreso:',
    'operationId: obtenerProgresoRecepcionFederadaV1'
  ]) {
    assert.ok(openapi.includes(marca), `OpenAPI no contiene ${marca}`);
  }
  for (const ruta of [
    '/api/federacion/v1/datos/capacidad:',
    '/api/federacion/v1/datos/lotes:',
    '/api/federacion/v1/datos/flujos/{flujoId}/generaciones/{generacionId}/progreso:'
  ]) {
    const bloque = extraerBloquePath(openapi, ruta);
    assert.match(bloque, /security:\s*\n\s+- federationBearer: \[\]/u);
    assert.doesNotMatch(bloque, /security:\s*\[\]/u);
  }
  const lotes = extraerBloquePath(openapi, '/api/federacion/v1/datos/lotes:');
  assert.match(lotes, /"200":[\s\S]*FederationDataBatchResponse/u);
  assert.match(lotes, /"413":[\s\S]*DataBatchTooLarge/u);
  assert.doesNotMatch(lotes, /"201"|"202"|"429"/u);
}

function verificarContratoEjecutable(openapi) {
  for (const esquema of [
    'FederationOriginOccurrence',
    'FederationDataDelivery',
    'FederationDataBatchRequest',
    'FederationDataBatchResponse',
    'FederationDeliveryResult',
    'FederationReceiverCapacity',
    'FederationAppliedCapacity',
    'FederationReceptionProgress',
    'FederationTerminalRange',
    'FederationTerminalError',
    'FederationTemporaryError'
  ]) {
    assert.ok(
      openapi.includes(`    ${esquema}:`),
      `Falta el esquema OpenAPI ${esquema}.`
    );
  }
  const familias = extraerBloqueComponente(openapi, 'FederationFamily');
  for (const valor of FAMILIAS_FEDERACION.valores) exigirEnum(familias, valor);

  const resultados = extraerBloqueComponente(openapi, 'FederationDeliveryResult');
  for (const valor of RESULTADOS_OCURRENCIA_FEDERACION.valores) {
    exigirEnum(resultados, valor);
  }
  for (const campo of [
    'entregaId', 'posicionFlujo', 'clasificacion', 'resultado',
    'errorTerminal', 'errorTemporal', 'confirmada', 'reutilizado',
    'persistidoDurablemente'
  ]) {
    assert.match(resultados, new RegExp(`\\b${campo}:`, 'u'));
  }

  const terminales = extraerBloqueComponente(openapi, 'FederationTerminalError');
  for (const valor of ERRORES_TERMINALES_FEDERACION.valores) {
    exigirEnum(terminales, valor);
  }
  const temporales = extraerBloqueComponente(openapi, 'FederationTemporaryError');
  for (const valor of ERRORES_TEMPORALES_FEDERACION.valores) {
    exigirEnum(temporales, valor);
  }

  const capacidad = extraerBloqueComponente(openapi, 'FederationReceiverCapacity');
  assert.match(
    capacidad,
    new RegExp(`maximoOcurrenciasPorLote: \\{type: integer, minimum: 1, maximum: ${LIMITES_DUROS_RECURSOS_FEDERACION.loteMaximoOcurrencias}\\}`, 'u')
  );
  assert.match(
    capacidad,
    new RegExp(`maximoBytesPorLote: \\{type: integer, minimum: 1024, maximum: ${LIMITES_DUROS_RECURSOS_FEDERACION.loteMaximoBytes}\\}`, 'u')
  );
  assert.match(
    capacidad,
    new RegExp(`maximoBytesPorOcurrencia: \\{type: integer, minimum: 512, maximum: ${LIMITES_DUROS_RECURSOS_FEDERACION.ocurrenciaMaximaBytes}\\}`, 'u')
  );
  assert.doesNotMatch(
    capacidad,
    /versionConfiguracion/u,
    'La declaración ejecutable de capacidad no versiona por sí misma la configuración SQL.'
  );
  const versiones = extraerBloqueComponente(openapi, 'FederationFamilyVersions');
  for (const valor of FAMILIAS_FEDERACION.valores) exigirEnum(versiones, valor);
  assert.match(versiones, /additionalProperties:\s*\n\s+const: 1/u);

  const uint64 = extraerBloqueComponente(openapi, 'FederationUint64Decimal');
  const patronUint64 = obtenerPatronYaml(uint64);
  for (const valido of ['1', '9999999999999999999', '18446744073709551615']) {
    assert.match(valido, patronUint64);
  }
  for (const invalido of ['0', '01', '18446744073709551616', '99999999999999999999']) {
    assert.doesNotMatch(invalido, patronUint64);
  }

  const respuesta = extraerBloqueComponente(openapi, 'FederationDataBatchResponse');
  assert.match(respuesta, /persistidoDurablemente: \{const: true\}/u);
  assert.match(respuesta, /clase: \{enum: \[inicial, reintento, replayTerminal\]\}/u);
  assert.match(respuesta, /estado: \{enum: \[terminal, parcialTemporal\]\}/u);
  assert.match(respuesta, /FederationReceptionProgress/u);

  const progreso = extraerBloqueComponente(openapi, 'FederationReceptionProgress');
  for (const campo of [
    'posicionTerminalContigua', 'fronteraInicial', 'fronteraInicialRecorrida',
    'fronteraInicialDegradada', 'prefijoDegradado', 'version',
    'rangosTerminalesDispersos'
  ]) {
    assert.match(progreso, new RegExp(`\\b${campo}:`, 'u'));
  }
  assert.match(openapi, /Una confirmación acredita\s+persistencia SQL, no materialización/iu);
  assert.match(openapi, /prefijo continuo\s+1\.\.N/iu);
}

function verificarReferencias(openapi) {
  const declarados = new Set();
  for (const coincidencia of openapi.matchAll(/^    ([A-Za-z][A-Za-z0-9]+):\s*$/gmu)) {
    declarados.add(coincidencia[1]);
  }
  for (const coincidencia of openapi.matchAll(/#\/components\/(?:schemas|responses)\/([A-Za-z][A-Za-z0-9]+)/gu)) {
    assert.ok(
      declarados.has(coincidencia[1]),
      `La referencia OpenAPI ${coincidencia[1]} no tiene declaración.`
    );
  }
}

function verificarPublicacionAcumulativa({ rutas, aplicacion }) {
  assert.doesNotMatch(rutas, /\/api\/federacion\/v1\/datos\//u);
  assert.match(
    aplicacion,
    /sendFile\(path\.join\(__dirname, '\.\.\/\.\.\/\.\.\/openapi\/federacion-control\.v1\.yaml'\)\)/u
  );
}

function extraerBloquePath(openapi, ruta) {
  const inicio = openapi.indexOf(`  ${ruta}`);
  assert.notEqual(inicio, -1, `No existe el path ${ruta}`);
  const siguiente = openapi.indexOf('\n  /api/', inicio + ruta.length + 2);
  const componentes = openapi.indexOf('\ncomponents:', inicio);
  const fin = siguiente === -1 ? componentes : Math.min(siguiente, componentes);
  assert.ok(fin > inicio, `No se pudo cerrar el path ${ruta}`);
  return openapi.slice(inicio, fin);
}

function extraerBloqueComponente(openapi, nombre) {
  const inicio = openapi.indexOf(`    ${nombre}:`);
  assert.notEqual(inicio, -1, `No existe el componente ${nombre}`);
  const resto = openapi.slice(inicio + 4);
  const siguiente = resto.search(/^    [A-Za-z][A-Za-z0-9]+:\s*$/mu);
  return siguiente === -1 ? openapi.slice(inicio) : openapi.slice(inicio, inicio + 4 + siguiente);
}

function exigirEnum(bloque, valor) {
  assert.match(
    bloque,
    new RegExp(`(?:- |\\[|, )${escaparRegex(valor)}(?:\\]|,|\\s|$)`, 'u'),
    `OpenAPI no conserva el valor contractual ${valor}.`
  );
}

function escaparRegex(valor) {
  return valor.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function obtenerPatronYaml(bloque) {
  const coincidencia = bloque.match(/^\s+pattern: '([^']+)'\s*$/mu);
  assert.ok(coincidencia, 'El decimal uint64 debe publicar su patrón OpenAPI.');
  return new RegExp(coincidencia[1], 'u');
}

function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}
