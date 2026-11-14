(function () {
  const modulo = document.querySelector('[data-trigger-vinculo-formulario]');

  if (!modulo) {
    return;
  }

  const selectorTrigger = modulo.querySelector('[data-vinculo-trigger]');
  const selectorMonitor = modulo.querySelector('[data-vinculo-monitor]');
  const formularioVinculo = modulo.querySelector('form');
  const selectorActivo = modulo.querySelector('select[name="activo"]');
  const inputOrdenEjecucion = modulo.querySelector('input[name="ordenEjecucion"]');
  const inputOverride = modulo.querySelector('textarea[name="configuracionOverride"]');
  const seccionOverride = inputOverride?.closest('section') || null;
  const checkboxesEventos = Array.from(
    modulo.querySelectorAll('input[name="eventosDisparo"]')
  );
  const alertaEventos = modulo.querySelector('[data-vinculo-eventos-alerta]');
  const modalPlanVinculoNodo = modulo.querySelector('[data-vinculo-plan-modal]');
  const cuerpoPlanVinculo = modulo.querySelector('[data-vinculo-plan-cuerpo]');
  const botonConfirmarPlan = modulo.querySelector('[data-vinculo-plan-confirmar]');
  const urlMonitoresVinculo = modulo.dataset.urlMonitoresVinculo;
  const urlTriggersVinculo = modulo.dataset.urlTriggersVinculo;
  const resumenCompatibilidad = modulo.querySelector(
    '[data-vinculo-resumen-compatibilidad]'
  );
  const resumenDestino = modulo.querySelector('[data-vinculo-resumen-destino]');
  const heroMonitorNombre = modulo.querySelector('[data-vinculo-hero-monitor-nombre]');
  const heroMonitorDetalle = modulo.querySelector('[data-vinculo-hero-monitor-detalle]');
  const heroMonitorEnlace = modulo.querySelector('[data-vinculo-hero-monitor-enlace]');
  const heroAccionNombre = modulo.querySelector('[data-vinculo-hero-accion-nombre]');
  const heroAccionDetalle = modulo.querySelector('[data-vinculo-hero-accion-detalle]');
  const heroAccionEnlace = modulo.querySelector('[data-vinculo-hero-accion-enlace]');
  const heroEstado = modulo.querySelector('[data-vinculo-hero-estado]');
  const heroEventos = modulo.querySelector('[data-vinculo-hero-eventos]');
  const heroRelacionesContador = modulo.querySelector('[data-vinculo-hero-relaciones-contador]');
  const avisoOperatividad = modulo.querySelector('[data-vinculo-operatividad]');
  const resumenMonitor = modulo.querySelector('[data-vinculo-monitor-resumen]');
  const detalleMonitor = modulo.querySelector('[data-vinculo-monitor-detalle]');
  const resumenTrigger = modulo.querySelector('[data-vinculo-trigger-resumen]');
  const detalleTrigger = modulo.querySelector('[data-vinculo-trigger-detalle]');
  const botonAbrirSelectorMonitor = modulo.querySelector(
    '[data-vinculo-monitor-abrir-selector]'
  );
  const modalSelectorMonitorNodo = modulo.querySelector(
    '[data-vinculo-monitor-selector-modal]'
  );
  const inputBusquedaSelectorMonitor = modulo.querySelector(
    '[data-vinculo-monitor-selector-busqueda]'
  );
  const botonBuscarSelectorMonitor = modulo.querySelector(
    '[data-vinculo-monitor-selector-buscar]'
  );
  const estadoSelectorMonitor = modulo.querySelector(
    '[data-vinculo-monitor-selector-estado]'
  );
  const cuerpoResultadosSelectorMonitor = modulo.querySelector(
    '[data-vinculo-monitor-selector-resultados]'
  );
  const etiquetaPaginaSelectorMonitor = modulo.querySelector(
    '[data-vinculo-monitor-selector-pagina]'
  );
  const botonesPaginacionSelectorMonitor = Array.from(
    modulo.querySelectorAll('[data-vinculo-monitor-selector-page-action]')
  );
  const botonAbrirSelectorTrigger = modulo.querySelector(
    '[data-vinculo-trigger-abrir-selector]'
  );
  const modalSelectorTriggerNodo = modulo.querySelector(
    '[data-vinculo-trigger-selector-modal]'
  );
  const inputBusquedaSelectorTrigger = modulo.querySelector(
    '[data-vinculo-trigger-selector-busqueda]'
  );
  const botonBuscarSelectorTrigger = modulo.querySelector(
    '[data-vinculo-trigger-selector-buscar]'
  );
  const estadoSelectorTriggerNodo = modulo.querySelector(
    '[data-vinculo-trigger-selector-estado]'
  );
  const cuerpoResultadosSelectorTrigger = modulo.querySelector(
    '[data-vinculo-trigger-selector-resultados]'
  );
  const etiquetaPaginaSelectorTrigger = modulo.querySelector(
    '[data-vinculo-trigger-selector-pagina]'
  );
  const botonesPaginacionSelectorTrigger = Array.from(
    modulo.querySelectorAll('[data-vinculo-trigger-selector-page-action]')
  );
  const estadoSelectorMonitorPaginacion = {
    page: 1,
    pageSize: 10,
    totalPaginas: 1
  };
  const estadoSelectorTriggerPaginacion = {
    page: 1,
    pageSize: 10,
    totalPaginas: 1
  };
  let envioConfirmadoPorPlan = false;

  if (!selectorTrigger || !selectorMonitor) {
    return;
  }

  function obtenerMetaTrigger(opcion) {
    return {
      etiqueta: String(opcion?.textContent || '').trim(),
      nombre: String(opcion?.dataset?.nombre || opcion?.textContent || '').trim(),
      tipo: String(opcion?.dataset?.tipo || '').trim(),
      activo: String(opcion?.dataset?.activo || '') !== '0',
      alcance: String(opcion?.dataset?.alcance || '').trim(),
      scopeValido: String(opcion?.dataset?.scopeValido || '') === '1',
      puedeVincular: String(opcion?.dataset?.puedeVincular || '') === '1'
    };
  }

  function obtenerMetaMonitor(opcion) {
    return {
      etiqueta: String(opcion?.textContent || '').trim(),
      nombre: String(opcion?.dataset?.nombre || opcion?.textContent || '').trim(),
      tipo: String(opcion?.dataset?.tipo || '').trim(),
      alcance: String(opcion?.dataset?.alcance || '').trim(),
      activo: String(opcion?.dataset?.activo || '') !== '0'
    };
  }

  function escapeHtml(valor) {
    return String(valor ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function obtenerModalSelectorMonitor() {
    if (!modalSelectorMonitorNodo || !window.bootstrap?.Modal) {
      return null;
    }

    return window.bootstrap.Modal.getOrCreateInstance
      ? window.bootstrap.Modal.getOrCreateInstance(modalSelectorMonitorNodo)
      : new window.bootstrap.Modal(modalSelectorMonitorNodo);
  }

  function obtenerModalSelectorTrigger() {
    if (!modalSelectorTriggerNodo || !window.bootstrap?.Modal) {
      return null;
    }

    return window.bootstrap.Modal.getOrCreateInstance
      ? window.bootstrap.Modal.getOrCreateInstance(modalSelectorTriggerNodo)
      : new window.bootstrap.Modal(modalSelectorTriggerNodo);
  }

  function obtenerModalPlanVinculo() {
    if (!modalPlanVinculoNodo || !window.bootstrap?.Modal) {
      return null;
    }

    return window.bootstrap.Modal.getOrCreateInstance
      ? window.bootstrap.Modal.getOrCreateInstance(modalPlanVinculoNodo)
      : new window.bootstrap.Modal(modalPlanVinculoNodo);
  }

  function actualizarResumenMonitorSeleccionado() {
    const opcionMonitor = selectorMonitor.selectedOptions?.[0] || null;
    const metaMonitor = opcionMonitor?.value ? obtenerMetaMonitor(opcionMonitor) : null;

    if (resumenMonitor) {
      resumenMonitor.textContent = metaMonitor
        ? metaMonitor.nombre
        : 'Selecciona monitor origen';
    }

    if (detalleMonitor) {
      detalleMonitor.textContent = metaMonitor
        ? [
          metaMonitor.tipo ? metaMonitor.tipo.toUpperCase() : null,
          metaMonitor.alcance || null
        ].filter(Boolean).join(' · ')
        : 'El monitor decide cuándo nace el evento.';
    }

    if (heroMonitorNombre) {
      heroMonitorNombre.textContent = metaMonitor?.nombre || 'Sin seleccionar';
    }
    if (heroMonitorDetalle) {
      heroMonitorDetalle.textContent = metaMonitor
        ? [metaMonitor.tipo.toUpperCase(), metaMonitor.alcance].filter(Boolean).join(' · ')
        : 'Selecciona un monitor en el formulario.';
    }
    if (heroMonitorEnlace && opcionMonitor?.value) {
      const destino = new URL(heroMonitorEnlace.href);
      destino.pathname = `/monitores/${encodeURIComponent(opcionMonitor.value)}`;
      heroMonitorEnlace.href = `${destino.pathname}${destino.search}`;
    }
  }

  function actualizarResumenTriggerSeleccionado() {
    const opcionTrigger = selectorTrigger.selectedOptions?.[0] || null;
    const metaTrigger = opcionTrigger?.value ? obtenerMetaTrigger(opcionTrigger) : null;

    if (resumenTrigger) {
      resumenTrigger.textContent = metaTrigger
        ? metaTrigger.nombre
        : 'Selecciona una acción';
    }

    if (detalleTrigger) {
      detalleTrigger.textContent = metaTrigger
        ? [
          metaTrigger.tipo ? metaTrigger.tipo.toUpperCase() : null,
          metaTrigger.activo ? 'Activo' : 'Inactivo',
          metaTrigger.alcance || null
        ].filter(Boolean).join(' · ')
        : 'La acción indica qué ocurrirá al recibir un evento.';
    }

    if (heroAccionNombre) {
      heroAccionNombre.textContent = metaTrigger?.nombre || 'Sin seleccionar';
    }
    if (heroAccionDetalle) {
      heroAccionDetalle.textContent = metaTrigger
        ? [metaTrigger.tipo.toUpperCase(), metaTrigger.activo ? 'Activa' : 'Inactiva'].filter(Boolean).join(' · ')
        : 'Selecciona una acción en el formulario.';
    }
    if (heroAccionEnlace && opcionTrigger?.value) {
      const destino = new URL(heroAccionEnlace.href);
      destino.pathname = `/monitores/triggers/editar/${encodeURIComponent(opcionTrigger.value)}`;
      heroAccionEnlace.href = `${destino.pathname}${destino.search}`;
    }
  }

  function actualizarHeroEstadoEventos() {
    if (heroEstado) {
      heroEstado.textContent = selectorActivo?.value === '1'
        ? 'Enlace activo'
        : 'Enlace inactivo';
    }
    if (heroEventos) {
      heroEventos.textContent = obtenerEventosSeleccionados()
        .map((evento) => evento.etiqueta)
        .join(' · ') ||
        'Sin evento elegido';
    }
    actualizarAvisoOperatividad();
  }

  function obtenerAdvertenciasOperatividad() {
    const opcionMonitor = selectorMonitor.selectedOptions?.[0] || null;
    const opcionTrigger = selectorTrigger.selectedOptions?.[0] || null;
    const monitor = opcionMonitor?.value ? obtenerMetaMonitor(opcionMonitor) : null;
    const accion = opcionTrigger?.value ? obtenerMetaTrigger(opcionTrigger) : null;
    const advertencias = [];

    if (selectorActivo?.value === '0') {
      advertencias.push('El enlace está inactivo: no activará la acción hasta que lo actives.');
    }
    if (monitor && !monitor.activo) {
      advertencias.push('El monitor está inactivo: no emitirá eventos hasta que lo actives.');
    }
    if (accion && !accion.activo) {
      advertencias.push('La acción está inactiva: este enlace no la ejecutará hasta que la actives.');
    }
    if (accion?.tipo === 'correo') {
      if (String(opcionTrigger.value) === modulo.dataset.vinculoCorreoTriggerId) {
        if (modulo.dataset.vinculoCorreoCanalBloqueado === '1') {
          advertencias.push('El envío de correo no está disponible: revisa la configuración del canal.');
        }
        if (modulo.dataset.vinculoCorreoOrigenInvalido === '1') {
          advertencias.push('El correo necesita un origen público HTTPS válido antes de poder enviarse.');
        }
        if (accion.activo && modulo.dataset.vinculoCorreoBloqueado === '1' &&
          modulo.dataset.vinculoCorreoCanalBloqueado !== '1' &&
          modulo.dataset.vinculoCorreoOrigenInvalido !== '1') {
          advertencias.push('La acción de correo necesita destinatarios disponibles antes de poder enviar mensajes.');
        }
      } else if (accion.activo) {
        advertencias.push('La entrega de correo también depende del canal y de que la acción tenga destinatarios disponibles.');
      }
    }
    return advertencias;
  }

  function actualizarAvisoOperatividad() {
    if (!avisoOperatividad) return;
    const advertencias = obtenerAdvertenciasOperatividad();
    avisoOperatividad.classList.toggle('d-none', advertencias.length === 0);
    avisoOperatividad.replaceChildren();
    for (const advertencia of advertencias) {
      const parrafo = document.createElement('p');
      parrafo.className = 'mb-0';
      parrafo.textContent = advertencia;
      avisoOperatividad.appendChild(parrafo);
    }
  }

  function actualizarDisponibilidadOverride() {
    const opcionTrigger = selectorTrigger.selectedOptions?.[0] || null;
    const metaTrigger = opcionTrigger?.value ? obtenerMetaTrigger(opcionTrigger) : null;
    const admiteOverride = metaTrigger?.tipo === 'api';
    if (seccionOverride) seccionOverride.hidden = Boolean(metaTrigger) && !admiteOverride;
    if (inputOverride) {
      inputOverride.disabled = Boolean(metaTrigger) && !admiteOverride;
      if (inputOverride.disabled) inputOverride.value = '';
    }
  }

  function actualizarResumen() {
    const opcionTrigger = selectorTrigger.selectedOptions?.[0] || null;
    const opcionMonitor = selectorMonitor.selectedOptions?.[0] || null;
    const metaTrigger = opcionTrigger?.value
      ? obtenerMetaTrigger(opcionTrigger)
      : null;
    const metaMonitor = opcionMonitor?.value
      ? obtenerMetaMonitor(opcionMonitor)
      : null;

    actualizarAvisoOperatividad();

    if (heroRelacionesContador) {
      heroRelacionesContador.textContent = String(
        Number(Boolean(metaMonitor)) + Number(Boolean(metaTrigger))
      );
    }

    if (!resumenCompatibilidad || !resumenDestino) {
      return;
    }

    const avisoCompatibilidad = resumenCompatibilidad.parentElement;
    avisoCompatibilidad.hidden = false;

    if (!metaTrigger || !metaMonitor) {
      resumenCompatibilidad.textContent = 'Falta completar la relación';
      resumenDestino.textContent =
        'Selecciona un monitor y una acción.';
      return;
    }

    if (!metaTrigger.scopeValido) {
      resumenCompatibilidad.textContent = 'Alcance inválido';
      resumenDestino.textContent =
        'La acción tiene un alcance inválido y debe corregirse antes de enlazarla.';
      return;
    }

    if (!metaTrigger.puedeVincular) {
      resumenCompatibilidad.textContent = 'No disponible';
      resumenDestino.textContent =
        'Esta acción no puede vincularse en este momento.';
      return;
    }

    resumenCompatibilidad.textContent = '';
    resumenDestino.textContent = metaTrigger.activo
      ? ''
      : 'La acción está inactiva: no se ejecutará hasta que se active.';
    avisoCompatibilidad.hidden = metaTrigger.activo;
  }

  function obtenerEventosSeleccionados() {
    return checkboxesEventos
      .filter((checkbox) => checkbox.checked)
      .map((checkbox) => {
        const etiqueta = checkbox
          .closest('.tarjeta-permiso')
          ?.querySelector('.tarjeta-permiso__texto strong')
          ?.textContent
          ?.trim();

        return {
          valor: checkbox.value,
          etiqueta: etiqueta || checkbox.value
        };
      });
  }

  function validarEventosSeleccionados() {
    const tieneEventos = obtenerEventosSeleccionados().length > 0;

    if (alertaEventos) {
      alertaEventos.classList.toggle('d-none', tieneEventos);
    }

    if (tieneEventos) {
      return true;
    }

    window.portalToast?.show({
      tipo: 'advertencia',
      titulo: 'Faltan eventos de disparo',
      cuerpo: 'Selecciona al menos un evento para que el enlace pueda activar la acción.'
    });
    checkboxesEventos[0]?.focus();
    return false;
  }

  function actualizarAvisoEventos() {
    if (alertaEventos) {
      alertaEventos.classList.toggle(
        'd-none',
        obtenerEventosSeleccionados().length > 0
      );
    }
  }

  function construirItemPlan({ etiqueta, valor, icono }) {
    return `
      <article class="modal-plan-trigger__item">
        <span class="organizacion-entidad__icono" aria-hidden="true">
          <i class="bi ${icono}"></i>
        </span>
        <div>
          <span>${escapeHtml(etiqueta)}</span>
          <strong>${escapeHtml(valor)}</strong>
        </div>
      </article>
    `;
  }

  function construirPlanVinculoHtml() {
    const opcionMonitor = selectorMonitor.selectedOptions?.[0] || null;
    const opcionTrigger = selectorTrigger.selectedOptions?.[0] || null;
    const metaMonitor = opcionMonitor?.value ? obtenerMetaMonitor(opcionMonitor) : null;
    const metaTrigger = opcionTrigger?.value ? obtenerMetaTrigger(opcionTrigger) : null;
    const eventos = obtenerEventosSeleccionados();
    const overrideActivo = String(inputOverride?.value || '').trim().length > 0;
    const advertencias = obtenerAdvertenciasOperatividad();
    const estado = selectorActivo?.value === '1' ? 'Activo' : 'Inactivo';
    const orden = String(inputOrdenEjecucion?.value || '100').trim() || '100';

    const items = [
      {
        etiqueta: 'Monitor origen',
        valor: metaMonitor?.etiqueta?.replace(/\s+/g, ' ') || 'Sin monitor',
        icono: 'bi-broadcast-pin'
      },
      {
        etiqueta: 'Acción vinculada',
        valor: metaTrigger?.etiqueta?.replace(/\s+/g, ' ') || 'Sin acción',
        icono: 'bi-lightning-charge'
      },
      {
        etiqueta: 'Eventos',
        valor: eventos.map((evento) => evento.etiqueta).join(', ') || 'Sin eventos',
        icono: 'bi-bell'
      },
      {
        etiqueta: 'Orden y estado',
        valor: `Orden ${orden} · ${estado}`,
        icono: selectorActivo?.value === '1' ? 'bi-check-circle' : 'bi-pause-circle'
      }
    ];

    return `
      <div class="modal-plan-trigger__grid">
        <section class="modal-plan-trigger__bloque">
          <h3>Configuración del enlace</h3>
          <div class="modal-plan-trigger__items">
            ${items.map(construirItemPlan).join('')}
          </div>
        </section>
        <section class="modal-plan-trigger__bloque">
          <h3>Lectura de impacto</h3>
          <div class="modal-plan-trigger__items">
            ${construirItemPlan({
              etiqueta: 'Alcance monitor',
              valor: metaMonitor?.alcance || 'Pendiente',
              icono: 'bi-pin-map'
            })}
            ${construirItemPlan({
              etiqueta: 'Alcance de la acción',
              valor: metaTrigger?.alcance || 'Pendiente',
              icono: 'bi-diagram-3'
            })}
            ${metaTrigger?.tipo === 'api' ? construirItemPlan({
              etiqueta: 'Configuración específica de API',
              valor: overrideActivo ? 'Con ajustes propios para este monitor' : 'Sin ajustes específicos',
              icono: 'bi-braces'
            }) : ''}
          </div>
        </section>
      </div>
      <section class="modal-plan-trigger__avisos">
        <h3>Antes de confirmar</h3>
        <p>
          <i class="bi bi-info-circle" aria-hidden="true"></i>
          <span>Guardar el enlace no ejecuta la acción de inmediato. Podrá hacerlo cuando el monitor emita uno de los eventos elegidos y todos los componentes estén disponibles.</span>
        </p>
        <p>
          <i class="bi bi-shield-check" aria-hidden="true"></i>
          <span>El acceso para editar la acción depende de su propio alcance, no del monitor elegido.</span>
        </p>
        ${advertencias.map((advertencia) => `<p><i class="bi bi-exclamation-triangle" aria-hidden="true"></i><span>${escapeHtml(advertencia)}</span></p>`).join('')}
      </section>
    `;
  }

  function abrirPlanVinculo() {
    const modalPlan = obtenerModalPlanVinculo();

    if (!modalPlan || !cuerpoPlanVinculo) {
      envioConfirmadoPorPlan = true;
      formularioVinculo?.requestSubmit();
      return;
    }

    cuerpoPlanVinculo.innerHTML = construirPlanVinculoHtml();
    modalPlan.show();
  }

  function construirParametrosSelectorMonitor() {
    const parametros = new URLSearchParams();
    parametros.set('q', String(inputBusquedaSelectorMonitor?.value || '').trim());
    parametros.set('page', String(estadoSelectorMonitorPaginacion.page));
    parametros.set('page_size', String(estadoSelectorMonitorPaginacion.pageSize));
    return parametros;
  }

  function actualizarPaginacionSelectorMonitor(paginacion = {}) {
    estadoSelectorMonitorPaginacion.totalPaginas = Number(paginacion.totalPaginas || 1);
    estadoSelectorMonitorPaginacion.page = Number(paginacion.pagina || estadoSelectorMonitorPaginacion.page || 1);

    if (etiquetaPaginaSelectorMonitor) {
      etiquetaPaginaSelectorMonitor.textContent =
        `Página ${estadoSelectorMonitorPaginacion.page} de ${estadoSelectorMonitorPaginacion.totalPaginas}`;
    }

    for (const boton of botonesPaginacionSelectorMonitor) {
      const accion = boton.dataset.vinculoMonitorSelectorPageAction;
      let disabled = false;

      if (accion === 'first' || accion === 'prev') {
        disabled = estadoSelectorMonitorPaginacion.page <= 1;
      }

      if (accion === 'next' || accion === 'last') {
        disabled = estadoSelectorMonitorPaginacion.page >= estadoSelectorMonitorPaginacion.totalPaginas;
      }

      boton.disabled = disabled;
    }
  }

  function construirParametrosSelectorTrigger() {
    const parametros = new URLSearchParams();
    parametros.set('q', String(inputBusquedaSelectorTrigger?.value || '').trim());
    parametros.set('page', String(estadoSelectorTriggerPaginacion.page));
    parametros.set('page_size', String(estadoSelectorTriggerPaginacion.pageSize));
    return parametros;
  }

  function actualizarPaginacionSelectorTrigger(paginacion = {}) {
    estadoSelectorTriggerPaginacion.totalPaginas = Number(paginacion.totalPaginas || 1);
    estadoSelectorTriggerPaginacion.page = Number(paginacion.pagina || estadoSelectorTriggerPaginacion.page || 1);

    if (etiquetaPaginaSelectorTrigger) {
      etiquetaPaginaSelectorTrigger.textContent =
        `Página ${estadoSelectorTriggerPaginacion.page} de ${estadoSelectorTriggerPaginacion.totalPaginas}`;
    }

    for (const boton of botonesPaginacionSelectorTrigger) {
      const accion = boton.dataset.vinculoTriggerSelectorPageAction;
      let disabled = false;

      if (accion === 'first' || accion === 'prev') {
        disabled = estadoSelectorTriggerPaginacion.page <= 1;
      }

      if (accion === 'next' || accion === 'last') {
        disabled = estadoSelectorTriggerPaginacion.page >= estadoSelectorTriggerPaginacion.totalPaginas;
      }

      boton.disabled = disabled;
    }
  }

  function asegurarOpcionMonitor(item) {
    const id = String(item.id || item.valor || '').trim();

    if (!id) {
      return null;
    }

    let opcion = Array.from(selectorMonitor.options).find(
      (entrada) => String(entrada.value) === id
    );

    if (!opcion) {
      opcion = document.createElement('option');
      opcion.value = id;
      selectorMonitor.appendChild(opcion);
    }

    opcion.textContent = item.nombre || `Monitor #${id}`;
    opcion.dataset.nombre = item.nombre || `Monitor #${id}`;
    opcion.dataset.tipo = item.tipo || '';
    opcion.dataset.tenantId = item.tenantId || '';
    opcion.dataset.empresaId = item.empresaId || '';
    opcion.dataset.sitioId = item.sitioId || '';
    opcion.dataset.alcance = item.alcance || '';
    opcion.dataset.activo = item.activo ? '1' : '0';
    return opcion;
  }

  function seleccionarMonitor(item) {
    const opcion = asegurarOpcionMonitor(item);

    if (!opcion) {
      return;
    }

    selectorMonitor.value = opcion.value;
    actualizarResumenMonitorSeleccionado();
    actualizarResumen();
    obtenerModalSelectorMonitor()?.hide();
  }

  function asegurarOpcionTrigger(item) {
    const id = String(item.id || item.valor || '').trim();

    if (!id) {
      return null;
    }

    let opcion = Array.from(selectorTrigger.options).find(
      (entrada) => String(entrada.value) === id
    );

    if (!opcion) {
      opcion = document.createElement('option');
      opcion.value = id;
      selectorTrigger.appendChild(opcion);
    }

    opcion.textContent = item.nombre || `Acción #${id}`;
    opcion.dataset.nombre = item.nombre || `Acción #${id}`;
    opcion.dataset.tipo = item.tipo || '';
    opcion.dataset.activo = item.activo ? '1' : '0';
    opcion.dataset.tenantId = item.tenantId || '';
    opcion.dataset.empresaId = item.empresaId || '';
    opcion.dataset.sitioId = item.sitioId || '';
    opcion.dataset.nivelPertenencia = item.nivelPertenencia || '';
    opcion.dataset.alcance = item.alcance || '';
    opcion.dataset.scopeValido = item.scopeValido ? '1' : '0';
    opcion.dataset.puedeVincular = item.puedeVincular ? '1' : '0';
    return opcion;
  }

  function seleccionarTrigger(item) {
    const opcion = asegurarOpcionTrigger(item);

    if (!opcion) {
      return;
    }

    selectorTrigger.value = opcion.value;
    actualizarResumenTriggerSeleccionado();
    actualizarDisponibilidadOverride();
    actualizarResumen();
    obtenerModalSelectorTrigger()?.hide();
  }

  function renderizarResultadosSelectorMonitor(resultados = []) {
    if (!cuerpoResultadosSelectorMonitor) {
      return;
    }

    if (!Array.isArray(resultados) || resultados.length === 0) {
      cuerpoResultadosSelectorMonitor.innerHTML = `
        <tr>
          <td colspan="5" class="text-body-secondary">
            No hay monitores visibles con esos filtros.
          </td>
        </tr>
      `;
      return;
    }

    cuerpoResultadosSelectorMonitor.innerHTML = resultados.map((item, indice) => `
      <tr>
        <td>
          <strong>${escapeHtml(item.nombre || `Monitor #${item.id}`)}</strong>
          <div class="text-body-secondary small">ID técnica #${escapeHtml(item.id)}</div>
        </td>
        <td>
          <span class="badge text-bg-light">${escapeHtml(String(item.tipo || '-').toUpperCase())}</span>
        </td>
        <td>${escapeHtml(item.alcance || '-')}</td>
        <td>
          <span class="badge ${item.activo ? 'text-bg-success' : 'text-bg-secondary'}">
            ${item.activo ? 'Activo' : 'Inactivo'}
          </span>
        </td>
        <td class="text-end">
          <button
            type="button"
            class="btn btn-outline-primary btn-sm"
            data-vinculo-monitor-selector-elegir
            data-indice="${indice}"
          >
            Elegir
          </button>
        </td>
      </tr>
    `).join('');

    cuerpoResultadosSelectorMonitor
      .querySelectorAll('[data-vinculo-monitor-selector-elegir]')
      .forEach((boton) => {
        boton.addEventListener('click', function () {
          const indice = Number.parseInt(String(boton.dataset.indice || ''), 10);
          const item = resultados[indice];

          if (item) {
            seleccionarMonitor(item);
          }
        });
      });
  }

  function renderizarResultadosSelectorTrigger(resultados = []) {
    if (!cuerpoResultadosSelectorTrigger) {
      return;
    }

    if (!Array.isArray(resultados) || resultados.length === 0) {
      cuerpoResultadosSelectorTrigger.innerHTML = `
        <tr>
          <td colspan="5" class="text-body-secondary">
            No hay acciones vinculables con esos filtros.
          </td>
        </tr>
      `;
      return;
    }

    cuerpoResultadosSelectorTrigger.innerHTML = resultados.map((item, indice) => `
      <tr>
        <td>
          <strong>${escapeHtml(item.nombre || `Acción #${item.id}`)}</strong>
          <div class="text-body-secondary small">${escapeHtml(item.descripcion || `ID técnica #${item.id}`)}</div>
        </td>
        <td>
          <span class="badge text-bg-light">${escapeHtml(String(item.tipo || '-').toUpperCase())}</span>
        </td>
        <td>${escapeHtml(item.alcance || '-')}</td>
        <td>
          <span class="badge ${item.activo ? 'text-bg-success' : 'text-bg-secondary'}">
            ${item.activo ? 'Activo' : 'Inactivo'}
          </span>
        </td>
        <td class="text-end">
          <button
            type="button"
            class="btn btn-outline-primary btn-sm"
            data-vinculo-trigger-selector-elegir
            data-indice="${indice}"
          >
            Elegir
          </button>
        </td>
      </tr>
    `).join('');

    cuerpoResultadosSelectorTrigger
      .querySelectorAll('[data-vinculo-trigger-selector-elegir]')
      .forEach((boton) => {
        boton.addEventListener('click', function () {
          const indice = Number.parseInt(String(boton.dataset.indice || ''), 10);
          const item = resultados[indice];

          if (item) {
            seleccionarTrigger(item);
          }
        });
      });
  }

  async function buscarMonitores() {
    if (!urlMonitoresVinculo || !estadoSelectorMonitor || !cuerpoResultadosSelectorMonitor) {
      return;
    }

    estadoSelectorMonitor.textContent = 'Buscando monitores visibles...';

    try {
      const respuesta = await fetch(
        `${urlMonitoresVinculo}?${construirParametrosSelectorMonitor().toString()}`,
        {
          headers: {
            Accept: 'application/json'
          }
        }
      );
      const datos = await respuesta.json();

      if (!respuesta.ok || datos.ok === false) {
        throw new Error(datos.mensaje || 'No se pudo buscar monitores.');
      }

      estadoSelectorMonitor.textContent =
        datos.paginacion?.totalFiltrado > 0
          ? `Mostrando ${datos.paginacion.desde}-${datos.paginacion.hasta} de ${datos.paginacion.totalFiltrado} monitores.`
          : 'No hay monitores disponibles con esos filtros.';
      renderizarResultadosSelectorMonitor(datos.resultados || []);
      actualizarPaginacionSelectorMonitor(datos.paginacion || {});
    } catch (error) {
      estadoSelectorMonitor.textContent = error.message;
      renderizarResultadosSelectorMonitor([]);
      actualizarPaginacionSelectorMonitor({
        pagina: 1,
        totalPaginas: 1
      });
    }
  }

  async function buscarTriggers() {
    if (!urlTriggersVinculo || !estadoSelectorTriggerNodo || !cuerpoResultadosSelectorTrigger) {
      return;
    }

    estadoSelectorTriggerNodo.textContent = 'Buscando acciones vinculables...';

    try {
      const respuesta = await fetch(
        `${urlTriggersVinculo}?${construirParametrosSelectorTrigger().toString()}`,
        {
          headers: {
            Accept: 'application/json'
          }
        }
      );
      const datos = await respuesta.json();

      if (!respuesta.ok || datos.ok === false) {
        throw new Error(datos.mensaje || 'No se pudieron buscar acciones.');
      }

      estadoSelectorTriggerNodo.textContent =
        datos.paginacion?.totalFiltrado > 0
          ? `Mostrando ${datos.paginacion.desde}-${datos.paginacion.hasta} de ${datos.paginacion.totalFiltrado} acciones.`
          : 'No hay acciones vinculables con esos filtros.';
      renderizarResultadosSelectorTrigger(datos.resultados || []);
      actualizarPaginacionSelectorTrigger(datos.paginacion || {});
    } catch (error) {
      estadoSelectorTriggerNodo.textContent = error.message;
      renderizarResultadosSelectorTrigger([]);
      actualizarPaginacionSelectorTrigger({
        pagina: 1,
        totalPaginas: 1
      });
    }
  }

  selectorMonitor.addEventListener('change', function () {
    actualizarResumenMonitorSeleccionado();
    actualizarResumen();
  });

  selectorTrigger.addEventListener('change', function () {
    actualizarResumenTriggerSeleccionado();
    actualizarDisponibilidadOverride();
    actualizarResumen();
  });

  selectorActivo?.addEventListener('change', actualizarHeroEstadoEventos);
  for (const checkboxEvento of checkboxesEventos) {
    checkboxEvento.addEventListener('change', actualizarHeroEstadoEventos);
  }

  botonAbrirSelectorMonitor?.addEventListener('click', function () {
    const modalSelectorMonitor = obtenerModalSelectorMonitor();

    if (!modalSelectorMonitor) {
      window.portalToast?.show({
        tipo: 'advertencia',
        titulo: 'Selector de monitor no disponible',
        cuerpo: 'Recarga la página si el modal no se inicializa correctamente.'
      });
      return;
    }

    modalSelectorMonitor.show();
    estadoSelectorMonitorPaginacion.page = 1;
    void buscarMonitores();
    setTimeout(() => inputBusquedaSelectorMonitor?.focus(), 150);
  });

  botonBuscarSelectorMonitor?.addEventListener('click', function () {
    estadoSelectorMonitorPaginacion.page = 1;
    void buscarMonitores();
  });

  inputBusquedaSelectorMonitor?.addEventListener('keydown', function (evento) {
    if (evento.key === 'Enter') {
      evento.preventDefault();
      estadoSelectorMonitorPaginacion.page = 1;
      void buscarMonitores();
    }
  });

  for (const boton of botonesPaginacionSelectorMonitor) {
    boton.addEventListener('click', function () {
      const accion = boton.dataset.vinculoMonitorSelectorPageAction;

      if (accion === 'first') {
        estadoSelectorMonitorPaginacion.page = 1;
      } else if (accion === 'prev') {
        estadoSelectorMonitorPaginacion.page = Math.max(1, estadoSelectorMonitorPaginacion.page - 1);
      } else if (accion === 'next') {
        estadoSelectorMonitorPaginacion.page = Math.min(
          estadoSelectorMonitorPaginacion.totalPaginas,
          estadoSelectorMonitorPaginacion.page + 1
        );
      } else if (accion === 'last') {
        estadoSelectorMonitorPaginacion.page = estadoSelectorMonitorPaginacion.totalPaginas;
      }

      void buscarMonitores();
    });
  }

  botonAbrirSelectorTrigger?.addEventListener('click', function () {
    const modalSelectorTrigger = obtenerModalSelectorTrigger();

    if (!modalSelectorTrigger) {
      window.portalToast?.show({
        tipo: 'advertencia',
        titulo: 'Selector de acciones no disponible',
        cuerpo: 'Recarga la página si el modal no se inicializa correctamente.'
      });
      return;
    }

    modalSelectorTrigger.show();
    estadoSelectorTriggerPaginacion.page = 1;
    void buscarTriggers();
    setTimeout(() => inputBusquedaSelectorTrigger?.focus(), 150);
  });

  botonBuscarSelectorTrigger?.addEventListener('click', function () {
    estadoSelectorTriggerPaginacion.page = 1;
    void buscarTriggers();
  });

  inputBusquedaSelectorTrigger?.addEventListener('keydown', function (evento) {
    if (evento.key === 'Enter') {
      evento.preventDefault();
      estadoSelectorTriggerPaginacion.page = 1;
      void buscarTriggers();
    }
  });

  for (const boton of botonesPaginacionSelectorTrigger) {
    boton.addEventListener('click', function () {
      const accion = boton.dataset.vinculoTriggerSelectorPageAction;

      if (accion === 'first') {
        estadoSelectorTriggerPaginacion.page = 1;
      } else if (accion === 'prev') {
        estadoSelectorTriggerPaginacion.page = Math.max(1, estadoSelectorTriggerPaginacion.page - 1);
      } else if (accion === 'next') {
        estadoSelectorTriggerPaginacion.page = Math.min(
          estadoSelectorTriggerPaginacion.totalPaginas,
          estadoSelectorTriggerPaginacion.page + 1
        );
      } else if (accion === 'last') {
        estadoSelectorTriggerPaginacion.page = estadoSelectorTriggerPaginacion.totalPaginas;
      }

      void buscarTriggers();
    });
  }

  for (const checkbox of checkboxesEventos) {
    checkbox.addEventListener('change', function () {
      actualizarAvisoEventos();
    });
  }

  formularioVinculo?.addEventListener('submit', function (evento) {
    if (envioConfirmadoPorPlan) {
      return;
    }

    if (!formularioVinculo.checkValidity()) {
      return;
    }

    if (!validarEventosSeleccionados()) {
      evento.preventDefault();
      return;
    }

    evento.preventDefault();
    abrirPlanVinculo();
  });

  botonConfirmarPlan?.addEventListener('click', function () {
    envioConfirmadoPorPlan = true;
    obtenerModalPlanVinculo()?.hide();
    formularioVinculo?.requestSubmit();
  });

  actualizarPaginacionSelectorMonitor();
  actualizarPaginacionSelectorTrigger();
  actualizarResumenMonitorSeleccionado();
  actualizarResumenTriggerSeleccionado();
  actualizarDisponibilidadOverride();
  actualizarResumen();
  actualizarHeroEstadoEventos();
})();
