import { TIPOS_DATO_TELEMETRIA_AGENTE } from '../../agentes/src/TelemetriaAgente.js';
import {
  CondicionRangoNumericoTelemetria,
  CondicionValorEsperadoTelemetria,
  crearConfiguracionMonitorTelemetria,
  normalizarSenalCatalogadaMonitorTelemetria,
  OPERADORES_VALOR_ESPERADO_TELEMETRIA
} from './ConfiguracionMonitorTelemetria.js';
import {
  ESTADOS_MONITOR_TELEMETRIA,
  ResultadoMonitorTelemetria
} from './MonitorTelemetriaAgente.js';

export class EvaluadorMonitorTelemetria {
  evaluar({ configuracion, senal, lecturaActual = null } = {}) {
    const catalogada = normalizarSenalCatalogadaMonitorTelemetria(senal);
    const normalizada = crearConfiguracionMonitorTelemetria(configuracion, {
      senal: catalogada
    });

    if (!lecturaActual) {
      return crearResultadoDesconocido({
        codigoMotivo: 'sin_observacion_actual',
        senal: catalogada,
        condicion: normalizada.condicion,
        detalle: 'La señal todavía no dispone de una fotografía SQL vigente.'
      });
    }

    const incompatibilidad = comprobarLectura({
      lectura: lecturaActual,
      senal: catalogada
    });
    if (incompatibilidad) {
      return crearResultadoDesconocido({
        codigoMotivo: incompatibilidad.codigoMotivo,
        senal: catalogada,
        condicion: normalizada.condicion,
        lectura: lecturaActual,
        detalle: incompatibilidad.detalle
      });
    }

    const valor = extraerValorEstricto(lecturaActual, catalogada.tipoDato);
    if (!valor.valido) {
      return crearResultadoDesconocido({
        codigoMotivo: 'valor_no_evaluable',
        senal: catalogada,
        condicion: normalizada.condicion,
        lectura: lecturaActual,
        detalle: valor.detalle
      });
    }

    const decision = normalizada.condicion instanceof CondicionRangoNumericoTelemetria
      ? evaluarRango(normalizada.condicion, valor.valor)
      : evaluarValorEsperado(normalizada.condicion, valor.valor);

    return new ResultadoMonitorTelemetria({
      estado: decision.fallo
        ? ESTADOS_MONITOR_TELEMETRIA.FALLO
        : ESTADOS_MONITOR_TELEMETRIA.NORMAL,
      codigoMotivo: decision.codigoMotivo,
      evidencia: construirEvidencia({
        senal: catalogada,
        condicion: normalizada.condicion,
        lectura: lecturaActual,
        valor: valor.valor,
        detalle: decision.detalle
      })
    });
  }
}

function evaluarRango(condicion, valor) {
  if (condicion.minimo != null && valor < condicion.minimo) {
    return {
      fallo: true,
      codigoMotivo: 'valor_bajo_minimo',
      detalle: `El valor está por debajo del mínimo inclusivo ${condicion.minimo}.`
    };
  }
  if (condicion.maximo != null && valor > condicion.maximo) {
    return {
      fallo: true,
      codigoMotivo: 'valor_sobre_maximo',
      detalle: `El valor está por encima del máximo inclusivo ${condicion.maximo}.`
    };
  }
  return {
    fallo: false,
    codigoMotivo: 'valor_en_tolerancia',
    detalle: 'El valor permanece dentro de la tolerancia inclusiva.'
  };
}

function evaluarValorEsperado(condicion, valor) {
  if (!(condicion instanceof CondicionValorEsperadoTelemetria)) {
    throw new Error('La condición directa no dispone de un evaluador soportado.');
  }
  const cumple = condicion.operador === OPERADORES_VALOR_ESPERADO_TELEMETRIA.IGUAL
    ? valor === condicion.valorEsperado
    : valor !== condicion.valorEsperado;
  return cumple
    ? {
        fallo: false,
        codigoMotivo: 'valor_esperado',
        detalle: 'El valor cumple la relación esperada por el monitor.'
      }
    : {
        fallo: true,
        codigoMotivo: 'valor_inesperado',
        detalle: 'El valor incumple la relación esperada por el monitor.'
      };
}

function comprobarLectura({ lectura, senal }) {
  if (Number(lectura.agenteId) !== senal.agenteId || Number(lectura.senalId) !== senal.id) {
    return {
      codigoMotivo: 'identidad_fotografia_incompatible',
      detalle: 'La fotografía SQL no pertenece al agente y señal vinculados.'
    };
  }
  if (lectura.tipoDato !== senal.tipoDato) {
    return {
      codigoMotivo: 'tipo_fotografia_incompatible',
      detalle: 'El tipo de la fotografía no coincide con el catálogo de la señal.'
    };
  }
  if (normalizarUnidad(lectura.unidad) !== senal.unidad) {
    return {
      codigoMotivo: 'unidad_fotografia_incompatible',
      detalle: 'La unidad de la fotografía no coincide exactamente con el catálogo.'
    };
  }
  return null;
}

function extraerValorEstricto(lectura, tipoDato) {
  const campo = {
    [TIPOS_DATO_TELEMETRIA_AGENTE.NUMERO]: 'valorNumero',
    [TIPOS_DATO_TELEMETRIA_AGENTE.BOOLEANO]: 'valorBooleano',
    [TIPOS_DATO_TELEMETRIA_AGENTE.ESTADO]: 'valorEstado',
    [TIPOS_DATO_TELEMETRIA_AGENTE.TEXTO]: 'valorTexto'
  }[tipoDato];
  const valor = lectura[campo];
  const valido = tipoDato === TIPOS_DATO_TELEMETRIA_AGENTE.NUMERO
    ? typeof valor === 'number' && Number.isFinite(valor)
    : tipoDato === TIPOS_DATO_TELEMETRIA_AGENTE.BOOLEANO
      ? typeof valor === 'boolean'
      : typeof valor === 'string' && valor.trim() !== '';
  return valido
    ? { valido: true, valor }
    : {
        valido: false,
        valor: null,
        detalle: `La fotografía no contiene un ${campo} estricto y evaluable.`
      };
}

function crearResultadoDesconocido({
  codigoMotivo,
  senal,
  condicion,
  lectura = null,
  detalle
}) {
  return new ResultadoMonitorTelemetria({
    estado: ESTADOS_MONITOR_TELEMETRIA.DESCONOCIDO,
    codigoMotivo,
    evidencia: construirEvidencia({
      senal,
      condicion,
      lectura,
      valor: null,
      detalle
    })
  });
}

function construirEvidencia({ senal, condicion, lectura, valor, detalle }) {
  return {
    senal: {
      id: senal.id,
      agenteId: senal.agenteId,
      tipoDato: senal.tipoDato,
      unidad: senal.unidad
    },
    condicion: condicion.serializar(),
    observacion: lectura
      ? {
          id: lectura.ultimaObservacionId || null,
          valor,
          calidad: lectura.calidad || null,
          severidadDeclarada: lectura.severidadDeclarada || null,
          observadoEnUtc: lectura.observadoEnUtc || null,
          recibidoEnUtc: lectura.recibidoEnUtc || null
        }
      : null,
    detalle
  };
}

function normalizarUnidad(valor) {
  const unidad = String(valor ?? '').trim();
  return unidad || null;
}
