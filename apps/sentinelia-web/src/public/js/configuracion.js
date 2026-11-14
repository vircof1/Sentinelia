(function () {
  const raiz = document.querySelector('[data-configuracion]');

  if (!raiz) {
    return;
  }

  const formularios = Array.from(
    raiz.querySelectorAll('form[data-configuracion-ajax]')
  );
  const contenedorFeedback = raiz.querySelector(
    '[data-configuracion-feedback]'
  );
  const nodoVersion = raiz.querySelector('[data-configuracion-version]');
  const nodoRedPublica = raiz.querySelector('[data-red-publica-federacion]');
  const buscadorClaves = raiz.querySelector('[data-configuracion-buscador]');
  const resultadoClaves = raiz.querySelector('[data-configuracion-resultados]');
  const sinResultadosClaves = raiz.querySelector('[data-configuracion-sin-resultados]');
  const gruposClaves = Array.from(raiz.querySelectorAll('[data-configuracion-grupo]'));
  const totalClaves = raiz.querySelectorAll('[data-configuracion-fila]').length;
  let estadoGruposAntesBusqueda = null;

  for (const formulario of formularios) {
    formulario.addEventListener('submit', enviarFormularioAjax);
  }

  buscadorClaves?.addEventListener('input', filtrarClaves);

  function normalizarBusqueda(texto) {
    return String(texto || '').normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('es')
      .trim();
  }

  function filtrarClaves() {
    const consulta = normalizarBusqueda(buscadorClaves?.value);
    if (consulta && !estadoGruposAntesBusqueda) {
      estadoGruposAntesBusqueda = new Map(gruposClaves.map((grupo) => [grupo, grupo.open]));
    }

    let visibles = 0;
    let gruposVisibles = 0;
    for (const grupo of gruposClaves) {
      let coincidencias = 0;
      for (const fila of grupo.querySelectorAll('[data-configuracion-fila]')) {
        const indice = normalizarBusqueda(
          `${fila.dataset.configuracionClave || ''} ${fila.querySelector('.descripcion-configuracion')?.textContent || ''}`
        );
        const coincide = !consulta || indice.includes(consulta);
        fila.hidden = !coincide;
        if (coincide) coincidencias += 1;
      }
      grupo.hidden = coincidencias === 0;
      if (coincidencias > 0) gruposVisibles += 1;
      visibles += coincidencias;
      if (consulta) grupo.open = coincidencias > 0;
      else if (estadoGruposAntesBusqueda) grupo.open = estadoGruposAntesBusqueda.get(grupo);
    }
    if (!consulta) estadoGruposAntesBusqueda = null;
    if (sinResultadosClaves) sinResultadosClaves.hidden = visibles !== 0;
    if (resultadoClaves) {
      resultadoClaves.textContent = consulta
        ? `${visibles} de ${totalClaves} claves en ${gruposVisibles} ${gruposVisibles === 1 ? 'grupo' : 'grupos'}.`
        : `${totalClaves} claves en ${gruposClaves.length} grupos.`;
    }
  }

  async function enviarFormularioAjax(evento) {
    evento.preventDefault();

    const formulario = evento.currentTarget;

    if (!(formulario instanceof HTMLFormElement)) {
      return;
    }

    if (interceptarHabilitacionRecuperacion(formulario)) {
      return;
    }

    const botones = Array.from(
      formulario.querySelectorAll('button, input[type="submit"]')
    );
    const contenidosOriginales = new Map();

    for (const boton of botones) {
      contenidosOriginales.set(boton, boton.innerHTML);
      boton.disabled = true;
      boton.textContent = 'Guardando...';
    }

    try {
      const datos = await postFormularioJson(formulario);

      if (datos.recargar) {
        window.portalToast?.persist({
          tipo: 'satisfactorio',
          titulo: 'Configuración',
          cuerpo: datos.mensaje || 'La configuración se ha sincronizado.'
        });
        window.location.reload();
        return;
      }

      aplicarRespuesta(datos);
      mostrarFeedback('exito', datos.mensaje || 'Operación completada.');
      window.portalToast?.show({
        tipo: 'satisfactorio',
        titulo: 'Configuración',
        cuerpo: datos.mensaje || 'Operación completada.'
      });
    } catch (error) {
      const mensaje =
        error.message || 'No se pudo completar la operación solicitada.';
      mostrarFeedback('error', mensaje);
      window.portalToast?.show({
        tipo: 'error',
        titulo: 'Configuración',
        cuerpo: mensaje
      });
    } finally {
      for (const boton of botones) {
        boton.disabled = false;
        boton.innerHTML = contenidosOriginales.get(boton) || boton.innerHTML;
      }
    }
  }

  async function postFormularioJson(formulario) {
    const cuerpo = new URLSearchParams(new FormData(formulario));

    const respuesta = await window.fetch(formulario.action, {
      method: String(formulario.method || 'POST').toUpperCase(),
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        'X-Silenciar-Toast-Error': '1'
      },
      body: cuerpo
    });
    const datos = await respuesta.json().catch(function () {
      return {};
    });

    if (!respuesta.ok || datos.ok === false) {
      throw new Error(
        datos.mensaje || 'La configuración no pudo guardarse correctamente.'
      );
    }

    return datos;
  }

  function aplicarRespuesta(datos) {
    if (datos.estadoConfiguracion && nodoVersion) {
      nodoVersion.textContent = String(datos.estadoConfiguracion.version ?? '');
    }

    if (datos.redPublicaFederacion && nodoRedPublica) {
      aplicarEstadoRedPublica(datos.redPublicaFederacion);
    }

    if (datos.estadoRecuperacionPassword) {
      aplicarEstadoRecuperacion(datos.estadoRecuperacionPassword);
    }

    if (!datos.clave || !datos.entrada) {
      return;
    }

    const fila = buscarFilaPorClave(datos.clave);

    if (!fila) {
      return;
    }

    const nodoActual = fila.querySelector('[data-configuracion-actual]');

    if (nodoActual) {
      nodoActual.textContent = String(datos.entrada.valorVisible ?? '');
    }

    sincronizarCampoEditable(fila, datos.entrada);
    marcarFilaActualizada(fila);
  }

  function aplicarEstadoRecuperacion(estado) {
    raiz.dataset.recuperacionIntencion = String(
      estado.intencionHabilitada === true
    );
    raiz.dataset.recuperacionHabilitable = String(
      estado.puedeHabilitar === true
    );
    const seccion = raiz.querySelector('[data-recuperacion-password]');
    if (!seccion) return;
    const etiqueta = seccion.querySelector('[data-recuperacion-estado]');
    const intencion = seccion.querySelector('[data-recuperacion-intencion-texto]');
    const requisitos = seccion.querySelector('[data-recuperacion-prerrequisitos]');
    if (etiqueta) {
      etiqueta.textContent = estado.disponible
        ? 'Disponible'
        : estado.intencionHabilitada
          ? 'Habilitada, no disponible'
          : 'Deshabilitada';
    }
    if (intencion) {
      intencion.textContent = estado.intencionHabilitada
        ? 'Habilitada'
        : 'Deshabilitada';
    }
    if (requisitos) {
      requisitos.textContent = `${
        (estado.dependencias || []).filter((item) => item.satisfecha).length
      }/${(estado.dependencias || []).length}`;
    }
    reemplazarDependencias(
      seccion.querySelector('[data-recuperacion-dependencias]'),
      estado.dependencias || []
    );
    reemplazarDependencias(
      document.querySelector('[data-recuperacion-dependencias-modal]'),
      (estado.dependencias || []).filter((item) => !item.satisfecha)
    );
  }

  function reemplazarDependencias(contenedor, dependencias) {
    if (!contenedor) return;
    contenedor.replaceChildren();
    for (const dependencia of dependencias) {
      const fila = document.createElement('li');
      const estado = document.createElement('strong');
      estado.textContent = `${dependencia.satisfecha ? 'Disponible' : 'Pendiente'}: `;
      fila.append(estado, document.createTextNode(
        String(dependencia.descripcion || '')
      ));
      contenedor.append(fila);
    }
  }

  function interceptarHabilitacionRecuperacion(formulario) {
    const clave = formulario.querySelector('[name="clave"]');
    const campo = formulario.querySelector('[name="valor"]');
    if (clave?.value !== 'usuarios.recuperacion_email_activa' ||
        String(campo?.value) !== 'true' ||
        raiz.dataset.recuperacionIntencion === 'true' ||
        raiz.dataset.recuperacionHabilitable === 'true') {
      return false;
    }
    campo.value = 'false';
    const modal = document.getElementById('modal-recuperacion-no-habilitable');
    if (modal && window.bootstrap?.Modal) {
      window.bootstrap.Modal.getOrCreateInstance(modal).show();
    } else {
      window.alert('La recuperación todavía no cumple sus dependencias obligatorias.');
    }
    return true;
  }

  function aplicarEstadoRedPublica(estado) {
    nodoRedPublica.dataset.estado = String(estado.estado || 'incompleta');
    asignarTexto('[data-red-publica-estado]', estado.etiquetaEstado);
    asignarTexto('[data-red-publica-origen]', estado.origenPublico || 'No definido');
    asignarTexto('[data-red-publica-total-proxies]', estado.totalProxiesConfiables);
    asignarTexto('[data-red-publica-version]', estado.versionConfiguracion);
    asignarTexto(
      '[data-red-publica-capacidad-activacion]',
      estado.capacidades?.activacion?.etiqueta || 'Desconocida'
    );
    asignarTexto(
      '[data-red-publica-capacidad-emision]',
      estado.capacidades?.emision?.etiqueta || 'Desconocida'
    );
    asignarTexto(
      '[data-red-publica-capacidad-recepcion]',
      estado.capacidades?.recepcion?.etiqueta || 'Desconocida'
    );

    const avisoModoEmisor = nodoRedPublica.querySelector(
      '[data-red-publica-modo-emisor]'
    );
    if (avisoModoEmisor) {
      avisoModoEmisor.hidden = !(
        estado.emisionDisponible && !estado.recepcionPreparada
      );
    }

    const proxies = nodoRedPublica.querySelector('[data-red-publica-proxies]');
    if (proxies) {
      reemplazarEtiquetas(
        proxies,
        estado.proxiesConfiables?.length ? estado.proxiesConfiables : ['Ninguno'],
        'code'
      );
    }
    const advertencias = nodoRedPublica.querySelector(
      '[data-red-publica-advertencias]'
    );
    if (advertencias) {
      advertencias.replaceChildren();
      for (const advertencia of estado.advertencias || []) {
        const fila = document.createElement('div');
        fila.className =
          'mensaje-advertencia configuracion-red-federada__advertencia';
        const icono = document.createElement('i');
        icono.className = 'bi bi-exclamation-triangle';
        icono.setAttribute('aria-hidden', 'true');
        const texto = document.createElement('span');
        texto.textContent = String(advertencia.mensaje || '');
        fila.append(icono, texto);
        advertencias.append(fila);
      }
    }
  }

  function asignarTexto(selector, valor) {
    const nodo = nodoRedPublica.querySelector(selector);
    if (nodo) nodo.textContent = String(valor ?? '');
  }

  function reemplazarEtiquetas(contenedor, valores, etiqueta) {
    contenedor.replaceChildren();
    for (const valor of valores) {
      const nodo = document.createElement(etiqueta);
      nodo.className = 'insignia-monitor insignia-monitor--suave';
      nodo.textContent = String(valor);
      contenedor.append(nodo);
    }
  }

  function sincronizarCampoEditable(fila, entrada) {
    const campo = fila.querySelector('[name="valor"]');

    if (!(campo instanceof HTMLInputElement) &&
        !(campo instanceof HTMLTextAreaElement) &&
        !(campo instanceof HTMLSelectElement)) {
      return;
    }

    if (entrada.esSecreto) {
      campo.value = '';
      return;
    }

    campo.value = String(entrada.valorBruto ?? '');
  }

  function buscarFilaPorClave(clave) {
    return (
      Array.from(raiz.querySelectorAll('[data-configuracion-fila]')).find(
        function (fila) {
          return fila.dataset.configuracionClave === clave;
        }
      ) || null
    );
  }

  function marcarFilaActualizada(fila) {
    fila.classList.add('fila-configuracion--actualizada');
    window.setTimeout(function () {
      fila.classList.remove('fila-configuracion--actualizada');
    }, 1400);
  }

  function mostrarFeedback(tipo, mensaje) {
    if (!contenedorFeedback) {
      return;
    }

    const esError = tipo === 'error';
    contenedorFeedback.innerHTML = `
      <div class="${esError ? 'mensaje-error' : 'mensaje-exito'} configuracion-portal__flash">
        <i class="bi bi-${esError ? 'exclamation-triangle' : 'check-circle'}" aria-hidden="true"></i>
        <div>
          <strong>${esError ? 'No se pudo completar la operación' : 'Operación completada'}</strong>
          <p>${escapeHtml(mensaje)}</p>
        </div>
      </div>
    `;
  }

  function escapeHtml(valor) {
    return String(valor ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
})();
