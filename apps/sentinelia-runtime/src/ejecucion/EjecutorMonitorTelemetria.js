import {
  ESTADOS_MONITOR_TELEMETRIA,
  ResultadoMonitorTelemetria
} from '../../../../paquetes/monitores/src/MonitorTelemetriaAgente.js';
import {
  EvaluadorMonitorTelemetria
} from '../../../../paquetes/monitores/src/EvaluadorMonitorTelemetria.js';
import {
  crearConfiguracionMonitorTelemetria,
  crearConfiguracionTemporalMonitorTelemetria
} from '../../../../paquetes/monitores/src/ConfiguracionMonitorTelemetria.js';
import {
  EvaluadorFuenteReglaMonitorTelemetria
} from '../../../../paquetes/monitores/src/EvaluadorFuenteReglaMonitorTelemetria.js';
import {
  PlanificadorTransicionesTelemetriaPendientes
} from '../../../../paquetes/monitores/src/PlanificadorTransicionesTelemetriaPendientes.js';
import {
  CONDICION_FUENTE_FEDERADA_RETIRADA,
  esFuenteFederadaRetirada,
  MENSAJE_FUENTE_FEDERADA_RETIRADA
} from '../../../../paquetes/monitores/src/CondicionFuenteFederada.js';

export class EjecutorMonitorTelemetria {
  tipoMonitor = 'telemetria';

  constructor({
    repositorioVinculos,
    repositorioEstadoActualTelemetria,
    repositorioEstadoActualEvaluacionReglas,
    repositorioTelemetriaRemota = null,
    evaluador = new EvaluadorMonitorTelemetria(),
    evaluadorFuenteRegla = new EvaluadorFuenteReglaMonitorTelemetria(),
    planificadorTransiciones =
      new PlanificadorTransicionesTelemetriaPendientes(),
    reloj = () => new Date()
  } = {}) {
    this.repositorioVinculos = repositorioVinculos;
    this.repositorioEstadoActualTelemetria = repositorioEstadoActualTelemetria;
    this.repositorioEstadoActualEvaluacionReglas =
      repositorioEstadoActualEvaluacionReglas;
    this.repositorioTelemetriaRemota = repositorioTelemetriaRemota;
    this.evaluador = evaluador;
    this.evaluadorFuenteRegla = evaluadorFuenteRegla;
    this.planificadorTransiciones = planificadorTransiciones;
    this.reloj = reloj;
  }

  async ejecutar(
    monitor,
    {
      programacion = null,
      almacenEstadoActual = null,
      ejecutadoEnUtc = null
    } = {}
  ) {
    const inicioUtc = normalizarFecha(
      ejecutadoEnUtc || this.reloj(),
      'No se pudo determinar el inicio del monitor de telemetría.'
    );
    let vinculo = null;

    try {
      vinculo = await this.repositorioVinculos?.buscarPorMonitorId?.(
        monitor?.id
      );
      if (!vinculo) {
        return this.construirResultado({
          monitor,
          programacion,
          inicioUtc,
          resultado: resultadoDesconocido(
            'vinculo_ausente',
            'El monitor de telemetría no tiene una fuente durable vinculada.'
          ),
          tipoFuente: null
        });
      }
      const evaluacionFuente = vinculo.esSenalDirecta()
        ? await this.evaluarSenalDirecta({ monitor, vinculo })
        : vinculo.esSenalFederada?.()
          ? await this.evaluarSenalFederada({ monitor, vinculo, inicioUtc })
          : await this.evaluarReglaDerivacion({ monitor, vinculo });
      const { configuracion, resultadoEvaluado } = evaluacionFuente;
      const resolucion = this.planificadorTransiciones.resolver({
        resultadoEvaluado,
        estadoActualMonitor: almacenEstadoActual?.buscarPorMonitorId?.(
          monitor?.id
        ) || null,
        retardoFalloSegundos: configuracion.retardoFalloSegundos,
        recibidoEnUtc:
          resultadoEvaluado.evidencia?.observacion?.recibidoEnUtc || null,
        evaluadoEnUtc: inicioUtc
      });

      return this.construirResultado({
        monitor,
        programacion,
        inicioUtc,
        resultado: resolucion.resultado,
        resolucion,
        tipoFuente: vinculo.tipoFuente,
        vinculo,
        causalidadRemota: evaluacionFuente.causalidadRemota || null,
        almacenEstadoActual
      });
    } catch (error) {
      const retiradaDefinitiva = error?.code ===
        CONDICION_FUENTE_FEDERADA_RETIRADA;
      return this.construirResultado({
        monitor,
        programacion,
        inicioUtc,
        resultado: resultadoDesconocido(
          retiradaDefinitiva
            ? CONDICION_FUENTE_FEDERADA_RETIRADA
            : 'evaluacion_telemetria_invalida',
          String(error?.message || 'No se pudo evaluar el monitor de telemetría.')
        ),
        tipoFuente: vinculo?.tipoFuente || null,
        vinculo,
        causalidadRemota: vinculo?.esSenalFederada?.()
          ? error?.causalidadRemota || {
              proyeccionId: vinculo.fuente.proyeccionId,
              condicionFuente: 'no_utilizable',
              codigoError: error?.code || null
            }
          : null,
        almacenEstadoActual,
        error
      });
    }
  }

  async evaluarSenalDirecta({ monitor, vinculo }) {
    const lecturaActual =
      await this.repositorioEstadoActualTelemetria?.buscarPorSenalId?.({
        agenteId: vinculo.agenteId,
        senalId: vinculo.fuente.senalId
      }) || null;
    const lectura = typeof lecturaActual?.serializar === 'function'
      ? lecturaActual.serializar()
      : lecturaActual;
    const configuracion = crearConfiguracionMonitorTelemetria(
      monitor?.configuracion,
      { senal: vinculo.senalOrigen }
    );
    return {
      configuracion,
      resultadoEvaluado: this.evaluador.evaluar({
        configuracion,
        senal: vinculo.senalOrigen,
        lecturaActual: lectura
      })
    };
  }

  async evaluarReglaDerivacion({ monitor, vinculo }) {
    const estadoActualRegla =
      await this.repositorioEstadoActualEvaluacionReglas?.buscarPorRegla?.(
        vinculo.fuente.reglaId
      ) || null;
    return {
      configuracion: crearConfiguracionTemporalMonitorTelemetria(
        monitor?.configuracion
      ),
      resultadoEvaluado: this.evaluadorFuenteRegla.evaluar({
        vinculo,
        estadoActualRegla
      })
    };
  }

  async evaluarSenalFederada({ monitor, vinculo, inicioUtc }) {
    const proyeccionId = vinculo.fuente.proyeccionId;
    const estadoFuente = typeof this.repositorioTelemetriaRemota
      ?.resolverFuenteMonitorizable === 'function'
      ? await this.repositorioTelemetriaRemota.resolverFuenteMonitorizable({
          proyeccionId
        })
      : null;
    if (estadoFuente?.condicionFuente ===
        CONDICION_FUENTE_FEDERADA_RETIRADA) {
      throw crearErrorFuenteFederadaRetirada({
        proyeccionId,
        retirada: estadoFuente.retirada
      });
    }
    const [registroLegado] = estadoFuente === null
      ? await this.repositorioTelemetriaRemota
        ?.listarEstadosSenalSeleccionables?.({ proyeccionId }) || []
      : [];
    const registro = estadoFuente?.registro || registroLegado || null;
    if (!registro) {
      throw new Error('La señal federada no dispone de fotografía publicada.');
    }
    if (registro.completitud?.observable !== 'completa' ||
        registro.estadoProyeccion?.autorizacion !== 'autorizada' ||
        registro.estadoProyeccion?.vigencia !== 'vigente' ||
        registro.estadoProyeccion?.soporte !== 'sostenida' ||
        registro.estadoProyeccion?.compatibilidad !== 'compatible' ||
        registro.fotografiaOperativa?.utilizableAhora !== true) {
      throw new Error('La fotografía federada no está vigente, autorizada, compatible, sostenida y observable.');
    }
    const observacion = registro.payload?.observacion;
    if (!observacion) {
      throw new Error('La fotografía federada no contiene una observación interpretable.');
    }
    if (observacion.vigenteHastaUtc &&
        new Date(observacion.vigenteHastaUtc) <= inicioUtc) {
      throw new Error('La observación federada ha agotado su vigencia declarada.');
    }
    const senal = {
      id: 1,
      agenteId: 1,
      tipoDato: observacion.tipoDato,
      unidad: observacion.unidad
    };
    const lectura = mapearObservacionFederada(observacion);
    const configuracion = crearConfiguracionMonitorTelemetria(
      monitor?.configuracion,
      { senal }
    );
    const evaluado = this.evaluador.evaluar({
      configuracion,
      senal,
      lecturaActual: lectura
    });
    return {
      configuracion,
      resultadoEvaluado: new ResultadoMonitorTelemetria({
        ...evaluado.serializar(),
        evidencia: {
          ...evaluado.evidencia,
          senal: {
            fuenteOrigenId: observacion.fuenteOrigenId,
            senalOrigenId: observacion.senalOrigenId,
            tipoDato: observacion.tipoDato,
            unidad: observacion.unidad
          },
          procedenciaFederada: construirCausaTelemetriaRemota(registro)
        }
      }),
      causalidadRemota: construirCausaTelemetriaRemota(registro)
    };
  }

  construirResultado({
    monitor,
    programacion,
    inicioUtc,
    resultado,
    resolucion = null,
    tipoFuente,
    vinculo = null,
    causalidadRemota = null,
    almacenEstadoActual = null,
    error = null
  }) {
    const finUtc = normalizarFecha(this.reloj());
    const resultadoEvaluado = resolucion?.resultadoEvaluado || resultado;
    const estadoDetectado = resolucion?.estadoEstableRuntime ||
      estadoRuntimeDesdeResultado(resultado.estado);
    const evaluable = !resultadoEvaluado.esDesconocido();
    const normal = estadoDetectado === 'disponible';
    const mensaje = construirMensajeResultado(resultado);
    const detalleError = normal
      ? null
      : resultado.esPendiente()
        ? {
            codigo: 'RETARDO_FALLO_TELEMETRIA_PENDIENTE',
            mensaje,
            causaTecnica: null
          }
        : {
            codigo: estadoDetectado === 'indisponible'
              ? 'CONDICION_TELEMETRIA_INCUMPLIDA'
              : 'TELEMETRIA_NO_EVALUABLE',
            mensaje,
            causaTecnica: error?.code || null
          };
    const intento = {
      numeroIntento: 1,
      inicioUtc,
      finUtc,
      duracionMs: calcularDuracionMs(inicioUtc, finUtc),
      exito: evaluable,
      codigoResultado: resultado.codigoMotivo,
      mensajeResultado: mensaje,
      detalleError,
      detalle: {
        estadoEvaluacion: resultado.estado,
        estadoCandidato: resultado.estadoCandidato,
        resultadoEvaluado: resultadoEvaluado.serializar(),
        evidencia: resultado.evidencia
      }
    };

    const causalidad = resolverCausalidadTelemetriaRemota({
      monitor,
      causalidadRemota,
      estadoDetectado,
      almacenEstadoActual
    });
    return {
      monitorId: monitor?.id,
      nombre: monitor?.nombre,
      tipo: monitor?.tipo || this.tipoMonitor,
      ejecutadoEnUtc: inicioUtc,
      finalizadoEnUtc: finUtc,
      duracionTotalMs: intento.duracionMs,
      programacion: serializarProgramacion(programacion),
      protocolo: {
        nombre: this.tipoMonitor,
        tipoFuente,
        condicionTipo: vinculo?.esSenalDirecta?.()
          ? monitor?.configuracion?.condicion?.tipo || null
          : null
      },
      intentosRealizados: 1,
      intentoExitoso: evaluable ? 1 : null,
      exito: normal,
      estadoDetectado,
      codigoResultado: resultado.codigoMotivo,
      mensajeResultado: mensaje,
      detalleError,
      origenOperativo: causalidadRemota
        ? 'monitor_local_con_telemetria_federada'
        : 'monitor_local',
      causalidadFederada: causalidad.causalidadFederada,
      efectosDerivadosHabilitados: causalidad.efectosDerivadosHabilitados,
      metricaPrincipal: {
        estadoEvaluacion: resultado.estado,
        estadoCandidato: resultado.estadoCandidato,
        fuente: vinculo?.fuente?.serializar?.() || null,
        evidencia: resultado.evidencia,
        resultadoEvaluado: resultadoEvaluado.serializar(),
        retardoSenal: resolucion?.retardoSenal || null
      },
      intentos: [intento]
    };
  }
}

function mapearObservacionFederada(observacion) {
  const campo = {
    numero: 'valorNumero',
    booleano: 'valorBooleano',
    estado: 'valorEstado',
    texto: 'valorTexto'
  }[observacion.tipoDato];
  if (!campo) throw new Error('El tipo de la señal federada no admite monitor directo.');
  return {
    agenteId: 1,
    senalId: 1,
    tipoDato: observacion.tipoDato,
    unidad: observacion.unidad || null,
    [campo]: observacion.valor,
    ultimaObservacionId: observacion.observacionOrigenId || null,
    calidad: observacion.calidad,
    severidadDeclarada: observacion.severidadDeclarada,
    observadoEnUtc: observacion.observadoEnUtc,
    recibidoEnUtc: observacion.recibidoEnUtc
  };
}

function construirCausaTelemetriaRemota(registro) {
  return {
    proyeccionId: registro.proyeccionId,
    installationOrigenId: registro.installationOrigenId,
    elementoOrigenId: registro.elementoOrigenId,
    generacionId: registro.generacionId,
    secuenciaElemento: registro.secuenciaElemento,
    ocurrenciaOrigenId: registro.ocurrenciaOrigenId,
    observacionOrigenId: registro.payload?.observacionOrigenId || null
  };
}

function resolverCausalidadTelemetriaRemota({
  monitor,
  causalidadRemota,
  estadoDetectado,
  almacenEstadoActual
}) {
  if (!causalidadRemota) {
    return { causalidadFederada: null, efectosDerivadosHabilitados: true };
  }
  const anterior = almacenEstadoActual?.buscarPorMonitorId?.(monitor?.id) || null;
  const causalidadAnterior = anterior?.resultadoActual?.causalidadFederada || null;
  const retiradaDefinitiva = esFuenteFederadaRetirada(causalidadRemota);
  const retiradaYaMaterializada = causalidadAnterior?.causas?.some(
    esFuenteFederadaRetirada
  );
  if (retiradaDefinitiva) {
    return {
      causalidadFederada: retiradaYaMaterializada
        ? causalidadAnterior
        : construirCausalidadTelemetriaFederada({
            monitor,
            estadoDetectado,
            causalidadRemota,
            causalidadAnterior
          }),
      efectosDerivadosHabilitados: false
    };
  }
  if (causalidadAnterior?.transicionMonitorId &&
      anterior?.estado === estadoDetectado) {
    return {
      causalidadFederada: causalidadAnterior,
      efectosDerivadosHabilitados: false
    };
  }
  return {
    causalidadFederada: construirCausalidadTelemetriaFederada({
      monitor,
      estadoDetectado,
      causalidadRemota,
      causalidadAnterior
    }),
    efectosDerivadosHabilitados: true
  };
}

function construirCausalidadTelemetriaFederada({
  monitor,
  estadoDetectado,
  causalidadRemota,
  causalidadAnterior
}) {
  const material = serializarCanonico({
    monitorId: monitor?.id,
    configuracion: monitor?.configuracion,
    estadoDetectado,
    causa: causalidadRemota,
    anterior: causalidadAnterior?.transicionMonitorId || null
  });
  return {
    version: 1,
    transicionMonitorId:
      `telemetria-federada:${createHash('sha256').update(material).digest('hex')}`,
    causas: [causalidadRemota]
  };
}

function crearErrorFuenteFederadaRetirada({ proyeccionId, retirada }) {
  const error = new Error(MENSAJE_FUENTE_FEDERADA_RETIRADA);
  error.code = CONDICION_FUENTE_FEDERADA_RETIRADA;
  error.causalidadRemota = {
    proyeccionId,
    condicionFuente: CONDICION_FUENTE_FEDERADA_RETIRADA,
    installationOrigenId: retirada?.installationOrigenId || null,
    elementoOrigenId: retirada?.elementoOrigenId || null,
    generacionId: retirada?.generacionId || null,
    secuenciaElemento: retirada?.secuenciaElemento || null,
    ocurrenciaOrigenId: retirada?.ocurrenciaOrigenId || null,
    retiradaEnUtc: retirada?.retiradaEnUtc || null
  };
  return error;
}

function serializarCanonico(valor) {
  if (Array.isArray(valor)) {
    return `[${valor.map(serializarCanonico).join(',')}]`;
  }
  if (valor && typeof valor === 'object') {
    return `{${Object.keys(valor).sort().map((clave) =>
      `${JSON.stringify(clave)}:${serializarCanonico(valor[clave])}`
    ).join(',')}}`;
  }
  return JSON.stringify(valor ?? null);
}

function resultadoDesconocido(codigoMotivo, detalle, evidencia = null) {
  return new ResultadoMonitorTelemetria({
    estado: ESTADOS_MONITOR_TELEMETRIA.DESCONOCIDO,
    codigoMotivo,
    evidencia: {
      ...(evidencia || {}),
      detalle: normalizarDetalle(detalle)
    }
  });
}

function normalizarDetalle(valor) {
  return String(valor ?? '').trim().slice(0, 512) ||
    'La telemetría no dispone de un valor evaluable.';
}

function estadoRuntimeDesdeResultado(estado) {
  if (estado === ESTADOS_MONITOR_TELEMETRIA.NORMAL) {
    return 'disponible';
  }
  if (estado === ESTADOS_MONITOR_TELEMETRIA.FALLO) {
    return 'indisponible';
  }
  return 'desconocido';
}

function construirMensajeResultado(resultado) {
  const detalle = resultado.evidencia?.detalle;
  if (detalle) {
    return detalle;
  }
  return resultado.esNormal()
    ? 'La telemetría permanece dentro de la condición esperada.'
    : resultado.esFallo()
      ? 'La telemetría incumple la condición configurada.'
      : 'La telemetría no dispone de un valor evaluable.';
}

function serializarProgramacion(programacion) {
  return programacion
    ? {
        proximoIntentoEvaluadoEn: programacion.proximoIntentoEn,
        retrasoSegundos: programacion.retrasoSegundos,
        motivoProgramacion: programacion.motivoProgramacion
      }
    : null;
}

function normalizarFecha(valor, mensaje = 'La fecha de ejecución no es válida.') {
  const fecha = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(fecha.getTime())) {
    throw new Error(mensaje);
  }
  return fecha.toISOString();
}

function calcularDuracionMs(inicioUtc, finUtc) {
  return Math.max(0, Date.parse(finUtc) - Date.parse(inicioUtc));
}
import { createHash } from 'node:crypto';
