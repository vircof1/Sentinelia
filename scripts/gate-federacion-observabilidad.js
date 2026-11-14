import { spawn } from 'node:child_process';

const verificaciones = [
  'federacion-verificar-5-22-15e.js',
  'federacion-verificar-5-22-15f.js',
  'federacion-verificar-5-22-15g.js',
  'federacion-verificar-5-22-15h.js',
  'federacion-verificar-5-22-15i.js',
  'federacion-verificar-5-22-15j.js',
  'federacion-verificar-5-22-15k.js'
];

for (const script of verificaciones) {
  await ejecutar(script);
}

console.log(
  '[gate:federacion:observabilidad] OK: contratos, captura, materialización, ' +
  'persistencia y consulta de telemetría y monitores verificadas.'
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
