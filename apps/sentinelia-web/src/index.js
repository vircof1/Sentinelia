import http from 'node:http';
import { crearAplicacion } from './crearAplicacion.js';
import { ClienteSql } from '../../../paquetes/persistencia-sql/src/ClienteSql.js';
import { RepositorioMigraciones } from '../../../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import { EjecutorMigraciones } from '../../../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { ControladorBootstrapMigraciones } from '../../../paquetes/persistencia-sql/src/ControladorBootstrapMigraciones.js';
import { RepositorioUsuarios } from '../../../paquetes/usuarios/src/RepositorioUsuarios.js';
import { ServicioAutenticacion } from '../../../paquetes/usuarios/src/ServicioAutenticacion.js';
import { RepositorioAutorizacionPerfilRedis } from '../../../paquetes/usuarios/src/RepositorioAutorizacionPerfilRedis.js';
import { ServicioAutorizacionPerfil } from '../../../paquetes/usuarios/src/ServicioAutorizacionPerfil.js';
import { ServicioAutogestionPerfil } from '../../../paquetes/usuarios/src/ServicioAutogestionPerfil.js';
import { ServicioEmailPerfil } from '../../../paquetes/usuarios/src/ServicioEmailPerfil.js';
import { RepositorioOperacionesEmailPerfilRedis } from '../../../paquetes/usuarios/src/RepositorioOperacionesEmailPerfilRedis.js';
import { ServicioCambioEmailPerfil } from '../../../paquetes/usuarios/src/ServicioCambioEmailPerfil.js';
import { ServicioEmisionInicialEmailPerfilCoordinada } from '../../../paquetes/usuarios/src/ServicioEmisionInicialEmailPerfilCoordinada.js';
import { ServicioReenvioEmailPerfilCoordinado } from '../../../paquetes/usuarios/src/ServicioReenvioEmailPerfilCoordinado.js';
import { ServicioEstadoSensibleUsuario } from '../../../paquetes/usuarios/src/ServicioEstadoSensibleUsuario.js';
import { RepositorioAdmisionRecuperacionPasswordRedis } from '../../../paquetes/usuarios/src/RepositorioAdmisionRecuperacionPasswordRedis.js';
import { RepositorioSolicitudesRecuperacionPasswordRedis } from '../../../paquetes/usuarios/src/RepositorioSolicitudesRecuperacionPasswordRedis.js';
import { ServicioAdmisionRecuperacionPasswordEmail } from '../../../paquetes/usuarios/src/ServicioAdmisionRecuperacionPasswordEmail.js';
import { ServicioPreparacionEmisionRecuperacionPasswordEmail } from '../../../paquetes/usuarios/src/ServicioPreparacionEmisionRecuperacionPasswordEmail.js';
import { ServicioActivacionEmisionRecuperacionPasswordEmail } from '../../../paquetes/usuarios/src/ServicioActivacionEmisionRecuperacionPasswordEmail.js';
import { ServicioInicioPublicoRecuperacionPasswordEmail } from '../../../paquetes/usuarios/src/ServicioInicioPublicoRecuperacionPasswordEmail.js';
import { ServicioResolucionAgnosticaRecuperacionPasswordEmail } from '../../../paquetes/usuarios/src/ServicioResolucionAgnosticaRecuperacionPasswordEmail.js';
import { ServicioContinuacionWebRecuperacionPasswordEmail } from '../../../paquetes/usuarios/src/ServicioContinuacionWebRecuperacionPasswordEmail.js';
import { ServicioSustitucionPasswordRecuperacionEmail } from '../../../paquetes/usuarios/src/ServicioSustitucionPasswordRecuperacionEmail.js';
import { ServicioConvergenciaConsumoRecuperacionPasswordEmail } from '../../../paquetes/usuarios/src/ServicioConvergenciaConsumoRecuperacionPasswordEmail.js';
import { ServicioDisponibilidadRecuperacionPasswordEmail } from '../../../paquetes/usuarios/src/ServicioDisponibilidadRecuperacionPasswordEmail.js';
import { RepositorioReiniciosPasswordAdministrativosSql } from '../../../paquetes/usuarios/src/RepositorioReiniciosPasswordAdministrativosSql.js';
import { ServicioReinicioPasswordAdministrativo } from '../../../paquetes/usuarios/src/ServicioReinicioPasswordAdministrativo.js';
import {
  CAPACIDADES_WEB_RECUPERACION_PASSWORD_EMAIL,
  ErrorCompatibilidadDespliegueRecuperacionPasswordEmail,
  evaluarPreparacionLocalRecuperacionPasswordEmail,
  resolverUnanimidadRecuperacionPasswordEmail
} from '../../../paquetes/usuarios/src/CapacidadesDespliegueRecuperacionPasswordEmail.js';
import { crearProveedorCompatibilidadRecuperacionPasswordEmail }
  from '../../../paquetes/usuarios/src/ProveedorCompatibilidadRecuperacionPasswordEmail.js';
import { ServicioReconciliacionBajaUsuarioTriggerCorreo } from '../../../paquetes/correo/src/ServicioReconciliacionBajaUsuarioTriggerCorreo.js';
import { RepositorioPreparacionBajaEjecucionesTriggerCorreoSql } from '../../../paquetes/correo/src/RepositorioPreparacionBajaEjecucionesTriggerCorreoSql.js';
import { ControladorBootstrapUsuarioInicial } from '../../../paquetes/usuarios/src/ControladorBootstrapUsuarioInicial.js';
import { ServicioUsuarios } from '../../../paquetes/usuarios/src/ServicioUsuarios.js';
import { ValidadorJerarquiaUsuario } from '../../../paquetes/usuarios/src/ValidadorJerarquiaUsuario.js';
import { AsignadorPermisosUsuario } from '../../../paquetes/usuarios/src/AsignadorPermisosUsuario.js';
import { RepositorioMonitores } from '../../../paquetes/monitores/src/RepositorioMonitores.js';
import { RepositorioEventosMonitor } from '../../../paquetes/monitores/src/RepositorioEventosMonitor.js';
import { RepositorioAlertasActivasMonitor } from '../../../paquetes/monitores/src/RepositorioAlertasActivasMonitor.js';
import { RepositorioHistoricoMonitores } from '../../../paquetes/monitores/src/RepositorioHistoricoMonitores.js';
import { ServicioMonitores } from '../../../paquetes/monitores/src/ServicioMonitores.js';
import { ServicioCierreAlertasMonitoresInactivos } from '../../../paquetes/monitores/src/ServicioCierreAlertasMonitoresInactivos.js';
import { RepositorioVinculosMonitoresTelemetria } from '../../../paquetes/monitores/src/RepositorioVinculosMonitoresTelemetria.js';
import { RepositorioEntradasFederadasMonitoresLogicosSql } from '../../../paquetes/monitores/src/RepositorioEntradasFederadasMonitoresLogicosSql.js';
import { ValidadorMonitor } from '../../../paquetes/monitores/src/ValidadorMonitor.js';
import { VersionadorCatalogoMonitoresRedis } from '../../../paquetes/monitores/src/VersionadorCatalogoMonitoresRedis.js';
import {
  CAPACIDADES_WEB_DDNS_AGENTES,
  ErrorCompatibilidadDespliegueDdnsAgentes,
  evaluarPreparacionLocalDdnsAgentes,
  resolverActivacionDdnsAgentes
} from '../../../paquetes/dns/src/CompatibilidadDespliegueDdnsAgentes.js';
import { ResolutorScopeUsuario } from '../../../paquetes/contexto-usuario/src/ResolutorScopeUsuario.js';
import { ServicioContextoUsuario } from '../../../paquetes/contexto-usuario/src/ServicioContextoUsuario.js';
import { RepositorioTenants } from '../../../paquetes/jerarquia-organizativa/src/RepositorioTenants.js';
import { RepositorioEmpresas } from '../../../paquetes/jerarquia-organizativa/src/RepositorioEmpresas.js';
import { RepositorioSitios } from '../../../paquetes/jerarquia-organizativa/src/RepositorioSitios.js';
import { ServicioJerarquiaOrganizativa } from '../../../paquetes/jerarquia-organizativa/src/ServicioJerarquiaOrganizativa.js';
import { AutoridadReservasJerarquicasOperacionesAdministrativasSql } from '../../../paquetes/jerarquia-organizativa/src/AutoridadReservasJerarquicasOperacionesAdministrativasSql.js';
import { ServicioImpactoEliminacion } from '../../../paquetes/jerarquia-organizativa/src/ServicioImpactoEliminacion.js';
import { RepositorioCrudOrganizacionAuditable } from '../../../paquetes/jerarquia-organizativa/src/RepositorioCrudOrganizacionAuditable.js';
import { ServicioCrudOrganizacionAuditable } from '../../../paquetes/jerarquia-organizativa/src/ServicioCrudOrganizacionAuditable.js';
import { RepositorioMovimientosOrganizativos } from '../../../paquetes/jerarquia-organizativa/src/RepositorioMovimientosOrganizativos.js';
import { ServicioMovimientosOrganizativosAuditable } from '../../../paquetes/jerarquia-organizativa/src/ServicioMovimientosOrganizativosAuditable.js';
import { ServicioAutoridadMovimientosOrganizativos } from '../../../paquetes/jerarquia-organizativa/src/ServicioAutoridadMovimientosOrganizativos.js';
import { ServicioAutoridadMutacionesEstructurales } from '../../../paquetes/jerarquia-organizativa/src/ServicioAutoridadMutacionesEstructurales.js';
import { RepositorioEliminacionesOrganizativas } from '../../../paquetes/jerarquia-organizativa/src/RepositorioEliminacionesOrganizativas.js';
import { ServicioEliminacionesOrganizativasAuditable } from '../../../paquetes/jerarquia-organizativa/src/ServicioEliminacionesOrganizativasAuditable.js';
import { LimpiadorSesionesEliminacionOrganizativa } from '../../../paquetes/jerarquia-organizativa/src/LimpiadorSesionesEliminacionOrganizativa.js';
import { RepositorioAuditoria } from '../../../paquetes/auditoria/src/RepositorioAuditoria.js';
import { RepositorioControlFederacionSql } from '../../../paquetes/federacion/adaptadores/RepositorioControlFederacionSql.js';
import { RepositorioConsolidacionConcesionFederacionSql } from '../../../paquetes/federacion/adaptadores/RepositorioConsolidacionConcesionFederacionSql.js';
import { RepositorioConsecuenciasConcesionFederacionSql } from '../../../paquetes/federacion/adaptadores/RepositorioConsecuenciasConcesionFederacionSql.js';
import { RepositorioReconciliacionFlujosFederacionSql } from '../../../paquetes/federacion/adaptadores/RepositorioReconciliacionFlujosFederacionSql.js';
import { RepositorioIntercambioConcesionFederacionSql } from '../../../paquetes/federacion/adaptadores/RepositorioIntercambioConcesionFederacionSql.js';
import { RepositorioDestinosEmisionFederacionSql } from '../../../paquetes/federacion/adaptadores/RepositorioDestinosEmisionFederacionSql.js';
import { AdaptadorAuditoriaControlFederacion } from '../../../paquetes/federacion/adaptadores/AdaptadorAuditoriaControlFederacion.js';
import { AdaptadorAuditoriaCanjeFederacion } from '../../../paquetes/federacion/adaptadores/AdaptadorAuditoriaCanjeFederacion.js';
import { AdaptadorAuditoriaSesionesFederacion } from '../../../paquetes/federacion/adaptadores/AdaptadorAuditoriaSesionesFederacion.js';
import { AdaptadorAuditoriaHeartbeatFederacion } from '../../../paquetes/federacion/adaptadores/AdaptadorAuditoriaHeartbeatFederacion.js';
import { AdaptadorAuditoriaSeguridadFederacion } from '../../../paquetes/federacion/adaptadores/AdaptadorAuditoriaSeguridadFederacion.js';
import { RepositorioInvitacionesFederacionSql } from '../../../paquetes/federacion/adaptadores/RepositorioInvitacionesFederacionSql.js';
import { RepositorioRelacionesFederacionSql } from '../../../paquetes/federacion/adaptadores/RepositorioRelacionesFederacionSql.js';
import { RepositorioImportacionesFederacionSql } from '../../../paquetes/federacion/adaptadores/RepositorioImportacionesFederacionSql.js';
import { RepositorioCredencialesPersistentesFederacionSql } from '../../../paquetes/federacion/adaptadores/RepositorioCredencialesPersistentesFederacionSql.js';
import { ClienteHttpControlFederacion } from '../../../paquetes/federacion/adaptadores/ClienteHttpControlFederacion.js';
import { RepositorioEntregasFederacionSql } from '../../../paquetes/federacion/adaptadores/RepositorioEntregasFederacionSql.js';
import { RepositorioInboxFederacionSql } from '../../../paquetes/federacion/adaptadores/RepositorioInboxFederacionSql.js';
import { RepositorioCursoresRecepcionFederacionSql } from '../../../paquetes/federacion/adaptadores/RepositorioCursoresRecepcionFederacionSql.js';
import { RepositorioDisponibilidadFederacionSql } from '../../../paquetes/federacion/adaptadores/RepositorioDisponibilidadFederacionSql.js';
import { RepositorioMaterializacionFederacionSql } from '../../../paquetes/federacion/adaptadores/RepositorioMaterializacionFederacionSql.js';
import { RepositorioOcurrenciasFederacionSql } from '../../../paquetes/federacion/adaptadores/RepositorioOcurrenciasFederacionSql.js';
import { RepositorioOutboxFederacionSql } from '../../../paquetes/federacion/adaptadores/RepositorioOutboxFederacionSql.js';
import { RepositorioContribucionesFederacionSql } from '../../../paquetes/federacion/adaptadores/RepositorioContribucionesFederacionSql.js';
import { RepositorioSoporteCamposFederacionSql } from '../../../paquetes/federacion/adaptadores/RepositorioSoporteCamposFederacionSql.js';
import { RepositorioEstadoProyeccionesFederacionSql } from '../../../paquetes/federacion/adaptadores/RepositorioEstadoProyeccionesFederacionSql.js';
import { RepositorioDivergenciasFederacionSql } from '../../../paquetes/federacion/adaptadores/RepositorioDivergenciasFederacionSql.js';
import { RepositorioExploradorDatosRemotosFederacionSql } from '../../../paquetes/federacion/adaptadores/RepositorioExploradorDatosRemotosFederacionSql.js';
import { RepositorioOrganizacionRemotaPortalSql } from '../../../paquetes/federacion/adaptadores/RepositorioOrganizacionRemotaPortalSql.js';
import { RepositorioMonitoresRemotosPortalSql } from '../../../paquetes/federacion/adaptadores/RepositorioMonitoresRemotosPortalSql.js';
import { RepositorioTriggersRemotosPortalSql } from '../../../paquetes/federacion/adaptadores/RepositorioTriggersRemotosPortalSql.js';
import { RepositorioTelemetriaRemotaPortalSql } from '../../../paquetes/federacion/adaptadores/RepositorioTelemetriaRemotaPortalSql.js';
import { RepositorioDiagnosticoFederacionPortalSql } from '../../../paquetes/federacion/adaptadores/RepositorioDiagnosticoFederacionPortalSql.js';
import { RepositorioAlertasRemotasPortalSql } from '../../../paquetes/federacion/adaptadores/RepositorioAlertasRemotasPortalSql.js';
import { RepositorioAvisosFederadosRemotoSql } from '../../../paquetes/federacion/adaptadores/RepositorioAvisosFederadosRemotoSql.js';
import { RepositorioAuditoriaRemotaSql } from '../../../paquetes/federacion/adaptadores/RepositorioAuditoriaRemotaSql.js';
import { RepositorioFlujosFederacionSql } from '../../../paquetes/federacion/adaptadores/RepositorioFlujosFederacionSql.js';
import { RepositorioGeneracionesCandidatasFederacionSql } from '../../../paquetes/federacion/adaptadores/RepositorioGeneracionesCandidatasFederacionSql.js';
import { RepositorioMonitoresRemotoSql } from '../../../paquetes/federacion/adaptadores/RepositorioMonitoresRemotoSql.js';
import { RepositorioTriggersInformativosRemotoSql } from '../../../paquetes/federacion/adaptadores/RepositorioTriggersInformativosRemotoSql.js';
import { AdaptadorCapturaTransaccionalFederacionSql } from '../../../paquetes/federacion/adaptadores/AdaptadorCapturaTransaccionalFederacionSql.js';
import { AdaptadorAuditoriaReconstruccionesFederacion } from '../../../paquetes/federacion/adaptadores/AdaptadorAuditoriaReconstruccionesFederacion.js';
import { AdaptadorAuditoriaDivergenciasFederacion } from '../../../paquetes/federacion/adaptadores/AdaptadorAuditoriaDivergenciasFederacion.js';
import { GeneradorCredencialInvitacionFederacion } from '../../../paquetes/federacion/adaptadores/GeneradorCredencialInvitacionFederacion.js';
import { FuenteEntropiaCriptograficaNode } from '../../../paquetes/federacion/adaptadores/FuenteEntropiaCriptograficaNode.js';
import {
  GeneradorSecretoPersistenteFederacion
} from '../../../paquetes/federacion/adaptadores/GeneradorSecretoPersistenteFederacion.js';
import { crearPlanoControlFederacionLocal } from '../../../paquetes/federacion/aplicacion/crearPlanoControlFederacionLocal.js';
import { ResolutorRedPublicaFederacion } from '../../../paquetes/federacion/aplicacion/ResolutorRedPublicaFederacion.js';
import { ServicioCanjeInvitacionFederacion } from '../../../paquetes/federacion/aplicacion/ServicioCanjeInvitacionFederacion.js';
import { ServicioInvitacionesFederacion } from '../../../paquetes/federacion/aplicacion/ServicioInvitacionesFederacion.js';
import { ServicioAdministracionFederacionPortal } from '../../../paquetes/federacion/aplicacion/ServicioAdministracionFederacionPortal.js';
import { ServicioControlFederacion } from '../../../paquetes/federacion/aplicacion/ServicioControlFederacion.js';
import { ServicioIntercambioConcesionFederacion } from '../../../paquetes/federacion/aplicacion/ServicioIntercambioConcesionFederacion.js';
import { ServicioCustodiaSecretoEmisionFederacion } from '../../../paquetes/federacion/aplicacion/ServicioCustodiaSecretoEmisionFederacion.js';
import { ServicioSincronizacionConcesionFederacionPortal } from '../../../paquetes/federacion/aplicacion/ServicioSincronizacionConcesionFederacionPortal.js';
import { ServicioConsolidacionConcesionFederacion } from '../../../paquetes/federacion/aplicacion/ServicioConsolidacionConcesionFederacion.js';
import { ServicioReconciliacionFlujosFederacion } from '../../../paquetes/federacion/aplicacion/ServicioReconciliacionFlujosFederacion.js';
import { ServicioImportacionFederacionPortal } from '../../../paquetes/federacion/aplicacion/ServicioImportacionFederacionPortal.js';
import { ServicioExploradorDatosRemotosFederacion } from '../../../paquetes/federacion/aplicacion/ServicioExploradorDatosRemotosFederacion.js';
import { ServicioOrganizacionRemotaFederacionPortal } from '../../../paquetes/federacion/aplicacion/ServicioOrganizacionRemotaFederacionPortal.js';
import { ServicioMonitoresRemotosFederacionPortal } from '../../../paquetes/federacion/aplicacion/ServicioMonitoresRemotosFederacionPortal.js';
import { ServicioTriggersRemotosFederacionPortal } from '../../../paquetes/federacion/aplicacion/ServicioTriggersRemotosFederacionPortal.js';
import { ServicioTelemetriaRemotaFederacionPortal } from '../../../paquetes/federacion/aplicacion/ServicioTelemetriaRemotaFederacionPortal.js';
import { ServicioAvisosFederadosRemotosPortal } from '../../../paquetes/federacion/aplicacion/ServicioAvisosFederadosRemotosPortal.js';
import { ServicioAuditoriaRemotaFederacionPortal } from '../../../paquetes/federacion/aplicacion/ServicioAuditoriaRemotaFederacionPortal.js';
import { ServicioDiagnosticoFederacionPortal } from '../../../paquetes/federacion/aplicacion/ServicioDiagnosticoFederacionPortal.js';
import { ServicioRecepcionLotesFederacionLocal } from '../../../paquetes/federacion/aplicacion/ServicioRecepcionLotesFederacionLocal.js';
import { ServicioDisponibilidadFederacion } from '../../../paquetes/federacion/aplicacion/ServicioDisponibilidadFederacion.js';
import { ServicioRefederacionFederacion } from '../../../paquetes/federacion/aplicacion/ServicioRefederacionFederacion.js';
import { ServicioBorradoresLocalesFederacion } from '../../../paquetes/federacion/aplicacion/ServicioBorradoresLocalesFederacion.js';
import { ServicioReconstruccionesManualesFederacion } from '../../../paquetes/federacion/aplicacion/ServicioReconstruccionesManualesFederacion.js';
import { ServicioCorteInicialGeneracionFederacion } from '../../../paquetes/federacion/aplicacion/ServicioCorteInicialGeneracionFederacion.js';
import { ServicioCapturaIncrementalFamiliasFederacion } from '../../../paquetes/federacion/aplicacion/ServicioCapturaIncrementalFamiliasFederacion.js';
import { crearPuertosCapturaTecnicaFederacion } from '../../../paquetes/federacion/aplicacion/crearPuertosCapturaTecnicaFederacion.js';
import { FuenteFotografiaRegistroFamiliasFederacion } from '../../../paquetes/federacion/aplicacion/FuenteFotografiaRegistroFamiliasFederacion.js';
import { crearRegistroFamiliasFederacionSql } from '../../../paquetes/federacion/aplicacion/crearRegistroFamiliasFederacionSql.js';
import { AdaptadorAuditoriaTransporteFederacion } from '../../../paquetes/federacion/adaptadores/AdaptadorAuditoriaTransporteFederacion.js';
import { ResolutorCapacidadRecepcionFederacion } from '../../../paquetes/federacion/aplicacion/ResolutorCapacidadRecepcionFederacion.js';
import { GeneradorIdentidadesFederadas } from '../../../paquetes/federacion/src/IdentidadFederada.js';
import {
  calcularVigenciaEstadoOperativoFederado
} from '../../../paquetes/federacion/src/VigenciaEstadoOperativoFederado.js';
import { ServicioAvisosPlataforma } from '../../../paquetes/avisos-plataforma/src/ServicioAvisosPlataforma.js';
import { RepositorioAvisosPlataformaSql } from '../../../paquetes/avisos-plataforma/src/RepositorioAvisosPlataformaSql.js';
import { RepositorioPresentacionAvisosPlataformaSql } from '../../../paquetes/avisos-plataforma/src/RepositorioPresentacionAvisosPlataformaSql.js';
import { AdaptadorAuditoriaAvisosPlataforma } from '../../../paquetes/avisos-plataforma/src/AdaptadorAuditoriaAvisosPlataforma.js';
import { ServicioAuditoriaOperativa } from '../../../paquetes/auditoria/src/ServicioAuditoriaOperativa.js';
import { RepositorioOutboxAuditoriaRuntime } from '../../../paquetes/auditoria/src/RepositorioOutboxAuditoriaRuntime.js';
import { RepositorioLecturaAuditoriaSql } from '../../../paquetes/auditoria/src/RepositorioLecturaAuditoriaSql.js';
import { ServicioLecturaAuditoria } from '../../../paquetes/auditoria/src/ServicioLecturaAuditoria.js';
import { RepositorioResolutoresAuditoriaSql } from '../../../paquetes/auditoria/src/RepositorioResolutoresAuditoriaSql.js';
import { ServicioResolutoresConsultaAuditoria } from '../../../paquetes/auditoria/src/ServicioResolutoresConsultaAuditoria.js';
import { RepositorioDiagnosticosIntegridadAuditoriaSql } from '../../../paquetes/auditoria/src/RepositorioDiagnosticosIntegridadAuditoriaSql.js';
import { ServicioDiagnosticosIntegridadAuditoria } from '../../../paquetes/auditoria/src/ServicioDiagnosticosIntegridadAuditoria.js';
import { FronteraTransaccionalLocal } from '../../../paquetes/persistencia-sql/src/FronteraTransaccionalLocal.js';
import { RepositorioSesionesWebAuditoria } from '../../../paquetes/sesiones/src/RepositorioSesionesWebAuditoria.js';
import { RepositorioProyeccionesSesionesWebRedis } from '../../../paquetes/sesiones/src/RepositorioProyeccionesSesionesWebRedis.js';
import { RepositorioPreautenticacionesWebRedis } from '../../../paquetes/sesiones/src/RepositorioPreautenticacionesWebRedis.js';
import { CanalInvalidacionesSesionesWebRedis } from '../../../paquetes/sesiones/src/CanalInvalidacionesSesionesWebRedis.js';
import { ServicioSesionesWebDurables } from '../../../paquetes/sesiones/src/ServicioSesionesWebDurables.js';
import { RepositorioOperacionesSesionAgentes } from '../../../paquetes/agentes/src/RepositorioOperacionesSesionAgentes.js';
import { RepositorioFronteraRuntimeAgentesSql } from '../../../paquetes/agentes/src/RepositorioFronteraRuntimeAgentesSql.js';
import { ConsolidadorSesionesTecnicasAgentesSql } from '../../../paquetes/agentes/src/ConsolidadorSesionesTecnicasAgentesSql.js';
import { AdaptadorCoordinacionSesionesTecnicasAgentes } from '../../../paquetes/agentes/src/AdaptadorCoordinacionSesionesTecnicasAgentes.js';
import { ProcesadorOperacionesSesionTecnicaAgentes } from '../../../paquetes/agentes/src/ProcesadorOperacionesSesionTecnicaAgentes.js';
import { ReconciliadorOperacionesSesionTecnicaAgentes } from '../../../paquetes/agentes/src/ReconciliadorOperacionesSesionTecnicaAgentes.js';
import { CoordinadorOperacionesDurables } from '../../../paquetes/coordinacion-durable/src/CoordinadorOperacionesDurables.js';
import { CanalInvalidacionesBuzonUsuariosRedis } from '../../../paquetes/agentes/src/CanalInvalidacionesBuzonUsuariosRedis.js';
import { CatalogoEjecutoresOperacionesAdministrativas } from '../../../paquetes/agentes/src/CatalogoEjecutoresOperacionesAdministrativas.js';
import { CONTRATO_OPERACION_ADMINISTRATIVA_ELIMINACION_AGENTE } from '../../../paquetes/agentes/src/ContratoOperacionAdministrativaEliminacionAgente.js';
import { RepositorioOperacionesAdministrativasSql } from '../../../paquetes/agentes/src/RepositorioOperacionesAdministrativasSql.js';
import { RepositorioEliminacionAdministrativaAgentesSql } from '../../../paquetes/agentes/src/RepositorioEliminacionAdministrativaAgentesSql.js';
import { RepositorioNotificacionesUsuarioSql } from '../../../paquetes/agentes/src/RepositorioNotificacionesUsuarioSql.js';
import { RepositorioObligacionesPostcommitEliminacionAgentesSql } from '../../../paquetes/agentes/src/RepositorioObligacionesPostcommitEliminacionAgentesSql.js';
import { ServicioAutorizacionEliminacionAdministrativaAgente } from '../../../paquetes/agentes/src/ServicioAutorizacionEliminacionAdministrativaAgente.js';
import { ServicioImpactoEliminacionAgente } from '../../../paquetes/agentes/src/ServicioImpactoEliminacionAgente.js';
import { CodecConfirmacionEliminacionAgente } from '../../../paquetes/agentes/src/CodecConfirmacionEliminacionAgente.js';
import { ServicioAceptacionEliminacionAdministrativaAgente } from '../../../paquetes/agentes/src/ServicioAceptacionEliminacionAdministrativaAgente.js';
import { ServicioConsultaOperacionesAdministrativas } from '../../../paquetes/coordinacion-durable/src/ServicioConsultaOperacionesAdministrativas.js';
import { ProyectorConsultaOperacionEliminacionAgente } from '../../../paquetes/agentes/src/ProyectorConsultaOperacionEliminacionAgente.js';
import { ServicioBuzonNotificacionesUsuario } from '../../../paquetes/agentes/src/ServicioBuzonNotificacionesUsuario.js';
import { ResolutorSujetosAgenteNotificaciones } from '../../../paquetes/agentes/src/ResolutorSujetosAgenteNotificaciones.js';
import { CONTRATO_PERSISTENCIA_NOTIFICACIONES_ELIMINACION_AGENTE } from '../../../paquetes/agentes/src/ContratoPersistenciaNotificacionesEliminacionAgente.js';
import { CatalogoContratosNotificacionesOperacionesAdministrativas } from '../../../paquetes/coordinacion-durable/src/CatalogoContratosNotificacionesOperacionesAdministrativas.js';
import { CatalogoResolutoresSujetosNotificaciones } from '../../../paquetes/coordinacion-durable/src/CatalogoResolutoresSujetosNotificaciones.js';
import { CatalogoProyectoresConsultaOperacionesAdministrativas } from '../../../paquetes/coordinacion-durable/src/CatalogoProyectoresConsultaOperacionesAdministrativas.js';
import { CONTRATO_PERSISTENCIA_NOTIFICACIONES_ELIMINACION_ORGANIZACION } from '../../../paquetes/jerarquia-organizativa/src/ContratoPersistenciaNotificacionesEliminacionOrganizacion.js';
import { ResolutorSujetosOrganizacionNotificaciones } from '../../../paquetes/jerarquia-organizativa/src/ResolutorSujetosOrganizacionNotificaciones.js';
import { CONTRATO_OPERACION_ADMINISTRATIVA_ELIMINACION_ORGANIZACION } from '../../../paquetes/jerarquia-organizativa/src/ContratoOperacionAdministrativaEliminacionOrganizacion.js';
import { ProyectorConsultaOperacionEliminacionOrganizacion } from '../../../paquetes/jerarquia-organizativa/src/ProyectorConsultaOperacionEliminacionOrganizacion.js';
import { RepositorioImpactoEliminacionOrganizacionSql } from '../../../paquetes/jerarquia-organizativa/src/RepositorioImpactoEliminacionOrganizacionSql.js';
import { ServicioAutorizacionEliminacionAdministrativaOrganizacion } from '../../../paquetes/jerarquia-organizativa/src/ServicioAutorizacionEliminacionAdministrativaOrganizacion.js';
import { CodecConfirmacionEliminacionOrganizacion } from '../../../paquetes/jerarquia-organizativa/src/CodecConfirmacionEliminacionOrganizacion.js';
import { ServicioImpactoEliminacionOrganizacion } from '../../../paquetes/jerarquia-organizativa/src/ServicioImpactoEliminacionOrganizacion.js';
import { ServicioAceptacionEliminacionAdministrativaOrganizacion } from '../../../paquetes/jerarquia-organizativa/src/ServicioAceptacionEliminacionAdministrativaOrganizacion.js';
import { resolverActivacionEliminacionAdministrativaOrganizaciones }
  from '../../../paquetes/jerarquia-organizativa/src/CapacidadesRuntimeEliminacionAdministrativaOrganizaciones.js';
import { resolverActivacionEliminacionAdministrativaAgentes }
  from '../../../paquetes/agentes/src/CompatibilidadEliminacionAdministrativaAgentes.js';
import { RepositorioSesionesTecnicasCoordinadasRedis } from '../../../paquetes/agentes/src/RepositorioSesionesTecnicasCoordinadasRedis.js';
import { crearKeyringSesionesTecnicasAgentesDesdeEntorno } from '../../../paquetes/agentes/src/KeyringSesionesTecnicasAgentes.js';
import { RepositorioConfiguracion } from '../../../paquetes/configuracion/src/RepositorioConfiguracion.js';
import { VersionadorConfiguracionRedis } from '../../../paquetes/configuracion/src/VersionadorConfiguracionRedis.js';
import { ServicioConfiguracionPortal } from '../../../paquetes/configuracion/src/ServicioConfiguracionPortal.js';
import { obtenerDefinicionesConfiguracionPortal } from '../../../paquetes/configuracion/src/obtenerDefinicionesConfiguracionPortal.js';
import { ServicioAutorizacion } from '../../../paquetes/autorizacion/src/ServicioAutorizacion.js';
import { RepositorioColaCorreo } from '../../../paquetes/correo/src/RepositorioColaCorreo.js';
import { RepositorioCoordinacionCorreoRecuperacionPasswordSql } from '../../../paquetes/correo/src/RepositorioCoordinacionCorreoRecuperacionPasswordSql.js';
import { RepositorioCoordinacionCorreoReinicioPasswordAdministrativoSql } from '../../../paquetes/correo/src/RepositorioCoordinacionCorreoReinicioPasswordAdministrativoSql.js';
import { RepositorioCoordinacionCorreoVerificacionEmailPerfilSql } from '../../../paquetes/correo/src/RepositorioCoordinacionCorreoVerificacionEmailPerfilSql.js';
import { BloqueadorEnvioCorreoRedis } from '../../../paquetes/correo/src/BloqueadorEnvioCorreoRedis.js';
import { ServicioCorreoPortal } from '../../../paquetes/correo/src/ServicioCorreoPortal.js';
import { ValidadorConfiguracionCorreo } from '../../../paquetes/correo/src/ValidadorConfiguracionCorreo.js';
import { ClienteSmtp } from '../../../paquetes/correo/src/ClienteSmtp.js';
import { crearKeyringTecnicoCorreoDesdeEntorno } from '../../../paquetes/correo/src/KeyringTecnicoCorreo.js';
import { PerfilSmtpCorreo } from '../../../paquetes/correo/src/PerfilSmtpCorreo.js';
import { EvaluadorAutoridadCorreoSql } from '../../../paquetes/correo/src/EvaluadorAutoridadCorreoSql.js';
import {
  CAPACIDADES_WEB_TRIGGER_CORREO,
  ErrorCompatibilidadDespliegueTriggerCorreo,
  evaluarPreparacionLocalTriggerCorreo,
  RepositorioPreparacionDespliegueTriggerCorreoSql,
  resolverUnanimidadPreparacionTriggerCorreo
} from '../../../paquetes/correo/src/CompatibilidadDespliegueTriggerCorreo.js';
import { ServicioCorteAutoridadOrigenCorreo }
  from '../../../paquetes/correo/src/ServicioCorteAutoridadOrigenCorreo.js';
import { ServicioCorteRevisionTriggersCorreo }
  from '../../../paquetes/correo/src/ServicioCorteRevisionTriggersCorreo.js';
import { ServicioCorteVerificacionSmtpCorreo }
  from '../../../paquetes/correo/src/ServicioCorteVerificacionSmtpCorreo.js';
import { ServicioCorteAutoridadColaCorreo }
  from '../../../paquetes/correo/src/ServicioCorteAutoridadColaCorreo.js';
import { ServicioActivacionTriggerCorreo }
  from '../../../paquetes/correo/src/ServicioActivacionTriggerCorreo.js';
import { RepositorioAudienciaTriggerCorreoSql }
  from '../../../paquetes/correo/src/RepositorioAudienciaTriggerCorreoSql.js';
import { ServicioAudienciaTriggerCorreo }
  from '../../../paquetes/correo/src/ServicioAudienciaTriggerCorreo.js';
import { RepositorioDesuscripcionTriggerCorreoSql }
  from '../../../paquetes/correo/src/RepositorioDesuscripcionTriggerCorreoSql.js';
import { ServicioDesuscripcionTriggerCorreo }
  from '../../../paquetes/correo/src/ServicioDesuscripcionTriggerCorreo.js';
import { ServicioConexionRedis } from '../../../paquetes/sesiones/src/ServicioConexionRedis.js';
import { ServicioSesion } from '../../../paquetes/sesiones/src/ServicioSesion.js';
import { RegistroWebSocketsSesionesWebDurables } from '../../../paquetes/sesiones/src/RegistroWebSocketsSesionesWebDurables.js';
import { RepositorioPowRedis } from '../../../paquetes/pow/src/RepositorioPowRedis.js';
import { ServicioPow } from '../../../paquetes/pow/src/ServicioPow.js';
import { ValidadorPow } from '../../../paquetes/pow/src/ValidadorPow.js';
import { ControladorLogin } from './controladores/ControladorLogin.js';
import { ControladorRecuperacionPassword } from './controladores/ControladorRecuperacionPassword.js';
import { ControladorOrganizacion } from './controladores/ControladorOrganizacion.js';
import { ControladorMonitores } from './controladores/ControladorMonitores.js';
import { ControladorPortal } from './controladores/ControladorPortal.js';
import { ControladorPow } from './controladores/ControladorPow.js';
import { ControladorTriggers } from './controladores/ControladorTriggers.js';
import { ControladorDesuscripcionTriggerCorreo }
  from './controladores/ControladorDesuscripcionTriggerCorreo.js';
import { ControladorUsuarios } from './controladores/ControladorUsuarios.js';
import { ControladorImpersonacion } from './controladores/ControladorImpersonacion.js';
import { ControladorDns } from './controladores/ControladorDns.js';
import { ControladorAuditoria } from './controladores/ControladorAuditoria.js';
import { ControladorApiFederacion } from './controladores/ControladorApiFederacion.js';
import { ControladorDatosFederacion } from './controladores/ControladorDatosFederacion.js';
import { ControladorFederacion } from './controladores/ControladorFederacion.js';
import { crearMiddlewareAutenticarPlanoDatosFederacion } from './middleware/autenticarPlanoDatosFederacion.js';
import { crearMiddlewareInterpretarLoteDatosFederacion } from './middleware/interpretarLoteDatosFederacion.js';
import { atenderUpgradeDatosFederacion } from './rutas/atenderUpgradeDatosFederacion.js';
import { DifusorWebSocketPortal } from './realtime/DifusorWebSocketPortal.js';
import { ObservadorDashboardRedis } from './realtime/ObservadorDashboardRedis.js';
import { ObservadorAvisosPlataformaSql } from './realtime/ObservadorAvisosPlataformaSql.js';
import { ObservadorAlertasRemotasSql } from './realtime/ObservadorAlertasRemotasSql.js';
import { ServicioDashboard } from './servicios/ServicioDashboard.js';
import { ServicioGestionAlertasActivasPortal } from './servicios/ServicioGestionAlertasActivasPortal.js';
import { ServicioPresentacionAvisosPlataforma } from './servicios/ServicioPresentacionAvisosPlataforma.js';
import { ServicioAlertasRemotasPortal } from './servicios/ServicioAlertasRemotasPortal.js';
import { ServicioCausalidadAlertasLocalesFederadas } from './servicios/ServicioCausalidadAlertasLocalesFederadas.js';
import { ServicioBorradoresFederacionPortal } from './servicios/ServicioBorradoresFederacionPortal.js';
import { ServicioReconstruccionesFederacionPortal } from './servicios/ServicioReconstruccionesFederacionPortal.js';
import { ServicioVerificacionCorreoOperativo } from './servicios/ServicioVerificacionCorreoOperativo.js';
import { ServicioAdministracionTriggersPortal } from './servicios/ServicioAdministracionTriggersPortal.js';
import { ServicioAdministracionAudienciaTriggerCorreo }
  from './servicios/ServicioAdministracionAudienciaTriggerCorreo.js';
import { ServicioLecturaTriggerCorreoPortal }
  from './servicios/ServicioLecturaTriggerCorreoPortal.js';
import { RepositorioLecturaTriggerCorreoSql }
  from '../../../paquetes/correo/src/RepositorioLecturaTriggerCorreoSql.js';
import { RepositorioAdministracionTriggerCorreoSql }
  from '../../../paquetes/correo/src/RepositorioAdministracionTriggerCorreoSql.js';
import { ServicioPresentacionRedPublicaFederacion } from './servicios/ServicioPresentacionRedPublicaFederacion.js';
import { ServicioAdministracionDnsPortal } from './servicios/ServicioAdministracionDnsPortal.js';
import { ServicioLecturaDnsPortal } from './servicios/ServicioLecturaDnsPortal.js';
import { RepositorioTriggers } from '../../../paquetes/triggers/src/RepositorioTriggers.js';
import { RepositorioAsignacionesTriggerMonitor } from '../../../paquetes/triggers/src/RepositorioAsignacionesTriggerMonitor.js';
import { RepositorioEjecucionesTrigger } from '../../../paquetes/triggers/src/RepositorioEjecucionesTrigger.js';
import { RepositorioZonasDns } from '../../../paquetes/dns/src/RepositorioZonasDns.js';
import { RepositorioRegistrosDns } from '../../../paquetes/dns/src/RepositorioRegistrosDns.js';
import { VersionadorDnsRedis } from '../../../paquetes/dns/src/VersionadorDnsRedis.js';
import { ServicioDns } from '../../../paquetes/dns/src/ServicioDns.js';
import {
  RepositorioCoordinacionGeneracionesDns
} from '../../../paquetes/dns/src/RepositorioCoordinacionGeneracionesDns.js';
import { ServicioAplicacionDdnsAgentes }
  from '../../../paquetes/dns/src/ServicioAplicacionDdnsAgentes.js';
import { ServicioConsultaDdnsAgentes }
  from '../../../paquetes/dns/src/ServicioConsultaDdnsAgentes.js';
import { ServicioConsultaAdministrativaDdnsAgentes }
  from '../../../paquetes/dns/src/ServicioConsultaAdministrativaDdnsAgentes.js';
import { RepositorioCausasPolDdns }
  from '../../../paquetes/dns/src/RepositorioCausasPolDdns.js';
import { ServicioRegistroCausaPolDdns }
  from '../../../paquetes/dns/src/ServicioRegistroCausaPolDdns.js';
import { ValidadorTrigger } from '../../../paquetes/triggers/src/ValidadorTrigger.js';
import { ResolutorEjecutorTrigger } from '../../../paquetes/triggers/src/ResolutorEjecutorTrigger.js';
import { EjecutorTriggerApi } from '../../../paquetes/triggers/src/EjecutorTriggerApi.js';
import { EjecutorTriggerDns } from '../../../paquetes/triggers/src/EjecutorTriggerDns.js';
import { ServicioTriggers } from '../../../paquetes/triggers/src/ServicioTriggers.js';
import { ServicioLecturaTriggersPortal } from './servicios/ServicioLecturaTriggersPortal.js';
import { RepositorioAgentesSentinelia } from '../../../paquetes/agentes/src/RepositorioAgentesSentinelia.js';
import { RepositorioPerfilesServidorAgentes } from '../../../paquetes/agentes/src/RepositorioPerfilesServidorAgentes.js';
import { RepositorioEstadoRuntimeServidorAgentes } from '../../../paquetes/agentes/src/RepositorioEstadoRuntimeServidorAgentes.js';
import { RepositorioSesionesAgentesRedis } from '../../../paquetes/agentes/src/RepositorioSesionesAgentesRedis.js';
import { ServicioAutenticacionAgentes } from '../../../paquetes/agentes/src/ServicioAutenticacionAgentes.js';
import { ServicioProvisionamientoAgentes } from '../../../paquetes/agentes/src/ServicioProvisionamientoAgentes.js';
import { ServicioAutoridadMovimientoAgente } from '../../../paquetes/agentes/src/ServicioAutoridadMovimientoAgente.js';
import { RepositorioCatalogoSenalesTelemetriaAgentes } from '../../../paquetes/agentes/src/RepositorioCatalogoSenalesTelemetriaAgentes.js';
import { RepositorioObservacionesTelemetriaAgentes } from '../../../paquetes/agentes/src/RepositorioObservacionesTelemetriaAgentes.js';
import { RepositorioEstadoActualTelemetriaAgentes } from '../../../paquetes/agentes/src/RepositorioEstadoActualTelemetriaAgentes.js';
import { RepositorioIdempotenciaLotesTelemetriaAgentes } from '../../../paquetes/agentes/src/RepositorioIdempotenciaLotesTelemetriaAgentes.js';
import { RepositorioReglasDerivacionTelemetria } from '../../../paquetes/agentes/src/RepositorioReglasDerivacionTelemetria.js';
import { RepositorioTrabajosEvaluacionTelemetria } from '../../../paquetes/agentes/src/RepositorioTrabajosEvaluacionTelemetria.js';
import {
  RepositorioEstadoActualEvaluacionReglasTelemetria,
  RepositorioEventosDerivadosTelemetria
} from '../../../paquetes/agentes/src/RepositorioEvaluacionesDerivadasTelemetria.js';
import { PublicadorAvisosEvaluacionTelemetriaRedis } from '../../../paquetes/agentes/src/PublicadorAvisosEvaluacionTelemetriaRedis.js';
import { PublicadorInvalidacionesMonitoresTelemetriaRedis } from '../../../paquetes/agentes/src/PublicadorInvalidacionesMonitoresTelemetriaRedis.js';
import { ServicioIngestaTelemetriaAgentes } from '../../../paquetes/agentes/src/ServicioIngestaTelemetriaAgentes.js';
import { PublicadorTelemetriaRuntimeEnTransaccion } from '../../../paquetes/agentes/src/PublicadorTelemetriaRuntimeEnTransaccion.js';
import { PublicadorAvisosPerfilServidorRedis } from '../../../paquetes/agentes/src/PublicadorAvisosPerfilServidorRedis.js';
import { CoordinadorPerfilServidorRedis } from '../../../paquetes/agentes/src/CoordinadorPerfilServidorRedis.js';
import { ServicioRetiradaPerfilServidorAgenteEnTransaccion } from '../../../paquetes/agentes/src/ServicioRetiradaPerfilServidorAgenteEnTransaccion.js';
import { ServicioLecturaTelemetriaAgentes } from '../../../paquetes/agentes/src/ServicioLecturaTelemetriaAgentes.js';
import { ServicioAdministracionReglasDerivacionTelemetria } from '../../../paquetes/agentes/src/ServicioAdministracionReglasDerivacionTelemetria.js';
import {
  CAPACIDADES_WEB_MOMENTO_UTC_RELATIVO,
  evaluarPreparacionLocalMomentoUtcRelativo,
  resolverUnanimidadMomentoUtcRelativo
} from '../../../paquetes/agentes/src/CompatibilidadDespliegueMomentoUtcRelativo.js';
import { ServicioAdministracionAgentesPortal } from './servicios/ServicioAdministracionAgentesPortal.js';
import { ControladorAgentes } from './controladores/ControladorAgentes.js';
import { ControladorEliminacionAdministrativaAgentes } from './controladores/ControladorEliminacionAdministrativaAgentes.js';
import { ControladorEliminacionAdministrativaOrganizaciones } from './controladores/ControladorEliminacionAdministrativaOrganizaciones.js';
import { ControladorApiAgentes } from './controladores/ControladorApiAgentes.js';
import { ControladorReglasDerivacionTelemetria } from './controladores/ControladorReglasDerivacionTelemetria.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../../../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

async function arrancar() {
  const configuracion = obtenerConfiguracionAplicacion();

  if (!configuracion.sql.estaCompleta) {
    throw new Error(
      'La fase 5.1 requiere SQL configurado. Revisa SQL_HOST, SQL_USUARIO y SQL_BASE_DATOS.'
    );
  }

  const resumenArranque = {
    migraciones: {
      ejecutado: false,
      pendientesAplicadas: 0,
      integridad: null,
      usoHorarioUtc: null,
      mensaje: 'Bootstrap de migraciones no ejecutado.'
    },
    configuracionPortal: {
      version: null,
      clavesCreadas: [],
      mensaje: 'Configuración de portal no cargada.'
    },
    federacion: {
      installationId: null,
      bootId: null,
      activada: false,
      mensaje: 'Plano de control federado no inicializado.'
    },
    sesionesTecnicasAgentes: {
      keyring: false,
      keyIdActiva: null,
      totalClaves: 0,
      mensaje: 'Keyring técnico de agentes no validado.'
    },
    keyringTecnicoCorreo: {
      keyring: false,
      keyIdActiva: null,
      totalClaves: 0,
      mensaje: 'Keyring técnico de correo no validado.'
    },
    eliminacionAdministrativaAgentes: {
      habilitada: false,
      solicitada: false,
      perfil: null,
      codigo: 'no_evaluada',
      instanciasRuntimeCompatibles: 0
    },
    eliminacionAdministrativaOrganizaciones: {
      habilitada: false,
      codigo: 'no_evaluada',
      instanciasRuntimeCompatibles: 0,
      instanciasWebCompatibles: 0
    },
    despliegueTriggerCorreo: {
      preparada: false,
      unanimidad: false,
      gateAbierto: false,
      estado: 'no_evaluado',
      instanciasRuntimeCompatibles: 0,
      instanciasWebCompatibles: 0
    },
    despliegueMomentoUtcRelativo: {
      preparada: false,
      unanimidad: false,
      gateAbierto: false,
      instanciasRuntimeCompatibles: 0,
      instanciasWebCompatibles: 0
    },
    despliegueDdnsAgentes: {
      preparada: false,
      perfil: null,
      codigo: 'no_evaluada'
    },
    usuarioInicial: {
      ejecutado: false,
      creado: false,
      usuario: null,
      mensaje: 'Bootstrap de usuario inicial no ejecutado.'
    }
  };

  const clienteSql = new ClienteSql(configuracion.sql);
  const repositorioMigraciones = new RepositorioMigraciones(clienteSql);
  const ejecutorMigraciones = new EjecutorMigraciones({
    clienteSql,
    repositorioMigraciones,
    rutaMigraciones: obtenerRutaMigraciones()
  });

  const controladorBootstrapMigraciones = new ControladorBootstrapMigraciones({
    habilitado: configuracion.sql.bootstrapMigraciones,
    ejecutorMigraciones,
    clienteSql
  });

  resumenArranque.migraciones =
    await controladorBootstrapMigraciones.arrancarSiProcede();

  const servicioConexionRedis = new ServicioConexionRedis(configuracion.redis);
  const clienteRedis = await servicioConexionRedis.conectar();
  const estadoRedis = await servicioConexionRedis.comprobarSalud();
  let preparacionLocalDdnsAgentes = null;
  try {
    preparacionLocalDdnsAgentes = evaluarPreparacionLocalDdnsAgentes({
      migracionesAplicadas: await repositorioMigraciones.listarNombresAplicados(),
      postcondicionesMigracionesVerificadas:
        resumenArranque.migraciones.integridad?.ok === true,
      capacidadesWeb: CAPACIDADES_WEB_DDNS_AGENTES
    });
    resumenArranque.despliegueDdnsAgentes = {
      ...preparacionLocalDdnsAgentes,
      codigo: 'preparacion_local_verificada'
    };
  } catch (error) {
    if (!(error instanceof ErrorCompatibilidadDespliegueDdnsAgentes)) throw error;
    resumenArranque.despliegueDdnsAgentes = {
      preparada: false,
      perfil: null,
      codigo: error.codigo
    };
  }
  const preparacionLocalMomentoUtcRelativo =
    evaluarPreparacionLocalMomentoUtcRelativo({
      migracionesAplicadas: await repositorioMigraciones.listarNombresAplicados(),
      postcondicionesMigracionesVerificadas:
        resumenArranque.migraciones.integridad?.ok === true
    });
  const activacionMomentoUtcRelativo = await resolverUnanimidadMomentoUtcRelativo({
    preparacionLocal: preparacionLocalMomentoUtcRelativo,
    capacidadesWeb: CAPACIDADES_WEB_MOMENTO_UTC_RELATIVO,
    clienteRedis,
    prefijoRuntime: configuracion.runtime.redisPrefijo,
    entorno: configuracion.entorno,
    esperaMaximaMs:
      configuracion.organizacion.eliminacionAdministrativaEsperaCompatibilidadMs
  });
  resumenArranque.despliegueMomentoUtcRelativo = activacionMomentoUtcRelativo;
  const fronteraTransaccional = new FronteraTransaccionalLocal(clienteSql);
  const repositorioAuditoria = new RepositorioAuditoria(clienteSql);
  const servicioAuditoria = new ServicioAuditoriaOperativa({
    repositorioAuditoria
  });
  const repositorioOutboxAuditoriaDdns =
    new RepositorioOutboxAuditoriaRuntime(clienteSql);
  const adaptadorAuditoriaAvisosPlataforma = new AdaptadorAuditoriaAvisosPlataforma({
    repositorioAuditoria
  });
  const repositorioAvisosPlataforma = new RepositorioAvisosPlataformaSql(
    clienteSql,
    { adaptadorAuditoria: adaptadorAuditoriaAvisosPlataforma }
  );
  const servicioAvisosPlataforma = new ServicioAvisosPlataforma({
    repositorioAvisos: repositorioAvisosPlataforma
  });
  const repositorioPresentacionAvisosPlataforma =
    new RepositorioPresentacionAvisosPlataformaSql(clienteSql, {
      adaptadorAuditoria: adaptadorAuditoriaAvisosPlataforma
    });
  const repositorioAlertasRemotasPortal =
    new RepositorioAlertasRemotasPortalSql(clienteSql);
  const repositorioLecturaAuditoria = new RepositorioLecturaAuditoriaSql({
    clienteSql
  });
  const repositorioDiagnosticosIntegridadAuditoria =
    new RepositorioDiagnosticosIntegridadAuditoriaSql({
      clienteSql
    });
  const servicioDiagnosticosIntegridadAuditoria =
    new ServicioDiagnosticosIntegridadAuditoria({
      repositorioDiagnosticos: repositorioDiagnosticosIntegridadAuditoria,
      servicioAuditoria,
      clienteSql
    });
  const servicioLecturaAuditoria = new ServicioLecturaAuditoria({
    repositorioLectura: repositorioLecturaAuditoria,
    secretoCursores: configuracion.sesion.secreto,
    servicioDiagnosticosIntegridad: servicioDiagnosticosIntegridadAuditoria
  });
  const servicioResolutoresAuditoria = new ServicioResolutoresConsultaAuditoria({
    repositorioResolutores: new RepositorioResolutoresAuditoriaSql({ clienteSql })
  });
  const repositorioConfiguracion = new RepositorioConfiguracion(clienteSql);
  const keyringTecnicoCorreo =
    crearKeyringTecnicoCorreoDesdeEntorno(process.env);
  const perfilSmtpCorreo = new PerfilSmtpCorreo({ keyringTecnicoCorreo });
  const versionadorConfiguracionRedis = new VersionadorConfiguracionRedis({
    clienteRedis,
    claveVersion: configuracion.redis.claveVersionConfiguracionPortal
  });
  let servicioDisponibilidadRecuperacionPassword = null;
  const proveedorCompatibilidadRecuperacionPasswordEmail =
    crearProveedorCompatibilidadRecuperacionPasswordEmail({
      obtenerEstado: async () =>
        servicioDisponibilidadRecuperacionPassword?.evaluar?.() || ({
          puedeHabilitar: false,
          dependencias: [{
            codigo: 'bootstrap_incompleto',
            satisfecha: false
          }]
        })
    });
  const servicioConfiguracionPortal = new ServicioConfiguracionPortal({
    repositorioConfiguracion,
    versionadorConfiguracionRedis,
    definiciones: obtenerDefinicionesConfiguracionPortal(configuracion),
    fronteraTransaccional,
    servicioAuditoria,
    perfilSmtpCorreo,
    proveedorCompatibilidadRecuperacionPasswordEmail
  });
  const versionadorCatalogoMonitoresRedis =
    new VersionadorCatalogoMonitoresRedis({
      clienteRedis,
      claveVersion: configuracion.redis.claveVersionCatalogoMonitores
    });
  const versionadorDnsRedis = new VersionadorDnsRedis({
    clienteRedis,
    claveVersion: configuracion.redis.claveVersionDns
  });
  const resultadoConfiguracionPortal =
    await servicioConfiguracionPortal.bootstrapYcargar();

  resumenArranque.configuracionPortal = {
    version: resultadoConfiguracionPortal.version,
    clavesCreadas: resultadoConfiguracionPortal.clavesCreadas,
    mensaje:
      resultadoConfiguracionPortal.clavesCreadas.length > 0
        ? `Claves creadas automáticamente: ${resultadoConfiguracionPortal.clavesCreadas.join(', ')}`
        : 'Configuración de portal cargada sin crear claves nuevas.'
  };

  const planoControlFederacion = await crearPlanoControlFederacionLocal({
    clienteSql,
    clienteRedis,
    servicioConfiguracionPortal,
    adaptadorAuditoriaControl: new AdaptadorAuditoriaControlFederacion({
      repositorioAuditoria
    }),
    adaptadorAuditoriaSesiones: new AdaptadorAuditoriaSesionesFederacion({
      repositorioAuditoria
    }),
    adaptadorAuditoriaHeartbeat: new AdaptadorAuditoriaHeartbeatFederacion({
      repositorioAuditoria
    }),
    adaptadorAuditoriaSeguridad: new AdaptadorAuditoriaSeguridadFederacion({
      repositorioAuditoria
    }),
    servicioAvisosPlataforma,
    prefijoRedis: configuracion.redis.prefijoFederacion,
    ttlArranqueSegundos: configuracion.redis.ttlArranqueFederacionSegundos
  });
  resumenArranque.federacion = {
    ...planoControlFederacion.supervisor.construirResumen(),
    activada: planoControlFederacion.fotografia.configuracion.activacionFederacion,
    keyringDisponible: planoControlFederacion.fotografia.keyring.disponible,
    mensaje: 'Identidad y arranque lógico federados consolidados.'
  };
  const resolutorRedPublicaFederacion = new ResolutorRedPublicaFederacion({
    servicioConfiguracionPortal
  });
  const resumenRedPublicaFederacion =
    await resolutorRedPublicaFederacion.inicializar();
  resumenArranque.federacion.redPublica = resumenRedPublicaFederacion;
  const repositorioInvitacionesFederacion =
    new RepositorioInvitacionesFederacionSql(clienteSql, {
      adaptadorAuditoria: new AdaptadorAuditoriaControlFederacion({
        repositorioAuditoria
      }),
      adaptadorAuditoriaCanje: new AdaptadorAuditoriaCanjeFederacion({
        repositorioAuditoria
      })
    });
  const servicioInvitacionesFederacion = new ServicioInvitacionesFederacion({
    repositorioInvitaciones: repositorioInvitacionesFederacion,
    generadorCredencial: new GeneradorCredencialInvitacionFederacion(),
    resolverOrigenPublico: () =>
      resolutorRedPublicaFederacion.obtenerOrigenPublico(),
    installationReceptoraId:
      String(planoControlFederacion.identidad.installationId),
    guardiaActivacion: planoControlFederacion.guardiaActivacion,
    guardiaRecepcion: planoControlFederacion.guardiaRecepcion
  });
  const installationLocalId = String(planoControlFederacion.identidad.installationId);
  const repositorioSoporteCamposFederacion =
    new RepositorioSoporteCamposFederacionSql(clienteSql, {
      protectorContenidoSensible: planoControlFederacion.protectorContenidoSensible
    });
  const repositorioConsecuenciasConcesionFederacion =
    new RepositorioConsecuenciasConcesionFederacionSql(clienteSql, {
      repositorioSoporteCampos: repositorioSoporteCamposFederacion
    });
  const repositorioControlFederacion = new RepositorioControlFederacionSql(
    clienteSql,
    {
      adaptadorAuditoria: new AdaptadorAuditoriaControlFederacion({
        repositorioAuditoria
      }),
      servicioAvisos: servicioAvisosPlataforma,
      repositorioConsecuenciasDatos: repositorioConsecuenciasConcesionFederacion
    }
  );
  const repositorioFlujosReconstruccion = new RepositorioFlujosFederacionSql(
    clienteSql, { installationLocalId }
  );
  const repositorioOcurrenciasReconstruccion =
    new RepositorioOcurrenciasFederacionSql(clienteSql, {
      installationLocalId,
      protectorContenidoSensible:
        planoControlFederacion.protectorContenidoSensible
    });
  const registroFamiliasReconstruccion = crearRegistroFamiliasFederacionSql({
    clienteSql,
    installationLocalId,
    permitirMomentoUtcRelativo: activacionMomentoUtcRelativo.gateAbierto,
    resolverVigenciaEstadoMonitores: async ({ fila } = {}) => {
      await servicioConfiguracionPortal.asegurarActualizada();
      const ttl = servicioConfiguracionPortal.obtenerConfiguracionActual()
        .obtenerConfiguracionFederacion().ttlEstadoOperativoMs;
      return calcularVigenciaEstadoOperativoFederado({
        fila,
        ttlMaximoMs: ttl
      });
    }
  });
  const adaptadorCapturaFederacion = new AdaptadorCapturaTransaccionalFederacionSql({
    repositorioOcurrencias: repositorioOcurrenciasReconstruccion,
    repositorioOutbox: new RepositorioOutboxFederacionSql(clienteSql)
  });
  const capturadorIncrementalFamiliasFederacion =
    new ServicioCapturaIncrementalFamiliasFederacion({
      registroFamilias: registroFamiliasReconstruccion.registro,
      adaptadorCaptura: adaptadorCapturaFederacion
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
  const servicioCorteReconstruccion =
    new ServicioCorteInicialGeneracionFederacion({
      clienteSql,
      repositorioFlujos: repositorioFlujosReconstruccion,
      repositorioOcurrencias: repositorioOcurrenciasReconstruccion,
      adaptadorCaptura: adaptadorCapturaFederacion,
      fuenteFotografia: new FuenteFotografiaRegistroFamiliasFederacion({
        registroFamilias: registroFamiliasReconstruccion.registro
      }),
      guardiaActivacion: planoControlFederacion.guardiaActivacion
    });
  const servicioReconciliacionFlujosFederacion =
    new ServicioReconciliacionFlujosFederacion({
      repositorio: new RepositorioReconciliacionFlujosFederacionSql(clienteSql),
      repositorioFlujos: repositorioFlujosReconstruccion,
      servicioCorteInicial: servicioCorteReconstruccion,
      servicioSesiones: planoControlFederacion.servicioSesiones,
      installationLocalId,
      bootLocalId: String(planoControlFederacion.identidad.bootId),
      guardiaActivacion: planoControlFederacion.guardiaActivacion
    });
  const servicioConsolidacionConcesionFederacion =
    new ServicioConsolidacionConcesionFederacion({
      repositorio: new RepositorioConsolidacionConcesionFederacionSql(
        clienteSql,
        {
          adaptadorAuditoria: new AdaptadorAuditoriaControlFederacion({
            repositorioAuditoria
          }),
          repositorioConsecuenciasDatos:
            repositorioConsecuenciasConcesionFederacion
        }
      ),
      servicioReconciliacionFlujos: servicioReconciliacionFlujosFederacion,
      guardiaActivacion: planoControlFederacion.guardiaActivacion
    });
  const repositorioIntercambiosConcesionFederacion =
    new RepositorioIntercambioConcesionFederacionSql(clienteSql);
  const servicioSincronizacionConcesionFederacion =
    planoControlFederacion.protectorSecretoPersistente
      ? new ServicioSincronizacionConcesionFederacionPortal({
          repositorioIntercambios: repositorioIntercambiosConcesionFederacion,
          repositorioDestinos: new RepositorioDestinosEmisionFederacionSql(clienteSql),
          custodiaSecretoEmision: new ServicioCustodiaSecretoEmisionFederacion({
            repositorioCredenciales:
              new RepositorioCredencialesPersistentesFederacionSql(clienteSql),
            protectorSecretoPersistente:
              planoControlFederacion.protectorSecretoPersistente
          }),
          clienteHttp: new ClienteHttpControlFederacion(),
          servicioConsolidacion: servicioConsolidacionConcesionFederacion,
          servicioReconciliacion: servicioReconciliacionFlujosFederacion,
          guardiaEmision: planoControlFederacion.guardiaEmision,
          installationLocalId,
          bootLocalId: String(planoControlFederacion.identidad.bootId),
          resolverNombreLocal: async () => {
            await servicioConfiguracionPortal.asegurarActualizada();
            return servicioConfiguracionPortal.obtenerConfiguracionActual()
              .obtenerNombreVisiblePortal();
          }
        })
      : null;
  const controladorApiFederacion = new ControladorApiFederacion({
    servicioCanjeInvitacion: new ServicioCanjeInvitacionFederacion({
      repositorioInvitaciones: repositorioInvitacionesFederacion,
      provisionadorCanjePendiente:
        planoControlFederacion.provisionadorCanjePendiente,
      generadorSecretoPersistente: new GeneradorSecretoPersistenteFederacion(),
      installationReceptoraId:
        String(planoControlFederacion.identidad.installationId),
      resolverOrigenPublico: () =>
        resolutorRedPublicaFederacion.obtenerOrigenPublico(),
      guardiaActivacion: planoControlFederacion.guardiaActivacion
    }),
    servicioSesionesFederacion: planoControlFederacion.servicioSesiones,
    servicioHeartbeatFederacion: planoControlFederacion.servicioHeartbeat,
    servicioContinuidadFederacion: planoControlFederacion.servicioContinuidad,
    servicioReconciliacionFlujosFederacion,
    servicioIntercambioConcesionFederacion:
      new ServicioIntercambioConcesionFederacion({
        repositorio: repositorioIntercambiosConcesionFederacion,
        servicioSesiones: planoControlFederacion.servicioSesiones,
        installationLocalId: String(planoControlFederacion.identidad.installationId),
        servicioConsolidacion: servicioConsolidacionConcesionFederacion,
        guardiaActivacion: planoControlFederacion.guardiaActivacion
      })
  });
  const resolutorCapacidadRecepcionFederacion =
    new ResolutorCapacidadRecepcionFederacion({ servicioConfiguracionPortal });
  const repositorioCursoresRecepcionFederacion =
    new RepositorioCursoresRecepcionFederacionSql(clienteSql);
  const repositorioDisponibilidadFederacion =
    new RepositorioDisponibilidadFederacionSql(clienteSql);
  const servicioDisponibilidadFederacion = new ServicioDisponibilidadFederacion({
    clienteSql,
    repositorioDisponibilidad: repositorioDisponibilidadFederacion,
    repositorioCursores: repositorioCursoresRecepcionFederacion,
    servicioAvisosPlataforma,
    guardiaActivacion: planoControlFederacion.guardiaActivacion,
    resolverToleranciaTemporalMs: async () =>
      (await resolutorCapacidadRecepcionFederacion.resolver())
        .configuracion.toleranciaTemporalMs
  });
  const repositorioDivergenciasFederacion =
    new RepositorioDivergenciasFederacionSql(clienteSql, {
      servicioAvisos: servicioAvisosPlataforma,
      adaptadorAuditoria: new AdaptadorAuditoriaDivergenciasFederacion({
        repositorioAuditoria
      }),
      repositorioSoporteCampos: repositorioSoporteCamposFederacion
    });
  const repositorioEstadoProyeccionesFederacion =
    new RepositorioEstadoProyeccionesFederacionSql(clienteSql, {
      repositorioDivergencias: repositorioDivergenciasFederacion
    });
  const servicioRefederacionFederacion = new ServicioRefederacionFederacion({
    repositorioOcurrencias: new RepositorioOcurrenciasFederacionSql(clienteSql, {
      installationLocalId: String(planoControlFederacion.identidad.installationId),
      protectorContenidoSensible: planoControlFederacion.protectorContenidoSensible
    }),
    repositorioOutbox: new RepositorioOutboxFederacionSql(clienteSql),
    guardiaActivacion: planoControlFederacion.guardiaActivacion
  });
  const servicioRecepcionLotesFederacion = new ServicioRecepcionLotesFederacionLocal({
    clienteSql,
    repositorioEntregas: new RepositorioEntregasFederacionSql(clienteSql),
    repositorioInbox: new RepositorioInboxFederacionSql(clienteSql, {
      protectorContenidoSensible: planoControlFederacion.protectorContenidoSensible
    }),
    repositorioCursores: repositorioCursoresRecepcionFederacion,
    repositorioDisponibilidad: repositorioDisponibilidadFederacion,
    registroFamilias: registroFamiliasReconstruccion.registro,
    repositorioDivergencias: repositorioDivergenciasFederacion,
    testimoniadorRecepcion: new AdaptadorAuditoriaTransporteFederacion({
      repositorioAuditoria
    }),
    repositorioMaterializacion: new RepositorioMaterializacionFederacionSql(clienteSql, {
      repositorioContribuciones: new RepositorioContribucionesFederacionSql(clienteSql),
      repositorioSoporteCampos: repositorioSoporteCamposFederacion,
      repositorioEstadoProyecciones: repositorioEstadoProyeccionesFederacion,
      servicioRefederacion: servicioRefederacionFederacion
    }),
    normalizadorVistas: repositorioSoporteCamposFederacion,
    resolverCapacidad: async () =>
      (await resolutorCapacidadRecepcionFederacion.resolver()).aplicada,
    guardiaActivacion: planoControlFederacion.guardiaActivacion
  });
  const controladorDatosFederacion = new ControladorDatosFederacion({
    servicioRecepcionLotes: servicioRecepcionLotesFederacion,
    repositorioCursores: repositorioCursoresRecepcionFederacion,
    servicioDisponibilidad: servicioDisponibilidadFederacion,
    repositorioDisponibilidad: repositorioDisponibilidadFederacion,
    resolutorCapacidad: resolutorCapacidadRecepcionFederacion,
    exigirContribuciones: true
  });
  const middlewareAutenticacionDatosFederacion =
    crearMiddlewareAutenticarPlanoDatosFederacion({
      servicioSesionesFederacion: planoControlFederacion.servicioSesiones
    });
  const middlewareInterpretacionLoteFederacion =
    crearMiddlewareInterpretarLoteDatosFederacion({
      resolutorCapacidad: resolutorCapacidadRecepcionFederacion
    });

  const repositorioUsuarios = new RepositorioUsuarios(clienteSql);
  const servicioAutenticacion = new ServicioAutenticacion({
    repositorioUsuarios,
    servicioConfiguracionPortal
  });
  const repositorioMonitores = new RepositorioMonitores(clienteSql);
  const repositorioEventosMonitor = new RepositorioEventosMonitor(clienteSql);
  const repositorioAlertasActivasMonitor =
    new RepositorioAlertasActivasMonitor(clienteSql);
  const repositorioHistoricoMonitores =
    new RepositorioHistoricoMonitores(clienteSql);
  const repositorioTenants = new RepositorioTenants(clienteSql);
  const autoridadReservasJerarquicasOperacionesAdministrativas =
    new AutoridadReservasJerarquicasOperacionesAdministrativasSql(clienteSql);
  const servicioAutoridadMutacionesEstructurales =
    new ServicioAutoridadMutacionesEstructurales({
      autoridadReservasJerarquicas:
        autoridadReservasJerarquicasOperacionesAdministrativas
    });
  const repositorioEmpresas = new RepositorioEmpresas(clienteSql);
  const repositorioSitios = new RepositorioSitios(clienteSql);
  const repositorioSesionesWebAuditoria =
    new RepositorioSesionesWebAuditoria(clienteSql);
  const repositorioProyeccionesSesionesWeb =
    new RepositorioProyeccionesSesionesWebRedis({
      clienteRedis,
      prefijo: configuracion.redis.prefijoSesionesWebDurables
    });
  const repositorioPreautenticacionesWeb =
    new RepositorioPreautenticacionesWebRedis({
      clienteRedis,
      prefijo: configuracion.redis.prefijoPreautenticaciones
    });
  const canalInvalidacionesSesionesWeb =
    new CanalInvalidacionesSesionesWebRedis({
      clienteRedis,
      canal: configuracion.redis.canalInvalidacionesSesionesWeb
    });
  const canalInvalidacionesBuzonUsuarios =
    new CanalInvalidacionesBuzonUsuariosRedis({ clienteRedis });
  const servicioSesionesWebDurables =
    new ServicioSesionesWebDurables({
      clienteSql,
      repositorioSesiones: repositorioSesionesWebAuditoria,
      repositorioProyecciones: repositorioProyeccionesSesionesWeb,
      servicioAuditoria,
      canalInvalidaciones: canalInvalidacionesSesionesWeb,
      ttlSegundos: Math.floor(configuracion.sesion.maxAgeMs / 1000),
      maximoSesionesPorUsuario: 32
    });
  const servicioSesion = new ServicioSesion({
    clienteRedis,
    configuracionSesion: configuracion.sesion,
    configuracionRedis: configuracion.redis,
    servicioSesionesWebDurables,
    repositorioPreautenticaciones: repositorioPreautenticacionesWeb
  });
  const sessionMiddleware = servicioSesion.crearMiddlewareSesion();
  const repositorioPowRedis = new RepositorioPowRedis({
    clienteRedis,
    servicioConfiguracionPortal
  });
  const servicioPow = new ServicioPow({
    repositorioPowRedis,
    servicioConfiguracionPortal,
    validadorPow: new ValidadorPow()
  });
  const repositorioSolicitudesRecuperacionPassword =
    new RepositorioSolicitudesRecuperacionPasswordRedis({ clienteRedis });
  const repositorioCorreoRecuperacionPassword =
    new RepositorioCoordinacionCorreoRecuperacionPasswordSql(clienteSql, {
      repositorioAuditoria
    });
  const servicioAdmisionRecuperacionPassword =
    new ServicioAdmisionRecuperacionPasswordEmail({
      servicioPow,
      repositorioAdmision: new RepositorioAdmisionRecuperacionPasswordRedis({
        clienteRedis
      }),
      servicioConfiguracionPortal
    });
  const servicioPreparacionRecuperacionPassword =
    new ServicioPreparacionEmisionRecuperacionPasswordEmail({
      repositorioUsuarios,
      repositorioSolicitudes: repositorioSolicitudesRecuperacionPassword,
      repositorioCoordinacionCorreo: repositorioCorreoRecuperacionPassword,
      fronteraTransaccional,
      servicioConfiguracionPortal,
      propietarioProceso: `${configuracion.runtime.instanciaId}:web-recuperacion`
    });
  const servicioInicioPublicoRecuperacionPassword =
    new ServicioInicioPublicoRecuperacionPasswordEmail({
      servicioAdmision: servicioAdmisionRecuperacionPassword,
      servicioPreparacion: servicioPreparacionRecuperacionPassword,
      servicioActivacion: new ServicioActivacionEmisionRecuperacionPasswordEmail({
        repositorioSolicitudes: repositorioSolicitudesRecuperacionPassword,
        repositorioCoordinacionCorreo: repositorioCorreoRecuperacionPassword,
        fronteraTransaccional
      }),
      servicioConfiguracionPortal
    });
  const servicioContinuacionWebRecuperacionPassword =
    new ServicioContinuacionWebRecuperacionPasswordEmail({
      repositorioSolicitudes: repositorioSolicitudesRecuperacionPassword,
      servicioResolucion:
        new ServicioResolucionAgnosticaRecuperacionPasswordEmail({
          repositorioSolicitudes: repositorioSolicitudesRecuperacionPassword,
          repositorioUsuarios,
          fronteraTransaccional,
          propietario: `${configuracion.runtime.instanciaId}:web-recuperacion`
        }),
      servicioConsumo:
        new ServicioConvergenciaConsumoRecuperacionPasswordEmail({
          servicioSustitucion:
            new ServicioSustitucionPasswordRecuperacionEmail({
              repositorioSolicitudes:
                repositorioSolicitudesRecuperacionPassword,
              repositorioUsuarios,
              repositorioSesionesWeb: repositorioSesionesWebAuditoria,
              repositorioAuditoria,
              repositorioCoordinacionCorreo:
                repositorioCorreoRecuperacionPassword,
              servicioAutenticacion,
              servicioConfiguracionPortal,
              fronteraTransaccional,
              propietario:
                `${configuracion.runtime.instanciaId}:web-recuperacion`
            }),
          repositorioSolicitudes:
            repositorioSolicitudesRecuperacionPassword,
          servicioSesion,
          servicioAvisosPlataforma,
          actorRuntimeId:
            `${configuracion.runtime.instanciaId}:web-recuperacion`
        }),
      servicioConfiguracionPortal
    });
  const repositorioOperacionesSesionAgentes =
    new RepositorioOperacionesSesionAgentes(clienteSql);
  const repositorioFronteraRuntimeAgentes =
    new RepositorioFronteraRuntimeAgentesSql(clienteSql);
  const repositorioSesionesTecnicasCoordinadasRedis =
    new RepositorioSesionesTecnicasCoordinadasRedis({ clienteRedis });
  const adaptadorCoordinacionSesionesTecnicas =
    new AdaptadorCoordinacionSesionesTecnicasAgentes({
      repositorioOperaciones: repositorioOperacionesSesionAgentes,
      consolidadorSql: new ConsolidadorSesionesTecnicasAgentesSql()
    });
  const reconciliadorSesionesTecnicas =
    new ReconciliadorOperacionesSesionTecnicaAgentes({
      procesador: new ProcesadorOperacionesSesionTecnicaAgentes({
        coordinador: new CoordinadorOperacionesDurables({
          repositorio: adaptadorCoordinacionSesionesTecnicas,
          instanciaId: `${configuracion.runtime.instanciaId}:sesiones-agentes`,
          ttlSegundos: 15
        }),
        adaptadorCoordinacion: adaptadorCoordinacionSesionesTecnicas,
        repositorioRedis: repositorioSesionesTecnicasCoordinadasRedis
      }),
      informarError: (error) => {
        console.error(
          '[sentinelia-web] Error reconciliando sesiones técnicas de agentes'
        );
        console.error(error);
      }
    });
  const keyringSesionesTecnicasAgentes =
    crearKeyringSesionesTecnicasAgentesDesdeEntorno(process.env);

  resumenArranque.sesionesTecnicasAgentes = {
    keyring: true,
    keyIdActiva: keyringSesionesTecnicasAgentes.keyIdActiva,
    totalClaves: keyringSesionesTecnicasAgentes.listarIds().length,
    mensaje:
      `Keyring técnico de agentes validado. keyIdActiva=${keyringSesionesTecnicasAgentes.keyIdActiva} claves=${keyringSesionesTecnicasAgentes.listarIds().length}`
  };
  const evaluadorAutoridadCorreoSql = new EvaluadorAutoridadCorreoSql({
    repositorioConfiguracion,
    perfilSmtpCorreo,
    validadorConfiguracionCorreo: new ValidadorConfiguracionCorreo()
  });
  resumenArranque.keyringTecnicoCorreo = {
    keyring: true,
    keyIdActiva: keyringTecnicoCorreo.keyIdActiva,
    totalClaves: keyringTecnicoCorreo.listarIds().length,
    mensaje:
      `Keyring técnico de correo validado. keyIdActiva=${keyringTecnicoCorreo.keyIdActiva} claves=${keyringTecnicoCorreo.listarIds().length}`
  };
  const repositorioColaCorreo = new RepositorioColaCorreo(clienteSql);
  const repositorioTriggers = new RepositorioTriggers(clienteSql);
  const repositorioAudienciaTriggerCorreo =
    new RepositorioAudienciaTriggerCorreoSql();
  const repositorioPreparacionBajaEjecucionesCorreo =
    new RepositorioPreparacionBajaEjecucionesTriggerCorreoSql();
  const repositorioZonasDns = new RepositorioZonasDns(clienteSql);
  const repositorioRegistrosDns = new RepositorioRegistrosDns(clienteSql);
  const repositorioCoordinacionGeneracionesDns =
    new RepositorioCoordinacionGeneracionesDns({
      clienteSql,
      bloquearCatalogoEnTransaccion: bloquearCatalogoDnsEnTransaccion
    });
  try {
    resumenArranque.despliegueDdnsAgentes = await resolverActivacionDdnsAgentes({
      solicitada: configuracion.agentes.ddnsHabilitado,
      preparacionLocal: preparacionLocalDdnsAgentes,
      clienteRedis,
      prefijoRuntime: configuracion.runtime.redisPrefijo,
      entorno: configuracion.entorno,
      repositorioCoordinacion: repositorioCoordinacionGeneracionesDns,
      esperaMaximaMs:
        configuracion.organizacion.eliminacionAdministrativaEsperaCompatibilidadMs
    });
  } catch (error) {
    resumenArranque.despliegueDdnsAgentes = {
      habilitada: false,
      gateAbierto: false,
      solicitada: configuracion.agentes.ddnsHabilitado === true,
      perfil: preparacionLocalDdnsAgentes?.perfil ?? null,
      codigo: String(error?.codigo || 'precondicion_ddns_no_disponible'),
      detalle: error?.detalle ?? null
    };
  }
  const ddnsAgentesHabilitado =
    resumenArranque.despliegueDdnsAgentes.habilitada === true;
  const repositorioAgentes = new RepositorioAgentesSentinelia(clienteSql);
  const registradorCausaPolDdns = new ServicioRegistroCausaPolDdns({
    repositorioCausasPolDdns: new RepositorioCausasPolDdns(clienteSql)
  });
  const repositorioPerfilesServidor =
    new RepositorioPerfilesServidorAgentes(clienteSql);
  const repositorioEstadoRuntimeServidor =
    new RepositorioEstadoRuntimeServidorAgentes(clienteSql);
  const repositorioCatalogoSenalesTelemetria =
    new RepositorioCatalogoSenalesTelemetriaAgentes(clienteSql);
  const repositorioObservacionesTelemetria =
    new RepositorioObservacionesTelemetriaAgentes(clienteSql);
  const repositorioEstadoActualTelemetria =
    new RepositorioEstadoActualTelemetriaAgentes(clienteSql);
  const repositorioIdempotenciaLotesTelemetria =
    new RepositorioIdempotenciaLotesTelemetriaAgentes(clienteSql);
  const repositorioVinculosMonitoresTelemetria =
    new RepositorioVinculosMonitoresTelemetria(clienteSql);
  const repositorioEntradasFederadasMonitoresLogicos =
    new RepositorioEntradasFederadasMonitoresLogicosSql(clienteSql);
  const repositorioReglasDerivacionTelemetria =
    new RepositorioReglasDerivacionTelemetria(clienteSql);
  const repositorioTrabajosEvaluacionTelemetria =
    new RepositorioTrabajosEvaluacionTelemetria(clienteSql);
  const repositorioEstadoActualEvaluacionTelemetria =
    new RepositorioEstadoActualEvaluacionReglasTelemetria(clienteSql);
  const repositorioEventosDerivadosTelemetria =
    new RepositorioEventosDerivadosTelemetria(clienteSql);
  const publicadorAvisosEvaluacionTelemetria =
    new PublicadorAvisosEvaluacionTelemetriaRedis({
      clienteRedis,
      canal: `${configuracion.runtime.redisPrefijo}telemetria:evaluacion:pendiente`
    });
  const publicadorInvalidacionesMonitoresTelemetria =
    new PublicadorInvalidacionesMonitoresTelemetriaRedis({
      clienteRedis,
      canal: `${configuracion.runtime.redisPrefijo}telemetria:monitores:invalidacion`
    });
  const publicadorAvisosPerfilServidor =
    new PublicadorAvisosPerfilServidorRedis({
      clienteRedis,
      canal: `${configuracion.runtime.redisPrefijo}perfil-servidor:avisos`
    });
  const repositorioSesionesAgentesRedis = new RepositorioSesionesAgentesRedis({
    clienteRedis,
    prefijoSesionesAgentes: configuracion.redis.prefijoSesionesAgentes
  });
  const repositorioAsignacionesTriggerMonitor =
    new RepositorioAsignacionesTriggerMonitor(clienteSql);
  const repositorioEjecucionesTrigger =
    new RepositorioEjecucionesTrigger(clienteSql);
  const repositorioAutorizacionPerfil =
    new RepositorioAutorizacionPerfilRedis({
      clienteRedis,
      prefijoRedis: configuracion.redis.prefijoAutorizacionPerfil
    });
  const servicioAutorizacionPerfil = new ServicioAutorizacionPerfil({
    repositorioAutorizacionPerfil,
    servicioAutenticacion
  });
  const repositorioOperacionesEmailPerfil =
    new RepositorioOperacionesEmailPerfilRedis({
      clienteRedis,
      prefijoRedis: configuracion.redis.prefijoOperacionesEmailPerfil,
      secretoProteccionTokens: configuracion.sesion.secreto
    });
  const servicioEstadoSensibleUsuario = new ServicioEstadoSensibleUsuario({
    repositorioOperacionesEmail: repositorioOperacionesEmailPerfil,
    servicioAutorizacionPerfil
  });
  const servicioReinicioPasswordAdministrativo =
    new ServicioReinicioPasswordAdministrativo({
      repositorioUsuarios,
      repositorioOperaciones:
        new RepositorioReiniciosPasswordAdministrativosSql(clienteSql),
      repositorioCoordinacionCorreo:
        new RepositorioCoordinacionCorreoReinicioPasswordAdministrativoSql(
          clienteSql
        ),
      repositorioSesionesWeb: repositorioSesionesWebAuditoria,
      servicioSesion,
      evaluadorAutoridadCorreoSql,
      servicioAutenticacion,
      servicioEstadoSensibleUsuario,
      servicioAuditoria,
      fronteraTransaccional
    });
  const servicioAutogestionPerfil = new ServicioAutogestionPerfil({
    repositorioUsuarios,
    servicioAutorizacionPerfil,
    servicioAutenticacion,
    servicioSesion,
    servicioEstadoSensibleUsuario,
    fronteraTransaccional,
    servicioAuditoria
  });
  const controladorBootstrapUsuarioInicial =
    new ControladorBootstrapUsuarioInicial({
      repositorioUsuarios,
      servicioAutenticacion,
      configuracionUsuarioInicial: configuracion.usuarioInicial,
      fronteraTransaccional,
      servicioAuditoria
    });

  resumenArranque.usuarioInicial =
    await controladorBootstrapUsuarioInicial.arrancarSiProcede();

  const servicioAutorizacion = new ServicioAutorizacion();
  const resolutorScopeUsuario = new ResolutorScopeUsuario();
  const servicioReconciliacionBajaUsuarioTriggerCorreo =
    new ServicioReconciliacionBajaUsuarioTriggerCorreo({
      repositorioAudiencia: repositorioAudienciaTriggerCorreo,
      servicioAuditoria
    });
  const servicioUsuarios = new ServicioUsuarios({
    repositorioUsuarios,
    repositorioTenants,
    repositorioEmpresas,
    repositorioSitios,
    servicioAutenticacion,
    servicioAutorizacion,
    servicioSesion,
    resolutorScopeUsuario,
    validadorJerarquiaUsuario: new ValidadorJerarquiaUsuario(),
    asignadorPermisosUsuario: new AsignadorPermisosUsuario(),
    servicioEstadoSensibleUsuario,
    repositorioSesionesWebAuditoria,
    fronteraTransaccional,
    servicioAuditoria,
    repositorioControlFederacion,
    servicioAutoridadMutacionesEstructurales,
    servicioReconciliacionBajaUsuarioTriggerCorreo
  });
  const servicioJerarquiaOrganizativa = new ServicioJerarquiaOrganizativa({
    repositorioTenants,
    repositorioEmpresas,
    repositorioSitios,
    repositorioUsuarios,
    servicioCrudOrganizacionAuditable: new ServicioCrudOrganizacionAuditable({
      fronteraTransaccional: new FronteraTransaccionalLocal(clienteSql),
      repositorioCrud: new RepositorioCrudOrganizacionAuditable(),
      capturadorFederacion: capturadorIncrementalFamiliasFederacion,
      servicioAuditoria: new ServicioAuditoriaOperativa({
        repositorioAuditoria: new RepositorioAuditoria(clienteSql),
        capturadorFederacion: capturadorIncrementalFamiliasFederacion
      }),
      servicioAutoridadMutacionesEstructurales
    }),
    servicioMovimientosOrganizativosAuditable:
      new ServicioMovimientosOrganizativosAuditable({
        fronteraTransaccional: new FronteraTransaccionalLocal(clienteSql),
        servicioAutoridadMovimientos:
          new ServicioAutoridadMovimientosOrganizativos({
            autoridadReservasJerarquicas:
              autoridadReservasJerarquicasOperacionesAdministrativas
          }),
        repositorioMovimientos: new RepositorioMovimientosOrganizativos(),
        repositorioSesionesWeb: repositorioSesionesWebAuditoria,
        repositorioOperacionesAgentes: repositorioOperacionesSesionAgentes,
        repositorioControlFederacion,
        capturadorFederacion: capturadorIncrementalFamiliasFederacion,
        servicioAuditoria: new ServicioAuditoriaOperativa({
          repositorioAuditoria: new RepositorioAuditoria(clienteSql),
          capturadorFederacion: capturadorIncrementalFamiliasFederacion
        })
      }),
    servicioEliminacionesOrganizativasAuditable:
      new ServicioEliminacionesOrganizativasAuditable({
        fronteraTransaccional: new FronteraTransaccionalLocal(clienteSql),
        repositorioCrud: new RepositorioCrudOrganizacionAuditable(),
        repositorioEliminaciones: new RepositorioEliminacionesOrganizativas(),
        servicioImpacto: new ServicioImpactoEliminacion({ clienteSql }),
        repositorioSesionesWeb: repositorioSesionesWebAuditoria,
        repositorioOperacionesAgentes: repositorioOperacionesSesionAgentes,
        repositorioControlFederacion,
        capturadorFederacion: capturadorIncrementalFamiliasFederacion,
        servicioAuditoria: new ServicioAuditoriaOperativa({
          repositorioAuditoria: new RepositorioAuditoria(clienteSql),
          capturadorFederacion: capturadorIncrementalFamiliasFederacion
        }),
        limpiadorPostCommit: new LimpiadorSesionesEliminacionOrganizativa({
          servicioSesion,
          repositorioSesionesTecnicasRedis:
            repositorioSesionesTecnicasCoordinadasRedis
        })
      }),
    servicioImpactoEliminacion: new ServicioImpactoEliminacion({
      clienteSql
    })
  });
  const servicioMonitores = new ServicioMonitores({
    repositorioMonitores,
    repositorioTenants,
    repositorioEmpresas,
    repositorioSitios,
    repositorioEventosMonitor,
    repositorioAlertasActivasMonitor,
    repositorioHistoricoMonitores,
    repositorioVinculosMonitoresTelemetria,
    repositorioEntradasFederadasMonitoresLogicos,
    repositorioAgentes,
    repositorioCatalogoSenalesTelemetria,
    repositorioEstadoActualTelemetria,
    repositorioReglasDerivacionTelemetria,
    versionadorCatalogoMonitoresRedis,
    resolutorScopeUsuario,
    validadorMonitor: new ValidadorMonitor(),
    fronteraTransaccional,
    servicioAuditoria,
    capturadorFederacion: capturadorIncrementalFamiliasFederacion,
    repositorioPreparacionBajaEjecucionesCorreo,
    servicioCierreAlertasMonitoresInactivos: new ServicioCierreAlertasMonitoresInactivos({
      repositorioMonitores,
      repositorioAlertasActivasMonitor,
      fronteraTransaccional,
      capturadorFederacionMonitores: capturadoresTecnicosFederacion.monitores,
      registrarAuditoriaEnTransaccion: (intencion, { conexion }) =>
        servicioAuditoria.registrarEnTransaccion({ cambioEfectivo: true, intencion }, { conexion })
    })
  });
  const servicioCorreoPortal = new ServicioCorreoPortal({
    servicioConfiguracionPortal,
    validadorConfiguracionCorreo: new ValidadorConfiguracionCorreo(),
    repositorioColaCorreo,
    bloqueadorEnvioCorreoRedis: new BloqueadorEnvioCorreoRedis({
      clienteRedis,
      prefijoBloqueoCorreo: configuracion.redis.prefijoBloqueoCorreo
    }),
    clienteSmtp: new ClienteSmtp(),
    evaluadorAutoridadCorreoSql,
    fronteraTransaccional
  });
  const repositorioCorreoVerificacionEmailPerfil =
    new RepositorioCoordinacionCorreoVerificacionEmailPerfilSql(clienteSql);
  const dependenciasEmisionEmailPerfil = {
    repositorioUsuarios,
    repositorioOperacionesEmail: repositorioOperacionesEmailPerfil,
    repositorioCoordinacionCorreo: repositorioCorreoVerificacionEmailPerfil,
    servicioCorreoPortal,
    servicioConfiguracionPortal,
    servicioEmailPerfil: new ServicioEmailPerfil({ repositorioUsuarios }),
    fronteraTransaccional
  };
  const emisorInicialEmailPerfil =
    new ServicioEmisionInicialEmailPerfilCoordinada(
      dependenciasEmisionEmailPerfil
    );
  const reemisorEmailPerfil = new ServicioReenvioEmailPerfilCoordinado(
    dependenciasEmisionEmailPerfil
  );
  const coordinadorEmisionEmailPerfil = Object.freeze({
    encolarInicial: (entrada) => emisorInicialEmailPerfil.encolarInicial(entrada),
    encolarReenvio: (entrada) => reemisorEmailPerfil.encolarReenvio(entrada)
  });
  servicioDisponibilidadRecuperacionPassword =
    new ServicioDisponibilidadRecuperacionPasswordEmail({
      servicioConfiguracionPortal,
      servicioCorreoPortal,
      presenciaPreparada: async () => {
        try {
          const fotografiaCorreoActual =
            await new RepositorioPreparacionDespliegueTriggerCorreoSql(
              clienteSql
            ).fotografiar();
          evaluarPreparacionLocalTriggerCorreo({
            migracionesAplicadas:
              await repositorioMigraciones.listarNombresAplicados(),
            postcondicionesMigracionesVerificadas:
              resumenArranque.migraciones.integridad?.ok === true,
            fotografia: fotografiaCorreoActual
          });
          const preparacionLocal =
            evaluarPreparacionLocalRecuperacionPasswordEmail({
              migracionesAplicadas:
                await repositorioMigraciones.listarNombresAplicados(),
              postcondicionesMigracionesVerificadas:
                resumenArranque.migraciones.integridad?.ok === true,
              configuracionUsuarios: servicioConfiguracionPortal
                .obtenerConfiguracionActual()
                .obtenerConfiguracionUsuarios(),
              colaCorreoPreparada:
                Number(fotografiaCorreoActual.estado?.cola_sql_autoritativa) === 1,
              keyringTecnicoCorreo,
              capacidadesWeb: CAPACIDADES_WEB_RECUPERACION_PASSWORD_EMAIL
            });
          await resolverUnanimidadRecuperacionPasswordEmail({
            preparacionLocal,
            clienteRedis,
            prefijoRuntime: configuracion.runtime.redisPrefijo,
            entorno: configuracion.entorno
          });
          return true;
        } catch (error) {
          if (error instanceof
                ErrorCompatibilidadDespliegueRecuperacionPasswordEmail ||
              error instanceof ErrorCompatibilidadDespliegueTriggerCorreo) {
            return false;
          }
          throw error;
        }
      }
    });
  const servicioCambioEmailPerfil = new ServicioCambioEmailPerfil({
    repositorioUsuarios,
    repositorioOperacionesEmail: repositorioOperacionesEmailPerfil,
    servicioEmailPerfil: new ServicioEmailPerfil({ repositorioUsuarios }),
    servicioAutorizacionPerfil,
    servicioCorreoPortal,
    servicioConfiguracionPortal,
    coordinadorEmisionEmailPerfil,
    fronteraTransaccional,
    servicioAuditoria
  });
  const servicioVerificacionCorreoOperativo =
    new ServicioVerificacionCorreoOperativo({
      clienteRedis,
      repositorioUsuarios,
      servicioConfiguracionPortal,
      servicioCorreoPortal,
      perfilSmtpCorreo,
      evaluadorAutoridadCorreoSql,
      prefijoRedis: configuracion.redis.prefijoVerificacionCorreoOperativo
    });
  const servicioDns = new ServicioDns({
    repositorioZonasDns,
    repositorioRegistrosDns,
    servicioConfiguracionPortal,
    versionadorDnsRedis
  });
  const servicioTriggers = new ServicioTriggers({
    repositorioTriggers,
    repositorioAsignacionesTriggerMonitor,
    repositorioEjecucionesTrigger,
    repositorioMonitores,
    validadorTrigger: new ValidadorTrigger(),
    fronteraTransaccional,
    servicioAuditoria,
    servicioConfiguracionPortal,
    capturadorFederacion: capturadorIncrementalFamiliasFederacion,
    capturadorFederacionEjecuciones: capturadoresTecnicosFederacion.triggers,
    repositorioPreparacionBajaEjecucionesCorreo,
    resolutorEjecutorTrigger: new ResolutorEjecutorTrigger({
      ejecutores: [
        new EjecutorTriggerApi(),
        new EjecutorTriggerDns({
          repositorioRegistrosDns,
          repositorioZonasDns,
          servicioDns,
          servicioAuditoria,
          repositorioCoordinacionGeneracionesDns
        })
      ]
    })
  });
  const servicioLecturaTriggersPortal = new ServicioLecturaTriggersPortal({
    repositorioMonitores,
    servicioTriggers
  });
  const servicioAudienciaTriggerCorreo = new ServicioAudienciaTriggerCorreo({
    repositorioAudiencia: repositorioAudienciaTriggerCorreo,
    fronteraTransaccional
  });
  const servicioAdministracionAudienciaTriggerCorreo =
    new ServicioAdministracionAudienciaTriggerCorreo({
      servicioAudiencia: servicioAudienciaTriggerCorreo,
      repositorioAudiencia: repositorioAudienciaTriggerCorreo,
      repositorioTriggers,
      repositorioUsuarios,
      fronteraTransaccional,
      servicioAutorizacion,
      servicioAuditoria
    });
  const servicioLecturaTriggerCorreoPortal =
    new ServicioLecturaTriggerCorreoPortal({
      repositorio: new RepositorioLecturaTriggerCorreoSql(clienteSql),
      fronteraTransaccional,
      servicioAutorizacion
    });
  const controladorDesuscripcionTriggerCorreo =
    new ControladorDesuscripcionTriggerCorreo({
      servicioDesuscripcion: new ServicioDesuscripcionTriggerCorreo({
        repositorio: new RepositorioDesuscripcionTriggerCorreoSql(clienteSql),
        fronteraTransaccional,
        servicioAuditoria
      })
    });
  const servicioAdministracionTriggersPortal =
    new ServicioAdministracionTriggersPortal({
      repositorioTriggers,
      repositorioAsignacionesTriggerMonitor,
      repositorioMonitores,
      repositorioZonasDns,
      repositorioRegistrosDns,
      repositorioTenants,
      repositorioEmpresas,
      repositorioSitios,
      resolutorScopeUsuario,
      servicioTriggers,
      servicioMonitores,
      servicioLecturaTriggersPortal,
      apiPrivadaAudienciaTriggerCorreo:
        servicioAdministracionAudienciaTriggerCorreo.crearApiPrivadaVerificador(),
      apiPrivadaLecturaTriggerCorreo:
        servicioLecturaTriggerCorreoPortal.crearApiPrivadaVerificador(),
      repositorioAdministracionTriggerCorreo:
        new RepositorioAdministracionTriggerCorreoSql(clienteSql),
      servicioConfiguracionPortal,
      servicioCorreoPortal,
      fronteraTransaccional
    });
  const servicioContextoUsuario = new ServicioContextoUsuario({
    repositorioUsuarios,
    resolutorScopeUsuario
  });
  const registroWebSocketsSesionesWeb =
    new RegistroWebSocketsSesionesWebDurables({
      repositorioSesiones: repositorioSesionesWebAuditoria,
      instanciaId: configuracion.runtime.instanciaId,
      validarEstadoActual: async (sesion) => {
        const versiones = new Map([
          [sesion.usuarioRealId, sesion.versionSesionReal],
          [sesion.usuarioEfectivoId, sesion.versionSesionEfectiva]
        ]);
        for (const [usuarioId, versionEsperada] of versiones) {
          const version = await clienteRedis.get(
            servicioSesion.obtenerClaveVersionUsuario(usuarioId)
          );
          if (Number(version) !== Number(versionEsperada)) return false;
        }
        return true;
      }
    });
  const difusorWebSocketPortal = new DifusorWebSocketPortal({
    sessionMiddleware,
    servicioSesion,
    servicioContextoUsuario,
    servicioAutorizacion,
    registroSesionesWeb: registroWebSocketsSesionesWeb
  });
  const servicioPresentacionAvisosPlataforma =
    new ServicioPresentacionAvisosPlataforma({
      repositorio: repositorioPresentacionAvisosPlataforma,
      servicioAutorizacion,
      difusorWebSocketPortal
    });
  const servicioAlertasRemotasPortal = new ServicioAlertasRemotasPortal({
    repositorio: repositorioAlertasRemotasPortal,
    servicioAutorizacion,
    fronteraTransaccional,
    servicioAuditoria,
    difusorWebSocketPortal
  });
  const servicioCausalidadAlertasLocalesFederadas =
    new ServicioCausalidadAlertasLocalesFederadas({
      repositorioEntradasFederadas:
        repositorioEntradasFederadasMonitoresLogicos,
      servicioAutorizacion
    });
  const servicioDashboard = new ServicioDashboard({
    repositorioMonitores,
    repositorioAlertasActivasMonitor,
    repositorioUsuarios,
    repositorioZonasDns,
    repositorioRegistrosDns,
    servicioAutorizacion,
    servicioAlertasRemotasPortal,
    servicioCausalidadAlertasLocalesFederadas,
    clienteRedis,
    configuracionRuntime: configuracion.runtime
  });
  const servicioGestionAlertasActivasPortal =
    new ServicioGestionAlertasActivasPortal({
      repositorioMonitores,
      repositorioAlertasActivasMonitor,
      servicioAutorizacion,
      difusorWebSocketPortal,
      fronteraTransaccional,
      servicioAuditoria
    });
  const servicioLecturaDnsPortal = new ServicioLecturaDnsPortal({
    repositorioZonasDns,
    repositorioRegistrosDns
  });
  const servicioAplicacionDdnsAgentes = new ServicioAplicacionDdnsAgentes({
    clienteSql,
    repositorioUsuarios,
    repositorioCoordinacionGeneracionesDns,
    servicioDns,
    servicioAuditoria,
    repositorioOutboxAuditoria: repositorioOutboxAuditoriaDdns
  });
  const servicioConsultaDdnsAgentes = new ServicioConsultaDdnsAgentes({
    clienteSql,
    secretoCursores: keyringSesionesTecnicasAgentes.obtenerActiva().clave
  });
  const servicioLecturaAdministrativaDdnsAgentes =
    new ServicioConsultaAdministrativaDdnsAgentes({
      clienteSql,
      repositorioUsuarios,
      resolutorScopeUsuario
    });
  const servicioAdministracionDnsPortal = new ServicioAdministracionDnsPortal({
    repositorioZonasDns,
    repositorioRegistrosDns,
    repositorioTenants,
    repositorioEmpresas,
    repositorioSitios,
    resolutorScopeUsuario,
    servicioLecturaDnsPortal,
    servicioDns,
    servicioTriggers,
    fronteraTransaccional,
    servicioAuditoria,
    repositorioCoordinacionGeneracionesDns,
    servicioAplicacionDdnsAgentes,
    servicioLecturaAdministrativaDdnsAgentes
  });
  const servicioIngestaTelemetriaAgentes =
    new ServicioIngestaTelemetriaAgentes({
      repositorioCatalogoSenales: repositorioCatalogoSenalesTelemetria,
      repositorioObservaciones: repositorioObservacionesTelemetria,
      repositorioEstadoActual: repositorioEstadoActualTelemetria,
      repositorioIdempotenciaLotes: repositorioIdempotenciaLotesTelemetria,
      repositorioReglasDerivacion: repositorioReglasDerivacionTelemetria,
      repositorioTrabajosEvaluacion: repositorioTrabajosEvaluacionTelemetria,
      repositorioFronteraRuntime: repositorioFronteraRuntimeAgentes,
      capturadorFederacionTelemetria: capturadoresTecnicosFederacion.telemetria,
      publicadorAvisosEvaluacion: publicadorAvisosEvaluacionTelemetria,
      publicadorInvalidacionesMonitores:
        publicadorInvalidacionesMonitoresTelemetria
    });
  const publicadorTelemetriaRuntimeEnTransaccion =
    new PublicadorTelemetriaRuntimeEnTransaccion({
      servicioIngestaTelemetriaAgentes
    });
  const coordinadorPerfilServidorRedis = new CoordinadorPerfilServidorRedis({
    clienteRedis,
    prefijoRedis: `${configuracion.runtime.redisPrefijo}perfil-servidor:`
  });
  const servicioRetiradaPerfilServidor =
    new ServicioRetiradaPerfilServidorAgenteEnTransaccion({
      repositorioPerfilesServidor,
      repositorioEstadoRuntimeServidor,
      repositorioCatalogoSenales: repositorioCatalogoSenalesTelemetria,
      repositorioEstadoActualTelemetria,
      repositorioEstadoActualEvaluacion:
        repositorioEstadoActualEvaluacionTelemetria,
      capturadorFederacionTelemetria:
        capturadoresTecnicosFederacion.telemetria
    });
  const servicioProvisionamientoAgentes = new ServicioProvisionamientoAgentes({
    repositorioAgentes,
    repositorioSitios,
    servicioAutoridadMovimientoAgente: new ServicioAutoridadMovimientoAgente({
      autoridadReservasJerarquicas:
        autoridadReservasJerarquicasOperacionesAdministrativas
    }),
    servicioAutoridadMutacionesEstructurales,
    servicioAplicacionDdnsAgentes,
    fronteraTransaccional,
    servicioAuditoria,
    repositorioPerfilesServidor,
    repositorioEstadoRuntimeServidor,
    servicioRetiradaPerfilServidor,
    coordinadorPerfilServidorRedis,
    publicadorInvalidacionesMonitores:
      publicadorInvalidacionesMonitoresTelemetria,
    publicadorTelemetriaRuntimeEnTransaccion,
    perfilServidorHabilitado:
      configuracion.agentes.perfilServidorHabilitado,
    histeresisSinPolSugeridaSegundos:
      configuracion.agentes.heartbeatIntervalSegundos +
      configuracion.agentes.heartbeatGraceSegundos,
    capturadorFederacion: capturadorIncrementalFamiliasFederacion,
    repositorioOperacionesSesionAgentes,
    invalidarSesionesAgente: async ({ agenteId, motivo }) => {
      await repositorioSesionesAgentesRedis.invalidarSesionActualAgente(agenteId);
      await repositorioAgentes.cerrarPeriodoVidaPolAbierto({
        agenteId,
        motivoCierre: motivo
      });
    }
  });
  const servicioAutenticacionAgentes = new ServicioAutenticacionAgentes({
    repositorioAgentes,
    repositorioSesionesAgentesRedis,
    servicioConfiguracionPortal,
    fronteraTransaccional,
    repositorioFronteraRuntime: repositorioFronteraRuntimeAgentes,
    servicioAuditoria,
    publicadorAvisosPerfilServidor,
    registradorCausaPolDdns: ddnsAgentesHabilitado
      ? registradorCausaPolDdns
      : null,
    ddnsAgentesHabilitado,
    perfilServidorHabilitado:
      configuracion.agentes.perfilServidorHabilitado
  });
  const servicioLecturaTelemetriaAgentes =
    new ServicioLecturaTelemetriaAgentes({
      servicioProvisionamientoAgentes,
      repositorioCatalogoSenales: repositorioCatalogoSenalesTelemetria,
      repositorioObservaciones: repositorioObservacionesTelemetria,
      repositorioEstadoActual: repositorioEstadoActualTelemetria
    });
  const servicioAdministracionAgentesPortal =
    new ServicioAdministracionAgentesPortal({
      servicioProvisionamientoAgentes,
      repositorioAgentes,
      repositorioSitios,
      repositorioSesionesAgentesRedis,
      servicioLecturaTelemetriaAgentes,
      servicioLecturaAdministrativaDdnsAgentes,
      repositorioReglasDerivacionTelemetria
    });
  const catalogoContratosOperacionesAdministrativas =
    new CatalogoEjecutoresOperacionesAdministrativas({
      contratos: [
        CONTRATO_OPERACION_ADMINISTRATIVA_ELIMINACION_AGENTE,
        CONTRATO_OPERACION_ADMINISTRATIVA_ELIMINACION_ORGANIZACION
      ]
    });
  const repositorioOperacionesAdministrativas =
    new RepositorioOperacionesAdministrativasSql({
      clienteSql,
      catalogoEjecutores: catalogoContratosOperacionesAdministrativas
    });
  const repositorioEliminacionAdministrativaAgentes =
    new RepositorioEliminacionAdministrativaAgentesSql(clienteSql);
  const catalogoContratosNotificaciones =
    new CatalogoContratosNotificacionesOperacionesAdministrativas({
      contratos: [
        CONTRATO_PERSISTENCIA_NOTIFICACIONES_ELIMINACION_AGENTE,
        CONTRATO_PERSISTENCIA_NOTIFICACIONES_ELIMINACION_ORGANIZACION
      ]
    });
  const repositorioNotificacionesUsuario =
    new RepositorioNotificacionesUsuarioSql(clienteSql, {
      catalogoContratos: catalogoContratosNotificaciones
    });
  const repositorioObligacionesPostcommitEliminacionAgentes =
    new RepositorioObligacionesPostcommitEliminacionAgentesSql(clienteSql);
  const servicioAutorizacionEliminacionAdministrativaAgente =
    new ServicioAutorizacionEliminacionAdministrativaAgente({
      repositorioUsuarios,
      repositorioAgentes,
      fronteraTransaccional
    });
  const codecConfirmacionEliminacionAgente =
    new CodecConfirmacionEliminacionAgente({
      secreto: `${configuracion.sesion.secreto}:eliminacion-administrativa-agentes`
    });
  const servicioImpactoEliminacionAgente = new ServicioImpactoEliminacionAgente({
    repositorioEliminacion: repositorioEliminacionAdministrativaAgentes,
    servicioAutorizacion: servicioAutorizacionEliminacionAdministrativaAgente,
    fronteraTransaccional,
    codecConfirmacion: codecConfirmacionEliminacionAgente
  });
  const servicioAceptacionEliminacionAdministrativaAgente =
    new ServicioAceptacionEliminacionAdministrativaAgente({
      servicioImpacto: servicioImpactoEliminacionAgente,
      servicioAutorizacion: servicioAutorizacionEliminacionAdministrativaAgente,
      fronteraTransaccional,
      codecConfirmacion: codecConfirmacionEliminacionAgente,
      autoridadReservasJerarquicas:
        autoridadReservasJerarquicasOperacionesAdministrativas,
      repositorioOperaciones: repositorioOperacionesAdministrativas,
      repositorioNotificaciones: repositorioNotificacionesUsuario
    });
  const servicioAutorizacionEliminacionAdministrativaOrganizacion =
    new ServicioAutorizacionEliminacionAdministrativaOrganizacion({
      repositorioUsuarios,
      autoridadReservasJerarquicas:
        autoridadReservasJerarquicasOperacionesAdministrativas,
      fronteraTransaccional
    });
  const codecConfirmacionEliminacionOrganizacion =
    new CodecConfirmacionEliminacionOrganizacion({
      secreto:
        `${configuracion.sesion.secreto}:eliminacion-administrativa-organizaciones`
    });
  const servicioImpactoEliminacionOrganizacion =
    new ServicioImpactoEliminacionOrganizacion({
      repositorioImpacto:
        new RepositorioImpactoEliminacionOrganizacionSql(clienteSql),
      servicioAutorizacion:
        servicioAutorizacionEliminacionAdministrativaOrganizacion,
      codecConfirmacion: codecConfirmacionEliminacionOrganizacion
    });
  const servicioAceptacionEliminacionAdministrativaOrganizacion =
    new ServicioAceptacionEliminacionAdministrativaOrganizacion({
      servicioAutorizacion:
        servicioAutorizacionEliminacionAdministrativaOrganizacion,
      fronteraTransaccional,
      codecConfirmacion: codecConfirmacionEliminacionOrganizacion,
      repositorioOperaciones: repositorioOperacionesAdministrativas,
      repositorioNotificaciones: repositorioNotificacionesUsuario
    });
  const servicioConsultaOperacionesAdministrativas =
    new ServicioConsultaOperacionesAdministrativas({
      repositorioOperaciones: repositorioOperacionesAdministrativas,
      repositorioObligaciones:
        repositorioObligacionesPostcommitEliminacionAgentes,
      catalogoProyectores:
        new CatalogoProyectoresConsultaOperacionesAdministrativas({
          proyectores: [
            new ProyectorConsultaOperacionEliminacionAgente({
              repositorioAgentes,
              servicioAutorizacion
            }),
            new ProyectorConsultaOperacionEliminacionOrganizacion({
              repositorioTenants,
              repositorioEmpresas,
              repositorioSitios,
              servicioAutorizacion
            })
          ]
        })
    });
  const servicioBuzonNotificacionesUsuario =
    new ServicioBuzonNotificacionesUsuario({
      repositorio: repositorioNotificacionesUsuario,
      catalogoResolutoresSujetos: new CatalogoResolutoresSujetosNotificaciones({
        resolutores: [
          new ResolutorSujetosAgenteNotificaciones({
            repositorioAgentes,
            servicioAutorizacion
          }),
          new ResolutorSujetosOrganizacionNotificaciones({
            repositorioTenants,
            repositorioEmpresas,
            repositorioSitios
          })
        ]
      }),
      servicioAutorizacion,
      publicadorInvalidaciones: canalInvalidacionesBuzonUsuarios,
      secretoCursores: `${configuracion.sesion.secreto}:cursores-buzon-usuarios`
    });
  await reconciliadorSesionesTecnicas.arrancar();
  const activacionEliminacionAdministrativaAgentes =
    await resolverActivacionEliminacionAdministrativaAgentes({
      solicitada:
        configuracion.agentes.eliminacionAdministrativaHttpHabilitada,
      repositorioMigraciones,
      resumenMigraciones: resumenArranque.migraciones,
      clienteRedis,
      prefijoRuntime: configuracion.runtime.redisPrefijo,
      entorno: configuracion.entorno,
      esperaMaximaMs:
        configuracion.agentes.eliminacionAdministrativaEsperaCompatibilidadMs,
      capacidadesWeb: [
        typeof servicioAceptacionEliminacionAdministrativaAgente.aceptar === 'function'
          ? 'http_operacion_desacoplada_v1'
          : null,
        typeof reconciliadorSesionesTecnicas.arrancar === 'function' &&
          typeof reconciliadorSesionesTecnicas.reconciliar === 'function'
          ? 'reconciliador_sesiones_tecnicas_v1'
          : null,
        typeof difusorWebSocketPortal.emitirBuzonUsuarioActualizado === 'function'
          ? 'websocket_buzon_usuario_v1'
          : null
      ].filter(Boolean)
    });
  resumenArranque.eliminacionAdministrativaAgentes =
    activacionEliminacionAdministrativaAgentes;
  const activacionEliminacionAdministrativaOrganizaciones =
    await resolverActivacionEliminacionAdministrativaOrganizaciones({
      repositorioMigraciones,
      resumenMigraciones: resumenArranque.migraciones,
      clienteRedis,
      prefijoRuntime: configuracion.runtime.redisPrefijo,
      entorno: configuracion.entorno,
      esperaMaximaMs:
        configuracion.organizacion
          .eliminacionAdministrativaEsperaCompatibilidadMs,
      capacidadesWeb: [
        typeof servicioAceptacionEliminacionAdministrativaOrganizacion
          .aceptar === 'function'
          ? 'http_organizacion_desacoplada_v1'
          : null,
        typeof servicioConsultaOperacionesAdministrativas.obtener === 'function'
          ? 'consulta_operaciones_transversal_v1'
          : null,
        typeof difusorWebSocketPortal.emitirBuzonUsuarioActualizado === 'function'
          ? 'websocket_buzon_usuario_v1'
          : null,
        'sin_camino_sincrono_organizacion_v1'
      ].filter(Boolean)
    });
  resumenArranque.eliminacionAdministrativaOrganizaciones =
    activacionEliminacionAdministrativaOrganizaciones;
  const preparacionLocalTriggerCorreo = evaluarPreparacionLocalTriggerCorreo({
    migracionesAplicadas: await repositorioMigraciones.listarNombresAplicados(),
    postcondicionesMigracionesVerificadas:
      resumenArranque.migraciones.integridad?.ok === true,
    fotografia: await new RepositorioPreparacionDespliegueTriggerCorreoSql(
      clienteSql
    ).fotografiar()
  });
  const preparacionUnanimeTriggerCorreo =
    await resolverUnanimidadPreparacionTriggerCorreo({
      preparacionLocal: preparacionLocalTriggerCorreo,
      capacidadesWeb: CAPACIDADES_WEB_TRIGGER_CORREO,
      clienteRedis,
      prefijoRuntime: configuracion.runtime.redisPrefijo,
      entorno: configuracion.entorno,
      esperaMaximaMs:
        configuracion.organizacion.eliminacionAdministrativaEsperaCompatibilidadMs
    });
  const corteOrigenTriggerCorreo = await new ServicioCorteAutoridadOrigenCorreo({
    repositorioConfiguracion,
    fronteraTransaccional,
    versionadorConfiguracionRedis
  }).ejecutar({ preparacionUnanime: preparacionUnanimeTriggerCorreo });
  await servicioConfiguracionPortal.asegurarActualizada();
  const postcondicionOrigenTriggerCorreo = evaluarPreparacionLocalTriggerCorreo({
    migracionesAplicadas: await repositorioMigraciones.listarNombresAplicados(),
    postcondicionesMigracionesVerificadas:
      resumenArranque.migraciones.integridad?.ok === true,
    fotografia: await new RepositorioPreparacionDespliegueTriggerCorreoSql(
      clienteSql
    ).fotografiar()
  });
  if (!['corte_origen', 'corte_verificacion', 'quietud_cola', 'activado']
    .includes(postcondicionOrigenTriggerCorreo.estado)) {
    throw new Error('El corte del origen público no alcanzó su postcondición durable.');
  }
  const corteRevisionTriggerCorreo = await new ServicioCorteRevisionTriggersCorreo({
    repositorioConfiguracion,
    fronteraTransaccional
  }).ejecutar({ preparacionUnanime: preparacionUnanimeTriggerCorreo });
  const fotografiaRevisionTriggerCorreo =
    await new RepositorioPreparacionDespliegueTriggerCorreoSql(clienteSql)
      .fotografiar();
  const postcondicionRevisionTriggerCorreo = evaluarPreparacionLocalTriggerCorreo({
    migracionesAplicadas: await repositorioMigraciones.listarNombresAplicados(),
    postcondicionesMigracionesVerificadas:
      resumenArranque.migraciones.integridad?.ok === true,
    fotografia: fotografiaRevisionTriggerCorreo
  });
  if (Number(
    fotografiaRevisionTriggerCorreo.estado.guard_revision_trigger_activo
  ) !== 1) {
    throw new Error('El corte de revisión no activó su guard durable.');
  }
  const corteVerificacionSmtpCorreo =
    await new ServicioCorteVerificacionSmtpCorreo({
      repositorioConfiguracion,
      fronteraTransaccional,
      versionadorConfiguracionRedis
    }).ejecutar({ preparacionUnanime: preparacionUnanimeTriggerCorreo });
  await servicioConfiguracionPortal.asegurarActualizada();
  const fotografiaVerificacionSmtpCorreo =
    await new RepositorioPreparacionDespliegueTriggerCorreoSql(clienteSql)
      .fotografiar();
  const postcondicionVerificacionSmtpCorreo = evaluarPreparacionLocalTriggerCorreo({
    migracionesAplicadas: await repositorioMigraciones.listarNombresAplicados(),
    postcondicionesMigracionesVerificadas:
      resumenArranque.migraciones.integridad?.ok === true,
    fotografia: fotografiaVerificacionSmtpCorreo
  });
  if (!['corte_verificacion', 'quietud_cola', 'activado']
    .includes(postcondicionVerificacionSmtpCorreo.estado)) {
    throw new Error('El corte SMTP no alcanzó su postcondición durable.');
  }
  const servicioCorteAutoridadColaCorreo = new ServicioCorteAutoridadColaCorreo({
    repositorioConfiguracion,
    evaluadorAutoridadCorreoSql,
    fronteraTransaccional,
    versionadorConfiguracionRedis
  });
  const servicioActivacionTriggerCorreo = new ServicioActivacionTriggerCorreo({
    repositorioConfiguracion,
    evaluadorAutoridadCorreoSql,
    fronteraTransaccional,
    versionadorConfiguracionRedis
  });
  const avanzarCorteAutoridadColaCorreo = async () => {
    const corteCola = await servicioCorteAutoridadColaCorreo.avanzar({
      preparacionUnanime: preparacionUnanimeTriggerCorreo
    });
    if (corteCola.cambioEfectivo) {
      await servicioConfiguracionPortal.asegurarActualizada();
    }
    const activacion = corteCola.fase === 'activada'
      ? await servicioActivacionTriggerCorreo.activar({
          preparacionUnanime: preparacionUnanimeTriggerCorreo
        })
      : null;
    if (activacion?.cambioEfectivo) {
      await servicioConfiguracionPortal.asegurarActualizada();
    }
    const fotografia = await new RepositorioPreparacionDespliegueTriggerCorreoSql(
      clienteSql
    ).fotografiar();
    const postcondicion = evaluarPreparacionLocalTriggerCorreo({
      migracionesAplicadas: await repositorioMigraciones.listarNombresAplicados(),
      postcondicionesMigracionesVerificadas:
        resumenArranque.migraciones.integridad?.ok === true,
      fotografia
    });
    resumenArranque.despliegueTriggerCorreo = {
      ...preparacionUnanimeTriggerCorreo,
      ...postcondicion,
      unanimidad: true,
      corteOrigen: corteOrigenTriggerCorreo,
      corteRevision: corteRevisionTriggerCorreo,
      corteVerificacionSmtp: corteVerificacionSmtpCorreo,
      corteCola,
      activacion
    };
    return Object.freeze({ corteCola, activacion });
  };
  await avanzarCorteAutoridadColaCorreo();
  resumenArranque.despliegueTriggerCorreo = {
    ...preparacionUnanimeTriggerCorreo,
    ...resumenArranque.despliegueTriggerCorreo,
    unanimidad: true,
    corteOrigen: corteOrigenTriggerCorreo,
    corteRevision: corteRevisionTriggerCorreo,
    corteVerificacionSmtp: corteVerificacionSmtpCorreo
  };
  const servicioAdministracionReglasDerivacionTelemetria =
    new ServicioAdministracionReglasDerivacionTelemetria({
      repositorioAgentes,
      repositorioCatalogoSenales: repositorioCatalogoSenalesTelemetria,
      repositorioReglas: repositorioReglasDerivacionTelemetria,
      repositorioEstadoActualEvaluacion:
        repositorioEstadoActualEvaluacionTelemetria,
      repositorioEventosDerivados: repositorioEventosDerivadosTelemetria,
      repositorioTrabajosEvaluacion: repositorioTrabajosEvaluacionTelemetria,
      repositorioEstadoActualTelemetria,
      fronteraTransaccional,
      servicioAuditoria,
      capturadorFederacionTelemetria: capturadoresTecnicosFederacion.telemetria,
      permitirMomentoUtcRelativo: activacionMomentoUtcRelativo.gateAbierto,
      permitirPrevisualizacionMomentoUtcRelativo: true,
      leerAhoraUtcSql: async () => {
        const filas = await clienteSql.consultar(
          'SELECT UTC_TIMESTAMP(0) AS ahora_utc'
        );
        return filas[0]?.ahora_utc;
      }
    });

  const controladorLogin = new ControladorLogin({
    servicioAutenticacion,
    servicioSesion,
    configuracionSesion: configuracion.sesion,
    servicioPow,
    servicioDisponibilidadRecuperacionPassword
  });
  const controladorRecuperacionPassword = new ControladorRecuperacionPassword({
    servicioInicio: servicioInicioPublicoRecuperacionPassword,
    servicioContinuacion: servicioContinuacionWebRecuperacionPassword,
    servicioSesion,
    superficiePublicaHabilitada: async () =>
      (await servicioDisponibilidadRecuperacionPassword.evaluar()).disponible
  });
  const controladorPortal = new ControladorPortal({
    resolutorScopeUsuario,
    resumenArranque,
    servicioAutorizacion,
    servicioConfiguracionPortal,
    servicioDisponibilidadRecuperacionPassword,
    servicioPresentacionRedPublicaFederacion:
      new ServicioPresentacionRedPublicaFederacion({
        servicioConfiguracionPortal,
        resolutorRedPublicaFederacion
      }),
    servicioCorreoPortal,
    servicioVerificacionCorreoOperativo,
    servicioDashboard,
    servicioGestionAlertasActivasPortal,
    servicioPresentacionAvisosPlataforma,
    servicioAlertasRemotasPortal,
    repositorioTenants,
    repositorioEmpresas,
    repositorioSitios,
    difusorWebSocketPortal
  });
  const controladorOrganizacion = new ControladorOrganizacion({
    servicioJerarquiaOrganizativa
  });
  const controladorUsuarios = new ControladorUsuarios({
    servicioUsuarios,
    servicioAutorizacionPerfil,
    servicioAutogestionPerfil,
    servicioCambioEmailPerfil,
    servicioSesion,
    servicioReinicioPasswordAdministrativo
  });
  const controladorImpersonacion = new ControladorImpersonacion({
    servicioUsuarios,
    servicioSesion
  });
  const controladorMonitores = new ControladorMonitores({
    servicioMonitores,
    servicioLecturaTriggersPortal,
    servicioAdministracionTriggersPortal
  });
  const controladorTriggers = new ControladorTriggers({
    servicioAdministracionTriggersPortal,
    servicioTriggers
  });
  const controladorDns = new ControladorDns({
    servicioLecturaDnsPortal,
    servicioAdministracionDnsPortal,
    servicioAplicacionDdnsAgentes
  });
  const controladorAgentes = new ControladorAgentes({
    servicioAdministracionAgentesPortal,
    servicioAutorizacion,
    servicioAplicacionDdnsAgentes,
    eliminacionAdministrativaAgentesHttpHabilitada:
      activacionEliminacionAdministrativaAgentes.habilitada
  });
  const controladorEliminacionAdministrativaAgentes =
    new ControladorEliminacionAdministrativaAgentes({
      servicioImpacto: servicioImpactoEliminacionAgente,
      servicioAceptacion: servicioAceptacionEliminacionAdministrativaAgente,
      servicioConsultaOperaciones:
        servicioConsultaOperacionesAdministrativas,
      servicioBuzon: servicioBuzonNotificacionesUsuario
    });
  const controladorEliminacionAdministrativaOrganizaciones =
    new ControladorEliminacionAdministrativaOrganizaciones({
      servicioImpacto: servicioImpactoEliminacionOrganizacion,
      servicioAceptacion:
        servicioAceptacionEliminacionAdministrativaOrganizacion
    });
  const controladorReglasDerivacionTelemetria =
    new ControladorReglasDerivacionTelemetria({
      servicioAdministracionReglas:
        servicioAdministracionReglasDerivacionTelemetria,
      servicioMonitores
    });
  const controladorAuditoria = new ControladorAuditoria({
    servicioLecturaAuditoria,
    servicioResolutoresAuditoria
  });
  const controladorApiAgentes = new ControladorApiAgentes({
    servicioAutenticacionAgentes,
    servicioIngestaTelemetriaAgentes,
    servicioConsultaDdnsAgentes,
    servicioAplicacionDdnsAgentes
  });
  const controladorPow = new ControladorPow({
    servicioPow
  });
  const repositorioRelacionesFederacion =
    new RepositorioRelacionesFederacionSql(clienteSql, {
      adaptadorAuditoria: new AdaptadorAuditoriaControlFederacion({
        repositorioAuditoria
      })
    });
  const servicioImportacionFederacion =
    planoControlFederacion.protectorSecretoPersistente
      ? new ServicioImportacionFederacionPortal({
          repositorioImportaciones: new RepositorioImportacionesFederacionSql(
            clienteSql,
            {
              repositorioCredenciales:
                new RepositorioCredencialesPersistentesFederacionSql(clienteSql),
              protectorSecretoPersistente:
                planoControlFederacion.protectorSecretoPersistente,
              adaptadorAuditoriaControl: new AdaptadorAuditoriaControlFederacion({
                repositorioAuditoria
              }),
              adaptadorAuditoriaSeguridad:
                new AdaptadorAuditoriaSeguridadFederacion({ repositorioAuditoria })
            }
          ),
          clienteHttp: new ClienteHttpControlFederacion(),
          installationLocalId: String(planoControlFederacion.identidad.installationId),
          bootLocalId: String(planoControlFederacion.identidad.bootId),
          resolverNombreLocal: async () => {
            await servicioConfiguracionPortal.asegurarActualizada();
            return servicioConfiguracionPortal.obtenerConfiguracionActual()
              .obtenerNombreVisiblePortal();
          },
          productoVersion: '0.1.0',
          guardiaEmision: planoControlFederacion.guardiaEmision
        })
      : null;
  const servicioReconstruccionesManuales =
    new ServicioReconstruccionesManualesFederacion({
      repositorioFlujos: repositorioFlujosReconstruccion,
      repositorioCandidatas:
        new RepositorioGeneracionesCandidatasFederacionSql(clienteSql, {
          installationLocalId,
          adaptadorAuditoriaReconstrucciones:
            new AdaptadorAuditoriaReconstruccionesFederacion({
              repositorioAuditoria
            })
        }),
      servicioCorteInicial: servicioCorteReconstruccion,
      generadorIdentidades: new GeneradorIdentidadesFederadas({
        fuenteEntropia: new FuenteEntropiaCriptograficaNode()
      })
    });
  const servicioExploradorDatosRemotos =
    new ServicioExploradorDatosRemotosFederacion({
      repositorio: new RepositorioExploradorDatosRemotosFederacionSql(clienteSql),
      servicioAutorizacion
    });
  const servicioOrganizacionRemota =
    new ServicioOrganizacionRemotaFederacionPortal({
      repositorio: new RepositorioOrganizacionRemotaPortalSql(clienteSql),
      servicioAutorizacion
    });
  const repositorioMonitoresRemotosPortal =
    new RepositorioMonitoresRemotosPortalSql(clienteSql);
  const repositorioTriggersRemotosPortal =
    new RepositorioTriggersRemotosPortalSql(clienteSql);
  const evaluarCapacidadLocalTriggerFederado = async ({ tipo } = {}) => {
    if (tipo !== 'correo') {
      return Object.freeze({ disponible: true, codigo: 'no_aplicable' });
    }
    try {
      await servicioAdministracionTriggersPortal.exigirCanalYOrigenCorreo();
      return Object.freeze({
        disponible: true,
        codigo: 'capacidad_local_disponible'
      });
    } catch (error) {
      return Object.freeze({
        disponible: false,
        codigo: String(error?.codigo || 'capacidad_local_no_disponible')
      });
    }
  };
  const servicioMonitoresRemotos = new ServicioMonitoresRemotosFederacionPortal({
    repositorio: repositorioMonitoresRemotosPortal,
    repositorioTriggers: repositorioTriggersRemotosPortal,
    servicioAutorizacion
  });
  const servicioTriggersRemotos = new ServicioTriggersRemotosFederacionPortal({
    repositorio: repositorioTriggersRemotosPortal,
    repositorioMonitores: repositorioMonitoresRemotosPortal,
    servicioAutorizacion,
    evaluarCapacidadLocalTrigger: evaluarCapacidadLocalTriggerFederado
  });
  const servicioTelemetriaRemota = new ServicioTelemetriaRemotaFederacionPortal({
    repositorio: new RepositorioTelemetriaRemotaPortalSql(clienteSql),
    servicioAutorizacion
  });
  const servicioBorradoresLocales = new ServicioBorradoresLocalesFederacion({
    repositorioMonitoresRemotos: new RepositorioMonitoresRemotoSql(clienteSql),
    repositorioTriggersInformativosRemotos:
      new RepositorioTriggersInformativosRemotoSql(clienteSql),
    autorizarLecturaProyeccion: async ({
      contextoUsuarioActual,
      proyeccionId,
      familia
    }) => {
      const resultado = await servicioExploradorDatosRemotos.obtener(
        contextoUsuarioActual,
        { familia, proyeccionId, pagina: 1, limite: 1 }
      );
      return resultado.elementos.length === 1 &&
        resultado.elementos[0].proyeccionId === String(proyeccionId) &&
        resultado.elementos[0].familia === familia;
    },
    evaluarCapacidadLocalTrigger: evaluarCapacidadLocalTriggerFederado
  });
  const controladorFederacion = new ControladorFederacion({
    servicioAdministracionFederacion: new ServicioAdministracionFederacionPortal({
      repositorioRelaciones: repositorioRelacionesFederacion,
      servicioInvitaciones: servicioInvitacionesFederacion,
      servicioConfirmacionIdentidad:
        planoControlFederacion.servicioConfirmacionIdentidad,
      servicioContinuidad: planoControlFederacion.servicioContinuidad,
      servicioImportacion: servicioImportacionFederacion,
      servicioControl: new ServicioControlFederacion({
        repositorioControl: repositorioControlFederacion
      }),
      servicioConsolidacion: servicioConsolidacionConcesionFederacion,
      servicioSincronizacion: servicioSincronizacionConcesionFederacion,
      servicioConflictos: planoControlFederacion.servicioConflictos,
      guardiaActivacion: planoControlFederacion.guardiaActivacion,
      servicioAutorizacion,
      generadorIdentidades: new GeneradorIdentidadesFederadas({
        fuenteEntropia: new FuenteEntropiaCriptograficaNode()
      }),
      installationId: String(planoControlFederacion.identidad.installationId),
      bootId: String(planoControlFederacion.identidad.bootId)
    }),
    servicioExploradorDatosRemotos,
    servicioOrganizacionRemota,
    servicioMonitoresRemotos,
    servicioTriggersRemotos,
    servicioTelemetriaRemota,
    servicioAlertasRemotasPortal,
    servicioAvisosFederadosRemotos:
      new ServicioAvisosFederadosRemotosPortal({
        repositorio: new RepositorioAvisosFederadosRemotoSql(clienteSql),
        servicioAutorizacion
      }),
    servicioAuditoriaRemota: new ServicioAuditoriaRemotaFederacionPortal({
      repositorio: new RepositorioAuditoriaRemotaSql(clienteSql),
      servicioAutorizacion
    }),
    servicioDiagnosticoFederacion: new ServicioDiagnosticoFederacionPortal({
      repositorio: new RepositorioDiagnosticoFederacionPortalSql(clienteSql),
      servicioAutorizacion,
      servicioConfiguracionPortal
    }),
    servicioBorradoresFederacion: new ServicioBorradoresFederacionPortal({
      servicioBorradores: servicioBorradoresLocales
    }),
    servicioReconstruccionesFederacion:
      new ServicioReconstruccionesFederacionPortal({
        clienteSql,
        servicioReconstrucciones: servicioReconstruccionesManuales,
        servicioAutorizacion
      })
  });

  const aplicacion = crearAplicacion({
    configuracion,
    resumenArranque,
    sessionMiddleware,
    servicioSesion,
    controladorLogin,
    controladorRecuperacionPassword,
    controladorPortal,
    controladorOrganizacion,
    controladorUsuarios,
    controladorImpersonacion,
    controladorMonitores,
    controladorTriggers,
    controladorDns,
    controladorAgentes,
    controladorEliminacionAdministrativaAgentes,
    controladorEliminacionAdministrativaOrganizaciones,
    controladorReglasDerivacionTelemetria,
    controladorAuditoria,
    controladorFederacion,
    controladorApiAgentes,
    controladorApiFederacion,
    controladorDatosFederacion,
    middlewareAutenticacionDatosFederacion,
    middlewareInterpretacionLoteFederacion,
    controladorPow,
    controladorDesuscripcionTriggerCorreo,
    estadoRedis,
    servicioContextoUsuario,
    servicioAutorizacion,
    servicioConfiguracionPortal,
    servicioCorreoPortal,
    resolutorRedPublicaFederacion,
    guardiaRecepcionFederacion: planoControlFederacion.guardiaRecepcion,
    ddnsAgentesHabilitado,
    eliminacionAdministrativaAgentesHttpHabilitada:
      activacionEliminacionAdministrativaAgentes.habilitada,
    eliminacionAdministrativaOrganizacionesHttpHabilitada:
      activacionEliminacionAdministrativaOrganizaciones.habilitada
  });
  const servidorHttp = http.createServer(aplicacion);
  const observadorDashboardRedis = new ObservadorDashboardRedis({
    clienteRedis,
    claveDashboard: `${configuracion.runtime.redisPrefijo}dashboard`,
    difusorWebSocketPortal
  });
  const observadorAvisosPlataformaSql = new ObservadorAvisosPlataformaSql({
    repositorio: repositorioPresentacionAvisosPlataforma,
    difusorWebSocketPortal
  });
  const observadorAlertasRemotasSql = new ObservadorAlertasRemotasSql({
    repositorio: repositorioAlertasRemotasPortal,
    difusorWebSocketPortal
  });

  servidorHttp.on('upgrade', (requisicion, socket, head) => {
    void (async () => {
      try {
        await resolutorRedPublicaFederacion.prepararUpgrade(requisicion);
        if (atenderUpgradeDatosFederacion(requisicion, socket)) return;
        await difusorWebSocketPortal.atenderUpgrade(requisicion, socket, head);
      } catch (error) {
        console.error('[sentinelia-web] No se pudo resolver la red pública antes del upgrade.');
        console.error(error);
        socket.destroy();
      }
    })();
  });

  await observadorDashboardRedis.arrancar();
  await observadorAvisosPlataformaSql.arrancar();
  await observadorAlertasRemotasSql.arrancar();
  await canalInvalidacionesSesionesWeb.suscribir((ids) =>
    registroWebSocketsSesionesWeb.procesarInvalidacion(ids)
  );
  await canalInvalidacionesBuzonUsuarios.suscribir((invalidacion) =>
    difusorWebSocketPortal.emitirBuzonUsuarioActualizado(invalidacion)
  );
  registroWebSocketsSesionesWeb.iniciar();

  servidorHttp.listen(configuracion.web.puerto, () => {
    console.log(
      `[sentinelia-web] escuchando en puerto ${configuracion.web.puerto}`
    );
    console.log(
      `[sentinelia-web] SQL configurado: ${configuracion.sql.estaCompleta ? 'si' : 'no'}`
    );
    console.log(`[sentinelia-web] Redis: ${estadoRedis}`);
    console.log(
      `[sentinelia-web] ${resumenArranque.migraciones.mensaje}`
    );
    if (resumenArranque.migraciones.usoHorarioUtc) {
      console.log(
        `[sentinelia-web] SQL UTC verificado. session=${resumenArranque.migraciones.usoHorarioUtc.sessionTimeZone} global=${resumenArranque.migraciones.usoHorarioUtc.globalTimeZone} diferencia=${resumenArranque.migraciones.usoHorarioUtc.diferenciaSegundos}s`
      );
    }
    console.log(
      `[sentinelia-web] ${resumenArranque.configuracionPortal.mensaje}`
    );
    console.log(
      `[sentinelia-web] ${resumenArranque.sesionesTecnicasAgentes.mensaje}`
    );
    console.log(
      `[sentinelia-web] ${resumenArranque.keyringTecnicoCorreo.mensaje}`
    );
    console.log(
      `[sentinelia-web] Eliminación administrativa de agentes: ${activacionEliminacionAdministrativaAgentes.codigo}`
    );
    console.log(
      `[sentinelia-web] Trigger de correo: perfil=${resumenArranque.despliegueTriggerCorreo.perfil} unanimidad=si gate=${resumenArranque.despliegueTriggerCorreo.gateAbierto ? 'abierto' : 'cerrado'}`
    );
    console.log(
      `[sentinelia-web] Momento UTC relativo: perfil=${resumenArranque.despliegueMomentoUtcRelativo.perfil} unanimidad=si gate=abierto runtimes=${resumenArranque.despliegueMomentoUtcRelativo.instanciasRuntimeCompatibles}`
    );
    console.log(
      `[sentinelia-web] DDNS de agentes: solicitado=${configuracion.agentes.ddnsHabilitado ? 'si' : 'no'} ` +
      `gate=${ddnsAgentesHabilitado ? 'abierto' : 'cerrado'} codigo=${resumenArranque.despliegueDdnsAgentes.codigo}`
    );
    console.log(
      `[sentinelia-web] ${resumenArranque.usuarioInicial.mensaje}`
    );
    console.log(
      `[sentinelia-web] WebSocket dashboard listo en /ws/panel-dashboard`
    );
  });
  const temporizadorCorteColaCorreo = setInterval(() => {
    void avanzarCorteAutoridadColaCorreo().then((resultado) => {
      if (resultado.activacion?.fase === 'publicada') {
        clearInterval(temporizadorCorteColaCorreo);
      }
    }).catch((error) => {
      console.error('[sentinelia-web] No se pudo avanzar el corte de cola de correo.');
      console.error(error);
    });
  }, 5_000);
  temporizadorCorteColaCorreo.unref?.();
}

arrancar().catch((error) => {
  console.error('[sentinelia-web] Error fatal de arranque');
  console.error(error);
  process.exit(1);
});

async function bloquearCatalogoDnsEnTransaccion({ conexion }) {
  await conexion.execute('SELECT id FROM zonas_dns ORDER BY id FOR UPDATE');
  await conexion.execute(
    'SELECT id FROM registros_dns ORDER BY zona_id, id FOR UPDATE'
  );
}
