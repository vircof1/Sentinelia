import { spawn } from 'node:child_process';

const verificaciones = [
  'federacion-verificar-5-22-11a.js',
  'federacion-verificar-5-22-11b.js',
  'federacion-verificar-5-22-11c.js',
  'federacion-verificar-5-22-11d.js',
  'federacion-verificar-5-22-11e.js',
  'federacion-verificar-5-22-11f.js',
  'federacion-verificar-5-22-11g.js',
  'federacion-verificar-5-22-11h.js'
];

for (const script of verificaciones) {
  await ejecutar(script);
}

console.log(
  '[gate:federacion:establecimiento] OK: red pública, invitaciones, canje, ' +
  'identidad, sesiones, heartbeat y continuidad verificados.'
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
