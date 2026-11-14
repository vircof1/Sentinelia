import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as esperar } from 'node:timers/promises';
import test from 'node:test';
import { descubrirGates, ejecutarProcesoGate } from './ejecutor-gates.js';

test('descubre los gates, conserva su orden y excluye el agregador', () => {
  const scripts = { 'gates:todas': 'agregador', 'gate:b': 'b', start: 'app', 'gate:a': 'a' };
  assert.deepEqual(descubrirGates(scripts), ['gate:b', 'gate:a']);
  assert.deepEqual(descubrirGates(scripts, ['gate:a', 'gate:b', 'gate:a']), ['gate:b', 'gate:a']);
  assert.throws(() => descubrirGates(scripts, ['gate:ausente']), /desconocida/u);
});

test('recoge stdout y stderr en un log privado', async () => {
  await conDirectorio(async (directorio) => {
    const log = path.join(directorio, 'correcto.log');
    const resultado = await ejecutar(directorio, log,
      'process.stdout.write("SALIDA"); process.stderr.write("DIAGNOSTICO");');
    assert.equal(resultado.estado, 'correcto');
    const contenido = await readFile(log, 'utf8');
    assert.match(contenido, /SALIDA/u);
    assert.match(contenido, /DIAGNOSTICO/u);
    assert.equal((await stat(log)).mode & 0o777, 0o600);
  });
});

test('un fallo conserva el código y permite ejecutar la siguiente prueba', async () => {
  await conDirectorio(async (directorio) => {
    const fallida = await ejecutar(directorio, path.join(directorio, 'fallida.log'), 'process.exit(23)');
    assert.equal(fallida.estado, 'fallido');
    assert.equal(fallida.codigo, 23);
    const siguiente = await ejecutar(directorio, path.join(directorio, 'siguiente.log'), 'process.exit(0)');
    assert.equal(siguiente.estado, 'correcto');
  });
});

test('un ejecutable ausente se informa como error', async () => {
  await conDirectorio(async (directorio) => {
    const resultado = await ejecutarProcesoGate({ comando: path.join(directorio, 'no-existe'),
      argumentos: [], cwd: directorio, env: process.env,
      log: path.join(directorio, 'ausente.log'), timeoutMs: 1000 });
    assert.equal(resultado.estado, 'error');
    assert.equal(resultado.error, 'ENOENT');
  });
});

test('el timeout termina también al descendiente que sigue escribiendo', async () => {
  await conDirectorio(async (directorio) => {
    const latido = path.join(directorio, 'latido');
    const nieto = `const fs=require('node:fs'); setInterval(()=>fs.appendFileSync(${JSON.stringify(latido)},'x'),20);`;
    const padre = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(nieto)}],{stdio:'ignore'}); setInterval(()=>{},1000);`;
    const resultado = await ejecutar(directorio, path.join(directorio, 'timeout.log'), padre, { timeoutMs: 1000 });
    assert.equal(resultado.estado, 'timeout');
    const antes = await readFile(latido, 'utf8');
    assert.ok(antes.length > 0);
    await esperar(150);
    assert.equal(await readFile(latido, 'utf8'), antes);
  });
});

test('la cancelación detiene el proceso y se distingue de un fallo', async () => {
  await conDirectorio(async (directorio) => {
    const controlador = new AbortController();
    const cancelar = setTimeout(() => controlador.abort(), 100);
    try {
      const resultado = await ejecutar(directorio, path.join(directorio, 'interrumpido.log'),
        'setInterval(()=>{},1000)', { signal: controlador.signal });
      assert.equal(resultado.estado, 'interrumpido');
    } finally {
      clearTimeout(cancelar);
    }
  });
});

test('una cancelación previa no lanza el proceso', async () => {
  await conDirectorio(async (directorio) => {
    const controlador = new AbortController();
    controlador.abort();
    const log = path.join(directorio, 'no-creado.log');
    const resultado = await ejecutar(directorio, log, 'process.exit(99)', { signal: controlador.signal });
    assert.equal(resultado.estado, 'interrumpido');
    await assert.rejects(stat(log), { code: 'ENOENT' });
  });
});

async function ejecutar(cwd, log, codigo, opciones = {}) {
  return ejecutarProcesoGate({ comando: process.execPath, argumentos: ['-e', codigo],
    cwd, log, env: process.env, timeoutMs: 5000, graciaMs: 100, ...opciones });
}

async function conDirectorio(prueba) {
  const directorio = await mkdtemp(path.join(tmpdir(), 'sentinelia-ejecutor-test-'));
  try { await prueba(directorio); } finally { await rm(directorio, { recursive: true, force: true }); }
}
