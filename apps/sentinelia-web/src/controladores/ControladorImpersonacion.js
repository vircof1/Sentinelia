export class ControladorImpersonacion {
  constructor({
    servicioUsuarios,
    servicioSesion
  }) {
    this.servicioUsuarios = servicioUsuarios;
    this.servicioSesion = servicioSesion;
  }

  async apiBuscarUsuariosImpersonables(requisicion, respuesta) {
    await this.ejecutarOperacionJson(respuesta, async () => {
      const vista = await this.servicioUsuarios.listarUsuariosImpersonables(
        requisicion.contextoUsuarioActual,
        requisicion.session?.usuarioAutenticado ?? null,
        {
          textoBusqueda: String(requisicion.query.q || '').trim(),
          tenantId: requisicion.query.tenant_id,
          empresaId: requisicion.query.empresa_id,
          sitioId: requisicion.query.sitio_id,
          activo: String(requisicion.query.activo || 'todos').trim(),
          pagina: requisicion.query.page,
          tamanoPagina: requisicion.query.page_size,
          ordenarPor: String(requisicion.query.sort_by || 'usuario').trim(),
          direccionOrden: String(requisicion.query.sort_dir || 'asc').trim()
        }
      );

      return vista;
    });
  }

  async apiIniciarImpersonacion(requisicion, respuesta) {
    await this.ejecutarOperacionJson(respuesta, async () => {
      const resolucion = await this.servicioUsuarios.iniciarImpersonacion(
        requisicion.contextoUsuarioActual,
        requisicion.session?.usuarioAutenticado ?? null,
        requisicion.body?.id_usuario
      );

      await this.servicioSesion.iniciarImpersonacionUsuario(
        requisicion,
        {
          usuarioReal: resolucion.usuarioReal,
          usuarioEfectivo: resolucion.usuarioObjetivo
        }
      );

      return {
        mensaje: `Ahora operas como ${resolucion.usuarioObjetivo.obtenerNombreVisible()}.`,
        contexto: {
          usuarioReal: resolucion.usuarioReal.obtenerNombreVisible(),
          usuarioEfectivo: resolucion.usuarioObjetivo.obtenerNombreVisible(),
          impersonacionActiva: true
        }
      };
    });
  }

  async apiRevertirImpersonacion(requisicion, respuesta) {
    await this.ejecutarOperacionJson(respuesta, async () => {
      const resolucion = await this.servicioUsuarios.revertirImpersonacion(
        requisicion.contextoUsuarioActual,
        requisicion.session?.usuarioAutenticado ?? null
      );

      await this.servicioSesion.revertirImpersonacionUsuario(
        requisicion,
        resolucion.usuarioReal
      );

      return {
        mensaje: `Has vuelto a la identidad real ${resolucion.usuarioReal.obtenerNombreVisible()}.`,
        contexto: {
          usuarioReal: resolucion.usuarioReal.obtenerNombreVisible(),
          usuarioEfectivo: resolucion.usuarioReal.obtenerNombreVisible(),
          impersonacionActiva: false
        }
      };
    });
  }

  async apiOpcionesEmpresas(requisicion, respuesta) {
    await this.ejecutarOperacionJson(respuesta, async () => {
      const opciones =
        await this.servicioUsuarios.obtenerOpcionesEmpresasImpersonacion(
          requisicion.contextoUsuarioActual,
          requisicion.session?.usuarioAutenticado ?? null,
          requisicion.query.tenant_id
        );

      return { opciones };
    });
  }

  async apiOpcionesTenants(requisicion, respuesta) {
    await this.ejecutarOperacionJson(respuesta, async () => {
      const opciones =
        await this.servicioUsuarios.obtenerOpcionesTenantsImpersonacion(
          requisicion.contextoUsuarioActual,
          requisicion.session?.usuarioAutenticado ?? null
        );

      return { opciones };
    });
  }

  async apiOpcionesSitios(requisicion, respuesta) {
    await this.ejecutarOperacionJson(respuesta, async () => {
      const opciones =
        await this.servicioUsuarios.obtenerOpcionesSitiosImpersonacion(
          requisicion.contextoUsuarioActual,
          requisicion.session?.usuarioAutenticado ?? null,
          requisicion.query.tenant_id,
          requisicion.query.empresa_id
        );

      return { opciones };
    });
  }

  async ejecutarOperacionJson(respuesta, operacion) {
    try {
      const payload = await operacion();
      respuesta.json({
        ok: true,
        ...payload
      });
    } catch (error) {
      respuesta.status(error.codigoHttp || 400).json({
        ok: false,
        mensaje: error.message
      });
    }
  }
}
