export class ControladorPortal {
  constructor({
    resolutorScopeUsuario,
    resumenArranque,
    servicioAutorizacion,
    servicioConfiguracionPortal,
    servicioDisponibilidadRecuperacionPassword = null,
    servicioPresentacionRedPublicaFederacion = null,
    servicioCorreoPortal,
    servicioVerificacionCorreoOperativo,
    servicioDashboard,
    servicioGestionAlertasActivasPortal,
    servicioPresentacionAvisosPlataforma = null,
    servicioAlertasRemotasPortal = null,
    repositorioTenants = null,
    repositorioEmpresas = null,
    repositorioSitios = null,
    difusorWebSocketPortal = null
  }) {
    this.resolutorScopeUsuario = resolutorScopeUsuario;
    this.resumenArranque = resumenArranque;
    this.servicioAutorizacion = servicioAutorizacion;
    this.servicioConfiguracionPortal = servicioConfiguracionPortal;
    this.servicioDisponibilidadRecuperacionPassword =
      servicioDisponibilidadRecuperacionPassword;
    this.servicioPresentacionRedPublicaFederacion =
      servicioPresentacionRedPublicaFederacion;
    this.servicioCorreoPortal = servicioCorreoPortal;
    this.servicioVerificacionCorreoOperativo =
      servicioVerificacionCorreoOperativo;
    this.servicioDashboard = servicioDashboard;
    this.servicioGestionAlertasActivasPortal =
      servicioGestionAlertasActivasPortal;
    this.servicioPresentacionAvisosPlataforma =
      servicioPresentacionAvisosPlataforma;
    this.servicioAlertasRemotasPortal = servicioAlertasRemotasPortal;
    this.repositorioTenants = repositorioTenants;
    this.repositorioEmpresas = repositorioEmpresas;
    this.repositorioSitios = repositorioSitios;
    this.difusorWebSocketPortal = difusorWebSocketPortal;
  }

  async apiResumenAvisosPlataforma(requisicion, respuesta, next) {
    try {
      const resumen = await this.servicioPresentacionAvisosPlataforma
        .obtenerResumen(requisicion.contextoUsuarioActual);
      respuesta.set('Cache-Control', 'no-store').json({ ok: true, resumen });
    } catch (error) { responderErrorAvisoPlataforma(error, respuesta, next); }
  }

  async apiReconocerAvisoPlataforma(requisicion, respuesta, next) {
    try {
      const resultado = await this.servicioPresentacionAvisosPlataforma
        .reconocer(requisicion.contextoUsuarioActual, requisicion.params.avisoId);
      respuesta.set('Cache-Control', 'no-store').json({ ok: true, resultado });
    } catch (error) { responderErrorAvisoPlataforma(error, respuesta, next); }
  }

  async apiOcultarAvisoPlataforma(requisicion, respuesta, next) {
    try {
      const resultado = await this.servicioPresentacionAvisosPlataforma
        .ocultar(requisicion.contextoUsuarioActual, requisicion.params.avisoId);
      respuesta.set('Cache-Control', 'no-store').json({ ok: true, resultado });
    } catch (error) { responderErrorAvisoPlataforma(error, respuesta, next); }
  }

  async apiAlertasRemotas(requisicion, respuesta, next) {
    try {
      const alertasRemotas = await this.servicioAlertasRemotasPortal
        .consultar(requisicion.contextoUsuarioActual);
      respuesta.set('Cache-Control', 'no-store').json({ ok: true, alertasRemotas });
    } catch (error) { responderErrorDominioPortal(error, respuesta, next); }
  }

  async apiDescartarAlertaRemota(requisicion, respuesta, next) {
    try {
      const resultado = await this.servicioAlertasRemotasPortal.descartar(
        requisicion.contextoUsuarioActual,
        { proyeccionId: requisicion.params.proyeccionId,
          alertaAuditoriaId: requisicion.params.alertaAuditoriaId,
          motivo: requisicion.body.motivo, hastaUtc: requisicion.body.hastaUtc }
      );
      respuesta.set('Cache-Control', 'no-store').json({ ok: true, resultado });
    } catch (error) { responderErrorDominioPortal(error, respuesta, next); }
  }

  async apiRevertirDescarteAlertaRemota(requisicion, respuesta, next) {
    try {
      const resultado = await this.servicioAlertasRemotasPortal.revertir(
        requisicion.contextoUsuarioActual,
        { proyeccionId: requisicion.params.proyeccionId,
          alertaAuditoriaId: requisicion.params.alertaAuditoriaId }
      );
      respuesta.set('Cache-Control', 'no-store').json({ ok: true, resultado });
    } catch (error) { responderErrorDominioPortal(error, respuesta, next); }
  }

  async mostrarPanel(requisicion, respuesta, next) {
    try {
      const contextoUsuarioActual = requisicion.contextoUsuarioActual;
      const estadoConfiguracion =
        this.servicioConfiguracionPortal.construirResumenEstado();
      const estadoCorreo = await obtenerEstadoCorreo(this.servicioCorreoPortal);
      const accionesDisponibles =
        this.construirAccionesDisponibles(contextoUsuarioActual);
      const dashboardOperativo =
        await this.cargarDashboardOperativo(contextoUsuarioActual);
      const alcancePanel =
        await this.construirAlcancePanel(contextoUsuarioActual);

      respuesta.render('panel', {
        titulo: 'Panel',
        usuarioActual: requisicion.session.usuarioAutenticado,
        contextoUsuarioActual,
        descripcionScope: alcancePanel.descripcion,
        alcancePanel,
        permisosActuales: contextoUsuarioActual.permisos.serializar(),
        accionesDisponibles,
        configuracionPortal: {
          ...this.resumenArranque.configuracionPortal,
          version: estadoConfiguracion.version,
          totalClaves: estadoConfiguracion.totalClaves
        },
        estadoCorreo,
        dashboardOperativo,
        comprobacionesScope: [
          {
            etiqueta: 'Puede alcanzar tenant actual',
            valor:
              contextoUsuarioActual.tenantId == null
                ? 'No aplica'
                : this.resolutorScopeUsuario.puedeAlcanzarTenant(
                    contextoUsuarioActual,
                    contextoUsuarioActual.tenantId
                  )
                    ? 'Sí'
                    : 'No'
          },
          {
            etiqueta: 'Puede alcanzar empresa actual',
            valor:
              contextoUsuarioActual.empresaId == null
                ? 'No aplica'
                : this.resolutorScopeUsuario.puedeAlcanzarEmpresa(
                    contextoUsuarioActual,
                    contextoUsuarioActual.empresaId,
                    contextoUsuarioActual.tenantId
                  )
                    ? 'Sí'
                    : 'No'
          },
          {
            etiqueta: 'Puede alcanzar sitio actual',
            valor:
              contextoUsuarioActual.sitioId == null
                ? 'No aplica'
                : this.resolutorScopeUsuario.puedeAlcanzarSitio(
                    contextoUsuarioActual,
                    contextoUsuarioActual.sitioId,
                    contextoUsuarioActual.empresaId,
                    contextoUsuarioActual.tenantId
                  )
                    ? 'Sí'
                    : 'No'
          }
        ]
      });
    } catch (error) {
      next(error);
    }
  }

  async apiDashboardOperativo(requisicion, respuesta, next) {
    try {
      const contextoUsuarioActual = requisicion.contextoUsuarioActual;
      const dashboardOperativo =
        await this.cargarDashboardOperativo(contextoUsuarioActual);

      respuesta.json({
        dashboardOperativo,
        accionesDisponibles:
          this.construirAccionesDisponibles(contextoUsuarioActual)
      });
    } catch (error) {
      next(error);
    }
  }

  async apiDescartarAlertaActiva(requisicion, respuesta, _next) {
    await this.ejecutarOperacionJson(respuesta, async () => {
      const resultado =
        await this.servicioGestionAlertasActivasPortal.descartarAlertaActiva(
          requisicion.contextoUsuarioActual,
          {
            monitorId: requisicion.params.monitorId,
            motivo: requisicion.body?.motivo,
            hastaUtc:
              requisicion.body?.hastaUtc ??
              requisicion.body?.descartada_hasta_utc ??
              requisicion.body?.descartadaHastaUtc ??
              null
          }
        );

      return resultado;
    });
  }

  async apiRevertirDescarteAlertaActiva(requisicion, respuesta, _next) {
    await this.ejecutarOperacionJson(respuesta, async () => {
      const resultado =
        await this.servicioGestionAlertasActivasPortal.revertirDescarteAlertaActiva(
          requisicion.contextoUsuarioActual,
          {
            monitorId: requisicion.params.monitorId
          }
        );

      return resultado;
    });
  }

  mostrarEdicionDemo(requisicion, respuesta) {
    respuesta.render('portal/edicion-demo', {
      titulo: 'Edición',
      usuarioActual: requisicion.session.usuarioAutenticado
    });
  }

  mostrarUsuariosDemo(requisicion, respuesta) {
    respuesta.redirect('/usuarios');
  }

  mostrarConfiguracionDemo(requisicion, respuesta) {
    respuesta.redirect('/configuracion');
  }

  async mostrarConfiguracion(requisicion, respuesta, next) {
    try {
      const configuraciones =
        await this.servicioConfiguracionPortal.listarConfiguraciones();
      const redPublicaFederacion =
        await this.construirRedPublicaFederacion(configuraciones);

      respuesta.render('portal/configuracion', {
        titulo: 'Configuración',
        usuarioActual: requisicion.session.usuarioAutenticado,
        configuraciones,
        redPublicaFederacion,
        estadoCorreo: await obtenerEstadoCorreo(this.servicioCorreoPortal),
        estadoConfiguracion:
          this.servicioConfiguracionPortal.construirResumenEstado(),
        estadoRecuperacionPassword:
          await this.construirEstadoRecuperacionPassword(),
        flashConfiguracion: this.consumirFlashConfiguracion(requisicion)
      });
    } catch (error) {
      next(error);
    }
  }

  async actualizarConfiguracion(requisicion, respuesta, _next) {
    try {
      const clave = String(requisicion.body.clave || '').trim();
      const valor = this.normalizarValorConfiguracionEntrada(
        clave,
        requisicion.body.valor
      );
      if (clave === 'usuarios.recuperacion_email_activa') {
        await this.servicioDisponibilidadRecuperacionPassword
          ?.validarCambioIntencion(valor);
      }
      this.servicioPresentacionRedPublicaFederacion?.validarCambio({
        clave,
        valor
      });
      await this.servicioConfiguracionPortal.actualizarValor({
        clave,
        valor,
        contextoUsuarioActual: requisicion.contextoUsuarioActual
      });
      const mensaje = `La clave ${clave} se ha actualizado.`;

      if (this.esPeticionJson(requisicion)) {
        respuesta.json(
          await this.construirRespuestaConfiguracionActualizada({
            clave,
            mensaje
          })
        );
        return;
      }

      this.guardarFlashConfiguracion(requisicion, {
        tipo: 'exito',
        mensaje
      });
    } catch (error) {
      if (this.esPeticionJson(requisicion)) {
        respuesta.status(Number(error?.estadoHttp || 400)).json({
          ok: false,
          mensaje: error.message
        });
        return;
      }

      this.guardarFlashConfiguracion(requisicion, {
        tipo: 'error',
        mensaje: error.message
      });
    }

    respuesta.redirect('/configuracion');
  }

  async restablecerConfiguracion(requisicion, respuesta, _next) {
    try {
      const clave = String(requisicion.body.clave || '').trim();
      this.servicioPresentacionRedPublicaFederacion
        ?.validarRestablecimiento(clave);
      await this.servicioConfiguracionPortal.restablecerValorPorDefecto(
        clave,
        requisicion.contextoUsuarioActual
      );
      const mensaje = `La clave ${clave} ha vuelto a su valor por defecto.`;

      if (this.esPeticionJson(requisicion)) {
        respuesta.json(
          await this.construirRespuestaConfiguracionActualizada({
            clave,
            mensaje
          })
        );
        return;
      }

      this.guardarFlashConfiguracion(requisicion, {
        tipo: 'exito',
        mensaje
      });
    } catch (error) {
      if (this.esPeticionJson(requisicion)) {
        respuesta.status(400).json({
          ok: false,
          mensaje: error.message
        });
        return;
      }

      this.guardarFlashConfiguracion(requisicion, {
        tipo: 'error',
        mensaje: error.message
      });
    }

    respuesta.redirect('/configuracion');
  }

  async sincronizarConfiguracion(requisicion, respuesta, next) {
    try {
      const resultado =
        await this.servicioConfiguracionPortal.sincronizarDefiniciones(
          requisicion.contextoUsuarioActual
        );
      const mensaje =
        resultado.clavesCreadas.length > 0
          ? `Se han creado ${resultado.clavesCreadas.length} claves nuevas.`
          : 'No faltaba ninguna clave por crear.';

      if (this.esPeticionJson(requisicion)) {
        respuesta.json({
          ok: true,
          mensaje,
          recargar: resultado.clavesCreadas.length > 0,
          estadoConfiguracion:
            this.servicioConfiguracionPortal.construirResumenEstado(),
          estadoCorreo: await obtenerEstadoCorreo(this.servicioCorreoPortal)
        });
        return;
      }

      this.guardarFlashConfiguracion(requisicion, {
        tipo: 'exito',
        mensaje
      });
      respuesta.redirect('/configuracion');
    } catch (error) {
      if (this.esPeticionJson(requisicion)) {
        respuesta.status(400).json({
          ok: false,
          mensaje: error.message
        });
        return;
      }

      next(error);
    }
  }

  async iniciarVerificacionCorreoOperativo(requisicion, respuesta, _next) {
    try {
      const resultado =
        await this.servicioVerificacionCorreoOperativo.iniciarVerificacion({
          idUsuario: requisicion.contextoUsuarioActual.idUsuario
        });

      this.guardarFlashConfiguracion(requisicion, {
        tipo: 'exito',
        mensaje:
          `Hemos enviado el enlace de verificación a ${resultado.email}. ` +
          `Caduca en ${resultado.ttlMinutos} minutos.`
      });
    } catch (error) {
      this.guardarFlashConfiguracion(requisicion, {
        tipo: 'error',
        mensaje: error.message
      });
    }

    respuesta.redirect('/configuracion');
  }

  async verificarCorreoOperativo(requisicion, respuesta, _next) {
    endurecerRespuestaVerificacionCorreo(respuesta);
    try {
      const resultado =
        await this.servicioVerificacionCorreoOperativo.abrirVerificacion({
          token: requisicion.params.token,
          idUsuario: requisicion.contextoUsuarioActual.idUsuario,
          contextoUsuarioActual: requisicion.contextoUsuarioActual
        });

      if (resultado.requiereConfirmacion) {
        respuesta.render('portal/correo-verificacion-confirmar', {
          titulo: 'Confirmar verificación de correo',
          usuarioActual: requisicion.session.usuarioAutenticado,
          verificacion: resultado,
          tokenVerificacion: requisicion.params.token,
          flashConfiguracion: this.consumirFlashConfiguracion(requisicion)
        });
        return;
      }

      this.guardarFlashConfiguracion(requisicion, {
        tipo: 'exito',
        mensaje:
          `Correo operativo verificado correctamente para ${resultado.email}.`
      });
    } catch (error) {
      this.guardarFlashConfiguracion(requisicion, {
        tipo: 'error',
        mensaje: error.message
      });
    }

    respuesta.redirect('/configuracion');
  }

  async confirmarCorreoOperativo(requisicion, respuesta, _next) {
    endurecerRespuestaVerificacionCorreo(respuesta);
    try {
      const resultado =
        await this.servicioVerificacionCorreoOperativo.confirmarVerificacion({
          token: requisicion.params.token,
          idUsuario: requisicion.contextoUsuarioActual.idUsuario,
          contextoUsuarioActual: requisicion.contextoUsuarioActual,
          aceptaReanudacion: requisicion.body.aceptaReanudacion === 'si'
        });
      this.guardarFlashConfiguracion(requisicion, {
        tipo: 'exito',
        mensaje:
          `Correo smtp@1 verificado para ${resultado.email}. ` +
          `Se reanudará el backlog aceptado (${resultado.backlog.total}).`
      });
      respuesta.redirect(303, '/configuracion');
    } catch (error) {
      this.guardarFlashConfiguracion(requisicion, {
        tipo: 'error',
        mensaje: error.message
      });
      respuesta.redirect(
        303,
        `/configuracion/correo/verificar/${encodeURIComponent(requisicion.params.token)}`
      );
    }
  }

  consumirFlashConfiguracion(requisicion) {
    const flash = requisicion.session?.flashConfiguracion ?? null;

    if (requisicion.session) {
      delete requisicion.session.flashConfiguracion;
    }

    return flash;
  }

  guardarFlashConfiguracion(requisicion, flash) {
    if (requisicion.session) {
      requisicion.session.flashConfiguracion = flash;
    }
  }

  resolverBaseUrl(requisicion) {
    return `${requisicion.protocol}://${requisicion.get('host')}`;
  }

  esPeticionJson(requisicion) {
    return (
      String(requisicion.get('x-requested-with') || '').toLowerCase() ===
        'xmlhttprequest' ||
      String(requisicion.get('accept') || '').includes('application/json')
    );
  }

  async construirRespuestaConfiguracionActualizada({ clave, mensaje }) {
    const configuraciones =
      await this.servicioConfiguracionPortal.listarConfiguraciones();
    const entrada = configuraciones.find((item) => item.clave === clave) || null;

    return {
      ok: true,
      mensaje,
      clave,
      entrada,
      estadoConfiguracion:
        this.servicioConfiguracionPortal.construirResumenEstado(),
      estadoCorreo: await obtenerEstadoCorreo(this.servicioCorreoPortal),
      estadoRecuperacionPassword:
        await this.construirEstadoRecuperacionPassword(),
      redPublicaFederacion:
        await this.construirRedPublicaFederacion(configuraciones)
    };
  }

  async construirRedPublicaFederacion(configuraciones = null) {
    if (!this.servicioPresentacionRedPublicaFederacion) return null;
    return this.servicioPresentacionRedPublicaFederacion
      .construir(configuraciones);
  }

  async construirEstadoRecuperacionPassword() {
    return this.servicioDisponibilidadRecuperacionPassword?.evaluar?.() || null;
  }

  normalizarValorConfiguracionEntrada(clave, valor) {
    if (clave !== 'auditoria.retencion_dias') return valor;
    const texto = String(valor ?? '').trim();
    if (texto === '') return null;
    if (!/^[1-9][0-9]*$/.test(texto)) {
      throw new Error('La retención debe expresarse como días enteros entre 1 y 36500.');
    }
    return Number(texto);
  }

  async ejecutarOperacionJson(respuesta, operacion) {
    try {
      const payload = await operacion();
      respuesta.json({
        ok: true,
        ...payload
      });
    } catch (error) {
      respuesta.status(400).json({
        ok: false,
        mensaje: error.message
      });
    }
  }

  construirAccionesDisponibles(contextoUsuarioActual) {
    return {
      ver: this.servicioAutorizacion.puedeVer(contextoUsuarioActual),
      monitores: this.servicioAutorizacion.puedeVerMonitores(
        contextoUsuarioActual
      ),
      triggers: this.servicioAutorizacion.puedeVerTriggers(
        contextoUsuarioActual
      ),
      editarTriggers: this.servicioAutorizacion.puedeEditarTriggers(
        contextoUsuarioActual
      ),
      gestionarVinculosTriggers:
        this.servicioAutorizacion.puedeGestionarVinculosTriggers(
          contextoUsuarioActual
        ),
      gestionarDescartesAlertasActivas:
        this.servicioAutorizacion.puedeGestionarDescartesAlertasActivas(
          contextoUsuarioActual
        ),
      organizacion: this.servicioAutorizacion.puedeAccederOrganizacion(
        contextoUsuarioActual
      ),
      editar: this.servicioAutorizacion.puedeEditar(contextoUsuarioActual),
      administrarUsuarios:
        this.servicioAutorizacion.puedeAdministrarUsuarios(contextoUsuarioActual),
      verDns: this.servicioAutorizacion.puedeVerDns(contextoUsuarioActual),
      administrarConfiguracion:
        this.servicioAutorizacion.puedeAdministrarConfiguracion(
          contextoUsuarioActual
        )
    };
  }

  async construirAlcancePanel(contextoUsuarioActual) {
    const tenant = contextoUsuarioActual.tenantId
      ? await this.buscarSeguro(this.repositorioTenants, contextoUsuarioActual.tenantId)
      : null;
    const empresa = contextoUsuarioActual.empresaId
      ? await this.buscarSeguro(
          this.repositorioEmpresas,
          contextoUsuarioActual.empresaId
        )
      : null;
    const sitio = contextoUsuarioActual.sitioId
      ? await this.buscarSeguro(this.repositorioSitios, contextoUsuarioActual.sitioId)
      : null;
    const tenantNombre = this.resolverEtiquetaEntidad({
      entidad: tenant,
      id: contextoUsuarioActual.tenantId,
      prefijo: 'Tenant'
    });
    const empresaNombre = this.resolverEtiquetaEntidad({
      entidad: empresa,
      id: contextoUsuarioActual.empresaId,
      prefijo: 'Empresa'
    });
    const sitioNombre = this.resolverEtiquetaEntidad({
      entidad: sitio,
      id: contextoUsuarioActual.sitioId,
      prefijo: 'Sitio'
    });
    const cobertura = [
      tenantNombre || 'Todos los tenants',
      empresaNombre || 'Todas las empresas',
      sitioNombre || 'Todos los sitios'
    ].join(' · ');

    return {
      nivel: contextoUsuarioActual.nivelScope,
      tenantNombre,
      empresaNombre,
      sitioNombre,
      cobertura,
      descripcion: this.describirScopeHumano({
        contextoUsuarioActual,
        tenantNombre,
        empresaNombre,
        sitioNombre
      })
    };
  }

  async buscarSeguro(repositorio, id) {
    if (!repositorio || typeof repositorio.buscarPorId !== 'function') {
      return null;
    }

    try {
      return repositorio.buscarPorId(id);
    } catch (error) {
      console.error(`[sentinelia-web] No se pudo resolver entidad de scope ${id}.`);
      console.error(error);
      return null;
    }
  }

  resolverEtiquetaEntidad({ entidad, id, prefijo }) {
    if (id == null) {
      return null;
    }

    return String(entidad?.nombre || entidad?.alias || '').trim() || `${prefijo} #${id}`;
  }

  describirScopeHumano({
    contextoUsuarioActual,
    tenantNombre,
    empresaNombre,
    sitioNombre
  }) {
    if (contextoUsuarioActual.esOperadorSistema) {
      return 'Operador de sistema con alcance total.';
    }

    if (contextoUsuarioActual.nivelScope === 'tenant') {
      return `Alcance acotado a ${tenantNombre}.`;
    }

    if (contextoUsuarioActual.nivelScope === 'empresa') {
      return `Alcance acotado a ${empresaNombre} dentro de ${tenantNombre}.`;
    }

    if (contextoUsuarioActual.nivelScope === 'sitio') {
      return `Alcance acotado a ${sitioNombre} dentro de ${empresaNombre}.`;
    }

    return this.resolutorScopeUsuario.describirScope({
      tenantId: contextoUsuarioActual.tenantId,
      empresaId: contextoUsuarioActual.empresaId,
      sitioId: contextoUsuarioActual.sitioId
    });
  }

  async cargarDashboardOperativo(contextoUsuarioActual) {
    if (!this.servicioDashboard) {
      return null;
    }

    const dashboardOperativo =
      await this.servicioDashboard.construirDashboardBase(contextoUsuarioActual);

    this.sincronizarVencimientoDescarteTemporal(dashboardOperativo);
    return dashboardOperativo;
  }

  sincronizarVencimientoDescarteTemporal(dashboardOperativo) {
    if (
      !this.difusorWebSocketPortal ||
      typeof this.difusorWebSocketPortal
        .sincronizarVencimientoDescarteTemporalDesdeDashboard !== 'function'
    ) {
      return;
    }

    try {
      this.difusorWebSocketPortal
        .sincronizarVencimientoDescarteTemporalDesdeDashboard(dashboardOperativo);
    } catch (error) {
      console.error(
        '[sentinelia-web] No se pudo programar vencimiento de descarte.'
      );
      console.error(error);
    }
  }
}

function obtenerEstadoCorreo(servicioCorreoPortal) {
  if (typeof servicioCorreoPortal?.obtenerEstadoConfiguracionAutoritativo ===
      'function') {
    return servicioCorreoPortal.obtenerEstadoConfiguracionAutoritativo();
  }
  return servicioCorreoPortal.obtenerEstadoConfiguracion();
}

function responderErrorAvisoPlataforma(error, respuesta, next) {
  const statusCode = Number(error?.statusCode || 0);
  if (![400, 403, 404].includes(statusCode)) {
    next(error);
    return;
  }
  respuesta.status(statusCode).set('Cache-Control', 'no-store').json({
    ok: false,
    codigo: error.codigo || 'AVISO_NO_DISPONIBLE',
    mensaje: error.message
  });
}

function responderErrorDominioPortal(error, respuesta, next) {
  const statusCode = Number(error?.statusCode || 0);
  if (![400, 403, 404, 409].includes(statusCode)) return next(error);
  respuesta.status(statusCode).set('Cache-Control', 'no-store').json({
    ok: false, codigo: error.codigo || 'OPERACION_NO_DISPONIBLE', mensaje: error.message
  });
}

function endurecerRespuestaVerificacionCorreo(respuesta) {
  respuesta
    .set('Cache-Control', 'private, no-store, max-age=0')
    .set('Pragma', 'no-cache')
    .set('Referrer-Policy', 'no-referrer')
    .set(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; " +
        "script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'"
    );
}
