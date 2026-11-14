export class ResolutorConfiguracionFederacionPortal {
  constructor({ servicioConfiguracionPortal, clienteSql, keyring = null,
    auditorKeyring = null } = {}) {
    exigirMetodo(servicioConfiguracionPortal, 'asegurarActualizada', 'servicioConfiguracionPortal');
    exigirMetodo(servicioConfiguracionPortal, 'obtenerConfiguracionActual', 'servicioConfiguracionPortal');
    exigirMetodo(clienteSql, 'verificarUsoHorarioUtc', 'clienteSql');
    if (keyring !== null) exigirMetodo(keyring, 'validarDisponibilidad', 'keyring');
    if (auditorKeyring !== null) {
      exigirMetodo(auditorKeyring, 'auditar', 'auditorKeyring');
      exigirMetodo(auditorKeyring, 'inventariar', 'auditorKeyring');
    }
    this.servicioConfiguracionPortal = servicioConfiguracionPortal;
    this.clienteSql = clienteSql;
    this.keyring = keyring;
    this.auditorKeyring = auditorKeyring;
    Object.freeze(this);
  }

  async cargarActual() {
    await this.servicioConfiguracionPortal.asegurarActualizada();
    const portal = this.servicioConfiguracionPortal.obtenerConfiguracionActual();
    const configuracion = portal.obtenerConfiguracionFederacion();
    const relojSql = await this.clienteSql.verificarUsoHorarioUtc();
    let resumenKeyring = Object.freeze({
      disponible: false,
      referencia: configuracion.keyringReferenciaDespliegue,
      keyIdActiva: null,
      keyIds: Object.freeze([])
    });
    if (this.keyring) {
      resumenKeyring = this.auditorKeyring
        ? await this.auditorKeyring.auditar({
            keyring: this.keyring,
            referencia: configuracion.keyringReferenciaDespliegue
          })
        : this.keyring.validarDisponibilidad({
            referencia: configuracion.keyringReferenciaDespliegue
          });
    } else {
      const inventario = this.auditorKeyring
        ? await this.auditorKeyring.inventariar()
        : Object.freeze({ totalSobres: 0 });
      if (inventario.totalSobres > 0) {
        const error = new Error(
          'SQL conserva sobres federados y exige el keyring histórico de despliegue.'
        );
        error.codigo = 'KEYRING_HISTORICO_AUSENTE';
        throw error;
      }
      if (configuracion.activacionFederacion) {
        throw new Error('La federación activa exige un keyring de despliegue válido.');
      }
    }
    return Object.freeze({ configuracion, relojSql, keyring: resumenKeyring });
  }
}

function exigirMetodo(valor, metodo, campo) {
  if (typeof valor?.[metodo] !== 'function') {
    throw new Error(`${campo} debe implementar ${metodo}().`);
  }
}
