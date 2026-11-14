import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const ejecutar = promisify(execFile);
const raiz = path.resolve(import.meta.dirname, '..');

await verificarEsquemaInicialUnico();
await verificarContratoEntorno();
await verificarBootstrapEntornoIdempotente();
await ejecutarGate('configuracion-verificar-portal-auditable.js');
await ejecutarGate('usuarios-verificar-auditoria-bootstrap.js');

console.log(
  '[gate:base] OK: esquema=inicial_unico entorno=documentado ' +
  'secretos=propios_e_idempotentes configuracion=auditable ' +
  'usuario_inicial=atomico'
);

async function verificarEsquemaInicialUnico() {
  const directorio = path.join(raiz, 'migraciones', 'sql');
  const migraciones = (await readdir(directorio))
    .filter((nombre) => nombre.endsWith('.sql'))
    .sort();
  assert.deepEqual(migraciones, ['0001_esquema_inicial.sql']);
  const esquema = await readFile(path.join(directorio, migraciones[0]), 'utf8');
  for (const contrato of [
    'CREATE TABLE `usuarios`',
    'CREATE TABLE `cabecera_bootstrap_usuario_inicial`',
    'CREATE TABLE `configuracion_portal`'
  ]) {
    assert.ok(esquema.includes(contrato), `Falta en el esquema: ${contrato}`);
  }
}

async function verificarContratoEntorno() {
  const contenido = await readFile(path.join(raiz, '.env.ejemplo'), 'utf8');
  const lineas = contenido.split(/\r?\n/u);
  const claves = new Set();
  for (let indice = 0; indice < lineas.length; indice += 1) {
    const coincidencia = lineas[indice].match(/^([A-Z][A-Z0-9_]*)=/u);
    if (!coincidencia) continue;
    assert.ok(
      indice > 0 && lineas[indice - 1].startsWith('# '),
      `${coincidencia[1]} carece de comentario inmediato.`
    );
    assert.equal(claves.has(coincidencia[1]), false, `${coincidencia[1]} est\u00e1 duplicada.`);
    claves.add(coincidencia[1]);
  }
  for (const obsoleta of [
    'AGENTES_ELIMINACION_ADMINISTRATIVA_PERFIL_COMPATIBILIDAD',
    'DNS_RUTA_INCLUDE_GESTIONADO',
    'DNS_COMANDO_RECARGA'
  ]) {
    assert.equal(claves.has(obsoleta), false, `${obsoleta} no debe ser configurable.`);
  }
}

async function verificarBootstrapEntornoIdempotente() {
  const temporal = await mkdtemp(path.join(os.tmpdir(), 'sentinelia-gate-base-'));
  const entorno = path.join(temporal, '.env');
  try {
    const bootstrap = path.join(
      raiz,
      'despliegue',
      'docker',
      'node-bind',
      'preparar-entorno.mjs'
    );
    const plantilla = path.join(raiz, '.env.ejemplo');
    await ejecutar(process.execPath, [bootstrap, entorno, plantilla]);
    const primero = await readFile(entorno, 'utf8');
    const huellaPrimera = huella(primero);
    await ejecutar(process.execPath, [bootstrap, entorno, plantilla]);
    const segundo = await readFile(entorno, 'utf8');
    assert.equal(huella(segundo), huellaPrimera, 'El segundo bootstrap alter\u00f3 el entorno.');
    assert.equal((await stat(entorno)).mode & 0o777, 0o600);
    assert.doesNotMatch(segundo, /^[A-Z][A-Z0-9_]*=.*REEMPLAZAR_/mu);

    const valores = leerEntorno(segundo);
    assert.match(valores.SESION_SECRETO, /^[a-f0-9]{64}$/u);
    for (const [keyring, idActivo] of [
      ['AGENTES_SESION_KEYRING', 'AGENTES_SESION_KEY_ID_ACTIVA'],
      ['CORREO_KEYRING', 'CORREO_KEY_ID_ACTIVA'],
      ['FEDERACION_KEYRING', 'FEDERACION_KEY_ID_ACTIVA']
    ]) {
      const claves = JSON.parse(valores[keyring]);
      assert.ok(Object.hasOwn(claves, valores[idActivo]));
      assert.equal(Buffer.from(claves[valores[idActivo]], 'base64').length, 32);
    }
  } finally {
    await rm(temporal, { recursive: true, force: true });
  }
}

async function ejecutarGate(nombre) {
  const { stdout, stderr } = await ejecutar(process.execPath, [
    path.join(raiz, 'scripts', nombre)
  ]);
  if (stdout.trim()) process.stdout.write(stdout);
  if (stderr.trim()) process.stderr.write(stderr);
}

function leerEntorno(contenido) {
  return Object.fromEntries(contenido.split(/\r?\n/u).flatMap((linea) => {
    const indice = linea.indexOf('=');
    if (indice <= 0 || linea.startsWith('#')) return [];
    return [[linea.slice(0, indice), linea.slice(indice + 1)]];
  }));
}

function huella(valor) {
  return createHash('sha256').update(valor).digest('hex');
}
