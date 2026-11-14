import {
  normalizarInterpretacionEstadoMonitorPorTipo
} from '../../../../paquetes/monitores/src/SemanticaEstadoMonitor.js';

const MENSAJE_FALLO_POR_RESPUESTA = 'Falló porque respondió.';
const MENSAJE_AUSENCIA_RESPUESTA_ESPERADA =
  'La ausencia de respuesta cumple la condición esperada.';

function normalizarEstadoDetectado(resultado) {
  const estado = String(resultado?.estadoDetectado || '')
    .trim()
    .toLowerCase();

  if (estado) {
    return estado;
  }

  return resultado?.exito ? 'disponible' : 'indisponible';
}

function invertirEstado(estado) {
  if (estado === 'disponible') {
    return 'indisponible';
  }

  if (estado === 'indisponible') {
    return 'disponible';
  }

  return estado;
}

function clonarObjetoPlano(valor) {
  if (Array.isArray(valor)) {
    return JSON.parse(JSON.stringify(valor));
  }

  if (!valor || typeof valor !== 'object') {
    return null;
  }

  return JSON.parse(JSON.stringify(valor));
}

export class TraductorResultadoTecnicoAEstadoLogico {
  traducir({ monitor, resultado }) {
    if (!resultado || typeof resultado !== 'object') {
      return resultado;
    }

    if (resultado.resultadoInterpretado === true) {
      return resultado;
    }

    const interpretacionEstado = normalizarInterpretacionEstadoMonitorPorTipo({
      tipo: monitor?.tipo,
      valor: monitor?.interpretacionEstado
    });
    const estadoTecnicoDetectado = normalizarEstadoDetectado(resultado);
    const exitoTecnico = Boolean(resultado.exito);
    const codigoResultadoTecnico = String(
      resultado.codigoResultado || 'sin_resultado'
    );
    const mensajeResultadoTecnico = String(
      resultado.mensajeResultado || 'Sin mensaje de resultado.'
    );
    const estadoLogicoDetectado = interpretacionEstado === 'invertida'
      ? invertirEstado(estadoTecnicoDetectado)
      : estadoTecnicoDetectado;
    const exitoLogico = estadoLogicoDetectado === 'disponible';
    const resultadoInterpretado =
      interpretacionEstado === 'invertida' &&
      estadoLogicoDetectado !== estadoTecnicoDetectado;
    const interpretacionResultado = {
      aplicada: resultadoInterpretado,
      interpretacionEstado,
      estadoTecnicoDetectado,
      estadoLogicoDetectado,
      exitoTecnico,
      exitoLogico,
      codigoResultadoTecnico,
      mensajeResultadoTecnico,
      mensajeInterpretacion: this.construirMensajeInterpretacion({
        interpretacionEstado,
        estadoTecnicoDetectado,
        estadoLogicoDetectado
      })
    };

    return {
      ...resultado,
      interpretacionEstado,
      resultadoInterpretado,
      interpretacionResultado,
      estadoTecnicoDetectado,
      exitoTecnico,
      codigoResultadoTecnico,
      mensajeResultadoTecnico,
      detalleErrorTecnico: clonarObjetoPlano(resultado.detalleError),
      estadoDetectado: estadoLogicoDetectado,
      exito: exitoLogico,
      codigoResultado: this.construirCodigoResultado({
        resultado,
        interpretacionEstado,
        estadoTecnicoDetectado,
        estadoLogicoDetectado
      }),
      mensajeResultado: this.construirMensajeResultado({
        resultado,
        interpretacionEstado,
        estadoTecnicoDetectado,
        estadoLogicoDetectado
      }),
      detalleError: this.construirDetalleError({
        resultado,
        estadoLogicoDetectado,
        resultadoInterpretado
      })
    };
  }

  construirCodigoResultado({
    resultado,
    interpretacionEstado,
    estadoTecnicoDetectado,
    estadoLogicoDetectado
  }) {
    if (interpretacionEstado !== 'invertida') {
      return String(resultado.codigoResultado || 'sin_resultado');
    }

    if (
      estadoTecnicoDetectado === 'disponible' &&
      estadoLogicoDetectado === 'indisponible'
    ) {
      return 'fallo_por_respuesta';
    }

    if (
      estadoTecnicoDetectado === 'indisponible' &&
      estadoLogicoDetectado === 'disponible'
    ) {
      return 'ausencia_respuesta_esperada';
    }

    return String(resultado.codigoResultado || 'sin_resultado');
  }

  construirMensajeResultado({
    resultado,
    interpretacionEstado,
    estadoTecnicoDetectado,
    estadoLogicoDetectado
  }) {
    if (interpretacionEstado !== 'invertida') {
      return String(resultado.mensajeResultado || 'Sin mensaje de resultado.');
    }

    if (
      estadoTecnicoDetectado === 'disponible' &&
      estadoLogicoDetectado === 'indisponible'
    ) {
      return MENSAJE_FALLO_POR_RESPUESTA;
    }

    if (
      estadoTecnicoDetectado === 'indisponible' &&
      estadoLogicoDetectado === 'disponible'
    ) {
      return MENSAJE_AUSENCIA_RESPUESTA_ESPERADA;
    }

    return String(resultado.mensajeResultado || 'Sin mensaje de resultado.');
  }

  construirMensajeInterpretacion({
    interpretacionEstado,
    estadoTecnicoDetectado,
    estadoLogicoDetectado
  }) {
    if (interpretacionEstado !== 'invertida') {
      return null;
    }

    if (
      estadoTecnicoDetectado === 'disponible' &&
      estadoLogicoDetectado === 'indisponible'
    ) {
      return MENSAJE_FALLO_POR_RESPUESTA;
    }

    if (
      estadoTecnicoDetectado === 'indisponible' &&
      estadoLogicoDetectado === 'disponible'
    ) {
      return MENSAJE_AUSENCIA_RESPUESTA_ESPERADA;
    }

    return null;
  }

  construirDetalleError({
    resultado,
    estadoLogicoDetectado,
    resultadoInterpretado
  }) {
    if (estadoLogicoDetectado === 'disponible') {
      return null;
    }

    if (resultado.detalleError) {
      return resultado.detalleError;
    }

    if (!resultadoInterpretado) {
      return null;
    }

    return {
      codigo: 'RESPUESTA_INESPERADA',
      mensaje: MENSAJE_FALLO_POR_RESPUESTA
    };
  }
}
