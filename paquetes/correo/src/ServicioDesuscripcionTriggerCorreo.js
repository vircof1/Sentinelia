import { createHash } from 'node:crypto';
import { generarUuidV7Auditoria }
  from '../../auditoria/src/UuidV7Auditoria.js';
import { PERFIL_JCS_AUDITORIA_V1 }
  from '../../auditoria/src/PerfilJcsAuditoria.js';
import { VERSION_ENCADENADO_AUDITORIA_V1 }
  from '../../auditoria/src/SobreCanonicoAuditoria.js';
import { MutadorRevisionDeclaracionTriggerSql }
  from '../../triggers/src/MutadorRevisionDeclaracionTriggerSql.js';

const TOKEN_CAPACIDAD = /^[A-Za-z0-9_-]{43}$/u;

export class ServicioDesuscripcionTriggerCorreo {
  constructor({
    repositorio,
    fronteraTransaccional,
    servicioAuditoria,
    mutadorRevision = new MutadorRevisionDeclaracionTriggerSql(),
    ahora = () => new Date()
  } = {}) {
    if (typeof repositorio?.localizarPreliminar !== 'function' ||
        typeof fronteraTransaccional?.ejecutar !== 'function' ||
        typeof servicioAuditoria?.registrarEnTransaccion !== 'function') {
      throw new Error('La desuscripción requiere persistencia y auditoría.');
    }
    this.repositorio = repositorio;
    this.frontera = fronteraTransaccional;
    this.auditoria = servicioAuditoria;
    this.mutadorRevision = mutadorRevision;
    this.ahora = ahora;
  }

  async comprobar(token) {
    const hash = hashTokenValido(token);
    if (!hash) return resultadoGenerico(false);
    const capacidad = await this.repositorio.localizarPreliminar(hash);
    return resultadoGenerico(Boolean(capacidad));
  }

  async retirar(token) {
    const hash = hashTokenValido(token);
    if (!hash) return resultadoGenerico(false);
    const preliminar = await this.repositorio.localizarPreliminar(hash);
    if (!preliminar) return resultadoGenerico(false);

    return this.frontera.ejecutar(async (conexion) => {
      const triggerId = Number(preliminar.trigger_id);
      if (!Number.isSafeInteger(triggerId) || triggerId < 1) {
        await this.repositorio.bloquearCapacidad(hash, { conexion });
        return resultadoGenerico(false);
      }

      const trigger = await this.repositorio.bloquearTrigger(
        triggerId,
        { conexion }
      );
      if (!trigger || trigger.tipo !== 'correo') {
        await this.repositorio.bloquearCapacidad(hash, { conexion });
        return resultadoGenerico(false);
      }
      const capacidad = await this.repositorio.bloquearCapacidad(
        hash,
        { conexion }
      );
      if (!esCapacidadVigente(capacidad, triggerId)) {
        return resultadoGenerico(false);
      }
      const relaciones = await this.repositorio.bloquearRelacionesDeLaEntrega({
        triggerId,
        salidaCorreoId: capacidad.salida_correo_id
      }, { conexion });
      const activas = relaciones.filter(
        (relacion) => relacion.estado_participacion === 'activa'
      );
      if (activas.length === 0) return resultadoGenerico(true);

      const afectadas = await this.repositorio.desuscribirActivas(
        activas.map((relacion) => relacion.id),
        { conexion }
      );
      if (afectadas === 0) return resultadoGenerico(true);
      const totalActivas = await this.repositorio.contarActivas(
        triggerId,
        { conexion }
      );
      const desactivar = Boolean(trigger.activo) && totalActivas === 0;
      await this.mutadorRevision.actualizar({
        ejecutor: conexion,
        idTrigger: triggerId,
        revisionEsperada: Number(trigger.revision_declaracion),
        cambios: desactivar ? { activo: 0 } : {}
      });
      await this.#auditar({
        conexion,
        trigger,
        capacidad,
        relaciones: activas,
        desactivar
      });
      return resultadoGenerico(true);
    });
  }

  async #auditar({ conexion, trigger, capacidad, relaciones, desactivar }) {
    for (const relacion of relaciones) {
      await this.#registrarEvento({
        conexion,
        trigger,
        capacidad,
        tipo: 'trigger.audiencia_destinatario_desuscrito',
        sujeto: { tipo: 'destinatario_trigger_correo', id: String(relacion.id) },
        payload: {
          resultado: 'actualizado',
          camposCambiados: ['estadoParticipacion'],
          antes: { estadoParticipacion: 'activa' },
          despues: { estadoParticipacion: 'desuscrita' }
        }
      });
    }
    if (desactivar) {
      await this.#registrarEvento({
        conexion,
        trigger,
        capacidad,
        tipo: 'trigger.audiencia_vacia_desactivado',
        sujeto: { tipo: 'trigger', id: String(trigger.id) },
        payload: {
          resultado: 'actualizado',
          camposCambiados: ['activo'],
          antes: { activo: true },
          despues: { activo: false }
        }
      });
    }
  }

  #registrarEvento({ conexion, trigger, capacidad, tipo, sujeto, payload }) {
    const eventoId = generarUuidV7Auditoria();
    const scope = scopeTrigger(trigger);
    return this.auditoria.registrarEnTransaccion({
      cambioEfectivo: true,
      intencion: {
        versionContrato: 1,
        eventoId,
        tipo,
        flujo: 'automatizacion',
        claveCadena: scope.tenantId
          ? `automatizacion:tenant:${scope.tenantId}`
          : 'automatizacion:portal',
        actor: 'sistema',
        actorReal: { tipo: 'sistema', id: 'sentinelia-system' },
        actorEfectivo: null,
        modoActuacion: 'directo',
        sujeto,
        origen: 'web',
        correlacionId: eventoId,
        causalidad: null,
        productor: 'portal_web',
        claveOperacion: eventoId,
        scope,
        efectivoEnUtc: this.ahora().toISOString(),
        rolEvento: 'principal',
        payload,
        versionCanonicalizador: PERFIL_JCS_AUDITORIA_V1,
        versionEncadenado: VERSION_ENCADENADO_AUDITORIA_V1
      }
    }, { conexion });
  }
}

function hashTokenValido(valor) {
  const token = String(valor || '');
  if (!TOKEN_CAPACIDAD.test(token)) return null;
  const bytes = Buffer.from(token, 'base64url');
  if (bytes.length !== 32 || bytes.toString('base64url') !== token) return null;
  return createHash('sha256').update(token, 'ascii').digest();
}

function esCapacidadVigente(capacidad, triggerId) {
  return Boolean(capacidad) && capacidad.estado === 'emitida' &&
    Number(capacidad.vigente) === 1 && Number(capacidad.trigger_id) === triggerId &&
    Number(capacidad.trigger_id_fotografia) === triggerId;
}

function resultadoGenerico(vigente) {
  return Object.freeze({ procesada: true, vigente: Boolean(vigente) });
}

function scopeTrigger(trigger) {
  return Object.freeze({
    tenantId: trigger.tenant_id == null ? null : String(trigger.tenant_id),
    empresaId: trigger.empresa_id == null ? null : String(trigger.empresa_id),
    sitioId: trigger.sitio_id == null ? null : String(trigger.sitio_id)
  });
}
