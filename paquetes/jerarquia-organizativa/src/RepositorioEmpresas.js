import { Empresa } from './Empresa.js';
import {
  TABLAS_HISTORICAS_CAMBIO_TENANT_EMPRESA,
  TABLAS_VIVAS_CAMBIO_TENANT_EMPRESA
} from './CatalogoScopeOrganizativo.js';

export class RepositorioEmpresas {
  constructor(clienteSql) {
    this.clienteSql = clienteSql;
  }

  async listarVisibles(contextoUsuarioActual) {
    const { where, parametros } = this.construirFiltroScope(contextoUsuarioActual);
    const filas = await this.clienteSql.consultar(
      `
        SELECT
          e.*,
          t.nombre AS tenant_nombre,
          (
            SELECT COUNT(*)
            FROM sitios s
            WHERE s.empresa_id = e.id
          ) AS total_sitios
        FROM empresas e
        INNER JOIN tenants t ON t.id = e.tenant_id
        ${where}
        ORDER BY t.nombre ASC, e.nombre ASC, e.id ASC
      `,
      parametros
    );

    return filas.map((fila) => new Empresa(fila));
  }

  async buscarPorId(idEmpresa) {
    const filas = await this.clienteSql.consultar(
      `
        SELECT
          e.*,
          t.nombre AS tenant_nombre,
          (
            SELECT COUNT(*)
            FROM sitios s
            WHERE s.empresa_id = e.id
          ) AS total_sitios,
          (
            SELECT COUNT(*)
            FROM usuarios u
            WHERE u.empresa_id = e.id
          ) AS total_usuarios,
          (
            SELECT COUNT(*)
            FROM monitores m
            WHERE m.empresa_id = e.id
          ) AS total_monitores,
          (
            SELECT COUNT(*)
            FROM agentes_sentinelia a
            WHERE a.empresa_id = e.id
          ) AS total_agentes,
          (
            SELECT COUNT(*)
            FROM triggers tr
            WHERE tr.empresa_id = e.id
          ) AS total_automatizaciones
        FROM empresas e
        INNER JOIN tenants t ON t.id = e.tenant_id
        WHERE e.id = ?
        LIMIT 1
      `,
      [idEmpresa]
    );

    return filas.length > 0 ? new Empresa(filas[0]) : null;
  }

  async buscarPorIds(idsEmpresa) {
    const ids = normalizarIdsAgrupados(idsEmpresa);
    if (ids.length === 0) return [];
    const filas = await this.clienteSql.consultar(
      `SELECT e.*, t.nombre AS tenant_nombre
         FROM empresas e
         INNER JOIN tenants t ON t.id = e.tenant_id
        WHERE e.id IN (${ids.map(() => '?').join(',')})`,
      ids
    );
    return filas.map((fila) => new Empresa(fila));
  }

  async listarVisiblesPaginado(
    contextoUsuarioActual,
    {
      textoBusqueda = '',
      tenantId = null,
      pagina = 1,
      tamanoPagina = 25,
      ordenarPor = 'nombre',
      direccionOrden = 'asc'
    } = {}
  ) {
    const filtro = this.construirFiltroListado(
      contextoUsuarioActual,
      textoBusqueda,
      tenantId
    );
    const tamanoNormalizado = this.normalizarTamanoPagina(tamanoPagina);
    const paginaNormalizada = this.normalizarPagina(pagina);
    const orden = this.resolverOrdenListado(ordenarPor, direccionOrden);

    const [filaTotalVisible, filaTotalFiltrado] = await Promise.all([
      this.clienteSql.consultar(
        `
          SELECT COUNT(*) AS total
          FROM empresas e
          INNER JOIN tenants t ON t.id = e.tenant_id
          ${filtro.whereScope}
        `,
        filtro.parametrosScope
      ),
      this.clienteSql.consultar(
        `
          SELECT COUNT(*) AS total
          FROM empresas e
          INNER JOIN tenants t ON t.id = e.tenant_id
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
          e.*,
          t.nombre AS tenant_nombre,
          COALESCE(sitios.total_sitios, 0) AS total_sitios
        FROM empresas e
        INNER JOIN tenants t ON t.id = e.tenant_id
        LEFT JOIN (
          SELECT s.empresa_id, COUNT(*) AS total_sitios
          FROM sitios s
          GROUP BY s.empresa_id
        ) sitios
          ON sitios.empresa_id = e.id
        ${filtro.whereCompleto}
        ORDER BY ${orden.campo} ${orden.direccion}, e.id ${orden.direccion}
        LIMIT ? OFFSET ?
      `,
      [...filtro.parametrosCompletos, tamanoNormalizado, offset]
    );

    return {
      empresas: filas.map((fila) => new Empresa(fila)),
      paginacion: {
        pagina: paginaEfectiva,
        tamanoPagina: tamanoNormalizado,
        totalVisible,
        totalFiltrado,
        totalPaginas
      }
    };
  }

  async crear({ tenantId, nombre, alias, cif, descripcion, estado }) {
    const [resultado] = await this.clienteSql.ejecutar(
      `
        INSERT INTO empresas (
          tenant_id,
          nombre,
          alias,
          cif,
          descripcion,
          estado,
          configuracion
        ) VALUES (?, ?, ?, ?, ?, ?, NULL)
      `,
      [tenantId, nombre, alias, cif || null, descripcion || null, estado]
    );

    return this.buscarPorId(resultado.insertId);
  }

  async actualizar({ idEmpresa, nombre, alias, cif, descripcion, estado }) {
    await this.clienteSql.ejecutar(
      `
        UPDATE empresas
        SET
          nombre = ?,
          alias = ?,
          cif = ?,
          descripcion = ?,
          estado = ?
        WHERE id = ?
      `,
      [nombre, alias, cif || null, descripcion || null, estado, idEmpresa]
    );

    return this.buscarPorId(idEmpresa);
  }

  async calcularImpactoCambioTenant({
    idEmpresa,
    tenantDestinoId,
    aliasActual
  }) {
    const [
      filasVivas,
      filasHistoricas,
      totalEmpresasConflictoAlias
    ] = await Promise.all([
      this.contarFilasPorEmpresaEnTablas(
        TABLAS_VIVAS_CAMBIO_TENANT_EMPRESA.filter((tabla) => tabla !== 'empresas'),
        idEmpresa
      ),
      this.contarFilasPorEmpresaEnTablas(
        TABLAS_HISTORICAS_CAMBIO_TENANT_EMPRESA,
        idEmpresa
      ),
      this.contarConflictosAliasEnTenant({
        idEmpresa,
        tenantDestinoId,
        alias: aliasActual
      })
    ]);

    return {
      actualizacionesVivas: [{ tabla: 'empresas', total: 1 }, ...filasVivas],
      referenciasHistoricas: filasHistoricas,
      bloqueosPotenciales:
        totalEmpresasConflictoAlias > 0
          ? [
              {
                tabla: 'empresas',
                regla: 'ALIAS_DUPLICADO',
                total: totalEmpresasConflictoAlias
              }
            ]
          : []
    };
  }

  async trasladarTenant({
    idEmpresa,
    tenantDestinoId,
    nombre,
    alias,
    cif,
    descripcion,
    estado
  }) {
    const conexion = await this.clienteSql.obtenerConexion();

    try {
      await conexion.beginTransaction();

      const totalConflictosAlias = await this.contarConflictosAliasEnTenant(
        {
          idEmpresa,
          tenantDestinoId,
          alias
        },
        {
          consultar: async (sql, parametros) => {
            const [filas] = await conexion.execute(sql, parametros);
            return filas;
          }
        }
      );

      if (totalConflictosAlias > 0) {
        const error = new Error(
          'Ya existe otra empresa con ese alias dentro del tenant de destino.'
        );
        error.code = 'ER_DUP_ENTRY';
        throw error;
      }

      await conexion.query('SET FOREIGN_KEY_CHECKS = 0');

      await conexion.execute(
        `
          UPDATE empresas
          SET
            tenant_id = ?,
            nombre = ?,
            alias = ?,
            cif = ?,
            descripcion = ?,
            estado = ?
          WHERE id = ?
        `,
        [tenantDestinoId, nombre, alias, cif || null, descripcion || null, estado, idEmpresa]
      );

      await this.actualizarTenantEnTablasEmpresa(
        conexion,
        TABLAS_VIVAS_CAMBIO_TENANT_EMPRESA.filter((tabla) => tabla !== 'empresas'),
        tenantDestinoId,
        idEmpresa
      );

      await this.actualizarTenantEnTablasEmpresa(
        conexion,
        TABLAS_HISTORICAS_CAMBIO_TENANT_EMPRESA.filter(
          (tabla) => tabla !== 'ejecuciones_triggers'
        ),
        tenantDestinoId,
        idEmpresa
      );
      await this.actualizarTenantEnEjecucionesTriggerEmpresa(
        conexion,
        tenantDestinoId,
        idEmpresa
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

    return this.buscarPorId(idEmpresa);
  }

  async eliminar(idEmpresa) {
    const [resultado] = await this.clienteSql.ejecutar(
      `
        DELETE FROM empresas
        WHERE id = ?
      `,
      [idEmpresa]
    );

    return resultado.affectedRows > 0;
  }

  construirFiltroScope(contextoUsuarioActual) {
    if (contextoUsuarioActual?.nivelScope === 'portal') {
      return { where: '', parametros: [] };
    }

    if (contextoUsuarioActual?.nivelScope === 'tenant') {
      return {
        where: 'WHERE e.tenant_id = ?',
        parametros: [contextoUsuarioActual.tenantId]
      };
    }

    if (['empresa', 'sitio'].includes(contextoUsuarioActual?.nivelScope)) {
      return {
        where: 'WHERE e.id = ?',
        parametros: [contextoUsuarioActual.empresaId]
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
    tenantId = null
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
          e.nombre LIKE ?
          OR e.alias LIKE ?
          OR COALESCE(e.descripcion, '') LIKE ?
          OR COALESCE(e.cif, '') LIKE ?
          OR t.nombre LIKE ?
        )`
      );
      parametros.push(patron, patron, patron, patron, patron);
    }

    if (tenantId != null) {
      condiciones.push('e.tenant_id = ?');
      parametros.push(Number(tenantId));
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
      id: 'e.id',
      tenant: 't.nombre',
      nombre: 'e.nombre',
      alias: 'e.alias',
      cif: 'e.cif',
      descripcion: 'e.descripcion',
      estado: 'e.estado',
      sitios: 'total_sitios',
      creado: 'e.fecha_creacion',
      actualizado: 'e.fecha_actualizacion'
    };
    const campo = columnas[String(ordenarPor || '').trim()] || 'e.nombre';
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

  async contarFilasPorEmpresa(tabla, idEmpresa, ejecutor = this.clienteSql) {
    const filas = await ejecutor.consultar(
      `
        SELECT COUNT(*) AS total
        FROM ${tabla}
        WHERE empresa_id = ?
      `,
      [idEmpresa]
    );

    return Number(filas[0]?.total || 0);
  }

  async contarFilasPorEmpresaEnTablas(
    tablas,
    idEmpresa,
    ejecutor = this.clienteSql
  ) {
    const totales = await Promise.all(
      tablas.map(async (tabla) => ({
        tabla,
        total: await this.contarFilasPorEmpresa(tabla, idEmpresa, ejecutor)
      }))
    );

    return totales;
  }

  async contarConflictosAliasEnTenant(
    { idEmpresa, tenantDestinoId, alias },
    ejecutor = this.clienteSql
  ) {
    const filas = await ejecutor.consultar(
      `
        SELECT COUNT(*) AS total
        FROM empresas
        WHERE tenant_id = ?
          AND alias = ?
          AND id <> ?
      `,
      [tenantDestinoId, alias, idEmpresa]
    );

    return Number(filas[0]?.total || 0);
  }

  async actualizarTenantEnFilasEmpresa(
    conexion,
    tabla,
    tenantDestinoId,
    idEmpresa
  ) {
    await conexion.execute(
      `
        UPDATE ${tabla}
        SET tenant_id = ?
        WHERE empresa_id = ?
      `,
      [tenantDestinoId, idEmpresa]
    );
  }

  async actualizarTenantEnTablasEmpresa(
    conexion,
    tablas,
    tenantDestinoId,
    idEmpresa
  ) {
    for (const tabla of tablas) {
      await this.actualizarTenantEnFilasEmpresa(
        conexion,
        tabla,
        tenantDestinoId,
        idEmpresa
      );
    }
  }

  async actualizarTenantEnEjecucionesTriggerEmpresa(
    conexion,
    tenantDestinoId,
    idEmpresa
  ) {
    await conexion.execute(
      `
        UPDATE ejecuciones_triggers
        SET
          tenant_id = CASE
            WHEN empresa_id = ? THEN ?
            ELSE tenant_id
          END,
          monitor_tenant_id = CASE
            WHEN monitor_empresa_id = ? THEN ?
            ELSE monitor_tenant_id
          END,
          trigger_tenant_id = CASE
            WHEN trigger_empresa_id = ? THEN ?
            ELSE trigger_tenant_id
          END
        WHERE empresa_id = ?
          OR monitor_empresa_id = ?
          OR trigger_empresa_id = ?
      `,
      [
        idEmpresa,
        tenantDestinoId,
        idEmpresa,
        tenantDestinoId,
        idEmpresa,
        tenantDestinoId,
        idEmpresa,
        idEmpresa,
        idEmpresa
      ]
    );
  }
}

function normalizarIdsAgrupados(valores) {
  return [...new Set((valores || []).map((valor) => {
    const id = Number(valor);
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Identidad de empresa inválida.');
    return id;
  }))];
}
