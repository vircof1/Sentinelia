import { spawn } from 'node:child_process';

const verificaciones = [
  'federacion-verificar-5-22-15l.js',
  'federacion-verificar-5-22-15m.js',
  'federacion-verificar-5-22-15n.js',
  'federacion-verificar-5-22-15o.js',
  'federacion-verificar-5-22-15p.js'
];

for (const script of verificaciones) {
  await ejecutar(script);
}

console.log(
  '[gate:federacion:familias-operativas] OK: triggers, auditoría, testimonios, ' +
  'avisos y contratos globales de familias verificados.'
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
