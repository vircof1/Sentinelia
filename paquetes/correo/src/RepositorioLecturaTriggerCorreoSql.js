export class RepositorioLecturaTriggerCorreoSql {
  constructor(clienteSql = null) {
    this.clienteSql = clienteSql;
  }

  async listarIdsPorTriggerEnTransaccion(triggerId, {
    conexion,
    limite = 20
  } = {}) {
    exigirConexion(conexion);
    const [filas] = await conexion.execute(`
      SELECT id
        FROM ejecuciones_triggers
       WHERE trigger_id=? AND tipo_trigger='correo'
       ORDER BY iniciado_en_utc DESC,id DESC
       LIMIT ?
    `, [idPositivo(triggerId), Math.min(Math.max(Number(limite) || 20, 1), 50)]);
    return Object.freeze(filas.map((fila) => String(fila.id)));
  }

  async leerEjecucionEnTransaccion(ejecucionId, { conexion } = {}) {
    exigirConexion(conexion);
    const id = idPositivo(ejecucionId);
    const [cabeceras] = await conexion.execute(`
      SELECT
        e.id AS ejecucion_id,e.asignacion_trigger_monitor_id,
        e.trigger_id AS ejecucion_trigger_id,e.monitor_id AS ejecucion_monitor_id,
        e.evento_disparo,e.estado_ejecucion,e.tipo_trigger,e.trigger_nombre,
        e.monitor_nombre,e.codigo_resultado,e.mensaje_resultado,
        e.iniciado_en_utc,e.finalizado_en_utc,
        e.trigger_tenant_id,e.trigger_empresa_id,e.trigger_sitio_id,
        e.monitor_tenant_id,e.monitor_empresa_id,e.monitor_sitio_id,
        n.id AS notificacion_id,n.trigger_id_fotografia,
        n.monitor_id_fotografia,n.asignacion_id_fotografia,
        n.alerta_auditoria_id,n.fecha_ocurrencia_utc,n.valido_desde_utc,
        n.nombre_monitor AS fotografia_nombre_monitor,
        n.tipo_monitor,n.estado_monitor,n.origen_causal,
        n.codigo_resultado AS causa_codigo_resultado,
        n.mensaje_resultado AS causa_mensaje_resultado,
        n.descripcion_fallo,n.posible_solucion,
        n.scope_trigger_nivel,n.scope_trigger_tenant_id,
        n.scope_trigger_empresa_id,n.scope_trigger_sitio_id,
        n.scope_monitor_nivel,n.scope_monitor_tenant_id,
        n.scope_monitor_empresa_id,n.scope_monitor_sitio_id,
        n.referencia_estado_url,n.referencia_historico_url,
        n.definicion_mensaje_version,n.asunto_plantilla,
        n.texto_introduccion,n.texto_cierre,n.renderizador_version,
        n.asunto,n.origen_publico,n.renderizado_en_utc,n.aceptada_en_utc,
        t.id AS trigger_vivo_id,t.nombre AS trigger_vivo_nombre,
        t.tenant_id AS trigger_vivo_tenant_id,
        t.empresa_id AS trigger_vivo_empresa_id,
        t.sitio_id AS trigger_vivo_sitio_id,
        m.id AS monitor_vivo_id,m.nombre AS monitor_vivo_nombre,
        m.tipo AS monitor_vivo_tipo,m.tenant_id AS monitor_vivo_tenant_id,
        m.empresa_id AS monitor_vivo_empresa_id,
        m.sitio_id AS monitor_vivo_sitio_id
      FROM ejecuciones_triggers e
      LEFT JOIN notificaciones_triggers_correo n
        ON n.ejecucion_trigger_id=e.id
      LEFT JOIN triggers t ON t.id=COALESCE(n.trigger_id,e.trigger_id)
      LEFT JOIN monitores m ON m.id=COALESCE(n.monitor_id,e.monitor_id)
      WHERE e.id=? AND e.tipo_trigger='correo'
      LIMIT 1
    `, [id]);
    if (!cabeceras[0]) return null;
    const [resultados] = await conexion.execute(`
      SELECT
        r.id,r.ejecucion_trigger_id,r.notificacion_trigger_correo_id,
        r.relacion_destinatario_id,r.tipo,r.usuario_id,
        r.usuario_id_fotografia,r.email_manual,r.email_manual_canonico,
        r.normalizacion_buzon_version,r.estado_observado,
        r.email_resuelto_canonico,r.codigo_inicial,r.salida_correo_id,
        r.creada_en_utc,
        u.id AS usuario_vivo_id,u.usuario AS usuario_vivo_cuenta,
        u.nombre_mostrar AS usuario_vivo_nombre_mostrar,
        u.nombre_completo AS usuario_vivo_nombre_completo,
        u.email AS usuario_vivo_email,u.activo AS usuario_vivo_activo,
        u.email_validado AS usuario_vivo_email_validado,
        u.tenant_id AS usuario_vivo_tenant_id,
        u.empresa_id AS usuario_vivo_empresa_id,
        u.sitio_id AS usuario_vivo_sitio_id
      FROM resultados_destinatarios_triggers_correo r
      LEFT JOIN usuarios u ON u.id=r.usuario_id
      WHERE r.ejecucion_trigger_id=?
      ORDER BY r.id ASC
    `, [id]);
    const [salidas] = await conexion.execute(`
      SELECT
        id,notificacion_trigger_correo_id,ejecucion_trigger_id,
        destinatario_email,normalizacion_buzon_version,smtp_message_id,asunto,
        estado,intentos,error_ultimo,codigo_resultado,respuesta_saneada,
        proximo_intento_en,fecha_creacion,fecha_ultimo_intento,
        fecha_envio,fecha_terminal_utc
      FROM cola_correos_salida
      WHERE ejecucion_trigger_id=? AND origen_tipo='trigger'
      ORDER BY id ASC
    `, [id]);
    const [intentos] = await conexion.execute(`
      SELECT
        i.id,i.salida_correo_id,i.numero,i.configuracion_version,
        i.smtp_message_id,i.estado,i.iniciado_en_utc,i.finalizado_en_utc,
        i.clasificacion,i.codigo,i.respuesta_saneada
      FROM intentos_correos_salida i
      INNER JOIN cola_correos_salida s ON s.id=i.salida_correo_id
      WHERE s.ejecucion_trigger_id=?
      ORDER BY i.salida_correo_id ASC,i.numero ASC
    `, [id]);
    return congelar({
      cabecera: cabeceras[0],
      resultados,
      salidas,
      intentos
    });
  }
}

function exigirConexion(conexion) {
  if (typeof conexion?.execute !== 'function') {
    throw new Error('La lectura de correo exige conexión SQL prestada.');
  }
}

function idPositivo(valor) {
  const numero = Number(valor);
  if (!Number.isSafeInteger(numero) || numero < 1) {
    throw new Error('La ejecución de correo no es válida.');
  }
  return numero;
}

function congelar(valor) {
  if (!valor || typeof valor !== 'object' || Object.isFrozen(valor)) return valor;
  if (ArrayBuffer.isView(valor)) return valor;
  for (const hijo of Object.values(valor)) congelar(hijo);
  return Object.freeze(valor);
}
