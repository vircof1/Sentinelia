document.addEventListener('DOMContentLoaded', () => {
  const boton = document.getElementById('confirmar-email-perfil');
  const resultado = document.getElementById('resultado-confirmacion-email');
  if (!boton || !resultado) return;

  const etiqueta = boton.querySelector('[data-etiqueta-confirmacion]');
  const cuentaAtras = boton.querySelector('[data-cuenta-atras]');
  const etiquetaAccion = String(boton.dataset.etiquetaAccion || '').trim();
  const expiraEnMs = Date.parse(String(boton.dataset.expiraEn || ''));
  let expirado = false;
  let peticionEnCurso = false;
  let intervaloCuentaAtras = null;

  const actualizarCuentaAtras = () => {
    if (!Number.isFinite(expiraEnMs)) return;
    const milisegundosRestantes = expiraEnMs - Date.now();
    if (milisegundosRestantes <= 0) {
      expirado = true;
      boton.disabled = true;
      boton.removeAttribute('aria-label');
      if (etiqueta) etiqueta.textContent = 'Enlace caducado';
      if (cuentaAtras) cuentaAtras.textContent = '';
      resultado.className = 'alert alert-warning mt-3';
      resultado.textContent =
        'El enlace ha caducado. Solicita uno nuevo desde Mi perfil.';
      if (intervaloCuentaAtras !== null) {
        window.clearInterval(intervaloCuentaAtras);
        intervaloCuentaAtras = null;
      }
      return;
    }

    const totalSegundos = Math.ceil(milisegundosRestantes / 1000);
    const minutos = Math.floor(totalSegundos / 60);
    const segundos = totalSegundos % 60;
    const tiempoCompacto =
      `${String(minutos).padStart(2, '0')}:` +
      String(segundos).padStart(2, '0');
    if (cuentaAtras) cuentaAtras.textContent = `(caduca en ${tiempoCompacto})`;
    boton.setAttribute(
      'aria-label',
      `${etiquetaAccion}. Caduca en ${minutos} ${
        minutos === 1 ? 'minuto' : 'minutos'
      } y ${segundos} ${segundos === 1 ? 'segundo' : 'segundos'}.`
    );
  };

  actualizarCuentaAtras();
  if (!expirado && Number.isFinite(expiraEnMs)) {
    intervaloCuentaAtras = window.setInterval(actualizarCuentaAtras, 1000);
  }

  boton.addEventListener('click', async () => {
    if (expirado || peticionEnCurso) return;
    peticionEnCurso = true;
    boton.disabled = true;
    resultado.className = 'mt-3 text-body-secondary';
    resultado.textContent = boton.dataset.mensajeProgreso ||
      'Procesando la verificación…';
    try {
      const tokenCsrf = String(
        document.querySelector('meta[name="csrf-token"]')?.content || ''
      ).trim();
      const respuesta = await fetch('/mi-perfil/email/confirmar', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          'X-CSRF-Token': tokenCsrf
        },
        body: '{}'
      });
      const payload = await respuesta.json();
      if (!respuesta.ok || !payload.ok) {
        throw new Error(
          payload.mensaje || 'No se ha podido completar la verificación.'
        );
      }
      resultado.className = 'alert alert-success mt-3';
      resultado.textContent = payload.mensaje;
      if (intervaloCuentaAtras !== null) {
        window.clearInterval(intervaloCuentaAtras);
        intervaloCuentaAtras = null;
      }
      window.setTimeout(() => window.location.assign('/mi-perfil'), 700);
    } catch (error) {
      resultado.className = 'alert alert-danger mt-3';
      resultado.textContent = error.message;
      peticionEnCurso = false;
      boton.disabled = expirado;
    }
  });
});
