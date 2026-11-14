// La misma expresión sirve para leer y filtrar: nunca se filtra por el estado
// legado mientras se presenta al usuario el estado coordinado.
export function expresionEstadoPublicacionZonaDns(alias = 'z') {
  if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(alias)) throw new Error('Alias DNS no válido.');
  return `CASE
    WHEN (${alias}.activo = 0 OR ${alias}.publicar_en_bind = 0)
      AND ${alias}.hash_publicacion_vigente IS NULL THEN 'excluida'
    WHEN ${alias}.activo = 1 AND ${alias}.publicar_en_bind = 1
      AND ${alias}.version_aplicada_bind = ${alias}.version_modelo
      AND ${alias}.hash_publicacion_vigente IS NOT NULL THEN 'publicado'
    WHEN ${alias}.generacion_aplicada_bind IS NULL
      AND NOT EXISTS (SELECT 1 FROM operaciones_publicacion_dns)
      THEN ${alias}.estado_publicacion
    WHEN ${alias}.estado_publicacion = 'error' OR EXISTS (
      SELECT 1 FROM operaciones_publicacion_dns op
      JOIN cabecera_generacion_dns cab ON cab.id = 1
        AND op.generacion_dns = cab.ultima_generacion_dns
      WHERE op.estado IN ('fallida', 'recuperacion_bloqueada')
    ) THEN 'error'
    ELSE 'pendiente' END`;
}

export function describirPublicacionZonaDns(zona) {
  if (zona.estadoPublicacion === 'publicado') return 'Configuración actual aplicada en BIND.';
  if (zona.estadoPublicacion === 'excluida') return zona.activo
    ? 'Zona reservada: no se publica en BIND.'
    : 'Zona inactiva: no se publica en BIND.';
  const anterior = zona.hashPublicacionVigente
    ? (zona.versionAplicadaBind
        ? ` Última versión confirmada: v${zona.versionAplicadaBind}.`
        : ' Hay una publicación anterior confirmada.') : '';
  if (zona.estadoPublicacion === 'error') return 'No se pudieron aplicar los cambios en BIND.' + anterior;
  if (!zona.activo || !zona.publicarEnBind) return 'Retirada de BIND pendiente de confirmación.' + anterior;
  return 'Cambios pendientes de aplicar en BIND.' + anterior;
}

export function etiquetarPublicacionZonaDns(estado) {
  return { publicado: 'Publicada', pendiente: 'Pendiente de aplicar',
    error: 'Error al aplicar', excluida: 'Sin publicación BIND' }[estado] || estado;
}
