import {
  TIPOS_DATO_TELEMETRIA_AGENTE
} from '../../agentes/src/TelemetriaAgente.js';
import {
  crearIdentidadFederada,
  TIPOS_IDENTIDAD_FEDERADA
} from '../../federacion/src/IdentidadFederada.js';

export const TIPO_MONITOR_TELEMETRIA_AGENTE = 'telemetria';

export const TIPOS_FUENTE_MONITOR_TELEMETRIA = Object.freeze({
  SENAL_DIRECTA: 'senal_directa',
  SENAL_FEDERADA: 'senal_federada',
  REGLA_DERIVACION: 'regla_derivacion'
});

export const ESTADOS_MONITOR_TELEMETRIA = Object.freeze({
  NORMAL: 'normal',
  FALLO: 'fallo',
  PENDIENTE: 'pendiente',
  DESCONOCIDO: 'desconocido'
});

const TIPOS_FUENTE_VALIDOS = new Set(
  Object.values(TIPOS_FUENTE_MONITOR_TELEMETRIA)
);
const ESTADOS_VALIDOS = new Set(Object.values(ESTADOS_MONITOR_TELEMETRIA));
const ESTADOS_CANDIDATOS_VALIDOS = new Set([
  ESTADOS_MONITOR_TELEMETRIA.NORMAL,
  ESTADOS_MONITOR_TELEMETRIA.FALLO
]);
const TIPOS_DATO_DIRECTAMENTE_MONITORIZABLES = new Set([
  TIPOS_DATO_TELEMETRIA_AGENTE.NUMERO,
  TIPOS_DATO_TELEMETRIA_AGENTE.BOOLEANO,
  TIPOS_DATO_TELEMETRIA_AGENTE.ESTADO,
  TIPOS_DATO_TELEMETRIA_AGENTE.TEXTO
]);

export class FuenteMonitorTelemetria {
  constructor({
    tipo,
    agenteId = null,
    senalId = null,
    reglaId = null,
    proyeccionId = null
  } = {}) {
    this.tipo = normalizarEnum(
      tipo,
      TIPOS_FUENTE_VALIDOS,
      'El tipo de fuente del monitor de telemetría no es válido.'
    );

    if (this.tipo === TIPOS_FUENTE_MONITOR_TELEMETRIA.SENAL_DIRECTA) {
      this.agenteId = normalizarId(
        agenteId,
        'El agente de la fuente directa es obligatorio.'
      );
      this.senalId = normalizarId(
        senalId,
        'La señal de la fuente directa es obligatoria.'
      );
      if (reglaId != null) {
        throw new Error(
          'Una fuente directa no puede referenciar una regla de derivación.'
        );
      }
      this.reglaId = null;
      this.proyeccionId = null;
    } else if (this.tipo === TIPOS_FUENTE_MONITOR_TELEMETRIA.REGLA_DERIVACION) {
      this.reglaId = normalizarId(
        reglaId,
        'La regla de la fuente derivada es obligatoria.'
      );
      if (agenteId != null || senalId != null) {
        throw new Error(
          'Una fuente de regla no puede declarar además agente o señal directos.'
        );
      }
      this.agenteId = null;
      this.senalId = null;
      this.proyeccionId = null;
    } else {
      this.proyeccionId = normalizarProyeccionId(proyeccionId);
      if (agenteId != null || senalId != null || reglaId != null) {
        throw new Error(
          'Una señal federada solo puede referenciar su proyección receptora explícita.'
        );
      }
      this.agenteId = null;
      this.senalId = null;
      this.reglaId = null;
    }

    Object.freeze(this);
  }

  esSenalDirecta() {
    return this.tipo === TIPOS_FUENTE_MONITOR_TELEMETRIA.SENAL_DIRECTA;
  }

  esReglaDerivacion() {
    return this.tipo === TIPOS_FUENTE_MONITOR_TELEMETRIA.REGLA_DERIVACION;
  }

  esSenalFederada() {
    return this.tipo === TIPOS_FUENTE_MONITOR_TELEMETRIA.SENAL_FEDERADA;
  }

  serializar() {
    const serializada = {
      tipo: this.tipo,
      agenteId: this.agenteId,
      senalId: this.senalId,
      reglaId: this.reglaId
    };
    if (this.esSenalFederada()) {
      serializada.proyeccionId = this.proyeccionId;
    }
    return serializada;
  }
}

export class MonitorTelemetriaAgente {
  constructor({ monitorId, scope, fuente } = {}) {
    this.monitorId = normalizarId(
      monitorId,
      'La identidad del monitor de telemetría es obligatoria.'
    );
    this.tipo = TIPO_MONITOR_TELEMETRIA_AGENTE;
    this.scope = congelarJson(normalizarScope(scope));
    this.fuente = crearFuenteMonitorTelemetria(fuente);

    Object.freeze(this);
  }

  usaSenalDirecta() {
    return this.fuente.esSenalDirecta();
  }

  usaReglaDerivacion() {
    return this.fuente.esReglaDerivacion();
  }

  usaSenalFederada() {
    return this.fuente.esSenalFederada();
  }

  serializar() {
    return {
      monitorId: this.monitorId,
      tipo: this.tipo,
      scope: clonarJson(this.scope),
      fuente: this.fuente.serializar()
    };
  }
}

export class ResultadoMonitorTelemetria {
  constructor({
    estado,
    codigoMotivo,
    estadoCandidato = null,
    evidencia = null
  } = {}) {
    this.estado = normalizarEnum(
      estado,
      ESTADOS_VALIDOS,
      'El estado del monitor de telemetría no es válido.'
    );
    this.codigoMotivo = normalizarTexto(
      codigoMotivo,
      80,
      'El código de motivo del monitor de telemetría es obligatorio.'
    );
    this.estadoCandidato = normalizarEstadoCandidato(
      this.estado,
      estadoCandidato
    );
    this.evidencia = congelarJson(normalizarEvidencia(evidencia));

    Object.freeze(this);
  }

  esEstable() {
    return ESTADOS_CANDIDATOS_VALIDOS.has(this.estado);
  }

  esNormal() {
    return this.estado === ESTADOS_MONITOR_TELEMETRIA.NORMAL;
  }

  esFallo() {
    return this.estado === ESTADOS_MONITOR_TELEMETRIA.FALLO;
  }

  esPendiente() {
    return this.estado === ESTADOS_MONITOR_TELEMETRIA.PENDIENTE;
  }

  esDesconocido() {
    return this.estado === ESTADOS_MONITOR_TELEMETRIA.DESCONOCIDO;
  }

  serializar() {
    return {
      estado: this.estado,
      codigoMotivo: this.codigoMotivo,
      estadoCandidato: this.estadoCandidato,
      evidencia: clonarJson(this.evidencia)
    };
  }
}

export function crearFuenteMonitorTelemetria(datos) {
  return datos instanceof FuenteMonitorTelemetria
    ? datos
    : new FuenteMonitorTelemetria(datos);
}

export function crearFuenteDirectaMonitorTelemetria({ agenteId, senalId } = {}) {
  return new FuenteMonitorTelemetria({
    tipo: TIPOS_FUENTE_MONITOR_TELEMETRIA.SENAL_DIRECTA,
    agenteId,
    senalId
  });
}

export function crearFuenteReglaMonitorTelemetria({ reglaId } = {}) {
  return new FuenteMonitorTelemetria({
    tipo: TIPOS_FUENTE_MONITOR_TELEMETRIA.REGLA_DERIVACION,
    reglaId
  });
}

export function crearFuenteFederadaMonitorTelemetria({ proyeccionId } = {}) {
  return new FuenteMonitorTelemetria({
    tipo: TIPOS_FUENTE_MONITOR_TELEMETRIA.SENAL_FEDERADA,
    proyeccionId
  });
}

function normalizarProyeccionId(valor) {
  try {
    return String(crearIdentidadFederada({
      tipo: TIPOS_IDENTIDAD_FEDERADA.PROYECCION,
      valor: String(valor ?? '')
    }));
  } catch {
    throw new Error('La proyección de la señal federada no es válida.');
  }
}

export function esTipoDatoDirectamenteMonitorizable(tipoDato) {
  return TIPOS_DATO_DIRECTAMENTE_MONITORIZABLES.has(
    normalizarTipoDato(tipoDato)
  );
}

export function asegurarTipoDatoDirectamenteMonitorizable(tipoDato) {
  const normalizado = normalizarTipoDato(tipoDato);
  if (normalizado === TIPOS_DATO_TELEMETRIA_AGENTE.JSON) {
    throw new Error(
      'Las señales JSON no son evaluables directamente por un monitor de telemetría.'
    );
  }
  if (!TIPOS_DATO_DIRECTAMENTE_MONITORIZABLES.has(normalizado)) {
    throw new Error('El tipo de dato de la señal no es monitorizable directamente.');
  }
  return normalizado;
}

function normalizarScope(scope) {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) {
    throw new Error('El scope del monitor de telemetría es obligatorio.');
  }
  return {
    tenantId: normalizarId(
      scope.tenantId,
      'El tenant del monitor de telemetría es obligatorio.'
    ),
    empresaId: normalizarId(
      scope.empresaId,
      'La empresa del monitor de telemetría es obligatoria.'
    ),
    sitioId: normalizarId(
      scope.sitioId,
      'El sitio del monitor de telemetría es obligatorio.'
    )
  };
}

function normalizarEstadoCandidato(estado, estadoCandidato) {
  if (estado === ESTADOS_MONITOR_TELEMETRIA.PENDIENTE) {
    return normalizarEnum(
      estadoCandidato,
      ESTADOS_CANDIDATOS_VALIDOS,
      'Un resultado pendiente debe identificar un candidato normal o de fallo.'
    );
  }
  if (estadoCandidato != null) {
    throw new Error(
      'Solo un resultado pendiente puede conservar un estado candidato.'
    );
  }
  return null;
}

function normalizarEvidencia(evidencia) {
  if (evidencia == null) {
    return null;
  }
  if (
    typeof evidencia !== 'object' ||
    Array.isArray(evidencia) ||
    Object.getPrototypeOf(evidencia) !== Object.prototype
  ) {
    throw new Error('La evidencia del monitor de telemetría debe ser un objeto.');
  }
  const clonada = clonarJson(evidencia);
  if (JSON.stringify(clonada).length > 4096) {
    throw new Error('La evidencia del monitor de telemetría es demasiado extensa.');
  }
  return clonada;
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

function normalizarEnum(valor, permitidos, mensaje) {
  const normalizado = String(valor ?? '').trim().toLowerCase();
  if (!permitidos.has(normalizado)) {
    throw new Error(mensaje);
  }
  return normalizado;
}

function normalizarTipoDato(valor) {
  return String(valor ?? '').trim().toLowerCase();
}

function normalizarTexto(valor, limite, mensaje) {
  const normalizado = String(valor ?? '').trim();
  if (!normalizado || normalizado.length > limite) {
    throw new Error(mensaje);
  }
  return normalizado;
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
