import { execFile, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { validarRutaPosixAbsolutaBind } from './SelectorActivoBindDns.js';

const MAX_SALIDA = 32_768;

export class AdaptadorComandosBindDns {
  constructor({ configuracion, ejecutarArchivo = ejecutarArchivoReal, timeoutMs = 15_000 } = {}) {
    if (!configuracion?.activo || typeof ejecutarArchivo !== 'function') {
      throw new Error('Los comandos BIND requieren configuración activa y ejecutor de archivo.');
    }
    this.configuracion = configuracion;
    this.ejecutarArchivo = ejecutarArchivo;
    this.timeoutMs = timeoutMs;
  }

  validarConfiguracionActiva() {
    return this.#ejecutar(this.configuracion.checkconfExecutable, [this.configuracion.namedConfActivo]);
  }

  validarConfiguracionCandidata(rutaNamedConf) {
    return this.#ejecutar(this.configuracion.checkconfExecutable, [
      validarRutaPosixAbsolutaBind(rutaNamedConf, 'named.conf candidato')
    ], { cwd: rutaNamedConf.slice(0, rutaNamedConf.lastIndexOf('/')) });
  }

  validarZona(nombreZona, rutaZonefile) {
    const zona = nombreZonaCanonico(nombreZona);
    const ruta = validarRutaPosixAbsolutaBind(rutaZonefile, 'zonefile BIND');
    return this.#ejecutar(this.configuracion.checkzoneExecutable, [zona, ruta]);
  }

  recargar() {
    return this.#ejecutar(
      this.configuracion.rndcExecutable,
      this.configuracion.argumentosRndcReload()
    );
  }

  async #ejecutar(ejecutable, argumentos, { cwd = undefined } = {}) {
    try {
      const resultado = await this.ejecutarArchivo(ejecutable, [...argumentos], {
        cwd,
        timeout: this.timeoutMs,
        maxBuffer: MAX_SALIDA,
        windowsHide: true,
        shell: false
      });
      return Object.freeze({
        ejecutable,
        argumentos: Object.freeze(redactarArgumentos(argumentos)),
        stdout: sanearSalida(resultado?.stdout),
        stderr: sanearSalida(resultado?.stderr)
      });
    } catch (causa) {
      throw new ErrorComandoBindDns({ ejecutable, argumentos, causa });
    }
  }
}

export class ErrorComandoBindDns extends Error {
  constructor({ ejecutable, argumentos, causa }) {
    const incierto = Boolean(causa?.killed || causa?.signal || causa?.code === 'ETIMEDOUT');
    super(`Falló ${ejecutable}: ${sanearSalida(causa?.stderr || causa?.stdout || causa?.message) || 'sin detalle'}`, { cause: causa });
    this.name = 'ErrorComandoBindDns';
    this.codigo = incierto ? 'bind_resultado_incierto' : 'bind_comando_rechazado';
    this.incierto = incierto;
    this.ejecutable = ejecutable;
    this.argumentos = Object.freeze(redactarArgumentos(argumentos));
    this.stdout = sanearSalida(causa?.stdout);
    this.stderr = sanearSalida(causa?.stderr);
  }
}

export class SupervisorNamedBindDns extends EventEmitter {
  constructor({ configuracion, crearProceso = crearProcesoReal, graciaMs = 5_000 } = {}) {
    super();
    if (!configuracion?.activo || typeof crearProceso !== 'function') {
      throw new Error('El supervisor named requiere configuración BIND activa.');
    }
    this.configuracion = configuracion;
    this.crearProceso = crearProceso;
    this.graciaMs = graciaMs;
    this.hijo = null;
    this.detencionSolicitada = false;
  }

  iniciar() {
    if (this.estaVivo()) throw new Error('named ya está supervisado y vivo.');
    this.detencionSolicitada = false;
    const argumentos = this.configuracion.argumentosNamedFinales();
    const hijo = this.crearProceso(this.configuracion.namedExecutable, argumentos, {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      windowsHide: true
    });
    this.hijo = hijo;
    acotarStream(hijo.stdout);
    acotarStream(hijo.stderr);
    hijo.once('exit', (codigo, senal) => {
      const inesperada = !this.detencionSolicitada;
      this.emit('salida', Object.freeze({ codigo, senal, inesperada, pid: hijo.pid }));
    });
    hijo.once('error', (error) => this.emit('errorProceso', error));
    return Object.freeze({
      pid: hijo.pid,
      ejecutable: this.configuracion.namedExecutable,
      argumentos: Object.freeze([...argumentos])
    });
  }

  estaVivo() {
    return Boolean(this.hijo && this.hijo.exitCode === null && this.hijo.signalCode === null);
  }

  usaConfiguracion(ruta) {
    return this.estaVivo() && ruta === this.configuracion.namedConfActivo;
  }

  async detener() {
    if (!this.estaVivo()) return Object.freeze({ detenido: false });
    const hijo = this.hijo;
    this.detencionSolicitada = true;
    hijo.kill('SIGTERM');
    const salio = await esperarSalida(hijo, this.graciaMs);
    if (!salio && this.estaVivo()) {
      hijo.kill('SIGKILL');
      await esperarSalida(hijo, this.graciaMs);
    }
    return Object.freeze({ detenido: true, pid: hijo.pid });
  }
}

function ejecutarArchivoReal(ejecutable, argumentos, opciones) {
  return new Promise((resolve, reject) => {
    execFile(ejecutable, argumentos, opciones, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
      } else resolve({ stdout, stderr });
    });
  });
}

function crearProcesoReal(ejecutable, argumentos, opciones) {
  return spawn(ejecutable, argumentos, opciones);
}

function nombreZonaCanonico(valor) {
  const texto = String(valor ?? '').toLowerCase().replace(/\.$/, '');
  if (texto.length === 0 || texto.length > 253 || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(texto) ||
      texto.split('.').some((etiqueta) => etiqueta.length === 0 || etiqueta.length > 63 || etiqueta.startsWith('-') || etiqueta.endsWith('-'))) {
    throw new Error('El nombre de zona para named-checkzone no es canónico.');
  }
  return texto;
}

function sanearSalida(valor) {
  return String(valor ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, ' ')
    .replace(/\b(password|secret|token|cookie|authorization)\s*[:=]\s*\S+/gi, '$1=[dato_sensible]')
    .replace(/(^|\s)-y\s+\S+/g, '$1-y [dato_sensible]')
    .slice(0, MAX_SALIDA);
}

function redactarArgumentos(argumentos) {
  const copia = [...argumentos];
  for (let indice = 0; indice < copia.length - 1; indice += 1) {
    if (copia[indice] === '-y') copia[indice + 1] = '[dato_sensible]';
  }
  return copia;
}

function acotarStream(stream) {
  stream?.resume?.();
}

function esperarSalida(hijo, plazoMs) {
  if (hijo.exitCode !== null || hijo.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const temporizador = setTimeout(() => resolve(false), plazoMs);
    hijo.once('exit', () => { clearTimeout(temporizador); resolve(true); });
  });
}
