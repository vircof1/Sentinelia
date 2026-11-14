import { spawn } from 'node:child_process';

for (const sufijo of ['4a', '4b', '6a', '6b']) {
  const script = `usuarios-verificar-email-perfil-5-30b-${sufijo}.js`;
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
console.log('[gate:usuarios:email-despacho] OK: autoridad, SMTP, métricas y recuperación verificados.');
