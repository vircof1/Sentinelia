(function () {
  configurarModal(false);
  configurarModal(true);

  function configurarModal(esRegistro) {
    const modal = document.querySelector(esRegistro
      ? '[data-dns-registro-modal-eliminar]' : '[data-dns-modal-eliminar]');
    if (!modal) return;

    const titulo = modal.querySelector('[data-dns-eliminar-titulo]');
    const carga = modal.querySelector('[data-dns-eliminar-carga]');
    const errorNodo = modal.querySelector('[data-dns-eliminar-error]');
    const contenido = modal.querySelector('[data-dns-eliminar-contenido]');
    const identidad = modal.querySelector('[data-dns-eliminar-identidad]');
    const publicacion = modal.querySelector('[data-dns-eliminar-publicacion]');
    const sistema = modal.querySelector('[data-dns-eliminar-sistema]');
    const enCurso = modal.querySelector('[data-dns-eliminar-en-curso]');
    const enCursoTexto = modal.querySelector('[data-dns-eliminar-en-curso-texto]');
    const formulario = modal.querySelector('[data-dns-eliminar-formulario]');
    const idInput = modal.querySelector('[data-dns-eliminar-id]');
    const retornoInput = modal.querySelector('[data-dns-eliminar-retorno]');
    const confirmar = modal.querySelector('[data-dns-eliminar-confirmar]');
    const formatoCantidad = new Intl.NumberFormat('es-ES');
    const campos = [
      'concesionesDdns', 'accionesDns',
      'ejecucionesPendientes', 'ejecucionesEnCurso'
    ];
    if (!esRegistro) campos.push('registros');
    const textoConfirmar = esRegistro ? 'Eliminar registro' : 'Eliminar zona y registros';
    let solicitudActual = 0;
    let botonOrigen = null;
    let controladorSolicitud = null;

    document.addEventListener('click', async function (evento) {
      const boton = evento.target.closest?.(esRegistro
        ? '[data-dns-eliminar-registro]' : '[data-dns-eliminar-zona]');
      if (!boton || !window.bootstrap?.Modal) return;
      const id = esRegistro ? boton.dataset.dnsEliminarRegistro : boton.dataset.dnsEliminarZona;
      if (!/^[1-9]\d*$/.test(id || '')) return;
      const zonaId = boton.dataset.dnsEliminarZonaId;
      if (esRegistro && (!/^[1-9]\d*$/.test(zonaId || '') || zonaId !== modal.dataset.dnsZonaId)) return;

      // En móvil el portal mueve el menú fuera de la tabla para evitar recortes.
      // El engranaje sigue en su fila, por eso conservamos su referencia explícita.
      const toggle = document.getElementById(boton.dataset.dnsEliminarToggle || '') ||
        boton.closest('.dropdown')?.querySelector('[data-bs-toggle="dropdown"]');
      botonOrigen = toggle || boton;
      if (toggle && window.bootstrap?.Dropdown) {
        window.bootstrap.Dropdown.getOrCreateInstance(toggle).hide();
      }

      const solicitud = ++solicitudActual;
      controladorSolicitud?.abort();
      controladorSolicitud = new AbortController();
      titulo.textContent = esRegistro ? 'Eliminar registro DNS' : 'Eliminar zona DNS';
      carga.textContent = 'Calculando el impacto…';
      carga.hidden = false;
      errorNodo.hidden = true;
      contenido.hidden = true;
      confirmar.disabled = true;
      confirmar.querySelector('span').textContent = textoConfirmar;
      idInput.value = '';
      retornoInput.value = boton.dataset.dnsEliminarRetorno || (esRegistro ? `/dns/${zonaId}` : '/dns');
      window.bootstrap.Modal.getOrCreateInstance(modal).show();

      try {
        const ruta = esRegistro
          ? `/dns/${encodeURIComponent(zonaId)}/registros/${encodeURIComponent(id)}/impacto-eliminacion`
          : `/dns/${encodeURIComponent(id)}/impacto-eliminacion`;
        const respuesta = await fetch(ruta, {
          headers: { accept: 'application/json', 'x-requested-with': 'XMLHttpRequest' },
          signal: controladorSolicitud.signal,
          cache: 'no-store'
        });
        if (solicitud !== solicitudActual) return;
        if (respuesta.redirected) {
          window.location.assign(respuesta.url);
          return;
        }
        const datos = await respuesta.json();
        if (!respuesta.ok || datos.ok !== true) {
          throw new Error(datos.mensaje || 'No se pudo calcular el impacto.');
        }
        if (solicitud !== solicitudActual) return;
        const impacto = datos.impacto;
        if (String(impacto?.id || '') !== id || !impacto.nombre || campos.some(
          (campo) => !Number.isSafeInteger(impacto[campo]) || impacto[campo] < 0
        ) || (esRegistro && (String(impacto.zonaId) !== zonaId || !impacto.tipo ||
          typeof impacto.esSistema !== 'boolean' || typeof impacto.afectaPublicacion !== 'boolean'))) {
          throw new Error('La revisión del impacto está incompleta.');
        }

        titulo.textContent = `Eliminar «${impacto.nombre}»`;
        identidad.textContent = esRegistro
          ? `${impacto.nombre} · ${impacto.tipo} · registro #${impacto.id}`
          : `${impacto.nombre} · zona #${impacto.id}`;
        for (const nodo of modal.querySelectorAll('[data-dns-eliminar-cantidad]')) {
          nodo.textContent = formatoCantidad.format(
            impacto[nodo.dataset.dnsEliminarCantidad]
          );
        }
        publicacion.hidden = !(esRegistro ? impacto.afectaPublicacion : impacto.publicadaEnBind);
        if (sistema) sistema.hidden = !impacto.esSistema;
        enCurso.hidden = impacto.ejecucionesEnCurso === 0;
        if (impacto.ejecucionesEnCurso > 0) {
          enCursoTexto.textContent =
            `${formatoCantidad.format(impacto.ejecucionesEnCurso)} ejecuciones DNS ya iniciadas no se cancelarán. Podrían terminar antes del borrado o fallar al perder su objetivo.`;
        }
        idInput.value = id;
        carga.hidden = true;
        contenido.hidden = false;
        confirmar.disabled = false;
      } catch (error) {
        if (solicitud !== solicitudActual) return;
        carga.hidden = true;
        errorNodo.textContent = error.message || 'No se pudo calcular el impacto.';
        errorNodo.hidden = false;
      }
    });

    formulario.addEventListener('submit', function (evento) {
      if (!idInput.value || confirmar.disabled) {
        evento.preventDefault();
        return;
      }
      confirmar.disabled = true;
      confirmar.querySelector('span').textContent = 'Eliminando…';
    });

    modal.addEventListener('hidden.bs.modal', function () {
      solicitudActual += 1;
      controladorSolicitud?.abort();
      idInput.value = '';
      retornoInput.value = '';
      confirmar.disabled = true;
      confirmar.querySelector('span').textContent = textoConfirmar;
      if (botonOrigen?.isConnected) botonOrigen.focus();
      botonOrigen = null;
    });
  }
})();
