(function () {
  const modulo = document.querySelector('[data-agente-telemetria-grafico]');

  if (!modulo) {
    return;
  }

  inicializarTelemetriaAgente(modulo);
})();

function inicializarTelemetriaAgente(modulo) {
  const canvas = modulo.querySelector('[data-agente-telemetria-canvas]');
  const contenedorCanvas = canvas?.closest('.telemetria-grafico__canvas');
  const layoutGrafico = canvas?.closest('.telemetria-grafico__layout');
  const carrilesBooleanos = modulo.querySelector('[data-agente-telemetria-booleanos]');
  const estado = modulo.querySelector('[data-agente-telemetria-grafico-estado]');
  const datosNodo = modulo.querySelector('[data-agente-telemetria-grafico-datos]');
  const descripcion = modulo.querySelector(
    '[data-agente-telemetria-grafico-descripcion]'
  );
  const unidad = modulo.querySelector('[data-agente-telemetria-grafico-unidad]');
  const resumenPol = modulo.querySelector('[data-agente-telemetria-pol-resumen]');
  const lineaPol = modulo.querySelector('[data-agente-telemetria-pol-linea]');
  const detallePunto = {
    raiz: modulo.querySelector('[data-agente-telemetria-detalle]'),
    vacio: modulo.querySelector('[data-agente-telemetria-detalle-vacio]'),
    contenido: modulo.querySelector('[data-agente-telemetria-detalle-contenido]'),
    titulo: modulo.querySelector('[data-agente-telemetria-detalle-titulo]'),
    valor: modulo.querySelector('[data-agente-telemetria-detalle-valor]'),
    observado: modulo.querySelector('[data-agente-telemetria-detalle-observado]'),
    recibido: modulo.querySelector('[data-agente-telemetria-detalle-recibido]'),
    calidad: modulo.querySelector('[data-agente-telemetria-detalle-calidad]'),
    severidad: modulo.querySelector('[data-agente-telemetria-detalle-severidad]'),
    origen: modulo.querySelector('[data-agente-telemetria-detalle-origen]'),
    humano: modulo.querySelector('[data-agente-telemetria-detalle-humano]'),
    metadatos: modulo.querySelector('[data-agente-telemetria-detalle-metadatos]'),
    metadatosLista: modulo.querySelector('[data-agente-telemetria-detalle-metadatos-lista]')
  };
  const formulario = document.querySelector('[data-agente-telemetria-filtros]');
  const desdeLocal = formulario?.querySelector('[data-agente-telemetria-desde-local]');
  const hastaLocal = formulario?.querySelector('[data-agente-telemetria-hasta-local]');
  const desdeUtc = formulario?.querySelector('[data-agente-telemetria-desde-utc]');
  const hastaUtc = formulario?.querySelector('[data-agente-telemetria-hasta-utc]');
  const selectorSenal = formulario?.querySelector('[data-agente-telemetria-senal]');
  const selectorComparacion = formulario?.querySelector(
    '[data-agente-telemetria-comparar]'
  );
  const ayudaComparacion = formulario?.querySelector(
    '[data-agente-telemetria-comparar-ayuda]'
  );
  const botonesRango = formulario?.querySelectorAll(
    '[data-agente-telemetria-rango-horas]'
  ) || [];
  const botonConsultar = formulario?.querySelector('[data-agente-telemetria-consultar]');
  const seccionResultados = document.querySelector('[data-agente-telemetria-resultados]');
  const avisoSinLecturas = document.querySelector('[data-agente-telemetria-sin-lecturas]');
  const totalResultados = document.querySelector('[data-agente-telemetria-total-resultados]');
  const resumenHistorico = document.querySelector('[data-agente-telemetria-resumen-historico]');
  const totalHero = document.querySelector('[data-agente-telemetria-total-hero]');
  const ayudaTotalHero = document.querySelector('[data-agente-telemetria-total-ayuda]');
  const descripcionResultados = document.querySelector('[data-agente-telemetria-resultados-descripcion]');
  const ChartGlobal = window.Chart;
  const urlHistorico = modulo.dataset.urlHistorico;

  if (!canvas || !datosNodo) {
    return;
  }

  let chart = null;
  let datosActuales = leerDatosIniciales(datosNodo);

  actualizarOpcionesComparacion();
  actualizarControlesConsulta();
  selectorSenal?.addEventListener('change', function () {
    actualizarOpcionesComparacion();
    actualizarControlesConsulta();
    if (seccionResultados) seccionResultados.hidden = true;
    if (totalHero) totalHero.textContent = '—';
    if (ayudaTotalHero) ayudaTotalHero.textContent = 'Consulta pendiente.';
    if (resumenHistorico) resumenHistorico.textContent = 'Consulta pendiente';
  });

  aplicarDatos(datosActuales);
  inicializarFechasLocales();

  window.addEventListener('portal:themechange', function () {
    if (!chart) {
      return;
    }

    chart.data.datasets = construirDatasets(normalizarSeries(datosActuales));
    aplicarPaletaChart(chart);
    chart.update('none');
  });

  formulario?.addEventListener('submit', async function (evento) {
    evento.preventDefault();

    sincronizarCamposUtc();

    if (!urlHistorico) {
      mostrarEstado('No hay endpoint de histórico configurado.');
      return;
    }

    await cargarHistorico(urlHistorico, new FormData(formulario));
  });

  for (const boton of botonesRango) {
    boton.addEventListener('click', async function () {
      const horas = Number(boton.dataset.agenteTelemetriaRangoHoras);

      if (!Number.isFinite(horas) || horas <= 0) {
        return;
      }

      aplicarRangoRelativo(horas);
      formulario?.requestSubmit();
    });
  }

  function inicializarFechasLocales() {
    if (desdeLocal && desdeUtc?.value) {
      desdeLocal.value = convertirUtcADatetimeLocal(desdeUtc.value);
    }

    if (hastaLocal && hastaUtc?.value) {
      hastaLocal.value = convertirUtcADatetimeLocal(hastaUtc.value);
    }
  }

  function actualizarControlesConsulta() {
    const tieneSenal = Boolean(selectorSenal?.value);
    if (botonConsultar) botonConsultar.disabled = !tieneSenal;
    for (const boton of botonesRango) boton.disabled = !tieneSenal;
  }

  function actualizarOpcionesComparacion() {
    if (!selectorComparacion) {
      return;
    }

    const senalPrincipal = selectorSenal?.selectedOptions?.[0] || null;
    const idPrincipal = String(senalPrincipal?.value || '');
    const tipoPrincipal = String(senalPrincipal?.dataset.tipoDato || '');
    const unidadPrincipal = String(senalPrincipal?.dataset.unidad || '');
    let totalCompatibles = 0;

    for (const opcion of selectorComparacion.options) {
      const esCompatible = Boolean(
        idPrincipal &&
          ['numero', 'booleano', 'duracion', 'momento_utc'].includes(tipoPrincipal) &&
          String(opcion.value) !== idPrincipal &&
          String(opcion.dataset.tipoDato || '') === tipoPrincipal &&
          (
            ['duracion', 'momento_utc'].includes(tipoPrincipal) ||
            String(opcion.dataset.unidad || '') === unidadPrincipal
          )
      );

      opcion.hidden = !esCompatible;
      opcion.disabled = !esCompatible;

      if (!esCompatible) {
        opcion.selected = false;
      } else {
        totalCompatibles += 1;
      }
    }

    selectorComparacion.disabled = totalCompatibles === 0;
    actualizarAyudaComparacion({
      idPrincipal,
      tipoPrincipal,
      unidadPrincipal,
      totalCompatibles
    });
  }

  function actualizarAyudaComparacion({
    idPrincipal,
    tipoPrincipal,
    unidadPrincipal,
    totalCompatibles
  }) {
    if (!ayudaComparacion) {
      return;
    }

    if (!idPrincipal) {
      ayudaComparacion.textContent =
        'Selecciona una señal graficable para habilitar comparaciones.';
      return;
    }

    if (![
      'numero',
      'booleano',
      'duracion',
      'momento_utc'
    ].includes(tipoPrincipal)) {
      ayudaComparacion.textContent =
        'La señal seleccionada no admite comparación gráfica.';
      return;
    }

    if (totalCompatibles === 0) {
      ayudaComparacion.textContent =
        'No hay otras señales con el mismo tipo y unidad compatible.';
      return;
    }

    const etiquetaUnidad = tipoPrincipal === 'duracion'
      ? 'segundos implícitos'
      : tipoPrincipal === 'momento_utc'
        ? 'UTC implícito'
        : unidadPrincipal || 'sin unidad';
    ayudaComparacion.textContent =
      `${totalCompatibles} ${totalCompatibles === 1 ? 'señal compatible' : 'señales compatibles'}: ` +
      `tipo ${tipoPrincipal} y unidad ${etiquetaUnidad}.`;
  }

  function sincronizarCamposUtc() {
    if (desdeUtc && desdeLocal) {
      desdeUtc.value = convertirDatetimeLocalAUtc(desdeLocal.value);
    }

    if (hastaUtc && hastaLocal) {
      hastaUtc.value = convertirDatetimeLocalAUtc(hastaLocal.value);
    }
  }

  function aplicarRangoRelativo(horas) {
    const hasta = new Date();
    const desde = new Date(hasta.getTime() - horas * 60 * 60 * 1000);

    if (desdeLocal) {
      desdeLocal.value = convertirFechaADatetimeLocal(desde);
    }

    if (hastaLocal) {
      hastaLocal.value = convertirFechaADatetimeLocal(hasta);
    }

    sincronizarCamposUtc();
  }

  async function cargarHistorico(url, formData) {
    mostrarEstado('Cargando histórico...');

    try {
      const query = new URLSearchParams(formData);
      const respuesta = await fetchJson(`${url}?${query.toString()}`);
      datosActuales = respuesta.grafico || {};
      aplicarDatos(datosActuales, respuesta);
      sincronizarUrl(query);
    } catch (error) {
      mostrarEstado(error.message);
      window.portalToast?.show({
        tipo: 'error',
        titulo: 'Telemetría',
        cuerpo: error.message
      });
    }
  }

  function aplicarDatos(datos, respuesta = null) {
    actualizarResultadoConsulta(datos, respuesta);
    actualizarCabecera(datos);
    actualizarResumenPol(datos);
    actualizarResumenComparacion(datos);
    mostrarDetalleVacio();

    const tipoSerie = resolverTipoSerieTemporal(datos);

    contenedorCanvas?.classList.toggle(
      'telemetria-grafico__canvas--booleano',
      tipoSerie === 'booleano'
    );
    layoutGrafico?.classList.toggle(
      'telemetria-grafico__layout--booleano',
      tipoSerie === 'booleano'
    );

    if (!datos?.tieneSerieTemporal || !tipoSerie) {
      destruirChart();
      mostrarEstado(
        !datos?.senal
          ? 'Elige una señal para consultar su histórico.'
          : !datos?.observaciones?.length
            ? 'No hay lecturas de esta señal en el periodo consultado.'
            : 'La señal seleccionada no admite representación temporal. Se conserva como lectura estructurada sin gráfica.'
      );
      return;
    }

    if (tipoSerie === 'booleano') {
      destruirChart();
      const totalTramos = renderizarCarrilesBooleanos(datos);

      if (totalTramos === 0) {
        mostrarEstado('No hay tramos booleanos demostrables en el rango seleccionado.');
      } else {
        ocultarEstado(true);
      }

      actualizarLineaPolSinChart(datos);
      return;
    }

    limpiarCarrilesBooleanos();

    if (!ChartGlobal) {
      destruirChart();
      mostrarEstado('Chart.js no está disponible en esta pantalla.');
      return;
    }

    const series = normalizarSeries(datos);
    const puntos = series.flatMap((serie) => serie.puntos);

    if (puntos.length === 0) {
      destruirChart();
      mostrarEstado(tipoSerie === 'duracion'
        ? 'No hay duraciones válidas suficientes para pintar la gráfica.'
        : tipoSerie === 'momento_utc'
          ? 'No hay momentos UTC válidos suficientes para pintar la gráfica.'
          : 'No hay puntos numéricos suficientes para pintar la gráfica.');
      return;
    }

    ocultarEstado();
    const rangoX = obtenerRangoX(datos, puntos);

    if (!chart) {
      chart = crearChart(canvas, datos, series, rangoX, function (chartActual) {
        actualizarLineaPol(chartActual, datosActuales);
      }, function (observacion) {
        actualizarDetallePunto(observacion, datosActuales);
      });
      return;
    }

    chart.data.datasets = construirDatasets(series);
    chart.options.plugins.legend.display = series.length > 1;
    aplicarRangoXChart(chart, rangoX);
    configurarEscalaY(chart.options.scales.y, datos);
    chart.update();
  }

  function actualizarResultadoConsulta(datos, respuesta) {
    const tieneSenal = Boolean(datos?.senal);
    const total = Number(respuesta?.historico?.paginacion?.totalDevuelto ?? datos?.observaciones?.length ?? 0);
    if (seccionResultados) seccionResultados.hidden = !tieneSenal;
    modulo.hidden = !tieneSenal || total === 0;
    if (avisoSinLecturas) avisoSinLecturas.hidden = !tieneSenal || total > 0;
    if (totalResultados) totalResultados.textContent = `${total} ${total === 1 ? 'lectura' : 'lecturas'}`;
    if (resumenHistorico) resumenHistorico.textContent = tieneSenal
      ? `${total} ${total === 1 ? 'lectura' : 'lecturas'}`
      : 'Sin consulta';
    if (totalHero) totalHero.textContent = tieneSenal ? String(total) : '—';
    if (ayudaTotalHero) ayudaTotalHero.textContent = tieneSenal ? 'En la consulta actual.' : 'Elige una señal.';
    if (descripcionResultados && tieneSenal) {
      descripcionResultados.textContent = total === 0
        ? 'Prueba otro periodo o consulta una señal distinta.'
        : 'Evolución de la señal seleccionada con contexto de prueba de vida.';
    }
  }

  function actualizarCabecera(datos) {
    const senal = datos?.senal || null;

    if (descripcion) {
      descripcion.textContent = senal
        ? `Evolución de ${senal.nombreHumano || senal.codigoSenal}.`
        : 'Selecciona una señal para consultar observaciones históricas.';
    }

    if (unidad) {
      const unidadVisible = senal?.tipoDato === 'duracion'
        ? 'segundos'
        : senal?.tipoDato === 'momento_utc'
          ? 'momento UTC'
        : senal?.unidad || '';
      unidad.hidden = !unidadVisible;
      unidad.textContent = unidadVisible;
    }
  }

  function actualizarResumenPol(datos) {
    if (!resumenPol) {
      return;
    }

    const periodos = normalizarPeriodosPol(datos);

    if (periodos.length === 0) {
      resumenPol.innerHTML = `
        <span class="telemetria-grafico__pol-chip telemetria-grafico__pol-chip--sin-datos">POL sin periodo</span>
        ${renderizarAyudaPol()}
        <span class="telemetria-grafico__pol-texto">No hay prueba de vida registrada en el rango visible.</span>
      `;
      hidratarTooltipsPol(resumenPol);
      return;
    }

    const abiertos = periodos.filter((periodo) => periodo.abierto).length;
    const cerrados = periodos.length - abiertos;
    const heartbeats = periodos.reduce(
      (total, periodo) => total + Number(periodo.heartbeatsRecibidos || 0),
      0
    );
    const huecos = contarHuecosPol(periodos, datos);

    resumenPol.innerHTML = `
      <span class="telemetria-grafico__pol-chip telemetria-grafico__pol-chip--vivo">Cobertura POL</span>
      ${renderizarAyudaPol()}
      <span class="telemetria-grafico__pol-chip telemetria-grafico__pol-chip--cerrado">Hueco visible</span>
      <span class="telemetria-grafico__pol-texto">
        ${periodos.length} ${periodos.length === 1 ? 'periodo POL' : 'periodos POL'} ·
        ${abiertos} ${abiertos === 1 ? 'abierto' : 'abiertos'} ·
        ${cerrados} ${cerrados === 1 ? 'cierre' : 'cierres'} registrados ·
        ${huecos} ${huecos === 1 ? 'hueco' : 'huecos'} visibles ·
        ${heartbeats} heartbeats.
      </span>
      ${renderizarDetallePeriodosPol(periodos)}
    `;
    hidratarTooltipsPol(resumenPol);
  }

  function actualizarResumenComparacion(datos) {
    const rechazadas = datos?.comparacion?.senalesRechazadas || [];

    if (rechazadas.length === 0) {
      return;
    }

    window.portalToast?.show({
      tipo: 'warning',
      titulo: 'Comparador de señales',
      cuerpo: rechazadas
        .map((senal) => `${senal.codigoSenal || `#${senal.id}`}: ${senal.motivo}`)
        .join(' ')
    });
  }

  function mostrarEstado(mensaje) {
    if (estado) {
      estado.hidden = false;
      estado.textContent = mensaje;
    }

    if (canvas) {
      canvas.hidden = true;
    }

    if (carrilesBooleanos) {
      carrilesBooleanos.hidden = true;
    }
  }

  function ocultarEstado(mostrarBooleanos = false) {
    if (estado) {
      estado.hidden = true;
      estado.textContent = '';
    }

    if (canvas) {
      canvas.hidden = mostrarBooleanos;
    }

    if (carrilesBooleanos) {
      carrilesBooleanos.hidden = !mostrarBooleanos;
    }
  }

  function destruirChart() {
    if (chart) {
      chart.destroy();
      chart = null;
    }

    if (lineaPol) {
      lineaPol.hidden = true;
      lineaPol.innerHTML = '';
    }

    mostrarDetalleVacio();
  }

  function limpiarCarrilesBooleanos() {
    if (!carrilesBooleanos) {
      return;
    }

    carrilesBooleanos.hidden = true;
    carrilesBooleanos.innerHTML = '';
  }

  function renderizarCarrilesBooleanos(datos) {
    if (!carrilesBooleanos) {
      return 0;
    }

    const periodosPol = normalizarPeriodosPol(datos);
    const rango = obtenerRangoPol(datos, periodosPol);

    if (!rango) {
      limpiarCarrilesBooleanos();
      return 0;
    }

    const series = normalizarSeriesBooleanas(datos, periodosPol, rango);
    const totalTramos = series.reduce(
      (total, serie) => total + serie.segmentos.length,
      0
    );

    carrilesBooleanos.innerHTML = `
      ${series.map((serie, indiceSerie) => `
        <article class="telemetria-booleanos__fila">
          <header class="telemetria-booleanos__cabecera">
            <strong>${escapeHtml(serie.senal?.nombreHumano || serie.senal?.codigoSenal || 'Señal booleana')}</strong>
            <small>${escapeHtml(serie.senal?.codigoSenal || '')}${serie.principal ? ' · principal' : ' · comparación'}</small>
          </header>
          <div class="telemetria-grafico__pol-pista telemetria-booleanos__pista" aria-label="Cronología de ${escapeHtml(serie.senal?.codigoSenal || 'señal booleana')}">
            ${serie.segmentos.map((segmento, indiceTramo) =>
              renderizarTramoBooleano(segmento, rango, indiceSerie, indiceTramo, serie.senal)
            ).join('')}
          </div>
        </article>
      `).join('')}
      <div class="telemetria-booleanos__eje" aria-hidden="true">
        <time>${escapeHtml(formatearFechaCorta(rango.min))}</time>
        <time>${escapeHtml(formatearFechaCorta(rango.max))}</time>
      </div>
    `;
    carrilesBooleanos.hidden = false;
    hidratarTooltipsPol(carrilesBooleanos);

    for (const tramo of carrilesBooleanos.querySelectorAll('[data-booleano-serie]')) {
      const mostrarDetalle = function () {
        const serie = series[Number(tramo.dataset.booleanoSerie)];
        const segmento = serie?.segmentos?.[Number(tramo.dataset.booleanoTramo)];
        actualizarDetallePunto(segmento?.observacion || null, datos);
      };

      tramo.addEventListener('mouseenter', mostrarDetalle);
      tramo.addEventListener('focus', mostrarDetalle);
      tramo.addEventListener('click', mostrarDetalle);
      tramo.addEventListener('mouseleave', mostrarDetalleVacio);
      tramo.addEventListener('blur', mostrarDetalleVacio);
    }

    return totalTramos;
  }

  function actualizarLineaPolSinChart(datos) {
    const periodos = normalizarPeriodosPol(datos);
    const rango = obtenerRangoPol(datos, periodos);

    if (!rango) {
      ocultarLineaPol();
      return;
    }

    pintarLineaPol(periodos, rango.min, rango.max, 0, '100%');
  }

  function actualizarLineaPol(chartActual, datos) {
    if (!lineaPol || !chartActual?.chartArea || !chartActual.scales?.x) {
      return;
    }

    const periodos = normalizarPeriodosPol(datos);

    if (periodos.length === 0) {
      ocultarLineaPol();
      return;
    }

    const { chartArea, scales } = chartActual;
    const xMin = scales.x.min;
    const xMax = scales.x.max;
    pintarLineaPol(
      periodos,
      xMin,
      xMax,
      Math.max(0, chartArea.left),
      `${Math.max(1, chartArea.right - chartArea.left)}px`
    );
  }

  function pintarLineaPol(periodos, xMin, xMax, offset, width) {
    if (!lineaPol) {
      return;
    }

    const segmentos = fusionarSegmentosPol(periodos, xMin, xMax);
    const huecos = calcularHuecosPol(segmentos, xMin, xMax);

    if (segmentos.length === 0 && huecos.length === 0) {
      ocultarLineaPol();
      return;
    }

    lineaPol.hidden = false;
    lineaPol.style.setProperty('--telemetria-pol-offset', typeof offset === 'number' ? `${offset}px` : offset);
    lineaPol.style.setProperty('--telemetria-pol-width', width);
    lineaPol.innerHTML = `
      <div class="telemetria-grafico__pol-linea-cabecera">
        <span>Prueba de vida</span>
        <small>alineada al eje temporal</small>
      </div>
      <div class="telemetria-grafico__pol-pista" aria-label="Prueba de vida del agente en el rango visible">
        ${segmentos.map((segmento) => renderizarTramoPol({
          tramo: segmento,
          xMin,
          xMax,
          clase: 'telemetria-grafico__pol-tramo--presente',
          etiqueta: segmento.silencioDetectado
            ? 'Prueba de vida efectiva hasta último latido'
            : segmento.abierto
            ? 'Prueba de vida activa'
            : 'Prueba de vida registrada'
        })).join('')}
        ${huecos.map((hueco) => renderizarTramoPol({
          tramo: hueco,
          xMin,
          xMax,
          clase: 'telemetria-grafico__pol-tramo--hueco',
          etiqueta: 'Hueco sin prueba de vida visible'
        })).join('')}
      </div>
    `;
    hidratarTooltipsPol(lineaPol);
  }

  function ocultarLineaPol() {
    if (lineaPol) {
      lineaPol.hidden = true;
      lineaPol.innerHTML = '';
    }
  }

  function mostrarDetalleVacio() {
    if (detallePunto.vacio) {
      detallePunto.vacio.hidden = false;
    }

    if (detallePunto.contenido) {
      detallePunto.contenido.hidden = true;
    }
  }

  function actualizarDetallePunto(observacion, datos) {
    if (!detallePunto.raiz || !observacion) {
      mostrarDetalleVacio();
      return;
    }

    const senal = observacion.senal || datos?.senal || {};
    const valor = formatearValorObservacion(observacion, senal);

    if (detallePunto.vacio) {
      detallePunto.vacio.hidden = true;
    }

    if (detallePunto.contenido) {
      detallePunto.contenido.hidden = false;
    }

    asignarTexto(detallePunto.titulo, senal.nombreHumano || senal.codigoSenal || 'Observación');
    asignarTexto(detallePunto.valor, valor);
    asignarTexto(detallePunto.observado, formatearFecha(observacion.observadoEnUtc));
    asignarTexto(detallePunto.recibido, formatearFecha(observacion.recibidoEnUtc));
    asignarTexto(detallePunto.calidad, observacion.calidad || 'sin_calidad');
    asignarTexto(detallePunto.severidad, observacion.severidadDeclarada || 'info');
    asignarTexto(detallePunto.origen, observacion.origen || 'directa');
    asignarTexto(detallePunto.humano, observacion.detalleHumano || 'Sin detalle.');
    const tieneMetadatos = observacion.metadatos != null;
    if (detallePunto.metadatos) {
      detallePunto.metadatos.hidden = !tieneMetadatos;
    }
    renderizarMetadatosTelemetria(detallePunto.metadatosLista, observacion.metadatos);
  }
}

function renderizarMetadatosTelemetria(contenedor, metadatos) {
  if (!contenedor) return;
  contenedor.replaceChildren();
  if (metadatos == null) return;

  function representar(valor) {
    if (valor !== null && typeof valor === 'object') {
      const esLista = Array.isArray(valor);
      const entradas = Object.entries(valor);
      if (entradas.length) {
        const lista = document.createElement(esLista ? 'ol' : 'ul');
        lista.className = 'telemetria-metadatos__lista';
        for (const [clave, contenido] of entradas) {
          const item = document.createElement('li');
          if (!esLista) {
            const etiqueta = document.createElement('strong');
            etiqueta.textContent = `${clave || '(clave vacía)'}: `;
            item.append(etiqueta);
          }
          item.append(representar(contenido));
          lista.append(item);
        }
        return lista;
      }
      const vacio = document.createElement('span');
      vacio.className = 'text-body-secondary';
      vacio.textContent = esLista ? 'Lista vacía []' : 'Objeto vacío {}';
      return vacio;
    }
    const texto = document.createElement('span');
    texto.className = 'telemetria-metadatos__valor';
    texto.textContent = valor === null ? 'null'
      : typeof valor === 'string' ? (valor || 'Cadena vacía ""')
        : String(valor);
    return texto;
  }

  contenedor.append(representar(metadatos));
}

function crearChart(
  canvas,
  datos,
  series,
  rangoX,
  actualizarTimelinePol,
  actualizarDetallePunto
) {
  const paleta = obtenerPaletaChart();
  const chart = new window.Chart(canvas, {
    type: 'line',
    data: {
      datasets: construirDatasets(series)
    },
    plugins: [crearPluginTimelinePol()],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      parsing: false,
      onHover: function (_evento, elementos, chart) {
        const activo = elementos[0];

        if (!activo) {
          actualizarDetallePunto?.(null);
          return;
        }

        const punto = chart.data.datasets[activo.datasetIndex]?.data?.[activo.index];

        actualizarDetallePunto?.(punto?.sintetico ? null : punto?.observacion || null);
      },
      interaction: {
        mode: 'nearest',
        intersect: false
      },
      plugins: {
        legend: {
          display: series.length > 1,
          labels: {
            usePointStyle: true,
            boxWidth: 8,
            color: paleta.texto
          }
        },
        timelinePol: {
          actualizar: actualizarTimelinePol
        },
        tooltip: {
          filter: function (item) {
            return !item.raw?.sintetico && item.raw?.y != null;
          },
          callbacks: {
            title: function (items) {
              const punto = items[0]?.raw;
              return formatearFecha(punto?.observacion?.observadoEnUtc);
            },
            label: function (item) {
              const punto = item.raw || {};
              const observacion = punto.observacion || {};
              const senal = observacion.senal || datos.senal || {};

              return [
                `Señal: ${senal.nombreHumano || senal.codigoSenal || item.dataset.label}`,
                `Valor: ${formatearValorObservacion(observacion, senal, punto.y)}`,
                `Calidad: ${observacion.calidad || 'sin_calidad'}`,
                `Severidad: ${observacion.severidadDeclarada || 'info'}`,
                `Origen: ${observacion.origen || 'directa'}`,
                `Recibido: ${formatearFecha(observacion.recibidoEnUtc)}`,
                `Detalle: ${observacion.detalleHumano || 'Sin detalle.'}`
              ];
            }
          }
        }
      },
      scales: {
        x: {
          type: 'linear',
          min: rangoX?.min,
          max: rangoX?.max,
          ticks: {
            color: paleta.textoSuave,
            callback: function (valor) {
              return formatearFechaCorta(Number(valor));
            },
            maxTicksLimit: 7
          },
          grid: {
            color: paleta.rejilla
          },
          border: {
            color: paleta.borde
          }
        },
        y: {
          ...construirConfiguracionEscalaY(datos, paleta),
          grid: {
            color: paleta.rejilla
          },
          border: {
            color: paleta.borde
          }
        }
      }
    }
  });

  return chart;
}

function aplicarPaletaChart(chart) {
  const paleta = obtenerPaletaChart();

  chart.options.plugins.legend.labels.color = paleta.texto;
  chart.options.scales.x.ticks.color = paleta.textoSuave;
  chart.options.scales.y.ticks.color = paleta.textoSuave;
  chart.options.scales.x.grid.color = paleta.rejilla;
  chart.options.scales.y.grid.color = paleta.rejilla;
  chart.options.scales.x.border.color = paleta.borde;
  chart.options.scales.y.border.color = paleta.borde;
}

function construirConfiguracionEscalaY(datos, paleta) {
  return {
    ticks: {
      color: paleta.textoSuave,
      callback: function (valor) {
        if (datos.senal?.tipoDato === 'duracion') {
          return formatearDuracionHumana(valor);
        }

        if (datos.senal?.tipoDato === 'momento_utc') {
          return formatearMomentoUtcEje(valor);
        }

        return formatearNumero(valor, datos.senal?.unidad);
      }
    }
  };
}

function configurarEscalaY(escala, datos) {
  if (!escala) {
    return;
  }

  const configuracion = construirConfiguracionEscalaY(
    datos,
    obtenerPaletaChart()
  );

  delete escala.min;
  delete escala.max;

  if (Number.isFinite(configuracion.min)) {
    escala.min = configuracion.min;
  }

  if (Number.isFinite(configuracion.max)) {
    escala.max = configuracion.max;
  }

  escala.ticks = {
    ...(escala.ticks || {}),
    ...configuracion.ticks
  };
}

function obtenerPaletaChart() {
  const estilos = window.getComputedStyle(document.documentElement);
  const leer = function (variable, respaldo) {
    return String(estilos.getPropertyValue(variable) || '').trim() || respaldo;
  };
  const oscuro = document.documentElement.dataset.theme === 'dark';

  return {
    texto: leer('--texto', oscuro ? '#e5eaf0' : '#1f2937'),
    textoSuave: leer('--texto-suave', oscuro ? '#9aa7b5' : '#64748b'),
    borde: leer('--borde', oscuro ? '#303c49' : '#d9e0e8'),
    superficie: leer('--superficie', oscuro ? '#19212b' : '#f8fafc'),
    rejilla: oscuro
      ? 'rgba(154, 167, 181, 0.14)'
      : 'rgba(100, 116, 139, 0.1)'
  };
}

function obtenerRangoX(datos, puntos = []) {
  const desdeMs = fechaAMilisegundos(datos?.pol?.rango?.desdeUtc);
  const hastaMs = fechaAMilisegundos(datos?.pol?.rango?.hastaUtc);
  const valores = puntos
    .map((punto) => Number(punto.x))
    .filter(Number.isFinite);

  const minimoPuntos = valores.length > 0 ? Math.min(...valores) : null;
  const maximoPuntos = valores.length > 0 ? Math.max(...valores) : null;
  const min = Number.isFinite(desdeMs) ? desdeMs : minimoPuntos;
  const max = Number.isFinite(hastaMs) ? hastaMs : maximoPuntos;

  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    return null;
  }

  return { min, max };
}

function aplicarRangoXChart(chart, rangoX) {
  if (!chart?.options?.scales?.x) {
    return;
  }

  if (!rangoX) {
    delete chart.options.scales.x.min;
    delete chart.options.scales.x.max;
    return;
  }

  chart.options.scales.x.min = rangoX.min;
  chart.options.scales.x.max = rangoX.max;
}

function crearPluginTimelinePol() {
  return {
    id: 'timelinePol',
    afterRender(chart, _args, opciones) {
      if (typeof opciones?.actualizar === 'function') {
        opciones.actualizar(chart);
      }
    }
  };
}

function fusionarSegmentosPol(periodos, xMin, xMax) {
  const margenFusionMs = calcularMargenFusionPol(xMin, xMax);
  const segmentos = [];

  for (const periodo of periodos) {
    const inicio = Math.max(periodo.inicioMs, xMin);
    const fin = Math.min(periodo.finMs || xMax, xMax);

    if (!Number.isFinite(inicio) || !Number.isFinite(fin) || fin < xMin || inicio > xMax) {
      continue;
    }

    const segmento = {
      inicioMs: inicio,
      finMs: Math.max(fin, inicio),
      abierto: periodo.abierto,
      silencioDetectado: Boolean(periodo.silencioDetectado),
      periodos: [periodo]
    };
    const anterior = segmentos[segmentos.length - 1];

    if (anterior && segmento.inicioMs - anterior.finMs <= margenFusionMs) {
      anterior.finMs = Math.max(anterior.finMs, segmento.finMs);
      anterior.abierto = Boolean(anterior.abierto || segmento.abierto);
      anterior.silencioDetectado = Boolean(
        anterior.silencioDetectado || segmento.silencioDetectado
      );
      anterior.periodos.push(...segmento.periodos);
      continue;
    }

    segmentos.push(segmento);
  }

  return segmentos;
}

function calcularHuecosPol(segmentos, xMin, xMax) {
  const huecos = [];
  const margenFusionMs = calcularMargenFusionPol(xMin, xMax);
  let cursor = xMin;

  for (const segmento of segmentos) {
    if (segmento.inicioMs - cursor > margenFusionMs) {
      huecos.push({
        inicioMs: cursor,
        finMs: segmento.inicioMs
      });
    }

    cursor = Math.max(cursor, segmento.finMs);
  }

  if (xMax - cursor > margenFusionMs) {
    huecos.push({
      inicioMs: cursor,
      finMs: xMax
    });
  }

  return huecos;
}

function contarHuecosPol(periodos, datos = null) {
  if (periodos.length === 0) {
    return 0;
  }

  const rango = obtenerRangoPol(datos, periodos);

  if (!rango) {
    return 0;
  }

  return calcularHuecosPol(
    fusionarSegmentosPol(periodos, rango.min, rango.max),
    rango.min,
    rango.max
  ).length;
}

function obtenerRangoPol(datos, periodos = []) {
  const desdeMs = fechaAMilisegundos(datos?.pol?.rango?.desdeUtc);
  const hastaMs = fechaAMilisegundos(datos?.pol?.rango?.hastaUtc);

  if (Number.isFinite(desdeMs) && Number.isFinite(hastaMs) && hastaMs > desdeMs) {
    return {
      min: desdeMs,
      max: hastaMs
    };
  }

  const marcas = periodos
    .flatMap((periodo) => [periodo.inicioMs, periodo.finMs])
    .filter(Number.isFinite);

  if (marcas.length < 2) {
    return null;
  }

  const min = Math.min(...marcas);
  const max = Math.max(...marcas);

  return max > min ? { min, max } : null;
}

function calcularMargenFusionPol(xMin, xMax) {
  const rango = Math.max(0, xMax - xMin);

  if (!Number.isFinite(rango) || rango <= 0) {
    return 1000;
  }

  return 1000;
}

function renderizarTramoPol({
  tramo,
  xMin,
  xMax,
  clase,
  etiqueta
}) {
  const rango = xMax - xMin;

  if (!Number.isFinite(rango) || rango <= 0) {
    return '';
  }

  const inicio = Math.max(tramo.inicioMs, xMin);
  const fin = Math.min(tramo.finMs || xMax, xMax);
  const izquierda = Math.max(0, ((inicio - xMin) / rango) * 100);
  const ancho = Math.max(0.4, ((fin - inicio) / rango) * 100);

  if (!Number.isFinite(izquierda) || !Number.isFinite(ancho) || ancho <= 0) {
    return '';
  }

  const titulo = [
    `${etiqueta}: ${formatearFecha(new Date(inicio))} - ${formatearFecha(new Date(fin))}`,
    construirDetalleArranquesTramo(tramo)
  ].filter(Boolean).join(' · ');

  return `
    <span
      class="telemetria-grafico__pol-tramo ${clase}"
      style="left: ${izquierda.toFixed(4)}%; width: ${Math.min(ancho, 100).toFixed(4)}%;"
      data-bs-toggle="tooltip"
      data-bs-title="${escapeHtml(titulo)}"
      aria-label="${escapeHtml(titulo)}"
    ></span>
  `;
}

function construirDetalleArranquesTramo(tramo) {
  const periodos = Array.isArray(tramo?.periodos) ? tramo.periodos : [];
  if (periodos.length === 0) return '';
  const bootIds = periodos.map((periodo) => periodo.bootId || 'no declarado');
  return periodos.length === 1
    ? `Boot ID: ${bootIds[0]}`
    : `Periodos fusionados: ${periodos.length}; Boot IDs: ${bootIds.join(', ')}`;
}

function renderizarTramoBooleano(segmento, rango, indiceSerie, indiceTramo, senal) {
  const duracion = rango.max - rango.min;

  if (!Number.isFinite(duracion) || duracion <= 0) {
    return '';
  }

  const inicio = Math.max(segmento.inicioMs, rango.min);
  const fin = Math.min(segmento.finMs, rango.max);
  const izquierda = Math.max(0, ((inicio - rango.min) / duracion) * 100);
  const ancho = Math.max(0.4, ((fin - inicio) / duracion) * 100);

  if (!Number.isFinite(izquierda) || !Number.isFinite(ancho) || fin < inicio) {
    return '';
  }

  const observacion = segmento.observacion || {};
  const valor = segmento.valor ? 'Sí' : 'No';
  const titulo = [
    `${senal?.nombreHumano || senal?.codigoSenal || 'Señal'}: ${valor}`,
    `Tramo: ${formatearFecha(inicio)} - ${formatearFecha(fin)}`,
    `Observado: ${formatearFecha(observacion.observadoEnUtc)}`,
    `Recibido: ${formatearFecha(observacion.recibidoEnUtc)}`,
    `Calidad: ${observacion.calidad || 'sin_calidad'}`,
    `Severidad: ${observacion.severidadDeclarada || 'info'}`,
    `Origen: ${observacion.origen || 'directa'}`,
    observacion.detalleHumano || null
  ].filter(Boolean).join(' · ');

  return `
    <span
      class="telemetria-grafico__pol-tramo telemetria-booleanos__tramo telemetria-booleanos__tramo--${segmento.valor ? 'si' : 'no'}"
      style="left: ${izquierda.toFixed(4)}%; width: ${Math.min(ancho, 100 - izquierda).toFixed(4)}%;"
      tabindex="0"
      data-booleano-serie="${indiceSerie}"
      data-booleano-tramo="${indiceTramo}"
      data-bs-toggle="tooltip"
      data-bs-title="${escapeHtml(titulo)}"
      aria-label="${escapeHtml(titulo)}"
    ></span>
  `;
}

function renderizarDetallePeriodosPol(periodos) {
  return `
    <details class="telemetria-grafico__pol-periodos">
      <summary>Ver identidad de ${periodos.length} ${periodos.length === 1 ? 'periodo POL' : 'periodos POL'}</summary>
      <p class="telemetria-grafico__pol-periodos-ayuda">
        Un cambio de Boot ID confirma otro arranque declarado por el agente; ayuda a investigar cortes o reinicios, pero no demuestra por sí solo su causa.
      </p>
      <div class="telemetria-grafico__pol-periodos-lista">
        ${periodos.map((periodo, indice) => renderizarPeriodoPol(periodo, indice)).join('')}
      </div>
    </details>
  `;
}

function renderizarPeriodoPol(periodo, indice) {
  const estado = periodo.abierto ? 'Abierto' : 'Cerrado';
  const bootId = periodo.bootId || 'No declarado';
  return `
    <article class="telemetria-grafico__pol-periodo">
      <header>
        <strong>Periodo ${indice + 1}</strong>
        <span class="telemetria-grafico__pol-periodo-estado">${estado}</span>
      </header>
      <dl>
        <div><dt>Inicio</dt><dd>${escapeHtml(formatearFecha(periodo.inicioUtc))}</dd></div>
        <div><dt>Fin</dt><dd>${periodo.finUtc ? escapeHtml(formatearFecha(periodo.finUtc)) : 'En curso'}</dd></div>
        <div class="telemetria-grafico__pol-periodo-boot"><dt>Boot ID</dt><dd><code>${escapeHtml(bootId)}</code></dd></div>
      </dl>
    </article>
  `;
}

function renderizarAyudaPol() {
  return `
    <button
      type="button"
      class="telemetria-grafico__pol-ayuda"
      data-bs-toggle="tooltip"
      data-bs-title="POL significa Prueba de vida: confirma en qué tramos el agente estaba comunicado y operativo para enviar señales."
      aria-label="Qué significa POL"
    >
      <i class="bi bi-info-circle" aria-hidden="true"></i>
    </button>
  `;
}

function hidratarTooltipsPol(raiz) {
  if (!window.bootstrap?.Tooltip || !raiz) {
    return;
  }

  for (const nodo of raiz.querySelectorAll('[data-bs-toggle="tooltip"]')) {
    const instancia = window.bootstrap.Tooltip.getInstance(nodo);

    if (instancia) {
      instancia.dispose();
    }

    new window.bootstrap.Tooltip(nodo);
  }
}

function leerDatosIniciales(datosNodo) {
  try {
    return JSON.parse(datosNodo.textContent || '{}');
  } catch (_error) {
    return {};
  }
}

async function fetchJson(url, opciones = {}) {
  const respuesta = await fetch(url, {
    ...opciones,
    headers: {
      accept: 'application/json',
      'x-requested-with': 'XMLHttpRequest',
      ...(opciones.headers || {})
    }
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

function sincronizarUrl(query) {
  const url = new URL(window.location.href);

  for (const clave of ['senalId', 'desdeUtc', 'hastaUtc', 'limite', 'orden']) {
    const valor = String(query.get(clave) || '').trim();

    if (valor) {
      url.searchParams.set(clave, valor);
    } else {
      url.searchParams.delete(clave);
    }
  }

  url.searchParams.delete('compararSenalIds');

  for (const valor of query.getAll('compararSenalIds')) {
    if (String(valor || '').trim()) {
      url.searchParams.append('compararSenalIds', valor);
    }
  }

  window.history.replaceState({}, '', url);
}

function normalizarSeries(datos) {
  const principal = {
    senal: datos?.senal || null,
    principal: true,
    puntos: normalizarPuntosSerie({
      observaciones: datos?.observaciones || [],
      senal: datos?.senal || null,
      principal: true
    })
  };
  const comparadas = (datos?.comparacion?.series || []).map((serie) => ({
    senal: serie.senal,
    principal: false,
    puntos: normalizarPuntosSerie({
      observaciones: serie.observaciones || [],
      senal: serie.senal,
      principal: false
    })
  }));

  return [principal, ...comparadas].filter((serie) => serie.puntos.length > 0);
}

function resolverTipoSerieTemporal(datos) {
  const tipoDeclarado = String(datos?.tipoSerieTemporal || '');

  if (['numero', 'booleano', 'duracion', 'momento_utc'].includes(tipoDeclarado)) {
    return tipoDeclarado;
  }

  const tipoSenal = String(datos?.senal?.tipoDato || '');

  return datos?.tieneSerieTemporal && [
    'numero',
    'booleano',
    'duracion',
    'momento_utc'
  ].includes(tipoSenal)
    ? tipoSenal
    : null;
}

function normalizarPuntosSerie({ observaciones, senal, principal }) {
  const lista = Array.isArray(observaciones)
    ? observaciones
    : [];

  return lista
    .map((observacion) => {
      const fecha = new Date(observacion.observadoEnUtc || '');
      const tipoDato = observacion.tipoDato || senal?.tipoDato;
      const valor = tipoDato === 'momento_utc'
        ? fechaAMilisegundos(observacion.valorMomentoUtc)
        : Number(tipoDato === 'duracion'
            ? observacion.valorDuracion
            : observacion.valorNumero);

      if (Number.isNaN(fecha.getTime()) || !Number.isFinite(valor)) {
        return null;
      }

      return {
        x: fecha.getTime(),
        y: valor,
        relevante: observacion.severidadDeclarada &&
          observacion.severidadDeclarada !== 'info',
        observacion: {
          ...observacion,
          senal,
          principal
        }
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.x - b.x);
}

function normalizarSeriesBooleanas(datos, periodosPol, rangoVisible) {
  const candidatas = [
    {
      senal: datos?.senal || null,
      observaciones: datos?.observaciones || [],
      principal: true
    },
    ...(datos?.comparacion?.series || []).map((serie) => ({
      senal: serie.senal || null,
      observaciones: serie.observaciones || [],
      principal: false
    }))
  ];

  return candidatas
    .filter((serie) => serie.senal)
    .map((serie) => ({
      senal: serie.senal,
      principal: serie.principal,
      segmentos: construirSegmentosBooleanos({
        observaciones: serie.observaciones,
        senal: serie.senal,
        principal: serie.principal,
        periodosPol,
        rangoVisible
      })
    }));
}

function construirSegmentosBooleanos({
  observaciones,
  senal,
  principal,
  periodosPol,
  rangoVisible
}) {
  const lista = (Array.isArray(observaciones)
    ? observaciones
    : [])
    .map((observacion) => {
      const inicioMs = fechaAMilisegundos(observacion.observadoEnUtc);
      const valor = observacion.valorBooleano;

      if (!Number.isFinite(inicioMs) || typeof valor !== 'boolean') {
        return null;
      }

      return {
        inicioMs,
        vigenteHastaMs: fechaAMilisegundos(observacion.vigenteHastaUtc),
        periodoVidaPolId: observacion.periodoVidaPolId ?? null,
        valor,
        observacion
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.inicioMs - b.inicioMs);
  const segmentos = [];

  for (let indice = 0; indice < lista.length; indice += 1) {
    const actual = lista[indice];
    const siguiente = lista[indice + 1] || null;
    const esRuntime = actual.observacion.origen === 'runtime';
    const periodoPol = resolverPeriodoPolObservacion(actual, periodosPol);

    if (
      (!esRuntime && !periodoPol) ||
      (rangoVisible &&
        (actual.inicioMs < rangoVisible.min || actual.inicioMs > rangoVisible.max))
    ) {
      continue;
    }

    const vigenteHastaDemostrable = Number.isFinite(actual.vigenteHastaMs)
      ? Math.max(actual.inicioMs, actual.vigenteHastaMs)
      : null;
    const limiteContextualMs = esRuntime
      ? rangoVisible?.max
      : periodoPol?.finMs;
    const finales = [
      limiteContextualMs,
      vigenteHastaDemostrable,
      siguiente?.inicioMs
    ]
      .filter((valor) => Number.isFinite(valor) && valor >= actual.inicioMs);
    const finMs = finales.length > 0
      ? Math.min(...finales)
      : actual.inicioMs;

    segmentos.push({
      inicioMs: actual.inicioMs,
      finMs,
      valor: actual.valor,
      observacion: {
        ...actual.observacion,
        valorTexto: actual.observacion.valorTexto || (actual.valor ? 'Sí' : 'No'),
        senal,
        principal
      }
    });
  }

  return segmentos;
}

function resolverPeriodoPolObservacion(observacion, periodosPol) {
  const idPeriodo = String(observacion.periodoVidaPolId ?? '');
  const porIdentidad = idPeriodo
    ? periodosPol.find((periodo) => String(periodo.id ?? '') === idPeriodo)
    : null;

  if (
    porIdentidad &&
    observacion.inicioMs >= porIdentidad.inicioMs &&
    (!Number.isFinite(porIdentidad.finMs) ||
      observacion.inicioMs <= porIdentidad.finMs)
  ) {
    return porIdentidad;
  }

  return periodosPol.find((periodo) =>
    observacion.inicioMs >= periodo.inicioMs &&
      (!Number.isFinite(periodo.finMs) || observacion.inicioMs <= periodo.finMs)
  ) || null;
}

function construirDatasets(series) {
  return series.map((serie, indice) => {
    const color = colorSerie(indice);
    const esMomentoUtc = serie.senal?.tipoDato === 'momento_utc';

    return {
      label: construirEtiquetaSerie(serie.senal),
      data: serie.puntos,
      parsing: false,
      borderColor: color.borde,
      backgroundColor: serie.principal ? color.fondo : 'rgba(255, 255, 255, 0)',
      borderWidth: serie.principal ? 2 : 1.8,
      borderDash: serie.principal ? [] : [6, 4],
      pointRadius: function (contexto) {
        if (esMomentoUtc && !contexto.raw?.observacion) {
          return 0;
        }

        return contexto.raw?.relevante ? 5 : 3;
      },
      pointHoverRadius: 7,
      pointBackgroundColor: function (contexto) {
        const severidad = contexto.raw?.observacion?.severidadDeclarada;
        return severidad && severidad !== 'info'
          ? colorPorSeveridad(severidad)
          : color.borde;
      },
      pointBorderColor: obtenerPaletaChart().superficie,
      pointBorderWidth: 1,
      stepped: esMomentoUtc ? 'after' : false,
      tension: esMomentoUtc ? 0 : 0.18,
      spanGaps: false,
      fill: esMomentoUtc ? false : serie.principal
    };
  });
}

function colorSerie(indice) {
  const colores = [
    {
      borde: 'rgba(82, 107, 132, 0.82)',
      fondo: 'rgba(82, 107, 132, 0.12)'
    },
    {
      borde: 'rgba(43, 108, 176, 0.82)',
      fondo: 'rgba(43, 108, 176, 0.12)'
    },
    {
      borde: 'rgba(126, 87, 194, 0.82)',
      fondo: 'rgba(126, 87, 194, 0.12)'
    },
    {
      borde: 'rgba(198, 98, 45, 0.84)',
      fondo: 'rgba(198, 98, 45, 0.12)'
    }
  ];

  return colores[indice % colores.length];
}

function normalizarPeriodosPol(datos) {
  const periodos = Array.isArray(datos?.pol?.periodos)
    ? datos.pol.periodos
    : [];

  return periodos
    .map((periodo) => {
      const inicio = new Date(periodo.inicioUtc || '');
      const fin = periodo.finUtc ? new Date(periodo.finUtc) : null;
      const finEfectivo = periodo.finEfectivoUtc
        ? new Date(periodo.finEfectivoUtc)
        : fin;

      if (Number.isNaN(inicio.getTime())) {
        return null;
      }

      return {
        ...periodo,
        inicioMs: inicio.getTime(),
        finMs: finEfectivo && !Number.isNaN(finEfectivo.getTime())
          ? finEfectivo.getTime()
          : null,
        abierto: Boolean(periodo.abierto || !periodo.finUtc)
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.inicioMs - b.inicioMs);
}

function construirEtiquetaSerie(senal) {
  const nombre = senal?.nombreHumano || senal?.codigoSenal || 'Señal';
  const unidad = senal?.tipoDato === 'duracion'
    ? ' (duración)'
    : senal?.tipoDato === 'momento_utc'
      ? ' (momento UTC)'
    : senal?.unidad ? ` (${senal.unidad})` : '';

  return `${nombre}${unidad}`;
}

function colorPorSeveridad(severidad) {
  if (severidad === 'critica' || severidad === 'error') {
    return 'rgba(147, 74, 74, 0.92)';
  }

  if (severidad === 'advertencia' || severidad === 'warn') {
    return 'rgba(138, 100, 46, 0.92)';
  }

  return 'rgba(63, 107, 87, 0.92)';
}

function formatearNumero(valor, unidad = '') {
  const numero = Number(valor);

  if (!Number.isFinite(numero)) {
    return 'sin valor';
  }

  const texto = new Intl.NumberFormat('es-ES', {
    maximumFractionDigits: Math.abs(numero) >= 100 ? 0 : 2
  }).format(numero);

  return unidad ? `${texto} ${unidad}` : texto;
}

function formatearValorObservacion(observacion = {}, senal = {}, valorAlternativo = null) {
  const tipoDato = observacion.tipoDato || senal.tipoDato;

  if (tipoDato === 'duracion') {
    const valor = observacion.valorDuracion ?? valorAlternativo;
    const humana = formatearDuracionHumana(valor);
    const exacta = formatearDuracionExacta(valor);

    return humana === exacta ? humana : `${humana} (${exacta})`;
  }

  if (tipoDato === 'momento_utc') {
    return formatearMomentoUtc(
      observacion.valorMomentoUtc ?? valorAlternativo,
      true
    );
  }

  return observacion.valorTexto ||
    formatearNumero(observacion.valorNumero ?? valorAlternativo, senal.unidad);
}

function formatearDuracionHumana(valor) {
  const segundos = Number(valor);

  if (!Number.isFinite(segundos) || segundos < 0) {
    return 'sin valor';
  }

  if (segundos === 0) {
    return '0 s';
  }

  if (segundos < 1) {
    return `${formatearDecimalDuracion(segundos * 1000, 3)} ms`;
  }

  const unidades = [
    ['a', 31_536_000],
    ['d', 86_400],
    ['h', 3_600],
    ['min', 60]
  ];
  const partes = [];
  let restante = segundos;

  for (const [etiqueta, factor] of unidades) {
    const cantidad = Math.floor(restante / factor);

    if (cantidad > 0) {
      partes.push(`${cantidad} ${etiqueta}`);
      restante -= cantidad * factor;
    }

    if (partes.length === 2) {
      break;
    }
  }

  if (partes.length < 2 && restante > 0) {
    partes.push(`${formatearDecimalDuracion(restante, 4)} s`);
  }

  return partes.join(' ') || `${formatearDecimalDuracion(segundos, 4)} s`;
}

function formatearDuracionExacta(valor) {
  const segundos = Number(valor);

  return Number.isFinite(segundos) && segundos >= 0
    ? `${String(segundos)} s`
    : 'sin valor';
}

function formatearDecimalDuracion(valor, maximoDecimales) {
  return new Intl.NumberFormat('es-ES', {
    maximumFractionDigits: maximoDecimales,
    useGrouping: true
  }).format(valor);
}

function formatearMomentoUtc(valor, incluirCanonico = false) {
  const instante = fechaAMilisegundos(valor);

  if (!Number.isFinite(instante)) {
    return 'sin valor';
  }

  const local = formatearFecha(new Date(instante));
  const canonico = typeof valor === 'string'
    ? valor
    : new Date(instante).toISOString();

  return incluirCanonico ? `${local} · UTC ${canonico}` : local;
}

function formatearMomentoUtcEje(valor) {
  const fecha = new Date(Number(valor));

  if (Number.isNaN(fecha.getTime())) {
    return '';
  }

  return new Intl.DateTimeFormat('es-ES', {
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(fecha);
}

function formatearFecha(valor) {
  if (!valor) {
    return 'sin fecha';
  }

  if (window.portalFechas?.formatear) {
    return window.portalFechas.formatear(valor) || String(valor);
  }

  const fecha = valor instanceof Date ? valor : new Date(valor);

  if (Number.isNaN(fecha.getTime())) {
    return String(valor);
  }

  return fecha.toLocaleString('es-ES');
}

function fechaAMilisegundos(valor) {
  if (!valor) {
    return null;
  }

  const fecha = valor instanceof Date ? valor : new Date(valor);

  return Number.isNaN(fecha.getTime()) ? null : fecha.getTime();
}

function formatearFechaCorta(valor) {
  const fecha = new Date(valor);

  if (Number.isNaN(fecha.getTime())) {
    return '';
  }

  return fecha.toLocaleString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function convertirUtcADatetimeLocal(valor) {
  const fecha = new Date(valor);

  if (Number.isNaN(fecha.getTime())) {
    return '';
  }

  return convertirFechaADatetimeLocal(fecha);
}

function convertirDatetimeLocalAUtc(valor) {
  if (!valor) {
    return '';
  }

  const fecha = new Date(valor);

  if (Number.isNaN(fecha.getTime())) {
    return '';
  }

  return fecha.toISOString();
}

function convertirFechaADatetimeLocal(fecha) {
  if (!(fecha instanceof Date) || Number.isNaN(fecha.getTime())) {
    return '';
  }

  const fechaLocal = new Date(
    fecha.getTime() - fecha.getTimezoneOffset() * 60 * 1000
  );

  return fechaLocal.toISOString().slice(0, 19);
}

function asignarTexto(nodo, texto) {
  if (nodo) {
    nodo.textContent = texto;
  }
}

function escapeHtml(texto) {
  return String(texto ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
