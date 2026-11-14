import {
  LIMITES_TELEMETRIA_AGENTE,
  TIPOS_DATO_TELEMETRIA_AGENTE
} from '../../agentes/src/TelemetriaAgente.js';
import {
  asegurarTipoDatoDirectamenteMonitorizable
} from './MonitorTelemetriaAgente.js';

export const VERSION_CONFIGURACION_MONITOR_TELEMETRIA = 1;
export const RETARDO_FALLO_MAXIMO_SEGUNDOS_MONITOR_TELEMETRIA = 86400;

export const TIPOS_CONDICION_MONITOR_TELEMETRIA = Object.freeze({
  RANGO_NUMERICO: 'rango_numerico',
  VALOR_ESPERADO: 'valor_esperado'
});

export const OPERADORES_VALOR_ESPERADO_TELEMETRIA = Object.freeze({
  IGUAL: 'igual',
  DIFERENTE: 'diferente'
});

const TIPOS_VALOR_ESPERADO = new Set([
  TIPOS_DATO_TELEMETRIA_AGENTE.BOOLEANO,
  TIPOS_DATO_TELEMETRIA_AGENTE.ESTADO,
  TIPOS_DATO_TELEMETRIA_AGENTE.TEXTO
]);
const OPERADORES_VALOR_ESPERADO = new Set(
  Object.values(OPERADORES_VALOR_ESPERADO_TELEMETRIA)
);

export class CondicionDirectaTelemetria {
  constructor({ tipo, tipoDato, version = 1 } = {}) {
    if (new.target === CondicionDirectaTelemetria) {
      throw new Error('La condición directa de telemetría debe ser tipada.');
    }
    this.tipo = normalizarEnum(
      tipo,
      new Set(Object.values(TIPOS_CONDICION_MONITOR_TELEMETRIA)),
      'El tipo de condición del monitor de telemetría no es válido.'
    );
    this.tipoDato = asegurarTipoDatoDirectamenteMonitorizable(tipoDato);
    this.version = normalizarVersion(version);
  }

  validarContraSenal(senal) {
    const catalogada = normalizarSenalCatalogada(senal);
    if (catalogada.tipoDato !== this.tipoDato) {
      throw new Error(
        'El tipo de la condición debe coincidir exactamente con la señal catalogada.'
      );
    }
    return catalogada;
  }
}

export class CondicionRangoNumericoTelemetria extends CondicionDirectaTelemetria {
  constructor({ version = 1, minimo = null, maximo = null } = {}) {
    super({
      tipo: TIPOS_CONDICION_MONITOR_TELEMETRIA.RANGO_NUMERICO,
      tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.NUMERO,
      version
    });
    this.minimo = normalizarLimiteOpcional(
      minimo,
      'El límite mínimo debe ser un número finito.'
    );
    this.maximo = normalizarLimiteOpcional(
      maximo,
      'El límite máximo debe ser un número finito.'
    );

    if (this.minimo == null && this.maximo == null) {
      throw new Error(
        'Una condición numérica debe declarar al menos un límite mínimo o máximo.'
      );
    }
    if (
      this.minimo != null &&
      this.maximo != null &&
      this.minimo > this.maximo
    ) {
      throw new Error('El límite mínimo no puede ser mayor que el máximo.');
    }

    Object.freeze(this);
  }

  serializar() {
    return {
      tipo: this.tipo,
      tipoDato: this.tipoDato,
      version: this.version,
      minimo: this.minimo,
      maximo: this.maximo
    };
  }
}

export class CondicionValorEsperadoTelemetria extends CondicionDirectaTelemetria {
  constructor({
    version = 1,
    tipoDato,
    operador = OPERADORES_VALOR_ESPERADO_TELEMETRIA.IGUAL,
    valorEsperado
  } = {}) {
    if (!TIPOS_VALOR_ESPERADO.has(tipoDato)) {
      throw new Error(
        'La condición de valor esperado solo admite booleano, estado o texto.'
      );
    }
    super({
      tipo: TIPOS_CONDICION_MONITOR_TELEMETRIA.VALOR_ESPERADO,
      tipoDato,
      version
    });
    this.operador = normalizarEnum(
      operador,
      OPERADORES_VALOR_ESPERADO,
      'El operador debe ser igual o diferente.'
    );
    if (
      this.tipoDato === TIPOS_DATO_TELEMETRIA_AGENTE.BOOLEANO &&
      this.operador !== OPERADORES_VALOR_ESPERADO_TELEMETRIA.IGUAL
    ) {
      throw new Error(
        'Una condición booleana declara únicamente el valor normal esperado.'
      );
    }
    this.valorEsperado = normalizarValorEsperado(
      this.tipoDato,
      valorEsperado
    );

    Object.freeze(this);
  }

  serializar() {
    return {
      tipo: this.tipo,
      tipoDato: this.tipoDato,
      version: this.version,
      operador: this.operador,
      valorEsperado: this.valorEsperado
    };
  }
}

export class ConfiguracionMonitorTelemetria {
  constructor({
    version = 1,
    condicion,
    retardoFalloSegundos = 0
  } = {}, { senal = null } = {}) {
    this.version = normalizarVersion(version);
    this.condicion = crearCondicionDirectaTelemetria(condicion);
    this.retardoFalloSegundos = normalizarRetardoFalloSegundos(
      retardoFalloSegundos
    );
    if (senal) {
      this.condicion.validarContraSenal(senal);
    }

    Object.freeze(this);
  }

  validarContraSenal(senal) {
    return this.condicion.validarContraSenal(senal);
  }

  serializar() {
    return {
      version: this.version,
      retardoFalloSegundos: this.retardoFalloSegundos,
      condicion: this.condicion.serializar()
    };
  }
}

export function crearConfiguracionMonitorTelemetria(datos, opciones = {}) {
  if (datos instanceof ConfiguracionMonitorTelemetria) {
    if (opciones.senal) {
      datos.validarContraSenal(opciones.senal);
    }
    return datos;
  }
  asegurarObjetoConCampos(
    datos,
    ['version', 'condicion', 'retardoFalloSegundos'],
    'La configuración del monitor de telemetría es obligatoria.'
  );
  return new ConfiguracionMonitorTelemetria(datos, opciones);
}

export function crearConfiguracionTemporalMonitorTelemetria(datos = {}) {
  asegurarObjetoConCampos(
    datos,
    ['version', 'condicion', 'retardoFalloSegundos'],
    'La configuración temporal del monitor de telemetría no es válida.'
  );
  return Object.freeze({
    version: normalizarVersion(datos.version ?? 1),
    retardoFalloSegundos: normalizarRetardoFalloSegundos(
      datos.retardoFalloSegundos
    )
  });
}

export function crearCondicionDirectaTelemetria(datos) {
  if (datos instanceof CondicionDirectaTelemetria) {
    return datos;
  }
  if (!datos || typeof datos !== 'object' || Array.isArray(datos)) {
    throw new Error('La condición directa de telemetría es obligatoria.');
  }
  const tipo = String(datos.tipo ?? '').trim().toLowerCase();
  if (tipo === TIPOS_CONDICION_MONITOR_TELEMETRIA.RANGO_NUMERICO) {
    asegurarObjetoConCampos(
      datos,
      ['tipo', 'tipoDato', 'version', 'minimo', 'maximo'],
      'La condición numérica no es válida.'
    );
    if (
      datos.tipoDato != null &&
      datos.tipoDato !== TIPOS_DATO_TELEMETRIA_AGENTE.NUMERO
    ) {
      throw new Error('Una condición de rango debe declarar tipo de dato número.');
    }
    return new CondicionRangoNumericoTelemetria(datos);
  }
  if (tipo === TIPOS_CONDICION_MONITOR_TELEMETRIA.VALOR_ESPERADO) {
    asegurarObjetoConCampos(
      datos,
      ['tipo', 'tipoDato', 'version', 'operador', 'valorEsperado'],
      'La condición de valor esperado no es válida.'
    );
    return new CondicionValorEsperadoTelemetria(datos);
  }
  throw new Error('El tipo de condición directa de telemetría no es válido.');
}

export function normalizarSenalCatalogadaMonitorTelemetria(senal) {
  return normalizarSenalCatalogada(senal);
}

function normalizarSenalCatalogada(senal) {
  if (!senal || typeof senal !== 'object' || Array.isArray(senal)) {
    throw new Error('La señal catalogada del monitor de telemetría es obligatoria.');
  }
  const id = normalizarId(senal.id, 'La identidad de la señal no es válida.');
  const agenteId = normalizarId(
    senal.agenteId,
    'El agente de la señal catalogada no es válido.'
  );
  const tipoDato = asegurarTipoDatoDirectamenteMonitorizable(senal.tipoDato);
  return Object.freeze({
    id,
    agenteId,
    tipoDato,
    unidad: normalizarUnidad(senal.unidad)
  });
}

function normalizarValorEsperado(tipoDato, valor) {
  if (tipoDato === TIPOS_DATO_TELEMETRIA_AGENTE.BOOLEANO) {
    if (typeof valor !== 'boolean') {
      throw new Error('El valor esperado de la condición debe ser booleano.');
    }
    return valor;
  }
  const limite = tipoDato === TIPOS_DATO_TELEMETRIA_AGENTE.ESTADO
    ? LIMITES_TELEMETRIA_AGENTE.ESTADO
    : LIMITES_TELEMETRIA_AGENTE.VALOR_TEXTO;
  const texto = String(valor ?? '').trim();
  if (!texto || texto.length > limite) {
    throw new Error('El valor esperado de la condición no es válido.');
  }
  return texto;
}

function normalizarLimiteOpcional(valor, mensaje) {
  if (valor == null || valor === '') {
    return null;
  }
  if (typeof valor !== 'number' || !Number.isFinite(valor)) {
    throw new Error(mensaje);
  }
  return valor;
}

function normalizarVersion(valor) {
  const version = Number(valor);
  if (!Number.isInteger(version) || version !== 1) {
    throw new Error('La versión de configuración de telemetría no está soportada.');
  }
  return version;
}

export function normalizarRetardoFalloSegundos(valor) {
  if (valor === undefined || valor === null || String(valor).trim() === '') {
    return 0;
  }
  const retardo = Number(valor);
  if (
    !Number.isInteger(retardo) ||
    retardo < 0 ||
    retardo > RETARDO_FALLO_MAXIMO_SEGUNDOS_MONITOR_TELEMETRIA
  ) {
    throw new Error(
      `El retardo de fallo del monitor de telemetría debe estar entre 0 y ${RETARDO_FALLO_MAXIMO_SEGUNDOS_MONITOR_TELEMETRIA} segundos.`
    );
  }
  return retardo;
}

function normalizarEnum(valor, permitidos, mensaje) {
  const normalizado = String(valor ?? '').trim().toLowerCase();
  if (!permitidos.has(normalizado)) {
    throw new Error(mensaje);
  }
  return normalizado;
}

function normalizarId(valor, mensaje) {
  if (typeof valor === 'boolean' || String(valor ?? '').trim() === '') {
    throw new Error(mensaje);
  }
  const id = Number(valor);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error(mensaje);
  }
  return id;
}

function normalizarUnidad(valor) {
  const unidad = String(valor ?? '').trim();
  if (unidad.length > LIMITES_TELEMETRIA_AGENTE.UNIDAD) {
    throw new Error('La unidad catalogada supera el límite permitido.');
  }
  return unidad || null;
}

function asegurarObjetoConCampos(valor, permitidos, mensaje) {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) {
    throw new Error(mensaje);
  }
  const extras = Object.keys(valor).filter((clave) => !permitidos.includes(clave));
  if (extras.length > 0) {
    throw new Error(`La configuración contiene campos no admitidos: ${extras.join(', ')}.`);
  }
}
