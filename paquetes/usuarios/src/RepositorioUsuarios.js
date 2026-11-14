import { Usuario } from './Usuario.js';
import { exigirBuzonCanonicoCorreo } from '../../correo/src/NormalizadorBuzonCorreo.js';

export class RepositorioUsuarios {
  constructor(clienteSql) {
    this.clienteSql = clienteSql;
  }

  async buscarPorUsuario(usuario) {
    const filas = await this.clienteSql.consultar(
      `
        SELECT
          ${this.columnasSeleccionUsuario('u')}
        FROM usuarios u
        WHERE u.usuario = ?
        LIMIT 1
      `,
      [usuario]
    );

    if (filas.length === 0) {
      return null;
    }

    return new Usuario(filas[0]);
  }

  async buscarPorId(idUsuario) {
    const filas = await this.clienteSql.consultar(
      `
        SELECT
          ${this.columnasSeleccionUsuario('u')}
        FROM usuarios u
        WHERE u.id = ?
        LIMIT 1
      `,
      [idUsuario]
    );

    if (filas.length === 0) {
      return null;
    }

    return new Usuario(filas[0]);
  }

  async buscarPorIdEnTransaccion(idUsuario, { conexion, forUpdate = false } = {}) {
    exigirConexionPrestada(conexion);
    const [filas] = await conexion.execute(
      `
        SELECT
          ${this.columnasSeleccionUsuario('u')}
        FROM usuarios u
        WHERE u.id = ?
        LIMIT 1
        ${forUpdate ? 'FOR UPDATE' : ''}
      `,
      [idUsuario]
    );

    if (filas.length === 0) {
      return null;
    }

    return new Usuario(filas[0]);
  }

  async listarFronteraElegibleRecuperacionPorBuzonEnTransaccion(
    { buzonCanonico },
    { conexion } = {}
  ) {
    exigirConexionPrestada(conexion);
    const buzon = exigirBuzonCanonicoCorreo(buzonCanonico);
    const [filas] = await conexion.execute(
      `
        SELECT
          CAST(u.id AS CHAR) AS usuario_id,
          CAST(u.generacion_recuperacion AS CHAR) AS generacion_recuperacion
        FROM usuarios u
        WHERE u.email = ?
          AND BINARY u.email = BINARY ?
          AND u.activo = 1
          AND u.email_validado = 1
        ORDER BY u.id ASC
        FOR UPDATE
      `,
      [buzon, buzon]
    );

    return Object.freeze(filas.map((fila) => Object.freeze({
      usuarioId: String(fila.usuario_id),
      generacionRecuperacion: String(fila.generacion_recuperacion)
    })));
  }

  async buscarIdentidadElegibleRecuperacionPorUsuarioEnTransaccion(
    { usuario, buzonCanonico },
    { conexion, forUpdate = false } = {}
  ) {
    exigirConexionPrestada(conexion);
    const nombre = String(usuario ?? '');
    if (nombre.length === 0) {
      throw new Error('El nombre de usuario alegado es obligatorio.');
    }
    const buzon = exigirBuzonCanonicoCorreo(buzonCanonico);
    const [filas] = await conexion.execute(
      `
        SELECT
          ${this.columnasSeleccionUsuario('u')}
        FROM usuarios u
        WHERE u.usuario = ?
          AND u.email = ?
          AND BINARY u.email = BINARY ?
          AND u.activo = 1
          AND u.email_validado = 1
        LIMIT 1
        ${forUpdate ? 'FOR UPDATE' : ''}
      `,
      [nombre, buzon, buzon]
    );

    return filas.length === 0 ? null : new Usuario(filas[0]);
  }

  async bloquearIdentidadElegibleRecuperacionEnTransaccion(
    { idUsuario, generacionRecuperacionObservada, buzonCanonico },
    { conexion } = {}
  ) {
    exigirConexionPrestada(conexion);
    const id = decimalPositivo(idUsuario, 'idUsuario');
    const generacion = decimalPositivo(
      generacionRecuperacionObservada,
      'generacionRecuperacionObservada'
    );
    const buzon = exigirBuzonCanonicoCorreo(buzonCanonico);
    const [filas] = await conexion.execute(
      `
        SELECT
          ${this.columnasSeleccionUsuario('u')}
        FROM usuarios u
        WHERE u.id = ?
          AND u.generacion_recuperacion = ?
          AND u.email = ?
          AND BINARY u.email = BINARY ?
          AND u.activo = 1
          AND u.email_validado = 1
        LIMIT 1
        FOR UPDATE
      `,
      [id, generacion, buzon, buzon]
    );

    return filas.length === 0 ? null : new Usuario(filas[0]);
  }

  async sustituirPasswordPorRecuperacionEnTransaccion({
    idUsuario,
    generacionRecuperacionObservada,
    buzonCanonico,
    hashPasswordNuevo
  }, { conexion } = {}) {
    exigirConexionPrestada(conexion);
    const id = decimalPositivo(idUsuario, 'idUsuario');
    const generacion = decimalPositivo(
      generacionRecuperacionObservada,
      'generacionRecuperacionObservada'
    );
    const buzon = exigirBuzonCanonicoCorreo(buzonCanonico);
    const hash = String(hashPasswordNuevo ?? '');
    if (!hash) throw new Error('hashPasswordNuevo es obligatorio.');
    const [resultado] = await conexion.execute(
      `UPDATE usuarios
          SET hash_password=?,requiere_cambio_password=0,
              version_sesion=version_sesion+1,
              generacion_recuperacion=generacion_recuperacion+1
        WHERE id=? AND generacion_recuperacion=?
          AND email=? AND BINARY email=BINARY ?
          AND activo=1 AND email_validado=1`,
      [hash, id, generacion, buzon, buzon]
    );
    if (Number(resultado.affectedRows || 0) !== 1) return null;
    return this.buscarPorIdEnTransaccion(id, { conexion });
  }

  async registrarAccesoExitoso(idUsuario) {
    await this.clienteSql.ejecutar(
      `
        UPDATE usuarios
        SET
          ultimo_acceso = UTC_TIMESTAMP(),
          contador_accesos = contador_accesos + 1
        WHERE id = ?
      `,
      [idUsuario]
    );
  }

  async actualizarPasswordObligatoria({
    idUsuario,
    hashPasswordNuevo,
    versionSesionObservada
  }) {
    const version = normalizarVersionSesionObservada(versionSesionObservada);
    const conexion = await this.clienteSql.obtenerConexion();

    try {
      await conexion.beginTransaction();
      const [resultado] = await conexion.execute(
        `
          UPDATE usuarios
          SET
            hash_password = ?,
            requiere_cambio_password = 0,
            version_sesion = version_sesion + 1,
            generacion_recuperacion = generacion_recuperacion + 1
          WHERE id = ?
            AND activo = 1
            AND requiere_cambio_password = 1
            AND version_sesion = ?
        `,
        [hashPasswordNuevo, idUsuario, version]
      );

      if (Number(resultado.affectedRows || 0) !== 1) {
        await conexion.rollback();
        return null;
      }

      const usuario = await this.buscarPorIdEnTransaccion(idUsuario, {
        conexion,
        forUpdate: true
      });
      await conexion.commit();
      return usuario;
    } catch (error) {
      await conexion.rollback();
      throw error;
    } finally {
      conexion.release();
    }
  }

  async actualizarPasswordPropio({
    idUsuario,
    hashPasswordActual,
    hashPasswordNuevo,
    versionSesionActual
  }) {
    return this.actualizarPasswordPropioEnTransaccion({
      idUsuario,
      hashPasswordActual,
      hashPasswordNuevo,
      versionSesionActual
    });
  }

  async actualizarPasswordPropioEnTransaccion({
    idUsuario,
    hashPasswordActual,
    hashPasswordNuevo,
    versionSesionActual
  }, { conexion = null } = {}) {
    const [resultado] = await ejecutarSql(this.clienteSql, conexion,
      `
        UPDATE usuarios
        SET
          hash_password = ?,
          version_sesion = version_sesion + 1,
          generacion_recuperacion = generacion_recuperacion + 1
        WHERE id = ?
          AND activo = 1
          AND BINARY hash_password = BINARY ?
          AND version_sesion = ?
      `,
      [
        hashPasswordNuevo,
        idUsuario,
        hashPasswordActual,
        versionSesionActual
      ]
    );

    if (Number(resultado.affectedRows || 0) > 0) {
      return {
        estado: 'actualizado',
        versionSesion: Number(versionSesionActual) + 1
      };
    }

    const usuario = conexion
      ? await this.buscarPorIdEnTransaccion(idUsuario, { conexion })
      : await this.buscarPorId(idUsuario);

    if (!usuario || !usuario.activo) {
      return {
        estado: 'sesion_no_vigente'
      };
    }

    return {
      estado: 'conflicto'
    };
  }

  async reiniciarPasswordAdministrativa({ idUsuario, hashPasswordNuevo }) {
    const conexion = await this.clienteSql.obtenerConexion();
    try {
      await conexion.beginTransaction();
      const usuario = await this.reiniciarPasswordAdministrativaEnTransaccion(
        { idUsuario, hashPasswordNuevo },
        { conexion }
      );
      await conexion.commit();
      return usuario;
    } catch (error) {
      await conexion.rollback();
      throw error;
    } finally {
      conexion.release();
    }
  }

  async reiniciarPasswordAdministrativaEnTransaccion(
    { idUsuario, hashPasswordNuevo },
    { conexion } = {}
  ) {
    exigirConexionPrestada(conexion);
    const [resultado] = await conexion.execute(
      `
        UPDATE usuarios
        SET
          hash_password = ?,
          requiere_cambio_password = 1,
          version_sesion = version_sesion + 1,
          generacion_recuperacion = generacion_recuperacion + 1
        WHERE id = ?
          AND activo = 1
      `,
      [hashPasswordNuevo, idUsuario]
    );
    if (Number(resultado.affectedRows || 0) === 0) return null;
    return this.buscarPorIdEnTransaccion(idUsuario, { conexion });
  }

  async establecerActivoAdministrativo({ idUsuario, activo }) {
    return this.establecerActivoAdministrativoEnTransaccion({
      idUsuario,
      activo
    });
  }

  async establecerActivoAdministrativoEnTransaccion(
    { idUsuario, activo },
    { conexion = null } = {}
  ) {
    await ejecutarSql(this.clienteSql, conexion,
      `
        UPDATE usuarios
        SET
          activo = ?,
          version_sesion = version_sesion + 1,
          generacion_recuperacion = generacion_recuperacion + 1
        WHERE id = ?
          AND activo <> ?
      `,
      [activo ? 1 : 0, idUsuario, activo ? 1 : 0]
    );
    return conexion
      ? this.buscarPorIdEnTransaccion(idUsuario, { conexion })
      : this.buscarPorId(idUsuario);
  }

  async crearUsuarioInicialEnTransaccion({
    usuario,
    email,
    hashPassword,
    nombreMostrar = 'Administrador'
  }, { conexion } = {}) {
    exigirConexionPrestada(conexion);
    const [cabeceras] = await conexion.execute(
      `SELECT id
         FROM cabecera_bootstrap_usuario_inicial
        WHERE id = 1
        FOR UPDATE`
    );
    if (cabeceras.length !== 1) {
      throw new Error('Falta la cabecera de coordinación del usuario inicial.');
    }
    const [existentes] = await conexion.execute(
      `SELECT CAST(id AS CHAR) AS id
         FROM usuarios
        ORDER BY id ASC
        LIMIT 1
        FOR UPDATE`
    );
    if (existentes.length > 0) {
      const [[conteo]] = await conexion.execute(
        'SELECT COUNT(*) AS total FROM usuarios'
      );
      return Object.freeze({
        creado: false,
        usuarioId: null,
        totalUsuarios: Number(conteo?.total || existentes.length)
      });
    }
    const [resultado] = await conexion.execute(
      `
        INSERT INTO usuarios (
          usuario,
          email,
          hash_password,
          activo,
          es_superusuario,
          requiere_cambio_password,
          version_sesion,
          generacion_recuperacion,
          contador_accesos,
          nombre_mostrar,
          permiso_ver_monitores,
          permiso_ver_triggers,
          permiso_ver_dns,
          permiso_ver,
          permiso_ver_auditoria,
          permiso_editar,
          permiso_editar_triggers,
          permiso_editar_dns,
          permiso_gestionar_vinculos_triggers,
          permiso_administrar_usuarios,
          permiso_administrar_configuracion,
          permiso_publicar_dns,
          permiso_administrar_dns_avanzado,
          permiso_ver_agentes,
          permiso_modificar_agentes,
          permiso_eliminar_agentes,
          permiso_administrar_organizacion,
          permiso_administrar_tenants,
          permiso_administrar_empresas,
          permiso_administrar_sitios,
          permiso_impersonacion,
          permiso_configurar_emisiones_federacion,
          permiso_configurar_recepciones_federacion,
          permiso_activar_relaciones_federacion,
          permiso_gestionar_credenciales_federacion,
          permiso_transferir_responsabilidad_federacion,
          permiso_resolver_conflictos_federacion,
          permiso_ver_diagnostico_federacion,
          permiso_ver_avisos_plataforma,
          permiso_ver_alertas_remotas
        ) VALUES (?, ?, ?, 1, 1, 0, 1, 1, 0, ?, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1)
      `,
      [usuario, email, hashPassword, nombreMostrar]
    );
    if (!resultado.insertId) {
      throw new Error('No se obtuvo la identidad del usuario inicial.');
    }
    const [cabeceraActualizada] = await conexion.execute(
      `UPDATE cabecera_bootstrap_usuario_inicial
          SET revision = revision + 1
        WHERE id = 1`,
      []
    );
    if (Number(cabeceraActualizada.affectedRows) !== 1) {
      throw new Error('No se pudo consolidar la coordinación del usuario inicial.');
    }
    return Object.freeze({
      creado: true,
      usuarioId: String(resultado.insertId),
      totalUsuarios: 1
    });
  }

  async contarUsuarios() {
    const filas = await this.clienteSql.consultar(
      `
        SELECT COUNT(*) AS total
        FROM usuarios
      `
    );

    return filas[0]?.total ?? 0;
  }

  async contarUsuariosConTenant(tenantId) {
    const filas = await this.clienteSql.consultar(
      `
        SELECT COUNT(*) AS total
        FROM usuarios
        WHERE tenant_id = ?
      `,
      [tenantId]
    );

    return filas[0]?.total ?? 0;
  }

  async contarUsuariosConEmpresa(empresaId) {
    const filas = await this.clienteSql.consultar(
      `
        SELECT COUNT(*) AS total
        FROM usuarios
        WHERE empresa_id = ?
      `,
      [empresaId]
    );

    return filas[0]?.total ?? 0;
  }

  async contarUsuariosConSitio(sitioId) {
    const filas = await this.clienteSql.consultar(
      `
        SELECT COUNT(*) AS total
        FROM usuarios
        WHERE sitio_id = ?
      `,
      [sitioId]
    );

    return filas[0]?.total ?? 0;
  }

  async listarParaAdministracion(contextoUsuarioActual, { textoBusqueda = '' } = {}) {
    const { where, parametros } = this.construirFiltroScopeAdministracion(
      contextoUsuarioActual,
      textoBusqueda
    );

    const filas = await this.clienteSql.consultar(
      `
        SELECT
          ${this.columnasSeleccionUsuario('u')},
          t.nombre AS tenant_nombre,
          e.nombre AS empresa_nombre,
          s.nombre AS sitio_nombre
        FROM usuarios u
        LEFT JOIN tenants t ON t.id = u.tenant_id
        LEFT JOIN empresas e ON e.id = u.empresa_id
        LEFT JOIN sitios s ON s.id = u.sitio_id
        ${where}
        ORDER BY u.usuario ASC, u.id ASC
      `,
      parametros
    );

    return filas.map((fila) => new Usuario(fila));
  }

  async listarPaginadoParaAdministracion(
    contextoUsuarioActual,
    {
      textoBusqueda = '',
      tenantId = null,
      empresaId = null,
      sitioId = null,
      soloActivos = 'solo_activos',
      pagina = 1,
      tamanoPagina = 10,
      ordenarPor = 'fecha_creacion',
      direccionOrden = 'desc',
      excluirIds = []
    } = {}
  ) {
    const consulta = this.construirConsultaAdministracion(
      contextoUsuarioActual,
      {
        textoBusqueda,
        tenantId,
        empresaId,
        sitioId,
        soloActivos,
        excluirIds
      }
    );
    const tamanoNormalizado = this.normalizarTamanoPagina(tamanoPagina);
    const paginaNormalizada = this.normalizarPagina(pagina);
    const offset = (paginaNormalizada - 1) * tamanoNormalizado;
    const orden = this.resolverOrdenAdministracion(ordenarPor, direccionOrden);

    const [filas, totalVisible, totalFiltrado] = await Promise.all([
      this.clienteSql.consultar(
        `
          SELECT
            ${this.columnasSeleccionUsuario('u')},
            t.nombre AS tenant_nombre,
            e.nombre AS empresa_nombre,
            s.nombre AS sitio_nombre
          FROM usuarios u
          LEFT JOIN tenants t ON t.id = u.tenant_id
          LEFT JOIN empresas e ON e.id = u.empresa_id
          LEFT JOIN sitios s ON s.id = u.sitio_id
          ${consulta.where}
          ORDER BY ${orden.campo} ${orden.direccion}, u.id ${orden.direccion}
          LIMIT ? OFFSET ?
        `,
        [...consulta.parametros, tamanoNormalizado, offset]
      ),
      this.contarVisibleParaAdministracion(contextoUsuarioActual, {
        excluirIds
      }),
      this.contarFiltradoParaAdministracion(contextoUsuarioActual, {
        textoBusqueda,
        tenantId,
        empresaId,
        sitioId,
        soloActivos,
        excluirIds
      })
    ]);

    return {
      usuarios: filas.map((fila) => new Usuario(fila)),
      paginacion: {
        pagina: paginaNormalizada,
        tamanoPagina: tamanoNormalizado,
        totalVisible,
        totalFiltrado,
        totalPaginas: Math.max(1, Math.ceil(totalFiltrado / tamanoNormalizado))
      }
    };
  }

  async buscarPorIdParaAdministracion(contextoUsuarioActual, idUsuario) {
    const { where, parametros } = this.construirFiltroScopeAdministracion(
      contextoUsuarioActual
    );
    const filas = await this.clienteSql.consultar(
      `
        SELECT
          ${this.columnasSeleccionUsuario('u')},
          t.nombre AS tenant_nombre,
          e.nombre AS empresa_nombre,
          s.nombre AS sitio_nombre
        FROM usuarios u
        LEFT JOIN tenants t ON t.id = u.tenant_id
        LEFT JOIN empresas e ON e.id = u.empresa_id
        LEFT JOIN sitios s ON s.id = u.sitio_id
        ${where ? `${where} AND u.id = ?` : 'WHERE u.id = ?'}
        LIMIT 1
      `,
      [...parametros, idUsuario]
    );

    return filas.length > 0 ? new Usuario(filas[0]) : null;
  }

  async buscarPorIdParaAdministracionEnTransaccion(
    contextoUsuarioActual,
    idUsuario,
    { conexion, forUpdate = false, excluirIds = [] } = {}
  ) {
    exigirConexionPrestada(conexion);
    const { where, parametros } = this.construirConsultaAdministracion(
      contextoUsuarioActual,
      { excluirIds }
    );
    const [filas] = await conexion.execute(
      `
        SELECT
          ${this.columnasSeleccionUsuario('u')},
          t.nombre AS tenant_nombre,
          e.nombre AS empresa_nombre,
          s.nombre AS sitio_nombre
        FROM usuarios u
        LEFT JOIN tenants t ON t.id = u.tenant_id
        LEFT JOIN empresas e ON e.id = u.empresa_id
        LEFT JOIN sitios s ON s.id = u.sitio_id
        ${where ? `${where} AND u.id = ?` : 'WHERE u.id = ?'}
        LIMIT 1
        ${forUpdate ? 'FOR UPDATE' : ''}
      `,
      [...parametros, idUsuario]
    );

    return filas.length > 0 ? new Usuario(filas[0]) : null;
  }

  async crearUsuarioAdministrativo({
    usuario,
    email,
    hashPassword,
    nombreMostrar,
    nombreCompleto,
    tenantId,
    empresaId,
    sitioId,
    permisos,
    requiereCambioPassword = true
  }) {
    return this.crearUsuarioAdministrativoEnTransaccion({
      usuario,
      email,
      hashPassword,
      nombreMostrar,
      nombreCompleto,
      tenantId,
      empresaId,
      sitioId,
      permisos,
      requiereCambioPassword
    });
  }

  async crearUsuarioAdministrativoEnTransaccion({
    usuario,
    email,
    hashPassword,
    nombreMostrar,
    nombreCompleto,
    tenantId,
    empresaId,
    sitioId,
    permisos,
    requiereCambioPassword = true
  }, { conexion = null } = {}) {
    const [resultado] = await ejecutarSql(this.clienteSql, conexion,
      `
        INSERT INTO usuarios (
          usuario,
          email,
          hash_password,
          activo,
          es_superusuario,
          requiere_cambio_password,
          version_sesion,
          generacion_recuperacion,
          contador_accesos,
          nombre_mostrar,
          nombre_completo,
          tenant_id,
          empresa_id,
          sitio_id,
          permiso_ver_monitores,
          permiso_ver_triggers,
          permiso_ver_dns,
          permiso_ver,
          permiso_ver_auditoria,
          permiso_editar,
          permiso_editar_triggers,
          permiso_editar_dns,
          permiso_gestionar_vinculos_triggers,
          permiso_administrar_usuarios,
          permiso_administrar_configuracion,
          permiso_publicar_dns,
          permiso_administrar_dns_avanzado,
          permiso_ver_agentes,
          permiso_modificar_agentes,
          permiso_eliminar_agentes,
          permiso_administrar_organizacion,
          permiso_administrar_tenants,
          permiso_administrar_empresas,
          permiso_administrar_sitios,
          permiso_impersonacion,
          permiso_configurar_emisiones_federacion,
          permiso_configurar_recepciones_federacion,
          permiso_activar_relaciones_federacion,
          permiso_gestionar_credenciales_federacion,
          permiso_transferir_responsabilidad_federacion,
          permiso_resolver_conflictos_federacion,
          permiso_ver_diagnostico_federacion,
          permiso_ver_avisos_plataforma,
          permiso_ver_alertas_remotas
        ) VALUES (?, ?, ?, 1, 0, ?, 1, 1, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        usuario,
        email,
        hashPassword,
        requiereCambioPassword ? 1 : 0,
        nombreMostrar || null,
        nombreCompleto || null,
        tenantId,
        empresaId,
        sitioId,
        permisos.verMonitores,
        permisos.verTriggers,
        permisos.verDns,
        permisos.ver,
        permisos.verAuditoria,
        permisos.editar,
        permisos.editarTriggers,
        permisos.editarDns,
        permisos.gestionarVinculosTriggers,
        permisos.administrarUsuarios,
        permisos.administrarConfiguracion,
        permisos.publicarDns,
        permisos.administrarDnsAvanzado,
        permisos.verAgentes,
        permisos.modificarAgentes,
        permisos.eliminarAgentes,
        permisos.administrarOrganizacion,
        permisos.administrarTenants,
        permisos.administrarEmpresas,
        permisos.administrarSitios,
        permisos.impersonacion,
        permisos.configurarEmisionesFederacion,
        permisos.configurarRecepcionesFederacion,
        permisos.activarRelacionesFederacion,
        permisos.gestionarCredencialesFederacion,
        permisos.transferirResponsabilidadFederacion,
        permisos.resolverConflictosFederacion,
        permisos.verDiagnosticoFederacion,
        permisos.verAvisosPlataforma,
        permisos.verAlertasRemotas
      ]
    );

    return conexion
      ? this.buscarPorIdEnTransaccion(resultado.insertId, { conexion })
      : this.buscarPorId(resultado.insertId);
  }

  async actualizarMetadatosAdministrativos({
    idUsuario,
    email,
    nombreMostrar,
    nombreCompleto
  }) {
    await this.clienteSql.ejecutar(
      `
        UPDATE usuarios
        SET
          generacion_recuperacion = generacion_recuperacion +
            IF(NOT (BINARY email <=> BINARY ?), 1, 0),
          email_validado = CASE
            WHEN BINARY email = BINARY ? THEN email_validado
            ELSE 0
          END,
          email = ?,
          nombre_mostrar = ?,
          nombre_completo = ?
        WHERE id = ?
      `,
      [
        email,
        email,
        email,
        nombreMostrar || null,
        nombreCompleto || null,
        idUsuario
      ]
    );

    return this.buscarPorId(idUsuario);
  }

  async actualizarNombreMostrarPropio({ idUsuario, nombreMostrar }) {
    return this.actualizarNombrePropio({
      idUsuario,
      columna: 'nombre_mostrar',
      valor: nombreMostrar
    });
  }

  async actualizarNombreCompletoPropio({ idUsuario, nombreCompleto }) {
    return this.actualizarNombrePropio({
      idUsuario,
      columna: 'nombre_completo',
      valor: nombreCompleto
    });
  }

  async actualizarPreferenciaAlertasRemotasPropiaEnTransaccion(
    { idUsuario, mostrar }, { conexion = null } = {}
  ) {
    const [resultado] = await ejecutarSql(this.clienteSql, conexion,
      `UPDATE usuarios SET preferencia_mostrar_alertas_remotas=?
        WHERE id=? AND activo=1
          AND preferencia_mostrar_alertas_remotas<>?`,
      [mostrar ? 1 : 0, idUsuario, mostrar ? 1 : 0]
    );
    const usuario = conexion
      ? await this.buscarPorIdEnTransaccion(idUsuario, { conexion })
      : await this.buscarPorId(idUsuario);
    return { usuarioActivo: Boolean(usuario?.activo),
      modificado: Number(resultado.affectedRows || 0) === 1 };
  }

  async actualizarNombrePropio({ idUsuario, columna, valor }) {
    return this.actualizarNombrePropioEnTransaccion({
      idUsuario,
      columna,
      valor
    });
  }

  async actualizarNombrePropioEnTransaccion(
    { idUsuario, columna, valor },
    { conexion = null } = {}
  ) {
    const columnasPermitidas = new Set([
      'nombre_mostrar',
      'nombre_completo'
    ]);

    if (!columnasPermitidas.has(columna)) {
      throw new Error('El atributo de perfil no es editable.');
    }

    const [resultado] = await ejecutarSql(this.clienteSql, conexion,
      `
        UPDATE usuarios
        SET ${columna} = ?
        WHERE id = ?
          AND activo = 1
          AND NOT (BINARY ${columna} <=> BINARY ?)
      `,
      [valor, idUsuario, valor]
    );

    if (Number(resultado.affectedRows || 0) > 0) {
      return {
        usuarioActivo: true,
        modificado: true
      };
    }

    const usuario = conexion
      ? await this.buscarPorIdEnTransaccion(idUsuario, { conexion })
      : await this.buscarPorId(idUsuario);

    return {
      usuarioActivo: Boolean(usuario?.activo),
      modificado: false
    };
  }

  async actualizarUsuarioAdministrativo({
    idUsuario,
    email,
    nombreMostrar,
    nombreCompleto,
    tenantId,
    empresaId,
    sitioId,
    permisos,
    incrementarVersionSesion = false
  }) {
    return this.actualizarUsuarioAdministrativoEnTransaccion({
      idUsuario,
      email,
      nombreMostrar,
      nombreCompleto,
      tenantId,
      empresaId,
      sitioId,
      permisos,
      incrementarVersionSesion
    });
  }

  async actualizarUsuarioAdministrativoEnTransaccion({
    idUsuario,
    email,
    nombreMostrar,
    nombreCompleto,
    tenantId,
    empresaId,
    sitioId,
    permisos,
    incrementarVersionSesion = false
  }, { conexion = null } = {}) {
    await ejecutarSql(this.clienteSql, conexion,
      `
        UPDATE usuarios
        SET
          generacion_recuperacion = generacion_recuperacion +
            IF(NOT (BINARY email <=> BINARY ?), 1, 0),
          email_validado = CASE
            WHEN BINARY email = BINARY ? THEN email_validado
            ELSE 0
          END,
          email = ?,
          nombre_mostrar = ?,
          nombre_completo = ?,
          tenant_id = ?,
          empresa_id = ?,
          sitio_id = ?,
          permiso_ver_monitores = ?,
          permiso_ver_triggers = ?,
          permiso_ver_dns = ?,
          permiso_ver = ?,
          permiso_ver_auditoria = ?,
          permiso_editar = ?,
          permiso_editar_triggers = ?,
          permiso_editar_dns = ?,
          permiso_gestionar_vinculos_triggers = ?,
          permiso_administrar_usuarios = ?,
          permiso_administrar_configuracion = ?,
          permiso_publicar_dns = ?,
          permiso_administrar_dns_avanzado = ?,
          permiso_ver_agentes = ?,
          permiso_modificar_agentes = ?,
          permiso_eliminar_agentes = ?,
          permiso_administrar_organizacion = ?,
          permiso_administrar_tenants = ?,
          permiso_administrar_empresas = ?,
          permiso_administrar_sitios = ?,
          permiso_impersonacion = ?,
          permiso_configurar_emisiones_federacion = ?,
          permiso_configurar_recepciones_federacion = ?,
          permiso_activar_relaciones_federacion = ?,
          permiso_gestionar_credenciales_federacion = ?,
          permiso_transferir_responsabilidad_federacion = ?,
          permiso_resolver_conflictos_federacion = ?,
          permiso_ver_diagnostico_federacion = ?,
          permiso_ver_avisos_plataforma = ?,
          permiso_ver_alertas_remotas = ?,
          version_sesion = version_sesion + ?
        WHERE id = ?
      `,
      [
        email,
        email,
        email,
        nombreMostrar || null,
        nombreCompleto || null,
        tenantId,
        empresaId,
        sitioId,
        permisos.verMonitores,
        permisos.verTriggers,
        permisos.verDns,
        permisos.ver,
        permisos.verAuditoria,
        permisos.editar,
        permisos.editarTriggers,
        permisos.editarDns,
        permisos.gestionarVinculosTriggers,
        permisos.administrarUsuarios,
        permisos.administrarConfiguracion,
        permisos.publicarDns,
        permisos.administrarDnsAvanzado,
        permisos.verAgentes,
        permisos.modificarAgentes,
        permisos.eliminarAgentes,
        permisos.administrarOrganizacion,
        permisos.administrarTenants,
        permisos.administrarEmpresas,
        permisos.administrarSitios,
        permisos.impersonacion,
        permisos.configurarEmisionesFederacion,
        permisos.configurarRecepcionesFederacion,
        permisos.activarRelacionesFederacion,
        permisos.gestionarCredencialesFederacion,
        permisos.transferirResponsabilidadFederacion,
        permisos.resolverConflictosFederacion,
        permisos.verDiagnosticoFederacion,
        permisos.verAvisosPlataforma,
        permisos.verAlertasRemotas,
        incrementarVersionSesion ? 1 : 0,
        idUsuario
      ]
    );

    return conexion
      ? this.buscarPorIdEnTransaccion(idUsuario, { conexion })
      : this.buscarPorId(idUsuario);
  }

  async actualizarEmailYEstadoValidacion({
    idUsuario,
    email,
    emailValidado
  }) {
    await this.clienteSql.ejecutar(
      `
        UPDATE usuarios
        SET
          generacion_recuperacion = generacion_recuperacion + IF(
            NOT (BINARY email <=> BINARY ?)
              OR email_validado <> ?,
            1,
            0
          ),
          email = ?,
          email_validado = ?
        WHERE id = ?
      `,
      [
        email,
        emailValidado ? 1 : 0,
        email,
        emailValidado ? 1 : 0,
        idUsuario
      ]
    );

    return this.buscarPorId(idUsuario);
  }

  async actualizarEmailNoValidado({
    idUsuario,
    emailActual,
    emailNuevo
  }) {
    const [resultado] = await this.clienteSql.ejecutar(
      `
        UPDATE usuarios
        SET
          email = ?,
          email_validado = 0,
          generacion_recuperacion = generacion_recuperacion + 1
        WHERE id = ?
          AND activo = 1
          AND BINARY email = BINARY ?
          AND NOT (BINARY email <=> BINARY ?)
      `,
      [emailNuevo, idUsuario, emailActual, emailNuevo]
    );

    if (Number(resultado.affectedRows || 0) > 0) {
      return {
        estado: 'actualizado'
      };
    }

    const usuario = await this.buscarPorId(idUsuario);

    if (!usuario || !usuario.activo) {
      return {
        estado: 'sesion_no_vigente'
      };
    }

    if (usuario.email === emailNuevo) {
      return {
        estado: 'sin_cambios',
        emailValidado: usuario.emailValidado
      };
    }

    return {
      estado: 'conflicto'
    };
  }

  async actualizarEmailNoValidadoEnTransaccion({
    idUsuario,
    emailActual,
    emailNuevo,
    hashPasswordActual
  }, { conexion } = {}) {
    exigirConexionPrestada(conexion);
    const [resultado] = await conexion.execute(
      `UPDATE usuarios
          SET email=?,email_validado=0,
              generacion_recuperacion=generacion_recuperacion+1
        WHERE id=? AND activo=1
          AND BINARY email=BINARY ?
          AND NOT (BINARY email<=>BINARY ?)
          AND BINARY hash_password=BINARY ?`,
      [emailNuevo, idUsuario, emailActual, emailNuevo, hashPasswordActual]
    );
    return Object.freeze({
      estado: Number(resultado.affectedRows || 0) === 1
        ? 'actualizado'
        : 'conflicto'
    });
  }

  async marcarEmailValidadoSiCoincide({ idUsuario, email }) {
    await this.clienteSql.ejecutar(
      `
        UPDATE usuarios
        SET
          email_validado = 1,
          generacion_recuperacion = generacion_recuperacion + 1
        WHERE id = ?
          AND BINARY email = BINARY ?
          AND email_validado = 0
      `,
      [idUsuario, email]
    );

    const usuario = await this.buscarPorId(idUsuario);

    if (!usuario || usuario.email !== email || !usuario.emailValidado) {
      return null;
    }

    return usuario;
  }

  async confirmarEmailValidadoPendiente({
    idUsuario,
    emailOrigen,
    emailCandidato
  }) {
    return this.confirmarEmailValidadoPendienteEnTransaccion({
      idUsuario,
      emailOrigen,
      emailCandidato
    });
  }

  async confirmarEmailValidadoPendienteEnTransaccion({
    idUsuario,
    emailOrigen,
    emailCandidato
  }, { conexion = null } = {}) {
    const [resultado] = await ejecutarSql(this.clienteSql, conexion,
      `
        UPDATE usuarios
        SET
          email = ?,
          email_validado = 1,
          generacion_recuperacion = generacion_recuperacion + 1
        WHERE id = ?
          AND activo = 1
          AND BINARY email = BINARY ?
          AND (
            NOT (BINARY email <=> BINARY ?)
            OR email_validado <> 1
          )
      `,
      [emailCandidato, idUsuario, emailOrigen, emailCandidato]
    );

    if (Number(resultado.affectedRows || 0) > 0) {
      return { estado: 'actualizado' };
    }

    const usuario = conexion
      ? await this.buscarPorIdEnTransaccion(idUsuario, { conexion })
      : await this.buscarPorId(idUsuario);

    if (!usuario || !usuario.activo) {
      return { estado: 'sesion_no_vigente' };
    }

    if (usuario.email === emailCandidato && usuario.emailValidado) {
      return { estado: 'ya_aplicado' };
    }

    return { estado: 'conflicto' };
  }

  async listarActivosParaCobertura({ excluirIdUsuario = null } = {}) {
    const condiciones = ['u.activo = 1'];
    const parametros = [];

    if (excluirIdUsuario != null) {
      condiciones.push('u.id <> ?');
      parametros.push(excluirIdUsuario);
    }

    const filas = await this.clienteSql.consultar(
      `
        SELECT
          ${this.columnasSeleccionUsuario('u')},
          t.nombre AS tenant_nombre,
          e.nombre AS empresa_nombre,
          s.nombre AS sitio_nombre
        FROM usuarios u
        LEFT JOIN tenants t ON t.id = u.tenant_id
        LEFT JOIN empresas e ON e.id = u.empresa_id
        LEFT JOIN sitios s ON s.id = u.sitio_id
        WHERE ${condiciones.join(' AND ')}
        ORDER BY u.id ASC
      `,
      parametros
    );

    return filas.map((fila) => new Usuario(fila));
  }

  async eliminarPorId(idUsuario) {
    const conexion = await this.clienteSql.obtenerConexion();

    try {
      await conexion.beginTransaction();
      const eliminado = await this.eliminarPorIdEnTransaccion(idUsuario, {
        conexion
      });

      await conexion.commit();

      return eliminado;
    } catch (error) {
      await conexion.rollback();
      throw error;
    } finally {
      conexion.release();
    }
  }

  async eliminarPorIdEnTransaccion(idUsuario, { conexion } = {}) {
    exigirConexionPrestada(conexion);
    const [resultado] = await conexion.execute(
      `
        DELETE FROM usuarios
        WHERE id = ?
      `,
      [idUsuario]
    );

    return Number(resultado.affectedRows || 0) > 0;
  }

  columnasSeleccionUsuario(alias) {
    return `
      ${alias}.id,
      ${alias}.usuario,
      ${alias}.email,
      ${alias}.email_validado,
      ${alias}.hash_password,
      ${alias}.activo,
      ${alias}.es_superusuario,
      ${alias}.requiere_cambio_password,
      ${alias}.version_sesion,
      ${alias}.generacion_recuperacion,
      ${alias}.ultimo_acceso,
      ${alias}.contador_accesos,
      ${alias}.nombre_mostrar,
      ${alias}.nombre_completo,
      ${alias}.tenant_id,
      ${alias}.empresa_id,
      ${alias}.sitio_id,
      ${alias}.fecha_creacion,
      ${alias}.fecha_actualizacion,
      ${alias}.permiso_ver_monitores,
      ${alias}.permiso_ver_triggers,
      ${alias}.permiso_ver_dns,
      ${alias}.permiso_ver,
      ${alias}.permiso_ver_auditoria,
      ${alias}.permiso_editar,
      ${alias}.permiso_editar_triggers,
      ${alias}.permiso_editar_dns,
      ${alias}.permiso_gestionar_vinculos_triggers,
      ${alias}.permiso_administrar_usuarios,
      ${alias}.permiso_administrar_configuracion,
      ${alias}.permiso_publicar_dns,
      ${alias}.permiso_administrar_dns_avanzado,
      ${alias}.permiso_ver_agentes,
      ${alias}.permiso_modificar_agentes,
      ${alias}.permiso_eliminar_agentes,
      ${alias}.permiso_administrar_organizacion,
      ${alias}.permiso_administrar_tenants,
      ${alias}.permiso_administrar_empresas,
      ${alias}.permiso_administrar_sitios,
      ${alias}.permiso_impersonacion,
      ${alias}.permiso_configurar_emisiones_federacion,
      ${alias}.permiso_configurar_recepciones_federacion,
      ${alias}.permiso_activar_relaciones_federacion,
      ${alias}.permiso_gestionar_credenciales_federacion,
      ${alias}.permiso_transferir_responsabilidad_federacion,
      ${alias}.permiso_resolver_conflictos_federacion,
      ${alias}.permiso_ver_diagnostico_federacion,
      ${alias}.permiso_ver_avisos_plataforma,
      ${alias}.permiso_ver_alertas_remotas,
      ${alias}.preferencia_mostrar_alertas_remotas
    `;
  }

  construirFiltroScopeAdministracion(contextoUsuarioActual, textoBusqueda = '') {
    return this.construirConsultaAdministracion(contextoUsuarioActual, {
      textoBusqueda
    });
  }

  construirConsultaAdministracion(
    contextoUsuarioActual,
    {
      textoBusqueda = '',
      tenantId = null,
      empresaId = null,
      sitioId = null,
      soloActivos = 'solo_activos',
      excluirIds = []
    } = {}
  ) {
    const condiciones = [];
    const parametros = [];

    if (contextoUsuarioActual?.nivelScope === 'tenant') {
      condiciones.push('u.tenant_id = ?');
      parametros.push(contextoUsuarioActual.tenantId);
    } else if (contextoUsuarioActual?.nivelScope === 'empresa') {
      condiciones.push('u.tenant_id = ?');
      condiciones.push('u.empresa_id = ?');
      parametros.push(
        contextoUsuarioActual.tenantId,
        contextoUsuarioActual.empresaId
      );
    } else if (contextoUsuarioActual?.nivelScope === 'sitio') {
      condiciones.push('u.tenant_id = ?');
      condiciones.push('u.empresa_id = ?');
      condiciones.push('u.sitio_id = ?');
      parametros.push(
        contextoUsuarioActual.tenantId,
        contextoUsuarioActual.empresaId,
        contextoUsuarioActual.sitioId
      );
    }

    const textoNormalizado = String(textoBusqueda || '').trim();

    if (textoNormalizado) {
      const patron = `%${textoNormalizado}%`;
      condiciones.push(
        `(
          u.usuario LIKE ?
          OR u.email LIKE ?
          OR COALESCE(u.nombre_mostrar, '') LIKE ?
          OR COALESCE(u.nombre_completo, '') LIKE ?
        )`
      );
      parametros.push(patron, patron, patron, patron);
    }

    const tenantNormalizado = this.normalizarIdOpcional(tenantId);
    const empresaNormalizada = this.normalizarIdOpcional(empresaId);
    const sitioNormalizado = this.normalizarIdOpcional(sitioId);

    if (tenantNormalizado != null) {
      condiciones.push('u.tenant_id = ?');
      parametros.push(tenantNormalizado);
    }

    if (empresaNormalizada != null) {
      condiciones.push('u.empresa_id = ?');
      parametros.push(empresaNormalizada);
    }

    if (sitioNormalizado != null) {
      condiciones.push('u.sitio_id = ?');
      parametros.push(sitioNormalizado);
    }

    if (soloActivos === 'solo_activos') {
      condiciones.push('u.activo = 1');
    } else if (soloActivos === 'solo_inactivos') {
      condiciones.push('u.activo = 0');
    }

    const idsExcluidosNormalizados = this.normalizarIdsEnterosPositivos(
      excluirIds
    );

    if (idsExcluidosNormalizados.length > 0) {
      condiciones.push(
        `u.id NOT IN (${idsExcluidosNormalizados.map(() => '?').join(', ')})`
      );
      parametros.push(...idsExcluidosNormalizados);
    }

    return {
      where: condiciones.length > 0 ? `WHERE ${condiciones.join(' AND ')}` : '',
      parametros
    };
  }

  async contarVisibleParaAdministracion(contextoUsuarioActual, filtros = {}) {
    const consulta = this.construirConsultaAdministracion(
      contextoUsuarioActual,
      { ...filtros, soloActivos: 'todos' }
    );
    const filas = await this.clienteSql.consultar(
      `
        SELECT COUNT(*) AS total
        FROM usuarios u
        ${consulta.where}
      `,
      consulta.parametros
    );

    return Number(filas[0]?.total || 0);
  }

  async contarFiltradoParaAdministracion(
    contextoUsuarioActual,
    filtros = {}
  ) {
    const consulta = this.construirConsultaAdministracion(
      contextoUsuarioActual,
      filtros
    );
    const filas = await this.clienteSql.consultar(
      `
        SELECT COUNT(*) AS total
        FROM usuarios u
        ${consulta.where}
      `,
      consulta.parametros
    );

    return Number(filas[0]?.total || 0);
  }

  resolverOrdenAdministracion(ordenarPor, direccionOrden) {
    const columnas = {
      id: 'u.id',
      usuario: 'u.usuario',
      nombre: 'COALESCE(u.nombre_mostrar, u.nombre_completo, u.usuario)',
      tenant: 'COALESCE(t.nombre, \'\')',
      empresa: 'COALESCE(e.nombre, \'\')',
      sitio: 'COALESCE(s.nombre, \'\')',
      activo: 'u.activo',
      creado: 'u.fecha_creacion',
      ultimo_acceso: 'u.ultimo_acceso'
    };
    const campo = columnas[String(ordenarPor || '').trim()] || 'u.fecha_creacion';
    const direccion = String(direccionOrden || '').toLowerCase() === 'asc'
      ? 'ASC'
      : 'DESC';

    return {
      campo,
      direccion
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
    return Number.isInteger(convertido) && convertido > 0
      ? convertido
      : null;
  }

  normalizarIdsEnterosPositivos(valores = []) {
    const lista = Array.isArray(valores) ? valores : [valores];
    const ids = lista
      .map((valor) => Number.parseInt(String(valor), 10))
      .filter((valor) => Number.isInteger(valor) && valor > 0);

    return Array.from(new Set(ids));
  }
}

function exigirConexionPrestada(conexion) {
  if (typeof conexion?.execute !== 'function') {
    throw new Error('La operación de usuario exige una conexión SQL prestada.');
  }
}

function ejecutarSql(clienteSql, conexion, sql, parametros) {
  return conexion
    ? conexion.execute(sql, parametros)
    : clienteSql.ejecutar(sql, parametros);
}

function normalizarVersionSesionObservada(valor) {
  const version = Number(valor);
  if (
    !Number.isInteger(version) ||
    version < 1 ||
    version > 4_294_967_295
  ) {
    throw new Error('versionSesionObservada debe ser un entero positivo válido.');
  }
  return version;
}

function decimalPositivo(valor, campo) {
  const texto = String(valor ?? '');
  if (!/^[1-9][0-9]*$/u.test(texto)) {
    throw new Error(`${campo} debe ser un entero decimal positivo.`);
  }
  return texto;
}
