import {
  CALIDADES_TELEMETRIA_AGENTE
} from './TelemetriaAgente.js';
import {
  normalizarValorDuracionTelemetria,
  normalizarValorMomentoUtcTelemetria
} from './ContratoTelemetriaTemporalAgente.js';
import {
  normalizarPatronRegexTelemetria
} from './MotorRegexSeguroTelemetria.js';
import {
  CondicionMomentoUtcRelativo,
  TIPO_CONDICION_MOMENTO_UTC_RELATIVO
} from './EvaluadorMomentoUtcRelativoTelemetria.js';

export const ESTADOS_REGLA_DERIVACION_TELEMETRIA = Object.freeze({
  ACTIVA: 'activa',
  DESHABILITADA: 'deshabilitada'
});

export const RESULTADOS_EVALUACION_REGLA_TELEMETRIA = Object.freeze({
  COINCIDE: 'coincide',
  NO_COINCIDE: 'no_coincide',
  NO_EVALUABLE: 'no_evaluable'
});

export const TIPOS_CONDICION_DERIVACION_TELEMETRIA = Object.freeze({
  NUMERO: 'numero',
  BOOLEANO: 'booleano',
  ESTADO: 'estado',
  TEXTO: 'texto',
  CALIDAD: 'calidad',
  DURACION: 'duracion',
  MOMENTO_UTC: 'momento_utc',
  TEXTO_REGEX: 'texto_regex'
});

export const OPERADORES_CONDICION_DERIVACION_TELEMETRIA = Object.freeze({
  MAYOR_QUE: '>',
  MAYOR_O_IGUAL: '>=',
  MENOR_QUE: '<',
  MENOR_O_IGUAL: '<=',
  IGUAL: '=',
  DISTINTO: '!='
});

export const LIMITES_EVENTOS_DERIVADOS_TELEMETRIA = Object.freeze({
  TIPO_CONDICION: 40,
  SEVERIDAD_CALCULADA: 32,
  NOMBRE: 160,
  DESCRIPCION: 512,
  MENSAJE_OPERATIVO: 512,
  CODIGO_MOTIVO: 80,
  EXPLICACION: 512,
  TIPO_DATO: 32,
  UNIDAD: 32,
  CALIDAD: 32,
  JSON_SERIALIZADO: 4096
});

const ESTADOS_REGLA_VALIDOS = new Set(
  Object.values(ESTADOS_REGLA_DERIVACION_TELEMETRIA)
);
const RESULTADOS_EVALUACION_VALIDOS = new Set(
  Object.values(RESULTADOS_EVALUACION_REGLA_TELEMETRIA)
);
const TIPOS_CONDICION_VALIDOS = new Set(
  Object.values(TIPOS_CONDICION_DERIVACION_TELEMETRIA)
);
const OPERADORES_NUMERICOS_VALIDOS = new Set([
  OPERADORES_CONDICION_DERIVACION_TELEMETRIA.MAYOR_QUE,
  OPERADORES_CONDICION_DERIVACION_TELEMETRIA.MAYOR_O_IGUAL,
  OPERADORES_CONDICION_DERIVACION_TELEMETRIA.MENOR_QUE,
  OPERADORES_CONDICION_DERIVACION_TELEMETRIA.MENOR_O_IGUAL,
  OPERADORES_CONDICION_DERIVACION_TELEMETRIA.IGUAL,
  OPERADORES_CONDICION_DERIVACION_TELEMETRIA.DISTINTO
]);
const OPERADORES_IGUALDAD_VALIDOS = new Set([
  OPERADORES_CONDICION_DERIVACION_TELEMETRIA.IGUAL,
  OPERADORES_CONDICION_DERIVACION_TELEMETRIA.DISTINTO
]);
const CALIDADES_TELEMETRIA_VALIDAS = new Set(
  Object.values(CALIDADES_TELEMETRIA_AGENTE)
);

export class CondicionDerivacionTelemetria {
  constructor({ tipo, version = 1, configuracion } = {}) {
    this.tipo = normalizarEnum(
      tipo,
      TIPOS_CONDICION_VALIDOS,
      'El tipo de condición de telemetría no es válido.'
    );
    this.version = normalizarEnteroPositivo(
      version,
      'La versión de la condición de telemetría debe ser positiva.'
    );
    if (this.version !== 1) {
      throw new Error('La versión de la condición de telemetría no está soportada.');
    }
    this.configuracion = congelarJson(
      normalizarConfiguracionCondicion(this.tipo, configuracion)
    );

    Object.freeze(this);
  }

  obtenerCanonica() {
    return serializarJsonCanonico(this.serializar());
  }

  serializar() {
    return {
      tipo: this.tipo,
      version: this.version,
      configuracion: clonarJson(this.configuracion)
    };
  }
}

export class ReglaDerivacionTelemetria {
  constructor({
    id,
    agente,
    senal,
    scope,
    estado = ESTADOS_REGLA_DERIVACION_TELEMETRIA.ACTIVA,
    revisionVigenteId = null,
    generacionAutoridad = 1
  } = {}) {
    this.id = normalizarEnteroPositivo(
      id,
      'La identidad de la regla de derivación es obligatoria.'
    );
    const objetivo = normalizarObjetivoRegla({ agente, senal, scope });
    this.agenteId = objetivo.agenteId;
    this.senalId = objetivo.senalId;
    this.tenantId = objetivo.tenantId;
    this.empresaId = objetivo.empresaId;
    this.sitioId = objetivo.sitioId;
    this.estado = normalizarEnum(
      estado,
      ESTADOS_REGLA_VALIDOS,
      'El estado de la regla de derivación no es válido.'
    );
    this.revisionVigenteId = normalizarEnteroPositivoOpcional(
      revisionVigenteId,
      'La revisión vigente de la regla no es válida.'
    );
    this.generacionAutoridad = normalizarEnteroPositivo(
      generacionAutoridad,
      'La generación de autoridad de la regla debe ser positiva.'
    );

    Object.freeze(this);
  }

  estaActiva() {
    return this.estado === ESTADOS_REGLA_DERIVACION_TELEMETRIA.ACTIVA;
  }

  admiteRevision(revision) {
    return revision instanceof RevisionReglaDerivacionTelemetria &&
      revision.reglaId === this.id;
  }

  serializar() {
    return {
      id: this.id,
      agenteId: this.agenteId,
      senalId: this.senalId,
      tenantId: this.tenantId,
      empresaId: this.empresaId,
      sitioId: this.sitioId,
      estado: this.estado,
      revisionVigenteId: this.revisionVigenteId,
      generacionAutoridad: this.generacionAutoridad
    };
  }
}

export class RevisionReglaDerivacionTelemetria {
  constructor({
    id,
    reglaId,
    numero,
    condicion,
    severidadCalculada,
    mensajeOperativo,
    nombre,
    descripcion = null,
    metadatos = null,
    vigenteDesdeUtc,
    vigenteHastaUtc = null
  } = {}) {
    this.id = normalizarEnteroPositivo(
      id,
      'La identidad de la revisión de regla es obligatoria.'
    );
    this.reglaId = normalizarEnteroPositivo(
      reglaId,
      'La regla de la revisión es obligatoria.'
    );
    this.numero = normalizarEnteroPositivo(
      numero,
      'El número de revisión debe ser positivo.'
    );
    this.condicion = crearCondicionDerivacionTelemetria(condicion);
    this.severidadCalculada = normalizarTextoObligatorio(
      severidadCalculada,
      LIMITES_EVENTOS_DERIVADOS_TELEMETRIA.SEVERIDAD_CALCULADA,
      'La severidad calculada de la revisión es obligatoria.'
    );
    this.mensajeOperativo = normalizarTextoObligatorio(
      mensajeOperativo,
      LIMITES_EVENTOS_DERIVADOS_TELEMETRIA.MENSAJE_OPERATIVO,
      'El mensaje operativo de la revisión es obligatorio.'
    );
    this.nombre = normalizarTextoObligatorio(
      nombre,
      LIMITES_EVENTOS_DERIVADOS_TELEMETRIA.NOMBRE,
      'El nombre de la revisión es obligatorio.'
    );
    this.descripcion = normalizarTextoOpcional(
      descripcion,
      LIMITES_EVENTOS_DERIVADOS_TELEMETRIA.DESCRIPCION
    );
    this.metadatos = congelarJson(normalizarObjetoJsonOpcional(metadatos));
    this.vigenteDesdeUtc = normalizarFechaUtcObligatoria(
      vigenteDesdeUtc,
      'La fecha inicial de vigencia de la revisión es obligatoria.'
    );
    this.vigenteHastaUtc = normalizarFechaUtcOpcional(vigenteHastaUtc);

    if (
      this.vigenteHastaUtc &&
      Date.parse(this.vigenteHastaUtc) <= Date.parse(this.vigenteDesdeUtc)
    ) {
      throw new Error(
        'La fecha final de vigencia debe ser posterior a la fecha inicial.'
      );
    }

    Object.freeze(this);
  }

  estaAbierta() {
    return this.vigenteHastaUtc === null;
  }

  esAplicableEn(recibidoEnUtc) {
    const instante = Date.parse(
      normalizarFechaUtcObligatoria(
        recibidoEnUtc,
        'La fecha recibida de la observación es obligatoria.'
      )
    );

    return instante >= Date.parse(this.vigenteDesdeUtc) &&
      (this.vigenteHastaUtc === null || instante < Date.parse(this.vigenteHastaUtc));
  }

  serializar() {
    return {
      id: this.id,
      reglaId: this.reglaId,
      numero: this.numero,
      condicion: this.condicion.serializar(),
      condicionCanonica: this.condicion.obtenerCanonica(),
      severidadCalculada: this.severidadCalculada,
      mensajeOperativo: this.mensajeOperativo,
      nombre: this.nombre,
      descripcion: this.descripcion,
      metadatos: clonarJson(this.metadatos),
      vigenteDesdeUtc: this.vigenteDesdeUtc,
      vigenteHastaUtc: this.vigenteHastaUtc
    };
  }
}

export class ResultadoEvaluacionRegla {
  constructor({
    regla,
    revision,
    observacion,
    resultado,
    codigoMotivo,
    explicacion,
    evaluadoEnUtc,
    evidenciaContextual = null
  } = {}) {
    comprobarReglaYRevision(regla, revision);
    const evidencia = normalizarObservacionEvaluada(observacion);

    if (
      evidencia.agenteId !== regla.agenteId ||
      evidencia.senalId !== regla.senalId
    ) {
      throw new Error('La observación evaluada no pertenece al objetivo de la regla.');
    }
    if (!revision.esAplicableEn(evidencia.recibidoEnUtc)) {
      throw new Error(
        'La revisión evaluada no estaba vigente cuando se recibió la observación.'
      );
    }

    this.reglaId = regla.id;
    this.revisionId = revision.id;
    this.agenteId = regla.agenteId;
    this.senalId = regla.senalId;
    this.observacionId = evidencia.id;
    this.tenantId = regla.tenantId;
    this.empresaId = regla.empresaId;
    this.sitioId = regla.sitioId;
    this.resultado = normalizarEnum(
      resultado,
      RESULTADOS_EVALUACION_VALIDOS,
      'El resultado de evaluación de la regla no es válido.'
    );
    this.codigoMotivo = normalizarCodigo(
      codigoMotivo,
      LIMITES_EVENTOS_DERIVADOS_TELEMETRIA.CODIGO_MOTIVO
    );
    this.explicacion = normalizarTextoObligatorio(
      explicacion,
      LIMITES_EVENTOS_DERIVADOS_TELEMETRIA.EXPLICACION,
      'La explicación del resultado de evaluación es obligatoria.'
    );
    this.condicionCanonica = revision.condicion.obtenerCanonica();
    this.valorEvaluado = congelarJson(clonarJson(evidencia.valor));
    this.tipoDato = evidencia.tipoDato;
    this.unidad = evidencia.unidad;
    this.calidad = evidencia.calidad;
    this.observadoEnUtc = evidencia.observadoEnUtc;
    this.recibidoEnUtc = evidencia.recibidoEnUtc;
    this.evaluadoEnUtc = normalizarFechaUtcObligatoria(
      evaluadoEnUtc,
      'La fecha de evaluación es obligatoria.'
    );

    if (Date.parse(this.evaluadoEnUtc) < Date.parse(this.recibidoEnUtc)) {
      throw new Error('La evaluación no puede ser anterior a la recepción.');
    }

    this.severidadCalculada =
      this.resultado === RESULTADOS_EVALUACION_REGLA_TELEMETRIA.COINCIDE
        ? revision.severidadCalculada
        : null;
    this.mensajeOperativo = revision.mensajeOperativo;
    this.evidenciaContextual = congelarJson(
      normalizarObjetoJsonOpcional(evidenciaContextual)
    );

    Object.freeze(this);
  }

  coincide() {
    return this.resultado === RESULTADOS_EVALUACION_REGLA_TELEMETRIA.COINCIDE;
  }

  serializar() {
    return {
      reglaId: this.reglaId,
      revisionId: this.revisionId,
      agenteId: this.agenteId,
      senalId: this.senalId,
      observacionId: this.observacionId,
      tenantId: this.tenantId,
      empresaId: this.empresaId,
      sitioId: this.sitioId,
      resultado: this.resultado,
      codigoMotivo: this.codigoMotivo,
      explicacion: this.explicacion,
      condicionCanonica: this.condicionCanonica,
      valorEvaluado: clonarJson(this.valorEvaluado),
      tipoDato: this.tipoDato,
      unidad: this.unidad,
      calidad: this.calidad,
      observadoEnUtc: this.observadoEnUtc,
      recibidoEnUtc: this.recibidoEnUtc,
      evaluadoEnUtc: this.evaluadoEnUtc,
      severidadCalculada: this.severidadCalculada,
      mensajeOperativo: this.mensajeOperativo,
      evidenciaContextual: clonarJson(this.evidenciaContextual)
    };
  }
}

export function crearCondicionDerivacionTelemetria(datos) {
  if (datos instanceof CondicionDerivacionTelemetria ||
      datos instanceof CondicionMomentoUtcRelativo) {
    return datos;
  }
  if (datos?.tipo === TIPO_CONDICION_MOMENTO_UTC_RELATIVO) {
    return new CondicionMomentoUtcRelativo(datos);
  }
  return new CondicionDerivacionTelemetria(datos);
}

export function crearReglaDerivacionTelemetria(datos) {
  return datos instanceof ReglaDerivacionTelemetria
    ? datos
    : new ReglaDerivacionTelemetria(datos);
}

export function crearRevisionReglaDerivacionTelemetria(datos) {
  return datos instanceof RevisionReglaDerivacionTelemetria
    ? datos
    : new RevisionReglaDerivacionTelemetria(datos);
}

export function crearResultadoEvaluacionRegla(datos) {
  return datos instanceof ResultadoEvaluacionRegla
    ? datos
    : new ResultadoEvaluacionRegla(datos);
}

function normalizarObjetivoRegla({ agente, senal, scope }) {
  if (!agente || typeof agente !== 'object') {
    throw new Error('El agente objetivo de la regla es obligatorio.');
  }
  if (!senal || typeof senal !== 'object') {
    throw new Error('La señal objetivo de la regla es obligatoria.');
  }
  if (!scope || typeof scope !== 'object') {
    throw new Error('El scope de la regla es obligatorio.');
  }

  const agenteId = normalizarEnteroPositivo(
    agente.id,
    'La identidad del agente objetivo no es válida.'
  );
  const senalId = normalizarEnteroPositivo(
    senal.id,
    'La identidad de la señal objetivo no es válida.'
  );
  const senalAgenteId = normalizarEnteroPositivo(
    senal.agenteId,
    'El agente propietario de la señal es obligatorio.'
  );
  const scopeAgente = normalizarScope(agente);
  const scopeRegla = normalizarScope(scope);

  if (senalAgenteId !== agenteId) {
    throw new Error('La señal objetivo no pertenece al agente de la regla.');
  }
  if (!sonScopesIguales(scopeAgente, scopeRegla)) {
    throw new Error('El scope de la regla debe coincidir exactamente con el del agente.');
  }

  return { agenteId, senalId, ...scopeRegla };
}

function normalizarScope({ tenantId, empresaId, sitioId }) {
  return {
    tenantId: normalizarEnteroPositivo(tenantId, 'El tenant del scope es obligatorio.'),
    empresaId: normalizarEnteroPositivo(empresaId, 'La empresa del scope es obligatoria.'),
    sitioId: normalizarEnteroPositivo(sitioId, 'El sitio del scope es obligatorio.')
  };
}

function sonScopesIguales(izquierdo, derecho) {
  return izquierdo.tenantId === derecho.tenantId &&
    izquierdo.empresaId === derecho.empresaId &&
    izquierdo.sitioId === derecho.sitioId;
}

function comprobarReglaYRevision(regla, revision) {
  if (!(regla instanceof ReglaDerivacionTelemetria)) {
    throw new Error('La regla evaluada no es válida.');
  }
  if (!(revision instanceof RevisionReglaDerivacionTelemetria)) {
    throw new Error('La revisión evaluada no es válida.');
  }
  if (!regla.admiteRevision(revision)) {
    throw new Error('La revisión evaluada no pertenece a la regla.');
  }
}

function normalizarObservacionEvaluada(observacion) {
  if (!observacion || typeof observacion !== 'object') {
    throw new Error('La observación evaluada es obligatoria.');
  }

  return {
    id: normalizarEnteroPositivo(observacion.id, 'La observación evaluada no es válida.'),
    agenteId: normalizarEnteroPositivo(
      observacion.agenteId,
      'El agente de la observación evaluada es obligatorio.'
    ),
    senalId: normalizarEnteroPositivo(
      observacion.senalId,
      'La señal de la observación evaluada es obligatoria.'
    ),
    valor: normalizarValorJson(observacion.valor),
    tipoDato: normalizarTextoObligatorio(
      observacion.tipoDato,
      LIMITES_EVENTOS_DERIVADOS_TELEMETRIA.TIPO_DATO,
      'El tipo de dato de la observación evaluada es obligatorio.'
    ),
    unidad: normalizarTextoOpcional(
      observacion.unidad,
      LIMITES_EVENTOS_DERIVADOS_TELEMETRIA.UNIDAD
    ),
    calidad: normalizarTextoObligatorio(
      observacion.calidad,
      LIMITES_EVENTOS_DERIVADOS_TELEMETRIA.CALIDAD,
      'La calidad de la observación evaluada es obligatoria.'
    ),
    observadoEnUtc: normalizarFechaUtcObligatoria(
      observacion.observadoEnUtc,
      'La fecha observada es obligatoria.'
    ),
    recibidoEnUtc: normalizarFechaUtcObligatoria(
      observacion.recibidoEnUtc,
      'La fecha recibida es obligatoria.'
    )
  };
}

function normalizarValorJson(valor) {
  if (valor === undefined) {
    throw new Error('El valor tipado de la observación evaluada es obligatorio.');
  }
  comprobarJsonSerializable(valor, 'El valor evaluado no es JSON válido.');
  return clonarJson(valor);
}

function normalizarConfiguracionCondicion(tipo, configuracion) {
  if (!esObjetoPlano(configuracion)) {
    throw new Error('La configuración de la condición debe ser un objeto JSON.');
  }

  switch (tipo) {
    case TIPOS_CONDICION_DERIVACION_TELEMETRIA.NUMERO:
      comprobarClavesExactas(configuracion, ['operador', 'umbral', 'unidad']);
      return {
        operador: normalizarOperador(
          configuracion.operador,
          OPERADORES_NUMERICOS_VALIDOS
        ),
        umbral: normalizarNumeroFinito(
          configuracion.umbral,
          'El umbral de la condición numérica debe ser un número finito.'
        ),
        unidad: normalizarTextoOpcional(
          configuracion.unidad,
          LIMITES_EVENTOS_DERIVADOS_TELEMETRIA.UNIDAD
        )
      };
    case TIPOS_CONDICION_DERIVACION_TELEMETRIA.DURACION:
      comprobarClavesExactas(configuracion, ['operador', 'umbral']);
      return {
        operador: normalizarOperador(
          configuracion.operador,
          OPERADORES_NUMERICOS_VALIDOS
        ),
        umbral: normalizarValorDuracionTelemetria(configuracion.umbral)
      };
    case TIPOS_CONDICION_DERIVACION_TELEMETRIA.MOMENTO_UTC:
      comprobarClavesExactas(configuracion, ['operador', 'umbralUtc']);
      return {
        operador: normalizarOperador(
          configuracion.operador,
          OPERADORES_NUMERICOS_VALIDOS
        ),
        umbralUtc: normalizarValorMomentoUtcTelemetria(configuracion.umbralUtc)
      };
    case TIPOS_CONDICION_DERIVACION_TELEMETRIA.TEXTO_REGEX: {
      comprobarClavesExactas(configuracion, [
        'modo',
        'patron',
        'opciones',
        'operador',
        'umbral'
      ]);
      const regex = normalizarPatronRegexTelemetria({
        patron: configuracion.patron,
        opciones: configuracion.opciones
      });
      if (configuracion.modo === 'existe') {
        if (configuracion.operador !== null || configuracion.umbral !== null) {
          throw new Error(
            'La condición regex de existencia no admite operador ni umbral.'
          );
        }
        return {
          modo: 'existe',
          patron: regex.patron,
          opciones: [...regex.opciones],
          operador: null,
          umbral: null
        };
      }
      if (configuracion.modo !== 'conteo') {
        throw new Error('El modo de la condición regex no está soportado.');
      }
      if (!Number.isSafeInteger(configuracion.umbral) || configuracion.umbral < 0) {
        throw new Error(
          'El umbral de conteo regex debe ser un entero seguro no negativo.'
        );
      }
      return {
        modo: 'conteo',
        patron: regex.patron,
        opciones: [...regex.opciones],
        operador: normalizarOperador(
          configuracion.operador,
          OPERADORES_NUMERICOS_VALIDOS
        ),
        umbral: configuracion.umbral
      };
    }
    case TIPOS_CONDICION_DERIVACION_TELEMETRIA.BOOLEANO:
      comprobarClavesExactas(configuracion, [
        'operador',
        'valorEsperado',
        'unidad'
      ]);
      if (typeof configuracion.valorEsperado !== 'boolean') {
        throw new Error('El valor esperado de la condición booleana debe ser booleano.');
      }
      return {
        operador: normalizarOperador(
          configuracion.operador,
          OPERADORES_IGUALDAD_VALIDOS
        ),
        valorEsperado: configuracion.valorEsperado,
        unidad: normalizarTextoOpcional(
          configuracion.unidad,
          LIMITES_EVENTOS_DERIVADOS_TELEMETRIA.UNIDAD
        )
      };
    case TIPOS_CONDICION_DERIVACION_TELEMETRIA.ESTADO:
    case TIPOS_CONDICION_DERIVACION_TELEMETRIA.TEXTO:
      comprobarClavesExactas(configuracion, [
        'operador',
        'valorEsperado',
        'unidad'
      ]);
      return {
        operador: normalizarOperador(
          configuracion.operador,
          OPERADORES_IGUALDAD_VALIDOS
        ),
        valorEsperado: normalizarTextoComparacion(
          configuracion.valorEsperado,
          tipo === TIPOS_CONDICION_DERIVACION_TELEMETRIA.ESTADO
            ? 128
            : 2048
        ),
        unidad: normalizarTextoOpcional(
          configuracion.unidad,
          LIMITES_EVENTOS_DERIVADOS_TELEMETRIA.UNIDAD
        )
      };
    case TIPOS_CONDICION_DERIVACION_TELEMETRIA.CALIDAD:
      comprobarClavesExactas(configuracion, ['operador', 'calidadEsperada']);
      return {
        operador: normalizarOperador(
          configuracion.operador,
          OPERADORES_IGUALDAD_VALIDOS
        ),
        calidadEsperada: normalizarEnum(
          configuracion.calidadEsperada,
          CALIDADES_TELEMETRIA_VALIDAS,
          'La calidad esperada de la condición no es válida.'
        )
      };
    default:
      throw new Error('El tipo de condición de telemetría no está soportado.');
  }
}

function comprobarClavesExactas(configuracion, clavesEsperadas) {
  const actuales = Object.keys(configuracion).sort();
  const esperadas = [...clavesEsperadas].sort();
  if (
    actuales.length !== esperadas.length ||
    actuales.some((clave, indice) => clave !== esperadas[indice])
  ) {
    throw new Error(
      `La configuración de la condición debe contener exactamente: ${esperadas.join(', ')}.`
    );
  }
}

function normalizarOperador(valor, operadoresValidos) {
  return normalizarEnum(
    valor,
    operadoresValidos,
    'El operador de la condición de telemetría no es válido.'
  );
}

function normalizarNumeroFinito(valor, mensaje) {
  if (typeof valor !== 'number' || !Number.isFinite(valor)) {
    throw new Error(mensaje);
  }
  return Object.is(valor, -0) ? 0 : valor;
}

function normalizarTextoComparacion(valor, limite) {
  if (typeof valor !== 'string') {
    throw new Error('El valor esperado de la condición debe ser texto estricto.');
  }
  return normalizarTextoObligatorio(
    valor,
    limite,
    'El valor esperado de la condición es obligatorio.'
  );
}

function normalizarObjetoJsonOpcional(valor) {
  if (valor == null) {
    return null;
  }
  if (!esObjetoPlano(valor)) {
    throw new Error('El valor debe ser un objeto JSON.');
  }
  comprobarJsonSerializable(valor, 'El objeto no contiene JSON válido.');
  return clonarJson(valor);
}

function comprobarJsonSerializable(valor, mensaje) {
  try {
    validarNodoJson(valor, new WeakSet());
  } catch {
    throw new Error(mensaje);
  }
  const serializado = JSON.stringify(valor);
  if (serializado.length > LIMITES_EVENTOS_DERIVADOS_TELEMETRIA.JSON_SERIALIZADO) {
    throw new Error(mensaje);
  }
}

function validarNodoJson(valor, visitados) {
  if (valor === null || typeof valor === 'string' || typeof valor === 'boolean') {
    return;
  }
  if (typeof valor === 'number') {
    if (!Number.isFinite(valor)) {
      throw new Error('Número JSON no finito.');
    }
    return;
  }
  if (!Array.isArray(valor) && !esObjetoPlano(valor)) {
    throw new Error('Tipo no representable como JSON.');
  }
  if (visitados.has(valor)) {
    throw new Error('Referencia circular no representable como JSON.');
  }
  visitados.add(valor);
  const hijos = Array.isArray(valor) ? valor : Object.values(valor);
  hijos.forEach((hijo) => validarNodoJson(hijo, visitados));
  visitados.delete(valor);
}

function serializarJsonCanonico(valor) {
  return JSON.stringify(ordenarJson(valor));
}

function ordenarJson(valor) {
  if (Array.isArray(valor)) {
    return valor.map(ordenarJson);
  }
  if (esObjetoPlano(valor)) {
    return Object.fromEntries(
      Object.keys(valor)
        .sort()
        .map((clave) => [clave, ordenarJson(valor[clave])])
    );
  }
  return valor;
}

function congelarJson(valor) {
  if (Array.isArray(valor)) {
    valor.forEach(congelarJson);
    return Object.freeze(valor);
  }
  if (esObjetoPlano(valor)) {
    Object.values(valor).forEach(congelarJson);
    return Object.freeze(valor);
  }
  return valor;
}

function clonarJson(valor) {
  return valor == null ? valor : JSON.parse(JSON.stringify(valor));
}

function esObjetoPlano(valor) {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) {
    return false;
  }
  const prototipo = Object.getPrototypeOf(valor);
  return prototipo === Object.prototype || prototipo === null;
}

function normalizarEnteroPositivo(valor, mensaje) {
  const convertido = Number(valor);
  if (!Number.isInteger(convertido) || convertido <= 0) {
    throw new Error(mensaje);
  }
  return convertido;
}

function normalizarEnteroPositivoOpcional(valor, mensaje) {
  return valor == null ? null : normalizarEnteroPositivo(valor, mensaje);
}

function normalizarEnum(valor, permitidos, mensaje) {
  const normalizado = String(valor ?? '').trim();
  if (!permitidos.has(normalizado)) {
    throw new Error(mensaje);
  }
  return normalizado;
}

function normalizarCodigo(valor, limite) {
  const codigo = normalizarTextoObligatorio(
    valor,
    limite,
    'El código de motivo del resultado es obligatorio.'
  );
  if (!/^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(codigo)) {
    throw new Error('El código de motivo del resultado no es válido.');
  }
  return codigo;
}

function normalizarTextoObligatorio(valor, limite, mensaje) {
  const normalizado = String(valor ?? '').trim();
  if (!normalizado) {
    throw new Error(mensaje);
  }
  if (normalizado.length > limite) {
    throw new Error(`El texto supera el límite de ${limite} caracteres.`);
  }
  return normalizado;
}

function normalizarTextoOpcional(valor, limite) {
  if (valor == null || String(valor).trim() === '') {
    return null;
  }
  return normalizarTextoObligatorio(valor, limite, 'El texto no es válido.');
}

function normalizarFechaUtcObligatoria(valor, mensaje) {
  if (valor == null || String(valor).trim() === '') {
    throw new Error(mensaje);
  }
  const fecha = new Date(valor);
  if (Number.isNaN(fecha.getTime())) {
    throw new Error(mensaje);
  }
  return fecha.toISOString();
}

function normalizarFechaUtcOpcional(valor) {
  return valor == null || String(valor).trim() === ''
    ? null
    : normalizarFechaUtcObligatoria(valor, 'La fecha final de vigencia no es válida.');
}
