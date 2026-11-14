import { spawn } from 'node:child_process';

for (const script of [
  'federacion-verificar-reintentos-sql.js',
  'federacion-verificar-cronologia-senal.js'
]) await ejecutar(script);

console.log('[gate:federacion:transacciones-senales] OK: reintentos SQL y cronología de señales verificados.');

function ejecutar(script) {
  return new Promise((resolve, reject) => {
    const proceso = spawn(process.execPath, ['scripts/' + script], {
      cwd: new URL('..', import.meta.url), env: process.env, stdio: 'inherit'
    });
    proceso.once('error', reject);
    proceso.once('exit', (codigo, senal) => codigo === 0 ? resolve() : reject(
      new Error(script + ' terminó con ' + (senal ? 'señal ' + senal : 'código ' + codigo) + '.')
    ));
  });
}
