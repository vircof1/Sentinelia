import { Router } from 'express';

export function crearRutasApiAgentes({
  controladorApiAgentes,
  ddnsAgentesHabilitado = false
}) {
  const router = Router();

  router.post(
    '/api/agentes/v1/login',
    controladorApiAgentes.login.bind(controladorApiAgentes)
  );

  router.get(
    '/api/agentes/v1/me',
    controladorApiAgentes.me.bind(controladorApiAgentes)
  );

  router.post(
    '/api/agentes/v1/session/refresh',
    controladorApiAgentes.refresh.bind(controladorApiAgentes)
  );

  router.post(
    '/api/agentes/v1/heartbeat',
    controladorApiAgentes.heartbeat.bind(controladorApiAgentes)
  );

  router.get(
    '/api/agentes/v1/configuracion',
    controladorApiAgentes.configuracion.bind(controladorApiAgentes)
  );

  if (ddnsAgentesHabilitado === true) {
    router.get(
      '/api/agentes/v1/ddns',
      controladorApiAgentes.ddns.bind(controladorApiAgentes)
    );

    router.post(
      '/api/agentes/v1/ddns/:concesionId/intenciones',
      controladorApiAgentes.crearIntencionDdns.bind(controladorApiAgentes)
    );
  }

  router.post(
    '/api/agentes/v1/telemetria',
    controladorApiAgentes.telemetria.bind(controladorApiAgentes)
  );

  return router;
}
