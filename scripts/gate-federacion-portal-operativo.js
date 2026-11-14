import { spawn } from 'node:child_process';

for (const script of [
  'federacion-verificar-5-22-18i.js',
  'federacion-verificar-5-22-18k.js'
]) await ejecutar(script);

console.log(
  '[gate:federacion:portal-operativo] OK: borradores, reconstrucciones, resumen, ' +
  'actividad e histórico remotos verificados.'
);

function ejecutar(script) {
  return new Promise((resolve, reject) => {
    const proceso = spawn(process.execPath, ['scripts/' + script], {
      cwd: new URL('..', import.meta.url), env: process.env, stdio: 'inherit'
    });
    proceso.once('error', reject);
    proceso.once('exit', (codigo, senal) => {
      if (codigo === 0) return resolve();
      reject(new Error(script + ' terminó con ' + (senal ? 'señal ' + senal : 'código ' + codigo) + '.'));
    });
  });
}
