import {
  ESTADOS_MONITOR_TELEMETRIA,
  ResultadoMonitorTelemetria
} from './MonitorTelemetriaAgente.js';
import { normalizarRetardoFalloSegundos } from './ConfiguracionMonitorTelemetria.js';

export class PlanificadorTransicionesTelemetriaPendientes {
  resolver({
    resultadoEvaluado,
    estadoActualMonitor = null,
    retardoFalloSegundos = 0,
    recibidoEnUtc = null,
    evaluadoEnUtc = new Date()
  } = {}) {
    if (!(resultadoEvaluado instanceof ResultadoMonitorTelemetria)) {
      throw new Error('El planificador requiere un resultado de telemetría tipado.');
    }
    const retardoSegundos = normalizarRetardoFalloSegundos(
      retardoFalloSegundos
    );
    const ahoraUtc = normalizarFechaObligatoria(
      evaluadoEnUtc,
      'La fecha de evaluación del retardo no es válida.'
    );
    const retardoPrevio = obtenerRetardoPrevio(estadoActualMonitor);
    const estadoEstable = resolverEstadoEstable(estadoActualMonitor);

    if (retardoSegundos === 0) {
      return construirResolucionEstable({
        resultado: resultadoEvaluado,
        retardoSenal: construirRetardoInactivo(resultadoEvaluado)
      });
    }

    if (resultadoEvaluado.esDesconocido()) {
      return construirResolucionEstable({
        resultado: resultadoEvaluado,
        retardoSenal: construirRetardoFinalizado({
          retardoSegundos,
          resultadoEvaluado,
          estadoEstableConservado: estadoEstable,
          evento: retardoPrevio?.pendiente
            ? construirEvento({
                tipo: 'retardo_senal_cancelado',
                estadoEstable,
                retardoSegundos,
                iniciadoEnUtc: retardoPrevio.iniciadoEnUtc,
                venceEnUtc: retardoPrevio.venceEnUtc,
                registradoEnUtc: ahoraUtc,
                motivo: 'resultado_no_evaluable'
              })
            : null
        })
      });
    }

    if (resultadoEvaluado.esNormal()) {
      return construirResolucionEstable({
        resultado: resultadoEvaluado,
        retardoSenal: construirRetardoFinalizado({
          retardoSegundos,
          resultadoEvaluado,
          evento: retardoPrevio?.pendiente
            ? construirEvento({
                tipo: 'retardo_senal_cancelado',
                estadoEstable,
                retardoSegundos,
                iniciadoEnUtc: retardoPrevio.iniciadoEnUtc,
                venceEnUtc: retardoPrevio.venceEnUtc,
                registradoEnUtc: ahoraUtc,
                motivo: 'senal_en_tolerancia'
              })
            : null
        })
      });
    }

    if (estadoEstable === 'indisponible') {
      return construirResolucionEstable({
        resultado: resultadoEvaluado,
        retardoSenal: construirRetardoFinalizado({
          retardoSegundos,
          resultadoEvaluado,
          evento: null
        })
      });
    }

    const recibido = normalizarFechaOpcional(recibidoEnUtc);
    if (!recibido) {
      const desconocido = new ResultadoMonitorTelemetria({
        estado: ESTADOS_MONITOR_TELEMETRIA.DESCONOCIDO,
        codigoMotivo: 'retardo_fallo_sin_fecha_recibida',
        evidencia: {
          ...(resultadoEvaluado.evidencia || {}),
          detalle:
            'No se puede medir el retardo sin la fecha de recepción controlada por Sentinelia.'
        }
      });
      return construirResolucionEstable({
        resultado: desconocido,
        retardoSenal: construirRetardoFinalizado({
          retardoSegundos,
          resultadoEvaluado: desconocido,
          estadoEstableConservado: estadoEstable,
          evento: retardoPrevio?.pendiente
            ? construirEvento({
                tipo: 'retardo_senal_cancelado',
                estadoEstable,
                retardoSegundos,
                iniciadoEnUtc: retardoPrevio.iniciadoEnUtc,
                venceEnUtc: retardoPrevio.venceEnUtc,
                registradoEnUtc: ahoraUtc,
                motivo: 'fecha_recibida_ausente'
              })
            : null
        })
      });
    }

    const conservaTransicion = esRetardoFalloPendiente(retardoPrevio);
    const iniciadoEnUtc = conservaTransicion
      ? normalizarFechaOpcional(retardoPrevio.iniciadoEnUtc) || recibido
      : recibido;
    const inicioMs = Date.parse(iniciadoEnUtc);
    const ahoraMs = Date.parse(ahoraUtc);
    const venceEnUtc = new Date(
      inicioMs + retardoSegundos * 1000
    ).toISOString();
    const transcurridoSegundos = Math.max(
      0,
      Math.floor((ahoraMs - inicioMs) / 1000)
    );
    const restanteSegundos = Math.max(
      0,
      Math.ceil((Date.parse(venceEnUtc) - ahoraMs) / 1000)
    );

    if (ahoraMs >= Date.parse(venceEnUtc)) {
      return construirResolucionEstable({
        resultado: resultadoEvaluado,
        retardoSenal: {
          activo: true,
          retardoSegundos,
          estadoEstable: ESTADOS_MONITOR_TELEMETRIA.FALLO,
          estadoCandidato: ESTADOS_MONITOR_TELEMETRIA.FALLO,
          salidaEstable: false,
          salidaCandidata: false,
          pendiente: false,
          aplicado: true,
          iniciadoEnUtc,
          venceEnUtc,
          transcurridoSegundos,
          restanteSegundos: 0,
          evento: construirEvento({
            tipo: 'retardo_senal_aplicado',
            estadoEstable,
            retardoSegundos,
            iniciadoEnUtc,
            venceEnUtc,
            registradoEnUtc: ahoraUtc,
            transcurridoSegundos,
            restanteSegundos: 0,
            motivo: 'fallo_sostenido'
          })
        }
      });
    }

    const pendiente = new ResultadoMonitorTelemetria({
      estado: ESTADOS_MONITOR_TELEMETRIA.PENDIENTE,
      codigoMotivo: 'retardo_fallo_pendiente',
      estadoCandidato: ESTADOS_MONITOR_TELEMETRIA.FALLO,
      evidencia: {
        ...(resultadoEvaluado.evidencia || {}),
        detalle:
          `El fallo debe permanecer ${retardoSegundos} segundos antes de aplicarse.`
      }
    });
    return {
      resultado: pendiente,
      resultadoEvaluado,
      estadoEstableRuntime: estadoEstable,
      retardoSenal: {
        activo: true,
        retardoSegundos,
        estadoEstable: estadoTelemetriaDesdeRuntime(estadoEstable),
        estadoCandidato: ESTADOS_MONITOR_TELEMETRIA.FALLO,
        salidaEstable: salidaDesdeEstadoRuntime(estadoEstable),
        salidaCandidata: false,
        pendiente: true,
        aplicado: false,
        iniciadoEnUtc,
        venceEnUtc,
        transcurridoSegundos,
        restanteSegundos,
        evento: construirEvento({
          tipo: conservaTransicion
            ? 'retardo_senal_pendiente'
            : 'retardo_senal_iniciado',
          estadoEstable,
          retardoSegundos,
          iniciadoEnUtc,
          venceEnUtc,
          registradoEnUtc: ahoraUtc,
          transcurridoSegundos,
          restanteSegundos,
          motivo: 'fallo_candidato'
        })
      }
    };
  }
}

function construirResolucionEstable({ resultado, retardoSenal }) {
  return {
    resultado,
    resultadoEvaluado: resultado,
    estadoEstableRuntime: estadoRuntimeDesdeResultado(resultado),
    retardoSenal
  };
}

function construirRetardoInactivo(resultado) {
  const estado = resultado.esNormal()
    ? ESTADOS_MONITOR_TELEMETRIA.NORMAL
    : resultado.esFallo()
      ? ESTADOS_MONITOR_TELEMETRIA.FALLO
      : ESTADOS_MONITOR_TELEMETRIA.DESCONOCIDO;
  return {
    activo: false,
    retardoSegundos: 0,
    estadoEstable: estado,
    estadoCandidato: estado,
    salidaEstable: salidaDesdeEstadoTelemetria(estado),
    salidaCandidata: salidaDesdeEstadoTelemetria(estado),
    pendiente: false,
    aplicado: false,
    iniciadoEnUtc: null,
    venceEnUtc: null,
    restanteSegundos: 0,
    evento: null
  };
}

function construirRetardoFinalizado({
  retardoSegundos,
  resultadoEvaluado,
  estadoEstableConservado = null,
  evento
}) {
  const estado = resultadoEvaluado.esNormal()
    ? ESTADOS_MONITOR_TELEMETRIA.NORMAL
    : resultadoEvaluado.esFallo()
      ? ESTADOS_MONITOR_TELEMETRIA.FALLO
      : estadoEstableConservado
        ? estadoTelemetriaDesdeRuntime(estadoEstableConservado)
        : ESTADOS_MONITOR_TELEMETRIA.DESCONOCIDO;
  return {
    activo: true,
    retardoSegundos,
    estadoEstable: estado,
    estadoCandidato: estado,
    salidaEstable: salidaDesdeEstadoTelemetria(estado),
    salidaCandidata: salidaDesdeEstadoTelemetria(estado),
    pendiente: false,
    aplicado: false,
    iniciadoEnUtc: null,
    venceEnUtc: null,
    restanteSegundos: 0,
    evento
  };
}

function construirEvento({
  tipo,
  estadoEstable,
  retardoSegundos,
  iniciadoEnUtc,
  venceEnUtc,
  registradoEnUtc,
  transcurridoSegundos = null,
  restanteSegundos = null,
  motivo
}) {
  return {
    tipo,
    resultadoAnterior: salidaDesdeEstadoRuntime(estadoEstable),
    resultadoNuevo: false,
    estadoAnterior: estadoTelemetriaDesdeRuntime(estadoEstable),
    estadoNuevo: ESTADOS_MONITOR_TELEMETRIA.FALLO,
    duracionExigidaSegundos: retardoSegundos,
    duracionObservadaSegundos:
      transcurridoSegundos ?? calcularTranscurrido(iniciadoEnUtc, registradoEnUtc),
    condicionEstableDesdeUtc: iniciadoEnUtc || null,
    venceEnUtc: venceEnUtc || null,
    registradoEnUtc,
    restanteSegundos,
    motivo
  };
}

function obtenerRetardoPrevio(estadoActualMonitor) {
  const retardo = estadoActualMonitor?.resultadoActual?.metricaPrincipal
    ?.retardoSenal;
  return retardo && typeof retardo === 'object' ? retardo : null;
}

function esRetardoFalloPendiente(retardo) {
  return Boolean(
    retardo?.pendiente &&
    (
      retardo.estadoCandidato === ESTADOS_MONITOR_TELEMETRIA.FALLO ||
      retardo.salidaCandidata === false
    ) &&
    normalizarFechaOpcional(retardo.iniciadoEnUtc)
  );
}

function resolverEstadoEstable(estadoActualMonitor) {
  if (!estadoActualMonitor?.ejecutadoTodavia) {
    return 'desconocido';
  }
  const estado = String(estadoActualMonitor.estado || '').trim().toLowerCase();
  if (estado === 'desconocido') {
    const estadoRetardo = String(
      obtenerRetardoPrevio(estadoActualMonitor)?.estadoEstable || ''
    ).trim().toLowerCase();
    if (estadoRetardo === ESTADOS_MONITOR_TELEMETRIA.NORMAL) {
      return 'disponible';
    }
    if (estadoRetardo === ESTADOS_MONITOR_TELEMETRIA.FALLO) {
      return 'indisponible';
    }
  }
  return ['disponible', 'indisponible', 'desconocido'].includes(estado)
    ? estado
    : 'desconocido';
}

function estadoRuntimeDesdeResultado(resultado) {
  if (resultado.esNormal()) {
    return 'disponible';
  }
  if (resultado.esFallo()) {
    return 'indisponible';
  }
  return 'desconocido';
}

function estadoTelemetriaDesdeRuntime(estado) {
  if (estado === 'disponible') {
    return ESTADOS_MONITOR_TELEMETRIA.NORMAL;
  }
  if (estado === 'indisponible') {
    return ESTADOS_MONITOR_TELEMETRIA.FALLO;
  }
  return ESTADOS_MONITOR_TELEMETRIA.DESCONOCIDO;
}

function salidaDesdeEstadoRuntime(estado) {
  if (estado === 'disponible') {
    return true;
  }
  if (estado === 'indisponible') {
    return false;
  }
  return null;
}

function salidaDesdeEstadoTelemetria(estado) {
  if (estado === ESTADOS_MONITOR_TELEMETRIA.NORMAL) {
    return true;
  }
  if (estado === ESTADOS_MONITOR_TELEMETRIA.FALLO) {
    return false;
  }
  return null;
}

function calcularTranscurrido(inicioUtc, finUtc) {
  const inicioMs = Date.parse(String(inicioUtc || ''));
  const finMs = Date.parse(String(finUtc || ''));
  if (Number.isNaN(inicioMs) || Number.isNaN(finMs)) {
    return null;
  }
  return Math.max(0, Math.floor((finMs - inicioMs) / 1000));
}

function normalizarFechaObligatoria(valor, mensaje) {
  const fecha = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(fecha.getTime())) {
    throw new Error(mensaje);
  }
  return fecha.toISOString();
}

function normalizarFechaOpcional(valor) {
  if (!valor) {
    return null;
  }
  const fecha = valor instanceof Date ? valor : new Date(valor);
  return Number.isNaN(fecha.getTime()) ? null : fecha.toISOString();
}
