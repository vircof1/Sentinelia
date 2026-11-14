(function () {
  const moduloLista = document.querySelector('[data-agentes-lista]');

  if (moduloLista) {
    inicializarListadoAgentes(moduloLista);
  }
})();

function inicializarListadoAgentes(modulo) {
  const urlListado = modulo.dataset.urlListado;
  const puedeModificar = modulo.dataset.puedeModificar === '1';
  let puedeEliminar = modulo.dataset.puedeEliminar === '1';
  const parametrosIniciales = new URLSearchParams(window.location.search);
  const formulario = modulo.querySelector('[data-agentes-filtros]');
  const inputBusqueda = modulo.querySelector('[data-agentes-busqueda]');
  const selectorEstadoAdministrativo = modulo.querySelector(
    '[data-agentes-estado-administrativo]'
  );
  const selectorEstadoAcceso = modulo.querySelector('[data-agentes-estado-acceso]');
  const selectorEstadoVidaPol = modulo.querySelector(
    '[data-agentes-estado-vida-pol]'
  );
  const selectorPageSize = modulo.querySelector('[data-agentes-page-size]');
  const selectorSortBy = modulo.querySelector('[data-agentes-sort-by]');
  const selectorSortDir = modulo.querySelector('[data-agentes-sort-dir]');
  const botonLimpiar = modulo.querySelector('[data-agentes-limpiar]');
  const contenedorFilas = modulo.querySelector('[data-agentes-filas]');
  const contenedorTarjetas = modulo.querySelector('[data-agentes-tarjetas]');
  const contenedorEstado = modulo.querySelector('[data-agentes-estado]');
  const resumenListado = modulo.querySelector('[data-agentes-resumen-listado]');
  const etiquetaPaginaActual = modulo.querySelector('[data-agentes-pagina-actual]');
  const botonesPaginacion = Array.from(
    modulo.querySelectorAll('[data-page-action]')
  );
  const kpiTotal = document.querySelector('[data-kpi-agentes-total]');
  const kpiActivos = document.querySelector('[data-kpi-agentes-activos]');
  const kpiVivos = document.querySelector('[data-kpi-agentes-vivos]');
  const kpiRedis = document.querySelector('[data-kpi-agentes-redis]');
  const kpiCuarentena = document.querySelector('[data-kpi-agentes-cuarentena]');

  let temporizadorBusqueda = null;
  const estado = {
    q: inputBusqueda?.value.trim() || parametrosIniciales.get('q') || '',
    tenantId: parametrosIniciales.get('tenant_id') || '',
    empresaId: parametrosIniciales.get('empresa_id') || '',
    sitioId: parametrosIniciales.get('sitio_id') || '',
    estadoAdministrativo:
      selectorEstadoAdministrativo?.value ||
      parametrosIniciales.get('estado_administrativo') ||
      '',
    estadoAcceso:
      selectorEstadoAcceso?.value ||
      parametrosIniciales.get('estado_acceso') ||
      '',
    estadoVidaPol:
      selectorEstadoVidaPol?.value ||
      parametrosIniciales.get('estado_vida_pol') ||
      '',
    page: Number.parseInt(parametrosIniciales.get('page') || '1', 10) || 1,
    pageSize: Number(selectorPageSize?.value || parametrosIniciales.get('page_size') || 10),
    sortBy: selectorSortBy?.value || parametrosIniciales.get('sort_by') || 'nombre',
    sortDir: selectorSortDir?.value || parametrosIniciales.get('sort_dir') || 'asc',
    totalPaginas: 1
  };

  const aplicarEstadoDesdeControles = function ({ resetearPagina = false } = {}) {
    estado.q = inputBusqueda?.value.trim() || '';
    estado.estadoAdministrativo = selectorEstadoAdministrativo?.value || '';
    estado.estadoAcceso = selectorEstadoAcceso?.value || '';
    estado.estadoVidaPol = selectorEstadoVidaPol?.value || '';
    estado.pageSize = Number(selectorPageSize?.value || 10);
    estado.sortBy = selectorSortBy?.value || 'nombre';
    estado.sortDir = selectorSortDir?.value || 'asc';

    if (resetearPagina) {
      estado.page = 1;
    }
  };

  const construirQuery = function () {
    const parametros = new URLSearchParams();
    parametros.set('q', estado.q);
    parametros.set('tenant_id', estado.tenantId);
    parametros.set('empresa_id', estado.empresaId);
    parametros.set('sitio_id', estado.sitioId);
    parametros.set('estado_administrativo', estado.estadoAdministrativo);
    parametros.set('estado_acceso', estado.estadoAcceso);
    parametros.set('estado_vida_pol', estado.estadoVidaPol);
    parametros.set('page', String(estado.page));
    parametros.set('page_size', String(estado.pageSize));
    parametros.set('sort_by', estado.sortBy);
    parametros.set('sort_dir', estado.sortDir);
    return parametros.toString();
  };

  const sincronizarUrl = function () {
    const url = new URL(window.location.href);

    actualizarParametro(url.searchParams, 'q', estado.q);
    actualizarParametro(url.searchParams, 'tenant_id', estado.tenantId);
    actualizarParametro(url.searchParams, 'empresa_id', estado.empresaId);
    actualizarParametro(url.searchParams, 'sitio_id', estado.sitioId);
    actualizarParametro(
      url.searchParams,
      'estado_administrativo',
      estado.estadoAdministrativo
    );
    actualizarParametro(url.searchParams, 'estado_acceso', estado.estadoAcceso);
    actualizarParametro(url.searchParams, 'estado_vida_pol', estado.estadoVidaPol);
    url.searchParams.delete('foco_operativo');
    actualizarParametro(url.searchParams, 'page', String(estado.page), '1');
    actualizarParametro(url.searchParams, 'page_size', String(estado.pageSize), '10');
    actualizarParametro(url.searchParams, 'sort_by', estado.sortBy, 'nombre');
    actualizarParametro(url.searchParams, 'sort_dir', estado.sortDir, 'asc');

    window.history.replaceState({}, '', url);
  };

  const actualizarResumen = function (datos) {
    const resumen = datos.resumen || {};
    const paginacion = datos.paginacion || {};

    if (kpiTotal) {
      kpiTotal.textContent = String(resumen.totalVisibles ?? resumen.total ?? 0);
    }

    if (kpiActivos) {
      kpiActivos.textContent = String(resumen.activos ?? 0);
    }

    if (kpiVivos) {
      kpiVivos.textContent = String(resumen.vivos ?? 0);
    }

    if (kpiRedis) {
      kpiRedis.textContent = String(resumen.sesionesRedisVivas ?? 0);
    }

    if (kpiCuarentena) {
      kpiCuarentena.textContent = String(resumen.enCuarentena ?? 0);
    }

    if (resumenListado) {
      resumenListado.textContent =
        Number(paginacion.totalFiltrado || 0) > 0
          ? `Mostrando ${paginacion.desde}-${paginacion.hasta} de ${paginacion.totalFiltrado} agentes filtrados.`
          : '0 agentes encontrados.';
    }

    if (etiquetaPaginaActual) {
      etiquetaPaginaActual.textContent =
        `Página ${paginacion.pagina || 1} de ${paginacion.totalPaginas || 1}`;
    }
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

  const inicializarTooltipsLocales = function (raiz = document) {
    if (!window.bootstrap?.Tooltip) {
      return;
    }

    const nodos = Array.from(
      raiz.querySelectorAll('[data-bs-toggle="tooltip"]')
    );

    for (const nodo of nodos) {
      const instanciaExistente = window.bootstrap.Tooltip.getInstance(nodo);

      if (instanciaExistente) {
        instanciaExistente.dispose();
      }

      new window.bootstrap.Tooltip(nodo);
    }
  };

  const cerrarPanelesAgente = function (excepto = null) {
    for (const panel of contenedorFilas.querySelectorAll('[data-agente-popover]')) {
      if (panel === excepto) {
        continue;
      }

      panel.hidden = true;

      const toggle = panel
        .closest('[data-agente-popover-wrap]')
        ?.querySelector('[data-agente-popover-toggle]');

      if (toggle) {
        toggle.setAttribute('aria-expanded', 'false');
      }
    }
  };

  const inicializarPanelesAgente = function (raiz = document) {
    const toggles = Array.from(
      raiz.querySelectorAll('[data-agente-popover-toggle]')
    );

    for (const toggle of toggles) {
      toggle.addEventListener('click', function (evento) {
        evento.stopPropagation();

        const wrap = toggle.closest('[data-agente-popover-wrap]');
        const panel = wrap?.querySelector('[data-agente-popover]');

        if (!panel) {
          return;
        }

        const abrir = panel.hidden;
        cerrarPanelesAgente(panel);
        panel.hidden = !abrir;
        toggle.setAttribute('aria-expanded', abrir ? 'true' : 'false');
      });
    }
  };

  document.addEventListener('click', function (evento) {
    if (contenedorFilas.contains(evento.target)) {
      const dentroPanel = evento.target.closest('[data-agente-popover]');
      const enToggle = evento.target.closest('[data-agente-popover-toggle]');

      if (dentroPanel || enToggle) {
        return;
      }
    }

    cerrarPanelesAgente();
  });

  const renderizarFilas = function (agentes) {
    if (!Array.isArray(agentes) || agentes.length === 0) {
      contenedorFilas.innerHTML = `
        <tr>
          <td colspan="6" class="text-body-secondary">
            Prueba con otra búsqueda o limpia los filtros.
          </td>
        </tr>
      `;
      contenedorTarjetas.innerHTML = '<p class="texto-apoyo mb-0">Prueba con otra búsqueda o limpia los filtros.</p>';
      return;
    }

    contenedorFilas.innerHTML = agentes.map(renderizarFilaAgente).join('');
    contenedorTarjetas.innerHTML = agentes.map(renderizarTarjetaAgente).join('');
    inicializarTooltipsLocales(contenedorFilas);
    inicializarPanelesAgente(contenedorFilas);
  };

  const renderizarEstadoPrincipal = function (agente) {
    const habilitado = agente.estadoAdministrativo === 'activo';
    const estadoConexion = ({
      vivo: 'En línea',
      silencioso: 'Sin señal reciente',
      nunca_conectado: 'Nunca conectado',
      inconsistente_relogin_requerido: 'Debe iniciar sesión de nuevo'
    })[agente.estadoVidaPol] || 'Conexión desconocida';

    return `
      ${renderizarBadge(habilitado ? 'Habilitado' : 'Deshabilitado', habilitado ? 'success' : 'secondary')}
      ${renderizarBadge(estadoConexion, agente.estadoVidaPol === 'vivo' ? 'success' : 'light')}
      ${agente.estadoAcceso === 'cuarentena' ? renderizarBadge('En cuarentena', 'warning') : ''}
    `;
  };

  const obtenerActividadPrincipal = function (agente) {
    if (agente.ultimaConexionUtc) {
      return { etiqueta: 'Última conexión', fecha: formatearFecha(agente.ultimaConexionUtc) };
    }
    if (agente.ultimoHeartbeatUtc) {
      return { etiqueta: 'Última señal', fecha: formatearFecha(agente.ultimoHeartbeatUtc) };
    }
    if (agente.ultimoLoginUtc) {
      return { etiqueta: 'Último acceso', fecha: formatearFecha(agente.ultimoLoginUtc) };
    }
    return { etiqueta: 'Actividad', fecha: 'Sin actividad registrada' };
  };

  const renderizarTarjetaAgente = function (agente) {
    const sesionRedis = agente.sesionRedis || {};
    const sesion = sesionRedis.sesion || null;
    const actividad = obtenerActividadPrincipal(agente);

    return `
      <article class="agentes-tarjeta">
        <div class="agentes-tarjeta__cabecera">
          <div class="agentes-tarjeta__identidad">
            <strong>${escapeHtml(agente.nombre)}</strong>
            <span class="texto-apoyo">#${escapeHtml(agente.id)} · ${escapeHtml(agente.sitioNombre || `Sitio #${agente.sitioId}`)}</span>
          </div>
          ${renderizarMenuAcciones(agente, 'dropdown')}
        </div>
        <div class="agentes-tabla__badges">${renderizarEstadoPrincipal(agente)}</div>
        <div class="agentes-tarjeta__actividad">
          <span class="texto-apoyo">${actividad.etiqueta}</span>
          <strong>${escapeHtml(actividad.fecha)}</strong>
        </div>
        <details class="agentes-tarjeta__detalles">
          <summary>Datos técnicos</summary>
          <dl>
            <dt>Empresa</dt><dd>${escapeHtml(agente.empresaNombre || `Empresa #${agente.empresaId}`)}</dd>
            <dt>Equipo</dt><dd>${escapeHtml(agente.ultimoHostname || 'Sin dato')}</dd>
            <dt>Versión</dt><dd>${escapeHtml(agente.ultimaVersionAgente || 'Sin dato')}</dd>
            <dt>Perfil</dt><dd>${escapeHtml(describirPerfilServidor(agente.perfilServidor))}</dd>
            <dt>Sesión</dt><dd>${sesionRedis.viva ? 'Activa' : 'Sin sesión activa'}</dd>
            <dt>GUID</dt><dd><code>${escapeHtml(agente.guid || 'Sin dato')}</code></dd>
            ${agente.descripcion ? `<dt>Descripción</dt><dd>${escapeHtml(agente.descripcion)}</dd>` : ''}
          </dl>
          ${renderizarDetalleRedis(sesionRedis, sesion)}
        </details>
      </article>
    `;
  };

  const renderizarFilaAgente = function (agente) {
    const sesionRedis = agente.sesionRedis || {};
    const sesion = sesionRedis.sesion || null;
    const acciones = renderizarAcciones(agente);
    const tooltipAgente = construirTooltipAgente(agente, sesionRedis, sesion);
    const tooltipUbicacion = construirTooltipUbicacion(agente);
    const tooltipActividad = construirTooltipActividad(agente, sesionRedis, sesion);
    const actividad = obtenerActividadPrincipal(agente);

    return `
      <tr class="agentes-tabla__fila">
        <td>
          <div class="agentes-tabla__popover-wrap" data-agente-popover-wrap>
            <button
              type="button"
              class="boton-tabla-transparente agentes-tabla__agente"
              data-agente-popover-toggle
              aria-expanded="false"
            >
              <strong>${escapeHtml(agente.nombre)}</strong>
              <span class="text-body-secondary small">#${escapeHtml(agente.id)} · v${escapeHtml(agente.versionSecreto)}</span>
            </button>
            <div class="agentes-tabla__popover" data-agente-popover hidden>
              ${tooltipAgente}
            </div>
          </div>
          ${agente.descripcion ? `<span class="d-block text-body-secondary small text-truncate">${escapeHtml(agente.descripcion)}</span>` : ''}
        </td>
        <td>
          <span
            class="d-block agentes-tabla__ubicacion"
            data-bs-toggle="tooltip"
            data-bs-html="true"
            data-bs-placement="top"
            data-bs-custom-class="tooltip-html-denso-wrap"
            data-bs-title="${escapeHtml(tooltipUbicacion)}"
          >
            ${escapeHtml(agente.sitioNombre || `Sitio #${agente.sitioId}`)}
          </span>
          <span class="d-block text-body-secondary small text-truncate">
            ${escapeHtml(agente.empresaNombre || `Empresa #${agente.empresaId}`)}
          </span>
        </td>
        <td>
          <div class="agentes-tabla__badges">
            ${renderizarEstadoPrincipal(agente)}
          </div>
          ${agente.cuarentenaHastaUtc ? `<span class="d-block text-body-secondary small mt-1">Cuarentena hasta ${escapeHtml(formatearFecha(agente.cuarentenaHastaUtc))}</span>` : ''}
        </td>
        <td>
          <span
            class="d-block agentes-tabla__fecha"
            data-bs-toggle="tooltip"
            data-bs-html="true"
            data-bs-placement="top"
            data-bs-custom-class="tooltip-html-denso-wrap"
            data-bs-title="${escapeHtml(tooltipActividad)}"
          >
            <span class="d-block text-body-secondary small">${actividad.etiqueta}</span>
            ${escapeHtml(actividad.fecha)}
          </span>
        </td>
        <td>
          <span class="d-block agentes-tabla__host">${escapeHtml(agente.ultimoHostname || 'Sin host')}</span>
          <span class="d-block text-body-secondary small">${escapeHtml(agente.ultimaVersionAgente || 'sin versión')}</span>
          <div class="d-flex flex-wrap gap-1 mt-1">
            ${renderizarPerfilServidor(agente.perfilServidor)}
            ${agente.tieneSesionDiagnostica ? '<span class="badge text-bg-light">sesión diagnóstica</span>' : ''}
          </div>
          ${renderizarDetalleRedis(sesionRedis, sesion)}
        </td>
        ${acciones}
      </tr>
    `;
  };

  const renderizarAcciones = function (agente) {
    return `<td class="text-end">${renderizarMenuAcciones(agente, 'dropup')}</td>`;
  };

  const renderizarMenuAcciones = function (agente, posicion) {
    const accionEliminar = puedeEliminar
      ? `
        <div class="dropdown-divider"></div>
        <a
          href="/agentes/${encodeURIComponent(agente.id)}/eliminar"
          data-agentes-eliminar
          class="dropdown-item dropdown-item--danger d-flex align-items-center gap-2"
        >
          <i class="bi bi-trash3" aria-hidden="true"></i>
          <span>Eliminar agente…</span>
        </a>
      `
      : '';
    const accionEstado = agente.estadoAdministrativo === 'activo'
      ? `
        <form method="post" action="/agentes/${encodeURIComponent(agente.id)}/deshabilitar">
          <button type="submit" class="dropdown-item dropdown-item--danger d-flex align-items-center gap-2">
            <i class="bi bi-pause-circle" aria-hidden="true"></i>
            <span>Deshabilitar</span>
          </button>
        </form>
      `
      : `
        <form method="post" action="/agentes/${encodeURIComponent(agente.id)}/habilitar">
          <button type="submit" class="dropdown-item d-flex align-items-center gap-2">
            <i class="bi bi-play-circle" aria-hidden="true"></i>
            <span>Habilitar</span>
          </button>
        </form>
      `;
    const accionesGestion = puedeModificar
      ? `
        <a
          href="/agentes/${encodeURIComponent(agente.id)}/editar?return_to=${encodeURIComponent(window.location.pathname + window.location.search)}"
          class="dropdown-item d-flex align-items-center gap-2"
        >
          <i class="bi bi-pencil-square" aria-hidden="true"></i>
          <span>Gestionar agente</span>
        </a>
        <form method="post" action="/agentes/${encodeURIComponent(agente.id)}/rotar-secreto">
          <button type="submit" class="dropdown-item d-flex align-items-center gap-2">
            <i class="bi bi-key" aria-hidden="true"></i>
            <span>Rotar secreto</span>
          </button>
        </form>
        ${accionEstado}
      `
      : `
        <button type="button" class="dropdown-item d-flex align-items-center gap-2" disabled>
          <i class="bi bi-eye" aria-hidden="true"></i>
          <span>Solo lectura</span>
        </button>
      `;

    return `
        <div class="${posicion} agentes-tabla__acciones">
          <button
            type="button"
            class="btn btn-outline-secondary btn-sm agentes-tabla__acciones-toggle"
            data-bs-toggle="dropdown"
            data-bs-auto-close="outside"
            aria-expanded="false"
            aria-label="Acciones de ${escapeHtml(agente.nombre)}"
          >
            <i class="bi bi-gear" aria-hidden="true"></i>
          </button>
          <div class="dropdown-menu dropdown-menu-end agentes-tabla__acciones-menu">
            <a
              href="/agentes/${encodeURIComponent(agente.id)}/telemetria"
              class="dropdown-item d-flex align-items-center gap-2"
            >
              <i class="bi bi-graph-up" aria-hidden="true"></i>
              <span>Ver telemetría</span>
            </a>
            <a
              href="/agentes/${encodeURIComponent(agente.id)}/reglas"
              class="dropdown-item d-flex align-items-center gap-2"
            >
              <i class="bi bi-bezier2" aria-hidden="true"></i>
              <span>Reglas de interpretación</span>
            </a>
            ${accionesGestion}
            ${accionEliminar}
          </div>
        </div>
    `;
  };

  const modalEliminar = document.querySelector('[data-agentes-modal-eliminar]');
  if (modalEliminar) {
    const titulo = modalEliminar.querySelector('[data-agentes-eliminar-titulo]');
    const carga = modalEliminar.querySelector('[data-agentes-eliminar-carga]');
    const formularioEliminar = modalEliminar.querySelector('[data-agentes-eliminar-formulario]');
    const token = modalEliminar.querySelector('[data-agentes-eliminar-token]');
    const contenidoImpacto = modalEliminar.querySelector('[data-agentes-eliminar-impacto]');
    const fraseExactaNodo = modalEliminar.querySelector('[data-agentes-eliminar-frase-exacta]');
    const entradaFrase = modalEliminar.querySelector('[data-agentes-eliminar-frase]');
    const estadoFrase = modalEliminar.querySelector('[data-agentes-eliminar-estado]');
    const botonEnviar = modalEliminar.querySelector('[data-agentes-eliminar-enviar]');
    let fraseExacta = '';
    let enviando = false;
    let solicitudActual = 0;
    let disparador = null;

    const actualizarConfirmacion = function () {
      const coincide = fraseExacta !== '' && entradaFrase.value === fraseExacta;
      botonEnviar.disabled = !coincide || enviando;
      estadoFrase.textContent = coincide
        ? 'La frase coincide. La solicitud encolará la eliminación; el agente puede seguir visible mientras se procesa.'
        : 'La frase todavía no coincide exactamente.';
      estadoFrase.classList.toggle('text-success', coincide);
      estadoFrase.classList.toggle('text-body-secondary', !coincide);
    };

    entradaFrase.addEventListener('input', actualizarConfirmacion);
    formularioEliminar.addEventListener('submit', function (evento) {
      if (entradaFrase.value !== fraseExacta || enviando) {
        evento.preventDefault();
        entradaFrase.focus();
        return;
      }
      enviando = true;
      botonEnviar.disabled = true;
      botonEnviar.textContent = 'Encolando…';
      estadoFrase.textContent = 'Enviando la solicitud. Espera la confirmación del servidor.';
    });

    modalEliminar.addEventListener('hidden.bs.modal', function () {
      solicitudActual += 1;
      formularioEliminar.hidden = true;
      entradaFrase.value = '';
      fraseExacta = '';
      token.value = '';
      enviando = false;
      botonEnviar.disabled = true;
      botonEnviar.textContent = 'Encolar eliminación';
      disparador?.focus();
    });

    modulo.addEventListener('click', async function (evento) {
      const enlace = evento.target.closest?.('[data-agentes-eliminar]');
      if (!enlace || !window.bootstrap?.Modal) return;
      evento.preventDefault();

      const toggleMenu = enlace.closest('.agentes-tabla__acciones')
        ?.querySelector('[data-bs-toggle="dropdown"]');
      disparador = toggleMenu || enlace;
      if (toggleMenu && window.bootstrap.Dropdown) {
        window.bootstrap.Dropdown.getOrCreateInstance(toggleMenu).hide();
      }

      const solicitud = ++solicitudActual;
      const instancia = window.bootstrap.Modal.getOrCreateInstance(modalEliminar);
      titulo.textContent = 'Eliminar agente';
      carga.textContent = 'Preparando la revisión…';
      carga.classList.remove('text-danger');
      formularioEliminar.hidden = true;
      botonEnviar.disabled = true;
      instancia.show();

      try {
        const datos = await fetchJson(enlace.href);
        if (solicitud !== solicitudActual) return;
        const impacto = datos.impacto;
        if (!impacto?.sujeto?.id || !impacto?.tokenConfirmacion || !impacto?.fraseConfirmacion) {
          throw new Error('La revisión de impacto no está completa.');
        }
        titulo.textContent = `Eliminar ${impacto.sujeto.nombre}`;
        formularioEliminar.action = enlace.href;
        token.value = impacto.tokenConfirmacion;
        fraseExacta = impacto.fraseConfirmacion;
        fraseExactaNodo.textContent = fraseExacta;
        entradaFrase.value = '';
        contenidoImpacto.innerHTML = renderizarImpactoEliminacionAgente(impacto);
        carga.textContent = '';
        formularioEliminar.hidden = false;
        actualizarConfirmacion();
        modalEliminar.querySelector('.modal-body').scrollTop = 0;
      } catch (error) {
        if (solicitud !== solicitudActual) return;
        carga.textContent = `${error.message || 'No se pudo cargar la revisión.'} Cierra el diálogo y vuelve a intentarlo.`;
        carga.classList.add('text-danger');
      }
    });
  }

  const renderizarImpactoEliminacionAgente = function (impacto) {
    const conteos = new Map((impacto.resumenImpacto?.conteos || []).map((item) => [item.categoria, item]));
    const grupos = [
      ['Estructura que desaparecerá', [
        ['agente', 'Agente'], ['reglas', 'Reglas de interpretación'],
        ['monitores', 'Monitores'], ['asignaciones_trigger', 'Asignaciones de acción'],
        ['perfil_servidor', 'Perfil de servidor']
      ]],
      ['Histórico operativo', [
        ['senales', 'Señales'], ['observaciones', 'Observaciones'],
        ['estados_actuales', 'Fotografía actual'], ['eventos', 'Eventos'],
        ['ejecuciones_trigger', 'Ejecuciones de acción']
      ]],
      ['Sesión y prueba de vida', [
        ['sesiones_tecnicas', 'Sesiones técnicas'], ['pol', 'Pruebas de vida']
      ]],
      ['Federación y referencias', [
        ['identidades_federadas', 'Identidades federadas'],
        ['referencias_compartidas', 'Referencias compartidas']
      ]],
      ['Limpieza posterior', [['obligaciones_postcommit', 'Tareas posteriores']]]
    ];
    const tarjetas = grupos.map(([tituloGrupo, categorias]) => {
      const filas = categorias.filter(([categoria]) => conteos.has(categoria)).map(([categoria, etiqueta]) => {
        const item = conteos.get(categoria);
        const minimo = item.precision === 'estimada' ? '<small>Al menos</small> ' : '';
        const cantidad = BigInt(item.cantidad).toLocaleString('es-ES');
        return `<dt>${etiqueta}</dt><dd>${minimo}<strong>${escapeHtml(cantidad)}</strong></dd>`;
      }).join('');
      return filas ? `<article class="tarjeta impacto-eliminacion-grupo"><h3>${tituloGrupo}</h3><dl>${filas}</dl></article>` : '';
    }).join('');

    return `
      <div class="modal-impacto-trigger__hero modal-impacto-trigger__hero--alerta">
        <span class="organizacion-entidad__icono" aria-hidden="true"><i class="bi bi-shield-exclamation"></i></span>
        <div>
          <strong>Esta eliminación es irreversible.</strong>
          <p class="texto-apoyo mb-0">${escapeHtml(impacto.sujeto.nombre)} · #${escapeHtml(impacto.sujeto.id)} · ${escapeHtml(impacto.sujeto.guid)}</p>
        </div>
      </div>
      <p>El contrato del agente dejará de aceptarse y sus datos propios se eliminarán. Revisa lo que afecta esta operación:</p>
      <div class="impacto-eliminacion-grid">${tarjetas}</div>
      <p class="texto-apoyo mt-3 mb-2">Los monitores propios se deshabilitarán durante la operación. Las referencias compartidas de otros recursos se conservarán; la limpieza técnica puede continuar después.</p>
      <p class="texto-apoyo mb-0">Esta confirmación caduca el <time data-fecha-utc="${escapeHtml(impacto.expiraEnUtc)}">${escapeHtml(formatearFecha(impacto.expiraEnUtc))}</time>. Si caduca o cambia la estructura, tendrás que revisar un impacto nuevo.</p>
    `;
  };

  const construirTooltipAgente = function (agente, sesionRedis, sesion) {
    return `
      <div class="tooltip-html-denso">
        <strong>${escapeHtml(agente.nombre || 'Agente sin nombre')}</strong>
        <dl>
          <dt>ID</dt><dd>#${escapeHtml(agente.id)}</dd>
          <dt>GUID</dt><dd><code>${escapeHtml(agente.guid || 'sin dato')}</code></dd>
          <dt>Secreto</dt><dd>v${escapeHtml(agente.versionSecreto ?? 'sin dato')}</dd>
          <dt>Sesión</dt><dd>${escapeHtml(sesion?.sessionId || sesionRedis?.estado || 'sin sesión viva')}</dd>
          <dt>Boot</dt><dd>${escapeHtml(agente.ultimoBootId || 'sin dato')}</dd>
          <dt>Perfil</dt><dd>${escapeHtml(describirPerfilServidor(agente.perfilServidor))}</dd>
        </dl>
        ${agente.descripcion ? `<p>${escapeHtml(agente.descripcion)}</p>` : ''}
      </div>
    `;
  };

  const renderizarPerfilServidor = function (perfil) {
    if (perfil?.perfilEfectivo === 'servidor') {
      const estado = `servidor · ${presentarEstadoPerfilServidor(perfil.estado)}`;
      return renderizarBadge(estado, perfil.estado === 'activo' ? 'primary' : 'info');
    }
    const perfilGenerico = renderizarBadge('genérico', 'secondary');
    return perfil?.estado
      ? `${perfilGenerico} ${renderizarBadge(
          presentarEstadoPerfilServidor(perfil.estado),
          perfil.estado === 'desactivado_incompatible' ? 'warning' : 'light'
        )}`
      : perfilGenerico;
  };

  const describirPerfilServidor = function (perfil) {
    if (!perfil) return 'genérico';
    if (perfil.perfilEfectivo === 'servidor') {
      const ultimoPol = perfil.ultimoPolUtc
        ? ` · último POL ${formatearFecha(perfil.ultimoPolUtc)}`
        : '';
      return `servidor · generación #${perfil.generacion} · ${presentarEstadoPerfilServidor(perfil.estado)}${ultimoPol}`;
    }
    if (perfil.estado) {
      const cierre = perfil.codigoCierre ? ` · ${perfil.codigoCierre}` : '';
      return `genérico · última generación #${perfil.generacion} ${presentarEstadoPerfilServidor(perfil.estado)}${cierre}`;
    }
    return 'genérico · nunca promovido';
  };

  const presentarEstadoPerfilServidor = function (estado) {
    return ({
      pendiente_primera_evidencia: 'pendiente de primera evidencia',
      activo: 'operativo',
      retirado: 'retirado',
      desactivado_incompatible: 'desactivado por incompatibilidad'
    })[estado] || estado || 'sin generación';
  };

  const construirTooltipUbicacion = function (agente) {
    return `
      <div class="tooltip-html-denso">
        <strong>Alcance del agente</strong>
        <dl>
          <dt>Tenant</dt><dd>${escapeHtml(agente.tenantNombre || `Tenant #${agente.tenantId}`)}</dd>
          <dt>Empresa</dt><dd>${escapeHtml(agente.empresaNombre || `Empresa #${agente.empresaId}`)}</dd>
          <dt>Sitio</dt><dd>${escapeHtml(agente.sitioNombre || `Sitio #${agente.sitioId}`)}</dd>
        </dl>
      </div>
    `;
  };

  const construirTooltipActividad = function (agente, sesionRedis, sesion) {
    const sospechas = Array.isArray(sesion?.sospechas) ? sesion.sospechas : [];

    return `
      <div class="tooltip-html-denso">
        <strong>Actividad reciente</strong>
        <dl>
          <dt>Login</dt><dd>${escapeHtml(formatearFecha(agente.ultimoLoginUtc || 'nunca'))}</dd>
          <dt>Heartbeat</dt><dd>${escapeHtml(formatearFecha(agente.ultimoHeartbeatUtc || 'nunca'))}</dd>
          <dt>Última conexión</dt><dd>${escapeHtml(formatearFecha(agente.ultimaConexionUtc || 'nunca'))}</dd>
          <dt>Redis</dt><dd>${escapeHtml(sesionRedis?.estado || 'sin_sesion')}</dd>
          <dt>TTL</dt><dd>${escapeHtml(sesionRedis?.ttlRestanteSegundos ?? 0)} s</dd>
          <dt>Expira</dt><dd>${escapeHtml(formatearFecha(sesion?.expiraEnUtc || 'sin dato'))}</dd>
          <dt>Uptime</dt><dd>${escapeHtml(sesion?.uptimeSeconds ?? 'sin dato')}</dd>
          <dt>Sospechas</dt><dd>${escapeHtml(sospechas.length > 0 ? sospechas.join(', ') : 'sin sospechas')}</dd>
        </dl>
      </div>
    `;
  };

  const renderizarDetalleRedis = function (sesionRedis, sesion) {
    const sospechas = Array.isArray(sesion?.sospechas) ? sesion.sospechas : [];

    if (sesionRedis.viva && sesion) {
      return `
        <details class="mt-2">
          <summary class="small text-body-secondary">Redis</summary>
          <div class="small mt-2">
            <span class="d-block">Session ID: <code>${escapeHtml(sesion.sessionId || 'sin dato')}</code></span>
            <span class="d-block">TTL restante: ${escapeHtml(sesionRedis.ttlRestanteSegundos ?? 0)} s</span>
            <span class="d-block">Expira: ${escapeHtml(formatearFecha(sesion.expiraEnUtc || 'sin dato'))}</span>
            <span class="d-block">Uptime: ${escapeHtml(sesion.uptimeSeconds ?? 'sin dato')}</span>
            ${sospechas.length > 0 ? `<span class="d-block">Sospechas: ${escapeHtml(sospechas.join(', '))}</span>` : ''}
          </div>
        </details>
      `;
    }

    if (sesion) {
      return `
        <details class="mt-2">
          <summary class="small text-body-secondary">Redis</summary>
          <div class="small mt-2">
            <span class="d-block">
              Referencia Redis no viva (<code>${escapeHtml(sesionRedis.estado || 'desconocido')}</code>).
              No se trata como sesión operativa.
            </span>
          </div>
        </details>
      `;
    }

    return `
      <details class="mt-2">
        <summary class="small text-body-secondary">Redis</summary>
        <div class="small mt-2">
          <span class="d-block">Sin sesión Redis viva para este agente.</span>
        </div>
      </details>
    `;
  };

  const cargar = async function () {
    contenedorEstado.textContent = 'Cargando agentes...';
    contenedorFilas.innerHTML = '';
    contenedorTarjetas.innerHTML = '';

    try {
      const datos = await fetchJson(`${urlListado}?${construirQuery()}`);
      puedeEliminar = datos.puedeEliminarAgentes === true;
      estado.page = Number(datos.paginacion?.pagina || estado.page || 1);
      estado.totalPaginas = Number(datos.paginacion?.totalPaginas || 1);
      renderizarFilas(datos.agentes || []);
      actualizarResumen(datos);
      actualizarPaginacionVisual();
      sincronizarUrl();

      contenedorEstado.textContent = '';
    } catch (error) {
      contenedorEstado.textContent = error.message;
      contenedorFilas.innerHTML = `
        <tr>
          <td colspan="6" class="text-body-secondary">
            ${escapeHtml(error.message)}
          </td>
        </tr>
      `;
      contenedorTarjetas.textContent = error.message;
      window.portalToast?.show({
        tipo: 'error',
        titulo: 'No se pudo cargar agentes',
        cuerpo: error.message
      });
    }
  };

  const programarCarga = function () {
    window.clearTimeout(temporizadorBusqueda);
    temporizadorBusqueda = window.setTimeout(async function () {
      aplicarEstadoDesdeControles({ resetearPagina: true });
      await cargar();
    }, 240);
  };

  formulario?.addEventListener('submit', async function (evento) {
    evento.preventDefault();
    aplicarEstadoDesdeControles({ resetearPagina: true });
    await cargar();
  });

  inputBusqueda?.addEventListener('input', programarCarga);

  for (const selector of [
    selectorEstadoAdministrativo,
    selectorEstadoAcceso,
    selectorEstadoVidaPol,
    selectorPageSize,
    selectorSortBy,
    selectorSortDir
  ]) {
    selector?.addEventListener('change', async function () {
      aplicarEstadoDesdeControles({ resetearPagina: true });
      await cargar();
    });
  }

  botonLimpiar?.addEventListener('click', async function () {
    if (inputBusqueda) inputBusqueda.value = '';
    if (selectorEstadoAdministrativo) selectorEstadoAdministrativo.value = '';
    if (selectorEstadoAcceso) selectorEstadoAcceso.value = '';
    if (selectorEstadoVidaPol) selectorEstadoVidaPol.value = '';
    if (selectorPageSize) selectorPageSize.value = '10';
    if (selectorSortBy) selectorSortBy.value = 'nombre';
    if (selectorSortDir) selectorSortDir.value = 'asc';

    estado.tenantId = '';
    estado.empresaId = '';
    estado.sitioId = '';
    aplicarEstadoDesdeControles({ resetearPagina: true });
    await cargar();
  });

  for (const boton of botonesPaginacion) {
    boton.addEventListener('click', async function () {
      const accion = boton.dataset.pageAction;

      if (accion === 'first') estado.page = 1;
      if (accion === 'prev') estado.page = Math.max(1, estado.page - 1);
      if (accion === 'next') {
        estado.page = Math.min(estado.totalPaginas, estado.page + 1);
      }
      if (accion === 'last') estado.page = estado.totalPaginas;

      await cargar();
    });
  }

  cargar();
}

function renderizarBadge(texto, clase) {
  return `<span class="badge text-bg-${escapeHtml(clase)}">${escapeHtml(texto || 'sin dato')}</span>`;
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

function actualizarParametro(parametros, clave, valor, porDefecto = '') {
  if (!valor || String(valor) === String(porDefecto)) {
    parametros.delete(clave);
    return;
  }

  parametros.set(clave, valor);
}

function escapeHtml(texto) {
  return String(texto ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatearFecha(valor) {
  if (!valor || valor === 'nunca' || valor === 'sin dato') {
    return valor || 'nunca';
  }

  if (window.portalFechas?.formatear) {
    const renderizada = window.portalFechas.formatear(valor);
    return renderizada || String(valor);
  }

  const fecha = new Date(valor);

  if (Number.isNaN(fecha.getTime())) {
    return String(valor);
  }

  return fecha.toLocaleString('es-ES');
}
