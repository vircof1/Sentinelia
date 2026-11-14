import {
  construirClaveCadenaAuditoria
} from '../../auditoria/src/CatalogoAuditoria.js';
import {
  PERFIL_JCS_AUDITORIA_V1,
  canonicalizarJcsAuditoriaV1
} from '../../auditoria/src/PerfilJcsAuditoria.js';
import {
  VERSION_ENCADENADO_AUDITORIA_V1
} from '../../auditoria/src/SobreCanonicoAuditoria.js';
import { validarEventoAuditableV1 } from '../../auditoria/src/ValidadorContratoAuditoria.js';
import { validarUuidV7Auditoria } from '../../auditoria/src/UuidV7Auditoria.js';

const TIPOS_CONCESION = new Set([
  'ddns.concesion_creada',
  'ddns.concesion_revocada',
  'ddns.concesion_scope_actualizado'
]);

export function construirIntencionAuditoriaDdns({
  eventoId,
  tipo,
  actorReal,
  actorEfectivo = null,
  sujetoId,
  scope,
  correlacionId,
  causalidadIntencionId = null,
  productor,
  claveOperacion,
  rolEvento = 'principal',
  efectivoEnUtc = new Date().toISOString(),
  payload
} = {}) {
  validarUuidV7Auditoria(eventoId, 'eventoId');
  validarUuidV7Auditoria(sujetoId, 'sujetoId');
  validarUuidV7Auditoria(correlacionId, 'correlacionId');
  if (causalidadIntencionId !== null) {
    validarUuidV7Auditoria(causalidadIntencionId, 'causalidadIntencionId');
  }
  const alcance = normalizarScope(scope);
  const real = normalizarActor(actorReal, 'actorReal');
  const efectivo = normalizarActorEfectivo(real, actorEfectivo);
  const origen = origenPorActor(real.tipo);
  const intencion = {
    eventoId,
    tipo,
    versionContrato: 1,
    flujo: 'dns',
    claveCadena: construirClaveCadenaAuditoria({
      flujo: 'dns',
      tenantId: alcance.tenantId
    }),
    actorReal: real,
    actorEfectivo: efectivo,
    modoActuacion: efectivo ? 'impersonado' : 'directo',
    sujeto: {
      tipo: TIPOS_CONCESION.has(tipo) ? 'concesion_ddns' : 'intencion_ddns',
      id: sujetoId
    },
    origen,
    scope: alcance,
    correlacionId,
    causalidad: causalidadIntencionId === null
      ? null
      : { tipo: 'intencion_ddns', id: causalidadIntencionId },
    productor,
    claveOperacion: exigirTexto(claveOperacion, 'claveOperacion', 128),
    rolEvento,
    efectivoEnUtc: fechaUtc(efectivoEnUtc),
    versionCanonicalizador: PERFIL_JCS_AUDITORIA_V1,
    versionEncadenado: VERSION_ENCADENADO_AUDITORIA_V1,
    payload: construirPayloadAuditoriaDdns(payload)
  };
  validarEventoAuditableV1({
    tipo: intencion.tipo,
    versionContrato: intencion.versionContrato,
    actor: intencion.actorReal.tipo,
    origen: intencion.origen,
    sujeto: intencion.sujeto,
    flujo: intencion.flujo,
    productor: intencion.productor,
    rolEvento: intencion.rolEvento,
    payload: intencion.payload
  });
  return congelar(intencion);
}

export function construirPayloadAuditoriaDdns({
  resultado,
  tipoRegistro = null,
  modo = null,
  estadoAnterior = null,
  estadoPosterior = null,
  versionDdns = '0',
  origenIntencion = null,
  generacionDns = null,
  causa = null,
  agenteId = null,
  registroDnsId = null,
  extremo = null
} = {}) {
  return congelar({
    resultado: exigirTexto(resultado, 'resultado', 64),
    tipoRegistro: nullableTexto(tipoRegistro),
    modo: nullableTexto(modo),
    estadoAnterior: fotografiarEstado(estadoAnterior),
    estadoPosterior: fotografiarEstado(estadoPosterior),
    versionDdns: decimal(versionDdns, 'versionDdns', true),
    origenIntencion: nullableTexto(origenIntencion),
    generacionDns: generacionDns === null
      ? null
      : decimal(generacionDns, 'generacionDns', false),
    causa: nullableTexto(causa),
    agenteId: agenteId === null ? null : decimal(agenteId, 'agenteId', false),
    registroDnsId: registroDnsId === null
      ? null
      : decimal(registroDnsId, 'registroDnsId', false),
    extremo: nullableTexto(extremo)
  });
}

function normalizarActor(actor, nombre) {
  if (!actor || typeof actor !== 'object' || Array.isArray(actor)) {
    throw new TypeError(`${nombre} es obligatorio.`);
  }
  const tipo = exigirTexto(actor.tipo, `${nombre}.tipo`, 64);
  const id = exigirTexto(actor.id, `${nombre}.id`, 128);
  return Object.freeze({ tipo, id });
}

function normalizarActorEfectivo(real, efectivo) {
  if (efectivo === null ||
      (efectivo?.tipo === real.tipo && String(efectivo?.id) === real.id)) {
    return null;
  }
  return normalizarActor(efectivo, 'actorEfectivo');
}

function origenPorActor(tipo) {
  if (tipo === 'usuario') return 'web';
  if (tipo === 'agente') return 'api_agentes';
  if (tipo === 'runtime') return 'runtime';
  throw new TypeError(`El actor ${tipo} no puede originar auditoría DDNS.`);
}

function normalizarScope(scope) {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) {
    throw new TypeError('scope es obligatorio.');
  }
  const resultado = {
    tenantId: scope.tenantId === null ? null : decimal(scope.tenantId, 'scope.tenantId', false),
    empresaId: scope.empresaId === null ? null : decimal(scope.empresaId, 'scope.empresaId', false),
    sitioId: scope.sitioId === null ? null : decimal(scope.sitioId, 'scope.sitioId', false)
  };
  if (resultado.tenantId === null &&
      (resultado.empresaId !== null || resultado.sitioId !== null)) {
    throw new TypeError('Un scope portal no admite empresa ni sitio.');
  }
  if (resultado.empresaId === null && resultado.sitioId !== null) {
    throw new TypeError('Un scope de sitio exige empresa.');
  }
  return Object.freeze(resultado);
}

function fotografiarEstado(valor) {
  if (valor === null) return null;
  if (typeof valor === 'string') {
    const analizado = JSON.parse(valor);
    return canonicalizarJcsAuditoriaV1(analizado);
  }
  return canonicalizarJcsAuditoriaV1(valor);
}

function decimal(valor, nombre, admiteCero) {
  const texto = String(valor ?? '');
  if (!/^(0|[1-9][0-9]*)$/u.test(texto) || (!admiteCero && texto === '0') ||
      BigInt(texto) > 18_446_744_073_709_551_615n) {
    throw new TypeError(`${nombre} no es un BIGINT UNSIGNED canónico.`);
  }
  return texto;
}

function fechaUtc(valor) {
  if (typeof valor !== 'string' || Number.isNaN(Date.parse(valor)) ||
      new Date(valor).toISOString() !== valor) {
    throw new TypeError('efectivoEnUtc debe ser una fecha UTC canónica.');
  }
  return valor;
}

function nullableTexto(valor) {
  return valor === null ? null : exigirTexto(valor, 'valor', 128);
}

function exigirTexto(valor, nombre, maximo) {
  if (typeof valor !== 'string' || valor.length === 0 || valor.length > maximo) {
    throw new TypeError(`${nombre} debe ser un texto no vacío de hasta ${maximo} caracteres.`);
  }
  return valor;
}

function congelar(valor) {
  if (valor && typeof valor === 'object' && !Object.isFrozen(valor)) {
    Object.freeze(valor);
    for (const hijo of Object.values(valor)) congelar(hijo);
  }
  return valor;
}
