const CODIGOS_CONFLICTO = new Set([
  'contrato_lote_incompatible',
  'lote_composicion_incompatible',
  'relacion_recepcion_no_operativa',
  'familia_no_admitida_actualmente',
  'version_familia_no_admitida_actualmente',
  'cursor_generacion_incompatible',
  'selector_revision_efectiva_desconocido'
]);

export function responderErrorDatosFederacion(error, requisicion, respuesta) {
  const problema = clasificar(error, requisicion);
  if (problema.statusCode >= 500 &&
      error?.codigo !== 'RECEPCION_FEDERACION_NO_PREPARADA') {
    console.error(
      `[sentinelia-web] Fallo interno en datos federados (${error?.name || 'Error'}).`
    );
  }
  const cuerpo = {
    ok: false,
    codigo: problema.codigo,
    mensaje: problema.mensaje
  };
  if (problema.statusCode === 413 && problema.capacidad) {
    cuerpo.capacidad = problema.capacidad;
  }
  return respuesta
    .status(problema.statusCode)
    .type('application/problem+json')
    .set('Cache-Control', 'no-store')
    .json(cuerpo);
}

function clasificar(error, requisicion) {
  if (error?.codigo === 'RECEPCION_FEDERACION_NO_PREPARADA') {
    return problema(
      503,
      'RECEPCION_FEDERACION_NO_PREPARADA',
      'La recepción federada no está preparada en esta instalación.'
    );
  }
  if (error?.codigo === 'FEDERACION_DESACTIVADA') {
    return problema(
      503,
      'FEDERACION_DESACTIVADA',
      'La federación está desactivada por la configuración vigente del receptor.'
    );
  }
  if (error?.type === 'entity.too.large' &&
      /\/disponibilidad(?:\?|$)/u.test(String(requisicion?.originalUrl || requisicion?.url || ''))) {
    return problema(413, 'DISPONIBILIDAD_FEDERADA_EXCEDE_LIMITE',
      'La declaración de disponibilidad supera el límite físico del receptor.');
  }
  if (error?.codigo === 'lote_excede_limites' ||
      error?.type === 'entity.too.large') {
    return problema(413, 'lote_excede_limites',
      'El lote supera los límites vigentes del receptor.',
      error?.capacidad || requisicion?.capacidadRecepcionFederacion?.aplicada);
  }
  if (error?.type === 'entity.parse.failed' ||
      error?.type === 'encoding.unsupported') {
    return problema(400, 'PETICION_JSON_INVALIDA',
      'El cuerpo de la petición no es JSON válido.');
  }
  if (Number.isInteger(error?.statusCode) && error.statusCode < 500) {
    return problema(error.statusCode, codigoPublico(error), mensajePublico(error.statusCode));
  }
  if (error?.name === 'ErrorDisponibilidadFederacion') {
    return problema(400, 'DISPONIBILIDAD_FEDERADA_INVALIDA',
      'La declaración de disponibilidad no es válida.');
  }
  if (error?.name === 'ErrorLoteRecepcionFederacion' ||
      error?.name === 'ErrorIdentidadFederada') {
    return problema(400, 'LOTE_FEDERADO_INVALIDO',
      'La representación del lote federado no es válida.');
  }
  if (CODIGOS_CONFLICTO.has(error?.codigo) ||
      error?.name === 'ErrorCursorRecepcionFederacion' ||
      error?.name === 'ErrorEntregasFederacion' ||
      error?.name === 'ErrorDisponibilidadFederacionSql') {
    return problema(409, 'CONFLICTO_DATOS_FEDERADOS',
      'La operación entra en conflicto con el estado durable vigente.');
  }
  return problema(503, 'DATOS_FEDERADOS_NO_DISPONIBLES',
    'El receptor federado no está disponible temporalmente.');
}

function codigoPublico(error) {
  return /^[A-Za-z][A-Za-z0-9_]{0,95}$/u.test(String(error?.codigo || ''))
    ? error.codigo
    : 'PETICION_FEDERADA_RECHAZADA';
}

function mensajePublico(statusCode) {
  if (statusCode === 401) return 'La credencial federada es obligatoria.';
  if (statusCode === 403) return 'La sesión o el canal no autorizan esta operación.';
  if (statusCode === 404) return 'No existe progreso receptor para esa generación.';
  if (statusCode === 409) return 'La operación entra en conflicto con el estado vigente.';
  return 'La petición federada no es válida.';
}

function problema(statusCode, codigo, mensaje, capacidad = null) {
  return { statusCode, codigo, mensaje, capacidad };
}
