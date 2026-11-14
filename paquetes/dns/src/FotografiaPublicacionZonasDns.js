import { createHash } from 'node:crypto';

// Incluye también zonas sin registros y zonas excluidas; el manifiesto de
// diagnóstico por registro no puede representar ninguno de esos dos casos.
export function fotografiarPublicacionZonasDns(catalogo, renderizada) {
  const porId = new Map((renderizada.zonasPublicacion || []).map((zona) => [String(zona.id), zona]));
  return normalizarFotografiaZonasDns((catalogo.zonas || []).map((zona) => {
    const publicada = porId.get(String(zona.id));
    if (zona.estaActivaPublicableEnBind() && !publicada) {
      throw new Error('La fotografía DNS no contiene una zona publicable.');
    }
    return {
      id: String(zona.id), versionModelo: String(zona.versionModelo),
      hashContenido: publicada ? createHash('sha256').update(publicada.contenido).digest('hex') : null
    };
  }));
}

export function normalizarFotografiaZonasDns(valor) {
  // Las operaciones anteriores a esta versión no tienen esta fotografía.
  if (valor == null) return null;
  if (!Array.isArray(valor)) throw new Error('La fotografía de zonas DNS debe ser una lista.');
  const ids = new Set();
  return Object.freeze(valor.map((zona) => {
    const id = String(zona?.id ?? '');
    const versionModelo = String(zona?.versionModelo ?? '');
    if (!/^[1-9][0-9]*$/.test(id) || !/^[1-9][0-9]*$/.test(versionModelo) || ids.has(id)) {
      throw new Error('La fotografía de zonas DNS contiene una identidad o versión no válida.');
    }
    ids.add(id);
    if (zona.hashContenido !== null && !/^[a-f0-9]{64}$/.test(zona.hashContenido || '')) {
      throw new Error('La huella de una zona DNS no es válida.');
    }
    return Object.freeze({ id, versionModelo, hashContenido: zona.hashContenido });
  }));
}

export async function consolidarPublicacionZonasDns({ conexion, operacion }) {
  const zonas = normalizarFotografiaZonasDns(operacion.fotografiaZonas);
  if (!zonas) return; // Recuperación compatible de generaciones antiguas.
  if (!operacion.recargaConfirmadaEnUtc) throw new Error('No se puede aplicar una zona sin recarga confirmada.');
  for (const zona of zonas) {
    // Se guarda la versión fotografiada, NO la versión actual: una mutación
    // concurrente debe seguir pendiente. Una consolidación vieja no retrocede
    // la generación aplicada, ni resucita una zona que haya sido eliminada.
    await conexion.execute(`UPDATE zonas_dns SET
      generacion_aplicada_bind = ?, version_aplicada_bind = ?,
      hash_publicacion_vigente = ?,
      fecha_ultima_publicacion_exitosa = IF(? IS NOT NULL, ?, fecha_ultima_publicacion_exitosa),
      estado_publicacion = IF(version_modelo = ?, IF(? IS NULL, 'excluida', 'publicado'), 'pendiente'),
      fecha_ultimo_error_publicacion = NULL, detalle_ultimo_error_publicacion = NULL
      WHERE id = ? AND (generacion_aplicada_bind IS NULL OR generacion_aplicada_bind <= ?)`,
    [operacion.generacionDns, zona.versionModelo, zona.hashContenido,
      zona.hashContenido, operacion.recargaConfirmadaEnUtc, zona.versionModelo, zona.hashContenido,
      zona.id, operacion.generacionDns]);
  }
}
