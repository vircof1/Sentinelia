export class ControladorBootstrapMigraciones {
  constructor({ habilitado, ejecutorMigraciones, clienteSql }) {
    this.habilitado = habilitado;
    this.ejecutorMigraciones = ejecutorMigraciones;
    this.clienteSql = clienteSql;
  }

  async arrancarSiProcede() {
    const usoHorarioUtc = await this.clienteSql.verificarUsoHorarioUtc();

    if (!this.habilitado) {
      const integridad = await this.ejecutorMigraciones.auditarIntegridadAplicadas();

      return {
        ejecutado: false,
        pendientesAplicadas: 0,
        integridad,
        usoHorarioUtc,
        mensaje:
          `Bootstrap de migraciones deshabilitado por entorno. ${this.ejecutorMigraciones.construirMensajeIntegridadOk(integridad)}`
      };
    }

    const resultadoBaseDatos = await this.clienteSql.crearBaseDatosSiNoExiste();
    const usoHorarioUtcPostCreacion = await this.clienteSql.verificarUsoHorarioUtc();
    const resultadoMigraciones = await this.ejecutorMigraciones.ejecutarPendientes();

    return {
      ...resultadoMigraciones,
      usoHorarioUtc: usoHorarioUtcPostCreacion,
      baseDatosCreada: resultadoBaseDatos.creada,
      mensaje: resultadoBaseDatos.creada
        ? `Base de datos creada y ${resultadoMigraciones.mensaje.toLowerCase()}`
        : `Base de datos verificada y ${resultadoMigraciones.mensaje.toLowerCase()}`
    };
  }
}
