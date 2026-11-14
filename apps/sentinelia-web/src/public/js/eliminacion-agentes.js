(function () {
  for (const seguimiento of document.querySelectorAll('[data-operacion-eliminacion]')) {
    inicializarSeguimiento(seguimiento);
  }
})();

function inicializarSeguimiento(raiz) {
  const url = String(raiz.dataset.urlOperacion || '');
  const tipoSujeto = String(raiz.dataset.tipoSujeto || 'agente');
  const resumen = raiz.querySelector('[data-operacion-resumen]');
  const titulo = raiz.querySelector('[data-operacion-titulo]');
  const aviso = raiz.querySelector('[data-operacion-aviso]');
  const estadoNodo = raiz.querySelector('[data-operacion-estado]');
  const panelEstado = raiz.querySelector('[data-operacion-panel-estado]');
  const iconoEstado = raiz.querySelector('[data-operacion-icono-estado]');
  const actualizada = raiz.querySelector('[data-operacion-actualizada]');
  const intentos = raiz.querySelector('[data-operacion-intentos]');
  const maxIntentos = raiz.querySelector('[data-operacion-max-intentos]');
  const limpiezaNodo = raiz.querySelector('[data-operacion-limpieza]');
  const limpiezaAyuda = raiz.querySelector('[data-operacion-limpieza-ayuda]');
  const finalizada = raiz.querySelector('[data-operacion-finalizada]');
  const errorNodo = raiz.querySelector('[data-operacion-error]');
  const seguimientoEstado = raiz.querySelector('[data-operacion-seguimiento-estado]');
  const actualizar = raiz.querySelector('[data-operacion-actualizar]');
  const fases = Array.from(raiz.querySelectorAll('[data-fase]'));
  let temporizador = null;
  let detenida = false;
  let cargando = false;

  const consultar = async function ({ forzar = false } = {}) {
    if ((!forzar && detenida) || cargando || !url) return;
    cargando = true;
    if (actualizar) actualizar.disabled = true;
    try {
      const respuesta = await fetch(url, {
        headers: { Accept: 'application/json', 'X-Silenciar-Toast-Error': '1' }
      });
      if (respuesta.status === 404) {
        detenida = true;
        if (titulo) titulo.textContent = 'Seguimiento no disponible';
        if (aviso) {
          aviso.classList.remove('alert-info', 'alert-success', 'alert-danger');
          aviso.classList.add('alert-warning');
        }
        resumen.textContent = 'Esta operación ya no está disponible dentro de tu alcance actual.';
        presentarEstado('no_disponible', panelEstado, estadoNodo, iconoEstado);
        return;
      }
      if (!respuesta.ok) throw new Error('No se pudo recuperar la operación.');
      const payload = await respuesta.json();
      renderizar(payload.operacion || {});
    } catch (_error) {
      resumen.textContent = 'Seguimiento temporalmente no disponible. Se volverá a intentar.';
    } finally {
      cargando = false;
      if (actualizar) actualizar.disabled = false;
      if (!detenida) temporizador = window.setTimeout(() => consultar(), 3000);
    }
  };

  const renderizar = function (operacion) {
    const limpieza = operacion.limpiezaPostcommit || null;
    const etiquetaSujeto = tipoSujeto === 'agente' ? 'El agente' : 'La organización';
    const descripciones = {
      encolada: 'La eliminación está encolada y aún no ha comenzado.',
      ejecutando: `La eliminación está ejecutando la fase ${etiqueta(operacion.fase)}.`,
      completada: `${etiquetaSujeto} y su agregado propio se han eliminado.`,
      completada_con_advertencias:
        `${etiquetaSujeto} se ha eliminado; revisa el estado de su limpieza técnica.`,
      fallida: `La operación terminó sin eliminar ${tipoSujeto === 'agente' ? 'el agente' : 'la organización'}.`
    };
    resumen.textContent = resumenOperacion(operacion, limpieza, descripciones);
    const estadoVisual = operacion.estado === 'completada' && limpieza?.estado === 'bloqueada'
      ? 'completada_con_advertencias'
      : operacion.estado;
    if (titulo) {
      titulo.textContent = ({
        encolada: 'Eliminación en espera',
        ejecutando: 'Eliminación en curso',
        completada: 'Agente eliminado',
        completada_con_advertencias: 'Agente eliminado con avisos',
        fallida: 'No se pudo eliminar el agente'
      })[estadoVisual] || 'Estado de la eliminación';
    }
    if (aviso) {
      aviso.classList.remove('alert-info', 'alert-success', 'alert-warning', 'alert-danger');
      aviso.classList.add(({
        encolada: 'alert-info',
        ejecutando: 'alert-info',
        completada: 'alert-success',
        completada_con_advertencias: 'alert-warning',
        fallida: 'alert-danger'
      })[estadoVisual] || 'alert-info');
    }
    presentarEstado(estadoVisual, panelEstado, estadoNodo, iconoEstado);
    actualizarFecha(actualizada, operacion.actualizadaEnUtc, 'Sin fecha');
    actualizarFecha(finalizada, operacion.terminadaEnUtc, 'Todavía en curso');
    if (intentos) intentos.textContent = String(operacion.intentos || 0);
    if (maxIntentos) maxIntentos.textContent = String(operacion.maxIntentos || 0);
    if (limpiezaNodo) limpiezaNodo.textContent = describirLimpieza(limpieza);
    if (limpiezaAyuda) limpiezaAyuda.textContent = ayudaLimpieza(limpieza);
    const indiceActual = ['preparacion', 'validacion', 'eliminacion', 'commit', 'limpieza']
      .indexOf(operacion.fase);
    for (const [indice, nodo] of fases.entries()) {
      const completada = indice < indiceActual || ['completada', 'completada_con_advertencias'].includes(operacion.estado);
      const actual = indice === indiceActual && !operacion.terminal;
      const fallida = indice === indiceActual && operacion.estado === 'fallida';
      nodo.classList.toggle('operacion-fase--completada', completada);
      nodo.classList.toggle('operacion-fase--actual', indice === indiceActual && !operacion.terminal);
      nodo.classList.toggle('operacion-fase--fallida', fallida);
      if (actual) nodo.setAttribute('aria-current', 'step');
      else nodo.removeAttribute('aria-current');
      const icono = nodo.querySelector('.operacion-fase__marca i');
      if (icono) icono.className = `bi ${completada ? 'bi-check-lg' : (fallida ? 'bi-x-lg' : 'bi-circle-fill')}`;
    }
    if (errorNodo) {
      const hayError = Boolean(operacion.ultimoError);
      errorNodo.classList.toggle('d-none', !hayError);
      errorNodo.textContent = hayError
        ? operacion.ultimoError.mensaje
        : '';
    }
    presentarSeguimiento(operacion, limpieza, seguimientoEstado);
    if (operacion.terminal && limpieza?.estado !== 'pendiente') {
      detenida = true;
      if (temporizador) window.clearTimeout(temporizador);
    } else {
      detenida = false;
    }
  };

  const reanudar = function () {
    if (!detenida && document.visibilityState !== 'hidden') {
      if (temporizador) window.clearTimeout(temporizador);
      void consultar();
    }
  };
  window.addEventListener('focus', reanudar);
  document.addEventListener('visibilitychange', reanudar);
  actualizar?.addEventListener('click', function () {
    if (temporizador) window.clearTimeout(temporizador);
    void consultar({ forzar: true });
  });
  void consultar();
}

function presentarEstado(estado, panel, texto, icono) {
  const estados = {
    encolada: { etiqueta: 'En espera', tono: 'espera', icono: 'hourglass-split' },
    ejecutando: { etiqueta: 'En curso', tono: 'curso', icono: 'arrow-repeat' },
    completada: { etiqueta: 'Completada', tono: 'completada', icono: 'check-circle' },
    completada_con_advertencias: {
      etiqueta: 'Completada con avisos', tono: 'advertencia', icono: 'exclamation-triangle'
    },
    fallida: { etiqueta: 'Fallida', tono: 'fallida', icono: 'x-circle' },
    no_disponible: { etiqueta: 'No disponible', tono: 'advertencia', icono: 'eye-slash' }
  };
  const presentacion = estados[estado] || {
    etiqueta: etiqueta(estado), tono: 'espera', icono: 'hourglass-split'
  };
  if (texto) texto.textContent = presentacion.etiqueta;
  if (icono) icono.className = `bi bi-${presentacion.icono}`;
  if (panel) {
    for (const tono of ['espera', 'curso', 'completada', 'advertencia', 'fallida']) {
      panel.classList.toggle(`operacion-estado-principal--${tono}`, tono === presentacion.tono);
    }
  }
}

function presentarSeguimiento(operacion, limpieza, nodo) {
  if (!nodo) return;
  const icono = nodo.querySelector('i');
  const texto = nodo.querySelector('span');
  const continua = !operacion.terminal || limpieza?.estado === 'pendiente';
  nodo.classList.toggle('insignia-suave--neutra', !continua);
  if (icono) icono.className = `bi ${continua ? 'bi-broadcast' : 'bi-check2'}`;
  if (texto) texto.textContent = continua ? 'Actualización automática' : 'Ejecución finalizada';
}

function resumenOperacion(operacion, limpieza, descripciones) {
  if (operacion.estado !== 'completada') {
    return descripciones[operacion.estado] ||
      'Consultando el estado durable de la operación.';
  }
  if (limpieza?.estado === 'pendiente') {
    return 'La raíz se ha eliminado correctamente; continúa la limpieza técnica secundaria.';
  }
  if (limpieza?.estado === 'bloqueada') {
    return 'La raíz se ha eliminado correctamente; una limpieza técnica requiere atención.';
  }
  return descripciones.completada;
}

function describirLimpieza(limpieza) {
  if (!limpieza) return 'Pendiente de cálculo';
  const estados = {
    no_requerida: 'No requerida',
    pendiente: `${limpieza.completadas} de ${limpieza.total} tareas completadas`,
    convergida: `Completada (${limpieza.total} tareas)`,
    bloqueada: `${limpieza.bloqueadas} tareas requieren atención`
  };
  return estados[limpieza.estado] || etiqueta(limpieza.estado);
}

function ayudaLimpieza(limpieza) {
  if (!limpieza) return 'Se calculará después de confirmar la eliminación.';
  const ayudas = {
    no_requerida: 'La operación no generó tareas técnicas posteriores.',
    pendiente: `${limpieza.pendientes} tareas pendientes; el seguimiento continuará actualizándose.`,
    convergida: 'Todas las tareas posteriores han terminado.',
    bloqueada: 'Hay tareas que necesitan intervención técnica.'
  };
  return ayudas[limpieza.estado] || 'Trabajo posterior a la eliminación principal.';
}

function actualizarFecha(nodo, valor, vacio) {
  if (!nodo) return;
  if (!valor) {
    nodo.textContent = vacio;
    return;
  }
  const tiempo = document.createElement('time');
  tiempo.dataset.fechaUtc = String(valor);
  tiempo.textContent = String(valor);
  nodo.replaceChildren(tiempo);
  window.portalFechas?.hidratar?.();
}

function etiqueta(valor) {
  const texto = String(valor || 'sin estado').replaceAll('_', ' ');
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}
