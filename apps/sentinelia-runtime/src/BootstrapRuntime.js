import { ClienteSql } from '../../../paquetes/persistencia-sql/src/ClienteSql.js';
import { RepositorioMigraciones } from '../../../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import { EjecutorMigraciones } from '../../../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { ControladorBootstrapMigraciones } from '../../../paquetes/persistencia-sql/src/ControladorBootstrapMigraciones.js';
import { RepositorioConfiguracion } from '../../../paquetes/configuracion/src/RepositorioConfiguracion.js';
import { VersionadorConfiguracionRedis } from '../../../paquetes/configuracion/src/VersionadorConfiguracionRedis.js';
import { ServicioConfiguracionPortal } from '../../../paquetes/configuracion/src/ServicioConfiguracionPortal.js';
import { obtenerDefinicionesConfiguracionPortal } from '../../../paquetes/configuracion/src/obtenerDefinicionesConfiguracionPortal.js';
import { RepositorioMonitores } from '../../../paquetes/monitores/src/RepositorioMonitores.js';
import { RepositorioEstadoActualMonitores } from '../../../paquetes/monitores/src/RepositorioEstadoActualMonitores.js';
import { RepositorioEventosMonitor } from '../../../paquetes/monitores/src/RepositorioEventosMonitor.js';
import { RepositorioAlertasActivasMonitor } from '../../../paquetes/monitores/src/RepositorioAlertasActivasMonitor.js';
import { RepositorioHistoricoMonitores } from '../../../paquetes/monitores/src/RepositorioHistoricoMonitores.js';
import { RepositorioVinculosMonitoresTelemetria } from '../../../paquetes/monitores/src/RepositorioVinculosMonitoresTelemetria.js';
import { RepositorioEntradasFederadasMonitoresLogicosSql } from '../../../paquetes/monitores/src/RepositorioEntradasFederadasMonitoresLogicosSql.js';
import { ServicioMonitores } from '../../../paquetes/monitores/src/ServicioMonitores.js';
import { ServicioCierreAlertasMonitoresInactivos } from '../../../paquetes/monitores/src/ServicioCierreAlertasMonitoresInactivos.js';
import { ValidadorMonitor } from '../../../paquetes/monitores/src/ValidadorMonitor.js';
import { VersionadorCatalogoMonitoresRedis } from '../../../paquetes/monitores/src/VersionadorCatalogoMonitoresRedis.js';
import { RepositorioTenants } from '../../../paquetes/jerarquia-organizativa/src/RepositorioTenants.js';
import { RepositorioEmpresas } from '../../../paquetes/jerarquia-organizativa/src/RepositorioEmpresas.js';
import { RepositorioSitios } from '../../../paquetes/jerarquia-organizativa/src/RepositorioSitios.js';
import { ResolutorScopeUsuario } from '../../../paquetes/contexto-usuario/src/ResolutorScopeUsuario.js';
import { ServicioConexionRedis } from '../../../paquetes/sesiones/src/ServicioConexionRedis.js';
import { RepositorioSesionesWebAuditoria }
  from '../../../paquetes/sesiones/src/RepositorioSesionesWebAuditoria.js';
import { obtenerRutaMigraciones } from '../../../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';
import { RepositorioColaCorreo } from '../../../paquetes/correo/src/RepositorioColaCorreo.js';
import { RepositorioCoordinacionCorreoRecuperacionPasswordSql }
  from '../../../paquetes/correo/src/RepositorioCoordinacionCorreoRecuperacionPasswordSql.js';
import { RepositorioCoordinacionCorreoReinicioPasswordAdministrativoSql }
  from '../../../paquetes/correo/src/RepositorioCoordinacionCorreoReinicioPasswordAdministrativoSql.js';
import { RepositorioCoordinacionCorreoVerificacionEmailPerfilSql }
  from '../../../paquetes/correo/src/RepositorioCoordinacionCorreoVerificacionEmailPerfilSql.js';
import { RepositorioArbolTriggerCorreoSql }
  from '../../../paquetes/correo/src/RepositorioArbolTriggerCorreoSql.js';
import { RepositorioFotografiaAdmisionTriggerCorreoSql }
  from '../../../paquetes/correo/src/RepositorioFotografiaAdmisionTriggerCorreoSql.js';
import { ServicioFotografiaAdmisionTriggerCorreo }
  from '../../../paquetes/correo/src/ServicioFotografiaAdmisionTriggerCorreo.js';
import { ServicioAceptacionTriggerCorreo }
  from '../../../paquetes/correo/src/ServicioAceptacionTriggerCorreo.js';
import { BloqueadorEnvioCorreoRedis } from '../../../paquetes/correo/src/BloqueadorEnvioCorreoRedis.js';
import { ServicioCorreoPortal } from '../../../paquetes/correo/src/ServicioCorreoPortal.js';
import { ValidadorConfiguracionCorreo } from '../../../paquetes/correo/src/ValidadorConfiguracionCorreo.js';
import { ClienteSmtp } from '../../../paquetes/correo/src/ClienteSmtp.js';
import { crearKeyringTecnicoCorreoDesdeEntorno } from '../../../paquetes/correo/src/KeyringTecnicoCorreo.js';
import { PerfilSmtpCorreo } from '../../../paquetes/correo/src/PerfilSmtpCorreo.js';
import { EvaluadorAutoridadCorreoSql } from '../../../paquetes/correo/src/EvaluadorAutoridadCorreoSql.js';
import { DespachadorCorreoSql } from '../../../paquetes/correo/src/DespachadorCorreoSql.js';
import { RepositorioSolicitudesRecuperacionPasswordRedis }
  from '../../../paquetes/usuarios/src/RepositorioSolicitudesRecuperacionPasswordRedis.js';
import { RepositorioOperacionesEmailPerfilRedis }
  from '../../../paquetes/usuarios/src/RepositorioOperacionesEmailPerfilRedis.js';
import { ServicioInicioDespachoVerificacionEmailPerfil }
  from '../../../paquetes/usuarios/src/ServicioInicioDespachoVerificacionEmailPerfil.js';
import { ServicioActivacionEmisionRecuperacionPasswordEmail }
  from '../../../paquetes/usuarios/src/ServicioActivacionEmisionRecuperacionPasswordEmail.js';
import { RepositorioRetencionTriggerCorreoSql }
  from '../../../paquetes/correo/src/RepositorioRetencionTriggerCorreoSql.js';
import { ServicioRetencionTriggerCorreo }
  from '../../../paquetes/correo/src/ServicioRetencionTriggerCorreo.js';
import { GestorRetencionCorreoRuntime }
  from './correo/GestorRetencionCorreoRuntime.js';
import { ServicioEventosMonitores } from './eventos/ServicioEventosMonitores.js';
import { BloqueadorEjecucionMonitorRedis } from './redis/BloqueadorEjecucionMonitorRedis.js';
import { VersionadorEstadoOperativoRedis } from './redis/VersionadorEstadoOperativoRedis.js';
import { RepositorioTriggers } from '../../../paquetes/triggers/src/RepositorioTriggers.js';
import { RepositorioAsignacionesTriggerMonitor } from '../../../paquetes/triggers/src/RepositorioAsignacionesTriggerMonitor.js';
import { RepositorioEjecucionesTrigger } from '../../../paquetes/triggers/src/RepositorioEjecucionesTrigger.js';
import { ValidadorTrigger } from '../../../paquetes/triggers/src/ValidadorTrigger.js';
import { ResolutorEjecutorTrigger } from '../../../paquetes/triggers/src/ResolutorEjecutorTrigger.js';
import { EjecutorTriggerApi } from '../../../paquetes/triggers/src/EjecutorTriggerApi.js';
import { EjecutorTriggerDns } from '../../../paquetes/triggers/src/EjecutorTriggerDns.js';
import { ServicioTriggers } from '../../../paquetes/triggers/src/ServicioTriggers.js';
import { RepositorioZonasDns } from '../../../paquetes/dns/src/RepositorioZonasDns.js';
import { RepositorioRegistrosDns } from '../../../paquetes/dns/src/RepositorioRegistrosDns.js';
import {
  evaluarPreparacionLocalTriggerCorreo,
  RepositorioPreparacionDespliegueTriggerCorreoSql
} from '../../../paquetes/correo/src/CompatibilidadDespliegueTriggerCorreo.js';
import { VersionadorDnsRedis } from '../../../paquetes/dns/src/VersionadorDnsRedis.js';
import { ServicioDns } from '../../../paquetes/dns/src/ServicioDns.js';
import { RepositorioCausasPolDdns }
  from '../../../paquetes/dns/src/RepositorioCausasPolDdns.js';
import { RepositorioConcesionesDdnsAgentes }
  from '../../../paquetes/dns/src/RepositorioConcesionesDdnsAgentes.js';
import { ServicioAplicacionDdnsAgentes }
  from '../../../paquetes/dns/src/ServicioAplicacionDdnsAgentes.js';
import { CoordinadorOperacionesDurables }
  from '../../../paquetes/coordinacion-durable/src/CoordinadorOperacionesDurables.js';
import {
  RepositorioCoordinacionGeneracionesDns
} from '../../../paquetes/dns/src/RepositorioCoordinacionGeneracionesDns.js';
import { RegistradorOutboxPublicacionDns }
  from '../../../paquetes/dns/src/RegistradorOutboxPublicacionDns.js';
import { crearPublicadorProductivoBindDns }
  from './dns/crearPublicadorProductivoBindDns.js';
import { ProcesadorCausasPolDdnsRuntime }
  from './dns/ProcesadorCausasPolDdnsRuntime.js';
import { RepositorioRetencionDdnsAgentesSql }
  from '../../../paquetes/dns/src/RepositorioRetencionDdnsAgentesSql.js';
import { ServicioRetencionDdnsAgentes }
  from '../../../paquetes/dns/src/ServicioRetencionDdnsAgentes.js';
import {
  CAPACIDADES_WEB_DDNS_AGENTES,
  ErrorCompatibilidadDespliegueDdnsAgentes,
  evaluarPreparacionLocalDdnsAgentes
} from '../../../paquetes/dns/src/CompatibilidadDespliegueDdnsAgentes.js';
import { RepositorioUsuarios } from '../../../paquetes/usuarios/src/RepositorioUsuarios.js';
import { ServicioAutenticacion } from '../../../paquetes/usuarios/src/ServicioAutenticacion.js';
import { ControladorBootstrapUsuarioInicial } from '../../../paquetes/usuarios/src/ControladorBootstrapUsuarioInicial.js';
import { GestorRetencionMonitores } from './retencion/GestorRetencionMonitores.js';
import { RepositorioCatalogoSenalesTelemetriaAgentes } from '../../../paquetes/agentes/src/RepositorioCatalogoSenalesTelemetriaAgentes.js';
import { RepositorioObservacionesTelemetriaAgentes } from '../../../paquetes/agentes/src/RepositorioObservacionesTelemetriaAgentes.js';
import { RepositorioEstadoActualTelemetriaAgentes } from '../../../paquetes/agentes/src/RepositorioEstadoActualTelemetriaAgentes.js';
import { RepositorioReglasDerivacionTelemetria } from '../../../paquetes/agentes/src/RepositorioReglasDerivacionTelemetria.js';
import { RepositorioTrabajosEvaluacionTelemetria } from '../../../paquetes/agentes/src/RepositorioTrabajosEvaluacionTelemetria.js';
import { RepositorioCorreccionesRelojTelemetria } from '../../../paquetes/agentes/src/RepositorioCorreccionesRelojTelemetria.js';
import { evaluarPreparacionLocalMomentoUtcRelativo }
  from '../../../paquetes/agentes/src/CompatibilidadDespliegueMomentoUtcRelativo.js';
import { RepositorioIdempotenciaLotesTelemetriaAgentes } from '../../../paquetes/agentes/src/RepositorioIdempotenciaLotesTelemetriaAgentes.js';
import { ServicioIngestaTelemetriaAgentes } from '../../../paquetes/agentes/src/ServicioIngestaTelemetriaAgentes.js';
import { PublicadorTelemetriaRuntimeEnTransaccion } from '../../../paquetes/agentes/src/PublicadorTelemetriaRuntimeEnTransaccion.js';
import { RepositorioEstadoRuntimeServidorAgentes } from '../../../paquetes/agentes/src/RepositorioEstadoRuntimeServidorAgentes.js';
import { RepositorioPerfilesServidorAgentes } from '../../../paquetes/agentes/src/RepositorioPerfilesServidorAgentes.js';
import { ServicioRetiradaPerfilServidorAgenteEnTransaccion } from '../../../paquetes/agentes/src/ServicioRetiradaPerfilServidorAgenteEnTransaccion.js';
import {
  RepositorioEstadoActualEvaluacionReglasTelemetria,
  RepositorioEvaluacionesReglasTelemetria,
  RepositorioEventosDerivadosTelemetria
} from '../../../paquetes/agentes/src/RepositorioEvaluacionesDerivadasTelemetria.js';
import { EvaluadorCondicionesDerivacionTelemetria } from '../../../paquetes/agentes/src/EvaluadorCondicionesDerivacionTelemetria.js';
import { ProyectorEvaluacionesDerivadasTelemetria } from '../../../paquetes/agentes/src/ProyectorEvaluacionesDerivadasTelemetria.js';
import { ProcesadorTrabajosEvaluacionTelemetria } from '../../../paquetes/agentes/src/ProcesadorTrabajosEvaluacionTelemetria.js';
import { ProcesadorObligacionesRelativasTelemetria } from '../../../paquetes/agentes/src/ProcesadorObligacionesRelativasTelemetria.js';
import { ProcesadorTrabajosEvaluacionTelemetriaEnrutado } from '../../../paquetes/agentes/src/ProcesadorTrabajosEvaluacionTelemetriaEnrutado.js';
import { RepositorioAuditoria } from '../../../paquetes/auditoria/src/RepositorioAuditoria.js';
import { ServicioAuditoriaOperativa } from '../../../paquetes/auditoria/src/ServicioAuditoriaOperativa.js';
import { RepositorioRetencionCadenaAuditoriaSql } from '../../../paquetes/auditoria/src/RepositorioRetencionCadenaAuditoriaSql.js';
import { RepositorioCoordinacionRetencionAuditoriaSql } from '../../../paquetes/auditoria/src/RepositorioCoordinacionRetencionAuditoriaSql.js';
import { ServicioRetencionCadenaAuditoria } from '../../../paquetes/auditoria/src/ServicioRetencionCadenaAuditoria.js';
import { ServicioRetencionAuditoriaGlobal } from '../../../paquetes/auditoria/src/ServicioRetencionAuditoriaGlobal.js';
import { RepositorioLimpiezaTecnicaAuditoriaSql } from '../../../paquetes/auditoria/src/RepositorioLimpiezaTecnicaAuditoriaSql.js';
import { ServicioLimpiezaTecnicaAuditoria } from '../../../paquetes/auditoria/src/ServicioLimpiezaTecnicaAuditoria.js';
import { FronteraTransaccionalLocal } from '../../../paquetes/persistencia-sql/src/FronteraTransaccionalLocal.js';
import { RepositorioOutboxAuditoriaRuntime } from '../../../paquetes/auditoria/src/RepositorioOutboxAuditoriaRuntime.js';
import { ServicioAvisosPlataforma } from '../../../paquetes/avisos-plataforma/src/ServicioAvisosPlataforma.js';
import { RepositorioAvisosPlataformaSql } from '../../../paquetes/avisos-plataforma/src/RepositorioAvisosPlataformaSql.js';
import { AdaptadorAuditoriaAvisosPlataforma } from '../../../paquetes/avisos-plataforma/src/AdaptadorAuditoriaAvisosPlataforma.js';
import { generarIdAvisoPlataforma } from '../../../paquetes/avisos-plataforma/src/IdentidadAvisoPlataforma.js';
import { crearPlanoControlFederacionLocal } from '../../../paquetes/federacion/aplicacion/crearPlanoControlFederacionLocal.js';
import { RepositorioDestinosEmisionFederacionSql } from '../../../paquetes/federacion/adaptadores/RepositorioDestinosEmisionFederacionSql.js';
import { ClienteHttpDatosFederacion } from '../../../paquetes/federacion/adaptadores/ClienteHttpDatosFederacion.js';
import { ServicioClienteEmisionFederacion } from '../../../paquetes/federacion/aplicacion/ServicioClienteEmisionFederacion.js';
import { RepositorioCoordinacionEmisionFederacionSql } from '../../../paquetes/federacion/adaptadores/RepositorioCoordinacionEmisionFederacionSql.js';
import { RepositorioOcurrenciasFederacionSql } from '../../../paquetes/federacion/adaptadores/RepositorioOcurrenciasFederacionSql.js';
import { RepositorioOutboxFederacionSql } from '../../../paquetes/federacion/adaptadores/RepositorioOutboxFederacionSql.js';
import { RepositorioProcedenciaEmisionFederacionSql } from '../../../paquetes/federacion/adaptadores/RepositorioProcedenciaEmisionFederacionSql.js';
import { RepositorioInboxFederacionSql } from '../../../paquetes/federacion/adaptadores/RepositorioInboxFederacionSql.js';
import { RepositorioMaterializacionFederacionSql } from '../../../paquetes/federacion/adaptadores/RepositorioMaterializacionFederacionSql.js';
import { RepositorioSoporteCamposFederacionSql } from '../../../paquetes/federacion/adaptadores/RepositorioSoporteCamposFederacionSql.js';
import { RepositorioEstadoProyeccionesFederacionSql } from '../../../paquetes/federacion/adaptadores/RepositorioEstadoProyeccionesFederacionSql.js';
import { RepositorioDivergenciasFederacionSql } from '../../../paquetes/federacion/adaptadores/RepositorioDivergenciasFederacionSql.js';
import { AdaptadorAuditoriaDivergenciasFederacion } from '../../../paquetes/federacion/adaptadores/AdaptadorAuditoriaDivergenciasFederacion.js';
import { AdaptadorAuditoriaControlFederacion }
  from '../../../paquetes/federacion/adaptadores/AdaptadorAuditoriaControlFederacion.js';
import { RepositorioControlFederacionSql }
  from '../../../paquetes/federacion/adaptadores/RepositorioControlFederacionSql.js';
import { RepositorioConsecuenciasConcesionFederacionSql }
  from '../../../paquetes/federacion/adaptadores/RepositorioConsecuenciasConcesionFederacionSql.js';
import { crearRegistroFamiliasFederacionSql } from '../../../paquetes/federacion/aplicacion/crearRegistroFamiliasFederacionSql.js';
import { ServicioCapturaIncrementalFamiliasFederacion } from '../../../paquetes/federacion/aplicacion/ServicioCapturaIncrementalFamiliasFederacion.js';
import { crearPuertosCapturaTecnicaFederacion } from '../../../paquetes/federacion/aplicacion/crearPuertosCapturaTecnicaFederacion.js';
import { AdaptadorCapturaTransaccionalFederacionSql } from '../../../paquetes/federacion/adaptadores/AdaptadorCapturaTransaccionalFederacionSql.js';
import { ServicioRefederacionFederacion } from '../../../paquetes/federacion/aplicacion/ServicioRefederacionFederacion.js';
import { FuenteEntropiaCriptograficaNode } from '../../../paquetes/federacion/adaptadores/FuenteEntropiaCriptograficaNode.js';
import { GeneradorIdentidadesFederadas } from '../../../paquetes/federacion/src/IdentidadFederada.js';
import {
  calcularVigenciaEstadoOperativoFederado
} from '../../../paquetes/federacion/src/VigenciaEstadoOperativoFederado.js';
import { GestorSesionEmisionFederacionRuntime } from './federacion/GestorSesionEmisionFederacionRuntime.js';
import { ProcesadorFlujoEmisionFederacionRuntime } from './federacion/ProcesadorFlujoEmisionFederacionRuntime.js';
import { RepositorioSaludFederacionSql } from '../../../paquetes/federacion/adaptadores/RepositorioSaludFederacionSql.js';
import { AdaptadorAuditoriaHeartbeatFederacion } from '../../../paquetes/federacion/adaptadores/AdaptadorAuditoriaHeartbeatFederacion.js';
import { RepositorioMonitoresRemotoSql } from '../../../paquetes/federacion/adaptadores/RepositorioMonitoresRemotoSql.js';
import { RepositorioTelemetriaRemotaSql } from '../../../paquetes/federacion/adaptadores/RepositorioTelemetriaRemotaSql.js';
import { RepositorioTiempoEstadosRemotosSql } from '../../../paquetes/federacion/adaptadores/RepositorioTiempoEstadosRemotosSql.js';
import { AdaptadorAuditoriaTiempoEstadosRemotos } from '../../../paquetes/federacion/adaptadores/AdaptadorAuditoriaTiempoEstadosRemotos.js';
import { ProcesadorTiempoEstadosRemotos } from '../../../paquetes/federacion/aplicacion/ProcesadorTiempoEstadosRemotos.js';
import { RepositorioPoliticasRetencionFederacionSql } from '../../../paquetes/federacion/adaptadores/RepositorioPoliticasRetencionFederacionSql.js';
import { ServicioPoliticasRetencionFederacion } from '../../../paquetes/federacion/aplicacion/ServicioPoliticasRetencionFederacion.js';
import { RepositorioPurgaDatosFederadosSql } from '../../../paquetes/federacion/adaptadores/RepositorioPurgaDatosFederadosSql.js';
import { GestorRetencionDatosFederados } from '../../../paquetes/federacion/aplicacion/GestorRetencionDatosFederados.js';
import { EmisorHeartbeatFederacionRuntime } from './federacion/EmisorHeartbeatFederacionRuntime.js';
import { SupervisorSaludFederacionRuntime } from './federacion/SupervisorSaludFederacionRuntime.js';
import { ProcesadorMaterializacionFederacionRuntime } from './federacion/ProcesadorMaterializacionFederacionRuntime.js';
import { crearMotorEliminacionAdministrativaAgentesRuntime }
  from './agentes/crearMotorEliminacionAdministrativaAgentesRuntime.js';

export class BootstrapRuntime {
  constructor({ configuracion }) {
    this.configuracion = configuracion;
    this.clienteSql = null;
    this.servicioConexionRedis = null;
    this.clienteRedis = null;
    this.servicioConfiguracionPortal = null;
    this.servicioMonitores = null;
    this.repositorioEstadoActualMonitores = null;
    this.repositorioAlertasActivasMonitor = null;
    this.repositorioHistoricoMonitores = null;
    this.servicioEventosMonitores = null;
    this.servicioTriggers = null;
    this.servicioDns = null;
    this.publicadorProductivoBindDns = null;
    this.repositorioCoordinacionGeneracionesDns = null;
    this.procesadorCausasPolDdnsRuntime = null;
    this.servicioCorreoPortal = null;
    this.despachadorCorreoSql = null;
    this.gestorRetencionCorreo = null;
    this.gestorRetencionMonitores = null;
    this.bloqueadorEjecucionMonitorRedis = null;
    this.versionadorEstadoOperativoRedis = null;
    this.versionadorCatalogoMonitoresRedis = null;
    this.versionadorDnsRedis = null;
    this.repositorioTrabajosEvaluacionTelemetria = null;
    this.repositorioCorreccionesRelojTelemetria = null;
    this.repositorioIdempotenciaLotesTelemetria = null;
    this.procesadorTrabajosEvaluacionTelemetria = null;
    this.servicioIngestaTelemetriaAgentes = null;
    this.publicadorTelemetriaRuntimeEnTransaccion = null;
    this.repositorioEstadoRuntimeServidor = null;
    this.servicioRetiradaPerfilServidor = null;
    this.repositorioAuditoria = null;
    this.repositorioOutboxAuditoriaRuntime = null;
    this.servicioRetencionAuditoriaGlobal = null;
    this.servicioRetencionDdnsAgentes = null;
    this.servicioLimpiezaTecnicaAuditoria = null;
    this.supervisorArranqueFederacion = null;
    this.servicioClienteEmisionFederacion = null;
    this.repositorioCoordinacionEmisionFederacion = null;
    this.procesadorFlujoEmisionFederacion = null;
    this.emisorHeartbeatFederacionRuntime = null;
    this.supervisorSaludFederacionRuntime = null;
    this.servicioPoliticasRetencionFederacion = null;
    this.gestorRetencionDatosFederados = null;
    this.servicioRefederacionFederacion = null;
    this.procesadorMaterializacionFederacion = null;
    this.despachadorOperacionesAdministrativasRuntime = null;
  }

  async arrancar() {
    if (!this.configuracion.sql.estaCompleta) {
      throw new Error(
        'La fase 5.9.1 requiere SQL configurado. Revisa SQL_HOST, SQL_USUARIO y SQL_BASE_DATOS.'
      );
    }

    const resumenArranque = {
      migraciones: {
        ejecutado: false,
        pendientesAplicadas: 0,
        usoHorarioUtc: null,
        mensaje: 'Bootstrap de migraciones no ejecutado.'
      },
      redis: {
        estado: 'desconocido',
        mensaje: 'Redis no conectado.'
      },
      configuracionPortal: {
        version: null,
        clavesCreadas: [],
        mensaje: 'Configuración de portal no cargada.'
      },
      keyringTecnicoCorreo: {
        keyring: false,
        keyIdActiva: null,
        totalClaves: 0,
        mensaje: 'Keyring técnico de correo no validado.'
      },
      despliegueTriggerCorreo: {
        preparada: false,
        unanimidad: false,
        gateAbierto: false,
        estado: 'no_evaluado'
      },
      usuarioInicial: {
        ejecutado: false,
        creado: false,
        usuario: null,
        mensaje: 'Bootstrap de usuario inicial no ejecutado.'
      },
      retencionAuditoria: {
        activa: false,
        omitida: true,
        motivo: 'retencion_auditoria_no_inicializada',
        mensaje: 'Retención auditable no inicializada.'
      },
      federacion: {
        installationId: null,
        bootId: null,
        activada: false,
        mensaje: 'Plano de control federado no inicializado.'
      },
      retencionFederacion: {
        totalPoliticas: 0,
        totalCambios: 0,
        mensaje: 'Políticas de retención federada no materializadas.'
      }
    };

    this.keyringTecnicoCorreo =
      crearKeyringTecnicoCorreoDesdeEntorno(process.env);
    this.perfilSmtpCorreo = new PerfilSmtpCorreo({
      keyringTecnicoCorreo: this.keyringTecnicoCorreo
    });
    resumenArranque.keyringTecnicoCorreo = {
      keyring: true,
      keyIdActiva: this.keyringTecnicoCorreo.keyIdActiva,
      totalClaves: this.keyringTecnicoCorreo.listarIds().length,
      mensaje:
        `Keyring técnico de correo validado. keyIdActiva=${this.keyringTecnicoCorreo.keyIdActiva} claves=${this.keyringTecnicoCorreo.listarIds().length}`
    };

    this.clienteSql = new ClienteSql(this.configuracion.sql);

    const repositorioMigraciones = new RepositorioMigraciones(this.clienteSql);
    const ejecutorMigraciones = new EjecutorMigraciones({
      clienteSql: this.clienteSql,
      repositorioMigraciones,
      rutaMigraciones: obtenerRutaMigraciones()
    });
    const controladorBootstrapMigraciones = new ControladorBootstrapMigraciones({
      habilitado: this.configuracion.sql.bootstrapMigraciones,
      ejecutorMigraciones,
      clienteSql: this.clienteSql
    });

    resumenArranque.migraciones =
      await controladorBootstrapMigraciones.arrancarSiProcede();

    let preparacionDespliegueDdnsAgentes;
    try {
      preparacionDespliegueDdnsAgentes = evaluarPreparacionLocalDdnsAgentes({
        migracionesAplicadas: await repositorioMigraciones.listarNombresAplicados(),
        postcondicionesMigracionesVerificadas:
          resumenArranque.migraciones.integridad?.ok === true,
        capacidadesWeb: CAPACIDADES_WEB_DDNS_AGENTES
      });
    } catch (error) {
      if (!(error instanceof ErrorCompatibilidadDespliegueDdnsAgentes)) throw error;
      preparacionDespliegueDdnsAgentes = Object.freeze({
        preparada: false,
        perfil: null,
        codigo: error.codigo,
        detalle: error.detalle
      });
    }

    const preparacionDespliegueMomentoUtcRelativo =
      evaluarPreparacionLocalMomentoUtcRelativo({
        migracionesAplicadas: await repositorioMigraciones.listarNombresAplicados(),
        postcondicionesMigracionesVerificadas:
          resumenArranque.migraciones.integridad?.ok === true
      });

    const preparacionDespliegueTriggerCorreo = evaluarPreparacionLocalTriggerCorreo({
      migracionesAplicadas: await repositorioMigraciones.listarNombresAplicados(),
      postcondicionesMigracionesVerificadas:
        resumenArranque.migraciones.integridad?.ok === true,
      fotografia: await new RepositorioPreparacionDespliegueTriggerCorreoSql(
        this.clienteSql
      ).fotografiar()
    });
    resumenArranque.despliegueTriggerCorreo = {
      ...preparacionDespliegueTriggerCorreo,
      unanimidad: false
    };

    const repositorioUsuarios = new RepositorioUsuarios(this.clienteSql);
    this.repositorioAuditoria = new RepositorioAuditoria(this.clienteSql);
    const repositorioAvisosPlataforma = new RepositorioAvisosPlataformaSql(
      this.clienteSql,
      {
        adaptadorAuditoria: new AdaptadorAuditoriaAvisosPlataforma({
          repositorioAuditoria: this.repositorioAuditoria
        })
      }
    );
    const servicioAvisosPlataforma = new ServicioAvisosPlataforma({
      repositorioAvisos: repositorioAvisosPlataforma
    });
    const fronteraTransaccional = new FronteraTransaccionalLocal(this.clienteSql);
    const servicioAuditoria = new ServicioAuditoriaOperativa({
      repositorioAuditoria: this.repositorioAuditoria
    });
    const servicioAutenticacion = new ServicioAutenticacion({
      repositorioUsuarios
    });
    const controladorBootstrapUsuarioInicial =
      new ControladorBootstrapUsuarioInicial({
        repositorioUsuarios,
        servicioAutenticacion,
        configuracionUsuarioInicial: this.configuracion.usuarioInicial,
        fronteraTransaccional,
        servicioAuditoria
      });

    resumenArranque.usuarioInicial =
      await controladorBootstrapUsuarioInicial.arrancarSiProcede();

    this.servicioConexionRedis = new ServicioConexionRedis(this.configuracion.redis);
    this.clienteRedis = await this.servicioConexionRedis.conectar();
    const estadoRedis = await this.servicioConexionRedis.comprobarSalud();
    this.versionadorEstadoOperativoRedis = new VersionadorEstadoOperativoRedis({
      clienteRedis: this.clienteRedis,
      claveVersion: this.configuracion.redis.claveVersionRuntimeMonitores
    });
    this.versionadorCatalogoMonitoresRedis =
      new VersionadorCatalogoMonitoresRedis({
        clienteRedis: this.clienteRedis,
        claveVersion: this.configuracion.redis.claveVersionCatalogoMonitores
      });
    this.versionadorDnsRedis = new VersionadorDnsRedis({
      clienteRedis: this.clienteRedis,
      claveVersion: this.configuracion.redis.claveVersionDns
    });
    const versionOperativaInicial =
      await this.versionadorEstadoOperativoRedis.asegurarVersionInicial();
    const versionCatalogoMonitoresInicial =
      await this.versionadorCatalogoMonitoresRedis.asegurarVersionInicial();
    const versionCatalogoDnsInicial =
      await this.versionadorDnsRedis.asegurarVersionInicial();

    resumenArranque.redis = {
      estado: estadoRedis,
      mensaje: `Redis operativo: ${estadoRedis}`,
      versionOperativaMonitores: versionOperativaInicial,
      versionCatalogoMonitores: versionCatalogoMonitoresInicial,
      versionCatalogoDns: versionCatalogoDnsInicial
    };

    const repositorioConfiguracion = new RepositorioConfiguracion(this.clienteSql);
    this.evaluadorAutoridadCorreoSql = new EvaluadorAutoridadCorreoSql({
      repositorioConfiguracion,
      perfilSmtpCorreo: this.perfilSmtpCorreo,
      validadorConfiguracionCorreo: new ValidadorConfiguracionCorreo()
    });
    const versionadorConfiguracionRedis = new VersionadorConfiguracionRedis({
      clienteRedis: this.clienteRedis,
      claveVersion: this.configuracion.redis.claveVersionConfiguracionPortal
    });
    this.servicioConfiguracionPortal = new ServicioConfiguracionPortal({
      repositorioConfiguracion,
      versionadorConfiguracionRedis,
      definiciones: obtenerDefinicionesConfiguracionPortal(this.configuracion),
      fronteraTransaccional,
      servicioAuditoria,
      perfilSmtpCorreo: this.perfilSmtpCorreo
    });

    const resultadoConfiguracionPortal =
      await this.servicioConfiguracionPortal.bootstrapYcargar();
    this.servicioPoliticasRetencionFederacion =
      new ServicioPoliticasRetencionFederacion({
        repositorioPoliticas: new RepositorioPoliticasRetencionFederacionSql(
          this.clienteSql
        ),
        servicioConfiguracionPortal: this.servicioConfiguracionPortal
      });
    const politicasRetencionFederacion =
      await this.servicioPoliticasRetencionFederacion.reconciliarLimiteGlobal();
    resumenArranque.retencionFederacion = {
      ...politicasRetencionFederacion,
      mensaje: politicasRetencionFederacion.totalPoliticas === 0
        ? 'No existen todavía familias receptoras con política de retención.'
        : `Políticas federadas materializadas: ${politicasRetencionFederacion.totalPoliticas}.`
    };
    this.gestorRetencionDatosFederados = new GestorRetencionDatosFederados({
      servicioPoliticas: this.servicioPoliticasRetencionFederacion,
      repositorioPurga: new RepositorioPurgaDatosFederadosSql(this.clienteSql)
    });
    const planoControlFederacion = await crearPlanoControlFederacionLocal({
      clienteSql: this.clienteSql,
      clienteRedis: this.clienteRedis,
      servicioConfiguracionPortal: this.servicioConfiguracionPortal,
      prefijoRedis: this.configuracion.redis.prefijoFederacion,
      ttlArranqueSegundos:
        this.configuracion.redis.ttlArranqueFederacionSegundos,
      servicioAvisosPlataforma
    });
    this.supervisorArranqueFederacion = planoControlFederacion.supervisor;
    const repositorioDestinosEmisionFederacion =
      new RepositorioDestinosEmisionFederacionSql(this.clienteSql);
    const clienteHttpFederacion = new ClienteHttpDatosFederacion();
    this.servicioClienteEmisionFederacion = new ServicioClienteEmisionFederacion({
      repositorioDestinos: repositorioDestinosEmisionFederacion,
      clienteHttp: clienteHttpFederacion
    });
    this.repositorioCoordinacionEmisionFederacion =
      new RepositorioCoordinacionEmisionFederacionSql(this.clienteSql);
    const repositorioSaludFederacion =
      new RepositorioSaludFederacionSql(this.clienteSql, {
        adaptadorAuditoria: new AdaptadorAuditoriaHeartbeatFederacion({
          repositorioAuditoria: this.repositorioAuditoria
        })
      });
    this.servicioRefederacionFederacion = new ServicioRefederacionFederacion({
      repositorioOcurrencias: new RepositorioOcurrenciasFederacionSql(
        this.clienteSql,
        {
          installationLocalId: String(planoControlFederacion.identidad.installationId),
          protectorContenidoSensible: planoControlFederacion.protectorContenidoSensible
        }
      ),
      repositorioOutbox: new RepositorioOutboxFederacionSql(this.clienteSql),
      guardiaActivacion: planoControlFederacion.guardiaActivacion
    });
    const repositorioSoporteCamposFederacion =
      new RepositorioSoporteCamposFederacionSql(this.clienteSql, {
        protectorContenidoSensible: planoControlFederacion.protectorContenidoSensible
      });
    const repositorioControlFederacion = new RepositorioControlFederacionSql(
      this.clienteSql,
      {
        adaptadorAuditoria: new AdaptadorAuditoriaControlFederacion({
          repositorioAuditoria: this.repositorioAuditoria
        }),
        servicioAvisos: servicioAvisosPlataforma,
        repositorioConsecuenciasDatos:
          new RepositorioConsecuenciasConcesionFederacionSql(this.clienteSql, {
            repositorioSoporteCampos: repositorioSoporteCamposFederacion
          })
      }
    );
    const repositorioDivergenciasFederacion =
      new RepositorioDivergenciasFederacionSql(this.clienteSql, {
        servicioAvisos: servicioAvisosPlataforma,
        adaptadorAuditoria: new AdaptadorAuditoriaDivergenciasFederacion({
          repositorioAuditoria: this.repositorioAuditoria
        }),
        repositorioSoporteCampos: repositorioSoporteCamposFederacion
      });
    const repositorioMaterializacionFederacion =
      new RepositorioMaterializacionFederacionSql(this.clienteSql, {
        repositorioEstadoProyecciones:
          new RepositorioEstadoProyeccionesFederacionSql(this.clienteSql, {
            repositorioDivergencias: repositorioDivergenciasFederacion
          })
      });
    const registroFamiliasMaterializacion = crearRegistroFamiliasFederacionSql({
      clienteSql: this.clienteSql,
      installationLocalId: String(planoControlFederacion.identidad.installationId),
      prepararMomentoUtcRelativoLocal: true,
      permitirMomentoUtcRelativo: true,
      resolverVigenciaEstadoMonitores: async ({ fila } = {}) => {
        await this.servicioConfiguracionPortal.asegurarActualizada();
        const ttl = this.servicioConfiguracionPortal.obtenerConfiguracionActual()
          .obtenerConfiguracionFederacion().ttlEstadoOperativoMs;
        return calcularVigenciaEstadoOperativoFederado({
          fila,
          ttlMaximoMs: ttl
        });
      }
    });
    const capturadorIncrementalFamiliasFederacion =
      new ServicioCapturaIncrementalFamiliasFederacion({
        registroFamilias: registroFamiliasMaterializacion.registro,
        adaptadorCaptura: new AdaptadorCapturaTransaccionalFederacionSql({
          repositorioOcurrencias: new RepositorioOcurrenciasFederacionSql(
            this.clienteSql,
            {
              installationLocalId:
                String(planoControlFederacion.identidad.installationId),
              protectorContenidoSensible:
                planoControlFederacion.protectorContenidoSensible
            }
          ),
          repositorioOutbox: new RepositorioOutboxFederacionSql(this.clienteSql)
        })
      });
    const capturadoresTecnicosFederacion = crearPuertosCapturaTecnicaFederacion({
      capturador: capturadorIncrementalFamiliasFederacion
    });
    servicioAuditoria.capturadorFederacion = capturadorIncrementalFamiliasFederacion;
    repositorioAvisosPlataforma.capturadorFederacion = {
      prepararCapturasMutacionEnTransaccion: (solicitud, { conexion } = {}) =>
        capturadorIncrementalFamiliasFederacion.capturarEnTransaccion({
          familia: 'avisosFederados',
          prepararCapturas: async ({ selector, interfazCaptura }) => {
            const incluirActorVisible = selector.permiteContenidoSensible &&
              selector.campos.includes('actorVisible');
            const opciones = {
              incluirActorVisible,
              puedeVerActor: incluirActorVisible
            };
            return Object.freeze([
              await interfazCaptura.prepararCapturaEnTransaccion({
                ...solicitud,
                ...opciones,
                tipoRegistro: 'estadoActual'
              }, { conexion }),
              await interfazCaptura.prepararCapturaEnTransaccion({
                ...solicitud,
                ...opciones,
                tipoRegistro: 'transicion'
              }, { conexion })
            ]);
          }
        }, { conexion })
    };
    this.procesadorMaterializacionFederacion =
      new ProcesadorMaterializacionFederacionRuntime({
        clienteSql: this.clienteSql,
        repositorioTrabajos: repositorioMaterializacionFederacion,
        repositorioInbox: new RepositorioInboxFederacionSql(this.clienteSql, {
          protectorContenidoSensible:
            planoControlFederacion.protectorContenidoSensible
        }),
        registroFamilias: registroFamiliasMaterializacion.registro,
        notificarBloqueo: ({ trabajo, errorCodigo }) =>
          notificarBloqueoMaterializacionFederacion({
            clienteSql: this.clienteSql,
            servicioAvisosPlataforma,
            actorRuntimeId: this.configuracion.runtime.instanciaId,
            trabajo,
            errorCodigo
          }),
        propietario: `runtime-materializacion:${this.configuracion.runtime.instanciaId}`
      });
    if (planoControlFederacion.custodiaSecretoEmision) {
      const gestorSesiones = new GestorSesionEmisionFederacionRuntime({
        repositorioDestinos: repositorioDestinosEmisionFederacion,
        clienteHttp: clienteHttpFederacion,
        custodiaSecretoEmision: planoControlFederacion.custodiaSecretoEmision,
        installationLocalId: String(planoControlFederacion.identidad.installationId),
        bootLocalId: String(planoControlFederacion.identidad.bootId),
        resolverNombreLocal: async () => {
          await this.servicioConfiguracionPortal.asegurarActualizada();
          return this.servicioConfiguracionPortal.obtenerConfiguracionActual()
            .obtenerNombreVisiblePortal();
        }
      });
      this.procesadorFlujoEmisionFederacion =
        new ProcesadorFlujoEmisionFederacionRuntime({
          repositorioCoordinacion: this.repositorioCoordinacionEmisionFederacion,
          repositorioOcurrencias: new RepositorioOcurrenciasFederacionSql(
            this.clienteSql,
            {
              installationLocalId: String(planoControlFederacion.identidad.installationId),
              protectorContenidoSensible:
                planoControlFederacion.protectorContenidoSensible
            }
          ),
          servicioCliente: this.servicioClienteEmisionFederacion,
          gestorSesiones,
          generadorIdentidades: new GeneradorIdentidadesFederadas({
            fuenteEntropia: new FuenteEntropiaCriptograficaNode()
          }),
          repositorioProcedencia: new RepositorioProcedenciaEmisionFederacionSql(
            this.clienteSql,
            {
              installationLocalId: String(planoControlFederacion.identidad.installationId),
              bootLocalId: String(planoControlFederacion.identidad.bootId)
            }
          ),
          resolverActivacion: async () => {
            return planoControlFederacion.guardiaEmision.estaDisponible();
          }
        });
      this.emisorHeartbeatFederacionRuntime = new EmisorHeartbeatFederacionRuntime({
        repositorioDestinos: repositorioDestinosEmisionFederacion,
        gestorSesiones,
        servicioCliente: this.servicioClienteEmisionFederacion,
        repositorioSalud: repositorioSaludFederacion,
        bootLocalId: String(planoControlFederacion.identidad.bootId),
        productoVersion: '0.1.0'
      });
    }
    this.supervisorSaludFederacionRuntime = new SupervisorSaludFederacionRuntime({
      repositorioSalud: repositorioSaludFederacion,
      servicioAvisos: servicioAvisosPlataforma,
      procesadorTiempoEstadosRemotos: new ProcesadorTiempoEstadosRemotos({
        repositorioTiempo: new RepositorioTiempoEstadosRemotosSql(this.clienteSql, {
          adaptadorAuditoria: new AdaptadorAuditoriaTiempoEstadosRemotos({
            repositorioAuditoria: this.repositorioAuditoria,
            installationLocalId: String(
              planoControlFederacion.identidad.installationId
            )
          })
        }),
        repositorioMonitoresRemotos: new RepositorioMonitoresRemotoSql(this.clienteSql)
      }),
      resolverConfiguracion: async () => {
        await this.servicioConfiguracionPortal.asegurarActualizada();
        return this.servicioConfiguracionPortal.obtenerConfiguracionActual()
          .obtenerConfiguracionFederacion();
      }
    });
    resumenArranque.federacion = {
      ...this.supervisorArranqueFederacion.construirResumen(),
      activada: planoControlFederacion.fotografia.configuracion.activacionFederacion,
      keyringDisponible: planoControlFederacion.fotografia.keyring.disponible,
      mensaje: 'Identidad y arranque lógico federados consolidados.'
    };
    this.servicioRetencionAuditoriaGlobal = new ServicioRetencionAuditoriaGlobal({
      servicioConfiguracionPortal: this.servicioConfiguracionPortal,
      repositorioCoordinacion: new RepositorioCoordinacionRetencionAuditoriaSql({
        clienteSql: this.clienteSql
      }),
      servicioRetencionCadena: new ServicioRetencionCadenaAuditoria({
        repositorioRetencion: new RepositorioRetencionCadenaAuditoriaSql({
          clienteSql: this.clienteSql
        }),
        servicioAuditoria
      })
    });
    resumenArranque.retencionAuditoria =
      await this.servicioRetencionAuditoriaGlobal.ejecutarBootstrap({
        presupuestoCadenas: 10,
        limiteEventosPorCadena: 500
      });
    this.servicioRetencionDdnsAgentes = new ServicioRetencionDdnsAgentes({
      servicioConfiguracionPortal: this.servicioConfiguracionPortal,
      repositorio: new RepositorioRetencionDdnsAgentesSql({
        clienteSql: this.clienteSql
      }),
      fronteraTransaccional
    });
    resumenArranque.retencionDdns =
      await this.servicioRetencionDdnsAgentes.ejecutarBootstrap({ limite: 100 });

    const resolutorScopeUsuario = new ResolutorScopeUsuario();
    const repositorioMonitores = new RepositorioMonitores(this.clienteSql);
    const repositorioEntradasFederadasMonitoresLogicos =
      new RepositorioEntradasFederadasMonitoresLogicosSql(this.clienteSql, {
        epocaObservacion: String(planoControlFederacion.identidad.bootId)
      });
    this.repositorioEstadoActualMonitores =
      new RepositorioEstadoActualMonitores(this.clienteSql);
    this.repositorioAlertasActivasMonitor =
      new RepositorioAlertasActivasMonitor(this.clienteSql);
    this.repositorioHistoricoMonitores =
      new RepositorioHistoricoMonitores(this.clienteSql);
    const repositorioEventosMonitor = new RepositorioEventosMonitor(this.clienteSql);
    const repositorioTriggers = new RepositorioTriggers(this.clienteSql);
    const repositorioZonasDns = new RepositorioZonasDns(this.clienteSql);
    const repositorioRegistrosDns = new RepositorioRegistrosDns(this.clienteSql);
    this.repositorioOutboxAuditoriaRuntime =
      new RepositorioOutboxAuditoriaRuntime(this.clienteSql);
    const servicioCierreAlertasMonitoresInactivos = new ServicioCierreAlertasMonitoresInactivos({
      repositorioMonitores,
      repositorioAlertasActivasMonitor: this.repositorioAlertasActivasMonitor,
      fronteraTransaccional,
      capturadorFederacionMonitores: capturadoresTecnicosFederacion.monitores,
      runtimeActorId: this.configuracion.runtime.instanciaId,
      registrarAuditoriaEnTransaccion: (intencion, { conexion }) =>
        this.repositorioOutboxAuditoriaRuntime.encolarEnTransaccion([intencion], { conexion })
    });
    const repositorioCoordinacionGeneracionesDns =
      new RepositorioCoordinacionGeneracionesDns({
        clienteSql: this.clienteSql,
        registradorObligaciones: new RegistradorOutboxPublicacionDns({
          repositorioOutbox: this.repositorioOutboxAuditoriaRuntime
        }),
        bloquearCatalogoEnTransaccion: bloquearCatalogoDnsEnTransaccion
      });
    this.repositorioCoordinacionGeneracionesDns =
      repositorioCoordinacionGeneracionesDns;
    this.servicioLimpiezaTecnicaAuditoria =
      new ServicioLimpiezaTecnicaAuditoria({
        repositorioLimpieza: new RepositorioLimpiezaTecnicaAuditoriaSql({
          clienteSql: this.clienteSql
        }),
        repositorioOperacionesDns: repositorioCoordinacionGeneracionesDns
      });
    const repositorioAsignacionesTriggerMonitor =
      new RepositorioAsignacionesTriggerMonitor(this.clienteSql);
    const repositorioEjecucionesTrigger =
      new RepositorioEjecucionesTrigger(this.clienteSql);
    const repositorioColaCorreo = new RepositorioColaCorreo(this.clienteSql);
    const repositorioCorreoRecuperacionPassword =
      new RepositorioCoordinacionCorreoRecuperacionPasswordSql(this.clienteSql, {
        repositorioAuditoria: this.repositorioAuditoria
      });
    const repositorioCorreoReinicioPasswordAdministrativo =
      new RepositorioCoordinacionCorreoReinicioPasswordAdministrativoSql(
        this.clienteSql
      );
    const repositorioArbolTriggerCorreo = new RepositorioArbolTriggerCorreoSql(
      this.clienteSql
    );
    const repositorioTenants = new RepositorioTenants(this.clienteSql);
    const repositorioEmpresas = new RepositorioEmpresas(this.clienteSql);
    const repositorioSitios = new RepositorioSitios(this.clienteSql);
    const repositorioCatalogoSenalesTelemetria =
      new RepositorioCatalogoSenalesTelemetriaAgentes(this.clienteSql);
    const repositorioEstadoActualTelemetria =
      new RepositorioEstadoActualTelemetriaAgentes(this.clienteSql);
    const repositorioVinculosMonitoresTelemetria =
      new RepositorioVinculosMonitoresTelemetria(this.clienteSql);
    const repositorioTelemetriaRemota =
      new RepositorioTelemetriaRemotaSql(this.clienteSql);
    const repositorioObservacionesTelemetria =
      new RepositorioObservacionesTelemetriaAgentes(this.clienteSql);
    const repositorioReglasDerivacionTelemetria =
      new RepositorioReglasDerivacionTelemetria(this.clienteSql);
    this.repositorioTrabajosEvaluacionTelemetria =
      new RepositorioTrabajosEvaluacionTelemetria(this.clienteSql);
    this.repositorioCorreccionesRelojTelemetria =
      new RepositorioCorreccionesRelojTelemetria(this.clienteSql);
    this.repositorioIdempotenciaLotesTelemetria =
      new RepositorioIdempotenciaLotesTelemetriaAgentes(this.clienteSql);
    this.servicioIngestaTelemetriaAgentes =
      new ServicioIngestaTelemetriaAgentes({
        repositorioCatalogoSenales: repositorioCatalogoSenalesTelemetria,
        repositorioObservaciones: repositorioObservacionesTelemetria,
        repositorioEstadoActual: repositorioEstadoActualTelemetria,
        repositorioReglasDerivacion: repositorioReglasDerivacionTelemetria,
        repositorioTrabajosEvaluacion:
          this.repositorioTrabajosEvaluacionTelemetria,
        capturadorFederacionTelemetria:
          capturadoresTecnicosFederacion.telemetria
      });
    this.publicadorTelemetriaRuntimeEnTransaccion =
      new PublicadorTelemetriaRuntimeEnTransaccion({
        servicioIngestaTelemetriaAgentes:
          this.servicioIngestaTelemetriaAgentes
      });
    this.repositorioEstadoRuntimeServidor =
      new RepositorioEstadoRuntimeServidorAgentes(this.clienteSql);
    const repositorioPerfilesServidor =
      new RepositorioPerfilesServidorAgentes(this.clienteSql);
    const repositorioEstadoActualEvaluacionTelemetria =
      new RepositorioEstadoActualEvaluacionReglasTelemetria(this.clienteSql);
    this.servicioRetiradaPerfilServidor =
      new ServicioRetiradaPerfilServidorAgenteEnTransaccion({
        repositorioPerfilesServidor,
        repositorioEstadoRuntimeServidor:
          this.repositorioEstadoRuntimeServidor,
        repositorioCatalogoSenales: repositorioCatalogoSenalesTelemetria,
        repositorioEstadoActualTelemetria,
        repositorioEstadoActualEvaluacion:
          repositorioEstadoActualEvaluacionTelemetria,
        capturadorFederacionTelemetria:
          capturadoresTecnicosFederacion.telemetria
      });
    const repositorioEventosDerivadosTelemetria =
      new RepositorioEventosDerivadosTelemetria(this.clienteSql);
    const proyectorEvaluacionesDerivadasTelemetria =
      new ProyectorEvaluacionesDerivadasTelemetria({
        repositorioEstadoActual: repositorioEstadoActualEvaluacionTelemetria,
        repositorioEventosDerivados: repositorioEventosDerivadosTelemetria
      });
    const procesadorReactivoTelemetria =
      new ProcesadorTrabajosEvaluacionTelemetria({
        repositorioTrabajos: this.repositorioTrabajosEvaluacionTelemetria,
        repositorioReglas: repositorioReglasDerivacionTelemetria,
        repositorioObservaciones: repositorioObservacionesTelemetria,
        repositorioCatalogoSenales: repositorioCatalogoSenalesTelemetria,
        proyectorEvaluaciones: proyectorEvaluacionesDerivadasTelemetria,
        evaluador: new EvaluadorCondicionesDerivacionTelemetria(),
        capturadorFederacionTelemetria: capturadoresTecnicosFederacion.telemetria,
        reintentoBaseSegundos:
          this.configuracion.runtime.telemetriaEvaluacionReintentoBaseSegundos,
        reintentoMaximoSegundos:
          this.configuracion.runtime.telemetriaEvaluacionReintentoMaximoSegundos
      });
    const procesadorRelativoTelemetria =
      new ProcesadorObligacionesRelativasTelemetria({
        repositorioTrabajos: this.repositorioTrabajosEvaluacionTelemetria,
        repositorioEvaluaciones:
          new RepositorioEvaluacionesReglasTelemetria(this.clienteSql),
        repositorioEstadoActual: repositorioEstadoActualEvaluacionTelemetria,
        repositorioEventosDerivados: repositorioEventosDerivadosTelemetria,
        capturadorFederacionTelemetria: capturadoresTecnicosFederacion.telemetria
      });
    this.procesadorTrabajosEvaluacionTelemetria =
      new ProcesadorTrabajosEvaluacionTelemetriaEnrutado({
        procesadorReactivo: procesadorReactivoTelemetria,
        procesadorRelativo: procesadorRelativoTelemetria,
        repositorioTrabajos: this.repositorioTrabajosEvaluacionTelemetria,
        reintentoBaseSegundos:
          this.configuracion.runtime.telemetriaEvaluacionReintentoBaseSegundos,
        reintentoMaximoSegundos:
          this.configuracion.runtime.telemetriaEvaluacionReintentoMaximoSegundos
      });

    this.despachadorOperacionesAdministrativasRuntime =
      crearMotorEliminacionAdministrativaAgentesRuntime({
        clienteSql: this.clienteSql,
        clienteRedis: this.clienteRedis,
        instanciaId: this.configuracion.runtime.instanciaId,
        servicioAuditoria,
        capturadorFederacion: capturadorIncrementalFamiliasFederacion,
        repositoriosFederacion: registroFamiliasMaterializacion.repositorios,
        repositorioControlFederacion,
        repositorioSesionesWeb: new RepositorioSesionesWebAuditoria(this.clienteSql),
        versionadorCatalogoMonitoresRedis: this.versionadorCatalogoMonitoresRedis,
        prefijoPerfilServidorRedis:
          `${this.configuracion.runtime.redisPrefijo}perfil-servidor:`,
        prefijoSesiones: this.configuracion.redis.prefijoSesiones,
        prefijoSesionesWebDurables:
          this.configuracion.redis.prefijoSesionesWebDurables,
        prefijoVersionUsuario: this.configuracion.redis.prefijoVersionUsuario,
        prefijoEstructuraOrganizacionRedis:
          `${this.configuracion.runtime.redisPrefijo}organizacion:estructura:`
      }).despachador;

    this.servicioMonitores = new ServicioMonitores({
      repositorioMonitores,
      repositorioTenants,
      repositorioEmpresas,
      repositorioSitios,
      versionadorCatalogoMonitoresRedis: this.versionadorCatalogoMonitoresRedis,
      resolutorScopeUsuario,
      validadorMonitor: new ValidadorMonitor(),
      repositorioEntradasFederadasMonitoresLogicos,
      fronteraTransaccional
    });
    this.servicioEventosMonitores = new ServicioEventosMonitores({
      repositorioEventosMonitor,
      servicioConfiguracionPortal: this.servicioConfiguracionPortal
    });
    const composicionBind = crearPublicadorProductivoBindDns({
      clienteSql: this.clienteSql,
      repositorioCoordinacion: repositorioCoordinacionGeneracionesDns,
      instanciaId: this.configuracion.runtime.instanciaId,
      entorno: process.env
    });
    await composicionBind.configuracion.validarSistema();
    this.publicadorProductivoBindDns = composicionBind.publicador;
    this.servicioDns = new ServicioDns({
      repositorioZonasDns,
      repositorioRegistrosDns,
      servicioConfiguracionPortal: this.servicioConfiguracionPortal,
      versionadorDnsRedis: this.versionadorDnsRedis,
      publicacionCoordinadaActiva: composicionBind.activo
    });
    const repositorioConcesionesDdns = new RepositorioConcesionesDdnsAgentes(
      this.clienteSql
    );
    const servicioAplicacionDdns = new ServicioAplicacionDdnsAgentes({
      clienteSql: this.clienteSql,
      repositorioUsuarios,
      repositorioConcesiones: repositorioConcesionesDdns,
      repositorioCoordinacionGeneracionesDns,
      servicioDns: this.servicioDns,
      servicioAuditoria,
      repositorioOutboxAuditoria: this.repositorioOutboxAuditoriaRuntime
    });
    this.procesadorCausasPolDdnsRuntime = this.configuracion.agentes.ddnsHabilitado
      ? new ProcesadorCausasPolDdnsRuntime({
          coordinador: new CoordinadorOperacionesDurables({
            repositorio: new RepositorioCausasPolDdns(this.clienteSql),
            instanciaId: this.configuracion.runtime.instanciaId,
            ttlSegundos: 30
          }),
          repositorioConcesiones: repositorioConcesionesDdns,
          procesarConcesionEnTransaccion: (argumentos) =>
            servicioAplicacionDdns.aplicarObservacionPol(argumentos)
        })
      : null;
    this.servicioTriggers = new ServicioTriggers({
      repositorioTriggers,
      repositorioAsignacionesTriggerMonitor,
      repositorioEjecucionesTrigger,
      repositorioArbolTriggerCorreo,
      repositorioMonitores,
      validadorTrigger: new ValidadorTrigger(),
      resolutorEjecutorTrigger: new ResolutorEjecutorTrigger({
        ejecutores: [
          new EjecutorTriggerApi(),
          new EjecutorTriggerDns({
            repositorioRegistrosDns,
            repositorioZonasDns,
            servicioDns: this.servicioDns,
            servicioAuditoria,
            repositorioCoordinacionGeneracionesDns
          }),
          new ServicioAceptacionTriggerCorreo({
            servicioFotografiaAdmision:
              new ServicioFotografiaAdmisionTriggerCorreo({
                repositorio:
                  new RepositorioFotografiaAdmisionTriggerCorreoSql(),
                evaluadorAutoridadCorreoSql: this.evaluadorAutoridadCorreoSql
              }),
            repositorioEjecucionesTrigger,
            repositorioArbolTriggerCorreo,
            repositorioColaCorreo
          })
        ]
      }),
      fronteraTransaccional,
      servicioConfiguracionPortal: this.servicioConfiguracionPortal,
      capturadorFederacionEjecuciones: capturadoresTecnicosFederacion.triggers
    });
    resumenArranque.integridadEstrategiasTriggers =
      await this.servicioTriggers.exigirIntegridadEstrategiasEjecucion();
    const clienteSmtp = new ClienteSmtp();
    this.servicioCorreoPortal = new ServicioCorreoPortal({
      servicioConfiguracionPortal: this.servicioConfiguracionPortal,
      validadorConfiguracionCorreo: new ValidadorConfiguracionCorreo(),
      repositorioColaCorreo,
      bloqueadorEnvioCorreoRedis: new BloqueadorEnvioCorreoRedis({
        clienteRedis: this.clienteRedis,
        prefijoBloqueoCorreo: this.configuracion.redis.prefijoBloqueoCorreo
      }),
      clienteSmtp,
      evaluadorAutoridadCorreoSql: this.evaluadorAutoridadCorreoSql,
      fronteraTransaccional
    });
    const repositorioOperacionesEmailPerfil =
      new RepositorioOperacionesEmailPerfilRedis({
        clienteRedis: this.clienteRedis,
        prefijoRedis: this.configuracion.redis.prefijoOperacionesEmailPerfil,
        secretoProteccionTokens: this.configuracion.sesion.secreto
      });
    const repositorioCorreoVerificacionEmailPerfil =
      new RepositorioCoordinacionCorreoVerificacionEmailPerfilSql(
        this.clienteSql
      );
    const iniciadorVerificacionEmailPerfil =
      new ServicioInicioDespachoVerificacionEmailPerfil({
        repositorioUsuarios,
        repositorioOperacionesEmail: repositorioOperacionesEmailPerfil,
        repositorioCoordinacionCorreo:
          repositorioCorreoVerificacionEmailPerfil,
        repositorioColaCorreo
      });
    this.despachadorCorreoSql = new DespachadorCorreoSql({
      fronteraTransaccional,
      repositorioColaCorreo,
      repositorioRecuperacionPassword: repositorioCorreoRecuperacionPassword,
      repositorioReinicioPasswordAdministrativo:
        repositorioCorreoReinicioPasswordAdministrativo,
      iniciadorVerificacionEmailPerfil,
      evaluadorAutoridadCorreoSql: this.evaluadorAutoridadCorreoSql,
      clienteSmtp,
      identificadorInstancia: this.configuracion.runtime.instanciaId
    });
    const repositorioSolicitudesRecuperacionPassword =
      new RepositorioSolicitudesRecuperacionPasswordRedis({
        clienteRedis: this.clienteRedis
      });
    const servicioActivacionEmisionRecuperacionPassword =
      new ServicioActivacionEmisionRecuperacionPasswordEmail({
        repositorioSolicitudes: repositorioSolicitudesRecuperacionPassword,
        repositorioCoordinacionCorreo: repositorioCorreoRecuperacionPassword,
        fronteraTransaccional
      });
    this.gestorRetencionMonitores = new GestorRetencionMonitores({
      servicioConfiguracionPortal: this.servicioConfiguracionPortal,
      repositorioEventosMonitor,
      repositorioHistoricoMonitores: this.repositorioHistoricoMonitores
    });
    this.gestorRetencionCorreo = new GestorRetencionCorreoRuntime({
      servicioRetencionCorreo: new ServicioRetencionTriggerCorreo({
        repositorio: new RepositorioRetencionTriggerCorreoSql(this.clienteSql),
        fronteraTransaccional
      }),
      servicioConfiguracionPortal: this.servicioConfiguracionPortal,
      repositorioArbolTriggerCorreo
    });
    this.bloqueadorEjecucionMonitorRedis = new BloqueadorEjecucionMonitorRedis({
      clienteRedis: this.clienteRedis,
      servicioConfiguracionPortal: this.servicioConfiguracionPortal,
      prefijoBloqueoMonitores:
        `${this.configuracion.runtime.redisPrefijo}locks:monitores:`
    });

    resumenArranque.configuracionPortal = {
      version: resultadoConfiguracionPortal.version,
      clavesCreadas: resultadoConfiguracionPortal.clavesCreadas,
      mensaje:
        resultadoConfiguracionPortal.clavesCreadas.length > 0
          ? `Claves creadas automáticamente: ${resultadoConfiguracionPortal.clavesCreadas.join(', ')}`
          : 'Configuración de portal cargada sin crear claves nuevas.'
    };

    return {
      clienteSql: this.clienteSql,
      fronteraTransaccional,
      clienteRedis: this.clienteRedis,
      servicioConfiguracionPortal: this.servicioConfiguracionPortal,
      servicioMonitores: this.servicioMonitores,
      servicioEventosMonitores: this.servicioEventosMonitores,
      servicioTriggers: this.servicioTriggers,
      servicioDns: this.servicioDns,
      publicadorProductivoBindDns: this.publicadorProductivoBindDns,
      repositorioCoordinacionGeneracionesDns:
        this.repositorioCoordinacionGeneracionesDns,
      procesadorCausasPolDdnsRuntime: this.procesadorCausasPolDdnsRuntime,
      servicioCorreoPortal: this.servicioCorreoPortal,
      keyringTecnicoCorreo: this.keyringTecnicoCorreo,
      perfilSmtpCorreo: this.perfilSmtpCorreo,
      preparacionDespliegueMomentoUtcRelativo,
      preparacionDespliegueDdnsAgentes,
      preparacionDespliegueTriggerCorreo,
      evaluadorAutoridadCorreoSql: this.evaluadorAutoridadCorreoSql,
      despachadorCorreoSql: this.despachadorCorreoSql,
      repositorioCorreoRecuperacionPassword,
      servicioActivacionEmisionRecuperacionPassword,
      gestorRetencionMonitores: this.gestorRetencionMonitores,
      gestorRetencionCorreo: this.gestorRetencionCorreo,
      bloqueadorEjecucionMonitorRedis: this.bloqueadorEjecucionMonitorRedis,
      versionadorEstadoOperativoRedis: this.versionadorEstadoOperativoRedis,
      versionadorCatalogoMonitoresRedis: this.versionadorCatalogoMonitoresRedis,
      versionadorDnsRedis: this.versionadorDnsRedis,
      repositorioEstadoActualMonitores: this.repositorioEstadoActualMonitores,
      repositorioMonitores,
      servicioCierreAlertasMonitoresInactivos,
      repositorioAlertasActivasMonitor: this.repositorioAlertasActivasMonitor,
      repositorioHistoricoMonitores: this.repositorioHistoricoMonitores,
      capturadorFederacionMonitores: capturadoresTecnicosFederacion.monitores,
      repositorioEstadoActualTelemetria,
      repositorioEstadoActualEvaluacionTelemetria,
      repositorioVinculosMonitoresTelemetria,
      repositorioTelemetriaRemota,
      repositorioEntradasFederadasMonitoresLogicos,
      repositorioTrabajosEvaluacionTelemetria:
        this.repositorioTrabajosEvaluacionTelemetria,
      repositorioCorreccionesRelojTelemetria:
        this.repositorioCorreccionesRelojTelemetria,
      servicioAvisosPlataforma,
      repositorioIdempotenciaLotesTelemetria:
        this.repositorioIdempotenciaLotesTelemetria,
      procesadorTrabajosEvaluacionTelemetria:
        this.procesadorTrabajosEvaluacionTelemetria,
      publicadorTelemetriaRuntimeEnTransaccion:
        this.publicadorTelemetriaRuntimeEnTransaccion,
      repositorioEstadoRuntimeServidor:
        this.repositorioEstadoRuntimeServidor,
      servicioRetiradaPerfilServidor:
        this.servicioRetiradaPerfilServidor,
      repositorioAuditoria: this.repositorioAuditoria,
      servicioRetencionAuditoriaGlobal: this.servicioRetencionAuditoriaGlobal,
      servicioRetencionDdnsAgentes: this.servicioRetencionDdnsAgentes,
      servicioLimpiezaTecnicaAuditoria: this.servicioLimpiezaTecnicaAuditoria,
      repositorioOutboxAuditoriaRuntime:
        this.repositorioOutboxAuditoriaRuntime,
      capturadorFederacionAuditoria: capturadoresTecnicosFederacion.auditoria,
      servicioPoliticasRetencionFederacion:
        this.servicioPoliticasRetencionFederacion,
      gestorRetencionDatosFederados: this.gestorRetencionDatosFederados,
      servicioRefederacionFederacion: this.servicioRefederacionFederacion,
      procesadorMaterializacionFederacion:
        this.procesadorMaterializacionFederacion,
      despachadorOperacionesAdministrativasRuntime:
        this.despachadorOperacionesAdministrativasRuntime,
      bootFederacionId: String(planoControlFederacion.identidad.bootId),
      servicioClienteEmisionFederacion: this.servicioClienteEmisionFederacion,
      repositorioCoordinacionEmisionFederacion:
        this.repositorioCoordinacionEmisionFederacion,
      procesadorFlujoEmisionFederacion: this.procesadorFlujoEmisionFederacion,
      emisorHeartbeatFederacionRuntime: this.emisorHeartbeatFederacionRuntime,
      supervisorSaludFederacionRuntime: this.supervisorSaludFederacionRuntime,
      resumenArranque
    };
  }

  async detener() {
    const errores = [];

    if (this.supervisorArranqueFederacion) {
      try {
        await this.supervisorArranqueFederacion.detener();
      } catch (error) {
        errores.push(error);
      } finally {
        this.supervisorArranqueFederacion = null;
      }
    }

    if (this.servicioConexionRedis) {
      try {
        await this.servicioConexionRedis.cerrar();
      } catch (error) {
        errores.push(error);
      } finally {
        this.servicioConexionRedis = null;
        this.clienteRedis = null;
      }
    }

    if (this.clienteSql) {
      try {
        await this.clienteSql.cerrar();
      } catch (error) {
        errores.push(error);
      } finally {
        this.clienteSql = null;
      }
    }

    this.servicioConfiguracionPortal = null;
    this.servicioMonitores = null;
    this.repositorioEstadoActualMonitores = null;
    this.repositorioAlertasActivasMonitor = null;
    this.repositorioHistoricoMonitores = null;
    this.servicioEventosMonitores = null;
    this.servicioTriggers = null;
    this.servicioDns = null;
    this.publicadorProductivoBindDns = null;
    this.repositorioCoordinacionGeneracionesDns = null;
    this.procesadorCausasPolDdnsRuntime = null;
    this.servicioCorreoPortal = null;
    this.despachadorCorreoSql = null;
    this.gestorRetencionCorreo = null;
    this.gestorRetencionMonitores = null;
    this.bloqueadorEjecucionMonitorRedis = null;
    this.versionadorEstadoOperativoRedis = null;
    this.versionadorCatalogoMonitoresRedis = null;
    this.versionadorDnsRedis = null;
    this.repositorioTrabajosEvaluacionTelemetria = null;
    this.repositorioCorreccionesRelojTelemetria = null;
    this.repositorioIdempotenciaLotesTelemetria = null;
    this.procesadorTrabajosEvaluacionTelemetria = null;
    this.servicioIngestaTelemetriaAgentes = null;
    this.publicadorTelemetriaRuntimeEnTransaccion = null;
    this.repositorioEstadoRuntimeServidor = null;
    this.servicioRetiradaPerfilServidor = null;
    this.repositorioAuditoria = null;
    this.repositorioOutboxAuditoriaRuntime = null;
    this.servicioRetencionAuditoriaGlobal = null;
    this.servicioRetencionDdnsAgentes = null;
    this.servicioLimpiezaTecnicaAuditoria = null;
    this.servicioClienteEmisionFederacion = null;
    this.repositorioCoordinacionEmisionFederacion = null;
    this.procesadorFlujoEmisionFederacion = null;
    this.emisorHeartbeatFederacionRuntime = null;
    this.supervisorSaludFederacionRuntime = null;
    this.servicioPoliticasRetencionFederacion = null;
    this.gestorRetencionDatosFederados = null;
    this.servicioRefederacionFederacion = null;
    this.procesadorMaterializacionFederacion = null;
    this.despachadorOperacionesAdministrativasRuntime = null;

    if (errores.length > 0) {
      throw errores[0];
    }
  }
}

async function notificarBloqueoMaterializacionFederacion({
  clienteSql,
  servicioAvisosPlataforma,
  actorRuntimeId,
  trabajo,
  errorCodigo
}) {
  const [relacion] = await clienteSql.consultar(
    `SELECT scope_tenant_id,scope_empresa_id,scope_sitio_id
       FROM relaciones_federacion WHERE relacion_id=? LIMIT 1`,
    [trabajo.relacionId]
  );
  const ahora = new Date().toISOString();
  return servicioAvisosPlataforma.detectar({
    eventoId: generarIdAvisoPlataforma(),
    correlacionId: generarIdAvisoPlataforma(),
    efectivoEnUtc: ahora,
    actor: { tipo: 'runtime', id: String(actorRuntimeId) },
    causalidad: { tipo: 'trabajoMaterializacionFederada', id: trabajo.entregaId },
    claveCausal: {
      versionCatalogo: 1,
      tipoCodigo: 'generacion',
      causaCodigo: 'generacion_degradada',
      objetoTipo: 'generacion_federada',
      objetoId: trabajo.generacionId,
      relacionId: trabajo.relacionId,
      flujoId: trabajo.flujoId,
      scope: {
        tenantId: relacion?.scope_tenant_id === null ||
          relacion?.scope_tenant_id === undefined
          ? null : String(relacion.scope_tenant_id),
        empresaId: relacion?.scope_empresa_id === null ||
          relacion?.scope_empresa_id === undefined
          ? null : String(relacion.scope_empresa_id),
        sitioId: relacion?.scope_sitio_id === null ||
          relacion?.scope_sitio_id === undefined
          ? null : String(relacion.scope_sitio_id)
      }
    },
    contextoHumano: {
      entregaId: trabajo.entregaId,
      familia: trabajo.familia,
      errorCodigo
    },
    resumen: {
      mensaje: 'La materialización federada quedó bloqueada por un error terminal.',
      errorCodigo
    }
  });
}

async function bloquearCatalogoDnsEnTransaccion({ conexion }) {
  await conexion.execute('SELECT id FROM zonas_dns ORDER BY id FOR UPDATE');
  await conexion.execute(
    'SELECT id FROM registros_dns ORDER BY zona_id, id FOR UPDATE'
  );
}
