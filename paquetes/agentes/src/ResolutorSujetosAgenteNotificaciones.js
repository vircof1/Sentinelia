import {
  CatalogoResolutoresSujetosNotificaciones,
  claveSujetoNotificacion
} from '../../coordinacion-durable/src/CatalogoResolutoresSujetosNotificaciones.js';

export class ResolutorSujetosAgenteNotificaciones {
  tiposSujeto = Object.freeze(['agente']);

  constructor({ repositorioAgentes, servicioAutorizacion } = {}) {
    if (typeof repositorioAgentes?.buscarVisiblesPorIds !== 'function') {
      throw new Error('El resolutor de agentes exige búsqueda visible agrupada.');
    }
    if (typeof servicioAutorizacion?.puedeVerAgentes !== 'function') {
      throw new Error('El resolutor de agentes exige autorización explícita.');
    }
    this.repositorioAgentes = repositorioAgentes;
    this.servicioAutorizacion = servicioAutorizacion;
  }

  async resolver(contextoUsuarioActual, referencias) {
    if (!this.servicioAutorizacion.puedeVerAgentes(contextoUsuarioActual)) {
      return new Map();
    }
    const ids = [...new Set(referencias.map(({ id }) => String(id)))];
    const agentes = await this.repositorioAgentes.buscarVisiblesPorIds(
      contextoUsuarioActual,
      ids
    );
    const porId = new Map(agentes.map((agente) => [String(agente.id), agente]));
    const resultado = new Map();
    for (const referencia of referencias) {
      const agente = porId.get(String(referencia.id));
      if (!agente || String(agente.guid) !== String(referencia.guid)) continue;
      resultado.set(claveSujetoNotificacion(referencia), Object.freeze({
        tipo: 'agente',
        disponible: true,
        id: String(agente.id),
        guid: String(agente.guid),
        nombre: agente.nombre,
        ubicacion: [agente.tenantNombre, agente.empresaNombre, agente.sitioNombre]
          .filter(Boolean)
          .join(' · ') || null,
        enlace: `/agentes/${encodeURIComponent(String(agente.id))}`,
        enlaceOperacion: true
      }));
    }
    return resultado;
  }
}

export function crearCatalogoResolutoresSujetosAgenteNotificaciones(dependencias) {
  return new CatalogoResolutoresSujetosNotificaciones({
    resolutores: [new ResolutorSujetosAgenteNotificaciones(dependencias)]
  });
}
