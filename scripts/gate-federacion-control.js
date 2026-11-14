import { spawn } from 'node:child_process';

const verificaciones = [
  'federacion-verificar-5-22-10a.js',
  'federacion-verificar-5-22-10b.js',
  'federacion-verificar-5-22-10c.js',
  'federacion-verificar-5-22-10d.js',
  'federacion-verificar-5-22-10f.js',
  'federacion-verificar-5-22-10g.js',
  'federacion-verificar-5-22-10h.js',
  'federacion-verificar-5-22-10i.js'
];

for (const script of verificaciones) {
  await ejecutar(script);
}

console.log(
  '[gate:federacion:control] OK: identidad, configuración, permisos, avisos, ' +
  'relaciones y concesiones verificados.'
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
