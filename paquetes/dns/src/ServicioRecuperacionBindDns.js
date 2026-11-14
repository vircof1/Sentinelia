import {
  exigeRecargaForzadaPublicacionDns,
  ESTADOS_PUBLICACION_DNS
} from './EstadosPublicacionDns.js';

export class ServicioRecuperacionBindDns {
  constructor({
    repositorioCoordinacion,
    coordinador = null
  } = {}) {
    if (!repositorioCoordinacion?.crearReintentoReconciliacion ||
        !repositorioCoordinacion?.crearSucesoraPorDivergencia ||
        !repositorioCoordinacion?.crearSucesoraManual ||
        !repositorioCoordinacion?.obtenerReconciliacion ||
        !repositorioCoordinacion?.obtenerOperacion) {
      throw new Error('La recuperación BIND requiere el repositorio de coordinación completo.');
    }
    if (coordinador !== null && (!coordinador?.avanzar || !coordinador?.consolidar)) {
      throw new Error('El coordinador de recuperación BIND debe poder avanzar y consolidar.');
    }
    this.repositorioCoordinacion = repositorioCoordinacion;
    this.coordinador = coordinador;
  }

  async planificarReintentoReconciliacion() {
    const resultado = await this.repositorioCoordinacion.crearReintentoReconciliacion();
    return Object.freeze({
      ...resultado,
      accion: resultado.creada ? 'reintento_creado' : 'sin_reintento'
    });
  }

  async derivarSucesoraPorDivergencia({ generacionPredecesora, diagnostico, lease = null } = {}) {
    const resultado = await this.repositorioCoordinacion.crearSucesoraPorDivergencia(
      generacionPredecesora,
      diagnostico,
      lease ? { lease } : {}
    );
    return Object.freeze({
      ...resultado,
      accion: resultado.bloqueada
        ? 'recuperacion_bloqueada'
        : resultado.creada
          ? 'sucesora_creada'
          : 'sucesora_existente'
    });
  }

  async reactivarRecuperacionManual({ generacionPredecesora } = {}) {
    const operacion = await this.repositorioCoordinacion.crearSucesoraManual(
      generacionPredecesora
    );
    return Object.freeze({
      accion: 'sucesora_manual',
      operacion
    });
  }

  async resolverOperacionReclamada({ lease, operacion, resultado = null } = {}) {
    if (!this.coordinador) {
      throw new Error('Resolver una operación reclamada requiere coordinador durable.');
    }
    if (!lease || !operacion) {
      throw new Error('La recuperación BIND requiere lease y operación reclamados.');
    }
    if (operacion.estado === ESTADOS_PUBLICACION_DNS.RECARGA_CONFIRMADA) {
      const consolidada = await this.coordinador.consolidar(lease, {
        resultado: resultado || {}
      });
      return Object.freeze({
        accion: 'consolidada',
        operacion: consolidada.operacion
      });
    }
    const reconciliacion = await this.repositorioCoordinacion.obtenerReconciliacion();
    if (!exigeRecargaForzadaPublicacionDns(operacion, reconciliacion)) {
      const sinCambios = await this.coordinador.avanzar(lease, {
        transicion: 'sin_cambios'
      });
      return Object.freeze({
        accion: 'sin_cambios',
        operacion: sinCambios.operacion
      });
    }
    return Object.freeze({
      accion: 'requiere_recarga_forzada',
      operacion,
      reconciliacion
    });
  }

  async obtenerEstadoRecuperacion(generacionDns) {
    const operacion = await this.repositorioCoordinacion.obtenerOperacion(generacionDns);
    const reconciliacion = await this.repositorioCoordinacion.obtenerReconciliacion();
    return Object.freeze({
      operacion,
      reconciliacion,
      requiereRecargaForzada: exigeRecargaForzadaPublicacionDns(operacion, reconciliacion)
    });
  }
}
