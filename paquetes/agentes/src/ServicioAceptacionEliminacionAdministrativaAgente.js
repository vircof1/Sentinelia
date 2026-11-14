import { timingSafeEqual } from 'node:crypto';

import { generarUuidV7Auditoria } from '../../auditoria/src/UuidV7Auditoria.js';
import {
  CONTRATOS_NOTIFICACION_ELIMINACION_AGENTE,
  EMISORES_NOTIFICACION_OPERACION_ADMINISTRATIVA,
  ESTADOS_OPERACION_ADMINISTRATIVA,
  FASES_ELIMINACION_ADMINISTRATIVA_AGENTE,
  PERFIL_CONTRATO_ELIMINACION_ADMINISTRATIVA_AGENTE,
  PERFIL_FOTOGRAFIA_ESTRUCTURAL_ELIMINACION_AGENTE,
  PERFIL_NOTIFICACION_OPERACION_ADMINISTRATIVA,
  TIPOS_NOTIFICACION_ELIMINACION_AGENTE,
  TIPOS_OPERACION_ADMINISTRATIVA,
  VERSION_CONTRATO_ELIMINACION_ADMINISTRATIVA_AGENTE,
  crearComandoEliminacionAdministrativaAgente,
  crearNotificacionEliminacionAdministrativaAgente
} from './ContratoEliminacionAdministrativaAgente.js';
import { ErrorPersistenciaOperacionAdministrativa } from './RepositorioOperacionesAdministrativasSql.js';

export class ErrorAceptacionEliminacionAdministrativaAgente extends Error {
  constructor(codigo, mensaje, { causa = null } = {}) {
    super(mensaje, causa ? { cause: causa } : undefined);
    this.name = 'ErrorAceptacionEliminacionAdministrativaAgente';
    this.codigo = codigo;
  }
}

export class ServicioAceptacionEliminacionAdministrativaAgente {
  constructor({
    servicioImpacto,
    servicioAutorizacion,
    fronteraTransaccional,
    codecConfirmacion,
    autoridadReservasJerarquicas,
    repositorioOperaciones,
    repositorioNotificaciones,
    generarUuid = generarUuidV7Auditoria,
    retencionNotificacionesDias = 365,
    maxIntentos = 3
  } = {}) {
    if (
      typeof servicioImpacto?.calcularEnTransaccion !== 'function' ||
      typeof servicioAutorizacion?.autorizarEnTransaccion !== 'function' ||
      typeof fronteraTransaccional?.ejecutar !== 'function' ||
      typeof codecConfirmacion?.verificar !== 'function' ||
      typeof autoridadReservasJerarquicas?.exigirDisponibilidadEnTransaccion !==
        'function' ||
      typeof repositorioOperaciones?.crearORecuperar !== 'function' ||
      typeof repositorioOperaciones?.buscarPorClave !== 'function' ||
      typeof repositorioNotificaciones?.crearORecuperar !== 'function' ||
      typeof repositorioNotificaciones?.buscarPorOperacionYTipo !== 'function' ||
      typeof generarUuid !== 'function'
    ) {
      throw new Error('La aceptación interna requiere todos sus puertos atómicos.');
    }
    if (!Number.isInteger(retencionNotificacionesDias) ||
        retencionNotificacionesDias < 1 || retencionNotificacionesDias > 3650) {
      throw new Error('La retención del buzón debe estar entre 1 y 3650 días.');
    }
    if (!Number.isInteger(maxIntentos) || maxIntentos < 1 || maxIntentos > 100) {
      throw new Error('Los intentos de eliminación deben estar entre 1 y 100.');
    }
    this.servicioImpacto = servicioImpacto;
    this.servicioAutorizacion = servicioAutorizacion;
    this.fronteraTransaccional = fronteraTransaccional;
    this.codecConfirmacion = codecConfirmacion;
    this.autoridadReservasJerarquicas = autoridadReservasJerarquicas;
    this.repositorioOperaciones = repositorioOperaciones;
    this.repositorioNotificaciones = repositorioNotificaciones;
    this.generarUuid = generarUuid;
    this.retencionNotificacionesDias = retencionNotificacionesDias;
    this.maxIntentos = maxIntentos;
  }

  async aceptar({
    actorRealId,
    actorEfectivoId = actorRealId,
    agenteId,
    tokenConfirmacion,
    fraseConfirmacion,
    csrfToken
  } = {}) {
    const token = this.codecConfirmacion.verificar(tokenConfirmacion, {
      csrfToken,
      actorRealId,
      actorEfectivoId,
      agenteId
    });

    return this.fronteraTransaccional.ejecutar(async (conexion) => {
      const existente = await this.repositorioOperaciones.buscarPorClave(
        token.claveOperacion,
        { conexion, bloquear: false }
      );
      if (existente) return this.#resolverRepeticion(existente, token, conexion);

      try {
        await exigirAutoridadJerarquicaEstable(
          this.autoridadReservasJerarquicas,
          {
            recursos: [{ tipoRecurso: 'agente', recursoId: agenteId }],
            operacionPropietariaId: token.operacionId
          },
          conexion
        );
      } catch (error) {
        if (error?.codigo === 'operacion_en_curso') {
          throw new ErrorAceptacionEliminacionAdministrativaAgente(
            'agente_eliminacion_operacion_en_curso',
            'El agente o uno de sus ámbitos organizativos ya está reservado.',
            { causa: error }
          );
        }
        throw error;
      }

      const existenteBajoAutoridad = await this.repositorioOperaciones.buscarPorClave(
        token.claveOperacion,
        { conexion, bloquear: true }
      );
      if (existenteBajoAutoridad) {
        return this.#resolverRepeticion(existenteBajoAutoridad, token, conexion);
      }

      const fotografiaAutorizacion =
        await this.servicioAutorizacion.autorizarEnTransaccion(
          { actorRealId, actorEfectivoId, agenteId },
          { conexion }
        );
      const impacto = await this.servicioImpacto.calcularEnTransaccion(
        { agenteId, bloquearRaiz: true },
        { conexion }
      );
      this.#validarImpactoConfirmado(impacto, token, fraseConfirmacion);

      const sujeto = sujetoContractual(impacto.sujeto);
      const comando = crearComandoEliminacionAdministrativaAgente({
        perfil: PERFIL_CONTRATO_ELIMINACION_ADMINISTRATIVA_AGENTE,
        version: VERSION_CONTRATO_ELIMINACION_ADMINISTRATIVA_AGENTE,
        tipoOperacion: TIPOS_OPERACION_ADMINISTRATIVA.ELIMINAR_AGENTE,
        estado: ESTADOS_OPERACION_ADMINISTRATIVA.ENCOLADA,
        fase: FASES_ELIMINACION_ADMINISTRATIVA_AGENTE.PREPARACION,
        cancelable: false,
        progreso: 'fases_semanticas',
        identidades: {
          operacionId: token.operacionId,
          claveOperacion: token.claveOperacion,
          correlacionId: token.correlacionId,
          eventoId: token.eventoId
        },
        sujeto,
        fotografiaAutorizacion,
        fotografiaEstructural: {
          perfil: PERFIL_FOTOGRAFIA_ESTRUCTURAL_ELIMINACION_AGENTE,
          version: 1,
          sujeto,
          huellaEstructuralSha256: impacto.huellaEstructuralSha256,
          confirmadaEnUtc: token.emitidoEnUtc
        },
        resumenImpacto: impacto.resumenImpacto
      });

      let operacion;
      try {
        operacion = await this.repositorioOperaciones.crearORecuperar({
          comando,
          maxIntentos: this.maxIntentos,
          conexion
        });
      } catch (error) {
        if (
          error instanceof ErrorPersistenciaOperacionAdministrativa &&
          error.codigo === 'operacion_administrativa_recurso_reclamado'
        ) {
          throw new ErrorAceptacionEliminacionAdministrativaAgente(
            'agente_eliminacion_operacion_en_curso',
            'El agente ya posee una operación administrativa en curso.',
            { causa: error }
          );
        }
        throw error;
      }
      if (!operacion.creada) {
        return this.#resolverRepeticion(operacion.operacion, token, conexion);
      }

      const emitidaEnUtc = fotografiaAutorizacion.aceptadaEnUtc;
      const notificacion = crearNotificacionEncolada({
        notificacionId: this.generarUuid(),
        operacionId: token.operacionId,
        destinatarioUsuarioId: fotografiaAutorizacion.destinatarioUsuarioId,
        actorRealId: fotografiaAutorizacion.actorReal.usuarioId,
        actorEfectivoId: fotografiaAutorizacion.actorEfectivo.usuarioId,
        sujeto,
        emitidaEnUtc
      });
      await this.repositorioNotificaciones.crearORecuperar({
        notificacion,
        retenerHastaUtc: sumarDias(emitidaEnUtc, this.retencionNotificacionesDias),
        conexion
      });
      return Object.freeze({
        codigo: 'agente_eliminacion_encolada',
        repetida: false,
        operacionId: token.operacionId,
        estado: ESTADOS_OPERACION_ADMINISTRATIVA.ENCOLADA
      });
    });
  }

  #validarImpactoConfirmado(impacto, token, frasePresentada) {
    if (
      impacto.sujeto.id !== token.agenteId ||
      impacto.sujeto.guid !== token.agenteGuid
    ) {
      throw confirmacionInvalida();
    }
    if (!compararSeguro(
      impacto.huellaEstructuralSha256,
      token.huellaEstructuralSha256
    )) {
      throw new ErrorAceptacionEliminacionAdministrativaAgente(
        'agente_eliminacion_estructura_modificada',
        'El agente cambió; revisa de nuevo el impacto.'
      );
    }
    if (String(frasePresentada ?? '').trim() !== impacto.fraseConfirmacion) {
      throw confirmacionInvalida();
    }
  }

  async #resolverRepeticion(operacion, token, conexion) {
    const comando = operacion?.comando;
    if (!comando ||
        comando.identidades.operacionId !== token.operacionId ||
        comando.identidades.claveOperacion !== token.claveOperacion ||
        comando.identidades.correlacionId !== token.correlacionId ||
        comando.identidades.eventoId !== token.eventoId ||
        comando.sujeto.id !== token.agenteId ||
        comando.sujeto.guid !== token.agenteGuid ||
        comando.fotografiaAutorizacion.actorReal.usuarioId !== token.actorRealId ||
        comando.fotografiaAutorizacion.actorEfectivo.usuarioId !== token.actorEfectivoId ||
        !compararSeguro(
          comando.fotografiaEstructural.huellaEstructuralSha256,
          token.huellaEstructuralSha256
        )) {
      throw confirmacionInvalida();
    }
    const notificacion = await this.repositorioNotificaciones
      .buscarPorOperacionYTipo({
        destinatarioUsuarioId:
          comando.fotografiaAutorizacion.destinatarioUsuarioId,
        operacionId: token.operacionId,
        tipo: TIPOS_NOTIFICACION_ELIMINACION_AGENTE.ENCOLADA,
        conexion
      });
    if (!notificacion) {
      throw new ErrorAceptacionEliminacionAdministrativaAgente(
        'agente_eliminacion_impacto_no_seguro',
        'La operación existente no conserva su notificación atómica.'
      );
    }
    return Object.freeze({
      codigo: 'agente_eliminacion_repetida',
      repetida: true,
      operacionId: token.operacionId,
      estado: operacion.estado
    });
  }
}

function crearNotificacionEncolada({
  notificacionId,
  operacionId,
  destinatarioUsuarioId,
  actorRealId,
  actorEfectivoId,
  sujeto,
  emitidaEnUtc
}) {
  const contrato = CONTRATOS_NOTIFICACION_ELIMINACION_AGENTE
    [TIPOS_NOTIFICACION_ELIMINACION_AGENTE.ENCOLADA];
  return crearNotificacionEliminacionAdministrativaAgente({
    perfil: PERFIL_NOTIFICACION_OPERACION_ADMINISTRATIVA,
    version: 1,
    notificacionId,
    tipo: TIPOS_NOTIFICACION_ELIMINACION_AGENTE.ENCOLADA,
    operacionId,
    destinatarioUsuarioId,
    emisor: {
      tipo: EMISORES_NOTIFICACION_OPERACION_ADMINISTRATIVA.USUARIO,
      actorRealId,
      actorEfectivoId
    },
    emitidaEnUtc,
    estadoOperacion: ESTADOS_OPERACION_ADMINISTRATIVA.ENCOLADA,
    referenciaSujeto: {
      tipo: sujeto.tipo,
      id: sujeto.id,
      guid: sujeto.guid
    },
    leida: false,
    leidaEnUtc: null,
    tituloCodigo: contrato.tituloCodigo,
    resumenCodigo: contrato.resumenCodigo
  });
}

function sujetoContractual(sujeto) {
  return {
    tipo: sujeto.tipo,
    id: sujeto.id,
    guid: sujeto.guid,
    scope: sujeto.scope
  };
}

function sumarDias(instante, dias) {
  return new Date(Date.parse(instante) + dias * 86_400_000).toISOString();
}

function compararSeguro(izquierda, derecha) {
  const a = Buffer.from(String(izquierda || ''), 'utf8');
  const b = Buffer.from(String(derecha || ''), 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

function confirmacionInvalida() {
  return new ErrorAceptacionEliminacionAdministrativaAgente(
    'agente_eliminacion_confirmacion_invalida',
    'La confirmación de eliminación no es válida.'
  );
}

async function exigirAutoridadJerarquicaEstable(autoridad, entrada, conexion) {
  try {
    return await autoridad.exigirDisponibilidadEnTransaccion(
      entrada,
      { conexion }
    );
  } catch (error) {
    if (error?.codigo !== 'ruta_reserva_jerarquica_modificada') throw error;
    return autoridad.exigirDisponibilidadEnTransaccion(entrada, { conexion });
  }
}
