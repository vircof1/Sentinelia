import { spawn } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';

const NOMBRE_BLOQUEO_ASESOR = 'sentinelia:bind:publicacion';
const PROGRAMA_RETENCION = "process.stdout.write('LOCKED\\n');setInterval(()=>{},2147483647)";

export class BloqueoAsesorMariaDbBindDns {
  constructor({ clienteSql }) {
    if (!clienteSql?.obtenerConexion) throw new Error('El bloqueo asesor BIND requiere SQL.');
    this.clienteSql = clienteSql;
  }

  async adquirir({ timeoutMs }) {
    const conexion = await this.clienteSql.obtenerConexion();
    let adquirido = false;
    try {
      const [filas] = await conexion.execute('SELECT GET_LOCK(?, ?) AS adquirido', [
        NOMBRE_BLOQUEO_ASESOR,
        Math.max(0, Number(timeoutMs) / 1000)
      ]);
      adquirido = Number(filas[0]?.adquirido) === 1;
      if (!adquirido) throw new TimeoutBloqueoPublicacionBind('bloqueo_asesor_timeout');
      let liberado = false;
      return Object.freeze({
        async liberar() {
          if (liberado) return;
          liberado = true;
          try {
            await conexion.execute('SELECT RELEASE_LOCK(?)', [NOMBRE_BLOQUEO_ASESOR]);
          } finally {
            conexion.destroy();
          }
        }
      });
    } catch (error) {
      if (!adquirido) conexion.destroy();
      throw error;
    }
  }
}

export class BloqueoFilesystemFlockBindDns {
  constructor({ rutaLock, ejecutableFlock = '/usr/bin/flock', ejecutableNode = process.execPath } = {}) {
    this.rutaLock = rutaLock;
    this.ejecutableFlock = ejecutableFlock;
    this.ejecutableNode = ejecutableNode;
  }

  async adquirir({ timeoutMs }) {
    const handle = await fs.open(
      this.rutaLock,
      fsConstants.O_CREAT | fsConstants.O_RDWR | fsConstants.O_NOFOLLOW,
      0o640
    );
    const estadistica = await handle.stat();
    if (!estadistica.isFile()) {
      await handle.close();
      throw new Error('BIND_LOCK_FILE debe ser un archivo regular.');
    }
    const hijo = spawn(this.ejecutableFlock, [
      '--exclusive', '--no-fork', '--wait', String(Math.max(0, Number(timeoutMs) / 1000)),
      this.rutaLock, this.ejecutableNode, '-e', PROGRAMA_RETENCION
    ], {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    try {
      await esperarMarcadorLock(hijo, timeoutMs);
      const actual = await fs.lstat(this.rutaLock);
      if (!actual.isFile() || actual.isSymbolicLink() ||
          actual.dev !== estadistica.dev || actual.ino !== estadistica.ino) {
        throw new Error('BIND_LOCK_FILE cambió mientras se adquiría flock.');
      }
    } catch (error) {
      if (!hijo.killed) hijo.kill('SIGTERM');
      await esperarSalida(hijo);
      await handle.close();
      throw error;
    }
    let liberado = false;
    return Object.freeze({
      async liberar() {
        if (liberado) return;
        liberado = true;
        hijo.kill('SIGTERM');
        await esperarSalida(hijo);
        await handle.close();
      }
    });
  }
}

export class SeccionCriticaPublicacionBindDns {
  constructor({ bloqueoAsesor, bloqueoFilesystem, margenSeguridadMs = 250 } = {}) {
    if (!bloqueoAsesor?.adquirir || !bloqueoFilesystem?.adquirir) {
      throw new Error('La publicación BIND requiere ambos bloqueos externos.');
    }
    this.bloqueoAsesor = bloqueoAsesor;
    this.bloqueoFilesystem = bloqueoFilesystem;
    this.margenSeguridadMs = margenSeguridadMs;
  }

  async ejecutar({ venceEnUtcMs, validarAutoridad, trabajo }) {
    if (typeof validarAutoridad !== 'function' || typeof trabajo !== 'function') {
      throw new Error('La sección BIND requiere validación de autoridad y trabajo.');
    }
    const margenSeguridadMs = Number(this.margenSeguridadMs);
    const adquiridos = [];
    try {
      adquiridos.push(await this.bloqueoAsesor.adquirir({ timeoutMs: restante() }));
      await exigirAutoridad(validarAutoridad);
      adquiridos.push(await this.bloqueoFilesystem.adquirir({ timeoutMs: restante() }));
      restante();
      await exigirAutoridad(validarAutoridad);
      return await trabajo();
    } finally {
      for (const bloqueo of adquiridos.reverse()) {
        try { await bloqueo.liberar(); } catch {}
      }
    }

    function restante() {
      const valor = Number(venceEnUtcMs) - Date.now() - margenSeguridadMs;
      if (!Number.isFinite(valor) || valor <= 0) {
        throw new TimeoutBloqueoPublicacionBind('plazo_publicacion_agotado');
      }
      return valor;
    }
  }
}

export class TimeoutBloqueoPublicacionBind extends Error {
  constructor(codigo) {
    super(`No se adquirieron los bloqueos BIND dentro del plazo: ${codigo}.`);
    this.name = 'TimeoutBloqueoPublicacionBind';
    this.codigo = codigo;
  }
}

async function exigirAutoridad(validar) {
  if (await validar() !== true) throw new Error('El publicador perdió lease o fencing bajo los bloqueos externos.');
}

function esperarMarcadorLock(hijo, timeoutMs) {
  return new Promise((resolve, reject) => {
    let salida = '';
    const temporizador = setTimeout(() => reject(new TimeoutBloqueoPublicacionBind('flock_timeout')), Math.max(1, timeoutMs));
    hijo.stdout.on('data', (datos) => {
      salida += datos.toString('ascii');
      if (salida.includes('LOCKED\n')) {
        clearTimeout(temporizador);
        resolve();
      }
    });
    hijo.once('error', (error) => { clearTimeout(temporizador); reject(error); });
    hijo.once('exit', () => {
      if (!salida.includes('LOCKED\n')) {
        clearTimeout(temporizador);
        reject(new TimeoutBloqueoPublicacionBind('flock_no_adquirido'));
      }
    });
  });
}

function esperarSalida(hijo) {
  if (hijo.exitCode !== null || hijo.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => hijo.once('exit', resolve));
}
