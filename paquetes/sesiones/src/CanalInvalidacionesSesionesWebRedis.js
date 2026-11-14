import { validarUuidV7Auditoria } from '../../auditoria/src/UuidV7Auditoria.js';

export class CanalInvalidacionesSesionesWebRedis {
  constructor({ clienteRedis, canal = 'sentinelia:sesiones:v2:invalidaciones' } = {}) {
    if (!clienteRedis?.publish || !clienteRedis?.duplicate) {
      throw new Error('El canal de invalidaciones requiere Redis con pub/sub.');
    }
    this.clienteRedis = clienteRedis;
    this.canal = canal;
    this.suscriptor = null;
  }

  async publicar(idsSesionAuditoria) {
    const ids = [...new Set(idsSesionAuditoria)].sort();
    ids.forEach((id) => validarUuidV7Auditoria(id, 'sesionAuditoriaId'));
    if (ids.length === 0) return 0;
    return this.clienteRedis.publish(this.canal, JSON.stringify({
      version: 1,
      idsSesionAuditoria: ids
    }));
  }

  async suscribir(onInvalidacion) {
    if (this.suscriptor) throw new Error('El canal ya está suscrito en esta instancia.');
    if (typeof onInvalidacion !== 'function') throw new Error('Falta el receptor de invalidaciones.');
    const suscriptor = this.clienteRedis.duplicate();
    suscriptor.on('error', (error) => {
      console.error('[sesiones-web] Error del canal de invalidaciones');
      console.error(error);
    });
    await suscriptor.connect();
    await suscriptor.subscribe(this.canal, async (mensaje) => {
      try {
        const datos = JSON.parse(mensaje);
        if (datos.version !== 1 || !Array.isArray(datos.idsSesionAuditoria)) return;
        datos.idsSesionAuditoria.forEach((id) => validarUuidV7Auditoria(id));
        await onInvalidacion(Object.freeze([...new Set(datos.idsSesionAuditoria)]));
      } catch (error) {
        console.error('[sesiones-web] Invalidación Redis descartada por contrato inválido');
        console.error(error);
      }
    });
    this.suscriptor = suscriptor;
  }

  async cerrar() {
    if (!this.suscriptor) return;
    await this.suscriptor.unsubscribe(this.canal);
    await this.suscriptor.quit();
    this.suscriptor = null;
  }
}
