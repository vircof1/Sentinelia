(function () {
  const moduloLista = document.querySelector('[data-usuarios-lista]');
  const moduloFormulario = document.querySelector('[data-usuario-formulario]');

  if (moduloLista) {
    inicializarListadoUsuarios(moduloLista);
  }

  if (moduloFormulario) {
    inicializarFormularioUsuario(moduloFormulario);
  }
})();

function inicializarListadoUsuarios(modulo) {
  const urlListado = modulo.dataset.urlListado;
  const urlEliminarBase = modulo.dataset.urlEliminarBase;
  const urlEmpresas = modulo.dataset.urlEmpresas;
  const inputBusqueda = modulo.querySelector('[data-usuarios-busqueda]');
  const selectorTenant = modulo.querySelector('[data-usuarios-tenant]');
  const selectorEmpresa = modulo.querySelector('[data-usuarios-empresa]');
  const selectorActivo = modulo.querySelector('[data-usuarios-activo]');
  const selectorPageSize = modulo.querySelector('[data-usuarios-page-size]');
  const botonAplicar = modulo.querySelector('[data-usuarios-aplicar]');
  const botonLimpiar = modulo.querySelector('[data-usuarios-limpiar]');
  const contenedorEstado = modulo.querySelector('[data-usuarios-estado]');
  const contenedorFilas = modulo.querySelector('[data-usuarios-filas]');
  const resumenListado = modulo.querySelector('[data-usuarios-resumen-listado]');
  const etiquetaPaginaActual = modulo.querySelector('[data-usuarios-pagina-actual]');
  const modalPermisosNodo = document.querySelector('[data-usuarios-permisos-modal]');
  const modalPermisosTitulo = modalPermisosNodo?.querySelector(
    '[data-usuarios-permisos-modal-titulo]'
  );
  const modalPermisosSubtitulo = modalPermisosNodo?.querySelector(
    '[data-usuarios-permisos-modal-subtitulo]'
  );
  const modalPermisosResumen = modalPermisosNodo?.querySelector(
    '[data-usuarios-permisos-modal-resumen]'
  );
  const modalPermisosFilas = modalPermisosNodo?.querySelector(
    '[data-usuarios-permisos-modal-filas]'
  );
  const modalEliminarNodo = document.querySelector('[data-usuarios-eliminar-modal]');
  const modalEliminarTitulo = modalEliminarNodo?.querySelector('[data-usuarios-eliminar-titulo]');
  const modalEliminarIdentidad = modalEliminarNodo?.querySelector('[data-usuarios-eliminar-identidad]');
  const modalEliminarFraseExacta = modalEliminarNodo?.querySelector('[data-usuarios-eliminar-frase-exacta]');
  const modalEliminarFrase = modalEliminarNodo?.querySelector('[data-usuarios-eliminar-frase]');
  const modalEliminarEstado = modalEliminarNodo?.querySelector('[data-usuarios-eliminar-estado]');
  const modalEliminarError = modalEliminarNodo?.querySelector('[data-usuarios-eliminar-error]');
  const modalEliminarFormulario = modalEliminarNodo?.querySelector('[data-usuarios-eliminar-formulario]');
  const modalEliminarConfirmar = modalEliminarNodo?.querySelector('[data-usuarios-eliminar-confirmar]');
  const modalEliminarConfirmarTexto = modalEliminarNodo?.querySelector('[data-usuarios-eliminar-confirmar-texto]');
  const modalEliminarCerrar = Array.from(modalEliminarNodo?.querySelectorAll('[data-bs-dismiss="modal"]') || []);
  const kpiTotalUsuarios = document.querySelector('[data-kpi-total-usuarios]');
  const kpiTotalPortal = document.querySelector('[data-kpi-total-portal]');
  const kpiTotalTenant = document.querySelector('[data-kpi-total-tenant]');
  const kpiTotalLocal = document.querySelector('[data-kpi-total-local]');
  const botonesOrden = Array.from(modulo.querySelectorAll('[data-sort-by]'));
  const botonesPaginacion = Array.from(
    modulo.querySelectorAll('[data-page-action]')
  );

  let temporizadorBusqueda = null;
  let eliminacionPendiente = null;
  let eliminacionEnCurso = false;
  const estado = {
    q: inputBusqueda?.value.trim() || '',
    tenantId: selectorTenant?.value || '',
    empresaId: '',
    sitioId: new URL(window.location.href).searchParams.get('sitio_id') || '',
    activo: selectorActivo?.value || 'solo_activos',
    page: 1,
    pageSize: Number(selectorPageSize?.value || 10),
    sortBy: 'creado',
    sortDir: 'desc',
    totalPaginas: 1
  };

  const aplicarEstadoDesdeControles = function ({ resetearPagina = false } = {}) {
    estado.q = inputBusqueda?.value.trim() || '';
    estado.tenantId = selectorTenant?.value || '';
    estado.empresaId = selectorEmpresa?.value || '';
    estado.activo = selectorActivo?.value || 'solo_activos';
    estado.pageSize = Number(selectorPageSize?.value || 10);

    if (resetearPagina) {
      estado.page = 1;
    }
  };

  const cargarEmpresas = async function (tenantId, seleccionActual = '') {
    if (!selectorEmpresa) {
      return;
    }

    selectorEmpresa.innerHTML = '<option value="">Todas</option>';

    if (!tenantId) {
      return;
    }

    const datos = await fetchJson(
      `${urlEmpresas}?tenant_id=${encodeURIComponent(tenantId)}`
    );

    for (const opcion of datos.opciones || []) {
      const nodo = document.createElement('option');
      nodo.value = String(opcion.valor);
      nodo.textContent = opcion.etiqueta;

      if (String(opcion.valor) === String(seleccionActual || '')) {
        nodo.selected = true;
      }

      selectorEmpresa.appendChild(nodo);
    }
  };

  const actualizarResumen = function (datos) {
    const { resumen, paginacion } = datos;

    if (kpiTotalUsuarios) {
      kpiTotalUsuarios.textContent = String(resumen.totalUsuarios);
    }

    if (kpiTotalPortal) {
      kpiTotalPortal.textContent = String(resumen.totalPortal);
    }

    if (kpiTotalTenant) {
      kpiTotalTenant.textContent = String(resumen.totalTenant);
    }

    if (kpiTotalLocal) {
      kpiTotalLocal.textContent = String(
        resumen.totalEmpresa + resumen.totalSitio
      );
    }

    if (resumenListado) {
      resumenListado.textContent =
        paginacion.totalFiltrado > 0
          ? `Mostrando ${paginacion.desde}-${paginacion.hasta} de ${paginacion.totalFiltrado} registros filtrados.`
          : 'No hay registros para los filtros actuales.';
    }

    if (etiquetaPaginaActual) {
      etiquetaPaginaActual.textContent =
        `Página ${paginacion.pagina} de ${paginacion.totalPaginas}`;
    }
  };

  const actualizarOrdenVisual = function () {
    for (const boton of botonesOrden) {
      const activo = boton.dataset.sortBy === estado.sortBy;
      boton.classList.toggle('activo', activo);

      if (!activo) {
        boton.dataset.sortDir = '';
        continue;
      }

      boton.dataset.sortDir = estado.sortDir;
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

  const obtenerModalPermisos = function () {
    if (!modalPermisosNodo || !window.bootstrap?.Modal) {
      return null;
    }

    return window.bootstrap.Modal.getOrCreateInstance
      ? window.bootstrap.Modal.getOrCreateInstance(modalPermisosNodo)
      : new window.bootstrap.Modal(modalPermisosNodo);
  };

  const obtenerModalEliminar = function () {
    if (!modalEliminarNodo || !window.bootstrap?.Modal) {
      return null;
    }

    return window.bootstrap.Modal.getOrCreateInstance
      ? window.bootstrap.Modal.getOrCreateInstance(modalEliminarNodo)
      : new window.bootstrap.Modal(modalEliminarNodo);
  };

  const sincronizarConfirmacionEliminar = function () {
    const coincide = Boolean(eliminacionPendiente) &&
      modalEliminarFrase?.value === eliminacionPendiente.nombre;
    if (modalEliminarConfirmar) {
      modalEliminarConfirmar.disabled = !coincide || eliminacionEnCurso;
    }
    if (modalEliminarEstado) {
      modalEliminarEstado.textContent = coincide
        ? 'La frase coincide. Puedes confirmar la eliminación.'
        : 'La frase todavía no coincide.';
    }
  };

  const abrirModalEliminar = function (boton) {
    const modal = obtenerModalEliminar();
    if (!modal) {
      window.portalToast?.show({
        tipo: 'error',
        titulo: 'No se pudo abrir la confirmación',
        cuerpo: 'Vuelve a intentarlo.'
      });
      return;
    }

    const botonMenu = boton.closest('.dropup')?.querySelector('[data-bs-toggle="dropdown"]');
    eliminacionPendiente = {
      id: boton.dataset.usuarioId,
      nombre: boton.dataset.usuarioNombre || '',
      email: boton.dataset.usuarioEmail || '',
      boton: botonMenu || boton
    };
    modalEliminarTitulo.textContent = `Eliminar ${eliminacionPendiente.nombre}`;
    modalEliminarIdentidad.textContent =
      `${eliminacionPendiente.nombre} · #${eliminacionPendiente.id} · ${eliminacionPendiente.email}`;
    modalEliminarFraseExacta.textContent = eliminacionPendiente.nombre;
    modalEliminarFrase.value = '';
    modalEliminarError.hidden = true;
    modalEliminarError.textContent = '';
    sincronizarConfirmacionEliminar();

    if (botonMenu) {
      window.bootstrap?.Dropdown?.getInstance(botonMenu)?.hide();
    }
    modal.show();
  };

  modalEliminarFrase?.addEventListener('input', sincronizarConfirmacionEliminar);
  modalEliminarNodo?.addEventListener('shown.bs.modal', () => modalEliminarFrase?.focus());
  modalEliminarNodo?.addEventListener('hide.bs.modal', (evento) => {
    if (eliminacionEnCurso) evento.preventDefault();
  });
  modalEliminarNodo?.addEventListener('hidden.bs.modal', () => {
    const botonOrigen = eliminacionPendiente?.boton;
    eliminacionPendiente = null;
    modalEliminarFrase.value = '';
    sincronizarConfirmacionEliminar();
    if (botonOrigen?.isConnected) botonOrigen.focus();
    else inputBusqueda?.focus();
  });
  modalEliminarFormulario?.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    if (!eliminacionPendiente || eliminacionEnCurso ||
        modalEliminarFrase.value !== eliminacionPendiente.nombre) return;

    eliminacionEnCurso = true;
    modalEliminarConfirmar.disabled = true;
    modalEliminarConfirmarTexto.textContent = 'Eliminando…';
    modalEliminarFormulario.setAttribute('aria-busy', 'true');
    modalEliminarCerrar.forEach((boton) => { boton.disabled = true; });

    try {
      const datos = await fetchJson(
        `${urlEliminarBase}/${encodeURIComponent(eliminacionPendiente.id)}/eliminar`,
        { method: 'POST' }
      );
      window.portalToast?.show({
        tipo: 'satisfactorio',
        titulo: 'Usuario eliminado',
        cuerpo: datos.mensaje || 'El usuario se ha eliminado correctamente.'
      });
      eliminacionEnCurso = false;
      obtenerModalEliminar()?.hide();
      if (estado.page > 1 && contenedorFilas.children.length <= 1) {
        estado.page -= 1;
      }
      await cargar();
    } catch (error) {
      modalEliminarError.textContent = error.message || 'No se pudo eliminar el usuario.';
      modalEliminarError.hidden = false;
    } finally {
      eliminacionEnCurso = false;
      modalEliminarFormulario.removeAttribute('aria-busy');
      modalEliminarConfirmarTexto.textContent = 'Eliminar usuario';
      modalEliminarCerrar.forEach((boton) => { boton.disabled = false; });
      sincronizarConfirmacionEliminar();
    }
  });

  const renderizarFilas = function (usuarios) {
    contenedorFilas.innerHTML = usuarios
      .map((item) => {
        const permisos = Array.isArray(item.permisosDetalle)
          ? item.permisosDetalle
          : [];
        const permisosActivos = permisos.filter((permiso) => permiso.activo);
        const permisosInactivos = permisos.filter((permiso) => !permiso.activo);
        const permisosOrdenados = [...permisosActivos, ...permisosInactivos];

        return `
          <tr>
            <td><strong>#${item.id}</strong></td>
            <td>
              <div class="celda-clave usuarios-tabla__identidad">
                <strong>${escapeHtml(item.usuario)}</strong>
                <span class="etiqueta-secundaria usuarios-tabla__email">${escapeHtml(item.email)}</span>
                <span
                  class="estado-badge estado-badge--compacto ${item.emailValidado ? 'estado-badge--activo' : 'estado-badge--pendiente'}"
                  aria-label="${item.emailValidado ? 'Email validado' : 'Email no validado'}"
                >
                  <i class="bi ${item.emailValidado ? 'bi-patch-check' : 'bi-exclamation-circle'}" aria-hidden="true"></i>
                  ${item.emailValidado ? 'Email validado' : 'Email no validado'}
                </span>
                ${item.esUsuarioActual ? '<span class="etiqueta-secundaria">Sesión actual</span>' : ''}
              </div>
            </td>
            <td>${escapeHtml(item.nombreMostrar || item.nombreCompleto || '-')}</td>
            <td>${escapeHtml(item.tenantNombre || '-')}</td>
            <td>${escapeHtml(item.empresaNombre || '-')}</td>
            <td>
              <div class="usuario-permisos-celda">
                <button
                  type="button"
                  class="usuario-permisos-popover__boton"
                  data-accion-ver-permisos
                  data-usuario-nombre="${escapeHtml(item.usuario)}"
                  data-permisos='${escapeHtml(JSON.stringify(permisosOrdenados))}'
                >
                  <i class="bi bi-shield-check" aria-hidden="true"></i>
                  <span>Permisos</span>
                  <span class="usuario-permisos-popover__contador">${permisosActivos.length}</span>
                </button>
              </div>
            </td>
            <td>
              <span class="estado-badge ${item.activo ? 'estado-badge--activo' : 'estado-badge--inactivo'}">
                ${item.activo ? 'Activo' : 'Inactivo'}
              </span>
            </td>
            <td>
              <div class="metadatos-configuracion usuarios-tabla__fechas">
                <span><code>${escapeHtml(formatearFecha(item.fechaCreacion))}</code></span>
                <span>Acceso: <code>${escapeHtml(formatearFecha(item.ultimoAcceso || 'nunca'))}</code></span>
              </div>
            </td>
            <td class="text-end">
              <div class="usuarios-tabla__acciones">
                <div class="dropup usuarios-tabla__acciones">
                  <button
                    type="button"
                    class="btn btn-outline-secondary btn-sm usuarios-tabla__acciones-toggle"
                    data-bs-toggle="dropdown"
                    data-bs-auto-close="outside"
                    aria-expanded="false"
                    aria-label="Acciones de ${escapeHtml(item.usuario)}"
                  >
                    <i class="bi bi-gear" aria-hidden="true"></i>
                  </button>
                  <div class="dropdown-menu dropdown-menu-end usuarios-tabla__acciones-menu">
                    <a
                      href="${escapeHtml(item.urls.editar)}"
                      class="dropdown-item d-flex align-items-center gap-2"
                    >
                      <i class="bi bi-pencil-square" aria-hidden="true"></i>
                      <span>Editar usuario</span>
                    </a>
                    <button
                      type="button"
                      class="dropdown-item dropdown-item--danger d-flex align-items-center gap-2"
                      data-accion-eliminar
                      data-usuario-id="${item.id}"
                      data-usuario-nombre="${escapeHtml(item.usuario)}"
                      data-usuario-email="${escapeHtml(item.email)}"
                      ${item.esUsuarioActual ? 'disabled' : ''}
                    >
                      <i class="bi bi-trash3" aria-hidden="true"></i>
                      <span>Eliminar…</span>
                    </button>
                  </div>
                </div>
              </div>
            </td>
          </tr>
        `;
      })
      .join('');

    inicializarTooltipsLocales(contenedorFilas);
  };

  const abrirModalPermisos = function (nombreUsuario, permisos) {
    const modalPermisos = obtenerModalPermisos();

    if (!modalPermisos || !modalPermisosFilas) {
      return;
    }

    const permisosLista = Array.isArray(permisos) ? permisos : [];
    const activos = permisosLista.filter((permiso) => permiso.activo);
    const inactivos = permisosLista.filter((permiso) => !permiso.activo);

    if (modalPermisosTitulo) {
      modalPermisosTitulo.textContent = `Permisos de ${nombreUsuario}`;
    }

    if (modalPermisosSubtitulo) {
      modalPermisosSubtitulo.textContent =
        `${activos.length} activos de ${permisosLista.length} disponibles.`;
    }

    if (modalPermisosResumen) {
      modalPermisosResumen.innerHTML = `
        <span class="chip-simple chip-simple--ok">Activos ${activos.length}</span>
        <span class="chip-simple">Inactivos ${inactivos.length}</span>
      `;
    }

    modalPermisosFilas.innerHTML =
      permisosLista.length > 0
        ? permisosLista.map((permiso) => `
          <tr class="${permiso.activo ? 'usuarios-permisos-modal__fila--activo' : 'usuarios-permisos-modal__fila--inactivo'}">
            <td>
              <div class="usuario-permiso-celda">
                <span class="usuario-permiso-item__icono" aria-hidden="true">
                  <i class="bi bi-${escapeHtml(permiso.icono || 'shield-check')}"></i>
                </span>
                <div class="usuario-permiso-item__texto">
                  <strong>${escapeHtml(permiso.etiqueta)}</strong>
                  ${permiso.oculto ? '<span class="etiqueta-secundaria">Permiso interno</span>' : ''}
                </div>
              </div>
            </td>
            <td>
              <span class="estado-badge ${permiso.activo ? 'estado-badge--activo' : 'estado-badge--inactivo'}">
                ${permiso.activo ? 'Activo' : 'Inactivo'}
              </span>
            </td>
            <td class="text-body-secondary small">${escapeHtml(permiso.descripcion)}</td>
            <td class="text-center">
              <button
                type="button"
                class="usuario-permiso-item__ayuda"
                data-bs-toggle="tooltip"
                data-bs-placement="left"
                title="${escapeHtml(permiso.descripcion)}"
                aria-label="Información sobre ${escapeHtml(permiso.etiqueta)}"
              >
                <i class="bi bi-info-circle" aria-hidden="true"></i>
              </button>
            </td>
          </tr>
        `).join('')
        : '<tr><td colspan="4" class="text-body-secondary">No hay permisos definidos para este usuario.</td></tr>';

    inicializarTooltipsLocales(modalPermisosNodo);
    modalPermisos.show();
  };

  const construirQuery = function () {
    const parametros = new URLSearchParams();
    parametros.set('q', estado.q);
    parametros.set('tenant_id', estado.tenantId);
    parametros.set('empresa_id', estado.empresaId);
    parametros.set('sitio_id', estado.sitioId);
    parametros.set('activo', estado.activo);
    parametros.set('page', String(estado.page));
    parametros.set('page_size', String(estado.pageSize));
    parametros.set('sort_by', estado.sortBy);
    parametros.set('sort_dir', estado.sortDir);
    return parametros.toString();
  };

  const sincronizarUrl = function () {
    const url = new URL(window.location.href);
    const valores = {
      q: [estado.q, ''],
      tenant_id: [estado.tenantId, ''],
      empresa_id: [estado.empresaId, ''],
      sitio_id: [estado.sitioId, ''],
      activo: [estado.activo, 'solo_activos'],
      page: [String(estado.page), '1'],
      page_size: [String(estado.pageSize), '10'],
      sort_by: [estado.sortBy, 'creado'],
      sort_dir: [estado.sortDir, 'desc']
    };

    for (const [clave, [valor, porDefecto]] of Object.entries(valores)) {
      if (!valor || valor === porDefecto) {
        url.searchParams.delete(clave);
      } else {
        url.searchParams.set(clave, valor);
      }
    }

    window.history.replaceState({}, '', url);
  };

  const cargar = async function () {
    contenedorEstado.textContent = 'Cargando usuarios...';
    contenedorFilas.innerHTML = '';

    try {
      const datos = await fetchJson(`${urlListado}?${construirQuery()}`);
      estado.totalPaginas = datos.paginacion.totalPaginas;
      renderizarFilas(datos.usuarios || []);
      actualizarResumen(datos);
      actualizarOrdenVisual();
      actualizarPaginacionVisual();
      sincronizarUrl();

      contenedorEstado.textContent =
        (datos.usuarios || []).length > 0
          ? ''
          : 'No hay usuarios visibles con el filtro actual.';

      if ((datos.usuarios || []).length === 0) {
        contenedorFilas.innerHTML = `
          <tr>
            <td colspan="9" class="text-body-secondary">
              No hay usuarios visibles con el filtro actual.
            </td>
          </tr>
        `;
      }
    } catch (error) {
      contenedorEstado.textContent = error.message;
      contenedorFilas.innerHTML = `
        <tr>
          <td colspan="9" class="text-body-secondary">
            ${escapeHtml(error.message)}
          </td>
        </tr>
      `;
      window.portalToast?.show({
        tipo: 'error',
        titulo: 'No se pudo cargar el directorio',
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

  if (inputBusqueda) {
    inputBusqueda.addEventListener('input', programarCarga);
  }

  if (selectorTenant) {
    selectorTenant.addEventListener('change', async function () {
      estado.sitioId = '';
      await cargarEmpresas(selectorTenant.value, '');
      aplicarEstadoDesdeControles({ resetearPagina: true });
      await cargar();
    });
  }

  if (selectorEmpresa) {
    selectorEmpresa.addEventListener('change', async function () {
      estado.sitioId = '';
      aplicarEstadoDesdeControles({ resetearPagina: true });
      await cargar();
    });
  }

  if (selectorActivo) {
    selectorActivo.addEventListener('change', async function () {
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

  if (botonAplicar) {
    botonAplicar.addEventListener('click', async function () {
      aplicarEstadoDesdeControles({ resetearPagina: true });
      await cargar();
    });
  }

  if (botonLimpiar) {
    botonLimpiar.addEventListener('click', async function () {
      if (inputBusqueda) inputBusqueda.value = '';
      if (selectorTenant) selectorTenant.value = '';
      estado.sitioId = '';
      if (selectorActivo) selectorActivo.value = 'solo_activos';
      if (selectorPageSize) selectorPageSize.value = '10';
      await cargarEmpresas('', '');
      aplicarEstadoDesdeControles({ resetearPagina: true });
      estado.sortBy = 'creado';
      estado.sortDir = 'desc';
      await cargar();
    });
  }

  for (const boton of botonesOrden) {
    boton.addEventListener('click', async function () {
      const sortBy = boton.dataset.sortBy;

      if (estado.sortBy === sortBy) {
        estado.sortDir = estado.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        estado.sortBy = sortBy;
        estado.sortDir = sortBy === 'id' ? 'asc' : 'desc';
      }

      estado.page = 1;
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

  contenedorFilas.addEventListener('click', async function (evento) {
    const botonPermisos = evento.target.closest('[data-accion-ver-permisos]');

    if (botonPermisos) {
      try {
        const permisos = JSON.parse(botonPermisos.dataset.permisos || '[]');
        abrirModalPermisos(
          botonPermisos.dataset.usuarioNombre || 'usuario',
          permisos
        );
      } catch (_error) {
        window.portalToast?.show({
          tipo: 'error',
          titulo: 'No se pudieron abrir los permisos',
          cuerpo: 'El detalle del usuario está dañado o incompleto.'
        });
      }
      return;
    }

    const boton = evento.target.closest('[data-accion-eliminar]');

    if (!boton) {
      return;
    }

    abrirModalEliminar(boton);
  });

  (async function init() {
    const empresaIdInicial = new URL(window.location.href)
      .searchParams.get('empresa_id') || '';
    await cargarEmpresas(selectorTenant?.value || '', empresaIdInicial);
    aplicarEstadoDesdeControles({ resetearPagina: true });
    await cargar();
  })().catch(function (error) {
    window.portalToast?.show({
      tipo: 'error',
      titulo: 'Error al preparar el directorio',
      cuerpo: error.message
    });
  });
}

function inicializarFormularioUsuario(modulo) {
  const urlEmpresas = modulo.dataset.urlEmpresas;
  const urlSitios = modulo.dataset.urlSitios;
  const urlGuardar = modulo.dataset.urlGuardar;
  const urlVolver = modulo.dataset.urlVolver || '/usuarios';
  const autoedicionBloqueada = modulo.dataset.autoedicionBloqueada === '1';
  const formulario = modulo.querySelector('[data-usuario-formulario-submit]');
  const selectorNivel = modulo.querySelector('[data-scope-nivel]');
  const selectorTenant = modulo.querySelector('[data-scope-tenant]');
  const selectorEmpresa = modulo.querySelector('[data-scope-empresa]');
  const selectorSitio = modulo.querySelector('[data-scope-sitio]');
  const campoTenant = modulo.querySelector('[data-campo-scope="tenant"]');
  const campoEmpresa = modulo.querySelector('[data-campo-scope="empresa"]');
  const campoSitio = modulo.querySelector('[data-campo-scope="sitio"]');
  const botonGuardar = modulo.querySelector('[data-boton-guardar]');
  const ayudaScopeEmpresa = modulo.querySelector('[data-scope-tooltip="empresa"]');
  const ayudaScopeSitio = modulo.querySelector('[data-scope-tooltip="sitio"]');
  const textoAyudaScopeEmpresa = modulo.querySelector('[data-scope-ayuda="empresa"]');
  const textoAyudaScopeSitio = modulo.querySelector('[data-scope-ayuda="sitio"]');
  const inputBusquedaPermisos = modulo.querySelector('[data-permisos-busqueda]');
  const gruposPermisos = Array.from(modulo.querySelectorAll('[data-permisos-grupo]'));
  const itemsPermisos = Array.from(modulo.querySelectorAll('[data-permiso-item]'));
  const checkboxesPermisos = Array.from(modulo.querySelectorAll('[data-permiso-checkbox]'));
  const resumenPermisosActivos = modulo.querySelector('[data-permisos-resumen-activos]');
  const resumenPermisosEditables = modulo.querySelector('[data-permisos-resumen-editables]');
  const resumenPermisosBloqueados = modulo.querySelector('[data-permisos-resumen-bloqueados]');
  const resumenPermisosVisibles = modulo.querySelector('[data-permisos-resumen-visibles]');
  const estadoPermisosVacio = modulo.querySelector('[data-permisos-vacio]');
  const avisoSinPanel = modulo.querySelector('[data-permiso-panel-aviso]');
  const modalRevisionNodo = modulo.querySelector('[data-usuario-revision-modal]');
  const botonConfirmarRevision = modalRevisionNodo?.querySelector('[data-revision-confirmar]');
  const errorRevision = modalRevisionNodo?.querySelector('[data-revision-error]');
  const modalRevisionCambiosNodo = modulo.querySelector('[data-usuario-revision-cambios-modal]');
  const botonConfirmarRevisionCambios = modalRevisionCambiosNodo?.querySelector('[data-revision-cambios-confirmar]');
  const errorRevisionCambios = modalRevisionCambiosNodo?.querySelector('[data-revision-cambios-error]');
  const esAlta = modulo.dataset.modo === 'nuevo';
  const esEdicion = modulo.dataset.modo === 'editar';
  let revisionInicial = null;
  let aperturaGruposAntesBusqueda = null;
  const avisoCambiosPendientes = modulo.querySelector('[data-cambios-pendientes]');
  const seccionesFormulario = {
    identidad: modulo.querySelector('[data-usuario-seccion="identidad"]'),
    scope: modulo.querySelector('[data-usuario-seccion="scope"]'),
    permisos: modulo.querySelector('[data-usuario-seccion="permisos"]')
  };
  const mapaSeccionPorCampo = {
    usuario: 'identidad',
    email: 'identidad',
    nombre_mostrar: 'identidad',
    nombre_completo: 'identidad',
    password: 'identidad',
    password_confirmacion: 'identidad',
    nivel_scope: 'scope',
    tenant_id: 'scope',
    empresa_id: 'scope',
    sitio_id: 'scope'
  };
  const estadoFormulario = {
    sucio: false,
    enviando: false,
    firmaInicial: ''
  };
  const dependenciasPermisos = {
    permiso_editar_dns: ['permiso_ver_dns'],
    permiso_publicar_dns: ['permiso_ver_dns', 'permiso_editar_dns'],
    permiso_administrar_dns_avanzado: [
      'permiso_ver_dns',
      'permiso_editar_dns',
      'permiso_publicar_dns'
    ],
    permiso_modificar_agentes: ['permiso_ver_agentes'],
    permiso_eliminar_agentes: ['permiso_ver_agentes']
  };
  const permisosPermitidosPorScope = {
    permiso_administrar_configuracion: ['portal'],
    permiso_administrar_tenants: ['portal', 'tenant'],
    permiso_administrar_empresas: ['portal', 'tenant', 'empresa']
  };
  const dependientesPermisos = Object.entries(dependenciasPermisos).reduce(
    function (acumulado, entrada) {
      const permiso = entrada[0];
      const dependencias = entrada[1];

      for (const dependencia of dependencias) {
        if (!acumulado[dependencia]) {
          acumulado[dependencia] = [];
        }

        acumulado[dependencia].push(permiso);
      }

      return acumulado;
    },
    {}
  );
  const mapaCheckboxesPermisos = new Map(
    checkboxesPermisos.map(function (checkbox) {
      return [checkbox.dataset.permisoClave || checkbox.name, checkbox];
    })
  );

  const obtenerContenedorCampo = function (campo) {
    return campo?.closest('div') || campo?.parentElement || null;
  };

  const obtenerSeccionCampo = function (campo) {
    const nombre = campo?.getAttribute('name') || '';
    return mapaSeccionPorCampo[nombre] || 'identidad';
  };

  const obtenerFeedbackCampo = function (campo) {
    const contenedor = obtenerContenedorCampo(campo);

    if (!contenedor) {
      return null;
    }

    let feedback = contenedor.querySelector(
      `[data-validacion-feedback="${campo.name}"]`
    );

    if (!feedback) {
      feedback = document.createElement('div');
      feedback.className = 'form-feedback';
      feedback.dataset.validacionFeedback = campo.name;
      feedback.hidden = true;
      contenedor.appendChild(feedback);
    }

    return feedback;
  };

  const actualizarEstadoSeccion = function (claveSeccion) {
    const seccion = seccionesFormulario[claveSeccion];

    if (!seccion) {
      return;
    }

    const tieneErrores = Boolean(
      seccion.querySelector('.form-control-invalido, .form-feedback:not([hidden])')
    );

    seccion.classList.toggle('card-validacion-error', tieneErrores);
  };

  const limpiarErrorCampo = function (campo) {
    if (!campo) {
      return;
    }

    campo.classList.remove('form-control-invalido');
    campo.removeAttribute('aria-invalid');

    const feedback = obtenerFeedbackCampo(campo);

    if (feedback) {
      feedback.textContent = '';
      feedback.hidden = true;
    }

    actualizarEstadoSeccion(obtenerSeccionCampo(campo));
  };

  const marcarCampoInvalido = function (campo, mensaje) {
    if (!campo) {
      return;
    }

    campo.classList.add('form-control-invalido');
    campo.setAttribute('aria-invalid', 'true');

    const feedback = obtenerFeedbackCampo(campo);

    if (feedback) {
      feedback.textContent = mensaje;
      feedback.hidden = false;
    }

    actualizarEstadoSeccion(obtenerSeccionCampo(campo));
  };

  const limpiarValidacionFormulario = function () {
    for (const campo of Array.from(formulario?.querySelectorAll('input, select, textarea') || [])) {
      limpiarErrorCampo(campo);
    }

    for (const seccion of Object.values(seccionesFormulario)) {
      seccion?.classList.remove('card-validacion-error');
    }
  };

  const enfocarPrimerError = function (errores) {
    const primerCampo = errores.find((error) => error.campo)?.campo;

    if (primerCampo) {
      primerCampo.focus();
      primerCampo.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    const primeraSeccion = errores.find((error) => error.seccion)?.seccion;
    const nodoSeccion = primeraSeccion ? seccionesFormulario[primeraSeccion] : null;

    if (nodoSeccion) {
      nodoSeccion.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const validarFormulario = function () {
    limpiarValidacionFormulario();

    const errores = [];

    const registrarError = function ({ campo = null, mensaje, seccion = null }) {
      errores.push({ campo, mensaje, seccion });

      if (campo) {
        marcarCampoInvalido(campo, mensaje);
        return;
      }

      if (seccion && seccionesFormulario[seccion]) {
        seccionesFormulario[seccion].classList.add('card-validacion-error');
      }
    };

    const usuario = formulario.querySelector('[name="usuario"]');
    const email = formulario.querySelector('[name="email"]');
    const password = formulario.querySelector('[name="password"]');
    const passwordConfirmacion = formulario.querySelector('[name="password_confirmacion"]');
    const valorEmail = String(email?.value || '').trim();
    const regexEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (usuario && !String(usuario.value || '').trim()) {
      registrarError({
        campo: usuario,
        mensaje: 'Indica el identificador del usuario.',
        seccion: 'identidad'
      });
    }

    if (email && !valorEmail) {
      registrarError({
        campo: email,
        mensaje: 'El email es obligatorio.',
        seccion: 'identidad'
      });
    } else if (email && !regexEmail.test(valorEmail)) {
      registrarError({
        campo: email,
        mensaje: 'Introduce un email con formato válido.',
        seccion: 'identidad'
      });
    }

    if (password && !String(password.value || '').trim()) {
      registrarError({
        campo: password,
        mensaje: 'La clave temporal es obligatoria.',
        seccion: 'identidad'
      });
    }

    if (passwordConfirmacion && !String(passwordConfirmacion.value || '').trim()) {
      registrarError({
        campo: passwordConfirmacion,
        mensaje: 'Confirma la clave temporal.',
        seccion: 'identidad'
      });
    } else if (
      password &&
      passwordConfirmacion &&
      String(password.value || '') !== String(passwordConfirmacion.value || '')
    ) {
      registrarError({
        campo: passwordConfirmacion,
        mensaje: 'La confirmación no coincide con la clave temporal.',
        seccion: 'identidad'
      });
    }

    if (selectorNivel && !String(selectorNivel.value || '').trim()) {
      registrarError({
        campo: selectorNivel,
        mensaje: 'Selecciona un nivel de alcance.',
        seccion: 'scope'
      });
    }

    if (selectorTenant?.required && !String(selectorTenant.value || '').trim()) {
      registrarError({
        campo: selectorTenant,
        mensaje: 'Selecciona un tenant para este alcance.',
        seccion: 'scope'
      });
    }

    if (selectorEmpresa?.required && !String(selectorEmpresa.value || '').trim()) {
      registrarError({
        campo: selectorEmpresa,
        mensaje: 'Selecciona una empresa para este alcance.',
        seccion: 'scope'
      });
    }

    if (selectorSitio?.required && !String(selectorSitio.value || '').trim()) {
      registrarError({
        campo: selectorSitio,
        mensaje: 'Selecciona un sitio para este alcance.',
        seccion: 'scope'
      });
    }

    if (errores.length > 0) {
      const cuerpoToast = errores
        .slice(0, 3)
        .map((error) => error.mensaje)
        .join(' ');

      window.portalToast?.show({
        tipo: 'advertencia',
        titulo:
          errores.length === 1
            ? 'Falta un dato obligatorio'
            : `Faltan ${errores.length} comprobaciones por revisar`,
        cuerpo: cuerpoToast
      });

      enfocarPrimerError(errores);
    }

    return errores.length === 0;
  };

  const vaciarSelect = function (selector, placeholder) {
    if (!selector) {
      return;
    }

    selector.innerHTML = `<option value="">${placeholder}</option>`;
  };

  const capturarFirmaFormulario = function () {
    if (!formulario) {
      return '';
    }

    return JSON.stringify(
      Array.from(new FormData(formulario).entries()).sort(function (a, b) {
        const claveA = `${a[0]}::${a[1]}`;
        const claveB = `${b[0]}::${b[1]}`;
        return claveA.localeCompare(claveB);
      })
    );
  };

  const actualizarAvisoCambiosPendientes = function () {
    if (!avisoCambiosPendientes) {
      return;
    }

    avisoCambiosPendientes.hidden = !estadoFormulario.sucio;
  };

  const recalcularEstadoSucio = function () {
    estadoFormulario.sucio =
      !estadoFormulario.enviando &&
      capturarFirmaFormulario() !== estadoFormulario.firmaInicial;
    actualizarAvisoCambiosPendientes();
  };

  const hayPermisosEditablesActivos = function () {
    return checkboxesPermisos.some(function (checkbox) {
      return !checkbox.disabled && checkbox.checked;
    });
  };

  const anunciarRevisionPermisosPorScope = function () {
    if (!hayPermisosEditablesActivos()) {
      return;
    }

    window.portalToast?.show({
      tipo: 'informativo',
      titulo: 'Revisa los permisos tras cambiar el alcance',
      cuerpo: 'Algunos permisos pueden quedar sin efecto o requerir un contexto más concreto.'
    });
  };

  const actualizarTooltipScope = function (contenedor, mensaje) {
    if (!contenedor || !window.bootstrap?.Tooltip) {
      return;
    }

    const instanciaExistente = window.bootstrap.Tooltip.getInstance(contenedor);

    if (!mensaje) {
      contenedor.removeAttribute('data-bs-toggle');
      contenedor.removeAttribute('data-bs-trigger');
      contenedor.removeAttribute('data-bs-placement');
      contenedor.removeAttribute('data-bs-title');
      contenedor.removeAttribute('title');
      contenedor.classList.remove('scope-select-ayuda--bloqueado');
      contenedor.setAttribute('tabindex', '-1');
      instanciaExistente?.dispose();
      return;
    }

    contenedor.dataset.bsToggle = 'tooltip';
    contenedor.dataset.bsTrigger = 'hover focus click';
    contenedor.dataset.bsPlacement = 'top';
    contenedor.dataset.bsTitle = mensaje;
    contenedor.setAttribute('title', mensaje);
    contenedor.classList.add('scope-select-ayuda--bloqueado');
    contenedor.setAttribute('tabindex', '0');

    if (instanciaExistente) {
      instanciaExistente.dispose();
    }

    new window.bootstrap.Tooltip(contenedor);
  };

  const actualizarDisponibilidadScope = function () {
    const tenantSeleccionado = Boolean(String(selectorTenant?.value || '').trim());
    const empresaSeleccionada = Boolean(String(selectorEmpresa?.value || '').trim());
    const empresaBloqueada = !tenantSeleccionado && !autoedicionBloqueada;
    const sitioBloqueado = !empresaSeleccionada && !autoedicionBloqueada;

    if (selectorEmpresa) {
      selectorEmpresa.disabled = autoedicionBloqueada || !tenantSeleccionado;
    }

    if (selectorSitio) {
      selectorSitio.disabled = autoedicionBloqueada || !empresaSeleccionada;
    }

    actualizarTooltipScope(
      ayudaScopeEmpresa,
      autoedicionBloqueada
        ? 'Tu propia sesión no puede cambiar la empresa desde aquí.'
        : tenantSeleccionado
          ? ''
          : 'Selecciona antes un tenant para desbloquear la empresa.'
    );
    actualizarTooltipScope(
      ayudaScopeSitio,
      autoedicionBloqueada
        ? 'Tu propia sesión no puede cambiar el sitio desde aquí.'
        : empresaSeleccionada
          ? ''
          : 'Selecciona antes una empresa para desbloquear el sitio.'
    );

    if (textoAyudaScopeEmpresa) {
      textoAyudaScopeEmpresa.hidden = !empresaBloqueada;
    }

    if (textoAyudaScopeSitio) {
      textoAyudaScopeSitio.hidden = !sitioBloqueado;
    }
  };

  const poblarSelect = function (selector, opciones, seleccionActual) {
    if (!selector) {
      return;
    }

    const placeholder = selector === selectorEmpresa
      ? 'Selecciona empresa'
      : 'Selecciona sitio';

    vaciarSelect(selector, placeholder);

    for (const opcion of opciones) {
      const nodo = document.createElement('option');
      nodo.value = String(opcion.valor);
      nodo.textContent = opcion.etiqueta;

      if (opcion.tenantId != null) {
        nodo.dataset.tenantId = String(opcion.tenantId);
      }

      if (opcion.empresaId != null) {
        nodo.dataset.empresaId = String(opcion.empresaId);
      }

      if (String(opcion.valor) === String(seleccionActual || '')) {
        nodo.selected = true;
      }

      selector.appendChild(nodo);
    }
  };

  const cargarEmpresas = async function (seleccionActual = '') {
    const tenantId = selectorTenant?.value || '';

    vaciarSelect(selectorEmpresa, 'Selecciona empresa');
    vaciarSelect(selectorSitio, 'Selecciona sitio');
    actualizarDisponibilidadScope();

    if (!tenantId) {
      return;
    }

    const datos = await fetchJson(
      `${urlEmpresas}?tenant_id=${encodeURIComponent(tenantId)}`
    );
    poblarSelect(selectorEmpresa, datos.opciones || [], seleccionActual);
    actualizarDisponibilidadScope();
  };

  const cargarSitios = async function (seleccionActual = '') {
    const tenantId = selectorTenant?.value || '';
    const empresaId = selectorEmpresa?.value || '';

    vaciarSelect(selectorSitio, 'Selecciona sitio');
    actualizarDisponibilidadScope();

    if (!tenantId || !empresaId) {
      return;
    }

    const datos = await fetchJson(
      `${urlSitios}?tenant_id=${encodeURIComponent(tenantId)}&empresa_id=${encodeURIComponent(empresaId)}`
    );
    poblarSelect(selectorSitio, datos.opciones || [], seleccionActual);
    actualizarDisponibilidadScope();
  };

  const sincronizarCamposScope = function () {
    const nivel = selectorNivel ? selectorNivel.value : 'portal';
    const requiereTenant = ['tenant', 'empresa', 'sitio'].includes(nivel);
    const requiereEmpresa = ['empresa', 'sitio'].includes(nivel);
    const requiereSitio = nivel === 'sitio';

    if (campoTenant && selectorTenant) {
      campoTenant.hidden = !requiereTenant;
      selectorTenant.required = requiereTenant;

      if (!requiereTenant) {
        selectorTenant.value = '';
        limpiarErrorCampo(selectorTenant);
      }
    }

    if (campoEmpresa && selectorEmpresa) {
      campoEmpresa.hidden = !requiereEmpresa;
      selectorEmpresa.required = requiereEmpresa;

      if (!requiereEmpresa) {
        vaciarSelect(selectorEmpresa, 'Selecciona empresa');
        limpiarErrorCampo(selectorEmpresa);
      }
    }

    if (campoSitio && selectorSitio) {
      campoSitio.hidden = !requiereSitio;
      selectorSitio.required = requiereSitio;

      if (!requiereSitio) {
        vaciarSelect(selectorSitio, 'Selecciona sitio');
        limpiarErrorCampo(selectorSitio);
      }
    }

    actualizarDisponibilidadScope();
  };

  const marcarPermisoSiEditable = function (clavePermiso) {
    const checkbox = mapaCheckboxesPermisos.get(clavePermiso);

    if (!checkbox || checkbox.disabled || checkbox.checked) {
      return;
    }

    checkbox.checked = true;
    aplicarDependenciasPermiso(checkbox);
  };

  const desmarcarPermisoSiEditable = function (clavePermiso) {
    const checkbox = mapaCheckboxesPermisos.get(clavePermiso);

    if (!checkbox || checkbox.disabled || !checkbox.checked) {
      return;
    }

    checkbox.checked = false;
    aplicarDependenciasPermiso(checkbox);
  };

  const aplicarDependenciasPermiso = function (checkbox) {
    const clavePermiso = checkbox?.dataset?.permisoClave || checkbox?.name || '';

    if (!clavePermiso) {
      return;
    }

    if (checkbox.checked) {
      for (const dependencia of dependenciasPermisos[clavePermiso] || []) {
        marcarPermisoSiEditable(dependencia);
      }

      return;
    }

    for (const dependiente of dependientesPermisos[clavePermiso] || []) {
      desmarcarPermisoSiEditable(dependiente);
    }
  };

  const permisoEsCompatibleConScope = function (clavePermiso) {
    const scopesPermitidos = permisosPermitidosPorScope[clavePermiso];

    if (!scopesPermitidos) {
      return true;
    }

    return scopesPermitidos.includes(selectorNivel?.value || 'portal');
  };

  const actualizarPermisosPorScope = function () {
    for (const checkbox of checkboxesPermisos) {
      const clavePermiso = checkbox.dataset.permisoClave || checkbox.name || '';
      const editableBase = checkbox.dataset.permisoEditable === '1';
      const compatibleConScope = permisoEsCompatibleConScope(clavePermiso);
      const item = checkbox.closest('[data-permiso-item]');

      checkbox.disabled = !editableBase || !compatibleConScope;

      if (!compatibleConScope) {
        checkbox.checked = false;
      }

      if (item) {
        item.classList.toggle('tarjeta-permiso--bloqueada', checkbox.disabled);
        item.title = compatibleConScope
          ? ''
          : 'Este permiso no aplica al alcance seleccionado.';
      }
    }

    for (const checkbox of checkboxesPermisos) {
      if (checkbox.checked) {
        aplicarDependenciasPermiso(checkbox);
      }
    }
  };

  const actualizarResumenPermisos = function () {
    const visibles = itemsPermisos.filter(function (item) {
      return !item.hidden;
    });
    const activos = checkboxesPermisos.filter(function (checkbox) {
      return checkbox.checked;
    }).length;
    const editables = checkboxesPermisos.filter(function (checkbox) {
      return !checkbox.disabled;
    }).length;
    const bloqueados = checkboxesPermisos.length - editables;

    if (resumenPermisosActivos) {
      resumenPermisosActivos.textContent = `Activos ${activos}`;
    }

    if (resumenPermisosEditables) {
      resumenPermisosEditables.textContent = `Editables ${editables}`;
    }

    if (resumenPermisosBloqueados) {
      resumenPermisosBloqueados.textContent = `Bloqueados ${bloqueados}`;
    }

    if (resumenPermisosVisibles) {
      resumenPermisosVisibles.textContent = `Coinciden ${visibles.length}`;
    }

    for (const grupo of gruposPermisos) {
      const checkboxes = Array.from(grupo.querySelectorAll('[data-permiso-checkbox]'));
      const seleccionados = checkboxes.filter((checkbox) => checkbox.checked).length;
      const contador = grupo.querySelector('[data-grupo-contador]');
      const visiblesGrupo = checkboxes.filter((checkbox) => !checkbox.closest('[data-permiso-item]')?.hidden).length;
      if (contador) {
        const textoSeleccionados = `${seleccionados} ${seleccionados === 1 ? 'seleccionado' : 'seleccionados'}`;
        const textoVisibles = visiblesGrupo === checkboxes.length
          ? `${checkboxes.length} ${checkboxes.length === 1 ? 'permiso' : 'permisos'}`
          : `${visiblesGrupo} de ${checkboxes.length} visibles`;
        contador.textContent = `${textoSeleccionados} · ${textoVisibles}`;
      }
    }

    if (avisoSinPanel) {
      avisoSinPanel.hidden = Boolean(mapaCheckboxesPermisos.get('permiso_ver')?.checked);
    }
  };

  const filtrarPermisos = function () {
    const termino = String(inputBusquedaPermisos?.value || '')
      .trim()
      .toLowerCase();
    if (termino && !aperturaGruposAntesBusqueda) {
      aperturaGruposAntesBusqueda = new Map(gruposPermisos.map((grupo) => [grupo, grupo.open]));
    }
    let visibles = 0;

    for (const grupo of gruposPermisos) {
      const itemsGrupo = Array.from(grupo.querySelectorAll('[data-permiso-item]'));
      let visiblesGrupo = 0;

      for (const item of itemsGrupo) {
        const coincide =
          !termino ||
          String(item.dataset.permisoBusqueda || '').includes(termino);

        item.hidden = !coincide;

        if (coincide) {
          visiblesGrupo += 1;
          visibles += 1;
        }
      }

      grupo.hidden = visiblesGrupo === 0;
      if (termino && grupo.tagName === 'DETAILS' && visiblesGrupo > 0) {
        grupo.open = true;
      }
    }

    if (!termino && aperturaGruposAntesBusqueda) {
      for (const [grupo, abierto] of aperturaGruposAntesBusqueda) {
        grupo.open = abierto;
      }
      aperturaGruposAntesBusqueda = null;
    }

    if (estadoPermisosVacio) {
      estadoPermisosVacio.hidden = visibles > 0;
    }

    actualizarResumenPermisos();
  };

  if (selectorNivel) {
    selectorNivel.addEventListener('change', async function () {
      sincronizarCamposScope();
      actualizarPermisosPorScope();
      actualizarResumenPermisos();
      anunciarRevisionPermisosPorScope();

      if (selectorTenant && selectorTenant.value) {
        await cargarEmpresas('');
      }

      recalcularEstadoSucio();
    });
  }

  if (selectorTenant) {
    selectorTenant.addEventListener('change', async function () {
      await cargarEmpresas('');
      await cargarSitios('');
      actualizarPermisosPorScope();
      actualizarResumenPermisos();
      anunciarRevisionPermisosPorScope();
      recalcularEstadoSucio();
    });
  }

  if (selectorEmpresa) {
    selectorEmpresa.addEventListener('change', async function () {
      await cargarSitios('');
      actualizarPermisosPorScope();
      actualizarResumenPermisos();
      anunciarRevisionPermisosPorScope();
      recalcularEstadoSucio();
    });
  }

  if (selectorSitio) {
    selectorSitio.addEventListener('change', function () {
      actualizarPermisosPorScope();
      actualizarResumenPermisos();
      anunciarRevisionPermisosPorScope();
      recalcularEstadoSucio();
    });
  }

  if (formulario) {
    for (const campo of Array.from(formulario.querySelectorAll('input, select, textarea'))) {
      const evento = campo.tagName === 'SELECT' ? 'change' : 'input';
      campo.addEventListener(evento, function () {
        limpiarErrorCampo(campo);
        recalcularEstadoSucio();
      });
    }
  }

  for (const checkbox of checkboxesPermisos) {
    checkbox.addEventListener('change', function () {
      aplicarDependenciasPermiso(checkbox);
      actualizarResumenPermisos();
      recalcularEstadoSucio();
    });
  }

  if (inputBusquedaPermisos) {
    inputBusquedaPermisos.addEventListener('input', filtrarPermisos);
  }

  const capturarRevisionActual = function () {
    const textoSeleccionado = (selector) =>
      selector?.selectedOptions?.[0]?.textContent?.trim() || '';
    const nivel = selectorNivel?.value || '';
    const alcance = [textoSeleccionado(selectorNivel)];
    if (['tenant', 'empresa', 'sitio'].includes(nivel)) alcance.push(textoSeleccionado(selectorTenant));
    if (['empresa', 'sitio'].includes(nivel)) alcance.push(textoSeleccionado(selectorEmpresa));
    if (nivel === 'sitio') alcance.push(textoSeleccionado(selectorSitio));

    return {
      scopeIds: [nivel, selectorTenant?.value || '', selectorEmpresa?.value || '', selectorSitio?.value || ''],
      alcance: alcance.filter(Boolean).join(' · '),
      permisos: new Map(checkboxesPermisos.map((checkbox) => [
        checkbox.name,
        {
          activo: checkbox.checked,
          etiqueta: checkbox.closest('[data-permiso-item]')?.querySelector('strong')?.textContent?.trim() || checkbox.name
        }
      ]))
    };
  };

  const calcularCambiosSensibles = function () {
    if (!revisionInicial) return null;
    const actual = capturarRevisionActual();
    const alcanceCambiado = actual.scopeIds.some((valor, indice) => valor !== revisionInicial.scopeIds[indice]);
    const anadidos = [];
    const retirados = [];
    for (const [clave, permiso] of actual.permisos) {
      const antes = revisionInicial.permisos.get(clave)?.activo || false;
      if (permiso.activo && !antes) anadidos.push(permiso.etiqueta);
      if (!permiso.activo && antes) retirados.push(permiso.etiqueta);
    }
    return { alcanceCambiado, alcanceAnterior: revisionInicial.alcance, alcanceNuevo: actual.alcance, anadidos, retirados };
  };

  const mostrarRevisionCambios = function (cambios) {
    if (!modalRevisionCambiosNodo || !window.bootstrap?.Modal) {
      window.portalToast?.show({tipo: 'error', titulo: 'No se pudo abrir la revisión', cuerpo: 'Recarga la página y vuelve a intentarlo.'});
      return;
    }
    const bloqueAlcance = modalRevisionCambiosNodo.querySelector('[data-revision-cambios-alcance]');
    bloqueAlcance.hidden = !cambios.alcanceCambiado;
    if (cambios.alcanceCambiado) {
      modalRevisionCambiosNodo.querySelector('[data-revision-cambios-alcance-anterior]').textContent = cambios.alcanceAnterior;
      modalRevisionCambiosNodo.querySelector('[data-revision-cambios-alcance-nuevo]').textContent = cambios.alcanceNuevo;
    }
    for (const [tipo, nombres] of [['anadidos', cambios.anadidos], ['retirados', cambios.retirados]]) {
      modalRevisionCambiosNodo.querySelector(`[data-revision-cambios-${tipo}]`).hidden = nombres.length === 0;
      const lista = modalRevisionCambiosNodo.querySelector(`[data-revision-cambios-lista-${tipo}]`);
      lista.replaceChildren(...nombres.map((nombre) => {
        const item = document.createElement('li');
        item.textContent = nombre;
        return item;
      }));
    }
    modalRevisionCambiosNodo.querySelector('[data-revision-cambios-panel-aviso]').hidden =
      Boolean(mapaCheckboxesPermisos.get('permiso_ver')?.checked);
    if (errorRevisionCambios) errorRevisionCambios.hidden = true;
    window.bootstrap.Modal.getOrCreateInstance(modalRevisionCambiosNodo).show();
  };

  if (formulario) {
    const guardarUsuario = async function () {
      estadoFormulario.enviando = true;
      botonGuardar.disabled = true;
      if (botonConfirmarRevision) botonConfirmarRevision.disabled = true;
      if (botonConfirmarRevisionCambios) botonConfirmarRevisionCambios.disabled = true;
      if (errorRevision) {
        errorRevision.hidden = true;
        errorRevision.textContent = '';
      }
      if (errorRevisionCambios) {
        errorRevisionCambios.hidden = true;
        errorRevisionCambios.textContent = '';
      }

      try {
        const datos = await fetchJson(urlGuardar, {
          method: 'POST',
          headers: {
            'content-type': 'application/json'
          },
          body: JSON.stringify(Object.fromEntries(new FormData(formulario)))
        });

        window.portalToast?.persist({
          tipo: 'satisfactorio',
          titulo: 'Cambios aplicados',
          cuerpo: datos.mensaje || 'La operación se ha completado correctamente.'
        });
        window.location.assign(datos.redireccion || urlVolver);
      } catch (error) {
        estadoFormulario.enviando = false;
        botonGuardar.disabled = false;
        if (botonConfirmarRevision) botonConfirmarRevision.disabled = false;
        if (botonConfirmarRevisionCambios) botonConfirmarRevisionCambios.disabled = false;
        if (esAlta && errorRevision) {
          errorRevision.textContent = error.message || 'No se pudo crear el usuario.';
          errorRevision.hidden = false;
        } else if (esEdicion && modalRevisionCambiosNodo?.classList.contains('show') && errorRevisionCambios) {
          errorRevisionCambios.textContent = error.message || 'No se pudieron guardar los cambios.';
          errorRevisionCambios.hidden = false;
        } else {
          window.portalToast?.show({
            tipo: 'error',
            titulo: 'No se pudo guardar el formulario',
            cuerpo: error.message
          });
        }
      }
    };

    formulario.addEventListener('submit', async function (evento) {
      evento.preventDefault();

      if (!validarFormulario()) return;

      if (esAlta) {
        if (!modalRevisionNodo || !window.bootstrap?.Modal) {
          window.portalToast?.show({tipo: 'error', titulo: 'No se pudo abrir la revisión', cuerpo: 'Recarga la página y vuelve a intentarlo.'});
          return;
        }

        const textoSeleccionado = (selector) => selector?.selectedOptions?.[0]?.textContent?.trim() || '';
        const nivel = selectorNivel?.value || '';
        const alcance = [textoSeleccionado(selectorNivel)];
        if (['tenant', 'empresa', 'sitio'].includes(nivel)) alcance.push(textoSeleccionado(selectorTenant));
        if (['empresa', 'sitio'].includes(nivel)) alcance.push(textoSeleccionado(selectorEmpresa));
        if (nivel === 'sitio') alcance.push(textoSeleccionado(selectorSitio));
        modalRevisionNodo.querySelector('[data-revision-usuario]').textContent = formulario.elements.usuario.value.trim();
        modalRevisionNodo.querySelector('[data-revision-email]').textContent = formulario.elements.email.value.trim();
        modalRevisionNodo.querySelector('[data-revision-alcance]').textContent = alcance.filter(Boolean).join(' · ');
        const permisosSeleccionados = checkboxesPermisos.filter((checkbox) => checkbox.checked);
        const listaPermisos = modalRevisionNodo.querySelector('[data-revision-permisos]');
        listaPermisos.replaceChildren();
        for (const checkbox of permisosSeleccionados) {
          const item = document.createElement('li');
          item.textContent = checkbox.closest('[data-permiso-item]')?.querySelector('strong')?.textContent?.trim() || checkbox.name;
          listaPermisos.appendChild(item);
        }
        if (!permisosSeleccionados.length) {
          const item = document.createElement('li');
          item.textContent = 'Ninguno';
          listaPermisos.appendChild(item);
        }
        modalRevisionNodo.querySelector('[data-revision-permisos-total]').textContent = String(permisosSeleccionados.length);
        modalRevisionNodo.querySelector('[data-revision-panel-aviso]').hidden = Boolean(mapaCheckboxesPermisos.get('permiso_ver')?.checked);
        if (errorRevision) errorRevision.hidden = true;
        window.bootstrap.Modal.getOrCreateInstance(modalRevisionNodo).show();
        return;
      }

      if (esEdicion) {
        const cambios = calcularCambiosSensibles();
        if (!cambios) {
          window.portalToast?.show({tipo: 'advertencia', titulo: 'Formulario todavía cargando', cuerpo: 'Espera a que terminen de cargarse el alcance y los permisos.'});
          return;
        }
        if (cambios.alcanceCambiado || cambios.anadidos.length || cambios.retirados.length) {
          mostrarRevisionCambios(cambios);
          return;
        }
      }

      await guardarUsuario();
    });

    botonConfirmarRevision?.addEventListener('click', guardarUsuario);
    botonConfirmarRevisionCambios?.addEventListener('click', guardarUsuario);
    modalRevisionNodo?.addEventListener('hide.bs.modal', function (evento) {
      if (estadoFormulario.enviando) evento.preventDefault();
    });
    modalRevisionNodo?.addEventListener('hidden.bs.modal', function () {
      botonGuardar?.focus();
    });
    modalRevisionCambiosNodo?.addEventListener('hide.bs.modal', function (evento) {
      if (estadoFormulario.enviando) evento.preventDefault();
    });
    modalRevisionCambiosNodo?.addEventListener('hidden.bs.modal', function () {
      botonGuardar?.focus();
    });
  }

  window.addEventListener('beforeunload', function (evento) {
    if (!estadoFormulario.sucio || estadoFormulario.enviando) {
      return;
    }

    evento.preventDefault();
    evento.returnValue = '';
  });

  (async function init() {
    sincronizarCamposScope();
    const empresaActualInicial = selectorEmpresa?.value || '';
    const sitioActualInicial = selectorSitio?.value || '';

    if (selectorTenant?.value) {
      await cargarEmpresas(empresaActualInicial);
    }

    if (selectorTenant?.value && selectorEmpresa?.value) {
      await cargarSitios(sitioActualInicial);
    }

    actualizarDisponibilidadScope();
    actualizarPermisosPorScope();
    filtrarPermisos();
    estadoFormulario.firmaInicial = capturarFirmaFormulario();
    revisionInicial = capturarRevisionActual();
    recalcularEstadoSucio();
  })().catch(function (error) {
    window.portalToast?.show({
      tipo: 'error',
      titulo: 'Error al cargar el formulario',
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

function escapeHtml(texto) {
  return String(texto)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatearFecha(valor) {
  if (!valor || valor === 'nunca') {
    return 'nunca';
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
