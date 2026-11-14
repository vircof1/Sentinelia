export class ControladorOrganizacion {
  constructor({
    servicioJerarquiaOrganizativa
  }) {
    this.servicioJerarquiaOrganizativa = servicioJerarquiaOrganizativa;
  }

  async mostrarOrganizacion(requisicion, respuesta, next) {
    try {
      const vista =
        await this.servicioJerarquiaOrganizativa.construirVistaOrganizacion(
          requisicion.contextoUsuarioActual
        );
      const destino = this.resolverRutaInicial(vista.capacidades);

      if (!destino) {
        respuesta.status(403).render('portal/forbidden', {
          titulo: 'Acceso denegado',
          permisoSolicitado:
            'administrar_tenants | administrar_empresas | administrar_sitios',
          usuarioActual: requisicion.session?.usuarioAutenticado ?? null
        });
        return;
      }

      respuesta.redirect(destino);
    } catch (error) {
      next(error);
    }
  }

  async mostrarTenants(requisicion, respuesta, next) {
    await this.renderizarPantalla(
      requisicion,
      respuesta,
      next,
      'tenants',
      'Tenants',
      'Nivel raíz de la organización. Cada tenant agrupa sus empresas y sitios.',
      'portal/organizacion-tenants'
    );
  }

  async mostrarNuevoTenant(requisicion, respuesta, next) {
    await this.renderizarFormularioTenant(requisicion, respuesta, next, {
      titulo: 'Crear tenant'
    });
  }

  async mostrarEditarTenant(requisicion, respuesta, next) {
    const idTenant = Number.parseInt(String(requisicion.params.id || ''), 10);

    await this.renderizarFormularioTenant(requisicion, respuesta, next, {
      titulo: 'Editar tenant',
      idTenant
    });
  }

  async mostrarEmpresas(requisicion, respuesta, next) {
    try {
      const vistaOrganizacion =
        await this.servicioJerarquiaOrganizativa.construirVistaOrganizacion(
          requisicion.contextoUsuarioActual
        );
      const subnavegacion =
        this.construirSubnavegacion(vistaOrganizacion.capacidades, 'empresas');

      if (!subnavegacion.algunAcceso) {
        respuesta.status(403).render('portal/forbidden', {
          titulo: 'Acceso denegado',
          permisoSolicitado:
            'administrar_tenants | administrar_empresas | administrar_sitios',
          usuarioActual: requisicion.session?.usuarioAutenticado ?? null
        });
        return;
      }

      if (!subnavegacion.empresas?.visible) {
        respuesta.status(403).render('portal/forbidden', {
          titulo: 'Acceso denegado',
          permisoSolicitado: 'administrar_empresas',
          usuarioActual: requisicion.session?.usuarioAutenticado ?? null
        });
        return;
      }

      const tenantId = String(requisicion.query.tenant_id || '').trim() || null;
      const contextoListado =
        await this.servicioJerarquiaOrganizativa.listarEmpresasAdministracion(
          requisicion.contextoUsuarioActual,
          {
            tenantId,
            pagina: 1,
            tamanoPagina: 25,
            ordenarPor: 'nombre',
            direccionOrden: 'asc'
          }
        );

      const tituloCatalogo = contextoListado.tenantFiltro
        ? 'Empresas del tenant'
        : 'Catálogo de empresas';
      const tenantAlcance =
        requisicion.contextoUsuarioActual?.nivelScope === 'tenant'
          ? vistaOrganizacion.tenants.find(
              (tenant) =>
                String(tenant.id) ===
                String(requisicion.contextoUsuarioActual.tenantId)
            ) ?? null
          : null;

      respuesta.render('portal/organizacion-empresas', {
        titulo: 'Empresas',
        usuarioActual: requisicion.session?.usuarioAutenticado ?? null,
        contextoUsuarioActual: requisicion.contextoUsuarioActual,
        resumen: vistaOrganizacion.resumen,
        capacidades: vistaOrganizacion.capacidades,
        tenants: vistaOrganizacion.tenants,
        empresas: vistaOrganizacion.empresas,
        sitios: vistaOrganizacion.sitios,
        opcionesCrearEmpresa: vistaOrganizacion.opcionesCrearEmpresa,
        opcionesCrearSitio: vistaOrganizacion.opcionesCrearSitio,
      subnavegacionOrganizacion: subnavegacion,
      tituloSeccion: 'Empresas',
      descripcionSeccion:
          'Segundo nivel de la organización. Cada empresa pertenece a un tenant y agrupa sus sitios.',
        flashOrganizacion: this.consumirFlash(requisicion),
        tenantFiltro: contextoListado.tenantFiltro,
        tenantAlcance,
        tituloCatalogo
      });
    } catch (error) {
      next(error);
    }
  }

  async mostrarNuevaEmpresa(requisicion, respuesta, next) {
    const tenantId = String(requisicion.query.tenant_id || '').trim();
    await this.renderizarFormularioEmpresa(requisicion, respuesta, next, {
      titulo: 'Crear empresa',
      formularioBase: tenantId ? { tenant_id: tenantId } : null
    });
  }

  async mostrarEditarEmpresa(requisicion, respuesta, next) {
    const idEmpresa = Number.parseInt(String(requisicion.params.id || ''), 10);

    await this.renderizarFormularioEmpresa(requisicion, respuesta, next, {
      titulo: 'Editar empresa',
      idEmpresa
    });
  }

  async mostrarSitios(requisicion, respuesta, next) {
    try {
      const vistaOrganizacion =
        await this.servicioJerarquiaOrganizativa.construirVistaOrganizacion(
          requisicion.contextoUsuarioActual
        );
      const subnavegacion =
        this.construirSubnavegacion(vistaOrganizacion.capacidades, 'sitios');

      if (!subnavegacion.algunAcceso) {
        respuesta.status(403).render('portal/forbidden', {
          titulo: 'Acceso denegado',
          permisoSolicitado:
            'administrar_tenants | administrar_empresas | administrar_sitios',
          usuarioActual: requisicion.session?.usuarioAutenticado ?? null
        });
        return;
      }

      if (!subnavegacion.sitios?.visible) {
        respuesta.status(403).render('portal/forbidden', {
          titulo: 'Acceso denegado',
          permisoSolicitado: 'administrar_sitios',
          usuarioActual: requisicion.session?.usuarioAutenticado ?? null
        });
        return;
      }

      const tenantId = String(requisicion.query.tenant_id || '').trim() || null;
      const empresaId = String(requisicion.query.empresa_id || '').trim() || null;
      const contextoListado =
        await this.servicioJerarquiaOrganizativa.listarSitiosAdministracion(
          requisicion.contextoUsuarioActual,
          {
            tenantId,
            empresaId,
            pagina: 1,
            tamanoPagina: 25,
            ordenarPor: 'nombre',
            direccionOrden: 'asc'
          }
        );

      const tituloCatalogo = 'Catálogo de sitios';
      const tenantAlcance =
        requisicion.contextoUsuarioActual?.nivelScope === 'tenant'
          ? vistaOrganizacion.tenants.find(
              (tenant) =>
                String(tenant.id) ===
                String(requisicion.contextoUsuarioActual.tenantId)
            ) ?? null
          : null;

      respuesta.render('portal/organizacion-sitios', {
        titulo: 'Sitios',
        usuarioActual: requisicion.session?.usuarioAutenticado ?? null,
        contextoUsuarioActual: requisicion.contextoUsuarioActual,
        resumen: vistaOrganizacion.resumen,
        capacidades: vistaOrganizacion.capacidades,
        tenants: vistaOrganizacion.tenants,
        empresas: vistaOrganizacion.empresas,
        sitios: vistaOrganizacion.sitios,
        opcionesCrearEmpresa: vistaOrganizacion.opcionesCrearEmpresa,
        opcionesCrearSitio: vistaOrganizacion.opcionesCrearSitio,
        subnavegacionOrganizacion: subnavegacion,
        tituloSeccion: 'Sitios',
        descripcionSeccion:
          'Ubicaciones operativas dependientes de empresa listas para materializar alcance.',
        flashOrganizacion: this.consumirFlash(requisicion),
        tenantFiltro: contextoListado.tenantFiltro,
        empresaFiltro: contextoListado.empresaFiltro,
        tenantAlcance,
        contextoListadoSitios: true,
        tituloCatalogo
      });
    } catch (error) {
      next(error);
    }
  }

  async mostrarNuevoSitio(requisicion, respuesta, next) {
    await this.renderizarFormularioSitio(requisicion, respuesta, next, {
      titulo: 'Crear sitio'
    });
  }

  async mostrarEditarSitio(requisicion, respuesta, next) {
    const idSitio = Number.parseInt(String(requisicion.params.id || ''), 10);

    await this.renderizarFormularioSitio(requisicion, respuesta, next, {
      titulo: 'Editar sitio',
      idSitio
    });
  }

  async crearTenant(requisicion, respuesta, _next) {
    try {
      const tenant = await this.servicioJerarquiaOrganizativa.crearTenant(
        requisicion.contextoUsuarioActual,
        requisicion.body
      );

      this.guardarFlash(requisicion, {
        tipo: 'exito',
        mensaje: `Tenant ${tenant.nombre} creado con id ${tenant.id}.`
      });
      respuesta.redirect('/organizacion/tenants');
    } catch (error) {
      if (this.responderDenegacionPorAlcance(requisicion, respuesta, error)) {
        return;
      }
      await this.renderizarFormularioTenant(requisicion, respuesta, _next, {
        titulo: 'Crear tenant',
        formularioBase: requisicion.body,
        errorFormulario: error.message,
        statusCode: 400
      });
    }
  }

  async actualizarTenant(requisicion, respuesta, _next) {
    try {
      const tenant = await this.servicioJerarquiaOrganizativa.actualizarTenant(
        requisicion.contextoUsuarioActual,
        requisicion.body.id,
        requisicion.body
      );

      this.guardarFlash(requisicion, {
        tipo: 'exito',
        mensaje: `Tenant ${tenant.nombre} actualizado.`
      });
      respuesta.redirect('/organizacion/tenants');
    } catch (error) {
      if (this.responderDenegacionPorAlcance(requisicion, respuesta, error)) {
        return;
      }
      const idTenant = Number.parseInt(String(requisicion.body.id || ''), 10);
      await this.renderizarFormularioTenant(requisicion, respuesta, _next, {
        titulo: 'Editar tenant',
        idTenant,
        formularioBase: requisicion.body,
        errorFormulario: error.message,
        statusCode: 400
      });
    }
  }

  async apiListarTenants(requisicion, respuesta, next) {
    try {
      const vista =
        await this.servicioJerarquiaOrganizativa.listarTenantsAdministracion(
          requisicion.contextoUsuarioActual,
          {
            textoBusqueda: String(requisicion.query.q || '').trim(),
            pagina: requisicion.query.page,
            tamanoPagina: requisicion.query.page_size,
            ordenarPor: String(requisicion.query.sort_by || 'nombre').trim(),
            direccionOrden: String(requisicion.query.sort_dir || 'asc').trim()
          }
        );

      respuesta.json({
        ok: true,
        ...vista
      });
    } catch (error) {
      next(error);
    }
  }

  async apiListarEmpresas(requisicion, respuesta, next) {
    try {
      const vista =
        await this.servicioJerarquiaOrganizativa.listarEmpresasAdministracion(
          requisicion.contextoUsuarioActual,
          {
            textoBusqueda: String(requisicion.query.q || '').trim(),
            tenantId: String(requisicion.query.tenant_id || '').trim() || null,
            pagina: requisicion.query.page,
            tamanoPagina: requisicion.query.page_size,
            ordenarPor: String(requisicion.query.sort_by || 'nombre').trim(),
            direccionOrden: String(requisicion.query.sort_dir || 'asc').trim()
          }
        );

      respuesta.json({
        ok: true,
        ...vista
      });
    } catch (error) {
      next(error);
    }
  }

  async crearEmpresa(requisicion, respuesta, _next) {
    try {
      const empresa = await this.servicioJerarquiaOrganizativa.crearEmpresa(
        requisicion.contextoUsuarioActual,
        requisicion.body
      );

      this.guardarFlash(requisicion, {
        tipo: 'exito',
        mensaje: `Empresa ${empresa.nombre} creada con id ${empresa.id}.`
      });
      respuesta.redirect(
        `/organizacion/empresas?tenant_id=${encodeURIComponent(empresa.tenantId)}`
      );
    } catch (error) {
      if (this.responderDenegacionPorAlcance(requisicion, respuesta, error)) {
        return;
      }
      await this.renderizarFormularioEmpresa(requisicion, respuesta, _next, {
        titulo: 'Crear empresa',
        formularioBase: requisicion.body,
        errorFormulario: error.message,
        statusCode: 400
      });
    }
  }

  async actualizarEmpresa(requisicion, respuesta, _next) {
    try {
      const empresa =
        await this.servicioJerarquiaOrganizativa.actualizarEmpresa(
          requisicion.contextoUsuarioActual,
          requisicion.body.id,
          requisicion.body
        );

      const huboCambioTenant = Boolean(
        empresa?.metaActualizacion?.cambioTenant
      );
      const tenantDestinoNombre =
        empresa?.metaActualizacion?.tenantNuevoNombre || empresa?.tenantNombre;

      this.guardarFlash(requisicion, {
        tipo: 'exito',
        canal: huboCambioTenant ? 'toast' : 'inline',
        mensaje: huboCambioTenant
          ? `Empresa ${empresa.nombre} movida a ${tenantDestinoNombre}.`
          : `Empresa ${empresa.nombre} actualizada.`
      });
      respuesta.redirect(`/organizacion/empresas/${empresa.id}/editar`);
    } catch (error) {
      if (this.responderDenegacionPorAlcance(requisicion, respuesta, error)) {
        return;
      }
      const idEmpresa = Number.parseInt(String(requisicion.body.id || ''), 10);
      await this.renderizarFormularioEmpresa(requisicion, respuesta, _next, {
        titulo: 'Editar empresa',
        idEmpresa,
        formularioBase: requisicion.body,
        errorFormulario: error.message,
        statusCode: 400
      });
    }
  }

  async apiImpactoCambioTenantEmpresa(requisicion, respuesta, _next) {
    await this.ejecutarOperacionJson(respuesta, async () => {
      const impacto =
        await this.servicioJerarquiaOrganizativa
          .evaluarImpactoCambioTenantEmpresa(
            requisicion.contextoUsuarioActual,
            requisicion.params.id,
            requisicion.query.tenant_id
          );

      return {
        impacto
      };
    });
  }

  async apiOpcionesTenantsEmpresa(requisicion, respuesta, _next) {
    await this.ejecutarOperacionJson(respuesta, async () => {
      const opciones =
        await this.servicioJerarquiaOrganizativa.obtenerOpcionesTenantEmpresa(
          requisicion.contextoUsuarioActual,
          {
            textoBusqueda: String(requisicion.query.q || '').trim(),
            limite: requisicion.query.limit
          }
        );

      return {
        opciones
      };
    });
  }

  async apiListarSitios(requisicion, respuesta, next) {
    try {
      const vista =
        await this.servicioJerarquiaOrganizativa.listarSitiosAdministracion(
          requisicion.contextoUsuarioActual,
          {
            textoBusqueda: String(requisicion.query.q || '').trim(),
            tenantId: String(requisicion.query.tenant_id || '').trim() || null,
            empresaId: String(requisicion.query.empresa_id || '').trim() || null,
            pagina: requisicion.query.page,
            tamanoPagina: requisicion.query.page_size,
            ordenarPor: String(requisicion.query.sort_by || 'nombre').trim(),
            direccionOrden: String(requisicion.query.sort_dir || 'asc').trim()
          }
        );

      respuesta.json({
        ok: true,
        ...vista
      });
    } catch (error) {
      next(error);
    }
  }

  async apiOpcionesEmpresasSitio(requisicion, respuesta, _next) {
    await this.ejecutarOperacionJson(respuesta, async () => {
      const opciones =
        await this.servicioJerarquiaOrganizativa.obtenerOpcionesEmpresaSitio(
          requisicion.contextoUsuarioActual,
          {
            textoBusqueda: String(requisicion.query.q || '').trim(),
            limite: requisicion.query.limit
          }
        );

      return {
        opciones
      };
    });
  }

  async crearSitio(requisicion, respuesta, _next) {
    try {
      const sitio = await this.servicioJerarquiaOrganizativa.crearSitio(
        requisicion.contextoUsuarioActual,
        requisicion.body
      );

      this.guardarFlash(requisicion, {
        tipo: 'exito',
        mensaje: `Sitio ${sitio.nombre} creado con id ${sitio.id}.`
      });
      respuesta.redirect('/organizacion/sitios');
    } catch (error) {
      if (this.responderDenegacionPorAlcance(requisicion, respuesta, error)) {
        return;
      }
      await this.renderizarFormularioSitio(requisicion, respuesta, _next, {
        titulo: 'Crear sitio',
        formularioBase: requisicion.body,
        errorFormulario: error.message,
        statusCode: 400
      });
    }
  }

  async actualizarSitio(requisicion, respuesta, _next) {
    try {
      const sitio = await this.servicioJerarquiaOrganizativa.actualizarSitio(
        requisicion.contextoUsuarioActual,
        requisicion.body.id,
        requisicion.body
      );

      const huboCambioEmpresa = Boolean(
        sitio?.metaActualizacion?.cambioEmpresa
      );
      const empresaDestinoNombre =
        sitio?.metaActualizacion?.empresaNuevaNombre || sitio?.empresaNombre;

      this.guardarFlash(requisicion, {
        tipo: 'exito',
        canal: huboCambioEmpresa ? 'toast' : 'inline',
        mensaje: huboCambioEmpresa
          ? `Sitio ${sitio.nombre} movido a ${empresaDestinoNombre}.`
          : `Sitio ${sitio.nombre} actualizado.`
      });
      respuesta.redirect(`/organizacion/sitios/${sitio.id}/editar`);
    } catch (error) {
      if (this.responderDenegacionPorAlcance(requisicion, respuesta, error)) {
        return;
      }
      const idSitio = Number.parseInt(String(requisicion.body.id || ''), 10);
      await this.renderizarFormularioSitio(requisicion, respuesta, _next, {
        titulo: 'Editar sitio',
        idSitio,
        formularioBase: requisicion.body,
        errorFormulario: error.message,
        statusCode: 400
      });
    }
  }

  async apiImpactoCambioEmpresaSitio(requisicion, respuesta, _next) {
    await this.ejecutarOperacionJson(respuesta, async () => {
      const impacto =
        await this.servicioJerarquiaOrganizativa
          .evaluarImpactoCambioEmpresaSitio(
            requisicion.contextoUsuarioActual,
            requisicion.params.id,
            requisicion.query.empresa_id
          );

      return {
        impacto
      };
    });
  }

  async renderizarPantalla(
    requisicion,
    respuesta,
    next,
    seccionActiva,
    tituloSeccion,
    descripcionSeccion,
    plantilla
  ) {
    try {
      const vista =
        await this.servicioJerarquiaOrganizativa.construirVistaOrganizacion(
          requisicion.contextoUsuarioActual
        );
      const subnavegacion =
        this.construirSubnavegacion(vista.capacidades, seccionActiva);

      if (!subnavegacion.algunAcceso) {
        respuesta.status(403).render('portal/forbidden', {
          titulo: 'Acceso denegado',
          permisoSolicitado:
            'administrar_tenants | administrar_empresas | administrar_sitios',
          usuarioActual: requisicion.session?.usuarioAutenticado ?? null
        });
        return;
      }

      if (!subnavegacion[seccionActiva]?.visible) {
        respuesta.status(403).render('portal/forbidden', {
          titulo: 'Acceso denegado',
          permisoSolicitado: `administrar_${seccionActiva}`,
          usuarioActual: requisicion.session?.usuarioAutenticado ?? null
        });
        return;
      }

      respuesta.render(plantilla, {
        titulo: tituloSeccion,
        usuarioActual: requisicion.session?.usuarioAutenticado ?? null,
        contextoUsuarioActual: requisicion.contextoUsuarioActual,
        resumen: vista.resumen,
        capacidades: vista.capacidades,
        tenants: vista.tenants,
        empresas: vista.empresas,
        sitios: vista.sitios,
        opcionesCrearEmpresa: vista.opcionesCrearEmpresa,
        opcionesCrearSitio: vista.opcionesCrearSitio,
        subnavegacionOrganizacion: subnavegacion,
        tituloSeccion,
        descripcionSeccion,
        flashOrganizacion: this.consumirFlash(requisicion)
      });
    } catch (error) {
      next(error);
    }
  }

  async renderizarFormularioTenant(
    requisicion,
    respuesta,
    next,
    {
      titulo,
      idTenant = null,
      formularioBase = null,
      errorFormulario = null,
      statusCode = 200
    } = {}
  ) {
    try {
      const vista =
        await this.servicioJerarquiaOrganizativa
          .construirVistaFormularioTenant(
            requisicion.contextoUsuarioActual,
            {
              idTenant,
              formularioBase,
              errorFormulario
            }
          );

      respuesta.status(statusCode).render('portal/organizacion-tenant-formulario', {
        titulo,
        usuarioActual: requisicion.session?.usuarioAutenticado ?? null,
        contextoUsuarioActual: requisicion.contextoUsuarioActual,
        flashOrganizacion: this.consumirFlash(requisicion),
        ...vista
      });
    } catch (error) {
      if (this.responderDenegacionPorAlcance(requisicion, respuesta, error)) {
        return;
      }
      next(error);
    }
  }

  responderDenegacionPorAlcance(requisicion, respuesta, error) {
    if (error?.statusCode !== 403 || !String(error?.codigo || '').startsWith('SCOPE_')) {
      return false;
    }

    respuesta.status(403).render('portal/forbidden', {
      titulo: 'Fuera de alcance',
      motivoAlcance: error.codigo === 'SCOPE_CREAR_TENANT'
        ? 'Crear tenants requiere alcance global del portal.'
        : 'Esta entidad o acción queda fuera del alcance de tu sesión.',
      usuarioActual: requisicion.session?.usuarioAutenticado ?? null
    });
    return true;
  }

  async renderizarFormularioEmpresa(
    requisicion,
    respuesta,
    next,
    {
      titulo,
      idEmpresa = null,
      formularioBase = null,
      errorFormulario = null,
      statusCode = 200
    } = {}
  ) {
    try {
      const vista =
        await this.servicioJerarquiaOrganizativa
          .construirVistaFormularioEmpresa(
            requisicion.contextoUsuarioActual,
            {
              idEmpresa,
              formularioBase,
              errorFormulario
            }
          );

      respuesta.status(statusCode).render('portal/organizacion-empresa-formulario', {
        titulo,
        usuarioActual: requisicion.session?.usuarioAutenticado ?? null,
        contextoUsuarioActual: requisicion.contextoUsuarioActual,
        flashOrganizacion: this.consumirFlash(requisicion),
        ...vista
      });
    } catch (error) {
      if (this.responderDenegacionPorAlcance(requisicion, respuesta, error)) {
        return;
      }
      next(error);
    }
  }

  async renderizarFormularioSitio(
    requisicion,
    respuesta,
    next,
    {
      titulo,
      idSitio = null,
      formularioBase = null,
      errorFormulario = null,
      statusCode = 200
    } = {}
  ) {
    try {
      const vista =
        await this.servicioJerarquiaOrganizativa
          .construirVistaFormularioSitio(
            requisicion.contextoUsuarioActual,
            {
              idSitio,
              formularioBase,
              errorFormulario
            }
          );

      respuesta.status(statusCode).render('portal/organizacion-sitio-formulario', {
        titulo,
        usuarioActual: requisicion.session?.usuarioAutenticado ?? null,
        contextoUsuarioActual: requisicion.contextoUsuarioActual,
        flashOrganizacion: this.consumirFlash(requisicion),
        ...vista
      });
    } catch (error) {
      if (this.responderDenegacionPorAlcance(requisicion, respuesta, error)) {
        return;
      }
      next(error);
    }
  }

  construirSubnavegacion(capacidades, seccionActiva) {
    return {
      algunAcceso:
        Boolean(capacidades.puedeVerTenants) ||
        Boolean(capacidades.puedeVerEmpresas) ||
        Boolean(capacidades.puedeVerSitios),
      tenants: {
        visible: Boolean(capacidades.puedeVerTenants),
        activa: seccionActiva === 'tenants',
        href: '/organizacion/tenants'
      },
      empresas: {
        visible: Boolean(capacidades.puedeVerEmpresas),
        activa: seccionActiva === 'empresas',
        href: '/organizacion/empresas'
      },
      sitios: {
        visible: Boolean(capacidades.puedeVerSitios),
        activa: seccionActiva === 'sitios',
        href: '/organizacion/sitios'
      }
    };
  }

  resolverRutaInicial(capacidades) {
    if (capacidades.puedeVerTenants) {
      return '/organizacion/tenants';
    }

    if (capacidades.puedeVerEmpresas) {
      return '/organizacion/empresas';
    }

    if (capacidades.puedeVerSitios) {
      return '/organizacion/sitios';
    }

    return null;
  }

  async ejecutarOperacion(requisicion, respuesta, rutaRetorno, operacion) {
    try {
      await operacion();

      if (this.esPeticionAjax(requisicion)) {
        respuesta.json({
          ok: true,
          redirectTo: rutaRetorno,
          flash: requisicion.session?.flashOrganizacion ?? null
        });
        return;
      }
    } catch (error) {
      if (this.esPeticionAjax(requisicion)) {
        respuesta.status(this.resolverStatusError(error)).json({
          ok: false,
          mensaje: error.message
        });
        return;
      }

      this.guardarFlash(requisicion, {
        tipo: 'error',
        mensaje: error.message
      });
    }

    respuesta.redirect(rutaRetorno);
  }

  async ejecutarOperacionJson(respuesta, operacion) {
    try {
      const payload = await operacion();
      respuesta.json({
        ok: true,
        ...payload
      });
    } catch (error) {
      respuesta.status(this.resolverStatusError(error)).json({
        ok: false,
        mensaje: error.message
      });
    }
  }

  consumirFlash(requisicion) {
    const flash = requisicion.session?.flashOrganizacion ?? null;

    if (requisicion.session) {
      delete requisicion.session.flashOrganizacion;
    }

    return flash;
  }

  guardarFlash(requisicion, flash) {
    if (requisicion.session) {
      requisicion.session.flashOrganizacion = flash;
    }
  }

  esPeticionAjax(requisicion) {
    return String(
      requisicion.get?.('x-requested-with') || ''
    ).trim().toLowerCase() === 'xmlhttprequest';
  }

  resolverStatusError(error) {
    const statusCode = Number(error?.statusCode);
    return Number.isInteger(statusCode) && statusCode >= 400 && statusCode <= 599
      ? statusCode
      : 400;
  }
}
