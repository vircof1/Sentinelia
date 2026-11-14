export function crearRepositoriosTelemetriaEnTransaccion({
  repositorioCatalogoSenales,
  repositorioObservaciones = null,
  repositorioEstadoActual = null,
  repositorioIdempotenciaLotes = null,
  repositorioReglasDerivacion = null,
  repositorioTrabajosEvaluacion = null
} = {}, conexion) {
  const clienteSql = crearEjecutorTelemetriaEnTransaccion(conexion);
  return Object.freeze({
    repositorioCatalogoSenales: clonarRepositorioConClienteSql(
      repositorioCatalogoSenales,
      clienteSql
    ),
    repositorioObservaciones: repositorioObservaciones
      ? clonarRepositorioConClienteSql(repositorioObservaciones, clienteSql)
      : null,
    repositorioEstadoActual: repositorioEstadoActual
      ? clonarRepositorioConClienteSql(repositorioEstadoActual, clienteSql)
      : null,
    repositorioIdempotenciaLotes: repositorioIdempotenciaLotes
      ? clonarRepositorioConClienteSql(repositorioIdempotenciaLotes, clienteSql)
      : null,
    repositorioReglasDerivacion: repositorioReglasDerivacion
      ? clonarRepositorioConClienteSql(repositorioReglasDerivacion, clienteSql)
      : null,
    repositorioTrabajosEvaluacion: repositorioTrabajosEvaluacion
      ? clonarRepositorioConClienteSql(repositorioTrabajosEvaluacion, clienteSql)
      : null
  });
}

export function clonarRepositorioConClienteSql(repositorio, clienteSql) {
  if (!repositorio) {
    throw new Error('No se puede enlazar un repositorio de telemetría ausente.');
  }
  return Object.assign(Object.create(Object.getPrototypeOf(repositorio)), {
    ...repositorio,
    clienteSql
  });
}

export function crearEjecutorTelemetriaEnTransaccion(conexion) {
  if (typeof conexion?.execute !== 'function') {
    throw new Error('La publicación de telemetría requiere una conexión SQL activa.');
  }

  return Object.freeze({
    async ejecutar(sql, parametros = []) {
      return conexion.execute(sql, parametros);
    },

    async consultar(sql, parametros = []) {
      const [filas] = await conexion.execute(sql, parametros);
      return filas;
    }
  });
}
