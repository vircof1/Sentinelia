import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  CATALOGOS_FEDERACION,
  CAUSAS_OMISION_CAMPO_FEDERADO,
  ERRORES_TEMPORALES_FEDERACION,
  ERRORES_TERMINALES_FEDERACION,
  ESTADOS_CAMPO_FEDERADO,
  FAMILIAS_FEDERACION,
  NIVELES_SCOPE_FEDERACION,
  OPERACIONES_OCURRENCIA_FEDERACION,
  PERFIL_CATALOGOS_FEDERACION,
  RESULTADOS_OCURRENCIA_FEDERACION,
  SENSIBILIDADES_CAMPO_FEDERADO,
  VERSION_CATALOGOS_FEDERACION,
  VERSION_PROTOCOLO_FEDERACION,
  VERSIONES_FAMILIA_FEDERACION
} from '../paquetes/federacion/src/CatalogosFederacion.js';
import { canonicalizarJsonFederacion } from '../paquetes/federacion/src/CanonicalizadorFederacion.js';
import {
  listarContratosFamiliasFederacion,
  obtenerContratoFamiliaFederacion,
  PERFIL_CONTRATOS_FAMILIAS_FEDERACION,
  VERSION_CONTRATOS_FAMILIAS_FEDERACION
} from '../paquetes/federacion/src/ContratosFamiliasFederacion.js';
import {
  PERFIL_PAYLOAD_AUDITORIA_FEDERADA,
  VERSION_PAYLOAD_AUDITORIA_FEDERADA
} from '../paquetes/federacion/src/PayloadAuditoriaFederada.js';
import {
  PERFIL_PAYLOAD_AVISOS_FEDERADOS,
  VERSION_PAYLOAD_AVISOS_FEDERADOS
} from '../paquetes/federacion/src/PayloadAvisosFederados.js';
import {
  PERFIL_PAYLOAD_CONTEXTO_OPERATIVO_AGENTES_SESIONES_FEDERACION,
  VERSION_PAYLOAD_CONTEXTO_OPERATIVO_AGENTES_SESIONES_FEDERACION
} from '../paquetes/federacion/src/PayloadContextoOperativoAgentesSesionesFederacion.js';
import {
  PERFIL_PAYLOAD_ESTRUCTURA_ORGANIZATIVA_FEDERACION,
  VERSION_PAYLOAD_ESTRUCTURA_ORGANIZATIVA_FEDERACION
} from '../paquetes/federacion/src/PayloadEstructuraOrganizativaFederacion.js';
import {
  PERFIL_PAYLOAD_MONITORES_FEDERACION,
  VERSION_PAYLOAD_MONITORES_FEDERACION
} from '../paquetes/federacion/src/PayloadMonitoresFederacion.js';
import {
  PERFIL_PAYLOAD_TELEMETRIA_FEDERACION,
  VERSION_PAYLOAD_TELEMETRIA_FEDERACION
} from '../paquetes/federacion/src/PayloadTelemetriaFederacion.js';
import {
  PERFIL_PAYLOAD_TRIGGERS_INFORMATIVOS_FEDERACION,
  VERSION_PAYLOAD_TRIGGERS_INFORMATIVOS_FEDERACION
} from '../paquetes/federacion/src/PayloadTriggersInformativosFederacion.js';

const ejecutarArchivo = promisify(execFile);
const raizNode = fileURLToPath(new URL('../', import.meta.url));
// 5.22.22g versiona explícitamente la asimetría de transporte sin alterar
// los esquemas de familias que este gate protege.
const HUELLA_OPENAPI_CONGELADA =
  '7f569c57c6322fdf0e497317cdb691511bb2ddc2caec6128734bf349bc9491fb';
const HUELLA_CATALOGOS_CONGELADA =
  '537591dae4d563bc6c7ecb4b38e75fe827a365993997996292d369ab3fac1e98';

const familiasEjecutables = Object.freeze([
  ['estructuraOrganizativa', '5.22.15b'],
  ['contextoOperativoAgentesSesiones', '5.22.15c'],
  ['telemetria', '5.22.15d'],
  ['monitores', '5.22.15e'],
  ['triggersInformativos', '5.22.15f'],
  ['auditoria', '5.22.15g'],
  ['avisosFederados', '5.22.15h']
]);

const metadatosPayload = Object.freeze({
  estructuraOrganizativa: payload(
    PERFIL_PAYLOAD_ESTRUCTURA_ORGANIZATIVA_FEDERACION,
    VERSION_PAYLOAD_ESTRUCTURA_ORGANIZATIVA_FEDERACION,
    'validarPayloadEstructuraOrganizativaFederacion'
  ),
  monitores: payload(
    PERFIL_PAYLOAD_MONITORES_FEDERACION,
    VERSION_PAYLOAD_MONITORES_FEDERACION,
    'validarPayloadMonitoresFederacion'
  ),
  telemetria: payload(
    PERFIL_PAYLOAD_TELEMETRIA_FEDERACION,
    VERSION_PAYLOAD_TELEMETRIA_FEDERACION,
    'validarPayloadTelemetriaFederacion'
  ),
  triggersInformativos: payload(
    PERFIL_PAYLOAD_TRIGGERS_INFORMATIVOS_FEDERACION,
    VERSION_PAYLOAD_TRIGGERS_INFORMATIVOS_FEDERACION,
    'validarPayloadTriggersInformativosFederacion'
  ),
  auditoria: payload(
    PERFIL_PAYLOAD_AUDITORIA_FEDERADA,
    VERSION_PAYLOAD_AUDITORIA_FEDERADA,
    'validarPayloadAuditoriaFederada'
  ),
  avisosFederados: payload(
    PERFIL_PAYLOAD_AVISOS_FEDERADOS,
    VERSION_PAYLOAD_AVISOS_FEDERADOS,
    'validarPayloadAvisosFederados'
  ),
  contextoOperativoAgentesSesiones: payload(
    PERFIL_PAYLOAD_CONTEXTO_OPERATIVO_AGENTES_SESIONES_FEDERACION,
    VERSION_PAYLOAD_CONTEXTO_OPERATIVO_AGENTES_SESIONES_FEDERACION,
    'validarPayloadContextoOperativoAgentesSesionesFederacion'
  )
});

await main();

async function main() {
  const [openapi, packageJson] = await Promise.all([
    leer('../openapi/federacion-control.v1.yaml'),
    leer('../package.json').then(JSON.parse)
  ]);
  verificarYamlSinClavesDuplicadas(openapi);
  verificarReferencias(openapi);
  verificarHuellaOpenApi(openapi);
  verificarHuellaCatalogos();
  verificarCatalogosWireExactos(openapi);
  verificarContratosFamilias(openapi);
  await verificarFamiliasEjecutables(packageJson.scripts);
  console.log(
    '[federacion] OK 5.22.20b: openapi=congelado catalogos=27 ' +
    'familias=7 payloads=7 resultados=9 errores_terminales=17 ' +
    'errores_temporales=4 yaml=sin_duplicados contratos_cruzados=7'
  );
}

function verificarHuellaOpenApi(openapi) {
  assert.equal(sha256(openapi), HUELLA_OPENAPI_CONGELADA);
  assert.match(openapi, /^openapi: 3\.1\.0$/mu);
  assert.match(openapi, /^  version: 1\.0\.0-beta\.2$/mu);
}

function verificarHuellaCatalogos() {
  const manifiesto = {
    perfilCatalogos: PERFIL_CATALOGOS_FEDERACION,
    versionCatalogos: VERSION_CATALOGOS_FEDERACION,
    versionProtocolo: VERSION_PROTOCOLO_FEDERACION,
    catalogos: Object.fromEntries(Object.entries(CATALOGOS_FEDERACION)
      .map(([nombre, catalogo]) => [nombre, catalogo.toJSON()])),
    versionesFamilia: VERSIONES_FAMILIA_FEDERACION,
    perfilContratos: PERFIL_CONTRATOS_FAMILIAS_FEDERACION,
    versionContratos: VERSION_CONTRATOS_FAMILIAS_FEDERACION,
    contratos: listarContratosFamiliasFederacion()
  };
  assert.equal(
    sha256(canonicalizarJsonFederacion(manifiesto)),
    HUELLA_CATALOGOS_CONGELADA
  );
  assert.equal(Object.keys(CATALOGOS_FEDERACION).length, 27);
}

function verificarCatalogosWireExactos(openapi) {
  assert.deepEqual(
    enumComponente(openapi, 'FederationFamily'),
    FAMILIAS_FEDERACION.valores
  );
  assert.deepEqual(
    enumPropiedad(openapi, 'FederationScope', 'nivel'),
    NIVELES_SCOPE_FEDERACION.valores
  );
  assert.deepEqual(
    enumPropiedad(openapi, 'FederationPresentField', 'sensibilidad'),
    SENSIBILIDADES_CAMPO_FEDERADO.valores
  );
  assert.deepEqual(
    enumPropiedad(openapi, 'FederationOmittedField', 'causa'),
    CAUSAS_OMISION_CAMPO_FEDERADO.valores
  );
  assert.deepEqual(
    [
      enumPropiedad(openapi, 'FederationPresentField', 'estado')[0],
      enumPropiedad(openapi, 'FederationOmittedField', 'estado')[0],
      enumPropiedad(openapi, 'FederationWithdrawnField', 'estado')[0]
    ],
    ESTADOS_CAMPO_FEDERADO.valores
  );
  assert.deepEqual(
    enumPropiedad(openapi, 'FederationOriginOccurrence', 'operacion'),
    OPERACIONES_OCURRENCIA_FEDERACION.valores
  );
  assert.deepEqual(
    enumPropiedad(openapi, 'FederationDeliveryResult', 'clasificacion'),
    ['terminal', 'temporal']
  );
  assert.deepEqual(
    enumPropiedad(openapi, 'FederationDeliveryResult', 'resultado'),
    RESULTADOS_OCURRENCIA_FEDERACION.valores
  );
  assert.deepEqual(
    enumComponente(openapi, 'FederationTerminalError'),
    ERRORES_TERMINALES_FEDERACION.valores
  );
  assert.deepEqual(
    enumComponente(openapi, 'FederationTemporaryError'),
    ERRORES_TEMPORALES_FEDERACION.valores
  );
}

function verificarContratosFamilias(openapi) {
  const extension = extraerEntre(
    openapi,
    'x-sentinelia-family-contracts:',
    '\npaths:'
  );
  assert.match(
    extension,
    new RegExp(`^  profile: ${PERFIL_CONTRATOS_FAMILIAS_FEDERACION}$`, 'mu')
  );
  assert.match(
    extension,
    new RegExp(`^  version: ${VERSION_CONTRATOS_FAMILIAS_FEDERACION}$`, 'mu')
  );
  const declaradas = [...extension.matchAll(/^    ([a-z][A-Za-z0-9]+):$/gmu)]
    .map((coincidencia) => coincidencia[1]);
  assert.deepEqual(declaradas, FAMILIAS_FEDERACION.valores);
  for (const familia of FAMILIAS_FEDERACION.valores) {
    const contrato = obtenerContratoFamiliaFederacion(familia);
    const payloadFamilia = metadatosPayload[familia];
    const bloque = extraerFamiliaExtension(extension, familia);
    assert.equal(enteroPropiedad(bloque, 'familyVersion'), contrato.versionFamilia);
    assert.equal(textoPropiedad(bloque, 'field'), contrato.selector.campoBase);
    assert.equal(textoPropiedad(bloque, 'payloadProfile'), payloadFamilia.perfil);
    assert.equal(enteroPropiedad(bloque, 'payloadVersion'), payloadFamilia.version);
    assert.deepEqual(listaPropiedad(bloque, 'recordTypes'), contrato.tiposRegistro);
    assert.equal(textoPropiedad(bloque, 'runtimeValidator'), payloadFamilia.validador);
  }
}

async function verificarFamiliasEjecutables(scripts) {
  for (const [familia, unidad] of familiasEjecutables) {
    const comando = `federacion:verificar-${unidad.replaceAll('.', '-')}`;
    const archivo = `scripts/federacion-verificar-${unidad.replaceAll('.', '-')}.js`;
    assert.equal(scripts[comando], `node ${archivo}`);
    let resultado;
    try {
      resultado = await ejecutarArchivo(
        process.execPath,
        [archivo],
        {
          cwd: raizNode,
          env: process.env,
          encoding: 'utf8',
          timeout: 900_000,
          maxBuffer: 32 * 1024 * 1024,
          windowsHide: true
        }
      );
    } catch (error) {
      const codigo = Number.isInteger(error?.code) ? error.code : 'desconocido';
      const senal = typeof error?.signal === 'string' ? error.signal : 'ninguna';
      throw new Error(
        `Falló el contrato ejecutable ${unidad}/${familia}; ` +
        `codigo=${codigo} senal=${senal}.`
      );
    }
    const stdout = resultado.stdout || '';
    const stderr = resultado.stderr || '';
    if (stderr.trim()) {
      throw new Error(`${unidad}/${familia} escribió un diagnóstico inesperado.`);
    }
    if (!new RegExp(`OK ${escaparRegex(unidad)}`, 'u').test(stdout)) {
      throw new Error(`${unidad}/${familia} no publicó su marcador de cierre.`);
    }
  }
}

function verificarYamlSinClavesDuplicadas(yaml) {
  assert.throws(
    () => exigirYamlSinClavesDuplicadas('raiz:\n  repetida: 1\n  repetida: 2\n'),
    /Clave YAML duplicada/u
  );
  assert.throws(
    () => exigirYamlSinClavesDuplicadas(
      'items:\n  - nombre: primero\n    nombre: segundo\n'
    ),
    /Clave YAML duplicada/u
  );
  assert.doesNotThrow(() => exigirYamlSinClavesDuplicadas(
    'items:\n  - nombre: primero\n  - nombre: segundo\n'
  ));
  exigirYamlSinClavesDuplicadas(yaml);
}

function exigirYamlSinClavesDuplicadas(yaml) {
  const marcos = [];
  let bloqueLiteralIndentacion = null;
  for (const [indice, linea] of yaml.split(/\r?\n/u).entries()) {
    if (!linea.trim() || linea.trimStart().startsWith('#')) continue;
    const indentacion = linea.length - linea.trimStart().length;
    if (bloqueLiteralIndentacion !== null) {
      if (indentacion > bloqueLiteralIndentacion) continue;
      bloqueLiteralIndentacion = null;
    }
    if (linea.trimStart().startsWith('- ')) {
      const indentacionElemento = indentacion + 2;
      while (marcos.length > 0 &&
          marcos.at(-1).indentacion >= indentacionElemento) {
        marcos.pop();
      }
      const contenidoElemento = linea.trimStart().slice(2);
      registrarClaveYaml({
        linea: `${' '.repeat(indentacionElemento)}${contenidoElemento}`,
        indice,
        marcos,
        indentacion: indentacionElemento
      });
      continue;
    }
    while (marcos.length > 0 && marcos.at(-1).indentacion > indentacion) {
      marcos.pop();
    }
    const valor = registrarClaveYaml({ linea, indice, marcos, indentacion });
    if (valor !== null && /^[>|][+-]?$/u.test(valor.trim())) {
      bloqueLiteralIndentacion = indentacion;
    }
  }
}

function registrarClaveYaml({ linea, indice, marcos, indentacion }) {
  const coincidencia = /^\s*([A-Za-z0-9_./{}-]+|"[^"]+"|'[^']+'):\s*(.*)$/u.exec(linea);
  if (!coincidencia) return null;
  let marco = marcos.at(-1)?.indentacion === indentacion ? marcos.at(-1) : null;
  if (!marco && marcos.some((entrada) => entrada.indentacion === indentacion)) {
    while (marcos.length > 0 && marcos.at(-1).indentacion >= indentacion) {
      marcos.pop();
    }
  }
  if (!marco) {
    marco = { indentacion, claves: new Set() };
    marcos.push(marco);
  }
  const clave = coincidencia[1];
  if (marco.claves.has(clave)) {
    throw new Error(`Clave YAML duplicada ${clave} en línea ${indice + 1}.`);
  }
  marco.claves.add(clave);
  return coincidencia[2];
}

function verificarReferencias(openapi) {
  const declarados = new Set(
    [...openapi.matchAll(/^    ([A-Za-z][A-Za-z0-9]+):\s*$/gmu)]
      .map((coincidencia) => coincidencia[1])
  );
  for (const coincidencia of openapi.matchAll(
    /#\/components\/(?:schemas|responses)\/([A-Za-z][A-Za-z0-9]+)/gu
  )) {
    assert.ok(declarados.has(coincidencia[1]),
      `Referencia OpenAPI no declarada: ${coincidencia[1]}`);
  }
}

function enumComponente(openapi, nombre) {
  return extraerEnum(extraerComponente(openapi, nombre));
}

function enumPropiedad(openapi, componente, propiedad) {
  return extraerEnum(extraerPropiedad(extraerComponente(openapi, componente), propiedad));
}

function extraerEnum(bloque) {
  const inline = bloque.match(/\benum:\s*\[([^\]]*)\]/u);
  if (inline) return inline[1].split(',').map((valor) => valor.trim());
  const inicio = bloque.search(/^\s+enum:\s*$/mu);
  if (inicio >= 0) {
    const resto = bloque.slice(inicio).split(/\r?\n/u).slice(1);
    const valores = [];
    for (const linea of resto) {
      const coincidencia = /^\s+-\s+([A-Za-z0-9_]+)\s*$/u.exec(linea);
      if (!coincidencia) break;
      valores.push(coincidencia[1]);
    }
    if (valores.length > 0) return valores;
  }
  const constante = bloque.match(/\bconst:\s*(?:"([^"]+)"|'([^']+)'|([^\s},]+))/u);
  assert.ok(constante, 'El bloque OpenAPI no declara enum ni const.');
  return [constante[1] ?? constante[2] ?? constante[3]];
}

function extraerComponente(openapi, nombre) {
  const inicio = openapi.indexOf(`    ${nombre}:`);
  assert.notEqual(inicio, -1, `Falta el componente OpenAPI ${nombre}.`);
  const resto = openapi.slice(inicio + 4);
  const siguiente = resto.search(/^    [A-Za-z][A-Za-z0-9]+:\s*$/mu);
  return siguiente < 0 ? openapi.slice(inicio) : openapi.slice(inicio, inicio + 4 + siguiente);
}

function extraerPropiedad(componente, propiedad) {
  const marcador = new RegExp(`^        ${escaparRegex(propiedad)}:`, 'mu');
  const coincidencia = marcador.exec(componente);
  assert.ok(coincidencia, `Falta la propiedad OpenAPI ${propiedad}.`);
  const inicio = coincidencia.index;
  const resto = componente.slice(inicio + 8);
  const siguiente = resto.search(/^        [A-Za-z][A-Za-z0-9]+:/mu);
  return siguiente < 0
    ? componente.slice(inicio)
    : componente.slice(inicio, inicio + 8 + siguiente);
}

function extraerFamiliaExtension(extension, familia) {
  const inicio = extension.indexOf(`    ${familia}:`);
  assert.notEqual(inicio, -1, `OpenAPI no declara metadatos para ${familia}.`);
  const resto = extension.slice(inicio + 4);
  const siguiente = resto.search(/^    [a-z][A-Za-z0-9]+:$/mu);
  return siguiente < 0
    ? extension.slice(inicio)
    : extension.slice(inicio, inicio + 4 + siguiente);
}

function textoPropiedad(bloque, nombre) {
  const coincidencia = new RegExp(`^      ${nombre}: ([^\\s]+)$`, 'mu').exec(bloque);
  assert.ok(coincidencia, `Falta ${nombre} en el contrato de familia OpenAPI.`);
  return coincidencia[1];
}

function enteroPropiedad(bloque, nombre) {
  const valor = Number(textoPropiedad(bloque, nombre));
  assert.ok(Number.isInteger(valor));
  return valor;
}

function listaPropiedad(bloque, nombre) {
  const coincidencia = new RegExp(`^      ${nombre}: \\[([^\\]]*)\\]$`, 'mu')
    .exec(bloque);
  assert.ok(coincidencia, `Falta ${nombre} en el contrato de familia OpenAPI.`);
  return coincidencia[1].split(',').map((valor) => valor.trim()).filter(Boolean);
}

function extraerEntre(texto, inicioTexto, finTexto) {
  const inicio = texto.indexOf(inicioTexto);
  const fin = texto.indexOf(finTexto, inicio);
  assert.ok(inicio >= 0 && fin > inicio);
  return texto.slice(inicio, fin);
}

function payload(perfil, version, validador) {
  return Object.freeze({ perfil, version, validador });
}

function sha256(valor) {
  return createHash('sha256').update(valor).digest('hex');
}

function escaparRegex(valor) {
  return valor.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}
