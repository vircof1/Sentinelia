export class ServicioAutorizacion {
  puedeVer(contextoUsuarioActual) {
    return Boolean(contextoUsuarioActual?.permisos?.ver);
  }

  puedeVerMonitores(contextoUsuarioActual) {
    return Boolean(contextoUsuarioActual?.permisos?.verMonitores);
  }

  puedeVerTriggers(contextoUsuarioActual) {
    return Boolean(contextoUsuarioActual?.permisos?.verTriggers);
  }

  puedeVerDns(contextoUsuarioActual) {
    return Boolean(contextoUsuarioActual?.permisos?.verDns);
  }

  puedeVerAuditoria(contextoUsuarioActual) {
    return Boolean(contextoUsuarioActual?.permisos?.verAuditoria);
  }

  puedeEditar(contextoUsuarioActual) {
    return Boolean(contextoUsuarioActual?.permisos?.editar);
  }

  puedeEditarTriggers(contextoUsuarioActual) {
    return Boolean(contextoUsuarioActual?.permisos?.editarTriggers);
  }

  puedeEditarDns(contextoUsuarioActual) {
    return Boolean(contextoUsuarioActual?.permisos?.editarDns);
  }

  puedeGestionarVinculosTriggers(contextoUsuarioActual) {
    return Boolean(contextoUsuarioActual?.permisos?.gestionarVinculosTriggers);
  }

  puedeGestionarDescartesAlertasActivas(contextoUsuarioActual) {
    return this.puedeVerMonitores(contextoUsuarioActual);
  }

  puedeAdministrarUsuarios(contextoUsuarioActual) {
    return Boolean(contextoUsuarioActual?.permisos?.administrarUsuarios);
  }

  puedeAdministrarConfiguracion(contextoUsuarioActual) {
    return Boolean(
      contextoUsuarioActual?.nivelScope === 'portal' &&
      contextoUsuarioActual?.permisos?.administrarConfiguracion
    );
  }

  puedePublicarDns(contextoUsuarioActual) {
    return Boolean(contextoUsuarioActual?.permisos?.publicarDns);
  }

  puedeAdministrarDnsAvanzado(contextoUsuarioActual) {
    return Boolean(contextoUsuarioActual?.permisos?.administrarDnsAvanzado);
  }

  puedeVerAgentes(contextoUsuarioActual) {
    return Boolean(contextoUsuarioActual?.permisos?.verAgentes);
  }

  puedeUsarBuzonPersonal(contextoUsuarioActual) {
    const idUsuarioReal = Number(
      contextoUsuarioActual?.idUsuarioReal ?? contextoUsuarioActual?.idUsuario
    );
    return Boolean(Number.isSafeInteger(idUsuarioReal) && idUsuarioReal > 0);
  }

  puedeModificarAgentes(contextoUsuarioActual) {
    return Boolean(contextoUsuarioActual?.permisos?.modificarAgentes);
  }

  puedeEliminarAgentes(contextoUsuarioActual) {
    return Boolean(contextoUsuarioActual?.permisos?.eliminarAgentes);
  }

  puedeAdministrarOrganizacion(contextoUsuarioActual) {
    return Boolean(contextoUsuarioActual?.permisos?.administrarOrganizacion);
  }

  puedeAdministrarTenants(contextoUsuarioActual) {
    const scopeCompatible = ['portal', 'tenant'].includes(
      contextoUsuarioActual?.nivelScope
    );

    return Boolean(
      scopeCompatible &&
      (
        contextoUsuarioActual?.permisos?.administrarTenants ||
        contextoUsuarioActual?.permisos?.administrarOrganizacion
      )
    );
  }

  puedeAdministrarEmpresas(contextoUsuarioActual) {
    const scopeCompatible = ['portal', 'tenant', 'empresa'].includes(
      contextoUsuarioActual?.nivelScope
    );

    return Boolean(
      scopeCompatible &&
      (
        contextoUsuarioActual?.permisos?.administrarEmpresas ||
        contextoUsuarioActual?.permisos?.administrarOrganizacion
      )
    );
  }

  puedeAdministrarSitios(contextoUsuarioActual) {
    return Boolean(
      contextoUsuarioActual?.permisos?.administrarSitios ||
      contextoUsuarioActual?.permisos?.administrarOrganizacion
    );
  }

  puedeImpersonacion(contextoUsuarioActual) {
    return Boolean(contextoUsuarioActual?.permisos?.impersonacion);
  }

  esSesionDirecta(contextoUsuarioActual) {
    return Boolean(contextoUsuarioActual && !contextoUsuarioActual.impersonacionActiva);
  }

  puedeConfigurarEmisionesFederacion(contextoUsuarioActual) {
    return Boolean(
      this.esSesionDirecta(contextoUsuarioActual) &&
      contextoUsuarioActual?.permisos?.configurarEmisionesFederacion
    );
  }

  puedeConfigurarRecepcionesFederacion(contextoUsuarioActual) {
    return Boolean(
      this.esSesionDirecta(contextoUsuarioActual) &&
      contextoUsuarioActual?.permisos?.configurarRecepcionesFederacion
    );
  }

  puedeActivarRelacionesFederacion(contextoUsuarioActual) {
    return Boolean(
      this.esSesionDirecta(contextoUsuarioActual) &&
      contextoUsuarioActual?.permisos?.activarRelacionesFederacion
    );
  }

  puedeGestionarCredencialesFederacion(contextoUsuarioActual) {
    return Boolean(
      this.esSesionDirecta(contextoUsuarioActual) &&
      contextoUsuarioActual?.permisos?.gestionarCredencialesFederacion
    );
  }

  puedeTransferirResponsabilidadFederacion(contextoUsuarioActual) {
    return Boolean(
      this.esSesionDirecta(contextoUsuarioActual) &&
      contextoUsuarioActual?.permisos?.transferirResponsabilidadFederacion
    );
  }

  puedeResolverConflictosFederacion(contextoUsuarioActual) {
    return Boolean(
      this.esSesionDirecta(contextoUsuarioActual) &&
      contextoUsuarioActual?.permisos?.resolverConflictosFederacion
    );
  }

  puedeVerDiagnosticoFederacion(contextoUsuarioActual) {
    return Boolean(contextoUsuarioActual?.permisos?.verDiagnosticoFederacion);
  }

  puedeVerAvisosPlataforma(contextoUsuarioActual) {
    return Boolean(contextoUsuarioActual?.permisos?.verAvisosPlataforma);
  }

  puedeVerAlertasRemotas(contextoUsuarioActual) {
    return Boolean(contextoUsuarioActual?.permisos?.verAlertasRemotas);
  }

  puedeExplorarDatosRemotosFederacion(contextoUsuarioActual) {
    return Boolean(
      this.puedeVer(contextoUsuarioActual) ||
      this.puedeVerMonitores(contextoUsuarioActual) ||
      this.puedeVerTriggers(contextoUsuarioActual) ||
      this.puedeVerAuditoria(contextoUsuarioActual) ||
      this.puedeVerAgentes(contextoUsuarioActual) ||
      this.puedeVerDiagnosticoFederacion(contextoUsuarioActual)
    );
  }

  puedeAccederFederacion(contextoUsuarioActual) {
    return Boolean(
      this.puedeConfigurarEmisionesFederacion(contextoUsuarioActual) ||
      this.puedeConfigurarRecepcionesFederacion(contextoUsuarioActual) ||
      this.puedeActivarRelacionesFederacion(contextoUsuarioActual) ||
      this.puedeGestionarCredencialesFederacion(contextoUsuarioActual) ||
      this.puedeTransferirResponsabilidadFederacion(contextoUsuarioActual) ||
      this.puedeResolverConflictosFederacion(contextoUsuarioActual) ||
      this.puedeVerDiagnosticoFederacion(contextoUsuarioActual)
    );
  }

  puedeAccederOrganizacion(contextoUsuarioActual) {
    return (
      this.puedeAdministrarTenants(contextoUsuarioActual) ||
      this.puedeAdministrarEmpresas(contextoUsuarioActual) ||
      this.puedeAdministrarSitios(contextoUsuarioActual)
    );
  }

  puedeAccederDns(contextoUsuarioActual) {
    return (
      this.puedeVerDns(contextoUsuarioActual) ||
      this.puedeEditarDns(contextoUsuarioActual) ||
      this.puedePublicarDns(contextoUsuarioActual) ||
      this.puedeAdministrarDnsAvanzado(contextoUsuarioActual)
    );
  }

  resolverPermiso(clavePermiso, contextoUsuarioActual) {
    if (clavePermiso === 'ver') {
      return this.puedeVer(contextoUsuarioActual);
    }

    if (clavePermiso === 'editar') {
      return this.puedeEditar(contextoUsuarioActual);
    }

    if (clavePermiso === 'ver_monitores') {
      return this.puedeVerMonitores(contextoUsuarioActual);
    }

    if (clavePermiso === 'ver_triggers') {
      return this.puedeVerTriggers(contextoUsuarioActual);
    }

    if (clavePermiso === 'ver_dns') {
      return this.puedeVerDns(contextoUsuarioActual);
    }

    if (clavePermiso === 'ver_auditoria') {
      return this.puedeVerAuditoria(contextoUsuarioActual);
    }

    if (clavePermiso === 'editar_triggers') {
      return this.puedeEditarTriggers(contextoUsuarioActual);
    }

    if (clavePermiso === 'editar_dns') {
      return this.puedeEditarDns(contextoUsuarioActual);
    }

    if (clavePermiso === 'gestionar_vinculos_triggers') {
      return this.puedeGestionarVinculosTriggers(contextoUsuarioActual);
    }

    if (clavePermiso === 'gestionar_descartes_alertas_activas') {
      return this.puedeGestionarDescartesAlertasActivas(contextoUsuarioActual);
    }

    if (clavePermiso === 'administrar_usuarios') {
      return this.puedeAdministrarUsuarios(contextoUsuarioActual);
    }

    if (clavePermiso === 'administrar_configuracion') {
      return this.puedeAdministrarConfiguracion(contextoUsuarioActual);
    }

    if (clavePermiso === 'publicar_dns') {
      return this.puedePublicarDns(contextoUsuarioActual);
    }

    if (clavePermiso === 'administrar_dns_avanzado') {
      return this.puedeAdministrarDnsAvanzado(contextoUsuarioActual);
    }

    if (clavePermiso === 'ver_agentes') {
      return this.puedeVerAgentes(contextoUsuarioActual);
    }

    if (clavePermiso === 'modificar_agentes') {
      return this.puedeModificarAgentes(contextoUsuarioActual);
    }

    if (clavePermiso === 'eliminar_agentes') {
      return this.puedeEliminarAgentes(contextoUsuarioActual);
    }

    if (clavePermiso === 'administrar_organizacion') {
      return this.puedeAdministrarOrganizacion(contextoUsuarioActual);
    }

    if (clavePermiso === 'administrar_tenants') {
      return this.puedeAdministrarTenants(contextoUsuarioActual);
    }

    if (clavePermiso === 'administrar_empresas') {
      return this.puedeAdministrarEmpresas(contextoUsuarioActual);
    }

    if (clavePermiso === 'administrar_sitios') {
      return this.puedeAdministrarSitios(contextoUsuarioActual);
    }

    if (clavePermiso === 'impersonacion') {
      return this.puedeImpersonacion(contextoUsuarioActual);
    }

    if (clavePermiso === 'configurar_emisiones_federacion') {
      return this.puedeConfigurarEmisionesFederacion(contextoUsuarioActual);
    }

    if (clavePermiso === 'configurar_recepciones_federacion') {
      return this.puedeConfigurarRecepcionesFederacion(contextoUsuarioActual);
    }

    if (clavePermiso === 'activar_relaciones_federacion') {
      return this.puedeActivarRelacionesFederacion(contextoUsuarioActual);
    }

    if (clavePermiso === 'gestionar_credenciales_federacion') {
      return this.puedeGestionarCredencialesFederacion(contextoUsuarioActual);
    }

    if (clavePermiso === 'transferir_responsabilidad_federacion') {
      return this.puedeTransferirResponsabilidadFederacion(contextoUsuarioActual);
    }

    if (clavePermiso === 'resolver_conflictos_federacion') {
      return this.puedeResolverConflictosFederacion(contextoUsuarioActual);
    }

    if (clavePermiso === 'ver_diagnostico_federacion') {
      return this.puedeVerDiagnosticoFederacion(contextoUsuarioActual);
    }

    if (clavePermiso === 'ver_avisos_plataforma') {
      return this.puedeVerAvisosPlataforma(contextoUsuarioActual);
    }

    if (clavePermiso === 'ver_alertas_remotas') {
      return this.puedeVerAlertasRemotas(contextoUsuarioActual);
    }

    if (clavePermiso === 'explorar_datos_remotos_federacion') {
      return this.puedeExplorarDatosRemotosFederacion(contextoUsuarioActual);
    }

    if (clavePermiso === 'acceder_federacion') {
      return this.puedeAccederFederacion(contextoUsuarioActual);
    }

    return false;
  }
}
