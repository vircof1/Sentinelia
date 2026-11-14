(function () {
  const formulario = document.querySelector('[data-telemetria-remota-actividad-filtros]');
  inicializarFiltros(formulario);
  const modulo = document.querySelector('[data-telemetria-remota-actividad]');
  if (!modulo || !window.Chart) return;

  const canvas = modulo.querySelector('[data-telemetria-remota-actividad-canvas]');
  const datosNodo = modulo.querySelector('[data-telemetria-remota-actividad-datos]');
  const selectorUnidad = modulo.querySelector('[data-telemetria-remota-actividad-unidad]');
  const estado = modulo.querySelector('[data-telemetria-remota-actividad-estado]');
  const descripcion = modulo.querySelector('[data-telemetria-remota-actividad-descripcion]');
  const lineaPol = modulo.querySelector('[data-telemetria-remota-actividad-pol-linea]');
  const resumenPol = modulo.querySelector('[data-telemetria-remota-actividad-pol-resumen]');
  const detalle = {
    vacio: modulo.querySelector('[data-telemetria-remota-actividad-detalle-vacio]'),
    contenido: modulo.querySelector('[data-telemetria-remota-actividad-detalle-contenido]'),
    titulo: modulo.querySelector('[data-telemetria-remota-actividad-detalle-titulo]'),
    valor: modulo.querySelector('[data-telemetria-remota-actividad-detalle-valor]'),
    observado: modulo.querySelector('[data-telemetria-remota-actividad-detalle-observado]'),
    recibido: modulo.querySelector('[data-telemetria-remota-actividad-detalle-recibido]'),
    calidad: modulo.querySelector('[data-telemetria-remota-actividad-detalle-calidad]'),
    severidad: modulo.querySelector('[data-telemetria-remota-actividad-detalle-severidad]'),
    origen: modulo.querySelector('[data-telemetria-remota-actividad-detalle-origen]'),
    humano: modulo.querySelector('[data-telemetria-remota-actividad-detalle-humano]')
  };
  if (!canvas || !datosNodo || !selectorUnidad) return;

  let datos;
  try {
    datos = JSON.parse(datosNodo.textContent || '{}');
  } catch {
    mostrarEstado('Los datos de la gráfica no tienen un formato válido.');
    return;
  }

  let chart = null;
  selectorUnidad.addEventListener('change', pintarGrupoSeleccionado);
  window.addEventListener('portal:themechange', pintarGrupoSeleccionado);
  pintarGrupoSeleccionado();

  function inicializarFiltros(formularioFiltros) {
    const desdeLocal = formularioFiltros?.querySelector('[data-telemetria-remota-desde-local]');
    const hastaLocal = formularioFiltros?.querySelector('[data-telemetria-remota-hasta-local]');
    const desdeUtc = formularioFiltros?.querySelector('[data-telemetria-remota-desde-utc]');
    const hastaUtc = formularioFiltros?.querySelector('[data-telemetria-remota-hasta-utc]');
    if (desdeLocal && desdeUtc?.value) desdeLocal.value = utcALocal(desdeUtc.value);
    if (hastaLocal && hastaUtc?.value) hastaLocal.value = utcALocal(hastaUtc.value);
    formularioFiltros?.addEventListener('submit', sincronizarFiltrosUtc);
    for (const boton of formularioFiltros?.querySelectorAll('[data-telemetria-remota-rango-horas]') || []) {
      boton.addEventListener('click', function () {
        const horas = Number(boton.dataset.telemetriaRemotaRangoHoras);
        const hasta = new Date();
        const desde = new Date(hasta.getTime() - horas * 60 * 60 * 1000);
        desdeLocal.value = fechaALocal(desde);
        hastaLocal.value = fechaALocal(hasta);
        sincronizarFiltrosUtc();
        formularioFiltros.requestSubmit();
      });
    }
  }

  function sincronizarFiltrosUtc() {
    if (desdeUtc) desdeUtc.value = localAUtc(desdeLocal?.value);
    if (hastaUtc) hastaUtc.value = localAUtc(hastaLocal?.value);
  }

  function pintarGrupoSeleccionado() {
    const grupo = (datos.unidades || []).find((item) => item.clave === selectorUnidad.value)
      || datos.unidades?.[0];
    if (!grupo) {
      mostrarEstado('No hay observaciones cuantitativas graficables.');
      return;
    }

    const series = normalizarSeries(grupo);
    const puntos = series.flatMap((serie) => serie.puntos);
    if (puntos.length === 0) {
      mostrarEstado('No hay puntos válidos para este tipo y unidad.');
      return;
    }

    detalleVacio();
    estado.hidden = true;
    canvas.hidden = false;
    descripcion.textContent = `${series.length} ${series.length === 1 ? 'señal' : 'señales'} y ${puntos.length} ${puntos.length === 1 ? 'punto' : 'puntos'} del grupo ${grupo.etiqueta}.`;
    chart?.destroy();
    chart = crearChart(canvas, grupo, series, puntos);
    actualizarResumenPol();
  }

  function mostrarEstado(mensaje) {
    chart?.destroy();
    chart = null;
    canvas.hidden = true;
    estado.hidden = false;
    estado.textContent = mensaje;
  }

  function normalizarSeries(grupo) {
    return (grupo.series || []).map((serie) => ({
      ...serie,
      puntos: (serie.puntos || []).map((punto) => {
        const fecha = Date.parse(punto.fechaUtc);
        const valor = grupo.tipoDato === 'momento_utc'
          ? Date.parse(punto.valor)
          : Number(punto.valor);
        return Number.isFinite(fecha) && Number.isFinite(valor)
          ? { x: fecha, y: valor, observacion: punto, serie }
          : null;
      }).filter(Boolean).sort((a, b) => a.x - b.x)
    })).filter((serie) => serie.puntos.length > 0);
  }

  function crearChart(elementoCanvas, grupo, series, puntos) {
    const paleta = obtenerPaleta();
    const rango = rangoTemporal(puntos);
    return new window.Chart(elementoCanvas, {
      type: 'line',
      data: { datasets: construirDatasets(series, paleta) },
      plugins: [{
        id: 'timelinePolRemoto',
        afterRender(grafica) { pintarLineaPol(grafica); }
      }],
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        parsing: false,
        interaction: { mode: 'nearest', intersect: false },
        onHover(_evento, elementos, grafica) {
          const activo = elementos[0];
          mostrarDetalle(activo
            ? grafica.data.datasets[activo.datasetIndex]?.data?.[activo.index]
            : null, grupo);
        },
        onClick(_evento, elementos, grafica) {
          const activo = elementos[0];
          if (activo) mostrarDetalle(
            grafica.data.datasets[activo.datasetIndex]?.data?.[activo.index],
            grupo
          );
        },
        plugins: {
          legend: {
            display: series.length > 1,
            labels: { usePointStyle: true, boxWidth: 8, color: paleta.texto }
          },
          tooltip: {
            callbacks: {
              title(items) { return formatearFecha(items[0]?.raw?.observacion?.fechaUtc); },
              label(item) {
                const punto = item.raw;
                return [
                  `Señal: ${punto.serie.nombre}`,
                  `Valor: ${formatearValorGrupo(
                    punto.y,
                    grupo,
                    true,
                    punto.observacion.valor
                  )}`,
                  `Calidad: ${punto.observacion.calidad || 'sin_calidad'}`,
                  `Severidad: ${punto.observacion.severidad || 'info'}`,
                  `Origen: ${punto.observacion.origen || 'no declarado'}`
                ];
              }
            }
          }
        },
        scales: {
          x: {
            type: 'linear', min: rango.min, max: rango.max,
            ticks: {
              color: paleta.textoSuave, maxTicksLimit: 7,
              callback(valor) { return formatearFechaCorta(Number(valor)); }
            },
            grid: { color: paleta.rejilla }, border: { color: paleta.borde }
          },
          y: {
            ticks: {
              color: paleta.textoSuave,
              callback(valor) { return grupo.tipoDato === 'momento_utc'
                ? formatearMomentoUtcEje(valor)
                : formatearValorGrupo(valor, grupo); }
            },
            grid: { color: paleta.rejilla }, border: { color: paleta.borde }
          }
        }
      }
    });
  }

  function pintarLineaPol(grafica) {
    if (!lineaPol || !grafica?.chartArea || !grafica.scales?.x) return;
    const periodos = normalizarPeriodosPol(datos.pol?.periodos || []);
    if (periodos.length === 0) {
      lineaPol.hidden = true;
      return;
    }
    const xMin = Number(grafica.scales.x.min);
    const xMax = Number(grafica.scales.x.max);
    const porFuente = new Map();
    for (const periodo of periodos) {
      if (!porFuente.has(periodo.fuenteOrigenId)) porFuente.set(periodo.fuenteOrigenId, []);
      porFuente.get(periodo.fuenteOrigenId).push(periodo);
    }
    lineaPol.replaceChildren();
    lineaPol.style.setProperty('--telemetria-pol-offset', `${Math.max(0, grafica.chartArea.left)}px`);
    lineaPol.style.setProperty('--telemetria-pol-width', `${Math.max(1, grafica.chartArea.right - grafica.chartArea.left)}px`);
    for (const periodosFuente of porFuente.values()) {
      const segmentos = fusionarSegmentosPol(periodosFuente, xMin, xMax);
      const huecos = calcularHuecosPol(segmentos, xMin, xMax);
      const cabecera = document.createElement('div');
      cabecera.className = 'telemetria-grafico__pol-linea-cabecera';
      const titulo = document.createElement('span');
      titulo.textContent = periodosFuente[0].fuenteNombre;
      cabecera.append(titulo, document.createTextNode(' · Prueba de vida alineada al eje temporal'));
      const pista = document.createElement('div');
      pista.className = 'telemetria-grafico__pol-pista';
      for (const segmento of segmentos) pintarTramoPol(pista, segmento, xMin, xMax, true);
      for (const hueco of huecos) pintarTramoPol(pista, hueco, xMin, xMax, false);
      lineaPol.append(cabecera, pista);
    }
    lineaPol.hidden = false;
  }

  function actualizarResumenPol() {
    if (!resumenPol) return;
    const periodos = normalizarPeriodosPol(datos.pol?.periodos || []);
    const abiertos = periodos.filter((periodo) => periodo.abierto).length;
    const fuentes = new Set(periodos.map((periodo) => periodo.fuenteOrigenId)).size;
    resumenPol.querySelector('.telemetria-grafico__pol-texto').textContent = periodos.length
      ? `${periodos.length} ${periodos.length === 1 ? 'periodo' : 'periodos'} POL · ${abiertos} abiertos · ${fuentes} ${fuentes === 1 ? 'fuente' : 'fuentes'}. Los tramos rayados son huecos sin continuidad demostrable.`
      : 'No hay prueba de vida publicada para contextualizar la ventana.';
  }

  function normalizarPeriodosPol(periodos) {
    return periodos.map((periodo) => {
      const inicioMs = Date.parse(periodo.inicioUtc);
      const finMs = Date.parse(periodo.finEfectivoUtc);
      if (!Number.isFinite(inicioMs)) return null;
      return {
        ...periodo,
        inicioMs,
        finMs: Number.isFinite(finMs) ? finMs : null
      };
    }).filter(Boolean).sort((a, b) => a.inicioMs - b.inicioMs);
  }

  function fusionarSegmentosPol(periodos, xMin, xMax) {
    const segmentos = [];
    for (const periodo of periodos) {
      const inicioMs = Math.max(periodo.inicioMs, xMin);
      const finMs = Math.min(periodo.finMs ?? xMax, xMax);
      if (finMs < xMin || inicioMs > xMax || finMs <= inicioMs) continue;
      const segmento = {
        inicioMs,
        finMs,
        abierto: periodo.abierto,
        silencioDetectado: Boolean(periodo.silencioDetectado)
      };
      const anterior = segmentos.at(-1);
      if (anterior && segmento.inicioMs - anterior.finMs <= 1000) {
        anterior.finMs = Math.max(anterior.finMs, segmento.finMs);
        anterior.abierto ||= segmento.abierto;
        anterior.silencioDetectado ||= segmento.silencioDetectado;
      } else {
        segmentos.push(segmento);
      }
    }
    return segmentos;
  }

  function calcularHuecosPol(segmentos, xMin, xMax) {
    const huecos = [];
    let cursor = xMin;
    for (const segmento of segmentos) {
      if (segmento.inicioMs - cursor > 1000) {
        huecos.push({ inicioMs: cursor, finMs: segmento.inicioMs });
      }
      cursor = Math.max(cursor, segmento.finMs);
    }
    if (xMax - cursor > 1000) huecos.push({ inicioMs: cursor, finMs: xMax });
    return huecos;
  }

  function pintarTramoPol(pista, tramo, xMin, xMax, presente) {
    const rango = xMax - xMin;
    if (!Number.isFinite(rango) || rango <= 0) return;
    const inicio = Math.max(xMin, tramo.inicioMs);
    const fin = Math.min(xMax, tramo.finMs);
    if (fin <= inicio) return;
    const nodo = document.createElement('span');
    nodo.className = `telemetria-grafico__pol-tramo telemetria-grafico__pol-tramo--${presente ? 'presente' : 'hueco'}`;
    nodo.style.left = `${((inicio - xMin) / rango) * 100}%`;
    nodo.style.width = `${Math.max(.3, ((fin - inicio) / rango) * 100)}%`;
    const etiqueta = presente
      ? tramo.silencioDetectado
        ? 'Prueba de vida efectiva hasta el último latido'
        : tramo.abierto ? 'Prueba de vida activa' : 'Prueba de vida registrada'
      : 'Hueco sin prueba de vida demostrable';
    nodo.title = `${etiqueta}: ${formatearFecha(new Date(inicio))} — ${formatearFecha(new Date(fin))}`;
    pista.append(nodo);
  }

  function construirDatasets(series, paleta) {
    const colores = [
      'rgba(82, 107, 132, .9)', 'rgba(43, 108, 176, .9)',
      'rgba(126, 87, 194, .9)', 'rgba(198, 98, 45, .9)',
      'rgba(45, 138, 92, .9)', 'rgba(176, 68, 110, .9)'
    ];
    return series.map((serie, indice) => {
      const color = colores[indice % colores.length];
      const esMomentoUtc = serie.tipoDato === 'momento_utc';
      return {
        label: `${serie.nombre}${esMomentoUtc
          ? ' (momento UTC)'
          : serie.unidad ? ` (${serie.unidad})` : ''}`,
        data: serie.puntos,
        borderColor: color,
        backgroundColor: color.replace('.9)', '.12)'),
        borderWidth: 2,
        pointRadius(contexto) {
          const severidad = contexto.raw?.observacion?.severidad;
          return severidad && severidad !== 'info' ? 5 : 3;
        },
        pointHoverRadius: 7,
        pointBackgroundColor: color,
        pointBorderColor: paleta.superficie,
        pointBorderWidth: 1,
        stepped: esMomentoUtc ? 'after' : false,
        tension: esMomentoUtc ? 0 : .18,
        spanGaps: false,
        fill: esMomentoUtc ? false : series.length === 1
      };
    });
  }

  function rangoTemporal(puntos) {
    const valores = puntos.map((punto) => punto.x);
    const min = Math.min(...valores);
    const max = Math.max(...valores);
    if (min !== max) return { min, max };
    return { min: min - 30_000, max: max + 30_000 };
  }

  function mostrarDetalle(punto, grupo) {
    if (!punto) return detalleVacio();
    const observacion = punto.observacion;
    detalle.vacio.hidden = true;
    detalle.contenido.hidden = false;
    texto(detalle.titulo, punto.serie.nombre);
    texto(detalle.valor, formatearValorGrupo(
      punto.y,
      grupo,
      true,
      observacion.valor
    ));
    texto(detalle.observado, formatearFecha(observacion.fechaUtc));
    texto(detalle.recibido, formatearFecha(observacion.recibidoEnUtc));
    texto(detalle.calidad, observacion.calidad || 'sin_calidad');
    texto(detalle.severidad, observacion.severidad || 'info');
    texto(detalle.origen, observacion.origen || 'no declarado');
    texto(detalle.humano, observacion.detalle || 'Sin detalle.');
  }

  function detalleVacio() {
    detalle.vacio.hidden = false;
    detalle.contenido.hidden = true;
  }

  function texto(elemento, valor) {
    if (elemento) elemento.textContent = valor;
  }

  function obtenerPaleta() {
    const estilos = window.getComputedStyle(document.documentElement);
    const leer = (variable, respaldo) => String(estilos.getPropertyValue(variable) || '').trim() || respaldo;
    const oscuro = document.documentElement.dataset.theme === 'dark';
    return {
      texto: leer('--texto', '#e5eaf0'),
      textoSuave: leer('--texto-suave', '#9aa7b5'),
      borde: leer('--borde', '#303c49'),
      superficie: leer('--superficie', '#19212b'),
      rejilla: oscuro ? 'rgba(154, 167, 181, .14)' : 'rgba(100, 116, 139, .1)'
    };
  }

  function formatearNumero(valor, unidad) {
    const numero = Number(valor);
    if (!Number.isFinite(numero)) return 'sin valor';
    const salida = new Intl.NumberFormat('es-ES', {
      maximumFractionDigits: Math.abs(numero) >= 100 ? 0 : 2
    }).format(numero);
    return unidad ? `${salida} ${unidad}` : salida;
  }

  function formatearValorGrupo(
    valor,
    grupo,
    incluirExacta = false,
    valorCanonico = null
  ) {
    if (grupo?.tipoDato === 'momento_utc') {
      const punto = Number(valor);
      const local = formatearFecha(new Date(punto));
      const canonico = typeof valorCanonico === 'string'
        ? valorCanonico
        : Number.isFinite(punto) ? new Date(punto).toISOString() : null;

      return canonico && incluirExacta
        ? `${local} · UTC ${canonico}`
        : local;
    }

    if (grupo?.tipoDato !== 'duracion') {
      return formatearNumero(valor, grupo?.unidad);
    }

    const humana = formatearDuracionHumana(valor);
    const exacta = formatearDuracionExacta(valor);
    return incluirExacta && humana !== exacta ? `${humana} (${exacta})` : humana;
  }

  function formatearDuracionHumana(valor) {
    const segundos = Number(valor);
    if (!Number.isFinite(segundos) || segundos < 0) return 'sin valor';
    if (segundos === 0) return '0 s';
    if (segundos < 1) return `${formatearDecimal(segundos * 1000, 3)} ms`;

    const unidades = [
      ['a', 31_536_000], ['d', 86_400], ['h', 3_600], ['min', 60]
    ];
    const partes = [];
    let restante = segundos;

    for (const [etiqueta, factor] of unidades) {
      const cantidad = Math.floor(restante / factor);
      if (cantidad > 0) {
        partes.push(`${cantidad} ${etiqueta}`);
        restante -= cantidad * factor;
      }
      if (partes.length === 2) break;
    }

    if (partes.length < 2 && restante > 0) {
      partes.push(`${formatearDecimal(restante, 4)} s`);
    }
    return partes.join(' ') || `${formatearDecimal(segundos, 4)} s`;
  }

  function formatearDuracionExacta(valor) {
    const segundos = Number(valor);
    return Number.isFinite(segundos) && segundos >= 0
      ? `${String(segundos)} s`
      : 'sin valor';
  }

  function formatearDecimal(valor, maximoDecimales) {
    return new Intl.NumberFormat('es-ES', {
      maximumFractionDigits: maximoDecimales,
      useGrouping: true
    }).format(valor);
  }

  function formatearMomentoUtcEje(valor) {
    const fecha = new Date(Number(valor));
    if (Number.isNaN(fecha.getTime())) return '';
    return new Intl.DateTimeFormat('es-ES', {
      year: '2-digit', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    }).format(fecha);
  }

  function formatearFecha(valor) {
    if (!valor) return 'sin fecha';
    if (window.portalFechas?.formatear) return window.portalFechas.formatear(valor) || String(valor);
    const fecha = new Date(valor);
    return Number.isNaN(fecha.getTime()) ? String(valor) : fecha.toLocaleString('es-ES');
  }

  function formatearFechaCorta(valor) {
    const fecha = new Date(valor);
    if (Number.isNaN(fecha.getTime())) return '';
    return new Intl.DateTimeFormat('es-ES', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
    }).format(fecha);
  }

  function utcALocal(valor) {
    const fecha = new Date(valor);
    return Number.isNaN(fecha.getTime()) ? '' : fechaALocal(fecha);
  }

  function fechaALocal(fecha) {
    const compensacion = fecha.getTimezoneOffset() * 60_000;
    return new Date(fecha.getTime() - compensacion).toISOString().slice(0, 16);
  }

  function localAUtc(valor) {
    if (!valor) return '';
    const fecha = new Date(valor);
    return Number.isNaN(fecha.getTime()) ? '' : fecha.toISOString();
  }
})();
