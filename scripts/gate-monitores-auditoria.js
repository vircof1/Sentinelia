import { spawn } from 'node:child_process';

for (const script of [
  'monitores-verificar-administracion-auditable.js',
  'monitores-verificar-logicos-auditables.js',
  'monitores-verificar-alertas-auditables.js'
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
console.log('[gate:monitores:auditoria] OK: administración, lógica y alertas auditables verificadas.');
