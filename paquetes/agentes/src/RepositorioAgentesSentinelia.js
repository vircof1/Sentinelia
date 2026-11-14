import { crearAgenteSentineliaDesdeFila } from './AgenteSentinelia.js';
import {
  crearPeriodoVidaPolAgenteDesdeFila
} from './PeriodoVidaPolAgente.js';
import { ValidadorAgenteSentinelia } from './ValidadorAgenteSentinelia.js';
import {
  bytesAUuidV7Auditoria,
  uuidV7AuditoriaABytes
} from '../../auditoria/src/UuidV7Auditoria.js';

export class RepositorioAgentesSentinelia {
  constructor(clienteSql, { validador = new ValidadorAgenteSentinelia() } = {}) {
    this.clienteSql = clienteSql;
    this.validador = validador;
  }

  async listarVisibles(contextoUsuarioActual) {
    const { where, parametros } = this.construirFiltroScope(contextoUsuarioActual);
    const filas = await this.clienteSql.consultar(
      `
        SELECT
          ${this.columnasSeleccionAgente('a')},
          t.nombre AS tenant_nombre,
          e.nombre AS empresa_nombre,
          s.nombre AS sitio_nombre
        FROM agentes_sentinelia a
        INNER JOIN tenants t ON t.id = a.tenant_id
        INNER JOIN empresas e ON e.id = a.empresa_id
        INNER JOIN sitios s ON s.id = a.sitio_id
        ${where}
        ORDER BY t.nombre ASC, e.nombre ASC, s.nombre ASC, a.nombre ASC, a.id ASC
      `,
      parametros
    );

    return filas.map((fila) => crearAgenteSentineliaDesdeFila(fila));
  }

  async buscarVisiblesPorIds(contextoUsuarioActual, idsAgente = []) {
    const ids = [...new Set(idsAgente.map((id) => Number(id)))]
      .filter((id) => Number.isSafeInteger(id) && id > 0)
      .sort((a, b) => a - b);
    if (ids.length === 0) return [];
    if (ids.length > 100) {
      throw new Error('La resolución agrupada admite como máximo 100 agentes.');
    }
    const filtro = this.construirCondicionesScope(contextoUsuarioActual);
    const placeholders = ids.map(() => '?').join(',');
    const condiciones = [`a.id IN (${placeholders})`, ...filtro.condiciones];
    const filas = await this.clienteSql.consultar(
      `SELECT
         ${this.columnasSeleccionAgente('a')},
         t.nombre AS tenant_nombre,
         e.nombre AS empresa_nombre,
         s.nombre AS sitio_nombre
       FROM agentes_sentinelia a
       INNER JOIN tenants t ON t.id=a.tenant_id
       INNER JOIN empresas e ON e.id=a.empresa_id
       INNER JOIN sitios s ON s.id=a.sitio_id
       WHERE ${condiciones.join(' AND ')}
       ORDER BY a.id`,
      [...ids, ...filtro.parametros]
    );
    return filas.map((fila) => crearAgenteSentineliaDesdeFila(fila));
  }

  async listarPaginadoVisible(
    contextoUsuarioActual,
    {
      textoBusqueda = '',
      tenantId = null,
      empresaId = null,
      sitioId = null,
      estadoAdministrativo = '',
      estadoAcceso = '',
      estadoVidaPol = '',
      focoOperativo = 'todos',
      pagina = 1,
      tamanoPagina = 10,
      ordenarPor = 'nombre',
      direccionOrden = 'asc',
      silencioPolSegundos = 120
    } = {}
  ) {
    const filtroScope = this.construirCondicionesScope(contextoUsuarioActual);
    const filtroVisible = this.construirFiltroListadoAgentes({
      textoBusqueda,
      tenantId,
      empresaId,
      sitioId,
      estadoAdministrativo,
      estadoAcceso,
      estadoVidaPol,
      focoOperativo,
      silencioPolSegundos
    });
    const condiciones = [
      ...filtroScope.condiciones,
      ...filtroVisible.condiciones
    ];
    const parametros = [
      ...filtroScope.parametros,
      ...filtroVisible.parametros
    ];
    const where = condiciones.length > 0
      ? `WHERE ${condiciones.join(' AND ')}`
      : '';
    const paginaSolicitada = this.normalizarEnteroMinimo(pagina, 1, 1);
    const tamanoPaginaNormalizado = Math.min(
      100,
      this.normalizarEnteroMinimo(tamanoPagina, 1, 10)
    );
    const orderBy = this.construirOrdenListadoAgentes(
      ordenarPor,
      direccionOrden
    );
    const [conteoVisible] = await this.clienteSql.consultar(
      `
        SELECT COUNT(*) AS total
        FROM agentes_sentinelia a
        INNER JOIN tenants t ON t.id = a.tenant_id
        INNER JOIN empresas e ON e.id = a.empresa_id
        INNER JOIN sitios s ON s.id = a.sitio_id
        ${filtroScope.condiciones.length > 0
          ? `WHERE ${filtroScope.condiciones.join(' AND ')}`
          : ''}
      `,
      filtroScope.parametros
    );
    const [conteoFiltrado] = await this.clienteSql.consultar(
      `
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN a.estado_administrativo = 'activo' THEN 1 ELSE 0 END) AS activos,
          SUM(CASE WHEN a.estado_administrativo = 'deshabilitado' THEN 1 ELSE 0 END) AS deshabilitados,
          SUM(CASE WHEN a.estado_acceso = 'cuarentena' THEN 1 ELSE 0 END) AS en_cuarentena,
          SUM(CASE WHEN ${this.expresionEstadoVidaPolSql('vivo', silencioPolSegundos)} THEN 1 ELSE 0 END) AS vivos,
          SUM(CASE WHEN ${this.expresionEstadoVidaPolSql('silencioso', silencioPolSegundos)} THEN 1 ELSE 0 END) AS silenciosos,
          SUM(CASE WHEN ${this.expresionEstadoVidaPolSql('nunca_conectado', silencioPolSegundos)} THEN 1 ELSE 0 END) AS nunca_conectados
        FROM agentes_sentinelia a
        INNER JOIN tenants t ON t.id = a.tenant_id
        INNER JOIN empresas e ON e.id = a.empresa_id
        INNER JOIN sitios s ON s.id = a.sitio_id
        ${where}
      `,
      parametros
    );
    const totalFiltrado = Number(conteoFiltrado?.total || 0);
    const totalPaginas = Math.max(
      1,
      Math.ceil(totalFiltrado / tamanoPaginaNormalizado)
    );
    const paginaNormalizada = Math.min(paginaSolicitada, totalPaginas);
    const offset = (paginaNormalizada - 1) * tamanoPaginaNormalizado;
    const filas = await this.clienteSql.consultar(
      `
        SELECT
          ${this.columnasSeleccionAgente('a')},
          t.nombre AS tenant_nombre,
          e.nombre AS empresa_nombre,
          s.nombre AS sitio_nombre
        FROM agentes_sentinelia a
        INNER JOIN tenants t ON t.id = a.tenant_id
        INNER JOIN empresas e ON e.id = a.empresa_id
        INNER JOIN sitios s ON s.id = a.sitio_id
        ${where}
        ${orderBy}
        LIMIT ? OFFSET ?
      `,
      [
        ...parametros,
        tamanoPaginaNormalizado,
        offset
      ]
    );

    return {
      agentes: filas.map((fila) => crearAgenteSentineliaDesdeFila(fila)),
      resumen: {
        totalAgentesVisibles: Number(conteoVisible?.total || 0),
        totalAgentesFiltrados: totalFiltrado,
        activos: Number(conteoFiltrado?.activos || 0),
        deshabilitados: Number(conteoFiltrado?.deshabilitados || 0),
        enCuarentena: Number(conteoFiltrado?.en_cuarentena || 0),
        vivos: Number(conteoFiltrado?.vivos || 0),
        silenciosos: Number(conteoFiltrado?.silenciosos || 0),
        nuncaConectados: Number(conteoFiltrado?.nunca_conectados || 0)
      },
      paginacion: {
        pagina: paginaNormalizada,
        tamanoPagina: tamanoPaginaNormalizado,
        totalFiltrado,
        totalSinFiltrar: Number(conteoVisible?.total || 0),
        totalPaginas
      }
    };
  }

  async buscarPorId(idAgente) {
    const filas = await this.clienteSql.consultar(
      `
        SELECT
          ${this.columnasSeleccionAgente('a')},
          t.nombre AS tenant_nombre,
          e.nombre AS empresa_nombre,
          s.nombre AS sitio_nombre
        FROM agentes_sentinelia a
        INNER JOIN tenants t ON t.id = a.tenant_id
        INNER JOIN empresas e ON e.id = a.empresa_id
        INNER JOIN sitios s ON s.id = a.sitio_id
        WHERE a.id = ?
        LIMIT 1
      `,
      [idAgente]
    );

    return filas.length > 0 ? crearAgenteSentineliaDesdeFila(filas[0]) : null;
  }

  async buscarPorGuid(guid) {
    const guidNormalizado = this.validador.normalizarGuid(guid);
    const filas = await this.clienteSql.consultar(
      `
        SELECT
          ${this.columnasSeleccionAgente('a')},
          t.nombre AS tenant_nombre,
          e.nombre AS empresa_nombre,
          s.nombre AS sitio_nombre
        FROM agentes_sentinelia a
        INNER JOIN tenants t ON t.id = a.tenant_id
        INNER JOIN empresas e ON e.id = a.empresa_id
        INNER JOIN sitios s ON s.id = a.sitio_id
        WHERE a.guid = ?
        LIMIT 1
      `,
      [guidNormalizado]
    );

    return filas.length > 0 ? crearAgenteSentineliaDesdeFila(filas[0]) : null;
  }

  async buscarCredencialesPorGuid(guid) {
    const guidNormalizado = this.validador.normalizarGuid(guid);
    const filas = await this.clienteSql.consultar(
      `
        SELECT
          a.id,
          a.guid,
          a.tenant_id,
          a.empresa_id,
          a.sitio_id,
          a.secreto_hash,
          a.version_secreto,
          a.version_scope_agente,
          a.version_autorizacion_agente,
          a.estado_administrativo,
          a.estado_acceso,
          a.cuarentena_hasta_utc,
          a.contador_login_fallidos,
          a.ultimo_boot_id,
          a.ultima_version_agente,
          a.ultimo_hostname,
          a.ultima_sesion_id_diagnostico,
          a.ultima_sesion_huella_sha256,
          a.sesion_auditoria_id
        FROM agentes_sentinelia a
        WHERE a.guid = ?
        LIMIT 1
      `,
      [guidNormalizado]
    );

    if (filas.length === 0) {
      return null;
    }

    const fila = filas[0];

    return {
      id: fila.id,
      guid: fila.guid,
      tenantId: fila.tenant_id,
      empresaId: fila.empresa_id,
      sitioId: fila.sitio_id,
      secretoHash: fila.secreto_hash,
      versionSecreto: fila.version_secreto,
      versionScopeAgente: String(fila.version_scope_agente),
      versionAutorizacionAgente: String(fila.version_autorizacion_agente),
      estadoAdministrativo: fila.estado_administrativo,
      estadoAcceso: fila.estado_acceso,
      cuarentenaHastaUtc: fila.cuarentena_hasta_utc,
      contadorLoginFallidos: fila.contador_login_fallidos,
      ultimoBootId: fila.ultimo_boot_id,
      ultimaVersionAgente: fila.ultima_version_agente,
      ultimoHostname: fila.ultimo_hostname,
      ultimaSesionIdDiagnostico: fila.ultima_sesion_id_diagnostico,
      ultimaSesionHuellaSha256: fila.ultima_sesion_huella_sha256,
      sesionAuditoriaId: fila.sesion_auditoria_id
        ? bytesAUuidV7Auditoria(fila.sesion_auditoria_id, 'sesionAuditoriaId')
        : null
    };
  }

  async crear(datos) {
    return this.crearEnTransaccion(datos);
  }

  async crearEnTransaccion(datos, { conexion = null } = {}) {
    const normalizado = this.validador.normalizarDefinicionBase(datos);
    const [resultado] = await ejecutarSql(this.clienteSql, conexion,
      `
        INSERT INTO agentes_sentinelia (
          guid,
          tenant_id,
          empresa_id,
          sitio_id,
          nombre,
          descripcion,
          secreto_hash,
          estado_administrativo,
          estado_acceso,
          cuarentena_hasta_utc
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        normalizado.guid,
        normalizado.tenantId,
        normalizado.empresaId,
        normalizado.sitioId,
        normalizado.nombre,
        normalizado.descripcion,
        normalizado.secretoHash,
        normalizado.estadoAdministrativo,
        normalizado.estadoAcceso,
        normalizado.cuarentenaHastaUtc
      ]
    );

    return this.buscarPorIdConConexion(resultado.insertId, { conexion });
  }

  async actualizarMetadatos({ idAgente, nombre, descripcion = '' }) {
    return this.actualizarMetadatosEnTransaccion({
      idAgente,
      nombre,
      descripcion
    });
  }

  async actualizarMetadatosEnTransaccion(
    { idAgente, nombre, descripcion = '' },
    { conexion = null } = {}
  ) {
    await ejecutarSql(this.clienteSql, conexion,
      `
        UPDATE agentes_sentinelia
        SET
          nombre = ?,
          descripcion = ?
        WHERE id = ?
      `,
      [
        this.validador.normalizarNombre(nombre),
        this.validador.normalizarDescripcion(descripcion),
        idAgente
      ]
    );

    return this.buscarPorIdConConexion(idAgente, { conexion });
  }

  async actualizarPertenencia({
    idAgente,
    tenantId,
    empresaId,
    sitioId
  }) {
    return this.actualizarPertenenciaEnTransaccion({
      idAgente,
      tenantId,
      empresaId,
      sitioId
    });
  }

  async actualizarPertenenciaEnTransaccion({
    idAgente,
    tenantId,
    empresaId,
    sitioId
  }, { conexion = null } = {}) {
    await ejecutarSql(this.clienteSql, conexion,
      `
        UPDATE agentes_sentinelia
        SET
          tenant_id = ?,
          empresa_id = ?,
          sitio_id = ?,
          version_scope_agente = version_scope_agente + 1
        WHERE id = ?
          AND NOT (
            tenant_id <=> ?
            AND empresa_id <=> ?
            AND sitio_id <=> ?
          )
      `,
      (() => {
        const tenant = this.validador.normalizarId(
          tenantId,
          'El tenant del agente es obligatorio.'
        );
        const empresa = this.validador.normalizarId(
          empresaId,
          'La empresa del agente es obligatoria.'
        );
        const sitio = this.validador.normalizarId(
          sitioId,
          'El sitio del agente es obligatorio.'
        );
        return [
          tenant,
          empresa,
          sitio,
          idAgente,
          tenant,
          empresa,
          sitio
        ];
      })()
    );

    return this.buscarPorIdConConexion(idAgente, { conexion });
  }

  async buscarPorIdConConexion(idAgente, { conexion = null } = {}) {
    if (!conexion) return this.buscarPorId(idAgente);
    const [filas] = await conexion.execute(
      `
        SELECT
          ${this.columnasSeleccionAgente('a')},
          t.nombre AS tenant_nombre,
          e.nombre AS empresa_nombre,
          s.nombre AS sitio_nombre
        FROM agentes_sentinelia a
        INNER JOIN tenants t ON t.id = a.tenant_id
        INNER JOIN empresas e ON e.id = a.empresa_id
        INNER JOIN sitios s ON s.id = a.sitio_id
        WHERE a.id = ?
        LIMIT 1
      `,
      [
        idAgente
      ]
    );

    return filas.length > 0 ? crearAgenteSentineliaDesdeFila(filas[0]) : null;
  }

  async actualizarEstadoAdministrativo({
    idAgente,
    estadoAdministrativo
  }) {
    return (await this.actualizarEstadoAdministrativoEnTransaccion({
      idAgente,
      estadoAdministrativo
    })).agente;
  }

  async actualizarEstadoAdministrativoEnTransaccion({
    idAgente,
    estadoAdministrativo
  }, { conexion = null } = {}) {
    const estadoNormalizado =
      this.validador.normalizarEstadoAdministrativo(estadoAdministrativo);
    const [[antes]] = conexion
      ? await conexion.execute(
        'SELECT estado_administrativo FROM agentes_sentinelia WHERE id = ? FOR UPDATE',
        [idAgente]
      )
      : [await this.clienteSql.consultar(
        'SELECT estado_administrativo FROM agentes_sentinelia WHERE id = ?',
        [idAgente]
      )];

    await ejecutarSql(
      this.clienteSql,
      conexion,
      `
        UPDATE agentes_sentinelia
        SET estado_administrativo = ?
        WHERE id = ?
      `,
      [estadoNormalizado, idAgente]
    );

    const agente = await this.buscarPorIdConConexion(idAgente, { conexion });
    return Object.freeze({
      agente,
      cambioEfectivo: antes?.estado_administrativo !== agente?.estadoAdministrativo,
      estadoAntes: antes?.estado_administrativo || null,
      estadoDespues: agente?.estadoAdministrativo || null
    });
  }

  async rotarSecreto({ idAgente, secretoHash }) {
    return (await this.rotarSecretoEnTransaccion({
      idAgente,
      secretoHash
    })).agente;
  }

  async rotarSecretoEnTransaccion({ idAgente, secretoHash }, { conexion = null } = {}) {
    await ejecutarSql(
      this.clienteSql,
      conexion,
      `
        UPDATE agentes_sentinelia
        SET
          secreto_hash = ?,
          version_secreto = version_secreto + 1
        WHERE id = ?
      `,
      [
        this.validador.normalizarSecretoHash(secretoHash),
        idAgente
      ]
    );

    const agente = await this.buscarPorIdConConexion(idAgente, { conexion });
    return Object.freeze({
      agente,
      cambioEfectivo: true
    });
  }

  async actualizarSnapshotLoginExitoso({
    idAgente,
    sesionAuditoriaId = null,
    sesionIdDiagnostico = null,
    sesionHuellaSha256 = null,
    bootId = null,
    versionAgente = null,
    hostname = null
  }, { conexion = null } = {}) {
    await ejecutarSql(this.clienteSql, conexion,
      `
        UPDATE agentes_sentinelia
        SET
          ultimo_login_utc = UTC_TIMESTAMP(),
          contador_login_fallidos = 0,
          estado_acceso = 'normal',
          cuarentena_hasta_utc = NULL,
          ultimo_heartbeat_utc = NULL,
          ultimo_boot_id = ?,
          ultima_version_agente = ?,
          ultimo_hostname = ?,
          ultimo_seq = NULL,
          sesion_auditoria_id = ?,
          ultima_sesion_id_diagnostico = ?,
          ultima_sesion_huella_sha256 = ?
        WHERE id = ?
      `,
      [
        this.normalizarTextoOpcional(bootId, 120),
        this.normalizarTextoOpcional(versionAgente, 80),
        this.normalizarTextoOpcional(hostname, 255),
        this.normalizarSesionAuditoriaIdOpcional(sesionAuditoriaId),
        this.normalizarTextoOpcional(sesionIdDiagnostico, 80),
        this.normalizarSha256Opcional(sesionHuellaSha256),
        idAgente
      ]
    );

    return this.buscarPorIdConConexion(idAgente, { conexion });
  }

  async actualizarSnapshotRefreshSesion({
    idAgente,
    sesionAuditoriaId = null,
    sesionIdDiagnostico = null,
    sesionHuellaSha256 = null
  }, { conexion = null } = {}) {
    await ejecutarSql(this.clienteSql, conexion,
      `
        UPDATE agentes_sentinelia
        SET
          sesion_auditoria_id = ?,
          ultima_sesion_id_diagnostico = ?,
          ultima_sesion_huella_sha256 = ?
        WHERE id = ?
      `,
      [
        this.normalizarSesionAuditoriaIdOpcional(sesionAuditoriaId),
        this.normalizarTextoOpcional(sesionIdDiagnostico, 80),
        this.normalizarSha256Opcional(sesionHuellaSha256),
        idAgente
      ]
    );

    return this.buscarPorIdConConexion(idAgente, { conexion });
  }

  async registrarLoginFallido({
    idAgente,
    loginFallosMaximos = 5,
    cuarentenaSegundos = 900
  }) {
    return (await this.registrarLoginFallidoEnTransaccion({
      idAgente,
      loginFallosMaximos,
      cuarentenaSegundos
    })).agente;
  }

  async registrarLoginFallidoEnTransaccion({
    idAgente,
    loginFallosMaximos = 5,
    cuarentenaSegundos = 900
  }, { conexion = null } = {}) {
    const umbral = this.normalizarEnteroMinimo(loginFallosMaximos, 1, 5);
    const cuarentena = this.normalizarEnteroMinimo(
      cuarentenaSegundos,
      1,
      900
    );
    const [[antes]] = conexion
      ? await conexion.execute(
        `SELECT estado_acceso, contador_login_fallidos
           FROM agentes_sentinelia WHERE id = ? FOR UPDATE`,
        [idAgente]
      )
      : [await this.clienteSql.consultar(
        `SELECT estado_acceso, contador_login_fallidos
           FROM agentes_sentinelia WHERE id = ?`,
        [idAgente]
      )];

    await ejecutarSql(
      this.clienteSql,
      conexion,
      `
        UPDATE agentes_sentinelia
        SET
          ultimo_login_fallido_utc = UTC_TIMESTAMP(),
          estado_acceso = CASE
            WHEN contador_login_fallidos + 1 >= ? THEN 'cuarentena'
            ELSE estado_acceso
          END,
          cuarentena_hasta_utc = CASE
            WHEN contador_login_fallidos + 1 >= ?
              THEN DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? SECOND)
            ELSE cuarentena_hasta_utc
          END,
          contador_login_fallidos = contador_login_fallidos + 1
        WHERE id = ?
      `,
      [umbral, umbral, cuarentena, idAgente]
    );

    const agente = await this.buscarPorIdConConexion(idAgente, { conexion });
    const estadoAntes = antes?.estado_acceso || null;
    const estadoDespues = agente?.estadoAcceso || null;

    return Object.freeze({
      agente,
      cuarentenaActivada:
        estadoAntes === 'normal' && estadoDespues === 'cuarentena',
      estadoAntes,
      estadoDespues,
      contadorLoginFallidosAntes: Number(antes?.contador_login_fallidos || 0),
      contadorLoginFallidosDespues: Number(agente?.contadorLoginFallidos || 0)
    });
  }

  async liberarCuarentenaExpirada(idAgente) {
    return (await this.liberarCuarentenaExpiradaEnTransaccion(idAgente)).liberada;
  }

  async liberarCuarentenaExpiradaEnTransaccion(idAgente, { conexion = null } = {}) {
    const [[antes]] = conexion
      ? await conexion.execute(
        `SELECT estado_acceso, cuarentena_hasta_utc
           FROM agentes_sentinelia WHERE id = ? FOR UPDATE`,
        [idAgente]
      )
      : [await this.clienteSql.consultar(
        `SELECT estado_acceso, cuarentena_hasta_utc
           FROM agentes_sentinelia WHERE id = ?`,
        [idAgente]
      )];
    const [resultado] = await ejecutarSql(
      this.clienteSql,
      conexion,
      `
        UPDATE agentes_sentinelia
        SET
          estado_acceso = 'normal',
          cuarentena_hasta_utc = NULL,
          contador_login_fallidos = 0
        WHERE id = ?
          AND estado_acceso = 'cuarentena'
          AND cuarentena_hasta_utc IS NOT NULL
          AND cuarentena_hasta_utc <= UTC_TIMESTAMP()
      `,
      [idAgente]
    );

    const liberada = Number(resultado.affectedRows || 0) > 0;
    const agente = liberada
      ? await this.buscarPorIdConConexion(idAgente, { conexion })
      : null;

    return Object.freeze({
      liberada,
      agente,
      estadoAntes: antes?.estado_acceso || null,
      estadoDespues: agente?.estadoAcceso || antes?.estado_acceso || null,
      cuarentenaHastaUtcAntes: antes?.cuarentena_hasta_utc || null
    });
  }

  async actualizarSnapshotHeartbeat({
    idAgente,
    bootId = null,
    versionAgente = null,
    hostname = null,
    seq = null
  }, { conexion = null } = {}) {
    await ejecutarSql(this.clienteSql, conexion,
      `
        UPDATE agentes_sentinelia
        SET
          ultimo_heartbeat_utc = UTC_TIMESTAMP(),
          ultimo_boot_id = ?,
          ultima_version_agente = ?,
          ultimo_hostname = ?,
          ultimo_seq = ?
        WHERE id = ?
      `,
      [
        this.normalizarTextoOpcional(bootId, 120),
        this.normalizarTextoOpcional(versionAgente, 80),
        this.normalizarTextoOpcional(hostname, 255),
        this.normalizarEnteroOpcional(seq),
        idAgente
      ]
    );

    return this.buscarPorIdConConexion(idAgente, { conexion });
  }

  async abrirPeriodoVidaPol({
    agenteId,
    sesionAuditoriaId = null,
    sesionIdDiagnostico = null,
    sesionHuellaSha256 = null,
    bootId = null,
    inicioUtc = null
  }, { conexion = null } = {}) {
    const [resultado] = await ejecutarSql(this.clienteSql, conexion,
      `
        INSERT INTO periodos_vida_pol_agentes (
          agente_id,
          sesion_id_diagnostico,
          sesion_huella_sha256,
          sesion_auditoria_id,
          boot_id,
          inicio_utc
        ) VALUES (?, ?, ?, ?, ?, COALESCE(?, UTC_TIMESTAMP()))
      `,
      [
        agenteId,
        this.normalizarTextoOpcional(sesionIdDiagnostico, 80),
        this.normalizarSha256Opcional(sesionHuellaSha256),
        this.normalizarSesionAuditoriaIdOpcional(sesionAuditoriaId),
        this.normalizarTextoOpcional(bootId, 120),
        inicioUtc
      ]
    );

    return this.buscarPeriodoVidaPolPorId(resultado.insertId, { conexion });
  }

  async buscarPeriodoVidaPolPorId(idPeriodo, { conexion = null } = {}) {
    const filas = await consultarSql(this.clienteSql, conexion,
      `
        SELECT ${this.columnasSeleccionPeriodoVidaPol('p')}
        FROM periodos_vida_pol_agentes p
        WHERE p.id = ?
        LIMIT 1
      `,
      [idPeriodo]
    );

    return filas.length > 0
      ? crearPeriodoVidaPolAgenteDesdeFila(filas[0])
      : null;
  }

  async buscarPeriodoVidaPolAbierto(agenteId, { conexion = null } = {}) {
    const filas = await consultarSql(this.clienteSql, conexion,
      `
        SELECT ${this.columnasSeleccionPeriodoVidaPol('p')}
        FROM periodos_vida_pol_agentes p
        WHERE p.agente_id = ?
          AND p.fin_utc IS NULL
        ORDER BY p.inicio_utc DESC, p.id DESC
        LIMIT 1
      `,
      [agenteId]
    );

    return filas.length > 0
      ? crearPeriodoVidaPolAgenteDesdeFila(filas[0])
      : null;
  }

  async listarPeriodosVidaPolPorAgenteYRango({
    agenteId,
    desdeUtc = null,
    hastaUtc = null,
    limite = 200
  }) {
    const condiciones = ['p.agente_id = ?'];
    const parametros = [agenteId];
    const limiteNormalizado = this.normalizarEnteroMinimo(limite, 1, 200);
    const desdeSql = this.normalizarFechaSqlOpcional(desdeUtc);
    const hastaSql = this.normalizarFechaSqlOpcional(hastaUtc);

    if (desdeSql) {
      condiciones.push('(p.fin_utc IS NULL OR p.fin_utc >= ?)');
      parametros.push(desdeSql);
    }

    if (hastaSql) {
      condiciones.push('p.inicio_utc <= ?');
      parametros.push(hastaSql);
    }

    const filas = await this.clienteSql.consultar(
      `
        SELECT ${this.columnasSeleccionPeriodoVidaPol('p')}
        FROM periodos_vida_pol_agentes p
        WHERE ${condiciones.join(' AND ')}
        ORDER BY p.inicio_utc ASC, p.id ASC
        LIMIT ?
      `,
      [...parametros, Math.min(limiteNormalizado, 500)]
    );

    return filas.map((fila) => crearPeriodoVidaPolAgenteDesdeFila(fila));
  }

  async incrementarHeartbeatPeriodoAbierto({ agenteId, seq = null }) {
    return Boolean(
      await this.registrarHeartbeatPeriodoAbierto({ agenteId, seq })
    );
  }

  async registrarHeartbeatPeriodoAbierto({
    agenteId,
    sesionIdDiagnostico = null,
    seq = null,
    recibidoEnUtc = null
  }, { conexion = null } = {}) {
    const seqNormalizado = this.normalizarEnteroOpcional(seq);
    const sesionNormalizada = this.normalizarTextoOpcional(
      sesionIdDiagnostico,
      80
    );
    const [resultado] = await ejecutarSql(this.clienteSql, conexion,
      `
        UPDATE periodos_vida_pol_agentes
        SET
          heartbeats_recibidos = heartbeats_recibidos + 1,
          ultimo_heartbeat_utc = COALESCE(?, UTC_TIMESTAMP()),
          ultimo_seq = ?
        WHERE agente_id = ?
          AND fin_utc IS NULL
          AND (? IS NULL OR sesion_id_diagnostico = ?)
          AND (ultimo_seq IS NULL OR ultimo_seq < ?)
        ORDER BY inicio_utc DESC, id DESC
        LIMIT 1
      `,
      [
        this.normalizarFechaSqlOpcional(recibidoEnUtc),
        seqNormalizado,
        agenteId,
        sesionNormalizada,
        sesionNormalizada,
        seqNormalizado
      ]
    );

    return resultado.affectedRows > 0
      ? this.buscarPeriodoVidaPolAbierto(agenteId, { conexion })
      : null;
  }

  async actualizarSesionPeriodoVidaPolAbiertoSiCoincide({
    agenteId,
    sesionIdActual,
    sesionHuellaActual = null,
    sesionIdNueva,
    sesionHuellaNueva
  }, { conexion = null } = {}) {
    const sesionActualNormalizada = this.normalizarTextoOpcional(
      sesionIdActual,
      80
    );
    const sesionNuevaNormalizada = this.normalizarTextoOpcional(
      sesionIdNueva,
      80
    );

    if (!sesionActualNormalizada || !sesionNuevaNormalizada) {
      return null;
    }

    const huellaActualNormalizada =
      this.normalizarSha256Opcional(sesionHuellaActual);
    const huellaNuevaNormalizada =
      this.normalizarSha256Opcional(sesionHuellaNueva);

    if (!huellaNuevaNormalizada) {
      return null;
    }

    const [resultado] = await ejecutarSql(this.clienteSql, conexion,
      `
        UPDATE periodos_vida_pol_agentes
        SET
          sesion_id_diagnostico = ?,
          sesion_huella_sha256 = ?
        WHERE agente_id = ?
          AND sesion_id_diagnostico = ?
          AND (? IS NULL OR sesion_huella_sha256 = ?)
          AND fin_utc IS NULL
        ORDER BY inicio_utc DESC, id DESC
        LIMIT 1
      `,
      [
        sesionNuevaNormalizada,
        huellaNuevaNormalizada,
        agenteId,
        sesionActualNormalizada,
        huellaActualNormalizada,
        huellaActualNormalizada
      ]
    );

    return resultado.affectedRows > 0
      ? this.buscarPeriodoVidaPolAbierto(agenteId, { conexion })
      : null;
  }

  async cerrarPeriodoVidaPolAbierto({
    agenteId,
    motivoCierre,
    finUtc = null
  }, { conexion = null } = {}) {
    const [resultado] = await ejecutarSql(this.clienteSql, conexion,
      `
        UPDATE periodos_vida_pol_agentes
        SET
          fin_utc = COALESCE(?, UTC_TIMESTAMP()),
          motivo_cierre = ?
        WHERE agente_id = ?
          AND fin_utc IS NULL
        ORDER BY inicio_utc DESC, id DESC
        LIMIT 1
      `,
      [
        finUtc,
        this.normalizarTextoOpcional(motivoCierre, 64) || 'cierre_operativo',
        agenteId
      ]
    );

    return resultado.affectedRows > 0;
  }

  async cerrarPeriodoVidaPolAbiertoSiCoincide({
    agenteId,
    sesionIdDiagnostico,
    sesionHuellaSha256 = null,
    motivoCierre,
    finUtc = null
  }, { conexion = null } = {}) {
    const sesionNormalizada = this.normalizarTextoOpcional(
      sesionIdDiagnostico,
      80
    );

    if (!sesionNormalizada) {
      return false;
    }

    const huellaNormalizada = this.normalizarSha256Opcional(sesionHuellaSha256);
    const [resultado] = await ejecutarSql(this.clienteSql, conexion,
      `
        UPDATE periodos_vida_pol_agentes
        SET
          fin_utc = COALESCE(?, UTC_TIMESTAMP()),
          motivo_cierre = ?
        WHERE agente_id = ?
          AND sesion_id_diagnostico = ?
          AND (? IS NULL OR sesion_huella_sha256 = ?)
          AND fin_utc IS NULL
        ORDER BY inicio_utc DESC, id DESC
        LIMIT 1
      `,
      [
        finUtc,
        this.normalizarTextoOpcional(motivoCierre, 64) || 'cierre_operativo',
        agenteId,
        sesionNormalizada,
        huellaNormalizada,
        huellaNormalizada
      ]
    );

    return resultado.affectedRows > 0;
  }

  columnasSeleccionAgente(alias) {
    return `
      ${alias}.id,
      ${alias}.guid,
      ${alias}.tenant_id,
      ${alias}.empresa_id,
      ${alias}.sitio_id,
      ${alias}.nombre,
      ${alias}.descripcion,
      ${alias}.version_secreto,
      ${alias}.version_scope_agente,
      ${alias}.version_autorizacion_agente,
      ${alias}.estado_administrativo,
      ${alias}.estado_acceso,
      ${alias}.cuarentena_hasta_utc,
      ${alias}.contador_login_fallidos,
      ${alias}.ultimo_login_utc,
      ${alias}.ultimo_login_fallido_utc,
      ${alias}.ultimo_heartbeat_utc,
      ${alias}.ultimo_boot_id,
      ${alias}.ultima_version_agente,
      ${alias}.ultimo_hostname,
      ${alias}.ultimo_seq,
      ${alias}.ultima_sesion_id_diagnostico,
      ${alias}.ultima_sesion_huella_sha256,
      ${alias}.sesion_auditoria_id,
      ${alias}.fecha_creacion,
      ${alias}.fecha_actualizacion
    `;
  }

  columnasSeleccionPeriodoVidaPol(alias) {
    return `
      ${alias}.id,
      ${alias}.agente_id,
      ${alias}.sesion_id_diagnostico,
      ${alias}.sesion_huella_sha256,
      ${alias}.sesion_auditoria_id,
      ${alias}.boot_id,
      ${alias}.inicio_utc,
      ${alias}.fin_utc,
      ${alias}.heartbeats_recibidos,
      ${alias}.ultimo_heartbeat_utc,
      ${alias}.ultimo_seq,
      ${alias}.motivo_cierre,
      ${alias}.fecha_creacion,
      ${alias}.fecha_actualizacion
    `;
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
        condiciones: ['a.tenant_id = ?'],
        parametros: [contextoUsuarioActual.tenantId]
      };
    }

    if (contextoUsuarioActual?.nivelScope === 'empresa') {
      return {
        condiciones: ['a.empresa_id = ?'],
        parametros: [contextoUsuarioActual.empresaId]
      };
    }

    if (contextoUsuarioActual?.nivelScope === 'sitio') {
      return {
        condiciones: ['a.sitio_id = ?'],
        parametros: [contextoUsuarioActual.sitioId]
      };
    }

    return {
      condiciones: ['1 = 0'],
      parametros: []
    };
  }

  construirFiltroListadoAgentes({
    textoBusqueda = '',
    tenantId = null,
    empresaId = null,
    sitioId = null,
    estadoAdministrativo = '',
    estadoAcceso = '',
    estadoVidaPol = '',
    focoOperativo = 'todos',
    silencioPolSegundos = 120
  } = {}) {
    const condiciones = [];
    const parametros = [];
    const busqueda = this.normalizarTextoOpcional(textoBusqueda, 120);
    const tenantNormalizado = this.normalizarEnteroOpcional(tenantId);
    const empresaNormalizada = this.normalizarEnteroOpcional(empresaId);
    const sitioNormalizado = this.normalizarEnteroOpcional(sitioId);
    const estadoAdminNormalizado = this.normalizarTextoOpcional(
      estadoAdministrativo,
      24
    );
    const estadoAccesoNormalizado = this.normalizarTextoOpcional(
      estadoAcceso,
      24
    );
    const estadoVidaNormalizado = this.normalizarTextoOpcional(
      estadoVidaPol,
      64
    );
    const focoNormalizado =
      this.normalizarTextoOpcional(focoOperativo, 64) || 'todos';

    if (busqueda) {
      const like = `%${busqueda}%`;
      condiciones.push(`(
        a.nombre LIKE ?
        OR a.guid LIKE ?
        OR a.descripcion LIKE ?
        OR t.nombre LIKE ?
        OR e.nombre LIKE ?
        OR s.nombre LIKE ?
        OR a.ultimo_hostname LIKE ?
        OR a.ultimo_boot_id LIKE ?
        OR a.ultima_sesion_id_diagnostico LIKE ?
      )`);
      parametros.push(like, like, like, like, like, like, like, like, like);
    }

    if (tenantNormalizado) {
      condiciones.push('a.tenant_id = ?');
      parametros.push(tenantNormalizado);
    }

    if (empresaNormalizada) {
      condiciones.push('a.empresa_id = ?');
      parametros.push(empresaNormalizada);
    }

    if (sitioNormalizado) {
      condiciones.push('a.sitio_id = ?');
      parametros.push(sitioNormalizado);
    }

    if (['activo', 'deshabilitado'].includes(estadoAdminNormalizado)) {
      condiciones.push('a.estado_administrativo = ?');
      parametros.push(estadoAdminNormalizado);
    }

    if (['normal', 'cuarentena'].includes(estadoAccesoNormalizado)) {
      condiciones.push('a.estado_acceso = ?');
      parametros.push(estadoAccesoNormalizado);
    }

    if (estadoVidaNormalizado) {
      condiciones.push(
        this.expresionEstadoVidaPolSql(
          estadoVidaNormalizado,
          silencioPolSegundos
        )
      );
    }

    if (focoNormalizado === 'cuarentena') {
      condiciones.push('a.estado_acceso = ?');
      parametros.push('cuarentena');
    }

    if (focoNormalizado === 'sin_heartbeat') {
      condiciones.push(`(
        ${this.expresionEstadoVidaPolSql('silencioso', silencioPolSegundos)}
        OR ${this.expresionEstadoVidaPolSql('nunca_conectado', silencioPolSegundos)}
      )`);
    }

    return { condiciones, parametros };
  }

  expresionEstadoVidaPolSql(estadoVidaPol, silencioPolSegundos = 120) {
    const silencio = this.normalizarEnteroMinimo(silencioPolSegundos, 0, 120);
    const ultimaActividad = `
      GREATEST(
        COALESCE(a.ultimo_heartbeat_utc, '1000-01-01 00:00:00'),
        COALESCE(a.ultimo_login_utc, '1000-01-01 00:00:00')
      )
    `;

    switch (estadoVidaPol) {
      case 'nunca_conectado':
        return '(a.ultimo_heartbeat_utc IS NULL AND a.ultimo_login_utc IS NULL)';
      case 'vivo':
        return `(
          (a.ultimo_heartbeat_utc IS NOT NULL OR a.ultimo_login_utc IS NOT NULL)
          AND TIMESTAMPDIFF(SECOND, ${ultimaActividad}, UTC_TIMESTAMP()) < ${silencio}
        )`;
      case 'silencioso':
        return `(
          (a.ultimo_heartbeat_utc IS NOT NULL OR a.ultimo_login_utc IS NOT NULL)
          AND TIMESTAMPDIFF(SECOND, ${ultimaActividad}, UTC_TIMESTAMP()) >= ${silencio}
        )`;
      case 'inconsistente_relogin_requerido':
        return '1 = 0';
      default:
        return '1 = 1';
    }
  }

  construirOrdenListadoAgentes(ordenarPor, direccionOrden) {
    const direccion = String(direccionOrden || '').toLowerCase() === 'desc'
      ? 'DESC'
      : 'ASC';
    const ordenes = {
      nombre: 'a.nombre',
      sitio: 's.nombre',
      empresa: 'e.nombre',
      tenant: 't.nombre',
      estado: 'a.estado_administrativo',
      acceso: 'a.estado_acceso',
      login: 'a.ultimo_login_utc',
      heartbeat: 'a.ultimo_heartbeat_utc',
      creado: 'a.fecha_creacion',
      actualizado: 'a.fecha_actualizacion'
    };
    const columna = ordenes[String(ordenarPor || '').trim()] || ordenes.nombre;

    return `ORDER BY ${columna} ${direccion}, a.id ${direccion}`;
  }

  normalizarTextoOpcional(valor, longitudMaxima) {
    const normalizado = String(valor || '').trim();

    if (!normalizado) {
      return null;
    }

    return normalizado.slice(0, longitudMaxima);
  }

  normalizarSha256Opcional(valor) {
    const normalizado = String(valor || '').trim().toLowerCase();

    if (!normalizado) {
      return null;
    }

    if (!/^[0-9a-f]{64}$/.test(normalizado)) {
      throw new Error('La huella SHA-256 de sesión del agente no es válida.');
    }

    return normalizado;
  }

  normalizarSesionAuditoriaIdOpcional(valor) {
    return valor == null
      ? null
      : uuidV7AuditoriaABytes(valor, 'sesionAuditoriaId');
  }

  normalizarEnteroOpcional(valor) {
    if (valor == null || String(valor).trim() === '') {
      return null;
    }

    const convertido = Number.parseInt(String(valor), 10);

    if (!Number.isInteger(convertido) || convertido < 0) {
      throw new Error('El valor numérico del agente no es válido.');
    }

    return convertido;
  }

  normalizarEnteroMinimo(valor, minimo, porDefecto) {
    const convertido = Number.parseInt(String(valor ?? ''), 10);

    if (!Number.isInteger(convertido) || convertido < minimo) {
      return porDefecto;
    }

    return convertido;
  }

  normalizarFechaSqlOpcional(valor) {
    if (!valor) {
      return null;
    }

    const fecha = valor instanceof Date ? valor : new Date(valor);

    if (Number.isNaN(fecha.getTime())) {
      return null;
    }

    return fecha.toISOString().slice(0, 19).replace('T', ' ');
  }
}

function ejecutarSql(clienteSql, conexion, sql, parametros) {
  return conexion
    ? conexion.execute(sql, parametros)
    : clienteSql.ejecutar(sql, parametros);
}

async function consultarSql(clienteSql, conexion, sql, parametros) {
  if (!conexion) return clienteSql.consultar(sql, parametros);
  const [filas] = await conexion.execute(sql, parametros);
  return filas;
}
