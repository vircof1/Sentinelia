import { spawn } from 'node:child_process';

for (const script of [
  'auditoria-verificar-consulta-ux-web-paginacion.js',
  'auditoria-verificar-consulta-ux-web-filtros.js',
  'auditoria-verificar-consulta-ux-web-avanzada.js',
  'auditoria-verificar-consulta-ux-contexto.js'
]) await ejecutar(script);

console.log('[gate:auditoria:consulta-ux] OK: navegación, filtros, investigación y contexto verificados.');

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
