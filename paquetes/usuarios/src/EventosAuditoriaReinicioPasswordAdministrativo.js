import {
  PERFIL_JCS_AUDITORIA_V1
} from '../../auditoria/src/PerfilJcsAuditoria.js';
import {
  VERSION_ENCADENADO_AUDITORIA_V1
} from '../../auditoria/src/SobreCanonicoAuditoria.js';
import {
  construirClaveCadenaAuditoria
} from '../../auditoria/src/CatalogoAuditoria.js';
import {
  validarEventoAuditableV1
} from '../../auditoria/src/ValidadorContratoAuditoria.js';
import {
  validarUuidV7Auditoria
} from '../../auditoria/src/UuidV7Auditoria.js';
import {
  CAUSAS_AUDITORIA_REINICIO_PASSWORD_ADMINISTRATIVO,
  VIAS_REINICIO_PASSWORD_ADMINISTRATIVO
} from './ContratoReinicioPasswordAdministrativo.js';

const CLAVES_ENTRADA = Object.freeze([
  'contextoUsuarioActual',
  'efectivoEnUtc',
  'eventoId',
  'reinicioId',
  'scope',
  'usuarioId',
  'via'
]);

export function construirIntencionAuditoriaReinicioPasswordAdministrativo(
  entrada = {}
) {
  exigirClavesExactas(entrada);
  const eventoId = validarUuidV7Auditoria(entrada.eventoId, 'eventoId');
  const reinicioId = validarUuidV7Auditoria(
    entrada.reinicioId,
    'reinicioId'
  );
  const usuarioId = idDecimal(entrada.usuarioId, 'usuarioId');
  const scope = normalizarScope(entrada.scope);
  const actores = resolverActores(entrada.contextoUsuarioActual);
  const causa = resolverCausa(entrada.via);
  const intencion = {
    eventoId,
    tipo: 'usuario.password_reiniciado',
    versionContrato: 1,
    flujo: 'usuarios',
    claveCadena: construirClaveCadenaAuditoria({
      flujo: 'usuarios',
      tenantId: scope.tenantId
    }),
    actorReal: actores.real,
    actorEfectivo: actores.efectivo,
    modoActuacion: actores.modo,
    sujeto: { tipo: 'usuario', id: usuarioId },
    origen: 'web',
    scope,
    correlacionId: reinicioId,
    causalidad: null,
    productor: 'portal_web',
    claveOperacion: `reinicio-password-administrativo:${eventoId}`,
    rolEvento: 'principal',
    efectivoEnUtc: fechaUtc(entrada.efectivoEnUtc),
    versionCanonicalizador: PERFIL_JCS_AUDITORIA_V1,
    versionEncadenado: VERSION_ENCADENADO_AUDITORIA_V1,
    payload: {
      operacion: 'reinicio',
      resultado: 'reiniciada',
      causa
    }
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
  return congelarProfundo(intencion);
}

function resolverCausa(via) {
  if (via === VIAS_REINICIO_PASSWORD_ADMINISTRATIVO.CORREO) {
    return CAUSAS_AUDITORIA_REINICIO_PASSWORD_ADMINISTRATIVO.CORREO;
  }
  if (via === VIAS_REINICIO_PASSWORD_ADMINISTRATIVO.MANUAL) {
    return CAUSAS_AUDITORIA_REINICIO_PASSWORD_ADMINISTRATIVO.MANUAL;
  }
  throw new Error('La vía del reinicio administrativo no es válida.');
}

function resolverActores(contexto) {
  exigir(
    contexto && typeof contexto === 'object' && !Array.isArray(contexto),
    'contextoUsuarioActual es obligatorio.'
  );
  const idEfectivo = idDecimal(contexto.idUsuario, 'contexto.idUsuario');
  const impersonacion = contexto.impersonacionActiva === true;
  const idReal = impersonacion
    ? idDecimal(contexto.idUsuarioReal, 'contexto.idUsuarioReal')
    : idEfectivo;
  return {
    real: { tipo: 'usuario', id: idReal },
    efectivo: impersonacion ? { tipo: 'usuario', id: idEfectivo } : null,
    modo: impersonacion ? 'impersonado' : 'directo'
  };
}

function normalizarScope(scope) {
  exigir(
    scope && typeof scope === 'object' && !Array.isArray(scope),
    'scope es obligatorio.'
  );
  exigir(
    Object.keys(scope).sort().join(',') === 'empresaId,sitioId,tenantId',
    'scope debe contener exactamente tenantId, empresaId y sitioId.'
  );
  const resultado = {};
  for (const campo of ['tenantId', 'empresaId', 'sitioId']) {
    resultado[campo] = scope[campo] === null
      ? null
      : idDecimal(scope[campo], `scope.${campo}`);
  }
  exigir(
    resultado.tenantId !== null ||
      (resultado.empresaId === null && resultado.sitioId === null),
    'Un scope portal no admite empresa ni sitio.'
  );
  exigir(
    resultado.empresaId !== null || resultado.sitioId === null,
    'Un scope de sitio exige empresa.'
  );
  return resultado;
}

function exigirClavesExactas(entrada) {
  exigir(
    entrada && typeof entrada === 'object' && !Array.isArray(entrada),
    'La intención auditable debe ser un objeto.'
  );
  const recibidas = Object.keys(entrada).sort();
  exigir(
    recibidas.length === CLAVES_ENTRADA.length &&
      recibidas.every((clave, indice) => clave === CLAVES_ENTRADA[indice]),
    `La intención auditable exige exactamente: ${CLAVES_ENTRADA.join(', ')}.`
  );
}

function idDecimal(valor, campo) {
  const id = String(valor ?? '');
  exigir(/^[1-9][0-9]*$/u.test(id), `${campo} debe ser decimal positivo.`);
  return id;
}

function fechaUtc(valor) {
  exigir(
    typeof valor === 'string' && !Number.isNaN(Date.parse(valor)),
    'efectivoEnUtc no es una fecha válida.'
  );
  exigir(
    new Date(valor).toISOString() === valor,
    'efectivoEnUtc debe ser UTC canónica con milisegundos.'
  );
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
