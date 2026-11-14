import {
  TIPOS_IDENTIDAD_FEDERADA,
  crearIdentidadFederada
} from '../../../../paquetes/federacion/src/IdentidadFederada.js';

const PERFIL_DESPERTAR = 'sentinelia-federacion-outbox-disponible-v1';
const PERFIL_INVALIDACION = 'sentinelia-federacion-invalidacion-v1';
const TIPOS_RECURSO_INVALIDABLE = new Set([
  'configuracion', 'relacion', 'flujo', 'generacion'
]);

export class SuscriptorSenalesFederacionRedis {
  constructor({ clienteRedis, canalDespertar, canalInvalidaciones,
    onDespertar, onInvalidacion } = {}) {
    if (typeof clienteRedis?.duplicate !== 'function') {
      throw new Error('Las señales federadas requieren un cliente Redis duplicable.');
    }
    if (typeof onDespertar !== 'function' || typeof onInvalidacion !== 'function') {
      throw new Error('Las señales federadas requieren ambos consumidores efímeros.');
    }
    this.clienteRedis = clienteRedis;
    this.canalDespertar = canal(canalDespertar, 'canalDespertar');
    this.canalInvalidaciones = canal(canalInvalidaciones, 'canalInvalidaciones');
    if (this.canalDespertar === this.canalInvalidaciones) {
      throw new Error('Despertar e invalidación deben usar canales distintos.');
    }
    this.onDespertar = onDespertar;
    this.onInvalidacion = onInvalidacion;
    this.clienteSuscriptor = null;
    this.cola = Promise.resolve();
    this.totalDespertares = 0;
    this.totalInvalidaciones = 0;
    this.totalIgnoradas = 0;
    this.ultimaSenalEnUtc = null;
  }

  async arrancar() {
    if (this.clienteSuscriptor) return this.serializarResumen();
    const cliente = this.clienteRedis.duplicate();
    cliente.on('error', (error) => {
      console.error(
        `[sentinelia-runtime] Señal Redis federada no disponible: ${codigoSeguro(error)}`
      );
    });
    try {
      await cliente.connect();
      await cliente.subscribe(this.canalDespertar, (mensaje) =>
        this.#recibir('despertar', mensaje));
      await cliente.subscribe(this.canalInvalidaciones, (mensaje) =>
        this.#recibir('invalidacion', mensaje));
      this.clienteSuscriptor = cliente;
      return this.serializarResumen();
    } catch (error) {
      if (cliente.isOpen) await cliente.quit();
      throw error;
    }
  }

  #recibir(tipo, mensaje) {
    const senal = tipo === 'despertar'
      ? parsearDespertar(mensaje)
      : parsearInvalidacion(mensaje);
    if (!senal) {
      this.totalIgnoradas += 1;
      return;
    }
    if (tipo === 'despertar') this.totalDespertares += 1;
    else this.totalInvalidaciones += 1;
    this.ultimaSenalEnUtc = new Date().toISOString();
    const consumir = tipo === 'despertar' ? this.onDespertar : this.onInvalidacion;
    this.cola = this.cola.then(() => consumir(senal)).catch((error) => {
      console.error(
        `[sentinelia-runtime] Señal Redis federada no aplicada: ${codigoSeguro(error)}`
      );
    });
  }

  async detener() {
    if (!this.clienteSuscriptor) return this.serializarResumen();
    const cliente = this.clienteSuscriptor;
    this.clienteSuscriptor = null;
    await cliente.unsubscribe(this.canalDespertar);
    await cliente.unsubscribe(this.canalInvalidaciones);
    await this.cola;
    await cliente.quit();
    return this.serializarResumen();
  }

  serializarResumen() {
    return Object.freeze({
      activo: Boolean(this.clienteSuscriptor),
      canalDespertar: this.canalDespertar,
      canalInvalidaciones: this.canalInvalidaciones,
      totalDespertares: this.totalDespertares,
      totalInvalidaciones: this.totalInvalidaciones,
      totalIgnoradas: this.totalIgnoradas,
      ultimaSenalEnUtc: this.ultimaSenalEnUtc
    });
  }
}

function parsearDespertar(mensaje) {
  const valor = jsonPlano(mensaje);
  if (!valor || !clavesExactas(valor, [
    'perfil', 'prefijos', 'publicadoEnUtc', 'version'
  ]) || valor.perfil !== PERFIL_DESPERTAR || valor.version !== 1 ||
      !fechaIso(valor.publicadoEnUtc) || !Array.isArray(valor.prefijos) ||
      valor.prefijos.length < 1 || valor.prefijos.length > 1000) return null;
  const prefijos = valor.prefijos.map(normalizarPrefijo);
  if (prefijos.some((prefijo) => prefijo === null)) return null;
  return Object.freeze({
    tipo: 'despertar',
    publicadoEnUtc: valor.publicadoEnUtc,
    prefijos: Object.freeze(prefijos)
  });
}

function normalizarPrefijo(valor) {
  if (!valor || !clavesExactas(valor, [
    'flujoId', 'generacionId', 'posicionMaximaObservada',
    'posicionMinimaObservada', 'totalPosiciones'
  ])) return null;
  try {
    const flujoId = identidad(valor.flujoId, TIPOS_IDENTIDAD_FEDERADA.FLUJO);
    const generacionId = identidad(
      valor.generacionId,
      TIPOS_IDENTIDAD_FEDERADA.GENERACION
    );
    const minima = decimalPositivo(valor.posicionMinimaObservada);
    const maxima = decimalPositivo(valor.posicionMaximaObservada);
    if (BigInt(minima) > BigInt(maxima) || !Number.isSafeInteger(valor.totalPosiciones) ||
        valor.totalPosiciones < 1 || valor.totalPosiciones > 5000) return null;
    return Object.freeze({
      flujoId,
      generacionId,
      posicionMinimaObservada: minima,
      posicionMaximaObservada: maxima,
      totalPosiciones: valor.totalPosiciones
    });
  } catch {
    return null;
  }
}

function parsearInvalidacion(mensaje) {
  const valor = jsonPlano(mensaje);
  if (!valor || !clavesExactas(valor, [
    'perfil', 'publicadoEnUtc', 'recursoId', 'recursoTipo', 'revision', 'version'
  ]) || valor.perfil !== PERFIL_INVALIDACION || valor.version !== 1 ||
      !fechaIso(valor.publicadoEnUtc) ||
      !TIPOS_RECURSO_INVALIDABLE.has(valor.recursoTipo) ||
      typeof valor.recursoId !== 'string' || valor.recursoId.length < 1 ||
      valor.recursoId.length > 191 || !/^[\x21-\x7e]+$/u.test(valor.recursoId) ||
      typeof valor.revision !== 'string' || !/^[1-9][0-9]*$/u.test(valor.revision)) {
    return null;
  }
  if (!identidadCompatible(valor.recursoTipo, valor.recursoId)) return null;
  return Object.freeze({
    tipo: 'invalidacion',
    recursoTipo: valor.recursoTipo,
    recursoId: valor.recursoId,
    revision: valor.revision,
    publicadoEnUtc: valor.publicadoEnUtc
  });
}

function identidadCompatible(tipo, valor) {
  const identidadPorTipo = {
    relacion: TIPOS_IDENTIDAD_FEDERADA.RELACION,
    flujo: TIPOS_IDENTIDAD_FEDERADA.FLUJO,
    generacion: TIPOS_IDENTIDAD_FEDERADA.GENERACION
  }[tipo];
  if (!identidadPorTipo) return tipo === 'configuracion';
  try {
    return identidad(valor, identidadPorTipo) === valor;
  } catch {
    return false;
  }
}

function jsonPlano(mensaje) {
  if (typeof mensaje !== 'string' || Buffer.byteLength(mensaje, 'utf8') > 65536) {
    return null;
  }
  try {
    const valor = JSON.parse(mensaje);
    return valor && typeof valor === 'object' && !Array.isArray(valor) &&
      Object.getPrototypeOf(valor) === Object.prototype ? valor : null;
  } catch {
    return null;
  }
}

function clavesExactas(valor, claves) {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return false;
  const observadas = Object.keys(valor).sort();
  const esperadas = [...claves].sort();
  return observadas.length === esperadas.length &&
    observadas.every((clave, indice) => clave === esperadas[indice]);
}

function identidad(valor, tipo) {
  return String(crearIdentidadFederada({ tipo, valor: String(valor || '') }));
}

function decimalPositivo(valor) {
  const texto = String(valor ?? '');
  if (!/^[1-9][0-9]*$/u.test(texto)) throw new Error('Decimal no canónico.');
  return texto;
}

function fechaIso(valor) {
  return typeof valor === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(valor) &&
    Number.isFinite(Date.parse(valor)) && new Date(valor).toISOString() === valor;
}

function canal(valor, campo) {
  const texto = String(valor || '').trim();
  if (!texto || texto.length > 255 || !/^[\x21-\x7e]+$/u.test(texto)) {
    throw new Error(`${campo} no es válido.`);
  }
  return texto;
}

function codigoSeguro(error) {
  return String(error?.codigo || error?.code || 'error_senal_federada')
    .toLowerCase().replace(/[^a-z0-9_.-]+/gu, '_').slice(0, 64);
}
