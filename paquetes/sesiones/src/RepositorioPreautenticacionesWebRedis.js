import { randomBytes } from 'node:crypto';

export class RepositorioPreautenticacionesWebRedis {
  constructor({ clienteRedis, prefijo = 'sentinelia:preauth:v2:', ttlMaximoSegundos = 600 } = {}) {
    if (!clienteRedis?.set || !clienteRedis?.getDel) {
      throw new Error('La preautenticación requiere un cliente Redis operativo.');
    }
    this.clienteRedis = clienteRedis;
    this.prefijo = prefijo;
    this.ttlMaximoSegundos = entero(ttlMaximoSegundos, 30, 900);
  }

  async crear({ usuarioId, datos = {}, ttlSegundos = this.ttlMaximoSegundos } = {}) {
    const ttl = entero(ttlSegundos, 1, this.ttlMaximoSegundos);
    const preautenticacionId = randomBytes(32).toString('base64url');
    const creadaEnUtc = new Date();
    const estado = Object.freeze({
      preautenticacionId,
      usuarioId: idDecimal(usuarioId),
      creadaEnUtc: creadaEnUtc.toISOString(),
      expiraEnUtc: new Date(creadaEnUtc.getTime() + ttl * 1000).toISOString(),
      datos: copiarObjeto(datos)
    });
    const resultado = await this.clienteRedis.set(
      this.#clave(preautenticacionId),
      JSON.stringify(estado),
      { EX: ttl, NX: true }
    );
    if (resultado !== 'OK') throw new Error('No se pudo reservar la preautenticación.');
    return estado;
  }

  async obtener(preautenticacionId) {
    const bruto = await this.clienteRedis.get(this.#clave(validarId(preautenticacionId)));
    return decodificar(bruto);
  }

  async consumir(preautenticacionId) {
    const bruto = await this.clienteRedis.getDel(this.#clave(validarId(preautenticacionId)));
    return decodificar(bruto);
  }

  async eliminar(preautenticacionId) {
    return (await this.clienteRedis.del(this.#clave(validarId(preautenticacionId)))) > 0;
  }

  #clave(id) {
    return `${this.prefijo}${id}`;
  }
}

function decodificar(bruto) {
  if (!bruto) return null;
  const valor = JSON.parse(bruto);
  if (Date.parse(valor.expiraEnUtc) <= Date.now()) return null;
  return Object.freeze({ ...valor, datos: Object.freeze(valor.datos) });
}

function validarId(valor) {
  if (typeof valor !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(valor)) {
    throw new Error('preautenticacionId no es un identificador opaco válido.');
  }
  return valor;
}

function idDecimal(valor) {
  const texto = String(valor ?? '');
  if (!/^[1-9][0-9]*$/.test(texto)) throw new Error('usuarioId debe ser positivo.');
  return texto;
}

function entero(valor, minimo, maximo) {
  if (!Number.isSafeInteger(valor) || valor < minimo || valor > maximo) {
    throw new Error(`El TTL debe estar entre ${minimo} y ${maximo} segundos.`);
  }
  return valor;
}

function copiarObjeto(valor) {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor) || Object.getPrototypeOf(valor) !== Object.prototype) {
    throw new Error('datos debe ser un objeto JSON.');
  }
  validarJson(valor, 'datos', new Set());
  const serializado = JSON.stringify(valor);
  if (Buffer.byteLength(serializado, 'utf8') > 16_384) {
    throw new Error('La preautenticación supera 16.384 bytes UTF-8.');
  }
  return JSON.parse(serializado);
}

function validarJson(valor, ruta, visitados) {
  if (valor === null || typeof valor === 'string' || typeof valor === 'boolean') return;
  if (typeof valor === 'number' && Number.isFinite(valor)) return;
  if (typeof valor !== 'object') throw new Error(`${ruta} contiene un valor no JSON.`);
  if (visitados.has(valor)) throw new Error(`${ruta} contiene una referencia circular.`);
  if (!Array.isArray(valor) && Object.getPrototypeOf(valor) !== Object.prototype) {
    throw new Error(`${ruta} contiene un objeto no plano.`);
  }
  visitados.add(valor);
  if (Array.isArray(valor)) {
    for (let indice = 0; indice < valor.length; indice += 1) {
      if (!Object.hasOwn(valor, indice)) throw new Error(`${ruta} contiene una posición vacía.`);
      validarJson(valor[indice], `${ruta}[${indice}]`, visitados);
    }
  } else {
    for (const clave of Reflect.ownKeys(valor)) {
      if (typeof clave !== 'string' || !Object.prototype.propertyIsEnumerable.call(valor, clave)) {
        throw new Error(`${ruta} contiene una propiedad no JSON.`);
      }
      validarJson(valor[clave], `${ruta}.${clave}`, visitados);
    }
  }
  visitados.delete(valor);
}
