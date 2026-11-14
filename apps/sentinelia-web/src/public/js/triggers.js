(function () {
  const modulo = document.querySelector('[data-triggers-admin]');

  if (!modulo) {
    return;
  }

  inicializarAdministracionTriggers(modulo);
})();

function inicializarAdministracionTriggers(modulo) {
  const urlTriggers = modulo.dataset.urlTriggers;
  const urlVinculos = modulo.dataset.urlVinculos;
  const puedeEditarTriggers = modulo.dataset.puedeEditarTriggers === '1';
  const puedeVerMonitores = modulo.dataset.puedeVerMonitores === '1';
  const puedeGestionarVinculos = modulo.dataset.puedeGestionarVinculos === '1';

  if (modulo.querySelector('[data-triggers-shell]') && urlTriggers) {
    inicializarListadoTriggers(modulo, {
      urlTriggers,
      urlVinculos,
      puedeEditarTriggers,
      puedeGestionarVinculos,
      puedeVerMonitores
    });
  }

  if (
    puedeVerMonitores &&
    urlVinculos &&
    modulo.querySelector('[data-vinculos-shell]')
  ) {
    inicializarListadoVinculos(modulo, {
      urlVinculos,
      puedeEditarTriggers,
      puedeGestionarVinculos
    });
  }
}

function inicializarListadoTriggers(
  modulo,
  {
    urlTriggers,
    urlVinculos,
    puedeEditarTriggers,
    puedeGestionarVinculos,
    puedeVerMonitores
  }
) {
  const construirUrlConRetorno = (url) => {
    const retorno = `${window.location.pathname}${window.location.search}`;
    const destino = new URL(String(url), window.location.origin);
    destino.searchParams.set('return_to', retorno);
    return `${destino.pathname}${destino.search}${destino.hash}`;
  };
  const inputBusqueda = modulo.querySelector('[data-triggers-q]');
  const selectorTipo = modulo.querySelector('[data-triggers-tipo]');
  const selectorTenant = modulo.querySelector('[data-triggers-tenant]');
  const selectorEmpresa = modulo.querySelector('[data-triggers-empresa]');
  const selectorActivo = modulo.querySelector('[data-triggers-activo]');
  const selectorPageSize = modulo.querySelector('[data-triggers-page-size]');
  const selectorSortBy = modulo.querySelector('[data-triggers-sort-by]');
  const selectorSortDir = modulo.querySelector('[data-triggers-sort-dir]');
  const botonLimpiar = modulo.querySelector('[data-triggers-limpiar]');
  const resumenFiltrosAvanzados = modulo.querySelector(
    '[data-triggers-filtros-avanzados-resumen]'
  );
  const contextoSitio = modulo.querySelector('[data-triggers-sitio-contexto]');
  const botonesFiltroRapido = Array.from(
    modulo.querySelectorAll('[data-triggers-filtro-rapido]')
  );
  const contenedorFilas = modulo.querySelector('[data-triggers-filas]');
  const resumenListado = modulo.querySelector('[data-triggers-resumen-listado]');
  const etiquetaPaginaActual = modulo.querySelector('[data-triggers-pagina-actual]');
  const botonesPaginacion = Array.from(
    modulo.querySelectorAll('[data-triggers-page-action]')
  );
  const modalUsoTriggerNodo = modulo.querySelector('[data-modal-uso-trigger]');
  const modalUsoTriggerTitulo = modulo.querySelector('[data-modal-uso-trigger-titulo]');
  const modalUsoTriggerSubtitulo = modulo.querySelector('[data-modal-uso-trigger-subtitulo]');
  const modalUsoTriggerCuerpo = modulo.querySelector('[data-modal-uso-trigger-cuerpo]');
  const modalImpactoTriggerNodo = modulo.querySelector('[data-modal-impacto-trigger]');
  const modalImpactoTriggerTitulo = modulo.querySelector('[data-modal-impacto-trigger-titulo]');
  const modalImpactoTriggerSubtitulo = modulo.querySelector('[data-modal-impacto-trigger-subtitulo]');
  const modalImpactoTriggerCuerpo = modulo.querySelector('[data-modal-impacto-trigger-cuerpo]');
  const enlaceEditarImpactoTrigger = modulo.querySelector('[data-modal-impacto-trigger-editar]');
  const inputImpactoTriggerId = modulo.querySelector('[data-modal-impacto-trigger-id]');
  const inputImpactoTriggerRevision = modulo.querySelector(
    '[data-modal-impacto-trigger-revision]'
  );
  const kpiTotal = document.querySelector('[data-kpi-triggers-total]');
  const kpiActivos = document.querySelector('[data-kpi-triggers-activos]');
  const kpiInactivos = document.querySelector('[data-kpi-triggers-inactivos]');
  const opcionesEmpresa = Array.from(selectorEmpresa?.options || [])
    .map((opcion) => opcion.cloneNode(true));
  let temporizadorBusqueda = null;
  let triggersActualesPorId = new Map();

  const inicializarTooltipsLocales = function (raiz = document) {
    if (!window.bootstrap?.Tooltip) {
      return;
    }

    for (const nodo of raiz.querySelectorAll('[data-bs-toggle="tooltip"]')) {
      window.bootstrap.Tooltip.getInstance(nodo)?.dispose();
      new window.bootstrap.Tooltip(nodo);
    }
  };

  const estado = {
    q: inputBusqueda?.value.trim() || '',
    tenantId: selectorTenant?.value || '',
    empresaId: selectorEmpresa?.value || '',
    sitioId: modulo.dataset.sitioId || '',
    tipo: selectorTipo?.value || '',
    activo: selectorActivo?.value || 'todos',
    salud: '',
    page: 1,
    pageSize: Number(selectorPageSize?.value || 10),
    sortBy: selectorSortBy?.value || 'nombre',
    sortDir: selectorSortDir?.value || 'asc',
    totalPaginas: 1
  };

  function reconstruirEmpresas() {
    if (!selectorEmpresa) {
      return;
    }

    const seleccionActual = selectorEmpresa.value;
    const tenantId = selectorTenant?.value || '';
    selectorEmpresa.innerHTML = '<option value="">Todas las empresas</option>';

    for (const opcion of opcionesEmpresa) {
      if (!opcion.value) {
        continue;
      }

      if (!tenantId || opcion.dataset.tenantId === tenantId) {
        selectorEmpresa.appendChild(opcion.cloneNode(true));
      }
    }

    if (Array.from(selectorEmpresa.options).some(
      (opcion) => opcion.value === seleccionActual
    )) {
      selectorEmpresa.value = seleccionActual;
    }
  }

  function aplicarEstadoDesdeControles({ resetearPagina = false } = {}) {
    estado.q = inputBusqueda?.value.trim() || '';
    estado.tenantId = selectorTenant?.value || '';
    estado.empresaId = selectorEmpresa?.value || '';
    estado.tipo = selectorTipo?.value || '';
    estado.activo = selectorActivo?.value || 'todos';
    estado.pageSize = Number(selectorPageSize?.value || 10);
    estado.sortBy = selectorSortBy?.value || 'nombre';
    estado.sortDir = selectorSortDir?.value || 'asc';

    if (resetearPagina) {
      estado.page = 1;
    }
  }

  function construirQuery() {
    const parametros = new URLSearchParams();
    parametros.set('q', estado.q);
    parametros.set('tenant_id', estado.tenantId);
    parametros.set('empresa_id', estado.empresaId);
    if (estado.sitioId) parametros.set('sitio_id', estado.sitioId);
    parametros.set('tipo', estado.tipo);
    parametros.set('activo', estado.activo);
    parametros.set('salud', estado.salud);
    parametros.set('page', String(estado.page));
    parametros.set('page_size', String(estado.pageSize));
    parametros.set('sort_by', estado.sortBy);
    parametros.set('sort_dir', estado.sortDir);
    return parametros.toString();
  }

  function actualizarResumen(datos) {
    const { resumen, paginacion } = datos;
    const totalDnsInvalidos = (datos.triggers || [])
      .filter((trigger) => trigger.objetivoDns?.valido === false)
      .length;

    if (kpiTotal) {
      kpiTotal.textContent = String(resumen.totalTriggers || 0);
    }

    if (kpiActivos) {
      kpiActivos.textContent = String(resumen.totalActivos || 0);
    }

    if (kpiInactivos) {
      kpiInactivos.textContent = `${resumen.totalInactivos || 0} inactivas.`;
    }

    if (resumenListado) {
      resumenListado.parentElement.hidden = paginacion.totalFiltrado === 0;
      resumenListado.textContent =
        paginacion.totalFiltrado > 0
          ? `Mostrando ${paginacion.desde}-${paginacion.hasta} de ${paginacion.totalFiltrado} acciones filtradas.${totalDnsInvalidos > 0 ? ` ${totalDnsInvalidos} requieren revisión DNS.` : ''}`
          : Number(paginacion.totalVisible || 0) === 0
            ? 'El catálogo todavía no contiene acciones.'
            : 'No hay acciones para el filtro actual.';
    }

    if (etiquetaPaginaActual) {
      etiquetaPaginaActual.textContent =
        `Página ${paginacion.pagina} de ${paginacion.totalPaginas}`;
    }
  }

  function actualizarPaginacionVisual() {
    for (const boton of botonesPaginacion) {
      const accion = boton.dataset.triggersPageAction;
      let disabled = false;

      if (accion === 'first' || accion === 'prev') {
        disabled = estado.page <= 1;
      }

      if (accion === 'next' || accion === 'last') {
        disabled = estado.page >= estado.totalPaginas;
      }

      boton.disabled = disabled;
    }
  }

  function actualizarDireccionVisual() {
    if (!selectorSortDir) return;
    const descendente = estado.sortDir === 'desc';
    const descripcion = `Orden ${descendente ? 'descendente' : 'ascendente'}`;
    const icono = selectorSortDir.querySelector('i');
    selectorSortDir.value = estado.sortDir;
    selectorSortDir.setAttribute('aria-label', descripcion);
    selectorSortDir.setAttribute('title', descripcion);
    if (icono) {
      icono.className = `bi ${descendente ? 'bi-sort-alpha-up-alt' : 'bi-sort-alpha-down'}`;
    }
  }

  function actualizarFiltrosRapidosVisuales() {
    const filtroActivo = resolverFiltroRapidoActivo();

    for (const boton of botonesFiltroRapido) {
      const activo = boton.dataset.triggersFiltroRapido === filtroActivo;
      boton.classList.toggle('is-active', activo);
      boton.setAttribute('aria-pressed', activo ? 'true' : 'false');
    }

    actualizarResumenFiltros();
  }

  function actualizarResumenFiltros() {
    const filtrosAvanzados = [
      estado.tenantId,
      estado.empresaId,
      estado.pageSize !== 10 ? 'filas' : '',
      estado.sortBy !== 'nombre' ? 'orden' : '',
      estado.sortDir !== 'asc' ? 'direccion' : ''
    ].filter(Boolean).length;
    const hayFiltros = Boolean(
      estado.q || estado.tenantId || estado.empresaId || estado.tipo ||
      estado.activo !== 'todos' || estado.salud || filtrosAvanzados
    );

    if (botonLimpiar) {
      botonLimpiar.hidden = !hayFiltros;
    }

    if (resumenFiltrosAvanzados) {
      resumenFiltrosAvanzados.textContent = filtrosAvanzados > 0
        ? `${filtrosAvanzados} ${filtrosAvanzados === 1 ? 'aplicado' : 'aplicados'}`
        : 'Alcance, filas y ordenación';
    }
  }

  function resolverFiltroRapidoActivo() {
    if (estado.salud === 'requieren_revision') {
      return 'revision';
    }

    if (estado.tipo === 'dns' && estado.activo === 'todos') {
      return 'dns';
    }

    if (estado.tipo === 'api' && estado.activo === 'todos') {
      return 'api';
    }

    if (estado.tipo === 'correo' && estado.activo === 'todos') {
      return 'correo';
    }

    if (estado.activo === 'solo_activos' && !estado.tipo) {
      return 'activos';
    }

    if (!estado.tipo && estado.activo === 'todos') {
      return 'todos';
    }

    return '';
  }

  function resolverEstadoOperativo(trigger) {
    const uso = trigger.usoOperativo || {};
    const ultimaEjecucion = uso.ultimaEjecucion || null;
    const ultimaFecha =
      ultimaEjecucion?.finalizadoEnUtc ||
      ultimaEjecucion?.iniciadoEnUtc ||
      ultimaEjecucion?.fechaActualizacion ||
      null;
    const totalVinculos = Number(uso.totalVinculos || 0);
    const totalVinculosActivos = Number(uso.totalVinculosActivos || 0);
    const totalMonitoresActivos = Number(uso.totalMonitoresActivos || 0);

    if (trigger.objetivoDns?.valido === false) {
      return {
        etiqueta: 'Revisar DNS',
        clase: 'insignia-monitor--alerta',
        icono: 'bi-exclamation-triangle',
        detalle: trigger.objetivoDns.mensaje || 'Objetivo DNS inválido.'
      };
    }

    if (!trigger.scopeValido) {
      return {
        etiqueta: 'Alcance inválido',
        clase: 'insignia-monitor--alerta',
        icono: 'bi-diagram-3',
        detalle: 'La jerarquía administrativa de la acción no es válida.'
      };
    }

    if (trigger.tipo === 'correo' && trigger.estadoCorreo) {
      const estadoCorreo = trigger.estadoCorreo;
      return {
        etiqueta: estadoCorreo.administrativo.replaceAll('_', ' '),
        clase: estadoCorreo.operativo
          ? 'insignia-monitor--ok'
          : estadoCorreo.requiereRevision
            ? 'insignia-monitor--alerta'
            : 'insignia-monitor--off',
        icono: estadoCorreo.operativo ? 'bi-envelope-check' : 'bi-envelope-exclamation',
        detalle: estadoCorreo.diagnosticos.length
          ? estadoCorreo.diagnosticos.join(', ')
          : 'Sin diagnósticos de correo.'
      };
    }

    if (!trigger.activo) {
      return {
        etiqueta: 'Inactiva',
        clase: 'insignia-monitor--off',
        icono: 'bi-pause-circle',
        detalle: totalVinculos > 0
          ? `${totalVinculos} enlaces visibles, pero la acción no se ejecutará mientras esté inactiva.`
          : 'No se ejecutará mientras esté inactiva.'
      };
    }

    if (uso.hayErrorReciente) {
      return {
        etiqueta: 'Error reciente',
        clase: 'insignia-monitor--alerta',
        icono: 'bi-exclamation-octagon',
        detalle:
          `${ultimaEjecucion?.mensajeResultado || ultimaEjecucion?.codigoResultado || 'La última ejecución terminó en error.'}${ultimaFecha ? ` · ${formatearFecha(ultimaFecha)}` : ''}`
      };
    }

    if (totalVinculosActivos > 0) {
      return {
        etiqueta: 'En uso',
        clase: 'insignia-monitor--ok',
        icono: 'bi-play-circle',
        detalle:
          `${totalVinculosActivos} enlaces activos en ${totalMonitoresActivos || totalVinculosActivos} monitores.${ultimaFecha ? ` Última ejecución: ${formatearFecha(ultimaFecha)}.` : ' Aún sin ejecuciones registradas.'}`
      };
    }

    if (totalVinculos > 0) {
      return {
        etiqueta: 'Enlaces inactivos',
        clase: 'insignia-monitor--off',
        icono: 'bi-link-45deg',
        detalle: `${totalVinculos} enlaces visibles, todos inactivos.`
      };
    }

    return {
      etiqueta: 'Sin uso',
      clase: 'insignia-monitor--suave',
      icono: 'bi-link',
      detalle: 'Configurado, pero sin monitores vinculados visibles.'
    };
  }

  function construirHuellaOperativa(trigger, estadoOperativo) {
    const uso = trigger.usoOperativo || {};
    const ultimaEjecucion = uso.ultimaEjecucion || null;
    const totalVinculos = Number(uso.totalVinculos || 0);
    const totalVinculosActivos = Number(uso.totalVinculosActivos || 0);
    const totalMonitores = Number(uso.totalMonitores || 0);
    const totalMonitoresActivos = Number(uso.totalMonitoresActivos || 0);
    const ultimaFecha =
      ultimaEjecucion?.finalizadoEnUtc ||
      ultimaEjecucion?.iniciadoEnUtc ||
      ultimaEjecucion?.fechaActualizacion ||
      null;
    const resultado = ultimaEjecucion?.codigoResultado ||
      ultimaEjecucion?.estadoEjecucion ||
      'sin ejecución';
    const chips = [
      {
        icono: 'bi-link-45deg',
        texto: totalVinculos > 0
          ? `${totalVinculosActivos}/${totalVinculos} enlaces`
          : 'Sin enlaces',
        clase: totalVinculosActivos > 0
          ? 'triggers-estado-chip--ok'
          : 'triggers-estado-chip--neutro'
      },
      {
        icono: 'bi-broadcast-pin',
        texto: totalMonitores > 0
          ? `${totalMonitoresActivos || 0}/${totalMonitores} monitores`
          : 'Sin monitores',
        clase: totalMonitoresActivos > 0
          ? 'triggers-estado-chip--ok'
          : 'triggers-estado-chip--neutro'
      }
    ];

    return `
      <div class="triggers-estado-operativo">
        <span class="insignia-monitor ${estadoOperativo.clase} d-inline-flex align-items-center gap-1">
          <i class="bi ${estadoOperativo.icono}" aria-hidden="true"></i>
          <span>${escapeHtml(estadoOperativo.etiqueta)}</span>
        </span>
        <div class="triggers-estado-operativo__chips" aria-label="Resumen de uso operativo">
          ${chips.map((chip) => `
            <span class="triggers-estado-chip ${chip.clase}">
              <i class="bi ${chip.icono}" aria-hidden="true"></i>
              <span>${escapeHtml(chip.texto)}</span>
            </span>
          `).join('')}
        </div>
        <div class="triggers-estado-operativo__ultima">
          <i class="bi ${uso.hayErrorReciente ? 'bi-exclamation-triangle' : 'bi-clock-history'}" aria-hidden="true"></i>
          <span>${escapeHtml(ultimaFecha ? formatearFecha(ultimaFecha) : 'Sin ejecución registrada')}</span>
          <span class="codigo-inline">${escapeHtml(resultado)}</span>
        </div>
        <div class="texto-apoyo triggers-tabla__estado-detalle">${escapeHtml(estadoOperativo.detalle)}</div>
      </div>
    `;
  }

  function obtenerModalUsoTrigger() {
    if (!modalUsoTriggerNodo || !window.bootstrap?.Modal) {
      return null;
    }

    return window.bootstrap.Modal.getOrCreateInstance
      ? window.bootstrap.Modal.getOrCreateInstance(modalUsoTriggerNodo)
      : new window.bootstrap.Modal(modalUsoTriggerNodo);
  }

  function obtenerModalImpactoTrigger() {
    if (!modalImpactoTriggerNodo || !window.bootstrap?.Modal) {
      return null;
    }

    return window.bootstrap.Modal.getOrCreateInstance
      ? window.bootstrap.Modal.getOrCreateInstance(modalImpactoTriggerNodo)
      : new window.bootstrap.Modal(modalImpactoTriggerNodo);
  }

  function renderizarResumenUsoTrigger(trigger) {
    const uso = trigger.usoOperativo || {};
    const ultimaEjecucion = uso.ultimaEjecucion || null;
    const ultimaFecha =
      ultimaEjecucion?.finalizadoEnUtc ||
      ultimaEjecucion?.iniciadoEnUtc ||
      ultimaEjecucion?.fechaActualizacion ||
      null;
    const tarjetas = [
      {
        etiqueta: 'Enlaces',
        valor: `${Number(uso.totalVinculosActivos || 0)}/${Number(uso.totalVinculos || 0)}`,
        detalle: 'activos / visibles',
        icono: 'bi-link-45deg'
      },
      {
        etiqueta: 'Monitores',
        valor: `${Number(uso.totalMonitoresActivos || 0)}/${Number(uso.totalMonitores || 0)}`,
        detalle: 'activos / visibles',
        icono: 'bi-broadcast-pin'
      },
      {
        etiqueta: 'Última ejecución',
        valor: ultimaFecha ? formatearFecha(ultimaFecha) : 'Sin traza',
        detalle: ultimaEjecucion?.codigoResultado || ultimaEjecucion?.estadoEjecucion || 'Aún no se ha disparado',
        icono: uso.hayErrorReciente ? 'bi-exclamation-triangle' : 'bi-clock-history'
      }
    ];

    return `
      <div class="modal-uso-trigger__resumen">
        ${tarjetas.map((tarjeta) => `
          <article class="modal-uso-trigger__kpi">
            <span class="organizacion-entidad__icono" aria-hidden="true">
              <i class="bi ${tarjeta.icono}"></i>
            </span>
            <div>
              <span>${escapeHtml(tarjeta.etiqueta)}</span>
              <strong>${escapeHtml(tarjeta.valor)}</strong>
              <small>${escapeHtml(tarjeta.detalle)}</small>
            </div>
          </article>
        `).join('')}
      </div>
    `;
  }

  function renderizarVinculosUsoTrigger(asignaciones) {
    if (!asignaciones.length) {
      return `
        <div class="modal-uso-trigger__vacio">
          <span class="organizacion-entidad__icono" aria-hidden="true">
            <i class="bi bi-link"></i>
          </span>
          <div>
            <strong>Esta acción no tiene enlaces visibles.</strong>
            <p class="texto-apoyo mb-0">Puede estar preparada, pero todavía no participa en ningún flujo operativo dentro de tu alcance.</p>
          </div>
        </div>
      `;
    }

    return `
      <div class="modal-uso-trigger__lista">
        ${asignaciones.map((item) => {
          const eventos = (item.eventosDisparo || []).join(', ') || '-';
          const triggerOculto = item.triggerVisible === false;
          return `
            <article class="modal-uso-trigger__vinculo">
              <div class="modal-uso-trigger__vinculo-principal">
                <span class="organizacion-entidad__icono" aria-hidden="true">
                  <i class="bi bi-broadcast-pin"></i>
                </span>
                <div>
                  <strong>${escapeHtml(item.monitorNombre || `Monitor #${item.monitorId}`)}</strong>
                  <p class="texto-apoyo mb-0">
                    ${escapeHtml(item.empresaNombre || '-')}
                    ${item.sitioNombre ? ` · ${escapeHtml(item.sitioNombre)}` : ''}
                    · Monitor #${escapeHtml(item.monitorId)}
                  </p>
                </div>
              </div>
              <div class="modal-uso-trigger__vinculo-meta">
                <span class="insignia-monitor ${item.activo ? 'insignia-monitor--ok' : 'insignia-monitor--off'}">
                  ${item.activo ? 'Activa' : 'Inactiva'}
                </span>
                <span class="insignia-monitor ${triggerOculto ? 'insignia-monitor--suave' : `insignia-monitor--${escapeHtml(item.triggerTipo || 'api')}`}">
                  ${triggerOculto ? 'Acción oculta' : escapeHtml(String(item.triggerTipo || '').toUpperCase())}
                </span>
                <span>Eventos: <code>${escapeHtml(eventos)}</code></span>
                <span>Orden: <code>${escapeHtml(String(item.ordenEjecucion || 0))}</code></span>
              </div>
              <div class="modal-uso-trigger__vinculo-acciones">
                <a href="${escapeHtml(item.urls.detalleMonitor)}" class="btn btn-outline-secondary btn-sm">
                  Ver monitor
                </a>
                ${(puedeGestionarVinculos && item.puedeGestionarVinculo && item.urls.editarVinculo)
                  ? `<a href="${escapeHtml(item.urls.editarVinculo)}" class="btn btn-outline-secondary btn-sm">Editar enlace</a>`
                  : ''}
              </div>
            </article>
          `;
        }).join('')}
      </div>
    `;
  }

  async function abrirModalUsoTrigger(idTrigger) {
    const trigger = triggersActualesPorId.get(String(idTrigger));
    const modal = obtenerModalUsoTrigger();

    if (!trigger || !modal || !modalUsoTriggerCuerpo) {
      window.portalToast?.show({
        tipo: 'warning',
        titulo: 'Uso operativo no disponible',
        cuerpo: 'No se pudo abrir el detalle operativo de esta acción.'
      });
      return;
    }

    if (modalUsoTriggerTitulo) {
      modalUsoTriggerTitulo.textContent = `Uso operativo de ${trigger.nombre}`;
    }
    if (modalUsoTriggerSubtitulo) {
      modalUsoTriggerSubtitulo.textContent =
        describirAlcanceAccion(trigger);
    }

    modalUsoTriggerCuerpo.innerHTML = `
      ${renderizarResumenUsoTrigger(trigger)}
      <div class="py-4 text-body-secondary d-inline-flex align-items-center gap-2">
        <i class="bi bi-arrow-repeat" aria-hidden="true"></i>
        <span>Cargando enlaces visibles...</span>
      </div>
    `;
    modal.show();

    try {
      const parametros = new URLSearchParams();
      parametros.set('trigger_id', String(trigger.id));
      parametros.set('page', '1');
      parametros.set('page_size', '100');
      parametros.set('sort_by', 'actualizado');
      parametros.set('sort_dir', 'desc');
      const datos = await fetchJson(`${urlVinculos}?${parametros.toString()}`);
      const asignaciones = datos.asignaciones || [];

      modalUsoTriggerCuerpo.innerHTML = `
        ${renderizarResumenUsoTrigger(trigger)}
        <div class="modal-uso-trigger__seccion">
          <div>
            <h3>Monitores vinculados</h3>
            <p class="texto-apoyo mb-0">
              Mostrando ${escapeHtml(String(datos.paginacion?.totalFiltrado || asignaciones.length))} enlaces visibles.
            </p>
          </div>
          <a
            href="/automatizacion/enlaces?trigger_id=${encodeURIComponent(String(trigger.id))}"
            class="btn btn-outline-secondary btn-sm"
          >
            Ver en listado
          </a>
        </div>
        ${renderizarVinculosUsoTrigger(asignaciones)}
      `;
    } catch (error) {
      modalUsoTriggerCuerpo.innerHTML = `
        ${renderizarResumenUsoTrigger(trigger)}
        <div class="mensaje-error mb-0">
          No se pudieron cargar los enlaces visibles: ${escapeHtml(error.message)}
        </div>
      `;
    }
  }

  function renderizarImpactoEliminacionTrigger(trigger) {
    const uso = trigger.usoOperativo || {};
    const totalVinculos = Number(uso.totalVinculos || 0);
    const totalVinculosActivos = Number(uso.totalVinculosActivos || 0);
    const totalMonitores = Number(uso.totalMonitores || 0);
    const ultimaEjecucion = uso.ultimaEjecucion || null;
    const ultimaFecha =
      ultimaEjecucion?.finalizadoEnUtc ||
      ultimaEjecucion?.iniciadoEnUtc ||
      ultimaEjecucion?.fechaActualizacion ||
      null;
    const tieneUso = totalVinculos > 0;
    const backlogCorreo = Number(trigger.resumenCorreo?.backlogAceptado || 0);
    const avisos = [
      tieneUso
        ? 'Eliminar retira la acción y sus enlaces asociados. Si quieres observar el efecto antes de borrarla, desactívala primero.'
        : 'Eliminar retirará la acción del catálogo. Si existieran enlaces fuera de tu alcance, no se muestran en esta lectura.',
      ultimaFecha
        ? `Última ejecución conocida: ${formatearFecha(ultimaFecha)} (${ultimaEjecucion?.codigoResultado || ultimaEjecucion?.estadoEjecucion || 'sin código'}).`
        : 'No hay ejecuciones visibles registradas para esta acción.',
      trigger.tipo === 'correo' && backlogCorreo > 0
        ? `Hay ${backlogCorreo} entregas ya aceptadas. El borrado solo gobierna transiciones futuras y NO cancela ese backlog.`
        : null
    ].filter(Boolean);

    return `
      <div class="modal-impacto-trigger__hero ${tieneUso ? 'modal-impacto-trigger__hero--alerta' : ''}">
        <span class="organizacion-entidad__icono" aria-hidden="true">
          <i class="bi ${tieneUso ? 'bi-exclamation-triangle' : 'bi-trash3'}"></i>
        </span>
        <div>
          <strong>${escapeHtml(tieneUso ? 'Esta acción está en uso' : 'Esta acción no tiene uso visible')}</strong>
          <p class="texto-apoyo mb-0">
            ${escapeHtml(tieneUso
              ? `${totalVinculosActivos} enlaces activos con ${totalMonitores} monitores visibles.`
              : 'No tiene enlaces visibles dentro de tu alcance actual.')}
          </p>
        </div>
      </div>
      <div class="modal-impacto-trigger__metricas">
        <article>
          <span>Enlaces activos</span>
          <strong>${escapeHtml(String(totalVinculosActivos))}</strong>
        </article>
        <article>
          <span>Enlaces visibles</span>
          <strong>${escapeHtml(String(totalVinculos))}</strong>
        </article>
        <article>
          <span>Monitores visibles</span>
          <strong>${escapeHtml(String(totalMonitores))}</strong>
        </article>
      </div>
      <div class="modal-impacto-trigger__avisos">
        ${avisos.map((aviso) => `
          <p>
            <i class="bi bi-info-circle" aria-hidden="true"></i>
            <span>${escapeHtml(aviso)}</span>
          </p>
        `).join('')}
      </div>
    `;
  }

  async function abrirModalImpactoTrigger(idTrigger) {
    const trigger = triggersActualesPorId.get(String(idTrigger));
    const modal = obtenerModalImpactoTrigger();

    if (!trigger || !modal || !modalImpactoTriggerCuerpo) {
      window.portalToast?.show({
        tipo: 'warning',
        titulo: 'Impacto no disponible',
        cuerpo: 'No se pudo preparar el impacto de eliminar la acción.'
      });
      return;
    }

    if (modalImpactoTriggerTitulo) {
      modalImpactoTriggerTitulo.textContent = `Eliminar «${trigger.nombre}»`;
    }

    if (modalImpactoTriggerSubtitulo) {
      modalImpactoTriggerSubtitulo.textContent =
        `Acción de ${describirTipoAccion(trigger)} · ${describirAlcanceAccion(trigger)}`;
    }

    if (enlaceEditarImpactoTrigger) {
      enlaceEditarImpactoTrigger.href = trigger.urls?.editar || '/automatizacion/acciones';
      enlaceEditarImpactoTrigger.textContent = trigger.activo
        ? 'Editar / desactivar primero'
        : 'Editar acción';
    }

    if (inputImpactoTriggerId) {
      inputImpactoTriggerId.value = String(trigger.id);
    }

    if (inputImpactoTriggerRevision) {
      inputImpactoTriggerRevision.value = String(trigger.revisionDeclaracion);
    }

    modalImpactoTriggerCuerpo.innerHTML = renderizarImpactoEliminacionTrigger(trigger);
    modal.show();
  }

  function describirTipoAccion(trigger) {
    const etiqueta = String(trigger?.definicionTipo?.etiqueta || '').trim();

    if (etiqueta) {
      return etiqueta.toLocaleLowerCase('es-ES');
    }

    return String(trigger?.tipo || 'automatización').toLocaleLowerCase('es-ES');
  }

  function describirAlcanceAccion(trigger) {
    const nivel = String(
      trigger?.nivelPertenencia || trigger?.scope?.nivelPertenencia || ''
    ).toLowerCase();

    if (nivel === 'portal') {
      return 'Portal completo';
    }

    if (nivel === 'tenant') {
      return `Tenant: ${trigger.tenantNombre || `#${trigger.tenantId}`}`;
    }

    if (nivel === 'empresa') {
      return `Empresa: ${trigger.empresaNombre || `#${trigger.empresaId}`}`;
    }

    if (nivel === 'sitio') {
      const sitio = trigger.sitioNombre || `#${trigger.sitioId}`;
      const empresa = trigger.empresaNombre || `#${trigger.empresaId}`;
      return `Sitio: ${sitio} · Empresa: ${empresa}`;
    }

    return 'Alcance pendiente';
  }

  function resolverIconoTipo(tipo) {
    const normalizado = String(tipo || '').trim().toLowerCase();

    if (normalizado === 'dns') {
      return 'bi-globe2';
    }

    if (normalizado === 'api') {
      return 'bi-send-check';
    }

    if (normalizado === 'correo') {
      return 'bi-envelope-at';
    }

    return 'bi-lightning-charge';
  }

  function renderizarMenuCreacionAccion() {
    const presentacion = {
      api: { etiqueta: 'Llamada API', icono: 'bi-send-check' },
      dns: { etiqueta: 'Mutación DNS', icono: 'bi-globe2' },
      correo: { etiqueta: 'Correo electrónico', icono: 'bi-envelope-at' }
    };
    const tipos = Array.from(selectorTipo?.options || [])
      .map((opcion) => opcion.value)
      .filter((tipo) => presentacion[tipo]);

    if (!puedeEditarTriggers || tipos.length === 0) return '';

    return `
      <div class="dropdown">
        <button type="button" class="btn btn-primary btn-sm dropdown-toggle" data-bs-toggle="dropdown" aria-expanded="false">
          Nueva acción
        </button>
        <div class="dropdown-menu dropdown-menu-end organizacion-acciones-menu">
          ${tipos.map((tipo) => `
            <a href="/monitores/triggers/nuevo?tipo=${encodeURIComponent(tipo)}" class="dropdown-item d-flex align-items-center gap-2">
              <i class="bi ${presentacion[tipo].icono}" aria-hidden="true"></i>
              <span>${presentacion[tipo].etiqueta}</span>
            </a>
          `).join('')}
        </div>
      </div>
    `;
  }

  function renderizarFilas(triggers, paginacion = {}) {
    triggersActualesPorId = new Map(
      triggers.map((trigger) => [String(trigger.id), trigger])
    );

    if (!triggers.length) {
      const catalogoVacio = Number(paginacion.totalVisible || 0) === 0;
      contenedorFilas.innerHTML = `
        <tr>
          <td colspan="5" class="text-body-secondary">
            <div class="triggers-tabla__vacio">
              <span class="organizacion-entidad__icono" aria-hidden="true">
                <i class="bi bi-inbox"></i>
              </span>
              <div>
                <strong>${catalogoVacio ? 'El catálogo todavía está vacío.' : 'No hay acciones con el filtro actual.'}</strong>
                <p class="mb-0 texto-apoyo">${catalogoVacio ? 'Crea la primera acción para empezar a automatizar respuestas.' : 'Prueba a cambiar o limpiar los filtros.'}</p>
              </div>
              <div class="triggers-tabla__vacio-acciones">
                ${catalogoVacio
                  ? renderizarMenuCreacionAccion()
                  : `<button type="button" class="btn btn-outline-secondary btn-sm" data-triggers-limpiar-vacio>Limpiar filtros</button>`}
              </div>
            </div>
          </td>
        </tr>
      `;
      return;
    }

    contenedorFilas.innerHTML = triggers
      .map((trigger) => {
        const estadoOperativo = resolverEstadoOperativo(trigger);
        const tipo = String(trigger.tipo || '').toUpperCase();

        return `
          <tr class="${trigger.objetivoDns?.valido === false ? 'triggers-tabla__fila-alerta' : ''}">
            <td>
              <div class="organizacion-entidad">
                <${puedeEditarTriggers ? 'a' : 'span'}
                  class="organizacion-entidad__titulo${puedeEditarTriggers ? ' organizacion-entidad__titulo--enlace' : ''}"
                  ${puedeEditarTriggers ? `href="${escapeHtml(construirUrlConRetorno(trigger.urls.editar))}"` : ''}
                >
                  <span class="organizacion-entidad__icono" aria-hidden="true">
                    <i class="bi bi-lightning-charge"></i>
                  </span>
                  <span>${escapeHtml(trigger.nombre)}</span>
                </${puedeEditarTriggers ? 'a' : 'span'}>
                <span class="organizacion-entidad__meta">
                  <span>${escapeHtml(trigger.descripcion || 'Sin descripción')}</span>
                </span>
                <span class="triggers-tabla__configuracion triggers-tabla__configuracion--compacta">
                  ${escapeHtml(trigger.resumenConfiguracion?.principal || 'Sin configuración resumida')}
                </span>
              </div>
            </td>
            <td>
              <div class="triggers-tabla__tipo-alcance">
                <span class="insignia-monitor insignia-monitor--${escapeHtml(trigger.tipo)} d-inline-flex align-items-center gap-1">
                  <i class="bi ${escapeHtml(resolverIconoTipo(trigger.tipo))}" aria-hidden="true"></i>
                  <span>${escapeHtml(tipo)}</span>
                </span>
                <span class="insignia-monitor ${trigger.scopeValido ? 'insignia-monitor--suave' : 'insignia-monitor--alerta'}">
                  ${escapeHtml(describirAlcanceAccion(trigger))}
                </span>
              </div>
            </td>
            <td>
              ${construirHuellaOperativa(trigger, estadoOperativo)}
            </td>
            <td>
              <span class="organizacion-celda-fecha">
                <i
                  class="bi bi-clock-history"
                  data-bs-toggle="tooltip"
                  data-bs-placement="top"
                  data-bs-title="Fecha de la última actualización de la acción"
                  tabindex="0"
                  aria-label="Fecha de la última actualización de la acción"
                ></i>
                <span>${escapeHtml(formatearFecha(trigger.fechaActualizacion))}</span>
              </span>
            </td>
            <td class="text-center">
              <div class="dropup organizacion-acciones">
                <button
                  type="button"
                  class="btn btn-outline-secondary btn-sm organizacion-acciones-toggle"
                  data-bs-toggle="dropdown"
                  data-bs-auto-close="outside"
                  aria-expanded="false"
                  aria-label="Más acciones para ${escapeHtml(trigger.nombre)}"
                >
                  <i class="bi bi-gear" aria-hidden="true"></i>
                  <span class="visually-hidden">Más acciones</span>
                </button>
                <div class="dropdown-menu dropdown-menu-end organizacion-acciones-menu">
                  ${puedeEditarTriggers
                    ? `<a href="${escapeHtml(construirUrlConRetorno(trigger.urls.editar))}" class="dropdown-item d-flex align-items-center gap-2"><i class="bi bi-gear" aria-hidden="true"></i><span>Gestionar</span></a>`
                    : '<span class="dropdown-item-text text-body-secondary">Solo lectura</span>'}
                  ${(puedeGestionarVinculos && puedeVerMonitores)
                    ? `<button type="button" class="dropdown-item d-flex align-items-center gap-2" data-trigger-uso-id="${escapeHtml(String(trigger.id))}"><i class="bi bi-diagram-3" aria-hidden="true"></i><span>Ver uso operativo…</span></button>
                       <a href="/automatizacion/enlaces?trigger_id=${encodeURIComponent(String(trigger.id))}&amp;return_to=${encodeURIComponent(`${window.location.pathname}${window.location.search}`)}" class="dropdown-item d-flex align-items-center gap-2"><i class="bi bi-search" aria-hidden="true"></i><span>Ver enlaces</span></a>`
                    : ''}
                  ${(puedeGestionarVinculos && puedeVerMonitores && trigger.puedeVincular)
                    ? `<a href="${escapeHtml(construirUrlConRetorno(trigger.urls.nuevoVinculo))}" class="dropdown-item d-flex align-items-center gap-2"><i class="bi bi-link-45deg" aria-hidden="true"></i><span>Crear vínculo</span></a>`
                    : ''}
                  ${puedeEditarTriggers
                    ? `<button type="button" class="dropdown-item dropdown-item--danger d-flex align-items-center gap-2" data-trigger-eliminar-id="${escapeHtml(String(trigger.id))}"><i class="bi bi-trash3" aria-hidden="true"></i><span>Eliminar…</span></button>`
                    : ''}
                </div>
              </div>
            </td>
          </tr>
        `;
      })
      .join('');
    inicializarTooltipsLocales(contenedorFilas);
  }

  async function cargar() {
    contenedorFilas.innerHTML = `
      <tr>
        <td colspan="5" class="text-body-secondary">
          <div class="py-3 d-inline-flex align-items-center gap-2">
            <i class="bi bi-arrow-repeat" aria-hidden="true"></i>
            <span>Cargando acciones...</span>
          </div>
        </td>
      </tr>
    `;

    try {
      const datos = await fetchJson(`${urlTriggers}?${construirQuery()}`);
      estado.totalPaginas = datos.paginacion.totalPaginas;
      renderizarFilas(datos.triggers || [], datos.paginacion);
      actualizarResumen(datos);
      actualizarPaginacionVisual();
      actualizarFiltrosRapidosVisuales();
      const urlActual = new URL(window.location.href);
      if (estado.tenantId) {
        urlActual.searchParams.set('tenant_id', estado.tenantId);
      } else {
        urlActual.searchParams.delete('tenant_id');
      }
      if (estado.empresaId) {
        urlActual.searchParams.set('empresa_id', estado.empresaId);
      } else {
        urlActual.searchParams.delete('empresa_id');
      }
      window.history.replaceState({}, '', urlActual);
    } catch (error) {
      contenedorFilas.innerHTML = `
        <tr>
          <td colspan="5" class="text-danger">
            <div class="py-3 d-inline-flex align-items-center gap-2">
              <i class="bi bi-exclamation-triangle" aria-hidden="true"></i>
              <span>${escapeHtml(error.message || 'No se pudo cargar el catálogo.')}</span>
            </div>
          </td>
        </tr>
      `;
      window.portalToast?.show({
        tipo: 'error',
        titulo: 'No se pudo cargar el catálogo',
        cuerpo: error.message
      });
    }
  }

  function programarCarga() {
    window.clearTimeout(temporizadorBusqueda);
    temporizadorBusqueda = window.setTimeout(async function () {
      aplicarEstadoDesdeControles({ resetearPagina: true });
      await cargar();
    }, 240);
  }

  async function limpiarFiltros() {
    if (inputBusqueda) inputBusqueda.value = '';
    if (selectorTipo) selectorTipo.value = '';
    if (selectorTenant) selectorTenant.value = '';
    reconstruirEmpresas();
    if (selectorEmpresa) selectorEmpresa.value = '';
    estado.sitioId = '';
    if (contextoSitio) contextoSitio.hidden = true;
    if (selectorActivo) selectorActivo.value = 'todos';
    if (selectorPageSize) selectorPageSize.value = '10';
    if (selectorSortBy) selectorSortBy.value = 'nombre';
    if (selectorSortDir) selectorSortDir.value = 'asc';
    estado.salud = '';
    aplicarEstadoDesdeControles({ resetearPagina: true });
    actualizarDireccionVisual();
    await cargar();
  }

  async function aplicarFiltroRapido(filtro) {
    if (inputBusqueda) inputBusqueda.value = '';
    if (selectorTipo) selectorTipo.value = '';
    if (selectorActivo) selectorActivo.value = 'todos';
    estado.salud = '';

    if (filtro === 'activos' && selectorActivo) {
      selectorActivo.value = 'solo_activos';
    } else if (selectorTipo &&
        Array.from(selectorTipo.options).some((opcion) => opcion.value === filtro)) {
      selectorTipo.value = filtro;
    } else if (filtro === 'revision') {
      estado.salud = 'requieren_revision';
    }

    aplicarEstadoDesdeControles({ resetearPagina: true });
    await cargar();
  }

  inputBusqueda?.addEventListener('input', programarCarga);
  selectorTipo?.addEventListener('change', async function () {
    estado.salud = '';
    aplicarEstadoDesdeControles({ resetearPagina: true });
    await cargar();
  });
  selectorTenant?.addEventListener('change', async function () {
    estado.salud = '';
    estado.sitioId = '';
    if (contextoSitio) contextoSitio.hidden = true;
    reconstruirEmpresas();
    aplicarEstadoDesdeControles({ resetearPagina: true });
    await cargar();
  });
  selectorEmpresa?.addEventListener('change', async function () {
    estado.salud = '';
    estado.sitioId = '';
    if (contextoSitio) contextoSitio.hidden = true;
    aplicarEstadoDesdeControles({ resetearPagina: true });
    await cargar();
  });
  selectorActivo?.addEventListener('change', async function () {
    estado.salud = '';
    aplicarEstadoDesdeControles({ resetearPagina: true });
    await cargar();
  });
  selectorPageSize?.addEventListener('change', async function () {
    aplicarEstadoDesdeControles({ resetearPagina: true });
    await cargar();
  });
  selectorSortBy?.addEventListener('change', async function () {
    aplicarEstadoDesdeControles({ resetearPagina: true });
    await cargar();
  });
  selectorSortDir?.addEventListener('click', async function () {
    selectorSortDir.value = estado.sortDir === 'desc' ? 'asc' : 'desc';
    aplicarEstadoDesdeControles({ resetearPagina: true });
    actualizarDireccionVisual();
    await cargar();
  });
  botonLimpiar?.addEventListener('click', async function () {
    await limpiarFiltros();
  });

  for (const boton of botonesFiltroRapido) {
    boton.addEventListener('click', async function () {
      await aplicarFiltroRapido(boton.dataset.triggersFiltroRapido || 'todos');
    });
  }

  for (const boton of botonesPaginacion) {
    boton.addEventListener('click', async function () {
      const accion = boton.dataset.triggersPageAction;

      if (accion === 'first') estado.page = 1;
      if (accion === 'prev') estado.page = Math.max(1, estado.page - 1);
      if (accion === 'next') estado.page = Math.min(estado.totalPaginas, estado.page + 1);
      if (accion === 'last') estado.page = estado.totalPaginas;

      await cargar();
    });
  }

  reconstruirEmpresas();

  modulo.addEventListener('click', async function (evento) {
    const botonLimpiarVacio = evento.target.closest('[data-triggers-limpiar-vacio]');

    if (botonLimpiarVacio) {
      await limpiarFiltros();
      return;
    }
  });

  // En pantallas estrechas, portal.js mueve el menú fuera de `modulo` para
  // evitar que la tabla lo recorte. Sus acciones deben escucharse en document.
  document.addEventListener('click', async function (evento) {
    const objetivo = evento.target instanceof Element ? evento.target : null;
    const botonUso = objetivo?.closest('[data-trigger-uso-id]');
    const botonEliminar = objetivo?.closest('[data-trigger-eliminar-id]');

    if (!botonUso && !botonEliminar) {
      return;
    }

    const boton = botonUso || botonEliminar;

    if (
      !modulo.contains(boton) &&
      !boton.closest('.organizacion-acciones-menu.dropdown-menu--flotante-tabla')
    ) {
      return;
    }

    const desplegableAbierto = modulo.querySelector(
      '.organizacion-acciones-toggle[aria-expanded="true"]'
    );
    if (desplegableAbierto) {
      window.bootstrap?.Dropdown?.getInstance(desplegableAbierto)?.hide();
    }

    if (botonUso) {
      await abrirModalUsoTrigger(botonUso.dataset.triggerUsoId);
      return;
    }

    if (botonEliminar) {
      await abrirModalImpactoTrigger(botonEliminar.dataset.triggerEliminarId);
    }
  });

  cargar();
}

function inicializarListadoVinculos(
  modulo,
  {
    urlVinculos,
    puedeEditarTriggers,
    puedeGestionarVinculos
  }
) {
  const shell = modulo.querySelector('[data-vinculos-shell]');
  const inputBusqueda = modulo.querySelector('[data-vinculos-q]');
  const selectorTrigger = modulo.querySelector('[data-vinculos-trigger]');
  const selectorMonitor = modulo.querySelector('[data-vinculos-monitor]');
  const selectorTenant = modulo.querySelector('[data-vinculos-tenant]');
  const selectorEmpresa = modulo.querySelector('[data-vinculos-empresa]');
  const selectorTipo = modulo.querySelector('[data-vinculos-tipo]');
  const selectorActivo = modulo.querySelector('[data-vinculos-activo]');
  const selectorEvento = modulo.querySelector('[data-vinculos-evento]');
  const selectorPageSize = modulo.querySelector('[data-vinculos-page-size]');
  const selectorSortBy = modulo.querySelector('[data-vinculos-sort-by]');
  const selectorSortDir = modulo.querySelector('[data-vinculos-sort-dir]');
  const botonAplicar = modulo.querySelector('[data-vinculos-aplicar]');
  const botonLimpiar = modulo.querySelector('[data-vinculos-limpiar]');
  const botonFiltrosMovil = modulo.querySelector('[data-vinculos-filtros-movil-toggle]');
  const botonesFiltroRapido = Array.from(
    modulo.querySelectorAll('[data-vinculos-filtro-rapido]')
  );
  const contenedorFilas = modulo.querySelector('[data-vinculos-filas]');
  const resumenListado = modulo.querySelector('[data-vinculos-resumen-listado]');
  const etiquetaPaginaActual = modulo.querySelector('[data-vinculos-pagina-actual]');
  const botonesPaginacion = Array.from(
    modulo.querySelectorAll('[data-vinculos-page-action]')
  );
  const kpiTotal = document.querySelector('[data-kpi-vinculos-total]');
  const kpiActivos = document.querySelector('[data-kpi-vinculos-activos]');
  const kpiAcciones = document.querySelector('[data-kpi-vinculos-acciones]');
  const kpiMonitores = document.querySelector('[data-kpi-vinculos-monitores]');
  const modalEliminarVinculoNodo = modulo.querySelector('[data-modal-eliminar-vinculo]');
  const nombreMonitorEliminar = modalEliminarVinculoNodo?.querySelector('[data-modal-eliminar-vinculo-monitor]');
  const nombreAccionEliminar = modalEliminarVinculoNodo?.querySelector('[data-modal-eliminar-vinculo-accion]');
  const eventoEliminar = modalEliminarVinculoNodo?.querySelector('[data-modal-eliminar-vinculo-evento]');
  const idEliminar = modalEliminarVinculoNodo?.querySelector('[data-modal-eliminar-vinculo-id]');
  const retornoEliminar = modalEliminarVinculoNodo?.querySelector('[data-modal-eliminar-vinculo-retorno]');
  const opcionesEmpresa = Array.from(selectorEmpresa?.querySelectorAll('option') || [])
    .map((opcion) => opcion.cloneNode(true));
  const asignacionesPorId = new Map();
  let temporizadorBusqueda = null;
  let botonEliminarOrigen = null;

  function rutaListadoActual() {
    const parametros = new URLSearchParams();
    if (estado.q) parametros.set('q', estado.q);
    if (estado.triggerId) parametros.set('trigger_id', estado.triggerId);
    if (estado.monitorId) parametros.set('monitor_id', estado.monitorId);
    if (estado.tenantId) parametros.set('tenant_id', estado.tenantId);
    if (estado.empresaId) parametros.set('empresa_id', estado.empresaId);
    if (estado.tipo) parametros.set('tipo', estado.tipo);
    if (estado.activo !== 'todos') parametros.set('activo', estado.activo);
    if (estado.evento) parametros.set('evento_disparo', estado.evento);
    if (estado.page !== 1) parametros.set('page', String(estado.page));
    if (estado.pageSize !== 10) parametros.set('page_size', String(estado.pageSize));
    if (estado.sortBy !== 'actualizado') parametros.set('sort_by', estado.sortBy);
    if (estado.sortDir !== 'desc') parametros.set('sort_dir', estado.sortDir);
    return `/automatizacion/enlaces${parametros.size ? `?${parametros}` : ''}`;
  }

  function urlConRetorno(url) {
    if (!url) return '';
    const destino = new URL(url, window.location.origin);
    destino.searchParams.set('return_to', rutaListadoActual());
    return `${destino.pathname}${destino.search}${destino.hash}`;
  }

  function sincronizarFiltrosMovil() {
    if (!botonFiltrosMovil) return;
    const activos = Boolean(
      selectorTipo?.value || selectorActivo?.value !== 'todos' || selectorEvento?.value ||
      selectorPageSize?.value !== '10' || selectorTrigger?.value || selectorMonitor?.value ||
      selectorTenant?.value || selectorEmpresa?.value || selectorSortBy?.value !== 'actualizado' ||
      selectorSortDir?.value !== 'desc'
    );
    shell?.classList.toggle('vinculos-filtros-movil--abiertos', activos);
    botonFiltrosMovil.setAttribute('aria-expanded', activos ? 'true' : 'false');
  }

  const estado = {
    q: inputBusqueda?.value.trim() || '',
    triggerId: selectorTrigger?.value || '',
    monitorId: selectorMonitor?.value || '',
    tenantId: selectorTenant?.value || '',
    empresaId: selectorEmpresa?.value || '',
    tipo: selectorTipo?.value || '',
    activo: selectorActivo?.value || 'todos',
    evento: selectorEvento?.value || '',
    page: 1,
    pageSize: Number(selectorPageSize?.value || 10),
    sortBy: selectorSortBy?.value || 'actualizado',
    sortDir: selectorSortDir?.value || 'desc',
    totalPaginas: 1
  };

  function reconstruirEmpresas() {
    if (!selectorEmpresa) {
      return;
    }

    const seleccionActual = selectorEmpresa.value;
    const tenantId = selectorTenant?.value || '';
    selectorEmpresa.innerHTML = '<option value="">Todas</option>';

    for (const opcion of opcionesEmpresa) {
      if (!opcion.value) {
        continue;
      }

      if (!tenantId || opcion.dataset.tenantId === tenantId) {
        selectorEmpresa.appendChild(opcion.cloneNode(true));
      }
    }

    if (
      Array.from(selectorEmpresa.options).some(
        (opcion) => opcion.value === seleccionActual
      )
    ) {
      selectorEmpresa.value = seleccionActual;
    }
  }

  function aplicarEstadoDesdeControles({ resetearPagina = false } = {}) {
    estado.q = inputBusqueda?.value.trim() || '';
    estado.triggerId = selectorTrigger?.value || '';
    estado.monitorId = selectorMonitor?.value || '';
    estado.tenantId = selectorTenant?.value || '';
    estado.empresaId = selectorEmpresa?.value || '';
    estado.tipo = selectorTipo?.value || '';
    estado.activo = selectorActivo?.value || 'todos';
    estado.evento = selectorEvento?.value || '';
    estado.pageSize = Number(selectorPageSize?.value || 10);
    estado.sortBy = selectorSortBy?.value || 'actualizado';
    estado.sortDir = selectorSortDir?.value || 'desc';

    if (resetearPagina) {
      estado.page = 1;
    }
  }

  function construirQuery() {
    const parametros = new URLSearchParams();
    parametros.set('q', estado.q);
    parametros.set('trigger_id', estado.triggerId);
    parametros.set('monitor_id', estado.monitorId);
    parametros.set('tenant_id', estado.tenantId);
    parametros.set('empresa_id', estado.empresaId);
    parametros.set('tipo', estado.tipo);
    parametros.set('activo', estado.activo);
    parametros.set('evento_disparo', estado.evento);
    parametros.set('page', String(estado.page));
    parametros.set('page_size', String(estado.pageSize));
    parametros.set('sort_by', estado.sortBy);
    parametros.set('sort_dir', estado.sortDir);
    return parametros.toString();
  }

  function actualizarResumen(datos) {
    const { resumen, paginacion } = datos;

    if (kpiTotal) {
      kpiTotal.textContent = String(resumen.totalAsignaciones || 0);
    }

    if (kpiActivos) {
      const activos = Number(resumen.totalActivas || 0);
      const inactivos = Number(resumen.totalInactivas || 0);
      kpiActivos.textContent = `${activos} ${activos === 1 ? 'activo' : 'activos'} · ${inactivos} ${inactivos === 1 ? 'inactivo' : 'inactivos'}.`;
    }

    if (kpiAcciones) {
      kpiAcciones.textContent = String(resumen.totalTriggers || 0);
    }

    if (kpiMonitores) {
      const monitores = Number(resumen.totalMonitores || 0);
      kpiMonitores.textContent = `${monitores} ${monitores === 1 ? 'monitor enlazado' : 'monitores enlazados'}.`;
    }

    if (resumenListado) {
      resumenListado.textContent =
        paginacion.totalFiltrado > 0
          ? `Mostrando ${paginacion.desde}-${paginacion.hasta} de ${paginacion.totalFiltrado} enlaces filtrados.`
          : '';
    }

    if (etiquetaPaginaActual) {
      etiquetaPaginaActual.textContent =
        `Página ${paginacion.pagina} de ${paginacion.totalPaginas}`;
    }
  }

  function actualizarPaginacionVisual() {
    for (const boton of botonesPaginacion) {
      const accion = boton.dataset.vinculosPageAction;
      let disabled = false;

      if (accion === 'first' || accion === 'prev') {
        disabled = estado.page <= 1;
      }

      if (accion === 'next' || accion === 'last') {
        disabled = estado.page >= estado.totalPaginas;
      }

      boton.disabled = disabled;
    }
  }

  function actualizarFiltrosRapidosVisuales() {
    const filtroActivo = resolverFiltroRapidoActivo();

    for (const boton of botonesFiltroRapido) {
      const activo = boton.dataset.vinculosFiltroRapido === filtroActivo;
      boton.classList.toggle('is-active', activo);
      boton.setAttribute('aria-pressed', activo ? 'true' : 'false');
    }
  }

  function resolverFiltroRapidoActivo() {
    if (hayFiltrosAvanzadosActivos()) {
      return '';
    }

    if (estado.evento === 'apertura_alerta' && !estado.tipo && estado.activo === 'todos') {
      return 'apertura_alerta';
    }

    if (estado.evento === 'cierre_alerta' && !estado.tipo && estado.activo === 'todos') {
      return 'cierre_alerta';
    }

    if (estado.tipo === 'dns' && estado.activo === 'todos' && !estado.evento) {
      return 'dns';
    }

    if (estado.tipo === 'api' && estado.activo === 'todos' && !estado.evento) {
      return 'api';
    }

    if (estado.tipo === 'correo' && estado.activo === 'todos' && !estado.evento) {
      return 'correo';
    }

    if (estado.activo === 'solo_activos' && !estado.tipo && !estado.evento) {
      return 'activos';
    }

    if (estado.activo === 'solo_inactivos' && !estado.tipo && !estado.evento) {
      return 'inactivos';
    }

    if (!estado.tipo && estado.activo === 'todos' && !estado.evento) {
      return 'todos';
    }

    return '';
  }

  function hayFiltrosAvanzadosActivos() {
    return Boolean(
      estado.triggerId ||
      estado.monitorId ||
      estado.tenantId ||
      estado.empresaId ||
      estado.sortBy !== 'actualizado' ||
      estado.sortDir !== 'desc'
    );
  }

  function resolverIconoTipoVinculo(tipo) {
    const normalizado = String(tipo || '').trim().toLowerCase();

    if (normalizado === 'dns') {
      return 'bi-globe2';
    }

    if (normalizado === 'api') {
      return 'bi-send-check';
    }

    if (normalizado === 'correo') {
      return 'bi-envelope-at';
    }

    return 'bi-lightning-charge';
  }

  function describirEventosDisparo(eventosDisparo) {
    return (eventosDisparo || []).map((evento) => ({
      apertura_alerta: 'Apertura de alerta',
      cierre_alerta: 'Cierre de alerta'
    })[evento] || evento).join(', ') || 'Sin evento configurado';
  }

  function abrirModalEliminarVinculo(boton) {
    const item = asignacionesPorId.get(String(boton.dataset.vinculosEliminar));
    if (!item || !modalEliminarVinculoNodo || !window.bootstrap?.Modal) return;

    const botonMenu = boton.closest('.organizacion-acciones')
      ?.querySelector('[data-bs-toggle="dropdown"]') ||
      modulo.querySelector('.organizacion-acciones-toggle[aria-expanded="true"]');
    if (botonMenu && window.bootstrap.Dropdown) {
      window.bootstrap.Dropdown.getOrCreateInstance(botonMenu).hide();
    }

    nombreMonitorEliminar.textContent = item.monitorNombre || `Monitor #${item.monitorId}`;
    nombreAccionEliminar.textContent = item.triggerVisible === false
      ? 'Acción oculta por alcance'
      : (item.triggerNombre || `Acción #${item.triggerId}`);
    eventoEliminar.textContent = describirEventosDisparo(item.eventosDisparo);
    idEliminar.value = String(item.id);
    retornoEliminar.value = rutaListadoActual();
    botonEliminarOrigen = botonMenu;
    window.bootstrap.Modal.getOrCreateInstance(modalEliminarVinculoNodo).show();
  }

  function renderizarFilas(asignaciones) {
    asignacionesPorId.clear();
    for (const item of asignaciones) {
      asignacionesPorId.set(String(item.id), item);
    }

    if (!asignaciones.length) {
      contenedorFilas.innerHTML = `
        <tr>
          <td colspan="6" class="text-body-secondary">
            <div class="triggers-tabla__vacio">
              <span class="organizacion-entidad__icono" aria-hidden="true">
                <i class="bi bi-link-45deg"></i>
              </span>
              <div>
                <strong>No hay enlaces con el filtro actual.</strong>
                <p class="mb-0 texto-apoyo">Limpia filtros o crea un enlace entre un monitor y una acción.</p>
              </div>
              <div class="triggers-tabla__vacio-acciones">
                <button type="button" class="btn btn-outline-secondary btn-sm" data-vinculos-limpiar-vacio>
                  Limpiar filtros
                </button>
                ${puedeGestionarVinculos
                  ? `<a href="/monitores/triggers/vinculos/nuevo" class="btn btn-primary btn-sm">
                       Nuevo enlace
                     </a>`
                  : ''}
              </div>
            </div>
          </td>
        </tr>
      `;
      return;
    }

    contenedorFilas.innerHTML = asignaciones
      .map((item) => {
        const tipo = String(item.triggerTipo || 'api').toUpperCase();
        const eventos = describirEventosDisparo(item.eventosDisparo);
        const triggerOculto = item.triggerVisible === false;
        const urlMonitor = urlConRetorno(item.urls.detalleMonitor);
        const urlAccion = !triggerOculto && puedeEditarTriggers
          ? urlConRetorno(item.urls.editarTrigger)
          : '';
        const urlEnlace = urlConRetorno(item.urls.editarVinculo);

        return `
          <tr>
            <td>
              <div class="organizacion-entidad">
                <a class="organizacion-entidad__titulo organizacion-entidad__titulo--enlace" href="${escapeHtml(urlMonitor)}" title="Abrir monitor: ${escapeHtml(item.monitorNombre || `Monitor #${item.monitorId}`)}">
                  <span class="organizacion-entidad__icono" aria-hidden="true">
                    <i class="bi bi-broadcast-pin"></i>
                  </span>
                  <span>${escapeHtml(item.monitorNombre || `Monitor #${item.monitorId}`)}</span>
                </a>
                <span class="organizacion-entidad__meta">
                  <span>ID técnica #${escapeHtml(item.monitorId)}</span>
                  <span class="organizacion-meta-separador" aria-hidden="true">•</span>
                  <span>${escapeHtml(item.empresaNombre || '-')}</span>
                  ${item.sitioNombre ? `<span class="organizacion-meta-separador" aria-hidden="true">•</span><span>${escapeHtml(item.sitioNombre)}</span>` : ''}
                </span>
                ${(puedeGestionarVinculos && item.puedeGestionarVinculo && urlEnlace)
                  ? `<a class="vinculos-tabla__editar-movil" href="${escapeHtml(urlEnlace)}"><i class="bi bi-pencil-square" aria-hidden="true"></i>Gestionar enlace</a>`
                  : ''}
              </div>
            </td>
            <td>
              <div class="vinculos-tabla__trigger">
                <span class="insignia-monitor ${triggerOculto ? 'insignia-monitor--suave' : `insignia-monitor--${escapeHtml(item.triggerTipo || 'api')}`} d-inline-flex align-items-center gap-1">
                  <i class="bi ${triggerOculto ? 'bi-eye-slash' : resolverIconoTipoVinculo(item.triggerTipo)}" aria-hidden="true"></i>
                  <span>${triggerOculto ? 'Oculto' : escapeHtml(tipo)}</span>
                </span>
                ${urlAccion
                  ? `<a class="vinculos-tabla__enlace-accion" href="${escapeHtml(urlAccion)}" title="Abrir acción: ${escapeHtml(item.triggerNombre || 'Acción sin nombre visible')}">${escapeHtml(item.triggerNombre || 'Acción sin nombre visible')}</a>`
                  : `<strong>${escapeHtml(triggerOculto ? 'Acción oculta por alcance' : (item.triggerNombre || 'Acción sin nombre visible'))}</strong>`}
                ${triggerOculto ? '<small>Fuera de tu alcance visible.</small>' : ''}
              </div>
            </td>
            <td>
              <div class="vinculos-tabla__ejecucion">
                <span class="insignia-monitor ${item.activo ? 'insignia-monitor--ok' : 'insignia-monitor--off'}">
                  ${item.activo ? 'Activa' : 'Inactiva'}
                </span>
                <span>${escapeHtml(eventos)}</span>
                <span>Orden de ejecución: ${escapeHtml(String(item.ordenEjecucion ?? 0))}</span>
                ${item.configuracionOverride ? '<span>Configuración propia</span>' : ''}
              </div>
            </td>
            <td>
              <span class="insignia-monitor insignia-monitor--suave">
                Tenant ${escapeHtml(item.tenantNombre || '-')}
              </span>
            </td>
            <td>
              <span class="organizacion-celda-fecha">
                <span>Creado:</span>
                <span>${escapeHtml(formatearFecha(item.fechaCreacion))}</span>
              </span>
              <span class="organizacion-celda-fecha">
                <span>Actualizado:</span>
                <span>${escapeHtml(formatearFecha(item.fechaActualizacion))}</span>
              </span>
            </td>
            <td class="text-center">
              ${(puedeGestionarVinculos && item.puedeGestionarVinculo && item.urls.editarVinculo)
                ? `<div class="dropup organizacion-acciones">
                    <button
                      type="button"
                      class="btn btn-outline-secondary btn-sm organizacion-acciones-toggle"
                      data-bs-toggle="dropdown"
                      data-bs-auto-close="outside"
                      aria-expanded="false"
                      aria-label="Acciones del vínculo"
                    >
                      <i class="bi bi-gear" aria-hidden="true"></i>
                    </button>
                    <div class="dropdown-menu dropdown-menu-end organizacion-acciones-menu">
                      <a href="${escapeHtml(urlMonitor)}" class="dropdown-item d-flex align-items-center gap-2">
                        <i class="bi bi-broadcast" aria-hidden="true"></i>
                        <span>Ver monitor</span>
                      </a>
                      ${(puedeEditarTriggers && !triggerOculto && item.urls.editarTrigger)
                        ? `<a href="${escapeHtml(urlAccion)}" class="dropdown-item d-flex align-items-center gap-2"><i class="bi bi-lightning-charge" aria-hidden="true"></i><span>Ver acción</span></a>`
                        : ''}
                      <a href="${escapeHtml(urlEnlace)}" class="dropdown-item d-flex align-items-center gap-2"><i class="bi bi-pencil-square" aria-hidden="true"></i><span>Gestionar enlace</span></a>
                      <button type="button" class="dropdown-item dropdown-item--danger d-flex align-items-center gap-2" data-vinculos-eliminar="${escapeHtml(String(item.id))}"><i class="bi bi-trash3" aria-hidden="true"></i><span>Eliminar enlace…</span></button>
                    </div>
                  </div>`
                : `<div class="vinculos-tabla__sin-acciones">
                    <span class="insignia-monitor insignia-monitor--suave">Sin acciones</span>
                    <small>${puedeGestionarVinculos ? 'Fuera de alcance' : 'Solo lectura'}</small>
                  </div>`}
            </td>
          </tr>
        `;
      })
      .join('');
  }

  async function cargar() {
    contenedorFilas.innerHTML = `
      <tr>
        <td colspan="6" class="text-body-secondary">
          <div class="py-3 d-inline-flex align-items-center gap-2">
            <i class="bi bi-arrow-repeat" aria-hidden="true"></i>
              <span>Cargando enlaces...</span>
          </div>
        </td>
      </tr>
    `;

    try {
      const datos = await fetchJson(`${urlVinculos}?${construirQuery()}`);
      estado.totalPaginas = datos.paginacion.totalPaginas;
      renderizarFilas(datos.asignaciones || []);
      actualizarResumen(datos);
      actualizarPaginacionVisual();
      actualizarFiltrosRapidosVisuales();
    } catch (error) {
      contenedorFilas.innerHTML = `
        <tr>
          <td colspan="6" class="text-danger">
            <div class="py-3 d-inline-flex align-items-center gap-2">
              <i class="bi bi-exclamation-triangle" aria-hidden="true"></i>
              <span>${escapeHtml(error.message || 'No se pudieron cargar los enlaces.')}</span>
            </div>
          </td>
        </tr>
      `;
      window.portalToast?.show({
        tipo: 'error',
        titulo: 'No se pudieron cargar los enlaces',
        cuerpo: error.message
      });
    }
  }

  function programarCarga() {
    window.clearTimeout(temporizadorBusqueda);
    temporizadorBusqueda = window.setTimeout(async function () {
      aplicarEstadoDesdeControles({ resetearPagina: true });
      await cargar();
    }, 240);
  }

  async function limpiarFiltros() {
    if (inputBusqueda) inputBusqueda.value = '';
    if (selectorTrigger) selectorTrigger.value = '';
    if (selectorMonitor) selectorMonitor.value = '';
    if (selectorTenant) selectorTenant.value = '';
    reconstruirEmpresas();
    if (selectorEmpresa) selectorEmpresa.value = '';
    if (selectorTipo) selectorTipo.value = '';
    if (selectorActivo) selectorActivo.value = 'todos';
    if (selectorEvento) selectorEvento.value = '';
    if (selectorPageSize) selectorPageSize.value = '10';
    if (selectorSortBy) selectorSortBy.value = 'actualizado';
    if (selectorSortDir) selectorSortDir.value = 'desc';
    aplicarEstadoDesdeControles({ resetearPagina: true });
    await cargar();
  }

  async function aplicarFiltroRapido(filtro) {
    if (inputBusqueda) inputBusqueda.value = '';
    if (selectorTrigger) selectorTrigger.value = '';
    if (selectorMonitor) selectorMonitor.value = '';
    if (selectorTenant) selectorTenant.value = '';
    reconstruirEmpresas();
    if (selectorEmpresa) selectorEmpresa.value = '';
    if (selectorTipo) selectorTipo.value = '';
    if (selectorActivo) selectorActivo.value = 'todos';
    if (selectorEvento) selectorEvento.value = '';

    if (filtro === 'activos' && selectorActivo) {
      selectorActivo.value = 'solo_activos';
    } else if (filtro === 'inactivos' && selectorActivo) {
      selectorActivo.value = 'solo_inactivos';
    } else if (selectorTipo &&
        Array.from(selectorTipo.options).some((opcion) => opcion.value === filtro)) {
      selectorTipo.value = filtro;
    } else if (
      (filtro === 'apertura_alerta' || filtro === 'cierre_alerta') &&
      selectorEvento
    ) {
      selectorEvento.value = filtro;
    }

    aplicarEstadoDesdeControles({ resetearPagina: true });
    await cargar();
  }

  inputBusqueda?.addEventListener('input', programarCarga);
  selectorTrigger?.addEventListener('input', programarCarga);
  selectorMonitor?.addEventListener('input', programarCarga);
  selectorTrigger?.addEventListener('change', async function () {
    aplicarEstadoDesdeControles({ resetearPagina: true });
    await cargar();
  });
  selectorMonitor?.addEventListener('change', async function () {
    aplicarEstadoDesdeControles({ resetearPagina: true });
    await cargar();
  });
  selectorTenant?.addEventListener('change', async function () {
    reconstruirEmpresas();
    aplicarEstadoDesdeControles({ resetearPagina: true });
    await cargar();
  });
  selectorEmpresa?.addEventListener('change', async function () {
    aplicarEstadoDesdeControles({ resetearPagina: true });
    await cargar();
  });
  selectorTipo?.addEventListener('change', async function () {
    aplicarEstadoDesdeControles({ resetearPagina: true });
    await cargar();
  });
  selectorActivo?.addEventListener('change', async function () {
    aplicarEstadoDesdeControles({ resetearPagina: true });
    await cargar();
  });
  selectorEvento?.addEventListener('change', async function () {
    aplicarEstadoDesdeControles({ resetearPagina: true });
    await cargar();
  });
  selectorPageSize?.addEventListener('change', async function () {
    aplicarEstadoDesdeControles({ resetearPagina: true });
    await cargar();
  });
  selectorSortBy?.addEventListener('change', async function () {
    aplicarEstadoDesdeControles({ resetearPagina: true });
    await cargar();
  });
  selectorSortDir?.addEventListener('change', async function () {
    aplicarEstadoDesdeControles({ resetearPagina: true });
    await cargar();
  });
  botonAplicar?.addEventListener('click', async function () {
    aplicarEstadoDesdeControles({ resetearPagina: true });
    await cargar();
  });
  botonLimpiar?.addEventListener('click', async function () {
    await limpiarFiltros();
  });
  botonFiltrosMovil?.addEventListener('click', function () {
    const abierto = shell?.classList.toggle('vinculos-filtros-movil--abiertos');
    botonFiltrosMovil.setAttribute('aria-expanded', abierto ? 'true' : 'false');
  });

  for (const boton of botonesFiltroRapido) {
    boton.addEventListener('click', async function () {
      await aplicarFiltroRapido(boton.dataset.vinculosFiltroRapido || 'todos');
    });
  }

  modulo.addEventListener('click', async function (evento) {
    const botonLimpiarVacio = evento.target.closest('[data-vinculos-limpiar-vacio]');

    if (botonLimpiarVacio) {
      await limpiarFiltros();
    }
  });

  // En móvil, portal.js mueve el menú de la tabla al body para evitar recortes.
  document.addEventListener('click', function (evento) {
    const objetivo = evento.target instanceof Element ? evento.target : null;
    const botonEliminar = objetivo?.closest('[data-vinculos-eliminar]');
    if (!botonEliminar || !asignacionesPorId.has(String(botonEliminar.dataset.vinculosEliminar))) {
      return;
    }

    if (
      modulo.contains(botonEliminar) ||
      botonEliminar.closest('.organizacion-acciones-menu.dropdown-menu--flotante-tabla')
    ) {
      abrirModalEliminarVinculo(botonEliminar);
    }
  });

  modalEliminarVinculoNodo?.addEventListener('hidden.bs.modal', function () {
    if (botonEliminarOrigen?.isConnected) botonEliminarOrigen.focus();
    botonEliminarOrigen = null;
  });

  for (const boton of botonesPaginacion) {
    boton.addEventListener('click', async function () {
      const accion = boton.dataset.vinculosPageAction;

      if (accion === 'first') estado.page = 1;
      if (accion === 'prev') estado.page = Math.max(1, estado.page - 1);
      if (accion === 'next') estado.page = Math.min(estado.totalPaginas, estado.page + 1);
      if (accion === 'last') estado.page = estado.totalPaginas;

      await cargar();
    });
  }

  reconstruirEmpresas();
  sincronizarFiltrosMovil();
  cargar();
}

async function fetchJson(url, options = {}) {
  const respuesta = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      ...(options.headers || {})
    },
    ...options
  });
  const datos = await respuesta.json().catch(() => ({}));

  if (!respuesta.ok || datos.ok === false) {
    throw new Error(datos.mensaje || 'La operación AJAX no se pudo completar.');
  }

  return datos;
}

function escapeHtml(valor) {
  return String(valor ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatearFecha(valor) {
  if (!valor) {
    return '-';
  }

  if (window.portalFechas?.formatear) {
    const renderizada = window.portalFechas.formatear(valor);

    if (renderizada) {
      return renderizada;
    }
  }

  const fecha = new Date(valor);
  return Number.isNaN(fecha.getTime())
    ? String(valor)
    : fecha.toLocaleString('es-ES');
}
