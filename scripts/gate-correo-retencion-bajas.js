import { spawn } from 'node:child_process';

for (const script of [
  "correo-verificar-trigger-5-27-10a.js",
  "correo-verificar-trigger-5-27-10b.js",
  "correo-verificar-trigger-5-27-11a.js",
  "correo-verificar-trigger-5-27-11b.js",
  "correo-verificar-trigger-5-27-11c.js"
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
console.log('[gate:correo:retencion-bajas] OK.');
