export class PermisosUsuario {
  constructor({
    ver = false,
    verMonitores = false,
    verTriggers = false,
    verDns = false,
    verAuditoria = false,
    editar = false,
    editarTriggers = false,
    editarDns = false,
    gestionarVinculosTriggers = false,
    administrarUsuarios = false,
    administrarConfiguracion = false,
    publicarDns = false,
    administrarDnsAvanzado = false,
    verAgentes = false,
    modificarAgentes = false,
    eliminarAgentes = false,
    administrarOrganizacion = false,
    administrarTenants = false,
    administrarEmpresas = false,
    administrarSitios = false,
    impersonacion = false,
    configurarEmisionesFederacion = false,
    configurarRecepcionesFederacion = false,
    activarRelacionesFederacion = false,
    gestionarCredencialesFederacion = false,
    transferirResponsabilidadFederacion = false,
    resolverConflictosFederacion = false,
    verDiagnosticoFederacion = false,
    verAvisosPlataforma = false,
    verAlertasRemotas = false
  }) {
    this.ver = Boolean(ver);
    this.verMonitores = Boolean(verMonitores);
    this.verTriggers = Boolean(verTriggers);
    this.verDns = Boolean(verDns);
    this.verAuditoria = Boolean(verAuditoria);
    this.editar = Boolean(editar);
    this.editarTriggers = Boolean(editarTriggers);
    this.editarDns = Boolean(editarDns);
    this.gestionarVinculosTriggers = Boolean(gestionarVinculosTriggers);
    this.administrarUsuarios = Boolean(administrarUsuarios);
    this.administrarConfiguracion = Boolean(administrarConfiguracion);
    this.publicarDns = Boolean(publicarDns);
    this.administrarDnsAvanzado = Boolean(administrarDnsAvanzado);
    this.verAgentes = Boolean(verAgentes);
    this.modificarAgentes = Boolean(modificarAgentes);
    this.eliminarAgentes = Boolean(eliminarAgentes);
    this.administrarOrganizacion = Boolean(administrarOrganizacion);
    this.administrarTenants = Boolean(administrarTenants);
    this.administrarEmpresas = Boolean(administrarEmpresas);
    this.administrarSitios = Boolean(administrarSitios);
    this.impersonacion = Boolean(impersonacion);
    this.configurarEmisionesFederacion = Boolean(configurarEmisionesFederacion);
    this.configurarRecepcionesFederacion = Boolean(configurarRecepcionesFederacion);
    this.activarRelacionesFederacion = Boolean(activarRelacionesFederacion);
    this.gestionarCredencialesFederacion = Boolean(gestionarCredencialesFederacion);
    this.transferirResponsabilidadFederacion = Boolean(
      transferirResponsabilidadFederacion
    );
    this.resolverConflictosFederacion = Boolean(resolverConflictosFederacion);
    this.verDiagnosticoFederacion = Boolean(verDiagnosticoFederacion);
    this.verAvisosPlataforma = Boolean(verAvisosPlataforma);
    this.verAlertasRemotas = Boolean(verAlertasRemotas);
  }

  serializar() {
    return {
      ver: this.ver,
      verMonitores: this.verMonitores,
      verTriggers: this.verTriggers,
      verDns: this.verDns,
      verAuditoria: this.verAuditoria,
      editar: this.editar,
      editarTriggers: this.editarTriggers,
      editarDns: this.editarDns,
      gestionarVinculosTriggers: this.gestionarVinculosTriggers,
      administrarUsuarios: this.administrarUsuarios,
      administrarConfiguracion: this.administrarConfiguracion,
      publicarDns: this.publicarDns,
      administrarDnsAvanzado: this.administrarDnsAvanzado,
      verAgentes: this.verAgentes,
      modificarAgentes: this.modificarAgentes,
      eliminarAgentes: this.eliminarAgentes,
      administrarOrganizacion: this.administrarOrganizacion,
      administrarTenants: this.administrarTenants,
      administrarEmpresas: this.administrarEmpresas,
      administrarSitios: this.administrarSitios,
      impersonacion: this.impersonacion,
      configurarEmisionesFederacion: this.configurarEmisionesFederacion,
      configurarRecepcionesFederacion: this.configurarRecepcionesFederacion,
      activarRelacionesFederacion: this.activarRelacionesFederacion,
      gestionarCredencialesFederacion: this.gestionarCredencialesFederacion,
      transferirResponsabilidadFederacion: this.transferirResponsabilidadFederacion,
      resolverConflictosFederacion: this.resolverConflictosFederacion,
      verDiagnosticoFederacion: this.verDiagnosticoFederacion,
      verAvisosPlataforma: this.verAvisosPlataforma,
      verAlertasRemotas: this.verAlertasRemotas
    };
  }

  listarActivos({ incluirInternos = false } = {}) {
    return Object.entries(this.serializar())
      .filter(([clave]) => incluirInternos || clave !== 'impersonacion')
      .filter(([, activo]) => activo)
      .map(([clave]) => clave);
  }
}
