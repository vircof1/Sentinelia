export function crearMiddlewareExigirRecepcionFederacion({
  guardiaRecepcionFederacion
} = {}) {
  if (typeof guardiaRecepcionFederacion?.exigirPreparada !== 'function') {
    throw new Error(
      'La frontera HTTP federada requiere una guardia receptora viva.'
    );
  }
  return async function exigirRecepcionFederacion(
    requisicion,
    _respuesta,
    next
  ) {
    try {
      requisicion.recepcionFederacion =
        await guardiaRecepcionFederacion.exigirPreparada(
          `${requisicion.method || 'HTTP'} ${requisicion.originalUrl || requisicion.url || ''}`
        );
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function responderErrorRecepcionFederacion(
  error,
  _requisicion,
  respuesta,
  next
) {
  if (error?.codigo !== 'RECEPCION_FEDERACION_NO_PREPARADA' ||
      error?.statusCode !== 503) return next(error);
  return respuesta
    .status(503)
    .type('application/problem+json')
    .set('Cache-Control', 'no-store')
    .json({
      ok: false,
      codigo: 'RECEPCION_FEDERACION_NO_PREPARADA',
      mensaje: 'La recepción federada no está preparada en esta instalación.'
    });
}
