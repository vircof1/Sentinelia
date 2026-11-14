(function () {
  const modulo = document.querySelector('[data-monitor-remoto-grafica]');
  const canvas = modulo?.querySelector('[data-monitor-remoto-grafica-canvas]');
  const datosNodo = modulo?.querySelector('[data-monitor-remoto-grafica-datos]');
  const detalle = modulo?.querySelector('[data-monitor-remoto-grafica-detalle]');
  const barraEstado = modulo?.querySelector('[data-monitor-remoto-estado-consolidado]');

  if (!modulo || !canvas || !datosNodo || !detalle || !barraEstado || !window.Chart) return;

  const datos = parsearDatos(datosNodo.textContent) || {};
  const entradas = Array.isArray(datos?.entradas) ? datos.entradas : [];
  const puntosDuracion = construirPuntosDuracion(entradas);
  const limitesTemporales = calcularLimitesTemporales(entradas);
  const maximoDuracion = puntosDuracion.reduce(
    (maximo, punto) => Math.max(maximo, Number(punto.y || 0)),
    0
  );

  const chart = new window.Chart(canvas, {
    type: 'line',
    data: {
      datasets: [
        {
          label: 'Duración de ejecución',
          data: puntosDuracion,
          parsing: false,
          yAxisID: 'duracion',
          borderColor: 'rgba(82, 107, 132, 0.62)',
          backgroundColor: 'rgba(82, 107, 132, 0.14)',
          borderWidth: 2,
          pointRadius: 5,
          pointHoverRadius: 7,
          pointBackgroundColor: puntosDuracion.map((punto) =>
            punto.entrada?.exito ? '#4f8a68' : '#c96b6b'
          ),
          pointBorderColor: puntosDuracion.map((punto) =>
            punto.entrada?.exito ? '#326046' : '#8e4141'
          ),
          pointStyle: puntosDuracion.map((punto) =>
            punto.entrada?.exito ? 'circle' : 'triangle'
          ),
          tension: 0.18,
          spanGaps: false
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'nearest', intersect: true },
      plugins: {
        legend: { position: 'bottom' },
        tooltip: {
          callbacks: {
            title: function (items) {
              const entrada = items[0]?.raw?.entrada;
              return formatearFecha(entrada?.fechaUtc || entrada?.desdeUtc);
            },
            label: function (item) {
              const entrada = item.raw?.entrada;
              if (!entrada) return '';
              if (entrada.tipoRegistro === 'evento') {
                return [
                  `Duración: ${formatearDuracion(entrada.duracionTotalMs)}`,
                  `Estado: ${entrada.estado || 'no declarado'}`,
                  `Resultado: ${entrada.codigo || entrada.mensaje || 'sin resultado'}`
                ];
              }
              return [
                `Estado: ${entrada.estado || entrada.causa || 'desconocido'}`,
                `Desde: ${formatearFecha(entrada.desdeUtc)}`,
                `Hasta: ${formatearFecha(entrada.hastaUtc)}`
              ];
            }
          }
        }
      },
      scales: {
        x: {
          type: 'linear',
          min: limitesTemporales?.min,
          max: limitesTemporales?.max,
          ticks: { callback: (valor) => formatearMarcaCorta(valor) }
        },
        duracion: {
          reverse: true,
          min: 0,
          max: maximoDuracion > 0 ? Math.ceil(maximoDuracion * 1.15) : 1000,
          position: 'left',
          title: { display: true, text: 'Duración' },
          ticks: { callback: (valor) => `${Math.round(Number(valor))} ms` }
        }
      },
      onHover: function (_evento, elementos) {
        mostrarElemento(chart, elementos, detalle, datos.monitor);
      },
      onClick: function (_evento, elementos) {
        mostrarElemento(chart, elementos, detalle, datos.monitor);
      }
    },
    plugins: [{
      id: 'estado-consolidado-remoto',
      afterLayout: (chartActual) => pintarBarraEstado(
        barraEstado,
        chartActual,
        entradas,
        detalle,
        datos.monitor
      )
    }]
  });

  const ultimo = [...entradas]
    .filter((entrada) => fechaMilisegundos(entrada.fechaUtc || entrada.desdeUtc) !== null)
    .sort((a, b) => fechaMilisegundos(a.fechaUtc || a.desdeUtc) -
      fechaMilisegundos(b.fechaUtc || b.desdeUtc))
    .at(-1);
  pintarDetalle(detalle, ultimo || null, datos.monitor);
})();

function construirPuntosDuracion(entradas) {
  const puntos = [];
  for (const entrada of entradas) {
    if (entrada?.tipoRegistro === 'rangoHistorico') {
      agregarHueco(puntos, entrada);
      continue;
    }
    if (entrada?.tipoRegistro !== 'evento') continue;
    const x = fechaMilisegundos(entrada.fechaUtc);
    if (entrada.duracionTotalMs === null || entrada.duracionTotalMs === undefined) continue;
    const y = Number(entrada.duracionTotalMs);
    if (x !== null && Number.isFinite(y) && y >= 0) puntos.push({ x, y, entrada });
  }
  return puntos.sort((a, b) => a.x - b.x);
}

function agregarHueco(puntos, entrada) {
  const desde = fechaMilisegundos(entrada.desdeUtc);
  const hasta = fechaMilisegundos(entrada.hastaUtc);
  if (desde !== null) puntos.push({ x: desde, y: null, entrada });
  if (hasta !== null) puntos.push({ x: hasta, y: null, entrada });
}

function claseEstado(valor) {
  const estado = String(valor || '').trim().toLowerCase();
  if (['disponible', 'ok', 'normal', 'operativo', 'operativocompleto'].includes(estado)) return 'disponible';
  if (['degradado', 'advertencia', 'warning'].includes(estado)) return 'degradado';
  if (['indisponible', 'fallo', 'error', 'critico', 'crítico'].includes(estado)) return 'indisponible';
  return 'desconocido';
}

function calcularLimitesTemporales(entradas) {
  const marcas = entradas.flatMap((entrada) => [
    fechaMilisegundos(entrada?.fechaUtc || entrada?.desdeUtc),
    fechaMilisegundos(entrada?.hastaUtc)
  ]).filter((valor) => valor !== null);
  if (marcas.length === 0) return null;
  const min = Math.min(...marcas);
  const max = Math.max(...marcas);
  return max > min ? { min, max } : { min: min - 30000, max: max + 30000 };
}

function pintarBarraEstado(contenedor, chart, entradas, detalle, monitor) {
  if (!chart?.chartArea || !chart.scales?.x) return;
  const xMin = Number(chart.scales.x.min);
  const xMax = Number(chart.scales.x.max);
  const rango = xMax - xMin;
  if (!Number.isFinite(rango) || rango <= 0) return;
  const tramos = entradas.filter((entrada) => entrada?.tipoRegistro === 'tramoHistorico')
    .map((entrada) => ({
      entrada,
      inicio: fechaMilisegundos(entrada.desdeUtc),
      fin: fechaMilisegundos(entrada.hastaUtc)
    }))
    .filter((tramo) => tramo.inicio !== null && tramo.fin !== null);
  for (const nodo of contenedor.querySelectorAll('[data-bs-toggle="tooltip"]')) {
    window.bootstrap?.Tooltip?.getInstance(nodo)?.dispose();
  }
  contenedor.style.setProperty('--estado-remoto-offset', `${Math.max(0, chart.chartArea.left)}px`);
  contenedor.style.setProperty(
    '--estado-remoto-width',
    `${Math.max(1, chart.chartArea.right - chart.chartArea.left)}px`
  );
  contenedor.innerHTML = `
    <div class="estado-consolidado-remoto__cabecera">
      <span>Estado consolidado</span><small>alineado al eje temporal</small>
    </div>
    <div class="estado-consolidado-remoto__pista" aria-label="Estado consolidado del monitor en el rango visible">
      ${tramos.map((tramo, indice) => renderizarTramoEstado(
        { ...tramo, indice }, xMin, xMax
      )).join('')}
    </div>
  `;
  for (const nodo of contenedor.querySelectorAll('[data-estado-remoto-indice]')) {
    const tramo = tramos[Number(nodo.dataset.estadoRemotoIndice)];
    nodo.addEventListener('click', () => pintarDetalle(detalle, tramo?.entrada, monitor));
    if (window.bootstrap?.Tooltip) new window.bootstrap.Tooltip(nodo);
  }
}

function renderizarTramoEstado(tramo, xMin, xMax) {
  const inicio = Math.max(tramo.inicio, xMin);
  const fin = Math.min(tramo.fin, xMax);
  const rango = xMax - xMin;
  const izquierda = Math.max(0, ((inicio - xMin) / rango) * 100);
  const ancho = Math.max(0.4, ((Math.max(fin, inicio) - inicio) / rango) * 100);
  const estado = String(tramo.entrada.estado || 'desconocido');
  const titulo = `${estado}: ${formatearFecha(tramo.entrada.desdeUtc)} - ${formatearFecha(tramo.entrada.hastaUtc)}`;
  return `<button type="button"
    class="estado-consolidado-remoto__tramo estado-consolidado-remoto__tramo--${claseEstado(estado)}"
    style="left:${izquierda.toFixed(4)}%;width:${Math.min(ancho, 100).toFixed(4)}%"
    data-estado-remoto-indice="${tramo.indice}"
    data-bs-toggle="tooltip" data-bs-title="${escapeHtml(titulo)}"
    aria-label="${escapeHtml(titulo)}"></button>`;
}

function mostrarElemento(chart, elementos, detalle, monitor) {
  if (!Array.isArray(elementos) || elementos.length === 0) return;
  const elemento = elementos[0];
  const entrada = chart.data.datasets[elemento.datasetIndex]?.data[elemento.index]?.entrada;
  pintarDetalle(detalle, entrada || null, monitor);
}

function pintarDetalle(contenedor, entrada, monitor = {}) {
  if (!entrada) {
    contenedor.innerHTML = '<h4>Detalle del punto</h4><p class="texto-apoyo">No hay puntos representables en la ventana recibida.</p>';
    return;
  }
  const titulo = entrada.tipoRegistro === 'evento'
    ? 'Ejecución remota'
    : entrada.tipoRegistro === 'tramoHistorico'
      ? 'Tramo consolidado'
      : 'Intervalo no disponible';
  const fecha = entrada.fechaUtc || entrada.desdeUtc;
  contenedor.innerHTML = `
    <h4>${escapeHtml(monitor?.nombre || 'Monitor remoto')}</h4>
    <div class="d-flex flex-wrap gap-2">
      <span class="insignia-monitor insignia-monitor--suave">${escapeHtml(titulo)}</span>
      <span class="insignia-monitor ${entrada.exito === false ? 'insignia-monitor--alerta' : 'insignia-monitor--ok'}">${escapeHtml(entrada.estado || entrada.causa || 'Sin estado')}</span>
    </div>
    <div class="metadatos-configuracion">
      <span>Fecha: <code>${escapeHtml(formatearFecha(fecha))}</code></span>
      ${entrada.duracionTotalMs != null ? `<span>Duración: <code>${escapeHtml(formatearDuracion(entrada.duracionTotalMs))}</code></span>` : ''}
      ${entrada.codigo ? `<span>Resultado: <code>${escapeHtml(entrada.codigo)}</code></span>` : ''}
      ${entrada.mensaje ? `<span>Detalle: ${escapeHtml(entrada.mensaje)}</span>` : ''}
      ${entrada.desdeUtc ? `<span>Desde: <code>${escapeHtml(formatearFecha(entrada.desdeUtc))}</code></span>` : ''}
      ${entrada.hastaUtc ? `<span>Hasta: <code>${escapeHtml(formatearFecha(entrada.hastaUtc))}</code></span>` : ''}
    </div>
  `;
}

function parsearDatos(texto) {
  try { return JSON.parse(String(texto || '')); } catch { return null; }
}

function fechaMilisegundos(valor) {
  const fecha = Date.parse(String(valor || ''));
  return Number.isFinite(fecha) ? fecha : null;
}

function formatearMarcaCorta(valor) {
  const fecha = new Date(Number(valor));
  if (Number.isNaN(fecha.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
  }).format(fecha);
}

function formatearFecha(valor) {
  if (!valor) return 'Sin fecha';
  return window.portalFechas?.formatear?.(valor) || new Date(valor).toLocaleString();
}

function formatearDuracion(valor) {
  const numero = Number(valor);
  return Number.isFinite(numero) ? `${Math.round(numero)} ms` : 'Sin duración';
}

function escapeHtml(valor) {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
