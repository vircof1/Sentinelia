import { createHash, timingSafeEqual } from 'node:crypto';

import {
  bytesAUuidV7Auditoria,
  uuidV7AuditoriaABytes
} from '../../auditoria/src/UuidV7Auditoria.js';
import { LeaseOperacionDurablePerdido }
  from '../../coordinacion-durable/src/CoordinadorOperacionesDurables.js';
import {
  CONTRATOS_NOTIFICACION_ELIMINACION_ORGANIZACION,
  EMISORES_NOTIFICACION_OPERACION_ADMINISTRATIVA,
  ESTADOS_OPERACION_ADMINISTRATIVA_ORGANIZACION,
  PERFIL_NOTIFICACION_OPERACION_ADMINISTRATIVA,
  PERFIL_RESULTADO_ELIMINACION_ORGANIZACION,
  TIPOS_NOTIFICACION_ELIMINACION_ORGANIZACION,
  VERSION_CONTRATO_ELIMINACION_ADMINISTRATIVA_ORGANIZACION,
  crearNotificacionEliminacionAdministrativaOrganizacion,
  crearResultadoEliminacionAdministrativaOrganizacion
} from './ContratoEliminacionAdministrativaOrganizacion.js';

const RETENCION_NOTIFICACIONES_DIAS = 365;

export class FinalizadorResultadoEliminacionOrganizacionEnTransaccion {
  constructor({
    repositorioOperaciones,
    repositorioNotificaciones,
    repositorioObligaciones,
    retencionNotificacionesDias = RETENCION_NOTIFICACIONES_DIAS
  } = {}) {
    if (typeof repositorioOperaciones?.avanzarConLease !== 'function' ||
        typeof repositorioOperaciones?.consolidarConLease !== 'function' ||
        typeof repositorioOperaciones?.buscarPorId !== 'function' ||
        typeof repositorioNotificaciones?.crearORecuperar !== 'function' ||
        typeof repositorioObligaciones
          ?.listarReferenciasPorOperacionEnTransaccion !== 'function') {
      throw new Error('El finalizador organizativo exige puertos transaccionales.');
    }
    if (!Number.isInteger(retencionNotificacionesDias) ||
        retencionNotificacionesDias < 1 || retencionNotificacionesDias > 3650) {
      throw new Error('La retención terminal debe estar entre 1 y 3650 días.');
    }
    Object.assign(this, {
      repositorioOperaciones,
      repositorioNotificaciones,
      repositorioObligaciones,
      retencionNotificacionesDias
    });
  }

  async finalizarEnTransaccion(
    { lease, ejecucion, registroAuditoria } = {},
    { conexion } = {}
  ) {
    if (typeof conexion?.execute !== 'function') {
      throw new Error('El cierre organizativo exige una conexión prestada.');
    }
    const evento = registroAuditoria?.evento;
    if (!evento?.eventoId || !['incorporado', 'existente'].includes(evento.estado)) {
      throw new Error('El cierre exige un evento auditable incorporado o recuperado.');
    }
    const preparacion = ejecucion?.preparacion;
    const comando = preparacion?.inventario?.comando;
    if (!comando || !preparacion?.impactoFinal ||
        !registroAuditoria?.fotografiaFinal || !registroAuditoria?.cronologia) {
      throw new Error('El cierre no conserva el resultado destructivo completo.');
    }
    exigirEvidenciaCoherente({ comando, ejecucion, registroAuditoria });
    const obligaciones = await this.repositorioObligaciones
      .listarReferenciasPorOperacionEnTransaccion(
        { operacionId: comando.identidades.operacionId },
        { conexion }
      );
    const obligacionesEsperadas = conteo(
      preparacion.impactoFinal,
      'obligaciones_postcommit'
    );
    if (BigInt(obligaciones.length) !== BigInt(obligacionesEsperadas)) {
      throw new Error('El resultado no conserva todas sus obligaciones postcommit.');
    }
    const resultado = crearResultadoEliminacionAdministrativaOrganizacion({
      perfil: PERFIL_RESULTADO_ELIMINACION_ORGANIZACION,
      version: VERSION_CONTRATO_ELIMINACION_ADMINISTRATIVA_ORGANIZACION,
      resultado: 'eliminada',
      estado: ESTADOS_OPERACION_ADMINISTRATIVA_ORGANIZACION.COMPLETADA,
      sujeto: comando.sujeto,
      fotografiaFinal: registroAuditoria.fotografiaFinal,
      impactoFinal: preparacion.impactoFinal,
      cronologia: registroAuditoria.cronologia,
      eventoAuditoriaId: evento.eventoId,
      obligaciones: ordenarObligaciones(obligaciones)
    });
    const leasePersistencia = normalizarLeasePersistencia(lease);
    await avanzarHastaCommit(
      this.repositorioOperaciones,
      leasePersistencia,
      conexion
    );
    const registroNotificacion = await crearNotificacionSiExisteDestinatario({
      repositorioNotificaciones: this.repositorioNotificaciones,
      comando,
      resultado,
      emitidaEnUtc: registroAuditoria.registradoEnUtc || evento.registradoEnUtc,
      retencionDias: this.retencionNotificacionesDias,
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

function exigirEvidenciaCoherente({ comando, ejecucion, registroAuditoria }) {
  const evento = registroAuditoria.evento;
  const cronologia = registroAuditoria.cronologia;
  const esperado = {
    tenant: 'organizacion.tenant_eliminado',
    empresa: 'organizacion.empresa_eliminada',
    sitio: 'organizacion.sitio_eliminado'
  }[comando.sujeto.tipo];
  if (evento.eventoId !== comando.identidades.eventoId ||
      evento.tipo !== esperado ||
      evento.sujeto?.tipo !== comando.sujeto.tipo ||
      evento.sujeto?.id !== comando.sujeto.id ||
      cronologia.aceptadaEnUtc !==
        comando.fotografiaAutorizacion.aceptadaEnUtc ||
      cronologia.efectivoEnUtc !== ejecucion.eliminacionRaiz?.efectivoEnUtc ||
      cronologia.registradoEnUtc !== registroAuditoria.registradoEnUtc) {
    throw new Error('El evento auditable no corresponde al efecto organizativo.');
  }
}

async function avanzarHastaCommit(repositorio, lease, conexion) {
  const operacion = await repositorio.buscarPorId(
    lease.operacionId,
    { conexion, bloquear: true }
  );
  const fases = ['preparacion', 'validacion', 'eliminacion', 'commit'];
  const indice = fases.indexOf(operacion?.fase);
  if (operacion?.estado !== 'ejecutando' || indice < 0) {
    throw new LeaseOperacionDurablePerdido();
  }
  for (const transicion of fases.slice(indice + 1)) {
    const avance = await repositorio.avanzarConLease({
      ...lease,
      transicion,
      datos: null,
      conexion
    });
    exigirLease(avance);
  }
}

async function crearNotificacionSiExisteDestinatario({
  repositorioNotificaciones,
  comando,
  resultado,
  emitidaEnUtc,
  retencionDias,
  conexion
}) {
  const destinatarioUsuarioId = String(
    comando.fotografiaAutorizacion.destinatarioUsuarioId
  );
  const [destinatarios] = await conexion.execute(
    'SELECT id FROM usuarios WHERE id=? FOR UPDATE',
    [destinatarioUsuarioId]
  );
  if (!destinatarios[0]) return null;
  const tipo = TIPOS_NOTIFICACION_ELIMINACION_ORGANIZACION.ELIMINADA;
  const contrato = CONTRATOS_NOTIFICACION_ELIMINACION_ORGANIZACION[tipo];
  const notificacion = crearNotificacionEliminacionAdministrativaOrganizacion({
    perfil: PERFIL_NOTIFICACION_OPERACION_ADMINISTRATIVA,
    version: VERSION_CONTRATO_ELIMINACION_ADMINISTRATIVA_ORGANIZACION,
    notificacionId: derivarUuidV7(
      comando.identidades.operacionId,
      `notificacion:${tipo}`
    ),
    tipo,
    operacionId: comando.identidades.operacionId,
    destinatarioUsuarioId,
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
      fotografiaFinal: resultado.fotografiaFinal
    },
    leida: false,
    leidaEnUtc: null,
    tituloCodigo: contrato.tituloCodigo,
    resumenCodigo: contrato.resumenCodigo
  });
  return repositorioNotificaciones.crearORecuperar({
    notificacion,
    retenerHastaUtc: sumarDias(emitidaEnUtc, retencionDias),
    conexion
  });
}

function ordenarObligaciones(obligaciones) {
  return obligaciones
    .map((item) => ({ ...item }))
    .sort((a, b) => a.obligacionId.localeCompare(b.obligacionId));
}

function conteo(impacto, categoria) {
  const item = impacto.conteos.find((actual) => actual.categoria === categoria);
  const cantidad = String(item?.cantidad ?? '');
  if (!/^(0|[1-9][0-9]*)$/u.test(cantidad)) {
    throw new Error(`El impacto final no contiene ${categoria}.`);
  }
  return cantidad;
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
