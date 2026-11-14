export class PreparadorArranqueBindDns {
  constructor({
    configuracion,
    diagnosticoAlmacenamiento,
    activador,
    validadorGrafo,
    comandos,
    supervisor,
    prepararSelectorDurable
  } = {}) {
    if (!configuracion || typeof prepararSelectorDurable !== 'function') {
      throw new Error('El arranque BIND requiere configuración y preparación durable.');
    }
    Object.assign(this, {
      configuracion,
      diagnosticoAlmacenamiento,
      activador,
      validadorGrafo,
      comandos,
      supervisor,
      prepararSelectorDurable
    });
    this.salud = new EstadoSaludBindDns({ dnsActivo: configuracion.activo });
    supervisor?.on?.('salida', ({ inesperada }) => {
      if (inesperada) this.salud.marcarProcesoCaido();
    });
  }

  async prepararEIniciar() {
    if (!this.configuracion.activo) {
      this.salud.marcarPortalDisponible();
      return Object.freeze({ iniciado: false, dnsActivo: false, salud: this.salud.obtener() });
    }
    await this.configuracion.validarSistema();
    await this.diagnosticoAlmacenamiento.verificar();
    const clasificacion = await this.#clasificarSelector();
    const preparacionDurable = await this.prepararSelectorDurable({
      estadoAnterior: clasificacion
    });
    const selector = await this.activador.leerSelectorActivo();
    if (!selector) throw new Error('La preparación durable no produjo un selector BIND v1.');
    await this.validadorGrafo.validar();
    await this.comandos.validarConfiguracionActiva();
    const proceso = this.supervisor.iniciar();
    this.salud.marcarProcesoVivo();
    this.salud.marcarPublicadorPendiente();
    return Object.freeze({
      iniciado: true,
      dnsActivo: true,
      estadoAnterior: clasificacion,
      preparacionDurable,
      selector,
      proceso,
      salud: this.salud.obtener()
    });
  }

  marcarRecargaObservada() {
    this.salud.marcarPublicadorListo();
  }

  marcarRecargaNoObservada(causa) {
    this.salud.marcarPublicadorDegradado(codigoDiagnostico(causa));
  }

  marcarPortalDisponible() {
    this.salud.marcarPortalDisponible();
  }

  async #clasificarSelector() {
    if (typeof this.activador.clasificarSelectorActivo !== 'function') {
      throw new Error('El activador BIND no proporciona clasificación estricta del selector.');
    }
    return this.activador.clasificarSelectorActivo();
  }
}

export class EstadoSaludBindDns {
  constructor({ dnsActivo }) {
    this.dnsActivo = Boolean(dnsActivo);
    this.portalDisponible = false;
    this.publicador = this.dnsActivo ? 'preparando' : 'desactivado';
    this.procesoDns = this.dnsActivo ? 'ausente' : 'desactivado';
    this.diagnosticoDns = null;
  }

  marcarPortalDisponible() { this.portalDisponible = true; }
  marcarProcesoVivo() { if (this.dnsActivo) this.procesoDns = 'vivo'; }
  marcarProcesoCaido() {
    if (this.dnsActivo) {
      this.procesoDns = 'caido';
      this.publicador = 'degradado';
      this.diagnosticoDns = 'bind_proceso_caido';
    }
  }
  marcarPublicadorPendiente() {
    if (this.dnsActivo) {
      this.publicador = 'recarga_pendiente';
      this.diagnosticoDns = null;
    }
  }
  marcarPublicadorDegradado(codigo) {
    if (this.dnsActivo) {
      this.publicador = 'degradado';
      this.diagnosticoDns = codigo;
    }
  }
  marcarPublicadorListo() {
    if (this.dnsActivo && this.procesoDns === 'vivo') {
      this.publicador = 'listo';
      this.diagnosticoDns = null;
    }
  }

  obtener() {
    return Object.freeze({
      portalDisponible: this.portalDisponible,
      dnsActivo: this.dnsActivo,
      publicador: this.publicador,
      procesoDns: this.procesoDns,
      diagnosticoDns: this.diagnosticoDns,
      readinessDns: !this.dnsActivo || (this.publicador === 'listo' && this.procesoDns === 'vivo'),
      livenessDns: !this.dnsActivo || this.procesoDns === 'vivo'
    });
  }
}

function codigoDiagnostico(causa) {
  const codigo = String(causa?.codigo || causa || 'bind_recarga_no_observada');
  return /^[a-z][a-z0-9_]{0,63}$/.test(codigo)
    ? codigo
    : 'bind_recarga_no_observada';
}
