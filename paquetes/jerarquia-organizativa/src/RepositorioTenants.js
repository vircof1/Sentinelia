import { Tenant } from './Tenant.js';

export class RepositorioTenants {
  constructor(clienteSql) {
    this.clienteSql = clienteSql;
  }

  async listarVisibles(contextoUsuarioActual) {
    const { where, parametros } = this.construirFiltroScope(contextoUsuarioActual);
    const filas = await this.clienteSql.consultar(
      `
        SELECT
          t.*,
          (
            SELECT COUNT(*)
            FROM empresas e
            WHERE e.tenant_id = t.id
          ) AS total_empresas,
          (
            SELECT COUNT(*)
            FROM sitios s
            WHERE s.tenant_id = t.id
          ) AS total_sitios
        FROM tenants t
        ${where}
        ORDER BY t.nombre ASC, t.id ASC
      `,
      parametros
    );

    return filas.map((fila) => new Tenant(fila));
  }

  async buscarPorId(idTenant) {
    const filas = await this.clienteSql.consultar(
      `
        SELECT
          t.*,
          (
            SELECT COUNT(*)
            FROM empresas e
            WHERE e.tenant_id = t.id
          ) AS total_empresas,
          (
            SELECT COUNT(*)
            FROM sitios s
            WHERE s.tenant_id = t.id
          ) AS total_sitios,
          (
            SELECT COUNT(*)
            FROM usuarios u
            WHERE u.tenant_id = t.id
          ) AS total_usuarios,
          (
            SELECT COUNT(*)
            FROM monitores m
            WHERE m.tenant_id = t.id
          ) AS total_monitores,
          (
            SELECT COUNT(*)
            FROM agentes_sentinelia a
            WHERE a.tenant_id = t.id
          ) AS total_agentes,
          (
            SELECT COUNT(*)
            FROM triggers tr
            WHERE tr.tenant_id = t.id
          ) AS total_automatizaciones
        FROM tenants t
        WHERE t.id = ?
        LIMIT 1
      `,
      [idTenant]
    );

    return filas.length > 0 ? new Tenant(filas[0]) : null;
  }

  async buscarPorIds(idsTenant) {
    const ids = normalizarIdsAgrupados(idsTenant);
    if (ids.length === 0) return [];
    const filas = await this.clienteSql.consultar(
      `SELECT t.* FROM tenants t WHERE t.id IN (${ids.map(() => '?').join(',')})`,
      ids
    );
    return filas.map((fila) => new Tenant(fila));
  }

  async listarVisiblesPaginado(
    contextoUsuarioActual,
    {
      textoBusqueda = '',
      pagina = 1,
      tamanoPagina = 25,
      ordenarPor = 'nombre',
      direccionOrden = 'asc'
    } = {}
  ) {
    const filtro = this.construirFiltroListado(
      contextoUsuarioActual,
      textoBusqueda
    );
    const tamanoNormalizado = this.normalizarTamanoPagina(tamanoPagina);
    const paginaNormalizada = this.normalizarPagina(pagina);
    const orden = this.resolverOrdenListado(ordenarPor, direccionOrden);

    const [filaTotalVisible, filaTotalFiltrado] = await Promise.all([
      this.clienteSql.consultar(
        `
          SELECT COUNT(*) AS total
          FROM tenants t
          ${filtro.whereScope}
        `,
        filtro.parametrosScope
      ),
      this.clienteSql.consultar(
        `
          SELECT COUNT(*) AS total
          FROM tenants t
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
          t.*,
          COALESCE(empresas.total_empresas, 0) AS total_empresas,
          COALESCE(sitios.total_sitios, 0) AS total_sitios
        FROM tenants t
        LEFT JOIN (
          SELECT e.tenant_id, COUNT(*) AS total_empresas
          FROM empresas e
          GROUP BY e.tenant_id
        ) empresas
          ON empresas.tenant_id = t.id
        LEFT JOIN (
          SELECT s.tenant_id, COUNT(*) AS total_sitios
          FROM sitios s
          GROUP BY s.tenant_id
        ) sitios
          ON sitios.tenant_id = t.id
        ${filtro.whereCompleto}
        ORDER BY ${orden.campo} ${orden.direccion}, t.id ${orden.direccion}
        LIMIT ? OFFSET ?
      `,
      [...filtro.parametrosCompletos, tamanoNormalizado, offset]
    );

    return {
      tenants: filas.map((fila) => new Tenant(fila)),
      paginacion: {
        pagina: paginaEfectiva,
        tamanoPagina: tamanoNormalizado,
        totalVisible,
        totalFiltrado,
        totalPaginas
      }
    };
  }

  async crear({ nombre, alias, descripcion, estado }) {
    const [resultado] = await this.clienteSql.ejecutar(
      `
        INSERT INTO tenants (
          nombre,
          alias,
          descripcion,
          estado,
          configuracion
        ) VALUES (?, ?, ?, ?, NULL)
      `,
      [nombre, alias, descripcion || null, estado]
    );

    return this.buscarPorId(resultado.insertId);
  }

  async actualizar({ idTenant, nombre, alias, descripcion, estado }) {
    await this.clienteSql.ejecutar(
      `
        UPDATE tenants
        SET
          nombre = ?,
          alias = ?,
          descripcion = ?,
          estado = ?
        WHERE id = ?
      `,
      [nombre, alias, descripcion || null, estado, idTenant]
    );

    return this.buscarPorId(idTenant);
  }

  async eliminar(idTenant) {
    const [resultado] = await this.clienteSql.ejecutar(
      `
        DELETE FROM tenants
        WHERE id = ?
      `,
      [idTenant]
    );

    return resultado.affectedRows > 0;
  }

  construirFiltroScope(contextoUsuarioActual) {
    if (contextoUsuarioActual?.nivelScope === 'portal') {
      return { where: '', parametros: [] };
    }

    if (['tenant', 'empresa', 'sitio'].includes(contextoUsuarioActual?.nivelScope)) {
      return {
        where: 'WHERE t.id = ?',
        parametros: [contextoUsuarioActual.tenantId]
      };
    }

    return {
      where: 'WHERE 1 = 0',
      parametros: []
    };
  }

  construirFiltroListado(contextoUsuarioActual, textoBusqueda = '') {
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
          t.nombre LIKE ?
          OR t.alias LIKE ?
          OR COALESCE(t.descripcion, '') LIKE ?
        )`
      );
      parametros.push(patron, patron, patron);
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
      id: 't.id',
      nombre: 't.nombre',
      alias: 't.alias',
      descripcion: 't.descripcion',
      estado: 't.estado',
      empresas: 'total_empresas',
      sitios: 'total_sitios',
      creado: 't.fecha_creacion',
      actualizado: 't.fecha_actualizacion'
    };
    const campo = columnas[String(ordenarPor || '').trim()] || 't.nombre';
    const direccion =
      String(direccionOrden || '').trim().toLowerCase() === 'desc'
        ? 'DESC'
        : 'ASC';

    return { campo, direccion };
  }

  normalizarPagina(valor) {
    const pagina = Number.parseInt(String(valor ?? ''), 10);
    return Number.isInteger(pagina) && pagina > 0 ? pagina : 1;
  }

  normalizarTamanoPagina(valor) {
    const tamano = Number.parseInt(String(valor ?? ''), 10);

    if (!Number.isInteger(tamano) || tamano <= 0) {
      return 25;
    }

    return Math.min(tamano, 100);
  }
}

function normalizarIdsAgrupados(valores) {
  return [...new Set((valores || []).map((valor) => {
    const id = Number(valor);
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Identidad de tenant inválida.');
    return id;
  }))];
}
