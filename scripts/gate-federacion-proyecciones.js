import { spawn } from 'node:child_process';

const verificaciones = [
  'federacion-verificar-5-22-14a.js',
  'federacion-verificar-5-22-14b.js',
  'federacion-verificar-5-22-14c.js',
  'federacion-verificar-5-22-14d.js',
  'federacion-verificar-5-22-14e.js',
  'federacion-verificar-5-22-14f.js',
  'federacion-verificar-5-22-14g.js',
  'federacion-verificar-5-22-14h.js'
];

for (const script of verificaciones) {
  await ejecutar(script);
}

console.log(
  '[gate:federacion:proyecciones] OK: cortes, generaciones candidatas, ' +
  'materialización, contribuciones, campos, divergencias y retiradas verificados.'
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
