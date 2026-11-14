import { crearAplicacion } from '../apps/sentinelia-web/src/crearAplicacion.js';

// Montaje productivo completo. Solo los controladores ajenos a la API bajo
// prueba son inertes; nunca se inicia un runtime ni se conecta con BIND.
export function crearAplicacionTelemetriaFixture(controladorApiAgentes) {
  const inerte = new Proxy({}, { get: () => (_req, res) => res.sendStatus(501) });
  const opciones = Object.fromEntries([
    'Login', 'RecuperacionPassword', 'Portal', 'Organizacion', 'Usuarios',
    'Impersonacion', 'Monitores', 'Triggers', 'Dns', 'Agentes',
    'EliminacionAdministrativaAgentes', 'EliminacionAdministrativaOrganizaciones',
    'ReglasDerivacionTelemetria', 'Auditoria', 'Federacion', 'ApiFederacion',
    'Pow', 'DesuscripcionTriggerCorreo'
  ].map((nombre) => [`controlador${nombre}`, inerte]));
  return crearAplicacion({
    ...opciones, controladorApiAgentes,
    sessionMiddleware: (_req, _res, next) => next(),
    servicioConfiguracionPortal: { async asegurarActualizada() { return {}; } },
    servicioAutorizacion: inerte,
    resolutorRedPublicaFederacion: {
      configurarAplicacionExpress(app) {
        app.use((req, _res, next) => req.headers['x-fallo-fixture']
          ? next(new Error('DETALLE_INTERNO_NO_PUBLICABLE')) : next());
      }
    }
  });
}
