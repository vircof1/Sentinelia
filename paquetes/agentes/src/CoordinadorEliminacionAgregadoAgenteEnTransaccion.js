import { LeaseOperacionDurablePerdido }
  from '../../coordinacion-durable/src/CoordinadorOperacionesDurables.js';
import { ErrorPreparacionEliminacionAgregadoAgente }
  from './NucleoPreparacionDependenciasAgenteEnTransaccion.js';

export class CoordinadorEliminacionAgregadoAgenteEnTransaccion {
  constructor({
    adaptadorPreparacion,
    repositorioEliminacion,
    registradorAuditoria,
    finalizadorResultado
  } = {}) {
    if (typeof adaptadorPreparacion?.prepararEnTransaccion !== 'function') {
      throw new Error('El coordinador destructivo exige el adaptador directo.');
    }
    if (
      typeof repositorioEliminacion?.eliminarRaizEnTransaccion !== 'function' ||
      typeof repositorioEliminacion
        ?.verificarPostcondicionesEliminacionEnTransaccion !== 'function'
    ) {
      throw new Error('El coordinador destructivo exige el repositorio de la raíz.');
    }
    if (typeof registradorAuditoria?.registrarEnTransaccion !== 'function') {
      throw new Error('El coordinador destructivo exige un registrador transaccional.');
    }
    if (typeof finalizadorResultado?.finalizarEnTransaccion !== 'function') {
      throw new Error('El cierre destructivo debe compartir la transacción SQL.');
    }
    Object.assign(this, {
      adaptadorPreparacion,
      repositorioEliminacion,
      registradorAuditoria,
      finalizadorResultado
    });
  }

  async ejecutar({ lease } = {}, { conexion } = {}) {
    const preparacion = await this.adaptadorPreparacion.prepararEnTransaccion(
      { lease },
      { conexion }
    );
    if (preparacion.estado === 'agente_ausente') {
      if (typeof this.registradorAuditoria.recuperarEnTransaccion !== 'function') {
        throw new ErrorPreparacionEliminacionAgregadoAgente(
          'agente_eliminacion_sujeto_ausente',
          'La raíz está ausente y el registrador no permite recuperar su evidencia.'
        );
      }
      const registroAuditoria = await this.registradorAuditoria
        .recuperarEnTransaccion({ lease, preparacion }, { conexion });
      if (!registroAuditoria) {
        throw new ErrorPreparacionEliminacionAgregadoAgente(
          'agente_eliminacion_sujeto_ausente',
          'La raíz está ausente sin una eliminación auditable compatible.'
        );
      }
      const cierre = await this.finalizadorResultado.finalizarEnTransaccion(
        { lease, preparacion, registroAuditoria },
        { conexion }
      );
      return congelar({
        estado: 'reentrada_consolidada',
        preparacion,
        eliminacionRaiz: { agenteId: preparacion.sujeto.id, eliminadas: '0' },
        registroAuditoria,
        postcondiciones: preparacion.postcondicionesEsperadas,
        cierre
      });
    }

    let eliminacionRaiz;
    try {
      eliminacionRaiz = await this.repositorioEliminacion
        .eliminarRaizEnTransaccion(
          { agenteId: preparacion.sujeto.id },
          { conexion }
        );
    } catch (error) {
      throw normalizarErrorRepositorio(error);
    }
    const registroAuditoria = await this.registradorAuditoria
      .registrarEnTransaccion(
        { lease, preparacion, eliminacionRaiz },
        { conexion }
      );
    let postcondiciones;
    try {
      postcondiciones = await this.repositorioEliminacion
        .verificarPostcondicionesEliminacionEnTransaccion(
          { lease, preparacion },
          { conexion }
        );
    } catch (error) {
      throw normalizarErrorRepositorio(error);
    }
    const cierre = await this.finalizadorResultado.finalizarEnTransaccion(
      { lease, preparacion, registroAuditoria },
      { conexion }
    );
    return congelar({
      estado: 'eliminado_en_transaccion',
      preparacion,
      eliminacionRaiz,
      registroAuditoria,
      postcondiciones,
      cierre
    });
  }
}

function normalizarErrorRepositorio(error) {
  if (error instanceof LeaseOperacionDurablePerdido) return error;
  if (error?.codigo === 'agente_eliminacion_impacto_no_seguro') {
    return new ErrorPreparacionEliminacionAgregadoAgente(
      error.codigo,
      error.message
    );
  }
  return error;
}

function congelar(valor) {
  if (valor && typeof valor === 'object' && !Object.isFrozen(valor)) {
    for (const hijo of Object.values(valor)) congelar(hijo);
    Object.freeze(valor);
  }
  return valor;
}
