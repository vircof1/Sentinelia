(function () {
  const modulo = document.querySelector('[data-comparador-eventos-shell]');

  if (!modulo || !window.Chart) {
    return;
  }

  const urlComparacion = modulo.dataset.urlComparacion || '';
  const urlOpcionesMonitores = modulo.dataset.urlOpcionesMonitores || '';
  const inputDesde = modulo.querySelector('[data-comparador-desde]');
  const inputHasta = modulo.querySelector('[data-comparador-hasta]');
  const selectoresMonitores = Array.from(
    modulo.querySelectorAll('[data-comparador-monitor]')
  );
  const slotsMonitores = Array.from(
    modulo.querySelectorAll('[data-comparador-slot]')
  ).map((nodo) => ({
    nodo,
    indice: Number(nodo.dataset.comparadorSlot || 0),
    estado: nodo.querySelector('[data-comparador-slot-estado]'),
    tipo: nodo.querySelector('[data-comparador-slot-tipo]'),
    titulo: nodo.querySelector('[data-comparador-slot-titulo]'),
    detalle: nodo.querySelector('[data-comparador-slot-detalle]'),
    botonBuscar: nodo.querySelector('[data-comparador-slot-buscar]'),
    botonLimpiar: nodo.querySelector('[data-comparador-slot-limpiar]')
  }));
  const heroMonitores = document.querySelector('[data-comparador-hero-monitores]');
  const heroMonitoresDetalle = document.querySelector('[data-comparador-hero-monitores-detalle]');
  const heroPeriodo = document.querySelector('[data-comparador-hero-periodo]');
  const heroPeriodoDetalle = document.querySelector('[data-comparador-hero-periodo-detalle]');
  const enlaceVistaIndividual = document.querySelector('[data-comparador-hero-individual]');
  const enlaceHistorico = document.querySelector('[data-comparador-hero-historico]');
  const botonAplicar = modulo.querySelector('[data-comparador-aplicar]');
  const botonLimpiar = modulo.querySelector('[data-comparador-limpiar]');
  const botonesPreseleccion = Array.from(
    modulo.querySelectorAll('[data-comparador-preseleccion]')
  );
  const etiquetaEstadoCarga = modulo.querySelector('[data-comparador-estado-carga]');
  const etiquetaTotalPuntos = modulo.querySelector(
    '[data-comparador-total-puntos]'
  );
  const etiquetaTotalPuntosDetalle = modulo.querySelector(
    '[data-comparador-total-puntos-detalle]'
  );
  const etiquetaRangoMetrica = modulo.querySelector(
    '[data-comparador-rango-metrica]'
  );
  const etiquetaRangoMetricaDetalle = modulo.querySelector(
    '[data-comparador-rango-metrica-detalle]'
  );
  const resumenSeries = modulo.querySelector('[data-comparador-serie-resumen]');
  const leyendaIntervalos = modulo.querySelector('[data-comparador-leyenda]');
  const panelDetalle = modulo.querySelector('[data-comparador-detalle]');
  const canvas = modulo.querySelector('[data-comparador-canvas]');
  const modalSelector = document.querySelector('[data-comparador-selector-modal]');
  let modalSelectorBootstrap = null;
  const urlListadoMonitores = modalSelector?.dataset.urlListado || '';
  const tituloSlotModal = modalSelector?.querySelector(
    '[data-comparador-selector-slot-titulo]'
  );
  const inputSelectorBusqueda = modalSelector?.querySelector(
    '[data-comparador-selector-q]'
  );
  const selectorTipoModal = modalSelector?.querySelector(
    '[data-comparador-selector-tipo]'
  );
  const selectorTenantModal = modalSelector?.querySelector(
    '[data-comparador-selector-tenant]'
  );
  const selectorEmpresaModal = modalSelector?.querySelector(
    '[data-comparador-selector-empresa]'
  );
  const selectorPertenenciaModal = modalSelector?.querySelector(
    '[data-comparador-selector-pertenencia]'
  );
  const selectorActivoModal = modalSelector?.querySelector(
    '[data-comparador-selector-activo]'
  );
  const selectorPageSizeModal = modalSelector?.querySelector(
    '[data-comparador-selector-page-size]'
  );
  const selectorSortByModal = modalSelector?.querySelector(
    '[data-comparador-selector-sort-by]'
  );
  const selectorSortDirModal = modalSelector?.querySelector(
    '[data-comparador-selector-sort-dir]'
  );
  const botonAplicarModal = modalSelector?.querySelector(
    '[data-comparador-selector-aplicar]'
  );
  const botonLimpiarModal = modalSelector?.querySelector(
    '[data-comparador-selector-limpiar]'
  );
  const estadoListadoModal = modalSelector?.querySelector(
    '[data-comparador-selector-estado]'
  );
  const resumenListadoModal = modalSelector?.querySelector(
    '[data-comparador-selector-resumen-listado]'
  );
  const filasListadoModal = modalSelector?.querySelector(
    '[data-comparador-selector-filas]'
  );
  const tarjetasListadoModal = modalSelector?.querySelector(
    '[data-comparador-selector-tarjetas]'
  );
  const paginacionModal = modalSelector?.querySelector(
    '[data-comparador-selector-paginacion]'
  );
  const contadorFiltrosModal = modalSelector?.querySelector(
    '[data-comparador-selector-filtros-activos]'
  );
  const resumenEstadoFiltrosModal = modalSelector?.querySelector(
    '[data-comparador-selector-estado-resumen]'
  );
  const paginaActualModal = modalSelector?.querySelector(
    '[data-comparador-selector-pagina-actual]'
  );
  const botonesPaginacionModal = Array.from(
    modalSelector?.querySelectorAll('[data-selector-page-action]') || []
  );
  const estadoInicial = {
    desde: inputDesde?.value || '',
    hasta: inputHasta?.value || ''
  };
  const palette = [
    {
      borde: 'rgba(31, 122, 106, 1)',
      fondo: 'rgba(31, 122, 106, 0.18)',
      puntoOk: 'rgba(31, 122, 106, 0.92)',
      puntoWarn: 'rgba(180, 118, 28, 0.92)',
      puntoError: 'rgba(154, 47, 47, 0.92)'
    },
    {
      borde: 'rgba(35, 92, 165, 1)',
      fondo: 'rgba(35, 92, 165, 0.18)',
      puntoOk: 'rgba(35, 92, 165, 0.92)',
      puntoWarn: 'rgba(201, 132, 26, 0.92)',
      puntoError: 'rgba(165, 54, 54, 0.92)'
    },
    {
      borde: 'rgba(114, 72, 181, 1)',
      fondo: 'rgba(114, 72, 181, 0.18)',
      puntoOk: 'rgba(114, 72, 181, 0.92)',
      puntoWarn: 'rgba(191, 124, 31, 0.92)',
      puntoError: 'rgba(179, 63, 63, 0.92)'
    }
  ];
  let opcionesMonitores = [];
  const detallesMonitorPorId = new Map();
  let chart = null;
  let chartIntervalo = null;
  let versionIntervalo = 0;
  let intervaloActivo = null;
  let versionComparacion = 0;
  let perfilMovilIntervalos = window.innerWidth < 600;
  const pluginVelasComparadas = {
    id: 'velasComparadas',
    beforeDatasetsDraw(grafica) {
      if (!grafica.data.datasets.some((dataset) => dataset.agregado)) return;
      const contexto = grafica.ctx;
      const escalaY = grafica.scales.y;
      contexto.save();
      grafica.data.datasets.forEach((dataset, indiceDataset) => {
        if (!dataset.agregado || !grafica.isDatasetVisible(indiceDataset)) return;
        const meta = grafica.getDatasetMeta(indiceDataset);
        dataset.data.forEach((punto, indice) => {
          const elemento = meta.data[indice];
          if (!elemento) return;
          const anchoGrupo = grafica.chartArea.width / Math.max(24, dataset.intervalos || 48);
          const anchura = Math.max(2, Math.min(7, anchoGrupo / Math.max(2, grafica.data.datasets.length + 1)));
          const color = punto.fallos > 0
            ? 'rgba(221, 168, 67, 0.98)'
            : dataset.borderColor;
          const aperturaY = escalaY.getPixelForValue(punto.apertura);
          const cierreY = escalaY.getPixelForValue(punto.cierre);
          contexto.strokeStyle = color;
          contexto.fillStyle = color;
          contexto.lineWidth = punto.fallos > 0 ? 2 : 1.25;
          contexto.beginPath();
          contexto.moveTo(elemento.x, escalaY.getPixelForValue(punto.minimo));
          contexto.lineTo(elemento.x, escalaY.getPixelForValue(punto.maximo));
          contexto.stroke();
          contexto.fillRect(
            elemento.x - anchura / 2,
            Math.min(aperturaY, cierreY),
            anchura,
            Math.max(3, Math.abs(cierreY - aperturaY))
          );
          if (punto.fallos > 0) {
            const yFallo = Math.max(grafica.chartArea.top + 7,
              Math.min(grafica.chartArea.bottom - 7, escalaY.getPixelForValue(punto.maximo)));
            contexto.beginPath();
            contexto.moveTo(elemento.x, yFallo - 5);
            contexto.lineTo(elemento.x - 5, yFallo + 4);
            contexto.lineTo(elemento.x + 5, yFallo + 4);
            contexto.closePath();
            contexto.fill();
          }
        });
      });
      contexto.restore();
    }
  };
  let temporizadorCargaModal = null;
  let temporizadorRecargaComparacion = null;
  const opcionesEmpresaModal = Array.from(
    selectorEmpresaModal?.querySelectorAll('option') || []
  ).map((opcion) => opcion.cloneNode(true));
  const estadoSelectorModal = {
    slotActivo: null,
    q: '',
    tipo: '',
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

  if (!urlComparacion || !urlOpcionesMonitores || !canvas) {
    return;
  }

  aplicarQueryEnFormularioBasico();
  actualizarHeroComparador();
  inicializarSlotsComparador();
  inicializarSelectorMonitoresModal();
  inicializarGrafico();
  new MutationObserver(function () {
    aplicarTemaGrafica();
  }).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme']
  });
  void cargarOpcionesMonitores()
    .then(() => cargarComparacion(false))
    .catch((error) => manejarError(error));

  botonAplicar?.addEventListener('click', function () {
    void cargarComparacion(true);
  });

  for (const eventoFecha of ['input', 'change']) {
    inputDesde?.addEventListener(eventoFecha, function () {
      programarRecargaComparacion();
    });

    inputHasta?.addEventListener(eventoFecha, function () {
      programarRecargaComparacion();
    });
  }

  window.addEventListener('resize', function () {
    const esMovil = window.innerWidth < 600;
    if (esMovil === perfilMovilIntervalos) return;
    perfilMovilIntervalos = esMovil;
    if (leerMonitorIdsDesdeFormulario().length > 0) programarRecargaComparacion();
  });

  botonLimpiar?.addEventListener('click', function () {
    if (inputDesde) {
      inputDesde.value = estadoInicial.desde;
    }

    if (inputHasta) {
      inputHasta.value = estadoInicial.hasta;
    }

    for (const selector of selectoresMonitores) {
      selector.value = '';
    }

    actualizarSlotsComparador();
    limpiarVisualizacion('Selecciona entre uno y tres monitores para iniciar la comparación.');
    sincronizarUrl(new URLSearchParams());
  });

  for (const boton of botonesPreseleccion) {
    boton.addEventListener('click', function () {
      aplicarPreseleccion(
        String(boton.dataset.comparadorPreseleccion || '7d')
      );
      void cargarComparacion(true);
    });
  }

  function aplicarQueryEnFormularioBasico() {
    const url = new URL(window.location.href);

    aplicarValorFechaHoraInput(inputDesde, url.searchParams.get('desde'), {
      finDelDia: false
    });
    aplicarValorFechaHoraInput(inputHasta, url.searchParams.get('hasta'), {
      finDelDia: true
    });
  }

  function inicializarSlotsComparador() {
    for (const slot of slotsMonitores) {
      slot.botonBuscar?.addEventListener('click', function () {
        abrirSelectorMonitores(slot.indice);
      });

      slot.botonLimpiar?.addEventListener('click', function () {
        asignarMonitorASlot(slot.indice, '');
        programarRecargaComparacion({ inmediata: true });
      });
    }
  }

  function actualizarSlotsComparador() {
    modulo.dataset.tieneSeleccion = selectoresMonitores.some((selector) => Boolean(selector.value))
      ? 'true'
      : 'false';
    for (const slot of slotsMonitores) {
      const selector = selectoresMonitores[slot.indice];
      const monitorId = String(selector?.value || '').trim();
      const detalle = monitorId ? detallesMonitorPorId.get(monitorId) || null : null;

      if (!monitorId) {
        slot.nodo.dataset.estado = 'vacio';

        if (slot.estado) {
          slot.estado.textContent = 'Pendiente';
          slot.estado.className =
            'insignia-monitor insignia-monitor--suave comparador-slot__estado';
        }

        if (slot.tipo) {
          slot.tipo.hidden = true;
          slot.tipo.textContent = 'Tipo';
          slot.tipo.className =
            'insignia-monitor insignia-monitor--suave comparador-slot__tipo';
        }

        if (slot.titulo) {
          slot.titulo.textContent = 'Sin monitor';
        }

        if (slot.detalle) {
          slot.detalle.textContent = '';
        }

        if (slot.botonBuscar) {
          const texto = slot.botonBuscar.querySelector('span');

          if (texto) {
            texto.textContent = 'Buscar monitor';
          }
        }

        if (slot.botonLimpiar) {
          slot.botonLimpiar.hidden = true;
        }

        continue;
      }

      slot.nodo.dataset.estado = 'seleccionado';

      if (slot.estado) {
        slot.estado.textContent = 'Seleccionado';
        slot.estado.className =
          'insignia-monitor insignia-monitor--ok comparador-slot__estado';
      }

      if (slot.tipo) {
        const tipoMonitor = String(detalle?.tipo || '').trim().toLowerCase();
        slot.tipo.hidden = !tipoMonitor;
        slot.tipo.textContent = tipoMonitor
          ? String(tipoMonitor).toUpperCase()
          : 'Tipo';
        slot.tipo.className = tipoMonitor
          ? `insignia-monitor insignia-monitor--${tipoMonitor} comparador-slot__tipo`
          : 'insignia-monitor insignia-monitor--suave comparador-slot__tipo';
      }

      if (slot.titulo) {
        slot.titulo.textContent =
          detalle?.nombre || `Monitor #${monitorId}`;
      }

      if (slot.detalle) {
        slot.detalle.textContent = construirDetalleSlotMonitor(detalle, monitorId);
      }

      if (slot.botonBuscar) {
        const texto = slot.botonBuscar.querySelector('span');

        if (texto) {
          texto.textContent = 'Cambiar monitor';
        }
      }

      if (slot.botonLimpiar) {
        slot.botonLimpiar.hidden = false;
      }
    }
  }

  function construirDetalleSlotMonitor(detalle, monitorId) {
    if (!detalle) {
      return `Monitor #${monitorId} seleccionado.`;
    }

    const partes = [
      detalle.tipo ? String(detalle.tipo).toUpperCase() : '',
      detalle.alcanceDescripcion || detalle.alcance || ''
    ].filter(Boolean);
    const contexto = construirContextoOperativoMonitor(detalle);

    if (contexto) {
      partes.push(contexto);
    }

    if (partes.length === 0) {
      return `Monitor #${monitorId} seleccionado.`;
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
      alcanceDescripcion: String(opcion?.alcance || '').trim(),
      interpretacionEstado: String(opcion?.interpretacionEstado || 'normal'),
      descripcionFallo: String(opcion?.descripcionFallo || '').trim(),
      posibleSolucion: String(opcion?.posibleSolucion || '').trim()
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
      alcanceDescripcion: String(monitor?.alcanceDescripcion || '').trim(),
      interpretacionEstado: String(monitor?.interpretacionEstado || 'normal'),
      descripcionFallo: String(monitor?.descripcionFallo || '').trim(),
      posibleSolucion: String(monitor?.posibleSolucion || '').trim()
    });
  }

  function construirContextoOperativoMonitor(monitor) {
    if (!monitor || typeof monitor !== 'object') {
      return '';
    }

    if (
      String(monitor.tipo || '').trim().toLowerCase() !== 'booleano' &&
      String(monitor.interpretacionEstado || '').trim() === 'invertida'
    ) {
      return 'Falló porque respondió';
    }

    if (monitor.descripcionFallo) {
      return String(monitor.descripcionFallo);
    }

    if (monitor.posibleSolucion) {
      return String(monitor.posibleSolucion);
    }

    return '';
  }

  function asignarMonitorASlot(indice, monitorId) {
    const selector = selectoresMonitores[indice];
    const monitorIdNormalizado = String(monitorId || '').trim();

    if (!selector) {
      return;
    }

    if (monitorIdNormalizado) {
      asegurarOpcionMonitor(selector, monitorIdNormalizado);
    }

    selector.value = monitorIdNormalizado;
    actualizarSlotsComparador();
  }

  function asegurarOpcionMonitor(selector, monitorId) {
    if (
      Array.from(selector.options).some(
        (opcion) => String(opcion.value || '') === monitorId
      )
    ) {
      return;
    }

    const detalle = detallesMonitorPorId.get(monitorId) || null;
    const nodo = document.createElement('option');
    nodo.value = monitorId;
    nodo.textContent = detalle
      ? [
          detalle.nombre || `Monitor #${monitorId}`,
          detalle.tipo ? String(detalle.tipo).toUpperCase() : '',
          detalle.alcanceDescripcion || ''
        ].filter(Boolean).join(' · ')
      : `Monitor #${monitorId}`;
    selector.appendChild(nodo);
  }

  function obtenerIdsMonitorSeleccionados() {
    return selectoresMonitores
      .map((selector) => String(selector.value || '').trim())
      .filter(Boolean);
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

  function abrirSelectorMonitores(indiceSlot) {
    const instanciaModal = obtenerModalSelectorBootstrap();

    if (!instanciaModal) {
      return;
    }

    estadoSelectorModal.slotActivo = indiceSlot;

    if (tituloSlotModal) {
      tituloSlotModal.textContent = `Monitor ${indiceSlot + 1}`;
    }

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
      if (selectorTipoModal) selectorTipoModal.value = '';
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
        const accion = boton.dataset.selectorPageAction;

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

  async function cargarOpcionesMonitores() {
    const respuesta = await fetchJson(
      `${urlOpcionesMonitores}?solo_activos=1`
    );
    opcionesMonitores = Array.isArray(respuesta.opciones)
      ? respuesta.opciones
      : [];

    for (const selector of selectoresMonitores) {
      const valorActual = selector.value;
      selector.innerHTML = '<option value="">Selecciona monitor</option>';

      for (const opcion of opcionesMonitores) {
        registrarDetalleMonitorDesdeOpcion(opcion);
        const nodo = document.createElement('option');
        nodo.value = String(opcion.valor);
        nodo.textContent =
          `${opcion.etiqueta} · ${String(opcion.tipo || '').toUpperCase()} · ${opcion.alcance}`;
        selector.appendChild(nodo);
      }

      if (valorActual) {
        selector.value = valorActual;
      }
    }

    aplicarMonitorIdsDesdeQuery();
    actualizarSlotsComparador();
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

    if (resumenEstadoFiltrosModal) {
      resumenEstadoFiltrosModal.textContent = `· ${selectorActivoModal?.selectedOptions?.[0]?.textContent?.trim() || 'Solo activos'}`;
    }

    if (contadorFiltrosModal) {
      const filtrosActivos = [
        estadoSelectorModal.tenantId,
        estadoSelectorModal.empresaId,
        estadoSelectorModal.nivelPertenencia,
        estadoSelectorModal.activo !== 'solo_activos' ? estadoSelectorModal.activo : '',
        estadoSelectorModal.pageSize !== 10 ? estadoSelectorModal.pageSize : '',
        estadoSelectorModal.sortBy !== 'nombre' ? estadoSelectorModal.sortBy : '',
        estadoSelectorModal.sortDir !== 'asc' ? estadoSelectorModal.sortDir : ''
      ].filter(Boolean).length;
      contadorFiltrosModal.hidden = filtrosActivos === 0;
      contadorFiltrosModal.textContent = `${filtrosActivos} ${filtrosActivos === 1 ? 'ajuste' : 'ajustes'}`;
    }

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

  async function cargarListadoSelectorMonitores() {
    if (!modalSelector || !urlListadoMonitores || !filasListadoModal) {
      return;
    }

    estadoListadoModal.textContent = 'Cargando monitores...';
    filasListadoModal.innerHTML = '';
    if (tarjetasListadoModal) tarjetasListadoModal.innerHTML = '';

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
            : 'Sin resultados.';
      }

      estadoListadoModal.textContent = '';
    } catch (error) {
      estadoListadoModal.textContent = error.message;
      filasListadoModal.innerHTML = `
        <tr>
          <td colspan="5" class="text-danger">${escapeHtml(error.message)}</td>
        </tr>
      `;
      if (tarjetasListadoModal) {
        tarjetasListadoModal.innerHTML = `<p class="text-danger mb-0">${escapeHtml(error.message)}</p>`;
      }
      window.portalToast?.show?.({
        tipo: 'error',
        titulo: 'Selector de monitores',
        cuerpo: error.message
      });
    }
  }

  function renderizarFilasSelectorMonitores(monitores) {
    if (!filasListadoModal) {
      return;
    }

    if (!Array.isArray(monitores) || monitores.length === 0) {
      filasListadoModal.innerHTML = `
        <tr>
          <td colspan="5" class="text-body-secondary">
            <div class="py-3 d-inline-flex align-items-center gap-2">
              <i class="bi bi-inbox" aria-hidden="true"></i>
              <span>No hay monitores visibles con el filtro actual.</span>
            </div>
          </td>
        </tr>
      `;
      if (tarjetasListadoModal) {
        tarjetasListadoModal.innerHTML = '<p class="text-body-secondary mb-0">No hay monitores visibles. Prueba otros filtros.</p>';
      }
      return;
    }

    const slotActivo = Number(estadoSelectorModal.slotActivo ?? -1);
    const seleccionadoActual = String(
      selectoresMonitores[slotActivo]?.value || ''
    ).trim();
    const idsOcupados = obtenerIdsMonitorSeleccionados().filter(
      (id) => id !== seleccionadoActual
    );

    filasListadoModal.innerHTML = monitores
      .map((monitor) => {
        registrarDetalleMonitorDesdeListado(monitor);
        const monitorId = String(monitor.id || '');
        const tipoMonitor = String(monitor.tipo || '').toLowerCase();
        const etiquetaTipo = tipoMonitor === 'booleano' ? 'Lógico' : String(monitor.tipo || '').toUpperCase();
        const estadoRuntime = monitor.estadoRuntime || null;
        const resumenRuntime = estadoRuntime?.resumenHumano || null;
        const runtimeEtiqueta = estadoRuntime
          ? (resumenRuntime?.etiquetaEstado || estadoRuntime.estado || 'desconocido')
          : 'No materializado';
        const runtimeTecnico = estadoRuntime
          ? (resumenRuntime?.etiquetaTecnica || estadoRuntime.codigoResultado || 'sin_resultado')
          : 'Sin estado';
        const contextoOperativo = construirContextoOperativoMonitor(monitor);
        const scopeTexto = monitor.alcanceDescripcion || [
          monitor.empresaNombre || '-',
          monitor.sitioNombre || null
        ].filter(Boolean).join(' / ');
        const bloqueado = idsOcupados.includes(monitorId);

        return `
          <tr>
            <td>
              <div class="d-grid gap-1">
                <strong>${escapeHtml(monitor.nombre || `Monitor #${monitorId}`)}</strong>
                <small class="text-body-secondary">
                  #${escapeHtml(monitorId)}
                  ${monitor.descripcion ? `· ${escapeHtml(monitor.descripcion)}` : ''}
                </small>
                ${contextoOperativo ? `<small class="text-body-secondary">${escapeHtml(contextoOperativo)}</small>` : ''}
              </div>
            </td>
            <td>
              <span class="insignia-monitor insignia-monitor--${escapeHtml(tipoMonitor || 'base')}">
                ${escapeHtml(etiquetaTipo)}
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
              <details class="comparador-selector__tecnico">
                <summary>Detalles técnicos</summary>
                <small>Resultado: ${escapeHtml(runtimeTecnico)} · Cadencia: ${escapeHtml(String(monitor.intervaloEjecucionSegundos || '-'))} s</small>
              </details>
            </td>
            <td class="text-end">
              <button
                type="button"
                class="btn btn-sm ${bloqueado ? 'btn-outline-secondary' : 'btn-success'}"
                data-comparador-selector-elegir="${escapeHtml(monitorId)}"
                ${bloqueado ? 'disabled' : ''}
              >
                ${bloqueado ? 'Ya seleccionado' : 'Seleccionar'}
              </button>
            </td>
          </tr>
        `;
      })
      .join('');

    if (tarjetasListadoModal) {
      tarjetasListadoModal.innerHTML = monitores.map((monitor) => {
        const monitorId = String(monitor.id || '');
        const tipoMonitor = String(monitor.tipo || '').toLowerCase();
        const etiquetaTipo = tipoMonitor === 'booleano' ? 'Lógico' : String(monitor.tipo || '').toUpperCase();
        const estadoRuntime = monitor.estadoRuntime || null;
        const resumenRuntime = estadoRuntime?.resumenHumano || null;
        const runtimeEtiqueta = estadoRuntime
          ? (resumenRuntime?.etiquetaEstado || estadoRuntime.estado || 'desconocido')
          : 'Sin lectura actual';
        const runtimeTecnico = estadoRuntime
          ? (resumenRuntime?.etiquetaTecnica || estadoRuntime.codigoResultado || 'sin_resultado')
          : 'Sin estado';
        const ubicacion = monitor.alcanceDescripcion || [
          monitor.empresaNombre || '-', monitor.sitioNombre || null
        ].filter(Boolean).join(' / ');
        const bloqueado = idsOcupados.includes(monitorId);

        return `
          <article class="comparador-selector__tarjeta">
            <div class="comparador-selector__tarjeta-cabecera">
              <strong>${escapeHtml(monitor.nombre || `Monitor #${monitorId}`)}</strong>
              <span class="insignia-monitor insignia-monitor--${escapeHtml(tipoMonitor || 'base')}">
                ${escapeHtml(etiquetaTipo)}
              </span>
            </div>
            <p class="comparador-selector__tarjeta-ubicacion">${escapeHtml(ubicacion || 'Sin ubicación')} · #${escapeHtml(monitorId)}</p>
            <span class="insignia-monitor ${estadoRuntime ? 'insignia-monitor--ok' : 'insignia-monitor--suave'}">
              ${escapeHtml(runtimeEtiqueta)}
            </span>
            <details class="comparador-selector__tarjeta-detalles">
              <summary>Más información</summary>
              ${monitor.descripcion ? `<p>${escapeHtml(monitor.descripcion)}</p>` : ''}
              <p>Cadencia: ${escapeHtml(String(monitor.intervaloEjecucionSegundos || '-'))} s</p>
              <p>Resultado técnico: ${escapeHtml(runtimeTecnico)}</p>
            </details>
            <button
              type="button"
              class="btn ${bloqueado ? 'btn-outline-secondary' : 'btn-success'} comparador-selector__tarjeta-accion"
              data-comparador-selector-elegir="${escapeHtml(monitorId)}"
              ${bloqueado ? 'disabled' : ''}
            >${bloqueado ? 'Ya seleccionado' : 'Seleccionar monitor'}</button>
          </article>
        `;
      }).join('');
    }

    for (const boton of modalSelector.querySelectorAll('[data-comparador-selector-elegir]')) {
      boton.addEventListener('click', function () {
        const monitorId = String(
          boton.dataset.comparadorSelectorElegir || ''
        ).trim();
        seleccionarMonitorDesdeModal(monitorId);
      });
    }
  }

  function actualizarPaginacionSelectorMonitores(paginacion) {
    if (paginacionModal) {
      paginacionModal.hidden = Number(paginacion.totalPaginas || 1) <= 1;
    }
    if (paginaActualModal) {
      paginaActualModal.textContent =
        `Página ${paginacion.pagina || 1} de ${paginacion.totalPaginas || 1}`;
    }

    for (const boton of botonesPaginacionModal) {
      const accion = boton.dataset.selectorPageAction;
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

  function seleccionarMonitorDesdeModal(monitorId) {
    const indiceSlot = Number(estadoSelectorModal.slotActivo ?? -1);

    if (!Number.isInteger(indiceSlot) || indiceSlot < 0) {
      return;
    }

    const yaSeleccionado = selectoresMonitores.some(
      (selector, indice) =>
        indice !== indiceSlot &&
        String(selector.value || '').trim() === String(monitorId || '').trim()
    );

    if (yaSeleccionado) {
      window.portalToast?.show?.({
        tipo: 'advertencia',
        titulo: 'Comparar eventos',
        cuerpo: 'Ese monitor ya está asignado a otro slot del comparador.'
      });
      return;
    }

    asignarMonitorASlot(indiceSlot, monitorId);
    const detalle = detallesMonitorPorId.get(String(monitorId || '').trim()) || null;

    window.portalToast?.show?.({
      tipo: 'exito',
      titulo: 'Comparar eventos',
      cuerpo: `${detalle?.nombre || `Monitor #${monitorId}`} asignado al Slot ${indiceSlot + 1}.`,
      duracionMs: 2600
    });
    programarRecargaComparacion({ inmediata: true });
    obtenerModalSelectorBootstrap()?.hide();
  }

  function aplicarMonitorIdsDesdeQuery() {
    const monitorIds = leerMonitorIdsDesdeUrl();

    selectoresMonitores.forEach((selector, indice) => {
      selector.value = String(monitorIds[indice] || '');
    });
  }

  function programarRecargaComparacion({
    inmediata = false,
    notificarSinSeleccion = false
  } = {}) {
    versionComparacion += 1;
    window.clearTimeout(temporizadorRecargaComparacion);

    if (inmediata) {
      void cargarComparacion(notificarSinSeleccion);
      return;
    }

    temporizadorRecargaComparacion = window.setTimeout(function () {
      void cargarComparacion(notificarSinSeleccion);
    }, 180);
  }

  async function cargarComparacion(notificarSinSeleccion) {
    const version = ++versionComparacion;
    try {
      const monitorIds = leerMonitorIdsDesdeFormulario();
      const queryPagina = construirQueryPagina(monitorIds);
      sincronizarUrl(queryPagina);

      if (monitorIds.length === 0) {
        limpiarVisualizacion(
          'Selecciona entre uno y tres monitores para iniciar la comparación.'
        );

        if (notificarSinSeleccion) {
          window.portalToast?.show?.({
            tipo: 'advertencia',
            titulo: 'Comparar eventos',
            cuerpo: 'Selecciona al menos un monitor visible para dibujar la serie.'
          });
        }

        return;
      }

      etiquetaEstadoCarga.textContent = 'Cargando comparación...';
      const queryApi = construirQueryApi(monitorIds);
      const respuesta = await fetchJson(
        `${urlComparacion}?${queryApi.toString()}`
      );
      if (version !== versionComparacion) return;

      actualizarResumen(respuesta);
      renderizarResumenSeries(respuesta.monitoresSeleccionados || []);
      renderizarGrafica(
        respuesta.monitoresSeleccionados || [],
        respuesta.eventos || [],
        respuesta.intervalos,
        respuesta.rangoAplicado
      );

      const desdeLocal = formatearFechaVisible(
        respuesta.rangoAplicado?.desdeUtc
      ) || '-';
      const hastaLocal = formatearFechaVisible(
        respuesta.rangoAplicado?.hastaUtc
      ) || '-';
      etiquetaEstadoCarga.textContent =
        `Consulta aplicada: ${desdeLocal} → ${hastaLocal}`;
    } catch (error) {
      if (version === versionComparacion) manejarError(error);
    }
  }

  function construirQueryPagina(monitorIds) {
    const rango = resolverRangoUtcDesdeFormulario();
    const parametros = new URLSearchParams();

    parametros.set('desde', rango.desdeUtc);
    parametros.set('hasta', rango.hastaUtc);

    if (monitorIds.length > 0) {
      parametros.set('monitor_ids', monitorIds.join(','));
    }

    return parametros;
  }

  function construirQueryApi(monitorIds) {
    const rango = resolverRangoUtcDesdeFormulario();
    const parametros = new URLSearchParams();

    parametros.set('desde', rango.desdeUtc);
    parametros.set('hasta', rango.hastaUtc);
    parametros.set('monitor_ids', monitorIds.join(','));
    parametros.set('intervalos', window.innerWidth < 600 ? '24' : '48');

    return parametros;
  }

  function leerMonitorIdsDesdeFormulario() {
    const ids = [];

    for (const selector of selectoresMonitores) {
      const id = String(selector.value || '').trim();

      if (!id || ids.includes(id)) {
        continue;
      }

      ids.push(id);
    }

    return ids.slice(0, 3);
  }

  function leerMonitorIdsDesdeUrl() {
    const url = new URL(window.location.href);
    const crudo = String(url.searchParams.get('monitor_ids') || '').trim();

    if (!crudo) {
      return [];
    }

    return crudo
      .split(',')
      .map((fragmento) => fragmento.trim())
      .filter(Boolean)
      .filter((valor, indice, lista) => lista.indexOf(valor) === indice)
      .slice(0, 3);
  }

  function resolverRangoUtcDesdeFormulario() {
    const desde = inputDesde?.value || '';
    const hasta = inputHasta?.value || '';

    if (!desde || !hasta) {
      throw new Error('Debes indicar fecha inicial y final.');
    }

    const fechaDesdeLocal = construirFechaLocalDesdeInput(desde, {
      finDelDia: false
    });
    const fechaHastaLocal = construirFechaLocalDesdeInput(hasta, {
      finDelDia: true
    });

    if (
      Number.isNaN(fechaDesdeLocal.getTime()) ||
      Number.isNaN(fechaHastaLocal.getTime())
    ) {
      throw new Error('No se pudo interpretar el rango temporal seleccionado.');
    }

    if (fechaDesdeLocal.getTime() > fechaHastaLocal.getTime()) {
      throw new Error('La fecha inicial no puede ser posterior a la final.');
    }

    return {
      desdeUtc: fechaDesdeLocal.toISOString(),
      hastaUtc: fechaHastaLocal.toISOString()
    };
  }

  function aplicarPreseleccion(clave) {
    const ahora = new Date();
    const inicio = new Date(ahora);

    if (clave === '1d') {
      inicio.setDate(ahora.getDate() - 1);
    } else if (clave === '30d') {
      inicio.setDate(ahora.getDate() - 30);
    } else {
      inicio.setDate(ahora.getDate() - 7);
    }

    if (inputDesde) {
      inputDesde.value = formatearFechaHoraInput(inicio);
    }

    if (inputHasta) {
      inputHasta.value = formatearFechaHoraInput(ahora);
    }
  }

  function inicializarGrafico() {
    chart = new window.Chart(canvas, {
      type: 'line',
      plugins: [pluginVelasComparadas],
      data: {
        datasets: []
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        parsing: false,
        interaction: {
          mode: 'nearest',
          intersect: true
        },
        plugins: {
          legend: {
            display: true,
            position: 'bottom',
            onClick: function (_evento, elemento, leyenda) {
              const grafica = leyenda.chart;
              const indice = elemento.datasetIndex;
              grafica.setDatasetVisibility(indice, !grafica.isDatasetVisible(indice));
              grafica.update();
              if (intervaloActivo &&
                Number(intervaloActivo.punto.monitorId) ===
                  Number(grafica.data.datasets[indice]?.data?.[0]?.monitorId) &&
                !grafica.isDatasetVisible(indice)) {
                const siguiente = grafica.data.datasets
                  .flatMap((dataset, posicion) => grafica.isDatasetVisible(posicion) ? dataset.data : [])
                  .sort((a, b) => a.x - b.x)
                  .at(-1);
                if (siguiente?.agregado) actualizarPanelIntervalo(siguiente);
                else if (siguiente?.evento) actualizarPanelDetalle(siguiente.evento, siguiente.y);
                else actualizarPanelDetalle(null, null);
              }
            }
          },
          tooltip: {
            callbacks: {
              title: function (items) {
                const punto = items[0]?.raw;
                return punto?.nombreMonitor || punto?.evento?.nombreMonitor || 'Monitor';
              },
              label: function (item) {
                const punto = item.raw || {};
                const evento = punto.evento;

                if (punto.agregado) {
                  return [
                    `${formatearFechaVisible(punto.inicioUtc)} – ${formatearFechaVisible(punto.finUtc)}`,
                    `${punto.cantidad} ejecuciones · ${punto.fallos} fallos`,
                    `Mínimo–máximo: ${formatearMilisegundos(punto.minimo)} – ${formatearMilisegundos(punto.maximo)}`
                  ];
                }

                if (!evento) return '';

                return [
                  `Fecha: ${formatearFechaVisible(evento.ejecutadoEnUtc)}`,
                  `Lectura: ${formatearMilisegundos(punto.y)}`,
                  `Resultado: ${evento.codigoResultado || 'sin_resultado'}`,
                  `Detalle: ${evento.resumen?.detalle || evento.mensajeResultado || 'Sin detalle operativo adicional.'}`
                ];
              }
            }
          }
        },
        scales: {
          x: {
            type: 'linear',
            ticks: {
              callback: function (valor) {
                return formatearMarcaCorta(valor);
              }
            }
          },
          y: {
            reverse: true,
            min: 0,
            ticks: {
              callback: function (valor) {
                return `${Number(valor).toFixed(0)} ms`;
              }
            }
          }
        },
        onHover: function (evento, elementos) {
          if (chart.data.datasets.some((dataset) => dataset.agregado)) return;
          actualizarDetalleDesdeElementos(elementos, evento, false);
        },
        onClick: function (evento, elementos) {
          actualizarDetalleDesdeElementos(elementos, evento, true);
        }
      }
    });
    aplicarTemaGrafica();
  }

  function aplicarTemaGrafica() {
    if (!chart) return;
    const estilos = getComputedStyle(modulo);
    const texto = estilos.getPropertyValue('--texto-suave').trim();
    const borde = estilos.getPropertyValue('--borde').trim();
    chart.options.plugins.legend.labels.color = texto;
    for (const eje of ['x', 'y']) {
      chart.options.scales[eje].ticks.color = texto;
      chart.options.scales[eje].grid.color = borde;
    }
    chart.data.datasets.forEach((dataset, indice) => {
      const colores = coloresSerie(indice);
      dataset.borderColor = colores.borde;
      if (!dataset.agregado) {
        dataset.pointBackgroundColor = dataset.data.map((punto) => colorPunto(punto.evento, colores));
        dataset.pointBorderColor = dataset.data.map((punto) => bordePunto(punto.evento, colores));
      }
    });
    chart.update('none');
  }

  function actualizarDetalleDesdeElementos(elementos, eventoGrafica, cargarIntervalo) {
    const elemento = elementos?.[0] || buscarVelaCercana(eventoGrafica);
    if (!elemento) return;
    const dataset = chart.data.datasets[elemento.datasetIndex];
    const punto = dataset?.data?.[elemento.index];
    if (punto?.agregado) actualizarPanelIntervalo(punto, { cargar: cargarIntervalo });
    else actualizarPanelDetalle(punto?.evento || null, punto?.y || null);
  }

  function buscarVelaCercana(eventoGrafica) {
    if (!Number.isFinite(eventoGrafica?.x) || !Number.isFinite(eventoGrafica?.y)) return null;
    let mejor = null;
    for (const [datasetIndex, dataset] of chart.data.datasets.entries()) {
      if (!dataset.agregado || !chart.isDatasetVisible(datasetIndex)) continue;
      const meta = chart.getDatasetMeta(datasetIndex);
      dataset.data.forEach((punto, index) => {
        const elemento = meta.data[index];
        if (!elemento) return;
        const distanciaX = Math.abs(eventoGrafica.x - elemento.x);
        const minimoY = chart.scales.y.getPixelForValue(punto.minimo);
        const maximoY = chart.scales.y.getPixelForValue(punto.maximo);
        const distanciaY = eventoGrafica.y < Math.min(minimoY, maximoY)
          ? Math.min(minimoY, maximoY) - eventoGrafica.y
          : eventoGrafica.y > Math.max(minimoY, maximoY)
            ? eventoGrafica.y - Math.max(minimoY, maximoY)
            : 0;
        if (distanciaX > 14 || distanciaY > 14) return;
        const distancia = distanciaX + distanciaY;
        if (!mejor || distancia < mejor.distancia) {
          mejor = { datasetIndex, index, distancia };
        }
      });
    }
    return mejor;
  }

  function renderizarGrafica(monitoresSeleccionados, eventos, intervalos, rangoAplicado) {
    const agregado = Array.isArray(intervalos?.puntos);
    const series = monitoresSeleccionados.map((monitor, indice) => agregado
      ? construirDatasetIntervalos(monitor, intervalos, rangoAplicado, indice)
      : construirDatasetMonitor(monitor, eventos, indice)
    );
    const puntos = series.flatMap((serie) => serie.data);
    const maximoMs = puntos.reduce(
      (maximo, punto) => Math.max(maximo, Number(punto.maximo ?? punto.y ?? 0)),
      0
    );

    chart.data.datasets = series;
    chart.options.scales.x.min = Date.parse(rangoAplicado?.desdeUtc);
    chart.options.scales.x.max = Date.parse(rangoAplicado?.hastaUtc);
    chart.options.scales.y.max = maximoMs > 0 ? Math.ceil(maximoMs * 1.15) : 1000;
    chart.update();

    if (leyendaIntervalos) {
      leyendaIntervalos.hidden = !agregado;
      leyendaIntervalos.textContent = agregado
        ? 'Cada vela resume un intervalo: la línea muestra el mínimo y máximo; el cuerpo, la primera y última lectura. El triángulo ámbar señala fallos. Toca una vela para cargar sus lecturas aquí.'
        : '';
    }

    const ultimoPunto = puntos
      .slice()
      .sort((a, b) => Number(a.x || 0) - Number(b.x || 0))
      .at(-1);

    if (ultimoPunto) {
      if (ultimoPunto.agregado) actualizarPanelIntervalo(ultimoPunto);
      else actualizarPanelDetalle(ultimoPunto.evento, ultimoPunto.y);
    } else {
      actualizarPanelDetalle(null, null);
    }
  }

  function construirDatasetIntervalos(monitor, resumen, rango, indicePalette) {
    const colores = coloresSerie(indicePalette);
    const desdeMs = Date.parse(rango?.desdeUtc);
    const hastaMs = Date.parse(rango?.hastaUtc);
    const cantidad = Number(resumen.cantidad || 48);
    const anchoMs = (hastaMs - desdeMs) / cantidad;
    const puntos = resumen.puntos
      .filter((punto) => Number(punto.monitorId) === Number(monitor.id))
      .map((punto) => {
        const inicioMs = desdeMs + Number(punto.intervalo) * anchoMs;
        const finMs = Math.min(hastaMs, inicioMs + anchoMs);
        const desplazamiento = (indicePalette - (Math.max(1, selectoresMonitores.filter((selector) => selector.value).length) - 1) / 2) * anchoMs / 4;
        return {
          ...punto,
          x: (inicioMs + finMs) / 2 + desplazamiento,
          y: Number(punto.cierre),
          nombreMonitor: monitor.nombre,
          tipoMonitor: monitor.tipo,
          inicioUtc: new Date(inicioMs).toISOString(),
          finUtc: new Date(finMs).toISOString(),
          agregado: true
        };
      });
    return {
      label: `${monitor.nombre} · ${String(monitor.tipo || '').toUpperCase()}`,
      monitorId: monitor.id,
      data: puntos,
      agregado: true,
      intervalos: cantidad,
      parsing: false,
      showLine: false,
      borderColor: colores.borde,
      backgroundColor: colores.fondo,
      pointRadius: 0,
      pointHitRadius: 12,
      pointHoverRadius: 5
    };
  }

  function construirDatasetMonitor(monitor, eventos, indicePalette) {
    const colores = coloresSerie(indicePalette);
    const puntos = eventos
      .filter((evento) => Number(evento.monitorId) === Number(monitor.id))
      .map((evento) => construirPuntoEvento(evento))
      .filter(Boolean)
      .sort((a, b) => a.x - b.x);

    return {
      label: `${monitor.nombre} · ${String(monitor.tipo || '').toUpperCase()}`,
      data: puntos,
      parsing: false,
      borderColor: colores.borde,
      backgroundColor: colores.fondo,
      borderWidth: 2,
      pointRadius: 5,
      pointHoverRadius: 7,
      tension: 0.18,
      pointBackgroundColor: puntos.map((punto) =>
        colorPunto(punto.evento, colores)
      ),
      pointBorderColor: puntos.map((punto) =>
        bordePunto(punto.evento, colores)
      ),
      pointStyle: puntos.map((punto) =>
        punto.evento?.exito ? 'circle' : 'triangle'
      )
    };
  }

  function coloresSerie(indice) {
    const base = palette[indice % palette.length];
    const columna = modulo.querySelector(`[data-comparador-slot-columna="${indice}"]`);
    const componentes = getComputedStyle(columna || modulo)
      .getPropertyValue('--comparador-slot-rgb')
      .match(/\d+/g);
    const borde = componentes?.length === 3
      ? `rgb(${componentes.join(', ')})`
      : base.borde;
    return { ...base, borde, puntoOk: borde };
  }

  function construirPuntoEvento(evento) {
    const x = Date.parse(String(evento?.ejecutadoEnUtc || ''));
    const y = resolverMetricaEvento(evento);

    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return null;
    }

    return {
      x,
      y,
      evento
    };
  }

  function resolverMetricaEvento(evento) {
    if (!evento || typeof evento !== 'object') {
      return null;
    }

    const tipoMonitor = String(
      evento.tipoMonitor || evento.tipo || ''
    ).trim().toLowerCase();
    const exitoTecnico = resolverExitoTecnicoEvento(evento);
    const rttMs = Number(evento?.metricaPrincipal?.rttMs);
    const timeoutMs = Number(evento?.protocolo?.timeoutMs);
    const duracionTotalMs = Number(evento?.duracionTotalMs);

    if (tipoMonitor === 'ping') {
      if (exitoTecnico && Number.isFinite(rttMs)) {
        return rttMs;
      }

      if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
        return timeoutMs;
      }

      if (Number.isFinite(duracionTotalMs) && duracionTotalMs >= 0) {
        return duracionTotalMs;
      }

      return null;
    }

    if (exitoTecnico && Number.isFinite(duracionTotalMs) && duracionTotalMs >= 0) {
      return duracionTotalMs;
    }

    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
      return timeoutMs;
    }

    if (Number.isFinite(duracionTotalMs) && duracionTotalMs >= 0) {
      return duracionTotalMs;
    }

    return null;
  }

  function resolverExitoTecnicoEvento(evento) {
    if (evento?.resultadoTecnico?.exito != null) {
      return Boolean(evento.resultadoTecnico.exito);
    }

    if (evento?.exitoTecnico != null) {
      return Boolean(evento.exitoTecnico);
    }

    return Boolean(evento?.exito);
  }

  function actualizarResumen(respuesta) {
    const resumen = respuesta.resumen || {};
    const agregado = resumen.modo === 'intervalos';
    const puntos = agregado
      ? (respuesta.intervalos?.puntos || []).flatMap((punto) => [punto.minimo, punto.maximo])
      : (respuesta.eventos || []).map((evento) => resolverMetricaEvento(evento));
    const valores = puntos.filter((valor) => Number.isFinite(Number(valor))).map(Number);

    etiquetaTotalPuntos.textContent = String(resumen.total || 0);
    etiquetaTotalPuntosDetalle.textContent = agregado
      ? `${respuesta.intervalos?.cantidad || 0} franjas del período; ${resumen.devueltos || 0} bloques con lecturas entre los monitores.`
      : `${resumen.devueltos || 0} lecturas individuales en la gráfica.`;

    if (valores.length === 0) {
      etiquetaRangoMetrica.textContent = 'Sin puntos';
      etiquetaRangoMetricaDetalle.textContent =
        'No hay métricas temporales representables para los monitores seleccionados.';
      return;
    }

    const minimo = Math.min(...valores);
    const maximo = Math.max(...valores);

    etiquetaRangoMetrica.textContent =
      `${Math.round(minimo)}-${Math.round(maximo)} ms`;
    etiquetaRangoMetricaDetalle.textContent =
      'Entre las lecturas cargadas; menos milisegundos es mejor.';
  }

  function renderizarResumenSeries(monitoresSeleccionados) {
    if (!resumenSeries) {
      return;
    }

    if (!Array.isArray(monitoresSeleccionados) || monitoresSeleccionados.length === 0) {
      resumenSeries.innerHTML = '';
      return;
    }

    resumenSeries.innerHTML = monitoresSeleccionados
      .map((monitor, indice) => {
        return `
          <article class="kpi-resumen comparador-slot-columna" data-comparador-slot-columna="${indice}">
            <span class="etiqueta">${escapeHtml(monitor.nombre)}</span>
            <strong style="color: rgb(var(--comparador-slot-rgb));">${escapeHtml(String(monitor.tipo || '').toUpperCase())}</strong>
            <small>${escapeHtml(monitor.alcanceDescripcion || 'Sin alcance')}. ${escapeHtml(String(monitor.totalEventosVisibles || 0))} eventos encontrados.</small>
            ${construirContextoOperativoMonitor(monitor)
              ? `<small>${escapeHtml(construirContextoOperativoMonitor(monitor))}</small>`
              : ''}
          </article>
        `;
      })
      .join('');
  }

  function actualizarPanelDetalle(evento, y) {
    descartarIntervaloActivo();
    if (!evento) {
      panelDetalle.innerHTML = `
        <h3>Detalle del punto</h3>
        <p class="texto-apoyo">No hay ejecuciones visibles en el rango actual.</p>
      `;
      return;
    }

    panelDetalle.innerHTML = `
      <h3>${escapeHtml(evento.nombreMonitor || `Monitor #${evento.monitorId}`)}</h3>
      <div class="fila-monitor__etiquetas">
        <span class="insignia-monitor ${evento.exito ? 'insignia-monitor--ok' : 'insignia-monitor--alerta'}">${escapeHtml(evento.resumen?.etiquetaEstado || (evento.exito ? 'Operativo' : 'Fallo'))}</span>
        <span class="insignia-monitor insignia-monitor--suave">${escapeHtml(String(evento.tipoMonitor || evento.tipo || '').toUpperCase())}</span>
      </div>
      <p class="comparador-detalle__fecha">${escapeHtml(formatearFechaVisible(evento.ejecutadoEnUtc))}</p>
      <p class="comparador-detalle__mensaje">${escapeHtml(evento.resumen?.detalle || evento.mensajeResultado || 'Sin detalle operativo adicional.')}</p>
      <div class="metadatos-configuracion comparador-detalle__resumen">
        <span>Tiempo representado: <strong>${escapeHtml(formatearMilisegundos(y))}</strong></span>
        ${evento.metricaPrincipal?.certificadoDiasRestantes != null ? `<span>Certificado: caduca en ${escapeHtml(String(evento.metricaPrincipal.certificadoDiasRestantes))} días</span>` : ''}
        ${evento.resumen?.interpretacion?.mensajeInterpretacion ? `<span>Interpretación: ${escapeHtml(evento.resumen.interpretacion.mensajeInterpretacion)}</span>` : ''}
      </div>
      <details class="comparador-detalle__tecnico">
        <summary>Ver datos técnicos</summary>
        <div class="metadatos-configuracion">
          <span>Código: <code>${escapeHtml(evento.codigoResultado || 'sin_resultado')}</code></span>
          <span>Duración total: <code>${escapeHtml(String(evento.duracionTotalMs || 0))} ms</code></span>
          ${evento.resultadoTecnico?.estadoDetectado ? `<span>Resultado técnico: <code>${escapeHtml(evento.resultadoTecnico.estadoDetectado)} / ${escapeHtml(evento.resultadoTecnico.codigoResultado || 'sin_resultado')}</code></span>` : ''}
          ${evento.protocolo?.host ? `<span>Destino: <code>${escapeHtml(evento.protocolo.host)}${evento.protocolo.puerto ? `:${escapeHtml(String(evento.protocolo.puerto))}` : ''}</code></span>` : ''}
          ${evento.metricaPrincipal?.rttMs != null ? `<span>RTT real: <code>${escapeHtml(String(evento.metricaPrincipal.rttMs))} ms</code></span>` : ''}
          ${evento.metricaPrincipal?.ttlRespuesta != null ? `<span>TTL respuesta: <code>${escapeHtml(String(evento.metricaPrincipal.ttlRespuesta))}</code></span>` : ''}
        </div>
      </details>
    `;
  }

  function actualizarPanelIntervalo(punto, { cargar = false } = {}) {
    const clave = `${punto.monitorId}:${punto.intervalo}:${punto.inicioUtc}`;
    if (intervaloActivo?.clave === clave) {
      if (cargar) void cargarLecturasIntervalo();
      return;
    }
    descartarIntervaloActivo();
    intervaloActivo = { clave, punto, cargando: false, cargado: false };
    const retorno = `${window.location.pathname}${window.location.search}`;
    const enlace = new URL(`/monitores/${encodeURIComponent(punto.monitorId)}`, window.location.origin);
    enlace.searchParams.set('return_to', retorno);
    enlace.searchParams.set('desde', formatearFechaHoraInput(new Date(punto.inicioUtc)));
    enlace.searchParams.set('hasta', formatearFechaHoraInput(new Date(punto.finUtc)));
    panelDetalle.innerHTML = `
      <h3>Lecturas comparadas</h3>
      <p class="comparador-detalle__fecha">${escapeHtml(formatearFechaVisible(punto.inicioUtc))} – ${escapeHtml(formatearFechaVisible(punto.finUtc))}</p>
      <p class="comparador-intervalo__origen">Vela seleccionada: ${escapeHtml(punto.nombreMonitor)}</p>
      <div class="fila-monitor__etiquetas">
        <span class="insignia-monitor insignia-monitor--suave">${escapeHtml(String(punto.cantidad))} ejecuciones</span>
        <span class="insignia-monitor ${punto.fallos > 0 ? 'insignia-monitor--alerta' : 'insignia-monitor--ok'}">${punto.fallos > 0 ? `${escapeHtml(String(punto.fallos))} con fallo` : 'Sin fallos'}</span>
      </div>
      <div class="metadatos-configuracion">
        <span>Mínimo–máximo: <strong>${escapeHtml(formatearMilisegundos(punto.minimo))} – ${escapeHtml(formatearMilisegundos(punto.maximo))}</strong></span>
        <span>Primera–última: ${escapeHtml(formatearMilisegundos(punto.apertura))} → ${escapeHtml(formatearMilisegundos(punto.cierre))}</span>
      </div>
      <button type="button" class="btn btn-outline-primary btn-sm" data-comparador-intervalo-abrir>Ver lecturas aquí</button>
      <div class="comparador-intervalo__contenido" data-comparador-intervalo-contenido aria-live="polite"></div>
      <a class="comparador-intervalo__enlace" href="${escapeHtml(enlace.pathname + enlace.search)}">Abrir este monitor completo</a>
    `;
    panelDetalle.querySelector('[data-comparador-intervalo-abrir]')
      ?.addEventListener('click', function () { void cargarLecturasIntervalo(); });
    if (cargar) void cargarLecturasIntervalo();
  }

  function descartarIntervaloActivo() {
    versionIntervalo += 1;
    chartIntervalo?.destroy();
    chartIntervalo = null;
    intervaloActivo = null;
  }

  async function cargarLecturasIntervalo() {
    const activo = intervaloActivo;
    if (!activo || activo.cargando || activo.cargado) return;
    activo.cargando = true;
    const version = ++versionIntervalo;
    const contenedor = panelDetalle.querySelector('[data-comparador-intervalo-contenido]');
    if (!contenedor) return;
    contenedor.textContent = 'Cargando lecturas de los monitores en este intervalo…';
    const series = chart.data.datasets.map((dataset, indice) => ({
      id: String(dataset.monitorId || dataset.data[0]?.monitorId || ''),
      nombre: dataset.label,
      colores: coloresSerie(indice)
    })).filter((serie) => serie.id);

    try {
      const respuestas = await Promise.all(series.map(async (serie) => {
        const parametros = new URLSearchParams({
          monitor_ids: serie.id,
          desde: activo.punto.inicioUtc,
          hasta: new Date(Date.parse(activo.punto.finUtc) - 1).toISOString(),
          detalle: '1'
        });
        const respuesta = await fetchJson(`${urlComparacion}?${parametros.toString()}`);
        return {
          ...serie,
          puntos: (Array.isArray(respuesta.eventos) ? respuesta.eventos : [])
            .map(construirPuntoEvento).filter(Boolean),
          truncado: Boolean(respuesta.resumen?.truncado)
        };
      }));
      if (version !== versionIntervalo || intervaloActivo !== activo) return;
      activo.cargado = true;
      activo.cargando = false;
      const seriesConDatos = respuestas.filter((serie) => serie.puntos.length);
      if (seriesConDatos.length === 0) {
        contenedor.textContent = 'No hay lecturas individuales en este intervalo para los monitores comparados.';
        return;
      }
      contenedor.innerHTML = `
        <div class="comparador-intervalo__series">${respuestas.map((serie) => `
          <div class="comparador-intervalo__serie">
            <span class="comparador-intervalo__color" style="--color-serie: ${serie.colores.borde}"></span>
            <span class="comparador-intervalo__nombre">${escapeHtml(serie.nombre)}</span>
            <span class="comparador-intervalo__cantidad">${escapeHtml(String(serie.puntos.length))} lecturas${serie.truncado ? ' (parcial)' : ''}</span>
          </div>`).join('')}</div>
        ${respuestas.some((serie) => serie.truncado) ? '<p class="comparador-intervalo__estado">Alguna serie supera el límite de lecturas; abre su monitor para ver el resto.</p>' : ''}
        <div class="comparador-intervalo__grafico"><canvas data-comparador-intervalo-canvas aria-label="Lecturas reales de los monitores comparados en el mismo intervalo"></canvas></div>
        <p class="comparador-intervalo__lectura" data-comparador-intervalo-lectura>Toca una línea para inspeccionar una ejecución.</p>
      `;
      pintarGraficaIntervalo(activo.punto, seriesConDatos);
      panelDetalle.querySelector('[data-comparador-intervalo-abrir]')?.remove();
    } catch (error) {
      if (version !== versionIntervalo || intervaloActivo !== activo) return;
      activo.cargando = false;
      contenedor.textContent = error?.message || 'No se pudieron cargar las lecturas.';
    }
  }

  function pintarGraficaIntervalo(intervalo, series) {
    const lienzo = panelDetalle.querySelector('[data-comparador-intervalo-canvas]');
    if (!lienzo) return;
    const seriesParaDibujar = [...series].sort((a, b) => b.puntos.length - a.puntos.length);
    const estilos = getComputedStyle(modulo);
    const texto = estilos.getPropertyValue('--texto-suave').trim();
    const borde = estilos.getPropertyValue('--borde').trim();
    const maximo = series.reduce((valor, serie) => serie.puntos.reduce(
      (actual, punto) => Math.max(actual, punto.y), valor
    ), 1);
    const actualizarLectura = (elementos) => {
      const elemento = elementos?.[0];
      const serie = seriesParaDibujar[elemento?.datasetIndex];
      const punto = serie?.puntos[elemento?.index];
      if (!punto) return;
      const salida = panelDetalle.querySelector('[data-comparador-intervalo-lectura]');
      if (salida) salida.textContent =
        `${serie.nombre} · ${formatearFechaVisible(punto.evento.ejecutadoEnUtc)} · ${formatearMilisegundos(punto.y)} · ${punto.evento.resumen?.etiquetaEstado || punto.evento.estadoDetectado}`;
    };
    chartIntervalo = new window.Chart(lienzo, {
      type: 'line',
      data: {
        datasets: seriesParaDibujar.map((serie) => ({
          label: serie.nombre,
          data: serie.puntos,
          parsing: false,
          borderColor: serie.colores.borde,
          borderWidth: 1.5,
          pointRadius: serie.puntos.length <= 80 ? 3 : 0,
          pointHoverRadius: 5,
          pointHitRadius: 10,
          pointBackgroundColor: serie.puntos.map((punto) => colorPunto(punto.evento, serie.colores)),
          pointStyle: serie.puntos.map((punto) => punto.evento?.exito ? 'circle' : 'triangle'),
          tension: 0
        }))
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        parsing: false,
        interaction: { mode: 'nearest', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (items) => formatearFechaVisible(items[0]?.raw?.evento?.ejecutadoEnUtc),
              label: (item) => `${formatearMilisegundos(item.raw?.y)} · ${item.raw?.evento?.resumen?.etiquetaEstado || 'Lectura'}`
            }
          }
        },
        scales: {
          x: {
            type: 'linear', min: Date.parse(intervalo.inicioUtc), max: Date.parse(intervalo.finUtc),
            ticks: { color: texto, maxTicksLimit: 3, callback: (valor) => formatearMarcaCorta(valor) },
            grid: { color: borde }
          },
          y: {
            reverse: true, min: 0, max: Math.ceil(maximo * 1.1),
            ticks: { color: texto, maxTicksLimit: 4, callback: (valor) => `${Number(valor).toFixed(0)} ms` },
            grid: { color: borde }
          }
        },
        onHover: (_evento, elementos) => actualizarLectura(elementos),
        onClick: (_evento, elementos) => actualizarLectura(elementos)
      }
    });
  }

  function limpiarVisualizacion(mensaje) {
    descartarIntervaloActivo();
    etiquetaEstadoCarga.textContent = mensaje;
    etiquetaTotalPuntos.textContent = '0';
    etiquetaTotalPuntosDetalle.textContent = 'Sin consulta todavía.';
    etiquetaRangoMetrica.textContent = 'Sin puntos';
    etiquetaRangoMetricaDetalle.textContent =
      'Arriba 0 ms, abajo el peor tiempo observado.';

    if (resumenSeries) {
      resumenSeries.innerHTML = '';
    }
    if (leyendaIntervalos) leyendaIntervalos.hidden = true;

    if (chart) {
      chart.data.datasets = [];
      chart.update();
    }

    panelDetalle.innerHTML = `
      <h3>Detalle del punto</h3>
      <p class="texto-apoyo">${escapeHtml(mensaje)}</p>
    `;
  }

  function sincronizarUrl(parametros) {
    const retorno = new URL(window.location.href).searchParams.get('return_to');
    if (retorno) parametros.set('return_to', retorno);
    const nuevaUrl = parametros.toString()
      ? `${window.location.pathname}?${parametros.toString()}`
      : window.location.pathname;

    window.history.replaceState({}, '', nuevaUrl);
    actualizarHeroComparador();
  }

  function actualizarHeroComparador() {
    const monitorIds = leerMonitorIdsDesdeFormulario();
    if (heroMonitores) heroMonitores.textContent = `${monitorIds.length} de 3`;
    if (heroMonitoresDetalle) {
      heroMonitoresDetalle.textContent = monitorIds.length === 0
        ? 'Elige los monitores que quieres comparar.'
        : monitorIds.length === 1
          ? 'Un monitor seleccionado; puedes añadir dos más.'
          : `${monitorIds.length} monitores en el mismo eje temporal.`;
    }

    const desde = new Date(inputDesde?.value || '');
    const hasta = new Date(inputHasta?.value || '');
    if (!Number.isNaN(desde.getTime()) && !Number.isNaN(hasta.getTime())) {
      const mismoAno = desde.getFullYear() === hasta.getFullYear();
      const fecha = new Intl.DateTimeFormat('es-ES', {
        day: 'numeric', month: 'short', ...(mismoAno ? {} : { year: 'numeric' })
      });
      const hora = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' });
      if (heroPeriodo) heroPeriodo.textContent = `${fecha.format(desde)} → ${fecha.format(hasta)}`;
      if (heroPeriodoDetalle) {
        const horas = hora.format(desde) === hora.format(hasta)
          ? `${hora.format(desde)} h`
          : `${hora.format(desde)}–${hora.format(hasta)} h`;
        heroPeriodoDetalle.textContent = `${horas} · ${mismoAno ? `${desde.getFullYear()} · ` : ''}hora local`;
      }
    }

    const retornoComparador = `${window.location.pathname}${window.location.search}`;
    const desdeDia = inputDesde?.value?.slice(0, 10) || '';
    const hastaDia = inputHasta?.value?.slice(0, 10) || '';
    if (enlaceVistaIndividual) {
      const destino = new URL('/monitores/eventos', window.location.origin);
      destino.searchParams.set('return_to', retornoComparador);
      if (desdeDia) destino.searchParams.set('desde', desdeDia);
      if (hastaDia) destino.searchParams.set('hasta', hastaDia);
      if (monitorIds.length === 1) destino.searchParams.set('monitor_id', monitorIds[0]);
      enlaceVistaIndividual.href = `${destino.pathname}${destino.search}`;
    }
    if (enlaceHistorico) {
      const destino = new URL('/monitores/historico', window.location.origin);
      if (desdeDia) destino.searchParams.set('desde', desdeDia);
      if (hastaDia) destino.searchParams.set('hasta', hastaDia);
      if (monitorIds.length === 1) destino.searchParams.set('monitor_id', monitorIds[0]);
      enlaceHistorico.href = `${destino.pathname}${destino.search}`;
    }
  }

  function manejarError(error) {
    console.error(error);
    limpiarVisualizacion('No se pudo cargar la comparación.');
    window.portalToast?.show?.({
      tipo: 'error',
      titulo: 'Comparar eventos',
      cuerpo: error?.message || 'No se pudo cargar la información solicitada.'
    });
  }
})();

function fetchJson(url) {
  return fetch(url, {
    headers: {
      Accept: 'application/json'
    }
  }).then(async function (respuesta) {
    const datos = await respuesta.json().catch(function () {
      return null;
    });

    if (!respuesta.ok || !datos?.ok) {
      throw new Error(datos?.mensaje || 'La petición no pudo completarse.');
    }

    return datos;
  });
}

function aplicarValorFechaHoraInput(nodo, valor, { finDelDia = false } = {}) {
  if (!nodo || valor == null || String(valor).trim() === '') {
    return;
  }

  const valorFormateado = formatearFechaHoraInputDesdeValor(valor, {
    finDelDia
  });

  if (valorFormateado) {
    nodo.value = valorFormateado;
  }
}

function formatearFechaHoraInputDesdeValor(valor, { finDelDia = false } = {}) {
  const texto = String(valor || '').trim();

  if (!texto) {
    return '';
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) {
    return formatearFechaHoraInput(
      construirFechaLocalDesdeInput(texto, { finDelDia })
    );
  }

  return formatearFechaHoraInput(texto);
}

function construirFechaLocalDesdeInput(valor, { finDelDia = false } = {}) {
  const texto = String(valor || '').trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) {
    const [ano, mes, dia] = texto.split('-').map((fragmento) => Number(fragmento));

    return new Date(
      ano,
      mes - 1,
      dia,
      finDelDia ? 23 : 0,
      finDelDia ? 59 : 0,
      finDelDia ? 59 : 0,
      finDelDia ? 999 : 0
    );
  }

  const fecha = new Date(texto);

  if (finDelDia && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(texto)) {
    fecha.setSeconds(59, 999);
  }

  return fecha;
}

function formatearFechaHoraInput(fecha) {
  const valor = fecha instanceof Date ? fecha : new Date(fecha);

  if (Number.isNaN(valor.getTime())) {
    return '';
  }

  const ano = valor.getFullYear();
  const mes = String(valor.getMonth() + 1).padStart(2, '0');
  const dia = String(valor.getDate()).padStart(2, '0');
  const hora = String(valor.getHours()).padStart(2, '0');
  const minuto = String(valor.getMinutes()).padStart(2, '0');

  return `${ano}-${mes}-${dia}T${hora}:${minuto}`;
}

function formatearFechaVisible(valor) {
  if (!valor) return '';
  const global = window.portalFechas?.formatear?.(valor);
  if (global) return global;
  const fecha = new Date(valor);
  return Number.isNaN(fecha.getTime())
    ? String(valor)
    : fecha.toLocaleString('es-ES');
}

function formatearMarcaCorta(valor) {
  const fecha = new Date(Number(valor));

  if (Number.isNaN(fecha.getTime())) {
    return '';
  }

  return new Intl.DateTimeFormat('es-ES', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(fecha);
}

function formatearMilisegundos(valor) {
  if (!Number.isFinite(Number(valor))) {
    return 'Sin métrica';
  }

  return `${Number(valor).toFixed(1)} ms`;
}

function colorPunto(evento, colores) {
  if (evento?.exito) {
    return colores.puntoOk;
  }

  if (String(evento?.codigoResultado || '').includes('timeout')) {
    return colores.puntoWarn;
  }

  return colores.puntoError;
}

function bordePunto(evento, colores) {
  if (evento?.exito) {
    return colores.borde;
  }

  if (String(evento?.codigoResultado || '').includes('timeout')) {
    return colores.puntoWarn;
  }

  return colores.puntoError;
}

function escapeHtml(texto) {
  return String(texto)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
