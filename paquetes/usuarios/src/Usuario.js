import { PermisosUsuario } from '../../autorizacion/src/PermisosUsuario.js';
import { normalizarMarcaUtc } from '../../utilidades/src/fechas/normalizarMarcaUtc.js';

export class Usuario {
  constructor(fila) {
    this.id = fila.id;
    this.usuario = fila.usuario;
    this.email = fila.email;
    this.emailValidado = Boolean(fila.email_validado);
    this.hashPassword = fila.hash_password;
    this.activo = Boolean(fila.activo);
    this.esSuperusuario = Boolean(fila.es_superusuario);
    this.requiereCambioPassword = Boolean(fila.requiere_cambio_password);
    this.versionSesion = fila.version_sesion;
    this.generacionRecuperacion = String(fila.generacion_recuperacion ?? '1');
    this.ultimoAcceso = fila.ultimo_acceso;
    this.contadorAccesos = fila.contador_accesos;
    this.nombreMostrar = fila.nombre_mostrar;
    this.nombreCompleto = fila.nombre_completo;
    this.tenantId = fila.tenant_id;
    this.empresaId = fila.empresa_id;
    this.sitioId = fila.sitio_id;
    this.tenantNombre = fila.tenant_nombre || null;
    this.empresaNombre = fila.empresa_nombre || null;
    this.sitioNombre = fila.sitio_nombre || null;
    this.preferenciaMostrarAlertasRemotas = Boolean(
      fila.preferencia_mostrar_alertas_remotas
    );
    this.fechaCreacion = fila.fecha_creacion || null;
    this.fechaActualizacion = fila.fecha_actualizacion || null;
    this.permisos = new PermisosUsuario({
      ver: fila.permiso_ver,
      verMonitores: fila.permiso_ver_monitores,
      verTriggers: fila.permiso_ver_triggers,
      verDns: fila.permiso_ver_dns,
      verAuditoria: fila.permiso_ver_auditoria,
      editar: fila.permiso_editar,
      editarTriggers: fila.permiso_editar_triggers,
      editarDns: fila.permiso_editar_dns,
      gestionarVinculosTriggers: fila.permiso_gestionar_vinculos_triggers,
      administrarUsuarios: fila.permiso_administrar_usuarios,
      administrarConfiguracion: fila.permiso_administrar_configuracion,
      publicarDns: fila.permiso_publicar_dns,
      administrarDnsAvanzado: fila.permiso_administrar_dns_avanzado,
      verAgentes: fila.permiso_ver_agentes,
      modificarAgentes: fila.permiso_modificar_agentes,
      eliminarAgentes: fila.permiso_eliminar_agentes,
      administrarOrganizacion: fila.permiso_administrar_organizacion,
      administrarTenants: fila.permiso_administrar_tenants,
      administrarEmpresas: fila.permiso_administrar_empresas,
      administrarSitios: fila.permiso_administrar_sitios,
      impersonacion: fila.permiso_impersonacion,
      configurarEmisionesFederacion:
        fila.permiso_configurar_emisiones_federacion,
      configurarRecepcionesFederacion:
        fila.permiso_configurar_recepciones_federacion,
      activarRelacionesFederacion:
        fila.permiso_activar_relaciones_federacion,
      gestionarCredencialesFederacion:
        fila.permiso_gestionar_credenciales_federacion,
      transferirResponsabilidadFederacion:
        fila.permiso_transferir_responsabilidad_federacion,
      resolverConflictosFederacion:
        fila.permiso_resolver_conflictos_federacion,
      verDiagnosticoFederacion: fila.permiso_ver_diagnostico_federacion,
      verAvisosPlataforma: fila.permiso_ver_avisos_plataforma,
      verAlertasRemotas: fila.permiso_ver_alertas_remotas
    });
  }

  obtenerNombreVisible() {
    return this.nombreMostrar || this.nombreCompleto || this.usuario;
  }

  obtenerResumenAdministracion({ resolutorScopeUsuario }) {
    const nivelScope = resolutorScopeUsuario.resolverNivelScope({
      tenantId: this.tenantId,
      empresaId: this.empresaId,
      sitioId: this.sitioId
    });

    return {
      id: this.id,
      usuario: this.usuario,
      email: this.email,
      emailValidado: this.emailValidado,
      activo: this.activo,
      requiereCambioPassword: this.requiereCambioPassword,
      versionSesion: this.versionSesion,
      ultimoAcceso: normalizarMarcaUtc(this.ultimoAcceso),
      contadorAccesos: this.contadorAccesos,
      nombreMostrar: this.nombreMostrar,
      nombreCompleto: this.nombreCompleto,
      tenantId: this.tenantId,
      tenantNombre: this.tenantNombre,
      empresaId: this.empresaId,
      empresaNombre: this.empresaNombre,
      sitioId: this.sitioId,
      sitioNombre: this.sitioNombre,
      fechaCreacion: normalizarMarcaUtc(this.fechaCreacion),
      fechaActualizacion: normalizarMarcaUtc(this.fechaActualizacion),
      preferenciaMostrarAlertasRemotas: this.preferenciaMostrarAlertasRemotas,
      nivelScope,
      descripcionScope: this.obtenerDescripcionScope(nivelScope),
      permisos: this.permisos.serializar(),
      permisosActivos: this.permisos.listarActivos()
    };
  }

  obtenerDescripcionScope(nivelScope) {
    if (nivelScope === 'portal') {
      return 'Portal completo';
    }

    if (nivelScope === 'tenant') {
      return `${this.tenantNombre || 'Tenant'} #${this.tenantId}`;
    }

    if (nivelScope === 'empresa') {
      return `${this.empresaNombre || 'Empresa'} #${this.empresaId} · ${this.tenantNombre || 'Tenant'} #${this.tenantId}`;
    }

    if (nivelScope === 'sitio') {
      return `${this.sitioNombre || 'Sitio'} #${this.sitioId} · ${this.empresaNombre || 'Empresa'} #${this.empresaId}`;
    }

    return 'Scope inválido';
  }
}
