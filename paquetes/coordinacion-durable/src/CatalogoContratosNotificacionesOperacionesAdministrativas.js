export class CatalogoContratosNotificacionesOperacionesAdministrativas {
  #porTipoSujeto;

  constructor({ contratos = [] } = {}) {
    if (!Array.isArray(contratos) || contratos.length === 0) {
      throw new Error('El catálogo de notificaciones exige contratos explícitos.');
    }
    this.#porTipoSujeto = new Map();
    for (const contrato of contratos) this.#registrar(contrato);
    Object.freeze(this);
  }

  validar(entrada) {
    return this.#resolver(tipoSujetoDe(entrada)).validarNotificacion(entrada);
  }

  canonicalizarPayload(entrada) {
    return this.#resolver(tipoSujetoDe(entrada)).canonicalizarPayload(entrada);
  }

  listarTiposSujeto() {
    return Object.freeze([...this.#porTipoSujeto.keys()].sort());
  }

  #registrar(contrato) {
    if (!contrato || typeof contrato !== 'object' || Array.isArray(contrato)) {
      throw new Error('Cada contrato de notificación debe ser un objeto explícito.');
    }
    if (
      !Array.isArray(contrato.tiposSujeto) || contrato.tiposSujeto.length === 0 ||
      typeof contrato.validarNotificacion !== 'function' ||
      typeof contrato.canonicalizarPayload !== 'function'
    ) {
      throw new Error('El contrato de notificación no satisface el puerto cerrado.');
    }
    const registro = Object.freeze({
      validarNotificacion: contrato.validarNotificacion.bind(contrato),
      canonicalizarPayload: contrato.canonicalizarPayload.bind(contrato)
    });
    for (const valor of contrato.tiposSujeto) {
      const tipo = String(valor || '');
      if (!/^[a-z][a-z0-9_]{0,63}$/u.test(tipo)) {
        throw new Error(`El tipo de sujeto ${tipo || '(vacío)'} no es válido.`);
      }
      if (this.#porTipoSujeto.has(tipo)) {
        throw new Error(`El tipo de sujeto ${tipo} posee más de un contrato.`);
      }
      this.#porTipoSujeto.set(tipo, registro);
    }
  }

  #resolver(tipo) {
    const contrato = this.#porTipoSujeto.get(tipo);
    if (!contrato) {
      throw new Error(`No existe contrato de notificación para ${tipo || '(vacío)'}.`);
    }
    return contrato;
  }
}

function tipoSujetoDe(entrada) {
  return String(entrada?.referenciaSujeto?.tipo || '');
}
