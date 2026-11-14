import { spawn } from 'node:child_process';

const verificaciones = [
  'federacion-verificar-5-22-9a.js',
  'federacion-verificar-5-22-9b.js',
  'federacion-verificar-5-22-9c.js',
  'federacion-verificar-5-22-9d.js',
  'federacion-verificar-5-22-9e.js',
  'federacion-verificar-5-22-9f.js',
  'federacion-verificar-5-22-9g.js'
];

for (const script of verificaciones) {
  await ejecutar(script);
}

console.log(
  '[gate:federacion:nucleo] OK: frontera, identidades, catálogos, envolventes, ' +
  'autoridad, puertos y límites verificados.'
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
