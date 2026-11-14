export class RepositorioFotografiaAdmisionTriggerCorreoSql {
  async descubrirUsuarios(triggerId, { conexion } = {}) {
    exigirConexion(conexion);
    const [filas] = await conexion.execute(`
      SELECT DISTINCT usuario_id
        FROM destinatarios_triggers_correo
       WHERE trigger_id = ? AND usuario_id IS NOT NULL
       ORDER BY usuario_id ASC
    `, [id(triggerId)]);
    return Object.freeze(filas.map((fila) => Number(fila.usuario_id)));
  }

  async bloquearUsuarios(idsUsuario, { conexion } = {}) {
    exigirConexion(conexion);
    const ids = [...new Set(idsUsuario.map(id))].sort((a, b) => a - b);
    if (ids.length === 0) return Object.freeze([]);
    const [filas] = await conexion.execute(`
      SELECT id, usuario, nombre_mostrar, nombre_completo,
             activo, email, email_validado, tenant_id, empresa_id, sitio_id
        FROM usuarios
       WHERE id IN (${ids.map(() => '?').join(', ')})
       ORDER BY id ASC
       FOR UPDATE
    `, ids);
    return congelarFilas(filas);
  }

  async bloquearTrigger(triggerId, { conexion } = {}) {
    exigirConexion(conexion);
    const [filas] = await conexion.execute(`
      SELECT id, nombre, tipo, activo, configuracion, revision_declaracion,
             tenant_id, empresa_id, sitio_id
        FROM triggers
       WHERE id = ?
       LIMIT 1
       FOR UPDATE
    `, [id(triggerId)]);
    return fila(filas[0]);
  }

  async bloquearAsignacion(asignacionId, { conexion } = {}) {
    exigirConexion(conexion);
    const [filas] = await conexion.execute(`
      SELECT id, monitor_id, trigger_id, activo, orden_ejecucion,
             eventos_disparo, configuracion_override
        FROM asignaciones_triggers_monitores
       WHERE id = ?
       LIMIT 1
       FOR UPDATE
    `, [id(asignacionId)]);
    return fila(filas[0]);
  }

  async bloquearAudiencia(triggerId, { conexion } = {}) {
    exigirConexion(conexion);
    const [filas] = await conexion.execute(`
      SELECT *
        FROM destinatarios_triggers_correo
       WHERE trigger_id = ?
       ORDER BY id ASC
       FOR UPDATE
    `, [id(triggerId)]);
    return congelarFilas(filas);
  }
}

function congelarFilas(filas) {
  return Object.freeze(filas.map((entrada) => fila(entrada)));
}

function fila(entrada) {
  return entrada ? Object.freeze({ ...entrada }) : null;
}

function exigirConexion(conexion) {
  if (typeof conexion?.execute !== 'function') {
    throw new Error('La fotografía de admisión exige conexión SQL prestada.');
  }
}

function id(valor) {
  const numero = Number(valor);
  if (!Number.isSafeInteger(numero) || numero < 1) {
    throw new Error('La identidad de admisión no es válida.');
  }
  return numero;
}
