import mysql from 'mysql2/promise';
import { setTimeout as esperar } from 'node:timers/promises';

const ERRORES_TRANSITORIOS = new Set([
  'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND',
  'PROTOCOL_CONNECTION_LOST', 'ER_SERVER_SHUTDOWN'
]);

export async function esperarSqlDisponible(configuracion, {
  tiempoMaximoMs = 60_000,
  intervaloMs = 500
} = {}) {
  const limite = Date.now() + tiempoMaximoMs;
  let esperaAnunciada = false;
  while (true) {
    let conexion;
    try {
      // Sin seleccionar una base: el bootstrap puede necesitar crearla.
      conexion = await mysql.createConnection({
        host: configuracion.host,
        port: configuracion.puerto,
        user: configuracion.usuario,
        password: configuracion.password,
        connectTimeout: Math.max(1, Math.min(1000, limite - Date.now()))
      });
      await conexion.query({ sql: 'SELECT 1', timeout: 1000 });
      if (esperaAnunciada) console.log('[sentinelia-supervisor] SQL disponible.');
      return;
    } catch (error) {
      if (!ERRORES_TRANSITORIOS.has(error?.code)) throw error;
      if (Date.now() >= limite) {
        throw Object.assign(new Error('SQL no estuvo disponible dentro del plazo de arranque.'), {
          code: 'SQL_ARRANQUE_TIMEOUT'
        });
      }
      if (!esperaAnunciada) {
        console.log('[sentinelia-supervisor] Esperando disponibilidad de SQL antes de migrar.');
        esperaAnunciada = true;
      }
    } finally {
      await conexion?.end().catch(() => {});
    }
    await esperar(Math.min(intervaloMs, Math.max(0, limite - Date.now())));
  }
}
