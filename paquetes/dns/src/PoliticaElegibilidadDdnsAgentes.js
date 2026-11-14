import { TIPOS_REGISTRO_DDNS_AGENTES } from './ContratoDdnsAgentes.js';

const TIPOS = new Set(TIPOS_REGISTRO_DDNS_AGENTES);

export const CAUSAS_INELEGIBILIDAD_DDNS_AGENTES = Object.freeze({
  CATEGORIA_AJENA: 'categoria_ajena',
  TIPO_NO_ADMITIDO: 'tipo_no_admitido',
  ZONA_NO_MASTER: 'zona_no_master',
  ZONA_NO_PUBLICABLE: 'zona_no_publicable',
  REGISTRO_NO_PUBLICABLE: 'registro_no_publicable',
  AUTORIDAD_TRIGGER: 'autoridad_trigger',
  CONCESION_VIGENTE: 'concesion_vigente'
});

export function evaluarElegibilidadConcesionDdnsAgentes({
  registro,
  zona,
  existeConcesionVigente = false
} = {}) {
  exigirObjeto(registro, 'registro');
  exigirObjeto(zona, 'zona');
  const causas = [];
  const categoria = String(
    registro.categoriaOrigen ?? registro.categoria_origen ?? ''
  ).toLowerCase();
  const tipo = String(
    registro.tipoRegistro ?? registro.tipo_registro ?? ''
  ).toUpperCase();
  const tipoZona = String(zona.tipoZona ?? zona.tipo_zona ?? '').toLowerCase();
  const publicarZona = booleano(zona.publicarEnBind ?? zona.publicar_en_bind);
  const zonaActiva = booleano(zona.activo);
  const publicarRegistro = booleano(
    registro.publicarEnBind ?? registro.publicar_en_bind
  );
  const registroActivo = booleano(registro.activo);
  const gobernanza = resolverGobernanza(registro);

  if (categoria !== 'ddns') causas.push(CAUSAS_INELEGIBILIDAD_DDNS_AGENTES.CATEGORIA_AJENA);
  if (!TIPOS.has(tipo)) causas.push(CAUSAS_INELEGIBILIDAD_DDNS_AGENTES.TIPO_NO_ADMITIDO);
  if (tipoZona !== 'master') causas.push(CAUSAS_INELEGIBILIDAD_DDNS_AGENTES.ZONA_NO_MASTER);
  if (!publicarZona || !zonaActiva) {
    causas.push(CAUSAS_INELEGIBILIDAD_DDNS_AGENTES.ZONA_NO_PUBLICABLE);
  }
  if (!publicarRegistro) {
    causas.push(CAUSAS_INELEGIBILIDAD_DDNS_AGENTES.REGISTRO_NO_PUBLICABLE);
  }
  if (gobernanza?.gobernadoPor === 'trigger') {
    causas.push(CAUSAS_INELEGIBILIDAD_DDNS_AGENTES.AUTORIDAD_TRIGGER);
  }
  if (existeConcesionVigente === true) {
    causas.push(CAUSAS_INELEGIBILIDAD_DDNS_AGENTES.CONCESION_VIGENTE);
  }

  const elegible = causas.length === 0;
  return Object.freeze({
    elegible,
    operable: elegible && registroActivo,
    causas: Object.freeze(causas),
    tipo: TIPOS.has(tipo) ? tipo : null,
    estadoRegistro: registroActivo ? 'activo' : 'inactivo',
    legadoDdnsAutoritativo: false
  });
}

function resolverGobernanza(registro) {
  if (typeof registro.resolverGobernanzaAutomatica === 'function') {
    return registro.resolverGobernanzaAutomatica();
  }
  const datos = parsearJson(registro.datosAuxiliares ?? registro.datos_auxiliares);
  const gobernadoPor = String(datos?.gobernadoPor || '').trim().toLowerCase();
  return gobernadoPor ? { gobernadoPor } : null;
}

function parsearJson(valor) {
  if (!valor) return null;
  if (typeof valor === 'object' && !Array.isArray(valor)) return valor;
  try {
    const resultado = JSON.parse(valor);
    return resultado && typeof resultado === 'object' && !Array.isArray(resultado)
      ? resultado
      : null;
  } catch {
    return null;
  }
}

function booleano(valor) {
  return valor === true || valor === 1 || valor === '1';
}

function exigirObjeto(valor, nombre) {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) {
    throw new TypeError(`${nombre} es obligatorio para evaluar DDNS.`);
  }
}
