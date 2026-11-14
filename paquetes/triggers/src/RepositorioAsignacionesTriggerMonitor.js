import { AsignacionTriggerMonitor } from './AsignacionTriggerMonitor.js';
import { normalizarTipoTrigger } from './CatalogoTiposTrigger.js';
import {
  normalizarEventoDisparoTrigger,
  normalizarEventosDisparoTrigger,
  tieneEventoDisparoTrigger
} from './eventosDisparoTrigger.js';

export class RepositorioAsignacionesTriggerMonitor {
  constructor(clienteSql) {
    this.clienteSql = clienteSql;
  }

  async buscarPorId(idAsignacion, { conexion = null } = {}) {
    const asignacionId = this.normalizarId(idAsignacion);

    if (asignacionId == null) {
      return null;
    }

    const filas = await consultar(
      conexion || this.clienteSql,
      `
        SELECT
          ${this.columnasSeleccion('atm')}
        FROM asignaciones_triggers_monitores atm
        INNER JOIN monitores m ON m.id = atm.monitor_id
        INNER JOIN triggers t ON t.id = atm.trigger_id
        INNER JOIN tenants tn ON tn.id = m.tenant_id
        INNER JOIN empresas e ON e.id = m.empresa_id
        LEFT JOIN sitios s ON s.id = m.sitio_id
        WHERE atm.id = ?
        LIMIT 1
      `,
      [asignacionId]
    );

    return filas.length > 0 ? new AsignacionTriggerMonitor(filas[0]) : null;
  }

  async listarPorMonitorId(idMonitor, { soloActivas = false } = {}) {
    const monitorId = this.normalizarId(idMonitor);

    if (monitorId == null) {
      return [];
    }

    const condiciones = ['atm.monitor_id = ?'];
    const parametros = [monitorId];

    if (soloActivas) {
      condiciones.push('atm.activo = 1', 't.activo = 1');
    }

    const filas = await this.clienteSql.consultar(
      `
        SELECT
          ${this.columnasSeleccion('atm')}
        FROM asignaciones_triggers_monitores atm
        INNER JOIN monitores m ON m.id = atm.monitor_id
        INNER JOIN triggers t ON t.id = atm.trigger_id
        INNER JOIN tenants tn ON tn.id = m.tenant_id
        INNER JOIN empresas e ON e.id = m.empresa_id
        LEFT JOIN sitios s ON s.id = m.sitio_id
        WHERE ${condiciones.join(' AND ')}
        ORDER BY atm.orden_ejecucion ASC, atm.id ASC
      `,
      parametros
    );

    return filas.map((fila) => new AsignacionTriggerMonitor(fila));
  }

  async listarPorMonitorIds(idsMonitor = [], { soloActivas = false } = {}) {
    if (!Array.isArray(idsMonitor) || idsMonitor.length === 0) {
      return [];
    }

    const idsNormalizados = idsMonitor
      .map((id) => this.normalizarId(id))
      .filter(Boolean);

    if (idsNormalizados.length === 0) {
      return [];
    }

    const placeholders = idsNormalizados.map(() => '?').join(', ');
    const condiciones = [`atm.monitor_id IN (${placeholders})`];

    if (soloActivas) {
      condiciones.push('atm.activo = 1', 't.activo = 1');
    }

    const filas = await this.clienteSql.consultar(
      `
        SELECT
          ${this.columnasSeleccion('atm')}
        FROM asignaciones_triggers_monitores atm
        INNER JOIN monitores m ON m.id = atm.monitor_id
        INNER JOIN triggers t ON t.id = atm.trigger_id
        INNER JOIN tenants tn ON tn.id = m.tenant_id
        INNER JOIN empresas e ON e.id = m.empresa_id
        LEFT JOIN sitios s ON s.id = m.sitio_id
        WHERE ${condiciones.join(' AND ')}
        ORDER BY atm.monitor_id ASC, atm.orden_ejecucion ASC, atm.id ASC
      `,
      idsNormalizados
    );

    return filas.map((fila) => new AsignacionTriggerMonitor(fila));
  }

  async listarPorTriggerId(idTrigger, { soloActivas = false } = {}) {
    const triggerId = this.normalizarId(idTrigger);

    if (triggerId == null) {
      return [];
    }

    const condiciones = ['atm.trigger_id = ?'];
    const parametros = [triggerId];

    if (soloActivas) {
      condiciones.push('atm.activo = 1');
    }

    const filas = await this.clienteSql.consultar(
      `
        SELECT
          ${this.columnasSeleccion('atm')}
        FROM asignaciones_triggers_monitores atm
        INNER JOIN monitores m ON m.id = atm.monitor_id
        INNER JOIN triggers t ON t.id = atm.trigger_id
        INNER JOIN tenants tn ON tn.id = m.tenant_id
        INNER JOIN empresas e ON e.id = m.empresa_id
        LEFT JOIN sitios s ON s.id = m.sitio_id
        WHERE ${condiciones.join(' AND ')}
        ORDER BY atm.orden_ejecucion ASC, atm.id ASC
      `,
      parametros
    );

    return filas.map((fila) => new AsignacionTriggerMonitor(fila));
  }

  async resumirUsoPorTriggerIdsVisible(contextoUsuarioActual, idsTrigger = []) {
    if (!Array.isArray(idsTrigger) || idsTrigger.length === 0) {
      return new Map();
    }

    const idsNormalizados = idsTrigger
      .map((id) => this.normalizarId(id))
      .filter(Boolean);

    if (idsNormalizados.length === 0) {
      return new Map();
    }

    const placeholders = idsNormalizados.map(() => '?').join(', ');
    const { condiciones, parametros } =
      this.construirCondicionesScope(contextoUsuarioActual);
    condiciones.push(`atm.trigger_id IN (${placeholders})`);
    const filas = await this.clienteSql.consultar(
      `
        SELECT
          atm.trigger_id,
          COUNT(*) AS total_vinculos,
          SUM(CASE WHEN atm.activo = 1 THEN 1 ELSE 0 END) AS total_vinculos_activos,
          SUM(CASE WHEN atm.activo = 0 THEN 1 ELSE 0 END) AS total_vinculos_inactivos,
          COUNT(DISTINCT atm.monitor_id) AS total_monitores,
          COUNT(DISTINCT CASE WHEN atm.activo = 1 THEN atm.monitor_id ELSE NULL END) AS total_monitores_activos
        FROM asignaciones_triggers_monitores atm
        INNER JOIN monitores m ON m.id = atm.monitor_id
        INNER JOIN triggers t ON t.id = atm.trigger_id
        INNER JOIN tenants tn ON tn.id = m.tenant_id
        INNER JOIN empresas e ON e.id = m.empresa_id
        LEFT JOIN sitios s ON s.id = m.sitio_id
        WHERE ${condiciones.join(' AND ')}
        GROUP BY atm.trigger_id
      `,
      [...parametros, ...idsNormalizados]
    );

    return new Map(
      filas.map((fila) => [
        Number(fila.trigger_id),
        {
          totalVinculos: Number(fila.total_vinculos || 0),
          totalVinculosActivos: Number(fila.total_vinculos_activos || 0),
          totalVinculosInactivos: Number(fila.total_vinculos_inactivos || 0),
          totalMonitores: Number(fila.total_monitores || 0),
          totalMonitoresActivos: Number(fila.total_monitores_activos || 0)
        }
      ])
    );
  }

  async listarAplicablesPorMonitorIdsYEventoDisparo(
    idsMonitor = [],
    eventoDisparo,
    { soloActivas = true } = {}
  ) {
    const eventoNormalizado = normalizarEventoDisparoTrigger(eventoDisparo);
    const asignaciones = await this.listarPorMonitorIds(idsMonitor, {
      soloActivas
    });

    return asignaciones.filter((asignacion) =>
      tieneEventoDisparoTrigger(asignacion.eventosDisparo, eventoNormalizado)
    );
  }

  async crear({
    monitorId,
    triggerId,
    activo = true,
    ordenEjecucion = 100,
    eventosDisparo = ['apertura_alerta'],
    configuracionOverride = null
  }, { conexion = null } = {}) {
    const fila = this.normalizarAsignacionPersistible({
      monitorId,
      triggerId,
      activo,
      ordenEjecucion,
      eventosDisparo,
      configuracionOverride
    });

    const [resultado] = await ejecutar(
      conexion || this.clienteSql,
      `
        INSERT INTO asignaciones_triggers_monitores (
          monitor_id,
          trigger_id,
          activo,
          orden_ejecucion,
          eventos_disparo,
          configuracion_override
        ) VALUES (?, ?, ?, ?, ?, ?)
      `,
      [
        fila.monitorId,
        fila.triggerId,
        fila.activo ? 1 : 0,
        fila.ordenEjecucion,
        JSON.stringify(fila.eventosDisparo),
        fila.configuracionOverride == null
          ? null
          : JSON.stringify(fila.configuracionOverride)
      ]
    );

    return this.buscarPorId(resultado.insertId, { conexion });
  }

  async actualizar({
    idAsignacion,
    monitorId,
    triggerId,
    activo = true,
    ordenEjecucion = 100,
    eventosDisparo = ['apertura_alerta'],
    configuracionOverride = null
  }, { conexion = null } = {}) {
    const asignacionId = this.normalizarId(idAsignacion);

    if (asignacionId == null) {
      throw new Error('El id de la asignación monitor-trigger no es válido.');
    }

    const fila = this.normalizarAsignacionPersistible({
      monitorId,
      triggerId,
      activo,
      ordenEjecucion,
      eventosDisparo,
      configuracionOverride
    });

    await ejecutar(
      conexion || this.clienteSql,
      `
        UPDATE asignaciones_triggers_monitores
        SET
          monitor_id = ?,
          trigger_id = ?,
          activo = ?,
          orden_ejecucion = ?,
          eventos_disparo = ?,
          configuracion_override = ?
        WHERE id = ?
      `,
      [
        fila.monitorId,
        fila.triggerId,
        fila.activo ? 1 : 0,
        fila.ordenEjecucion,
        JSON.stringify(fila.eventosDisparo),
        fila.configuracionOverride == null
          ? null
          : JSON.stringify(fila.configuracionOverride),
        asignacionId
      ]
    );

    return this.buscarPorId(asignacionId, { conexion });
  }

  async eliminar(idAsignacion, { conexion = null } = {}) {
    const asignacionId = this.normalizarId(idAsignacion);

    if (asignacionId == null) {
      return false;
    }

    const [resultado] = await ejecutar(
      conexion || this.clienteSql,
      `
        DELETE FROM asignaciones_triggers_monitores
        WHERE id = ?
      `,
      [asignacionId]
    );

    return Number(resultado.affectedRows || 0) > 0;
  }

  async eliminarPorMonitorId(idMonitor) {
    const monitorId = this.normalizarId(idMonitor);

    if (monitorId == null) {
      return 0;
    }

    const [resultado] = await this.clienteSql.ejecutar(
      `
        DELETE FROM asignaciones_triggers_monitores
        WHERE monitor_id = ?
      `,
      [monitorId]
    );

    return Number(resultado.affectedRows || 0);
  }

  async eliminarPorTriggerId(idTrigger) {
    const triggerId = this.normalizarId(idTrigger);

    if (triggerId == null) {
      return 0;
    }

    const [resultado] = await this.clienteSql.ejecutar(
      `
        DELETE FROM asignaciones_triggers_monitores
        WHERE trigger_id = ?
      `,
      [triggerId]
    );

    return Number(resultado.affectedRows || 0);
  }

  async listarPaginadoVisible(
    contextoUsuarioActual,
    {
      textoBusqueda = '',
      triggerId = null,
      monitorId = null,
      tenantId = null,
      empresaId = null,
      tipo = null,
      activo = 'todos',
      eventoDisparo = null,
      pagina = 1,
      tamanoPagina = 10,
      ordenarPor = 'actualizado',
      direccionOrden = 'desc'
    } = {}
  ) {
    const consulta = this.construirConsultaListado(contextoUsuarioActual, {
      textoBusqueda,
      triggerId,
      monitorId,
      tenantId,
      empresaId,
      tipo,
      activo,
      eventoDisparo
    });
    const tamanoNormalizado = this.normalizarTamanoPagina(tamanoPagina);
    const paginaSolicitada = this.normalizarPagina(pagina);
    const orden = this.resolverOrdenListado(ordenarPor, direccionOrden);
    const [totalVisible, resumen] = await Promise.all([
      this.contarVisible(contextoUsuarioActual),
      this.resumirFiltrado(contextoUsuarioActual, {
        textoBusqueda,
        triggerId,
        monitorId,
        tenantId,
        empresaId,
        tipo,
        activo,
        eventoDisparo
      })
    ]);
    const totalFiltrado = Number(resumen.totalAsignaciones || 0);
    const totalPaginas = Math.max(1, Math.ceil(totalFiltrado / tamanoNormalizado));
    const paginaEfectiva = Math.min(paginaSolicitada, totalPaginas);
    const offset = (paginaEfectiva - 1) * tamanoNormalizado;
    const filas = await this.clienteSql.consultar(
      `
        SELECT
          ${this.columnasSeleccion('atm')}
        FROM asignaciones_triggers_monitores atm
        INNER JOIN monitores m ON m.id = atm.monitor_id
        INNER JOIN triggers t ON t.id = atm.trigger_id
        INNER JOIN tenants tn ON tn.id = m.tenant_id
        INNER JOIN empresas e ON e.id = m.empresa_id
        LEFT JOIN sitios s ON s.id = m.sitio_id
        ${consulta.where}
        ORDER BY ${orden.campo} ${orden.direccion}, atm.id ${orden.direccion}
        LIMIT ? OFFSET ?
      `,
      [...consulta.parametros, tamanoNormalizado, offset]
    );

    return {
      asignaciones: filas.map((fila) => new AsignacionTriggerMonitor(fila)),
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

  columnasSeleccion(alias) {
    return `
      ${alias}.id,
      ${alias}.monitor_id,
      ${alias}.trigger_id,
      ${alias}.activo,
      ${alias}.orden_ejecucion,
      ${alias}.eventos_disparo,
      ${alias}.configuracion_override,
      ${alias}.fecha_creacion,
      ${alias}.fecha_actualizacion,
      m.nombre AS monitor_nombre,
      m.tipo AS monitor_tipo,
      m.activo AS monitor_activo,
      m.tenant_id,
      m.empresa_id,
      m.sitio_id,
      tn.nombre AS tenant_nombre,
      e.nombre AS empresa_nombre,
      s.nombre AS sitio_nombre,
      t.nombre AS trigger_nombre,
      t.descripcion AS trigger_descripcion,
      t.tipo AS trigger_tipo,
      t.activo AS trigger_activo
    `;
  }

  construirConsultaListado(
    contextoUsuarioActual,
    {
      textoBusqueda = '',
      triggerId = null,
      monitorId = null,
      tenantId = null,
      empresaId = null,
      tipo = null,
      activo = 'todos',
      eventoDisparo = null
    } = {}
  ) {
    const { condiciones, parametros } =
      this.construirCondicionesScope(contextoUsuarioActual);
    const textoNormalizado = String(textoBusqueda || '').trim();
    const triggerIdNormalizado = this.normalizarId(triggerId);
    const monitorIdNormalizado = this.normalizarId(monitorId);
    const tenantNormalizado = this.normalizarId(tenantId);
    const empresaNormalizada = this.normalizarId(empresaId);
    const tipoNormalizado = this.normalizarTipoOpcional(tipo);
    const eventoNormalizado = this.normalizarEventoOpcional(eventoDisparo);

    if (textoNormalizado) {
      const patron = `%${textoNormalizado}%`;
      condiciones.push(
        `(
          m.nombre LIKE ?
          OR COALESCE(tn.nombre, '') LIKE ?
          OR COALESCE(e.nombre, '') LIKE ?
          OR COALESCE(s.nombre, '') LIKE ?
        )`
      );
      parametros.push(patron, patron, patron, patron);
    }

    if (triggerIdNormalizado != null) {
      condiciones.push('atm.trigger_id = ?');
      parametros.push(triggerIdNormalizado);
    }

    if (monitorIdNormalizado != null) {
      condiciones.push('atm.monitor_id = ?');
      parametros.push(monitorIdNormalizado);
    }

    if (tenantNormalizado != null) {
      condiciones.push('m.tenant_id = ?');
      parametros.push(tenantNormalizado);
    }

    if (empresaNormalizada != null) {
      condiciones.push('m.empresa_id = ?');
      parametros.push(empresaNormalizada);
    }

    if (tipoNormalizado) {
      condiciones.push('t.tipo = ?');
      parametros.push(tipoNormalizado);
    }

    if (activo === 'solo_activos') {
      condiciones.push('atm.activo = 1');
    } else if (activo === 'solo_inactivos') {
      condiciones.push('atm.activo = 0');
    }

    if (eventoNormalizado) {
      condiciones.push('atm.eventos_disparo LIKE ?');
      parametros.push(`%\"${eventoNormalizado}\"%`);
    }

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
        FROM asignaciones_triggers_monitores atm
        INNER JOIN monitores m ON m.id = atm.monitor_id
        INNER JOIN triggers t ON t.id = atm.trigger_id
        INNER JOIN tenants tn ON tn.id = m.tenant_id
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
    const filas = await this.clienteSql.consultar(
      `
        SELECT
          COUNT(*) AS total_asignaciones,
          SUM(CASE WHEN atm.activo = 1 THEN 1 ELSE 0 END) AS total_activas,
          SUM(CASE WHEN atm.activo = 0 THEN 1 ELSE 0 END) AS total_inactivas,
          COUNT(DISTINCT atm.monitor_id) AS total_monitores,
          COUNT(DISTINCT atm.trigger_id) AS total_triggers
        FROM asignaciones_triggers_monitores atm
        INNER JOIN monitores m ON m.id = atm.monitor_id
        INNER JOIN triggers t ON t.id = atm.trigger_id
        INNER JOIN tenants tn ON tn.id = m.tenant_id
        INNER JOIN empresas e ON e.id = m.empresa_id
        LEFT JOIN sitios s ON s.id = m.sitio_id
        ${consulta.where}
      `,
      consulta.parametros
    );

    const fila = filas[0] || {};
    return {
      totalAsignaciones: Number(fila.total_asignaciones || 0),
      totalActivas: Number(fila.total_activas || 0),
      totalInactivas: Number(fila.total_inactivas || 0),
      totalMonitores: Number(fila.total_monitores || 0),
      totalTriggers: Number(fila.total_triggers || 0)
    };
  }

  resolverOrdenListado(ordenarPor, direccionOrden) {
    const columnas = {
      monitor: 'm.nombre',
      trigger: 'atm.trigger_id',
      tipo: 't.tipo',
      tenant: 'tn.nombre',
      empresa: 'e.nombre',
      activo: 'atm.activo',
      orden: 'atm.orden_ejecucion',
      creado: 'atm.fecha_creacion',
      actualizado: 'atm.fecha_actualizacion'
    };
    const campo = columnas[String(ordenarPor || '').trim().toLowerCase()] || 'atm.fecha_actualizacion';
    const direccion =
      String(direccionOrden || '').trim().toLowerCase() === 'asc'
        ? 'ASC'
        : 'DESC';

    return { campo, direccion };
  }

  normalizarPagina(valor) {
    const numero = Number.parseInt(String(valor ?? ''), 10);
    return Number.isInteger(numero) && numero > 0 ? numero : 1;
  }

  normalizarTamanoPagina(valor) {
    const numero = Number.parseInt(String(valor ?? ''), 10);
    const permitidos = [10, 25, 50, 100];
    return permitidos.includes(numero) ? numero : 10;
  }

  normalizarTipoOpcional(valor) {
    try {
      return normalizarTipoTrigger(valor, { opcional: true });
    } catch {
      return null;
    }
  }

  normalizarEventoOpcional(valor) {
    const normalizado = String(valor || '').trim().toLowerCase();
    return ['apertura_alerta', 'cierre_alerta'].includes(normalizado)
      ? normalizado
      : null;
  }

  normalizarAsignacionPersistible(asignacion) {
    if (!asignacion) {
      throw new Error('La asignación monitor-trigger es obligatoria.');
    }

    const serializada =
      typeof asignacion.serializarPersistencia === 'function'
        ? asignacion.serializarPersistencia()
        : asignacion;
    const monitorId = this.normalizarId(serializada.monitorId);
    const triggerId = this.normalizarId(serializada.triggerId);

    if (monitorId == null) {
      throw new Error('El monitor asociado a la asignación no es válido.');
    }

    if (triggerId == null) {
      throw new Error('El trigger asociado a la asignación no es válido.');
    }

    return {
      monitorId,
      triggerId,
      activo: Boolean(serializada.activo),
      ordenEjecucion: this.normalizarOrdenEjecucion(
        serializada.ordenEjecucion
      ),
      eventosDisparo: normalizarEventosDisparoTrigger(
        serializada.eventosDisparo,
        { porDefecto: ['apertura_alerta'] }
      ),
      configuracionOverride: this.normalizarOverride(
        serializada.configuracionOverride
      )
    };
  }

  normalizarId(valor) {
    const convertido = Number.parseInt(String(valor ?? ''), 10);
    return Number.isInteger(convertido) && convertido > 0 ? convertido : null;
  }

  normalizarOrdenEjecucion(valor) {
    const convertido = Number.parseInt(String(valor ?? ''), 10);

    if (!Number.isInteger(convertido) || convertido < 0 || convertido > 65535) {
      throw new Error(
        'El orden de ejecución del binding monitor-trigger debe estar entre 0 y 65535.'
      );
    }

    return convertido;
  }

  normalizarOverride(valor) {
    if (valor == null || valor === '') {
      return null;
    }

    if (typeof valor === 'string') {
      try {
        valor = JSON.parse(valor);
      } catch (_error) {
        throw new Error(
          'La configuración override del binding monitor-trigger debe ser JSON válido.'
        );
      }
    }

    if (!valor || typeof valor !== 'object' || Array.isArray(valor)) {
      throw new Error(
        'La configuración override del binding monitor-trigger debe ser un objeto JSON.'
      );
    }

    return JSON.parse(JSON.stringify(valor));
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
