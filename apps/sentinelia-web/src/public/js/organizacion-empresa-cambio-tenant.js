document.addEventListener('DOMContentLoaded', function () {
  const formulario = document.querySelector('[data-organizacion-tenant-formulario]');

  if (!formulario) {
    return;
  }

  const inputTenantId = formulario.querySelector('[data-organizacion-tenant-id]');
  const inputTenantTexto = formulario.querySelector(
    '[data-organizacion-tenant-texto]'
  );
  const listaSugerencias = formulario.querySelector(
    '[data-organizacion-tenant-sugerencias]'
  );
  const inputValidacion = formulario.querySelector(
    '[data-organizacion-tenant-validacion]'
  );
  const inputConfirmacion = formulario.querySelector(
    '[data-organizacion-confirmar-cambio-tenant]'
  );

  if (!inputTenantId || !inputTenantTexto || !listaSugerencias || !inputValidacion) {
    return;
  }

  const cambioTenant = crearGestorCambioTenant({
    formulario,
    inputTenantId,
    inputTenantTexto,
    inputConfirmacion
  });

  crearAutocompletadoTenant({
    formulario,
    inputTenantId,
    inputTenantTexto,
    inputValidacion,
    listaSugerencias,
    inputConfirmacion,
    cambioTenant
  });
});

function crearAutocompletadoTenant({
  formulario,
  inputTenantId,
  inputTenantTexto,
  inputValidacion,
  listaSugerencias,
  inputConfirmacion,
  cambioTenant
}) {
  const urlTenants = String(
    inputTenantTexto.dataset.organizacionUrlTenants || ''
  ).trim();
  const tenantPersistidoId = String(
    formulario.dataset.organizacionTenantActualId || inputTenantId.value || ''
  );
  const tenantPersistidoTexto = String(
    formulario.dataset.organizacionTenantActualTexto || inputTenantTexto.value || ''
  ).trim();

  let temporizador = null;
  let secuenciaPeticion = 0;
  let tenantSeleccionadoId = String(inputTenantId.value || '');
  let tenantSeleccionadoTexto = String(inputTenantTexto.value || '').trim();
  const indiceSugerencias = new Map();

  registrarSugerencia({
    id: tenantPersistidoId,
    texto: tenantPersistidoTexto
  });
  sincronizarValidacion();

  inputTenantTexto.addEventListener('focus', function () {
    void cargarSugerencias(inputTenantTexto.value);
  });

  inputTenantTexto.addEventListener('input', function () {
    if (inputConfirmacion) {
      inputConfirmacion.value = '';
    }

    resolverCoincidenciaExacta();
    sincronizarValidacion();
    window.clearTimeout(temporizador);
    temporizador = window.setTimeout(function () {
      void cargarSugerencias(inputTenantTexto.value);
    }, 180);
  });

  inputTenantTexto.addEventListener('change', function () {
    confirmarTextoActual();
  });

  inputTenantTexto.addEventListener('blur', function () {
    window.setTimeout(confirmarTextoActual, 120);
  });

  formulario.addEventListener('reset', function () {
    window.setTimeout(function () {
      tenantSeleccionadoId = String(inputTenantId.value || tenantPersistidoId);
      tenantSeleccionadoTexto = String(
        inputTenantTexto.value || tenantPersistidoTexto
      ).trim();
      registrarSugerencia({
        id: tenantSeleccionadoId,
        texto: tenantSeleccionadoTexto
      });
      sincronizarValidacion();
      cambioTenant?.restablecer();
      notificarInterfazTenant();
    }, 0);
  });

  formulario.addEventListener('submit', function (evento) {
    confirmarTextoActual();

    if (!String(inputTenantId.value || '').trim()) {
      evento.preventDefault();
      inputValidacion.setCustomValidity(
        'Selecciona un tenant válido desde las sugerencias.'
      );
      inputValidacion.reportValidity();
      inputTenantTexto.focus();
      return;
    }

    if (cambioTenant) {
      cambioTenant.validarAntesDeGuardar(evento);
    }
  });

  function confirmarTextoActual() {
    const coincidencia = buscarCoincidenciaExacta(inputTenantTexto.value);

    if (!coincidencia) {
      if (
        normalizarClaveTenant(inputTenantTexto.value) ===
        normalizarClaveTenant(tenantSeleccionadoTexto)
      ) {
        sincronizarValidacion();
        return;
      }

      if (
        normalizarClaveTenant(inputTenantTexto.value) ===
        normalizarClaveTenant(tenantPersistidoTexto)
      ) {
        aplicarSeleccionTenant({
          id: tenantPersistidoId,
          texto: tenantPersistidoTexto
        });
        return;
      }

      tenantSeleccionadoId = '';
      inputTenantId.value = '';
      sincronizarValidacion();
      return;
    }

    aplicarSeleccionTenant(coincidencia);
  }

  function resolverCoincidenciaExacta() {
    const coincidencia = buscarCoincidenciaExacta(inputTenantTexto.value);

    if (!coincidencia) {
      if (
        normalizarClaveTenant(inputTenantTexto.value) !==
        normalizarClaveTenant(tenantSeleccionadoTexto)
      ) {
        tenantSeleccionadoId = '';
        inputTenantId.value = '';
      }
      return;
    }

    if (
      String(coincidencia.id) === String(tenantSeleccionadoId) &&
      normalizarClaveTenant(coincidencia.texto) ===
        normalizarClaveTenant(tenantSeleccionadoTexto)
    ) {
      return;
    }

    aplicarSeleccionTenant(coincidencia);
  }

  function aplicarSeleccionTenant({ id, texto }) {
    const idNormalizado = String(id || '').trim();
    const textoNormalizado = String(texto || '').trim();
    const tenantAnteriorId = String(inputTenantId.value || '').trim();
    const tenantAnteriorTexto = String(tenantSeleccionadoTexto || '').trim();

    tenantSeleccionadoId = idNormalizado;
    tenantSeleccionadoTexto = textoNormalizado;
    inputTenantId.value = idNormalizado;
    inputTenantTexto.value = textoNormalizado;
    registrarSugerencia({
      id: idNormalizado,
      texto: textoNormalizado
    });
    sincronizarValidacion();

    if (cambioTenant) {
      cambioTenant.notificarSeleccionTenant({
        id: idNormalizado,
        texto: textoNormalizado,
        idAnterior: tenantAnteriorId,
        textoAnterior: tenantAnteriorTexto
      });
    }

    notificarInterfazTenant();
  }

  async function cargarSugerencias(textoBusqueda) {
    if (!urlTenants) {
      return;
    }

    const secuenciaActual = ++secuenciaPeticion;
    const url = new URL(urlTenants, window.location.origin);
    url.searchParams.set('q', String(textoBusqueda || '').trim());
    url.searchParams.set('limit', '12');

    try {
      const datos = await getJsonCambioTenant(url.toString());

      if (secuenciaActual !== secuenciaPeticion) {
        return;
      }

      const opciones = Array.isArray(datos.opciones) ? datos.opciones : [];
      listaSugerencias.innerHTML = '';

      for (const opcion of opciones) {
        const id = String(opcion.valor || '').trim();
        const texto = String(opcion.texto || '').trim();

        if (!id || !texto) {
          continue;
        }

        registrarSugerencia({
          id,
          texto
        });

        const nodo = document.createElement('option');
        nodo.value = texto;
        nodo.label = String(opcion.alias || '').trim()
          ? `alias ${opcion.alias}`
          : texto;
        listaSugerencias.appendChild(nodo);
      }
    } catch (_error) {
      // Las sugerencias no deben bloquear el formulario.
    }
  }

  function registrarSugerencia({ id, texto }) {
    if (!String(id || '').trim() || !String(texto || '').trim()) {
      return;
    }

    indiceSugerencias.set(normalizarClaveTenant(texto), {
      id: String(id).trim(),
      texto: String(texto).trim()
    });
  }

  function buscarCoincidenciaExacta(texto) {
    return indiceSugerencias.get(normalizarClaveTenant(texto)) || null;
  }

  function sincronizarValidacion() {
    const tenantId = String(inputTenantId.value || '').trim();
    inputValidacion.value = tenantId;
    inputValidacion.setCustomValidity(
      tenantId ? '' : 'Selecciona un tenant válido desde las sugerencias.'
    );
  }

  function notificarInterfazTenant() {
    formulario.dispatchEvent(new CustomEvent('organizacion:tenant-sincronizado'));
  }
}

function crearGestorCambioTenant({
  formulario,
  inputTenantId,
  inputTenantTexto,
  inputConfirmacion
}) {
  const modalNodo = document.querySelector('[data-organizacion-modal-cambio-tenant]');

  if (!modalNodo || !window.bootstrap?.Modal || !inputConfirmacion) {
    return null;
  }

  const modal = new window.bootstrap.Modal(modalNodo);
  const subtitulo = modalNodo.querySelector(
    '[data-organizacion-cambio-tenant-subtitulo]'
  );
  const descripcion = modalNodo.querySelector(
    '[data-organizacion-cambio-tenant-descripcion]'
  );
  const bloqueCargando = modalNodo.querySelector(
    '[data-organizacion-cambio-tenant-cargando]'
  );
  const bloqueError = modalNodo.querySelector(
    '[data-organizacion-cambio-tenant-error]'
  );
  const bloqueContenido = modalNodo.querySelector(
    '[data-organizacion-cambio-tenant-contenido]'
  );
  const totalVivo = modalNodo.querySelector('[data-cambio-tenant-total-vivo]');
  const totalHistorico = modalNodo.querySelector(
    '[data-cambio-tenant-total-historico]'
  );
  const totalBloqueos = modalNodo.querySelector(
    '[data-cambio-tenant-total-bloqueos]'
  );
  const tablaActualizaciones = modalNodo.querySelector(
    '[data-cambio-tenant-actualizaciones]'
  );
  const tablaHistorico = modalNodo.querySelector(
    '[data-cambio-tenant-historico]'
  );
  const tablaBloqueos = modalNodo.querySelector(
    '[data-cambio-tenant-bloqueos]'
  );
  const seccionBloqueos = modalNodo.querySelector(
    '[data-cambio-tenant-seccion-bloqueos]'
  );
  const botonConfirmar = modalNodo.querySelector(
    '[data-organizacion-cambio-tenant-confirmar]'
  );

  const tenantPersistidoId = String(
    formulario.dataset.organizacionTenantActualId || inputTenantId.value || ''
  );
  const tenantPersistidoTexto = String(
    formulario.dataset.organizacionTenantActualTexto || inputTenantTexto.value || ''
  ).trim();

  let tenantConfirmadoId =
    valorBooleano(inputConfirmacion.value) && inputTenantId.value
      ? String(inputTenantId.value)
      : tenantPersistidoId;
  let tenantConfirmadoTexto = String(inputTenantTexto.value || '').trim() ||
    tenantPersistidoTexto;
  let tenantPendienteId = null;
  let tenantPendienteTexto = null;
  let cambioConfirmadoEnModal = false;
  let guardadoPendienteTrasConfirmacion = false;

  botonConfirmar.addEventListener('click', function () {
    if (!tenantPendienteId) {
      return;
    }

    cambioConfirmadoEnModal = true;
    tenantConfirmadoId = tenantPendienteId;
    tenantConfirmadoTexto = tenantPendienteTexto || tenantConfirmadoTexto;
    inputTenantId.value = tenantConfirmadoId;
    inputTenantTexto.value = tenantConfirmadoTexto;
    inputConfirmacion.value = '1';
    guardadoPendienteTrasConfirmacion = true;
    modal.hide();
  });

  modalNodo.addEventListener('hidden.bs.modal', function () {
    const debeGuardarAhora = guardadoPendienteTrasConfirmacion;

    if (!cambioConfirmadoEnModal && tenantPendienteId) {
      inputTenantId.value = tenantConfirmadoId || tenantPersistidoId;
      inputTenantTexto.value = tenantConfirmadoTexto || tenantPersistidoTexto;
      formulario.dispatchEvent(
        new CustomEvent('organizacion:tenant-sincronizado')
      );
    }

    tenantPendienteId = null;
    tenantPendienteTexto = null;
    cambioConfirmadoEnModal = false;
    guardadoPendienteTrasConfirmacion = false;
    subtitulo.textContent =
      'Se está evaluando el impacto antes de aplicar el movimiento.';
    descripcion.textContent =
      'Se cargará el detalle de impacto antes de permitir la confirmación.';
    bloqueError.classList.add('d-none');
    bloqueError.textContent = '';
    bloqueContenido.classList.add('d-none');
    bloqueCargando.classList.remove('d-none');
    totalVivo.textContent = '0';
    totalHistorico.textContent = '0';
    totalBloqueos.textContent = '0';
    tablaActualizaciones.innerHTML = '';
    tablaHistorico.innerHTML = '';
    tablaBloqueos.innerHTML = '';
    seccionBloqueos.classList.add('d-none');
    establecerTextoBotonConfirmar({
      boton: botonConfirmar,
      icono: 'check2-circle',
      texto: 'Guardar cambio de tenant'
    });
    botonConfirmar.disabled = true;

    if (debeGuardarAhora) {
      formulario.requestSubmit();
    }
  });

  return {
    restablecer() {
      tenantConfirmadoId = tenantPersistidoId;
      tenantConfirmadoTexto = tenantPersistidoTexto;
      tenantPendienteId = null;
      tenantPendienteTexto = null;
      cambioConfirmadoEnModal = false;
      guardadoPendienteTrasConfirmacion = false;
      inputConfirmacion.value = '';
    },

    notificarSeleccionTenant({ id, texto }) {
      const tenantSeleccionadoId = String(id || '').trim();
      const tenantSeleccionadoTexto = String(texto || '').trim();

      if (!tenantSeleccionadoId) {
        inputConfirmacion.value = '';
        return;
      }

      if (tenantSeleccionadoId === tenantPersistidoId) {
        tenantConfirmadoId = tenantPersistidoId;
        tenantConfirmadoTexto = tenantPersistidoTexto;
        inputConfirmacion.value = '';
        return;
      }

      if (
        tenantSeleccionadoId === tenantConfirmadoId &&
        valorBooleano(inputConfirmacion.value)
      ) {
        return;
      }

      inputConfirmacion.value = '';
      void abrirModalImpacto({
        tenantId: tenantSeleccionadoId,
        tenantTexto: tenantSeleccionadoTexto
      });
    },

    validarAntesDeGuardar(evento) {
      const tenantSeleccionadoId = String(inputTenantId.value || '').trim();

      if (
        tenantSeleccionadoId &&
        tenantSeleccionadoId !== tenantPersistidoId &&
        !valorBooleano(inputConfirmacion.value)
      ) {
        evento.preventDefault();
        void abrirModalImpacto({
          tenantId: tenantSeleccionadoId,
          tenantTexto: String(inputTenantTexto.value || '').trim()
        });
      }
    }
  };

  async function abrirModalImpacto({ tenantId, tenantTexto }) {
    tenantPendienteId = String(tenantId || '');
    tenantPendienteTexto = String(tenantTexto || '').trim() ||
      `Tenant #${tenantPendienteId}`;
    cambioConfirmadoEnModal = false;

    subtitulo.textContent =
      `Empresa #${formulario.dataset.organizacionEmpresaId || ''}`;
    descripcion.innerHTML = `
      Se moverá la empresa al tenant <strong>${escapeHtml(
        tenantPendienteTexto
      )}</strong> y se revisará el impacto antes de aplicar el cambio.
    `;

    modal.show();

    try {
      const url = new URL(
        formulario.dataset.organizacionUrlImpactoCambioTenant,
        window.location.origin
      );
      url.searchParams.set('tenant_id', tenantPendienteId);

      const datos = await getJsonCambioTenant(url.toString());
      renderImpacto(datos.impacto || {});
      bloqueError.classList.add('d-none');
      bloqueError.textContent = '';
      bloqueCargando.classList.add('d-none');
      bloqueContenido.classList.remove('d-none');

      const hayBloqueos =
        Number(datos.impacto?.resumen?.totalBloqueosPotenciales || 0) > 0;

      botonConfirmar.disabled = hayBloqueos;

      if (hayBloqueos) {
        establecerTextoBotonConfirmar({
          boton: botonConfirmar,
          icono: 'shield-lock',
          texto: 'Bloqueado por conflictos'
        });
      } else {
        establecerTextoBotonConfirmar({
          boton: botonConfirmar,
          icono: 'check2-circle',
          texto: 'Guardar cambio de tenant'
        });
      }
    } catch (error) {
      bloqueCargando.classList.add('d-none');
      bloqueError.classList.remove('d-none');
      bloqueError.textContent =
        error.message ||
        'No se pudo calcular el impacto del cambio de tenant.';
      botonConfirmar.disabled = true;
      mostrarToastCambioTenant({
        tipo: 'error',
        titulo: 'Cambio de tenant',
        cuerpo:
          error.message ||
          'No se pudo revisar el impacto antes de continuar.'
      });
    }
  }

  function renderImpacto(impacto) {
    const resumen = impacto.resumen || {};
    const origen = impacto.origen || {};

    subtitulo.textContent =
      origen.empresaNombre || `Empresa #${origen.empresaId || ''}`;
    descripcion.innerHTML = `
      La empresa pasará de <strong>${escapeHtml(
        origen.tenantActualNombre || `#${origen.tenantActualId || ''}`
      )}</strong> a <strong>${escapeHtml(
        origen.tenantDestinoNombre ||
          tenantPendienteTexto ||
          `#${tenantPendienteId || ''}`
      )}</strong>.
    `;

    totalVivo.textContent = String(resumen.totalActualizacionesVivas || 0);
    totalHistorico.textContent = String(
      resumen.totalReferenciasHistoricas || 0
    );
    totalBloqueos.textContent = String(
      resumen.totalBloqueosPotenciales || 0
    );

    renderFilasCambioTenant(
      tablaActualizaciones,
      impacto.actualizacionesVivas || [],
      function (item) {
        return `
          <tr>
            <td>${escapeHtml(item.etiquetaTabla || item.tabla || '-')}</td>
            <td class="text-end fw-semibold">${escapeHtml(item.total || 0)}</td>
          </tr>
        `;
      },
      'No hay filas vivas adicionales que reasignar.',
      2
    );

    renderFilasCambioTenant(
      tablaHistorico,
      impacto.referenciasHistoricas || [],
      function (item) {
        return `
          <tr>
            <td>${escapeHtml(item.etiquetaTabla || item.tabla || '-')}</td>
            <td class="text-end fw-semibold">${escapeHtml(item.total || 0)}</td>
          </tr>
        `;
      },
      'No se detectó histórico materializado con este scope.',
      2
    );

    renderFilasCambioTenant(
      tablaBloqueos,
      impacto.bloqueosPotenciales || [],
      function (item) {
        return `
          <tr>
            <td>${escapeHtml(item.etiquetaTabla || item.tabla || '-')}</td>
            <td><code>${escapeHtml(item.regla || '-')}</code></td>
            <td class="text-end fw-semibold">${escapeHtml(item.total || 0)}</td>
          </tr>
        `;
      },
      'No se detectaron bloqueos.',
      3
    );

    seccionBloqueos.classList.toggle(
      'd-none',
      !(impacto.bloqueosPotenciales || []).length
    );
  }
}

async function getJsonCambioTenant(url) {
  const respuesta = await window.fetch(url, {
    headers: {
      'X-Requested-With': 'XMLHttpRequest'
    }
  });
  const datos = await respuesta.json().catch(function () {
    return {};
  });

  if (!respuesta.ok || datos.ok === false) {
    throw new Error(datos.mensaje || 'La operación AJAX no pudo completarse.');
  }

  return datos;
}

function renderFilasCambioTenant(
  contenedor,
  items,
  renderItem,
  mensajeVacio,
  colspan
) {
  if (!items.length) {
    contenedor.innerHTML = `
      <tr>
        <td colspan="${Number(colspan || 1)}" class="text-body-secondary">${escapeHtml(
          mensajeVacio
        )}</td>
      </tr>
    `;
    return;
  }

  contenedor.innerHTML = items.map(renderItem).join('');
}

function establecerTextoBotonConfirmar({ boton, icono, texto }) {
  boton.innerHTML = `
    <i class="bi bi-${escapeHtml(icono)}" aria-hidden="true"></i>
    <span>${escapeHtml(texto)}</span>
  `;
}

function valorBooleano(valor) {
  return ['1', 'true', 'on', 'si', 'sí'].includes(
    String(valor || '').trim().toLowerCase()
  );
}

function normalizarClaveTenant(valor) {
  return String(valor || '').trim().toLocaleLowerCase('es');
}

function escapeHtml(valor) {
  return String(valor)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function mostrarToastCambioTenant(payload) {
  if (window.portalToast?.show) {
    window.portalToast.show(payload);
    return;
  }

  window.alert(payload?.cuerpo || payload?.mensaje || 'Error');
}
