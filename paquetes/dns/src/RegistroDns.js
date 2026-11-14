import { normalizarMarcaUtc } from '../../utilidades/src/fechas/normalizarMarcaUtc.js';

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

function clonarObjetoPlano(valor) {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) {
    return null;
  }

  return JSON.parse(JSON.stringify(valor));
}

export class RegistroDns {
  constructor(fila = {}) {
    this.id = normalizarEntero(fila.id, null);
    this.zonaId = normalizarEntero(
      fila.zona_id ?? fila.zonaId,
      null
    );
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
      null
    );
    this.hostRelativo = normalizarTexto(
      fila.host_relativo ?? fila.hostRelativo,
      ''
    );
    this.tipoRegistro = normalizarTexto(
      fila.tipo_registro ?? fila.tipoRegistro,
      ''
    ).toUpperCase();
    this.valorPrincipal = normalizarTexto(
      fila.valor_principal ?? fila.valorPrincipal,
      ''
    ) || null;
    this.ttlSegundos = normalizarEntero(
      fila.ttl_segundos ?? fila.ttlSegundos,
      null
    );
    this.prioridad = normalizarEntero(fila.prioridad, null);
    this.peso = normalizarEntero(fila.peso, null);
    this.puerto = normalizarEntero(fila.puerto, null);
    this.flags = normalizarTexto(fila.flags, '') || null;
    this.tag = normalizarTexto(fila.tag, '') || null;
    this.categoriaOrigen = normalizarTexto(
      fila.categoria_origen ?? fila.categoriaOrigen,
      'normal'
    ).toLowerCase();
    this.publicarEnBind = normalizarBooleano(
      fila.publicar_en_bind ?? fila.publicarEnBind,
      true
    );
    this.datosAuxiliares = parsearJson(
      fila.datos_auxiliares ?? fila.datosAuxiliares
    );
    this.descripcion = normalizarTexto(fila.descripcion, '') || null;
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

  construirNombreVisible() {
    if (this.hostRelativo === '@') {
      return this.nombreZona || '@';
    }

    if (!this.nombreZona) {
      return this.hostRelativo;
    }

    return `${this.hostRelativo}.${this.nombreZona}`;
  }

  get nombreVisible() {
    return this.construirNombreVisible();
  }

  construirOwnerBind() {
    return this.construirNombreVisible();
  }

  resolverTtlEfectivo(ttlDefectoZonaSegundos = null) {
    if (this.ttlSegundos != null) {
      return this.ttlSegundos;
    }

    return ttlDefectoZonaSegundos;
  }

  esPublicableEnBind() {
    return this.publicarEnBind;
  }

  estaActivoPublicableEnBind() {
    return this.activo && this.esPublicableEnBind();
  }

  esEspecial() {
    return this.categoriaOrigen !== 'normal';
  }

  resolverGobernanzaAutomatica() {
    const datos = clonarObjetoPlano(this.datosAuxiliares) || {};
    const categoriaGobernable = ['trigger', 'ddns'].includes(this.categoriaOrigen)
      ? this.categoriaOrigen
      : null;
    const gobernadoPor = String(
      datos.gobernadoPor || categoriaGobernable || ''
    ).trim().toLowerCase();

    if (!['trigger', 'ddns'].includes(gobernadoPor)) {
      return null;
    }

    const rolAsignado = normalizarTexto(datos.rolAsignado, '') || null;
    const modoControl = String(datos.modoControl || 'valor_y_activo')
      .trim()
      .toLowerCase();
    const ttlSugerido = normalizarEntero(datos.ttlSugerido, null);
    const propietario = normalizarTexto(datos.propietario, '') || null;
    const criterioActualizacion =
      normalizarTexto(datos.criterioActualizacion, '') || null;
    const politicaSobrescritura =
      normalizarTexto(datos.politicaSobrescritura, '') || null;
    const validacionOrigen = normalizarTexto(datos.validacionOrigen, '') || null;

    return {
      gobernadoPor,
      modoControl,
      rolAsignado,
      ttlSugerido,
      propietario,
      criterioActualizacion,
      politicaSobrescritura,
      validacionOrigen
    };
  }

  estaGobernadoAutomaticamente() {
    return this.resolverGobernanzaAutomatica() != null;
  }

  bloqueaEdicionHumanaValorPrincipal() {
    return this.estaGobernadoAutomaticamente();
  }

  serializarResumen() {
    const gobernanzaAutomatica = this.resolverGobernanzaAutomatica();

    return {
      id: this.id,
      zonaId: this.zonaId,
      nombreZona: this.nombreZona,
      tenantId: this.tenantId,
      empresaId: this.empresaId,
      sitioId: this.sitioId,
      tenantNombre: this.tenantNombre,
      empresaNombre: this.empresaNombre,
      sitioNombre: this.sitioNombre,
      hostRelativo: this.hostRelativo,
      nombreVisible: this.nombreVisible,
      ownerBind: this.construirOwnerBind(),
      tipoRegistro: this.tipoRegistro,
      valorPrincipal: this.valorPrincipal,
      ttlSegundos: this.ttlSegundos,
      prioridad: this.prioridad,
      peso: this.peso,
      puerto: this.puerto,
      flags: this.flags,
      tag: this.tag,
      categoriaOrigen: this.categoriaOrigen,
      publicarEnBind: this.publicarEnBind,
      datosAuxiliares: this.datosAuxiliares,
      gobernanzaAutomatica,
      estaGobernadoAutomaticamente: gobernanzaAutomatica != null,
      bloqueaEdicionHumanaValorPrincipal:
        gobernanzaAutomatica != null,
      descripcion: this.descripcion,
      activo: this.activo,
      nivelPertenencia: this.resolverNivelPertenencia(),
      fechaCreacion: normalizarMarcaUtc(this.fechaCreacion),
      fechaActualizacion: normalizarMarcaUtc(this.fechaActualizacion)
    };
  }

  serializarPersistencia() {
    return {
      id: this.id,
      zonaId: this.zonaId,
      tenantId: this.tenantId,
      empresaId: this.empresaId,
      sitioId: this.sitioId,
      hostRelativo: this.hostRelativo,
      tipoRegistro: this.tipoRegistro,
      valorPrincipal: this.valorPrincipal,
      ttlSegundos: this.ttlSegundos,
      prioridad: this.prioridad,
      peso: this.peso,
      puerto: this.puerto,
      flags: this.flags,
      tag: this.tag,
      categoriaOrigen: this.categoriaOrigen,
      publicarEnBind: this.publicarEnBind,
      datosAuxiliares: this.datosAuxiliares,
      descripcion: this.descripcion,
      activo: this.activo
    };
  }
}
