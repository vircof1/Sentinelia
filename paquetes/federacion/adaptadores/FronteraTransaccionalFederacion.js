import { setTimeout as esperar } from 'node:timers/promises';
import { FronteraTransaccionalLocal }
  from '../../persistencia-sql/src/FronteraTransaccionalLocal.js';

export const MENSAJE_CONCURRENCIA_FEDERACION =
  'La operación coincidió con otra tarea y no pudo completarse. ' +
  'Espera unos segundos y vuelve a intentarlo. Después, revisa el estado de los flujos.';

export function esDeadlockFederacion(error) {
  return error?.code === 'ER_LOCK_DEADLOCK' || error?.errno === 1213;
}

export function mensajeErrorOperacionFederacion(error) {
  return esDeadlockFederacion(error) || error?.codigo === 'CONCURRENCIA_FEDERACION_AGOTADA'
    ? MENSAJE_CONCURRENCIA_FEDERACION
    : error.message;
}

// Solo para trabajo SQL local repetible. Nunca envolver llamadas HTTP o efectos externos.
export class FronteraTransaccionalFederacion {
  constructor(clienteSql, { maxIntentos = 3, pausa = esperar } = {}) {
    if (!Number.isSafeInteger(maxIntentos) || maxIntentos < 1 || maxIntentos > 5) {
      throw new TypeError('maxIntentos debe estar entre 1 y 5.');
    }
    if (typeof pausa !== 'function') throw new TypeError('pausa debe ser una función.');
    this.frontera = new FronteraTransaccionalLocal(clienteSql);
    this.maxIntentos = maxIntentos;
    this.pausa = pausa;
  }

  async ejecutar(trabajo) {
    for (let intento = 1; ; intento += 1) {
      try {
        return await this.frontera.ejecutar(trabajo);
      } catch (error) {
        if (!esDeadlockFederacion(error)) throw error;
        if (intento === this.maxIntentos) {
          const conflicto = new Error(MENSAJE_CONCURRENCIA_FEDERACION, { cause: error });
          conflicto.codigo = 'CONCURRENCIA_FEDERACION_AGOTADA';
          conflicto.statusCode = 409;
          throw conflicto;
        }
        // La frontera ya hizo rollback y liberó la conexión antes de esperar.
        await this.pausa(25 * intento + Math.floor(Math.random() * 25));
      }
    }
  }
}
