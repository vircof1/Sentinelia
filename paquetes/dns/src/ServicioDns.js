import { PublicadorBindDns } from './PublicadorBindDns.js';

export class ServicioDns {
  constructor({
    repositorioZonasDns,
    repositorioRegistrosDns,
    servicioConfiguracionPortal,
    versionadorDnsRedis = null,
    publicadorBindDns = null,
    publicacionCoordinadaActiva = false
  }) {
    this.repositorioZonasDns = repositorioZonasDns;
    this.repositorioRegistrosDns = repositorioRegistrosDns;
    this.servicioConfiguracionPortal = servicioConfiguracionPortal;
    this.versionadorDnsRedis = versionadorDnsRedis;
    this.publicacionCoordinadaActiva = Boolean(publicacionCoordinadaActiva);
    this.publicadorBindDns =
      publicadorBindDns ||
      new PublicadorBindDns({
        repositorioZonasDns,
        versionadorDnsRedis
      });
  }

  async asegurarVersionInicial() {
    if (!this.versionadorDnsRedis) {
      return null;
    }

    return this.versionadorDnsRedis.asegurarVersionInicial();
  }

  async obtenerVersionActual() {
    if (!this.versionadorDnsRedis) {
      return null;
    }

    return this.versionadorDnsRedis.obtenerVersionActual();
  }

  async obtenerVersionConfiguracionActual() {
    await this.servicioConfiguracionPortal.asegurarActualizada();

    const versionConfiguracion =
      this.servicioConfiguracionPortal.obtenerVersionActual();

    return Number(versionConfiguracion || 0) || null;
  }

  async invalidarCatalogoDns() {
    if (!this.versionadorDnsRedis) {
      return null;
    }

    await this.versionadorDnsRedis.asegurarVersionInicial();
    return this.versionadorDnsRedis.incrementarVersion();
  }

  async exportarDefinicionesRuntime() {
    const zonas = await this.repositorioZonasDns.listar();
    const idsZona = zonas
      .map((zona) => Number(zona.id))
      .filter((id) => Number.isInteger(id) && id > 0);
    const registros = await this.repositorioRegistrosDns.listarPorZonaIds(idsZona);
    const registrosPorZonaId = new Map();

    for (const registro of registros) {
      const lista = registrosPorZonaId.get(registro.zonaId) || [];
      lista.push(registro);
      registrosPorZonaId.set(registro.zonaId, lista);
    }

    const zonasSerializadas = zonas.map((zona) => ({
      zona: this.serializarZonaRuntime(zona),
      registros: (registrosPorZonaId.get(zona.id) || []).map((registro) =>
        this.serializarRegistroRuntime(registro)
      )
    }));

    return {
      generadoEn: new Date().toISOString(),
      resumen: {
        totalZonas: zonas.length,
        totalZonasActivas: zonas.filter((zona) => zona.activo).length,
        totalZonasPublicables: zonas.filter((zona) =>
          zona.estaActivaPublicableEnBind()
        ).length,
        totalZonasEspeciales: zonas.filter((zona) => zona.esZonaEspecial()).length,
        totalRegistros: registros.length,
        totalRegistrosPublicables: registros.filter((registro) =>
          registro.estaActivoPublicableEnBind()
        ).length,
        totalRegistrosEspeciales: registros.filter((registro) =>
          registro.esEspecial()
        ).length
      },
      zonas: zonasSerializadas
    };
  }

  async publicarConfiguracionVigente() {
    if (this.publicacionCoordinadaActiva) {
      throw new Error('El publicador BIND legado no tiene autoridad durante la publicación coordinada.');
    }
    await this.servicioConfiguracionPortal.asegurarActualizada();
    const configuracionDns =
      this.servicioConfiguracionPortal
        .obtenerConfiguracionActual()
        .obtenerConfiguracionDns();
    const exportacion = await this.exportarDefinicionesRuntime();
    const versionCatalogoDns = await this.asegurarVersionInicial();

    if (!configuracionDns.activo) {
      return {
        ok: true,
        omitido: true,
        motivo: 'dns_desactivado',
        versionDns: versionCatalogoDns,
        versionConfiguracion: await this.obtenerVersionConfiguracionActual(),
        configuracionDns: this.serializarResumenConfiguracionDns(configuracionDns),
        exportacion: {
          generadoEn: exportacion.generadoEn,
          resumen: exportacion.resumen
        }
      };
    }

    const resultado = await this.publicadorBindDns.publicar({
      configuracionDns,
      catalogoZonas: exportacion.zonas
    });

    return {
      ...resultado,
      omitido: false,
      versionConfiguracion: await this.obtenerVersionConfiguracionActual(),
      configuracionDns: this.serializarResumenConfiguracionDns(configuracionDns),
      exportacion: {
        generadoEn: exportacion.generadoEn,
        resumen: exportacion.resumen
      }
    };
  }

  serializarResumenConfiguracionDns(configuracionDns = {}) {
    return {
      activo: Boolean(configuracionDns.activo),
      recursion: Boolean(configuracionDns.recursion),
      forwardersHabilitados: Boolean(configuracionDns.forwardersHabilitados),
      totalForwarders: Array.isArray(configuracionDns.forwarders)
        ? configuracionDns.forwarders.length
        : 0,
      totalListenOn: Array.isArray(configuracionDns.listenOn)
        ? configuracionDns.listenOn.length
        : 0,
      totalListenOnV6: Array.isArray(configuracionDns.listenOnV6)
        ? configuracionDns.listenOnV6.length
        : 0
    };
  }

  serializarZonaRuntime(zona) {
    const persistencia = zona.serializarPersistencia();
    const resumen = zona.serializarResumen();

    return {
      id: zona.id,
      tenant_id: persistencia.tenantId,
      empresa_id: persistencia.empresaId,
      sitio_id: persistencia.sitioId,
      tenant_nombre: resumen.tenantNombre,
      empresa_nombre: resumen.empresaNombre,
      sitio_nombre: resumen.sitioNombre,
      nombre_zona: persistencia.nombreZona,
      tipo_zona: persistencia.tipoZona,
      categoria_origen: persistencia.categoriaOrigen,
      publicar_en_bind: persistencia.publicarEnBind,
      descripcion: persistencia.descripcion,
      ttl_defecto_segundos: persistencia.ttlDefectoSegundos,
      soa_mname: persistencia.soaMname,
      soa_rname: persistencia.soaRname,
      soa_serial: persistencia.soaSerial,
      soa_refresh_segundos: persistencia.soaRefreshSegundos,
      soa_retry_segundos: persistencia.soaRetrySegundos,
      soa_expire_segundos: persistencia.soaExpireSegundos,
      soa_minimum_segundos: persistencia.soaMinimumSegundos,
      version_modelo: persistencia.versionModelo,
      estado_publicacion: persistencia.estadoPublicacion,
      activo: persistencia.activo,
      fecha_creacion: resumen.fechaCreacion,
      fecha_actualizacion: resumen.fechaActualizacion
    };
  }

  serializarRegistroRuntime(registro) {
    const persistencia = registro.serializarPersistencia();
    const resumen = registro.serializarResumen();

    return {
      id: registro.id,
      zona_id: persistencia.zonaId,
      tenant_id: persistencia.tenantId,
      empresa_id: persistencia.empresaId,
      sitio_id: persistencia.sitioId,
      tenant_nombre: resumen.tenantNombre,
      empresa_nombre: resumen.empresaNombre,
      sitio_nombre: resumen.sitioNombre,
      nombre_zona: resumen.nombreZona,
      host_relativo: persistencia.hostRelativo,
      tipo_registro: persistencia.tipoRegistro,
      valor_principal: persistencia.valorPrincipal,
      ttl_segundos: persistencia.ttlSegundos,
      prioridad: persistencia.prioridad,
      peso: persistencia.peso,
      puerto: persistencia.puerto,
      flags: persistencia.flags,
      tag: persistencia.tag,
      categoria_origen: persistencia.categoriaOrigen,
      publicar_en_bind: persistencia.publicarEnBind,
      datos_auxiliares: persistencia.datosAuxiliares,
      descripcion: persistencia.descripcion,
      activo: persistencia.activo,
      fecha_creacion: resumen.fechaCreacion,
      fecha_actualizacion: resumen.fechaActualizacion
    };
  }
}
