import {
  ESTADOS_REGLA_DERIVACION_TELEMETRIA,
  RESULTADOS_EVALUACION_REGLA_TELEMETRIA
} from '../../agentes/src/EventosDerivadosTelemetriaAgentes.js';
import {
  ESTADOS_MONITOR_TELEMETRIA,
  ResultadoMonitorTelemetria
} from './MonitorTelemetriaAgente.js';

export class EvaluadorFuenteReglaMonitorTelemetria {
  evaluar({ vinculo, estadoActualRegla = null } = {}) {
    if (!vinculo?.esReglaDerivacion?.()) {
      throw new Error('El evaluador derivado requiere un vínculo a una regla 5.20a.');
    }

    if (vinculo.estadoRegla !== ESTADOS_REGLA_DERIVACION_TELEMETRIA.ACTIVA) {
      return resultadoDesconocido({
        codigoMotivo: 'regla_derivacion_deshabilitada',
        detalle: 'La regla de derivación vinculada está deshabilitada.',
        vinculo,
        estadoActualRegla
      });
    }

    if (!estadoActualRegla) {
      return resultadoDesconocido({
        codigoMotivo: 'regla_derivacion_sin_estado_actual',
        detalle: 'La regla de derivación todavía no dispone de una evaluación vigente.',
        vinculo,
        estadoActualRegla
      });
    }

    const incompatibilidad = comprobarIdentidad({ vinculo, estadoActualRegla });
    if (incompatibilidad) {
      return resultadoDesconocido({
        codigoMotivo: incompatibilidad.codigoMotivo,
        detalle: incompatibilidad.detalle,
        vinculo,
        estadoActualRegla
      });
    }

    const evidencia = construirEvidencia({ vinculo, estadoActualRegla });
    if (
      estadoActualRegla.resultado ===
      RESULTADOS_EVALUACION_REGLA_TELEMETRIA.COINCIDE
    ) {
      return new ResultadoMonitorTelemetria({
        estado: ESTADOS_MONITOR_TELEMETRIA.FALLO,
        codigoMotivo: 'regla_derivacion_coincide',
        evidencia
      });
    }
    if (
      estadoActualRegla.resultado ===
      RESULTADOS_EVALUACION_REGLA_TELEMETRIA.NO_COINCIDE
    ) {
      return new ResultadoMonitorTelemetria({
        estado: ESTADOS_MONITOR_TELEMETRIA.NORMAL,
        codigoMotivo: 'regla_derivacion_no_coincide',
        evidencia
      });
    }
    if (
      estadoActualRegla.resultado ===
      RESULTADOS_EVALUACION_REGLA_TELEMETRIA.NO_EVALUABLE
    ) {
      return resultadoDesconocido({
        codigoMotivo: 'regla_derivacion_no_evaluable',
        detalle:
          estadoActualRegla.explicacion ||
          'La evaluación vigente de la regla no es evaluable.',
        vinculo,
        estadoActualRegla
      });
    }

    return resultadoDesconocido({
      codigoMotivo: 'resultado_regla_derivacion_invalido',
      detalle: 'El estado vigente de la regla contiene un resultado desconocido.',
      vinculo,
      estadoActualRegla
    });
  }
}

function comprobarIdentidad({ vinculo, estadoActualRegla }) {
  for (const [campo, actual, esperado] of [
    ['regla', estadoActualRegla.reglaId, vinculo.fuente.reglaId],
    ['agente', estadoActualRegla.agenteId, vinculo.agenteId],
    ['señal', estadoActualRegla.senalId, vinculo.senalOrigen.id],
    ['tenant', estadoActualRegla.tenantId, vinculo.scope.tenantId],
    ['empresa', estadoActualRegla.empresaId, vinculo.scope.empresaId],
    ['sitio', estadoActualRegla.sitioId, vinculo.scope.sitioId]
  ]) {
    if (Number(actual) !== Number(esperado)) {
      return {
        codigoMotivo: 'identidad_estado_regla_incompatible',
        detalle: `El estado vigente de la regla no coincide con el ${campo} vinculado.`
      };
    }
  }
  return null;
}

function resultadoDesconocido({ codigoMotivo, detalle, vinculo, estadoActualRegla }) {
  return new ResultadoMonitorTelemetria({
    estado: ESTADOS_MONITOR_TELEMETRIA.DESCONOCIDO,
    codigoMotivo,
    evidencia: {
      ...construirEvidencia({ vinculo, estadoActualRegla }),
      detalle
    }
  });
}

function construirEvidencia({ vinculo, estadoActualRegla }) {
  const estado = serializar(estadoActualRegla);
  return {
    senal: { ...vinculo.senalOrigen },
    regla: {
      id: vinculo.fuente.reglaId,
      estado: vinculo.estadoRegla,
      revisionId: estado?.revisionId || null,
      resultado: estado?.resultado || null,
      codigoMotivo: estado?.codigoMotivo || null,
      condicionCanonica: estado?.condicionCanonica || null,
      severidadCalculada: estado?.severidadCalculada || null,
      mensajeOperativo: estado?.mensajeOperativo || null,
      evidenciaContextual: estado?.evidenciaContextual || null
    },
    observacion: estado
      ? {
          id: estado.observacionId || null,
          valor: estado.valorEvaluado,
          calidad: estado.calidad || null,
          observadoEnUtc: estado.observadoEnUtc || null,
          recibidoEnUtc: estado.recibidoEnUtc || null,
          evaluadoEnUtc: estado.evaluadoEnUtc || null
        }
      : null,
    detalle:
      estado?.explicacion ||
      'La fuente del monitor es el estado vigente de una regla de derivación.'
  };
}

function serializar(entidad) {
  if (!entidad) {
    return null;
  }
  return typeof entidad.serializar === 'function'
    ? entidad.serializar()
    : entidad;
}
