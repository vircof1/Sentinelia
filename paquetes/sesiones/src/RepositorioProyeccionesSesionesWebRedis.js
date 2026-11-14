import { randomBytes } from 'node:crypto';
import { validarUuidV7Auditoria } from '../../auditoria/src/UuidV7Auditoria.js';

const CAMPOS_SESION = [
  'sesionAuditoriaId',
  'usuarioRealId',
  'usuarioEfectivoId',
  'versionSesionReal',
  'versionSesionEfectiva',
  'scopeApertura',
  'scopeEfectivoActual',
  'expiraEnUtc',
  'datosStore'
];

export class RepositorioProyeccionesSesionesWebRedis {
  constructor({ clienteRedis, prefijo = 'sentinelia:sesiones:v2:' } = {}) {
    if (!clienteRedis?.get || !clienteRedis?.multi) {
      throw new Error('La proyección de sesiones web requiere un cliente Redis operativo.');
    }
    this.clienteRedis = clienteRedis;
    this.prefijo = exigirPrefijo(prefijo);
  }

  generarStoreId() {
    return randomBytes(32).toString('base64url');
  }

  async guardar({ storeId = this.generarStoreId(), sesion, datosStore = {} } = {}) {
    const idStore = validarStoreId(storeId);
    const proyeccion = construirProyeccion(sesion, datosStore);
    const ttl = ttlDesdeFecha(proyeccion.expiraEnUtc);
    const claveStore = this.#claveStore(idStore);
    const claveAuditoria = this.#claveAuditoria(proyeccion.sesionAuditoriaId);
    const storeAsociado = await this.clienteRedis.get(claveAuditoria);
    if (storeAsociado && storeAsociado !== idStore) {
      throw new Error('sesionAuditoriaId ya posee otra proyección Redis.');
    }
    const anterior = await this.obtenerPorStoreId(idStore);
    const multi = this.clienteRedis.multi();
    if (anterior) this.#retirarIndices(multi, idStore, anterior);
    multi.set(claveStore, JSON.stringify(proyeccion), { EX: ttl });
    multi.set(claveAuditoria, idStore, { EX: ttl });
    this.#incorporarIndices(multi, idStore, proyeccion, ttl);
    await multi.exec();
    return Object.freeze({ storeId: idStore, proyeccion });
  }

  async obtenerPorStoreId(storeId) {
    const idStore = validarStoreId(storeId);
    const bruto = await this.clienteRedis.get(this.#claveStore(idStore));
    if (!bruto) return null;
    try {
      return construirProyeccion(JSON.parse(bruto));
    } catch {
      await this.clienteRedis.del(this.#claveStore(idStore));
      return null;
    }
  }

  async obtenerPorSesionAuditoriaId(sesionAuditoriaId) {
    validarUuidV7Auditoria(sesionAuditoriaId, 'sesionAuditoriaId');
    const storeId = await this.clienteRedis.get(this.#claveAuditoria(sesionAuditoriaId));
    if (!storeId) return null;
    const proyeccion = await this.obtenerPorStoreId(storeId);
    if (!proyeccion || proyeccion.sesionAuditoriaId !== sesionAuditoriaId) {
      await this.clienteRedis.del(this.#claveAuditoria(sesionAuditoriaId));
      return null;
    }
    return Object.freeze({ storeId, proyeccion });
  }

  async eliminarPorStoreId(storeId, sesionAuditoriaId = null) {
    const idStore = validarStoreId(storeId);
    const anterior = await this.obtenerPorStoreId(idStore);
    if (sesionAuditoriaId) validarUuidV7Auditoria(sesionAuditoriaId, 'sesionAuditoriaId');
    if (anterior && sesionAuditoriaId && anterior.sesionAuditoriaId !== sesionAuditoriaId) {
      return false;
    }
    const multi = this.clienteRedis.multi();
    multi.del(this.#claveStore(idStore));
    if (anterior) {
      multi.del(this.#claveAuditoria(anterior.sesionAuditoriaId));
      this.#retirarIndices(multi, idStore, anterior);
    } else if (sesionAuditoriaId) {
      multi.del(this.#claveAuditoria(sesionAuditoriaId));
    }
    await multi.exec();
    return Boolean(anterior);
  }

  async eliminarPorSesionAuditoriaId(sesionAuditoriaId) {
    const encontrada = await this.obtenerPorSesionAuditoriaId(sesionAuditoriaId);
    if (!encontrada) return false;
    return this.eliminarPorStoreId(encontrada.storeId, sesionAuditoriaId);
  }

  async listarStoreIdsPorUsuario(usuarioId) {
    const id = idDecimal(usuarioId, 'usuarioId');
    return [...await this.clienteRedis.sMembers(this.#claveUsuario(id))].sort();
  }

  #incorporarIndices(multi, storeId, proyeccion, ttl) {
    for (const usuarioId of new Set([
      proyeccion.usuarioRealId,
      proyeccion.usuarioEfectivoId
    ])) {
      const clave = this.#claveUsuario(usuarioId);
      multi.sAdd(clave, storeId);
      multi.expire(clave, ttl);
    }
  }

  #retirarIndices(multi, storeId, proyeccion) {
    for (const usuarioId of new Set([
      proyeccion.usuarioRealId,
      proyeccion.usuarioEfectivoId
    ])) {
      multi.sRem(this.#claveUsuario(usuarioId), storeId);
    }
  }

  #claveStore(storeId) {
    return `${this.prefijo}store:${storeId}`;
  }

  #claveAuditoria(sesionAuditoriaId) {
    return `${this.prefijo}auditoria:${sesionAuditoriaId}`;
  }

  #claveUsuario(usuarioId) {
    return `${this.prefijo}usuario:${usuarioId}:stores`;
  }
}

function construirProyeccion(sesion = {}, datosStore = sesion.datosStore ?? {}) {
  validarUuidV7Auditoria(sesion.sesionAuditoriaId, 'sesionAuditoriaId');
  const proyeccion = {
    sesionAuditoriaId: sesion.sesionAuditoriaId,
    usuarioRealId: idDecimal(sesion.usuarioRealId, 'usuarioRealId'),
    usuarioEfectivoId: idDecimal(sesion.usuarioEfectivoId, 'usuarioEfectivoId'),
    versionSesionReal: version(sesion.versionSesionReal, 'versionSesionReal'),
    versionSesionEfectiva: version(sesion.versionSesionEfectiva, 'versionSesionEfectiva'),
    scopeApertura: scope(sesion.scopeApertura, 'scopeApertura'),
    scopeEfectivoActual: scope(sesion.scopeEfectivoActual, 'scopeEfectivoActual'),
    expiraEnUtc: fechaFutura(sesion.expiraEnUtc),
    datosStore: objetoJson(datosStore, 'datosStore')
  };
  const claves = Object.keys(sesion).filter((clave) => CAMPOS_SESION.includes(clave)).sort();
  if (!CAMPOS_SESION.filter((clave) => clave !== 'datosStore').every((clave) => claves.includes(clave))) {
    throw new Error('La proyección carece de la fotografía durable obligatoria.');
  }
  const serializada = JSON.stringify(proyeccion);
  if (Buffer.byteLength(serializada, 'utf8') > 65_536) {
    throw new Error('La proyección de sesión supera 65.536 bytes UTF-8.');
  }
  return Object.freeze({
    ...proyeccion,
    scopeApertura: Object.freeze(proyeccion.scopeApertura),
    scopeEfectivoActual: Object.freeze(proyeccion.scopeEfectivoActual),
    datosStore: Object.freeze(proyeccion.datosStore)
  });
}

function ttlDesdeFecha(fecha) {
  const ttl = Math.ceil((Date.parse(fecha) - Date.now()) / 1000);
  if (ttl < 1) throw new Error('No puede proyectarse una sesión expirada.');
  return Math.min(ttl, 2_592_000);
}

function fechaFutura(valor) {
  if (typeof valor !== 'string' || !Number.isFinite(Date.parse(valor))) {
    throw new Error('expiraEnUtc debe ser una fecha ISO válida.');
  }
  return new Date(valor).toISOString();
}

function scope(valor, nombre) {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) {
    throw new Error(`${nombre} debe ser un scope explícito.`);
  }
  const resultado = {};
  for (const campo of ['tenantId', 'empresaId', 'sitioId']) {
    resultado[campo] = valor[campo] == null ? null : idDecimal(valor[campo], `${nombre}.${campo}`);
  }
  return resultado;
}

function objetoJson(valor, nombre) {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor) || Object.getPrototypeOf(valor) !== Object.prototype) {
    throw new Error(`${nombre} debe ser un objeto JSON plano.`);
  }
  validarValorJson(valor, nombre, new Set());
  return JSON.parse(JSON.stringify(valor));
}

function validarValorJson(valor, ruta, visitados) {
  if (valor === null || typeof valor === 'string' || typeof valor === 'boolean') return;
  if (typeof valor === 'number' && Number.isFinite(valor)) return;
  if (typeof valor !== 'object') throw new Error(`${ruta} contiene un valor no representable en JSON.`);
  if (visitados.has(valor)) throw new Error(`${ruta} contiene una referencia circular.`);
  if (!Array.isArray(valor) && Object.getPrototypeOf(valor) !== Object.prototype) {
    throw new Error(`${ruta} contiene un objeto no plano.`);
  }
  visitados.add(valor);
  if (Array.isArray(valor)) {
    for (let indice = 0; indice < valor.length; indice += 1) {
      if (!Object.hasOwn(valor, indice)) throw new Error(`${ruta} contiene una posición vacía.`);
      validarValorJson(valor[indice], `${ruta}[${indice}]`, visitados);
    }
  } else {
    for (const clave of Reflect.ownKeys(valor)) {
      if (typeof clave !== 'string' || !Object.prototype.propertyIsEnumerable.call(valor, clave)) {
        throw new Error(`${ruta} contiene una propiedad no representable en JSON.`);
      }
      validarValorJson(valor[clave], `${ruta}.${clave}`, visitados);
    }
  }
  visitados.delete(valor);
}

function validarStoreId(valor) {
  if (typeof valor !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(valor)) {
    throw new Error('storeId debe ser un identificador opaco de 256 bits.');
  }
  return valor;
}

function idDecimal(valor, nombre) {
  const texto = String(valor ?? '');
  if (!/^[1-9][0-9]*$/.test(texto)) throw new Error(`${nombre} debe ser un id positivo.`);
  return texto;
}

function version(valor, nombre) {
  if (!Number.isSafeInteger(valor) || valor < 0) throw new Error(`${nombre} debe ser una versión entera.`);
  return valor;
}

function exigirPrefijo(valor) {
  if (typeof valor !== 'string' || valor.length < 3 || !valor.endsWith(':')) {
    throw new Error('El prefijo Redis debe ser explícito y terminar en dos puntos.');
  }
  return valor;
}
