export class AdaptadorCoordinacionGeneracionesDns {
  constructor({ repositorio } = {}) {
    if (!repositorio?.reclamarSiguienteConLease || !repositorio?.renovarLease) {
      throw new Error('El adaptador DNS requiere su repositorio durable.');
    }
    this.repositorio = repositorio;
  }

  async reclamarSiguiente({ instanciaId, leaseToken, ttlSegundos }) {
    const operacion = await this.repositorio.reclamarSiguienteConLease({
      instanciaId,
      leaseToken,
      ttlSegundos
    });
    if (!operacion) return null;
    return Object.freeze({
      operacionId: operacion.generacionDns,
      fencingToken: operacion.fencingToken,
      intentos: operacion.intentos,
      operacion
    });
  }

  async renovarLease(parametros) {
    const actualizada = await this.repositorio.renovarLease(parametros, {
      ttlSegundos: parametros.ttlSegundos
    });
    return { actualizada };
  }

  async avanzarConLease(parametros) {
    let operacion;
    if (parametros.transicion === 'efecto_iniciado') {
      operacion = await this.repositorio.iniciarEfectoConLease(
        parametros,
        parametros.datos
      );
    } else if (parametros.transicion === 'recarga_observada') {
      operacion = await this.repositorio.confirmarRecargaConLease(
        parametros,
        parametros.datos?.resultado
      );
    } else if (parametros.transicion === 'sin_cambios') {
      operacion = await this.repositorio.terminarSinCambiosConLease(parametros);
    } else if (parametros.transicion === 'recuperacion_pendiente') {
      operacion = await this.repositorio.marcarRecuperacionPendienteConLease(
        parametros,
        parametros.datos?.diagnostico
      );
    } else {
      throw new Error(`La transición DNS ${parametros.transicion} no está soportada.`);
    }
    return { actualizada: Boolean(operacion), operacion };
  }

  async consolidarConLease(parametros) {
    const operacion = await this.repositorio.consolidarResultadoConLease(
      parametros,
      parametros.resultado
    );
    return { actualizada: Boolean(operacion), operacion };
  }

  async registrarFalloConLease(parametros) {
    let operacion;
    if (parametros.permanente) {
      operacion = await this.repositorio.fallarEstableConLease(parametros, {
        diagnostico: parametros.diagnostico,
        resumen: parametros.resumen ?? {},
        demoraReintentoSegundos: parametros.demoraReintentoSegundos
      });
    } else {
      operacion = await this.repositorio.reprogramarConLease(parametros, {
        diagnostico: parametros.diagnostico,
        demoraSegundos: parametros.demoraReintentoSegundos
      });
    }
    return { actualizada: Boolean(operacion), operacion };
  }
}
