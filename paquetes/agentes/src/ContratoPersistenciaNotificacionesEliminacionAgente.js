import {
  canonicalizarPayloadPersistenteNotificacionEliminacionAgente,
  crearNotificacionEliminacionAdministrativaAgente
} from './ContratoEliminacionAdministrativaAgente.js';
import {
  CatalogoContratosNotificacionesOperacionesAdministrativas
} from '../../coordinacion-durable/src/CatalogoContratosNotificacionesOperacionesAdministrativas.js';

export const CONTRATO_PERSISTENCIA_NOTIFICACIONES_ELIMINACION_AGENTE =
  Object.freeze({
    tiposSujeto: Object.freeze(['agente']),
    validarNotificacion: crearNotificacionEliminacionAdministrativaAgente,
    canonicalizarPayload:
      canonicalizarPayloadPersistenteNotificacionEliminacionAgente
  });

export function crearCatalogoNotificacionesEliminacionAgente() {
  return new CatalogoContratosNotificacionesOperacionesAdministrativas({
    contratos: [CONTRATO_PERSISTENCIA_NOTIFICACIONES_ELIMINACION_AGENTE]
  });
}
