import { Sitio } from './Sitio.js';
import {
  TABLAS_HISTORICAS_CAMBIO_EMPRESA_SITIO,
  TABLAS_VIVAS_CAMBIO_EMPRESA_SITIO
} from './CatalogoScopeOrganizativo.js';

export class RepositorioSitios {
  constructor(clienteSql) {
    this.clienteSql = clienteSql;
  }

  async listarVisibles(contextoUsuarioActual) {
    const { where, parametros } = this.construirFiltroScope(contextoUsuarioActual);
    const filas = await this.clienteSql.consultar(
      `
        SELECT
          s.*,
          t.nombre AS tenant_nombre,
          e.nombre AS empresa_nombre,
          (
            SELECT COUNT(*)
            FROM monitores m
            WHERE m.sitio_id = s.id
          ) AS total_monitores,
          (
            SELECT COUNT(*)
            FROM usuarios u
            WHERE u.sitio_id = s.id
          ) AS total_usuarios,
          (
            SELECT COUNT(*)
            FROM triggers tr
            WHERE tr.sitio_id = s.id
          ) AS total_automatizaciones,
          (
            SELECT COUNT(*)
            FROM zonas_dns z
            WHERE z.sitio_id = s.id
          ) AS total_zonas_dns,
          (
            SELECT COUNT(*)
            FROM agentes_sentinelia a
            WHERE a.sitio_id = s.id
          ) AS total_agentes
        FROM sitios s
        INNER JOIN tenants t ON t.id = s.tenant_id
        INNER JOIN empresas e ON e.id = s.empresa_id
        ${where}
        ORDER BY t.nombre ASC, e.nombre ASC, s.nombre ASC, s.id ASC
      `,
      parametros
    );

    return filas.map((fila) => new Sitio(fila));
  }

  async buscarPorId(idSitio) {
    const filas = await this.clienteSql.consultar(
      `
        SELECT
          s.*,
          t.nombre AS tenant_nombre,
          e.nombre AS empresa_nombre,
          (
            SELECT COUNT(*)
            FROM monitores m
            WHERE m.sitio_id = s.id
          ) AS total_monitores,
          (
            SELECT COUNT(*)
            FROM usuarios u
            WHERE u.sitio_id = s.id
          ) AS total_usuarios,
          (
            SELECT COUNT(*)
            FROM triggers tr
            WHERE tr.sitio_id = s.id
          ) AS total_automatizaciones,
          (
            SELECT COUNT(*)
            FROM zonas_dns z
            WHERE z.sitio_id = s.id
          ) AS total_zonas_dns,
          (
            SELECT COUNT(*)
            FROM agentes_sentinelia a
            WHERE a.sitio_id = s.id
          ) AS total_agentes
        FROM sitios s
        INNER JOIN tenants t ON t.id = s.tenant_id
        INNER JOIN empresas e ON e.id = s.empresa_id
        WHERE s.id = ?
        LIMIT 1
      `,
      [idSitio]
    );

    return filas.length > 0 ? new Sitio(filas[0]) : null;
  }

  async buscarPorIds(idsSitio) {
    const ids = normalizarIdsAgrupados(idsSitio);
    if (ids.length === 0) return [];
    const filas = await this.clienteSql.consultar(
      `SELECT s.*, t.nombre AS tenant_nombre, e.nombre AS empresa_nombre
         FROM sitios s
         INNER JOIN tenants t ON t.id = s.tenant_id
         INNER JOIN empresas e ON e.id = s.empresa_id
        WHERE s.id IN (${ids.map(() => '?').join(',')})`,
      ids
    );
    return filas.map((fila) => new Sitio(fila));
  }

  async listarVisiblesPaginado(
    contextoUsuarioActual,
    {
      textoBusqueda = '',
      tenantId = null,
      empresaId = null,
      pagina = 1,
      tamanoPagina = 25,
      ordenarPor = 'nombre',
      direccionOrden = 'asc'
    } = {}
  ) {
    const filtro = this.construirFiltroListado(
      contextoUsuarioActual,
      textoBusqueda,
      tenantId,
      empresaId
    );
    const tamanoNormalizado = this.normalizarTamanoPagina(tamanoPagina);
    const paginaNormalizada = this.normalizarPagina(pagina);
    const orden = this.resolverOrdenListado(ordenarPor, direccionOrden);

    const [filaTotalVisible, filaTotalFiltrado] = await Promise.all([
      this.clienteSql.consultar(
        `
          SELECT COUNT(*) AS total
          FROM sitios s
          INNER JOIN tenants t ON t.id = s.tenant_id
          INNER JOIN empresas e ON e.id = s.empresa_id
          ${filtro.whereScope}
        `,
        filtro.parametrosScope
      ),
      this.clienteSql.consultar(
        `
          SELECT COUNT(*) AS total
          FROM sitios s
          INNER JOIN tenants t ON t.id = s.tenant_id
          INNER JOIN empresas e ON e.id = s.empresa_id
          ${filtro.whereCompleto}
        `,
        filtro.parametrosCompletos
      )
    ]);

    const totalVisible = Number(filaTotalVisible[0]?.total || 0);
    const totalFiltrado = Number(filaTotalFiltrado[0]?.total || 0);
    const totalPaginas = Math.max(
      1,
      Math.ceil(totalFiltrado / tamanoNormalizado)
    );
    const paginaEfectiva = Math.min(paginaNormalizada, totalPaginas);
    const offset = (paginaEfectiva - 1) * tamanoNormalizado;

    const filas = await this.clienteSql.consultar(
      `
        SELECT
          s.*,
          t.nombre AS tenant_nombre,
          e.nombre AS empresa_nombre
        FROM sitios s
        INNER JOIN tenants t ON t.id = s.tenant_id
        INNER JOIN empresas e ON e.id = s.empresa_id
        ${filtro.whereCompleto}
        ORDER BY ${orden.campo} ${orden.direccion}, s.id ${orden.direccion}
        LIMIT ? OFFSET ?
      `,
      [...filtro.parametrosCompletos, tamanoNormalizado, offset]
    );

    return {
      sitios: filas.map((fila) => new Sitio(fila)),
      paginacion: {
        pagina: paginaEfectiva,
        tamanoPagina: tamanoNormalizado,
        totalVisible,
        totalFiltrado,
        totalPaginas
      }
    };
  }

  async crear({ tenantId, empresaId, nombre, alias, timezone, descripcion, estado }) {
    const [resultado] = await this.clienteSql.ejecutar(
      `
        INSERT INTO sitios (
          tenant_id,
          empresa_id,
          nombre,
          alias,
          timezone,
          descripcion,
          estado,
          configuracion
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
      `,
      [tenantId, empresaId, nombre, alias, timezone, descripcion || null, estado]
    );

    return this.buscarPorId(resultado.insertId);
  }

  async actualizar({ idSitio, nombre, alias, timezone, descripcion, estado }) {
    await this.clienteSql.ejecutar(
      `
        UPDATE sitios
        SET
          nombre = ?,
          alias = ?,
          timezone = ?,
          descripcion = ?,
          estado = ?
        WHERE id = ?
      `,
      [nombre, alias, timezone, descripcion || null, estado, idSitio]
    );

    return this.buscarPorId(idSitio);
  }

  async calcularImpactoCambioEmpresa({
    idSitio,
    empresaDestinoId,
    aliasActual
  }) {
    const [
      filasVivas,
      filasHistoricas,
      totalSitiosConflictoAlias
    ] = await Promise.all([
      this.contarFilasPorSitioEnTablas(
        TABLAS_VIVAS_CAMBIO_EMPRESA_SITIO,
        idSitio
      ),
      this.contarFilasPorSitioEnTablas(
        TABLAS_HISTORICAS_CAMBIO_EMPRESA_SITIO,
        idSitio
      ),
      this.contarConflictosAliasEnEmpresa({
        idSitio,
        empresaDestinoId,
        alias: aliasActual
      })
    ]);

    return {
      actualizacionesVivas: [{ tabla: 'sitios', total: 1 }, ...filasVivas],
      referenciasHistoricas: filasHistoricas,
      bloqueosPotenciales:
        totalSitiosConflictoAlias > 0
          ? [
              {
                tabla: 'sitios',
                regla: 'ALIAS_DUPLICADO',
                total: totalSitiosConflictoAlias
              }
            ]
          : []
    };
  }

  async trasladarEmpresa({
    idSitio,
    tenantDestinoId,
    empresaDestinoId,
    nombre,
    alias,
    timezone,
    descripcion,
    estado
  }) {
    const conexion = await this.clienteSql.obtenerConexion();

    try {
      await conexion.beginTransaction();

      const ejecutorTransaccion = {
        consultar: async (sql, parametros) => {
          const [filas] = await conexion.execute(sql, parametros);
          return filas;
        }
      };
      const totalConflictosAlias = await this.contarConflictosAliasEnEmpresa(
        {
          idSitio,
          empresaDestinoId,
          alias
        },
        ejecutorTransaccion
      );

      if (totalConflictosAlias > 0) {
        const error = new Error(
          'Ya existe otro sitio con ese alias dentro de la empresa de destino.'
        );
        error.code = 'ER_DUP_ENTRY';
        throw error;
      }

      await conexion.query('SET FOREIGN_KEY_CHECKS = 0');

      await conexion.execute(
        `
          UPDATE sitios
          SET
            tenant_id = ?,
            empresa_id = ?,
            nombre = ?,
            alias = ?,
            timezone = ?,
            descripcion = ?,
            estado = ?
          WHERE id = ?
        `,
        [
          tenantDestinoId,
          empresaDestinoId,
          nombre,
          alias,
          timezone,
          descripcion || null,
          estado,
          idSitio
        ]
      );

      await this.actualizarScopeEnTablasSitio(
        conexion,
        TABLAS_VIVAS_CAMBIO_EMPRESA_SITIO,
        {
          tenantDestinoId,
          empresaDestinoId,
          idSitio
        }
      );

      await this.actualizarScopeEnTablasSitio(
        conexion,
        TABLAS_HISTORICAS_CAMBIO_EMPRESA_SITIO.filter(
          (tabla) => tabla !== 'ejecuciones_triggers'
        ),
        {
          tenantDestinoId,
          empresaDestinoId,
          idSitio
        }
      );
      await this.actualizarScopeEnEjecucionesTriggerSitio(
        conexion,
        {
          tenantDestinoId,
          empresaDestinoId,
          idSitio
        }
      );

      await conexion.query('SET FOREIGN_KEY_CHECKS = 1');
      await conexion.commit();
    } catch (error) {
      try {
        await conexion.query('SET FOREIGN_KEY_CHECKS = 1');
      } catch (_errorSecundario) {
        // Intento best effort para restaurar la sesión antes de propagar.
      }

      await conexion.rollback();
      throw error;
    } finally {
      conexion.release();
    }

    return this.buscarPorId(idSitio);
  }

  async eliminar(idSitio) {
    const [resultado] = await this.clienteSql.ejecutar(
      `
        DELETE FROM sitios
        WHERE id = ?
      `,
      [idSitio]
    );

    return resultado.affectedRows > 0;
  }

  construirFiltroScope(contextoUsuarioActual) {
    if (contextoUsuarioActual?.nivelScope === 'portal') {
      return { where: '', parametros: [] };
    }

    if (contextoUsuarioActual?.nivelScope === 'tenant') {
      return {
        where: 'WHERE s.tenant_id = ?',
        parametros: [contextoUsuarioActual.tenantId]
      };
    }

    if (contextoUsuarioActual?.nivelScope === 'empresa') {
      return {
        where: 'WHERE s.empresa_id = ?',
        parametros: [contextoUsuarioActual.empresaId]
      };
    }

    if (contextoUsuarioActual?.nivelScope === 'sitio') {
      return {
        where: 'WHERE s.id = ?',
        parametros: [contextoUsuarioActual.sitioId]
      };
    }

    return {
      where: 'WHERE 1 = 0',
      parametros: []
    };
  }

  construirFiltroListado(
    contextoUsuarioActual,
    textoBusqueda = '',
    tenantId = null,
    empresaId = null
  ) {
    const filtroScope = this.construirFiltroScope(contextoUsuarioActual);
    const condiciones = [];
    const parametros = [];
    const textoNormalizado = String(textoBusqueda || '').trim();

    if (filtroScope.where) {
      condiciones.push(filtroScope.where.replace(/^WHERE\s+/i, ''));
      parametros.push(...filtroScope.parametros);
    }

    if (textoNormalizado) {
      const patron = `%${textoNormalizado}%`;
      condiciones.push(
        `(
          s.nombre LIKE ?
          OR s.alias LIKE ?
          OR COALESCE(s.descripcion, '') LIKE ?
          OR COALESCE(s.timezone, '') LIKE ?
          OR t.nombre LIKE ?
          OR e.nombre LIKE ?
        )`
      );
      parametros.push(patron, patron, patron, patron, patron, patron);
    }

    if (tenantId != null) {
      condiciones.push('s.tenant_id = ?');
      parametros.push(Number(tenantId));
    }

    if (empresaId != null) {
      condiciones.push('s.empresa_id = ?');
      parametros.push(Number(empresaId));
    }

    return {
      whereScope: filtroScope.where,
      parametrosScope: filtroScope.parametros,
      whereCompleto:
        condiciones.length > 0 ? `WHERE ${condiciones.join(' AND ')}` : '',
      parametrosCompletos: parametros
    };
  }

  resolverOrdenListado(ordenarPor, direccionOrden) {
    const columnas = {
      id: 's.id',
      tenant: 't.nombre',
      empresa: 'e.nombre',
      nombre: 's.nombre',
      alias: 's.alias',
      timezone: 's.timezone',
      descripcion: 's.descripcion',
      estado: 's.estado',
      creado: 's.fecha_creacion',
      actualizado: 's.fecha_actualizacion'
    };
    const campo = columnas[String(ordenarPor || '').trim()] || 's.nombre';
    const direccion =
      String(direccionOrden || '').trim().toLowerCase() === 'desc'
        ? 'DESC'
        : 'ASC';

    return { campo, direccion };
  }

  normalizarPagina(valor) {
    const pagina = Number.parseInt(String(valor || '1'), 10);

    if (!Number.isFinite(pagina) || pagina < 1) {
      return 1;
    }

    return pagina;
  }

  normalizarTamanoPagina(valor) {
    const tamano = Number.parseInt(String(valor || '25'), 10);
    return [10, 25, 50, 100].includes(tamano) ? tamano : 25;
  }

  async contarFilasPorSitio(tabla, idSitio, ejecutor = this.clienteSql) {
    if (tabla === 'ejecuciones_triggers') {
      return this.contarFilasEjecucionesTriggerPorSitio(idSitio, ejecutor);
    }

    const filas = await ejecutor.consultar(
      `
        SELECT COUNT(*) AS total
        FROM ${tabla}
        WHERE sitio_id = ?
      `,
      [idSitio]
    );

    return Number(filas[0]?.total || 0);
  }

  async contarFilasPorSitioEnTablas(
    tablas,
    idSitio,
    ejecutor = this.clienteSql
  ) {
    const totales = await Promise.all(
      tablas.map(async (tabla) => ({
        tabla,
        total: await this.contarFilasPorSitio(tabla, idSitio, ejecutor)
      }))
    );

    return totales;
  }

  async contarFilasEjecucionesTriggerPorSitio(
    idSitio,
    ejecutor = this.clienteSql
  ) {
    const filas = await ejecutor.consultar(
      `
        SELECT COUNT(*) AS total
        FROM ejecuciones_triggers
        WHERE sitio_id = ?
          OR monitor_sitio_id = ?
          OR trigger_sitio_id = ?
      `,
      [idSitio, idSitio, idSitio]
    );

    return Number(filas[0]?.total || 0);
  }

  async contarConflictosAliasEnEmpresa(
    { idSitio, empresaDestinoId, alias },
    ejecutor = this.clienteSql
  ) {
    const filas = await ejecutor.consultar(
      `
        SELECT COUNT(*) AS total
        FROM sitios
        WHERE empresa_id = ?
          AND alias = ?
          AND id <> ?
      `,
      [empresaDestinoId, alias, idSitio]
    );

    return Number(filas[0]?.total || 0);
  }

  async actualizarScopeEnFilasSitio(
    conexion,
    tabla,
    { tenantDestinoId, empresaDestinoId, idSitio }
  ) {
    await conexion.execute(
      `
        UPDATE ${tabla}
        SET
          tenant_id = ?,
          empresa_id = ?
        WHERE sitio_id = ?
      `,
      [tenantDestinoId, empresaDestinoId, idSitio]
    );
  }

  async actualizarScopeEnTablasSitio(
    conexion,
    tablas,
    { tenantDestinoId, empresaDestinoId, idSitio }
  ) {
    for (const tabla of tablas) {
      await this.actualizarScopeEnFilasSitio(
        conexion,
        tabla,
        {
          tenantDestinoId,
          empresaDestinoId,
          idSitio
        }
      );
    }
  }

  async actualizarScopeEnEjecucionesTriggerSitio(
    conexion,
    { tenantDestinoId, empresaDestinoId, idSitio }
  ) {
    await conexion.execute(
      `
        UPDATE ejecuciones_triggers
        SET
          tenant_id = CASE
            WHEN sitio_id = ? THEN ?
            ELSE tenant_id
          END,
          empresa_id = CASE
            WHEN sitio_id = ? THEN ?
            ELSE empresa_id
          END,
          monitor_tenant_id = CASE
            WHEN monitor_sitio_id = ? THEN ?
            ELSE monitor_tenant_id
          END,
          monitor_empresa_id = CASE
            WHEN monitor_sitio_id = ? THEN ?
            ELSE monitor_empresa_id
          END,
          trigger_tenant_id = CASE
            WHEN trigger_sitio_id = ? THEN ?
            ELSE trigger_tenant_id
          END,
          trigger_empresa_id = CASE
            WHEN trigger_sitio_id = ? THEN ?
            ELSE trigger_empresa_id
          END
        WHERE sitio_id = ?
          OR monitor_sitio_id = ?
          OR trigger_sitio_id = ?
      `,
      [
        idSitio,
        tenantDestinoId,
        idSitio,
        empresaDestinoId,
        idSitio,
        tenantDestinoId,
        idSitio,
        empresaDestinoId,
        idSitio,
        tenantDestinoId,
        idSitio,
        empresaDestinoId,
        idSitio,
        idSitio,
        idSitio
      ]
    );
  }
}

function normalizarIdsAgrupados(valores) {
  return [...new Set((valores || []).map((valor) => {
    const id = Number(valor);
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Identidad de sitio inválida.');
    return id;
  }))];
}
