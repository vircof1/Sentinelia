function normalizarFechaMysqlUtc(valor) {
  if (!valor) {
    return null;
  }

  const fecha = valor instanceof Date ? valor : new Date(valor);

  if (Number.isNaN(fecha.getTime())) {
    return null;
  }

  return fecha.toISOString().slice(0, 19).replace('T', ' ');
}

export class RepositorioEstadoActualMonitores {
  constructor(clienteSql) {
    this.clienteSql = clienteSql;
  }

  async eliminarEstadosHuerfanosOInactivos() {
    const [resultado] = await this.clienteSql.ejecutar(
      `
        DELETE eam
        FROM estado_actual_monitores eam
        INNER JOIN monitores m ON m.id = eam.monitor_id
        WHERE m.activo = 0
      `
    );

    return Number(resultado.affectedRows || 0);
  }

  async listarPorMonitorIds(idsMonitor = []) {
    if (!Array.isArray(idsMonitor) || idsMonitor.length === 0) {
      return [];
    }

    const idsNormalizados = idsMonitor
      .map((id) => Number.parseInt(String(id), 10))
      .filter((id) => Number.isInteger(id) && id > 0);

    if (idsNormalizados.length === 0) {
      return [];
    }

    const placeholders = idsNormalizados.map(() => '?').join(', ');

    return this.clienteSql.consultar(
      `
        SELECT
          monitor_id,
          version_catalogo,
          estado,
          ejecutado_todavia,
          pendiente_scheduler,
          fecha_ultima_ejecucion_utc,
          fecha_ultimo_cambio_utc,
          resultado_actual,
          motivo_inicial,
          fecha_creacion,
          fecha_actualizacion
        FROM estado_actual_monitores
        WHERE monitor_id IN (${placeholders})
      `,
      idsNormalizados
    );
  }

  async guardarEstadosActuales(estados = []) {
    if (!Array.isArray(estados) || estados.length === 0) {
      return 0;
    }

    const filasNormalizadas = estados
      .map((estado) => this.normalizarEstadoPersistible(estado))
      .filter(Boolean);

    if (filasNormalizadas.length === 0) {
      return 0;
    }

    // El catálogo puede cambiar mientras un tick sigue ejecutándose. Si el
    // monitor ya no existe en SQL al persistir el resultado, descartamos su
    // estado en lugar de romper el scheduler por la FK.
    const idsExistentes = await this.listarMonitorIdsExistentes(
      filasNormalizadas.map((fila) => fila.monitorId)
    );
    const filas = filasNormalizadas.filter((fila) => idsExistentes.has(fila.monitorId));

    if (filas.length === 0) {
      return 0;
    }

    const placeholders = filas.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
    const parametros = filas.flatMap((fila) => [
      fila.monitorId,
      fila.versionCatalogo,
      fila.estado,
      fila.ejecutadoTodavia ? 1 : 0,
      fila.pendienteScheduler ? 1 : 0,
      fila.fechaUltimaEjecucionUtc,
      fila.fechaUltimoCambioUtc,
      fila.resultadoActual == null ? null : JSON.stringify(fila.resultadoActual),
      fila.motivoInicial
    ]);

    await this.clienteSql.ejecutar(
      `
        INSERT INTO estado_actual_monitores (
          monitor_id,
          version_catalogo,
          estado,
          ejecutado_todavia,
          pendiente_scheduler,
          fecha_ultima_ejecucion_utc,
          fecha_ultimo_cambio_utc,
          resultado_actual,
          motivo_inicial
        ) VALUES ${placeholders}
        ON DUPLICATE KEY UPDATE
          version_catalogo = VALUES(version_catalogo),
          estado = VALUES(estado),
          ejecutado_todavia = VALUES(ejecutado_todavia),
          pendiente_scheduler = VALUES(pendiente_scheduler),
          fecha_ultima_ejecucion_utc = VALUES(fecha_ultima_ejecucion_utc),
          fecha_ultimo_cambio_utc = VALUES(fecha_ultimo_cambio_utc),
          resultado_actual = VALUES(resultado_actual),
          motivo_inicial = VALUES(motivo_inicial)
      `,
      parametros
    );

    return filas.length;
  }

  async listarMonitorIdsExistentes(idsMonitor = []) {
    if (!Array.isArray(idsMonitor) || idsMonitor.length === 0) {
      return new Set();
    }

    const idsNormalizados = [
      ...new Set(
        idsMonitor
          .map((id) => Number.parseInt(String(id), 10))
          .filter((id) => Number.isInteger(id) && id > 0)
      )
    ];

    if (idsNormalizados.length === 0) {
      return new Set();
    }

    const placeholders = idsNormalizados.map(() => '?').join(', ');
    const filas = await this.clienteSql.consultar(
      `
        SELECT id
        FROM monitores
        WHERE id IN (${placeholders})
      `,
      idsNormalizados
    );

    return new Set(
      filas
        .map((fila) => Number.parseInt(String(fila.id), 10))
        .filter((id) => Number.isInteger(id) && id > 0)
    );
  }

  normalizarEstadoPersistible(estado) {
    if (!estado || typeof estado.serializar !== 'function') {
      return null;
    }

    const serializado = estado.serializar();
    const monitorId = Number.parseInt(String(serializado.monitorId), 10);

    if (!Number.isInteger(monitorId) || monitorId <= 0) {
      return null;
    }

    return {
      monitorId,
      versionCatalogo: String(serializado.versionCatalogo || '').trim(),
      estado: String(serializado.estado || 'desconocido').trim().toLowerCase(),
      ejecutadoTodavia: Boolean(serializado.ejecutadoTodavia),
      pendienteScheduler: Boolean(serializado.pendienteScheduler),
      fechaUltimaEjecucionUtc: normalizarFechaMysqlUtc(
        serializado.fechaUltimaEjecucionUtc
      ),
      fechaUltimoCambioUtc: normalizarFechaMysqlUtc(
        serializado.fechaUltimoCambioUtc
      ),
      resultadoActual: serializado.resultadoActual ?? null,
      motivoInicial: String(
        serializado.motivoInicial || 'pendiente_de_scheduler'
      ).trim()
    };
  }
}
