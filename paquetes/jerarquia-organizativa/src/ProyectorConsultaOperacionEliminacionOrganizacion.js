import { scopeActualCubre }
  from '../../coordinacion-durable/src/CatalogoResolutoresSujetosNotificaciones.js';
import {
  TIPOS_OPERACION_ADMINISTRATIVA_ORGANIZACION,
  VERSION_CONTRATO_ELIMINACION_ADMINISTRATIVA_ORGANIZACION
} from './ContratoEliminacionAdministrativaOrganizacion.js';

export class ProyectorConsultaOperacionEliminacionOrganizacion {
  tipo = TIPOS_OPERACION_ADMINISTRATIVA_ORGANIZACION.ELIMINAR_ORGANIZACION;
  version = VERSION_CONTRATO_ELIMINACION_ADMINISTRATIVA_ORGANIZACION;

  constructor({
    repositorioTenants,
    repositorioEmpresas,
    repositorioSitios,
    servicioAutorizacion
  } = {}) {
    for (const repositorio of [repositorioTenants, repositorioEmpresas, repositorioSitios]) {
      if (typeof repositorio?.buscarPorId !== 'function') {
        throw new Error('La consulta organizativa exige repositorios de raíz viva.');
      }
    }
    if (typeof servicioAutorizacion?.puedeEliminarAgentes !== 'function') {
      throw new Error('La consulta organizativa exige autorización actual.');
    }
    this.repositorios = Object.freeze({
      tenant: repositorioTenants,
      empresa: repositorioEmpresas,
      sitio: repositorioSitios
    });
    this.servicioAutorizacion = servicioAutorizacion;
  }

  async proyectarSujeto(contexto, operacion) {
    const referencia = operacion.sujeto;
    if (!this.#puedeConsultar(contexto, referencia?.tipo)) return null;
    const repositorio = this.repositorios[referencia?.tipo];
    if (!repositorio) return null;
    const entidad = await repositorio.buscarPorId(referencia.id);
    if (entidad) {
      if (!scopeActualCubre(contexto, scopeEntidad(referencia.tipo, entidad))) return null;
      return presentarEntidad(referencia.tipo, entidad);
    }

    const fotografia = operacion.estado === 'completada'
      ? operacion.resultado?.fotografiaFinal
      : null;
    if (!mismaIdentidad(referencia, fotografia) ||
        !scopeActualCubre(contexto, fotografia.scopeFinal)) {
      return null;
    }
    return Object.freeze({
      tipo: fotografia.tipo,
      disponible: false,
      fotografiaFinal: true,
      id: String(fotografia.id),
      nombre: textoPlano(fotografia.nombre, 191),
      ubicacion: null,
      enlace: null,
      capturadaEnUtc: fotografia.capturadaEnUtc
    });
  }

  #puedeConsultar(contexto, tipo) {
    if (!this.servicioAutorizacion.puedeEliminarAgentes(contexto)) return false;
    const metodo = ({
      tenant: 'puedeAdministrarTenants',
      empresa: 'puedeAdministrarEmpresas',
      sitio: 'puedeAdministrarSitios'
    })[tipo];
    return Boolean(metodo && this.servicioAutorizacion[metodo]?.(contexto));
  }
}

function scopeEntidad(tipo, entidad) {
  if (tipo === 'tenant') {
    return { nivel: 'tenant', tenantId: entidad.id, empresaId: null, sitioId: null };
  }
  if (tipo === 'empresa') {
    return {
      nivel: 'empresa', tenantId: entidad.tenantId, empresaId: entidad.id, sitioId: null
    };
  }
  return {
    nivel: 'sitio',
    tenantId: entidad.tenantId,
    empresaId: entidad.empresaId,
    sitioId: entidad.id
  };
}

function presentarEntidad(tipo, entidad) {
  const plural = tipo === 'tenant' ? 'tenants' : `${tipo}s`;
  return Object.freeze({
    tipo,
    disponible: true,
    id: String(entidad.id),
    nombre: textoPlano(entidad.nombre, 191),
    ubicacion: textoPlano(
      [entidad.tenantNombre, entidad.empresaNombre].filter(Boolean).join(' · '),
      300
    ) || null,
    enlace: `/organizacion/${plural}/${encodeURIComponent(String(entidad.id))}/editar`
  });
}

function mismaIdentidad(a, b) {
  return a && b && a.tipo === b.tipo && String(a.id) === String(b.id);
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
