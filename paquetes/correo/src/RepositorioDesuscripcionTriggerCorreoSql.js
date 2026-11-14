export class RepositorioDesuscripcionTriggerCorreoSql {
  constructor(clienteSql) {
    if (typeof clienteSql?.consultar !== 'function') {
      throw new Error('La desuscripción de correo requiere un cliente SQL.');
    }
    this.clienteSql = clienteSql;
  }

  async localizarPreliminar(tokenHashSha256) {
    const filas = await this.clienteSql.consultar(`
      SELECT trigger_id, trigger_id_fotografia
        FROM capacidades_desuscripcion_correo
       WHERE token_hash_sha256 = ?
         AND estado = 'emitida'
         AND expira_en_utc > UTC_TIMESTAMP(3)
       LIMIT 1
    `, [tokenHashSha256]);
    return filas[0] ? Object.freeze({ ...filas[0] }) : null;
  }

  async bloquearTrigger(triggerId, { conexion } = {}) {
    exigirConexion(conexion);
    const [filas] = await conexion.execute(`
      SELECT id, tipo, activo, revision_declaracion,
             tenant_id, empresa_id, sitio_id
        FROM triggers
       WHERE id = ?
       LIMIT 1
       FOR UPDATE
    `, [enteroPositivo(triggerId)]);
    return filas[0] ? Object.freeze({ ...filas[0] }) : null;
  }

  async bloquearCapacidad(tokenHashSha256, { conexion } = {}) {
    exigirConexion(conexion);
    const [filas] = await conexion.execute(`
      SELECT id, salida_correo_id, trigger_id, trigger_id_fotografia,
             estado, emitida_en_utc, expira_en_utc,
             expira_en_utc > UTC_TIMESTAMP(3) AS vigente
        FROM capacidades_desuscripcion_correo
       WHERE token_hash_sha256 = ?
       LIMIT 1
       FOR UPDATE
    `, [tokenHashSha256]);
    return filas[0] ? Object.freeze({ ...filas[0] }) : null;
  }

  async bloquearRelacionesDeLaEntrega({ triggerId, salidaCorreoId }, {
    conexion
  } = {}) {
    exigirConexion(conexion);
    const [filas] = await conexion.execute(`
      SELECT DISTINCT d.id, d.tipo, d.usuario_id,
             d.email_manual_canonico, d.estado_participacion
        FROM destinatarios_triggers_correo d
        JOIN resultados_destinatarios_triggers_correo r
          ON r.salida_correo_id = ?
         AND r.codigo_inicial = 'aceptado'
         AND (
           (r.tipo = 'usuario'
             AND d.tipo = 'usuario'
             AND d.usuario_id = r.usuario_id_fotografia)
           OR
           (r.tipo = 'manual'
             AND d.tipo = 'manual'
             AND d.email_manual_canonico = r.email_manual_canonico)
         )
       WHERE d.trigger_id = ?
       ORDER BY d.id ASC
       FOR UPDATE
    `, [enteroPositivo(salidaCorreoId), enteroPositivo(triggerId)]);
    return Object.freeze(filas.map((fila) => Object.freeze({ ...fila })));
  }

  async desuscribirActivas(idsRelacion, { conexion } = {}) {
    exigirConexion(conexion);
    const ids = idsRelacion.map(enteroPositivo);
    if (ids.length === 0) return 0;
    const [resultado] = await conexion.execute(`
      UPDATE destinatarios_triggers_correo
         SET estado_participacion = 'desuscrita',
             causa_ultima_desuscripcion = 'capacidad_enlace_correo',
             desuscrita_en_utc = UTC_TIMESTAMP(3),
             cambiada_en_utc = UTC_TIMESTAMP(3)
       WHERE id IN (${ids.map(() => '?').join(', ')})
         AND estado_participacion = 'activa'
    `, ids);
    return Number(resultado.affectedRows || 0);
  }

  async contarActivas(triggerId, { conexion } = {}) {
    exigirConexion(conexion);
    const [filas] = await conexion.execute(`
      SELECT COUNT(*) AS total
        FROM destinatarios_triggers_correo
       WHERE trigger_id = ? AND estado_participacion = 'activa'
    `, [enteroPositivo(triggerId)]);
    return Number(filas[0]?.total || 0);
  }
}

function exigirConexion(conexion) {
  if (typeof conexion?.execute !== 'function') {
    throw new Error('La desuscripción exige una conexión SQL prestada.');
  }
}

function enteroPositivo(valor) {
  const numero = Number(valor);
  if (!Number.isSafeInteger(numero) || numero < 1) {
    throw new Error('La identidad SQL de desuscripción no es válida.');
  }
  return numero;
}
