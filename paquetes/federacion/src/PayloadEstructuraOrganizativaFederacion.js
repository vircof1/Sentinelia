import { normalizarJsonFederacion } from './CanonicalizadorFederacion.js';
import {
  crearIdentidadFederada,
  TIPOS_IDENTIDAD_FEDERADA
} from './IdentidadFederada.js';

export const VERSION_PAYLOAD_ESTRUCTURA_ORGANIZATIVA_FEDERACION = 1;
export const PERFIL_PAYLOAD_ESTRUCTURA_ORGANIZATIVA_FEDERACION =
  'sentinelia-federacion-estructura-organizativa-v1';

const TIPOS_NODO = new Set(['tenant', 'empresa', 'sitio']);
const VISIBILIDADES = new Set(['seleccionada', 'opaca']);

export class ErrorPayloadEstructuraOrganizativaFederacion extends Error {
  constructor(codigo, mensaje, { campo = null } = {}) {
    super(mensaje);
    this.name = 'ErrorPayloadEstructuraOrganizativaFederacion';
    this.codigo = codigo;
    this.campo = campo;
  }
}

export function validarPayloadEstructuraOrganizativaFederacion(
  payload,
  { operacion = 'actualizacion' } = {}
) {
  payload = normalizarJsonFederacion(payload);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    fallar('payload_organizativo_invalido', 'El payload organizativo debe ser un objeto.');
  }
  if (operacion === 'actualizacion') return validarActualizacion(payload);
  fallar(
    'operacion_organizativa_invalida',
    'El payload organizativo solo existe para actualizaciones.',
    'operacion'
  );
}

function validarActualizacion(payload) {
  exigirClaves(payload, [
    'alias', 'descripcion', 'estado', 'linaje', 'nombre', 'perfil', 'timezone',
    'tipo', 'version'
  ]);
  exigirPerfil(payload);
  const tipo = exigirTipo(payload.tipo);
  const linaje = validarLinaje(payload.linaje, tipo);
  const timezone = payload.timezone === null
    ? null
    : texto(payload.timezone, 80, 'timezone');
  if (tipo !== 'sitio' && timezone !== null) {
    fallar(
      'timezone_nodo_incompatible',
      'Solo un sitio puede declarar timezone en la proyección organizativa.',
      'timezone'
    );
  }
  return normalizarJsonFederacion({
    perfil: PERFIL_PAYLOAD_ESTRUCTURA_ORGANIZATIVA_FEDERACION,
    version: VERSION_PAYLOAD_ESTRUCTURA_ORGANIZATIVA_FEDERACION,
    tipo,
    nombre: texto(payload.nombre, 160, 'nombre'),
    alias: texto(payload.alias, 120, 'alias'),
    estado: texto(payload.estado, 32, 'estado'),
    descripcion: textoOpcional(payload.descripcion, 255, 'descripcion'),
    timezone,
    linaje
  });
}

function validarLinaje(valor, tipoNodo) {
  if (!Array.isArray(valor)) {
    fallar('linaje_organizativo_invalido', 'El linaje debe ser una lista ordenada.', 'linaje');
  }
  const tiposEsperados = tipoNodo === 'tenant'
    ? []
    : tipoNodo === 'empresa' ? ['tenant'] : ['tenant', 'empresa'];
  if (valor.length !== tiposEsperados.length) {
    fallar(
      'profundidad_linaje_invalida',
      `El nodo ${tipoNodo} no declara la profundidad de linaje esperada.`,
      'linaje'
    );
  }
  return valor.map((entrada, indice) => {
    exigirClaves(entrada, ['elementoOrigenId', 'nombre', 'tipo', 'visibilidad']);
    const tipo = entrada.tipo;
    if (tipo !== tiposEsperados[indice]) {
      fallar(
        'orden_linaje_invalido',
        'El linaje debe ordenar tenant y empresa desde la raíz.',
        `linaje.${indice}.tipo`
      );
    }
    if (!VISIBILIDADES.has(entrada.visibilidad)) {
      fallar(
        'visibilidad_linaje_invalida',
        'La referencia de linaje debe ser seleccionada u opaca.',
        `linaje.${indice}.visibilidad`
      );
    }
    let elementoOrigenId;
    try {
      elementoOrigenId = String(crearIdentidadFederada({
        tipo: TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN,
        valor: entrada.elementoOrigenId
      }));
    } catch {
      fallar(
        'identidad_ancestro_invalida',
        'El ancestro debe conservar una identidad federada de origen.',
        `linaje.${indice}.elementoOrigenId`
      );
    }
    return {
      tipo,
      elementoOrigenId,
      nombre: texto(entrada.nombre, 160, `linaje.${indice}.nombre`),
      visibilidad: entrada.visibilidad
    };
  });
}

function exigirPerfil(payload) {
  if (
    payload.perfil !== PERFIL_PAYLOAD_ESTRUCTURA_ORGANIZATIVA_FEDERACION ||
    payload.version !== VERSION_PAYLOAD_ESTRUCTURA_ORGANIZATIVA_FEDERACION
  ) {
    fallar(
      'version_payload_organizativo_incompatible',
      'El payload organizativo no usa el perfil y versión vigentes.'
    );
  }
}

function exigirTipo(valor) {
  if (!TIPOS_NODO.has(valor)) {
    fallar('tipo_nodo_organizativo_invalido', 'El tipo debe ser tenant, empresa o sitio.', 'tipo');
  }
  return valor;
}

function exigirClaves(valor, esperadas) {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) {
    fallar('forma_payload_organizativo_invalida', 'El payload contiene una estructura inválida.');
  }
  const actuales = Object.keys(valor).sort();
  const ordenadas = [...esperadas].sort();
  if (
    actuales.length !== ordenadas.length ||
    actuales.some((clave, indice) => clave !== ordenadas[indice])
  ) {
    fallar(
      'forma_payload_organizativo_invalida',
      'El payload organizativo contiene campos ausentes o desconocidos.'
    );
  }
}

function texto(valor, maximo, campo) {
  if (typeof valor !== 'string' || valor.length === 0 || valor.length > maximo ||
      valor !== valor.trim()) {
    fallar('texto_organizativo_invalido', `${campo} no es un texto canónico válido.`, campo);
  }
  return valor;
}

function textoOpcional(valor, maximo, campo) {
  if (valor === null) return null;
  return texto(valor, maximo, campo);
}

function fallar(codigo, mensaje, campo = null) {
  throw new ErrorPayloadEstructuraOrganizativaFederacion(codigo, mensaje, { campo });
}
