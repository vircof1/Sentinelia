export function crearMiddlewareCargarContextoUsuario({
  servicioContextoUsuario,
  servicioSesion,
  servicioAutorizacion = null
}) {
  return async function cargarContextoUsuario(requisicion, respuesta, next) {
    try {
      const contextoUsuarioActual =
        await servicioContextoUsuario.cargarDesdeSesion(requisicion);

      if (!contextoUsuarioActual) {
        await servicioSesion.destruirSesion(requisicion);
        if (esperaJson(requisicion)) {
          respuesta.status(401).json({
            ok: false,
            codigo: 'sesion_no_vigente',
            mensaje: 'La sesión ya no tiene un usuario válido.'
          });
          return;
        }

        respuesta.redirect('/login');
        return;
      }

      requisicion.contextoUsuarioActual = contextoUsuarioActual;
      respuesta.locals.contextoUsuarioActual = contextoUsuarioActual;
      respuesta.locals.capacidadesNavegacion = construirCapacidadesNavegacion({
        servicioAutorizacion,
        contextoUsuarioActual
      });
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function construirCapacidadesNavegacion({
  servicioAutorizacion,
  contextoUsuarioActual
} = {}) {
  const organizacion = Object.freeze({
    administrarTenants: Boolean(
      servicioAutorizacion?.puedeAdministrarTenants?.(contextoUsuarioActual)
    ),
    administrarEmpresas: Boolean(
      servicioAutorizacion?.puedeAdministrarEmpresas?.(contextoUsuarioActual)
    ),
    administrarSitios: Boolean(
      servicioAutorizacion?.puedeAdministrarSitios?.(contextoUsuarioActual)
    )
  });

  return Object.freeze({
    organizacion: Object.freeze({
      ...organizacion,
      visible: Object.values(organizacion).some(Boolean)
    })
  });
}

function esperaJson(requisicion) {
  return (
    requisicion.path.includes('/api/') ||
    String(requisicion.get('x-requested-with') || '').toLowerCase() ===
      'xmlhttprequest' ||
    String(requisicion.get('accept') || '').includes('application/json')
  );
}
