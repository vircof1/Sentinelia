import {
  bytesAIdAvisoPlataforma,
  idAvisoPlataformaABytes
} from './IdentidadAvisoPlataforma.js';

export class RepositorioPresentacionAvisosPlataformaSql {
  constructor(clienteSql, { adaptadorAuditoria } = {}) {
    if (!clienteSql?.consultar || !clienteSql?.obtenerConexion) {
      throw new Error('La presentación de avisos requiere cliente SQL.');
    }
    if (typeof adaptadorAuditoria?.registrarOverlayEnTransaccion !== 'function') {
      throw new Error('La presentación de avisos requiere auditoría transaccional.');
    }
    this.clienteSql = clienteSql;
    this.adaptadorAuditoria = adaptadorAuditoria;
  }

  async listarActivosVisibles({ usuarioId, scope, limite = 50 }) {
    const { clausula, parametros } = construirFiltroScope(scope, 'a');
    const filas = await this.clienteSql.consultar(
      `SELECT a.aviso_id, a.tipo_codigo, a.causa_codigo, a.gravedad,
              a.scope_tenant_id, a.scope_empresa_id, a.scope_sitio_id,
              a.objeto_tipo, a.objeto_id, a.relacion_id, a.flujo_id,
              rf.nombre_remoto_declarado,
              a.primera_deteccion_utc, a.ultima_deteccion_utc,
              a.contador_detecciones, a.contexto_humano, a.resumen,
              o.estado AS estado_personal
       FROM avisos_plataforma a
       LEFT JOIN overlays_usuarios_avisos_plataforma o
         ON o.aviso_id = a.aviso_id AND o.usuario_id = ?
       LEFT JOIN relaciones_federacion rf ON rf.relacion_id = a.relacion_id
       WHERE a.estado_ciclo = 'pendiente'
         AND (o.estado IS NULL OR o.estado <> 'oculto')
         AND ${clausula}
       ORDER BY (o.estado IS NULL) DESC,
                FIELD(a.gravedad, 'critica', 'advertencia', 'informativa'),
                a.ultima_deteccion_utc DESC, a.id DESC
       LIMIT ?`,
      [usuarioId, ...parametros, limite]
    );
    return filas.map(proyectarFila);
  }

  async resumirActivosVisibles({ usuarioId, scope }) {
    const { clausula, parametros } = construirFiltroScope(scope, 'a');
    const filas = await this.clienteSql.consultar(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(o.estado IS NULL), 0) AS no_reconocidos,
              COALESCE(SUM(a.gravedad = 'critica'), 0) AS criticos,
              COALESCE(SUM(a.gravedad = 'advertencia'), 0) AS advertencias,
              COALESCE(SUM(a.gravedad = 'informativa'), 0) AS informativos
       FROM avisos_plataforma a
       LEFT JOIN overlays_usuarios_avisos_plataforma o
         ON o.aviso_id = a.aviso_id AND o.usuario_id = ?
       WHERE a.estado_ciclo = 'pendiente'
         AND (o.estado IS NULL OR o.estado <> 'oculto')
         AND ${clausula}`,
      [usuarioId, ...parametros]
    );
    const fila = filas[0] || {};
    return Object.freeze({
      totalActivosVisibles: Number(fila.total || 0),
      noReconocidos: Number(fila.no_reconocidos || 0),
      gravedadMaxima: Number(fila.criticos || 0) > 0
        ? 'critica'
        : Number(fila.advertencias || 0) > 0
          ? 'advertencia'
          : Number(fila.informativos || 0) > 0 ? 'informativa' : null
    });
  }

  async obtenerFirmaGlobal() {
    const filas = await this.clienteSql.consultar(
      `SELECT COUNT(*) AS total,
              COALESCE(HEX(MAX(a.evento_ultima_transicion_id)), '') AS avisos,
              COALESCE((SELECT HEX(MAX(o.evento_auditoria_id))
                        FROM overlays_usuarios_avisos_plataforma o), '') AS overlays
       FROM avisos_plataforma a`
    );
    const fila = filas[0] || {};
    return `${fila.total || 0}:${fila.avisos || ''}:${fila.overlays || ''}`;
  }

  async cambiarEstadoPersonal({ avisoId, estado, eventoId, contextoUsuarioActual }) {
    const conexion = await this.clienteSql.obtenerConexion();
    try {
      await conexion.beginTransaction();
      const aviso = await buscarAvisoVisibleParaActualizar(
        conexion,
        avisoId,
        contextoUsuarioActual
      );
      if (!aviso) {
        const error = new Error('El aviso no existe o queda fuera del alcance efectivo.');
        error.codigo = 'AVISO_NO_VISIBLE';
        throw error;
      }
      const [actuales] = await conexion.execute(
        `SELECT estado FROM overlays_usuarios_avisos_plataforma
         WHERE usuario_id = ? AND aviso_id = ? FOR UPDATE`,
        [contextoUsuarioActual.idUsuario, idAvisoPlataformaABytes(avisoId)]
      );
      if (actuales[0]?.estado === estado) {
        await conexion.commit();
        return Object.freeze({ estado: 'sin_cambios' });
      }
      await this.adaptadorAuditoria.registrarOverlayEnTransaccion({
        avisoId,
        causaCodigo: aviso.causa_codigo,
        estado,
        eventoId,
        scope: scopeDesdeFila(aviso),
        contextoUsuarioActual
      }, { conexion });
      await conexion.execute(
        `INSERT INTO overlays_usuarios_avisos_plataforma (
           usuario_id, aviso_id, estado, actualizado_en_utc, evento_auditoria_id
         ) VALUES (?, ?, ?, UTC_TIMESTAMP(3), ?)
         ON DUPLICATE KEY UPDATE estado = VALUES(estado),
           actualizado_en_utc = VALUES(actualizado_en_utc),
           evento_auditoria_id = VALUES(evento_auditoria_id)`,
        [
          contextoUsuarioActual.idUsuario,
          idAvisoPlataformaABytes(avisoId),
          estado,
          idAvisoPlataformaABytes(eventoId, 'eventoId')
        ]
      );
      await conexion.commit();
      return Object.freeze({ estado });
    } catch (error) {
      try { await conexion.rollback(); } catch {}
      throw error;
    } finally {
      conexion.release();
    }
  }
}

async function buscarAvisoVisibleParaActualizar(conexion, avisoId, contexto) {
  const { clausula, parametros } = construirFiltroScope(contexto, 'a');
  const [filas] = await conexion.execute(
    `SELECT a.* FROM avisos_plataforma a
     WHERE a.aviso_id = ? AND a.estado_ciclo = 'pendiente' AND ${clausula}
     LIMIT 1 FOR UPDATE`,
    [idAvisoPlataformaABytes(avisoId), ...parametros]
  );
  return filas[0] || null;
}

function construirFiltroScope(scope, alias) {
  if (scope?.nivelScope === 'portal') return { clausula: '1 = 1', parametros: [] };
  const partes = [`${alias}.scope_tenant_id = ?`];
  const parametros = [scope?.tenantId];
  if (scope?.nivelScope === 'empresa' || scope?.nivelScope === 'sitio') {
    partes.push(`${alias}.scope_empresa_id = ?`);
    parametros.push(scope?.empresaId);
  }
  if (scope?.nivelScope === 'sitio') {
    partes.push(`${alias}.scope_sitio_id = ?`);
    parametros.push(scope?.sitioId);
  }
  return { clausula: partes.join(' AND '), parametros };
}

function proyectarFila(fila) {
  return Object.freeze({
    avisoId: bytesAIdAvisoPlataforma(fila.aviso_id),
    tipoCodigo: fila.tipo_codigo,
    causaCodigo: fila.causa_codigo,
    gravedad: fila.gravedad,
    scope: scopeDesdeFila(fila),
    objeto: { tipo: fila.objeto_tipo, id: fila.objeto_id },
    relacionId: fila.relacion_id,
    flujoId: fila.flujo_id,
    installationRemotaNombre: fila.nombre_remoto_declarado || null,
    primeraDeteccionUtc: fechaIso(fila.primera_deteccion_utc),
    ultimaDeteccionUtc: fechaIso(fila.ultima_deteccion_utc),
    contadorDetecciones: String(fila.contador_detecciones),
    contextoHumano: parsearJson(fila.contexto_humano),
    resumen: parsearJson(fila.resumen),
    estadoPersonal: fila.estado_personal || 'sin_reconocer'
  });
}

function scopeDesdeFila(fila) {
  return {
    tenantId: fila.scope_tenant_id == null ? null : String(fila.scope_tenant_id),
    empresaId: fila.scope_empresa_id == null ? null : String(fila.scope_empresa_id),
    sitioId: fila.scope_sitio_id == null ? null : String(fila.scope_sitio_id)
  };
}

function parsearJson(valor) {
  if (valor == null) return null;
  if (typeof valor === 'object' && !Buffer.isBuffer(valor)) return valor;
  try { return JSON.parse(String(valor)); } catch { return null; }
}

function fechaIso(valor) {
  const fecha = valor instanceof Date ? valor : new Date(`${String(valor).replace(' ', 'T')}Z`);
  return Number.isNaN(fecha.getTime()) ? null : fecha.toISOString();
}
