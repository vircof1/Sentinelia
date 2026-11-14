import {
  ESTADOS_INICIALES_ENTRADA_FEDERADA_MONITOR_LOGICO,
  FUENTES_SENAL_MONITOR_LOGICO,
  POLITICAS_PERDIDA_ENTRADA_FEDERADA_MONITOR_LOGICO,
  RETARDO_SENAL_MAXIMO_SEGUNDOS_MONITOR_LOGICO
} from './ConfiguracionMonitorLogico.js';
import {
  crearIdentidadFederada,
  TIPOS_IDENTIDAD_FEDERADA
} from '../../federacion/src/IdentidadFederada.js';

const FUENTE_MONITOR = 'monitor';
export const FUENTE_MONITOR_FEDERADO = 'monitor_federado';
const VARIABLE_REGEX = /^[A-Z][A-Z0-9_]{0,15}$/;

export function normalizarDependenciasMonitorLogico(dependencias = []) {
  if (!Array.isArray(dependencias)) {
    throw new Error('Las dependencias del monitor lógico deben ser una lista.');
  }

  const variablesUsadas = new Set();
  const monitoresUsados = new Set();

  return dependencias.map((dependencia, indice) => {
    const normalizada = normalizarDependenciaMonitorLogico(dependencia, indice);

    if (variablesUsadas.has(normalizada.variable)) {
      throw new Error(
        `La variable ${normalizada.variable} está duplicada en las dependencias.`
      );
    }

    variablesUsadas.add(normalizada.variable);

    if (normalizada.fuente === FUENTE_MONITOR) {
      if (monitoresUsados.has(normalizada.monitorId)) {
        throw new Error(
          `El monitor #${normalizada.monitorId} está duplicado en las dependencias.`
        );
      }

      monitoresUsados.add(normalizada.monitorId);
    }

    return normalizada;
  });
}

export function extraerVariablesDependenciasMonitorLogico(dependencias = []) {
  return normalizarDependenciasMonitorLogico(dependencias)
    .map((dependencia) => dependencia.variable);
}

export function extraerIdsMonitoresDependenciasMonitorLogico(dependencias = []) {
  return normalizarDependenciasMonitorLogico(dependencias)
    .filter((dependencia) => dependencia.fuente === FUENTE_MONITOR)
    .map((dependencia) => dependencia.monitorId);
}

export function extraerIdsProyeccionesFederadasMonitorLogico(dependencias = []) {
  return normalizarDependenciasMonitorLogico(dependencias)
    .filter((dependencia) => dependencia.fuente === FUENTE_MONITOR_FEDERADO)
    .map((dependencia) => dependencia.proyeccionId);
}

export function resumirDependenciasMonitorLogico(dependencias = []) {
  const normalizadas = normalizarDependenciasMonitorLogico(dependencias);

  return {
    total: normalizadas.length,
    totalMonitores: normalizadas.filter(
      (dependencia) => dependencia.fuente === FUENTE_MONITOR
    ).length,
    totalReservadas: normalizadas.filter(
      (dependencia) => ![FUENTE_MONITOR, FUENTE_MONITOR_FEDERADO]
        .includes(dependencia.fuente)
    ).length,
    totalFederadas: normalizadas.filter(
      (dependencia) => dependencia.fuente === FUENTE_MONITOR_FEDERADO
    ).length,
    variables: normalizadas.map((dependencia) => dependencia.variable),
    monitores: normalizadas
      .filter((dependencia) => dependencia.fuente === FUENTE_MONITOR)
      .map((dependencia) => dependencia.monitorId),
    proyeccionesFederadas: normalizadas
      .filter((dependencia) => dependencia.fuente === FUENTE_MONITOR_FEDERADO)
      .map((dependencia) => dependencia.proyeccionId)
  };
}

function normalizarDependenciaMonitorLogico(dependencia, indice) {
  if (!dependencia || typeof dependencia !== 'object') {
    throw new Error(
      `La dependencia #${indice + 1} del monitor lógico debe ser un objeto.`
    );
  }

  const variable = normalizarVariableDependencia(
    dependencia.variable || dependencia.nombre || dependencia.clave
  );
  const fuente = normalizarFuenteDependencia(dependencia.fuente);
  const etiqueta = String(dependencia.etiqueta || dependencia.nombreHumano || '')
    .trim();

  if (fuente === FUENTE_MONITOR) {
    return {
      variable,
      fuente,
      monitorId: normalizarMonitorIdDependencia(dependencia.monitorId),
      etiqueta: etiqueta || null
    };
  }

  if (fuente === FUENTE_MONITOR_FEDERADO) {
    if (dependencia.referencia != null || dependencia.monitorId != null) {
      throw new Error(
        'Una entrada federada debe declarar proyeccionId explícita, sin monitorId ni referencia genérica.'
      );
    }
    return {
      variable,
      fuente,
      proyeccionId: normalizarProyeccionIdDependencia(dependencia.proyeccionId),
      estadoInicial: normalizarEstadoInicialFederado(dependencia.estadoInicial),
      inversion: normalizarBooleanoFederado(dependencia.inversion, 'inversion'),
      retardoCambioSegundos: normalizarRetardoCambioFederado(
        dependencia.retardoCambioSegundos
      ),
      politicaPerdidaEnFallo: normalizarPoliticaPerdidaFederada(
        dependencia.politicaPerdidaEnFallo,
        'politicaPerdidaEnFallo'
      ),
      politicaPerdidaEnCorrecto: normalizarPoliticaPerdidaFederada(
        dependencia.politicaPerdidaEnCorrecto,
        'politicaPerdidaEnCorrecto'
      ),
      etiqueta: etiqueta || null
    };
  }

  return {
    variable,
    fuente,
    referencia: dependencia.referencia == null
      ? null
      : String(dependencia.referencia).trim(),
    etiqueta: etiqueta || null
  };
}

function normalizarVariableDependencia(valor) {
  const normalizada = String(valor || '').trim().toUpperCase();

  if (!VARIABLE_REGEX.test(normalizada)) {
    throw new Error(
      'Cada dependencia lógica requiere una variable estable tipo A, B, ISP_1.'
    );
  }

  return normalizada;
}

function normalizarFuenteDependencia(valor) {
  const normalizada = String(valor || FUENTE_MONITOR).trim().toLowerCase();

  if (!FUENTES_SENAL_MONITOR_LOGICO.includes(normalizada)) {
    throw new Error(
      `La fuente de dependencia lógica debe ser una de: ${FUENTES_SENAL_MONITOR_LOGICO.join(', ')}.`
    );
  }

  return normalizada;
}

function normalizarMonitorIdDependencia(valor) {
  const monitorId = Number.parseInt(String(valor ?? ''), 10);

  if (!Number.isInteger(monitorId) || monitorId <= 0) {
    throw new Error('Cada dependencia de tipo monitor requiere un monitorId positivo.');
  }

  return monitorId;
}

function normalizarProyeccionIdDependencia(valor) {
  try {
    return String(crearIdentidadFederada({
      tipo: TIPOS_IDENTIDAD_FEDERADA.PROYECCION,
      valor: String(valor || '')
    }));
  } catch {
    throw new Error(
      'Cada entrada federada requiere una proyeccionId federada explícita y válida.'
    );
  }
}

function normalizarEstadoInicialFederado(valor) {
  const normalizado = String(valor ?? 'correcto').trim().toLowerCase();
  if (!ESTADOS_INICIALES_ENTRADA_FEDERADA_MONITOR_LOGICO.includes(normalizado)) {
    throw new Error(
      `El estado inicial federado debe ser uno de: ${ESTADOS_INICIALES_ENTRADA_FEDERADA_MONITOR_LOGICO.join(', ')}.`
    );
  }
  return normalizado;
}

function normalizarPoliticaPerdidaFederada(valor, campo) {
  const normalizado = String(valor ?? 'conservar').trim().toLowerCase();
  if (!POLITICAS_PERDIDA_ENTRADA_FEDERADA_MONITOR_LOGICO.includes(normalizado)) {
    throw new Error(
      `${campo} debe ser una de: ${POLITICAS_PERDIDA_ENTRADA_FEDERADA_MONITOR_LOGICO.join(', ')}.`
    );
  }
  return normalizado;
}

function normalizarBooleanoFederado(valor, campo) {
  if (valor === undefined || valor === null || valor === '') return false;
  if (valor === true || valor === 1 || valor === '1' || valor === 'true') return true;
  if (valor === false || valor === 0 || valor === '0' || valor === 'false') return false;
  throw new Error(`${campo} debe ser un booleano explícito.`);
}

function normalizarRetardoCambioFederado(valor) {
  if (valor === undefined || valor === null || String(valor).trim() === '') return 0;
  const normalizado = Number(valor);
  if (!Number.isSafeInteger(normalizado) || normalizado < 0 ||
      normalizado > RETARDO_SENAL_MAXIMO_SEGUNDOS_MONITOR_LOGICO) {
    throw new Error(
      `retardoCambioSegundos debe estar entre 0 y ${RETARDO_SENAL_MAXIMO_SEGUNDOS_MONITOR_LOGICO}.`
    );
  }
  return normalizado;
}
