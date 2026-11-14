(function () {
  const modulo = document.querySelector('[data-sitios-lista]');

  if (!modulo) {
    return;
  }

  inicializarListadoSitios(modulo);
})();

function inicializarListadoSitios(modulo) {
  const urlListado = modulo.dataset.urlListado;
  const eliminacionDurable = modulo.dataset.eliminacionDurable === 'true';
  const urlPantalla = window.location.pathname;
  const mensajeVacio = String(modulo.dataset.emptyMessage || '').trim()
    || 'No hay sitios visibles con el filtro actual.';
  const mensajeVacioFiltrado = String(modulo.dataset.emptyMessageFiltrado || '').trim()
    || 'No hay sitios que coincidan con la búsqueda actual.';
  const tenantIdContexto = String(modulo.dataset.tenantId || '').trim();
  const empresaIdContexto = String(modulo.dataset.empresaId || '').trim();
  const ocultarTenant = modulo.dataset.ocultarTenant === 'true';
  const ocultarEmpresa = modulo.dataset.ocultarEmpresa === 'true';
  const columnasTabla = Number(modulo.dataset.columnasTabla || 9);
  const puedeVerTenants = modulo.dataset.puedeVerTenants === 'true';
  const puedeVerEmpresas = modulo.dataset.puedeVerEmpresas === 'true';
  const inputBusqueda = modulo.querySelector('[data-sitios-busqueda]');
  const selectorPageSize = modulo.querySelector('[data-sitios-page-size]');
  const contenedorFilas = modulo.querySelector('[data-sitios-filas]');
  const resumenListado = modulo.querySelector('[data-sitios-resumen-listado]');
  const etiquetaPaginaActual = modulo.querySelector('[data-sitios-pagina-actual]');
  const botonesOrden = Array.from(modulo.querySelectorAll('[data-sort-by]'));
  const botonesPaginacion = Array.from(
    modulo.querySelectorAll('[data-page-action]')
  );

  let temporizadorBusqueda = null;
  const estado = {
    q: inputBusqueda?.value.trim() || '',
    tenantId: tenantIdContexto || '',
    empresaId: empresaIdContexto || '',
    page: 1,
    pageSize: Number(selectorPageSize?.value || 25),
    sortBy: 'nombre',
    sortDir: 'asc',
    totalPaginas: 1
  };

  hidratarEstadoDesdeUrl();
  aplicarEstadoAControles();

  function mensajeVacioActual() {
    return estado.q ? mensajeVacioFiltrado : mensajeVacio;
  }

  function aplicarEstadoDesdeControles({ resetearPagina = false } = {}) {
    estado.q = inputBusqueda?.value.trim() || '';

    if (resetearPagina) {
      estado.page = 1;
    }
  }

  function hidratarEstadoDesdeUrl() {
    const parametros = new URLSearchParams(window.location.search);
    const q = String(parametros.get('q') || '').trim();
    const tenantId = String(parametros.get('tenant_id') || tenantIdContexto || '').trim();
    const empresaId = String(parametros.get('empresa_id') || empresaIdContexto || '').trim();
    const page = Number(parametros.get('page') || 1);
    const pageSize = Number(parametros.get('page_size') || estado.pageSize);
    const sortBy = String(parametros.get('sort_by') || estado.sortBy).trim();
    const sortDir = String(parametros.get('sort_dir') || estado.sortDir).trim();

    estado.q = q;
    estado.tenantId = tenantId;
    estado.empresaId = empresaId;
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
  }

  function sincronizarUrl({ replace = false } = {}) {
    const parametros = new URLSearchParams();

    if (estado.q) {
      parametros.set('q', estado.q);
    }

    if (estado.tenantId) {
      parametros.set('tenant_id', estado.tenantId);
    }

    if (estado.empresaId) {
      parametros.set('empresa_id', estado.empresaId);
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
        sitiosListado: {
          q: estado.q,
          tenantId: estado.tenantId,
          empresaId: estado.empresaId,
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
    if (estado.empresaId) {
      parametros.set('empresa_id', estado.empresaId);
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
      resumenListado.parentElement.classList.toggle('d-none', totalFiltrado === 0);
      if (totalFiltrado > 0) {
        const totalTexto = `${totalFiltrado} ${totalFiltrado === 1 ? 'sitio' : 'sitios'}`;
        resumenListado.textContent = estado.q
          ? `Mostrando ${desde}-${hasta} de ${totalTexto} que coinciden con la búsqueda.`
          : desde === 1 && hasta === totalFiltrado
            ? `${totalTexto}.`
            : `Mostrando ${desde}-${hasta} de ${totalTexto}.`;
      } else {
        resumenListado.textContent = '';
      }
    }

    if (etiquetaPaginaActual) {
      etiquetaPaginaActual.textContent =
        `Página ${pagina} de ${paginacion.totalPaginas || 1}`;
    }
  }

  function renderizarFilas(filas) {
    if (!filas.length) {
      contenedorFilas.innerHTML = `
        <tr>
          <td colspan="${columnasTabla}" class="text-body-secondary">
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
            <td class="organizacion-columna--id">
              <span class="organizacion-id">#${escapeHtml(item.id)}</span>
            </td>
            ${ocultarTenant && ocultarEmpresa ? '' : celdaPertenencia(item)}
            <td class="organizacion-columna--nombre">
              <div class="organizacion-entidad">
                ${item.puedeEditar
                  ? `<a
                      href="/organizacion/sitios/${encodeURIComponent(item.id)}/editar"
                      class="organizacion-entidad__titulo organizacion-entidad__titulo--enlace"
                      aria-label="Gestionar sitio ${escapeHtml(item.nombre)}"
                    >
                      <span class="organizacion-entidad__icono" aria-hidden="true">
                        <i class="bi bi-geo-alt"></i>
                      </span>
                      <span title="${escapeHtml(item.nombre)}">${escapeHtml(item.nombre)}</span>
                      <i class="bi bi-chevron-right organizacion-entidad__enlace-indicador" aria-hidden="true"></i>
                    </a>`
                  : `<span class="organizacion-entidad__titulo">
                      <span class="organizacion-entidad__icono" aria-hidden="true">
                        <i class="bi bi-geo-alt"></i>
                      </span>
                      <span title="${escapeHtml(item.nombre)}">${escapeHtml(item.nombre)}</span>
                    </span>`}
                <span class="organizacion-entidad__meta organizacion-descripcion organizacion-descripcion--una-linea">
                  ${escapeHtml(item.descripcion || 'Sin descripción')}
                </span>
              </div>
            </td>
            <td class="organizacion-columna--alias">
              <span class="text-body-secondary tabla-texto-truncable" title="${escapeHtml(item.alias || '-')}">${escapeHtml(item.alias || '-')}</span>
            </td>
            <td class="organizacion-columna--timezone">
              <span class="organizacion-chip-timezone" title="${escapeHtml(item.timezone || '-')}">
                <i class="bi bi-globe2" aria-hidden="true"></i>
                <span>${escapeHtml(item.timezone || '-')}</span>
              </span>
            </td>
            <td class="organizacion-columna--estado">
              <span class="badge rounded-pill ${item.estado === 'activo' ? 'text-bg-success' : 'text-bg-secondary'}">
                ${escapeHtml(formatearEstado(item.estado))}
              </span>
            </td>
            <td class="organizacion-columna--actualizado">
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
                    ? `<a href="/organizacion/sitios/${escapeHtml(item.id)}/editar" class="dropdown-item d-flex align-items-center gap-2"><i class="bi bi-pencil-square" aria-hidden="true"></i><span>Gestionar sitio</span></a>`
                    : `<button type="button" class="dropdown-item d-flex align-items-center gap-2" disabled><i class="bi bi-pencil-square" aria-hidden="true"></i><span>Gestionar sitio</span></button>`}
                  <form
                    method="post"
                    action="/api/organizacion/sitio/${encodeURIComponent(item.id)}/eliminacion"
                    data-organizacion-eliminar-form
                    data-organizacion-durable="true"
                    data-organizacion-tipo="sitio"
                    data-organizacion-entidad="Sitio"
                    data-organizacion-id="${escapeHtml(item.id)}"
                    data-organizacion-nombre="${escapeHtml(item.nombre)}"
                    data-organizacion-detalle="#${escapeHtml(item.id)} · ${escapeHtml(item.alias || '-')} · Empresa ${escapeHtml(item.empresaNombre || '-')}"
                    data-organizacion-url-impacto="/api/organizacion/sitio/${encodeURIComponent(item.id)}/eliminacion"
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
  }

  function celdaPertenencia(item) {
    const idTenant = String(item.tenantId || '').trim();
    const idEmpresa = String(item.empresaId || '').trim();
    const piezas = [];

    if (!ocultarTenant) {
      const nombreTenant = escapeHtml(item.tenantNombre || '-');
      const contenidoTenant = `<i class="bi bi-diagram-3" aria-hidden="true"></i><span class="tabla-texto-truncable" title="${nombreTenant}">${nombreTenant}</span>`;
      piezas.push(puedeVerTenants && idTenant
        ? `<a href="/organizacion/sitios?tenant_id=${encodeURIComponent(idTenant)}" class="organizacion-entidad__meta organizacion-entidad__meta--enlace" title="Ver sitios del tenant ${nombreTenant}">${contenidoTenant}</a>`
        : `<span class="organizacion-entidad__meta">${contenidoTenant}</span>`);
    }

    if (!ocultarEmpresa) {
      const nombreEmpresa = escapeHtml(item.empresaNombre || '-');
      const contenidoEmpresa = `<i class="bi bi-buildings" aria-hidden="true"></i><span class="tabla-texto-truncable" title="${nombreEmpresa}">${nombreEmpresa}</span>`;
      piezas.push(puedeVerEmpresas && idTenant && idEmpresa
        ? `<a href="/organizacion/sitios?tenant_id=${encodeURIComponent(idTenant)}&empresa_id=${encodeURIComponent(idEmpresa)}" class="organizacion-entidad__meta organizacion-entidad__meta--enlace" title="Ver sitios de la empresa ${nombreEmpresa}">${contenidoEmpresa}</a>`
        : `<span class="organizacion-entidad__meta">${contenidoEmpresa}</span>`);
    }

    return `<td class="organizacion-columna--pertenencia"><div class="organizacion-pertenencia">${piezas.join('<span class="organizacion-pertenencia__separador" aria-hidden="true">/</span>')}</div></td>`;
  }

  async function cargar() {
    contenedorFilas.innerHTML = `
      <tr>
        <td colspan="${columnasTabla}" class="text-body-secondary">
          <div class="py-3 d-inline-flex align-items-center gap-2">
            <i class="bi bi-arrow-repeat" aria-hidden="true"></i>
            <span>Cargando sitios...</span>
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
        throw new Error(datos.mensaje || 'No se pudo cargar el listado de sitios.');
      }

      estado.page = Number(datos.paginacion?.pagina || estado.page || 1);
      estado.totalPaginas = Number(datos.paginacion?.totalPaginas || 1);

      renderizarFilas(datos.filas || []);
      actualizarResumen(datos);
      actualizarOrdenVisual();
      actualizarPaginacionVisual();

      if (window.organizacionEliminacion?.refrescarFormularios) {
        window.organizacionEliminacion.refrescarFormularios();
      }
    } catch (error) {
      contenedorFilas.innerHTML = `
        <tr>
          <td colspan="${columnasTabla}" class="text-danger">
            <div class="py-3 d-inline-flex align-items-center gap-2">
              <i class="bi bi-exclamation-triangle" aria-hidden="true"></i>
              <span>${escapeHtml(error.message || 'No se pudo cargar el listado.')}</span>
            </div>
          </td>
        </tr>
      `;
      if (window.portalToast?.error) {
        window.portalToast.error('Sitios', error.message || 'No se pudo cargar el listado de sitios.');
      }
    }
  }

  function normalizarSortBy(valor) {
    const columnasValidas = new Set([
      'id',
      'tenant',
      'empresa',
      'nombre',
      'alias',
      'timezone',
      'estado',
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
      estado.pageSize = Number(selectorPageSize?.value || 25);
      estado.page = 1;
      sincronizarUrl({ replace: true });
      cargar();
    });
  }

  window.addEventListener('popstate', () => {
    hidratarEstadoDesdeUrl();
    aplicarEstadoAControles();
    cargar();
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
  if (valor === 'activo') return 'Activo';
  if (valor === 'inactivo') return 'Inactivo';
  return String(valor || '-');
}

function escapeHtml(valor) {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
