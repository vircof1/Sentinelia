export class CoordinadorDnsRuntime {
  constructor({
    servicioDns,
    cargadorCatalogoDnsRuntime,
    publicadorCoordinado = null,
    repositorioCoordinacion = null
  }) {
    this.servicioDns = servicioDns;
    this.cargadorCatalogoDnsRuntime = cargadorCatalogoDnsRuntime;
    this.publicadorCoordinado = publicadorCoordinado;
    this.repositorioCoordinacion = repositorioCoordinacion;
    this.versionCatalogoDnsActual = null;
    this.versionCatalogoDnsError = null;
    this.versionConfiguracionActual = null;
    this.versionConfiguracionError = null;
    this.totalSincronizaciones = 0;
    this.totalPublicacionesOk = 0;
    this.totalErrores = 0;
    this.ultimaSincronizacionEn = null;
    this.ultimoResultado = null;
    this.catalogoDnsRuntime = null;
  }

  async arrancar() {
    if (this.publicadorCoordinado) {
      await this.repositorioCoordinacion.asegurarReconciliacionInicial();
      await this.repositorioCoordinacion.asegurarLecturaPublicacionZonas?.();
    }
    return this.sincronizarSiHaCambiado({
      motivo: 'arranque_dns',
      forzar: true
    });
  }

  // auditoria-productor: runtime.dns.publicacion_bind
  async sincronizarSiHaCambiado({
    motivo = 'tick_programacion',
    forzar = false
  } = {}) {
    if (this.publicadorCoordinado) {
      return this.#procesarPublicacionCoordinada({ motivo, forzar });
    }
    let versionRedis = this.normalizarVersion(
      await this.servicioDns.obtenerVersionActual()
    );

    if (!versionRedis) {
      versionRedis = this.normalizarVersion(
        await this.servicioDns.asegurarVersionInicial()
      );
    }

    const versionConfiguracion = this.normalizarVersion(
      await this.servicioDns.obtenerVersionConfiguracionActual()
    );

    if (
      !forzar &&
      versionRedis === this.versionCatalogoDnsActual &&
      versionConfiguracion === this.versionConfiguracionActual
    ) {
      return null;
    }

    if (
      !forzar &&
      this.ultimoResultado?.ok === false &&
      versionRedis === this.versionCatalogoDnsError &&
      versionConfiguracion === this.versionConfiguracionError
    ) {
      return null;
    }

    this.catalogoDnsRuntime = await this.cargadorCatalogoDnsRuntime.cargarInicial();
    const resultado = await this.servicioDns.publicarConfiguracionVigente();
    const versionResultado = this.normalizarVersion(
      resultado?.versionDns ?? versionRedis
    );
    const versionConfiguracionResultado = this.normalizarVersion(
      resultado?.versionConfiguracion ?? versionConfiguracion
    );

    if (resultado?.ok) {
      this.versionCatalogoDnsActual = versionResultado;
      this.versionCatalogoDnsError = null;
      this.versionConfiguracionActual = versionConfiguracionResultado;
      this.versionConfiguracionError = null;
      this.totalPublicacionesOk += 1;
    } else {
      this.versionCatalogoDnsError = versionRedis;
      this.versionConfiguracionError = versionConfiguracion;
      this.totalErrores += 1;
    }

    this.totalSincronizaciones += 1;
    this.ultimaSincronizacionEn = new Date().toISOString();
    this.ultimoResultado = {
      ...resultado,
      motivoSincronizacion: motivo,
      versionObservadaRedis: versionRedis,
      versionObservadaConfiguracion: versionConfiguracion,
      versionAplicada: this.versionCatalogoDnsActual,
      versionError: this.versionCatalogoDnsError,
      versionConfiguracionAplicada: this.versionConfiguracionActual,
      versionConfiguracionError: this.versionConfiguracionError,
      catalogo: this.catalogoDnsRuntime?.serializarResumen?.() || null,
      sincronizadoEn: this.ultimaSincronizacionEn
    };

    return this.serializarResumen();
  }

  async #procesarPublicacionCoordinada({ motivo, forzar }) {
    const resultado = await this.publicadorCoordinado.publicarSiguiente();
    // Una operación anterior al nuevo modelo puede terminar de recuperarse
    // después del arranque. Revalidar entonces, sin esperar otro reinicio.
    if (resultado?.ok && resultado.operacion?.estado === 'consolidada' &&
        resultado.operacion.fotografiaZonas == null) {
      await this.repositorioCoordinacion.asegurarLecturaPublicacionZonas?.();
    }
    if (resultado?.omitida && !forzar) return null;

    if (!resultado?.omitida) {
      this.catalogoDnsRuntime = await this.cargadorCatalogoDnsRuntime.cargarInicial();
    }
    const generacion = this.normalizarVersion(resultado?.operacion?.generacionDns);
    if (resultado?.ok) {
      if (generacion) this.versionCatalogoDnsActual = generacion;
      this.versionCatalogoDnsError = null;
      if (!resultado.omitida) this.totalPublicacionesOk += 1;
    } else {
      this.versionCatalogoDnsError = generacion;
      this.totalErrores += 1;
    }
    this.totalSincronizaciones += 1;
    this.ultimaSincronizacionEn = new Date().toISOString();
    this.ultimoResultado = {
      ...resultado,
      omitido: Boolean(resultado?.omitida),
      motivoSincronizacion: motivo,
      versionAplicada: this.versionCatalogoDnsActual,
      versionError: this.versionCatalogoDnsError,
      catalogo: this.catalogoDnsRuntime?.serializarResumen?.() || null,
      sincronizadoEn: this.ultimaSincronizacionEn
    };
    return this.serializarResumen();
  }

  serializarResumen() {
    return {
      versionCatalogoDnsActual: this.versionCatalogoDnsActual,
      versionCatalogoDnsError: this.versionCatalogoDnsError,
      versionConfiguracionActual: this.versionConfiguracionActual,
      versionConfiguracionError: this.versionConfiguracionError,
      totalSincronizaciones: this.totalSincronizaciones,
      totalPublicacionesOk: this.totalPublicacionesOk,
      totalErrores: this.totalErrores,
      ultimaSincronizacionEn: this.ultimaSincronizacionEn,
      catalogo: this.catalogoDnsRuntime?.serializarResumen?.() || null,
      ultimoResultado: this.ultimoResultado
    };
  }

  normalizarVersion(version) {
    const normalizada = Number(version || 0);
    return Number.isFinite(normalizada) && normalizada > 0
      ? normalizada
      : null;
  }
}
