import {
  claveSujetoNotificacion,
  scopeActualCubre
} from '../../coordinacion-durable/src/CatalogoResolutoresSujetosNotificaciones.js';

const TIPOS = Object.freeze(['tenant', 'empresa', 'sitio']);

export class ResolutorSujetosOrganizacionNotificaciones {
  tiposSujeto = TIPOS;

  constructor({ repositorioTenants, repositorioEmpresas, repositorioSitios } = {}) {
    for (const [nombre, repositorio] of Object.entries({
      repositorioTenants,
      repositorioEmpresas,
      repositorioSitios
    })) {
      if (typeof repositorio?.buscarPorIds !== 'function') {
        throw new Error(`${nombre} no permite resolución agrupada para el buzón.`);
      }
    }
    this.repositorios = Object.freeze({
      tenant: repositorioTenants,
      empresa: repositorioEmpresas,
      sitio: repositorioSitios
    });
  }

  async resolver(contextoUsuarioActual, referencias) {
    const resultado = new Map();
    await Promise.all(TIPOS.map(async (tipo) => {
      const candidatas = referencias.filter((item) => item.tipo === tipo);
      if (candidatas.length === 0) return;
      const ids = [...new Set(candidatas.map(({ id }) => String(id)))];
      const entidades = await this.repositorios[tipo].buscarPorIds(ids);
      const porId = new Map(entidades.map((entidad) => [String(entidad.id), entidad]));
      for (const referencia of candidatas) {
        const entidad = porId.get(String(referencia.id));
        const clave = claveSujetoNotificacion(referencia);
        if (!entidad) {
          resultado.set(clave, Object.freeze({ tipo, disponible: false, existe: false }));
          continue;
        }
        if (!scopeActualCubre(contextoUsuarioActual, scopeEntidad(tipo, entidad))) {
          resultado.set(clave, Object.freeze({ tipo, disponible: false, existe: true }));
          continue;
        }
        resultado.set(clave, presentarEntidad(tipo, entidad));
      }
    }));
    return resultado;
  }
}

function scopeEntidad(tipo, entidad) {
  if (tipo === 'tenant') {
    return { nivel: 'tenant', tenantId: entidad.id, empresaId: null, sitioId: null };
  }
  if (tipo === 'empresa') {
    return {
      nivel: 'empresa',
      tenantId: entidad.tenantId,
      empresaId: entidad.id,
      sitioId: null
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
  const base = `/organizacion/${tipo === 'tenant' ? 'tenants' : `${tipo}s`}`;
  return Object.freeze({
    tipo,
    disponible: true,
    id: String(entidad.id),
    nombre: entidad.nombre,
    ubicacion: tipo === 'tenant'
      ? null
      : [entidad.tenantNombre, entidad.empresaNombre].filter(Boolean).join(' · ') || null,
    enlace: `${base}/${encodeURIComponent(String(entidad.id))}/editar`,
    enlaceOperacion: false
  });
}
