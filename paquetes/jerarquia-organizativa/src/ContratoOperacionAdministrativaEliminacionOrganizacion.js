import {
  TIPOS_OPERACION_ADMINISTRATIVA_ORGANIZACION,
  VERSION_CONTRATO_ELIMINACION_ADMINISTRATIVA_ORGANIZACION,
  crearComandoEliminacionAdministrativaOrganizacion,
  crearReservaDesdeComandoEliminacionOrganizacion,
  crearResultadoEliminacionAdministrativaOrganizacion
} from './ContratoEliminacionAdministrativaOrganizacion.js';

export const CONTRATO_OPERACION_ADMINISTRATIVA_ELIMINACION_ORGANIZACION =
  Object.freeze({
    tipo:
      TIPOS_OPERACION_ADMINISTRATIVA_ORGANIZACION.ELIMINAR_ORGANIZACION,
    version: VERSION_CONTRATO_ELIMINACION_ADMINISTRATIVA_ORGANIZACION,
    validarComando: crearComandoEliminacionAdministrativaOrganizacion,
    validarResultado: crearResultadoEliminacionAdministrativaOrganizacion,
    resolverRecursos(entrada) {
      const reserva = crearReservaDesdeComandoEliminacionOrganizacion(entrada);
      return Object.freeze([
        Object.freeze({
          tipoRecurso: reserva.tipoRecurso,
          recursoId: reserva.recursoId
        })
      ]);
    }
  });
