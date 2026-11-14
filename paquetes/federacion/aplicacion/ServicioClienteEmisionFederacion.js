export class ServicioClienteEmisionFederacion {
  constructor({ repositorioDestinos, clienteHttp } = {}) {
    if (typeof repositorioDestinos?.obtenerAprobadoOperativo !== 'function' ||
        typeof clienteHttp?.obtenerCapacidad !== 'function' ||
        typeof clienteHttp?.registrarHeartbeat !== 'function' ||
        typeof clienteHttp?.entregarLote !== 'function' ||
        typeof clienteHttp?.obtenerProgreso !== 'function' ||
        typeof clienteHttp?.registrarDisponibilidad !== 'function' ||
        typeof clienteHttp?.listarDisponibilidad !== 'function') {
      throw new Error('El cliente emisor federado requiere destino SQL y transporte HTTP.');
    }
    this.repositorioDestinos = repositorioDestinos;
    this.clienteHttp = clienteHttp;
  }

  async obtenerCapacidad({ relacionId, token } = {}) {
    return this.clienteHttp.obtenerCapacidad({
      destino: await this.#destino(relacionId),
      token
    });
  }

  async entregarLote({ relacionId, token, lote } = {}) {
    if (lote?.relacionId !== relacionId) {
      throw new Error('El lote no pertenece a la relación emisora solicitada.');
    }
    return this.clienteHttp.entregarLote({
      destino: await this.#destino(relacionId),
      token,
      lote
    });
  }

  async registrarHeartbeat({ relacionId, token, solicitud } = {}) {
    if (solicitud?.relacionId !== relacionId) {
      throw new Error('El heartbeat no pertenece a la relación emisora solicitada.');
    }
    return this.clienteHttp.registrarHeartbeat({
      destino: await (
        typeof this.repositorioDestinos.obtenerVinculadoAutenticable === 'function'
          ? this.repositorioDestinos.obtenerVinculadoAutenticable({ relacionId })
          : this.#destino(relacionId)
      ),
      token,
      solicitud
    });
  }

  async obtenerProgreso({ relacionId, token, flujoId, generacionId } = {}) {
    return this.clienteHttp.obtenerProgreso({
      destino: await this.#destino(relacionId),
      token,
      flujoId,
      generacionId
    });
  }

  async registrarDisponibilidad({
    relacionId,
    token,
    flujoId,
    generacionId,
    declaracion
  } = {}) {
    if (declaracion?.relacionId !== relacionId ||
        declaracion?.flujoId !== flujoId ||
        declaracion?.generacionId !== generacionId) {
      throw new Error('La declaración no pertenece a la relación, flujo y generación solicitados.');
    }
    return this.clienteHttp.registrarDisponibilidad({
      destino: await this.#destino(relacionId),
      token,
      flujoId,
      generacionId,
      declaracion
    });
  }

  async listarDisponibilidad({ relacionId, token, flujoId, generacionId } = {}) {
    return this.clienteHttp.listarDisponibilidad({
      destino: await this.#destino(relacionId),
      token,
      flujoId,
      generacionId
    });
  }

  #destino(relacionId) {
    return this.repositorioDestinos.obtenerAprobadoOperativo({ relacionId });
  }
}
