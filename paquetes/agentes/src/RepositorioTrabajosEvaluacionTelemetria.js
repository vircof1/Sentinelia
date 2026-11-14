import { createHash } from 'node:crypto';

import { normalizarMarcaUtc } from '../../utilidades/src/fechas/normalizarMarcaUtc.js';

export const CAUSAS_TRABAJO_EVALUACION_TELEMETRIA = Object.freeze({
  OBSERVACION: 'observacion',
  VENCIMIENTO_TEMPORAL: 'vencimiento_temporal',
  RECONCILIACION_ADMINISTRATIVA: 'reconciliacion_administrativa',
  RECONCILIACION_RELOJ: 'reconciliacion_reloj'
});

export const MOTIVOS_NEUTRALIZACION_TRABAJO_TELEMETRIA = Object.freeze({
  REGLA_DESHABILITADA: 'regla_deshabilitada',
  GENERACION_SUSTITUIDA: 'generacion_sustituida',
  REVISION_SUSTITUIDA: 'revision_sustituida',
  OBSERVACION_SUSTITUIDA: 'observacion_sustituida'
});

const CAUSAS_VALIDAS = new Set(Object.values(CAUSAS_TRABAJO_EVALUACION_TELEMETRIA));
const MOTIVOS_NEUTRALIZACION_VALIDOS = new Set(
  Object.values(MOTIVOS_NEUTRALIZACION_TRABAJO_TELEMETRIA)
);

export class TrabajoEvaluacionTelemetriaPersistido {
  constructor(fila = {}) {
    this.id = fila.id;
    this.observacionId = fila.observacion_id;
    this.reglaId = fila.regla_id;
    this.reglaRevisionId = fila.regla_revision_id;
    this.condicionTipoRevision = fila.condicion_tipo_revision || null;
    this.agenteId = fila.agente_id;
    this.senalId = fila.senal_id;
    this.tenantId = fila.tenant_id;
    this.empresaId = fila.empresa_id;
    this.sitioId = fila.sitio_id;
    this.causa = fila.causa || CAUSAS_TRABAJO_EVALUACION_TELEMETRIA.OBSERVACION;
    this.generacionAutoridad = Number(fila.generacion_autoridad || 1);
    this.generacionCorreccion = fila.generacion_correccion == null
      ? null
      : String(fila.generacion_correccion);
    this.recibidoEnUtc = normalizarMarcaUtc(fila.recibido_en_utc);
    this.programadoParaUtc = normalizarMarcaUtc(fila.programado_para_utc);
    this.claveCausalCanonica = fila.clave_causal_canonica || null;
    this.huellaCausalSha256 = normalizarHuellaPersistida(fila.huella_causal_sha256);
    this.estado = fila.estado;
    this.intentos = Number(fila.intentos || 0);
    this.siguienteIntentoUtc = normalizarMarcaUtc(fila.siguiente_intento_utc);
    this.reclamadoPor = fila.reclamado_por || null;
    this.reclamadoEnUtc = normalizarMarcaUtc(fila.reclamado_en_utc);
    this.reclamoExpiraEnUtc = normalizarMarcaUtc(fila.reclamo_expira_en_utc);
    this.ultimoCodigoError = fila.ultimo_codigo_error || null;
    this.ultimoMensajeError = fila.ultimo_mensaje_error || null;
    this.motivoNeutralizacion = fila.motivo_neutralizacion || null;
    this.completadoEnUtc = normalizarMarcaUtc(fila.completado_en_utc);
    this.creadoEnUtc = normalizarMarcaUtc(fila.creado_en_utc);
    this.fechaActualizacion = normalizarMarcaUtc(fila.fecha_actualizacion);
  }

  serializar() {
    return {
      id: this.id,
      observacionId: this.observacionId,
      reglaId: this.reglaId,
      reglaRevisionId: this.reglaRevisionId,
      agenteId: this.agenteId,
      senalId: this.senalId,
      tenantId: this.tenantId,
      empresaId: this.empresaId,
      sitioId: this.sitioId,
      causa: this.causa,
      generacionAutoridad: this.generacionAutoridad,
      generacionCorreccion: this.generacionCorreccion,
      recibidoEnUtc: this.recibidoEnUtc,
      programadoParaUtc: this.programadoParaUtc,
      claveCausalCanonica: this.claveCausalCanonica,
      huellaCausalSha256: this.huellaCausalSha256,
      estado: this.estado,
      intentos: this.intentos,
      siguienteIntentoUtc: this.siguienteIntentoUtc,
      reclamadoPor: this.reclamadoPor,
      reclamadoEnUtc: this.reclamadoEnUtc,
      reclamoExpiraEnUtc: this.reclamoExpiraEnUtc,
      ultimoCodigoError: this.ultimoCodigoError,
      ultimoMensajeError: this.ultimoMensajeError,
      motivoNeutralizacion: this.motivoNeutralizacion,
      completadoEnUtc: this.completadoEnUtc,
      creadoEnUtc: this.creadoEnUtc,
      fechaActualizacion: this.fechaActualizacion
    };
  }
}

export class RepositorioTrabajosEvaluacionTelemetria {
  constructor(clienteSql) {
    this.clienteSql = clienteSql;
  }

  async encolar({
    observacion,
    regla,
    revision,
    causa = CAUSAS_TRABAJO_EVALUACION_TELEMETRIA.OBSERVACION,
    generacionAutoridad = null,
    programadoParaUtc = null,
    generacionCorreccion = null
  } = {}) {
    const datos = normalizarTrabajo({
      observacion,
      regla,
      revision,
      causa,
      generacionAutoridad,
      programadoParaUtc,
      generacionCorreccion
    });

    return this.encolarDatos(datos, this.clienteSql, null);
  }

  async encolarEnTransaccion({
    observacion,
    regla,
    revision,
    causa = CAUSAS_TRABAJO_EVALUACION_TELEMETRIA.OBSERVACION,
    generacionAutoridad = null,
    programadoParaUtc = null,
    generacionCorreccion = null
  } = {}, { conexion } = {}) {
    exigirConexion(conexion);
    const datos = normalizarTrabajo({
      observacion,
      regla,
      revision,
      causa,
      generacionAutoridad,
      programadoParaUtc,
      generacionCorreccion
    });
    return this.encolarDatos(datos, conexion, conexion);
  }

  async encolarAutoridadActualEnTransaccion({
    observacion,
    regla,
    revision,
    causa = CAUSAS_TRABAJO_EVALUACION_TELEMETRIA.OBSERVACION,
    generacionAutoridad = null,
    programadoParaUtc = null,
    generacionCorreccion = null
  } = {}, { conexion } = {}) {
    exigirConexion(conexion);
    const datos = normalizarTrabajo({
      observacion,
      regla,
      revision,
      causa,
      generacionAutoridad,
      programadoParaUtc,
      generacionCorreccion,
      causalidadRevision: 'autoridad_actual'
    });
    return this.encolarDatos(datos, conexion, conexion);
  }

  async encolarDatos(datos, ejecutor, conexion) {
    try {
      const [resultado] = await ejecutar(
        ejecutor,
        construirSqlInsercionTrabajo(),
        [
          datos.observacionId,
          datos.reglaId,
          datos.reglaRevisionId,
          datos.agenteId,
          datos.senalId,
          datos.tenantId,
          datos.empresaId,
          datos.sitioId,
          datos.causa,
          datos.generacionAutoridad,
          datos.generacionCorreccion,
          datos.recibidoEnUtc,
          datos.programadoParaUtc,
          datos.claveCausalCanonica,
          datos.huellaCausalSha256,
          datos.causa,
          datos.siguienteIntentoUtc
        ]
      );
      const trabajo = await this.buscarPorId(resultado.insertId, { conexion });

      return {
        creado: true,
        trabajo
      };
    } catch (error) {
      if (!esErrorDuplicado(error)) {
        throw error;
      }

      return {
        creado: false,
        trabajo: await this.buscarPorHuellaCausal(
          datos.huellaCausalSha256,
          { conexion }
        )
      };
    }
  }

  async bloquearReclamadoEnTransaccion({
    trabajoId,
    reclamadoPor
  } = {}, { conexion } = {}) {
    exigirConexion(conexion);
    const id = normalizarId(trabajoId, 'El trabajo reclamado no es válido.');
    const reclamador = normalizarTexto(
      reclamadoPor,
      160,
      'La identidad de la reclamación es obligatoria.'
    );
    const filas = await consultar(
      conexion,
      `SELECT ${columnasTrabajo('t')}
         FROM trabajos_evaluacion_telemetria t
        WHERE t.id = ?
        LIMIT 1
        FOR UPDATE`,
      [id]
    );
    const trabajo = filas.length > 0
      ? new TrabajoEvaluacionTelemetriaPersistido(filas[0])
      : null;
    if (
      !trabajo ||
      trabajo.estado !== 'procesando' ||
      trabajo.reclamadoPor !== reclamador
    ) {
      throw new Error('La reclamación del trabajo cambió antes de evaluarlo.');
    }
    return trabajo;
  }

  async buscarPorHuellaCausal(huella, { conexion = null } = {}) {
    const huellaNormalizada = normalizarHuellaEntrada(huella);
    const filas = await consultar(
      conexion || this.clienteSql,
      `SELECT ${columnasTrabajo('t')}
         FROM trabajos_evaluacion_telemetria t
        WHERE t.huella_causal_sha256 = ?
        LIMIT 1`,
      [huellaNormalizada]
    );
    return filas.length > 0
      ? new TrabajoEvaluacionTelemetriaPersistido(filas[0])
      : null;
  }

  async buscarPorId(trabajoId, { conexion = null } = {}) {
    const id = normalizarId(trabajoId, 'El trabajo de evaluación no es válido.');
    const filas = await consultar(
      conexion || this.clienteSql,
      `
        SELECT ${columnasTrabajo('t')}
        FROM trabajos_evaluacion_telemetria t
        WHERE t.id = ?
        LIMIT 1
      `,
      [id]
    );

    return filas.length > 0
      ? new TrabajoEvaluacionTelemetriaPersistido(filas[0])
      : null;
  }

  async buscarPorRevisionYObservacion({
    reglaRevisionId,
    observacionId
  } = {}, { conexion = null } = {}) {
    const revisionId = normalizarId(
      reglaRevisionId,
      'La revisión del trabajo de evaluación no es válida.'
    );
    const observacionNormalizada = normalizarId(
      observacionId,
      'La observación del trabajo de evaluación no es válida.'
    );
    const filas = await consultar(
      conexion || this.clienteSql,
      `
        SELECT ${columnasTrabajo('t')}
        FROM trabajos_evaluacion_telemetria t
        WHERE t.regla_revision_id = ?
          AND t.observacion_id = ?
        LIMIT 1
      `,
      [revisionId, observacionNormalizada]
    );

    return filas.length > 0
      ? new TrabajoEvaluacionTelemetriaPersistido(filas[0])
      : null;
  }

  async buscarUltimoPorRegla(reglaId, { conexion = null } = {}) {
    return this.buscarUltimoTrabajoDeRegla(reglaId, {
      conexion,
      soloConError: false
    });
  }

  async buscarUltimoErrorPorRegla(reglaId, { conexion = null } = {}) {
    return this.buscarUltimoTrabajoDeRegla(reglaId, {
      conexion,
      soloConError: true
    });
  }

  async buscarUltimoTrabajoDeRegla(
    reglaId,
    { conexion = null, soloConError = false } = {}
  ) {
    const id = normalizarId(reglaId, 'La regla del trabajo de evaluación no es válida.');
    const filtroError = soloConError
      ? 'AND t.ultimo_codigo_error IS NOT NULL'
      : '';
    const filas = await consultar(
      conexion || this.clienteSql,
      `
        SELECT ${columnasTrabajo('t')}
        FROM trabajos_evaluacion_telemetria t
        WHERE t.regla_id = ?
          ${filtroError}
        ORDER BY t.fecha_actualizacion DESC, t.id DESC
        LIMIT 1
      `,
      [id]
    );

    return filas.length > 0
      ? new TrabajoEvaluacionTelemetriaPersistido(filas[0])
      : null;
  }

  async reclamarSiguientes({
    reclamadoPor,
    limite = 25,
    ttlSegundos = 30
  } = {}) {
    const reclamador = normalizarTexto(
      reclamadoPor,
      160,
      'La identidad de la reclamación es obligatoria.'
    );
    const limiteNormalizado = normalizarEnteroAcotado(
      limite,
      1,
      250,
      'El lote de reclamación debe estar entre 1 y 250.'
    );
    const ttl = normalizarEnteroAcotado(
      ttlSegundos,
      5,
      3600,
      'El TTL de reclamación debe estar entre 5 y 3600 segundos.'
    );
    const conexion = await this.clienteSql.obtenerConexion();

    try {
      await conexion.beginTransaction();
      const [candidatos] = await conexion.execute(
        `
          SELECT id
          FROM trabajos_evaluacion_telemetria
          WHERE (
              estado IN ('pendiente', 'error')
              AND siguiente_intento_utc <= UTC_TIMESTAMP(6)
            )
            OR (
              estado = 'procesando'
              AND reclamo_expira_en_utc <= UTC_TIMESTAMP(6)
            )
          ORDER BY siguiente_intento_utc ASC, id ASC
          LIMIT ?
          FOR UPDATE SKIP LOCKED
        `,
        [limiteNormalizado]
      );
      const ids = candidatos.map((fila) => Number(fila.id));
      if (ids.length === 0) {
        await conexion.commit();
        return [];
      }

      const placeholders = ids.map(() => '?').join(', ');
      await conexion.execute(
        `
          UPDATE trabajos_evaluacion_telemetria
          SET
            estado = 'procesando',
            intentos = intentos + 1,
            reclamado_por = ?,
            reclamado_en_utc = UTC_TIMESTAMP(6),
            reclamo_expira_en_utc = TIMESTAMPADD(
              SECOND,
              ?,
              UTC_TIMESTAMP(6)
            ),
            completado_en_utc = NULL
          WHERE id IN (${placeholders})
        `,
        [reclamador, ttl, ...ids]
      );
      const [filas] = await conexion.execute(
        `
          SELECT ${columnasTrabajo('t')}
          FROM trabajos_evaluacion_telemetria t
          WHERE t.id IN (${placeholders})
          ORDER BY FIELD(t.id, ${placeholders})
        `,
        [...ids, ...ids]
      );
      await conexion.commit();
      return filas.map((fila) => new TrabajoEvaluacionTelemetriaPersistido(fila));
    } catch (error) {
      await conexion.rollback();
      throw error;
    } finally {
      conexion.release();
    }
  }

  async marcarCompletado({ trabajoId, reclamadoPor } = {}, { conexion = null } = {}) {
    const id = normalizarId(trabajoId, 'El trabajo completado no es válido.');
    const reclamador = normalizarTexto(
      reclamadoPor,
      160,
      'La identidad de la reclamación es obligatoria.'
    );
    const [resultado] = await ejecutar(
      conexion || this.clienteSql,
      `
        UPDATE trabajos_evaluacion_telemetria
        SET
          estado = 'completado',
          reclamado_por = NULL,
          reclamado_en_utc = NULL,
          reclamo_expira_en_utc = NULL,
          ultimo_codigo_error = NULL,
          ultimo_mensaje_error = NULL,
          motivo_neutralizacion = NULL,
          completado_en_utc = UTC_TIMESTAMP(6)
        WHERE id = ?
          AND estado = 'procesando'
          AND reclamado_por = ?
      `,
      [id, reclamador]
    );

    if (Number(resultado?.affectedRows) !== 1) {
      throw new Error('La reclamación del trabajo cambió antes de completarlo.');
    }
  }

  async marcarNeutralizado({
    trabajoId,
    reclamadoPor,
    motivo
  } = {}, { conexion = null } = {}) {
    const id = normalizarId(trabajoId, 'El trabajo neutralizado no es válido.');
    const reclamador = normalizarTexto(
      reclamadoPor,
      160,
      'La identidad de la reclamación es obligatoria.'
    );
    const motivoNormalizado = normalizarEnum(
      motivo,
      MOTIVOS_NEUTRALIZACION_VALIDOS,
      'El motivo de neutralización no es válido.'
    );
    const [resultado] = await ejecutar(
      conexion || this.clienteSql,
      `UPDATE trabajos_evaluacion_telemetria
          SET estado = 'neutralizado',
              reclamado_por = NULL,
              reclamado_en_utc = NULL,
              reclamo_expira_en_utc = NULL,
              ultimo_codigo_error = NULL,
              ultimo_mensaje_error = NULL,
              motivo_neutralizacion = ?,
              completado_en_utc = UTC_TIMESTAMP(6)
        WHERE id = ?
          AND estado = 'procesando'
          AND reclamado_por = ?`,
      [motivoNormalizado, id, reclamador]
    );
    if (Number(resultado?.affectedRows) !== 1) {
      throw new Error('La reclamación del trabajo cambió antes de neutralizarlo.');
    }
  }

  async registrarErrorTecnico({
    trabajoId,
    reclamadoPor,
    codigoError,
    mensajeError,
    demoraReintentoSegundos
  } = {}) {
    const id = normalizarId(trabajoId, 'El trabajo con error no es válido.');
    const reclamador = normalizarTexto(
      reclamadoPor,
      160,
      'La identidad de la reclamación es obligatoria.'
    );
    const codigo = normalizarTexto(
      codigoError,
      80,
      'El código del error técnico es obligatorio.'
    );
    const mensaje = normalizarTexto(
      mensajeError,
      1024,
      'El mensaje del error técnico es obligatorio.'
    );
    const demoraReintento = normalizarEnteroAcotado(
      demoraReintentoSegundos,
      1,
      604800,
      'La demora del siguiente intento debe estar entre 1 y 604800 segundos.'
    );
    const [resultado] = await this.clienteSql.ejecutar(
      `
        UPDATE trabajos_evaluacion_telemetria
        SET
          estado = 'error',
          siguiente_intento_utc = TIMESTAMPADD(
            SECOND,
            ?,
            UTC_TIMESTAMP(6)
          ),
          reclamado_por = NULL,
          reclamado_en_utc = NULL,
          reclamo_expira_en_utc = NULL,
          ultimo_codigo_error = ?,
          ultimo_mensaje_error = ?,
          motivo_neutralizacion = NULL,
          completado_en_utc = NULL
        WHERE id = ?
          AND estado = 'procesando'
          AND reclamado_por = ?
      `,
      [demoraReintento, codigo, mensaje, id, reclamador]
    );

    const registrado = Number(resultado?.affectedRows) === 1;
    const trabajo = registrado ? await this.buscarPorId(id) : null;
    return {
      registrado,
      siguienteIntentoUtc: trabajo?.siguienteIntentoUtc || null
    };
  }
}

function normalizarTrabajo({
  observacion,
  regla,
  revision,
  causa,
  generacionAutoridad,
  programadoParaUtc,
  generacionCorreccion,
  causalidadRevision = 'historica_recepcion'
}) {
  const observacionNormalizada = serializarSiProcede(observacion);
  const reglaNormalizada = serializarSiProcede(regla);
  const revisionNormalizada = serializarSiProcede(revision);
  const datos = {
    observacionId: normalizarId(
      observacionNormalizada?.id,
      'La observación del trabajo de evaluación es obligatoria.'
    ),
    reglaId: normalizarId(
      reglaNormalizada?.id,
      'La regla del trabajo de evaluación es obligatoria.'
    ),
    reglaRevisionId: normalizarId(
      revisionNormalizada?.id,
      'La revisión del trabajo de evaluación es obligatoria.'
    ),
    agenteId: normalizarId(
      observacionNormalizada?.agenteId,
      'El agente del trabajo de evaluación es obligatorio.'
    ),
    senalId: normalizarId(
      observacionNormalizada?.senalId,
      'La señal del trabajo de evaluación es obligatoria.'
    ),
    tenantId: normalizarId(
      reglaNormalizada?.tenantId ?? reglaNormalizada?.scope?.tenantId,
      'El tenant del trabajo de evaluación es obligatorio.'
    ),
    empresaId: normalizarId(
      reglaNormalizada?.empresaId ?? reglaNormalizada?.scope?.empresaId,
      'La empresa del trabajo de evaluación es obligatoria.'
    ),
    sitioId: normalizarId(
      reglaNormalizada?.sitioId ?? reglaNormalizada?.scope?.sitioId,
      'El sitio del trabajo de evaluación es obligatorio.'
    ),
    causa: normalizarEnum(
      causa,
      CAUSAS_VALIDAS,
      'La causa del trabajo de evaluación no es válida.'
    ),
    generacionAutoridad: normalizarId(
      generacionAutoridad ?? reglaNormalizada?.generacionAutoridad ?? 1,
      'La generación de autoridad del trabajo no es válida.'
    ),
    recibidoEnUtc: normalizarFechaSql(
      observacionNormalizada?.recibidoEnUtc,
      'La fecha recibida del trabajo de evaluación es obligatoria.'
    )
  };

  datos.programadoParaUtc = datos.causa ===
    CAUSAS_TRABAJO_EVALUACION_TELEMETRIA.VENCIMIENTO_TEMPORAL
    ? normalizarFechaSql(
      programadoParaUtc,
      'El vencimiento temporal exige una fecha programada válida.'
    )
    : null;
  if (
    datos.causa !== CAUSAS_TRABAJO_EVALUACION_TELEMETRIA.VENCIMIENTO_TEMPORAL &&
    programadoParaUtc != null
  ) {
    throw new Error('Solo un vencimiento temporal puede tener fecha programada.');
  }
  datos.siguienteIntentoUtc = datos.programadoParaUtc || datos.recibidoEnUtc;
  if (datos.causa === CAUSAS_TRABAJO_EVALUACION_TELEMETRIA.RECONCILIACION_RELOJ) {
    datos.generacionCorreccion = normalizarEnteroDecimalCanonico(
      generacionCorreccion,
      'La reconciliación de reloj exige una generación de corrección.'
    );
  } else if (generacionCorreccion != null) {
    throw new Error('La generación de corrección solo pertenece al reloj.');
  } else {
    datos.generacionCorreccion = null;
  }

  if (Number(reglaNormalizada?.agenteId) !== datos.agenteId) {
    throw new Error('La regla y la observación pertenecen a agentes distintos.');
  }
  if (Number(reglaNormalizada?.senalId) !== datos.senalId) {
    throw new Error('La regla y la observación pertenecen a señales distintas.');
  }
  if (Number(revisionNormalizada?.reglaId) !== datos.reglaId) {
    throw new Error('La revisión no pertenece a la regla del trabajo de evaluación.');
  }

  if (
    reglaNormalizada?.generacionAutoridad != null &&
    Number(reglaNormalizada.generacionAutoridad) !== datos.generacionAutoridad
  ) {
    throw new Error('La generación del trabajo no coincide con la regla.');
  }

  if (!['historica_recepcion', 'autoridad_actual'].includes(causalidadRevision)) {
    throw new Error('La causalidad de revisión del trabajo no es válida.');
  }
  if (
    causalidadRevision === 'autoridad_actual' &&
    Number(reglaNormalizada?.revisionVigenteId) !== datos.reglaRevisionId
  ) {
    throw new Error('La revisión del trabajo no coincide con la autoridad actual.');
  }
  if (
    causalidadRevision === 'historica_recepcion' &&
    datos.causa === CAUSAS_TRABAJO_EVALUACION_TELEMETRIA.OBSERVACION
  ) {
    const desde = new Date(revisionNormalizada?.vigenteDesdeUtc).getTime();
    const hasta = revisionNormalizada?.vigenteHastaUtc
      ? new Date(revisionNormalizada.vigenteHastaUtc).getTime()
      : null;
    const recibida = datos.recibidoEnUtc.getTime();
    if (!Number.isFinite(desde) || desde > recibida || (hasta != null && recibida >= hasta)) {
      throw new Error('La revisión no era aplicable cuando se recibió la observación.');
    }
  }

  datos.claveCausalCanonica = construirClaveCausalCanonica(datos);
  datos.huellaCausalSha256 = createHash('sha256')
    .update(datos.claveCausalCanonica, 'ascii')
    .digest();

  return datos;
}

function construirSqlInsercionTrabajo() {
  return `
    INSERT INTO trabajos_evaluacion_telemetria (
      observacion_id,
      regla_id,
      regla_revision_id,
      agente_id,
      senal_id,
      tenant_id,
      empresa_id,
      sitio_id,
      causa,
      generacion_autoridad,
      generacion_correccion,
      recibido_en_utc,
      programado_para_utc,
      clave_causal_canonica,
      huella_causal_sha256,
      siguiente_intento_utc
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      IF(
        CAST(? AS BINARY)=CAST('reconciliacion_reloj' AS BINARY),
        UTC_TIMESTAMP(6),
        ?
      ))
  `;
}

function columnasTrabajo(alias) {
  return `
    ${alias}.id,
    ${alias}.observacion_id,
    ${alias}.regla_id,
    ${alias}.regla_revision_id,
    (SELECT revision.condicion_tipo
       FROM revisiones_reglas_derivacion_telemetria revision
      WHERE revision.id = ${alias}.regla_revision_id
      LIMIT 1) AS condicion_tipo_revision,
    ${alias}.agente_id,
    ${alias}.senal_id,
    ${alias}.tenant_id,
    ${alias}.empresa_id,
    ${alias}.sitio_id,
    ${alias}.causa,
    ${alias}.generacion_autoridad,
    ${alias}.generacion_correccion,
    ${alias}.recibido_en_utc,
    ${alias}.programado_para_utc,
    ${alias}.clave_causal_canonica,
    ${alias}.huella_causal_sha256,
    ${alias}.estado,
    ${alias}.intentos,
    ${alias}.siguiente_intento_utc,
    ${alias}.reclamado_por,
    ${alias}.reclamado_en_utc,
    ${alias}.reclamo_expira_en_utc,
    ${alias}.ultimo_codigo_error,
    ${alias}.ultimo_mensaje_error,
    ${alias}.motivo_neutralizacion,
    ${alias}.completado_en_utc,
    ${alias}.creado_en_utc,
    ${alias}.fecha_actualizacion
  `;
}

export function construirClaveCausalCanonica({
  causa,
  reglaId,
  generacionAutoridad,
  reglaRevisionId,
  observacionId,
  programadoParaUtc = null,
  generacionCorreccion = null
} = {}) {
  const partes = [
    'evaluacion_telemetria@1',
    `causa=${normalizarEnum(causa, CAUSAS_VALIDAS, 'La causa causal no es válida.')}`,
    `regla=${normalizarId(reglaId, 'La regla causal no es válida.')}`,
    `generacion=${normalizarId(generacionAutoridad, 'La generación causal no es válida.')}`,
    `revision=${normalizarId(reglaRevisionId, 'La revisión causal no es válida.')}`,
    `observacion=${normalizarId(observacionId, 'La observación causal no es válida.')}`
  ];
  if (causa === CAUSAS_TRABAJO_EVALUACION_TELEMETRIA.VENCIMIENTO_TEMPORAL) {
    partes.push(`programado=${normalizarFechaCanonica(programadoParaUtc)}`);
  }
  if (causa === CAUSAS_TRABAJO_EVALUACION_TELEMETRIA.RECONCILIACION_RELOJ) {
    partes.push(`correccion=${normalizarEnteroDecimalCanonico(
      generacionCorreccion,
      'La generación de corrección causal es obligatoria.'
    )}`);
  }
  return partes.join('|');
}

function serializarSiProcede(valor) {
  return typeof valor?.serializar === 'function' ? valor.serializar() : valor;
}

function normalizarId(valor, mensaje) {
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero <= 0) {
    throw new Error(mensaje);
  }
  return numero;
}

function normalizarFechaSql(valor, mensaje) {
  const fecha = valor instanceof Date ? new Date(valor.getTime()) : new Date(valor);
  if (Number.isNaN(fecha.getTime())) {
    throw new Error(mensaje);
  }
  return fecha;
}

function normalizarFechaCanonica(valor) {
  const fecha = normalizarFechaSql(valor, 'La fecha causal no es válida.');
  return fecha.toISOString();
}

function normalizarHuellaEntrada(valor) {
  if (Buffer.isBuffer(valor) && valor.length === 32) return valor;
  const texto = String(valor ?? '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(texto)) {
    throw new Error('La huella causal SHA-256 no es válida.');
  }
  return Buffer.from(texto, 'hex');
}

function normalizarHuellaPersistida(valor) {
  if (valor == null) return null;
  return normalizarHuellaEntrada(valor).toString('hex');
}

function normalizarEnteroDecimalCanonico(valor, mensaje) {
  const texto = String(valor ?? '');
  if (!/^[1-9][0-9]*$/.test(texto)) throw new Error(mensaje);
  return texto;
}

function normalizarEnum(valor, permitidos, mensaje) {
  const normalizado = String(valor ?? '').trim();
  if (!permitidos.has(normalizado)) throw new Error(mensaje);
  return normalizado;
}

function esErrorDuplicado(error) {
  return error?.code === 'ER_DUP_ENTRY' || Number(error?.errno) === 1062;
}

async function ejecutar(ejecutor, sql, parametros) {
  if (typeof ejecutor.ejecutar === 'function') {
    return ejecutor.ejecutar(sql, parametros);
  }
  return ejecutor.execute(sql, parametros);
}

async function consultar(ejecutor, sql, parametros) {
  if (typeof ejecutor.consultar === 'function') {
    return ejecutor.consultar(sql, parametros);
  }
  const [filas] = await ejecutor.execute(sql, parametros);
  return filas;
}

function exigirConexion(conexion) {
  if (typeof conexion?.execute !== 'function') {
    throw new Error('La operación de trabajos exige una conexión SQL transaccional.');
  }
}

function normalizarTexto(valor, limite, mensaje) {
  const texto = String(valor ?? '').trim();
  if (!texto) {
    throw new Error(mensaje);
  }
  return texto.slice(0, limite);
}

function normalizarEnteroAcotado(valor, minimo, maximo, mensaje) {
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero < minimo || numero > maximo) {
    throw new Error(mensaje);
  }
  return numero;
}
