import {
  CODIGOS_RESULTADO_ACEPTACION_TRIGGER_CORREO,
  VERSION_RENDERIZADOR_TRIGGER_CORREO,
  crearCapacidadDesuscripcionTriggerCorreo,
  crearDefinicionMensajeTriggerCorreo,
  crearFotografiaCausalTriggerCorreo,
  crearMensajeMaterializadoTriggerCorreo,
  crearResultadoDestinatarioTriggerCorreo
} from './ContratoTriggerCorreo.js';
import {
  ArbolPersistenciaTriggerCorreo,
  CapacidadDesuscripcionCorreo,
  DestinatarioTriggerCorreo,
  NotificacionTriggerCorreo,
  ResultadoDestinatarioTriggerCorreo
} from './EntidadesPersistenciaTriggerCorreo.js';
import { uuidV7AuditoriaABytes }
  from '../../auditoria/src/UuidV7Auditoria.js';

const CODIGOS_ACEPTADOS = Object.freeze([
  CODIGOS_RESULTADO_ACEPTACION_TRIGGER_CORREO.ACEPTADA_COMPLETA,
  CODIGOS_RESULTADO_ACEPTACION_TRIGGER_CORREO.ACEPTADA_PARCIAL
]);

export class RepositorioArbolTriggerCorreoSql {
  constructor(clienteSql = null) {
    this.clienteSql = clienteSql;
  }

  async listarAudienciaEnTransaccion({ triggerId, bloquear = false } = {}, {
    conexion
  } = {}) {
    await exigirConexionPrestada(conexion, { transaccion: bloquear });
    const [filas] = await conexion.execute(`
      SELECT *
        FROM destinatarios_triggers_correo
       WHERE trigger_id = ?
       ORDER BY id ASC${bloquear ? ' FOR UPDATE' : ''}
    `, [idDecimal(triggerId, 'triggerId')]);
    return Object.freeze(filas.map((fila) => new DestinatarioTriggerCorreo(fila)));
  }

  async crearNotificacionEnTransaccion({
    revisionDeclaracion,
    ejecucionTriggerId,
    claveIdempotencia,
    definicionMensaje,
    fotografiaCausal,
    mensajeMaterializado,
    aceptadaEnUtc
  } = {}, { conexion } = {}) {
    await exigirConexionPrestada(conexion, { transaccion: true });
    const revision = idDecimal(revisionDeclaracion, 'revisionDeclaracion');
    const ejecucionId = idDecimal(ejecucionTriggerId, 'ejecucionTriggerId');
    const clave = hashSha256(claveIdempotencia, 'claveIdempotencia');
    const definicion = crearDefinicionMensajeTriggerCorreo(definicionMensaje);
    const fotografia = crearFotografiaCausalTriggerCorreo(fotografiaCausal);
    const mensaje = crearMensajeMaterializadoTriggerCorreo(mensajeMaterializado);
    const aceptada = fechaUtc(aceptadaEnUtc, 'aceptadaEnUtc');
    if (fotografia.ejecucionTriggerId !== ejecucionId ||
        fotografia.claveIdempotencia !== clave ||
        Date.parse(aceptada) < Date.parse(mensaje.renderizadoEnUtc) ||
        Date.parse(aceptada) < Date.parse(fotografia.fechaOcurrenciaUtc)) {
      throw new Error('La notificación no conserva una causa y cronología coherentes.');
    }
    await exigirEjecucionCorreoBloqueada(conexion, { ejecucionId, clave });
    const [resultado] = await conexion.execute(`
      INSERT INTO notificaciones_triggers_correo (
        ejecucion_trigger_id, clave_idempotencia, revision_declaracion,
        trigger_id, trigger_id_fotografia,
        asignacion_trigger_monitor_id, asignacion_id_fotografia,
        monitor_id, monitor_id_fotografia, alerta_auditoria_id,
        evento_disparo, fecha_ocurrencia_utc, valido_desde_utc,
        nombre_monitor, tipo_monitor, estado_monitor, origen_causal,
        codigo_resultado, mensaje_resultado,
        descripcion_fallo, posible_solucion,
        scope_trigger_nivel, scope_trigger_tenant_id,
        scope_trigger_empresa_id, scope_trigger_sitio_id,
        scope_monitor_nivel, scope_monitor_tenant_id,
        scope_monitor_empresa_id, scope_monitor_sitio_id,
        referencia_estado_url, referencia_historico_url,
        definicion_mensaje_version, asunto_plantilla,
        texto_introduccion, texto_cierre,
        renderizador_version, asunto, cuerpo_base_texto, origen_publico,
        renderizado_en_utc, aceptada_en_utc
      ) VALUES (
        ?, UNHEX(?), ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `, [
      ejecucionId, clave, revision,
      fotografia.triggerId, fotografia.triggerId,
      fotografia.asignacionId, fotografia.asignacionId,
      fotografia.monitorId, fotografia.monitorId,
      uuidV7AuditoriaABytes(fotografia.alertaAuditoriaId),
      fotografia.eventoDisparo,
      fechaSql(fotografia.fechaOcurrenciaUtc),
      fechaSql(fotografia.validoDesdeUtc),
      fotografia.nombreMonitor,
      fotografia.tipoMonitor,
      fotografia.estadoMonitor,
      fotografia.origenCausal,
      fotografia.codigoResultado,
      fotografia.mensajeResultado,
      fotografia.contextoHumano.descripcionFallo,
      fotografia.contextoHumano.posibleSolucion,
      fotografia.scopeTrigger.nivel,
      fotografia.scopeTrigger.tenantId,
      fotografia.scopeTrigger.empresaId,
      fotografia.scopeTrigger.sitioId,
      fotografia.scopeMonitor.nivel,
      fotografia.scopeMonitor.tenantId,
      fotografia.scopeMonitor.empresaId,
      fotografia.scopeMonitor.sitioId,
      fotografia.referencias.estadoUrl,
      fotografia.referencias.historicoUrl,
      definicion.version,
      definicion.asuntoPlantilla,
      definicion.textoIntroduccion,
      definicion.textoCierre,
      VERSION_RENDERIZADOR_TRIGGER_CORREO,
      mensaje.asunto,
      mensaje.cuerpoBaseTexto,
      mensaje.origenPublico,
      fechaSql(mensaje.renderizadoEnUtc),
      fechaSql(aceptada)
    ]);
    return this.buscarNotificacionPorIdEnTransaccion(resultado.insertId, {
      conexion
    });
  }

  async crearResultadoEnTransaccion({
    ejecucionTriggerId,
    notificacionId = null,
    resultadoDestinatario
  } = {}, { conexion } = {}) {
    await exigirConexionPrestada(conexion, { transaccion: true });
    const ejecucionId = idDecimal(ejecucionTriggerId, 'ejecucionTriggerId');
    const notificacion = idDecimalOpcional(notificacionId, 'notificacionId');
    const resultado = crearResultadoDestinatarioTriggerCorreo(
      resultadoDestinatario
    );
    await exigirEjecucionCorreoBloqueada(conexion, { ejecucionId });
    if (resultado.salidaId !== null && notificacion === null) {
      throw new Error(
        'Un resultado aceptado exige la notificación que conserva su intención.'
      );
    }
    const [insercion] = await conexion.execute(`
      INSERT INTO resultados_destinatarios_triggers_correo (
        ejecucion_trigger_id, notificacion_trigger_correo_id,
        clave_procedencia, relacion_destinatario_id, tipo,
        usuario_id, usuario_id_fotografia,
        email_manual, email_manual_canonico, normalizacion_buzon_version,
        estado_observado, email_resuelto_canonico, clave_buzon_sha256,
        codigo_inicial, salida_correo_id
      ) VALUES (?, ?, UNHEX(?), ?, ?, ?, ?, ?, ?, ?, ?, ?, UNHEX(?), ?, ?)
    `, [
      ejecucionId,
      notificacion,
      resultado.claveProcedencia,
      resultado.relacionDestinatarioId,
      resultado.tipo,
      resultado.usuarioId,
      resultado.usuarioId,
      resultado.emailManualPresentacion,
      resultado.emailManualCanonico,
      resultado.normalizacionBuzonVersion,
      resultado.estadoObservado,
      resultado.emailResueltoCanonico,
      resultado.claveBuzonSha256,
      resultado.codigoInicial,
      resultado.salidaId
    ]);
    return this.buscarResultadoPorIdEnTransaccion(insercion.insertId, {
      conexion
    });
  }

  async crearCapacidadEnTransaccion(capacidadDesuscripcion, {
    conexion
  } = {}) {
    await exigirConexionPrestada(conexion, { transaccion: true });
    const capacidad = crearCapacidadDesuscripcionTriggerCorreo(
      capacidadDesuscripcion
    );
    const [resultado] = await conexion.execute(`
      INSERT INTO capacidades_desuscripcion_correo (
        salida_correo_id, trigger_id, trigger_id_fotografia,
        perfil_version, token_hash_sha256, ttl_dias,
        estado, emitida_en_utc, expira_en_utc
      ) VALUES (?, ?, ?, ?, UNHEX(?), ?, ?, ?, ?)
    `, [
      capacidad.salidaId,
      capacidad.triggerId,
      capacidad.triggerId,
      capacidad.version,
      capacidad.tokenHashSha256,
      capacidad.ttlDias,
      capacidad.estado,
      fechaSqlOpcional(capacidad.emitidaEnUtc),
      fechaSqlOpcional(capacidad.expiraEnUtc)
    ]);
    return this.buscarCapacidadPorIdEnTransaccion(resultado.insertId, {
      conexion
    });
  }

  async buscarArbolPorEjecucionEnTransaccion({
    ejecucionTriggerId,
    bloquear = false
  } = {}, { conexion } = {}) {
    await exigirConexionPrestada(conexion, { transaccion: bloquear });
    const ejecucionId = idDecimal(ejecucionTriggerId, 'ejecucionTriggerId');
    const sufijo = bloquear ? ' FOR UPDATE' : '';
    const [notificaciones] = await conexion.execute(`
      SELECT * FROM notificaciones_triggers_correo
       WHERE ejecucion_trigger_id = ? LIMIT 1${sufijo}
    `, [ejecucionId]);
    const [resultados] = await conexion.execute(`
      SELECT * FROM resultados_destinatarios_triggers_correo
       WHERE ejecucion_trigger_id = ? ORDER BY id ASC${sufijo}
    `, [ejecucionId]);
    const [capacidades] = await conexion.execute(`
      SELECT DISTINCT c.*
        FROM capacidades_desuscripcion_correo c
        INNER JOIN resultados_destinatarios_triggers_correo r
          ON r.salida_correo_id = c.salida_correo_id
       WHERE r.ejecucion_trigger_id = ?
       ORDER BY c.id ASC${sufijo}
    `, [ejecucionId]);
    return new ArbolPersistenciaTriggerCorreo({
      ejecucionTriggerId: ejecucionId,
      notificacion: notificaciones[0]
        ? new NotificacionTriggerCorreo(notificaciones[0])
        : null,
      resultados: resultados.map(
        (fila) => new ResultadoDestinatarioTriggerCorreo(fila)
      ),
      capacidades: capacidades.map(
        (fila) => new CapacidadDesuscripcionCorreo(fila)
      )
    });
  }

  async diagnosticarIntegridadEjecucionesAceptadas({ limit = 100 } = {}) {
    if (!this.clienteSql?.consultar) {
      throw new Error(
        'El diagnóstico del árbol de correo requiere un cliente SQL.'
      );
    }
    const limite = limiteSeguro(limit);
    const filas = await this.clienteSql.consultar(`
      SELECT * FROM (
        SELECT
          e.id,
          e.estado_ejecucion,
          e.codigo_resultado,
          CASE
            WHEN JSON_UNQUOTE(JSON_EXTRACT(
              e.payload_respuesta, '$.detalle_correo_estado'
            )) = 'purgado' THEN NULL
            WHEN n.id IS NULL THEN 'notificacion_ausente'
            WHEN COUNT(r.id) = 0 THEN 'resultados_ausentes'
            WHEN SUM(r.codigo_inicial = 'aceptado') = 0
              THEN 'salida_aceptada_ausente'
            WHEN COUNT(DISTINCT CASE
                   WHEN r.codigo_inicial = 'aceptado' THEN r.salida_correo_id
                 END) <> COUNT(DISTINCT c.salida_correo_id)
              THEN 'capacidad_aceptada_ausente'
            ELSE NULL
          END AS codigo_integridad
        FROM ejecuciones_triggers e
        LEFT JOIN notificaciones_triggers_correo n
          ON n.ejecucion_trigger_id = e.id
        LEFT JOIN resultados_destinatarios_triggers_correo r
          ON r.ejecucion_trigger_id = e.id
        LEFT JOIN capacidades_desuscripcion_correo c
          ON c.salida_correo_id = r.salida_correo_id
         AND r.codigo_inicial = 'aceptado'
        WHERE e.tipo_trigger = 'correo'
          AND e.estado_ejecucion = 'ok'
          AND e.codigo_resultado IN (?, ?)
        GROUP BY e.id, e.estado_ejecucion, e.codigo_resultado,
                 e.payload_respuesta, n.id
      ) AS diagnostico
      WHERE codigo_integridad IS NOT NULL
      ORDER BY id ASC
      LIMIT ?
    `, [...CODIGOS_ACEPTADOS, limite]);
    return Object.freeze({
      ok: filas.length === 0,
      totalIncompatibles: filas.length,
      limite,
      ejecuciones: Object.freeze(filas.map((fila) => Object.freeze({
        id: idDecimal(fila.id, 'ejecucion.id'),
        estadoEjecucion: fila.estado_ejecucion,
        codigoResultado: fila.codigo_resultado,
        codigoIntegridad: fila.codigo_integridad
      })))
    });
  }

  async exigirIntegridadEjecucionesAceptadas(opciones = {}) {
    const diagnostico = await this.diagnosticarIntegridadEjecucionesAceptadas(
      opciones
    );
    if (!diagnostico.ok) {
      const muestra = diagnostico.ejecuciones.slice(0, 5)
        .map((item) => `#${item.id}:${item.codigoIntegridad}`)
        .join(', ');
      throw Object.assign(
        new Error(
          `Integridad de correo rota: una ejecución aceptada no conserva árbol ni marca de purga (${muestra}).`
        ),
        {
          codigo: 'ejecucion_correo_aceptada_sin_arbol',
          diagnostico
        }
      );
    }
    return diagnostico;
  }

  async buscarNotificacionPorIdEnTransaccion(idNotificacion, { conexion } = {}) {
    await exigirConexionPrestada(conexion, { transaccion: false });
    const [filas] = await conexion.execute(
      'SELECT * FROM notificaciones_triggers_correo WHERE id = ? LIMIT 1',
      [idNotificacion]
    );
    return filas[0] ? new NotificacionTriggerCorreo(filas[0]) : null;
  }

  async buscarResultadoPorIdEnTransaccion(idResultado, { conexion } = {}) {
    await exigirConexionPrestada(conexion, { transaccion: false });
    const [filas] = await conexion.execute(
      'SELECT * FROM resultados_destinatarios_triggers_correo WHERE id = ? LIMIT 1',
      [idResultado]
    );
    return filas[0] ? new ResultadoDestinatarioTriggerCorreo(filas[0]) : null;
  }

  async buscarCapacidadPorIdEnTransaccion(idCapacidad, { conexion } = {}) {
    await exigirConexionPrestada(conexion, { transaccion: false });
    const [filas] = await conexion.execute(
      'SELECT * FROM capacidades_desuscripcion_correo WHERE id = ? LIMIT 1',
      [idCapacidad]
    );
    return filas[0] ? new CapacidadDesuscripcionCorreo(filas[0]) : null;
  }
}

async function exigirEjecucionCorreoBloqueada(conexion, {
  ejecucionId,
  clave = null
}) {
  const [filas] = await conexion.execute(`
    SELECT tipo_trigger, clave_idempotencia, estado_ejecucion
      FROM ejecuciones_triggers
     WHERE id = ? FOR UPDATE
  `, [ejecucionId]);
  const ejecucion = filas[0];
  if (!ejecucion || ejecucion.tipo_trigger !== 'correo' ||
      (clave !== null && ejecucion.clave_idempotencia !== clave) ||
      !['pendiente', 'ejecutando'].includes(ejecucion.estado_ejecucion)) {
    throw new Error(
      'La ejecución bloqueada no admite una intención atómica de correo.'
    );
  }
}

async function exigirConexionPrestada(conexion, { transaccion }) {
  if (!conexion?.execute || !conexion?.query) {
    throw new Error('El árbol de correo exige una conexión SQL prestada.');
  }
  if (!transaccion) return;
  const [filas] = await conexion.query('SELECT @@in_transaction AS activa');
  if (!Boolean(filas[0]?.activa)) {
    throw new Error('El árbol de correo exige una transacción SQL activa.');
  }
}

function idDecimal(valor, campo) {
  const texto = String(valor ?? '');
  if (!/^[1-9][0-9]*$/u.test(texto)) {
    throw new Error(`${campo} no es una identidad decimal positiva.`);
  }
  return texto;
}

function idDecimalOpcional(valor, campo) {
  return valor == null ? null : idDecimal(valor, campo);
}

function hashSha256(valor, campo) {
  const texto = String(valor || '');
  if (!/^[0-9a-f]{64}$/u.test(texto)) {
    throw new Error(`${campo} no es SHA-256 hexadecimal canónico.`);
  }
  return texto;
}

function fechaUtc(valor, campo) {
  if (typeof valor !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(valor) ||
      !Number.isFinite(Date.parse(valor))) {
    throw new Error(`${campo} no es una fecha UTC canónica.`);
  }
  return valor;
}

function fechaSql(valor) {
  return new Date(valor);
}

function fechaSqlOpcional(valor) {
  return valor == null ? null : fechaSql(fechaUtc(valor, 'fecha'));
}

function limiteSeguro(valor) {
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero < 1 || numero > 1000) {
    throw new Error('El límite del diagnóstico de correo no es válido.');
  }
  return numero;
}
