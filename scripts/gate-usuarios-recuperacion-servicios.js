import { spawn } from 'node:child_process';

for (const sufijo of ['5a', '5b', '5c', '6a', '6b', '6c']) {
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
console.log('[gate:usuarios:recuperacion-servicios] OK: emisión, reconciliación y consumo verificados.');
