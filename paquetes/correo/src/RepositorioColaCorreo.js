import { randomBytes, randomUUID } from 'node:crypto';
import { CorreoPendiente } from './CorreoPendiente.js';
import {
  ESTADOS_CAPACIDAD_DESUSCRIPCION_TRIGGER_CORREO,
  PERFIL_INTENTO_SMTP_TRIGGER_CORREO,
  PERFIL_CAPACIDAD_DESUSCRIPCION_TRIGGER_CORREO,
  PERFIL_SALIDA_TRIGGER_CORREO,
  crearCapacidadDesuscripcionTriggerCorreo,
  crearIntentoSmtpTriggerCorreo,
  crearSalidaInicialTriggerCorreo
} from './ContratoTriggerCorreo.js';
import {
  ESTADOS_INTENTO_SMTP_CORREO,
  estadoSalidaDesdeIntentoSmtpCorreo
} from './ContratoSalidaCorreo.js';
import { normalizarMarcaUtc } from '../../utilidades/src/fechas/normalizarMarcaUtc.js';

export const VERSION_PRODUCTOR_SQL_CORREO = 'sql@1';
export const VERSION_PRODUCTOR_LEGACY_CORREO = 'legacy';

export class RepositorioColaCorreo {
  constructor(clienteSql) {
    this.clienteSql = clienteSql;
  }

  // Compatibilidad de API para consumidores aún no migrados. Toda llamada
  // productiva conocida usa ya el nombre explícito crearPendienteLegacy().
  crearPendiente(entrada) {
    return this.crearPendienteLegacy(entrada);
  }

  async crearPendienteLegacy({
    destinatarioEmail,
    destinatarioNombre,
    remitenteEmail,
    remitenteNombre,
    asunto,
    cuerpoTexto,
    creadoPorUsuarioId
  }) {
    const [resultado] = await this.clienteSql.ejecutar(
      `INSERT INTO cola_correos_salida (
         origen_tipo, productor_version,
         destinatario_email, destinatario_nombre,
         remitente_email, remitente_nombre,
         asunto, cuerpo_texto, estado, intentos,
         proximo_intento_en, creado_por_usuario_id
       ) VALUES (
         'prueba', 'legacy', ?, ?, ?, ?, ?, ?,
         'pendiente', 0, UTC_TIMESTAMP(3), ?
       )`,
      [
        destinatarioEmail,
        destinatarioNombre || null,
        remitenteEmail,
        remitenteNombre || null,
        asunto,
        cuerpoTexto,
        creadoPorUsuarioId || null
      ]
    );
    return this.buscarPorId(resultado.insertId);
  }

  async crearPruebaEnTransaccion({
    destinatarioEmail, destinatarioNombre, asunto, cuerpoTexto, creadoPorUsuarioId
  }, { conexion } = {}) {
    await exigirConexionPrestada(conexion, { transaccion: true });
    const [resultado] = await conexion.execute(
      `INSERT INTO cola_correos_salida (
         origen_tipo, productor_version, modo_remitente,
         destinatario_email, destinatario_nombre, asunto, cuerpo_texto,
         smtp_message_id, estado, intentos, proximo_intento_en,
         creado_por_usuario_id
       ) VALUES ('prueba','sql@1','configuracion_actual',?,?,?,?,?,
         'pendiente',0,UTC_TIMESTAMP(3),?)`,
      [destinatarioEmail, destinatarioNombre || null, asunto, cuerpoTexto,
        `<${randomUUID()}@sentinelia.invalid>`, creadoPorUsuarioId || null]
    );
    return this.buscarPorId(resultado.insertId, { conexion });
  }

  async crearSalidaTriggerEnTransaccion({
    notificacionId,
    ejecucionTriggerId,
    buzonCanonico,
    normalizacionBuzonVersion,
    claveBuzonSha256,
    smtpMessageId,
    asunto,
    cuerpoPrivadoTexto,
    creadaEnUtc
  } = {}, { conexion } = {}) {
    await exigirConexionPrestada(conexion, { transaccion: true });
    const salidaValidada = crearSalidaInicialTriggerCorreo({
      perfil: PERFIL_SALIDA_TRIGGER_CORREO,
      version: 1,
      salidaId: '1',
      notificacionId: idDecimal(notificacionId, 'notificacionId'),
      ejecucionTriggerId: idDecimal(ejecucionTriggerId, 'ejecucionTriggerId'),
      buzonCanonico,
      normalizacionBuzonVersion,
      claveBuzonSha256,
      smtpMessageId,
      asunto,
      cuerpoPrivadoTexto,
      estado: 'pendiente',
      intentos: 0,
      creadaEnUtc: fechaUtc(creadaEnUtc, 'creadaEnUtc')
    });
    const [resultado] = await conexion.execute(
      `INSERT INTO cola_correos_salida (
         origen_tipo, productor_version,
         notificacion_trigger_correo_id, ejecucion_trigger_id,
         destinatario_email, destinatario_nombre,
         normalizacion_buzon_version, clave_buzon_sha256,
         modo_remitente, remitente_email, remitente_nombre,
         asunto, cuerpo_texto, smtp_message_id,
         estado, intentos, proximo_intento_en, fecha_creacion
       ) VALUES (
         'trigger', ?, ?, ?, ?, NULL, ?, UNHEX(?),
         'configuracion_actual', NULL, NULL, ?, ?, ?,
         'pendiente', 0, ?, ?
       )`,
      [
        VERSION_PRODUCTOR_SQL_CORREO,
        salidaValidada.notificacionId,
        salidaValidada.ejecucionTriggerId,
        salidaValidada.buzonCanonico,
        salidaValidada.normalizacionBuzonVersion,
        salidaValidada.claveBuzonSha256,
        salidaValidada.asunto,
        salidaValidada.cuerpoPrivadoTexto,
        salidaValidada.smtpMessageId,
        fechaSql(salidaValidada.creadaEnUtc),
        fechaSql(salidaValidada.creadaEnUtc)
      ]
    );
    const salida = await this.buscarPorId(resultado.insertId, { conexion });
    crearSalidaInicialTriggerCorreo({
      ...salidaValidada,
      salidaId: String(salida.id),
      creadaEnUtc: normalizarMarcaUtc(salida.fechaCreacion)
    });
    return salida;
  }

  async buscarPorId(id, { conexion = null } = {}) {
    const filas = await consultar(this.clienteSql, conexion,
      'SELECT * FROM cola_correos_salida WHERE id = ? LIMIT 1',
      [id]
    );
    return filas[0] ? new CorreoPendiente(filas[0]) : null;
  }

  async listarRecientes(limit = 20, { conexion = null } = {}) {
    const filas = await consultar(this.clienteSql, conexion,
      'SELECT * FROM cola_correos_salida ORDER BY id DESC LIMIT ?',
      [limit]
    );
    return filas.map((fila) => new CorreoPendiente(fila));
  }

  listarReclamables(limit = 10) {
    return this.listarReclamablesLegacy(limit);
  }

  async listarReclamablesLegacy(limit = 10) {
    const filas = await this.clienteSql.consultar(
      `SELECT *
         FROM cola_correos_salida
        WHERE productor_version = 'legacy'
          AND estado IN ('pendiente', 'error_reintentable')
          AND (proximo_intento_en IS NULL OR proximo_intento_en <= UTC_TIMESTAMP(3))
        ORDER BY id ASC
        LIMIT ?`,
      [limit]
    );
    return filas.map((fila) => new CorreoPendiente(fila));
  }

  async resumirBacklogDetenido() {
    const filas = await this.clienteSql.consultar(
      `SELECT CASE
                WHEN productor_version = 'legacy' THEN 'legacy'
                ELSE origen_tipo
              END AS origen,
              COUNT(*) AS total,
              MIN(fecha_creacion) AS mas_antigua_utc,
              proposito_recuperacion_password AS proposito
         FROM cola_correos_salida
        WHERE estado IN ('pendiente', 'error_reintentable', 'reclamada', 'enviando')
        GROUP BY CASE
                   WHEN productor_version = 'legacy' THEN 'legacy'
                   ELSE origen_tipo
                 END,
                 proposito_recuperacion_password
        ORDER BY origen ASC, proposito ASC`
    );
    const porOrigen = filas.map((fila) => Object.freeze({
      origen: fila.origen,
      total: Number(fila.total || 0),
      masAntiguaUtc: normalizarMarcaUtc(fila.mas_antigua_utc),
      proposito: fila.proposito || null
    }));
    const total = porOrigen.reduce((suma, entrada) => suma + entrada.total, 0);
    const marcas = porOrigen.map((entrada) => entrada.masAntiguaUtc)
      .filter(Boolean).sort();
    return Object.freeze({
      total,
      masAntiguaUtc: marcas[0] || null,
      porOrigen: Object.freeze(porOrigen)
    });
  }

  async resumirCicloSql() {
    const filas = await this.clienteSql.consultar(`
      SELECT origen_tipo AS origen,
             proposito_recuperacion_password AS proposito,
             clase_emision_email_perfil AS clase_emision_email_perfil,
             estado,causa_descarte,codigo_resultado,respuesta_saneada,
             COUNT(*) AS total
        FROM cola_correos_salida
       WHERE productor_version='sql@1'
       GROUP BY origen_tipo,proposito_recuperacion_password,
                clase_emision_email_perfil,estado,causa_descarte,
                codigo_resultado,respuesta_saneada
       ORDER BY origen_tipo,proposito_recuperacion_password,
                clase_emision_email_perfil,estado,causa_descarte,
                codigo_resultado
    `);
    return Object.freeze(filas.map((fila) => Object.freeze({
      origen: fila.origen,
      proposito: fila.proposito || null,
      claseEmisionEmailPerfil: fila.clase_emision_email_perfil || null,
      estado: fila.estado,
      causaDescarte: fila.causa_descarte || null,
      codigoResultado: fila.codigo_resultado || null,
      respuestaSaneada: fila.respuesta_saneada || null,
      total: Number(fila.total || 0)
    })));
  }

  async reclamarSiguienteTrigger({
    propietarioClaim,
    leaseMilisegundos
  } = {}, { conexion } = {}) {
    return this.reclamarSiguienteSql({
      propietarioClaim,
      leaseMilisegundos,
      origenesTipo: ['trigger']
    }, { conexion });
  }

  async reclamarSiguienteSql({
    propietarioClaim,
    leaseMilisegundos,
    origenesTipo
  } = {}, { conexion } = {}) {
    await exigirConexionPrestada(conexion, { transaccion: true });
    const propietario = propietarioClaimValido(propietarioClaim);
    const leaseMs = enteroEnRango(leaseMilisegundos, 1_000, 86_400_000,
      'leaseMilisegundos');
    const origenes = origenesSql(origenesTipo);
    const marcadoresOrigen = origenes.map(() => '?').join(',');
    const [candidatos] = await conexion.execute(
      `SELECT id, estado, fencing_token
         FROM cola_correos_salida
        WHERE productor_version = ?
          AND origen_tipo IN (${marcadoresOrigen})
          AND estado IN ('pendiente', 'error_reintentable')
          AND (proximo_intento_en IS NULL OR proximo_intento_en <= UTC_TIMESTAMP(3))
        ORDER BY id ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED`,
      [VERSION_PRODUCTOR_SQL_CORREO, ...origenes]
    );
    if (!candidatos[0]) return null;

    const candidato = candidatos[0];
    const claimId = randomBytes(32).toString('hex');
    const leaseToken = randomBytes(32).toString('hex');
    const fencingToken = BigInt(candidato.fencing_token) + 1n;
    const [resultado] = await conexion.execute(
      `UPDATE cola_correos_salida
          SET estado_previo_reclamacion=estado,
              estado='reclamada', claim_id=UNHEX(?), propietario_claim=?,
              lease_token=UNHEX(?),
              reclamada_en_utc=UTC_TIMESTAMP(3),
              lease_expira_utc=TIMESTAMPADD(MICROSECOND, ? * 1000, UTC_TIMESTAMP(3)),
              fencing_token=?
        WHERE id=? AND productor_version=? AND origen_tipo IN (${marcadoresOrigen})
          AND estado IN ('pendiente', 'error_reintentable')`,
      [claimId, propietario, leaseToken, leaseMs, fencingToken.toString(),
        String(candidato.id), VERSION_PRODUCTOR_SQL_CORREO, ...origenes]
    );
    if (Number(resultado.affectedRows) !== 1) {
      throw new Error('La reclamación SQL perdió la fila bloqueada.');
    }
    const [reclamacion] = await conexion.execute(
      `INSERT INTO reclamaciones_correos_salida (
         salida_correo_id, claim_id, fencing_token, propietario_claim,
         estado_previo, estado, reclamada_en_utc, lease_expira_utc
       ) SELECT id, claim_id, fencing_token, propietario_claim,
                estado_previo_reclamacion, 'reclamada', reclamada_en_utc,
                lease_expira_utc
           FROM cola_correos_salida
          WHERE id=?`,
      [String(candidato.id)]
    );
    const salida = await this.buscarPorId(candidato.id, { conexion });
    return Object.freeze({
      reclamacionId: String(reclamacion.insertId),
      salida,
      claimId,
      leaseToken,
      propietarioClaim: propietario,
      fencingToken: fencingToken.toString()
    });
  }

  async liberarReclamacionTrigger({
    salidaId,
    claimId,
    leaseToken,
    propietarioClaim,
    fencingToken,
    codigo
  } = {}, { conexion } = {}) {
    return this.liberarReclamacionSql({
      salidaId,
      claimId,
      leaseToken,
      propietarioClaim,
      fencingToken,
      codigo
    }, { conexion });
  }

  async liberarReclamacionSql({
    salidaId,
    claimId,
    leaseToken,
    propietarioClaim,
    fencingToken,
    codigo
  } = {}, { conexion } = {}) {
    await exigirConexionPrestada(conexion, { transaccion: true });
    const identidad = identidadClaim({
      salidaId, claimId, leaseToken, propietarioClaim, fencingToken
    });
    const codigoSeguro = codigoResultado(codigo);
    const [resultado] = await conexion.execute(
      `UPDATE cola_correos_salida
          SET estado=estado_previo_reclamacion,
              estado_previo_reclamacion=NULL, claim_id=NULL,
              propietario_claim=NULL, lease_token=NULL,
              lease_expira_utc=NULL, reclamada_en_utc=NULL
        WHERE id=? AND productor_version=? AND estado='reclamada'
          AND claim_id=UNHEX(?) AND lease_token=UNHEX(?)
          AND propietario_claim=? AND fencing_token=?
          AND lease_expira_utc > UTC_TIMESTAMP(3)`,
      [identidad.salidaId, VERSION_PRODUCTOR_SQL_CORREO, identidad.claimId,
        identidad.leaseToken, identidad.propietarioClaim, identidad.fencingToken]
    );
    exigirAutoridadClaim(resultado);
    await finalizarReclamacion(conexion, identidad, {
      estado: 'liberada', codigo: codigoSeguro
    });
  }

  iniciarIntentoTrigger(entrada, { conexion } = {}) {
    return this.#iniciarIntentoSql(entrada, { conexion, origen: 'trigger' });
  }

  iniciarIntentoPrueba(entrada, { conexion } = {}) {
    return this.#iniciarIntentoSql(entrada, { conexion, origen: 'prueba' });
  }

  async #iniciarIntentoSql({
    reclamacionId,
    salidaId,
    claimId,
    leaseToken,
    propietarioClaim,
    fencingToken,
    configuracionVersion,
    maxReintentos,
    margenMinimoLeaseMs
  } = {}, { conexion, origen } = {}) {
    await exigirConexionPrestada(conexion, { transaccion: true });
    const identidad = identidadClaim({
      salidaId, claimId, leaseToken, propietarioClaim, fencingToken
    });
    const idReclamacion = idDecimal(reclamacionId, 'reclamacionId');
    const version = idDecimal(configuracionVersion, 'configuracionVersion');
    const maximosAdicionales = enteroEnRango(maxReintentos, 0, 1000, 'maxReintentos');
    const margenMs = enteroEnRango(margenMinimoLeaseMs, 0, 86_400_000,
      'margenMinimoLeaseMs');
    const [filas] = await conexion.execute(
      `SELECT * FROM cola_correos_salida
        WHERE id=? AND productor_version=?
        FOR UPDATE`,
      [identidad.salidaId, VERSION_PRODUCTOR_SQL_CORREO]
    );
    const fila = filas[0];
    exigirFilaClaimVigente(fila, identidad);
    if (fila.origen_tipo !== origen) {
      throw new Error('La procedencia de la salida no corresponde al iniciador.');
    }
    const [capacidades] = origen === 'trigger' ? await conexion.execute(
      `SELECT *, expira_en_utc <= UTC_TIMESTAMP(3) AS expirada
         FROM capacidades_desuscripcion_correo
        WHERE salida_correo_id=?
        LIMIT 1
        FOR UPDATE`,
      [identidad.salidaId]
    ) : [[]];
    const capacidad = capacidades[0];
    if (origen === 'trigger' && !capacidad) {
      throw new Error('La salida SQL no conserva su capacidad de desuscripción.');
    }
    const primerIntento = Number(fila.intentos) === 0;
    if (capacidad && primerIntento !== (capacidad.estado === 'preparada')) {
      throw new Error('El estado de la capacidad no corresponde al historial de intentos.');
    }
    if (capacidad && !primerIntento && Boolean(capacidad.expirada)) {
      await cerrarSinNuevoIntento(conexion, identidad, idReclamacion, {
        codigo: 'desuscripcion_expirada_antes_de_reintento',
        respuesta: 'La capacidad privada expiró antes del siguiente intento SMTP.'
      });
      return Object.freeze({
        iniciado: false,
        estadoSalida: 'error_final',
        codigo: 'desuscripcion_expirada_antes_de_reintento'
      });
    }

    if (Number(fila.intentos) >= 1 + maximosAdicionales) {
      await cerrarSinNuevoIntento(conexion, identidad, idReclamacion, {
        codigo: 'smtp_reintentos_agotados',
        respuesta: 'La política vigente no permite iniciar otro intento SMTP.'
      });
      return Object.freeze({
        iniciado: false,
        estadoSalida: 'error_final',
        codigo: 'smtp_reintentos_agotados'
      });
    }

    const [vigencia] = await conexion.execute(
      `SELECT lease_expira_utc > UTC_TIMESTAMP(3) AS vigente,
              TIMESTAMPDIFF(MICROSECOND, UTC_TIMESTAMP(3), lease_expira_utc)
                AS restante_microsegundos
         FROM cola_correos_salida WHERE id=?`,
      [identidad.salidaId]
    );
    if (!Boolean(vigencia[0]?.vigente) ||
        Number(vigencia[0]?.restante_microsegundos || 0) < margenMs * 1000) {
      throw new Error('La lease SQL no cubre la llamada SMTP que se pretende iniciar.');
    }

    const numero = Number(fila.intentos) + 1;
    if (capacidad && primerIntento) {
      const [emision] = await conexion.execute(
        `UPDATE capacidades_desuscripcion_correo
            SET estado='emitida', emitida_en_utc=UTC_TIMESTAMP(3),
                expira_en_utc=TIMESTAMPADD(DAY, ttl_dias, UTC_TIMESTAMP(3))
          WHERE id=? AND salida_correo_id=? AND estado='preparada'`,
        [String(capacidad.id), identidad.salidaId]
      );
      exigirAutoridadClaim(emision);
    }
    const [actualizacion] = await conexion.execute(
      `UPDATE cola_correos_salida
          SET estado='enviando', intentos=?, enviando_en_utc=UTC_TIMESTAMP(3),
              fecha_ultimo_intento=UTC_TIMESTAMP(3),
              configuracion_version_ultimo_intento=?
        WHERE id=? AND estado='reclamada'
          AND claim_id=UNHEX(?) AND lease_token=UNHEX(?)
          AND propietario_claim=? AND fencing_token=?
          AND lease_expira_utc > UTC_TIMESTAMP(3)`,
      [numero, version, identidad.salidaId, identidad.claimId,
        identidad.leaseToken, identidad.propietarioClaim, identidad.fencingToken]
    );
    exigirAutoridadClaim(actualizacion);
    const [intento] = await conexion.execute(
      `INSERT INTO intentos_correos_salida (
         salida_correo_id, reclamacion_correo_id, perfil_version, numero,
         configuracion_version, smtp_message_id, estado, iniciado_en_utc
       ) SELECT id, ?, 1, ?, ?, smtp_message_id, 'en_curso', UTC_TIMESTAMP(3)
           FROM cola_correos_salida WHERE id=?`,
      [idReclamacion, numero, version, identidad.salidaId]
    );
    const [marca] = await conexion.execute(
      `UPDATE reclamaciones_correos_salida
          SET estado='enviando', enviando_en_utc=UTC_TIMESTAMP(3)
        WHERE id=? AND salida_correo_id=? AND claim_id=UNHEX(?)
          AND fencing_token=? AND estado='reclamada'`,
      [idReclamacion, identidad.salidaId, identidad.claimId, identidad.fencingToken]
    );
    exigirAutoridadClaim(marca);
    const salida = await this.buscarPorId(identidad.salidaId, { conexion });
    if (capacidad) {
      const [capacidadEmitida] = await conexion.execute(
        'SELECT * FROM capacidades_desuscripcion_correo WHERE id=? LIMIT 1',
        [String(capacidad.id)]
      );
      crearCapacidadDesuscripcionTriggerCorreo({
        perfil: PERFIL_CAPACIDAD_DESUSCRIPCION_TRIGGER_CORREO,
        version: Number(capacidadEmitida[0].perfil_version),
        salidaId: identidad.salidaId,
        triggerId: String(capacidadEmitida[0].trigger_id_fotografia),
        tokenHashSha256: Buffer.from(capacidadEmitida[0].token_hash_sha256).toString('hex'),
        ttlDias: Number(capacidadEmitida[0].ttl_dias),
        estado: ESTADOS_CAPACIDAD_DESUSCRIPCION_TRIGGER_CORREO.EMITIDA,
        emitidaEnUtc: normalizarMarcaUtc(capacidadEmitida[0].emitida_en_utc),
        expiraEnUtc: normalizarMarcaUtc(capacidadEmitida[0].expira_en_utc)
      });
    }
    const intentoCreado = crearIntentoSmtpTriggerCorreo({
      perfil: PERFIL_INTENTO_SMTP_TRIGGER_CORREO,
      version: 1,
      intentoId: String(intento.insertId),
      salidaId: identidad.salidaId,
      numero,
      versionConfiguracion: version,
      smtpMessageId: salida.smtpMessageId,
      estado: ESTADOS_INTENTO_SMTP_CORREO.EN_CURSO,
      iniciadoEnUtc: normalizarMarcaUtc(salida.fechaUltimoIntento),
      finalizadoEnUtc: null,
      clasificacion: null,
      codigo: null,
      respuestaSaneada: null
    });
    return Object.freeze({ iniciado: true, salida, intento: intentoCreado });
  }

  async finalizarIntentoTrigger({
    reclamacionId,
    intentoId,
    salidaId,
    claimId,
    leaseToken,
    propietarioClaim,
    fencingToken,
    resultadoIntento,
    reintentoBaseSegundos
  } = {}, { conexion } = {}) {
    return this.finalizarIntentoSql({
      reclamacionId,
      intentoId,
      salidaId,
      claimId,
      leaseToken,
      propietarioClaim,
      fencingToken,
      resultadoIntento,
      reintentoBaseSegundos
    }, { conexion });
  }

  async finalizarIntentoSql({
    reclamacionId,
    intentoId,
    salidaId,
    claimId,
    leaseToken,
    propietarioClaim,
    fencingToken,
    resultadoIntento,
    reintentoBaseSegundos
  } = {}, { conexion } = {}) {
    await exigirConexionPrestada(conexion, { transaccion: true });
    const identidad = identidadClaim({
      salidaId, claimId, leaseToken, propietarioClaim, fencingToken
    });
    const idReclamacion = idDecimal(reclamacionId, 'reclamacionId');
    const idIntento = idDecimal(intentoId, 'intentoId');
    const esperaBase = enteroEnRango(
      reintentoBaseSegundos, 1, 86_400, 'reintentoBaseSegundos'
    );
    const [filas] = await conexion.execute(
      `SELECT s.*, i.numero, i.configuracion_version, i.iniciado_en_utc,
              i.smtp_message_id AS intento_message_id
         FROM cola_correos_salida s
         JOIN intentos_correos_salida i ON i.salida_correo_id=s.id
        WHERE s.id=? AND i.id=? AND i.reclamacion_correo_id=?
        FOR UPDATE`,
      [identidad.salidaId, idIntento, idReclamacion]
    );
    const fila = filas[0];
    exigirFilaClaimVigente(fila, identidad, 'enviando');
    const finalUtc = await obtenerAhoraUtc(conexion);
    const intento = crearIntentoSmtpTriggerCorreo({
      perfil: PERFIL_INTENTO_SMTP_TRIGGER_CORREO,
      version: 1,
      intentoId: idIntento,
      salidaId: identidad.salidaId,
      numero: Number(fila.numero),
      versionConfiguracion: String(fila.configuracion_version),
      smtpMessageId: fila.intento_message_id,
      estado: resultadoIntento?.estado,
      iniciadoEnUtc: normalizarMarcaUtc(fila.iniciado_en_utc),
      finalizadoEnUtc: finalUtc,
      clasificacion: resultadoIntento?.clasificacion,
      codigo: resultadoIntento?.codigo,
      respuestaSaneada: resultadoIntento?.respuestaSaneada
    });
    const estadoSalida = estadoSalidaDesdeIntentoSmtpCorreo(intento.estado);
    const terminal = ['enviado', 'error_final', 'resultado_ambiguo'].includes(estadoSalida);
    const proximo = estadoSalida === 'error_reintentable'
      ? esperaBase * Number(fila.numero)
      : null;
    const [intentoActualizado] = await conexion.execute(
      `UPDATE intentos_correos_salida
          SET estado=?, finalizado_en_utc=UTC_TIMESTAMP(3), clasificacion=?,
              codigo=?, respuesta_saneada=?
        WHERE id=? AND estado='en_curso'`,
      [intento.estado, intento.clasificacion, intento.codigo,
        intento.respuestaSaneada, idIntento]
    );
    exigirAutoridadClaim(intentoActualizado);
    const [salidaActualizada] = await conexion.execute(
      `UPDATE cola_correos_salida
          SET estado=?, error_ultimo=?, codigo_resultado=?, respuesta_saneada=?,
              proximo_intento_en=CASE WHEN ? IS NULL THEN NULL
                ELSE TIMESTAMPADD(SECOND, ?, UTC_TIMESTAMP(3)) END,
              fecha_envio=CASE WHEN ?='enviado' THEN UTC_TIMESTAMP(3) ELSE NULL END,
              fecha_terminal_utc=CASE WHEN ? THEN UTC_TIMESTAMP(3) ELSE NULL END,
              estado_previo_reclamacion=NULL, claim_id=NULL,
              propietario_claim=NULL, lease_token=NULL,
              lease_expira_utc=NULL, reclamada_en_utc=NULL, enviando_en_utc=NULL
        WHERE id=? AND estado='enviando'
          AND claim_id=UNHEX(?) AND lease_token=UNHEX(?)
          AND propietario_claim=? AND fencing_token=?
          AND lease_expira_utc > UTC_TIMESTAMP(3)`,
      [estadoSalida,
        estadoSalida === 'enviado' ? null : intento.respuestaSaneada,
        intento.codigo, intento.respuestaSaneada,
        proximo, proximo, estadoSalida, terminal,
        identidad.salidaId, identidad.claimId, identidad.leaseToken,
        identidad.propietarioClaim, identidad.fencingToken]
    );
    exigirAutoridadClaim(salidaActualizada);
    await finalizarReclamacion(conexion, identidad, {
      estado: estadoSalida === 'resultado_ambiguo' ? 'resultado_ambiguo' : 'finalizada',
      codigo: intento.codigo,
      reclamacionId: idReclamacion
    });
    return Object.freeze({ intento, estadoSalida });
  }

  async reconciliarLeasesExpiradasTrigger({ limite = 50 } = {}, {
    conexion
  } = {}) {
    return this.reconciliarLeasesExpiradasSql({ limite }, { conexion });
  }

  async reconciliarLeasesExpiradasSql({ limite = 50 } = {}, {
    conexion
  } = {}) {
    await exigirConexionPrestada(conexion, { transaccion: true });
    const maximo = enteroEnRango(limite, 1, 500, 'limite');
    const [filas] = await conexion.execute(
      `SELECT * FROM cola_correos_salida
        WHERE productor_version=? AND estado IN ('reclamada', 'enviando')
          AND lease_expira_utc <= UTC_TIMESTAMP(3)
        ORDER BY lease_expira_utc ASC, id ASC
        LIMIT ?
        FOR UPDATE SKIP LOCKED`,
      [VERSION_PRODUCTOR_SQL_CORREO, maximo]
    );
    const restauradas = [];
    const ambiguas = [];
    for (const fila of filas) {
      const identidad = identidadClaimDesdeFila(fila);
      if (fila.estado === 'reclamada') {
        const [actualizada] = await conexion.execute(
          `UPDATE cola_correos_salida
              SET estado=estado_previo_reclamacion,
                  estado_previo_reclamacion=NULL, claim_id=NULL,
                  propietario_claim=NULL, lease_token=NULL,
                  lease_expira_utc=NULL, reclamada_en_utc=NULL
            WHERE id=? AND estado='reclamada' AND claim_id=UNHEX(?)
              AND fencing_token=? AND lease_expira_utc <= UTC_TIMESTAMP(3)`,
          [identidad.salidaId, identidad.claimId, identidad.fencingToken]
        );
        exigirAutoridadClaim(actualizada);
        await finalizarReclamacion(conexion, identidad, {
          estado: 'liberada', codigo: 'lease_expirada_sin_intento'
        });
        restauradas.push(identidad.salidaId);
        continue;
      }

      const [intentos] = await conexion.execute(
        `SELECT i.id
           FROM intentos_correos_salida i
           JOIN reclamaciones_correos_salida r
             ON r.id=i.reclamacion_correo_id
          WHERE i.salida_correo_id=? AND r.claim_id=UNHEX(?)
            AND i.estado='en_curso'
          LIMIT 1
          FOR UPDATE`,
        [identidad.salidaId, identidad.claimId]
      );
      if (!intentos[0]) {
        throw new Error('Una salida enviando expirada no conserva su intento durable.');
      }
      const codigo = 'smtp_resultado_ambiguo_lease_expirada';
      const respuesta =
        'La lease expiró después de cruzar la frontera SMTP; la aceptación es desconocida.';
      const [intento] = await conexion.execute(
        `UPDATE intentos_correos_salida
            SET estado='ambiguo', finalizado_en_utc=UTC_TIMESTAMP(3),
                clasificacion='resultado_ambiguo', codigo=?, respuesta_saneada=?
          WHERE id=? AND estado='en_curso'`,
        [codigo, respuesta, String(intentos[0].id)]
      );
      exigirAutoridadClaim(intento);
      const [actualizada] = await conexion.execute(
        `UPDATE cola_correos_salida
            SET estado='resultado_ambiguo', error_ultimo=?, codigo_resultado=?,
                respuesta_saneada=?, proximo_intento_en=NULL,
                fecha_terminal_utc=UTC_TIMESTAMP(3),
                estado_previo_reclamacion=NULL, claim_id=NULL,
                propietario_claim=NULL, lease_token=NULL,
                lease_expira_utc=NULL, reclamada_en_utc=NULL, enviando_en_utc=NULL
          WHERE id=? AND estado='enviando' AND claim_id=UNHEX(?)
            AND fencing_token=? AND lease_expira_utc <= UTC_TIMESTAMP(3)`,
        [respuesta, codigo, respuesta, identidad.salidaId, identidad.claimId,
          identidad.fencingToken]
      );
      exigirAutoridadClaim(actualizada);
      await finalizarReclamacion(conexion, identidad, {
        estado: 'resultado_ambiguo', codigo
      });
      ambiguas.push(identidad.salidaId);
    }
    return Object.freeze({
      total: filas.length,
      restauradas: Object.freeze(restauradas),
      ambiguas: Object.freeze(ambiguas)
    });
  }

  async registrarEnvioExitoso({ idCorreo, mensajeId, respuestaProveedor }) {
    const [resultado] = await this.clienteSql.ejecutar(
      `UPDATE cola_correos_salida
          SET estado='enviado', intentos=intentos+1, error_ultimo=NULL,
              proximo_intento_en=NULL, fecha_ultimo_intento=UTC_TIMESTAMP(3),
              fecha_envio=UTC_TIMESTAMP(3), fecha_terminal_utc=UTC_TIMESTAMP(3)
        WHERE id=? AND productor_version='legacy'`,
      [idCorreo]
    );
    exigirMutacionLegacy(resultado);
    return { idCorreo, mensajeId, respuestaProveedor };
  }

  async registrarErrorReintentable({ idCorreo, error, proximoIntentoEn }) {
    const [resultado] = await this.clienteSql.ejecutar(
      `UPDATE cola_correos_salida
          SET estado='error_reintentable', intentos=intentos+1,
              error_ultimo=?, proximo_intento_en=?,
              fecha_ultimo_intento=UTC_TIMESTAMP(3)
        WHERE id=? AND productor_version='legacy'`,
      [String(error || '').slice(0, 4000), proximoIntentoEn, idCorreo]
    );
    exigirMutacionLegacy(resultado);
  }

  async registrarErrorFinal({ idCorreo, error }) {
    const [resultado] = await this.clienteSql.ejecutar(
      `UPDATE cola_correos_salida
          SET estado='error_final', intentos=intentos+1,
              error_ultimo=?, proximo_intento_en=NULL,
              fecha_ultimo_intento=UTC_TIMESTAMP(3),
              fecha_terminal_utc=UTC_TIMESTAMP(3)
        WHERE id=? AND productor_version='legacy'`,
      [String(error || '').slice(0, 4000), idCorreo]
    );
    exigirMutacionLegacy(resultado);
  }
}

async function consultar(clienteSql, conexion, sentencia, parametros) {
  if (!conexion) return clienteSql.consultar(sentencia, parametros);
  await exigirConexionPrestada(conexion, { transaccion: false });
  const [filas] = await conexion.execute(sentencia, parametros);
  return filas;
}

async function exigirConexionPrestada(conexion, { transaccion }) {
  if (!conexion?.execute || !conexion?.query) {
    throw new Error('La salida SQL de correo exige una conexión prestada.');
  }
  if (!transaccion) return;
  const [filas] = await conexion.query('SELECT @@in_transaction AS activa');
  if (!Boolean(filas[0]?.activa)) {
    throw new Error('La salida SQL de correo exige una transacción activa.');
  }
}

function idDecimal(valor, campo) {
  const texto = String(valor ?? '');
  if (!/^[1-9][0-9]*$/u.test(texto)) {
    throw new Error(`${campo} debe ser un id decimal positivo canónico.`);
  }
  return texto;
}

function fechaUtc(valor, campo) {
  const texto = String(valor ?? '');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(texto) ||
      Number.isNaN(Date.parse(texto))) {
    throw new Error(`${campo} debe ser una fecha UTC canónica.`);
  }
  return texto;
}

function fechaSql(valor) {
  return valor.slice(0, -1).replace('T', ' ');
}

function exigirMutacionLegacy(resultado) {
  if (Number(resultado?.affectedRows || 0) !== 1) {
    throw new Error('La salida no existe o no pertenece al régimen legacy.');
  }
}

function identidadClaim({ salidaId, claimId, leaseToken, propietarioClaim, fencingToken }) {
  const hash = (valor, campo) => {
    const texto = String(valor ?? '').toLowerCase();
    if (!/^[0-9a-f]{64}$/u.test(texto)) throw new Error(`${campo} no es SHA-256.`);
    return texto;
  };
  return Object.freeze({
    salidaId: idDecimal(salidaId, 'salidaId'),
    claimId: hash(claimId, 'claimId'),
    leaseToken: hash(leaseToken, 'leaseToken'),
    propietarioClaim: propietarioClaimValido(propietarioClaim),
    fencingToken: idDecimal(fencingToken, 'fencingToken')
  });
}

function identidadClaimDesdeFila(fila) {
  return identidadClaim({
    salidaId: String(fila.id),
    claimId: Buffer.from(fila.claim_id || []).toString('hex'),
    leaseToken: Buffer.from(fila.lease_token || []).toString('hex'),
    propietarioClaim: fila.propietario_claim,
    fencingToken: String(fila.fencing_token)
  });
}

function propietarioClaimValido(valor) {
  const texto = String(valor ?? '');
  if (!/^[\x21-\x7e]{1,190}$/u.test(texto)) {
    throw new Error('propietarioClaim debe ser ASCII visible y acotado.');
  }
  return texto;
}

function enteroEnRango(valor, minimo, maximo, campo) {
  const numero = Number(valor);
  if (!Number.isSafeInteger(numero) || numero < minimo || numero > maximo) {
    throw new Error(`${campo} está fuera de rango.`);
  }
  return numero;
}

function codigoResultado(valor) {
  const texto = String(valor ?? '');
  if (!/^[a-z][a-z0-9_]{0,119}$/u.test(texto)) {
    throw new Error('El código de resultado de la reclamación no es válido.');
  }
  return texto;
}

function origenesSql(valores) {
  const admitidos = new Set([
    'prueba',
    'trigger',
    'recuperacion_password',
    'reinicio_password_administrativo',
    'verificacion_email_perfil'
  ]);
  if (!Array.isArray(valores) || valores.length === 0) {
    throw new Error('La reclamación SQL exige al menos una procedencia.');
  }
  const unicos = [...new Set(valores.map(String))];
  if (unicos.length !== valores.length ||
      unicos.some((valor) => !admitidos.has(valor))) {
    throw new Error('La reclamación SQL contiene procedencias incompatibles.');
  }
  return unicos;
}

function exigirAutoridadClaim(resultado) {
  if (Number(resultado?.affectedRows || 0) !== 1) {
    throw new Error('La autoridad SQL del claim ya no está vigente.');
  }
}

function exigirFilaClaimVigente(fila, identidad, estado = 'reclamada') {
  if (!fila || fila.estado !== estado ||
      Buffer.from(fila.claim_id || []).toString('hex') !== identidad.claimId ||
      Buffer.from(fila.lease_token || []).toString('hex') !== identidad.leaseToken ||
      fila.propietario_claim !== identidad.propietarioClaim ||
      String(fila.fencing_token) !== identidad.fencingToken) {
    throw new Error('La autoridad SQL del claim ya no está vigente.');
  }
}

async function finalizarReclamacion(conexion, identidad, {
  estado,
  codigo,
  reclamacionId = null
}) {
  const parametros = [estado, codigoResultado(codigo), identidad.salidaId,
    identidad.claimId, identidad.fencingToken];
  let filtroId = '';
  if (reclamacionId !== null) {
    filtroId = ' AND id=?';
    parametros.push(idDecimal(reclamacionId, 'reclamacionId'));
  }
  const [resultado] = await conexion.execute(
    `UPDATE reclamaciones_correos_salida
        SET estado=?, finalizada_en_utc=UTC_TIMESTAMP(3), codigo_resultado=?
      WHERE salida_correo_id=? AND claim_id=UNHEX(?) AND fencing_token=?
        AND estado IN ('reclamada', 'enviando')${filtroId}`,
    parametros
  );
  exigirAutoridadClaim(resultado);
}

async function cerrarSinNuevoIntento(conexion, identidad, reclamacionId, {
  codigo,
  respuesta
}) {
  const [resultado] = await conexion.execute(
    `UPDATE cola_correos_salida
        SET estado='error_final', error_ultimo=?, codigo_resultado=?,
            respuesta_saneada=?, proximo_intento_en=NULL,
            fecha_terminal_utc=UTC_TIMESTAMP(3),
            estado_previo_reclamacion=NULL, claim_id=NULL,
            propietario_claim=NULL, lease_token=NULL,
            lease_expira_utc=NULL, reclamada_en_utc=NULL
      WHERE id=? AND estado='reclamada' AND claim_id=UNHEX(?)
        AND lease_token=UNHEX(?) AND propietario_claim=? AND fencing_token=?
        AND lease_expira_utc > UTC_TIMESTAMP(3)`,
    [respuesta, codigo, respuesta, identidad.salidaId, identidad.claimId,
      identidad.leaseToken, identidad.propietarioClaim, identidad.fencingToken]
  );
  exigirAutoridadClaim(resultado);
  await finalizarReclamacion(conexion, identidad, {
    estado: 'finalizada', codigo, reclamacionId
  });
}

async function obtenerAhoraUtc(conexion) {
  const [filas] = await conexion.execute('SELECT UTC_TIMESTAMP(3) AS ahora_utc');
  return normalizarMarcaUtc(filas[0].ahora_utc);
}
