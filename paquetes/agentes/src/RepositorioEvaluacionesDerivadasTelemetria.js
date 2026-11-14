import { normalizarMarcaUtc } from '../../utilidades/src/fechas/normalizarMarcaUtc.js';
import {
  ResultadoEvaluacionRegla,
  RESULTADOS_EVALUACION_REGLA_TELEMETRIA
} from './EventosDerivadosTelemetriaAgentes.js';

export class EstadoActualEvaluacionReglaPersistido {
  constructor(fila = {}) {
    asignarEvaluacionPersistida(this, fila);
    this.fechaCreacion = normalizarMarcaUtc(fila.fecha_creacion);
    this.fechaActualizacion = normalizarMarcaUtc(fila.fecha_actualizacion);
    Object.freeze(this);
  }

  coincide() {
    return this.resultado ===
      RESULTADOS_EVALUACION_REGLA_TELEMETRIA.COINCIDE;
  }

  noCoincide() {
    return this.resultado ===
      RESULTADOS_EVALUACION_REGLA_TELEMETRIA.NO_COINCIDE;
  }

  esNoEvaluable() {
    return this.resultado ===
      RESULTADOS_EVALUACION_REGLA_TELEMETRIA.NO_EVALUABLE;
  }

  serializar() {
    return {
      ...serializarEvaluacionPersistida(this),
      fechaCreacion: this.fechaCreacion,
      fechaActualizacion: this.fechaActualizacion
    };
  }
}

export class EvaluacionReglaTelemetriaPersistida {
  constructor(fila = {}) {
    asignarEvaluacionPersistida(this, fila);
    this.trabajoId = Number(fila.trabajo_id);
    this.causa = fila.causa;
    this.programadoParaUtc = normalizarMarcaUtc(fila.programado_para_utc);
    this.resultadoAnterior = fila.resultado_anterior || null;
    this.ladoAnterior = fila.lado_anterior || null;
    this.momentoUtc = normalizarMarcaUtc(fila.momento_utc);
    this.ahoraUtc = normalizarMarcaUtc(fila.ahora_utc);
    this.desviacionSegundos = fila.desviacion_segundos == null
      ? null
      : String(fila.desviacion_segundos);
    this.creadaEnUtc = normalizarMarcaUtc(fila.creada_en_utc);
    Object.freeze(this);
  }

  serializar() {
    return {
      ...serializarEvaluacionPersistida(this),
      trabajoId: this.trabajoId,
      causa: this.causa,
      programadoParaUtc: this.programadoParaUtc,
      resultadoAnterior: this.resultadoAnterior,
      ladoAnterior: this.ladoAnterior,
      momentoUtc: this.momentoUtc,
      ahoraUtc: this.ahoraUtc,
      desviacionSegundos: this.desviacionSegundos,
      creadaEnUtc: this.creadaEnUtc
    };
  }

  coincide() {
    return this.resultado === RESULTADOS_EVALUACION_REGLA_TELEMETRIA.COINCIDE;
  }
}

export class RepositorioEvaluacionesReglasTelemetria {
  constructor(clienteSql) {
    this.clienteSql = clienteSql;
  }

  async registrar({ trabajo, evaluacion } = {}, { conexion = null } = {}) {
    const datos = normalizarEvaluacionLedger({ trabajo, evaluacion });
    const ejecutor = conexion || this.clienteSql;
    let creado = false;
    try {
      await ejecutar(ejecutor, construirSqlInsertarEvaluacionLedger(),
        construirParametrosEvaluacionLedger(datos));
      creado = true;
    } catch (error) {
      if (!esErrorClaveDuplicada(error)) throw error;
    }
    const persistida = await this.buscarPorTrabajo(datos.trabajoId, { conexion });
    if (!persistida) {
      throw new Error('No se pudo recuperar la evaluación durable persistida.');
    }
    comprobarEvaluacionIdempotente(persistida, datos);
    return { creado, evaluacion: persistida };
  }

  async buscarPorTrabajo(trabajoId, { conexion = null } = {}) {
    const id = normalizarId(trabajoId, 'El trabajo de la evaluación no es válido.');
    const filas = await consultar(
      conexion || this.clienteSql,
      `SELECT ${columnasEvaluacionLedger('e')}
         FROM evaluaciones_reglas_telemetria e
        WHERE e.trabajo_id = ?
        LIMIT 1`,
      [id]
    );
    return filas.length > 0 ? new EvaluacionReglaTelemetriaPersistida(filas[0]) : null;
  }

  async listarPorRegla(reglaId, { limite = 100, conexion = null } = {}) {
    const id = normalizarId(reglaId, 'La regla de las evaluaciones no es válida.');
    const filas = await consultar(
      conexion || this.clienteSql,
      `SELECT ${columnasEvaluacionLedger('e')}
         FROM evaluaciones_reglas_telemetria e
        WHERE e.regla_id = ?
        ORDER BY e.creada_en_utc DESC, e.id DESC
        LIMIT ?`,
      [id, normalizarLimite(limite)]
    );
    return filas.map((fila) => new EvaluacionReglaTelemetriaPersistida(fila));
  }
}

export class EventoDerivadoTelemetriaPersistido {
  constructor(fila = {}) {
    asignarEvaluacionPersistida(this, fila);
    this.creadoEnUtc = normalizarMarcaUtc(fila.creado_en_utc);
    Object.freeze(this);
  }

  serializar() {
    return {
      ...serializarEvaluacionPersistida(this),
      creadoEnUtc: this.creadoEnUtc
    };
  }
}

export class RepositorioEstadoActualEvaluacionReglasTelemetria {
  constructor(clienteSql) {
    this.clienteSql = clienteSql;
  }

  async aplicarResultado(
    resultado,
    { conexion = null, fuenteYaBloqueada = false } = {}
  ) {
    const evaluacion = normalizarResultadoEvaluacion(resultado);
    const ejecutor = conexion || this.clienteSql;
    if (fuenteYaBloqueada && !conexion) {
      throw new Error('La fuente solo puede declararse bloqueada dentro de una transacción.');
    }
    if (conexion && !fuenteYaBloqueada) {
      const autoridad = await bloquearFotografiaFuente(
        conexion,
        evaluacion
      );
      if (!autoridad.fotografiaVigente) {
        return {
          actualizado: false,
          gobiernaEstadoActual: false,
          fuenteVigente: autoridad.fuenteVigente,
          fotografiaVigente: false,
          estado: await this.buscarPorRegla(evaluacion.reglaId, { conexion })
        };
      }
    }
    const [operacion] = await ejecutar(
      ejecutor,
      construirSqlAplicarEstadoActual(evaluacion.evaluacionId != null),
      construirParametrosEstadoActual(evaluacion)
    );
    const estado = await this.buscarPorRegla(evaluacion.reglaId, { conexion });

    return {
      actualizado: Number(operacion?.affectedRows) > 0,
      gobiernaEstadoActual:
        (evaluacion.evaluacionId != null
          ? estado?.evaluacionId === evaluacion.evaluacionId
          : estado?.observacionId === evaluacion.observacionId &&
            estado?.revisionId === evaluacion.revisionId),
      fuenteVigente: true,
      fotografiaVigente: true,
      estado
    };
  }

  async buscarPorRegla(
    reglaId,
    { conexion = null, bloquear = false } = {}
  ) {
    const id = normalizarId(reglaId, 'La regla del estado evaluado no es válida.');
    if (bloquear && !conexion) {
      throw new Error('El bloqueo del estado evaluado exige una transacción SQL.');
    }
    const filas = await consultar(
      conexion || this.clienteSql,
      `
        SELECT ${columnasEvaluacion('e')},
          e.fecha_creacion,
          e.fecha_actualizacion
        FROM estado_actual_evaluacion_reglas_telemetria e
        WHERE e.regla_id = ?
        LIMIT 1${bloquear ? ' FOR UPDATE' : ''}
      `,
      [id]
    );
    return filas.length > 0
      ? new EstadoActualEvaluacionReglaPersistido(filas[0])
      : null;
  }

  async buscarProgramacionGobernantePorRegla(reglaId, { conexion = null } = {}) {
    const id = normalizarId(reglaId, 'La regla de la programación no es válida.');
    const filas = await consultar(
      conexion || this.clienteSql,
      `SELECT ${columnasEvaluacion('e')},
              e.fecha_creacion,
              e.fecha_actualizacion
         FROM estado_actual_evaluacion_reglas_telemetria e
         INNER JOIN reglas_derivacion_telemetria r
           ON r.id = e.regla_id
          AND r.estado = 'activa'
          AND r.generacion_autoridad = e.generacion_autoridad
          AND r.revision_vigente_id = e.regla_revision_id
         INNER JOIN estado_actual_telemetria_agentes f
           ON f.agente_id = e.agente_id
          AND f.senal_id = e.senal_id
          AND f.ultima_observacion_id = e.observacion_id
        WHERE e.regla_id = ?
          AND e.causalidad_revision = 'autoridad_actual'
        LIMIT 1`,
      [id]
    );
    return filas.length > 0
      ? new EstadoActualEvaluacionReglaPersistido(filas[0])
      : null;
  }

  async bloquearPorSenalesEnTransaccion({
    agenteId,
    senalIds = []
  } = {}, { conexion } = {}) {
    exigirConexion(conexion);
    const agente = normalizarId(
      agenteId,
      'El agente de los estados derivados no es válido.'
    );
    const ids = normalizarIdsUnicos(senalIds, 'senalIds');
    if (ids.length === 0) return [];
    const filas = await consultar(
      conexion,
      `
        SELECT ${columnasEvaluacion('e')},
          e.fecha_creacion,
          e.fecha_actualizacion
        FROM estado_actual_evaluacion_reglas_telemetria e
        WHERE e.agente_id = ?
          AND e.senal_id IN (${ids.map(() => '?').join(', ')})
        ORDER BY e.regla_id ASC
        FOR UPDATE
      `,
      [agente, ...ids]
    );
    return filas.map((fila) => new EstadoActualEvaluacionReglaPersistido(fila));
  }

  async eliminarBloqueadosEnTransaccion({
    agenteId,
    reglaIds = []
  } = {}, { conexion } = {}) {
    exigirConexion(conexion);
    const agente = normalizarId(
      agenteId,
      'El agente de los estados derivados no es válido.'
    );
    const ids = normalizarIdsUnicos(reglaIds, 'reglaIds');
    if (ids.length === 0) return 0;
    const [resultado] = await ejecutar(
      conexion,
      `DELETE FROM estado_actual_evaluacion_reglas_telemetria
        WHERE agente_id = ?
          AND regla_id IN (${ids.map(() => '?').join(', ')})`,
      [agente, ...ids]
    );
    const eliminados = Number(resultado.affectedRows || 0);
    if (eliminados !== ids.length) {
      throw new Error(
        'Los estados derivados bloqueados cambiaron durante su retirada.'
      );
    }
    return eliminados;
  }
}

export class RepositorioEventosDerivadosTelemetria {
  constructor(clienteSql) {
    this.clienteSql = clienteSql;
  }

  async insertarSiCoincide(resultado, { conexion = null } = {}) {
    const evaluacion = normalizarResultadoEvaluacion(resultado);
    if (evaluacion.resultado !== RESULTADOS_EVALUACION_REGLA_TELEMETRIA.COINCIDE) {
      return {
        creado: false,
        motivo: 'resultado_no_coincidente',
        evento: null
      };
    }

    const ejecutor = conexion || this.clienteSql;
    const existente = await this.buscarPorEvaluacion({
      evaluacionId: evaluacion.evaluacionId,
      reglaId: evaluacion.reglaId,
      revisionId: evaluacion.revisionId,
      observacionId: evaluacion.observacionId
    }, { conexion });
    if (existente) {
      return { creado: false, motivo: 'evento_ya_existente', evento: existente };
    }
    let creado = false;
    try {
      await ejecutar(
        ejecutor,
        construirSqlInsertarEvento(evaluacion.evaluacionId != null),
        construirParametrosEvento(evaluacion)
      );
      creado = true;
    } catch (error) {
      if (!esErrorClaveDuplicada(error)) {
        throw error;
      }
    }

    const evento = await this.buscarPorEvaluacion(
      {
        evaluacionId: evaluacion.evaluacionId,
        reglaId: evaluacion.reglaId,
        revisionId: evaluacion.revisionId,
        observacionId: evaluacion.observacionId
      },
      { conexion }
    );
    if (!evento) {
      throw new Error('No se pudo recuperar el evento derivado persistido.');
    }

    return {
      creado,
      motivo: creado ? 'evento_creado' : 'evento_ya_existente',
      evento
    };
  }

  async buscarPorEvaluacion({
    evaluacionId = null,
    reglaId,
    revisionId,
    observacionId
  } = {}, { conexion = null } = {}) {
    const ids = normalizarIdentidadEvaluacion({
      evaluacionId,
      reglaId,
      revisionId,
      observacionId
    });
    const filas = await consultar(
      conexion || this.clienteSql,
      `
        SELECT ${columnasEvaluacion('e')},
          e.creado_en_utc
        FROM eventos_derivados_telemetria e
        WHERE ${ids.evaluacionId == null
          ? `e.evaluacion_id IS NULL
             AND e.regla_id = ?
             AND e.regla_revision_id = ?
             AND e.observacion_id = ?`
          : 'e.evaluacion_id = ?'}
        LIMIT 1
      `,
      ids.evaluacionId == null
        ? [ids.reglaId, ids.revisionId, ids.observacionId]
        : [ids.evaluacionId]
    );
    return filas.length > 0
      ? new EventoDerivadoTelemetriaPersistido(filas[0])
      : null;
  }

  async listarPorRegla(reglaId, { limite = 100 } = {}) {
    const id = normalizarId(reglaId, 'La regla de los eventos no es válida.');
    const limiteNormalizado = normalizarLimite(limite);
    const filas = await this.clienteSql.consultar(
      `
        SELECT ${columnasEvaluacion('e')},
          e.creado_en_utc
        FROM eventos_derivados_telemetria e
        WHERE e.regla_id = ?
        ORDER BY e.observado_en_utc DESC, e.observacion_id DESC, e.id DESC
        LIMIT ?
      `,
      [id, limiteNormalizado]
    );
    return filas.map((fila) => new EventoDerivadoTelemetriaPersistido(fila));
  }
}

function construirSqlAplicarEstadoActual(durable = false) {
  if (!durable) return construirSqlAplicarEstadoActualHistorico();
  const tablaDestino = 'estado_actual_evaluacion_reglas_telemetria';
  const condicionHistorica =
    `(VALUES(observado_en_utc) > ${tablaDestino}.observado_en_utc OR ` +
    `(VALUES(observado_en_utc) = ${tablaDestino}.observado_en_utc ` +
    `AND VALUES(observacion_id) > ${tablaDestino}.observacion_id))`;
  const condicionAutoridad =
    `(VALUES(generacion_autoridad) > ${tablaDestino}.generacion_autoridad OR ` +
    `(VALUES(generacion_autoridad) = ${tablaDestino}.generacion_autoridad ` +
    `AND VALUES(evaluacion_id) > COALESCE(${tablaDestino}.evaluacion_id, 0)))`;
  const condicionActualizacion =
    `((VALUES(causalidad_revision) = 'autoridad_actual' AND ${condicionAutoridad}) OR ` +
    `(VALUES(causalidad_revision) = 'historica_recepcion' AND ${condicionHistorica}))`;
  const columnasActualizables = [
    'regla_revision_id',
    'agente_id',
    'senal_id',
    'tenant_id',
    'empresa_id',
    'sitio_id',
    'resultado',
    'lado_atencion',
    'codigo_motivo',
    'explicacion',
    'condicion_canonica',
    'valor_evaluado',
    'tipo_dato',
    'unidad',
    'calidad',
    'severidad_calculada',
    'mensaje_operativo',
    'evidencia_contextual',
    'recibido_en_utc',
    'evaluado_en_utc',
    'proxima_reevaluacion_utc',
    // MariaDB/MySQL evalúan ON DUPLICATE KEY UPDATE de izquierda a derecha.
    // Toda columna leída por las condiciones de gobierno debe cambiar después
    // del payload; de otro modo la propia sentencia invalida su condición a
    // mitad de la actualización y deja un estado híbrido.
    'causalidad_revision',
    'evaluacion_id',
    'generacion_autoridad',
    'observacion_id',
    'observado_en_utc'
  ];
  const actualizaciones = columnasActualizables
    .map((columna) =>
      `${columna} = CASE WHEN ${condicionActualizacion} ` +
      `THEN VALUES(${columna}) ELSE ${tablaDestino}.${columna} END`
    )
    .join(',\n          ');

  return `
    INSERT INTO estado_actual_evaluacion_reglas_telemetria (
      evaluacion_id,
      generacion_autoridad,
      causalidad_revision,
      regla_id,
      regla_revision_id,
      observacion_id,
      agente_id,
      senal_id,
      tenant_id,
      empresa_id,
      sitio_id,
      resultado,
      lado_atencion,
      codigo_motivo,
      explicacion,
      condicion_canonica,
      valor_evaluado,
      tipo_dato,
      unidad,
      calidad,
      severidad_calculada,
      mensaje_operativo,
      evidencia_contextual,
      observado_en_utc,
      recibido_en_utc,
      evaluado_en_utc
      ,proxima_reevaluacion_utc
    )
    SELECT
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    FROM estado_actual_telemetria_agentes fuente
    WHERE fuente.agente_id = ?
      AND fuente.senal_id = ?
      AND fuente.ultima_observacion_id = ?
      AND fuente.observado_en_utc = ?
    ON DUPLICATE KEY UPDATE
      ${actualizaciones}
  `;
}

function construirSqlAplicarEstadoActualHistorico() {
  const tablaDestino = 'estado_actual_evaluacion_reglas_telemetria';
  const condicionActualizacion =
    `(VALUES(observado_en_utc) > ${tablaDestino}.observado_en_utc OR ` +
    `(VALUES(observado_en_utc) = ${tablaDestino}.observado_en_utc ` +
    `AND VALUES(observacion_id) > ${tablaDestino}.observacion_id))`;
  const columnasActualizables = [
    'regla_revision_id', 'agente_id', 'senal_id', 'tenant_id', 'empresa_id',
    'sitio_id', 'resultado', 'codigo_motivo', 'explicacion',
    'condicion_canonica', 'valor_evaluado', 'tipo_dato', 'unidad', 'calidad',
    'severidad_calculada', 'mensaje_operativo', 'evidencia_contextual',
    'recibido_en_utc', 'evaluado_en_utc', 'observacion_id', 'observado_en_utc'
  ];
  const actualizaciones = columnasActualizables.map((columna) =>
    `${columna} = CASE WHEN ${condicionActualizacion} ` +
    `THEN VALUES(${columna}) ELSE ${tablaDestino}.${columna} END`
  ).join(',\n          ');
  return `INSERT INTO estado_actual_evaluacion_reglas_telemetria (
      regla_id, regla_revision_id, observacion_id, agente_id, senal_id,
      tenant_id, empresa_id, sitio_id, resultado, codigo_motivo, explicacion,
      condicion_canonica, valor_evaluado, tipo_dato, unidad, calidad,
      severidad_calculada, mensaje_operativo, evidencia_contextual,
      observado_en_utc, recibido_en_utc, evaluado_en_utc
    )
    SELECT ${Array.from({ length: 22 }, () => '?').join(', ')}
    FROM estado_actual_telemetria_agentes fuente
    WHERE fuente.agente_id = ?
      AND fuente.senal_id = ?
      AND fuente.ultima_observacion_id = ?
      AND fuente.observado_en_utc = ?
    ON DUPLICATE KEY UPDATE ${actualizaciones}`;
}

async function bloquearFotografiaFuente(conexion, evaluacion) {
  exigirConexion(conexion);
  const agentes = await consultar(
    conexion,
    `
      SELECT id
      FROM agentes_sentinelia
      WHERE id = ?
      LIMIT 1
      FOR UPDATE
    `,
    [evaluacion.agenteId]
  );
  if (agentes.length === 0) {
    return Object.freeze({ fuenteVigente: false, fotografiaVigente: false });
  }
  const filas = await consultar(
    conexion,
    `
      SELECT id
      FROM estado_actual_telemetria_agentes
      WHERE agente_id = ?
        AND senal_id = ?
        AND ultima_observacion_id = ?
        AND observado_en_utc = ?
      LIMIT 1
      FOR UPDATE
    `,
    [
      evaluacion.agenteId,
      evaluacion.senalId,
      evaluacion.observacionId,
      new Date(evaluacion.observadoEnUtc)
    ]
  );
  return Object.freeze({
    fuenteVigente: true,
    fotografiaVigente: filas.length > 0
  });
}

function exigirConexion(conexion) {
  if (typeof conexion?.execute !== 'function') {
    throw new Error('La proyección derivada exige una transacción SQL.');
  }
}

function normalizarIdsUnicos(valores, campo) {
  if (!Array.isArray(valores)) {
    throw new TypeError(`${campo} debe ser una lista.`);
  }
  return [...new Set(valores.map((valor) => normalizarId(
    valor,
    `${campo} contiene una identidad inválida.`
  )))];
}

function construirSqlInsertarEvento(durable = false) {
  if (!durable) return construirSqlInsertarEventoHistorico();
  return `
    INSERT INTO eventos_derivados_telemetria (
      evaluacion_id,
      generacion_autoridad,
      causalidad_revision,
      regla_id,
      regla_revision_id,
      observacion_id,
      agente_id,
      senal_id,
      tenant_id,
      empresa_id,
      sitio_id,
      resultado,
      lado_atencion,
      codigo_motivo,
      explicacion,
      condicion_canonica,
      valor_evaluado,
      tipo_dato,
      unidad,
      calidad,
      severidad_calculada,
      mensaje_operativo,
      evidencia_contextual,
      observado_en_utc,
      recibido_en_utc,
      evaluado_en_utc,
      proxima_reevaluacion_utc
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
}

function construirSqlInsertarEventoHistorico() {
  return `INSERT INTO eventos_derivados_telemetria (
      regla_id, regla_revision_id, observacion_id, agente_id, senal_id,
      tenant_id, empresa_id, sitio_id, resultado, codigo_motivo, explicacion,
      condicion_canonica, valor_evaluado, tipo_dato, unidad, calidad,
      severidad_calculada, mensaje_operativo, evidencia_contextual,
      observado_en_utc, recibido_en_utc, evaluado_en_utc
    ) VALUES (${Array.from({ length: 22 }, () => '?').join(', ')})`;
}

function construirParametrosEstadoActual(evaluacion) {
  return [
    ...construirParametrosEvaluacion(evaluacion),
    evaluacion.agenteId,
    evaluacion.senalId,
    evaluacion.observacionId,
    new Date(evaluacion.observadoEnUtc)
  ];
}

function construirParametrosEvento(evaluacion) {
  return construirParametrosEvaluacion(evaluacion);
}

function construirParametrosEvaluacion(evaluacion) {
  const comunes = [
    evaluacion.reglaId,
    evaluacion.revisionId,
    evaluacion.observacionId,
    evaluacion.agenteId,
    evaluacion.senalId,
    evaluacion.tenantId,
    evaluacion.empresaId,
    evaluacion.sitioId,
    evaluacion.resultado,
    evaluacion.codigoMotivo,
    evaluacion.explicacion,
    evaluacion.condicionCanonica,
    JSON.stringify(evaluacion.valorEvaluado),
    evaluacion.tipoDato,
    evaluacion.unidad || '',
    evaluacion.calidad,
    evaluacion.severidadCalculada,
    evaluacion.mensajeOperativo,
    evaluacion.evidenciaContextual == null
      ? null
      : JSON.stringify(evaluacion.evidenciaContextual),
    new Date(evaluacion.observadoEnUtc),
    new Date(evaluacion.recibidoEnUtc),
    new Date(evaluacion.evaluadoEnUtc)
  ];
  if (evaluacion.evaluacionId == null) return comunes;
  return [
    evaluacion.evaluacionId,
    evaluacion.generacionAutoridad,
    evaluacion.causalidadRevision,
    ...comunes.slice(0, 9),
    evaluacion.ladoAtencion,
    ...comunes.slice(9),
    evaluacion.proximaReevaluacionUtc
      ? new Date(evaluacion.proximaReevaluacionUtc)
      : null
  ];
}

function normalizarResultadoEvaluacion(resultado) {
  if (
    !(resultado instanceof ResultadoEvaluacionRegla) &&
    !(resultado instanceof EvaluacionReglaTelemetriaPersistida)
  ) {
    throw new Error('El resultado de evaluación que se desea persistir no es válido.');
  }
  const serializada = resultado.serializar();
  return {
    ...serializada,
    evaluacionId: serializada.id || null,
    generacionAutoridad: serializada.generacionAutoridad || 1,
    causalidadRevision: serializada.causalidadRevision || 'historica_recepcion',
    ladoAtencion: serializada.ladoAtencion || null,
    proximaReevaluacionUtc: serializada.proximaReevaluacionUtc || null
  };
}

function asignarEvaluacionPersistida(destino, fila) {
  destino.id = Number(fila.id);
  destino.evaluacionId = fila.evaluacion_id == null
    ? null
    : Number(fila.evaluacion_id);
  destino.generacionAutoridad = Number(fila.generacion_autoridad || 1);
  destino.causalidadRevision = fila.causalidad_revision || 'historica_recepcion';
  destino.reglaId = Number(fila.regla_id);
  destino.revisionId = Number(fila.regla_revision_id);
  destino.observacionId = Number(fila.observacion_id);
  destino.agenteId = Number(fila.agente_id);
  destino.senalId = Number(fila.senal_id);
  destino.tenantId = Number(fila.tenant_id);
  destino.empresaId = Number(fila.empresa_id);
  destino.sitioId = Number(fila.sitio_id);
  destino.resultado = fila.resultado;
  destino.ladoAtencion = fila.lado_atencion || null;
  destino.codigoMotivo = fila.codigo_motivo;
  destino.explicacion = fila.explicacion;
  destino.condicionCanonica = serializarCanonicaPersistida(
    fila.condicion_canonica
  );
  destino.valorEvaluado = congelarJson(
    parsearJsonPersistido(fila.valor_evaluado)
  );
  destino.tipoDato = fila.tipo_dato;
  destino.unidad = fila.unidad || null;
  destino.calidad = fila.calidad;
  destino.severidadCalculada = fila.severidad_calculada || null;
  destino.mensajeOperativo = fila.mensaje_operativo;
  destino.evidenciaContextual = congelarJson(
    parsearJsonOpcional(fila.evidencia_contextual)
  );
  destino.observadoEnUtc = normalizarMarcaUtc(fila.observado_en_utc);
  destino.recibidoEnUtc = normalizarMarcaUtc(fila.recibido_en_utc);
  destino.evaluadoEnUtc = normalizarMarcaUtc(fila.evaluado_en_utc);
  destino.proximaReevaluacionUtc = normalizarMarcaUtc(fila.proxima_reevaluacion_utc);
}

function serializarEvaluacionPersistida(evaluacion) {
  return {
    id: evaluacion.id,
    evaluacionId: evaluacion.evaluacionId,
    generacionAutoridad: evaluacion.generacionAutoridad,
    causalidadRevision: evaluacion.causalidadRevision,
    reglaId: evaluacion.reglaId,
    revisionId: evaluacion.revisionId,
    observacionId: evaluacion.observacionId,
    agenteId: evaluacion.agenteId,
    senalId: evaluacion.senalId,
    tenantId: evaluacion.tenantId,
    empresaId: evaluacion.empresaId,
    sitioId: evaluacion.sitioId,
    resultado: evaluacion.resultado,
    ladoAtencion: evaluacion.ladoAtencion,
    codigoMotivo: evaluacion.codigoMotivo,
    explicacion: evaluacion.explicacion,
    condicionCanonica: evaluacion.condicionCanonica,
    valorEvaluado: clonarJson(evaluacion.valorEvaluado),
    tipoDato: evaluacion.tipoDato,
    unidad: evaluacion.unidad,
    calidad: evaluacion.calidad,
    severidadCalculada: evaluacion.severidadCalculada,
    mensajeOperativo: evaluacion.mensajeOperativo,
    evidenciaContextual: clonarJson(evaluacion.evidenciaContextual),
    observadoEnUtc: evaluacion.observadoEnUtc,
    recibidoEnUtc: evaluacion.recibidoEnUtc,
    evaluadoEnUtc: evaluacion.evaluadoEnUtc,
    proximaReevaluacionUtc: evaluacion.proximaReevaluacionUtc
  };
}

function columnasEvaluacion(alias) {
  return `
    ${alias}.id,
    ${alias}.evaluacion_id,
    ${alias}.generacion_autoridad,
    ${alias}.causalidad_revision,
    ${alias}.regla_id,
    ${alias}.regla_revision_id,
    ${alias}.observacion_id,
    ${alias}.agente_id,
    ${alias}.senal_id,
    ${alias}.tenant_id,
    ${alias}.empresa_id,
    ${alias}.sitio_id,
    ${alias}.resultado,
    ${alias}.lado_atencion,
    ${alias}.codigo_motivo,
    ${alias}.explicacion,
    ${alias}.condicion_canonica,
    ${alias}.valor_evaluado,
    ${alias}.tipo_dato,
    ${alias}.unidad,
    ${alias}.calidad,
    ${alias}.severidad_calculada,
    ${alias}.mensaje_operativo,
    ${alias}.evidencia_contextual,
    ${alias}.observado_en_utc,
    ${alias}.recibido_en_utc,
    ${alias}.evaluado_en_utc,
    ${alias}.proxima_reevaluacion_utc
  `;
}

function construirSqlInsertarEvaluacionLedger() {
  return `INSERT INTO evaluaciones_reglas_telemetria (
    trabajo_id, regla_id, regla_revision_id, observacion_id, agente_id, senal_id,
    tenant_id, empresa_id, sitio_id, causa, generacion_autoridad,
    causalidad_revision, programado_para_utc, resultado, lado_atencion,
    resultado_anterior, lado_anterior, momento_utc, ahora_utc,
    desviacion_segundos, proxima_reevaluacion_utc, codigo_motivo, explicacion,
    condicion_canonica, valor_evaluado, tipo_dato, unidad, calidad,
    severidad_calculada, mensaje_operativo, evidencia_contextual,
    observado_en_utc, recibido_en_utc, evaluado_en_utc
  ) VALUES (${Array.from({ length: 34 }, () => '?').join(', ')})`;
}

function construirParametrosEvaluacionLedger(e) {
  return [
    e.trabajoId, e.reglaId, e.revisionId, e.observacionId, e.agenteId, e.senalId,
    e.tenantId, e.empresaId, e.sitioId, e.causa, e.generacionAutoridad,
    e.causalidadRevision, fechaSqlOpcional(e.programadoParaUtc), e.resultado,
    e.ladoAtencion, e.resultadoAnterior, e.ladoAnterior,
    fechaSqlOpcional(e.momentoUtc), fechaSqlOpcional(e.ahoraUtc),
    e.desviacionSegundos, fechaSqlOpcional(e.proximaReevaluacionUtc),
    e.codigoMotivo, e.explicacion, e.condicionCanonica,
    JSON.stringify(e.valorEvaluado), e.tipoDato, e.unidad || '', e.calidad,
    e.severidadCalculada, e.mensajeOperativo,
    e.evidenciaContextual == null ? null : JSON.stringify(e.evidenciaContextual),
    new Date(e.observadoEnUtc), new Date(e.recibidoEnUtc), new Date(e.evaluadoEnUtc)
  ];
}

function columnasEvaluacionLedger(alias) {
  return `${alias}.id,
    ${alias}.id AS evaluacion_id,
    ${alias}.generacion_autoridad,
    ${alias}.causalidad_revision,
    ${alias}.regla_id,
    ${alias}.regla_revision_id,
    ${alias}.observacion_id,
    ${alias}.agente_id,
    ${alias}.senal_id,
    ${alias}.tenant_id,
    ${alias}.empresa_id,
    ${alias}.sitio_id,
    ${alias}.resultado,
    ${alias}.lado_atencion,
    ${alias}.codigo_motivo,
    ${alias}.explicacion,
    ${alias}.condicion_canonica,
    ${alias}.valor_evaluado,
    ${alias}.tipo_dato,
    ${alias}.unidad,
    ${alias}.calidad,
    ${alias}.severidad_calculada,
    ${alias}.mensaje_operativo,
    ${alias}.evidencia_contextual,
    ${alias}.observado_en_utc,
    ${alias}.recibido_en_utc,
    ${alias}.evaluado_en_utc,
    ${alias}.proxima_reevaluacion_utc,
    ${alias}.trabajo_id,
    ${alias}.causa,
    ${alias}.programado_para_utc,
    ${alias}.resultado_anterior,
    ${alias}.lado_anterior,
    ${alias}.momento_utc,
    ${alias}.ahora_utc,
    ${alias}.desviacion_segundos,
    ${alias}.creada_en_utc`;
}

function normalizarEvaluacionLedger({ trabajo, evaluacion }) {
  const t = serializarSiProcede(trabajo);
  const e = serializarSiProcede(evaluacion);
  if (!t || !e) throw new Error('El trabajo y su evaluación durable son obligatorios.');
  const datos = {
    ...e,
    trabajoId: normalizarId(t.id, 'El trabajo durable no es válido.'),
    reglaId: normalizarId(e.reglaId, 'La regla evaluada no es válida.'),
    revisionId: normalizarId(e.revisionId, 'La revisión evaluada no es válida.'),
    observacionId: normalizarId(e.observacionId, 'La observación evaluada no es válida.'),
    agenteId: normalizarId(e.agenteId, 'El agente evaluado no es válido.'),
    senalId: normalizarId(e.senalId, 'La señal evaluada no es válida.'),
    tenantId: normalizarId(e.tenantId, 'El tenant evaluado no es válido.'),
    empresaId: normalizarId(e.empresaId, 'La empresa evaluada no es válida.'),
    sitioId: normalizarId(e.sitioId, 'El sitio evaluado no es válido.'),
    causa: String(t.causa || ''),
    generacionAutoridad: normalizarId(
      e.generacionAutoridad ?? t.generacionAutoridad,
      'La generación evaluada no es válida.'
    ),
    causalidadRevision: String(e.causalidadRevision || ''),
    programadoParaUtc: normalizarMarcaUtc(t.programadoParaUtc),
    ladoAtencion: e.ladoAtencion || null,
    resultadoAnterior: e.resultadoAnterior || null,
    ladoAnterior: e.ladoAnterior || null,
    momentoUtc: normalizarMarcaUtc(e.momentoUtc),
    ahoraUtc: normalizarMarcaUtc(e.ahoraUtc),
    desviacionSegundos: e.desviacionSegundos == null ? null : String(e.desviacionSegundos),
    proximaReevaluacionUtc: normalizarMarcaUtc(e.proximaReevaluacionUtc)
  };
  for (const [campoTrabajo, campoEvaluacion] of [
    ['reglaId', 'reglaId'], ['reglaRevisionId', 'revisionId'],
    ['observacionId', 'observacionId'], ['agenteId', 'agenteId'],
    ['senalId', 'senalId'], ['tenantId', 'tenantId'],
    ['empresaId', 'empresaId'], ['sitioId', 'sitioId']
  ]) {
    if (Number(t[campoTrabajo]) !== datos[campoEvaluacion]) {
      throw new Error('La evaluación no coincide con la identidad causal del trabajo.');
    }
  }
  if (Number(t.generacionAutoridad) !== datos.generacionAutoridad) {
    throw new Error('La evaluación no coincide con la generación del trabajo.');
  }
  if (!['observacion', 'vencimiento_temporal', 'reconciliacion_administrativa',
    'reconciliacion_reloj'].includes(datos.causa)) {
    throw new Error('La causa durable de evaluación no es válida.');
  }
  if (!['historica_recepcion', 'autoridad_actual'].includes(datos.causalidadRevision)) {
    throw new Error('La causalidad de revisión durable no es válida.');
  }
  for (const campo of ['condicionCanonica', 'valorEvaluado', 'evidenciaContextual']) {
    validarLimiteJson(datos[campo], campo);
  }
  return datos;
}

function comprobarEvaluacionIdempotente(persistida, esperada) {
  const real = persistida.serializar();
  const campos = [
    'trabajoId', 'reglaId', 'revisionId', 'observacionId', 'generacionAutoridad',
    'causa', 'causalidadRevision', 'programadoParaUtc', 'resultado',
    'ladoAtencion', 'resultadoAnterior', 'ladoAnterior', 'momentoUtc', 'ahoraUtc',
    'desviacionSegundos', 'proximaReevaluacionUtc', 'codigoMotivo', 'explicacion',
    'condicionCanonica', 'valorEvaluado', 'tipoDato', 'unidad', 'calidad',
    'severidadCalculada', 'mensajeOperativo', 'evidenciaContextual',
    'observadoEnUtc', 'recibidoEnUtc', 'evaluadoEnUtc'
  ];
  for (const campo of campos) {
    if (JSON.stringify(real[campo] ?? null) !== JSON.stringify(esperada[campo] ?? null)) {
      throw new Error(
        `El trabajo ya conserva una evaluación durable diferente en ${campo}.`
      );
    }
  }
}

function validarLimiteJson(valor, campo) {
  if (valor == null && campo === 'evidenciaContextual') return;
  const texto = typeof valor === 'string' && campo === 'condicionCanonica'
    ? valor
    : JSON.stringify(valor);
  if (typeof texto !== 'string' || [...texto].length > 4096) {
    throw new Error(`${campo} supera el límite durable de 4096 caracteres.`);
  }
}

function fechaSqlOpcional(valor) {
  return valor == null ? null : new Date(valor);
}

function serializarSiProcede(valor) {
  return typeof valor?.serializar === 'function' ? valor.serializar() : valor;
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

function normalizarIdentidadEvaluacion({
  evaluacionId = null,
  reglaId,
  revisionId,
  observacionId
}) {
  if (evaluacionId != null) {
    return {
      evaluacionId: normalizarId(
        evaluacionId,
        'La evaluación del evento no es válida.'
      ),
      reglaId: null,
      revisionId: null,
      observacionId: null
    };
  }
  return {
    evaluacionId: null,
    reglaId: normalizarId(reglaId, 'La regla del evento no es válida.'),
    revisionId: normalizarId(revisionId, 'La revisión del evento no es válida.'),
    observacionId: normalizarId(
      observacionId,
      'La observación del evento no es válida.'
    )
  };
}

function normalizarId(valor, mensaje) {
  const id = Number(valor);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error(mensaje);
  }
  return id;
}

function normalizarLimite(valor) {
  const limite = Number(valor);
  if (!Number.isInteger(limite) || limite < 1 || limite > 500) {
    throw new Error('El límite de eventos debe estar entre 1 y 500.');
  }
  return limite;
}

function esErrorClaveDuplicada(error) {
  return error?.code === 'ER_DUP_ENTRY' || Number(error?.errno) === 1062;
}

function serializarCanonicaPersistida(valor) {
  const parseado = parsearJsonPersistido(valor);
  return JSON.stringify(ordenarJson(parseado));
}

function parsearJsonOpcional(valor) {
  return valor == null ? null : parsearJsonPersistido(valor);
}

function parsearJsonPersistido(valor) {
  if (typeof valor !== 'string') {
    return clonarJson(valor);
  }
  try {
    return JSON.parse(valor);
  } catch {
    return valor;
  }
}

function ordenarJson(valor) {
  if (Array.isArray(valor)) {
    return valor.map(ordenarJson);
  }
  if (valor && typeof valor === 'object') {
    return Object.fromEntries(
      Object.keys(valor)
        .sort()
        .map((clave) => [clave, ordenarJson(valor[clave])])
    );
  }
  return valor;
}

function congelarJson(valor) {
  if (Array.isArray(valor)) {
    valor.forEach(congelarJson);
    return Object.freeze(valor);
  }
  if (valor && typeof valor === 'object') {
    Object.values(valor).forEach(congelarJson);
    return Object.freeze(valor);
  }
  return valor;
}

function clonarJson(valor) {
  return valor == null ? valor : JSON.parse(JSON.stringify(valor));
}
