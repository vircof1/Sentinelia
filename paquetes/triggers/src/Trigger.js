import { normalizarMarcaUtc } from '../../utilidades/src/fechas/normalizarMarcaUtc.js';
import { ConfiguracionTriggerApi } from './ConfiguracionTriggerApi.js';
import { ConfiguracionTriggerDns } from './ConfiguracionTriggerDns.js';
import { ConfiguracionTriggerCorreo } from './ConfiguracionTriggerCorreo.js';

function parsearJson(valor) {
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

function normalizarEntero(valor, porDefecto = null) {
  const convertido = Number.parseInt(String(valor ?? ''), 10);
  return Number.isInteger(convertido) ? convertido : porDefecto;
}

function normalizarTexto(valor, porDefecto = '') {
  if (valor == null) {
    return porDefecto;
  }

  return String(valor).trim();
}

function resolverNivelScope({ tenantId = null, empresaId = null, sitioId = null }) {
  if (tenantId == null && empresaId == null && sitioId == null) {
    return 'portal';
  }

  if (tenantId != null && empresaId == null && sitioId == null) {
    return 'tenant';
  }

  if (tenantId != null && empresaId != null && sitioId == null) {
    return 'empresa';
  }

  if (tenantId != null && empresaId != null && sitioId != null) {
    return 'sitio';
  }

  return 'invalido';
}

export class Trigger {
  constructor(fila) {
    this.id = normalizarEntero(fila.id, null);
    this.tenantId = normalizarEntero(
      fila.tenant_id ?? fila.tenantId,
      null
    );
    this.empresaId = normalizarEntero(
      fila.empresa_id ?? fila.empresaId,
      null
    );
    this.sitioId = normalizarEntero(
      fila.sitio_id ?? fila.sitioId,
      null
    );
    this.nombre = normalizarTexto(fila.nombre, '');
    this.tipo = normalizarTexto(fila.tipo, '').toLowerCase();
    this.descripcion = normalizarTexto(fila.descripcion, '') || null;
    this.activo = Boolean(fila.activo);
    this.revisionDeclaracion = normalizarEntero(
      fila.revision_declaracion ?? fila.revisionDeclaracion,
      1
    );
    this.totalVinculos = normalizarEntero(
      fila.total_vinculos ?? fila.totalVinculos,
      0
    );
    this.configuracion = this.normalizarConfiguracion(
      this.tipo,
      parsearJson(fila.configuracion)
    );
    this.tenantNombre = normalizarTexto(
      fila.tenant_nombre ?? fila.tenantNombre,
      null
    );
    this.empresaNombre = normalizarTexto(
      fila.empresa_nombre ?? fila.empresaNombre,
      null
    );
    this.sitioNombre = normalizarTexto(
      fila.sitio_nombre ?? fila.sitioNombre,
      null
    );
    this.fechaCreacion = fila.fecha_creacion || fila.fechaCreacion || null;
    this.fechaActualizacion =
      fila.fecha_actualizacion || fila.fechaActualizacion || null;
  }

  normalizarConfiguracion(tipo, configuracion) {
    if (tipo === 'api') {
      return new ConfiguracionTriggerApi(configuracion || {});
    }

    if (tipo === 'dns') {
      return new ConfiguracionTriggerDns(configuracion || {});
    }

    if (tipo === 'correo') {
      return new ConfiguracionTriggerCorreo(configuracion || {});
    }

    return configuracion || {};
  }

  resolverNivelPertenencia() {
    return resolverNivelScope({
      tenantId: this.tenantId,
      empresaId: this.empresaId,
      sitioId: this.sitioId
    });
  }

  construirAlcanceDescripcion() {
    const nivel = this.resolverNivelPertenencia();

    if (nivel === 'portal') {
      return 'Portal completo';
    }

    if (nivel === 'tenant') {
      return `${this.tenantNombre || 'Tenant'} #${this.tenantId}`;
    }

    if (nivel === 'sitio') {
      return `${this.sitioNombre || 'Sitio'} #${this.sitioId} · ${this.empresaNombre || 'Empresa'} #${this.empresaId}`;
    }

    if (nivel === 'empresa') {
      return `${this.empresaNombre || 'Empresa'} #${this.empresaId}`;
    }

    return 'Scope inválido';
  }

  serializarResumen() {
    return {
      id: this.id,
      tenantId: this.tenantId,
      empresaId: this.empresaId,
      sitioId: this.sitioId,
      tenantNombre: this.tenantNombre,
      empresaNombre: this.empresaNombre,
      sitioNombre: this.sitioNombre,
      nombre: this.nombre,
      tipo: this.tipo,
      descripcion: this.descripcion,
      activo: this.activo,
      revisionDeclaracion: this.revisionDeclaracion,
      totalVinculos: this.totalVinculos,
      nivelPertenencia: this.resolverNivelPertenencia(),
      alcanceDescripcion: this.construirAlcanceDescripcion(),
      scope: {
        tenantId: this.tenantId,
        empresaId: this.empresaId,
        sitioId: this.sitioId,
        nivelPertenencia: this.resolverNivelPertenencia()
      },
      configuracion:
        typeof this.configuracion?.serializar === 'function'
          ? this.configuracion.serializar()
          : this.configuracion,
      fechaCreacion: normalizarMarcaUtc(this.fechaCreacion),
      fechaActualizacion: normalizarMarcaUtc(this.fechaActualizacion)
    };
  }

  serializarPersistencia() {
    const resumen = this.serializarResumen();

    return {
      id: resumen.id,
      tenantId: resumen.tenantId,
      empresaId: resumen.empresaId,
      sitioId: resumen.sitioId,
      nombre: resumen.nombre,
      tipo: resumen.tipo,
      descripcion: resumen.descripcion,
      activo: resumen.activo,
      revisionDeclaracion: resumen.revisionDeclaracion,
      configuracion: resumen.configuracion
    };
  }
}
