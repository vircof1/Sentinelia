import {
  ESTADOS_REGLA_DERIVACION_TELEMETRIA,
  ReglaDerivacionTelemetria
} from './EventosDerivadosTelemetriaAgentes.js';
import {
  esFuenteEvaluacionTelemetriaEliminada,
  FuenteEvaluacionTelemetriaEliminada
} from './FronteraFuenteEvaluacionTelemetria.js';

const CODIGO_ERROR_POR_DEFECTO = 'error_evaluacion_telemetria';

export class ProcesadorTrabajosEvaluacionTelemetria {
  constructor({
    repositorioTrabajos,
    repositorioReglas,
    repositorioObservaciones,
    repositorioCatalogoSenales,
    proyectorEvaluaciones,
    evaluador,
    capturadorFederacionTelemetria = null,
    reintentoBaseSegundos = 5,
    reintentoMaximoSegundos = 300,
    reloj = () => new Date()
  } = {}) {
    for (const [nombre, dependencia] of Object.entries({
      repositorioTrabajos,
      repositorioReglas,
      repositorioObservaciones,
      repositorioCatalogoSenales,
      proyectorEvaluaciones,
      evaluador
    })) {
      if (!dependencia) {
        throw new Error(`La dependencia ${nombre} del procesador es obligatoria.`);
      }
    }

    this.repositorioTrabajos = repositorioTrabajos;
    this.repositorioReglas = repositorioReglas;
    this.repositorioObservaciones = repositorioObservaciones;
    this.repositorioCatalogoSenales = repositorioCatalogoSenales;
    this.proyectorEvaluaciones = proyectorEvaluaciones;
    this.evaluador = evaluador;
    if (capturadorFederacionTelemetria !== null &&
        typeof capturadorFederacionTelemetria?.capturarEvaluacionEnTransaccion !==
          'function') {
      throw new Error('La evaluación derivada requiere captura federada transaccional.');
    }
    this.capturadorFederacionTelemetria = capturadorFederacionTelemetria;
    this.reintentoBaseSegundos = normalizarEnteroPositivo(
      reintentoBaseSegundos,
      5
    );
    this.reintentoMaximoSegundos = Math.max(
      this.reintentoBaseSegundos,
      normalizarEnteroPositivo(reintentoMaximoSegundos, 300)
    );
    this.reloj = reloj;
  }

  async procesar({ trabajo, reclamadoPor } = {}) {
    try {
      const contexto = await this.cargarContexto(trabajo);
      const resultado = this.evaluador.evaluar({
        regla: contexto.regla,
        revision: contexto.revision,
        senal: contexto.senal,
        observacion: contexto.observacionEvaluable,
        evaluadoEnUtc: this.reloj()
      });
      const persistencia = await this.persistirEfectosYCompletar({
        trabajo,
        reclamadoPor,
        resultado
      });

      return {
        ok: true,
        trabajoId: trabajo.id,
        intentos: trabajo.intentos,
        resultado: resultado.serializar(),
        persistencia
      };
    } catch (error) {
      if (esFuenteEvaluacionTelemetriaEliminada(error)) {
        return this.construirDescarteFuenteEliminada({ trabajo, error });
      }
      return this.registrarFallo({ trabajo, reclamadoPor, error });
    }
  }

  async cargarContexto(trabajo) {
    if (!trabajo || trabajo.estado !== 'procesando') {
      throw new Error('El trabajo debe estar reclamado antes de evaluarse.');
    }

    const [reglaPersistida, revision, observacion, senal] = await Promise.all([
      this.repositorioReglas.buscarPorId(trabajo.reglaId),
      this.repositorioReglas.buscarRevisionPorId(trabajo.reglaRevisionId),
      this.repositorioObservaciones.buscarPorId(trabajo.observacionId),
      this.repositorioCatalogoSenales.buscarPorId(trabajo.senalId)
    ]);
    const reglaOriginal = reglaPersistida?.regla || null;

    if (!reglaOriginal || !revision || !observacion || !senal) {
      const trabajoVigente = await this.repositorioTrabajos.buscarPorId(trabajo.id);
      if (!trabajoVigente) {
        throw new FuenteEvaluacionTelemetriaEliminada();
      }
      throw new Error('No se pudo reconstruir el contexto durable del trabajo.');
    }
    asegurarContextoCoincidente({
      trabajo,
      regla: reglaOriginal,
      revision,
      observacion,
      senal
    });

    return {
      regla: fijarReglaActivaEncolada(reglaOriginal),
      revision,
      observacion,
      senal,
      observacionEvaluable: construirObservacionEvaluable(observacion)
    };
  }

  async persistirEfectosYCompletar({ trabajo, reclamadoPor, resultado }) {
    const clienteSql = this.repositorioTrabajos.clienteSql;
    if (!clienteSql || typeof clienteSql.obtenerConexion !== 'function') {
      throw new Error('El procesador requiere una conexión SQL transaccional.');
    }
    const conexion = await clienteSql.obtenerConexion();

    try {
      await conexion.beginTransaction();
      const proyeccion = await this.proyectorEvaluaciones.proyectar(
        resultado,
        { conexion }
      );
      if (this.capturadorFederacionTelemetria) {
        await this.capturadorFederacionTelemetria.capturarEvaluacionEnTransaccion({
          reglaId: proyeccion.reglaId,
          estadoActualizado: proyeccion.estadoActualizado,
          eventoCreado: proyeccion.eventoCreado,
          eventoDerivadoId: proyeccion.eventoDerivado?.id ?? null
        }, { conexion });
      }
      await this.repositorioTrabajos.marcarCompletado(
        {
          trabajoId: trabajo.id,
          reclamadoPor
        },
        { conexion }
      );
      await conexion.commit();

      return proyeccion;
    } catch (error) {
      await conexion.rollback();
      throw error;
    } finally {
      conexion.release();
    }
  }

  async registrarFallo({ trabajo, reclamadoPor, error }) {
    const demoraReintentoSegundos =
      this.calcularDemoraReintentoMs(trabajo?.intentos) / 1000;
    let siguienteIntentoUtc = null;
    let errorRegistro = null;
    let registrado = false;

    try {
      const registro = await this.repositorioTrabajos.registrarErrorTecnico({
        trabajoId: trabajo?.id,
        reclamadoPor,
        codigoError: normalizarCodigoError(error),
        mensajeError: String(error?.message || 'Error técnico desconocido.'),
        demoraReintentoSegundos
      });
      registrado = Boolean(registro?.registrado ?? registro);
      siguienteIntentoUtc = registro?.siguienteIntentoUtc || null;
    } catch (errorPersistencia) {
      errorRegistro = errorPersistencia;
    }

    return {
      ok: false,
      trabajoId: trabajo?.id || null,
      intentos: Number(trabajo?.intentos || 0),
      error: {
        codigo: normalizarCodigoError(error),
        mensaje: String(error?.message || 'Error técnico desconocido.')
      },
      errorRegistrado: registrado,
      siguienteIntentoUtc,
      demoraReintentoSegundos: registrado ? demoraReintentoSegundos : null,
      errorRegistro: errorRegistro
        ? String(errorRegistro?.message || 'No se pudo registrar el error técnico.')
        : null
    };
  }

  construirDescarteFuenteEliminada({ trabajo, error }) {
    return Object.freeze({
      ok: true,
      terminal: true,
      descartada: true,
      trabajoId: trabajo?.id || null,
      intentos: Number(trabajo?.intentos || 0),
      codigoMotivo: 'fuente_eliminada',
      motivoDescarte: 'fuente_eliminada',
      mensaje: String(error?.message || 'La fuente de la evaluación ya no existe.'),
      resultado: null,
      persistencia: null
    });
  }

  calcularDemoraReintentoMs(intentos) {
    const exponente = Math.max(0, Math.min(20, Number(intentos || 1) - 1));
    const segundos = Math.min(
      this.reintentoMaximoSegundos,
      this.reintentoBaseSegundos * (2 ** exponente)
    );
    return segundos * 1000;
  }
}

function asegurarContextoCoincidente({
  trabajo,
  regla,
  revision,
  observacion,
  senal
}) {
  for (const [nombre, actual, esperado] of [
    ['regla', regla.id, trabajo.reglaId],
    ['revisión', revision.id, trabajo.reglaRevisionId],
    ['observación', observacion.id, trabajo.observacionId],
    ['agente de regla', regla.agenteId, trabajo.agenteId],
    ['agente de observación', observacion.agenteId, trabajo.agenteId],
    ['señal de regla', regla.senalId, trabajo.senalId],
    ['señal de observación', observacion.senalId, trabajo.senalId],
    ['señal catalogada', senal.id, trabajo.senalId],
    ['tenant', regla.tenantId, trabajo.tenantId],
    ['empresa', regla.empresaId, trabajo.empresaId],
    ['sitio', regla.sitioId, trabajo.sitioId]
  ]) {
    if (Number(actual) !== Number(esperado)) {
      throw new Error(`El contexto del trabajo no coincide en ${nombre}.`);
    }
  }
  if (Number(revision.reglaId) !== Number(trabajo.reglaId)) {
    throw new Error('La revisión fijada no pertenece a la regla del trabajo.');
  }
  if (Number(senal.agenteId) !== Number(trabajo.agenteId)) {
    throw new Error('La señal catalogada no pertenece al agente del trabajo.');
  }
  if (
    new Date(observacion.recibidoEnUtc).getTime() !==
    new Date(trabajo.recibidoEnUtc).getTime()
  ) {
    throw new Error('La fecha recibida del trabajo no coincide con la observación.');
  }
}

function fijarReglaActivaEncolada(regla) {
  if (regla.estaActiva()) {
    return regla;
  }

  return new ReglaDerivacionTelemetria({
    id: regla.id,
    agente: {
      id: regla.agenteId,
      tenantId: regla.tenantId,
      empresaId: regla.empresaId,
      sitioId: regla.sitioId
    },
    senal: {
      id: regla.senalId,
      agenteId: regla.agenteId
    },
    scope: {
      tenantId: regla.tenantId,
      empresaId: regla.empresaId,
      sitioId: regla.sitioId
    },
    estado: ESTADOS_REGLA_DERIVACION_TELEMETRIA.ACTIVA,
    revisionVigenteId: regla.revisionVigenteId
  });
}

function construirObservacionEvaluable(observacion) {
  const serializada = typeof observacion?.serializar === 'function'
    ? observacion.serializar()
    : { ...observacion };

  return {
    ...serializada,
    valor: resolverValorTipado(serializada)
  };
}

function resolverValorTipado(observacion) {
  return {
    numero: observacion.valorNumero,
    booleano: observacion.valorBooleano,
    texto: observacion.valorTexto,
    estado: observacion.valorEstado,
    json: observacion.valorJson,
    duracion: observacion.valorDuracion,
    momento_utc: observacion.valorMomentoUtc
  }[observacion.tipoDato];
}

function normalizarCodigoError(error) {
  const codigo = String(error?.code || CODIGO_ERROR_POR_DEFECTO).trim();
  return (codigo || CODIGO_ERROR_POR_DEFECTO).slice(0, 80);
}

function normalizarEnteroPositivo(valor, porDefecto) {
  const numero = Number(valor);
  return Number.isInteger(numero) && numero > 0 ? numero : porDefecto;
}
