const TIPOS_SUJETO = new Set(['tenant', 'empresa', 'sitio']);

export class ControladorEliminacionAdministrativaOrganizaciones {
  constructor({ servicioImpacto, servicioAceptacion } = {}) {
    if (
      typeof servicioImpacto?.preparar !== 'function' ||
      typeof servicioAceptacion?.aceptar !== 'function'
    ) {
      throw new Error(
        'El controlador de eliminación organizativa exige impacto y aceptación.'
      );
    }
    this.servicioImpacto = servicioImpacto;
    this.servicioAceptacion = servicioAceptacion;
  }

  async obtenerImpacto(requisicion, respuesta, next) {
    return this.#responder(respuesta, next, async () => ({
      statusCode: 200,
      cuerpo: {
        ok: true,
        impacto: await this.servicioImpacto.preparar({
          ...actores(requisicion),
          sujeto: normalizarSujeto(requisicion.params),
          csrfToken: csrfSesion(requisicion)
        })
      }
    }));
  }

  async aceptar(requisicion, respuesta, next) {
    return this.#responder(respuesta, next, async () => {
      const resultado = await this.servicioAceptacion.aceptar({
        ...actores(requisicion),
        sujeto: normalizarSujeto(requisicion.params),
        tokenConfirmacion: requisicion.body?.tokenConfirmacion,
        fraseConfirmacion: requisicion.body?.fraseConfirmacion,
        csrfToken: csrfSesion(requisicion)
      });
      const operacionId = encodeURIComponent(resultado.operacionId);
      return {
        statusCode: 202,
        cuerpo: {
          ok: true,
          ...resultado,
          urlOperacion: `/api/operaciones-administrativas/${operacionId}`,
          urlSeguimiento: `/operaciones-administrativas/${operacionId}`
        }
      };
    });
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

function normalizarSujeto({ tipo, id } = {}) {
  const tipoNormalizado = String(tipo || '').trim().toLowerCase();
  const idNormalizado = String(id || '').trim();
  if (!TIPOS_SUJETO.has(tipoNormalizado) || !/^[1-9][0-9]*$/u.test(idNormalizado)) {
    throw Object.assign(new Error('La organización no existe.'), {
      statusCode: 404,
      codigo: 'organizacion_eliminacion_no_encontrada'
    });
  }
  return Object.freeze({ tipo: tipoNormalizado, id: idNormalizado });
}

function presentarError(error) {
  const codigo = String(error?.codigo || '');
  const statusCode = Number(error?.statusCode || error?.codigoHttp || 0);
  if (statusCode === 404 || [
    'organizacion_eliminacion_no_encontrada',
    'organizacion_eliminacion_no_autorizada'
  ].includes(codigo)) {
    return {
      statusCode: 404,
      codigo: 'organizacion_eliminacion_no_encontrada',
      mensaje: 'El recurso no existe dentro del alcance actual.'
    };
  }
  if (statusCode === 409) {
    return {
      statusCode: 409,
      codigo: codigo || 'organizacion_eliminacion_operacion_en_curso',
      mensaje: 'La organización cambió o ya posee una eliminación en curso.'
    };
  }
  if (
    error?.name === 'ErrorConfirmacionEliminacionOrganizacion' ||
    error?.name === 'ErrorAceptacionEliminacionAdministrativaOrganizacion'
  ) {
    const expirada =
      codigo === 'organizacion_eliminacion_confirmacion_expirada';
    const conflicto = [
      'organizacion_eliminacion_operacion_en_curso',
      'organizacion_eliminacion_clave_divergente',
      'organizacion_eliminacion_impacto_no_seguro'
    ].includes(codigo);
    return {
      statusCode: expirada ? 410 : conflicto ? 409 : 400,
      codigo: codigo || 'organizacion_eliminacion_confirmacion_invalida',
      mensaje: expirada
        ? 'La confirmación ha caducado. Revisa de nuevo el impacto.'
        : conflicto
          ? 'La organización cambió o ya posee una eliminación en curso.'
          : 'La confirmación de eliminación no es válida o ha expirado.'
    };
  }
  return null;
}
