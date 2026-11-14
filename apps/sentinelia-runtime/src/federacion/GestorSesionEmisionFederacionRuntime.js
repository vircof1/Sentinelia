import {
  generarUuidV7Auditoria,
  validarUuidV7Auditoria
} from '../../../../paquetes/auditoria/src/UuidV7Auditoria.js';

export class GestorSesionEmisionFederacionRuntime {
  constructor({
    repositorioDestinos,
    clienteHttp,
    custodiaSecretoEmision,
    installationLocalId,
    bootLocalId,
    resolverNombreLocal = null,
    reloj = () => Date.now()
  } = {}) {
    exigirMetodo(repositorioDestinos, 'obtenerAprobadoOperativo', 'repositorioDestinos');
    exigirMetodo(clienteHttp, 'iniciarSesion', 'clienteHttp');
    exigirMetodo(clienteHttp, 'refrescarSesion', 'clienteHttp');
    exigirMetodo(custodiaSecretoEmision, 'obtenerParaLoginTecnico', 'custodiaSecretoEmision');
    this.repositorioDestinos = repositorioDestinos;
    this.clienteHttp = clienteHttp;
    this.custodia = custodiaSecretoEmision;
    this.installationLocalId = String(installationLocalId || '');
    this.bootLocalId = String(bootLocalId || '');
    this.resolverNombreLocal = resolverNombreLocal;
    this.reloj = reloj;
    this.sesiones = new Map();
    this.operaciones = new Map();
  }

  async obtenerToken({ relacionId } = {}) {
    return (await this.obtenerSesion({ relacionId })).token;
  }

  invalidar({ relacionId, sesionId = null, token = null } = {}) {
    const clave = String(relacionId || '');
    const actual = this.sesiones.get(clave);
    if (!actual) return false;
    if (sesionId != null && actual.sesionId !== sesionId) return false;
    if (token != null && actual.token !== token) return false;
    return this.sesiones.delete(clave);
  }

  obtenerSesion({ relacionId } = {}) {
    const clave = String(relacionId || '');
    if (this.operaciones.has(clave)) return this.operaciones.get(clave);
    const operacion = this.#obtenerSesion(clave)
      .finally(() => this.operaciones.delete(clave));
    this.operaciones.set(clave, operacion);
    return operacion;
  }

  async #obtenerSesion(relacionId) {
    const resolverDestino = typeof this.repositorioDestinos.obtenerVinculadoAutenticable === 'function'
      ? 'obtenerVinculadoAutenticable' : 'obtenerAprobadoOperativo';
    const destino = await this.repositorioDestinos[resolverDestino]({ relacionId });
    const actual = this.sesiones.get(relacionId);
    if (actual && actual.renovarDespuesDeMs > this.reloj()) return actual;
    const nombreEmisorDeclarado = await resolverNombreOpcional(this.resolverNombreLocal);
    if (actual) {
      try {
        const refreshRequestId = generarUuidV7Auditoria();
        const respuesta = await this.clienteHttp.refrescarSesion({
          destino,
          token: actual.token,
          solicitud: {
            relacionId,
            sesionId: actual.sesionId,
            bootEmisorId: this.bootLocalId,
            refreshRequestId,
            ...(nombreEmisorDeclarado === null ? {} : { nombreEmisorDeclarado })
          }
        });
        return this.#guardar(relacionId, respuesta, {
          requestId: refreshRequestId,
          sesionIdEsperada: actual.sesionId
        });
      } catch {
        this.sesiones.delete(relacionId);
      }
    }
    const secretoPersistente = await this.custodia.obtenerParaLoginTecnico({
      relacionId,
      installationLocalId: this.installationLocalId,
      installationRemotaId: destino.installationRemotaId
    });
    const loginRequestId = generarUuidV7Auditoria();
    const respuesta = await this.clienteHttp.iniciarSesion({
      destino,
      solicitud: {
        relacionId,
        installationEmisoraId: this.installationLocalId,
        bootEmisorId: this.bootLocalId,
        loginRequestId,
        ...(nombreEmisorDeclarado === null ? {} : { nombreEmisorDeclarado }),
        secretoPersistente
      }
    });
    return this.#guardar(relacionId, respuesta, { requestId: loginRequestId });
  }

  #guardar(relacionId, respuesta, { requestId, sesionIdEsperada = null } = {}) {
    const sesion = respuesta?.sesion;
    if (!clavesExactas(respuesta, ['ok', 'requestId', 'serverTimeUtc', 'sesion']) ||
        !clavesExactas(sesion, [
          'expiresInSeconds', 'fencingToken', 'sessionId', 'token', 'versionRevocacion'
        ]) || !respuesta.ok || respuesta.requestId !== requestId ||
        !fechaUtcCanonica(respuesta.serverTimeUtc) ||
        !uuidV7Valido(respuesta.requestId, 'requestId') ||
        !uuidV7Valido(sesion.sessionId, 'sessionId') ||
        (sesionIdEsperada !== null && sesion.sessionId !== sesionIdEsperada) ||
        typeof sesion?.token !== 'string' ||
        !/^sfop1_[A-Za-z0-9_-]{64}$/u.test(sesion.token) ||
        !Number.isSafeInteger(sesion.expiresInSeconds) || sesion.expiresInSeconds < 1 ||
        !decimalPositivo(sesion.fencingToken) ||
        !decimalPositivo(sesion.versionRevocacion)) {
      const error = new Error('La contraparte devolvió una sesión no interpretable.');
      error.codigo = 'respuesta_sesion_federada_invalida';
      error.reintentable = true;
      throw error;
    }
    const margenMs = Math.min(30_000, Math.max(1_000, sesion.expiresInSeconds * 100));
    const guardada = Object.freeze({
      sesionId: sesion.sessionId,
      token: sesion.token,
      renovarDespuesDeMs: this.reloj() + sesion.expiresInSeconds * 1000 - margenMs
    });
    this.sesiones.set(relacionId, guardada);
    return guardada;
  }
}

function clavesExactas(valor, claves) {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return false;
  const observadas = Object.keys(valor).sort();
  const esperadas = [...claves].sort();
  return observadas.length === esperadas.length &&
    observadas.every((clave, indice) => clave === esperadas[indice]);
}

function uuidV7Valido(valor, campo) {
  try {
    validarUuidV7Auditoria(valor, campo);
    return true;
  } catch {
    return false;
  }
}

function fechaUtcCanonica(valor) {
  return typeof valor === 'string' && Number.isFinite(Date.parse(valor)) &&
    new Date(valor).toISOString() === valor;
}

function decimalPositivo(valor) {
  return typeof valor === 'string' && /^[1-9][0-9]*$/u.test(valor);
}

function exigirMetodo(valor, metodo, campo) {
  if (typeof valor?.[metodo] !== 'function') throw new Error(`${campo} requiere ${metodo}().`);
}

async function resolverNombreOpcional(resolver) {
  if (resolver === null) return null;
  if (typeof resolver !== 'function') throw new Error('resolverNombreLocal debe ser una funcion.');
  const nombre = await resolver();
  if (typeof nombre !== 'string' || nombre !== nombre.trim() || nombre.length < 1 ||
      nombre.length > 191 || /[\u0000-\u001f\u007f]/u.test(nombre)) {
    throw new Error('El nombre visible local no es valido para federacion.');
  }
  return nombre;
}
