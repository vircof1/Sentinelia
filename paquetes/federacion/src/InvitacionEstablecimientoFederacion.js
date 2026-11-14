export const PERFIL_INVITACION_ESTABLECIMIENTO_FEDERACION =
  'sentinelia-federacion-invitacion-v1';
export const VERSION_INVITACION_ESTABLECIMIENTO_FEDERACION = 1;

const PATRON_INVITACION_ID = /^sfinv1_[A-Za-z0-9_-]{21}[AQgw]$/u;
const PATRON_CREDENCIAL_TEMPORAL = /^sft1_[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/u;
const PATRON_RELACION = /^sfid1\.relacion\.[A-Za-z0-9_-]{21}[AQgw]$/u;
const PATRON_INSTALACION = /^sfid1\.instalacion\.[A-Za-z0-9_-]{21}[AQgw]$/u;

export function crearRepresentacionInvitacionEstablecimientoFederacion({
  invitacionId,
  credencialTemporal,
  relacionId,
  installationReceptoraId,
  origenPublico,
  expiraEnUtc
} = {}) {
  exigirPatron(invitacionId, PATRON_INVITACION_ID, 'invitacionId');
  exigirPatron(
    credencialTemporal,
    PATRON_CREDENCIAL_TEMPORAL,
    'credencialTemporal'
  );
  exigirPatron(relacionId, PATRON_RELACION, 'relacionId');
  exigirPatron(
    installationReceptoraId,
    PATRON_INSTALACION,
    'installationReceptoraId'
  );
  const origen = normalizarOrigenPublico(origenPublico);
  const expiracion = normalizarInstanteUtc(expiraEnUtc, 'expiraEnUtc');
  return congelar({
    perfil: PERFIL_INVITACION_ESTABLECIMIENTO_FEDERACION,
    version: VERSION_INVITACION_ESTABLECIMIENTO_FEDERACION,
    destino: {
      origenPublico: origen,
      installationId: installationReceptoraId,
      relacionId
    },
    invitacionId,
    credencialTemporal,
    expiraEnUtc: expiracion
  });
}

export function validarRepresentacionInvitacionEstablecimientoFederacion(valor) {
  exigirObjetoExacto(valor, [
    'credencialTemporal', 'destino', 'expiraEnUtc',
    'invitacionId', 'perfil', 'version'
  ], 'invitación');
  exigirObjetoExacto(
    valor.destino,
    ['installationId', 'origenPublico', 'relacionId'],
    'destino'
  );
  if (
    valor.perfil !== PERFIL_INVITACION_ESTABLECIMIENTO_FEDERACION ||
    valor.version !== VERSION_INVITACION_ESTABLECIMIENTO_FEDERACION
  ) {
    throw new Error('La invitación no usa el perfil contractual soportado.');
  }
  return crearRepresentacionInvitacionEstablecimientoFederacion({
    invitacionId: valor.invitacionId,
    credencialTemporal: valor.credencialTemporal,
    relacionId: valor.destino.relacionId,
    installationReceptoraId: valor.destino.installationId,
    origenPublico: valor.destino.origenPublico,
    expiraEnUtc: valor.expiraEnUtc
  });
}

export function validarInvitacionIdFederacion(valor) {
  exigirPatron(valor, PATRON_INVITACION_ID, 'invitacionId');
  return valor;
}

export function validarCredencialTemporalFederacion(valor) {
  exigirPatron(valor, PATRON_CREDENCIAL_TEMPORAL, 'credencialTemporal');
  return valor;
}

function normalizarOrigenPublico(valor) {
  let url;
  try {
    url = new URL(String(valor || ''));
  } catch {
    throw new Error('origenPublico debe ser un origen HTTPS canónico.');
  }
  if (
    url.protocol !== 'https:' || url.username || url.password ||
    url.pathname !== '/' || url.search || url.hash || url.origin !== valor
  ) {
    throw new Error('origenPublico debe ser un origen HTTPS canónico.');
  }
  return url.origin;
}

function normalizarInstanteUtc(valor, campo) {
  const texto = String(valor || '');
  const milisegundos = Date.parse(texto);
  if (!Number.isFinite(milisegundos) || !texto.endsWith('Z')) {
    throw new Error(`${campo} debe ser un instante UTC.`);
  }
  return new Date(milisegundos).toISOString();
}

function exigirPatron(valor, patron, campo) {
  if (typeof valor !== 'string' || !patron.test(valor)) {
    throw new Error(`${campo} no usa el formato federado esperado.`);
  }
}

function exigirObjetoExacto(valor, claves, campo) {
  if (
    !valor || typeof valor !== 'object' || Array.isArray(valor) ||
    Object.getPrototypeOf(valor) !== Object.prototype
  ) throw new Error(`${campo} debe ser un objeto JSON plano.`);
  const observadas = Object.keys(valor).sort();
  const esperadas = [...claves].sort();
  if (
    observadas.length !== esperadas.length ||
    observadas.some((clave, indice) => clave !== esperadas[indice])
  ) throw new Error(`${campo} contiene campos ausentes o desconocidos.`);
}

function congelar(valor) {
  if (valor && typeof valor === 'object') {
    Object.values(valor).forEach(congelar);
    Object.freeze(valor);
  }
  return valor;
}
