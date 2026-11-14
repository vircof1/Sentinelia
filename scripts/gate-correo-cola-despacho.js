import { spawn } from 'node:child_process';

for (const script of [
  "correo-verificar-trigger-5-27-6a.js",
  "correo-verificar-trigger-5-27-6b.js",
  "correo-verificar-trigger-5-27-6c.js",
  "correo-verificar-trigger-5-27-6d.js",
  "correo-verificar-trigger-5-27-7a.js",
  "correo-verificar-trigger-5-27-7b.js"
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
console.log('[gate:correo:cola-despacho] OK.');
