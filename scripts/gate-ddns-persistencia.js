import { spawn } from 'node:child_process';

for (const sufijo of ['1a', '1b', '1c']) {
  const script = `dns-verificar-ddns-5-28-${sufijo}.js`;
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
console.log('[gate:ddns:persistencia] OK: concesiones, causas y bloqueos causales verificados.');
