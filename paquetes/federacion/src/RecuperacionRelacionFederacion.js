const PATRON_RECUPERACION = /^sfrec1_[A-Za-z0-9_-]{21}[AQgw]$/u;
const PATRON_TEMPORAL = /^sfrt1_[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/u;
const PATRON_INSTALACION = /^sfid1\.instalacion\.[A-Za-z0-9_-]{21}[AQgw]$/u;
const PATRON_RELACION = /^sfid1\.relacion\.[A-Za-z0-9_-]{21}[AQgw]$/u;

export function crearRepresentacionRecuperacionFederacion(entrada = {}) {
  const valor = {
    perfil: 'sentinelia-federacion-recuperacion-v1',
    version: 1,
    destino: {
      origenPublico: entrada.origenPublico,
      installationId: entrada.installationReceptoraId,
      relacionId: entrada.relacionId
    },
    recuperacionId: entrada.recuperacionId,
    credencialTemporal: entrada.credencialTemporal,
    expiraEnUtc: entrada.expiraEnUtc
  };
  return validarRepresentacionRecuperacionFederacion(valor);
}

export function validarRepresentacionRecuperacionFederacion(valor) {
  exacto(valor, ['credencialTemporal','destino','expiraEnUtc','perfil','recuperacionId','version']);
  exacto(valor.destino, ['installationId','origenPublico','relacionId']);
  exigir(valor.perfil === 'sentinelia-federacion-recuperacion-v1' && valor.version === 1,
    'La representación de recuperación no usa el perfil vigente.');
  exigir(PATRON_RECUPERACION.test(valor.recuperacionId), 'recuperacionId no es canónica.');
  exigir(PATRON_TEMPORAL.test(valor.credencialTemporal), 'La credencial temporal no es canónica.');
  exigir(PATRON_INSTALACION.test(valor.destino.installationId), 'installationId no es canónica.');
  exigir(PATRON_RELACION.test(valor.destino.relacionId), 'relacionId no es canónica.');
  let origen;
  try { origen = new URL(valor.destino.origenPublico); } catch { exigir(false, 'origenPublico no es URL.'); }
  exigir(origen.protocol === 'https:' && origen.origin === valor.destino.origenPublico &&
    origen.pathname === '/' && !origen.search && !origen.hash,
  'origenPublico debe ser un origen HTTPS canónico.');
  const expiraEnUtc = normalizarInstanteUtc(valor.expiraEnUtc);
  return congelar(JSON.parse(JSON.stringify({ ...valor, expiraEnUtc })));
}

function normalizarInstanteUtc(valor) {
  const texto = String(valor || '');
  const milisegundos = Date.parse(texto);
  exigir(Number.isFinite(milisegundos) && texto.endsWith('Z'),
    'expiraEnUtc no es un instante UTC válido.');
  return new Date(milisegundos).toISOString();
}

function exacto(valor, claves) {
  exigir(valor && typeof valor === 'object' && !Array.isArray(valor), 'La representación debe ser objeto.');
  const actuales = Object.keys(valor).sort();
  const esperadas = [...claves].sort();
  exigir(actuales.length === esperadas.length &&
    actuales.every((clave, indice) => clave === esperadas[indice]),
  'La representación contiene campos ausentes o desconocidos.');
}
function exigir(condicion, mensaje) { if (!condicion) throw new Error(mensaje); }
function congelar(valor) {
  if (valor && typeof valor === 'object') {
    Object.values(valor).forEach(congelar);
    Object.freeze(valor);
  }
  return valor;
}
