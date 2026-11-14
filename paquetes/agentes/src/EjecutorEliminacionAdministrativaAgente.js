import {
  MODOS_CONSOLIDACION_OPERACION_ADMINISTRATIVA
} from './CatalogoEjecutoresOperacionesAdministrativas.js';
import {
  CONTRATO_OPERACION_ADMINISTRATIVA_ELIMINACION_AGENTE
} from './ContratoOperacionAdministrativaEliminacionAgente.js';

export class EjecutorEliminacionAdministrativaAgente {
  constructor({
    clienteSql,
    coordinadorEliminacion,
    repositorioNotificaciones = null,
    publicadorInvalidacionesPortal = null
  } = {}) {
    if (typeof clienteSql?.obtenerConexion !== 'function') {
      throw new Error('El ejecutor de eliminación exige SQL operativo.');
    }
    if (typeof coordinadorEliminacion?.ejecutar !== 'function') {
      throw new Error('El ejecutor de eliminación exige coordinación transaccional.');
    }
    const invalidacionCompleta =
      typeof repositorioNotificaciones?.obtenerFirma === 'function' &&
      typeof publicadorInvalidacionesPortal?.publicar === 'function';
    if ((repositorioNotificaciones || publicadorInvalidacionesPortal) &&
        !invalidacionCompleta) {
      throw new Error('La invalidación inicial del buzón exige ambos puertos.');
    }
    this.tipo = CONTRATO_OPERACION_ADMINISTRATIVA_ELIMINACION_AGENTE.tipo;
    this.version = CONTRATO_OPERACION_ADMINISTRATIVA_ELIMINACION_AGENTE.version;
    this.validarComando =
      CONTRATO_OPERACION_ADMINISTRATIVA_ELIMINACION_AGENTE.validarComando;
    this.validarResultado =
      CONTRATO_OPERACION_ADMINISTRATIVA_ELIMINACION_AGENTE.validarResultado;
    this.resolverRecursos =
      CONTRATO_OPERACION_ADMINISTRATIVA_ELIMINACION_AGENTE.resolverRecursos;
    this.modoConsolidacion =
      MODOS_CONSOLIDACION_OPERACION_ADMINISTRATIVA.EJECUTOR_TRANSACCIONAL;
    this.clienteSql = clienteSql;
    this.coordinadorEliminacion = coordinadorEliminacion;
    this.repositorioNotificaciones = repositorioNotificaciones;
    this.publicadorInvalidacionesPortal = publicadorInvalidacionesPortal;
  }

  async ejecutar(comando, contexto = {}) {
    const normalizado = this.validarComando(comando);
    exigirMismaOperacion(normalizado, contexto);
    const conexion = await this.clienteSql.obtenerConexion();
    let ejecucion;
    try {
      await conexion.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
      await conexion.beginTransaction();
      ejecucion = await this.coordinadorEliminacion.ejecutar(
        { lease: contexto.lease },
        { conexion }
      );
      await conexion.commit();
    } catch (error) {
      await conexion.rollback().catch(() => {});
      throw error;
    } finally {
      conexion.release();
    }
    await this.#publicarInvalidacionInicialSinRomperCommit(ejecucion);
    return ejecucion.cierre.resultado;
  }

  async #publicarInvalidacionInicialSinRomperCommit(ejecucion) {
    if (!this.publicadorInvalidacionesPortal) return;
    const destinatario = ejecucion?.cierre?.registroNotificacion
      ?.notificacion?.destinatarioUsuarioId;
    if (!destinatario) return;
    try {
      const firma = await this.repositorioNotificaciones.obtenerFirma(destinatario);
      await this.publicadorInvalidacionesPortal.publicar({
        destinatarioUsuarioId: destinatario,
        firmaBuzon: firma.firma
      });
    } catch {
      // La obligación durable publicar_invalidacion_portal garantiza convergencia.
    }
  }
}

function exigirMismaOperacion(comando, contexto) {
  const operacionId = String(contexto?.operacion?.operacionId || '');
  const leaseOperacionId = String(contexto?.lease?.operacionId || '');
  if (
    operacionId !== comando.identidades.operacionId ||
    leaseOperacionId !== comando.identidades.operacionId
  ) {
    throw new Error('El ejecutor recibió un comando ajeno al lease reclamado.');
  }
}
