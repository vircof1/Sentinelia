import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { validarRutaPosixAbsolutaBind } from './SelectorActivoBindDns.js';

const VARIABLES_LEGACY = Object.freeze([
  'DNS_RUTA_INCLUDE_GESTIONADO',
  'DNS_DIRECTORIO_ZONAS',
  'DNS_COMANDO_RECARGA',
  'DNS_COMANDO_CHECKCONF',
  'DNS_COMANDO_CHECKZONE'
]);

export class ConfiguracionDespliegueBindDns {
  #rndcArgumentos = [];

  constructor(entorno = process.env) {
    for (const clave of VARIABLES_LEGACY) {
      if (Object.hasOwn(entorno, clave)) {
        throw new Error(`La variable obsoleta ${clave} debe eliminarse del despliegue 5.21.`);
      }
    }
    this.activo = Object.hasOwn(entorno, 'BIND_PUBLICADOR_COORDINADO_ACTIVO')
      ? booleano(
          entorno.BIND_PUBLICADOR_COORDINADO_ACTIVO,
          false,
          'BIND_PUBLICADOR_COORDINADO_ACTIVO'
        )
      : booleano(entorno.DNS_ACTIVO, false, 'DNS_ACTIVO');
    if (!this.activo) {
      Object.freeze(this);
      return;
    }
    this.raizArtefactos = ruta(entorno.BIND_RAIZ_ARTEFACTOS, 'BIND_RAIZ_ARTEFACTOS');
    this.selectorActivo = ruta(entorno.BIND_SELECTOR_ACTIVO, 'BIND_SELECTOR_ACTIVO');
    this.lockFile = ruta(entorno.BIND_LOCK_FILE, 'BIND_LOCK_FILE');
    this.namedConfActivo = ruta(entorno.BIND_NAMED_CONF_ACTIVO, 'BIND_NAMED_CONF_ACTIVO');
    this.namedExecutable = ruta(entorno.BIND_NAMED_EXECUTABLE, 'BIND_NAMED_EXECUTABLE');
    this.rndcExecutable = ruta(entorno.BIND_RNDC_EXECUTABLE, 'BIND_RNDC_EXECUTABLE');
    this.checkconfExecutable = ruta(entorno.BIND_CHECKCONF_EXECUTABLE, 'BIND_CHECKCONF_EXECUTABLE');
    this.checkzoneExecutable = ruta(entorno.BIND_CHECKZONE_EXECUTABLE, 'BIND_CHECKZONE_EXECUTABLE');
    this.namedArgumentos = argumentosJson(entorno.BIND_NAMED_ARGUMENTOS_JSON, 'BIND_NAMED_ARGUMENTOS_JSON');
    this.#rndcArgumentos = argumentosRndc(entorno.BIND_RNDC_ARGUMENTOS_JSON);
    validarRutasControlIndependientes(this);
    validarArgumentosNamed(this.namedArgumentos);
    Object.freeze(this.namedArgumentos);
    Object.freeze(this.#rndcArgumentos);
    Object.freeze(this);
  }

  async validarSistema() {
    if (!this.activo) return Object.freeze({ activo: false });
    await validarArchivoRegular(this.namedConfActivo, { ejecutable: false });
    for (const ejecutable of [
      this.namedExecutable,
      this.rndcExecutable,
      this.checkconfExecutable,
      this.checkzoneExecutable
    ]) await validarArchivoRegular(ejecutable, { ejecutable: true });
    return Object.freeze({ activo: true, valida: true });
  }

  argumentosNamedFinales() {
    return [...this.namedArgumentos, '-g', '-c', this.namedConfActivo];
  }

  argumentosRndcReload() {
    return [...this.#rndcArgumentos, 'reload'];
  }

  toJSON() {
    return Object.freeze({
      activo: this.activo,
      raizArtefactos: this.raizArtefactos,
      selectorActivo: this.selectorActivo,
      lockFile: this.lockFile,
      namedConfActivo: this.namedConfActivo,
      namedExecutable: this.namedExecutable,
      rndcExecutable: this.rndcExecutable,
      checkconfExecutable: this.checkconfExecutable,
      checkzoneExecutable: this.checkzoneExecutable,
      totalArgumentosNamed: this.namedArgumentos?.length || 0,
      totalArgumentosRndc: this.#rndcArgumentos.length
    });
  }
}

async function validarArchivoRegular(rutaArchivo, { ejecutable }) {
  await validarCadenaNoSymlink(rutaArchivo);
  const estado = await fs.stat(rutaArchivo);
  if (!estado.isFile()) throw new Error(`${rutaArchivo} debe ser un archivo regular.`);
  if (ejecutable) {
    const base = path.basename(rutaArchivo).toLowerCase();
    if ([
      'sh', 'bash', 'dash', 'zsh', 'fish', 'ksh', 'env', 'xargs', 'nohup',
      'nice', 'timeout', 'setsid', 'sudo', 'doas', 'busybox', 'node', 'nodejs',
      'python', 'python2', 'python3', 'perl', 'ruby', 'php', 'java'
    ].includes(base)) {
      throw new Error('Un intérprete o lanzador genérico no puede actuar como ejecutable BIND.');
    }
    await fs.access(rutaArchivo, fsConstants.X_OK);
  } else {
    await fs.access(rutaArchivo, fsConstants.R_OK);
  }
}

async function validarCadenaNoSymlink(rutaArchivo) {
  let actual = '/';
  for (const componente of rutaArchivo.slice(1).split('/')) {
    actual = path.join(actual, componente);
    const estado = await fs.lstat(actual);
    if (estado.isSymbolicLink()) throw new Error(`${rutaArchivo} contiene un enlace simbólico.`);
  }
}

function ruta(valor, nombre) {
  return validarRutaPosixAbsolutaBind(String(valor ?? ''), nombre);
}

function argumentosJson(valor, nombre) {
  let lista;
  try { lista = JSON.parse(valor == null || valor === '' ? '[]' : String(valor)); }
  catch { throw new Error(`${nombre} debe ser un array JSON válido.`); }
  if (!Array.isArray(lista) || lista.length > 32) throw new Error(`${nombre} debe contener como máximo 32 argumentos.`);
  let bytes = 0;
  return lista.map((item) => {
    if (typeof item !== 'string' || item.length === 0 || item.length > 256 || /[\u0000-\u001f\u007f]/.test(item)) {
      throw new Error(`${nombre} contiene un argumento inválido.`);
    }
    bytes += Buffer.byteLength(item);
    if (bytes > 4096) throw new Error(`${nombre} supera el límite total.`);
    return item;
  });
}

function validarArgumentosNamed(lista) {
  const prohibidas = new Set([
    '-c', '-f', '-g', '-h', '-v', '-V',
    '--config', '--foreground', '--help', '--version'
  ]);
  if (lista.some((item) => prohibidas.has(item) || /^-(?:c|f|g).+/.test(item))) {
    throw new Error('BIND_NAMED_ARGUMENTOS_JSON no puede alterar configuración, foreground ni modo de ejecución.');
  }
}

function argumentosRndc(valor) {
  const lista = argumentosJson(valor, 'BIND_RNDC_ARGUMENTOS_JSON');
  const conValor = new Set(['-c', '-s', '-p', '-k', '-y']);
  for (let indice = 0; indice < lista.length; indice += 1) {
    const opcion = lista[indice];
    if (!conValor.has(opcion) || indice + 1 >= lista.length || lista[indice + 1].startsWith('-')) {
      throw new Error('BIND_RNDC_ARGUMENTOS_JSON solo admite opciones de conexión reconocidas.');
    }
    indice += 1;
  }
  return lista;
}

function validarRutasControlIndependientes(configuracion) {
  const rutas = [
    configuracion.raizArtefactos,
    configuracion.selectorActivo,
    configuracion.lockFile,
    configuracion.namedConfActivo
  ];
  if (new Set(rutas).size !== rutas.length) {
    throw new Error('Raíz, selector, lock y configuración activa BIND deben usar rutas independientes.');
  }
}

function booleano(valor, defecto, nombre) {
  if (valor == null || valor === '') return defecto;
  if (valor === true || String(valor).toLowerCase() === 'true' || String(valor) === '1') return true;
  if (valor === false || String(valor).toLowerCase() === 'false' || String(valor) === '0') return false;
  throw new Error(`${nombre} debe ser booleano.`);
}
