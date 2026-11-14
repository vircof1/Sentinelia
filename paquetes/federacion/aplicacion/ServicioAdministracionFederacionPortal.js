import { generarUuidV7Auditoria } from '../../auditoria/src/UuidV7Auditoria.js';
import { TIPOS_IDENTIDAD_FEDERADA } from '../src/IdentidadFederada.js';
import { crearScopeFederacion } from '../src/ScopeFederacion.js';
import {
  crearDeclaracionConcesionFederacion,
  crearLimitesAutoridadActualFederacion,
  crearResponsabilidadFederada
} from '../src/AutoridadConcesionFederacion.js';
import {
  compararSeleccionesConcesionFederacion
} from '../src/RevisionConcesionFederacion.js';
import {
  listarContratosFamiliasFederacion,
  validarSelectorFamiliaFederacion
} from '../src/ContratosFamiliasFederacion.js';
import { canonicalizarJsonFederacion } from '../src/CanonicalizadorFederacion.js';

const ORDEN_NIVELES = Object.freeze(['portal', 'tenant', 'empresa', 'sitio']);
const VIGENCIA_PREVISUALIZACION_MS = 10 * 60 * 1000;

export class ServicioAdministracionFederacionPortal {
  constructor({
    repositorioRelaciones,
    servicioInvitaciones,
    servicioConfirmacionIdentidad,
    servicioContinuidad,
    servicioImportacion = null,
    servicioControl = null,
    servicioConsolidacion = null,
    servicioSincronizacion = null,
    servicioConflictos = null,
    guardiaActivacion = null,
    servicioAutorizacion,
    generadorIdentidades,
    installationId,
    bootId
  } = {}) {
    exigirMetodo(repositorioRelaciones, 'crearRecepcion', 'repositorioRelaciones');
    exigirMetodo(repositorioRelaciones, 'listarVisibles', 'repositorioRelaciones');
    exigirMetodo(servicioInvitaciones, 'emitir', 'servicioInvitaciones');
    exigirMetodo(servicioInvitaciones, 'revocar', 'servicioInvitaciones');
    exigirMetodo(
      servicioConfirmacionIdentidad,
      'confirmar',
      'servicioConfirmacionIdentidad'
    );
    exigirMetodo(servicioContinuidad, 'emitirRecuperacion', 'servicioContinuidad');
    exigirMetodo(servicioContinuidad, 'aprobarLocalizacion', 'servicioContinuidad');
    exigirMetodo(servicioAutorizacion, 'puedeAccederFederacion', 'servicioAutorizacion');
    exigirMetodo(generadorIdentidades, 'generar', 'generadorIdentidades');
    if (servicioConsolidacion !== null) {
      exigirMetodo(
        servicioConsolidacion,
        'consolidarRelacion',
        'servicioConsolidacion'
      );
    }
    if (servicioSincronizacion !== null) {
      exigirMetodo(servicioSincronizacion, 'sincronizar', 'servicioSincronizacion');
    }
    if (guardiaActivacion !== null) {
      exigirMetodo(guardiaActivacion, 'estaActiva', 'guardiaActivacion');
    }
    exigirIdentidad(installationId, 'instalacion', 'installationId');
    exigirIdentidad(bootId, 'arranque', 'bootId');
    this.repositorioRelaciones = repositorioRelaciones;
    this.servicioInvitaciones = servicioInvitaciones;
    this.servicioConfirmacionIdentidad = servicioConfirmacionIdentidad;
    this.servicioContinuidad = servicioContinuidad;
    this.servicioImportacion = servicioImportacion;
    this.servicioControl = servicioControl;
    this.servicioConsolidacion = servicioConsolidacion;
    this.servicioSincronizacion = servicioSincronizacion;
    this.servicioConflictos = servicioConflictos;
    this.guardiaActivacion = guardiaActivacion;
    this.servicioAutorizacion = servicioAutorizacion;
    this.generadorIdentidades = generadorIdentidades;
    this.installationId = installationId;
    this.bootId = bootId;
  }

  async obtenerPanel(contextoUsuarioActual) {
    this.#exigirAcceso(contextoUsuarioActual);
    const activacion = this.guardiaActivacion === null
      ? null
      : await this.guardiaActivacion.estaActiva();
    const scope = scopeContexto(contextoUsuarioActual);
    const relaciones = await this.repositorioRelaciones.listarVisibles({ scope });
    const permisos = this.#permisos(contextoUsuarioActual);
    const relacionesPresentadas = await Promise.all(relaciones.map(async (relacion) => {
      const responsablesTransferibles = permisos.transferirResponsabilidad &&
        relacion.estadoAutoridad === 'sinAutoridad' &&
        typeof this.repositorioRelaciones.listarResponsablesTransferibles === 'function'
        ? await this.repositorioRelaciones.listarResponsablesTransferibles({
            relacionId: relacion.relacionId,
            scopeSolicitante: scope
          })
        : [];
      return Object.freeze({
        ...relacion,
        flujos: Object.freeze([...(relacion.flujos ?? [])]),
        bloqueos: Object.freeze([...(relacion.bloqueos ?? [])]),
        gestionCredencialesPermitida:
          permisos.gestionarCredenciales &&
          relacion.responsableUsuarioId === String(contextoUsuarioActual.idUsuario) &&
          (relacion.direccion === 'emision'
            ? permisos.configurarEmisiones
            : permisos.configurarRecepciones),
        responsablesTransferibles: Object.freeze(responsablesTransferibles),
        concesionPresentada: this.#presentarConcesion(
          relacion,
          contextoUsuarioActual,
          permisos
        )
      });
    }));
    const conflictos = permisos.resolverConflictos &&
      typeof this.servicioConflictos?.listarAbiertos === 'function'
      ? await this.servicioConflictos.listarAbiertos()
      : [];
    const flujos = relacionesPresentadas.flatMap((relacion) => relacion.flujos ?? []);
    const bloqueos = relacionesPresentadas.reduce(
      (total, relacion) => total + (relacion.bloqueos?.length ?? 0),
      0
    );
    return Object.freeze({
      installationId: this.installationId,
      bootId: this.bootId,
      planoDatos: Object.freeze({
        activacion: activacion === null
          ? 'noDisponible'
          : activacion ? 'activa' : 'desactivada',
        totalFlujos: flujos.length,
        flujosOperativos: flujos.filter((flujo) =>
          ['operativoParcial', 'operativoCompleto'].includes(flujo.estado)
        ).length,
        bloqueos
      }),
      importacionDisponible: Boolean(this.servicioImportacion),
      sincronizacionDisponible: Boolean(this.servicioSincronizacion),
      catalogoConcesion: catalogoConcesion(),
      permisos: Object.freeze(permisos),
      relaciones: Object.freeze(relacionesPresentadas),
      conflictos: Object.freeze(conflictos)
    });
  }

  async previsualizarRevisionConcesion({
    contextoUsuarioActual,
    relacionId,
    seleccion
  } = {}) {
    const contexto = await this.#contextoEdicionConcesion(
      contextoUsuarioActual,
      relacionId
    );
    const declaracion = crearDeclaracionConcesionFederacion(normalizarSeleccion(
      seleccion,
      contexto.nivelesPermitidos
    ));
    const propuesta = declaracion.toJSON();
    const actual = contexto.revisionLocal?.seleccion ?? null;
    const claseCambio = actual
      ? compararSeleccionesConcesionFederacion(actual, propuesta)
      : 'inicial';
    if (claseCambio === 'equivalente') {
      throw new Error('La selección propuesta no cambia la declaración local vigente.');
    }
    const token = generarUuidV7Auditoria();
    const expiraEnMs = Date.now() + VIGENCIA_PREVISUALIZACION_MS;
    const instantanea = instantaneaConcesion(contexto.relacion);
    const impacto = resumirImpactoConcesion({
      actual,
      propuesta,
      efectiva: contexto.relacion.concesion.efectiva?.seleccion ?? null,
      claseCambio
    });
    return congelar({
      token,
      expiraEnMs,
      relacionId,
      papel: contexto.papelLocal,
      propuesta,
      claseCambio,
      impacto,
      instantanea,
      presentacion: {
        expiraEnUtc: new Date(expiraEnMs).toISOString(),
        revisionLocalActualId: contexto.revisionLocal?.revisionId ?? null,
        revisionEfectivaActualId:
          contexto.relacion.concesion.efectiva?.revisionId ?? null
      }
    });
  }

  async confirmarRevisionConcesion({
    contextoUsuarioActual,
    relacionId,
    token,
    previsualizacion
  } = {}) {
    if (!previsualizacion || token !== previsualizacion.token ||
        relacionId !== previsualizacion.relacionId) {
      throw new Error('La previsualización de concesión no es válida para esta relación.');
    }
    if (!Number.isSafeInteger(previsualizacion.expiraEnMs) ||
        Date.now() > previsualizacion.expiraEnMs) {
      throw new Error('La previsualización de concesión ha caducado; revísala de nuevo.');
    }
    const contexto = await this.#contextoEdicionConcesion(
      contextoUsuarioActual,
      relacionId
    );
    if (canonicalizarJsonFederacion(instantaneaConcesion(contexto.relacion)) !==
        canonicalizarJsonFederacion(previsualizacion.instantanea)) {
      throw new Error(
        'La concesión o la autoridad cambió desde la previsualización; revisa el impacto otra vez.'
      );
    }
    const declaracion = crearDeclaracionConcesionFederacion(normalizarSeleccion(
      previsualizacion.propuesta,
      contexto.nivelesPermitidos
    ));
    const actual = contexto.revisionLocal?.seleccion ?? null;
    if (actual && compararSeleccionesConcesionFederacion(actual, declaracion) === 'equivalente') {
      throw new Error('La declaración local ya contiene esa selección.');
    }
    exigirMetodo(this.servicioControl, 'revisarDeclaracion', 'servicioControl');
    const resultado = await this.servicioControl.revisarDeclaracion({
      relacionId,
      papel: contexto.papelLocal,
      declaracion,
      autoridadActualLocal: contexto.autoridadActual,
      revisionId: String(
        this.generadorIdentidades.generar(TIPOS_IDENTIDAD_FEDERADA.REVISION_CONCESION)
      ),
      responsableUsuarioId: String(contextoUsuarioActual.idUsuario),
      versionAutoridad: Number(contexto.relacion.versionAutoridad),
      actor: actorContexto(contextoUsuarioActual),
      ...identidadesOperacion()
    });
    const consolidacion = await this.servicioConsolidacion?.consolidarRelacion({
      relacionId,
      actor: actorContexto(contextoUsuarioActual)
    });
    return Object.freeze({ ...resultado, consolidacion: consolidacion ?? null });
  }

  async sincronizarConcesion({ contextoUsuarioActual, relacionId } = {}) {
    const contexto = await this.#contextoEdicionConcesion(
      contextoUsuarioActual,
      relacionId
    );
    if (contexto.relacion.direccion !== 'emision') {
      throw new Error(
        'La aceptación receptora se entrega al cliente emisor cuando este sincroniza; ' +
        'esta relación no abre una conexión inversa.'
      );
    }
    if (!contexto.revisionLocal) {
      throw new Error('Declara primero una oferta local antes de sincronizarla.');
    }
    exigirMetodo(this.servicioSincronizacion, 'sincronizar', 'servicioSincronizacion');
    return this.servicioSincronizacion.sincronizar({ relacionId });
  }

  crearRecepcion(contextoUsuarioActual) {
    this.#exigir(
      'puedeConfigurarRecepcionesFederacion',
      contextoUsuarioActual,
      'No tienes autoridad para configurar recepciones federadas.'
    );
    const ids = identidadesOperacion();
    return this.repositorioRelaciones.crearRecepcion({
      relacionId: String(
        this.generadorIdentidades.generar(TIPOS_IDENTIDAD_FEDERADA.RELACION)
      ),
      scope: scopeContexto(contextoUsuarioActual),
      actor: actorContexto(contextoUsuarioActual),
      ...ids
    });
  }

  emitirInvitacion({ contextoUsuarioActual, relacionId, ttlSegundos = 900 } = {}) {
    this.#exigirGestionCredenciales(contextoUsuarioActual);
    return this.servicioInvitaciones.emitir({
      relacionId,
      ttlSegundos,
      actor: actorContexto(contextoUsuarioActual),
      ...identidadesOperacion()
    });
  }

  revocarInvitacion({ contextoUsuarioActual, relacionId, invitacionId } = {}) {
    this.#exigirGestionCredenciales(contextoUsuarioActual);
    return this.servicioInvitaciones.revocar({
      relacionId,
      invitacionId,
      actor: actorContexto(contextoUsuarioActual),
      ...identidadesOperacion()
    });
  }

  confirmarIdentidad({
    contextoUsuarioActual,
    relacionId,
    installationRemotaId,
    nombreRemotoDeclarado
  } = {}) {
    this.#exigirGestionCredenciales(contextoUsuarioActual);
    return this.servicioConfirmacionIdentidad.confirmar({
      relacionId,
      installationRemotaId,
      nombreRemotoDeclarado,
      actor: actorContexto(contextoUsuarioActual),
      ...identidadesOperacion()
    });
  }

  emitirRecuperacion({ contextoUsuarioActual, relacionId, ttlSegundos = 900 } = {}) {
    this.#exigirGestionCredenciales(contextoUsuarioActual);
    return this.servicioContinuidad.emitirRecuperacion({
      relacionId,
      ttlSegundos,
      actor: actorContexto(contextoUsuarioActual),
      ...identidadesOperacion()
    });
  }

  aprobarLocalizacion({ contextoUsuarioActual, relacionId, localizacionId } = {}) {
    this.#exigirGestionCredenciales(contextoUsuarioActual);
    return this.servicioContinuidad.aprobarLocalizacion({
      relacionId,
      localizacionId,
      actor: actorContexto(contextoUsuarioActual),
      ...identidadesOperacion()
    });
  }

  importarInvitacion({ contextoUsuarioActual, representacion } = {}) {
    this.#exigir(
      'puedeConfigurarEmisionesFederacion',
      contextoUsuarioActual,
      'No tienes autoridad para configurar emisiones federadas.'
    );
    exigirMetodo(this.servicioImportacion, 'importarInvitacion', 'servicioImportacion');
    return this.servicioImportacion.importarInvitacion({
      representacion,
      actor: actorContexto(contextoUsuarioActual),
      scope: scopeContexto(contextoUsuarioActual)
    });
  }

  importarRecuperacion({ contextoUsuarioActual, representacion } = {}) {
    this.#exigirGestionCredenciales(contextoUsuarioActual);
    this.#exigir(
      'puedeConfigurarEmisionesFederacion',
      contextoUsuarioActual,
      'No tienes autoridad emisora actual para aplicar la recuperación.'
    );
    exigirMetodo(
      this.servicioImportacion,
      'importarRecuperacion',
      'servicioImportacion'
    );
    return this.servicioImportacion.importarRecuperacion({
      representacion,
      actor: actorContexto(contextoUsuarioActual),
      scope: scopeContexto(contextoUsuarioActual)
    });
  }

  async transferirResponsabilidad({
    contextoUsuarioActual,
    relacionId,
    nuevoResponsableUsuarioId
  } = {}) {
    this.#exigir(
      'puedeTransferirResponsabilidadFederacion',
      contextoUsuarioActual,
      'No tienes autoridad para transferir responsabilidades federadas.'
    );
    exigirMetodo(this.servicioControl, 'transferirResponsabilidad', 'servicioControl');
    exigirMetodo(
      this.repositorioRelaciones,
      'obtenerContextoTransferencia',
      'repositorioRelaciones'
    );
    const contexto = await this.repositorioRelaciones.obtenerContextoTransferencia({
      relacionId,
      nuevoResponsableUsuarioId: String(nuevoResponsableUsuarioId || ''),
      scopeSolicitante: scopeContexto(contextoUsuarioActual)
    });
    const permisoRequerido = contexto.direccion === 'emision'
      ? 'configurarEmisionesFederacion'
      : 'configurarRecepcionesFederacion';
    const scope = crearScopeFederacion({
      nivel: nivelScope(contexto.scope),
      ...contexto.scope
    });
    const responsabilidad = crearResponsabilidadFederada({
      usuarioId: contexto.responsable.usuarioId,
      activa: contexto.responsable.activa,
      scopeActual: crearScopeFederacion({
        nivel: nivelScope(contexto.responsable.scope),
        ...contexto.responsable.scope
      }),
      permisos: contexto.responsable.puedeConfigurar ? [permisoRequerido] : []
    });
    return this.servicioControl.transferirResponsabilidad({
      relacionId,
      nuevoResponsableUsuarioId: contexto.responsable.usuarioId,
      scope: contexto.scope,
      autoridadActualNueva: crearLimitesAutoridadActualFederacion({
        responsabilidad,
        permisoRequerido,
        scopeLocalConfiguracion: scope,
        nivelesScope: [scope.nivel],
        familias: {}
      }),
      actor: actorContexto(contextoUsuarioActual),
      ...identidadesOperacion()
    });
  }

  async deshabilitarRelacion({ contextoUsuarioActual, relacionId } = {}) {
    this.#exigirActivacion(contextoUsuarioActual);
    exigirMetodo(this.servicioControl, 'deshabilitarRelacion', 'servicioControl');
    await this.#exigirRelacionVisible(contextoUsuarioActual, relacionId);
    return this.servicioControl.deshabilitarRelacion({
      relacionId,
      actor: actorContexto(contextoUsuarioActual),
      ...identidadesOperacion()
    });
  }

  async eliminarRelacion({ contextoUsuarioActual, relacionId } = {}) {
    this.#exigirActivacion(contextoUsuarioActual);
    exigirMetodo(this.servicioControl, 'eliminarRelacion', 'servicioControl');
    await this.#exigirRelacionVisible(contextoUsuarioActual, relacionId);
    const actor = actorContexto(contextoUsuarioActual);
    return this.servicioControl.eliminarRelacion({
      relacionId,
      eliminadaPorUsuarioId: actor.real.id,
      actor,
      ...identidadesOperacion()
    });
  }

  resolverConflicto({
    contextoUsuarioActual,
    incidenteId,
    installationClonNuevaId,
    relacionesLegitimas,
    relacionesClon,
    relacionesNuevasClon
  } = {}) {
    if (nivelScope(scopeContexto(contextoUsuarioActual)) !== 'portal') {
      throw errorPermiso(
        'Resolver un clon transversal exige responsabilidad directa de portal.'
      );
    }
    this.#exigir(
      'puedeResolverConflictosFederacion',
      contextoUsuarioActual,
      'No tienes autoridad para resolver conflictos de identidad federada.'
    );
    exigirMetodo(this.servicioConflictos, 'resolver', 'servicioConflictos');
    return this.servicioConflictos.resolver({
      incidenteId,
      installationClonNuevaId,
      relacionesLegitimas,
      relacionesClon,
      relacionesNuevasClon,
      actor: actorContexto(contextoUsuarioActual),
      ...identidadesOperacion()
    });
  }

  #exigirAcceso(contexto) {
    if (!this.servicioAutorizacion.puedeAccederFederacion(contexto)) {
      throw errorPermiso('No tienes permiso para consultar la administración federada.');
    }
  }

  #exigirGestionCredenciales(contexto) {
    this.#exigir(
      'puedeGestionarCredencialesFederacion',
      contexto,
      'No tienes autoridad para gestionar credenciales federadas.'
    );
  }

  #exigirActivacion(contexto) {
    this.#exigir(
      'puedeActivarRelacionesFederacion',
      contexto,
      'No tienes autoridad para cambiar el ciclo de relaciones federadas.'
    );
  }

  async #exigirRelacionVisible(contexto, relacionId) {
    const visibles = await this.repositorioRelaciones.listarVisibles({
      scope: scopeContexto(contexto)
    });
    if (!visibles.some((relacion) => relacion.relacionId === relacionId)) {
      const error = new Error('La relación federada no existe en tu scope visible.');
      error.statusCode = 404;
      throw error;
    }
  }

  async #contextoEdicionConcesion(contexto, relacionId) {
    this.#exigirAcceso(contexto);
    if (!this.servicioAutorizacion.esSesionDirecta(contexto)) {
      throw errorPermiso('Revisar una concesión exige una sesión humana directa.');
    }
    const relaciones = await this.repositorioRelaciones.listarVisibles({
      scope: scopeContexto(contexto)
    });
    const relacion = relaciones.find((item) => item.relacionId === relacionId);
    if (!relacion) {
      const error = new Error('La relación federada no existe en tu scope visible.');
      error.statusCode = 404;
      throw error;
    }
    const papelLocal = relacion.direccion === 'emision' ? 'oferta' : 'aceptacion';
    const metodoPermiso = relacion.direccion === 'emision'
      ? 'puedeConfigurarEmisionesFederacion'
      : 'puedeConfigurarRecepcionesFederacion';
    this.#exigir(
      metodoPermiso,
      contexto,
      'No conservas el permiso direccional para revisar esta concesión.'
    );
    if (relacion.estadoAutoridad !== 'autorizada' ||
        relacion.responsableUsuarioId !== String(contexto.idUsuario)) {
      throw errorPermiso('Solo el responsable actual autorizado puede revisar la concesión.');
    }
    const scopeActual = crearScopeFederacion({
      nivel: nivelScope(scopeContexto(contexto)),
      ...scopeContexto(contexto)
    });
    const scopeRelacion = crearScopeFederacion({
      nivel: nivelScope(relacion.scope),
      tenantId: relacion.scope.tenantId,
      empresaId: relacion.scope.empresaId,
      sitioId: relacion.scope.sitioId
    });
    const permisoRequerido = relacion.direccion === 'emision'
      ? 'configurarEmisionesFederacion'
      : 'configurarRecepcionesFederacion';
    const nivelesPermitidos = ORDEN_NIVELES.slice(
      ORDEN_NIVELES.indexOf(scopeActual.nivel)
    );
    const responsabilidad = crearResponsabilidadFederada({
      usuarioId: String(contexto.idUsuario),
      activa: true,
      scopeActual,
      permisos: [permisoRequerido]
    });
    const autoridadActual = crearLimitesAutoridadActualFederacion({
      responsabilidad,
      permisoRequerido,
      scopeLocalConfiguracion: scopeRelacion,
      nivelesScope: nivelesPermitidos,
      familias: familiasMaximas()
    });
    if (!autoridadActual.toJSON().activa) {
      throw errorPermiso('El scope actual ya no cubre la configuración federada.');
    }
    return {
      relacion,
      papelLocal,
      revisionLocal: relacion.concesion[papelLocal],
      nivelesPermitidos,
      autoridadActual
    };
  }

  #presentarConcesion(relacion, contexto, permisos) {
    const concesion = relacion.concesion ?? Object.freeze({
      revision: null,
      oferta: null,
      aceptacion: null,
      efectiva: null
    });
    const papelLocal = relacion.direccion === 'emision' ? 'oferta' : 'aceptacion';
    const permitido = relacion.direccion === 'emision'
      ? permisos.configurarEmisiones
      : permisos.configurarRecepciones;
    const editable = permisos.sesionDirecta && permitido &&
      relacion.estadoAutoridad === 'autorizada' &&
      relacion.responsableUsuarioId === String(contexto.idUsuario);
    const nivel = nivelScope(scopeContexto(contexto));
    const nivelesPermitidos = ORDEN_NIVELES.slice(ORDEN_NIVELES.indexOf(nivel));
    return Object.freeze({
      papelLocal,
      editable,
      nivelesPermitidos: Object.freeze(nivelesPermitidos),
      seleccion: concesion[papelLocal]?.seleccion ?? Object.freeze({
        activa: true,
        nivelesScope: Object.freeze([nivel]),
        familias: Object.freeze({})
      }),
      revisionLocal: concesion[papelLocal],
      revisionContraparte: concesion[
        papelLocal === 'oferta' ? 'aceptacion' : 'oferta'
      ],
      revisionEfectiva: concesion.efectiva
    });
  }

  #exigir(metodo, contexto, mensaje) {
    if (!this.servicioAutorizacion[metodo](contexto)) throw errorPermiso(mensaje);
  }

  #permisos(contexto) {
    return {
      configurarEmisiones: this.servicioAutorizacion
        .puedeConfigurarEmisionesFederacion(contexto),
      configurarRecepciones: this.servicioAutorizacion
        .puedeConfigurarRecepcionesFederacion(contexto),
      gestionarCredenciales: this.servicioAutorizacion
        .puedeGestionarCredencialesFederacion(contexto),
      activarRelaciones: this.servicioAutorizacion
        .puedeActivarRelacionesFederacion(contexto),
      transferirResponsabilidad: this.servicioAutorizacion
        .puedeTransferirResponsabilidadFederacion(contexto),
      resolverConflictos: nivelScope(scopeContexto(contexto)) === 'portal' &&
        this.servicioAutorizacion.puedeResolverConflictosFederacion(contexto),
      verDiagnostico: this.servicioAutorizacion
        .puedeVerDiagnosticoFederacion(contexto),
      explorarDatosRemotos: this.servicioAutorizacion
        .puedeExplorarDatosRemotosFederacion(contexto),
      sesionDirecta: this.servicioAutorizacion.esSesionDirecta(contexto)
    };
  }
}

function nivelScope(scope) {
  return scope.sitioId
    ? 'sitio'
    : scope.empresaId
      ? 'empresa'
      : scope.tenantId
        ? 'tenant'
        : 'portal';
}

function catalogoConcesion() {
  return Object.freeze({
    niveles: Object.freeze([...ORDEN_NIVELES]),
    familias: Object.freeze(listarContratosFamiliasFederacion().map((contrato) =>
      Object.freeze({
        familia: contrato.familia,
        versionFamilia: contrato.versionFamilia,
        campoBase: contrato.selector.campoBase,
        camposSensibles: Object.freeze([...contrato.selector.camposSensibles])
      })))
  });
}

function familiasMaximas() {
  return Object.fromEntries(listarContratosFamiliasFederacion().map((contrato) => [
    contrato.familia,
    {
      campos: [contrato.selector.campoBase, ...contrato.selector.camposSensibles],
      permiteContenidoSensible: contrato.selector.camposSensibles.length > 0,
      permiteRefederacion: true
    }
  ]));
}

function normalizarSeleccion(seleccion, nivelesPermitidos) {
  if (!seleccion || typeof seleccion !== 'object' || Array.isArray(seleccion)) {
    throw new Error('La selección de concesión no es válida.');
  }
  const niveles = Array.isArray(seleccion.nivelesScope)
    ? [...new Set(seleccion.nivelesScope.map(String))]
    : [];
  if (niveles.length === 0 ||
      niveles.some((nivel) => !nivelesPermitidos.includes(nivel))) {
    throw new Error('Selecciona al menos un nivel de scope dentro de tu autoridad actual.');
  }
  if (!seleccion.familias || typeof seleccion.familias !== 'object' ||
      Array.isArray(seleccion.familias)) {
    throw new Error('Las familias seleccionadas no son válidas.');
  }
  const contratos = new Map(listarContratosFamiliasFederacion().map(
    (contrato) => [contrato.familia, contrato]
  ));
  const familias = {};
  for (const [familia, selector] of Object.entries(seleccion.familias)) {
    const contrato = contratos.get(familia);
    if (!contrato) throw new Error(`La familia ${familia} no pertenece al contrato vigente.`);
    familias[familia] = validarSelectorFamiliaFederacion({
      familia,
      campos: selector.campos,
      permiteContenidoSensible: selector.permiteContenidoSensible,
      permiteRefederacion: selector.permiteRefederacion
    });
    familias[familia] = {
      campos: familias[familia].campos,
      permiteContenidoSensible: familias[familia].permiteContenidoSensible,
      permiteRefederacion: familias[familia].permiteRefederacion
    };
  }
  return { activa: true, nivelesScope: niveles, familias };
}

function instantaneaConcesion(relacion) {
  return {
    versionAutoridad: relacion.versionAutoridad,
    estadoAutoridad: relacion.estadoAutoridad,
    responsableUsuarioId: relacion.responsableUsuarioId,
    revisionEstado: relacion.concesion.revision,
    ofertaId: relacion.concesion.oferta?.revisionId ?? null,
    aceptacionId: relacion.concesion.aceptacion?.revisionId ?? null,
    efectivaId: relacion.concesion.efectiva?.revisionId ?? null
  };
}

function resumirImpactoConcesion({ actual, propuesta, efectiva, claseCambio }) {
  const referencia = actual ?? { activa: true, nivelesScope: [], familias: {} };
  const cambios = diferenciasSeleccion(referencia, propuesta);
  const retiradasEfectivas = efectiva
    ? diferenciasSeleccion(efectiva, intersectarSelecciones(efectiva, propuesta)).retiradas
    : [];
  return congelar({
    claseCambio,
    incorporaciones: cambios.incorporaciones,
    retiradas: cambios.retiradas,
    retiradasEfectivas,
    conducta: ['reduccion', 'mixta'].includes(claseCambio)
      ? 'retiradaInmediataPendienteConsolidacion'
      : claseCambio === 'ampliacion'
        ? 'mantieneEfectivaHastaAprobacionBilateral'
        : 'esperaPrimeraConsolidacionBilateral'
  });
}

function diferenciasSeleccion(anterior, posterior) {
  const incorporaciones = [];
  const retiradas = [];
  diferenciasLista('scope', anterior.nivelesScope, posterior.nivelesScope,
    incorporaciones, retiradas);
  const familias = new Set([
    ...Object.keys(anterior.familias || {}),
    ...Object.keys(posterior.familias || {})
  ]);
  for (const familia of [...familias].sort()) {
    const a = anterior.familias?.[familia];
    const p = posterior.familias?.[familia];
    if (!a && p) incorporaciones.push(`familia:${familia}`);
    if (a && !p) retiradas.push(`familia:${familia}`);
    if (!a || !p) continue;
    diferenciasLista(`campo:${familia}`, a.campos, p.campos,
      incorporaciones, retiradas);
    diferenciasBooleano(`sensible:${familia}`, a.permiteContenidoSensible,
      p.permiteContenidoSensible, incorporaciones, retiradas);
    diferenciasBooleano(`refederacion:${familia}`, a.permiteRefederacion,
      p.permiteRefederacion, incorporaciones, retiradas);
  }
  return { incorporaciones, retiradas };
}

function diferenciasLista(prefijo, anterior = [], posterior = [], altas, bajas) {
  const a = new Set(anterior);
  const p = new Set(posterior);
  for (const valor of [...p].filter((item) => !a.has(item)).sort()) {
    altas.push(`${prefijo}:${valor}`);
  }
  for (const valor of [...a].filter((item) => !p.has(item)).sort()) {
    bajas.push(`${prefijo}:${valor}`);
  }
}

function diferenciasBooleano(nombre, anterior, posterior, altas, bajas) {
  if (!anterior && posterior) altas.push(nombre);
  if (anterior && !posterior) bajas.push(nombre);
}

function intersectarSelecciones(a, b) {
  const nivelesScope = a.nivelesScope.filter((nivel) => b.nivelesScope.includes(nivel));
  const familias = {};
  for (const [familia, selectorA] of Object.entries(a.familias || {})) {
    const selectorB = b.familias?.[familia];
    if (!selectorB) continue;
    familias[familia] = {
      campos: selectorA.campos.filter((campo) => selectorB.campos.includes(campo)),
      permiteContenidoSensible:
        selectorA.permiteContenidoSensible && selectorB.permiteContenidoSensible,
      permiteRefederacion:
        selectorA.permiteRefederacion && selectorB.permiteRefederacion
    };
  }
  return { activa: a.activa && b.activa, nivelesScope, familias };
}

function congelar(valor) {
  if (valor && typeof valor === 'object' && !Object.isFrozen(valor)) {
    Object.values(valor).forEach(congelar);
    Object.freeze(valor);
  }
  return valor;
}

function identidadesOperacion() {
  return {
    eventoId: generarUuidV7Auditoria(),
    correlacionId: generarUuidV7Auditoria()
  };
}

function actorContexto(contexto) {
  if (!contexto || contexto.impersonacionActiva) {
    throw errorPermiso('La administración persistente exige una sesión directa.');
  }
  return Object.freeze({
    modo: 'directo',
    real: Object.freeze({ tipo: 'usuario', id: String(contexto.idUsuario) }),
    efectivo: null
  });
}

function scopeContexto(contexto) {
  if (!contexto) throw errorPermiso('No existe contexto de usuario actual.');
  return Object.freeze({
    tenantId: decimalNullable(contexto.tenantId),
    empresaId: decimalNullable(contexto.empresaId),
    sitioId: decimalNullable(contexto.sitioId)
  });
}

function decimalNullable(valor) {
  if (valor == null) return null;
  const texto = String(valor);
  if (!/^[1-9][0-9]*$/u.test(texto)) throw new Error('El scope actual no es canónico.');
  return texto;
}

function errorPermiso(mensaje) {
  const error = new Error(mensaje);
  error.codigo = 'FEDERACION_PERMISO_DENEGADO';
  error.statusCode = 403;
  return error;
}

function exigirMetodo(objeto, metodo, nombre) {
  if (typeof objeto?.[metodo] !== 'function') {
    throw new Error(`${nombre} debe implementar ${metodo}().`);
  }
}

function exigirIdentidad(valor, tipo, campo) {
  if (!new RegExp(`^sfid1\\.${tipo}\\.[A-Za-z0-9_-]{21}[AQgw]$`, 'u')
    .test(String(valor || ''))) {
    throw new Error(`${campo} no es canónica.`);
  }
}
