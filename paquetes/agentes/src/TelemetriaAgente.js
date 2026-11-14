import {
  CAMPOS_VALOR_POR_TIPO_TELEMETRIA_AGENTE,
  TIPOS_DATO_INTERNOS_TELEMETRIA_AGENTE,
  TIPOS_DATO_PUBLICOS_TELEMETRIA_AGENTE
} from './TiposDatoTelemetriaAgente.js';
import {
  normalizarCamposValorTelemetriaInterna,
  normalizarUnidadTipoTemporalTelemetria
} from './ContratoTelemetriaTemporalAgente.js';

export const TIPOS_DATO_TELEMETRIA_AGENTE =
  TIPOS_DATO_PUBLICOS_TELEMETRIA_AGENTE;

export const CALIDADES_TELEMETRIA_AGENTE = Object.freeze({
  VALIDA: 'valida',
  PARCIAL: 'parcial',
  ESTIMADA: 'estimada',
  OBSOLETA: 'obsoleta',
  ERROR_LECTURA: 'error_lectura',
  DESCONOCIDA: 'desconocida'
});

export const SEVERIDADES_DECLARADAS_TELEMETRIA_AGENTE = Object.freeze({
  INFO: 'info',
  AVISO: 'aviso',
  CRITICA: 'critica',
  DESCONOCIDA: 'desconocida'
});

export const ORIGENES_TELEMETRIA_AGENTE = Object.freeze({
  DIRECTA: 'directa',
  CALCULADA: 'calculada',
  REENVIADA: 'reenviada',
  MANUAL: 'manual',
  RUNTIME: 'runtime',
  DESCONOCIDA: 'desconocida'
});

export const RESULTADOS_INGESTA_TELEMETRIA = Object.freeze({
  ACEPTADO: 'aceptado',
  PARCIAL: 'parcial',
  RECHAZADO: 'rechazado'
});

export const RESULTADOS_ACTUALIZACION_FOTOGRAFIA_TELEMETRIA = Object.freeze({
  CREAR: 'crear',
  ACTUALIZAR: 'actualizar',
  IGNORAR_ANTIGUA: 'ignorar_antigua',
  IGNORAR_MISMA_OBSERVACION: 'ignorar_misma_observacion'
});

export const LIMITES_TELEMETRIA_AGENTE = Object.freeze({
  CATEGORIA: 64,
  CLAVE: 128,
  TAG: 128,
  TIPO_DATO: 32,
  UNIDAD: 32,
  NOMBRE_HUMANO: 128,
  DESCRIPCION: 512,
  DETALLE_HUMANO: 512,
  VALOR_TEXTO: 2048,
  ESTADO: 128,
  CODIGO_ERROR: 80,
  MENSAJE_ERROR: 255,
  CAMPO_ERROR: 120,
  JSON_SERIALIZADO: 2048,
  OBSERVACIONES_LOTE: 500
});

const TIPOS_VALIDOS = new Set(Object.values(TIPOS_DATO_TELEMETRIA_AGENTE));
const TIPOS_INTERNOS_VALIDOS = new Set(
  Object.values(TIPOS_DATO_INTERNOS_TELEMETRIA_AGENTE)
);
const CALIDADES_VALIDAS = new Set(Object.values(CALIDADES_TELEMETRIA_AGENTE));
const SEVERIDADES_VALIDAS = new Set(
  Object.values(SEVERIDADES_DECLARADAS_TELEMETRIA_AGENTE)
);
const ORIGENES_VALIDOS = new Set(Object.values(ORIGENES_TELEMETRIA_AGENTE));
const RESULTADOS_VALIDOS = new Set(Object.values(RESULTADOS_INGESTA_TELEMETRIA));

export class DefinicionSenalAgente {
  constructor({
    categoria,
    clave,
    tag = null,
    tipoDato,
    unidad = null,
    nombreHumano = null,
    descripcion = null,
    metadatos = null
  } = {}, { permitirTiposInternos = false } = {}) {
    this.categoria = normalizarTextoObligatorio(
      categoria,
      LIMITES_TELEMETRIA_AGENTE.CATEGORIA,
      'La categoría de la señal de telemetría es obligatoria.'
    );
    this.clave = normalizarTextoObligatorio(
      clave,
      LIMITES_TELEMETRIA_AGENTE.CLAVE,
      'La clave de la señal de telemetría es obligatoria.'
    );
    this.tag = normalizarTextoOpcional(tag, LIMITES_TELEMETRIA_AGENTE.TAG);
    this.tipoDato = normalizarEnum(
      tipoDato,
      permitirTiposInternos ? TIPOS_INTERNOS_VALIDOS : TIPOS_VALIDOS,
      'El tipo de dato de la señal de telemetría no es válido.'
    );
    this.unidad = esTipoTemporal(this.tipoDato)
      ? normalizarUnidadTipoTemporalTelemetria(this.tipoDato, unidad)
      : normalizarTextoOpcional(unidad, LIMITES_TELEMETRIA_AGENTE.UNIDAD);
    this.nombreHumano = normalizarTextoOpcional(
      nombreHumano,
      LIMITES_TELEMETRIA_AGENTE.NOMBRE_HUMANO
    );
    this.descripcion = normalizarTextoOpcional(
      descripcion,
      LIMITES_TELEMETRIA_AGENTE.DESCRIPCION
    );
    this.metadatos = normalizarJsonOpcional(metadatos);
  }

  obtenerCodigoSenal() {
    return construirCodigoSenal(this);
  }

  serializar() {
    return {
      categoria: this.categoria,
      clave: this.clave,
      tag: this.tag,
      tipoDato: this.tipoDato,
      unidad: this.unidad,
      nombreHumano: this.nombreHumano,
      descripcion: this.descripcion,
      metadatos: clonarJson(this.metadatos)
    };
  }
}

export class SenalTelemetriaAgente extends DefinicionSenalAgente {
  constructor({
    consolidadaEnUtc = null,
    codigoSenal = null,
    ...definicion
  } = {}, opciones = {}) {
    super(definicion, opciones);
    this.codigoSenal = normalizarTextoOpcional(codigoSenal, 384) ||
      this.obtenerCodigoSenal();
    this.consolidadaEnUtc = normalizarFechaOpcional(consolidadaEnUtc);
  }

  serializar() {
    return {
      ...super.serializar(),
      codigoSenal: this.codigoSenal,
      consolidadaEnUtc: this.consolidadaEnUtc
    };
  }
}

export class LecturaTelemetriaAgente {
  constructor({
    categoria,
    clave,
    tag = null,
    tipoDato,
    unidad = null,
    observadoEnUtc,
    valorNumero = null,
    valorBooleano = null,
    valorTexto = null,
    valorEstado = null,
    valorJson = null,
    valorDuracion = null,
    valorMomentoUtc = null,
    calidad = CALIDADES_TELEMETRIA_AGENTE.VALIDA,
    severidadDeclarada = SEVERIDADES_DECLARADAS_TELEMETRIA_AGENTE.INFO,
    origen = ORIGENES_TELEMETRIA_AGENTE.DIRECTA,
    vigenteHastaUtc = null,
    detalleHumano = null,
    metadatos = null,
    definicionSenal = null
  } = {}, { permitirTiposInternos = false } = {}) {
    this.categoria = normalizarTextoObligatorio(
      categoria,
      LIMITES_TELEMETRIA_AGENTE.CATEGORIA,
      'La categoría de la lectura de telemetría es obligatoria.'
    );
    this.clave = normalizarTextoObligatorio(
      clave,
      LIMITES_TELEMETRIA_AGENTE.CLAVE,
      'La clave de la lectura de telemetría es obligatoria.'
    );
    this.tag = normalizarTextoOpcional(tag, LIMITES_TELEMETRIA_AGENTE.TAG);
    this.tipoDato = normalizarEnum(
      tipoDato,
      permitirTiposInternos ? TIPOS_INTERNOS_VALIDOS : TIPOS_VALIDOS,
      'El tipo de dato de la lectura de telemetría no es válido.'
    );
    this.unidad = esTipoTemporal(this.tipoDato)
      ? normalizarUnidadTipoTemporalTelemetria(this.tipoDato, unidad)
      : normalizarTextoOpcional(unidad, LIMITES_TELEMETRIA_AGENTE.UNIDAD);
    this.observadoEnUtc = normalizarFechaObligatoria(
      observadoEnUtc,
      'La fecha observada de la lectura de telemetría es obligatoria.'
    );
    const valorNormalizado = esTipoTemporal(this.tipoDato)
      ? normalizarCamposValorTelemetriaInterna({
        tipoDato: this.tipoDato,
        valorNumero,
        valorBooleano,
        valorTexto,
        valorEstado,
        valorJson,
        valorDuracion,
        valorMomentoUtc
      })
      : normalizarValorLecturaPorTipo({
      tipoDato: this.tipoDato,
      valorNumero,
      valorBooleano,
      valorTexto,
      valorEstado,
      valorJson
      });
    this.valorNumero = valorNormalizado.valorNumero;
    this.valorBooleano = valorNormalizado.valorBooleano;
    this.valorTexto = valorNormalizado.valorTexto;
    this.valorEstado = valorNormalizado.valorEstado;
    this.valorJson = valorNormalizado.valorJson;
    if (esTipoTemporal(this.tipoDato)) {
      this.valorDuracion = valorNormalizado.valorDuracion;
      this.valorMomentoUtc = valorNormalizado.valorMomentoUtc;
    }
    this.calidad = normalizarEnum(
      calidad,
      CALIDADES_VALIDAS,
      'La calidad de la lectura de telemetría no es válida.'
    );
    this.severidadDeclarada = normalizarEnum(
      severidadDeclarada,
      SEVERIDADES_VALIDAS,
      'La severidad declarada de la lectura de telemetría no es válida.'
    );
    this.origen = normalizarEnum(
      origen,
      ORIGENES_VALIDOS,
      'El origen de la lectura de telemetría no es válido.'
    );
    this.vigenteHastaUtc = normalizarFechaOpcional(vigenteHastaUtc);
    this.detalleHumano = normalizarTextoOpcional(
      detalleHumano,
      LIMITES_TELEMETRIA_AGENTE.DETALLE_HUMANO
    );
    this.metadatos = normalizarJsonOpcional(metadatos);
    this.definicionSenal = definicionSenal
      ? crearDefinicionSenalAgenteConTiposInternos(definicionSenal)
      : null;
    comprobarCoherenciaDefinicionSenal(this);
  }

  obtenerCodigoSenal() {
    return construirCodigoSenal(this);
  }

  serializar() {
    const serializada = {
      categoria: this.categoria,
      clave: this.clave,
      tag: this.tag,
      tipoDato: this.tipoDato,
      unidad: this.unidad,
      observadoEnUtc: this.observadoEnUtc,
      valorNumero: this.valorNumero,
      valorBooleano: this.valorBooleano,
      valorTexto: this.valorTexto,
      valorEstado: this.valorEstado,
      valorJson: clonarJson(this.valorJson),
      calidad: this.calidad,
      severidadDeclarada: this.severidadDeclarada,
      origen: this.origen,
      vigenteHastaUtc: this.vigenteHastaUtc,
      detalleHumano: this.detalleHumano,
      metadatos: clonarJson(this.metadatos),
      definicionSenal: this.definicionSenal?.serializar() || null,
      codigoSenal: this.obtenerCodigoSenal()
    };
    if (esTipoTemporal(this.tipoDato)) {
      serializada.valorDuracion = this.valorDuracion;
      serializada.valorMomentoUtc = this.valorMomentoUtc;
    }
    return serializada;
  }
}

export class CatalogoSenalesAgente {
  constructor({
    revision = null,
    senales = []
  } = {}) {
    this.revision = normalizarTextoOpcional(revision, 120);
    const senalesNormalizadas = normalizarArrayLimitado(
      senales,
      1,
      LIMITES_TELEMETRIA_AGENTE.OBSERVACIONES_LOTE,
      'El catálogo de señales debe declarar al menos una señal.',
      'El catálogo de señales supera el límite permitido.'
    );
    this.senales = senalesNormalizadas.map((senal) =>
      crearDefinicionSenalAgente(senal)
    );
  }

  serializar() {
    return {
      revision: this.revision,
      senales: this.senales.map((senal) => senal.serializar())
    };
  }
}

export class LoteTelemetriaAgente {
  constructor({
    emitidoEnUtc = null,
    catalogo = null,
    observaciones = []
  } = {}) {
    this.emitidoEnUtc = normalizarFechaOpcional(emitidoEnUtc);
    this.catalogo = catalogo ? crearCatalogoSenalesAgente(catalogo) : null;
    const observacionesNormalizadas = normalizarArrayLimitado(
      observaciones,
      1,
      LIMITES_TELEMETRIA_AGENTE.OBSERVACIONES_LOTE,
      'El lote de telemetría debe contener al menos una observación.',
      'El lote de telemetría supera el límite permitido.'
    );
    this.observaciones = observacionesNormalizadas.map((observacion) =>
      crearLecturaTelemetriaAgente(observacion)
    );
  }

  serializar() {
    return {
      emitidoEnUtc: this.emitidoEnUtc,
      catalogo: this.catalogo?.serializar() || null,
      observaciones: this.observaciones.map((observacion) =>
        observacion.serializar()
      )
    };
  }
}

export class ResultadoIngestaTelemetria {
  constructor({
    ok = true,
    resultado = null,
    requestId,
    serverTimeUtc = new Date(),
    recibidoEnUtc = new Date(),
    aceptadas = 0,
    rechazadas = 0,
    errores = [],
    coordinacion = null
  } = {}) {
    this.aceptadas = normalizarEnteroMinimo(aceptadas, 0);
    this.rechazadas = normalizarEnteroMinimo(rechazadas, 0);
    this.errores = normalizarArray(errores).map(normalizarErrorIngesta);
    comprobarCoherenciaErroresIngesta(this.rechazadas, this.errores);
    this.ok = Boolean(ok) && this.rechazadas === 0;
    this.resultado = normalizarResultadoIngesta(
      resultado,
      this.aceptadas,
      this.rechazadas
    );
    this.requestId = normalizarTextoObligatorio(
      requestId,
      120,
      'El requestId del resultado de telemetría es obligatorio.'
    );
    this.serverTimeUtc = normalizarFechaServidor(serverTimeUtc);
    this.recibidoEnUtc = normalizarFechaServidor(recibidoEnUtc);
    this.coordinacion = coordinacion ? { ...coordinacion } : null;
  }

  serializar() {
    return {
      ok: this.ok,
      resultado: this.resultado,
      requestId: this.requestId,
      serverTimeUtc: this.serverTimeUtc,
      recibidoEnUtc: this.recibidoEnUtc,
      aceptadas: this.aceptadas,
      rechazadas: this.rechazadas,
      errores: this.errores.map((error) => ({ ...error })),
      coordinacion: this.coordinacion ? { ...this.coordinacion } : null
    };
  }
}

export class LecturaActualTelemetriaAgente {
  constructor({
    id = null,
    agenteId,
    senalId = null,
    ultimaObservacionId = null,
    periodoVidaPolId = null,
    sesionAuditoriaId = null,
    sesionIdDiagnostico = null,
    sesionHuellaSha256 = null,
    categoria,
    clave,
    tag = null,
    tipoDato,
    unidad = null,
    valorNumero = null,
    valorBooleano = null,
    valorTexto = null,
    valorEstado = null,
    valorJson = null,
    valorDuracion = null,
    valorMomentoUtc = null,
    calidad = CALIDADES_TELEMETRIA_AGENTE.VALIDA,
    severidadDeclarada = SEVERIDADES_DECLARADAS_TELEMETRIA_AGENTE.INFO,
    origen = ORIGENES_TELEMETRIA_AGENTE.DIRECTA,
    vigenteHastaUtc = null,
    detalleHumano = null,
    metadatos = null,
    emitidoEnUtc = null,
    observadoEnUtc,
    recibidoEnUtc
  } = {}, { permitirTiposInternos = false } = {}) {
    this.id = normalizarIdOpcional(id);
    this.agenteId = normalizarIdObligatorio(
      agenteId,
      'El agente de la fotografía de telemetría es obligatorio.'
    );
    this.senalId = normalizarIdOpcional(senalId);
    this.ultimaObservacionId = normalizarIdOpcional(ultimaObservacionId);
    this.periodoVidaPolId = normalizarIdOpcional(periodoVidaPolId);
    this.sesionAuditoriaId = normalizarTextoOpcional(sesionAuditoriaId, 36);
    this.sesionIdDiagnostico = normalizarTextoOpcional(sesionIdDiagnostico, 80);
    this.sesionHuellaSha256 = normalizarTextoOpcional(sesionHuellaSha256, 64);
    this.categoria = normalizarTextoObligatorio(
      categoria,
      LIMITES_TELEMETRIA_AGENTE.CATEGORIA,
      'La categoría de la fotografía de telemetría es obligatoria.'
    );
    this.clave = normalizarTextoObligatorio(
      clave,
      LIMITES_TELEMETRIA_AGENTE.CLAVE,
      'La clave de la fotografía de telemetría es obligatoria.'
    );
    this.tag = normalizarTextoOpcional(tag, LIMITES_TELEMETRIA_AGENTE.TAG);
    this.tipoDato = normalizarEnum(
      tipoDato,
      permitirTiposInternos ? TIPOS_INTERNOS_VALIDOS : TIPOS_VALIDOS,
      'El tipo de dato de la fotografía de telemetría no es válido.'
    );
    this.unidad = esTipoTemporal(this.tipoDato)
      ? normalizarUnidadTipoTemporalTelemetria(this.tipoDato, unidad)
      : normalizarTextoOpcional(unidad, LIMITES_TELEMETRIA_AGENTE.UNIDAD);
    const valorNormalizado = esTipoTemporal(this.tipoDato)
      ? normalizarCamposValorTelemetriaInterna({
        tipoDato: this.tipoDato,
        valorNumero,
        valorBooleano,
        valorTexto,
        valorEstado,
        valorJson,
        valorDuracion,
        valorMomentoUtc
      })
      : normalizarValorLecturaPorTipo({
      tipoDato: this.tipoDato,
      valorNumero,
      valorBooleano,
      valorTexto,
      valorEstado,
      valorJson
      });
    this.valorNumero = valorNormalizado.valorNumero;
    this.valorBooleano = valorNormalizado.valorBooleano;
    this.valorTexto = valorNormalizado.valorTexto;
    this.valorEstado = valorNormalizado.valorEstado;
    this.valorJson = valorNormalizado.valorJson;
    if (esTipoTemporal(this.tipoDato)) {
      this.valorDuracion = valorNormalizado.valorDuracion;
      this.valorMomentoUtc = valorNormalizado.valorMomentoUtc;
    }
    this.calidad = normalizarEnum(
      calidad,
      CALIDADES_VALIDAS,
      'La calidad de la fotografía de telemetría no es válida.'
    );
    this.severidadDeclarada = normalizarEnum(
      severidadDeclarada,
      SEVERIDADES_VALIDAS,
      'La severidad declarada de la fotografía de telemetría no es válida.'
    );
    this.origen = normalizarEnum(
      origen,
      ORIGENES_VALIDOS,
      'El origen de la fotografía de telemetría no es válido.'
    );
    this.vigenteHastaUtc = normalizarFechaOpcional(vigenteHastaUtc);
    this.detalleHumano = normalizarTextoOpcional(
      detalleHumano,
      LIMITES_TELEMETRIA_AGENTE.DETALLE_HUMANO
    );
    this.metadatos = normalizarJsonOpcional(metadatos);
    this.emitidoEnUtc = normalizarFechaOpcional(emitidoEnUtc);
    this.observadoEnUtc = normalizarFechaObligatoria(
      observadoEnUtc,
      'La fecha observada de la fotografía de telemetría es obligatoria.'
    );
    this.recibidoEnUtc = normalizarFechaObligatoria(
      recibidoEnUtc,
      'La fecha recibida de la fotografía de telemetría es obligatoria.'
    );
    this.codigoSenal = construirCodigoSenal(this);
  }

  serializar() {
    const serializada = {
      id: this.id,
      agenteId: this.agenteId,
      senalId: this.senalId,
      ultimaObservacionId: this.ultimaObservacionId,
      periodoVidaPolId: this.periodoVidaPolId,
      sesionAuditoriaId: this.sesionAuditoriaId,
      sesionIdDiagnostico: this.sesionIdDiagnostico,
      sesionHuellaSha256: this.sesionHuellaSha256,
      categoria: this.categoria,
      clave: this.clave,
      tag: this.tag,
      codigoSenal: this.codigoSenal,
      tipoDato: this.tipoDato,
      unidad: this.unidad,
      valorNumero: this.valorNumero,
      valorBooleano: this.valorBooleano,
      valorTexto: this.valorTexto,
      valorEstado: this.valorEstado,
      valorJson: clonarJson(this.valorJson),
      calidad: this.calidad,
      severidadDeclarada: this.severidadDeclarada,
      origen: this.origen,
      vigenteHastaUtc: this.vigenteHastaUtc,
      detalleHumano: this.detalleHumano,
      metadatos: clonarJson(this.metadatos),
      emitidoEnUtc: this.emitidoEnUtc,
      observadoEnUtc: this.observadoEnUtc,
      recibidoEnUtc: this.recibidoEnUtc
    };
    if (esTipoTemporal(this.tipoDato)) {
      serializada.valorDuracion = this.valorDuracion;
      serializada.valorMomentoUtc = this.valorMomentoUtc;
    }
    return serializada;
  }
}

export function crearDefinicionSenalAgente(datos) {
  return datos instanceof DefinicionSenalAgente
    ? datos
    : new DefinicionSenalAgente(datos || {});
}

export function crearDefinicionSenalAgenteConTiposInternos(datos) {
  if (
    datos instanceof DefinicionSenalAgente &&
    TIPOS_INTERNOS_VALIDOS.has(datos.tipoDato)
  ) {
    return datos;
  }
  return new DefinicionSenalAgente(datos || {}, { permitirTiposInternos: true });
}

export function crearSenalTelemetriaAgente(datos) {
  return datos instanceof SenalTelemetriaAgente
    ? datos
    : new SenalTelemetriaAgente(datos || {});
}

export function crearSenalTelemetriaAgenteConTiposInternos(datos) {
  if (
    datos instanceof SenalTelemetriaAgente &&
    TIPOS_INTERNOS_VALIDOS.has(datos.tipoDato)
  ) {
    return datos;
  }
  return new SenalTelemetriaAgente(datos || {}, { permitirTiposInternos: true });
}

export function crearLecturaTelemetriaAgente(datos) {
  return datos instanceof LecturaTelemetriaAgente
    ? datos
    : new LecturaTelemetriaAgente(datos || {});
}

export function crearLecturaTelemetriaAgenteConTiposInternos(datos) {
  if (
    datos instanceof LecturaTelemetriaAgente &&
    TIPOS_INTERNOS_VALIDOS.has(datos.tipoDato)
  ) {
    return datos;
  }
  return new LecturaTelemetriaAgente(datos || {}, { permitirTiposInternos: true });
}

export function crearCatalogoSenalesAgente(datos) {
  return datos instanceof CatalogoSenalesAgente
    ? datos
    : new CatalogoSenalesAgente(datos || {});
}

export function crearLoteTelemetriaAgente(datos) {
  return datos instanceof LoteTelemetriaAgente
    ? datos
    : new LoteTelemetriaAgente(datos || {});
}

export function crearResultadoIngestaTelemetria(datos) {
  return datos instanceof ResultadoIngestaTelemetria
    ? datos
    : new ResultadoIngestaTelemetria(datos || {});
}

export function crearLecturaActualTelemetriaAgente(datos) {
  return datos instanceof LecturaActualTelemetriaAgente
    ? datos
    : new LecturaActualTelemetriaAgente(datos || {});
}

export function crearLecturaActualTelemetriaAgenteConTiposInternos(datos) {
  if (
    datos instanceof LecturaActualTelemetriaAgente &&
    TIPOS_INTERNOS_VALIDOS.has(datos.tipoDato)
  ) {
    return datos;
  }
  return new LecturaActualTelemetriaAgente(
    datos || {},
    { permitirTiposInternos: true }
  );
}

export function resolverActualizacionFotografiaTelemetria({
  actual = null,
  candidata
} = {}) {
  const candidataNormalizada = crearLecturaActualTelemetriaAgenteConTiposInternos(
    candidata
  );

  if (!actual) {
    return {
      actualizar: true,
      resultado: RESULTADOS_ACTUALIZACION_FOTOGRAFIA_TELEMETRIA.CREAR,
      motivo: 'sin_fotografia_actual'
    };
  }

  const actualNormalizada = crearLecturaActualTelemetriaAgenteConTiposInternos(actual);
  asegurarMismaIdentidadFotografia(actualNormalizada, candidataNormalizada);

  const comparacionTemporal = compararFechasIso(
    candidataNormalizada.observadoEnUtc,
    actualNormalizada.observadoEnUtc
  );

  if (comparacionTemporal > 0) {
    return {
      actualizar: true,
      resultado: RESULTADOS_ACTUALIZACION_FOTOGRAFIA_TELEMETRIA.ACTUALIZAR,
      motivo: 'observacion_mas_reciente'
    };
  }

  if (comparacionTemporal < 0) {
    return {
      actualizar: false,
      resultado: RESULTADOS_ACTUALIZACION_FOTOGRAFIA_TELEMETRIA.IGNORAR_ANTIGUA,
      motivo: 'observacion_mas_antigua'
    };
  }

  if (
    candidataNormalizada.ultimaObservacionId &&
    actualNormalizada.ultimaObservacionId &&
    candidataNormalizada.ultimaObservacionId > actualNormalizada.ultimaObservacionId
  ) {
    return {
      actualizar: true,
      resultado: RESULTADOS_ACTUALIZACION_FOTOGRAFIA_TELEMETRIA.ACTUALIZAR,
      motivo: 'misma_fecha_observada_observacion_posterior'
    };
  }

  return {
    actualizar: false,
    resultado: RESULTADOS_ACTUALIZACION_FOTOGRAFIA_TELEMETRIA.IGNORAR_MISMA_OBSERVACION,
    motivo: 'misma_fecha_observada_sin_desempate'
  };
}

export function construirCodigoSenal({
  categoria,
  clave,
  tag = null
} = {}) {
  const categoriaNormalizada = normalizarTextoObligatorio(
    categoria,
    LIMITES_TELEMETRIA_AGENTE.CATEGORIA,
    'La categoría de la señal de telemetría es obligatoria.'
  );
  const claveNormalizada = normalizarTextoObligatorio(
    clave,
    LIMITES_TELEMETRIA_AGENTE.CLAVE,
    'La clave de la señal de telemetría es obligatoria.'
  );
  const tagNormalizado = normalizarTextoOpcional(
    tag,
    LIMITES_TELEMETRIA_AGENTE.TAG
  );

  return tagNormalizado
    ? `${categoriaNormalizada}.${claveNormalizada}:${tagNormalizado}`
    : `${categoriaNormalizada}.${claveNormalizada}`;
}

function normalizarIdObligatorio(valor, mensaje) {
  const normalizado = normalizarIdOpcional(valor);

  if (!normalizado) {
    throw new Error(mensaje);
  }

  return normalizado;
}

function normalizarIdOpcional(valor) {
  if (valor == null || valor === '') {
    return null;
  }

  const normalizado = Number.parseInt(String(valor), 10);
  return Number.isInteger(normalizado) && normalizado > 0
    ? normalizado
    : null;
}

function normalizarArray(valor) {
  return Array.isArray(valor) ? valor : [];
}

function normalizarArrayLimitado(
  valor,
  minimo,
  maximo,
  mensajeMinimo,
  mensajeMaximo
) {
  const normalizado = normalizarArray(valor);

  if (normalizado.length < minimo) {
    throw new Error(mensajeMinimo);
  }

  if (normalizado.length > maximo) {
    throw new Error(mensajeMaximo);
  }

  return normalizado;
}

function normalizarTextoObligatorio(valor, longitudMaxima, mensaje) {
  const normalizado = normalizarTextoOpcional(valor, longitudMaxima);

  if (!normalizado) {
    throw new Error(mensaje);
  }

  return normalizado;
}

function normalizarTextoOpcional(valor, longitudMaxima) {
  const normalizado = String(valor ?? '').trim();

  if (!normalizado) {
    return null;
  }

  if (superaLimiteCaracteres(normalizado, longitudMaxima)) {
    throw new Error('El texto de telemetría supera el límite permitido.');
  }

  return normalizado;
}

function normalizarEnum(valor, valoresValidos, mensaje) {
  const normalizado = String(valor ?? '').trim().toLowerCase();

  if (!valoresValidos.has(normalizado)) {
    throw new Error(mensaje);
  }

  return normalizado;
}

function normalizarFechaObligatoria(valor, mensaje) {
  const normalizada = normalizarFechaOpcional(valor);

  if (!normalizada) {
    throw new Error(mensaje);
  }

  return normalizada;
}

function normalizarFechaOpcional(valor) {
  if (!valor) {
    return null;
  }

  const fecha = valor instanceof Date ? valor : new Date(valor);

  if (Number.isNaN(fecha.getTime())) {
    throw new Error('La fecha de telemetría no es válida.');
  }

  return fecha.toISOString();
}

function normalizarFechaServidor(valor) {
  return normalizarFechaOpcional(valor) || new Date().toISOString();
}

function normalizarEnteroMinimo(valor, minimo) {
  const convertido = Number.parseInt(String(valor ?? ''), 10);
  return Number.isInteger(convertido) && convertido >= minimo
    ? convertido
    : minimo;
}

function normalizarValorLecturaPorTipo({
  tipoDato,
  valorNumero,
  valorBooleano,
  valorTexto,
  valorEstado,
  valorJson
}) {
  const valoresPresentes = obtenerCamposValorPresentes({
    valorNumero,
    valorBooleano,
    valorTexto,
    valorEstado,
    valorJson
  });

  if (valoresPresentes.length !== 1) {
    throw new Error(
      'La lectura de telemetría debe declarar exactamente un campo de valor.'
    );
  }

  const campoEsperado = obtenerCampoValorEsperado(tipoDato);

  if (valoresPresentes[0] !== campoEsperado) {
    throw new Error(
      `La lectura de telemetría de tipo ${tipoDato} debe usar ${campoEsperado}.`
    );
  }

  return {
    valorNumero:
      tipoDato === TIPOS_DATO_TELEMETRIA_AGENTE.NUMERO
        ? normalizarValorNumero(valorNumero)
        : null,
    valorBooleano:
      tipoDato === TIPOS_DATO_TELEMETRIA_AGENTE.BOOLEANO
        ? normalizarValorBooleano(valorBooleano)
        : null,
    valorTexto:
      tipoDato === TIPOS_DATO_TELEMETRIA_AGENTE.TEXTO
        ? normalizarTextoObligatorio(
            valorTexto,
            LIMITES_TELEMETRIA_AGENTE.VALOR_TEXTO,
            'El valor textual de la lectura de telemetría es obligatorio.'
          )
        : null,
    valorEstado:
      tipoDato === TIPOS_DATO_TELEMETRIA_AGENTE.ESTADO
        ? normalizarTextoObligatorio(
            valorEstado,
            LIMITES_TELEMETRIA_AGENTE.ESTADO,
            'El estado de la lectura de telemetría es obligatorio.'
          )
        : null,
    valorJson:
      tipoDato === TIPOS_DATO_TELEMETRIA_AGENTE.JSON
        ? normalizarJsonObligatorio(valorJson)
        : null
  };
}

function esTipoTemporal(tipoDato) {
  return tipoDato === TIPOS_DATO_INTERNOS_TELEMETRIA_AGENTE.DURACION ||
    tipoDato === TIPOS_DATO_INTERNOS_TELEMETRIA_AGENTE.MOMENTO_UTC;
}

function obtenerCamposValorPresentes(valores) {
  return Object.entries(valores)
    .filter(([, valor]) => valorEstaPresente(valor))
    .map(([campo]) => campo);
}

function valorEstaPresente(valor) {
  if (valor == null) {
    return false;
  }

  if (typeof valor === 'string') {
    return valor.trim() !== '';
  }

  return true;
}

function obtenerCampoValorEsperado(tipoDato) {
  return CAMPOS_VALOR_POR_TIPO_TELEMETRIA_AGENTE[tipoDato];
}

function normalizarValorNumero(valor) {
  if (typeof valor !== 'number' || !Number.isFinite(valor)) {
    throw new Error('El valor numérico de la lectura de telemetría no es válido.');
  }

  return valor;
}

function normalizarValorBooleano(valor) {
  if (typeof valor !== 'boolean') {
    throw new Error('El valor booleano de la lectura de telemetría no es válido.');
  }

  return valor;
}

function normalizarJsonOpcional(valor) {
  if (valor == null || valor === '') {
    return null;
  }

  if (typeof valor !== 'object' || Array.isArray(valor)) {
    return null;
  }

  return clonarJsonAcotado(valor);
}

function normalizarJsonObligatorio(valor) {
  const normalizado = normalizarJsonOpcional(valor);

  if (!normalizado) {
    throw new Error('El valor JSON de la lectura de telemetría no es válido.');
  }

  return normalizado;
}

function clonarJson(valor) {
  if (valor == null) {
    return null;
  }

  return JSON.parse(JSON.stringify(valor));
}

function clonarJsonAcotado(valor) {
  const serializado = JSON.stringify(valor);

  if (superaLimiteCaracteres(serializado, LIMITES_TELEMETRIA_AGENTE.JSON_SERIALIZADO)) {
    throw new Error(
      'El JSON de la lectura de telemetría supera el límite permitido.'
    );
  }

  return JSON.parse(serializado);
}

function superaLimiteCaracteres(texto, maximo) {
  // maxLength del contrato cuenta puntos Unicode, no bytes ni unidades UTF-16.
  let longitud = 0;
  for (const _caracter of texto) {
    if (++longitud > maximo) return true;
  }
  return false;
}

function comprobarCoherenciaDefinicionSenal(lectura) {
  if (!lectura.definicionSenal) {
    return;
  }

  const pares = [
    ['categoria', lectura.categoria, lectura.definicionSenal.categoria],
    ['clave', lectura.clave, lectura.definicionSenal.clave],
    ['tag', lectura.tag, lectura.definicionSenal.tag],
    ['tipoDato', lectura.tipoDato, lectura.definicionSenal.tipoDato],
    ['unidad', lectura.unidad, lectura.definicionSenal.unidad]
  ];

  for (const [campo, valorLectura, valorDefinicion] of pares) {
    if (valorLectura !== valorDefinicion) {
      throw new Error(
        `La definición de señal embebida no coincide con la lectura en ${campo}.`
      );
    }
  }
}

function asegurarMismaIdentidadFotografia(actual, candidata) {
  const campos = ['agenteId', 'categoria', 'clave', 'tag'];

  for (const campo of campos) {
    if (actual[campo] !== candidata[campo]) {
      throw new Error(
        `La fotografía actual de telemetría no coincide con la candidata en ${campo}.`
      );
    }
  }
}

function compararFechasIso(izquierda, derecha) {
  const fechaIzquierda = new Date(izquierda).getTime();
  const fechaDerecha = new Date(derecha).getTime();

  if (fechaIzquierda > fechaDerecha) {
    return 1;
  }

  if (fechaIzquierda < fechaDerecha) {
    return -1;
  }

  return 0;
}

function normalizarErrorIngesta(error = {}) {
  return {
    indice: normalizarEnteroMinimo(error.indice, 0),
    code: normalizarTextoObligatorio(
      error.code,
      LIMITES_TELEMETRIA_AGENTE.CODIGO_ERROR,
      'El código del error de telemetría es obligatorio.'
    ),
    message: normalizarTextoObligatorio(
      error.message,
      LIMITES_TELEMETRIA_AGENTE.MENSAJE_ERROR,
      'El mensaje del error de telemetría es obligatorio.'
    ),
    campo: normalizarTextoOpcional(
      error.campo,
      LIMITES_TELEMETRIA_AGENTE.CAMPO_ERROR
    )
  };
}

function comprobarCoherenciaErroresIngesta(rechazadas, errores) {
  if (rechazadas !== errores.length) {
    throw new Error(
      'Las observaciones rechazadas deben coincidir con los errores de ingesta.'
    );
  }
}

function normalizarResultadoIngesta(resultado, aceptadas, rechazadas) {
  const normalizado = String(resultado ?? '').trim().toLowerCase();

  if (RESULTADOS_VALIDOS.has(normalizado)) {
    return normalizado;
  }

  if (rechazadas > 0 && aceptadas > 0) {
    return RESULTADOS_INGESTA_TELEMETRIA.PARCIAL;
  }

  if (rechazadas > 0) {
    return RESULTADOS_INGESTA_TELEMETRIA.RECHAZADO;
  }

  return RESULTADOS_INGESTA_TELEMETRIA.ACEPTADO;
}
