import { timingSafeEqual } from 'node:crypto';

export function crearMiddlewareValidarCsrfPortal() {
  return function validarCsrfPortal(requisicion, respuesta, next) {
    if (String(requisicion.method || '').toUpperCase() !== 'POST') {
      next();
      return;
    }

    const tokenSesion = normalizarToken(
      requisicion.session?.usuarioAutenticado?.tokenCSRF ||
      requisicion.session?.tokenCSRF
    );
    const tokenRecibido = normalizarToken(
      requisicion.get('x-csrf-token') ||
      requisicion.body?._csrf ||
      requisicion.body?.tokenCSRF
    );

    if (!tokenSesion || !tokenRecibido || !compararTokens(tokenSesion, tokenRecibido)) {
      if (esperaJson(requisicion)) {
        respuesta.status(403).json({
          ok: false,
          codigo: 'csrf_invalido',
          mensaje: 'Token CSRF inválido o ausente.'
        });
        return;
      }

      respuesta.status(403).type('text/plain; charset=utf-8').send(
        'Token CSRF inválido o ausente.'
      );
      return;
    }

    next();
  };
}

function normalizarToken(valor) {
  if (typeof valor !== 'string') {
    return null;
  }

  const token = valor.trim();
  return token.length > 0 ? token : null;
}

function compararTokens(esperado, recibido) {
  const esperadoBuffer = Buffer.from(esperado, 'utf8');
  const recibidoBuffer = Buffer.from(recibido, 'utf8');

  if (esperadoBuffer.length !== recibidoBuffer.length) {
    return false;
  }

  return timingSafeEqual(esperadoBuffer, recibidoBuffer);
}

function esperaJson(requisicion) {
  const requestedWith = String(
    requisicion.get('x-requested-with') || ''
  ).trim().toLowerCase();
  const accept = String(requisicion.get('accept') || '').trim().toLowerCase();

  return (
    requestedWith === 'xmlhttprequest' ||
    accept.includes('application/json')
  );
}
