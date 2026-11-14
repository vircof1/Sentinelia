export class ControladorEliminacionAdministrativaAgentes {
  constructor({
    servicioImpacto,
    servicioAceptacion,
    servicioConsultaOperaciones,
    servicioBuzon
  } = {}) {
    if (
      typeof servicioImpacto?.preparar !== 'function' ||
      typeof servicioAceptacion?.aceptar !== 'function' ||
      typeof servicioConsultaOperaciones?.obtener !== 'function' ||
      typeof servicioBuzon?.listar !== 'function' ||
      typeof servicioBuzon?.resumir !== 'function' ||
      typeof servicioBuzon?.marcarLeida !== 'function'
    ) {
      throw new Error('El controlador de eliminación exige todos sus servicios.');
    }
    this.servicioImpacto = servicioImpacto;
    this.servicioAceptacion = servicioAceptacion;
    this.servicioConsultaOperaciones = servicioConsultaOperaciones;
    this.servicioBuzon = servicioBuzon;
  }

  async obtenerImpacto(requisicion, respuesta, next) {
    if (esperaHtml(requisicion)) {
      return respuesta.redirect(303, '/agentes');
    }
    return this.#responder(respuesta, next, async () => ({
      statusCode: 200,
      cuerpo: {
        ok: true,
        impacto: await this.servicioImpacto.preparar({
          ...actores(requisicion),
          agenteId: normalizarAgenteId(requisicion.params.id),
          csrfToken: csrfSesion(requisicion)
        })
      }
    }));
  }

  async aceptar(requisicion, respuesta, next) {
    if (esperaHtml(requisicion)) {
      try {
        const resultado = await this.#aceptar(requisicion);
        guardarFlashAgentes(requisicion, {
          tipo: 'seguimiento',
          mensaje: resultado.repetida
            ? 'La eliminación ya estaba encolada. Puedes seguir su estado.'
            : 'La eliminación se ha encolado. El agente todavía puede existir.',
          operacionId: resultado.operacionId
        });
        return respuesta.redirect(
          303,
          `/agentes?operacion_id=${encodeURIComponent(resultado.operacionId)}`
        );
      } catch (error) {
        const problema = presentarError(error);
        if (!problema) return next(error);
        if ([400, 409, 410].includes(problema.statusCode)) {
          guardarFlashAgentes(requisicion, {
            tipo: 'error',
            mensaje: problema.mensaje
          });
          return respuesta.redirect(303, '/agentes');
        }
        return this.#responderErrorHtml(error, respuesta, next);
      }
    }
    return this.#responder(respuesta, next, async () => {
      const resultado = await this.#aceptar(requisicion);
      return {
        statusCode: 202,
        cuerpo: {
          ok: true,
          ...resultado,
          urlOperacion: `/api/operaciones-administrativas/${encodeURIComponent(resultado.operacionId)}`,
          urlSeguimiento: `/operaciones-administrativas/${encodeURIComponent(resultado.operacionId)}`
        }
      };
    });
  }

  async #aceptar(requisicion) {
    return this.servicioAceptacion.aceptar({
      ...actores(requisicion),
      agenteId: normalizarAgenteId(requisicion.params.id),
      tokenConfirmacion: requisicion.body?.tokenConfirmacion,
      fraseConfirmacion: requisicion.body?.fraseConfirmacion,
      csrfToken: csrfSesion(requisicion)
    });
  }

  async obtenerOperacion(requisicion, respuesta, next) {
    return this.#responder(respuesta, next, async () => ({
      statusCode: 200,
      cuerpo: {
        ok: true,
        operacion: await this.servicioConsultaOperaciones.obtener(
          requisicion.contextoUsuarioActual,
          requisicion.params.operacionId
        )
      }
    }));
  }

  async mostrarOperacion(requisicion, respuesta, next) {
    try {
      const operacion = await this.servicioConsultaOperaciones.obtener(
        requisicion.contextoUsuarioActual,
        requisicion.params.operacionId
      );
      return respuesta
        .status(200)
        .set('Cache-Control', 'no-store')
        .render('portal/operacion-administrativa', {
          titulo: 'Seguimiento de eliminación',
          usuarioActual: requisicion.session?.usuarioAutenticado ?? null,
          operacion
        });
    } catch (error) {
      return this.#responderErrorHtml(error, respuesta, next);
    }
  }

  async listarBuzon(requisicion, respuesta, next) {
    return this.#responder(respuesta, next, async () => ({
      statusCode: 200,
      cuerpo: {
        ok: true,
        ...(await this.servicioBuzon.listar(
          requisicion.contextoUsuarioActual,
          {
            limite: normalizarLimite(requisicion.query?.limite),
            cursor: requisicion.query?.cursor
          }
        ))
      }
    }));
  }

  async resumirBuzon(requisicion, respuesta, next) {
    return this.#responder(respuesta, next, async () => ({
      statusCode: 200,
      cuerpo: {
        ok: true,
        ...(await this.servicioBuzon.resumir(requisicion.contextoUsuarioActual))
      }
    }));
  }

  async marcarNotificacionLeida(requisicion, respuesta, next) {
    return this.#responder(respuesta, next, async () => ({
      statusCode: 200,
      cuerpo: {
        ok: true,
        ...(await this.servicioBuzon.marcarLeida(
          requisicion.contextoUsuarioActual,
          normalizarUuid(requisicion.params.notificacionId)
        ))
      }
    }));
  }

  async #responder(respuesta, next, operacion) {
    try {
      const resultado = await operacion();
      return respuesta
        .status(resultado.statusCode)
        .set('Cache-Control', 'no-store')
        .json(resultado.cuerpo);
    } catch (error) {
      const problema = presentarError(error);
      if (!problema) return next(error);
      return respuesta
        .status(problema.statusCode)
        .set('Cache-Control', 'no-store')
        .json({
          ok: false,
          codigo: problema.codigo,
          mensaje: problema.mensaje
        });
    }
  }

  #responderErrorHtml(error, respuesta, next) {
    const problema = presentarError(error);
    if (!problema) return next(error);
    return respuesta
      .status(problema.statusCode)
      .set('Cache-Control', 'no-store')
      .render('portal/recurso-no-disponible', {
        titulo: problema.statusCode === 404
          ? 'Recurso no disponible'
          : 'Operación no disponible',
        usuarioActual: respuesta.locals.usuarioActual ?? null,
        mensajeRecurso: problema.mensaje
      });
  }
}

function actores(requisicion) {
  const contexto = requisicion.contextoUsuarioActual;
  return {
    actorRealId: contexto?.idUsuarioReal ?? contexto?.idUsuario,
    actorEfectivoId: contexto?.idUsuario
  };
}

function csrfSesion(requisicion) {
  return requisicion.session?.usuarioAutenticado?.tokenCSRF ||
    requisicion.session?.tokenCSRF;
}

function presentarError(error) {
  const codigo = String(error?.codigo || '');
  const statusCode = Number(error?.statusCode || error?.codigoHttp || 0);
  if ([400, 403, 404].includes(statusCode)) {
    return {
      statusCode,
      codigo: codigo || 'recurso_no_encontrado',
      mensaje: statusCode === 400
        ? 'Los parámetros de la petición no son válidos.'
        : statusCode === 404
          ? 'El recurso no existe dentro del alcance actual.'
          : 'La operación no está autorizada.'
    };
  }
  if (
    codigo === 'agente_eliminacion_no_encontrada' ||
    codigo === 'agente_eliminacion_no_autorizada'
  ) {
    return {
      statusCode: 404,
      codigo: 'agente_eliminacion_no_encontrada',
      mensaje: 'El recurso no existe dentro del alcance actual.'
    };
  }
  if (
    error?.name === 'ErrorConfirmacionEliminacionAgente' ||
    error?.name === 'ErrorAceptacionEliminacionAdministrativaAgente'
  ) {
    const expirada = codigo === 'agente_eliminacion_confirmacion_expirada';
    const conflicto = [
      'agente_eliminacion_estructura_modificada',
      'agente_eliminacion_identidad_federada_incompleta',
      'agente_eliminacion_impacto_no_seguro',
      'agente_eliminacion_operacion_en_curso'
    ].includes(codigo);
    return {
      statusCode: expirada ? 410 : conflicto ? 409 : 400,
      codigo: codigo || 'agente_eliminacion_confirmacion_invalida',
      mensaje: expirada
        ? 'La confirmación ha caducado. Revisa de nuevo el impacto.'
        : conflicto
        ? 'El agente cambió o ya posee una eliminación en curso.'
        : 'La confirmación de eliminación no es válida o ha expirado.'
    };
  }
  return null;
}

function esperaHtml(requisicion) {
  const accept = String(requisicion.get?.('accept') || '').toLowerCase();
  const solicitadaPorAjax = String(
    requisicion.get?.('x-requested-with') || ''
  ).toLowerCase() === 'xmlhttprequest';
  return !solicitadaPorAjax && accept.includes('text/html');
}

function guardarFlashAgentes(requisicion, flash) {
  if (requisicion.session) requisicion.session.flashAgentes = flash;
}

function normalizarAgenteId(valor) {
  const id = String(valor || '').trim();
  if (!/^[1-9][0-9]*$/u.test(id)) {
    throw Object.assign(new Error('El agente no existe.'), {
      statusCode: 404,
      codigo: 'agente_eliminacion_no_encontrada'
    });
  }
  return id;
}

function normalizarLimite(valor) {
  if (valor === undefined || valor === null || valor === '') return 25;
  const limite = Number(valor);
  if (!Number.isInteger(limite) || limite < 1 || limite > 100) {
    throw Object.assign(new Error('El límite no es válido.'), {
      statusCode: 400,
      codigo: 'limite_buzon_invalido'
    });
  }
  return limite;
}

function normalizarUuid(valor) {
  const uuid = String(valor || '').trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(uuid)) {
    throw Object.assign(new Error('La notificación no existe.'), {
      statusCode: 404,
      codigo: 'notificacion_buzon_no_encontrada'
    });
  }
  return uuid;
}
