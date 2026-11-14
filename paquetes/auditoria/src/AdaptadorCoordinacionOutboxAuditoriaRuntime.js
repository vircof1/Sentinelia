import {
  LeaseOutboxAuditoriaPerdido
} from './RepositorioOutboxAuditoriaRuntime.js';

export class AdaptadorCoordinacionOutboxAuditoriaRuntime {
  constructor({
    repositorioOutbox,
    repositorioAuditoria,
    capturadorFederacionAuditoria = null
  } = {}) {
    if (!repositorioOutbox?.reclamarSiguienteConLease) {
      throw new Error('El adaptador requiere el repositorio outbox runtime.');
    }
    if (!repositorioAuditoria?.incorporarEnTransaccion) {
      throw new Error('El adaptador requiere el repositorio de auditoría.');
    }
    this.repositorioOutbox = repositorioOutbox;
    this.repositorioAuditoria = repositorioAuditoria;
    if (capturadorFederacionAuditoria !== null &&
        typeof capturadorFederacionAuditoria?.capturarEventoEnTransaccion !==
          'function') {
      throw new Error('La outbox runtime requiere captura federada transaccional.');
    }
    this.capturadorFederacionAuditoria = capturadorFederacionAuditoria;
  }

  async reclamarSiguiente({ instanciaId, leaseToken, ttlSegundos }) {
    const obligacion = await this.repositorioOutbox.reclamarSiguienteConLease({
      instanciaId,
      leaseToken,
      ttlSegundos
    });
    if (!obligacion) return null;
    return {
      operacionId: obligacion.id,
      fencingToken: obligacion.fencingToken,
      intentos: obligacion.intentos,
      operacion: {
        eventoId: obligacion.eventoId,
        claveCadena: obligacion.claveCadena,
        ordenObligacion: obligacion.ordenObligacion
      }
    };
  }

  async renovarLease(parametros) {
    const actualizada = await this.repositorioOutbox.renovarLease(
      leaseOutbox(parametros),
      { ttlSegundos: parametros.ttlSegundos }
    );
    return { actualizada };
  }

  async avanzarConLease(parametros) {
    if (parametros.transicion !== 'lease_verificado') {
      throw new Error('La outbox solo admite la transición lease_verificado.');
    }
    const actualizada = await this.repositorioOutbox.comprobarLeaseVigente(
      leaseOutbox(parametros)
    );
    return { actualizada };
  }

  async consolidarConLease(parametros) {
    const conexion = await this.repositorioOutbox.clienteSql.obtenerConexion();
    try {
      await conexion.beginTransaction();
      const vigente = await this.repositorioOutbox.bloquearLeaseVigente(
        leaseOutbox(parametros),
        { conexion }
      );
      const incorporacion = await this.repositorioAuditoria.incorporarEnTransaccion(
        [vigente.intencion],
        { conexion }
      );
      const evento = incorporacion.eventos[0];
      if (!evento || !['incorporado', 'existente'].includes(evento.estado)) {
        throw crearErrorPermanente(
          'identidad_auditoria_retenida',
          'La identidad auditable fue retenida y no permite materializar la obligación.'
        );
      }
      if (evento.eventoId !== vigente.eventoId) {
        throw crearErrorPermanente(
          'evento_incorporado_incoherente',
          'La incorporación devolvió una identidad causal distinta.'
        );
      }
      if (evento.estado === 'incorporado' && this.capturadorFederacionAuditoria) {
        await this.capturadorFederacionAuditoria.capturarEventoEnTransaccion(
          { eventoId: evento.eventoId },
          { conexion }
        );
      }
      await this.repositorioOutbox.marcarCompletada(vigente, { conexion });
      await conexion.commit();
      return {
        actualizada: true,
        estado: 'completada',
        eventoId: vigente.eventoId,
        resultadoEvento: evento.estado,
        secuencia: evento.secuencia
      };
    } catch (error) {
      await rollbackSeguro(conexion);
      if (error instanceof LeaseOutboxAuditoriaPerdido) {
        return { actualizada: false };
      }
      throw error;
    } finally {
      conexion.release();
    }
  }

  async registrarFalloConLease(parametros) {
    try {
      const fallo = await this.repositorioOutbox.registrarFallo({
        ...leaseOutbox(parametros),
        permanente: parametros.permanente,
        codigoError: parametros.diagnostico.codigo,
        mensajeError: parametros.diagnostico.mensaje,
        demoraReintentoSegundos: parametros.demoraReintentoSegundos
      });
      return { actualizada: true, ...fallo };
    } catch (error) {
      if (error instanceof LeaseOutboxAuditoriaPerdido) {
        return { actualizada: false };
      }
      throw error;
    }
  }
}

function leaseOutbox({ operacionId, instanciaId, leaseToken, fencingToken }) {
  return {
    id: operacionId,
    instanciaId,
    leaseToken: Buffer.from(leaseToken).toString('hex'),
    fencingToken
  };
}

function crearErrorPermanente(codigo, mensaje) {
  const error = new Error(mensaje);
  error.name = 'ObligacionOutboxAuditoriaNoIncorporable';
  error.codigo = codigo;
  error.permanente = true;
  return error;
}

async function rollbackSeguro(conexion) {
  try {
    await conexion.rollback();
  } catch {
    // El error causal conserva prioridad sobre un rollback fallido.
  }
}
