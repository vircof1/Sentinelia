import { spawn } from 'node:child_process';

await ejecutar('federacion-verificar-5-22-16i.js');

console.log(
  '[gate:federacion:seleccion-remota] OK: exploración, selección, borradores y ' +
  'vinculación explícita de datos remotos verificadas.'
);

function ejecutar(script) {
  return new Promise((resolve, reject) => {
    const proceso = spawn(process.execPath, ['scripts/' + script], {
      cwd: new URL('..', import.meta.url),
      env: process.env,
      stdio: 'inherit'
    });

    proceso.once('error', reject);
    proceso.once('exit', (codigo, senal) => {
      if (codigo === 0) {
        resolve();
        return;
      }
      const resultado = senal ? 'señal ' + senal : 'código ' + codigo;
      reject(new Error(script + ' terminó con ' + resultado + '.'));
    });
  });
}
