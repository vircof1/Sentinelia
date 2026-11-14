import { spawn } from 'node:child_process';

for (const script of [
  'organizacion-verificar-eliminacion-5-26-1a.js',
  'organizacion-verificar-eliminaciones-auditables.js'
]) await ejecutar(script);

console.log('[gate:organizacion:eliminacion-segura] OK: frontera transaccional y eliminación auditable verificadas.');

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
