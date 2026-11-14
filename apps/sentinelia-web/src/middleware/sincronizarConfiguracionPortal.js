export function crearMiddlewareSincronizarConfiguracionPortal({
  servicioConfiguracionPortal
}) {
  return async function sincronizarConfiguracionPortal(
    requisicion,
    respuesta,
    next
  ) {
    try {
      const configuracionPortal =
        await servicioConfiguracionPortal.asegurarActualizada();
      const nombrePortalVisible =
        configuracionPortal.obtenerNombreVisiblePortal();

      requisicion.configuracionPortalActual = configuracionPortal;
      respuesta.locals.configuracionPortalActual = configuracionPortal;
      respuesta.locals.nombrePortalVisible = nombrePortalVisible;
      next();
    } catch (error) {
      next(error);
    }
  };
}
