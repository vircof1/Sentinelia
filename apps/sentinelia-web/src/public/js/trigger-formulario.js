(function () {
  const modulo = document.querySelector('[data-trigger-formulario]');

  if (!modulo) {
    return;
  }

  const selectorPertenencia = modulo.querySelector('[data-trigger-pertenencia]');
  const selectorTipo = modulo.querySelector('select[name="tipo"]');
  const selectorTenant = modulo.querySelector('[data-trigger-tenant]');
  const selectorEmpresa = modulo.querySelector('[data-trigger-empresa]');
  const selectorSitio = modulo.querySelector('[data-trigger-sitio]');
  const selectorOperacionDns = modulo.querySelector('[data-trigger-dns-operacion]');
  const bloqueValorDns = modulo.querySelector('[data-trigger-dns-valor]');
  const ayudaOperacionDns = modulo.querySelector('[data-trigger-dns-ayuda-operacion]');
  const formularioTrigger = modulo.querySelector('[data-trigger-form]');
  const botonEntradas = modulo.querySelector('[data-trigger-entradas-toggle]');
  const panelEntradas = modulo.querySelector('[data-trigger-entradas]');
  const inputZonaDns = modulo.querySelector('input[name="zonaId"]');
  const inputRegistroDns = modulo.querySelector('input[name="registroId"]');
  const inputRolGobernanzaDns = modulo.querySelector('input[name="rolGobernanza"]');
  const inputNombre = modulo.querySelector('input[name="nombre"]');
  const selectorActivo = modulo.querySelector('select[name="activo"]');
  const inputUrlApi = modulo.querySelector('input[name="url"]');
  const selectorMetodoApi = modulo.querySelector('select[name="metodo"]');
  const heroDestinoApi = modulo.querySelector('[data-trigger-api-hero-destino]');
  const heroDetalleApi = modulo.querySelector('[data-trigger-api-hero-detalle]');
  const heroEstado = modulo.querySelector('[data-trigger-hero-estado]');
  const heroEstadoTarjeta = modulo.querySelector('[data-trigger-hero-estado-tarjeta]');
  const heroEstadoIcono = modulo.querySelector('[data-trigger-hero-estado-icono]');
  const inputTimeoutApi = modulo.querySelector('input[name="timeoutMs"]');
  const inputReintentosApi = modulo.querySelector('input[name="reintentos"]');
  const inputParametroApi = modulo.querySelector('input[name="parametroOpcional"]');
  const inputTlsInseguroApi = modulo.querySelector('input[name="permiteTlsInseguro"]');
  const inputCabecerasApi = modulo.querySelector('textarea[name="cabeceras"]');
  const inputCuerpoApi = modulo.querySelector('textarea[name="plantillaCuerpo"]');
  const ayudaTiempoApi = modulo.querySelector('[data-trigger-api-tiempo-ayuda]');
  const modalPreviaApi = modulo.querySelector('[data-trigger-api-previa-modal]');
  let destinoInsercionApi = null;
  const inputValorPrincipalDns = modulo.querySelector('input[name="valorPrincipal"]');
  const botonAbrirSelectorDns = modulo.querySelector(
    '[data-trigger-dns-abrir-selector]'
  );
  const resumenSeleccionDns = modulo.querySelector(
    '[data-trigger-dns-seleccion-resumen]'
  );
  const bloqueSeleccionDns = modulo.querySelector('[data-trigger-dns-seleccion]');
  const detalleSeleccionDns = modulo.querySelector(
    '[data-trigger-dns-seleccion-detalle]'
  );
  const publicacionSeleccionDns = modulo.querySelector('[data-trigger-dns-publicacion]');
  const enlaceEditarRegistroDns = modulo.querySelector('[data-trigger-dns-editar-registro]');
  const cambioValorDns = modulo.querySelector('[data-trigger-dns-cambio]');
  const errorValorDns = modulo.querySelector('[data-trigger-dns-valor-error]');
  const ayudaRolDns = modulo.querySelector('[data-trigger-dns-rol-ayuda]');
  const inputNuevoValorDns = modulo.querySelector('input[name="valorPrincipal"]');
  const ejemplosValorDns = {
    A: '192.0.2.10',
    AAAA: '2001:db8::10',
    CNAME: 'destino.ejemplo.local',
    NS: 'ns1.ejemplo.local',
    MX: 'correo.ejemplo.local',
    PTR: 'servidor.ejemplo.local',
    TXT: 'texto del registro',
    SRV: 'servicio.ejemplo.local',
    CAA: 'autoridad.example'
  };
  let seleccionDnsActual = bloqueSeleccionDns?.dataset.triggerDnsNombreInicial
    ? {
        nombreVisible: bloqueSeleccionDns.dataset.triggerDnsNombreInicial,
        tipoRegistro: bloqueSeleccionDns.dataset.triggerDnsTipoInicial,
        valorPrincipal: bloqueSeleccionDns.dataset.triggerDnsValorInicial,
        prioridad: bloqueSeleccionDns.dataset.triggerDnsPrioridadInicial === ''
          ? null
          : Number(bloqueSeleccionDns.dataset.triggerDnsPrioridadInicial),
        publicarEnBind: bloqueSeleccionDns.dataset.triggerDnsPublicarInicial === '1',
        rolAsignado: bloqueSeleccionDns.dataset.triggerDnsRolInicial
      }
    : null;
  const modalSelectorDnsNodo = modulo.querySelector(
    '[data-trigger-dns-selector-modal]'
  );
  const modalPlanTriggerNodo = modulo.querySelector('[data-trigger-plan-modal]');
  const cuerpoPlanTrigger = modulo.querySelector('[data-trigger-plan-cuerpo]');
  const botonConfirmarPlanTrigger = modulo.querySelector(
    '[data-trigger-plan-confirmar]'
  );
  const inputBusquedaSelectorDns = modulo.querySelector(
    '[data-trigger-dns-selector-busqueda]'
  );
  const botonBuscarSelectorDns = modulo.querySelector(
    '[data-trigger-dns-selector-buscar]'
  );
  const estadoSelectorDns = modulo.querySelector(
    '[data-trigger-dns-selector-estado]'
  );
  const cuerpoResultadosSelectorDns = modulo.querySelector(
    '[data-trigger-dns-selector-resultados]'
  );
  const ayudaScopeEmpresa = modulo.querySelector('[data-trigger-scope-tooltip="empresa"]');
  const ayudaScopeSitio = modulo.querySelector('[data-trigger-scope-tooltip="sitio"]');
  const textoAyudaScopeEmpresa = modulo.querySelector(
    '[data-trigger-scope-ayuda="empresa"]'
  );
  const textoAyudaScopeSitio = modulo.querySelector(
    '[data-trigger-scope-ayuda="sitio"]'
  );
  const campoTenant = modulo.querySelector('[data-trigger-campo-scope="tenant"]');
  const campoEmpresa = modulo.querySelector('[data-trigger-campo-scope="empresa"]');
  const campoSitio = modulo.querySelector('[data-trigger-campo-scope="sitio"]');
  const resumenPertenencia = Array.from(
    modulo.querySelectorAll('[data-trigger-scope-pertenencia]')
  );
  const resumenDestino = Array.from(
    modulo.querySelectorAll('[data-trigger-scope-destino]')
  );
  const selectorUsuariosCorreo = modulo.querySelector(
    '[data-trigger-correo-selector-usuarios]'
  );
  const inputBuscarUsuarioCorreo = modulo.querySelector(
    '[data-trigger-correo-busqueda-usuario]'
  );
  const botonBuscarUsuarioCorreo = modulo.querySelector(
    '[data-trigger-correo-buscar-usuario]'
  );
  const resultadosUsuariosCorreo = modulo.querySelector(
    '[data-trigger-correo-resultados-usuarios]'
  );
  const bloqueAudienciaCorreo = modulo.querySelector('[data-trigger-correo-audiencia]');
  const asuntoPreviaCorreo = modulo.querySelector('[data-trigger-correo-previa-asunto]');
  const asuntoModalPreviaCorreo = modulo.querySelector('[data-trigger-correo-previa-asunto-modal]');
  const cuerpoPreviaCorreo = modulo.querySelector('[data-trigger-correo-previa-cuerpo]');
  const textoPreviaCorreo = modulo.querySelector('[data-trigger-correo-previa-texto]');
  const modalPreviaCorreo = modulo.querySelector('[data-trigger-correo-previa-modal]');
  const estadoPreviaCorreo = modulo.querySelector('[data-trigger-correo-previa-estado]');
  let temporizadorPreviaCorreo = null;
  let revisionPreviaCorreo = 0;
  let envioConfirmadoPorPlan = false;

  if (!selectorTenant || !selectorEmpresa || !selectorSitio) {
    return;
  }

  const tenantBloqueadoPorScope = selectorTenant.hasAttribute('disabled');
  const empresaBloqueadaPorScope = selectorEmpresa.hasAttribute('disabled');
  const sitioBloqueadoPorScope = selectorSitio.hasAttribute('disabled');

  if (botonEntradas && panelEntradas) {
    botonEntradas.addEventListener('click', function () {
      panelEntradas.hidden = !panelEntradas.hidden;
      botonEntradas.setAttribute('aria-expanded', String(!panelEntradas.hidden));
    });
  }

  function actualizarAyudaTiempoApi() {
    if (!ayudaTiempoApi || !inputTimeoutApi) return;
    const milisegundos = Number(inputTimeoutApi.value);
    ayudaTiempoApi.textContent = Number.isFinite(milisegundos) && milisegundos > 0
      ? `${milisegundos} ms = ${String(milisegundos / 1000).replace('.', ',')} s.`
      : '';
  }

  function actualizarHeroAltaApi() {
    if (heroDestinoApi && heroDetalleApi) {
      let destino = null;
      try {
        const url = new URL(String(inputUrlApi?.value || '').trim());
        if (['http:', 'https:'].includes(url.protocol)) destino = url.host;
      } catch {
        // El campo puede estar incompleto mientras se escribe.
      }
      heroDestinoApi.textContent = destino || 'Destino pendiente';
      heroDetalleApi.textContent = destino
        ? `${selectorMetodoApi?.value || 'POST'} · solicitud HTTP/HTTPS`
        : 'Configura la URL en el formulario.';
    }

    if (heroEstado && heroEstadoTarjeta && heroEstadoIcono) {
      const activo = selectorActivo?.value === '1';
      heroEstado.textContent = activo ? 'Activo al crear' : 'Inactivo al crear';
      heroEstadoTarjeta.classList.toggle('kpi-resumen--ok', activo);
      heroEstadoTarjeta.classList.toggle('kpi-resumen--neutro', !activo);
      heroEstadoIcono.classList.toggle('bi-check-circle', activo);
      heroEstadoIcono.classList.toggle('bi-pause-circle', !activo);
    }
  }

  inputUrlApi?.addEventListener('input', actualizarHeroAltaApi);
  selectorMetodoApi?.addEventListener('change', actualizarHeroAltaApi);
  selectorActivo?.addEventListener('change', actualizarHeroAltaApi);
  actualizarHeroAltaApi();

  actualizarAyudaTiempoApi();
  inputTimeoutApi?.addEventListener('input', actualizarAyudaTiempoApi);

  for (const campo of [inputCuerpoApi, inputCabecerasApi]) {
    campo?.addEventListener('focus', function () { destinoInsercionApi = campo; });
  }

  for (const boton of modulo.querySelectorAll('[data-trigger-api-insertar]')) {
    boton.addEventListener('click', function () {
      const campo = destinoInsercionApi || inputCuerpoApi;
      if (!campo) return;
      const inicio = campo.selectionStart;
      const fin = campo.selectionEnd;
      campo.setRangeText(boton.dataset.triggerApiInsertar, inicio, fin, 'end');
      campo.dispatchEvent(new Event('input', { bubbles: true }));
      campo.focus();
    });
  }

  function mostrarPreviaApi() {
    if (!modalPreviaApi) return;
    const destino = modalPreviaApi.querySelector('[data-trigger-api-previa-destino]');
    const cabeceras = modalPreviaApi.querySelector('[data-trigger-api-previa-cabeceras]');
    const cuerpo = modalPreviaApi.querySelector('[data-trigger-api-previa-cuerpo]');
    const metodo = selectorMetodoApi?.value || 'POST';
    const contextoEjemplo = {
      eventoDisparo: 'evento de ejemplo',
      monitor: { nombre: 'Monitor de ejemplo' },
      transicion: { estadoDetectado: 'indisponible' },
      configuracionEfectiva: { parametroOpcional: inputParametroApi?.value || '' }
    };
    const renderizar = (plantilla) => String(plantilla || '').replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_coincidencia, ruta) => {
      const valor = String(ruta).trim().split('.').reduce((actual, segmento) => actual?.[segmento], contextoEjemplo);
      return valor == null ? '' : typeof valor === 'object' ? JSON.stringify(valor) : String(valor);
    });
    destino.textContent = `${metodo} ${inputUrlApi?.value || '(URL pendiente)'}`;
    let totalCabeceras = 0;
    cabeceras.textContent = '';
    try {
      totalCabeceras = Object.keys(JSON.parse(inputCabecerasApi?.value || '{}')).length;
    } catch {
      cabeceras.textContent = 'Las cabeceras no contienen un JSON válido; corrígelas antes de guardar.';
    }
    if (!cabeceras.textContent) {
      cabeceras.textContent = totalCabeceras === 0
        ? 'Sin cabeceras adicionales.'
        : `${totalCabeceras} ${totalCabeceras === 1 ? 'cabecera configurada' : 'cabeceras configuradas'}; sus valores no se muestran aquí.`;
    }
    cuerpo.textContent = metodo === 'GET'
      ? 'GET no envía cuerpo, aunque exista una plantilla configurada.'
      : inputCuerpoApi?.value.trim()
        ? renderizar(inputCuerpoApi.value)
        : 'Sin cuerpo configurado.';
  }

  modalPreviaApi?.addEventListener('show.bs.modal', mostrarPreviaApi);

  function escapeHtml(valor) {
    return String(valor ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function mostrarCuerpoCorreo(texto) {
    if (!cuerpoPreviaCorreo || !textoPreviaCorreo) return;
    const contenido = String(texto || '').replace(/\r\n?/g, '\n');
    cuerpoPreviaCorreo.replaceChildren();
    for (const bloque of contenido.split(/\n\s*\n/)) {
      const [primeraLinea, ...resto] = bloque.split('\n');
      if ([
        'Detalles técnicos del aviso',
        'Resultado de la comprobación',
        'Descripción del problema:',
        'Posible solución:',
        'Estado o problema actual:',
        'Histórico del ciclo:'
      ].includes(primeraLinea)) {
        const titulo = document.createElement('h3');
        titulo.className = 'trigger-correo-previa__apartado';
        titulo.textContent = primeraLinea.replace(/:$/, '');
        cuerpoPreviaCorreo.append(titulo);
        if (!resto.length) continue;
        const parrafo = document.createElement('p');
        parrafo.textContent = resto.join('\n');
        cuerpoPreviaCorreo.append(parrafo);
        continue;
      }
      const parrafo = document.createElement('p');
      parrafo.textContent = bloque;
      cuerpoPreviaCorreo.append(parrafo);
    }
    textoPreviaCorreo.textContent = contenido;
  }

  if (textoPreviaCorreo) mostrarCuerpoCorreo(textoPreviaCorreo.textContent);

  async function actualizarPreviaCorreo() {
    if (!estadoPreviaCorreo || !formularioTrigger || !asuntoPreviaCorreo || !cuerpoPreviaCorreo) return;
    const revision = revisionPreviaCorreo;
    const triggerId = window.location.pathname.match(/\/monitores\/triggers\/editar\/(\d+)/)?.[1];
    const ruta = triggerId
      ? `/monitores/triggers/${triggerId}/correo/previsualizar`
      : '/monitores/triggers/correo/previsualizar';
    estadoPreviaCorreo.textContent = 'Actualizando vista previa…';
    try {
      const respuesta = await window.fetch(ruta, {
        method: 'POST',
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
        body: new URLSearchParams(new FormData(formularioTrigger))
      });
      const datos = await respuesta.json();
      if (!respuesta.ok || !datos.ok) throw new Error(datos.mensaje || 'No se pudo actualizar la vista previa.');
      if (revision !== revisionPreviaCorreo) return;
      asuntoPreviaCorreo.textContent = datos.previa.mensajeMaterializado.asunto;
      if (asuntoModalPreviaCorreo) asuntoModalPreviaCorreo.textContent = datos.previa.mensajeMaterializado.asunto;
      mostrarCuerpoCorreo(datos.previa.mensajeMaterializado.cuerpoBaseTexto);
      estadoPreviaCorreo.textContent = 'Vista previa actualizada con los cambios sin guardar.';
    } catch (error) {
      if (revision === revisionPreviaCorreo) estadoPreviaCorreo.textContent = error.message;
    }
  }

  if (estadoPreviaCorreo && formularioTrigger) {
    for (const nombre of ['asuntoPlantilla', 'textoIntroduccion', 'textoCierre']) {
      formularioTrigger.elements.namedItem(nombre)?.addEventListener('input', function () {
        revisionPreviaCorreo += 1;
        clearTimeout(temporizadorPreviaCorreo);
        estadoPreviaCorreo.textContent = 'Hay cambios sin reflejar en la vista previa…';
        temporizadorPreviaCorreo = setTimeout(actualizarPreviaCorreo, 350);
      });
    }
    modalPreviaCorreo?.addEventListener('show.bs.modal', function () {
      if (temporizadorPreviaCorreo) {
        clearTimeout(temporizadorPreviaCorreo);
        temporizadorPreviaCorreo = null;
        void actualizarPreviaCorreo();
      }
    });
  }

  async function buscarUsuariosCorreo() {
    if (!selectorUsuariosCorreo || !resultadosUsuariosCorreo) return;
    const parametros = new URLSearchParams({
      q: String(inputBuscarUsuarioCorreo?.value || '').trim(),
      limit: '25'
    });
    resultadosUsuariosCorreo.textContent = 'Buscando usuarios alcanzables...';
    try {
      const respuesta = await window.fetch(
        `${selectorUsuariosCorreo.dataset.url}?${parametros.toString()}`,
        { headers: { 'X-Requested-With': 'XMLHttpRequest' } }
      );
      const datos = await respuesta.json();
      if (!respuesta.ok || !datos.ok) throw new Error(datos.mensaje || 'Búsqueda fallida.');
      resultadosUsuariosCorreo.innerHTML = datos.resultados.length
        ? datos.resultados.map((usuario) => `
          <label class="d-flex gap-2 align-items-start border rounded p-2 mb-2">
            <input type="checkbox" name="audienciaUsuarios" value="${escapeHtml(usuario.id)}">
            <span>
              <strong>${escapeHtml(usuario.nombre)}</strong>
              <small class="d-block">${escapeHtml(usuario.email)}</small>
              ${usuario.entregableAhora ? '' : '<small class="d-block text-warning">El vínculo quedará dormido hasta que disponga de un correo validado y utilizable.</small>'}
            </span>
          </label>`).join('')
        : '<span class="text-body-secondary">No hay usuarios elegibles con ese filtro.</span>';
    } catch (error) {
      resultadosUsuariosCorreo.textContent = error.message;
    }
  }

  function reconstruirEmpresas() {
    const tenantId = String(selectorTenant.value || '').trim();
    const valorActual = String(selectorEmpresa.value || '').trim();
    const opciones = Array.from(selectorEmpresa.querySelectorAll('option'));
    let encontrado = false;

    for (const opcion of opciones) {
      if (!opcion.value) {
        opcion.hidden = false;
        continue;
      }

      const visible = tenantId && String(opcion.dataset.tenantId || '') === tenantId;
      opcion.hidden = !visible;

      if (visible && opcion.value === valorActual) {
        encontrado = true;
      }
    }

    if (!encontrado && !empresaBloqueadaPorScope) {
      selectorEmpresa.value = '';
    }
  }

  function reconstruirSitios() {
    const tenantId = String(selectorTenant.value || '').trim();
    const empresaId = String(selectorEmpresa.value || '').trim();
    const valorActual = String(selectorSitio.value || '').trim();
    const opciones = Array.from(selectorSitio.querySelectorAll('option'));
    let encontrado = false;

    for (const opcion of opciones) {
      if (!opcion.value) {
        opcion.hidden = false;
        continue;
      }

      const visible =
        tenantId &&
        empresaId &&
        String(opcion.dataset.tenantId || '') === tenantId &&
        String(opcion.dataset.empresaId || '') === empresaId;
      opcion.hidden = !visible;

      if (visible && opcion.value === valorActual) {
        encontrado = true;
      }
    }

    if (!encontrado && !sitioBloqueadoPorScope) {
      selectorSitio.value = '';
    }
  }

  function actualizarPertenencia() {
    if (!selectorPertenencia) {
      return;
    }

    const nivel = selectorPertenencia.value || 'portal';
    const requiereTenant = ['tenant', 'empresa', 'sitio'].includes(nivel);
    const requiereEmpresa = ['empresa', 'sitio'].includes(nivel);
    const requiereSitio = nivel === 'sitio';
    const tenantSeleccionado = Boolean(String(selectorTenant.value || '').trim());
    const empresaSeleccionada = Boolean(String(selectorEmpresa.value || '').trim());
    const opcionVaciaSitio = selectorSitio.querySelector('option[value=""]');

    if (campoTenant) {
      campoTenant.hidden = !requiereTenant;
    }

    if (campoEmpresa) {
      campoEmpresa.hidden = !requiereEmpresa;
    }

    if (campoSitio) {
      campoSitio.hidden = !requiereSitio;
    }

    if (opcionVaciaSitio) {
      opcionVaciaSitio.textContent = requiereSitio
        ? 'Selecciona sitio'
        : 'Sin sitio (trigger de empresa)';
    }

    if (!tenantBloqueadoPorScope) {
      selectorTenant.disabled = !requiereTenant;
    }

    if (!empresaBloqueadaPorScope) {
      selectorEmpresa.disabled = !requiereEmpresa || !tenantSeleccionado;
    }

    if (!sitioBloqueadoPorScope) {
      selectorSitio.disabled = !requiereSitio || !empresaSeleccionada;
    }

    selectorTenant.required = requiereTenant && !selectorTenant.disabled;
    selectorEmpresa.required = requiereEmpresa && !selectorEmpresa.disabled;
    selectorSitio.required = requiereSitio && !selectorSitio.disabled;

    if (!requiereTenant && !tenantBloqueadoPorScope) {
      selectorTenant.value = '';
    }

    if (!requiereEmpresa && !empresaBloqueadaPorScope) {
      selectorEmpresa.value = '';
    }

    if (!requiereSitio && !sitioBloqueadoPorScope) {
      selectorSitio.value = '';
    }

    actualizarAyudasScope({
      requiereEmpresa,
      requiereSitio,
      tenantSeleccionado,
      empresaSeleccionada
    });
  }

  function actualizarTooltipScope(contenedor, mensaje) {
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
  }

  function actualizarAyudasScope({
    requiereEmpresa,
    requiereSitio,
    tenantSeleccionado,
    empresaSeleccionada
  }) {
    const mensajeEmpresa =
      requiereEmpresa && !tenantSeleccionado && !empresaBloqueadaPorScope
        ? 'Selecciona antes un tenant para desbloquear la empresa.'
        : '';
    const mensajeSitio =
      requiereSitio && !empresaSeleccionada && !sitioBloqueadoPorScope
        ? 'Selecciona antes una empresa para desbloquear el sitio.'
        : '';

    actualizarTooltipScope(ayudaScopeEmpresa, mensajeEmpresa);
    actualizarTooltipScope(ayudaScopeSitio, mensajeSitio);

    if (textoAyudaScopeEmpresa) {
      textoAyudaScopeEmpresa.hidden = !mensajeEmpresa;
    }

    if (textoAyudaScopeSitio) {
      textoAyudaScopeSitio.hidden = !mensajeSitio;
    }
  }

  function resolverTextoDestino() {
    const tenantTexto =
      selectorTenant.selectedOptions?.[0]?.textContent?.trim() || 'Tenant pendiente';
    const empresaTexto =
      selectorEmpresa.selectedOptions?.[0]?.textContent?.trim() || 'Empresa pendiente';
    const sitioTexto =
      selectorSitio.selectedOptions?.[0]?.textContent?.trim() || '';
    const nivel =
      selectorPertenencia?.value ||
      (String(selectorSitio.value || '').trim() ? 'sitio' : 'empresa');

    if (nivel === 'portal') {
      return 'Portal completo';
    }

    if (nivel === 'tenant') {
      return selectorTenant.value ? tenantTexto : 'Tenant pendiente';
    }

    if (nivel === 'sitio') {
      return sitioTexto || 'Sitio pendiente';
    }

    if (selectorEmpresa.value) {
      return empresaTexto;
    }

    if (selectorTenant.value) {
      return `${tenantTexto} · empresa pendiente`;
    }

    return 'Alcance pendiente';
  }

  function actualizarResumenScope() {
    const nivel =
      selectorPertenencia?.value ||
      (String(selectorSitio.value || '').trim()
        ? 'sitio'
        : String(selectorEmpresa.value || '').trim()
          ? 'empresa'
          : String(selectorTenant.value || '').trim()
            ? 'tenant'
            : 'portal');

    for (const nodo of resumenPertenencia) {
      nodo.textContent = {
        portal: 'Acción de portal',
        tenant: 'Acción de tenant',
        empresa: 'Acción de empresa',
        sitio: 'Acción de sitio'
      }[nivel] || 'Acción';
    }

    for (const nodo of resumenDestino) {
      nodo.textContent = resolverTextoDestino();
    }

  }

  selectorTenant.addEventListener('change', function () {
    reconstruirEmpresas();
    reconstruirSitios();
    actualizarPertenencia();
    actualizarResumenScope();
  });

  selectorEmpresa.addEventListener('change', function () {
    reconstruirSitios();
    actualizarPertenencia();
    actualizarResumenScope();
  });

  if (selectorPertenencia) {
    selectorPertenencia.addEventListener('change', function () {
      actualizarPertenencia();
      actualizarResumenScope();
    });
  }

  selectorSitio.addEventListener('change', actualizarResumenScope);

  if (selectorTipo) {
    selectorTipo.addEventListener('change', function () {
      const tipo = String(selectorTipo.value || '').trim();

      if (tipo) {
        window.location.href = `/monitores/triggers/nuevo?tipo=${encodeURIComponent(tipo)}`;
      }
    });
  }

  function actualizarOperacionDns() {
    if (!selectorOperacionDns || !bloqueValorDns) {
      return;
    }

    const requiereValor = selectorOperacionDns.value === 'editar_valor';
    bloqueValorDns.hidden = !requiereValor;
    const campoValor = bloqueValorDns.querySelector('input[name="valorPrincipal"]');

    if (campoValor) {
      campoValor.required = requiereValor;
    }

    if (ayudaOperacionDns) {
      const ayudas = {
        editar_valor:
          'Sustituye el valor del registro cuando un monitor active esta acción.',
        activar:
          'Marca el registro como activo cuando un monitor active esta acción.',
        desactivar:
          'Marca el registro como inactivo cuando un monitor active esta acción.',
        seguir_estado_monitor:
          'Sigue el estado del monitor vinculado: apertura de alerta desactiva el registro y cierre de alerta lo activa.'
      };
      ayudaOperacionDns.textContent =
        ayudas[selectorOperacionDns.value] ||
        'Elige el cambio que se aplicará cuando un monitor active esta acción.';
    }
    actualizarCambioValorDns();
    validarValorDns();
  }

  function mensajeValorDns() {
    if (resolverTipoActual() !== 'dns' ||
      selectorOperacionDns?.value !== 'editar_valor' ||
      !seleccionDnsActual || !inputNuevoValorDns?.value) {
      return '';
    }

    const valor = inputNuevoValorDns.value.trim();
    const tipo = String(seleccionDnsActual.tipoRegistro || '').toUpperCase();

    if (!valor) {
      return 'Escribe un valor para el registro; los espacios en blanco no cuentan.';
    }

    if (tipo === 'A') {
      const partes = valor.split('.');
      const valida = partes.length === 4 && partes.every((parte) =>
        /^(?:0|[1-9]\d{0,2})$/.test(parte) && Number(parte) <= 255
      );
      return valida ? '' : 'Un registro A necesita una dirección IPv4, por ejemplo 192.0.2.10.';
    }

    if (tipo === 'AAAA') {
      try {
        if (!valor.includes(':')) throw new Error('no_ipv6');
        new URL(`http://[${valor}]/`);
        return '';
      } catch {
        return 'Un registro AAAA necesita una dirección IPv6, por ejemplo 2001:db8::10.';
      }
    }

    if (['CNAME', 'NS', 'PTR', 'MX', 'SRV'].includes(tipo)) {
      if (tipo === 'MX' && valor === '.') {
        return String(seleccionDnsActual.prioridad) === '0'
          ? ''
          : 'El valor «.» solo se admite en un registro MX con prioridad 0.';
      }
      const nombre = valor.toLowerCase().replace(/\.+$/, '');
      const etiquetas = nombre.split('.');
      const valida = nombre.length <= 253 && etiquetas.every((etiqueta) =>
        /^[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?$/.test(etiqueta)
      );
      return valida ? '' : `Un registro ${tipo} necesita un nombre DNS válido, por ejemplo ${ejemplosValorDns[tipo]}.`;
    }

    return '';
  }

  function validarValorDns() {
    const mensaje = mensajeValorDns();
    if (errorValorDns) {
      errorValorDns.textContent = mensaje;
      errorValorDns.hidden = !mensaje;
    }
    if (inputNuevoValorDns) {
      if (mensaje) inputNuevoValorDns.setAttribute('aria-invalid', 'true');
      else inputNuevoValorDns.removeAttribute('aria-invalid');
    }
    return !mensaje;
  }

  function construirParametrosSelectorDns() {
    const parametros = new URLSearchParams();
    const busqueda = String(inputBusquedaSelectorDns?.value || '').trim();

    if (busqueda) {
      parametros.set('q', busqueda);
    }

    if (selectorTenant?.value) {
      parametros.set('tenant_id', selectorTenant.value);
    }

    if (selectorEmpresa?.value) {
      parametros.set('empresa_id', selectorEmpresa.value);
    }

    if (selectorSitio?.value) {
      parametros.set('sitio_id', selectorSitio.value);
    }

    parametros.set('limit', '30');
    return parametros;
  }

  function actualizarResumenSeleccionDns(detalle = null) {
    if (!resumenSeleccionDns && !detalleSeleccionDns) {
      return;
    }

    const zonaId = String(inputZonaDns?.value || '').trim();
    const registroId = String(inputRegistroDns?.value || '').trim();
    if (detalle) {
      seleccionDnsActual = {
        ...detalle,
        rolAsignado: detalle.gobernanza?.rolAsignado || ''
      };
    }

    if (!zonaId || !registroId) {
      if (resumenSeleccionDns) {
        resumenSeleccionDns.textContent =
          'Selecciona el registro DNS que modificará esta acción.';
      }
      if (detalleSeleccionDns) {
        detalleSeleccionDns.textContent =
          'El selector solo muestra registros disponibles dentro de tu alcance.';
      }
      seleccionDnsActual = null;
      if (publicacionSeleccionDns) publicacionSeleccionDns.hidden = true;
      if (enlaceEditarRegistroDns) enlaceEditarRegistroDns.hidden = true;
      if (inputNuevoValorDns) inputNuevoValorDns.placeholder = 'Valor del registro';
      validarValorDns();
      if (cambioValorDns) cambioValorDns.textContent = '';
      return;
    }

    if (resumenSeleccionDns) {
      const resumenInicial = String(
        resumenSeleccionDns.dataset.triggerDnsResumenInicial || ''
      ).trim();
      resumenSeleccionDns.textContent = detalle
        ? `${detalle.tipoRegistro ? `${detalle.tipoRegistro} ` : ''}${detalle.nombreVisible || `Registro #${registroId}`}`
        : resumenInicial || 'Registro DNS seleccionado';
    }

    if (detalleSeleccionDns) {
      const detalleInicial = String(
        detalleSeleccionDns.dataset.triggerDnsDetalleInicial || ''
      ).trim();
      detalleSeleccionDns.textContent = detalle
        ? [
          detalle.zonaNombre || null,
          detalle.tipoRegistro || null,
          detalle.valorPrincipal || null,
          detalle.alcanceDescripcion || null
        ].filter(Boolean).join(' · ') || `Zona #${zonaId} · Registro #${registroId}`
        : detalleInicial || `Zona #${zonaId} · Registro #${registroId}`;
    }

    if (publicacionSeleccionDns) {
      publicacionSeleccionDns.hidden = !seleccionDnsActual;
      if (seleccionDnsActual) {
        publicacionSeleccionDns.classList.toggle(
          'trigger-dns-seleccion__publicacion--advertencia',
          !seleccionDnsActual.publicarEnBind
        );
        publicacionSeleccionDns.textContent = seleccionDnsActual.publicarEnBind
          ? 'Incluido en publicación DNS; la publicación efectiva depende de la zona y del servicio.'
          : 'Excluido de publicación DNS: puedes guardar la acción, pero sus cambios no aparecerán en el DNS publicado.';
      }
    }
    if (enlaceEditarRegistroDns) {
      enlaceEditarRegistroDns.hidden = !seleccionDnsActual || seleccionDnsActual.publicarEnBind;
      if (!enlaceEditarRegistroDns.hidden) {
        const retorno = `${window.location.pathname}${window.location.search}`;
        enlaceEditarRegistroDns.href = `/dns/${encodeURIComponent(zonaId)}/registros/${encodeURIComponent(registroId)}/editar?return_to=${encodeURIComponent(retorno)}`;
      }
    }
    if (inputNuevoValorDns) {
      inputNuevoValorDns.placeholder = ejemplosValorDns[seleccionDnsActual?.tipoRegistro] || 'Valor del registro';
    }
    actualizarCambioValorDns();
    validarValorDns();
  }

  function actualizarCambioValorDns() {
    if (!cambioValorDns) return;
    if (!seleccionDnsActual || selectorOperacionDns?.value !== 'editar_valor') {
      cambioValorDns.textContent = '';
      return;
    }
    const actual = String(seleccionDnsActual.valorPrincipal || '').trim() || 'valor actual no disponible';
    const nuevo = String(inputNuevoValorDns?.value || '').trim() || 'nuevo valor pendiente';
    cambioValorDns.textContent = `${seleccionDnsActual.tipoRegistro || 'Registro'} ${seleccionDnsActual.nombreVisible}: ${actual} → ${nuevo}`;
  }

  function renderizarResultadosSelectorDns(resultados = []) {
    if (!cuerpoResultadosSelectorDns) {
      return;
    }

    if (!Array.isArray(resultados) || resultados.length === 0) {
      cuerpoResultadosSelectorDns.innerHTML = `
        <tr>
          <td colspan="5" class="text-body-secondary">
            No hay registros gobernados por triggers con esos filtros.
          </td>
        </tr>
      `;
      return;
    }

    cuerpoResultadosSelectorDns.innerHTML = resultados.map((item, indice) => {
      const rol = item.gobernanza?.rolAsignado || '';
      const modo = item.gobernanza?.modoControl || 'valor_y_activo';

      return `
        <tr>
          <td data-label="Registro">
            <strong>${escapeHtml(item.nombreVisible || `#${item.registroId}`)}</strong>
            <div class="text-body-secondary small">
              #${escapeHtml(item.registroId)} · ${escapeHtml(item.tipoRegistro || '-')} · ${escapeHtml(item.valorPrincipal || '-')}
            </div>
          </td>
          <td data-label="Zona">
            <span>${escapeHtml(item.zonaNombre || `#${item.zonaId}`)}</span>
            <div class="text-body-secondary small">${escapeHtml(item.alcanceDescripcion || '-')}</div>
          </td>
          <td data-label="Control">
            <span class="badge text-bg-success">Acción DNS</span>
            <div class="text-body-secondary small">
              ${rol ? `Rol ${escapeHtml(rol)} · ` : ''}${modo === 'valor_y_activo' ? 'Puede cambiar valor y estado' : escapeHtml(modo)}
            </div>
          </td>
          <td data-label="Estado">
            <span class="badge ${item.activo ? 'text-bg-success' : 'text-bg-secondary'}">
              ${item.activo ? 'Activo' : 'Inactivo'}
            </span>
            <div class="text-body-secondary small">
              ${item.publicarEnBind ? 'Incluido en publicación DNS' : 'Excluido de publicación DNS'}
            </div>
          </td>
          <td data-label="Selección" class="text-end">
            <button
              type="button"
              class="btn btn-outline-primary btn-sm"
              data-trigger-dns-selector-elegir
              data-indice="${indice}"
            >
              Elegir
            </button>
          </td>
        </tr>
      `;
    }).join('');

    cuerpoResultadosSelectorDns
      .querySelectorAll('[data-trigger-dns-selector-elegir]')
      .forEach((boton) => {
        boton.addEventListener('click', function () {
          const indice = Number.parseInt(String(boton.dataset.indice || ''), 10);
          const item = resultados[indice];

          if (!item) {
            return;
          }

          seleccionarObjetivoDns(item);
        });
      });
  }

  async function buscarObjetivosDns() {
    if (!estadoSelectorDns || !cuerpoResultadosSelectorDns) {
      return;
    }

    estadoSelectorDns.textContent = 'Buscando registros DNS gobernados...';

    try {
      const parametros = construirParametrosSelectorDns();
      const respuesta = await fetch(
        `/monitores/triggers/api/dns-objetivos?${parametros.toString()}`,
        {
          headers: {
            Accept: 'application/json'
          }
        }
      );
      const datos = await respuesta.json();

      if (!respuesta.ok || datos.ok === false) {
        throw new Error(datos.mensaje || 'No se pudo buscar objetivos DNS.');
      }

      estadoSelectorDns.textContent =
        datos.total === 1
          ? '1 registro disponible.'
          : `${datos.total || 0} registros disponibles.`;
      renderizarResultadosSelectorDns(datos.resultados || []);
    } catch (error) {
      estadoSelectorDns.textContent = error.message;
      renderizarResultadosSelectorDns([]);
    }
  }

  function seleccionarObjetivoDns(item) {
    if (inputZonaDns) {
      inputZonaDns.value = item.zonaId || '';
    }

    if (inputRegistroDns) {
      inputRegistroDns.value = item.registroId || '';
    }

    if (inputRolGobernanzaDns) {
      inputRolGobernanzaDns.value = item.gobernanza?.rolAsignado || '';
      inputRolGobernanzaDns.readOnly = Boolean(item.gobernanza?.rolAsignado);
    }
    if (ayudaRolDns) {
      ayudaRolDns.textContent = item.gobernanza?.rolAsignado
        ? 'Se ha tomado del registro seleccionado. Para usar otro rol, elige otro registro.'
        : 'Este registro no tiene rol asignado.';
    }

    actualizarResumenSeleccionDns(item);
    obtenerModalSelectorDns()?.hide();
  }

  function obtenerModalSelectorDns() {
    if (!modalSelectorDnsNodo || !window.bootstrap?.Modal) {
      return null;
    }

    return window.bootstrap.Modal.getOrCreateInstance(modalSelectorDnsNodo);
  }

  function obtenerModalPlanTrigger() {
    if (!modalPlanTriggerNodo || !window.bootstrap?.Modal) {
      return null;
    }

    return window.bootstrap.Modal.getOrCreateInstance
      ? window.bootstrap.Modal.getOrCreateInstance(modalPlanTriggerNodo)
      : new window.bootstrap.Modal(modalPlanTriggerNodo);
  }

  function textoOpcionSeleccionada(selector, textoVacio = 'Pendiente') {
    const texto = selector?.selectedOptions?.[0]?.textContent?.trim();
    return texto || textoVacio;
  }

  function leerValorCampo(campo, valorVacio = '-') {
    const valor = String(campo?.value || '').trim();
    return valor || valorVacio;
  }

  function resolverTipoActual() {
    const campoTipo = modulo.querySelector('[name="tipo"]');
    return String(campoTipo?.value || '').trim().toLowerCase();
  }

  function resolverEtiquetaOperacionDns(operacion) {
    return {
      editar_valor: 'Editar valor principal',
      activar: 'Activar registro',
      desactivar: 'Desactivar registro',
      seguir_estado_monitor: 'Seguir estado activo del monitor'
    }[operacion] || 'Operación DNS';
  }

  function construirItemsPlanTecnico(tipo) {
    if (tipo === 'correo') {
      const nuevasDirecciones = String(formularioTrigger?.elements.namedItem('audienciaManuales')?.value || '')
        .split(/[\r\n]+/).map((valor) => valor.trim()).filter(Boolean).length;
      const usuariosNuevos = formularioTrigger?.querySelectorAll('input[name="audienciaUsuarios"]:checked').length || 0;
      const retiradas = formularioTrigger?.querySelectorAll('input[name="retirarRelacionesIds"]:checked').length || 0;
      const reincorporadas = formularioTrigger?.querySelectorAll('input[name="reincorporarRelacionesIds"]:checked').length || 0;
      return [
        { etiqueta: 'Asunto', valor: leerValorCampo(formularioTrigger?.elements.namedItem('asuntoPlantilla'), 'Sin asunto'), icono: 'bi-envelope' },
        { etiqueta: 'Destinatarios actuales', valor: `${bloqueAudienciaCorreo?.dataset.relacionesEntregables || '0'} con correo disponible de ${bloqueAudienciaCorreo?.dataset.relacionesTotal || '0'} relaciones`, icono: 'bi-people' },
        { etiqueta: 'Cambios en destinatarios', valor: `${nuevasDirecciones} direcciones nuevas · ${usuariosNuevos} usuarios nuevos · ${retiradas} retiradas · ${reincorporadas} reincorporaciones`, icono: 'bi-person-check' },
        { etiqueta: 'Monitores vinculados', valor: bloqueAudienciaCorreo?.dataset.vinculosTotal || '0', icono: 'bi-diagram-3' },
        { etiqueta: 'Introducción', valor: leerValorCampo(formularioTrigger?.elements.namedItem('textoIntroduccion'), 'Sin texto adicional'), icono: 'bi-text-paragraph' },
        { etiqueta: 'Cierre', valor: leerValorCampo(formularioTrigger?.elements.namedItem('textoCierre'), 'Sin texto adicional'), icono: 'bi-text-paragraph' }
      ];
    }
    if (tipo === 'dns') {
      const operacion = String(selectorOperacionDns?.value || '').trim();
      const items = [
        {
          etiqueta: 'Objetivo DNS',
          valor: seleccionDnsActual
            ? `${seleccionDnsActual.tipoRegistro || 'Registro'} ${seleccionDnsActual.nombreVisible}`
            : `Zona #${leerValorCampo(inputZonaDns, '?')} · Registro #${leerValorCampo(inputRegistroDns, '?')}`,
          icono: 'bi-globe2'
        },
        {
          etiqueta: 'Operación',
          valor: resolverEtiquetaOperacionDns(operacion),
          icono: 'bi-sliders'
        },
        {
          etiqueta: 'Rol del registro',
          valor: leerValorCampo(inputRolGobernanzaDns, 'Sin rol asignado'),
          icono: 'bi-tag'
        },
        {
          etiqueta: 'Publicación DNS',
          valor: seleccionDnsActual
            ? seleccionDnsActual.publicarEnBind ? 'Incluido en publicación' : 'Excluido de publicación'
            : 'Estado pendiente de comprobar',
          icono: 'bi-broadcast'
        }
      ];

      if (operacion === 'editar_valor') {
        items.push({
          etiqueta: 'Cambio de valor',
          valor: seleccionDnsActual
            ? `${seleccionDnsActual.valorPrincipal || 'Valor actual no disponible'} → ${leerValorCampo(inputValorPrincipalDns, 'Pendiente')}`
            : leerValorCampo(inputValorPrincipalDns, 'Pendiente'),
          icono: 'bi-pencil-square'
        });
      }

      if (operacion === 'seguir_estado_monitor') {
        items.push({
          etiqueta: 'Regla de seguimiento',
          valor: 'Apertura de alerta desactiva el registro; cierre de alerta lo activa.',
          icono: 'bi-arrow-left-right'
        });
      }

      return items;
    }

    return [
      {
        etiqueta: 'Destino',
        valor: leerValorCampo(inputUrlApi, 'URL pendiente'),
        icono: 'bi-link-45deg'
      },
      {
        etiqueta: 'Método',
        valor: textoOpcionSeleccionada(selectorMetodoApi, 'Método pendiente'),
        icono: 'bi-send-check'
      },
      {
        etiqueta: 'Espera y reintentos',
        valor:
          `${Number(leerValorCampo(inputTimeoutApi, '0')) / 1000} s · ${leerValorCampo(inputReintentosApi, '0')} reintentos`,
        icono: 'bi-stopwatch'
      },
      {
        etiqueta: 'Dato adicional',
        valor: leerValorCampo(inputParametroApi, 'Sin parámetro'),
        icono: 'bi-braces'
      },
      {
        etiqueta: 'TLS',
        valor: inputTlsInseguroApi?.checked
          ? 'Permite TLS inseguro'
          : 'TLS estricto',
        icono: inputTlsInseguroApi?.checked ? 'bi-unlock' : 'bi-shield-lock'
      },
      {
        etiqueta: 'Cabeceras',
        valor: inputCabecerasApi?.value.trim() ? 'Configuradas; valores ocultos' : 'Sin cabeceras adicionales',
        icono: 'bi-list-check'
      },
      {
        etiqueta: 'Cuerpo',
        valor: selectorMetodoApi?.value === 'GET'
          ? 'GET no enviará cuerpo'
          : inputCuerpoApi?.value.trim() ? 'Plantilla configurada' : 'Sin cuerpo',
        icono: 'bi-file-earmark-code'
      }
    ];
  }

  function construirAvisosPlan(tipo) {
    if (tipo === 'correo') {
      const avisos = [
        'Guardar esta acción no enviará ningún correo. Los envíos dependen de los monitores vinculados y sus próximos cambios de estado.',
        'Los monitores ya vinculados usarán el nuevo mensaje y la nueva audiencia en sus próximos envíos.'
      ];
      if (selectorActivo?.value === '0') avisos.push('Mientras la acción esté inactiva, no enviará correos.');
      return avisos;
    }
    const avisos = [
      tipo === 'dns'
        ? 'Guardar no modifica ahora el registro DNS. La acción dependerá de monitores vinculados y activos.'
        : 'Guardar esta acción no envía ninguna solicitud. Solo podrá ejecutarse desde monitores vinculados y activos.',
      'Los monitores ya vinculados seguirán usando esta acción hasta que cambies o elimines sus vínculos.'
    ];

    if (selectorActivo?.value === '0') {
      avisos.push('La acción quedará inactiva y no se ejecutará aunque tenga monitores vinculados.');
    }

    if (tipo === 'dns') {
      avisos.push('DNS queda acotado a valor principal y activo; no modifica TTL, tipo, zona ni alcance del registro.');
      avisos.push(seleccionDnsActual?.publicarEnBind === false
        ? 'El registro está excluido de publicación DNS: puedes guardar la acción, pero sus cambios no aparecerán en el DNS publicado.'
        : 'La publicación DNS puede quedar pendiente hasta que el servicio aplique el cambio.');
    } else if (tipo === 'api' && inputTlsInseguroApi?.checked) {
      avisos.push('TLS inseguro debe reservarse para entornos controlados; revisa que el destino sea confiable.');
    }

    return avisos;
  }

  function construirPlanOperativoHtml() {
    const tipo = resolverTipoActual();
    const modo = formularioTrigger?.dataset.triggerFormModo === 'editar'
      ? 'Actualización'
      : 'Creación';
    const itemsTecnicos = construirItemsPlanTecnico(tipo);
    const avisos = construirAvisosPlan(tipo);
    const itemsResumen = [
      {
        etiqueta: 'Acción',
        valor: `${modo} de acción ${tipo.toUpperCase() || 'operativa'}`,
        icono: 'bi-lightning-charge'
      },
      {
        etiqueta: 'Nombre',
        valor: leerValorCampo(inputNombre, 'Sin nombre'),
        icono: 'bi-card-text'
      },
      {
        etiqueta: 'Estado',
        valor: selectorActivo?.value === '1' ? 'Activo' : 'Inactivo',
        icono: selectorActivo?.value === '1' ? 'bi-check-circle' : 'bi-pause-circle'
      },
      {
        etiqueta: 'Ámbito de gestión',
        valor:
          `${textoOpcionSeleccionada(selectorPertenencia, 'Portal')} · ${resolverTextoDestino()}`,
        icono: 'bi-diagram-3'
      }
    ];

    return `
      <div class="modal-plan-trigger__grid">
        <section class="modal-plan-trigger__bloque">
          <h3>Resumen administrativo</h3>
          <div class="modal-plan-trigger__items">
            ${itemsResumen.map((item) => `
              <article class="modal-plan-trigger__item">
                <span class="organizacion-entidad__icono" aria-hidden="true">
                  <i class="bi ${item.icono}"></i>
                </span>
                <div>
                  <span>${escapeHtml(item.etiqueta)}</span>
                  <strong>${escapeHtml(item.valor)}</strong>
                </div>
              </article>
            `).join('')}
          </div>
        </section>
        <section class="modal-plan-trigger__bloque">
          <h3>${tipo === 'correo' ? 'Mensaje y audiencia' : tipo === 'api' ? 'Solicitud API prevista' : 'Acción técnica prevista'}</h3>
          <div class="modal-plan-trigger__items">
            ${itemsTecnicos.map((item) => `
              <article class="modal-plan-trigger__item">
                <span class="organizacion-entidad__icono" aria-hidden="true">
                  <i class="bi ${item.icono}"></i>
                </span>
                <div>
                  <span>${escapeHtml(item.etiqueta)}</span>
                  <strong>${escapeHtml(item.valor)}</strong>
                </div>
              </article>
            `).join('')}
          </div>
        </section>
      </div>
      <section class="modal-plan-trigger__avisos">
        <h3>Antes de confirmar</h3>
        ${avisos.map((aviso) => `
          <p>
            <i class="bi bi-info-circle" aria-hidden="true"></i>
            <span>${escapeHtml(aviso)}</span>
          </p>
        `).join('')}
      </section>
    `;
  }

  function validarObjetivoDnsSeleccionado() {
    if (resolverTipoActual() !== 'dns') {
      return true;
    }

    const zonaId = String(inputZonaDns?.value || '').trim();
    const registroId = String(inputRegistroDns?.value || '').trim();

    if (zonaId && registroId) {
      return true;
    }

    window.portalToast?.show({
      tipo: 'advertencia',
      titulo: 'Falta seleccionar registro DNS',
      cuerpo: 'Usa "Buscar registro DNS" y elige un registro gobernado por triggers antes de guardar.'
    });
    botonAbrirSelectorDns?.focus();
    return false;
  }

  function abrirPlanOperativo() {
    const modalPlan = obtenerModalPlanTrigger();

    if (!modalPlan || !cuerpoPlanTrigger) {
      envioConfirmadoPorPlan = true;
      formularioTrigger?.requestSubmit();
      return;
    }

    cuerpoPlanTrigger.innerHTML = construirPlanOperativoHtml();
    modalPlan.show();
  }

  if (botonAbrirSelectorDns && modalSelectorDnsNodo) {
    botonAbrirSelectorDns.addEventListener('click', function () {
      const modalSelectorDns = obtenerModalSelectorDns();

      if (!modalSelectorDns) {
        window.portalToast?.show({
          tipo: 'advertencia',
          titulo: 'Selector DNS no disponible',
          cuerpo: 'La interfaz modal todavía no está lista. Recarga la página si persiste.'
        });
        return;
      }

      modalSelectorDns.show();
      void buscarObjetivosDns();
      setTimeout(() => inputBusquedaSelectorDns?.focus(), 150);
    });
  }

  if (botonBuscarSelectorDns) {
    botonBuscarSelectorDns.addEventListener('click', function () {
      void buscarObjetivosDns();
    });
  }

  if (inputBusquedaSelectorDns) {
    inputBusquedaSelectorDns.addEventListener('keydown', function (evento) {
      if (evento.key === 'Enter') {
        evento.preventDefault();
        void buscarObjetivosDns();
      }
    });
  }

  if (selectorOperacionDns) {
    selectorOperacionDns.addEventListener('change', actualizarOperacionDns);
  }
  inputNuevoValorDns?.addEventListener('input', function () {
    actualizarCambioValorDns();
    if (errorValorDns && !errorValorDns.hidden) validarValorDns();
  });
  inputNuevoValorDns?.addEventListener('blur', validarValorDns);

  if (formularioTrigger) {
    formularioTrigger.addEventListener('submit', function (evento) {
      if (evento.submitter?.formAction?.includes('/correo/probar')) {
        return;
      }
      if (envioConfirmadoPorPlan) {
        return;
      }

      if (!formularioTrigger.checkValidity()) {
        return;
      }

      if (!validarObjetivoDnsSeleccionado()) {
        evento.preventDefault();
        return;
      }

      if (!validarValorDns()) {
        evento.preventDefault();
        inputNuevoValorDns?.focus();
        return;
      }

      evento.preventDefault();
      abrirPlanOperativo();
    });
  }

  botonBuscarUsuarioCorreo?.addEventListener('click', function () {
    void buscarUsuariosCorreo();
  });
  inputBuscarUsuarioCorreo?.addEventListener('keydown', function (evento) {
    if (evento.key === 'Enter') {
      evento.preventDefault();
      void buscarUsuariosCorreo();
    }
  });

  if (botonConfirmarPlanTrigger) {
    botonConfirmarPlanTrigger.addEventListener('click', function () {
      envioConfirmadoPorPlan = true;
      obtenerModalPlanTrigger()?.hide();
      formularioTrigger?.requestSubmit();
    });
  }

  reconstruirEmpresas();
  reconstruirSitios();
  actualizarPertenencia();
  actualizarResumenScope();
  actualizarOperacionDns();
  actualizarResumenSeleccionDns();
})();
