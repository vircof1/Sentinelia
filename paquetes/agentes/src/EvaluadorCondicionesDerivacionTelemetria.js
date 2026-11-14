import {
  CALIDADES_TELEMETRIA_AGENTE,
  TIPOS_DATO_TELEMETRIA_AGENTE
} from './TelemetriaAgente.js';
import {
  TIPOS_DATO_INTERNOS_TELEMETRIA_AGENTE
} from './TiposDatoTelemetriaAgente.js';
import {
  normalizarValorDuracionTelemetria,
  normalizarValorMomentoUtcTelemetria
} from './ContratoTelemetriaTemporalAgente.js';
import {
  LIMITES_REGEX_TELEMETRIA,
  contarCoincidenciasRegexTelemetria,
  evaluarExistenciaRegexTelemetria
} from './MotorRegexSeguroTelemetria.js';
import {
  CondicionDerivacionTelemetria,
  OPERADORES_CONDICION_DERIVACION_TELEMETRIA,
  RESULTADOS_EVALUACION_REGLA_TELEMETRIA,
  ReglaDerivacionTelemetria,
  RevisionReglaDerivacionTelemetria,
  TIPOS_CONDICION_DERIVACION_TELEMETRIA,
  crearResultadoEvaluacionRegla
} from './EventosDerivadosTelemetriaAgentes.js';

export const CODIGOS_MOTIVO_EVALUACION_TELEMETRIA = Object.freeze({
  CONDICION_CUMPLIDA: 'condicion_cumplida',
  CONDICION_NO_CUMPLIDA: 'condicion_no_cumplida',
  TIPO_SENAL_INCOMPATIBLE: 'tipo_senal_incompatible',
  TIPO_OBSERVACION_INCOMPATIBLE: 'tipo_observacion_incompatible',
  UNIDAD_SENAL_INCOMPATIBLE: 'unidad_senal_incompatible',
  UNIDAD_OBSERVACION_INCOMPATIBLE: 'unidad_observacion_incompatible',
  VALOR_NO_EVALUABLE: 'valor_no_evaluable',
  CALIDAD_NO_EVALUABLE: 'calidad_no_evaluable'
});

const TIPOS_DATO_VALIDOS = new Set(
  Object.values(TIPOS_DATO_INTERNOS_TELEMETRIA_AGENTE)
);
const CALIDADES_VALIDAS = new Set(Object.values(CALIDADES_TELEMETRIA_AGENTE));

export function crearCondicionTipadaDerivacionTelemetria({
  senal,
  tipo,
  operador,
  umbral,
  umbralUtc,
  modo,
  patron,
  opciones,
  valorEsperado,
  calidadEsperada,
  version = 1
} = {}) {
  const guardrail = normalizarSenalCatalogada(senal);

  if (tipo === TIPOS_CONDICION_DERIVACION_TELEMETRIA.CALIDAD) {
    return new CondicionDerivacionTelemetria({
      tipo,
      version,
      configuracion: {
        operador,
        calidadEsperada
      }
    });
  }

  if (guardrail.tipoDato === TIPOS_DATO_TELEMETRIA_AGENTE.JSON) {
    throw new Error('No se admiten condiciones directas sobre señales JSON.');
  }
  const tipoDatoEsperado = tipo ===
    TIPOS_CONDICION_DERIVACION_TELEMETRIA.TEXTO_REGEX
    ? TIPOS_DATO_TELEMETRIA_AGENTE.TEXTO
    : tipo;
  if (guardrail.tipoDato !== tipoDatoEsperado) {
    throw new Error(
      'El tipo de condición debe coincidir exactamente con el tipo catalogado de la señal.'
    );
  }

  const configuracion = tipo === TIPOS_CONDICION_DERIVACION_TELEMETRIA.NUMERO
    ? { operador, umbral, unidad: guardrail.unidad }
    : tipo === TIPOS_CONDICION_DERIVACION_TELEMETRIA.DURACION
      ? { operador, umbral }
      : tipo === TIPOS_CONDICION_DERIVACION_TELEMETRIA.MOMENTO_UTC
        ? { operador, umbralUtc }
        : tipo === TIPOS_CONDICION_DERIVACION_TELEMETRIA.TEXTO_REGEX
          ? {
              modo,
              patron,
              opciones,
              operador: modo === 'existe' ? null : operador,
              umbral: modo === 'existe' ? null : umbral
            }
          : { operador, valorEsperado, unidad: guardrail.unidad };

  return new CondicionDerivacionTelemetria({ tipo, version, configuracion });
}

export class EvaluadorCondicionesDerivacionTelemetria {
  evaluar({ regla, revision, senal, observacion, evaluadoEnUtc } = {}) {
    comprobarPrecondiciones({ regla, revision, senal });
    const guardrail = normalizarSenalCatalogada(senal);
    const decision = evaluarContraGuardrail({
      condicion: revision.condicion,
      senal: guardrail,
      observacion
    });

    const observacionEvidencia = decision.valorEvidencia === undefined
      ? observacion
      : { ...observacion, valor: decision.valorEvidencia };
    return crearResultadoEvaluacionRegla({
      regla,
      revision,
      observacion: observacionEvidencia,
      resultado: decision.resultado,
      codigoMotivo: decision.codigoMotivo,
      explicacion: decision.explicacion,
      evaluadoEnUtc,
      evidenciaContextual: {
        senalCatalogada: {
          id: guardrail.id,
          tipoDato: guardrail.tipoDato,
          unidad: guardrail.unidad
        },
        ...(decision.evidenciaContextual || {})
      }
    });
  }
}

function comprobarPrecondiciones({ regla, revision, senal }) {
  if (!(regla instanceof ReglaDerivacionTelemetria)) {
    throw new Error('La regla que se desea evaluar no es válida.');
  }
  if (!regla.estaActiva()) {
    throw new Error('Una regla deshabilitada no puede evaluarse.');
  }
  if (!(revision instanceof RevisionReglaDerivacionTelemetria)) {
    throw new Error('La revisión que se desea evaluar no es válida.');
  }
  if (!regla.admiteRevision(revision)) {
    throw new Error('La revisión que se desea evaluar no pertenece a la regla.');
  }
  const guardrail = normalizarSenalCatalogada(senal);
  if (guardrail.id !== regla.senalId || guardrail.agenteId !== regla.agenteId) {
    throw new Error('La señal catalogada no pertenece al objetivo de la regla.');
  }
}

function evaluarContraGuardrail({ condicion, senal, observacion }) {
  const incompatibilidadCatalogo = comprobarCatalogoContraCondicion(
    condicion,
    senal
  );
  if (incompatibilidadCatalogo) {
    return incompatibilidadCatalogo;
  }

  const incompatibilidadObservacion = comprobarObservacionContraCatalogo(
    observacion,
    senal
  );
  if (incompatibilidadObservacion) {
    return incompatibilidadObservacion;
  }

  if (condicion.tipo === TIPOS_CONDICION_DERIVACION_TELEMETRIA.CALIDAD) {
    return evaluarCalidad(condicion, observacion.calidad);
  }

  if (condicion.tipo === TIPOS_CONDICION_DERIVACION_TELEMETRIA.TEXTO_REGEX) {
    const longitudTexto = typeof observacion.valor === 'string'
      ? Array.from(observacion.valor).length
      : null;
    if (
      typeof observacion.valor !== 'string' ||
      longitudTexto > LIMITES_REGEX_TELEMETRIA.TEXTO_CARACTERES
    ) {
      return {
        ...noEvaluable(
          CODIGOS_MOTIVO_EVALUACION_TELEMETRIA.VALOR_NO_EVALUABLE,
          'El valor textual no respeta el límite de la condición regex.'
        ),
        valorEvidencia: longitudTexto === null
          ? '[valor textual redactado]'
          : `[texto redactado; ${longitudTexto} caracteres]`
      };
    }
    const evaluacionRegex = evaluarCondicionRegexTelemetria({
      configuracion: condicion.configuracion,
      texto: observacion.valor
    });
    return {
      ...resolverCoincidencia(evaluacionRegex.cumple),
      valorEvidencia: evaluacionRegex.valorEvidencia,
      evidenciaContextual: { regex: evaluacionRegex.evidencia }
    };
  }

  if (!esValorEstrictoDelTipo(observacion.valor, condicion.tipo)) {
    return noEvaluable(
      CODIGOS_MOTIVO_EVALUACION_TELEMETRIA.VALOR_NO_EVALUABLE,
      'El valor observado no corresponde estrictamente al tipo declarado.'
    );
  }

  const cumple = compararValor({
    valor: condicion.tipo === TIPOS_CONDICION_DERIVACION_TELEMETRIA.MOMENTO_UTC
      ? Date.parse(observacion.valor)
      : observacion.valor,
    operador: condicion.configuracion.operador,
    esperado: condicion.tipo === TIPOS_CONDICION_DERIVACION_TELEMETRIA.MOMENTO_UTC
      ? Date.parse(condicion.configuracion.umbralUtc)
      : [
          TIPOS_CONDICION_DERIVACION_TELEMETRIA.NUMERO,
          TIPOS_CONDICION_DERIVACION_TELEMETRIA.DURACION
        ].includes(condicion.tipo)
        ? condicion.configuracion.umbral
        : condicion.configuracion.valorEsperado
  });
  return resolverCoincidencia(cumple);
}

export function evaluarCondicionRegexTelemetria({ configuracion, texto } = {}) {
  if (configuracion?.modo === 'existe') {
    const evaluacion = evaluarExistenciaRegexTelemetria({
      patron: configuracion.patron,
      opciones: configuracion.opciones,
      texto
    });
    return Object.freeze({
      cumple: evaluacion.coincide,
      valorEvidencia: evaluacion.valorEvidencia,
      evidencia: evaluacion.evidencia
    });
  }
  if (configuracion?.modo === 'conteo') {
    const evaluacion = contarCoincidenciasRegexTelemetria({
      patron: configuracion.patron,
      opciones: configuracion.opciones,
      texto,
      operador: configuracion.operador,
      umbral: configuracion.umbral
    });
    return Object.freeze({
      cumple: compararValor({
        valor: evaluacion.conteo,
        operador: configuracion.operador,
        esperado: configuracion.umbral
      }),
      valorEvidencia: evaluacion.valorEvidencia,
      evidencia: evaluacion.evidencia
    });
  }
  throw new Error('El modo de evaluación regex no está soportado.');
}

function comprobarCatalogoContraCondicion(condicion, senal) {
  if (condicion.tipo === TIPOS_CONDICION_DERIVACION_TELEMETRIA.CALIDAD) {
    return null;
  }
  const tipoDatoEsperado = condicion.tipo ===
    TIPOS_CONDICION_DERIVACION_TELEMETRIA.TEXTO_REGEX
    ? TIPOS_DATO_TELEMETRIA_AGENTE.TEXTO
    : condicion.tipo;
  if (senal.tipoDato !== tipoDatoEsperado) {
    return noEvaluable(
      CODIGOS_MOTIVO_EVALUACION_TELEMETRIA.TIPO_SENAL_INCOMPATIBLE,
      'El tipo catalogado de la señal no coincide con la condición.'
    );
  }
  if (condicion.tipo === TIPOS_CONDICION_DERIVACION_TELEMETRIA.TEXTO_REGEX) {
    return null;
  }
  if (
    [
      TIPOS_CONDICION_DERIVACION_TELEMETRIA.DURACION,
      TIPOS_CONDICION_DERIVACION_TELEMETRIA.MOMENTO_UTC
    ].includes(condicion.tipo)
      ? senal.unidad !== null
      : senal.unidad !== condicion.configuracion.unidad
  ) {
    return noEvaluable(
      CODIGOS_MOTIVO_EVALUACION_TELEMETRIA.UNIDAD_SENAL_INCOMPATIBLE,
      'La unidad catalogada de la señal no coincide exactamente con la condición.'
    );
  }
  return null;
}

function comprobarObservacionContraCatalogo(observacion, senal) {
  if (!observacion || typeof observacion !== 'object') {
    throw new Error('La observación que se desea evaluar es obligatoria.');
  }
  if (observacion.tipoDato !== senal.tipoDato) {
    return noEvaluable(
      CODIGOS_MOTIVO_EVALUACION_TELEMETRIA.TIPO_OBSERVACION_INCOMPATIBLE,
      'El tipo de la observación no coincide con el catálogo de la señal.'
    );
  }
  if (normalizarUnidad(observacion.unidad) !== senal.unidad) {
    return noEvaluable(
      CODIGOS_MOTIVO_EVALUACION_TELEMETRIA.UNIDAD_OBSERVACION_INCOMPATIBLE,
      'La unidad de la observación no coincide exactamente con el catálogo.'
    );
  }
  return null;
}

function evaluarCalidad(condicion, calidad) {
  if (!CALIDADES_VALIDAS.has(calidad)) {
    return noEvaluable(
      CODIGOS_MOTIVO_EVALUACION_TELEMETRIA.CALIDAD_NO_EVALUABLE,
      'La calidad observada no pertenece al vocabulario conocido.'
    );
  }
  return resolverCoincidencia(
    compararValor({
      valor: calidad,
      operador: condicion.configuracion.operador,
      esperado: condicion.configuracion.calidadEsperada
    })
  );
}

function esValorEstrictoDelTipo(valor, tipo) {
  switch (tipo) {
    case TIPOS_CONDICION_DERIVACION_TELEMETRIA.NUMERO:
      return typeof valor === 'number' && Number.isFinite(valor);
    case TIPOS_CONDICION_DERIVACION_TELEMETRIA.DURACION:
      try {
        normalizarValorDuracionTelemetria(valor);
        return true;
      } catch {
        return false;
      }
    case TIPOS_CONDICION_DERIVACION_TELEMETRIA.MOMENTO_UTC:
      try {
        normalizarValorMomentoUtcTelemetria(valor);
        return true;
      } catch {
        return false;
      }
    case TIPOS_CONDICION_DERIVACION_TELEMETRIA.BOOLEANO:
      return typeof valor === 'boolean';
    case TIPOS_CONDICION_DERIVACION_TELEMETRIA.ESTADO:
    case TIPOS_CONDICION_DERIVACION_TELEMETRIA.TEXTO:
      return typeof valor === 'string';
    default:
      return false;
  }
}

function compararValor({ valor, operador, esperado }) {
  switch (operador) {
    case OPERADORES_CONDICION_DERIVACION_TELEMETRIA.MAYOR_QUE:
      return valor > esperado;
    case OPERADORES_CONDICION_DERIVACION_TELEMETRIA.MAYOR_O_IGUAL:
      return valor >= esperado;
    case OPERADORES_CONDICION_DERIVACION_TELEMETRIA.MENOR_QUE:
      return valor < esperado;
    case OPERADORES_CONDICION_DERIVACION_TELEMETRIA.MENOR_O_IGUAL:
      return valor <= esperado;
    case OPERADORES_CONDICION_DERIVACION_TELEMETRIA.IGUAL:
      return valor === esperado;
    case OPERADORES_CONDICION_DERIVACION_TELEMETRIA.DISTINTO:
      return valor !== esperado;
    default:
      throw new Error('El operador de la condición no está soportado.');
  }
}

function resolverCoincidencia(cumple) {
  return cumple
    ? {
        resultado: RESULTADOS_EVALUACION_REGLA_TELEMETRIA.COINCIDE,
        codigoMotivo:
          CODIGOS_MOTIVO_EVALUACION_TELEMETRIA.CONDICION_CUMPLIDA,
        explicacion: 'La observación cumple la condición tipada.'
      }
    : {
        resultado: RESULTADOS_EVALUACION_REGLA_TELEMETRIA.NO_COINCIDE,
        codigoMotivo:
          CODIGOS_MOTIVO_EVALUACION_TELEMETRIA.CONDICION_NO_CUMPLIDA,
        explicacion: 'La observación no cumple la condición tipada.'
      };
}

function noEvaluable(codigoMotivo, explicacion) {
  return {
    resultado: RESULTADOS_EVALUACION_REGLA_TELEMETRIA.NO_EVALUABLE,
    codigoMotivo,
    explicacion
  };
}

function normalizarSenalCatalogada(senal) {
  if (!senal || typeof senal !== 'object') {
    throw new Error('La señal catalogada es obligatoria.');
  }
  const id = Number(senal.id);
  const agenteId = Number(senal.agenteId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error('La identidad de la señal catalogada no es válida.');
  }
  if (!Number.isInteger(agenteId) || agenteId <= 0) {
    throw new Error('El agente de la señal catalogada no es válido.');
  }
  if (!TIPOS_DATO_VALIDOS.has(senal.tipoDato)) {
    throw new Error('El tipo de dato catalogado de la señal no es válido.');
  }
  return {
    id,
    agenteId,
    tipoDato: senal.tipoDato,
    unidad: normalizarUnidad(senal.unidad)
  };
}

function normalizarUnidad(unidad) {
  if (unidad == null || String(unidad).trim() === '') {
    return null;
  }
  const normalizada = String(unidad).trim();
  if (normalizada.length > 32) {
    throw new Error('La unidad de la señal supera el límite permitido.');
  }
  return normalizada;
}
