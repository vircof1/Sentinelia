import {
  bytesAUuidV7Auditoria,
  uuidV7AuditoriaABytes
} from '../../auditoria/src/UuidV7Auditoria.js';

export class TransicionSesionWebNoPermitida extends Error {
  constructor(mensaje) {
    super(mensaje);
    this.name = 'TransicionSesionWebNoPermitida';
    this.codigo = 'TRANSICION_SESION_WEB_NO_PERMITIDA';
  }
}

export class RepositorioSesionesWebAuditoria {
  constructor(clienteSql) {
    if (!clienteSql?.obtenerConexion) {
      throw new Error('El registro de sesiones web requiere un cliente SQL operativo.');
    }
    this.clienteSql = clienteSql;
  }

  async abrirAtomica(datos, opciones = {}) {
    const conexion = await this.clienteSql.obtenerConexion();
    try {
      await conexion.beginTransaction();
      const sesion = await this.abrirEnTransaccion(datos, {
        ...opciones,
        conexion
      });
      await conexion.commit();
      return sesion;
    } catch (error) {
      await rollbackSeguro(conexion);
      throw error;
    } finally {
      conexion.release();
    }
  }

  async abrirEnTransaccion(datos = {}, { conexion, ttlSegundos = 28800 } = {}) {
    exigirConexion(conexion);
    const sesionAuditoriaId = uuidV7AuditoriaABytes(
      datos.sesionAuditoriaId,
      'sesionAuditoriaId'
    );
    const usuarioRealId = idDecimal(datos.usuarioRealId, 'usuarioRealId');
    const usuarioEfectivoId = idDecimal(
      datos.usuarioEfectivoId ?? datos.usuarioRealId,
      'usuarioEfectivoId'
    );
    const versionReal = versionSesion(datos.versionSesionReal, 'versionSesionReal');
    const versionEfectiva = versionSesion(
      datos.versionSesionEfectiva ?? datos.versionSesionReal,
      'versionSesionEfectiva'
    );
    const scopeApertura = normalizarScope(datos.scopeApertura, 'scopeApertura');
    const scopeEfectivo = normalizarScope(
      datos.scopeEfectivoActual ?? datos.scopeApertura,
      'scopeEfectivoActual'
    );
    const ttl = enteroAcotado(
      ttlSegundos,
      1,
      2_592_000,
      'El TTL de sesión debe estar entre 1 segundo y 30 días.'
    );
    if (
      usuarioRealId !== usuarioEfectivoId ||
      versionReal !== versionEfectiva ||
      !scopeIgual(scopeApertura, scopeEfectivo)
    ) {
      throw new Error('Una sesión web nueva debe abrirse en actuación directa.');
    }
    try {
      await conexion.execute(
        `
          INSERT INTO sesiones_web_auditoria (
            sesion_auditoria_id,
            usuario_real_id,
            usuario_efectivo_id,
            version_sesion_real,
            version_sesion_efectiva,
            apertura_tenant_id,
            apertura_empresa_id,
            apertura_sitio_id,
            efectivo_tenant_id,
            efectivo_empresa_id,
            efectivo_sitio_id,
            evento_impersonacion_iniciada_id,
            estado,
            expira_en_utc,
            creada_en_utc,
            renovada_en_utc,
            cerrada_en_utc
          ) VALUES (
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'abierta',
            TIMESTAMPADD(SECOND, ?, UTC_TIMESTAMP(3)),
            UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), NULL
          )
        `,
        [
          sesionAuditoriaId,
          usuarioRealId,
          usuarioEfectivoId,
          versionReal,
          versionEfectiva,
          ...parametrosScope(scopeApertura),
          ...parametrosScope(scopeEfectivo),
          ttl
        ]
      );
    } catch (error) {
      if (error?.code === 'ER_DUP_ENTRY') {
        throw new TransicionSesionWebNoPermitida(
          'sesionAuditoriaId ya identifica otro registro durable.'
        );
      }
      throw error;
    }
    return buscarPorIdEnConexion(conexion, datos.sesionAuditoriaId);
  }

  async buscarPorId(sesionAuditoriaId) {
    const filas = await this.clienteSql.consultar(
      `SELECT ${columnasSesion('s')}
       FROM sesiones_web_auditoria s
       WHERE s.sesion_auditoria_id = ?
       LIMIT 1`,
      [uuidV7AuditoriaABytes(sesionAuditoriaId, 'sesionAuditoriaId')]
    );
    return filas[0] ? serializarSesion(filas[0]) : null;
  }

  async buscarVigentePorId(sesionAuditoriaId) {
    const filas = await this.clienteSql.consultar(
      `SELECT ${columnasSesion('s')}
       FROM sesiones_web_auditoria s
       WHERE s.sesion_auditoria_id = ?
         AND s.estado = 'abierta'
         AND s.expira_en_utc > UTC_TIMESTAMP(3)
       LIMIT 1`,
      [uuidV7AuditoriaABytes(sesionAuditoriaId, 'sesionAuditoriaId')]
    );
    return filas[0] ? serializarSesion(filas[0]) : null;
  }

  async bloquearUsuariosExistentes(idsUsuario, { conexion } = {}) {
    exigirConexion(conexion);
    const ids = ordenarIdsUnicos(idsUsuario);
    if (ids.length === 0) return Object.freeze([]);
    const [filas] = await conexion.execute(
      `SELECT CAST(id AS CHAR) AS id
         FROM usuarios
        WHERE id IN (${ids.map(() => '?').join(', ')})
        ORDER BY id ASC
        FOR UPDATE`,
      ids
    );
    const encontrados = filas.map(({ id }) => String(id));
    if (
      encontrados.length !== ids.length ||
      encontrados.some((id, indice) => id !== ids[indice])
    ) {
      throw new TransicionSesionWebNoPermitida(
        'Algún usuario de la sesión ya no existe.'
      );
    }
    return Object.freeze(encontrados);
  }

  async bloquearVigentesPorUsuarios(idsUsuario, { conexion } = {}) {
    exigirConexion(conexion);
    if (!Array.isArray(idsUsuario) || idsUsuario.length === 0) return [];
    const ids = ordenarIdsUnicos(idsUsuario);
    const lugares = ids.map(() => '?').join(', ');
    const [filas] = await conexion.execute(
      `
        SELECT ${columnasSesion('s')}
        FROM sesiones_web_auditoria s
        WHERE s.estado = 'abierta'
          AND s.expira_en_utc > UTC_TIMESTAMP(3)
          AND (
            s.usuario_real_id IN (${lugares})
            OR s.usuario_efectivo_id IN (${lugares})
          )
        ORDER BY s.sesion_auditoria_id
        FOR UPDATE
      `,
      [...ids, ...ids]
    );
    return congelarLista(filas.map(serializarSesion));
  }

  async renovarEnTransaccion(
    sesionAuditoriaId,
    { conexion, ttlSegundos = 28800 } = {}
  ) {
    exigirConexion(conexion);
    const ttl = enteroAcotado(
      ttlSegundos,
      1,
      2_592_000,
      'El TTL de renovación debe estar entre 1 segundo y 30 días.'
    );
    const id = uuidV7AuditoriaABytes(sesionAuditoriaId, 'sesionAuditoriaId');
    const [resultado] = await conexion.execute(
      `
        UPDATE sesiones_web_auditoria
        SET
          renovada_en_utc = UTC_TIMESTAMP(3),
          expira_en_utc = TIMESTAMPADD(SECOND, ?, UTC_TIMESTAMP(3))
        WHERE sesion_auditoria_id = ?
          AND estado = 'abierta'
          AND expira_en_utc > UTC_TIMESTAMP(3)
      `,
      [ttl, id]
    );
    exigirUnaTransicion(resultado, 'La sesión no está abierta y vigente para renovarse.');
    return buscarPorIdEnConexion(conexion, sesionAuditoriaId);
  }

  async iniciarImpersonacionEnTransaccion(datos = {}, { conexion } = {}) {
    exigirConexion(conexion);
    const sesionId = uuidV7AuditoriaABytes(datos.sesionAuditoriaId, 'sesionAuditoriaId');
    const usuarioEfectivoId = idDecimal(datos.usuarioEfectivoId, 'usuarioEfectivoId');
    const versionReal = versionSesion(datos.versionSesionReal, 'versionSesionReal');
    const versionEfectiva = versionSesion(datos.versionSesionEfectiva, 'versionSesionEfectiva');
    const scope = normalizarScope(datos.scopeEfectivoActual, 'scopeEfectivoActual');
    const eventoId = uuidV7AuditoriaABytes(
      datos.eventoImpersonacionIniciadaId,
      'eventoImpersonacionIniciadaId'
    );
    const [resultado] = await conexion.execute(
      `
        UPDATE sesiones_web_auditoria
        SET
          usuario_efectivo_id = ?,
          version_sesion_real = ?,
          version_sesion_efectiva = ?,
          efectivo_tenant_id = ?,
          efectivo_empresa_id = ?,
          efectivo_sitio_id = ?,
          evento_impersonacion_iniciada_id = ?
        WHERE sesion_auditoria_id = ?
          AND estado = 'abierta'
          AND expira_en_utc > UTC_TIMESTAMP(3)
          AND usuario_real_id = usuario_efectivo_id
          AND evento_impersonacion_iniciada_id IS NULL
          AND usuario_real_id <> ?
      `,
      [
        usuarioEfectivoId,
        versionReal,
        versionEfectiva,
        ...parametrosScope(scope),
        eventoId,
        sesionId,
        usuarioEfectivoId
      ]
    );
    exigirUnaTransicion(resultado, 'La sesión no admite iniciar esta impersonación.');
    return buscarPorIdEnConexion(conexion, datos.sesionAuditoriaId);
  }

  async finalizarImpersonacionEnTransaccion(datos = {}, { conexion } = {}) {
    exigirConexion(conexion);
    const sesionId = uuidV7AuditoriaABytes(datos.sesionAuditoriaId, 'sesionAuditoriaId');
    const eventoId = uuidV7AuditoriaABytes(
      datos.eventoImpersonacionIniciadaId,
      'eventoImpersonacionIniciadaId'
    );
    const version = versionSesion(datos.versionSesionReal, 'versionSesionReal');
    const scope = normalizarScope(datos.scopeEfectivoActual, 'scopeEfectivoActual');
    const [resultado] = await conexion.execute(
      `
        UPDATE sesiones_web_auditoria
        SET
          usuario_efectivo_id = usuario_real_id,
          version_sesion_real = ?,
          version_sesion_efectiva = ?,
          efectivo_tenant_id = ?,
          efectivo_empresa_id = ?,
          efectivo_sitio_id = ?,
          evento_impersonacion_iniciada_id = NULL
        WHERE sesion_auditoria_id = ?
          AND estado = 'abierta'
          AND expira_en_utc > UTC_TIMESTAMP(3)
          AND usuario_real_id <> usuario_efectivo_id
          AND evento_impersonacion_iniciada_id = ?
      `,
      [version, version, ...parametrosScope(scope), sesionId, eventoId]
    );
    exigirUnaTransicion(resultado, 'La sesión no admite finalizar esta impersonación.');
    return buscarPorIdEnConexion(conexion, datos.sesionAuditoriaId);
  }

  async transicionarTerminalEnTransaccion(
    sesionAuditoriaId,
    estado,
    { conexion } = {}
  ) {
    exigirConexion(conexion);
    if (!['cerrada', 'invalidada'].includes(estado)) {
      throw new Error('El estado terminal debe ser cerrada o invalidada.');
    }
    const [resultado] = await conexion.execute(
      `
        UPDATE sesiones_web_auditoria
        SET
          estado = ?,
          evento_impersonacion_iniciada_id = NULL,
          cerrada_en_utc = UTC_TIMESTAMP(3)
        WHERE sesion_auditoria_id = ?
          AND estado = 'abierta'
          AND expira_en_utc > UTC_TIMESTAMP(3)
      `,
      [estado, uuidV7AuditoriaABytes(sesionAuditoriaId, 'sesionAuditoriaId')]
    );
    exigirUnaTransicion(resultado, 'La sesión no está abierta y vigente.');
    return buscarPorIdEnConexion(conexion, sesionAuditoriaId);
  }

  async invalidarVigentesPorUsuariosEnTransaccion(
    idsUsuario,
    { conexion } = {}
  ) {
    exigirConexion(conexion);
    const sesiones = await this.bloquearVigentesPorUsuarios(idsUsuario, {
      conexion
    });
    if (sesiones.length === 0) return Object.freeze([]);
    const ids = sesiones.map(({ sesionAuditoriaId }) =>
      uuidV7AuditoriaABytes(sesionAuditoriaId, 'sesionAuditoriaId')
    );
    const [resultado] = await conexion.execute(
      `UPDATE sesiones_web_auditoria
          SET estado = 'invalidada',
              evento_impersonacion_iniciada_id = NULL,
              cerrada_en_utc = UTC_TIMESTAMP(3)
        WHERE sesion_auditoria_id IN (${ids.map(() => '?').join(', ')})
          AND estado = 'abierta'
          AND expira_en_utc > UTC_TIMESTAMP(3)`,
      ids
    );
    if (Number(resultado.affectedRows) !== sesiones.length) {
      throw new TransicionSesionWebNoPermitida(
        'Cambió el conjunto de sesiones durante la invalidación.'
      );
    }
    return congelarLista(sesiones.map((sesion) => ({
      ...sesion,
      estado: 'invalidada'
    })));
  }

  async limpiarElegibles({ graciaTerminalSegundos = 86400, limite = 500 } = {}) {
    const gracia = enteroAcotado(
      graciaTerminalSegundos,
      1,
      31_536_000,
      'La gracia terminal debe estar entre 1 segundo y 365 días.'
    );
    const maximo = enteroAcotado(limite, 1, 5000, 'El lote debe estar entre 1 y 5000.');
    const conexion = await this.clienteSql.obtenerConexion();
    try {
      await conexion.beginTransaction();
      const [filas] = await conexion.execute(
        `
          SELECT sesion_auditoria_id
          FROM sesiones_web_auditoria
          WHERE
            (estado = 'abierta' AND expira_en_utc <= UTC_TIMESTAMP(3))
            OR
            (estado IN ('cerrada', 'invalidada')
              AND cerrada_en_utc <= TIMESTAMPADD(SECOND, -?, UTC_TIMESTAMP(3)))
          ORDER BY COALESCE(cerrada_en_utc, expira_en_utc), sesion_auditoria_id
          LIMIT ?
          FOR UPDATE SKIP LOCKED
        `,
        [gracia, maximo]
      );
      if (filas.length > 0) {
        const ids = filas.map(({ sesion_auditoria_id }) => sesion_auditoria_id);
        await conexion.execute(
          `DELETE FROM sesiones_web_auditoria
           WHERE sesion_auditoria_id IN (${ids.map(() => '?').join(', ')})`,
          ids
        );
      }
      await conexion.commit();
      return Object.freeze({ eliminadas: filas.length });
    } catch (error) {
      await rollbackSeguro(conexion);
      throw error;
    } finally {
      conexion.release();
    }
  }
}

async function buscarPorIdEnConexion(conexion, sesionAuditoriaId) {
  const [filas] = await conexion.execute(
    `SELECT ${columnasSesion('s')}
     FROM sesiones_web_auditoria s
     WHERE s.sesion_auditoria_id = ?
     LIMIT 1`,
    [uuidV7AuditoriaABytes(sesionAuditoriaId, 'sesionAuditoriaId')]
  );
  if (filas.length !== 1) {
    throw new Error('El registro durable de sesión web no existe.');
  }
  return serializarSesion(filas[0]);
}

function columnasSesion(alias) {
  return `
    ${alias}.sesion_auditoria_id,
    CAST(${alias}.usuario_real_id AS CHAR) AS usuario_real_id,
    CAST(${alias}.usuario_efectivo_id AS CHAR) AS usuario_efectivo_id,
    CAST(${alias}.version_sesion_real AS UNSIGNED) AS version_sesion_real,
    CAST(${alias}.version_sesion_efectiva AS UNSIGNED) AS version_sesion_efectiva,
    CAST(${alias}.apertura_tenant_id AS CHAR) AS apertura_tenant_id,
    CAST(${alias}.apertura_empresa_id AS CHAR) AS apertura_empresa_id,
    CAST(${alias}.apertura_sitio_id AS CHAR) AS apertura_sitio_id,
    CAST(${alias}.efectivo_tenant_id AS CHAR) AS efectivo_tenant_id,
    CAST(${alias}.efectivo_empresa_id AS CHAR) AS efectivo_empresa_id,
    CAST(${alias}.efectivo_sitio_id AS CHAR) AS efectivo_sitio_id,
    ${alias}.evento_impersonacion_iniciada_id,
    ${alias}.estado,
    DATE_FORMAT(${alias}.expira_en_utc, '%Y-%m-%dT%H:%i:%s.%fZ') AS expira_en_utc,
    DATE_FORMAT(${alias}.creada_en_utc, '%Y-%m-%dT%H:%i:%s.%fZ') AS creada_en_utc,
    DATE_FORMAT(${alias}.renovada_en_utc, '%Y-%m-%dT%H:%i:%s.%fZ') AS renovada_en_utc,
    DATE_FORMAT(${alias}.cerrada_en_utc, '%Y-%m-%dT%H:%i:%s.%fZ') AS cerrada_en_utc
  `;
}

function serializarSesion(fila) {
  return Object.freeze({
    sesionAuditoriaId: bytesAUuidV7Auditoria(fila.sesion_auditoria_id),
    usuarioRealId: String(fila.usuario_real_id),
    usuarioEfectivoId: String(fila.usuario_efectivo_id),
    versionSesionReal: Number(fila.version_sesion_real),
    versionSesionEfectiva: Number(fila.version_sesion_efectiva),
    scopeApertura: congelarScope({
      tenantId: fila.apertura_tenant_id,
      empresaId: fila.apertura_empresa_id,
      sitioId: fila.apertura_sitio_id
    }),
    scopeEfectivoActual: congelarScope({
      tenantId: fila.efectivo_tenant_id,
      empresaId: fila.efectivo_empresa_id,
      sitioId: fila.efectivo_sitio_id
    }),
    eventoImpersonacionIniciadaId: fila.evento_impersonacion_iniciada_id
      ? bytesAUuidV7Auditoria(fila.evento_impersonacion_iniciada_id)
      : null,
    estado: fila.estado,
    expiraEnUtc: normalizarFecha(fila.expira_en_utc),
    creadaEnUtc: normalizarFecha(fila.creada_en_utc),
    renovadaEnUtc: normalizarFecha(fila.renovada_en_utc),
    cerradaEnUtc: normalizarFecha(fila.cerrada_en_utc)
  });
}

function normalizarScope(scope, nombre) {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) {
    throw new Error(`${nombre} debe ser un scope explícito.`);
  }
  const claves = Object.keys(scope).sort();
  if (claves.join(',') !== 'empresaId,sitioId,tenantId') {
    throw new Error(`${nombre} debe declarar tenantId, empresaId y sitioId.`);
  }
  const normalizado = {
    tenantId: idOpcional(scope.tenantId, `${nombre}.tenantId`),
    empresaId: idOpcional(scope.empresaId, `${nombre}.empresaId`),
    sitioId: idOpcional(scope.sitioId, `${nombre}.sitioId`)
  };
  if (
    (normalizado.tenantId === null &&
      (normalizado.empresaId !== null || normalizado.sitioId !== null)) ||
    (normalizado.empresaId === null && normalizado.sitioId !== null)
  ) {
    throw new Error(`${nombre} no respeta la jerarquía portal, tenant, empresa y sitio.`);
  }
  return Object.freeze(normalizado);
}

function congelarScope(scope) {
  return Object.freeze({
    tenantId: scope.tenantId == null ? null : String(scope.tenantId),
    empresaId: scope.empresaId == null ? null : String(scope.empresaId),
    sitioId: scope.sitioId == null ? null : String(scope.sitioId)
  });
}

function scopeIgual(a, b) {
  return ['tenantId', 'empresaId', 'sitioId'].every((campo) => a[campo] === b[campo]);
}

function parametrosScope(scope) {
  return [scope.tenantId, scope.empresaId, scope.sitioId];
}

function ordenarIdsUnicos(ids) {
  return [...new Set(ids.map((id) => idDecimal(id, 'idUsuario')))]
    .sort((a, b) => {
      const izquierda = BigInt(a);
      const derecha = BigInt(b);
      return izquierda < derecha ? -1 : izquierda > derecha ? 1 : 0;
    });
}

function idDecimal(valor, nombre) {
  const texto = String(valor ?? '');
  if (!/^[1-9][0-9]*$/.test(texto) || BigInt(texto) > 18_446_744_073_709_551_615n) {
    throw new Error(`${nombre} debe ser un id decimal positivo válido.`);
  }
  return texto;
}

function idOpcional(valor, nombre) {
  return valor === null ? null : idDecimal(valor, nombre);
}

function versionSesion(valor, nombre) {
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero < 1 || numero > 4_294_967_295) {
    throw new Error(`${nombre} debe ser un entero positivo de 32 bits.`);
  }
  return numero;
}

function enteroAcotado(valor, minimo, maximo, mensaje) {
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero < minimo || numero > maximo) {
    throw new Error(mensaje);
  }
  return numero;
}

function normalizarFecha(valor) {
  if (valor == null) return null;
  const coincidencia = String(valor).match(
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\.(\d{3})\d{3}Z$/
  );
  if (!coincidencia) throw new Error(`Fecha SQL UTC no canónica: ${valor}.`);
  return `${coincidencia[1]}.${coincidencia[2]}Z`;
}

function exigirUnaTransicion(resultado, mensaje) {
  if (Number(resultado.affectedRows) !== 1) {
    throw new TransicionSesionWebNoPermitida(mensaje);
  }
}

function exigirConexion(conexion) {
  if (!conexion?.execute) {
    throw new Error('La operación de sesión web requiere una conexión SQL explícita.');
  }
}

function congelarLista(lista) {
  return Object.freeze(lista.map((elemento) => Object.freeze(elemento)));
}

async function rollbackSeguro(conexion) {
  try {
    await conexion.rollback();
  } catch {
    // La causa original conserva prioridad.
  }
}
