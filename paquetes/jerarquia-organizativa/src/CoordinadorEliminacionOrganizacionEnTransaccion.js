export class CoordinadorEliminacionOrganizacionEnTransaccion {
  constructor({
    preparadorInventario,
    preparadorEfectos,
    ejecutorBorrado,
    registradorAuditoria,
    finalizadorResultado
  } = {}) {
    exigirPuerto(preparadorInventario, 'prepararEnTransaccion', 'inventario');
    exigirPuerto(preparadorEfectos, 'prepararEnTransaccion', 'efectos');
    exigirPuerto(ejecutorBorrado, 'ejecutarEnTransaccion', 'borrado');
    exigirPuerto(registradorAuditoria, 'registrarEnTransaccion', 'auditoría');
    exigirPuerto(finalizadorResultado, 'finalizarEnTransaccion', 'finalización');
    Object.assign(this, {
      preparadorInventario,
      preparadorEfectos,
      ejecutorBorrado,
      registradorAuditoria,
      finalizadorResultado
    });
  }

  async ejecutar({ lease, operacion } = {}, { conexion } = {}) {
    if (typeof conexion?.execute !== 'function') {
      throw new TypeError('El coordinador organizativo exige conexión prestada.');
    }
    const inventario = await this.preparadorInventario.prepararEnTransaccion(
      { lease, operacion },
      { conexion }
    );
    const preparacion = await this.preparadorEfectos.prepararEnTransaccion(
      { inventario },
      { conexion }
    );
    const ejecucion = await this.ejecutorBorrado.ejecutarEnTransaccion(
      { preparacion },
      { conexion }
    );
    const registroAuditoria = await this.registradorAuditoria
      .registrarEnTransaccion(
        { ejecucion },
        { conexion }
      );
    const cierre = await this.finalizadorResultado.finalizarEnTransaccion(
      { lease, ejecucion, registroAuditoria },
      { conexion }
    );
    return congelar({
      estado: 'eliminada_en_transaccion',
      inventario,
      preparacion,
      ejecucion,
      registroAuditoria,
      cierre
    });
  }
}

function exigirPuerto(puerto, metodo, nombre) {
  if (typeof puerto?.[metodo] !== 'function') {
    throw new Error(`El coordinador organizativo exige el puerto de ${nombre}.`);
  }
}

function congelar(valor) {
  if (valor && typeof valor === 'object' && !Object.isFrozen(valor)) {
    for (const hijo of Object.values(valor)) congelar(hijo);
    Object.freeze(valor);
  }
  return valor;
}
