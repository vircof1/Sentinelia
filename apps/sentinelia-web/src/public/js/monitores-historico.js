(function () {
  const modulo = document.querySelector('[data-historico-monitores-lista]');

  if (!modulo) {
    return;
  }

  inicializarHistoricoMonitores(modulo);
})();

function inicializarHistoricoMonitores(modulo) {
  const parametrosIniciales = new URLSearchParams(window.location.search);
  const urlListado = modulo.dataset.urlListado || '';
  const urlOpcionesMonitores = modulo.dataset.urlOpcionesMonitores || '';
  const inputDesde = modulo.querySelector('[data-historico-desde]');
  const inputHasta = modulo.querySelector('[data-historico-hasta]');
  const selectorMonitor = modulo.querySelector('[data-historico-monitor]');
  const selectorTipo = modulo.querySelector('[data-historico-tipo]');
  const selectorEstado = modulo.querySelector('[data-historico-estado]');
  const inputCodigo = modulo.querySelector('[data-historico-codigo]');
  const selectorPageSize = modulo.querySelector('[data-historico-page-size]');
  const selectorSortBy = modulo.querySelector('[data-historico-sort-by]');
  const selectorSortDir = modulo.querySelector('[data-historico-sort-dir]');
  const botonLimpiar = modulo.querySelector('[data-historico-limpiar]');
  const botonesPreseleccion = Array.from(
    modulo.querySelectorAll('[data-historico-preseleccion]')
  );
  const contenedorEstado = modulo.querySelector('[data-historico-lista-estado]');
  const contenedorFilas = modulo.querySelector('[data-historico-filas]');
  const resumenListado = modulo.querySelector('[data-historico-resumen-listado]');
  const contenedorFiltrosActivos = modulo.querySelector(
    '[data-historico-filtros-activos]'
  );
  const etiquetaPaginaActual = modulo.querySelector('[data-historico-pagina-actual]');
  const etiquetaPaginacionResumen = modulo.querySelector(
    '[data-historico-paginacion-resumen]'
  );
  const botonesPaginacion = Array.from(
    modulo.querySelectorAll('[data-page-action]')
  );
  const bloqueResumen = modulo.querySelector('[data-historico-resumen]');
  const paginador = modulo.querySelector('[data-historico-paginador]');
  const kpiTotalMonitores = document.querySelector(
    '[data-historico-total-monitores]'
  );
  const kpiTotalDisponibles = document.querySelector(
    '[data-historico-total-disponibles]'
  );
  const kpiTotalProblemas = document.querySelector(
    '[data-historico-total-problemas]'
  );
  const heroPeriodo = document.querySelector('[data-historico-hero-periodo]');
  const heroTotal = document.querySelector('[data-historico-hero-total]');
  const enlacesHero = Array.from(document.querySelectorAll('[data-historico-hero-enlace]'));
  const slotMonitor = modulo.querySelector('[data-historico-monitor-slot]');
  const slotMonitorEstado = modulo.querySelector(
    '[data-historico-monitor-slot-estado]'
  );
  const slotMonitorTipo = modulo.querySelector(
    '[data-historico-monitor-slot-tipo]'
  );
  const slotMonitorTitulo = modulo.querySelector(
    '[data-historico-monitor-slot-titulo]'
  );
  const slotMonitorDetalle = modulo.querySelector(
    '[data-historico-monitor-slot-detalle]'
  );
  const botonBuscarMonitor = modulo.querySelector(
    '[data-historico-monitor-slot-buscar]'
  );
  const botonLimpiarMonitor = modulo.querySelector(
    '[data-historico-monitor-slot-limpiar]'
  );
  const modalSelector = document.querySelector('[data-historico-selector-modal]');
  let modalSelectorBootstrap = null;
  const urlListadoMonitores = modalSelector?.dataset.urlListado || '';
  const inputSelectorBusqueda = modalSelector?.querySelector(
    '[data-historico-selector-q]'
  );
  const selectorTipoModal = modalSelector?.querySelector(
    '[data-historico-selector-tipo]'
  );
  const selectorTenantModal = modalSelector?.querySelector(
    '[data-historico-selector-tenant]'
  );
  const selectorEmpresaModal = modalSelector?.querySelector(
    '[data-historico-selector-empresa]'
  );
  const selectorPertenenciaModal = modalSelector?.querySelector(
    '[data-historico-selector-pertenencia]'
  );
  const selectorActivoModal = modalSelector?.querySelector(
    '[data-historico-selector-activo]'
  );
  const selectorPageSizeModal = modalSelector?.querySelector(
    '[data-historico-selector-page-size]'
  );
  const selectorSortByModal = modalSelector?.querySelector(
    '[data-historico-selector-sort-by]'
  );
  const selectorSortDirModal = modalSelector?.querySelector(
    '[data-historico-selector-sort-dir]'
  );
  const botonAplicarModal = modalSelector?.querySelector(
    '[data-historico-selector-aplicar]'
  );
  const botonLimpiarModal = modalSelector?.querySelector(
    '[data-historico-selector-limpiar]'
  );
  const estadoListadoModal = modalSelector?.querySelector(
    '[data-historico-selector-estado]'
  );
  const resumenListadoModal = modalSelector?.querySelector(
    '[data-historico-selector-resumen-listado]'
  );
  const filasListadoModal = modalSelector?.querySelector(
    '[data-historico-selector-filas]'
  );
  const paginaActualModal = modalSelector?.querySelector(
    '[data-historico-selector-pagina-actual]'
  );
  const botonesPaginacionModal = Array.from(
    modalSelector?.querySelectorAll('[data-historico-selector-page-action]') || []
  );

  let temporizadorBusqueda = null;
  let temporizadorCargaModal = null;
  const detallesMonitorPorId = new Map();
  const opcionesEmpresaModal = Array.from(
    selectorEmpresaModal?.querySelectorAll('option') || []
  ).map((opcion) => opcion.cloneNode(true));

  const estado = {
    desde: inputDesde?.value || '',
    hasta: inputHasta?.value || '',
    monitorId: selectorMonitor?.value || '',
    tipo: selectorTipo?.value || '',
    estadoTramo: selectorEstado?.value || '',
    codigoResultado: inputCodigo?.value.trim() || '',
    page: Number.parseInt(parametrosIniciales.get('page') || '1', 10) || 1,
    pageSize: Number(selectorPageSize?.value || 25),
    sortBy: selectorSortBy?.value || 'valido_hasta',
    sortDir: selectorSortDir?.value || 'desc',
    totalPaginas: 1
  };
  const estadoSelectorModal = {
    q: '',
    tipo: selectorTipoModal?.value || '',
    tenantId: '',
    empresaId: '',
    nivelPertenencia: '',
    activo: selectorActivoModal?.value || 'solo_activos',
    page: 1,
    pageSize: Number(selectorPageSizeModal?.value || 10),
    sortBy: selectorSortByModal?.value || 'nombre',
    sortDir: selectorSortDirModal?.value || 'asc',
    totalPaginas: 1
  };

  const aplicarEstadoDesdeControles = function ({ resetearPagina = false } = {}) {
    estado.desde = inputDesde?.value || '';
    estado.hasta = inputHasta?.value || '';
    estado.monitorId = selectorMonitor?.value || '';
    estado.tipo = selectorTipo?.value || '';
    estado.estadoTramo = selectorEstado?.value || '';
    estado.codigoResultado = inputCodigo?.value.trim() || '';
    estado.pageSize = Number(selectorPageSize?.value || 25);
    estado.sortBy = selectorSortBy?.value || 'valido_hasta';
    estado.sortDir = selectorSortDir?.value || 'desc';

    if (resetearPagina) {
      estado.page = 1;
    }
  };

  const cargarOpcionesMonitores = async function () {
    if (!selectorMonitor || !urlOpcionesMonitores) {
      actualizarSlotMonitor();
      return;
    }

    const monitorSeleccionado = String(selectorMonitor.value || '').trim();
    const parametros = new URLSearchParams();

    if (selectorTipo?.value) {
      parametros.set('tipo', selectorTipo.value);
    }

    const datos = await fetchJson(
      `${urlOpcionesMonitores}?${parametros.toString()}`
    );
    const opciones = Array.isArray(datos.opciones) ? datos.opciones : [];

    selectorMonitor.innerHTML = '<option value="">Todos</option>';

    for (const opcion of opciones) {
      registrarDetalleMonitorDesdeOpcion(opcion);
      const nodo = document.createElement('option');
      nodo.value = String(opcion.valor);
      nodo.textContent =
        `${opcion.etiqueta} · ${String(opcion.tipo || '').toUpperCase()} · ${opcion.alcance}`;
      selectorMonitor.appendChild(nodo);
    }

    const queryMonitorId = parametrosIniciales.get('monitor_id') || '';
    const valorObjetivo = monitorSeleccionado || queryMonitorId;

    if (valorObjetivo) {
      asegurarOpcionMonitor(selectorMonitor, valorObjetivo);
      selectorMonitor.value = valorObjetivo;
    }

    actualizarSlotMonitor();
  };

  const construirQuery = function () {
    const parametros = new URLSearchParams();
    parametros.set('desde', estado.desde);
    parametros.set('hasta', estado.hasta);
    parametros.set('monitor_id', estado.monitorId);
    parametros.set('tipo', estado.tipo);
    parametros.set('estado', estado.estadoTramo);
    parametros.set('codigo_resultado', estado.codigoResultado);
    parametros.set('page', String(estado.page));
    parametros.set('page_size', String(estado.pageSize));
    parametros.set('sort_by', estado.sortBy);
    parametros.set('sort_dir', estado.sortDir);
    return parametros.toString();
  };

  const sincronizarUrl = function () {
    const url = new URL(window.location.href);

    actualizarParametro(url.searchParams, 'desde', estado.desde);
    actualizarParametro(url.searchParams, 'hasta', estado.hasta);
    actualizarParametro(url.searchParams, 'monitor_id', estado.monitorId);
    actualizarParametro(url.searchParams, 'tipo', estado.tipo);
    actualizarParametro(url.searchParams, 'estado', estado.estadoTramo);
    actualizarParametro(url.searchParams, 'codigo_resultado', estado.codigoResultado);
    actualizarParametro(url.searchParams, 'page', String(estado.page), '1');
    actualizarParametro(url.searchParams, 'page_size', String(estado.pageSize), '25');
    actualizarParametro(url.searchParams, 'sort_by', estado.sortBy, 'valido_hasta');
    actualizarParametro(url.searchParams, 'sort_dir', estado.sortDir, 'desc');

    window.history.replaceState({}, '', url);
  };

  const actualizarResumen = function (datos) {
    const { resumen, paginacion } = datos;

    if (heroPeriodo) {
      heroPeriodo.textContent = `${formatearFechaHero(estado.desde)} – ${formatearFechaHero(estado.hasta)}`;
    }

    if (heroTotal) {
      heroTotal.textContent = String(resumen.totalTramos || 0);
    }

    const hayTramos = Number(resumen.totalTramos || 0) > 0;
    if (bloqueResumen) bloqueResumen.hidden = !hayTramos;
    if (paginador) paginador.hidden = !hayTramos;

    if (kpiTotalMonitores) {
      kpiTotalMonitores.textContent = String(
        resumen.totalMonitoresDistintos || 0
      );
    }

    if (kpiTotalDisponibles) {
      kpiTotalDisponibles.textContent = String(resumen.totalDisponibles || 0);
    }

    if (kpiTotalProblemas) {
      kpiTotalProblemas.textContent = String(
        Number(resumen.totalIndisponibles || 0) +
          Number(resumen.totalDegradados || 0)
      );
    }

    if (resumenListado) {
      resumenListado.hidden = !hayTramos;
      resumenListado.textContent = hayTramos
        ? `Mostrando ${paginacion.desde}-${paginacion.hasta} de ${paginacion.totalFiltrado} tramos filtrados.`
        : '';
    }

    if (etiquetaPaginaActual) {
      etiquetaPaginaActual.hidden = !hayTramos;
      etiquetaPaginaActual.textContent =
        `Página ${paginacion.pagina} de ${paginacion.totalPaginas}`;
    }

    if (etiquetaPaginacionResumen) {
      etiquetaPaginacionResumen.hidden = !hayTramos;
      etiquetaPaginacionResumen.textContent = hayTramos
        ? `${paginacion.totalFiltrado} tramos · ${paginacion.totalPaginas} páginas`
        : '';
    }
  };

  const actualizarFiltrosActivos = function () {
    if (!contenedorFiltrosActivos) {
      return;
    }

    const chips = [];
    chips.push(`Período ${formatearFechaHero(estado.desde)} – ${formatearFechaHero(estado.hasta)}`);

    const detalleMonitor = estado.monitorId
      ? detallesMonitorPorId.get(String(estado.monitorId).trim()) || null
      : null;
    const monitorTexto = detalleMonitor?.nombre
      || selectorMonitor?.selectedOptions?.[0]?.textContent?.trim();

    if (estado.monitorId && monitorTexto) {
      chips.push(`Monitor ${monitorTexto}`);
    }

    const tipoTexto = selectorTipo?.selectedOptions?.[0]?.textContent?.trim();
    if (estado.tipo && tipoTexto && tipoTexto.toLowerCase() !== 'todos') {
      chips.push(`Tipo ${tipoTexto}`);
    }

    const estadoTexto = selectorEstado?.selectedOptions?.[0]?.textContent?.trim();
    if (
      estado.estadoTramo &&
      estadoTexto &&
      estadoTexto.toLowerCase() !== 'todos'
    ) {
      chips.push(`Estado ${estadoTexto}`);
    }

    if (estado.codigoResultado) {
      chips.push(`Código ${estado.codigoResultado}`);
    }

    const ordenTexto = selectorSortBy?.selectedOptions?.[0]?.textContent?.trim();
    const direccionTexto =
      selectorSortDir?.selectedOptions?.[0]?.textContent?.trim();
    if ((estado.sortBy !== 'valido_hasta' || estado.sortDir !== 'desc') && ordenTexto && direccionTexto) {
      chips.push(`Orden ${ordenTexto} · ${direccionTexto}`);
    }

    if (estado.pageSize !== 25) chips.push(`${estado.pageSize} filas por página`);

    contenedorFiltrosActivos.innerHTML = chips
      .map((texto) => `<span class="chip-simple">${escapeHtml(texto)}</span>`)
      .join('');
  };

  const mostrarEstadoCarga = function () {
    contenedorEstado.innerHTML = `
      <div class="d-flex align-items-center gap-3">
        <div class="spinner-border spinner-border-sm text-success" role="status" aria-hidden="true"></div>
        <div>
          <strong class="d-block">Cargando histórico</strong>
          <span class="texto-apoyo">Preparando resumen, filtros y filas visibles...</span>
        </div>
      </div>
    `;
  };

  const mostrarEstadoVacio = function () {
    contenedorEstado.innerHTML = `
      <div class="estado-vacio estado-vacio--compacto">
        <strong class="d-block mb-1">No hay tramos para esta búsqueda.</strong>
        <span>Ajusta el rango temporal o relaja algún filtro para recuperar resultados.</span>
      </div>
    `;
  };

  const mostrarEstadoError = function (mensaje) {
    contenedorEstado.innerHTML = `
      <div class="alert alert-danger mb-0" role="alert">
        <strong class="d-block mb-1">No se pudo cargar el histórico.</strong>
        <span>${escapeHtml(mensaje)}</span>
      </div>
    `;
  };

  const actualizarPaginacionVisual = function () {
    for (const boton of botonesPaginacion) {
      const accion = boton.dataset.pageAction;
      let disabled = false;

      if (accion === 'first' || accion === 'prev') {
        disabled = estado.page <= 1;
      }

      if (accion === 'next' || accion === 'last') {
        disabled = estado.page >= estado.totalPaginas;
      }

      boton.disabled = disabled;
    }
  };

  const renderizarFilas = function (tramos) {
    contenedorFilas.innerHTML = tramos
      .map((tramo) => {
        const retorno = construirUrlRetorno();
        const actividadUrl =
          `/monitores/${encodeURIComponent(tramo.monitorId)}?return_to=${encodeURIComponent(retorno)}`;
        const tono = String(tramo.resumen?.tono || '').trim().toLowerCase();
        const tonoCss = tono === 'ok'
          ? 'ok'
          : (tono === 'advertencia' ? 'advertencia' : 'alerta');
        const claseFilaTono = tonoCss === 'ok'
          ? ''
          : ` fila-monitor--${tonoCss}`;
        const compactacion = tramo.compactacion || null;
        const metricaPrincipal = tramo.metricaPrincipal || null;
        const protocolo = tramo.protocolo || null;

        return `
          <div class="fila-configuracion fila-monitor fila-monitor--historico${claseFilaTono}">
            <div class="celda-clave historico-fila__identidad">
              <strong>${escapeHtml(tramo.nombreMonitor || `Monitor #${tramo.monitorId}`)}</strong>
              <div class="fila-monitor__etiquetas">
                <span class="insignia-monitor insignia-monitor--${escapeHtml(String(tramo.tipoMonitor || '').toLowerCase() || 'base')}">${escapeHtml(etiquetarTipoMonitor(tramo.tipoMonitor))}</span>
                <span class="insignia-monitor insignia-monitor--${escapeHtml(tonoCss)}">${escapeHtml(tramo.resumen?.etiquetaEstado || tramo.estadoTramo || 'tramo')}</span>
                ${tramo.monitorActivo ? '' : '<span class="insignia-monitor insignia-monitor--off">Monitor inactivo</span>'}
              </div>
              <span class="etiqueta-secundaria">${escapeHtml(tramo.alcanceDescripcion || '-')}</span>
              <span class="historico-fila__mensaje">${escapeHtml(tramo.resumen?.detalle || tramo.mensajeUltimoResultado || 'Sin detalle operativo adicional.')}</span>
            </div>

            <div class="historico-fila__periodo">
              <span>Desde <time data-fecha-utc="${escapeHtml(tramo.validoDesdeUtc || '')}">${escapeHtml(tramo.validoDesdeUtc || '')}</time></span>
              <span>Hasta <time data-fecha-utc="${escapeHtml(tramo.validoHastaUtc || '')}">${escapeHtml(tramo.validoHastaUtc || '')}</time></span>
              <strong>${escapeHtml(tramo.duracionTexto || 'Sin duración')} · ${escapeHtml(Number(tramo.contadorRepeticiones || 0).toLocaleString('es-ES'))} repeticiones</strong>
            </div>

            <div class="acciones-lista historico-fila__acciones">
              <a href="${escapeHtml(actividadUrl)}" class="btn btn-outline-primary btn-sm d-inline-flex align-items-center gap-2">
                <span class="bi bi-activity" aria-hidden="true"></span>
                <span>Ver actividad</span>
              </a>
            </div>

            <details class="historico-fila__detalles">
              <summary>Detalles técnicos del tramo <i class="bi bi-chevron-down" aria-hidden="true"></i></summary>
              <div class="metadatos-configuracion historico-fila__tecnicos">
                <span>Monitor: <code>#${escapeHtml(String(tramo.monitorId || ''))}</code></span>
                <span>Código de resultado: <code>${escapeHtml(tramo.codigoUltimoResultado || 'sin_resultado')}</code></span>
                ${compactacion ? `<span>Compactación: <code>${escapeHtml(compactacion.variante || 'estable')}</code></span>` : ''}
                ${compactacion?.familiaResultado ? `<span>Familia: <code>${escapeHtml(compactacion.familiaResultado)}</code></span>` : ''}
                ${tramo.ultimoEventoId ? `<span>Último evento: <code>#${escapeHtml(String(tramo.ultimoEventoId))}</code></span>` : ''}
                ${protocolo?.host ? `<span>Destino: <code>${escapeHtml(protocolo.host)}${protocolo.puerto ? `:${escapeHtml(String(protocolo.puerto))}` : ''}</code></span>` : ''}
                ${metricaPrincipal?.rttMs != null ? `<span>RTT: <code>${escapeHtml(String(metricaPrincipal.rttMs))} ms</code></span>` : ''}
                ${metricaPrincipal?.ttlRespuesta != null ? `<span>TTL resp.: <code>${escapeHtml(String(metricaPrincipal.ttlRespuesta))}</code></span>` : ''}
                ${metricaPrincipal?.certificadoDiasRestantes != null ? `<span>Certificado: <code>${escapeHtml(String(metricaPrincipal.certificadoDiasRestantes))} días</code></span>` : ''}
                <span>Actualizado: <code><time data-fecha-utc="${escapeHtml(tramo.fechaActualizacion || '')}">${escapeHtml(tramo.fechaActualizacion || '')}</time></code></span>
              </div>
            </details>
          </div>
        `;
      })
      .join('');

    window.portalFechas?.hidratar?.();
  };

  const cargar = async function () {
    mostrarEstadoCarga();
    contenedorFilas.innerHTML = '';

    try {
      const datos = await fetchJson(`${urlListado}?${construirQuery()}`);
      estado.totalPaginas = datos.paginacion.totalPaginas;
      renderizarFilas(datos.tramos || []);
      actualizarResumen(datos);
      actualizarFiltrosActivos();
      actualizarPaginacionVisual();
      sincronizarUrl();
      actualizarEnlacesHero();

      if ((datos.tramos || []).length > 0) {
        contenedorEstado.innerHTML = '';
      } else {
        mostrarEstadoVacio();
      }
    } catch (error) {
      mostrarEstadoError(error.message);
      window.portalToast?.show?.({
        tipo: 'error',
        titulo: 'No se pudo cargar el histórico',
        cuerpo: error.message
      });
    }
  };

  const construirUrlRetorno = function () {
    const url = new URL(window.location.href);

    actualizarParametro(url.searchParams, 'desde', estado.desde);
    actualizarParametro(url.searchParams, 'hasta', estado.hasta);
    actualizarParametro(url.searchParams, 'monitor_id', estado.monitorId);
    actualizarParametro(url.searchParams, 'tipo', estado.tipo);
    actualizarParametro(url.searchParams, 'estado', estado.estadoTramo);
    actualizarParametro(url.searchParams, 'codigo_resultado', estado.codigoResultado);
    actualizarParametro(url.searchParams, 'page', String(estado.page), '1');
    actualizarParametro(url.searchParams, 'page_size', String(estado.pageSize), '25');
    actualizarParametro(url.searchParams, 'sort_by', estado.sortBy, 'valido_hasta');
    actualizarParametro(url.searchParams, 'sort_dir', estado.sortDir, 'desc');

    return `${url.pathname}${url.search}`;
  };

  const actualizarEnlacesHero = function () {
    const retorno = construirUrlRetorno();
    for (const enlace of enlacesHero) {
      const destino = new URL(enlace.href, window.location.origin);
      destino.searchParams.set('return_to', retorno);
      enlace.href = `${destino.pathname}${destino.search}`;
    }
  };

  const programarCarga = function () {
    window.clearTimeout(temporizadorBusqueda);
    temporizadorBusqueda = window.setTimeout(async function () {
      aplicarEstadoDesdeControles({ resetearPagina: true });
      await cargar();
    }, 240);
  };

  function construirDetalleSlotMonitor(detalle, monitorId) {
    if (!detalle) {
      return `Monitor #${monitorId} seleccionado para filtrar el histórico.`;
    }

    const partes = [
      detalle.tipo ? String(detalle.tipo).toUpperCase() : '',
      detalle.alcanceDescripcion || detalle.alcance || ''
    ].filter(Boolean);

    if (partes.length === 0) {
      return `Monitor #${monitorId} seleccionado para filtrar el histórico.`;
    }

    return partes.join(' · ');
  }

  function registrarDetalleMonitorDesdeOpcion(opcion) {
    const monitorId = String(opcion?.valor || '').trim();

    if (!monitorId) {
      return;
    }

    detallesMonitorPorId.set(monitorId, {
      id: monitorId,
      nombre: String(opcion?.etiqueta || '').replace(/\s+\(#\d+\)\s*$/, ''),
      tipo: String(opcion?.tipo || '').trim().toLowerCase(),
      alcanceDescripcion: String(opcion?.alcance || '').trim()
    });
  }

  function registrarDetalleMonitorDesdeListado(monitor) {
    const monitorId = String(monitor?.id || '').trim();

    if (!monitorId) {
      return;
    }

    detallesMonitorPorId.set(monitorId, {
      id: monitorId,
      nombre: String(monitor?.nombre || `Monitor #${monitorId}`),
      tipo: String(monitor?.tipo || '').trim().toLowerCase(),
      alcanceDescripcion: String(monitor?.alcanceDescripcion || '').trim()
    });
  }

  function asegurarOpcionMonitor(selector, monitorId) {
    if (
      Array.from(selector.options).some(
        (opcion) => String(opcion.value || '') === String(monitorId)
      )
    ) {
      return;
    }

    const detalle = detallesMonitorPorId.get(String(monitorId).trim()) || null;
    const nodo = document.createElement('option');
    nodo.value = String(monitorId);
    nodo.textContent = detalle
      ? [
          detalle.nombre || `Monitor #${monitorId}`,
          detalle.tipo ? String(detalle.tipo).toUpperCase() : '',
          detalle.alcanceDescripcion || ''
        ].filter(Boolean).join(' · ')
      : `Monitor #${monitorId}`;
    selector.appendChild(nodo);
  }

  function actualizarSlotMonitor() {
    if (!slotMonitor) {
      return;
    }

    const monitorId = String(selectorMonitor?.value || '').trim();
    const detalle = monitorId ? detallesMonitorPorId.get(monitorId) || null : null;

    if (!monitorId) {
      slotMonitor.dataset.estado = 'vacio';

      if (slotMonitorEstado) {
        slotMonitorEstado.textContent = 'Todos';
        slotMonitorEstado.className =
          'insignia-monitor insignia-monitor--suave comparador-slot__estado';
      }

      if (slotMonitorTipo) {
        slotMonitorTipo.hidden = true;
        slotMonitorTipo.textContent = 'Tipo';
        slotMonitorTipo.className =
          'insignia-monitor insignia-monitor--suave comparador-slot__tipo';
      }

      if (slotMonitorTitulo) {
        slotMonitorTitulo.textContent = 'Todos los monitores visibles';
      }

      if (slotMonitorDetalle) {
        slotMonitorDetalle.textContent =
          'Abre el selector para buscar por nombre, tipo o alcance sin recorrer una lista interminable.';
      }

      if (botonBuscarMonitor) {
        const texto = botonBuscarMonitor.querySelector('span');

        if (texto) {
          texto.textContent = 'Buscar monitor';
        }
      }

      if (botonLimpiarMonitor) {
        botonLimpiarMonitor.hidden = true;
      }

      return;
    }

    slotMonitor.dataset.estado = 'seleccionado';

    if (slotMonitorEstado) {
      slotMonitorEstado.textContent = 'Filtrado';
      slotMonitorEstado.className =
        'insignia-monitor insignia-monitor--ok comparador-slot__estado';
    }

    if (slotMonitorTipo) {
      const tipoMonitor = String(detalle?.tipo || '').trim().toLowerCase();
      slotMonitorTipo.hidden = !tipoMonitor;
      slotMonitorTipo.textContent = tipoMonitor
        ? String(tipoMonitor).toUpperCase()
        : 'Tipo';
      slotMonitorTipo.className = tipoMonitor
        ? `insignia-monitor insignia-monitor--${tipoMonitor} comparador-slot__tipo`
        : 'insignia-monitor insignia-monitor--suave comparador-slot__tipo';
    }

    if (slotMonitorTitulo) {
      slotMonitorTitulo.textContent = detalle?.nombre || `Monitor #${monitorId}`;
    }

    if (slotMonitorDetalle) {
      slotMonitorDetalle.textContent = construirDetalleSlotMonitor(
        detalle,
        monitorId
      );
    }

    if (botonBuscarMonitor) {
      const texto = botonBuscarMonitor.querySelector('span');

      if (texto) {
        texto.textContent = 'Cambiar monitor';
      }
    }

    if (botonLimpiarMonitor) {
      botonLimpiarMonitor.hidden = false;
    }
  }

  function obtenerModalSelectorBootstrap() {
    if (!modalSelector || !window.bootstrap?.Modal) {
      return null;
    }

    if (!modalSelectorBootstrap) {
      modalSelectorBootstrap = window.bootstrap.Modal.getOrCreateInstance
        ? window.bootstrap.Modal.getOrCreateInstance(modalSelector)
        : new window.bootstrap.Modal(modalSelector);
    }

    return modalSelectorBootstrap;
  }

  function reconstruirEmpresasModal() {
    if (!selectorEmpresaModal) {
      return;
    }

    const seleccionActual = selectorEmpresaModal.value;
    const tenantId = selectorTenantModal?.value || '';
    selectorEmpresaModal.innerHTML = '';

    for (const opcion of opcionesEmpresaModal) {
      const tenantOpcion = opcion.dataset.tenantId || '';

      if (!opcion.value || !tenantId || tenantOpcion === tenantId) {
        selectorEmpresaModal.appendChild(opcion.cloneNode(true));
      }
    }

    if (
      Array.from(selectorEmpresaModal.options).some(
        (opcion) => opcion.value === seleccionActual
      )
    ) {
      selectorEmpresaModal.value = seleccionActual;
    } else if (seleccionActual) {
      selectorEmpresaModal.value = '';
    }
  }

  function aplicarEstadoModalDesdeControles({ resetearPagina = false } = {}) {
    estadoSelectorModal.q = inputSelectorBusqueda?.value.trim() || '';
    estadoSelectorModal.tipo = selectorTipoModal?.value || '';
    estadoSelectorModal.tenantId = selectorTenantModal?.value || '';
    estadoSelectorModal.empresaId = selectorEmpresaModal?.value || '';
    estadoSelectorModal.nivelPertenencia =
      selectorPertenenciaModal?.value || '';
    estadoSelectorModal.activo = selectorActivoModal?.value || 'solo_activos';
    estadoSelectorModal.pageSize = Number(selectorPageSizeModal?.value || 10);
    estadoSelectorModal.sortBy = selectorSortByModal?.value || 'nombre';
    estadoSelectorModal.sortDir = selectorSortDirModal?.value || 'asc';

    if (resetearPagina) {
      estadoSelectorModal.page = 1;
    }
  }

  function construirQuerySelectorMonitores() {
    const parametros = new URLSearchParams();
    parametros.set('q', estadoSelectorModal.q);
    parametros.set('tipo', estadoSelectorModal.tipo);
    parametros.set('tenant_id', estadoSelectorModal.tenantId);
    parametros.set('empresa_id', estadoSelectorModal.empresaId);
    parametros.set(
      'nivel_pertenencia',
      estadoSelectorModal.nivelPertenencia
    );
    parametros.set('activo', estadoSelectorModal.activo);
    parametros.set('page', String(estadoSelectorModal.page));
    parametros.set('page_size', String(estadoSelectorModal.pageSize));
    parametros.set('sort_by', estadoSelectorModal.sortBy);
    parametros.set('sort_dir', estadoSelectorModal.sortDir);
    return parametros.toString();
  }

  function programarCargaSelectorMonitores() {
    window.clearTimeout(temporizadorCargaModal);
    temporizadorCargaModal = window.setTimeout(function () {
      void cargarListadoSelectorMonitores();
    }, 220);
  }

  function actualizarPaginacionSelectorMonitores(paginacion) {
    if (paginaActualModal) {
      paginaActualModal.textContent =
        `Página ${paginacion.pagina || 1} de ${paginacion.totalPaginas || 1}`;
    }

    for (const boton of botonesPaginacionModal) {
      const accion = boton.dataset.historicoSelectorPageAction;
      let disabled = false;

      if (accion === 'first' || accion === 'prev') {
        disabled = estadoSelectorModal.page <= 1;
      }

      if (accion === 'next' || accion === 'last') {
        disabled = estadoSelectorModal.page >= estadoSelectorModal.totalPaginas;
      }

      boton.disabled = disabled;
    }
  }

  function renderizarFilasSelectorMonitores(monitores) {
    if (!filasListadoModal) {
      return;
    }

    if (!Array.isArray(monitores) || monitores.length === 0) {
      filasListadoModal.innerHTML = `
        <tr>
          <td colspan="6" class="text-body-secondary">
            <div class="py-3 d-inline-flex align-items-center gap-2">
              <i class="bi bi-inbox" aria-hidden="true"></i>
              <span>No hay monitores visibles con el filtro actual.</span>
            </div>
          </td>
        </tr>
      `;
      return;
    }

    const seleccionadoActual = String(selectorMonitor?.value || '').trim();

    filasListadoModal.innerHTML = monitores
      .map((monitor) => {
        registrarDetalleMonitorDesdeListado(monitor);
        const monitorId = String(monitor.id || '');
        const tipoMonitor = String(monitor.tipo || '').toLowerCase();
        const estadoRuntime = monitor.estadoRuntime || null;
        const resumenRuntime = estadoRuntime?.resumenHumano || null;
        const runtimeEtiqueta = estadoRuntime
          ? (resumenRuntime?.etiquetaEstado || estadoRuntime.estado || 'desconocido')
          : 'No materializado';
        const runtimeTecnico = estadoRuntime
          ? (resumenRuntime?.etiquetaTecnica || estadoRuntime.codigoResultado || 'sin_resultado')
          : 'Sin estado';
        const scopeTexto = monitor.alcanceDescripcion || [
          monitor.empresaNombre || '-',
          monitor.sitioNombre || null
        ].filter(Boolean).join(' / ');
        const seleccionado = seleccionadoActual === monitorId;

        return `
          <tr>
            <td>
              <div class="d-grid gap-1">
                <strong>${escapeHtml(monitor.nombre || `Monitor #${monitorId}`)}</strong>
                <small class="text-body-secondary">
                  #${escapeHtml(monitorId)}
                  ${monitor.descripcion ? `· ${escapeHtml(monitor.descripcion)}` : ''}
                </small>
              </div>
            </td>
            <td>
              <span class="insignia-monitor insignia-monitor--${escapeHtml(tipoMonitor || 'base')}">
                ${escapeHtml(String(monitor.tipo || '').toUpperCase())}
              </span>
            </td>
            <td>
              <span class="d-block">${escapeHtml(scopeTexto || '-')}</span>
              <small class="text-body-secondary">${escapeHtml(monitor.nivelPertenencia || '-')}</small>
            </td>
            <td>
              <span class="insignia-monitor ${estadoRuntime ? 'insignia-monitor--ok' : 'insignia-monitor--suave'}">
                ${escapeHtml(runtimeEtiqueta)}
              </span>
              <small class="d-block text-body-secondary">${escapeHtml(runtimeTecnico)}</small>
            </td>
            <td>
              <span class="organizacion-contador">
                <i class="bi bi-stopwatch" aria-hidden="true"></i>
                <span>${escapeHtml(String(monitor.intervaloEjecucionSegundos || '-'))} s</span>
              </span>
            </td>
            <td class="text-end">
              <button
                type="button"
                class="btn btn-sm ${seleccionado ? 'btn-outline-secondary' : 'btn-success'}"
                data-historico-selector-elegir="${escapeHtml(monitorId)}"
              >
                ${seleccionado ? 'Seleccionado' : 'Seleccionar'}
              </button>
            </td>
          </tr>
        `;
      })
      .join('');

    for (const boton of filasListadoModal.querySelectorAll('[data-historico-selector-elegir]')) {
      boton.addEventListener('click', function () {
        const monitorId = String(
          boton.dataset.historicoSelectorElegir || ''
        ).trim();
        seleccionarMonitorDesdeModal(monitorId);
      });
    }
  }

  async function cargarListadoSelectorMonitores() {
    if (!modalSelector || !urlListadoMonitores || !filasListadoModal) {
      return;
    }

    if (estadoListadoModal) {
      estadoListadoModal.textContent = 'Cargando monitores...';
    }
    filasListadoModal.innerHTML = '';

    try {
      const datos = await fetchJson(
        `${urlListadoMonitores}?${construirQuerySelectorMonitores()}`
      );
      const monitores = Array.isArray(datos.monitores) ? datos.monitores : [];
      const paginacion = datos.paginacion || {};

      estadoSelectorModal.totalPaginas = Number(paginacion.totalPaginas || 1) || 1;
      renderizarFilasSelectorMonitores(monitores);
      actualizarPaginacionSelectorMonitores(paginacion);

      if (resumenListadoModal) {
        resumenListadoModal.textContent =
          Number(paginacion.totalFiltrado || 0) > 0
            ? `Mostrando ${paginacion.desde}-${paginacion.hasta} de ${paginacion.totalFiltrado} monitores filtrados.`
            : 'No hay monitores visibles con el filtro actual.';
      }

      if (estadoListadoModal) {
        estadoListadoModal.textContent =
          monitores.length > 0
            ? ''
            : 'No hay monitores visibles con el filtro actual.';
      }
    } catch (error) {
      if (estadoListadoModal) {
        estadoListadoModal.textContent = error.message;
      }
      filasListadoModal.innerHTML = `
        <tr>
          <td colspan="6" class="text-danger">${escapeHtml(error.message)}</td>
        </tr>
      `;
      window.portalToast?.show?.({
        tipo: 'error',
        titulo: 'Selector de monitores',
        cuerpo: error.message
      });
    }
  }

  function seleccionarMonitorDesdeModal(monitorId) {
    const monitorIdNormalizado = String(monitorId || '').trim();

    if (!selectorMonitor || !monitorIdNormalizado) {
      return;
    }

    asegurarOpcionMonitor(selectorMonitor, monitorIdNormalizado);
    selectorMonitor.value = monitorIdNormalizado;
    actualizarSlotMonitor();
    aplicarEstadoDesdeControles({ resetearPagina: true });
    void cargar();
    obtenerModalSelectorBootstrap()?.hide();

    const detalle = detallesMonitorPorId.get(monitorIdNormalizado) || null;
    window.portalToast?.show?.({
      tipo: 'exito',
      titulo: 'Histórico de monitores',
      cuerpo: `${detalle?.nombre || `Monitor #${monitorIdNormalizado}`} aplicado como filtro.`,
      duracionMs: 2400
    });
  }

  function abrirSelectorMonitor() {
    const instanciaModal = obtenerModalSelectorBootstrap();

    if (!instanciaModal) {
      return;
    }

    if (selectorTipoModal && selectorTipo) {
      selectorTipoModal.value = selectorTipo.value || '';
    }

    aplicarEstadoModalDesdeControles({ resetearPagina: true });
    instanciaModal.show();
    void cargarListadoSelectorMonitores();
  }

  function inicializarSelectorMonitoresModal() {
    if (!modalSelector || !urlListadoMonitores) {
      return;
    }

    reconstruirEmpresasModal();

    inputSelectorBusqueda?.addEventListener('input', function () {
      aplicarEstadoModalDesdeControles({ resetearPagina: true });
      programarCargaSelectorMonitores();
    });

    selectorTipoModal?.addEventListener('change', function () {
      aplicarEstadoModalDesdeControles({ resetearPagina: true });
      void cargarListadoSelectorMonitores();
    });

    selectorTenantModal?.addEventListener('change', function () {
      reconstruirEmpresasModal();
      aplicarEstadoModalDesdeControles({ resetearPagina: true });
      void cargarListadoSelectorMonitores();
    });

    selectorEmpresaModal?.addEventListener('change', function () {
      aplicarEstadoModalDesdeControles({ resetearPagina: true });
      void cargarListadoSelectorMonitores();
    });

    selectorPertenenciaModal?.addEventListener('change', function () {
      aplicarEstadoModalDesdeControles({ resetearPagina: true });
      void cargarListadoSelectorMonitores();
    });

    selectorActivoModal?.addEventListener('change', function () {
      aplicarEstadoModalDesdeControles({ resetearPagina: true });
      void cargarListadoSelectorMonitores();
    });

    selectorPageSizeModal?.addEventListener('change', function () {
      aplicarEstadoModalDesdeControles({ resetearPagina: true });
      void cargarListadoSelectorMonitores();
    });

    selectorSortByModal?.addEventListener('change', function () {
      aplicarEstadoModalDesdeControles({ resetearPagina: true });
      void cargarListadoSelectorMonitores();
    });

    selectorSortDirModal?.addEventListener('change', function () {
      aplicarEstadoModalDesdeControles({ resetearPagina: true });
      void cargarListadoSelectorMonitores();
    });

    botonAplicarModal?.addEventListener('click', function () {
      aplicarEstadoModalDesdeControles({ resetearPagina: true });
      void cargarListadoSelectorMonitores();
    });

    botonLimpiarModal?.addEventListener('click', function () {
      if (inputSelectorBusqueda) inputSelectorBusqueda.value = '';
      if (selectorTipoModal) selectorTipoModal.value = selectorTipo?.value || '';
      if (selectorTenantModal) selectorTenantModal.value = '';
      reconstruirEmpresasModal();
      if (selectorEmpresaModal) selectorEmpresaModal.value = '';
      if (selectorPertenenciaModal) selectorPertenenciaModal.value = '';
      if (selectorActivoModal) selectorActivoModal.value = 'solo_activos';
      if (selectorPageSizeModal) selectorPageSizeModal.value = '10';
      if (selectorSortByModal) selectorSortByModal.value = 'nombre';
      if (selectorSortDirModal) selectorSortDirModal.value = 'asc';
      aplicarEstadoModalDesdeControles({ resetearPagina: true });
      void cargarListadoSelectorMonitores();
    });

    for (const boton of botonesPaginacionModal) {
      boton.addEventListener('click', function () {
        const accion = boton.dataset.historicoSelectorPageAction;

        if (accion === 'first') estadoSelectorModal.page = 1;
        if (accion === 'prev') {
          estadoSelectorModal.page = Math.max(1, estadoSelectorModal.page - 1);
        }
        if (accion === 'next') {
          estadoSelectorModal.page = Math.min(
            estadoSelectorModal.totalPaginas,
            estadoSelectorModal.page + 1
          );
        }
        if (accion === 'last') {
          estadoSelectorModal.page = estadoSelectorModal.totalPaginas;
        }

        void cargarListadoSelectorMonitores();
      });
    }

    modalSelector.addEventListener('shown.bs.modal', function () {
      inputSelectorBusqueda?.focus();
    });
  }

  botonBuscarMonitor?.addEventListener('click', function () {
    abrirSelectorMonitor();
  });

  botonLimpiarMonitor?.addEventListener('click', async function () {
    if (selectorMonitor) {
      selectorMonitor.value = '';
    }

    actualizarSlotMonitor();
    aplicarEstadoDesdeControles({ resetearPagina: true });
    await cargar();
  });

  if (inputCodigo) {
    inputCodigo.addEventListener('input', programarCarga);
  }

  if (inputDesde) {
    inputDesde.addEventListener('change', async function () {
      aplicarEstadoDesdeControles({ resetearPagina: true });
      await cargar();
    });
  }

  if (inputHasta) {
    inputHasta.addEventListener('change', async function () {
      aplicarEstadoDesdeControles({ resetearPagina: true });
      await cargar();
    });
  }

  if (selectorTipo) {
    selectorTipo.addEventListener('change', async function () {
      await cargarOpcionesMonitores();
      aplicarEstadoDesdeControles({ resetearPagina: true });
      await cargar();
    });
  }

  if (selectorMonitor) {
    selectorMonitor.addEventListener('change', async function () {
      actualizarSlotMonitor();
      aplicarEstadoDesdeControles({ resetearPagina: true });
      await cargar();
    });
  }

  if (selectorEstado) {
    selectorEstado.addEventListener('change', async function () {
      aplicarEstadoDesdeControles({ resetearPagina: true });
      await cargar();
    });
  }

  if (selectorPageSize) {
    selectorPageSize.addEventListener('change', async function () {
      aplicarEstadoDesdeControles({ resetearPagina: true });
      await cargar();
    });
  }

  if (selectorSortBy) {
    selectorSortBy.addEventListener('change', async function () {
      aplicarEstadoDesdeControles({ resetearPagina: true });
      await cargar();
    });
  }

  if (selectorSortDir) {
    selectorSortDir.addEventListener('change', async function () {
      aplicarEstadoDesdeControles({ resetearPagina: true });
      await cargar();
    });
  }

  if (botonLimpiar) {
    botonLimpiar.addEventListener('click', async function () {
      if (selectorTipo) selectorTipo.value = '';
      if (selectorEstado) selectorEstado.value = '';
      if (inputCodigo) inputCodigo.value = '';
      if (selectorPageSize) selectorPageSize.value = '25';
      if (selectorSortBy) selectorSortBy.value = 'valido_hasta';
      if (selectorSortDir) selectorSortDir.value = 'desc';

      const hoy = new Date();
      const inicio = new Date(hoy);
      inicio.setDate(hoy.getDate() - 6);

      if (inputDesde) inputDesde.value = formatearFechaInput(inicio);
      if (inputHasta) inputHasta.value = formatearFechaInput(hoy);

      await cargarOpcionesMonitores();
      if (selectorMonitor) selectorMonitor.value = '';
      actualizarSlotMonitor();
      aplicarEstadoDesdeControles({ resetearPagina: true });
      await cargar();
    });
  }

  for (const boton of botonesPreseleccion) {
    boton.addEventListener('click', async function () {
      const valor = String(boton.dataset.historicoPreseleccion || '').trim();
      const hoy = new Date();
      const inicio = new Date(hoy);

      if (valor === '30d') {
        inicio.setDate(hoy.getDate() - 29);
      } else if (valor === '7d') {
        inicio.setDate(hoy.getDate() - 6);
      }

      if (inputDesde) inputDesde.value = formatearFechaInput(inicio);
      if (inputHasta) inputHasta.value = formatearFechaInput(hoy);
      aplicarEstadoDesdeControles({ resetearPagina: true });
      await cargar();
    });
  }

  for (const boton of botonesPaginacion) {
    boton.addEventListener('click', async function () {
      const accion = boton.dataset.pageAction;

      if (accion === 'first') estado.page = 1;
      if (accion === 'prev') estado.page = Math.max(1, estado.page - 1);
      if (accion === 'next') estado.page = Math.min(estado.totalPaginas, estado.page + 1);
      if (accion === 'last') estado.page = estado.totalPaginas;

      await cargar();
    });
  }

  inicializarSelectorMonitoresModal();

  (async function init() {
    await cargarOpcionesMonitores();
    aplicarEstadoDesdeControles({ resetearPagina: false });
    actualizarSlotMonitor();
    actualizarFiltrosActivos();
    await cargar();
  })().catch(function (error) {
    window.portalToast?.show?.({
      tipo: 'error',
      titulo: 'Error al preparar el histórico',
      cuerpo: error.message
    });
  });
}

function actualizarParametro(searchParams, clave, valor, porDefecto = '') {
  const normalizado = String(valor ?? '');

  if (!normalizado || normalizado === String(porDefecto)) {
    searchParams.delete(clave);
    return;
  }

  searchParams.set(clave, normalizado);
}

async function fetchJson(url, opciones = {}) {
  const respuesta = await window.fetch(url, {
    headers: {
      accept: 'application/json',
      ...(opciones.headers || {})
    },
    ...opciones
  });

  const texto = await respuesta.text();
  let datos = null;

  try {
    datos = texto ? JSON.parse(texto) : {};
  } catch (_error) {
    throw new Error(texto || 'La respuesta del servidor no es válida.');
  }

  if (!respuesta.ok || datos.ok === false) {
    throw new Error(datos.mensaje || 'La operación no se ha podido completar.');
  }

  return datos;
}

function formatearFechaInput(fecha) {
  const valor = fecha instanceof Date ? fecha : new Date(fecha);

  if (Number.isNaN(valor.getTime())) {
    return '';
  }

  const ano = valor.getFullYear();
  const mes = String(valor.getMonth() + 1).padStart(2, '0');
  const dia = String(valor.getDate()).padStart(2, '0');

  return `${ano}-${mes}-${dia}`;
}

function formatearFechaHero(valor) {
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(valor || ''));
  return partes ? `${partes[3]}/${partes[2]}/${partes[1]}` : '—';
}

function etiquetarTipoMonitor(tipo) {
  return {
    ping: 'Ping',
    tcp: 'TCP',
    booleano: 'Lógico',
    telemetria: 'Telemetría'
  }[String(tipo || '').toLowerCase()] || String(tipo || 'Monitor');
}

function escapeHtml(texto) {
  return String(texto)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
