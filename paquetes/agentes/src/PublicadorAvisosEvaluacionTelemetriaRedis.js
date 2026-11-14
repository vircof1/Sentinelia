const TIPO_AVISO = 'trabajos_evaluacion_telemetria_pendientes';

export class PublicadorAvisosEvaluacionTelemetriaRedis {
  constructor({
    clienteRedis,
    canal = 'sentinelia:runtime:telemetria:evaluacion:pendiente',
    reloj = () => new Date()
  } = {}) {
    if (!clienteRedis || typeof clienteRedis.publish !== 'function') {
      throw new Error('El cliente Redis de avisos de evaluación es obligatorio.');
    }

    this.clienteRedis = clienteRedis;
    this.canal = String(canal || '').trim();
    this.reloj = reloj;

    if (!this.canal) {
      throw new Error('El canal Redis de avisos de evaluación es obligatorio.');
    }
  }

  async publicarTrabajosPendientes({ totalTrabajos } = {}) {
    const total = Number(totalTrabajos);
    if (!Number.isInteger(total) || total <= 0) {
      return { publicado: false, receptores: 0 };
    }

    const receptores = await this.clienteRedis.publish(
      this.canal,
      JSON.stringify({
        tipo: TIPO_AVISO,
        totalTrabajos: total,
        publicadoEnUtc: this.reloj().toISOString()
      })
    );

    return {
      publicado: true,
      receptores: Number(receptores || 0)
    };
  }
}
