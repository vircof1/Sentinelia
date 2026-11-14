(function () {
  document.querySelectorAll('[data-reinicio-password-administrativo]')
    .forEach(inicializarReinicioPasswordAdministrativo);
})();

function inicializarReinicioPasswordAdministrativo(modulo) {
  const modalNodo = modulo.querySelector('[data-reinicio-password-modal]');
  const formulario = modulo.querySelector('[data-reinicio-password-formulario]');
  const botonAbrir = modulo.querySelector('[data-reinicio-password-abrir]');
  const botonConfirmar = modulo.querySelector('[data-reinicio-password-confirmar]');
  const errorNodo = modulo.querySelector('[data-reinicio-password-error]');
  const estadoNodo = modulo.querySelector('[data-reinicio-password-estado]');
  const avisoEmailSinGuardar = modulo.querySelector('[data-reinicio-email-sin-guardar]');
  const emailFormulario = document.querySelector('[data-usuario-formulario-submit] [name="email"]');
  const emailGuardado = String(modulo.dataset.emailGuardado || '').trim();
  const camposPassword = Array.from(
    modulo.querySelectorAll('[data-reinicio-password-campo]')
  );
  const viaEsperada = modulo.dataset.viaEsperada;
  let reinicioId = null;

  if (!modalNodo || !formulario || !botonAbrir ||
      !['correo', 'manual'].includes(viaEsperada)) return;

  const limpiarCampos = function () {
    camposPassword.forEach(function (campo) {
      campo.value = '';
      campo.classList.remove('is-invalid');
      campo.removeAttribute('aria-invalid');
    });
    limpiarError();
  };

  const limpiarError = function () {
    if (errorNodo) {
      errorNodo.textContent = '';
      errorNodo.hidden = true;
    }
  };

  const extinguirIntencion = function () {
    reinicioId = null;
    limpiarCampos();
  };

  botonAbrir.addEventListener('click', function () {
    extinguirIntencion();
    reinicioId = generarUuidV7Cliente();
    if (avisoEmailSinGuardar && emailFormulario) {
      avisoEmailSinGuardar.hidden = emailFormulario.value.trim() === emailGuardado;
    }
  });

  modalNodo.addEventListener('hidden.bs.modal', extinguirIntencion);

  formulario.addEventListener('submit', async function (evento) {
    evento.preventDefault();
    if (!reinicioId) reinicioId = generarUuidV7Cliente();
    limpiarError();
    camposPassword.forEach(function (campo) {
      campo.classList.remove('is-invalid');
      campo.removeAttribute('aria-invalid');
    });

    const payload = {
      reinicio_id: reinicioId,
      via_esperada: viaEsperada
    };
    if (viaEsperada === 'manual') {
      const password = camposPassword[0]?.value || '';
      const confirmacion = camposPassword[1]?.value || '';
      if (!password || password !== confirmacion) {
        camposPassword.forEach(function (campo) {
          campo.classList.add('is-invalid');
          campo.setAttribute('aria-invalid', 'true');
        });
        mostrarError('Las contraseñas provisionales deben existir y coincidir.');
        return;
      }
      payload.password = password;
      payload.password_confirmacion = confirmacion;
    }

    botonConfirmar.disabled = true;
    if (estadoNodo) estadoNodo.textContent = 'Reinicio en curso.';
    try {
      const respuesta = await fetch(modulo.dataset.urlComando, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload)
      });
      const datos = await respuesta.json().catch(function () { return {}; });
      if (!respuesta.ok) {
        const error = new Error(datos.mensaje || 'No se pudo completar el reinicio.');
        error.recargar = datos.recargar === true;
        throw error;
      }
      camposPassword.forEach(function (campo) { campo.value = ''; });
      window.portalToast?.show?.({
        tipo: 'exito', titulo: 'Contraseña reiniciada', cuerpo: datos.mensaje
      });
      reinicioId = null;
      window.bootstrap?.Modal.getOrCreateInstance(modalNodo)?.hide();
    } catch (error) {
      mostrarError(error.message);
      if (error.recargar) {
        reinicioId = null;
        botonConfirmar.textContent = 'Recargar para continuar';
        botonConfirmar.addEventListener('click', function recargar(eventoRecarga) {
          eventoRecarga.preventDefault();
          window.location.reload();
        }, { once: true });
      }
    } finally {
      payload.password = null;
      payload.password_confirmacion = null;
      camposPassword.forEach(function (campo) { campo.value = ''; });
      botonConfirmar.disabled = false;
      if (estadoNodo) estadoNodo.textContent = '';
    }
  });

  function mostrarError(mensaje) {
    if (!errorNodo) return;
    errorNodo.textContent = mensaje;
    errorNodo.hidden = false;
    errorNodo.focus?.();
  }
}

function generarUuidV7Cliente() {
  if (typeof window.crypto?.getRandomValues !== 'function') {
    throw new Error('El navegador no dispone de un generador criptográfico seguro.');
  }
  const bytes = new Uint8Array(16);
  window.crypto.getRandomValues(bytes);
  const ahoraMs = Date.now();
  bytes[0] = Math.floor(ahoraMs / 0x10000000000) & 0xff;
  bytes[1] = Math.floor(ahoraMs / 0x100000000) & 0xff;
  bytes[2] = Math.floor(ahoraMs / 0x1000000) & 0xff;
  bytes[3] = Math.floor(ahoraMs / 0x10000) & 0xff;
  bytes[4] = Math.floor(ahoraMs / 0x100) & 0xff;
  bytes[5] = ahoraMs & 0xff;
  bytes[6] = 0x70 | (bytes[6] & 0x0f);
  bytes[8] = 0x80 | (bytes[8] & 0x3f);
  const hexadecimal = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, '0')).join('');
  return [
    hexadecimal.slice(0, 8),
    hexadecimal.slice(8, 12),
    hexadecimal.slice(12, 16),
    hexadecimal.slice(16, 20),
    hexadecimal.slice(20)
  ].join('-');
}
