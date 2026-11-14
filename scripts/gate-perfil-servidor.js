import { spawn } from 'node:child_process';

const verificaciones = Array.from(
  { length: 8 },
  (_, indice) => 'agentes-verificar-perfil-servidor-5-23-' + indice + '.js'
);

for (const script of verificaciones) {
  await ejecutar(script);
}

console.log('[gate:perfil-servidor] OK: contrato completo del perfil de servidor verificado.');

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
