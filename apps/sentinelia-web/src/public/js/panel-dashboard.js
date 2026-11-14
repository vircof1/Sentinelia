(function () {
  const modulo = document.querySelector('[data-dashboard-shell]');

  if (!modulo) {
    return;
  }

  inicializarDashboardPanel(modulo);
})();

function inicializarDashboardPanel(modulo) {
  const urlDashboard = String(modulo.dataset.urlDashboard || '').trim();
  const urlDashboardWs = String(modulo.dataset.urlDashboardWs || '').trim();
  const urlAlertasBase = String(modulo.dataset.urlAlertasBase || '').trim();
  const puedeGestionarDescartes =
    String(modulo.dataset.puedeGestionarDescartes || '').trim() === '1';
  const tiempoRealHabilitado =
    String(modulo.dataset.dashboardTiempoReal || '').trim() === 'true';
  const botonRefrescar = modulo.querySelector('[data-dashboard-refrescar]');
  const estadoRefresco = modulo.querySelector('[data-dashboard-estado-refresco]');
  const heroDetalle = modulo.querySelector('[data-dashboard-hero-detalle]');
  const heroCardSupervision = modulo.querySelector('[data-dashboard-hero-card-supervision]');
  const heroSupervision = modulo.querySelector('[data-dashboard-hero-supervision]');
  const heroSupervisionDetalle = modulo.querySelector('[data-dashboard-hero-supervision-detalle]');
  const heroCardAlertas = modulo.querySelector('[data-dashboard-hero-card-alertas]');
  const heroAlertasVisibles = modulo.querySelector('[data-dashboard-hero-alertas-visibles]');
  const heroAlertasDetalle = modulo.querySelector('[data-dashboard-hero-alertas-detalle]');
  const heroCardDescartadas = modulo.querySelector('[data-dashboard-hero-card-descartadas]');
  const heroAlertasDescartadas = modulo.querySelector('[data-dashboard-hero-alertas-descartadas]');
  const heroCardPendientes = modulo.querySelector('[data-dashboard-hero-card-pendientes]');
  const heroPendientes = modulo.querySelector('[data-dashboard-hero-pendientes]');
  const heroDns = modulo.querySelector('[data-dashboard-hero-dns]');
  const visionDescripcion = modulo.querySelector('[data-dashboard-vision-descripcion]');
  const contenedorResumen = modulo.querySelector('[data-dashboard-resumen-contenido]');
  const contenedorAlertas = modulo.querySelector('[data-dashboard-alertas-contenido]');
  const contenedorAlertasRemotas = modulo.querySelector('[data-dashboard-alertas-remotas]');
  const modalDescarte = document.querySelector('[data-dashboard-descarte-modal]');
  const formularioDescarte = document.querySelector('[data-dashboard-descarte-form]');
  const tituloDescarte = document.querySelector('[data-dashboard-descarte-titulo]');
  const campoTipoDescarte = document.querySelector('[data-dashboard-descarte-tipo]');
  const campoMonitorIdDescarte = document.querySelector('[data-dashboard-descarte-monitor-id]');
  const campoProyeccionIdDescarte = document.querySelector('[data-dashboard-descarte-proyeccion-id]');
  const campoAlertaIdDescarte = document.querySelector('[data-dashboard-descarte-alerta-id]');
  const textoMonitorDescarte = document.querySelector('[data-dashboard-descarte-monitor]');
  const campoMotivoDescarte = document.querySelector('[data-dashboard-descarte-motivo]');
  const campoHastaDescarte = document.querySelector('[data-dashboard-descarte-hasta]');
  const botonEnviarDescarte = document.querySelector('[data-dashboard-descarte-enviar]');
  const estado = {
    refrescando: false,
    refrescoPendiente: false,
    necesitaSincronizacionSocket: false,
    ws: null,
    wsUrl: urlDashboardWs,
    refrescarDashboard: null,
    temporizadorReconexion: null
  };

  if (!urlDashboard) {
    return;
  }

  const refrescarDashboard = async function ({ silencioso = false } = {}) {
    if (estado.refrescando) {
      estado.refrescoPendiente = true;
      return;
    }

    estado.refrescando = true;
    const textoOriginal = botonRefrescar ? botonRefrescar.textContent : '';

    try {
      if (!silencioso && botonRefrescar) {
        botonRefrescar.disabled = true;
        botonRefrescar.textContent = 'Actualizando...';
      }

      const respuesta = await fetchJson(urlDashboard);
      const dashboard = respuesta.dashboardOperativo || null;

      renderizarHero({
        dashboard,
        heroDetalle,
        heroCardSupervision,
        heroSupervision,
        heroSupervisionDetalle,
        heroCardAlertas,
        heroAlertasVisibles,
        heroAlertasDetalle,
        heroCardDescartadas,
        heroAlertasDescartadas,
        heroCardPendientes,
        heroPendientes,
        heroDns
      });
      renderizarVision({
        dashboard,
        visionDescripcion,
        contenedorResumen
      });
      renderizarAlertas({
        dashboard,
        contenedorAlertas,
        puedeGestionarDescartes
      });
      renderizarAlertasRemotas(dashboard?.alertasRemotas, contenedorAlertasRemotas);
      actualizarEstadoRefresco(
        estadoRefresco,
        dashboard?.generadoEnUtc || null,
        dashboard?.generadoEnUtc
          ? null
          : 'Sin lectura operativa disponible.'
      );
      window.portalFechas?.hidratar?.();
    } catch (error) {
      actualizarEstadoRefresco(
        estadoRefresco,
        null,
        error.message || 'No se pudo actualizar el panel.'
      );

      if (!silencioso) {
        window.portalToast?.show?.({
          tipo: 'error',
          titulo: 'No se pudo refrescar el panel',
          cuerpo: error.message || 'La lectura operativa ha fallado.'
        });
      }
    } finally {
      if (!silencioso && botonRefrescar) {
        botonRefrescar.disabled = false;
        botonRefrescar.textContent = textoOriginal;
      }

      estado.refrescando = false;

      if (estado.refrescoPendiente) {
        estado.refrescoPendiente = false;
        window.setTimeout(function () {
          void refrescarDashboard({ silencioso: true });
        }, 0);
      }
    }
  };
  estado.refrescarDashboard = refrescarDashboard;

  configurarGestionAlertasDashboard({
    urlAlertasBase,
    puedeGestionarDescartes,
    contenedorAlertas,
    refrescarDashboard,
    modalDescarte,
    formularioDescarte,
    tituloDescarte,
    campoTipoDescarte,
    campoMonitorIdDescarte,
    textoMonitorDescarte,
    campoMotivoDescarte,
    campoHastaDescarte,
    botonEnviarDescarte
  });
  configurarGestionAlertasRemotas({
    contenedor: contenedorAlertasRemotas,
    refrescarDashboard,
    modalDescarte,
    formularioDescarte,
    tituloDescarte,
    campoTipoDescarte,
    campoProyeccionIdDescarte,
    campoAlertaIdDescarte,
    textoMonitorDescarte,
    campoMotivoDescarte,
    campoHastaDescarte,
    botonEnviarDescarte
  });

  if (botonRefrescar) {
    botonRefrescar.addEventListener('click', function () {
      void refrescarDashboard({ silencioso: false });
    });
  }

  if (
    tiempoRealHabilitado &&
    urlDashboardWs &&
    typeof window.WebSocket === 'function'
  ) {
    abrirCanalDashboard({
      urlDashboardWs,
      estado,
      estadoRefresco,
      refrescarDashboard
    });
  }
}

function configurarGestionAlertasDashboard({
  urlAlertasBase,
  puedeGestionarDescartes,
  contenedorAlertas,
  refrescarDashboard,
  modalDescarte,
  formularioDescarte,
  tituloDescarte,
  campoTipoDescarte,
  campoMonitorIdDescarte,
  textoMonitorDescarte,
  campoMotivoDescarte,
  campoHastaDescarte,
  botonEnviarDescarte
}) {
  if (!puedeGestionarDescartes || !urlAlertasBase || !contenedorAlertas) {
    return;
  }

  // En móvil, portal.js traslada el menú fuera de la tabla para evitar su recorte.
  // La delegación debe vivir en document para acompañar ese cambio temporal de padre.
  document.addEventListener('click', function (evento) {
    const objetivo = evento.target instanceof Element ? evento.target : null;

    if (!objetivo) {
      return;
    }

    const botonDescarte = objetivo.closest('[data-dashboard-descartar-alerta]');
    const botonRevertir = objetivo.closest('[data-dashboard-revertir-descarte]');

    if (botonDescarte) {
      evento.preventDefault();
      abrirModalDescarteAlerta({
        boton: botonDescarte,
        modalDescarte,
        tituloDescarte,
        campoTipoDescarte,
        campoMonitorIdDescarte,
        textoMonitorDescarte,
        campoMotivoDescarte,
        campoHastaDescarte
      });
      return;
    }

    if (botonRevertir) {
      evento.preventDefault();
      void revertirDescarteAlertaDashboard({
        boton: botonRevertir,
        urlAlertasBase,
        refrescarDashboard
      });
    }
  });

  if (!formularioDescarte) {
    return;
  }

  formularioDescarte.addEventListener('submit', async function (evento) {
    if (String(campoTipoDescarte?.value || 'local') !== 'local') return;
    evento.preventDefault();

    const monitorId = String(campoMonitorIdDescarte?.value || '').trim();
    const motivo = String(campoMotivoDescarte?.value || '').trim();

    try {
      if (!monitorId) {
        throw new Error('No se pudo identificar la alerta activa.');
      }

      if (!motivo) {
        throw new Error('El motivo de la inhibición es obligatorio.');
      }

      if (motivo.length > 512) {
        throw new Error('El motivo de la inhibición no puede superar 512 caracteres.');
      }

      const hastaUtc = normalizarHastaUtcFormulario(campoHastaDescarte?.value || '');
      const textoOriginal = botonEnviarDescarte?.textContent || '';

      if (botonEnviarDescarte) {
        botonEnviarDescarte.disabled = true;
        botonEnviarDescarte.textContent = 'Inhibiendo…';
      }

      try {
        await postJson(
          construirUrlAlertaActiva(urlAlertasBase, monitorId, 'descartar'),
          { motivo, hastaUtc }
        );
      } finally {
        if (botonEnviarDescarte) {
          botonEnviarDescarte.disabled = false;
          botonEnviarDescarte.textContent = textoOriginal;
        }
      }

      obtenerInstanciaModalBootstrap(modalDescarte)?.hide();
      formularioDescarte.reset();
      window.portalToast?.show?.({
        tipo: 'exito',
        titulo: 'Alerta inhibida',
        cuerpo: 'La alerta sigue activa, pero sale del foco principal.'
      });
      await refrescarDashboard({ silencioso: true });
    } catch (error) {
      window.portalToast?.show?.({
        tipo: 'error',
        titulo: 'No se pudo inhibir',
        cuerpo: error.message || 'Revisa el motivo y vuelve a intentarlo.'
      });
    }
  });
}

function abrirModalDescarteAlerta({
  boton,
  modalDescarte,
  tituloDescarte,
  campoTipoDescarte,
  campoMonitorIdDescarte,
  textoMonitorDescarte,
  campoMotivoDescarte,
  campoHastaDescarte
}) {
  const monitorId = String(boton.dataset.monitorId || '').trim();
  const monitorNombre = String(boton.dataset.monitorNombre || 'Monitor').trim();

  if (tituloDescarte) tituloDescarte.textContent = 'Inhibir alerta';
  if (campoTipoDescarte) campoTipoDescarte.value = 'local';

  if (campoMonitorIdDescarte) {
    campoMonitorIdDescarte.value = monitorId;
  }

  if (textoMonitorDescarte) {
    textoMonitorDescarte.textContent =
      `${monitorNombre} seguirá fallando y registrando actividad; solo saldrá del foco principal.`;
  }

  if (campoMotivoDescarte) {
    campoMotivoDescarte.value = '';
  }

  if (campoHastaDescarte) {
    campoHastaDescarte.value = '';
  }

  const instanciaModal = obtenerInstanciaModalBootstrap(modalDescarte);

  if (instanciaModal) {
    instanciaModal.show();
    window.setTimeout(function () {
      campoMotivoDescarte?.focus?.();
    }, 150);
    return;
  }

  window.portalToast?.show?.({
    tipo: 'error',
    titulo: 'Modal no disponible',
    cuerpo: 'No se pudo abrir el formulario de inhibición.'
  });
}

function obtenerInstanciaModalBootstrap(modalNodo) {
  if (!modalNodo || !window.bootstrap?.Modal) {
    return null;
  }

  return window.bootstrap.Modal.getOrCreateInstance
    ? window.bootstrap.Modal.getOrCreateInstance(modalNodo)
    : new window.bootstrap.Modal(modalNodo);
}

async function revertirDescarteAlertaDashboard({
  boton,
  urlAlertasBase,
  refrescarDashboard
}) {
  const monitorId = String(boton.dataset.monitorId || '').trim();
  const monitorNombre = String(boton.dataset.monitorNombre || 'Monitor').trim();

  if (!monitorId) {
    window.portalToast?.show?.({
      tipo: 'error',
      titulo: 'No se pudo reactivar',
      cuerpo: 'No se pudo identificar la alerta activa.'
    });
    return;
  }

  if (!window.confirm(`¿Reactivar la alerta de "${monitorNombre}"?`)) {
    return;
  }

  const textoOriginal = boton.textContent;

  try {
    boton.disabled = true;
    boton.textContent = 'Reactivando…';
    await postJson(
      construirUrlAlertaActiva(urlAlertasBase, monitorId, 'revertir-descarte'),
      {}
    );
    window.portalToast?.show?.({
      tipo: 'exito',
      titulo: 'Alerta reactivada',
      cuerpo: 'La alerta vuelve al foco principal.'
    });
    await refrescarDashboard({ silencioso: true });
  } catch (error) {
    window.portalToast?.show?.({
      tipo: 'error',
      titulo: 'No se pudo reactivar',
      cuerpo: error.message || 'La alerta activa pudo cambiar mientras operabas.'
    });
  } finally {
    boton.disabled = false;
    boton.textContent = textoOriginal;
  }
}

function construirUrlAlertaActiva(base, monitorId, accion) {
  return `${base.replace(/\/+$/, '')}/${encodeURIComponent(String(monitorId))}/${accion}`;
}

function normalizarHastaUtcFormulario(valor) {
  const texto = String(valor || '').trim();

  if (!texto) {
    return null;
  }

  const fecha = new Date(texto);

  if (Number.isNaN(fecha.getTime())) {
    throw new Error('La fecha de reactivación no tiene un formato válido.');
  }

  if (fecha.getTime() <= Date.now()) {
    throw new Error('La fecha de reactivación debe estar en el futuro.');
  }

  return fecha.toISOString();
}

function abrirCanalDashboard({
  urlDashboardWs,
  estado,
  estadoRefresco,
  refrescarDashboard
}) {
  const urlSocket = construirUrlWebSocket(urlDashboardWs);

  if (!urlSocket) {
    return;
  }

  const conectar = function () {
    limpiarReconexionDashboard(estado);

    try {
      estado.ws = new window.WebSocket(urlSocket);
    } catch (_error) {
      programarReconexionDashboard({
        estado,
        estadoRefresco
      });
      return;
    }

    estado.ws.addEventListener('open', function () {
      if (!estado.necesitaSincronizacionSocket) {
        return;
      }

      estado.necesitaSincronizacionSocket = false;
      void refrescarDashboard({ silencioso: true });
    });

    estado.ws.addEventListener('message', function (evento) {
      const payload = parsearMensajeDashboard(evento.data);

      if (!payload) {
        return;
      }

      if (payload.tipo === 'dashboard_actualizado') {
        const motivo =
          payload.motivoPublicacion === 'vencimiento_descarte_alerta_activa'
            ? 'Inhibición temporal finalizada. Actualizando…'
            : 'Cambio operativo detectado. Actualizando…';

        actualizarEstadoRefresco(
          estadoRefresco,
          null,
          motivo
        );
        void refrescarDashboard({ silencioso: true });
      }

      if (payload.tipo === 'avisos_plataforma_actualizados') {
        window.dispatchEvent(new CustomEvent(
          'portal:avisos-plataforma-actualizados'
        ));
      }

      if (payload.tipo === 'buzon_usuario_actualizado') {
        window.dispatchEvent(new CustomEvent(
          'portal:buzon-usuario-actualizado'
        ));
      }

      if (payload.tipo === 'alertas_remotas_actualizadas') {
        void refrescarDashboard({ silencioso: true });
      }
    });

    estado.ws.addEventListener('close', function () {
      estado.ws = null;
      estado.necesitaSincronizacionSocket = true;
      programarReconexionDashboard({
        estado,
        estadoRefresco
      });
    });

    estado.ws.addEventListener('error', function () {
      if (estado.ws) {
        estado.ws.close();
      }
    });
  };

  conectar();
}

function programarReconexionDashboard({ estado, estadoRefresco }) {
  if (estado.temporizadorReconexion) {
    return;
  }

  actualizarEstadoRefresco(
    estadoRefresco,
    null,
    'Canal en tiempo real desconectado. Reintentando...'
  );

  estado.temporizadorReconexion = window.setTimeout(function () {
    estado.temporizadorReconexion = null;
    abrirCanalDashboard({
      urlDashboardWs: estado.wsUrl || '',
      estado,
      estadoRefresco,
      refrescarDashboard: estado.refrescarDashboard
    });
  }, 3000);
}

function limpiarReconexionDashboard(estado) {
  if (!estado.temporizadorReconexion) {
    return;
  }

  window.clearTimeout(estado.temporizadorReconexion);
  estado.temporizadorReconexion = null;
}

function construirUrlWebSocket(urlRuta) {
  const ruta = String(urlRuta || '').trim();

  if (!ruta) {
    return '';
  }

  const protocolo = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

  if (ruta.startsWith('ws://') || ruta.startsWith('wss://')) {
    return ruta;
  }

  return `${protocolo}//${window.location.host}${ruta}`;
}

function parsearMensajeDashboard(bruto) {
  if (typeof bruto !== 'string' || !bruto.trim()) {
    return null;
  }

  try {
    return JSON.parse(bruto);
  } catch (_error) {
    return null;
  }
}

function renderizarHero({
  dashboard,
  heroDetalle,
  heroCardSupervision,
  heroSupervision,
  heroSupervisionDetalle,
  heroCardAlertas,
  heroAlertasVisibles,
  heroAlertasDetalle,
  heroCardDescartadas,
  heroAlertasDescartadas,
  heroCardPendientes,
  heroPendientes,
  heroDns
}) {
  const resumenMonitores = dashboard?.resumenMonitores || {};
  const resumenDns = dashboard?.resumenDns || {};
  const resumenRuntime = dashboard?.resumenRuntime || {};
  const totalAlertasVivas = Number(resumenMonitores.totalAlertasActivas || 0);
  const totalAlertasVisibles = Number(
    resumenMonitores.totalAlertasVisibles ?? resumenMonitores.totalAlertasActivas ?? 0
  );
  const totalAlertasDescartadas = Number(resumenMonitores.totalAlertasDescartadas || 0);
  const totalPendientes = Number(resumenMonitores.totalPendientes || 0);
  const habilitado = Boolean(dashboard?.habilitado);
  const totalMonitores = Number(resumenMonitores.totalMonitores || 0);
  const totalMonitoresActivos = Number(resumenMonitores.totalActivos || 0);
  const totalInstanciasRuntime = Number(resumenRuntime.totalInstanciasActivas || 0);
  const runtimeActivo = totalInstanciasRuntime > 0;
  const runtimeVerificable = resumenRuntime.disponible === true;
  const sinMonitores = totalMonitores === 0;

  if (heroDetalle) {
    heroDetalle.textContent = habilitado
      ? 'Estado actual de los monitores y sus alertas.'
      : 'Sin lectura operativa de monitores para esta sesión.';
  }

  if (heroAlertasVisibles) {
    heroAlertasVisibles.textContent = habilitado ? String(totalAlertasVisibles) : '-';
  }

  if (heroAlertasDetalle) {
    heroAlertasDetalle.textContent = habilitado
      ? describirAlertasVisibles(totalAlertasVisibles, totalAlertasVivas)
      : 'Sin lectura operativa.';
  }

  if (heroAlertasDescartadas) {
    heroAlertasDescartadas.textContent = habilitado ? String(totalAlertasDescartadas) : '-';
  }

  if (heroPendientes) {
    heroPendientes.textContent = habilitado ? String(totalPendientes) : '-';
  }

  if (heroSupervision) {
    heroSupervision.textContent = runtimeActivo
      ? (habilitado ? String(totalMonitoresActivos) : 'Sin acceso')
      : (runtimeVerificable ? 'Detenida' : 'Sin verificar');
  }

  if (heroSupervisionDetalle) {
    if (runtimeActivo && habilitado) {
      heroSupervisionDetalle.textContent =
        `${String(totalMonitoresActivos)} monitores activos de ${String(totalMonitores)} visibles · ` +
        `${String(totalInstanciasRuntime)} proceso${totalInstanciasRuntime === 1 ? '' : 's'} de supervisión.`;
    } else if (runtimeActivo) {
      heroSupervisionDetalle.textContent =
        'El motor de supervisión está activo, pero no puedes consultar los monitores.';
    } else if (!runtimeVerificable) {
      heroSupervisionDetalle.textContent =
        'No puede confirmarse si el motor está ejecutando la supervisión.';
    } else if (habilitado && totalMonitoresActivos > 0) {
      heroSupervisionDetalle.textContent =
        `${String(totalMonitoresActivos)} monitores activos no se están ejecutando.`;
    } else {
      heroSupervisionDetalle.textContent =
        'No hay ningún proceso ejecutando la supervisión.';
    }
  }

  aplicarTonoCardResumen(
    heroCardSupervision,
    runtimeActivo
      ? (habilitado && totalMonitores > 0 ? 'ok' : 'suave')
      : (runtimeVerificable ? 'alerta' : 'advertencia')
  );

  aplicarTonoCardResumen(
    heroCardAlertas,
    !habilitado || sinMonitores ? 'suave' : (totalAlertasVisibles > 0 ? 'alerta' : (totalAlertasDescartadas > 0 ? 'advertencia' : 'ok'))
  );
  aplicarTonoCardResumen(
    heroCardDescartadas,
    !habilitado || sinMonitores ? 'suave' : (totalAlertasDescartadas > 0 ? 'advertencia' : 'ok')
  );
  aplicarTonoCardResumen(
    heroCardPendientes,
    !habilitado || sinMonitores ? 'suave' : (totalPendientes > 0 ? 'advertencia' : 'ok')
  );

  if (heroDns) {
    heroDns.textContent = resumenDns?.habilitado
      ? `${String(resumenDns.totalZonas || 0)} zonas`
      : 'sin acceso';
  }
}

function describirAlertasVisibles(totalVisibles, totalVivas) {
  if (totalVisibles > 0) {
    return `${String(totalVisibles)} ${totalVisibles === 1 ? 'requiere' : 'requieren'} atención ahora.`;
  }

  if (totalVivas > 0) {
    return `Ninguna en el foco; ${String(totalVivas)} ${totalVivas === 1 ? 'permanece activa e inhibida' : 'permanecen activas e inhibidas'}.`;
  }

  return 'Ninguna requiere atención.';
}

function aplicarTonoCardResumen(nodo, tono) {
  if (!nodo) {
    return;
  }

  nodo.classList.remove(
    'resumen-card--ok',
    'resumen-card--advertencia',
    'resumen-card--alerta',
    'resumen-card--neutro',
    'resumen-card--suave'
  );
  nodo.classList.add(`resumen-card--${tono}`);
}

function renderizarVision({
  dashboard,
  visionDescripcion,
  contenedorResumen
}) {
  if (visionDescripcion) {
    visionDescripcion.textContent = dashboard?.habilitado
      ? 'Lectura agregada del estado actual de monitores dentro del alcance visible.'
      : 'Esta sesión no puede leer monitores, así que el panel operativo queda oculto.';
  }

  if (!contenedorResumen) {
    return;
  }

  if (!dashboard?.habilitado) {
    contenedorResumen.innerHTML = `
      <div class="tarjeta">
        <p class="texto-apoyo">
          El panel general sigue disponible, pero la parte operativa de monitores exige el permiso granular de lectura de monitores.
        </p>
      </div>
    `;
    return;
  }

  const resumen = dashboard.resumenMonitores || {};
  const totalProblemas =
    Number(resumen.totalIndisponiblesAlertables || 0) +
    Number(resumen.totalDegradadosAlertables || 0);
  const tonoMonitores = 'neutro';
  const tonoDisponibles = Number(resumen.totalDisponibles || 0) > 0 ? 'ok' : 'suave';
  const tonoIncidencias = totalProblemas > 0 ? 'advertencia' : 'ok';
  const tonoPendientes = Number(resumen.totalPendientes || 0) > 0 ? 'advertencia' : 'suave';
  const totalAlertasVisibles = Number(resumen.totalAlertasVisibles ?? resumen.totalAlertasActivas ?? 0);
  const totalAlertasDescartadas = Number(resumen.totalAlertasDescartadas || 0);
  const tonoAlertas = totalAlertasVisibles > 0 ? 'alerta' : (totalAlertasDescartadas > 0 ? 'advertencia' : 'ok');

  contenedorResumen.innerHTML = `
    <div class="rejilla-resumen">
      <article class="card resumen-card resumen-card--${tonoMonitores} h-100 border-0 shadow-sm">
        <div class="card-body resumen-card__body">
          <span class="etiqueta panel-etiqueta-icono"><i class="bi bi-hdd-network" aria-hidden="true"></i><span>Monitores</span></span>
          <strong>${escapeHtml(String(resumen.totalMonitores || 0))}</strong>
          <small>${escapeHtml(String(resumen.totalActivos || 0))} activos · ${escapeHtml(String(resumen.totalInactivos || 0))} inactivos</small>
        </div>
      </article>
      <article class="card resumen-card resumen-card--${tonoDisponibles} h-100 border-0 shadow-sm">
        <div class="card-body resumen-card__body">
          <span class="etiqueta panel-etiqueta-icono"><i class="bi bi-check-circle" aria-hidden="true"></i><span>Disponibles</span></span>
          <strong>${escapeHtml(String(resumen.totalDisponibles || 0))}</strong>
          <small>Con lectura operativa correcta.</small>
        </div>
      </article>
      <article class="card resumen-card resumen-card--${tonoIncidencias} h-100 border-0 shadow-sm">
        <div class="card-body resumen-card__body">
          <span class="etiqueta panel-etiqueta-icono"><i class="bi bi-exclamation-diamond" aria-hidden="true"></i><span>Con incidencia</span></span>
          <strong>${escapeHtml(String(totalProblemas))}</strong>
          <small>${escapeHtml(String(resumen.totalIndisponiblesAlertables || 0))} indisponibles · ${escapeHtml(String(resumen.totalDegradadosAlertables || 0))} degradados</small>
        </div>
      </article>
      <article class="card resumen-card resumen-card--${tonoPendientes} h-100 border-0 shadow-sm">
        <div class="card-body resumen-card__body">
          <span class="etiqueta panel-etiqueta-icono"><i class="bi bi-hourglass-split" aria-hidden="true"></i><span>Pendientes</span></span>
          <strong>${escapeHtml(String(resumen.totalPendientes || 0))}</strong>
          <small>Todavía no han completado su primera evaluación.</small>
        </div>
      </article>
      <article class="card resumen-card resumen-card--${tonoAlertas} h-100 border-0 shadow-sm">
        <div class="card-body resumen-card__body">
          <span class="etiqueta panel-etiqueta-icono"><i class="bi bi-bell-fill" aria-hidden="true"></i><span>Alertas visibles</span></span>
          <strong>${escapeHtml(String(totalAlertasVisibles))}</strong>
          <small>${escapeHtml(String(resumen.totalAlertasActivas || 0))} activas · ${escapeHtml(String(totalAlertasDescartadas))} inhibidas.</small>
        </div>
      </article>
    </div>
  `;
}

function renderizarAlertas({ dashboard, contenedorAlertas, puedeGestionarDescartes }) {
  if (!contenedorAlertas) {
    return;
  }

  const resumen = dashboard?.resumenSalud || null;
  const alertas = Array.isArray(dashboard?.alertasDestacadas)
    ? dashboard.alertasDestacadas
    : [];
  const alertasDescartadas = Array.isArray(dashboard?.alertasDescartadas)
    ? dashboard.alertasDescartadas
    : [];
  const tonoDashboard = resolverTonoClase(resumen?.tono);

  if (!dashboard?.habilitado) {
    contenedorAlertas.innerHTML = `
      <div class="tarjeta">
        <p class="texto-apoyo">La sesión no tiene permiso para inspeccionar alertas activas de monitores.</p>
      </div>
    `;
    return;
  }

  const alertaPlataforma = renderizarAlertaPlataformaRuntime(dashboard);

  const bloquePrincipal = alertas.length === 0
    ? `
      <div class="tarjeta">
        <div class="fila-monitor__etiquetas" style="margin-bottom: 12px;">
          <span class="insignia-monitor insignia-monitor--${escapeHtml(tonoDashboard)}">Sin alertas de monitores</span>
        </div>
        <p class="texto-apoyo">${escapeHtml(String(resumen?.detalle || 'No hay alertas activas visibles en este momento.'))}</p>
      </div>
    `
    : `
    <div class="table-responsive dashboard-alertas-tabla-wrap">
      <table class="table table-striped table-hover align-middle mb-0 tabla-alertas-operativas">
        <thead>
          <tr>
            <th>Monitor</th>
            <th>Estado actual</th>
            <th>Alerta activa</th>
            <th>Seguimiento</th>
            <th class="text-end">Acciones</th>
          </tr>
        </thead>
        <tbody>
          ${alertas.map((alerta) => renderizarFilaAlerta(alerta, { puedeGestionarDescartes })).join('')}
        </tbody>
      </table>
    </div>
  `;

  contenedorAlertas.innerHTML = `
    <div class="dashboard-alertas-operativas">
      ${alertaPlataforma}
      ${bloquePrincipal}
      ${renderizarAlertasDescartadas(alertasDescartadas, { puedeGestionarDescartes })}
    </div>
  `;
}

function renderizarAlertaPlataformaRuntime(dashboard) {
  const resumenRuntime = dashboard?.resumenRuntime || {};
  const resumenMonitores = dashboard?.resumenMonitores || {};
  const totalInstanciasRuntime = Number(resumenRuntime.totalInstanciasActivas || 0);

  if (totalInstanciasRuntime > 0) {
    return '';
  }

  const runtimeVerificable = resumenRuntime.disponible === true;
  const totalMonitoresActivos = Number(resumenMonitores.totalActivos || 0);
  const etiquetaEstado = runtimeVerificable ? 'Supervisión detenida' : 'Estado no verificable';
  const titulo = runtimeVerificable
    ? 'El motor de supervisión está detenido'
    : 'No se puede verificar el motor de supervisión';

  let detalle;
  if (runtimeVerificable && totalMonitoresActivos > 0) {
    detalle =
      `Hay <strong>${escapeHtml(String(totalMonitoresActivos))} monitores activos</strong> configurados, ` +
      'pero el proceso que debe evaluarlos no está funcionando.';
  } else if (runtimeVerificable) {
    detalle =
      'No hay ningún proceso ejecutando la supervisión. ' +
      'Los monitores no se evaluarán hasta que el motor vuelva a arrancar.';
  } else if (totalMonitoresActivos > 0) {
    detalle =
      `No puede confirmarse que los <strong>${escapeHtml(String(totalMonitoresActivos))} monitores activos</strong> ` +
      'se estén evaluando.';
  } else {
    detalle =
      'No puede confirmarse que el motor de supervisión esté funcionando.';
  }

  return `
    <article class="dashboard-alerta-plataforma" role="alert">
      <span class="dashboard-alerta-plataforma__icono" aria-hidden="true"><i class="bi bi-cpu"></i></span>
      <div class="dashboard-alerta-plataforma__contenido">
        <div class="fila-monitor__etiquetas">
          <span class="insignia-monitor insignia-monitor--alerta">Plataforma</span>
          <span class="insignia-monitor insignia-monitor--suave">${escapeHtml(etiquetaEstado)}</span>
        </div>
        <h3>${escapeHtml(titulo)}</h3>
        <p>${detalle}</p>
      </div>
    </article>
  `;
}

function configurarGestionAlertasRemotas({
  contenedor,
  refrescarDashboard,
  modalDescarte,
  formularioDescarte,
  tituloDescarte,
  campoTipoDescarte,
  campoProyeccionIdDescarte,
  campoAlertaIdDescarte,
  textoMonitorDescarte,
  campoMotivoDescarte,
  campoHastaDescarte,
  botonEnviarDescarte
}) {
  if (!contenedor) return;
  // Los menús responsive pueden estar temporalmente portalizados bajo document.body.
  document.addEventListener('click', async function (evento) {
    const objetivo = evento.target instanceof Element ? evento.target : null;
    const descartar = objetivo?.closest('[data-dashboard-descartar-alerta-remota]');
    const revertir = objetivo?.closest('[data-dashboard-revertir-alerta-remota]');
    const boton = descartar || revertir;
    if (!boton) return;
    const proyeccionId = boton.dataset.proyeccionId;
    const alertaId = boton.dataset.alertaId;
    if (!proyeccionId || !alertaId) return;
    if (descartar) {
      evento.preventDefault();
      abrirModalDescarteAlertaRemota({
        boton,
        modalDescarte,
        tituloDescarte,
        campoTipoDescarte,
        campoProyeccionIdDescarte,
        campoAlertaIdDescarte,
        textoMonitorDescarte,
        campoMotivoDescarte,
        campoHastaDescarte
      });
      return;
    }
    boton.disabled = true;
    try {
      const respuesta = await fetch(
        construirUrlAlertaRemota(proyeccionId, alertaId, 'revertir'),
        { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({}) }
      );
      const payload = await respuesta.json().catch(() => ({}));
      if (!respuesta.ok) throw new Error(payload.mensaje || 'No se pudo reactivar la alerta remota.');
      await refrescarDashboard({ silencioso: true });
    } catch (error) {
      window.portalToast?.show?.({ tipo: 'error', titulo: 'Alerta remota no actualizada', cuerpo: error.message });
    } finally { boton.disabled = false; }
  });

  formularioDescarte?.addEventListener('submit', async function (evento) {
    if (String(campoTipoDescarte?.value || '') !== 'remota') return;
    evento.preventDefault();
    const proyeccionId = String(campoProyeccionIdDescarte?.value || '').trim();
    const alertaId = String(campoAlertaIdDescarte?.value || '').trim();
    const motivo = String(campoMotivoDescarte?.value || '').trim();
    try {
      if (!proyeccionId || !alertaId) {
        throw new Error('No se pudo identificar la alerta remota.');
      }
      if (!motivo) throw new Error('El motivo de la inhibición es obligatorio.');
      if (motivo.length > 512) {
        throw new Error('El motivo de la inhibición no puede superar 512 caracteres.');
      }
      const hastaUtc = normalizarHastaUtcFormulario(campoHastaDescarte?.value || '');
      const textoOriginal = botonEnviarDescarte?.textContent || '';
      if (botonEnviarDescarte) {
        botonEnviarDescarte.disabled = true;
        botonEnviarDescarte.textContent = 'Inhibiendo…';
      }
      try {
        await postJson(
          construirUrlAlertaRemota(proyeccionId, alertaId, 'descartar'),
          { motivo, hastaUtc }
        );
      } finally {
        if (botonEnviarDescarte) {
          botonEnviarDescarte.disabled = false;
          botonEnviarDescarte.textContent = textoOriginal;
        }
      }
      obtenerInstanciaModalBootstrap(modalDescarte)?.hide();
      formularioDescarte.reset();
      window.portalToast?.show?.({
        tipo: 'exito',
        titulo: 'Alerta remota inhibida',
        cuerpo: 'La alerta de origen no se modifica; solo sale de tu foco principal.'
      });
      await refrescarDashboard({ silencioso: true });
    } catch (error) {
      window.portalToast?.show?.({
        tipo: 'error',
        titulo: 'No se pudo inhibir la alerta remota',
        cuerpo: error.message || 'Revisa el motivo y vuelve a intentarlo.'
      });
    }
  });
}

function abrirModalDescarteAlertaRemota({
  boton,
  modalDescarte,
  tituloDescarte,
  campoTipoDescarte,
  campoProyeccionIdDescarte,
  campoAlertaIdDescarte,
  textoMonitorDescarte,
  campoMotivoDescarte,
  campoHastaDescarte
}) {
  const monitorNombre = String(boton.dataset.monitorNombre || 'Monitor remoto').trim();
  const installationNombre = String(
    boton.dataset.installationNombre || 'la instalación remota'
  ).trim();
  if (tituloDescarte) tituloDescarte.textContent = 'Inhibir alerta remota';
  if (campoTipoDescarte) campoTipoDescarte.value = 'remota';
  if (campoProyeccionIdDescarte) {
    campoProyeccionIdDescarte.value = String(boton.dataset.proyeccionId || '').trim();
  }
  if (campoAlertaIdDescarte) {
    campoAlertaIdDescarte.value = String(boton.dataset.alertaId || '').trim();
  }
  if (textoMonitorDescarte) {
    textoMonitorDescarte.textContent =
      `${monitorNombre}, declarada por ${installationNombre}, no se modificará; ` +
      'solo saldrá de tu foco principal.';
  }
  if (campoMotivoDescarte) campoMotivoDescarte.value = '';
  if (campoHastaDescarte) campoHastaDescarte.value = '';
  const instanciaModal = obtenerInstanciaModalBootstrap(modalDescarte);
  if (instanciaModal) {
    instanciaModal.show();
    window.setTimeout(function () { campoMotivoDescarte?.focus?.(); }, 150);
    return;
  }
  window.portalToast?.show?.({
    tipo: 'error', titulo: 'Modal no disponible',
    cuerpo: 'No se pudo abrir el formulario de inhibición remota.'
  });
}

function construirUrlAlertaRemota(proyeccionId, alertaId, accion) {
  return `/panel/api/alertas-remotas/${encodeURIComponent(proyeccionId)}/` +
    `${encodeURIComponent(alertaId)}/${accion}`;
}

function renderizarAlertasRemotas(datos, contenedor) {
  if (!contenedor || !datos?.permiso) return;
  if (!datos.preferencia) {
    contenedor.innerHTML = `<div class="tarjeta"><p class="texto-apoyo mb-2">Tienes permiso de consulta, pero estas alertas no se incluyen en el resumen principal según tu preferencia personal.</p><a href="/mi-perfil" class="btn btn-outline-secondary btn-sm">Configurar en mi perfil</a></div>`;
    return;
  }
  const visibles = Array.isArray(datos.alertasVisibles) ? datos.alertasVisibles : [];
  const descartadas = Array.isArray(datos.alertasDescartadas) ? datos.alertasDescartadas : [];
  const sinVigencia = Array.isArray(datos.alertasSinVigencia)
    ? datos.alertasSinVigencia
    : [];
  const puedeGestionarDescartes = datos.puedeGestionarDescartes === true;
  const principal = visibles.length === 0
    ? '<div class="tarjeta"><p class="texto-apoyo mb-0">No hay alertas remotas activas visibles dentro de tu alcance.</p></div>'
    : `<div class="dashboard-alertas-remotas-grid">${visibles.map((alerta) =>
      renderizarAlertaRemota(alerta, { puedeGestionarDescartes })).join('')}</div>`;
  const secundarios = descartadas;
  const bloqueDescartadas = secundarios.length === 0 ? '' : `
    <details class="dashboard-alertas-descartadas mt-3">
      <summary class="dashboard-alertas-descartadas__cabecera"><strong>Alertas remotas inhibidas</strong><span>${secundarios.length}</span></summary>
      <div class="dashboard-alertas-remotas-grid mt-2">${secundarios.map((alerta) =>
        renderizarAlertaRemota(alerta, { puedeGestionarDescartes })).join('')}</div>
    </details>`;
  const bloqueSinVigencia = sinVigencia.length === 0 ? '' : `
    <details class="dashboard-alertas-descartadas mt-3">
      <summary class="dashboard-alertas-descartadas__cabecera"><strong>Alertas remotas con información caducada</strong><span>${sinVigencia.length}</span></summary>
      <p class="texto-apoyo mt-2 mb-2">La instalación de origen no comunicó el cierre y hace demasiado tiempo que no confirma estas alertas.</p>
      <div class="dashboard-alertas-remotas-grid">${sinVigencia.map((alerta) =>
        renderizarAlertaRemota(alerta, { puedeGestionarDescartes: false })).join('')}</div>
    </details>`;
  contenedor.innerHTML = principal + bloqueDescartadas + bloqueSinVigencia;
  window.portalFechas?.hidratar?.();
}

function renderizarAlertaRemota(alerta, { puedeGestionarDescartes }) {
  const estado = String(alerta.estadoPresentacion || 'vigenciaAgotada');
  const activa = estado === 'activaEnOrigen';
  const descartada = alerta.descarteLocal?.vigente === true;
  const urlMonitor = construirUrlMonitorRemotoDashboard(alerta);
  const accionGestion = !puedeGestionarDescartes
    ? ''
    : descartada
      ? `<button type="button" class="dropdown-item d-flex align-items-center gap-2" data-dashboard-revertir-alerta-remota data-proyeccion-id="${escapeHtml(alerta.proyeccionId)}" data-alerta-id="${escapeHtml(alerta.alertaAuditoriaId)}"><i class="bi bi-arrow-counterclockwise" aria-hidden="true"></i><span>Reactivar…</span></button>`
      : estado !== 'activaEnOrigen'
        ? ''
        : `<button type="button" class="dropdown-item dropdown-item--warning d-flex align-items-center gap-2" data-dashboard-descartar-alerta-remota data-proyeccion-id="${escapeHtml(alerta.proyeccionId)}" data-alerta-id="${escapeHtml(alerta.alertaAuditoriaId)}" data-monitor-nombre="${escapeHtml(alerta.monitorNombre || 'Monitor remoto')}" data-installation-nombre="${escapeHtml(alerta.installationNombre || alerta.installationOrigenId || 'la instalación remota')}"><i class="bi bi-bell-slash" aria-hidden="true"></i><span>Inhibir…</span></button>`;
  const acciones = `<div class="dropdown dashboard-alerta-remota__acciones">
    <button type="button" class="btn btn-outline-secondary btn-sm tabla-acciones__toggle" data-bs-toggle="dropdown" aria-expanded="false" aria-label="Acciones de la alerta remota de ${escapeHtml(alerta.monitorNombre || 'Monitor remoto')}"><i class="bi bi-gear" aria-hidden="true"></i></button>
    <div class="dropdown-menu dropdown-menu-end tabla-acciones__menu">
      <a href="${urlMonitor}" class="dropdown-item d-flex align-items-center gap-2"><i class="bi bi-eye" aria-hidden="true"></i><span>Ver monitor</span></a>
      ${accionGestion}
    </div>
  </div>`;
  return `<article class="tarjeta dashboard-alerta-remota dashboard-alerta-remota--${escapeHtml(estado)}">
    <div class="fila-monitor__etiquetas"><span class="insignia-monitor insignia-monitor--alerta">Remota</span><span class="insignia-monitor insignia-monitor--${activa && !descartada ? 'alerta' : 'advertencia'}">${escapeHtml(etiquetaEstadoAlertaRemota(alerta))}</span></div>
    <h3>${escapeHtml(alerta.monitorNombre || 'Monitor remoto')}</h3>
    <p>${escapeHtml(alerta.payload?.mensajeUltimoResultado || alerta.payload?.estadoDetectado || 'Sin detalle operativo.')}</p>
    <div class="metadatos-configuracion">
      <span>Instalación: <code>${escapeHtml(alerta.installationNombre || alerta.installationOrigenId)}</code></span>
      <span>Alcance: <code>${escapeHtml(etiquetaAlcanceRemoto(alerta.scope?.nivel))}</code></span>
      <span>Última confirmación: <code><time data-fecha-utc="${escapeHtml(alerta.frescura?.ultimaConfirmacionUtc || '')}">${escapeHtml(alerta.frescura?.ultimaConfirmacionUtc || '-')}</time></code></span>
    </div>${descartada ? `<p class="texto-apoyo">Motivo de la inhibición local: ${escapeHtml(alerta.descarteLocal.motivo || '')}</p>` : ''}${acciones}</article>`;
}

function construirUrlMonitorRemotoDashboard(alerta) {
  const parametros = new URLSearchParams({
    procedencia: String(alerta?.installationOrigenId || ''),
    vista: 'monitores',
    subvista: 'estado',
    monitor: String(alerta?.monitorOrigenId || '')
  });
  return `/federacion/datos-remotos?${parametros.toString()}`;
}

function renderizarFilaAlerta(alerta, { puedeGestionarDescartes }) {
  const tonoAlerta = resolverTonoClase(alerta?.resumenHumano?.tono);
  const destino = `${escapeHtml(
    String(alerta?.protocolo?.host || alerta?.destinoPrincipal || '-')
  )}${alerta?.protocolo?.puerto ? `:${escapeHtml(String(alerta.protocolo.puerto))}` : ''}`;
  const empresa = escapeHtml(String(alerta?.empresaNombre || '-'));
  const sitio = alerta?.sitioNombre
    ? ` · ${escapeHtml(String(alerta.sitioNombre))}`
    : '';
  const detalle = escapeHtml(
    String(alerta?.resumenHumano?.detalle || alerta?.mensajeUltimoResultado || 'Sin detalle operativo adicional.')
  );
  const urlMonitor = `/monitores/${encodeURIComponent(String(alerta.monitorId || ''))}?return_to=${encodeURIComponent('/panel')}`;
  const botonDescarte = puedeGestionarDescartes
    ? `
      <button
        type="button"
        class="dropdown-item dropdown-item--warning d-flex align-items-center gap-2"
        data-dashboard-descartar-alerta
        data-monitor-id="${escapeHtml(String(alerta?.monitorId || ''))}"
        data-monitor-nombre="${escapeHtml(String(alerta?.monitorNombre || 'Monitor'))}"
      ><i class="bi bi-bell-slash" aria-hidden="true"></i><span>Inhibir…</span></button>
    `
    : '';
  const causalidad = renderizarCausalidadFederada(alerta);
  const insigniaFederada = alerta?.causalidadFederada?.contieneEntradasFederadas
    ? '<span class="insignia-monitor insignia-monitor--federada">Datos de otra instalación</span>'
    : '';

  return `
    <tr>
      <td>
        <div class="d-grid gap-2">
          <strong>${escapeHtml(String(alerta?.monitorNombre || 'Monitor'))}</strong>
          <div class="fila-monitor__etiquetas">
            <span class="insignia-monitor insignia-monitor--${escapeHtml(String(alerta?.tipoMonitor || 'base'))}">${escapeHtml(String(alerta?.tipoMonitor || '').toUpperCase())}</span>
            <span class="insignia-monitor insignia-monitor--suave">#${escapeHtml(String(alerta?.monitorId || ''))}</span>
            <span class="insignia-monitor ${alerta?.monitorActivo ? 'insignia-monitor--ok' : 'insignia-monitor--off'}">${alerta?.monitorActivo ? 'Monitor activo' : 'Monitor inactivo'}</span>
            ${insigniaFederada}
          </div>
          <span class="etiqueta-secundaria">${empresa}${sitio}</span>
        </div>
      </td>
      <td>
        <div class="d-grid gap-2">
          <span class="insignia-monitor insignia-monitor--${escapeHtml(tonoAlerta)}">${escapeHtml(String(alerta?.resumenHumano?.etiquetaEstado || alerta?.estadoDetectado || 'alerta'))}</span>
          <span class="etiqueta-secundaria">${detalle}</span>
        </div>
      </td>
      <td>
        <div class="metadatos-configuracion">
          <span>Visibilidad: <code>visible en el foco principal</code></span>
          <span>Destino: <code>${destino}</code></span>
          <span>Resultado: <code>${escapeHtml(String(alerta?.codigoUltimoResultado || 'sin_resultado'))}</code></span>
        </div>
        ${causalidad}
      </td>
      <td>
        <div class="metadatos-configuracion">
          <span>Repeticiones: <code>${escapeHtml(String(alerta?.contadorRepeticiones || 0))}</code></span>
          <span>Desde: <code><time data-fecha-utc="${escapeHtml(String(alerta?.validoDesdeUtc || ''))}">${escapeHtml(String(alerta?.validoDesdeUtc || ''))}</time></code></span>
          <span>Última confirmación: <code><time data-fecha-utc="${escapeHtml(String(alerta?.ultimaConfirmacionUtc || ''))}">${escapeHtml(String(alerta?.ultimaConfirmacionUtc || ''))}</time></code></span>
          <span>Última ejecución: <code><time data-fecha-utc="${escapeHtml(String(alerta?.ultimaEjecucionUtc || ''))}">${escapeHtml(String(alerta?.ultimaEjecucionUtc || ''))}</time></code></span>
        </div>
      </td>
      <td class="text-end">
        <div class="dropup tabla-acciones">
          <button
            type="button"
            class="btn btn-outline-secondary btn-sm tabla-acciones__toggle"
            data-bs-toggle="dropdown"
            aria-expanded="false"
            aria-label="Acciones de la alerta de ${escapeHtml(String(alerta?.monitorNombre || 'Monitor'))}"
          ><i class="bi bi-gear" aria-hidden="true"></i></button>
          <div class="dropdown-menu dropdown-menu-end tabla-acciones__menu">
            <a href="${urlMonitor}" class="dropdown-item d-flex align-items-center gap-2"><i class="bi bi-eye" aria-hidden="true"></i><span>Ver monitor</span></a>
            ${botonDescarte}
          </div>
        </div>
      </td>
    </tr>
  `;
}

function renderizarAlertasDescartadas(alertasDescartadas, { puedeGestionarDescartes }) {
  if (!alertasDescartadas.length) {
    return '';
  }

  return `
    <details class="dashboard-alertas-descartadas">
      <summary class="dashboard-alertas-descartadas__cabecera">
        <div>
          <span class="etiqueta panel-etiqueta-icono"><i class="bi bi-bell-slash" aria-hidden="true"></i><span>Alertas inhibidas</span></span>
          <p class="texto-apoyo mb-0">Siguen activas y registrando actividad, pero no aparecen en el foco principal hasta que finalice o se revierta la inhibición.</p>
        </div>
        <span class="dashboard-alertas-descartadas__acciones">
          <span class="insignia-monitor insignia-monitor--advertencia">${escapeHtml(String(alertasDescartadas.length))} inhibidas</span>
          <span class="dashboard-alertas-descartadas__chevron" aria-hidden="true"><i class="bi bi-chevron-down"></i></span>
        </span>
      </summary>
      <div class="dashboard-alertas-descartadas__lista">
        ${alertasDescartadas.map((alerta) => renderizarAlertaDescartada(alerta, { puedeGestionarDescartes })).join('')}
      </div>
    </details>
  `;
}

function renderizarAlertaDescartada(alerta, { puedeGestionarDescartes }) {
  const descarte = alerta?.descarteOperativo || {};
  const urlMonitor = `/monitores/${encodeURIComponent(String(alerta?.monitorId || ''))}?return_to=${encodeURIComponent('/panel')}`;
  const botonRevertir = puedeGestionarDescartes
    ? `
      <button
        type="button"
        class="dropdown-item d-flex align-items-center gap-2"
        data-dashboard-revertir-descarte
        data-monitor-id="${escapeHtml(String(alerta?.monitorId || ''))}"
        data-monitor-nombre="${escapeHtml(String(alerta?.monitorNombre || 'Monitor'))}"
      ><i class="bi bi-arrow-counterclockwise" aria-hidden="true"></i><span>Reactivar…</span></button>
    `
    : '';
  const hasta = descarte?.descartadaHastaUtc
    ? `<time data-fecha-utc="${escapeHtml(String(descarte.descartadaHastaUtc))}">${escapeHtml(String(descarte.descartadaHastaUtc))}</time>`
    : 'indefinido';
  const usuarioDescarte = renderizarUsuarioDescarte(descarte);
  const causalidad = renderizarCausalidadFederada(alerta);
  const insigniaFederada = alerta?.causalidadFederada?.contieneEntradasFederadas
    ? '<span class="insignia-monitor insignia-monitor--federada">Datos de otra instalación</span>'
    : '';

  return `
    <article class="alerta-descartada-card">
      <div class="alerta-descartada-card__principal">
        <div class="d-grid gap-2">
          <strong>${escapeHtml(String(alerta?.monitorNombre || 'Monitor'))}</strong>
          <div class="fila-monitor__etiquetas">
            <span class="insignia-monitor insignia-monitor--${escapeHtml(String(alerta?.tipoMonitor || 'base'))}">${escapeHtml(String(alerta?.tipoMonitor || '').toUpperCase())}</span>
            <span class="insignia-monitor insignia-monitor--suave">#${escapeHtml(String(alerta?.monitorId || ''))}</span>
            <span class="insignia-monitor insignia-monitor--advertencia">Inhibida</span>
            ${insigniaFederada}
          </div>
        </div>
        <p class="dashboard-descarte-motivo">${escapeHtml(String(descarte?.motivo || 'Sin motivo informado.'))}</p>
        <div class="dashboard-descarte-meta">
          <span>Desde: <code><time data-fecha-utc="${escapeHtml(String(descarte?.descartadaEnUtc || ''))}">${escapeHtml(String(descarte?.descartadaEnUtc || '-'))}</time></code></span>
          <span>Hasta: <code>${hasta}</code></span>
          <span>Usuario: ${usuarioDescarte}</span>
        </div>
        ${causalidad}
      </div>
      <div class="alerta-descartada-card__acciones">
        <div class="dropup tabla-acciones tabla-acciones--auto">
          <button
            type="button"
            class="btn btn-outline-secondary btn-sm tabla-acciones__toggle"
            data-bs-toggle="dropdown"
            aria-expanded="false"
            aria-label="Acciones de la alerta inhibida de ${escapeHtml(String(alerta?.monitorNombre || 'Monitor'))}"
          ><i class="bi bi-gear" aria-hidden="true"></i></button>
          <div class="dropdown-menu dropdown-menu-end tabla-acciones__menu">
            <a href="${urlMonitor}" class="dropdown-item d-flex align-items-center gap-2"><i class="bi bi-eye" aria-hidden="true"></i><span>Ver monitor</span></a>
            ${botonRevertir}
          </div>
        </div>
      </div>
    </article>
  `;
}

function renderizarCausalidadFederada(alerta) {
  const causalidad = alerta?.causalidadFederada;
  if (!causalidad?.contieneEntradasFederadas) return '';
  const entradas = Array.isArray(causalidad.entradas) ? causalidad.entradas : [];
  return `<details class="dashboard-causalidad-federada mt-2">
    <summary>Ver origen de los datos (${escapeHtml(String(causalidad.totalEntradas || entradas.length))})</summary>
    <ul class="mt-2 mb-0">${entradas.map((entrada) => {
      const variable = escapeHtml(String(entrada?.variable || '?'));
      const destino = entrada?.visibilidad === 'visible' && entrada?.urlProyeccionRemota
        ? `<a href="${escapeHtml(String(entrada.urlProyeccionRemota))}">ver monitor de origen</a>`
        : '<span>origen no disponible con tu alcance actual</span>';
      return `<li>Dato <code>${variable}</code> · ${destino}</li>`;
    }).join('')}</ul>
  </details>`;
}

function etiquetaEstadoAlertaRemota(alerta) {
  if (alerta?.descarteLocal?.vigente === true) return 'Inhibida localmente';
  if (alerta?.estadoPresentacion === 'activaEnOrigen') return 'Activa en origen';
  if (alerta?.estadoPresentacion === 'vigenciaAgotada') return 'Información caducada';
  return 'Estado no disponible';
}

function etiquetaAlcanceRemoto(nivel) {
  return {
    portal: 'Portal completo',
    tenant: 'Tenant',
    empresa: 'Empresa',
    sitio: 'Sitio'
  }[String(nivel || '').trim()] || 'No indicado';
}

function renderizarUsuarioDescarte(descarte) {
  const usuario = descarte?.usuario || null;
  const nombreVisible = String(usuario?.nombreVisible || usuario?.usuario || '')
    .trim();
  const login = String(usuario?.usuario || '').trim();

  if (nombreVisible) {
    const loginSecundario =
      login && login !== nombreVisible
        ? ` <code>@${escapeHtml(login)}</code>`
        : '';

    return `<strong>${escapeHtml(nombreVisible)}</strong>${loginSecundario}`;
  }

  if (descarte?.usuarioId) {
    return `<span class="text-body-secondary">Usuario #${escapeHtml(String(descarte.usuarioId))}</span>`;
  }

  return '<span class="text-body-secondary">No informado</span>';
}

function actualizarEstadoRefresco(nodo, fechaUtc, mensaje) {
  if (!nodo) {
    return;
  }

  if (fechaUtc) {
    nodo.innerHTML = `Actualizado <time data-fecha-utc="${escapeHtml(String(fechaUtc))}">${escapeHtml(String(fechaUtc))}</time>`;
    return;
  }

  nodo.textContent = String(mensaje || 'Sin lectura operativa disponible.');
}

async function fetchJson(url) {
  const respuesta = await fetch(url, {
    headers: {
      Accept: 'application/json'
    }
  });

  if (!respuesta.ok) {
    throw new Error('La actualización del panel no ha podido completarse.');
  }

  return respuesta.json();
}

async function postJson(url, cuerpo) {
  const respuesta = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest'
    },
    body: JSON.stringify(cuerpo || {})
  });
  const payload = await leerRespuestaJsonSegura(respuesta);

  if (!respuesta.ok) {
    throw new Error(
      payload?.error ||
      payload?.mensaje ||
      'La operación sobre la alerta activa no ha podido completarse.'
    );
  }

  return payload;
}

async function leerRespuestaJsonSegura(respuesta) {
  try {
    return await respuesta.json();
  } catch (_error) {
    return null;
  }
}

function resolverTonoClase(tono) {
  const normalizado = String(tono || '').trim().toLowerCase();

  if (normalizado === 'ok') {
    return 'ok';
  }

  if (normalizado === 'advertencia') {
    return 'advertencia';
  }

  if (normalizado === 'pendiente') {
    return 'suave';
  }

  return 'alerta';
}

function escapeHtml(texto) {
  return String(texto)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
