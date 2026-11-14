import {
  LIMITES_DUROS_RECURSOS_FEDERACION
} from '../src/ConfiguracionFederacion.js';
import { normalizarEndpointFederacion } from '../src/RelacionFederacion.js';
import {
  TIPOS_IDENTIDAD_FEDERADA,
  crearIdentidadFederada
} from '../src/IdentidadFederada.js';

const MAX_RESPUESTA_CONTROL_BYTES = 1024 * 1024;
const MAX_RESPUESTA_LOTE_BYTES =
  LIMITES_DUROS_RECURSOS_FEDERACION.loteMaximoBytes + 4 * 1024 * 1024;
const MAX_PETICION_LOTE_BYTES =
  LIMITES_DUROS_RECURSOS_FEDERACION.loteMaximoBytes + 3 * 1024 * 1024;

export class ErrorClienteHttpFederacion extends Error {
  constructor(codigo, mensaje, {
    statusCode = null,
    codigoRemoto = null,
    reintentable = false,
    capacidad = null
  } = {}) {
    super(mensaje);
    this.name = 'ErrorClienteHttpFederacion';
    this.codigo = codigo;
    this.statusCode = statusCode;
    this.codigoRemoto = codigoRemoto;
    this.reintentable = reintentable;
    this.capacidad = capacidad;
  }
}

export class ClienteHttpDatosFederacion {
  constructor({ fetchImpl = globalThis.fetch, timeoutMs = 10000 } = {}) {
    if (typeof fetchImpl !== 'function') {
      throw new Error('El cliente federado requiere una implementación fetch.');
    }
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 300000) {
      throw new Error('El timeout federado debe estar entre 10 y 300000 ms.');
    }
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  obtenerCapacidad({ destino, token } = {}) {
    return this.#solicitar({
      destino,
      token,
      metodo: 'GET',
      ruta: '/api/federacion/v1/datos/capacidad',
      maxRespuestaBytes: MAX_RESPUESTA_CONTROL_BYTES
    });
  }

  canjearInvitacion({ destino, solicitud } = {}) {
    return this.#solicitar({
      destino,
      metodo: 'POST',
      ruta: '/api/federacion/v1/establecimiento/canje',
      cuerpo: solicitud,
      maxPeticionBytes: MAX_RESPUESTA_CONTROL_BYTES,
      maxRespuestaBytes: MAX_RESPUESTA_CONTROL_BYTES,
      requiereBearer: false,
      statusEsperado: 201
    });
  }

  canjearRecuperacion({ destino, solicitud } = {}) {
    return this.#solicitar({
      destino,
      metodo: 'POST',
      ruta: '/api/federacion/v1/continuidad/recuperacion/canje',
      cuerpo: solicitud,
      maxPeticionBytes: MAX_RESPUESTA_CONTROL_BYTES,
      maxRespuestaBytes: MAX_RESPUESTA_CONTROL_BYTES,
      requiereBearer: false
    });
  }

  iniciarSesion({ destino, solicitud } = {}) {
    return this.#solicitar({
      destino,
      metodo: 'POST',
      ruta: '/api/federacion/v1/sesion/login',
      cuerpo: solicitud,
      maxPeticionBytes: MAX_RESPUESTA_CONTROL_BYTES,
      maxRespuestaBytes: MAX_RESPUESTA_CONTROL_BYTES,
      requiereBearer: false
    });
  }

  refrescarSesion({ destino, token, solicitud } = {}) {
    return this.#solicitar({
      destino,
      token,
      metodo: 'POST',
      ruta: '/api/federacion/v1/sesion/refresh',
      cuerpo: solicitud,
      maxPeticionBytes: MAX_RESPUESTA_CONTROL_BYTES,
      maxRespuestaBytes: MAX_RESPUESTA_CONTROL_BYTES
    });
  }

  registrarHeartbeat({ destino, token, solicitud } = {}) {
    return this.#solicitar({
      destino,
      token,
      metodo: 'POST',
      ruta: '/api/federacion/v1/sesion/heartbeat',
      cuerpo: solicitud,
      maxPeticionBytes: MAX_RESPUESTA_CONTROL_BYTES,
      maxRespuestaBytes: MAX_RESPUESTA_CONTROL_BYTES
    });
  }

  publicarDeclaracionConcesion({ destino, token, declaracion } = {}) {
    return this.#solicitar({
      destino,
      token,
      metodo: 'POST',
      ruta: '/api/federacion/v1/control/concesion/declaraciones',
      cuerpo: declaracion,
      maxPeticionBytes: MAX_RESPUESTA_CONTROL_BYTES,
      maxRespuestaBytes: MAX_RESPUESTA_CONTROL_BYTES,
      statusEsperado: [200, 201]
    });
  }

  publicarManifiestoFlujoInicial({ destino, token, manifiesto } = {}) {
    return this.#solicitar({
      destino,
      token,
      metodo: 'POST',
      ruta: '/api/federacion/v1/control/flujos/manifiestos-iniciales',
      cuerpo: manifiesto,
      maxPeticionBytes: MAX_RESPUESTA_CONTROL_BYTES,
      maxRespuestaBytes: MAX_RESPUESTA_CONTROL_BYTES
    });
  }

  consultarManifiestosFlujosIniciales({ destino, token, relacionId } = {}) {
    return this.#solicitar({
      destino,
      token,
      metodo: 'GET',
      ruta: `/api/federacion/v1/control/flujos/relaciones/${segmento(
        relacionId, TIPOS_IDENTIDAD_FEDERADA.RELACION
      )}/manifiestos-iniciales`,
      maxPeticionBytes: MAX_RESPUESTA_CONTROL_BYTES,
      maxRespuestaBytes: MAX_RESPUESTA_CONTROL_BYTES
    });
  }

  consultarConfirmacionConcesion({
    destino,
    token,
    relacionId,
    intercambioId
  } = {}) {
    return this.#solicitar({
      destino,
      token,
      metodo: 'GET',
      ruta: `/api/federacion/v1/control/concesion/relaciones/${segmento(
        relacionId,
        TIPOS_IDENTIDAD_FEDERADA.RELACION
      )}/intercambios/${segmentoUuid(intercambioId)}`,
      maxRespuestaBytes: MAX_RESPUESTA_CONTROL_BYTES
    });
  }

  entregarLote({ destino, token, lote } = {}) {
    return this.#solicitar({
      destino,
      token,
      metodo: 'POST',
      ruta: '/api/federacion/v1/datos/lotes',
      cuerpo: lote,
      maxPeticionBytes: MAX_PETICION_LOTE_BYTES,
      maxRespuestaBytes: MAX_RESPUESTA_LOTE_BYTES
    });
  }

  obtenerProgreso({ destino, token, flujoId, generacionId } = {}) {
    return this.#solicitar({
      destino,
      token,
      metodo: 'GET',
      ruta: `/api/federacion/v1/datos/flujos/${segmento(
        flujoId,
        TIPOS_IDENTIDAD_FEDERADA.FLUJO
      )}/generaciones/${segmento(
        generacionId,
        TIPOS_IDENTIDAD_FEDERADA.GENERACION
      )}/progreso`,
      maxRespuestaBytes: MAX_RESPUESTA_CONTROL_BYTES
    });
  }

  registrarDisponibilidad({
    destino,
    token,
    flujoId,
    generacionId,
    declaracion
  } = {}) {
    return this.#solicitar({
      destino,
      token,
      metodo: 'POST',
      ruta: rutaDisponibilidad(flujoId, generacionId),
      cuerpo: declaracion,
      maxPeticionBytes: MAX_RESPUESTA_CONTROL_BYTES,
      maxRespuestaBytes: MAX_RESPUESTA_CONTROL_BYTES
    });
  }

  listarDisponibilidad({ destino, token, flujoId, generacionId } = {}) {
    return this.#solicitar({
      destino,
      token,
      metodo: 'GET',
      ruta: rutaDisponibilidad(flujoId, generacionId),
      maxRespuestaBytes: MAX_RESPUESTA_CONTROL_BYTES
    });
  }

  async #solicitar({
    destino,
    token,
    metodo,
    ruta,
    cuerpo = undefined,
    maxPeticionBytes = 0,
    maxRespuestaBytes,
    requiereBearer = true,
    statusEsperado = 200
  }) {
    const endpoint = validarDestino(destino);
    const bearer = requiereBearer ? validarBearer(token) : null;
    let cuerpoSerializado;
    if (cuerpo !== undefined) {
      try {
        cuerpoSerializado = JSON.stringify(cuerpo);
      } catch {
        throw new ErrorClienteHttpFederacion(
          'peticion_federada_no_representable',
          'La petición federada no puede representarse como JSON.'
        );
      }
      if (cuerpoSerializado === undefined ||
          Buffer.byteLength(cuerpoSerializado, 'utf8') > maxPeticionBytes) {
        throw new ErrorClienteHttpFederacion(
          'peticion_federada_excede_limite_fisico',
          'La petición supera el límite físico del transporte.'
        );
      }
    }
    const abortador = new AbortController();
    const timeout = setTimeout(() => abortador.abort(), this.timeoutMs);
    try {
      let respuesta;
      try {
        respuesta = await this.fetchImpl(`${endpoint}${ruta}`, {
          method: metodo,
          headers: {
            accept: 'application/json, application/problem+json',
            ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
            ...(cuerpoSerializado === undefined
              ? {}
              : { 'content-type': 'application/json' })
          },
          body: cuerpoSerializado,
          cache: 'no-store',
          redirect: 'error',
          signal: abortador.signal
        });
      } catch (error) {
        if (abortador.signal.aborted || error?.name === 'AbortError') {
          throw errorTimeout();
        }
        throw new ErrorClienteHttpFederacion(
          'transporte_federado_no_disponible',
          'No se pudo establecer el transporte con el receptor aprobado.',
          { reintentable: true }
        );
      }
      let json;
      try {
        const tipoContenido = String(
          respuesta.headers?.get?.('content-type') || ''
        ).toLowerCase();
        if (!/^(application\/json|application\/problem\+json)(?:;|$)/u
          .test(tipoContenido)) {
          throw respuestaInvalida();
        }
        json = await leerJsonAcotado(respuesta, maxRespuestaBytes);
      } catch (error) {
        if (abortador.signal.aborted) throw errorTimeout();
        throw error;
      }
      if (!respuesta.ok) {
        throw new ErrorClienteHttpFederacion(
          'respuesta_http_federada_rechazada',
          'El receptor federado rechazó la operación.',
          {
            statusCode: respuesta.status,
            codigoRemoto: codigoRemotoSaneado(json?.codigo),
            reintentable: respuesta.status === 429 || respuesta.status >= 500,
            capacidad: respuesta.status === 413
              ? capacidadRemotaSaneada(json?.capacidad)
              : null
          }
        );
      }
      const estadosEsperados = Array.isArray(statusEsperado)
        ? statusEsperado
        : [statusEsperado];
      if (!estadosEsperados.includes(respuesta.status)) throw respuestaInvalida();
      if (!json || typeof json !== 'object' || Array.isArray(json)) {
        throw respuestaInvalida();
      }
      return Object.freeze(json);
    } finally {
      clearTimeout(timeout);
    }
  }
}

function segmentoUuid(valor) {
  const texto = String(valor || '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
    .test(texto)) {
    throw new ErrorClienteHttpFederacion(
      'identidad_ruta_federada_invalida',
      'La identidad de intercambio no es canónica.'
    );
  }
  return encodeURIComponent(texto);
}

async function leerJsonAcotado(respuesta, maximoBytes) {
  const longitud = respuesta.headers?.get?.('content-length');
  if (longitud && /^[0-9]+$/u.test(longitud) &&
      BigInt(longitud) > BigInt(maximoBytes)) {
    await respuesta.body?.cancel?.().catch(() => {});
    throw respuestaInvalida();
  }
  if (!respuesta.body?.getReader) throw respuestaInvalida();
  const lector = respuesta.body.getReader();
  const fragmentos = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await lector.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximoBytes) throw respuestaInvalida();
      fragmentos.push(Buffer.from(value));
    }
  } catch (error) {
    await lector.cancel?.().catch(() => {});
    if (error instanceof ErrorClienteHttpFederacion) throw error;
    throw respuestaInvalida();
  }
  try {
    return JSON.parse(Buffer.concat(fragmentos, total).toString('utf8'));
  } catch {
    throw respuestaInvalida();
  }
}

function validarDestino(destino) {
  if (!destino || typeof destino !== 'object' || Array.isArray(destino) ||
      typeof destino.relacionId !== 'string' ||
      typeof destino.installationRemotaId !== 'string') {
    throw new ErrorClienteHttpFederacion(
      'destino_federado_no_aprobado',
      'El transporte exige un destino resuelto desde una relación aprobada.'
    );
  }
  try {
    identidad(destino.relacionId, TIPOS_IDENTIDAD_FEDERADA.RELACION);
    identidad(destino.installationRemotaId, TIPOS_IDENTIDAD_FEDERADA.INSTALACION);
  } catch {
    throw new ErrorClienteHttpFederacion(
      'destino_federado_no_aprobado',
      'El transporte exige un destino resuelto desde una relación aprobada.'
    );
  }
  return normalizarEndpointFederacion(destino.endpoint);
}

function validarBearer(token) {
  if (typeof token !== 'string' || !/^sfop1_[A-Za-z0-9_-]{64}$/u.test(token)) {
    throw new ErrorClienteHttpFederacion(
      'credencial_operativa_federada_invalida',
      'El transporte exige una credencial operativa válida.'
    );
  }
  return token;
}

function segmento(valor, tipo) {
  try {
    return encodeURIComponent(identidad(valor, tipo));
  } catch {
    throw new ErrorClienteHttpFederacion(
      'identidad_ruta_federada_invalida',
      'La consulta de progreso exige identidades canónicas.'
    );
  }
}

function rutaDisponibilidad(flujoId, generacionId) {
  return `/api/federacion/v1/datos/flujos/${segmento(
    flujoId,
    TIPOS_IDENTIDAD_FEDERADA.FLUJO
  )}/generaciones/${segmento(
    generacionId,
    TIPOS_IDENTIDAD_FEDERADA.GENERACION
  )}/disponibilidad`;
}

function identidad(valor, tipo) {
  return String(crearIdentidadFederada({ tipo, valor: String(valor || '') }));
}

function codigoRemotoSaneado(valor) {
  const codigo = String(valor || '');
  return /^[A-Za-z][A-Za-z0-9_]{0,95}$/u.test(codigo) &&
      !/(?:sfr1|sfop1|sfinv1|sfrec1)_/iu.test(codigo)
    ? codigo
    : null;
}

function capacidadRemotaSaneada(valor) {
  const claves = [
    'capacidadTemporalOcurrencias', 'disponible', 'familiasSoportadas',
    'maximoBytesPorLote', 'maximoBytesPorOcurrencia', 'maximoOcurrenciasPorLote',
    'versionConfiguracion', 'versionesFamilia'
  ];
  if (!valor || typeof valor !== 'object' || Array.isArray(valor) ||
      Object.keys(valor).sort().join('\0') !== [...claves].sort().join('\0') ||
      typeof valor.disponible !== 'boolean' ||
      !['number', 'string'].includes(typeof valor.versionConfiguracion)) return null;
  for (const campo of [
    'capacidadTemporalOcurrencias', 'maximoBytesPorLote',
    'maximoBytesPorOcurrencia', 'maximoOcurrenciasPorLote'
  ]) if (!Number.isSafeInteger(valor[campo]) || valor[campo] < 0) return null;
  if (valor.familiasSoportadas === null || valor.versionesFamilia === null) {
    if (valor.familiasSoportadas !== null || valor.versionesFamilia !== null) return null;
  } else if (!Array.isArray(valor.familiasSoportadas) ||
      valor.familiasSoportadas.some((familia) =>
        !/^[A-Za-z][A-Za-z0-9]{0,63}$/u.test(String(familia))) ||
      !valor.versionesFamilia || typeof valor.versionesFamilia !== 'object' ||
      Array.isArray(valor.versionesFamilia) ||
      Object.entries(valor.versionesFamilia).some(([familia, version]) =>
        !/^[A-Za-z][A-Za-z0-9]{0,63}$/u.test(familia) ||
        !Number.isSafeInteger(version) || version < 1)) return null;
  return Object.freeze({
    capacidadTemporalOcurrencias: valor.capacidadTemporalOcurrencias,
    disponible: valor.disponible,
    familiasSoportadas: valor.familiasSoportadas === null
      ? null : Object.freeze([...valor.familiasSoportadas]),
    maximoBytesPorLote: valor.maximoBytesPorLote,
    maximoBytesPorOcurrencia: valor.maximoBytesPorOcurrencia,
    maximoOcurrenciasPorLote: valor.maximoOcurrenciasPorLote,
    versionConfiguracion: String(valor.versionConfiguracion),
    versionesFamilia: valor.versionesFamilia === null
      ? null : Object.freeze({ ...valor.versionesFamilia })
  });
}

function respuestaInvalida() {
  return new ErrorClienteHttpFederacion(
    'respuesta_federada_invalida',
    'El receptor devolvió una respuesta no interpretable.',
    { reintentable: true }
  );
}

function errorTimeout() {
  return new ErrorClienteHttpFederacion(
    'timeout_transporte_federado',
    'El receptor federado no respondió dentro del plazo.',
    { reintentable: true }
  );
}
