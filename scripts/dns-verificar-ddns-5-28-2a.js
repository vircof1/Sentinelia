import assert from 'node:assert/strict';

import {
  ErrorValorDdnsNoInterpretable,
  canonicalizarEstadoDeseadoDdnsAgentes,
  canonicalizarIpv4Ddns,
  canonicalizarIpv6Ddns,
  canonicalizarNombreAbsolutoDdns
} from '../paquetes/dns/src/ValidadorEstadoDdnsAgentes.js';
import { ValidadorRegistroDns } from '../paquetes/dns/src/ValidadorRegistroDns.js';

verificarDirecciones();
verificarNombres();
verificarMx();
verificarFormasCerradas();
verificarAislamientoDelFormularioGeneral();

console.log(
  '[dns-ddns] OK 5.28.2a: A=canonica AAAA=canonica mapeada=ipv4 ' +
  'CNAME=canonico nombres=ascii-punycode-absolutos limites=dns ' +
  'MX=canonico null_mx=canonico ' +
  'contrato=cerrado formulario_general=inalterado'
);

function verificarDirecciones() {
  assert.equal(canonicalizarIpv4Ddns('192.0.2.8'), '192.0.2.8');
  assert.equal(canonicalizarIpv4Ddns('::ffff:192.0.2.128'), '192.0.2.128');
  assert.equal(canonicalizarIpv4Ddns('0:0:0:0:0:ffff:c000:0280'), '192.0.2.128');
  assert.equal(canonicalizarIpv6Ddns('2001:0DB8:0:0:0:0:0:1'), '2001:db8::1');
  assert.throws(() => canonicalizarIpv4Ddns('192.0.002.8'), errorValor);
  assert.throws(() => canonicalizarIpv4Ddns(' 192.0.2.8 '), errorValor);
  assert.throws(() => canonicalizarIpv6Ddns('::ffff:192.0.2.8'),
    (error) => errorValor(error) && /mapeada/u.test(error.message));
  assert.throws(() => canonicalizarIpv6Ddns('fe80::1%eth0'), errorValor);
}

function verificarNombres() {
  assert.equal(
    canonicalizarNombreAbsolutoDdns('DESTINO.Example'),
    'destino.example.'
  );
  assert.equal(
    canonicalizarNombreAbsolutoDdns('xn--bcher-kva.example.'),
    'xn--bcher-kva.example.'
  );
  assert.deepEqual(canonicalizarEstadoDeseadoDdnsAgentes({
    tipo: 'CNAME', modo: 'declarada', valor: { destino: 'DESTINO.Example' }
  }).valor, { destino: 'destino.example.' });
  assert.equal(
    canonicalizarNombreAbsolutoDdns('a'.repeat(63) + '.example'),
    'a'.repeat(63) + '.example.'
  );
  const maximo = [63, 63, 63, 61].map((longitud) => 'a'.repeat(longitud)).join('.');
  assert.equal(canonicalizarNombreAbsolutoDdns(maximo), `${maximo}.`);
  assert.throws(
    () => canonicalizarNombreAbsolutoDdns(`${'a'.repeat(64)}.example`),
    errorValor
  );
  const excesivo = [63, 63, 63, 62].map((longitud) => 'a'.repeat(longitud)).join('.');
  assert.throws(() => canonicalizarNombreAbsolutoDdns(excesivo), errorValor);
  for (const invalido of [
    'bücher.example', 'mi dominio.example', ' example.test',
    'example.test ', 'a..example', 'example..', '_srv.example', '*.example'
  ]) {
    assert.throws(() => canonicalizarNombreAbsolutoDdns(invalido), errorValor);
  }
  assert.throws(() => canonicalizarNombreAbsolutoDdns('.'), errorValor);
}

function verificarMx() {
  const normal = canonicalizarEstadoDeseadoDdnsAgentes({
    tipo: 'MX',
    modo: 'declarada',
    valor: { prioridad: 10, destino: 'MAIL.Example' }
  });
  assert.deepEqual(normal.valor, { prioridad: 10, destino: 'mail.example.' });
  const nulo = canonicalizarEstadoDeseadoDdnsAgentes({
    tipo: 'MX',
    modo: 'declarada',
    valor: { prioridad: 0, destino: '.' }
  });
  assert.deepEqual(nulo.valor, { prioridad: 0, destino: '.' });
  assert.throws(() => canonicalizarEstadoDeseadoDdnsAgentes({
    tipo: 'MX', modo: 'declarada', valor: { prioridad: 1, destino: '.' }
  }), errorValor);
  assert.throws(() => canonicalizarEstadoDeseadoDdnsAgentes({
    tipo: 'MX', modo: 'declarada', valor: { prioridad: '10', destino: 'mx.example' }
  }), errorValor);
}

function verificarFormasCerradas() {
  const observada = canonicalizarEstadoDeseadoDdnsAgentes({
    tipo: 'A', modo: 'observada', valor: null
  });
  assert.deepEqual(observada, { tipo: 'A', modo: 'observada', valor: null });
  assert.equal(Object.isFrozen(observada), true);
  assert.throws(() => canonicalizarEstadoDeseadoDdnsAgentes({
    tipo: 'CNAME', modo: 'observada', valor: null
  }), errorValor);
  assert.throws(() => canonicalizarEstadoDeseadoDdnsAgentes({
    tipo: 'A', modo: 'declarada',
    valor: { direccionIpv4: '192.0.2.1', ttl: 30 }
  }), errorValor);
  assert.throws(() => canonicalizarEstadoDeseadoDdnsAgentes({
    tipo: 'CNAME', modo: 'declarada', valor: { destino: '.' }
  }), errorValor);
}

function verificarAislamientoDelFormularioGeneral() {
  const general = new ValidadorRegistroDns();
  assert.equal(
    general.normalizarValorPrincipalPorTipo('CNAME', 'DESTINO.Example.'),
    'destino.example'
  );
  assert.throws(
    () => general.normalizarValorPrincipalPorTipo('MX', '.'),
    /host DNS válido/u
  );
  assert.deepEqual(general.normalizarDefinicionBase({
    zonaId: 1,
    hostRelativo: 'sin-correo',
    tipoRegistro: 'MX',
    valorPrincipal: '.',
    prioridad: 0
  }), {
    zonaId: 1,
    hostRelativo: 'sin-correo',
    tipoRegistro: 'MX',
    valorPrincipal: '.',
    ttlSegundos: null,
    prioridad: 0,
    peso: null,
    puerto: null,
    flags: null,
    tag: null,
    categoriaOrigen: 'normal',
    publicarEnBind: true,
    datosAuxiliares: null,
    descripcion: null,
    activo: true
  });
  assert.throws(() => general.normalizarDefinicionBase({
    zonaId: 1,
    hostRelativo: 'mx-invalido',
    tipoRegistro: 'MX',
    valorPrincipal: '.',
    prioridad: 10
  }), /Null MX exige prioridad 0/u);
}

function errorValor(error) {
  return error instanceof ErrorValorDdnsNoInterpretable &&
    error.codigo === 'valor_no_interpretable';
}
