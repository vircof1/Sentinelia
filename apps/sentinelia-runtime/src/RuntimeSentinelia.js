import { CargadorCatalogoMonitoresRuntime } from './catalogo/CargadorCatalogoMonitoresRuntime.js';
import { normalizarMarcaUtc } from '../../../paquetes/utilidades/src/fechas/normalizarMarcaUtc.js';
import { CargadorCatalogoDnsRuntime } from './dns/CargadorCatalogoDnsRuntime.js';
import { CoordinadorDnsRuntime } from './dns/CoordinadorDnsRuntime.js';
import { AlmacenEstadoActual } from './estado/AlmacenEstadoActual.js';
import { AplicadorResultadosEstadoActual } from './estado/AplicadorResultadosEstadoActual.js';
import { RehidratadorEstado } from './estado/RehidratadorEstado.js';
import { PresenciaRuntimeRedis } from './redis/PresenciaRuntimeRedis.js';
import { MotorMonitores } from './ejecucion/MotorMonitores.js';
import { RegistroEjecutoresMonitor } from './ejecucion/RegistroEjecutoresMonitor.js';
import { EjecutorMonitorPing } from './ejecucion/EjecutorMonitorPing.js';
import { EjecutorMonitorTcp } from './ejecucion/EjecutorMonitorTcp.js';
import { EjecutorMonitorBooleano } from './ejecucion/EjecutorMonitorBooleano.js';
import { EjecutorMonitorTelemetria } from './ejecucion/EjecutorMonitorTelemetria.js';
import { PlanificadorMonitores } from './scheduler/PlanificadorMonitores.js';
import { SelectorMonitoresVencidos } from './scheduler/SelectorMonitoresVencidos.js';
import { PlanificadorMonitoresLogicosReactivos } from './scheduler/PlanificadorMonitoresLogicosReactivos.js';
import { PersistidorEventosMonitores } from './eventos/PersistidorEventosMonitores.js';
import { GestorAlertasActivasMonitor } from './alertas/GestorAlertasActivasMonitor.js';
import { GestorHistoricoMonitores } from './historico/GestorHistoricoMonitores.js';
import { DespachadorCorreoRuntime } from './correo/DespachadorCorreoRuntime.js';
import { CoordinadorEmisionesRecuperacionPasswordRuntime }
  from './correo/CoordinadorEmisionesRecuperacionPasswordRuntime.js';
import { MotorTriggersRuntime } from './triggers/MotorTriggersRuntime.js';
import { DespachadorEvaluacionesTelemetriaRuntime } from './telemetria/DespachadorEvaluacionesTelemetriaRuntime.js';
import { CoordinadorRelojRelativoTelemetriaRuntime } from './telemetria/CoordinadorRelojRelativoTelemetriaRuntime.js';
import { SuscriptorAvisosEvaluacionTelemetriaRedis } from './telemetria/SuscriptorAvisosEvaluacionTelemetriaRedis.js';
import { SelectorMonitoresTelemetriaReactivos } from './telemetria/SelectorMonitoresTelemetriaReactivos.js';
import { SuscriptorInvalidacionesMonitoresTelemetriaRedis } from './telemetria/SuscriptorInvalidacionesMonitoresTelemetriaRedis.js';
import { PublicadorInvalidacionesMonitoresTelemetriaRedis } from '../../../paquetes/agentes/src/PublicadorInvalidacionesMonitoresTelemetriaRedis.js';
import { PublicadorAvisosEvaluacionTelemetriaRedis } from '../../../paquetes/agentes/src/PublicadorAvisosEvaluacionTelemetriaRedis.js';
import { CoordinadorPerfilServidorRedis } from '../../../paquetes/agentes/src/CoordinadorPerfilServidorRedis.js';
import { ProcesadorSenalesServidorRuntime } from './agentes/ProcesadorSenalesServidorRuntime.js';
import { SuscriptorAvisosPerfilServidorRedis } from './agentes/SuscriptorAvisosPerfilServidorRedis.js';
import { DespachadorOutboxAuditoriaRuntime } from './auditoria/DespachadorOutboxAuditoriaRuntime.js';
import { CoordinadorEmisionFederacionRuntime } from './federacion/CoordinadorEmisionFederacionRuntime.js';
import { SuscriptorSenalesFederacionRedis } from './federacion/SuscriptorSenalesFederacionRedis.js';
import { crearDeclaracionCompatibilidadRuntimeEliminacionAgentes }
  from '../../../paquetes/agentes/src/CompatibilidadEliminacionAdministrativaAgentes.js';
import { crearDeclaracionCapacidadesRuntimeEliminacionOrganizaciones }
  from '../../../paquetes/jerarquia-organizativa/src/CapacidadesRuntimeEliminacionAdministrativaOrganizaciones.js';
import { crearDeclaracionCompatibilidadRuntimeTriggerCorreo }
  from '../../../paquetes/correo/src/CompatibilidadDespliegueTriggerCorreo.js';
import { crearDeclaracionCompatibilidadRuntimeMomentoUtcRelativo }
  from '../../../paquetes/agentes/src/CompatibilidadDespliegueMomentoUtcRelativo.js';
import { crearDeclaracionCapacidadesRuntimeRecuperacionPasswordEmail }
  from '../../../paquetes/usuarios/src/CapacidadesDespliegueRecuperacionPasswordEmail.js';
import {
  crearDeclaracionCompatibilidadRuntimePublicadorBindDns,
  resolverUnanimidadPublicadorBindDns
} from '../../../paquetes/dns/src/CompatibilidadDesplieguePublicadorBindDns.js';
import {
  crearDeclaracionCompatibilidadRuntimeDdnsAgentes,
  resolverActivacionDdnsAgentes
}
  from '../../../paquetes/dns/src/CompatibilidadDespliegueDdnsAgentes.js';

export class RuntimeSentinelia {
  constructor({ configuracion, bootstrapRuntime }) {
    this.configuracion = configuracion;
    this.bootstrapRuntime = bootstrapRuntime;
    this.contexto = null;
    this.catalogoOperativo = null;
    this.estadoVivo = null;
    this.presenciaRedis = null;
    this.planificadorMonitores = null;
    this.selectorMonitoresVencidos = null;
    this.planificadorMonitoresLogicosReactivos = null;
    this.motorMonitores = null;
    this.aplicadorResultadosEstadoActual = null;
    this.persistidorEventosMonitores = null;
    this.gestorAlertasActivasMonitor = null;
    this.gestorHistoricoMonitores = null;
    this.motorTriggersRuntime = null;
    this.despachadorCorreoRuntime = null;
    this.coordinadorEmisionesRecuperacionPasswordRuntime = null;
    this.despachadorEvaluacionesTelemetriaRuntime = null;
    this.coordinadorRelojRelativoTelemetriaRuntime = null;
    this.despachadorOutboxAuditoriaRuntime = null;
    this.coordinadorEmisionFederacionRuntime = null;
    this.emisorHeartbeatFederacionRuntime = null;
    this.supervisorSaludFederacionRuntime = null;
    this.suscriptorSenalesFederacionRedis = null;
    this.servicioRetencionAuditoriaGlobal = null;
    this.servicioRetencionDdnsAgentes = null;
    this.servicioLimpiezaTecnicaAuditoria = null;
    this.repositorioIdempotenciaLotesTelemetria = null;
    this.publicadorInvalidacionesMonitoresTelemetriaRedis = null;
    this.publicadorAvisosEvaluacionTelemetriaRedis = null;
    this.coordinadorPerfilServidorRedis = null;
    this.procesadorSenalesServidorRuntime = null;
    this.suscriptorAvisosPerfilServidorRedis = null;
    this.suscriptorAvisosEvaluacionTelemetriaRedis = null;
    this.selectorMonitoresTelemetriaReactivos = null;
    this.suscriptorInvalidacionesMonitoresTelemetriaRedis = null;
    this.gestorRetencionMonitores = null;
    this.gestorRetencionCorreo = null;
    this.gestorRetencionDatosFederados = null;
    this.servicioRefederacionFederacion = null;
    this.procesadorMaterializacionFederacion = null;
    this.despachadorOperacionesAdministrativasRuntime = null;
    this.bloqueadorEjecucionMonitorRedis = null;
    this.versionadorEstadoOperativoRedis = null;
    this.versionadorCatalogoMonitoresRedis = null;
    this.fronteraTransaccionalMonitores = null;
    this.repositorioMonitores = null;
    this.servicioCierreAlertasMonitoresInactivos = null;
    this.coordinadorDnsRuntime = null;
    this.procesadorCausasPolDdnsRuntime = null;
    this.alertasActivasPorMonitorId = new Map();
    this.cargadorCatalogoMonitores = null;
    this.cargadorCatalogoDns = null;
    this.rehidratadorEstado = null;
    this.versionCatalogoMonitoresActual = null;
    this.totalRecargasCatalogo = 0;
    this.ultimaRecargaCatalogoEn = null;
    this.colaOperacionesMonitores = Promise.resolve();
    this.arrancado = false;
    this.deteniendo = null;
    this.iniciadoEn = null;
    this.ultimaClaveLimpiezaTecnicaAuditoriaEjecutada = null;
    this.monitoresFederadosPendientes = new Set();
  }

  get instanciaId() {
    return this.configuracion.runtime.instanciaId;
  }

  async arrancar() {
    if (this.arrancado) {
      return this.contexto;
    }

    const contextoBootstrap = await this.bootstrapRuntime.arrancar();
    this.fronteraTransaccionalMonitores = contextoBootstrap.fronteraTransaccional || null;
    this.repositorioMonitores = contextoBootstrap.repositorioMonitores || null;
    this.servicioCierreAlertasMonitoresInactivos =
      contextoBootstrap.servicioCierreAlertasMonitoresInactivos || null;
    this.cargadorCatalogoMonitores = new CargadorCatalogoMonitoresRuntime({
      servicioMonitores: contextoBootstrap.servicioMonitores
    });
    this.rehidratadorEstado = new RehidratadorEstado({
      repositorioEstadoActualMonitores:
        contextoBootstrap.repositorioEstadoActualMonitores
    });
    this.versionadorCatalogoMonitoresRedis =
      contextoBootstrap.versionadorCatalogoMonitoresRedis;
    this.versionCatalogoMonitoresActual =
      Number(contextoBootstrap.resumenArranque.redis?.versionCatalogoMonitores || 0) ||
      null;
    const resumenRehidratacion = await this.recargarCatalogoOperativo({
      versionCatalogoMonitores: this.versionCatalogoMonitoresActual,
      motivo: 'arranque_catalogo',
      publicarRedis: false
    });
    this.contexto = {
      ...contextoBootstrap,
      catalogoOperativo: this.catalogoOperativo,
      estadoVivo: this.estadoVivo,
      snapshotEstadoVivo: this.estadoVivo.crearSnapshot(),
      resumenRehidratacion
    };
    await this.reconstruirEstadoAlertasActivas();
    this.presenciaRedis = new PresenciaRuntimeRedis({
      clienteRedis: contextoBootstrap.clienteRedis,
      configuracionRuntime: this.configuracion.runtime,
      entorno: this.configuracion.entorno
    });
    this.versionadorEstadoOperativoRedis =
      contextoBootstrap.versionadorEstadoOperativoRedis;
    const publicadorBindCoordinadoActivo = Boolean(
      contextoBootstrap.publicadorProductivoBindDns
    );
    await this.presenciaRedis.publicarCapacidadDespliegue(
      'publicadorBindDns',
      crearDeclaracionCompatibilidadRuntimePublicadorBindDns({
        instanciaId: this.instanciaId,
        coordinadoActivo: publicadorBindCoordinadoActivo
      })
    );
    await this.presenciaRedis.publicarCapacidadDespliegue(
      'ddnsAgentes',
      crearDeclaracionCompatibilidadRuntimeDdnsAgentes({
        instanciaId: this.instanciaId
      })
    );
    await this.presenciaRedis.publicarCapacidadDespliegue(
      'triggerCorreo',
      crearDeclaracionCompatibilidadRuntimeTriggerCorreo({
        instanciaId: this.instanciaId,
        preparacionLocal: contextoBootstrap.preparacionDespliegueTriggerCorreo
      })
    );
    await this.presenciaRedis.publicarCapacidadDespliegue(
      'momentoUtcRelativo',
      crearDeclaracionCompatibilidadRuntimeMomentoUtcRelativo({
        instanciaId: this.instanciaId,
        preparacionLocal:
          contextoBootstrap.preparacionDespliegueMomentoUtcRelativo
      })
    );
    await this.presenciaRedis.publicarCapacidadDespliegue(
      'recuperacionPasswordEmail',
      crearDeclaracionCapacidadesRuntimeRecuperacionPasswordEmail({
        instanciaId: this.instanciaId
      })
    );
    await this.presenciaRedis.publicarInicio({
      catalogoOperativo: this.catalogoOperativo,
      almacenEstadoActual: this.estadoVivo,
      resumenAlertasActivas: this.construirResumenAlertasActivasDashboard(),
      versionCatalogoMonitores: this.versionCatalogoMonitoresActual,
      versionOperativa:
        contextoBootstrap.resumenArranque.redis?.versionOperativaMonitores || null
    });
    if (publicadorBindCoordinadoActivo) {
      await resolverUnanimidadPublicadorBindDns({
        clienteRedis: contextoBootstrap.clienteRedis,
        prefijoRuntime: this.configuracion.runtime.redisPrefijo,
        entorno: this.configuracion.entorno
      });
    }
    this.cargadorCatalogoDns = new CargadorCatalogoDnsRuntime({
      servicioDns: contextoBootstrap.servicioDns
    });
    this.coordinadorDnsRuntime = new CoordinadorDnsRuntime({
      servicioDns: contextoBootstrap.servicioDns,
      cargadorCatalogoDnsRuntime: this.cargadorCatalogoDns,
      publicadorCoordinado: contextoBootstrap.publicadorProductivoBindDns,
      repositorioCoordinacion:
        contextoBootstrap.repositorioCoordinacionGeneracionesDns
    });
    const resumenDns = await this.coordinadorDnsRuntime.arrancar();
    let activacionDdnsAgentes;
    try {
      activacionDdnsAgentes = await resolverActivacionDdnsAgentes({
        solicitada: this.configuracion.agentes.ddnsHabilitado,
        preparacionLocal: contextoBootstrap.preparacionDespliegueDdnsAgentes,
        clienteRedis: contextoBootstrap.clienteRedis,
        prefijoRuntime: this.configuracion.runtime.redisPrefijo,
        entorno: this.configuracion.entorno,
        repositorioCoordinacion:
          contextoBootstrap.repositorioCoordinacionGeneracionesDns,
        esperaMaximaMs:
          this.configuracion.organizacion
            .eliminacionAdministrativaEsperaCompatibilidadMs
      });
    } catch (error) {
      activacionDdnsAgentes = Object.freeze({
        habilitada: false,
        gateAbierto: false,
        solicitada: this.configuracion.agentes.ddnsHabilitado === true,
        codigo: String(error?.codigo || 'precondicion_ddns_no_disponible'),
        detalle: error?.detalle ?? null
      });
    }
    if (activacionDdnsAgentes.habilitada !== true) {
      this.procesadorCausasPolDdnsRuntime = null;
    }
    this.contexto.despliegueDdnsAgentes = activacionDdnsAgentes;
    console.log(
      `[sentinelia-runtime] DDNS de agentes: solicitado=${this.configuracion.agentes.ddnsHabilitado ? 'si' : 'no'} ` +
      `gate=${activacionDdnsAgentes.habilitada ? 'abierto' : 'cerrado'} codigo=${activacionDdnsAgentes.codigo}`
    );

    this.contexto.sincronizacionRedis = {
      prefijo: this.configuracion.runtime.redisPrefijo,
      ttlSegundos: this.configuracion.runtime.presenciaTtlSegundos,
      intervaloLatidoMs: this.configuracion.runtime.latidoIntervaloMs,
      versionCatalogoMonitores: this.versionCatalogoMonitoresActual,
      totalRecargasCatalogo: this.totalRecargasCatalogo,
      ultimaRecargaCatalogoEn: this.ultimaRecargaCatalogoEn,
      versionOperativa:
        contextoBootstrap.resumenArranque.redis?.versionOperativaMonitores || null
    };
    this.servicioRetencionAuditoriaGlobal =
      contextoBootstrap.servicioRetencionAuditoriaGlobal;
    this.servicioRetencionDdnsAgentes =
      contextoBootstrap.servicioRetencionDdnsAgentes || null;
    this.servicioLimpiezaTecnicaAuditoria =
      contextoBootstrap.servicioLimpiezaTecnicaAuditoria;
    this.repositorioIdempotenciaLotesTelemetria =
      contextoBootstrap.repositorioIdempotenciaLotesTelemetria || null;
    this.servicioRefederacionFederacion =
      contextoBootstrap.servicioRefederacionFederacion;
    this.procesadorMaterializacionFederacion =
      contextoBootstrap.procesadorMaterializacionFederacion;
    this.despachadorOperacionesAdministrativasRuntime =
      contextoBootstrap.despachadorOperacionesAdministrativasRuntime || null;
    this.procesadorCausasPolDdnsRuntime =
      activacionDdnsAgentes.habilitada === true
        ? contextoBootstrap.procesadorCausasPolDdnsRuntime || null
        : null;
    this.contexto.sincronizacionDns = resumenDns;
    this.arrancado = true;
    this.iniciadoEn = new Date().toISOString();
    this.planificadorMonitores = new PlanificadorMonitores({
      configuracionRuntime: this.configuracion.runtime,
      onTick: ({ origen, numeroTick, iniciadoEn }) =>
        this.encolarOperacionMonitores(() =>
          this.procesarTickScheduler({ origen, numeroTick, iniciadoEn })
        ),
      onTickFinalizado: () => this.actualizarResumenScheduler()
    });
    this.selectorMonitoresVencidos = new SelectorMonitoresVencidos();
    this.planificadorMonitoresLogicosReactivos =
      new PlanificadorMonitoresLogicosReactivos();
    this.registroEjecutoresMonitor = new RegistroEjecutoresMonitor({
      ejecutores: [
        new EjecutorMonitorPing(),
        new EjecutorMonitorTcp(),
        new EjecutorMonitorBooleano({
          repositorioEntradasFederadas:
            contextoBootstrap.repositorioEntradasFederadasMonitoresLogicos
        }),
        new EjecutorMonitorTelemetria({
          repositorioVinculos:
            contextoBootstrap.repositorioVinculosMonitoresTelemetria,
          repositorioEstadoActualTelemetria:
            contextoBootstrap.repositorioEstadoActualTelemetria,
          repositorioEstadoActualEvaluacionReglas:
            contextoBootstrap.repositorioEstadoActualEvaluacionTelemetria,
          repositorioTelemetriaRemota:
            contextoBootstrap.repositorioTelemetriaRemota
        })
      ]
    });
    this.motorMonitores = new MotorMonitores({
      registroEjecutores: this.registroEjecutoresMonitor
    });
    this.aplicadorResultadosEstadoActual = new AplicadorResultadosEstadoActual({
      repositorioEstadoActualMonitores:
        contextoBootstrap.repositorioEstadoActualMonitores,
      capturadorFederacionMonitores:
        contextoBootstrap.capturadorFederacionMonitores || null
    });
    this.persistidorEventosMonitores = new PersistidorEventosMonitores({
      servicioEventosMonitores: contextoBootstrap.servicioEventosMonitores,
      capturadorFederacionMonitores:
        contextoBootstrap.capturadorFederacionMonitores || null
    });
    this.gestorAlertasActivasMonitor = new GestorAlertasActivasMonitor({
      repositorioAlertasActivasMonitor:
        contextoBootstrap.repositorioAlertasActivasMonitor,
      repositorioOutboxAuditoriaRuntime:
        contextoBootstrap.repositorioOutboxAuditoriaRuntime,
      capturadorFederacionMonitores:
        contextoBootstrap.capturadorFederacionMonitores || null
    });
    this.gestorHistoricoMonitores = new GestorHistoricoMonitores({
      repositorioHistoricoMonitores:
        contextoBootstrap.repositorioHistoricoMonitores,
      servicioConfiguracionPortal: contextoBootstrap.servicioConfiguracionPortal,
      capturadorFederacionMonitores:
        contextoBootstrap.capturadorFederacionMonitores || null
    });
    this.motorTriggersRuntime = new MotorTriggersRuntime({
      servicioTriggers: contextoBootstrap.servicioTriggers
    });
    this.despachadorCorreoRuntime = new DespachadorCorreoRuntime({
      servicioCorreoPortal: contextoBootstrap.servicioCorreoPortal,
      servicioConfiguracionPortal: contextoBootstrap.servicioConfiguracionPortal,
      despachadorCorreoSql: contextoBootstrap.despachadorCorreoSql,
      evaluadorAutoridadCorreoSql: contextoBootstrap.evaluadorAutoridadCorreoSql,
      fronteraTransaccional: contextoBootstrap.fronteraTransaccional
    });
    this.coordinadorEmisionesRecuperacionPasswordRuntime =
      new CoordinadorEmisionesRecuperacionPasswordRuntime({
        servicioConfiguracionPortal: contextoBootstrap.servicioConfiguracionPortal,
        servicioCorreoPortal: contextoBootstrap.servicioCorreoPortal,
        repositorioCoordinacionCorreo:
          contextoBootstrap.repositorioCorreoRecuperacionPassword,
        servicioActivacion:
          contextoBootstrap.servicioActivacionEmisionRecuperacionPassword,
        fronteraTransaccional: contextoBootstrap.fronteraTransaccional
      });
    this.publicadorInvalidacionesMonitoresTelemetriaRedis =
      new PublicadorInvalidacionesMonitoresTelemetriaRedis({
        clienteRedis: contextoBootstrap.clienteRedis,
        canal:
          `${this.configuracion.runtime.redisPrefijo}telemetria:monitores:invalidacion`
      });
    this.publicadorAvisosEvaluacionTelemetriaRedis =
      new PublicadorAvisosEvaluacionTelemetriaRedis({
        clienteRedis: contextoBootstrap.clienteRedis,
        canal:
          `${this.configuracion.runtime.redisPrefijo}telemetria:evaluacion:pendiente`
      });
    this.coordinadorPerfilServidorRedis = new CoordinadorPerfilServidorRedis({
      clienteRedis: contextoBootstrap.clienteRedis,
      prefijoRedis:
        `${this.configuracion.runtime.redisPrefijo}perfil-servidor:`
    });
    this.procesadorSenalesServidorRuntime = new ProcesadorSenalesServidorRuntime({
      repositorioEstadoRuntime:
        contextoBootstrap.repositorioEstadoRuntimeServidor,
      publicadorTelemetriaRuntime:
        contextoBootstrap.publicadorTelemetriaRuntimeEnTransaccion,
      fronteraTransaccional: contextoBootstrap.fronteraTransaccional,
      coordinadorRedis: this.coordinadorPerfilServidorRedis,
      publicadorAvisosEvaluacion:
        this.publicadorAvisosEvaluacionTelemetriaRedis,
      publicadorInvalidacionesMonitores:
        this.publicadorInvalidacionesMonitoresTelemetriaRedis,
      servicioRetiradaPerfilServidor:
        contextoBootstrap.servicioRetiradaPerfilServidor,
      repositorioOutboxAuditoriaRuntime:
        contextoBootstrap.repositorioOutboxAuditoriaRuntime,
      loteMaximo: this.configuracion.runtime.perfilServidorLoteMaximo
    });
    this.contexto.perfilServidorRuntime = {
      habilitadoAdministrativamente:
        this.configuracion.agentes.perfilServidorHabilitado === true,
      rehidratacion:
        await this.procesadorSenalesServidorRuntime.rehidratarCoordinacion()
    };
    this.coordinadorRelojRelativoTelemetriaRuntime =
      new CoordinadorRelojRelativoTelemetriaRuntime({
        repositorioCorrecciones:
          contextoBootstrap.repositorioCorreccionesRelojTelemetria,
        repositorioTrabajos:
          contextoBootstrap.repositorioTrabajosEvaluacionTelemetria,
        servicioAvisos: contextoBootstrap.servicioAvisosPlataforma,
        instanciaId: this.instanciaId,
        limiteLote:
          this.configuracion.runtime.telemetriaRelojLoteMaximo,
        maximoLotesPorCiclo:
          this.configuracion.runtime.telemetriaRelojMaximoLotesPorCiclo,
        umbralAvisoRetrasoSegundos:
          this.configuracion.runtime.telemetriaRelativaRetrasoAvisoSegundos
      });
    this.contexto.relojRelativoTelemetria =
      await this.coordinadorRelojRelativoTelemetriaRuntime
        .procesarAntesDeReclamar({ origen: 'arranque', numeroTick: null });
    this.despachadorEvaluacionesTelemetriaRuntime =
      new DespachadorEvaluacionesTelemetriaRuntime({
        repositorioTrabajos:
          contextoBootstrap.repositorioTrabajosEvaluacionTelemetria,
        procesadorTrabajos:
          contextoBootstrap.procesadorTrabajosEvaluacionTelemetria,
        publicadorInvalidacionesMonitores:
          this.publicadorInvalidacionesMonitoresTelemetriaRedis,
        instanciaId: this.instanciaId,
        loteMaximo:
          this.configuracion.runtime.telemetriaEvaluacionLoteMaximo,
        reclamoTtlSegundos:
          this.configuracion.runtime.telemetriaEvaluacionReclamoTtlSegundos,
        prepararAntesDeReclamar: ({ origen, numeroTick }) =>
          this.coordinadorRelojRelativoTelemetriaRuntime
            .procesarAntesDeReclamar({ origen, numeroTick })
      });
    this.despachadorOutboxAuditoriaRuntime =
      new DespachadorOutboxAuditoriaRuntime({
        repositorioOutbox:
          contextoBootstrap.repositorioOutboxAuditoriaRuntime,
        repositorioAuditoria: contextoBootstrap.repositorioAuditoria,
        capturadorFederacionAuditoria:
          contextoBootstrap.capturadorFederacionAuditoria || null,
        instanciaId: this.instanciaId,
        concurrencia:
          this.configuracion.runtime.auditoriaOutboxConcurrencia,
        leaseTtlSegundos:
          this.configuracion.runtime.auditoriaOutboxLeaseTtlSegundos,
        reintentoBaseSegundos:
          this.configuracion.runtime.auditoriaOutboxReintentoBaseSegundos,
        reintentoMaximoSegundos:
          this.configuracion.runtime.auditoriaOutboxReintentoMaximoSegundos
      });
    this.coordinadorEmisionFederacionRuntime =
      new CoordinadorEmisionFederacionRuntime({
        repositorioCoordinacion:
          contextoBootstrap.repositorioCoordinacionEmisionFederacion,
        instanciaId: this.instanciaId,
        procesarFlujo: contextoBootstrap.procesadorFlujoEmisionFederacion
          ? (trabajo) => contextoBootstrap.procesadorFlujoEmisionFederacion
            .procesar(trabajo)
          : null
      });
    this.emisorHeartbeatFederacionRuntime =
      contextoBootstrap.emisorHeartbeatFederacionRuntime || null;
    this.supervisorSaludFederacionRuntime =
      contextoBootstrap.supervisorSaludFederacionRuntime || null;
    if (this.supervisorSaludFederacionRuntime) {
      await this.supervisorSaludFederacionRuntime.marcarRehidratacionCompleta({
        bootId: contextoBootstrap.bootFederacionId
      });
    }
    const prefijoFederacion = String(this.configuracion.redis.prefijoFederacion)
      .replace(/:+$/u, '');
    this.suscriptorSenalesFederacionRedis = new SuscriptorSenalesFederacionRedis({
      clienteRedis: contextoBootstrap.clienteRedis,
      canalDespertar: `${prefijoFederacion}:datos:disponibles:v1`,
      canalInvalidaciones: `${prefijoFederacion}:invalidaciones:v1`,
      onDespertar: () => this.coordinadorEmisionFederacionRuntime
        .procesarPendientes({ origen: 'redis_despertar', numeroTick: null }),
      onInvalidacion: async () => {
        await Promise.all([
          this.coordinadorEmisionFederacionRuntime.procesarPendientes({
            origen: 'redis_invalidacion',
            numeroTick: null
          }),
          this.supervisorSaludFederacionRuntime?.evaluar?.()
        ]);
      }
    });
    this.selectorMonitoresTelemetriaReactivos =
      new SelectorMonitoresTelemetriaReactivos({
        repositorioVinculos:
          contextoBootstrap.repositorioVinculosMonitoresTelemetria
      });
    this.gestorRetencionMonitores = contextoBootstrap.gestorRetencionMonitores;
    this.gestorRetencionCorreo = contextoBootstrap.gestorRetencionCorreo || null;
    this.gestorRetencionDatosFederados =
      contextoBootstrap.gestorRetencionDatosFederados || null;
    this.bloqueadorEjecucionMonitorRedis =
      contextoBootstrap.bloqueadorEjecucionMonitorRedis;
    if (this.despachadorOperacionesAdministrativasRuntime) {
      this.contexto.operacionesAdministrativasRuntime =
        await this.despachadorOperacionesAdministrativasRuntime.arrancar();
      await this.presenciaRedis.publicarCapacidadDespliegue(
        'eliminacionAdministrativaAgentes',
        crearDeclaracionCompatibilidadRuntimeEliminacionAgentes({
          instanciaId: this.instanciaId
        })
      );
      await this.presenciaRedis.publicarCapacidadDespliegue(
        'eliminacionAdministrativaOrganizaciones',
        crearDeclaracionCapacidadesRuntimeEliminacionOrganizaciones({
          instanciaId: this.instanciaId
        })
      );
    }
    this.contexto.ddnsPol = await this.procesarCausaPolDdns({
      origen: 'arranque',
      numeroTick: null
    });
    await this.planificadorMonitores.arrancar();
    try {
      this.contexto.senalesEfimerasFederacion =
        await this.suscriptorSenalesFederacionRedis.arrancar();
    } catch (error) {
      this.contexto.senalesEfimerasFederacion = {
        activo: false,
        error: String(error?.codigo || error?.code || 'suscripcion_federada_no_disponible')
      };
    }
    this.suscriptorAvisosEvaluacionTelemetriaRedis =
      new SuscriptorAvisosEvaluacionTelemetriaRedis({
        clienteRedis: contextoBootstrap.clienteRedis,
        canal:
          `${this.configuracion.runtime.redisPrefijo}telemetria:evaluacion:pendiente`,
        onAviso: () => this.procesarEvaluacionesTelemetria({
          origen: 'aviso_redis',
          numeroTick: null
        })
      });
    try {
      this.contexto.sincronizacionEvaluacionTelemetria =
        await this.suscriptorAvisosEvaluacionTelemetriaRedis.arrancar();
    } catch (error) {
      this.contexto.sincronizacionEvaluacionTelemetria = {
        activo: false,
        canal:
          `${this.configuracion.runtime.redisPrefijo}telemetria:evaluacion:pendiente`,
        error: String(error?.message || 'No se pudo suscribir al aviso Redis.')
      };
    }
    this.suscriptorAvisosPerfilServidorRedis =
      new SuscriptorAvisosPerfilServidorRedis({
        clienteRedis: contextoBootstrap.clienteRedis,
        canal: `${this.configuracion.runtime.redisPrefijo}perfil-servidor:avisos`,
        onAviso: async () => {
          const persistencia =
            await this.procesadorSenalesServidorRuntime.procesarPendientes({
              origen: 'aviso_pol_redis',
              numeroTick: null
            });
          if (persistencia.totalTransiciones > 0) {
            await this.procesarEvaluacionesTelemetria({
              origen: 'perfil_servidor_aviso_pol',
              numeroTick: null
            });
          }
          return persistencia;
        }
      });
    try {
      this.contexto.sincronizacionPolPerfilServidor =
        await this.suscriptorAvisosPerfilServidorRedis.arrancar();
    } catch (error) {
      this.contexto.sincronizacionPolPerfilServidor = {
        activo: false,
        canal: `${this.configuracion.runtime.redisPrefijo}perfil-servidor:avisos`,
        error: String(error?.message || 'No se pudo suscribir a los avisos POL.')
      };
    }
    this.suscriptorInvalidacionesMonitoresTelemetriaRedis =
      new SuscriptorInvalidacionesMonitoresTelemetriaRedis({
        clienteRedis: contextoBootstrap.clienteRedis,
        canal:
          `${this.configuracion.runtime.redisPrefijo}telemetria:monitores:invalidacion`,
        onInvalidacion: (aviso) =>
          this.encolarOperacionMonitores(() =>
            this.procesarInvalidacionMonitoresTelemetria(aviso)
          )
      });
    try {
      this.contexto.sincronizacionMonitoresTelemetriaReactivos =
        await this.suscriptorInvalidacionesMonitoresTelemetriaRedis.arrancar();
    } catch (error) {
      this.contexto.sincronizacionMonitoresTelemetriaReactivos = {
        activo: false,
        canal:
          `${this.configuracion.runtime.redisPrefijo}telemetria:monitores:invalidacion`,
        error: String(
          error?.message || 'No se pudo suscribir a invalidaciones de telemetría.'
        )
      };
    }
    this.actualizarResumenScheduler();
    await this.sincronizarRedisOperativo({ motivo: 'arranque_scheduler' });

    this.logArranque();

    return this.contexto;
  }

  async detener({ motivo = 'apagado solicitado' } = {}) {
    if (this.deteniendo) {
      return this.deteniendo;
    }

    this.deteniendo = this.detenerInterno({ motivo });
    return this.deteniendo;
  }

  async detenerInterno({ motivo }) {
    console.log(
      `[sentinelia-runtime] deteniendo instancia ${this.instanciaId}. motivo=${motivo}`
    );

    const errores = [];

    try {
      if (this.planificadorMonitores) {
        try {
          await this.planificadorMonitores.detener();
        } catch (error) {
          errores.push(error);
        }
      }

      if (this.suscriptorAvisosEvaluacionTelemetriaRedis) {
        try {
          await this.suscriptorAvisosEvaluacionTelemetriaRedis.detener();
        } catch (error) {
          errores.push(error);
        }
      }

      if (this.suscriptorAvisosPerfilServidorRedis) {
        try {
          await this.suscriptorAvisosPerfilServidorRedis.detener();
        } catch (error) {
          errores.push(error);
        }
      }

      if (this.suscriptorInvalidacionesMonitoresTelemetriaRedis) {
        try {
          await this.suscriptorInvalidacionesMonitoresTelemetriaRedis.detener();
        } catch (error) {
          errores.push(error);
        }
      }

      if (this.suscriptorSenalesFederacionRedis) {
        try {
          await this.suscriptorSenalesFederacionRedis.detener();
        } catch (error) {
          errores.push(error);
        }
      }

      if (this.presenciaRedis) {
        try {
          await this.presenciaRedis.detener();
        } catch (error) {
          errores.push(error);
        }
      }

      if (this.despachadorOperacionesAdministrativasRuntime) {
        try {
          await this.despachadorOperacionesAdministrativasRuntime.detener();
        } catch (error) {
          errores.push(error);
        }
      }

      try {
        await this.bootstrapRuntime.detener();
      } catch (error) {
        errores.push(error);
      }

      if (errores.length === 0) {
        console.log(
          `[sentinelia-runtime] instancia ${this.instanciaId} detenida correctamente.`
        );
      }
    } finally {
      this.arrancado = false;
      this.contexto = null;
      this.catalogoOperativo = null;
      this.estadoVivo = null;
      this.presenciaRedis = null;
      this.planificadorMonitores = null;
      this.selectorMonitoresVencidos = null;
      this.motorMonitores = null;
      this.aplicadorResultadosEstadoActual = null;
      this.persistidorEventosMonitores = null;
      this.gestorAlertasActivasMonitor = null;
      this.gestorHistoricoMonitores = null;
      this.motorTriggersRuntime = null;
      this.despachadorCorreoRuntime = null;
      this.despachadorEvaluacionesTelemetriaRuntime = null;
      this.coordinadorRelojRelativoTelemetriaRuntime = null;
      this.despachadorOutboxAuditoriaRuntime = null;
      this.coordinadorEmisionFederacionRuntime = null;
      this.emisorHeartbeatFederacionRuntime = null;
      this.supervisorSaludFederacionRuntime = null;
      this.suscriptorSenalesFederacionRedis = null;
      this.publicadorInvalidacionesMonitoresTelemetriaRedis = null;
      this.publicadorAvisosEvaluacionTelemetriaRedis = null;
      this.coordinadorPerfilServidorRedis = null;
      this.procesadorSenalesServidorRuntime = null;
      this.suscriptorAvisosPerfilServidorRedis = null;
      this.suscriptorAvisosEvaluacionTelemetriaRedis = null;
      this.selectorMonitoresTelemetriaReactivos = null;
      this.suscriptorInvalidacionesMonitoresTelemetriaRedis = null;
      this.gestorRetencionMonitores = null;
      this.gestorRetencionDatosFederados = null;
      this.servicioRefederacionFederacion = null;
      this.repositorioIdempotenciaLotesTelemetria = null;
      this.procesadorMaterializacionFederacion = null;
      this.despachadorOperacionesAdministrativasRuntime = null;
      this.bloqueadorEjecucionMonitorRedis = null;
      this.versionadorEstadoOperativoRedis = null;
      this.versionadorCatalogoMonitoresRedis = null;
      this.coordinadorDnsRuntime = null;
      this.procesadorCausasPolDdnsRuntime = null;
      this.alertasActivasPorMonitorId = new Map();
      this.cargadorCatalogoMonitores = null;
      this.cargadorCatalogoDns = null;
      this.rehidratadorEstado = null;
      this.versionCatalogoMonitoresActual = null;
      this.totalRecargasCatalogo = 0;
      this.ultimaRecargaCatalogoEn = null;
      this.colaOperacionesMonitores = Promise.resolve();
      this.iniciadoEn = null;
      this.deteniendo = null;
    }

    if (errores.length > 0) {
      throw errores[0];
    }
  }

  logArranque() {
    const resumen = this.contexto?.resumenArranque || {};
    const usoHorarioUtc = resumen.migraciones?.usoHorarioUtc || null;
    const resumenRehidratacion = this.contexto?.resumenRehidratacion || null;
    const sincronizacionRedis = this.contexto?.sincronizacionRedis || null;
    const resumenScheduler = this.contexto?.scheduler || null;

    console.log(
      `[sentinelia-runtime] instancia ${this.instanciaId} arrancada.`
    );
    console.log(
      `[sentinelia-runtime] entorno=${this.configuracion.entorno} iniciado_en=${this.iniciadoEn}`
    );
    console.log(
      `[sentinelia-runtime] SQL configurado: ${this.configuracion.sql.estaCompleta ? 'si' : 'no'}`
    );
    console.log(
      `[sentinelia-runtime] Redis: ${resumen.redis?.estado || 'desconocido'}`
    );
    console.log(
      `[sentinelia-runtime] ${resumen.migraciones?.mensaje || 'Bootstrap SQL sin resumen.'}`
    );
    console.log(
      `[sentinelia-runtime] ${resumen.usuarioInicial?.mensaje || 'Bootstrap de usuario inicial sin resumen.'}`
    );

    if (usoHorarioUtc) {
      console.log(
        `[sentinelia-runtime] SQL UTC verificado. session=${usoHorarioUtc.sessionTimeZone} global=${usoHorarioUtc.globalTimeZone} diferencia=${usoHorarioUtc.diferenciaSegundos}s`
      );
    }

    console.log(
      `[sentinelia-runtime] ${resumen.configuracionPortal?.mensaje || 'Configuración de portal sin resumen.'}`
    );

    if (resumen.configuracionPortal?.version != null) {
      console.log(
        `[sentinelia-runtime] Configuración portal version=${resumen.configuracionPortal.version}`
      );
    }

    const resumenCatalogo = this.catalogoOperativo?.serializarResumen?.() || null;

    if (resumenCatalogo) {
      const tiposCatalogo = formatearDistribucionTipos(resumenCatalogo.porTipo);
      console.log(
        `[sentinelia-runtime] Catálogo operativo cargado. total=${resumenCatalogo.total} tipos=${tiposCatalogo} empresa=${resumenCatalogo.totalEmpresa} sitio=${resumenCatalogo.totalSitio} generado_en=${resumenCatalogo.generadoEn}`
      );
      const resumenEstadoVivo = this.estadoVivo?.serializarResumen?.() || null;

      if (resumenEstadoVivo) {
        console.log(
          `[sentinelia-runtime] Estado vivo materializado. total=${resumenEstadoVivo.total} desconocidos=${resumenEstadoVivo.totalDesconocidos} pendientes_scheduler=${resumenEstadoVivo.totalPendientesScheduler} sin_ejecutar=${resumenEstadoVivo.totalSinEjecutar}`
        );
      }
    }

    if (resumenRehidratacion) {
      console.log(
        `[sentinelia-runtime] Rehidratación SQL. persistidos=${resumenRehidratacion.registrosPersistidos} rehidratados=${resumenRehidratacion.rehidratados} sin_estado_previo=${resumenRehidratacion.sinEstadoPrevio} version_incompatible=${resumenRehidratacion.versionIncompatible} descartados_inactivos=${resumenRehidratacion.descartadosInactivos}`
      );
    }

    if (sincronizacionRedis) {
      console.log(
        `[sentinelia-runtime] Redis efímero activo. prefijo=${sincronizacionRedis.prefijo} ttl=${sincronizacionRedis.ttlSegundos}s latido=${sincronizacionRedis.intervaloLatidoMs}ms version_operativa=${sincronizacionRedis.versionOperativa || 'n/a'} version_catalogo=${sincronizacionRedis.versionCatalogoMonitores || 'n/a'}`
      );
    }

    const sincronizacionDns = this.contexto?.sincronizacionDns || null;

    if (sincronizacionDns) {
      console.log(
        `[sentinelia-runtime] DNS runtime preparado. version_catalogo=${sincronizacionDns.versionCatalogoDnsActual || 'n/a'} errores=${sincronizacionDns.totalErrores || 0} zonas=${sincronizacionDns.catalogo?.totalZonas || 0} publicables=${sincronizacionDns.catalogo?.totalZonasPublicables || 0}`
      );
    }

    if (resumenScheduler) {
      console.log(
        `[sentinelia-runtime] Scheduler activo. tick=${resumenScheduler.intervaloTickMs}ms ticks=${resumenScheduler.ticksEjecutados} vencidos=${resumenScheduler.totalVencidos ?? 0} proximo=${resumenScheduler.proximoIntentoGlobalEn || 'n/a'} ultimo_origen=${resumenScheduler.ultimoOrigenTick || 'n/a'}`
      );
    }
  }

  encolarOperacionMonitores(operacion) {
    const ejecucion = this.colaOperacionesMonitores.then(() => operacion());
    this.colaOperacionesMonitores = ejecucion.catch(() => null);
    return ejecucion;
  }

  // auditoria-productor: runtime.monitores.ejecucion
  async procesarTickScheduler({ origen, numeroTick, iniciadoEn }) {
    await this.sincronizarDnsSiHaCambiado({ origen, numeroTick });
    await this.sincronizarCatalogoSiHaCambiado({ origen, numeroTick });

    const operacionesAdministrativas =
      this.despachadorOperacionesAdministrativasRuntime
        ? await this.despachadorOperacionesAdministrativasRuntime
          .procesarPendientes({ origen, numeroTick })
        : null;
    if (operacionesAdministrativas) {
      this.contexto.operacionesAdministrativasRuntime = operacionesAdministrativas;
      if (
        operacionesAdministrativas.totalOperaciones > 0 ||
        operacionesAdministrativas.totalPostcommit > 0 ||
        operacionesAdministrativas.totalErrores > 0
      ) {
        console.log(
          `[sentinelia-runtime] Operaciones administrativas tick ${numeroTick}. ` +
          `operaciones=${operacionesAdministrativas.totalOperaciones} ` +
          `postcommit=${operacionesAdministrativas.totalPostcommit} ` +
          `lease_perdido=${operacionesAdministrativas.totalLeasePerdido} ` +
          `errores=${operacionesAdministrativas.totalErrores}`
        );
      }
    }

    const causaPolDdns = await this.procesarCausaPolDdns({ origen, numeroTick });
    if (causaPolDdns) this.contexto.ddnsPol = causaPolDdns;

    const persistenciaPerfilServidor = this.procesadorSenalesServidorRuntime
      ? await this.procesadorSenalesServidorRuntime.procesarPendientes({
          origen,
          numeroTick
        })
      : null;
    const persistenciaEvaluacionPerfilServidor =
      persistenciaPerfilServidor?.totalTransiciones > 0
        ? await this.procesarEvaluacionesTelemetria({
            origen: 'perfil_servidor',
            numeroTick
          })
        : null;

    let seleccion = this.selectorMonitoresVencidos.seleccionar({
      catalogoOperativo: this.catalogoOperativo,
      almacenEstadoActual: this.estadoVivo,
      fechaEvaluacionUtc: iniciadoEn
    });
    seleccion = this.incorporarMonitoresFederadosPendientes({
      seleccion,
      fechaReferenciaUtc: iniciadoEn
    });

    this.aplicarProgramacionesEnEstado(seleccion.programaciones);

    let loteEjecucion = null;
    let persistenciaEstadoActual = null;
    let persistenciaEventos = null;
    let persistenciaAlertas = null;
    let persistenciaHistorico = null;
    let retencionMonitores = null;
    let retencionCorreo = null;
    let persistenciaTriggers = null;
    let persistenciaCorreo = null;
    let persistenciaEvaluacionTelemetria = null;
    let persistenciaAuditoriaOutbox = null;
    let coordinacionEmisionFederacion = null;
    let heartbeatFederacion = null;
    let saludFederacion = null;
    let materializacionFederacion = null;
    let coordinacionBloqueosRedis = null;
    let persistenciaReactiva = null;
    let purgaIdempotenciaTelemetria = null;

    if (seleccion.monitoresVencidos.length > 0) {
      let candidatosEjecutables = seleccion.monitoresVencidos;
      let bloqueosActivos = [];

      if (this.bloqueadorEjecucionMonitorRedis) {
        const bloqueo =
          await this.bloqueadorEjecucionMonitorRedis.bloquearCandidatos({
            candidatos: seleccion.monitoresVencidos,
            instanciaId: this.instanciaId,
            origen,
            numeroTick
          });
        candidatosEjecutables = bloqueo.candidatosBloqueados;
        bloqueosActivos = bloqueo.bloqueos;
        coordinacionBloqueosRedis = {
          ...bloqueo.resumen,
          liberacion: null
        };

        for (const candidatoSaltado of bloqueo.candidatosSaltados) {
          this.estadoVivo.actualizarEstadoMonitor(candidatoSaltado.monitorId, {
            vencidoParaEjecucion: true,
            pendienteScheduler: true,
            motivoProgramacion: 'bloqueado_por_runtime_externo'
          });
        }
      }

      try {
        if (candidatosEjecutables.length > 0) {
          loteEjecucion = await this.motorMonitores.ejecutarMonitores({
            catalogoOperativo: this.catalogoOperativo,
            almacenEstadoActual: this.estadoVivo,
            candidatos: candidatosEjecutables
          });
          const cicloOperativo = await this.aplicarCicloOperativoMonitores({
            loteEjecucion,
            candidatos: candidatosEjecutables,
            origen,
            numeroTick,
            ejecutarRetencion: true
          });
          for (const resultado of loteEjecucion.resultados) {
            this.monitoresFederadosPendientes.delete(Number(resultado.monitorId));
          }
          ({
            persistenciaEstadoActual,
            persistenciaEventos,
            persistenciaAlertas,
            persistenciaHistorico,
            retencionMonitores,
            persistenciaReactiva,
            persistenciaTriggers
          } = cicloOperativo);

          seleccion = this.selectorMonitoresVencidos.seleccionar({
            catalogoOperativo: this.catalogoOperativo,
            almacenEstadoActual: this.estadoVivo,
            fechaEvaluacionUtc: loteEjecucion.finalizadoEnUtc
          });
          this.aplicarProgramacionesEnEstado(seleccion.programaciones);
          console.log(
            `[sentinelia-runtime] Tick ${numeroTick} ejecutado. candidatos=${loteEjecucion.totalCandidatos} exitosos=${loteEjecucion.totalExitosos} fallidos=${loteEjecucion.totalFallidos} persistidos_estado=${persistenciaEstadoActual.totalPersistidos} cambios_estado=${persistenciaEstadoActual.totalCambiosEstado} persistidos_eventos=${persistenciaEventos.totalPersistidos} descartados_eventos=${persistenciaEventos.totalDescartados} aperturas_alerta=${persistenciaAlertas.totalAperturas} confirmaciones_alerta=${persistenciaAlertas.totalConfirmaciones} cierres_alerta=${persistenciaAlertas.totalCierres} tramos_nuevos=${persistenciaHistorico.totalPersistidos} tramos_actualizados=${persistenciaHistorico.totalActualizados} transiciones_historico=${persistenciaHistorico.totalTransiciones} retencion_activa=${retencionMonitores?.activa ? 'si' : 'no'} retencion_omitida=${retencionMonitores?.omitida ? 'si' : 'no'} retencion_eventos=${retencionMonitores?.eventosEliminados || 0} retencion_historico=${retencionMonitores?.historicosEliminados || 0} triggers_planes=${persistenciaTriggers?.totalPlanesUnicos || 0} triggers_ok=${persistenciaTriggers?.totalOk || 0} triggers_error=${persistenciaTriggers?.totalError || 0} reactivos_oleadas=${persistenciaReactiva?.totalOleadas || 0} reactivos_ejecutados=${persistenciaReactiva?.totalEjecutados || 0}`
          );
        }
      } finally {
        if (
          this.bloqueadorEjecucionMonitorRedis &&
          bloqueosActivos.length > 0
        ) {
          const liberacion =
            await this.bloqueadorEjecucionMonitorRedis.liberarBloqueos(
              bloqueosActivos
            );

          if (coordinacionBloqueosRedis) {
            coordinacionBloqueosRedis.liberacion = liberacion;
          }

          if (liberacion.totalNoLiberados > 0) {
            console.error(
              `[sentinelia-runtime] No se pudieron liberar ${liberacion.totalNoLiberados}/${liberacion.totalBloqueos} bloqueos Redis de ejecución.`
            );
          }
        }
      }

      if (coordinacionBloqueosRedis) {
        console.log(
          `[sentinelia-runtime] Coordinación Redis tick ${numeroTick}. vencidos=${coordinacionBloqueosRedis.totalCandidatos} bloqueados=${coordinacionBloqueosRedis.totalBloqueados} saltados=${coordinacionBloqueosRedis.totalSaltados} ttl=${coordinacionBloqueosRedis.ttlSegundos}s`
        );
      }
    }

    if (!persistenciaTriggers && this.motorTriggersRuntime) {
      persistenciaTriggers = await this.motorTriggersRuntime.ejecutarPendientes({
        origen,
        numeroTick
      });
    }

    if (!retencionMonitores && this.gestorRetencionMonitores) {
      retencionMonitores = await this.gestorRetencionMonitores.ejecutarSiProcede({
        fechaReferenciaUtc: iniciadoEn
      });
    }

    if (this.gestorRetencionCorreo) {
      retencionCorreo = await this.gestorRetencionCorreo.ejecutarSiProcede({
        fechaReferenciaUtc: iniciadoEn
      });
      if (
        retencionCorreo.purgados > 0 ||
        retencionCorreo.errores > 0 ||
        !retencionCorreo.diagnostico.ok
      ) {
        console.log(
          `[sentinelia-runtime] Retención correo tick ${numeroTick}. ` +
          `omitida=${retencionCorreo.omitida ? 'si' : 'no'} ` +
          `candidatos=${retencionCorreo.candidatos} ` +
          `purgados=${retencionCorreo.purgados} ` +
          `errores=${retencionCorreo.errores} ` +
          `backlog=${retencionCorreo.backlogPosible ? 'si' : 'no'} ` +
          `incompatibles=${retencionCorreo.diagnostico.totalIncompatibles}`
        );
      }
    }

    if (this.procesadorMaterializacionFederacion) {
      materializacionFederacion =
        await this.procesadorMaterializacionFederacion.procesarPendientes({
          origen,
          numeroTick
        });
      if (
        materializacionFederacion.totalReclamadas > 0 ||
        materializacionFederacion.totalLeasePerdido > 0
      ) {
        console.log(
          `[sentinelia-runtime] Materialización federada tick ${numeroTick}. ` +
          `reclamadas=${materializacionFederacion.totalReclamadas} ` +
          `materializadas=${materializacionFederacion.totalMaterializadas} ` +
          `reintentables=${materializacionFederacion.totalReintentables} ` +
          `lease_perdido=${materializacionFederacion.totalLeasePerdido} ` +
          `errores_coordinacion=${materializacionFederacion.totalErroresCoordinacion}`
        );
      }
    }

    let retencionDatosFederados = null;
    if (this.gestorRetencionDatosFederados) {
      retencionDatosFederados =
        await this.gestorRetencionDatosFederados.ejecutarSiProcede();
      if (
        retencionDatosFederados.totalEliminados > 0 ||
        retencionDatosFederados.totalSensiblesPurgados > 0 ||
        retencionDatosFederados.errores > 0
      ) {
        console.log(
          `[sentinelia-runtime] Retención federada tick ${numeroTick}. ` +
          `familias=${retencionDatosFederados.totalFamilias} ` +
          `eliminados=${retencionDatosFederados.totalEliminados} ` +
          `sensibles_purgados=${retencionDatosFederados.totalSensiblesPurgados} ` +
          `backlog=${retencionDatosFederados.familiasConBacklog} ` +
          `errores=${retencionDatosFederados.errores}`
        );
      }
    }

    let retencionAuditoria = null;
    if (this.servicioRetencionAuditoriaGlobal) {
      retencionAuditoria =
        await this.servicioRetencionAuditoriaGlobal.ejecutarTareaDiaria({
          fechaReferenciaUtc: iniciadoEn,
          presupuestoCadenas: 25,
          limiteEventosPorCadena: 500
        });
      if (
        retencionAuditoria.recortesAplicados > 0 ||
        retencionAuditoria.errores > 0 ||
        retencionAuditoria.bloqueada
      ) {
        console.log(
          `[sentinelia-runtime] Retención auditable tick ${numeroTick}. activa=${retencionAuditoria.activa ? 'si' : 'no'} omitida=${retencionAuditoria.omitida ? 'si' : 'no'} bloqueada=${retencionAuditoria.bloqueada ? 'si' : 'no'} cadenas=${retencionAuditoria.cadenasProcesadas} recortes=${retencionAuditoria.recortesAplicados} sin_cambios=${retencionAuditoria.sinCambios} errores=${retencionAuditoria.errores} backlog_posible=${retencionAuditoria.backlogPosible ? 'si' : 'no'}`
        );
      }
    }

    let retencionDdns = null;
    if (this.servicioRetencionDdnsAgentes) {
      retencionDdns = await this.servicioRetencionDdnsAgentes.ejecutarTareaDiaria({
        fechaReferenciaUtc: iniciadoEn,
        limite: 100
      });
      if (retencionDdns.purgadas > 0 || retencionDdns.errores > 0) {
        console.log(
          `[sentinelia-runtime] Retención DDNS tick ${numeroTick}. ` +
          `concesiones=${retencionDdns.purgadas} ` +
          `solicitudes=${retencionDdns.solicitudes} ` +
          `intenciones=${retencionDdns.intenciones} ` +
          `intentos=${retencionDdns.intentos} errores=${retencionDdns.errores}`
        );
      }
    }

    let limpiezaTecnicaAuditoria = null;
    if (this.servicioLimpiezaTecnicaAuditoria) {
      limpiezaTecnicaAuditoria =
        await this.ejecutarLimpiezaTecnicaAuditoriaDiaria({
          fechaReferenciaUtc: iniciadoEn
        });
      if (
        limpiezaTecnicaAuditoria.totalEliminadas > 0 ||
        limpiezaTecnicaAuditoria.bloqueada ||
        limpiezaTecnicaAuditoria.error
      ) {
        console.log(
          `[sentinelia-runtime] Limpieza técnica auditoría tick ${numeroTick}. omitida=${limpiezaTecnicaAuditoria.omitida ? 'si' : 'no'} bloqueada=${limpiezaTecnicaAuditoria.bloqueada ? 'si' : 'no'} eliminadas=${limpiezaTecnicaAuditoria.totalEliminadas} backlog_posible=${limpiezaTecnicaAuditoria.backlogPosible ? 'si' : 'no'} error=${limpiezaTecnicaAuditoria.error || 'no'}`
        );
      }
    }

    if (this.repositorioIdempotenciaLotesTelemetria) {
      const totalEliminados =
        await this.repositorioIdempotenciaLotesTelemetria.purgarExpirados({
          limite: 500
        });
      purgaIdempotenciaTelemetria = {
        limite: 500,
        totalEliminados
      };
      if (totalEliminados > 0) {
        console.log(
          `[sentinelia-runtime] Purga idempotencia telemetría tick ${numeroTick}. eliminados=${totalEliminados} limite=500`
        );
      }
    }

    persistenciaEvaluacionTelemetria =
      await this.procesarEvaluacionesTelemetria({ origen, numeroTick });

    if (this.emisorHeartbeatFederacionRuntime) {
      await this.contexto.servicioConfiguracionPortal.asegurarActualizada();
      const configuracionFederacion = this.contexto.servicioConfiguracionPortal
        .obtenerConfiguracionActual().obtenerConfiguracionFederacion();
      heartbeatFederacion = await this.emisorHeartbeatFederacionRuntime.ejecutar({
        silencioRelacionMs: configuracionFederacion.silencioRelacionMs,
        activacionFederacion: configuracionFederacion.activacionFederacion
      });
    }

    if (this.servicioRefederacionFederacion) {
      await this.servicioRefederacionFederacion.procesarPendientes({ limite: 100 });
    }

    if (this.coordinadorEmisionFederacionRuntime) {
      coordinacionEmisionFederacion =
        await this.coordinadorEmisionFederacionRuntime.procesarPendientes({
          origen,
          numeroTick
        });
    }

    if (this.supervisorSaludFederacionRuntime) {
      saludFederacion = await this.supervisorSaludFederacionRuntime.evaluar();
      await this.registrarTransicionesFederadasPendientes(saludFederacion);
    }

    if (this.despachadorOutboxAuditoriaRuntime) {
      persistenciaAuditoriaOutbox =
        await this.despachadorOutboxAuditoriaRuntime.procesarPendientes({
          origen,
          numeroTick
        });
      if (
        persistenciaAuditoriaOutbox.totalReclamadas > 0 ||
        persistenciaAuditoriaOutbox.error
      ) {
        console.log(
          `[sentinelia-runtime] Auditoría diferida tick ${numeroTick}. reclamadas=${persistenciaAuditoriaOutbox.totalReclamadas} completadas=${persistenciaAuditoriaOutbox.totalCompletadas} reintentables=${persistenciaAuditoriaOutbox.totalReintentables} bloqueadas=${persistenciaAuditoriaOutbox.totalBloqueadas} lease_perdido=${persistenciaAuditoriaOutbox.totalLeasePerdido} errores=${persistenciaAuditoriaOutbox.totalErrores}`
        );
      }
    }

    let coordinacionRecuperacionPassword = null;
    if (this.coordinadorEmisionesRecuperacionPasswordRuntime) {
      coordinacionRecuperacionPassword =
        await this.coordinadorEmisionesRecuperacionPasswordRuntime
          .procesarPendientes({ origen, numeroTick });
      if (coordinacionRecuperacionPassword.totalProcesadas > 0) {
        console.log(
          `[sentinelia-runtime] Recuperación por correo tick ${numeroTick}. ` +
          `procesadas=${coordinacionRecuperacionPassword.totalProcesadas} ` +
          `liberadas=${coordinacionRecuperacionPassword.totalLiberadas} ` +
          `descartadas=${coordinacionRecuperacionPassword.totalDescartadas}`
        );
      }
    }

    if (this.despachadorCorreoRuntime) {
      persistenciaCorreo = await this.despachadorCorreoRuntime.despacharPendientes({
        origen,
        numeroTick
      });

      if (
        persistenciaCorreo &&
        !persistenciaCorreo.omitido &&
        (
          persistenciaCorreo.totalIntentados > 0 ||
          persistenciaCorreo.error
        )
      ) {
        console.log(
          `[sentinelia-runtime] Correo tick ${numeroTick}. regimen=${persistenciaCorreo.regimen || 'legacy'} intentados=${persistenciaCorreo.totalIntentados} enviados=${persistenciaCorreo.totalDespachados} reintentables=${persistenciaCorreo.totalReintentables} finales=${persistenciaCorreo.totalFallosFinales} ambiguos=${persistenciaCorreo.totalAmbiguos || 0} descartados=${persistenciaCorreo.totalDescartados || 0} lote=${persistenciaCorreo.loteMaximo}`
        );
      }
    }

    this.actualizarResumenScheduler({
      fechaEvaluacionUtc: seleccion.fechaEvaluacionUtc,
      totalConsiderados: seleccion.totalConsiderados,
      totalVencidos: seleccion.totalVencidos,
      totalPendientesFuturos: seleccion.totalPendientesFuturos,
      proximoIntentoGlobalEn: seleccion.proximoIntentoGlobalEn,
      monitoresVencidos: seleccion.monitoresVencidos,
      ultimaPersistenciaEstadoActual: persistenciaEstadoActual,
      ultimaPersistenciaEventos: persistenciaEventos,
      ultimaPersistenciaAlertas: persistenciaAlertas,
      ultimaPersistenciaHistorico: persistenciaHistorico,
      ultimaRetencionMonitores: retencionMonitores,
      ultimaRetencionCorreo: retencionCorreo,
      ultimaRetencionDdns: retencionDdns,
      ultimaRetencionDatosFederados: retencionDatosFederados,
      ultimaMaterializacionFederacion: materializacionFederacion,
      ultimaPersistenciaTriggers: persistenciaTriggers,
      ultimaPersistenciaReactiva: persistenciaReactiva,
      ultimaPersistenciaCorreo: persistenciaCorreo,
      ultimaCoordinacionRecuperacionPassword: coordinacionRecuperacionPassword,
      ultimaPersistenciaEvaluacionTelemetria: persistenciaEvaluacionTelemetria,
      ultimaPurgaIdempotenciaTelemetria: purgaIdempotenciaTelemetria,
      ultimaPersistenciaPerfilServidor: persistenciaPerfilServidor,
      ultimaEvaluacionPerfilServidor: persistenciaEvaluacionPerfilServidor,
      ultimaPersistenciaAuditoriaOutbox: persistenciaAuditoriaOutbox,
      ultimaCoordinacionEmisionFederacion: coordinacionEmisionFederacion,
      ultimoHeartbeatFederacion: heartbeatFederacion,
      ultimaSaludFederacion: saludFederacion,
      ultimaCoordinacionBloqueosRedis: coordinacionBloqueosRedis,
      ultimaEjecucion: loteEjecucion
        ? {
            ejecutadoEnUtc: loteEjecucion.ejecutadoEnUtc,
            finalizadoEnUtc: loteEjecucion.finalizadoEnUtc,
            totalCandidatos: loteEjecucion.totalCandidatos,
            totalEjecutados: loteEjecucion.totalEjecutados,
            totalExitosos: loteEjecucion.totalExitosos,
            totalFallidos: loteEjecucion.totalFallidos,
            resultados: loteEjecucion.resultados
          }
        : null
    });
    await this.sincronizarRedisOperativo({
      motivo: loteEjecucion ? 'tick_ejecucion' : 'tick_programacion'
    });

    return {
      origen,
      numeroTick,
      iniciadoEn,
      seleccion,
      loteEjecucion,
      persistenciaEstadoActual,
      persistenciaEventos,
      persistenciaAlertas,
      persistenciaHistorico,
      retencionMonitores,
      retencionCorreo,
      persistenciaTriggers,
      persistenciaReactiva,
      persistenciaCorreo,
      coordinacionRecuperacionPassword,
      persistenciaEvaluacionTelemetria,
      purgaIdempotenciaTelemetria,
      persistenciaPerfilServidor,
      persistenciaEvaluacionPerfilServidor,
      persistenciaAuditoriaOutbox,
      materializacionFederacion,
      coordinacionEmisionFederacion,
      heartbeatFederacion,
      saludFederacion,
      coordinacionBloqueosRedis
    };
  }

  incorporarMonitoresFederadosPendientes({ seleccion, fechaReferenciaUtc }) {
    if (this.monitoresFederadosPendientes.size === 0) return seleccion;
    const existentes = new Set(
      seleccion.monitoresVencidos.map((candidato) => Number(candidato.monitorId))
    );
    const adicionales = [];
    for (const monitorId of this.monitoresFederadosPendientes) {
      if (existentes.has(monitorId)) continue;
      const monitor = this.catalogoOperativo.buscarPorId(monitorId);
      if (!monitor?.activo || monitor.tipo !== 'booleano') {
        this.monitoresFederadosPendientes.delete(monitorId);
        continue;
      }
      adicionales.push({
        monitorId: monitor.id,
        nombre: monitor.nombre,
        tipo: monitor.tipo,
        versionCatalogo: monitor.version,
        scope: { ...monitor.scope },
        proximoIntentoEn: new Date(fechaReferenciaUtc).toISOString(),
        retrasoSegundos: 0,
        motivoProgramacion: 'entrada_federada_actualizada'
      });
    }
    if (adicionales.length === 0) return seleccion;
    return {
      ...seleccion,
      totalVencidos: seleccion.totalVencidos + adicionales.length,
      monitoresVencidos: [...seleccion.monitoresVencidos, ...adicionales]
    };
  }

  async registrarTransicionesFederadasPendientes(saludFederacion) {
    const transiciones = saludFederacion?.tiempoEstadosRemotos?.transiciones;
    const repositorio = this.contexto
      ?.repositorioEntradasFederadasMonitoresLogicos;
    if (!Array.isArray(transiciones) || transiciones.length === 0 ||
        typeof repositorio?.listarMonitorIdsPorProyeccionIds !== 'function') {
      return 0;
    }
    const monitorIds = await repositorio.listarMonitorIdsPorProyeccionIds(
      transiciones.map((transicion) => transicion.proyeccionId)
    );
    for (const monitorId of monitorIds) this.monitoresFederadosPendientes.add(monitorId);
    return monitorIds.length;
  }

  async aplicarCicloOperativoMonitores({
    loteEjecucion,
    candidatos = [],
    origen,
    numeroTick = null,
    ejecutarRetencion = false
  }) {
    const {
      persistenciaEstadoActual,
      persistenciaEventos,
      persistenciaAlertas,
      persistenciaHistorico,
      planificacionTriggers
    } = await this.persistirNucleoCicloMonitores({ loteEjecucion });
    this.actualizarEstadoAlertasActivas(persistenciaAlertas);
    const retencionMonitores =
      ejecutarRetencion && this.gestorRetencionMonitores
        ? await this.gestorRetencionMonitores.ejecutarSiProcede({
            fechaReferenciaUtc: loteEjecucion.finalizadoEnUtc
          })
        : null;
    const persistenciaReactiva =
      await this.ejecutarCascadaMonitoresLogicosReactivos({
        persistenciaEstadoActual,
        origen,
        numeroTick,
        fechaReferenciaUtc: loteEjecucion.finalizadoEnUtc,
        monitoresYaEjecutados: candidatos.map(
          (candidato) => candidato.monitorId
        )
      });
    let persistenciaTriggers = null;
    if (this.motorTriggersRuntime) {
      persistenciaTriggers =
        await this.motorTriggersRuntime.ejecutarPendientes({
          origen,
          numeroTick
        });
    }
    if (this.versionadorEstadoOperativoRedis) {
      this.contexto.sincronizacionRedis = {
        ...this.contexto.sincronizacionRedis,
        versionOperativa:
          await this.versionadorEstadoOperativoRedis.incrementarVersion()
      };
    }
    return {
      persistenciaEstadoActual,
      persistenciaEventos,
      persistenciaAlertas,
      persistenciaHistorico,
      planificacionTriggers,
      retencionMonitores,
      persistenciaReactiva,
      persistenciaTriggers
    };
  }

  async persistirNucleoCicloMonitores({ loteEjecucion }) {
    const persistir = async (conexion = null) => {
      const opciones = { conexion };
      // El bloqueo se mantiene hasta el commit. Si la desactivación ganó la
      // carrera, descartamos el resultado; si ganó el tick, la desactivación
      // posterior cerrará su alerta en la misma transacción administrativa.
      let lotePersistible = loteEjecucion;
      const resultadosDescartadosAdministracion = [];
      if (this.repositorioMonitores && conexion) {
        const filas = await this.repositorioMonitores.bloquearPorIds(
          loteEjecucion.resultados.map((resultado) => resultado.monitorId),
          opciones
        );
        const porId = new Map(filas.map((fila) => [Number(fila.id), fila]));
        lotePersistible = {
          ...loteEjecucion,
          resultados: loteEjecucion.resultados.filter((resultado) => {
            const fila = porId.get(Number(resultado.monitorId));
            const versionActual = fila && normalizarMarcaUtc(fila.fecha_actualizacion || fila.fecha_creacion);
            const valido = Boolean(fila?.activo) && resultado.versionCatalogo === versionActual;
            if (!valido) resultadosDescartadosAdministracion.push({
              monitorId: resultado.monitorId,
              motivo: !fila ? 'monitor_eliminado' : !fila.activo ? 'monitor_inactivo' : 'version_monitor_modificada'
            });
            return valido;
          })
        };
      }
      const persistenciaEstadoActual =
        await this.aplicadorResultadosEstadoActual.aplicar({
          almacenEstadoActual: this.estadoVivo,
          resultados: lotePersistible.resultados
        }, opciones);
      const persistenciaEventos =
        await this.persistidorEventosMonitores.persistirDesdeLote({
          catalogoOperativo: this.catalogoOperativo,
          loteEjecucion: lotePersistible
        }, opciones);
      const persistenciaAlertas =
        await this.gestorAlertasActivasMonitor.aplicarResultados({
          catalogoOperativo: this.catalogoOperativo,
          resultados: persistenciaEstadoActual.resultadosEstabilizados
        }, opciones);
      const resultadosEstabilizadosPorId = new Map(
        persistenciaEstadoActual.resultadosEstabilizados.map((resultado) => [
          resultado.monitorId, resultado
        ])
      );
      const persistenciaHistorico =
        await this.gestorHistoricoMonitores.aplicarResultados({
          catalogoOperativo: this.catalogoOperativo,
          resultados: lotePersistible.resultados.map((resultado) =>
            resultado.efectosDerivadosHabilitados === false
              ? resultado
              : (resultadosEstabilizadosPorId.get(resultado.monitorId) || resultado)
          ).filter(
            (resultado) => !resultado.histeresisPendiente
          ),
          persistenciaEventos
        }, opciones);
      const planificacionTriggers = this.motorTriggersRuntime
        ? await this.motorTriggersRuntime.planificarDesdePersistenciaAlertas({
            persistenciaAlertas,
            conexion
          })
        : null;
      return {
        resultadosDescartadosAdministracion,
        persistenciaEstadoActual,
        persistenciaEventos,
        persistenciaAlertas,
        persistenciaHistorico,
        planificacionTriggers
      };
    };
    return this.fronteraTransaccionalMonitores
      ? this.fronteraTransaccionalMonitores.ejecutar(persistir)
      : persistir();
  }

  async procesarInvalidacionMonitoresTelemetria(aviso = {}) {
    if (!this.selectorMonitoresTelemetriaReactivos || !this.motorMonitores) {
      return {
        omitida: true,
        motivo: 'runtime_monitores_no_preparado',
        totalCandidatos: 0,
        totalEjecutados: 0
      };
    }

    const origenInvalidacion = resolverOrigenInvalidacionTelemetria(aviso);
    await this.sincronizarCatalogoSiHaCambiado({
      origen: origenInvalidacion,
      numeroTick: null
    });
    const seleccion = await this.selectorMonitoresTelemetriaReactivos.seleccionar({
      catalogoOperativo: this.catalogoOperativo,
      aviso,
      fechaEvaluacionUtc: new Date()
    });
    let candidatosEjecutables = seleccion.candidatos;
    let bloqueosActivos = [];
    let coordinacionBloqueosRedis = null;
    let loteEjecucion = null;
    let cicloOperativo = null;

    if (
      candidatosEjecutables.length > 0 &&
      this.bloqueadorEjecucionMonitorRedis
    ) {
      const bloqueo =
        await this.bloqueadorEjecucionMonitorRedis.bloquearCandidatos({
          candidatos: candidatosEjecutables,
          instanciaId: this.instanciaId,
          origen: origenInvalidacion,
          numeroTick: null
        });
      candidatosEjecutables = bloqueo.candidatosBloqueados;
      bloqueosActivos = bloqueo.bloqueos;
      coordinacionBloqueosRedis = {
        ...bloqueo.resumen,
        liberacion: null
      };
    }

    try {
      if (candidatosEjecutables.length > 0) {
        loteEjecucion = await this.motorMonitores.ejecutarMonitores({
          catalogoOperativo: this.catalogoOperativo,
          almacenEstadoActual: this.estadoVivo,
          candidatos: candidatosEjecutables
        });
        cicloOperativo = await this.aplicarCicloOperativoMonitores({
          loteEjecucion,
          candidatos: candidatosEjecutables,
          origen: origenInvalidacion,
          numeroTick: null
        });
      }
    } finally {
      if (
        this.bloqueadorEjecucionMonitorRedis &&
        bloqueosActivos.length > 0
      ) {
        const liberacion =
          await this.bloqueadorEjecucionMonitorRedis.liberarBloqueos(
            bloqueosActivos
          );
        coordinacionBloqueosRedis.liberacion = liberacion;
        if (liberacion.totalNoLiberados > 0) {
          console.error(
            `[sentinelia-runtime] No se pudieron liberar ${liberacion.totalNoLiberados}/${liberacion.totalBloqueos} bloqueos Redis de invalidación de telemetría.`
          );
        }
      }
    }

    if (loteEjecucion) {
      const programacion = this.selectorMonitoresVencidos.seleccionar({
        catalogoOperativo: this.catalogoOperativo,
        almacenEstadoActual: this.estadoVivo,
        fechaEvaluacionUtc: loteEjecucion.finalizadoEnUtc
      });
      this.aplicarProgramacionesEnEstado(programacion.programaciones);
    }

    const resumen = {
      omitida: false,
      procesadaEnUtc: new Date().toISOString(),
      totalSenales: seleccion.totalSenales || 0,
      totalReglas: seleccion.totalReglas || 0,
      totalVinculos: seleccion.totalVinculos,
      totalCandidatos: seleccion.totalCandidatos,
      totalDescartados: seleccion.totalDescartados,
      totalEjecutados: loteEjecucion?.totalEjecutados || 0,
      monitorIdsEjecutados: candidatosEjecutables.map(
        (candidato) => candidato.monitorId
      ),
      seleccion,
      loteEjecucion,
      cicloOperativo,
      coordinacionBloqueosRedis
    };
    if (this.contexto) {
      this.contexto.sincronizacionMonitoresTelemetriaReactivos = {
        ...(this.suscriptorInvalidacionesMonitoresTelemetriaRedis
          ?.serializarResumen?.() || {}),
        ultimaInvalidacion: resumen
      };
    }
    this.actualizarResumenScheduler({
      ultimaEvaluacionReactivaMonitoresTelemetria: resumen
    });
    if (loteEjecucion) {
      await this.sincronizarRedisOperativo({
        motivo: origenInvalidacion
      });
    }
    console.log(
      `[sentinelia-runtime] Invalidación de telemetría. senales=${resumen.totalSenales} reglas=${resumen.totalReglas} vinculados=${resumen.totalVinculos} candidatos=${resumen.totalCandidatos} ejecutados=${resumen.totalEjecutados}`
    );
    return resumen;
  }

  async procesarEvaluacionesTelemetria({ origen, numeroTick }) {
    if (!this.despachadorEvaluacionesTelemetriaRuntime) {
      return null;
    }

    const persistencia =
      await this.despachadorEvaluacionesTelemetriaRuntime.procesarPendientes({
        origen,
        numeroTick
      });
    if (persistencia?.preparacion && this.contexto) {
      this.contexto.relojRelativoTelemetria = persistencia.preparacion;
    }
    this.actualizarResumenScheduler({
      ultimaPersistenciaEvaluacionTelemetria: persistencia
    });

    if (persistencia.totalReclamados > 0 || persistencia.error) {
      console.log(
        `[sentinelia-runtime] Telemetría derivada ${origen}. reclamados=${persistencia.totalReclamados} completados=${persistencia.totalCompletados} errores=${persistencia.totalErrores}`
      );
    }
    return persistencia;
  }

  async procesarCausaPolDdns({ origen, numeroTick }) {
    if (!this.procesadorCausasPolDdnsRuntime) return null;
    const resultado = await this.procesadorCausasPolDdnsRuntime.procesarSiguiente();
    if (resultado && (resultado.fallidos > 0 || resultado.total > 0)) {
      console.log(
        `[sentinelia-runtime] DDNS POL ${origen}. causa=${resultado.causaId} ` +
        `estado=${resultado.estado} total=${resultado.total} fallidos=${resultado.fallidos}`
      );
    }
    return resultado
      ? Object.freeze({ ...resultado, origen, numeroTick })
      : null;
  }

  async ejecutarCascadaMonitoresLogicosReactivos({
    persistenciaEstadoActual,
    origen,
    numeroTick,
    fechaReferenciaUtc,
    monitoresYaEjecutados = []
  }) {
    const resumen = {
      activa: false,
      totalOleadas: 0,
      totalCandidatos: 0,
      totalEjecutados: 0,
      totalCambiosEstado: 0,
      totalPersistidosEstado: 0,
      totalPersistidosEventos: 0,
      totalDescartadosEventos: 0,
      totalAperturasAlerta: 0,
      totalConfirmacionesAlerta: 0,
      totalCierresAlerta: 0,
      totalTramosPersistidos: 0,
      totalTramosActualizados: 0,
      totalBloqueadosRedis: 0,
      totalSaltadosRedis: 0,
      persistenciasAlertas: [],
      bloqueosRedis: [],
      oleadas: []
    };

    let monitorIdsOrigen = this.extraerMonitoresConCambioSalidaEstable(
      persistenciaEstadoActual
    );
    const idsEjecutados = new Set(
      monitoresYaEjecutados
        .map((idMonitor) => Number(idMonitor))
        .filter((idMonitor) => Number.isInteger(idMonitor) && idMonitor > 0)
    );
    let profundidad = 1;

    while (monitorIdsOrigen.length > 0) {
      const seleccion =
        this.planificadorMonitoresLogicosReactivos.seleccionarDependientes({
          catalogoOperativo: this.catalogoOperativo,
          monitorIdsOrigen,
          monitoresYaEjecutados: [...idsEjecutados],
          fechaReferenciaUtc,
          profundidad
        });

      if (seleccion.candidatos.length === 0) {
        break;
      }

      let candidatosEjecutables = seleccion.candidatos;
      let bloqueosActivos = [];
      let resumenBloqueo = null;

      if (this.bloqueadorEjecucionMonitorRedis) {
        const bloqueo =
          await this.bloqueadorEjecucionMonitorRedis.bloquearCandidatos({
            candidatos: seleccion.candidatos,
            instanciaId: this.instanciaId,
            origen: `${origen}:reactivo`,
            numeroTick
          });
        candidatosEjecutables = bloqueo.candidatosBloqueados;
        bloqueosActivos = bloqueo.bloqueos;
        resumenBloqueo = bloqueo.resumen;
        resumen.totalBloqueadosRedis += bloqueo.resumen.totalBloqueados;
        resumen.totalSaltadosRedis += bloqueo.resumen.totalSaltados;
        resumen.bloqueosRedis.push(bloqueo.resumen);

        for (const candidatoSaltado of bloqueo.candidatosSaltados) {
          this.estadoVivo.actualizarEstadoMonitor(candidatoSaltado.monitorId, {
            vencidoParaEjecucion: true,
            pendienteScheduler: true,
            motivoProgramacion: 'bloqueado_por_runtime_externo'
          });
        }
      }

      if (candidatosEjecutables.length === 0) {
        break;
      }

      for (const candidato of candidatosEjecutables) {
        idsEjecutados.add(Number(candidato.monitorId));
      }

      let loteEjecucion = null;
      let persistenciaEstadoReactiva = null;
      let persistenciaEventosReactiva = null;
      let persistenciaAlertasReactiva = null;
      let persistenciaHistoricoReactiva = null;

      try {
        loteEjecucion = await this.motorMonitores.ejecutarMonitores({
          catalogoOperativo: this.catalogoOperativo,
          almacenEstadoActual: this.estadoVivo,
          candidatos: candidatosEjecutables
        });
        ({
          persistenciaEstadoActual: persistenciaEstadoReactiva,
          persistenciaEventos: persistenciaEventosReactiva,
          persistenciaAlertas: persistenciaAlertasReactiva,
          persistenciaHistorico: persistenciaHistoricoReactiva
        } = await this.persistirNucleoCicloMonitores({ loteEjecucion }));
        this.actualizarEstadoAlertasActivas(persistenciaAlertasReactiva);
      } finally {
        if (
          this.bloqueadorEjecucionMonitorRedis &&
          bloqueosActivos.length > 0
        ) {
          const liberacion =
            await this.bloqueadorEjecucionMonitorRedis.liberarBloqueos(
              bloqueosActivos
            );

          if (resumenBloqueo) {
            resumenBloqueo.liberacion = liberacion;
          }

          if (liberacion.totalNoLiberados > 0) {
            console.error(
              `[sentinelia-runtime] No se pudieron liberar ${liberacion.totalNoLiberados}/${liberacion.totalBloqueos} bloqueos Redis de ejecución reactiva.`
            );
          }
        }
      }

      resumen.persistenciasAlertas.push(persistenciaAlertasReactiva);

      resumen.activa = true;
      resumen.totalOleadas += 1;
      resumen.totalCandidatos += loteEjecucion.totalCandidatos;
      resumen.totalEjecutados += loteEjecucion.totalEjecutados;
      resumen.totalCambiosEstado +=
        persistenciaEstadoReactiva.totalCambiosEstado;
      resumen.totalPersistidosEstado +=
        persistenciaEstadoReactiva.totalPersistidos;
      resumen.totalPersistidosEventos +=
        persistenciaEventosReactiva.totalPersistidos;
      resumen.totalDescartadosEventos +=
        persistenciaEventosReactiva.totalDescartados;
      resumen.totalAperturasAlerta +=
        persistenciaAlertasReactiva.totalAperturas;
      resumen.totalConfirmacionesAlerta +=
        persistenciaAlertasReactiva.totalConfirmaciones;
      resumen.totalCierresAlerta += persistenciaAlertasReactiva.totalCierres;
      resumen.totalTramosPersistidos +=
        persistenciaHistoricoReactiva.totalPersistidos;
      resumen.totalTramosActualizados +=
        persistenciaHistoricoReactiva.totalActualizados;
      resumen.oleadas.push({
        profundidad,
        monitorIdsOrigen,
        candidatos: candidatosEjecutables.map((candidato) => ({
          monitorId: candidato.monitorId,
          nombre: candidato.nombre
        })),
        totalBloqueadosRedis: resumenBloqueo?.totalBloqueados || 0,
        totalSaltadosRedis: resumenBloqueo?.totalSaltados || 0,
        totalCambiosEstado: persistenciaEstadoReactiva.totalCambiosEstado
      });

      monitorIdsOrigen = this.extraerMonitoresConCambioSalidaEstable(
        persistenciaEstadoReactiva
      );
      fechaReferenciaUtc = loteEjecucion.finalizadoEnUtc;
      profundidad += 1;
    }

    return resumen.activa ? resumen : null;
  }

  extraerMonitoresConCambioSalidaEstable(persistenciaEstadoActual = null) {
    return (persistenciaEstadoActual?.monitoresActualizados || [])
      .filter((monitor) => monitor.cambioSalidaEstable === true)
      .map((monitor) => Number(monitor.monitorId))
      .filter((monitorId) => Number.isInteger(monitorId) && monitorId > 0);
  }

  combinarPersistenciasAlertas(persistencias = []) {
    const resumen = {
      totalResultados: 0,
      totalEvaluados: 0,
      totalAperturas: 0,
      totalConfirmaciones: 0,
      totalCierres: 0,
      totalNoConcluyentes: 0,
      totalPersistidas: 0,
      totalEliminadas: 0,
      totalDescartados: 0,
      monitorIdsActivos: [],
      monitorIdsCerrados: [],
      monitorIdsNoConcluyentes: [],
      resultadosDescartados: [],
      resultadosNoConcluyentes: [],
      alertasPersistidas: [],
      aperturasAlerta: [],
      confirmacionesAlerta: [],
      cierresAlerta: []
    };

    for (const persistencia of persistencias.filter(Boolean)) {
      resumen.totalResultados += Number(persistencia.totalResultados || 0);
      resumen.totalEvaluados += Number(persistencia.totalEvaluados || 0);
      resumen.totalAperturas += Number(persistencia.totalAperturas || 0);
      resumen.totalConfirmaciones += Number(
        persistencia.totalConfirmaciones || 0
      );
      resumen.totalCierres += Number(persistencia.totalCierres || 0);
      resumen.totalNoConcluyentes += Number(
        persistencia.totalNoConcluyentes || 0
      );
      resumen.totalPersistidas += Number(persistencia.totalPersistidas || 0);
      resumen.totalEliminadas += Number(persistencia.totalEliminadas || 0);
      resumen.totalDescartados += Number(persistencia.totalDescartados || 0);
      resumen.monitorIdsActivos.push(...(persistencia.monitorIdsActivos || []));
      resumen.monitorIdsCerrados.push(...(persistencia.monitorIdsCerrados || []));
      resumen.monitorIdsNoConcluyentes.push(
        ...(persistencia.monitorIdsNoConcluyentes || [])
      );
      resumen.resultadosDescartados.push(
        ...(persistencia.resultadosDescartados || [])
      );
      resumen.resultadosNoConcluyentes.push(
        ...(persistencia.resultadosNoConcluyentes || [])
      );
      resumen.alertasPersistidas.push(...(persistencia.alertasPersistidas || []));
      resumen.aperturasAlerta.push(...(persistencia.aperturasAlerta || []));
      resumen.confirmacionesAlerta.push(
        ...(persistencia.confirmacionesAlerta || [])
      );
      resumen.cierresAlerta.push(...(persistencia.cierresAlerta || []));
    }

    return resumen;
  }

  actualizarResumenScheduler(parcial = null) {
    const resumenBase = this.planificadorMonitores?.serializarResumen?.() || null;
    const resumenAnterior = this.contexto?.scheduler || null;

    if (!this.contexto || !resumenBase) {
      return null;
    }

    this.contexto.scheduler = {
      ...(resumenAnterior || {}),
      ...resumenBase,
      ...(parcial || {})
    };

    return this.contexto.scheduler;
  }

  aplicarProgramacionesEnEstado(programaciones = []) {
    for (const programacion of programaciones) {
      this.estadoVivo.actualizarEstadoMonitor(programacion.monitorId, {
        proximoIntentoEn: programacion.proximoIntentoEn,
        vencidoParaEjecucion: programacion.vencido,
        motivoProgramacion: programacion.motivoProgramacion
      });
    }
  }

  async sincronizarRedisOperativo({ motivo }) {
    if (!this.presenciaRedis || !this.catalogoOperativo || !this.estadoVivo) {
      return null;
    }

    this.contexto.snapshotEstadoVivo = this.estadoVivo.crearSnapshot();
    const resumenScheduler = this.contexto?.scheduler || null;

    await this.presenciaRedis.publicarEstadoOperativo({
      catalogoOperativo: this.catalogoOperativo,
      almacenEstadoActual: this.estadoVivo,
      resumenAlertasActivas: this.construirResumenAlertasActivasDashboard(),
      resumenScheduler,
      versionCatalogoMonitores: this.versionCatalogoMonitoresActual,
      versionOperativa: this.contexto?.sincronizacionRedis?.versionOperativa || null,
      motivo
    });

    this.contexto.sincronizacionRedis = {
      ...this.contexto.sincronizacionRedis,
      ...(this.presenciaRedis.serializarResumen?.() || {}),
      versionCatalogoMonitores: this.versionCatalogoMonitoresActual,
      totalRecargasCatalogo: this.totalRecargasCatalogo,
      ultimaRecargaCatalogoEn: this.ultimaRecargaCatalogoEn
    };

    return this.contexto.sincronizacionRedis;
  }

  async sincronizarCatalogoSiHaCambiado({ origen = 'tick', numeroTick = null } = {}) {
    if (!this.versionadorCatalogoMonitoresRedis) {
      return null;
    }

    let versionRedis =
      await this.versionadorCatalogoMonitoresRedis.obtenerVersionActual();

    if (!versionRedis) {
      versionRedis =
        await this.versionadorCatalogoMonitoresRedis.asegurarVersionInicial();
    }

    if (Number(versionRedis) === Number(this.versionCatalogoMonitoresActual)) {
      return null;
    }

    const resumenRehidratacion = await this.recargarCatalogoOperativo({
      versionCatalogoMonitores: versionRedis,
      motivo: 'catalogo_actualizado_redis',
      publicarRedis: false
    });
    const etiquetaTick = numeroTick == null ? '-' : numeroTick;

    console.log(
      `[sentinelia-runtime] Catálogo recargado desde Redis. origen=${origen} tick=${etiquetaTick} version=${versionRedis} total=${this.catalogoOperativo?.total || 0} rehidratados=${resumenRehidratacion.rehidratados} incompatibles=${resumenRehidratacion.versionIncompatible}`
    );

    return resumenRehidratacion;
  }

  async recargarCatalogoOperativo({
    versionCatalogoMonitores = null,
    motivo = 'recarga_catalogo',
    publicarRedis = true
  } = {}) {
    await this.servicioCierreAlertasMonitoresInactivos?.reconciliar();
    const catalogoOperativo = await this.cargadorCatalogoMonitores.cargarInicial();
    const estadoVivo = new AlmacenEstadoActual({
      catalogoOperativo
    });
    const resumenRehidratacion = await this.rehidratadorEstado.rehidratar({
      catalogoOperativo,
      almacenEstadoActual: estadoVivo
    });

    this.catalogoOperativo = catalogoOperativo;
    this.estadoVivo = estadoVivo;
    this.versionCatalogoMonitoresActual =
      Number(versionCatalogoMonitores || 0) || this.versionCatalogoMonitoresActual;
    this.ultimaRecargaCatalogoEn = new Date().toISOString();
    this.totalRecargasCatalogo += 1;
    await this.reconstruirEstadoAlertasActivas();

    if (this.contexto) {
      this.contexto.catalogoOperativo = this.catalogoOperativo;
      this.contexto.estadoVivo = this.estadoVivo;
      this.contexto.snapshotEstadoVivo = this.estadoVivo.crearSnapshot();
      this.contexto.resumenRehidratacion = resumenRehidratacion;
      this.contexto.sincronizacionRedis = {
        ...(this.contexto.sincronizacionRedis || {}),
        versionCatalogoMonitores: this.versionCatalogoMonitoresActual
      };
    }

    if (publicarRedis) {
      this.actualizarResumenScheduler();
      await this.sincronizarRedisOperativo({ motivo });
    }

    return resumenRehidratacion;
  }

  async reconstruirEstadoAlertasActivas() {
    const repositorioAlertas =
      this.contexto?.repositorioAlertasActivasMonitor || null;
    const idsMonitor = Array.isArray(this.catalogoOperativo?.monitores)
      ? this.catalogoOperativo.monitores.map((monitor) => monitor.id)
      : [];

    this.alertasActivasPorMonitorId = new Map();

    if (!repositorioAlertas || idsMonitor.length === 0) {
      return this.alertasActivasPorMonitorId;
    }

    const alertas = await repositorioAlertas.listarPorMonitorIds(idsMonitor);

    for (const alerta of alertas) {
      const serializada =
        typeof alerta?.serializarResumen === 'function'
          ? alerta.serializarResumen()
          : alerta;

      if (serializada?.monitorId != null) {
        this.alertasActivasPorMonitorId.set(Number(serializada.monitorId), serializada);
      }
    }

    return this.alertasActivasPorMonitorId;
  }

  async ejecutarLimpiezaTecnicaAuditoriaDiaria({ fechaReferenciaUtc = new Date().toISOString() } = {}) {
    const claveDiaria = claveDiaUtc(fechaReferenciaUtc);
    if (this.ultimaClaveLimpiezaTecnicaAuditoriaEjecutada === claveDiaria) {
      return Object.freeze({
        activa: true,
        omitida: true,
        bloqueada: false,
        motivo: 'limpieza_tecnica_auditoria_ya_ejecutada_para_dia',
        totalEliminadas: 0,
        backlogPosible: false,
        tablas: Object.freeze({})
      });
    }
    try {
      const resultado = await this.servicioLimpiezaTecnicaAuditoria.ejecutar({
        limitePorTabla: 500,
        timeoutBloqueoSegundos: 0
      });
      if (!resultado.bloqueada) {
        this.ultimaClaveLimpiezaTecnicaAuditoriaEjecutada = claveDiaria;
      }
      return resultado;
    } catch (error) {
      return Object.freeze({
        activa: true,
        omitida: false,
        bloqueada: false,
        motivo: 'limpieza_tecnica_auditoria_error',
        totalEliminadas: 0,
        backlogPosible: false,
        errores: 1,
        error: String(error?.message || error),
        tablas: Object.freeze({})
      });
    }
  }

  async sincronizarDnsSiHaCambiado({ origen = 'tick', numeroTick = null } = {}) {
    if (!this.coordinadorDnsRuntime) {
      return null;
    }

    const resumenDns = await this.coordinadorDnsRuntime.sincronizarSiHaCambiado({
      motivo: `runtime_${origen}`
    });

    if (!resumenDns) {
      return null;
    }

    if (this.contexto) {
      this.contexto.sincronizacionDns = resumenDns;
    }

    const etiquetaTick = numeroTick == null ? '-' : numeroTick;
    const resultado = resumenDns.ultimoResultado || {};

    console.log(
      `[sentinelia-runtime] DNS sincronizado. origen=${origen} tick=${etiquetaTick} ok=${resultado.ok ? 'si' : 'no'} omitido=${resultado.omitido ? 'si' : 'no'} version=${resumenDns.versionCatalogoDnsActual || resultado.versionObservadaRedis || 'n/a'} motivo=${resultado.motivoSincronizacion || 'n/a'}`
    );

    return resumenDns;
  }

  actualizarEstadoAlertasActivas(resumenPersistencia = null) {
    if (!resumenPersistencia || typeof resumenPersistencia !== 'object') {
      return this.alertasActivasPorMonitorId;
    }

    const alertasPersistidas = Array.isArray(resumenPersistencia.alertasPersistidas)
      ? resumenPersistencia.alertasPersistidas
      : [];
    const monitorIdsCerrados = Array.isArray(resumenPersistencia.monitorIdsCerrados)
      ? resumenPersistencia.monitorIdsCerrados
      : [];

    for (const alerta of alertasPersistidas) {
      if (alerta?.monitorId == null) {
        continue;
      }

      this.alertasActivasPorMonitorId.set(Number(alerta.monitorId), alerta);
    }

    for (const monitorId of monitorIdsCerrados) {
      this.alertasActivasPorMonitorId.delete(Number(monitorId));
    }

    return this.alertasActivasPorMonitorId;
  }

  construirResumenAlertasActivasDashboard() {
    const alertas = Array.from(this.alertasActivasPorMonitorId.values())
      .map((alerta) => ({
        monitorId: Number(alerta?.monitorId || 0) || 0,
        tipoMonitor: String(alerta?.tipoMonitor || '').trim().toLowerCase(),
        estadoDetectado: String(alerta?.estadoDetectado || '').trim().toLowerCase(),
        codigoUltimoResultado: String(alerta?.codigoUltimoResultado || '').trim(),
        mensajeUltimoResultado: String(alerta?.mensajeUltimoResultado || '').trim()
      }))
      .filter((alerta) => alerta.monitorId > 0)
      .sort((a, b) => a.monitorId - b.monitorId);

    return {
      totalAlertasActivas: alertas.length,
      alertas
    };
  }
}

function formatearDistribucionTipos(distribucion = {}) {
  const partes = Object.entries(distribucion || {})
    .map(([tipo, total]) => `${tipo}:${Number(total || 0)}`)
    .sort();

  return partes.length > 0 ? partes.join(',') : 'sin_tipos';
}

function claveDiaUtc(fechaReferenciaUtc) {
  const fecha = new Date(fechaReferenciaUtc);
  if (Number.isNaN(fecha.getTime())) return new Date().toISOString().slice(0, 10);
  return fecha.toISOString().slice(0, 10);
}

function resolverOrigenInvalidacionTelemetria(aviso = {}) {
  return aviso?.tipo === 'estados_reglas_telemetria_actualizados' ||
    (Array.isArray(aviso?.reglas) && aviso.reglas.length > 0)
    ? 'invalidacion_telemetria_regla'
    : 'invalidacion_telemetria_directa';
}
