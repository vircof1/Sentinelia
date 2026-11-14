import { generarUuidV7Auditoria, validarUuidV7Auditoria } from '../../auditoria/src/UuidV7Auditoria.js';
import { validarRepresentacionInvitacionEstablecimientoFederacion } from '../src/InvitacionEstablecimientoFederacion.js';

export class ServicioCanjeInvitacionFederacion {
  constructor({
    repositorioInvitaciones,
    provisionadorCanjePendiente,
    generadorSecretoPersistente,
    installationReceptoraId,
    resolverOrigenPublico,
    guardiaActivacion = null
  } = {}) {
    exigirMetodo(repositorioInvitaciones, 'canjear', 'repositorioInvitaciones');
    exigirMetodo(
      provisionadorCanjePendiente,
      'registrarEnTransaccion',
      'provisionadorCanjePendiente'
    );
    exigirMetodo(generadorSecretoPersistente, 'generar', 'generadorSecretoPersistente');
    if (typeof resolverOrigenPublico !== 'function') {
      throw new Error('El canje requiere resolverOrigenPublico().');
    }
    exigirIdentidad(installationReceptoraId, 'instalacion', 'installationReceptoraId');
    this.repositorioInvitaciones = repositorioInvitaciones;
    this.provisionadorCanjePendiente = provisionadorCanjePendiente;
    this.generadorSecretoPersistente = generadorSecretoPersistente;
    this.installationReceptoraId = installationReceptoraId;
    this.resolverOrigenPublico = resolverOrigenPublico;
    if (guardiaActivacion !== null &&
        typeof guardiaActivacion?.exigirActiva !== 'function') {
      throw new Error('guardiaActivacion debe implementar exigirActiva().');
    }
    this.guardiaActivacion = guardiaActivacion;
  }

  async canjear(solicitud = {}) {
    await this.guardiaActivacion?.exigirActiva('canjear_invitacion');
    let entrada;
    try {
      entrada = validarSolicitud(solicitud);
    } catch (error) {
      throw new ErrorCanjeInvitacionFederacion(
        'PETICION_CANJE_INVALIDA',
        400,
        String(error?.message || 'La petición de canje no es válida.')
      );
    }
    if (
      entrada.invitacion.destino.installationId !== this.installationReceptoraId ||
      entrada.invitacion.destino.origenPublico !== this.resolverOrigenPublico()
    ) {
      throw new ErrorCanjeInvitacionFederacion(
        'DESTINO_INVITACION_NO_COINCIDE',
        422,
        'La invitación no pertenece al destino público actual.'
      );
    }
    const secretoPersistente = this.generadorSecretoPersistente.generar();
    const eventoId = generarUuidV7Auditoria();
    const resultado = await this.repositorioInvitaciones.canjear({
      invitacion: entrada.invitacion,
      installationEmisoraId: entrada.installationEmisoraId,
      bootEmisorId: entrada.bootEmisorId,
      nombreEmisorDeclarado: entrada.nombreEmisorDeclarado,
      compatibilidad: entrada.compatibilidad,
      solicitudCanjeId: entrada.solicitudCanjeId,
      eventoId,
      secretoPersistente,
      provisionadorCanjePendiente: this.provisionadorCanjePendiente
    });
    return congelar({
      ok: true,
      relacionReceptoraId: entrada.invitacion.destino.relacionId,
      installationReceptoraId: this.installationReceptoraId,
      secretoPersistente,
      estado: resultado.estado
    });
  }
}

export class ErrorCanjeInvitacionFederacion extends Error {
  constructor(codigo, statusCode, mensaje) {
    super(mensaje);
    this.name = 'ErrorCanjeInvitacionFederacion';
    this.codigo = codigo;
    this.statusCode = statusCode;
  }
}

function validarSolicitud(valor) {
  exigirObjetoExacto(valor, [
    'bootEmisorId', 'compatibilidad', 'installationEmisoraId', 'invitacion',
    'nombreEmisorDeclarado', 'solicitudCanjeId'
  ], 'solicitud de canje');
  const invitacion = validarRepresentacionInvitacionEstablecimientoFederacion(
    valor.invitacion
  );
  exigirIdentidad(valor.installationEmisoraId, 'instalacion', 'installationEmisoraId');
  exigirIdentidad(valor.bootEmisorId, 'arranque', 'bootEmisorId');
  validarUuidV7Auditoria(valor.solicitudCanjeId, 'solicitudCanjeId');
  const nombre = String(valor.nombreEmisorDeclarado || '').trim();
  if (!nombre || nombre.length > 191 || /[\u0000-\u001f\u007f]/u.test(nombre)) {
    throw new Error('nombreEmisorDeclarado no es válido.');
  }
  exigirObjetoExacto(
    valor.compatibilidad,
    ['productoVersion', 'protocoloVersion'],
    'compatibilidad'
  );
  if (!Number.isSafeInteger(valor.compatibilidad.protocoloVersion) ||
      valor.compatibilidad.protocoloVersion < 1) {
    throw new Error('protocoloVersion debe ser un entero positivo.');
  }
  const productoVersion = String(valor.compatibilidad.productoVersion || '').trim();
  if (!productoVersion || productoVersion.length > 64) {
    throw new Error('productoVersion no es válida.');
  }
  return congelar({
    invitacion,
    installationEmisoraId: valor.installationEmisoraId,
    bootEmisorId: valor.bootEmisorId,
    nombreEmisorDeclarado: nombre,
    compatibilidad: {
      protocoloVersion: valor.compatibilidad.protocoloVersion,
      productoVersion
    },
    solicitudCanjeId: valor.solicitudCanjeId
  });
}

function exigirIdentidad(valor, tipo, campo) {
  const finalCanonico = '[A-Za-z0-9_-]{21}[AQgw]';
  const patron = new RegExp(`^sfid1\\.${tipo}\\.${finalCanonico}$`, 'u');
  if (typeof valor !== 'string' || !patron.test(valor)) {
    throw new Error(`${campo} no es una identidad federada canónica.`);
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

function exigirMetodo(valor, metodo, campo) {
  if (typeof valor?.[metodo] !== 'function') {
    throw new Error(`${campo} debe implementar ${metodo}().`);
  }
}

function congelar(valor) {
  if (valor && typeof valor === 'object') {
    Object.values(valor).forEach(congelar);
    Object.freeze(valor);
  }
  return valor;
}
