import { spawn } from 'node:child_process';

const verificaciones = [
  'federacion-verificar-5-22-17a.js',
  'federacion-verificar-5-22-17b.js',
  'federacion-verificar-5-22-17c.js',
  'federacion-verificar-5-22-17d.js',
  'federacion-verificar-5-22-17e.js'
];

for (const script of verificaciones) await ejecutar(script);

console.log(
  '[gate:federacion:retencion] OK: políticas, purga, tombstones, auditoría, ' +
  'disponibilidad y huecos verificados.'
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
