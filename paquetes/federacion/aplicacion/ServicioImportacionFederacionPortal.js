import { generarUuidV7Auditoria } from '../../auditoria/src/UuidV7Auditoria.js';
import { VERSION_PROTOCOLO_FEDERACION } from '../src/CatalogosFederacion.js';
import {
  validarRepresentacionInvitacionEstablecimientoFederacion
} from '../src/InvitacionEstablecimientoFederacion.js';
import {
  validarRepresentacionRecuperacionFederacion
} from '../src/RecuperacionRelacionFederacion.js';

export class ServicioImportacionFederacionPortal {
  constructor({
    repositorioImportaciones,
    clienteHttp,
    installationLocalId,
    bootLocalId,
    resolverNombreLocal,
    productoVersion,
    guardiaEmision = null,
    guardiaActivacion = null
  } = {}) {
    for (const metodo of [
      'prepararEmision', 'consolidarInvitacion', 'validarRecuperacion',
      'aplicarRecuperacion'
    ]) exigirMetodo(repositorioImportaciones, metodo, 'repositorioImportaciones');
    exigirMetodo(clienteHttp, 'canjearInvitacion', 'clienteHttp');
    exigirMetodo(clienteHttp, 'canjearRecuperacion', 'clienteHttp');
    validarIdentidad(installationLocalId, 'instalacion', 'installationLocalId');
    validarIdentidad(bootLocalId, 'arranque', 'bootLocalId');
    if (typeof resolverNombreLocal !== 'function') {
      throw new Error('La importación requiere resolverNombreLocal().');
    }
    const version = String(productoVersion || '').trim();
    if (!version || version.length > 64) throw new Error('productoVersion no es válida.');
    this.repositorio = repositorioImportaciones;
    this.clienteHttp = clienteHttp;
    this.installationLocalId = installationLocalId;
    this.bootLocalId = bootLocalId;
    this.resolverNombreLocal = resolverNombreLocal;
    this.productoVersion = version;
    if (guardiaEmision !== null &&
        typeof guardiaEmision?.exigirDisponible !== 'function') {
      throw new Error('guardiaEmision debe implementar exigirDisponible().');
    }
    if (guardiaActivacion !== null &&
        typeof guardiaActivacion?.exigirActiva !== 'function') {
      throw new Error('guardiaActivacion debe implementar exigirActiva().');
    }
    this.exigirEmision = guardiaEmision
      ? (operacion) => guardiaEmision.exigirDisponible(operacion)
      : guardiaActivacion
        ? (operacion) => guardiaActivacion.exigirActiva(operacion)
        : null;
  }

  async importarInvitacion({ representacion, actor, scope } = {}) {
    await this.exigirEmision?.('importar_invitacion');
    const invitacion = validarRepresentacionInvitacionEstablecimientoFederacion(
      representacion
    );
    exigirOrigenImportable(invitacion.destino.origenPublico);
    const idsPreparacion = identidadesOperacion();
    await this.repositorio.prepararEmision({
      relacionId: invitacion.destino.relacionId,
      actor,
      scope,
      ...idsPreparacion
    });
    const respuesta = validarRespuestaInvitacion(await this.clienteHttp
      .canjearInvitacion({
        destino: invitacion.destino.origenPublico,
        solicitud: {
          invitacion,
          installationEmisoraId: this.installationLocalId,
          bootEmisorId: this.bootLocalId,
          nombreEmisorDeclarado: await this.#nombreLocal(),
          compatibilidad: {
            protocoloVersion: VERSION_PROTOCOLO_FEDERACION,
            productoVersion: this.productoVersion
          },
          solicitudCanjeId: generarUuidV7Auditoria()
        }
      }), invitacion);
    const resultado = await this.repositorio.consolidarInvitacion({
      relacionId: invitacion.destino.relacionId,
      installationLocalId: this.installationLocalId,
      installationRemotaId: respuesta.installationReceptoraId,
      nombreRemotoDeclarado: nombreRemotoInvitacion(invitacion),
      origenPublico: invitacion.destino.origenPublico,
      secretoPersistente: respuesta.secretoPersistente,
      actor,
      scope,
      ...identidadesOperacion()
    });
    return Object.freeze({
      relacionId: resultado.relacionId,
      estado: resultado.estado,
      installationRemotaId: respuesta.installationReceptoraId
    });
  }

  async importarRecuperacion({ representacion, actor, scope } = {}) {
    await this.exigirEmision?.('importar_recuperacion');
    const recuperacion = validarRepresentacionRecuperacionFederacion(representacion);
    exigirOrigenImportable(recuperacion.destino.origenPublico);
    await this.repositorio.validarRecuperacion({
      relacionId: recuperacion.destino.relacionId,
      installationRemotaId: recuperacion.destino.installationId,
      actor,
      scope,
      ...identidadesOperacion()
    });
    const respuesta = validarRespuestaRecuperacion(await this.clienteHttp
      .canjearRecuperacion({
        destino: recuperacion.destino.origenPublico,
        solicitud: {
          recuperacion,
          installationEmisoraId: this.installationLocalId,
          bootEmisorId: this.bootLocalId,
          solicitudCanjeId: generarUuidV7Auditoria()
        }
      }), recuperacion);
    return this.repositorio.aplicarRecuperacion({
      relacionId: recuperacion.destino.relacionId,
      installationLocalId: this.installationLocalId,
      installationRemotaId: respuesta.installationReceptoraId,
      origenPublico: recuperacion.destino.origenPublico,
      secretoPersistente: respuesta.secretoPersistente,
      actor,
      scope,
      ...identidadesOperacion()
    });
  }

  async #nombreLocal() {
    const nombre = String(await this.resolverNombreLocal()).trim();
    if (!nombre || nombre.length > 191 || /[\u0000-\u001f\u007f]/u.test(nombre)) {
      throw new Error('El nombre visible local no es válido para federación.');
    }
    return nombre;
  }
}

function validarRespuestaInvitacion(valor, invitacion) {
  exacto(valor, [
    'estado', 'installationReceptoraId', 'ok', 'relacionReceptoraId',
    'secretoPersistente'
  ], 'respuesta de invitación');
  if (valor.ok !== true || valor.relacionReceptoraId !== invitacion.destino.relacionId ||
      valor.installationReceptoraId !== invitacion.destino.installationId ||
      typeof valor.estado !== 'string') {
    throw new Error('La respuesta no corresponde a la invitación importada.');
  }
  validarSecreto(valor.secretoPersistente);
  return valor;
}
function validarRespuestaRecuperacion(valor, recuperacion) {
  exacto(valor, [
    'estado', 'installationReceptoraId', 'ok', 'relacionReceptoraId',
    'secretoPersistente', 'versionCredencial'
  ], 'respuesta de recuperación');
  if (valor.ok !== true || valor.estado !== 'recuperada' ||
      valor.relacionReceptoraId !== recuperacion.destino.relacionId ||
      valor.installationReceptoraId !== recuperacion.destino.installationId ||
      !Number.isSafeInteger(valor.versionCredencial) || valor.versionCredencial < 1) {
    throw new Error('La respuesta no corresponde a la recuperación importada.');
  }
  validarSecreto(valor.secretoPersistente);
  return valor;
}
function exacto(valor, claves, campo) {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) {
    throw new Error(`${campo} no es un objeto JSON.`);
  }
  const actuales = Object.keys(valor).sort();
  const esperadas = [...claves].sort();
  if (actuales.length !== esperadas.length ||
      actuales.some((clave, indice) => clave !== esperadas[indice])) {
    throw new Error(`${campo} contiene campos ausentes o desconocidos.`);
  }
}
function validarSecreto(valor) {
  if (!/^sfr1_[A-Za-z0-9_-]{64}$/u.test(String(valor || ''))) {
    throw new Error('La respuesta federada no contiene una credencial válida.');
  }
}
function validarIdentidad(valor, tipo, campo) {
  if (!new RegExp(`^sfid1\\.${tipo}\\.[A-Za-z0-9_-]{21}[AQgw]$`, 'u')
    .test(String(valor || ''))) throw new Error(`${campo} no es canónica.`);
}
function exigirOrigenImportable(origen) {
  if (Buffer.byteLength(origen, 'utf8') > 2048) {
    throw new Error('El origen federado supera el límite persistible.');
  }
}
function nombreRemotoInvitacion(invitacion) {
  const host = new URL(invitacion.destino.origenPublico).host;
  return host.length <= 191 ? host : invitacion.destino.installationId;
}
function identidadesOperacion() {
  return {
    eventoId: generarUuidV7Auditoria(),
    correlacionId: generarUuidV7Auditoria()
  };
}
function exigirMetodo(valor, metodo, campo) {
  if (typeof valor?.[metodo] !== 'function') {
    throw new Error(`${campo} debe implementar ${metodo}().`);
  }
}
