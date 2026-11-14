import { spawn } from 'node:child_process';

for (const sufijo of ['5a', '5b', '5c']) {
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
console.log('[gate:usuarios:reinicio-ui] OK: proyección, comando HTTP e interacción verificados.');
