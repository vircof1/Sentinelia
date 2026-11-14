import { spawn } from 'node:child_process';

for (const script of [
  'auditoria-verificar-consulta-ux-proyeccion.js',
  'auditoria-verificar-consulta-ux-api-eventos.js',
  'auditoria-verificar-consulta-ux-api-correlacion.js',
  'auditoria-verificar-consulta-ux-resolutores.js'
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
console.log('[gate:auditoria:api-consulta] OK: proyección, eventos, correlaciones y resolutores verificados.');
