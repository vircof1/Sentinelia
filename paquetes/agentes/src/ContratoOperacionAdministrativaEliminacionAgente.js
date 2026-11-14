import {
  TIPOS_OPERACION_ADMINISTRATIVA,
  VERSION_CONTRATO_ELIMINACION_ADMINISTRATIVA_AGENTE,
  crearComandoEliminacionAdministrativaAgente,
  crearResultadoEliminacionAdministrativaAgente
} from './ContratoEliminacionAdministrativaAgente.js';

export const CONTRATO_OPERACION_ADMINISTRATIVA_ELIMINACION_AGENTE =
  Object.freeze({
    tipo: TIPOS_OPERACION_ADMINISTRATIVA.ELIMINAR_AGENTE,
    version: VERSION_CONTRATO_ELIMINACION_ADMINISTRATIVA_AGENTE,
    validarComando: crearComandoEliminacionAdministrativaAgente,
    validarResultado: crearResultadoEliminacionAdministrativaAgente,
    resolverRecursos(entrada) {
      const comando = crearComandoEliminacionAdministrativaAgente(entrada);
      return Object.freeze([
        Object.freeze({ tipoRecurso: 'agente', recursoId: comando.sujeto.id })
      ]);
    }
  });
