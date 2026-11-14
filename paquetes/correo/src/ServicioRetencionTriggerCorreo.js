export class ServicioRetencionTriggerCorreo {
  constructor({ repositorio, fronteraTransaccional } = {}) {
    exigirMetodo(repositorio, 'listarCandidatosTerminales');
    exigirMetodo(repositorio, 'purgarCandidatoEnTransaccion');
    exigirMetodo(repositorio, 'diagnosticarIntegridadRecuperacionPassword');
    exigirMetodo(
      repositorio, 'diagnosticarIntegridadReinicioPasswordAdministrativo'
    );
    exigirMetodo(fronteraTransaccional, 'ejecutar');
    this.repositorio = repositorio;
    this.frontera = fronteraTransaccional;
  }

  listarCandidatos(entrada) {
    return this.repositorio.listarCandidatosTerminales(entrada);
  }

  purgarCandidato(candidato, { retencionDias } = {}) {
    return this.frontera.ejecutar((conexion) =>
      this.repositorio.purgarCandidatoEnTransaccion(candidato, {
        conexion,
        retencionDias
      }));
  }

  diagnosticarIntegridadRecuperacionPassword(entrada) {
    return this.repositorio.diagnosticarIntegridadRecuperacionPassword(entrada);
  }

  diagnosticarIntegridadReinicioPasswordAdministrativo(entrada) {
    return this.repositorio
      .diagnosticarIntegridadReinicioPasswordAdministrativo(entrada);
  }
}

function exigirMetodo(objeto, metodo) {
  if (typeof objeto?.[metodo] !== 'function') {
    throw new Error(`La retención de correo requiere ${metodo}().`);
  }
}
