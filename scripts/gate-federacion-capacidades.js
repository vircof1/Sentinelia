import { spawn } from 'node:child_process';

for (const sufijo of ['b', 'c', 'd', 'e']) {
  await ejecutar(`federacion-verificar-5-22-22${sufijo}.js`);
}

console.log('[gate:federacion:capacidades] OK: configuración, emisión, recepción y diagnóstico verificados.');

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
