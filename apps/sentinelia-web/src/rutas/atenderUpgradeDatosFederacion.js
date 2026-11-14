import { PREFIJO_RUTAS_DATOS_FEDERACION } from './crearRutasDatosFederacion.js';

export function atenderUpgradeDatosFederacion(requisicion, socket) {
  if (!esRutaDatosFederacion(requisicion?.url)) return false;
  if (typeof socket?.end !== 'function') {
    throw new Error('El rechazo de upgrade federado requiere un socket HTTP.');
  }
  socket.end([
    'HTTP/1.1 404 Not Found',
    'Connection: close',
    'Cache-Control: no-store',
    'Content-Length: 0',
    '\r\n'
  ].join('\r\n'));
  return true;
}

function esRutaDatosFederacion(urlBruta) {
  let pathname;
  try {
    pathname = new URL(String(urlBruta || '/'), 'http://localhost').pathname;
  } catch {
    return false;
  }
  return pathname === PREFIJO_RUTAS_DATOS_FEDERACION ||
    pathname.startsWith(`${PREFIJO_RUTAS_DATOS_FEDERACION}/`);
}
