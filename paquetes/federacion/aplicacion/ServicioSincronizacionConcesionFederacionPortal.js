import { generarUuidV7Auditoria, validarUuidV7Auditoria }
  from '../../auditoria/src/UuidV7Auditoria.js';
import {
  validarIntercambioDeclaracionConcesionFederacion
} from '../src/IntercambioDeclaracionConcesionFederacion.js';

export class ServicioSincronizacionConcesionFederacionPortal {
  constructor({
    repositorioIntercambios,
    repositorioDestinos,
    custodiaSecretoEmision,
    clienteHttp,
    servicioConsolidacion,
    servicioReconciliacion,
    guardiaEmision = null,
    guardiaActivacion = null,
    installationLocalId,
    bootLocalId,
    resolverNombreLocal = null
  } = {}) {
    exigirMetodo(repositorioIntercambios, 'prepararSalida', 'repositorioIntercambios');
    exigirMetodo(repositorioIntercambios, 'confirmarSalida', 'repositorioIntercambios');
    exigirMetodo(repositorioIntercambios, 'recibir', 'repositorioIntercambios');
    exigirMetodo(repositorioDestinos, 'obtenerAprobadoOperativo', 'repositorioDestinos');
    exigirMetodo(custodiaSecretoEmision, 'obtenerParaLoginTecnico', 'custodiaSecretoEmision');
    exigirMetodo(clienteHttp, 'iniciarSesion', 'clienteHttp');
    exigirMetodo(clienteHttp, 'publicarDeclaracionConcesion', 'clienteHttp');
    exigirMetodo(clienteHttp, 'publicarManifiestoFlujoInicial', 'clienteHttp');
    exigirMetodo(servicioConsolidacion, 'consolidarRelacion', 'servicioConsolidacion');
    exigirMetodo(
      servicioReconciliacion,
      'listarManifiestosPreparados',
      'servicioReconciliacion'
    );
    exigirMetodo(
      servicioReconciliacion,
      'confirmarManifiestoPublicado',
      'servicioReconciliacion'
    );
    if (guardiaEmision !== null) {
      exigirMetodo(guardiaEmision, 'exigirDisponible', 'guardiaEmision');
    }
    if (guardiaActivacion !== null) {
      exigirMetodo(guardiaActivacion, 'exigirActiva', 'guardiaActivacion');
    }
    this.repositorio = repositorioIntercambios;
    this.destinos = repositorioDestinos;
    this.custodia = custodiaSecretoEmision;
    this.clienteHttp = clienteHttp;
    this.consolidacion = servicioConsolidacion;
    this.reconciliacion = servicioReconciliacion;
    this.exigirEmision = guardiaEmision
      ? (operacion) => guardiaEmision.exigirDisponible(operacion)
      : guardiaActivacion
        ? (operacion) => guardiaActivacion.exigirActiva(operacion)
        : null;
    this.installationLocalId = String(installationLocalId || '');
    this.bootLocalId = String(bootLocalId || '');
    this.resolverNombreLocal = resolverNombreLocal;
  }

  async sincronizar({ relacionId } = {}) {
    await this.exigirEmision?.('sincronizar_concesion_desde_portal');
    const declaracion = await this.repositorio.prepararSalida({
      relacionId,
      installationLocalId: this.installationLocalId,
      intercambioId: generarUuidV7Auditoria()
    });
    if (!declaracion || declaracion.papel !== 'oferta') {
      throw errorDominio(
        'OFERTA_LOCAL_NO_DISPONIBLE',
        'La relación emisora todavía no posee una oferta local publicable.'
      );
    }
    const destino = await this.destinos.obtenerAprobadoOperativo({ relacionId });
    if (destino.installationRemotaId !== declaracion.installationReceptoraId) {
      throw errorDominio(
        'DESTINO_NEGOCIACION_DIVERGENTE',
        'La localización aprobada no pertenece a la instalación de la declaración.'
      );
    }
    const token = await this.#abrirSesion({ relacionId, destino });
    const respuesta = await this.clienteHttp.publicarDeclaracionConcesion({
      destino,
      token,
      declaracion
    });
    await this.repositorio.confirmarSalida({ declaracion, confirmacion: respuesta });

    let recepcionContraparte = null;
    if (respuesta?.declaracionLocal) {
      const contraparte = validarIntercambioDeclaracionConcesionFederacion(
        respuesta.declaracionLocal
      );
      validarContraparte(contraparte, declaracion);
      recepcionContraparte = await this.repositorio.recibir({
        declaracion: contraparte,
        confirmacionId: generarUuidV7Auditoria()
      });
      await this.consolidacion.consolidarRelacion({
        relacionId,
        actor: {
          modo: 'directo',
          real: { tipo: 'instancia_remota', id: contraparte.installationEmisoraId },
          efectivo: null
        }
      });
    }
    const manifiestos = await this.reconciliacion.listarManifiestosPreparados({
      relacionId
    });
    let tokenPlanoDatos = manifiestos.manifiestos.length > 0
      ? await this.#abrirSesion({ relacionId, destino })
      : null;
    for (const manifiesto of manifiestos.manifiestos) {
      tokenPlanoDatos = await this.#publicarManifiesto({
        relacionId, destino, token: tokenPlanoDatos, manifiesto
      });
    }
    return Object.freeze({
      relacionId,
      revisionLocalId: declaracion.revisionId,
      estadoPublicacion: respuesta.estado,
      revisionContraparteId: respuesta?.declaracionLocal?.revisionId ?? null,
      estadoRecepcionContraparte: recepcionContraparte?.estado ?? 'pendiente',
      manifiestosPublicados: manifiestos.manifiestos.length
    });
  }

  async #abrirSesion({ relacionId, destino }) {
    const secretoPersistente = await this.custodia.obtenerParaLoginTecnico({
      relacionId,
      installationLocalId: this.installationLocalId,
      installationRemotaId: destino.installationRemotaId
    });
    const loginRequestId = generarUuidV7Auditoria();
    const nombreEmisorDeclarado = await resolverNombreOpcional(this.resolverNombreLocal);
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
    const token = respuesta?.sesion?.token;
    if (respuesta?.ok !== true || respuesta.requestId !== loginRequestId ||
        !uuidV7(respuesta?.sesion?.sessionId) ||
        typeof token !== 'string' || !/^sfop1_[A-Za-z0-9_-]{64}$/u.test(token)) {
      throw errorDominio(
        'RESPUESTA_SESION_FEDERADA_INVALIDA',
        'La contraparte no devolvió una sesión operativa interpretable.'
      );
    }
    return token;
  }

  async #publicarManifiesto({ relacionId, destino, token, manifiesto }) {
    let tokenVigente = token;
    for (let intento = 1; intento <= 3; intento += 1) {
      try {
        await this.clienteHttp.publicarManifiestoFlujoInicial({
          destino,
          token: tokenVigente,
          manifiesto
        });
      } catch (error) {
        if (error?.codigoRemoto === 'SESION_FEDERADA_NO_VIVA' && intento < 3) {
          tokenVigente = await this.#abrirSesion({ relacionId, destino });
          continue;
        }
        const codigoRemoto = /^[A-Za-z][A-Za-z0-9_]{0,95}$/u
          .test(String(error?.codigoRemoto || ''))
          ? error.codigoRemoto
          : 'RECHAZO_REMOTO_NO_CLASIFICADO';
        throw errorDominio(
          'PUBLICACION_MANIFIESTO_INICIAL_RECHAZADA',
          `La contraparte rechazó un manifiesto inicial (${codigoRemoto}).`
        );
      }
      await this.reconciliacion.confirmarManifiestoPublicado({ manifiesto });
      return tokenVigente;
    }
    throw errorDominio(
      'PUBLICACION_MANIFIESTO_INICIAL_RECHAZADA',
      'La contraparte rechazó un manifiesto inicial (SESION_FEDERADA_NO_VIVA).'
    );
  }
}

function validarContraparte(contraparte, local) {
  if (contraparte.relacionId !== local.relacionId ||
      contraparte.installationEmisoraId !== local.installationReceptoraId ||
      contraparte.installationReceptoraId !== local.installationEmisoraId ||
      contraparte.papel !== 'aceptacion') {
    throw errorDominio(
      'DECLARACION_CONTRAPARTE_DIVERGENTE',
      'La respuesta autenticada no contiene la aceptación de esta relación.'
    );
  }
}

function uuidV7(valor) {
  try {
    validarUuidV7Auditoria(valor, 'sessionId');
    return true;
  } catch {
    return false;
  }
}

function errorDominio(codigo, mensaje) {
  const error = new Error(mensaje);
  error.codigo = codigo;
  return error;
}

function exigirMetodo(valor, metodo, campo) {
  if (typeof valor?.[metodo] !== 'function') {
    throw new Error(`${campo} debe implementar ${metodo}().`);
  }
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
