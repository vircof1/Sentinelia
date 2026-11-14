import { generarUuidV7Auditoria } from '../../auditoria/src/UuidV7Auditoria.js';
import {
  CLASES_IMPACTO_ELIMINACION_ORGANIZACION,
  PERFIL_RESUMEN_IMPACTO_ELIMINACION_ORGANIZACION,
  crearFraseConfirmacionEliminacionOrganizacion,
  crearResumenImpactoEliminacionOrganizacion
} from './ContratoEliminacionAdministrativaOrganizacion.js';

export class ServicioImpactoEliminacionOrganizacion {
  constructor({
    repositorioImpacto,
    servicioAutorizacion,
    codecConfirmacion,
    generarUuid = generarUuidV7Auditoria
  } = {}) {
    if (typeof repositorioImpacto?.cargarSujeto !== 'function' ||
        typeof repositorioImpacto?.cargarConteos !== 'function' ||
        typeof servicioAutorizacion?.comprobarVistaPrevia !== 'function' ||
        typeof codecConfirmacion?.emitir !== 'function' ||
        typeof generarUuid !== 'function') {
      throw new Error('La vista previa organizativa requiere todos sus puertos.');
    }
    Object.assign(this, {
      repositorioImpacto,
      servicioAutorizacion,
      codecConfirmacion,
      generarUuid
    });
  }

  async preparar({
    actorRealId,
    actorEfectivoId = actorRealId,
    sujeto,
    csrfToken
  } = {}) {
    const raiz = await this.repositorioImpacto.cargarSujeto(sujeto);
    await this.servicioAutorizacion.comprobarVistaPrevia({
      actorRealId,
      actorEfectivoId,
      sujeto: raiz
    });
    const conteos = await this.repositorioImpacto.cargarConteos({
      sujeto: raiz,
      actorEfectivoId
    });
    const resumenImpacto = crearResumenImpactoEliminacionOrganizacion({
      perfil: PERFIL_RESUMEN_IMPACTO_ELIMINACION_ORGANIZACION,
      version: 1,
      clase: CLASES_IMPACTO_ELIMINACION_ORGANIZACION.PREVIO,
      conteos
    });
    const sujetoCanonico = {
      tipo: raiz.tipo,
      id: raiz.id,
      scope: raiz.scope
    };
    const fraseConfirmacion = crearFraseConfirmacionEliminacionOrganizacion(
      sujetoCanonico
    );
    const emitido = this.codecConfirmacion.emitir({
      actorRealId: String(actorRealId),
      actorEfectivoId: String(actorEfectivoId),
      sujeto: raiz,
      operacionId: this.generarUuid(),
      claveOperacion: this.generarUuid(),
      correlacionId: this.generarUuid(),
      eventoId: this.generarUuid()
    }, { csrfToken });
    return congelar({
      sujeto: raiz,
      resumenImpacto,
      fraseConfirmacion,
      avisoAgregadoDinamico:
        'Se eliminará la raíz y todo lo que le pertenezca al ejecutar.',
      tokenConfirmacion: emitido.token,
      expiraEnUtc: emitido.expiraEnUtc
    });
  }
}

function congelar(valor) {
  if (valor && typeof valor === 'object' && !Object.isFrozen(valor)) {
    for (const hijo of Object.values(valor)) congelar(hijo);
    Object.freeze(valor);
  }
  return valor;
}
