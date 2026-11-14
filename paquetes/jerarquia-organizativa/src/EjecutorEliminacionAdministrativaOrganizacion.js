import {
  MODOS_CONSOLIDACION_OPERACION_ADMINISTRATIVA
} from '../../agentes/src/CatalogoEjecutoresOperacionesAdministrativas.js';
import {
  CONTRATO_OPERACION_ADMINISTRATIVA_ELIMINACION_ORGANIZACION
} from './ContratoOperacionAdministrativaEliminacionOrganizacion.js';

export class EjecutorEliminacionAdministrativaOrganizacion {
  constructor({
    clienteSql,
    coordinadorEliminacion,
    repositorioNotificaciones = null,
    publicadorInvalidacionesPortal = null
  } = {}) {
    if (typeof clienteSql?.obtenerConexion !== 'function') {
      throw new Error('El ejecutor organizativo exige SQL operativo.');
    }
    if (typeof coordinadorEliminacion?.ejecutar !== 'function') {
      throw new Error('El ejecutor organizativo exige coordinación transaccional.');
    }
    const invalidacionCompleta =
      typeof repositorioNotificaciones?.obtenerFirma === 'function' &&
      typeof publicadorInvalidacionesPortal?.publicar === 'function';
    if ((repositorioNotificaciones || publicadorInvalidacionesPortal) &&
        !invalidacionCompleta) {
      throw new Error('La invalidación organizativa inicial exige ambos puertos.');
    }
    const contrato =
      CONTRATO_OPERACION_ADMINISTRATIVA_ELIMINACION_ORGANIZACION;
    this.tipo = contrato.tipo;
    this.version = contrato.version;
    this.validarComando = contrato.validarComando;
    this.validarResultado = contrato.validarResultado;
    this.resolverRecursos = contrato.resolverRecursos;
    this.modoConsolidacion =
      MODOS_CONSOLIDACION_OPERACION_ADMINISTRATIVA.EJECUTOR_TRANSACCIONAL;
    Object.assign(this, {
      clienteSql,
      coordinadorEliminacion,
      repositorioNotificaciones,
      publicadorInvalidacionesPortal
    });
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
        { lease: contexto.lease, operacion: normalizado },
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
      // La obligación publicar_invalidacion_portal conserva la convergencia.
    }
  }
}

function exigirMismaOperacion(comando, contexto) {
  const operacionId = String(contexto?.operacion?.operacionId || '');
  const leaseOperacionId = String(contexto?.lease?.operacionId || '');
  if (operacionId !== comando.identidades.operacionId ||
      leaseOperacionId !== comando.identidades.operacionId) {
    const error = new Error('El ejecutor organizativo recibió un comando ajeno al lease.');
    error.codigo = 'operacion_administrativa_contrato_incompatible';
    error.permanente = true;
    error.esErrorOperacionAdministrativa = true;
    throw error;
  }
}
