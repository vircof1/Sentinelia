import { Router, json as interpretarJson } from 'express';

import {
  crearMiddlewarePrepararPlanoDatosFederacion
} from '../middleware/prepararPlanoDatosFederacion.js';
import {
  exigirCanalPublicoFederacion
} from '../middleware/exigirCanalPublicoFederacion.js';
import {
  GuardiaRecepcionFederacion
} from '../../../../paquetes/federacion/aplicacion/GuardiaRecepcionFederacion.js';

export const PREFIJO_RUTAS_DATOS_FEDERACION = '/api/federacion/v1/datos';
export const RUTAS_DATOS_FEDERACION = Object.freeze({
  CAPACIDAD: `${PREFIJO_RUTAS_DATOS_FEDERACION}/capacidad`,
  LOTES: `${PREFIJO_RUTAS_DATOS_FEDERACION}/lotes`,
  PROGRESO:
    `${PREFIJO_RUTAS_DATOS_FEDERACION}/flujos/:flujoId/generaciones/:generacionId/progreso`,
  DISPONIBILIDAD:
    `${PREFIJO_RUTAS_DATOS_FEDERACION}/flujos/:flujoId/generaciones/:generacionId/disponibilidad`
});

export function crearRutasDatosFederacion({
  servicioConfiguracionPortal,
  controladorDatosFederacion = null,
  middlewareAutenticacionDatosFederacion = null,
  middlewareInterpretacionLoteFederacion = null,
  guardiaRecepcionFederacion = null
} = {}) {
  const router = Router();
  const guardia = guardiaRecepcionFederacion || new GuardiaRecepcionFederacion({
    servicioConfiguracionPortal
  });
  const preparar = crearMiddlewarePrepararPlanoDatosFederacion({
    guardiaRecepcionFederacion: guardia
  });
  const controlador = resolverControlador(controladorDatosFederacion);
  const autenticar = resolverMiddleware(
    controladorDatosFederacion,
    middlewareAutenticacionDatosFederacion,
    'autenticación'
  );
  const interpretarLote = resolverMiddleware(
    controladorDatosFederacion,
    middlewareInterpretacionLoteFederacion,
    'interpretación limitada de lotes'
  );
  const interpretarDisponibilidad = interpretarJson({
    limit: '64kb',
    strict: true,
    type: 'application/json'
  });

  router.use(
    PREFIJO_RUTAS_DATOS_FEDERACION,
    exigirRedPublicaFederacionResuelta,
    exigirCanalPublicoFederacion,
    preparar
  );
  router.get(
    RUTAS_DATOS_FEDERACION.CAPACIDAD,
    autenticar,
    controlador.obtenerCapacidad
  );
  router.post(
    RUTAS_DATOS_FEDERACION.LOTES,
    autenticar,
    interpretarLote,
    controlador.entregarLote
  );
  router.get(
    RUTAS_DATOS_FEDERACION.PROGRESO,
    autenticar,
    controlador.obtenerProgreso
  );
  router.post(
    RUTAS_DATOS_FEDERACION.DISPONIBILIDAD,
    autenticar,
    interpretarDisponibilidad,
    controlador.registrarDisponibilidad
  );
  router.get(
    RUTAS_DATOS_FEDERACION.DISPONIBILIDAD,
    autenticar,
    controlador.listarDisponibilidad
  );
  return router;
}

function exigirRedPublicaFederacionResuelta(requisicion, _respuesta, next) {
  if (requisicion.redPublicaFederacion) return next();
  const error = new Error(
    'La red pública federada debe resolverse antes del plano de datos.'
  );
  error.codigo = 'RED_PUBLICA_FEDERADA_NO_RESUELTA';
  error.statusCode = 503;
  return next(error);
}

function resolverMiddleware(controlador, middleware, nombre) {
  if (controlador === null) return (_requisicion, _respuesta, next) => next();
  if (typeof middleware !== 'function') {
    throw new Error(`El controlador de datos federados requiere ${nombre}.`);
  }
  return middleware;
}

function resolverControlador(controlador) {
  const metodos = [
    'obtenerCapacidad',
    'entregarLote',
    'obtenerProgreso',
    'registrarDisponibilidad',
    'listarDisponibilidad'
  ];
  if (controlador === null) {
    return Object.freeze(Object.fromEntries(
      metodos.map((metodo) => [metodo, responderGatePlanoDatos])
    ));
  }
  for (const metodo of metodos) {
    if (typeof controlador?.[metodo] !== 'function') {
      throw new Error(`El controlador de datos federados requiere ${metodo}().`);
    }
  }
  return Object.freeze(Object.fromEntries(metodos.map((metodo) => [
    metodo,
    controlador[metodo].bind(controlador)
  ])));
}

function responderGatePlanoDatos(_requisicion, respuesta) {
  return respuesta
    .status(503)
    .type('application/problem+json')
    .set('Cache-Control', 'no-store')
    .json({
      ok: false,
      codigo: 'PLANO_DATOS_FEDERACION_NO_DISPONIBLE',
      mensaje: 'El transporte de datos federados todavía no está habilitado.'
    });
}
