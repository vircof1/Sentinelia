import { spawn } from 'node:child_process';

for (const script of [
  "organizacion-verificar-eliminacion-5-26-12a.js",
  "organizacion-verificar-eliminacion-5-26-12b.js",
  "organizacion-verificar-eliminacion-5-26-13b.js"
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
console.log('[gate:organizacion:portal-despliegue] OK.');
