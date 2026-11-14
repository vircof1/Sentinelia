export class ProgramadorRetiradaSesionTecnicaAgentes {
  constructor({ repositorioOperaciones, crearSiAusente = null } = {}) {
    if (typeof repositorioOperaciones?.buscarInvalidacionPorSesion !== 'function') {
      throw new Error('El programador requiere el repositorio durable de operaciones.');
    }
    this.repositorioOperaciones = repositorioOperaciones;
    this.crearSiAusente = crearSiAusente;
  }

  async programar(datos = {}) {
    const existente = await this.repositorioOperaciones.buscarInvalidacionPorSesion(
      datos.agenteId,
      datos.sesionAuditoriaId
    );
    if (existente) return resumir(existente);
    if (typeof this.crearSiAusente !== 'function') return null;
    const creada = await this.crearSiAusente(Object.freeze({ ...datos }));
    return creada ? resumir(creada) : null;
  }
}

function resumir(operacion) {
  return Object.freeze({
    operacionId: operacion.operacionId,
    agenteId: operacion.agenteId,
    sesionAuditoriaId: operacion.sesionAuditoriaId,
    fencingToken: operacion.fencingToken,
    estado: operacion.estado
  });
}
