export class LimpiadorSesionesEliminacionOrganizativa {
  constructor({ servicioSesion, repositorioSesionesTecnicasRedis } = {}) {
    if (!servicioSesion?.limpiarEstadoUsuario ||
        !repositorioSesionesTecnicasRedis?.aplicar ||
        !repositorioSesionesTecnicasRedis?.retirarSiCoincide) {
      throw new Error('La limpieza organizativa requiere store y Redis técnicos.');
    }
    this.servicioSesion = servicioSesion;
    this.repositorioSesionesTecnicasRedis = repositorioSesionesTecnicasRedis;
  }

  async ejecutar({ usuarios = [], invalidacionesTecnicas = [] } = {}) {
    const tareas = usuarios.map((usuarioId) =>
      this.servicioSesion.limpiarEstadoUsuario(usuarioId)
    );
    for (const neutralizacion of invalidacionesTecnicas) {
      for (const retirada of neutralizacion.retiradasPendientes || []) {
        tareas.push(
          this.repositorioSesionesTecnicasRedis.retirarSiCoincide(retirada)
        );
      }
      if (!neutralizacion.operacion) continue;
      tareas.push(this.repositorioSesionesTecnicasRedis.aplicar({
        agenteId: neutralizacion.agente.agenteId,
        operacionId: neutralizacion.operacion.operacionId,
        sesionAuditoriaId: neutralizacion.agente.sesionAuditoriaId,
        fencingToken: neutralizacion.operacion.fencingToken,
        proyeccion: null
      }));
    }
    const resultados = await Promise.allSettled(tareas);
    const fallo = resultados.find(({ status }) => status === 'rejected');
    if (fallo) {
      throw new Error(
        'La eliminación quedó confirmada, pero una proyección de sesión requiere reintento.',
        { cause: fallo.reason }
      );
    }
    return Object.freeze({ limpiezas: resultados.length });
  }
}
