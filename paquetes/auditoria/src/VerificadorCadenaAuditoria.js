import { isDeepStrictEqual } from 'node:util';
import {
  REGISTRO_ENCADENADORES_AUDITORIA,
  hashAuditoriaAHex
} from './SobreCanonicoAuditoria.js';

export const ESTADOS_VERIFICACION_CADENA_AUDITORIA = Object.freeze({
  INTEGRA: 'integra',
  ROTA: 'rota',
  INCOMPLETA: 'incompleta',
  CONCURRENTE: 'concurrente',
  SIN_DATOS: 'sin_datos'
});

const ESTADOS = new Set(Object.values(ESTADOS_VERIFICACION_CADENA_AUDITORIA));
const TAMANO_LOTE_DEFECTO = 500;
const TAMANO_LOTE_MAXIMO = 5000;

export class VerificadorCadenaAuditoria {
  constructor({ repositorio, tamanoLote = TAMANO_LOTE_DEFECTO } = {}) {
    if (!repositorio?.fijarAnclas || !repositorio?.leerPaginaEventos || !repositorio?.confirmarAnclas) {
      throw new Error('VerificadorCadenaAuditoria requiere un repositorio de verificación completo.');
    }
    if (
      !Number.isInteger(tamanoLote) ||
      tamanoLote < 1 ||
      tamanoLote > TAMANO_LOTE_MAXIMO
    ) {
      throw new Error(`tamanoLote debe estar entre 1 y ${TAMANO_LOTE_MAXIMO}.`);
    }
    this.repositorio = repositorio;
    this.tamanoLote = tamanoLote;
  }

  async verificarCadena(parametros = {}) {
    if (!parametros.__lecturaConsistente && this.repositorio.ejecutarLecturaConsistente) {
      return this.repositorio.ejecutarLecturaConsistente((repositorio) =>
        new VerificadorCadenaAuditoria({
          repositorio,
          tamanoLote: this.tamanoLote
        }).verificarCadena({ ...parametros, __lecturaConsistente: true })
      );
    }

    const anclas = await this.repositorio.fijarAnclas(normalizarParametros(parametros));
    if (anclas.estadoInicial === ESTADOS_VERIFICACION_CADENA_AUDITORIA.SIN_DATOS) {
      return congelarResultado({
        estado: ESTADOS_VERIFICACION_CADENA_AUDITORIA.SIN_DATOS,
        claveCadena: anclas.claveCadena,
        intervalo: construirIntervalo(anclas),
        paginas: 0,
        eventosVerificados: 0,
        ultimoHashVerificado: anclas.hashAnteriorHex ?? null,
        hashFinalEsperado: anclas.hashFinalEsperadoHex ?? null,
        anclas: resumirAnclas(anclas),
        incidencias: [{
          codigo: 'cadena_sin_datos',
          mensaje: 'No existe una cadena verificable para las anclas solicitadas.'
        }]
      });
    }

    let estado = ESTADOS_VERIFICACION_CADENA_AUDITORIA.INTEGRA;
    const incidencias = [];
    let paginas = 0;
    let eventosVerificados = 0;
    let cursor = BigInt(anclas.desdeSecuencia) - 1n;
    let hashAnterior = normalizarHash(anclas.hashAnterior, 'hashAnterior inicial');
    let ultimoHashVerificado = hashAnterior;
    let ultimaSecuenciaVerificada = cursor;
    const hasta = BigInt(anclas.hastaSecuencia);

    while (cursor < hasta && estado === ESTADOS_VERIFICACION_CADENA_AUDITORIA.INTEGRA) {
      const pagina = await this.repositorio.leerPaginaEventos({
        claveCadena: anclas.claveCadena,
        desdeExclusiva: String(cursor),
        hastaInclusiva: String(hasta),
        limite: this.tamanoLote
      });
      paginas += 1;
      if (!Array.isArray(pagina) || pagina.length === 0) {
        estado = ESTADOS_VERIFICACION_CADENA_AUDITORIA.INCOMPLETA;
        incidencias.push({
          codigo: 'pagina_vacia_antes_fin',
          secuenciaEsperada: String(cursor + 1n),
          mensaje: 'El repositorio no devolvió el siguiente tramo de la cadena.'
        });
        break;
      }

      for (const evento of pagina) {
        const esperado = cursor + 1n;
        const secuencia = BigInt(evento.secuencia);
        if (secuencia !== esperado) {
          estado = ESTADOS_VERIFICACION_CADENA_AUDITORIA.INCOMPLETA;
          incidencias.push({
            codigo: 'hueco_secuencia',
            secuenciaEsperada: String(esperado),
            secuenciaObservada: String(secuencia),
            mensaje: 'La página no conserva una secuencia consecutiva.'
          });
          break;
        }

        const hashAnteriorEvento = normalizarHash(evento.hashAnterior, 'hashAnterior evento');
        if (!hashAnteriorEvento.equals(hashAnterior)) {
          estado = ESTADOS_VERIFICACION_CADENA_AUDITORIA.ROTA;
          incidencias.push({
            codigo: 'hash_anterior_incoherente',
            secuencia: String(secuencia),
            esperado: hashAuditoriaAHex(hashAnterior),
            observado: hashAuditoriaAHex(hashAnteriorEvento),
            mensaje: 'El evento no enlaza con el hash validado anterior.'
          });
          break;
        }

        const recalculado = recalcularEvento(evento, hashAnterior);
        const hashActual = normalizarHash(evento.hashActual, 'hashActual evento');
        if (
          !hashActual.equals(recalculado.hashActual) ||
          !normalizarHash(evento.hashPayload, 'hashPayload evento').equals(recalculado.hashPayload)
        ) {
          estado = ESTADOS_VERIFICACION_CADENA_AUDITORIA.ROTA;
          incidencias.push({
            codigo: 'hash_evento_incoherente',
            secuencia: String(secuencia),
            esperado: hashAuditoriaAHex(recalculado.hashActual),
            observado: hashAuditoriaAHex(hashActual),
            mensaje: 'El evento no coincide con su canonicalización y encadenado declarados.'
          });
          break;
        }

        cursor = secuencia;
        ultimaSecuenciaVerificada = secuencia;
        hashAnterior = hashActual;
        ultimoHashVerificado = hashActual;
        eventosVerificados += 1;
      }
    }

    if (estado === ESTADOS_VERIFICACION_CADENA_AUDITORIA.INTEGRA) {
      const hashFinalEsperado = normalizarHash(anclas.hashFinalEsperado, 'hashFinalEsperado');
      if (!ultimoHashVerificado.equals(hashFinalEsperado)) {
        estado = ESTADOS_VERIFICACION_CADENA_AUDITORIA.ROTA;
        incidencias.push({
          codigo: 'hash_final_incoherente',
          esperado: hashAuditoriaAHex(hashFinalEsperado),
          observado: hashAuditoriaAHex(ultimoHashVerificado),
          mensaje: 'El último hash validado no coincide con la ancla final fijada.'
        });
      }
    }

    const confirmacion = await this.repositorio.confirmarAnclas(anclas);
    if (
      estado === ESTADOS_VERIFICACION_CADENA_AUDITORIA.INTEGRA &&
      confirmacion?.estable === false
    ) {
      estado = ESTADOS_VERIFICACION_CADENA_AUDITORIA.CONCURRENTE;
      incidencias.push({
        codigo: confirmacion.codigo || 'anclas_modificadas',
        mensaje: confirmacion.mensaje || 'Las anclas observadas cambiaron durante la verificación.'
      });
    }

    exigirEstadoConocido(estado);
    return congelarResultado({
      estado,
      claveCadena: anclas.claveCadena,
      intervalo: {
        desdeSecuencia: anclas.desdeSecuencia,
        hastaSecuencia: anclas.hastaSecuencia,
        ultimaSecuenciaVerificada: String(ultimaSecuenciaVerificada)
      },
      paginas,
      eventosVerificados,
      ultimoHashVerificado: hashAuditoriaAHex(ultimoHashVerificado),
      hashFinalEsperado: anclas.hashFinalEsperadoHex ?? hashAuditoriaAHex(anclas.hashFinalEsperado),
      anclas: resumirAnclas(anclas),
      incidencias
    });
  }
}

function normalizarParametros(parametros = {}) {
  return Object.freeze({
    claveCadena: exigirTexto(parametros.claveCadena, 'claveCadena'),
    desdeSecuencia: parametros.desdeSecuencia == null
      ? null
      : exigirSecuencia(parametros.desdeSecuencia, 'desdeSecuencia'),
    hastaSecuencia: parametros.hastaSecuencia == null
      ? null
      : exigirSecuencia(parametros.hastaSecuencia, 'hastaSecuencia'),
    usarCheckpoint: parametros.usarCheckpoint === true
  });
}

function recalcularEvento(evento, hashAnterior) {
  if (!evento?.sobre) throw new Error('El evento verificable debe incluir su sobre reconstruido.');
  const encadenador = REGISTRO_ENCADENADORES_AUDITORIA[evento.sobre.versionEncadenado];
  if (!encadenador) {
    throw new Error(`Encadenador no soportado: ${evento.sobre.versionEncadenado}.`);
  }
  return encadenador.prepararEvento(evento.sobre, { hashAnterior });
}

function normalizarHash(valor, nombre) {
  if (Buffer.isBuffer(valor) && valor.length === 32) return Buffer.from(valor);
  if (valor instanceof Uint8Array && valor.byteLength === 32) return Buffer.from(valor);
  if (typeof valor === 'string' && /^[0-9a-f]{64}$/i.test(valor)) {
    return Buffer.from(valor, 'hex');
  }
  throw new Error(`${nombre} debe ser un hash SHA-256 de 32 bytes o hexadecimal canónico.`);
}

function exigirTexto(valor, nombre) {
  if (typeof valor !== 'string' || valor.length === 0) {
    throw new Error(`${nombre} debe ser un texto no vacío.`);
  }
  return valor;
}

function exigirSecuencia(valor, nombre) {
  const texto = String(valor);
  if (!/^[1-9][0-9]*$/.test(texto)) {
    throw new Error(`${nombre} debe ser una secuencia positiva en decimal canónico.`);
  }
  return texto;
}

function exigirEstadoConocido(estado) {
  if (!ESTADOS.has(estado)) {
    throw new Error(`Estado de verificación desconocido: ${estado}.`);
  }
}

function construirIntervalo(anclas = {}) {
  return Object.freeze({
    desdeSecuencia: anclas.desdeSecuencia ?? null,
    hastaSecuencia: anclas.hastaSecuencia ?? null,
    ultimaSecuenciaVerificada: anclas.desdeSecuencia == null
      ? null
      : String(BigInt(anclas.desdeSecuencia) - 1n)
  });
}

function resumirAnclas(anclas = {}) {
  return Object.freeze({
    claveCadena: anclas.claveCadena ?? null,
    desdeSecuencia: anclas.desdeSecuencia ?? null,
    hastaSecuencia: anclas.hastaSecuencia ?? null,
    hashAnterior: anclas.hashAnteriorHex ?? (
      anclas.hashAnterior ? hashAuditoriaAHex(anclas.hashAnterior) : null
    ),
    hashFinalEsperado: anclas.hashFinalEsperadoHex ?? (
      anclas.hashFinalEsperado ? hashAuditoriaAHex(anclas.hashFinalEsperado) : null
    ),
    cabecera: anclas.cabeceraInicial
      ? Object.freeze({
        ultimaSecuencia: String(anclas.cabeceraInicial.ultimaSecuencia),
        ultimoHash: hashAuditoriaAHex(anclas.cabeceraInicial.ultimoHash)
      })
      : null,
    checkpoint: anclas.checkpointInicial
      ? Object.freeze({
        ultimaSecuenciaRetirada: String(anclas.checkpointInicial.ultimaSecuenciaRetirada),
        hashUltimaSecuenciaRetirada: hashAuditoriaAHex(
          anclas.checkpointInicial.hashUltimaSecuenciaRetirada
        ),
        primeraSecuenciaConservada: anclas.checkpointInicial.primeraSecuenciaConservada == null
          ? null
          : String(anclas.checkpointInicial.primeraSecuenciaConservada)
      })
      : null
  });
}

function congelarResultado(resultado) {
  const copia = {
    ...resultado,
    estadosOperativos: Object.freeze([...ESTADOS])
  };
  congelarProfundo(copia);
  return copia;
}

function congelarProfundo(valor) {
  if (ArrayBuffer.isView(valor)) return valor;
  if (valor && typeof valor === 'object' && !Object.isFrozen(valor)) {
    for (const contenido of Object.values(valor)) congelarProfundo(contenido);
    Object.freeze(valor);
  }
  return valor;
}

export function assertResultadoVerificacionCadena(actual, esperado) {
  if (!isDeepStrictEqual(actual, esperado)) {
    throw new Error('El resultado de verificación de cadena no coincide con el esperado.');
  }
}
