(function () {
  const raiz = document.querySelector('[data-perfil-autogestion]');
  if (!raiz) return;

  const disponible = raiz.dataset.disponible === 'true';
  const botonAbrir = raiz.querySelector('[data-perfil-abrir-edicion]');
  const botonCerrar = raiz.querySelector('[data-perfil-cerrar-edicion]');
  const estadoIcono = raiz.querySelector('[data-perfil-estado-icono]');
  const estadoTitulo = raiz.querySelector('[data-perfil-estado-titulo]');
  const estadoTexto = raiz.querySelector('[data-perfil-estado-texto]');
  const vigencia = raiz.querySelector('[data-perfil-vigencia]');
  const vigenciaTexto = raiz.querySelector('[data-perfil-vigencia-texto]');
  const feedback = raiz.querySelector('[data-perfil-feedback]');
  const elementosEdicion = Array.from(
    raiz.querySelectorAll('[data-requiere-edicion]')
  );
  const elementosBloqueados = Array.from(
    raiz.querySelectorAll('[data-perfil-bloqueado]')
  );
  const formularios = Array.from(
    raiz.querySelectorAll('[data-perfil-formulario]')
  );
  const formularioDesbloqueo = document.querySelector(
    '[data-perfil-desbloquear]'
  );
  const feedbackModal = document.querySelector('[data-perfil-modal-feedback]');
  const botonValidarEmail = raiz.querySelector('[data-perfil-validar-email]');
  const botonReenviarEmail = raiz.querySelector('[data-perfil-reenviar-email]');
  const formularioPreferenciaAlertas = raiz.querySelector(
    '[data-perfil-preferencia-alertas]'
  );
  const campoPreferenciaAlertas = formularioPreferenciaAlertas?.elements?.mostrar;
  const estadoPreferenciaAlertas = formularioPreferenciaAlertas?.querySelector(
    '[data-perfil-preferencia-alertas-estado]'
  );
  const cambiosPreferenciaAlertas = formularioPreferenciaAlertas?.querySelector(
    '[data-perfil-preferencia-alertas-cambios]'
  );
  const botonGuardarPreferenciaAlertas = formularioPreferenciaAlertas?.querySelector(
    '[data-perfil-preferencia-alertas-guardar]'
  );
  const rutas = {
    nombre_visible: '/mi-perfil/nombre-visible',
    nombre_completo: '/mi-perfil/nombre-completo',
    preferencia_mostrar_alertas_remotas: '/mi-perfil/preferencia-alertas-remotas',
    email: '/mi-perfil/email',
    password: '/mi-perfil/password'
  };
  let autorizada = disponible && raiz.dataset.autorizada === 'true';
  let expiraEnMs = Date.parse(raiz.dataset.expiraEn || '');
  let peticionEnCurso = false;
  let temporizadorVigencia = null;

  sincronizarEstadoEdicion();
  sincronizarPreferenciaAlertasRemotas();
  iniciarTemporizadorVigencia();

  formularioDesbloqueo?.addEventListener('submit', desbloquearPerfil);
  botonCerrar?.addEventListener('click', cerrarEdicion);
  botonValidarEmail?.addEventListener('click', validarEmailActual);
  botonReenviarEmail?.addEventListener('click', reenviarEmail);
  campoPreferenciaAlertas?.addEventListener(
    'change',
    sincronizarPreferenciaAlertasRemotas
  );
  for (const formulario of formularios) {
    formulario.addEventListener('submit', guardarAtributo);
  }

  document
    .getElementById('modal-desbloquear-perfil')
    ?.addEventListener('shown.bs.modal', function () {
      formularioDesbloqueo?.querySelector('[name="password_actual"]')?.focus();
    });

  async function desbloquearPerfil(evento) {
    evento.preventDefault();
    if (!formularioDesbloqueo || peticionEnCurso) return;
    limpiarFeedbackModal();
    const password = formularioDesbloqueo.elements.password_actual?.value || '';

    try {
      const respuesta = await ejecutarPeticion('/mi-perfil/desbloquear', {
        password_actual: password
      });
      autorizada = true;
      expiraEnMs = Date.parse(respuesta.datos?.expira_en || '');
      raiz.dataset.autorizada = 'true';
      raiz.dataset.expiraEn = respuesta.datos?.expira_en || '';
      formularioDesbloqueo.reset();
      obtenerModalDesbloqueo()?.hide();
      sincronizarEstadoEdicion();
      iniciarTemporizadorVigencia();
      mostrarResultado('exito', respuesta.mensaje);
      mostrarToast('satisfactorio', respuesta.mensaje);
    } catch (error) {
      mostrarFeedbackModal(error.message);
    }
  }

  async function cerrarEdicion() {
    if (peticionEnCurso) return;
    try {
      const respuesta = await ejecutarPeticion(
        '/mi-perfil/cerrar-edicion',
        {}
      );
      bloquearEdicion();
      mostrarResultado('exito', respuesta.mensaje);
      mostrarToast('satisfactorio', respuesta.mensaje);
    } catch (error) {
      gestionarError(error);
    }
  }

  async function guardarAtributo(evento) {
    evento.preventDefault();
    const formulario = evento.currentTarget;
    if (!(formulario instanceof HTMLFormElement) || peticionEnCurso) return;
    const operacion = formulario.dataset.perfilFormulario;
    if (!rutas[operacion]) return;

    if (
      operacion === 'password' &&
      !window.confirm(
        'La contraseña cambiará y se cerrarán todas tus sesiones. ¿Deseas continuar?'
      )
    ) {
      return;
    }

    const cuerpo = Object.fromEntries(new FormData(formulario).entries());
    if (operacion === 'preferencia_mostrar_alertas_remotas') {
      cuerpo.mostrar = formulario.elements.mostrar?.checked === true;
    }
    try {
      const respuesta = await ejecutarPeticion(rutas[operacion], cuerpo);
      if (operacion === 'password') {
        window.portalToast?.persist?.({
          tipo: 'satisfactorio',
          titulo: 'Contraseña actualizada',
          cuerpo: respuesta.mensaje
        });
        window.location.assign('/login');
        return;
      }

      if (operacion === 'email') {
        recargarConMensaje(respuesta.mensaje);
        return;
      }

      if (operacion === 'preferencia_mostrar_alertas_remotas') {
        recargarConMensaje(respuesta.mensaje);
        return;
      }

      const valor = respuesta.datos?.[operacion];
      const nodoValor = raiz.querySelector(
        `[data-perfil-valor="${operacion}"]`
      );
      if (nodoValor && typeof valor === 'string') nodoValor.textContent = valor;
      const campo = formulario.elements[operacion];
      if (campo instanceof HTMLInputElement && typeof valor === 'string') {
        campo.value = valor;
      }
      if (operacion === 'nombre_visible' && typeof valor === 'string') {
        const nombrePrincipal = raiz.querySelector(
          '[data-perfil-nombre-principal]'
        );
        if (nombrePrincipal) nombrePrincipal.textContent = valor;
      }
      mostrarResultado('exito', respuesta.mensaje);
      mostrarToast('satisfactorio', respuesta.mensaje);
    } catch (error) {
      gestionarError(error);
    }
  }

  async function validarEmailActual() {
    if (peticionEnCurso) return;
    try {
      const respuesta = await ejecutarPeticion('/mi-perfil/email/validar', {});
      recargarConMensaje(respuesta.mensaje);
    } catch (error) {
      gestionarError(error);
    }
  }

  async function reenviarEmail() {
    if (peticionEnCurso) return;
    try {
      const respuesta = await ejecutarPeticion('/mi-perfil/email/reenviar', {});
      recargarConMensaje(respuesta.mensaje);
    } catch (error) {
      gestionarError(error);
    }
  }

  async function ejecutarPeticion(url, cuerpo) {
    establecerPeticionEnCurso(true);
    limpiarResultado();
    try {
      const respuesta = await window.fetch(url, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          'X-Silenciar-Toast-Error': '1'
        },
        body: JSON.stringify(cuerpo)
      });
      const payload = await respuesta.json().catch(function () {
        return {};
      });
      if (!respuesta.ok || payload.ok === false) {
        const error = new Error(
          payload.mensaje || 'No se pudo completar la operación del perfil.'
        );
        error.codigo = payload.codigo || 'infraestructura_no_disponible';
        error.estadoHttp = respuesta.status;
        throw error;
      }
      return payload;
    } finally {
      establecerPeticionEnCurso(false);
    }
  }

  function gestionarError(error) {
    if (
      error.codigo === 'perfil_edicion_requerida' ||
      error.codigo === 'sesion_no_vigente'
    ) {
      bloquearEdicion();
    }
    mostrarResultado('error', error.message);
    mostrarToast('error', error.message);
  }

  function sincronizarEstadoEdicion() {
    if (!disponible) return;
    for (const elemento of elementosEdicion) {
      elemento.classList.toggle('d-none', !autorizada);
    }
    for (const elemento of elementosBloqueados) {
      elemento.classList.toggle('d-none', autorizada);
    }
    botonAbrir?.classList.toggle('d-none', autorizada);
    botonCerrar?.classList.toggle('d-none', !autorizada);
    vigencia?.classList.toggle('d-none', !autorizada);
    estadoIcono?.classList.toggle('bi-lock', !autorizada);
    estadoIcono?.classList.toggle('bi-unlock', autorizada);
    if (estadoTitulo) {
      estadoTitulo.textContent = autorizada
        ? 'Edición habilitada'
        : 'Editar tu perfil';
    }
    if (estadoTexto) {
      estadoTexto.textContent = autorizada
        ? 'Edición autorizada temporalmente para esta sesión.'
        : 'Confirma tu contraseña antes de modificar datos personales.';
    }
    sincronizarPreferenciaAlertasRemotas();
    actualizarVigencia();
  }

  function sincronizarPreferenciaAlertasRemotas() {
    if (!(campoPreferenciaAlertas instanceof HTMLInputElement)) return;
    const mostradas = campoPreferenciaAlertas.checked;
    const hayCambios = mostradas !== campoPreferenciaAlertas.defaultChecked;

    if (estadoPreferenciaAlertas) {
      estadoPreferenciaAlertas.textContent = mostradas ? 'Mostradas' : 'Ocultas';
      estadoPreferenciaAlertas.dataset.activo = mostradas ? 'true' : 'false';
    }
    if (cambiosPreferenciaAlertas) {
      cambiosPreferenciaAlertas.textContent = hayCambios
        ? 'Cambio sin guardar.'
        : 'Sin cambios pendientes.';
    }
    if (botonGuardarPreferenciaAlertas) {
      botonGuardarPreferenciaAlertas.disabled =
        peticionEnCurso || !autorizada || !hayCambios;
    }
  }

  function bloquearEdicion() {
    autorizada = false;
    expiraEnMs = Number.NaN;
    raiz.dataset.autorizada = 'false';
    raiz.dataset.expiraEn = '';
    if (campoPreferenciaAlertas instanceof HTMLInputElement) {
      campoPreferenciaAlertas.checked = campoPreferenciaAlertas.defaultChecked;
    }
    sincronizarEstadoEdicion();
    detenerTemporizadorVigencia();
  }

  function iniciarTemporizadorVigencia() {
    detenerTemporizadorVigencia();
    if (!autorizada || !Number.isFinite(expiraEnMs)) return;
    actualizarVigencia();
    temporizadorVigencia = window.setInterval(actualizarVigencia, 1000);
  }

  function detenerTemporizadorVigencia() {
    if (temporizadorVigencia) window.clearInterval(temporizadorVigencia);
    temporizadorVigencia = null;
  }

  function actualizarVigencia() {
    if (!autorizada || !vigenciaTexto || !Number.isFinite(expiraEnMs)) return;
    const restante = Math.max(0, expiraEnMs - Date.now());
    if (restante <= 0) {
      bloquearEdicion();
      mostrarResultado(
        'aviso',
        'La autorización temporal ha expirado. Vuelve a introducir tu contraseña.'
      );
      return;
    }
    const segundos = Math.ceil(restante / 1000);
    const minutos = Math.floor(segundos / 60);
    const restoSegundos = String(segundos % 60).padStart(2, '0');
    vigenciaTexto.textContent =
      `Edición disponible durante ${minutos}:${restoSegundos}`;
  }

  function establecerPeticionEnCurso(ocupada) {
    peticionEnCurso = ocupada;
    const botones = Array.from(
      document.querySelectorAll(
        '[data-perfil-autogestion] button, [data-perfil-desbloquear] button'
      )
    );
    for (const boton of botones) boton.disabled = ocupada;
    sincronizarPreferenciaAlertasRemotas();
    raiz.setAttribute('aria-busy', ocupada ? 'true' : 'false');
  }

  function obtenerModalDesbloqueo() {
    const nodo = document.getElementById('modal-desbloquear-perfil');
    if (!nodo || !window.bootstrap?.Modal) return null;
    return window.bootstrap.Modal.getOrCreateInstance(nodo);
  }

  function mostrarResultado(tipo, mensaje) {
    if (!feedback) return;
    feedback.className =
      `perfil-editor__feedback perfil-editor__feedback--${tipo}`;
    feedback.textContent = mensaje || '';
  }

  function limpiarResultado() {
    if (!feedback) return;
    feedback.className = 'perfil-editor__feedback';
    feedback.textContent = '';
  }

  function mostrarFeedbackModal(mensaje) {
    if (!feedbackModal) return;
    feedbackModal.className =
      'perfil-editor__modal-feedback perfil-editor__modal-feedback--error';
    feedbackModal.textContent = mensaje || '';
  }

  function limpiarFeedbackModal() {
    if (!feedbackModal) return;
    feedbackModal.className = 'perfil-editor__modal-feedback';
    feedbackModal.textContent = '';
  }

  function mostrarToast(tipo, mensaje) {
    window.portalToast?.show?.({
      tipo,
      titulo: tipo === 'error'
        ? 'No se pudo actualizar el perfil'
        : 'Mi perfil',
      cuerpo: mensaje
    });
  }

  function recargarConMensaje(mensaje) {
    window.portalToast?.persist?.({
      tipo: 'satisfactorio',
      titulo: 'Mi perfil',
      cuerpo: mensaje
    });
    window.location.reload();
  }
})();
