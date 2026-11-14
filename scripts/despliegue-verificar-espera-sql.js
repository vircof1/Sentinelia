import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import net from 'node:net';
import { setTimeout as esperar } from 'node:timers/promises';
import { esperarSqlDisponible } from '../despliegue/docker/node-bind/esperar-sql-disponible.mjs';
import { obtenerConfiguracionAplicacion } from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

const configuracion = obtenerConfiguracionAplicacion().sql;
assert.equal(configuracion.estaCompleta, true, 'La verificación necesita MariaDB real.');

// El probe debe admitir un bootstrap cuya base todavía no se ha creado.
await esperarSqlDisponible({
  ...configuracion, baseDatos: 'sentinelia_base_que_no_existe_' + randomBytes(6).toString('hex')
});
await assert.rejects(esperarSqlDisponible({
  ...configuracion, password: randomBytes(32).toString('hex')
}), (error) => error.code === 'ER_ACCESS_DENIED_ERROR');

const conexiones = new Set();
const proxy = net.createServer((cliente) => {
  const destino = net.connect({ host: configuracion.host, port: configuracion.puerto });
  for (const socket of [cliente, destino]) {
    conexiones.add(socket);
    socket.on('close', () => conexiones.delete(socket));
    socket.on('error', () => { cliente.destroy(); destino.destroy(); });
  }
  cliente.pipe(destino).pipe(cliente);
});
await escuchar();
const puerto = proxy.address().port;
await cerrar();

await assert.rejects(esperarSqlDisponible({
  ...configuracion, host: '127.0.0.1', puerto
}, { tiempoMaximoMs: 100, intervaloMs: 10 }),
(error) => error.code === 'SQL_ARRANQUE_TIMEOUT');

try {
  await Promise.all([
    esperarSqlDisponible({ ...configuracion, host: '127.0.0.1', puerto }, {
      tiempoMaximoMs: 5000, intervaloMs: 25
    }),
    esperar(150).then(() => escuchar(puerto))
  ]);
} finally {
  for (const socket of conexiones) socket.destroy();
  if (proxy.listening) await cerrar();
}

console.log('[gate:despliegue:arranque] OK: SQL tardío recuperado, espera acotada, credenciales inválidas rechazadas y base ausente admitida para bootstrap.');

function escuchar(puerto = 0) {
  return new Promise((resolve, reject) => {
    proxy.once('error', reject);
    proxy.listen(puerto, '127.0.0.1', () => {
      proxy.removeListener('error', reject);
      resolve();
    });
  });
}

function cerrar() {
  return new Promise((resolve, reject) => proxy.close((error) =>
    error ? reject(error) : resolve()));
}
