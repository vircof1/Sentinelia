export const PERFIL_MENSAJE_REINICIO_PASSWORD_ADMINISTRATIVO =
  'reinicio_password_administrativo@1/mensaje';
export const VERSION_MENSAJE_REINICIO_PASSWORD_ADMINISTRATIVO = 1;
export const ASUNTO_MENSAJE_REINICIO_PASSWORD_ADMINISTRATIVO =
  '[Sentinelia] Contraseña provisional';

const PATRON_PASSWORD = /^[A-Za-z0-9_-]{24,72}$/u;
const PATRON_FECHA_UTC =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const CUERPO_UTF8_MAXIMO = 60 * 1024;
const NOMBRE_PORTAL_CARACTERES_MAXIMO = 512;

export function crearMensajeReinicioPasswordAdministrativo(entrada = {}) {
  validarClavesExactas(entrada, [
    'nombrePortal', 'passwordProvisional', 'aplicadoEnUtc'
  ]);
  const portal = normalizarNombrePortal(entrada.nombrePortal);
  const password = validarPassword(entrada.passwordProvisional);
  const fecha = validarFechaUtc(entrada.aplicadoEnUtc);
  const cuerpoTexto = renderizar({
    nombrePortal: portal,
    passwordProvisional: password,
    aplicadoEnUtc: fecha
  });
  if (Buffer.byteLength(cuerpoTexto, 'utf8') > CUERPO_UTF8_MAXIMO) {
    throw new Error('El mensaje administrativo excede el límite del correo.');
  }
  return Object.freeze({
    perfil: PERFIL_MENSAJE_REINICIO_PASSWORD_ADMINISTRATIVO,
    version: VERSION_MENSAJE_REINICIO_PASSWORD_ADMINISTRATIVO,
    asunto: ASUNTO_MENSAJE_REINICIO_PASSWORD_ADMINISTRATIVO,
    cuerpoTexto
  });
}

export function extraerPasswordProvisionalMensajeReinicioAdministrativo(
  entrada = {}
) {
  validarClavesExactas(entrada, ['asunto', 'cuerpoTexto']);
  if (
    entrada.asunto !== ASUNTO_MENSAJE_REINICIO_PASSWORD_ADMINISTRATIVO ||
    typeof entrada.cuerpoTexto !== 'string' ||
    Buffer.byteLength(entrada.cuerpoTexto, 'utf8') > CUERPO_UTF8_MAXIMO
  ) {
    throw errorFormato();
  }
  const coincidencia = PATRON_CUERPO.exec(entrada.cuerpoTexto);
  if (!coincidencia) throw errorFormato();
  const material = {
    nombrePortal: coincidencia.groups.nombrePortal,
    aplicadoEnUtc: coincidencia.groups.aplicadoEnUtc,
    passwordProvisional: coincidencia.groups.passwordProvisional
  };
  try {
    const reconstruido = crearMensajeReinicioPasswordAdministrativo(material);
    if (reconstruido.cuerpoTexto !== entrada.cuerpoTexto) throw errorFormato();
    return material.passwordProvisional;
  } catch {
    throw errorFormato();
  }
}

const PATRON_CUERPO = new RegExp(
  '^Sentinelia · reinicio administrativo de contraseña\\n' +
  'Formato: reinicio_password_administrativo@1/mensaje\\n' +
  'Portal: (?<nombrePortal>[^\\r\\n]+)\\n' +
  'Aplicada en UTC: (?<aplicadoEnUtc>[^\\r\\n]+)\\n\\n' +
  'Contraseña provisional: (?<passwordProvisional>[A-Za-z0-9_-]{24,72})\\n\\n' +
  'Deberás cambiar esta contraseña en el próximo inicio de sesión\\.\\n' +
  'Si no esperabas este cambio o la contraseña ya quedó obsoleta, ' +
  'contacta con el soporte responsable\\.$',
  'u'
);

function renderizar({ nombrePortal, passwordProvisional, aplicadoEnUtc }) {
  return [
    'Sentinelia · reinicio administrativo de contraseña',
    `Formato: ${PERFIL_MENSAJE_REINICIO_PASSWORD_ADMINISTRATIVO}`,
    `Portal: ${nombrePortal}`,
    `Aplicada en UTC: ${aplicadoEnUtc}`,
    '',
    `Contraseña provisional: ${passwordProvisional}`,
    '',
    'Deberás cambiar esta contraseña en el próximo inicio de sesión.',
    'Si no esperabas este cambio o la contraseña ya quedó obsoleta, ' +
      'contacta con el soporte responsable.'
  ].join('\n');
}

function normalizarNombrePortal(valor) {
  if (typeof valor !== 'string') throw errorFormato();
  const nombre = valor.replace(/\s+/gu, ' ').trim();
  if (!nombre || [...nombre].length > NOMBRE_PORTAL_CARACTERES_MAXIMO) {
    throw errorFormato();
  }
  return nombre;
}

function validarPassword(valor) {
  if (typeof valor !== 'string' || !PATRON_PASSWORD.test(valor)) {
    throw errorFormato();
  }
  return valor;
}

function validarFechaUtc(valor) {
  if (
    typeof valor !== 'string' ||
    !PATRON_FECHA_UTC.test(valor) ||
    new Date(valor).toISOString() !== valor
  ) {
    throw errorFormato();
  }
  return valor;
}

function validarClavesExactas(valor, esperadas) {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) {
    throw errorFormato();
  }
  const actuales = Object.keys(valor).sort();
  const requeridas = [...esperadas].sort();
  if (
    actuales.length !== requeridas.length ||
    actuales.some((clave, indice) => clave !== requeridas[indice])
  ) {
    throw errorFormato();
  }
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(valor))) {
    if (
      typeof descriptor.get === 'function' ||
      typeof descriptor.set === 'function'
    ) {
      throw errorFormato();
    }
  }
}

function errorFormato() {
  const error = new Error('El mensaje administrativo privado no es válido.');
  error.codigo = 'MENSAJE_REINICIO_PASSWORD_ADMINISTRATIVO_INVALIDO';
  return error;
}
