import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  FRONTERA_FEDERACION,
  VERSION_FRONTERA_FEDERACION
} from '../paquetes/federacion/src/index.js';

const raizNode = fileURLToPath(new URL('../', import.meta.url));
const raizPaquete = path.join(raizNode, 'paquetes', 'federacion');
const raizFuentes = path.join(raizPaquete, 'src');
const dependenciasDominioPermitidas = new Set([
  '../../agentes/src/ContratoTelemetriaTemporalAgente.js',
  '../../agentes/src/EvaluadorMomentoUtcRelativoTelemetria.js',
  '../../correo/src/ContratoTriggerCorreo.js',
  '../../triggers/src/CatalogoTiposTrigger.js'
]);

await main();

async function main() {
  verificarContratoPublico();
  verificarAnalizadorImportaciones();
  const archivos = await listarArchivosJavaScript(raizFuentes);
  await verificarFronteraFisica(archivos);
  await verificarExportsPublicos(archivos);
  console.log(
    '[federacion] OK 5.22.9a: frontera=nucleo exports=publicos ' +
    'dependencias_dominio=lista_cerrada dependencias_infraestructura=0 ' +
    'dependencias_apps=0'
  );
}

async function verificarExportsPublicos(archivos) {
  const rutaIndice = path.join(raizFuentes, 'index.js');
  const fronteraPublica = await import(pathToFileURL(rutaIndice));
  const exportadosPorModulos = new Map();
  for (const archivo of archivos) {
    if (archivo === rutaIndice) continue;
    const modulo = await import(pathToFileURL(archivo));
    for (const [nombre, valor] of Object.entries(modulo)) {
      assert.equal(
        exportadosPorModulos.has(nombre),
        false,
        `El export ${nombre} aparece en mas de un modulo del nucleo.`
      );
      exportadosPorModulos.set(nombre, valor);
      assert.ok(
        Object.hasOwn(fronteraPublica, nombre),
        `${path.basename(archivo)} no publica ${nombre} desde index.js.`
      );
      assert.equal(
        fronteraPublica[nombre],
        valor,
        `index.js reinterpreta el export ${nombre}.`
      );
    }
  }
  assert.deepEqual(
    Object.keys(fronteraPublica).sort(),
    [...exportadosPorModulos.keys()].sort(),
    'index.js contiene exports sin fuente o deja contratos internos fuera.'
  );
}

function verificarContratoPublico() {
  assert.equal(VERSION_FRONTERA_FEDERACION, 1);
  assert.deepEqual(FRONTERA_FEDERACION, {
    nombre: 'federacion',
    version: 1,
    naturaleza: 'nucleo_dominio'
  });
  assert.equal(Object.isFrozen(FRONTERA_FEDERACION), true);
}

async function verificarFronteraFisica(archivos) {
  const rutasRelativas = archivos.map((archivo) =>
    path.relative(raizFuentes, archivo).replaceAll(path.sep, '/')
  );
  assert.ok(rutasRelativas.includes('FronteraFederacion.js'));
  assert.ok(rutasRelativas.includes('index.js'));

  for (const archivo of archivos) {
    const fuente = await readFile(archivo, 'utf8');
    for (const especificador of extraerEspecificadoresImportacion(fuente)) {
      assert.ok(
        especificador.startsWith('.'),
        `${path.basename(archivo)} importa una dependencia externa: ${especificador}`
      );
      const destino = path.resolve(path.dirname(archivo), especificador);
      const dependenciaInterna = estaDentroDe(raizFuentes, destino);
      const dependenciaDominioPermitida = dependenciasDominioPermitidas.has(especificador);
      assert.ok(
        dependenciaInterna || dependenciaDominioPermitida,
        `${path.basename(archivo)} sale de la frontera federada: ${especificador}`
      );
    }

    assert.doesNotMatch(
      fuente,
      /(?:apps\/sentinelia-(?:web|runtime)|paquetes\/(?:agentes|auditoria|monitores)|\b(?:Buffer|express|redis|mysql2?)\b)/i,
      `${path.basename(archivo)} acopla el núcleo a aplicación o infraestructura.`
    );
  }
}

function verificarAnalizadorImportaciones() {
  assert.deepEqual(
    extraerEspecificadoresImportacion(`
      import express from 'express';
      import './interno.js';
      export { valor } from '../fuera.js';
      const redis = await import('redis');
    `),
    ['express', './interno.js', '../fuera.js', 'redis']
  );
  for (const fuenteNoAnalizable of [
    "import/* comentario */ fs from 'node:fs';",
    "import fs/* comentario */from 'node:fs';",
    "import fs from/* comentario */'node:fs';",
    "export/* comentario */ { valor } from 'redis';",
    "export { valor }/* comentario */from 'redis';",
    'const modulo = import(`node:fs`);',
    "const modulo = import('./' + destino);"
  ]) {
    assert.throws(
      () => extraerEspecificadoresImportacion(fuenteNoAnalizable),
      /sintaxis de importacion no analizable/
    );
  }
  assert.equal(
    estaDentroDe(raizFuentes, path.join(raizFuentes, 'interno.js')),
    true
  );
  assert.equal(
    estaDentroDe(raizFuentes, path.resolve(raizFuentes, '../fuera.js')),
    false
  );
}

async function listarArchivosJavaScript(directorio) {
  const entradas = await readdir(directorio, { withFileTypes: true });
  const archivos = [];
  for (const entrada of entradas) {
    const ruta = path.join(directorio, entrada.name);
    if (entrada.isDirectory()) {
      archivos.push(...await listarArchivosJavaScript(ruta));
    } else if (entrada.isFile() && entrada.name.endsWith('.js')) {
      archivos.push(ruta);
    }
  }
  return archivos.sort((a, b) => a.localeCompare(b, 'en'));
}

function extraerEspecificadoresImportacion(fuente) {
  validarSintaxisImportacionesAnalizable(fuente);
  const especificadores = [];
  const patron = /(?:\bimport\s+(?:[^'";]+?\s+from\s+)?|\bexport\s+[^'";]+?\s+from\s+|\bimport\s*\()(['"])([^'"]+)\1/g;
  for (const coincidencia of fuente.matchAll(patron)) {
    especificadores.push(coincidencia[2]);
  }
  return especificadores;
}

function validarSintaxisImportacionesAnalizable(fuente) {
  if (
    /\b(?:import|export)\s*\/[/*]/.test(fuente) ||
    /\b(?:import|export)\b[^;]*\/[/*][^;]*\bfrom\b/s.test(fuente) ||
    /\bfrom\s*\/[/*]/.test(fuente)
  ) {
    throw new Error('sintaxis de importacion no analizable');
  }
  const patronDinamico = /\bimport\s*\(([^)]*)\)/gs;
  for (const coincidencia of fuente.matchAll(patronDinamico)) {
    if (!/^\s*(['"])[^'"]+\1\s*$/.test(coincidencia[1])) {
      throw new Error('sintaxis de importacion no analizable');
    }
  }
}

function estaDentroDe(directorio, candidato) {
  const relativa = path.relative(directorio, candidato);
  return relativa !== '' && !relativa.startsWith(`..${path.sep}`) && relativa !== '..' && !path.isAbsolute(relativa);
}
