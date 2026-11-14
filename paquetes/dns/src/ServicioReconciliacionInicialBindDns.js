export class ServicioReconciliacionInicialBindDns {
  constructor({
    configuracion,
    repositorioCoordinacion,
    publicadorCoordinado,
    maxIntentos = 3
  } = {}) {
    if (!configuracion || !repositorioCoordinacion?.asegurarReconciliacionInicial ||
        !publicadorCoordinado?.publicarSiguiente) {
      throw new Error('La reconciliación inicial BIND requiere configuración, coordinación y publicador.');
    }
    this.configuracion = configuracion;
    this.repositorioCoordinacion = repositorioCoordinacion;
    this.publicadorCoordinado = publicadorCoordinado;
    this.maxIntentos = entero(maxIntentos, 1, 100, 'maxIntentos');
  }

  async prepararSelectorDurable({ estadoAnterior = 'desconocido' } = {}) {
    if (!this.configuracion.activo) {
      return Object.freeze({
        dnsActivo: false,
        creada: false,
        publicada: false,
        motivo: 'dns_desactivado'
      });
    }

    const asegurada = await this.repositorioCoordinacion.asegurarReconciliacionInicial({
      maxIntentos: this.maxIntentos
    });
    const resultadoPublicacion = await this.publicadorCoordinado.publicarSiguiente({
      limpiar: false
    });

    if (!resultadoPublicacion.ok || resultadoPublicacion.omitida) {
      throw new Error('La reconciliación inicial BIND no produjo una proyección activada.');
    }

    const operacion = resultadoPublicacion.operacion;
    if (!operacion?.efectoPosible || operacion.estado !== 'efecto_iniciado') {
      throw new Error('La reconciliación inicial debe cruzar la frontera de efecto antes de arrancar named.');
    }

    return Object.freeze({
      dnsActivo: true,
      creada: Boolean(asegurada.creada),
      publicada: true,
      estadoAnterior,
      reconciliacion: asegurada.reconciliacion,
      operacion,
      selector: resultadoPublicacion.activacion?.selector || null
    });
  }
}

function entero(valor, minimo, maximo, nombre) {
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero < minimo || numero > maximo) {
    throw new Error(`${nombre} queda fuera de rango.`);
  }
  return numero;
}
