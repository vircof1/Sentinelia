const TIPO_AVISO = 'trabajos_evaluacion_telemetria_pendientes';

export class SuscriptorAvisosEvaluacionTelemetriaRedis {
  constructor({ clienteRedis, canal, onAviso } = {}) {
    if (!clienteRedis || typeof clienteRedis.duplicate !== 'function') {
      throw new Error('El suscriptor requiere un cliente Redis duplicable.');
    }
    if (typeof onAviso !== 'function') {
      throw new Error('El suscriptor requiere una acción de despertar al Runtime.');
    }

    this.clienteRedis = clienteRedis;
    this.canal = String(canal || '').trim();
    this.onAviso = onAviso;
    if (!this.canal) {
      throw new Error('El canal Redis de evaluación es obligatorio.');
    }
    this.clienteSuscriptor = null;
    this.totalAvisos = 0;
    this.ultimoAvisoEnUtc = null;
    this.avisosEnCurso = new Set();
  }

  async arrancar() {
    if (this.clienteSuscriptor) {
      return this.serializarResumen();
    }

    const cliente = this.clienteRedis.duplicate();
    cliente.on('error', (error) => {
      console.error('[sentinelia-runtime] Error en suscriptor Redis de telemetría');
      console.error(error);
    });
    try {
      await cliente.connect();
      await cliente.subscribe(this.canal, (mensaje) => this.recibirAviso(mensaje));
      this.clienteSuscriptor = cliente;
      return this.serializarResumen();
    } catch (error) {
      if (cliente.isOpen) {
        await cliente.quit();
      }
      throw error;
    }
  }

  recibirAviso(mensaje) {
    let aviso;
    try {
      aviso = JSON.parse(mensaje);
    } catch (_error) {
      return;
    }
    if (aviso?.tipo !== TIPO_AVISO || Number(aviso?.totalTrabajos || 0) <= 0) {
      return;
    }

    this.totalAvisos += 1;
    this.ultimoAvisoEnUtc = new Date().toISOString();
    const ejecucion = Promise.resolve(this.onAviso(aviso))
      .catch((error) => {
        console.error('[sentinelia-runtime] Error despertando evaluación de telemetría');
        console.error(error);
      })
      .finally(() => this.avisosEnCurso.delete(ejecucion));
    this.avisosEnCurso.add(ejecucion);
  }

  async detener() {
    if (!this.clienteSuscriptor) {
      return this.serializarResumen();
    }

    const cliente = this.clienteSuscriptor;
    this.clienteSuscriptor = null;
    await cliente.unsubscribe(this.canal);
    if (this.avisosEnCurso.size > 0) {
      await Promise.allSettled([...this.avisosEnCurso]);
    }
    await cliente.quit();
    return this.serializarResumen();
  }

  serializarResumen() {
    return {
      activo: Boolean(this.clienteSuscriptor),
      canal: this.canal,
      totalAvisos: this.totalAvisos,
      ultimoAvisoEnUtc: this.ultimoAvisoEnUtc
    };
  }
}
