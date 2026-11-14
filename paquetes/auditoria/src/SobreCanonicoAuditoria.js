import { createHash, timingSafeEqual } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  ACTORES_AUDITORIA,
  CAUSALIDADES_AUDITORIA,
  VERSION_CONTRATO_AUDITORIA,
  VERSION_CONTRATO_AUDITORIA_FEDERACION,
  construirClaveCadenaAuditoria
} from './CatalogoAuditoria.js';
import {
  PERFIL_JCS_AUDITORIA_V1,
  canonicalizarJcsAuditoriaV1,
  serializarPayloadAuditoriaV1,
  validarEnteroDecimalCanonico,
  validarFechaUtcMilisegundos,
  validarIdDecimalPositivo
} from './PerfilJcsAuditoria.js';
import { validarEventoAuditableV1 } from './ValidadorContratoAuditoria.js';
import { validarUuidV7Auditoria } from './UuidV7Auditoria.js';

export const VERSION_ENCADENADO_AUDITORIA_V1 = 'sentinelia-auditoria-sha256-v1';
export const MAX_SECUENCIA_AUDITORIA = 18_446_744_073_709_551_615n;

const DOMINIO_GENESIS_V1 = Buffer.from(`${VERSION_ENCADENADO_AUDITORIA_V1}:genesis`, 'utf8');
const DOMINIO_EVENTO_V1 = Buffer.from(`${VERSION_ENCADENADO_AUDITORIA_V1}:evento`, 'utf8');
const SEPARADOR_DOMINIO = Buffer.from([0]);
const CAMPOS_SOBRE_V1 = Object.freeze([
  'eventoId',
  'tipo',
  'versionContrato',
  'flujo',
  'claveCadena',
  'secuencia',
  'actorReal',
  'actorEfectivo',
  'modoActuacion',
  'sujeto',
  'origen',
  'scope',
  'correlacionId',
  'causalidad',
  'productor',
  'claveOperacion',
  'rolEvento',
  'efectivoEnUtc',
  'registradoEnUtc',
  'versionCanonicalizador',
  'versionEncadenado',
  'payload'
]);

export const REGISTRO_CANONICALIZADORES_AUDITORIA = Object.freeze({
  [PERFIL_JCS_AUDITORIA_V1]: Object.freeze({
    canonicalizar: canonicalizarJcsAuditoriaV1,
    serializarPayload: serializarPayloadAuditoriaV1
  })
});

export const REGISTRO_VALIDADORES_CONTRATO_AUDITORIA = Object.freeze({
  [VERSION_CONTRATO_AUDITORIA]: validarEventoAuditableV1,
  [VERSION_CONTRATO_AUDITORIA_FEDERACION]: validarEventoAuditableV1
});

export function obtenerHashGenesisAuditoriaV1() {
  return sha256(DOMINIO_GENESIS_V1, SEPARADOR_DOMINIO);
}

export function construirSobreCanonicoAuditoriaV1(entrada = {}) {
  exigirObjetoPlano(entrada, 'sobre');
  exigirClavesExactas(entrada, CAMPOS_SOBRE_V1, 'sobre');
  exigir(
    REGISTRO_VALIDADORES_CONTRATO_AUDITORIA[entrada.versionContrato],
    'La versión contractual del sobre no es verificable.'
  );
  exigir(entrada.versionCanonicalizador === PERFIL_JCS_AUDITORIA_V1, 'La versión del canonicalizador no es verificable.');
  exigir(entrada.versionEncadenado === VERSION_ENCADENADO_AUDITORIA_V1, 'La versión del encadenado no es verificable.');

  validarUuidV7Auditoria(entrada.eventoId, 'eventoId');
  validarUuidV7Auditoria(entrada.correlacionId, 'correlacionId');
  validarEnteroDecimalCanonico(entrada.secuencia, {
    nombre: 'secuencia',
    positivo: true,
    maximo: MAX_SECUENCIA_AUDITORIA
  });
  validarActor(entrada.actorReal, 'actorReal');
  validarActuacion(entrada);
  validarScope(entrada.scope);
  validarCausalidad(entrada.causalidad, entrada.eventoId);
  validarClaveOperacion(entrada.claveOperacion);
  validarFechaUtcMilisegundos(entrada.efectivoEnUtc, 'efectivoEnUtc');
  validarFechaUtcMilisegundos(entrada.registradoEnUtc, 'registradoEnUtc');

  const claveEsperada = construirClaveCadenaAuditoria({
    flujo: entrada.flujo,
    tenantId: entrada.scope.tenantId
  });
  exigir(entrada.claveCadena === claveEsperada, 'claveCadena contradice el flujo o el scope histórico.');

  const validarContrato = REGISTRO_VALIDADORES_CONTRATO_AUDITORIA[entrada.versionContrato];
  exigir(validarContrato, 'No existe un validador para la versión contractual del sobre.');
  validarContrato({
    tipo: entrada.tipo,
    versionContrato: entrada.versionContrato,
    actor: entrada.actorReal.tipo,
    origen: entrada.origen,
    sujeto: entrada.sujeto,
    flujo: entrada.flujo,
    flujoCabecera: entrada.tipo === 'cadena.iniciada' ? entrada.flujo : null,
    productor: entrada.productor,
    rolEvento: entrada.rolEvento,
    payload: entrada.payload
  });
  validarScopePropioMovimiento(entrada);

  validarGenesis(entrada);
  const sobre = clonarJson(entrada);
  congelarProfundo(sobre);
  return sobre;
}

function validarScopePropioMovimiento(entrada) {
  if (!entrada.tipo.startsWith('scope.entidad_')) return;
  exigir(
    isDeepStrictEqual(entrada.payload.scopePropio, entrada.scope),
    'scopePropio debe coincidir con el scope histórico protegido por el sobre.'
  );
}

export function canonicalizarSobreAuditoriaV1(entrada) {
  const sobre = construirSobreCanonicoAuditoriaV1(entrada);
  const canonicalizador = REGISTRO_CANONICALIZADORES_AUDITORIA[sobre.versionCanonicalizador];
  exigir(canonicalizador, 'No existe un canonicalizador para la versión declarada.');
  const canonico = canonicalizador.canonicalizar(sobre);
  return Object.freeze({
    sobre,
    canonico,
    bytes: Buffer.from(canonico, 'utf8')
  });
}

export function prepararEventoEncadenadoAuditoriaV1(entrada, { hashAnterior } = {}) {
  const serializacion = canonicalizarSobreAuditoriaV1(entrada);
  const anterior = copiarHash(hashAnterior, 'hashAnterior');
  if (serializacion.sobre.tipo === 'cadena.iniciada') {
    exigir(hashesIguales(anterior, obtenerHashGenesisAuditoriaV1()), 'cadena.iniciada exige el hash génesis de su versión.');
  }
  const payload = REGISTRO_CANONICALIZADORES_AUDITORIA[
    serializacion.sobre.versionCanonicalizador
  ].serializarPayload(serializacion.sobre.payload);
  const hashPayload = sha256(payload.bytes);
  const hashActual = sha256(
    DOMINIO_EVENTO_V1,
    SEPARADOR_DOMINIO,
    anterior,
    SEPARADOR_DOMINIO,
    serializacion.bytes
  );
  return Object.freeze({
    ...serializacion,
    hashPayload,
    hashAnterior: anterior,
    hashActual
  });
}

export const REGISTRO_ENCADENADORES_AUDITORIA = Object.freeze({
  [VERSION_ENCADENADO_AUDITORIA_V1]: Object.freeze({
    obtenerHashGenesis: obtenerHashGenesisAuditoriaV1,
    prepararEvento: prepararEventoEncadenadoAuditoriaV1
  })
});

export function validarCausalidadLoteAuditoriaV1(sobres = []) {
  exigir(Array.isArray(sobres), 'El lote causal debe ser un array.');
  const eventos = new Map();
  for (const sobre of sobres) {
    validarUuidV7Auditoria(sobre?.eventoId, 'eventoId');
    exigir(!eventos.has(sobre.eventoId), 'El lote causal contiene eventoId duplicados.');
    eventos.set(sobre.eventoId, sobre);
  }
  const visitando = new Set();
  const visitados = new Set();
  function recorrer(eventoId) {
    if (visitados.has(eventoId)) return;
    exigir(!visitando.has(eventoId), 'El lote contiene un ciclo de causalidad auditable.');
    visitando.add(eventoId);
    const causa = eventos.get(eventoId)?.causalidad;
    if (causa?.tipo === 'evento_auditoria' && eventos.has(causa.id)) {
      recorrer(causa.id);
    }
    visitando.delete(eventoId);
    visitados.add(eventoId);
  }
  for (const eventoId of eventos.keys()) recorrer(eventoId);
  return Object.freeze({ total: eventos.size });
}

export function hashAuditoriaAHex(hash, nombre = 'hash') {
  return copiarHash(hash, nombre).toString('hex');
}

function validarActor(actor, nombre) {
  exigirObjetoPlano(actor, nombre);
  exigirClavesExactas(actor, ['tipo', 'id'], nombre);
  exigir(ACTORES_AUDITORIA.includes(actor.tipo), `${nombre}.tipo no pertenece al catálogo auditable.`);
  if (actor.tipo === 'usuario' || actor.tipo === 'agente') {
    validarIdDecimalPositivo(actor.id, `${nombre}.id`);
  } else if (actor.tipo === 'instancia_remota') {
    exigir(
      /^sfid1\.instalacion\.[A-Za-z0-9_-]{21}[AQgw]$/.test(actor.id),
      `${nombre}.id debe ser un installationId canónico.`
    );
  } else {
    const esperado = actor.tipo === 'runtime' ? 'sentinelia-runtime' : 'sentinelia-system';
    exigir(actor.id === esperado, `${nombre}.id debe ser ${esperado}.`);
  }
}

function validarActuacion(entrada) {
  exigir(['directo', 'impersonado'].includes(entrada.modoActuacion), 'modoActuacion no pertenece al catálogo v1.');
  if (entrada.modoActuacion === 'directo') {
    exigir(entrada.actorEfectivo === null, 'La actuación directa exige actorEfectivo=null.');
    return;
  }
  exigir(entrada.actorReal.tipo === 'usuario', 'Solo un usuario puede iniciar una actuación impersonada.');
  validarActor(entrada.actorEfectivo, 'actorEfectivo');
  exigir(entrada.actorEfectivo.tipo === 'usuario', 'El actor efectivo impersonado debe ser un usuario.');
  exigir(entrada.actorEfectivo.id !== entrada.actorReal.id, 'La impersonación exige identidades real y efectiva distintas.');
}

function validarScope(scope) {
  exigirObjetoPlano(scope, 'scope');
  exigirClavesExactas(scope, ['tenantId', 'empresaId', 'sitioId'], 'scope');
  for (const campo of ['tenantId', 'empresaId', 'sitioId']) {
    if (scope[campo] !== null) validarIdDecimalPositivo(scope[campo], `scope.${campo}`);
  }
  exigir(scope.tenantId !== null || (scope.empresaId === null && scope.sitioId === null), 'Un scope portal no admite empresa ni sitio.');
  exigir(scope.empresaId !== null || scope.sitioId === null, 'Un scope de sitio exige empresa.');
}

function validarCausalidad(causalidad, eventoId) {
  if (causalidad === null) return;
  exigirObjetoPlano(causalidad, 'causalidad');
  exigirClavesExactas(causalidad, ['tipo', 'id'], 'causalidad');
  exigir(CAUSALIDADES_AUDITORIA.includes(causalidad.tipo), 'causalidad.tipo no pertenece al catálogo v1.');
  if (
    causalidad.tipo === 'evento_auditoria' ||
    causalidad.tipo === 'operacion_sesion_agente' ||
    causalidad.tipo === 'solicitud_recuperacion_password' ||
    causalidad.tipo === 'intencion_ddns'
  ) {
    validarUuidV7Auditoria(causalidad.id, 'causalidad.id');
  } else if (causalidad.tipo === 'aviso_plataforma') {
    validarUuidV7Auditoria(causalidad.id, 'causalidad.id');
  } else if (causalidad.tipo === 'relacion_federacion') {
    validarIdentidadCausalFederada(causalidad.id, 'relacion');
  } else if (causalidad.tipo === 'ocurrencia_federacion') {
    validarIdentidadCausalFederada(causalidad.id, 'ocurrencia_origen');
  } else if (causalidad.tipo === 'entrega_federacion') {
    validarIdentidadCausalFederada(causalidad.id, 'entrega');
  } else {
    validarIdDecimalPositivo(causalidad.id, 'causalidad.id');
  }
  exigir(!(causalidad.tipo === 'evento_auditoria' && causalidad.id === eventoId), 'Un evento no puede causarse a sí mismo.');
}

function validarIdentidadCausalFederada(valor, tipo) {
  exigir(
    new RegExp(`^sfid1\\.${tipo}\\.[A-Za-z0-9_-]{21}[AQgw]$`).test(valor),
    `causalidad.id debe ser una identidad federada ${tipo} canónica.`
  );
}

function validarClaveOperacion(clave) {
  exigir(typeof clave === 'string' && clave.length > 0, 'claveOperacion debe ser un string no vacío.');
  exigir(Buffer.byteLength(clave, 'ascii') === clave.length && /^[\x00-\x7f]+$/.test(clave), 'claveOperacion debe usar exclusivamente ASCII.');
  exigir(Buffer.byteLength(clave, 'ascii') <= 128, 'claveOperacion supera 128 bytes ASCII.');
}

function validarGenesis(entrada) {
  if (entrada.tipo === 'scope.entidad_salida' || entrada.tipo === 'scope.entidad_entrada') {
    exigir(
      ['tenantId', 'empresaId', 'sitioId'].every(
        (campo) => entrada.payload.scopePropio[campo] === entrada.scope[campo]
      ),
      'El movimiento debe proteger en el sobre el mismo scopePropio de su payload.'
    );
  }
  if (entrada.tipo !== 'cadena.iniciada') return;
  exigir(entrada.secuencia === '1', 'cadena.iniciada debe ocupar la secuencia 1.');
  exigir(entrada.payload.claveCadena === entrada.claveCadena, 'La génesis debe declarar su propia clave de cadena.');
  exigir(entrada.payload.flujo === entrada.flujo, 'La génesis debe declarar su propio flujo.');
  exigir(
    ['tenantId', 'empresaId', 'sitioId'].every(
      (campo) => entrada.payload.scopeCadena[campo] === entrada.scope[campo]
    ),
    'La génesis debe declarar su propio scope.'
  );
  exigir(entrada.payload.versiones.contrato === entrada.versionContrato, 'La génesis declara otra versión contractual.');
  exigir(entrada.payload.versiones.canonicalizador === entrada.versionCanonicalizador, 'La génesis declara otro canonicalizador.');
  exigir(entrada.payload.versiones.encadenado === entrada.versionEncadenado, 'La génesis declara otro encadenado.');
}

function copiarHash(hash, nombre) {
  exigir(hash instanceof Uint8Array && hash.byteLength === 32, `${nombre} debe contener exactamente 32 bytes.`);
  return Buffer.from(hash);
}

function hashesIguales(a, b) {
  return a.length === b.length && timingSafeEqual(a, b);
}

function sha256(...partes) {
  const hash = createHash('sha256');
  for (const parte of partes) hash.update(parte);
  return hash.digest();
}

function clonarJson(valor) {
  if (valor === null || typeof valor !== 'object') return valor;
  if (Array.isArray(valor)) return valor.map(clonarJson);
  return Object.fromEntries(Object.entries(valor).map(([clave, hijo]) => [clave, clonarJson(hijo)]));
}

function congelarProfundo(valor) {
  if (valor && typeof valor === 'object' && !Object.isFrozen(valor)) {
    for (const hijo of Object.values(valor)) congelarProfundo(hijo);
    Object.freeze(valor);
  }
  return valor;
}

function exigirClavesExactas(objeto, esperadas, nombre) {
  const clavesPropias = Reflect.ownKeys(objeto);
  exigir(clavesPropias.every((clave) => typeof clave === 'string'), `${nombre} contiene claves no representables en JSON.`);
  for (const clave of clavesPropias) {
    const descriptor = Object.getOwnPropertyDescriptor(objeto, clave);
    exigir(descriptor?.enumerable === true && 'value' in descriptor, `${nombre}.${clave} debe ser una propiedad JSON enumerable de datos.`);
  }
  const actuales = clavesPropias.sort();
  const objetivo = [...esperadas].sort();
  exigir(actuales.length === objetivo.length && actuales.every((clave, indice) => clave === objetivo[indice]), `${nombre} contiene campos ausentes o desconocidos.`);
}

function exigirObjetoPlano(valor, nombre) {
  exigir(valor !== null && typeof valor === 'object' && !Array.isArray(valor) && Object.getPrototypeOf(valor) === Object.prototype, `${nombre} debe ser un objeto JSON plano.`);
}

function exigir(condicion, mensaje) {
  if (!condicion) throw new Error(mensaje);
}
