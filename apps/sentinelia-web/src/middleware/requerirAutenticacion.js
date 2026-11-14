export function crearMiddlewareRequerirAutenticacion({ servicioSesion }) {
  return async function requerirAutenticacion(requisicion, respuesta, next) {
    try {
      if (!requisicion.session?.usuarioAutenticado) {
        if (esperaJson(requisicion)) {
          respuesta.status(401).json({
            ok: false,
            codigo: 'sesion_requerida',
            mensaje: 'La sesión no está autenticada.'
          });
          return;
        }

        respuesta.redirect('/login');
        return;
      }

      const sesionVigente = await servicioSesion.validarVersionSesion(requisicion);

      if (!sesionVigente) {
        await servicioSesion.destruirSesion(requisicion);
        if (esperaJson(requisicion)) {
          respuesta.status(401).json({
            ok: false,
            codigo: 'sesion_no_vigente',
            mensaje: 'La sesión ya no es válida. Vuelve a iniciar sesión.'
          });
          return;
        }

        respuesta.redirect('/login');
        return;
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}

function esperaJson(requisicion) {
  return (
    requisicion.path.includes('/api/') ||
    String(requisicion.get('x-requested-with') || '').toLowerCase() ===
      'xmlhttprequest' ||
    String(requisicion.get('accept') || '').includes('application/json')
  );
}
