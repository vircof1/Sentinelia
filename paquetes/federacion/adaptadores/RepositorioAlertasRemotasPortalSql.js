import { validarPayloadMonitoresFederacion } from '../src/PayloadMonitoresFederacion.js';
import { crearIdentidadFederada, TIPOS_IDENTIDAD_FEDERADA } from '../src/IdentidadFederada.js';
import { uuidV7AuditoriaABytes } from '../../auditoria/src/UuidV7Auditoria.js';

export class RepositorioAlertasRemotasPortalSql {
  constructor(clienteSql) {
    if (!clienteSql?.consultar || !clienteSql?.obtenerConexion) {
      throw new Error('Las alertas remotas del portal requieren SQL operativo.');
    }
    this.clienteSql = clienteSql;
  }

  async listar({ contextoUsuarioActual, installationOrigenId = null,
    incluirCerradas = false, limite = 100 }) {
    const { clausula, parametros } = filtroScope(contextoUsuarioActual, 'p');
    const filtroInstalacion = installationOrigenId
      ? 'AND p.installation_origen_id=?'
      : '';
    const filtroEstado = incluirCerradas
      ? ''
      : `AND JSON_UNQUOTE(JSON_EXTRACT(
             r.representacion_canonica,'$.estadoAlerta'
           ))='activa'`;
    const filas = await this.clienteSql.consultar(
      `WITH definiciones_actuales AS (
         SELECT p.proyeccion_id,a.generacion_actual_id,
                (SELECT MAX(r1.secuencia_elemento)
                   FROM registros_monitores_remotos r1
                  WHERE r1.proyeccion_id=p.proyeccion_id
                    AND r1.generacion_id=a.generacion_actual_id
                    AND r1.secuencia_elemento<=v.ultima_secuencia_evaluada
                    AND r1.tipo_registro='definicion' AND r1.estado_registro='presente') AS secuencia_definicion
           FROM proyecciones_federacion p
           JOIN estados_actuales_proyecciones_federacion a ON a.proyeccion_id=p.proyeccion_id
           JOIN versiones_proyecciones_federacion v
             ON v.proyeccion_id=a.proyeccion_id AND v.generacion_id=a.generacion_actual_id
            AND v.estado_publicacion='actual'
          WHERE p.familia='monitores' AND ${clausula} ${filtroInstalacion}
            AND v.estado_autorizacion='autorizada'
       ), registros_alerta AS (
         SELECT p.proyeccion_id,a.generacion_actual_id,r0.alerta_auditoria_id,
                MAX(r0.secuencia_elemento) AS secuencia_alerta
           FROM proyecciones_federacion p
           JOIN estados_actuales_proyecciones_federacion a ON a.proyeccion_id=p.proyeccion_id
           JOIN versiones_proyecciones_federacion v
             ON v.proyeccion_id=a.proyeccion_id AND v.generacion_id=a.generacion_actual_id
            AND v.estado_publicacion='actual'
           JOIN registros_monitores_remotos r0
             ON r0.proyeccion_id=p.proyeccion_id
            AND r0.generacion_id=a.generacion_actual_id
            AND r0.secuencia_elemento<=v.ultima_secuencia_evaluada
            AND r0.tipo_registro='alerta' AND r0.estado_registro='presente'
          WHERE p.familia='monitores' AND ${clausula} ${filtroInstalacion}
            AND v.estado_autorizacion='autorizada'
            AND NOT EXISTS (
              SELECT 1 FROM registros_monitores_remotos retirada
               WHERE retirada.proyeccion_id=p.proyeccion_id
                 AND retirada.generacion_id=a.generacion_actual_id
                 AND retirada.estado_registro='retirado'
                 AND retirada.secuencia_elemento>r0.secuencia_elemento
                 AND retirada.secuencia_elemento<=v.ultima_secuencia_evaluada
            )
          GROUP BY p.proyeccion_id,a.generacion_actual_id,r0.alerta_auditoria_id
       )
       SELECT p.proyeccion_id,p.installation_origen_id,p.elemento_origen_id,
              p.scope_nivel,p.scope_tenant_id,p.scope_empresa_id,p.scope_sitio_id,
              v.completitud_interpretable,v.completitud_observable,
              v.completitud_reconstruible,v.estado_vigencia,v.estado_soporte,
              v.estado_autorizacion,r.alerta_auditoria_id,r.monitor_origen_id,
              r.representacion_canonica,r.tiempo_dato_utc,r.materializada_en_utc,
              JSON_UNQUOTE(JSON_EXTRACT(d.representacion_canonica,'$.nombre')) AS monitor_nombre,
              w.relacion_id,w.flujo_id,w.contribucion_id,
              CASE WHEN rf.installation_remota_id=p.installation_origen_id
                   THEN rf.nombre_remoto_declarado ELSE NULL END AS installation_nombre,
              c.longitud_recorrido,o.estado AS descarte_estado,o.motivo AS descarte_motivo,
              o.descartada_en_utc,o.descartada_hasta_utc,o.revertida_en_utc,
              UTC_TIMESTAMP(3) AS consultada_en_utc
         FROM registros_alerta x
         JOIN proyecciones_federacion p ON p.proyeccion_id=x.proyeccion_id
         JOIN definiciones_actuales dx
           ON dx.proyeccion_id=x.proyeccion_id AND dx.generacion_actual_id=x.generacion_actual_id
         JOIN versiones_proyecciones_federacion v
           ON v.proyeccion_id=x.proyeccion_id AND v.generacion_id=x.generacion_actual_id
         JOIN registros_monitores_remotos r
           ON r.proyeccion_id=x.proyeccion_id AND r.generacion_id=x.generacion_actual_id
          AND r.secuencia_elemento=x.secuencia_alerta
          AND r.estado_registro='presente' AND r.tipo_registro='alerta'
         LEFT JOIN registros_monitores_remotos d
           ON d.proyeccion_id=x.proyeccion_id AND d.generacion_id=x.generacion_actual_id
          AND d.secuencia_elemento=dx.secuencia_definicion
         JOIN trabajos_materializacion_federacion w ON w.entrega_id=r.trabajo_entrega_id
         JOIN relaciones_federacion rf ON rf.relacion_id=w.relacion_id
         LEFT JOIN contribuciones_proyecciones_federacion c ON c.contribucion_id=w.contribucion_id
         LEFT JOIN descartes_usuarios_alertas_remotas o
           ON o.usuario_id=? AND o.proyeccion_id=p.proyeccion_id
          AND o.alerta_auditoria_id=r.alerta_auditoria_id
        WHERE 1=1 ${filtroEstado}
        ORDER BY r.tiempo_dato_utc DESC,p.proyeccion_id
        LIMIT ?`,
      [
        ...parametros, ...(installationOrigenId ? [installationOrigenId] : []),
        ...parametros, ...(installationOrigenId ? [installationOrigenId] : []),
        contextoUsuarioActual.idUsuario, normalizarLimite(limite)
      ]
    );
    return Object.freeze(filas.map(mapear));
  }

  async obtenerVisibleParaActualizar({ conexion, contextoUsuarioActual, proyeccionId, alertaAuditoriaId }) {
    const { clausula, parametros } = filtroScope(contextoUsuarioActual, 'p');
    const [filas] = await conexion.execute(
      `SELECT p.proyeccion_id,p.scope_tenant_id,p.scope_empresa_id,p.scope_sitio_id,
              r.alerta_auditoria_id,r.representacion_canonica
         FROM proyecciones_federacion p
         JOIN estados_actuales_proyecciones_federacion a ON a.proyeccion_id=p.proyeccion_id
         JOIN versiones_proyecciones_federacion v
           ON v.proyeccion_id=a.proyeccion_id AND v.generacion_id=a.generacion_actual_id
          AND v.estado_publicacion='actual' AND v.estado_autorizacion='autorizada'
         JOIN registros_monitores_remotos r
           ON r.proyeccion_id=p.proyeccion_id AND r.generacion_id=a.generacion_actual_id
          AND r.alerta_auditoria_id=? AND r.tipo_registro='alerta'
          AND r.estado_registro='presente' AND r.secuencia_elemento<=v.ultima_secuencia_evaluada
        WHERE p.proyeccion_id=? AND p.familia='monitores' AND ${clausula}
        ORDER BY r.secuencia_elemento DESC LIMIT 1 FOR UPDATE`,
      [alertaAuditoriaId, proyeccion(proyeccionId), ...parametros]
    );
    return filas[0] || null;
  }

  async guardarDescarte({ conexion, usuarioId, proyeccionId, alertaAuditoriaId,
    motivo, hastaUtc, eventoId }) {
    await conexion.execute(
      `INSERT INTO descartes_usuarios_alertas_remotas (
         usuario_id,proyeccion_id,alerta_auditoria_id,estado,motivo,
         descartada_en_utc,descartada_hasta_utc,revertida_en_utc,
         evento_ultima_transicion_id
       ) VALUES (?,?,?,'vigente',?,UTC_TIMESTAMP(3),?,NULL,?)
       ON DUPLICATE KEY UPDATE estado='vigente',motivo=VALUES(motivo),
         descartada_en_utc=VALUES(descartada_en_utc),
         descartada_hasta_utc=VALUES(descartada_hasta_utc),revertida_en_utc=NULL,
         evento_ultima_transicion_id=VALUES(evento_ultima_transicion_id)`,
      [usuarioId, proyeccion(proyeccionId), alertaAuditoriaId, motivo,
        hastaUtc ? fechaSql(hastaUtc) : null, uuidV7AuditoriaABytes(eventoId)]
    );
  }

  async revertirDescarte({ conexion, usuarioId, proyeccionId, alertaAuditoriaId, eventoId }) {
    const [resultado] = await conexion.execute(
      `UPDATE descartes_usuarios_alertas_remotas
          SET estado='revertido',revertida_en_utc=UTC_TIMESTAMP(3),
              evento_ultima_transicion_id=?
        WHERE usuario_id=? AND proyeccion_id=? AND alerta_auditoria_id=?
          AND estado='vigente'`,
      [uuidV7AuditoriaABytes(eventoId), usuarioId, proyeccion(proyeccionId), alertaAuditoriaId]
    );
    return Number(resultado.affectedRows || 0) === 1;
  }

  async obtenerFirmaGlobal() {
    const filas = await this.clienteSql.consultar(
      `SELECT COALESCE(MAX(secuencia_elemento),0) AS secuencia,
              COUNT(*) AS total,
              COALESCE((SELECT SUM(CRC32(HEX(evento_ultima_transicion_id)))
                          FROM descartes_usuarios_alertas_remotas),0) AS overlays,
              COALESCE((SELECT SUM(a.version_publicacion)
                          FROM estados_actuales_proyecciones_federacion a
                          JOIN proyecciones_federacion p
                            ON p.proyeccion_id=a.proyeccion_id
                         WHERE p.familia='monitores'),0) AS publicaciones,
              COALESCE((SELECT SUM(v.version_estado)
                          FROM versiones_proyecciones_federacion v
                          JOIN proyecciones_federacion p
                            ON p.proyeccion_id=v.proyeccion_id
                         WHERE p.familia='monitores'
                           AND v.estado_publicacion='actual'),0) AS versiones
         FROM registros_monitores_remotos WHERE tipo_registro='alerta'`
    );
    const f = filas[0] || {};
    return `${f.total || 0}:${f.secuencia || 0}:${f.overlays || 0}:` +
      `${f.publicaciones || 0}:${f.versiones || 0}`;
  }
}

function mapear(fila) {
  const payload = validarPayloadMonitoresFederacion(
    typeof fila.representacion_canonica === 'string'
      ? JSON.parse(fila.representacion_canonica) : fila.representacion_canonica,
    { operacion: 'actualizacion' }
  );
  const ahora = fecha(fila.consultada_en_utc);
  const estadoPresentacion = payload.estadoAlerta === 'cerrada'
    ? 'cerradaEnOrigen'
    : (Date.parse(payload.vigenteHastaOrigenUtc) <= ahora.getTime() ||
       fila.estado_vigencia !== 'vigente') ? 'vigenciaAgotada' : 'activaEnOrigen';
  const descarteVigente = fila.descarte_estado === 'vigente' &&
    (fila.descartada_hasta_utc == null || fecha(fila.descartada_hasta_utc) > ahora);
  return Object.freeze({
    proyeccionId: fila.proyeccion_id,
    installationOrigenId: fila.installation_origen_id,
    installationNombre: fila.installation_nombre || null,
    elementoOrigenId: fila.elemento_origen_id,
    monitorOrigenId: fila.monitor_origen_id,
    monitorNombre: fila.monitor_nombre || 'Monitor remoto',
    alertaAuditoriaId: fila.alerta_auditoria_id,
    scope: { nivel: fila.scope_nivel, tenantId: decimal(fila.scope_tenant_id),
      empresaId: decimal(fila.scope_empresa_id), sitioId: decimal(fila.scope_sitio_id) },
    completitud: { interpretable: fila.completitud_interpretable,
      observable: fila.completitud_observable, reconstruible: fila.completitud_reconstruible },
    estadoProyeccion: { vigencia: fila.estado_vigencia, soporte: fila.estado_soporte,
      autorizacion: fila.estado_autorizacion },
    estadoPresentacion,
    frescura: { ultimaEjecucionUtc: payload.ultimaEjecucionUtc,
      ultimaConfirmacionUtc: payload.ultimaConfirmacionUtc,
      vigenteHastaOrigenUtc: payload.vigenteHastaOrigenUtc,
      materializadaEnUtc: iso(fila.materializada_en_utc) },
    recorrido: { relacionId: fila.relacion_id, flujoId: fila.flujo_id,
      contribucionId: fila.contribucion_id, longitud: Number(fila.longitud_recorrido || 0) },
    payload,
    descarteLocal: descarteVigente ? { vigente: true, motivo: fila.descarte_motivo,
      descartadaEnUtc: iso(fila.descartada_en_utc),
      descartadaHastaUtc: iso(fila.descartada_hasta_utc) } : { vigente: false }
  });
}

function filtroScope(c, alias) {
  if (c?.nivelScope === 'portal') return { clausula: '1=1', parametros: [] };
  const partes = [`${alias}.scope_tenant_id=?`]; const parametros = [c?.tenantId];
  if (['empresa','sitio'].includes(c?.nivelScope)) {
    partes.push(`${alias}.scope_empresa_id=?`); parametros.push(c?.empresaId);
  }
  if (c?.nivelScope === 'sitio') {
    partes.push(`${alias}.scope_sitio_id=?`); parametros.push(c?.sitioId);
  }
  return { clausula: partes.join(' AND '), parametros };
}

function proyeccion(id) {
  try { return String(crearIdentidadFederada({ tipo: TIPOS_IDENTIDAD_FEDERADA.PROYECCION, valor: String(id) })); }
  catch { throw Object.assign(new Error('proyeccionId no es válida.'), { codigo: 'IDENTIDAD_INVALIDA' }); }
}
function normalizarLimite(v) { const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? Math.min(n, 200) : 100; }
function decimal(v) { return v == null ? null : String(v); }
function fecha(v) { return v instanceof Date ? v : new Date(`${String(v).replace(' ','T').replace(/Z$/u,'')}Z`); }
function iso(v) { return v == null ? null : fecha(v).toISOString(); }
function fechaSql(v) { return new Date(v).toISOString().replace('T',' ').replace('Z',''); }
