export class ResolutorVisibilidadCausalAuditoria {
  constructor({ repositorioLectura = null } = {}) {
    this.repositorioLectura = repositorioLectura;
  }

  async resolverLote({ eventos = [], contextoUsuarioActual } = {}) {
    if (!Array.isArray(eventos)) throw new Error('La proyección causal requiere una lista de eventos.');
    if (!contextoUsuarioActual?.permisos?.verAuditoria) return loteVacio();
    if (
      !this.repositorioLectura?.eventosVisiblesPorIds ||
      !this.repositorioLectura?.causalidadesVisiblesPorTipo
    ) {
      return null;
    }

    const idsEventosAuditoria = new Set();
    const idsPorTipo = new Map();
    for (const evento of eventos) {
      if (evento?.eventoContraparteId) idsEventosAuditoria.add(String(evento.eventoContraparteId));
      if (!evento?.causalidadTipo || !evento?.causalidadId) continue;
      const permiso = PERMISO_POR_TIPO[evento.causalidadTipo];
      if (permiso === undefined || (permiso && !contextoUsuarioActual.permisos?.[permiso])) continue;
      if (evento.causalidadTipo === 'evento_auditoria') {
        idsEventosAuditoria.add(String(evento.causalidadId));
        continue;
      }
      const ids = idsPorTipo.get(evento.causalidadTipo) || new Set();
      ids.add(String(evento.causalidadId));
      idsPorTipo.set(evento.causalidadTipo, ids);
    }

    const tipos = [...idsPorTipo.keys()];
    const [eventosVisibles, ...causalidadesVisibles] = await Promise.all([
      idsEventosAuditoria.size
        ? this.repositorioLectura.eventosVisiblesPorIds({
          eventoIds: [...idsEventosAuditoria],
          contextoUsuarioActual
        })
        : [],
      ...tipos.map((tipo) => this.repositorioLectura.causalidadesVisiblesPorTipo({
        tipo,
        ids: [...idsPorTipo.get(tipo)],
        contextoUsuarioActual
      }))
    ]);
    return Object.freeze({
      eventosAuditoriaVisibles: Object.freeze([...eventosVisibles]),
      causalidadesPorTipo: Object.freeze(Object.fromEntries(
        tipos.map((tipo, indice) => [tipo, Object.freeze([...causalidadesVisibles[indice]])])
      ))
    });
  }

  async proyectarCausalidad({ evento, contextoUsuarioActual, visibilidadLote = null }) {
    if (!evento?.causalidadTipo || !evento?.causalidadId) return null;
    if (!contextoUsuarioActual?.permisos?.verAuditoria) return null;
    const permisoFuncional = PERMISO_POR_TIPO[evento.causalidadTipo];
    if (permisoFuncional === undefined) return null;
    if (permisoFuncional && !contextoUsuarioActual.permisos?.[permisoFuncional]) return null;
    if (visibilidadLote) {
      const visibles = evento.causalidadTipo === 'evento_auditoria'
        ? visibilidadLote.eventosAuditoriaVisibles
        : visibilidadLote.causalidadesPorTipo[evento.causalidadTipo];
      if (!visibles?.includes(String(evento.causalidadId))) return null;
      return Object.freeze({
        tipo: evento.causalidadTipo,
        id: evento.causalidadId
      });
    }
    if (!this.repositorioLectura?.causalidadVisible) return null;
    const visible = await this.repositorioLectura.causalidadVisible({
      tipo: evento.causalidadTipo,
      id: evento.causalidadId,
      contextoUsuarioActual
    });
    if (!visible) return null;
    return Object.freeze({
      tipo: evento.causalidadTipo,
      id: evento.causalidadId
    });
  }

  async proyectarContraparte({ evento, contextoUsuarioActual, visibilidadLote = null }) {
    if (!evento?.eventoContraparteId) return null;
    if (!contextoUsuarioActual?.permisos?.verAuditoria) return null;
    if (visibilidadLote) {
      return visibilidadLote.eventosAuditoriaVisibles.includes(String(evento.eventoContraparteId))
        ? evento.eventoContraparteId
        : null;
    }
    if (!this.repositorioLectura?.eventoVisiblePorId) return null;
    const visible = await this.repositorioLectura.eventoVisiblePorId({
      eventoId: evento.eventoContraparteId,
      contextoUsuarioActual
    });
    return visible ? evento.eventoContraparteId : null;
  }
}

function loteVacio() {
  return Object.freeze({
    eventosAuditoriaVisibles: Object.freeze([]),
    causalidadesPorTipo: Object.freeze({})
  });
}

const PERMISO_POR_TIPO = Object.freeze({
  solicitud_recuperacion_password: null,
  evento_auditoria: null,
  evento_monitor: 'verMonitores',
  ejecucion_trigger: 'verTriggers',
  operacion_sesion_agente: 'verAgentes',
  generacion_dns: 'verDns'
});
