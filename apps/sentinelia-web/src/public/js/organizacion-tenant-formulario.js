(function () {
  const formulario = document.querySelector('[data-tenant-formulario]');

  if (!formulario) {
    return;
  }

  const modoEdicion = formulario.dataset.modo === 'editar';
  const hayError = formulario.dataset.hayError === '1';
  const selectorEstado = formulario.querySelector('#tenant_estado');
  const descripcion = formulario.querySelector('#tenant_descripcion');
  const contadorDescripcion = formulario.querySelector(
    '[data-tenant-descripcion-contador]'
  );
  const avisoInactivo = formulario.querySelector('[data-tenant-aviso-inactivo]');
  const botonGuardar = formulario.querySelector('[data-tenant-guardar]');
  const enlaceCancelar = formulario.querySelector('[data-tenant-cancelar]');
  const textoCancelar = formulario.querySelector('[data-tenant-cancelar-texto]');
  const cambiosPendientes = formulario.querySelector(
    '[data-tenant-cambios-pendientes]'
  );
  const estadoInicial = serializarFormulario();
  let enviando = false;
  let salidaConfirmada = false;

  sincronizarInterfaz();

  formulario.addEventListener('input', sincronizarInterfaz);
  formulario.addEventListener('change', sincronizarInterfaz);
  formulario.addEventListener('submit', function (evento) {
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
        texto.textContent = modoEdicion ? 'Guardando…' : 'Creando tenant…';
      }
    }
  });
  enlaceCancelar?.addEventListener('click', function (evento) {
    if (hayCambiosSinGuardar() && !window.confirm('Se perderán los cambios sin guardar. ¿Quieres salir?')) {
      evento.preventDefault();
      return;
    }

    salidaConfirmada = true;
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
    actualizarAcciones();
  }

  function actualizarContador() {
    if (!contadorDescripcion || !descripcion) {
      return;
    }

    contadorDescripcion.textContent = `${descripcion.value.length}/255`;
  }

  function actualizarAdvertenciaEstado() {
    if (!avisoInactivo || !selectorEstado) {
      return;
    }

    avisoInactivo.hidden = selectorEstado.value !== 'inactivo';
  }

  function actualizarAcciones() {
    if (!modoEdicion) {
      return;
    }

    const hayCambios = serializarFormulario() !== estadoInicial;
    const accionesDisponibles = hayCambios || hayError;

    if (botonGuardar) {
      botonGuardar.disabled = !accionesDisponibles;
    }

    if (textoCancelar) {
      textoCancelar.textContent = hayCambios
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
})();
