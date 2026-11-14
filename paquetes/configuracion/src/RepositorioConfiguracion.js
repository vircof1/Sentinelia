import {
  CLAVES_BLOQUEO_AUTORIDAD_CORREO,
  validarMetadatosSqlConfiguracionCorreo
} from '../../correo/src/CatalogoConfiguracionCorreo.js';

export class RepositorioConfiguracion {
  constructor(clienteSql) {
    this.clienteSql = clienteSql;
  }

  async cargarValores() {
    const filas = await this.clienteSql.consultar(`
      SELECT clave, valor
      FROM configuracion_portal
      ORDER BY clave ASC
    `);

    return new Map(filas.map((fila) => [fila.clave, fila.valor]));
  }

  async cargarEstadoDespliegueCorreo() {
    const filas = await this.clienteSql.consultar(
      `SELECT *
         FROM estado_despliegue_trigger_correo
        WHERE id = 1
        LIMIT 1`
    );
    if (!filas[0]) {
      throw new Error('Falta la cabecera de despliegue del trigger de correo.');
    }
    return Object.freeze({ ...filas[0] });
  }

  async cargarValoresEnTransaccion({ conexion } = {}) {
    exigirConexion(conexion);
    const [filas] = await conexion.execute(
      `SELECT clave, valor
         FROM configuracion_portal
        ORDER BY clave ASC
        FOR UPDATE`
    );
    return new Map(filas.map((fila) => [fila.clave, fila.valor]));
  }

  async bloquearValorEnTransaccion(clave, { conexion } = {}) {
    exigirConexion(conexion);
    const [filas] = await conexion.execute(
      `SELECT clave, valor, tipo_dato
         FROM configuracion_portal
        WHERE clave = ?
        LIMIT 1
        FOR UPDATE`,
      [clave]
    );
    return filas[0] ?? null;
  }

  async bloquearAutoridadCorreoEnTransaccion({
    conexion,
    modo = 'exclusivo'
  } = {}) {
    exigirConexion(conexion);
    if (!['compartido', 'exclusivo'].includes(modo)) {
      throw new Error('El lock de autoridad de correo no tiene un modo válido.');
    }
    const sufijoLock = modo === 'compartido' ? 'LOCK IN SHARE MODE' : 'FOR UPDATE';
    const marcadores = CLAVES_BLOQUEO_AUTORIDAD_CORREO.map(() => '?').join(', ');
    const [filasConfiguracion] = await conexion.execute(
      `SELECT clave, valor, tipo_dato,
              participa_admision_correo, invalida_prueba_smtp
         FROM configuracion_portal
        WHERE clave IN (${marcadores})
        ORDER BY CAST(clave AS BINARY) ASC
        ${sufijoLock}`,
      CLAVES_BLOQUEO_AUTORIDAD_CORREO
    );
    const obtenidas = new Set(filasConfiguracion.map((fila) => fila.clave));
    const faltantes = CLAVES_BLOQUEO_AUTORIDAD_CORREO
      .filter((clave) => !obtenidas.has(clave));
    if (faltantes.length > 0) {
      throw new Error(`Faltan claves de autoridad de correo: ${faltantes.join(', ')}.`);
    }
    const [[estadoVerificacion]] = await conexion.execute(
      `SELECT *
         FROM estado_verificacion_correo
        WHERE id = 1
        ${sufijoLock}`
    );
    if (!estadoVerificacion) {
      throw new Error('Falta la cabecera autoritativa de verificación de correo.');
    }
    const [[cabeceraConfiguracion]] = await conexion.execute(
      `SELECT CAST(version AS CHAR) AS version
         FROM cabecera_configuracion_portal
        WHERE id = 1
        ${sufijoLock}`
    );
    if (!cabeceraConfiguracion) {
      throw new Error('Falta la cabecera durable de configuración.');
    }
    const [[estadoDespliegue]] = await conexion.execute(
      `SELECT *
         FROM estado_despliegue_trigger_correo
        WHERE id = 1
        ${sufijoLock}`
    );
    if (!estadoDespliegue) {
      throw new Error('Falta la cabecera de despliegue del trigger de correo.');
    }
    return Object.freeze({
      filasConfiguracion: Object.freeze(
        filasConfiguracion.map((fila) => Object.freeze({ ...fila }))
      ),
      valores: new Map(filasConfiguracion.map((fila) => [fila.clave, fila.valor])),
      estadoVerificacion: Object.freeze({ ...estadoVerificacion }),
      estadoDespliegue: Object.freeze({ ...estadoDespliegue }),
      versionConfiguracion: String(cabeceraConfiguracion.version)
    });
  }

  async cargarMetadatosCorreoEnTransaccion({ conexion } = {}) {
    exigirConexion(conexion);
    const [filas] = await conexion.execute(
      `SELECT clave, participa_admision_correo, invalida_prueba_smtp
         FROM configuracion_portal
        WHERE participa_admision_correo = 1 OR invalida_prueba_smtp = 1
        ORDER BY CAST(clave AS BINARY) ASC`
    );
    validarMetadatosSqlConfiguracionCorreo(filas);
    return Object.freeze(filas.map((fila) => Object.freeze({ ...fila })));
  }

  async cortarAutoridadOrigenCorreoEnTransaccion({ conexion } = {}) {
    exigirConexion(conexion);
    const [resultado] = await conexion.execute(
      `UPDATE estado_despliegue_trigger_correo
          SET estado = 'corte_origen',
              origen_portal_autoritativo = 1,
              revision = revision + 1,
              cortado_en_utc = UTC_TIMESTAMP(3)
        WHERE id = 1
          AND estado = 'preparacion'
          AND guard_metadatos_activo = 0
          AND origen_portal_autoritativo = 0
          AND verificacion_smtp_autoritativa = 0
          AND guard_verificacion_legacy_activo = 0
          AND guard_revision_trigger_activo = 0
          AND cola_sql_autoritativa = 0
          AND tipo_correo_habilitado = 0`
    );
    if (Number(resultado.affectedRows) !== 1) {
      throw new Error('No se pudo cortar la autoridad del origen público.');
    }
  }

  async cortarAutoridadVerificacionCorreoEnTransaccion({ conexion } = {}) {
    exigirConexion(conexion);
    const [resultado] = await conexion.execute(
      `UPDATE estado_despliegue_trigger_correo
          SET estado = 'corte_verificacion',
              guard_metadatos_activo = 1,
              verificacion_smtp_autoritativa = 1,
              guard_verificacion_legacy_activo = 1,
              revision = revision + 1
        WHERE id = 1
          AND estado = 'corte_origen'
          AND origen_portal_autoritativo = 1
          AND guard_revision_trigger_activo = 1
          AND guard_metadatos_activo = 0
          AND verificacion_smtp_autoritativa = 0
          AND guard_verificacion_legacy_activo = 0
          AND cola_sql_autoritativa = 0
          AND tipo_correo_habilitado = 0`
    );
    if (Number(resultado.affectedRows) !== 1) {
      throw new Error('No se pudo cortar la autoridad de verificación SMTP.');
    }
  }

  async invalidarEstadoVerificacionCorreoEnTransaccion({
    codigo,
    usuarioId = null,
    conexion
  } = {}) {
    exigirConexion(conexion);
    const codigoSeguro = String(codigo || '').trim();
    if (!/^[a-z][a-z0-9_]{0,119}$/u.test(codigoSeguro)) {
      throw new Error('La invalidación SMTP requiere un código cerrado.');
    }
    const idUsuario = usuarioId == null ? null : Number(usuarioId);
    if (idUsuario !== null && (!Number.isSafeInteger(idUsuario) || idUsuario <= 0)) {
      throw new Error('La invalidación SMTP recibió un usuario inválido.');
    }
    const [resultado] = await conexion.execute(
      `UPDATE estado_verificacion_correo
          SET verificado = 0,
              perfil_version = NULL,
              huella_hmac = NULL,
              key_id = NULL,
              configuracion_version = NULL,
              verificado_por_usuario_id = NULL,
              verificado_en_utc = NULL,
              invalidado_por_usuario_id = ?,
              invalidado_en_utc = UTC_TIMESTAMP(3),
              codigo_invalidacion = ?
        WHERE id = 1`,
      [idUsuario, codigoSeguro]
    );
    if (Number(resultado.affectedRows) !== 1) {
      throw new Error('No se pudo invalidar la verificación autoritativa de correo.');
    }
  }

  async promoverEstadoVerificacionCorreoEnTransaccion({
    perfilVersion,
    huellaHmac,
    keyId,
    configuracionVersion,
    usuarioId,
    conexion
  } = {}) {
    exigirConexion(conexion);
    if (perfilVersion !== 'smtp@1' || !Buffer.isBuffer(huellaHmac) ||
        huellaHmac.length !== 32 || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(keyId) ||
        !/^[1-9][0-9]*$/u.test(String(configuracionVersion)) ||
        !Number.isSafeInteger(Number(usuarioId)) || Number(usuarioId) <= 0) {
      throw new Error('La promoción SMTP no contiene una prueba válida.');
    }
    const [resultado] = await conexion.execute(
      `UPDATE estado_verificacion_correo
          SET verificado = 1,
              perfil_version = ?,
              huella_hmac = ?,
              key_id = ?,
              configuracion_version = ?,
              verificado_por_usuario_id = ?,
              verificado_en_utc = UTC_TIMESTAMP(3),
              invalidado_por_usuario_id = NULL,
              invalidado_en_utc = NULL,
              codigo_invalidacion = NULL
        WHERE id = 1`,
      [perfilVersion, huellaHmac, keyId, String(configuracionVersion), Number(usuarioId)]
    );
    if (Number(resultado.affectedRows) !== 1) {
      throw new Error('No se pudo promover la verificación autoritativa de correo.');
    }
  }

  async actualizarValorEnTransaccion(clave, valor, { conexion } = {}) {
    exigirConexion(conexion);
    const [resultado] = await conexion.execute(
      `UPDATE configuracion_portal
          SET valor = ?
        WHERE clave = ?`,
      [valor, clave]
    );
    if (Number(resultado.affectedRows) !== 1) {
      throw new Error(`No existe la clave de configuración ${clave}.`);
    }
  }

  async sincronizarDefinicionesEnTransaccion(
    definiciones,
    { conexion } = {}
  ) {
    exigirConexion(conexion);
    const [existentes] = await conexion.execute(
      `SELECT clave, valor
         FROM configuracion_portal
        ORDER BY clave ASC
        FOR UPDATE`
    );
    const porClave = new Map(existentes.map((fila) => [fila.clave, fila]));
    const creadas = [];
    for (const definicion of [...definiciones].sort((a, b) =>
      Buffer.compare(Buffer.from(a.clave), Buffer.from(b.clave)))) {
      if (porClave.has(definicion.clave)) continue;
      await conexion.execute(
        `INSERT INTO configuracion_portal (
           clave, valor, tipo_dato, descripcion, creado_automaticamente,
           participa_admision_correo, invalida_prueba_smtp
         ) VALUES (?, ?, ?, ?, 1, ?, ?)`,
        [
          definicion.clave,
          definicion.valorPorDefecto,
          definicion.tipoDato,
          definicion.descripcion,
          definicion.participaAdmisionCorreo ? 1 : 0,
          definicion.invalidaPruebaSmtp ? 1 : 0
        ]
      );
      creadas.push(Object.freeze({
        clave: definicion.clave,
        valor: definicion.valorPorDefecto
      }));
    }
    return Object.freeze(creadas);
  }

  async obtenerVersionEnTransaccion({ conexion } = {}) {
    exigirConexion(conexion);
    const [[fila]] = await conexion.execute(
      `SELECT CAST(version AS CHAR) AS version
         FROM cabecera_configuracion_portal
        WHERE id = 1
        FOR UPDATE`
    );
    if (!fila) throw new Error('Falta la cabecera durable de configuración.');
    return String(fila.version);
  }

  async incrementarVersionEnTransaccion({ conexion } = {}) {
    exigirConexion(conexion);
    const [resultado] = await conexion.execute(
      `UPDATE cabecera_configuracion_portal
          SET version = version + 1
        WHERE id = 1 AND version < 18446744073709551615`
    );
    if (Number(resultado.affectedRows) !== 1) {
      throw new Error('La versión durable de configuración está agotada.');
    }
    return this.obtenerVersionEnTransaccion({ conexion });
  }
}

function exigirConexion(conexion) {
  if (typeof conexion?.execute !== 'function') {
    throw new Error('La configuración auditable exige una conexión prestada.');
  }
}
