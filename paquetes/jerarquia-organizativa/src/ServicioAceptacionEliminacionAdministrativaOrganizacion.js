import { generarUuidV7Auditoria } from '../../auditoria/src/UuidV7Auditoria.js';
import { ErrorPersistenciaOperacionAdministrativa } from '../../agentes/src/RepositorioOperacionesAdministrativasSql.js';
import {
  CONTRATOS_NOTIFICACION_ELIMINACION_ORGANIZACION,
  EMISORES_NOTIFICACION_OPERACION_ADMINISTRATIVA,
  ESTADOS_OPERACION_ADMINISTRATIVA_ORGANIZACION,
  FASES_ELIMINACION_ADMINISTRATIVA_ORGANIZACION,
  PERFIL_CONTRATO_ELIMINACION_ADMINISTRATIVA_ORGANIZACION,
  PERFIL_NOTIFICACION_OPERACION_ADMINISTRATIVA,
  TIPOS_NOTIFICACION_ELIMINACION_ORGANIZACION,
  TIPOS_OPERACION_ADMINISTRATIVA_ORGANIZACION,
  VERSION_CONTRATO_ELIMINACION_ADMINISTRATIVA_ORGANIZACION,
  crearComandoEliminacionAdministrativaOrganizacion,
  crearNotificacionEliminacionAdministrativaOrganizacion
} from './ContratoEliminacionAdministrativaOrganizacion.js';

export class ErrorAceptacionEliminacionAdministrativaOrganizacion extends Error {
  constructor(codigo, mensaje, { causa = null } = {}) {
    super(mensaje, causa ? { cause: causa } : undefined);
    this.name = 'ErrorAceptacionEliminacionAdministrativaOrganizacion';
    this.codigo = codigo;
  }
}

export class ServicioAceptacionEliminacionAdministrativaOrganizacion {
  constructor({
    servicioAutorizacion,
    fronteraTransaccional,
    codecConfirmacion,
    repositorioOperaciones,
    repositorioNotificaciones,
    generarUuid = generarUuidV7Auditoria,
    retencionNotificacionesDias = 365,
    maxIntentos = 3
  } = {}) {
    if (typeof servicioAutorizacion?.adquirirRaizEnTransaccion !== 'function' ||
        typeof servicioAutorizacion?.autorizarActoresEnTransaccion !== 'function' ||
        typeof fronteraTransaccional?.ejecutar !== 'function' ||
        typeof codecConfirmacion?.verificar !== 'function' ||
        typeof repositorioOperaciones?.crearORecuperar !== 'function' ||
        typeof repositorioOperaciones?.buscarPorClave !== 'function' ||
        typeof repositorioNotificaciones?.crearORecuperar !== 'function' ||
        typeof repositorioNotificaciones?.buscarPorOperacionYTipo !== 'function' ||
        typeof repositorioNotificaciones?.existeDestinatario !== 'function' ||
        typeof generarUuid !== 'function') {
      throw new Error('La aceptación organizativa requiere todos sus puertos atómicos.');
    }
    if (!Number.isInteger(retencionNotificacionesDias) ||
        retencionNotificacionesDias < 1 || retencionNotificacionesDias > 3650) {
      throw new Error('La retención del buzón debe estar entre 1 y 3650 días.');
    }
    if (!Number.isInteger(maxIntentos) || maxIntentos < 1 || maxIntentos > 100) {
      throw new Error('Los intentos de eliminación deben estar entre 1 y 100.');
    }
    Object.assign(this, {
      servicioAutorizacion,
      fronteraTransaccional,
      codecConfirmacion,
      repositorioOperaciones,
      repositorioNotificaciones,
      generarUuid,
      retencionNotificacionesDias,
      maxIntentos
    });
  }

  async aceptar({
    actorRealId,
    actorEfectivoId = actorRealId,
    sujeto,
    tokenConfirmacion,
    fraseConfirmacion,
    csrfToken
  } = {}) {
    const token = this.codecConfirmacion.verificar(tokenConfirmacion, {
      csrfToken,
      actorRealId,
      actorEfectivoId,
      sujeto
    });
    if (String(fraseConfirmacion ?? '') !== token.fraseConfirmacion) {
      throw confirmacionInvalida();
    }

    return this.fronteraTransaccional.ejecutar(async (conexion) => {
      const existente = await this.repositorioOperaciones.buscarPorClave(
        token.claveOperacion,
        { conexion, bloquear: false }
      );
      if (existente) return this.#resolverRepeticion(existente, token, conexion);

      const raiz = await this.servicioAutorizacion.adquirirRaizEnTransaccion({
        sujeto: { tipo: token.sujetoTipo, id: token.sujetoId },
        operacionPropietariaId: token.operacionId
      }, { conexion });

      const existenteBajoAutoridad = await this.repositorioOperaciones.buscarPorClave(
        token.claveOperacion,
        { conexion, bloquear: true }
      );
      if (existenteBajoAutoridad) {
        return this.#resolverRepeticion(existenteBajoAutoridad, token, conexion);
      }

      const fotografiaAutorizacion = await this.servicioAutorizacion
        .autorizarActoresEnTransaccion({
          actorRealId,
          actorEfectivoId,
          sujeto: raiz
        }, { conexion });
      const aceptacion = { sujeto: raiz, fotografiaAutorizacion };

      const comando = crearComandoEliminacionAdministrativaOrganizacion({
        perfil: PERFIL_CONTRATO_ELIMINACION_ADMINISTRATIVA_ORGANIZACION,
        version: VERSION_CONTRATO_ELIMINACION_ADMINISTRATIVA_ORGANIZACION,
        tipoOperacion:
          TIPOS_OPERACION_ADMINISTRATIVA_ORGANIZACION.ELIMINAR_ORGANIZACION,
        estado: ESTADOS_OPERACION_ADMINISTRATIVA_ORGANIZACION.ENCOLADA,
        fase: FASES_ELIMINACION_ADMINISTRATIVA_ORGANIZACION.PREPARACION,
        cancelable: false,
        progreso: 'fases_semanticas',
        identidades: {
          operacionId: token.operacionId,
          claveOperacion: token.claveOperacion,
          correlacionId: token.correlacionId,
          eventoId: token.eventoId
        },
        sujeto: aceptacion.sujeto,
        fotografiaAutorizacion: aceptacion.fotografiaAutorizacion
      });

      let operacion;
      try {
        operacion = await this.repositorioOperaciones.crearORecuperar({
          comando,
          maxIntentos: this.maxIntentos,
          conexion
        });
      } catch (error) {
        if (error instanceof ErrorPersistenciaOperacionAdministrativa &&
            error.codigo === 'operacion_administrativa_recurso_reclamado') {
          throw operacionEnCurso(error);
        }
        if (error instanceof ErrorPersistenciaOperacionAdministrativa &&
            ['clave_operacion_administrativa_reutilizada',
              'identidad_operacion_administrativa_reutilizada'].includes(error.codigo)) {
          throw claveDivergente(error);
        }
        throw error;
      }
      if (!operacion.creada) {
        return this.#resolverRepeticion(operacion.operacion, token, conexion);
      }

      const fotografia = aceptacion.fotografiaAutorizacion;
      if (await this.repositorioNotificaciones.existeDestinatario(
        fotografia.destinatarioUsuarioId,
        { conexion }
      )) {
        await this.repositorioNotificaciones.crearORecuperar({
          notificacion: crearNotificacionEncolada({
            notificacionId: this.generarUuid(),
            operacionId: token.operacionId,
            fotografiaAutorizacion: fotografia,
            sujeto: aceptacion.sujeto
          }),
          retenerHastaUtc: sumarDias(
            fotografia.aceptadaEnUtc,
            this.retencionNotificacionesDias
          ),
          conexion
        });
      }
      return Object.freeze({
        codigo: 'organizacion_eliminacion_encolada',
        repetida: false,
        operacionId: token.operacionId,
        estado: ESTADOS_OPERACION_ADMINISTRATIVA_ORGANIZACION.ENCOLADA
      });
    });
  }

  async #resolverRepeticion(operacion, token, conexion) {
    const comando = operacion?.comando;
    if (!coincideComandoConToken(comando, token)) throw claveDivergente();
    const destinatario = comando.fotografiaAutorizacion.destinatarioUsuarioId;
    if (await this.repositorioNotificaciones.existeDestinatario(
      destinatario,
      { conexion }
    )) {
      const notificacion = await this.repositorioNotificaciones
        .buscarPorOperacionYTipo({
          destinatarioUsuarioId: destinatario,
          operacionId: token.operacionId,
          tipo: TIPOS_NOTIFICACION_ELIMINACION_ORGANIZACION.ENCOLADA,
          conexion
        });
      if (!notificacion) {
        throw new ErrorAceptacionEliminacionAdministrativaOrganizacion(
          'organizacion_eliminacion_impacto_no_seguro',
          'La operación existente no conserva su notificación atómica.'
        );
      }
    }
    return Object.freeze({
      codigo: 'organizacion_eliminacion_repetida',
      repetida: true,
      operacionId: token.operacionId,
      estado: operacion.estado
    });
  }
}

function crearNotificacionEncolada({
  notificacionId,
  operacionId,
  fotografiaAutorizacion,
  sujeto
}) {
  const tipo = TIPOS_NOTIFICACION_ELIMINACION_ORGANIZACION.ENCOLADA;
  const contrato = CONTRATOS_NOTIFICACION_ELIMINACION_ORGANIZACION[tipo];
  return crearNotificacionEliminacionAdministrativaOrganizacion({
    perfil: PERFIL_NOTIFICACION_OPERACION_ADMINISTRATIVA,
    version: 1,
    notificacionId,
    tipo,
    operacionId,
    destinatarioUsuarioId: fotografiaAutorizacion.destinatarioUsuarioId,
    emisor: {
      tipo: EMISORES_NOTIFICACION_OPERACION_ADMINISTRATIVA.USUARIO,
      actorRealId: fotografiaAutorizacion.actorReal.usuarioId,
      actorEfectivoId: fotografiaAutorizacion.actorEfectivo.usuarioId
    },
    emitidaEnUtc: fotografiaAutorizacion.aceptadaEnUtc,
    estadoOperacion: ESTADOS_OPERACION_ADMINISTRATIVA_ORGANIZACION.ENCOLADA,
    referenciaSujeto: {
      tipo: sujeto.tipo,
      id: sujeto.id,
      fotografiaFinal: null
    },
    leida: false,
    leidaEnUtc: null,
    tituloCodigo: contrato.tituloCodigo,
    resumenCodigo: contrato.resumenCodigo
  });
}

function coincideComandoConToken(comando, token) {
  return Boolean(comando &&
    comando.tipoOperacion === token.tipoOperacion &&
    comando.version === token.versionOperacion &&
    comando.identidades.operacionId === token.operacionId &&
    comando.identidades.claveOperacion === token.claveOperacion &&
    comando.identidades.correlacionId === token.correlacionId &&
    comando.identidades.eventoId === token.eventoId &&
    comando.sujeto.tipo === token.sujetoTipo &&
    comando.sujeto.id === token.sujetoId &&
    comando.fotografiaAutorizacion.actorReal.usuarioId === token.actorRealId &&
    comando.fotografiaAutorizacion.actorEfectivo.usuarioId === token.actorEfectivoId);
}

function sumarDias(instante, dias) {
  return new Date(Date.parse(instante) + dias * 86_400_000).toISOString();
}

function confirmacionInvalida() {
  return new ErrorAceptacionEliminacionAdministrativaOrganizacion(
    'organizacion_eliminacion_confirmacion_invalida',
    'La confirmación de eliminación no es válida.'
  );
}

function operacionEnCurso(causa = null) {
  return new ErrorAceptacionEliminacionAdministrativaOrganizacion(
    'organizacion_eliminacion_operacion_en_curso',
    'La raíz o uno de sus descendientes ya está reservado.',
    { causa }
  );
}

function claveDivergente(causa = null) {
  return new ErrorAceptacionEliminacionAdministrativaOrganizacion(
    'organizacion_eliminacion_clave_divergente',
    'La clave de operación ya protege otra intención.',
    { causa }
  );
}
