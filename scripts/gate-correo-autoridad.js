import { spawn } from 'node:child_process';

for (const script of [
  "correo-verificar-trigger-5-27-1a.js",
  "correo-verificar-trigger-5-27-1b.js",
  "correo-verificar-trigger-5-27-1c.js",
  "correo-verificar-trigger-5-27-1d.js"
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
console.log('[gate:correo:autoridad] OK.');
