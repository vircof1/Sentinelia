import { spawn } from 'node:child_process';

for (const sufijo of ['b', 'c', 'd']) await ejecutar(`federacion-verificar-5-22-20${sufijo}.js`);

console.log('[gate:federacion:release] OK: contrato OpenAPI, despliegue y materializador runtime verificados.');

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
