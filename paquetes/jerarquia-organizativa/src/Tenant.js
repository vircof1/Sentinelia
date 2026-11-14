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

export class Tenant {
  constructor(fila) {
    this.id = fila.id;
    this.nombre = fila.nombre;
    this.alias = fila.alias;
    this.descripcion = fila.descripcion;
    this.estado = fila.estado;
    this.configuracion = parsearConfiguracion(fila.configuracion);
    this.totalEmpresas = Number(fila.total_empresas || 0);
    this.totalSitios = Number(fila.total_sitios || 0);
    this.totalUsuarios = Number(fila.total_usuarios || 0);
    this.totalMonitores = Number(fila.total_monitores || 0);
    this.totalAgentes = Number(fila.total_agentes || 0);
    this.totalAutomatizaciones = Number(fila.total_automatizaciones || 0);
    this.fechaCreacion = fila.fecha_creacion;
    this.fechaActualizacion = fila.fecha_actualizacion;
  }

  serializarResumen() {
    return {
      id: this.id,
      nombre: this.nombre,
      alias: this.alias,
      descripcion: this.descripcion,
      estado: this.estado,
      totalEmpresas: this.totalEmpresas,
      totalSitios: this.totalSitios,
      totalUsuarios: this.totalUsuarios,
      totalMonitores: this.totalMonitores,
      totalAgentes: this.totalAgentes,
      totalAutomatizaciones: this.totalAutomatizaciones,
      fechaCreacion: normalizarMarcaUtc(this.fechaCreacion),
      fechaActualizacion: normalizarMarcaUtc(this.fechaActualizacion)
    };
  }
}
