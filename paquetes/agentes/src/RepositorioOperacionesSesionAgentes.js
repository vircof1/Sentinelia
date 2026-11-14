import { randomBytes } from 'node:crypto';
import {
  bytesAUuidV7Auditoria,
  uuidV7AuditoriaABytes
} from '../../auditoria/src/UuidV7Auditoria.js';
import { calcularDigestRequestIdSesionAgente } from './IdentidadRequestSesionAgente.js';

const MAX_BIGINT_UNSIGNED = 18_446_744_073_709_551_615n;
const ESTADOS_TERMINALES = new Set(['consolidada', 'reemplazada', 'fallida']);
const TRANSICIONES = Object.freeze({
  pendiente: new Set(['redis_preparada', 'fallida', 'reemplazada']),
  redis_preparada: new Set(['respuesta_pendiente', 'consolidada', 'reemplazada']),
  respuesta_pendiente: new Set(['consolidada', 'reemplazada'])
});

class ReservaRequestSesionConcurrente extends Error {}

export class ConflictoRequestSesionAgente extends Error {
  constructor(mensaje, codigo = 'REQUEST_ID_SESION_EN_CONFLICTO') {
    super(mensaje);
    this.name = 'ConflictoRequestSesionAgente';
    this.codigo = codigo;
  }
}

export class ContadorSesionAgenteAgotado extends Error {
  constructor(nombre) {
    super(`${nombre} alcanzó su máximo y requiere intervención.`);
    this.name = 'ContadorSesionAgenteAgotado';
    this.codigo = 'CONTADOR_SESION_AGENTE_AGOTADO';
  }
}

export class RepositorioOperacionesSesionAgentes {
  constructor(clienteSql) {
    if (!clienteSql?.obtenerConexion) {
      throw new Error('Las operaciones de sesión de agente requieren SQL operativo.');
    }
    this.clienteSql = clienteSql;
  }

  async reservarRequestAtomica(datos, opciones = {}) {
    const ejecutar = () => this.#enTransaccion((conexion) =>
      this.reservarRequestEnTransaccion(datos, { ...opciones, conexion })
    );
    try {
      return await ejecutar();
    } catch (error) {
      if (!(error instanceof ReservaRequestSesionConcurrente)) throw error;
      return ejecutar();
    }
  }

  async reservarRequestEnTransaccion(
    datos = {},
    { conexion, ventanaSegundos = 900 } = {}
  ) {
    exigirConexion(conexion);
    const entrada = normalizarRequest(datos, ventanaSegundos);
    const agente = await bloquearAgente(conexion, entrada.agenteId);
    await asegurarYBloquearCabecera(conexion, entrada.agenteId);

    const existente = await buscarIdentidadPorDigest(
      conexion,
      entrada.digestRequestId,
      true
    );
    if (existente) return resolverRepeticion(existente, entrada, conexion);

    const [reserva] = await conexion.execute(
      `SELECT digest_request_id
       FROM reservas_request_id_sesion_agentes
       WHERE digest_request_id = ?
       FOR UPDATE`,
      [entrada.digestRequestId]
    );
    if (reserva.length > 0) {
      throw new ConflictoRequestSesionAgente(
        'La respuesta de este request id ya no es recuperable.',
        'RESPUESTA_SESION_NO_RECUPERABLE'
      );
    }

    const fencingToken = await incrementarFencing(conexion, entrada.agenteId);
    const [[reloj]] = await conexion.execute(
      'SELECT UTC_TIMESTAMP(3) AS primera_observacion_utc'
    );
    const operacion = {
      ...entrada,
      versionScopeObservada: String(agente.version_scope_agente),
      versionAutorizacionObservada: String(agente.version_autorizacion_agente),
      fencingToken: String(fencingToken),
      primeraObservacionUtc: reloj.primera_observacion_utc
    };
    await insertarOperacion(conexion, operacion, reloj.primera_observacion_utc);
    try {
      await conexion.execute(
        'INSERT INTO reservas_request_id_sesion_agentes (digest_request_id) VALUES (?)',
        [entrada.digestRequestId]
      );
    } catch (error) {
      if (error?.code === 'ER_DUP_ENTRY') {
        throw new ReservaRequestSesionConcurrente(
          'Otra transacción reservó simultáneamente el request id.'
        );
      }
      throw error;
    }
    await conexion.execute(
      `INSERT INTO identidades_request_id_sesion_agentes (
         digest_request_id, request_id, tipo, agente_id, sesion_auditoria_id,
         huella_intencion, operacion_id, primera_observacion_utc, expira_en_utc
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, TIMESTAMPADD(SECOND, ?, ?))`,
      [
        entrada.digestRequestId,
        entrada.requestIdBytes,
        entrada.tipo,
        entrada.tipo === 'login' ? entrada.agenteId : null,
        entrada.tipo === 'refresh' ? entrada.sesionAuditoriaIdBytes : null,
        entrada.huellaIntencion,
        entrada.operacionIdBytes,
        reloj.primera_observacion_utc,
        entrada.ventanaSegundos,
        reloj.primera_observacion_utc
      ]
    );
    return Object.freeze({
      ...(await buscarOperacionPorId(conexion, entrada.operacionId)),
      repetida: false
    });
  }

  async crearInvalidacionEnTransaccion(datos = {}, { conexion } = {}) {
    exigirConexion(conexion);
    const entrada = normalizarInvalidacion(datos);
    const agenteBloqueado = await bloquearAgente(conexion, entrada.agenteId, {
      permitirAusente: true
    });
    if (!agenteBloqueado) {
      const recuperable = await buscarInvalidacion(conexion, entrada, true);
      if (recuperable) return resolverInvalidacionExistente(recuperable, entrada);
      throw new Error('El agente no existe y no hay una invalidación precreada recuperable.');
    }
    await asegurarYBloquearCabecera(conexion, entrada.agenteId);
    const existente = await buscarInvalidacion(conexion, entrada, true);
    if (existente) return resolverInvalidacionExistente(existente, entrada);

    const [actualizacion] = await conexion.execute(
      `UPDATE agentes_sentinelia
       SET version_autorizacion_agente = version_autorizacion_agente + 1
       WHERE id = ? AND version_autorizacion_agente < ?`,
      [entrada.agenteId, MAX_BIGINT_UNSIGNED.toString()]
    );
    if (actualizacion.affectedRows !== 1) {
      throw new ContadorSesionAgenteAgotado('versionAutorizacionAgente');
    }
    const fencingToken = await incrementarFencing(conexion, entrada.agenteId);
    const [[agente]] = await conexion.execute(
      `SELECT version_scope_agente, version_autorizacion_agente
       FROM agentes_sentinelia WHERE id = ?`,
      [entrada.agenteId]
    );
    const [[reloj]] = await conexion.execute('SELECT UTC_TIMESTAMP(3) AS ahora_utc');
    await insertarOperacion(
      conexion,
      {
        ...entrada,
        requestIdBytes: null,
        versionScopeObservada: String(agente.version_scope_agente),
        versionAutorizacionObservada: String(agente.version_autorizacion_agente),
        fencingToken: String(fencingToken)
      },
      reloj.ahora_utc
    );
    return Object.freeze({
      ...(await buscarOperacionPorId(conexion, entrada.operacionId)),
      repetida: false
    });
  }

  async crearInvalidacionPorMovimientoEnTransaccion(
    datos = {},
    { conexion } = {}
  ) {
    exigirConexion(conexion);
    const entrada = normalizarInvalidacion(datos);
    await bloquearAgente(conexion, entrada.agenteId);
    await asegurarYBloquearCabecera(conexion, entrada.agenteId);
    const existente = await buscarInvalidacion(conexion, entrada, true);
    if (existente) return resolverInvalidacionExistente(existente, entrada);
    const [[antes]] = await conexion.execute(
      `SELECT sesion_auditoria_id FROM agentes_sentinelia WHERE id = ?`,
      [entrada.agenteId]
    );
    if (!antes?.sesion_auditoria_id ||
        !Buffer.from(antes.sesion_auditoria_id).equals(entrada.sesionAuditoriaIdBytes)) {
      throw new Error('La sesión técnica cambió durante el movimiento organizativo.');
    }
    const [actualizacion] = await conexion.execute(
      `UPDATE agentes_sentinelia
       SET version_scope_agente = version_scope_agente + 1
       WHERE id = ? AND version_scope_agente < ?`,
      [entrada.agenteId, MAX_BIGINT_UNSIGNED.toString()]
    );
    if (actualizacion.affectedRows !== 1) {
      throw new ContadorSesionAgenteAgotado('versionScopeAgente');
    }
    const fencingToken = await incrementarFencing(conexion, entrada.agenteId);
    const [[agente]] = await conexion.execute(
      `SELECT version_scope_agente, version_autorizacion_agente,
        CAST(tenant_id AS CHAR) AS tenant_id,
        CAST(empresa_id AS CHAR) AS empresa_id,
        CAST(sitio_id AS CHAR) AS sitio_id
       FROM agentes_sentinelia WHERE id = ?`,
      [entrada.agenteId]
    );
    if (!scopeIgualFila(entrada.scope, agente)) {
      throw new Error('La invalidación técnica no conserva el scope posterior del agente.');
    }
    const [[reloj]] = await conexion.execute('SELECT UTC_TIMESTAMP(3) AS ahora_utc');
    await insertarOperacion(
      conexion,
      {
        ...entrada,
        requestIdBytes: null,
        versionScopeObservada: String(agente.version_scope_agente),
        versionAutorizacionObservada: String(agente.version_autorizacion_agente),
        fencingToken: String(fencingToken)
      },
      reloj.ahora_utc
    );
    return Object.freeze({
      ...(await buscarOperacionPorId(conexion, entrada.operacionId)),
      repetida: false
    });
  }

  async neutralizarPorEliminacionEnTransaccion(
    datos = {},
    { conexion } = {}
  ) {
    exigirConexion(conexion);
    const agenteId = idDecimal(datos.agenteId, 'agenteId');
    const agente = await bloquearAgente(conexion, agenteId);
    await asegurarYBloquearCabecera(conexion, agenteId);
    const sesionActualId = agente.sesion_auditoria_id
      ? bytesAUuidV7Auditoria(agente.sesion_auditoria_id)
      : null;
    const sesionDeclaradaId = datos.sesionAuditoriaId ?? null;
    if (sesionActualId !== sesionDeclaradaId) {
      throw new Error('La sesión técnica cambió durante la eliminación del agente.');
    }
    const [pendientes] = await conexion.execute(
      `SELECT operacion_id, fencing_token
         FROM operaciones_sesion_agentes
        WHERE agente_id = ? AND tipo IN ('login', 'refresh')
          AND estado IN ('pendiente', 'redis_preparada', 'respuesta_pendiente')
        ORDER BY operacion_id
        FOR UPDATE`,
      [agenteId]
    );
    const [reemplazo] = await conexion.execute(
      `UPDATE operaciones_sesion_agentes
          SET estado = 'reemplazada', instancia_id = NULL, lease_token = NULL,
              lease_expira_utc = NULL, replay_cifrado_disponible = FALSE,
              key_id = NULL, ultimo_codigo_error = 'raiz_agente_eliminada',
              ultimo_mensaje_error = 'Operación reemplazada por eliminación del agente.',
              actualizada_en_utc = UTC_TIMESTAMP(3),
              terminada_en_utc = UTC_TIMESTAMP(3)
        WHERE agente_id = ? AND tipo IN ('login', 'refresh')
          AND estado IN ('pendiente', 'redis_preparada', 'respuesta_pendiente')`,
      [agenteId]
    );
    if (Number(reemplazo.affectedRows) !== pendientes.length) {
      throw new Error('Cambió el conjunto de login/refresh durante la neutralización.');
    }
    const retiradasPendientes = Object.freeze(pendientes.map((fila) => Object.freeze({
      agenteId,
      operacionId: bytesAUuidV7Auditoria(fila.operacion_id),
      fencingToken: String(fila.fencing_token)
    })));
    if (!sesionActualId) {
      const autoridad = await this.incrementarAutorizacionYFencingEnTransaccion(
        agenteId,
        { conexion }
      );
      return Object.freeze({
        operacion: null,
        operacionesReemplazadas: pendientes.length,
        retiradasPendientes,
        ...autoridad
      });
    }
    const operacion = await this.crearInvalidacionEnTransaccion(datos, { conexion });
    return Object.freeze({
      operacion,
      operacionesReemplazadas: pendientes.length,
      retiradasPendientes,
      agenteId,
      versionScopeAgente: operacion.versionScopeObservada,
      versionAutorizacionAgente: operacion.versionAutorizacionObservada,
      fencingToken: operacion.fencingToken
    });
  }

  async incrementarAutorizacionYFencingEnTransaccion(
    agenteId,
    { conexion } = {}
  ) {
    exigirConexion(conexion);
    const id = idDecimal(agenteId, 'agenteId');
    await bloquearAgente(conexion, id);
    await asegurarYBloquearCabecera(conexion, id);
    const [actualizacion] = await conexion.execute(
      `UPDATE agentes_sentinelia
       SET version_autorizacion_agente = version_autorizacion_agente + 1
       WHERE id = ? AND version_autorizacion_agente < ?`,
      [id, MAX_BIGINT_UNSIGNED.toString()]
    );
    if (actualizacion.affectedRows !== 1) {
      throw new ContadorSesionAgenteAgotado('versionAutorizacionAgente');
    }
    const fencingToken = await incrementarFencing(conexion, id);
    const [[fila]] = await conexion.execute(
      `SELECT version_scope_agente, version_autorizacion_agente
       FROM agentes_sentinelia WHERE id = ?`,
      [id]
    );
    return Object.freeze({
      agenteId: id,
      versionScopeAgente: String(fila.version_scope_agente),
      versionAutorizacionAgente: String(fila.version_autorizacion_agente),
      fencingToken: String(fencingToken)
    });
  }

  async incrementarScopeYFencingEnTransaccion(agenteId, { conexion } = {}) {
    exigirConexion(conexion);
    const id = idDecimal(agenteId, 'agenteId');
    await bloquearAgente(conexion, id);
    await asegurarYBloquearCabecera(conexion, id);
    const [actualizacion] = await conexion.execute(
      `UPDATE agentes_sentinelia
       SET version_scope_agente = version_scope_agente + 1
       WHERE id = ? AND version_scope_agente < ?`,
      [id, MAX_BIGINT_UNSIGNED.toString()]
    );
    if (actualizacion.affectedRows !== 1) {
      throw new ContadorSesionAgenteAgotado('versionScopeAgente');
    }
    const fencingToken = await incrementarFencing(conexion, id);
    const [[fila]] = await conexion.execute(
      `SELECT version_scope_agente, version_autorizacion_agente
       FROM agentes_sentinelia WHERE id = ?`,
      [id]
    );
    return Object.freeze({
      agenteId: id,
      versionScopeAgente: String(fila.version_scope_agente),
      versionAutorizacionAgente: String(fila.version_autorizacion_agente),
      fencingToken: String(fencingToken)
    });
  }

  async buscarPorId(operacionId) {
    const filas = await this.clienteSql.consultar(
      `SELECT ${columnasOperacion('o')}
       FROM operaciones_sesion_agentes o
       WHERE o.operacion_id = ? LIMIT 1`,
      [uuidV7AuditoriaABytes(operacionId, 'operacionId')]
    );
    return filas[0] ? serializarOperacion(filas[0]) : null;
  }

  async buscarPorRequestId(requestId) {
    const digest = calcularDigestRequestIdSesionAgente(requestId);
    const identidades = await this.clienteSql.consultar(
      `SELECT operacion_id
         FROM identidades_request_id_sesion_agentes
        WHERE digest_request_id = ? LIMIT 1`,
      [digest]
    );
    if (identidades[0]) {
      const operacion = await this.buscarPorId(
        bytesAUuidV7Auditoria(identidades[0].operacion_id)
      );
      return Object.freeze({ estado: 'disponible', operacion });
    }
    const reservas = await this.clienteSql.consultar(
      `SELECT 1 AS presente FROM reservas_request_id_sesion_agentes
        WHERE digest_request_id = ? LIMIT 1`,
      [digest]
    );
    return Object.freeze({
      estado: reservas.length ? 'tombstone' : 'ausente',
      operacion: null
    });
  }

  async buscarInvalidacionPorSesion(agenteId, sesionAuditoriaId) {
    const filas = await this.clienteSql.consultar(
      `SELECT ${columnasOperacion('o')}
         FROM operaciones_sesion_agentes o
        WHERE o.tipo = 'invalidacion' AND o.agente_id = ?
          AND o.sesion_auditoria_id = ?
        ORDER BY o.fencing_token DESC, o.operacion_id DESC LIMIT 1`,
      [
        idDecimal(agenteId, 'agenteId'),
        uuidV7AuditoriaABytes(sesionAuditoriaId, 'sesionAuditoriaId')
      ]
    );
    return filas[0] ? serializarOperacion(filas[0]) : null;
  }

  async compactarRequestEnTransaccion(requestId, { conexion } = {}) {
    exigirConexion(conexion);
    const digest = calcularDigestRequestIdSesionAgente(requestId);
    const identidad = await buscarIdentidadPorDigest(conexion, digest, true);
    if (!identidad) return Object.freeze({ compactada: false, motivo: 'ausente' });
    const operacion = await buscarOperacionPorId(conexion, identidad.operacionId, true);
    if (!ESTADOS_TERMINALES.has(operacion.estado)) {
      throw new Error('Una identidad con operación no terminal no puede compactarse.');
    }
    const [retirada] = await conexion.execute(
      `DELETE FROM identidades_request_id_sesion_agentes
       WHERE digest_request_id = ? AND expira_en_utc <= UTC_TIMESTAMP(3)`,
      [digest]
    );
    if (retirada.affectedRows !== 1) {
      throw new Error('La ventana de repetición todavía no ha vencido.');
    }
    await conexion.execute(
      'DELETE FROM operaciones_sesion_agentes WHERE operacion_id = ?',
      [uuidV7AuditoriaABytes(identidad.operacionId, 'operacionId')]
    );
    return Object.freeze({ compactada: true, digestRequestId: digest.toString('hex') });
  }

  async reclamarSiguienteAtomica({ instanciaId, leaseSegundos = 30 } = {}) {
    const leaseToken = randomBytes(32);
    const operacion = await this.reclamarSiguienteConLease({
      instanciaId,
      leaseToken,
      ttlSegundos: leaseSegundos
    });
    return operacion
      ? Object.freeze({ ...operacion, leaseToken: leaseToken.toString('hex') })
      : null;
  }

  async reclamarSiguienteConLease({
    instanciaId,
    leaseToken,
    ttlSegundos = 30,
    operacionId = null
  } = {}) {
    const instancia = textoAscii(instanciaId, 128, 'instanciaId');
    const token = bufferLease(leaseToken);
    const ttl = enteroAcotado(ttlSegundos, 1, 300, 'ttlSegundos');
    return this.#enTransaccion(async (conexion) => {
      const filtroId = operacionId
        ? 'AND operacion_id = ?'
        : '';
      const parametros = operacionId
        ? [uuidV7AuditoriaABytes(operacionId, 'operacionId')]
        : [];
      const [filas] = await conexion.execute(
        `SELECT operacion_id
         FROM operaciones_sesion_agentes
         WHERE estado IN ('pendiente', 'redis_preparada', 'respuesta_pendiente')
           AND proximo_intento_utc <= UTC_TIMESTAMP(3)
           AND (lease_expira_utc IS NULL OR lease_expira_utc <= UTC_TIMESTAMP(3))
           ${filtroId}
         ORDER BY proximo_intento_utc, operacion_id
         LIMIT 1 FOR UPDATE SKIP LOCKED`,
        parametros
      );
      if (filas.length === 0) return null;
      await conexion.execute(
        `UPDATE operaciones_sesion_agentes
         SET instancia_id = ?, lease_token = ?,
             lease_expira_utc = TIMESTAMPADD(SECOND, ?, UTC_TIMESTAMP(3)),
             intentos = intentos + 1, actualizada_en_utc = UTC_TIMESTAMP(3)
         WHERE operacion_id = ?`,
        [instancia, token, ttl, filas[0].operacion_id]
      );
      const operacion = await buscarOperacionPorId(
        conexion,
        bytesAUuidV7Auditoria(filas[0].operacion_id)
      );
      return operacion;
    });
  }

  async renovarLease({
    operacionId,
    instanciaId,
    leaseToken,
    fencingToken,
    ttlSegundos = 30
  } = {}) {
    const ttl = enteroAcotado(ttlSegundos, 1, 300, 'ttlSegundos');
    const [resultado] = await this.clienteSql.ejecutar(
      `UPDATE operaciones_sesion_agentes
          SET lease_expira_utc = TIMESTAMPADD(SECOND, ?, UTC_TIMESTAMP(3)),
              actualizada_en_utc = UTC_TIMESTAMP(3)
        WHERE operacion_id = ? AND instancia_id = ? AND lease_token = ?
          AND fencing_token = ? AND lease_expira_utc > UTC_TIMESTAMP(3)
          AND estado IN ('pendiente', 'redis_preparada', 'respuesta_pendiente')`,
      [
        ttl,
        uuidV7AuditoriaABytes(operacionId, 'operacionId'),
        textoAscii(instanciaId, 128, 'instanciaId'),
        bufferLease(leaseToken),
        bigintPositivo(fencingToken, 'fencingToken')
      ]
    );
    return Number(resultado.affectedRows) === 1;
  }

  async bloquearLeaseVigente(datos = {}, { conexion } = {}) {
    exigirConexion(conexion);
    const [filas] = await conexion.execute(
      `SELECT ${columnasOperacion('o')}
         FROM operaciones_sesion_agentes o
        WHERE o.operacion_id = ? AND o.instancia_id = ? AND o.lease_token = ?
          AND o.fencing_token = ? AND o.lease_expira_utc > UTC_TIMESTAMP(3)
        LIMIT 1 FOR UPDATE`,
      [
        uuidV7AuditoriaABytes(datos.operacionId, 'operacionId'),
        textoAscii(datos.instanciaId, 128, 'instanciaId'),
        bufferLease(datos.leaseToken),
        bigintPositivo(datos.fencingToken, 'fencingToken')
      ]
    );
    return filas[0] ? serializarOperacion(filas[0]) : null;
  }

  async verificarAutoridadOperacionEnTransaccion(
    operacion,
    { conexion } = {}
  ) {
    exigirConexion(conexion);
    const [agentes] = await conexion.execute(
      `SELECT CAST(version_scope_agente AS CHAR) AS version_scope_agente,
              CAST(version_autorizacion_agente AS CHAR) AS version_autorizacion_agente,
              CAST(tenant_id AS CHAR) AS tenant_id,
              CAST(empresa_id AS CHAR) AS empresa_id,
              CAST(sitio_id AS CHAR) AS sitio_id,
              sesion_auditoria_id
         FROM agentes_sentinelia WHERE id = ? FOR UPDATE`,
      [operacion.agenteId]
    );
    const [cabeceras] = await conexion.execute(
      `SELECT CAST(fencing_token AS CHAR) AS fencing_token
         FROM cabeceras_coordinacion_sesion_agentes
        WHERE agente_id = ? FOR UPDATE`,
      [operacion.agenteId]
    );
    const agente = agentes[0] ?? null;
    const fencingActual = cabeceras[0] ? String(cabeceras[0].fencing_token) : null;
    const versionesCoinciden = agente &&
      String(agente.version_scope_agente) === operacion.versionScopeObservada &&
      String(agente.version_autorizacion_agente) === operacion.versionAutorizacionObservada;
    const scopeCoincide = agente && scopeIgualFila(operacion.scope, agente);
    const sesionActualId = agente?.sesion_auditoria_id
      ? bytesAUuidV7Auditoria(agente.sesion_auditoria_id)
      : null;
    const sesionCoincide = operacion.tipo !== 'refresh' ||
      sesionActualId === operacion.sesionAuditoriaId;
    const invalidacionHuerfanaAdmitida = !agente &&
      operacion.tipo === 'invalidacion' &&
      (fencingActual === null || fencingActual === operacion.fencingToken);
    return Object.freeze({
      vigente: Boolean(
        invalidacionHuerfanaAdmitida || (
          agente && versionesCoinciden && scopeCoincide && sesionCoincide &&
          fencingActual === operacion.fencingToken
        )
      ),
      agenteExiste: Boolean(agente),
      fencingActual,
      versionScopeActual: agente ? String(agente.version_scope_agente) : null,
      versionAutorizacionActual: agente
        ? String(agente.version_autorizacion_agente)
        : null,
      sesionAuditoriaActualId: sesionActualId
    });
  }

  async transicionarConLeaseEnTransaccion(
    lease,
    estado,
    {
      conexion,
      codigoError = null,
      mensajeError = null,
      replayCifradoDisponible = false,
      keyId = null
    } = {}
  ) {
    exigirConexion(conexion);
    const actual = await this.bloquearLeaseVigente(lease, { conexion });
    if (!actual || !TRANSICIONES[actual.estado]?.has(estado)) return null;
    const terminal = ESTADOS_TERMINALES.has(estado);
    const replay = Boolean(replayCifradoDisponible);
    if (replay && estado !== 'respuesta_pendiente') {
      throw new Error('El replay cifrado solo puede señalarse como respuesta pendiente.');
    }
    const [resultado] = await conexion.execute(
      `UPDATE operaciones_sesion_agentes
          SET estado = ?, instancia_id = NULL, lease_token = NULL,
              lease_expira_utc = NULL, replay_cifrado_disponible = ?,
              key_id = ?, ultimo_codigo_error = ?, ultimo_mensaje_error = ?,
              actualizada_en_utc = UTC_TIMESTAMP(3),
              terminada_en_utc = ${terminal ? 'UTC_TIMESTAMP(3)' : 'NULL'}
        WHERE operacion_id = ? AND instancia_id = ? AND lease_token = ?
          AND fencing_token = ? AND lease_expira_utc > UTC_TIMESTAMP(3)`,
      [
        estado,
        replay ? 1 : 0,
        replay ? textoAscii(keyId, 64, 'keyId') : null,
        codigoError ? textoAscii(codigoError, 64, 'codigoError') : null,
        mensajeError ? sanearMensaje(mensajeError) : null,
        uuidV7AuditoriaABytes(lease.operacionId, 'operacionId'),
        textoAscii(lease.instanciaId, 128, 'instanciaId'),
        bufferLease(lease.leaseToken),
        bigintPositivo(lease.fencingToken, 'fencingToken')
      ]
    );
    return Number(resultado.affectedRows) === 1
      ? buscarOperacionPorId(conexion, lease.operacionId)
      : null;
  }

  async reintentarConLeaseEnTransaccion(
    lease,
    { conexion, demoraSegundos = 5, codigoError, mensajeError } = {}
  ) {
    exigirConexion(conexion);
    const actual = await this.bloquearLeaseVigente(lease, { conexion });
    if (!actual) return null;
    const [resultado] = await conexion.execute(
      `UPDATE operaciones_sesion_agentes
          SET proximo_intento_utc = TIMESTAMPADD(SECOND, ?, UTC_TIMESTAMP(3)),
              instancia_id = NULL, lease_token = NULL, lease_expira_utc = NULL,
              ultimo_codigo_error = ?, ultimo_mensaje_error = ?,
              actualizada_en_utc = UTC_TIMESTAMP(3)
        WHERE operacion_id = ? AND instancia_id = ? AND lease_token = ?
          AND fencing_token = ? AND lease_expira_utc > UTC_TIMESTAMP(3)`,
      [
        enteroAcotado(demoraSegundos, 1, 86_400, 'demoraSegundos'),
        textoAscii(codigoError, 64, 'codigoError'),
        sanearMensaje(mensajeError),
        uuidV7AuditoriaABytes(lease.operacionId, 'operacionId'),
        textoAscii(lease.instanciaId, 128, 'instanciaId'),
        bufferLease(lease.leaseToken),
        bigintPositivo(lease.fencingToken, 'fencingToken')
      ]
    );
    return Number(resultado.affectedRows) === 1
      ? buscarOperacionPorId(conexion, lease.operacionId)
      : null;
  }

  async avanzarConLeaseAtomica(
    { operacionId, instanciaId, leaseToken, estado, replayCifradoDisponible = false, keyId = null },
    { codigoError = null, mensajeError = null } = {}
  ) {
    const siguiente = String(estado || '');
    return this.#enTransaccion(async (conexion) => {
      const actual = await buscarOperacionPorId(conexion, operacionId, true);
      if (!actual || !TRANSICIONES[actual.estado]?.has(siguiente)) {
        throw new Error('La transición solicitada no es válida para la operación.');
      }
      const terminal = ESTADOS_TERMINALES.has(siguiente);
      const replay = Boolean(replayCifradoDisponible);
      if (replay && siguiente !== 'respuesta_pendiente') {
        throw new Error('El replay cifrado solo puede señalarse como respuesta pendiente.');
      }
      const [resultado] = await conexion.execute(
        `UPDATE operaciones_sesion_agentes
         SET estado = ?, replay_cifrado_disponible = ?, key_id = ?,
             ultimo_codigo_error = ?, ultimo_mensaje_error = ?,
             instancia_id = NULL, lease_token = NULL, lease_expira_utc = NULL,
             actualizada_en_utc = UTC_TIMESTAMP(3),
             terminada_en_utc = ${terminal ? 'UTC_TIMESTAMP(3)' : 'NULL'}
         WHERE operacion_id = ? AND instancia_id = ? AND lease_token = ?
           AND lease_expira_utc > UTC_TIMESTAMP(3)`,
        [
          siguiente,
          replay ? 1 : 0,
          replay ? textoAscii(keyId, 64, 'keyId') : null,
          codigoError ? textoAscii(codigoError, 64, 'codigoError') : null,
          mensajeError ? sanearMensaje(mensajeError) : null,
          uuidV7AuditoriaABytes(operacionId, 'operacionId'),
          textoAscii(instanciaId, 128, 'instanciaId'),
          bufferHex(leaseToken, 32, 'leaseToken')
        ]
      );
      if (resultado.affectedRows !== 1) {
        throw new Error('El lease ya no autoriza a modificar esta operación.');
      }
      return buscarOperacionPorId(conexion, operacionId);
    });
  }

  async #enTransaccion(trabajo) {
    const conexion = await this.clienteSql.obtenerConexion();
    try {
      await conexion.beginTransaction();
      const resultado = await trabajo(conexion);
      await conexion.commit();
      return resultado;
    } catch (error) {
      await rollbackSeguro(conexion);
      throw error;
    } finally {
      conexion.release();
    }
  }
}

async function insertarOperacion(conexion, entrada, fechaSql) {
  await conexion.execute(
    `INSERT INTO operaciones_sesion_agentes (
       operacion_id, tipo, agente_id, sesion_auditoria_id,
       login_request_id, refresh_request_id, causa_operacion_id,
       huella_intencion, version_scope_observada,
       version_autorizacion_observada, fencing_token,
       actor_tipo, actor_id, actor_efectivo_tipo, actor_efectivo_id,
       modo_actuacion, origen,
       scope_tenant_id, scope_empresa_id, scope_sitio_id,
       estado, proximo_intento_utc, creada_en_utc, actualizada_en_utc
     ) VALUES (
       ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
       'pendiente', ?, ?, ?
     )`,
    [
      entrada.operacionIdBytes,
      entrada.tipo,
      entrada.agenteId,
      entrada.sesionAuditoriaIdBytes,
      entrada.tipo === 'login' ? entrada.requestIdBytes : null,
      entrada.tipo === 'refresh' ? entrada.requestIdBytes : null,
      entrada.causaOperacionIdBytes ?? null,
      entrada.huellaIntencion,
      entrada.versionScopeObservada,
      entrada.versionAutorizacionObservada,
      entrada.fencingToken,
      entrada.actorTipo,
      entrada.actorId,
      entrada.actorEfectivoTipo,
      entrada.actorEfectivoId,
      entrada.modoActuacion,
      entrada.origen,
      entrada.scope.tenantId,
      entrada.scope.empresaId,
      entrada.scope.sitioId,
      fechaSql,
      fechaSql,
      fechaSql
    ]
  );
}

async function bloquearAgente(
  conexion,
  agenteId,
  { permitirAusente = false } = {}
) {
  const [filas] = await conexion.execute(
    `SELECT version_scope_agente, version_autorizacion_agente,
            sesion_auditoria_id
     FROM agentes_sentinelia WHERE id = ? FOR UPDATE`,
    [agenteId]
  );
  if (filas.length !== 1) {
    if (permitirAusente) return null;
    throw new Error('El agente no existe.');
  }
  return filas[0];
}

async function asegurarYBloquearCabecera(conexion, agenteId) {
  await conexion.execute(
    `INSERT IGNORE INTO cabeceras_coordinacion_sesion_agentes (
       agente_id, fencing_token, creada_en_utc, actualizada_en_utc
     ) VALUES (?, 0, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
    [agenteId]
  );
  const [filas] = await conexion.execute(
    `SELECT fencing_token FROM cabeceras_coordinacion_sesion_agentes
     WHERE agente_id = ? FOR UPDATE`,
    [agenteId]
  );
  return String(filas[0].fencing_token);
}

async function incrementarFencing(conexion, agenteId) {
  const [resultado] = await conexion.execute(
    `UPDATE cabeceras_coordinacion_sesion_agentes
     SET fencing_token = fencing_token + 1, actualizada_en_utc = UTC_TIMESTAMP(3)
     WHERE agente_id = ? AND fencing_token < ?`,
    [agenteId, MAX_BIGINT_UNSIGNED.toString()]
  );
  if (resultado.affectedRows !== 1) {
    throw new ContadorSesionAgenteAgotado('fencingToken');
  }
  const [[fila]] = await conexion.execute(
    'SELECT fencing_token FROM cabeceras_coordinacion_sesion_agentes WHERE agente_id = ?',
    [agenteId]
  );
  return String(fila.fencing_token);
}

async function buscarIdentidadPorDigest(conexion, digest, bloquear = false) {
  const [filas] = await conexion.execute(
    `SELECT digest_request_id, request_id, tipo,
            CAST(agente_id AS CHAR) AS agente_id, sesion_auditoria_id,
            huella_intencion, operacion_id,
            DATE_FORMAT(primera_observacion_utc, '%Y-%m-%dT%H:%i:%s.%fZ') AS primera_observacion_utc,
            DATE_FORMAT(expira_en_utc, '%Y-%m-%dT%H:%i:%s.%fZ') AS expira_en_utc
     FROM identidades_request_id_sesion_agentes
     WHERE digest_request_id = ? ${bloquear ? 'FOR UPDATE' : ''}`,
    [digest]
  );
  if (!filas[0]) return null;
  return {
    tipo: filas[0].tipo,
    agenteId: filas[0].agente_id,
    sesionAuditoriaId: filas[0].sesion_auditoria_id
      ? bytesAUuidV7Auditoria(filas[0].sesion_auditoria_id)
      : null,
    huellaIntencion: Buffer.from(filas[0].huella_intencion),
    operacionId: bytesAUuidV7Auditoria(filas[0].operacion_id),
    primeraObservacionUtc: normalizarFecha(filas[0].primera_observacion_utc),
    expiraEnUtc: normalizarFecha(filas[0].expira_en_utc)
  };
}

async function resolverRepeticion(identidad, entrada, conexion) {
  const sujetoCoincide = entrada.tipo === 'login'
    ? identidad.agenteId === entrada.agenteId
    : identidad.sesionAuditoriaId === entrada.sesionAuditoriaId;
  if (
    identidad.tipo !== entrada.tipo ||
    !sujetoCoincide ||
    !identidad.huellaIntencion.equals(entrada.huellaIntencion)
  ) {
    throw new ConflictoRequestSesionAgente(
      'El request id ya está reservado para otra intención técnica.'
    );
  }
  return Object.freeze({
    ...(await buscarOperacionPorId(conexion, identidad.operacionId)),
    repetida: true
  });
}

async function buscarInvalidacion(conexion, entrada, bloquear = false) {
  const [filas] = await conexion.execute(
    `SELECT ${columnasOperacion('o')}
     FROM operaciones_sesion_agentes o
     WHERE o.tipo = 'invalidacion' AND o.causa_operacion_id = ?
       AND o.agente_id = ? AND o.sesion_auditoria_id = ?
     LIMIT 1 ${bloquear ? 'FOR UPDATE' : ''}`,
    [entrada.causaOperacionIdBytes, entrada.agenteId, entrada.sesionAuditoriaIdBytes]
  );
  return filas[0] ? serializarOperacion(filas[0]) : null;
}

function resolverInvalidacionExistente(existente, entrada) {
  if (existente.huellaIntencion !== entrada.huellaIntencion.toString('hex')) {
    throw new ConflictoRequestSesionAgente(
      'La invalidación existente protege otra intención técnica.'
    );
  }
  return Object.freeze({ ...existente, repetida: true });
}

async function buscarOperacionPorId(conexion, operacionId, bloquear = false) {
  const [filas] = await conexion.execute(
    `SELECT ${columnasOperacion('o')}
     FROM operaciones_sesion_agentes o WHERE o.operacion_id = ?
     LIMIT 1 ${bloquear ? 'FOR UPDATE' : ''}`,
    [uuidV7AuditoriaABytes(operacionId, 'operacionId')]
  );
  return filas[0] ? serializarOperacion(filas[0]) : null;
}

function columnasOperacion(a) {
  return `${a}.operacion_id, ${a}.tipo, CAST(${a}.agente_id AS CHAR) AS agente_id,
    ${a}.sesion_auditoria_id, ${a}.login_request_id, ${a}.refresh_request_id,
    ${a}.causa_operacion_id, ${a}.huella_intencion,
    CAST(${a}.version_scope_observada AS CHAR) AS version_scope_observada,
    CAST(${a}.version_autorizacion_observada AS CHAR) AS version_autorizacion_observada,
    CAST(${a}.fencing_token AS CHAR) AS fencing_token,
    ${a}.actor_tipo, ${a}.actor_id,
    ${a}.actor_efectivo_tipo, ${a}.actor_efectivo_id, ${a}.modo_actuacion,
    ${a}.origen,
    CAST(${a}.scope_tenant_id AS CHAR) AS scope_tenant_id,
    CAST(${a}.scope_empresa_id AS CHAR) AS scope_empresa_id,
    CAST(${a}.scope_sitio_id AS CHAR) AS scope_sitio_id,
    ${a}.estado, ${a}.intentos, ${a}.instancia_id,
    ${a}.replay_cifrado_disponible, ${a}.key_id,
    ${a}.ultimo_codigo_error, ${a}.ultimo_mensaje_error,
    DATE_FORMAT(${a}.proximo_intento_utc, '%Y-%m-%dT%H:%i:%s.%fZ') AS proximo_intento_utc,
    DATE_FORMAT(${a}.creada_en_utc, '%Y-%m-%dT%H:%i:%s.%fZ') AS creada_en_utc,
    DATE_FORMAT(${a}.actualizada_en_utc, '%Y-%m-%dT%H:%i:%s.%fZ') AS actualizada_en_utc,
    DATE_FORMAT(${a}.terminada_en_utc, '%Y-%m-%dT%H:%i:%s.%fZ') AS terminada_en_utc`;
}

function serializarOperacion(f) {
  return Object.freeze({
    operacionId: bytesAUuidV7Auditoria(f.operacion_id),
    tipo: f.tipo,
    agenteId: String(f.agente_id),
    sesionAuditoriaId: bytesAUuidV7Auditoria(f.sesion_auditoria_id),
    loginRequestId: f.login_request_id ? bytesAUuidV7Auditoria(f.login_request_id) : null,
    refreshRequestId: f.refresh_request_id ? bytesAUuidV7Auditoria(f.refresh_request_id) : null,
    causaOperacionId: f.causa_operacion_id ? bytesAUuidV7Auditoria(f.causa_operacion_id) : null,
    huellaIntencion: Buffer.from(f.huella_intencion).toString('hex'),
    versionScopeObservada: String(f.version_scope_observada),
    versionAutorizacionObservada: String(f.version_autorizacion_observada),
    fencingToken: String(f.fencing_token),
    actor: Object.freeze({ tipo: f.actor_tipo, id: f.actor_id }),
    actorEfectivo: f.actor_efectivo_tipo
      ? Object.freeze({ tipo: f.actor_efectivo_tipo, id: f.actor_efectivo_id })
      : null,
    modoActuacion: f.modo_actuacion,
    origen: f.origen,
    scope: Object.freeze({
      tenantId: f.scope_tenant_id,
      empresaId: f.scope_empresa_id,
      sitioId: f.scope_sitio_id
    }),
    estado: f.estado,
    intentos: Number(f.intentos),
    instanciaId: f.instancia_id || null,
    replayCifradoDisponible: Boolean(f.replay_cifrado_disponible),
    keyId: f.key_id || null,
    ultimoCodigoError: f.ultimo_codigo_error || null,
    ultimoMensajeError: f.ultimo_mensaje_error || null,
    proximoIntentoUtc: normalizarFecha(f.proximo_intento_utc),
    creadaEnUtc: normalizarFecha(f.creada_en_utc),
    actualizadaEnUtc: normalizarFecha(f.actualizada_en_utc),
    terminadaEnUtc: normalizarFecha(f.terminada_en_utc)
  });
}

function normalizarRequest(datos, ventanaSegundos) {
  const tipo = String(datos.tipo || '');
  if (!['login', 'refresh'].includes(tipo)) throw new Error('tipo debe ser login o refresh.');
  const base = normalizarBase(datos);
  const requestId = tipo === 'login' ? datos.loginRequestId : datos.refreshRequestId;
  const requestIdBytes = uuidV7AuditoriaABytes(requestId, `${tipo}RequestId`);
  return {
    ...base,
    tipo,
    requestId,
    requestIdBytes,
    digestRequestId: calcularDigestRequestIdSesionAgente(requestId),
    ventanaSegundos: enteroAcotado(ventanaSegundos, 1, 86_400, 'ventanaSegundos')
  };
}

function normalizarInvalidacion(datos) {
  return {
    ...normalizarBase(datos),
    tipo: 'invalidacion',
    causaOperacionIdBytes: uuidV7AuditoriaABytes(datos.causaOperacionId, 'causaOperacionId')
  };
}

function normalizarBase(datos) {
  const actorTipo = String(datos.actor?.tipo || '');
  if (!['usuario', 'agente', 'sistema'].includes(actorTipo)) {
    throw new Error('actor.tipo no pertenece al catálogo técnico.');
  }
  const origen = String(datos.origen || '');
  if (!['web', 'api_agentes', 'runtime', 'bootstrap', 'tarea_sistema'].includes(origen)) {
    throw new Error('origen no pertenece al catálogo técnico.');
  }
  const actorEfectivo = datos.actorEfectivo ?? null;
  const modoActuacion = actorEfectivo ? 'impersonado' : 'directo';
  const actorEfectivoTipo = actorEfectivo ? String(actorEfectivo.tipo || '') : null;
  if (actorEfectivo && !['usuario', 'agente', 'sistema'].includes(actorEfectivoTipo)) {
    throw new Error('actorEfectivo.tipo no pertenece al catálogo técnico.');
  }
  return {
    operacionId: datos.operacionId,
    operacionIdBytes: uuidV7AuditoriaABytes(datos.operacionId, 'operacionId'),
    agenteId: idDecimal(datos.agenteId, 'agenteId'),
    sesionAuditoriaId: datos.sesionAuditoriaId,
    sesionAuditoriaIdBytes: uuidV7AuditoriaABytes(datos.sesionAuditoriaId, 'sesionAuditoriaId'),
    huellaIntencion: bufferHex(datos.huellaIntencion, 32, 'huellaIntencion'),
    actorTipo,
    actorId: textoAscii(datos.actor.id, 128, 'actor.id'),
    actorEfectivoTipo,
    actorEfectivoId: actorEfectivo
      ? textoAscii(actorEfectivo.id, 128, 'actorEfectivo.id')
      : null,
    modoActuacion,
    origen,
    scope: normalizarScope(datos.scope)
  };
}

function normalizarScope(scope = {}) {
  const normalizado = {
    tenantId: idNullable(scope.tenantId, 'scope.tenantId'),
    empresaId: idNullable(scope.empresaId, 'scope.empresaId'),
    sitioId: idNullable(scope.sitioId, 'scope.sitioId')
  };
  if (!normalizado.tenantId && (normalizado.empresaId || normalizado.sitioId)) {
    throw new Error('El scope técnico no respeta la jerarquía.');
  }
  if (normalizado.sitioId && !normalizado.empresaId) {
    throw new Error('El scope técnico no respeta la jerarquía.');
  }
  return normalizado;
}

function bufferLease(valor) {
  const buffer = Buffer.isBuffer(valor)
    ? Buffer.from(valor)
    : Buffer.from(String(valor || ''), 'hex');
  if (buffer.length !== 32 || !/^[0-9a-f]{64}$/.test(buffer.toString('hex'))) {
    throw new Error('leaseToken debe contener 32 bytes.');
  }
  return buffer;
}

function bigintPositivo(valor, nombre) {
  const texto = String(valor ?? '');
  if (!/^[1-9][0-9]*$/.test(texto) || BigInt(texto) > MAX_BIGINT_UNSIGNED) {
    throw new Error(`${nombre} debe ser BIGINT UNSIGNED positivo.`);
  }
  return texto;
}

function scopeIgualFila(scope, fila) {
  return String(scope.tenantId ?? '') === String(fila.tenant_id ?? '') &&
    String(scope.empresaId ?? '') === String(fila.empresa_id ?? '') &&
    String(scope.sitioId ?? '') === String(fila.sitio_id ?? '');
}

function idDecimal(valor, nombre) {
  const texto = String(valor ?? '');
  if (!/^[1-9][0-9]*$/.test(texto) || BigInt(texto) > MAX_BIGINT_UNSIGNED) {
    throw new Error(`${nombre} debe ser un id decimal positivo.`);
  }
  return texto;
}

function idNullable(valor, nombre) {
  return valor == null ? null : idDecimal(valor, nombre);
}

function bufferHex(valor, bytes, nombre) {
  if (Buffer.isBuffer(valor) && valor.length === bytes) return Buffer.from(valor);
  const texto = String(valor || '').toLowerCase();
  if (!new RegExp(`^[0-9a-f]{${bytes * 2}}$`).test(texto)) {
    throw new Error(`${nombre} debe contener ${bytes} bytes.`);
  }
  return Buffer.from(texto, 'hex');
}

function textoAscii(valor, maximo, nombre) {
  const texto = String(valor || '').trim();
  if (!texto || Buffer.byteLength(texto, 'ascii') !== texto.length || texto.length > maximo) {
    throw new Error(`${nombre} debe ser texto ASCII no vacío de hasta ${maximo} bytes.`);
  }
  return texto;
}

function enteroAcotado(valor, minimo, maximo, nombre) {
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero < minimo || numero > maximo) {
    throw new Error(`${nombre} queda fuera de rango.`);
  }
  return numero;
}

function normalizarFecha(valor) {
  if (valor == null) return null;
  const texto = String(valor);
  const coincidencia = texto.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\.(\d{3})\d{3}Z$/);
  if (!coincidencia) throw new Error(`Fecha SQL UTC no canónica: ${texto}.`);
  return `${coincidencia[1]}.${coincidencia[2]}Z`;
}

function sanearMensaje(valor) {
  return String(valor || '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\b(bearer|authorization|password|contraseña|cookie|secret|token)\b\s*[:=]?\s*[^,;\s]+/gi, '[dato_sensible]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 512);
}

function exigirConexion(conexion) {
  if (!conexion?.execute) throw new Error('Se requiere una conexión SQL explícita.');
}

async function rollbackSeguro(conexion) {
  try {
    await conexion.rollback();
  } catch {
    // La excepción original conserva prioridad.
  }
}
