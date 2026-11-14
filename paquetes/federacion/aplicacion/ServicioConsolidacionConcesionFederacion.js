import { generarUuidV7Auditoria }
  from '../../auditoria/src/UuidV7Auditoria.js';
import {
  crearIdentidadFederada,
  TIPOS_IDENTIDAD_FEDERADA
} from '../src/IdentidadFederada.js';

export class ServicioConsolidacionConcesionFederacion {
  constructor({ repositorio, servicioReconciliacionFlujos = null,
    guardiaActivacion = null } = {}) {
    exigirMetodo(repositorio, 'consolidar', 'repositorio');
    if (guardiaActivacion !== null) {
      exigirMetodo(guardiaActivacion, 'exigirActiva', 'guardiaActivacion');
    }
    this.repositorio = repositorio;
    if (servicioReconciliacionFlujos !== null) {
      exigirMetodo(servicioReconciliacionFlujos, 'reconciliarDesdeConcesionEfectiva',
        'servicioReconciliacionFlujos');
    }
    this.servicioReconciliacionFlujos = servicioReconciliacionFlujos;
    this.guardiaActivacion = guardiaActivacion;
  }

  async consolidarRelacion({ relacionId, actor, correlacionId = null } = {}) {
    await this.guardiaActivacion?.exigirActiva('consolidar_concesion_bilateral');
    const relacion = String(crearIdentidadFederada({
      tipo: TIPOS_IDENTIDAD_FEDERADA.RELACION,
      valor: relacionId
    }));
    validarActor(actor);
    const resultado = await this.repositorio.consolidar({
      relacionId: relacion,
      eventoId: generarUuidV7Auditoria(),
      correlacionId: correlacionId || generarUuidV7Auditoria(),
      actor
    });
    if (resultado.revisionEfectivaId &&
        resultado.estado !== 'consolidacionSuperada' &&
        this.servicioReconciliacionFlujos) {
      const reconciliacion = await this.servicioReconciliacionFlujos
        .reconciliarDesdeConcesionEfectiva({
          relacionId: relacion,
          revisionEfectivaId: resultado.revisionEfectivaId
        });
      return Object.freeze({ ...resultado, reconciliacion });
    }
    return resultado;
  }
}

function validarActor(actor) {
  if (!actor || actor.modo !== 'directo' || actor.efectivo != null ||
      !['usuario', 'instancia_remota'].includes(actor.real?.tipo) ||
      typeof actor.real?.id !== 'string' || actor.real.id.length === 0) {
    throw new Error('La consolidación exige un actor causal directo y tipado.');
  }
}

function exigirMetodo(valor, metodo, campo) {
  if (typeof valor?.[metodo] !== 'function') {
    throw new Error(`${campo} debe implementar ${metodo}().`);
  }
}
