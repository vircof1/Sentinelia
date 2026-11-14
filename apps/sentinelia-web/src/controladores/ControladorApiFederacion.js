export class ControladorApiFederacion {
  constructor({ servicioCanjeInvitacion, servicioSesionesFederacion = null,
    servicioHeartbeatFederacion = null, servicioContinuidadFederacion = null,
    servicioIntercambioConcesionFederacion = null,
    servicioReconciliacionFlujosFederacion = null } = {}) {
    if (typeof servicioCanjeInvitacion?.canjear !== 'function') {
      throw new Error('El controlador federado requiere servicio de canje.');
    }
    this.servicioCanjeInvitacion = servicioCanjeInvitacion;
    this.servicioSesionesFederacion = servicioSesionesFederacion;
    this.servicioHeartbeatFederacion = servicioHeartbeatFederacion;
    this.servicioContinuidadFederacion = servicioContinuidadFederacion;
    this.servicioIntercambioConcesionFederacion =
      servicioIntercambioConcesionFederacion;
    this.servicioReconciliacionFlujosFederacion =
      servicioReconciliacionFlujosFederacion;
  }

  async canjearInvitacion(requisicion, respuesta) {
    try {
      const resultado = await this.servicioCanjeInvitacion.canjear(requisicion.body);
      respuesta
        .status(201)
        .set('Cache-Control', 'no-store')
        .json(resultado);
    } catch (error) {
      const statusCode = Number.isInteger(error?.statusCode)
        ? error.statusCode
        : 500;
      respuesta
        .status(statusCode)
        .type('application/problem+json')
        .set('Cache-Control', 'no-store')
        .json({
          ok: false,
          codigo: error?.codigo || 'ERROR_INTERNO_CANJE',
          mensaje: statusCode >= 500
            ? 'El canje no está disponible temporalmente.'
            : String(error?.message || 'La petición de canje no es válida.')
        });
    }
  }

  async login(requisicion, respuesta) {
    return this.#responderSesion(respuesta, () =>
      this.#exigirSesiones().login(requisicion.body));
  }

  async refresh(requisicion, respuesta) {
    const token = extraerBearer(requisicion);
    if (!token) {
      return responderProblema(respuesta, 401, 'BEARER_FEDERADO_REQUERIDO',
        'Authorization Bearer es obligatorio.');
    }
    return this.#responderSesion(respuesta, () =>
      this.#exigirSesiones().refresh(adjuntarBearer(requisicion.body, token)));
  }

  async heartbeat(requisicion, respuesta) {
    const token = extraerBearer(requisicion);
    if (!token) {
      return responderProblema(respuesta, 401, 'BEARER_FEDERADO_REQUERIDO',
        'Authorization Bearer es obligatorio.');
    }
    return this.#responderSesion(respuesta, () => {
      if (typeof this.servicioHeartbeatFederacion?.registrar !== 'function') {
        const error = new Error('El heartbeat federado no está disponible.');
        error.codigo = 'HEARTBEAT_FEDERADO_NO_DISPONIBLE';
        error.statusCode = 503;
        throw error;
      }
      return this.servicioHeartbeatFederacion.registrar(
        adjuntarBearer(requisicion.body, token)
      );
    });
  }

  async recuperarCredencial(requisicion, respuesta) {
    return this.#responderSesion(respuesta, () => {
      if (typeof this.servicioContinuidadFederacion?.canjearRecuperacion !== 'function') {
        throw noDisponibleContinuidad();
      }
      return this.servicioContinuidadFederacion.canjearRecuperacion(requisicion.body);
    });
  }

  async rotarCredencialPersistente(requisicion, respuesta) {
    const token = extraerBearer(requisicion);
    if (!token) {
      return responderProblema(respuesta, 401, 'BEARER_FEDERADO_REQUERIDO',
        'Authorization Bearer es obligatorio.');
    }
    return this.#responderSesion(respuesta, () => {
      if (typeof this.servicioContinuidadFederacion?.rotarCredencial !== 'function') {
        throw noDisponibleContinuidad();
      }
      return this.servicioContinuidadFederacion.rotarCredencial(
        adjuntarBearer(requisicion.body, token)
      );
    });
  }

  async publicarDeclaracionConcesion(requisicion, respuesta) {
    const token = extraerBearer(requisicion);
    if (!token) {
      return responderProblema(respuesta, 401, 'BEARER_FEDERADO_REQUERIDO',
        'Authorization Bearer es obligatorio.');
    }
    return this.#responderIntercambio(respuesta, async () => {
      const resultado = await this.#exigirIntercambioConcesion().recibir({
        token,
        declaracion: requisicion.body
      });
      return { resultado, statusCode: resultado.estado === 'persistida' ? 201 : 200 };
    });
  }

  async consultarConfirmacionConcesion(requisicion, respuesta) {
    const token = extraerBearer(requisicion);
    if (!token) {
      return responderProblema(respuesta, 401, 'BEARER_FEDERADO_REQUERIDO',
        'Authorization Bearer es obligatorio.');
    }
    return this.#responderIntercambio(respuesta, async () => ({
      resultado: await this.#exigirIntercambioConcesion().consultarConfirmacion({
        token,
        relacionId: requisicion.params.relacionId,
        intercambioId: requisicion.params.intercambioId
      }),
      statusCode: 200
    }));
  }

  async publicarManifiestoFlujoInicial(requisicion, respuesta) {
    const token = extraerBearer(requisicion);
    if (!token) {
      return responderProblema(respuesta, 401, 'BEARER_FEDERADO_REQUERIDO',
        'Authorization Bearer es obligatorio.');
    }
    return this.#responderIntercambio(respuesta, async () => ({
      resultado: await this.#exigirReconciliacionFlujos().recibirManifiesto({
        token,
        manifiesto: requisicion.body
      }),
      statusCode: 200
    }));
  }

  async consultarManifiestosFlujosIniciales(requisicion, respuesta) {
    const token = extraerBearer(requisicion);
    if (!token) {
      return responderProblema(respuesta, 401, 'BEARER_FEDERADO_REQUERIDO',
        'Authorization Bearer es obligatorio.');
    }
    return this.#responderIntercambio(respuesta, async () => ({
      resultado: await this.#exigirReconciliacionFlujos().consultarManifiestos({
        token,
        relacionId: requisicion.params.relacionId
      }),
      statusCode: 200
    }));
  }

  #exigirSesiones() {
    if (typeof this.servicioSesionesFederacion?.login !== 'function') {
      const error = new Error('Las sesiones federadas no están disponibles.');
      error.codigo = 'SESIONES_FEDERADAS_NO_DISPONIBLES';
      error.statusCode = 503;
      throw error;
    }
    return this.servicioSesionesFederacion;
  }

  #exigirIntercambioConcesion() {
    if (typeof this.servicioIntercambioConcesionFederacion?.recibir !== 'function' ||
        typeof this.servicioIntercambioConcesionFederacion
          ?.consultarConfirmacion !== 'function') {
      const error = new Error('El intercambio de concesión no está disponible.');
      error.codigo = 'INTERCAMBIO_CONCESION_NO_DISPONIBLE';
      error.statusCode = 503;
      throw error;
    }
    return this.servicioIntercambioConcesionFederacion;
  }

  #exigirReconciliacionFlujos() {
    if (typeof this.servicioReconciliacionFlujosFederacion
      ?.recibirManifiesto !== 'function') {
      const error = new Error('La reconciliación de flujos no está disponible.');
      error.codigo = 'RECONCILIACION_FLUJOS_NO_DISPONIBLE';
      error.statusCode = 503;
      throw error;
    }
    return this.servicioReconciliacionFlujosFederacion;
  }

  async #responderSesion(respuesta, operacion) {
    try {
      const resultado = await operacion();
      return respuesta.set('Cache-Control', 'no-store').json(resultado);
    } catch (error) {
      const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode :
        /no es|debe ser|campos ausentes|desconocidos|no válido/u.test(String(error?.message))
          ? 400 : 500;
      return responderProblema(
        respuesta,
        statusCode,
        error?.codigo || 'ERROR_SESION_FEDERADA',
        statusCode >= 500
          ? 'La sesión federada no está disponible temporalmente.'
          : String(error?.message || 'La petición de sesión no es válida.')
      );
    }
  }

  async #responderIntercambio(respuesta, operacion) {
    try {
      const { resultado, statusCode } = await operacion();
      return respuesta.status(statusCode).set('Cache-Control', 'no-store').json(resultado);
    } catch (error) {
      const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
      return responderProblema(
        respuesta,
        statusCode,
        error?.codigo || 'ERROR_INTERCAMBIO_CONCESION',
        statusCode >= 500
          ? 'El intercambio de concesión no está disponible temporalmente.'
          : String(error?.message || 'La declaración de concesión no es válida.')
      );
    }
  }
}

function noDisponibleContinuidad() {
  const error = new Error('La continuidad federada no está disponible.');
  error.codigo = 'CONTINUIDAD_FEDERADA_NO_DISPONIBLE';
  error.statusCode = 503;
  return error;
}

function extraerBearer(requisicion) {
  const valor = String(requisicion.get?.('authorization') || '');
  const coincidencia = valor.match(/^Bearer ([A-Za-z0-9_-]+)$/u);
  return coincidencia?.[1] || null;
}

function adjuntarBearer(cuerpo, token) {
  if (cuerpo && typeof cuerpo === 'object' && Object.hasOwn(cuerpo, 'token')) {
    const error = new Error('El token operativo solo se admite en Authorization Bearer.');
    error.codigo = 'TOKEN_FEDERADO_EN_CUERPO';
    error.statusCode = 400;
    throw error;
  }
  return { ...cuerpo, token };
}

function responderProblema(respuesta, statusCode, codigo, mensaje) {
  return respuesta.status(statusCode).type('application/problem+json')
    .set('Cache-Control', 'no-store').json({ ok: false, codigo, mensaje });
}
