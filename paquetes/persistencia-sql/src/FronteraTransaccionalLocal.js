export class FronteraTransaccionalLocal {
  constructor(clienteSql) {
    if (typeof clienteSql?.obtenerConexion !== 'function') {
      throw new Error(
        'FronteraTransaccionalLocal requiere un cliente SQL operativo.'
      );
    }
    this.clienteSql = clienteSql;
  }

  async ejecutar(trabajo) {
    if (typeof trabajo !== 'function') {
      throw new TypeError('La transacción local requiere una función de trabajo.');
    }

    const conexion = await this.clienteSql.obtenerConexion();
    let transaccionIniciada = false;
    let errorPrincipal = null;

    try {
      validarConexion(conexion);
      await conexion.beginTransaction();
      transaccionIniciada = true;
      const resultado = await trabajo(conexion);
      await conexion.commit();
      transaccionIniciada = false;
      return resultado;
    } catch (error) {
      errorPrincipal = error;
      if (transaccionIniciada) {
        await rollbackSeguro(conexion);
      }
      throw error;
    } finally {
      try {
        if (typeof conexion?.release === 'function') {
          await conexion.release();
        }
      } catch (errorLiberacion) {
        if (!errorPrincipal) throw errorLiberacion;
      }
    }
  }
}

function validarConexion(conexion) {
  for (const metodo of ['beginTransaction', 'commit', 'rollback', 'release']) {
    if (typeof conexion?.[metodo] !== 'function') {
      throw new Error(`La conexión SQL no proporciona ${metodo}().`);
    }
  }
}

async function rollbackSeguro(conexion) {
  try {
    await conexion.rollback();
  } catch {
    // El fallo que provocó el rollback conserva la autoridad diagnóstica.
  }
}
