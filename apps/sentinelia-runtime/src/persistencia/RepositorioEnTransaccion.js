export function enlazarRepositorioAConexion(repositorio, conexion) {
  if (!repositorio || typeof conexion?.execute !== 'function') return repositorio;
  const clon = Object.create(Object.getPrototypeOf(repositorio));
  Object.assign(clon, repositorio, {
    clienteSql: {
      obtenerConexion() {
        throw new Error('Un repositorio ligado no puede abrir otra conexión.');
      },
      ejecutar(sql, parametros = []) {
        return conexion.execute(sql, parametros);
      },
      async consultar(sql, parametros = []) {
        const [filas] = await conexion.execute(sql, parametros);
        return filas;
      },
      escaparIdentificador: repositorio.clienteSql?.escaparIdentificador?.bind(
        repositorio.clienteSql
      )
    }
  });
  return clon;
}
