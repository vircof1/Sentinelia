const MAX_CLAVES = 8;
const PATRON_KEY_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const PATRON_CLAVE_BASE64_256 = /^[A-Za-z0-9+/]{43}=$/u;

export class KeyringFederacionDespliegue {
  #claves;
  #keyIdActiva;

  constructor({ referencia, keyring, keyIdActiva } = {}) {
    this.referencia = validarReferencia(referencia);
    this.#keyIdActiva = validarKeyId(keyIdActiva, 'FEDERACION_KEY_ID_ACTIVA');
    this.#claves = parsearKeyring(keyring, this.#keyIdActiva);
    if (!this.#claves.has(this.#keyIdActiva)) {
      throw new Error('La clave activa no existe en FEDERACION_KEYRING.');
    }
    Object.freeze(this);
  }

  validarDisponibilidad({ referencia, keyIdsRequeridos = [] } = {}) {
    if (validarReferencia(referencia) !== this.referencia) {
      throw new Error('La referencia configurada no corresponde al keyring desplegado.');
    }
    if (!Array.isArray(keyIdsRequeridos) || keyIdsRequeridos.some(
      (keyId) => !this.#claves.has(validarKeyId(keyId, 'keyIdRequerido'))
    )) {
      throw new Error('El keyring desplegado no conserva todas las claves requeridas.');
    }
    return Object.freeze({
      disponible: true,
      referencia: this.referencia,
      keyIdActiva: this.#keyIdActiva,
      keyIds: Object.freeze([...this.#claves.keys()].sort())
    });
  }

  obtenerClaveActiva() {
    return Object.freeze({
      keyId: this.#keyIdActiva,
      clave: Buffer.from(this.#claves.get(this.#keyIdActiva))
    });
  }

  obtenerClavePorId(keyId) {
    const clave = this.#claves.get(validarKeyId(keyId, 'keyId'));
    return clave ? Buffer.from(clave) : null;
  }

  toJSON() {
    return this.validarDisponibilidad({ referencia: this.referencia });
  }
}

export function crearKeyringFederacionDesdeEntorno(entorno = process.env) {
  return new KeyringFederacionDespliegue({
    referencia: entorno.FEDERACION_KEYRING_REFERENCIA ||
      'sentinelia/federacion/v1',
    keyring: entorno.FEDERACION_KEYRING,
    keyIdActiva: entorno.FEDERACION_KEY_ID_ACTIVA
  });
}

function parsearKeyring(valor, keyIdActiva) {
  let entrada = valor;
  if (typeof valor === 'string') {
    const texto = valor.trim();
    if (PATRON_CLAVE_BASE64_256.test(texto)) {
      entrada = { [keyIdActiva]: texto };
    } else {
      try {
        entrada = JSON.parse(texto);
      } catch {
        throw new Error('FEDERACION_KEYRING debe ser JSON o una clave base64 canónica.');
      }
    }
  }
  if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada) ||
      Object.getPrototypeOf(entrada) !== Object.prototype) {
    throw new Error('FEDERACION_KEYRING debe ser un objeto plano.');
  }
  const pares = Object.entries(entrada);
  if (pares.length < 1 || pares.length > MAX_CLAVES) {
    throw new Error(`FEDERACION_KEYRING debe contener entre 1 y ${MAX_CLAVES} claves.`);
  }
  const claves = new Map();
  for (const [keyId, base64] of pares) {
    validarKeyId(keyId, 'keyId');
    if (typeof base64 !== 'string' || !PATRON_CLAVE_BASE64_256.test(base64)) {
      throw new Error(`La clave ${keyId} debe usar base64 canónico de 256 bits.`);
    }
    const bytes = Buffer.from(base64, 'base64');
    if (bytes.length !== 32 || bytes.toString('base64') !== base64) {
      throw new Error(`La clave ${keyId} debe contener exactamente 256 bits.`);
    }
    claves.set(keyId, bytes);
  }
  return claves;
}

function validarKeyId(valor, campo) {
  if (typeof valor !== 'string' || !PATRON_KEY_ID.test(valor)) {
    throw new Error(`${campo} no es un identificador de clave válido.`);
  }
  return valor;
}

function validarReferencia(valor) {
  if (typeof valor !== 'string' || valor.length < 1 || valor.length > 200 ||
      /[\r\n=]/u.test(valor)) {
    throw new Error('La referencia de keyring federado no es válida.');
  }
  return valor;
}
