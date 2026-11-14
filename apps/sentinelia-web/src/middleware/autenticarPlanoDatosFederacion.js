import {
  validarCanalPublicoFederacion
} from './exigirCanalPublicoFederacion.js';

export function crearMiddlewareAutenticarPlanoDatosFederacion({
  servicioSesionesFederacion
} = {}) {
  if (typeof servicioSesionesFederacion?.validarBearer !== 'function') {
    throw new Error('El plano de datos requiere sesiones federadas operativas.');
  }

  return async function autenticarPlanoDatosFederacion(requisicion, _respuesta, next) {
    try {
      validarCanalPublicoFederacion(requisicion.redPublicaFederacion);
      const token = extraerBearer(requisicion);
      if (!token) {
        const error = new Error('Authorization Bearer es obligatorio.');
        error.codigo = 'BEARER_FEDERADO_REQUERIDO';
        error.statusCode = 401;
        throw error;
      }
      requisicion.sesionFederacion = Object.freeze(
        await servicioSesionesFederacion.validarBearer(token)
      );
      next();
    } catch (error) {
      next(error);
    }
  };
}

function extraerBearer(requisicion) {
  const valor = String(requisicion.get?.('authorization') || '');
  const coincidencia = valor.match(/^Bearer (sfop1_[A-Za-z0-9_-]{64})$/u);
  return coincidencia?.[1] || null;
}
