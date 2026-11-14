export function crearMiddlewareRequerirCapacidadEliminacionAdministrativaAgentes({
  habilitada = false
} = {}) {
  return function requerirCapacidadEliminacionAdministrativaAgentes(
    _requisicion,
    respuesta,
    next
  ) {
    if (habilitada === true) {
      next();
      return;
    }

    respuesta
      .status(404)
      .set('Cache-Control', 'no-store')
      .json({
        ok: false,
        codigo: 'recurso_no_encontrado',
        mensaje: 'El recurso solicitado no está disponible.'
      });
  };
}
