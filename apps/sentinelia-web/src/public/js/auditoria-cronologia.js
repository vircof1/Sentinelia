(function iniciarCronologiaAuditoria() {
  const raiz = document.querySelector('[data-auditoria-cronologia]');
  if (!raiz) return;

  const urlEventos = raiz.dataset.urlEventos;
  const urlCorrelaciones = raiz.dataset.urlCorrelaciones;
  const urlSujetos = raiz.dataset.urlSujetos;
  const urlActores = raiz.dataset.urlActores;
  const urlDiagnosticos = raiz.dataset.urlDiagnosticos;
  const formulario = raiz.querySelector('[data-auditoria-filtros]');
  const botonReset = raiz.querySelector('[data-auditoria-reset]');
  const cuerpoTabla = raiz.querySelector('[data-auditoria-tabla-cuerpo]');
  const estado = raiz.querySelector('[data-auditoria-estado]');
  const error = raiz.querySelector('[data-auditoria-error]');
  const vacio = raiz.querySelector('[data-auditoria-vacio]');
  const botonPrimera = raiz.querySelector('[data-auditoria-primera]');
  const botonAnterior = raiz.querySelector('[data-auditoria-anterior]');
  const botonSiguiente = raiz.querySelector('[data-auditoria-cargar-mas]');
  const paginaEstado = raiz.querySelector('[data-auditoria-pagina]');
  const fin = raiz.querySelector('[data-auditoria-fin]');
  const periodoHero = raiz.querySelector('[data-auditoria-periodo]');
  const tipoEventoFiltro = raiz.querySelector('[data-auditoria-tipo-evento]');
  const tipoEventoOpciones = raiz.querySelector('[data-auditoria-tipo-evento-opciones]');
  const tipoEventoAyuda = raiz.querySelector('[data-auditoria-tipo-evento-ayuda]');
  const etiquetasTiposEvento = new Map(
    [...raiz.querySelectorAll('[data-auditoria-tipos-evento] option')]
      .map((opcion) => [opcion.value, opcion.label])
  );
  const sujetoTipo = raiz.querySelector('[data-auditoria-sujeto-tipo]');
  const sujetoBusqueda = raiz.querySelector('[data-auditoria-sujeto-busqueda]');
  const sujetoId = raiz.querySelector('[data-auditoria-sujeto-id]');
  const sujetoOpciones = raiz.querySelector('[data-auditoria-sujeto-opciones]');
  const sujetoEstado = raiz.querySelector('[data-auditoria-sujeto-estado]');
  const actorTipo = raiz.querySelector('[data-auditoria-actor-tipo]');
  const actorBusqueda = raiz.querySelector('[data-auditoria-actor-busqueda]');
  const actorId = raiz.querySelector('[data-auditoria-actor-id]');
  const actorOpciones = raiz.querySelector('[data-auditoria-actor-opciones]');
  const actorEstado = raiz.querySelector('[data-auditoria-actor-estado]');
  const integridadEstado = raiz.querySelector('[data-auditoria-integridad-estado]');
  const integridadResumen = raiz.querySelector('[data-auditoria-integridad-resumen]');
  const integridadAviso = raiz.querySelector('[data-auditoria-integridad-aviso]');
  const integridadError = raiz.querySelector('[data-auditoria-integridad-error]');
  const integridadVacio = raiz.querySelector('[data-auditoria-integridad-vacio]');
  const integridadCadenas = raiz.querySelector('[data-auditoria-integridad-cadenas]');
  const integridadIncidentes = raiz.querySelector('[data-auditoria-integridad-incidentes]');
  const integridadIncidentesLista = raiz.querySelector('[data-auditoria-integridad-incidentes-lista]');
  const integridadTotal = raiz.querySelector('[data-auditoria-integridad-total]');
  const integridadProblemas = raiz.querySelector('[data-auditoria-integridad-problemas]');
  const integridadPendientes = raiz.querySelector('[data-auditoria-integridad-pendientes]');

  let cursoresPagina = [null];
  let indicePagina = 0;
  let siguienteCursor = null;
  let limiteSuperiorUtc = null;
  let consultaAplicada = null;
  let controladorCarga = null;
  let versionCarga = 0;
  let controladorSujetos = null;
  let temporizadorSujetos = null;
  let controladorActores = null;
  let temporizadorActores = null;
  const navegacionCorrelaciones = new WeakMap();
  const controladoresCorrelacion = new Set();

  formulario?.addEventListener('submit', (evento) => {
    evento.preventDefault();
    if (!validarTipoEvento()) return;
    if (!validarParejaSujeto()) return;
    void cargarPagina({ reiniciar: true, modoHistoria: 'push' });
  });

  tipoEventoFiltro?.addEventListener('input', buscarTiposEvento);
  tipoEventoFiltro?.addEventListener('focus', buscarTiposEvento);
  tipoEventoFiltro?.addEventListener('keydown', (evento) => {
    if (evento.key === 'Escape') ocultarOpcionesTipoEvento();
    if (tipoEventoOpciones.hidden) return;
    if (evento.key === 'ArrowDown') {
      evento.preventDefault();
      tipoEventoOpciones.querySelector('button')?.focus();
    } else if (evento.key === 'Enter') {
      const primero = tipoEventoOpciones.querySelector('button');
      if (!primero) return;
      evento.preventDefault();
      seleccionarTipoEvento(primero.dataset.tipoEventoOpcion);
    }
  });
  tipoEventoOpciones?.addEventListener('click', (evento) => {
    const opcion = evento.target.closest('[data-tipo-evento-opcion]');
    if (opcion) seleccionarTipoEvento(opcion.dataset.tipoEventoOpcion);
  });
  tipoEventoOpciones?.addEventListener('keydown', (evento) => {
    const opciones = [...tipoEventoOpciones.querySelectorAll('button')];
    const indice = opciones.indexOf(document.activeElement);
    if (evento.key === 'Escape') {
      ocultarOpcionesTipoEvento();
      tipoEventoFiltro.focus();
    } else if (evento.key === 'ArrowDown' && indice >= 0) {
      evento.preventDefault();
      opciones[Math.min(indice + 1, opciones.length - 1)]?.focus();
    } else if (evento.key === 'ArrowUp' && indice >= 0) {
      evento.preventDefault();
      if (indice === 0) tipoEventoFiltro.focus();
      else opciones[indice - 1].focus();
    }
  });
  document.addEventListener('pointerdown', (evento) => {
    if (!evento.target.closest('.auditoria-tipo-evento')) ocultarOpcionesTipoEvento();
  });

  botonReset?.addEventListener('click', () => {
    formulario.reset();
    ocultarOpcionesTipoEvento();
    actualizarAyudaTipoEvento();
    establecerVentanaInicial();
    limpiarResolucionSujeto();
    limpiarResolucionActor();
    void cargarPagina({ reiniciar: true, modoHistoria: 'push' });
  });

  formulario?.querySelector('[data-auditoria-limite]')?.addEventListener('change', () => {
    if (!validarParejaSujeto()) return;
    void cargarPagina({ reiniciar: true, modoHistoria: 'push' });
  });

  botonPrimera?.addEventListener('click', () => {
    void cargarPagina({ indiceObjetivo: 0, modoHistoria: 'push' });
  });

  botonAnterior?.addEventListener('click', () => {
    void cargarPagina({
      indiceObjetivo: Math.max(0, indicePagina - 1),
      modoHistoria: 'push'
    });
  });

  botonSiguiente?.addEventListener('click', () => {
    if (!siguienteCursor) return;
    void cargarPagina({ indiceObjetivo: indicePagina + 1, modoHistoria: 'push' });
  });

  sujetoTipo?.addEventListener('change', () => {
    limpiarResolucionSujeto();
    programarBusquedaSujetos();
  });

  sujetoBusqueda?.addEventListener('input', () => {
    sujetoId.value = '';
    programarBusquedaSujetos();
  });

  sujetoOpciones?.addEventListener('click', (evento) => {
    const opcion = evento.target.closest('[data-auditoria-sujeto-opcion]');
    if (!opcion) return;
    sujetoId.value = opcion.dataset.id;
    sujetoBusqueda.value = opcion.dataset.etiqueta;
    sujetoEstado.textContent = `${opcion.dataset.etiqueta} · ID ${opcion.dataset.id}`;
    sujetoOpciones.hidden = true;
  });

  sujetoId?.addEventListener('input', () => {
    if (!sujetoId.value.trim()) return;
    sujetoEstado.textContent = `Se filtrará por el ID exacto ${sujetoId.value.trim()}.`;
  });

  actorTipo?.addEventListener('change', () => {
    limpiarResolucionActor();
    programarBusquedaActores();
  });

  actorBusqueda?.addEventListener('input', () => {
    actorId.value = '';
    programarBusquedaActores();
  });

  actorOpciones?.addEventListener('click', (evento) => {
    const opcion = evento.target.closest('[data-auditoria-actor-opcion]');
    if (!opcion) return;
    actorId.value = opcion.dataset.id;
    actorBusqueda.value = opcion.dataset.etiqueta;
    actorEstado.textContent = `${opcion.dataset.etiqueta} · ID ${opcion.dataset.id}`;
    actorOpciones.hidden = true;
  });

  cuerpoTabla?.addEventListener('click', (evento) => {
    const botonDetalle = evento.target.closest('[data-auditoria-detalle]');
    if (botonDetalle) {
      alternarDetalleEvento(botonDetalle);
      return;
    }
    const botonCorrelacion = evento.target.closest('[data-auditoria-correlacion-accion]');
    if (!botonCorrelacion) return;
    const panel = botonCorrelacion.closest('[data-auditoria-correlacion-panel]');
    if (!panel) return;
    const accion = botonCorrelacion.dataset.auditoriaCorrelacionAccion;
    if (accion === 'alternar') {
      alternarCorrelacion(panel, botonCorrelacion);
      return;
    }
    const navegacion = navegacionCorrelaciones.get(panel);
    if (!navegacion) return;
    const indiceObjetivo = accion === 'primera'
      ? 0
      : accion === 'anterior'
        ? Math.max(0, navegacion.indice - 1)
        : navegacion.indice + 1;
    void cargarCorrelacion(panel, { indiceObjetivo });
  });

  integridadIncidentesLista?.addEventListener('submit', (evento) => {
    const formularioReconocimiento = evento.target.closest('[data-auditoria-reconocer-incidente]');
    if (!formularioReconocimiento) return;
    evento.preventDefault();
    void reconocerIncidente(formularioReconocimiento);
  });

  window.addEventListener('popstate', (evento) => {
    restaurarNavegacion(evento.state);
    void cargarPagina({
      indiceObjetivo: indicePagina,
      modoHistoria: 'replace'
    });
  });

  void cargarIntegridad();
  const tipoNavegacion = performance.getEntriesByType?.('navigation')?.[0]?.type;
  restaurarNavegacion(tipoNavegacion === 'back_forward' ? history.state : null);
  void cargarPagina({ indiceObjetivo: indicePagina, modoHistoria: 'replace' });

  async function cargarPagina({
    reiniciar = false,
    indiceObjetivo = indicePagina,
    modoHistoria = 'replace'
  } = {}) {
    cancelarCorrelaciones();
    controladorCarga?.abort();
    const controladorActual = new AbortController();
    controladorCarga = controladorActual;
    const versionActual = ++versionCarga;
    error.hidden = true;
    if (reiniciar) {
      cursoresPagina = [null];
      indiceObjetivo = 0;
      indicePagina = 0;
      siguienteCursor = null;
      consultaAplicada = capturarConsultaAplicada();
      actualizarPeriodoHero();
      limiteSuperiorUtc = new Date().toISOString();
      cuerpoTabla.replaceChildren();
      paginaEstado.textContent = 'Página 1';
      vacio.hidden = true;
      fin.hidden = true;
    }
    const cursorObjetivo = cursoresPagina[indiceObjetivo] ?? null;
    estado.textContent = `Cargando página ${indiceObjetivo + 1}…`;
    actualizarControles(true);

    try {
      const parametros = construirParametros();
      if (cursorObjetivo) parametros.set('cursor', cursorObjetivo);
      const respuesta = await fetch(`${urlEventos}?${parametros.toString()}`, {
        headers: { Accept: 'application/json' },
        signal: controladorActual.signal
      });
      if (!respuesta.ok) throw new Error(`No se pudo cargar la cronología (${respuesta.status}).`);
      const datos = await respuesta.json();
      if (versionActual !== versionCarga) return;
      const eventos = extraerEventos(datos);
      const totalPagina = renderizarPagina(eventos);
      indicePagina = indiceObjetivo;
      siguienteCursor = datos.paginacion?.siguienteCursor || null;
      cursoresPagina = cursoresPagina.slice(0, indicePagina + 1);
      if (siguienteCursor) cursoresPagina.push(siguienteCursor);
      fin.hidden = totalPagina === 0 || Boolean(siguienteCursor);
      vacio.hidden = totalPagina !== 0;
      estado.textContent = totalPagina
        ? `${totalPagina} evento${totalPagina === 1 ? '' : 's'} visible${totalPagina === 1 ? '' : 's'} en esta página.`
        : 'Sin actividad visible con estos filtros.';
      paginaEstado.textContent = `Página ${indicePagina + 1}`;
      guardarNavegacion(modoHistoria);
    } catch (err) {
      if (err?.name === 'AbortError' || versionActual !== versionCarga) return;
      error.textContent = err?.message || 'Error cargando la cronología.';
      error.hidden = false;
      estado.textContent = 'No se pudo actualizar la cronología.';
    } finally {
      if (versionActual !== versionCarga) return;
      controladorCarga = null;
      actualizarControles(false);
    }
  }

  function construirParametros() {
    const datos = consultaAplicada || capturarConsultaAplicada();
    const parametros = new URLSearchParams();
    parametros.set('limite', datos.limite);
    parametros.set('orden', datos.orden);
    parametros.set('desdeUtc', `${datos.desde}T00:00:00.000Z`);
    parametros.set('hastaUtc', resolverHastaUtc(datos.hasta));
    for (const campo of ['flujo', 'tipoEvento']) {
      const valor = datos[campo];
      if (valor) parametros.set(campo, valor);
    }
    for (const campo of [
      'modoActuacion', 'origen', 'claveCadena', 'correlacionId'
    ]) {
      if (datos[campo]) parametros.set(campo, datos[campo]);
    }
    if (datos.sujetoTipo && datos.sujetoId) {
      parametros.set('sujetoTipo', datos.sujetoTipo);
      parametros.set('sujetoId', datos.sujetoId);
    }
    if (datos.actorRol && datos.actorTipo && datos.actorId) {
      parametros.set('actorRol', datos.actorRol);
      parametros.set('actorTipo', datos.actorTipo);
      parametros.set('actorId', datos.actorId);
    }
    if (datos.causalidadTipo && datos.causalidadId) {
      parametros.set('causalidadTipo', datos.causalidadTipo);
      parametros.set('causalidadId', datos.causalidadId);
    }
    return parametros;
  }

  function capturarConsultaAplicada() {
    const datos = new FormData(formulario);
    return Object.freeze({
      desde: normalizarFechaFormulario(datos.get('desde'), fechaUtcDesplazada(-6)),
      hasta: normalizarFechaFormulario(datos.get('hasta'), fechaUtcDesplazada(0)),
      limite: String(datos.get('limite') || '25'),
      orden: String(datos.get('orden') || 'desc'),
      flujo: String(datos.get('flujo') || '').trim(),
      tipoEvento: String(datos.get('tipoEvento') || '').trim(),
      sujetoTipo: String(datos.get('sujetoTipo') || '').trim(),
      sujetoId: String(datos.get('sujetoId') || '').trim(),
      actorRol: String(datos.get('actorRol') || '').trim(),
      actorTipo: String(datos.get('actorTipo') || '').trim(),
      actorId: String(datos.get('actorId') || '').trim(),
      modoActuacion: String(datos.get('modoActuacion') || '').trim(),
      origen: String(datos.get('origen') || '').trim(),
      claveCadena: String(datos.get('claveCadena') || '').trim(),
      correlacionId: String(datos.get('correlacionId') || '').trim(),
      causalidadTipo: String(datos.get('causalidadTipo') || '').trim(),
      causalidadId: String(datos.get('causalidadId') || '').trim()
    });
  }

  function restaurarNavegacion(estadoGuardado) {
    if (
      estadoGuardado?.auditoriaCronologia === 2 &&
      estadoGuardado.consulta &&
      Array.isArray(estadoGuardado.cursoresPagina)
    ) {
      consultaAplicada = Object.freeze({ ...estadoGuardado.consulta });
      cursoresPagina = [...estadoGuardado.cursoresPagina];
      indicePagina = Math.max(
        0,
        Math.min(Number(estadoGuardado.indicePagina) || 0, cursoresPagina.length - 1)
      );
      siguienteCursor = estadoGuardado.siguienteCursor || null;
      limiteSuperiorUtc = estadoGuardado.limiteSuperiorUtc || new Date().toISOString();
    } else {
      consultaAplicada = consultaDesdeUrl();
      cursoresPagina = [null];
      indicePagina = 0;
      siguienteCursor = null;
      limiteSuperiorUtc = new Date().toISOString();
    }
    aplicarConsultaAlFormulario(consultaAplicada);
    ocultarOpcionesTipoEvento();
    actualizarAyudaTipoEvento();
    actualizarPeriodoHero();
    paginaEstado.textContent = `Página ${indicePagina + 1}`;
  }

  function actualizarPeriodoHero() {
    if (!periodoHero || !consultaAplicada) return;
    const fechaCorta = (valor) => {
      const [anio, mes, dia] = String(valor).split('-').map(Number);
      return `${dia}/${mes}/${anio}`;
    };
    periodoHero.textContent = `Del ${fechaCorta(consultaAplicada.desde)} al ${fechaCorta(consultaAplicada.hasta)}`;
  }

  function guardarNavegacion(modo) {
    const url = new URL(window.location.href);
    for (const campo of [
      'desde', 'hasta', 'flujo', 'tipoEvento', 'sujetoTipo', 'sujetoId',
      'actorRol', 'actorTipo', 'actorId', 'modoActuacion', 'origen',
      'claveCadena', 'correlacionId', 'causalidadTipo', 'causalidadId', 'orden', 'limite'
    ]) {
      url.searchParams.delete(campo);
      const valor = consultaAplicada[campo];
      if (valor) url.searchParams.set(campo, valor);
    }
    const estadoGuardado = {
      auditoriaCronologia: 2,
      consulta: { ...consultaAplicada },
      cursoresPagina: [...cursoresPagina],
      indicePagina,
      siguienteCursor,
      limiteSuperiorUtc
    };
    const metodo = modo === 'push' ? 'pushState' : 'replaceState';
    history[metodo](estadoGuardado, '', url);
  }

  function consultaDesdeUrl() {
    const parametros = new URLSearchParams(window.location.search);
    const valoresSelect = (selector) => new Set(
      [...formulario.elements[selector].options].map((opcion) => opcion.value)
    );
    const flujo = parametros.get('flujo') || '';
    const sujetoTipoValor = parametros.get('sujetoTipo') || '';
    const sujetoTipoNormalizado = valoresSelect('sujetoTipo').has(sujetoTipoValor)
      ? sujetoTipoValor
      : '';
    const sujetoIdNormalizado = String(parametros.get('sujetoId') || '').trim();
    const sujetoCompleto = Boolean(sujetoTipoNormalizado && sujetoIdNormalizado);
    const actorRol = parametros.get('actorRol') || '';
    const actorTipoValor = parametros.get('actorTipo') || '';
    const actorIdValor = String(parametros.get('actorId') || '').trim();
    const modoActuacion = parametros.get('modoActuacion') || '';
    const modoActuacionNormalizado = valoresSelect('modoActuacion').has(modoActuacion)
      ? modoActuacion
      : '';
    const actorCompleto = valoresSelect('actorRol').has(actorRol) &&
      valoresSelect('actorTipo').has(actorTipoValor) &&
      Boolean(actorRol && actorTipoValor && idOpacoValido(actorIdValor, 128)) &&
      !(actorRol === 'efectivo' && actorTipoValor !== 'usuario') &&
      !(actorRol === 'efectivo' && modoActuacionNormalizado === 'directo');
    const causalidadTipo = parametros.get('causalidadTipo') || '';
    const causalidadId = String(parametros.get('causalidadId') || '').trim();
    const causalidadCompleta = valoresSelect('causalidadTipo').has(causalidadTipo) &&
      Boolean(causalidadTipo && idOpacoValido(causalidadId, 128));
    const orden = parametros.get('orden') || 'desc';
    const limite = parametros.get('limite') || '25';
    return Object.freeze({
      desde: normalizarFechaFormulario(parametros.get('desde'), fechaUtcDesplazada(-6)),
      hasta: normalizarFechaFormulario(parametros.get('hasta'), fechaUtcDesplazada(0)),
      flujo: valoresSelect('flujo').has(flujo) ? flujo : '',
      tipoEvento: String(parametros.get('tipoEvento') || '').trim(),
      sujetoTipo: sujetoCompleto ? sujetoTipoNormalizado : '',
      sujetoId: sujetoCompleto ? sujetoIdNormalizado : '',
      actorRol: actorCompleto ? actorRol : '',
      actorTipo: actorCompleto ? actorTipoValor : '',
      actorId: actorCompleto ? actorIdValor : '',
      modoActuacion: modoActuacionNormalizado,
      origen: valoresSelect('origen').has(parametros.get('origen') || '')
        ? parametros.get('origen') || '' : '',
      claveCadena: normalizarClaveCadena(parametros.get('claveCadena')),
      correlacionId: normalizarUuidV7(parametros.get('correlacionId')),
      causalidadTipo: causalidadCompleta ? causalidadTipo : '',
      causalidadId: causalidadCompleta ? causalidadId : '',
      orden: valoresSelect('orden').has(orden) ? orden : 'desc',
      limite: valoresSelect('limite').has(limite) ? limite : '25'
    });
  }

  function aplicarConsultaAlFormulario(consulta) {
    for (const campo of [
      'desde', 'hasta', 'flujo', 'tipoEvento', 'sujetoTipo', 'sujetoId',
      'actorRol', 'actorTipo', 'actorId', 'modoActuacion', 'origen',
      'claveCadena', 'correlacionId', 'causalidadTipo', 'causalidadId', 'orden', 'limite'
    ]) {
      if (formulario.elements[campo]) formulario.elements[campo].value = consulta[campo] || '';
    }
    const hoy = fechaUtcDesplazada(0);
    formulario.elements.desde.max = hoy;
    formulario.elements.hasta.max = hoy;
    sujetoBusqueda.value = '';
    sujetoOpciones.hidden = true;
    sujetoEstado.textContent = consulta.sujetoTipo && consulta.sujetoId
      ? `Filtro exacto ${consulta.sujetoTipo}:${consulta.sujetoId}.`
      : 'Selecciona un tipo para buscar; también puedes introducir un ID histórico exacto.';
    actorBusqueda.value = '';
    actorOpciones.hidden = true;
    actorEstado.textContent = consulta.actorRol && consulta.actorTipo && consulta.actorId
      ? `Filtro exacto ${consulta.actorRol}:${consulta.actorTipo}:${consulta.actorId}.`
      : 'Rol, tipo e ID se aplican siempre juntos.';
    raiz.querySelector('[data-auditoria-filtros-avanzados]').open = Boolean(
      consulta.actorRol || consulta.modoActuacion || consulta.origen || consulta.claveCadena ||
      consulta.correlacionId || consulta.causalidadTipo
    );
  }

  function establecerVentanaInicial() {
    formulario.elements.desde.value = fechaUtcDesplazada(-6);
    formulario.elements.hasta.value = fechaUtcDesplazada(0);
  }

  function validarParejaSujeto() {
    const tieneTipo = Boolean(sujetoTipo.value);
    const tieneId = Boolean(sujetoId.value.trim());
    if (tieneTipo !== tieneId) {
      sujetoEstado.textContent = 'El tipo y el ID exacto del sujeto deben aparecer juntos.';
      (tieneTipo ? sujetoId : sujetoTipo).focus();
      return false;
    }
    const actorRol = formulario.elements.actorRol.value;
    const actorTipoValor = actorTipo.value;
    const actorIdValor = actorId.value.trim();
    const totalActor = [actorRol, actorTipoValor, actorIdValor].filter(Boolean).length;
    if (totalActor !== 0 && totalActor !== 3) {
      actorEstado.textContent = 'Rol, tipo e ID exacto del actor deben aparecer juntos.';
      formulario.elements.actorRol.focus();
      return false;
    }
    if (actorRol === 'efectivo' && actorTipoValor && actorTipoValor !== 'usuario') {
      actorEstado.textContent = 'El actor efectivo solo puede ser de tipo usuario.';
      actorTipo.focus();
      return false;
    }
    if (actorRol === 'efectivo' && formulario.elements.modoActuacion.value === 'directo') {
      actorEstado.textContent = 'Un actor efectivo no es compatible con actuación directa.';
      formulario.elements.modoActuacion.focus();
      return false;
    }
    const tieneCausalidadTipo = Boolean(formulario.elements.causalidadTipo.value);
    const tieneCausalidadId = Boolean(formulario.elements.causalidadId.value.trim());
    if (tieneCausalidadTipo !== tieneCausalidadId) {
      error.textContent = 'El tipo y el ID exacto de causalidad deben aparecer juntos.';
      error.hidden = false;
      (tieneCausalidadTipo ? formulario.elements.causalidadId : formulario.elements.causalidadTipo).focus();
      return false;
    }
    const desde = formulario.elements.desde.value;
    const hasta = formulario.elements.hasta.value;
    if (desde && hasta && desde > hasta) {
      error.textContent = 'La fecha Desde no puede ser posterior a Hasta.';
      error.hidden = false;
      formulario.elements.desde.focus();
      return false;
    }
    return true;
  }

  function limpiarResolucionSujeto() {
    controladorSujetos?.abort();
    clearTimeout(temporizadorSujetos);
    sujetoBusqueda.value = '';
    sujetoId.value = '';
    sujetoOpciones.replaceChildren();
    sujetoOpciones.hidden = true;
    sujetoEstado.textContent = sujetoTipo.value
      ? 'Escribe al menos 2 caracteres o introduce directamente un ID exacto.'
      : 'Selecciona un tipo para buscar; también puedes introducir un ID histórico exacto.';
  }

  function programarBusquedaSujetos() {
    clearTimeout(temporizadorSujetos);
    controladorSujetos?.abort();
    const tipo = sujetoTipo.value;
    const texto = sujetoBusqueda.value.trim();
    sujetoOpciones.replaceChildren();
    sujetoOpciones.hidden = true;
    if (!tipo || texto.length < 2) {
      sujetoEstado.textContent = tipo
        ? 'Escribe al menos 2 caracteres o introduce directamente un ID exacto.'
        : 'Selecciona primero el tipo de sujeto.';
      return;
    }
    sujetoEstado.textContent = 'Buscando sujetos visibles…';
    temporizadorSujetos = setTimeout(() => void buscarSujetos(tipo, texto), 250);
  }

  async function buscarSujetos(tipo, texto) {
    const controladorActual = new AbortController();
    controladorSujetos = controladorActual;
    const parametros = new URLSearchParams({ tipo, texto, pagina: '1', limite: '10' });
    try {
      const respuesta = await fetch(`${urlSujetos}?${parametros.toString()}`, {
        headers: { Accept: 'application/json' },
        signal: controladorActual.signal
      });
      const datos = await respuesta.json().catch(() => ({}));
      if (!respuesta.ok) throw new Error(datos.mensaje || `No se pudo resolver (${respuesta.status}).`);
      if (controladorActual !== controladorSujetos) return;
      renderizarOpcionesSujeto(datos.opciones || []);
    } catch (err) {
      if (err?.name === 'AbortError') return;
      sujetoEstado.textContent = err?.message || 'No se pudo buscar el sujeto.';
    }
  }

  function renderizarOpcionesSujeto(opciones) {
    sujetoOpciones.replaceChildren();
    for (const opcion of opciones) {
      const boton = document.createElement('button');
      boton.type = 'button';
      boton.className = 'auditoria-sujeto__opcion';
      boton.dataset.auditoriaSujetoOpcion = '';
      boton.dataset.id = opcion.id;
      boton.dataset.etiqueta = opcion.etiqueta;
      boton.textContent = `${opcion.etiqueta} · ${opcion.id}`;
      sujetoOpciones.appendChild(boton);
    }
    sujetoOpciones.hidden = opciones.length === 0;
    sujetoEstado.textContent = opciones.length
      ? `${opciones.length} opción${opciones.length === 1 ? '' : 'es'} visible${opciones.length === 1 ? '' : 's'}.`
      : 'Sin opciones visibles. Puedes introducir un ID histórico exacto.';
  }

  function limpiarResolucionActor() {
    controladorActores?.abort();
    clearTimeout(temporizadorActores);
    actorBusqueda.value = '';
    actorId.value = '';
    actorOpciones.replaceChildren();
    actorOpciones.hidden = true;
    actorEstado.textContent = actorTipo.value
      ? 'Escribe al menos 2 caracteres o introduce directamente un ID exacto.'
      : 'Rol, tipo e ID se aplican siempre juntos.';
  }

  function programarBusquedaActores() {
    clearTimeout(temporizadorActores);
    controladorActores?.abort();
    const tipo = actorTipo.value;
    const texto = actorBusqueda.value.trim();
    actorOpciones.replaceChildren();
    actorOpciones.hidden = true;
    if (!tipo || texto.length < 2) {
      actorEstado.textContent = tipo
        ? 'Escribe al menos 2 caracteres o introduce directamente un ID exacto.'
        : 'Selecciona primero el tipo de actor.';
      return;
    }
    actorEstado.textContent = 'Buscando actores visibles…';
    temporizadorActores = setTimeout(() => void buscarActores(tipo, texto), 250);
  }

  async function buscarActores(tipo, texto) {
    const controladorActual = new AbortController();
    controladorActores = controladorActual;
    const parametros = new URLSearchParams({ tipo, texto, pagina: '1', limite: '10' });
    try {
      const respuesta = await fetch(`${urlActores}?${parametros.toString()}`, {
        headers: { Accept: 'application/json' },
        signal: controladorActual.signal
      });
      const datos = await respuesta.json().catch(() => ({}));
      if (!respuesta.ok) throw new Error(datos.mensaje || `No se pudo resolver (${respuesta.status}).`);
      if (controladorActual !== controladorActores) return;
      renderizarOpcionesActor(datos.opciones || []);
    } catch (err) {
      if (err?.name === 'AbortError') return;
      actorEstado.textContent = err?.message || 'No se pudo buscar el actor.';
    }
  }

  function renderizarOpcionesActor(opciones) {
    actorOpciones.replaceChildren();
    for (const opcion of opciones) {
      const boton = document.createElement('button');
      boton.type = 'button';
      boton.className = 'auditoria-actor__opcion';
      boton.dataset.auditoriaActorOpcion = '';
      boton.dataset.id = opcion.id;
      boton.dataset.etiqueta = opcion.etiqueta;
      boton.textContent = `${opcion.etiqueta} · ${opcion.id}`;
      actorOpciones.appendChild(boton);
    }
    actorOpciones.hidden = opciones.length === 0;
    actorEstado.textContent = opciones.length
      ? `${opciones.length} actor${opciones.length === 1 ? '' : 'es'} visible${opciones.length === 1 ? '' : 's'}.`
      : 'Sin actores visibles. Puedes introducir un ID histórico exacto.';
  }

  function resolverHastaUtc(fecha) {
    const finDia = `${fecha}T23:59:59.999Z`;
    return finDia < limiteSuperiorUtc ? finDia : limiteSuperiorUtc;
  }

  function normalizarFechaFormulario(valor, defecto) {
    const fecha = String(valor || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return defecto;
    const instante = new Date(`${fecha}T00:00:00.000Z`);
    return !Number.isNaN(instante.getTime()) && instante.toISOString().slice(0, 10) === fecha
      ? fecha
      : defecto;
  }

  function fechaUtcDesplazada(dias) {
    const fecha = new Date();
    fecha.setUTCDate(fecha.getUTCDate() + dias);
    return fecha.toISOString().slice(0, 10);
  }

  function idOpacoValido(valor, maximo) {
    return typeof valor === 'string' && valor.length <= maximo && /^[\x21-\x7e]+$/.test(valor);
  }

  function normalizarClaveCadena(valor) {
    const clave = String(valor || '').trim();
    return /^(sistema|usuarios|organizacion|agentes|monitores|alertas|automatizacion|dns):(portal|tenant:[1-9][0-9]*)$/.test(clave)
      ? clave
      : '';
  }

  function normalizarUuidV7(valor) {
    const uuid = String(valor || '').trim();
    return /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(uuid)
      ? uuid
      : '';
  }

  function actualizarControles(cargaEnCurso) {
    botonPrimera.disabled = cargaEnCurso || indicePagina === 0;
    botonAnterior.disabled = cargaEnCurso || indicePagina === 0;
    botonSiguiente.disabled = cargaEnCurso || !siguienteCursor;
  }

  function extraerEventos(datos) {
    if (Array.isArray(datos.eventos)) return datos.eventos;
    return renderizarGrupos(Array.isArray(datos.grupos) ? datos.grupos : []);
  }

  function renderizarGrupos(grupos) {
    const eventos = [];
    for (const grupo of grupos) {
      const eventosGrupo = grupo.eventos || [];
      const omitirPrimero = Boolean(
        grupo.continuacion && eventos.length && eventosGrupo.length &&
        eventos.at(-1).eventoId === eventosGrupo[0].eventoId
      );
      eventos.push(...eventosGrupo.slice(omitirPrimero ? 1 : 0));
    }
    return eventos;
  }

  function renderizarPagina(eventos) {
    const fragmento = document.createDocumentFragment();
    const idsRenderizados = new Set();
    for (const evento of eventos) {
      const id = String(evento.eventoId || '');
      if (!id || idsRenderizados.has(id)) continue;
      idsRenderizados.add(id);
      fragmento.appendChild(renderizarEvento(evento));
    }
    for (const nodo of cuerpoTabla.querySelectorAll('[data-bs-toggle="tooltip"]')) {
      window.bootstrap?.Tooltip?.getInstance(nodo)?.dispose();
    }
    cuerpoTabla.replaceChildren(fragmento);
    inicializarTooltipsAuditoria(cuerpoTabla);
    return idsRenderizados.size;
  }

  function inicializarTooltipsAuditoria(contenedor) {
    if (!window.bootstrap?.Tooltip) return;
    for (const nodo of contenedor.querySelectorAll('[data-bs-toggle="tooltip"]')) {
      if (!window.bootstrap.Tooltip.getInstance(nodo)) {
        new window.bootstrap.Tooltip(nodo, { container: 'body' });
      }
    }
  }

  function renderizarEvento(evento) {
    const fragmento = document.createDocumentFragment();
    const fila = document.createElement('tr');
    fila.className = 'auditoria-tabla__fila';
    fila.setAttribute('data-auditoria-correlacion', evento.correlacionId || '');
    fila.dataset.eventoId = evento.eventoId || '';
    const resumen = resumirPayload(evento.payload || {});
    const detalleId = `auditoria-detalle-${String(evento.eventoId || '').replaceAll(/[^a-z0-9_-]/gi, '-')}`;
    const insigniaCorrelacion = evento.correlacionId
      ? `<button type="button" class="auditoria-correlacion__insignia" data-bs-toggle="tooltip" data-bs-placement="top" data-bs-custom-class="auditoria-tooltip"
          data-bs-title="Agrupa eventos de una misma operación. Abre el detalle para consultar los demás eventos visibles; puede haber otros fuera de tu alcance."
          aria-label="Correlación: agrupa eventos de una misma operación. Abre el detalle para consultar los demás eventos visibles; puede haber otros fuera de tu alcance.">
          Correlación <i class="bi bi-info-circle" aria-hidden="true"></i>
        </button>`
      : '';
    fila.innerHTML = `
      <td data-label="Fecha"><time datetime="${escapar(evento.registradoEnUtc || '')}">${escapar(formatearHora(evento.registradoEnUtc))}</time></td>
      <td data-label="Evento / flujo"><strong title="${escapar(evento.tipoEvento || '')}">${escapar(etiquetarEvento(evento.tipoEvento))}</strong>${insigniaCorrelacion}<small>${escapar(etiquetarFlujo(evento.flujo))}</small></td>
      <td data-label="Sujeto">${escapar(describirSujeto(evento.sujeto))}</td>
      <td data-label="Actor / origen"><span>${escapar(describirActor(evento))}</span><small>${escapar(etiquetarOrigen(evento.origen))}</small></td>
      <td data-label="Acciones">
        <button type="button" class="btn btn-sm auditoria-accion" data-auditoria-detalle aria-expanded="false" aria-controls="${detalleId}">Detalle</button>
      </td>
    `;
    const detalle = document.createElement('tr');
    detalle.id = detalleId;
    detalle.className = 'auditoria-tabla__fila-detalle';
    detalle.hidden = true;
    detalle.innerHTML = `
      <td colspan="5">
        <div class="auditoria-tabla__detalle">
          <p>${escapar(resumen)}</p>
          ${renderizarDetalleTecnico(evento)}
          ${renderizarPanelCorrelacion(evento)}
        </div>
      </td>
    `;
    fragmento.append(fila, detalle);
    return fragmento;
  }

  function alternarDetalleEvento(boton) {
    const detalle = cuerpoTabla.querySelector(`#${CSS.escape(boton.getAttribute('aria-controls'))}`);
    if (!detalle) return;
    const abrir = detalle.hidden;
    detalle.hidden = !abrir;
    boton.setAttribute('aria-expanded', String(abrir));
    boton.textContent = abrir ? 'Cerrar' : 'Detalle';
  }

  function renderizarDetalleTecnico(evento) {
    const cambios = renderizarDetalleCambios(evento.detalleCambios);
    const campos = [
      ['Evento', evento.eventoId],
      ['Tipo de evento', evento.tipoEvento],
      ['Registrado en UTC', evento.registradoEnUtc],
      ['Actor real', describirIdentidadHumana(evento.actorReal)],
      ['Actor efectivo', describirIdentidadHumana(evento.actorEfectivo)],
      ['Rol', evento.rolEvento],
      ['Origen', evento.origen],
      ['Modo de actuación', evento.modoActuacion],
      ['Cadena', evento.claveCadena],
      ['Correlación', evento.correlacionId],
      ['Contraparte', evento.eventoContraparteId],
      ['Causalidad', describirIdentidad(evento.causalidad)]
    ].filter(([, valor]) => valor != null && valor !== '');
    const tecnico = !campos.length
      ? '<p class="texto-apoyo">Sin detalle técnico autorizado.</p>'
      : `
      <details class="auditoria-evento__tecnico">
        <summary>Ver detalle técnico autorizado</summary>
        <dl>
          ${campos.map(([etiqueta, valor]) => `<div><dt>${escapar(etiqueta)}</dt><dd>${escapar(valor)}</dd></div>`).join('')}
        </dl>
      </details>
    `;
    return `${cambios}${tecnico}`;
  }

  function renderizarDetalleCambios(detalle) {
    if (
      detalle?.version !== 1 ||
      !Array.isArray(detalle.cambios) ||
      detalle.cambios.length === 0
    ) return '';
    return `
      <section class="auditoria-cambios" aria-label="Cambios del evento">
        <div class="auditoria-cambios__titulo">
          <i class="bi bi-arrow-left-right" aria-hidden="true"></i>
          <strong>${escapar(tituloCambios(detalle.clase))}</strong>
        </div>
        <div class="auditoria-cambios__tabla" role="table" aria-label="Valores anteriores y nuevos">
          <div class="auditoria-cambios__fila auditoria-cambios__cabecera" role="row">
            <span role="columnheader">Campo</span>
            <span role="columnheader">Antes</span>
            <span role="columnheader">Después</span>
          </div>
          ${detalle.cambios.map((cambio) => `
            <div class="auditoria-cambios__fila" role="row">
              <strong role="rowheader">${escapar(etiquetarCampoCambio(cambio.campo))}</strong>
              <div class="auditoria-cambios__valor auditoria-cambios__valor--antes" role="cell" data-label="Antes">${formatearValorCambio(cambio.antes)}</div>
              <div class="auditoria-cambios__valor auditoria-cambios__valor--despues" role="cell" data-label="Después">${formatearValorCambio(cambio.despues)}</div>
            </div>
          `).join('')}
        </div>
      </section>
    `;
  }

  function tituloCambios(clase) {
    if (clase === 'alta') return 'Datos registrados';
    if (clase === 'eliminacion') return 'Datos eliminados';
    if (clase === 'estado') return 'Cambio de estado';
    return 'Cambios realizados';
  }

  function etiquetarCampoCambio(campo) {
    const camposConocidos = {
      permisoAdministrarConfiguracion: 'Permiso para administrar configuración'
    };
    if (camposConocidos[campo]) return camposConocidos[campo];
    const texto = String(campo || 'campo')
      .replaceAll(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replaceAll(/[._-]+/g, ' ')
      .trim()
      .toLocaleLowerCase('es');
    return texto ? `${texto.charAt(0).toLocaleUpperCase('es')}${texto.slice(1)}` : 'Campo';
  }

  function formatearValorCambio(valor) {
    if (valor === null) return '<span class="auditoria-cambios__ausencia">Sin valor</span>';
    if (typeof valor === 'boolean') return escapar(valor ? 'Sí' : 'No');
    if (typeof valor === 'object') {
      return `<pre>${escapar(JSON.stringify(valor, null, 2))}</pre>`;
    }
    const texto = String(valor);
    return texto.length
      ? `<span>${escapar(texto)}</span>`
      : '<span class="auditoria-cambios__ausencia">Vacío</span>';
  }

  function renderizarPanelCorrelacion(evento) {
    if (!evento.correlacionId) return '';
    const id = escapar(evento.correlacionId);
    return `
      <section class="auditoria-correlacion" data-auditoria-correlacion-panel data-correlacion-id="${id}" data-evento-id="${escapar(evento.eventoId || '')}">
        <button type="button" class="btn btn-sm auditoria-accion" data-auditoria-correlacion-accion="alternar" aria-expanded="false">
          Ver eventos correlacionados
        </button>
        <div class="auditoria-correlacion__contenido" data-auditoria-correlacion-contenido hidden>
          <p class="texto-apoyo" data-auditoria-correlacion-estado aria-live="polite"></p>
          <div class="auditoria-correlacion__lista" data-auditoria-correlacion-lista></div>
          <div class="auditoria-correlacion__paginacion" aria-label="Navegación de eventos correlacionados">
            <button type="button" class="btn btn-sm auditoria-accion" data-auditoria-correlacion-accion="primera" disabled>Primera</button>
            <button type="button" class="btn btn-sm auditoria-accion" data-auditoria-correlacion-accion="anterior" disabled>Anterior</button>
            <span data-auditoria-correlacion-pagina>Página 1</span>
            <button type="button" class="btn btn-sm auditoria-accion" data-auditoria-correlacion-accion="siguiente" disabled>Siguiente</button>
          </div>
        </div>
      </section>
    `;
  }

  function alternarCorrelacion(panel, boton) {
    const contenido = panel.querySelector('[data-auditoria-correlacion-contenido]');
    const abrir = contenido.hidden;
    contenido.hidden = !abrir;
    boton.setAttribute('aria-expanded', String(abrir));
    boton.textContent = abrir ? 'Cerrar eventos correlacionados' : 'Ver eventos correlacionados';
    if (abrir && !navegacionCorrelaciones.has(panel)) {
      navegacionCorrelaciones.set(panel, {
        cursores: [null], indice: 0, siguiente: null, cargada: false
      });
    }
    const navegacion = navegacionCorrelaciones.get(panel);
    if (abrir && !navegacion.cargada) {
      void cargarCorrelacion(panel, { indiceObjetivo: 0 });
    }
  }

  async function cargarCorrelacion(panel, { indiceObjetivo }) {
    const navegacion = navegacionCorrelaciones.get(panel);
    if (!navegacion || indiceObjetivo < 0 || indiceObjetivo >= navegacion.cursores.length) return;
    navegacion.controlador?.abort();
    const controlador = new AbortController();
    navegacion.controlador = controlador;
    controladoresCorrelacion.add(controlador);
    const estadoCorrelacion = panel.querySelector('[data-auditoria-correlacion-estado]');
    const botones = panel.querySelectorAll('[data-auditoria-correlacion-accion]:not([data-auditoria-correlacion-accion="alternar"])');
    botones.forEach((boton) => { boton.disabled = true; });
    estadoCorrelacion.textContent = `Cargando página correlacionada ${indiceObjetivo + 1}…`;
    const correlacionId = panel.dataset.correlacionId;
    const parametros = new URLSearchParams({ limite: '10', orden: 'desc' });
    const cursor = navegacion.cursores[indiceObjetivo];
    if (cursor) parametros.set('cursor', cursor);
    try {
      const respuesta = await fetch(
        `${urlCorrelaciones}/${encodeURIComponent(correlacionId)}/eventos?${parametros.toString()}`,
        { headers: { Accept: 'application/json' }, signal: controlador.signal }
      );
      const datos = await respuesta.json().catch(() => ({}));
      if (!respuesta.ok) throw new Error(datos.mensaje || `No se pudo cargar la correlación (${respuesta.status}).`);
      if (navegacion.controlador !== controlador) return;
      const eventos = Array.isArray(datos.eventos) ? datos.eventos : [];
      const otrosEventos = eventos.filter((evento) => evento.eventoId !== panel.dataset.eventoId);
      navegacion.indice = indiceObjetivo;
      navegacion.siguiente = datos.paginacion?.siguienteCursor || null;
      navegacion.cargada = true;
      navegacion.cursores = navegacion.cursores.slice(0, indiceObjetivo + 1);
      if (navegacion.siguiente) navegacion.cursores.push(navegacion.siguiente);
      renderizarPaginaCorrelacion(panel, otrosEventos, navegacion);
      estadoCorrelacion.textContent = otrosEventos.length
        ? `${otrosEventos.length} evento${otrosEventos.length === 1 ? '' : 's'} adicional${otrosEventos.length === 1 ? '' : 'es'} visible${otrosEventos.length === 1 ? '' : 's'} en esta página.`
        : navegacion.siguiente
          ? 'No hay otros eventos en esta página; puedes consultar la siguiente.'
          : 'No hay otros eventos visibles en esta correlación.';
    } catch (err) {
      if (err?.name === 'AbortError') return;
      estadoCorrelacion.textContent = err?.message || 'No se pudo cargar la correlación.';
    } finally {
      controladoresCorrelacion.delete(controlador);
      if (navegacion.controlador === controlador) navegacion.controlador = null;
      actualizarControlesCorrelacion(panel, navegacion);
    }
  }

  function renderizarPaginaCorrelacion(panel, eventos, navegacion) {
    const lista = panel.querySelector('[data-auditoria-correlacion-lista]');
    const fragmento = document.createDocumentFragment();
    for (const evento of eventos) {
      const articulo = document.createElement('article');
      articulo.className = 'auditoria-correlacion__evento';
      articulo.innerHTML = `
        <time datetime="${escapar(evento.registradoEnUtc || '')}">${escapar(formatearHora(evento.registradoEnUtc))}</time>
        <div><strong title="${escapar(evento.tipoEvento || '')}">${escapar(etiquetarEvento(evento.tipoEvento))}</strong><span>${escapar(describirSujeto(evento.sujeto))}</span></div>
        ${renderizarDetalleTecnico(evento)}
      `;
      fragmento.appendChild(articulo);
    }
    lista.replaceChildren(fragmento);
    panel.querySelector('[data-auditoria-correlacion-pagina]').textContent = `Página ${navegacion.indice + 1}`;
    actualizarControlesCorrelacion(panel, navegacion);
  }

  function actualizarControlesCorrelacion(panel, navegacion) {
    panel.querySelector('[data-auditoria-correlacion-accion="primera"]').disabled = navegacion.indice === 0;
    panel.querySelector('[data-auditoria-correlacion-accion="anterior"]').disabled = navegacion.indice === 0;
    panel.querySelector('[data-auditoria-correlacion-accion="siguiente"]').disabled = !navegacion.siguiente;
  }

  function cancelarCorrelaciones() {
    for (const controlador of controladoresCorrelacion) controlador.abort();
    controladoresCorrelacion.clear();
  }

  async function cargarIntegridad() {
    if (!urlDiagnosticos || !integridadCadenas) return;
    integridadError.hidden = true;
    integridadEstado.textContent = 'Consultando diagnóstico de cadenas visibles…';
    try {
      const parametros = new URLSearchParams({ limite: '50' });
      const respuesta = await fetch(`${urlDiagnosticos}?${parametros.toString()}`, {
        headers: { Accept: 'application/json' }
      });
      if (!respuesta.ok) throw new Error(`No se pudo cargar la integridad (${respuesta.status}).`);
      const datos = await respuesta.json();
      renderizarIntegridad(datos);
    } catch (err) {
      integridadError.textContent = err?.message || 'Error cargando integridad.';
      integridadError.hidden = false;
      integridadEstado.textContent = 'No se pudo actualizar la integridad.';
    }
  }

  function renderizarIntegridad(datos) {
    const resumen = datos.resumen || {};
    integridadTotal.textContent = String(resumen.total || 0);
    integridadProblemas.textContent = String(resumen.problematicos || 0);
    integridadPendientes.textContent = String(resumen.pendientes || 0);
    integridadCadenas.replaceChildren();
    integridadIncidentesLista.replaceChildren();

    const cadenas = datos.cadenas || [];
    const incidentes = datos.incidentes || [];
    integridadResumen.hidden = cadenas.length === 0;
    integridadAviso.hidden = cadenas.length === 0;
    integridadVacio.hidden = cadenas.length !== 0;
    integridadEstado.textContent = cadenas.length
      ? `${cadenas.length} cadena${cadenas.length === 1 ? '' : 's'} visible${cadenas.length === 1 ? '' : 's'} evaluada${cadenas.length === 1 ? '' : 's'}.`
      : 'Sin diagnóstico visible para tu alcance actual.';

    for (const cadena of cadenas) {
      integridadCadenas.appendChild(renderizarCadenaIntegridad(cadena));
    }
    for (const incidente of incidentes) {
      integridadIncidentesLista.appendChild(renderizarIncidente(incidente));
    }
    integridadIncidentes.hidden = incidentes.length === 0;
  }

  function renderizarCadenaIntegridad(cadena) {
    const articulo = document.createElement('article');
    articulo.className = `auditoria-integridad-cadena auditoria-integridad-cadena--${escaparClase(cadena.estadoVerificacion)}`;
    const estado = describirIntegridadCadena(cadena);
    articulo.innerHTML = `
      <div class="auditoria-integridad-cadena__cabecera">
        <div>
          <strong>${escapar(cadena.claveCadena)}</strong>
          <p>${escapar(estado)}</p>
        </div>
        <span class="insignia">${escapar(etiquetarTipo(cadena.estadoVerificacion))}</span>
      </div>
      ${cadena.alcanceDetalle === 'completo' ? renderizarDetalleCadena(cadena) : '<p class="texto-apoyo">Detalle técnico oculto por alcance.</p>'}
    `;
    return articulo;
  }

  function renderizarDetalleCadena(cadena) {
    const detalle = cadena.diagnostico ? JSON.stringify(cadena.diagnostico, null, 2) : 'Sin detalle adicional.';
    return `
      <details class="auditoria-integridad-detalle">
        <summary>Ver detalle técnico</summary>
        <dl>
          <div><dt>Rango verificado</dt><dd>${escapar(cadena.desdeSecuencia || '—')} → ${escapar(cadena.hastaSecuencia || '—')}</dd></div>
          <div><dt>Última secuencia verificada</dt><dd>${escapar(cadena.ultimaSecuenciaVerificada || '—')}</dd></div>
          <div><dt>Cabecera actual</dt><dd>${escapar(cadena.cabeceraUltimaSecuencia || '—')}</dd></div>
          <div><dt>Actualizado</dt><dd>${escapar(formatearHora(cadena.actualizadoEnUtc))}</dd></div>
        </dl>
        <pre>${escapar(detalle)}</pre>
      </details>
    `;
  }

  function describirIntegridadCadena(cadena) {
    if (cadena.pendienteRevision) {
      return `Pendiente: verificada hasta ${cadena.hastaSecuencia || 'un rango conocido'}, cabecera en ${cadena.cabeceraUltimaSecuencia || 'una posición posterior'}.`;
    }
    if (cadena.estadoVerificacion === 'integra') {
      return `Íntegra hasta ${cadena.hastaSecuencia || cadena.ultimaSecuenciaVerificada || 'el último rango verificado'}.`;
    }
    if (cadena.estadoVerificacion === 'rota') return 'Rotura detectada en el rango verificado.';
    if (cadena.estadoVerificacion === 'incompleta') return 'Cadena incompleta en el rango verificado.';
    if (cadena.estadoVerificacion === 'sin_datos') return 'Sin datos verificables para esta cadena.';
    return `Estado ${cadena.estadoVerificacion || 'desconocido'} en el último diagnóstico.`;
  }

  function renderizarIncidente(incidente) {
    const articulo = document.createElement('article');
    articulo.className = 'auditoria-integridad-incidente';
    const puedeReconocer = incidente.alcanceDetalle === 'completo' && !incidente.reconocido;
    articulo.innerHTML = `
      <div>
        <strong>${escapar(incidente.codigo || 'incidencia')}</strong>
        <p>${escapar(incidente.claveCadena)} · ${escapar(etiquetarTipo(incidente.estadoDeteccion))}</p>
      </div>
      ${incidente.alcanceDetalle === 'completo' ? `
        <details class="auditoria-integridad-detalle">
          <summary>Ver daño observado</summary>
          <pre>${escapar(JSON.stringify(incidente.detalle || {}, null, 2))}</pre>
        </details>
      ` : '<p class="texto-apoyo">Incidencia visible solo como resumen por alcance.</p>'}
      ${puedeReconocer ? `
        <form data-auditoria-reconocer-incidente data-episodio-id="${escapar(incidente.episodioId)}">
          <label>
            <span>Comentario opcional</span>
            <input class="form-control" name="comentario" maxlength="1000" placeholder="Ej. revisado por operación">
          </label>
          <button type="submit" class="btn auditoria-accion">
            <i class="bi bi-check2-circle" aria-hidden="true"></i>
            <span>Reconocer incidencia</span>
          </button>
          <small class="texto-apoyo" data-auditoria-reconocer-estado></small>
        </form>
      ` : '<small class="texto-apoyo">No reconocible desde este alcance o ya reconocida.</small>'}
    `;
    return articulo;
  }

  async function reconocerIncidente(formularioReconocimiento) {
    const episodioId = formularioReconocimiento.dataset.episodioId;
    const estadoReconocimiento = formularioReconocimiento.querySelector('[data-auditoria-reconocer-estado]');
    const boton = formularioReconocimiento.querySelector('button[type="submit"]');
    const datos = new FormData(formularioReconocimiento);
    estadoReconocimiento.textContent = 'Registrando reconocimiento…';
    boton.disabled = true;
    try {
      const respuesta = await fetch(`/auditoria/api/incidentes/${encodeURIComponent(episodioId)}/reconocer`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...cabeceraCsrf()
        },
        body: JSON.stringify({ comentario: String(datos.get('comentario') || '').trim() })
      });
      const cuerpo = await respuesta.json().catch(() => ({}));
      if (!respuesta.ok) throw new Error(cuerpo.mensaje || `No se pudo reconocer (${respuesta.status}).`);
      estadoReconocimiento.textContent = cuerpo.mensaje || 'Incidencia reconocida.';
      await cargarIntegridad();
    } catch (err) {
      estadoReconocimiento.textContent = err?.message || 'No se pudo reconocer la incidencia.';
      boton.disabled = false;
    }
  }

  function resumirPayload(payload) {
    if (Array.isArray(payload.camposCambiados) && payload.camposCambiados.length) {
      const campos = payload.camposCambiados.slice(0, 4).map((campo) => {
        const etiqueta = etiquetarCampoCambio(campo);
        return etiqueta.charAt(0).toLocaleLowerCase('es') + etiqueta.slice(1);
      });
      return `Cambios en ${campos.join(', ')}.`;
    }
    if (payload.resultado) return `Resultado: ${payload.resultado}.`;
    if (payload.causa) return `Causa: ${payload.causa}.`;
    if (payload.tipo) return `Tipo: ${payload.tipo}.`;
    return 'No hay un resumen adicional para este evento.';
  }

  function describirActor(evento) {
    const real = describirIdentidadHumana(evento.actorReal) || 'Actor desconocido';
    if (!evento.actorEfectivo) return real;
    return `${real} como ${describirIdentidadHumana(evento.actorEfectivo)}`;
  }

  function describirIdentidadHumana(identidad) {
    if (!identidad?.tipo || identidad?.id == null) return null;
    return identidad.nombreVisible || `${etiquetarTipo(identidad.tipo)} no disponible`;
  }

  function describirIdentidad(identidad) {
    return identidad?.tipo && identidad?.id ? `${identidad.tipo}:${identidad.id}` : null;
  }

  function describirSujeto(sujeto) {
    return describirIdentidadHumana(sujeto) || 'Sujeto no indicado';
  }

  function etiquetarTipo(tipo) {
    return String(tipo || 'evento').replaceAll('_', ' ');
  }

  function etiquetarEvento(tipo) {
    return etiquetasTiposEvento.get(tipo) || etiquetarTipo(tipo).replaceAll('.', ' · ');
  }

  function etiquetarFlujo(flujo) {
    const nombres = {
      internet: 'Frontera de Internet', sistema: 'Sistema', usuarios: 'Usuarios',
      organizacion: 'Organización', agentes: 'Agentes', monitores: 'Monitores',
      alertas: 'Alertas', automatizacion: 'Automatización', dns: 'DNS',
      federacion: 'Federación'
    };
    return nombres[flujo] || flujo || 'Flujo no indicado';
  }

  function etiquetarOrigen(origen) {
    const nombres = {
      web: 'Web', api_agentes: 'API de agentes', runtime: 'Runtime',
      bootstrap: 'Arranque del sistema', tarea_sistema: 'Tarea del sistema',
      api_federacion: 'API de federación'
    };
    return nombres[origen] || origen || 'Origen no indicado';
  }

  function buscarTiposEvento() {
    if (!tipoEventoFiltro || !tipoEventoOpciones) return;
    const texto = tipoEventoFiltro.value.trim();
    actualizarAyudaTipoEvento();
    if (texto.length < 2 || etiquetasTiposEvento.has(texto)) {
      ocultarOpcionesTipoEvento();
      return;
    }
    const consulta = normalizarBusquedaTipoEvento(texto);
    const coincidentes = [...etiquetasTiposEvento]
      .filter(([codigo, etiqueta]) => normalizarBusquedaTipoEvento(`${etiqueta} ${codigo}`).includes(consulta))
      .slice(0, 12);
    const fragmento = document.createDocumentFragment();
    for (const [codigo, etiqueta] of coincidentes) {
      const boton = document.createElement('button');
      boton.type = 'button';
      boton.className = 'auditoria-tipo-evento__opcion';
      boton.dataset.tipoEventoOpcion = codigo;
      const nombre = document.createElement('strong');
      nombre.textContent = etiqueta;
      const codigoVisible = document.createElement('small');
      codigoVisible.textContent = codigo;
      boton.append(nombre, codigoVisible);
      fragmento.appendChild(boton);
    }
    tipoEventoOpciones.replaceChildren(fragmento);
    tipoEventoOpciones.hidden = coincidentes.length === 0;
    tipoEventoFiltro.setAttribute('aria-expanded', String(coincidentes.length > 0));
    if (!coincidentes.length) tipoEventoAyuda.textContent = 'Sin sugerencias. Si es un tipo histórico, escribe su código completo.';
  }

  function normalizarBusquedaTipoEvento(valor) {
    return String(valor).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es');
  }

  function seleccionarTipoEvento(codigo) {
    tipoEventoFiltro.value = codigo;
    ocultarOpcionesTipoEvento();
    actualizarAyudaTipoEvento();
    tipoEventoFiltro.focus();
  }

  function ocultarOpcionesTipoEvento() {
    if (!tipoEventoOpciones) return;
    tipoEventoOpciones.hidden = true;
    tipoEventoOpciones.replaceChildren();
    tipoEventoFiltro?.setAttribute('aria-expanded', 'false');
  }

  function validarTipoEvento() {
    const codigo = tipoEventoFiltro.value.trim();
    if (!codigo || etiquetasTiposEvento.has(codigo) || /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/u.test(codigo)) return true;
    buscarTiposEvento();
    tipoEventoFiltro.focus();
    tipoEventoAyuda.textContent = 'Selecciona una sugerencia o escribe un código histórico completo, por ejemplo usuario.creado.';
    return false;
  }

  function actualizarAyudaTipoEvento() {
    if (!tipoEventoFiltro || !tipoEventoAyuda) return;
    const codigo = tipoEventoFiltro.value.trim();
    tipoEventoAyuda.textContent = !codigo
      ? 'Escribe y elige una sugerencia; se aplicará su código exacto.'
      : etiquetasTiposEvento.has(codigo)
        ? `${etiquetasTiposEvento.get(codigo)} · código exacto seleccionado.`
        : 'Busca una sugerencia por nombre o código. También puedes introducir un código histórico completo.';
  }

  function formatearHora(valor) {
    const fecha = new Date(valor);
    if (Number.isNaN(fecha.getTime())) return valor || '';
    return new Intl.DateTimeFormat('es-ES', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hourCycle: 'h23', timeZoneName: 'short'
    }).format(fecha);
  }

  function cabeceraCsrf() {
    const token = document.querySelector('meta[name="csrf-token"]')?.content ||
      document.body?.dataset?.csrfToken ||
      '';
    return token ? { 'X-CSRF-Token': token } : {};
  }

  function escaparClase(valor) {
    return String(valor || 'desconocido').replaceAll(/[^a-z0-9_-]/gi, '-').toLowerCase();
  }

  function escapar(valor) {
    return String(valor ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }
})();
