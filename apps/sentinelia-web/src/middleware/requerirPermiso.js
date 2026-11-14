export function crearMiddlewareRequerirPermiso({
  servicioAutorizacion,
  permiso
}) {
  return function requerirPermiso(requisicion, respuesta, next) {
    const contextoUsuarioActual = requisicion.contextoUsuarioActual;

    if (servicioAutorizacion.resolverPermiso(permisoNormalizado(permiso), contextoUsuarioActual)) {
      next();
      return;
    }

    if (esperaJson(requisicion)) {
      respuesta.status(403).json({
        ok: false,
        mensaje: `No tienes permiso para ${permiso}.`
      });
      return;
    }

    respuesta.status(403).render('portal/forbidden', {
      titulo: 'Acceso denegado',
      permisoSolicitado: permiso,
      usuarioActual: requisicion.session?.usuarioAutenticado ?? null
    });
  };
}

function permisoNormalizado(permiso) {
  return String(permiso || '').trim();
}

function esperaJson(requisicion) {
  return (
    requisicion.path.includes('/api/') ||
    String(requisicion.get('x-requested-with') || '').toLowerCase() ===
      'xmlhttprequest' ||
    String(requisicion.get('accept') || '').includes('application/json')
  );
}
