import { BootstrapRuntime } from '../apps/sentinelia-runtime/src/BootstrapRuntime.js';
import { RuntimeSentinelia } from '../apps/sentinelia-runtime/src/RuntimeSentinelia.js';
import { DiagnosticoRuntime } from '../apps/sentinelia-runtime/src/DiagnosticoRuntime.js';
import { obtenerConfiguracionAplicacion } from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();
  const bootstrapRuntime = new BootstrapRuntime({ configuracion });
  const runtime = new RuntimeSentinelia({
    configuracion,
    bootstrapRuntime
  });

  try {
    await runtime.arrancar();
    const diagnostico = new DiagnosticoRuntime({ runtime }).construir();
    console.log(JSON.stringify(diagnostico, null, 2));

    if (!diagnostico.validaciones?.okGlobal) {
      process.exitCode = 2;
    }
  } finally {
    await runtime.detener({ motivo: 'diagnostico one-shot' });
  }
}

main().catch((error) => {
  console.error('[runtime:diagnostico] Error fatal');
  console.error(error);
  process.exit(1);
});
