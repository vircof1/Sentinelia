const OPCIONES_BOOLEANO = [
  { valor: 'true', etiqueta: 'true' },
  { valor: 'false', etiqueta: 'false' }
];

const MENSAJE_OCULTO = 'Oculto por seguridad.';

const TIPOS_DATO_CONFIGURACION = {
  texto: {
    tipoEntrada: 'text',
    convertirValor(valor) {
      return String(valor ?? '');
    },
    normalizarPersistible(valor, definicion) {
      const valorTexto = String(valor ?? '');
      validarRequerido(definicion, valorTexto);
      return valorTexto;
    }
  },
  booleano: {
    tipoEntrada: 'select',
    opciones: OPCIONES_BOOLEANO,
    convertirValor(valor) {
      return ['1', 'true', 'si', 'yes', 'on'].includes(
        String(valor).toLowerCase()
      );
    },
    normalizarPersistible(valor) {
      const valorTexto = String(valor ?? '').toLowerCase().trim();

      if (['1', 'true', 'si', 'yes', 'on'].includes(valorTexto)) {
        return 'true';
      }

      if (['0', 'false', 'no', 'off'].includes(valorTexto)) {
        return 'false';
      }

      throw new Error('El valor debe ser booleano (true/false).');
    }
  },
  entero: {
    tipoEntrada: 'number',
    convertirValor(valor, definicion) {
      const numero = Number.parseInt(String(valor), 10);

      if (Number.isNaN(numero)) {
        throw new Error(`El valor ${valor} no es un entero válido.`);
      }

      validarRangoEntero(numero, definicion);
      return numero;
    },
    normalizarPersistible(valor, definicion) {
      const valorTexto = String(valor ?? '').trim();
      validarRequerido(definicion, valorTexto);

      if (!valorTexto && !definicion.requerido) {
        return '';
      }

      if (!/^-?\d+$/.test(valorTexto)) {
        throw new Error('El valor debe ser un entero válido.');
      }

      const numero = Number.parseInt(valorTexto, 10);
      validarRangoEntero(numero, definicion);

      return String(numero);
    }
  },
  entero_nulable: {
    tipoEntrada: 'number',
    convertirValor(valor, definicion) {
      if (valor === null || valor === undefined || valor === '') return null;
      const numero = Number(valor);
      if (!Number.isInteger(numero)) {
        throw new Error('El valor debe ser NULL o un entero, no un string numérico.');
      }
      validarRangoEntero(numero, definicion);
      return numero;
    },
    normalizarPersistible(valor, definicion) {
      if (valor === null || valor === undefined || valor === '') return null;
      if (!Number.isInteger(valor)) {
        throw new Error('El valor debe ser NULL o un entero, no un string numérico.');
      }
      validarRangoEntero(valor, definicion);
      return valor;
    }
  },
  password: {
    tipoEntrada: 'password',
    esSecreto: true,
    placeholder: 'Introduce un nuevo valor',
    mensajeOculto: MENSAJE_OCULTO,
    convertirValor(valor) {
      return String(valor ?? '');
    },
    normalizarPersistible(valor, definicion) {
      const valorTexto = String(valor ?? '');
      validarRequerido(definicion, valorTexto);

      if (!valorTexto) {
        throw new Error('Debes indicar un valor para este secreto.');
      }

      return valorTexto;
    }
  },
  email: {
    tipoEntrada: 'email',
    convertirValor(valor) {
      return String(valor ?? '').trim();
    },
    normalizarPersistible(valor, definicion) {
      const valorTexto = String(valor ?? '').trim();
      validarRequerido(definicion, valorTexto);

      if (!valorTexto && !definicion.requerido) {
        return '';
      }

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valorTexto)) {
        throw new Error('El valor debe ser un correo válido.');
      }

      return valorTexto;
    }
  },
  host: {
    tipoEntrada: 'text',
    convertirValor(valor) {
      return String(valor ?? '').trim();
    },
    normalizarPersistible(valor, definicion) {
      const valorTexto = String(valor ?? '').trim();
      validarRequerido(definicion, valorTexto);

      if (!valorTexto && !definicion.requerido) {
        return '';
      }

      if (/\s/.test(valorTexto)) {
        throw new Error('El host no puede contener espacios.');
      }

      return valorTexto;
    }
  },
  puerto: {
    tipoEntrada: 'number',
    convertirValor(valor) {
      const numero = Number.parseInt(String(valor), 10);

      if (Number.isNaN(numero) || numero < 1 || numero > 65535) {
        throw new Error(`El valor ${valor} no es un puerto válido.`);
      }

      return numero;
    },
    normalizarPersistible(valor, definicion) {
      const valorTexto = String(valor ?? '').trim();
      validarRequerido(definicion, valorTexto);

      if (!valorTexto && !definicion.requerido) {
        return '';
      }

      if (!/^\d+$/.test(valorTexto)) {
        throw new Error('El valor debe ser un puerto válido.');
      }

      const numero = Number.parseInt(valorTexto, 10);

      if (numero < 1 || numero > 65535) {
        throw new Error('El puerto debe estar entre 1 y 65535.');
      }

      return String(numero);
    }
  },
  url: {
    tipoEntrada: 'url',
    convertirValor(valor, definicion) {
      const valorTexto = String(valor ?? '').trim();
      validarRequerido(definicion, valorTexto);

      if (!valorTexto && !definicion.requerido) {
        return '';
      }

      return normalizarOrigenHttps(valorTexto);
    },
    normalizarPersistible(valor, definicion) {
      const valorTexto = String(valor ?? '').trim();
      validarRequerido(definicion, valorTexto);

      if (!valorTexto && !definicion.requerido) {
        return '';
      }

      return normalizarOrigenHttps(valorTexto);
    }
  }
};

function normalizarOrigenHttps(valor) {
  try {
    const url = new URL(valor);
    if (url.protocol !== 'https:' || url.username || url.password ||
        url.pathname !== '/' || url.search || url.hash) {
      throw new Error('origen_no_valido');
    }
    return url.origin;
  } catch (_error) {
    throw new Error('El valor debe ser un origen HTTPS válido sin ruta.');
  }
}

export function resolverTipoDatoConfiguracion(tipoDato) {
  const tipo = TIPOS_DATO_CONFIGURACION[String(tipoDato || '').trim()];

  if (!tipo) {
    throw new Error(`No existe el tipo de dato de configuración ${tipoDato}.`);
  }

  return tipo;
}

export function normalizarDefinicionConfiguracion(definicion) {
  const tipo = resolverTipoDatoConfiguracion(definicion.tipoDato);

  return {
    visibleEnListado: true,
    editable: true,
    requerido: false,
    participaAdmisionCorreo: false,
    invalidaPruebaSmtp: false,
    esSecreto: Boolean(tipo.esSecreto),
    placeholder: tipo.placeholder ?? '',
    mensajeOculto: tipo.mensajeOculto ?? MENSAJE_OCULTO,
    tipoEntrada: tipo.tipoEntrada,
    opciones: tipo.opciones ?? [],
    ...definicion
  };
}

export function convertirValorConfiguracion(valor, definicion) {
  return resolverTipoDatoConfiguracion(definicion.tipoDato).convertirValor(
    valor,
    definicion
  );
}

export function normalizarValorConfiguracionPersistible(valor, definicion) {
  try {
    return resolverTipoDatoConfiguracion(
      definicion.tipoDato
    ).normalizarPersistible(valor, definicion);
  } catch (error) {
    throw new Error(`El valor de ${definicion.clave} no es válido. ${error.message}`);
  }
}

function validarRequerido(definicion, valorTexto) {
  if (definicion.requerido && !valorTexto) {
    throw new Error('Debes indicar un valor.');
  }
}

function validarRangoEntero(numero, definicion) {
  const minimo = definicion.minimo;
  const maximo = definicion.maximo;

  if (minimo != null && numero < Number(minimo)) {
    throw new Error(`El valor debe ser mayor o igual a ${minimo}.`);
  }

  if (maximo != null && numero > Number(maximo)) {
    throw new Error(`El valor debe ser menor o igual a ${maximo}.`);
  }
}
