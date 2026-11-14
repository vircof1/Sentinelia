(function () {
  const modulo = document.querySelector('[data-dns-lista]');

  if (!modulo) {
    return;
  }

  inicializarListadoDns(modulo);
})();

function inicializarListadoDns(modulo) {
  const parametrosActuales = new URLSearchParams(window.location.search);
  const urlListado = modulo.dataset.urlListado;
  const inputBusqueda = modulo.querySelector('[data-dns-busqueda]');
  const selectorEstadoPublicacion = modulo.querySelector(
    '[data-dns-estado-publicacion]'
  );
  const selectorCategoria = modulo.querySelector('[data-dns-categoria]');
  const selectorActivo = modulo.querySelector('[data-dns-activo]');
  const selectorPageSize = modulo.querySelector('[data-dns-page-size]');
  const botonAplicar = modulo.querySelector('[data-dns-aplicar]');
  const botonLimpiar = modulo.querySelector('[data-dns-limpiar]');
  const enlaceNuevaZona = modulo.querySelector('[data-dns-nueva-zona]');
  const retornoHero = modulo.dataset.retornoHero || '';
  const contenedorEstado = modulo.querySelector('[data-dns-estado]');
  const resumenListado = modulo.querySelector('[data-dns-resumen-listado]');
  const contenedorFilas = modulo.querySelector('[data-dns-filas]');
  const etiquetaPaginaActual = modulo.querySelector('[data-dns-pagina-actual]');
  const paginador = modulo.querySelector('[data-dns-paginador]');
  const botonesPaginacion = Array.from(
    modulo.querySelectorAll('[data-dns-page-action]')
  );
  const kpiTotalZonas = modulo.querySelector('[data-dns-kpi-total-zonas]');
  const kpiTotalPublicadas = modulo.querySelector(
    '[data-dns-kpi-total-publicadas]'
  );
  const kpiTotalNoPublicadas = modulo.querySelector(
    '[data-dns-kpi-total-no-publicadas]'
  );
  const desglosePublicacion = modulo.querySelector('[data-dns-kpi-desglose-publicacion]');

  const estado = {
    sitioId: modulo.dataset.sitioId || '',
    q: inputBusqueda?.value.trim() || '',
    tipo: '',
    estadoPublicacion: selectorEstadoPublicacion?.value || '',
    categoriaOrigen: selectorCategoria?.value || '',
    activo: selectorActivo?.value || 'todos',
    page: Number(parametrosActuales.get('page') || 1),
    pageSize: Number(selectorPageSize?.value || 10),
    totalPaginas: 1
  };

  const aplicarEstadoDesdeControles = function ({ resetearPagina = false } = {}) {
    estado.q = inputBusqueda?.value.trim() || '';
    estado.tipo = '';
    estado.estadoPublicacion = selectorEstadoPublicacion?.value || '';
    estado.categoriaOrigen = selectorCategoria?.value || '';
    estado.activo = selectorActivo?.value || 'todos';
    estado.pageSize = Number(selectorPageSize?.value || 10);

    if (resetearPagina) {
      estado.page = 1;
    }

    if (!Number.isFinite(estado.page) || estado.page < 1) {
      estado.page = 1;
    }
  };

  const construirQuery = function () {
    const parametros = new URLSearchParams();
    if (estado.sitioId) parametros.set('sitio_id', estado.sitioId);
    parametros.set('q', estado.q);
    parametros.set('tipo', estado.tipo);
    parametros.set('estado_publicacion', estado.estadoPublicacion);
    parametros.set('categoria_origen', estado.categoriaOrigen);
    parametros.set('activo', estado.activo);
    parametros.set('page', String(estado.page));
    parametros.set('page_size', String(estado.pageSize));
    if (retornoHero) parametros.set('return_to', retornoHero);
    return parametros.toString();
  };

  const construirRetornoListado = function () {
    const query = construirQuery();
    return query ? `/dns?${query}` : '/dns';
  };

  const actualizarUrl = function () {
    const query = construirQuery();
    const siguienteUrl = query ? `/dns?${query}` : '/dns';
    window.history.replaceState({}, '', siguienteUrl);
    if (enlaceNuevaZona) {
      enlaceNuevaZona.href = `/dns/nuevo?return_to=${encodeURIComponent(siguienteUrl)}`;
    }
  };

  const actualizarResumen = function (datos) {
    if (kpiTotalZonas) {
      kpiTotalZonas.textContent = String(datos.resumen?.totalZonas ?? 0);
    }

    if (kpiTotalPublicadas) {
      kpiTotalPublicadas.textContent = String(datos.resumen?.totalPublicadas ?? 0);
    }

    const pendientes = Number(datos.resumen?.totalPendientes ?? 0);
    const errores = Number(datos.resumen?.totalErrores ?? 0);
    if (kpiTotalNoPublicadas) {
      kpiTotalNoPublicadas.textContent = String(pendientes + errores);
    }
    if (desglosePublicacion) {
      desglosePublicacion.textContent = `${pendientes} pendientes · ${errores} con error`;
    }
  };

  const actualizarPaginacionVisual = function (datos) {
    const paginacion = datos.paginacion || {};
    estado.totalPaginas = Number(paginacion.totalPaginas || 1);
    estado.page = Number(paginacion.pagina || 1);
    if (paginador) paginador.hidden = estado.totalPaginas <= 1;

    if (etiquetaPaginaActual) {
      etiquetaPaginaActual.textContent =
        `Página ${estado.page} de ${estado.totalPaginas}`;
    }

    for (const boton of botonesPaginacion) {
      const accion = boton.dataset.dnsPageAction;
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

  const actualizarResumenListado = function (datos) {
    if (!resumenListado) {
      return;
    }

    const paginacion = datos.paginacion || {};
    const totalFiltrado = Number(paginacion.totalFiltrado || 0);
    const desde = Number(paginacion.desde || 0);
    const hasta = Number(paginacion.hasta || 0);

    if (totalFiltrado === 0) {
      resumenListado.textContent = '0 zonas encontradas.';
      return;
    }

    resumenListado.textContent =
      `Mostrando ${desde}-${hasta} de ${totalFiltrado} zonas filtradas.`;
  };

  const renderizarFilas = function (zonas) {
    if (!contenedorFilas) {
      return;
    }

    if (!Array.isArray(zonas) || zonas.length === 0) {
      contenedorFilas.innerHTML = `
        <tr>
          <td colspan="4" class="text-body-secondary">
            No hay zonas DNS visibles con los filtros actuales.
          </td>
        </tr>
      `;
      return;
    }

    const retornoListado = construirRetornoListado();

    contenedorFilas.innerHTML = zonas
      .map(function (zona) {
        const urlDetalle =
          `/dns/${zona.id}?return_to=${encodeURIComponent(retornoListado)}`;
        const urlEditar =
          `/dns/${zona.id}/editar?return_to=${encodeURIComponent(retornoListado)}`;

        return `
          <tr>
            <td data-label="Zona">
              <div class="celda-clave dns-tabla__identidad">
                <a href="${escapeHtml(urlDetalle)}" class="dns-tabla__enlace-zona">${escapeHtml(zona.nombreZona)}</a>
                <span class="etiqueta-secundaria">${escapeHtml(zona.descripcion || 'Sin descripción.')}</span>
              </div>
            </td>
            <td data-label="Publicación">
              <div class="metadatos-configuracion dns-tabla__estado">
                <div class="dns-tabla__estado-insignias">
                  <span class="insignia-monitor ${claseEstadoPublicacion(zona.estadoPublicacion)}">${escapeHtml(zona.etiquetaPublicacion || zona.estadoPublicacion)}</span>
                  <span class="insignia-monitor ${zona.activo ? 'insignia-monitor--ok' : 'insignia-monitor--off'}">${zona.activo ? 'Activa' : 'Inactiva'}</span>
                </div>
                <span>${escapeHtml(zona.descripcionPublicacion || '')}</span>
                ${zona.detalleUltimoErrorPublicacion ? `<span class="texto-danger">Error: ${escapeHtml(zona.detalleUltimoErrorPublicacion)}</span>` : ''}
              </div>
            </td>
            <td data-label="Alcance">
              <div class="metadatos-configuracion dns-tabla__alcance">
                <span>${escapeHtml(zona.alcanceDescripcion)}</span>
                <span class="etiqueta-secundaria">${escapeHtml(zona.categoriaOrigen)} · ${escapeHtml(String(zona.tipoZona || '').toUpperCase())}</span>
              </div>
            </td>
            <td class="text-end" data-label="Acciones">
              <div class="usuarios-tabla__acciones">
                <div class="dropdown dns-tabla__acciones">
                  <button
                    type="button"
                    class="btn btn-outline-secondary btn-sm usuarios-tabla__acciones-toggle"
                    data-bs-toggle="dropdown"
                    data-bs-auto-close="outside"
                    aria-expanded="false"
                    aria-label="Acciones de ${escapeHtml(zona.nombreZona)}"
                  >
                    <i class="bi bi-gear" aria-hidden="true"></i>
                  </button>
                  <div class="dropdown-menu dropdown-menu-end usuarios-tabla__acciones-menu">
                    <a href="${escapeHtml(urlDetalle)}" class="dropdown-item d-flex align-items-center gap-2">
                      <i class="bi bi-list-ul" aria-hidden="true"></i>
                      <span>Ver zona y registros</span>
                    </a>
                    ${
                      zona.editable
                        ? `
                          <a href="${escapeHtml(urlEditar)}" class="dropdown-item d-flex align-items-center gap-2">
                            <i class="bi bi-pencil-square" aria-hidden="true"></i>
                            <span>Editar zona</span>
                          </a>
                          <button type="button" class="dropdown-item dropdown-item--danger d-flex align-items-center gap-2" data-dns-eliminar-zona="${escapeHtml(zona.id)}" data-dns-eliminar-retorno="${escapeHtml(retornoListado)}">
                            <i class="bi bi-trash3" aria-hidden="true"></i>
                            <span>Eliminar zona…</span>
                          </button>
                        `
                        : ''
                    }
                  </div>
                </div>
              </div>
            </td>
          </tr>
        `;
      })
      .join('');
  };

  const cargar = async function () {
    if (contenedorEstado) {
      contenedorEstado.textContent = 'Cargando zonas DNS...';
    }

    if (contenedorFilas) {
      contenedorFilas.innerHTML = '';
    }

    try {
      const datos = await fetchJson(`${urlListado}?${construirQuery()}`);
      actualizarResumen(datos);
      actualizarResumenListado(datos);
      actualizarPaginacionVisual(datos);
      renderizarFilas(datos.zonas || []);
      actualizarUrl();

      if (contenedorEstado) contenedorEstado.textContent = '';
    } catch (error) {
      if (contenedorEstado) {
        contenedorEstado.textContent = error.message;
      }

      if (resumenListado) resumenListado.textContent = '';

      if (contenedorFilas) contenedorFilas.innerHTML = '';

      window.portalToast?.show({
        tipo: 'error',
        titulo: 'No se pudo cargar el catálogo DNS',
        cuerpo: error.message
      });
    }
  };

  botonAplicar?.addEventListener('click', async function () {
    aplicarEstadoDesdeControles({ resetearPagina: true });
    await cargar();
  });

  botonLimpiar?.addEventListener('click', async function () {
    if (inputBusqueda) inputBusqueda.value = '';
    if (selectorEstadoPublicacion) selectorEstadoPublicacion.value = '';
    if (selectorCategoria) selectorCategoria.value = '';
    if (selectorActivo) selectorActivo.value = 'todos';
    if (selectorPageSize) selectorPageSize.value = '10';
    aplicarEstadoDesdeControles({ resetearPagina: true });
    await cargar();
  });

  inputBusqueda?.addEventListener('keydown', async function (evento) {
    if (evento.key !== 'Enter') {
      return;
    }

    evento.preventDefault();
    aplicarEstadoDesdeControles({ resetearPagina: true });
    await cargar();
  });

  for (const selector of [
    selectorEstadoPublicacion,
    selectorCategoria,
    selectorActivo,
    selectorPageSize
  ]) {
    selector?.addEventListener('change', async function () {
      aplicarEstadoDesdeControles({ resetearPagina: true });
      await cargar();
    });
  }

  for (const boton of botonesPaginacion) {
    boton.addEventListener('click', async function () {
      const accion = boton.dataset.dnsPageAction;

      if (accion === 'first') estado.page = 1;
      if (accion === 'prev') estado.page = Math.max(1, estado.page - 1);
      if (accion === 'next') estado.page = Math.min(estado.totalPaginas, estado.page + 1);
      if (accion === 'last') estado.page = estado.totalPaginas;

      await cargar();
    });
  }

  (async function init() {
    aplicarEstadoDesdeControles();
    await cargar();
  })().catch(function (error) {
    window.portalToast?.show({
      tipo: 'error',
      titulo: 'Error al preparar DNS',
      cuerpo: error.message
    });
  });
}

async function fetchJson(url, opciones = {}) {
  const headers = {
    accept: 'application/json',
    'x-requested-with': 'XMLHttpRequest',
    ...(opciones.headers || {})
  };

  const respuesta = await fetch(url, {
    ...opciones,
    headers
  });

  if (respuesta.redirected) {
    window.location.assign(respuesta.url);
    throw new Error('Redirigiendo a la pantalla de acceso.');
  }

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

function claseEstadoPublicacion(estadoPublicacion) {
  if (estadoPublicacion === 'publicado') {
    return 'insignia-monitor--ok';
  }

  if (estadoPublicacion === 'error') {
    return 'insignia-monitor--alerta';
  }

  return 'insignia-monitor--suave';
}

function escapeHtml(texto) {
  return String(texto)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
