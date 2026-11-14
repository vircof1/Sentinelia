import { spawn } from 'node:child_process';

for (const sufijo of ["6a","6b","6c","6d"]) {
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
console.log('[gate:ddns:consolidacion] OK: 6a, 6b, 6c, 6d verificados.');
