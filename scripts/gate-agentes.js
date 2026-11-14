import { spawn } from 'node:child_process';

const verificaciones = [
  { script: 'agentes-verificar-login-tecnico.js' },
  { script: 'agentes-verificar-contrato-sesion-tecnica-5-21-9b.js' },
  { script: 'agentes-verificar-operaciones-sesion-durables.js' },
  { script: 'agentes-verificar-coordinacion-sesiones-tecnicas.js' },
  { script: 'agentes-verificar-replay-sesiones-tecnicas.js' },
  { script: 'agentes-verificar-provisionamiento-auditable.js' },
  { script: 'agentes-verificar-cuarentena-auditable.js' },
  { script: 'agentes-verificar-estado-secreto-auditable.js' },
  { script: 'agentes-verificar-reglas-telemetria-auditables.js' }
];

for (const verificacion of verificaciones) {
  await ejecutar(verificacion);
}

console.log('[gate:agentes] OK: sesiones técnicas y operaciones administrativas verificadas.');

function ejecutar({ script, argumentos = [] }) {
  return new Promise((resolve, reject) => {
    const proceso = spawn(process.execPath, ['scripts/' + script, ...argumentos], {
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
