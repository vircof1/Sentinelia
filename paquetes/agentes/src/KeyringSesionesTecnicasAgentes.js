const MAX_CLAVES = 8;
const PATRON_KEY_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const PATRON_CLAVE_BASE64_256 = /^[A-Za-z0-9+/]{43}=$/;

export class KeyringSesionesTecnicasAgentes {
  #claves;
  #keyIdActiva;

  constructor({ keyring, keyIdActiva } = {}) {
    const activa = validarKeyId(keyIdActiva, 'AGENTES_SESION_KEY_ID_ACTIVA');
    const claves = parsearKeyring(keyring, activa);
    if (!claves.has(activa)) {
      throw new Error('La clave activa no existe en AGENTES_SESION_KEYRING.');
    }
    this.#keyIdActiva = activa;
    this.#claves = claves;
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

export function crearKeyringSesionesTecnicasAgentesDesdeEntorno(entorno = process.env) {
  return new KeyringSesionesTecnicasAgentes({
    keyring: obtenerVariableEntornoCompatible(
      entorno,
      'AGENTES_SESION_KEYRING',
      'AGENTES_SESSION_KEYRING'
    ),
    keyIdActiva: obtenerVariableEntornoCompatible(
      entorno,
      'AGENTES_SESION_KEY_ID_ACTIVA',
      'AGENTES_SESSION_KEY_ID_ACTIVA'
    )
  });
}

function obtenerVariableEntornoCompatible(entorno, nombreCanonico, nombreAlias) {
  if (entorno[nombreCanonico] !== undefined && entorno[nombreCanonico] !== '') {
    return entorno[nombreCanonico];
  }
  return entorno[nombreAlias];
}

function parsearKeyring(valor, keyIdActiva) {
  let entrada = valor;
  if (typeof valor === 'string') {
    entrada = normalizarEntradaKeyringTexto(valor, keyIdActiva);
  }
  if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada) ||
      Object.getPrototypeOf(entrada) !== Object.prototype) {
    throw new Error('AGENTES_SESION_KEYRING/AGENTES_SESSION_KEYRING debe ser un objeto plano.');
  }
  const pares = Object.entries(entrada);
  if (pares.length < 1 || pares.length > MAX_CLAVES) {
    throw new Error(`AGENTES_SESION_KEYRING debe contener entre 1 y ${MAX_CLAVES} claves.`);
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

function normalizarEntradaKeyringTexto(valor, keyIdActiva) {
  const texto = valor.trim();
  if (PATRON_CLAVE_BASE64_256.test(texto)) {
    return { [keyIdActiva]: texto };
  }
  const desempaquetado = desempaquetarComillasSimples(texto);
  if (desempaquetado !== texto) {
    return normalizarEntradaKeyringTexto(desempaquetado, keyIdActiva);
  }
  try {
    const entrada = JSON.parse(texto);
    if (typeof entrada === 'string' && entrada.trim().startsWith('{')) {
      return JSON.parse(entrada);
    }
    if (typeof entrada === 'string' && PATRON_CLAVE_BASE64_256.test(entrada.trim())) {
      return { [keyIdActiva]: entrada.trim() };
    }
    return entrada;
  } catch {
    throw new Error('AGENTES_SESION_KEYRING/AGENTES_SESSION_KEYRING debe ser un objeto JSON válido o una clave base64 canónica de 256 bits.');
  }
}

function desempaquetarComillasSimples(valor) {
  if (valor.length >= 2 && valor.startsWith("'") && valor.endsWith("'")) {
    return valor.slice(1, -1);
  }
  return valor;
}

function validarKeyId(valor, nombre) {
  if (typeof valor !== 'string' || !PATRON_KEY_ID.test(valor)) {
    throw new Error(`${nombre} no es un identificador de clave válido.`);
  }
  return valor;
}
