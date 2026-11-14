import { spawn } from 'node:child_process';

const verificaciones = [
  'federacion-verificar-5-22-16a.js',
  'federacion-verificar-5-22-16b.js'
];

for (const script of verificaciones) {
  await ejecutar(script);
}

console.log(
  '[gate:federacion:estados-remotos] OK: fotografías operativas, vigencia, ' +
  'rehidratación y procesamiento temporal verificados.'
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
