(function iniciarFormularioDns() {
  const modulo = document.querySelector('[data-dns-formulario]');

  if (!modulo) {
    return;
  }

  const campoNivel = modulo.querySelector('[data-dns-pertenencia]');
  const campoTenant = modulo.querySelector('[data-dns-tenant]');
  const campoEmpresa = modulo.querySelector('[data-dns-empresa]');
  const campoSitio = modulo.querySelector('[data-dns-sitio]');
  const contenedorTenant = modulo.querySelector('[data-dns-tenant-campo]');
  const contenedorEmpresa = modulo.querySelector('[data-dns-empresa-campo]');
  const contenedorSitio = modulo.querySelector('[data-dns-sitio-campo]');
  const campoNombreZona = modulo.querySelector('#dns_nombre_zona');
  const resumenNombreZona = modulo.querySelector('[data-dns-hero-nombre]');
  const campoPublicar = modulo.querySelector('input[type="checkbox"][name="publicar_en_bind"]');
  const resumenPublicacion = modulo.querySelector('[data-dns-hero-publicacion]');
  const ayudaPublicacion = modulo.querySelector('[data-dns-hero-publicacion-ayuda]');

  if (!campoNivel || !campoTenant || !campoEmpresa || !campoSitio) {
    return;
  }

  const tenantBloqueado = campoTenant.disabled;
  const empresaBloqueada = campoEmpresa.disabled;
  const sitioBloqueado = campoSitio.disabled;
  const detallesSoa = modulo.querySelector('[data-dns-soa-detalles]');
  const formulario = modulo.querySelector('form.formulario-organizacion');

  formulario?.addEventListener('invalid', (evento) => {
    if (detallesSoa?.contains(evento.target)) {
      detallesSoa.open = true;
    }
  }, true);

  function actualizarResumenHero() {
    if (campoNombreZona && resumenNombreZona) {
      resumenNombreZona.textContent = campoNombreZona.value.trim() || 'Nombre por definir';
    }

    if (campoPublicar && resumenPublicacion && ayudaPublicacion) {
      resumenPublicacion.textContent = campoPublicar.checked
        ? 'Publicar en BIND'
        : 'No publicar';
      ayudaPublicacion.textContent = campoPublicar.checked
        ? 'Se solicitará su publicación al guardar; no implica que ya esté aplicada.'
        : 'La zona se guardará sin solicitar su publicación en BIND.';
    }
  }

  campoNombreZona?.addEventListener('input', actualizarResumenHero);
  campoPublicar?.addEventListener('change', actualizarResumenHero);
  actualizarResumenHero();

  const opcionesEmpresa = Array.from(campoEmpresa.options).map((opcion) => ({
    nodo: opcion,
    valor: String(opcion.value || ''),
    tenantId: String(opcion.dataset.tenantId || '')
  }));
  const opcionesSitio = Array.from(campoSitio.options).map((opcion) => ({
    nodo: opcion,
    valor: String(opcion.value || ''),
    tenantId: String(opcion.dataset.tenantId || ''),
    empresaId: String(opcion.dataset.empresaId || '')
  }));

  const camposTiempo = {
    ttl: modulo.querySelector('[data-dns-tiempo="ttl"]'),
    refresh: modulo.querySelector('[data-dns-tiempo="refresh"]'),
    retry: modulo.querySelector('[data-dns-tiempo="retry"]'),
    expire: modulo.querySelector('[data-dns-tiempo="expire"]'),
    minimum: modulo.querySelector('[data-dns-tiempo="minimum"]')
  };
  const ayudasTiempo = {
    ttl: modulo.querySelector('[data-dns-tiempo-ayuda="ttl"]'),
    refresh: modulo.querySelector('[data-dns-tiempo-ayuda="refresh"]'),
    retry: modulo.querySelector('[data-dns-tiempo-ayuda="retry"]'),
    expire: modulo.querySelector('[data-dns-tiempo-ayuda="expire"]'),
    minimum: modulo.querySelector('[data-dns-tiempo-ayuda="minimum"]')
  };
  const resumenSoa = modulo.querySelector('[data-dns-soa-resumen-texto]');
  const alertasSoa = modulo.querySelector('[data-dns-soa-alertas]');
  const campoMname = modulo.querySelector('#dns_soa_mname');
  const campoRname = modulo.querySelector('#dns_soa_rname');
  const estadoRname = modulo.querySelector('[data-dns-rname-estado]');
  const botonesPreset = Array.from(
    modulo.querySelectorAll('[data-dns-preset]')
  );
  const sugerenciaMnameActiva = modulo.dataset.dnsModo === 'crear' &&
    !campoMname?.value.trim();
  const sugerenciaRnameActiva = modulo.dataset.dnsModo === 'crear' &&
    !campoRname?.value.trim();
  let mnameEditado = false;
  let rnameEditado = false;

  function sugerirSoaDesdeNombreZona() {
    if (modulo.dataset.dnsModo !== 'crear' || !campoNombreZona) {
      return;
    }

    const dominio = campoNombreZona.value.trim().toLowerCase().replace(/\.+$/, '');
    const etiquetasValidas = dominio && dominio.length <= 253 &&
      dominio.split('.').every((etiqueta) =>
        /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(etiqueta)
      );
    const mnameSugerido = etiquetasValidas ? `ns1.${dominio}` : '';
    const rnameSugerido = etiquetasValidas ? `hostmaster.${dominio}` : '';

    if (sugerenciaMnameActiva && !mnameEditado && campoMname) {
      campoMname.value = mnameSugerido.length <= campoMname.maxLength
        ? mnameSugerido
        : '';
    }
    if (sugerenciaRnameActiva && !rnameEditado && campoRname) {
      campoRname.value = rnameSugerido.length <= campoRname.maxLength
        ? rnameSugerido
        : '';
      actualizarAyudaRname();
    }
  }

  campoNombreZona?.addEventListener('input', sugerirSoaDesdeNombreZona);
  campoNombreZona?.addEventListener('change', sugerirSoaDesdeNombreZona);
  campoMname?.addEventListener('input', () => { mnameEditado = true; });
  campoRname?.addEventListener('input', () => { rnameEditado = true; });
  sugerirSoaDesdeNombreZona();

  const presets = {
    estable: {
      ttl: 3600,
      refresh: 3600,
      retry: 600,
      expire: 1209600,
      minimum: 300
    },
    frecuente: {
      ttl: 300,
      refresh: 900,
      retry: 300,
      expire: 604800,
      minimum: 120
    },
    migracion: {
      ttl: 60,
      refresh: 300,
      retry: 120,
      expire: 259200,
      minimum: 60
    }
  };

  function refrescarEmpresas() {
    const tenantSeleccionado = String(campoTenant.value || '');
    const empresaSeleccionada = String(campoEmpresa.value || '');

    campoEmpresa.innerHTML = '';

    for (const opcion of opcionesEmpresa) {
      if (!opcion.valor || !tenantSeleccionado || opcion.tenantId === tenantSeleccionado) {
        campoEmpresa.appendChild(opcion.nodo);
      }
    }

    if (
      empresaSeleccionada &&
      Array.from(campoEmpresa.options).some((opcion) => opcion.value === empresaSeleccionada)
    ) {
      campoEmpresa.value = empresaSeleccionada;
    } else if (campoEmpresa.options.length > 0) {
      campoEmpresa.value = '';
    }
  }

  function refrescarSitios() {
    const tenantSeleccionado = String(campoTenant.value || '');
    const empresaSeleccionada = String(campoEmpresa.value || '');
    const sitioSeleccionado = String(campoSitio.value || '');

    campoSitio.innerHTML = '';

    for (const opcion of opcionesSitio) {
      const coincideTenant = !tenantSeleccionado || opcion.tenantId === tenantSeleccionado;
      const coincideEmpresa = !empresaSeleccionada || opcion.empresaId === empresaSeleccionada;

      if (!opcion.valor || (coincideTenant && coincideEmpresa)) {
        campoSitio.appendChild(opcion.nodo);
      }
    }

    if (
      sitioSeleccionado &&
      Array.from(campoSitio.options).some((opcion) => opcion.value === sitioSeleccionado)
    ) {
      campoSitio.value = sitioSeleccionado;
    } else if (campoSitio.options.length > 0) {
      campoSitio.value = '';
    }
  }

  function refrescarRequeridos() {
    const nivel = String(campoNivel.value || 'portal');
    const requiereTenant = ['tenant', 'empresa', 'sitio'].includes(nivel);
    const requiereEmpresa = ['empresa', 'sitio'].includes(nivel);
    const requiereSitio = nivel === 'sitio';

    if (!requiereTenant && !tenantBloqueado) {
      campoTenant.value = '';
    }

    if (!requiereEmpresa && !empresaBloqueada) {
      campoEmpresa.value = '';
    }

    if (!requiereSitio && !sitioBloqueado) {
      campoSitio.value = '';
    }

    campoTenant.disabled = tenantBloqueado || !requiereTenant;
    campoEmpresa.disabled = empresaBloqueada || !requiereEmpresa;
    campoSitio.disabled = sitioBloqueado || !requiereSitio;
    campoTenant.required = requiereTenant && !campoTenant.disabled;
    campoEmpresa.required = requiereEmpresa && !campoEmpresa.disabled;
    campoSitio.required = requiereSitio && !campoSitio.disabled;
    if (contenedorTenant) contenedorTenant.hidden = !requiereTenant;
    if (contenedorEmpresa) contenedorEmpresa.hidden = !requiereEmpresa;
    if (contenedorSitio) contenedorSitio.hidden = !requiereSitio;
  }

  function leerNumero(campo) {
    const valor = Number.parseInt(String(campo?.value || ''), 10);
    return Number.isFinite(valor) ? valor : 0;
  }

  function formatearDuracion(segundos) {
    if (!Number.isFinite(segundos) || segundos <= 0) {
      return '0 segundos';
    }

    const unidades = [
      ['día', 86400],
      ['hora', 3600],
      ['minuto', 60],
      ['segundo', 1]
    ];
    const partes = [];
    let restante = segundos;

    for (const [etiqueta, divisor] of unidades) {
      if (partes.length === 2) {
        break;
      }

      const cantidad = Math.floor(restante / divisor);

      if (cantidad <= 0) {
        continue;
      }

      partes.push(`${cantidad} ${etiqueta}${cantidad === 1 ? '' : 's'}`);
      restante -= cantidad * divisor;
    }

    return partes.join(' y ') || '0 segundos';
  }

  function separarEtiquetasEscapadas(valor) {
    const texto = String(valor || '').trim().replace(/\.+$/, '');
    const partes = [];
    let buffer = '';
    let escapando = false;

    for (const caracter of texto) {
      if (escapando) {
        buffer += caracter;
        escapando = false;
        continue;
      }

      if (caracter === '\\') {
        escapando = true;
        continue;
      }

      if (caracter === '.') {
        partes.push(buffer);
        buffer = '';
        continue;
      }

      buffer += caracter;
    }

    if (buffer) {
      partes.push(buffer);
    }

    return partes.filter(Boolean);
  }

  function resolverEmailRname(valor) {
    const texto = String(valor || '').trim().replace(/\.+$/, '');

    if (!texto) {
      return 'hostmaster@empresa.local';
    }

    const partesLimpias = separarEtiquetasEscapadas(texto);

    if (partesLimpias.length < 2) {
      return `${texto}@...`;
    }

    const [buzon, ...dominio] = partesLimpias;
    return `${buzon}@${dominio.join('.')}`;
  }

  function actualizarAyudaRname() {
    if (!campoRname || !estadoRname) {
      return;
    }

    const valor = campoRname.value;
    const emailInterpretado = resolverEmailRname(valor);
    const partes = separarEtiquetasEscapadas(valor);
    const contieneEscape = String(valor || '').includes('\\.');
    const dominioTieneEscape = partes.slice(1).some((parte) => parte.includes('\\'));

    estadoRname.classList.remove(
      'dns-formulario-rname-estado--ok',
      'dns-formulario-rname-estado--advertencia'
    );
    campoRname.classList.remove('form-control-invalido');

    if (!String(valor || '').trim()) {
      estadoRname.innerHTML =
        'Interpretado como <code>hostmaster@empresa.local</code>.';
      return;
    }

    if (partes.length < 2) {
      estadoRname.innerHTML =
        'Interpretado como <code>@...</code>.';
      estadoRname.classList.add('dns-formulario-rname-estado--advertencia');
      campoRname.classList.add('form-control-invalido');
      return;
    }

    if (dominioTieneEscape) {
      const buzon = partes[0]?.replaceAll('\\.', '.') || '';
      const dominioSugerido = partes
        .slice(1)
        .map((parte) => parte.replaceAll('\\.', '.').replaceAll('\\', ''))
        .join('.');
      const sugerencia = `${buzon.replaceAll('.', '\\.')}.${dominioSugerido}`;

      estadoRname.innerHTML =
        `Interpretado como <code>${escapeHtml(emailInterpretado)}</code>. ` +
        `Los escapes <code>\\.</code> solo deben usarse en el buzón, no en el dominio. ` +
        `Prueba con <code>${escapeHtml(sugerencia)}</code>.`;
      estadoRname.classList.add('dns-formulario-rname-estado--advertencia');
      campoRname.classList.add('form-control-invalido');
      return;
    }

    if (!contieneEscape && partes.length >= 4) {
      const dominioProbable = partes.slice(-2).join('.');
      const localProbable = partes.slice(0, -2).join('.');

      if (localProbable.includes('.')) {
        const sugerencia = `${localProbable.replaceAll('.', '\\.')}.${dominioProbable}`;
        estadoRname.innerHTML =
          `Interpretado como <code>${escapeHtml(emailInterpretado)}</code>. ` +
          `Si querías <code>${escapeHtml(`${localProbable}@${dominioProbable}`)}</code>, usa <code>${escapeHtml(sugerencia)}</code>.`;
        estadoRname.classList.add('dns-formulario-rname-estado--advertencia');
        campoRname.classList.add('form-control-invalido');
        return;
      }
    }

    estadoRname.innerHTML =
      `Interpretado como <code>${escapeHtml(emailInterpretado)}</code>.`;
    estadoRname.classList.add('dns-formulario-rname-estado--ok');
  }

  function actualizarAyudasTiempo() {
    const mensajes = {
      ttl(segundos) {
        return `${segundos} s equivalen a ${formatearDuracion(segundos)} de caché típica antes de pedir el dato de nuevo.`;
      },
      refresh(segundos) {
        return `Los secundarios revisarán cambios aproximadamente cada ${formatearDuracion(segundos)}.`;
      },
      retry(segundos) {
        return `Si falla la sincronización, reintentará tras ${formatearDuracion(segundos)}.`;
      },
      expire(segundos) {
        return `Un secundario dejará de confiar en la zona tras ${formatearDuracion(segundos)} sin poder refrescarla.`;
      },
      minimum(segundos) {
        return `Las respuestas negativas o mínimas podrán quedar en caché unos ${formatearDuracion(segundos)}.`;
      }
    };

    for (const [clave, campo] of Object.entries(camposTiempo)) {
      const ayuda = ayudasTiempo[clave];

      if (!campo || !ayuda) {
        continue;
      }

      ayuda.textContent = mensajes[clave](leerNumero(campo));
    }
  }

  function actualizarResumenSoa() {
    if (!resumenSoa) {
      return;
    }

    const ttl = leerNumero(camposTiempo.ttl);
    const refresh = leerNumero(camposTiempo.refresh);
    const retry = leerNumero(camposTiempo.retry);

    let tonoTtl = 'equilibrada';

    if (ttl <= 120) {
      tonoTtl = 'muy ágil, pero más costosa en consultas';
    } else if (ttl <= 900) {
      tonoTtl = 'rápida para propagar cambios';
    } else if (ttl >= 7200) {
      tonoTtl = 'muy conservadora y lenta para vaciar caché';
    }

    resumenSoa.textContent =
      `Con TTL de ${formatearDuracion(ttl)}, la caché será ${tonoTtl}. ` +
      `Los secundarios revisarán cambios cada ${formatearDuracion(refresh)} y, si fallan, reintentará tras ${formatearDuracion(retry)}.`;
  }

  function actualizarAlertasSoa() {
    if (!alertasSoa) {
      return;
    }

    const ttl = leerNumero(camposTiempo.ttl);
    const refresh = leerNumero(camposTiempo.refresh);
    const retry = leerNumero(camposTiempo.retry);
    const expire = leerNumero(camposTiempo.expire);
    const minimum = leerNumero(camposTiempo.minimum);
    const alertas = [];

    if (ttl > 0 && ttl < 60) {
      alertas.push(
        '<strong>TTL muy bajo.</strong> Los cambios saldrán rápido, pero también dispararás el número de consultas y perderás bastante efecto de caché.'
      );
    } else if (ttl > 86400) {
      alertas.push(
        '<strong>TTL muy alto.</strong> Si haces cambios, podrían tardar más de un día en desaparecer de cachés externas.'
      );
    }

    if (retry > refresh && refresh > 0) {
      alertas.push(
        '<strong>Retry mayor que refresh.</strong> Si falla una comprobación, el siguiente reintento llegaría más tarde que la revisión normal, lo que suele ser poco intuitivo.'
      );
    }

    if (expire > 0 && refresh > 0 && expire <= refresh * 2) {
      alertas.push(
        '<strong>Expire muy ajustado.</strong> Si el maestro tiene un problema breve, los secundarios podrían invalidar la zona demasiado pronto.'
      );
    }

    if (minimum > ttl * 2 && ttl > 0) {
      alertas.push(
        '<strong>Minimum bastante más alto que TTL.</strong> Las respuestas negativas podrían quedarse en caché mucho más tiempo que los registros normales.'
      );
    }

    if (ttl === 0 || refresh === 0 || retry === 0 || expire === 0 || minimum === 0) {
      alertas.push(
        '<strong>Hay tiempos a cero.</strong> Solo debería hacerse con una intención muy clara, porque el comportamiento operativo puede volverse difícil de prever.'
      );
    }

    if (alertas.length === 0) {
      alertasSoa.hidden = true;
      alertasSoa.innerHTML = '';
      return;
    }

    alertasSoa.hidden = false;
    alertasSoa.innerHTML = alertas
      .map((alerta) => `<div class="dns-formulario-alerta">${alerta}</div>`)
      .join('');
  }

  function aplicarPreset(nombrePreset) {
    const preset = presets[nombrePreset];

    if (!preset) {
      return;
    }

    for (const [clave, valor] of Object.entries(preset)) {
      if (camposTiempo[clave]) {
        camposTiempo[clave].value = String(valor);
      }
    }

    refrescarSoa();

    window.portalToast?.show?.({
      tipo: 'informativo',
      titulo: 'SOA y TTL',
      cuerpo: `Se aplicó el preset "${resolverEtiquetaPreset(nombrePreset)}". Revísalo antes de guardar.`
    });
  }

  function resolverEtiquetaPreset(nombrePreset) {
    const etiquetas = {
      estable: 'Entorno estable',
      frecuente: 'Cambios frecuentes',
      migracion: 'Migración / ajuste fino'
    };

    return etiquetas[nombrePreset] || nombrePreset;
  }

  function refrescarSoa() {
    actualizarAyudasTiempo();
    actualizarAyudaRname();
    actualizarResumenSoa();
    actualizarAlertasSoa();
  }

  function escapeHtml(texto) {
    return String(texto)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function sincronizar() {
    refrescarEmpresas();
    refrescarSitios();
    refrescarRequeridos();
  }

  campoNivel.addEventListener('change', sincronizar);
  campoTenant.addEventListener('change', () => {
    refrescarEmpresas();
    refrescarSitios();
    refrescarRequeridos();
  });
  campoEmpresa.addEventListener('change', () => {
    refrescarSitios();
    refrescarRequeridos();
  });

  for (const campo of Object.values(camposTiempo)) {
    campo?.addEventListener('input', refrescarSoa);
    campo?.addEventListener('change', refrescarSoa);
  }

  for (const boton of botonesPreset) {
    boton.addEventListener('click', function () {
      aplicarPreset(boton.dataset.dnsPreset);
    });
  }

  campoRname?.addEventListener('input', actualizarAyudaRname);
  campoRname?.addEventListener('keyup', actualizarAyudaRname);

  sincronizar();
  refrescarSoa();
})();
