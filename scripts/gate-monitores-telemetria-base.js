import { spawn } from 'node:child_process';

for (const sufijo of ['contrato', 'vinculos', 'condiciones-directas']) {
  const script = `monitores-verificar-telemetria-${sufijo}.js`;
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
console.log('[gate:monitores:telemetria-base] OK: contrato, vínculos y condiciones tipadas verificados.');
