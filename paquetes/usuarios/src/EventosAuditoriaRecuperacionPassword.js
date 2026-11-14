import { PERFIL_JCS_AUDITORIA_V1 } from '../../auditoria/src/PerfilJcsAuditoria.js';
import { VERSION_ENCADENADO_AUDITORIA_V1 } from '../../auditoria/src/SobreCanonicoAuditoria.js';
import { construirClaveCadenaAuditoria } from '../../auditoria/src/CatalogoAuditoria.js';
import { validarEventoAuditableV1 } from '../../auditoria/src/ValidadorContratoAuditoria.js';
import { validarUuidV7Auditoria } from '../../auditoria/src/UuidV7Auditoria.js';

const ACTOR_SISTEMA = Object.freeze({ tipo: 'sistema', id: 'sentinelia-system' });
const SCOPE_PORTAL = Object.freeze({ tenantId: null, empresaId: null, sitioId: null });

export function construirIntencionAuditoriaEmisionRecuperacionPassword(entrada = {}) {
  validarIdentidadesPreasignadas(entrada);
  const intencion = {
    eventoId: entrada.eventoEmisionId,
    tipo: 'recuperacion_password.solicitud_emitida',
    versionContrato: 1,
    flujo: 'internet',
    claveCadena: construirClaveCadenaAuditoria({ flujo: 'internet' }),
    actorReal: ACTOR_SISTEMA,
    actorEfectivo: null,
    modoActuacion: 'directo',
    sujeto: { tipo: 'frontera_internet', id: 'portal' },
    origen: 'web',
    scope: SCOPE_PORTAL,
    correlacionId: entrada.solicitudId,
    causalidad: null,
    productor: 'recuperacion_password',
    claveOperacion: `recuperacion-password:emision:${entrada.eventoEmisionId}`,
    rolEvento: 'principal',
    efectivoEnUtc: exigirFechaUtc(entrada.efectivoEnUtc),
    versionCanonicalizador: PERFIL_JCS_AUDITORIA_V1,
    versionEncadenado: VERSION_ENCADENADO_AUDITORIA_V1,
    payload: {
      resultado: 'emitida',
      buzonCanonico: entrada.buzonCanonico,
      direccionIp: entrada.direccionIp
    }
  };
  validarIntencion(intencion);
  return congelarProfundo(intencion);
}

export function construirIntencionAuditoriaConsumoRecuperacionPassword(entrada = {}) {
  validarIdentidadesPreasignadas(entrada);
  const scope = validarScopeHistorico(entrada.scope);
  const intencion = {
    eventoId: entrada.eventoConsumoId,
    tipo: 'usuario.password_recuperado',
    versionContrato: 1,
    flujo: 'usuarios',
    claveCadena: construirClaveCadenaAuditoria({
      flujo: 'usuarios',
      tenantId: scope.tenantId
    }),
    actorReal: ACTOR_SISTEMA,
    actorEfectivo: null,
    modoActuacion: 'directo',
    sujeto: { tipo: 'usuario', id: exigirIdUsuario(entrada.usuarioId) },
    origen: 'web',
    scope,
    correlacionId: entrada.solicitudId,
    causalidad: {
      tipo: 'solicitud_recuperacion_password',
      id: entrada.solicitudId
    },
    productor: 'recuperacion_password',
    claveOperacion: `recuperacion-password:consumo:${entrada.eventoConsumoId}`,
    rolEvento: 'principal',
    efectivoEnUtc: exigirFechaUtc(entrada.efectivoEnUtc),
    versionCanonicalizador: PERFIL_JCS_AUDITORIA_V1,
    versionEncadenado: VERSION_ENCADENADO_AUDITORIA_V1,
    payload: {
      operacion: 'recuperacion',
      resultado: 'recuperada',
      causa: 'posesion_buzon_verificada'
    }
  };
  validarIntencion(intencion);
  return congelarProfundo(intencion);
}

function validarIdentidadesPreasignadas(entrada) {
  validarUuidV7Auditoria(entrada.solicitudId, 'solicitudId');
  validarUuidV7Auditoria(entrada.eventoEmisionId, 'eventoEmisionId');
  validarUuidV7Auditoria(entrada.eventoConsumoId, 'eventoConsumoId');
  exigir(
    new Set([
      entrada.solicitudId,
      entrada.eventoEmisionId,
      entrada.eventoConsumoId
    ]).size === 3,
    'solicitudId, eventoEmisionId y eventoConsumoId deben ser distintos.'
  );
}

function validarIntencion(intencion) {
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
}

function validarScopeHistorico(scope) {
  exigir(scope && typeof scope === 'object' && !Array.isArray(scope), 'scope es obligatorio.');
  exigir(
    Object.keys(scope).sort().join(',') === 'empresaId,sitioId,tenantId',
    'scope debe contener exactamente tenantId, empresaId y sitioId.'
  );
  for (const campo of ['tenantId', 'empresaId', 'sitioId']) {
    if (scope[campo] !== null) exigirIdUsuario(scope[campo], `scope.${campo}`);
  }
  exigir(
    scope.tenantId !== null || (scope.empresaId === null && scope.sitioId === null),
    'Un scope portal no admite empresa ni sitio.'
  );
  exigir(scope.empresaId !== null || scope.sitioId === null, 'Un scope de sitio exige empresa.');
  return { tenantId: scope.tenantId, empresaId: scope.empresaId, sitioId: scope.sitioId };
}

function exigirIdUsuario(valor, nombre = 'usuarioId') {
  const id = String(valor ?? '');
  exigir(/^[1-9][0-9]*$/.test(id), `${nombre} debe ser decimal canónico positivo.`);
  return id;
}

function exigirFechaUtc(valor) {
  exigir(typeof valor === 'string' && !Number.isNaN(Date.parse(valor)), 'efectivoEnUtc no es una fecha válida.');
  const fecha = new Date(valor);
  exigir(fecha.toISOString() === valor, 'efectivoEnUtc debe ser UTC canónica con milisegundos.');
  return valor;
}

function congelarProfundo(valor) {
  if (valor && typeof valor === 'object' && !Object.isFrozen(valor)) {
    Object.freeze(valor);
    for (const hijo of Object.values(valor)) congelarProfundo(hijo);
  }
  return valor;
}

function exigir(condicion, mensaje) {
  if (!condicion) throw new Error(mensaje);
}
