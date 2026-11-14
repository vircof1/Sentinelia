import { spawn } from 'node:child_process';

for (const script of [
  'triggers-verificar-edicion-configuracion-sql.js',
  'triggers-verificar-administracion-auditable.js',
  'triggers-verificar-listado-visible.js'
]) await ejecutar(script);

console.log('[gate:triggers:administracion] OK: persistencia, auditoría y listado visible verificados.');

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
