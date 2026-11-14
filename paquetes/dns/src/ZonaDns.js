import { normalizarMarcaUtc } from '../../utilidades/src/fechas/normalizarMarcaUtc.js';
import { describirPublicacionZonaDns, etiquetarPublicacionZonaDns } from './EstadoPublicacionZonaDns.js';

function normalizarEntero(valor, porDefecto = null) {
  const convertido = Number.parseInt(String(valor ?? ''), 10);
  return Number.isInteger(convertido) ? convertido : porDefecto;
}

function normalizarBooleano(valor, porDefecto = false) {
  if (valor === undefined || valor === null) {
    return porDefecto;
  }

  return Boolean(valor);
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

export class ZonaDns {
  constructor(fila = {}) {
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
    this.nombreZona = normalizarTexto(
      fila.nombre_zona ?? fila.nombreZona,
      ''
    );
    this.tipoZona = normalizarTexto(
      fila.tipo_zona ?? fila.tipoZona,
      'master'
    ).toLowerCase();
    this.categoriaOrigen = normalizarTexto(
      fila.categoria_origen ?? fila.categoriaOrigen,
      'normal'
    ).toLowerCase();
    this.publicarEnBind = normalizarBooleano(
      fila.publicar_en_bind ?? fila.publicarEnBind,
      true
    );
    this.descripcion = normalizarTexto(fila.descripcion, '') || null;
    this.ttlDefectoSegundos = normalizarEntero(
      fila.ttl_defecto_segundos ?? fila.ttlDefectoSegundos,
      3600
    );
    this.soaMname = normalizarTexto(
      fila.soa_mname ?? fila.soaMname,
      ''
    );
    this.soaRname = normalizarTexto(
      fila.soa_rname ?? fila.soaRname,
      ''
    );
    this.soaSerial = normalizarEntero(
      fila.soa_serial ?? fila.soaSerial,
      1
    );
    this.soaRefreshSegundos = normalizarEntero(
      fila.soa_refresh_segundos ?? fila.soaRefreshSegundos,
      3600
    );
    this.soaRetrySegundos = normalizarEntero(
      fila.soa_retry_segundos ?? fila.soaRetrySegundos,
      600
    );
    this.soaExpireSegundos = normalizarEntero(
      fila.soa_expire_segundos ?? fila.soaExpireSegundos,
      1209600
    );
    this.soaMinimumSegundos = normalizarEntero(
      fila.soa_minimum_segundos ?? fila.soaMinimumSegundos,
      300
    );
    this.versionModelo = normalizarEntero(
      fila.version_modelo ?? fila.versionModelo,
      1
    );
    this.estadoPublicacion = normalizarTexto(
      fila.estado_publicacion ?? fila.estadoPublicacion,
      'pendiente'
    ).toLowerCase();
    this.generacionAplicadaBind = fila.generacion_aplicada_bind == null
      ? (fila.generacionAplicadaBind ?? null) : String(fila.generacion_aplicada_bind);
    this.versionAplicadaBind = fila.version_aplicada_bind == null
      ? (fila.versionAplicadaBind ?? null) : String(fila.version_aplicada_bind);
    this.hashPublicacionVigente = normalizarTexto(
      fila.hash_publicacion_vigente ?? fila.hashPublicacionVigente,
      ''
    ) || null;
    this.fechaUltimaPublicacionExitosa =
      fila.fecha_ultima_publicacion_exitosa ??
      fila.fechaUltimaPublicacionExitosa ??
      null;
    this.fechaUltimoErrorPublicacion =
      fila.fecha_ultimo_error_publicacion ??
      fila.fechaUltimoErrorPublicacion ??
      null;
    this.detalleUltimoErrorPublicacion = normalizarTexto(
      fila.detalle_ultimo_error_publicacion ?? fila.detalleUltimoErrorPublicacion,
      ''
    ) || null;
    this.activo = normalizarBooleano(fila.activo, true);
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
    this.fechaCreacion = fila.fecha_creacion ?? fila.fechaCreacion ?? null;
    this.fechaActualizacion =
      fila.fecha_actualizacion ?? fila.fechaActualizacion ?? null;
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

    if (nivel === 'empresa') {
      return `${this.empresaNombre || 'Empresa'} #${this.empresaId}`;
    }

    if (nivel === 'sitio') {
      return `${this.sitioNombre || 'Sitio'} #${this.sitioId} · ${this.empresaNombre || 'Empresa'} #${this.empresaId}`;
    }

    return 'Scope inválido';
  }

  esZonaEspecial() {
    return this.categoriaOrigen !== 'normal';
  }

  esPublicableEnBind() {
    return this.publicarEnBind;
  }

  estaActivaPublicableEnBind() {
    return this.activo && this.esPublicableEnBind();
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
      nombreZona: this.nombreZona,
      tipoZona: this.tipoZona,
      categoriaOrigen: this.categoriaOrigen,
      publicarEnBind: this.publicarEnBind,
      descripcion: this.descripcion,
      ttlDefectoSegundos: this.ttlDefectoSegundos,
      soa: {
        mname: this.soaMname,
        rname: this.soaRname,
        serial: this.soaSerial,
        refreshSegundos: this.soaRefreshSegundos,
        retrySegundos: this.soaRetrySegundos,
        expireSegundos: this.soaExpireSegundos,
        minimumSegundos: this.soaMinimumSegundos
      },
      versionModelo: this.versionModelo,
      estadoPublicacion: this.estadoPublicacion,
      generacionAplicadaBind: this.generacionAplicadaBind,
      versionAplicadaBind: this.versionAplicadaBind,
      descripcionPublicacion: describirPublicacionZonaDns(this),
      etiquetaPublicacion: etiquetarPublicacionZonaDns(this.estadoPublicacion),
      hashPublicacionVigente: this.hashPublicacionVigente,
      fechaUltimaPublicacionExitosa:
        normalizarMarcaUtc(this.fechaUltimaPublicacionExitosa),
      fechaUltimoErrorPublicacion:
        normalizarMarcaUtc(this.fechaUltimoErrorPublicacion),
      detalleUltimoErrorPublicacion: this.detalleUltimoErrorPublicacion,
      activo: this.activo,
      nivelPertenencia: this.resolverNivelPertenencia(),
      alcanceDescripcion: this.construirAlcanceDescripcion(),
      fechaCreacion: normalizarMarcaUtc(this.fechaCreacion),
      fechaActualizacion: normalizarMarcaUtc(this.fechaActualizacion)
    };
  }

  serializarPersistencia() {
    return {
      id: this.id,
      tenantId: this.tenantId,
      empresaId: this.empresaId,
      sitioId: this.sitioId,
      nombreZona: this.nombreZona,
      tipoZona: this.tipoZona,
      categoriaOrigen: this.categoriaOrigen,
      publicarEnBind: this.publicarEnBind,
      descripcion: this.descripcion,
      ttlDefectoSegundos: this.ttlDefectoSegundos,
      soaMname: this.soaMname,
      soaRname: this.soaRname,
      soaSerial: this.soaSerial,
      soaRefreshSegundos: this.soaRefreshSegundos,
      soaRetrySegundos: this.soaRetrySegundos,
      soaExpireSegundos: this.soaExpireSegundos,
      soaMinimumSegundos: this.soaMinimumSegundos,
      versionModelo: this.versionModelo,
      estadoPublicacion: this.estadoPublicacion,
      activo: this.activo
    };
  }
}
