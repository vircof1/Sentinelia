import { spawn } from 'node:child_process';

for (const script of [
  'federacion-verificar-ui-triggers-remotos.js',
  'federacion-verificar-ui-auditoria-remota.js'
]) await ejecutar(script);

console.log('[gate:federacion:ui-remota] OK: triggers y auditoría remotos verificados.');

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
