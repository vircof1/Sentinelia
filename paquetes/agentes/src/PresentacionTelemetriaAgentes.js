const LONGITUD_VALOR_VISIBLE = 160;
const LONGITUD_DETALLE_VISIBLE = 220;

export function construirPresentacionTelemetriaAgente({
  catalogoSenales = [],
  fotografiaActual = [],
  historico = []
} = {}) {
  const fotografiaPorCodigo = new Map(
    fotografiaActual.map((lectura) => [lectura.codigoSenal, lectura])
  );
  const observacionesHistorico = historico.map(construirFilaHistorico);
  const tipoSerieTemporal = resolverTipoSerieTemporal(historico);

  return {
    senalesActuales: fotografiaActual.map(construirTarjetaSenalActual),
    tablaSenales: catalogoSenales.map((senal) =>
      construirFilaTablaSenal(senal, fotografiaPorCodigo.get(senal.codigoSenal))
    ),
    historico: {
      observaciones: observacionesHistorico,
      tieneSerieTemporal: Boolean(tipoSerieTemporal),
      tipoSerieTemporal
    }
  };
}

export function formatearValorPresentacionTelemetria(lectura = {}) {
  const tipoDato = lectura.tipoDato || 'desconocido';
  let texto = 'sin valor';
  let valorBruto = null;
  let detalleJson = null;

  if (tipoDato === 'numero') {
    valorBruto = lectura.valorNumero ?? null;
    texto = valorBruto == null
      ? 'sin valor'
      : `${valorBruto}${lectura.unidad ? ` ${lectura.unidad}` : ''}`;
  } else if (tipoDato === 'booleano') {
    valorBruto = lectura.valorBooleano ?? null;
    texto = valorBruto == null ? 'sin valor' : (valorBruto ? 'Sí' : 'No');
  } else if (tipoDato === 'texto') {
    valorBruto = lectura.valorTexto ?? null;
    texto = valorBruto == null ? 'sin valor' : String(valorBruto);
  } else if (tipoDato === 'estado') {
    valorBruto = lectura.valorEstado ?? null;
    texto = valorBruto == null ? 'sin valor' : String(valorBruto);
  } else if (tipoDato === 'json') {
    valorBruto = lectura.valorJson ?? null;
    detalleJson = valorBruto == null ? null : serializarJson(valorBruto);
    texto = detalleJson || 'sin valor';
  } else if (tipoDato === 'duracion') {
    valorBruto = lectura.valorDuracion ?? null;
    texto = valorBruto == null
      ? 'sin valor'
      : formatearDuracionHumanaTelemetria(valorBruto);
  } else if (tipoDato === 'momento_utc') {
    valorBruto = lectura.valorMomentoUtc ?? null;
    texto = valorBruto == null ? 'sin valor' : String(valorBruto);
  }

  return {
    tipoDato,
    texto: recortarTexto(texto, LONGITUD_VALOR_VISIBLE),
    textoCompleto: tipoDato === 'duracion' && valorBruto != null
      ? formatearDuracionExactaTelemetria(valorBruto)
      : texto,
    valorBruto,
    unidad: lectura.unidad || null,
    esJson: tipoDato === 'json',
    detalleJson,
    acotado: texto.length > LONGITUD_VALOR_VISIBLE,
    aptaVisualizacionTemporal: [
      'numero',
      'booleano',
      'duracion',
      'momento_utc'
    ].includes(tipoDato)
  };
}

function construirTarjetaSenalActual(lectura) {
  const valor = formatearValorPresentacionTelemetria(lectura);

  return {
    senalId: lectura.senalId || null,
    codigoSenal: lectura.codigoSenal,
    titulo: lectura.nombreHumano || lectura.codigoSenal,
    subtitulo: construirSubtituloSenal(lectura),
    tipoDato: lectura.tipoDato,
    unidad: lectura.unidad || null,
    valor,
    calidad: lectura.calidad || 'sin_calidad',
    severidadDeclarada: lectura.severidadDeclarada || 'info',
    origen: lectura.origen || 'directa',
    detalleHumano: recortarTexto(
      lectura.detalleHumano || 'Sin detalle humano.',
      LONGITUD_DETALLE_VISIBLE
    ),
    detalleHumanoCompleto: lectura.detalleHumano || '',
    observadoEnUtc: lectura.observadoEnUtc || null,
    recibidoEnUtc: lectura.recibidoEnUtc || null,
    emitidoEnUtc: lectura.emitidoEnUtc || null,
    vigenteHastaUtc: lectura.vigenteHastaUtc || null,
    aptaVisualizacionTemporal: valor.aptaVisualizacionTemporal,
    detalleAvanzado: construirDetalleAvanzado(lectura, valor)
  };
}

function construirFilaTablaSenal(senal, lecturaActual = null) {
  const valorActual = lecturaActual
    ? formatearValorPresentacionTelemetria(lecturaActual)
    : null;

  return {
    id: senal.id,
    codigoSenal: senal.codigoSenal,
    titulo: senal.nombreHumano || senal.codigoSenal,
    categoria: senal.categoria,
    clave: senal.clave,
    tag: senal.tag || null,
    tipoDato: senal.tipoDato,
    unidad: senal.unidad || null,
    tieneFotografiaActual: Boolean(lecturaActual),
    valorActualTexto: valorActual?.texto || 'sin lectura actual',
    calidadActual: lecturaActual?.calidad || null,
    severidadDeclaradaActual: lecturaActual?.severidadDeclarada || null,
    aptaVisualizacionTemporal: [
      'numero',
      'booleano',
      'duracion',
      'momento_utc'
    ].includes(senal.tipoDato)
  };
}

function construirFilaHistorico(observacion) {
  const valor = formatearValorPresentacionTelemetria(observacion);

  return {
    observadoEnUtc: observacion.observadoEnUtc || null,
    recibidoEnUtc: observacion.recibidoEnUtc || null,
    vigenteHastaUtc: observacion.vigenteHastaUtc || null,
    periodoVidaPolId: observacion.periodoVidaPolId || null,
    codigoSenal: observacion.codigoSenal,
    tipoDato: observacion.tipoDato,
    valor,
    calidad: observacion.calidad || 'sin_calidad',
    severidadDeclarada: observacion.severidadDeclarada || 'info',
    origen: observacion.origen || 'directa',
    detalleHumano: recortarTexto(
      observacion.detalleHumano || 'Sin detalle.',
      LONGITUD_DETALLE_VISIBLE
    ),
    metadatos: observacion.metadatos ?? null
  };
}

function resolverTipoSerieTemporal(historico) {
  if (!Array.isArray(historico) || historico.length === 0) {
    return null;
  }

  const tipos = new Set(historico.map((observacion) => observacion.tipoDato));

  if (tipos.size !== 1) {
    return null;
  }

  const [tipo] = tipos;

  return ['numero', 'booleano', 'duracion', 'momento_utc'].includes(tipo)
    ? tipo
    : null;
}

export function formatearDuracionHumanaTelemetria(valor) {
  const segundos = Number(valor);

  if (!Number.isFinite(segundos) || segundos < 0) {
    return 'sin valor';
  }

  if (segundos === 0) {
    return '0 s';
  }

  if (segundos < 1) {
    return `${formatearDecimal(segundos * 1000, 3)} ms`;
  }

  const unidades = [
    ['a', 31_536_000],
    ['d', 86_400],
    ['h', 3_600],
    ['min', 60]
  ];
  const partes = [];
  let restante = segundos;

  for (const [etiqueta, factor] of unidades) {
    const cantidad = Math.floor(restante / factor);

    if (cantidad > 0) {
      partes.push(`${cantidad} ${etiqueta}`);
      restante -= cantidad * factor;
    }

    if (partes.length === 2) {
      break;
    }
  }

  if (partes.length < 2 && restante > 0) {
    partes.push(`${formatearDecimal(restante, 4)} s`);
  }

  return partes.join(' ') || `${formatearDecimal(segundos, 4)} s`;
}

export function formatearDuracionExactaTelemetria(valor) {
  const segundos = Number(valor);

  return Number.isFinite(segundos) && segundos >= 0
    ? `${String(segundos)} s`
    : 'sin valor';
}

function formatearDecimal(valor, maximoDecimales) {
  return new Intl.NumberFormat('es-ES', {
    maximumFractionDigits: maximoDecimales,
    useGrouping: true
  }).format(valor);
}

function construirSubtituloSenal(lectura) {
  return [
    lectura.tipoDato,
    lectura.unidad,
    lectura.calidad
  ].filter(Boolean).join(' · ');
}

function construirDetalleAvanzado(lectura, valor) {
  if (valor.esJson) {
    return {
      tipo: 'json',
      etiqueta: 'JSON avanzado',
      contenido: valor.detalleJson
    };
  }

  if (lectura.metadatos) {
    return {
      tipo: 'metadatos',
      etiqueta: 'Metadatos',
      contenido: serializarJson(lectura.metadatos)
    };
  }

  return null;
}

function serializarJson(valor) {
  try {
    return JSON.stringify(valor, null, 2);
  } catch {
    return String(valor);
  }
}

function recortarTexto(valor, longitudMaxima) {
  const texto = String(valor ?? '');

  if (texto.length <= longitudMaxima) {
    return texto;
  }

  return `${texto.slice(0, longitudMaxima - 1)}…`;
}
