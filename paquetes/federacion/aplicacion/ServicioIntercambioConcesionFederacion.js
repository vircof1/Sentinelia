import { generarUuidV7Auditoria, validarUuidV7Auditoria }
  from '../../auditoria/src/UuidV7Auditoria.js';
import {
  validarIntercambioDeclaracionConcesionFederacion
} from '../src/IntercambioDeclaracionConcesionFederacion.js';
import {
  crearIdentidadFederada,
  TIPOS_IDENTIDAD_FEDERADA
} from '../src/IdentidadFederada.js';

export class ServicioIntercambioConcesionFederacion {
  constructor({
    repositorio,
    servicioSesiones,
    installationLocalId,
    servicioConsolidacion = null,
    guardiaActivacion = null
  } = {}) {
    exigirMetodo(repositorio, 'recibir', 'repositorio');
    exigirMetodo(repositorio, 'consultarConfirmacion', 'repositorio');
    exigirMetodo(servicioSesiones, 'validarBearer', 'servicioSesiones');
    if (guardiaActivacion !== null) {
      exigirMetodo(guardiaActivacion, 'exigirActiva', 'guardiaActivacion');
    }
    if (servicioConsolidacion !== null) {
      exigirMetodo(servicioConsolidacion, 'consolidarRelacion', 'servicioConsolidacion');
    }
    this.repositorio = repositorio;
    this.servicioSesiones = servicioSesiones;
    this.installationLocalId = String(crearIdentidadFederada({
      tipo: TIPOS_IDENTIDAD_FEDERADA.INSTALACION,
      valor: installationLocalId
    }));
    this.guardiaActivacion = guardiaActivacion;
    this.servicioConsolidacion = servicioConsolidacion;
  }

  async recibir({ token, declaracion: entrada } = {}) {
    await this.guardiaActivacion?.exigirActiva('recibir_declaracion_concesion');
    const sesion = await this.servicioSesiones.validarBearer(token);
    const declaracion = validarIntercambioDeclaracionConcesionFederacion(entrada);
    validarSesion(sesion, declaracion, this.installationLocalId);
    const recepcion = await this.repositorio.recibir({
      declaracion,
      confirmacionId: generarUuidV7Auditoria()
    });
    await this.servicioConsolidacion?.consolidarRelacion({
      relacionId: declaracion.relacionId,
      actor: {
        modo: 'directo',
        real: {
          tipo: 'instancia_remota',
          id: declaracion.installationEmisoraId
        },
        efectivo: null
      }
    });
    const declaracionLocal = typeof this.repositorio.prepararSalida === 'function'
      ? await this.repositorio.prepararSalida({
          relacionId: declaracion.relacionId,
          installationLocalId: this.installationLocalId,
          intercambioId: generarUuidV7Auditoria()
        })
      : null;
    return Object.freeze({ ...recepcion, declaracionLocal });
  }

  async consultarConfirmacion({ token, relacionId, intercambioId } = {}) {
    const sesion = await this.servicioSesiones.validarBearer(token);
    try {
      validarUuidV7Auditoria(intercambioId, 'intercambioId');
    } catch {
      const error = new Error('intercambioId no es una identidad UUIDv7 canónica.');
      error.codigo = 'IDENTIDAD_INTERCAMBIO_FEDERACION_INVALIDA';
      error.statusCode = 400;
      throw error;
    }
    if (sesion.relacionId !== relacionId) {
      const error = new Error('La sesión no autoriza esa confirmación.');
      error.codigo = 'CONFIRMACION_CONCESION_NO_AUTORIZADA';
      error.statusCode = 403;
      throw error;
    }
    const confirmacion = await this.repositorio.consultarConfirmacion({
      relacionId,
      intercambioId
    });
    if (!confirmacion) {
      const error = new Error('La confirmación solicitada no existe.');
      error.codigo = 'CONFIRMACION_CONCESION_NO_ENCONTRADA';
      error.statusCode = 404;
      throw error;
    }
    return confirmacion;
  }
}

function validarSesion(sesion, declaracion, installationLocalId) {
  if (declaracion.installationReceptoraId !== installationLocalId ||
      sesion.relacionId !== declaracion.relacionId ||
      sesion.installationRemotaId !== declaracion.installationEmisoraId ||
      sesion.installationLocalId !== declaracion.installationReceptoraId) {
    const error = new Error('La sesión no autoriza la declaración recibida.');
    error.codigo = 'DECLARACION_CONCESION_NO_AUTORIZADA';
    error.statusCode = 403;
    throw error;
  }
}

function exigirMetodo(valor, metodo, campo) {
  if (typeof valor?.[metodo] !== 'function') {
    throw new Error(`${campo} debe implementar ${metodo}().`);
  }
}
