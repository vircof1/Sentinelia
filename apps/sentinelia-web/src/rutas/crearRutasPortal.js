import { Router } from 'express';
import { crearMiddlewareRequerirAutenticacion } from '../middleware/requerirAutenticacion.js';
import {
  construirCapacidadesNavegacion,
  crearMiddlewareCargarContextoUsuario
} from '../middleware/cargarContextoUsuario.js';
import { crearMiddlewareRequerirPermiso } from '../middleware/requerirPermiso.js';
import { crearMiddlewareValidarCsrfPortal } from '../middleware/validarCsrfPortal.js';
import {
  crearMiddlewareRequerirCapacidadEliminacionAdministrativaAgentes
} from '../middleware/requerirCapacidadEliminacionAdministrativaAgentes.js';
import {
  crearMiddlewareRequerirCapacidadEliminacionAdministrativaOrganizaciones
} from '../middleware/requerirCapacidadEliminacionAdministrativaOrganizaciones.js';

export function crearRutasPortal({
  controladorLogin,
  controladorRecuperacionPassword = null,
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
  servicioSesion,
  controladorPow,
  controladorDesuscripcionTriggerCorreo,
  servicioContextoUsuario,
  servicioAutorizacion,
  ddnsAgentesHabilitado = false,
  eliminacionAdministrativaAgentesHttpHabilitada = false,
  eliminacionAdministrativaOrganizacionesHttpHabilitada = false
}) {
  const router = Router();
  const validarCsrfPortal = crearMiddlewareValidarCsrfPortal();
  const requerirAutenticacion = crearMiddlewareRequerirAutenticacion({
    servicioSesion
  });
  const cargarContextoUsuario = crearMiddlewareCargarContextoUsuario({
    servicioContextoUsuario,
    servicioSesion,
    servicioAutorizacion
  });
  const cargarContextoUsuarioOpcional = async (requisicion, respuesta, next) => {
    if (!requisicion.session?.usuarioAutenticado) {
      next();
      return;
    }

    try {
      const sesionVigente = await servicioSesion.validarVersionSesion(requisicion);
      if (!sesionVigente) {
        await servicioSesion.destruirSesion(requisicion);
        next();
        return;
      }

      const contextoUsuarioActual =
        await servicioContextoUsuario.cargarDesdeSesion(requisicion);
      if (!contextoUsuarioActual) {
        await servicioSesion.destruirSesion(requisicion);
        next();
        return;
      }

      requisicion.contextoUsuarioActual = contextoUsuarioActual;
      respuesta.locals.contextoUsuarioActual = contextoUsuarioActual;
      respuesta.locals.capacidadesNavegacion = construirCapacidadesNavegacion({
        servicioAutorizacion,
        contextoUsuarioActual
      });
      next();
    } catch (error) {
      next(error);
    }
  };
  const requerirVer = crearMiddlewareRequerirPermiso({
    servicioAutorizacion,
    permiso: 'ver'
  });
  const requerirVerMonitores = crearMiddlewareRequerirPermiso({
    servicioAutorizacion,
    permiso: 'ver_monitores'
  });
  const requerirVerTriggers = crearMiddlewareRequerirPermiso({
    servicioAutorizacion,
    permiso: 'ver_triggers'
  });
  const requerirVerDns = crearMiddlewareRequerirPermiso({
    servicioAutorizacion,
    permiso: 'ver_dns'
  });
  const requerirEditarDns = crearMiddlewareRequerirPermiso({
    servicioAutorizacion,
    permiso: 'editar_dns'
  });
  const requerirEditar = crearMiddlewareRequerirPermiso({
    servicioAutorizacion,
    permiso: 'editar'
  });
  const requerirEditarTriggers = crearMiddlewareRequerirPermiso({
    servicioAutorizacion,
    permiso: 'editar_triggers'
  });
  const requerirGestionarVinculosTriggers = crearMiddlewareRequerirPermiso({
    servicioAutorizacion,
    permiso: 'gestionar_vinculos_triggers'
  });
  const requerirGestionarDescartesAlertasActivas =
    crearMiddlewareRequerirPermiso({
      servicioAutorizacion,
      permiso: 'gestionar_descartes_alertas_activas'
    });
  const requerirAdministrarUsuarios = crearMiddlewareRequerirPermiso({
    servicioAutorizacion,
    permiso: 'administrar_usuarios'
  });
  const requerirAdministrarConfiguracion = crearMiddlewareRequerirPermiso({
    servicioAutorizacion,
    permiso: 'administrar_configuracion'
  });
  const requerirAdministrarTenants = crearMiddlewareRequerirPermiso({
    servicioAutorizacion,
    permiso: 'administrar_tenants'
  });
  const requerirAdministrarEmpresas = crearMiddlewareRequerirPermiso({
    servicioAutorizacion,
    permiso: 'administrar_empresas'
  });
  const requerirAdministrarSitios = crearMiddlewareRequerirPermiso({
    servicioAutorizacion,
    permiso: 'administrar_sitios'
  });
  const requerirVerAgentes = crearMiddlewareRequerirPermiso({
    servicioAutorizacion,
    permiso: 'ver_agentes'
  });
  const requerirVerAuditoria = crearMiddlewareRequerirPermiso({
    servicioAutorizacion,
    permiso: 'ver_auditoria'
  });
  const requerirModificarAgentes = crearMiddlewareRequerirPermiso({
    servicioAutorizacion,
    permiso: 'modificar_agentes'
  });
  const requerirAdministrarDnsAvanzado = crearMiddlewareRequerirPermiso({
    servicioAutorizacion,
    permiso: 'administrar_dns_avanzado'
  });
  const requerirEliminarAgentes = crearMiddlewareRequerirPermiso({
    servicioAutorizacion,
    permiso: 'eliminar_agentes'
  });
  const requerirEliminacionAdministrativaAgentesHttp =
    crearMiddlewareRequerirCapacidadEliminacionAdministrativaAgentes({
      habilitada: eliminacionAdministrativaAgentesHttpHabilitada
    });
  const requerirEliminacionAdministrativaOrganizacionesHttp =
    crearMiddlewareRequerirCapacidadEliminacionAdministrativaOrganizaciones({
      habilitada: eliminacionAdministrativaOrganizacionesHttpHabilitada
    });
  const controladorEliminacionOrganizaciones =
    resolverControladorEliminacionOrganizaciones({
      controlador: controladorEliminacionAdministrativaOrganizaciones,
      habilitada: eliminacionAdministrativaOrganizacionesHttpHabilitada
    });
  const requerirOperacionesAdministrativasHttp =
    crearMiddlewareRequerirCapacidadEliminacionAdministrativaAgentes({
      habilitada: eliminacionAdministrativaAgentesHttpHabilitada ||
        eliminacionAdministrativaOrganizacionesHttpHabilitada
    });
  const requerirAccederFederacion = crearMiddlewareRequerirPermiso({
    servicioAutorizacion,
    permiso: 'acceder_federacion'
  });
  const requerirExplorarDatosRemotosFederacion = crearMiddlewareRequerirPermiso({
    servicioAutorizacion,
    permiso: 'explorar_datos_remotos_federacion'
  });
  const requerirVerDiagnosticoFederacion = crearMiddlewareRequerirPermiso({
    servicioAutorizacion,
    permiso: 'ver_diagnostico_federacion'
  });
  const requerirVerAvisosPlataforma = crearMiddlewareRequerirPermiso({
    servicioAutorizacion,
    permiso: 'ver_avisos_plataforma'
  });
  const requerirVerAlertasRemotas = crearMiddlewareRequerirPermiso({
    servicioAutorizacion,
    permiso: 'ver_alertas_remotas'
  });
  const requerirConfigurarRecepcionesFederacion = crearMiddlewareRequerirPermiso({
    servicioAutorizacion,
    permiso: 'configurar_recepciones_federacion'
  });
  const requerirConfigurarEmisionesFederacion = crearMiddlewareRequerirPermiso({
    servicioAutorizacion,
    permiso: 'configurar_emisiones_federacion'
  });
  const requerirGestionarCredencialesFederacion = crearMiddlewareRequerirPermiso({
    servicioAutorizacion,
    permiso: 'gestionar_credenciales_federacion'
  });
  const requerirActivarRelacionesFederacion = crearMiddlewareRequerirPermiso({
    servicioAutorizacion,
    permiso: 'activar_relaciones_federacion'
  });
  const requerirTransferirResponsabilidadFederacion =
    crearMiddlewareRequerirPermiso({
      servicioAutorizacion,
      permiso: 'transferir_responsabilidad_federacion'
    });
  const requerirResolverConflictosFederacion = crearMiddlewareRequerirPermiso({
    servicioAutorizacion,
    permiso: 'resolver_conflictos_federacion'
  });

  router.get(
    '/correo/desuscripcion/:token',
    controladorDesuscripcionTriggerCorreo.mostrarConfirmacion.bind(
      controladorDesuscripcionTriggerCorreo
    )
  );
  router.post(
    '/correo/desuscripcion/:token',
    controladorDesuscripcionTriggerCorreo.procesar.bind(
      controladorDesuscripcionTriggerCorreo
    )
  );

  router.get('/', (requisicion, respuesta) => {
    if (requisicion.session?.usuarioAutenticado) {
      respuesta.redirect('/panel');
      return;
    }

    respuesta.redirect('/login');
  });

  router.get('/login', controladorLogin.mostrarFormulario.bind(controladorLogin));
  if (controladorRecuperacionPassword) {
    router.get(
      '/recuperar-password',
      controladorRecuperacionPassword.mostrarFormulario.bind(
        controladorRecuperacionPassword
      )
    );
    router.get(
      '/recuperacion-password',
      controladorRecuperacionPassword.recibirEnlace.bind(
        controladorRecuperacionPassword
      )
    );
    router.get(
      '/recuperacion-password/continuar',
      controladorRecuperacionPassword.mostrarResolucion.bind(
        controladorRecuperacionPassword
      )
    );
  }
  router.use(function aplicarCsrfPortalAutenticado(requisicion, respuesta, next) {
    if (!requisicion.session?.usuarioAutenticado) {
      next();
      return;
    }

    validarCsrfPortal(requisicion, respuesta, next);
  });
  router.post(
    '/pow/desafio',
    validarCsrfPortal,
    controladorPow.emitirDesafio.bind(controladorPow)
  );
  if (controladorRecuperacionPassword) {
    router.post(
      '/recuperar-password/pow/desafio',
      validarCsrfPortal,
      controladorRecuperacionPassword.emitirDesafio.bind(
        controladorRecuperacionPassword
      )
    );
    router.post(
      '/recuperar-password',
      validarCsrfPortal,
      controladorRecuperacionPassword.procesar.bind(
        controladorRecuperacionPassword
      )
    );
    router.post(
      '/recuperacion-password/continuar',
      validarCsrfPortal,
      controladorRecuperacionPassword.resolverIdentidad.bind(
        controladorRecuperacionPassword
      )
    );
    router.post(
      '/recuperacion-password/password',
      validarCsrfPortal,
      controladorRecuperacionPassword.sustituirPassword.bind(
        controladorRecuperacionPassword
      )
    );
  }
  router.post(
    '/login',
    validarCsrfPortal,
    controladorLogin.procesarLogin.bind(controladorLogin)
  );
  router.get(
    '/cambio-password-obligatorio',
    controladorLogin.mostrarCambioPasswordObligatorio.bind(controladorLogin)
  );
  router.post(
    '/cambio-password-obligatorio',
    validarCsrfPortal,
    controladorLogin.procesarCambioPasswordObligatorio.bind(controladorLogin)
  );
  router.post('/salir', controladorLogin.procesarLogout.bind(controladorLogin));

  router.get(
    '/panel',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirVer,
    controladorPortal.mostrarPanel.bind(controladorPortal)
  );

  router.get(
    '/panel/api/dashboard',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirVer,
    controladorPortal.apiDashboardOperativo.bind(controladorPortal)
  );

  router.get(
    '/avisos-plataforma/api/resumen',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirVerAvisosPlataforma,
    controladorPortal.apiResumenAvisosPlataforma.bind(controladorPortal)
  );
  router.post(
    '/avisos-plataforma/api/:avisoId/reconocer',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirVerAvisosPlataforma,
    controladorPortal.apiReconocerAvisoPlataforma.bind(controladorPortal)
  );
  router.post(
    '/avisos-plataforma/api/:avisoId/ocultar',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirVerAvisosPlataforma,
    controladorPortal.apiOcultarAvisoPlataforma.bind(controladorPortal)
  );
  router.get(
    '/panel/api/alertas-remotas',
    requerirAutenticacion, cargarContextoUsuario, requerirVerAlertasRemotas,
    controladorPortal.apiAlertasRemotas.bind(controladorPortal)
  );
  router.post(
    '/panel/api/alertas-remotas/:proyeccionId/:alertaAuditoriaId/descartar',
    requerirAutenticacion, cargarContextoUsuario, requerirVerAlertasRemotas,
    controladorPortal.apiDescartarAlertaRemota.bind(controladorPortal)
  );
  router.post(
    '/panel/api/alertas-remotas/:proyeccionId/:alertaAuditoriaId/revertir',
    requerirAutenticacion, cargarContextoUsuario, requerirVerAlertasRemotas,
    controladorPortal.apiRevertirDescarteAlertaRemota.bind(controladorPortal)
  );

  router.post(
    '/panel/api/alertas-activas/:monitorId/descartar',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirGestionarDescartesAlertasActivas,
    controladorPortal.apiDescartarAlertaActiva.bind(controladorPortal)
  );

  router.post(
    '/panel/api/alertas-activas/:monitorId/revertir-descarte',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirGestionarDescartesAlertasActivas,
    controladorPortal.apiRevertirDescarteAlertaActiva.bind(controladorPortal)
  );

  router.get(
    '/mi-contexto',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirVer,
    (requisicion, respuesta) => {
      respuesta.json({
        contexto: requisicion.contextoUsuarioActual.serializar()
      });
    }
  );

  router.get(
    '/auditoria',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirVerAuditoria,
    controladorAuditoria.mostrarCronologia.bind(controladorAuditoria)
  );

  router.get(
    '/federacion',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirAccederFederacion,
    controladorFederacion.mostrar.bind(controladorFederacion)
  );

  router.get(
    '/federacion/datos-remotos',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirExplorarDatosRemotosFederacion,
    controladorFederacion.mostrarDatosRemotos.bind(controladorFederacion)
  );

  router.get(
    '/federacion/diagnostico',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirVerDiagnosticoFederacion,
    controladorFederacion.mostrarDiagnostico.bind(controladorFederacion)
  );

  router.get(
    '/federacion/reconstrucciones',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirAccederFederacion,
    controladorFederacion.mostrarReconstrucciones.bind(controladorFederacion)
  );

  router.post(
    '/federacion/datos-remotos/borradores/monitor',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirExplorarDatosRemotosFederacion,
    requerirEditar,
    controladorFederacion.crearBorradorMonitor.bind(controladorFederacion)
  );

  router.post(
    '/federacion/datos-remotos/borradores/trigger',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirExplorarDatosRemotosFederacion,
    requerirEditarTriggers,
    controladorFederacion.crearBorradorTrigger.bind(controladorFederacion)
  );

  router.post(
    '/federacion/reconstrucciones/:flujoId/decidir',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirAccederFederacion,
    controladorFederacion.decidirReconstruccion.bind(controladorFederacion)
  );

  router.post(
    '/federacion/reconstrucciones/:flujoId/candidatas/:generacionId/cancelar',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirAccederFederacion,
    controladorFederacion.cancelarCandidata.bind(controladorFederacion)
  );

  router.post(
    '/federacion/reconstrucciones/:flujoId/candidatas/:generacionId/promover',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirAccederFederacion,
    controladorFederacion.promoverCandidata.bind(controladorFederacion)
  );

  router.post(
    '/federacion/reconstrucciones/:flujoId/candidatas/:generacionId/revalidar',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirAccederFederacion,
    controladorFederacion.revalidarCandidata.bind(controladorFederacion)
  );

  router.post(
    '/federacion/relaciones/recepcion',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirConfigurarRecepcionesFederacion,
    controladorFederacion.crearRecepcion.bind(controladorFederacion)
  );

  router.post(
    '/federacion/importaciones/invitacion',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirConfigurarEmisionesFederacion,
    controladorFederacion.importarInvitacion.bind(controladorFederacion)
  );

  router.post(
    '/federacion/importaciones/recuperacion',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirGestionarCredencialesFederacion,
    requerirConfigurarEmisionesFederacion,
    controladorFederacion.importarRecuperacion.bind(controladorFederacion)
  );

  router.post(
    '/federacion/relaciones/:relacionId/invitaciones',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirGestionarCredencialesFederacion,
    controladorFederacion.emitirInvitacion.bind(controladorFederacion)
  );

  router.post(
    '/federacion/relaciones/:relacionId/invitaciones/revocar',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirGestionarCredencialesFederacion,
    controladorFederacion.revocarInvitacion.bind(controladorFederacion)
  );

  router.post(
    '/federacion/relaciones/:relacionId/confirmar-identidad',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirGestionarCredencialesFederacion,
    controladorFederacion.confirmarIdentidad.bind(controladorFederacion)
  );

  router.post(
    '/federacion/relaciones/:relacionId/recuperaciones',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirGestionarCredencialesFederacion,
    controladorFederacion.emitirRecuperacion.bind(controladorFederacion)
  );

  router.post(
    '/federacion/relaciones/:relacionId/aprobar-localizacion',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirGestionarCredencialesFederacion,
    controladorFederacion.aprobarLocalizacion.bind(controladorFederacion)
  );

  router.post(
    '/federacion/relaciones/:relacionId/transferir-responsabilidad',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirTransferirResponsabilidadFederacion,
    controladorFederacion.transferirResponsabilidad.bind(controladorFederacion)
  );

  router.post(
    '/federacion/relaciones/:relacionId/deshabilitar',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirActivarRelacionesFederacion,
    controladorFederacion.deshabilitarRelacion.bind(controladorFederacion)
  );

  router.post(
    '/federacion/relaciones/:relacionId/eliminar',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirActivarRelacionesFederacion,
    controladorFederacion.eliminarRelacion.bind(controladorFederacion)
  );

  router.post(
    '/federacion/relaciones/:relacionId/concesion/previsualizar',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirAccederFederacion,
    controladorFederacion.previsualizarRevisionConcesion.bind(controladorFederacion)
  );

  router.post(
    '/federacion/relaciones/:relacionId/concesion/confirmar',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirAccederFederacion,
    controladorFederacion.confirmarRevisionConcesion.bind(controladorFederacion)
  );

  router.post(
    '/federacion/relaciones/:relacionId/concesion/sincronizar',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirConfigurarEmisionesFederacion,
    controladorFederacion.sincronizarConcesion.bind(controladorFederacion)
  );

  router.post(
    '/federacion/conflictos/:incidenteId/resolver',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirResolverConflictosFederacion,
    controladorFederacion.resolverConflicto.bind(controladorFederacion)
  );

  router.get(
    '/auditoria/api/eventos',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirVerAuditoria,
    controladorAuditoria.apiListarEventos.bind(controladorAuditoria)
  );

  router.get(
    '/auditoria/api/' + 'correlaciones/:correlacionId/eventos',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirVerAuditoria,
    controladorAuditoria.apiListarEventosCorrelacionados.bind(controladorAuditoria)
  );

  router.get(
    '/auditoria/api/sujetos',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirVerAuditoria,
    controladorAuditoria.apiResolverSujetos.bind(controladorAuditoria)
  );

  router.get(
    '/auditoria/api/actores',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirVerAuditoria,
    controladorAuditoria.apiResolverActores.bind(controladorAuditoria)
  );

  router.get(
    '/auditoria/api/diagnosticos',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirVerAuditoria,
    controladorAuditoria.apiListarDiagnosticos.bind(controladorAuditoria)
  );

  router.post(
    '/auditoria/api/incidentes/:episodioId/reconocer',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirVerAuditoria,
    controladorAuditoria.apiReconocerIncidente.bind(controladorAuditoria)
  );

  router.get(
    '/mi-perfil',
    requerirAutenticacion,
    cargarContextoUsuario,
    controladorUsuarios.mostrarMiPerfil.bind(controladorUsuarios)
  );
  router.post(
    '/mi-perfil/desbloquear',
    requerirAutenticacion,
    cargarContextoUsuario,
    controladorUsuarios.apiDesbloquearPerfil.bind(controladorUsuarios)
  );
  router.post(
    '/mi-perfil/cerrar-edicion',
    requerirAutenticacion,
    cargarContextoUsuario,
    controladorUsuarios.apiCerrarEdicionPerfil.bind(controladorUsuarios)
  );
  router.post(
    '/mi-perfil/nombre-visible',
    requerirAutenticacion,
    cargarContextoUsuario,
    controladorUsuarios.apiActualizarNombreVisiblePerfil.bind(
      controladorUsuarios
    )
  );
  router.post(
    '/mi-perfil/nombre-completo',
    requerirAutenticacion,
    cargarContextoUsuario,
    controladorUsuarios.apiActualizarNombreCompletoPerfil.bind(
      controladorUsuarios
    )
  );
  router.post(
    '/mi-perfil/preferencia-alertas-remotas',
    requerirAutenticacion,
    cargarContextoUsuario,
    controladorUsuarios.apiActualizarPreferenciaAlertasRemotas.bind(controladorUsuarios)
  );
  router.post(
    '/mi-perfil/password',
    requerirAutenticacion,
    cargarContextoUsuario,
    controladorUsuarios.apiCambiarPasswordPerfil.bind(controladorUsuarios)
  );
  router.post(
    '/mi-perfil/email',
    requerirAutenticacion,
    cargarContextoUsuario,
    controladorUsuarios.apiCambiarEmailPerfil.bind(controladorUsuarios)
  );
  router.post(
    '/mi-perfil/email/validar',
    requerirAutenticacion,
    cargarContextoUsuario,
    controladorUsuarios.apiValidarEmailPerfil.bind(controladorUsuarios)
  );
  router.post(
    '/mi-perfil/email/reenviar',
    requerirAutenticacion,
    cargarContextoUsuario,
    controladorUsuarios.apiReenviarValidacionEmailPerfil.bind(
      controladorUsuarios
    )
  );
  router.get(
    '/mi-perfil/email/confirmar/:token',
    cargarContextoUsuarioOpcional,
    controladorUsuarios.abrirConfirmacionEmail.bind(controladorUsuarios)
  );
  router.get(
    '/mi-perfil/email/confirmar',
    requerirAutenticacion,
    cargarContextoUsuario,
    controladorUsuarios.mostrarConfirmacionEmail.bind(controladorUsuarios)
  );
  router.post(
    '/mi-perfil/email/confirmar',
    requerirAutenticacion,
    cargarContextoUsuario,
    controladorUsuarios.apiConfirmarEmailPerfil.bind(controladorUsuarios)
  );

  router.get(
    '/edicion-demo',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirEditar,
    controladorPortal.mostrarEdicionDemo.bind(controladorPortal)
  );

  router.get(
    '/organizacion',
    requerirAutenticacion,
    cargarContextoUsuario,
    controladorOrganizacion.mostrarOrganizacion.bind(controladorOrganizacion)
  );

  router.get(
    '/organizacion/tenants',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirAdministrarTenants,
    controladorOrganizacion.mostrarTenants.bind(controladorOrganizacion)
  );

  router.get(
    '/organizacion/tenants/nuevo',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirAdministrarTenants,
    controladorOrganizacion.mostrarNuevoTenant.bind(controladorOrganizacion)
  );

  router.get(
    '/organizacion/tenants/:id/editar',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirAdministrarTenants,
    controladorOrganizacion.mostrarEditarTenant.bind(controladorOrganizacion)
  );

  router.get(
    '/organizacion/tenants/api/listado',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirAdministrarTenants,
    controladorOrganizacion.apiListarTenants.bind(controladorOrganizacion)
  );

  router.get(
    '/organizacion/empresas',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirAdministrarEmpresas,
    controladorOrganizacion.mostrarEmpresas.bind(controladorOrganizacion)
  );

  router.get(
    '/organizacion/empresas/nueva',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirAdministrarEmpresas,
    controladorOrganizacion.mostrarNuevaEmpresa.bind(controladorOrganizacion)
  );

  router.get(
    '/organizacion/empresas/:id/editar',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirAdministrarEmpresas,
    controladorOrganizacion.mostrarEditarEmpresa.bind(controladorOrganizacion)
  );

  router.get(
    '/organizacion/empresas/api/listado',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirAdministrarEmpresas,
    controladorOrganizacion.apiListarEmpresas.bind(controladorOrganizacion)
  );

  router.get(
    '/organizacion/empresas/api/opciones/tenants',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirAdministrarEmpresas,
    controladorOrganizacion.apiOpcionesTenantsEmpresa.bind(controladorOrganizacion)
  );

  router.get(
    '/organizacion/sitios',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirAdministrarSitios,
    controladorOrganizacion.mostrarSitios.bind(controladorOrganizacion)
  );

  router.get(
    '/organizacion/sitios/nuevo',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirAdministrarSitios,
    controladorOrganizacion.mostrarNuevoSitio.bind(controladorOrganizacion)
  );

  router.get(
    '/organizacion/sitios/:id/editar',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirAdministrarSitios,
    controladorOrganizacion.mostrarEditarSitio.bind(controladorOrganizacion)
  );

  router.get(
    '/organizacion/sitios/api/listado',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirAdministrarSitios,
    controladorOrganizacion.apiListarSitios.bind(controladorOrganizacion)
  );

  router.get(
    '/organizacion/sitios/api/opciones/empresas',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirAdministrarSitios,
    controladorOrganizacion.apiOpcionesEmpresasSitio.bind(controladorOrganizacion)
  );

  router.post(
    '/organizacion/tenants/crear',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirAdministrarTenants,
    controladorOrganizacion.crearTenant.bind(controladorOrganizacion)
  );

  router.post(
    '/organizacion/tenants/actualizar',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirAdministrarTenants,
    controladorOrganizacion.actualizarTenant.bind(controladorOrganizacion)
  );

  router.post(
    '/organizacion/empresas/crear',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirAdministrarEmpresas,
    controladorOrganizacion.crearEmpresa.bind(controladorOrganizacion)
  );

  router.post(
    '/organizacion/empresas/actualizar',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirAdministrarEmpresas,
    controladorOrganizacion.actualizarEmpresa.bind(controladorOrganizacion)
  );

  router.get(
    '/organizacion/empresas/:id/impacto-cambio-tenant',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirAdministrarEmpresas,
    controladorOrganizacion.apiImpactoCambioTenantEmpresa.bind(controladorOrganizacion)
  );

  router.post(
    '/organizacion/sitios/crear',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirAdministrarSitios,
    controladorOrganizacion.crearSitio.bind(controladorOrganizacion)
  );

  router.post(
    '/organizacion/sitios/actualizar',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirAdministrarSitios,
    controladorOrganizacion.actualizarSitio.bind(controladorOrganizacion)
  );

  router.get(
    '/organizacion/sitios/:id/impacto-cambio-empresa',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirAdministrarSitios,
    controladorOrganizacion.apiImpactoCambioEmpresaSitio.bind(controladorOrganizacion)
  );

  router.get(
    '/usuarios',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirAdministrarUsuarios,
    controladorUsuarios.mostrarUsuarios.bind(controladorUsuarios)
  );

  router.get(
    '/usuarios/nuevo',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirAdministrarUsuarios,
    controladorUsuarios.mostrarNuevoUsuario.bind(controladorUsuarios)
  );

  router.get(
    '/usuarios/editar/:id',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirAdministrarUsuarios,
    controladorUsuarios.mostrarEditarUsuario.bind(controladorUsuarios)
  );

  router.get(
    '/usuarios/api/listado',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirAdministrarUsuarios,
    controladorUsuarios.apiListarUsuarios.bind(controladorUsuarios)
  );

  router.get(
    '/usuarios/api/opciones/empresas',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirAdministrarUsuarios,
    controladorUsuarios.apiOpcionesEmpresas.bind(controladorUsuarios)
  );

  router.get(
    '/usuarios/api/opciones/sitios',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirAdministrarUsuarios,
    controladorUsuarios.apiOpcionesSitios.bind(controladorUsuarios)
  );

  router.post(
    '/usuarios/api/crear',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirAdministrarUsuarios,
    controladorUsuarios.apiCrearUsuario.bind(controladorUsuarios)
  );

  router.post(
    '/usuarios/api/:id/actualizar',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirAdministrarUsuarios,
    controladorUsuarios.apiActualizarUsuario.bind(controladorUsuarios)
  );

  router.post(
    '/usuarios/api/:id/reiniciar-password',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirAdministrarUsuarios,
    controladorUsuarios.apiReiniciarPasswordAdministrativo.bind(
      controladorUsuarios
    )
  );

  router.post(
    '/usuarios/api/:id/eliminar',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirAdministrarUsuarios,
    controladorUsuarios.apiEliminarUsuario.bind(controladorUsuarios)
  );

  router.get(
    '/impersonacion/api/usuarios',
    requerirAutenticacion,
    cargarContextoUsuario,
    controladorImpersonacion.apiBuscarUsuariosImpersonables.bind(
      controladorImpersonacion
    )
  );

  router.post(
    '/impersonacion/api/iniciar',
    requerirAutenticacion,
    cargarContextoUsuario,
    controladorImpersonacion.apiIniciarImpersonacion.bind(
      controladorImpersonacion
    )
  );

  router.post(
    '/impersonacion/api/revertir',
    requerirAutenticacion,
    cargarContextoUsuario,
    controladorImpersonacion.apiRevertirImpersonacion.bind(
      controladorImpersonacion
    )
  );

  router.get(
    '/agentes',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirVerAgentes,
    controladorAgentes.mostrarListado.bind(controladorAgentes)
  );

  router.get(
    '/agentes/nuevo',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirModificarAgentes,
    controladorAgentes.mostrarNuevo.bind(controladorAgentes)
  );

  router.get(
    '/agentes/openapi',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirVerAgentes,
    controladorAgentes.mostrarContratoOpenApi.bind(controladorAgentes)
  );

  router.get(
    '/agentes/openapi.yaml',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirVerAgentes,
    controladorAgentes.servirContratoOpenApiYaml.bind(controladorAgentes)
  );

  router.get(
    '/agentes/api/listado',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirVerAgentes,
    controladorAgentes.apiListarAgentes.bind(controladorAgentes)
  );

  router.get(
    '/api/organizacion/:tipo/:id/eliminacion',
    requerirEliminacionAdministrativaOrganizacionesHttp,
    requerirAutenticacion,
    cargarContextoUsuario,
    controladorEliminacionOrganizaciones.obtenerImpacto.bind(
      controladorEliminacionOrganizaciones
    )
  );

  router.post(
    '/api/organizacion/:tipo/:id/eliminacion',
    requerirEliminacionAdministrativaOrganizacionesHttp,
    requerirAutenticacion,
    cargarContextoUsuario,
    controladorEliminacionOrganizaciones.aceptar.bind(
      controladorEliminacionOrganizaciones
    )
  );

  router.get(
    '/api/operaciones-administrativas/:operacionId',
    requerirOperacionesAdministrativasHttp,
    requerirAutenticacion,
    cargarContextoUsuario,
    controladorEliminacionAdministrativaAgentes.obtenerOperacion.bind(
      controladorEliminacionAdministrativaAgentes
    )
  );

  router.get(
    '/operaciones-administrativas/:operacionId',
    requerirOperacionesAdministrativasHttp,
    requerirAutenticacion,
    cargarContextoUsuario,
    controladorEliminacionAdministrativaAgentes.mostrarOperacion.bind(
      controladorEliminacionAdministrativaAgentes
    )
  );

  router.get(
    '/buzon/api/notificaciones',
    requerirOperacionesAdministrativasHttp,
    requerirAutenticacion,
    cargarContextoUsuario,
    controladorEliminacionAdministrativaAgentes.listarBuzon.bind(
      controladorEliminacionAdministrativaAgentes
    )
  );

  router.get(
    '/buzon/api/contador',
    requerirOperacionesAdministrativasHttp,
    requerirAutenticacion,
    cargarContextoUsuario,
    controladorEliminacionAdministrativaAgentes.resumirBuzon.bind(
      controladorEliminacionAdministrativaAgentes
    )
  );

  router.post(
    '/buzon/api/notificaciones/:notificacionId/leer',
    requerirOperacionesAdministrativasHttp,
    requerirAutenticacion,
    cargarContextoUsuario,
    controladorEliminacionAdministrativaAgentes.marcarNotificacionLeida.bind(
      controladorEliminacionAdministrativaAgentes
    )
  );

  router.get(
    '/agentes/:id/eliminar',
    requerirEliminacionAdministrativaAgentesHttp,
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirEliminarAgentes,
    controladorEliminacionAdministrativaAgentes.obtenerImpacto.bind(
      controladorEliminacionAdministrativaAgentes
    )
  );

  router.post(
    '/agentes/:id/eliminar',
    requerirEliminacionAdministrativaAgentesHttp,
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirEliminarAgentes,
    controladorEliminacionAdministrativaAgentes.aceptar.bind(
      controladorEliminacionAdministrativaAgentes
    )
  );

  router.get(
    '/agentes/:id/telemetria/api/historico',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirVerAgentes,
    controladorAgentes.apiHistoricoTelemetria.bind(controladorAgentes)
  );

  router.get(
    '/agentes/:id/telemetria/api/miniatura',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirVerAgentes,
    controladorAgentes.apiMiniaturaTelemetria.bind(controladorAgentes)
  );

  router.get(
    '/agentes/:id/telemetria',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirVerAgentes,
    controladorAgentes.mostrarTelemetria.bind(controladorAgentes)
  );

  router.get(
    '/agentes/:id/reglas',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirVerAgentes,
    controladorReglasDerivacionTelemetria.mostrarListado.bind(
      controladorReglasDerivacionTelemetria
    )
  );

  router.get(
    '/agentes/:id/reglas/:reglaId',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirVerAgentes,
    controladorReglasDerivacionTelemetria.mostrarDetalle.bind(
      controladorReglasDerivacionTelemetria
    )
  );

  router.post(
    '/agentes/:id/reglas/previsualizar',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirModificarAgentes,
    controladorReglasDerivacionTelemetria.previsualizarCondicion.bind(
      controladorReglasDerivacionTelemetria
    )
  );

  router.post(
    '/agentes/:id/reglas/crear',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirModificarAgentes,
    controladorReglasDerivacionTelemetria.crearRegla.bind(
      controladorReglasDerivacionTelemetria
    )
  );

  router.post(
    '/agentes/:id/reglas/:reglaId/revisiones',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirModificarAgentes,
    controladorReglasDerivacionTelemetria.crearRevision.bind(
      controladorReglasDerivacionTelemetria
    )
  );

  router.post(
    '/agentes/:id/reglas/:reglaId/activar',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirModificarAgentes,
    controladorReglasDerivacionTelemetria.activarRegla.bind(
      controladorReglasDerivacionTelemetria
    )
  );

  router.post(
    '/agentes/:id/reglas/:reglaId/desactivar',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirModificarAgentes,
    controladorReglasDerivacionTelemetria.desactivarRegla.bind(
      controladorReglasDerivacionTelemetria
    )
  );

  router.get(
    '/agentes/:id/editar',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirModificarAgentes,
    controladorAgentes.mostrarEditar.bind(controladorAgentes)
  );

  router.post(
    '/agentes/crear',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirModificarAgentes,
    controladorAgentes.crearAgente.bind(controladorAgentes)
  );

  if (ddnsAgentesHabilitado === true) {
    router.post(
      '/agentes/:id/ddns/concesiones',
      requerirAutenticacion,
      cargarContextoUsuario,
      requerirModificarAgentes,
      requerirAdministrarDnsAvanzado,
      controladorAgentes.crearConcesionDdns.bind(controladorAgentes)
    );

    router.post(
      '/agentes/:id/ddns/:concesionId/revocar',
      requerirAutenticacion,
      cargarContextoUsuario,
      requerirModificarAgentes,
      controladorAgentes.revocarConcesionDdns.bind(controladorAgentes)
    );
  }

  router.post(
    '/agentes/:id/actualizar',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirModificarAgentes,
    controladorAgentes.actualizarAgente.bind(controladorAgentes)
  );

  router.post(
    '/agentes/:id/perfil-servidor/solicitar',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirModificarAgentes,
    controladorAgentes.solicitarPerfilServidor.bind(controladorAgentes)
  );

  router.post(
    '/agentes/:id/perfil-servidor/configuracion',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirModificarAgentes,
    controladorAgentes.actualizarConfiguracionPerfilServidor.bind(
      controladorAgentes
    )
  );

  router.post(
    '/agentes/:id/perfil-servidor/retirar',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirModificarAgentes,
    controladorAgentes.retirarPerfilServidor.bind(controladorAgentes)
  );

  router.post(
    '/agentes/:id/rotar-secreto',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirModificarAgentes,
    controladorAgentes.rotarSecreto.bind(controladorAgentes)
  );

  router.post(
    '/agentes/:id/deshabilitar',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirModificarAgentes,
    controladorAgentes.deshabilitarAgente.bind(controladorAgentes)
  );

  router.post(
    '/agentes/:id/habilitar',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirModificarAgentes,
    controladorAgentes.habilitarAgente.bind(controladorAgentes)
  );

  router.get(
    '/impersonacion/api/opciones/tenants',
    requerirAutenticacion,
    cargarContextoUsuario,
    controladorImpersonacion.apiOpcionesTenants.bind(
      controladorImpersonacion
    )
  );

  router.get(
    '/impersonacion/api/opciones/empresas',
    requerirAutenticacion,
    cargarContextoUsuario,
    controladorImpersonacion.apiOpcionesEmpresas.bind(
      controladorImpersonacion
    )
  );

  router.get(
    '/impersonacion/api/opciones/sitios',
    requerirAutenticacion,
    cargarContextoUsuario,
    controladorImpersonacion.apiOpcionesSitios.bind(
      controladorImpersonacion
    )
  );

  router.get(
    '/monitores',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirVerMonitores,
    controladorMonitores.mostrarMonitores.bind(controladorMonitores)
  );

  router.get(
    '/monitores/eventos',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirVerMonitores,
    controladorMonitores.mostrarVisorEventos.bind(controladorMonitores)
  );

  router.get(
    '/monitores/comparar-eventos',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirVerMonitores,
    controladorMonitores.mostrarComparadorEventos.bind(controladorMonitores)
  );

  router.get(
    '/automatizacion/acciones',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirVerTriggers,
    controladorTriggers.mostrarAcciones.bind(controladorTriggers)
  );

  router.get(
    '/automatizacion/enlaces',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirVerTriggers,
    requerirVerMonitores,
    controladorTriggers.mostrarEnlaces.bind(controladorTriggers)
  );

  router.get(
    '/monitores/triggers',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirVerTriggers,
    controladorTriggers.mostrarListado.bind(controladorTriggers)
  );

  router.get(
    '/monitores/triggers/api/listado',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirVerTriggers,
    controladorTriggers.apiListarTriggers.bind(controladorTriggers)
  );

  router.get(
    '/monitores/triggers/api/vinculos',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirVerTriggers,
    requerirVerMonitores,
    controladorTriggers.apiListarVinculos.bind(controladorTriggers)
  );

  router.get(
    '/monitores/triggers/api/dns-objetivos',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirEditarTriggers,
    controladorTriggers.apiBuscarObjetivosDns.bind(controladorTriggers)
  );

  router.get(
    '/monitores/triggers/:id/correo/usuarios',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirEditarTriggers,
    controladorTriggers.apiBuscarUsuariosCorreo.bind(controladorTriggers)
  );

  router.post(
    '/monitores/triggers/:id/correo/audiencia',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirEditarTriggers,
    controladorTriggers.apiMutarAudienciaCorreo.bind(controladorTriggers)
  );

  router.post(
    '/monitores/triggers/correo/previsualizar',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirEditarTriggers,
    controladorTriggers.apiPrevisualizarCorreo.bind(controladorTriggers)
  );

  router.post(
    '/monitores/triggers/:id/correo/previsualizar',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirEditarTriggers,
    controladorTriggers.apiPrevisualizarCorreo.bind(controladorTriggers)
  );

  router.post(
    '/monitores/triggers/:id/correo/probar',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirEditarTriggers,
    controladorTriggers.probarCorreo.bind(controladorTriggers)
  );

  router.get(
    '/monitores/triggers/correo/ejecuciones/:ejecucionId',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirVerTriggers,
    controladorTriggers.apiDetalleCorreo.bind(controladorTriggers)
  );

  router.get(
    '/monitores/triggers/api/monitores-vinculo',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirVerTriggers,
    requerirVerMonitores,
    requerirGestionarVinculosTriggers,
    controladorTriggers.apiBuscarMonitoresVinculo.bind(controladorTriggers)
  );

  router.get(
    '/monitores/triggers/api/triggers-vinculo',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirVerTriggers,
    requerirVerMonitores,
    requerirGestionarVinculosTriggers,
    controladorTriggers.apiBuscarTriggersVinculo.bind(controladorTriggers)
  );

  router.get(
    '/monitores/triggers/nuevo',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirEditarTriggers,
    controladorTriggers.mostrarNuevo.bind(controladorTriggers)
  );

  router.get(
    '/monitores/triggers/editar/:id',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirEditarTriggers,
    controladorTriggers.mostrarEditar.bind(controladorTriggers)
  );

  router.post(
    '/monitores/triggers/crear',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirEditarTriggers,
    controladorTriggers.crearTrigger.bind(controladorTriggers)
  );

  router.post(
    '/monitores/triggers/:id/actualizar',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirEditarTriggers,
    controladorTriggers.actualizarTrigger.bind(controladorTriggers)
  );

  router.post(
    '/monitores/triggers/eliminar',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirEditarTriggers,
    controladorTriggers.eliminarTrigger.bind(controladorTriggers)
  );

  router.get(
    '/monitores/triggers/vinculos/nuevo',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirVerTriggers,
    requerirVerMonitores,
    requerirGestionarVinculosTriggers,
    controladorTriggers.mostrarNuevoVinculo.bind(controladorTriggers)
  );

  router.post(
    '/monitores/triggers/vinculos/crear',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirVerTriggers,
    requerirVerMonitores,
    requerirGestionarVinculosTriggers,
    controladorTriggers.crearVinculo.bind(controladorTriggers)
  );

  router.get(
    '/monitores/triggers/vinculos/editar/:id',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirVerTriggers,
    requerirVerMonitores,
    requerirGestionarVinculosTriggers,
    controladorTriggers.mostrarEditarVinculo.bind(controladorTriggers)
  );

  router.post(
    '/monitores/triggers/vinculos/:id/actualizar',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirVerTriggers,
    requerirVerMonitores,
    requerirGestionarVinculosTriggers,
    controladorTriggers.actualizarVinculo.bind(controladorTriggers)
  );

  router.post(
    '/monitores/triggers/vinculos/eliminar',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirVerTriggers,
    requerirVerMonitores,
    requerirGestionarVinculosTriggers,
    controladorTriggers.eliminarVinculo.bind(controladorTriggers)
  );

  router.get(
    '/monitores/historico',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirVerMonitores,
    controladorMonitores.mostrarHistorico.bind(controladorMonitores)
  );

  router.get(
    '/monitores/api/listado',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirVerMonitores,
    controladorMonitores.apiListarMonitores.bind(controladorMonitores)
  );

  router.get(
    '/monitores/eventos/api',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirVerMonitores,
    controladorMonitores.apiListarEventos.bind(controladorMonitores)
  );

  router.get(
    '/monitores/eventos/api/hitos',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirVerMonitores,
    controladorMonitores.apiHitosEventos.bind(controladorMonitores)
  );

  router.get(
    '/monitores/eventos/api/opciones/monitores',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirVerMonitores,
    controladorMonitores.apiOpcionesEventosMonitores.bind(controladorMonitores)
  );

  router.get(
    '/monitores/comparar-eventos/api',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirVerMonitores,
    controladorMonitores.apiCompararEventos.bind(controladorMonitores)
  );

  router.get(
    '/monitores/comparar-eventos/api/opciones/monitores',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirVerMonitores,
    controladorMonitores.apiOpcionesComparadorEventos.bind(controladorMonitores)
  );

  router.get(
    '/monitores/historico/api',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirVerMonitores,
    controladorMonitores.apiListarHistorico.bind(controladorMonitores)
  );

  router.get(
    '/monitores/historico/api/opciones/monitores',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirVerMonitores,
    controladorMonitores.apiOpcionesHistoricoMonitores.bind(controladorMonitores)
  );

  router.get(
    '/monitores/nuevo',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirEditar,
    controladorMonitores.mostrarNuevoMonitor.bind(controladorMonitores)
  );

  router.get(
    '/monitores/telemetria/api/fuentes',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirEditar,
    controladorMonitores.apiFuentesTelemetria.bind(controladorMonitores)
  );

  router.get(
    '/monitores/editar/:id',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirEditar,
    controladorMonitores.mostrarEditarMonitor.bind(controladorMonitores)
  );

  router.get(
    '/monitores/:id',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirVerMonitores,
    controladorMonitores.mostrarDetalleMonitor.bind(controladorMonitores)
  );

  router.post(
    '/monitores/crear',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirEditar,
    controladorMonitores.crearMonitor.bind(controladorMonitores)
  );

  router.post(
    '/monitores/:id/actualizar',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirEditar,
    controladorMonitores.actualizarMonitor.bind(controladorMonitores)
  );

  router.get(
    '/monitores/:id/impacto-eliminacion',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirEditar,
    controladorMonitores.apiImpactoEliminacionMonitor.bind(controladorMonitores)
  );

  router.post(
    '/monitores/eliminar',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirEditar,
    controladorMonitores.eliminarMonitor.bind(controladorMonitores)
  );

  router.get(
    '/dns',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirVerDns,
    controladorDns.mostrarListado.bind(controladorDns)
  );

  router.get(
    '/dns/api/listado',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirVerDns,
    controladorDns.mostrarListadoApi.bind(controladorDns)
  );

  router.get(
    '/dns/nuevo',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirEditarDns,
    controladorDns.mostrarNuevo.bind(controladorDns)
  );

  router.post(
    '/dns/crear',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirEditarDns,
    controladorDns.crearZona.bind(controladorDns)
  );

  router.get(
    '/dns/:id/editar',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirEditarDns,
    controladorDns.mostrarEditar.bind(controladorDns)
  );

  router.get(
    '/dns/:id/registros/nuevo',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirEditarDns,
    controladorDns.mostrarNuevoRegistro.bind(controladorDns)
  );

  router.post(
    '/dns/:id/registros/crear',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirEditarDns,
    controladorDns.crearRegistro.bind(controladorDns)
  );

  router.get(
    '/dns/:id/registros/:registroId/editar',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirEditarDns,
    controladorDns.mostrarEditarRegistro.bind(controladorDns)
  );

  if (ddnsAgentesHabilitado === true) {
    router.post(
      '/dns/:id/registros/:registroId/ddns/:concesionId/revocar',
      requerirAutenticacion,
      cargarContextoUsuario,
      requerirAdministrarDnsAvanzado,
      controladorDns.revocarConcesionDdns.bind(controladorDns)
    );
  }

  router.post(
    '/dns/:id/registros/:registroId/actualizar',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirEditarDns,
    controladorDns.actualizarRegistro.bind(controladorDns)
  );

  router.post(
    '/dns/:id/registros/eliminar',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirEditarDns,
    controladorDns.eliminarRegistro.bind(controladorDns)
  );

  router.get(
    '/dns/:id/registros/:registroId/impacto-eliminacion',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirEditarDns,
    controladorDns.mostrarImpactoEliminacionRegistro.bind(controladorDns)
  );

  router.get(
    '/dns/:id/impacto-eliminacion',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirEditarDns,
    controladorDns.mostrarImpactoEliminacionZona.bind(controladorDns)
  );

  router.get(
    '/dns/:id',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirVerDns,
    controladorDns.mostrarDetalle.bind(controladorDns)
  );

  router.post(
    '/dns/:id/actualizar',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirEditarDns,
    controladorDns.actualizarZona.bind(controladorDns)
  );

  router.post(
    '/dns/eliminar',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirEditarDns,
    controladorDns.eliminarZona.bind(controladorDns)
  );

  router.get(
    '/usuarios-demo',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirAdministrarUsuarios,
    controladorPortal.mostrarUsuariosDemo.bind(controladorPortal)
  );

  router.get(
    '/configuracion-demo',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirAdministrarConfiguracion,
    controladorPortal.mostrarConfiguracionDemo.bind(controladorPortal)
  );

  router.get(
    '/configuracion',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirAdministrarConfiguracion,
    controladorPortal.mostrarConfiguracion.bind(controladorPortal)
  );

  router.post(
    '/configuracion/actualizar',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirAdministrarConfiguracion,
    controladorPortal.actualizarConfiguracion.bind(controladorPortal)
  );

  router.post(
    '/configuracion/restablecer',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirAdministrarConfiguracion,
    controladorPortal.restablecerConfiguracion.bind(controladorPortal)
  );

  router.post(
    '/configuracion/sincronizar',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirAdministrarConfiguracion,
    controladorPortal.sincronizarConfiguracion.bind(controladorPortal)
  );

  router.post(
    '/configuracion/correo/iniciar-verificacion',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirAdministrarConfiguracion,
    controladorPortal.iniciarVerificacionCorreoOperativo.bind(controladorPortal)
  );

  router.get(
    '/configuracion/correo/verificar/:token',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirAdministrarConfiguracion,
    controladorPortal.verificarCorreoOperativo.bind(controladorPortal)
  );

  router.post(
    '/configuracion/correo/verificar/:token',
    requerirAutenticacion,
    cargarContextoUsuario,
    requerirAdministrarConfiguracion,
    validarCsrfPortal,
    controladorPortal.confirmarCorreoOperativo.bind(controladorPortal)
  );

  return router;
}

function resolverControladorEliminacionOrganizaciones({
  controlador,
  habilitada
}) {
  const completo = typeof controlador?.obtenerImpacto === 'function' &&
    typeof controlador?.aceptar === 'function';
  if (completo) return controlador;
  if (habilitada === true) {
    throw new Error(
      'El gate HTTP organizativo no puede abrirse sin su controlador durable.'
    );
  }
  const noDisponible = (_requisicion, _respuesta, next) => next(
    new Error('El controlador organizativo privado no está compuesto.')
  );
  return Object.freeze({
    obtenerImpacto: noDisponible,
    aceptar: noDisponible
  });
}
