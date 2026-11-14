import { spawn } from 'node:child_process';

for (const script of [
  'dns-verificar-ddns-5-28-11a.js',
  'dns-verificar-ddns-5-28-11b.js',
  'dns-verificar-ddns-5-28-11c.js',
  'dns-verificar-ddns-5-28-12a.js',
  'dns-verificar-ddns-5-28-12b.js',
  'dns-verificar-vistas-ddns-regresion.js'
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
console.log('[gate:ddns:portal-despliegue] OK: 11a, 11b, 11c, 12a, 12b verificados.');
