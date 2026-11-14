import { normalizarJsonFederacion } from './CanonicalizadorFederacion.js';
import { esFechaUtcCanonicaFederacion } from './FechaUtcFederacion.js';
import { crearIdentidadFederada, TIPOS_IDENTIDAD_FEDERADA } from './IdentidadFederada.js';

export const VERSION_PAYLOAD_CONTEXTO_OPERATIVO_AGENTES_SESIONES_FEDERACION = 1;
export const PERFIL_PAYLOAD_CONTEXTO_OPERATIVO_AGENTES_SESIONES_FEDERACION =
  'sentinelia-federacion-contexto-operativo-agente-v1';

const ESTADOS_POL = new Set(['nuncaObservado', 'abierto', 'cerrado']);

export class ErrorPayloadContextoOperativoAgentesSesionesFederacion extends Error {
  constructor(codigo, mensaje, { campo = null } = {}) {
    super(mensaje);
    this.name = 'ErrorPayloadContextoOperativoAgentesSesionesFederacion';
    this.codigo = codigo;
    this.campo = campo;
  }
}

export function validarPayloadContextoOperativoAgentesSesionesFederacion(
  payload,
  { operacion = 'actualizacion' } = {}
) {
  if (operacion !== 'actualizacion') {
    fallar('operacion_contexto_agente_invalida', 'El payload solo existe para actualizaciones.');
  }
  payload = normalizarJsonFederacion(payload);
  exigirClaves(payload, [
    'estadoPol', 'identidadTecnica', 'perfil', 'periodos',
    'scopeOrganizativo', 'tipo', 'version'
  ]);
  if (
    payload.perfil !== PERFIL_PAYLOAD_CONTEXTO_OPERATIVO_AGENTES_SESIONES_FEDERACION ||
    payload.version !== VERSION_PAYLOAD_CONTEXTO_OPERATIVO_AGENTES_SESIONES_FEDERACION ||
    payload.tipo !== 'agente'
  ) {
    fallar('version_contexto_agente_incompatible', 'Perfil, versión o tipo de contexto incompatibles.');
  }
  exigirClaves(payload.identidadTecnica, ['descripcion', 'guid', 'nombre', 'versionAgente']);
  exigirClaves(payload.scopeOrganizativo, [
    'empresaElementoOrigenId', 'sitioElementoOrigenId', 'tenantElementoOrigenId'
  ]);
  exigirClaves(payload.estadoPol, [
    'bootId', 'estado', 'ultimoHeartbeatUtc', 'ultimoSeq'
  ]);
  if (!ESTADOS_POL.has(payload.estadoPol.estado)) {
    fallar('estado_pol_invalido', 'El estado POL debe ser nuncaObservado, abierto o cerrado.', 'estadoPol.estado');
  }
  if (!Array.isArray(payload.periodos)) {
    fallar('periodos_pol_invalidos', 'Los períodos POL deben formar una lista.', 'periodos');
  }
  const periodos = payload.periodos.map((periodo, indice) => validarPeriodo(periodo, indice));
  for (let indice = 1; indice < periodos.length; indice += 1) {
    if (periodos[indice - 1].inicioUtc > periodos[indice].inicioUtc) {
      fallar('orden_periodos_pol_invalido', 'Los períodos POL deben ordenarse por inicio.', 'periodos');
    }
  }
  return normalizarJsonFederacion({
    perfil: PERFIL_PAYLOAD_CONTEXTO_OPERATIVO_AGENTES_SESIONES_FEDERACION,
    version: VERSION_PAYLOAD_CONTEXTO_OPERATIVO_AGENTES_SESIONES_FEDERACION,
    tipo: 'agente',
    identidadTecnica: {
      guid: texto(payload.identidadTecnica.guid, 36, 'identidadTecnica.guid'),
      nombre: texto(payload.identidadTecnica.nombre, 160, 'identidadTecnica.nombre'),
      descripcion: textoOpcional(payload.identidadTecnica.descripcion, 512, 'identidadTecnica.descripcion'),
      versionAgente: textoOpcional(payload.identidadTecnica.versionAgente, 80, 'identidadTecnica.versionAgente')
    },
    scopeOrganizativo: {
      tenantElementoOrigenId: identidadElemento(payload.scopeOrganizativo.tenantElementoOrigenId, 'tenantElementoOrigenId'),
      empresaElementoOrigenId: identidadElemento(payload.scopeOrganizativo.empresaElementoOrigenId, 'empresaElementoOrigenId'),
      sitioElementoOrigenId: identidadElemento(payload.scopeOrganizativo.sitioElementoOrigenId, 'sitioElementoOrigenId')
    },
    estadoPol: {
      estado: payload.estadoPol.estado,
      bootId: textoOpcional(payload.estadoPol.bootId, 120, 'estadoPol.bootId'),
      ultimoHeartbeatUtc: fechaOpcional(payload.estadoPol.ultimoHeartbeatUtc, 'estadoPol.ultimoHeartbeatUtc'),
      ultimoSeq: decimalOpcional(payload.estadoPol.ultimoSeq, 'estadoPol.ultimoSeq')
    },
    periodos
  });
}

function validarPeriodo(periodo, indice) {
  exigirClaves(periodo, ['bootId', 'finUtc', 'inicioUtc', 'motivoCierre', 'ultimoHeartbeatUtc', 'ultimoSeq']);
  const prefijo = `periodos.${indice}`;
  const inicioUtc = fecha(periodo.inicioUtc, `${prefijo}.inicioUtc`);
  const finUtc = fechaOpcional(periodo.finUtc, `${prefijo}.finUtc`);
  if (finUtc !== null && finUtc <= inicioUtc) {
    fallar('intervalo_pol_invalido', 'El cierre POL debe ser posterior a su inicio.', `${prefijo}.finUtc`);
  }
  return {
    bootId: textoOpcional(periodo.bootId, 120, `${prefijo}.bootId`),
    inicioUtc,
    finUtc,
    ultimoHeartbeatUtc: fechaOpcional(periodo.ultimoHeartbeatUtc, `${prefijo}.ultimoHeartbeatUtc`),
    ultimoSeq: decimalOpcional(periodo.ultimoSeq, `${prefijo}.ultimoSeq`),
    motivoCierre: textoOpcional(periodo.motivoCierre, 64, `${prefijo}.motivoCierre`)
  };
}

function exigirClaves(valor, esperadas) {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) {
    fallar('forma_contexto_agente_invalida', 'El contexto contiene una estructura inválida.');
  }
  const actuales = Object.keys(valor).sort();
  const ordenadas = [...esperadas].sort();
  if (actuales.length !== ordenadas.length || actuales.some((clave, i) => clave !== ordenadas[i])) {
    fallar('forma_contexto_agente_invalida', 'El contexto contiene campos ausentes o desconocidos.');
  }
}

function identidadElemento(valor, campo) {
  try {
    return String(crearIdentidadFederada({ tipo: TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN, valor }));
  } catch {
    fallar('identidad_scope_agente_invalida', `${campo} no es una identidad de origen válida.`, campo);
  }
}

function texto(valor, maximo, campo) {
  if (typeof valor !== 'string' || !valor || valor !== valor.trim() || valor.length > maximo) {
    fallar('texto_contexto_agente_invalido', `${campo} no es texto canónico válido.`, campo);
  }
  return valor;
}

function textoOpcional(valor, maximo, campo) {
  return valor === null ? null : texto(valor, maximo, campo);
}

function fecha(valor, campo) {
  if (!esFechaUtcCanonicaFederacion(valor)) {
    fallar('fecha_contexto_agente_invalida', `${campo} debe ser UTC ISO con milisegundos.`, campo);
  }
  return valor;
}

function fechaOpcional(valor, campo) {
  return valor === null ? null : fecha(valor, campo);
}

function decimalOpcional(valor, campo) {
  if (valor === null) return null;
  const textoValor = String(valor);
  if (!/^(0|[1-9]\d*)$/u.test(textoValor)) {
    fallar('secuencia_contexto_agente_invalida', `${campo} debe ser decimal no negativo.`, campo);
  }
  return textoValor;
}

function fallar(codigo, mensaje, campo = null) {
  throw new ErrorPayloadContextoOperativoAgentesSesionesFederacion(codigo, mensaje, { campo });
}
