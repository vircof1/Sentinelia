export const CLAVES_CORREO_REQUIEREN_REVERIFICACION = congelarOrdenado([
  'correo.activo',
  'correo.remitente_email',
  'correo.remitente_nombre',
  'correo.smtp_auth_method',
  'correo.smtp_host',
  'correo.smtp_password',
  'correo.smtp_puerto',
  'correo.smtp_secure',
  'correo.smtp_timeout_conexion_ms',
  'correo.smtp_timeout_saludo_ms',
  'correo.smtp_timeout_socket_ms',
  'correo.smtp_tls_permitir_inseguro',
  'correo.smtp_usuario'
]);

export const CLAVES_ADMISION_TRIGGER_CORREO = congelarOrdenado([
  ...CLAVES_CORREO_REQUIEREN_REVERIFICACION,
  'correo.desuscripcion_ttl_dias',
  'correo.max_reintentos',
  'correo.reintento_base_segundos',
  'portal.nombre_visible',
  'portal.origen_publico'
]);

export const CLAVE_LEGACY_VERIFICACION_CORREO =
  'correo.operativo_verificado';
export const CLAVE_LEGACY_ORIGEN_PUBLICO =
  'federacion.origen_publico';

export const CLAVES_BLOQUEO_AUTORIDAD_CORREO = congelarOrdenado([
  ...CLAVES_ADMISION_TRIGGER_CORREO,
  CLAVE_LEGACY_VERIFICACION_CORREO,
  CLAVE_LEGACY_ORIGEN_PUBLICO
]);

const REVERIFICACION = new Set(CLAVES_CORREO_REQUIEREN_REVERIFICACION);
const ADMISION = new Set(CLAVES_ADMISION_TRIGGER_CORREO);

export function validarCatalogosConfiguracionCorreo(definiciones) {
  if (!Array.isArray(definiciones)) {
    throw new Error('Las definiciones de configuración deben ser una lista.');
  }
  const porClave = new Map(definiciones.map((definicion) => [
    definicion.clave,
    definicion
  ]));
  if (porClave.size !== definiciones.length) {
    throw new Error('Las definiciones de configuración contienen claves repetidas.');
  }
  for (const clave of CLAVES_ADMISION_TRIGGER_CORREO) {
    if (!porClave.has(clave)) {
      throw new Error(`Falta la definición de admisión de correo ${clave}.`);
    }
  }
  for (const definicion of definiciones) {
    const participa = Boolean(definicion.participaAdmisionCorreo);
    const invalida = Boolean(definicion.invalidaPruebaSmtp);
    if (participa !== ADMISION.has(definicion.clave) ||
        invalida !== REVERIFICACION.has(definicion.clave)) {
      throw new Error(
        `Los metadatos de ${definicion.clave} divergen del catálogo cerrado de correo.`
      );
    }
    if (invalida && !participa) {
      throw new Error(`${definicion.clave} invalida SMTP pero no participa en admisión.`);
    }
  }
  return true;
}

export function validarMetadatosSqlConfiguracionCorreo(filas) {
  if (!Array.isArray(filas)) {
    throw new Error('Los metadatos SQL de correo deben ser una lista.');
  }
  const admision = [];
  const reverificacion = [];
  const vistas = new Set();
  for (const fila of filas) {
    const clave = String(fila?.clave || '');
    if (!clave || vistas.has(clave)) {
      throw new Error('Los metadatos SQL de correo contienen una clave inválida o repetida.');
    }
    vistas.add(clave);
    const participa = numeroBooleano(fila.participa_admision_correo, clave);
    const invalida = numeroBooleano(fila.invalida_prueba_smtp, clave);
    if (participa) admision.push(clave);
    if (invalida) reverificacion.push(clave);
  }
  exigirMismoCatalogo(admision, CLAVES_ADMISION_TRIGGER_CORREO, 'admisión');
  exigirMismoCatalogo(
    reverificacion,
    CLAVES_CORREO_REQUIEREN_REVERIFICACION,
    'reverificación SMTP'
  );
  return true;
}

export function compararClavesConfiguracionCorreo(a, b) {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

function congelarOrdenado(claves) {
  return Object.freeze([...new Set(claves)].sort(compararClavesConfiguracionCorreo));
}

function numeroBooleano(valor, clave) {
  const numero = Number(valor);
  if (numero !== 0 && numero !== 1) {
    throw new Error(`El metadato SQL de ${clave} no es booleano cerrado.`);
  }
  return numero === 1;
}

function exigirMismoCatalogo(actual, esperado, nombre) {
  const ordenado = [...actual].sort(compararClavesConfiguracionCorreo);
  if (JSON.stringify(ordenado) !== JSON.stringify(esperado)) {
    throw new Error(`El catálogo SQL de ${nombre} diverge del catálogo ejecutable.`);
  }
}
