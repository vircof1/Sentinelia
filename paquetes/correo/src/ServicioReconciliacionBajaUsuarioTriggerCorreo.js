import { generarUuidV7Auditoria }
  from '../../auditoria/src/UuidV7Auditoria.js';
import { PERFIL_JCS_AUDITORIA_V1 }
  from '../../auditoria/src/PerfilJcsAuditoria.js';
import { VERSION_ENCADENADO_AUDITORIA_V1 }
  from '../../auditoria/src/SobreCanonicoAuditoria.js';
import { MutadorRevisionDeclaracionTriggerSql }
  from '../../triggers/src/MutadorRevisionDeclaracionTriggerSql.js';

export class ServicioReconciliacionBajaUsuarioTriggerCorreo {
  constructor({
    repositorioAudiencia,
    servicioAuditoria,
    mutadorRevision = new MutadorRevisionDeclaracionTriggerSql(),
    ahora = () => new Date()
  }) {
    if (typeof repositorioAudiencia?.listarIdsTriggersPorUsuarioEnTransaccion !==
        'function' ||
        typeof repositorioAudiencia?.listarIdsTriggersPorUsuariosEnTransaccion !==
        'function' ||
        typeof repositorioAudiencia?.bloquearTriggersCorreoEnTransaccion !==
        'function' ||
        typeof repositorioAudiencia?.listarMultiplesEnTransaccion !== 'function' ||
        typeof servicioAuditoria?.registrarEnTransaccion !== 'function') {
      throw new Error('La baja de usuario consciente de audiencia requiere todos sus puertos.');
    }
    this.repositorio = repositorioAudiencia;
    this.auditoria = servicioAuditoria;
    this.mutadorRevision = mutadorRevision;
    this.ahora = ahora;
  }

  async prepararEnTransaccion(usuarioId, { conexion } = {}) {
    return this.prepararUsuariosEnTransaccion([usuarioId], { conexion });
  }

  async prepararUsuariosEnTransaccion(idsUsuario = [], { conexion } = {}) {
    const usuarios = idsDecimales(idsUsuario);
    const ids = await this.repositorio.listarIdsTriggersPorUsuariosEnTransaccion(
      usuarios,
      { conexion }
    );
    const triggers = await this.repositorio.bloquearTriggersCorreoEnTransaccion(
      ids,
      { conexion }
    );
    const idsSupervivientes = triggers.map((trigger) => Number(trigger.id));
    const relaciones = await this.repositorio.listarMultiplesEnTransaccion(
      idsSupervivientes,
      { bloquear: true },
      { conexion }
    );
    const conjuntoUsuarios = new Set(usuarios.map(Number));
    const retiradas = relaciones.filter((relacion) =>
      conjuntoUsuarios.has(Number(relacion.usuario_id)));
    return congelar({
      usuariosIds: usuarios,
      triggers,
      relacionesRetiradas: retiradas,
      totalRelacionesRetiradas: retiradas.length
    });
  }

  async reconciliarEnTransaccion(preparacion, contextoUsuarioActual, {
    conexion
  } = {}) {
    const inventariados = preparacion?.triggers || [];
    if (inventariados.length === 0) return resultadoVacio(preparacion);
    const ids = inventariados.map((trigger) => Number(trigger.id));
    const triggers = await this.repositorio.bloquearTriggersCorreoEnTransaccion(
      ids,
      { conexion }
    );
    const restantes = await this.repositorio.listarMultiplesEnTransaccion(
      ids,
      {},
      { conexion }
    );
    const activas = new Set(restantes
      .filter((relacion) => relacion.estado_participacion === 'activa')
      .map((relacion) => Number(relacion.trigger_id)));
    const desactivados = [];
    const eventos = [];
    for (const trigger of triggers) {
      if (!Boolean(trigger.activo) || activas.has(Number(trigger.id))) continue;
      const revision = await this.mutadorRevision.actualizar({
        ejecutor: conexion,
        idTrigger: trigger.id,
        revisionEsperada: trigger.revision_declaracion,
        cambios: { activo: 0 }
      });
      const desactivado = congelar({
        id: String(trigger.id),
        revisionAnterior: revision.revisionAnterior,
        revisionNueva: revision.revisionNueva
      });
      desactivados.push(desactivado);
      eventos.push(await this.registrarDesactivacion({
        conexion,
        contextoUsuarioActual,
        trigger
      }));
    }
    return congelar({
      totalRelacionesRetiradas: Number(preparacion?.totalRelacionesRetiradas || 0),
      totalTriggersAfectados: inventariados.length,
      totalTriggersSupervivientes: triggers.length,
      totalTriggersDesactivados: desactivados.length,
      triggersDesactivados: desactivados,
      eventos
    });
  }

  registrarDesactivacion({
    conexion,
    contextoUsuarioActual,
    trigger
  }) {
    const eventoId = generarUuidV7Auditoria();
    const scope = scopeTrigger(trigger);
    return this.auditoria.registrarEnTransaccion({
      cambioEfectivo: true,
      intencion: {
        versionContrato: 1,
        eventoId,
        tipo: 'trigger.audiencia_vacia_desactivado',
        flujo: 'automatizacion',
        claveCadena: scope.tenantId
          ? `automatizacion:tenant:${scope.tenantId}`
          : 'automatizacion:portal',
        actor: 'usuario',
        actorReal: actor(contextoUsuarioActual, 'idUsuarioReal'),
        actorEfectivo: contextoUsuarioActual?.impersonacionActiva
          ? actor(contextoUsuarioActual, 'idUsuario')
          : null,
        modoActuacion: contextoUsuarioActual?.impersonacionActiva
          ? 'impersonado'
          : 'directo',
        sujeto: { tipo: 'trigger', id: String(trigger.id) },
        origen: 'web',
        correlacionId: eventoId,
        causalidad: null,
        productor: 'portal_web',
        claveOperacion: eventoId,
        scope,
        efectivoEnUtc: this.ahora().toISOString(),
        rolEvento: 'principal',
        payload: {
          resultado: 'actualizado',
          camposCambiados: ['activo'],
          antes: { activo: true },
          despues: { activo: false }
        },
        versionCanonicalizador: PERFIL_JCS_AUDITORIA_V1,
        versionEncadenado: VERSION_ENCADENADO_AUDITORIA_V1
      }
    }, { conexion });
  }
}

function resultadoVacio(preparacion) {
  return congelar({
    totalRelacionesRetiradas: Number(preparacion?.totalRelacionesRetiradas || 0),
    totalTriggersAfectados: 0,
    totalTriggersSupervivientes: 0,
    totalTriggersDesactivados: 0,
    triggersDesactivados: [],
    eventos: []
  });
}

function scopeTrigger(trigger) {
  return {
    tenantId: trigger.tenant_id == null ? null : String(trigger.tenant_id),
    empresaId: trigger.empresa_id == null ? null : String(trigger.empresa_id),
    sitioId: trigger.sitio_id == null ? null : String(trigger.sitio_id)
  };
}

function actor(contexto, campo) {
  const valor = contexto?.[campo] ?? contexto?.idUsuario;
  return { tipo: 'usuario', id: String(valor) };
}

function idsDecimales(valores) {
  const ids = [...new Set((valores || []).map(Number))].sort((a, b) => a - b);
  if (ids.some((id) => !Number.isSafeInteger(id) || id < 1)) {
    throw new TypeError('Los usuarios de la reconciliación deben ser ids positivos.');
  }
  return Object.freeze(ids.map(String));
}

function congelar(valor) {
  if (Array.isArray(valor)) return Object.freeze(valor.map(congelar));
  if (!valor || typeof valor !== 'object') return valor;
  return Object.freeze(Object.fromEntries(
    Object.entries(valor).map(([clave, item]) => [clave, congelar(item)])
  ));
}
