import { createHash, timingSafeEqual } from 'node:crypto';

import {
  bytesAUuidV7Auditoria,
  uuidV7AuditoriaABytes
} from '../../auditoria/src/UuidV7Auditoria.js';
import { LeaseOperacionDurablePerdido }
  from '../../coordinacion-durable/src/CoordinadorOperacionesDurables.js';
import {
  CONTRATOS_NOTIFICACION_ELIMINACION_AGENTE,
  EMISORES_NOTIFICACION_OPERACION_ADMINISTRATIVA,
  ESTADOS_OPERACION_ADMINISTRATIVA,
  PERFIL_NOTIFICACION_OPERACION_ADMINISTRATIVA,
  PERFIL_RESULTADO_ELIMINACION_AGENTE,
  TIPOS_NOTIFICACION_ELIMINACION_AGENTE,
  VERSION_CONTRATO_ELIMINACION_ADMINISTRATIVA_AGENTE,
  crearNotificacionEliminacionAdministrativaAgente,
  crearResultadoEliminacionAdministrativaAgente
} from './ContratoEliminacionAdministrativaAgente.js';

const RETENCION_NOTIFICACIONES_DIAS = 365;

export class FinalizadorResultadoEliminacionAgenteEnTransaccion {
  constructor({
    repositorioOperaciones,
    repositorioNotificaciones,
    repositorioObligaciones,
    retencionNotificacionesDias = RETENCION_NOTIFICACIONES_DIAS
  } = {}) {
    if (
      typeof repositorioOperaciones?.avanzarConLease !== 'function' ||
      typeof repositorioOperaciones?.consolidarConLease !== 'function' ||
      typeof repositorioOperaciones?.buscarPorId !== 'function' ||
      typeof repositorioNotificaciones?.crearORecuperar !== 'function' ||
      typeof repositorioObligaciones
        ?.listarReferenciasPorOperacionEnTransaccion !== 'function'
    ) {
      throw new Error('El finalizador exige operación durable y buzón transaccionales.');
    }
    if (!Number.isInteger(retencionNotificacionesDias) ||
        retencionNotificacionesDias < 1 || retencionNotificacionesDias > 3650) {
      throw new Error('La retención terminal debe estar entre 1 y 3650 días.');
    }
    this.repositorioOperaciones = repositorioOperaciones;
    this.repositorioNotificaciones = repositorioNotificaciones;
    this.repositorioObligaciones = repositorioObligaciones;
    this.retencionNotificacionesDias = retencionNotificacionesDias;
  }

  async finalizarEnTransaccion(
    { lease, preparacion, registroAuditoria } = {},
    { conexion } = {}
  ) {
    const evento = registroAuditoria?.evento;
    if (!evento?.eventoId || !['incorporado', 'existente'].includes(evento.estado)) {
      throw new Error('El cierre exige un evento auditable incorporado o recuperado.');
    }
    const obligaciones = preparacion.obligacionesPostcommit.length > 0
      ? preparacion.obligacionesPostcommit
      : await this.repositorioObligaciones
        .listarReferenciasPorOperacionEnTransaccion(
          { operacionId: preparacion.comando.identidades.operacionId },
          { conexion }
        );
    const resultado = construirResultado(
      preparacion,
      registroAuditoria,
      obligaciones
    );
    const leasePersistencia = normalizarLeasePersistencia(lease);
    const operacion = await this.repositorioOperaciones.buscarPorId(
      leasePersistencia.operacionId,
      { conexion, bloquear: true }
    );
    const fases = ['preparacion', 'validacion', 'eliminacion', 'commit'];
    const indiceFase = fases.indexOf(operacion?.fase);
    if (operacion?.estado !== 'ejecutando' || indiceFase < 0) {
      throw new LeaseOperacionDurablePerdido();
    }
    for (const transicion of fases.slice(indiceFase + 1)) {
      const avance = await this.repositorioOperaciones.avanzarConLease({
        ...leasePersistencia,
        transicion,
        datos: null,
        conexion
      });
      exigirLease(avance);
    }

    const emitidaEnUtc = registroAuditoria.registradoEnUtc ||
      evento.primeraObservacionUtc;
    const notificacion = construirNotificacion({ preparacion, resultado, emitidaEnUtc });
    const registroNotificacion = await this.repositorioNotificaciones.crearORecuperar({
      notificacion,
      retenerHastaUtc: sumarDias(emitidaEnUtc, this.retencionNotificacionesDias),
      conexion
    });
    const consolidacion = await this.repositorioOperaciones.consolidarConLease({
      ...leasePersistencia,
      resultado,
      conexion
    });
    exigirLease(consolidacion);
    return congelar({ resultado, registroNotificacion, consolidacion });
  }
}

function construirResultado(preparacion, registroAuditoria, referencias) {
  const obligaciones = referencias
    .map((item) => ({ ...item }))
    .sort((a, b) => a.obligacionId.localeCompare(b.obligacionId));
  return crearResultadoEliminacionAdministrativaAgente({
    perfil: PERFIL_RESULTADO_ELIMINACION_AGENTE,
    version: VERSION_CONTRATO_ELIMINACION_ADMINISTRATIVA_AGENTE,
    resultado: 'eliminado',
    estado: ESTADOS_OPERACION_ADMINISTRATIVA.COMPLETADA,
    sujeto: preparacion.comando.sujeto,
    impactoResumen: construirImpactoResultado(preparacion, registroAuditoria),
    cronologia: construirCronologia(preparacion, registroAuditoria),
    eventoAuditoriaId: registroAuditoria.evento.eventoId,
    obligaciones
  });
}

function construirCronologia(preparacion, registroAuditoria) {
  const evento = registroAuditoria.evento;
  return {
    aceptadaEnUtc:
      preparacion.comando.fotografiaAutorizacion.aceptadaEnUtc,
    efectivoEnUtc: evento.efectivoEnUtc,
    registradoEnUtc:
      registroAuditoria.registradoEnUtc || evento.registradoEnUtc
  };
}

function construirImpactoResultado(preparacion, registroAuditoria) {
  const origen = preparacion.conteosFinales.length > 0
    ? {
        perfil: preparacion.comando.resumenImpacto.perfil,
        version: preparacion.comando.resumenImpacto.version,
        conteos: preparacion.conteosFinales
      }
    : registroAuditoria.evento.payload?.impactoResumen;
  if (!origen) throw new Error('La reentrada no conserva el impacto auditable.');
  return {
    perfil: origen.perfil,
    version: origen.version,
    conteos: origen.conteos.map((item) => ({ ...item }))
  };
}

function construirNotificacion({ preparacion, resultado, emitidaEnUtc }) {
  const comando = preparacion.comando;
  const tipo = TIPOS_NOTIFICACION_ELIMINACION_AGENTE.ELIMINADA;
  const contrato = CONTRATOS_NOTIFICACION_ELIMINACION_AGENTE[tipo];
  return crearNotificacionEliminacionAdministrativaAgente({
    perfil: PERFIL_NOTIFICACION_OPERACION_ADMINISTRATIVA,
    version: VERSION_CONTRATO_ELIMINACION_ADMINISTRATIVA_AGENTE,
    notificacionId: derivarUuidV7(
      comando.identidades.operacionId,
      `notificacion:${tipo}`
    ),
    tipo,
    operacionId: comando.identidades.operacionId,
    destinatarioUsuarioId:
      comando.fotografiaAutorizacion.destinatarioUsuarioId,
    emisor: {
      tipo: EMISORES_NOTIFICACION_OPERACION_ADMINISTRATIVA.PROCESO,
      actorRealId: null,
      actorEfectivoId: null
    },
    emitidaEnUtc,
    estadoOperacion: resultado.estado,
    referenciaSujeto: {
      tipo: comando.sujeto.tipo,
      id: comando.sujeto.id,
      guid: comando.sujeto.guid
    },
    leida: false,
    leidaEnUtc: null,
    tituloCodigo: contrato.tituloCodigo,
    resumenCodigo: contrato.resumenCodigo
  });
}

function exigirLease(resultado) {
  if (!resultado?.actualizada) throw new LeaseOperacionDurablePerdido();
}

function normalizarLeasePersistencia(lease) {
  const token = Buffer.isBuffer(lease?.leaseToken)
    ? Buffer.from(lease.leaseToken)
    : Buffer.from(String(lease?.leaseToken || ''), 'hex');
  if (token.length !== 32) throw new LeaseOperacionDurablePerdido();
  return {
    operacionId: lease.operacionId,
    instanciaId: lease.instanciaId,
    leaseToken: token,
    fencingToken: lease.fencingToken
  };
}

function derivarUuidV7(padre, etiqueta) {
  const padreBytes = uuidV7AuditoriaABytes(padre, 'operacionId');
  const salida = createHash('sha256')
    .update(padreBytes)
    .update('\0', 'utf8')
    .update(etiqueta, 'utf8')
    .digest()
    .subarray(0, 16);
  padreBytes.copy(salida, 0, 0, 6);
  salida[6] = 0x70 | (salida[6] & 0x0f);
  salida[8] = 0x80 | (salida[8] & 0x3f);
  if (timingSafeEqual(salida, padreBytes)) salida[15] ^= 0x01;
  return bytesAUuidV7Auditoria(salida);
}

function sumarDias(instante, dias) {
  return new Date(Date.parse(instante) + dias * 86_400_000).toISOString();
}

function congelar(valor) {
  if (valor && typeof valor === 'object' && !Object.isFrozen(valor)) {
    for (const hijo of Object.values(valor)) congelar(hijo);
    Object.freeze(valor);
  }
  return valor;
}
