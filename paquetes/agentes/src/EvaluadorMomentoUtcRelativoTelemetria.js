import {
  normalizarValorMomentoUtcTelemetria
} from './ContratoTelemetriaTemporalAgente.js';

export const TIPO_CONDICION_MOMENTO_UTC_RELATIVO = 'momento_utc_relativo';

export const FORMAS_MOMENTO_UTC_RELATIVO = Object.freeze({
  LIMITE_INFERIOR: 'limite_inferior',
  LIMITE_SUPERIOR: 'limite_superior',
  FUERA_INTERVALO: 'fuera_intervalo'
});

export const DIRECCIONES_DESPLAZAMIENTO_TEMPORAL = Object.freeze({
  PASADO: 'pasado',
  AHORA: 'ahora',
  FUTURO: 'futuro'
});

export const LADOS_ATENCION_MOMENTO_UTC_RELATIVO = Object.freeze({
  INFERIOR: 'inferior',
  SUPERIOR: 'superior'
});

export const CAUSALIDAD_REVISION_MOMENTO_UTC_RELATIVO = 'autoridad_actual';

export const CAUSAS_EVALUACION_MOMENTO_UTC_RELATIVO = Object.freeze({
  OBSERVACION: 'observacion',
  VENCIMIENTO_TEMPORAL: 'vencimiento_temporal',
  RECONCILIACION_ADMINISTRATIVA: 'reconciliacion_administrativa',
  RECONCILIACION_RELOJ: 'reconciliacion_reloj'
});

export const RESULTADOS_MOMENTO_UTC_RELATIVO = Object.freeze({
  COINCIDE: 'coincide',
  NO_COINCIDE: 'no_coincide',
  NO_EVALUABLE: 'no_evaluable'
});

const BIGINT_UNSIGNED_MAXIMO = (1n << 64n) - 1n;
const SEGUNDO_MINIMO_UTC = BigInt(Date.parse('1000-01-01T00:00:00Z') / 1000);
const SEGUNDO_MAXIMO_UTC = BigInt(Date.parse('9999-12-31T23:59:59Z') / 1000);
const FORMAS_VALIDAS = new Set(Object.values(FORMAS_MOMENTO_UTC_RELATIVO));
const DIRECCIONES_VALIDAS = new Set(
  Object.values(DIRECCIONES_DESPLAZAMIENTO_TEMPORAL)
);
const CAUSAS_VALIDAS = new Set(Object.values(CAUSAS_EVALUACION_MOMENTO_UTC_RELATIVO));

export class CondicionMomentoUtcRelativo {
  constructor({ tipo, version = 1, configuracion } = {}) {
    if (tipo !== TIPO_CONDICION_MOMENTO_UTC_RELATIVO) {
      throw new Error('El tipo de la condición temporal relativa no es válido.');
    }
    if (version !== 1) {
      throw new Error('La versión de la condición temporal relativa no está soportada.');
    }
    this.tipo = tipo;
    this.version = version;
    this.configuracion = congelarProfundo(normalizarConfiguracion(configuracion));
    Object.freeze(this);
  }

  serializar() {
    return {
      tipo: this.tipo,
      version: this.version,
      configuracion: clonarJson(this.configuracion)
    };
  }

  obtenerCanonica() {
    return JSON.stringify(ordenarJson(this.serializar()));
  }
}

export function crearCondicionMomentoUtcRelativo(configuracion) {
  return new CondicionMomentoUtcRelativo({
    tipo: TIPO_CONDICION_MOMENTO_UTC_RELATIVO,
    version: 1,
    configuracion
  });
}

export function evaluarMomentoUtcRelativo({
  condicion,
  momentoUtc,
  ahoraUtc,
  estadoAnteriorCompatible = null,
  causa = CAUSAS_EVALUACION_MOMENTO_UTC_RELATIVO.OBSERVACION,
  correccionReloj = null
} = {}) {
  const contrato = condicion instanceof CondicionMomentoUtcRelativo
    ? condicion
    : new CondicionMomentoUtcRelativo(condicion);
  const ahora = normalizarInstanteAutoritativo(ahoraUtc);
  const causaNormalizada = normalizarCausa(causa);
  const correccion = normalizarCorreccionReloj({
    causa: causaNormalizada,
    correccionReloj
  });
  const anterior = normalizarEstadoAnterior(estadoAnteriorCompatible);

  let momento;
  try {
    momento = normalizarInstante(momentoUtc);
  } catch {
    return congelarProfundo({
      resultado: RESULTADOS_MOMENTO_UTC_RELATIVO.NO_EVALUABLE,
      codigoMotivo: 'valor_momento_utc_no_evaluable',
      ladoAtencion: null,
      causalidadRevision: CAUSALIDAD_REVISION_MOMENTO_UTC_RELATIVO,
      causa: causaNormalizada,
      proximaReevaluacionUtc: null,
      motivoProgramacion: 'valor_no_evaluable',
      temporal: {
        momentoUtc,
        ahoraUtc: ahora.texto,
        desviacionSegundos: null,
        forma: contrato.configuracion.forma,
        limites: obtenerLimitesEvidencia(contrato.configuracion),
        resultadoAnteriorCompatible: anterior?.resultado ?? null,
        ladoAnteriorCompatible: anterior?.ladoAtencion ?? null,
        correccionReloj: correccion
      }
    });
  }

  const desviacion = momento.segundos - ahora.segundos;
  const decision = decidir({
    configuracion: contrato.configuracion,
    desviacion,
    anterior
  });
  const programacion = calcularProximaReevaluacion({
    configuracion: contrato.configuracion,
    ahoraSegundos: ahora.segundos,
    desviacion,
    decision
  });

  return congelarProfundo({
    resultado: decision.resultado,
    codigoMotivo: decision.resultado === RESULTADOS_MOMENTO_UTC_RELATIVO.COINCIDE
      ? 'condicion_temporal_relativa_cumplida'
      : 'condicion_temporal_relativa_no_cumplida',
    ladoAtencion: decision.ladoAtencion,
    causalidadRevision: CAUSALIDAD_REVISION_MOMENTO_UTC_RELATIVO,
    causa: causaNormalizada,
    proximaReevaluacionUtc: programacion.instante,
    motivoProgramacion: programacion.motivo,
    temporal: {
      momentoUtc: momento.texto,
      ahoraUtc: ahora.texto,
      desviacionSegundos: desviacion.toString(),
      forma: contrato.configuracion.forma,
      limites: obtenerLimitesEvidencia(contrato.configuracion),
      resultadoAnteriorCompatible: anterior?.resultado ?? null,
      ladoAnteriorCompatible: anterior?.ladoAtencion ?? null,
      correccionReloj: correccion
    }
  });
}

function normalizarConfiguracion(configuracion) {
  exigirObjetoPlano(configuracion, 'La configuración temporal relativa es obligatoria.');
  if (!FORMAS_VALIDAS.has(configuracion.forma)) {
    throw new Error('La forma de la condición temporal relativa no es válida.');
  }

  if (configuracion.forma === FORMAS_MOMENTO_UTC_RELATIVO.LIMITE_INFERIOR) {
    exigirClaves(configuracion, ['forma', 'limite', 'histeresisSegundos']);
    return {
      forma: configuracion.forma,
      limite: normalizarDesplazamiento(configuracion.limite),
      histeresisSegundos: normalizarBigIntUnsigned(
        configuracion.histeresisSegundos,
        'La histéresis temporal debe ser una cadena decimal canónica.'
      ).texto
    };
  }
  if (configuracion.forma === FORMAS_MOMENTO_UTC_RELATIVO.LIMITE_SUPERIOR) {
    exigirClaves(configuracion, ['forma', 'limite', 'histeresisSegundos']);
    return {
      forma: configuracion.forma,
      limite: normalizarDesplazamiento(configuracion.limite),
      histeresisSegundos: normalizarBigIntUnsigned(
        configuracion.histeresisSegundos,
        'La histéresis temporal debe ser una cadena decimal canónica.'
      ).texto
    };
  }

  exigirClaves(configuracion, [
    'forma',
    'limiteInferior',
    'limiteSuperior',
    'histeresisInferiorSegundos',
    'histeresisSuperiorSegundos'
  ]);
  const limiteInferior = normalizarDesplazamiento(configuracion.limiteInferior);
  const limiteSuperior = normalizarDesplazamiento(configuracion.limiteSuperior);
  const inferior = convertirDesplazamiento(limiteInferior);
  const superior = convertirDesplazamiento(limiteSuperior);
  const histeresisInferior = normalizarBigIntUnsigned(
    configuracion.histeresisInferiorSegundos,
    'La histéresis inferior debe ser una cadena decimal canónica.'
  );
  const histeresisSuperior = normalizarBigIntUnsigned(
    configuracion.histeresisSuperiorSegundos,
    'La histéresis superior debe ser una cadena decimal canónica.'
  );

  if (inferior >= superior || superior - inferior < 2n) {
    throw new Error(
      'El intervalo debe conservar al menos un segundo representable entre límites.'
    );
  }
  if (inferior + histeresisInferior.valor > superior - histeresisSuperior.valor) {
    throw new Error(
      'Las histéresis temporales no pueden vaciar la región satisfactoria compartida.'
    );
  }

  return {
    forma: configuracion.forma,
    limiteInferior,
    limiteSuperior,
    histeresisInferiorSegundos: histeresisInferior.texto,
    histeresisSuperiorSegundos: histeresisSuperior.texto
  };
}

function normalizarDesplazamiento(desplazamiento) {
  exigirObjetoPlano(desplazamiento, 'El desplazamiento temporal es obligatorio.');
  exigirClaves(desplazamiento, ['direccion', 'segundos']);
  if (!DIRECCIONES_VALIDAS.has(desplazamiento.direccion)) {
    throw new Error('La dirección del desplazamiento temporal no es válida.');
  }
  const segundos = normalizarBigIntUnsigned(
    desplazamiento.segundos,
    'Los segundos del desplazamiento deben ser una cadena decimal canónica.'
  );
  if (
    desplazamiento.direccion === DIRECCIONES_DESPLAZAMIENTO_TEMPORAL.AHORA
      ? segundos.valor !== 0n
      : segundos.valor === 0n
  ) {
    throw new Error('La dirección ahora exige cero y pasado o futuro exigen más de cero.');
  }
  return { direccion: desplazamiento.direccion, segundos: segundos.texto };
}

function decidir({ configuracion, desviacion, anterior }) {
  const anteriorAtencion = anterior?.resultado === RESULTADOS_MOMENTO_UTC_RELATIVO.COINCIDE
    ? anterior.ladoAtencion
    : null;

  if (configuracion.forma === FORMAS_MOMENTO_UTC_RELATIVO.LIMITE_INFERIOR) {
    const limite = convertirDesplazamiento(configuracion.limite);
    const histeresis = BigInt(configuracion.histeresisSegundos);
    const conserva = anteriorAtencion === LADOS_ATENCION_MOMENTO_UTC_RELATIVO.INFERIOR &&
      (histeresis === 0n ? desviacion <= limite : desviacion < limite + histeresis);
    return resultadoDecision(
      desviacion <= limite || conserva,
      LADOS_ATENCION_MOMENTO_UTC_RELATIVO.INFERIOR
    );
  }

  if (configuracion.forma === FORMAS_MOMENTO_UTC_RELATIVO.LIMITE_SUPERIOR) {
    const limite = convertirDesplazamiento(configuracion.limite);
    const histeresis = BigInt(configuracion.histeresisSegundos);
    const conserva = anteriorAtencion === LADOS_ATENCION_MOMENTO_UTC_RELATIVO.SUPERIOR &&
      (histeresis === 0n ? desviacion >= limite : desviacion > limite - histeresis);
    return resultadoDecision(
      desviacion >= limite || conserva,
      LADOS_ATENCION_MOMENTO_UTC_RELATIVO.SUPERIOR
    );
  }

  const inferior = convertirDesplazamiento(configuracion.limiteInferior);
  const superior = convertirDesplazamiento(configuracion.limiteSuperior);
  const histeresisInferior = BigInt(configuracion.histeresisInferiorSegundos);
  const histeresisSuperior = BigInt(configuracion.histeresisSuperiorSegundos);

  if (desviacion <= inferior) {
    return resultadoDecision(true, LADOS_ATENCION_MOMENTO_UTC_RELATIVO.INFERIOR);
  }
  if (desviacion >= superior) {
    return resultadoDecision(true, LADOS_ATENCION_MOMENTO_UTC_RELATIVO.SUPERIOR);
  }
  if (
    anteriorAtencion === LADOS_ATENCION_MOMENTO_UTC_RELATIVO.INFERIOR &&
    (histeresisInferior === 0n
      ? desviacion <= inferior
      : desviacion < inferior + histeresisInferior)
  ) {
    return resultadoDecision(true, LADOS_ATENCION_MOMENTO_UTC_RELATIVO.INFERIOR);
  }
  if (
    anteriorAtencion === LADOS_ATENCION_MOMENTO_UTC_RELATIVO.SUPERIOR &&
    (histeresisSuperior === 0n
      ? desviacion >= superior
      : desviacion > superior - histeresisSuperior)
  ) {
    return resultadoDecision(true, LADOS_ATENCION_MOMENTO_UTC_RELATIVO.SUPERIOR);
  }
  return resultadoDecision(false, null);
}

function calcularProximaReevaluacion({
  configuracion,
  ahoraSegundos,
  desviacion,
  decision
}) {
  let segundosHasta = null;

  if (configuracion.forma === FORMAS_MOMENTO_UTC_RELATIVO.LIMITE_INFERIOR) {
    if (decision.resultado === RESULTADOS_MOMENTO_UTC_RELATIVO.NO_COINCIDE) {
      segundosHasta = desviacion - convertirDesplazamiento(configuracion.limite);
    }
  } else if (configuracion.forma === FORMAS_MOMENTO_UTC_RELATIVO.LIMITE_SUPERIOR) {
    if (decision.ladoAtencion === LADOS_ATENCION_MOMENTO_UTC_RELATIVO.SUPERIOR) {
      const limite = convertirDesplazamiento(configuracion.limite);
      const histeresis = BigInt(configuracion.histeresisSegundos);
      const objetivo = histeresis === 0n ? limite - 1n : limite - histeresis;
      segundosHasta = desviacion - objetivo;
    }
  } else if (decision.ladoAtencion === LADOS_ATENCION_MOMENTO_UTC_RELATIVO.SUPERIOR) {
    const superior = convertirDesplazamiento(configuracion.limiteSuperior);
    const histeresis = BigInt(configuracion.histeresisSuperiorSegundos);
    const objetivo = histeresis === 0n ? superior - 1n : superior - histeresis;
    segundosHasta = desviacion - objetivo;
  } else if (decision.resultado === RESULTADOS_MOMENTO_UTC_RELATIVO.NO_COINCIDE) {
    segundosHasta = desviacion - convertirDesplazamiento(configuracion.limiteInferior);
  }

  if (segundosHasta === null) {
    return { instante: null, motivo: 'sin_frontera_por_avance_del_reloj' };
  }
  if (segundosHasta <= 0n) {
    throw new Error('La próxima frontera temporal debe quedar en el futuro.');
  }
  const frontera = ahoraSegundos + segundosHasta;
  if (frontera < SEGUNDO_MINIMO_UTC || frontera > SEGUNDO_MAXIMO_UTC) {
    return { instante: null, motivo: 'frontera_fuera_horizonte_representable' };
  }
  return {
    instante: new Date(Number(frontera * 1000n)).toISOString().replace(/\.000Z$/u, 'Z'),
    motivo: 'frontera_temporal_programada'
  };
}

function normalizarEstadoAnterior(estado) {
  if (estado == null) return null;
  exigirObjetoPlano(estado, 'El estado anterior compatible no es válido.');
  exigirClaves(estado, ['resultado', 'ladoAtencion']);
  const resultados = new Set(Object.values(RESULTADOS_MOMENTO_UTC_RELATIVO));
  if (!resultados.has(estado.resultado)) {
    throw new Error('El resultado anterior compatible no es válido.');
  }
  const lados = new Set(Object.values(LADOS_ATENCION_MOMENTO_UTC_RELATIVO));
  if (
    estado.resultado === RESULTADOS_MOMENTO_UTC_RELATIVO.COINCIDE
      ? !lados.has(estado.ladoAtencion)
      : estado.ladoAtencion !== null
  ) {
    throw new Error('El lado anterior no corresponde al resultado compatible.');
  }
  return { resultado: estado.resultado, ladoAtencion: estado.ladoAtencion };
}

function normalizarCorreccionReloj({ causa, correccionReloj }) {
  if (causa !== CAUSAS_EVALUACION_MOMENTO_UTC_RELATIVO.RECONCILIACION_RELOJ) {
    if (correccionReloj !== null) {
      throw new Error('Solo una reconciliación de reloj admite evidencia de corrección.');
    }
    return null;
  }
  exigirObjetoPlano(correccionReloj, 'La reconciliación de reloj exige evidencia.');
  exigirClaves(correccionReloj, [
    'generacionCorreccion',
    'relojAnteriorUtc',
    'relojCorregidoUtc'
  ]);
  const generacion = normalizarBigIntUnsigned(
    correccionReloj.generacionCorreccion,
    'La generación de corrección debe ser una cadena decimal canónica.'
  );
  if (generacion.valor === 0n) {
    throw new Error('La generación de corrección debe ser positiva.');
  }
  const anterior = normalizarInstanteAutoritativo(correccionReloj.relojAnteriorUtc);
  const corregido = normalizarInstanteAutoritativo(correccionReloj.relojCorregidoUtc);
  if (corregido.segundos >= anterior.segundos) {
    throw new Error('La evidencia debe identificar un retroceso real del reloj.');
  }
  return {
    generacionCorreccion: generacion.texto,
    relojAnteriorUtc: anterior.texto,
    relojCorregidoUtc: corregido.texto
  };
}

function normalizarCausa(causa) {
  if (!CAUSAS_VALIDAS.has(causa)) {
    throw new Error('La causa de evaluación temporal relativa no es válida.');
  }
  return causa;
}

function normalizarInstanteAutoritativo(valor) {
  try {
    return normalizarInstante(valor);
  } catch {
    throw new Error('El instante autoritativo debe ser un momento UTC canónico.');
  }
}

function normalizarInstante(valor) {
  const texto = normalizarValorMomentoUtcTelemetria(valor);
  return { texto, segundos: BigInt(Date.parse(texto) / 1000) };
}

function normalizarBigIntUnsigned(valor, mensaje) {
  if (typeof valor !== 'string' || !/^(?:0|[1-9]\d*)$/u.test(valor)) {
    throw new Error(mensaje);
  }
  const bigint = BigInt(valor);
  if (bigint > BIGINT_UNSIGNED_MAXIMO) {
    throw new Error('La magnitud temporal supera BIGINT UNSIGNED.');
  }
  return { texto: valor, valor: bigint };
}

function convertirDesplazamiento(desplazamiento) {
  const magnitud = BigInt(desplazamiento.segundos);
  if (desplazamiento.direccion === DIRECCIONES_DESPLAZAMIENTO_TEMPORAL.PASADO) {
    return -magnitud;
  }
  if (desplazamiento.direccion === DIRECCIONES_DESPLAZAMIENTO_TEMPORAL.FUTURO) {
    return magnitud;
  }
  return 0n;
}

function resultadoDecision(coincide, ladoAtencion) {
  return {
    resultado: coincide
      ? RESULTADOS_MOMENTO_UTC_RELATIVO.COINCIDE
      : RESULTADOS_MOMENTO_UTC_RELATIVO.NO_COINCIDE,
    ladoAtencion: coincide ? ladoAtencion : null
  };
}

function obtenerLimitesEvidencia(configuracion) {
  if (configuracion.forma === FORMAS_MOMENTO_UTC_RELATIVO.FUERA_INTERVALO) {
    return {
      inferiorSegundos: convertirDesplazamiento(configuracion.limiteInferior).toString(),
      superiorSegundos: convertirDesplazamiento(configuracion.limiteSuperior).toString(),
      histeresisInferiorSegundos: configuracion.histeresisInferiorSegundos,
      histeresisSuperiorSegundos: configuracion.histeresisSuperiorSegundos
    };
  }
  return {
    limiteSegundos: convertirDesplazamiento(configuracion.limite).toString(),
    histeresisSegundos: configuracion.histeresisSegundos
  };
}

function exigirObjetoPlano(valor, mensaje) {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) {
    throw new Error(mensaje);
  }
}

function exigirClaves(valor, esperadas) {
  const actuales = Object.keys(valor).sort();
  const ordenadas = [...esperadas].sort();
  if (
    actuales.length !== ordenadas.length ||
    actuales.some((clave, indice) => clave !== ordenadas[indice])
  ) {
    throw new Error(`El objeto debe contener exactamente: ${ordenadas.join(', ')}.`);
  }
}

function congelarProfundo(valor) {
  if (Array.isArray(valor)) valor.forEach(congelarProfundo);
  else if (valor && typeof valor === 'object') Object.values(valor).forEach(congelarProfundo);
  return valor && typeof valor === 'object' ? Object.freeze(valor) : valor;
}

function clonarJson(valor) {
  return JSON.parse(JSON.stringify(valor));
}

function ordenarJson(valor) {
  if (Array.isArray(valor)) return valor.map(ordenarJson);
  if (!valor || typeof valor !== 'object') return valor;
  return Object.fromEntries(
    Object.keys(valor).sort().map((clave) => [clave, ordenarJson(valor[clave])])
  );
}
