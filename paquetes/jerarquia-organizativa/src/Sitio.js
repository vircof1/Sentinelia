import { normalizarMarcaUtc } from '../../utilidades/src/fechas/normalizarMarcaUtc.js';

function parsearConfiguracion(valor) {
  if (!valor) {
    return null;
  }

  if (typeof valor === 'object') {
    return valor;
  }

  try {
    return JSON.parse(valor);
  } catch (_error) {
    return null;
  }
}

export class Sitio {
  constructor(fila) {
    this.id = fila.id;
    this.tenantId = fila.tenant_id;
    this.empresaId = fila.empresa_id;
    this.nombre = fila.nombre;
    this.alias = fila.alias;
    this.timezone = fila.timezone;
    this.descripcion = fila.descripcion;
    this.estado = fila.estado;
    this.configuracion = parsearConfiguracion(fila.configuracion);
    this.tenantNombre = fila.tenant_nombre || null;
    this.empresaNombre = fila.empresa_nombre || null;
    this.totalMonitores = Number(fila.total_monitores || 0);
    this.totalUsuarios = Number(fila.total_usuarios || 0);
    this.totalAutomatizaciones = Number(fila.total_automatizaciones || 0);
    this.totalZonasDns = Number(fila.total_zonas_dns || 0);
    this.totalAgentes = Number(fila.total_agentes || 0);
    this.fechaCreacion = fila.fecha_creacion;
    this.fechaActualizacion = fila.fecha_actualizacion;
  }

  serializarResumen() {
    return {
      id: this.id,
      tenantId: this.tenantId,
      empresaId: this.empresaId,
      tenantNombre: this.tenantNombre,
      empresaNombre: this.empresaNombre,
      totalMonitores: this.totalMonitores,
      totalUsuarios: this.totalUsuarios,
      totalAutomatizaciones: this.totalAutomatizaciones,
      totalZonasDns: this.totalZonasDns,
      totalAgentes: this.totalAgentes,
      nombre: this.nombre,
      alias: this.alias,
      timezone: this.timezone,
      descripcion: this.descripcion,
      estado: this.estado,
      fechaCreacion: normalizarMarcaUtc(this.fechaCreacion),
      fechaActualizacion: normalizarMarcaUtc(this.fechaActualizacion)
    };
  }
}
