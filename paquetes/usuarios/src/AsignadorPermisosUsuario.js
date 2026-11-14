export class AsignadorPermisosUsuario {
  obtenerDefinicionesPermisos() {
    return [
      {
        claveModelo: 'ver',
        claveFormulario: 'permiso_ver',
        etiqueta: 'Ver',
        descripcion: 'Acceso base al panel operativo.'
      },
      {
        claveModelo: 'verMonitores',
        claveFormulario: 'permiso_ver_monitores',
        etiqueta: 'Ver monitores',
        descripcion: 'Lectura del catálogo de monitores según scope.'
      },
      {
        claveModelo: 'verTriggers',
        claveFormulario: 'permiso_ver_triggers',
        etiqueta: 'Ver triggers',
        descripcion: 'Lectura administrativa del catálogo y traza de automatización.'
      },
      {
        claveModelo: 'verDns',
        claveFormulario: 'permiso_ver_dns',
        etiqueta: 'Ver DNS',
        descripcion: 'Lectura de zonas y registros DNS visibles por scope.'
      },
      {
        claveModelo: 'verAuditoria',
        claveFormulario: 'permiso_ver_auditoria',
        etiqueta: 'Consultar auditoría',
        descripcion: 'Consulta de actividad e integridad auditable dentro del alcance autorizado.'
      },
      {
        claveModelo: 'editar',
        claveFormulario: 'permiso_editar',
        etiqueta: 'Editar',
        descripcion: 'Acceso a superficies de edición funcional.'
      },
      {
        claveModelo: 'editarTriggers',
        claveFormulario: 'permiso_editar_triggers',
        etiqueta: 'Editar triggers',
        descripcion: 'Gestión del catálogo reusable de acciones automáticas.'
      },
      {
        claveModelo: 'editarDns',
        claveFormulario: 'permiso_editar_dns',
        etiqueta: 'Editar DNS',
        descripcion: 'Alta y modificación de zonas y registros DNS dentro del scope alcanzable.'
      },
      {
        claveModelo: 'gestionarVinculosTriggers',
        claveFormulario: 'permiso_gestionar_vinculos_triggers',
        etiqueta: 'Gestionar vínculos trigger-monitor',
        descripcion: 'Alta y mantenimiento de bindings entre monitores y triggers.'
      },
      {
        claveModelo: 'administrarUsuarios',
        claveFormulario: 'permiso_administrar_usuarios',
        etiqueta: 'Administrar usuarios',
        descripcion: 'Gestión administrativa de identidades humanas.'
      },
      {
        claveModelo: 'administrarConfiguracion',
        claveFormulario: 'permiso_administrar_configuracion',
        etiqueta: 'Administrar configuración',
        descripcion: 'Edición viva de claves del portal y correo.'
      },
      {
        claveModelo: 'publicarDns',
        claveFormulario: 'permiso_publicar_dns',
        etiqueta: 'Publicar DNS',
        descripcion: 'Capacidad de proyectar configuración DNS válida hacia BIND9.'
      },
      {
        claveModelo: 'administrarDnsAvanzado',
        claveFormulario: 'permiso_administrar_dns_avanzado',
        etiqueta: 'Administrar DNS avanzado',
        descripcion: 'Operaciones DNS sensibles de nivel servidor y publicación avanzada.'
      },
      {
        claveModelo: 'verAgentes',
        claveFormulario: 'permiso_ver_agentes',
        etiqueta: 'Ver agentes',
        descripcion: 'Lectura administrativa de agentes Sentinelia dentro del scope visible.'
      },
      {
        claveModelo: 'modificarAgentes',
        claveFormulario: 'permiso_modificar_agentes',
        etiqueta: 'Modificar agentes',
        descripcion: 'Alta, edición y acciones administrativas sobre agentes Sentinelia dentro del scope.'
      },
      {
        claveModelo: 'eliminarAgentes',
        claveFormulario: 'permiso_eliminar_agentes',
        etiqueta: 'Eliminar agentes',
        descripcion: 'Eliminación física de agentes Sentinelia y de todos sus datos dependientes dentro del scope.'
      },
      {
        claveModelo: 'administrarOrganizacion',
        claveFormulario: 'permiso_administrar_organizacion',
        etiqueta: 'Administrar organización',
        descripcion: 'Permiso global de organización con efecto paraguas.'
      },
      {
        claveModelo: 'administrarTenants',
        claveFormulario: 'permiso_administrar_tenants',
        etiqueta: 'Administrar tenants',
        descripcion: 'Gestión de la sección de tenants.'
      },
      {
        claveModelo: 'administrarEmpresas',
        claveFormulario: 'permiso_administrar_empresas',
        etiqueta: 'Administrar empresas',
        descripcion: 'Gestión de la sección de empresas.'
      },
      {
        claveModelo: 'administrarSitios',
        claveFormulario: 'permiso_administrar_sitios',
        etiqueta: 'Administrar sitios',
        descripcion: 'Gestión de la sección de sitios.'
      },
      {
        claveModelo: 'configurarEmisionesFederacion',
        claveFormulario: 'permiso_configurar_emisiones_federacion',
        etiqueta: 'Configurar emisiones federadas',
        descripcion: 'Define datos y scopes emitidos hacia otras instalaciones.'
      },
      {
        claveModelo: 'configurarRecepcionesFederacion',
        claveFormulario: 'permiso_configurar_recepciones_federacion',
        etiqueta: 'Configurar recepciones federadas',
        descripcion: 'Define datos y contextos recibidos desde otras instalaciones.'
      },
      {
        claveModelo: 'activarRelacionesFederacion',
        claveFormulario: 'permiso_activar_relaciones_federacion',
        etiqueta: 'Activar relaciones federadas',
        descripcion: 'Activa o deshabilita relaciones y flujos de federación.'
      },
      {
        claveModelo: 'gestionarCredencialesFederacion',
        claveFormulario: 'permiso_gestionar_credenciales_federacion',
        etiqueta: 'Gestionar credenciales federadas',
        descripcion: 'Establece relaciones y gestiona, rota o recupera sus credenciales.'
      },
      {
        claveModelo: 'transferirResponsabilidadFederacion',
        claveFormulario: 'permiso_transferir_responsabilidad_federacion',
        etiqueta: 'Transferir responsabilidad federada',
        descripcion: 'Transfiere la responsabilidad local de relaciones federadas.'
      },
      {
        claveModelo: 'resolverConflictosFederacion',
        claveFormulario: 'permiso_resolver_conflictos_federacion',
        etiqueta: 'Resolver conflictos federados',
        descripcion: 'Interviene en conflictos de identidad de instalaciones.'
      },
      {
        claveModelo: 'verDiagnosticoFederacion',
        claveFormulario: 'permiso_ver_diagnostico_federacion',
        etiqueta: 'Ver diagnóstico de federación',
        descripcion: 'Consulta relaciones, salud, continuidad y diagnóstico federado.'
      },
      {
        claveModelo: 'verAvisosPlataforma',
        claveFormulario: 'permiso_ver_avisos_plataforma',
        etiqueta: 'Ver avisos de plataforma',
        descripcion: 'Consulta incidencias de plataforma visibles dentro del scope.'
      },
      {
        claveModelo: 'verAlertasRemotas',
        claveFormulario: 'permiso_ver_alertas_remotas',
        etiqueta: 'Ver alertas remotas',
        descripcion: 'Consulta alertas pertenecientes a proyecciones remotas autorizadas.'
      }
    ];
  }

  obtenerDefinicionesPermisosOcultos() {
    return [
      {
        claveModelo: 'impersonacion',
        claveFormulario: 'permiso_impersonacion',
        etiqueta: 'Impersonación',
        descripcion: 'Permiso interno para desarrolladores y verificación avanzada.'
      }
    ];
  }

  obtenerDefinicionesPermisosModelo() {
    return [
      ...this.obtenerDefinicionesPermisos(),
      ...this.obtenerDefinicionesPermisosOcultos()
    ];
  }

  construirPermisosIniciales() {
    return {
      ver: 0,
      verMonitores: 0,
      verTriggers: 0,
      verDns: 0,
      verAuditoria: 0,
      editar: 0,
      editarTriggers: 0,
      editarDns: 0,
      gestionarVinculosTriggers: 0,
      administrarUsuarios: 0,
      administrarConfiguracion: 0,
      publicarDns: 0,
      administrarDnsAvanzado: 0,
      verAgentes: 0,
      modificarAgentes: 0,
      eliminarAgentes: 0,
      administrarOrganizacion: 0,
      administrarTenants: 0,
      administrarEmpresas: 0,
      administrarSitios: 0,
      impersonacion: 0,
      configurarEmisionesFederacion: 0,
      configurarRecepcionesFederacion: 0,
      activarRelacionesFederacion: 0,
      gestionarCredencialesFederacion: 0,
      transferirResponsabilidadFederacion: 0,
      resolverConflictosFederacion: 0,
      verDiagnosticoFederacion: 0,
      verAvisosPlataforma: 0,
      verAlertasRemotas: 0
    };
  }

  construirPermisosDesdeFormulario(datos = {}) {
    const permisos = this.construirPermisosIniciales();

    for (const definicion of this.obtenerDefinicionesPermisos()) {
      permisos[definicion.claveModelo] = this.normalizarBooleano(
        datos[definicion.claveFormulario]
      )
        ? 1
        : 0;
    }

    this.aplicarDependenciasPermisos(permisos);

    return permisos;
  }

  aplicarDependenciasPermisos(permisos) {
    if (!permisos || typeof permisos !== 'object') {
      return permisos;
    }

    if (permisos.editarDns) {
      permisos.verDns = 1;
    }

    if (permisos.publicarDns) {
      permisos.verDns = 1;
      permisos.editarDns = 1;
    }

    if (permisos.administrarDnsAvanzado) {
      permisos.verDns = 1;
      permisos.editarDns = 1;
      permisos.publicarDns = 1;
    }

    if (permisos.modificarAgentes) {
      permisos.verAgentes = 1;
    }

    if (permisos.eliminarAgentes) {
      permisos.verAgentes = 1;
    }

    return permisos;
  }

  aplicarRestriccionesPermisosPorScope(permisos, nivelScope) {
    if (!permisos || typeof permisos !== 'object') {
      return permisos;
    }

    const nivel = String(nivelScope || 'portal').trim().toLowerCase();

    if (nivel !== 'portal') {
      permisos.administrarConfiguracion = 0;
    }

    if (['empresa', 'sitio'].includes(nivel)) {
      permisos.administrarTenants = 0;
    }

    if (nivel === 'sitio') {
      permisos.administrarEmpresas = 0;
    }

    return permisos;
  }

  normalizarBooleano(valor) {
    return ['1', 'true', 'si', 'yes', 'on'].includes(
      String(valor || '').toLowerCase()
    );
  }
}
