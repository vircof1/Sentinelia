import { spawn } from 'node:child_process';

for (const script of [
  'monitores-verificar-errores-alcance-portal.js',
  'monitores-verificar-consistencia-scope-sql.js'
]) await ejecutar(script);

console.log('[gate:monitores:alcance] OK: respuestas del portal y consistencia SQL del scope verificadas.');

function ejecutar(script) {
  return new Promise((resolve, reject) => {
    const proceso = spawn(process.execPath, ['scripts/' + script], {
      cwd: new URL('..', import.meta.url), env: process.env, stdio: 'inherit'
    });
    proceso.once('error', reject);
    proceso.once('exit', (codigo, senal) => codigo === 0 ? resolve() : reject(
      new Error(script + ' terminó con ' + (senal ? 'señal ' + senal : 'código ' + codigo) + '.')
    ));
  });
}
