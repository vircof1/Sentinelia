import { spawn } from 'node:child_process';

for (const sufijo of ['administracion-auditable', 'mutacion-trigger-auditable', 'generacion-mutaciones', 'eliminacion-registro-acciones']) {
  const script = `dns-verificar-${sufijo}.js`;
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
console.log('[gate:dns:administracion] OK: CRUD, triggers, generaciones y eliminación verificadas.');
