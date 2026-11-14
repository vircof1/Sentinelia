import { spawn } from 'node:child_process';

for (const sufijo of ['7a', '7b', '7c', '7d']) {
  const script = `usuarios-verificar-recuperacion-5-30-${sufijo}.js`;
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
console.log('[gate:usuarios:recuperacion-publica] OK: solicitud, bearer, consumo y disponibilidad verificados.');
