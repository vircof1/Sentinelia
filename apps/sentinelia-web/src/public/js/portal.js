(function () {
  const CLAVE_TEMA = 'sentinelia.tema';
  const MODOS_TEMA = new Set(['auto', 'light', 'dark']);
  const mediaTemaOscuro = window.matchMedia('(prefers-color-scheme: dark)');
  const tokenCSRF = obtenerTokenCSRFPortal();
  const botonMenu = document.querySelector('[data-boton-menu]');
  const panelNavegacion = document.querySelector('[data-panel-navegacion]');
  const menusDesplegables = Array.from(
    document.querySelectorAll('[data-menu-desplegable]')
  );
  const modalImpersonacion = document.querySelector('[data-impersonacion-modal]');
  const contenedorToasts = document.createElement('div');
  const TIPOS_TOAST = {
    satisfactorio: {
      clase: 'satisfactorio',
      claseBootstrap: 'border-success-subtle bg-success-subtle',
      simbolo: '✓',
      titulo: 'Satisfactorio'
    },
    informativo: {
      clase: 'informativo',
      claseBootstrap: 'border-info-subtle bg-info-subtle',
      simbolo: 'i',
      titulo: 'Información'
    },
    advertencia: {
      clase: 'advertencia',
      claseBootstrap: 'border-warning-subtle bg-warning-subtle',
      simbolo: '!',
      titulo: 'Advertencia'
    },
    peligro: {
      clase: 'peligro',
      claseBootstrap: 'border-danger-subtle bg-danger-subtle',
      simbolo: '!',
      titulo: 'Peligro'
    },
    error: {
      clase: 'error',
      claseBootstrap: 'border-danger-subtle bg-danger-subtle',
      simbolo: '×',
      titulo: 'Error'
    }
  };

  contenedorToasts.className = 'toast-stack';
  document.body.appendChild(contenedorToasts);

  inicializarSelectorTema();
  inicializarDropdownsAccionesEnTablas();
  inicializarMarcaCabeceraAdaptativa();

  function inicializarMarcaCabeceraAdaptativa() {
    const cabecera = document.querySelector('.cabecera-principal');
    const marca = cabecera?.querySelector('.marca');
    const textosMarca = marca?.querySelector('.marca-textos');
    const acciones = cabecera?.querySelector('.acciones-cabecera');
    const botonMenuCabecera = cabecera?.querySelector('.boton-menu');

    if (!cabecera || !marca || !textosMarca || !acciones || !botonMenuCabecera) {
      return;
    }

    let programada = false;
    const actualizar = function () {
      programada = false;
      textosMarca.classList.remove('marca-textos--contraida');

      const referenciaSuperior = Math.min(
        marca.getBoundingClientRect().top,
        botonMenuCabecera.getBoundingClientRect().top
      );
      const controlesSeHanReplegado =
        acciones.getBoundingClientRect().top > referenciaSuperior + 6;

      if (!controlesSeHanReplegado) {
        return;
      }

      textosMarca.classList.add('marca-textos--contraida');
      const controlesRecuperanLinea =
        acciones.getBoundingClientRect().top <= referenciaSuperior + 6;

      textosMarca.classList.toggle(
        'marca-textos--contraida',
        controlesRecuperanLinea
      );
    };
    const programarActualizacion = function () {
      if (programada) return;
      programada = true;
      window.requestAnimationFrame(actualizar);
    };

    if (typeof window.ResizeObserver === 'function') {
      new window.ResizeObserver(programarActualizacion).observe(cabecera);
    }
    window.addEventListener('resize', programarActualizacion);
    programarActualizacion();
  }

  function inicializarDropdownsAccionesEnTablas() {
    if (!window.bootstrap?.Dropdown) {
      return;
    }

    const dropdownsFlotantes = new Map();
    const requiereMenuFlotante = (boton) => {
      const tablaResponsive = boton?.closest('.table-responsive');
      return Boolean(
        tablaResponsive &&
        window.getComputedStyle(tablaResponsive).overflowX !== 'visible'
      );
    };

    document.addEventListener(
      'click',
      function (evento) {
        const objetivo = evento.target instanceof Element ? evento.target : null;
        const boton = objetivo?.closest(
          '.organizacion-acciones-toggle, ' +
          '.table-responsive [data-bs-toggle="dropdown"]'
        );

        if (!boton || window.bootstrap.Dropdown.getInstance(boton)) {
          return;
        }

        window.bootstrap.Dropdown.getOrCreateInstance(boton, {
          boundary: 'viewport',
          popperConfig: function (configuracionPredeterminada) {
            return {
              ...configuracionPredeterminada,
              strategy: 'fixed'
            };
          }
        });
      },
      true
    );

    document.addEventListener('shown.bs.dropdown', function (evento) {
      const boton = evento.target instanceof Element ? evento.target : null;
      const tablaResponsive = boton?.closest('.table-responsive');
      const contenedor = boton?.parentElement;
      const menu = contenedor
        ? Array.from(contenedor.children).find((nodo) => nodo.classList.contains('dropdown-menu'))
        : null;

      if (
        !requiereMenuFlotante(boton) ||
        !boton ||
        !tablaResponsive ||
        !menu ||
        dropdownsFlotantes.has(boton)
      ) {
        return;
      }

      const marcador = document.createComment('dropdown-tabla-responsive');
      contenedor.insertBefore(marcador, menu);
      document.body.appendChild(menu);
      menu.classList.add('dropdown-menu--flotante-tabla');
      dropdownsFlotantes.set(boton, { menu, marcador });

      window.requestAnimationFrame(function () {
        window.bootstrap.Dropdown.getInstance(boton)?.update();
      });
    });

    document.addEventListener('hidden.bs.dropdown', function (evento) {
      const boton = evento.target instanceof Element ? evento.target : null;
      const estado = boton ? dropdownsFlotantes.get(boton) : null;

      if (!estado) {
        return;
      }

      if (estado.marcador.parentNode) {
        estado.marcador.parentNode.insertBefore(estado.menu, estado.marcador);
      }
      estado.marcador.remove();
      estado.menu.classList.remove('dropdown-menu--flotante-tabla');
      dropdownsFlotantes.delete(boton);
    });

    const reposicionarDropdowns = function () {
      for (const [boton, estado] of dropdownsFlotantes) {
        if (!requiereMenuFlotante(boton)) {
          window.bootstrap.Dropdown.getInstance(boton)?.hide();
          continue;
        }
        window.bootstrap.Dropdown.getInstance(boton)?.update();
      }
    };

    window.addEventListener('resize', reposicionarDropdowns);
    document.addEventListener('scroll', reposicionarDropdowns, true);
  }

  function inicializarSelectorTema() {
    const selectores = Array.from(document.querySelectorAll('[data-selector-tema]'));
    const modoInicial = obtenerModoTemaGuardado();

    aplicarModoTema(modoInicial, { persistir: false, notificar: false });

    for (const selector of selectores) {
      selector.checked = selector.value === modoInicial;
      selector.addEventListener('change', function () {
        if (!selector.checked) {
          return;
        }

        const modo = normalizarModoTema(selector.value);
        aplicarModoTema(modo, { persistir: true, notificar: true });

        for (const otroSelector of selectores) {
          otroSelector.checked = otroSelector.value === modo;
        }
      });
    }

    const manejarCambioSistema = function () {
      if (obtenerModoTemaGuardado() === 'auto') {
        aplicarModoTema('auto', { persistir: false, notificar: true });
      }
    };

    if (typeof mediaTemaOscuro.addEventListener === 'function') {
      mediaTemaOscuro.addEventListener('change', manejarCambioSistema);
    } else if (typeof mediaTemaOscuro.addListener === 'function') {
      mediaTemaOscuro.addListener(manejarCambioSistema);
    }
  }

  function aplicarModoTema(modoSolicitado, { persistir, notificar }) {
    const modo = normalizarModoTema(modoSolicitado);
    const tema = modo === 'auto'
      ? (mediaTemaOscuro.matches ? 'dark' : 'light')
      : modo;
    const temaAnterior = document.documentElement.dataset.theme;

    document.documentElement.dataset.themeMode = modo;
    document.documentElement.dataset.theme = tema;
    document.documentElement.dataset.bsTheme = tema;
    document.documentElement.style.colorScheme = tema;
    actualizarPresentacionTema(tema);

    if (persistir) {
      try {
        window.localStorage.setItem(CLAVE_TEMA, modo);
      } catch (_error) {
        // El tema sigue activo durante la sesión aunque el navegador bloquee el almacenamiento.
      }
    }

    if (notificar && temaAnterior !== tema) {
      window.dispatchEvent(new CustomEvent('portal:themechange', {
        detail: { modo, tema }
      }));
    }
  }

  function actualizarPresentacionTema(tema) {
    const metaTema = document.querySelector('[data-theme-color]');
    const favicon = document.querySelector('[data-theme-favicon]');

    if (metaTema) {
      metaTema.setAttribute('content', tema === 'dark' ? '#11161d' : '#edf1f5');
    }

    if (favicon) {
      favicon.setAttribute(
        'href',
        tema === 'dark'
          ? '/IMG/Sentinelia-DarkBackground.svg'
          : '/IMG/Sentinelia.svg'
      );
    }
  }

  function obtenerModoTemaGuardado() {
    try {
      return normalizarModoTema(window.localStorage.getItem(CLAVE_TEMA));
    } catch (_error) {
      return normalizarModoTema(document.documentElement.dataset.themeMode);
    }
  }

  function normalizarModoTema(modo) {
    return MODOS_TEMA.has(modo) ? modo : 'auto';
  }

  function mostrarToast(payload = {}) {
    const tipoNormalizado = resolverTipoToast(payload.tipo);
    const definicionTipo = TIPOS_TOAST[tipoNormalizado];
    const titulo =
      String(payload.titulo || '').trim() || definicionTipo.titulo;
    const cuerpo = resolverCuerpoToast(payload);
    const duracionMs = Number(payload.duracionMs || 4200);

    if (!titulo && !cuerpo) {
      return;
    }

    const toast = document.createElement('div');
    toast.className = [
      'toast',
      'portal-toast',
      'show',
      'border',
      'shadow-sm',
      definicionTipo.claseBootstrap,
      `toast--${definicionTipo.clase}`
    ].join(' ');
    toast.setAttribute('role', 'alert');
    toast.setAttribute('aria-live', 'assertive');
    toast.setAttribute('aria-atomic', 'true');
    toast.style.setProperty('--toast-duration', `${Math.max(duracionMs, 0)}ms`);
    toast.innerHTML = `
      <div class="toast-header portal-toast__cabecera">
        <span class="portal-toast__estado" aria-hidden="true">${escapeHtml(definicionTipo.simbolo)}</span>
        <div class="portal-toast__encabezado">
          <strong class="me-auto portal-toast__titulo">${escapeHtml(titulo)}</strong>
          <small class="portal-toast__meta">Ahora</small>
        </div>
        <button type="button" class="btn-close ms-2 mb-1" aria-label="Cerrar aviso"></button>
      </div>
      <div class="toast-body portal-toast__cuerpo">
        ${cuerpo ? `<div class="portal-toast__contenido">${escapeHtml(cuerpo)}</div>` : ''}
      </div>
      ${duracionMs > 0 ? '<div class="portal-toast__progreso" aria-hidden="true"></div>' : ''}
    `;

    const destruir = function () {
      toast.classList.add('toast--cerrando');
      window.setTimeout(function () {
        toast.remove();
      }, 180);
    };

    toast.querySelector('.btn-close').addEventListener('click', destruir);
    contenedorToasts.appendChild(toast);

    if (duracionMs > 0) {
      window.setTimeout(destruir, duracionMs);
    }
  }

  function guardarToastPendiente(payload) {
    window.sessionStorage.setItem(
      'portal.toast.pendiente',
      JSON.stringify(payload)
    );
  }

  function consumirToastPendiente() {
    const bruto = window.sessionStorage.getItem('portal.toast.pendiente');

    if (!bruto) {
      return;
    }

    window.sessionStorage.removeItem('portal.toast.pendiente');

    try {
      mostrarToast(JSON.parse(bruto));
    } catch (_error) {
      // Ignorar payloads rotos de sesiones previas.
    }
  }

  function hidratarFechasLocales() {
    const fechas = Array.from(document.querySelectorAll('[data-fecha-utc]'));

    for (const nodo of fechas) {
      const valorUtc = String(nodo.dataset.fechaUtc || '').trim();

      if (!valorUtc) {
        continue;
      }

      const fecha = new Date(valorUtc);

      if (Number.isNaN(fecha.getTime())) {
        continue;
      }

      nodo.dateTime = fecha.toISOString();
      nodo.textContent = formatearFechaLocal(fecha);
      nodo.title = `${fecha.toISOString()} UTC`;
    }
  }

  function inicializarTooltips() {
    if (!window.bootstrap?.Tooltip) {
      return;
    }

    const nodos = Array.from(
      document.querySelectorAll('[data-bs-toggle="tooltip"]')
    );

    for (const nodo of nodos) {
      if (window.bootstrap.Tooltip.getInstance(nodo)) {
        continue;
      }

      new window.bootstrap.Tooltip(nodo);
    }
  }

  function inicializarCambioPasswordObligatorio() {
    const formulario = document.querySelector('[data-cambio-password]');

    if (!(formulario instanceof HTMLFormElement)) {
      return;
    }

    const inputNueva = formulario.querySelector('[data-cambio-password-nueva]');
    const inputConfirmacion = formulario.querySelector(
      '[data-cambio-password-confirmacion]'
    );
    const botonSubmit = formulario.querySelector('[data-cambio-password-submit]');
    const reglaLongitud = formulario.querySelector(
      '[data-cambio-password-regla="longitud"]'
    );
    const reglaCoincidencia = formulario.querySelector(
      '[data-cambio-password-regla="coincidencia"]'
    );

    if (!inputNueva || !inputConfirmacion || !botonSubmit) {
      return;
    }

    const actualizarEstado = function () {
      const nueva = String(inputNueva.value || '');
      const confirmacion = String(inputConfirmacion.value || '');
      const cumpleLongitud = Array.from(nueva).length >= 8;
      const coincide =
        Boolean(confirmacion) && Boolean(nueva) && nueva === confirmacion;
      const formularioListo = cumpleLongitud && coincide;

      botonSubmit.disabled = !formularioListo;

      actualizarRegla(reglaLongitud, cumpleLongitud);
      actualizarRegla(reglaCoincidencia, coincide);
    };

    const alternarVisibilidad = function (boton) {
      const idCampo = boton.dataset.passwordToggle;
      const campo = idCampo ? document.getElementById(idCampo) : null;

      if (!(campo instanceof HTMLInputElement)) {
        return;
      }

      const mostrar = campo.type === 'password';
      campo.type = mostrar ? 'text' : 'password';
      boton.setAttribute(
        'aria-label',
        `${mostrar ? 'Ocultar' : 'Mostrar'} ${campo.labels?.[0]?.textContent || 'contraseña'}`
      );

      const icono = boton.querySelector('i');
      if (icono) {
        icono.className = mostrar ? 'bi bi-eye-slash' : 'bi bi-eye';
      }
    };

    inputNueva.addEventListener('input', actualizarEstado);
    inputConfirmacion.addEventListener('input', actualizarEstado);
    inputNueva.addEventListener('change', actualizarEstado);
    inputConfirmacion.addEventListener('change', actualizarEstado);

    for (const boton of formulario.querySelectorAll('[data-password-toggle]')) {
      boton.addEventListener('click', function () {
        alternarVisibilidad(boton);
      });
    }

    actualizarEstado();
  }

  function actualizarRegla(nodo, cumple) {
    if (!nodo) {
      return;
    }

    nodo.classList.toggle('cambio-password__regla--ok', cumple);
    const simbolo = nodo.querySelector('span');

    if (simbolo) {
      simbolo.textContent = cumple ? '✓' : '•';
    }
  }

  if (botonMenu && panelNavegacion) {
    const textoBotonMenu = botonMenu.querySelector('[data-boton-menu-texto]');
    const cerrarMenuPrincipal = function () {
      botonMenu.setAttribute('aria-expanded', 'false');
      panelNavegacion.classList.remove('abierto');

      if (textoBotonMenu) {
        textoBotonMenu.textContent = 'Abrir navegación';
      }
    };

    botonMenu.addEventListener('click', function () {
      const estaAbierto = botonMenu.getAttribute('aria-expanded') === 'true';

      if (estaAbierto) {
        cerrarMenuPrincipal();
        return;
      }

      botonMenu.setAttribute('aria-expanded', 'true');
      panelNavegacion.classList.add('abierto');

      if (textoBotonMenu) {
        textoBotonMenu.textContent = 'Cerrar navegación';
      }
    });

    panelNavegacion.addEventListener('click', function (evento) {
      const objetivo = evento.target instanceof Element ? evento.target : null;
      const enlace = objetivo?.closest('a[href]');

      if (enlace) {
        cerrarMenuPrincipal();
      }
    });

    document.addEventListener('click', function (evento) {
      if (
        panelNavegacion.classList.contains('abierto') &&
        !panelNavegacion.contains(evento.target) &&
        !botonMenu.contains(evento.target)
      ) {
        cerrarMenuPrincipal();
      }

      for (const menu of menusDesplegables) {
        if (!menu.open) {
          continue;
        }

        if (!menu.contains(evento.target)) {
          menu.open = false;
        }
      }
    });

    document.addEventListener('keydown', function (evento) {
      if (
        evento.key === 'Escape' &&
        panelNavegacion.classList.contains('abierto')
      ) {
        cerrarMenuPrincipal();
        botonMenu.focus();
      }
    });
  }

  if (modalImpersonacion) {
    crearGestorImpersonacion({
      modal: modalImpersonacion,
      mostrarToast
    });
  }

  configurarProteccionCsrf(tokenCSRF);

  window.portalToast = {
    show: mostrarToast,
    persist: guardarToastPendiente
  };

  window.portalFechas = {
    hidratar: hidratarFechasLocales,
    formatear: formatearFechaLocal
  };

  window.portalDuraciones = {
    hidratar: hidratarDuracionesHumanas,
    formatearSegundos: formatearDuracionSegundos
  };

  inicializarCanalInvalidacionesPortal();
  inicializarAvisosPlataforma();
  inicializarBuzonPersonal();

  consumirToastPendiente();
  hidratarFechasLocales();
  hidratarDuracionesHumanas();
  inicializarTooltips();
  inicializarCambioPasswordObligatorio();
})();

function inicializarAvisosPlataforma() {
  const raiz = document.querySelector('[data-avisos-plataforma]');
  if (!raiz) return;
  const boton = raiz.querySelector('[data-avisos-plataforma-abrir]');
  const cerrar = raiz.querySelector('[data-avisos-plataforma-cerrar]');
  const overlay = raiz.querySelector('[data-avisos-plataforma-overlay]');
  const contador = raiz.querySelector('[data-avisos-plataforma-contador]');
  const resumen = raiz.querySelector('[data-avisos-plataforma-resumen]');
  const lista = raiz.querySelector('[data-avisos-plataforma-lista]');
  const urlResumen = String(raiz.dataset.urlResumen || '');

  const refrescar = async function () {
    try {
      const respuesta = await fetch(urlResumen, {
        headers: { Accept: 'application/json', 'X-Silenciar-Toast-Error': '1' }
      });
      if (!respuesta.ok) throw new Error('No se pudieron consultar los avisos.');
      const payload = await respuesta.json();
      renderizar(payload.resumen || {});
    } catch (_error) {
      resumen.textContent = 'No se pudo actualizar';
    }
  };

  const renderizar = function (estado) {
    const avisos = Array.isArray(estado.avisos) ? estado.avisos : [];
    const totalActivos = Number(estado.totalActivosVisibles ?? avisos.length);
    const pendientes = Number(estado.noReconocidos || 0);
    const puedeGestionar = estado.puedeGestionarOverlays === true;
    contador.textContent = String(pendientes);
    contador.hidden = pendientes === 0;
    boton.dataset.gravedad = estado.gravedadMaxima || '';
    boton.setAttribute('aria-label', pendientes > 0
      ? `${pendientes} avisos de plataforma sin reconocer`
      : `${totalActivos} avisos de plataforma activos`);
    resumen.textContent = `${totalActivos} activos · ${pendientes} sin reconocer`;
    lista.replaceChildren();
    if (avisos.length === 0) {
      const vacio = document.createElement('p');
      vacio.className = 'avisos-plataforma-overlay__vacio';
      vacio.textContent = 'No hay avisos activos dentro de tu alcance.';
      lista.appendChild(vacio);
      return;
    }
    for (const aviso of avisos) {
      lista.appendChild(crearTarjeta(aviso, { puedeGestionar }));
    }
  };

  const crearTarjeta = function (aviso, { puedeGestionar }) {
    const articulo = document.createElement('article');
    articulo.className = `aviso-plataforma aviso-plataforma--${aviso.gravedad}`;
    const cabecera = document.createElement('div');
    cabecera.className = 'aviso-plataforma__cabecera';
    const titulo = document.createElement('strong');
    titulo.textContent = legible(aviso.causaCodigo);
    const gravedad = document.createElement('span');
    gravedad.textContent = aviso.gravedad;
    cabecera.append(titulo, gravedad);
    const meta = document.createElement('small');
    meta.textContent = `${legible(aviso.tipoCodigo)} · ${describirScope(aviso.scope)}`;
    const descripcion = document.createElement('p');
    descripcion.className = 'aviso-plataforma__descripcion';
    descripcion.textContent = describirAviso(aviso);
    const contexto = crearContextoAviso(aviso);
    const detalle = crearDetalleTecnicoAviso(aviso);
    const acciones = document.createElement('div');
    acciones.className = 'aviso-plataforma__acciones';
    if (!puedeGestionar) {
      const soloLectura = document.createElement('span');
      soloLectura.textContent = 'Solo lectura en modo de verificación';
      acciones.appendChild(soloLectura);
    } else if (aviso.estadoPersonal === 'sin_reconocer') {
      acciones.appendChild(crearAccion('Reconocer', 'reconocer', aviso.avisoId));
      acciones.appendChild(crearAccion('Ocultar', 'ocultar', aviso.avisoId));
    } else {
      const reconocido = document.createElement('span');
      reconocido.textContent = 'Reconocido personalmente';
      acciones.appendChild(reconocido);
      acciones.appendChild(crearAccion('Ocultar', 'ocultar', aviso.avisoId));
    }
    articulo.append(cabecera, meta, descripcion);
    if (contexto) articulo.appendChild(contexto);
    if (detalle) articulo.appendChild(detalle);
    articulo.appendChild(acciones);
    return articulo;
  };

  const crearAccion = function (texto, accion, avisoId) {
    const control = document.createElement('button');
    control.type = 'button';
    control.className = 'btn btn-sm btn-outline-secondary';
    control.textContent = texto;
    control.addEventListener('click', async function () {
      control.disabled = true;
      try {
        const respuesta = await fetch(`/avisos-plataforma/api/${encodeURIComponent(avisoId)}/${accion}`, {
          method: 'POST', headers: { Accept: 'application/json' }
        });
        if (!respuesta.ok) throw new Error('No se pudo actualizar el aviso.');
        await refrescar();
      } catch (error) {
        window.portalToast?.show?.({ tipo: 'error', titulo: 'Aviso no actualizado', cuerpo: error.message });
      } finally { control.disabled = false; }
    });
    return control;
  };

  boton.addEventListener('click', function () {
    const abrir = overlay.hidden;
    overlay.hidden = !abrir;
    boton.setAttribute('aria-expanded', String(abrir));
    if (abrir) void refrescar();
  });
  cerrar.addEventListener('click', function () {
    overlay.hidden = true;
    boton.setAttribute('aria-expanded', 'false');
    boton.focus();
  });
  document.addEventListener('keydown', function (evento) {
    if (evento.key === 'Escape' && !overlay.hidden) cerrar.click();
  });
  window.addEventListener('portal:avisos-plataforma-actualizados', function () {
    void refrescar();
  });
  void refrescar();
}

function inicializarCanalInvalidacionesPortal() {
  if (document.querySelector('[data-dashboard-shell]')) return;
  const raiz = document.querySelector('[data-url-ws]');
  const ruta = String(raiz?.dataset.urlWs || '');
  if (!ruta || typeof window.WebSocket !== 'function') return;
  let socket = null;
  let temporizador = null;
  const conectar = function () {
    const protocolo = location.protocol === 'https:' ? 'wss:' : 'ws:';
    try { socket = new WebSocket(`${protocolo}//${location.host}${ruta}`); } catch { reintentar(); return; }
    socket.addEventListener('message', function (evento) {
      try {
        const tipo = JSON.parse(evento.data)?.tipo;
        if (tipo === 'avisos_plataforma_actualizados') {
          window.dispatchEvent(new CustomEvent('portal:avisos-plataforma-actualizados'));
        }
        if (tipo === 'buzon_usuario_actualizado') {
          window.dispatchEvent(new CustomEvent('portal:buzon-usuario-actualizado'));
        }
      } catch {}
    });
    socket.addEventListener('close', function () { socket = null; reintentar(); });
    socket.addEventListener('error', function () { socket?.close(); });
  };
  const reintentar = function () {
    if (temporizador) return;
    temporizador = window.setTimeout(function () { temporizador = null; conectar(); }, 3000);
  };
  conectar();
}

function inicializarBuzonPersonal() {
  const raiz = document.querySelector('[data-buzon-personal]');
  if (!raiz) return;
  const boton = raiz.querySelector('[data-buzon-personal-abrir]');
  const cerrar = raiz.querySelector('[data-buzon-personal-cerrar]');
  const overlay = raiz.querySelector('[data-buzon-personal-overlay]');
  const contador = raiz.querySelector('[data-buzon-personal-contador]');
  const resumen = raiz.querySelector('[data-buzon-personal-resumen]');
  const lista = raiz.querySelector('[data-buzon-personal-lista]');
  const mas = raiz.querySelector('[data-buzon-personal-mas]');
  const urlListado = String(raiz.dataset.urlListado || '');
  const urlContador = String(raiz.dataset.urlContador || '');
  let siguienteCursor = null;
  let cargando = false;

  const obtenerJson = async function (url, opciones = {}) {
    const respuesta = await fetch(url, {
      ...opciones,
      headers: {
        Accept: 'application/json',
        'X-Silenciar-Toast-Error': '1',
        ...(opciones.headers || {})
      }
    });
    if (!respuesta.ok) throw new Error('El buzón no está disponible.');
    return respuesta.json();
  };

  const actualizarContador = function (noLeidas) {
    const total = Math.max(0, Number(noLeidas || 0));
    contador.textContent = String(total);
    contador.hidden = total === 0;
    boton.setAttribute('aria-label', total > 0
      ? `Abrir buzón personal, ${total} notificaciones sin leer`
      : 'Abrir buzón personal, sin notificaciones pendientes');
    resumen.textContent = `${total} sin leer`;
  };

  const crearNotificacion = function (notificacion) {
    const articulo = document.createElement('article');
    articulo.className = 'buzon-personal-notificacion';
    if (!notificacion.leida) articulo.classList.add('buzon-personal-notificacion--no-leida');
    const cabecera = document.createElement('div');
    cabecera.className = 'buzon-personal-notificacion__cabecera';
    const titulo = document.createElement('strong');
    titulo.textContent = String(notificacion.titulo || 'Notificación');
    const estado = document.createElement('span');
    estado.textContent = notificacion.leida ? 'Leída' : 'Nueva';
    cabecera.append(titulo, estado);
    const texto = document.createElement('p');
    texto.textContent = String(notificacion.resumen || '');
    const meta = document.createElement('small');
    const fecha = window.portalFechas?.formatear?.(notificacion.emitidaEnUtc) || notificacion.emitidaEnUtc || '';
    meta.textContent = [
      notificacion.emisor?.etiqueta || 'Plataforma',
      fecha,
      notificacion.estadoOperacion
        ? `Resultado: ${legible(notificacion.estadoOperacion)}`
        : null
    ].filter(Boolean).join(' · ');
    articulo.append(cabecera, texto, meta);
    const acciones = document.createElement('div');
    acciones.className = 'buzon-personal-notificacion__acciones';
    if (notificacion.operacion?.enlace) {
      const enlace = document.createElement('a');
      enlace.className = 'btn btn-sm btn-outline-primary';
      enlace.href = notificacion.operacion.enlace;
      enlace.textContent = 'Ver operación';
      acciones.appendChild(enlace);
    }
    if (!notificacion.leida) {
      const leer = document.createElement('button');
      leer.type = 'button';
      leer.className = 'btn btn-sm btn-outline-secondary';
      leer.textContent = 'Marcar como leída';
      leer.addEventListener('click', async function () {
        leer.disabled = true;
        try {
          const resultado = await obtenerJson(`/buzon/api/notificaciones/${encodeURIComponent(notificacion.notificacionId)}/leer`, { method: 'POST' });
          actualizarContador(resultado.noLeidas);
          await cargarPagina({ reemplazar: true });
        } catch (error) {
          window.portalToast?.show?.({ tipo: 'error', titulo: 'Buzón no actualizado', cuerpo: error.message });
        } finally { leer.disabled = false; }
      });
      acciones.appendChild(leer);
    }
    if (acciones.childElementCount > 0) articulo.appendChild(acciones);
    return articulo;
  };

  const cargarPagina = async function ({ reemplazar = false } = {}) {
    if (cargando) return;
    cargando = true;
    try {
      const url = new URL(urlListado, location.origin);
      url.searchParams.set('limite', '20');
      if (!reemplazar && siguienteCursor) url.searchParams.set('cursor', siguienteCursor);
      const payload = await obtenerJson(url);
      if (reemplazar) lista.replaceChildren();
      const items = Array.isArray(payload.notificaciones) ? payload.notificaciones : [];
      if (reemplazar && items.length === 0) {
        const vacio = document.createElement('p');
        vacio.className = 'buzon-personal-overlay__vacio';
        vacio.textContent = 'Tu buzón personal está vacío.';
        lista.appendChild(vacio);
      } else {
        for (const item of items) lista.appendChild(crearNotificacion(item));
      }
      actualizarContador(payload.noLeidas);
      siguienteCursor = payload.paginacion?.siguienteCursor || null;
      mas.hidden = !payload.paginacion?.hayMas;
    } catch (_error) {
      resumen.textContent = 'No se pudo actualizar';
    } finally { cargando = false; }
  };

  const refrescarContador = async function () {
    try { actualizarContador((await obtenerJson(urlContador)).noLeidas); }
    catch (_error) { resumen.textContent = 'No se pudo actualizar'; }
  };
  boton.addEventListener('click', function () {
    const abrir = overlay.hidden;
    overlay.hidden = !abrir;
    boton.setAttribute('aria-expanded', String(abrir));
    if (abrir) { siguienteCursor = null; void cargarPagina({ reemplazar: true }); cerrar.focus(); }
  });
  cerrar.addEventListener('click', function () { overlay.hidden = true; boton.setAttribute('aria-expanded', 'false'); boton.focus(); });
  mas.addEventListener('click', function () { void cargarPagina(); });
  document.addEventListener('keydown', function (evento) { if (evento.key === 'Escape' && !overlay.hidden) cerrar.click(); });
  window.addEventListener('portal:buzon-usuario-actualizado', function () { void refrescarContador(); if (!overlay.hidden) void cargarPagina({ reemplazar: true }); });
  window.addEventListener('focus', refrescarContador);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) void refrescarContador(); });
  window.setInterval(refrescarContador, 30000);
  void refrescarContador();
}

function legible(valor) {
  const texto = String(valor || '').replaceAll('_', ' ').trim();
  return texto ? texto.charAt(0).toUpperCase() + texto.slice(1) : 'Aviso';
}

function describirScope(scope) {
  if (scope?.sitioId) return `sitio ${scope.sitioId}`;
  if (scope?.empresaId) return `empresa ${scope.empresaId}`;
  if (scope?.tenantId) return `tenant ${scope.tenantId}`;
  return 'portal';
}

function describirAviso(aviso) {
  const contexto = aviso?.contextoHumano || {};
  const resumen = aviso?.resumen || {};
  if (aviso?.causaCodigo === 'estado_remoto_vencido') {
    const identidadInstalacion = aviso.installationRemotaNombre || contexto.installationOrigenId;
    const instalacion = identidadInstalacion
      ? `La instalación remota «${identidadInstalacion}»`
      : 'Una instalación remota';
    const vencimiento = formatearFechaLocal(resumen.vigenteHastaEfectivaUtc);
    const estado = resumen.estadoOperativo
      ? ` y ahora figura como ${legible(resumen.estadoOperativo).toLocaleLowerCase('es')}`
      : '';
    return `${instalacion} no renovó su estado operativo${vencimiento
      ? `; la vigencia de la última observación terminó el ${vencimiento}`
      : ''}${estado}.`;
  }
  const mensaje = resumen.mensaje || contexto.mensaje || contexto.detalle;
  return mensaje ? String(mensaje) : 'La plataforma detectó una condición que requiere atención.';
}

function crearContextoAviso(aviso) {
  const contexto = aviso?.contextoHumano || {};
  const filas = [
    ['Instalación remota', aviso?.installationRemotaNombre],
    ['Identidad de instalación', contexto.installationOrigenId],
    ['Relación', aviso?.relacionId],
    ['Flujo', aviso?.flujoId],
    ['Monitor de origen', contexto.monitorOrigenId],
    ['Elemento de origen', contexto.elementoOrigenId],
    ['Primera detección', formatearFechaLocal(aviso?.primeraDeteccionUtc)],
    ['Última detección', formatearFechaLocal(aviso?.ultimaDeteccionUtc)],
    ['Detecciones', Number(aviso?.contadorDetecciones) > 0
      ? String(aviso.contadorDetecciones)
      : null]
  ].filter(([, valor]) => valor !== null && valor !== undefined && valor !== '');
  if (filas.length === 0) return null;
  const lista = document.createElement('dl');
  lista.className = 'aviso-plataforma__contexto';
  for (const [etiqueta, valor] of filas) {
    const termino = document.createElement('dt');
    termino.textContent = etiqueta;
    const dato = document.createElement('dd');
    const esIdentificador = [
      'Identidad de instalación', 'Relación', 'Flujo', 'Monitor de origen',
      'Elemento de origen'
    ]
      .includes(etiqueta);
    if (esIdentificador) {
      const codigo = document.createElement('code');
      codigo.textContent = String(valor);
      dato.appendChild(codigo);
    } else {
      dato.textContent = String(valor);
    }
    lista.append(termino, dato);
  }
  return lista;
}

function crearDetalleTecnicoAviso(aviso) {
  const datos = {
    resumen: aviso?.resumen || null,
    contexto: aviso?.contextoHumano || null,
    objeto: aviso?.objeto || null
  };
  if (!Object.values(datos).some(Boolean)) return null;
  const desplegable = document.createElement('details');
  desplegable.className = 'aviso-plataforma__tecnico';
  const titulo = document.createElement('summary');
  titulo.textContent = 'Detalle técnico';
  const contenido = document.createElement('pre');
  contenido.className = 'aviso-plataforma__detalle';
  contenido.textContent = JSON.stringify(datos, null, 2);
  desplegable.append(titulo, contenido);
  return desplegable;
}

function obtenerTokenCSRFPortal() {
  const meta = document.querySelector('meta[name="csrf-token"]');
  const body = document.body;

  const desdeMeta = String(meta?.getAttribute('content') || '').trim();
  if (desdeMeta) {
    return desdeMeta;
  }

  const desdeBody = String(body?.dataset?.csrfToken || '').trim();
  return desdeBody || '';
}

function configurarProteccionCsrf(tokenCSRF) {
  const token = String(tokenCSRF || '').trim();
  if (token) {
    document.addEventListener(
      'submit',
      function (evento) {
        const formulario = evento.target;

        if (!(formulario instanceof HTMLFormElement)) {
          return;
        }

        const metodo = String(
          formulario.getAttribute('method') || 'get'
        ).trim().toUpperCase();

        if (metodo !== 'POST' || !esAccionMismaOrigen(formulario.getAttribute('action'))) {
          return;
        }

        let inputToken = formulario.querySelector('input[name="_csrf"]');

        if (!inputToken) {
          inputToken = document.createElement('input');
          inputToken.type = 'hidden';
          inputToken.name = '_csrf';
          formulario.appendChild(inputToken);
        }

        inputToken.value = token;
      },
      true
    );
  }

  const fetchOriginal = window.fetch.bind(window);

  window.fetch = async function fetchProtegido(input, init = undefined) {
    const request = input instanceof Request ? input : null;
    const metodoBase = request?.method || init?.method || 'GET';
    const metodo = String(metodoBase).trim().toUpperCase();
    const url = resolverUrlFetch(input);
    const mismaOrigen = Boolean(url && url.origin === window.location.origin);
    const cabecerasBase = new Headers(request?.headers || init?.headers || {});
    const configuracion = {
      ...(init || {}),
      headers: cabecerasBase
    };

    if (
      token &&
      mismaOrigen &&
      ['POST', 'PUT', 'PATCH', 'DELETE'].includes(metodo) &&
      !cabecerasBase.has('X-CSRF-Token')
    ) {
      cabecerasBase.set('X-CSRF-Token', token);
    }

    const respuesta = await fetchOriginal(input, configuracion);

    if (
      mismaOrigen &&
      !respuesta.ok &&
      !cabecerasBase.has('X-Silenciar-Toast-Error')
    ) {
      await notificarErrorAjax(respuesta);
    }

    return respuesta;
  };
}

function resolverUrlFetch(input) {
  try {
    if (input instanceof Request) {
      return new URL(input.url, window.location.origin);
    }

    if (typeof input === 'string') {
      return new URL(input, window.location.origin);
    }

    if (input instanceof URL) {
      return input;
    }

    if (input && typeof input.url === 'string') {
      return new URL(input.url, window.location.origin);
    }
  } catch (_error) {
    return null;
  }

  return null;
}

function esAccionMismaOrigen(action) {
  try {
    const destino = new URL(action || window.location.pathname, window.location.origin);
    return destino.origin === window.location.origin;
  } catch (_error) {
    return false;
  }
}

async function notificarErrorAjax(respuesta) {
  const mensaje = await resolverMensajeErrorRespuesta(respuesta);
  const titulo = `Respuesta ${respuesta.status}`;
  const cuerpo =
    mensaje ||
    respuesta.statusText ||
    'La petición AJAX devolvió un error no controlado.';

  if (window.portalToast?.show) {
    window.portalToast.show({
      tipo: respuesta.status >= 500 ? 'error' : 'advertencia',
      titulo,
      cuerpo,
      duracionMs: 6000
    });
    return;
  }

  window.alert(`${titulo}: ${cuerpo}`);
}

async function resolverMensajeErrorRespuesta(respuesta) {
  try {
    const contentType = String(
      respuesta.headers.get('content-type') || ''
    ).toLowerCase();
    const clon = respuesta.clone();

    if (contentType.includes('application/json')) {
      const datos = await clon.json();
      return String(
        datos?.mensaje ||
        datos?.error ||
        datos?.message ||
        ''
      ).trim();
    }

    if (contentType.startsWith('text/')) {
      const texto = String(await clon.text()).trim();
      return texto.slice(0, 240);
    }
  } catch (_error) {
    return '';
  }

  return '';
}

function resolverTipoToast(tipo) {
  const normalizado = String(tipo || 'informativo').trim().toLowerCase();
  const aliases = {
    success: 'satisfactorio',
    exito: 'satisfactorio',
    éxito: 'satisfactorio',
    info: 'informativo',
    warning: 'advertencia',
    danger: 'peligro'
  };
  const tipoCanonico = aliases[normalizado] || normalizado;

  return [
    'satisfactorio',
    'informativo',
    'advertencia',
    'peligro',
    'error'
  ].includes(tipoCanonico)
    ? tipoCanonico
    : 'informativo';
}

function resolverCuerpoToast(payload) {
  return String(
    payload.cuerpo ?? payload.mensaje ?? ''
  ).trim();
}

function escapeHtml(texto) {
  return String(texto)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatearFechaLocal(fecha) {
  const valor = fecha instanceof Date ? fecha : new Date(fecha);

  if (Number.isNaN(valor.getTime())) {
    return '';
  }

  return new Intl.DateTimeFormat('es-ES', {
    dateStyle: 'short',
    timeStyle: 'medium'
  }).format(valor);
}

function formatearDuracionSegundos(valor, opciones = {}) {
  const segundos = Number(valor);
  const aproximada = Boolean(opciones.aproximada);

  if (!Number.isFinite(segundos) || segundos < 0) return '';

  if (aproximada) {
    if (segundos < 60) return `${Math.round(segundos)} s`;
    if (segundos < 3600) return `${Math.round(segundos / 60)} min`;
    if (segundos < 86400) return `${Math.round(segundos / 3600)} h`;
    return `${Math.round(segundos / 86400)} d`;
  }

  if (segundos < 60) return `${segundos} ${segundos === 1 ? 'segundo' : 'segundos'}`;
  if (segundos < 3600) {
    const minutos = segundos / 60;
    return Number.isInteger(minutos)
      ? `${minutos} ${minutos === 1 ? 'minuto' : 'minutos'}`
      : `${minutos.toFixed(1).replace('.', ',')} min`;
  }
  if (segundos < 86400) {
    const horas = segundos / 3600;
    return Number.isInteger(horas)
      ? `${horas} ${horas === 1 ? 'hora' : 'horas'}`
      : `${horas.toFixed(1).replace('.', ',')} h`;
  }

  const dias = segundos / 86400;
  return Number.isInteger(dias)
    ? `${dias} ${dias === 1 ? 'día' : 'días'}`
    : `${dias.toFixed(1).replace('.', ',')} días`;
}

function hidratarDuracionesHumanas(raiz = document) {
  for (const nodo of raiz.querySelectorAll('[data-duracion-segundos]')) {
    const texto = formatearDuracionSegundos(nodo.dataset.duracionSegundos, {
      aproximada: nodo.dataset.duracionAproximada === 'true'
    });

    if (texto) nodo.textContent = texto;
  }
}

function crearGestorImpersonacion({ modal, mostrarToast }) {
  const botonesAbrir = Array.from(
    document.querySelectorAll('[data-impersonacion-abrir]')
  );
  const botonesCerrar = Array.from(
    modal.querySelectorAll('[data-impersonacion-cerrar]')
  );
  const formulario = modal.querySelector('[data-impersonacion-formulario]');
  const botonLimpiar = modal.querySelector('[data-impersonacion-limpiar]');
  const botonRevertir = modal.querySelector('[data-impersonacion-revertir]');
  const contenedorListado = modal.querySelector('[data-impersonacion-listado]');
  const contenedorResumen = modal.querySelector('[data-impersonacion-resumen]');
  const contenedorPaginacion = modal.querySelector('[data-impersonacion-paginacion]');
  const selectTenant = modal.querySelector('[data-impersonacion-tenant]');
  const selectEmpresa = modal.querySelector('[data-impersonacion-empresa]');
  const selectSitio = modal.querySelector('[data-impersonacion-sitio]');
  const estado = {
    cargadoTenants: false,
    paginaActual: 1,
    cargando: false,
    impersonacionActiva: modal.dataset.impersonacionActiva === '1',
    puedeUsarCatalogo: modal.dataset.impersonacionCatalogo === '1'
  };

  for (const boton of botonesAbrir) {
    boton.addEventListener('click', function () {
      abrirModal();
    });
  }

  for (const boton of botonesCerrar) {
    boton.addEventListener('click', cerrarModal);
  }

  if (formulario) {
    formulario.addEventListener('submit', function (evento) {
      evento.preventDefault();
      void cargarListado({ pagina: 1 });
    });
  }

  if (botonLimpiar && formulario) {
    botonLimpiar.addEventListener('click', function () {
      formulario.reset();
      resetearSelect(selectEmpresa, 'Todas');
      resetearSelect(selectSitio, 'Todos');
      estado.paginaActual = 1;
      void cargarListado({ pagina: 1 });
    });
  }

  if (botonRevertir) {
    botonRevertir.addEventListener('click', function () {
      void revertirImpersonacion();
    });
  }

  if (selectTenant) {
    selectTenant.addEventListener('change', function () {
      void recargarEmpresasYSitios();
    });
  }

  if (selectEmpresa) {
    selectEmpresa.addEventListener('change', function () {
      void recargarSitios();
    });
  }

  document.addEventListener('keydown', function (evento) {
    if (evento.key === 'Escape' && !modal.hidden) {
      cerrarModal();
    }
  });

  async function abrirModal() {
    modal.hidden = false;
    document.body.classList.add('modal-abierto');
    if (!estado.puedeUsarCatalogo) {
      return;
    }
    if (!estado.cargadoTenants) {
      await cargarTenants();
      estado.cargadoTenants = true;
    }
    if (contenedorListado && !contenedorListado.dataset.cargadoInicial) {
      await cargarListado({ pagina: 1 });
      contenedorListado.dataset.cargadoInicial = '1';
    }
  }

  function cerrarModal() {
    modal.hidden = true;
    document.body.classList.remove('modal-abierto');
  }

  async function cargarTenants() {
    try {
      const datos = await getJson(modal.dataset.urlTenants);
      poblarOpciones(selectTenant, datos.opciones || [], 'Todos');
    } catch (error) {
      mostrarToast({
        tipo: 'error',
        titulo: 'Impersonación',
        cuerpo: error.message || 'No se pudieron cargar los tenants visibles.'
      });
    }
  }

  async function recargarEmpresasYSitios() {
    resetearSelect(selectEmpresa, 'Todas');
    resetearSelect(selectSitio, 'Todos');

    if (!selectTenant.value) {
      return;
    }

    try {
      const datos = await getJson(
        `${modal.dataset.urlEmpresas}?tenant_id=${encodeURIComponent(selectTenant.value)}`
      );
      poblarOpciones(selectEmpresa, datos.opciones || [], 'Todas');
    } catch (error) {
      mostrarToast({
        tipo: 'error',
        titulo: 'Impersonación',
        cuerpo: error.message || 'No se pudieron cargar las empresas visibles.'
      });
    }
  }

  async function recargarSitios() {
    resetearSelect(selectSitio, 'Todos');

    if (!selectTenant.value || !selectEmpresa.value) {
      return;
    }

    try {
      const parametros = new URLSearchParams({
        tenant_id: selectTenant.value,
        empresa_id: selectEmpresa.value
      });
      const datos = await getJson(
        `${modal.dataset.urlSitios}?${parametros.toString()}`
      );
      poblarOpciones(selectSitio, datos.opciones || [], 'Todos');
    } catch (error) {
      mostrarToast({
        tipo: 'error',
        titulo: 'Impersonación',
        cuerpo: error.message || 'No se pudieron cargar los sitios visibles.'
      });
    }
  }

  async function cargarListado({ pagina = 1 } = {}) {
    if (!estado.puedeUsarCatalogo || !formulario || !contenedorListado) {
      return;
    }

    if (estado.cargando) {
      return;
    }

    estado.cargando = true;
    estado.paginaActual = pagina;
    contenedorListado.innerHTML =
      '<div class="estado-vacio estado-vacio--compacto">Cargando catálogo visible...</div>';

    try {
      const parametros = new URLSearchParams();
      const valorTexto = formulario.elements.q.value.trim();

      if (valorTexto) {
        parametros.set('q', valorTexto);
      }

      if (selectTenant.value) {
        parametros.set('tenant_id', selectTenant.value);
      }

      if (selectEmpresa.value) {
        parametros.set('empresa_id', selectEmpresa.value);
      }

      if (selectSitio.value) {
        parametros.set('sitio_id', selectSitio.value);
      }

      parametros.set('activo', formulario.elements.activo.value || 'todos');
      parametros.set('page_size', formulario.elements.page_size.value || '10');
      parametros.set('page', String(pagina));
      parametros.set('sort_by', 'usuario');
      parametros.set('sort_dir', 'asc');

      const datos = await getJson(
        `${modal.dataset.urlListado}?${parametros.toString()}`
      );

      renderResumen(datos);
      renderListado(datos.usuarios || []);
      renderPaginacion(datos.paginacion || {});
    } catch (error) {
      contenedorListado.innerHTML =
        '<div class="estado-vacio estado-vacio--compacto">No se pudo cargar el catálogo.</div>';
      contenedorPaginacion.innerHTML = '';
      mostrarToast({
        tipo: 'error',
        titulo: 'Impersonación',
        cuerpo: error.message || 'No se pudo consultar el catálogo visible.'
      });
    } finally {
      estado.cargando = false;
    }
  }

  function renderResumen(datos) {
    const resumen = datos.resumen || {};
    const actorReal = datos.actorReal || {};
    const total = Number(resumen.totalUsuarios || 0);
    const activos = Number(resumen.activos || 0);
    const inactivos = Number(resumen.inactivos || 0);

    contenedorResumen.innerHTML = `
      <strong>${escapeHtml(actorReal.nombreVisible || 'Actor real')}</strong>
      <span>${escapeHtml(actorReal.descripcionScope || 'Alcance no disponible')}</span>
      <span>${total} visibles · ${activos} activas · ${inactivos} inactivas</span>
    `;
  }

  function renderListado(usuarios) {
    if (!usuarios.length) {
      contenedorListado.innerHTML =
        '<div class="estado-vacio estado-vacio--compacto">No hay usuarios visibles con estos filtros.</div>';
      return;
    }

    contenedorListado.innerHTML = usuarios.map(function (usuario) {
      const estadoActivo = usuario.activo
        ? '<span class="insignia-suave">Activa</span>'
        : '<span class="insignia-suave insignia-suave--neutra">Inactiva</span>';
      const descripcionScope = usuario.descripcionScope || usuario.nivelScope || 'Alcance';
      const tenant = usuario.tenantNombre ? escapeHtml(usuario.tenantNombre) : '-';
      const empresa = usuario.empresaNombre ? escapeHtml(usuario.empresaNombre) : '-';
      const sitio = usuario.sitioNombre ? escapeHtml(usuario.sitioNombre) : '-';

      return `
        <article class="fila-impersonacion">
          <div class="fila-impersonacion__cabecera">
            <div>
              <strong>${escapeHtml(usuario.nombreMostrar || usuario.nombreCompleto || usuario.usuario)}</strong>
              <div class="fila-impersonacion__meta">@${escapeHtml(usuario.usuario)} · #${escapeHtml(usuario.id)}</div>
            </div>
            <div class="fila-impersonacion__acciones">
              ${estadoActivo}
              ${
                estado.impersonacionActiva
                  ? '<span class="fila-impersonacion__bloqueo">Reviértela antes de cambiar.</span>'
                  : `
                    <button
                      type="button"
                      class="boton-primario boton-primario--compacto"
                      data-impersonacion-iniciar="${escapeHtml(usuario.id)}"
                    >
                      Impersonar
                    </button>
                  `
              }
            </div>
          </div>
          <div class="fila-impersonacion__cuerpo">
            <span>${escapeHtml(descripcionScope)}</span>
            <span>Tenant: ${tenant}</span>
            <span>Empresa: ${empresa}</span>
            <span>Sitio: ${sitio}</span>
          </div>
        </article>
      `;
    }).join('');

    const botones = Array.from(
      contenedorListado.querySelectorAll('[data-impersonacion-iniciar]')
    );

    for (const boton of botones) {
      boton.addEventListener('click', function () {
        const idUsuario = boton.dataset.impersonacionIniciar;
        void iniciarImpersonacion(idUsuario, boton);
      });
    }
  }

  function renderPaginacion(paginacion) {
    const pagina = Number(paginacion.pagina || 1);
    const totalPaginas = Number(paginacion.totalPaginas || 1);
    const desde = Number(paginacion.desde || 0);
    const hasta = Number(paginacion.hasta || 0);
    const total = Number(paginacion.totalFiltrado || 0);

    if (total <= 0) {
      contenedorPaginacion.innerHTML = '';
      return;
    }

    contenedorPaginacion.innerHTML = `
      <div class="paginacion-impersonacion__resumen">
        ${desde}-${hasta} de ${total}
      </div>
      <div class="paginacion-impersonacion__acciones">
        <button type="button" class="boton-secundario" data-impersonacion-pagina="${pagina - 1}" ${pagina <= 1 ? 'disabled' : ''}>Anterior</button>
        <span>Página ${pagina} / ${totalPaginas}</span>
        <button type="button" class="boton-secundario" data-impersonacion-pagina="${pagina + 1}" ${pagina >= totalPaginas ? 'disabled' : ''}>Siguiente</button>
      </div>
    `;

    const botones = Array.from(
      contenedorPaginacion.querySelectorAll('[data-impersonacion-pagina]')
    );

    for (const boton of botones) {
      boton.addEventListener('click', function () {
        const siguientePagina = Number(boton.dataset.impersonacionPagina || pagina);
        void cargarListado({ pagina: siguientePagina });
      });
    }
  }

  async function iniciarImpersonacion(idUsuario, boton) {
    const etiquetaOriginal = boton ? boton.textContent : '';

    if (boton) {
      boton.disabled = true;
      boton.textContent = 'Aplicando...';
    }

    try {
      const datos = await postJson(modal.dataset.urlIniciar, {
        id_usuario: idUsuario
      });
      window.portalToast.persist({
        tipo: 'satisfactorio',
        titulo: 'Impersonación activa',
        cuerpo: datos.mensaje || 'La identidad efectiva ha cambiado.'
      });
      window.location.reload();
    } catch (error) {
      if (boton) {
        boton.disabled = false;
        boton.textContent = etiquetaOriginal;
      }
      mostrarToast({
        tipo: 'error',
        titulo: 'Impersonación',
        cuerpo: error.message || 'No se pudo cambiar la identidad efectiva.'
      });
    }
  }

  async function revertirImpersonacion() {
    if (botonRevertir) {
      botonRevertir.disabled = true;
      botonRevertir.textContent = 'Revirtiendo...';
    }

    try {
      const datos = await postJson(modal.dataset.urlRevertir, {});
      window.portalToast.persist({
        tipo: 'satisfactorio',
        titulo: 'Sesión restaurada',
        cuerpo: datos.mensaje || 'Has vuelto a tu identidad real.'
      });
      window.location.reload();
    } catch (error) {
      if (botonRevertir) {
        botonRevertir.disabled = false;
        botonRevertir.textContent = 'Volver a mi sesión real';
      }
      mostrarToast({
        tipo: 'error',
        titulo: 'Impersonación',
        cuerpo: error.message || 'No se pudo revertir la sesión.'
      });
    }
  }
}

async function getJson(url) {
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

async function postJson(url, payload) {
  const respuesta = await window.fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest'
    },
    body: JSON.stringify(payload || {})
  });
  const datos = await respuesta.json().catch(function () {
    return {};
  });

  if (!respuesta.ok || datos.ok === false) {
    throw new Error(datos.mensaje || 'La operación solicitada no pudo completarse.');
  }

  return datos;
}

function poblarOpciones(select, opciones, etiquetaVacia) {
  select.innerHTML = '';
  const opcionVacia = document.createElement('option');
  opcionVacia.value = '';
  opcionVacia.textContent = etiquetaVacia;
  select.appendChild(opcionVacia);

  for (const opcion of opciones) {
    const nodo = document.createElement('option');
    nodo.value = String(opcion.valor ?? '');
    nodo.textContent = String(opcion.etiqueta ?? opcion.valor ?? '');
    select.appendChild(nodo);
  }
}

function resetearSelect(select, etiquetaVacia) {
  poblarOpciones(select, [], etiquetaVacia);
}
