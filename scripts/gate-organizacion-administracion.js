import { spawn } from 'node:child_process';

for (const script of [
  'organizacion-verificar-crud-auditable.js',
  'organizacion-verificar-movimientos-auditables.js'
]) {
  await new Promise((resolve, reject) => {
    const proceso = spawn(process.execPath, ['scripts/' + script], {
      cwd: new URL('..', import.meta.url), env: process.env, stdio: 'inherit'
    });
    proceso.once('error', reject);
    proceso.once('exit', (codigo, senal) => codigo === 0 ? resolve() : reject(
      new Error(script + ' terminó con ' + (senal || codigo) + '.')
    ));
  });
}
console.log('[gate:organizacion:administracion] OK: catálogo físico, CRUD y movimientos auditables verificados.');
