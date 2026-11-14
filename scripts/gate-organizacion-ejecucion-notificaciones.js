import { spawn } from 'node:child_process';

for (const script of [
  "organizacion-verificar-eliminacion-5-26-6a.js",
  "organizacion-verificar-eliminacion-5-26-6b.js",
  "organizacion-verificar-eliminacion-5-26-7a.js",
  "organizacion-verificar-eliminacion-5-26-7b.js",
  "organizacion-verificar-eliminacion-5-26-10a.js",
  "organizacion-verificar-eliminacion-5-26-11b.js"
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
console.log('[gate:organizacion:ejecucion-notificaciones] OK.');
