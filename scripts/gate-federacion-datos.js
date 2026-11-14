import { spawn } from 'node:child_process';

const verificaciones = [
  'federacion-verificar-5-22-12a.js',
  'federacion-verificar-5-22-12b.js',
  'federacion-verificar-5-22-12c.js',
  'federacion-verificar-5-22-12d.js',
  'federacion-verificar-5-22-12e.js',
  'federacion-verificar-5-22-12f.js',
  'federacion-verificar-5-22-12g.js',
  'federacion-verificar-5-22-12h.js',
  'federacion-verificar-5-22-12i.js',
  'federacion-verificar-5-22-12j.js',
  'federacion-verificar-5-22-12k.js'
];

for (const script of verificaciones) {
  await ejecutar(script);
}

console.log(
  '[gate:federacion:datos] OK: flujos, ocurrencias, outbox, productores, inbox, ' +
  'entregas, cursores, planificación y materialización verificados.'
);

function ejecutar(script) {
  return new Promise((resolve, reject) => {
    const proceso = spawn(process.execPath, ['scripts/' + script], {
      cwd: new URL('..', import.meta.url),
      env: process.env,
      stdio: 'inherit'
    });

    proceso.once('error', reject);
    proceso.once('exit', (codigo, senal) => {
      if (codigo === 0) {
        resolve();
        return;
      }
      const resultado = senal ? 'señal ' + senal : 'código ' + codigo;
      reject(new Error(script + ' terminó con ' + resultado + '.'));
    });
  });
}
