import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { validarRutaPosixAbsolutaBind } from './SelectorActivoBindDns.js';

export class ValidadorGrafoIncludesBindDns {
  constructor({
    rutaRaiz,
    rutaSelector,
    maxProfundidad = 16,
    maxArchivos = 128,
    maxBytes = 1_048_576
  } = {}) {
    this.rutaRaiz = validarRutaPosixAbsolutaBind(rutaRaiz, 'BIND_NAMED_CONF_ACTIVO');
    this.rutaSelector = validarRutaPosixAbsolutaBind(rutaSelector, 'BIND_SELECTOR_ACTIVO');
    this.maxProfundidad = entero(maxProfundidad, 1, 64);
    this.maxArchivos = entero(maxArchivos, 1, 1024);
    this.maxBytes = entero(maxBytes, 1024, 16_777_216);
  }

  async validar() {
    const estado = { archivos: 0, bytes: 0, referenciasSelector: 0 };
    await this.#visitar(this.rutaRaiz, [], estado);
    if (estado.referenciasSelector !== 1) {
      throw new Error(`La configuración BIND debe alcanzar el selector exactamente una vez; obtuvo ${estado.referenciasSelector}.`);
    }
    return Object.freeze({
      rutaRaiz: this.rutaRaiz,
      rutaSelector: this.rutaSelector,
      archivosLeidos: estado.archivos,
      bytesLeidos: estado.bytes,
      referenciasSelector: estado.referenciasSelector
    });
  }

  async #visitar(ruta, pila, estado) {
    if (pila.length >= this.maxProfundidad) throw new Error('El grafo de includes BIND supera su profundidad máxima.');
    if (pila.includes(ruta)) throw new Error(`El grafo de includes BIND contiene un ciclo en ${ruta}.`);
    if (ruta === this.rutaSelector) {
      estado.referenciasSelector += 1;
      return;
    }
    estado.archivos += 1;
    if (estado.archivos > this.maxArchivos) throw new Error('El grafo de includes BIND supera el máximo de archivos.');
    const bytes = await leerRegularNoFollow(ruta, this.maxBytes - estado.bytes);
    estado.bytes += bytes.length;
    if (estado.bytes > this.maxBytes) throw new Error('El grafo de includes BIND supera el máximo de bytes.');
    const includes = extraerIncludesBind(bytes.toString('utf8'));
    for (const incluido of includes) {
      const absoluta = validarRutaPosixAbsolutaBind(incluido, 'include BIND');
      await this.#visitar(absoluta, [...pila, ruta], estado);
    }
  }
}

export function extraerIncludesBind(texto) {
  const limpio = retirarComentarios(String(texto));
  const resultado = [];
  const patron = /\binclude\s+"([^"]+)"\s*;/g;
  let coincidencia;
  while ((coincidencia = patron.exec(limpio)) !== null) resultado.push(coincidencia[1]);
  const sinContenidoStrings = limpio.replace(/"(?:\\.|[^"\\])*"/g, '""');
  const tokensInclude = sinContenidoStrings.match(/\binclude\b/g)?.length || 0;
  if (tokensInclude !== resultado.length) throw new Error('Existe una directiva include BIND malformada o no canónica.');
  return resultado;
}

async function leerRegularNoFollow(ruta, restante) {
  if (restante <= 0) throw new Error('El grafo de includes BIND agotó su límite de bytes.');
  await validarCadenaNoSymlink(ruta);
  const handle = await fs.open(ruta, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const estado = await handle.stat();
    if (!estado.isFile() || estado.size > restante) throw new Error(`${ruta} no es regular o excede el límite BIND.`);
    return await handle.readFile();
  } finally { await handle.close(); }
}

function retirarComentarios(texto) {
  let salida = '';
  let indice = 0;
  let enString = false;
  while (indice < texto.length) {
    const actual = texto[indice];
    const siguiente = texto[indice + 1];
    if (enString) {
      salida += actual;
      if (actual === '\\') {
        if (siguiente == null) throw new Error('Escape incompleto en configuración BIND.');
        salida += siguiente;
        indice += 2;
        continue;
      }
      if (actual === '"') enString = false;
      indice += 1;
      continue;
    }
    if (actual === '"') { enString = true; salida += actual; indice += 1; continue; }
    if (actual === '/' && siguiente === '/') {
      indice += 2;
      while (indice < texto.length && texto[indice] !== '\n') indice += 1;
      salida += '\n';
      continue;
    }
    if (actual === '/' && siguiente === '*') {
      const cierre = texto.indexOf('*/', indice + 2);
      if (cierre < 0) throw new Error('Comentario BIND sin cerrar.');
      salida += ' ';
      indice = cierre + 2;
      continue;
    }
    if (actual === '#') {
      while (indice < texto.length && texto[indice] !== '\n') indice += 1;
      salida += '\n';
      continue;
    }
    salida += actual;
    indice += 1;
  }
  if (enString) throw new Error('String BIND sin cerrar.');
  return salida;
}

async function validarCadenaNoSymlink(ruta) {
  let actual = '/';
  for (const componente of ruta.slice(1).split('/')) {
    actual = path.join(actual, componente);
    if ((await fs.lstat(actual)).isSymbolicLink()) throw new Error(`${ruta} contiene un enlace simbólico.`);
  }
}

function entero(valor, minimo, maximo) {
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero < minimo || numero > maximo) throw new Error('Límite técnico BIND inválido.');
  return numero;
}
