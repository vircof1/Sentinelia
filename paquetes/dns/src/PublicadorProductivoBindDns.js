import { RecargaBindNoObservada } from './ServicioControlRecargaBindDns.js';

export class PublicadorProductivoBindDns {
  constructor({
    publicadorCoordinado,
    servicioRecarga,
    servicioConsolidacion,
    servicioRecuperacion
  } = {}) {
    if (!publicadorCoordinado?.publicarSiguiente ||
        !servicioRecarga?.observarRecarga ||
        !servicioConsolidacion?.confirmarAplicada ||
        !servicioRecuperacion?.resolverOperacionReclamada) {
      throw new Error(
        'La publicación productiva BIND requiere activación, recarga y consolidación coordinadas.'
      );
    }
    this.publicadorCoordinado = publicadorCoordinado;
    this.servicioRecarga = servicioRecarga;
    this.servicioConsolidacion = servicioConsolidacion;
    this.servicioRecuperacion = servicioRecuperacion;
  }

  async publicarSiguiente(opciones = {}) {
    const activada = await this.publicadorCoordinado.publicarSiguiente(opciones);
    if (!activada?.ok) return activada;
    if (activada.omitida && activada.motivo === 'recarga_ya_confirmada') {
      const recuperacion = await this.servicioRecuperacion.resolverOperacionReclamada({
        lease: activada.lease,
        operacion: activada.operacion,
        resultado: activada.operacion.resultado
      });
      return Object.freeze({
        ...activada,
        ok: true,
        omitida: false,
        adoptada: true,
        operacion: recuperacion.operacion,
        recuperacion
      });
    }
    if (activada.omitida) return activada;

    try {
      const resultado = construirResultado(activada);
      const recarga = await this.servicioRecarga.observarRecarga({
        lease: activada.lease,
        operacion: activada.operacion,
        fotografia: activada.fotografia,
        resultado
      });
      const consolidacion = await this.servicioConsolidacion.confirmarAplicada({
        lease: activada.lease,
        operacion: recarga.operacion,
        resultado
      });
      return Object.freeze({
        ...activada,
        operacion: consolidacion.operacion,
        recarga,
        consolidacion
      });
    } catch (error) {
      if (!(error instanceof RecargaBindNoObservada)) throw error;
      return Object.freeze({
        ...activada,
        ok: false,
        recuperable: true,
        motivo: error.codigo,
        diagnostico: Object.freeze({
          codigo: error.codigo,
          mensaje: error.message
        })
      });
    }
  }
}

function construirResultado(activada) {
  return Object.freeze({
    ...activada.resumen,
    diagnostico: activada.fotografia?.proyeccion?.manifiesto?.diagnostico || null
  });
}
