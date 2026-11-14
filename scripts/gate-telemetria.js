import { spawn } from 'node:child_process';

const verificacionesBase = [
  'agentes-verificar-telemetria-dominio.js',
  'agentes-verificar-telemetria-catalogo.js',
  'agentes-verificar-telemetria-observaciones.js',
  'agentes-verificar-telemetria-estado-actual.js',
  'agentes-verificar-telemetria-acciones.js'
];

const verificacionesAvanzadas = [
  'agentes-verificar-telemetria-5-24-1.js',
  'agentes-verificar-telemetria-5-24-2.js',
  'agentes-verificar-telemetria-5-24-3.js',
  'agentes-verificar-telemetria-5-24-4.js',
  'agentes-verificar-telemetria-5-24-5.js',
  'agentes-verificar-telemetria-5-24-6.js',
  'agentes-verificar-telemetria-5-24-7.js',
  'agentes-verificar-telemetria-5-24-8.js',
  'agentes-verificar-telemetria-5-24-9.js',
  'agentes-verificar-telemetria-5-24-10.js',
  'agentes-verificar-telemetria-5-24a-0.js',
  'agentes-verificar-telemetria-5-24a-1b.js',
  'agentes-verificar-telemetria-5-24a-2.js',
  'agentes-verificar-telemetria-5-24a-3a.js',
  'agentes-verificar-telemetria-5-24a-3b.js',
  'agentes-verificar-telemetria-5-24a-4a.js',
  'agentes-verificar-telemetria-5-24a-4b.js',
  'agentes-verificar-telemetria-5-24a-5a.js',
  'agentes-verificar-telemetria-5-24a-5b.js',
  'agentes-verificar-telemetria-5-24a-6a.js',
  'agentes-verificar-telemetria-5-24a-6b.js',
  'agentes-verificar-telemetria-5-24a-7a.js',
  'agentes-verificar-telemetria-5-24a-7b.js'
];

const completa = process.argv.includes('--completa');
const verificaciones = completa
  ? [...verificacionesAvanzadas, ...verificacionesBase]
  : verificacionesBase;

for (const script of verificaciones) {
  await ejecutar(script);
}

console.log(
  completa
    ? '[gate:telemetria] OK: contrato completo de telemetría verificado.'
    : '[gate:telemetria] OK: dominio, catálogo, observaciones, estado actual y acciones verificados.'
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
