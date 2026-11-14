import { crearIdentidadFederada, TIPOS_IDENTIDAD_FEDERADA } from './IdentidadFederada.js';

const TIPOS_ACTOR = new Set([
  'usuario', 'agente', 'runtime', 'sistema', 'instancia_remota'
]);

export class ErrorFotografiaActorFederado extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.name = 'ErrorFotografiaActorFederado';
    this.codigo = codigo;
  }
}

export function validarFotografiaActorFederado(valor) {
  if (!objeto(valor)) fallar('fotografia_actor_invalida', 'La fotografía de actor debe ser explícita.');
  if (valor.estado === 'omitida') {
    claves(valor, ['estado']);
    return Object.freeze({ estado: 'omitida' });
  }
  if (valor.estado === 'opaca') {
    claves(valor, ['elementoOrigenId', 'estado']);
    return Object.freeze({
      estado: 'opaca',
      elementoOrigenId: identidadActor(valor.elementoOrigenId)
    });
  }
  if (valor.estado !== 'visible') {
    fallar('estado_fotografia_actor_invalido', 'El actor debe ser visible, opaco u omitido.');
  }
  claves(valor, ['elementoOrigenId', 'estado', 'nombreVisible', 'tipo']);
  if (!TIPOS_ACTOR.has(valor.tipo)) {
    fallar('tipo_fotografia_actor_invalido', 'El tipo del actor no pertenece al contrato.');
  }
  const nombreVisible = String(valor.nombreVisible || '').trim();
  if (!nombreVisible || nombreVisible.length > 160) {
    fallar('nombre_fotografia_actor_invalido', 'El nombre visible del actor no es válido.');
  }
  return Object.freeze({
    estado: 'visible',
    elementoOrigenId: identidadActor(valor.elementoOrigenId),
    tipo: valor.tipo,
    nombreVisible
  });
}

function identidadActor(valor) {
  try {
    return String(crearIdentidadFederada({
      tipo: TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN,
      valor: String(valor || '')
    }));
  } catch {
    fallar('identidad_fotografia_actor_invalida', 'La identidad federada del actor no es válida.');
  }
}

function claves(valor, esperadas) {
  const actuales = Object.keys(valor).sort();
  const objetivo = [...esperadas].sort();
  if (actuales.length !== objetivo.length || actuales.some((v, i) => v !== objetivo[i])) {
    fallar('forma_fotografia_actor_invalida', 'La fotografía contiene campos ausentes o administrativos.');
  }
}

function objeto(valor) {
  return Boolean(valor) && typeof valor === 'object' && !Array.isArray(valor);
}

function fallar(codigo, mensaje) {
  throw new ErrorFotografiaActorFederado(codigo, mensaje);
}
