export class ServicioCustodiaSecretoEmisionFederacion {
  #repositorioCredenciales;
  #protectorSecretoPersistente;

  constructor({ repositorioCredenciales, protectorSecretoPersistente } = {}) {
    exigirMetodo(
      repositorioCredenciales,
      'guardarSecretoEmisor',
      'repositorioCredenciales'
    );
    exigirMetodo(
      repositorioCredenciales,
      'recuperarSecretoEmisor',
      'repositorioCredenciales'
    );
    exigirMetodo(protectorSecretoPersistente, 'cifrar', 'protectorSecretoPersistente');
    exigirMetodo(
      protectorSecretoPersistente,
      'descifrar',
      'protectorSecretoPersistente'
    );
    this.#repositorioCredenciales = repositorioCredenciales;
    this.#protectorSecretoPersistente = protectorSecretoPersistente;
  }

  async custodiarRespuestaCanje(entrada = {}) {
    return this.#repositorioCredenciales.guardarSecretoEmisor(entrada, {
      protector: this.#protectorSecretoPersistente
    });
  }

  async obtenerParaLoginTecnico(entrada = {}) {
    return this.#repositorioCredenciales.recuperarSecretoEmisor(entrada, {
      protector: this.#protectorSecretoPersistente
    });
  }
}

function exigirMetodo(valor, metodo, campo) {
  if (typeof valor?.[metodo] !== 'function') {
    throw new Error(`${campo} debe implementar ${metodo}().`);
  }
}
