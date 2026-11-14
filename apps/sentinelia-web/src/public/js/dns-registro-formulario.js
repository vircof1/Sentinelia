(function iniciarFormularioRegistroDns() {
  const modulo = document.querySelector('[data-dns-registro-formulario]');

  if (!modulo) {
    return;
  }

  const formulario = modulo.querySelector('[data-dns-registro-formulario-submit]');
  const campoTipo = modulo.querySelector('[data-dns-registro-tipo]');
  const campoHost = modulo.querySelector('[data-dns-registro-host]');
  const campoActivo = modulo.querySelector('[data-dns-registro-activo]');
  const campoValorPrincipal = modulo.querySelector('[data-dns-registro-valor]');
  const campoTtl = modulo.querySelector('[data-dns-registro-ttl]');
  const ayudaTtl = modulo.querySelector('[data-dns-registro-ttl-ayuda]');
  const ayudaHost = modulo.querySelector('[data-dns-registro-host-ayuda]');
  const ayudaValorPrincipal = modulo.querySelector('[data-dns-registro-valor-ayuda]');
  const errorValorPrincipal = modulo.querySelector('[data-dns-registro-valor-error]');
  const etiquetaValorPrincipal = campoValorPrincipal?.labels?.[0]?.querySelector('.campo-etiqueta-ayuda > span');
  const campoPrioridad = modulo.querySelector('[data-dns-registro-prioridad]');
  const campoPeso = modulo.querySelector('[data-dns-registro-peso]');
  const campoPuerto = modulo.querySelector('[data-dns-registro-puerto]');
  const campoFlags = modulo.querySelector('[data-dns-registro-flags]');
  const campoTag = modulo.querySelector('[data-dns-registro-tag]');
  const advertenciaEdicionDdns = document.querySelector('[data-ddns-edicion-advertencia]');
  const confirmarEdicionDdns = advertenciaEdicionDdns?.querySelector('[data-ddns-edicion-confirmar]');
  const advertenciaCambioDdns = modulo.querySelector('[data-ddns-cambio-advertencia]');
  const modalCambioDdns = document.querySelector('[data-ddns-cambio-modal]');
  const confirmarCambioDdns = modalCambioDdns?.querySelector('[data-ddns-cambio-confirmar]');
  const modalRevocarDdns = document.querySelector('[data-ddns-revocar-modal]');
  const campoPublicar = modulo.querySelector('[data-dns-registro-publicar]');
  const campoCategoria = modulo.querySelector('[data-dns-registro-categoria]');
  const campoJson = modulo.querySelector('[data-dns-registro-json]');
  const ayudaJson = modulo.querySelector('[data-dns-registro-json-ayuda]');
  const bloqueContratoGobernanza = modulo.querySelector(
    '[data-dns-registro-contrato-gobernanza]'
  );
  const campoGobernanzaModo = modulo.querySelector(
    '[data-dns-registro-gobernanza-modo]'
  );
  const campoGobernanzaRol = modulo.querySelector(
    '[data-dns-registro-gobernanza-rol]'
  );
  const campoGobernanzaTtl = modulo.querySelector(
    '[data-dns-registro-gobernanza-ttl]'
  );
  const campoGobernanzaTtlContenedor = modulo.querySelector(
    '[data-dns-registro-gobernanza-ttl-campo]'
  );
  const ayudaContratoDdns = modulo.querySelector('[data-dns-registro-ddns-contrato]');
  const bloqueGobernanza = modulo.querySelector('[data-dns-registro-gobernanza]');
  const tituloGobernanza = modulo.querySelector('[data-dns-registro-gobernanza-titulo]');
  const textoGobernanza = modulo.querySelector('[data-dns-registro-gobernanza-texto]');
  const camposGobernanza = modulo.querySelector('[data-dns-registro-gobernanza-campos]');
  const ttlPoliticaGobernanza = modulo.querySelector(
    '[data-dns-registro-gobernanza-ttl-politica]'
  );
  const fuenteGobernanza = modulo.querySelector('[data-dns-registro-gobernanza-fuente]');
  const avisoEstadoGobernado = modulo.querySelector('[data-dns-registro-estado-gobernado]');
  const resumenNombre = modulo.querySelector('[data-dns-registro-resumen-nombre]');
  const resumenTipo = modulo.querySelector('[data-dns-registro-resumen-tipo]');
  const resumenTipoDetalle = modulo.querySelector('[data-dns-registro-resumen-tipo-detalle]');
  const resumenTtl = modulo.querySelector('[data-dns-registro-resumen-ttl]');
  const resumenTtlDetalle = modulo.querySelector('[data-dns-registro-resumen-ttl-detalle]');
  const resumenEstado = modulo.querySelector('[data-dns-registro-resumen-estado]');
  const resumenPublicacion = modulo.querySelector('[data-dns-registro-resumen-publicacion]');
  const preview = modulo.querySelector('[data-dns-registro-preview]');
  const ayudaEstado = modulo.querySelector('[data-dns-registro-estado-ayuda]');
  const bloqueMxSrv = modulo.querySelector('[data-dns-registro-bloque="mx_srv"]');
  const bloqueSrv = modulo.querySelector('[data-dns-registro-bloque="srv"]');
  const bloqueCaa = modulo.querySelector('[data-dns-registro-bloque="caa"]');
  const alertasContenedor = modulo.querySelector('[data-dns-registro-alertas]');
  const alertasLista = modulo.querySelector('[data-dns-registro-alertas-lista]');
  const estadoResumen = modulo.querySelector('[data-dns-registro-estado-resumen]');

  if (!campoTipo) {
    return;
  }

  let estadoSucio = false;
  let claveAlertasMostrada = '';
  let renderInicialCompletado = false;
  let valorPrincipalTocado = false;
  const nombreZona = String(modulo.dataset.zonaNombre || '').trim();
  const esEdicionRegistro = modulo.dataset.registroModo === 'editar';
  const ttlZona = Number.parseInt(String(modulo.dataset.zonaTtl || '3600'), 10) || 3600;
  const registroGobernadoInicial = String(
    modulo.dataset.registroGobernadoInicial || ''
  ) === '1';
  const registroGobernadoPorInicial = String(
    modulo.dataset.registroGobernadoPor || ''
  )
    .trim()
    .toLowerCase();
  const registroDdnsInicial = registroGobernadoPorInicial === 'ddns';
  const registroTipoInicial = String(modulo.dataset.registroTipoInicial || '')
    .trim()
    .toUpperCase();
  const registroCategoriaInicial = String(
    modulo.dataset.registroCategoriaInicial || ''
  ).trim().toLowerCase();
  const registroRolAsignadoInicial = String(
    modulo.dataset.registroRolAsignado || ''
  ).trim();
  const registroActivoInicial = String(modulo.dataset.registroActivoInicial || '1') === '1';
  const registroTtlInicial = String(modulo.dataset.registroTtlInicial || '').trim();
  const registroValorInicial = String(modulo.dataset.registroValorInicial || '');
  const registroPrioridadInicial = String(modulo.dataset.registroPrioridadInicial || '');
  const registroDdnsConcedido = modulo.dataset.registroDdnsConcedido === '1';
  const concesionesVigentesDdns = Number.parseInt(
    modulo.dataset.registroDdnsConcesionesVigentes || '0', 10
  ) || 0;
  let edicionDdnsConfirmada = false;
  let cambioDdnsConfirmado = false;
  let categoriaAnterior = campoCategoria?.value || 'normal';

  function ocultar(bloque, oculto) {
    if (!bloque) {
      return;
    }

    bloque.hidden = oculto;
  }

  function escapeHtml(valor) {
    return String(valor)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function normalizarNumero(valor) {
    const numero = Number.parseInt(String(valor ?? '').trim(), 10);
    return Number.isFinite(numero) ? numero : null;
  }

  function obtenerCategoriaActual() {
    return String(campoCategoria?.value || 'normal').trim().toLowerCase();
  }

  function cambiaContenidoDdns() {
    return String(campoValorPrincipal?.value || '') !== registroValorInicial ||
      String(campoPrioridad?.value || '') !== registroPrioridadInicial;
  }

  function incompatibilizaDdns() {
    return registroDdnsConcedido &&
      (obtenerTipo() !== registroTipoInicial ||
        obtenerCategoriaActual() !== registroCategoriaInicial);
  }

  if (formulario && registroDdnsConcedido) {
    formulario.addEventListener('submit', (evento) => {
      if (edicionDdnsConfirmada || incompatibilizaDdns() || !cambiaContenidoDdns()) {
        return;
      }
      evento.preventDefault();
      if (window.bootstrap?.Modal && advertenciaEdicionDdns) {
        window.bootstrap.Modal.getOrCreateInstance(advertenciaEdicionDdns).show();
        return;
      }
      if (window.confirm('El agente conserva autoridad y podría sustituir este valor. ¿Guardar de todos modos?')) {
        edicionDdnsConfirmada = true;
        formulario.requestSubmit();
      }
    });
    confirmarEdicionDdns?.addEventListener('click', () => {
      edicionDdnsConfirmada = true;
      window.bootstrap?.Modal.getInstance(advertenciaEdicionDdns)?.hide();
      formulario.requestSubmit();
    });
  }

  if (modalRevocarDdns) {
    const formularioRevocar = modalRevocarDdns.querySelector('[data-ddns-revocar-formulario]');
    const confirmarRevocar = modalRevocarDdns.querySelector('[data-ddns-revocar-confirmar]');
    modalRevocarDdns.addEventListener('show.bs.modal', (evento) => {
      const origen = evento.relatedTarget?.closest('[data-ddns-revocar-concesion]');
      if (!origen || !formularioRevocar || !confirmarRevocar) {
        return;
      }
      formularioRevocar.action = origen.dataset.ddnsRevocarAccion;
      modalRevocarDdns.querySelector('[data-ddns-revocar-agente]').textContent =
        origen.dataset.ddnsRevocarAgente || 'indicado';
      modalRevocarDdns.querySelector('[data-ddns-revocar-id]').textContent =
        origen.dataset.ddnsRevocarId || '';
      confirmarRevocar.disabled = false;
    });
    modalRevocarDdns.addEventListener('hidden.bs.modal', () => {
      formularioRevocar?.removeAttribute('action');
      if (confirmarRevocar) confirmarRevocar.disabled = true;
    });
    formularioRevocar?.addEventListener('submit', () => {
      if (confirmarRevocar) confirmarRevocar.disabled = true;
    });
  }

  function esCategoriaGobernable(categoria) {
    return categoria === 'trigger' || categoria === 'ddns';
  }

  function parsearJsonSeguro(valor) {
    const bruto = String(valor || '').trim();

    if (!bruto) {
      return null;
    }

    try {
      const parseado = JSON.parse(bruto);
      return parseado && typeof parseado === 'object' && !Array.isArray(parseado)
        ? parseado
        : null;
    } catch (_error) {
      return null;
    }
  }

  function obtenerJsonAuxiliarBase() {
    const bruto = String(campoJson?.value || '').trim();

    if (!bruto) {
      return {};
    }

    const parseado = parsearJsonSeguro(bruto);
    return parseado || false;
  }

  function resolverGobernanzaActual() {
    const categoria = obtenerCategoriaActual();
    if (!esCategoriaGobernable(categoria)) {
      return null;
    }
    const json = parsearJsonSeguro(campoJson?.value);
    const gobernadoPorJson = String(json?.gobernadoPor || '')
      .trim()
      .toLowerCase();
    const gobernadoPor = ['trigger', 'ddns'].includes(gobernadoPorJson)
      ? gobernadoPorJson
      : (['trigger', 'ddns'].includes(categoria) ? categoria : '');

    if (!gobernadoPor) {
      return null;
    }

    return {
      gobernadoPor,
      rolAsignado: String(json?.rolAsignado || '').trim() || null,
      modoControl: String(json?.modoControl || 'valor_y_activo')
        .trim()
        .toLowerCase() || 'valor_y_activo'
    };
  }

  function serializarJsonBonito(valor) {
    return JSON.stringify(valor, null, 2);
  }

  function sincronizarJsonGobernanza() {
    if (!campoJson) {
      return;
    }

    const categoria = obtenerCategoriaActual();

    if (!esCategoriaGobernable(categoria)) {
      if (esCategoriaGobernable(categoriaAnterior)) {
        const base = obtenerJsonAuxiliarBase();
        if (base !== false) {
          const siguiente = { ...base };
          for (const clave of [
            'gobernadoPor', 'modoControl', 'rolAsignado', 'ttlSugerido',
            'propietario', 'criterioActualizacion', 'politicaSobrescritura',
            'validacionOrigen'
          ]) {
            delete siguiente[clave];
          }
          campoJson.value = Object.keys(siguiente).length > 0
            ? serializarJsonBonito(siguiente)
            : '';
        }
      }
      return;
    }

    const base = obtenerJsonAuxiliarBase();

    if (base === false) {
      return;
    }

    const rolAsignado = String(campoGobernanzaRol?.value || '').trim();
    const ttlSugerido = String(campoGobernanzaTtl?.value || '').trim();
    const siguiente = {
      ...base,
      gobernadoPor: categoria,
      modoControl: String(campoGobernanzaModo?.value || 'valor_y_activo')
        .trim()
        .toLowerCase() || 'valor_y_activo'
    };

    if (rolAsignado) {
      siguiente.rolAsignado = rolAsignado;
    } else {
      delete siguiente.rolAsignado;
    }

    if (categoria === 'ddns') {
      if (ttlSugerido) {
        siguiente.ttlSugerido = Number.parseInt(ttlSugerido, 10);
      } else {
        siguiente.ttlSugerido = 300;
      }
      siguiente.propietario = String(siguiente.propietario || 'agente').trim() || 'agente';
      siguiente.criterioActualizacion =
        String(siguiente.criterioActualizacion || 'direccion_agente').trim() ||
        'direccion_agente';
      siguiente.politicaSobrescritura =
        String(siguiente.politicaSobrescritura || 'solo_si_cambia').trim() ||
        'solo_si_cambia';
      siguiente.validacionOrigen =
        String(siguiente.validacionOrigen || 'agente_autenticado_y_scope').trim() ||
        'agente_autenticado_y_scope';
    } else {
      delete siguiente.ttlSugerido;
      delete siguiente.propietario;
      delete siguiente.criterioActualizacion;
      delete siguiente.politicaSobrescritura;
      delete siguiente.validacionOrigen;
    }

    campoJson.value = serializarJsonBonito(siguiente);
  }

  function formatearSegundos(segundos) {
    if (!Number.isFinite(segundos) || segundos < 0) {
      return 'sin valor válido';
    }

    if (segundos < 60) {
      return `${segundos} s`;
    }

    if (segundos < 3600) {
      const minutos = segundos / 60;
      return Number.isInteger(minutos)
        ? `${minutos} min`
        : `${minutos.toFixed(1).replace('.', ',')} min`;
    }

    if (segundos < 86400) {
      const horas = segundos / 3600;
      return Number.isInteger(horas)
        ? `${horas} h`
        : `${horas.toFixed(1).replace('.', ',')} h`;
    }

    const dias = segundos / 86400;
    return Number.isInteger(dias)
      ? `${dias} d`
      : `${dias.toFixed(1).replace('.', ',')} d`;
  }

  function obtenerTipo() {
    return String(campoTipo.value || '').toUpperCase();
  }

  function obtenerHostVisible() {
    const host = String(campoHost?.value || '').trim();

    if (!host) {
      return 'Pendiente';
    }

    if (host === '@') {
      return nombreZona || '@';
    }

    return nombreZona ? `${host}.${nombreZona}` : host;
  }

  function describirTipo(tipo) {
    const mapa = {
      A: 'IPv4 directa para un host concreto.',
      AAAA: 'IPv6 directa para un host concreto.',
      CNAME: 'Alias hacia otro nombre DNS completo.',
      NS: 'Delegación a nameserver autoritativo.',
      TXT: 'Texto libre, útil para SPF, verificaciones y metadatos.',
      MX: 'Servidor de correo con prioridad explícita.',
      SRV: 'Servicio con prioridad, peso y puerto.',
      CAA: 'Restricción de autoridades de certificación.',
      PTR: 'Resolución inversa hacia nombre DNS completo.'
    };

    return mapa[tipo] || 'Registro DNS estándar.';
  }

  function construirPreview() {
    const tipo = obtenerTipo();
    const host = obtenerHostVisible();
    const valor = String(campoValorPrincipal?.value || '').trim() || '...';
    const ttl = normalizarNumero(campoTtl?.value);

    const piezas = [
      `<strong>${escapeHtml(host)}</strong>`,
      `<code>${escapeHtml(tipo)}</code>`,
      `<code>${escapeHtml(valor)}</code>`
    ];

    if (tipo === 'MX' || tipo === 'SRV') {
      const prioridad = normalizarNumero(campoPrioridad?.value);
      if (Number.isFinite(prioridad)) {
        piezas.push(`prioridad <code>${escapeHtml(prioridad)}</code>`);
      }
    }

    if (tipo === 'SRV') {
      const peso = normalizarNumero(campoPeso?.value);
      const puerto = normalizarNumero(campoPuerto?.value);
      if (Number.isFinite(peso)) {
        piezas.push(`peso <code>${escapeHtml(peso)}</code>`);
      }
      if (Number.isFinite(puerto)) {
        piezas.push(`puerto <code>${escapeHtml(puerto)}</code>`);
      }
    }

    if (tipo === 'CAA') {
      const flags = normalizarNumero(campoFlags?.value);
      const tag = String(campoTag?.value || '').trim();
      if (Number.isFinite(flags)) {
        piezas.push(`flags <code>${escapeHtml(flags)}</code>`);
      }
      if (tag) {
        piezas.push(`tag <code>${escapeHtml(tag)}</code>`);
      }
    }

    piezas.push(
      ttl == null
        ? `TTL heredado de zona <code>${escapeHtml(ttlZona)}</code>`
        : `TTL propio <code>${escapeHtml(ttl)}</code>`
    );

    return piezas.join(' · ');
  }

  function actualizarBloques() {
    const tipo = obtenerTipo();
    const esMx = tipo === 'MX';
    const esSrv = tipo === 'SRV';
    const esCaa = tipo === 'CAA';

    ocultar(bloqueMxSrv, !(esMx || esSrv));
    ocultar(bloqueSrv, !esSrv);
    ocultar(bloqueCaa, !esCaa);

    if (campoPrioridad) {
      campoPrioridad.required = esMx || esSrv;
      campoPrioridad.disabled = !(esMx || esSrv);
      if (!campoPrioridad.required) {
        campoPrioridad.value = '';
      }
    }

    if (campoPeso) {
      campoPeso.required = esSrv;
      campoPeso.disabled = !esSrv;
      if (!campoPeso.required) {
        campoPeso.value = '';
      }
    }

    if (campoPuerto) {
      campoPuerto.required = esSrv;
      campoPuerto.disabled = !esSrv;
      if (!campoPuerto.required) {
        campoPuerto.value = '';
      }
    }

    if (campoFlags) {
      campoFlags.required = esCaa;
      campoFlags.disabled = !esCaa;
      if (!campoFlags.required) {
        campoFlags.value = '';
      }
    }

    if (campoTag) {
      campoTag.required = esCaa;
      campoTag.disabled = !esCaa;
      if (!campoTag.required) {
        campoTag.value = '';
      }
    }
  }

  function actualizarAyudas() {
    const tipo = obtenerTipo();
    const ttl = normalizarNumero(campoTtl?.value);
    const gobernanza = resolverGobernanzaActual();
    const ejemplos = {
      A: {
        etiqueta: 'Dirección IPv4',
        placeholder: '127.0.0.1',
        ayuda: 'Para <code>A</code> usa una IPv4, por ejemplo <code>127.0.0.1</code>.'
      },
      AAAA: {
        etiqueta: 'Dirección IPv6',
        placeholder: '2001:db8::1',
        ayuda: 'Para <code>AAAA</code> usa una IPv6, por ejemplo <code>2001:db8::1</code>.'
      },
      CNAME: {
        etiqueta: 'Destino (nombre DNS)',
        placeholder: 'destino.empresa.local',
        ayuda: 'Para <code>CNAME</code> usa siempre un nombre DNS completo de destino.'
      },
      NS: {
        etiqueta: 'Servidor de nombres',
        placeholder: 'ns1.empresa.local',
        ayuda: 'Para <code>NS</code> indica el nameserver autoritativo en formato completo.'
      },
      TXT: {
        etiqueta: 'Texto del registro',
        placeholder: 'v=spf1 include:empresa.local ~all',
        ayuda: 'Para <code>TXT</code> introduce el texto íntegro que quieras publicar.'
      },
      MX: {
        etiqueta: 'Servidor de correo',
        placeholder: 'mail.empresa.local',
        ayuda: 'Para <code>MX</code> el valor principal es el host destino; la prioridad va aparte.'
      },
      SRV: {
        etiqueta: 'Servidor del servicio',
        placeholder: 'sipserver.empresa.local',
        ayuda: 'Para <code>SRV</code> el valor principal es el host destino; prioridad, peso y puerto van aparte.'
      },
      CAA: {
        etiqueta: 'Dominio de la CA',
        placeholder: 'letsencrypt.org',
        ayuda: 'Para <code>CAA</code> el valor principal suele ser la CA; completa además <code>flags</code> y <code>tag</code>.'
      },
      PTR: {
        etiqueta: 'Nombre de destino',
        placeholder: 'host.empresa.local',
        ayuda: 'Para <code>PTR</code> usa el nombre DNS completo al que debe resolver el puntero.'
      }
    };
    const ejemplo = ejemplos[tipo] || ejemplos.A;

    if (etiquetaValorPrincipal) {
      etiquetaValorPrincipal.textContent = ejemplo.etiqueta;
    }

    if (campoValorPrincipal) {
      campoValorPrincipal.placeholder = ejemplo.placeholder;
    }

    if (ayudaValorPrincipal) {
      if (registroDdnsInicial) {
        ayudaValorPrincipal.innerHTML = `Puedes intervenir sobre el <code>valor principal</code>. Si el registro está concedido, la edición avanzará su versión DDNS sin retirar la autoridad del agente; una actuación posterior podrá sustituirla.`;
      } else if (registroGobernadoInicial) {
        ayudaValorPrincipal.innerHTML = `El <code>valor principal</code> está gobernado por automatización <code>${escapeHtml(registroGobernadoPorInicial || 'externa')}</code> y queda en solo lectura para evitar ambigüedad humana.`;
      } else if (gobernanza?.gobernadoPor === 'ddns') {
        ayudaValorPrincipal.innerHTML = `${ejemplo.ayuda} Al marcarlo como <code>ddns</code>, este valor quedará preparado para futuras actualizaciones automáticas.`;
      } else if (gobernanza?.gobernadoPor === 'trigger') {
        ayudaValorPrincipal.innerHTML = `${ejemplo.ayuda} Al marcarlo como acción, este valor podrá quedar gobernado por eventos internos de plataforma.`;
      } else {
        ayudaValorPrincipal.innerHTML = ejemplo.ayuda;
      }
    }

    if (ayudaHost) {
      const host = String(campoHost?.value || '').trim();
      ayudaHost.innerHTML = host === '@'
        ? `La raíz resolverá como <code>${escapeHtml(nombreZona)}</code>.`
        : `Se interpretará dentro de <code>${escapeHtml(nombreZona)}</code>.`;
    }

    if (ayudaTtl) {
      ayudaTtl.textContent = ttl == null
        ? `Vacío: heredará ${ttlZona} s (${formatearSegundos(ttlZona)}) desde la zona.`
        : `${ttl} s = ${formatearSegundos(ttl)}.`;
    }

    if (ayudaEstado) {
      const activo = String(campoActivo?.value || '1') !== '0';
      ayudaEstado.textContent = activo
        ? 'El registro podrá considerarse en publicación cuando el catálogo se reproyecte.'
        : 'Se persistirá sin participación operativa.';
    }

    if (ayudaJson) {
      const bruto = String(campoJson?.value || '').trim();
      if (!bruto) {
        const categoria = obtenerCategoriaActual();
        if (categoria === 'trigger' || categoria === 'ddns') {
          ayudaJson.textContent = `Si lo dejas vacío, el sistema completará los datos necesarios para ${categoria === 'trigger' ? 'la acción' : 'DDNS'}.`;
        } else {
          ayudaJson.textContent = 'Déjalo vacío salvo que una integración concreta te lo pida.';
        }
        return;
      }

      try {
        const parseado = JSON.parse(bruto);
        if (!parseado || typeof parseado !== 'object' || Array.isArray(parseado)) {
          ayudaJson.textContent = 'Debe ser un objeto JSON, no una lista ni un valor suelto.';
        } else {
          const claves = Object.keys(parseado);
          const gobernadoPor = String(parseado.gobernadoPor || '').trim();
          ayudaJson.textContent = gobernadoPor
            ? `JSON válido con ${claves.length} clave(s). Gobernanza declarada para ${gobernadoPor}.`
            : `JSON válido con ${claves.length} clave(s).`;
        }
      } catch (_error) {
        ayudaJson.textContent = 'JSON no válido todavía. Revisa comillas, llaves y comas.';
      }
    }
  }

  function obtenerErrorValorPrincipal() {
    const valor = String(campoValorPrincipal?.value || '').trim();
    const tipo = obtenerTipo();

    if (!valor) {
      return 'Indica el valor del registro.';
    }

    if (tipo === 'A') {
      const partes = valor.split('.');
      if (partes.length !== 4 || partes.some((parte) =>
        !/^\d{1,3}$/.test(parte) ||
        (parte.length > 1 && parte.startsWith('0')) ||
        Number(parte) > 255
      )) {
        return 'Introduce una dirección IPv4 válida, por ejemplo 192.0.2.1.';
      }
    }

    if (tipo === 'AAAA') {
      try {
        if (!valor.includes(':') || !/^[\da-f:.]+$/i.test(valor)) {
          throw new Error('IPv6 inválida');
        }
        new URL(`http://[${valor}]/`);
      } catch (_error) {
        return 'Introduce una dirección IPv6 válida, por ejemplo 2001:db8::1.';
      }
    }

    if (['CNAME', 'NS', 'MX', 'SRV', 'PTR'].includes(tipo)) {
      const nombre = valor.toLowerCase().replace(/\.+$/, '');
      const etiquetas = nombre.split('.');
      if (nombre.length > 253 || etiquetas.some((etiqueta) =>
        !/^[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?$/.test(etiqueta)
      )) {
        return 'Introduce un nombre DNS válido, por ejemplo destino.empresa.local.';
      }
    }

    return '';
  }

  function actualizarValidacionValor() {
    if (!campoValorPrincipal) {
      return;
    }

    const error = obtenerErrorValorPrincipal();
    campoValorPrincipal.setCustomValidity(error);
    const mostrar = valorPrincipalTocado && Boolean(error);
    campoValorPrincipal.classList.toggle('is-invalid', mostrar);
    campoValorPrincipal.setAttribute('aria-invalid', mostrar ? 'true' : 'false');
    if (errorValorPrincipal) {
      errorValorPrincipal.textContent = mostrar ? error : '';
      errorValorPrincipal.hidden = !mostrar;
    }
  }

  function actualizarGobernanza() {
    const gobernanza = resolverGobernanzaActual();
    const categoria = obtenerCategoriaActual();

    if (campoValorPrincipal) {
      campoValorPrincipal.readOnly = registroGobernadoInicial;
      campoValorPrincipal.classList.toggle(
        'dns-registro-formulario__campo-bloqueado',
        registroGobernadoInicial
      );
    }

    if (bloqueContratoGobernanza) {
      bloqueContratoGobernanza.hidden = !esCategoriaGobernable(categoria);
    }

    if (campoGobernanzaTtlContenedor) {
      campoGobernanzaTtlContenedor.hidden = categoria !== 'ddns';
    }

    if (ayudaContratoDdns) {
      ayudaContratoDdns.hidden = categoria !== 'ddns';
    }

    if (campoGobernanzaModo) {
      campoGobernanzaModo.disabled = !esCategoriaGobernable(categoria);
    }

    if (campoGobernanzaRol) {
      campoGobernanzaRol.disabled = !esCategoriaGobernable(categoria);
    }

    if (campoGobernanzaTtl) {
      campoGobernanzaTtl.disabled = categoria !== 'ddns';
    }

    if (avisoEstadoGobernado) {
      avisoEstadoGobernado.hidden = !(registroGobernadoInicial || gobernanza);
    }

    if (camposGobernanza) {
      camposGobernanza.textContent = categoria === 'ddns'
        ? 'valorPrincipal; prioridad en MX'
        : 'valorPrincipal + activo';
    }

    if (ttlPoliticaGobernanza) {
      ttlPoliticaGobernanza.textContent = categoria === 'ddns'
        ? 'Manual; el contrato solo guarda una sugerencia DDNS'
        : 'Manual por administrador';
    }

    if (fuenteGobernanza) {
      fuenteGobernanza.textContent = 'SQL, proyectado después a BIND';
    }

    if (!bloqueGobernanza || !tituloGobernanza || !textoGobernanza) {
      return;
    }

    if (!gobernanza && !registroGobernadoInicial) {
      bloqueGobernanza.hidden = true;
      return;
    }

    bloqueGobernanza.hidden = false;

    if (registroDdnsInicial) {
      tituloGobernanza.textContent = 'Registro DDNS con intervención humana permitida';
      textoGobernanza.innerHTML = `El <code>valor principal</code> y, para MX, la <code>prioridad</code> pueden editarse manualmente. Si existe una concesión vigente, Sentinelia conservará el modo elegido por el agente y avanzará la misma versión causal. No existe precedencia humana permanente: el agente podrá sustituir después este contenido. El TTL y las demás propiedades continúan bajo administración ordinaria.`;
      return;
    }

    if (registroGobernadoInicial) {
      tituloGobernanza.textContent = `Registro gobernado por ${registroGobernadoPorInicial === 'trigger' ? 'una acción' : (registroGobernadoPorInicial || 'automatización')}`;
      textoGobernanza.innerHTML = `El <code>valor principal</code> está en solo lectura para humanos. Puedes seguir administrando el resto del registro, pero <code>valorPrincipal</code> y <code>activo</code> pertenecen al contrato automático y pueden ser sobrescritos. ${registroRolAsignadoInicial ? `Rol lógico asignado: <code>${escapeHtml(registroRolAsignadoInicial)}</code>.` : ''}`;
      return;
    }

    if (gobernanza?.gobernadoPor === 'ddns') {
      tituloGobernanza.textContent = 'Registro preparado para DDNS';
      textoGobernanza.innerHTML = `Quedará marcado para futura actualización dinámica controlada por agentes. El <code>TTL</code> sigue siendo una decisión administrativa; si lo dejas vacío, se sugerirá un valor corto al preparar el registro.`;
      return;
    }

    tituloGobernanza.textContent = 'Registro preparado para una acción';
    textoGobernanza.innerHTML = `Quedará marcado para automatización por eventos internos de plataforma. En esta primera fase, el gobierno automático previsto recae sobre <code>valorPrincipal</code> y <code>activo</code>.`;
  }

  function actualizarResumen() {
    const tipo = obtenerTipo();
    const ttl = normalizarNumero(campoTtl?.value);
    const activo = String(campoActivo?.value || '1') !== '0';
    const publicar = Boolean(campoPublicar?.checked);
    const categoria = campoCategoria?.value || 'normal';
    const gobernanza = resolverGobernanzaActual();

    if (resumenNombre) {
      resumenNombre.textContent = obtenerHostVisible();
    }

    if (resumenTipo) {
      resumenTipo.textContent = tipo;
    }

    if (resumenTipoDetalle) {
      resumenTipoDetalle.textContent = ` · ${describirTipo(tipo)}`;
    }

    if (resumenTtl) {
      resumenTtl.textContent = `${ttl == null ? ttlZona : ttl} s`;
    }

    if (resumenTtlDetalle) {
      resumenTtlDetalle.textContent = ttl == null
        ? '. Este registro heredará el TTL por defecto de la zona.'
        : '. Este registro sobreescribe el TTL de la zona.';
    }

    if (resumenEstado) {
      resumenEstado.textContent = activo ? 'Activo' : 'Inactivo';
    }

    if (resumenPublicacion) {
      if (registroDdnsConcedido && categoria === 'ddns') {
        resumenPublicacion.textContent = `DDNS: ${concesionesVigentesDdns} ${concesionesVigentesDdns === 1 ? 'concesión vigente' : 'concesiones vigentes'}. ${publicar ? 'Publicación en BIND según el modo de la zona.' : 'No se publicará en BIND.'}`;
      } else if (!publicar) {
        resumenPublicacion.textContent = 'No se publicará en BIND.';
      } else if (gobernanza?.gobernadoPor === 'ddns') {
        resumenPublicacion.textContent = 'DDNS sin concesión vigente. Publicación en BIND según el modo de la zona.';
      } else if (gobernanza?.gobernadoPor === 'trigger') {
        resumenPublicacion.textContent = 'Preparado para una acción. Publicación en BIND según el modo de la zona.';
      } else if (categoria === 'sistema') {
        resumenPublicacion.textContent = 'Registro de sistema. Publicación en BIND según el modo de la zona.';
      } else {
        resumenPublicacion.textContent = 'Publicación en BIND según el modo de la zona.';
      }
    }

    if (preview) {
      preview.innerHTML = construirPreview();
    }
  }

  function recopilarAlertas() {
    const alertas = [];
    const tipo = obtenerTipo();
    const host = String(campoHost?.value || '').trim();
    const valor = String(campoValorPrincipal?.value || '').trim();
    const ttl = normalizarNumero(campoTtl?.value);
    const prioridad = normalizarNumero(campoPrioridad?.value);
    const peso = normalizarNumero(campoPeso?.value);
    const puerto = normalizarNumero(campoPuerto?.value);
    const flags = normalizarNumero(campoFlags?.value);
    const tag = String(campoTag?.value || '').trim().toLowerCase();
    const json = String(campoJson?.value || '').trim();
    const categoria = obtenerCategoriaActual();
    const activo = String(campoActivo?.value || '1') !== '0';
    const ttlBruto = String(campoTtl?.value || '').trim();

    if (!host) {
      alertas.push('Falta indicar el host relativo.');
    }

    if (host.includes(nombreZona)) {
      alertas.push('Parece que has escrito la zona completa en el host relativo. Aquí solo va la parte relativa.');
    }

    if (ttl != null && ttl > 86400) {
      alertas.push('El TTL es muy alto. Revisa que quieras una caché tan larga para este registro.');
    }

    if (ttl != null && ttl > 0 && ttl < 60) {
      alertas.push('El TTL es muy bajo. Propagará cambios rápido, pero aumentará consultas y ruido de caché.');
    }

    if (categoria === 'ddns' && ttl == null) {
      alertas.push('Los registros DDNS suelen agradecer un TTL corto. Si no tienes un criterio claro, 300 s es un buen punto de partida.');
    }

    if (registroGobernadoInicial && activo !== registroActivoInicial) {
      alertas.push('Has cambiado el estado activo de un registro gobernado. Es válido, pero la automatización puede volver a escribir ese estado.');
    }

    if (registroGobernadoInicial && ttlBruto !== registroTtlInicial) {
      alertas.push('Has cambiado el TTL de un registro gobernado. El TTL es manual, pero revisa que sea coherente con la velocidad de la automatización.');
    }

    if (tipo === 'MX' && prioridad == null) {
      alertas.push('El registro MX necesita prioridad.');
    }

    if (tipo === 'SRV') {
      if (prioridad == null) {
        alertas.push('El registro SRV necesita prioridad.');
      }
      if (peso == null) {
        alertas.push('El registro SRV necesita peso.');
      }
      if (puerto == null) {
        alertas.push('El registro SRV necesita puerto.');
      }
    }

    if (tipo === 'CAA') {
      if (flags == null) {
        alertas.push('El registro CAA necesita flags.');
      }
      if (!tag) {
        alertas.push('El registro CAA necesita tag.');
      }
      if (tag && !['issue', 'issuewild', 'iodef'].includes(tag)) {
        alertas.push('El tag CAA no es de los más habituales. Revisa que sea intencional.');
      }
    }

    if (tipo === 'CNAME' && host === '@') {
      alertas.push('Un CNAME en la raíz de zona suele ser delicado. Revisa que de verdad quieras ese diseño.');
    }

    if (tipo === 'TXT' && valor.length > 255) {
      alertas.push('El TXT es largo. Revisa formato, partición lógica o si realmente debe ir completo así.');
    }

    if (json) {
      try {
        const parseado = JSON.parse(json);
        if (!parseado || typeof parseado !== 'object' || Array.isArray(parseado)) {
          alertas.push('Los datos auxiliares deben ser un objeto JSON.');
        } else if (parseado.gobernadoPor && parseado.gobernadoPor !== categoria) {
          alertas.push('La gobernanza del JSON no coincide con la categoría. Revisa los datos técnicos antes de guardar.');
        }
      } catch (_error) {
        alertas.push('Los datos auxiliares no contienen JSON válido todavía.');
      }
    }

    return alertas;
  }

  function actualizarAlertas() {
    const alertas = recopilarAlertas();
    const claveActual = alertas.join('|');
    const habiaAlertasAntes = Boolean(claveAlertasMostrada);

    if (alertasContenedor && alertasLista) {
      alertasLista.innerHTML = alertas
        .map((alerta) => `<li>${escapeHtml(alerta)}</li>`)
        .join('');
      alertasContenedor.hidden = alertas.length === 0;
    }

    if (
      renderInicialCompletado &&
      estadoSucio &&
      alertas.length > 0 &&
      !habiaAlertasAntes
    ) {
      window.portalToast?.show?.({
        tipo: 'advertencia',
        titulo: 'Registro DNS',
        cuerpo: 'Hay detalles que conviene revisar antes de guardar.'
      });
    }

    claveAlertasMostrada = claveActual;
    return alertas;
  }

  function actualizarEstado() {
    const alertas = actualizarAlertas();

    if (!estadoResumen) {
      return;
    }

    const camposObligatorios = [...formulario.querySelectorAll('[required]')]
      .filter((campo) => campo.willValidate && campo.validity.valueMissing);
    if (camposObligatorios.length > 0) {
      const etiquetas = camposObligatorios.map((campo) =>
        campo.labels?.[0]?.innerText?.trim().replace(/\s+/g, ' ') || campo.name
      );
      estadoResumen.textContent = `Completa ${etiquetas.join(', ')} antes de guardar.`;
      return;
    }

    if (!formulario.checkValidity()) {
      estadoResumen.textContent = 'Revisa los campos con errores antes de guardar.';
      return;
    }

    if (alertas.length > 0) {
      estadoResumen.textContent = `Hay ${alertas.length} punto${alertas.length === 1 ? '' : 's'} a revisar antes de guardar.`;
      return;
    }

    estadoResumen.textContent = !estadoSucio && esEdicionRegistro
      ? 'Sin cambios pendientes.'
      : 'Campos completos. Revisa la vista previa antes de guardar.';
  }

  function marcarComoSucio() {
    estadoSucio = true;
  }

  function actualizarAdvertenciaCambioDdns() {
    if (advertenciaCambioDdns) {
      advertenciaCambioDdns.hidden = !incompatibilizaDdns();
    }
  }

  function refrescar() {
    actualizarBloques();
    actualizarAyudas();
    actualizarValidacionValor();
    actualizarGobernanza();
    actualizarResumen();
    actualizarAdvertenciaCambioDdns();
    actualizarEstado();
  }

  if (formulario) {
    for (const campo of formulario.querySelectorAll('input, select, textarea')) {
      const evento = campo.tagName === 'SELECT' ? 'change' : 'input';
      campo.addEventListener(evento, function () {
        if (campo === campoCategoria) {
          return;
        }
        if (campo === campoValorPrincipal ||
          (campo === campoTipo && String(campoValorPrincipal?.value || '').trim())) {
          valorPrincipalTocado = true;
        }
        if (
          campo === campoGobernanzaModo ||
          campo === campoGobernanzaRol ||
          campo === campoGobernanzaTtl
        ) {
          sincronizarJsonGobernanza();
        }

        marcarComoSucio();
        refrescar();
      });
    }

    formulario.addEventListener('submit', function (evento) {
      sincronizarJsonGobernanza();
      if (!incompatibilizaDdns() || cambioDdnsConfirmado) {
        return;
      }
      evento.preventDefault();
      if (window.bootstrap?.Modal && modalCambioDdns) {
        window.bootstrap.Modal.getOrCreateInstance(modalCambioDdns).show();
        return;
      }
      if (window.confirm('Cambiar el tipo o retirar DDNS revocará la concesión vigente. ¿Guardar los cambios?')) {
        cambioDdnsConfirmado = true;
        formulario.requestSubmit();
        setTimeout(() => { cambioDdnsConfirmado = false; }, 0);
      }
    });
  }

  confirmarCambioDdns?.addEventListener('click', () => {
    cambioDdnsConfirmado = true;
    window.bootstrap?.Modal.getInstance(modalCambioDdns)?.hide();
    formulario.requestSubmit();
    setTimeout(() => { cambioDdnsConfirmado = false; }, 0);
  });

  campoValorPrincipal?.addEventListener('blur', () => {
    valorPrincipalTocado = true;
    refrescar();
  });
  campoValorPrincipal?.addEventListener('invalid', () => {
    valorPrincipalTocado = true;
    actualizarValidacionValor();
  });

  if (campoCategoria && campoTtl) {
    campoCategoria.addEventListener('change', function () {
      const categoriaActual = obtenerCategoriaActual();
      const ttlActual = String(campoTtl.value || '').trim();

      if (
        categoriaActual === 'ddns' &&
        categoriaAnterior !== 'ddns' &&
        !ttlActual &&
        !registroGobernadoInicial
      ) {
        campoTtl.value = '300';
      }

      if (
        categoriaActual === 'ddns' &&
        campoGobernanzaTtl &&
        !String(campoGobernanzaTtl.value || '').trim()
      ) {
        campoGobernanzaTtl.value = '300';
      }

      sincronizarJsonGobernanza();

      categoriaAnterior = categoriaActual;
      marcarComoSucio();
      refrescar();
    });
  }

  refrescar();
  renderInicialCompletado = true;
})();
