import {
  ESTRATEGIAS_EJECUCION_TRIGGER,
  obtenerEstrategiaEjecucionTrigger
} from '../../../../paquetes/triggers/src/CatalogoTiposTrigger.js';

function clonarJsonSeguro(valor) {
  if (!valor || typeof valor !== 'object') {
    return null;
  }

  return JSON.parse(JSON.stringify(valor));
}

function construirPayloadError(error) {
  if (!error) {
    return null;
  }

  return {
    nombre: error.name || 'Error',
    codigo: error.code == null ? null : String(error.code),
    mensaje: String(error.message || 'Error desconocido al ejecutar trigger.'),
    stack: error.stack ? String(error.stack) : null
  };
}

export class MotorTriggersRuntime {
  constructor({ servicioTriggers }) {
    this.servicioTriggers = servicioTriggers;
  }

  async planificarDesdePersistenciaAlertas({
    persistenciaAlertas = null,
    conexion = null
  } = {}) {
    const aperturasAlerta = Array.isArray(persistenciaAlertas?.aperturasAlerta)
      ? persistenciaAlertas.aperturasAlerta : [];
    const cierresAlerta = Array.isArray(persistenciaAlertas?.cierresAlerta)
      ? persistenciaAlertas.cierresAlerta : [];
    if (aperturasAlerta.length === 0 && cierresAlerta.length === 0) {
      return {
        totalPlanes: 0,
        totalNuevos: 0,
        totalDiferidosNuevos: 0,
        totalAceptacionesAtomicas: 0,
        totalAceptacionesAtomicasNuevas: 0,
        ejecucionIds: []
      };
    }
    const planBruto = await this.servicioTriggers.resolverDisparosDesdeTransiciones({
      aperturasAlerta,
      cierresAlerta
    });
    const disparos = this.deduplicarDisparos(planBruto.disparos || []);
    const ejecuciones = [];
    let totalDiferidosNuevos = 0;
    let totalAceptacionesAtomicas = 0;
    let totalAceptacionesAtomicasNuevas = 0;
    for (const disparo of disparos) {
      const estrategia = this.resolverEstrategiaPlan(disparo);
      if (estrategia ===
          ESTRATEGIAS_EJECUCION_TRIGGER.EFECTO_EXTERNO_DIFERIDO) {
        const ejecucion = await this.servicioTriggers.registrarEjecucionPendiente({
          planDisparo: disparo,
          conexion
        });
        ejecuciones.push(ejecucion);
        if (ejecucion.creada) totalDiferidosNuevos += 1;
        continue;
      }
      const aceptacion = await this.servicioTriggers.aceptarPlanAtomicoEnTransaccion({
        planDisparo: disparo,
        conexion
      });
      ejecuciones.push(aceptacion);
      totalAceptacionesAtomicas += 1;
      if (aceptacion?.creada !== false) totalAceptacionesAtomicasNuevas += 1;
    }
    return {
      totalPlanes: disparos.length,
      totalNuevos: totalDiferidosNuevos + totalAceptacionesAtomicasNuevas,
      totalDiferidosNuevos,
      totalAceptacionesAtomicas,
      totalAceptacionesAtomicasNuevas,
      ejecucionIds: ejecuciones.map(extraerEjecucionId).filter(Boolean)
    };
  }

  async ejecutarPendientes({ origen = 'tick', numeroTick = null, limit = 100 } = {}) {
    const ejecutadoEnUtc = new Date().toISOString();
    const pendientes = await this.servicioTriggers.listarEjecucionesPendientes({ limit });
    if (pendientes.length === 0) {
      return this.construirResumenOmitido({
        ejecutadoEnUtc,
        origen,
        numeroTick,
        motivo: 'sin_planes_pendientes'
      });
    }
    const ejecuciones = [];
    let totalOk = 0;
    let totalError = 0;
    let totalDescartadas = 0;
    for (const pendiente of pendientes) {
      this.exigirEstrategiaDiferida(pendiente);
      const reclamada = await this.servicioTriggers.marcarEjecucionEjecutando(
        pendiente.id,
        { codigoResultado: 'ejecutando', mensajeResultado: 'Ejecución de trigger en curso.' }
      );
      if (!reclamada) {
        continue;
      }
      const plan = this.rehidratarPlanPendiente(pendiente);
      let ejecucionFinal;
      try {
        const ejecutor = this.servicioTriggers.resolverEjecutorParaPlanDisparo(plan);
        const resultado = await ejecutor.ejecutar({
          planDisparo: plan,
          ejecucionTriggerId: pendiente.id,
          configuracionEfectiva: plan.configuracionEfectiva,
          transicion: plan.transicion,
          eventoDisparo: plan.eventoDisparo
        });
        const normalizado = this.normalizarResultadoEjecutor(resultado);
        ejecucionFinal = await this.servicioTriggers.finalizarEjecucionTrigger({
          idEjecucion: pendiente.id,
          ...normalizado
        });
        if (ejecucionFinal?.descartada) totalDescartadas += 1;
        if (normalizado.estadoEjecucion === 'ok') totalOk += 1;
        else totalError += 1;
      } catch (error) {
        totalError += 1;
        ejecucionFinal = await this.servicioTriggers.finalizarEjecucionTrigger({
          idEjecucion: pendiente.id,
          estadoEjecucion: 'error',
          codigoResultado: 'trigger_error',
          mensajeResultado: String(error?.message || 'Error desconocido al ejecutar trigger.'),
          payloadError: construirPayloadError(error)
        });
        if (ejecucionFinal?.descartada) totalDescartadas += 1;
      }
      ejecuciones.push({ disparo: plan, ejecucion: ejecucionFinal });
    }
    return {
      omitido: false,
      ejecutadoEnUtc,
      finalizadoEnUtc: new Date().toISOString(),
      origen,
      numeroTick,
      motivo: 'planes_durables_pendientes',
      totalTransiciones: 0,
      totalPlanes: pendientes.length,
      totalPlanesUnicos: pendientes.length,
      totalEjecutados: ejecuciones.length,
      totalOk,
      totalError,
      totalDescartadas,
      ejecuciones
    };
  }

  rehidratarPlanPendiente(ejecucion) {
    const payload = ejecucion.payloadSolicitud || {};
    return {
      eventoDisparo: payload.eventoDisparo || ejecucion.eventoDisparo,
      monitorId: payload.monitorId || ejecucion.monitorId,
      triggerId: payload.triggerId || ejecucion.triggerId,
      tipoTrigger: ejecucion.tipoTrigger,
      estrategiaEjecucion: obtenerEstrategiaEjecucionTrigger(ejecucion.tipoTrigger),
      nombreTrigger: payload.triggerNombre || ejecucion.triggerNombre,
      asignacionId: payload.asignacionId || ejecucion.asignacionTriggerMonitorId,
      ordenEjecucion: payload.ordenEjecucion || 100,
      trigger: { id: ejecucion.triggerId, ...(payload.triggerScope || {}) },
      asignacion: null,
      transicion: payload.transicion,
      configuracionEfectiva: payload.configuracionEfectiva
    };
  }

  // auditoria-productor: runtime.triggers.ejecucion_ordinaria
  async ejecutarDesdePersistenciaAlertas({
    persistenciaAlertas = null,
    origen = 'tick',
    numeroTick = null
  } = {}) {
    const ejecutadoEnUtc = new Date().toISOString();
    const aperturasAlerta = Array.isArray(persistenciaAlertas?.aperturasAlerta)
      ? persistenciaAlertas.aperturasAlerta
      : [];
    const cierresAlerta = Array.isArray(persistenciaAlertas?.cierresAlerta)
      ? persistenciaAlertas.cierresAlerta
      : [];

    if (aperturasAlerta.length === 0 && cierresAlerta.length === 0) {
      return this.construirResumenOmitido({
        ejecutadoEnUtc,
        origen,
        numeroTick,
        motivo: 'sin_transiciones_alerta'
      });
    }

    const planBruto = await this.servicioTriggers.resolverDisparosDesdeTransiciones({
      aperturasAlerta,
      cierresAlerta
    });
    const disparos = this.deduplicarDisparos(planBruto.disparos || []);

    if (disparos.length === 0) {
      return this.construirResumenOmitido({
        ejecutadoEnUtc,
        origen,
        numeroTick,
        motivo: 'sin_asignaciones_aplicables',
        totalTransiciones: aperturasAlerta.length + cierresAlerta.length
      });
    }

    const ejecuciones = [];
    let totalOk = 0;
    let totalError = 0;
    let totalDescartadas = 0;

    for (const disparo of disparos) {
      this.exigirEstrategiaDiferida(disparo);
      const ejecucionPendiente =
        await this.servicioTriggers.registrarEjecucionPendiente({
          planDisparo: disparo
        });
      let ejecucionFinal = null;

      try {
        const reclamada = await this.servicioTriggers.marcarEjecucionEjecutando(ejecucionPendiente.id, {
          codigoResultado: 'ejecutando',
          mensajeResultado: 'Ejecución de trigger en curso.'
        });
        if (reclamada === null) {
          ejecuciones.push({
            disparo: {
              eventoDisparo: disparo.eventoDisparo,
              monitorId: disparo.monitorId,
              triggerId: disparo.triggerId,
              asignacionId: disparo.asignacionId,
              tipoTrigger: disparo.tipoTrigger,
              nombreTrigger: disparo.nombreTrigger,
              ordenEjecucion: disparo.ordenEjecucion
            },
            ejecucion: ejecucionPendiente,
            omitida: true,
            motivo: 'plan_ya_reclamado_o_finalizado'
          });
          continue;
        }

        const ejecutor =
          this.servicioTriggers.resolverEjecutorParaPlanDisparo(disparo);
        const resultado = await ejecutor.ejecutar({
          planDisparo: disparo,
          ejecucionTriggerId: ejecucionPendiente.id,
          configuracionEfectiva: disparo.configuracionEfectiva,
          transicion: disparo.transicion,
          eventoDisparo: disparo.eventoDisparo
        });
        const normalizado = this.normalizarResultadoEjecutor(resultado);

        ejecucionFinal = await this.servicioTriggers.finalizarEjecucionTrigger({
          idEjecucion: ejecucionPendiente.id,
          estadoEjecucion: normalizado.estadoEjecucion,
          codigoResultado: normalizado.codigoResultado,
          mensajeResultado: normalizado.mensajeResultado,
          payloadRespuesta: normalizado.payloadRespuesta,
          payloadError: normalizado.payloadError
        });
        if (ejecucionFinal?.descartada) totalDescartadas += 1;

        if (normalizado.estadoEjecucion === 'ok') {
          totalOk += 1;
        } else {
          totalError += 1;
        }
      } catch (error) {
        totalError += 1;
        ejecucionFinal = await this.servicioTriggers.finalizarEjecucionTrigger({
          idEjecucion: ejecucionPendiente.id,
          estadoEjecucion: 'error',
          codigoResultado: 'trigger_error',
          mensajeResultado: String(
            error?.message || 'Error desconocido al ejecutar trigger.'
          ),
          payloadRespuesta: null,
          payloadError: construirPayloadError(error)
        });
        if (ejecucionFinal?.descartada) totalDescartadas += 1;
      }

      ejecuciones.push({
        disparo: {
          eventoDisparo: disparo.eventoDisparo,
          monitorId: disparo.monitorId,
          triggerId: disparo.triggerId,
          asignacionId: disparo.asignacionId,
          tipoTrigger: disparo.tipoTrigger,
          nombreTrigger: disparo.nombreTrigger,
          ordenEjecucion: disparo.ordenEjecucion
        },
        ejecucion: ejecucionFinal
      });
    }

    return {
      omitido: false,
      ejecutadoEnUtc,
      finalizadoEnUtc: new Date().toISOString(),
      origen,
      numeroTick,
      motivo: 'transiciones_alerta',
      totalTransiciones: aperturasAlerta.length + cierresAlerta.length,
      totalPlanes: Number(planBruto.totalDisparos || 0),
      totalPlanesUnicos: disparos.length,
      totalEjecutados: ejecuciones.length,
      totalOk,
      totalError,
      totalDescartadas,
      ejecuciones
    };
  }

  deduplicarDisparos(disparos = []) {
    const vistos = new Set();
    const unicos = [];

    for (const disparo of Array.isArray(disparos) ? disparos : []) {
      const clave = [
        disparo?.eventoDisparo || '',
        disparo?.asignacionId || '',
        disparo?.monitorId || '',
        disparo?.triggerId || ''
      ].join(':');

      if (!clave || vistos.has(clave)) {
        continue;
      }

      vistos.add(clave);
      unicos.push(disparo);
    }

    return unicos;
  }

  normalizarResultadoEjecutor(resultado) {
    if (!resultado || typeof resultado !== 'object') {
      return {
        estadoEjecucion: 'ok',
        codigoResultado: 'trigger_ejecutado',
        mensajeResultado: 'Trigger ejecutado correctamente.',
        payloadRespuesta: null,
        payloadError: null
      };
    }

    const estadoNormalizado =
      String(resultado.estadoEjecucion || '').trim().toLowerCase() === 'error'
        ? 'error'
        : 'ok';

    return {
      estadoEjecucion: estadoNormalizado,
      codigoResultado: String(
        resultado.codigoResultado ||
          (estadoNormalizado === 'ok' ? 'trigger_ejecutado' : 'trigger_error')
      ).trim(),
      mensajeResultado: String(
        resultado.mensajeResultado ||
          (estadoNormalizado === 'ok'
            ? 'Trigger ejecutado correctamente.'
            : 'El trigger devolvió error.')
      ).trim(),
      payloadRespuesta: clonarJsonSeguro(resultado.payloadRespuesta),
      payloadError: clonarJsonSeguro(resultado.payloadError)
    };
  }

  resolverEstrategiaPlan(plan) {
    const estrategia = obtenerEstrategiaEjecucionTrigger(plan?.tipoTrigger);
    if (plan?.estrategiaEjecucion && plan.estrategiaEjecucion !== estrategia) {
      throw Object.assign(
        new Error('El plan de trigger contiene una estrategia incompatible con su tipo.'),
        { codigo: 'estrategia_trigger_plan_incoherente' }
      );
    }
    return estrategia;
  }

  exigirEstrategiaDiferida(plan) {
    const estrategia = this.resolverEstrategiaPlan(plan);
    if (estrategia !==
        ESTRATEGIAS_EJECUCION_TRIGGER.EFECTO_EXTERNO_DIFERIDO) {
      throw Object.assign(
        new Error(
          `Una ejecución ${plan?.tipoTrigger || '(sin tipo)'} no puede entrar en el motor diferido.`
        ),
        {
          codigo: 'ejecucion_trigger_atomica_en_motor_diferido',
          tipoTrigger: plan?.tipoTrigger || null,
          estrategia
        }
      );
    }
    return estrategia;
  }

  construirResumenOmitido({
    ejecutadoEnUtc,
    origen,
    numeroTick,
    motivo,
    totalTransiciones = 0
  }) {
    return {
      omitido: true,
      ejecutadoEnUtc,
      finalizadoEnUtc: ejecutadoEnUtc,
      origen,
      numeroTick,
      motivo,
      totalTransiciones,
      totalPlanes: 0,
      totalPlanesUnicos: 0,
      totalEjecutados: 0,
      totalOk: 0,
      totalError: 0,
      totalDescartadas: 0,
      ejecuciones: []
    };
  }
}

function extraerEjecucionId(resultado) {
  return resultado?.id || resultado?.ejecucionTriggerId ||
    resultado?.ejecucion?.id || null;
}
