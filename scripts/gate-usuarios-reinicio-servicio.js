import { spawn } from 'node:child_process';

for (const sufijo of ['4a', '4b', '4c']) {
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
console.log('[gate:usuarios:reinicio-servicio] OK: autoridad, concurrencia e invalidación verificadas.');
