export class AdaptadorCapturaTransaccionalFederacionSql {
  constructor({ repositorioOcurrencias, repositorioOutbox } = {}) {
    if (typeof repositorioOcurrencias?.registrarOcurrenciaEnTransaccion !== 'function') {
      throw new Error('La captura federada requiere el repositorio de ocurrencias.');
    }
    if (typeof repositorioOutbox?.encolarPosicionesEnTransaccion !== 'function') {
      throw new Error('La captura federada requiere una outbox propia.');
    }
    this.repositorioOcurrencias = repositorioOcurrencias;
    this.repositorioOutbox = repositorioOutbox;
  }

  async capturarEnTransaccion({ definicion, destinos } = {}, { conexion } = {}) {
    const registro = await this.repositorioOcurrencias
      .registrarOcurrenciaEnTransaccion({ definicion, destinos }, { conexion });
    const posicionesAsignadas = registro.posiciones.filter(
      (posicion) => posicion.posicionFlujo !== null
    );
    const obligaciones = posicionesAsignadas.length === 0
      ? []
      : await this.repositorioOutbox
        .encolarPosicionesEnTransaccion(posicionesAsignadas, { conexion });
    return Object.freeze({
      estadoOcurrencia: registro.estado,
      ocurrencia: registro.ocurrencia,
      posiciones: registro.posiciones,
      obligaciones: Object.freeze(obligaciones)
    });
  }
}
