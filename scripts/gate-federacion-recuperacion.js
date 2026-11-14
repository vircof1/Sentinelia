import { spawn } from 'node:child_process';

const verificaciones = [
  'federacion-verificar-5-22-17f.js',
  'federacion-verificar-5-22-17g.js',
  'federacion-verificar-5-22-17h.js'
];

for (const script of verificaciones) await ejecutar(script);

console.log(
  '[gate:federacion:recuperacion] OK: resincronización automática, ' +
  'reconstrucción manual y refederación verificadas.'
);

function ejecutar(script) {
  return new Promise((resolve, reject) => {
    const proceso = spawn(process.execPath, ['scripts/' + script], {
      cwd: new URL('..', import.meta.url), env: process.env, stdio: 'inherit'
    });
    proceso.once('error', reject);
    proceso.once('exit', (codigo, senal) => {
      if (codigo === 0) return resolve();
      reject(new Error(script + ' terminó con ' + (senal ? 'señal ' + senal : 'código ' + codigo) + '.'));
    });
  });
}
