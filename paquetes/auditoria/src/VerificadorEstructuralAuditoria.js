import { timingSafeEqual } from 'node:crypto';
import { esClaveCadenaAuditoria } from './CatalogoAuditoria.js';

import {
  REGISTRO_CANONICALIZADORES_AUDITORIA,
  REGISTRO_ENCADENADORES_AUDITORIA,
  REGISTRO_VALIDADORES_CONTRATO_AUDITORIA,
  obtenerHashGenesisAuditoriaV1,
  prepararEventoEncadenadoAuditoriaV1
} from './SobreCanonicoAuditoria.js';

export const ESTADOS_VERIFICACION_ESTRUCTURAL_AUDITORIA = Object.freeze([
  'integra',
  'rota',
  'incompleta',
  'version_no_verificable'
]);

export class VerificadorEstructuralAuditoria {
  constructor({ repositorio } = {}) {
    if (typeof repositorio?.obtenerCadenaEstructural !== 'function') {
      throw new Error('El verificador estructural requiere un repositorio de lectura.');
    }
    this.repositorio = repositorio;
  }

  async verificar({ claveCadena } = {}) {
    const clave = validarClaveCadena(claveCadena);
    const lectura = await this.repositorio.obtenerCadenaEstructural({
      claveCadena: clave
    });
    return verificarEstructuraCadenaAuditoria({ ...lectura, claveCadena: clave });
  }
}

export function verificarEstructuraCadenaAuditoria({
  claveCadena,
  cabecera,
  eventos
} = {}) {
  const clave = validarClaveCadena(claveCadena);
  validarLectura(cabecera, eventos, clave);
  const ultimaSecuencia = BigInt(cabecera.ultimaSecuencia);
  let secuenciaEsperada = 1n;
  let hashEsperado = obtenerHashGenesisAuditoriaV1();
  let hashVerificado = null;

  for (let indice = 0; indice < eventos.length; indice += 1) {
    const evento = eventos[indice];
    const posicion = String(indice + 1);
    const sobre = evento?.sobre;
    const secuenciaObservada = obtenerSecuencia(sobre?.secuencia);
    if (secuenciaObservada === null || secuenciaObservada !== secuenciaEsperada) {
      return resultadoIncidencia({
        estado: 'rota',
        claveCadena: clave,
        eventosLeidos: eventos.length,
        secuenciaVerificadaHasta: secuenciaEsperada - 1n,
        hashVerificado,
        codigo: 'secuencia_inesperada',
        posicion,
        secuenciaEsperada,
        secuenciaObservada: sobre?.secuencia ?? null
      });
    }
    if (secuenciaEsperada === 1n && sobre?.tipo !== 'cadena.iniciada') {
      return resultadoIncidencia({
        estado: 'rota', claveCadena: clave, eventosLeidos: eventos.length,
        secuenciaVerificadaHasta: 0n, hashVerificado,
        codigo: 'genesis_ausente', posicion, secuenciaEsperada,
        secuenciaObservada: sobre?.secuencia ?? null
      });
    }
    if (sobre?.claveCadena !== clave) {
      return resultadoIncidencia({
        estado: 'rota', claveCadena: clave, eventosLeidos: eventos.length,
        secuenciaVerificadaHasta: secuenciaEsperada - 1n, hashVerificado,
        codigo: 'clave_cadena_incoherente', posicion, secuenciaEsperada,
        secuenciaObservada: sobre?.secuencia ?? null
      });
    }
    const version = detectarVersionNoVerificable(sobre);
    if (version) {
      return resultadoIncidencia({
        estado: 'version_no_verificable', claveCadena: clave,
        eventosLeidos: eventos.length,
        secuenciaVerificadaHasta: secuenciaEsperada - 1n, hashVerificado,
        codigo: version.codigo, posicion, secuenciaEsperada,
        secuenciaObservada: sobre?.secuencia ?? null,
        versiones: version.versiones
      });
    }
    const hashAnterior = leerHash(evento?.hashAnterior);
    if (!hashAnterior || !hashIgual(hashAnterior, hashEsperado)) {
      return resultadoIncidencia({
        estado: 'rota', claveCadena: clave, eventosLeidos: eventos.length,
        secuenciaVerificadaHasta: secuenciaEsperada - 1n, hashVerificado,
        codigo: hashAnterior ? 'hash_anterior_incoherente' : 'hash_anterior_invalido',
        posicion, secuenciaEsperada, secuenciaObservada: sobre?.secuencia ?? null
      });
    }
    let preparado;
    try {
      preparado = prepararEventoEncadenadoAuditoriaV1(sobre, {
        hashAnterior: hashEsperado
      });
    } catch {
      return resultadoIncidencia({
        estado: 'rota', claveCadena: clave, eventosLeidos: eventos.length,
        secuenciaVerificadaHasta: secuenciaEsperada - 1n, hashVerificado,
        codigo: 'sobre_invalido', posicion, secuenciaEsperada,
        secuenciaObservada: sobre?.secuencia ?? null
      });
    }
    const hashPayload = leerHash(evento?.hashPayload);
    if (!hashPayload || !hashIgual(hashPayload, preparado.hashPayload)) {
      return resultadoIncidencia({
        estado: 'rota', claveCadena: clave, eventosLeidos: eventos.length,
        secuenciaVerificadaHasta: secuenciaEsperada - 1n, hashVerificado,
        codigo: hashPayload ? 'hash_payload_incoherente' : 'hash_payload_invalido',
        posicion, secuenciaEsperada, secuenciaObservada: sobre.secuencia
      });
    }
    const hashActual = leerHash(evento?.hashActual);
    if (!hashActual || !hashIgual(hashActual, preparado.hashActual)) {
      return resultadoIncidencia({
        estado: 'rota', claveCadena: clave, eventosLeidos: eventos.length,
        secuenciaVerificadaHasta: secuenciaEsperada - 1n, hashVerificado,
        codigo: hashActual ? 'hash_actual_incoherente' : 'hash_actual_invalido',
        posicion, secuenciaEsperada, secuenciaObservada: sobre.secuencia
      });
    }
    hashEsperado = hashActual;
    hashVerificado = hashActual;
    secuenciaEsperada += 1n;
  }

  const secuenciaVerificada = secuenciaEsperada - 1n;
  if (secuenciaVerificada < ultimaSecuencia) {
    return resultadoIncidencia({
      estado: 'incompleta', claveCadena: clave, eventosLeidos: eventos.length,
      secuenciaVerificadaHasta: secuenciaVerificada, hashVerificado,
      codigo: 'fin_prematuro', posicion: String(eventos.length + 1),
      secuenciaEsperada, secuenciaObservada: null
    });
  }
  const hashCabecera = leerHash(cabecera.ultimoHash);
  if (secuenciaVerificada !== ultimaSecuencia || !hashCabecera ||
      !hashVerificado || !hashIgual(hashCabecera, hashVerificado)) {
    return resultadoIncidencia({
      estado: 'rota', claveCadena: clave, eventosLeidos: eventos.length,
      secuenciaVerificadaHasta: secuenciaVerificada, hashVerificado,
      codigo: 'cabecera_incoherente', posicion: String(eventos.length),
      secuenciaEsperada: ultimaSecuencia,
      secuenciaObservada: String(secuenciaVerificada)
    });
  }
  return congelarResultado({
    estado: 'integra',
    claveCadena: clave,
    eventosLeidos: eventos.length,
    secuenciaVerificadaHasta: String(secuenciaVerificada),
    hashVerificadoHasta: hashVerificado.toString('hex'),
    incidencia: null
  });
}

function detectarVersionNoVerificable(sobre) {
  if (!sobre || typeof sobre !== 'object' || Array.isArray(sobre)) return null;
  const versiones = {
    contrato: sobre.versionContrato ?? null,
    canonicalizador: sobre.versionCanonicalizador ?? null,
    encadenado: sobre.versionEncadenado ?? null
  };
  if (versiones.contrato != null &&
      !Object.hasOwn(REGISTRO_VALIDADORES_CONTRATO_AUDITORIA, versiones.contrato)) {
    return { codigo: 'version_contrato_no_verificable', versiones };
  }
  if (typeof versiones.canonicalizador === 'string' &&
      !Object.hasOwn(REGISTRO_CANONICALIZADORES_AUDITORIA, versiones.canonicalizador)) {
    return { codigo: 'version_canonicalizador_no_verificable', versiones };
  }
  if (typeof versiones.encadenado === 'string' &&
      !Object.hasOwn(REGISTRO_ENCADENADORES_AUDITORIA, versiones.encadenado)) {
    return { codigo: 'version_encadenado_no_verificable', versiones };
  }
  return null;
}

function validarLectura(cabecera, eventos, claveCadena) {
  if (!cabecera || typeof cabecera !== 'object' || Array.isArray(cabecera) ||
      cabecera.claveCadena !== claveCadena ||
      !/^[1-9][0-9]*$/.test(String(cabecera.ultimaSecuencia ?? ''))) {
    throw new Error('La cabecera estructural de auditoría no es válida.');
  }
  if (!Array.isArray(eventos)) {
    throw new Error('La lectura estructural debe proporcionar un array de eventos.');
  }
}

function resultadoIncidencia({
  estado, claveCadena, eventosLeidos, secuenciaVerificadaHasta, hashVerificado,
  codigo, posicion, secuenciaEsperada, secuenciaObservada, versiones
}) {
  const incidencia = {
    codigo,
    posicion,
    secuenciaEsperada: String(secuenciaEsperada),
    secuenciaObservada: secuenciaObservada == null ? null : String(secuenciaObservada)
  };
  if (versiones) incidencia.versiones = { ...versiones };
  return congelarResultado({
    estado,
    claveCadena,
    eventosLeidos,
    secuenciaVerificadaHasta: String(secuenciaVerificadaHasta),
    hashVerificadoHasta: hashVerificado?.toString('hex') ?? null,
    incidencia
  });
}

function congelarResultado(resultado) {
  if (resultado.incidencia?.versiones) Object.freeze(resultado.incidencia.versiones);
  if (resultado.incidencia) Object.freeze(resultado.incidencia);
  return Object.freeze(resultado);
}

function leerHash(valor) {
  if (!(valor instanceof Uint8Array) || valor.byteLength !== 32) return null;
  return Buffer.from(valor);
}

function hashIgual(a, b) {
  return a.length === b.length && timingSafeEqual(a, b);
}

function obtenerSecuencia(valor) {
  const texto = String(valor ?? '');
  if (!/^[1-9][0-9]*$/.test(texto)) return null;
  try { return BigInt(texto); } catch { return null; }
}

function validarClaveCadena(valor) {
  const texto = String(valor ?? '');
  if (!esClaveCadenaAuditoria(texto)) {
    throw new Error('claveCadena no pertenece al catálogo auditable.');
  }
  return texto;
}
