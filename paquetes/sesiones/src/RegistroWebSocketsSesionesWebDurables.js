export class RegistroWebSocketsSesionesWebDurables {
  constructor({
    repositorioSesiones,
    validarEstadoActual = async () => true,
    instanciaId,
    intervaloRevalidacionMs = 60_000
  } = {}) {
    if (!repositorioSesiones?.buscarVigentePorId || typeof validarEstadoActual !== 'function') {
      throw new Error('El registro WebSocket requiere autoridad SQL y validador actual.');
    }
    if (typeof instanciaId !== 'string' || instanciaId.trim().length === 0) {
      throw new Error('instanciaId es obligatorio.');
    }
    this.repositorioSesiones = repositorioSesiones;
    this.validarEstadoActual = validarEstadoActual;
    this.instanciaId = instanciaId;
    this.intervaloRevalidacionMs = intervaloRevalidacionMs;
    this.conexiones = new Map();
    this.temporizador = null;
  }

  registrar({ socket, sesion } = {}) {
    if (!esSocketCerrable(socket) || !sesion?.sesionAuditoriaId) {
      throw new Error('La conexión exige socket y fotografía de sesión.');
    }
    const entrada = Object.freeze({
      socket,
      sesion: Object.freeze({ ...sesion }),
      instanciaId: this.instanciaId
    });
    const conjunto = this.conexiones.get(sesion.sesionAuditoriaId) ?? new Set();
    conjunto.add(entrada);
    this.conexiones.set(sesion.sesionAuditoriaId, conjunto);
    return () => this.#retirar(entrada);
  }

  procesarInvalidacion(idsSesionAuditoria) {
    let cerradas = 0;
    for (const id of new Set(idsSesionAuditoria)) {
      cerradas += this.#cerrarSesion(id);
    }
    return cerradas;
  }

  async revalidar() {
    let cerradas = 0;
    for (const [sesionAuditoriaId, conexiones] of [...this.conexiones]) {
      const vigente = await this.repositorioSesiones.buscarVigentePorId(sesionAuditoriaId);
      const referencia = conexiones.values().next().value?.sesion;
      const valida = vigente && fotografiaCompatible(vigente, referencia)
        ? await this.validarEstadoActual(vigente)
        : false;
      if (!valida) cerradas += this.#cerrarSesion(sesionAuditoriaId);
    }
    return Object.freeze({ cerradas, restantes: this.total });
  }

  iniciar() {
    if (this.temporizador) return;
    this.temporizador = setInterval(() => {
      this.revalidar().catch((error) => {
        console.error('[sesiones-web] Falló la revalidación periódica WebSocket');
        console.error(error);
      });
    }, this.intervaloRevalidacionMs);
    this.temporizador.unref?.();
  }

  detener() {
    if (this.temporizador) clearInterval(this.temporizador);
    this.temporizador = null;
  }

  get total() {
    return [...this.conexiones.values()].reduce((total, grupo) => total + grupo.size, 0);
  }

  #cerrarSesion(sesionAuditoriaId) {
    const conexiones = this.conexiones.get(sesionAuditoriaId);
    if (!conexiones) return 0;
    this.conexiones.delete(sesionAuditoriaId);
    for (const { socket } of conexiones) {
      cerrarSocket(socket);
    }
    return conexiones.size;
  }

  #retirar(entrada) {
    const conjunto = this.conexiones.get(entrada.sesion.sesionAuditoriaId);
    if (!conjunto) return;
    conjunto.delete(entrada);
    if (conjunto.size === 0) this.conexiones.delete(entrada.sesion.sesionAuditoriaId);
  }
}

function esSocketCerrable(socket) {
  return Boolean(
    socket &&
    (
      typeof socket.close === 'function' ||
      typeof socket.end === 'function' ||
      typeof socket.destroy === 'function'
    )
  );
}

function cerrarSocket(socket) {
  try {
    if (typeof socket.close === 'function') {
      socket.close(4401, 'Sesión no vigente');
      return;
    }
    if (typeof socket.end === 'function') socket.end();
    if (typeof socket.destroy === 'function') socket.destroy();
  } catch {}
}

function fotografiaCompatible(actual, apertura) {
  return Boolean(apertura) && [
    'usuarioRealId',
    'usuarioEfectivoId',
    'versionSesionReal',
    'versionSesionEfectiva'
  ].every((campo) => actual[campo] === apertura[campo]) &&
    JSON.stringify(actual.scopeEfectivoActual) === JSON.stringify(apertura.scopeEfectivoActual);
}
