import { ClienteHttpDatosFederacion } from './ClienteHttpDatosFederacion.js';

export class ClienteHttpControlFederacion {
  #transporte;

  constructor(opciones = {}) {
    this.#transporte = new ClienteHttpDatosFederacion(opciones);
  }

  canjearInvitacion(entrada) {
    return this.#transporte.canjearInvitacion(
      prepararEntradaEstablecimiento(entrada, 'invitacion')
    );
  }

  canjearRecuperacion(entrada) {
    return this.#transporte.canjearRecuperacion(
      prepararEntradaEstablecimiento(entrada, 'recuperacion')
    );
  }

  iniciarSesion(entrada) {
    return this.#transporte.iniciarSesion(entrada);
  }

  publicarDeclaracionConcesion(entrada) {
    return this.#transporte.publicarDeclaracionConcesion(entrada);
  }

  consultarConfirmacionConcesion(entrada) {
    return this.#transporte.consultarConfirmacionConcesion(entrada);
  }

  publicarManifiestoFlujoInicial(entrada) {
    return this.#transporte.publicarManifiestoFlujoInicial(entrada);
  }

  consultarManifiestosFlujosIniciales(entrada) {
    return this.#transporte.consultarManifiestosFlujosIniciales(entrada);
  }
}

function prepararEntradaEstablecimiento(entrada, campoRepresentacion) {
  const representacion = entrada?.solicitud?.[campoRepresentacion];
  const destinoRepresentado = representacion?.destino;
  if (typeof entrada?.destino !== 'string' ||
      destinoRepresentado?.origenPublico !== entrada.destino) {
    throw new Error(
      'El destino de establecimiento debe coincidir con su representación validada.'
    );
  }
  return {
    ...entrada,
    destino: Object.freeze({
      relacionId: destinoRepresentado.relacionId,
      installationRemotaId: destinoRepresentado.installationId,
      endpoint: entrada.destino
    })
  };
}
