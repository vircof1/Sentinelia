import { spawn } from 'node:child_process';

const verificaciones = [
  'federacion-verificar-5-22-13a.js',
  'federacion-verificar-5-22-13b.js',
  'federacion-verificar-5-22-13c.js',
  'federacion-verificar-5-22-13d.js',
  'federacion-verificar-5-22-13e.js',
  'federacion-verificar-5-22-13f.js',
  'federacion-verificar-5-22-13g.js',
  'federacion-verificar-5-22-13h.js',
  'federacion-verificar-5-22-13i.js'
];

for (const script of verificaciones) {
  await ejecutar(script);
}

console.log(
  '[gate:federacion:emision] OK: plano HTTP, cliente, coordinación, entregas, ' +
  'reanudación, salud y señales verificados.'
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
