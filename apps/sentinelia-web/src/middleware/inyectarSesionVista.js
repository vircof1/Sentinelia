import {
  existeTipoMonitor,
  listarDefinicionesTiposMonitor,
  normalizarTipoMonitor
} from '../../../../paquetes/monitores/src/CatalogoTiposMonitor.js';

export function crearMiddlewareInyectarSesionVista({
  ddnsAgentesHabilitado = false,
  eliminacionAdministrativaAgentesHttpHabilitada = false,
  eliminacionAdministrativaOrganizacionesHttpHabilitada = false
} = {}) {
  return function inyectarSesionVista(requisicion, respuesta, next) {
    const queryActual = { ...(requisicion.query ?? {}) };
    const retornoListado = String(queryActual.return_to || '').trim();

    if (!queryActual.tipo && retornoListado.startsWith('/monitores')) {
      const urlRetorno = new URL(retornoListado, 'http://localhost');
      const tipoRetorno = normalizarTipoMonitor(urlRetorno.searchParams.get('tipo'));

      if (existeTipoMonitor(tipoRetorno)) {
        queryActual.tipo = tipoRetorno;
      }
    }

    respuesta.locals.usuarioActual =
      requisicion.session?.usuarioAutenticado ?? null;
    respuesta.locals.tokenCSRFPortal =
      requisicion.session?.usuarioAutenticado?.tokenCSRF ??
      requisicion.session?.tokenCSRF ??
      null;
    respuesta.locals.contextoUsuarioActual =
      requisicion.contextoUsuarioActual ?? null;
    respuesta.locals.rutaActual = requisicion.path ?? '/';
    respuesta.locals.queryActual = queryActual;
    respuesta.locals.tiposMonitorNavegacion = listarDefinicionesTiposMonitor();
    respuesta.locals.capacidadesPortal = Object.freeze({
      ddnsAgentes: ddnsAgentesHabilitado === true,
      eliminacionAdministrativaAgentes:
        eliminacionAdministrativaAgentesHttpHabilitada === true,
      eliminacionAdministrativaOrganizaciones:
        eliminacionAdministrativaOrganizacionesHttpHabilitada === true
    });
    next();
  };
}
