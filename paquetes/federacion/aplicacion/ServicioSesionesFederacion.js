import { generarUuidV7Auditoria, validarUuidV7Auditoria } from '../../auditoria/src/UuidV7Auditoria.js';

export class ServicioSesionesFederacion {
  constructor({ repositorioSql, repositorioRedis, installationLocalId,
    guardiaActivacion = null } = {}) {
    exigirMetodo(repositorioSql, 'reservarLogin', 'repositorioSql');
    exigirMetodo(repositorioSql, 'reservarRefresh', 'repositorioSql');
    exigirMetodo(repositorioSql, 'validarAutoridadSesion', 'repositorioSql');
    exigirMetodo(repositorioRedis, 'instalar', 'repositorioRedis');
    exigirIdentidad(installationLocalId, 'instalacion', 'installationLocalId');
    this.repositorioSql = repositorioSql;
    this.repositorioRedis = repositorioRedis;
    this.installationLocalId = installationLocalId;
    this.guardiaActivacion = exigirGuardiaOpcional(guardiaActivacion);
  }

  async login(entrada = {}) {
    await this.guardiaActivacion?.exigirActiva('login');
    validarLogin(entrada);
    const base = {
      operacionId: generarUuidV7Auditoria(),
      requestId: entrada.loginRequestId,
      sesionId: generarUuidV7Auditoria(),
      relacionId: entrada.relacionId,
      installationLocalId: this.installationLocalId,
      installationRemotaId: entrada.installationEmisoraId,
      bootRemotoId: entrada.bootEmisorId,
      nombreRemotoDeclarado: entrada.nombreEmisorDeclarado ?? null,
      secretoPersistente: entrada.secretoPersistente
    };
    const operacion = await this.repositorioSql.reservarLogin(base);
    if (operacion.repetida) return this.#recuperarReplay(operacion);
    return this.#publicar(operacion, 'login');
  }

  async refresh({ token, ...entrada } = {}) {
    await this.guardiaActivacion?.exigirActiva('refresh');
    validarRefresh(entrada);
    const vigente = await this.validarBearer(token, {
      refreshRequestId: entrada.refreshRequestId
    });
    if (
      vigente.relacionId !== entrada.relacionId ||
      vigente.sesionId !== entrada.sesionId ||
      vigente.bootRemotoId !== entrada.bootEmisorId
    ) throw errorSesionNoViva();
    const operacion = await this.repositorioSql.reservarRefresh({
      operacionId: generarUuidV7Auditoria(),
      requestId: entrada.refreshRequestId,
      sesionId: vigente.sesionId,
      relacionId: vigente.relacionId,
      installationLocalId: vigente.installationLocalId,
      installationRemotaId: vigente.installationRemotaId,
      bootRemotoId: vigente.bootRemotoId,
      nombreRemotoDeclarado: entrada.nombreEmisorDeclarado ?? null
    });
    if (operacion.repetida) return this.#recuperarReplay(operacion);
    return this.#publicar(operacion, 'refresh');
  }

  async validarBearer(token, opciones = {}) {
    const contexto = await this.repositorioRedis.validarToken(token, opciones);
    const esReplayRefresh = contexto?.soloReplayRequestId != null &&
      contexto.soloReplayRequestId === opciones.refreshRequestId;
    if (!contexto || !await this.repositorioSql.validarAutoridadSesion(contexto, {
      permitirFencingAnterior: esReplayRefresh
    })) {
      throw errorSesionNoViva();
    }
    return contexto;
  }

  async revocar(entrada) {
    exigirObjetoExacto(entrada, [
      'actor', 'installationRemotaId', 'relacionId', 'requestId'
    ], 'revocación federada');
    exigirIdentidad(entrada.relacionId, 'relacion', 'relacionId');
    exigirIdentidad(entrada.installationRemotaId, 'instalacion', 'installationRemotaId');
    validarUuidV7Auditoria(entrada.requestId, 'requestId');
    const solicitud = {
      ...entrada,
      operacionId: generarUuidV7Auditoria(),
      installationLocalId: this.installationLocalId
    };
    const resultado = await this.repositorioSql.revocar(solicitud);
    await this.repositorioRedis.revocar(entrada.relacionId);
    return resultado;
  }

  async #publicar(operacion, modo) {
    const token = this.repositorioRedis.generarToken();
    const respuesta = Object.freeze({
      ok: true,
      requestId: operacion.requestId,
      serverTimeUtc: operacion.creadaEnUtc,
      sesion: Object.freeze({
        sessionId: operacion.sesionId,
        token,
        expiresInSeconds: this.repositorioRedis.ttlSegundos,
        fencingToken: operacion.fencingToken,
        versionRevocacion: operacion.versionRevocacion
      })
    });
    const contexto = {
      operacionId: operacion.operacionId,
      relacionId: operacion.relacionId,
      sesionId: operacion.sesionId,
      installationLocalId: operacion.installationLocalId,
      installationRemotaId: operacion.installationRemotaId,
      bootRemotoId: operacion.bootRemotoId,
      fencingToken: operacion.fencingToken,
      versionRevocacion: operacion.versionRevocacion
    };
    try {
      await this.repositorioRedis.instalar({
        contexto, token, requestId: operacion.requestId, respuesta, modo
      });
      await this.repositorioSql.consolidar({
        operacionId: operacion.operacionId,
        requestId: operacion.requestId,
        tipo: modo,
        eventoId: operacion.operacionId
      });
      return respuesta;
    } catch (error) {
      await this.repositorioRedis.retirarSiCoincide(contexto).catch(() => {});
      await this.repositorioSql.marcarFallida(operacion.operacionId).catch(() => {});
      throw error;
    }
  }

  async #recuperarReplay(operacion) {
    const respuesta = await this.repositorioRedis.obtenerReplay(
      operacion.relacionId,
      operacion.requestId
    );
    if (respuesta) {
      if (operacion.estado === 'reservada') {
        await this.repositorioSql.consolidar({
          operacionId: operacion.operacionId,
          requestId: operacion.requestId,
          tipo: operacion.tipo,
          eventoId: operacion.operacionId
        });
      }
      try {
        await this.validarBearer(respuesta.sesion.token);
        return respuesta;
      } catch {
        // Un replay no puede resucitar un token sustituido o revocado.
      }
    }
    const error = new Error('La respuesta de sesión ya no es recuperable; repita el login.');
    error.codigo = 'RESPUESTA_SESION_FEDERADA_NO_RECUPERABLE';
    error.statusCode = 410;
    throw error;
  }
}

function validarLogin(entrada) {
  exigirObjetoCompatible(entrada, [
    'bootEmisorId', 'installationEmisoraId', 'loginRequestId',
    'relacionId', 'secretoPersistente'
  ], ['nombreEmisorDeclarado'], 'login federado');
  exigirIdentidad(entrada.relacionId, 'relacion', 'relacionId');
  exigirIdentidad(entrada.installationEmisoraId, 'instalacion', 'installationEmisoraId');
  exigirIdentidad(entrada.bootEmisorId, 'arranque', 'bootEmisorId');
  validarUuidV7Auditoria(entrada.loginRequestId, 'loginRequestId');
  validarNombreOpcional(entrada.nombreEmisorDeclarado);
  if (typeof entrada.secretoPersistente !== 'string' ||
      !/^sfr1_[A-Za-z0-9_-]{64}$/u.test(entrada.secretoPersistente)) {
    const error = new Error('La relación no admite autenticación técnica.');
    error.codigo = 'AUTENTICACION_FEDERADA_RECHAZADA';
    error.statusCode = 401;
    throw error;
  }
}

function validarRefresh(entrada) {
  exigirObjetoCompatible(entrada, [
    'bootEmisorId', 'refreshRequestId', 'relacionId', 'sesionId'
  ], ['nombreEmisorDeclarado'], 'refresh federado');
  exigirIdentidad(entrada.relacionId, 'relacion', 'relacionId');
  exigirIdentidad(entrada.bootEmisorId, 'arranque', 'bootEmisorId');
  validarUuidV7Auditoria(entrada.refreshRequestId, 'refreshRequestId');
  validarUuidV7Auditoria(entrada.sesionId, 'sesionId');
  validarNombreOpcional(entrada.nombreEmisorDeclarado);
}

function validarNombreOpcional(valor) {
  if (valor === undefined) return;
  if (typeof valor !== 'string' || valor !== valor.trim() || valor.length < 1 ||
      valor.length > 191 || /[\u0000-\u001f\u007f]/u.test(valor)) {
    throw new Error('nombreEmisorDeclarado no es un nombre visible valido.');
  }
}

function exigirObjetoCompatible(valor, obligatorias, opcionales, campo) {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor) ||
      Object.getPrototypeOf(valor) !== Object.prototype) {
    throw new Error(`${campo} debe ser un objeto JSON plano.`);
  }
  const observadas = new Set(Object.keys(valor));
  if (obligatorias.some((clave) => !observadas.has(clave)) ||
      [...observadas].some((clave) =>
        !obligatorias.includes(clave) && !opcionales.includes(clave))) {
    throw new Error(`${campo} contiene campos ausentes o desconocidos.`);
  }
}

function exigirObjetoExacto(valor, claves, campo) {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor) ||
      Object.getPrototypeOf(valor) !== Object.prototype) {
    throw new Error(`${campo} debe ser un objeto JSON plano.`);
  }
  const observadas = Object.keys(valor).sort();
  const esperadas = [...claves].sort();
  if (observadas.length !== esperadas.length ||
      observadas.some((clave, indice) => clave !== esperadas[indice])) {
    throw new Error(`${campo} contiene campos ausentes o desconocidos.`);
  }
}

function exigirIdentidad(valor, tipo, campo) {
  if (typeof valor !== 'string' ||
      !new RegExp(`^sfid1\\.${tipo}\\.[A-Za-z0-9_-]{21}[AQgw]$`, 'u').test(valor)) {
    throw new Error(`${campo} no es canónica.`);
  }
}

function errorSesionNoViva() {
  const error = new Error('La sesión federada no está viva.');
  error.codigo = 'SESION_FEDERADA_NO_VIVA';
  error.statusCode = 403;
  return error;
}

function exigirMetodo(valor, metodo, campo) {
  if (typeof valor?.[metodo] !== 'function') {
    throw new Error(`${campo} debe implementar ${metodo}().`);
  }
}

function exigirGuardiaOpcional(valor) {
  if (valor !== null && typeof valor?.exigirActiva !== 'function') {
    throw new Error('guardiaActivacion debe implementar exigirActiva().');
  }
  return valor;
}
