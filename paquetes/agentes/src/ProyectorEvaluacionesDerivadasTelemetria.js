import {
  ResultadoEvaluacionRegla
} from './EventosDerivadosTelemetriaAgentes.js';
import {
  FuenteEvaluacionTelemetriaEliminada
} from './FronteraFuenteEvaluacionTelemetria.js';

export const MOTIVOS_PROYECCION_ESTADO_TELEMETRIA = Object.freeze({
  ACTUALIZADO: 'estado_actual_actualizado',
  YA_VIGENTE: 'estado_actual_ya_vigente',
  OBSERVACION_DIFERIDA: 'observacion_no_vigente'
});

export class ResultadoProyeccionEvaluacionTelemetria {
  constructor({ resultado, estadoActual, eventoDerivado } = {}) {
    asegurarResultadoEvaluacion(resultado);
    asegurarRespuestaEstado(resultado, estadoActual);
    asegurarRespuestaEvento(resultado, eventoDerivado);

    this.reglaId = resultado.reglaId;
    this.revisionId = resultado.revisionId;
    this.observacionId = resultado.observacionId;
    this.resultado = resultado.resultado;
    this.estadoActualizado = estadoActual.actualizado;
    this.gobiernaEstadoActual = estadoActual.gobiernaEstadoActual;
    this.motivoEstadoActual = resolverMotivoEstadoActual(estadoActual);
    this.estadoActual = congelarJson(serializarEntidad(estadoActual.estado));
    this.eventoCreado = eventoDerivado.creado;
    this.motivoEvento = eventoDerivado.motivo;
    this.eventoDerivado = congelarJson(serializarEntidad(eventoDerivado.evento));

    Object.freeze(this);
  }

  cambioEstadoActual() {
    return this.estadoActualizado && this.gobiernaEstadoActual;
  }

  generoEvento() {
    return this.eventoCreado;
  }

  serializar() {
    return {
      reglaId: this.reglaId,
      revisionId: this.revisionId,
      observacionId: this.observacionId,
      resultado: this.resultado,
      estadoActualizado: this.estadoActualizado,
      gobiernaEstadoActual: this.gobiernaEstadoActual,
      motivoEstadoActual: this.motivoEstadoActual,
      estadoActual: clonarJson(this.estadoActual),
      eventoCreado: this.eventoCreado,
      motivoEvento: this.motivoEvento,
      eventoDerivado: clonarJson(this.eventoDerivado)
    };
  }
}

export class ProyectorEvaluacionesDerivadasTelemetria {
  constructor({ repositorioEstadoActual, repositorioEventosDerivados } = {}) {
    if (!repositorioEstadoActual || !repositorioEventosDerivados) {
      throw new Error(
        'La proyección requiere los repositorios de estado y eventos derivados.'
      );
    }

    this.repositorioEstadoActual = repositorioEstadoActual;
    this.repositorioEventosDerivados = repositorioEventosDerivados;
  }

  async proyectar(resultado, { conexion } = {}) {
    asegurarResultadoEvaluacion(resultado);
    if (!conexion) {
      throw new Error(
        'La proyección de una evaluación requiere una conexión transaccional.'
      );
    }

    const estadoActual = await this.repositorioEstadoActual.aplicarResultado(
      resultado,
      { conexion }
    );
    if (estadoActual.fuenteVigente === false) {
      throw new FuenteEvaluacionTelemetriaEliminada();
    }
    const eventoDerivado =
      await this.repositorioEventosDerivados.insertarSiCoincide(
        resultado,
        { conexion }
      );

    return new ResultadoProyeccionEvaluacionTelemetria({
      resultado,
      estadoActual,
      eventoDerivado
    });
  }
}

function asegurarResultadoEvaluacion(resultado) {
  if (!(resultado instanceof ResultadoEvaluacionRegla)) {
    throw new Error('Solo puede proyectarse un resultado de evaluación válido.');
  }
}

function asegurarRespuestaEstado(resultado, respuesta) {
  if (
    !respuesta ||
    typeof respuesta.actualizado !== 'boolean' ||
    typeof respuesta.gobiernaEstadoActual !== 'boolean'
  ) {
    throw new Error('La respuesta de proyección del estado actual no es válida.');
  }
  if (respuesta.actualizado && !respuesta.gobiernaEstadoActual) {
    throw new Error(
      'Un estado actualizado debe quedar gobernado por la evaluación aplicada.'
    );
  }
  if (respuesta.gobiernaEstadoActual) {
    asegurarIdentidadEvaluacion(
      resultado,
      respuesta.estado,
      'estado actual'
    );
  }
}

function asegurarRespuestaEvento(resultado, respuesta) {
  if (
    !respuesta ||
    typeof respuesta.creado !== 'boolean' ||
    typeof respuesta.motivo !== 'string'
  ) {
    throw new Error('La respuesta de proyección del evento derivado no es válida.');
  }

  if (!resultado.coincide()) {
    if (
      respuesta.creado ||
      respuesta.evento !== null ||
      respuesta.motivo !== 'resultado_no_coincidente'
    ) {
      throw new Error('Un resultado no coincidente no puede generar un evento.');
    }
    return;
  }

  if (!['evento_creado', 'evento_ya_existente'].includes(respuesta.motivo)) {
    throw new Error('El motivo de persistencia del evento derivado no es válido.');
  }
  if (respuesta.creado !== (respuesta.motivo === 'evento_creado')) {
    throw new Error('La creación y el motivo del evento derivado no son coherentes.');
  }
  asegurarIdentidadEvaluacion(resultado, respuesta.evento, 'evento derivado');
}

function asegurarIdentidadEvaluacion(resultado, entidad, nombre) {
  if (!entidad) {
    throw new Error(`La proyección no devolvió el ${nombre} esperado.`);
  }
  for (const [campo, esperado] of [
    ['reglaId', resultado.reglaId],
    ['revisionId', resultado.revisionId],
    ['observacionId', resultado.observacionId]
  ]) {
    if (Number(entidad[campo]) !== Number(esperado)) {
      throw new Error(`La identidad del ${nombre} no coincide en ${campo}.`);
    }
  }
}

function resolverMotivoEstadoActual(estadoActual) {
  if (estadoActual.actualizado) {
    return MOTIVOS_PROYECCION_ESTADO_TELEMETRIA.ACTUALIZADO;
  }
  if (estadoActual.gobiernaEstadoActual) {
    return MOTIVOS_PROYECCION_ESTADO_TELEMETRIA.YA_VIGENTE;
  }
  return MOTIVOS_PROYECCION_ESTADO_TELEMETRIA.OBSERVACION_DIFERIDA;
}

function serializarEntidad(entidad) {
  if (entidad == null) {
    return null;
  }
  return typeof entidad.serializar === 'function'
    ? entidad.serializar()
    : clonarJson(entidad);
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
