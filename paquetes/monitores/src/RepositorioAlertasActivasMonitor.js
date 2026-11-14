import { AlertaActivaMonitor } from './AlertaActivaMonitor.js';
import {
  generarUuidV7Auditoria,
  uuidV7AuditoriaABytes
} from '../../auditoria/src/UuidV7Auditoria.js';

function normalizarFechaSqlUtc(valor) {
  if (!valor) {
    return null;
  }

  const fecha = valor instanceof Date ? valor : new Date(valor);

  if (Number.isNaN(fecha.getTime())) {
    return null;
  }

  return fecha.toISOString().slice(0, 19).replace('T', ' ');
}

function clonarJsonSeguro(valor) {
  if (!valor || typeof valor !== 'object') {
    return null;
  }

  return JSON.parse(JSON.stringify(valor));
}

export class RepositorioAlertasActivasMonitor {
  constructor(clienteSql) {
    this.clienteSql = clienteSql;
  }

  async buscarPorMonitorId(monitorId, { conexion = null, bloquear = false } = {}) {
    const monitorIdNormalizado = this.normalizarIdPositivo(monitorId);

    if (monitorIdNormalizado == null) {
      return null;
    }

    const filas = await consultar(
      conexion || this.clienteSql,
      `
        SELECT
          monitor_id,
          alerta_auditoria_id,
          tenant_id,
          empresa_id,
          sitio_id,
          version_catalogo,
          tipo_monitor,
          estado_alerta,
          estado_detectado,
          codigo_ultimo_resultado,
          mensaje_ultimo_resultado,
          valido_desde_utc,
          ultima_confirmacion_utc,
          ultima_ejecucion_utc,
          contador_repeticiones,
          payload_alerta,
          descartada_dashboard,
          motivo_descarte,
          descartada_por_usuario_id,
          descartada_en_utc,
          descartada_hasta_utc,
          fecha_creacion,
          fecha_actualizacion
        FROM alertas_activas_monitores
        WHERE monitor_id = ?
        LIMIT 1
        ${bloquear ? 'FOR UPDATE' : ''}
      `,
      [monitorIdNormalizado]
    );

    return filas.length > 0 ? new AlertaActivaMonitor(filas[0]) : null;
  }

  async listarPorMonitorIds(idsMonitor = []) {
    if (!Array.isArray(idsMonitor) || idsMonitor.length === 0) {
      return [];
    }

    const idsNormalizados = idsMonitor
      .map((id) => this.normalizarIdPositivo(id))
      .filter(Boolean);

    if (idsNormalizados.length === 0) {
      return [];
    }

    const placeholders = idsNormalizados.map(() => '?').join(', ');
    const filas = await this.clienteSql.consultar(
      `
        SELECT
          monitor_id,
          alerta_auditoria_id,
          tenant_id,
          empresa_id,
          sitio_id,
          version_catalogo,
          tipo_monitor,
          estado_alerta,
          estado_detectado,
          codigo_ultimo_resultado,
          mensaje_ultimo_resultado,
          valido_desde_utc,
          ultima_confirmacion_utc,
          ultima_ejecucion_utc,
          contador_repeticiones,
          payload_alerta,
          descartada_dashboard,
          motivo_descarte,
          descartada_por_usuario_id,
          descartada_en_utc,
          descartada_hasta_utc,
          fecha_creacion,
          fecha_actualizacion
        FROM alertas_activas_monitores
        WHERE monitor_id IN (${placeholders})
        ORDER BY ultima_confirmacion_utc DESC, monitor_id ASC
      `,
      idsNormalizados
    );

    return filas.map((fila) => new AlertaActivaMonitor(fila));
  }

  async guardarAlertas(alertas = []) {
    if (!Array.isArray(alertas) || alertas.length === 0) {
      return 0;
    }

    const filas = alertas
      .map((alerta) => this.normalizarAlertaPersistible(alerta))
      .filter(Boolean);

    if (filas.length === 0) {
      return 0;
    }

    const placeholders = filas
      .map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .join(', ');
    const parametros = filas.flatMap((fila) => [
      fila.monitorId,
      fila.alertaAuditoriaId,
      fila.tenantId,
      fila.empresaId,
      fila.sitioId,
      fila.versionCatalogo,
      fila.tipoMonitor,
      fila.estadoAlerta,
      fila.estadoDetectado,
      fila.codigoUltimoResultado,
      fila.mensajeUltimoResultado,
      fila.validoDesdeUtc,
      fila.ultimaConfirmacionUtc,
      fila.ultimaEjecucionUtc,
      fila.contadorRepeticiones,
      fila.payloadAlerta == null ? null : JSON.stringify(fila.payloadAlerta)
    ]);

    // Los campos de descarte son decisión humana: el runtime confirma la alerta,
    // pero no debe limpiar ni reescribir su visibilidad operativa.
    await this.clienteSql.ejecutar(
      `
        INSERT INTO alertas_activas_monitores (
          monitor_id,
          alerta_auditoria_id,
          tenant_id,
          empresa_id,
          sitio_id,
          version_catalogo,
          tipo_monitor,
          estado_alerta,
          estado_detectado,
          codigo_ultimo_resultado,
          mensaje_ultimo_resultado,
          valido_desde_utc,
          ultima_confirmacion_utc,
          ultima_ejecucion_utc,
          contador_repeticiones,
          payload_alerta
        ) VALUES ${placeholders}
        ON DUPLICATE KEY UPDATE
          tenant_id = VALUES(tenant_id),
          empresa_id = VALUES(empresa_id),
          sitio_id = VALUES(sitio_id),
          version_catalogo = VALUES(version_catalogo),
          tipo_monitor = VALUES(tipo_monitor),
          estado_alerta = VALUES(estado_alerta),
          estado_detectado = VALUES(estado_detectado),
          codigo_ultimo_resultado = VALUES(codigo_ultimo_resultado),
          mensaje_ultimo_resultado = VALUES(mensaje_ultimo_resultado),
          valido_desde_utc = VALUES(valido_desde_utc),
          ultima_confirmacion_utc = VALUES(ultima_confirmacion_utc),
          ultima_ejecucion_utc = VALUES(ultima_ejecucion_utc),
          contador_repeticiones = VALUES(contador_repeticiones),
          payload_alerta = VALUES(payload_alerta)
      `,
      parametros
    );

    return filas.length;
  }

  async listarMonitorIdsInactivos() {
    const filas = await this.clienteSql.consultar(`
      SELECT a.monitor_id
      FROM alertas_activas_monitores a
      INNER JOIN monitores m ON m.id = a.monitor_id
      WHERE m.activo = 0
      ORDER BY a.monitor_id
    `);
    return filas.map((fila) => Number(fila.monitor_id));
  }

  async eliminarPorMonitorIds(idsMonitor = [], { conexion = null } = {}) {
    if (!Array.isArray(idsMonitor) || idsMonitor.length === 0) {
      return 0;
    }

    const idsNormalizados = idsMonitor
      .map((id) => this.normalizarIdPositivo(id))
      .filter(Boolean);

    if (idsNormalizados.length === 0) {
      return 0;
    }

    const placeholders = idsNormalizados.map(() => '?').join(', ');
    const [resultado] = await ejecutar(
      conexion || this.clienteSql,
      `
        DELETE FROM alertas_activas_monitores
        WHERE monitor_id IN (${placeholders})
      `,
      idsNormalizados
    );

    return Number(resultado.affectedRows || 0);
  }

  async descartarDashboard({
    monitorId,
    motivo,
    usuarioId,
    descartadaHastaUtc = null
  }, { conexion = null } = {}) {
    const monitorIdNormalizado = this.normalizarIdPositivo(monitorId);
    const usuarioIdNormalizado = this.normalizarIdPositivo(usuarioId);
    const motivoNormalizado = String(motivo || '').trim().slice(0, 512);
    const descartadaHastaNormalizada = normalizarFechaSqlUtc(descartadaHastaUtc);

    if (
      monitorIdNormalizado == null ||
      usuarioIdNormalizado == null ||
      !motivoNormalizado
    ) {
      return null;
    }

    const [resultado] = await ejecutar(
      conexion || this.clienteSql,
      `
        UPDATE alertas_activas_monitores
        SET
          descartada_dashboard = 1,
          motivo_descarte = ?,
          descartada_por_usuario_id = ?,
          descartada_en_utc = UTC_TIMESTAMP(),
          descartada_hasta_utc = ?
        WHERE
          monitor_id = ?
          AND estado_alerta = 'activa'
          AND (
            descartada_dashboard = 0
            OR descartada_hasta_utc IS NOT NULL
              AND descartada_hasta_utc <= UTC_TIMESTAMP()
          )
      `,
      [
        motivoNormalizado,
        usuarioIdNormalizado,
        descartadaHastaNormalizada,
        monitorIdNormalizado
      ]
    );

    if (Number(resultado?.affectedRows || 0) === 0) {
      return null;
    }

    return this.buscarPorMonitorId(monitorIdNormalizado, { conexion });
  }

  async revertirDescarteDashboard({ monitorId }, { conexion = null } = {}) {
    const monitorIdNormalizado = this.normalizarIdPositivo(monitorId);

    if (monitorIdNormalizado == null) {
      return null;
    }

    await ejecutar(
      conexion || this.clienteSql,
      `
        UPDATE alertas_activas_monitores
        SET
          descartada_dashboard = 0,
          motivo_descarte = '',
          descartada_por_usuario_id = NULL,
          descartada_en_utc = NULL,
          descartada_hasta_utc = NULL
        WHERE monitor_id = ?
      `,
      [monitorIdNormalizado]
    );

    return this.buscarPorMonitorId(monitorIdNormalizado, { conexion });
  }

  normalizarAlertaPersistible(alerta) {
    if (!alerta) {
      return null;
    }

    const serializado =
      typeof alerta.serializarPersistencia === 'function'
        ? alerta.serializarPersistencia()
        : alerta;

    const monitorId = this.normalizarIdPositivo(serializado.monitorId);
    const tenantId = this.normalizarIdPositivo(serializado.tenantId);
    const empresaId = this.normalizarIdPositivo(serializado.empresaId);
    const sitioId = this.normalizarIdPositivo(serializado.sitioId);
    const validoDesdeUtc = normalizarFechaSqlUtc(serializado.validoDesdeUtc);
    const ultimaConfirmacionUtc = normalizarFechaSqlUtc(
      serializado.ultimaConfirmacionUtc
    );
    const ultimaEjecucionUtc = normalizarFechaSqlUtc(serializado.ultimaEjecucionUtc);
    const versionCatalogo = String(serializado.versionCatalogo || '').trim();
    const tipoMonitor = String(serializado.tipoMonitor || '').trim().toLowerCase();

    if (
      monitorId == null ||
      tenantId == null ||
      empresaId == null ||
      !validoDesdeUtc ||
      !ultimaConfirmacionUtc ||
      !ultimaEjecucionUtc ||
      !versionCatalogo ||
      !tipoMonitor
    ) {
      return null;
    }

    return {
      monitorId,
      // Cada intento de alta propone una identidad nueva. Si el ciclo ya existe,
      // ON DUPLICATE conserva la identidad persistida porque nunca la actualiza.
      // Tras un cierre, reutilizar el mismo objeto abre así otro ciclo UUIDv7.
      alertaAuditoriaId: uuidV7AuditoriaABytes(
        serializado.alertaAuditoriaId || generarUuidV7Auditoria(),
        'alertaAuditoriaId'
      ),
      tenantId,
      empresaId,
      sitioId,
      versionCatalogo,
      tipoMonitor,
      estadoAlerta: String(serializado.estadoAlerta || 'activa')
        .trim()
        .toLowerCase()
        .slice(0, 40),
      estadoDetectado: String(serializado.estadoDetectado || 'indisponible')
        .trim()
        .toLowerCase()
        .slice(0, 40),
      codigoUltimoResultado: String(
        serializado.codigoUltimoResultado || 'sin_resultado'
      )
        .trim()
        .slice(0, 80),
      mensajeUltimoResultado: String(
        serializado.mensajeUltimoResultado || 'Sin mensaje de resultado.'
      )
        .trim()
        .slice(0, 500),
      validoDesdeUtc,
      ultimaConfirmacionUtc,
      ultimaEjecucionUtc,
      contadorRepeticiones: Math.max(
        1,
        Number.parseInt(String(serializado.contadorRepeticiones || 1), 10) || 1
      ),
      payloadAlerta: clonarJsonSeguro(serializado.payloadAlerta)
    };
  }

  normalizarIdPositivo(valor) {
    const convertido = Number.parseInt(String(valor ?? ''), 10);
    return Number.isInteger(convertido) && convertido > 0 ? convertido : null;
  }
}

async function ejecutar(ejecutor, sql, parametros = []) {
  return typeof ejecutor.ejecutar === 'function'
    ? ejecutor.ejecutar(sql, parametros)
    : ejecutor.execute(sql, parametros);
}

async function consultar(ejecutor, sql, parametros = []) {
  if (typeof ejecutor.consultar === 'function') {
    return ejecutor.consultar(sql, parametros);
  }

  const [filas] = await ejecutor.execute(sql, parametros);
  return filas;
}
