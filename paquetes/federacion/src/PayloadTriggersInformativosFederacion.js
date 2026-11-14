import { normalizarJsonFederacion } from './CanonicalizadorFederacion.js';
import { esFechaUtcCanonicaFederacion } from './FechaUtcFederacion.js';
import { crearIdentidadFederada, TIPOS_IDENTIDAD_FEDERADA } from './IdentidadFederada.js';
import { esTipoTrigger } from '../../triggers/src/CatalogoTiposTrigger.js';
import { crearDefinicionMensajeTriggerCorreo }
  from '../../correo/src/ContratoTriggerCorreo.js';

export const VERSION_PAYLOAD_TRIGGERS_INFORMATIVOS_FEDERACION = 2;
export const PERFIL_PAYLOAD_TRIGGERS_INFORMATIVOS_FEDERACION =
  'sentinelia-federacion-triggers-informativos-v2';
export const TIPOS_REGISTRO_TRIGGERS_INFORMATIVOS_FEDERACION = Object.freeze([
  'definicion', 'asignacionMonitor', 'ejecucionTerminada'
]);
const CAUSAS_OMISION = new Set(['noSeleccionado', 'noAutorizado', 'ausenteEnOrigen']);

export class ErrorPayloadTriggersInformativosFederacion extends Error {
  constructor(codigo, mensaje) { super(mensaje); this.name = 'ErrorPayloadTriggersInformativosFederacion'; this.codigo = codigo; }
}

export function validarPayloadTriggersInformativosFederacion(payload, { operacion = 'actualizacion' } = {}) {
  if (operacion !== 'actualizacion') fallar('operacion_trigger_informativo_invalida', 'El payload solo acompaña actualizaciones.');
  payload = normalizarJsonFederacion(payload);
  if (!objeto(payload) || payload.perfil !== PERFIL_PAYLOAD_TRIGGERS_INFORMATIVOS_FEDERACION ||
      payload.version !== VERSION_PAYLOAD_TRIGGERS_INFORMATIVOS_FEDERACION) {
    fallar('version_payload_trigger_informativo_incompatible', 'Perfil o versión incompatibles.');
  }
  if (!TIPOS_REGISTRO_TRIGGERS_INFORMATIVOS_FEDERACION.includes(payload.tipoRegistro)) {
    fallar('tipo_registro_trigger_informativo_invalido', 'El tipo de registro no está soportado.');
  }
  const validadores = {
    definicion: validarDefinicion,
    asignacionMonitor: validarAsignacion,
    ejecucionTerminada: validarEjecucion
  };
  return normalizarJsonFederacion({
    perfil: PERFIL_PAYLOAD_TRIGGERS_INFORMATIVOS_FEDERACION,
    version: VERSION_PAYLOAD_TRIGGERS_INFORMATIVOS_FEDERACION,
    tipoRegistro: payload.tipoRegistro,
    ...validadores[payload.tipoRegistro](payload)
  });
}

function validarDefinicion(p) {
  exigirClaves(p, comunes(['activo','configuracionOperativa','contenidoSensible','descripcion','nombre','scopeOrganizativo','tipo']));
  const salida = {
    nombre: texto(p.nombre, 160, 'nombre'), tipo: tipoTrigger(p.tipo, 'tipo'),
    descripcion: textoOpcional(p.descripcion, 255, 'descripcion'), activo: booleano(p.activo, 'activo'),
    configuracionOperativa: json(p.configuracionOperativa, 'configuracionOperativa'),
    contenidoSensible: declaracionSensible(p.contenidoSensible),
    scopeOrganizativo: scope(p.scopeOrganizativo)
  };
  validarDefinicionCorreo(salida);
  return salida;
}

function validarAsignacion(p) {
  exigirClaves(p, comunes(['activo','configuracionOverride','contenidoSensible','eventosDisparo','monitorReferencia','ordenEjecucion','triggerOrigenId']));
  if (!Array.isArray(p.eventosDisparo)) fallar('eventos_disparo_trigger_informativo_invalidos', 'Los eventos de disparo deben ser una lista.');
  const eventos = p.eventosDisparo.map((v, i) => ascii(v, 40, `eventosDisparo.${i}`));
  if (new Set(eventos).size !== eventos.length) fallar('eventos_disparo_trigger_informativo_duplicados', 'Los eventos de disparo no pueden repetirse.');
  return {
    triggerOrigenId: elemento(p.triggerOrigenId, 'triggerOrigenId'),
    monitorReferencia: referencia(p.monitorReferencia, 'monitorReferencia'),
    activo: booleano(p.activo, 'activo'), ordenEjecucion: entero(p.ordenEjecucion, 0, 65535, 'ordenEjecucion'),
    eventosDisparo: eventos, configuracionOverride: jsonOpcional(p.configuracionOverride, 'configuracionOverride'),
    contenidoSensible: declaracionSensible(p.contenidoSensible)
  };
}

function validarEjecucion(p) {
  exigirClaves(p, comunes(['asignacionReferencia','codigoResultado','estadoEjecucion','eventoDisparo','finalizadoEnUtc','iniciadoEnUtc','mensajeResultado','monitorReferencia','payloadError','payloadRespuesta','payloadSolicitud','resultadoCorreo','tipoTrigger','triggerNombre','triggerOrigenId','versionCatalogo']));
  if (!['ok', 'error'].includes(p.estadoEjecucion)) fallar('ejecucion_trigger_no_terminal', 'Solo se federan ejecuciones terminadas.');
  const inicio = fecha(p.iniciadoEnUtc, 'iniciadoEnUtc');
  const fin = fecha(p.finalizadoEnUtc, 'finalizadoEnUtc');
  if (fin < inicio) fallar('cronologia_ejecucion_trigger_invalida', 'La ejecución no puede finalizar antes de comenzar.');
  const tipo = tipoTrigger(p.tipoTrigger, 'tipoTrigger');
  return {
    triggerOrigenId: elemento(p.triggerOrigenId, 'triggerOrigenId'),
    asignacionReferencia: referenciaOpcional(p.asignacionReferencia, 'asignacionReferencia'),
    monitorReferencia: referenciaOpcional(p.monitorReferencia, 'monitorReferencia'),
    versionCatalogo: textoOpcional(p.versionCatalogo, 64, 'versionCatalogo'),
    eventoDisparo: ascii(p.eventoDisparo, 40, 'eventoDisparo'), estadoEjecucion: p.estadoEjecucion,
    tipoTrigger: tipo, triggerNombre: texto(p.triggerNombre, 160, 'triggerNombre'),
    codigoResultado: textoOpcional(p.codigoResultado, 80, 'codigoResultado'),
    mensajeResultado: textoOpcional(p.mensajeResultado, 255, 'mensajeResultado'),
    payloadSolicitud: declaracionSensible(p.payloadSolicitud),
    payloadRespuesta: declaracionSensible(p.payloadRespuesta), payloadError: declaracionSensible(p.payloadError),
    resultadoCorreo: validarResultadoCorreo(p.resultadoCorreo, tipo),
    iniciadoEnUtc: inicio, finalizadoEnUtc: fin
  };
}

function validarDefinicionCorreo(p) {
  if (p.tipo !== 'correo') return;
  exigirClaves(p.configuracionOperativa, ['forma','version']);
  exigirClaves(p.configuracionOperativa.forma, [
    'asuntoPlantilla','textoCierre','textoIntroduccion'
  ]);
  if (p.configuracionOperativa.version !== 1 ||
      p.configuracionOperativa.forma.asuntoPlantilla !== 'configurable') {
    fallar('forma_trigger_correo_federado_invalida',
      'La forma pública del trigger de correo no pertenece al contrato.');
  }
  booleano(p.configuracionOperativa.forma.textoIntroduccion,
    'configuracionOperativa.forma.textoIntroduccion');
  booleano(p.configuracionOperativa.forma.textoCierre,
    'configuracionOperativa.forma.textoCierre');
  if (p.contenidoSensible.estado !== 'presente') return;
  exigirClaves(p.contenidoSensible.contenido, ['definicionMensaje']);
  try {
    crearDefinicionMensajeTriggerCorreo(
      p.contenidoSensible.contenido.definicionMensaje
    );
  } catch {
    fallar('definicion_trigger_correo_federada_invalida',
      'La definición reusable de correo no pertenece al contrato.');
  }
}

function validarResultadoCorreo(valor, tipo) {
  if (tipo !== 'correo') {
    if (valor !== null) fallar('resultado_correo_trigger_ajeno',
      'Solo una ejecución de correo declara resultado agregado de correo.');
    return null;
  }
  exigirClaves(valor, [
    'detalleEstado','totalResultadosDestinatarios','totalSalidas'
  ]);
  const estados = ['conservado','purgado','ausente'];
  if (!estados.includes(valor.detalleEstado)) {
    fallar('resultado_correo_federado_invalido',
      'El estado agregado de correo no pertenece al contrato.');
  }
  return {
    detalleEstado: valor.detalleEstado,
    totalResultadosDestinatarios: enteroOpcional(
      valor.totalResultadosDestinatarios,
      'resultadoCorreo.totalResultadosDestinatarios'
    ),
    totalSalidas: enteroOpcional(
      valor.totalSalidas,
      'resultadoCorreo.totalSalidas'
    )
  };
}

function declaracionSensible(v) {
  if (!objeto(v) || !['presente','omitido'].includes(v.estado)) fallar('contenido_sensible_trigger_invalido', 'El contenido sensible debe declarar su estado.');
  if (v.estado === 'presente') { exigirClaves(v, ['contenido','estado']); return { estado: 'presente', contenido: json(v.contenido, 'contenido') }; }
  exigirClaves(v, ['causa','estado']);
  if (!CAUSAS_OMISION.has(v.causa)) fallar('causa_omision_trigger_invalida', 'La causa de omisión no está soportada.');
  return { estado: 'omitido', causa: v.causa };
}
function referencia(v, campo) { if (!objeto(v)) fallar('referencia_trigger_invalida', `${campo} debe ser una referencia.`); exigirClaves(v, ['elementoOrigenId','visibilidad']); if (!['visible','opaca'].includes(v.visibilidad)) fallar('visibilidad_trigger_invalida', `${campo} tiene visibilidad inválida.`); return { visibilidad: v.visibilidad, elementoOrigenId: elemento(v.elementoOrigenId, `${campo}.elementoOrigenId`) }; }
function referenciaOpcional(v, campo) { return v === null ? null : referencia(v, campo); }
function scope(v) { if (!objeto(v)) fallar('scope_trigger_informativo_invalido', 'El scope es obligatorio.'); exigirClaves(v, ['empresaElementoOrigenId','sitioElementoOrigenId','tenantElementoOrigenId']); const salida={ tenantElementoOrigenId: elementoOpcional(v.tenantElementoOrigenId, 'tenant'), empresaElementoOrigenId: elementoOpcional(v.empresaElementoOrigenId, 'empresa'), sitioElementoOrigenId: elementoOpcional(v.sitioElementoOrigenId, 'sitio') }; const valida=(salida.tenantElementoOrigenId===null&&salida.empresaElementoOrigenId===null&&salida.sitioElementoOrigenId===null)||(salida.tenantElementoOrigenId!==null&&salida.empresaElementoOrigenId===null&&salida.sitioElementoOrigenId===null)||(salida.tenantElementoOrigenId!==null&&salida.empresaElementoOrigenId!==null); if(!valida||(salida.sitioElementoOrigenId!==null&&salida.empresaElementoOrigenId===null)) fallar('scope_trigger_informativo_invalido','La profundidad del scope no es coherente.'); return salida; }
function elemento(v, campo) { try { return String(crearIdentidadFederada({ tipo: TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN, valor: String(v || '') })); } catch { fallar('identidad_trigger_informativo_invalida', `${campo} no es una identidad válida.`); } }
function elementoOpcional(v, campo) { return v === null ? null : elemento(v, campo); }
function fecha(v, campo) { const s = String(v || ''); if (!esFechaUtcCanonicaFederacion(s)) fallar('fecha_trigger_informativo_invalida', `${campo} debe ser UTC canónico.`); return s; }
function texto(v, max, campo) { const s = String(v ?? '').trim(); if (!s || s.length > max) fallar('texto_trigger_informativo_invalido', `${campo} no es válido.`); return s; }
function textoOpcional(v, max, campo) { return v === null ? null : texto(v, max, campo); }
function ascii(v, max, campo) { const s = texto(v, max, campo); if (!/^[\x20-\x7e]+$/u.test(s)) fallar('ascii_trigger_informativo_invalido', `${campo} debe ser ASCII.`); return s; }
function tipoTrigger(v, campo) { const s = ascii(v, 40, campo).toLowerCase(); if (!esTipoTrigger(s)) fallar('tipo_trigger_informativo_invalido', `${campo} no pertenece al catálogo de triggers.`); return s; }
function entero(v, min, max, campo) { const n = Number(v); if (!Number.isSafeInteger(n) || n < min || n > max) fallar('entero_trigger_informativo_invalido', `${campo} está fuera de rango.`); return n; }
function enteroOpcional(v, campo) { return v === null ? null : entero(v, 0, Number.MAX_SAFE_INTEGER, campo); }
function booleano(v, campo) { if (typeof v !== 'boolean') fallar('booleano_trigger_informativo_invalido', `${campo} debe ser booleano.`); return v; }
function json(v, campo) { if (!objeto(v)) fallar('json_trigger_informativo_invalido', `${campo} debe ser un objeto.`); return v; }
function jsonOpcional(v, campo) { return v === null ? null : json(v, campo); }
function comunes(c) { return ['perfil','tipoRegistro','version',...c]; }
function exigirClaves(v, e) { if (!objeto(v)) fallar('forma_payload_trigger_informativo_invalida', 'El payload es inválido.'); const a=Object.keys(v).sort(), b=[...e].sort(); if (a.length!==b.length || a.some((x,i)=>x!==b[i])) fallar('forma_payload_trigger_informativo_invalida', 'El payload contiene campos ausentes o desconocidos.'); }
function objeto(v) { return Boolean(v) && typeof v === 'object' && !Array.isArray(v); }
function fallar(c,m) { throw new ErrorPayloadTriggersInformativosFederacion(c,m); }
