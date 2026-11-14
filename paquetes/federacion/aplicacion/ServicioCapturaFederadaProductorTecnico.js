export class ErrorCapturaProductorTecnico extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.name = 'ErrorCapturaProductorTecnico';
    this.codigo = codigo;
  }
}

export class ServicioCapturaFederadaProductorTecnico {
  constructor({ puertoCaptura } = {}) {
    if (typeof puertoCaptura?.capturarEnTransaccion !== 'function') {
      throw new Error(
        'El productor técnico requiere el puerto neutral de captura federada.'
      );
    }
    this.puertoCaptura = puertoCaptura;
    Object.freeze(this);
  }

  async capturarLoteEnTransaccion({ capturas } = {}, { conexion } = {}) {
    if (!conexion?.execute || !conexion?.query) {
      throw new ErrorCapturaProductorTecnico(
        'conexion_prestada_ausente',
        'La ingesta técnica debe prestar su conexión SQL activa.'
      );
    }
    if (!Array.isArray(capturas) || capturas.length === 0) {
      throw new ErrorCapturaProductorTecnico(
        'capturas_ausentes',
        'El lote técnico debe contener al menos una captura federable.'
      );
    }
    const [estadoTransaccion] = await conexion.query(
      'SELECT @@in_transaction AS activa'
    );
    if (!Boolean(estadoTransaccion[0]?.activa)) {
      throw new ErrorCapturaProductorTecnico(
        'transaccion_prestada_inactiva',
        'La captura técnica exige la transacción compartida activa.'
      );
    }
    const resultados = [];
    for (const captura of capturas) {
      resultados.push(await this.puertoCaptura.capturarEnTransaccion(
        captura,
        { conexion }
      ));
    }
    return Object.freeze({
      totalCapturas: resultados.length,
      resultados: Object.freeze(resultados),
      posiciones: Object.freeze(resultados.flatMap((resultado) =>
        resultado.posiciones
      ))
    });
  }
}
