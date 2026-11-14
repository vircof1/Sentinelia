export class RepositorioAdministracionTriggerCorreoSql {
  constructor(clienteSql = null) {
    this.clienteSql = clienteSql;
  }

  async resumir(triggerId, { conexion = null } = {}) {
    const ejecutor = conexion || this.clienteSql;
    const metodo = conexion ? 'execute' : 'consultar';
    if (typeof ejecutor?.[metodo] !== 'function') {
      throw new Error('La administración de correo requiere persistencia SQL.');
    }
    const resultado = await ejecutor[metodo](`
      SELECT
        (SELECT COUNT(*) FROM destinatarios_triggers_correo d
          WHERE d.trigger_id=t.id) AS relaciones_total,
        (SELECT COUNT(*) FROM destinatarios_triggers_correo d
          WHERE d.trigger_id=t.id AND d.estado_participacion='activa')
          AS relaciones_activas,
        (SELECT COUNT(*) FROM destinatarios_triggers_correo d
          LEFT JOIN usuarios u ON u.id=d.usuario_id
          WHERE d.trigger_id=t.id AND d.estado_participacion='activa'
            AND (d.tipo='manual' OR
              (u.id IS NOT NULL AND u.activo=1 AND u.email_validado=1
               AND NULLIF(TRIM(u.email),'') IS NOT NULL)))
          AS relaciones_entregables,
        (SELECT COUNT(*) FROM asignaciones_triggers_monitores a
          WHERE a.trigger_id=t.id) AS vinculos_total,
        (SELECT COUNT(*) FROM asignaciones_triggers_monitores a
          WHERE a.trigger_id=t.id AND a.activo=1) AS vinculos_activos,
        (SELECT COUNT(*) FROM cola_correos_salida s
          WHERE s.origen_tipo='trigger' AND s.ejecucion_trigger_id IN
            (SELECT e.id FROM ejecuciones_triggers e WHERE e.trigger_id=t.id)
            AND s.estado IN ('pendiente','error_reintentable','reclamada','enviando'))
          AS backlog_aceptado,
        (SELECT s.estado FROM cola_correos_salida s
          WHERE s.origen_tipo='trigger' AND s.ejecucion_trigger_id IN
            (SELECT e.id FROM ejecuciones_triggers e WHERE e.trigger_id=t.id)
            AND s.estado IN ('enviado','error_final','resultado_ambiguo')
          ORDER BY COALESCE(s.fecha_terminal_utc,s.fecha_creacion) DESC,s.id DESC
          LIMIT 1) AS ultima_entrega_estado
      FROM triggers t
      WHERE t.id=? AND t.tipo='correo'
      LIMIT 1
    `, [idPositivo(triggerId)]);
    const filas = conexion ? resultado[0] : resultado;
    if (!filas[0]) return null;
    const fila = filas[0];
    return Object.freeze({
      relacionesTotal: Number(fila.relaciones_total || 0),
      relacionesActivas: Number(fila.relaciones_activas || 0),
      relacionesDormidas: Math.max(
        0,
        Number(fila.relaciones_total || 0) - Number(fila.relaciones_activas || 0)
      ),
      relacionesEntregables: Number(fila.relaciones_entregables || 0),
      vinculosTotal: Number(fila.vinculos_total || 0),
      vinculosActivos: Number(fila.vinculos_activos || 0),
      backlogAceptado: Number(fila.backlog_aceptado || 0),
      ultimaEntregaEstado: fila.ultima_entrega_estado || null
    });
  }
}

function idPositivo(valor) {
  const id = Number(valor);
  if (!Number.isSafeInteger(id) || id < 1) {
    throw new Error('El trigger de correo no es válido.');
  }
  return id;
}
