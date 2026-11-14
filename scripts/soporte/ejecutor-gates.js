import { spawn } from 'node:child_process';
import { open } from 'node:fs/promises';
import { setTimeout as esperar } from 'node:timers/promises';

export function descubrirGates(scripts, seleccion = []) {
  const gates = Object.keys(scripts).filter((nombre) => nombre.startsWith('gate:'));
  for (const nombre of seleccion) {
    if (!gates.includes(nombre)) throw new Error(`Gate desconocida: ${nombre}`);
  }
  return seleccion.length ? gates.filter((nombre) => seleccion.includes(nombre)) : gates;
}

export async function ejecutarProcesoGate({
  comando, argumentos, cwd, env, log, timeoutMs, signal, graciaMs = 3000
}) {
  const inicio = Date.now();
  if (signal?.aborted) return { estado: 'interrumpido', duracionMs: 0 };
  const archivo = await open(log, 'wx', 0o600);
  let motivo = null;
  let detencion;
  let proceso;
  let temporizador;
  const detener = (causa) => {
    if (motivo || !proceso?.pid) return;
    motivo = causa;
    const enviar = (senal) => {
      try {
        // npm y todos sus descendientes comparten un grupo en el contenedor Linux.
        process.kill(-proceso.pid, senal);
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    };
    detencion = (async () => {
      enviar('SIGTERM');
      await esperar(graciaMs);
      enviar('SIGKILL');
    })();
  };
  const cancelar = () => detener('interrumpido');
  try {
    proceso = spawn(comando, argumentos, {
      cwd, env, shell: false, detached: true,
      stdio: ['ignore', archivo.fd, archivo.fd]
    });
    const cierre = new Promise((resolve) => {
      proceso.once('error', (error) => resolve({ error: error.code || 'SPAWN_ERROR' }));
      proceso.once('close', (codigo, senal) => resolve({ codigo, senal }));
    });
    signal?.addEventListener('abort', cancelar, { once: true });
    if (signal?.aborted) cancelar();
    temporizador = setTimeout(() => detener('timeout'), timeoutMs);
    const resultado = await cierre;
    clearTimeout(temporizador);
    await detencion;
    return {
      estado: motivo || (resultado.error ? 'error' : resultado.codigo === 0 ? 'correcto' : 'fallido'),
      ...resultado,
      duracionMs: Date.now() - inicio
    };
  } finally {
    clearTimeout(temporizador);
    signal?.removeEventListener('abort', cancelar);
    await archivo.close();
  }
}
