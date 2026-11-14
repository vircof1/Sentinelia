import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const raiz = resolve(import.meta.dirname, '..');

function ejecutarScript(etiqueta, rutaScript) {
  const resultado = spawnSync(process.execPath, [rutaScript], {
    cwd: raiz,
    encoding: 'utf8'
  });

  if (resultado.stdout) {
    process.stdout.write(resultado.stdout);
  }

  if (resultado.stderr) {
    process.stderr.write(resultado.stderr);
  }

  assert.equal(
    resultado.status,
    0,
    `La verificación ${etiqueta} debe finalizar correctamente.`
  );
}

ejecutarScript('UX lógica y metadatos visibles', 'scripts/monitores-verificar-ux-logica.js');
ejecutarScript('editor visual lógico', 'scripts/monitores-verificar-editor-visual.js');
ejecutarScript('desacoplamiento runtime y proyecciones operativas', 'scripts/monitores-verificar-desacoplamiento.js');

console.log(
  '[monitores:verificar-enriquecimiento-operativo] OK: 5.18a cerrada con separación técnico/lógica, metadatos operativos y coherencia ping/tcp/booleano verificados.'
);
