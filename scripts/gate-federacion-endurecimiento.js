import { spawn } from 'node:child_process';

for (const sufijo of ['a', 'b', 'c', 'd', 'e']) {
  await new Promise((resolve, reject) => {
    const script = `federacion-verificar-5-22-19${sufijo}.js`;
    const proceso = spawn(process.execPath, ['scripts/' + script], {
      cwd: new URL('..', import.meta.url), env: process.env, stdio: 'inherit'
    });
    proceso.once('error', reject);
    proceso.once('exit', (codigo, senal) => codigo === 0 ? resolve() : reject(
      new Error(script + ' terminó con ' + (senal ? 'señal ' + senal : 'código ' + codigo) + '.')
    ));
  });
}

console.log('[gate:federacion:endurecimiento] OK: criptografía, red, admisión, autoridad y dominio adversario verificados.');
