import { Router } from 'express';
import {
  exigirCanalPublicoFederacion,
  responderErrorCanalPublicoFederacion
} from '../middleware/exigirCanalPublicoFederacion.js';
import {
  crearMiddlewareExigirRecepcionFederacion,
  responderErrorRecepcionFederacion
} from '../middleware/exigirRecepcionFederacion.js';

export function crearRutasApiFederacion({
  controladorApiFederacion,
  guardiaRecepcionFederacion
} = {}) {
  if (typeof controladorApiFederacion?.canjearInvitacion !== 'function') {
    throw new Error('Las rutas federadas requieren su controlador API.');
  }
  for (const metodo of [
    'publicarDeclaracionConcesion',
    'consultarConfirmacionConcesion',
    'publicarManifiestoFlujoInicial',
    'consultarManifiestosFlujosIniciales'
  ]) {
    if (typeof controladorApiFederacion?.[metodo] !== 'function') {
      throw new Error(`Las rutas federadas requieren ${metodo}().`);
    }
  }
  const router = Router();
  router.use('/api/federacion/v1', exigirCanalPublicoFederacion);
  router.use(
    '/api/federacion/v1',
    crearMiddlewareExigirRecepcionFederacion({ guardiaRecepcionFederacion })
  );
  router.post(
    '/api/federacion/v1/establecimiento/canje',
    controladorApiFederacion.canjearInvitacion.bind(controladorApiFederacion)
  );
  router.get(
    '/api/federacion/v1/control/flujos/relaciones/:relacionId/manifiestos-iniciales',
    controladorApiFederacion.consultarManifiestosFlujosIniciales
      .bind(controladorApiFederacion)
  );
  router.post(
    '/api/federacion/v1/sesion/login',
    controladorApiFederacion.login.bind(controladorApiFederacion)
  );
  router.post(
    '/api/federacion/v1/sesion/refresh',
    controladorApiFederacion.refresh.bind(controladorApiFederacion)
  );
  router.post(
    '/api/federacion/v1/sesion/heartbeat',
    controladorApiFederacion.heartbeat.bind(controladorApiFederacion)
  );
  router.post(
    '/api/federacion/v1/continuidad/recuperacion/canje',
    controladorApiFederacion.recuperarCredencial.bind(controladorApiFederacion)
  );
  router.post(
    '/api/federacion/v1/continuidad/credencial/rotacion',
    controladorApiFederacion.rotarCredencialPersistente.bind(controladorApiFederacion)
  );
  router.post(
    '/api/federacion/v1/control/concesion/declaraciones',
    controladorApiFederacion.publicarDeclaracionConcesion
      .bind(controladorApiFederacion)
  );
  router.get(
    '/api/federacion/v1/control/concesion/relaciones/:relacionId/intercambios/:intercambioId',
    controladorApiFederacion.consultarConfirmacionConcesion
      .bind(controladorApiFederacion)
  );
  router.post(
    '/api/federacion/v1/control/flujos/manifiestos-iniciales',
    controladorApiFederacion.publicarManifiestoFlujoInicial
      .bind(controladorApiFederacion)
  );
  router.use('/api/federacion/v1', responderErrorRecepcionFederacion);
  router.use('/api/federacion/v1', responderErrorCanalPublicoFederacion);
  return router;
}
