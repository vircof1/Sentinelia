export class ControladorDns {
  constructor({
    servicioLecturaDnsPortal,
    servicioAdministracionDnsPortal = null,
    servicioAplicacionDdnsAgentes = null
  }) {
    this.servicioLecturaDnsPortal = servicioLecturaDnsPortal;
    this.servicioAdministracionDnsPortal = servicioAdministracionDnsPortal;
    this.servicioAplicacionDdnsAgentes = servicioAplicacionDdnsAgentes;
  }

  async mostrarListado(requisicion, respuesta, next) {
    try {
      const vista = await this.construirVistaListado(
        requisicion.contextoUsuarioActual,
        requisicion.query
      );

      respuesta.render('portal/dns', {
        titulo: 'DNS',
        usuarioActual: requisicion.session?.usuarioAutenticado ?? null,
        flashDns: this.consumirFlash(requisicion),
        retornoHero: requisicion.query.return_to
          ? this.normalizarRetorno(requisicion.query.return_to)
          : null,
        ...vista
      });
    } catch (error) {
      next(error);
    }
  }

  async mostrarListadoApi(requisicion, respuesta, next) {
    try {
      const vista = await this.construirVistaListado(
        requisicion.contextoUsuarioActual,
        requisicion.query
      );

      respuesta.json({
        ok: true,
        alcanceActual: vista.alcanceActual,
        filtros: vista.filtros,
        resumen: vista.resumen,
        paginacion: vista.paginacion,
        zonas: vista.zonas || []
      });
    } catch (error) {
      next(error);
    }
  }

  async mostrarDetalle(requisicion, respuesta, next) {
    const idZona = Number.parseInt(String(requisicion.params.id || ''), 10);

    try {
      const filtros = {
        q: requisicion.query.q,
        tipo_registro: requisicion.query.tipo_registro,
        activo: requisicion.query.activo,
        page: requisicion.query.page,
        page_size: requisicion.query.page_size
      };
      const vista = this.servicioAdministracionDnsPortal
        ? await this.servicioAdministracionDnsPortal.construirVistaDetalle(
            requisicion.contextoUsuarioActual,
            idZona,
            filtros
          )
        : await this.servicioLecturaDnsPortal.construirVistaDetalle(
            requisicion.contextoUsuarioActual,
            idZona,
            filtros
          );
      const retornoListado = this.normalizarRetorno(requisicion.query.return_to);
      const retornoDetalle = this.construirRetornoDetalle(
        idZona,
        requisicion.query,
        retornoListado
      );

      respuesta.render('portal/dns-detalle', {
        titulo: `Zona DNS ${vista.zona?.nombreZona || idZona}`,
        usuarioActual: requisicion.session?.usuarioAutenticado ?? null,
        ...vista,
        retornoListado,
        retornoDetalle,
        flashDns: this.consumirFlash(requisicion)
      });
    } catch (error) {
      if (
        error?.message ===
        'La zona DNS indicada no existe o no está dentro de tu alcance.'
      ) {
        respuesta.status(404).send(error.message);
        return;
      }

      if (this.esErrorPermisoPublicacionDns(error)) {
        this.renderizarAccesoDenegadoPublicacionDns(requisicion, respuesta);
        return;
      }

      next(error);
    }
  }

  async mostrarNuevo(requisicion, respuesta, next) {
    await this.renderizarFormulario(requisicion, respuesta, next, {
      titulo: 'Nueva zona DNS',
      retornoListado: this.normalizarRetorno(requisicion.query.return_to)
    });
  }

  async mostrarEditar(requisicion, respuesta, next) {
    const idZona = Number.parseInt(String(requisicion.params.id || ''), 10);

    await this.renderizarFormulario(requisicion, respuesta, next, {
      titulo: 'Editar zona DNS',
      idZona,
      retornoListado: this.normalizarRetorno(requisicion.query.return_to)
    });
  }

  async crearZona(requisicion, respuesta, next) {
    const retornoListado = this.normalizarRetorno(requisicion.body.return_to);

    try {
      const zona = await this.servicioAdministracionDnsPortal.crearZona(
        requisicion.contextoUsuarioActual,
        requisicion.body
      );
      this.guardarFlash(requisicion, {
        tipo: 'exito',
        mensaje: `Zona DNS ${zona.nombreZona} creada.`
      });
      respuesta.redirect(retornoListado);
    } catch (error) {
      await this.renderizarFormulario(requisicion, respuesta, next, {
        titulo: 'Nueva zona DNS',
        formularioBase: requisicion.body,
        retornoListado,
        errorFormulario: error.message,
        statusCode: 400
      });
    }
  }

  async actualizarZona(requisicion, respuesta, next) {
    const idZona = Number.parseInt(String(requisicion.params.id || ''), 10);
    const retornoListado = this.normalizarRetorno(requisicion.body.return_to);

    try {
      const zona = await this.servicioAdministracionDnsPortal.actualizarZona(
        requisicion.contextoUsuarioActual,
        idZona,
        requisicion.body
      );
      this.guardarFlash(requisicion, {
        tipo: 'exito',
        mensaje: `Zona DNS ${zona.nombreZona} actualizada.`
      });
      respuesta.redirect(`/dns/${zona.id}?return_to=${encodeURIComponent(retornoListado)}`);
    } catch (error) {
      await this.renderizarFormulario(requisicion, respuesta, next, {
        titulo: 'Editar zona DNS',
        idZona,
        formularioBase: {
          ...requisicion.body,
          id: idZona
        },
        retornoListado,
        errorFormulario: error.message,
        statusCode: 400
      });
    }
  }

  async eliminarZona(requisicion, respuesta, next) {
    const idZona = Number.parseInt(
      String(requisicion.body.id_zona ?? requisicion.body.id ?? ''),
      10
    );
    const retornoListado = this.normalizarRetorno(requisicion.body.return_to);

    try {
      const zona = await this.servicioAdministracionDnsPortal.eliminarZona(
        requisicion.contextoUsuarioActual,
        idZona
      );
      this.guardarFlash(requisicion, {
        tipo: 'exito',
        mensaje: `Zona DNS ${zona.nombreZona} eliminada.`
      });
      respuesta.redirect(retornoListado);
    } catch (error) {
      this.guardarFlash(requisicion, {
        tipo: 'error',
        mensaje: error.message
      });
      respuesta.redirect(retornoListado);
    }
  }

  async mostrarImpactoEliminacionZona(requisicion, respuesta, next) {
    try {
      const impacto = await this.servicioAdministracionDnsPortal
        .obtenerImpactoEliminacionZona(
          requisicion.contextoUsuarioActual,
          requisicion.params.id
        );
      respuesta.json({ ok: true, impacto });
    } catch (error) {
      if (error.statusCode) {
        respuesta.status(error.statusCode).json({ ok: false, mensaje: error.message });
        return;
      }
      next(error);
    }
  }

  async mostrarImpactoEliminacionRegistro(requisicion, respuesta, next) {
    try {
      const impacto = await this.servicioAdministracionDnsPortal
        .obtenerImpactoEliminacionRegistro(
          requisicion.contextoUsuarioActual,
          requisicion.params.id,
          requisicion.params.registroId
        );
      respuesta.set('Cache-Control', 'no-store');
      respuesta.json({ ok: true, impacto });
    } catch (error) {
      if (error.statusCode) {
        respuesta.status(error.statusCode).json({ ok: false, mensaje: error.message });
        return;
      }
      next(error);
    }
  }

  async mostrarNuevoRegistro(requisicion, respuesta, next) {
    const idZona = Number.parseInt(String(requisicion.params.id || ''), 10);

    await this.renderizarFormularioRegistro(requisicion, respuesta, next, {
      titulo: 'Nuevo registro DNS',
      idZona,
      retornoDetalle: this.normalizarRetorno(
        requisicion.query.return_to || `/dns/${idZona}`
      )
    });
  }

  async mostrarEditarRegistro(requisicion, respuesta, next) {
    const idZona = Number.parseInt(String(requisicion.params.id || ''), 10);
    const idRegistro = Number.parseInt(
      String(requisicion.params.registroId || ''),
      10
    );

    await this.renderizarFormularioRegistro(requisicion, respuesta, next, {
      titulo: 'Editar registro DNS',
      idZona,
      idRegistro,
      retornoDetalle: this.normalizarRetorno(
        requisicion.query.return_to || `/dns/${idZona}`
      )
    });
  }

  async revocarConcesionDdns(requisicion, respuesta, next) {
    const idZona = Number.parseInt(String(requisicion.params.id || ''), 10);
    const registroDnsId = Number.parseInt(
      String(requisicion.params.registroId || ''),
      10
    );
    const retornoDetalle = this.normalizarRetorno(
      requisicion.body.return_to || `/dns/${idZona}`
    );
    try {
      const resultado = await this.servicioAplicacionDdnsAgentes
        .revocarDesdeRegistro({
          contextoUsuarioActual: requisicion.contextoUsuarioActual,
          registroDnsId,
          concesionId: requisicion.params.concesionId
        });
      this.guardarFlash(requisicion, {
        tipo: resultado.efectuada ? 'exito' : 'informacion',
        mensaje: resultado.efectuada
          ? 'Concesión DDNS revocada desde el registro DNS.'
          : 'La concesión DDNS ya estaba revocada.'
      });
      respuesta.redirect(
        `/dns/${idZona}/registros/${registroDnsId}/editar?return_to=${encodeURIComponent(retornoDetalle)}`
      );
    } catch (error) {
      next(error);
    }
  }

  async crearRegistro(requisicion, respuesta, next) {
    const idZona = Number.parseInt(String(requisicion.params.id || ''), 10);
    const retornoDetalle = this.normalizarRetorno(
      requisicion.body.return_to || `/dns/${idZona}`
    );

    try {
      const registro = await this.servicioAdministracionDnsPortal.crearRegistro(
        requisicion.contextoUsuarioActual,
        idZona,
        requisicion.body
      );
      this.guardarFlash(requisicion, {
        tipo: 'exito',
        mensaje: `Registro DNS ${registro.nombreVisible} creado.`
      });
      respuesta.redirect(retornoDetalle);
    } catch (error) {
      await this.renderizarFormularioRegistro(requisicion, respuesta, next, {
        titulo: 'Nuevo registro DNS',
        idZona,
        formularioBase: requisicion.body,
        retornoDetalle,
        errorFormulario: error.message,
        statusCode: 400
      });
    }
  }

  async actualizarRegistro(requisicion, respuesta, next) {
    const idZona = Number.parseInt(String(requisicion.params.id || ''), 10);
    const idRegistro = Number.parseInt(
      String(requisicion.params.registroId || ''),
      10
    );
    const retornoDetalle = this.normalizarRetorno(
      requisicion.body.return_to || `/dns/${idZona}`
    );

    try {
      const registro =
        await this.servicioAdministracionDnsPortal.actualizarRegistro(
          requisicion.contextoUsuarioActual,
          idZona,
          idRegistro,
          requisicion.body
        );
      this.guardarFlash(requisicion, {
        tipo: 'exito',
        mensaje: `Registro DNS ${registro.nombreVisible} actualizado.`
      });
      respuesta.redirect(retornoDetalle);
    } catch (error) {
      await this.renderizarFormularioRegistro(requisicion, respuesta, next, {
        titulo: 'Editar registro DNS',
        idZona,
        idRegistro,
        formularioBase: {
          ...requisicion.body,
          id: idRegistro
        },
        retornoDetalle,
        errorFormulario: error.message,
        statusCode: 400
      });
    }
  }

  async eliminarRegistro(requisicion, respuesta, next) {
    const idZona = Number.parseInt(String(requisicion.params.id || ''), 10);
    const idRegistro = Number.parseInt(
      String(requisicion.body.id_registro ?? requisicion.params.registroId ?? ''),
      10
    );
    const retornoDetalle = this.normalizarRetorno(
      requisicion.body.return_to || `/dns/${idZona}`
    );

    try {
      const registro =
        await this.servicioAdministracionDnsPortal.eliminarRegistro(
          requisicion.contextoUsuarioActual,
          idZona,
          idRegistro
        );
      this.guardarFlash(requisicion, {
        tipo: 'exito',
        mensaje: `Registro DNS ${registro.nombreVisible} eliminado.`
      });
      respuesta.redirect(retornoDetalle);
    } catch (error) {
      this.guardarFlash(requisicion, {
        tipo: 'error',
        mensaje: error.message
      });
      respuesta.redirect(retornoDetalle);
    }
  }

  normalizarRetorno(retorno) {
    const retornoNormalizado = String(retorno || '').trim();
    return retornoNormalizado.startsWith('/dns') ||
      /^\/monitores\/triggers\/editar\/\d+(?:\?[^#]*)?$/.test(retornoNormalizado)
      ? retornoNormalizado
      : '/dns';
  }

  construirRetornoDetalle(idZona, query = {}, retornoListado = '/dns') {
    const parametros = new URLSearchParams();
    const retorno = this.normalizarRetorno(retornoListado);
    const q = String(query.q || '').trim();
    const tipoRegistro = String(query.tipo_registro || '').trim();
    const activo = String(query.activo || '').trim();
    const pagina = String(query.page || '').trim();
    const tamanoPagina = String(query.page_size || '').trim();

    parametros.set('return_to', retorno);

    if (q) {
      parametros.set('q', q);
    }

    if (tipoRegistro) {
      parametros.set('tipo_registro', tipoRegistro);
    }

    if (activo) {
      parametros.set('activo', activo);
    }

    if (pagina) {
      parametros.set('page', pagina);
    }

    if (tamanoPagina) {
      parametros.set('page_size', tamanoPagina);
    }

    return `/dns/${idZona}?${parametros.toString()}`;
  }

  async renderizarFormulario(
    requisicion,
    respuesta,
    next,
    {
      titulo,
      idZona = null,
      formularioBase = null,
      retornoListado = '/dns',
      errorFormulario = null,
      statusCode = 200
    } = {}
  ) {
    try {
      const vista =
        await this.servicioAdministracionDnsPortal.construirVistaFormulario(
          requisicion.contextoUsuarioActual,
          {
            idZona,
            formularioBase,
            errorFormulario,
            retornoListado
          }
        );

      respuesta.status(statusCode).render('portal/dns-formulario', {
        titulo,
        usuarioActual: requisicion.session?.usuarioAutenticado ?? null,
        ...vista
      });
    } catch (error) {
      if (
        error?.message ===
        'La zona DNS indicada no existe o no está dentro de tu alcance.'
      ) {
        respuesta.status(404).send(error.message);
        return;
      }

      next(error);
    }
  }

  async renderizarFormularioRegistro(
    requisicion,
    respuesta,
    next,
    {
      titulo,
      idZona,
      idRegistro = null,
      formularioBase = null,
      retornoDetalle = null,
      errorFormulario = null,
      statusCode = 200
    } = {}
  ) {
    try {
      const vista =
        await this.servicioAdministracionDnsPortal
          .construirVistaFormularioRegistro(
            requisicion.contextoUsuarioActual,
            idZona,
            {
              idRegistro,
              formularioBase,
              errorFormulario,
              retornoDetalle
            }
          );

      respuesta.status(statusCode).render('portal/dns-registro-formulario', {
        titulo,
        usuarioActual: requisicion.session?.usuarioAutenticado ?? null,
        ...vista
      });
    } catch (error) {
      if (
        error?.message ===
          'La zona DNS indicada no existe o no está dentro de tu alcance.' ||
        error?.message ===
          'El registro DNS indicado no existe o no pertenece a la zona visible.'
      ) {
        respuesta.status(404).send(error.message);
        return;
      }

      if (this.esErrorPermisoPublicacionDns(error)) {
        this.renderizarAccesoDenegadoPublicacionDns(requisicion, respuesta);
        return;
      }

      next(error);
    }
  }

  consumirFlash(requisicion) {
    const flash = requisicion.session?.flashDns ?? null;

    if (requisicion.session?.flashDns) {
      delete requisicion.session.flashDns;
    }

    return flash;
  }

  guardarFlash(requisicion, flash) {
    if (requisicion.session) {
      requisicion.session.flashDns = flash;
    }
  }

  esErrorPermisoPublicacionDns(error) {
    return String(error?.message || '').includes('Publicar DNS');
  }

  renderizarAccesoDenegadoPublicacionDns(requisicion, respuesta) {
    respuesta.status(403).render('portal/forbidden', {
      titulo: 'Acceso denegado',
      permisoSolicitado: 'publicar_dns',
      usuarioActual: requisicion.session?.usuarioAutenticado ?? null
    });
  }

  async construirVistaListado(contextoUsuarioActual, query = {}) {
    const filtros = {
      sitio_id: query.sitio_id,
      q: query.q,
      tipo: query.tipo,
      categoria_origen: query.categoria_origen,
      estado_publicacion: query.estado_publicacion,
      activo: query.activo,
      page: query.page,
      page_size: query.page_size
    };

    return this.servicioAdministracionDnsPortal
      ? this.servicioAdministracionDnsPortal.construirVistaListado(
          contextoUsuarioActual,
          filtros
        )
      : this.servicioLecturaDnsPortal.construirVistaListado(
          contextoUsuarioActual,
          filtros
        );
  }
}
