import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { generarUuidV7Auditoria } from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import { FuenteEntropiaCriptograficaNode } from '../paquetes/federacion/adaptadores/FuenteEntropiaCriptograficaNode.js';
import { canonicalizarJsonFederacion } from '../paquetes/federacion/src/CanonicalizadorFederacion.js';
import {
  crearDeclaracionCapacidadReceptoraFederacion
} from '../paquetes/federacion/src/ConfiguracionFederacion.js';
import {
  FAMILIAS_FEDERACION,
  VERSION_PROTOCOLO_FEDERACION,
  VERSIONES_FAMILIA_FEDERACION
} from '../paquetes/federacion/src/CatalogosFederacion.js';
import {
  validarDeclaracionDisponibilidadFederacion
} from '../paquetes/federacion/src/DisponibilidadFederacion.js';
import {
  esFechaUtcCanonicaFederacion
} from '../paquetes/federacion/src/FechaUtcFederacion.js';
import {
  GeneradorIdentidadesFederadas,
  TIPOS_IDENTIDAD_FEDERADA
} from '../paquetes/federacion/src/IdentidadFederada.js';
import {
  validarPayloadMonitoresFederacion
} from '../paquetes/federacion/src/PayloadMonitoresFederacion.js';

const ejecutarArchivo = promisify(execFile);
const raizProyecto = fileURLToPath(new URL('../', import.meta.url));
const generador = new GeneradorIdentidadesFederadas({
  fuenteEntropia: new FuenteEntropiaCriptograficaNode()
});
const regresiones = Object.freeze([
  ['5.22.11g', 'scripts/federacion-verificar-5-22-11g.js', /OK 5\.22\.11g/u],
  ['5.22.14f', 'scripts/federacion-verificar-5-22-14f.js', /OK 5\.22\.14f/u],
  ['5.22.14g', 'scripts/federacion-verificar-5-22-14g.js', /OK 5\.22\.14g/u],
  ['5.22.15p', 'scripts/federacion-verificar-5-22-15p.js', /OK 5\.22\.15p/u],
  ['5.22.17c', 'scripts/federacion-verificar-5-22-17c.js', /OK 5\.22\.17c/u]
]);

await main();

async function main() {
  await verificarRegistro();
  verificarVersionesCerradas();
  verificarUtcCanonico();
  verificarJsonHostil();
  await verificarRegresionesDeDominio();
  console.log(
    '[federacion] OK 5.22.19e: versiones=exactas reloj=utc_canonico ' +
    'payload_hostil=rechazado parcialidad=conserva_frontera ' +
    'divergencia=fallo_seguro retirada_sensible=irreversible'
  );
}

async function verificarRegistro() {
  const [fechaUtc, disponibilidad, ...validadores] = await Promise.all([
    leer('../paquetes/federacion/src/FechaUtcFederacion.js'),
    leer('../paquetes/federacion/src/DisponibilidadFederacion.js'),
    ...[
      'PayloadMonitoresFederacion.js',
      'PayloadTelemetriaFederacion.js',
      'PayloadContextoOperativoAgentesSesionesFederacion.js',
      'PayloadAuditoriaFederada.js',
      'PayloadAvisosFederados.js',
      'PayloadTriggersInformativosFederacion.js',
      'PayloadEstructuraOrganizativaFederacion.js'
    ].map((archivo) => leer(`../paquetes/federacion/src/${archivo}`))
  ]);
  assert.match(fechaUtc, /toISOString\(\) === valor/u);
  assert.match(disponibilidad, /normalizarJsonFederacion\(entrada\)/u);
  assert.match(disponibilidad, /esFechaUtcCanonicaFederacion/u);
  for (const fuente of validadores) {
    assert.match(fuente, /normalizarJsonFederacion\(payload\)/u);
  }
  for (const fuente of validadores.slice(0, -1)) {
    assert.match(fuente, /esFechaUtcCanonicaFederacion/u);
  }
}

function verificarVersionesCerradas() {
  const base = {
    configuracion: {},
    familiasSoportadas: ['monitores'],
    versionesFamilia: { monitores: VERSIONES_FAMILIA_FEDERACION.monitores },
    protocoloVersion: VERSION_PROTOCOLO_FEDERACION
  };
  const declaracion = crearDeclaracionCapacidadReceptoraFederacion(base);
  assert.deepEqual(declaracion.familiasSoportadas, ['monitores']);
  assert.throws(
    () => crearDeclaracionCapacidadReceptoraFederacion({
      ...base, protocoloVersion: VERSION_PROTOCOLO_FEDERACION + 1
    }),
    (error) => error.codigo === 'version_protocolo_incompatible'
  );
  assert.throws(
    () => crearDeclaracionCapacidadReceptoraFederacion({
      ...base,
      versionesFamilia: {
        monitores: VERSIONES_FAMILIA_FEDERACION.monitores + 1
      }
    }),
    (error) => error.codigo === 'version_familia_incompatible'
  );
  assert.deepEqual([...FAMILIAS_FEDERACION.valores].sort(), [
    'auditoria', 'avisosFederados', 'contextoOperativoAgentesSesiones',
    'estructuraOrganizativa', 'monitores', 'telemetria',
    'triggersInformativos'
  ]);
}

function verificarUtcCanonico() {
  assert.equal(esFechaUtcCanonicaFederacion('2032-02-29T23:59:59.999Z'), true);
  for (const fecha of [
    '2031-02-29T00:00:00.000Z',
    '2031-02-31T00:00:00.000Z',
    '2031-01-01T24:00:00.000Z',
    '2031-01-01T00:00:00Z',
    '2031-01-01T01:00:00.000+01:00',
    'no-es-fecha'
  ]) assert.equal(esFechaUtcCanonicaFederacion(fecha), false, fecha);

  const declaracion = {
    perfil: 'sentinelia-federacion-disponibilidad-v1',
    version: 1,
    declaracionId: generarUuidV7Auditoria(),
    relacionId: identidad(TIPOS_IDENTIDAD_FEDERADA.RELACION),
    flujoId: identidad(TIPOS_IDENTIDAD_FEDERADA.FLUJO),
    generacionId: identidad(TIPOS_IDENTIDAD_FEDERADA.GENERACION),
    installationDeclaranteId: identidad(TIPOS_IDENTIDAD_FEDERADA.INSTALACION),
    familia: 'monitores',
    tipo: 'rangoDisponible',
    inicioPosicion: '1',
    finPosicion: '1',
    causa: 'inventarioFuente',
    rutasAlternativasAgotadas: false,
    declaradaEnOrigenUtc: '2032-02-29T23:59:59.999Z'
  };
  assert.equal(
    validarDeclaracionDisponibilidadFederacion(declaracion).declaradaEnOrigenUtc,
    declaracion.declaradaEnOrigenUtc
  );
  assert.throws(
    () => validarDeclaracionDisponibilidadFederacion({
      ...declaracion, declaradaEnOrigenUtc: '2031-02-31T00:00:00.000Z'
    }),
    (error) => error.codigo === 'fecha_disponibilidad_invalida'
  );
}

function verificarJsonHostil() {
  const circular = {};
  circular.circular = circular;
  const conGetter = {};
  Object.defineProperty(conGetter, 'secreto', {
    enumerable: true,
    get() { assert.fail('La canonicalización no debe ejecutar getters.'); }
  });
  assert.throws(
    () => validarPayloadMonitoresFederacion(conGetter),
    (error) => error.codigo === 'propiedad_no_json'
  );
  const disperso = [];
  disperso.length = 1;
  const profundo = {};
  let cursor = profundo;
  for (let nivel = 0; nivel < 258; nivel += 1) {
    cursor.siguiente = {};
    cursor = cursor.siguiente;
  }
  for (const [valor, codigo] of [
    [circular, 'referencia_circular'],
    [conGetter, 'propiedad_no_json'],
    [disperso, 'array_con_huecos'],
    [profundo, 'profundidad_json_excedida'],
    [{ numero: Number.NaN }, 'numero_no_finito'],
    [{ unicode: '\ud800' }, 'unicode_invalido'],
    [Object.assign(Object.create(null), { dato: true }), 'objeto_no_plano']
  ]) {
    assert.throws(
      () => canonicalizarJsonFederacion(valor),
      (error) => error.codigo === codigo,
      codigo
    );
  }
}

async function verificarRegresionesDeDominio() {
  for (const [id, archivo, marcador] of regresiones) {
    const { stdout = '', stderr = '' } = await ejecutarArchivo(
      process.execPath,
      [archivo],
      {
        cwd: raizProyecto,
        env: process.env,
        encoding: 'utf8',
        timeout: 900_000,
        maxBuffer: 32 * 1024 * 1024,
        windowsHide: true
      }
    );
    assert.equal(stderr.trim(), '', `${id} escribió en stderr.`);
    assert.match(stdout, marcador, `${id} no confirmó su garantía.`);
    console.log(`[federacion] OK matriz adversa ${id}`);
  }
}

function identidad(tipo) {
  return String(generador.generar(tipo));
}

function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}
