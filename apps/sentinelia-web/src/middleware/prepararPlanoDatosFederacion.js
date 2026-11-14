export function crearMiddlewarePrepararPlanoDatosFederacion({
  guardiaRecepcionFederacion
} = {}) {
  if (typeof guardiaRecepcionFederacion?.exigirPreparada !== 'function') {
    throw new Error(
      'La frontera de datos federados requiere una guardia receptora viva.'
    );
  }

  return async function prepararPlanoDatosFederacion(
    requisicion,
    respuesta,
    next
  ) {
    try {
      if (!requisicion.redPublicaFederacion) {
        const error = new Error(
          'La red pública federada debe resolverse antes del plano de datos.'
        );
        error.codigo = 'RED_PUBLICA_FEDERADA_NO_RESUELTA';
        error.statusCode = 503;
        throw error;
      }
      const recepcion =
        await guardiaRecepcionFederacion.exigirPreparada('plano_datos_http');
      const { configuracionPortal } = recepcion;
      requisicion.configuracionPortalActual = configuracionPortal;
      requisicion.fronteraPlanoDatosFederacion = Object.freeze({
        configuracionPortal,
        redPublica: requisicion.redPublicaFederacion,
        capacidades: recepcion.capacidades
      });
      respuesta.locals.configuracionPortalActual = configuracionPortal;
      next();
    } catch (error) {
      next(error);
    }
  };
}
