import { spawn } from 'node:child_process';

const verificaciones = [
  'agentes-verificar-eliminacion-5-25-1.js',
  'agentes-verificar-eliminacion-5-25-5.js',
  'agentes-verificar-eliminacion-5-25-6b.js',
  'agentes-verificar-eliminacion-5-25-7.js',
  'agentes-verificar-eliminacion-5-25-10a.js',
  'agentes-verificar-eliminacion-5-25-13a.js',
  'agentes-verificar-eliminacion-5-25-13b.js'
];

for (const script of verificaciones) {
  await ejecutar(script);
}

console.log('[gate:eliminacion-agentes] OK: autorización, retirada federada y borrado verificadas.');

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
