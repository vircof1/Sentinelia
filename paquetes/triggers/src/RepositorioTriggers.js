import { Trigger } from './Trigger.js';
import { normalizarTipoTrigger } from './CatalogoTiposTrigger.js';
import { MutadorRevisionDeclaracionTriggerSql }
  from './MutadorRevisionDeclaracionTriggerSql.js';

export class RepositorioTriggers {
  constructor(clienteSql, {
    mutadorRevision = new MutadorRevisionDeclaracionTriggerSql()
  } = {}) {
    this.clienteSql = clienteSql;
    this.mutadorRevision = mutadorRevision;
  }

  async listar() {
    const filas = await this.clienteSql.consultar(`
      SELECT
        ${this.columnasSeleccion('t')}
      FROM triggers t
      LEFT JOIN tenants tn ON tn.id = t.tenant_id
      LEFT JOIN empresas e ON e.id = t.empresa_id
      LEFT JOIN sitios s ON s.id = t.sitio_id
      ORDER BY t.nombre ASC, t.id ASC
    `);

    return filas.map((fila) => new Trigger(fila));
  }

  async listarVisibles(contextoUsuarioActual) {
    const { where, parametros } = this.construirConsultaScope(
      contextoUsuarioActual,
      't'
    );
    const filas = await this.clienteSql.consultar(
      `
        SELECT
          ${this.columnasSeleccion('t')}
        FROM triggers t
        LEFT JOIN tenants tn ON tn.id = t.tenant_id
        LEFT JOIN empresas e ON e.id = t.empresa_id
        LEFT JOIN sitios s ON s.id = t.sitio_id
        ${where}
        ORDER BY t.nombre ASC, t.id ASC
      `,
      parametros
    );

    return filas.map((fila) => new Trigger(fila));
  }

  async listarActivos() {
    const filas = await this.clienteSql.consultar(
      `
        SELECT
          ${this.columnasSeleccion('t')}
        FROM triggers t
        LEFT JOIN tenants tn ON tn.id = t.tenant_id
        LEFT JOIN empresas e ON e.id = t.empresa_id
        LEFT JOIN sitios s ON s.id = t.sitio_id
        WHERE activo = 1
        ORDER BY t.nombre ASC, t.id ASC
      `
    );

    return filas.map((fila) => new Trigger(fila));
  }

  async listarDnsActivosPorZonaEnTransaccion(zonaId, { conexion } = {}) {
    if (!conexion?.execute || this.normalizarId(zonaId) == null) {
      throw new Error('La baja de acciones DNS requiere zona y transacción SQL.');
    }
    const filas = await consultar(conexion, `
      SELECT t.* FROM triggers t
      WHERE t.tipo = 'dns' AND t.activo = 1 AND (
        JSON_UNQUOTE(JSON_EXTRACT(t.configuracion, '$.zonaId')) = ?
        OR EXISTS (
          SELECT 1 FROM registros_dns r WHERE r.zona_id = ?
          AND JSON_UNQUOTE(JSON_EXTRACT(t.configuracion, '$.registroId')) = CAST(r.id AS CHAR)
        )
      ) ORDER BY t.id FOR UPDATE
    `, [String(zonaId), zonaId]);
    return filas.map((fila) => new Trigger(fila));
  }

  async listarDnsActivosPorRegistroEnTransaccion(registroId, { conexion } = {}) {
    if (!conexion?.execute || this.normalizarId(registroId) == null) {
      throw new Error('La baja de acciones DNS requiere registro y transacción SQL.');
    }
    // El id del registro es único. También se retira una acción que conserve
    // una zona incoherente en su configuración, sin afectar al resto de la zona.
    const filas = await consultar(conexion, `
      SELECT t.* FROM triggers t
      WHERE t.tipo = 'dns' AND t.activo = 1
        AND JSON_UNQUOTE(JSON_EXTRACT(t.configuracion, '$.registroId')) = ?
      ORDER BY t.id FOR UPDATE
    `, [String(registroId)]);
    return filas.map((fila) => new Trigger(fila));
  }

  async deshabilitar(idTrigger, { conexion, revisionDeclaracion } = {}) {
    if (!conexion?.execute) {
      throw new Error('La deshabilitación de la acción requiere transacción SQL.');
    }
    // Retirar autoridad no exige reescribir ni validar una configuración antigua.
    await this.mutadorRevision.actualizar({
      ejecutor: conexion,
      idTrigger,
      revisionEsperada: revisionDeclaracion,
      cambios: { activo: 0 }
    });
    return this.buscarPorId(idTrigger, { conexion });
  }

  async listarPorIds(idsTrigger = []) {
    if (!Array.isArray(idsTrigger) || idsTrigger.length === 0) {
      return [];
    }

    const idsNormalizados = idsTrigger
      .map((id) => this.normalizarId(id))
      .filter(Boolean);

    if (idsNormalizados.length === 0) {
      return [];
    }

    const placeholders = idsNormalizados.map(() => '?').join(', ');
    const filas = await this.clienteSql.consultar(
      `
        SELECT
          ${this.columnasSeleccion('t')}
        FROM triggers t
        LEFT JOIN tenants tn ON tn.id = t.tenant_id
        LEFT JOIN empresas e ON e.id = t.empresa_id
        LEFT JOIN sitios s ON s.id = t.sitio_id
        WHERE t.id IN (${placeholders})
        ORDER BY t.nombre ASC, t.id ASC
      `,
      idsNormalizados
    );

    return filas.map((fila) => new Trigger(fila));
  }

  async listarVisiblesPorIds(contextoUsuarioActual, idsTrigger = []) {
    if (!Array.isArray(idsTrigger) || idsTrigger.length === 0) {
      return [];
    }

    const idsNormalizados = idsTrigger
      .map((id) => this.normalizarId(id))
      .filter(Boolean);

    if (idsNormalizados.length === 0) {
      return [];
    }

    const { condiciones, parametros } = this.construirCondicionesScope(
      contextoUsuarioActual,
      't'
    );
    const placeholders = idsNormalizados.map(() => '?').join(', ');
    condiciones.push(`t.id IN (${placeholders})`);
    const filas = await this.clienteSql.consultar(
      `
        SELECT
          ${this.columnasSeleccion('t')}
        FROM triggers t
        LEFT JOIN tenants tn ON tn.id = t.tenant_id
        LEFT JOIN empresas e ON e.id = t.empresa_id
        LEFT JOIN sitios s ON s.id = t.sitio_id
        WHERE ${condiciones.join(' AND ')}
        ORDER BY t.nombre ASC, t.id ASC
      `,
      [...parametros, ...idsNormalizados]
    );

    return filas.map((fila) => new Trigger(fila));
  }

  async buscarPorId(idTrigger, { conexion = null } = {}) {
    const triggerId = this.normalizarId(idTrigger);

    if (triggerId == null) {
      return null;
    }

    const filas = await consultar(
      conexion || this.clienteSql,
      `
        SELECT
          ${this.columnasSeleccion('t')}
        FROM triggers t
        LEFT JOIN tenants tn ON tn.id = t.tenant_id
        LEFT JOIN empresas e ON e.id = t.empresa_id
        LEFT JOIN sitios s ON s.id = t.sitio_id
        WHERE t.id = ?
        LIMIT 1
      `,
      [triggerId]
    );

    return filas.length > 0 ? new Trigger(filas[0]) : null;
  }

  async buscarVisiblePorId(contextoUsuarioActual, idTrigger) {
    const triggerId = this.normalizarId(idTrigger);

    if (triggerId == null) {
      return null;
    }

    const { condiciones, parametros } = this.construirCondicionesScope(
      contextoUsuarioActual,
      't'
    );
    condiciones.push('t.id = ?');
    const filas = await this.clienteSql.consultar(
      `
        SELECT
          ${this.columnasSeleccion('t')}
        FROM triggers t
        LEFT JOIN tenants tn ON tn.id = t.tenant_id
        LEFT JOIN empresas e ON e.id = t.empresa_id
        LEFT JOIN sitios s ON s.id = t.sitio_id
        WHERE ${condiciones.join(' AND ')}
        LIMIT 1
      `,
      [...parametros, triggerId]
    );

    return filas.length > 0 ? new Trigger(filas[0]) : null;
  }

  async buscarPorNombre(nombre) {
    const nombreNormalizado = String(nombre || '').trim();

    if (!nombreNormalizado) {
      return null;
    }

    const filas = await this.clienteSql.consultar(
      `
        SELECT
          ${this.columnasSeleccion('t')}
        FROM triggers t
        LEFT JOIN tenants tn ON tn.id = t.tenant_id
        LEFT JOIN empresas e ON e.id = t.empresa_id
        LEFT JOIN sitios s ON s.id = t.sitio_id
        WHERE t.nombre = ?
        LIMIT 1
      `,
      [nombreNormalizado]
    );

    return filas.length > 0 ? new Trigger(filas[0]) : null;
  }

  async buscarPorNombreEnScope({
    nombre,
    tenantId = null,
    empresaId = null,
    sitioId = null
  }, { conexion = null } = {}) {
    const nombreNormalizado = String(nombre || '').trim();

    if (!nombreNormalizado) {
      return null;
    }

    const scope = this.normalizarScopeExacto({
      tenantId,
      empresaId,
      sitioId
    });
    const filas = await consultar(
      conexion || this.clienteSql,
      `
        SELECT
          ${this.columnasSeleccion('t')}
        FROM triggers t
        LEFT JOIN tenants tn ON tn.id = t.tenant_id
        LEFT JOIN empresas e ON e.id = t.empresa_id
        LEFT JOIN sitios s ON s.id = t.sitio_id
        WHERE
          t.nombre = ?
          AND ${this.construirCondicionScopeExacto('t')}
        LIMIT 1
      `,
      [
        nombreNormalizado,
        scope.tenantId,
        scope.tenantId,
        scope.empresaId,
        scope.empresaId,
        scope.sitioId,
        scope.sitioId
      ]
    );

    return filas.length > 0 ? new Trigger(filas[0]) : null;
  }

  async crear({
    tenantId,
    empresaId,
    sitioId = null,
    nombre,
    tipo,
    descripcion,
    activo,
    configuracion = null
  }, { conexion = null } = {}) {
    const [resultado] = await ejecutar(
      conexion || this.clienteSql,
      `
        INSERT INTO triggers (
          tenant_id,
          empresa_id,
          sitio_id,
          nombre,
          tipo,
          descripcion,
          activo,
          configuracion
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        tenantId,
        empresaId,
        sitioId,
        nombre,
        tipo,
        descripcion || null,
        activo ? 1 : 0,
        configuracion == null ? null : JSON.stringify(configuracion)
      ]
    );

    return this.buscarPorId(resultado.insertId, { conexion });
  }

  async actualizar({
    idTrigger,
    tenantId,
    empresaId,
    sitioId = null,
    nombre,
    tipo,
    descripcion,
    activo,
    configuracion = null,
    revisionDeclaracion
  }, { conexion = null } = {}) {
    const triggerId = this.normalizarId(idTrigger);

    if (triggerId == null) {
      throw new Error('El id del trigger no es válido.');
    }

    await this.mutadorRevision.actualizar({
      ejecutor: conexion || this.clienteSql,
      idTrigger: triggerId,
      revisionEsperada: revisionDeclaracion,
      cambios: {
        tenant_id: tenantId,
        empresa_id: empresaId,
        sitio_id: sitioId,
        nombre,
        tipo,
        descripcion: descripcion || null,
        activo: activo ? 1 : 0,
        configuracion: configuracion == null
          ? null
          : JSON.stringify(configuracion)
      }
    });

    return this.buscarPorId(triggerId, { conexion });
  }

  async eliminar(idTrigger, {
    conexion = null,
    revisionDeclaracion
  } = {}) {
    const triggerId = this.normalizarId(idTrigger);

    if (triggerId == null) {
      return false;
    }

    return this.mutadorRevision.eliminar({
      ejecutor: conexion || this.clienteSql,
      idTrigger: triggerId,
      revisionEsperada: revisionDeclaracion
    });
  }

  async listarPaginado({
    textoBusqueda = '',
    tipo = null,
    activo = 'todos',
    pagina = 1,
    tamanoPagina = 10,
    ordenarPor = 'nombre',
    direccionOrden = 'asc'
  } = {}) {
    const consulta = this.construirConsultaListado({
      textoBusqueda,
      tipo,
      activo
    });
    const tamanoNormalizado = this.normalizarTamanoPagina(tamanoPagina);
    const paginaSolicitada = this.normalizarPagina(pagina);
    const orden = this.resolverOrdenListado(ordenarPor, direccionOrden);
    const [totalVisible, resumen] = await Promise.all([
      this.contarVisible(),
      this.resumirFiltrado({
        textoBusqueda,
        tipo,
        activo
      })
    ]);
    const totalFiltrado = Number(resumen.totalTriggers || 0);
    const totalPaginas = Math.max(1, Math.ceil(totalFiltrado / tamanoNormalizado));
    const paginaEfectiva = Math.min(paginaSolicitada, totalPaginas);
    const offset = (paginaEfectiva - 1) * tamanoNormalizado;
    const filas = await this.clienteSql.consultar(
      `
        SELECT
          ${this.columnasSeleccion('t')}
        FROM triggers t
        LEFT JOIN tenants tn ON tn.id = t.tenant_id
        LEFT JOIN empresas e ON e.id = t.empresa_id
        LEFT JOIN sitios s ON s.id = t.sitio_id
        ${consulta.where}
        ORDER BY ${orden.campo} ${orden.direccion}, t.id ${orden.direccion}
        LIMIT ? OFFSET ?
      `,
      [...consulta.parametros, tamanoNormalizado, offset]
    );

    return {
      triggers: filas.map((fila) => new Trigger(fila)),
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

  async listarPaginadoVisible(
    contextoUsuarioActual,
    {
      textoBusqueda = '',
      tenantId = null,
      empresaId = null,
      tipo = null,
      activo = 'todos',
      pagina = 1,
      tamanoPagina = 10,
      ordenarPor = 'nombre',
      direccionOrden = 'asc',
      excluirCorreo = false
    } = {}
  ) {
    const consulta = this.construirConsultaListadoVisible(contextoUsuarioActual, {
      textoBusqueda,
      tenantId,
      empresaId,
      tipo,
      activo,
      excluirCorreo
    });
    const tamanoNormalizado = this.normalizarTamanoPagina(tamanoPagina);
    const paginaSolicitada = this.normalizarPagina(pagina);
    const orden = this.resolverOrdenListado(ordenarPor, direccionOrden);
    const [totalVisible, resumen] = await Promise.all([
      this.contarVisible(contextoUsuarioActual, { excluirCorreo }),
      this.resumirFiltradoVisible(contextoUsuarioActual, {
        textoBusqueda,
        tenantId,
        empresaId,
        tipo,
        activo,
        excluirCorreo
      })
    ]);
    const totalFiltrado = Number(resumen.totalTriggers || 0);
    const totalPaginas = Math.max(1, Math.ceil(totalFiltrado / tamanoNormalizado));
    const paginaEfectiva = Math.min(paginaSolicitada, totalPaginas);
    const offset = (paginaEfectiva - 1) * tamanoNormalizado;
    const filas = await this.clienteSql.consultar(
      `
        SELECT
          ${this.columnasSeleccion('t')}
        FROM triggers t
        LEFT JOIN tenants tn ON tn.id = t.tenant_id
        LEFT JOIN empresas e ON e.id = t.empresa_id
        LEFT JOIN sitios s ON s.id = t.sitio_id
        ${consulta.where}
        ORDER BY ${orden.campo} ${orden.direccion}, t.id ${orden.direccion}
        LIMIT ? OFFSET ?
      `,
      [...consulta.parametros, tamanoNormalizado, offset]
    );

    return {
      triggers: filas.map((fila) => new Trigger(fila)),
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

  construirConsultaListado({
    textoBusqueda = '',
    tenantId = null,
    empresaId = null,
    sitioId = null,
    tipo = null,
    activo = 'todos',
    excluirCorreo = false
  } = {}) {
    const condiciones = [];
    const parametros = [];
    const textoNormalizado = String(textoBusqueda || '').trim();
    const tenantNormalizado = this.normalizarId(tenantId);
    const empresaNormalizada = this.normalizarId(empresaId);
    const sitioNormalizado = this.normalizarId(sitioId);
    const tipoNormalizado = this.normalizarTipoOpcional(tipo);

    if (tenantNormalizado != null) {
      condiciones.push('t.tenant_id = ?');
      parametros.push(tenantNormalizado);
    }

    if (empresaNormalizada != null) {
      condiciones.push('t.empresa_id = ?');
      parametros.push(empresaNormalizada);
    }

    if (sitioNormalizado != null) {
      condiciones.push('t.sitio_id = ?');
      parametros.push(sitioNormalizado);
    }

    if (textoNormalizado) {
      const patron = `%${textoNormalizado}%`;
      condiciones.push(
        `(
          t.nombre LIKE ?
          OR CAST(t.id AS CHAR) LIKE ?
          OR COALESCE(t.descripcion, '') LIKE ?
          OR t.tipo LIKE ?
          OR COALESCE(JSON_UNQUOTE(JSON_EXTRACT(t.configuracion, '$.url')), '') LIKE ?
          OR COALESCE(e.nombre, '') LIKE ?
          OR COALESCE(s.nombre, '') LIKE ?
        )`
      );
      parametros.push(patron, patron, patron, patron, patron, patron, patron);
    }

    if (tipoNormalizado) {
      condiciones.push('t.tipo = ?');
      parametros.push(tipoNormalizado);
    }

    if (excluirCorreo) condiciones.push("t.tipo <> 'correo'");

    if (activo === 'solo_activos') {
      condiciones.push('t.activo = 1');
    } else if (activo === 'solo_inactivos') {
      condiciones.push('t.activo = 0');
    }

    return {
      where: condiciones.length > 0 ? `WHERE ${condiciones.join(' AND ')}` : '',
      parametros
    };
  }

  construirConsultaListadoVisible(contextoUsuarioActual, filtros = {}) {
    const scope = this.construirConsultaScope(contextoUsuarioActual, 't');
    const base = this.construirConsultaListado(filtros);
    return this.combinarCondiciones(scope, base);
  }

  async contarVisible(contextoUsuarioActual = null, { excluirCorreo = false } = {}) {
    const consulta = this.combinarCondiciones(
      this.construirConsultaScope(contextoUsuarioActual, 't'),
      this.construirConsultaListado({ excluirCorreo })
    );
    const filas = await this.clienteSql.consultar(
      `
        SELECT COUNT(*) AS total
        FROM triggers t
        ${consulta.where}
      `,
      consulta.parametros
    );

    return Number(filas[0]?.total || 0);
  }

  async resumirFiltrado(filtros = {}) {
    const consulta = this.construirConsultaListado(filtros);
    const filas = await this.clienteSql.consultar(
      `
        SELECT
          COUNT(*) AS total_triggers,
          SUM(CASE WHEN t.activo = 1 THEN 1 ELSE 0 END) AS total_activos,
          SUM(CASE WHEN t.activo = 0 THEN 1 ELSE 0 END) AS total_inactivos,
          SUM(CASE WHEN t.tipo = 'api' THEN 1 ELSE 0 END) AS total_api,
          SUM(CASE WHEN t.tipo = 'dns' THEN 1 ELSE 0 END) AS total_dns,
          SUM(CASE WHEN t.tipo = 'correo' THEN 1 ELSE 0 END) AS total_correo
        FROM triggers t
        LEFT JOIN tenants tn ON tn.id = t.tenant_id
        LEFT JOIN empresas e ON e.id = t.empresa_id
        LEFT JOIN sitios s ON s.id = t.sitio_id
        ${consulta.where}
      `,
      consulta.parametros
    );

    const fila = filas[0] || {};
    return {
      totalTriggers: Number(fila.total_triggers || 0),
      totalActivos: Number(fila.total_activos || 0),
      totalInactivos: Number(fila.total_inactivos || 0),
      totalApi: Number(fila.total_api || 0),
      totalDns: Number(fila.total_dns || 0),
      totalCorreo: Number(fila.total_correo || 0)
    };
  }

  async resumirFiltradoVisible(contextoUsuarioActual, filtros = {}) {
    const consulta = this.construirConsultaListadoVisible(
      contextoUsuarioActual,
      filtros
    );
    const filas = await this.clienteSql.consultar(
      `
        SELECT
          COUNT(*) AS total_triggers,
          SUM(CASE WHEN t.activo = 1 THEN 1 ELSE 0 END) AS total_activos,
          SUM(CASE WHEN t.activo = 0 THEN 1 ELSE 0 END) AS total_inactivos,
          SUM(CASE WHEN t.tipo = 'api' THEN 1 ELSE 0 END) AS total_api,
          SUM(CASE WHEN t.tipo = 'dns' THEN 1 ELSE 0 END) AS total_dns,
          SUM(CASE WHEN t.tipo = 'correo' THEN 1 ELSE 0 END) AS total_correo
        FROM triggers t
        LEFT JOIN tenants tn ON tn.id = t.tenant_id
        LEFT JOIN empresas e ON e.id = t.empresa_id
        LEFT JOIN sitios s ON s.id = t.sitio_id
        ${consulta.where}
      `,
      consulta.parametros
    );

    const fila = filas[0] || {};
    return {
      totalTriggers: Number(fila.total_triggers || 0),
      totalActivos: Number(fila.total_activos || 0),
      totalInactivos: Number(fila.total_inactivos || 0),
      totalApi: Number(fila.total_api || 0),
      totalDns: Number(fila.total_dns || 0),
      totalCorreo: Number(fila.total_correo || 0)
    };
  }

  combinarCondiciones(...consultas) {
    const condiciones = [];
    const parametros = [];

    for (const consulta of consultas) {
      const where = String(consulta?.where || '').trim();
      const parametrosConsulta = Array.isArray(consulta?.parametros)
        ? consulta.parametros
        : [];

      if (where) {
        const limpio = where.replace(/^WHERE\s+/i, '').trim();

        if (limpio) {
          condiciones.push(limpio);
        }
      }

      parametros.push(...parametrosConsulta);
    }

    return {
      where: condiciones.length > 0 ? `WHERE ${condiciones.join(' AND ')}` : '',
      parametros
    };
  }

  construirConsultaScope(contextoUsuarioActual, alias = 't') {
    const { condiciones, parametros } = this.construirCondicionesScope(
      contextoUsuarioActual,
      alias
    );

    return {
      where: condiciones.length > 0 ? `WHERE ${condiciones.join(' AND ')}` : '',
      parametros
    };
  }

  construirCondicionesScope(contextoUsuarioActual, alias = 't') {
    if (contextoUsuarioActual?.nivelScope === 'portal') {
      return { condiciones: [], parametros: [] };
    }

    if (contextoUsuarioActual?.nivelScope === 'tenant') {
      return {
        condiciones: [`${alias}.tenant_id = ?`],
        parametros: [contextoUsuarioActual.tenantId]
      };
    }

    if (contextoUsuarioActual?.nivelScope === 'empresa') {
      return {
        condiciones: [`${alias}.empresa_id = ?`],
        parametros: [contextoUsuarioActual.empresaId]
      };
    }

    if (contextoUsuarioActual?.nivelScope === 'sitio') {
      return {
        condiciones: [`${alias}.sitio_id = ?`],
        parametros: [contextoUsuarioActual.sitioId]
      };
    }

    return {
      condiciones: ['1 = 0'],
      parametros: []
    };
  }

  resolverOrdenListado(ordenarPor, direccionOrden) {
    const columnas = {
      nombre: 't.nombre',
      tipo: 't.tipo',
      activo: 't.activo',
      creado: 't.fecha_creacion',
      actualizado: 't.fecha_actualizacion'
    };
    const campo = columnas[String(ordenarPor || '').trim().toLowerCase()] || 't.nombre';
    const direccion =
      String(direccionOrden || '').trim().toLowerCase() === 'desc'
        ? 'DESC'
        : 'ASC';

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

  normalizarId(valor) {
    const convertido = Number.parseInt(String(valor ?? ''), 10);
    return Number.isInteger(convertido) && convertido > 0 ? convertido : null;
  }

  normalizarScopeExacto({
    tenantId = null,
    empresaId = null,
    sitioId = null
  } = {}) {
    return {
      tenantId: this.normalizarId(tenantId),
      empresaId: this.normalizarId(empresaId),
      sitioId: this.normalizarId(sitioId)
    };
  }

  construirCondicionScopeExacto(alias = 't') {
    return `(
      ((${alias}.tenant_id IS NULL AND ? IS NULL) OR ${alias}.tenant_id = ?)
      AND ((${alias}.empresa_id IS NULL AND ? IS NULL) OR ${alias}.empresa_id = ?)
      AND ((${alias}.sitio_id IS NULL AND ? IS NULL) OR ${alias}.sitio_id = ?)
    )`;
  }

  columnasSeleccion(alias) {
    return `
      ${alias}.id,
      ${alias}.tenant_id,
      ${alias}.empresa_id,
      ${alias}.sitio_id,
      ${alias}.nombre,
      ${alias}.tipo,
      ${alias}.descripcion,
      ${alias}.activo,
      ${alias}.configuracion,
      ${alias}.revision_declaracion,
      ${alias}.fecha_creacion,
      ${alias}.fecha_actualizacion,
      tn.nombre AS tenant_nombre,
      e.nombre AS empresa_nombre,
      s.nombre AS sitio_nombre
    `;
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
