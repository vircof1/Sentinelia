export class ControladorDesuscripcionTriggerCorreo {
  constructor({ servicioDesuscripcion }) {
    if (typeof servicioDesuscripcion?.comprobar !== 'function' ||
        typeof servicioDesuscripcion?.retirar !== 'function') {
      throw new Error('El controlador requiere el servicio de desuscripción.');
    }
    this.servicio = servicioDesuscripcion;
  }

  async mostrarConfirmacion(requisicion, respuesta) {
    try {
      await this.servicio.comprobar(requisicion.params.token);
    } catch (error) {
      informarFallo(error);
    }
    responderEndurecido(respuesta).status(200).render('correo-desuscripcion', {
      titulo: 'Dejar de recibir notificaciones',
      completada: false,
      token: requisicion.params.token
    });
  }

  async procesar(requisicion, respuesta) {
    try {
      await this.servicio.retirar(requisicion.params.token);
    } catch (error) {
      informarFallo(error);
    }
    responderEndurecido(respuesta).status(200).render('correo-desuscripcion', {
      titulo: 'Solicitud procesada',
      completada: true,
      token: null
    });
  }
}

function responderEndurecido(respuesta) {
  return respuesta
    .set('Cache-Control', 'no-store')
    .set('Pragma', 'no-cache')
    .set('Referrer-Policy', 'no-referrer')
    .set('X-Robots-Tag', 'noindex, nofollow, noarchive')
    .set('Content-Security-Policy', [
      "default-src 'none'",
      "style-src 'unsafe-inline'",
      "img-src 'self'",
      "form-action 'self'",
      "base-uri 'none'",
      "frame-ancestors 'none'"
    ].join('; '));
}

function informarFallo(error) {
  console.error('[sentinelia-web] No se pudo procesar una desuscripción de correo.');
  console.error(error);
}
