export class CatalogoResolutoresSujetosNotificaciones {
  #porTipo;

  constructor({ resolutores = [] } = {}) {
    if (!Array.isArray(resolutores) || resolutores.length === 0) {
      throw new Error('El buzón exige resolutores de sujeto explícitos.');
    }
    this.#porTipo = new Map();
    for (const resolutor of resolutores) this.#registrar(resolutor);
    Object.freeze(this);
  }

  async resolverPagina(contextoUsuarioActual, notificaciones) {
    const grupos = new Map();
    for (const notificacion of notificaciones) {
      const referencia = notificacion?.referenciaSujeto;
      const tipo = String(referencia?.tipo || '');
      const registro = this.#porTipo.get(tipo);
      if (!registro) {
        throw new Error(`No existe resolutor de buzón para ${tipo || '(vacío)'}.`);
      }
      if (!grupos.has(registro)) grupos.set(registro, []);
      grupos.get(registro).push(referencia);
    }

    const resultado = new Map();
    await Promise.all([...grupos].map(async ([registro, referencias]) => {
      const proyecciones = await registro.resolver(contextoUsuarioActual, referencias);
      if (!(proyecciones instanceof Map)) {
        throw new Error('El resolutor de sujetos debe devolver un Map.');
      }
      for (const [clave, proyeccion] of proyecciones) {
        resultado.set(String(clave), proyeccion);
      }
    }));
    return resultado;
  }

  listarTiposSujeto() {
    return Object.freeze([...this.#porTipo.keys()].sort());
  }

  #registrar(resolutor) {
    if (
      !Array.isArray(resolutor?.tiposSujeto) || resolutor.tiposSujeto.length === 0 ||
      typeof resolutor?.resolver !== 'function'
    ) {
      throw new Error('El resolutor de sujetos no satisface el puerto cerrado.');
    }
    const registro = Object.freeze({
      resolver: resolutor.resolver.bind(resolutor)
    });
    for (const valor of resolutor.tiposSujeto) {
      const tipo = String(valor || '');
      if (!/^[a-z][a-z0-9_]{0,63}$/u.test(tipo)) {
        throw new Error(`El tipo de sujeto ${tipo || '(vacío)'} no es válido.`);
      }
      if (this.#porTipo.has(tipo)) {
        throw new Error(`El tipo de sujeto ${tipo} posee más de un resolutor.`);
      }
      this.#porTipo.set(tipo, registro);
    }
  }
}

export function claveSujetoNotificacion(referencia) {
  return `${String(referencia?.tipo || '')}:${String(referencia?.id || '')}`;
}

export function scopeActualCubre(contexto, scopeObjetivo) {
  const nivel = String(contexto?.nivelScope || '');
  if (nivel === 'portal') return true;
  if (String(contexto?.tenantId || '') !== String(scopeObjetivo?.tenantId || '')) {
    return false;
  }
  if (nivel === 'tenant') return true;
  if (String(contexto?.empresaId || '') !== String(scopeObjetivo?.empresaId || '')) {
    return false;
  }
  if (nivel === 'empresa') return true;
  return nivel === 'sitio' &&
    String(contexto?.sitioId || '') === String(scopeObjetivo?.sitioId || '');
}
