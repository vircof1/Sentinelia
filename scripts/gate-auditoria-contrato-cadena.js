import { spawn } from 'node:child_process';

for (const script of [
  'auditoria-verificar-sobre-canonico.js',
  'auditoria-verificar-estructura.js'
]) {
  await new Promise((resolve, reject) => {
    const proceso = spawn(process.execPath, ['scripts/' + script], {
      cwd: new URL('..', import.meta.url), env: process.env, stdio: 'inherit'
    });
    proceso.once('error', reject);
    proceso.once('exit', (codigo, senal) => codigo === 0 ? resolve() : reject(
      new Error(script + ' terminó con ' + (senal || codigo) + '.')
    ));
  });
}
console.log('[gate:auditoria:contrato-cadena] OK: sobre canónico y estructura de cadenas verificados.');
