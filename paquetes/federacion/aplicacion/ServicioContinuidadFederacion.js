import { generarUuidV7Auditoria, validarUuidV7Auditoria } from '../../auditoria/src/UuidV7Auditoria.js';
import { normalizarEndpointFederacion } from '../src/RelacionFederacion.js';
import {
  crearRepresentacionRecuperacionFederacion,
  validarRepresentacionRecuperacionFederacion
} from '../src/RecuperacionRelacionFederacion.js';

export class ServicioContinuidadFederacion {
  constructor({ repositorio, servicioSesiones, repositorioSesionesRedis,
    generadorRecuperacion, generadorSecretoPersistente, installationLocalId,
    resolverOrigenPublico, guardiaActivacion = null, guardiaRecepcion = null } = {}) {
    for (const metodo of [
      'emitirRecuperacion', 'canjearRecuperacion', 'rotarCredencial',
      'proponerLocalizacion', 'aprobarLocalizacion'
    ]) exigirMetodo(repositorio, metodo, 'repositorio');
    exigirMetodo(servicioSesiones, 'validarBearer', 'servicioSesiones');
    exigirMetodo(repositorioSesionesRedis, 'revocar', 'repositorioSesionesRedis');
    exigirMetodo(generadorRecuperacion, 'generar', 'generadorRecuperacion');
    exigirMetodo(generadorSecretoPersistente, 'generar', 'generadorSecretoPersistente');
    exigirIdentidad(installationLocalId, 'instalacion', 'installationLocalId');
    if (typeof resolverOrigenPublico !== 'function') {
      throw new Error('La continuidad exige resolver el origen público.');
    }
    this.repositorio = repositorio;
    this.servicioSesiones = servicioSesiones;
    this.repositorioSesionesRedis = repositorioSesionesRedis;
    this.generadorRecuperacion = generadorRecuperacion;
    this.generadorSecretoPersistente = generadorSecretoPersistente;
    this.installationLocalId = installationLocalId;
    this.resolverOrigenPublico = resolverOrigenPublico;
    if (guardiaActivacion !== null &&
        typeof guardiaActivacion?.exigirActiva !== 'function') {
      throw new Error('guardiaActivacion debe implementar exigirActiva().');
    }
    this.guardiaActivacion = guardiaActivacion;
    if (guardiaRecepcion !== null &&
        typeof guardiaRecepcion?.exigirPreparada !== 'function') {
      throw new Error('guardiaRecepcion debe implementar exigirPreparada().');
    }
    this.guardiaRecepcion = guardiaRecepcion;
  }

  async emitirRecuperacion(entrada = {}) {
    await this.guardiaRecepcion?.exigirPreparada('emitir_recuperacion');
    await this.guardiaActivacion?.exigirActiva('emitir_recuperacion');
    validarHumana(entrada);
    const ttlSegundos = entrada.ttlSegundos ?? 900;
    if (!Number.isSafeInteger(ttlSegundos) || ttlSegundos < 60 || ttlSegundos > 86400) {
      throw new Error('ttlSegundos debe estar entre 60 y 86400.');
    }
    const temporal = this.generadorRecuperacion.generar();
    const resultado = await this.repositorio.emitirRecuperacion({
      ...entrada,
      ...temporal,
      ttlSegundos
    });
    return Object.freeze({
      recuperacionId: temporal.recuperacionId,
      expiraEnUtc: resultado.expiraEnUtc,
      representacionTransportable: crearRepresentacionRecuperacionFederacion({
        recuperacionId: temporal.recuperacionId,
        credencialTemporal: temporal.credencialTemporal,
        relacionId: entrada.relacionId,
        installationReceptoraId: this.installationLocalId,
        origenPublico: this.resolverOrigenPublico(),
        expiraEnUtc: resultado.expiraEnUtc
      })
    });
  }

  async canjearRecuperacion(solicitud = {}) {
    await this.guardiaActivacion?.exigirActiva('canjear_recuperacion');
    exacto(solicitud, [
      'bootEmisorId', 'installationEmisoraId', 'recuperacion', 'solicitudCanjeId'
    ], 'canje de recuperación');
    const recuperacion = validarRepresentacionRecuperacionFederacion(solicitud.recuperacion);
    exigirIdentidad(solicitud.installationEmisoraId, 'instalacion', 'installationEmisoraId');
    exigirIdentidad(solicitud.bootEmisorId, 'arranque', 'bootEmisorId');
    validarUuidV7Auditoria(solicitud.solicitudCanjeId, 'solicitudCanjeId');
    if (recuperacion.destino.installationId !== this.installationLocalId ||
        recuperacion.destino.origenPublico !== this.resolverOrigenPublico()) {
      const error = new Error('La recuperación no pertenece a este destino.');
      error.codigo = 'RECUPERACION_FEDERADA_RECHAZADA';
      error.statusCode = 401;
      throw error;
    }
    const secretoPersistente = this.generadorSecretoPersistente.generar();
    const resultado = await this.repositorio.canjearRecuperacion({
      recuperacionId: recuperacion.recuperacionId,
      credencialTemporal: recuperacion.credencialTemporal,
      relacionId: recuperacion.destino.relacionId,
      installationLocalId: this.installationLocalId,
      installationRemotaId: solicitud.installationEmisoraId,
      bootRemotoId: solicitud.bootEmisorId,
      solicitudId: solicitud.solicitudCanjeId,
      eventoId: generarUuidV7Auditoria(),
      secretoPersistente
    });
    await this.repositorioSesionesRedis.revocar(recuperacion.destino.relacionId);
    return Object.freeze({
      ok: true,
      relacionReceptoraId: recuperacion.destino.relacionId,
      installationReceptoraId: this.installationLocalId,
      secretoPersistente,
      versionCredencial: resultado.versionCredencial,
      estado: 'recuperada'
    });
  }

  async rotarCredencial({ token, ...entrada } = {}) {
    await this.guardiaActivacion?.exigirActiva('rotar_credencial');
    exacto(entrada, [
      'bootEmisorId', 'relacionId', 'sesionId', 'solicitudRotacionId'
    ], 'rotación de credencial');
    exigirIdentidad(entrada.relacionId, 'relacion', 'relacionId');
    exigirIdentidad(entrada.bootEmisorId, 'arranque', 'bootEmisorId');
    validarUuidV7Auditoria(entrada.sesionId, 'sesionId');
    validarUuidV7Auditoria(entrada.solicitudRotacionId, 'solicitudRotacionId');
    const sesion = await this.servicioSesiones.validarBearer(token);
    if (sesion.relacionId !== entrada.relacionId || sesion.sesionId !== entrada.sesionId ||
        sesion.bootRemotoId !== entrada.bootEmisorId) {
      throw errorContinuidadRechazada();
    }
    const secretoPersistente = this.generadorSecretoPersistente.generar();
    const resultado = await this.repositorio.rotarCredencial({
      relacionId: entrada.relacionId,
      installationLocalId: this.installationLocalId,
      installationRemotaId: sesion.installationRemotaId,
      bootRemotoId: entrada.bootEmisorId,
      solicitudId: entrada.solicitudRotacionId,
      eventoId: generarUuidV7Auditoria(),
      secretoPersistente
    });
    await this.repositorioSesionesRedis.revocar(entrada.relacionId);
    return Object.freeze({
      ok: true,
      solicitudRotacionId: entrada.solicitudRotacionId,
      secretoPersistente,
      versionCredencial: resultado.versionCredencial,
      estado: 'rotada'
    });
  }

  proponerLocalizacion(entrada = {}) {
    validarPropuestaTecnica(entrada);
    validarUuidV7Auditoria(entrada.localizacionId, 'localizacionId');
    return this.repositorio.proponerLocalizacion({
      ...entrada,
      endpoint: normalizarEndpointFederacion(entrada.endpoint),
      origen: 'contraparte'
    });
  }

  aprobarLocalizacion(entrada = {}) {
    validarHumana(entrada);
    validarUuidV7Auditoria(entrada.localizacionId, 'localizacionId');
    return this.repositorio.aprobarLocalizacion(entrada);
  }
}

function validarHumana(entrada) {
  exigirIdentidad(entrada.relacionId, 'relacion', 'relacionId');
  validarUuidV7Auditoria(entrada.eventoId, 'eventoId');
  validarUuidV7Auditoria(entrada.correlacionId, 'correlacionId');
  if (entrada.actor?.modo !== 'directo' || entrada.actor?.real?.tipo !== 'usuario' ||
      entrada.actor.efectivo != null || !/^[1-9][0-9]*$/u.test(String(entrada.actor.real.id))) {
    throw new Error('La continuidad administrativa exige una sesión humana directa.');
  }
}

function validarPropuestaTecnica(entrada) {
  exigirIdentidad(entrada.relacionId, 'relacion', 'relacionId');
  validarUuidV7Auditoria(entrada.eventoId, 'eventoId');
  validarUuidV7Auditoria(entrada.correlacionId, 'correlacionId');
  if (entrada.actor?.modo !== 'directo' ||
      entrada.actor?.real?.tipo !== 'instancia_remota' ||
      entrada.actor.efectivo != null) {
    throw new Error('La localización remota solo se propone desde el canal autenticado actual.');
  }
  exigirIdentidad(entrada.actor.real.id, 'instalacion', 'actor.real.id');
}

function exacto(valor, claves, nombre) {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) {
    throw new Error(`${nombre} debe ser un objeto JSON.`);
  }
  const actuales = Object.keys(valor).sort();
  const esperadas = [...claves].sort();
  if (actuales.length !== esperadas.length ||
      actuales.some((clave, indice) => clave !== esperadas[indice])) {
    throw new Error(`${nombre} contiene campos ausentes o desconocidos.`);
  }
}
function exigirIdentidad(valor, tipo, campo) {
  if (typeof valor !== 'string' ||
      !new RegExp(`^sfid1\\.${tipo}\\.[A-Za-z0-9_-]{21}[AQgw]$`, 'u').test(valor)) {
    throw new Error(`${campo} no es canónica.`);
  }
}
function exigirMetodo(valor, metodo, campo) {
  if (typeof valor?.[metodo] !== 'function') throw new Error(`${campo} exige ${metodo}().`);
}
function errorContinuidadRechazada() {
  const error = new Error('La continuidad federada fue rechazada.');
  error.codigo = 'CONTINUIDAD_FEDERADA_RECHAZADA';
  error.statusCode = 403;
  return error;
}
