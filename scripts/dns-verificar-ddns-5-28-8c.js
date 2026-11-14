import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  CAPACIDADES_AGENTES,
  construirCapacidadesAgentePorDefecto
} from '../paquetes/agentes/src/ConfiguracionEfectivaAgente.js';
import {
  crearSolicitudHttpDdnsAgentes
} from '../paquetes/dns/src/ContratoDdnsAgentes.js';

const rutaOpenApi = new URL('../openapi/agentes.v1.yaml', import.meta.url);
const rutaRutas = new URL(
  '../apps/sentinelia-web/src/rutas/crearRutasApiAgentes.js',
  import.meta.url
);

await main();

async function main() {
  const [openapi, rutas] = await Promise.all([
    readFile(rutaOpenApi, 'utf8'),
    readFile(rutaRutas, 'utf8')
  ]);
  verificarRutas(openapi, rutas);
  verificarEsquemasCerrados(openapi);
  verificarReferencias(openapi);
  verificarEjemplosContraContrato();
  verificarCapacidadTodaviaCerrada(openapi);
  console.log('[dns-ddns] OK 5.28.8c: openapi=rutas-esquemas-ejemplos bearer=obligatorio tipos=discriminados error=currentVersion-opcional capacidad=dynamic_dns-false compatibilidad=cliente-anterior');
}

function verificarRutas(openapi, rutas) {
  const lectura = bloquePath(openapi, '/api/agentes/v1/ddns');
  const intenciones = bloquePath(
    openapi,
    '/api/agentes/v1/ddns/{concesionId}/intenciones'
  );
  assert.match(lectura, /get:\s/u);
  assert.match(lectura, /security:\s*\n\s+- bearerAuth: \[\]/u);
  assert.match(lectura, /DdnsListResponse/u);
  assert.match(lectura, /Cache-Control:[\s\S]*?const: no-store/u);
  assert.match(intenciones, /post:\s/u);
  assert.match(intenciones, /security:\s*\n\s+- bearerAuth: \[\]/u);
  assert.match(intenciones, /DdnsIntentionRequest/u);
  assert.match(intenciones, /DdnsIntentionResponse/u);
  for (const estado of ['"200"', '"202"', '"401"', '"403"', '"404"',
    '"409"', '"422"']) {
    assert.ok(intenciones.includes(estado), `Falta la respuesta DDNS ${estado}.`);
  }
  assert.match(rutas, /router\.get\(\s*'\/api\/agentes\/v1\/ddns'/u);
  assert.match(rutas,
    /router\.post\(\s*'\/api\/agentes\/v1\/ddns\/:concesionId\/intenciones'/u);
}

function verificarEsquemasCerrados(openapi) {
  for (const nombre of [
    'DdnsIntentionRequest', 'DdnsObservedRequestState',
    'DdnsDeclaredARequestState', 'DdnsDeclaredAaaaRequestState',
    'DdnsDeclaredCnameRequestState', 'DdnsDeclaredMxRequestState',
    'DdnsAValue', 'DdnsAaaaValue', 'DdnsCnameValue', 'DdnsMxValue',
    'DdnsAState', 'DdnsAaaaState', 'DdnsCnameState', 'DdnsMxState',
    'DdnsIntentionResponse', 'DdnsListResponse', 'DdnsConcessionState',
    'DdnsRecordIdentity', 'DdnsCapabilities', 'DdnsProgress',
    'DdnsAttemptBudget', 'DdnsTimestamps', 'DdnsPagination'
  ]) {
    const bloque = bloqueSchema(openapi, nombre);
    assert.match(bloque, /additionalProperties: false/u,
      `${nombre} debe ser un objeto cerrado.`);
  }
  const deseado = bloqueSchema(openapi, 'DdnsDesiredState');
  assert.match(deseado, /discriminator:\s*\n\s+propertyName: tipo/u);
  for (const tipo of ['A', 'AAAA', 'CNAME', 'MX']) {
    assert.ok(deseado.includes(`${tipo}:`), `Falta el discriminador ${tipo}.`);
  }
  const error = bloqueSchema(openapi, 'ErrorResponse');
  assert.match(error, /currentVersion:\s*\n\s+\$ref: "#\/components\/schemas\/DdnsDecimalUint64"/u);
  const requeridos = extraerListaRequerida(error);
  assert.equal(requeridos.includes('currentVersion'), false,
    'currentVersion debe seguir siendo opcional en el sobre común.');
  assert.equal(bloqueSchema(openapi, 'DdnsIntentionRequest').includes('agenteId'), false);
}

function verificarReferencias(openapi) {
  const declarados = new Set(
    [...openapi.matchAll(/^    ([A-Za-z][A-Za-z0-9]+):\s*$/gmu)]
      .map((coincidencia) => coincidencia[1])
  );
  for (const coincidencia of openapi.matchAll(
    /\$ref: "#\/components\/schemas\/([A-Za-z][A-Za-z0-9]+)"/gu
  )) {
    assert.ok(declarados.has(coincidencia[1]),
      `Referencia OpenAPI no declarada: ${coincidencia[1]}.`);
  }
}

function verificarEjemplosContraContrato() {
  const ejemplos = [
    ['A', {
      solicitudId: '01990000-0000-7000-8000-000000000802',
      versionEsperada: '7',
      estadoDeseado: { modo: 'declarada', valor: { direccionIpv4: '203.0.113.8' } }
    }],
    ['AAAA', {
      solicitudId: '01990000-0000-7000-8000-000000000803',
      versionEsperada: '3', estadoDeseado: { modo: 'observada' }
    }],
    ['CNAME', {
      solicitudId: '01990000-0000-7000-8000-000000000804',
      versionEsperada: '1',
      estadoDeseado: { modo: 'declarada', valor: { destino: 'origin.example.net.' } }
    }],
    ['MX', {
      solicitudId: '01990000-0000-7000-8000-000000000805',
      versionEsperada: '2',
      estadoDeseado: {
        modo: 'declarada', valor: { prioridad: 10, destino: 'mail.example.net.' }
      }
    }]
  ];
  for (const [tipo, ejemplo] of ejemplos) {
    const contrato = crearSolicitudHttpDdnsAgentes(ejemplo, tipo);
    assert.equal(contrato.estadoDeseado.tipo, tipo);
    assert.equal(contrato.solicitudId, ejemplo.solicitudId);
  }
}

function verificarCapacidadTodaviaCerrada(openapi) {
  const capacidades = construirCapacidadesAgentePorDefecto();
  const dynamicDns = capacidades.find(
    ({ codigo }) => codigo === CAPACIDADES_AGENTES.DYNAMIC_DNS
  );
  assert.deepEqual(dynamicDns, {
    codigo: 'dynamic_dns',
    habilitada: false,
    descripcion: 'Reservada para fases futuras.'
  });
  const clienteAnterior = capacidades
    .filter(({ codigo }) => ['heartbeat', 'session_refresh',
      'effective_configuration'].includes(codigo))
    .map(({ codigo, habilitada }) => ({ codigo, habilitada }));
  assert.equal(clienteAnterior.length, 3,
    'Un cliente anterior debe poder ignorar capacidades desconocidas.');
  const configuracion = bloqueSchema(openapi, 'AgentEffectiveConfiguration');
  assert.equal(configuracion.includes('concesiones'), false,
    'La configuración efectiva no debe duplicar el inventario DDNS.');
  assert.match(openapi,
    /codigo: "dynamic_dns"\s*\n\s+habilitada: false/u,
    'El ejemplo de configuración debe conservar dynamic_dns cerrada.');
}

function bloquePath(openapi, ruta) {
  const cabecera = `  ${ruta}:`;
  const inicio = openapi.indexOf(cabecera);
  assert.notEqual(inicio, -1, `Falta el path ${ruta}.`);
  const resto = openapi.slice(inicio + cabecera.length);
  const siguiente = resto.search(/^  \/api\/agentes\/v1\//mu);
  return siguiente === -1 ? resto : resto.slice(0, siguiente);
}

function bloqueSchema(openapi, nombre) {
  const cabecera = `    ${nombre}:`;
  const inicio = openapi.indexOf(cabecera);
  assert.notEqual(inicio, -1, `Falta el esquema ${nombre}.`);
  const resto = openapi.slice(inicio + cabecera.length);
  const siguiente = resto.search(/^    [A-Za-z][A-Za-z0-9]+:\s*$/mu);
  return siguiente === -1 ? resto : resto.slice(0, siguiente);
}

function extraerListaRequerida(bloque) {
  const coincidencia = /required:\s*\n((?:\s+- [^\n]+\n)+)/u.exec(bloque);
  return coincidencia
    ? [...coincidencia[1].matchAll(/- ([^\s]+)/gu)].map((item) => item[1])
    : [];
}
