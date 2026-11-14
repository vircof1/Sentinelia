import {
  calcularConcesionEfectivaFederacion,
  esDeclaracionConcesionFederacion,
  esLimiteAutoridadActualFederacion
} from '../src/AutoridadConcesionFederacion.js';
import { crearRevisionConcesionFederacion } from '../src/RevisionConcesionFederacion.js';
import { compararSeleccionesConcesionFederacion } from '../src/RevisionConcesionFederacion.js';
import { validarUuidV7Auditoria } from '../../auditoria/src/UuidV7Auditoria.js';

const CAUSAS_CORTE = new Set([
  'usuarioInactivo', 'usuarioEliminado', 'scopePerdido', 'permisoPerdido',
  'organizacionMovida', 'organizacionEliminada', 'deshabilitacion',
  'eliminacionRelacion'
]);

export class ServicioControlFederacion {
  constructor({ repositorioControl } = {}) {
    for (const metodo of ['registrarRevision', 'cortarAutoridad', 'transferirResponsabilidad', 'deshabilitarRelacion', 'eliminarRelacion']) {
      if (typeof repositorioControl?.[metodo] !== 'function') {
        throw new Error(`El servicio de control federado requiere ${metodo}().`);
      }
    }
    this.repositorioControl = repositorioControl;
  }

  revisarDeclaracion(entrada = {}) {
    if (!['oferta', 'aceptacion'].includes(entrada.papel)) {
      throw new Error('Solo puede revisarse una oferta o aceptación local.');
    }
    if (!esDeclaracionConcesionFederacion(entrada.declaracion)) {
      throw new Error('La revisión exige una declaración nominal de concesión.');
    }
    if (!esLimiteAutoridadActualFederacion(entrada.autoridadActualLocal)) {
      throw new Error('La revisión exige la autoridad actual nominal del responsable.');
    }
    if (!['equivalente', 'reduccion'].includes(
      compararSeleccionesConcesionFederacion(
        entrada.autoridadActualLocal,
        entrada.declaracion
      )
    )) {
      throw new Error('La declaración excede la autoridad actual del responsable.');
    }
    return this.#registrar({
      ...entrada,
      revision: crearRevisionConcesionFederacion({
        revisionId: entrada.revisionId,
        papel: entrada.papel,
        seleccion: entrada.declaracion
      }),
      referencias: null
    });
  }

  consolidarRevisionEfectiva(entrada = {}) {
    const concesion = calcularConcesionEfectivaFederacion({
      ofertaEmisora: entrada.ofertaEmisora,
      aceptacionReceptora: entrada.aceptacionReceptora,
      autoridadActualEmisora: entrada.autoridadActualEmisora,
      autoridadActualReceptora: entrada.autoridadActualReceptora
    });
    return this.#registrar({
      ...entrada,
      papel: 'efectiva',
      revision: crearRevisionConcesionFederacion({
        revisionId: entrada.revisionId,
        papel: 'efectiva',
        seleccion: concesion
      }),
      referencias: {
        ofertaId: entrada.revisionOfertaId,
        aceptacionId: entrada.revisionAceptacionId,
        ofertaSeleccion: entrada.ofertaEmisora.toJSON(),
        aceptacionSeleccion: entrada.aceptacionReceptora.toJSON()
      },
      versionAutoridadRemota:
        entrada.versionAutoridadRemota ?? entrada.versionAutoridad
    });
  }

  cortarAutoridad(entrada = {}) {
    validarComun(entrada);
    if (!CAUSAS_CORTE.has(entrada.causa)) {
      throw new Error('La causa del corte de autoridad no pertenece al contrato.');
    }
    return this.repositorioControl.cortarAutoridad({
      relacionId: entrada.relacionId,
      causa: entrada.causa,
      auditoria: auditoria(entrada)
    });
  }

  transferirResponsabilidad(entrada = {}) {
    validarComun(entrada);
    decimal(entrada.nuevoResponsableUsuarioId, 'nuevoResponsableUsuarioId');
    validarScope(entrada.scope);
    if (!esLimiteAutoridadActualFederacion(entrada.autoridadActualNueva)) {
      throw new Error('La transferencia exige autoridad actual derivada del nuevo responsable.');
    }
    const autoridad = entrada.autoridadActualNueva.toJSON();
    const scopeAutoridad = autoridad.scopeLocalConfiguracion;
    if (!autoridad.activa || scopeAutoridad.nivel !== nivelScope(entrada.scope) ||
      scopeAutoridad.tenantId !== entrada.scope.tenantId ||
      scopeAutoridad.empresaId !== entrada.scope.empresaId ||
      scopeAutoridad.sitioId !== entrada.scope.sitioId) {
      throw new Error('La autoridad nueva no cubre el scope materializado de la relación.');
    }
    return this.repositorioControl.transferirResponsabilidad({
      relacionId: entrada.relacionId,
      nuevoResponsableUsuarioId: entrada.nuevoResponsableUsuarioId,
      scope: entrada.scope,
      auditoria: auditoria(entrada)
    });
  }

  deshabilitarRelacion(entrada = {}) {
    validarComun(entrada);
    return this.repositorioControl.deshabilitarRelacion({
      relacionId: entrada.relacionId, auditoria: auditoria(entrada)
    });
  }

  eliminarRelacion(entrada = {}) {
    validarComun(entrada);
    decimal(entrada.eliminadaPorUsuarioId, 'eliminadaPorUsuarioId');
    if (entrada.eliminadaPorUsuarioId !== entrada.actor.real.id) {
      throw new Error('El actor directo debe ser quien elimina la relación.');
    }
    return this.repositorioControl.eliminarRelacion({
      relacionId: entrada.relacionId,
      eliminadaPorUsuarioId: entrada.eliminadaPorUsuarioId,
      auditoria: auditoria(entrada)
    });
  }

  #registrar(entrada) {
    validarComun(entrada);
    decimal(entrada.responsableUsuarioId, 'responsableUsuarioId');
    if (entrada.responsableUsuarioId !== entrada.actor.real.id) {
      throw new Error('Solo el responsable actual puede autorizar una revisión de concesión.');
    }
    if (!Number.isSafeInteger(entrada.versionAutoridad) || entrada.versionAutoridad < 1) {
      throw new Error('versionAutoridad debe ser un entero positivo.');
    }
    return this.repositorioControl.registrarRevision({
      relacionId: entrada.relacionId,
      revision: entrada.revision,
      referencias: entrada.referencias,
      responsableUsuarioId: entrada.responsableUsuarioId,
      versionAutoridad: entrada.versionAutoridad,
      auditoria: auditoria(entrada)
    });
  }
}

function validarComun(entrada) {
  if (typeof entrada.relacionId !== 'string' || !entrada.relacionId.startsWith('sfid1.relacion.')) {
    throw new Error('relacionId no es válida.');
  }
  validarUuidV7Auditoria(entrada.eventoId, 'eventoId');
  validarUuidV7Auditoria(entrada.correlacionId, 'correlacionId');
  if (entrada.actor?.modo !== 'directo' || entrada.actor?.real?.tipo !== 'usuario' || entrada.actor.efectivo != null) {
    throw new Error('El control federado persistente exige una sesión humana directa.');
  }
}
function auditoria(e) { return { eventoId: e.eventoId, correlacionId: e.correlacionId, actor: e.actor }; }
function decimal(v, c) { if (typeof v !== 'string' || !/^[1-9][0-9]*$/.test(v)) throw new Error(`${c} debe ser decimal canónico.`); }
function validarScope(s) { if (!s || typeof s !== 'object') throw new Error('scope no es válido.'); for (const c of ['tenantId','empresaId','sitioId']) if (s[c] !== null) decimal(s[c], `scope.${c}`); if (s.tenantId === null && (s.empresaId !== null || s.sitioId !== null)) throw new Error('Scope jerárquico inválido.'); if (s.empresaId === null && s.sitioId !== null) throw new Error('Scope jerárquico inválido.'); }
function nivelScope(s) { return s.sitioId ? 'sitio' : s.empresaId ? 'empresa' : s.tenantId ? 'tenant' : 'portal'; }
