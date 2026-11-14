(function () {
  const modulo = document.querySelector('[data-eventos-monitor-shell]');

  if (!modulo) {
    return;
  }

  const urlEventos = modulo.dataset.urlEventos || '';
  const urlOpcionesMonitores = modulo.dataset.urlOpcionesMonitores || '';
  const inputDesde = modulo.querySelector('[data-eventos-desde]');
  const inputHasta = modulo.querySelector('[data-eventos-hasta]');
  const selectorMonitor = modulo.querySelector('[data-eventos-monitor]');
  const mensajeSinMonitor = modulo.querySelector('[data-eventos-sin-monitor]');
  const resultados = modulo.querySelector('[data-eventos-resultados]');
  const selectorTipo = modulo.querySelector('[data-eventos-tipo]');
  const selectorEstado = modulo.querySelector('[data-eventos-estado]');
  const inputCodigo = modulo.querySelector('[data-eventos-codigo]');
  const selectorLimite = modulo.querySelector('[data-eventos-limite]');
  const selectorOrden = modulo.querySelector('[data-eventos-orden]');
  const botonAplicar = modulo.querySelector('[data-eventos-aplicar]');
  const botonLimpiar = modulo.querySelector('[data-eventos-limpiar]');
  const botonesPreseleccion = Array.from(
    modulo.querySelectorAll('[data-eventos-preseleccion]')
  );
  const etiquetaCarga = modulo.querySelector('[data-eventos-estado-carga]');
  const enlaceVerMonitor = modulo.querySelector('[data-eventos-ver-monitor]');
  const descripcionGrafico = modulo.querySelector('[data-eventos-grafico-descripcion]');
  const etiquetaTotal = modulo.querySelector('[data-eventos-total]');
  const etiquetaCargados = modulo.querySelector('[data-eventos-cargados]');
  const etiquetaTotalDetalle = modulo.querySelector('[data-eventos-total-detalle]');
  const etiquetaExitosos = modulo.querySelector('[data-eventos-exitosos]');
  const etiquetaFallidos = modulo.querySelector('[data-eventos-fallidos]');
  const masFiltros = modulo.querySelector('[data-eventos-mas-filtros]');
  const etiquetaHeroRango = document.querySelector('[data-eventos-hero-rango]');
  const detalle = modulo.querySelector('[data-eventos-detalle]');
  const canvas = modulo.querySelector('[data-eventos-canvas]');
  const ChartGlobal = window.Chart;
  let chart = null;
  let numeroConsulta = 0;
  let numeroDetalleIntervalo = 0;
  let temporizadorDetalleIntervalo = null;
  let intervaloActivo = null;
  const cacheIntervalos = new Map();
  let monitorSolicitadoInicial = new URL(window.location.href).searchParams.get('monitor_id') || '';
  const pluginVelas = {
    id: 'velasEventosMonitor',
    beforeDatasetsDraw(grafica) {
      const dataset = grafica.data.datasets[0];
      if (!Array.isArray(dataset?.rangos) || dataset.rangos.length === 0) return;
      const puntos = grafica.getDatasetMeta(0).data;
      const ejeY = grafica.scales.y;
      const contexto = grafica.ctx;
      const anchura = Math.max(3, Math.min(13, grafica.chartArea.width / Math.max(30, puntos.length * 1.7)));
      contexto.save();
      dataset.rangos.forEach((vela, indice) => {
        const elemento = puntos[indice];
        if (!elemento) return;
        const fallo = vela.fallos > 0;
        const color = fallo ? 'rgba(193, 99, 99, 0.9)'
          : vela.cierre <= vela.apertura ? 'rgba(79, 149, 105, 0.9)'
          : 'rgba(128, 156, 184, 0.9)';
        const aperturaY = ejeY.getPixelForValue(vela.apertura);
        const cierreY = ejeY.getPixelForValue(vela.cierre);
        contexto.strokeStyle = color;
        contexto.fillStyle = color;
        contexto.lineWidth = fallo ? 2 : 1.3;
        contexto.beginPath();
        contexto.moveTo(elemento.x, ejeY.getPixelForValue(vela.minimo));
        contexto.lineTo(elemento.x, ejeY.getPixelForValue(vela.maximo));
        contexto.stroke();
        contexto.fillRect(elemento.x - anchura / 2, Math.min(aperturaY, cierreY), anchura, Math.max(3, Math.abs(cierreY - aperturaY)));
        if (fallo) {
          contexto.fillStyle = '#f0b84e';
          contexto.beginPath();
          contexto.arc(elemento.x, Math.max(grafica.chartArea.top + 6, ejeY.getPixelForValue(vela.maximo) - 6), 3, 0, Math.PI * 2);
          contexto.fill();
        }
      });
      contexto.restore();
    }
  };

  if (!ChartGlobal || !canvas || !urlEventos) {
    etiquetaCarga.textContent = 'No se pudo inicializar el visor.';
    return;
  }

  const estadoInicial = {
    desde: inputDesde?.value || '',
    hasta: inputHasta?.value || '',
    monitorId: selectorMonitor?.value || '',
    tipo: selectorTipo?.value || '',
    estado: selectorEstado?.value || '',
    codigoResultado: inputCodigo?.value || '',
    limite: selectorLimite?.value || '500',
    orden: selectorOrden?.value || 'asc'
  };

  aplicarQueryEnFormulario();
  inicializarGrafico();
  void cargarOpcionesMonitores()
    .then(() => cargarEventos())
    .catch((error) => {
      manejarError(error);
    });

  botonAplicar?.addEventListener('click', function () {
    void cargarEventos();
  });

  selectorMonitor?.addEventListener('change', function () {
    void cargarEventos();
  });

  botonLimpiar?.addEventListener('click', function () {
    if (inputDesde) {
      inputDesde.value = estadoInicial.desde;
    }

    if (inputHasta) {
      inputHasta.value = estadoInicial.hasta;
    }

    if (selectorMonitor) {
      selectorMonitor.value = '';
    }

    if (selectorTipo) {
      selectorTipo.value = '';
    }

    if (selectorEstado) {
      selectorEstado.value = '';
    }

    if (inputCodigo) {
      inputCodigo.value = '';
    }

    if (selectorLimite) {
      selectorLimite.value = estadoInicial.limite;
    }

    if (selectorOrden) {
      selectorOrden.value = estadoInicial.orden;
    }

    void cargarOpcionesMonitores()
      .then(() => cargarEventos())
      .catch((error) => manejarError(error));
  });

  for (const boton of botonesPreseleccion) {
    boton.addEventListener('click', function () {
      aplicarPreseleccion(String(boton.dataset.eventosPreseleccion || '7d'));
      void cargarEventos();
    });
  }

  selectorTipo?.addEventListener('change', function () {
    void cargarOpcionesMonitores().catch((error) => manejarError(error));
  });

  function aplicarQueryEnFormulario() {
    const url = new URL(window.location.href);

    aplicarValorInput(inputDesde, url.searchParams.get('desde'));
    aplicarValorInput(inputHasta, url.searchParams.get('hasta'));
    aplicarValorInput(selectorMonitor, url.searchParams.get('monitor_id'));
    aplicarValorInput(selectorTipo, url.searchParams.get('tipo'));
    aplicarValorInput(selectorEstado, url.searchParams.get('estado'));
    aplicarValorInput(inputCodigo, url.searchParams.get('codigo_resultado'));
    aplicarValorInput(selectorLimite, url.searchParams.get('limite'));
    aplicarValorInput(selectorOrden, url.searchParams.get('orden'));
    if (masFiltros && (
      url.searchParams.has('tipo') ||
      url.searchParams.has('codigo_resultado') ||
      (url.searchParams.has('limite') && url.searchParams.get('limite') !== '500') ||
      (url.searchParams.has('orden') && url.searchParams.get('orden') !== 'asc')
    )) {
      masFiltros.open = true;
    }
  }

  async function cargarOpcionesMonitores() {
    if (!urlOpcionesMonitores || !selectorMonitor) {
      return;
    }

    const monitorSeleccionado = selectorMonitor.value || monitorSolicitadoInicial;
    const tipo = selectorTipo?.value || '';
    const parametros = new URLSearchParams();

    if (tipo) {
      parametros.set('tipo', tipo);
    }

    const respuesta = await fetchJson(
      `${urlOpcionesMonitores}?${parametros.toString()}`
    );
    const opciones = Array.isArray(respuesta.opciones) ? respuesta.opciones : [];

    selectorMonitor.innerHTML = '<option value="">Selecciona un monitor</option>';

    for (const opcion of opciones) {
      const nodo = document.createElement('option');
      nodo.value = String(opcion.valor);
      nodo.textContent = `${opcion.etiqueta} · ${opcion.alcance}`;
      selectorMonitor.appendChild(nodo);
    }

    if (monitorSeleccionado && !opciones.some((opcion) => String(opcion.valor) === String(monitorSeleccionado))) {
      const nodo = document.createElement('option');
      nodo.value = String(monitorSeleccionado);
      nodo.textContent = `Monitor #${monitorSeleccionado} (fuera del selector)`;
      selectorMonitor.appendChild(nodo);
    }

    if (monitorSeleccionado) {
      selectorMonitor.value = monitorSeleccionado;
    }
    monitorSolicitadoInicial = '';
  }

  async function cargarEventos() {
    const consultaActual = ++numeroConsulta;
    const queryPagina = construirQueryPagina();
    sincronizarUrl(queryPagina);
    actualizarEnlaceMonitor();

    if (etiquetaHeroRango) {
      const formatearDia = (valor) => {
        const [anio, mes, dia] = String(valor || '').split('-').map(Number);
        return anio && mes && dia ? `${dia}/${mes}/${anio}` : '—';
      };
      etiquetaHeroRango.textContent = `${formatearDia(inputDesde?.value)} · ${formatearDia(inputHasta?.value)}`;
    }

    if (!selectorMonitor?.value) {
      mensajeSinMonitor.hidden = false;
      resultados.hidden = true;
      return;
    }

    mensajeSinMonitor.hidden = true;
    resultados.hidden = false;
    etiquetaCarga.textContent = 'Cargando eventos...';

    try {
      const queryApi = construirQueryApi();
      const respuesta = await fetchJson(`${urlEventos}?${queryApi.toString()}`);
      if (consultaActual !== numeroConsulta) return;

      actualizarResumen(respuesta);
      actualizarGrafico(respuesta);

      const desdeLocal = formatearFechaVisible(
        respuesta.rangoAplicado?.desdeUtc
      ) || '-';
      const hastaLocal = formatearFechaVisible(
        respuesta.rangoAplicado?.hastaUtc
      ) || '-';
      etiquetaCarga.textContent = `Consulta aplicada: ${desdeLocal} → ${hastaLocal}`;
    } catch (error) {
      if (consultaActual !== numeroConsulta) return;
      resultados.hidden = true;
      manejarError(error);
    }
  }

  function construirQueryPagina() {
    const parametros = new URLSearchParams();

    if (inputDesde?.value) {
      parametros.set('desde', inputDesde.value);
    }

    if (inputHasta?.value) {
      parametros.set('hasta', inputHasta.value);
    }

    if (selectorMonitor?.value) {
      parametros.set('monitor_id', selectorMonitor.value);
    }

    if (selectorTipo?.value) {
      parametros.set('tipo', selectorTipo.value);
    }

    if (selectorEstado?.value) {
      parametros.set('estado', selectorEstado.value);
    }

    if (inputCodigo?.value.trim()) {
      parametros.set('codigo_resultado', inputCodigo.value.trim());
    }

    if (selectorLimite?.value) {
      parametros.set('limite', selectorLimite.value);
    }

    if (selectorOrden?.value) {
      parametros.set('orden', selectorOrden.value);
    }

    return parametros;
  }

  function construirQueryApi() {
    const parametros = new URLSearchParams();
    const rangoUtc = resolverRangoUtcDesdeFormulario();

    parametros.set('desde', rangoUtc.desdeUtc);
    parametros.set('hasta', rangoUtc.hastaUtc);
    parametros.set('grafico', 'velas');
    parametros.set('intervalos', String(Math.max(24, Math.min(72, Math.round((canvas.parentElement?.clientWidth || 720) / 14)))));

    if (selectorMonitor?.value) {
      parametros.set('monitor_id', selectorMonitor.value);
    }

    if (selectorTipo?.value) {
      parametros.set('tipo', selectorTipo.value);
    }

    if (selectorEstado?.value) {
      parametros.set('estado', selectorEstado.value);
    }

    if (inputCodigo?.value.trim()) {
      parametros.set('codigo_resultado', inputCodigo.value.trim());
    }

    if (selectorLimite?.value) {
      parametros.set('limite', selectorLimite.value);
    }

    if (selectorOrden?.value) {
      parametros.set('orden', selectorOrden.value);
    }

    return parametros;
  }

  function resolverRangoUtcDesdeFormulario() {
    const desde = inputDesde?.value || '';
    const hasta = inputHasta?.value || '';

    if (!desde || !hasta) {
      throw new Error('Debes indicar fecha inicial y final.');
    }

    const fechaDesdeLocal = new Date(`${desde}T00:00:00`);
    const fechaHastaLocal = new Date(`${hasta}T23:59:59.999`);

    if (
      Number.isNaN(fechaDesdeLocal.getTime()) ||
      Number.isNaN(fechaHastaLocal.getTime())
    ) {
      throw new Error('No se pudo interpretar el rango temporal seleccionado.');
    }

    if (fechaDesdeLocal.getTime() > fechaHastaLocal.getTime()) {
      throw new Error('La fecha inicial no puede ser posterior a la final.');
    }

    return {
      desdeUtc: fechaDesdeLocal.toISOString(),
      hastaUtc: fechaHastaLocal.toISOString()
    };
  }

  function actualizarResumen(respuesta) {
    const resumen = respuesta.resumen || {};

    etiquetaTotal.textContent = String(resumen.total || 0);
    etiquetaCargados.textContent = String(resumen.devueltos || 0);
    etiquetaExitosos.textContent = String(resumen.totalExitososRango ?? resumen.totalExitosos ?? 0);
    etiquetaFallidos.textContent = String(resumen.totalFallidosRango ?? resumen.totalFallidos ?? 0);
    etiquetaTotalDetalle.textContent = resumen.truncado
      ? 'Hay más eventos en este período. Reduce el rango o cambia los filtros.'
      : 'Se han cargado todos los eventos encontrados.';
  }

  function inicializarGrafico() {
    chart = new ChartGlobal(canvas, {
      type: 'scatter',
      plugins: [pluginVelas],
      data: {
        datasets: [
          {
            label: 'Eventos',
            data: [],
            pointRadius: 5,
            pointHoverRadius: 7,
            pointBorderWidth: 1,
            showLine: false
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        parsing: false,
        interaction: {
          mode: 'nearest',
          intersect: true
        },
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            callbacks: {
              title: function (items) {
                const punto = items[0]?.raw;
                return punto?.agregado ? 'Intervalo de lecturas' : punto?.evento?.nombreMonitor || 'Evento';
              },
              label: function (item) {
                const punto = item.raw;
                if (punto?.agregado) {
                  return [
                    `${punto.cantidad} eventos · ${punto.fallos} fallidos`,
                    `Primera: ${punto.apertura} ms · última: ${punto.cierre} ms`,
                    `Mínimo: ${punto.minimo} ms · máximo: ${punto.maximo} ms`
                  ];
                }
                const evento = item.raw?.evento;

                if (!evento) {
                  return '';
                }

                return [
                  `Fecha: ${formatearFechaVisible(evento.ejecutadoEnUtc)}`,
                  `Estado: ${evento.resumen?.etiquetaEstado || evento.estadoDetectado}`,
                  `Código: ${evento.codigoResultado}`,
                  `Detalle: ${evento.resumen?.detalle || evento.mensajeResultado}`,
                  `Duración: ${evento.duracionTotalMs} ms`
                ];
              }
            }
          }
        },
        scales: {
          x: {
            type: 'linear',
            ticks: {
              callback: function (valor) {
                return formatearMarcaCorta(valor);
              }
            }
          },
          y: {
            reverse: true,
            min: 0,
            ticks: {
              callback: function (valor) {
                return `${Number(valor).toFixed(0)} ms`;
              }
            }
          }
        },
        onHover: function (_evento, elementos) {
          if (!Array.isArray(elementos) || elementos.length === 0) {
            return;
          }

          const indice = elementos[0].index;
          const punto = chart.data.datasets[0].data[indice];
          punto?.agregado ? actualizarDetalleAgregado(punto) : actualizarDetalle(punto?.evento || null);
        },
        onClick: function (_evento, elementos) {
          if (!Array.isArray(elementos) || elementos.length === 0) {
            return;
          }

          const indice = elementos[0].index;
          const punto = chart.data.datasets[0].data[indice];
          punto?.agregado ? actualizarDetalleAgregado(punto, { inmediato: true }) : actualizarDetalle(punto?.evento || null);
        }
      }
    });
  }

  function actualizarGrafico(respuesta) {
    numeroDetalleIntervalo += 1;
    window.clearTimeout(temporizadorDetalleIntervalo);
    intervaloActivo = null;
    cacheIntervalos.clear();
    const serie = respuesta.serieAgregada;
    const agregada = Array.isArray(serie?.puntos);
    const eventos = Array.isArray(respuesta.eventos) ? respuesta.eventos : [];
    const desdeMs = Date.parse(respuesta.rangoAplicado?.desdeUtc || '');
    const hastaMs = Date.parse(respuesta.rangoAplicado?.hastaUtc || '');
    const anchoMs = (hastaMs - desdeMs) / (serie?.intervalos || 1);
    const puntos = agregada
      ? serie.puntos.map((vela) => ({
        ...vela,
        x: desdeMs + (vela.intervalo + 0.5) * anchoMs,
        y: vela.cierre,
        inicioMs: desdeMs + vela.intervalo * anchoMs,
        finMs: Math.min(hastaMs, desdeMs + (vela.intervalo + 1) * anchoMs),
        agregado: true,
        backgroundColor: vela.fallos > 0 ? 'rgba(193, 99, 99, 0.9)' : 'rgba(79, 149, 105, 0.9)',
        borderColor: vela.fallos > 0 ? 'rgba(193, 99, 99, 1)' : 'rgba(79, 149, 105, 1)'
      })).filter((punto) => Number.isFinite(punto.x))
      : eventos.map((evento) => ({
        x: Date.parse(String(evento.ejecutadoEnUtc || '')),
        y: Number(evento.duracionTotalMs || 0),
        evento,
        backgroundColor: colorEvento(evento),
        borderColor: bordeEvento(evento)
      })).filter((punto) => Number.isFinite(punto.x) && Number.isFinite(punto.y));

    chart.data.datasets[0].data = puntos;
    chart.data.datasets[0].rangos = agregada ? puntos : [];
    chart.data.datasets[0].pointRadius = agregada ? 0 : 4;
    chart.data.datasets[0].pointHitRadius = agregada ? 12 : 4;
    chart.data.datasets[0].pointBackgroundColor = puntos.map((punto) => punto.backgroundColor);
    chart.data.datasets[0].pointBorderColor = puntos.map((punto) => punto.borderColor);
    chart.options.interaction.mode = agregada ? 'index' : 'nearest';
    chart.options.interaction.intersect = !agregada;
    chart.options.scales.x.min = desdeMs;
    chart.options.scales.x.max = hastaMs;
    chart.options.scales.y.max = Math.max(1, Math.ceil(puntos.reduce((maximo, punto) => Math.max(maximo, Number(agregada ? punto.maximo : punto.y) || 0), 0) * 1.15));
    chart.update();

    descripcionGrafico.textContent = agregada
      ? `Velas de ${serie.puntos.length} intervalos sobre los ${respuesta.resumen?.total || 0} eventos del período completo. La mecha indica mínimo y máximo; el cuerpo, primera y última duración. El punto ámbar señala fallos.`
      : `Cada punto muestra la duración de una comprobación. ${puntos.length} eventos del período.`;

    if (puntos.length > 0) {
      const ultimo = puntos[puntos.length - 1];
      agregada ? actualizarDetalleAgregado(ultimo, { inmediato: true }) : actualizarDetalle(ultimo.evento);
    } else {
      actualizarDetalle(null);
    }
  }

  function actualizarDetalleAgregado(punto, { inmediato = false } = {}) {
    const clave = String(punto.intervalo);
    if (intervaloActivo === clave && !inmediato) return;
    intervaloActivo = clave;
    const solicitudActual = ++numeroDetalleIntervalo;
    window.clearTimeout(temporizadorDetalleIntervalo);
    detalle.innerHTML = `
      <h3>Intervalo de lecturas</h3>
      <p class="texto-apoyo">${escapeHtml(formatearFechaVisible(new Date(punto.inicioMs).toISOString()))} → ${escapeHtml(formatearFechaVisible(new Date(punto.finMs).toISOString()))}</p>
      <div class="metadatos-configuracion">
        <span>Eventos: <strong>${escapeHtml(String(punto.cantidad))}</strong></span>
        <span>Fallidos: <strong>${escapeHtml(String(punto.fallos))}</strong></span>
        <span>Primera duración: <strong>${escapeHtml(String(punto.apertura))} ms</strong></span>
        <span>Última duración: <strong>${escapeHtml(String(punto.cierre))} ms</strong></span>
        <span>Rango: <strong>${escapeHtml(String(punto.minimo))}–${escapeHtml(String(punto.maximo))} ms</strong></span>
      </div>
      <div data-eventos-detalle-serie><p class="texto-apoyo">Cargando lecturas individuales…</p></div>
    `;
    if (cacheIntervalos.has(clave)) {
      mostrarSerieIntervalo(cacheIntervalos.get(clave));
      return;
    }
    temporizadorDetalleIntervalo = window.setTimeout(async () => {
      try {
        const parametros = construirQueryApi();
        parametros.delete('grafico');
        parametros.delete('intervalos');
        parametros.set('desde', new Date(punto.inicioMs).toISOString());
        parametros.set('hasta', new Date(punto.finMs).toISOString());
        parametros.set('limite', '5000');
        parametros.set('orden', 'asc');
        const respuesta = await fetchJson(`${urlEventos}?${parametros.toString()}`);
        if (solicitudActual !== numeroDetalleIntervalo) return;
        cacheIntervalos.set(clave, respuesta);
        mostrarSerieIntervalo(respuesta);
      } catch (error) {
        if (solicitudActual !== numeroDetalleIntervalo) return;
        const destino = detalle.querySelector('[data-eventos-detalle-serie]');
        if (destino) destino.innerHTML = `<p class="texto-apoyo">No se pudieron cargar las lecturas individuales: ${escapeHtml(error.message)}</p>`;
      }
    }, inmediato ? 0 : 250);
  }

  function mostrarSerieIntervalo(respuesta) {
    const destino = detalle.querySelector('[data-eventos-detalle-serie]');
    if (!destino) return;
    const eventos = Array.isArray(respuesta.eventos) ? respuesta.eventos : [];
    const serie = eventos.map((evento) => ({
      x: Date.parse(String(evento.ejecutadoEnUtc || '')),
      y: Number(evento.duracionTotalMs),
      exito: Boolean(evento.exito)
    })).filter((punto) => Number.isFinite(punto.x) && Number.isFinite(punto.y));
    const incompleta = Number(respuesta.resumen?.total || 0) > serie.length;
    destino.innerHTML = serie.length > 0
      ? construirMiniGraficaIntervalo(serie, { incompleta, total: respuesta.resumen?.total })
      : '<p class="texto-apoyo">No hay lecturas individuales en este intervalo.</p>';
  }

  function construirMiniGraficaIntervalo(serie, { incompleta = false, total = 0 } = {}) {
    const ancho = 320;
    const alto = 130;
    const margen = { izquierda: 42, derecha: 8, superior: 10, inferior: 27 };
    const minimo = Math.min(...serie.map((punto) => punto.y));
    const maximo = Math.max(...serie.map((punto) => punto.y));
    const rango = Math.max(1, maximo - minimo);
    const inicio = serie[0].x;
    const duracion = Math.max(1, serie.at(-1).x - inicio);
    const coordenadas = serie.map((punto, indice) => ({
      x: margen.izquierda + ((serie.length === 1 ? 0.5 : (punto.x - inicio) / duracion) * (ancho - margen.izquierda - margen.derecha)),
      y: margen.superior + ((punto.y - minimo) / rango) * (alto - margen.superior - margen.inferior),
      exito: punto.exito,
      indice
    }));
    const puntosSvg = coordenadas.map((punto) => `${punto.x.toFixed(1)},${punto.y.toFixed(1)}`).join(' ');
    const fallosSvg = coordenadas.filter((punto) => !punto.exito).map((punto) =>
      `<circle cx="${punto.x.toFixed(1)}" cy="${punto.y.toFixed(1)}" r="3" class="detalle-intervalo__fallo" />`
    ).join('');
    return `
      <figure class="detalle-intervalo" aria-label="Recorrido de ${serie.length} lecturas individuales del intervalo">
        <figcaption>${serie.length} lecturas, punto a punto${incompleta ? ` · de ${escapeHtml(String(total))} en el intervalo` : ''}</figcaption>
        <svg viewBox="0 0 ${ancho} ${alto}" role="img" aria-label="Duración de cada lectura; los puntos rojos indican fallos">
          <line x1="${margen.izquierda}" x2="${ancho - margen.derecha}" y1="${margen.superior}" y2="${margen.superior}" class="detalle-intervalo__guia" />
          <line x1="${margen.izquierda}" x2="${ancho - margen.derecha}" y1="${alto - margen.inferior}" y2="${alto - margen.inferior}" class="detalle-intervalo__guia" />
          <text x="0" y="${margen.superior + 4}" class="detalle-intervalo__eje">${escapeHtml(String(minimo))} ms</text>
          <text x="0" y="${alto - margen.inferior + 4}" class="detalle-intervalo__eje">${escapeHtml(String(maximo))} ms</text>
          <text x="${margen.izquierda}" y="${alto - 4}" class="detalle-intervalo__eje">${escapeHtml(formatearMarcaCorta(inicio))}</text>
          <text x="${ancho - margen.derecha}" y="${alto - 4}" text-anchor="end" class="detalle-intervalo__eje">${escapeHtml(formatearMarcaCorta(serie.at(-1).x))}</text>
          <polyline points="${puntosSvg}" class="detalle-intervalo__linea" />
          ${serie.length === 1 ? `<circle cx="${coordenadas[0].x.toFixed(1)}" cy="${coordenadas[0].y.toFixed(1)}" r="3" class="detalle-intervalo__punto" />` : ''}
          ${fallosSvg}
        </svg>
        ${incompleta ? '<p class="texto-apoyo">Este intervalo supera 5000 lecturas; acerca el período para verlas todas.</p>' : ''}
      </figure>
    `;
  }

  function actualizarDetalle(evento) {
    numeroDetalleIntervalo += 1;
    window.clearTimeout(temporizadorDetalleIntervalo);
    intervaloActivo = null;
    if (!evento) {
      detalle.innerHTML = `
        <h3>Detalle del evento</h3>
        <p class="texto-apoyo">No hay un evento seleccionado.</p>
      `;
      return;
    }

    detalle.innerHTML = `
      <h3>${escapeHtml(evento.nombreMonitor || `Monitor #${evento.monitorId}`)}</h3>
      <div class="fila-monitor__etiquetas">
        <span class="insignia-monitor insignia-monitor--${escapeHtml(tonoEvento(evento))}">${escapeHtml(evento.resumen?.etiquetaEstado || evento.estadoDetectado || 'evento')}</span>
        <span class="insignia-monitor insignia-monitor--suave">${escapeHtml(evento.codigoResultado || 'sin_resultado')}</span>
        <span class="insignia-monitor insignia-monitor--suave">${escapeHtml(String(evento.tipoMonitor || evento.tipo || '').toUpperCase())}</span>
      </div>
      <div class="metadatos-configuracion">
        <span>Fecha: <code>${escapeHtml(formatearFechaVisible(evento.ejecutadoEnUtc))}</code></span>
        <span>Duración: <code>${escapeHtml(String(evento.duracionTotalMs || 0))} ms</code></span>
        <span>Estado: <code>${escapeHtml(evento.resumen?.etiquetaTecnica || evento.codigoResultado || 'sin_resultado')}</code></span>
        <span>Detalle: ${escapeHtml(evento.resumen?.detalle || evento.mensajeResultado || 'Sin detalle operativo adicional.')}</span>
        ${evento.protocolo?.host ? `<span>Destino: <code>${escapeHtml(evento.protocolo.host)}${evento.protocolo.puerto ? `:${escapeHtml(String(evento.protocolo.puerto))}` : ''}</code></span>` : ''}
        ${evento.metricaPrincipal?.rttMs != null ? `<span>RTT: <code>${escapeHtml(String(evento.metricaPrincipal.rttMs))} ms</code></span>` : ''}
        ${evento.metricaPrincipal?.ttlRespuesta != null ? `<span>TTL respuesta: <code>${escapeHtml(String(evento.metricaPrincipal.ttlRespuesta))}</code></span>` : ''}
        ${evento.metricaPrincipal?.certificadoDiasRestantes != null ? `<span>Certificado: <code>caduca en ${escapeHtml(String(evento.metricaPrincipal.certificadoDiasRestantes))} días</code></span>` : ''}
      </div>
    `;
  }

  function aplicarPreseleccion(clave) {
    const ahora = new Date();
    const fin = new Date(
      ahora.getFullYear(),
      ahora.getMonth(),
      ahora.getDate()
    );
    const inicio = new Date(fin);

    if (clave === '1d') {
      inicio.setDate(fin.getDate());
    } else if (clave === '30d') {
      inicio.setDate(fin.getDate() - 29);
    } else {
      inicio.setDate(fin.getDate() - 6);
    }

    if (inputDesde) {
      inputDesde.value = formatearFechaInput(inicio);
    }

    if (inputHasta) {
      inputHasta.value = formatearFechaInput(ahora);
    }
  }

  function sincronizarUrl(parametros) {
    const url = new URL(window.location.href);
    for (const clave of ['desde', 'hasta', 'monitor_id', 'tipo', 'estado', 'codigo_resultado', 'limite', 'orden']) {
      url.searchParams.delete(clave);
    }
    for (const [clave, valor] of parametros) {
      url.searchParams.set(clave, valor);
    }
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  }

  function actualizarEnlaceMonitor() {
    if (!enlaceVerMonitor || !selectorMonitor?.value) return;

    const destino = new URL(`/monitores/${encodeURIComponent(selectorMonitor.value)}`, window.location.origin);
    destino.searchParams.set('return_to', `${window.location.pathname}${window.location.search}`);
    if (inputDesde?.value) destino.searchParams.set('desde', `${inputDesde.value}T00:00`);
    if (inputHasta?.value) destino.searchParams.set('hasta', `${inputHasta.value}T23:59`);
    if (selectorLimite?.value) destino.searchParams.set('limite', selectorLimite.value);
    enlaceVerMonitor.href = `${destino.pathname}${destino.search}`;
  }

  function manejarError(error) {
    console.error(error);
    etiquetaCarga.textContent = 'No se pudo cargar el visor.';
    window.portalToast?.show?.({
      tipo: 'error',
      titulo: 'Visor de eventos',
      cuerpo: error?.message || 'No se pudo cargar la información solicitada.'
    });
  }
})();

function fetchJson(url) {
  return fetch(url, {
    headers: {
      Accept: 'application/json'
    }
  }).then(async function (respuesta) {
    const datos = await respuesta.json().catch(function () {
      return null;
    });

    if (!respuesta.ok || !datos?.ok) {
      throw new Error(datos?.mensaje || 'La petición no pudo completarse.');
    }

    return datos;
  });
}

function aplicarValorInput(nodo, valor) {
  if (!nodo || valor == null || String(valor).trim() === '') {
    return;
  }

  nodo.value = String(valor);
}

function formatearFechaInput(fecha) {
  const valor = fecha instanceof Date ? fecha : new Date(fecha);

  if (Number.isNaN(valor.getTime())) {
    return '';
  }

  const ano = valor.getFullYear();
  const mes = String(valor.getMonth() + 1).padStart(2, '0');
  const dia = String(valor.getDate()).padStart(2, '0');

  return `${ano}-${mes}-${dia}`;
}

function formatearFechaVisible(valor) {
  if (!valor) return '';
  const global = window.portalFechas?.formatear?.(valor);
  if (global) return global;
  const fecha = new Date(valor);
  return Number.isNaN(fecha.getTime())
    ? String(valor)
    : fecha.toLocaleString('es-ES');
}

function formatearMarcaCorta(valor) {
  const fecha = new Date(Number(valor));

  if (Number.isNaN(fecha.getTime())) {
    return '';
  }

  return new Intl.DateTimeFormat('es-ES', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(fecha);
}

function tonoEvento(evento) {
  const tono = String(evento?.resumen?.tono || '').trim().toLowerCase();

  if (tono === 'ok') {
    return 'ok';
  }

  if (tono === 'advertencia') {
    return 'advertencia';
  }

  return 'alerta';
}

function colorEvento(evento) {
  const tono = tonoEvento(evento);

  if (tono === 'ok') {
    return 'rgba(63, 107, 87, 0.82)';
  }

  if (tono === 'advertencia') {
    return 'rgba(138, 100, 46, 0.84)';
  }

  return 'rgba(147, 74, 74, 0.82)';
}

function bordeEvento(evento) {
  const tono = tonoEvento(evento);

  if (tono === 'ok') {
    return 'rgba(63, 107, 87, 1)';
  }

  if (tono === 'advertencia') {
    return 'rgba(138, 100, 46, 1)';
  }

  return 'rgba(147, 74, 74, 1)';
}

function escapeHtml(texto) {
  return String(texto)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
