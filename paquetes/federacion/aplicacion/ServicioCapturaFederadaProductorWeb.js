export class ErrorPublicacionPostcommitFederacion extends Error {
  constructor(causa, resultadoConfirmado) {
    super(
      'La mutación web y su captura federada están confirmadas, pero falló el despertar Redis.',
      { cause: causa }
    );
    this.name = 'ErrorPublicacionPostcommitFederacion';
    this.codigo = 'publicacion_postcommit_fallida';
    this.cambioConfirmado = true;
    this.resultadoConfirmado = resultadoConfirmado;
  }
}

export class ServicioCapturaFederadaProductorWeb {
  constructor({ clienteSql, puertoCaptura, publicadorDisponibilidad } = {}) {
    exigirMetodo(clienteSql, 'obtenerConexion', 'clienteSql');
    exigirMetodo(
      puertoCaptura,
      'capturarEnTransaccion',
      'puertoCaptura'
    );
    exigirMetodo(
      publicadorDisponibilidad,
      'publicar',
      'publicadorDisponibilidad'
    );
    this.clienteSql = clienteSql;
    this.puertoCaptura = puertoCaptura;
    this.publicadorDisponibilidad = publicadorDisponibilidad;
    Object.freeze(this);
  }

  async ejecutar({ captura, mutarEnTransaccion } = {}) {
    if (!captura || typeof captura !== 'object') {
      throw new Error('El productor web debe preparar la captura antes de mutar.');
    }
    if (typeof mutarEnTransaccion !== 'function') {
      throw new Error('El productor web debe aportar su mutación transaccional.');
    }
    const conexion = await this.clienteSql.obtenerConexion();
    let resultadoMutacion;
    let resultadoCaptura;
    let confirmado = false;
    try {
      await conexion.beginTransaction();
      resultadoMutacion = await mutarEnTransaccion({ conexion, captura });
      resultadoCaptura = await this.puertoCaptura.capturarEnTransaccion(
        captura,
        { conexion }
      );
      await conexion.commit();
      confirmado = true;
    } catch (error) {
      if (!confirmado) {
        try {
          await conexion.rollback();
        } catch {}
      }
      throw error;
    } finally {
      conexion.release();
    }

    const resultadoConfirmado = Object.freeze({
      mutacion: resultadoMutacion,
      captura: resultadoCaptura
    });
    try {
      const publicacion = await this.publicadorDisponibilidad.publicar({
        posiciones: resultadoCaptura.posiciones
      });
      return Object.freeze({ ...resultadoConfirmado, publicacion });
    } catch (causa) {
      throw new ErrorPublicacionPostcommitFederacion(
        causa,
        resultadoConfirmado
      );
    }
  }
}

function exigirMetodo(valor, metodo, nombre) {
  if (typeof valor?.[metodo] !== 'function') {
    throw new Error(`${nombre} debe implementar ${metodo}().`);
  }
}
