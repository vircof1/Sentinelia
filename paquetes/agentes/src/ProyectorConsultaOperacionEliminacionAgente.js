import { scopeActualCubre }
  from '../../coordinacion-durable/src/CatalogoResolutoresSujetosNotificaciones.js';
import {
  TIPOS_OPERACION_ADMINISTRATIVA,
  VERSION_CONTRATO_ELIMINACION_ADMINISTRATIVA_AGENTE
} from './ContratoEliminacionAdministrativaAgente.js';

export class ProyectorConsultaOperacionEliminacionAgente {
  tipo = TIPOS_OPERACION_ADMINISTRATIVA.ELIMINAR_AGENTE;
  version = VERSION_CONTRATO_ELIMINACION_ADMINISTRATIVA_AGENTE;

  constructor({ repositorioAgentes, servicioAutorizacion } = {}) {
    if (typeof repositorioAgentes?.buscarPorId !== 'function' ||
        typeof servicioAutorizacion?.puedeEliminarAgentes !== 'function') {
      throw new Error('La consulta de agente exige raíz viva y autorización.');
    }
    this.repositorioAgentes = repositorioAgentes;
    this.servicioAutorizacion = servicioAutorizacion;
  }

  async proyectarSujeto(contexto, operacion) {
    if (!this.servicioAutorizacion.puedeEliminarAgentes(contexto)) return null;
    const referencia = operacion.sujeto;
    const agente = await this.repositorioAgentes.buscarPorId(referencia.id);
    if (agente && String(agente.guid) === String(referencia.guid)) {
      const scopeVivo = {
        nivel: 'sitio',
        tenantId: agente.tenantId,
        empresaId: agente.empresaId,
        sitioId: agente.sitioId
      };
      if (!scopeActualCubre(contexto, scopeVivo)) return null;
      return Object.freeze({
        tipo: 'agente',
        disponible: true,
        id: String(agente.id),
        guid: String(agente.guid),
        nombre: textoPlano(agente.nombre, 191),
        ubicacion: textoPlano(
          [agente.tenantNombre, agente.empresaNombre, agente.sitioNombre]
            .filter(Boolean).join(' · '),
          300
        ) || null,
        enlace: `/agentes/${encodeURIComponent(String(agente.id))}`
      });
    }

    const sujetoFinal = operacion.estado === 'completada'
      ? operacion.resultado?.sujeto
      : null;
    if (!mismaIdentidadAgente(referencia, sujetoFinal) ||
        !scopeActualCubre(contexto, sujetoFinal.scope)) {
      return null;
    }
    return Object.freeze({
      tipo: 'agente',
      disponible: false,
      evidenciaFinal: true,
      id: String(sujetoFinal.id),
      guid: String(sujetoFinal.guid),
      nombre: null,
      ubicacion: null,
      enlace: null
    });
  }
}

function mismaIdentidadAgente(a, b) {
  return a?.tipo === 'agente' && b?.tipo === 'agente' &&
    String(a.id) === String(b.id) && String(a.guid) === String(b.guid);
}

function textoPlano(valor, maximo) {
  return String(valor || '')
    .replace(/[\u0000-\u001f\u007f]+/gu, ' ')
    .replaceAll('&', '＆')
    .replaceAll('<', '‹')
    .replaceAll('>', '›')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, maximo);
}
