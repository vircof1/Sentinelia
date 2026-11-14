import { spawn } from 'node:child_process';

for (const script of [
  "correo-verificar-trigger-5-27-8a.js",
  "correo-verificar-trigger-5-27-8b.js",
  "correo-verificar-trigger-5-27-8c.js",
  "correo-verificar-trigger-5-27-9a.js",
  "correo-verificar-trigger-5-27-9b.js"
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
console.log('[gate:correo:aceptacion-portal] OK.');
