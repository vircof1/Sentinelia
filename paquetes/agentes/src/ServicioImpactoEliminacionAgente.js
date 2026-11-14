import { createHash } from 'node:crypto';

import { canonicalizarRfc8785 } from '../../auditoria/src/PerfilJcsAuditoria.js';
import { generarUuidV7Auditoria } from '../../auditoria/src/UuidV7Auditoria.js';
import {
  PERFIL_RESUMEN_IMPACTO_ELIMINACION_AGENTE,
  crearResumenImpactoEliminacionAgente
} from './ContratoEliminacionAdministrativaAgente.js';

export class ServicioImpactoEliminacionAgente {
  constructor({
    repositorioEliminacion,
    servicioAutorizacion,
    fronteraTransaccional,
    codecConfirmacion,
    generarUuid = generarUuidV7Auditoria
  } = {}) {
    if (
      typeof repositorioEliminacion?.cargarImpactoEnTransaccion !== 'function' ||
      typeof servicioAutorizacion?.autorizarEnTransaccion !== 'function' ||
      typeof fronteraTransaccional?.ejecutar !== 'function' ||
      typeof codecConfirmacion?.emitir !== 'function' ||
      typeof generarUuid !== 'function'
    ) {
      throw new Error('El servicio de impacto requiere todos sus puertos internos.');
    }
    this.repositorioEliminacion = repositorioEliminacion;
    this.servicioAutorizacion = servicioAutorizacion;
    this.fronteraTransaccional = fronteraTransaccional;
    this.codecConfirmacion = codecConfirmacion;
    this.generarUuid = generarUuid;
  }

  async preparar({
    actorRealId,
    actorEfectivoId = actorRealId,
    agenteId,
    csrfToken
  } = {}) {
    return this.fronteraTransaccional.ejecutar(async (conexion) => {
      await this.servicioAutorizacion.autorizarEnTransaccion(
        { actorRealId, actorEfectivoId, agenteId },
        { conexion }
      );
      const impacto = await this.calcularEnTransaccion(
        { agenteId, bloquearRaiz: true },
        { conexion }
      );
      const emitido = this.codecConfirmacion.emitir({
        actorRealId: String(actorRealId),
        actorEfectivoId: String(actorEfectivoId),
        agenteId: impacto.sujeto.id,
        agenteGuid: impacto.sujeto.guid,
        huellaEstructuralSha256: impacto.huellaEstructuralSha256,
        operacionId: this.generarUuid(),
        claveOperacion: this.generarUuid(),
        correlacionId: this.generarUuid(),
        eventoId: this.generarUuid()
      }, { csrfToken });
      return Object.freeze({
        sujeto: impacto.sujeto,
        resumenImpacto: impacto.resumenImpacto,
        huellaEstructuralSha256: impacto.huellaEstructuralSha256,
        fraseConfirmacion: impacto.fraseConfirmacion,
        tokenConfirmacion: emitido.token,
        expiraEnUtc: emitido.expiraEnUtc
      });
    });
  }

  async calcularEnTransaccion(
    { agenteId, bloquearRaiz = false } = {},
    { conexion } = {}
  ) {
    const impacto = await this.repositorioEliminacion.cargarImpactoEnTransaccion(
      { agenteId, bloquearRaiz },
      { conexion }
    );
    const canonica = canonicalizarRfc8785(impacto.fotografiaCanonica);
    const huella = createHash('sha256').update(canonica, 'utf8').digest('hex');
    const sujetoCanonico = impacto.fotografiaCanonica.sujeto;
    const sujeto = Object.freeze({
      tipo: 'agente',
      id: sujetoCanonico.id,
      guid: sujetoCanonico.guid,
      nombre: sujetoCanonico.nombre,
      descripcion: sujetoCanonico.descripcion,
      scope: sujetoCanonico.scope
    });
    return Object.freeze({
      sujeto,
      fotografiaCanonica: impacto.fotografiaCanonica,
      huellaEstructuralSha256: huella,
      resumenImpacto: crearResumenImpactoEliminacionAgente({
        perfil: PERFIL_RESUMEN_IMPACTO_ELIMINACION_AGENTE,
        version: 1,
        conteos: impacto.conteos
      }),
      fraseConfirmacion: crearFraseConfirmacion(sujeto.nombre, sujeto.guid)
    });
  }
}

export function crearFraseConfirmacion(nombre, guid) {
  const nombreExacto = String(nombre ?? '');
  const sufijo = String(guid || '').replaceAll('-', '').slice(-8);
  if (!nombreExacto || !/^[0-9a-f]{8}$/u.test(sufijo)) {
    throw new Error('No se puede construir la frase exacta del agente.');
  }
  return `${nombreExacto} ${sufijo}`;
}
