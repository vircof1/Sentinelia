const MAXIMO_CLAVES = 8;
const PATRON_KEY_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const PATRON_CLAVE_BASE64_256 = /^[A-Za-z0-9+/]{43}=$/u;

export class KeyringTecnicoCorreo {
  #claves;
  #keyIdActiva;

  constructor({ keyring, keyIdActiva } = {}) {
    this.#keyIdActiva = validarKeyId(keyIdActiva, 'CORREO_KEY_ID_ACTIVA');
    this.#claves = parsearKeyring(keyring);
    if (!this.#claves.has(this.#keyIdActiva)) {
      throw new Error('La clave activa no existe en CORREO_KEYRING.');
    }
  }

  get keyIdActiva() {
    return this.#keyIdActiva;
  }

  obtenerActiva() {
    return Object.freeze({
      keyId: this.#keyIdActiva,
      clave: Buffer.from(this.#claves.get(this.#keyIdActiva))
    });
  }

  obtener(keyId) {
    const id = validarKeyId(keyId, 'keyId');
    const clave = this.#claves.get(id);
    return clave ? Buffer.from(clave) : null;
  }

  listarIds() {
    return Object.freeze([...this.#claves.keys()].sort());
  }

  toJSON() {
    return { keyIdActiva: this.#keyIdActiva, keyIds: this.listarIds() };
  }
}

export function crearKeyringTecnicoCorreoDesdeEntorno(entorno = process.env) {
  return new KeyringTecnicoCorreo({
    keyring: entorno.CORREO_KEYRING,
    keyIdActiva: entorno.CORREO_KEY_ID_ACTIVA
  });
}

function parsearKeyring(valor) {
  let entrada;
  if (typeof valor === 'string') {
    try {
      entrada = JSON.parse(valor);
    } catch {
      throw new Error('CORREO_KEYRING debe ser un objeto JSON válido.');
    }
  } else {
    entrada = valor;
  }

  if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada) ||
      Object.getPrototypeOf(entrada) !== Object.prototype) {
    throw new Error('CORREO_KEYRING debe contener un objeto plano de claves.');
  }

  const descriptores = Object.getOwnPropertyDescriptors(entrada);
  const pares = Object.entries(descriptores);
  if (pares.length < 1 || pares.length > MAXIMO_CLAVES) {
    throw new Error(`CORREO_KEYRING debe contener entre 1 y ${MAXIMO_CLAVES} claves.`);
  }

  const claves = new Map();
  for (const [keyId, descriptor] of pares) {
    validarKeyId(keyId, 'keyId de CORREO_KEYRING');
    if (!Object.hasOwn(descriptor, 'value')) {
      throw new Error(`La clave ${keyId} debe ser un valor de datos.`);
    }
    const valorClave = descriptor.value;
    if (typeof valorClave !== 'string' ||
        !PATRON_CLAVE_BASE64_256.test(valorClave)) {
      throw new Error(`La clave ${keyId} debe ser Base64 canónico de 256 bits.`);
    }
    const clave = Buffer.from(valorClave, 'base64');
    if (clave.length !== 32 || clave.toString('base64') !== valorClave) {
      throw new Error(`La clave ${keyId} debe ser Base64 canónico de 256 bits.`);
    }
    claves.set(keyId, Buffer.from(clave));
  }
  return claves;
}

function validarKeyId(valor, nombre) {
  if (typeof valor !== 'string' || !PATRON_KEY_ID.test(valor)) {
    throw new Error(`${nombre} no es un identificador de clave válido.`);
  }
  return valor;
}
