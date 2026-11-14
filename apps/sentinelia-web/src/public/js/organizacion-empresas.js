(function () {
  const modulo = document.querySelector('[data-empresas-lista]');

  if (!modulo) {
    return;
  }

  inicializarListadoEmpresas(modulo);
})();

function inicializarListadoEmpresas(modulo) {
  const urlListado = modulo.dataset.urlListado;
  const eliminacionDurable = modulo.dataset.eliminacionDurable === 'true';
  const urlPantalla = window.location.pathname;
  const mensajeVacio = String(modulo.dataset.emptyMessage || '').trim()
    || 'No hay empresas visibles con el filtro actual.';
  const tenantIdContexto = String(modulo.dataset.tenantId || '').trim();
  const tenantContextLocked = modulo.dataset.tenantContextLocked === 'true';
  const inputBusqueda = modulo.querySelector('[data-empresas-busqueda]');
  const selectorPageSize = modulo.querySelector('[data-empresas-page-size]');
  const botonLimpiar = modulo.querySelector('[data-empresas-limpiar]');
  const contenedorFilas = modulo.querySelector('[data-empresas-filas]');
  const resumenListado = modulo.querySelector('[data-empresas-resumen-listado]');
  const etiquetaPaginaActual = modulo.querySelector('[data-empresas-pagina-actual]');
  const botonesOrden = Array.from(modulo.querySelectorAll('[data-sort-by]'));
  const botonesPaginacion = Array.from(
    modulo.querySelectorAll('[data-page-action]')
  );

  let temporizadorBusqueda = null;
  let temporizadorRedimension = null;
  const tooltipsDescripcion = new Set();
  const estado = {
    q: inputBusqueda?.value.trim() || '',
    tenantId: tenantIdContexto || '',
    page: 1,
    pageSize: Number(selectorPageSize?.value || 25),
    sortBy: 'nombre',
    sortDir: 'asc',
    totalPaginas: 1
  };

  hidratarEstadoDesdeUrl();
  aplicarEstadoAControles();

  function mensajeVacioActual() {
    return estado.q
      ? 'No hay empresas que coincidan con la búsqueda.'
      : mensajeVacio;
  }

  function aplicarEstadoDesdeControles({ resetearPagina = false } = {}) {
    estado.q = inputBusqueda?.value.trim() || '';
    estado.pageSize = Number(selectorPageSize?.value || 25);

    if (resetearPagina) {
      estado.page = 1;
    }
  }

  function hidratarEstadoDesdeUrl() {
    const parametros = new URLSearchParams(window.location.search);
    const q = String(parametros.get('q') || '').trim();
    const tenantId = String(parametros.get('tenant_id') || tenantIdContexto || '').trim();
    const page = Number(parametros.get('page') || 1);
    const pageSize = Number(parametros.get('page_size') || estado.pageSize);
    const sortBy = String(parametros.get('sort_by') || estado.sortBy).trim();
    const sortDir = String(parametros.get('sort_dir') || estado.sortDir).trim();

    estado.q = q;
    estado.tenantId = tenantId;
    estado.page = Number.isInteger(page) && page > 0 ? page : 1;
    estado.pageSize = [10, 25, 50, 100].includes(pageSize)
      ? pageSize
      : 25;
    estado.sortBy = normalizarSortBy(sortBy);
    estado.sortDir = sortDir === 'desc' ? 'desc' : 'asc';
  }

  function aplicarEstadoAControles() {
    if (inputBusqueda) {
      inputBusqueda.value = estado.q;
    }

    if (selectorPageSize) {
      selectorPageSize.value = String(estado.pageSize);
    }

    sincronizarBotonLimpiar();
  }

  function sincronizarBotonLimpiar() {
    if (botonLimpiar) {
      botonLimpiar.disabled = !estado.q;
    }
  }

  function sincronizarUrl({ replace = false } = {}) {
    const parametros = new URLSearchParams();

    if (estado.q) {
      parametros.set('q', estado.q);
    }

    if (estado.tenantId) {
      parametros.set('tenant_id', estado.tenantId);
    }

    if (estado.page > 1) {
      parametros.set('page', String(estado.page));
    }

    if (estado.pageSize !== 25) {
      parametros.set('page_size', String(estado.pageSize));
    }

    if (estado.sortBy !== 'nombre') {
      parametros.set('sort_by', estado.sortBy);
    }

    if (estado.sortDir !== 'asc') {
      parametros.set('sort_dir', estado.sortDir);
    }

    const destino = parametros.toString()
      ? `${urlPantalla}?${parametros.toString()}`
      : urlPantalla;

    const metodo = replace ? 'replaceState' : 'pushState';
    window.history[metodo](
      {
        empresasListado: {
          q: estado.q,
          tenantId: estado.tenantId,
          page: estado.page,
          pageSize: estado.pageSize,
          sortBy: estado.sortBy,
          sortDir: estado.sortDir
        }
      },
      '',
      destino
    );
  }

  function construirQuery() {
    const parametros = new URLSearchParams();
    parametros.set('q', estado.q);
    if (estado.tenantId) {
      parametros.set('tenant_id', estado.tenantId);
    }
    parametros.set('page', String(estado.page));
    parametros.set('page_size', String(estado.pageSize));
    parametros.set('sort_by', estado.sortBy);
    parametros.set('sort_dir', estado.sortDir);
    return parametros.toString();
  }

  function actualizarOrdenVisual() {
    for (const boton of botonesOrden) {
      const activo = boton.dataset.sortBy === estado.sortBy;
      boton.classList.toggle('activo', activo);

      if (!activo) {
        boton.dataset.sortDir = '';
        continue;
      }

      boton.dataset.sortDir = estado.sortDir;
    }
  }

  function actualizarPaginacionVisual() {
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
  }

  function actualizarResumen(datos) {
    const paginacion = datos.paginacion || {};
    const totalFiltrado = Number(paginacion.totalFiltrado || 0);
    const pagina = Number(paginacion.pagina || 1);
    const tamanoPagina = Number(paginacion.tamanoPagina || estado.pageSize || 25);
    const desde = totalFiltrado === 0 ? 0 : ((pagina - 1) * tamanoPagina) + 1;
    const hasta = totalFiltrado === 0
      ? 0
      : Math.min(totalFiltrado, desde + tamanoPagina - 1);

    if (resumenListado) {
      const totalTexto = `${totalFiltrado} ${totalFiltrado === 1 ? 'empresa' : 'empresas'}`;
      if (totalFiltrado === 0) {
        resumenListado.textContent = mensajeVacioActual();
      } else if (estado.q) {
        resumenListado.textContent =
          `Mostrando ${desde}-${hasta} de ${totalTexto} que coinciden con la búsqueda.`;
      } else if (desde === 1 && hasta === totalFiltrado) {
        resumenListado.textContent = `${totalTexto}.`;
      } else {
        resumenListado.textContent = `Mostrando ${desde}-${hasta} de ${totalTexto}.`;
      }
    }

    if (etiquetaPaginaActual) {
      etiquetaPaginaActual.textContent =
        `Página ${pagina} de ${paginacion.totalPaginas || 1}`;
    }
  }

  function renderizarFilas(filas) {
    destruirTooltipsDescripcion();

    if (!filas.length) {
      contenedorFilas.innerHTML = `
        <tr>
          <td colspan="9" class="text-body-secondary">
            <div class="py-3 d-inline-flex align-items-center gap-2">
              <i class="bi bi-inbox" aria-hidden="true"></i>
              <span>${escapeHtml(mensajeVacioActual())}</span>
            </div>
          </td>
        </tr>
      `;
      return;
    }

    contenedorFilas.innerHTML = filas
      .map(
        (item) => `
          <tr>
            <td>
              <span class="organizacion-id">#${escapeHtml(item.id)}</span>
            </td>
            <td>
              ${tenantContextLocked
                ? `<span class="organizacion-entidad__meta">
                    <i class="bi bi-diagram-3" aria-hidden="true"></i>
                    <span class="tabla-texto-truncable" title="${escapeHtml(item.tenantNombre || '-')}">${escapeHtml(item.tenantNombre || '-')}</span>
                  </span>`
                : `<a
                    href="/organizacion/empresas?tenant_id=${encodeURIComponent(item.tenantId)}"
                    class="organizacion-entidad__meta organizacion-entidad__meta--enlace"
                    title="Ver empresas del tenant ${escapeHtml(item.tenantNombre || '-')}"
                  >
                    <i class="bi bi-diagram-3" aria-hidden="true"></i>
                    <span class="tabla-texto-truncable" title="${escapeHtml(item.tenantNombre || '-')}">${escapeHtml(item.tenantNombre || '-')}</span>
                  </a>`}
            </td>
            <td>
              <div class="organizacion-entidad">
                ${item.puedeEditar
                  ? `<a
                      href="/organizacion/empresas/${encodeURIComponent(item.id)}/editar"
                      class="organizacion-entidad__titulo organizacion-entidad__titulo--enlace"
                      aria-label="Gestionar empresa ${escapeHtml(item.nombre)}"
                    >
                      <span class="organizacion-entidad__icono" aria-hidden="true">
                        <i class="bi bi-buildings"></i>
                      </span>
                      <span title="${escapeHtml(item.nombre)}">${escapeHtml(item.nombre)}</span>
                      <i class="bi bi-chevron-right organizacion-entidad__enlace-indicador" aria-hidden="true"></i>
                    </a>`
                  : `<span class="organizacion-entidad__titulo">
                      <span class="organizacion-entidad__icono" aria-hidden="true">
                        <i class="bi bi-buildings"></i>
                      </span>
                      <span title="${escapeHtml(item.nombre)}">${escapeHtml(item.nombre)}</span>
                    </span>`}
                <span
                  class="organizacion-entidad__meta organizacion-descripcion organizacion-descripcion--una-linea"
                  data-empresa-descripcion
                >
                  ${escapeHtml(item.descripcion || 'Sin descripción')}
                </span>
              </div>
            </td>
            <td>
              <span class="text-body-secondary tabla-texto-truncable" title="${escapeHtml(item.alias || '-')}">${escapeHtml(item.alias || '-')}</span>
            </td>
            <td>
              <span class="text-body-secondary">${escapeHtml(item.cif || '-')}</span>
            </td>
            <td>
              <span class="badge rounded-pill ${item.estado === 'activo' ? 'text-bg-success' : 'text-bg-secondary'}">
                ${escapeHtml(formatearEstado(item.estado))}
              </span>
            </td>
            <td>
              <a
                href="/organizacion/sitios?tenant_id=${encodeURIComponent(item.tenantId)}&empresa_id=${encodeURIComponent(item.id)}"
                class="organizacion-contador"
                title="Ver sitios de la empresa ${escapeHtml(item.nombre)}"
              >
                <i class="bi bi-geo-alt" aria-hidden="true"></i>
                <span>${escapeHtml(item.totalSitios || 0)}</span>
              </a>
            </td>
            <td>
              <span
                class="organizacion-celda-fecha"
                title="${escapeHtml(formatearFechaExacta(item.fechaActualizacion))}"
              >
                <i class="bi bi-clock-history" aria-hidden="true"></i>
                <span>${escapeHtml(formatearFechaCorta(item.fechaActualizacion))}</span>
              </span>
            </td>
            <td class="text-center organizacion-columna--acciones">
              <div class="dropup organizacion-acciones">
                <button
                  type="button"
                  class="btn btn-outline-secondary btn-sm organizacion-acciones-toggle"
                  data-bs-toggle="dropdown"
                  data-bs-auto-close="true"
                  aria-expanded="false"
                  aria-label="Acciones de ${escapeHtml(item.nombre)}"
                >
                  <i class="bi bi-gear" aria-hidden="true"></i>
                </button>
                <div class="dropdown-menu dropdown-menu-end organizacion-acciones-menu">
                  ${item.puedeEditar
                    ? `<a href="/organizacion/empresas/${encodeURIComponent(item.id)}/editar" class="dropdown-item d-flex align-items-center gap-2"><i class="bi bi-sliders" aria-hidden="true"></i><span>Gestionar empresa</span></a>`
                    : `<button type="button" class="dropdown-item d-flex align-items-center gap-2" disabled><i class="bi bi-sliders" aria-hidden="true"></i><span>Gestionar empresa</span></button>`}
                  <form
                    method="post"
                    action="/api/organizacion/empresa/${encodeURIComponent(item.id)}/eliminacion"
                    data-organizacion-eliminar-form
                    data-organizacion-durable="true"
                    data-organizacion-tipo="empresa"
                    data-organizacion-entidad="Empresa"
                    data-organizacion-id="${escapeHtml(item.id)}"
                    data-organizacion-nombre="${escapeHtml(item.nombre)}"
                    data-organizacion-detalle="#${escapeHtml(item.id)} · ${escapeHtml(item.alias || '-')} · Tenant ${escapeHtml(item.tenantNombre || '-')}"
                    data-organizacion-url-impacto="/api/organizacion/empresa/${encodeURIComponent(item.id)}/eliminacion"
                  >
                    <input type="hidden" name="id" value="${escapeHtml(item.id)}">
                    <button
                      type="submit"
                      class="dropdown-item dropdown-item--danger d-flex align-items-center gap-2"
                      ${eliminacionDurable && item.puedeEliminar ? '' : 'disabled'}
                    >
                      <i class="bi bi-trash3" aria-hidden="true"></i>
                      <span>Eliminar…</span>
                    </button>
                  </form>
                </div>
              </div>
            </td>
          </tr>
        `
      )
      .join('');

    window.requestAnimationFrame(actualizarTooltipsDescripciones);
  }

  function destruirTooltipsDescripcion() {
    for (const tooltip of tooltipsDescripcion) {
      tooltip.dispose();
    }
    tooltipsDescripcion.clear();
  }

  function actualizarTooltipsDescripciones() {
    destruirTooltipsDescripcion();

    for (const descripcion of modulo.querySelectorAll('[data-empresa-descripcion]')) {
      descripcion.removeAttribute('data-bs-toggle');
      descripcion.removeAttribute('data-bs-trigger');
      descripcion.removeAttribute('data-bs-placement');
      descripcion.removeAttribute('data-bs-custom-class');
      descripcion.removeAttribute('data-bs-title');
      descripcion.removeAttribute('title');
      descripcion.removeAttribute('tabindex');

      const truncada =
        descripcion.scrollHeight > descripcion.clientHeight + 1 ||
        descripcion.scrollWidth > descripcion.clientWidth + 1;
      if (!truncada) continue;

      const textoCompleto = descripcion.textContent.trim();
      descripcion.dataset.bsToggle = 'tooltip';
      descripcion.dataset.bsTrigger = 'hover focus click';
      descripcion.dataset.bsPlacement = 'top';
      descripcion.dataset.bsCustomClass = 'tooltip-descripcion-organizacion';
      descripcion.dataset.bsTitle = textoCompleto;
      descripcion.setAttribute('title', textoCompleto);
      descripcion.setAttribute('tabindex', '0');

      if (window.bootstrap?.Tooltip) {
        tooltipsDescripcion.add(new window.bootstrap.Tooltip(descripcion));
      }
    }
  }

  async function cargar() {
    destruirTooltipsDescripcion();
    contenedorFilas.innerHTML = `
      <tr>
        <td colspan="9" class="text-body-secondary">
          <div class="py-3 d-inline-flex align-items-center gap-2">
            <i class="bi bi-arrow-repeat" aria-hidden="true"></i>
            <span>Cargando empresas...</span>
          </div>
        </td>
      </tr>
    `;

    try {
      const respuesta = await fetch(`${urlListado}?${construirQuery()}`, {
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
          Accept: 'application/json'
        },
        credentials: 'same-origin'
      });
      const datos = await respuesta.json();

      if (!respuesta.ok || datos.ok === false) {
        throw new Error(datos.mensaje || 'No se pudo cargar el listado de empresas.');
      }

      estado.page = Number(datos.paginacion?.pagina || estado.page || 1);
      estado.totalPaginas = Number(datos.paginacion?.totalPaginas || 1);

      renderizarFilas(datos.filas || []);
      actualizarResumen(datos);
      actualizarOrdenVisual();
      actualizarPaginacionVisual();
      sincronizarBotonLimpiar();

      if (window.organizacionEliminacion?.refrescarFormularios) {
        window.organizacionEliminacion.refrescarFormularios();
      }
    } catch (error) {
      contenedorFilas.innerHTML = `
        <tr>
          <td colspan="9" class="text-danger">
            <div class="py-3 d-inline-flex align-items-center gap-2">
              <i class="bi bi-exclamation-triangle" aria-hidden="true"></i>
              <span>${escapeHtml(error.message || 'No se pudo cargar el listado.')}</span>
            </div>
          </td>
        </tr>
      `;
      if (window.portalToast?.error) {
        window.portalToast.error('Empresas', error.message || 'No se pudo cargar el listado de empresas.');
      }
    }
  }

  function normalizarSortBy(valor) {
    const columnasValidas = new Set([
      'id',
      'tenant',
      'nombre',
      'alias',
      'cif',
      'estado',
      'sitios',
      'actualizado'
    ]);
    return columnasValidas.has(valor) ? valor : 'nombre';
  }

  botonesOrden.forEach((boton) => {
    boton.addEventListener('click', () => {
      const sortBy = normalizarSortBy(boton.dataset.sortBy || '');

      if (estado.sortBy === sortBy) {
        estado.sortDir = estado.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        estado.sortBy = sortBy;
        estado.sortDir = 'asc';
      }

      estado.page = 1;
      sincronizarUrl();
      cargar();
    });
  });

  botonesPaginacion.forEach((boton) => {
    boton.addEventListener('click', () => {
      const accion = boton.dataset.pageAction;

      if (accion === 'first') {
        estado.page = 1;
      } else if (accion === 'prev' && estado.page > 1) {
        estado.page -= 1;
      } else if (accion === 'next' && estado.page < estado.totalPaginas) {
        estado.page += 1;
      } else if (accion === 'last') {
        estado.page = estado.totalPaginas;
      }

      sincronizarUrl();
      cargar();
    });
  });

  if (inputBusqueda) {
    inputBusqueda.addEventListener('input', () => {
      window.clearTimeout(temporizadorBusqueda);
      temporizadorBusqueda = window.setTimeout(() => {
        aplicarEstadoDesdeControles({ resetearPagina: true });
        sincronizarUrl({ replace: true });
        cargar();
      }, 220);
    });
  }

  if (selectorPageSize) {
    selectorPageSize.addEventListener('change', () => {
      aplicarEstadoDesdeControles({ resetearPagina: true });
      sincronizarUrl({ replace: true });
      cargar();
    });
  }

  if (botonLimpiar) {
    botonLimpiar.addEventListener('click', () => {
      estado.q = '';
      estado.tenantId = tenantIdContexto || estado.tenantId;
      estado.page = 1;
      estado.pageSize = 25;
      estado.sortBy = 'nombre';
      estado.sortDir = 'asc';
      aplicarEstadoAControles();
      sincronizarUrl();
      cargar();
    });
  }

  window.addEventListener('popstate', () => {
    hidratarEstadoDesdeUrl();
    aplicarEstadoAControles();
    cargar();
  });

  window.addEventListener('resize', () => {
    window.clearTimeout(temporizadorRedimension);
    temporizadorRedimension = window.setTimeout(
      actualizarTooltipsDescripciones,
      120
    );
  });

  document.addEventListener('organizacion:eliminacion-completada', (evento) => {
    const destino = evento?.detail?.redirectTo || null;

    if (destino && destino.startsWith(urlPantalla)) {
      estado.page = 1;
      sincronizarUrl({ replace: true });
      cargar();
    }
  });

  actualizarOrdenVisual();
  actualizarPaginacionVisual();
  cargar();
}

function formatearFechaCorta(valor) {
  if (!valor) {
    return '-';
  }

  const fecha = new Date(valor);

  if (Number.isNaN(fecha.getTime())) {
    return String(valor);
  }

  return new Intl.DateTimeFormat('es-ES', {
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(fecha);
}

function formatearFechaExacta(valor) {
  if (!valor) {
    return 'Fecha no disponible';
  }

  return window.portalFechas?.formatear?.(valor) || String(valor);
}

function formatearEstado(valor) {
  const estado = String(valor || '').trim();
  if (estado === 'activo') return 'Activa';
  if (estado === 'inactivo') return 'Inactiva';
  return estado ? `${estado.charAt(0).toUpperCase()}${estado.slice(1)}` : '-';
}

function escapeHtml(valor) {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
