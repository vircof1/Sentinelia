export function exigirCanalPublicoFederacion(requisicion, _respuesta, next) {
  try {
    validarCanalPublicoFederacion(requisicion?.redPublicaFederacion);
    next();
  } catch (error) {
    next(error);
  }
}

export function validarCanalPublicoFederacion(redPublica) {
  if (redPublica?.saltoConfiable !== true ||
      redPublica?.cadenaProxiesConfiable !== true ||
      redPublica?.protocoloExterior !== 'https') {
    const error = new Error(
      'La API federada exige HTTPS mediante una cadena de proxies confiable.'
    );
    error.codigo = 'CANAL_FEDERADO_NO_CONFIABLE';
    error.statusCode = 403;
    throw error;
  }
}

export function responderErrorCanalPublicoFederacion(
  error,
  _requisicion,
  respuesta,
  next
) {
  if (error?.codigo !== 'CANAL_FEDERADO_NO_CONFIABLE' ||
      error?.statusCode !== 403) return next(error);
  return respuesta
    .status(403)
    .type('application/problem+json')
    .set('Cache-Control', 'no-store')
    .json({
      ok: false,
      codigo: 'CANAL_FEDERADO_NO_CONFIABLE',
      mensaje: 'La API federada exige un canal público HTTPS confiable.'
    });
}
