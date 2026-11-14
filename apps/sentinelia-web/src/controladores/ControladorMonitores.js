import {
  existeTipoMonitor,
  normalizarTipoMonitor,
  obtenerDefinicionTipoMonitor
} from '../../../../paquetes/monitores/src/CatalogoTiposMonitor.js';

export class ControladorMonitores {
  constructor({
    servicioMonitores,
    servicioLecturaTriggersPortal = null,
    servicioAdministracionTriggersPortal = null
  }) {
    this.servicioMonitores = servicioMonitores;
    this.servicioLecturaTriggersPortal = servicioLecturaTriggersPortal;
    this.servicioAdministracionTriggersPortal =
      servicioAdministracionTriggersPortal;
  }

  async mostrarMonitores(requisicion, respuesta, next) {
    try {
      const vista = await this.servicioMonitores.construirVistaListadoAjaxShell(
        requisicion.contextoUsuarioActual,
        {
          textoBusqueda: String(requisicion.query.q || '').trim(),
          tipo: String(requisicion.query.tipo || '').trim(),
          tenantId: requisicion.query.tenant_id,
          empresaId: requisicion.query.empresa_id,
          sitioId: requisicion.query.sitio_id,
          nivelPertenencia: String(
            requisicion.query.nivel_pertenencia || ''
          ).trim(),
          activo: String(requisicion.query.activo || 'todos'),
          entradaMonitorId: requisicion.query.entrada_monitor_id,
          agenteTelemetriaId: requisicion.query.agente_id,
          senalTelemetriaId: requisicion.query.senal_id,
          reglaTelemetriaId: requisicion.query.regla_id,
          pagina: requisicion.query.page,
          tamanoPagina: requisicion.query.page_size,
          ordenarPor: String(requisicion.query.sort_by || 'nombre'),
          direccionOrden: String(requisicion.query.sort_dir || 'asc')
        }
      );
      const tipoListadoActivo = this.normalizarTipoListado(vista.filtros.tipo);
      const retornoListado = this.construirRetornoListado(
        requisicion.originalUrl,
        tipoListadoActivo
      );
      const contextoTipo = this.construirContextoTipo(tipoListadoActivo);

      respuesta.render('portal/monitores', {
        titulo: contextoTipo.tituloListado,
        usuarioActual: requisicion.session?.usuarioAutenticado ?? null,
        flashMonitores: this.consumirFlash(requisicion),
        tipoListadoActivo,
        retornoListado,
        contextoTipo,
        ...vista
      });
    } catch (error) {
      next(error);
    }
  }

  async mostrarComparadorEventos(requisicion, respuesta, next) {
    try {
      const vista =
        await this.servicioMonitores.construirVistaComparadorEventos(
        requisicion.contextoUsuarioActual
      );

      respuesta.render('portal/monitores-comparar-eventos', {
        titulo: 'Comparar eventos',
        usuarioActual: requisicion.session?.usuarioAutenticado ?? null,
        retornoListado: this.normalizarRetornoListado(requisicion.query.return_to) || '/monitores',
        ...vista
      });
    } catch (error) {
      next(error);
    }
  }

  async mostrarVisorEventos(requisicion, respuesta, next) {
    try {
      const vista =
        await this.servicioMonitores.construirVistaVisorEventos(
          requisicion.contextoUsuarioActual
        );

      respuesta.render('portal/monitores-eventos', {
        titulo: 'Eventos de monitores',
        usuarioActual: requisicion.session?.usuarioAutenticado ?? null,
        retornoListado: this.normalizarRetornoListado(requisicion.query.return_to) || '/monitores',
        ...vista
      });
    } catch (error) {
      next(error);
    }
  }

  async mostrarHistorico(requisicion, respuesta, next) {
    try {
      const vista =
        await this.servicioMonitores.construirVistaHistoricoAdministrativoShell(
          requisicion.contextoUsuarioActual,
          {
            desde: requisicion.query.desde,
            hasta: requisicion.query.hasta,
            monitorId: requisicion.query.monitor_id,
            tipo: String(requisicion.query.tipo || '').trim(),
            estadoTramo: String(requisicion.query.estado || '').trim(),
            codigoResultado: String(
              requisicion.query.codigo_resultado || ''
            ).trim(),
            pagina: requisicion.query.page,
            tamanoPagina: requisicion.query.page_size,
            ordenarPor: String(requisicion.query.sort_by || 'valido_hasta').trim(),
            direccionOrden: String(
              requisicion.query.sort_dir || 'desc'
            ).trim()
          }
        );

      respuesta.render('portal/monitores-historico', {
        titulo: 'Histórico de monitores',
        usuarioActual: requisicion.session?.usuarioAutenticado ?? null,
        retornoListado: this.normalizarRetornoListado(requisicion.query.return_to) || '/monitores',
        retornoHistorico: requisicion.originalUrl,
        ...vista
      });
    } catch (error) {
      next(error);
    }
  }

  async mostrarTriggers(requisicion, respuesta, next) {
    try {
      const vista =
        await this.servicioLecturaTriggersPortal
          .construirVistaLecturaAdministrativa(
            requisicion.contextoUsuarioActual
          );

      respuesta.render('portal/monitores-triggers', {
        titulo: 'Triggers de monitores',
        usuarioActual: requisicion.session?.usuarioAutenticado ?? null,
        ...vista
      });
    } catch (error) {
      next(error);
    }
  }

  async mostrarNuevoMonitor(requisicion, respuesta, next) {
    const borradorFederado = requisicion.query.borrador_federado === '1'
      ? requisicion.session?.borradorMonitorFederado ?? null
      : null;
    if (borradorFederado && requisicion.session) {
      delete requisicion.session.borradorMonitorFederado;
    }
    const tipoSolicitado = this.normalizarTipoListado(requisicion.query.tipo);
    const entradaMonitorId = Number.parseInt(
      String(requisicion.query.entrada_monitor_id || ''),
      10
    );
    let formularioBase = borradorFederado?.formulario || {
      tipo: tipoSolicitado,
      telemetria_agente_id: requisicion.query.agente_id,
      telemetria_senal_id: requisicion.query.senal_id,
      telemetria_regla_id: requisicion.query.regla_id,
      telemetria_tipo_fuente: requisicion.query.regla_id
        ? 'regla_derivacion'
        : undefined,
      return_to: this.normalizarRetornoListado(requisicion.query.return_to)
    };

    if (
      !borradorFederado &&
      tipoSolicitado === 'booleano' &&
      Number.isInteger(entradaMonitorId) &&
      entradaMonitorId > 0
    ) {
      const monitorEntrada = await this.servicioMonitores.buscarMonitorVisible(
        requisicion.contextoUsuarioActual,
        entradaMonitorId
      );
      const dependencia = {
        variable: 'A',
        fuente: 'monitor',
        monitorId: monitorEntrada.id,
        etiqueta: monitorEntrada.nombre
      };
      formularioBase = {
        ...formularioBase,
        tipo: 'booleano',
        tenant_id: monitorEntrada.tenantId,
        empresa_id: monitorEntrada.empresaId,
        sitio_id: monitorEntrada.sitioId ?? '',
        nivel_pertenencia: monitorEntrada.sitioId == null ? 'empresa' : 'sitio',
        dependencia_monitor_id_logica: monitorEntrada.id,
        dependencias_logicas: JSON.stringify([dependencia]),
        expresion_logica: 'A'
      };
    }

    await this.renderizarFormulario(requisicion, respuesta, next, {
      titulo: 'Nuevo monitor',
      formularioBase,
      borradorFederado
    });
  }

  async mostrarEditarMonitor(requisicion, respuesta, next) {
    const idMonitor = Number.parseInt(String(requisicion.params.id || ''), 10);

    await this.renderizarFormulario(requisicion, respuesta, next, {
      titulo: 'Gestionar monitor',
      idMonitor,
      retornoListado: this.normalizarRetornoListado(requisicion.query.return_to)
    });
  }

  async mostrarDetalleMonitor(requisicion, respuesta, next) {
    const idMonitor = Number.parseInt(String(requisicion.params.id || ''), 10);

    try {
      const vista = await this.servicioMonitores.construirVistaMonitorOperativo(
        requisicion.contextoUsuarioActual,
        idMonitor
      );
      const puedeVerTriggers = Boolean(
        requisicion.contextoUsuarioActual?.permisos?.verTriggers
      );
      const puedeGestionarVinculosTriggers = Boolean(
        requisicion.contextoUsuarioActual?.permisos?.gestionarVinculosTriggers
      );
      const vistaVinculosTriggerMonitor =
        this.servicioAdministracionTriggersPortal
          ? await this.servicioAdministracionTriggersPortal
            .construirVistaVinculosMonitorDetalle(
              requisicion.contextoUsuarioActual,
              idMonitor,
              {
                permitirDetalleTrigger: puedeVerTriggers
              }
            )
          : null;
      const retornoListado =
        this.normalizarRetornoListado(requisicion.query.return_to) ||
        this.construirRetornoListado(
          `/monitores?tipo=${encodeURIComponent(
            this.normalizarTipoListado(vista.monitor?.tipo)
          )}`,
          this.normalizarTipoListado(vista.monitor?.tipo)
        );
      const contextoTipo = this.construirContextoTipo(vista.monitor?.tipo);

      respuesta.render('portal/monitor-detalle', {
        titulo: `Monitor ${vista.monitor?.nombre || idMonitor}`,
        usuarioActual: requisicion.session?.usuarioAutenticado ?? null,
        flashMonitores: this.consumirFlash(requisicion),
        retornoListado,
        retornoVinculos: requisicion.originalUrl,
        contextoTipo,
        puedeVerTriggers,
        puedeGestionarVinculosTriggers,
        vistaVinculosTriggerMonitor,
        ...vista
      });
    } catch (error) {
      if (this.responderErrorAccesoMonitor(requisicion, respuesta, error)) return;
      next(error);
    }
  }

  async apiFuentesTelemetria(requisicion, respuesta, next) {
    try {
      const fuentes = await this.servicioMonitores
        .listarFuentesTelemetriaFormulario(
          requisicion.contextoUsuarioActual,
          requisicion.query.agente_id
        );
      respuesta.json(fuentes);
    } catch (error) {
      if (error?.message) {
        respuesta.status(400).json({ error: error.message });
        return;
      }
      next(error);
    }
  }

  async crearMonitor(requisicion, respuesta, next) {
    try {
      const monitor = await this.servicioMonitores.crearMonitor(
        requisicion.contextoUsuarioActual,
        requisicion.body
      );

      this.guardarFlash(requisicion, {
        tipo: 'exito',
        mensaje: `Monitor ${monitor.nombre} creado con id ${monitor.id}.`
      });
      respuesta.redirect(this.resolverDestinoRetorno(requisicion.body.return_to));
    } catch (error) {
      await this.renderizarFormulario(requisicion, respuesta, next, {
        titulo: 'Nuevo monitor',
        formularioBase: requisicion.body,
        errorFormulario: error.message,
        statusCode: 400
      });
    }
  }

  async actualizarMonitor(requisicion, respuesta, next) {
    const idMonitor = Number.parseInt(String(requisicion.params.id || ''), 10);

    try {
      const monitor = await this.servicioMonitores.actualizarMonitor(
        requisicion.contextoUsuarioActual,
        idMonitor,
        requisicion.body
      );

      this.guardarFlash(requisicion, {
        tipo: 'exito',
        mensaje: `Monitor ${monitor.nombre} actualizado.`,
        canal: 'toast'
      });
      respuesta.redirect(this.resolverDestinoRetorno(requisicion.body.return_to));
    } catch (error) {
      await this.renderizarFormulario(requisicion, respuesta, next, {
        titulo: 'Gestionar monitor',
        idMonitor,
        formularioBase: {
          ...requisicion.body,
          id: idMonitor
        },
        errorFormulario: error.message,
        statusCode: 400
      });
    }
  }

  async apiImpactoEliminacionMonitor(requisicion, respuesta, next) {
    const idMonitor = Number.parseInt(String(requisicion.params.id || ''), 10);

    try {
      const impacto = await this.servicioMonitores.obtenerImpactoEliminacionMonitor(
        requisicion.contextoUsuarioActual,
        idMonitor
      );
      respuesta.json({ ok: true, ...impacto });
    } catch (error) {
      if (error.message === 'No existe el monitor solicitado en tu alcance visible.') {
        respuesta.status(404).json({ ok: false, mensaje: error.message });
        return;
      }
      next(error);
    }
  }

  async eliminarMonitor(requisicion, respuesta, next) {
    const idMonitor = Number.parseInt(String(requisicion.body.id || ''), 10);

    try {
      await this.servicioMonitores.eliminarMonitor(
        requisicion.contextoUsuarioActual,
        idMonitor
      );

      this.guardarFlash(requisicion, {
        tipo: 'exito',
        mensaje: `Monitor ${idMonitor} eliminado.`
      });
      respuesta.redirect(this.resolverDestinoRetorno(requisicion.body.return_to));
    } catch (error) {
      this.guardarFlash(requisicion, {
        tipo: 'error',
        mensaje: error.message
      });
      respuesta.redirect(this.resolverDestinoRetorno(requisicion.body.return_to));
    }
  }

  async renderizarFormulario(
    requisicion,
    respuesta,
    next,
    {
      titulo,
      idMonitor = null,
      formularioBase = null,
      errorFormulario = null,
      statusCode = 200,
      retornoListado = null,
      borradorFederado = null
    }
  ) {
    try {
      const vista = await this.servicioMonitores.construirVistaFormulario(
        requisicion.contextoUsuarioActual,
        { idMonitor, formularioBase }
      );
      const retornoNormalizado =
        this.normalizarRetornoListado(formularioBase?.return_to) ||
        this.normalizarRetornoListado(retornoListado) ||
        this.normalizarRetornoListado(requisicion.query.return_to) ||
        '/monitores';
      const tipoVistaFijo = this.resolverTipoVistaFormulario(
        vista.formulario?.tipo,
        retornoNormalizado,
        requisicion.query.tipo
      );
      const contextoTipo = this.construirContextoTipo(
        tipoVistaFijo || vista.formulario?.tipo
      );
      const vistaVinculosTriggerMonitor = vista.monitorObjetivo?.id &&
        this.servicioAdministracionTriggersPortal
        ? await this.servicioAdministracionTriggersPortal
          .construirVistaVinculosMonitorDetalle(
            requisicion.contextoUsuarioActual,
            vista.monitorObjetivo.id,
            { permitirDetalleTrigger: false }
          )
        : null;
      const relacionesCruzadas = {
        monitoresLogicosDependientes:
          vista.relacionesCruzadas?.monitoresLogicosDependientes || [],
        totalAutomatizaciones:
          Number(vistaVinculosTriggerMonitor?.totalAsignaciones || 0)
      };

      respuesta.status(statusCode).render('portal/monitor-formulario', {
        titulo,
        usuarioActual: requisicion.session?.usuarioAutenticado ?? null,
        contextoUsuarioActual: requisicion.contextoUsuarioActual ?? null,
        errorFormulario,
        retornoListado: retornoNormalizado,
        tipoVistaFijo,
        contextoTipo,
        borradorFederado,
        ...vista,
        relacionesCruzadas
      });
    } catch (error) {
      if (this.responderErrorAccesoMonitor(requisicion, respuesta, error)) return;
      next(error);
    }
  }

  responderErrorAccesoMonitor(requisicion, respuesta, error) {
    const usuarioActual = requisicion.session?.usuarioAutenticado ?? null;
    if (error?.codigo === 'monitor_fuera_de_alcance') {
      respuesta.status(403).set('Cache-Control', 'no-store').render('portal/forbidden', {
        titulo: 'Acceso denegado', usuarioActual,
        motivoAlcance: 'Necesitas un alcance que permita acceder al monitor solicitado.'
      });
      return true;
    }
    if (error?.codigo === 'monitor_no_encontrado') {
      respuesta.status(404).set('Cache-Control', 'no-store').render('portal/no-encontrado', {
        titulo: 'Página no encontrada', usuarioActual
      });
      return true;
    }
    return false;
  }

  consumirFlash(requisicion) {
    const flash = requisicion.session?.flashMonitores ?? null;

    if (requisicion.session) {
      delete requisicion.session.flashMonitores;
    }

    return flash;
  }

  guardarFlash(requisicion, flash) {
    if (requisicion.session) {
      requisicion.session.flashMonitores = flash;
    }
  }

  async apiListarMonitores(requisicion, respuesta, next) {
    try {
      const vista = await this.servicioMonitores.listarMonitoresAdministracion(
        requisicion.contextoUsuarioActual,
        {
          textoBusqueda: String(requisicion.query.q || '').trim(),
          tipo: String(requisicion.query.tipo || '').trim(),
          tenantId: requisicion.query.tenant_id,
          empresaId: requisicion.query.empresa_id,
          sitioId: requisicion.query.sitio_id,
          nivelPertenencia: String(
            requisicion.query.nivel_pertenencia || ''
          ).trim(),
          activo: String(requisicion.query.activo || 'todos'),
          entradaMonitorId: requisicion.query.entrada_monitor_id,
          agenteTelemetriaId: requisicion.query.agente_id,
          senalTelemetriaId: requisicion.query.senal_id,
          reglaTelemetriaId: requisicion.query.regla_id,
          pagina: requisicion.query.page,
          tamanoPagina: requisicion.query.page_size,
          ordenarPor: String(requisicion.query.sort_by || 'nombre'),
          direccionOrden: String(requisicion.query.sort_dir || 'asc')
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

  async apiListarEventos(requisicion, respuesta, next) {
    try {
      const vista = await this.servicioMonitores.listarEventosHistoricos(
        requisicion.contextoUsuarioActual,
        {
          desde: requisicion.query.desde,
          hasta: requisicion.query.hasta,
          monitorId: requisicion.query.monitor_id,
          tipo: String(requisicion.query.tipo || '').trim(),
          estadoDetectado: String(requisicion.query.estado || '').trim(),
          codigoResultado: String(
            requisicion.query.codigo_resultado || ''
          ).trim(),
          limite: requisicion.query.limite,
          orden: String(requisicion.query.orden || 'asc').trim(),
          resumenGrafico: requisicion.query.grafico === 'velas',
          intervalosGrafico: requisicion.query.intervalos
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

  async apiHitosEventos(requisicion, respuesta, next) {
    try {
      const hitos = await this.servicioMonitores.obtenerHitosEventosMonitor(
        requisicion.contextoUsuarioActual,
        { monitorId: requisicion.query.monitor_id }
      );

      respuesta.json({
        ok: true,
        ...hitos
      });
    } catch (error) {
      next(error);
    }
  }

  async apiCompararEventos(requisicion, respuesta, next) {
    try {
      const vista = await this.servicioMonitores.listarEventosComparados(
        requisicion.contextoUsuarioActual,
        {
          desde: requisicion.query.desde,
          hasta: requisicion.query.hasta,
          monitorIds: this.normalizarMonitorIdsComparacion(
            requisicion.query.monitor_ids
          ),
          limite: requisicion.query.limite,
          intervalos: requisicion.query.intervalos,
          detalle: requisicion.query.detalle === '1',
          orden: String(requisicion.query.orden || 'asc').trim()
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

  async apiListarHistorico(requisicion, respuesta, next) {
    try {
      const vista = await this.servicioMonitores.listarHistoricoAdministrativo(
        requisicion.contextoUsuarioActual,
        {
          desde: requisicion.query.desde,
          hasta: requisicion.query.hasta,
          monitorId: requisicion.query.monitor_id,
          tipo: String(requisicion.query.tipo || '').trim(),
          estadoTramo: String(requisicion.query.estado || '').trim(),
          codigoResultado: String(
            requisicion.query.codigo_resultado || ''
          ).trim(),
          pagina: requisicion.query.page,
          tamanoPagina: requisicion.query.page_size,
          ordenarPor: String(requisicion.query.sort_by || 'valido_hasta').trim(),
          direccionOrden: String(requisicion.query.sort_dir || 'desc').trim()
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

  async apiOpcionesEventosMonitores(requisicion, respuesta, next) {
    try {
      const opciones =
        await this.servicioMonitores.obtenerOpcionesMonitoresEventos(
          requisicion.contextoUsuarioActual,
          {
            tipo: String(requisicion.query.tipo || '').trim(),
            soloActivos: ['1', 'true', 'si', 'yes', 'on'].includes(
              String(requisicion.query.solo_activos || '').toLowerCase()
            )
          }
        );

      respuesta.json({
        ok: true,
        opciones
      });
    } catch (error) {
      next(error);
    }
  }

  async apiOpcionesComparadorEventos(requisicion, respuesta, next) {
    return this.apiOpcionesEventosMonitores(requisicion, respuesta, next);
  }

  async apiOpcionesHistoricoMonitores(requisicion, respuesta, next) {
    try {
      const opciones =
        await this.servicioMonitores.obtenerOpcionesMonitoresEventos(
          requisicion.contextoUsuarioActual,
          {
            tipo: String(requisicion.query.tipo || '').trim(),
            soloActivos: ['1', 'true', 'si', 'yes', 'on'].includes(
              String(requisicion.query.solo_activos || '').toLowerCase()
            )
          }
        );

      respuesta.json({
        ok: true,
        opciones
      });
    } catch (error) {
      next(error);
    }
  }

  construirTituloListado(tipoListadoActivo) {
    const definicion = obtenerDefinicionTipoMonitor(tipoListadoActivo);

    if (definicion) {
      return `Monitores ${definicion.etiqueta}`;
    }

    return 'Monitores';
  }

  construirContextoTipo(tipoMonitor) {
    const tipo = this.normalizarTipoListado(tipoMonitor);
    const definicion = obtenerDefinicionTipoMonitor(tipo);

    if (definicion) {
      const ui = definicion.ui || {};
      return {
        tipo,
        icono: definicion.icono || 'hdd-network',
        tituloListado: ui.tituloListado || `Monitores ${definicion.etiqueta}`,
        subtituloListado:
          ui.subtituloListado || definicion.descripcion || 'Catalogo de monitores.',
        ayudaListado:
          ui.ayudaListado || definicion.descripcion || 'Vista especializada por tipo.',
        etiquetaTipo: definicion.etiqueta,
        etiquetaNuevaEntidad:
          ui.etiquetaNuevaEntidad || `Nuevo ${definicion.etiqueta}`,
        etiquetaBloqueTipo: ui.etiquetaBloqueTipo || 'Configuracion tecnica',
        ayudaFormulario:
          ui.ayudaFormulario || definicion.descripcion || 'Configura este monitor.',
        etiquetaDestino: ui.etiquetaDestino || 'Destino',
        ayudaDestino: ui.ayudaDestino || 'Destino operativo del monitor.',
        etiquetaCrear: ui.etiquetaCrear || `Crear ${definicion.etiqueta}`,
        etiquetaGuardar: ui.etiquetaGuardar || `Guardar ${definicion.etiqueta}`
      };
    }

    return {
      tipo: '',
      icono: 'hdd-network',
      tituloListado: 'Monitores',
      subtituloListado:
        'Catálogo base de monitores persistidos antes de arrancar el runtime.',
      ayudaListado:
        'Vista general con filtros compartidos para los tipos de monitor soportados.',
      etiquetaTipo: 'Todos',
      etiquetaNuevaEntidad: 'Nuevo monitor',
      etiquetaBloqueTipo: 'Configuración técnica',
      ayudaFormulario:
        'El formulario ajusta los parámetros visibles según el tipo seleccionado.',
      etiquetaDestino: 'Destino',
      ayudaDestino: 'Destino operativo del monitor.',
      etiquetaCrear: 'Crear monitor',
      etiquetaGuardar: 'Guardar monitor'
    };
  }

  construirRetornoListado(originalUrl, tipoListadoActivo = '') {
    const base = String(originalUrl || '').trim();

    if (base.startsWith('/monitores')) {
      return base;
    }

    if (tipoListadoActivo) {
      return `/monitores?tipo=${encodeURIComponent(tipoListadoActivo)}`;
    }

    return '/monitores';
  }

  normalizarTipoListado(valor) {
    const normalizado = normalizarTipoMonitor(valor);
    return existeTipoMonitor(normalizado) ? normalizado : '';
  }

  normalizarRetornoListado(valor) {
    const retorno = String(valor || '').trim();

    const esRetornoMonitores = retorno.startsWith('/monitores');
    const esRetornoEnlaces =
      /^\/automatizacion\/enlaces(\?.*)?$/.test(retorno);
    const esRetornoDetalleRegla =
      /^\/agentes\/[1-9][0-9]*\/reglas\/[1-9][0-9]*(\?.*)?$/.test(retorno);

    if (!esRetornoMonitores && !esRetornoEnlaces && !esRetornoDetalleRegla) {
      return null;
    }

    return retorno;
  }

  resolverTipoVistaFormulario(tipoFormulario, retornoListado, tipoSolicitado = null) {
    const tipoRetorno = this.extraerTipoDesdeRetorno(retornoListado);

    if (tipoRetorno) {
      return tipoRetorno;
    }

    const tipoQuery = this.normalizarTipoListado(tipoSolicitado);

    if (tipoQuery) {
      return tipoQuery;
    }

    return this.normalizarTipoListado(tipoFormulario);
  }

  extraerTipoDesdeRetorno(retornoListado) {
    const retorno = this.normalizarRetornoListado(retornoListado);

    if (!retorno) {
      return '';
    }

    const url = new URL(retorno, 'http://localhost');
    return this.normalizarTipoListado(url.searchParams.get('tipo'));
  }

  resolverDestinoRetorno(retorno) {
    return this.normalizarRetornoListado(retorno) || '/monitores';
  }

  normalizarMonitorIdsComparacion(valor) {
    if (Array.isArray(valor)) {
      return valor;
    }

    if (valor == null) {
      return [];
    }

    return String(valor)
      .split(',')
      .map((fragmento) => fragmento.trim())
      .filter(Boolean);
  }
}
