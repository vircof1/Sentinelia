import { spawn } from 'node:child_process';

for (const script of [
  'auditoria-verificar-consulta-ux-fixture.js',
  'auditoria-verificar-consulta-ux-listado-sql.js',
  'auditoria-verificar-consulta-ux-filtros-sql.js'
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
console.log('[gate:auditoria:listado-filtros] OK: fixture, paginación y filtros SQL verificados.');
