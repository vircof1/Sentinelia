import { crearMonitorDesdeFila } from './Monitor.js';
import {
  existeTipoMonitor,
  normalizarTipoMonitor
} from './CatalogoTiposMonitor.js';

export class RepositorioMonitores {
  constructor(clienteSql) {
    this.clienteSql = clienteSql;
  }

  // Lectura actual con bloqueo: serializa la persistencia de un resultado
  // frente a los cambios administrativos, incluso con un catálogo en memoria antiguo.
  async bloquearPorIds(idsMonitores, { conexion } = {}) {
    if (typeof conexion?.execute !== 'function') {
      throw new Error('Bloquear monitores exige una conexión transaccional.');
    }
    const ids = [...new Set(idsMonitores.map(Number).filter(
      (id) => Number.isSafeInteger(id) && id > 0
    ))].sort((a, b) => a - b);
    if (ids.length === 0) return [];
    const [filas] = await conexion.execute(
      `SELECT id, activo, fecha_actualizacion, fecha_creacion
       FROM monitores WHERE id IN (${ids.map(() => '?').join(', ')})
       ORDER BY id FOR UPDATE`,
      ids
    );
    return filas;
  }

  async listarVisibles(contextoUsuarioActual) {
    const { where, parametros } = this.construirFiltroScope(contextoUsuarioActual);
    const filas = await this.clienteSql.consultar(
      `
        SELECT
          ${this.columnasSeleccionMonitor('m')},
          ${this.columnasSeleccionEstadoActual('eam')},
          t.nombre AS tenant_nombre,
          e.nombre AS empresa_nombre,
          s.nombre AS sitio_nombre
        FROM monitores m
        INNER JOIN tenants t ON t.id = m.tenant_id
        INNER JOIN empresas e ON e.id = m.empresa_id
        LEFT JOIN sitios s ON s.id = m.sitio_id
        LEFT JOIN estado_actual_monitores eam ON eam.monitor_id = m.id
        ${where}
        ORDER BY t.nombre ASC, e.nombre ASC, m.nombre ASC, m.id ASC
      `,
      parametros
    );

    return filas.map((fila) => crearMonitorDesdeFila(fila));
  }

  async buscarPorId(idMonitor, { conexion = null } = {}) {
    const filas = await consultar(
      conexion || this.clienteSql,
      `
        SELECT
          ${this.columnasSeleccionMonitor('m')},
          ${this.columnasSeleccionEstadoActual('eam')},
          t.nombre AS tenant_nombre,
          e.nombre AS empresa_nombre,
          s.nombre AS sitio_nombre
        FROM monitores m
        INNER JOIN tenants t ON t.id = m.tenant_id
        INNER JOIN empresas e ON e.id = m.empresa_id
        LEFT JOIN sitios s ON s.id = m.sitio_id
        LEFT JOIN estado_actual_monitores eam ON eam.monitor_id = m.id
        WHERE m.id = ?
        LIMIT 1
      `,
      [idMonitor]
    );

    return filas.length > 0 ? crearMonitorDesdeFila(filas[0]) : null;
  }

  async listarPorIds(idsMonitores = []) {
    const idsNormalizados = [...new Set(
      (Array.isArray(idsMonitores) ? idsMonitores : [])
        .map((idMonitor) => this.normalizarNumeroEntero(idMonitor))
        .filter((idMonitor) => idMonitor != null && idMonitor > 0)
    )];

    if (idsNormalizados.length === 0) {
      return [];
    }

    const placeholders = idsNormalizados.map(() => '?').join(', ');
    const filas = await this.clienteSql.consultar(
      `
        SELECT
          ${this.columnasSeleccionMonitor('m')},
          ${this.columnasSeleccionEstadoActual('eam')},
          t.nombre AS tenant_nombre,
          e.nombre AS empresa_nombre,
          s.nombre AS sitio_nombre
        FROM monitores m
        INNER JOIN tenants t ON t.id = m.tenant_id
        INNER JOIN empresas e ON e.id = m.empresa_id
        LEFT JOIN sitios s ON s.id = m.sitio_id
        LEFT JOIN estado_actual_monitores eam ON eam.monitor_id = m.id
        WHERE m.id IN (${placeholders})
        ORDER BY m.id ASC
      `,
      idsNormalizados
    );

    return filas.map((fila) => crearMonitorDesdeFila(fila));
  }

  async listarActivosParaRuntime() {
    const filas = await this.clienteSql.consultar(
      `
        SELECT
          ${this.columnasSeleccionMonitor('m')},
          ${this.columnasSeleccionEstadoActual('eam')},
          t.nombre AS tenant_nombre,
          e.nombre AS empresa_nombre,
          s.nombre AS sitio_nombre
        FROM monitores m
        INNER JOIN tenants t ON t.id = m.tenant_id
        INNER JOIN empresas e ON e.id = m.empresa_id
        LEFT JOIN sitios s ON s.id = m.sitio_id
        LEFT JOIN estado_actual_monitores eam ON eam.monitor_id = m.id
        WHERE m.activo = 1
        ORDER BY
          m.intervalo_ejecucion_segundos ASC,
          m.desfase_inicial_segundos ASC,
          m.id ASC
      `
    );

    return filas.map((fila) => crearMonitorDesdeFila(fila));
  }

  async listarPaginadoVisible(
    contextoUsuarioActual,
    {
      textoBusqueda = '',
      tipo = null,
      tenantId = null,
      empresaId = null,
      sitioId = null,
      nivelPertenencia = null,
      activo = 'todos',
      entradaMonitorId = null,
      agenteTelemetriaId = null,
      senalTelemetriaId = null,
      reglaTelemetriaId = null,
      pagina = 1,
      tamanoPagina = 10,
      ordenarPor = 'nombre',
      direccionOrden = 'asc'
    } = {}
  ) {
    const consulta = this.construirConsultaListado(contextoUsuarioActual, {
      textoBusqueda,
      tipo,
      tenantId,
      empresaId,
      sitioId,
      nivelPertenencia,
      activo,
      entradaMonitorId,
      agenteTelemetriaId,
      senalTelemetriaId,
      reglaTelemetriaId
    });
    const tamanoNormalizado = this.normalizarTamanoPagina(tamanoPagina);
    const paginaSolicitada = this.normalizarPagina(pagina);
    const orden = this.resolverOrdenListado(ordenarPor, direccionOrden);

    const [totalVisible, resumen] = await Promise.all([
      this.contarVisible(contextoUsuarioActual),
      this.resumirFiltrado(contextoUsuarioActual, {
        textoBusqueda,
        tipo,
        tenantId,
        empresaId,
        sitioId,
        nivelPertenencia,
        activo,
        entradaMonitorId,
        agenteTelemetriaId,
        senalTelemetriaId,
        reglaTelemetriaId
      })
    ]);
    const totalFiltrado = Number(resumen.totalMonitores || 0);
    const totalPaginas = Math.max(1, Math.ceil(totalFiltrado / tamanoNormalizado));
    const paginaEfectiva = Math.min(paginaSolicitada, totalPaginas);
    const offset = (paginaEfectiva - 1) * tamanoNormalizado;
    const filas = await this.clienteSql.consultar(
      `
        SELECT
          ${this.columnasSeleccionMonitor('m')},
          ${this.columnasSeleccionEstadoActual('eam')},
          t.nombre AS tenant_nombre,
          e.nombre AS empresa_nombre,
          s.nombre AS sitio_nombre
        FROM monitores m
        INNER JOIN tenants t ON t.id = m.tenant_id
        INNER JOIN empresas e ON e.id = m.empresa_id
        LEFT JOIN sitios s ON s.id = m.sitio_id
        LEFT JOIN estado_actual_monitores eam ON eam.monitor_id = m.id
        ${consulta.where}
        ORDER BY ${orden.clausula}
        LIMIT ? OFFSET ?
      `,
      [...consulta.parametros, tamanoNormalizado, offset]
    );

    return {
      monitores: filas.map((fila) => crearMonitorDesdeFila(fila)),
      resumen,
      paginacion: {
        pagina: paginaEfectiva,
        tamanoPagina: tamanoNormalizado,
        totalVisible,
        totalFiltrado,
        totalPaginas
      }
    };
  }

  async crear({
    tenantId,
    empresaId,
    sitioId,
    nombre,
    tipo,
    descripcion,
    interpretacionEstado,
    descripcionFallo,
    posibleSolucion,
    activo,
    intervaloEjecucionSegundos,
    desfaseInicialSegundos,
    inferenciasIndisponibleConsecutivas = 1,
    inferenciasDisponibleConsecutivas = 1,
    entradaComposicionBooleana = false,
    configuracion = null
  }, { conexion = null } = {}) {
    const [resultado] = await ejecutar(
      conexion || this.clienteSql,
      `
        INSERT INTO monitores (
          tenant_id,
          empresa_id,
          sitio_id,
          nombre,
          tipo,
          descripcion,
          interpretacion_estado,
          descripcion_fallo,
          posible_solucion,
          activo,
          intervalo_ejecucion_segundos,
          desfase_inicial_segundos,
          inferencias_indisponible_consecutivas,
          inferencias_disponible_consecutivas,
          entrada_composicion_booleana,
          configuracion
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        tenantId,
        empresaId,
        sitioId,
        nombre,
        tipo,
        descripcion || null,
        interpretacionEstado,
        descripcionFallo,
        posibleSolucion,
        activo ? 1 : 0,
        intervaloEjecucionSegundos,
        desfaseInicialSegundos,
        inferenciasIndisponibleConsecutivas,
        inferenciasDisponibleConsecutivas,
        entradaComposicionBooleana ? 1 : 0,
        configuracion == null ? null : JSON.stringify(configuracion)
      ]
    );

    return this.buscarPorId(resultado.insertId, { conexion });
  }

  async actualizarCompleto({
    idMonitor,
    tenantId,
    empresaId,
    sitioId,
    nombre,
    tipo,
    descripcion,
    interpretacionEstado,
    descripcionFallo,
    posibleSolucion,
    activo,
    intervaloEjecucionSegundos,
    desfaseInicialSegundos,
    inferenciasIndisponibleConsecutivas = 1,
    inferenciasDisponibleConsecutivas = 1,
    entradaComposicionBooleana = false,
    configuracion = null
  }, { conexion = null } = {}) {
    await ejecutar(
      conexion || this.clienteSql,
      `
        UPDATE monitores
        SET
          tenant_id = ?,
          empresa_id = ?,
          sitio_id = ?,
          nombre = ?,
          tipo = ?,
          descripcion = ?,
          interpretacion_estado = ?,
          descripcion_fallo = ?,
          posible_solucion = ?,
          activo = ?,
          intervalo_ejecucion_segundos = ?,
          desfase_inicial_segundos = ?,
          inferencias_indisponible_consecutivas = ?,
          inferencias_disponible_consecutivas = ?,
          entrada_composicion_booleana = ?,
          configuracion = ?
        WHERE id = ?
      `,
      [
        tenantId,
        empresaId,
        sitioId,
        nombre,
        tipo,
        descripcion || null,
        interpretacionEstado,
        descripcionFallo,
        posibleSolucion,
        activo ? 1 : 0,
        intervaloEjecucionSegundos,
        desfaseInicialSegundos,
        inferenciasIndisponibleConsecutivas,
        inferenciasDisponibleConsecutivas,
        entradaComposicionBooleana ? 1 : 0,
        configuracion == null ? null : JSON.stringify(configuracion),
        idMonitor
      ]
    );

    return this.buscarPorId(idMonitor, { conexion });
  }

  async eliminar(idMonitor, { conexion = null } = {}) {
    const [resultado] = await ejecutar(
      conexion || this.clienteSql,
      `
        DELETE FROM monitores
        WHERE id = ?
      `,
      [idMonitor]
    );

    return resultado.affectedRows > 0;
  }

  async resumirImpactoEliminacion(idMonitor) {
    const filas = await this.clienteSql.consultar(
      `
        SELECT
          (SELECT COUNT(*) FROM eventos_monitores WHERE monitor_id = ?) AS eventos,
          (SELECT COUNT(*) FROM historico_monitores WHERE monitor_id = ?) AS tramosHistorico,
          (SELECT COUNT(*) FROM alertas_activas_monitores WHERE monitor_id = ?) AS alertasActivas,
          (SELECT COUNT(*) FROM asignaciones_triggers_monitores WHERE monitor_id = ?) AS vinculosTriggers,
          (SELECT COUNT(*) FROM ejecuciones_triggers WHERE monitor_id = ?) AS ejecucionesTriggersConservadas
      `,
      Array(5).fill(idMonitor)
    );
    const dependencias = await this.clienteSql.consultar(
      `
        SELECT configuracion
        FROM monitores
        WHERE tipo = 'booleano' AND id <> ?
      `,
      [idMonitor]
    );
    const monitoresLogicosDependientes = dependencias.filter((fila) => {
      let configuracion = fila.configuracion;
      if (typeof configuracion === 'string') {
        try {
          configuracion = JSON.parse(configuracion);
        } catch (_error) {
          return false;
        }
      }
      return Array.isArray(configuracion?.dependencias) &&
        configuracion.dependencias.some((dependencia) =>
          dependencia?.fuente === 'monitor' &&
          Number(dependencia.monitorId) === Number(idMonitor)
        );
    }).length;

    return {
      eventos: Number(filas[0]?.eventos || 0),
      tramosHistorico: Number(filas[0]?.tramosHistorico || 0),
      alertasActivas: Number(filas[0]?.alertasActivas || 0),
      vinculosTriggers: Number(filas[0]?.vinculosTriggers || 0),
      ejecucionesTriggersConservadas: Number(filas[0]?.ejecucionesTriggersConservadas || 0),
      monitoresLogicosDependientes
    };
  }

  columnasSeleccionMonitor(alias) {
    return `
      ${alias}.id,
      ${alias}.tenant_id,
      ${alias}.empresa_id,
      ${alias}.sitio_id,
      ${alias}.nombre,
      ${alias}.tipo,
      ${alias}.descripcion,
      ${alias}.interpretacion_estado,
      ${alias}.descripcion_fallo,
      ${alias}.posible_solucion,
      ${alias}.activo,
      ${alias}.intervalo_ejecucion_segundos,
      ${alias}.desfase_inicial_segundos,
      ${alias}.inferencias_indisponible_consecutivas,
      ${alias}.inferencias_disponible_consecutivas,
      ${alias}.entrada_composicion_booleana,
      ${alias}.configuracion,
      ${alias}.fecha_creacion,
      ${alias}.fecha_actualizacion
    `;
  }

  columnasSeleccionEstadoActual(alias) {
    return `
      ${alias}.monitor_id AS estado_actual_monitor_monitor_id,
      ${alias}.estado AS estado_actual_monitor_estado,
      ${alias}.ejecutado_todavia AS estado_actual_monitor_ejecutado_todavia,
      ${alias}.pendiente_scheduler AS estado_actual_monitor_pendiente_scheduler,
      ${alias}.fecha_ultima_ejecucion_utc AS estado_actual_monitor_fecha_ultima_ejecucion_utc,
      ${alias}.fecha_ultimo_cambio_utc AS estado_actual_monitor_fecha_ultimo_cambio_utc,
      ${alias}.resultado_actual AS estado_actual_monitor_resultado_actual
    `;
  }

  construirConsultaListado(
    contextoUsuarioActual,
    {
      textoBusqueda = '',
      tipo = null,
      tenantId = null,
      empresaId = null,
      sitioId = null,
      nivelPertenencia = null,
      activo = 'todos',
      entradaMonitorId = null,
      agenteTelemetriaId = null,
      senalTelemetriaId = null,
      reglaTelemetriaId = null
    } = {}
  ) {
    const { condiciones, parametros } =
      this.construirCondicionesScope(contextoUsuarioActual);
    const textoNormalizado = String(textoBusqueda || '').trim();
    const tipoNormalizado = this.normalizarTipoOpcional(tipo);
    const tenantNormalizado = this.normalizarIdOpcional(tenantId);
    const empresaNormalizada = this.normalizarIdOpcional(empresaId);
    const sitioNormalizado = this.normalizarIdOpcional(sitioId);
    const pertenenciaNormalizada =
      this.normalizarNivelPertenenciaOpcional(nivelPertenencia);
    const entradaMonitorNormalizada = this.normalizarIdOpcional(entradaMonitorId);
    const agenteTelemetriaNormalizado =
      this.normalizarIdOpcional(agenteTelemetriaId);
    const senalTelemetriaNormalizada =
      this.normalizarIdOpcional(senalTelemetriaId);
    const reglaTelemetriaNormalizada =
      this.normalizarIdOpcional(reglaTelemetriaId);

    if (textoNormalizado) {
      const patron = `%${textoNormalizado}%`;
      condiciones.push(
        `(
          m.nombre LIKE ?
          OR COALESCE(m.descripcion, '') LIKE ?
          OR m.tipo LIKE ?
          OR COALESCE(t.nombre, '') LIKE ?
          OR COALESCE(e.nombre, '') LIKE ?
          OR COALESCE(s.nombre, '') LIKE ?
        )`
      );
      parametros.push(patron, patron, patron, patron, patron, patron);
    }

    if (tipoNormalizado) {
      condiciones.push('m.tipo = ?');
      parametros.push(tipoNormalizado);
    }

    if (tenantNormalizado != null) {
      condiciones.push('m.tenant_id = ?');
      parametros.push(tenantNormalizado);
    }

    if (empresaNormalizada != null) {
      condiciones.push('m.empresa_id = ?');
      parametros.push(empresaNormalizada);
    }

    if (sitioNormalizado != null) {
      condiciones.push('m.sitio_id = ?');
      parametros.push(sitioNormalizado);
    }

    if (pertenenciaNormalizada === 'empresa') {
      condiciones.push('m.sitio_id IS NULL');
    } else if (pertenenciaNormalizada === 'sitio') {
      condiciones.push('m.sitio_id IS NOT NULL');
    }

    if (activo === 'solo_activos') {
      condiciones.push('m.activo = 1');
    } else if (activo === 'solo_inactivos') {
      condiciones.push('m.activo = 0');
    }

    if (entradaMonitorNormalizada != null) {
      condiciones.push("m.tipo = 'booleano'");
      condiciones.push(
        "JSON_CONTAINS(m.configuracion, JSON_OBJECT('monitorId', ?), '$.dependencias')"
      );
      parametros.push(entradaMonitorNormalizada);
    }

    if (reglaTelemetriaNormalizada != null) {
      const condicionesVinculo = [
        'vmt.monitor_id = m.id',
        "vmt.tipo_fuente = 'regla_derivacion'",
        'vmt.regla_id = ?'
      ];
      const parametrosVinculo = [reglaTelemetriaNormalizada];

      if (agenteTelemetriaNormalizado != null) {
        condicionesVinculo.push('rdt.agente_id = ?');
        parametrosVinculo.push(agenteTelemetriaNormalizado);
      }
      if (senalTelemetriaNormalizada != null) {
        condicionesVinculo.push('rdt.senal_id = ?');
        parametrosVinculo.push(senalTelemetriaNormalizada);
      }

      condiciones.push(`EXISTS (
        SELECT 1
        FROM vinculos_monitores_telemetria vmt
        INNER JOIN reglas_derivacion_telemetria rdt
          ON rdt.id = vmt.regla_id
        WHERE ${condicionesVinculo.join(' AND ')}
      )`);
      parametros.push(...parametrosVinculo);
    }

    return {
      where: condiciones.length > 0 ? `WHERE ${condiciones.join(' AND ')}` : '',
      parametros
    };
  }

  construirFiltroScope(contextoUsuarioActual) {
    const { condiciones, parametros } =
      this.construirCondicionesScope(contextoUsuarioActual);

    return {
      where: condiciones.length > 0 ? `WHERE ${condiciones.join(' AND ')}` : '',
      parametros
    };
  }

  construirCondicionesScope(contextoUsuarioActual) {
    if (contextoUsuarioActual?.nivelScope === 'portal') {
      return { condiciones: [], parametros: [] };
    }

    if (contextoUsuarioActual?.nivelScope === 'tenant') {
      return {
        condiciones: ['m.tenant_id = ?'],
        parametros: [contextoUsuarioActual.tenantId]
      };
    }

    if (contextoUsuarioActual?.nivelScope === 'empresa') {
      return {
        condiciones: ['m.empresa_id = ?'],
        parametros: [contextoUsuarioActual.empresaId]
      };
    }

    if (contextoUsuarioActual?.nivelScope === 'sitio') {
      return {
        condiciones: ['m.sitio_id = ?'],
        parametros: [contextoUsuarioActual.sitioId]
      };
    }

    return {
      condiciones: ['1 = 0'],
      parametros: []
    };
  }

  async contarVisible(contextoUsuarioActual) {
    const consulta = this.construirConsultaListado(contextoUsuarioActual, {
      activo: 'todos'
    });
    const filas = await this.clienteSql.consultar(
      `
        SELECT COUNT(*) AS total
        FROM monitores m
        INNER JOIN tenants t ON t.id = m.tenant_id
        INNER JOIN empresas e ON e.id = m.empresa_id
        LEFT JOIN sitios s ON s.id = m.sitio_id
        ${consulta.where}
      `,
      consulta.parametros
    );

    return Number(filas[0]?.total || 0);
  }

  async contarFiltradoVisible(contextoUsuarioActual, filtros = {}) {
    const consulta = this.construirConsultaListado(contextoUsuarioActual, filtros);
    const filas = await this.clienteSql.consultar(
      `
        SELECT COUNT(*) AS total
        FROM monitores m
        INNER JOIN tenants t ON t.id = m.tenant_id
        INNER JOIN empresas e ON e.id = m.empresa_id
        LEFT JOIN sitios s ON s.id = m.sitio_id
        ${consulta.where}
      `,
      consulta.parametros
    );

    return Number(filas[0]?.total || 0);
  }

  async resumirFiltrado(contextoUsuarioActual, filtros = {}) {
    const consulta = this.construirConsultaListado(contextoUsuarioActual, filtros);
    const [filas, resumenTipos] = await Promise.all([
      this.clienteSql.consultar(
        `
          SELECT
            COUNT(*) AS total_monitores,
            SUM(CASE WHEN m.sitio_id IS NULL THEN 1 ELSE 0 END) AS total_empresa,
            SUM(CASE WHEN m.sitio_id IS NOT NULL THEN 1 ELSE 0 END) AS total_sitio,
            SUM(CASE WHEN m.activo = 1 THEN 1 ELSE 0 END) AS total_activos,
            SUM(CASE WHEN m.activo = 0 THEN 1 ELSE 0 END) AS total_inactivos,
            ROUND(
              AVG(
                CASE
                  WHEN m.tipo = 'ping' THEN CAST(
                    JSON_UNQUOTE(JSON_EXTRACT(m.configuracion, '$.tamanoPaqueteBytes')) AS DECIMAL(10, 2)
                  )
                  ELSE NULL
                END
              ),
              1
            ) AS ping_payload_medio,
            MIN(
              CASE
                WHEN m.tipo = 'ping' THEN CAST(
                  JSON_UNQUOTE(JSON_EXTRACT(m.configuracion, '$.tamanoPaqueteBytes')) AS UNSIGNED
                )
                ELSE NULL
              END
            ) AS ping_payload_minimo,
            MAX(
              CASE
                WHEN m.tipo = 'ping' THEN CAST(
                  JSON_UNQUOTE(JSON_EXTRACT(m.configuracion, '$.tamanoPaqueteBytes')) AS UNSIGNED
                )
                ELSE NULL
              END
            ) AS ping_payload_maximo,
            ROUND(
              AVG(
                CASE
                  WHEN m.tipo = 'ping' THEN CAST(
                    JSON_UNQUOTE(JSON_EXTRACT(m.configuracion, '$.ttl')) AS DECIMAL(10, 2)
                  )
                  ELSE NULL
                END
              ),
              1
            ) AS ping_ttl_medio,
            MIN(
              CASE
                WHEN m.tipo = 'ping' THEN CAST(
                  JSON_UNQUOTE(JSON_EXTRACT(m.configuracion, '$.ttl')) AS UNSIGNED
                )
                ELSE NULL
              END
            ) AS ping_ttl_minimo,
            MAX(
              CASE
                WHEN m.tipo = 'ping' THEN CAST(
                  JSON_UNQUOTE(JSON_EXTRACT(m.configuracion, '$.ttl')) AS UNSIGNED
                )
                ELSE NULL
              END
            ) AS ping_ttl_maximo,
            COUNT(
              DISTINCT CASE
                WHEN m.tipo = 'tcp' THEN CAST(
                  JSON_UNQUOTE(JSON_EXTRACT(m.configuracion, '$.puerto')) AS UNSIGNED
                )
                ELSE NULL
              END
            ) AS tcp_puertos_distintos,
            MIN(
              CASE
                WHEN m.tipo = 'tcp' THEN CAST(
                  JSON_UNQUOTE(JSON_EXTRACT(m.configuracion, '$.puerto')) AS UNSIGNED
                )
                ELSE NULL
              END
            ) AS tcp_puerto_minimo,
            MAX(
              CASE
                WHEN m.tipo = 'tcp' THEN CAST(
                  JSON_UNQUOTE(JSON_EXTRACT(m.configuracion, '$.puerto')) AS UNSIGNED
                )
                ELSE NULL
              END
            ) AS tcp_puerto_maximo,
            SUM(
              CASE
                WHEN m.tipo = 'tcp'
                  AND LOWER(
                    COALESCE(JSON_UNQUOTE(JSON_EXTRACT(m.configuracion, '$.usarTls')), 'false')
                  ) IN ('1', 'true')
                THEN 1
                ELSE 0
              END
            ) AS tcp_tls_si,
            SUM(
              CASE
                WHEN m.tipo = 'tcp'
                  AND LOWER(
                    COALESCE(JSON_UNQUOTE(JSON_EXTRACT(m.configuracion, '$.usarTls')), 'false')
                  ) IN ('0', 'false')
                THEN 1
                ELSE 0
              END
            ) AS tcp_tls_no,
            SUM(
              CASE
                WHEN m.tipo = 'tcp'
                  AND LOWER(
                    COALESCE(JSON_UNQUOTE(JSON_EXTRACT(m.configuracion, '$.usarTls')), 'false')
                  ) IN ('1', 'true')
                  AND CAST(
                    COALESCE(
                      JSON_UNQUOTE(JSON_EXTRACT(m.configuracion, '$.vigenciaMinimaCertDias')),
                      '0'
                    ) AS UNSIGNED
                  ) > 0
                THEN 1
                ELSE 0
              END
            ) AS tcp_tls_con_vigencia_minima,
            MIN(
              CASE
                WHEN m.tipo = 'tcp'
                  AND LOWER(
                    COALESCE(JSON_UNQUOTE(JSON_EXTRACT(m.configuracion, '$.usarTls')), 'false')
                  ) IN ('1', 'true')
                  AND CAST(
                    COALESCE(
                      JSON_UNQUOTE(JSON_EXTRACT(m.configuracion, '$.vigenciaMinimaCertDias')),
                      '0'
                    ) AS UNSIGNED
                  ) > 0
                THEN CAST(
                  COALESCE(
                    JSON_UNQUOTE(JSON_EXTRACT(m.configuracion, '$.vigenciaMinimaCertDias')),
                    '0'
                  ) AS UNSIGNED
                )
                ELSE NULL
              END
            ) AS tcp_vigencia_minima_minima,
            MAX(
              CASE
                WHEN m.tipo = 'tcp'
                  AND LOWER(
                    COALESCE(JSON_UNQUOTE(JSON_EXTRACT(m.configuracion, '$.usarTls')), 'false')
                  ) IN ('1', 'true')
                  AND CAST(
                    COALESCE(
                      JSON_UNQUOTE(JSON_EXTRACT(m.configuracion, '$.vigenciaMinimaCertDias')),
                      '0'
                    ) AS UNSIGNED
                  ) > 0
                THEN CAST(
                  COALESCE(
                    JSON_UNQUOTE(JSON_EXTRACT(m.configuracion, '$.vigenciaMinimaCertDias')),
                    '0'
                  ) AS UNSIGNED
                )
                ELSE NULL
              END
            ) AS tcp_vigencia_minima_maxima
          FROM monitores m
          INNER JOIN tenants t ON t.id = m.tenant_id
          INNER JOIN empresas e ON e.id = m.empresa_id
          LEFT JOIN sitios s ON s.id = m.sitio_id
          ${consulta.where}
        `,
        consulta.parametros
      ),
      this.resumirTiposFiltrados(contextoUsuarioActual, filtros)
    ]);
    const porTipo = this.construirDistribucionTipos(resumenTipos);

    return {
      totalMonitores: Number(filas[0]?.total_monitores || 0),
      porTipo,
      totalPing: Number(porTipo.ping || 0),
      totalTcp: Number(porTipo.tcp || 0),
      totalEmpresa: Number(filas[0]?.total_empresa || 0),
      totalSitio: Number(filas[0]?.total_sitio || 0),
      totalActivos: Number(filas[0]?.total_activos || 0),
      totalInactivos: Number(filas[0]?.total_inactivos || 0),
      ping: {
        payloadMedio: this.normalizarNumeroDecimal(filas[0]?.ping_payload_medio),
        payloadMinimo: this.normalizarNumeroEntero(filas[0]?.ping_payload_minimo),
        payloadMaximo: this.normalizarNumeroEntero(filas[0]?.ping_payload_maximo),
        ttlMedio: this.normalizarNumeroDecimal(filas[0]?.ping_ttl_medio),
        ttlMinimo: this.normalizarNumeroEntero(filas[0]?.ping_ttl_minimo),
        ttlMaximo: this.normalizarNumeroEntero(filas[0]?.ping_ttl_maximo)
      },
      tcp: {
        puertosDistintos: this.normalizarNumeroEntero(
          filas[0]?.tcp_puertos_distintos
        ),
        puertoMinimo: this.normalizarNumeroEntero(filas[0]?.tcp_puerto_minimo),
        puertoMaximo: this.normalizarNumeroEntero(filas[0]?.tcp_puerto_maximo),
        totalTlsSi: this.normalizarNumeroEntero(filas[0]?.tcp_tls_si, 0),
        totalTlsNo: this.normalizarNumeroEntero(filas[0]?.tcp_tls_no, 0),
        totalTlsConVigenciaMinima: this.normalizarNumeroEntero(
          filas[0]?.tcp_tls_con_vigencia_minima,
          0
        ),
        vigenciaMinimaMinima: this.normalizarNumeroEntero(
          filas[0]?.tcp_vigencia_minima_minima
        ),
        vigenciaMinimaMaxima: this.normalizarNumeroEntero(
          filas[0]?.tcp_vigencia_minima_maxima
        )
      }
    };
  }

  async resumirTiposFiltrados(contextoUsuarioActual, filtros = {}) {
    const consulta = this.construirConsultaListado(contextoUsuarioActual, filtros);
    return this.clienteSql.consultar(
      `
        SELECT
          m.tipo AS tipo,
          COUNT(*) AS total
        FROM monitores m
        INNER JOIN tenants t ON t.id = m.tenant_id
        INNER JOIN empresas e ON e.id = m.empresa_id
        LEFT JOIN sitios s ON s.id = m.sitio_id
        ${consulta.where}
        GROUP BY m.tipo
      `,
      consulta.parametros
    );
  }

  construirDistribucionTipos(filas = []) {
    const distribucion = {};

    for (const fila of filas) {
      const tipo = normalizarTipoMonitor(fila?.tipo).slice(0, 40);

      if (!tipo) {
        continue;
      }

      distribucion[tipo] = Number(fila?.total || 0);
    }

    return distribucion;
  }

  normalizarNumeroEntero(valor, porDefecto = null) {
    if (valor == null || valor === '') {
      return porDefecto;
    }

    const numero = Number.parseInt(String(valor), 10);
    return Number.isInteger(numero) ? numero : porDefecto;
  }

  normalizarNumeroDecimal(valor, porDefecto = null) {
    if (valor == null || valor === '') {
      return porDefecto;
    }

    const numero = Number.parseFloat(String(valor));
    return Number.isFinite(numero) ? numero : porDefecto;
  }

  resolverOrdenListado(ordenarPor, direccionOrden) {
    const columnas = {
      id: 'm.id',
      nombre: 'm.nombre',
      tipo: 'm.tipo',
      tenant: 'COALESCE(t.nombre, \'\')',
      empresa: 'COALESCE(e.nombre, \'\')',
      sitio: 'COALESCE(s.nombre, \'\')',
      activo: 'm.activo',
      intervalo: 'm.intervalo_ejecucion_segundos',
      desfase: 'm.desfase_inicial_segundos',
      creado: 'm.fecha_creacion',
      actualizado: 'm.fecha_actualizacion'
    };
    const campo = columnas[String(ordenarPor || '').trim()] || 'm.nombre';
    const direccion = String(direccionOrden || '').toLowerCase() === 'desc'
      ? 'DESC'
      : 'ASC';
    const campos = String(ordenarPor || '').trim() === 'ubicacion'
      ? [
          'COALESCE(t.nombre, \'\')',
          'COALESCE(e.nombre, \'\')',
          'COALESCE(s.nombre, \'\')'
        ]
      : [campo];

    return {
      campo,
      direccion,
      clausula: [...campos, 'm.id']
        .map((campoOrden) => `${campoOrden} ${direccion}`)
        .join(', ')
    };
  }

  normalizarPagina(valor) {
    const pagina = Number.parseInt(String(valor), 10);
    return Number.isInteger(pagina) && pagina > 0 ? pagina : 1;
  }

  normalizarTamanoPagina(valor) {
    const tamano = Number.parseInt(String(valor), 10);

    if (!Number.isInteger(tamano) || tamano <= 0) {
      return 10;
    }

    return Math.min(tamano, 100);
  }

  normalizarIdOpcional(valor) {
    if (valor === undefined || valor === null || String(valor).trim() === '') {
      return null;
    }

    const convertido = Number.parseInt(String(valor), 10);
    return Number.isInteger(convertido) && convertido > 0 ? convertido : null;
  }

  normalizarTipoOpcional(valor) {
    const normalizado = normalizarTipoMonitor(valor);
    return existeTipoMonitor(normalizado) ? normalizado : null;
  }

  normalizarNivelPertenenciaOpcional(valor) {
    const normalizado = String(valor || '').trim().toLowerCase();
    return ['empresa', 'sitio'].includes(normalizado) ? normalizado : null;
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
