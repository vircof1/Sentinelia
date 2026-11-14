import { createHash } from 'node:crypto';

import {
  CONDICIONES_OPERATIVAS_DDNS_AGENTES,
  HITOS_DDNS_AGENTES,
  PERFILES_DDNS_AGENTES,
  TERMINALES_INTENCION_DDNS_AGENTES,
  VERSION_CONTRATO_DDNS_AGENTES,
  crearIdentidadConcesionDdnsAgentes,
  crearSolicitudDdnsAgentes,
  exigirDecimalBigintUnsignedDdnsAgentes,
  serializarCanonicoDdnsAgentes
} from './ContratoDdnsAgentes.js';

export const PERFIL_MAQUINA_DDNS_AGENTES = 'ddns_agentes@1/maquina';
export const ESTADOS_CONCESION_DDNS_AGENTES = Object.freeze({
  VIGENTE: 'vigente',
  REVOCADA: 'revocada'
});
export const DECISIONES_CONCESION_DDNS_AGENTES = Object.freeze({
  PENDIENTE: 'pendiente_decision_agente',
  OPERATIVA: 'operativa'
});
export const PRESUPUESTO_PUBLICACION_DDNS_AGENTES = 3;

const MAX_BIGINT_UNSIGNED = (1n << 64n) - 1n;
const CONDICIONES = new Set(CONDICIONES_OPERATIVAS_DDNS_AGENTES);
const HITOS = new Set(HITOS_DDNS_AGENTES);
const TERMINALES = new Set(TERMINALES_INTENCION_DDNS_AGENTES);

export function crearEstadoInicialDdnsAgentes({ concesionId }) {
  const identidad = crearIdentidadConcesionDdnsAgentes({
    perfil: PERFILES_DDNS_AGENTES.CONCESION,
    versionContrato: VERSION_CONTRATO_DDNS_AGENTES,
    concesionId
  });
  return congelar({
    perfil: PERFIL_MAQUINA_DDNS_AGENTES,
    versionContrato: VERSION_CONTRATO_DDNS_AGENTES,
    concesionId: identidad.concesionId,
    estadoConcesion: ESTADOS_CONCESION_DDNS_AGENTES.VIGENTE,
    decision: DECISIONES_CONCESION_DDNS_AGENTES.PENDIENTE,
    version: '0',
    condicion: 'pendiente_decision_agente',
    condicionAntesPausa: null,
    registroOperable: true,
    intencionGobernanteVersion: null,
    intenciones: [],
    solicitudes: []
  });
}

export function decidirIntencionDdnsAgentes(estadoEntrada, solicitudEntrada) {
  const estado = validarEstadoDdnsAgentes(estadoEntrada);
  const solicitud = crearSolicitudDdnsAgentes(solicitudEntrada);
  const hashEstado = hashEstadoDeseado(solicitud.estadoDeseado);
  const previa = estado.solicitudes.find(
    ({ solicitudId }) => solicitudId === solicitud.solicitudId
  );

  if (previa) {
    if (previa.hashEstado !== hashEstado) {
      return resolucion(estado, 'rechazada', 'idempotencia_conflictiva');
    }
    return resolucion(estado, 'repetida', null, previa.intencionVersion);
  }
  if (estado.estadoConcesion !== ESTADOS_CONCESION_DDNS_AGENTES.VIGENTE) {
    return resolucion(estado, 'rechazada', 'sin_autoridad');
  }
  if (!estado.registroOperable) {
    return resolucion(estado, 'rechazada', 'registro_no_operable');
  }

  const gobernante = obtenerGobernante(estado);
  if (gobernante?.hashEstado === hashEstado) {
    const resultado = gobernante.terminal === 'publicada' ||
      gobernante.terminal === 'publicacion_fallida'
      ? 'sin_cambios'
      : 'convergente';
    const siguiente = copiar(estado);
    siguiente.solicitudes.push(registroSolicitud(
      solicitud,
      hashEstado,
      gobernante.version,
      resultado
    ));
    return resolucion(congelar(siguiente), resultado, null, gobernante.version);
  }
  if (solicitud.versionEsperada !== estado.version) {
    return resolucion(estado, 'rechazada', 'version_obsoleta');
  }

  const siguienteVersion = incrementarDecimal(estado.version, 'version');
  const siguiente = copiar(estado);
  const anterior = obtenerGobernanteMutable(siguiente);
  if (anterior && anterior.terminal === null) anterior.terminal = 'sustituida';
  const observada = solicitud.estadoDeseado.modo === 'observada';
  siguiente.version = siguienteVersion;
  siguiente.decision = DECISIONES_CONCESION_DDNS_AGENTES.OPERATIVA;
  siguiente.condicion = observada ? 'esperando_observacion' : 'operativa';
  siguiente.condicionAntesPausa = null;
  siguiente.intencionGobernanteVersion = siguienteVersion;
  siguiente.intenciones.push({
    solicitudId: solicitud.solicitudId,
    version: siguienteVersion,
    hashEstado,
    estadoDeseado: solicitud.estadoDeseado,
    hito: 'intencion_aceptada',
    terminal: null,
    presupuestoAbierto: false,
    intentosConsumidos: 0,
    bloqueada: false
  });
  siguiente.solicitudes.push(registroSolicitud(
    solicitud,
    hashEstado,
    siguienteVersion,
    'aceptada'
  ));
  return resolucion(congelar(siguiente), 'aceptada', null, siguienteVersion);
}

export function marcarContenidoDeseadoPersistidoDdnsAgentes(estadoEntrada) {
  const siguiente = copiar(validarEstadoDdnsAgentes(estadoEntrada));
  const intencion = exigirGobernanteMutable(siguiente);
  exigir(intencion.terminal === null, 'Una intención terminal no puede persistir otro contenido.');
  if (intencion.hito !== 'intencion_aceptada') return congelar(siguiente);
  exigir(intencion.estadoDeseado.modo !== 'observada',
    'El cambio a modo observada espera una causa POL posterior.');
  intencion.hito = 'contenido_deseado_persistido';
  intencion.presupuestoAbierto = true;
  siguiente.condicion = 'operativa';
  return congelar(siguiente);
}

export function marcarContenidoPublicadoDdnsAgentes(estadoEntrada) {
  const siguiente = copiar(validarEstadoDdnsAgentes(estadoEntrada));
  const intencion = exigirGobernanteMutable(siguiente);
  exigir(intencion.terminal === null, 'Una intención terminal no puede publicarse otra vez.');
  exigir(intencion.hito === 'contenido_deseado_persistido',
    'Solo el contenido deseado persistido puede acreditarse como publicado.');
  intencion.hito = 'contenido_publicado';
  intencion.terminal = 'publicada';
  intencion.bloqueada = false;
  siguiente.condicion = 'operativa';
  return congelar(siguiente);
}

export function registrarFalloPublicacionDdnsAgentes(
  estadoEntrada,
  { atribuible }
) {
  const siguiente = copiar(validarEstadoDdnsAgentes(estadoEntrada));
  const intencion = exigirGobernanteMutable(siguiente);
  exigir(intencion.terminal === null, 'Una intención terminal no admite más intentos.');
  exigir(intencion.hito === 'contenido_deseado_persistido' && intencion.presupuestoAbierto,
    'El presupuesto solo existe para contenido deseado persistido.');
  exigir(typeof atribuible === 'boolean', 'La atribución del fallo debe ser explícita.');
  if (!atribuible) {
    intencion.bloqueada = true;
    siguiente.condicion = 'publicacion_bloqueada';
    return congelar(siguiente);
  }
  exigir(intencion.intentosConsumidos < PRESUPUESTO_PUBLICACION_DDNS_AGENTES,
    'El presupuesto de publicación ya está agotado.');
  intencion.intentosConsumidos += 1;
  intencion.bloqueada = false;
  if (intencion.intentosConsumidos === PRESUPUESTO_PUBLICACION_DDNS_AGENTES) {
    intencion.terminal = 'publicacion_fallida';
    siguiente.condicion = 'publicacion_fallida';
  } else {
    siguiente.condicion = 'operativa';
  }
  return congelar(siguiente);
}

export function recuperarBloqueoPublicacionDdnsAgentes(estadoEntrada) {
  const siguiente = copiar(validarEstadoDdnsAgentes(estadoEntrada));
  const intencion = exigirGobernanteMutable(siguiente);
  if (!intencion.bloqueada) return congelar(siguiente);
  exigir(intencion.terminal === null, 'Una intención terminal no recupera bloqueos.');
  intencion.bloqueada = false;
  siguiente.condicion = 'operativa';
  return congelar(siguiente);
}

export function cambiarOperabilidadRegistroDdnsAgentes(estadoEntrada, operable) {
  const siguiente = copiar(validarEstadoDdnsAgentes(estadoEntrada));
  exigir(typeof operable === 'boolean', 'La operabilidad debe ser booleana.');
  if (siguiente.registroOperable === operable) return congelar(siguiente);
  siguiente.registroOperable = operable;
  if (!operable) {
    siguiente.condicionAntesPausa = siguiente.condicion;
    siguiente.condicion = 'registro_no_operable';
  } else {
    siguiente.condicion = siguiente.condicionAntesPausa || condicionDerivada(siguiente);
    siguiente.condicionAntesPausa = null;
  }
  return congelar(siguiente);
}

export function revocarConcesionDdnsAgentes(estadoEntrada) {
  const siguiente = copiar(validarEstadoDdnsAgentes(estadoEntrada));
  siguiente.estadoConcesion = ESTADOS_CONCESION_DDNS_AGENTES.REVOCADA;
  return congelar(siguiente);
}

export function marcarObjetivoIncompatibleDdnsAgentes(estadoEntrada) {
  return terminarGobernante(estadoEntrada, 'objetivo_incompatible');
}

export function marcarObjetivoEliminadoDdnsAgentes(estadoEntrada) {
  return terminarGobernante(estadoEntrada, 'objetivo_eliminado');
}

export function validarEstadoDdnsAgentes(estado) {
  exigir(estado && typeof estado === 'object' && !Array.isArray(estado),
    'El estado DDNS debe ser un objeto.');
  exigir(estado.perfil === PERFIL_MAQUINA_DDNS_AGENTES &&
    estado.versionContrato === VERSION_CONTRATO_DDNS_AGENTES,
  'El estado no pertenece a la máquina ddns_agentes@1.');
  crearIdentidadConcesionDdnsAgentes({
    perfil: PERFILES_DDNS_AGENTES.CONCESION,
    versionContrato: VERSION_CONTRATO_DDNS_AGENTES,
    concesionId: estado.concesionId
  });
  exigir(Object.values(ESTADOS_CONCESION_DDNS_AGENTES).includes(estado.estadoConcesion),
    'El estado de concesión no es válido.');
  exigir(Object.values(DECISIONES_CONCESION_DDNS_AGENTES).includes(estado.decision),
    'La decisión de concesión no es válida.');
  exigirDecimalBigintUnsignedDdnsAgentes(estado.version, 'estado.version');
  exigir(CONDICIONES.has(estado.condicion), 'La condición operativa no es válida.');
  exigir(estado.condicionAntesPausa === null || CONDICIONES.has(estado.condicionAntesPausa),
    'La condición previa a la pausa no es válida.');
  exigir(typeof estado.registroOperable === 'boolean', 'La operabilidad no es válida.');
  exigir(Array.isArray(estado.intenciones) && Array.isArray(estado.solicitudes),
    'El histórico de la máquina no es válido.');
  for (const intencion of estado.intenciones) validarIntencion(intencion);
  return estado;
}

function terminarGobernante(estadoEntrada, terminal) {
  exigir(TERMINALES.has(terminal), 'El terminal DDNS no es válido.');
  const siguiente = copiar(validarEstadoDdnsAgentes(estadoEntrada));
  siguiente.estadoConcesion = ESTADOS_CONCESION_DDNS_AGENTES.REVOCADA;
  const intencion = obtenerGobernanteMutable(siguiente);
  if (intencion && intencion.terminal === null) intencion.terminal = terminal;
  return congelar(siguiente);
}

function validarIntencion(intencion) {
  exigirDecimalBigintUnsignedDdnsAgentes(intencion.version, 'intencion.version');
  exigir(typeof intencion.hashEstado === 'string' && /^[0-9a-f]{64}$/u.test(intencion.hashEstado),
    'La huella de intención no es válida.');
  exigir(HITOS.has(intencion.hito), 'El hito de intención no es válido.');
  exigir(intencion.terminal === null || TERMINALES.has(intencion.terminal),
    'El terminal de intención no es válido.');
  exigir(Number.isInteger(intencion.intentosConsumidos) &&
    intencion.intentosConsumidos >= 0 &&
    intencion.intentosConsumidos <= PRESUPUESTO_PUBLICACION_DDNS_AGENTES,
  'El presupuesto consumido no es válido.');
}

function registroSolicitud(solicitud, hashEstado, intencionVersion, resultado) {
  return {
    solicitudId: solicitud.solicitudId,
    hashEstado,
    intencionVersion,
    resultado
  };
}

function resolucion(estado, resultado, error = null, intencionVersion = null) {
  return congelar({
    estado,
    respuesta: {
      resultado,
      error,
      version: estado.version,
      intencionVersion
    }
  });
}

function hashEstadoDeseado(estadoDeseado) {
  return createHash('sha256')
    .update(serializarCanonicoDdnsAgentes(estadoDeseado), 'utf8')
    .digest('hex');
}

function obtenerGobernante(estado) {
  if (estado.intencionGobernanteVersion === null) return null;
  return estado.intenciones.find(
    ({ version }) => version === estado.intencionGobernanteVersion
  ) || null;
}

function obtenerGobernanteMutable(estado) {
  return obtenerGobernante(estado);
}

function exigirGobernanteMutable(estado) {
  const intencion = obtenerGobernanteMutable(estado);
  exigir(intencion, 'La concesión no posee una intención gobernante.');
  return intencion;
}

function incrementarDecimal(valor, nombre) {
  const actual = BigInt(exigirDecimalBigintUnsignedDdnsAgentes(valor, nombre));
  exigir(actual < MAX_BIGINT_UNSIGNED, `${nombre} agotó BIGINT UNSIGNED.`);
  return (actual + 1n).toString();
}

function condicionDerivada(estado) {
  if (estado.decision === DECISIONES_CONCESION_DDNS_AGENTES.PENDIENTE) {
    return 'pendiente_decision_agente';
  }
  const intencion = obtenerGobernante(estado);
  if (intencion?.terminal === 'publicacion_fallida') return 'publicacion_fallida';
  if (intencion?.bloqueada) return 'publicacion_bloqueada';
  if (intencion?.estadoDeseado?.modo === 'observada' &&
      intencion.hito === 'intencion_aceptada') return 'esperando_observacion';
  return 'operativa';
}

function copiar(valor) {
  return structuredClone(valor);
}

function congelar(valor) {
  if (valor && typeof valor === 'object' && !Object.isFrozen(valor)) {
    for (const contenido of Object.values(valor)) congelar(contenido);
    Object.freeze(valor);
  }
  return valor;
}

function exigir(condicion, mensaje) {
  if (!condicion) throw new Error(mensaje);
}
