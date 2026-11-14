export class ControladorTriggers {
  constructor({
    servicioAdministracionTriggersPortal,
    servicioTriggers
  }) {
    this.servicioAdministracionTriggersPortal = servicioAdministracionTriggersPortal;
    this.servicioTriggers = servicioTriggers;
  }

  mostrarListado(_requisicion, respuesta) {
    respuesta.redirect('/automatizacion/acciones');
  }

  async mostrarAcciones(requisicion, respuesta, next) {
    await this.renderizarListado(requisicion, respuesta, next, {
      superficieListado: 'acciones'
    });
  }

  async mostrarEnlaces(requisicion, respuesta, next) {
    await this.renderizarListado(requisicion, respuesta, next, {
      superficieListado: 'enlaces'
    });
  }

  async renderizarListado(
    requisicion,
    respuesta,
    next,
    { superficieListado = 'acciones' } = {}
  ) {
    try {
      const puedeVerMonitores = Boolean(
        requisicion.contextoUsuarioActual?.permisos?.verMonitores
      );
      const vista = await this.servicioAdministracionTriggersPortal
        .construirVistaListadoAjaxShell(requisicion.contextoUsuarioActual);
      if (superficieListado === 'acciones') {
        const tenantSolicitado = String(requisicion.query.tenant_id || '').trim();
        const tenantVisible = vista.opcionesTenants.some(
          (opcion) => String(opcion.valor) === tenantSolicitado
        );
        const empresaSolicitada = String(
          requisicion.query.empresa_id || ''
        ).trim();
        const empresaVisible = vista.opcionesEmpresas.some(
          (opcion) =>
            String(opcion.valor) === empresaSolicitada &&
            (!tenantVisible || String(opcion.tenantId) === tenantSolicitado)
        );
        vista.filtrosTriggers = {
          ...vista.filtrosTriggers,
          tenantId: tenantVisible ? tenantSolicitado : '',
          empresaId: empresaVisible ? empresaSolicitada : '',
          sitioId: /^\d+$/.test(String(requisicion.query.sitio_id || ''))
            ? String(requisicion.query.sitio_id)
            : ''
        };
      }
      if (superficieListado === 'enlaces') {
        vista.filtrosVinculos = {
          ...vista.filtrosVinculos,
          triggerId: String(requisicion.query.trigger_id || '').trim(),
          monitorId: String(requisicion.query.monitor_id || '').trim()
        };
      }

      respuesta.render('portal/triggers', {
        titulo: superficieListado === 'enlaces'
          ? 'Enlaces monitor–acción'
          : 'Acciones',
        superficieListado,
        usuarioActual: requisicion.session?.usuarioAutenticado ?? null,
        flashTriggers: this.consumirFlash(requisicion),
        puedeVerMonitores,
        puedeEditarTriggers: Boolean(
          requisicion.contextoUsuarioActual?.permisos?.editarTriggers
        ),
        puedeGestionarVinculosTriggers: Boolean(
          requisicion.contextoUsuarioActual?.permisos?.gestionarVinculosTriggers
        ),
        retornoListado: this.normalizarRetorno(requisicion.query.return_to),
        ...vista
      });
    } catch (error) {
      next(error);
    }
  }

  async apiListarTriggers(requisicion, respuesta, next) {
    try {
      const vista =
        await this.servicioAdministracionTriggersPortal
          .listarTriggersAdministracion(
            requisicion.contextoUsuarioActual,
            {
              textoBusqueda: String(requisicion.query.q || '').trim(),
              tenantId: requisicion.query.tenant_id,
              empresaId: requisicion.query.empresa_id,
              sitioId: requisicion.query.sitio_id,
              tipo: String(requisicion.query.tipo || '').trim(),
              activo: String(requisicion.query.activo || 'todos').trim(),
              salud: String(requisicion.query.salud || '').trim(),
              pagina: requisicion.query.page,
              tamanoPagina: requisicion.query.page_size,
              ordenarPor: String(requisicion.query.sort_by || 'nombre').trim(),
              direccionOrden: String(
                requisicion.query.sort_dir || 'asc'
              ).trim()
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

  async apiListarVinculos(requisicion, respuesta, next) {
    try {
      const vista =
        await this.servicioAdministracionTriggersPortal
          .listarVinculosAdministracion(
            requisicion.contextoUsuarioActual,
            {
              textoBusqueda: String(requisicion.query.q || '').trim(),
              triggerId: requisicion.query.trigger_id,
              monitorId: requisicion.query.monitor_id,
              tenantId: requisicion.query.tenant_id,
              empresaId: requisicion.query.empresa_id,
              tipo: String(requisicion.query.tipo || '').trim(),
              activo: String(requisicion.query.activo || 'todos').trim(),
              eventoDisparo: String(
                requisicion.query.evento_disparo || ''
              ).trim(),
              pagina: requisicion.query.page,
              tamanoPagina: requisicion.query.page_size,
              ordenarPor: String(
                requisicion.query.sort_by || 'actualizado'
              ).trim(),
              direccionOrden: String(
                requisicion.query.sort_dir || 'desc'
              ).trim()
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

  async apiBuscarObjetivosDns(requisicion, respuesta, next) {
    try {
      const resultado =
        await this.servicioAdministracionTriggersPortal
          .buscarObjetivosDnsTrigger(
            requisicion.contextoUsuarioActual,
            {
              textoBusqueda: String(requisicion.query.q || '').trim(),
              zonaId: requisicion.query.zona_id,
              tenantId: requisicion.query.tenant_id,
              empresaId: requisicion.query.empresa_id,
              sitioId: requisicion.query.sitio_id,
              limite: requisicion.query.limit
            }
          );

      respuesta.json({
        ok: true,
        ...resultado
      });
    } catch (error) {
      next(error);
    }
  }

  async apiBuscarUsuariosCorreo(requisicion, respuesta, next) {
    try {
      const resultado = await this.servicioAdministracionTriggersPortal
        .buscarUsuariosAudienciaCorreo(requisicion.contextoUsuarioActual, {
          triggerId: requisicion.params.id,
          texto: requisicion.query.q,
          limite: requisicion.query.limit
        });
      respuesta.json({ ok: true, ...resultado });
    } catch (error) {
      next(error);
    }
  }

  async apiMutarAudienciaCorreo(requisicion, respuesta, next) {
    try {
      const resultado = await this.servicioAdministracionTriggersPortal
        .mutarAudienciaCorreo(requisicion.contextoUsuarioActual, {
          ...requisicion.body,
          triggerId: requisicion.params.id
        });
      respuesta.json({ ok: true, ...resultado });
    } catch (error) {
      if (error?.statusCode === 409) {
        respuesta.status(409).json({
          ok: false,
          codigo: error.codigo,
          mensaje: error.message,
          revisionActual: error.revisionActual ?? null
        });
        return;
      }
      next(error);
    }
  }

  async apiPrevisualizarCorreo(requisicion, respuesta, next) {
    try {
      const previa = await this.servicioAdministracionTriggersPortal
        .previsualizarCorreo(
          requisicion.contextoUsuarioActual,
          requisicion.params.id,
          requisicion.body
        );
      respuesta.json({ ok: true, previa });
    } catch (error) {
      next(error);
    }
  }

  async probarCorreo(requisicion, respuesta, next) {
    try {
      const resultado = await this.servicioAdministracionTriggersPortal
        .probarCorreo(
          requisicion.contextoUsuarioActual,
          requisicion.params.id,
          requisicion.body
        );
      this.guardarFlash(requisicion, {
        tipo: 'exito',
        mensaje: `Prueba de correo encolada como salida #${resultado.salidaId}.`
      });
      respuesta.redirect(`/monitores/triggers/editar/${requisicion.params.id}`);
    } catch (error) {
      await this.renderizarFormulario(requisicion, respuesta, next, {
        titulo: 'Editar trigger',
        idTrigger: Number(requisicion.params.id),
        formularioBase: { ...requisicion.body, id: requisicion.params.id },
        errorFormulario: error.message,
        statusCode: error.statusCode || 400
      });
    }
  }

  async apiDetalleCorreo(requisicion, respuesta, next) {
    try {
      const detalle = await this.servicioAdministracionTriggersPortal
        .leerDetalleCorreo(
          requisicion.contextoUsuarioActual,
          requisicion.params.ejecucionId
        );
      respuesta.json({ ok: true, detalle });
    } catch (error) {
      next(error);
    }
  }

  async apiBuscarMonitoresVinculo(requisicion, respuesta, next) {
    try {
      const resultado =
        await this.servicioAdministracionTriggersPortal
          .buscarMonitoresParaVinculoTrigger(
            requisicion.contextoUsuarioActual,
            {
              textoBusqueda: String(requisicion.query.q || '').trim(),
              tipo: String(requisicion.query.tipo || '').trim(),
              soloActivos: String(requisicion.query.solo_activos || '') === '1',
              pagina: requisicion.query.page,
              tamanoPagina:
                requisicion.query.page_size || requisicion.query.limit
            }
          );

      respuesta.json({
        ok: true,
        ...resultado
      });
    } catch (error) {
      next(error);
    }
  }

  async apiBuscarTriggersVinculo(requisicion, respuesta, next) {
    try {
      const resultado =
        await this.servicioAdministracionTriggersPortal
          .buscarTriggersParaVinculoMonitor(
            requisicion.contextoUsuarioActual,
            {
              textoBusqueda: String(requisicion.query.q || '').trim(),
              tipo: String(requisicion.query.tipo || '').trim(),
              soloActivos: String(requisicion.query.solo_activos || '') === '1',
              pagina: requisicion.query.page,
              tamanoPagina:
                requisicion.query.page_size || requisicion.query.limit
            }
          );

      respuesta.json({
        ok: true,
        ...resultado
      });
    } catch (error) {
      next(error);
    }
  }

  async mostrarNuevo(requisicion, respuesta, next) {
    const borradorFederado = requisicion.query.borrador_federado === '1'
      ? requisicion.session?.borradorTriggerFederado ?? null
      : null;
    if (borradorFederado && requisicion.session) {
      delete requisicion.session.borradorTriggerFederado;
    }
    await this.renderizarFormulario(requisicion, respuesta, next, {
      titulo: 'Nuevo trigger',
      formularioBase: borradorFederado?.formulario || null,
      tipoNuevo: requisicion.query.tipo,
      borradorFederado,
      retornoFormulario: this.normalizarRetorno(requisicion.query.return_to)
    });
  }

  async mostrarEditar(requisicion, respuesta, next) {
    const idTrigger = Number.parseInt(String(requisicion.params.id || ''), 10);

    await this.renderizarFormulario(requisicion, respuesta, next, {
      titulo: 'Editar trigger',
      idTrigger,
      retornoFormulario: this.normalizarRetorno(requisicion.query.return_to)
    });
  }

  async mostrarNuevoVinculo(requisicion, respuesta, next) {
    const triggerPreseleccionadoId = Number.parseInt(
      String(requisicion.query.trigger_id || ''),
      10
    );
    const monitorPreseleccionadoId = Number.parseInt(
      String(requisicion.query.monitor_id || ''),
      10
    );

    await this.renderizarFormularioVinculo(requisicion, respuesta, next, {
      titulo: 'Nuevo vínculo monitor-trigger',
      triggerPreseleccionadoId: Number.isInteger(triggerPreseleccionadoId)
        ? triggerPreseleccionadoId
        : null,
      monitorPreseleccionadoId: Number.isInteger(monitorPreseleccionadoId)
        ? monitorPreseleccionadoId
        : null,
      retornoListado: this.normalizarRetorno(requisicion.query.return_to)
    });
  }

  async mostrarEditarVinculo(requisicion, respuesta, next) {
    const idAsignacion = Number.parseInt(
      String(requisicion.params.id || ''),
      10
    );

    await this.renderizarFormularioVinculo(requisicion, respuesta, next, {
      titulo: 'Editar vínculo monitor-trigger',
      idAsignacion,
      retornoListado: this.normalizarRetorno(requisicion.query.return_to)
    });
  }

  async crearTrigger(requisicion, respuesta, next) {
    try {
      const retorno =
        this.normalizarRetorno(requisicion.body.return_to) ||
        '/automatizacion/acciones';
      const trigger =
        await this.servicioAdministracionTriggersPortal.crearTrigger(
          requisicion.contextoUsuarioActual,
          requisicion.body
        );
      this.guardarFlash(requisicion, {
        tipo: 'exito',
        mensaje: `Trigger ${trigger.nombre} creado.`
      }, retorno);
      respuesta.redirect(retorno);
    } catch (error) {
      if (this.redirigirCorreoNoDisponible(requisicion, respuesta, error)) return;
      await this.renderizarFormulario(requisicion, respuesta, next, {
        titulo: 'Nuevo trigger',
        formularioBase: requisicion.body,
        errorFormulario: error.message,
        statusCode: error.statusCode || 400
      });
    }
  }

  async actualizarTrigger(requisicion, respuesta, next) {
    const idTrigger = Number.parseInt(String(requisicion.params.id || ''), 10);
    const retorno =
      this.normalizarRetorno(requisicion.body.return_to) ||
      '/automatizacion/acciones';

    try {
      const trigger =
        await this.servicioAdministracionTriggersPortal.actualizarTrigger(
          requisicion.contextoUsuarioActual,
          idTrigger,
          requisicion.body
        );
      this.guardarFlash(requisicion, {
        tipo: 'exito',
        mensaje: `Trigger ${trigger.nombre} actualizado.`
      }, retorno);
      respuesta.redirect(retorno);
    } catch (error) {
      if (this.redirigirCorreoNoDisponible(requisicion, respuesta, error)) return;
      await this.renderizarFormulario(requisicion, respuesta, next, {
        titulo: 'Editar trigger',
        idTrigger,
        formularioBase: {
          ...requisicion.body,
          id: idTrigger
        },
        errorFormulario: error.message,
        statusCode: error.statusCode || 400
      });
    }
  }

  async crearVinculo(requisicion, respuesta, next) {
    const retorno = this.resolverDestinoRetorno(requisicion.body.return_to);

    try {
      const asignacion =
        await this.servicioAdministracionTriggersPortal
          .crearVinculoMonitorTrigger(
            requisicion.contextoUsuarioActual,
            requisicion.body
          );
      const nombreTrigger =
        asignacion?.trigger?.nombre ||
        asignacion?.triggerNombre ||
        `#${asignacion?.triggerId}`;
      const nombreMonitor =
        asignacion?.monitor?.nombre ||
        asignacion?.monitorNombre ||
        `#${asignacion?.monitorId}`;

      this.guardarFlash(requisicion, {
        tipo: 'exito',
        mensaje: `Vínculo creado entre ${nombreMonitor} y ${nombreTrigger}.`
      }, retorno);
      respuesta.redirect(retorno);
    } catch (error) {
      await this.renderizarFormularioVinculo(requisicion, respuesta, next, {
        titulo: 'Nuevo vínculo monitor-trigger',
        formularioBase: requisicion.body,
        triggerPreseleccionadoId: requisicion.body?.triggerId || requisicion.body?.trigger_id,
        monitorPreseleccionadoId: requisicion.body?.monitorId || requisicion.body?.monitor_id,
        retornoListado: this.normalizarRetorno(requisicion.body.return_to),
        errorFormulario: error.message,
        statusCode: 400
      });
    }
  }

  async actualizarVinculo(requisicion, respuesta, next) {
    const idAsignacion = Number.parseInt(
      String(requisicion.params.id || ''),
      10
    );
    const retorno = this.resolverDestinoRetorno(requisicion.body.return_to);

    try {
      const asignacion =
        await this.servicioAdministracionTriggersPortal
          .actualizarVinculoMonitorTrigger(
            requisicion.contextoUsuarioActual,
            idAsignacion,
            requisicion.body
          );
      const nombreTrigger =
        asignacion?.trigger?.nombre ||
        asignacion?.triggerNombre ||
        `#${asignacion?.triggerId}`;
      const nombreMonitor =
        asignacion?.monitor?.nombre ||
        asignacion?.monitorNombre ||
        `#${asignacion?.monitorId}`;

      this.guardarFlash(requisicion, {
        tipo: 'exito',
        mensaje: `Vínculo actualizado entre ${nombreMonitor} y ${nombreTrigger}.`
      }, retorno);
      respuesta.redirect(retorno);
    } catch (error) {
      await this.renderizarFormularioVinculo(requisicion, respuesta, next, {
        titulo: 'Editar vínculo monitor-trigger',
        idAsignacion,
        formularioBase: {
          ...requisicion.body,
          id: idAsignacion
        },
        retornoListado: this.normalizarRetorno(requisicion.body.return_to),
        errorFormulario: error.message,
        statusCode: 400
      });
    }
  }

  async eliminarTrigger(requisicion, respuesta, _next) {
    try {
      const idTrigger = Number.parseInt(String(requisicion.body.id || ''), 10);
      const trigger =
        await this.servicioAdministracionTriggersPortal.eliminarTrigger(
          requisicion.contextoUsuarioActual,
          idTrigger,
          requisicion.body.revisionDeclaracion ??
            requisicion.body.revision_declaracion
        );
      this.guardarFlash(requisicion, {
        tipo: 'exito',
        mensaje: `Trigger ${trigger.nombre} eliminado.`
      });
    } catch (error) {
      this.guardarFlash(requisicion, {
        tipo: 'error',
        mensaje: error.message
      });
    }

    respuesta.redirect('/automatizacion/acciones');
  }

  async eliminarVinculo(requisicion, respuesta, _next) {
    const idAsignacion = Number.parseInt(
      String(requisicion.body.id || ''),
      10
    );
    const retorno = this.resolverDestinoRetorno(requisicion.body.return_to);

    try {
      const asignacion =
        await this.servicioAdministracionTriggersPortal
          .eliminarVinculoMonitorTrigger(
            requisicion.contextoUsuarioActual,
            idAsignacion
          );
      const nombreTrigger =
        asignacion?.trigger?.nombre ||
        asignacion?.triggerNombre ||
        `#${asignacion?.triggerId}`;
      const nombreMonitor =
        asignacion?.monitor?.nombre ||
        asignacion?.monitorNombre ||
        `#${asignacion?.monitorId}`;

      this.guardarFlash(requisicion, {
        tipo: 'exito',
        mensaje: `Vínculo eliminado entre ${nombreMonitor} y ${nombreTrigger}.`
      }, retorno);
    } catch (error) {
      this.guardarFlash(requisicion, {
        tipo: 'error',
        mensaje: error.message
      }, retorno);
    }

    respuesta.redirect(retorno);
  }

  async renderizarFormulario(
    requisicion,
    respuesta,
    next,
    {
      titulo,
      idTrigger = null,
      formularioBase = null,
      tipoNuevo = null,
      errorFormulario = null,
      statusCode = 200,
      borradorFederado = null,
      retornoFormulario = null
    }
  ) {
    try {
      const vista = await this.servicioAdministracionTriggersPortal
        .construirVistaFormulario(requisicion.contextoUsuarioActual, {
          idTrigger,
          formularioBase,
          tipoNuevo
        });

      const retornoSolicitado =
        this.normalizarRetorno(formularioBase?.return_to) ||
        this.normalizarRetorno(retornoFormulario) ||
        this.normalizarRetorno(requisicion.query.return_to);

      respuesta.status(statusCode).render('portal/trigger-formulario', {
        titulo,
        usuarioActual: requisicion.session?.usuarioAutenticado ?? null,
        errorFormulario,
        borradorFederado,
        retornoFormulario: retornoSolicitado || '/automatizacion/acciones',
        tieneRetornoFormulario: Boolean(retornoSolicitado),
        ...vista
      });
    } catch (error) {
      if (this.redirigirCorreoNoDisponible(requisicion, respuesta, error)) return;
      next(error);
    }
  }

  async renderizarFormularioVinculo(
    requisicion,
    respuesta,
    next,
    {
      titulo,
      idAsignacion = null,
      formularioBase = null,
      triggerPreseleccionadoId = null,
      monitorPreseleccionadoId = null,
      errorFormulario = null,
      statusCode = 200,
      retornoListado = null
    }
  ) {
    try {
      const retornoNormalizado =
        this.normalizarRetorno(formularioBase?.return_to) ||
        this.normalizarRetorno(retornoListado) ||
        this.normalizarRetorno(requisicion.query.return_to) ||
        '/automatizacion/enlaces';
      const vista =
        await this.servicioAdministracionTriggersPortal
          .construirVistaFormularioVinculo(
            requisicion.contextoUsuarioActual,
            {
              idAsignacion,
              formularioBase,
              triggerPreseleccionadoId,
              monitorPreseleccionadoId
            }
          );

      respuesta.status(statusCode).render('portal/trigger-vinculo-formulario', {
        titulo,
        usuarioActual: requisicion.session?.usuarioAutenticado ?? null,
        puedeEditarTriggers: Boolean(
          requisicion.contextoUsuarioActual?.permisos?.editarTriggers
        ),
        errorFormulario,
        retornoListado: retornoNormalizado,
        ...vista
      });
    } catch (error) {
      next(error);
    }
  }

  redirigirCorreoNoDisponible(requisicion, respuesta, error) {
    if (error?.codigo !== 'trigger_correo_no_habilitado') return false;
    const destino = '/automatizacion/acciones';
    this.guardarFlash(requisicion, {
      tipo: 'error',
      mensaje: 'Las acciones de correo todavía no están disponibles en esta instalación. ' +
        'Consulta con el administrador para revisar su activación.'
    }, destino);
    respuesta.redirect(destino);
    return true;
  }

  consumirFlash(requisicion) {
    const flash = requisicion.session?.flashTriggers ?? null;

    if (requisicion.session) {
      delete requisicion.session.flashTriggers;
    }

    return flash;
  }

  guardarFlash(requisicion, flash, retorno) {
    if (requisicion.session) {
      if (this.esRetornoDetalleMonitor(retorno)) {
        requisicion.session.flashMonitores = flash;
        return;
      }

      requisicion.session.flashTriggers = flash;
    }
  }

  normalizarRetorno(valor) {
    const retorno = String(valor || '').trim();

    const esRetornoMonitores =
      /^\/monitores(?:\/(?:editar\/)?\d+)?(?:\?.*)?$/.test(retorno);
    const esRetornoAccion =
      /^\/monitores\/triggers\/editar\/\d+(?:\?.*)?$/.test(retorno);
    const esRetornoEnlace =
      /^\/monitores\/triggers\/vinculos\/editar\/\d+(?:\?.*)?$/.test(retorno);
    const esRetornoAutomatizacion =
      /^\/automatizacion\/(acciones|enlaces)(\?.*)?$/.test(retorno);

    if (!esRetornoMonitores && !esRetornoAccion && !esRetornoEnlace && !esRetornoAutomatizacion) {
      return null;
    }

    return retorno;
  }

  resolverDestinoRetorno(retorno) {
    return this.normalizarRetorno(retorno) || '/automatizacion/enlaces';
  }

  esRetornoDetalleMonitor(retorno) {
    const normalizado = this.normalizarRetorno(retorno);

    if (
      !normalizado ||
      normalizado.startsWith('/monitores/triggers') ||
      normalizado.startsWith('/automatizacion')
    ) {
      return false;
    }

    return /^\/monitores\/(?:editar\/)?\d+(\?.*)?$/.test(normalizado);
  }
}
