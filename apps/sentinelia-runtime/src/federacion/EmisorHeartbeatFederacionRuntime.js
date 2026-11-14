import {
  generarUuidV7Auditoria,
  validarUuidV7Auditoria
} from '../../../../paquetes/auditoria/src/UuidV7Auditoria.js';
import {
  FAMILIAS_FEDERACION,
  VERSION_PROTOCOLO_FEDERACION,
  VERSIONES_FAMILIA_FEDERACION
} from '../../../../paquetes/federacion/src/CatalogosFederacion.js';

export class EmisorHeartbeatFederacionRuntime {
  constructor({
    repositorioDestinos,
    gestorSesiones,
    servicioCliente,
    repositorioSalud,
    bootLocalId,
    productoVersion = '0.1.0',
    reloj = () => new Date(),
    generarEventoId = generarUuidV7Auditoria
  } = {}) {
    exigirMetodo(repositorioDestinos, 'listarVinculadosAutenticables', 'repositorioDestinos');
    exigirMetodo(gestorSesiones, 'obtenerSesion', 'gestorSesiones');
    exigirMetodo(servicioCliente, 'registrarHeartbeat', 'servicioCliente');
    exigirMetodo(repositorioSalud, 'registrarHeartbeatEmisor', 'repositorioSalud');
    this.repositorioDestinos = repositorioDestinos;
    this.gestorSesiones = gestorSesiones;
    this.servicioCliente = servicioCliente;
    this.repositorioSalud = repositorioSalud;
    this.bootLocalId = String(bootLocalId || '');
    this.productoVersion = String(productoVersion || '');
    this.reloj = reloj;
    this.generarEventoId = generarEventoId;
    this.estado = new Map();
  }

  async ejecutar({ silencioRelacionMs, activacionFederacion = true } = {}) {
    if (activacionFederacion !== true) {
      return Object.freeze({
        omitido: true,
        motivo: 'federacion_desactivada',
        totalRelaciones: 0,
        totalIntentadas: 0,
        totalExitosas: 0,
        totalFallidas: 0,
        resultados: Object.freeze([])
      });
    }
    const intervaloMs = Math.max(1_000, Math.min(
      30_000,
      Math.floor(validarMargen(silencioRelacionMs) / 3)
    ));
    const ahoraMs = this.reloj().getTime();
    const destinos = await this.repositorioDestinos.listarVinculadosAutenticables();
    const resultados = [];
    for (const { relacionId } of destinos) {
      const anterior = this.estado.get(relacionId);
      if (anterior?.proximoIntentoMs > ahoraMs) continue;
      resultados.push(await this.#emitir({ relacionId, ahoraMs, intervaloMs }));
    }
    return Object.freeze({
      omitido: false,
      totalRelaciones: destinos.length,
      totalIntentadas: resultados.length,
      totalExitosas: resultados.filter((r) => r.exito).length,
      totalFallidas: resultados.filter((r) => !r.exito).length,
      resultados: Object.freeze(resultados)
    });
  }

  async #emitir({ relacionId, ahoraMs, intervaloMs }) {
    let sesion = null;
    try {
      sesion = await this.gestorSesiones.obtenerSesion({ relacionId });
      const anterior = this.estado.get(relacionId);
      const mismaSesion = anterior?.sesionId === sesion.sesionId;
      const seq = mismaSesion ? anterior.seq + 1n : 1n;
      const clienteEnviaEnUtc = this.reloj().toISOString();
      const solicitud = {
        heartbeatRequestId: this.generarEventoId(),
        relacionId,
        sesionId: sesion.sesionId,
        bootEmisorId: this.bootLocalId,
        seq: seq.toString(),
        clienteEnviaEnUtc,
        compatibilidad: declaracionCompatibilidad(this.productoVersion),
        muestraTemporalAnterior: mismaSesion && anterior.muestraTemporal
          ? { ...anterior.muestraTemporal, clienteRecibeEnUtc: anterior.clienteRecibeEnUtc }
          : null
      };
      const respuesta = await this.servicioCliente.registrarHeartbeat({
        relacionId,
        token: sesion.token,
        solicitud
      });
      const clienteRecibeEnUtc = this.reloj().toISOString();
      validarRespuesta(respuesta, solicitud);
      const compatibilidad = respuesta.relacion.compatibilidad;
      await this.repositorioSalud.registrarHeartbeatEmisor({
        relacionId,
        sesionId: sesion.sesionId,
        seq: seq.toString(),
        compatibilidad,
        estadoRemoto: respuesta.relacion.estado,
        exito: true
      });
      this.estado.set(relacionId, {
        sesionId: sesion.sesionId,
        seq,
        muestraTemporal: respuesta.muestraTemporal,
        clienteRecibeEnUtc,
        proximoIntentoMs: ahoraMs + intervaloMs
      });
      return Object.freeze({ relacionId, exito: true, seq: seq.toString(), compatibilidad });
    } catch (error) {
      await invalidarSesionRechazada(this.gestorSesiones, {
        error,
        relacionId,
        sesion
      });
      await this.repositorioSalud.registrarHeartbeatEmisor({
        relacionId,
        exito: false,
        codigoError: error?.codigo || 'heartbeat_emisor_fallido'
      });
      this.estado.set(relacionId, {
        ...(this.estado.get(relacionId) || {}),
        proximoIntentoMs: ahoraMs + intervaloMs
      });
      return Object.freeze({
        relacionId,
        exito: false,
        codigoError: String(error?.codigo || 'heartbeat_emisor_fallido')
      });
    }
  }
}

async function invalidarSesionRechazada(gestorSesiones, { error, relacionId, sesion }) {
  if (!esRechazoAutenticacion(error) ||
      typeof gestorSesiones?.invalidar !== 'function') return false;
  try {
    return await gestorSesiones.invalidar({
      relacionId,
      sesionId: sesion?.sesionId,
      token: sesion?.token
    });
  } catch {
    return false;
  }
}

function esRechazoAutenticacion(error) {
  return error?.statusCode === 401 || error?.statusCode === 403 ||
    ['sesion_federada_no_viva', 'autenticacion_federada_rechazada']
      .includes(String(error?.codigoRemoto || '').toLowerCase());
}

function declaracionCompatibilidad(productoVersion) {
  const familias = [...FAMILIAS_FEDERACION.valores].sort();
  return {
    protocoloVersion: VERSION_PROTOCOLO_FEDERACION,
    productoVersion,
    familiasSoportadas: familias,
    versionesFamilia: Object.fromEntries(
      familias.map((familia) => [familia, VERSIONES_FAMILIA_FEDERACION[familia]])
    )
  };
}

function validarRespuesta(respuesta, solicitud) {
  const relacion = respuesta?.relacion;
  const temporal = relacion?.temporal;
  const muestra = respuesta?.muestraTemporal;
  if (!clavesExactas(respuesta, [
    'heartbeatRequestId', 'muestraTemporal', 'ok', 'presenciaTtlSeconds',
    'relacion', 'seq'
  ]) || !clavesExactas(relacion, [
    'compatibilidad', 'estado', 'relacionId', 'temporal'
  ]) || !clavesExactas(temporal, [
    'desfaseEstimadoMs', 'estado', 'rttEstimadoMs', 'toleranciaTemporalMs'
  ]) || !clavesExactas(muestra, [
    'clienteEnviaEnUtc', 'muestraId', 'servidorEnviaEnUtc', 'servidorRecibeEnUtc'
  ]) || !respuesta.ok || respuesta.heartbeatRequestId !== solicitud.heartbeatRequestId ||
      respuesta.seq !== solicitud.seq ||
      relacion.relacionId !== solicitud.relacionId ||
      !['pendienteAutenticacion', 'vinculada'].includes(relacion.estado) ||
      !['compatible', 'incompatible'].includes(relacion.compatibilidad) ||
      !Number.isSafeInteger(respuesta.presenciaTtlSeconds) ||
      respuesta.presenciaTtlSeconds < 1 ||
      !['pendiente', 'tolerable', 'noTolerable'].includes(temporal.estado) ||
      !Number.isSafeInteger(temporal.toleranciaTemporalMs) ||
      temporal.toleranciaTemporalMs < 0 || temporal.toleranciaTemporalMs > 300000 ||
      !metricasTemporalesValidas(temporal) ||
      !uuidV7Valido(muestra.muestraId) ||
      muestra.clienteEnviaEnUtc !== solicitud.clienteEnviaEnUtc ||
      !fechaUtcCanonica(muestra.servidorRecibeEnUtc) ||
      !fechaUtcCanonica(muestra.servidorEnviaEnUtc) ||
      Date.parse(muestra.servidorEnviaEnUtc) < Date.parse(muestra.servidorRecibeEnUtc)) {
    const error = new Error('La respuesta del heartbeat no conserva su identidad.');
    error.codigo = 'respuesta_heartbeat_federado_invalida';
    throw error;
  }
}

function metricasTemporalesValidas(temporal) {
  if (temporal.estado === 'pendiente') {
    return temporal.desfaseEstimadoMs === null && temporal.rttEstimadoMs === null;
  }
  return Number.isSafeInteger(temporal.desfaseEstimadoMs) &&
    Number.isSafeInteger(temporal.rttEstimadoMs) && temporal.rttEstimadoMs >= 0;
}

function clavesExactas(valor, claves) {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return false;
  const observadas = Object.keys(valor).sort();
  const esperadas = [...claves].sort();
  return observadas.length === esperadas.length &&
    observadas.every((clave, indice) => clave === esperadas[indice]);
}

function uuidV7Valido(valor) {
  try {
    validarUuidV7Auditoria(valor, 'muestraId');
    return true;
  } catch {
    return false;
  }
}

function fechaUtcCanonica(valor) {
  return typeof valor === 'string' && Number.isFinite(Date.parse(valor)) &&
    new Date(valor).toISOString() === valor;
}

function validarMargen(valor) {
  if (!Number.isSafeInteger(valor) || valor < 5_000 || valor > 86_400_000) {
    throw new Error('silencioRelacionMs no es válido.');
  }
  return valor;
}

function exigirMetodo(valor, metodo, campo) {
  if (typeof valor?.[metodo] !== 'function') throw new Error(`${campo} requiere ${metodo}().`);
}
