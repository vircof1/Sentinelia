(function () {
  const modulo = document.querySelector('[data-monitor-eventos-grafica]');

  if (!modulo || !window.Chart) {
    return;
  }

  const urlEventos = modulo.dataset.urlEventos || '';
  const urlHitos = modulo.dataset.urlHitos || '';
  const monitorId = String(modulo.dataset.monitorId || '').trim();
  const tipoMonitor = String(modulo.dataset.monitorTipo || '').trim().toLowerCase();
  const inputDesde = modulo.querySelector('[data-detalle-eventos-desde]');
  const inputHasta = modulo.querySelector('[data-detalle-eventos-hasta]');
  const selectorLimite = modulo.querySelector('[data-detalle-eventos-limite]');
  const botonAplicar = modulo.querySelector('[data-detalle-eventos-aplicar]');
  const botonesPreseleccion = Array.from(
    modulo.querySelectorAll('[data-detalle-eventos-preseleccion]')
  );
  const botonesHito = Array.from(
    modulo.querySelectorAll('[data-detalle-eventos-hito]')
  );
  const canvas = modulo.querySelector('[data-detalle-eventos-canvas]');
  const panelDetalle = modulo.querySelector('[data-detalle-eventos-panel]');
  const etiquetaTotal = modulo.querySelector('[data-detalle-eventos-total]');
  const etiquetaTotalDetalle = modulo.querySelector('[data-detalle-eventos-total-detalle]');
  const etiquetaFuente = modulo.querySelector('[data-detalle-eventos-fuente]');
  const etiquetaFuenteDetalle = modulo.querySelector('[data-detalle-eventos-fuente-detalle]');
  const etiquetaMetrica = modulo.querySelector('[data-detalle-eventos-metrica]');
  const etiquetaMetricaDetalle = modulo.querySelector('[data-detalle-eventos-metrica-detalle]');
  const etiquetaLeyenda = modulo.querySelector('[data-detalle-eventos-leyenda]');
  const panelIncidencia = modulo.querySelector('[data-detalle-eventos-incidencia]');
  const ayudaHitos = modulo.querySelector('[data-detalle-eventos-hitos-ayuda]');
  const etiquetaFrescura = document.querySelector('[data-monitor-frescura]');
  let chart = null;
  let hastaDinamico = false;
  let temporizadorRedimension = null;
  let eventosActuales = [];
  let seleccionActual = null;
  let hitosEventos = null;
  const pluginVelasAgrupadas = {
    id: 'velasAgrupadasMonitor',
    beforeDatasetsDraw(grafica) {
      const indiceDataset = grafica.data.datasets.findIndex(
        (dataset) => Array.isArray(dataset.rangos) && dataset.rangos.length > 0
      );
      if (indiceDataset < 0) return;

      const dataset = grafica.data.datasets[indiceDataset];
      const meta = grafica.getDatasetMeta(indiceDataset);
      const escalaY = grafica.scales.y;
      const contexto = grafica.ctx;

      contexto.save();
      dataset.rangos.forEach((punto, indice) => {
        const elemento = meta.data[indice];
        if (!elemento || !Number.isFinite(punto.minimo) || !Number.isFinite(punto.maximo)) return;

        const estilo = resolverEstiloVela(punto);
        const aperturaY = escalaY.getPixelForValue(punto.apertura);
        const cierreY = escalaY.getPixelForValue(punto.cierre);
        const altoCuerpo = Math.max(3, Math.abs(cierreY - aperturaY));
        const elementoAnterior = meta.data[indice - 1];
        const elementoSiguiente = meta.data[indice + 1];
        const separaciones = [
          elementoAnterior ? Math.abs(elemento.x - elementoAnterior.x) : Infinity,
          elementoSiguiente ? Math.abs(elementoSiguiente.x - elemento.x) : Infinity
        ].filter(Number.isFinite);
        const separacionVecina = separaciones.length > 0
          ? Math.min(...separaciones)
          : grafica.chartArea.width;
        const anchuraObjetivo = Math.min(
          15,
          grafica.chartArea.width / Math.max(28, dataset.rangos.length * 1.45)
        );
        const anchura = Math.max(2, Math.min(anchuraObjetivo, separacionVecina * 0.68));

        contexto.strokeStyle = estilo.borde;
        contexto.fillStyle = estilo.relleno;
        contexto.lineWidth = punto.tieneFallo ? 2 : 1.25;
        contexto.beginPath();
        contexto.moveTo(elemento.x, escalaY.getPixelForValue(punto.minimo));
        contexto.lineTo(elemento.x, escalaY.getPixelForValue(punto.maximo));
        contexto.stroke();
        contexto.fillRect(
          elemento.x - anchura / 2,
          Math.min(aperturaY, cierreY),
          anchura,
          altoCuerpo
        );
        contexto.strokeRect(
          elemento.x - anchura / 2,
          Math.min(aperturaY, cierreY),
          anchura,
          altoCuerpo
        );

        if (punto.tieneFallo) {
          const yFallo = Math.max(
            grafica.chartArea.top + 8,
            Math.min(
              grafica.chartArea.bottom - 8,
              escalaY.getPixelForValue(punto.maximo)
            )
          );
          contexto.fillStyle = 'rgba(221, 168, 67, 0.98)';
          contexto.strokeStyle = 'rgba(82, 62, 24, 0.95)';
          contexto.lineWidth = 1;
          contexto.beginPath();
          contexto.moveTo(elemento.x, yFallo - 6);
          contexto.lineTo(elemento.x - 6, yFallo + 5);
          contexto.lineTo(elemento.x + 6, yFallo + 5);
          contexto.closePath();
          contexto.fill();
          contexto.stroke();
        }
      });
      contexto.restore();
    },
    afterDatasetsDraw(grafica) {
      if (!seleccionActual) return;

      const meta = grafica.getDatasetMeta(seleccionActual.datasetIndex);
      const elemento = meta?.data?.[seleccionActual.index];

      if (!elemento) return;

      const contexto = grafica.ctx;
      contexto.save();
      contexto.strokeStyle = 'rgba(147, 183, 224, 0.9)';
      contexto.lineWidth = 1;
      contexto.setLineDash([4, 4]);
      contexto.beginPath();
      contexto.moveTo(elemento.x, grafica.chartArea.top);
      contexto.lineTo(elemento.x, grafica.chartArea.bottom);
      contexto.stroke();
      contexto.restore();
    }
  };

  if (!urlEventos || !monitorId || !canvas) {
    return;
  }

  aplicarPreseleccion('7d');
  aplicarQueryEnFormulario();
  inicializarGrafico();
  actualizarFrescuraMonitor();
  window.setInterval(actualizarFrescuraMonitor, 30000);
  void cargarGrafica();
  void cargarHitosEventos();

  botonAplicar?.addEventListener('click', function () {
    void cargarGrafica();
  });

  inputHasta?.addEventListener('input', function () {
    hastaDinamico = false;
  });

  for (const boton of botonesPreseleccion) {
    boton.addEventListener('click', function () {
      aplicarPreseleccion(
        String(boton.dataset.detalleEventosPreseleccion || '7d'),
        { usarHastaDinamico: true }
      );
      void cargarGrafica();
    });
  }

  for (const boton of botonesHito) {
    boton.addEventListener('click', function () {
      aplicarHitoTemporal(String(boton.dataset.detalleEventosHito || ''));
    });
  }

  window.addEventListener('resize', programarRedimensionGrafica);
  window.addEventListener('orientationchange', programarRedimensionGrafica);

  function programarRedimensionGrafica() {
    window.clearTimeout(temporizadorRedimension);
    temporizadorRedimension = window.setTimeout(function () {
      window.requestAnimationFrame(function () {
        window.requestAnimationFrame(function () {
          chart?.resize();
          if (eventosActuales.length > 0) {
            renderizarGrafica(eventosActuales, { conservarSeleccion: true });
          }
        });
      });
    }, 120);
  }

  async function cargarGrafica() {
    try {
      actualizarHastaDinamico();
      const query = construirQuery();
      sincronizarUrl();
      const datos = await fetchJson(`${urlEventos}?${query.toString()}`);
      const vista = renderizarGrafica(datos.eventos || []);
      actualizarResumen(datos.eventos || [], datos.resumen || {}, vista);
    } catch (error) {
      console.error(error);
      panelDetalle.innerHTML = `
        <h3>Detalle del punto</h3>
        <p class="mensaje-error mensaje-error--suave">${escapeHtml(error?.message || 'No se pudo cargar la gráfica.')}</p>
      `;
      window.portalToast?.show?.({
        tipo: 'error',
        titulo: 'Gráfica del monitor',
        cuerpo: error?.message || 'No se pudo cargar la serie temporal.'
      });
    }
  }

  async function cargarHitosEventos() {
    if (!urlHitos) return;

    try {
      const parametros = new URLSearchParams({ monitor_id: monitorId });
      hitosEventos = await fetchJson(`${urlHitos}?${parametros.toString()}`);
      actualizarAccionesHitos();
      renderizarResumenIncidencia();
    } catch (error) {
      console.error(error);
    }
  }

  function actualizarAccionesHitos() {
    const ultimoFallo = hitosEventos?.ultimoFallo || null;
    const ultimaRecuperacion = hitosEventos?.ultimaRecuperacion || null;

    for (const boton of botonesHito) {
      const esFallo = boton.dataset.detalleEventosHito === 'fallo';
      const evento = esFallo ? ultimoFallo : ultimaRecuperacion;
      boton.disabled = !evento?.ejecutadoEnUtc;
      boton.title = evento?.ejecutadoEnUtc
        ? `Mostrar desde ${formatearFechaVisible(evento.ejecutadoEnUtc)}`
        : esFallo
          ? 'No hay fallos registrados en la retención disponible.'
          : 'No hay una recuperación registrada después del último fallo.';
    }

    if (ayudaHitos) {
      const hayHito = Boolean(ultimoFallo?.ejecutadoEnUtc || ultimaRecuperacion?.ejecutadoEnUtc);
      ayudaHitos.hidden = hayHito;
      ayudaHitos.textContent = hayHito
        ? ''
        : 'No hay fallos ni recuperaciones registrados en la retención disponible.';
    }
  }

  function aplicarHitoTemporal(tipoHito) {
    const evento = tipoHito === 'recuperacion'
      ? hitosEventos?.ultimaRecuperacion
      : hitosEventos?.ultimoFallo;
    const fecha = new Date(evento?.ejecutadoEnUtc || '');

    if (Number.isNaN(fecha.getTime())) return;

    if (inputDesde) inputDesde.value = formatearFechaHoraInput(fecha);
    hastaDinamico = true;
    actualizarHastaDinamico();
    void cargarGrafica();
  }

  function renderizarResumenIncidencia() {
    if (!panelIncidencia) return;

    const incidencia = hitosEventos?.incidencia;
    const ultimoFallo = hitosEventos?.ultimoFallo;
    const ultimaRecuperacion = hitosEventos?.ultimaRecuperacion;

    if (!incidencia || !ultimoFallo?.ejecutadoEnUtc) {
      panelIncidencia.hidden = true;
      panelIncidencia.replaceChildren();
      return;
    }

    panelIncidencia.hidden = false;
    const estado = incidencia.activa ? 'Incidencia activa' : 'Última incidencia resuelta';
    const detalle = incidencia.activa
      ? `Abierta desde ${formatearFechaVisible(incidencia.inicioUtc)}.`
      : `De ${formatearFechaVisible(incidencia.inicioUtc)} a ${formatearFechaVisible(incidencia.finUtc)}.`;
    const duracion = Number.isFinite(Number(incidencia.duracionMs))
      ? `Duración: ${formatearDuracionHumana(incidencia.duracionMs)}.`
      : '';
    const resultado = ultimoFallo.resumen?.detalle || ultimoFallo.mensajeResultado || 'Sin detalle adicional.';
    const recuperacion = ultimaRecuperacion
      ? ' Se ha registrado una recuperación posterior.'
      : '';

    panelIncidencia.innerHTML = `
      <div class="visor-eventos__incidencia-marca" aria-hidden="true"><i class="bi bi-exclamation-triangle"></i></div>
      <div>
        <strong>${escapeHtml(estado)}</strong>
        <p>${escapeHtml(detalle)} ${escapeHtml(duracion)} ${escapeHtml(resultado)}${escapeHtml(recuperacion)}</p>
      </div>
    `;
  }

  function actualizarFrescuraMonitor() {
    if (!etiquetaFrescura) return;

    const fechaUltimaEjecucion = new Date(etiquetaFrescura.dataset.ultimaEjecucionUtc || '');
    const cadenciaSegundos = Number(etiquetaFrescura.dataset.cadenciaSegundos);

    if (Number.isNaN(fechaUltimaEjecucion.getTime()) || !Number.isFinite(cadenciaSegundos) || cadenciaSegundos <= 0) {
      return;
    }

    const transcurridoMs = Math.max(0, Date.now() - fechaUltimaEjecucion.getTime());
    const vencido = transcurridoMs > cadenciaSegundos * 1000;
    etiquetaFrescura.classList.toggle('monitor-frescura--vencida', vencido);
    etiquetaFrescura.textContent = vencido
      ? `Sin ejecución desde hace ${formatearDuracionHumana(transcurridoMs)} · cadencia ${formatearDuracionHumana(cadenciaSegundos * 1000)}`
      : `Actualizada hace ${formatearDuracionHumana(transcurridoMs)} · dentro de cadencia`;
  }

  function construirQuery() {
    const rango = resolverRangoUtc();
    const parametros = new URLSearchParams();

    parametros.set('monitor_id', monitorId);
    parametros.set('desde', rango.desdeUtc);
    parametros.set('hasta', rango.hastaUtc);
    parametros.set('limite', selectorLimite?.value || '500');
    parametros.set('orden', 'asc');

    return parametros;
  }

  function aplicarQueryEnFormulario() {
    const parametros = new URL(window.location.href).searchParams;
    const desde = parametros.get('desde');
    const hasta = parametros.get('hasta');
    const limite = parametros.get('limite');

    if (desde && esFechaHoraInputValida(desde) && inputDesde) {
      inputDesde.value = desde;
    }

    if (hasta === 'now' && inputHasta) {
      hastaDinamico = true;
      actualizarHastaDinamico();
    } else if (hasta && esFechaHoraInputValida(hasta) && inputHasta) {
      inputHasta.value = hasta;
    }

    if (
      limite &&
      selectorLimite &&
      Array.from(selectorLimite.options).some((opcion) => opcion.value === limite)
    ) {
      selectorLimite.value = limite;
    }
  }

  function sincronizarUrl() {
    const url = new URL(window.location.href);

    actualizarParametroUrl(url, 'desde', inputDesde?.value);
    actualizarParametroUrl(
      url,
      'hasta',
      hastaDinamico ? 'now' : inputHasta?.value
    );
    actualizarParametroUrl(url, 'limite', selectorLimite?.value);

    window.history.replaceState(
      {},
      '',
      `${url.pathname}${url.search}${url.hash}`
    );
  }

  function actualizarParametroUrl(url, nombre, valor) {
    const texto = String(valor || '').trim();

    if (texto) {
      url.searchParams.set(nombre, texto);
    } else {
      url.searchParams.delete(nombre);
    }
  }

  function resolverRangoUtc() {
    const desde = inputDesde?.value || '';
    const hasta = inputHasta?.value || '';

    if (!desde || !hasta) {
      throw new Error('Debes indicar fecha inicial y final.');
    }

    const fechaDesdeLocal = construirFechaLocalDesdeInput(desde, {
      finDelDia: false
    });
    const fechaHastaLocal = construirFechaLocalDesdeInput(hasta, {
      finDelDia: true
    });

    if (
      Number.isNaN(fechaDesdeLocal.getTime()) ||
      Number.isNaN(fechaHastaLocal.getTime())
    ) {
      throw new Error('No se pudo interpretar el rango temporal.');
    }

    if (fechaDesdeLocal.getTime() > fechaHastaLocal.getTime()) {
      throw new Error('La fecha inicial no puede ser posterior a la final.');
    }

    return {
      desdeUtc: fechaDesdeLocal.toISOString(),
      hastaUtc: fechaHastaLocal.toISOString()
    };
  }

  function aplicarPreseleccion(clave, { usarHastaDinamico = false } = {}) {
    const hoy = new Date();
    const inicio = new Date(hoy);

    if (clave === '1d') {
      inicio.setDate(hoy.getDate() - 1);
    } else if (clave === '30d') {
      inicio.setDate(hoy.getDate() - 30);
    } else {
      inicio.setDate(hoy.getDate() - 7);
    }

    if (inputDesde) {
      inputDesde.value = formatearFechaHoraInput(inicio);
    }

    if (inputHasta) {
      inputHasta.value = formatearFechaHoraInput(hoy);
    }

    hastaDinamico = usarHastaDinamico;
  }

  function actualizarHastaDinamico() {
    if (hastaDinamico && inputHasta) {
      inputHasta.value = formatearFechaHoraInput(new Date());
    }
  }

  function inicializarGrafico() {
    chart = new window.Chart(canvas, {
      type: 'line',
      plugins: [pluginVelasAgrupadas],
      data: {
        datasets: [
          {
            label: 'Serie temporal',
            data: [],
            parsing: false,
            borderColor: 'rgba(82, 107, 132, 0.56)',
            backgroundColor: 'rgba(82, 107, 132, 0.16)',
            borderWidth: 2,
            pointRadius: 4,
            pointHoverRadius: 7,
            tension: 0.18
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
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
                const puntoBruto = items[0]?.raw;
                if (puntoBruto?.agregado) return 'Intervalo temporal agregado';
                const punto = puntoBruto?.evento;
                return punto?.nombreMonitor || `Monitor #${monitorId}`;
              },
              label: function (item) {
                const punto = item.raw || {};
                const evento = punto.evento;

                if (punto.agregado) {
                  return [
                    `${punto.cantidad} ejecuciones`,
                    `Mediana: ${formatearMilisegundos(punto.y)}`,
                    `Rango: ${formatearMilisegundos(punto.minimo)}–${formatearMilisegundos(punto.maximo)}`,
                    punto.fallos > 0 ? `Fallos: ${punto.fallos}` : 'Sin fallos'
                  ];
                }

                if (!evento) {
                  return '';
                }

                return [
                  `Fecha: ${formatearFechaVisible(evento.ejecutadoEnUtc)}`,
                  `Métrica: ${formatearMilisegundos(punto.y)}`,
                  `Resultado: ${evento.codigoResultado}`,
                  `Detalle: ${evento.resumen?.detalle || evento.mensajeResultado}`
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
          actualizarDetalleDesdeElemento(elementos?.[0]);
        },
        onClick: function (_evento, elementos) {
          fijarSeleccionElemento(elementos?.[0]);
        }
      }
    });
  }

  function fijarSeleccionElemento(elemento) {
    if (!elemento) return;

    seleccionActual = {
      datasetIndex: elemento.datasetIndex,
      index: elemento.index
    };
    actualizarDetalleDesdeElemento(elemento);
    chart?.draw();
  }

  function actualizarDetalleDesdeElemento(elemento) {
    if (!elemento) return;

    const punto = chart?.data?.datasets?.[elemento.datasetIndex]?.data?.[elemento.index];
    if (punto?.agregado) {
      actualizarPanelAgregado(punto);
      return;
    }

    actualizarPanelDetalle(punto?.evento || null, punto?.y || null);
  }

  function renderizarGrafica(eventos, { conservarSeleccion = false } = {}) {
    eventosActuales = Array.isArray(eventos) ? eventos : [];
    const puntos = eventos
      .map((evento) => construirPuntoEvento(evento))
      .filter(Boolean)
      .sort((a, b) => a.x - b.x);
    const vista = construirVistaGrafica(puntos);
    const maximoMs = puntos.reduce(
      (maximo, punto) => Math.max(maximo, Number(punto.y || 0)),
      0
    );

    chart.data.datasets[0].label = vista.agregada
      ? 'Resumen temporal'
      : 'Ejecuciones individuales';
    chart.data.datasets[0].data = vista.puntos;
    chart.data.datasets[0].showLine = vista.mostrarLinea;
    chart.data.datasets[0].borderWidth = vista.mostrarLinea ? 2 : 0;
    chart.data.datasets[0].pointRadius = vista.agregada ? 0 : (vista.mostrarLinea ? 4 : 2.5);
    chart.data.datasets[0].pointHoverRadius = vista.agregada ? 0 : 7;
    chart.data.datasets[0].pointHitRadius = vista.agregada ? 14 : 1;
    chart.data.datasets[0].rangos = vista.agregada ? vista.puntos : [];
    chart.data.datasets[0].pointBackgroundColor = vista.puntos.map((punto) =>
      colorPunto(punto.evento)
    );
    chart.data.datasets[0].pointBorderColor = vista.puntos.map((punto) =>
      bordePunto(punto.evento)
    );
    chart.data.datasets[0].pointStyle = vista.puntos.map((punto) =>
      punto.tieneFallo || !punto.evento?.exito ? 'triangle' : 'circle'
    );
    chart.options.interaction.mode = vista.agregada ? 'index' : 'nearest';
    chart.options.interaction.intersect = !vista.agregada;
    chart.options.scales.y.max = maximoMs > 0 ? Math.ceil(maximoMs * 1.15) : 1000;
    chart.update();

    if (etiquetaLeyenda) {
      etiquetaLeyenda.hidden = !vista.agregada;
      etiquetaLeyenda.textContent = vista.agregada
        ? `Vista de velas en ${vista.intervalos} intervalos: la mecha muestra el rango mínimo–máximo y el cuerpo, la primera y última lectura. Verde mejora; rojo empeora. El triángulo ámbar señala un intervalo con fallos.`
        : '';
    }
    canvas.closest('.visor-eventos__grafico')?.classList.toggle(
      'visor-eventos__grafico--agregada',
      vista.agregada
    );

    if (!conservarSeleccion && vista.puntos.length > 0) {
      seleccionActual = {
        datasetIndex: 0,
        index: vista.puntos.length - 1
      };
      const ultimoPunto = vista.puntos[vista.puntos.length - 1];
      if (ultimoPunto.agregado) {
        actualizarPanelAgregado(ultimoPunto);
      } else {
        actualizarPanelDetalle(ultimoPunto.evento, ultimoPunto.y);
      }
    } else {
      if (!conservarSeleccion && puntos.length === 0) {
        seleccionActual = null;
        actualizarPanelDetalle(null, null);
      }
      if (conservarSeleccion && seleccionActual?.index >= vista.puntos.length) {
        seleccionActual = vista.puntos.length > 0
          ? { datasetIndex: 0, index: vista.puntos.length - 1 }
          : null;
      }
    }

    chart.draw();

    return vista;
  }

  function construirVistaGrafica(puntos) {
    const limiteEjecucionesIndividuales = 150;

    if (puntos.length <= limiteEjecucionesIndividuales) {
      return {
        agregada: false,
        puntos,
        mostrarLinea: true,
        intervalos: 0
      };
    }

    const anchoDisponible = Math.max(280, canvas.parentElement?.clientWidth || 720);
    const intervalos = Math.max(24, Math.min(72, Math.round(anchoDisponible / 14)));
    const inicio = puntos[0]?.x || 0;
    const fin = puntos[puntos.length - 1]?.x || inicio;
    const duracion = Math.max(1, fin - inicio);
    const cubos = Array.from({ length: intervalos }, () => []);

    for (const punto of puntos) {
      const indice = Math.min(
        intervalos - 1,
        Math.floor(((punto.x - inicio) / duracion) * intervalos)
      );
      cubos[indice].push(punto);
    }

    const resumenes = cubos
      .filter((cubo) => cubo.length > 0)
      .map((cubo) => construirResumenIntervalo(cubo));

    return {
      agregada: true,
      puntos: resumenes,
      mostrarLinea: false,
      intervalos: resumenes.length
    };
  }

  function construirResumenIntervalo(puntos) {
    const valores = puntos.map((punto) => punto.y).sort((a, b) => a - b);
    const indiceMediana = Math.floor(valores.length / 2);
    const eventoRepresentativo = puntos[puntos.length - 1]?.evento || null;
    const fallos = puntos.filter((punto) => !punto.evento?.exito);

    return {
      x: Math.round((puntos[0].x + puntos[puntos.length - 1].x) / 2),
      y: valores[indiceMediana],
      minimo: valores[0],
      maximo: valores[valores.length - 1],
      apertura: puntos[0].y,
      cierre: puntos[puntos.length - 1].y,
      cantidad: puntos.length,
      fallos: fallos.length,
      tieneFallo: fallos.length > 0,
      inicioUtcMs: puntos[0].x,
      finUtcMs: puntos[puntos.length - 1].x,
      serie: puntos,
      evento: fallos.at(-1)?.evento || eventoRepresentativo,
      agregado: true
    };
  }

  function construirPuntoEvento(evento) {
    const x = Date.parse(String(evento?.ejecutadoEnUtc || ''));
    const y = resolverMetricaEvento(evento);

    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return null;
    }

    return {
      x,
      y,
      evento
    };
  }

  function resolverMetricaEvento(evento) {
    if (!evento || typeof evento !== 'object') {
      return null;
    }

    const rttMs = Number(evento?.metricaPrincipal?.rttMs);
    const timeoutMs = Number(evento?.protocolo?.timeoutMs);
    const duracionTotalMs = Number(evento?.duracionTotalMs);
    const exitoTecnico = resolverExitoTecnicoEvento(evento);

    if (tipoMonitor === 'ping') {
      if (exitoTecnico && Number.isFinite(rttMs)) {
        return rttMs;
      }

      if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
        return timeoutMs;
      }

      if (Number.isFinite(duracionTotalMs) && duracionTotalMs >= 0) {
        return duracionTotalMs;
      }

      return null;
    }

    if (exitoTecnico && Number.isFinite(duracionTotalMs) && duracionTotalMs >= 0) {
      return duracionTotalMs;
    }

    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
      return timeoutMs;
    }

    if (Number.isFinite(duracionTotalMs) && duracionTotalMs >= 0) {
      return duracionTotalMs;
    }

    return null;
  }

  function resolverExitoTecnicoEvento(evento) {
    if (evento?.resultadoTecnico?.exito != null) {
      return Boolean(evento.resultadoTecnico.exito);
    }

    if (evento?.exitoTecnico != null) {
      return Boolean(evento.exitoTecnico);
    }

    return Boolean(evento?.exito);
  }

  function actualizarResumen(eventos, resumen, vista = null) {
    const puntos = eventos
      .map((evento) => resolverMetricaEvento(evento))
      .filter((valor) => Number.isFinite(valor));
    const origenDatos = String(resumen.origenDatos || 'eventos_monitores');
    const etiquetaOrigen = String(
      resumen.etiquetaOrigenDatos || 'Eventos operativos'
    );
    const descripcionOrigen = String(
      resumen.descripcionOrigenDatos ||
        'La tabla se persiste con la compactación configurada por el portal.'
    );

    etiquetaTotal.textContent = String(resumen.total || 0);
    const detalleCarga = resumen.truncado
      ? `Se han cargado ${resumen.devueltos || 0} de ${resumen.total || 0} puntos visibles.`
      : `${resumen.devueltos || 0} puntos visibles sin truncado.`;
    etiquetaTotalDetalle.textContent = vista?.agregada
      ? `${detalleCarga} La gráfica resume la densidad temporal para evitar solapamientos.`
      : detalleCarga;
    if (etiquetaFuente) {
      etiquetaFuente.textContent = etiquetaOrigen;
    }
    if (etiquetaFuenteDetalle) {
      etiquetaFuenteDetalle.textContent = descripcionOrigen;
    }

    if (puntos.length === 0) {
      etiquetaMetrica.textContent = 'Sin puntos';
      etiquetaMetricaDetalle.textContent = 'No hay métricas temporales representables en el rango actual.';
      return;
    }

    const minimo = Math.min(...puntos);
    const maximo = Math.max(...puntos);

    etiquetaMetrica.textContent = `${Math.round(minimo)}-${Math.round(maximo)} ms`;
    const etiquetaSerie = {
      ping: 'ICMP',
      tcp: 'TCP/TLS',
      booleano: 'de evaluación lógica',
      telemetria: 'de telemetría de agente'
    }[tipoMonitor] || 'operativa';
    etiquetaMetricaDetalle.textContent =
      `Serie ${etiquetaSerie} leída desde eventos_monitores con la compactación operativa configurada.`;
  }

  function actualizarPanelDetalle(evento, y) {
    if (!evento) {
      panelDetalle.innerHTML = `
        <h3>Detalle del punto</h3>
        <p class="texto-apoyo">No hay ejecuciones visibles para el rango actual.</p>
      `;
      return;
    }

    panelDetalle.innerHTML = `
      <h3>${escapeHtml(evento.nombreMonitor || `Monitor #${monitorId}`)}</h3>
      <div class="fila-monitor__etiquetas">
        <span class="insignia-monitor ${evento.exito ? 'insignia-monitor--ok' : 'insignia-monitor--alerta'}">${escapeHtml(evento.exito ? 'Operativo' : 'Fallo')}</span>
        <span class="insignia-monitor insignia-monitor--suave">${escapeHtml(evento.codigoResultado || 'sin_resultado')}</span>
        <span class="insignia-monitor insignia-monitor--suave">${escapeHtml(String(tipoMonitor).toUpperCase())}</span>
        <span class="insignia-monitor insignia-monitor--suave">Evento operativo</span>
      </div>
      <div class="metadatos-configuracion">
        <span>Fecha: <code>${escapeHtml(formatearFechaVisible(evento.ejecutadoEnUtc))}</code></span>
        <span>Lectura gráfica: <code>${escapeHtml(formatearMilisegundos(y))}</code></span>
        <span>Duración total: <code>${escapeHtml(String(evento.duracionTotalMs || 0))} ms</code></span>
        <span>Estado: <code>${escapeHtml(evento.resumen?.etiquetaEstado || evento.estadoDetectado || 'evento')}</code></span>
        <span>Detalle: ${escapeHtml(evento.resumen?.detalle || evento.mensajeResultado || 'Sin detalle operativo adicional.')}</span>
        <span>Fuente: <code>eventos_monitores</code></span>
        ${evento.protocolo?.host ? `<span>Destino: <code>${escapeHtml(evento.protocolo.host)}${evento.protocolo.puerto ? `:${escapeHtml(String(evento.protocolo.puerto))}` : ''}</code></span>` : ''}
        ${evento.metricaPrincipal?.rttMs != null ? `<span>RTT real: <code>${escapeHtml(String(evento.metricaPrincipal.rttMs))} ms</code></span>` : ''}
      </div>
    `;
  }

  function actualizarPanelAgregado(punto) {
    const inicio = formatearFechaVisible(new Date(punto.inicioUtcMs).toISOString());
    const fin = formatearFechaVisible(new Date(punto.finUtcMs).toISOString());
    const etiquetaFallos = punto.fallos > 0
      ? `${punto.fallos} con fallo`
      : 'Sin fallos';

    panelDetalle.innerHTML = `
      <h3>Intervalo temporal</h3>
      <div class="fila-monitor__etiquetas">
        <span class="insignia-monitor insignia-monitor--suave">${escapeHtml(String(punto.cantidad))} ejecuciones</span>
        <span class="insignia-monitor ${punto.fallos > 0 ? 'insignia-monitor--alerta' : 'insignia-monitor--ok'}">${escapeHtml(etiquetaFallos)}</span>
        <span class="insignia-monitor insignia-monitor--suave">${escapeHtml(String(tipoMonitor).toUpperCase())}</span>
      </div>
      <div class="metadatos-configuracion">
        <span>Periodo: <code>${escapeHtml(inicio)} – ${escapeHtml(fin)}</code></span>
        <span>Mediana: <code>${escapeHtml(formatearMilisegundos(punto.y))}</code></span>
        <span>Rango: <code>${escapeHtml(formatearMilisegundos(punto.minimo))} – ${escapeHtml(formatearMilisegundos(punto.maximo))}</code></span>
        <span>Recorrido: <code>${escapeHtml(formatearMilisegundos(punto.apertura))} → ${escapeHtml(formatearMilisegundos(punto.cierre))}</code></span>
        <span>Fuente: <code>eventos_monitores</code></span>
        <span>Acerca el rango temporal para inspeccionar cada ejecución individual.</span>
      </div>
      ${construirMiniGraficaIntervalo(punto)}
    `;
  }

  function construirMiniGraficaIntervalo(punto) {
    const serie = Array.isArray(punto.serie) ? punto.serie : [];
    if (serie.length < 2) return '';

    const ancho = 320;
    const alto = 118;
    const margen = {
      izquierda: 40,
      derecha: 8,
      superior: 10,
      inferior: 26
    };
    const minimo = Math.min(...serie.map((elemento) => elemento.y));
    const maximo = Math.max(...serie.map((elemento) => elemento.y));
    const rango = Math.max(1, maximo - minimo);
    const puntosSvg = serie.map((elemento, indice) => {
      const x = margen.izquierda + ((ancho - margen.izquierda - margen.derecha) * indice) / (serie.length - 1);
      const y = margen.superior + ((elemento.y - minimo) / rango) * (alto - margen.superior - margen.inferior);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    const fallosSvg = serie.map((elemento, indice) => {
      if (elemento.evento?.exito) return '';
      const x = margen.izquierda + ((ancho - margen.izquierda - margen.derecha) * indice) / (serie.length - 1);
      const y = margen.superior + ((elemento.y - minimo) / rango) * (alto - margen.superior - margen.inferior);
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" class="detalle-intervalo__fallo" />`;
    }).join('');

    return `
      <figure class="detalle-intervalo" aria-label="Serie de ${escapeHtml(String(serie.length))} ejecuciones dentro del intervalo seleccionado">
        <figcaption>Detalle de las ${escapeHtml(String(serie.length))} ejecuciones comprimidas</figcaption>
        <svg viewBox="0 0 ${ancho} ${alto}" role="img" aria-label="Evolución interna del intervalo; los puntos rojos representan fallos">
          <line x1="${margen.izquierda}" x2="${ancho - margen.derecha}" y1="${margen.superior}" y2="${margen.superior}" class="detalle-intervalo__guia" />
          <line x1="${margen.izquierda}" x2="${ancho - margen.derecha}" y1="${alto - margen.inferior}" y2="${alto - margen.inferior}" class="detalle-intervalo__guia" />
          <text x="0" y="${margen.superior + 4}" class="detalle-intervalo__eje">${escapeHtml(formatearMilisegundos(minimo))}</text>
          <text x="0" y="${alto - margen.inferior + 4}" class="detalle-intervalo__eje">${escapeHtml(formatearMilisegundos(maximo))}</text>
          <text x="${margen.izquierda}" y="${alto - 4}" class="detalle-intervalo__eje">${escapeHtml(formatearHoraCorta(serie[0].x))}</text>
          <text x="${ancho - margen.derecha}" y="${alto - 4}" text-anchor="end" class="detalle-intervalo__eje">${escapeHtml(formatearHoraCorta(serie.at(-1).x))}</text>
          <polyline points="${puntosSvg.join(' ')}" class="detalle-intervalo__linea" />
          ${fallosSvg}
        </svg>
      </figure>
    `;
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

function construirFechaLocalDesdeInput(valor, { finDelDia = false } = {}) {
  const texto = String(valor || '').trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) {
    const [ano, mes, dia] = texto.split('-').map((fragmento) => Number(fragmento));

    return new Date(
      ano,
      mes - 1,
      dia,
      finDelDia ? 23 : 0,
      finDelDia ? 59 : 0,
      finDelDia ? 59 : 0,
      finDelDia ? 999 : 0
    );
  }

  const fecha = new Date(texto);

  if (finDelDia && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(texto)) {
    fecha.setSeconds(59, 999);
  }

  return fecha;
}

function formatearFechaHoraInput(fecha) {
  const valor = fecha instanceof Date ? fecha : new Date(fecha);

  if (Number.isNaN(valor.getTime())) {
    return '';
  }

  const ano = valor.getFullYear();
  const mes = String(valor.getMonth() + 1).padStart(2, '0');
  const dia = String(valor.getDate()).padStart(2, '0');
  const hora = String(valor.getHours()).padStart(2, '0');
  const minuto = String(valor.getMinutes()).padStart(2, '0');

  return `${ano}-${mes}-${dia}T${hora}:${minuto}`;
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

function esFechaHoraInputValida(valor) {
  const texto = String(valor || '').trim();

  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(texto) &&
    !Number.isNaN(new Date(texto).getTime());
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

function formatearMilisegundos(valor) {
  if (!Number.isFinite(Number(valor))) {
    return 'Sin métrica';
  }

  return `${Number(valor).toFixed(1)} ms`;
}

function formatearHoraCorta(valor) {
  const fecha = new Date(Number(valor));
  if (Number.isNaN(fecha.getTime())) return '';
  return new Intl.DateTimeFormat('es-ES', {
    hour: '2-digit',
    minute: '2-digit'
  }).format(fecha);
}

function formatearDuracionHumana(valorMs) {
  const totalSegundos = Math.max(0, Math.round(Number(valorMs) / 1000));

  if (!Number.isFinite(totalSegundos)) return 'sin duración';
  if (totalSegundos < 60) return `${totalSegundos} s`;

  const minutos = Math.floor(totalSegundos / 60);
  const segundos = totalSegundos % 60;

  if (minutos < 60) return segundos > 0 ? `${minutos} min ${segundos} s` : `${minutos} min`;

  const horas = Math.floor(minutos / 60);
  const minutosRestantes = minutos % 60;
  if (horas < 24) return minutosRestantes > 0 ? `${horas} h ${minutosRestantes} min` : `${horas} h`;

  const dias = Math.floor(horas / 24);
  const horasRestantes = horas % 24;
  return horasRestantes > 0 ? `${dias} d ${horasRestantes} h` : `${dias} d`;
}

function colorPunto(evento) {
  if (evento?.exito) {
    return 'rgba(63, 107, 87, 0.86)';
  }

  if (String(evento?.codigoResultado || '').includes('timeout')) {
    return 'rgba(138, 100, 46, 0.88)';
  }

  return 'rgba(147, 74, 74, 0.88)';
}

function bordePunto(evento) {
  if (evento?.exito) {
    return 'rgba(63, 107, 87, 1)';
  }

  if (String(evento?.codigoResultado || '').includes('timeout')) {
    return 'rgba(138, 100, 46, 1)';
  }

  return 'rgba(147, 74, 74, 1)';
}

function resolverEstiloVela(punto) {
  if (punto?.tieneFallo) {
    return {
      relleno: 'rgba(173, 79, 79, 0.52)',
      borde: 'rgba(190, 93, 93, 0.96)'
    };
  }

  if (Number(punto?.cierre) < Number(punto?.apertura)) {
    return {
      relleno: 'rgba(63, 126, 90, 0.48)',
      borde: 'rgba(79, 149, 105, 0.96)'
    };
  }

  if (Number(punto?.cierre) > Number(punto?.apertura)) {
    return {
      relleno: 'rgba(169, 93, 93, 0.44)',
      borde: 'rgba(191, 107, 107, 0.96)'
    };
  }

  return {
    relleno: 'rgba(99, 133, 161, 0.44)',
    borde: 'rgba(116, 151, 180, 0.96)'
  };
}

function escapeHtml(texto) {
  return String(texto)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
