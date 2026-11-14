import { spawn } from 'node:child_process';

for (const sufijo of ['3a', '3c', '3d', '3e']) {
  const script = `usuarios-verificar-reinicio-administrativo-5-30a-${sufijo}.js`;
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
console.log('[gate:usuarios:reinicio-ejecucion] OK: generación y ejecución manual o por correo verificadas.');
