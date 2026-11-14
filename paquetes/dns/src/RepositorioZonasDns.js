import { ZonaDns } from './ZonaDns.js';
import { RepositorioRegistrosDns } from './RepositorioRegistrosDns.js';
import { expresionEstadoPublicacionZonaDns } from './EstadoPublicacionZonaDns.js';

export class RepositorioZonasDns {
  constructor(clienteSql) {
    this.clienteSql = clienteSql;
    this.repositorioRegistrosDns = new RepositorioRegistrosDns(clienteSql);
  }

  async listar() {
    const filas = await this.clienteSql.consultar(
      `
        SELECT
          ${this.columnasSeleccion('z')}
        FROM zonas_dns z
        LEFT JOIN tenants tn ON tn.id = z.tenant_id
        LEFT JOIN empresas e ON e.id = z.empresa_id
        LEFT JOIN sitios s ON s.id = z.sitio_id
        ORDER BY z.nombre_zona ASC, z.id ASC
      `
    );

    return filas.map((fila) => new ZonaDns(fila));
  }

  async listarEnContexto(conexion) {
    if (!conexion?.execute) {
      throw new Error('La fotografía DNS requiere una conexión SQL explícita.');
    }
    const filas = await this.consultarEnContexto(
      conexion,
      `
        SELECT
          ${this.columnasSeleccion('z')}
        FROM zonas_dns z
        LEFT JOIN tenants tn ON tn.id = z.tenant_id
        LEFT JOIN empresas e ON e.id = z.empresa_id
        LEFT JOIN sitios s ON s.id = z.sitio_id
        ORDER BY z.nombre_zona COLLATE utf8mb4_bin ASC, z.id ASC
      `
    );
    return filas.map((fila) => new ZonaDns(fila));
  }

  async listarVisibles(
    contextoUsuarioActual,
    {
      sitioId = null,
      textoBusqueda = '',
      tipoZona = null,
      categoriaOrigen = null,
      estadoPublicacion = null,
      activo = 'todos'
    } = {}
  ) {
    const consulta = this.combinarCondiciones(
      this.construirConsultaScope(contextoUsuarioActual, 'z'),
      this.construirConsultaListado({
        sitioId,
        textoBusqueda,
        tipoZona,
        categoriaOrigen,
        estadoPublicacion,
        activo
      })
    );
    const filas = await this.clienteSql.consultar(
      `
        SELECT
          ${this.columnasSeleccion('z')}
        FROM zonas_dns z
        LEFT JOIN tenants tn ON tn.id = z.tenant_id
        LEFT JOIN empresas e ON e.id = z.empresa_id
        LEFT JOIN sitios s ON s.id = z.sitio_id
        ${consulta.where}
        ORDER BY z.nombre_zona ASC, z.id ASC
      `,
      consulta.parametros
    );

    return filas.map((fila) => new ZonaDns(fila));
  }

  async buscarPorId(idZona) {
    return this.buscarPorIdEnContexto(idZona);
  }

  async buscarPorIdEnContexto(idZona, conexion = null) {
    const zonaId = this.normalizarId(idZona);

    if (zonaId == null) {
      return null;
    }

    const filas = await this.consultarEnContexto(
      conexion,
      `
        SELECT
          ${this.columnasSeleccion('z')}
        FROM zonas_dns z
        LEFT JOIN tenants tn ON tn.id = z.tenant_id
        LEFT JOIN empresas e ON e.id = z.empresa_id
        LEFT JOIN sitios s ON s.id = z.sitio_id
        WHERE z.id = ?
        LIMIT 1
      `,
      [zonaId]
    );

    return filas.length > 0 ? new ZonaDns(filas[0]) : null;
  }

  async buscarVisiblePorId(contextoUsuarioActual, idZona) {
    const zonaId = this.normalizarId(idZona);

    if (zonaId == null) {
      return null;
    }

    const { condiciones, parametros } = this.construirCondicionesScope(
      contextoUsuarioActual,
      'z'
    );
    condiciones.push('z.id = ?');
    const filas = await this.clienteSql.consultar(
      `
        SELECT
          ${this.columnasSeleccion('z')}
        FROM zonas_dns z
        LEFT JOIN tenants tn ON tn.id = z.tenant_id
        LEFT JOIN empresas e ON e.id = z.empresa_id
        LEFT JOIN sitios s ON s.id = z.sitio_id
        WHERE ${condiciones.join(' AND ')}
        LIMIT 1
      `,
      [...parametros, zonaId]
    );

    return filas.length > 0 ? new ZonaDns(filas[0]) : null;
  }

  async buscarPorNombreZona(nombreZona) {
    const nombreNormalizado = String(nombreZona || '').trim().toLowerCase();

    if (!nombreNormalizado) {
      return null;
    }

    const filas = await this.clienteSql.consultar(
      `
        SELECT
          ${this.columnasSeleccion('z')}
        FROM zonas_dns z
        LEFT JOIN tenants tn ON tn.id = z.tenant_id
        LEFT JOIN empresas e ON e.id = z.empresa_id
        LEFT JOIN sitios s ON s.id = z.sitio_id
        WHERE z.nombre_zona = ?
        LIMIT 1
      `,
      [nombreNormalizado]
    );

    return filas.length > 0 ? new ZonaDns(filas[0]) : null;
  }

  async crear({
    tenantId = null,
    empresaId = null,
    sitioId = null,
    nombreZona,
    tipoZona = 'master',
    categoriaOrigen = 'normal',
    publicarEnBind = true,
    descripcion = null,
    ttlDefectoSegundos = 3600,
    soaMname,
    soaRname,
    soaSerial = 1,
    soaRefreshSegundos = 3600,
    soaRetrySegundos = 600,
    soaExpireSegundos = 1209600,
    soaMinimumSegundos = 300,
    versionModelo = 1,
    estadoPublicacion = 'pendiente',
    activo = true
  }, { conexion = null } = {}) {
    const [resultado] = await this.ejecutarEnContexto(
      conexion,
      `
        INSERT INTO zonas_dns (
          tenant_id,
          empresa_id,
          sitio_id,
          nombre_zona,
          tipo_zona,
          categoria_origen,
          publicar_en_bind,
          descripcion,
          ttl_defecto_segundos,
          soa_mname,
          soa_rname,
          soa_serial,
          soa_refresh_segundos,
          soa_retry_segundos,
          soa_expire_segundos,
          soa_minimum_segundos,
          version_modelo,
          estado_publicacion,
          activo
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        tenantId,
        empresaId,
        sitioId,
        String(nombreZona || '').trim().toLowerCase(),
        String(tipoZona || 'master').trim().toLowerCase(),
        String(categoriaOrigen || 'normal').trim().toLowerCase(),
        publicarEnBind ? 1 : 0,
        descripcion ? String(descripcion).trim() : null,
        ttlDefectoSegundos,
        String(soaMname || '').trim().toLowerCase(),
        String(soaRname || '').trim().toLowerCase(),
        soaSerial,
        soaRefreshSegundos,
        soaRetrySegundos,
        soaExpireSegundos,
        soaMinimumSegundos,
        versionModelo,
        String(estadoPublicacion || 'pendiente').trim().toLowerCase(),
        activo ? 1 : 0
      ]
    );

    return this.buscarPorIdEnContexto(resultado.insertId, conexion);
  }

  async actualizar({
    idZona,
    tenantId = null,
    empresaId = null,
    sitioId = null,
    nombreZona,
    tipoZona = 'master',
    categoriaOrigen = 'normal',
    publicarEnBind = true,
    descripcion = null,
    ttlDefectoSegundos = 3600,
    soaMname,
    soaRname,
    soaRefreshSegundos = 3600,
    soaRetrySegundos = 600,
    soaExpireSegundos = 1209600,
    soaMinimumSegundos = 300,
    activo = true
  }, { conexion = null } = {}) {
    const zonaNormalizada = this.normalizarId(idZona);

    if (zonaNormalizada == null) {
      throw new Error('La zona DNS no es válida.');
    }

    const [resultado] = await this.ejecutarEnContexto(
      conexion,
      `
        UPDATE zonas_dns
        SET
          tenant_id = ?,
          empresa_id = ?,
          sitio_id = ?,
          nombre_zona = ?,
          tipo_zona = ?,
          categoria_origen = ?,
          publicar_en_bind = ?,
          descripcion = ?,
          ttl_defecto_segundos = ?,
          soa_mname = ?,
          soa_rname = ?,
          soa_refresh_segundos = ?,
          soa_retry_segundos = ?,
          soa_expire_segundos = ?,
          soa_minimum_segundos = ?,
          activo = ?,
          version_modelo = version_modelo + 1,
          estado_publicacion = 'pendiente',
          fecha_ultimo_error_publicacion = NULL,
          detalle_ultimo_error_publicacion = NULL
        WHERE id = ?
      `,
      [
        tenantId,
        empresaId,
        sitioId,
        String(nombreZona || '').trim().toLowerCase(),
        String(tipoZona || 'master').trim().toLowerCase(),
        String(categoriaOrigen || 'normal').trim().toLowerCase(),
        publicarEnBind ? 1 : 0,
        descripcion ? String(descripcion).trim() : null,
        ttlDefectoSegundos,
        String(soaMname || '').trim().toLowerCase(),
        String(soaRname || '').trim().toLowerCase(),
        soaRefreshSegundos,
        soaRetrySegundos,
        soaExpireSegundos,
        soaMinimumSegundos,
        activo ? 1 : 0,
        zonaNormalizada
      ]
    );

    if (Number(resultado.affectedRows || 0) === 0) {
      return null;
    }

    return this.buscarPorIdEnContexto(zonaNormalizada, conexion);
  }

  async eliminar(idZona, { conexion = null } = {}) {
    const zonaNormalizada = this.normalizarId(idZona);

    if (zonaNormalizada == null) {
      throw new Error('La zona DNS no es válida.');
    }

    const [resultado] = await this.ejecutarEnContexto(
      conexion,
      `
        DELETE FROM zonas_dns
        WHERE id = ?
      `,
      [zonaNormalizada]
    );

    return Number(resultado.affectedRows || 0) > 0;
  }

  async marcarPendientePublicacion(idZona, { conexion = null } = {}) {
    const zonaNormalizada = this.normalizarId(idZona);

    if (zonaNormalizada == null) {
      throw new Error('La zona DNS no es válida.');
    }

    const [resultado] = await this.ejecutarEnContexto(
      conexion,
      `
        UPDATE zonas_dns
        SET
          version_modelo = version_modelo + 1,
          estado_publicacion = 'pendiente',
          fecha_ultimo_error_publicacion = NULL,
          detalle_ultimo_error_publicacion = NULL
        WHERE id = ?
      `,
      [zonaNormalizada]
    );

    return Number(resultado.affectedRows || 0);
  }

  async actualizarScope({
    idZona,
    tenantId = null,
    empresaId = null,
    sitioId = null
  }) {
    const zonaNormalizada = this.normalizarId(idZona);

    if (zonaNormalizada == null) {
      throw new Error('La zona DNS no es válida.');
    }

    const scopeObjetivo = this.normalizarScopeJerarquico({
      tenantId,
      empresaId,
      sitioId
    });
    const conexion = await this.clienteSql.obtenerConexion();

    try {
      await conexion.beginTransaction();

      const zonaActual = await this.buscarScopeBasicoPorId(zonaNormalizada, conexion);

      if (!zonaActual) {
        throw new Error('La zona DNS indicada no existe.');
      }

      const hayCambioScope =
        zonaActual.tenantId !== scopeObjetivo.tenantId ||
        zonaActual.empresaId !== scopeObjetivo.empresaId ||
        zonaActual.sitioId !== scopeObjetivo.sitioId;

      if (hayCambioScope) {
        await conexion.execute(
          `
            UPDATE zonas_dns
            SET
              tenant_id = ?,
              empresa_id = ?,
              sitio_id = ?,
              version_modelo = version_modelo + 1
            WHERE id = ?
          `,
          [
            scopeObjetivo.tenantId,
            scopeObjetivo.empresaId,
            scopeObjetivo.sitioId,
            zonaNormalizada
          ]
        );

        await this.repositorioRegistrosDns.sincronizarScopeDesdeZona(
          {
            zonaId: zonaNormalizada,
            tenantId: scopeObjetivo.tenantId,
            empresaId: scopeObjetivo.empresaId,
            sitioId: scopeObjetivo.sitioId
          },
          { conexion }
        );
      }

      await conexion.commit();

      return this.buscarPorId(zonaNormalizada);
    } catch (error) {
      await conexion.rollback();
      throw error;
    } finally {
      conexion.release();
    }
  }

  async registrarPublicacionExitosa(publicaciones = []) {
    const conexion = await this.clienteSql.obtenerConexion();

    try {
      await conexion.beginTransaction();
      const nombresPublicados = (Array.isArray(publicaciones) ? publicaciones : [])
        .map((publicacion) =>
          String(publicacion?.nombreZona || '').trim().toLowerCase()
        )
        .filter(Boolean);

      if (nombresPublicados.length > 0) {
        const placeholders = nombresPublicados.map(() => '?').join(', ');

        await conexion.execute(
          `
            UPDATE zonas_dns
            SET
              estado_publicacion = 'pendiente',
              hash_publicacion_vigente = NULL,
              fecha_ultima_publicacion_exitosa = NULL,
              fecha_ultimo_error_publicacion = NULL,
              detalle_ultimo_error_publicacion = NULL
            WHERE nombre_zona NOT IN (${placeholders})
              AND (
                estado_publicacion = 'publicado'
                OR hash_publicacion_vigente IS NOT NULL
                OR fecha_ultima_publicacion_exitosa IS NOT NULL
              )
          `,
          nombresPublicados
        );
      } else {
        await conexion.execute(
          `
            UPDATE zonas_dns
            SET
              estado_publicacion = 'pendiente',
              hash_publicacion_vigente = NULL,
              fecha_ultima_publicacion_exitosa = NULL,
              fecha_ultimo_error_publicacion = NULL,
              detalle_ultimo_error_publicacion = NULL
            WHERE
              estado_publicacion = 'publicado'
              OR hash_publicacion_vigente IS NOT NULL
              OR fecha_ultima_publicacion_exitosa IS NOT NULL
          `
        );
      }

      let totalActualizadas = 0;

      for (const publicacion of Array.isArray(publicaciones) ? publicaciones : []) {
        const nombreZona = String(publicacion?.nombreZona || '').trim().toLowerCase();
        const hashPublicacionVigente = String(
          publicacion?.hashPublicacionVigente || ''
        ).trim().toLowerCase();
        const soaSerialPublicado = Number.parseInt(
          String(publicacion?.soaSerialPublicado ?? ''),
          10
        );

        if (!nombreZona || !hashPublicacionVigente) {
          continue;
        }

        const [resultado] = await conexion.execute(
          `
            UPDATE zonas_dns
            SET
              estado_publicacion = 'publicado',
              version_aplicada_bind = version_modelo,
              generacion_aplicada_bind = NULL,
              hash_publicacion_vigente = ?,
              fecha_ultima_publicacion_exitosa = UTC_TIMESTAMP(),
              fecha_ultimo_error_publicacion = NULL,
              detalle_ultimo_error_publicacion = NULL,
              soa_serial = CASE
                WHEN ? IS NULL THEN soa_serial
                ELSE ?
              END
            WHERE nombre_zona = ?
          `,
          [
            hashPublicacionVigente,
            Number.isInteger(soaSerialPublicado) ? soaSerialPublicado : null,
            Number.isInteger(soaSerialPublicado) ? soaSerialPublicado : null,
            nombreZona
          ]
        );

        totalActualizadas += Number(resultado.affectedRows || 0);
      }

      await conexion.commit();
      return totalActualizadas;
    } catch (error) {
      await conexion.rollback();
      throw error;
    } finally {
      conexion.release();
    }
  }

  async registrarPublicacionFallidaGlobal({ detalleError }) {
    const [resultado] = await this.clienteSql.ejecutar(
      `
        UPDATE zonas_dns
        SET
          estado_publicacion = 'error',
          fecha_ultimo_error_publicacion = UTC_TIMESTAMP(),
          detalle_ultimo_error_publicacion = ?
      `,
      [String(detalleError || '').trim() || 'Error desconocido de publicación DNS.']
    );

    return Number(resultado.affectedRows || 0);
  }

  async registrarPublicacionFallidaPorNombre(errores = []) {
    if (!Array.isArray(errores) || errores.length === 0) {
      return 0;
    }

    let totalActualizadas = 0;

    for (const errorZona of errores) {
      const nombreZona = String(errorZona?.nombreZona || '').trim().toLowerCase();
      const detalleError = String(errorZona?.detalleError || '').trim();

      if (!nombreZona || !detalleError) {
        continue;
      }

      const [resultado] = await this.clienteSql.ejecutar(
        `
          UPDATE zonas_dns
          SET
            estado_publicacion = 'error',
            fecha_ultimo_error_publicacion = UTC_TIMESTAMP(),
            detalle_ultimo_error_publicacion = ?
          WHERE nombre_zona = ?
        `,
        [detalleError, nombreZona]
      );

      totalActualizadas += Number(resultado.affectedRows || 0);
    }

    return totalActualizadas;
  }

  columnasSeleccion(alias) {
    return `
      ${alias}.id,
      ${alias}.tenant_id,
      ${alias}.empresa_id,
      ${alias}.sitio_id,
      ${alias}.nombre_zona,
      ${alias}.tipo_zona,
      ${alias}.categoria_origen,
      ${alias}.publicar_en_bind,
      ${alias}.descripcion,
      ${alias}.ttl_defecto_segundos,
      ${alias}.soa_mname,
      ${alias}.soa_rname,
      ${alias}.soa_serial,
      ${alias}.soa_refresh_segundos,
      ${alias}.soa_retry_segundos,
      ${alias}.soa_expire_segundos,
      ${alias}.soa_minimum_segundos,
      ${alias}.version_modelo,
      ${expresionEstadoPublicacionZonaDns(alias)} AS estado_publicacion,
      CAST(${alias}.generacion_aplicada_bind AS CHAR) AS generacion_aplicada_bind,
      CAST(${alias}.version_aplicada_bind AS CHAR) AS version_aplicada_bind,
      ${alias}.hash_publicacion_vigente,
      ${alias}.fecha_ultima_publicacion_exitosa,
      ${alias}.fecha_ultimo_error_publicacion,
      ${alias}.detalle_ultimo_error_publicacion,
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

  normalizarIdOpcional(valor) {
    if (valor == null || valor === '') {
      return null;
    }

    return this.normalizarId(valor);
  }

  normalizarScopeJerarquico({
    tenantId = null,
    empresaId = null,
    sitioId = null
  } = {}) {
    const scope = {
      tenantId: this.normalizarIdOpcional(tenantId),
      empresaId: this.normalizarIdOpcional(empresaId),
      sitioId: this.normalizarIdOpcional(sitioId)
    };
    const nivel = this.resolverNivelScope(scope);

    if (nivel === 'invalido') {
      throw new Error(
        'El scope de la zona DNS debe respetar la jerarquía portal -> tenant -> empresa -> sitio.'
      );
    }

    return scope;
  }

  resolverNivelScope({ tenantId = null, empresaId = null, sitioId = null }) {
    if (tenantId == null && empresaId == null && sitioId == null) {
      return 'portal';
    }

    if (tenantId != null && empresaId == null && sitioId == null) {
      return 'tenant';
    }

    if (tenantId != null && empresaId != null && sitioId == null) {
      return 'empresa';
    }

    if (tenantId != null && empresaId != null && sitioId != null) {
      return 'sitio';
    }

    return 'invalido';
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

  construirConsultaScope(contextoUsuarioActual, alias = 'z') {
    const { condiciones, parametros } = this.construirCondicionesScope(
      contextoUsuarioActual,
      alias
    );

    return {
      where: condiciones.length > 0 ? `WHERE ${condiciones.join(' AND ')}` : '',
      parametros
    };
  }

  construirCondicionesScope(contextoUsuarioActual, alias = 'z') {
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

  construirConsultaListado({
    sitioId = null,
    textoBusqueda = '',
    tipoZona = null,
    categoriaOrigen = null,
    estadoPublicacion = null,
    activo = 'todos'
  } = {}) {
    const condiciones = [];
    const parametros = [];
    const textoNormalizado = String(textoBusqueda || '').trim();
    const sitioNormalizado = this.normalizarIdOpcional(sitioId);
    const tipoZonaNormalizado = this.normalizarTipoZonaOpcional(tipoZona);
    const categoriaOrigenNormalizada =
      this.normalizarCategoriaOrigenOpcional(categoriaOrigen);
    const estadoPublicacionNormalizado =
      this.normalizarEstadoPublicacion(estadoPublicacion);

    if (sitioNormalizado != null) {
      condiciones.push('z.sitio_id = ?');
      parametros.push(sitioNormalizado);
    }

    if (textoNormalizado) {
      const patron = `%${textoNormalizado}%`;
      condiciones.push(
        `(
          z.nombre_zona LIKE ?
          OR COALESCE(z.descripcion, '') LIKE ?
          OR z.soa_mname LIKE ?
          OR z.soa_rname LIKE ?
          OR COALESCE(tn.nombre, '') LIKE ?
          OR COALESCE(e.nombre, '') LIKE ?
          OR COALESCE(s.nombre, '') LIKE ?
        )`
      );
      parametros.push(patron, patron, patron, patron, patron, patron, patron);
    }

    if (tipoZonaNormalizado) {
      condiciones.push('z.tipo_zona = ?');
      parametros.push(tipoZonaNormalizado);
    }

    if (categoriaOrigenNormalizada) {
      condiciones.push('z.categoria_origen = ?');
      parametros.push(categoriaOrigenNormalizada);
    }

    if (estadoPublicacionNormalizado) {
      condiciones.push(`(${expresionEstadoPublicacionZonaDns('z')}) = ?`);
      parametros.push(estadoPublicacionNormalizado);
    }

    if (activo === 'solo_activas') {
      condiciones.push('z.activo = 1');
    } else if (activo === 'solo_inactivas') {
      condiciones.push('z.activo = 0');
    }

    return {
      where: condiciones.length > 0 ? `WHERE ${condiciones.join(' AND ')}` : '',
      parametros
    };
  }

  normalizarTipoZonaOpcional(valor) {
    const normalizado = String(valor || '').trim().toLowerCase();
    return ['master', 'slave', 'stub', 'forward'].includes(normalizado)
      ? normalizado
      : null;
  }

  normalizarCategoriaOrigenOpcional(valor) {
    const normalizado = String(valor || '').trim().toLowerCase();
    return ['normal', 'sistema', 'ddns', 'trigger'].includes(normalizado)
      ? normalizado
      : null;
  }

  normalizarEstadoPublicacion(valor) {
    const normalizado = String(valor || '').trim().toLowerCase();
    return ['pendiente', 'publicado', 'error', 'excluida'].includes(normalizado)
      ? normalizado
      : null;
  }

  async buscarScopeBasicoPorId(idZona, conexion) {
    const [filas] = await conexion.execute(
      `
        SELECT
          id,
          tenant_id,
          empresa_id,
          sitio_id
        FROM zonas_dns
        WHERE id = ?
        LIMIT 1
      `,
      [idZona]
    );
    const fila = filas[0] || null;

    if (!fila) {
      return null;
    }

    return {
      id: this.normalizarId(fila.id),
      tenantId: this.normalizarIdOpcional(fila.tenant_id),
      empresaId: this.normalizarIdOpcional(fila.empresa_id),
      sitioId: this.normalizarIdOpcional(fila.sitio_id)
    };
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
