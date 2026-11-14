import re2Wasm from 're2-wasm';
import { createHash } from 'node:crypto';

const { RE2 } = re2Wasm;

export const CONTRATO_MOTOR_REGEX_TELEMETRIA = Object.freeze({
  motor: 're2-wasm',
  version: '1.0.2',
  licencia: 'Apache-2.0',
  unicode: true
});

export const LIMITES_REGEX_TELEMETRIA = Object.freeze({
  PATRON_CARACTERES_UNICODE: 256,
  TEXTO_CARACTERES: 2048,
  COINCIDENCIAS: 2048,
  PASOS_CONTEO: 2049
});

export const OPCIONES_REGEX_TELEMETRIA = Object.freeze(['i', 'm', 's']);

const INDICE_OPCION = new Map(
  OPCIONES_REGEX_TELEMETRIA.map((opcion, indice) => [opcion, indice])
);

export class ErrorMotorRegexTelemetria extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.name = 'ErrorMotorRegexTelemetria';
    this.code = codigo;
    this.codigo = codigo;
  }
}

export function normalizarPatronRegexTelemetria({ patron, opciones } = {}) {
  if (typeof patron !== 'string') {
    fallar(
      'patron_regex_tipo_invalido',
      'El patrón regex debe ser una cadena de texto.'
    );
  }
  const longitudPatron = Array.from(patron).length;
  if (longitudPatron > LIMITES_REGEX_TELEMETRIA.PATRON_CARACTERES_UNICODE) {
    fallar(
      'patron_regex_demasiado_largo',
      'El patrón regex supera los 256 caracteres Unicode permitidos.'
    );
  }
  const opcionesNormalizadas = normalizarOpciones(opciones);
  compilarRe2(patron, opcionesNormalizadas);
  return Object.freeze({
    patron,
    opciones: Object.freeze(opcionesNormalizadas),
    longitudPatron
  });
}

export function evaluarExistenciaRegexTelemetria({
  patron,
  opciones,
  texto
} = {}) {
  const normalizada = normalizarPatronRegexTelemetria({ patron, opciones });
  const longitudTexto = normalizarTextoEvaluable(texto);
  const coincide = compilarRe2(
    normalizada.patron,
    normalizada.opciones
  ).test(texto);
  return Object.freeze({
    coincide,
    valorEvidencia: `[texto redactado; ${longitudTexto} caracteres]`,
    evidencia: crearEvidencia({
      normalizada,
      longitudTexto,
      modo: 'existe',
      coincidenciaEncontrada: coincide,
      conteo: null,
      operador: null,
      umbral: null,
      pasosEjecutados: 1
    })
  });
}

export function contarCoincidenciasRegexTelemetria({
  patron,
  opciones,
  texto,
  operador,
  umbral
} = {}) {
  const normalizada = normalizarPatronRegexTelemetria({ patron, opciones });
  const longitudTexto = normalizarTextoEvaluable(texto);
  const expresion = compilarRe2(
    normalizada.patron,
    normalizada.opciones,
    { global: true }
  );
  let conteo = 0;
  let pasosEjecutados = 0;

  while (pasosEjecutados < LIMITES_REGEX_TELEMETRIA.PASOS_CONTEO) {
    pasosEjecutados += 1;
    const coincidencia = expresion.exec(texto);
    if (coincidencia === null) {
      return Object.freeze({
        conteo,
        valorEvidencia: `[texto redactado; ${longitudTexto} caracteres]`,
        evidencia: crearEvidencia({
          normalizada,
          longitudTexto,
          modo: 'conteo',
          coincidenciaEncontrada: conteo > 0,
          conteo,
          operador,
          umbral,
          pasosEjecutados
        })
      });
    }

    conteo += 1;
    if (conteo > LIMITES_REGEX_TELEMETRIA.COINCIDENCIAS) {
      fallar(
        'presupuesto_regex_agotado',
        'La evaluación regex agotó su presupuesto técnico de coincidencias.'
      );
    }
    avanzarTrasCoincidencia(expresion, coincidencia);
  }

  fallar(
    'presupuesto_regex_agotado',
    'La evaluación regex agotó su presupuesto técnico de trabajo.'
  );
}

function normalizarOpciones(opciones) {
  if (!Array.isArray(opciones)) {
    fallar(
      'opciones_regex_invalidas',
      'Las opciones regex deben ser una lista canónica.'
    );
  }
  const normalizadas = [...opciones];
  if (
    normalizadas.some((opcion) => !INDICE_OPCION.has(opcion)) ||
    new Set(normalizadas).size !== normalizadas.length ||
    normalizadas.some((opcion, indice) =>
      indice > 0 &&
      INDICE_OPCION.get(normalizadas[indice - 1]) >= INDICE_OPCION.get(opcion)
    )
  ) {
    fallar(
      'opciones_regex_invalidas',
      'Las opciones regex solo admiten i, m y s, sin repetir y en ese orden.'
    );
  }
  return normalizadas;
}

function normalizarTextoEvaluable(texto) {
  const longitudTexto = typeof texto === 'string'
    ? Array.from(texto).length
    : null;
  if (
    longitudTexto === null ||
    longitudTexto > LIMITES_REGEX_TELEMETRIA.TEXTO_CARACTERES
  ) {
    fallar(
      'texto_regex_no_evaluable',
      'El texto no respeta el límite contractual de evaluación regex.'
    );
  }
  return longitudTexto;
}

function crearEvidencia({
  normalizada,
  longitudTexto,
  modo,
  coincidenciaEncontrada,
  conteo,
  operador,
  umbral,
  pasosEjecutados
}) {
  return Object.freeze({
    motor: CONTRATO_MOTOR_REGEX_TELEMETRIA.motor,
    versionMotor: CONTRATO_MOTOR_REGEX_TELEMETRIA.version,
    modo,
    opciones: Object.freeze([...normalizada.opciones]),
    patronSha256: createHash('sha256')
      .update(normalizada.patron, 'utf8')
      .digest('hex'),
    longitudPatron: normalizada.longitudPatron,
    longitudTexto,
    coincidenciaEncontrada,
    conteo,
    operador,
    umbral,
    pasosEjecutados,
    limiteCoincidencias: LIMITES_REGEX_TELEMETRIA.COINCIDENCIAS
  });
}

function avanzarTrasCoincidencia(expresion, coincidencia) {
  const longitudCoincidencia = Array.from(coincidencia[0]).length;
  expresion.lastIndex = coincidencia.index + Math.max(1, longitudCoincidencia);
}

function compilarRe2(patron, opciones, { global = false } = {}) {
  try {
    return new RE2(patron, `${global ? 'g' : ''}${opciones.join('')}u`);
  } catch {
    fallar(
      'patron_regex_invalido',
      'El patrón no pertenece al subconjunto regex seguro admitido.'
    );
  }
}

function fallar(codigo, mensaje) {
  throw new ErrorMotorRegexTelemetria(codigo, mensaje);
}
