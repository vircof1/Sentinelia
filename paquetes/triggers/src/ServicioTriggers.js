import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { generarUuidV7Auditoria } from '../../auditoria/src/UuidV7Auditoria.js';
import { PERFIL_JCS_AUDITORIA_V1 } from '../../auditoria/src/PerfilJcsAuditoria.js';
import { VERSION_ENCADENADO_AUDITORIA_V1 } from '../../auditoria/src/SobreCanonicoAuditoria.js';
import {
  crearSolicitudCapturaFederacion,
  OPERACIONES_CAPTURA_FEDERACION
} from '../../federacion/src/OperacionesCapturaTecnicaFederacion.js';
import {
  ESTRATEGIAS_EJECUCION_TRIGGER,
  listarTiposTriggerPorEstrategia,
  obtenerEstrategiaEjecucionTrigger
} from './CatalogoTiposTrigger.js';
import { ErrorConflictoRevisionTrigger }
  from './MutadorRevisionDeclaracionTriggerSql.js';

function clonarJsonSeguro(valor) {
  if (!valor || typeof valor !== 'object') {
    return null;
  }

  return JSON.parse(JSON.stringify(valor));
}

export class ServicioTriggers {
  constructor({
    repositorioTriggers,
    repositorioAsignacionesTriggerMonitor,
    repositorioEjecucionesTrigger = null,
    repositorioArbolTriggerCorreo = null,
    repositorioMonitores = null,
    validadorTrigger,
    resolutorEjecutorTrigger = null,
    fronteraTransaccional = null,
    servicioAuditoria = null,
    servicioConfiguracionPortal = null,
    capturadorFederacion = null,
    capturadorFederacionEjecuciones = null,
    repositorioPreparacionBajaEjecucionesCorreo = null,
    ahora = () => new Date()
  }) {
    this.repositorioTriggers = repositorioTriggers;
    this.repositorioAsignacionesTriggerMonitor =
      repositorioAsignacionesTriggerMonitor;
    this.repositorioEjecucionesTrigger = repositorioEjecucionesTrigger;
    this.repositorioArbolTriggerCorreo = repositorioArbolTriggerCorreo;
    this.repositorioMonitores = repositorioMonitores;
    this.validadorTrigger = validadorTrigger;
    this.resolutorEjecutorTrigger = resolutorEjecutorTrigger;
    this.fronteraTransaccional = fronteraTransaccional;
    this.servicioAuditoria = servicioAuditoria;
    this.servicioConfiguracionPortal = servicioConfiguracionPortal;
    if (capturadorFederacion !== null &&
        typeof capturadorFederacion?.capturarEnTransaccion !== 'function') {
      throw new Error('El capturador federado de triggers no es transaccional.');
    }
    this.capturadorFederacion = capturadorFederacion;
    if (capturadorFederacionEjecuciones !== null &&
        typeof capturadorFederacionEjecuciones?.capturarEjecucionEnTransaccion !==
          'function') {
      throw new Error('El capturador federado de ejecuciones no es transaccional.');
    }
    if (capturadorFederacionEjecuciones &&
        typeof fronteraTransaccional?.ejecutar !== 'function') {
      throw new Error('Las ejecuciones federables requieren frontera transaccional.');
    }
    this.capturadorFederacionEjecuciones = capturadorFederacionEjecuciones;
    this.repositorioPreparacionBajaEjecucionesCorreo =
      repositorioPreparacionBajaEjecucionesCorreo;
    this.ahora = ahora;
  }

  async listarTriggers() {
    const triggers = await this.repositorioTriggers.listar();
    return triggers.map((trigger) => trigger.serializarResumen());
  }

  async listarTriggersVisibles(contextoUsuarioActual) {
    const triggers = await this.repositorioTriggers.listarVisibles(
      contextoUsuarioActual
    );
    return triggers.map((trigger) => trigger.serializarResumen());
  }

  async listarTriggersPorIds(idsTrigger = []) {
    const triggers = await this.repositorioTriggers.listarPorIds(idsTrigger);
    return triggers.map((trigger) => trigger.serializarResumen());
  }

  async listarTriggersVisiblesPorIds(contextoUsuarioActual, idsTrigger = []) {
    const triggers = await this.repositorioTriggers.listarVisiblesPorIds(
      contextoUsuarioActual,
      idsTrigger
    );
    return triggers.map((trigger) => trigger.serializarResumen());
  }

  async resumirUsoOperativoPorTriggerIdsVisible(
    contextoUsuarioActual,
    idsTrigger = []
  ) {
    const repositorio = this.repositorioAsignacionesTriggerMonitor;

    if (
      !repositorio ||
      typeof repositorio.resumirUsoPorTriggerIdsVisible !== 'function'
    ) {
      return new Map();
    }

    return repositorio.resumirUsoPorTriggerIdsVisible(
      contextoUsuarioActual,
      idsTrigger
    );
  }

  async listarUltimasEjecucionesPorTriggerIdsVisible(
    contextoUsuarioActual,
    idsTrigger = []
  ) {
    const repositorio = this.repositorioEjecucionesTrigger;

    if (
      !repositorio ||
      typeof repositorio.listarUltimasPorTriggerIdsVisible !== 'function'
    ) {
      return new Map();
    }

    return repositorio.listarUltimasPorTriggerIdsVisible(
      contextoUsuarioActual,
      idsTrigger
    );
  }

  async buscarTriggerPorId(idTrigger) {
    const trigger = await this.repositorioTriggers.buscarPorId(idTrigger);
    return trigger ? trigger.serializarResumen() : null;
  }

  async buscarTriggerVisiblePorId(contextoUsuarioActual, idTrigger) {
    const trigger = await this.repositorioTriggers.buscarVisiblePorId(
      contextoUsuarioActual,
      idTrigger
    );
    return trigger ? trigger.serializarResumen() : null;
  }

  async buscarTriggerPorNombre(nombre) {
    const trigger = await this.repositorioTriggers.buscarPorNombre(nombre);
    return trigger ? trigger.serializarResumen() : null;
  }

  async crearTrigger(definicion, {
    contextoUsuarioActual = null,
    conexion = null
  } = {}) {
    const normalizado = this.validadorTrigger.normalizarDefinicionBase(definicion);
    if (normalizado.tipo === 'correo') {
      await this.exigirTipoCorreoHabilitado();
    }
    await this.exigirNombreTriggerDisponible(normalizado, null, { conexion });
    const crear = async ({ conexion = null } = {}) => {
      const trigger = await this.crearTriggerPersistido(normalizado, { conexion });
      await this.registrarEventoTrigger({
        conexion,
        contextoUsuarioActual,
        tipo: 'trigger.creado',
        trigger,
        payload: {
          resultado: 'creado',
          antes: null,
          despues: fotografiaTriggerAuditable(trigger)
        }
      });
      if (conexion) await this.capturarAdministracion({
        triggerIds: [trigger.id]
      }, conexion);
      return trigger;
    };
    const trigger = conexion
      ? await crear({ conexion })
      : this.auditoriaActiva(contextoUsuarioActual) || this.capturadorFederacion
        ? await this.fronteraTransaccional.ejecutar(
          (conexionNueva) => crear({ conexion: conexionNueva })
        )
        : await this.crearTriggerPersistido(normalizado);
    return trigger?.serializarResumen() || null;
  }

  async actualizarTrigger(
    idTrigger,
    definicion,
    { contextoUsuarioActual = null, conexion = null } = {}
  ) {
    const triggerExistente = await this.exigirTriggerExistente(idTrigger, { conexion });
    const revisionDeclaracion = exigirRevisionDeclaracion(
      definicion?.revisionDeclaracion ?? definicion?.revision_declaracion
    );
    if (revisionDeclaracion !== triggerExistente.revisionDeclaracion) {
      throw new ErrorConflictoRevisionTrigger({
        idTrigger: triggerExistente.id,
        revisionEsperada: revisionDeclaracion,
        revisionActual: triggerExistente.revisionDeclaracion
      });
    }
    const normalizado = this.validadorTrigger.normalizarDefinicionBase(definicion);
    if (normalizado.tipo !== triggerExistente.tipo) {
      throw new Error('El tipo de un trigger existente no se puede cambiar.');
    }
    if (normalizado.tipo === 'correo' &&
        !triggerExistente.activo && normalizado.activo) {
      await this.exigirTipoCorreoHabilitado();
    }
    await this.exigirNombreTriggerDisponible(
      normalizado,
      triggerExistente.id,
      { conexion }
    );
    const fotografiaAntes = fotografiaTriggerAuditable(triggerExistente);
    const definicionNormalizada = {
      idTrigger,
      ...normalizado,
      revisionDeclaracion
    };
    const fotografiaDespuesPrevista =
      fotografiaDefinicionTriggerAuditable(definicionNormalizada);
    // La auditoría omite contenido sensible; no define si cambió la declaración.
    const camposCambiados = calcularCamposCambiados(
      {
        ...fotografiaAntes,
        configuracion: serializarConfiguracion(triggerExistente.configuracion)
      },
      {
        ...fotografiaDespuesPrevista,
        configuracion: serializarConfiguracion(definicionNormalizada.configuracion)
      }
    );

    if (camposCambiados.length === 0) {
      return triggerExistente.serializarResumen();
    }

    const actualizar = async ({ conexion = null } = {}) => {
      const trigger = await this.actualizarTriggerPersistido(
        definicionNormalizada,
        { conexion }
      );
      await this.registrarEventoTrigger({
        conexion,
        contextoUsuarioActual,
        tipo: 'trigger.actualizado',
        trigger,
        payload: {
          resultado: 'actualizado',
          camposCambiados,
          antes: filtrarFotografiaPorCampos(fotografiaAntes, camposCambiados),
          despues: filtrarFotografiaPorCampos(
            fotografiaTriggerAuditable(trigger),
            camposCambiados
          )
        }
      });
      if (scopeCambio(fotografiaAntes, fotografiaTriggerAuditable(trigger))) {
        await this.registrarMovimientoScopeTrigger({
          conexion,
          contextoUsuarioActual,
          triggerAnterior: triggerExistente,
          triggerActual: trigger
        });
      }
      if (conexion) await this.capturarAdministracion({
        triggerIds: [trigger.id]
      }, conexion);
      return trigger;
    };
    const trigger = conexion
      ? await actualizar({ conexion })
      : this.auditoriaActiva(contextoUsuarioActual) || this.capturadorFederacion
        ? await this.fronteraTransaccional.ejecutar(
          (conexionNueva) => actualizar({ conexion: conexionNueva })
        )
        : await this.actualizarTriggerPersistido(definicionNormalizada);

    return trigger?.serializarResumen() || null;
  }

  async revocarObjetivosDnsZonaEnTransaccion({
    zonaId,
    contextoUsuarioActual
  }, { conexion } = {}) {
    return this.#revocarObjetivosDnsEnTransaccion({
      idObjetivo: zonaId,
      porRegistro: false,
      contextoUsuarioActual
    }, { conexion });
  }

  async revocarObjetivosDnsRegistroEnTransaccion({
    registroId,
    contextoUsuarioActual
  }, { conexion } = {}) {
    return this.#revocarObjetivosDnsEnTransaccion({
      idObjetivo: registroId,
      porRegistro: true,
      contextoUsuarioActual
    }, { conexion });
  }

  async #revocarObjetivosDnsEnTransaccion({
    idObjetivo,
    porRegistro,
    contextoUsuarioActual
  }, { conexion }) {
    if (!conexion?.execute) {
      throw new Error('La revocación DNS requiere la transacción de eliminación del objetivo.');
    }
    this.exigirRepositorioEjecuciones();
    const acciones = porRegistro
      ? await this.repositorioTriggers
        .listarDnsActivosPorRegistroEnTransaccion(idObjetivo, { conexion })
      : await this.repositorioTriggers
        .listarDnsActivosPorZonaEnTransaccion(idObjetivo, { conexion });
    for (const accion of acciones) {
      const deshabilitada = await this.repositorioTriggers.deshabilitar(accion.id, {
        conexion,
        revisionDeclaracion: accion.revisionDeclaracion
      });
      await this.registrarEventoTrigger({
        conexion,
        contextoUsuarioActual,
        tipo: 'trigger.actualizado',
        trigger: deshabilitada,
        payload: {
          resultado: 'actualizado',
          camposCambiados: ['activo'],
          antes: { activo: true },
          despues: { activo: false }
        }
      });
    }
    if (acciones.length > 0) {
      await this.capturarAdministracion({ triggerIds: acciones.map(({ id }) => id) }, conexion);
    }
    const opcionesCancelacion = { conexion, finalizadoEnUtc: this.ahora() };
    const canceladas = porRegistro
      ? await this.repositorioEjecucionesTrigger
        .cancelarDnsPendientesPorRegistroEnTransaccion(idObjetivo, opcionesCancelacion)
      : await this.repositorioEjecucionesTrigger
        .cancelarDnsPendientesPorZonaEnTransaccion(idObjetivo, opcionesCancelacion);
    for (const ejecucion of canceladas) {
      await this.capturadorFederacionEjecuciones?.capturarEjecucionEnTransaccion(
        { ejecucionId: ejecucion.id }, { conexion }
      );
    }
    return { accionesDeshabilitadas: acciones.length, ejecucionesCanceladas: canceladas.length };
  }

  async eliminarTrigger(idTrigger, {
    contextoUsuarioActual = null,
    revisionDeclaracion
  } = {}) {
    const trigger = await this.exigirTriggerExistente(idTrigger);
    const revisionEsperada = exigirRevisionDeclaracion(revisionDeclaracion);
    if (revisionEsperada !== trigger.revisionDeclaracion) {
      throw new ErrorConflictoRevisionTrigger({
        idTrigger: trigger.id,
        revisionEsperada,
        revisionActual: trigger.revisionDeclaracion
      });
    }
    if (!this.auditoriaActiva(contextoUsuarioActual) && !this.capturadorFederacion &&
        !this.repositorioPreparacionBajaEjecucionesCorreo) {
      return this.repositorioTriggers.eliminar(idTrigger, {
        revisionDeclaracion: revisionEsperada
      });
    }
    return this.fronteraTransaccional.ejecutar(async (conexion) => {
      await this.repositorioPreparacionBajaEjecucionesCorreo
        ?.prepararPorTriggerEnTransaccion(idTrigger, { conexion });
      if (this.capturadorFederacion) {
        await this.capturadorFederacion.capturarEnTransaccion({
          familia: 'triggersInformativos',
          prepararCapturas: ({ interfazCaptura }) =>
            interfazCaptura.prepararCapturaEnTransaccion(
              crearSolicitudCapturaFederacion(
                OPERACIONES_CAPTURA_FEDERACION.TRIGGERS_RETIRADA,
                { triggerId: idTrigger }
              ),
              { conexion }
            )
        }, { conexion });
      }
      const eliminado = await this.repositorioTriggers.eliminar(idTrigger, {
        conexion,
        revisionDeclaracion: revisionEsperada
      });
      if (eliminado) {
        await this.registrarEventoTrigger({
          conexion,
          contextoUsuarioActual,
          tipo: 'trigger.eliminado',
          trigger,
          payload: {
            resultado: 'eliminado',
            antes: fotografiaTriggerAuditable(trigger),
            despues: null,
            impactoResumen: null
          }
        });
      }
      return eliminado;
    });
  }

  async listarAsignacionesPorMonitor(idMonitor, opciones = {}) {
    const asignaciones =
      await this.repositorioAsignacionesTriggerMonitor.listarPorMonitorId(
        idMonitor,
        opciones
      );
    return asignaciones.map((asignacion) => asignacion.serializarResumen());
  }

  async buscarAsignacionMonitorTriggerPorId(idAsignacion) {
    const asignacion =
      await this.repositorioAsignacionesTriggerMonitor.buscarPorId(idAsignacion);

    if (!asignacion) {
      return null;
    }

    const [monitor, trigger] = await Promise.all([
      this.exigirMonitorExistente(asignacion.monitorId),
      this.exigirTriggerExistente(asignacion.triggerId)
    ]);

    return this.serializarAsignacionConConfiguracionEfectiva({
      asignacion,
      monitor,
      trigger
    });
  }

  async listarAsignacionesPorTrigger(idTrigger, opciones = {}) {
    const asignaciones =
      await this.repositorioAsignacionesTriggerMonitor.listarPorTriggerId(
        idTrigger,
        opciones
      );
    return asignaciones.map((asignacion) => asignacion.serializarResumen());
  }

  async listarAsignacionesPorMonitorIds(idsMonitor = [], opciones = {}) {
    const asignaciones =
      await this.repositorioAsignacionesTriggerMonitor.listarPorMonitorIds(
        idsMonitor,
        opciones
      );
    return asignaciones.map((asignacion) => asignacion.serializarResumen());
  }

  async crearAsignacionMonitorTrigger(
    definicion,
    { contextoUsuarioActual = null } = {}
  ) {
    const monitor = await this.exigirMonitorExistente(definicion.monitorId);
    const trigger = await this.exigirTriggerExistente(definicion.triggerId);
    const normalizado =
      this.validadorTrigger.normalizarAsignacionMonitorTrigger(definicion);
    if (trigger.tipo === 'correo' && normalizado.activo) {
      await this.exigirTipoCorreoHabilitado();
    }
    await this.exigirVinculoMonitorTriggerDisponible({
      monitorId: normalizado.monitorId,
      triggerId: normalizado.triggerId
    });

    this.validarConfiguracionEfectivaTrigger({
      trigger,
      configuracionOverride: normalizado.configuracionOverride
    });

    const crear = async ({ conexion = null } = {}) => {
      const asignacion =
        await this.repositorioAsignacionesTriggerMonitor.crear(normalizado, {
          conexion
        });
      await this.registrarEventoBindingTrigger({
        conexion,
        contextoUsuarioActual,
        tipo: 'trigger.binding_creado',
        asignacion,
        payload: {
          resultado: 'creado',
          antes: null,
          despues: fotografiaBindingTriggerAuditable(asignacion)
        }
      });
      if (conexion) await this.capturarAdministracion({
        asignacionIds: [asignacion.id]
      }, conexion);
      return asignacion;
    };
    const asignacion = this.auditoriaActiva(contextoUsuarioActual) ||
        this.capturadorFederacion
      ? await this.fronteraTransaccional.ejecutar((conexion) => crear({ conexion }))
      : await this.repositorioAsignacionesTriggerMonitor.crear(normalizado);

    return this.serializarAsignacionConConfiguracionEfectiva({
      asignacion,
      monitor,
      trigger
    });
  }

  async actualizarAsignacionMonitorTrigger(
    idAsignacion,
    definicion,
    { contextoUsuarioActual = null } = {}
  ) {
    const asignacionExistente =
      await this.repositorioAsignacionesTriggerMonitor.buscarPorId(idAsignacion);

    if (!asignacionExistente) {
      throw new Error('La asignación monitor-trigger no existe.');
    }

    const monitor = await this.exigirMonitorExistente(definicion.monitorId);
    const trigger = await this.exigirTriggerExistente(definicion.triggerId);
    const normalizado =
      this.validadorTrigger.normalizarAsignacionMonitorTrigger(definicion);
    if (trigger.tipo === 'correo' && normalizado.activo &&
        (Number(asignacionExistente.triggerId) !== Number(trigger.id) ||
          (!asignacionExistente.activo && normalizado.activo))) {
      await this.exigirTipoCorreoHabilitado();
    }
    await this.exigirVinculoMonitorTriggerDisponible({
      monitorId: normalizado.monitorId,
      triggerId: normalizado.triggerId,
      idAsignacionActual: asignacionExistente.id
    });

    this.validarConfiguracionEfectivaTrigger({
      trigger,
      configuracionOverride: normalizado.configuracionOverride
    });

    const fotografiaAntes = fotografiaBindingTriggerAuditable(asignacionExistente);
    const fotografiaDespuesPrevista =
      fotografiaDefinicionBindingTriggerAuditable(normalizado);
    const camposCambiados = calcularCamposCambiados(
      fotografiaAntes,
      fotografiaDespuesPrevista
    );

    if (camposCambiados.length === 0) {
      return this.serializarAsignacionConConfiguracionEfectiva({
        asignacion: asignacionExistente,
        monitor,
        trigger
      });
    }

    const actualizar = async ({ conexion = null } = {}) => {
      const asignacion =
        await this.repositorioAsignacionesTriggerMonitor.actualizar({
          idAsignacion,
          ...normalizado
        }, { conexion });
      await this.registrarEventoBindingTrigger({
        conexion,
        contextoUsuarioActual,
        tipo: 'trigger.binding_actualizado',
        asignacion,
        payload: {
          resultado: 'actualizado',
          camposCambiados,
          antes: filtrarFotografiaPorCampos(fotografiaAntes, camposCambiados),
          despues: filtrarFotografiaPorCampos(
            fotografiaBindingTriggerAuditable(asignacion),
            camposCambiados
          )
        }
      });
      if (conexion) await this.capturarAdministracion({
        asignacionIds: [asignacion.id]
      }, conexion);
      return asignacion;
    };
    const asignacion = this.auditoriaActiva(contextoUsuarioActual) ||
        this.capturadorFederacion
      ? await this.fronteraTransaccional.ejecutar((conexion) =>
          actualizar({ conexion })
        )
      : await this.repositorioAsignacionesTriggerMonitor.actualizar({
          idAsignacion,
          ...normalizado
        });

    return this.serializarAsignacionConConfiguracionEfectiva({
      asignacion,
      monitor,
      trigger
    });
  }

  async eliminarAsignacionMonitorTrigger(
    idAsignacion,
    { contextoUsuarioActual = null } = {}
  ) {
    const asignacion =
      await this.repositorioAsignacionesTriggerMonitor.buscarPorId(idAsignacion);

    if (!asignacion) {
      return false;
    }

    if (!this.auditoriaActiva(contextoUsuarioActual) && !this.capturadorFederacion &&
        !this.repositorioPreparacionBajaEjecucionesCorreo) {
      return this.repositorioAsignacionesTriggerMonitor.eliminar(idAsignacion);
    }

    return this.fronteraTransaccional.ejecutar(async (conexion) => {
      await this.repositorioPreparacionBajaEjecucionesCorreo
        ?.prepararPorAsignacionEnTransaccion(idAsignacion, { conexion });
      if (this.capturadorFederacion) {
        await this.capturadorFederacion.capturarEnTransaccion({
          familia: 'triggersInformativos',
          prepararCapturas: ({ interfazCaptura }) =>
            interfazCaptura.prepararCapturaEnTransaccion(
              crearSolicitudCapturaFederacion(
                OPERACIONES_CAPTURA_FEDERACION.TRIGGERS_RETIRADA,
                {
                  triggerId: asignacion.triggerId,
                  asignacionId: idAsignacion
                }
              ),
              { conexion }
            )
        }, { conexion });
      }
      const eliminado =
        await this.repositorioAsignacionesTriggerMonitor.eliminar(idAsignacion, {
          conexion
        });
      if (eliminado) {
        await this.registrarEventoBindingTrigger({
          conexion,
          contextoUsuarioActual,
          tipo: 'trigger.binding_eliminado',
          asignacion,
          payload: {
            resultado: 'eliminado',
            antes: fotografiaBindingTriggerAuditable(asignacion),
            despues: null,
            impactoResumen: null
          }
        });
      }
      return eliminado;
    });
  }

  capturarAdministracion({ triggerIds = [], asignacionIds = [] }, conexion) {
    if (!this.capturadorFederacion) return null;
    return this.capturadorFederacion.capturarEnTransaccion({
      familia: 'triggersInformativos',
      prepararCapturas: ({ selector, interfazCaptura }) => {
        const campoSensible = triggerIds.length > 0
          ? 'contenidoSensibleDefinicion'
          : 'contenidoSensibleAsignacion';
        const incluirContenidoSensible = selector.permiteContenidoSensible &&
          selector.campos.includes(campoSensible);
        return interfazCaptura.prepararCapturaEnTransaccion(
          crearSolicitudCapturaFederacion(
            OPERACIONES_CAPTURA_FEDERACION.TRIGGERS_ADMINISTRACION,
            {
              triggerIds,
              asignacionIds,
              incluirContenidoSensible,
              puedeFederarContenidoSensible: incluirContenidoSensible,
              monitorIdsVisibles: []
            }
          ),
          { conexion }
        );
      }
    }, { conexion });
  }

  async resolverDisparosDesdeTransiciones({
    aperturasAlerta = [],
    cierresAlerta = []
  } = {}) {
    const plan = [];
    const aperturas = await this.resolverDisparosPorEvento(
      aperturasAlerta,
      'apertura_alerta'
    );
    const cierres = await this.resolverDisparosPorEvento(
      cierresAlerta,
      'cierre_alerta'
    );

    plan.push(...aperturas, ...cierres);

    return {
      totalDisparos: plan.length,
      disparos: plan
    };
  }

  async registrarEjecucionPendiente({
    planDisparo,
    codigoResultado = 'pendiente',
    mensajeResultado = 'Ejecución planificada.',
    conexion = null
  }) {
    this.exigirRepositorioEjecuciones();
    const plan = this.validarPlanDisparo(planDisparo);
    this.exigirEstrategiaPlan(
      plan,
      ESTRATEGIAS_EJECUCION_TRIGGER.EFECTO_EXTERNO_DIFERIDO
    );
    const claveIdempotencia = this.construirClaveIdempotenciaPlan(plan);
    const definicion = {
      asignacionTriggerMonitorId: plan.asignacionId,
      triggerId: plan.triggerId,
      monitorId: plan.monitorId,
      tenantId: plan.transicion?.tenantId ?? null,
      empresaId: plan.transicion?.empresaId ?? null,
      sitioId: plan.transicion?.sitioId ?? null,
      monitorTenantId: plan.transicion?.tenantId ?? null,
      monitorEmpresaId: plan.transicion?.empresaId ?? null,
      monitorSitioId: plan.transicion?.sitioId ?? null,
      triggerTenantId: plan.trigger?.tenantId ?? null,
      triggerEmpresaId: plan.trigger?.empresaId ?? null,
      triggerSitioId: plan.trigger?.sitioId ?? null,
      versionCatalogo: plan.transicion?.versionCatalogo ?? null,
      claveIdempotencia,
      eventoDisparo: plan.eventoDisparo,
      estadoEjecucion: 'pendiente',
      tipoTrigger: plan.tipoTrigger,
      triggerNombre: plan.nombreTrigger,
      monitorNombre: plan.transicion?.nombreMonitor || null,
      codigoResultado,
      mensajeResultado,
      payloadSolicitud: this.construirPayloadSolicitudDesdePlan(plan),
      payloadRespuesta: null,
      payloadError: null,
      iniciadoEnUtc: new Date(),
      finalizadoEnUtc: null
    };
    const resultado = typeof this.repositorioEjecucionesTrigger.crearIdempotente === 'function'
      ? await this.repositorioEjecucionesTrigger.crearIdempotente(definicion, { conexion })
      : {
          ejecucion: await this.repositorioEjecucionesTrigger.crear(definicion),
          creada: true
        };
    const ejecucion = resultado.ejecucion;

    return {
      ...(ejecucion?.serializarResumen?.() || ejecucion || {}),
      creada: Boolean(resultado.creada)
    };
  }

  construirClaveIdempotenciaPlan(plan) {
    const identidadTransicion = plan.transicion?.causalidadFederada
      ?.transicionMonitorId || plan.transicion?.alertaAuditoriaId;
    if (!identidadTransicion) {
      throw new Error('El plan de trigger requiere identidad causal de alerta o monitor.');
    }
    return createHash('sha256').update([
      plan.eventoDisparo,
      identidadTransicion,
      plan.asignacionId,
      plan.triggerId
    ].join(':')).digest('hex');
  }

  async listarEjecucionesPendientes({ limit = 100 } = {}) {
    this.exigirRepositorioEjecuciones();
    if (typeof this.repositorioEjecucionesTrigger.listarPendientes !== 'function') {
      return [];
    }
    const ejecuciones = await this.repositorioEjecucionesTrigger.listarPendientes({
      limit,
      tiposTrigger: listarTiposTriggerPorEstrategia(
        ESTRATEGIAS_EJECUCION_TRIGGER.EFECTO_EXTERNO_DIFERIDO
      )
    });
    return ejecuciones.map((ejecucion) => ejecucion.serializarResumen());
  }

  async diagnosticarIntegridadEstrategiasEjecucion({ limit = 100 } = {}) {
    this.exigirRepositorioEjecuciones();
    if (typeof this.repositorioEjecucionesTrigger.listarNoTerminalesPorTipos !==
        'function') {
      throw new Error(
        'El repositorio de ejecuciones no permite diagnosticar estrategias no terminales.'
      );
    }
    const tiposAtomicos = listarTiposTriggerPorEstrategia(
      ESTRATEGIAS_EJECUCION_TRIGGER.ACEPTACION_SQL_ATOMICA
    );
    const incompatibles = await this.repositorioEjecucionesTrigger
      .listarNoTerminalesPorTipos({ tiposTrigger: tiposAtomicos, limit });
    return Object.freeze({
      ok: incompatibles.length === 0,
      estrategia: ESTRATEGIAS_EJECUCION_TRIGGER.ACEPTACION_SQL_ATOMICA,
      tipos: Object.freeze([...tiposAtomicos]),
      totalIncompatibles: incompatibles.length,
      limite: Number(limit),
      ejecuciones: Object.freeze(incompatibles.map((ejecucion) => Object.freeze({
        id: ejecucion.id,
        tipoTrigger: ejecucion.tipoTrigger,
        estadoEjecucion: ejecucion.estadoEjecucion
      })))
    });
  }

  async exigirIntegridadEstrategiasEjecucion(opciones = {}) {
    const diagnostico = await this.diagnosticarIntegridadEstrategiasEjecucion(opciones);
    if (!diagnostico.ok) {
      const muestra = diagnostico.ejecuciones
        .slice(0, 5)
        .map(({ id, tipoTrigger, estadoEjecucion }) =>
          `#${id}:${tipoTrigger}:${estadoEjecucion}`)
        .join(', ');
      throw Object.assign(
        new Error(
          `Integridad de triggers rota: existen ejecuciones de aceptación SQL atómica fuera de su transacción (${muestra}).`
        ),
        {
          codigo: 'ejecucion_trigger_atomica_no_terminal',
          diagnostico
        }
      );
    }
    const correoAceptado = this.repositorioArbolTriggerCorreo
      ? await this.repositorioArbolTriggerCorreo
        .exigirIntegridadEjecucionesAceptadas(opciones)
      : null;
    return Object.freeze({ ...diagnostico, correoAceptado });
  }

  async marcarEjecucionEjecutando(idEjecucion, payload = {}) {
    this.exigirRepositorioEjecuciones();
    const ejecucion = await this.repositorioEjecucionesTrigger.marcarEjecutando(
      idEjecucion,
      payload
    );
    return ejecucion?.serializarResumen?.() || null;
  }

  async finalizarEjecucionTrigger({
    idEjecucion,
    estadoEjecucion,
    codigoResultado = null,
    mensajeResultado = null,
    payloadRespuesta = null,
    payloadError = null,
    finalizadoEnUtc = new Date()
  }) {
    this.exigirRepositorioEjecuciones();
    const finalizar = async (conexion = null) => {
      const entrada = {
        idEjecucion,
        estadoEjecucion,
        codigoResultado,
        mensajeResultado,
        payloadRespuesta,
        payloadError,
        finalizadoEnUtc
      };
      const resultado = typeof this.repositorioEjecucionesTrigger.finalizarReclamada ===
          'function'
        ? await this.repositorioEjecucionesTrigger.finalizarReclamada(
            entrada,
            { conexion }
          )
        : {
            resultado: 'actualizada',
            estadoEjecucion: String(estadoEjecucion || '').trim().toLowerCase(),
            ejecucion: await this.repositorioEjecucionesTrigger.actualizarResultado(
              entrada,
              { conexion }
            )
          };
      if (resultado.resultado === 'fuente_eliminada') {
        return this.construirFinalizacionTriggerDescartada({
          idEjecucion,
          estadoEjecucion: resultado.estadoEjecucion || estadoEjecucion,
          finalizadoEnUtc
        });
      }
      const ejecucion = resultado.ejecucion;
      if (resultado.resultado === 'actualizada' && conexion &&
          this.capturadorFederacionEjecuciones &&
          ['ok', 'error'].includes(
            resultado.estadoEjecucion || ejecucion?.estadoEjecucion
          )) {
        await this.capturadorFederacionEjecuciones.capturarEjecucionEnTransaccion(
          { ejecucionId: idEjecucion },
          { conexion }
        );
      }
      return ejecucion?.serializarResumen?.() || null;
    };
    return this.capturadorFederacionEjecuciones
      ? this.fronteraTransaccional.ejecutar(finalizar)
      : finalizar();
  }

  construirFinalizacionTriggerDescartada({
    idEjecucion,
    estadoEjecucion,
    finalizadoEnUtc
  }) {
    const idNormalizado = Number.parseInt(String(idEjecucion), 10);
    const fecha = finalizadoEnUtc instanceof Date
      ? finalizadoEnUtc
      : new Date(finalizadoEnUtc);
    return Object.freeze({
      id: Number.isSafeInteger(idNormalizado) ? idNormalizado : String(idEjecucion),
      estadoEjecucion: 'descartada',
      codigoResultado: 'fuente_eliminada',
      mensajeResultado:
        'La ejecución fue retirada con su fuente antes de persistir el resultado.',
      motivoDescarte: 'fuente_eliminada',
      estadoResultadoDisperso: estadoEjecucion,
      finalizadoEnUtc: Number.isNaN(fecha.getTime()) ? null : fecha.toISOString(),
      descartada: true,
      persistida: false,
      federada: false
    });
  }

  async listarEjecucionesPorMonitor(idMonitor, opciones = {}) {
    this.exigirRepositorioEjecuciones();
    const ejecuciones =
      await this.repositorioEjecucionesTrigger.listarPorMonitorId(
        idMonitor,
        opciones
      );
    return ejecuciones.map((ejecucion) => ejecucion.serializarResumen());
  }

  async listarEjecucionesPorTrigger(idTrigger, opciones = {}) {
    this.exigirRepositorioEjecuciones();
    const ejecuciones =
      await this.repositorioEjecucionesTrigger.listarPorTriggerId(
        idTrigger,
        opciones
      );
    return ejecuciones.map((ejecucion) => ejecucion.serializarResumen());
  }

  async listarEjecucionesRecientesPorMonitorIds(idsMonitor = [], opciones = {}) {
    this.exigirRepositorioEjecuciones();
    const ejecuciones =
      await this.repositorioEjecucionesTrigger.listarRecientesPorMonitorIds(
        idsMonitor,
        opciones
      );
    return ejecuciones.map((ejecucion) => ejecucion.serializarResumen());
  }

  resolverEjecutorParaPlanDisparo(planDisparo) {
    const plan = this.validarPlanDisparo(planDisparo);

    if (!this.resolutorEjecutorTrigger) {
      throw new Error(
        'El servicio de triggers no dispone de resolutor de ejecutores configurado.'
      );
    }

    this.exigirEstrategiaPlan(
      plan,
      ESTRATEGIAS_EJECUCION_TRIGGER.EFECTO_EXTERNO_DIFERIDO
    );
    return this.resolutorEjecutorTrigger
      .resolverManejadorDiferidoPorTipo(plan.tipoTrigger);
  }

  resolverEstrategiaParaPlanDisparo(planDisparo) {
    const plan = this.validarPlanDisparo(planDisparo);
    const estrategia = obtenerEstrategiaEjecucionTrigger(plan.tipoTrigger);
    if (plan.estrategiaEjecucion && plan.estrategiaEjecucion !== estrategia) {
      throw Object.assign(
        new Error('La estrategia fotografiada en el plan no coincide con su tipo de trigger.'),
        { codigo: 'estrategia_trigger_plan_incoherente' }
      );
    }
    return estrategia;
  }

  async aceptarPlanAtomicoEnTransaccion({ planDisparo, conexion = null } = {}) {
    const plan = this.validarPlanDisparo(planDisparo);
    this.exigirEstrategiaPlan(
      plan,
      ESTRATEGIAS_EJECUCION_TRIGGER.ACEPTACION_SQL_ATOMICA
    );
    if (!conexion) {
      throw Object.assign(
        new Error('La aceptación atómica de un trigger exige una conexión SQL prestada.'),
        { codigo: 'conexion_sql_trigger_atomico_ausente' }
      );
    }
    if (!this.resolutorEjecutorTrigger) {
      throw new Error('El servicio de triggers no dispone de resolutor configurado.');
    }
    const manejador = this.resolutorEjecutorTrigger
      .resolverManejadorAtomicoPorTipo(plan.tipoTrigger);
    return manejador.aceptarEnTransaccion({ planDisparo: plan, conexion });
  }

  async resolverDisparosPorEvento(transiciones = [], eventoDisparo) {
    if (!Array.isArray(transiciones) || transiciones.length === 0) {
      return [];
    }

    const monitorIds = Array.from(
      new Set(
        transiciones
          .map((transicion) => Number.parseInt(String(transicion?.monitorId), 10))
          .filter((id) => Number.isInteger(id) && id > 0)
      )
    );

    if (monitorIds.length === 0) {
      return [];
    }

    const asignaciones =
      await this.repositorioAsignacionesTriggerMonitor
        .listarAplicablesPorMonitorIdsYEventoDisparo(monitorIds, eventoDisparo, {
          soloActivas: true
        });

    if (asignaciones.length === 0) {
      return [];
    }

    const triggers = await this.repositorioTriggers.listarPorIds(
      Array.from(new Set(asignaciones.map((asignacion) => asignacion.triggerId)))
    );
    const triggersPorId = new Map(triggers.map((trigger) => [trigger.id, trigger]));
    const transicionesPorMonitor = new Map(
      transiciones.map((transicion) => [Number(transicion.monitorId), transicion])
    );
    const plan = [];

    for (const asignacion of asignaciones) {
      const trigger = triggersPorId.get(asignacion.triggerId) || null;
      const transicion = transicionesPorMonitor.get(asignacion.monitorId) || null;

      if (!trigger || !trigger.activo || !transicion) {
        continue;
      }

      plan.push(
        this.construirPlanDisparo({
          trigger,
          asignacion,
          transicion,
          eventoDisparo
        })
      );
    }

    return plan;
  }

  construirPlanDisparo({ trigger, asignacion, transicion, eventoDisparo }) {
    const configuracionEfectiva = this.validadorTrigger.construirConfiguracionEfectiva(
      {
        tipo: trigger.tipo,
        configuracionBase:
          typeof trigger.configuracion?.serializar === 'function'
            ? trigger.configuracion.serializar()
            : trigger.configuracion,
        configuracionOverride: asignacion.configuracionOverride
      }
    );
    const estrategiaEjecucion = obtenerEstrategiaEjecucionTrigger(trigger.tipo);

    return {
      eventoDisparo,
      monitorId: asignacion.monitorId,
      triggerId: trigger.id,
      tipoTrigger: trigger.tipo,
      nombreTrigger: trigger.nombre,
      asignacionId: asignacion.id,
      ordenEjecucion: asignacion.ordenEjecucion,
      estrategiaEjecucion,
      trigger: trigger.serializarResumen(),
      asignacion: asignacion.serializarResumen(),
      transicion: clonarJsonSeguro(transicion),
      configuracionEfectiva
    };
  }

  construirPayloadSolicitudDesdePlan(planDisparo) {
    return {
      eventoDisparo: planDisparo.eventoDisparo,
      triggerId: planDisparo.triggerId,
      triggerNombre: planDisparo.nombreTrigger,
      tipoTrigger: planDisparo.tipoTrigger,
      estrategiaEjecucion: this.resolverEstrategiaParaPlanDisparo(planDisparo),
      triggerScope: {
        tenantId: planDisparo.trigger?.tenantId ?? null,
        empresaId: planDisparo.trigger?.empresaId ?? null,
        sitioId: planDisparo.trigger?.sitioId ?? null,
        nivelPertenencia: planDisparo.trigger?.nivelPertenencia ?? 'sin_scope'
      },
      monitorId: planDisparo.monitorId,
      monitorScope: {
        tenantId: planDisparo.transicion?.tenantId ?? null,
        empresaId: planDisparo.transicion?.empresaId ?? null,
        sitioId: planDisparo.transicion?.sitioId ?? null,
        nivelPertenencia:
          planDisparo.transicion?.sitioId == null ? 'empresa' : 'sitio'
      },
      asignacionId: planDisparo.asignacionId,
      ordenEjecucion: planDisparo.ordenEjecucion,
      configuracionEfectiva: clonarJsonSeguro(planDisparo.configuracionEfectiva),
      transicion: clonarJsonSeguro(planDisparo.transicion)
    };
  }

  validarConfiguracionEfectivaTrigger({
    trigger,
    configuracionOverride = null
  }) {
    return this.validadorTrigger.construirConfiguracionEfectiva({
      tipo: trigger.tipo,
      configuracionBase:
        typeof trigger.configuracion?.serializar === 'function'
          ? trigger.configuracion.serializar()
          : trigger.configuracion,
      configuracionOverride
    });
  }

  async exigirTipoCorreoHabilitado() {
    await this.servicioConfiguracionPortal?.asegurarActualizada?.();
    const estado = this.servicioConfiguracionPortal
      ?.obtenerEstadoDespliegueCorreoActual?.();
    if (Number(estado?.tipo_correo_habilitado) !== 1) {
      throw Object.assign(
        new Error('El tipo de trigger correo permanece cerrado por el perfil de despliegue.'),
        { codigo: 'trigger_correo_no_habilitado', statusCode: 409 }
      );
    }
  }

  serializarAsignacionConConfiguracionEfectiva({
    asignacion,
    monitor = null,
    trigger = null
  }) {
    const resumen = asignacion?.serializarResumen?.() || null;

    if (!resumen || !trigger) {
      return resumen;
    }

    return {
      ...resumen,
      monitor: monitor?.serializarResumen?.() || null,
      trigger: trigger.serializarResumen(),
      configuracionEfectiva: this.validarConfiguracionEfectivaTrigger({
        trigger,
        configuracionOverride: resumen.configuracionOverride
      })
    };
  }

  async exigirTriggerExistente(idTrigger, { conexion = null } = {}) {
    const trigger = await this.repositorioTriggers.buscarPorId(idTrigger, { conexion });

    if (!trigger) {
      throw new Error('El trigger indicado no existe.');
    }

    return trigger;
  }

  async exigirNombreTriggerDisponible(
    definicion,
    idTriggerActual = null,
    { conexion = null } = {}
  ) {
    const trigger = await this.repositorioTriggers.buscarPorNombreEnScope({
      nombre: definicion?.nombre,
      tenantId: definicion?.tenantId,
      empresaId: definicion?.empresaId,
      sitioId: definicion?.sitioId
    }, { conexion });

    if (!trigger) {
      return true;
    }

    if (idTriggerActual != null && Number(trigger.id) === Number(idTriggerActual)) {
      return true;
    }

    throw new Error('Ya existe un trigger con ese nombre dentro de ese scope.');
  }

  async crearTriggerPersistido(definicion, { conexion = null } = {}) {
    try {
      return await this.repositorioTriggers.crear(definicion, { conexion });
    } catch (error) {
      throw this.normalizarErrorNombreDuplicado(error);
    }
  }

  async actualizarTriggerPersistido(definicion, { conexion = null } = {}) {
    try {
      return await this.repositorioTriggers.actualizar(definicion, { conexion });
    } catch (error) {
      throw this.normalizarErrorNombreDuplicado(error);
    }
  }

  normalizarErrorNombreDuplicado(error) {
    if (error?.code === 'ER_DUP_ENTRY') {
      return new Error(
        'Ya existe un trigger con ese nombre dentro de ese scope.'
      );
    }

    return error;
  }

  auditoriaActiva(contextoUsuarioActual) {
    return Boolean(
      contextoUsuarioActual &&
      this.fronteraTransaccional?.ejecutar &&
      this.servicioAuditoria?.registrarEnTransaccion
    );
  }

  registrarEventoTrigger({
    conexion,
    contextoUsuarioActual,
    tipo,
    trigger,
    payload
  }) {
    if (!this.auditoriaActiva(contextoUsuarioActual)) {
      return null;
    }

    const eventoId = generarUuidV7Auditoria();
    const scope = scopeDesdeTrigger(trigger);
    return this.servicioAuditoria.registrarEnTransaccion({
      cambioEfectivo: true,
      intencion: {
        versionContrato: 1,
        eventoId,
        tipo,
        flujo: 'automatizacion',
        claveCadena: claveCadenaAutomatizacion(scope),
        actor: 'usuario',
        actorReal: actorReal(contextoUsuarioActual),
        actorEfectivo: actorEfectivo(contextoUsuarioActual),
        modoActuacion: contextoUsuarioActual?.impersonacionActiva
          ? 'impersonado'
          : 'directo',
        sujeto: { tipo: 'trigger', id: String(trigger.id) },
        origen: 'web',
        correlacionId: eventoId,
        causalidad: null,
        productor: 'portal_web',
        claveOperacion: eventoId,
        scope,
        efectivoEnUtc: this.ahora().toISOString(),
        rolEvento: 'principal',
        payload,
        versionCanonicalizador: PERFIL_JCS_AUDITORIA_V1,
        versionEncadenado: VERSION_ENCADENADO_AUDITORIA_V1
      }
    }, { conexion });
  }

  registrarEventoBindingTrigger({
    conexion,
    contextoUsuarioActual,
    tipo,
    asignacion,
    payload
  }) {
    if (!this.auditoriaActiva(contextoUsuarioActual)) {
      return null;
    }

    const eventoId = generarUuidV7Auditoria();
    const scope = scopeDesdeBindingTrigger(asignacion);
    return this.servicioAuditoria.registrarEnTransaccion({
      cambioEfectivo: true,
      intencion: {
        versionContrato: 1,
        eventoId,
        tipo,
        flujo: 'automatizacion',
        claveCadena: claveCadenaAutomatizacion(scope),
        actor: 'usuario',
        actorReal: actorReal(contextoUsuarioActual),
        actorEfectivo: actorEfectivo(contextoUsuarioActual),
        modoActuacion: contextoUsuarioActual?.impersonacionActiva
          ? 'impersonado'
          : 'directo',
        sujeto: { tipo: 'binding_trigger', id: String(asignacion.id) },
        origen: 'web',
        correlacionId: eventoId,
        causalidad: null,
        productor: 'portal_web',
        claveOperacion: eventoId,
        scope,
        efectivoEnUtc: this.ahora().toISOString(),
        rolEvento: 'principal',
        payload,
        versionCanonicalizador: PERFIL_JCS_AUDITORIA_V1,
        versionEncadenado: VERSION_ENCADENADO_AUDITORIA_V1
      }
    }, { conexion });
  }

  registrarMovimientoScopeTrigger({
    conexion,
    contextoUsuarioActual,
    triggerAnterior,
    triggerActual
  }) {
    if (!this.auditoriaActiva(contextoUsuarioActual)) {
      return null;
    }

    const salidaId = generarUuidV7Auditoria();
    const entradaId = generarUuidV7Auditoria();
    const comun = {
      versionContrato: 1,
      flujo: 'automatizacion',
      actor: 'usuario',
      actorReal: actorReal(contextoUsuarioActual),
      actorEfectivo: actorEfectivo(contextoUsuarioActual),
      modoActuacion: contextoUsuarioActual?.impersonacionActiva
        ? 'impersonado'
        : 'directo',
      sujeto: { tipo: 'trigger', id: String(triggerActual.id) },
      origen: 'web',
      correlacionId: salidaId,
      causalidad: null,
      productor: 'portal_web',
      claveOperacion: salidaId,
      efectivoEnUtc: this.ahora().toISOString(),
      versionCanonicalizador: PERFIL_JCS_AUDITORIA_V1,
      versionEncadenado: VERSION_ENCADENADO_AUDITORIA_V1
    };
    const salidaScope = scopeDesdeTrigger(triggerAnterior);
    const entradaScope = scopeDesdeTrigger(triggerActual);
    const salida = {
      ...comun,
      eventoId: salidaId,
      tipo: 'scope.entidad_salida',
      claveCadena: claveCadenaAutomatizacion(salidaScope),
      scope: salidaScope,
      rolEvento: 'salida',
      payload: {
        direccion: 'salida',
        scopePropio: salidaScope,
        eventoContraparteId: entradaId,
        impactoResumen: null
      }
    };
    const entrada = {
      ...comun,
      eventoId: entradaId,
      tipo: 'scope.entidad_entrada',
      claveCadena: claveCadenaAutomatizacion(entradaScope),
      scope: entradaScope,
      rolEvento: 'entrada',
      payload: {
        direccion: 'entrada',
        scopePropio: entradaScope,
        eventoContraparteId: salidaId,
        impactoResumen: null
      }
    };

    return this.servicioAuditoria.registrarMovimientoEnTransaccion({
      cambioEfectivo: true,
      salida,
      entrada
    }, { conexion });
  }

  async exigirVinculoMonitorTriggerDisponible({
    monitorId,
    triggerId,
    idAsignacionActual = null
  }) {
    const asignaciones = await this.listarAsignacionesPorMonitor(monitorId);
    const duplicada = asignaciones.find((asignacion) => {
      if (Number(asignacion.triggerId) !== Number(triggerId)) {
        return false;
      }

      if (
        idAsignacionActual != null &&
        Number(asignacion.id) === Number(idAsignacionActual)
      ) {
        return false;
      }

      return true;
    });

    if (duplicada) {
      throw new Error('Ese monitor ya está vinculado con el trigger seleccionado.');
    }

    return true;
  }

  async exigirMonitorExistente(idMonitor) {
    if (!this.repositorioMonitores) {
      return { id: Number(idMonitor), serializarResumen: () => null };
    }

    const monitor = await this.repositorioMonitores.buscarPorId(idMonitor);

    if (!monitor) {
      throw new Error('El monitor indicado no existe.');
    }

    return monitor;
  }

  exigirRepositorioEjecuciones() {
    if (!this.repositorioEjecucionesTrigger) {
      throw new Error(
        'El servicio de triggers no dispone de repositorio de ejecuciones configurado.'
      );
    }
  }

  validarPlanDisparo(planDisparo) {
    if (!planDisparo || typeof planDisparo !== 'object') {
      throw new Error('El plan de disparo del trigger es obligatorio.');
    }

    if (!planDisparo.triggerId || !planDisparo.tipoTrigger || !planDisparo.eventoDisparo) {
      throw new Error(
        'El plan de disparo del trigger no tiene los campos mínimos requeridos.'
      );
    }

    return planDisparo;
  }

  exigirEstrategiaPlan(planDisparo, estrategiaEsperada) {
    const estrategia = this.resolverEstrategiaParaPlanDisparo(planDisparo);
    if (estrategia !== estrategiaEsperada) {
      throw Object.assign(
        new Error(
          `El trigger ${planDisparo.tipoTrigger} usa ${estrategia} y no puede recorrer ${estrategiaEsperada}.`
        ),
        {
          codigo: 'estrategia_trigger_incompatible',
          tipoTrigger: planDisparo.tipoTrigger,
          estrategia,
          estrategiaEsperada
        }
      );
    }
    return estrategia;
  }
}

function fotografiaTriggerAuditable(trigger) {
  return {
    nombre: trigger.nombre,
    tipo: trigger.tipo,
    descripcion: trigger.descripcion ?? null,
    activo: Boolean(trigger.activo),
    eventosDisparo: [],
    configuracion: configuracionTriggerAuditable(trigger),
    tenantId: trigger.tenantId == null ? null : String(trigger.tenantId),
    empresaId: trigger.empresaId == null ? null : String(trigger.empresaId),
    sitioId: trigger.sitioId == null ? null : String(trigger.sitioId)
  };
}

function fotografiaDefinicionTriggerAuditable(definicion) {
  return {
    nombre: definicion.nombre,
    tipo: definicion.tipo,
    descripcion: definicion.descripcion ?? null,
    activo: Boolean(definicion.activo),
    eventosDisparo: [],
    configuracion: configuracionTriggerAuditable(definicion),
    tenantId: definicion.tenantId == null ? null : String(definicion.tenantId),
    empresaId: definicion.empresaId == null ? null : String(definicion.empresaId),
    sitioId: definicion.sitioId == null ? null : String(definicion.sitioId)
  };
}

function configuracionTriggerAuditable(triggerODefinicion) {
  const configuracion = serializarConfiguracion(triggerODefinicion.configuracion);

  if (triggerODefinicion.tipo === 'api') {
    return {
      metodo: configuracion.metodo || 'POST',
      timeoutMs: Number(configuracion.timeoutMs || 0),
      reintentos: Number(configuracion.reintentos || 0),
      permiteTlsInseguro: Boolean(configuracion.permiteTlsInseguro),
      parametroOpcional: configuracion.parametroOpcional || null
    };
  }

  if (triggerODefinicion.tipo === 'dns') {
    return {
      zonaId: Number(configuracion.zonaId || 0),
      registroId: Number(configuracion.registroId || 0),
      operacionDns: configuracion.operacion || '',
      valorPrincipal: configuracion.valorPrincipal || null,
      rolGobernanza: configuracion.rolGobernanza || null
    };
  }

  if (triggerODefinicion.tipo === 'correo') {
    return {
      version: Number(configuracion.version || 0),
      asuntoPlantilla: configuracion.asuntoPlantilla || '',
      tieneTextoIntroduccion: Boolean(configuracion.textoIntroduccion),
      tieneTextoCierre: Boolean(configuracion.textoCierre)
    };
  }

  return {};
}

function fotografiaBindingTriggerAuditable(asignacion) {
  return {
    triggerId: String(asignacion.triggerId),
    monitorId: String(asignacion.monitorId),
    activo: Boolean(asignacion.activo),
    orden: Number(asignacion.ordenEjecucion),
    eventosDisparo: [...(asignacion.eventosDisparo || [])],
    configuracion: configuracionBindingTriggerAuditable(asignacion.configuracionOverride)
  };
}

function fotografiaDefinicionBindingTriggerAuditable(definicion) {
  return {
    triggerId: String(definicion.triggerId),
    monitorId: String(definicion.monitorId),
    activo: Boolean(definicion.activo),
    orden: Number(definicion.ordenEjecucion),
    eventosDisparo: [...(definicion.eventosDisparo || [])],
    configuracion: configuracionBindingTriggerAuditable(
      definicion.configuracionOverride
    )
  };
}

function configuracionBindingTriggerAuditable(configuracionOverride) {
  const configuracion = clonarJsonSeguro(configuracionOverride);
  if (!configuracion) {
    return {};
  }

  const segura = {};
  for (const clave of [
    'timeoutMs',
    'reintentos',
    'zonaId',
    'registroId',
    'operacion',
    'valorPrincipal',
    'rolGobernanza'
  ]) {
    if (Object.hasOwn(configuracion, clave)) {
      segura[clave === 'operacion' ? 'operacionDns' : clave] =
        configuracion[clave];
    }
  }
  return segura;
}

function serializarConfiguracion(configuracion) {
  if (typeof configuracion?.serializar === 'function') {
    return configuracion.serializar();
  }

  return clonarJsonSeguro(configuracion) || {};
}

function calcularCamposCambiados(antes, despues) {
  return Object.keys(despues)
    .filter((campo) => !isDeepStrictEqual(antes[campo], despues[campo]))
    .sort(compararUtf8);
}

function filtrarFotografiaPorCampos(fotografia, campos) {
  return Object.fromEntries(campos.map((campo) => [campo, fotografia[campo]]));
}

function scopeCambio(antes, despues) {
  return ['tenantId', 'empresaId', 'sitioId'].some(
    (campo) => antes[campo] !== despues[campo]
  );
}

function scopeDesdeTrigger(trigger) {
  return {
    tenantId: trigger.tenantId == null ? null : String(trigger.tenantId),
    empresaId: trigger.empresaId == null ? null : String(trigger.empresaId),
    sitioId: trigger.sitioId == null ? null : String(trigger.sitioId)
  };
}

function scopeDesdeBindingTrigger(asignacion) {
  return {
    tenantId: asignacion.tenantId == null ? null : String(asignacion.tenantId),
    empresaId: asignacion.empresaId == null ? null : String(asignacion.empresaId),
    sitioId: asignacion.sitioId == null ? null : String(asignacion.sitioId)
  };
}

function claveCadenaAutomatizacion(scope) {
  return scope.tenantId == null
    ? 'automatizacion:portal'
    : `automatizacion:tenant:${scope.tenantId}`;
}

function actorReal(contextoUsuarioActual) {
  return {
    tipo: 'usuario',
    id: String(
      contextoUsuarioActual?.idUsuarioReal ??
      contextoUsuarioActual?.idUsuario
    )
  };
}

function actorEfectivo(contextoUsuarioActual) {
  const idReal = contextoUsuarioActual?.idUsuarioReal ?? contextoUsuarioActual?.idUsuario;
  const idEfectivo = contextoUsuarioActual?.idUsuario ?? idReal;
  return String(idReal) === String(idEfectivo)
    ? null
    : { tipo: 'usuario', id: String(idEfectivo) };
}

function compararUtf8(a, b) {
  return Buffer.from(a).compare(Buffer.from(b));
}

function exigirRevisionDeclaracion(valor) {
  const numero = Number(valor);
  if (!Number.isSafeInteger(numero) || numero < 1) {
    const error = new Error(
      'La revisión de declaración del trigger es obligatoria para modificarlo.'
    );
    error.codigo = 'trigger_revision_requerida';
    error.statusCode = 400;
    throw error;
  }
  return numero;
}
