import {
  canonicalizarPayloadPersistenteNotificacionEliminacionOrganizacion,
  crearNotificacionEliminacionAdministrativaOrganizacion
} from './ContratoEliminacionAdministrativaOrganizacion.js';

export const CONTRATO_PERSISTENCIA_NOTIFICACIONES_ELIMINACION_ORGANIZACION =
  Object.freeze({
    tiposSujeto: Object.freeze(['tenant', 'empresa', 'sitio']),
    validarNotificacion: crearNotificacionEliminacionAdministrativaOrganizacion,
    canonicalizarPayload:
      canonicalizarPayloadPersistenteNotificacionEliminacionOrganizacion
  });
