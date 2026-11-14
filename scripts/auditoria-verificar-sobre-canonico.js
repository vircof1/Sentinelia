import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  PERFIL_JCS_AUDITORIA_V1
} from '../paquetes/auditoria/src/PerfilJcsAuditoria.js';
import {
  REGISTRO_CANONICALIZADORES_AUDITORIA,
  REGISTRO_ENCADENADORES_AUDITORIA,
  REGISTRO_VALIDADORES_CONTRATO_AUDITORIA,
  VERSION_ENCADENADO_AUDITORIA_V1,
  canonicalizarSobreAuditoriaV1,
  hashAuditoriaAHex,
  obtenerHashGenesisAuditoriaV1,
  prepararEventoEncadenadoAuditoriaV1,
  validarCausalidadLoteAuditoriaV1
} from '../paquetes/auditoria/src/SobreCanonicoAuditoria.js';
import {
  bytesAUuidV7Auditoria,
  generarUuidV7Auditoria,
  uuidV7AuditoriaABytes,
  validarUuidV7Auditoria
} from '../paquetes/auditoria/src/UuidV7Auditoria.js';

const rutaScript = fileURLToPath(import.meta.url);
const HASH_ANTERIOR_VECTOR = Buffer.from('11'.repeat(32), 'hex');

if (process.argv.includes('--emitir-vector')) {
  process.stdout.write(JSON.stringify(calcularVector()));
} else if (process.argv.includes('--validar-negativo')) {
  emitirRechazoIndependiente();
} else {
  main();
}

function main() {
  verificarUuidV7();
  verificarRegistrosVersionados();
  verificarVectorCongelado();
  verificarProcesosIndependientes();
  verificarProteccionCompleta();
  verificarNegativos();
  verificarGenesis();
  verificarCausalidadLote();
  console.log(
    `[auditoria] OK 5.21.3c: canonicalizador=${PERFIL_JCS_AUDITORIA_V1} encadenado=${VERSION_ENCADENADO_AUDITORIA_V1}`
  );
}

function construirSobreVector() {
  return {
    eventoId: '01890f47-7c6a-7b21-8f7a-0123456789ab',
    tipo: 'usuario.perfil_cambiado',
    versionContrato: 1,
    flujo: 'usuarios',
    claveCadena: 'usuarios:tenant:9',
    secuencia: '42',
    actorReal: { tipo: 'usuario', id: '42' },
    actorEfectivo: null,
    modoActuacion: 'directo',
    sujeto: { tipo: 'usuario', id: '7' },
    origen: 'web',
    scope: { tenantId: '9', empresaId: null, sitioId: null },
    correlacionId: '01890f47-7c6a-7b21-9f7a-0123456789ac',
    causalidad: {
      tipo: 'evento_auditoria',
      id: '01890f47-7c6a-7b21-af7a-0123456789ad'
    },
    productor: 'portal_web',
    claveOperacion: '01890f47-7c6a-7b21-bf7a-0123456789ae',
    rolEvento: 'principal',
    efectivoEnUtc: '2026-07-24T14:15:16.123Z',
    registradoEnUtc: '2026-07-24T14:15:16.456Z',
    versionCanonicalizador: PERFIL_JCS_AUDITORIA_V1,
    versionEncadenado: VERSION_ENCADENADO_AUDITORIA_V1,
    payload: {
      resultado: 'actualizado',
      camposCambiados: ['nombreMostrar'],
      antes: {},
      despues: {}
    }
  };
}

function calcularVector() {
  const preparado = prepararEventoEncadenadoAuditoriaV1(construirSobreVector(), {
    hashAnterior: HASH_ANTERIOR_VECTOR
  });
  return {
    canonico: preparado.canonico,
    hashPayload: hashAuditoriaAHex(preparado.hashPayload),
    hashAnterior: hashAuditoriaAHex(preparado.hashAnterior),
    hashActual: hashAuditoriaAHex(preparado.hashActual)
  };
}

function verificarUuidV7() {
  const vectorRfc9562 = '017f22e2-79b0-7cc3-98c4-dc0c0c07398f';
  assert.equal(validarUuidV7Auditoria(vectorRfc9562), vectorRfc9562);
  assert.equal(
    uuidV7AuditoriaABytes(vectorRfc9562).toString('hex'),
    '017f22e279b07cc398c4dc0c0c07398f'
  );
  assert.equal(bytesAUuidV7Auditoria(uuidV7AuditoriaABytes(vectorRfc9562)), vectorRfc9562);
  const generado = generarUuidV7Auditoria();
  assert.match(generado, /^[0-9a-f-]{36}$/);
  assert.equal(validarUuidV7Auditoria(generado), generado);
  assert.throws(() => validarUuidV7Auditoria('550e8400-e29b-41d4-a716-446655440000'), /UUIDv7/);
  assert.throws(() => validarUuidV7Auditoria(vectorRfc9562.toUpperCase()), /minúsculas/);
  assert.throws(() => bytesAUuidV7Auditoria(Buffer.alloc(15)), /16 bytes/);
}

function verificarRegistrosVersionados() {
  assert.deepEqual(Object.keys(REGISTRO_CANONICALIZADORES_AUDITORIA), [PERFIL_JCS_AUDITORIA_V1]);
  assert.deepEqual(Object.keys(REGISTRO_VALIDADORES_CONTRATO_AUDITORIA), ['1', '2']);
  assert.deepEqual(Object.keys(REGISTRO_ENCADENADORES_AUDITORIA), [VERSION_ENCADENADO_AUDITORIA_V1]);
}

function verificarVectorCongelado() {
  const vector = calcularVector();
  assert.equal(vector.hashAnterior, '11'.repeat(32));
  assert.equal(vector.hashPayload, '6d365e6912b815616308a9a98662d26151b0634461e9a8d6d07e6b8965d369d6');
  assert.equal(vector.hashActual, 'c82c2df658db9cf473b20943b25d96454d9e37d55e6abf183773ea6f535559a2');
  assert.equal(
    vector.canonico,
    '{"actorEfectivo":null,"actorReal":{"id":"42","tipo":"usuario"},' +
      '"causalidad":{"id":"01890f47-7c6a-7b21-af7a-0123456789ad","tipo":"evento_auditoria"},' +
      '"claveCadena":"usuarios:tenant:9","claveOperacion":"01890f47-7c6a-7b21-bf7a-0123456789ae",' +
      '"correlacionId":"01890f47-7c6a-7b21-9f7a-0123456789ac","efectivoEnUtc":"2026-07-24T14:15:16.123Z",' +
      '"eventoId":"01890f47-7c6a-7b21-8f7a-0123456789ab","flujo":"usuarios","modoActuacion":"directo",' +
      '"origen":"web","payload":{"antes":{},"camposCambiados":["nombreMostrar"],"despues":{},' +
      '"resultado":"actualizado"},"productor":"portal_web","registradoEnUtc":"2026-07-24T14:15:16.456Z",' +
      '"rolEvento":"principal","scope":{"empresaId":null,"sitioId":null,"tenantId":"9"},"secuencia":"42",' +
      '"sujeto":{"id":"7","tipo":"usuario"},"tipo":"usuario.perfil_cambiado",' +
      '"versionCanonicalizador":"sentinelia-auditoria-jcs-v1","versionContrato":1,' +
      '"versionEncadenado":"sentinelia-auditoria-sha256-v1"}'
  );
}

function verificarProcesosIndependientes() {
  const primero = ejecutarVectorEnProceso();
  const segundo = ejecutarVectorEnProceso();
  assert.deepEqual(primero, segundo);
  assert.deepEqual(primero, calcularVector());
  const rechazoPrimero = ejecutarRechazoEnProceso();
  const rechazoSegundo = ejecutarRechazoEnProceso();
  assert.equal(rechazoPrimero, rechazoSegundo);
  assert.match(rechazoPrimero, /versión del encadenado no es verificable/);
}

function verificarProteccionCompleta() {
  const base = construirSobreVector();
  const serializacion = canonicalizarSobreAuditoriaV1(base);
  assert.deepEqual(Object.keys(JSON.parse(serializacion.canonico)).sort(), [
    'actorEfectivo', 'actorReal', 'causalidad', 'claveCadena', 'claveOperacion',
    'correlacionId', 'efectivoEnUtc', 'eventoId', 'flujo', 'modoActuacion',
    'origen', 'payload', 'productor', 'registradoEnUtc', 'rolEvento', 'scope',
    'secuencia', 'sujeto', 'tipo', 'versionCanonicalizador', 'versionContrato',
    'versionEncadenado'
  ].sort());
  assert.equal(Object.hasOwn(serializacion.sobre, 'hashPayload'), false);
  assert.equal(Object.hasOwn(serializacion.sobre, 'hashAnterior'), false);
  assert.equal(Object.hasOwn(serializacion.sobre, 'hashActual'), false);
  assert.ok(Object.isFrozen(serializacion.sobre));
  assert.ok(Object.isFrozen(serializacion.sobre.payload));
  const hashBase = calcularHash(base);
  const mutaciones = [
    { ...base, eventoId: '01890f47-7c6a-7b22-8f7a-0123456789af' },
    { ...base, secuencia: '43' },
    { ...base, actorReal: { ...base.actorReal, id: '43' } },
    { ...base, sujeto: { ...base.sujeto, id: '8' } },
    { ...base, correlacionId: '01890f47-7c6a-7b22-9f7a-0123456789a0' },
    { ...base, efectivoEnUtc: '2026-07-24T14:15:17.123Z' },
    { ...base, payload: { ...base.payload, camposCambiados: ['nombreCompleto'] } }
  ];
  for (const mutacion of mutaciones) {
    assert.notEqual(calcularHash(mutacion), hashBase);
  }
  assert.notEqual(
    hashAuditoriaAHex(prepararEventoEncadenadoAuditoriaV1(base, { hashAnterior: Buffer.from('22'.repeat(32), 'hex') }).hashActual),
    hashBase
  );
}

function verificarNegativos() {
  const base = construirSobreVector();
  assert.throws(() => canonicalizarSobreAuditoriaV1({ ...base, campoAjeno: true }), /campos ausentes o desconocidos/);
  const conSimbolo = { ...base };
  conSimbolo[Symbol('ajeno')] = true;
  assert.throws(() => canonicalizarSobreAuditoriaV1(conSimbolo), /claves no representables/);
  const conAccesor = { ...base };
  Object.defineProperty(conAccesor, 'tipo', { enumerable: true, get: () => base.tipo });
  assert.throws(() => canonicalizarSobreAuditoriaV1(conAccesor), /propiedad JSON enumerable de datos/);
  assert.throws(() => canonicalizarSobreAuditoriaV1({ ...base, versionContrato: 3 }), /no es verificable/);
  assert.throws(() => canonicalizarSobreAuditoriaV1({ ...base, versionContrato: 2 }), /pertenece al contrato auditable v1/);
  assert.throws(() => canonicalizarSobreAuditoriaV1({ ...base, versionCanonicalizador: 'desconocido' }), /no es verificable/);
  assert.throws(() => canonicalizarSobreAuditoriaV1({ ...base, versionEncadenado: 'desconocido' }), /no es verificable/);
  assert.throws(() => canonicalizarSobreAuditoriaV1({ ...base, claveCadena: 'usuarios:portal' }), /contradice/);
  assert.throws(() => canonicalizarSobreAuditoriaV1({ ...base, secuencia: 42 }), /string entero/);
  assert.throws(() => canonicalizarSobreAuditoriaV1({ ...base, registradoEnUtc: '2026-07-24T14:15:16Z' }), /milisegundos/);
  assert.throws(() => canonicalizarSobreAuditoriaV1({ ...base, modoActuacion: 'directo', actorEfectivo: { tipo: 'usuario', id: '7' } }), /actorEfectivo=null/);
  assert.throws(() => canonicalizarSobreAuditoriaV1({ ...base, causalidad: { tipo: 'evento_auditoria', id: base.eventoId } }), /causarse a sí mismo/);
  assert.throws(() => canonicalizarSobreAuditoriaV1({ ...base, claveOperacion: 'ñ' }), /ASCII/);
  assert.throws(() => prepararEventoEncadenadoAuditoriaV1(base, { hashAnterior: Buffer.alloc(31) }), /32 bytes/);
}

function verificarGenesis() {
  const genesis = {
    eventoId: '01890f47-7c6a-7b21-8f7a-0123456789ab',
    tipo: 'cadena.iniciada',
    versionContrato: 1,
    flujo: 'usuarios',
    claveCadena: 'usuarios:portal',
    secuencia: '1',
    actorReal: { tipo: 'sistema', id: 'sentinelia-system' },
    actorEfectivo: null,
    modoActuacion: 'directo',
    sujeto: { tipo: 'cadena_auditoria', id: 'usuarios:portal' },
    origen: 'tarea_sistema',
    scope: { tenantId: null, empresaId: null, sitioId: null },
    correlacionId: '01890f47-7c6a-7b21-9f7a-0123456789ac',
    causalidad: null,
    productor: 'auditoria_nucleo',
    claveOperacion: 'genesis:usuarios:portal',
    rolEvento: 'principal',
    efectivoEnUtc: '2026-07-24T14:15:16.123Z',
    registradoEnUtc: '2026-07-24T14:15:16.123Z',
    versionCanonicalizador: PERFIL_JCS_AUDITORIA_V1,
    versionEncadenado: VERSION_ENCADENADO_AUDITORIA_V1,
    payload: {
      flujo: 'usuarios',
      claveCadena: 'usuarios:portal',
      scopeCadena: { tenantId: null, empresaId: null, sitioId: null },
      versiones: {
        contrato: 1,
        canonicalizador: PERFIL_JCS_AUDITORIA_V1,
        encadenado: VERSION_ENCADENADO_AUDITORIA_V1
      }
    }
  };
  const hashGenesis = obtenerHashGenesisAuditoriaV1();
  assert.equal(hashGenesis.length, 32);
  assert.equal(hashGenesis.toString('hex'), '91d7e7d394e760913551abf5fd33bbe831228dd8a3e1e6cff9d4e70a84f884a7');
  assert.doesNotThrow(() => prepararEventoEncadenadoAuditoriaV1(genesis, { hashAnterior: hashGenesis }));
  assert.throws(() => prepararEventoEncadenadoAuditoriaV1(genesis, { hashAnterior: Buffer.alloc(32) }), /hash génesis/);
  assert.throws(() => canonicalizarSobreAuditoriaV1({ ...genesis, secuencia: '2' }), /secuencia 1/);
}

function verificarCausalidadLote() {
  const a = construirSobreVector();
  const b = {
    ...construirSobreVector(),
    eventoId: a.causalidad.id,
    correlacionId: a.correlacionId,
    causalidad: null
  };
  assert.deepEqual(validarCausalidadLoteAuditoriaV1([a, b]), { total: 2 });
  const bCiclico = { ...b, causalidad: { tipo: 'evento_auditoria', id: a.eventoId } };
  assert.throws(() => validarCausalidadLoteAuditoriaV1([a, bCiclico]), /ciclo/);
}

function calcularHash(sobre) {
  return hashAuditoriaAHex(
    prepararEventoEncadenadoAuditoriaV1(sobre, { hashAnterior: HASH_ANTERIOR_VECTOR }).hashActual
  );
}

function ejecutarVectorEnProceso() {
  const resultado = spawnSync(process.execPath, [rutaScript, '--emitir-vector'], {
    encoding: 'utf8',
    env: { ...process.env }
  });
  assert.equal(resultado.status, 0, resultado.stderr);
  return JSON.parse(resultado.stdout);
}

function ejecutarRechazoEnProceso() {
  const resultado = spawnSync(process.execPath, [rutaScript, '--validar-negativo'], {
    encoding: 'utf8',
    env: { ...process.env }
  });
  assert.equal(resultado.status, 0, resultado.stderr);
  return resultado.stdout;
}

function emitirRechazoIndependiente() {
  try {
    canonicalizarSobreAuditoriaV1({
      ...construirSobreVector(),
      versionEncadenado: 'algoritmo-desconocido'
    });
    process.exitCode = 2;
  } catch (error) {
    process.stdout.write(error.message);
  }
}
