document.addEventListener('DOMContentLoaded', function () {
  const formulario = document.querySelector('[data-empresa-formulario]');

  if (!formulario) {
    return;
  }

  const modoEdicion = formulario.dataset.modo === 'editar';
  const hayError = formulario.dataset.hayError === '1';
  const descripcion = formulario.querySelector('#empresa_descripcion');
  const contadorDescripcion = formulario.querySelector(
    '[data-empresa-descripcion-contador]'
  );
  const selectorEstado = formulario.querySelector('#empresa_estado');
  const avisoInactiva = formulario.querySelector('[data-empresa-aviso-inactiva]');
  const avisoCambioTenant = formulario.querySelector(
    '[data-empresa-aviso-cambio-tenant]'
  );
  const inputTenantId = formulario.querySelector('[data-organizacion-tenant-id]');
  const botonGuardar = formulario.querySelector('[data-empresa-guardar]');
  const enlaceCancelar = formulario.querySelector('[data-empresa-cancelar]');
  const textoCancelar = formulario.querySelector('[data-empresa-cancelar-texto]');
  const cambiosPendientes = formulario.querySelector(
    '[data-empresa-cambios-pendientes]'
  );
  const tenantInicialId = String(
    formulario.dataset.organizacionTenantActualId || inputTenantId?.value || ''
  );
  const urlRestaurar = String(formulario.dataset.urlRestaurar || '');
  const estadoInicial = serializarFormulario();
  let enviando = false;
  let salidaConfirmada = false;

  sincronizarInterfaz();

  formulario.addEventListener('input', sincronizarInterfaz);
  formulario.addEventListener('change', sincronizarInterfaz);
  formulario.addEventListener('organizacion:tenant-sincronizado', sincronizarInterfaz);
  formulario.addEventListener('reset', function () {
    window.setTimeout(sincronizarInterfaz, 0);
  });
  formulario.addEventListener('submit', function (evento) {
    if (evento.defaultPrevented) {
      return;
    }

    if (enviando) {
      evento.preventDefault();
      return;
    }

    enviando = true;
    if (botonGuardar) {
      botonGuardar.disabled = true;
      botonGuardar.setAttribute('aria-busy', 'true');
      const texto = botonGuardar.querySelector('span');
      if (texto) {
        texto.textContent = modoEdicion ? 'Guardando…' : 'Creando empresa…';
      }
    }
  });

  enlaceCancelar?.addEventListener('click', function (evento) {
    if (
      modoEdicion &&
      enlaceCancelar.getAttribute('aria-disabled') === 'true'
    ) {
      evento.preventDefault();
      return;
    }

    if (
      hayCambiosSinGuardar() &&
      !window.confirm(
        modoEdicion
          ? 'Se descartarán los cambios realizados. ¿Quieres continuar?'
          : 'Se perderán los cambios sin guardar. ¿Quieres salir?'
      )
    ) {
      evento.preventDefault();
      return;
    }

    if (modoEdicion && hayError && urlRestaurar) {
      evento.preventDefault();
      salidaConfirmada = true;
      window.location.assign(urlRestaurar);
      return;
    }

    if (!modoEdicion) {
      salidaConfirmada = true;
    }
  });

  window.addEventListener('beforeunload', function (evento) {
    if (enviando || salidaConfirmada || !hayCambiosSinGuardar()) {
      return;
    }

    evento.preventDefault();
    evento.returnValue = '';
  });

  function sincronizarInterfaz() {
    actualizarContador();
    actualizarAdvertenciaEstado();
    actualizarAdvertenciaTenant();
    actualizarAcciones();
  }

  function actualizarContador() {
    if (!contadorDescripcion || !descripcion) {
      return;
    }

    contadorDescripcion.textContent = `${descripcion.value.length}/255`;
  }

  function actualizarAdvertenciaEstado() {
    if (avisoInactiva && selectorEstado) {
      avisoInactiva.hidden = selectorEstado.value !== 'inactivo';
    }
  }

  function actualizarAdvertenciaTenant() {
    if (!avisoCambioTenant || !inputTenantId) {
      return;
    }

    const tenantActualId = String(inputTenantId.value || '');
    avisoCambioTenant.hidden =
      !tenantActualId || tenantActualId === tenantInicialId;
  }

  function actualizarAcciones() {
    if (!modoEdicion) {
      return;
    }

    const hayCambios = hayCambiosSinGuardar();
    const accionesDisponibles = hayCambios || hayError;

    if (botonGuardar) {
      botonGuardar.disabled = !accionesDisponibles;
    }

    if (enlaceCancelar) {
      enlaceCancelar.disabled = !accionesDisponibles;
      enlaceCancelar.setAttribute(
        'aria-disabled',
        accionesDisponibles ? 'false' : 'true'
      );
    }

    if (textoCancelar) {
      textoCancelar.textContent = accionesDisponibles
        ? 'Descartar cambios'
        : 'Cancelar';
    }

    if (cambiosPendientes) {
      cambiosPendientes.hidden = !hayCambios;
    }
  }

  function hayCambiosSinGuardar() {
    return serializarFormulario() !== estadoInicial;
  }

  function serializarFormulario() {
    return JSON.stringify(
      Array.from(formulario.elements)
        .filter((control) => control.name && !control.disabled)
        .map((control) => [control.name, control.value])
    );
  }
});
