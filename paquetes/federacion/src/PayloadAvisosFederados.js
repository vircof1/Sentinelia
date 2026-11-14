import { normalizarJsonFederacion } from './CanonicalizadorFederacion.js';
import { esFechaUtcCanonicaFederacion } from './FechaUtcFederacion.js';
import { validarFotografiaActorFederado } from './FotografiaActorFederado.js';
import { crearIdentidadFederada, TIPOS_IDENTIDAD_FEDERADA } from './IdentidadFederada.js';

export const VERSION_PAYLOAD_AVISOS_FEDERADOS = 1;
export const PERFIL_PAYLOAD_AVISOS_FEDERADOS = 'sentinelia-federacion-avisos-v1';
export const TIPOS_REGISTRO_AVISOS_FEDERADOS = Object.freeze(['estadoActual', 'transicion']);

const ESTADOS = new Set(['pendiente', 'resuelto', 'obsoleto']);
const GRAVEDADES = new Set(['informativa', 'advertencia', 'critica']);
const TRANSICIONES = new Set([
  'apertura', 'reapertura', 'confirmacion_tecnica', 'actualizacion',
  'escalado', 'desescalado', 'resolucion', 'obsolescencia'
]);

export class ErrorPayloadAvisosFederados extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.name = 'ErrorPayloadAvisosFederados';
    this.codigo = codigo;
  }
}

export function validarPayloadAvisosFederados(payload, { operacion = 'actualizacion' } = {}) {
  if (operacion !== 'actualizacion') {
    fallar('operacion_aviso_federado_invalida', 'El payload de aviso solo acompaña actualizaciones.');
  }
  payload = normalizarJsonFederacion(payload);
  if (!objeto(payload) || !TIPOS_REGISTRO_AVISOS_FEDERADOS.includes(payload.tipoRegistro)) {
    fallar('tipo_registro_aviso_federado_invalido', 'El tipo de registro del aviso no existe.');
  }
  if (payload.perfil !== PERFIL_PAYLOAD_AVISOS_FEDERADOS ||
      payload.version !== VERSION_PAYLOAD_AVISOS_FEDERADOS) {
    fallar('version_aviso_federado_incompatible', 'El contrato del aviso no es compatible.');
  }
  return normalizarJsonFederacion(payload.tipoRegistro === 'estadoActual'
    ? validarEstado(payload)
    : validarTransicion(payload));
}

function validarEstado(p) {
  claves(p, [
    'actorUltimaTransicion', 'avisoOrigenId', 'causaCodigo', 'cicloAnteriorOrigenId',
    'contextoHumano', 'contadorDetecciones', 'estadoCiclo', 'flujoOrigenId',
    'gravedad', 'installationAfectadaId', 'objetoAfectado', 'perfil',
    'obsoletoEnUtc', 'primeraDeteccionUtc', 'relacionOrigenId', 'resueltoEnUtc', 'resumen',
    'tipoCodigo', 'tipoRegistro', 'ultimaDeteccionUtc', 'version', 'versionCatalogo'
  ]);
  comun(p);
  const primera = fecha(p.primeraDeteccionUtc, 'primeraDeteccionUtc');
  const ultima = fecha(p.ultimaDeteccionUtc, 'ultimaDeteccionUtc');
  const resuelto = fechaOpcional(p.resueltoEnUtc, 'resueltoEnUtc');
  const obsoleto = fechaOpcional(p.obsoletoEnUtc, 'obsoletoEnUtc');
  if (ultima < primera ||
      (p.estadoCiclo === 'resuelto') !== (resuelto !== null) ||
      (p.estadoCiclo === 'obsoleto') !== (obsoleto !== null) ||
      (resuelto !== null && obsoleto !== null)) {
    fallar('cronologia_estado_aviso_federado_invalida', 'El ciclo remoto posee tiempos incoherentes.');
  }
  return {
    ...p,
    avisoOrigenId: uuid(p.avisoOrigenId, 'avisoOrigenId'),
    installationAfectadaId: identidad(p.installationAfectadaId, TIPOS_IDENTIDAD_FEDERADA.INSTALACION),
    versionCatalogo: entero(p.versionCatalogo, 'versionCatalogo'),
    contadorDetecciones: decimalPositivo(p.contadorDetecciones, 'contadorDetecciones'),
    objetoAfectado: objetoAfectado(p.objetoAfectado),
    relacionOrigenId: identidadOpcional(p.relacionOrigenId, TIPOS_IDENTIDAD_FEDERADA.RELACION),
    flujoOrigenId: identidadOpcional(p.flujoOrigenId, TIPOS_IDENTIDAD_FEDERADA.FLUJO),
    cicloAnteriorOrigenId: p.cicloAnteriorOrigenId === null ? null : uuid(p.cicloAnteriorOrigenId, 'cicloAnteriorOrigenId'),
    primeraDeteccionUtc: primera,
    ultimaDeteccionUtc: ultima,
    resueltoEnUtc: resuelto,
    obsoletoEnUtc: obsoleto,
    contextoHumano: json(p.contextoHumano, 'contextoHumano'),
    resumen: json(p.resumen, 'resumen'),
    actorUltimaTransicion: validarFotografiaActorFederado(p.actorUltimaTransicion)
  };
}

function validarTransicion(p) {
  claves(p, [
    'actor', 'avisoOrigenId', 'contextoHumano', 'contadorDetecciones', 'correlacionOrigenId',
    'detalle', 'efectivoEnUtc', 'estadoAnterior', 'estadoNuevo', 'eventoAuditoriaOrigenId',
    'gravedadAnterior', 'gravedadNueva', 'ordinal', 'perfil', 'registradoEnUtc',
    'resumen', 'tipoRegistro', 'transicionTipo', 'version'
  ]);
  if (!TRANSICIONES.has(p.transicionTipo)) {
    fallar('transicion_aviso_federado_invalida', 'La transición del aviso no pertenece al contrato.');
  }
  const estadoAnterior = enumOpcional(p.estadoAnterior, ESTADOS, 'estadoAnterior');
  const estadoNuevo = enumValor(p.estadoNuevo, ESTADOS, 'estadoNuevo');
  const gravedadAnterior = enumOpcional(p.gravedadAnterior, GRAVEDADES, 'gravedadAnterior');
  const gravedadNueva = enumValor(p.gravedadNueva, GRAVEDADES, 'gravedadNueva');
  const efectivo = fecha(p.efectivoEnUtc, 'efectivoEnUtc');
  const registrado = fecha(p.registradoEnUtc, 'registradoEnUtc');
  if (registrado < efectivo) fallar('cronologia_transicion_aviso_invalida', 'El registro precede al hecho remoto.');
  validarSemanticaTransicion({
    tipo: p.transicionTipo,
    estadoAnterior,
    estadoNuevo,
    gravedadAnterior,
    gravedadNueva
  });
  return {
    ...p,
    avisoOrigenId: uuid(p.avisoOrigenId, 'avisoOrigenId'),
    ordinal: entero(p.ordinal, 'ordinal'),
    transicionTipo: p.transicionTipo,
    estadoAnterior,
    estadoNuevo,
    gravedadAnterior,
    gravedadNueva,
    contadorDetecciones: decimalPositivo(p.contadorDetecciones, 'contadorDetecciones'),
    efectivoEnUtc: efectivo,
    registradoEnUtc: registrado,
    eventoAuditoriaOrigenId: uuid(p.eventoAuditoriaOrigenId, 'eventoAuditoriaOrigenId'),
    correlacionOrigenId: uuid(p.correlacionOrigenId, 'correlacionOrigenId'),
    detalle: json(p.detalle, 'detalle'),
    contextoHumano: json(p.contextoHumano, 'contextoHumano'),
    resumen: json(p.resumen, 'resumen'),
    actor: validarFotografiaActorFederado(p.actor)
  };
}

function validarSemanticaTransicion({
  tipo, estadoAnterior, estadoNuevo, gravedadAnterior, gravedadNueva
}) {
  const apertura = (tipo === 'apertura' || tipo === 'reapertura') &&
    estadoAnterior === null && estadoNuevo === 'pendiente' && gravedadAnterior === null;
  const confirmacion = (tipo === 'confirmacion_tecnica' || tipo === 'actualizacion') &&
    estadoAnterior === 'pendiente' && estadoNuevo === 'pendiente' &&
    gravedadAnterior === gravedadNueva;
  const escalado = tipo === 'escalado' && estadoAnterior === 'pendiente' &&
    estadoNuevo === 'pendiente' && gravedadMayor(gravedadNueva, gravedadAnterior);
  const desescalado = tipo === 'desescalado' && estadoAnterior === 'pendiente' &&
    estadoNuevo === 'pendiente' && gravedadMayor(gravedadAnterior, gravedadNueva);
  const resolucion = tipo === 'resolucion' && estadoAnterior === 'pendiente' &&
    estadoNuevo === 'resuelto' && gravedadAnterior === gravedadNueva;
  const obsolescencia = tipo === 'obsolescencia' && estadoAnterior === 'pendiente' &&
    estadoNuevo === 'obsoleto' && gravedadAnterior === gravedadNueva;
  if (!(apertura || confirmacion || escalado || desescalado || resolucion || obsolescencia)) {
    fallar(
      'semantica_transicion_aviso_federado_invalida',
      'La transición no respeta el ciclo canónico de avisos de plataforma.'
    );
  }
}

function gravedadMayor(mayor, menor) {
  const orden = { informativa: 0, advertencia: 1, critica: 2 };
  return orden[mayor] > orden[menor];
}

function comun(p) {
  enumValor(p.estadoCiclo, ESTADOS, 'estadoCiclo');
  enumValor(p.gravedad, GRAVEDADES, 'gravedad');
  codigo(p.tipoCodigo, 'tipoCodigo');
  codigo(p.causaCodigo, 'causaCodigo');
}
function objetoAfectado(v) { if (!objeto(v)) fallar('objeto_aviso_federado_invalido', 'El objeto afectado debe conservarse.'); claves(v, ['id','tipo']); return { tipo: codigo(v.tipo,'objetoAfectado.tipo'), id: texto(v.id,191,'objetoAfectado.id') }; }
function json(v,c) { if (!objeto(v)) fallar('json_aviso_federado_invalido', `${c} debe ser un objeto.`); return v; }
function codigo(v,c) { const s=String(v||''); if(!/^[a-z][a-z0-9_]{0,63}$/u.test(s))fallar('codigo_aviso_federado_invalido',`${c} no es válido.`); return s; }
function texto(v,n,c){const s=String(v||'');if(!s||s.length>n)fallar('texto_aviso_federado_invalido',`${c} no es válido.`);return s;}
function entero(v,c){if(!Number.isSafeInteger(v)||v<1)fallar('entero_aviso_federado_invalido',`${c} debe ser positivo.`);return v;}
function decimalPositivo(v,c){const s=String(v??'');if(!/^[1-9]\d*$/u.test(s))fallar('contador_aviso_federado_invalido',`${c} debe ser positivo.`);return s;}
function fecha(v,c){const s=String(v||'');if(!esFechaUtcCanonicaFederacion(s))fallar('fecha_aviso_federado_invalida',`${c} debe ser UTC canónico.`);return s;}
function fechaOpcional(v,c){return v===null?null:fecha(v,c);}
function uuid(v,c){const t=String(v||'');if(!/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(t))fallar('uuid_aviso_federado_invalido',`${c} debe ser UUIDv7.`);return t;}
function identidad(v,t){try{return String(crearIdentidadFederada({tipo:t,valor:String(v||'')}));}catch{fallar('identidad_aviso_federado_invalida','Una identidad federada no es válida.');}}
function identidadOpcional(v,t){return v===null?null:identidad(v,t);}
function enumValor(v,s,c){if(!s.has(v))fallar('enum_aviso_federado_invalido',`${c} no pertenece al contrato.`);return v;}
function enumOpcional(v,s,c){return v===null?null:enumValor(v,s,c);}
function claves(v,e){if(!objeto(v))fallar('forma_aviso_federado_invalida','Se esperaba un objeto.');const a=Object.keys(v).sort(),o=[...e].sort();if(a.length!==o.length||a.some((x,i)=>x!==o[i]))fallar('forma_aviso_federado_invalida','Existen campos ausentes o desconocidos.');}
function objeto(v){return Boolean(v)&&typeof v==='object'&&!Array.isArray(v);}
function fallar(c,m){throw new ErrorPayloadAvisosFederados(c,m);}
