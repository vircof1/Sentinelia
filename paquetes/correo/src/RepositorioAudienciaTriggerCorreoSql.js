import { DestinatarioTriggerCorreo }
  from './EntidadesPersistenciaTriggerCorreo.js';

export class RepositorioAudienciaTriggerCorreoSql {
  async listarIdsTriggersPorUsuarioEnTransaccion(usuarioId, { conexion } = {}) {
    return this.listarIdsTriggersPorUsuariosEnTransaccion(
      [usuarioId],
      { conexion }
    );
  }

  async listarIdsTriggersPorUsuariosEnTransaccion(
    idsUsuario = [],
    { conexion } = {}
  ) {
    exigirConexion(conexion);
    const ids = idsEnterosUnicos(idsUsuario, 'usuarioId');
    if (ids.length === 0) return Object.freeze([]);
    const [filas] = await conexion.execute(`
      SELECT DISTINCT trigger_id
        FROM destinatarios_triggers_correo
       WHERE usuario_id IN (${marcadores(ids.length)})
       ORDER BY trigger_id ASC
    `, ids);
    return Object.freeze(filas.map((fila) => Number(fila.trigger_id)));
  }

  async bloquearTriggersCorreoEnTransaccion(idsTrigger = [], { conexion } = {}) {
    exigirConexion(conexion);
    const ids = idsEnterosUnicos(idsTrigger, 'triggerId');
    if (ids.length === 0) return Object.freeze([]);
    const [filas] = await conexion.execute(`
      SELECT id, nombre, tipo, activo, revision_declaracion,
             tenant_id, empresa_id, sitio_id
        FROM triggers
       WHERE id IN (${marcadores(ids.length)})
         AND tipo = 'correo'
       ORDER BY id ASC
       FOR UPDATE
    `, ids);
    return Object.freeze(filas.map((fila) => Object.freeze({ ...fila })));
  }

  async listarMultiplesEnTransaccion(idsTrigger = [], { bloquear = false } = {}, {
    conexion
  } = {}) {
    exigirConexion(conexion);
    const ids = idsEnterosUnicos(idsTrigger, 'triggerId');
    if (ids.length === 0) return Object.freeze([]);
    const [filas] = await conexion.execute(`
      SELECT *
        FROM destinatarios_triggers_correo
       WHERE trigger_id IN (${marcadores(ids.length)})
       ORDER BY trigger_id ASC, id ASC${bloquear ? ' FOR UPDATE' : ''}
    `, ids);
    return Object.freeze(filas.map((fila) => Object.freeze({ ...fila })));
  }

  async leerLimiteEnTransaccion({ conexion } = {}) {
    exigirConexion(conexion);
    const [filas] = await conexion.execute(`
      SELECT valor
        FROM configuracion_portal
       WHERE clave = 'correo.destinatarios_trigger_maximos'
       LIMIT 1
       LOCK IN SHARE MODE
    `);
    const limite = Number(filas[0]?.valor);
    if (!Number.isSafeInteger(limite) || limite < 1 || limite > 1000) {
      throw errorDominio(
        'limite_audiencia_correo_invalido',
        'El límite durable de destinatarios de correo no es válido.',
        503
      );
    }
    return limite;
  }

  async buscarUsuariosEnTransaccion(idsUsuario = [], { conexion } = {}) {
    exigirConexion(conexion);
    const ids = idsEnterosUnicos(idsUsuario, 'usuarioId');
    if (ids.length === 0) return Object.freeze([]);
    const [filas] = await conexion.execute(`
      SELECT id, usuario, nombre_mostrar, nombre_completo,
             tenant_id, empresa_id, sitio_id,
             activo, email, email_validado
        FROM usuarios
       WHERE id IN (${marcadores(ids.length)})
       ORDER BY id ASC
       FOR UPDATE
    `, ids);
    return Object.freeze(filas.map((fila) => Object.freeze({ ...fila })));
  }

  async buscarRelacionesCrudasPorIds(idsRelacion = [], { conexion } = {}) {
    exigirConexion(conexion);
    const ids = idsEnterosUnicos(idsRelacion, 'relacionId');
    if (ids.length === 0) return Object.freeze([]);
    const [filas] = await conexion.execute(`
      SELECT id, trigger_id, usuario_id, estado_participacion
        FROM destinatarios_triggers_correo
       WHERE id IN (${marcadores(ids.length)})
       ORDER BY id ASC
    `, ids);
    return Object.freeze(filas.map((fila) => Object.freeze({ ...fila })));
  }

  async bloquearTriggerCorreoEnTransaccion(triggerId, { conexion } = {}) {
    exigirConexion(conexion);
    const [filas] = await conexion.execute(`
      SELECT id, nombre, tipo, activo, revision_declaracion,
             tenant_id, empresa_id, sitio_id
        FROM triggers
       WHERE id = ?
       LIMIT 1
       FOR UPDATE
    `, [enteroPositivo(triggerId, 'triggerId')]);
    return filas[0] ? Object.freeze({ ...filas[0] }) : null;
  }

  async listarEnTransaccion({ triggerId, bloquear = false } = {}, {
    conexion
  } = {}) {
    exigirConexion(conexion);
    const [filas] = await conexion.execute(`
      SELECT *
        FROM destinatarios_triggers_correo
       WHERE trigger_id = ?
       ORDER BY id ASC${bloquear ? ' FOR UPDATE' : ''}
    `, [enteroPositivo(triggerId, 'triggerId')]);
    return Object.freeze(filas.map((fila) => new DestinatarioTriggerCorreo(fila)));
  }

  async listarResolucionEnTransaccion(triggerId, { conexion } = {}) {
    exigirConexion(conexion);
    const [filas] = await conexion.execute(`
      SELECT d.*, u.activo AS usuario_activo, u.email AS usuario_email,
             u.email_validado AS usuario_email_validado,
             u.usuario AS usuario_nombre_cuenta,
             u.nombre_mostrar AS usuario_nombre_mostrar,
             u.nombre_completo AS usuario_nombre_completo,
             u.tenant_id AS usuario_tenant_id,
             u.empresa_id AS usuario_empresa_id,
             u.sitio_id AS usuario_sitio_id
        FROM destinatarios_triggers_correo d
        LEFT JOIN usuarios u ON u.id = d.usuario_id
       WHERE d.trigger_id = ?
       ORDER BY d.id ASC
    `, [enteroPositivo(triggerId, 'triggerId')]);
    return Object.freeze(filas.map((fila) => Object.freeze({ ...fila })));
  }

  async insertarManualEnTransaccion({
    triggerId,
    emailPresentacion,
    emailCanonico,
    nombreManual,
    versionNormalizacion
  }, { conexion } = {}) {
    exigirConexion(conexion);
    const [resultado] = await conexion.execute(`
      INSERT INTO destinatarios_triggers_correo (
        trigger_id, tipo, email_manual, email_manual_canonico,
        nombre_manual, normalizacion_buzon_version, estado_participacion
      ) VALUES (?, 'manual', ?, ?, ?, ?, 'activa')
    `, [
      enteroPositivo(triggerId, 'triggerId'),
      emailPresentacion,
      emailCanonico,
      nombreManual,
      versionNormalizacion
    ]);
    return this.buscarPorIdEnTransaccion(resultado.insertId, { conexion });
  }

  async insertarUsuarioEnTransaccion({ triggerId, usuarioId }, {
    conexion
  } = {}) {
    exigirConexion(conexion);
    const [resultado] = await conexion.execute(`
      INSERT INTO destinatarios_triggers_correo (
        trigger_id, tipo, usuario_id, estado_participacion
      ) VALUES (?, 'usuario', ?, 'activa')
    `, [
      enteroPositivo(triggerId, 'triggerId'),
      enteroPositivo(usuarioId, 'usuarioId')
    ]);
    return this.buscarPorIdEnTransaccion(resultado.insertId, { conexion });
  }

  async retirarEnTransaccion(relacionId, { conexion } = {}) {
    exigirConexion(conexion);
    const [resultado] = await conexion.execute(
      'DELETE FROM destinatarios_triggers_correo WHERE id = ?',
      [enteroPositivo(relacionId, 'relacionId')]
    );
    return Number(resultado.affectedRows || 0) === 1;
  }

  async reincorporarEnTransaccion(relacionId, { conexion } = {}) {
    exigirConexion(conexion);
    const [resultado] = await conexion.execute(`
      UPDATE destinatarios_triggers_correo
         SET estado_participacion = 'activa',
             causa_ultima_desuscripcion = NULL,
             desuscrita_en_utc = NULL,
             reincorporada_en_utc = UTC_TIMESTAMP(3),
             cambiada_en_utc = UTC_TIMESTAMP(3)
       WHERE id = ? AND estado_participacion = 'desuscrita'
    `, [enteroPositivo(relacionId, 'relacionId')]);
    return Number(resultado.affectedRows || 0) === 1;
  }

  async buscarPorIdEnTransaccion(relacionId, { conexion } = {}) {
    exigirConexion(conexion);
    const [filas] = await conexion.execute(
      'SELECT * FROM destinatarios_triggers_correo WHERE id = ? LIMIT 1',
      [enteroPositivo(relacionId, 'relacionId')]
    );
    return filas[0] ? new DestinatarioTriggerCorreo(filas[0]) : null;
  }
}

function exigirConexion(conexion) {
  if (typeof conexion?.execute !== 'function') {
    throw new Error('La audiencia de correo exige una conexión SQL prestada.');
  }
}

function idsEnterosUnicos(valores, campo) {
  return [...new Set(valores.map((valor) => enteroPositivo(valor, campo)))]
    .sort((a, b) => a - b);
}

function marcadores(cantidad) {
  return Array.from({ length: cantidad }, () => '?').join(', ');
}

function enteroPositivo(valor, campo) {
  const numero = Number(valor);
  if (!Number.isSafeInteger(numero) || numero < 1) {
    throw errorDominio(
      'identidad_audiencia_correo_invalida',
      `${campo} debe ser un entero positivo seguro.`,
      400
    );
  }
  return numero;
}

function errorDominio(codigo, mensaje, statusCode) {
  return Object.assign(new Error(mensaje), { codigo, statusCode });
}
