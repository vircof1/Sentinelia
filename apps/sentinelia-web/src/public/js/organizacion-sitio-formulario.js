document.addEventListener('DOMContentLoaded', function () {
  const formulario = document.querySelector('[data-sitio-formulario]');

  if (!formulario) return;

  const modoEdicion = formulario.dataset.modo === 'editar';
  const hayError = formulario.dataset.hayError === '1';
  const descripcion = formulario.querySelector('#sitio_descripcion');
  const contadorDescripcion = formulario.querySelector(
    '[data-sitio-descripcion-contador]'
  );
  const selectorEstado = formulario.querySelector('#sitio_estado');
  const avisoInactivo = formulario.querySelector('[data-sitio-aviso-inactivo]');
  const avisoCambioEmpresa = formulario.querySelector(
    '[data-sitio-aviso-cambio-empresa]'
  );
  const inputEmpresaId = formulario.querySelector(
    '[data-organizacion-sitio-empresa-id]'
  );
  const empresaInicialId = String(
    formulario.dataset.organizacionEmpresaActualId || inputEmpresaId?.value || ''
  );
  const botonGuardar = formulario.querySelector('[data-sitio-guardar]');
  const botonCancelar = formulario.querySelector('[data-sitio-cancelar]');
  const textoCancelar = formulario.querySelector('[data-sitio-cancelar-texto]');
  const cambiosPendientes = formulario.querySelector(
    '[data-sitio-cambios-pendientes]'
  );
  const urlRestaurar = String(formulario.dataset.urlRestaurar || '');
  const estadoInicial = serializarFormulario();
  let enviando = false;
  let salidaConfirmada = false;

  sincronizarInterfaz();
  formulario.addEventListener('input', sincronizarInterfaz);
  formulario.addEventListener('change', sincronizarInterfaz);
  formulario.addEventListener('organizacion:empresa-sincronizada', sincronizarInterfaz);
  formulario.addEventListener('reset', function () {
    window.setTimeout(sincronizarInterfaz, 0);
  });
  formulario.addEventListener('submit', function (evento) {
    if (evento.defaultPrevented || enviando) {
      evento.preventDefault();
      return;
    }

    enviando = true;
    if (botonGuardar) {
      botonGuardar.disabled = true;
      botonGuardar.setAttribute('aria-busy', 'true');
      const texto = botonGuardar.querySelector('span');
      if (texto) texto.textContent = modoEdicion ? 'Guardando…' : 'Creando sitio…';
    }
  });

  botonCancelar?.addEventListener('click', function (evento) {
    if (modoEdicion && botonCancelar.getAttribute('aria-disabled') === 'true') {
      evento.preventDefault();
      return;
    }
    if (hayCambiosSinGuardar() && !window.confirm(
      modoEdicion
        ? 'Se descartarán los cambios realizados. ¿Quieres continuar?'
        : 'Se perderán los cambios sin guardar. ¿Quieres salir?'
    )) {
      evento.preventDefault();
      return;
    }
    if (modoEdicion && hayError && urlRestaurar) {
      evento.preventDefault();
      salidaConfirmada = true;
      window.location.assign(urlRestaurar);
      return;
    }
    if (!modoEdicion) salidaConfirmada = true;
  });

  window.addEventListener('beforeunload', function (evento) {
    if (enviando || salidaConfirmada || !hayCambiosSinGuardar()) return;
    evento.preventDefault();
    evento.returnValue = '';
  });

  function sincronizarInterfaz() {
    if (contadorDescripcion && descripcion) {
      contadorDescripcion.textContent = `${descripcion.value.length}/255`;
    }
    if (avisoInactivo && selectorEstado) {
      avisoInactivo.hidden = selectorEstado.value !== 'inactivo';
    }
    if (avisoCambioEmpresa && inputEmpresaId) {
      const empresaActualId = String(inputEmpresaId.value || '');
      avisoCambioEmpresa.hidden = !empresaActualId || empresaActualId === empresaInicialId;
    }
    if (!modoEdicion) return;

    const hayCambios = hayCambiosSinGuardar();
    const accionesDisponibles = hayCambios || hayError;
    if (botonGuardar) botonGuardar.disabled = !accionesDisponibles;
    if (botonCancelar) {
      botonCancelar.disabled = !accionesDisponibles;
      botonCancelar.setAttribute('aria-disabled', accionesDisponibles ? 'false' : 'true');
    }
    if (textoCancelar) {
      textoCancelar.textContent = accionesDisponibles ? 'Descartar cambios' : 'Cancelar';
    }
    if (cambiosPendientes) cambiosPendientes.hidden = !hayCambios;
  }

  function hayCambiosSinGuardar() {
    return serializarFormulario() !== estadoInicial;
  }

  function serializarFormulario() {
    return JSON.stringify(Array.from(formulario.elements)
      .filter((control) => control.name && !control.disabled)
      .map((control) => [control.name, control.value]));
  }
});
