import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  ESTADOS_VERIFICACION_ESTRUCTURAL_AUDITORIA,
  VerificadorEstructuralAuditoria
} from '../paquetes/auditoria/src/VerificadorEstructuralAuditoria.js';
import {
  PERFIL_JCS_AUDITORIA_V1
} from '../paquetes/auditoria/src/PerfilJcsAuditoria.js';
import {
  VERSION_ENCADENADO_AUDITORIA_V1,
  obtenerHashGenesisAuditoriaV1,
  prepararEventoEncadenadoAuditoriaV1
} from '../paquetes/auditoria/src/SobreCanonicoAuditoria.js';
import {
  construirIntencionGenesisAuditoriaV1
} from '../paquetes/auditoria/src/HuellaIntencionAuditoria.js';
import { generarUuidV7Auditoria } from '../paquetes/auditoria/src/UuidV7Auditoria.js';

const rutaScript = fileURLToPath(import.meta.url);
const fixtureSolicitado = obtenerFixtureSolicitado(process.argv.slice(2));

if (fixtureSolicitado) {
  await ejecutarFixtureCli(fixtureSolicitado);
} else {
  await ejecutarVerificacionCompleta();
}

async function ejecutarVerificacionCompleta() {
  assert.deepEqual(ESTADOS_VERIFICACION_ESTRUCTURAL_AUDITORIA, [
    'integra', 'rota', 'incompleta', 'version_no_verificable'
  ]);
  const base = construirCadenaFixture();
  await verificarIntegraYRepositorio(base);
  await verificarAlteraciones(base);
  await verificarCorteYReordenacion(base);
  await verificarVersiones(base);
  verificarCodigosSalida();
  console.log(
    '[auditoria] OK 5.21.6a: genesis=si secuencia=si hashes=payload_sobre ' +
    'estados=4 posicion=exacta repositorio=puerto cli=exit_distinto'
  );
}

async function verificarIntegraYRepositorio(base) {
  let llamadas = 0;
  const verificador = crearVerificador(base, () => { llamadas += 1; });
  const resultado = await verificador.verificar({ claveCadena: base.claveCadena });
  assert.equal(llamadas, 1);
  assert.deepEqual(resultado, {
    estado: 'integra',
    claveCadena: base.claveCadena,
    eventosLeidos: 3,
    secuenciaVerificadaHasta: '3',
    hashVerificadoHasta: base.cabecera.ultimoHash.toString('hex'),
    incidencia: null
  });
  assert.equal(Object.isFrozen(resultado), true);
}

async function verificarAlteraciones(base) {
  const payload = clonarCadena(base);
  payload.eventos[1].sobre.payload.despues.nombre = 'Nombre manipulado';
  await exigirRotura(payload, 'hash_payload_incoherente', '2', '2');

  const sobre = clonarCadena(base);
  sobre.eventos[1].sobre.actorReal.id = '99';
  await exigirRotura(sobre, 'hash_actual_incoherente', '2', '2');

  const anterior = clonarCadena(base);
  anterior.eventos[2].hashAnterior = Buffer.alloc(32, 0xaa);
  await exigirRotura(anterior, 'hash_anterior_incoherente', '3', '3');

  const hashPayload = clonarCadena(base);
  hashPayload.eventos[1].hashPayload = Buffer.alloc(32, 0xbb);
  await exigirRotura(hashPayload, 'hash_payload_incoherente', '2', '2');

  const hashActual = clonarCadena(base);
  hashActual.eventos[1].hashActual = Buffer.alloc(32, 0xcc);
  await exigirRotura(hashActual, 'hash_actual_incoherente', '2', '2');

  const genesis = clonarCadena(base);
  genesis.eventos[0] = clonarEvento(genesis.eventos[1]);
  genesis.eventos[0].sobre.secuencia = '1';
  await exigirRotura(genesis, 'genesis_ausente', '1', '1');

  const cabecera = clonarCadena(base);
  cabecera.cabecera.ultimoHash = Buffer.alloc(32, 0xdd);
  await exigirRotura(cabecera, 'cabecera_incoherente', '3', '3');

  const trasplantada = clonarCadena(base);
  trasplantada.eventos[1].sobre.claveCadena = 'monitores:tenant:10';
  await exigirRotura(trasplantada, 'clave_cadena_incoherente', '2', '2');
}

async function verificarCorteYReordenacion(base) {
  const cortada = clonarCadena(base);
  cortada.eventos.pop();
  const incompleta = await crearVerificador(cortada).verificar({
    claveCadena: cortada.claveCadena
  });
  assert.equal(incompleta.estado, 'incompleta');
  assert.deepEqual(incompleta.incidencia, {
    codigo: 'fin_prematuro',
    posicion: '3',
    secuenciaEsperada: '3',
    secuenciaObservada: null
  });

  const reordenada = clonarCadena(base);
  [reordenada.eventos[1], reordenada.eventos[2]] =
    [reordenada.eventos[2], reordenada.eventos[1]];
  await exigirRotura(reordenada, 'secuencia_inesperada', '2', '2', '3');

  const hueco = clonarCadena(base);
  hueco.eventos.splice(1, 1);
  await exigirRotura(hueco, 'secuencia_inesperada', '2', '2', '3');
}

async function verificarVersiones(base) {
  for (const [campo, valor, codigo] of [
    ['versionContrato', 99, 'version_contrato_no_verificable'],
    ['versionCanonicalizador', 'canonicalizador-futuro', 'version_canonicalizador_no_verificable'],
    ['versionEncadenado', 'encadenado-futuro', 'version_encadenado_no_verificable']
  ]) {
    const cadena = clonarCadena(base);
    cadena.eventos[1].sobre[campo] = valor;
    const resultado = await crearVerificador(cadena).verificar({
      claveCadena: cadena.claveCadena
    });
    assert.equal(resultado.estado, 'version_no_verificable');
    assert.equal(resultado.incidencia.codigo, codigo);
    assert.equal(resultado.incidencia.posicion, '2');
    assert.equal(resultado.secuenciaVerificadaHasta, '1');
    assert.equal(Object.isFrozen(resultado.incidencia.versiones), true);
  }
}

function verificarCodigosSalida() {
  const integro = spawnSync(process.execPath, [rutaScript, '--fixture=integra'], {
    encoding: 'utf8', shell: false
  });
  assert.equal(integro.status, 0);
  assert.match(integro.stdout, /"estado":"integra"/);
  const alterado = spawnSync(process.execPath, [rutaScript, '--fixture=alterada'], {
    encoding: 'utf8', shell: false
  });
  assert.equal(alterado.status, 1);
  assert.match(alterado.stdout, /"estado":"rota"/);
  assert.equal(alterado.stderr, '');
}

async function ejecutarFixtureCli(nombre) {
  const cadena = construirCadenaFixture();
  if (nombre === 'alterada') {
    cadena.eventos[1].sobre.payload.despues.nombre = 'Nombre manipulado';
  } else if (nombre !== 'integra') {
    throw new Error('El fixture CLI debe ser integra o alterada.');
  }
  const resultado = await crearVerificador(cadena).verificar({
    claveCadena: cadena.claveCadena
  });
  process.stdout.write(`${JSON.stringify(resultado)}\n`);
  if (resultado.estado !== 'integra') process.exitCode = 1;
}

async function exigirRotura(cadena, codigo, posicion, esperada, observada = esperada) {
  const resultado = await crearVerificador(cadena).verificar({
    claveCadena: cadena.claveCadena
  });
  assert.equal(resultado.estado, 'rota');
  assert.equal(resultado.incidencia.codigo, codigo);
  assert.equal(resultado.incidencia.posicion, posicion);
  assert.equal(resultado.incidencia.secuenciaEsperada, esperada);
  assert.equal(resultado.incidencia.secuenciaObservada, observada);
}

function crearVerificador(cadena, alLeer = () => {}) {
  return new VerificadorEstructuralAuditoria({
    repositorio: {
      async obtenerCadenaEstructural({ claveCadena }) {
        alLeer();
        assert.equal(claveCadena, cadena.claveCadena);
        return {
          cabecera: cadena.cabecera,
          eventos: cadena.eventos
        };
      }
    }
  });
}

function construirCadenaFixture() {
  const claveCadena = 'monitores:tenant:9';
  const fecha = '2026-07-24T12:00:00.000Z';
  const genesis = construirIntencionGenesisAuditoriaV1({
    eventoId: generarUuidV7Auditoria(),
    flujo: 'monitores',
    claveCadena,
    tenantId: '9',
    origen: 'web',
    correlacionId: generarUuidV7Auditoria(),
    efectivoEnUtc: fecha
  });
  const sobres = [
    { ...genesis, secuencia: '1', registradoEnUtc: fecha },
    crearCambioMonitor({ claveCadena, fecha, secuencia: '2', monitorId: '10' }),
    crearCambioMonitor({ claveCadena, fecha, secuencia: '3', monitorId: '11' })
  ];
  let anterior = obtenerHashGenesisAuditoriaV1();
  const eventos = sobres.map((sobre) => {
    const preparado = prepararEventoEncadenadoAuditoriaV1(sobre, {
      hashAnterior: anterior
    });
    anterior = preparado.hashActual;
    return {
      sobre: JSON.parse(JSON.stringify(preparado.sobre)),
      hashPayload: Buffer.from(preparado.hashPayload),
      hashAnterior: Buffer.from(preparado.hashAnterior),
      hashActual: Buffer.from(preparado.hashActual)
    };
  });
  return {
    claveCadena,
    cabecera: {
      claveCadena,
      ultimaSecuencia: '3',
      ultimoHash: Buffer.from(anterior)
    },
    eventos
  };
}

function crearCambioMonitor({ claveCadena, fecha, secuencia, monitorId }) {
  return {
    eventoId: generarUuidV7Auditoria(),
    tipo: 'monitor.actualizado',
    versionContrato: 1,
    flujo: 'monitores',
    claveCadena,
    secuencia,
    actorReal: { tipo: 'usuario', id: '1' },
    actorEfectivo: null,
    modoActuacion: 'directo',
    sujeto: { tipo: 'monitor', id: monitorId },
    origen: 'web',
    scope: { tenantId: '9', empresaId: null, sitioId: null },
    correlacionId: generarUuidV7Auditoria(),
    causalidad: null,
    productor: 'portal_web',
    claveOperacion: generarUuidV7Auditoria(),
    rolEvento: 'principal',
    efectivoEnUtc: fecha,
    registradoEnUtc: fecha,
    versionCanonicalizador: PERFIL_JCS_AUDITORIA_V1,
    versionEncadenado: VERSION_ENCADENADO_AUDITORIA_V1,
    payload: {
      resultado: 'actualizado',
      camposCambiados: ['nombre'],
      antes: { nombre: `Monitor ${monitorId}` },
      despues: { nombre: `Monitor ${monitorId} actualizado` }
    }
  };
}

function clonarCadena(cadena) {
  return {
    claveCadena: cadena.claveCadena,
    cabecera: {
      ...cadena.cabecera,
      ultimoHash: Buffer.from(cadena.cabecera.ultimoHash)
    },
    eventos: cadena.eventos.map(clonarEvento)
  };
}

function clonarEvento(evento) {
  return {
    sobre: JSON.parse(JSON.stringify(evento.sobre)),
    hashPayload: Buffer.from(evento.hashPayload),
    hashAnterior: Buffer.from(evento.hashAnterior),
    hashActual: Buffer.from(evento.hashActual)
  };
}

function obtenerFixtureSolicitado(argumentos) {
  const opciones = argumentos.filter((argumento) => argumento.startsWith('--fixture='));
  if (opciones.length > 1 || argumentos.length !== opciones.length) {
    throw new Error('Uso: auditoria-verificar-estructura [--fixture=integra|alterada]');
  }
  return opciones[0]?.slice('--fixture='.length) || null;
}
