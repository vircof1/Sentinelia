import { RegistroDns } from './RegistroDns.js';

export class RepositorioRegistrosDns {
  constructor(clienteSql) {
    this.clienteSql = clienteSql;
  }

  async listarPorZonaId(idZona) {
    const zonaId = this.normalizarId(idZona);

    if (zonaId == null) {
      return [];
    }

    const filas = await this.clienteSql.consultar(
      `
        SELECT
          ${this.columnasSeleccion('r')}
        FROM registros_dns r
        INNER JOIN zonas_dns z ON z.id = r.zona_id
        LEFT JOIN tenants tn ON tn.id = r.tenant_id
        LEFT JOIN empresas e ON e.id = r.empresa_id
        LEFT JOIN sitios s ON s.id = r.sitio_id
        WHERE r.zona_id = ?
        ORDER BY r.host_relativo ASC, r.tipo_registro ASC, r.id ASC
      `,
      [zonaId]
    );

    return filas.map((fila) => new RegistroDns(fila));
  }

  async listarPorZonaIds(idsZona = []) {
    if (!Array.isArray(idsZona) || idsZona.length === 0) {
      return [];
    }

    const idsNormalizados = idsZona
      .map((id) => this.normalizarId(id))
      .filter(Boolean);

    if (idsNormalizados.length === 0) {
      return [];
    }

    const placeholders = idsNormalizados.map(() => '?').join(', ');
    const filas = await this.clienteSql.consultar(
      `
        SELECT
          ${this.columnasSeleccion('r')}
        FROM registros_dns r
        INNER JOIN zonas_dns z ON z.id = r.zona_id
        LEFT JOIN tenants tn ON tn.id = r.tenant_id
        LEFT JOIN empresas e ON e.id = r.empresa_id
        LEFT JOIN sitios s ON s.id = r.sitio_id
        WHERE r.zona_id IN (${placeholders})
        ORDER BY r.zona_id ASC, r.host_relativo ASC, r.tipo_registro ASC, r.id ASC
      `,
      idsNormalizados
    );

    return filas.map((fila) => new RegistroDns(fila));
  }

  async listarPorZonaIdsEnContexto(idsZona = [], conexion) {
    if (!conexion?.execute) {
      throw new Error('La fotografía DNS requiere una conexión SQL explícita.');
    }
    if (!Array.isArray(idsZona) || idsZona.length === 0) return [];
    const idsNormalizados = idsZona
      .map((id) => this.normalizarId(id))
      .filter(Boolean);
    if (idsNormalizados.length === 0) return [];
    const placeholders = idsNormalizados.map(() => '?').join(', ');
    const filas = await this.consultarEnContexto(
      conexion,
      `
        SELECT
          ${this.columnasSeleccion('r')}
        FROM registros_dns r
        INNER JOIN zonas_dns z ON z.id = r.zona_id
        LEFT JOIN tenants tn ON tn.id = r.tenant_id
        LEFT JOIN empresas e ON e.id = r.empresa_id
        LEFT JOIN sitios s ON s.id = r.sitio_id
        WHERE r.zona_id IN (${placeholders})
        ORDER BY r.zona_id ASC,
          r.host_relativo COLLATE utf8mb4_bin ASC,
          r.tipo_registro COLLATE utf8mb4_bin ASC,
          r.id ASC
      `,
      idsNormalizados
    );
    return filas.map((fila) => new RegistroDns(fila));
  }

  async contarPorZonaId(idZona, { conexion = null } = {}) {
    const zonaNormalizada = this.normalizarId(idZona);

    if (zonaNormalizada == null) {
      return 0;
    }

    const filas = await this.consultarEnContexto(
      conexion,
      `
        SELECT COUNT(*) AS total
        FROM registros_dns
        WHERE zona_id = ?
      `,
      [zonaNormalizada]
    );

    return Number(filas[0]?.total || 0);
  }

  async listarPorZonaIdFiltrado(
    idZona,
    {
      textoBusqueda = '',
      tipoRegistro = null,
      activo = 'todos'
    } = {}
  ) {
    const zonaId = this.normalizarId(idZona);

    if (zonaId == null) {
      return [];
    }

    const consulta = this.construirConsultaListado({
      zonaId,
      textoBusqueda,
      tipoRegistro,
      activo
    });
    const filas = await this.clienteSql.consultar(
      `
        SELECT
          ${this.columnasSeleccion('r')}
        FROM registros_dns r
        INNER JOIN zonas_dns z ON z.id = r.zona_id
        LEFT JOIN tenants tn ON tn.id = r.tenant_id
        LEFT JOIN empresas e ON e.id = r.empresa_id
        LEFT JOIN sitios s ON s.id = r.sitio_id
        ${consulta.where}
        ORDER BY r.host_relativo ASC, r.tipo_registro ASC, r.id ASC
      `,
      consulta.parametros
    );

    return filas.map((fila) => new RegistroDns(fila));
  }

  async listarGobernablesPorTriggerVisibles(
    contextoUsuarioActual,
    {
      textoBusqueda = '',
      zonaId = null,
      limite = 25
    } = {}
  ) {
    const consulta = this.combinarCondiciones(
      this.construirConsultaScope(contextoUsuarioActual, 'r'),
      this.construirConsultaGobernablesTrigger({
        textoBusqueda,
        zonaId
      })
    );
    const limiteNormalizado = this.normalizarLimite(limite);
    const filas = await this.clienteSql.consultar(
      `
        SELECT
          ${this.columnasSeleccion('r')}
        FROM registros_dns r
        INNER JOIN zonas_dns z ON z.id = r.zona_id
        LEFT JOIN tenants tn ON tn.id = r.tenant_id
        LEFT JOIN empresas e ON e.id = r.empresa_id
        LEFT JOIN sitios s ON s.id = r.sitio_id
        ${consulta.where}
        ORDER BY z.nombre_zona ASC, r.host_relativo ASC, r.tipo_registro ASC, r.id ASC
        LIMIT ${limiteNormalizado}
      `,
      consulta.parametros
    );

    return filas.map((fila) => new RegistroDns(fila));
  }

  async buscarPorId(idRegistro) {
    return this.buscarPorIdEnContexto(idRegistro);
  }

  async buscarPorIdEnContexto(idRegistro, conexion = null) {
    const registroId = this.normalizarId(idRegistro);

    if (registroId == null) {
      return null;
    }

    const filas = await this.consultarEnContexto(
      conexion,
      `
        SELECT
          ${this.columnasSeleccion('r')}
        FROM registros_dns r
        INNER JOIN zonas_dns z ON z.id = r.zona_id
        LEFT JOIN tenants tn ON tn.id = r.tenant_id
        LEFT JOIN empresas e ON e.id = r.empresa_id
        LEFT JOIN sitios s ON s.id = r.sitio_id
        WHERE r.id = ?
        LIMIT 1
      `,
      [registroId]
    );

    return filas.length > 0 ? new RegistroDns(filas[0]) : null;
  }

  async crear({
    zonaId,
    hostRelativo,
    tipoRegistro,
    valorPrincipal = null,
    ttlSegundos = null,
    prioridad = null,
    peso = null,
    puerto = null,
    flags = null,
    tag = null,
    categoriaOrigen = 'normal',
    publicarEnBind = true,
    datosAuxiliares = null,
    descripcion = null,
    activo = true
  }, { conexion = null } = {}) {
    const zonaNormalizada = this.normalizarId(zonaId);

    if (zonaNormalizada == null) {
      throw new Error('La zona DNS del registro no es válida.');
    }

    const [resultado] = await this.ejecutarEnContexto(
      conexion,
      `
        INSERT INTO registros_dns (
          zona_id,
          tenant_id,
          empresa_id,
          sitio_id,
          host_relativo,
          tipo_registro,
          valor_principal,
          ttl_segundos,
          prioridad,
          peso,
          puerto,
          flags,
          tag,
          categoria_origen,
          publicar_en_bind,
          datos_auxiliares,
          descripcion,
          activo
        )
        SELECT
          z.id,
          z.tenant_id,
          z.empresa_id,
          z.sitio_id,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?
        FROM zonas_dns z
        WHERE z.id = ?
      `,
      [
        String(hostRelativo || '').trim(),
        String(tipoRegistro || '').trim().toUpperCase(),
        valorPrincipal ? String(valorPrincipal).trim() : null,
        ttlSegundos,
        prioridad,
        peso,
        puerto,
        flags ? String(flags).trim() : null,
        tag ? String(tag).trim() : null,
        String(categoriaOrigen || 'normal').trim().toLowerCase(),
        publicarEnBind ? 1 : 0,
        datosAuxiliares == null ? null : JSON.stringify(datosAuxiliares),
        descripcion ? String(descripcion).trim() : null,
        activo ? 1 : 0,
        zonaNormalizada
      ]
    );

    if (Number(resultado.affectedRows || 0) === 0) {
      throw new Error(
        'No se pudo crear el registro DNS porque la zona indicada no existe.'
      );
    }

    return this.buscarPorIdEnContexto(resultado.insertId, conexion);
  }

  async actualizar({
    idRegistro,
    hostRelativo,
    tipoRegistro,
    valorPrincipal = null,
    ttlSegundos = null,
    prioridad = null,
    peso = null,
    puerto = null,
    flags = null,
    tag = null,
    categoriaOrigen = 'normal',
    publicarEnBind = true,
    datosAuxiliares = null,
    descripcion = null,
    activo = true
  }, { conexion = null } = {}) {
    const registroNormalizado = this.normalizarId(idRegistro);

    if (registroNormalizado == null) {
      throw new Error('El registro DNS no es válido.');
    }

    const [resultado] = await this.ejecutarEnContexto(
      conexion,
      `
        UPDATE registros_dns
        SET
          host_relativo = ?,
          tipo_registro = ?,
          valor_principal = ?,
          ttl_segundos = ?,
          prioridad = ?,
          peso = ?,
          puerto = ?,
          flags = ?,
          tag = ?,
          categoria_origen = ?,
          publicar_en_bind = ?,
          datos_auxiliares = ?,
          descripcion = ?,
          activo = ?
        WHERE id = ?
      `,
      [
        String(hostRelativo || '').trim(),
        String(tipoRegistro || '').trim().toUpperCase(),
        valorPrincipal ? String(valorPrincipal).trim() : null,
        ttlSegundos,
        prioridad,
        peso,
        puerto,
        flags ? String(flags).trim() : null,
        tag ? String(tag).trim() : null,
        String(categoriaOrigen || 'normal').trim().toLowerCase(),
        publicarEnBind ? 1 : 0,
        datosAuxiliares == null ? null : JSON.stringify(datosAuxiliares),
        descripcion ? String(descripcion).trim() : null,
        activo ? 1 : 0,
        registroNormalizado
      ]
    );

    if (Number(resultado.affectedRows || 0) === 0) {
      return null;
    }

    return this.buscarPorIdEnContexto(registroNormalizado, conexion);
  }

  async eliminar(idRegistro, { conexion = null } = {}) {
    const registroNormalizado = this.normalizarId(idRegistro);

    if (registroNormalizado == null) {
      throw new Error('El registro DNS no es válido.');
    }

    const [resultado] = await this.ejecutarEnContexto(
      conexion,
      `
        DELETE FROM registros_dns
        WHERE id = ?
      `,
      [registroNormalizado]
    );

    return Number(resultado.affectedRows || 0) > 0;
  }

  async sincronizarScopeDesdeZona(
    {
      zonaId,
      tenantId = null,
      empresaId = null,
      sitioId = null
    },
    { conexion = null } = {}
  ) {
    const zonaNormalizada = this.normalizarId(zonaId);

    if (zonaNormalizada == null) {
      throw new Error('La zona DNS del registro no es válida.');
    }

    const scope = this.normalizarScopeExacto({
      tenantId,
      empresaId,
      sitioId
    });
    const [resultado] = await this.ejecutarEnContexto(
      conexion,
      `
        UPDATE registros_dns
        SET
          tenant_id = ?,
          empresa_id = ?,
          sitio_id = ?
        WHERE zona_id = ?
      `,
      [
        scope.tenantId,
        scope.empresaId,
        scope.sitioId,
        zonaNormalizada
      ]
    );

    return Number(resultado.affectedRows || 0);
  }

  columnasSeleccion(alias) {
    return `
      ${alias}.id,
      ${alias}.zona_id,
      ${alias}.tenant_id,
      ${alias}.empresa_id,
      ${alias}.sitio_id,
      z.nombre_zona,
      ${alias}.host_relativo,
      ${alias}.tipo_registro,
      ${alias}.valor_principal,
      ${alias}.ttl_segundos,
      ${alias}.prioridad,
      ${alias}.peso,
      ${alias}.puerto,
      ${alias}.flags,
      ${alias}.tag,
      ${alias}.categoria_origen,
      ${alias}.publicar_en_bind,
      ${alias}.datos_auxiliares,
      ${alias}.descripcion,
      ${alias}.activo,
      ${alias}.fecha_creacion,
      ${alias}.fecha_actualizacion,
      tn.nombre AS tenant_nombre,
      e.nombre AS empresa_nombre,
      s.nombre AS sitio_nombre
    `;
  }

  normalizarId(valor) {
    const convertido = Number.parseInt(String(valor ?? ''), 10);
    return Number.isInteger(convertido) && convertido > 0
      ? convertido
      : null;
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

  construirConsultaListado({
    zonaId,
    textoBusqueda = '',
    tipoRegistro = null,
    activo = 'todos'
  } = {}) {
    const condiciones = ['r.zona_id = ?'];
    const parametros = [zonaId];
    const textoNormalizado = String(textoBusqueda || '').trim();
    const tipoNormalizado = this.normalizarTipoRegistroOpcional(tipoRegistro);

    if (textoNormalizado) {
      const patron = `%${textoNormalizado}%`;
      condiciones.push(
        `(
          r.host_relativo LIKE ?
          OR r.tipo_registro LIKE ?
          OR COALESCE(r.valor_principal, '') LIKE ?
          OR COALESCE(r.descripcion, '') LIKE ?
          OR COALESCE(r.categoria_origen, '') LIKE ?
          OR COALESCE(r.flags, '') LIKE ?
          OR COALESCE(r.tag, '') LIKE ?
        )`
      );
      parametros.push(patron, patron, patron, patron, patron, patron, patron);
    }

    if (tipoNormalizado) {
      condiciones.push('r.tipo_registro = ?');
      parametros.push(tipoNormalizado);
    }

    if (activo === 'solo_activos') {
      condiciones.push('r.activo = 1');
    } else if (activo === 'solo_inactivos') {
      condiciones.push('r.activo = 0');
    }

    return {
      where: `WHERE ${condiciones.join(' AND ')}`,
      parametros
    };
  }

  construirConsultaGobernablesTrigger({
    textoBusqueda = '',
    zonaId = null
  } = {}) {
    const condiciones = [
      `(
        r.categoria_origen = 'trigger'
        OR (
          JSON_VALID(r.datos_auxiliares)
          AND JSON_UNQUOTE(JSON_EXTRACT(r.datos_auxiliares, '$.gobernadoPor')) = 'trigger'
        )
      )`
    ];
    const parametros = [];
    const zonaNormalizada = this.normalizarId(zonaId);
    const textoNormalizado = String(textoBusqueda || '').trim();

    if (zonaNormalizada != null) {
      condiciones.push('r.zona_id = ?');
      parametros.push(zonaNormalizada);
    }

    if (textoNormalizado) {
      const patron = `%${textoNormalizado}%`;
      condiciones.push(
        `(
          z.nombre_zona LIKE ?
          OR r.host_relativo LIKE ?
          OR r.tipo_registro LIKE ?
          OR COALESCE(r.valor_principal, '') LIKE ?
          OR COALESCE(r.descripcion, '') LIKE ?
          OR COALESCE(r.categoria_origen, '') LIKE ?
        )`
      );
      parametros.push(patron, patron, patron, patron, patron, patron);
    }

    return {
      where: `WHERE ${condiciones.join(' AND ')}`,
      parametros
    };
  }

  construirConsultaScope(contextoUsuarioActual, alias = 'r') {
    const { condiciones, parametros } = this.construirCondicionesScope(
      contextoUsuarioActual,
      alias
    );

    return {
      where: condiciones.length > 0 ? `WHERE ${condiciones.join(' AND ')}` : '',
      parametros
    };
  }

  construirCondicionesScope(contextoUsuarioActual, alias = 'r') {
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

  normalizarLimite(valor) {
    const numero = Number.parseInt(String(valor ?? ''), 10);
    return Number.isInteger(numero) && numero > 0
      ? Math.min(numero, 50)
      : 25;
  }

  normalizarTipoRegistroOpcional(valor) {
    const normalizado = String(valor || '').trim().toUpperCase();
    return [
      'A',
      'AAAA',
      'CNAME',
      'NS',
      'TXT',
      'MX',
      'SRV',
      'CAA',
      'PTR'
    ].includes(normalizado)
      ? normalizado
      : null;
  }

  async ejecutarEnContexto(conexion, sql, parametros = []) {
    if (conexion) {
      return conexion.execute(sql, parametros);
    }

    return this.clienteSql.ejecutar(sql, parametros);
  }

  async consultarEnContexto(conexion, sql, parametros = []) {
    const [filas] = await this.ejecutarEnContexto(conexion, sql, parametros);
    return filas;
  }
}
