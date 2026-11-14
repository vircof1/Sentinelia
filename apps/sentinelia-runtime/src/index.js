import { BootstrapRuntime } from './BootstrapRuntime.js';
import { RuntimeSentinelia } from './RuntimeSentinelia.js';
import { obtenerConfiguracionAplicacion } from '../../../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

const configuracion = obtenerConfiguracionAplicacion();
const bootstrapRuntime = new BootstrapRuntime({ configuracion });
const runtime = new RuntimeSentinelia({
  configuracion,
  bootstrapRuntime
});

let apagando = false;

async function apagarProceso(motivo, exitCode = 0) {
  if (apagando) {
    return;
  }

  apagando = true;
  const timeoutApagado = setTimeout(() => {
    console.error(
      `[sentinelia-runtime] apagado forzado tras ${configuracion.runtime.apagadoTimeoutMs} ms.`
    );
    process.exit(1);
  }, configuracion.runtime.apagadoTimeoutMs);

  try {
    await runtime.detener({ motivo });
    clearTimeout(timeoutApagado);
    process.exit(exitCode);
  } catch (error) {
    clearTimeout(timeoutApagado);
    console.error('[sentinelia-runtime] Error al detener el proceso');
    console.error(error);
    process.exit(1);
  }
}

process.on('SIGINT', () => {
  void apagarProceso('SIGINT', 0);
});

process.on('SIGTERM', () => {
  void apagarProceso('SIGTERM', 0);
});

process.on('unhandledRejection', (error) => {
  console.error('[sentinelia-runtime] Unhandled rejection');
  console.error(error);
  void apagarProceso('unhandledRejection', 1);
});

process.on('uncaughtException', (error) => {
  console.error('[sentinelia-runtime] Uncaught exception');
  console.error(error);
  void apagarProceso('uncaughtException', 1);
});

runtime.arrancar().catch((error) => {
  console.error('[sentinelia-runtime] Error fatal de arranque');
  console.error(error);
  void apagarProceso('error fatal de arranque', 1);
});
