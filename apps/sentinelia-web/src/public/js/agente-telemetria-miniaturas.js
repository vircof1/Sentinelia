(function () {
  const raiz = document.querySelector('[data-telemetria-miniaturas]');

  if (!raiz) {
    return;
  }

  const miniaturas = Array.from(
    raiz.querySelectorAll('[data-telemetria-miniatura]')
  );

  if (miniaturas.length === 0) {
    return;
  }

  const pendientes = [];
  const controladores = new Set();
  const cache = new Map();
  const limiteConcurrencia = 3;
  let activas = 0;

  const observador = 'IntersectionObserver' in window
    ? new IntersectionObserver((entradas) => {
        for (const entrada of entradas) {
          if (!entrada.isIntersecting) {
            continue;
          }

          observador.unobserve(entrada.target);
          encolar(entrada.target);
        }
      }, { rootMargin: '240px 0px' })
    : null;

  for (const miniatura of miniaturas) {
    if (observador) {
      observador.observe(miniatura);
    } else {
      encolar(miniatura);
    }
  }

  window.addEventListener('pagehide', () => {
    observador?.disconnect();

    for (const controlador of controladores) {
      controlador.abort();
    }
  }, { once: true });

  function encolar(miniatura) {
    if (miniatura.dataset.estadoCarga) {
      return;
    }

    miniatura.dataset.estadoCarga = 'pendiente';
    pendientes.push(miniatura);
    procesarCola();
  }

  function procesarCola() {
    while (activas < limiteConcurrencia && pendientes.length > 0) {
      const miniatura = pendientes.shift();
      activas += 1;
      cargarMiniatura(miniatura)
        .catch(() => mostrarError(miniatura))
        .finally(() => {
          activas -= 1;
          procesarCola();
        });
    }
  }

  async function cargarMiniatura(miniatura) {
    const url = String(miniatura.dataset.urlMiniatura || '');

    if (!url) {
      mostrarError(miniatura);
      return;
    }

    miniatura.dataset.estadoCarga = 'cargando';
    actualizarEstado(miniatura, 'Cargando tendencia…');
    const datos = await obtenerMiniatura(url);
    const tipoDato = String(datos?.senal?.tipoDato || miniatura.dataset.tipoDato || '');
    const observaciones = Array.isArray(datos?.observaciones)
      ? datos.observaciones
      : [];

    if (tipoDato === 'numero') {
      renderizarCuantitativa(miniatura, datos, observaciones, {
        campoValor: 'valorNumero',
        formatearValor: (valor) => formatearNumero(valor, datos.senal?.unidad),
        normalizarValor: Number
      });
    } else if (tipoDato === 'duracion') {
      renderizarCuantitativa(miniatura, datos, observaciones, {
        campoValor: 'valorDuracion',
        formatearValor: formatearDuracionHumana,
        normalizarValor: Number
      });
    } else if (tipoDato === 'momento_utc') {
      renderizarCuantitativa(miniatura, datos, observaciones, {
        campoValor: 'valorMomentoUtc',
        formatearValor: formatearFecha,
        normalizarValor: fechaMs,
        escalonada: true
      });
    } else if (tipoDato === 'booleano') {
      renderizarBooleana(miniatura, datos, observaciones);
    } else {
      mostrarSinDatos(miniatura);
      return;
    }

    miniatura.dataset.estadoCarga = 'completa';
  }

  function obtenerMiniatura(url) {
    if (cache.has(url)) {
      return cache.get(url);
    }

    const controlador = new AbortController();
    controladores.add(controlador);
    const promesa = fetch(url, {
      headers: {
        accept: 'application/json',
        'x-requested-with': 'XMLHttpRequest'
      },
      signal: controlador.signal
    })
      .then(async (respuesta) => {
        const datos = await respuesta.json();

        if (!respuesta.ok || datos.ok === false) {
          throw new Error(datos.mensaje || 'No se pudo cargar la miniatura.');
        }

        return datos.miniatura || {};
      })
      .finally(() => controladores.delete(controlador));

    cache.set(url, promesa);
    return promesa;
  }

  function renderizarCuantitativa(
    miniatura,
    datos,
    observaciones,
    {
      campoValor,
      formatearValor,
      normalizarValor,
      escalonada = false
    }
  ) {
    const puntos = observaciones
      .map((observacion) => ({
        x: fechaMs(observacion.observadoEnUtc),
        y: normalizarValor(observacion[campoValor])
      }))
      .filter((punto) => Number.isFinite(punto.x) && Number.isFinite(punto.y))
      .sort((a, b) => a.x - b.x);

    if (puntos.length === 0) {
      mostrarSinDatos(miniatura);
      return;
    }

    const ancho = 160;
    const alto = 38;
    const minX = Math.min(...puntos.map((punto) => punto.x));
    const maxX = Math.max(...puntos.map((punto) => punto.x));
    const minY = Math.min(...puntos.map((punto) => punto.y));
    const maxY = Math.max(...puntos.map((punto) => punto.y));
    const rangoX = Math.max(1, maxX - minX);
    const rangoY = Math.max(1e-9, maxY - minY);
    const coordenadas = puntos.map((punto, indice) => {
      const x = puntos.length === 1
        ? ancho / 2
        : ((punto.x - minX) / rangoX) * ancho;
      const y = maxY === minY
        ? alto / 2
        : alto - 3 - (((punto.y - minY) / rangoY) * (alto - 6));
      return {
        x: redondear(x),
        y: redondear(y),
        indice
      };
    });
    const linea = coordenadas.map((punto) => `${punto.x},${punto.y}`).join(' ');
    const trazoEscalonado = coordenadas.length > 0
      ? `M ${coordenadas[0].x} ${coordenadas[0].y} ${coordenadas.slice(1)
          .map((punto) => `H ${punto.x} V ${punto.y}`).join(' ')}`
      : '';
    const area = coordenadas.length > 1
      ? escalonada
        ? `M ${coordenadas[0].x} ${alto} L ${coordenadas[0].x} ${coordenadas[0].y} ${coordenadas.slice(1)
            .map((punto) => `H ${punto.x} V ${punto.y}`).join(' ')} L ${coordenadas.at(-1).x} ${alto} Z`
        : `M ${coordenadas[0].x} ${alto} L ${coordenadas.map((punto) =>
            `${punto.x} ${punto.y}`
          ).join(' L ')} L ${coordenadas.at(-1).x} ${alto} Z`
      : '';
    const lienzo = obtenerLienzo(miniatura);

    lienzo.innerHTML = `
      <svg class="telemetria-miniatura__svg" viewBox="0 0 ${ancho} ${alto}" preserveAspectRatio="none" aria-hidden="true">
        ${area ? `<path class="telemetria-miniatura__area" d="${area}"></path>` : ''}
        ${escalonada
          ? `<path class="telemetria-miniatura__linea" d="${trazoEscalonado}"></path>`
          : `<polyline class="telemetria-miniatura__linea" points="${linea}"></polyline>`}
        <circle class="telemetria-miniatura__punto" cx="${coordenadas.at(-1).x}" cy="${coordenadas.at(-1).y}" r="2.4"></circle>
      </svg>
    `;
    miniatura.title = `${puntos.length} muestras · mínimo ${formatearValor(minY)} · máximo ${formatearValor(maxY)}`;
    actualizarEstado(miniatura, textoMuestras(puntos.length));
  }

  function renderizarBooleana(miniatura, datos, observaciones) {
    const segmentos = construirSegmentosBooleanos(datos, observaciones);

    if (segmentos.length === 0) {
      mostrarSinDatos(miniatura);
      return;
    }

    const rango = resolverRango(datos, segmentos);
    const duracion = Math.max(1, rango.max - rango.min);
    const lienzo = obtenerLienzo(miniatura);

    lienzo.innerHTML = `
      <div class="telemetria-miniatura__booleana" aria-hidden="true">
        ${segmentos.map((segmento) => {
          const izquierda = ((segmento.inicioMs - rango.min) / duracion) * 100;
          const ancho = Math.max(
            0.8,
            ((segmento.finMs - segmento.inicioMs) / duracion) * 100
          );
          const titulo = `${segmento.valor ? 'Sí' : 'No'} · ${formatearFecha(segmento.inicioMs)} – ${formatearFecha(segmento.finMs)}`;

          return `<span class="telemetria-miniatura__booleano telemetria-miniatura__booleano--${segmento.valor ? 'si' : 'no'}" style="left:${redondear(izquierda)}%;width:${redondear(Math.min(ancho, 100 - izquierda))}%;" title="${escaparHtml(titulo)}"></span>`;
        }).join('')}
      </div>
    `;
    miniatura.title = `${observaciones.length} muestras booleanas recientes`;
    actualizarEstado(miniatura, textoMuestras(observaciones.length));
  }

  function construirSegmentosBooleanos(datos, observaciones) {
    const periodos = (datos?.pol?.periodos || [])
      .map((periodo) => ({
        id: periodo.id,
        inicioMs: fechaMs(periodo.inicioUtc),
        finMs: fechaMs(periodo.finEfectivoUtc || periodo.finUtc)
      }))
      .filter((periodo) => Number.isFinite(periodo.inicioMs));
    const rango = resolverRango(datos, []);
    const lecturas = observaciones
      .map((observacion) => ({
        observacion,
        inicioMs: fechaMs(observacion.observadoEnUtc),
        vigenteHastaMs: fechaMs(observacion.vigenteHastaUtc),
        periodoVidaPolId: observacion.periodoVidaPolId ?? null,
        valor: observacion.valorBooleano
      }))
      .filter((lectura) =>
        Number.isFinite(lectura.inicioMs) && typeof lectura.valor === 'boolean'
      )
      .sort((a, b) => a.inicioMs - b.inicioMs);
    const segmentos = [];

    for (let indice = 0; indice < lecturas.length; indice += 1) {
      const lectura = lecturas[indice];
      const siguiente = lecturas[indice + 1];
      const esRuntime = lectura.observacion.origen === 'runtime';
      const periodoPorId = lectura.periodoVidaPolId == null
        ? null
        : periodos.find((item) =>
            String(item.id) === String(lectura.periodoVidaPolId)
          );
      const periodo = periodoPorId || periodos.find((item) =>
        lectura.inicioMs >= item.inicioMs &&
          (!Number.isFinite(item.finMs) || lectura.inicioMs <= item.finMs)
      );

      if (!esRuntime && !periodo) {
        continue;
      }

      const limites = [
        siguiente?.inicioMs,
        lectura.vigenteHastaMs,
        esRuntime ? rango.max : periodo?.finMs
      ].filter((valor) => Number.isFinite(valor) && valor >= lectura.inicioMs);
      const finMs = limites.length > 0 ? Math.min(...limites) : lectura.inicioMs;

      segmentos.push({
        inicioMs: lectura.inicioMs,
        finMs,
        valor: lectura.valor
      });
    }

    return segmentos;
  }

  function resolverRango(datos, segmentos) {
    const desde = fechaMs(datos?.rango?.desdeUtc);
    const hasta = fechaMs(datos?.rango?.hastaUtc);

    if (Number.isFinite(desde) && Number.isFinite(hasta) && hasta > desde) {
      return { min: desde, max: hasta };
    }

    const marcas = segmentos
      .flatMap((segmento) => [segmento.inicioMs, segmento.finMs])
      .filter(Number.isFinite);
    const min = marcas.length > 0 ? Math.min(...marcas) : Date.now() - 1;
    const max = marcas.length > 0 ? Math.max(...marcas) : Date.now();
    return { min, max: max > min ? max : min + 1 };
  }

  function mostrarSinDatos(miniatura) {
    miniatura.dataset.estadoCarga = 'sin_datos';
    obtenerLienzo(miniatura).innerHTML = '<span class="telemetria-miniatura__sin-datos"></span>';
    actualizarEstado(miniatura, 'Histórico insuficiente para mostrar tendencia.');
  }

  function mostrarError(miniatura) {
    if (miniatura.dataset.estadoCarga === 'completa') {
      return;
    }

    miniatura.dataset.estadoCarga = 'error';
    obtenerLienzo(miniatura).innerHTML = '<span class="telemetria-miniatura__sin-datos"></span>';
    actualizarEstado(miniatura, 'No se pudo cargar la tendencia.');
  }

  function obtenerLienzo(miniatura) {
    return miniatura.querySelector('[data-telemetria-miniatura-lienzo]');
  }

  function actualizarEstado(miniatura, texto) {
    const estado = miniatura.querySelector('[data-telemetria-miniatura-estado]');

    if (estado) {
      estado.textContent = texto;
    }
  }

  function textoMuestras(total) {
    return total === 1
      ? '1 muestra reciente · tendencia aún no demostrable'
      : `${total} muestras recientes`;
  }

  function fechaMs(valor) {
    if (!valor) {
      return null;
    }

    const fecha = new Date(valor);
    return Number.isNaN(fecha.getTime()) ? null : fecha.getTime();
  }

  function formatearFecha(valor) {
    return new Intl.DateTimeFormat('es-ES', {
      dateStyle: 'short',
      timeStyle: 'medium'
    }).format(new Date(valor));
  }

  function formatearNumero(valor, unidad = '') {
    const texto = new Intl.NumberFormat('es-ES', {
      maximumFractionDigits: 2
    }).format(valor);
    return unidad ? `${texto} ${unidad}` : texto;
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

  function formatearDecimal(valor, maximoDecimales) {
    return new Intl.NumberFormat('es-ES', {
      maximumFractionDigits: maximoDecimales,
      useGrouping: true
    }).format(valor);
  }

  function redondear(valor) {
    return Number(valor.toFixed(3));
  }

  function escaparHtml(valor) {
    return String(valor)
      .replaceAll('&', '&amp;')
      .replaceAll('"', '&quot;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;');
  }
})();
