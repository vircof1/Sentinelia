import {
  CAUSALIDAD_REVISION_MOMENTO_UTC_RELATIVO,
  CAUSAS_EVALUACION_MOMENTO_UTC_RELATIVO,
  CondicionMomentoUtcRelativo,
  RESULTADOS_MOMENTO_UTC_RELATIVO,
  evaluarMomentoUtcRelativo
} from './EvaluadorMomentoUtcRelativoTelemetria.js';
import {
  CAUSAS_TRABAJO_EVALUACION_TELEMETRIA,
  MOTIVOS_NEUTRALIZACION_TRABAJO_TELEMETRIA
} from './RepositorioTrabajosEvaluacionTelemetria.js';

const TIPO_RELATIVO = 'momento_utc_relativo';

export class ProcesadorObligacionesRelativasTelemetria {
  constructor({
    repositorioTrabajos,
    repositorioEvaluaciones,
    repositorioEstadoActual,
    repositorioEventosDerivados,
    capturadorFederacionTelemetria,
    evaluador = evaluarMomentoUtcRelativo
  } = {}) {
    for (const [nombre, dependencia] of Object.entries({
      repositorioTrabajos,
      repositorioEvaluaciones,
      repositorioEstadoActual,
      repositorioEventosDerivados
    })) {
      if (!dependencia) {
        throw new Error(`La dependencia ${nombre} del procesador relativo es obligatoria.`);
      }
    }
    if (typeof evaluador !== 'function') {
      throw new Error('El evaluador temporal relativo debe ser una función.');
    }
    if (typeof capturadorFederacionTelemetria?.capturarEvaluacionEnTransaccion !==
      'function') {
      throw new Error('La evaluación relativa exige captura federada transaccional.');
    }
    this.repositorioTrabajos = repositorioTrabajos;
    this.repositorioEvaluaciones = repositorioEvaluaciones;
    this.repositorioEstadoActual = repositorioEstadoActual;
    this.repositorioEventosDerivados = repositorioEventosDerivados;
    this.capturadorFederacionTelemetria = capturadorFederacionTelemetria;
    this.evaluador = evaluador;
  }

  async procesar({ trabajo, reclamadoPor } = {}) {
    const clienteSql = this.repositorioTrabajos.clienteSql;
    if (typeof clienteSql?.obtenerConexion !== 'function') {
      throw new Error('El procesador relativo requiere una conexión SQL transaccional.');
    }
    const conexion = await clienteSql.obtenerConexion();
    try {
      await conexion.beginTransaction();
      const vigente = await this.repositorioTrabajos.bloquearReclamadoEnTransaccion({
        trabajoId: trabajo?.id,
        reclamadoPor
      }, { conexion });
      const contexto = await cargarContextoBloqueado(conexion, vigente);
      const motivoNeutralizacion = resolverPerdidaAutoridad(vigente, contexto);
      if (motivoNeutralizacion) {
        await this.repositorioTrabajos.marcarNeutralizado({
          trabajoId: vigente.id,
          reclamadoPor,
          motivo: motivoNeutralizacion
        }, { conexion });
        await conexion.commit();
        return resultadoNeutralizado(vigente, motivoNeutralizacion);
      }

      const estadoAnterior = await this.repositorioEstadoActual.buscarPorRegla(
        vigente.reglaId,
        { conexion, bloquear: true }
      );
      const ahoraUtc = await leerAhoraSql(conexion);
      exigirObligacionExigible(vigente, ahoraUtc);
      const condicion = new CondicionMomentoUtcRelativo(
        parsearJson(contexto.revision.condicion_canonica, 'condición relativa')
      );
      const anteriorCompatible = construirEstadoAnteriorCompatible({
        estadoAnterior,
        trabajo: vigente
      });
      const decision = this.evaluador({
        condicion,
        momentoUtc: fechaUtcCanonicaOpcional(contexto.observacion.valor_momento_utc),
        ahoraUtc,
        estadoAnteriorCompatible: anteriorCompatible,
        causa: vigente.causa,
        correccionReloj: contexto.correccionReloj
      });
      const evaluacionNueva = construirEvaluacion({
        trabajo: vigente,
        contexto,
        decision,
        estadoAnteriorCompatible: anteriorCompatible,
        ahoraUtc
      });
      const { evaluacion } = await this.repositorioEvaluaciones.registrar({
        trabajo: vigente,
        evaluacion: evaluacionNueva
      }, { conexion });
      const estado = await this.repositorioEstadoActual.aplicarResultado(
        evaluacion,
        { conexion, fuenteYaBloqueada: true }
      );
      if (!estado.actualizado || !estado.gobiernaEstadoActual) {
        throw new Error('La evaluación relativa confirmada no gobierna el estado actual.');
      }
      const evento = await proyectarEventoRelativo({
        repositorio: this.repositorioEventosDerivados,
        evaluacion,
        estadoAnteriorCompatible: anteriorCompatible,
        causa: vigente.causa,
        conexion
      });
      const siguienteTrabajo = await this.#encolarProximaObligacion({
        conexion,
        trabajo: vigente,
        contexto,
        evaluacion
      });
      await this.capturadorFederacionTelemetria.capturarEvaluacionEnTransaccion({
        reglaId: vigente.reglaId,
        estadoActualizado: true,
        eventoCreado: evento.creado,
        eventoDerivadoId: evento.evento?.id ?? null
      }, { conexion });
      await this.repositorioTrabajos.marcarCompletado({
        trabajoId: vigente.id,
        reclamadoPor
      }, { conexion });
      await conexion.commit();
      return resultadoCompletado({
        trabajo: vigente,
        evaluacion,
        estado,
        evento,
        siguienteTrabajo,
        cambioEstadoMonitor:
          anteriorCompatible?.resultado !== evaluacion.resultado
      });
    } catch (error) {
      await conexion.rollback();
      throw error;
    } finally {
      conexion.release();
    }
  }

  async #encolarProximaObligacion({ conexion, trabajo, contexto, evaluacion }) {
    if (!evaluacion.proximaReevaluacionUtc) return null;
    return this.repositorioTrabajos.encolarEnTransaccion({
      observacion: {
        id: trabajo.observacionId,
        agenteId: trabajo.agenteId,
        senalId: trabajo.senalId,
        recibidoEnUtc: trabajo.recibidoEnUtc
      },
      regla: {
        id: trabajo.reglaId,
        agenteId: trabajo.agenteId,
        senalId: trabajo.senalId,
        tenantId: trabajo.tenantId,
        empresaId: trabajo.empresaId,
        sitioId: trabajo.sitioId,
        generacionAutoridad: trabajo.generacionAutoridad
      },
      revision: {
        id: trabajo.reglaRevisionId,
        reglaId: trabajo.reglaId,
        vigenteDesdeUtc: fechaIso(contexto.revision.vigente_desde_utc),
        vigenteHastaUtc: fechaIsoOpcional(contexto.revision.vigente_hasta_utc)
      },
      causa: CAUSAS_TRABAJO_EVALUACION_TELEMETRIA.VENCIMIENTO_TEMPORAL,
      generacionAutoridad: trabajo.generacionAutoridad,
      programadoParaUtc: evaluacion.proximaReevaluacionUtc
    }, { conexion });
  }
}

async function cargarContextoBloqueado(conexion, trabajo) {
  const regla = await seleccionarUna(conexion,
    `SELECT id,agente_id,senal_id,tenant_id,empresa_id,sitio_id,estado,
            revision_vigente_id,generacion_autoridad
       FROM reglas_derivacion_telemetria
      WHERE id=? LIMIT 1 FOR UPDATE`,
    [trabajo.reglaId]);
  if (!regla) throw new Error('La regla de la obligación relativa ya no existe.');
  const revision = await seleccionarUna(conexion,
    `SELECT id,regla_id,condicion_tipo,condicion_version,condicion_canonica,
            severidad_calculada,mensaje_operativo,vigente_desde_utc,vigente_hasta_utc
       FROM revisiones_reglas_derivacion_telemetria
      WHERE id=? LIMIT 1 FOR UPDATE`,
    [trabajo.reglaRevisionId]);
  if (!revision) throw new Error('La revisión de la obligación relativa ya no existe.');
  const fotografia = await seleccionarUna(conexion,
    `SELECT id,agente_id,senal_id,ultima_observacion_id,observado_en_utc
       FROM estado_actual_telemetria_agentes
      WHERE agente_id=? AND senal_id=? LIMIT 1 FOR UPDATE`,
    [trabajo.agenteId, trabajo.senalId]);
  const observacion = await seleccionarUna(conexion,
    `SELECT id,agente_id,senal_id,tipo_dato,unidad,valor_momento_utc,calidad,
            observado_en_utc,recibido_en_utc
       FROM observaciones_telemetria_agentes
      WHERE id=? LIMIT 1 FOR UPDATE`,
    [trabajo.observacionId]);
  if (!observacion) {
    throw new Error('La observación de la obligación relativa ya no existe.');
  }
  const correccionReloj = trabajo.causa ===
    CAUSAS_TRABAJO_EVALUACION_TELEMETRIA.RECONCILIACION_RELOJ
    ? await cargarCorreccionReloj(conexion, trabajo.generacionCorreccion)
    : null;
  validarContextoEstructural({ trabajo, regla, revision, observacion });
  return { regla, revision, fotografia, observacion, correccionReloj };
}

async function cargarCorreccionReloj(conexion, generacionCorreccion) {
  const fila = await seleccionarUna(
    conexion,
    `SELECT generacion_correccion,reloj_anterior_utc,reloj_corregido_utc
       FROM reconciliaciones_reloj_relativo_telemetria
      WHERE generacion_correccion=? LIMIT 1`,
    [generacionCorreccion]
  );
  if (!fila) {
    throw new Error('La evidencia durable de la corrección de reloj no existe.');
  }
  return {
    generacionCorreccion: String(fila.generacion_correccion),
    relojAnteriorUtc: fechaUtcCanonica(fila.reloj_anterior_utc),
    relojCorregidoUtc: fechaUtcCanonica(fila.reloj_corregido_utc)
  };
}

function resolverPerdidaAutoridad(trabajo, { regla, fotografia }) {
  if (regla.estado !== 'activa') {
    return MOTIVOS_NEUTRALIZACION_TRABAJO_TELEMETRIA.REGLA_DESHABILITADA;
  }
  if (Number(regla.generacion_autoridad) !== Number(trabajo.generacionAutoridad)) {
    return MOTIVOS_NEUTRALIZACION_TRABAJO_TELEMETRIA.GENERACION_SUSTITUIDA;
  }
  if (Number(regla.revision_vigente_id) !== Number(trabajo.reglaRevisionId)) {
    return MOTIVOS_NEUTRALIZACION_TRABAJO_TELEMETRIA.REVISION_SUSTITUIDA;
  }
  if (
    !fotografia ||
    Number(fotografia.ultima_observacion_id) !== Number(trabajo.observacionId)
  ) {
    return MOTIVOS_NEUTRALIZACION_TRABAJO_TELEMETRIA.OBSERVACION_SUSTITUIDA;
  }
  return null;
}

function validarContextoEstructural({ trabajo, regla, revision, observacion }) {
  for (const [nombre, actual, esperado] of [
    ['agente de regla', regla.agente_id, trabajo.agenteId],
    ['señal de regla', regla.senal_id, trabajo.senalId],
    ['tenant', regla.tenant_id, trabajo.tenantId],
    ['empresa', regla.empresa_id, trabajo.empresaId],
    ['sitio', regla.sitio_id, trabajo.sitioId],
    ['regla de revisión', revision.regla_id, trabajo.reglaId],
    ['agente de observación', observacion.agente_id, trabajo.agenteId],
    ['señal de observación', observacion.senal_id, trabajo.senalId]
  ]) {
    if (Number(actual) !== Number(esperado)) {
      throw new Error(`El contexto relativo no coincide en ${nombre}.`);
    }
  }
  if (
    revision.condicion_tipo !== TIPO_RELATIVO ||
    Number(revision.condicion_version) !== 1 ||
    observacion.tipo_dato !== 'momento_utc'
  ) {
    throw new Error('La obligación no pertenece a momento_utc_relativo@1.');
  }
}

function construirEstadoAnteriorCompatible({ estadoAnterior, trabajo }) {
  if (
    !estadoAnterior ||
    estadoAnterior.causalidadRevision !== CAUSALIDAD_REVISION_MOMENTO_UTC_RELATIVO ||
    Number(estadoAnterior.generacionAutoridad) !== Number(trabajo.generacionAutoridad) ||
    Number(estadoAnterior.revisionId) !== Number(trabajo.reglaRevisionId)
  ) {
    return null;
  }
  return {
    resultado: estadoAnterior.resultado,
    ladoAtencion: estadoAnterior.ladoAtencion
  };
}

function exigirObligacionExigible(trabajo, ahoraUtc) {
  if (
    trabajo.causa === CAUSAS_TRABAJO_EVALUACION_TELEMETRIA.VENCIMIENTO_TEMPORAL &&
    Date.parse(trabajo.programadoParaUtc) > Date.parse(ahoraUtc)
  ) {
    throw new Error('El vencimiento temporal reclamado todavía no es exigible.');
  }
}

function construirEvaluacion({
  trabajo,
  contexto,
  decision,
  estadoAnteriorCompatible,
  ahoraUtc
}) {
  const observacion = contexto.observacion;
  const temporal = decision.temporal;
  const retrasoSegundos = trabajo.programadoParaUtc
    ? Math.max(0, Math.floor(
      (Date.parse(ahoraUtc) - Date.parse(trabajo.programadoParaUtc)) / 1000
    )).toString()
    : null;
  return {
    reglaId: Number(trabajo.reglaId),
    revisionId: Number(trabajo.reglaRevisionId),
    observacionId: Number(trabajo.observacionId),
    agenteId: Number(trabajo.agenteId),
    senalId: Number(trabajo.senalId),
    tenantId: Number(trabajo.tenantId),
    empresaId: Number(trabajo.empresaId),
    sitioId: Number(trabajo.sitioId),
    generacionAutoridad: Number(trabajo.generacionAutoridad),
    causalidadRevision: CAUSALIDAD_REVISION_MOMENTO_UTC_RELATIVO,
    resultado: decision.resultado,
    ladoAtencion: decision.ladoAtencion,
    resultadoAnterior: estadoAnteriorCompatible?.resultado ?? null,
    ladoAnterior: estadoAnteriorCompatible?.ladoAtencion ?? null,
    momentoUtc: fechaIsoOpcional(temporal.momentoUtc),
    ahoraUtc: fechaIso(temporal.ahoraUtc),
    desviacionSegundos: temporal.desviacionSegundos,
    proximaReevaluacionUtc: fechaIsoOpcional(decision.proximaReevaluacionUtc),
    codigoMotivo: decision.codigoMotivo,
    explicacion: explicarDecision(decision),
    condicionCanonica: String(contexto.revision.condicion_canonica),
    valorEvaluado: temporal.momentoUtc,
    tipoDato: 'momento_utc',
    unidad: observacion.unidad || null,
    calidad: observacion.calidad,
    severidadCalculada: decision.resultado === RESULTADOS_MOMENTO_UTC_RELATIVO.COINCIDE
      ? contexto.revision.severidad_calculada
      : null,
    mensajeOperativo: contexto.revision.mensaje_operativo,
    evidenciaContextual: {
      temporal: {
        ...temporal,
        motivoProgramacion: decision.motivoProgramacion,
        programadoParaUtc: trabajo.programadoParaUtc,
        retrasoSegundos
      }
    },
    observadoEnUtc: fechaIso(observacion.observado_en_utc),
    recibidoEnUtc: fechaIso(observacion.recibido_en_utc),
    evaluadoEnUtc: fechaIso(temporal.ahoraUtc)
  };
}

async function proyectarEventoRelativo({
  repositorio,
  evaluacion,
  estadoAnteriorCompatible,
  causa,
  conexion
}) {
  if (evaluacion.resultado !== RESULTADOS_MOMENTO_UTC_RELATIVO.COINCIDE) {
    return { creado: false, motivo: 'resultado_no_coincidente', evento: null };
  }
  const esObservacion = causa === CAUSAS_EVALUACION_MOMENTO_UTC_RELATIVO.OBSERVACION;
  const entradaEfectiva = estadoAnteriorCompatible?.resultado !==
    RESULTADOS_MOMENTO_UTC_RELATIVO.COINCIDE;
  if (!esObservacion && !entradaEfectiva) {
    return { creado: false, motivo: 'sin_entrada_efectiva', evento: null };
  }
  return repositorio.insertarSiCoincide(evaluacion, { conexion });
}

async function leerAhoraSql(conexion) {
  const fila = await seleccionarUna(
    conexion,
    'SELECT UTC_TIMESTAMP(0) AS ahora_utc',
    []
  );
  return fechaUtcCanonica(fila?.ahora_utc);
}

async function seleccionarUna(conexion, sql, parametros) {
  const [filas] = await conexion.execute(sql, parametros);
  return filas[0] || null;
}

function parsearJson(valor, nombre) {
  try {
    const parseado = typeof valor === 'string' ? JSON.parse(valor) : valor;
    if (!parseado || typeof parseado !== 'object' || Array.isArray(parseado)) {
      throw new Error();
    }
    return parseado;
  } catch {
    throw new Error(`No se pudo reconstruir ${nombre}.`);
  }
}

function explicarDecision(decision) {
  if (decision.resultado === RESULTADOS_MOMENTO_UTC_RELATIVO.NO_EVALUABLE) {
    return 'El instante comunicado no permite una evaluación temporal relativa.';
  }
  if (decision.resultado === RESULTADOS_MOMENTO_UTC_RELATIVO.COINCIDE) {
    return `La condición temporal relativa coincide por el lado ${decision.ladoAtencion}.`;
  }
  return 'La condición temporal relativa no coincide en el instante evaluado.';
}

function resultadoNeutralizado(trabajo, motivo) {
  return Object.freeze({
    ok: true,
    terminal: true,
    neutralizada: true,
    trabajoId: Number(trabajo.id),
    intentos: Number(trabajo.intentos || 0),
    motivoNeutralizacion: motivo,
    evaluacion: null,
    persistencia: null
  });
}

function resultadoCompletado({
  trabajo,
  evaluacion,
  estado,
  evento,
  siguienteTrabajo,
  cambioEstadoMonitor
}) {
  return Object.freeze({
    ok: true,
    terminal: true,
    neutralizada: false,
    trabajoId: Number(trabajo.id),
    intentos: Number(trabajo.intentos || 0),
    evaluacion: Object.freeze(evaluacion.serializar()),
    persistencia: Object.freeze({
      estadoActualizado: estado.actualizado,
      gobiernaEstadoActual: estado.gobiernaEstadoActual,
      cambioEstadoMonitor,
      estadoActual: Object.freeze(estado.estado.serializar()),
      eventoCreado: evento.creado,
      motivoEvento: evento.motivo,
      eventoDerivado: evento.evento
        ? Object.freeze(evento.evento.serializar())
        : null,
      siguienteTrabajo: siguienteTrabajo
        ? Object.freeze({
          creado: siguienteTrabajo.creado,
          trabajo: Object.freeze(siguienteTrabajo.trabajo.serializar())
        })
        : null
    })
  });
}

function fechaIso(valor) {
  const fecha = valor instanceof Date ? valor : new Date(valor);
  if (!Number.isFinite(fecha.getTime())) throw new Error('La fecha SQL no es válida.');
  return fecha.toISOString();
}

function fechaIsoOpcional(valor) {
  return valor == null ? null : fechaIso(valor);
}

function fechaUtcCanonica(valor) {
  return fechaIso(valor).replace(/\.000Z$/u, 'Z');
}

function fechaUtcCanonicaOpcional(valor) {
  return valor == null ? null : fechaUtcCanonica(valor);
}
