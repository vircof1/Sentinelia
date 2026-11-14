import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { generarUuidV7Auditoria } from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import {
  CONDICIONES_OPERATIVAS_DDNS_AGENTES,
  ERRORES_DDNS_AGENTES,
  HITOS_DDNS_AGENTES,
  MODOS_DDNS_AGENTES,
  PERFIL_CONTRATO_DDNS_AGENTES,
  PERFILES_DDNS_AGENTES,
  PROPIEDADES_CONTRATO_DDNS_AGENTES,
  RESULTADOS_INTENCION_DDNS_AGENTES,
  TERMINALES_INTENCION_DDNS_AGENTES,
  TIPOS_REGISTRO_DDNS_AGENTES,
  VERSION_CONTRATO_DDNS_AGENTES,
  crearEstadoDeseadoDdnsAgentes,
  crearIdentidadConcesionDdnsAgentes,
  crearResultadoDdnsAgentes,
  crearSolicitudDdnsAgentes,
  deserializarCanonicoDdnsAgentes,
  exigirDecimalBigintUnsignedDdnsAgentes,
  serializarCanonicoDdnsAgentes
} from '../paquetes/dns/src/ContratoDdnsAgentes.js';

verificarCatalogos();
verificarIdentidadesPublicas();
verificarFormasDeValor();
verificarResultados();
verificarDecimalesSinPerdida();
verificarRoundTripCanonico();
verificarContratoCerrado();
await verificarPureza();

console.log(
  '[dns-ddns] OK 5.28.0a: contrato=ddns_agentes@1 tipos=4 modos=2 ' +
  'hitos=3 errores=5 bigint=decimal identidades=publicas pureza=verificada'
);

function baseEstado(tipo, modo, valor) {
  return {
    perfil: PERFILES_DDNS_AGENTES.ESTADO_DESEADO,
    versionContrato: VERSION_CONTRATO_DDNS_AGENTES,
    tipo,
    modo,
    valor
  };
}

function verificarCatalogos() {
  assert.equal(PERFIL_CONTRATO_DDNS_AGENTES, 'ddns_agentes@1');
  assert.equal(VERSION_CONTRATO_DDNS_AGENTES, 1);
  assert.deepEqual(TIPOS_REGISTRO_DDNS_AGENTES, ['A', 'AAAA', 'CNAME', 'MX']);
  assert.deepEqual(Object.values(MODOS_DDNS_AGENTES), ['observada', 'declarada']);
  assert.deepEqual(HITOS_DDNS_AGENTES, [
    'intencion_aceptada', 'contenido_deseado_persistido', 'contenido_publicado'
  ]);
  assert.equal(CONDICIONES_OPERATIVAS_DDNS_AGENTES.length, 7);
  assert.deepEqual(TERMINALES_INTENCION_DDNS_AGENTES, [
    'publicada', 'sustituida', 'publicacion_fallida',
    'objetivo_incompatible', 'objetivo_eliminado'
  ]);
  assert.deepEqual(RESULTADOS_INTENCION_DDNS_AGENTES, [
    'aceptada', 'repetida', 'convergente', 'sin_cambios', 'rechazada'
  ]);
  assert.deepEqual(ERRORES_DDNS_AGENTES, [
    'sin_autoridad', 'valor_no_interpretable', 'version_obsoleta',
    'idempotencia_conflictiva', 'registro_no_operable'
  ]);
  for (const catalogo of [
    TIPOS_REGISTRO_DDNS_AGENTES, MODOS_DDNS_AGENTES, HITOS_DDNS_AGENTES,
    CONDICIONES_OPERATIVAS_DDNS_AGENTES, TERMINALES_INTENCION_DDNS_AGENTES,
    RESULTADOS_INTENCION_DDNS_AGENTES, ERRORES_DDNS_AGENTES,
    PROPIEDADES_CONTRATO_DDNS_AGENTES, PERFILES_DDNS_AGENTES
  ]) assert.equal(Object.isFrozen(catalogo), true);
}

function verificarIdentidadesPublicas() {
  const concesionId = generarUuidV7Auditoria();
  const concesion = crearIdentidadConcesionDdnsAgentes({
    perfil: PERFILES_DDNS_AGENTES.CONCESION,
    versionContrato: 1,
    concesionId
  });
  assert.deepEqual(Object.keys(concesion), ['perfil', 'versionContrato', 'concesionId']);
  assert.equal('registroDnsId' in concesion, false);
  assert.equal('agenteId' in concesion, false);
  assert.equal(Object.isFrozen(concesion), true);
  assert.throws(() => crearIdentidadConcesionDdnsAgentes({
    ...concesion,
    registroDnsId: '9'
  }), /exige exactamente/iu);
  assert.throws(() => crearIdentidadConcesionDdnsAgentes({
    ...concesion,
    concesionId: '550e8400-e29b-41d4-a716-446655440000'
  }), /UUIDv7/iu);
}

function verificarFormasDeValor() {
  const estados = [
    baseEstado('A', 'observada', null),
    baseEstado('AAAA', 'observada', null),
    baseEstado('A', 'declarada', { direccionIpv4: '203.0.113.8' }),
    baseEstado('AAAA', 'declarada', { direccionIpv6: '2001:db8::8' }),
    baseEstado('CNAME', 'declarada', { destino: 'destino.example.' }),
    baseEstado('MX', 'declarada', { prioridad: 10, destino: 'mail.example.' }),
    baseEstado('MX', 'declarada', { prioridad: 0, destino: '.' })
  ].map(crearEstadoDeseadoDdnsAgentes);
  assert.equal(estados.every(Object.isFrozen), true);
  assert.equal(Object.isFrozen(estados[2].valor), true);
  assert.throws(() => crearEstadoDeseadoDdnsAgentes(
    baseEstado('TXT', 'declarada', { texto: 'no' })
  ), /catálogo cerrado/iu);
  assert.throws(() => crearEstadoDeseadoDdnsAgentes(
    baseEstado('CNAME', 'observada', null)
  ), /solo admite/iu);
  assert.throws(() => crearEstadoDeseadoDdnsAgentes(
    baseEstado('A', 'observada', { direccionIpv4: '203.0.113.8' })
  ), /no admite/iu);
  assert.throws(() => crearEstadoDeseadoDdnsAgentes(
    baseEstado('A', 'declarada', { direccionIpv4: '2001:db8::1' })
  ), /IPv4/iu);
  assert.throws(() => crearEstadoDeseadoDdnsAgentes(
    baseEstado('AAAA', 'declarada', { direccionIpv6: '::ffff:192.0.2.1' })
  ), /mapeada/iu);
  assert.equal(
    crearEstadoDeseadoDdnsAgentes(
      baseEstado('CNAME', 'declarada', { destino: 'NO-CANONICO.example.' })
    ).valor.destino,
    'no-canonico.example.'
  );
  assert.throws(() => crearEstadoDeseadoDdnsAgentes(
    baseEstado('MX', 'declarada', { prioridad: 10, destino: '.' })
  ), /Null MX/iu);
}

function verificarResultados() {
  const resultado = crearResultadoDdnsAgentes({
    perfil: PERFILES_DDNS_AGENTES.RESULTADO,
    versionContrato: 1,
    resultado: 'aceptada',
    version: '18446744073709551615',
    hito: 'contenido_deseado_persistido',
    condicion: 'operativa',
    terminal: null,
    error: null
  });
  assert.equal(resultado.version, '18446744073709551615');
  assert.throws(() => crearResultadoDdnsAgentes({
    ...resultado,
    resultado: 'rechazada'
  }), /posee un error/iu);
  const rechazo = crearResultadoDdnsAgentes({
    ...resultado,
    resultado: 'rechazada',
    hito: null,
    condicion: null,
    terminal: null,
    error: 'sin_autoridad'
  });
  assert.equal(rechazo.error, 'sin_autoridad');
}

function verificarDecimalesSinPerdida() {
  const maximo = '18446744073709551615';
  assert.equal(exigirDecimalBigintUnsignedDdnsAgentes(0n), '0');
  assert.equal(exigirDecimalBigintUnsignedDdnsAgentes(maximo), maximo);
  assert.throws(() => exigirDecimalBigintUnsignedDdnsAgentes(Number.MAX_SAFE_INTEGER), /decimal canónico/iu);
  assert.throws(() => exigirDecimalBigintUnsignedDdnsAgentes('01'), /decimal canónico/iu);
  assert.throws(() => exigirDecimalBigintUnsignedDdnsAgentes('18446744073709551616'), /supera/iu);
}

function verificarRoundTripCanonico() {
  const solicitud = crearSolicitudDdnsAgentes({
    perfil: PERFILES_DDNS_AGENTES.SOLICITUD,
    versionContrato: 1,
    solicitudId: generarUuidV7Auditoria(),
    versionEsperada: '18446744073709551615',
    estadoDeseado: baseEstado('MX', 'declarada', {
      prioridad: 20,
      destino: 'correo.example.'
    })
  });
  const texto = serializarCanonicoDdnsAgentes(solicitud);
  const recuperada = deserializarCanonicoDdnsAgentes(texto);
  assert.deepEqual(recuperada, solicitud);
  assert.equal(Object.isFrozen(recuperada), true);
  assert.equal(Object.isFrozen(recuperada.estadoDeseado), true);
  assert.equal(serializarCanonicoDdnsAgentes(recuperada), texto);
  assert.match(texto, /"versionEsperada":"18446744073709551615"/u);
}

function verificarContratoCerrado() {
  const estado = crearEstadoDeseadoDdnsAgentes(
    baseEstado('A', 'declarada', { direccionIpv4: '192.0.2.8' })
  );
  assert.throws(() => crearEstadoDeseadoDdnsAgentes({ ...estado, ttl: 30 }), /exige exactamente/iu);
  const conAccessor = { ...estado };
  Object.defineProperty(conAccessor, 'modo', { enumerable: true, get: () => 'declarada' });
  assert.throws(() => crearEstadoDeseadoDdnsAgentes(conAccessor), /accessors/iu);
  assert.throws(() => deserializarCanonicoDdnsAgentes('{'), /JSON válido/iu);
}

async function verificarPureza() {
  const fuente = await readFile(
    new URL('../paquetes/dns/src/ContratoDdnsAgentes.js', import.meta.url),
    'utf8'
  );
  assert.doesNotMatch(fuente, /\b(?:SELECT|INSERT|UPDATE|DELETE)\b|redis|express|BIND|rndc/iu);
  assert.doesNotMatch(fuente, /Date\.now|new Date|fetch\s*\(/u);
}
