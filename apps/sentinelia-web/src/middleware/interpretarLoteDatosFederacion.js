import express from 'express';
import {
  LIMITES_DUROS_RECURSOS_FEDERACION
} from '../../../../paquetes/federacion/src/ConfiguracionFederacion.js';

const SOBRECOSTE_FIJO_HTTP = 64 * 1024;
const SOBRECOSTE_POR_ENTREGA_HTTP = 512;

export function crearMiddlewareInterpretarLoteDatosFederacion({
  resolutorCapacidad
} = {}) {
  if (typeof resolutorCapacidad?.resolver !== 'function') {
    throw new Error('El parser de lotes requiere capacidad receptora dinámica.');
  }
  return async function interpretarLoteDatosFederacion(requisicion, respuesta, next) {
    try {
      const capacidad = await resolutorCapacidad.resolver(
        requisicion.configuracionPortalActual
      );
      requisicion.capacidadRecepcionFederacion = capacidad;
      // El límite HTTP es físico. Un replay terminal creado bajo una fotografía
      // anterior debe poder entrar y recuperar su ACK aunque el límite dinámico
      // haya disminuido desde entonces.
      const limite = LIMITES_DUROS_RECURSOS_FEDERACION.loteMaximoBytes +
        LIMITES_DUROS_RECURSOS_FEDERACION.loteMaximoOcurrencias *
          SOBRECOSTE_POR_ENTREGA_HTTP +
        SOBRECOSTE_FIJO_HTTP;
      const longitud = requisicion.get?.('content-length');
      if (longitud !== undefined &&
          (!/^[0-9]+$/u.test(longitud) || BigInt(longitud) > BigInt(limite))) {
        return next(errorCuerpoExcesivo(capacidad.aplicada));
      }
      return express.json({
        inflate: false,
        limit: limite,
        strict: true,
        type: 'application/json'
      })(requisicion, respuesta, (error) => {
        if (error?.type === 'entity.too.large') {
          return next(errorCuerpoExcesivo(capacidad.aplicada));
        }
        next(error);
      });
    } catch (error) {
      next(error);
    }
  };
}

function errorCuerpoExcesivo(capacidad) {
  const error = new Error('El cuerpo HTTP supera el límite previo de recepción.');
  error.codigo = 'lote_excede_limites';
  error.statusCode = 413;
  error.capacidad = capacidad;
  return error;
}
