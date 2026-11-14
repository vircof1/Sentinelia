document.addEventListener('DOMContentLoaded', function () {
  const formulario = document.querySelector(
    '.formulario-organizacion[data-organizacion-sitio-id]'
  );

  if (!formulario) {
    return;
  }

  inicializarTimezoneSitioNuevo(formulario);

  if (!formulario.hasAttribute('data-organizacion-sitio-empresa-formulario')) {
    return;
  }

  const inputEmpresaId = formulario.querySelector(
    '[data-organizacion-sitio-empresa-id]'
  );
  const inputEmpresaTexto = formulario.querySelector(
    '[data-organizacion-sitio-empresa-texto]'
  );
  const listaSugerencias = formulario.querySelector(
    '[data-organizacion-sitio-empresa-sugerencias]'
  );
  const inputValidacion = formulario.querySelector(
    '[data-organizacion-sitio-empresa-validacion]'
  );
  const inputConfirmacion = formulario.querySelector(
    '[data-organizacion-confirmar-cambio-empresa]'
  );

  if (!inputEmpresaId || !inputEmpresaTexto || !listaSugerencias || !inputValidacion) {
    return;
  }

  const cambioEmpresa = crearGestorCambioEmpresaSitio({
    formulario,
    inputEmpresaId,
    inputEmpresaTexto,
    inputConfirmacion
  });

  crearAutocompletadoEmpresaSitio({
    formulario,
    inputEmpresaId,
    inputEmpresaTexto,
    inputValidacion,
    listaSugerencias,
    inputConfirmacion,
    cambioEmpresa
  });
});

function inicializarTimezoneSitioNuevo(formulario) {
  const idSitio = String(formulario.dataset.organizacionSitioId || '').trim();

  if (idSitio) {
    return;
  }

  const selectorTimezone = formulario.querySelector('#sitio_timezone');

  if (!(selectorTimezone instanceof HTMLSelectElement)) {
    return;
  }

  const timezoneNavegador = Intl.DateTimeFormat().resolvedOptions().timeZone;

  if (!timezoneNavegador) {
    return;
  }

  const opcionCoincidente = Array.from(selectorTimezone.options).find(
    (opcion) => String(opcion.value || '').trim() === timezoneNavegador
  );

  if (!opcionCoincidente) {
    return;
  }

  selectorTimezone.value = timezoneNavegador;
}

function crearAutocompletadoEmpresaSitio({
  formulario,
  inputEmpresaId,
  inputEmpresaTexto,
  inputValidacion,
  listaSugerencias,
  inputConfirmacion,
  cambioEmpresa
}) {
  const urlEmpresas = String(
    inputEmpresaTexto.dataset.organizacionUrlEmpresas || ''
  ).trim();
  const empresaPersistidaId = String(
    formulario.dataset.organizacionEmpresaActualId || inputEmpresaId.value || ''
  );
  const empresaPersistidaTexto = String(
    formulario.dataset.organizacionEmpresaActualTexto ||
      inputEmpresaTexto.value ||
      ''
  ).trim();

  let temporizador = null;
  let secuenciaPeticion = 0;
  let empresaSeleccionadaId = String(inputEmpresaId.value || '');
  let empresaSeleccionadaTexto = String(inputEmpresaTexto.value || '').trim();
  const indiceSugerencias = new Map();

  registrarSugerencia({
    id: empresaPersistidaId,
    texto: empresaPersistidaTexto
  });
  sincronizarValidacion();

  inputEmpresaTexto.addEventListener('focus', function () {
    void cargarSugerencias(inputEmpresaTexto.value);
  });

  inputEmpresaTexto.addEventListener('input', function () {
    if (inputConfirmacion) {
      inputConfirmacion.value = '';
    }

    resolverCoincidenciaExacta();
    sincronizarValidacion();
    window.clearTimeout(temporizador);
    temporizador = window.setTimeout(function () {
      void cargarSugerencias(inputEmpresaTexto.value);
    }, 180);
  });

  inputEmpresaTexto.addEventListener('change', confirmarTextoActual);

  inputEmpresaTexto.addEventListener('blur', function () {
    window.setTimeout(confirmarTextoActual, 120);
  });

  formulario.addEventListener('submit', function (evento) {
    confirmarTextoActual();

    if (!String(inputEmpresaId.value || '').trim()) {
      evento.preventDefault();
      inputValidacion.setCustomValidity(
        'Selecciona una empresa valida desde las sugerencias.'
      );
      inputValidacion.reportValidity();
      inputEmpresaTexto.focus();
      return;
    }

    if (cambioEmpresa) {
      cambioEmpresa.validarAntesDeGuardar(evento);
    }
  });

  function confirmarTextoActual() {
    const coincidencia = buscarCoincidenciaExacta(inputEmpresaTexto.value);

    if (!coincidencia) {
      if (
        normalizarClaveEmpresa(inputEmpresaTexto.value) ===
        normalizarClaveEmpresa(empresaSeleccionadaTexto)
      ) {
        sincronizarValidacion();
        return;
      }

      if (
        normalizarClaveEmpresa(inputEmpresaTexto.value) ===
        normalizarClaveEmpresa(empresaPersistidaTexto)
      ) {
        aplicarSeleccionEmpresa({
          id: empresaPersistidaId,
          texto: empresaPersistidaTexto
        });
        return;
      }

      empresaSeleccionadaId = '';
      inputEmpresaId.value = '';
      sincronizarValidacion();
      return;
    }

    aplicarSeleccionEmpresa(coincidencia);
  }

  function resolverCoincidenciaExacta() {
    const coincidencia = buscarCoincidenciaExacta(inputEmpresaTexto.value);

    if (!coincidencia) {
      if (
        normalizarClaveEmpresa(inputEmpresaTexto.value) !==
        normalizarClaveEmpresa(empresaSeleccionadaTexto)
      ) {
        empresaSeleccionadaId = '';
        inputEmpresaId.value = '';
      }
      return;
    }

    if (
      String(coincidencia.id) === String(empresaSeleccionadaId) &&
      normalizarClaveEmpresa(coincidencia.texto) ===
        normalizarClaveEmpresa(empresaSeleccionadaTexto)
    ) {
      return;
    }

    aplicarSeleccionEmpresa(coincidencia);
  }

  function aplicarSeleccionEmpresa({ id, texto }) {
    const idNormalizado = String(id || '').trim();
    const textoNormalizado = String(texto || '').trim();
    const empresaAnteriorId = String(inputEmpresaId.value || '').trim();
    const empresaAnteriorTexto = String(empresaSeleccionadaTexto || '').trim();

    empresaSeleccionadaId = idNormalizado;
    empresaSeleccionadaTexto = textoNormalizado;
    inputEmpresaId.value = idNormalizado;
    inputEmpresaTexto.value = textoNormalizado;
    registrarSugerencia({
      id: idNormalizado,
      texto: textoNormalizado
    });
    sincronizarValidacion();

    if (cambioEmpresa) {
      cambioEmpresa.notificarSeleccionEmpresa({
        id: idNormalizado,
        texto: textoNormalizado,
        idAnterior: empresaAnteriorId,
        textoAnterior: empresaAnteriorTexto
      });
    }
    formulario.dispatchEvent(new Event('organizacion:empresa-sincronizada'));
  }

  async function cargarSugerencias(textoBusqueda) {
    if (!urlEmpresas) {
      return;
    }

    const secuenciaActual = ++secuenciaPeticion;
    const url = new URL(urlEmpresas, window.location.origin);
    url.searchParams.set('q', String(textoBusqueda || '').trim());
    url.searchParams.set('limit', '12');

    try {
      const datos = await getJsonCambioEmpresaSitio(url.toString());

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
        nodo.label = String(opcion.tenantNombre || '').trim()
          ? `tenant ${opcion.tenantNombre}`
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

    indiceSugerencias.set(normalizarClaveEmpresa(texto), {
      id: String(id).trim(),
      texto: String(texto).trim()
    });
  }

  function buscarCoincidenciaExacta(texto) {
    return indiceSugerencias.get(normalizarClaveEmpresa(texto)) || null;
  }

  function sincronizarValidacion() {
    const empresaId = String(inputEmpresaId.value || '').trim();
    inputValidacion.value = empresaId;
    inputValidacion.setCustomValidity(
      empresaId ? '' : 'Selecciona una empresa valida desde las sugerencias.'
    );
  }
}

function crearGestorCambioEmpresaSitio({
  formulario,
  inputEmpresaId,
  inputEmpresaTexto,
  inputConfirmacion
}) {
  const modalNodo = document.querySelector(
    '[data-organizacion-modal-cambio-empresa-sitio]'
  );

  if (!modalNodo || !window.bootstrap?.Modal || !inputConfirmacion) {
    return null;
  }

  const modal = new window.bootstrap.Modal(modalNodo);
  const subtitulo = modalNodo.querySelector(
    '[data-organizacion-cambio-empresa-subtitulo]'
  );
  const descripcion = modalNodo.querySelector(
    '[data-organizacion-cambio-empresa-descripcion]'
  );
  const bloqueCargando = modalNodo.querySelector(
    '[data-organizacion-cambio-empresa-cargando]'
  );
  const bloqueError = modalNodo.querySelector(
    '[data-organizacion-cambio-empresa-error]'
  );
  const bloqueContenido = modalNodo.querySelector(
    '[data-organizacion-cambio-empresa-contenido]'
  );
  const totalVivo = modalNodo.querySelector('[data-cambio-empresa-total-vivo]');
  const totalHistorico = modalNodo.querySelector(
    '[data-cambio-empresa-total-historico]'
  );
  const totalBloqueos = modalNodo.querySelector(
    '[data-cambio-empresa-total-bloqueos]'
  );
  const tablaActualizaciones = modalNodo.querySelector(
    '[data-cambio-empresa-actualizaciones]'
  );
  const tablaHistorico = modalNodo.querySelector(
    '[data-cambio-empresa-historico]'
  );
  const tablaBloqueos = modalNodo.querySelector(
    '[data-cambio-empresa-bloqueos]'
  );
  const seccionBloqueos = modalNodo.querySelector(
    '[data-cambio-empresa-seccion-bloqueos]'
  );
  const botonConfirmar = modalNodo.querySelector(
    '[data-organizacion-cambio-empresa-confirmar]'
  );

  const empresaPersistidaId = String(
    formulario.dataset.organizacionEmpresaActualId || inputEmpresaId.value || ''
  );
  const empresaPersistidaTexto = String(
    formulario.dataset.organizacionEmpresaActualTexto ||
      inputEmpresaTexto.value ||
      ''
  ).trim();

  let empresaConfirmadaId =
    valorBooleano(inputConfirmacion.value) && inputEmpresaId.value
      ? String(inputEmpresaId.value)
      : empresaPersistidaId;
  let empresaConfirmadaTexto = String(inputEmpresaTexto.value || '').trim() ||
    empresaPersistidaTexto;
  let empresaPendienteId = null;
  let empresaPendienteTexto = null;
  let cambioConfirmadoEnModal = false;
  let guardadoPendienteTrasConfirmacion = false;

  botonConfirmar.addEventListener('click', function () {
    if (!empresaPendienteId) {
      return;
    }

    cambioConfirmadoEnModal = true;
    empresaConfirmadaId = empresaPendienteId;
    empresaConfirmadaTexto = empresaPendienteTexto || empresaConfirmadaTexto;
    inputEmpresaId.value = empresaConfirmadaId;
    inputEmpresaTexto.value = empresaConfirmadaTexto;
    inputConfirmacion.value = '1';
    guardadoPendienteTrasConfirmacion = true;
    modal.hide();
  });

  modalNodo.addEventListener('hidden.bs.modal', function () {
    const debeGuardarAhora = guardadoPendienteTrasConfirmacion;

    if (!cambioConfirmadoEnModal && empresaPendienteId) {
      inputEmpresaId.value = empresaConfirmadaId || empresaPersistidaId;
      inputEmpresaTexto.value = empresaConfirmadaTexto || empresaPersistidaTexto;
    }

    empresaPendienteId = null;
    empresaPendienteTexto = null;
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
      texto: 'Guardar cambio de empresa'
    });
    botonConfirmar.disabled = true;

    if (debeGuardarAhora) {
      formulario.requestSubmit();
    }
  });

  return {
    notificarSeleccionEmpresa({ id, texto }) {
      const empresaSeleccionadaId = String(id || '').trim();
      const empresaSeleccionadaTexto = String(texto || '').trim();

      if (!empresaSeleccionadaId) {
        inputConfirmacion.value = '';
        return;
      }

      if (empresaSeleccionadaId === empresaPersistidaId) {
        empresaConfirmadaId = empresaPersistidaId;
        empresaConfirmadaTexto = empresaPersistidaTexto;
        inputConfirmacion.value = '';
        return;
      }

      if (
        empresaSeleccionadaId === empresaConfirmadaId &&
        valorBooleano(inputConfirmacion.value)
      ) {
        return;
      }

      inputConfirmacion.value = '';
      void abrirModalImpacto({
        empresaId: empresaSeleccionadaId,
        empresaTexto: empresaSeleccionadaTexto
      });
    },

    validarAntesDeGuardar(evento) {
      const empresaSeleccionadaId = String(inputEmpresaId.value || '').trim();

      if (
        empresaSeleccionadaId &&
        empresaSeleccionadaId !== empresaPersistidaId &&
        !valorBooleano(inputConfirmacion.value)
      ) {
        evento.preventDefault();
        void abrirModalImpacto({
          empresaId: empresaSeleccionadaId,
          empresaTexto: String(inputEmpresaTexto.value || '').trim()
        });
      }
    }
  };

  async function abrirModalImpacto({ empresaId, empresaTexto }) {
    empresaPendienteId = String(empresaId || '');
    empresaPendienteTexto = String(empresaTexto || '').trim() ||
      `Empresa #${empresaPendienteId}`;
    cambioConfirmadoEnModal = false;

    subtitulo.textContent =
      `Sitio #${formulario.dataset.organizacionSitioId || ''}`;
    descripcion.innerHTML = `
      Se moverá el sitio a la empresa <strong>${escapeHtml(
        empresaPendienteTexto
      )}</strong> y se revisará el impacto antes de aplicar el cambio.
    `;

    modal.show();

    try {
      const url = new URL(
        formulario.dataset.organizacionUrlImpactoCambioEmpresa,
        window.location.origin
      );
      url.searchParams.set('empresa_id', empresaPendienteId);

      const datos = await getJsonCambioEmpresaSitio(url.toString());
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
          texto: 'Guardar cambio de empresa'
        });
      }
    } catch (error) {
      bloqueCargando.classList.add('d-none');
      bloqueError.classList.remove('d-none');
      bloqueError.textContent =
        error.message ||
        'No se pudo calcular el impacto del cambio de empresa.';
      botonConfirmar.disabled = true;
      mostrarToastCambioEmpresaSitio({
        tipo: 'error',
        titulo: 'Cambio de empresa',
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
      origen.sitioNombre || `Sitio #${origen.sitioId || ''}`;
    descripcion.innerHTML = `
      El sitio pasará de <strong>${escapeHtml(
        origen.empresaActualNombre || `#${origen.empresaActualId || ''}`
      )}</strong> a <strong>${escapeHtml(
        origen.empresaDestinoNombre ||
          empresaPendienteTexto ||
          `#${empresaPendienteId || ''}`
      )}</strong>.
    `;

    totalVivo.textContent = String(resumen.totalActualizacionesVivas || 0);
    totalHistorico.textContent = String(
      resumen.totalReferenciasHistoricas || 0
    );
    totalBloqueos.textContent = String(
      resumen.totalBloqueosPotenciales || 0
    );

    renderFilasCambioEmpresa(
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

    renderFilasCambioEmpresa(
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

    renderFilasCambioEmpresa(
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

async function getJsonCambioEmpresaSitio(url) {
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

function renderFilasCambioEmpresa(
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

function normalizarClaveEmpresa(valor) {
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

function mostrarToastCambioEmpresaSitio(payload) {
  if (window.portalToast?.show) {
    window.portalToast.show(payload);
    return;
  }

  window.alert(payload?.cuerpo || payload?.mensaje || 'Error');
}
