(function () {
  'use strict';

  const raiz = document.querySelector('[data-alertas-remotas-shell]');
  if (!raiz) return;
  const modal = document.querySelector('[data-alerta-remota-modal]');
  const formulario = document.querySelector('[data-alerta-remota-form]');
  const proyeccion = formulario?.querySelector('[data-alerta-remota-proyeccion]');
  const identidad = formulario?.querySelector('[data-alerta-remota-identidad]');
  const monitor = formulario?.querySelector('[data-alerta-remota-monitor]');
  const motivo = formulario?.querySelector('[data-alerta-remota-motivo]');
  const hasta = formulario?.querySelector('[data-alerta-remota-hasta]');

  raiz.addEventListener('click', async (evento) => {
    const objetivo = evento.target instanceof Element ? evento.target : null;
    const descartar = objetivo?.closest('[data-alerta-remota-descartar]');
    const revertir = objetivo?.closest('[data-alerta-remota-revertir]');
    if (descartar) {
      proyeccion.value = descartar.dataset.proyeccionId || '';
      identidad.value = descartar.dataset.alertaId || '';
      monitor.textContent = descartar.dataset.monitorNombre || 'el monitor remoto';
      motivo.value = '';
      hasta.value = '';
      window.bootstrap?.Modal?.getOrCreateInstance(modal)?.show();
      return;
    }
    if (!revertir) return;
    revertir.disabled = true;
    try {
      await enviar(revertir.dataset.proyeccionId, revertir.dataset.alertaId, 'revertir', {});
      location.reload();
    } catch (error) {
      avisarError(error.message);
      revertir.disabled = false;
    }
  });

  formulario?.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const boton = formulario.querySelector('button[type="submit"]');
    boton.disabled = true;
    try {
      await enviar(proyeccion.value, identidad.value, 'descartar', {
        motivo: motivo.value.trim(),
        hastaUtc: hasta.value ? new Date(hasta.value).toISOString() : null
      });
      location.reload();
    } catch (error) {
      avisarError(error.message);
      boton.disabled = false;
    }
  });

  async function enviar(proyeccionId, alertaId, accion, cuerpo) {
    const url = `/panel/api/alertas-remotas/${encodeURIComponent(proyeccionId)}/${encodeURIComponent(alertaId)}/${accion}`;
    const respuesta = await fetch(url, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo)
    });
    const payload = await respuesta.json().catch(() => ({}));
    if (!respuesta.ok) throw new Error(payload.mensaje || 'No se pudo actualizar el descarte personal.');
  }

  function avisarError(mensaje) {
    window.portalToast?.show?.({
      tipo: 'error', titulo: 'Alerta remota no actualizada', cuerpo: mensaje
    });
  }
}());
