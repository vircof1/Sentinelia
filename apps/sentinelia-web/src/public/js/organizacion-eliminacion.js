document.addEventListener('DOMContentLoaded', function () {
  const modalNodo = document.querySelector('[data-organizacion-modal-eliminacion]');

  if (!modalNodo || !window.bootstrap?.Modal) {
    return;
  }

  const modal = new window.bootstrap.Modal(modalNodo);
  const formularioModal = modalNodo.querySelector('[data-organizacion-modal-form]');
  const inputId = modalNodo.querySelector('[data-organizacion-modal-id]');
  const inputToken = modalNodo.querySelector('[data-organizacion-token-confirmacion]');
  const subtitulo = modalNodo.querySelector('[data-organizacion-modal-subtitulo]');
  const descripcion = modalNodo.querySelector('[data-organizacion-modal-descripcion]');
  const bloqueCargando = modalNodo.querySelector('[data-organizacion-impacto-cargando]');
  const bloqueError = modalNodo.querySelector('[data-organizacion-impacto-error]');
  const bloqueContenido = modalNodo.querySelector('[data-organizacion-impacto-contenido]');
  const botonConfirmar = modalNodo.querySelector('[data-organizacion-modal-confirmar]');
  const totalDependencias = modalNodo.querySelector('[data-impacto-total-dependencias]');
  const totalCascada = modalNodo.querySelector('[data-impacto-total-cascada]');
  const totalDesacopladas = modalNodo.querySelector('[data-impacto-total-desacopladas]');
  const totalBloqueos = modalNodo.querySelector('[data-impacto-total-bloqueos]');
  const primerNivel = modalNodo.querySelector('[data-impacto-primer-nivel]');
  const cascada = modalNodo.querySelector('[data-impacto-cascada]');
  const desacopladas = modalNodo.querySelector('[data-impacto-desacopladas]');
  const bloqueos = modalNodo.querySelector('[data-impacto-bloqueos]');
  const seccionDesacopladas = modalNodo.querySelector('[data-impacto-seccion-desacopladas]');
  const seccionBloqueos = modalNodo.querySelector('[data-impacto-seccion-bloqueos]');
  const bloqueDurable = modalNodo.querySelector('[data-organizacion-impacto-durable]');
  const bloqueLegado = modalNodo.querySelector('[data-organizacion-impacto-legado]');
  const avisoPrincipal = modalNodo.querySelector('[data-organizacion-aviso-principal]');
  const avisoAgregado = modalNodo.querySelector('[data-organizacion-aviso-agregado]');
  const grupoEliminacion = modalNodo.querySelector('[data-organizacion-grupo-eliminacion]');
  const grupoHistorico = modalNodo.querySelector('[data-organizacion-grupo-historico]');
  const grupoConservado = modalNodo.querySelector('[data-organizacion-grupo-conservado]');
  const impactoEliminacion = modalNodo.querySelector('[data-organizacion-impacto-eliminacion]');
  const impactoHistorico = modalNodo.querySelector('[data-organizacion-impacto-historico]');
  const impactoConservado = modalNodo.querySelector('[data-organizacion-impacto-conservado]');
  const fraseExactaNodo = modalNodo.querySelector('[data-organizacion-frase-exacta]');
  const inputFrase = modalNodo.querySelector('[data-organizacion-frase-confirmacion]');
  const estadoConfirmacion = modalNodo.querySelector('[data-organizacion-estado-confirmacion]');

  let formularioOrigen = null;
  let modoDurable = false;
  let fraseExacta = '';
  let enviando = false;
  let cargaImpactoSecuencia = 0;

  function establecerTextoBotonConfirmar({ icono = 'trash3', texto }) {
    botonConfirmar.innerHTML = `
      <i class="bi bi-${escapeHtml(icono)}" aria-hidden="true"></i>
      <span>${escapeHtml(texto)}</span>
    `;
  }

  document.addEventListener('submit', function (evento) {
    const formulario = evento.target.closest('[data-organizacion-eliminar-form]');

    if (!formulario) {
      return;
    }

    evento.preventDefault();
    void abrirModalDesdeFormulario(formulario);
  });

  formularioModal.addEventListener('submit', function (evento) {
    evento.preventDefault();
    void confirmarEliminacionAjax();
  });

  inputFrase.addEventListener('input', validarConfirmacionDurable);

  modalNodo.addEventListener('hidden.bs.modal', function () {
    cargaImpactoSecuencia += 1;
    formularioOrigen = null;
    formularioModal.action = '';
    inputId.value = '';
    inputToken.value = '';
    inputFrase.value = '';
    inputFrase.disabled = true;
    fraseExactaNodo.textContent = '';
    estadoConfirmacion.textContent = 'La frase todavía no coincide exactamente.';
    estadoConfirmacion.classList.remove('text-success');
    estadoConfirmacion.classList.add('text-body-secondary');
    modoDurable = false;
    fraseExacta = '';
    enviando = false;
    subtitulo.textContent =
      'Se está evaluando el impacto real antes de continuar.';
    descripcion.textContent =
      'Se cargará el detalle antes de permitir la confirmación.';
    bloqueError.classList.add('d-none');
    bloqueError.textContent = '';
    bloqueContenido.classList.add('d-none');
    bloqueDurable.classList.add('d-none');
    bloqueLegado.classList.remove('d-none');
    avisoPrincipal.classList.remove('d-none');
    bloqueCargando.classList.remove('d-none');
    botonConfirmar.disabled = true;
    establecerTextoBotonConfirmar({
      icono: 'trash3',
      texto: 'Eliminar definitivamente'
    });
    primerNivel.innerHTML = '';
    cascada.innerHTML = '';
    desacopladas.innerHTML = '';
    bloqueos.innerHTML = '';
    seccionDesacopladas.classList.add('d-none');
    seccionBloqueos.classList.add('d-none');
    totalDependencias.textContent = '0';
    totalCascada.textContent = '0';
    totalDesacopladas.textContent = '0';
    totalBloqueos.textContent = '0';
  });

  async function abrirModalDesdeFormulario(formulario) {
    const secuencia = ++cargaImpactoSecuencia;
    formularioOrigen = formulario;
    modoDurable = formulario.dataset.organizacionDurable === 'true';
    formularioModal.action = formulario.getAttribute('action') || '';
    inputId.value = formulario.dataset.organizacionId || '';

    const etiquetaEntidad = formulario.dataset.organizacionEntidad || 'Elemento';
    const nombre = formulario.dataset.organizacionNombre || `#${inputId.value}`;
    const detalle = formulario.dataset.organizacionDetalle || '';

    subtitulo.textContent = `${etiquetaEntidad} ${nombre}`;
    descripcion.innerHTML = modoDurable
      ? `Se eliminará <strong>${escapeHtml(etiquetaEntidad.toLowerCase())}</strong>
        <strong>${escapeHtml(nombre)}</strong> y todo lo que le pertenezca
        cuando la operación tome su fotografía final.`
      : `Se eliminará <strong>${escapeHtml(etiquetaEntidad.toLowerCase())}</strong>
        <strong>${escapeHtml(nombre)}</strong>
        ${detalle ? 'y su jerarquía asociada visible desde SQL.' : 'y se revisarán sus dependencias reales.'}`;

    avisoPrincipal.classList.toggle('d-none', modoDurable);
    modal.show();

    try {
      const datos = await getJson(formulario.dataset.organizacionUrlImpacto);
      if (secuencia !== cargaImpactoSecuencia || formularioOrigen !== formulario) {
        return;
      }
      bloqueError.classList.add('d-none');
      bloqueError.textContent = '';
      if (modoDurable) {
        renderImpactoDurable(datos.impacto || {});
      } else {
        renderImpacto(datos.impacto || {});
      }
      bloqueCargando.classList.add('d-none');
      bloqueContenido.classList.remove('d-none');

      const hayBloqueos = !modoDurable &&
        Number(datos.impacto?.resumen?.totalBloqueosPotenciales || 0) > 0;

      botonConfirmar.disabled = modoDurable || hayBloqueos;
      if (hayBloqueos) {
        establecerTextoBotonConfirmar({
          icono: 'shield-lock',
          texto: 'Bloqueado por referencias'
        });
      } else {
        establecerTextoBotonConfirmar({
          icono: modoDurable ? 'send' : 'trash3',
          texto: modoDurable ? 'Iniciar eliminación' : 'Eliminar definitivamente'
        });
      }
    } catch (error) {
      if (secuencia !== cargaImpactoSecuencia || formularioOrigen !== formulario) {
        return;
      }
      bloqueCargando.classList.add('d-none');
      bloqueError.classList.remove('d-none');
      bloqueError.textContent =
        error.message ||
        'No se pudo calcular el impacto de la eliminación.';
      botonConfirmar.disabled = true;
      mostrarToast({
        tipo: 'error',
        titulo: 'Eliminación',
        cuerpo:
          error.message ||
          'No se pudo calcular el impacto antes de eliminar.'
      });
    }
  }

  async function confirmarEliminacionAjax() {
    if (enviando || (modoDurable && inputFrase.value !== fraseExacta)) {
      inputFrase.focus();
      return;
    }
    const aceptacionDurable = modoDurable;
    const formularioAceptado = formularioOrigen;
    const secuenciaAceptacion = cargaImpactoSecuencia;
    enviando = true;
    botonConfirmar.disabled = true;
    establecerTextoBotonConfirmar({
      icono: 'arrow-repeat',
      texto: modoDurable ? 'Iniciando…' : 'Eliminando...'
    });

    try {
      const cuerpo = new URLSearchParams();
      const datosFormulario = new FormData(formularioModal);

      for (const [clave, valor] of datosFormulario.entries()) {
        cuerpo.append(clave, String(valor));
      }

      const respuesta = await window.fetch(formularioModal.action, {
        method: 'POST',
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
          Accept: 'application/json'
        },
        body: cuerpo
      });
      const datos = await respuesta.json().catch(function () {
        return {};
      });

      if (!respuesta.ok || datos.ok === false) {
        throw new Error(datos.mensaje || 'No se pudo completar la eliminación.');
      }

      const modalVigente = secuenciaAceptacion === cargaImpactoSecuencia &&
        formularioOrigen === formularioAceptado;
      if (modalVigente) {
        bloqueError.classList.add('d-none');
        bloqueError.textContent = '';
        modal.hide();
      }

      if (aceptacionDurable) {
        mostrarSeguimientoEncolado(datos);
        mostrarToast({
          tipo: 'satisfactorio',
          titulo: 'Eliminación iniciada',
          cuerpo: datos.repetida
            ? 'La operación ya estaba en curso. La raíz seguirá visible hasta que termine.'
            : 'La operación se ha iniciado. La raíz seguirá visible hasta que termine.'
        });
        document.dispatchEvent(new CustomEvent('portal:buzon-usuario-actualizado'));
        return;
      }
      if (!modalVigente) return;

      const flash = datos.flash || null;
      mostrarToast({
        tipo: flash?.tipo === 'exito' ? 'satisfactorio' : (flash?.tipo || 'satisfactorio'),
        titulo: 'Organización',
        cuerpo: flash?.mensaje || 'Elemento eliminado correctamente.'
      });

      document.dispatchEvent(
        new CustomEvent('organizacion:eliminacion-completada', {
          detail: {
            id: inputId.value,
            entidad: formularioOrigen?.dataset?.organizacionEntidad || null,
            action: formularioModal.action
          }
        })
      );
    } catch (error) {
      const modalVigente = secuenciaAceptacion === cargaImpactoSecuencia &&
        formularioOrigen === formularioAceptado;
      if (!modalVigente) {
        mostrarToast({
          tipo: 'error',
          titulo: 'Eliminación',
          cuerpo: error.message || 'No se pudo completar la eliminación.'
        });
        return;
      }
      enviando = false;
      botonConfirmar.disabled = modoDurable && inputFrase.value !== fraseExacta;
      establecerTextoBotonConfirmar({
        icono: modoDurable ? 'send' : 'trash3',
        texto: modoDurable ? 'Iniciar eliminación' : 'Eliminar definitivamente'
      });
      bloqueError.classList.remove('d-none');
      bloqueError.textContent =
        error.message || 'No se pudo completar la eliminación.';
      bloqueError.scrollIntoView({
        block: 'nearest',
        behavior: 'smooth'
      });
      mostrarToast({
        tipo: 'error',
        titulo: 'Eliminación',
        cuerpo: error.message || 'No se pudo completar la eliminación.'
      });
    }
  }

  function validarConfirmacionDurable() {
    if (!modoDurable) return;
    const coincide = inputFrase.value === fraseExacta;
    botonConfirmar.disabled = !coincide || enviando;
    estadoConfirmacion.textContent = coincide
      ? 'La frase coincide. Se iniciará la operación; la raíz todavía no se eliminará.'
      : 'La frase todavía no coincide exactamente.';
    estadoConfirmacion.classList.toggle('text-success', coincide);
    estadoConfirmacion.classList.toggle('text-body-secondary', !coincide);
  }

  function renderImpactoDurable(impacto) {
    bloqueDurable.classList.remove('d-none');
    bloqueLegado.classList.add('d-none');
    const filas = Array.isArray(impacto.resumenImpacto?.conteos)
      ? impacto.resumenImpacto.conteos
      : [];
    const filasVisibles = filas.filter(tieneCantidad);
    const filasConservadas = filasVisibles.filter(function (item) {
      return item.categoria === 'correo_aceptado_preservadas';
    });
    const filasHistoricas = filasVisibles.filter(function (item) {
      return esCategoriaHistorica(item.categoria);
    });
    const filasEliminacion = filasVisibles.filter(function (item) {
      return item.categoria !== 'correo_aceptado_preservadas' &&
        !esCategoriaHistorica(item.categoria);
    });

    renderGrupoImpacto({
      seccion: grupoEliminacion,
      cuerpo: impactoEliminacion,
      filas: filasEliminacion,
      mensajeVacio: 'No se ha detectado contenido asociado.'
    });
    renderGrupoImpacto({
      seccion: grupoHistorico,
      cuerpo: impactoHistorico,
      filas: filasHistoricas
    });
    renderGrupoImpacto({
      seccion: grupoConservado,
      cuerpo: impactoConservado,
      filas: filasConservadas
    });
    avisoAgregado.textContent = impacto.avisoAgregadoDinamico ||
      'Se eliminará la raíz y todo lo que le pertenezca al ejecutar.';
    fraseExacta = String(impacto.fraseConfirmacion || '');
    fraseExactaNodo.textContent = fraseExacta;
    inputToken.value = String(impacto.tokenConfirmacion || '');
    inputFrase.disabled = false;
    validarConfirmacionDurable();
    inputFrase.focus();
  }

  function mostrarSeguimientoEncolado(datos) {
    const anterior = document.querySelector('[data-organizacion-operacion-encolada]');
    if (anterior) anterior.remove();
    const panel = document.querySelector(
      '[data-tenants-lista], [data-empresas-lista], [data-sitios-lista]'
    );
    if (!panel) return;
    const aviso = document.createElement('section');
    aviso.className = 'seccion-panel operacion-seguimiento-listado';
    aviso.dataset.organizacionOperacionEncolada = '';
    aviso.innerHTML = `
      <div class="alert alert-info border shadow-sm mb-0" role="status" aria-live="polite">
        <div class="d-flex flex-wrap align-items-center justify-content-between gap-3">
          <div>
            <strong>Eliminación iniciada</strong>
            <span class="d-block small">La fila permanece visible hasta que una recarga confirme el borrado.</span>
          </div>
          <div class="d-flex gap-2 flex-wrap">
            <a class="btn btn-sm btn-outline-primary" href="${escapeHtml(datos.urlSeguimiento || '#')}">Ver seguimiento</a>
            <button type="button" class="btn btn-sm btn-outline-secondary" data-organizacion-abrir-buzon>Abrir buzón</button>
          </div>
        </div>
      </div>
    `;
    panel.before(aviso);
    aviso.querySelector('[data-organizacion-abrir-buzon]')
      ?.addEventListener('click', function () {
        document.querySelector('[data-buzon-personal-abrir]')?.click();
      });
  }

  function renderGrupoImpacto({ seccion, cuerpo, filas, mensajeVacio = '' }) {
    seccion.classList.toggle('d-none', filas.length === 0 && !mensajeVacio);
    cuerpo.innerHTML = filas.length
      ? filas.map(function (item) {
        return `
          <tr>
            <td>${escapeHtml(etiquetaCategoria(item.categoria))}</td>
            <td class="text-end fw-semibold">${escapeHtml(
              item.precision === 'minima'
                ? `Al menos ${formatearCantidad(item.cantidad)}`
                : formatearCantidad(item.cantidad)
            )}</td>
          </tr>
        `;
      }).join('')
      : `<tr><td colspan="2" class="text-body-secondary">${escapeHtml(mensajeVacio)}</td></tr>`;
  }

  function tieneCantidad(item) {
    return /^(?:[1-9][0-9]*)$/u.test(String(item?.cantidad || ''));
  }

  function formatearCantidad(cantidad) {
    return new Intl.NumberFormat('es-ES').format(BigInt(cantidad));
  }

  function esCategoriaHistorica(categoria) {
    return [
      'senales',
      'observaciones',
      'pol',
      'eventos',
      'ejecuciones_trigger'
    ].includes(categoria);
  }

  function etiquetaCategoria(categoria) {
    const etiquetas = {
      raiz: 'Entidad principal',
      empresas: 'Empresas',
      sitios: 'Sitios',
      usuarios: 'Usuarios',
      agentes: 'Agentes',
      reglas: 'Reglas de interpretación',
      monitores: 'Monitores',
      sesiones: 'Sesiones de agentes',
      identidades_federadas: 'Identidades federadas',
      referencias_restrict: 'Referencias que pueden bloquear la eliminación',
      audiencia_correo_visible: 'Destinatarios de correo que se retirarán',
      audiencia_correo_restringida: 'Destinatarios de correo fuera de tu alcance',
      triggers_correo_supervivientes_desactivados: 'Acciones de correo que se desactivarán',
      senales: 'Señales',
      observaciones: 'Observaciones',
      pol: 'Evaluaciones de reglas',
      eventos: 'Eventos',
      ejecuciones_trigger: 'Ejecuciones de acciones',
      correo_aceptado_preservadas: 'Correos aceptados',
      concesiones_ddns: 'Concesiones DDNS',
      intenciones_ddns_aceptadas: 'Cambios DDNS ya aceptados',
      causas_pol_ddns_pendientes: 'Cambios DDNS pendientes',
      obligaciones_postcommit: 'Tareas posteriores pendientes'
    };
    return etiquetas[categoria] || String(categoria || '-')
      .replaceAll('_', ' ')
      .replace(/^./u, function (letra) { return letra.toUpperCase(); });
  }

  function renderImpacto(impacto) {
    const resumen = impacto.resumen || {};
    totalDependencias.textContent = String(resumen.totalDependencias || 0);
    totalCascada.textContent = String(resumen.totalEliminacionesEnCascada || 0);
    totalDesacopladas.textContent = String(
      resumen.totalReferenciasDesacopladas || 0
    );
    totalBloqueos.textContent = String(
      resumen.totalBloqueosPotenciales || 0
    );

    renderFilas(
      primerNivel,
      impacto.impactoPrimerNivel || [],
      function (item) {
        return `
          <tr>
            <td>${escapeHtml(item.etiquetaTabla || item.tabla || '-')}</td>
            <td><code>${escapeHtml(item.regla || '-')}</code></td>
            <td class="text-end fw-semibold">${escapeHtml(item.total || 0)}</td>
          </tr>
        `;
      },
      'Sin dependencias directas visibles.',
      3
    );

    renderFilas(
      cascada,
      impacto.eliminacionesEnCascada || [],
      function (item) {
        return `
          <tr>
            <td>${escapeHtml(item.etiquetaTabla || item.tabla || '-')}</td>
            <td class="text-end fw-semibold">${escapeHtml(item.total || 0)}</td>
          </tr>
        `;
      },
      'No hay borrado adicional en cascada.',
      2
    );

    renderFilas(
      desacopladas,
      impacto.referenciasDesacopladas || [],
      function (item) {
        return `
          <tr>
            <td>${escapeHtml(item.etiquetaTabla || item.tabla || '-')}</td>
            <td><code>${escapeHtml(item.deleteRule || item.regla || '-')}</code></td>
            <td class="text-end fw-semibold">${escapeHtml(item.total || 0)}</td>
          </tr>
        `;
      },
      'No se detectaron referencias a desacoplar.',
      3
    );

    renderFilas(
      bloqueos,
      impacto.bloqueosPotenciales || [],
      function (item) {
        return `
          <tr>
            <td>${escapeHtml(item.etiquetaTabla || item.tabla || '-')}</td>
            <td><code>${escapeHtml(item.deleteRule || item.regla || '-')}</code></td>
            <td class="text-end fw-semibold">${escapeHtml(item.total || 0)}</td>
          </tr>
        `;
      },
      'No se detectaron bloqueos.',
      3
    );

    seccionDesacopladas.classList.toggle(
      'd-none',
      !(impacto.referenciasDesacopladas || []).length
    );
    seccionBloqueos.classList.toggle(
      'd-none',
      !(impacto.bloqueosPotenciales || []).length
    );
  }

  function renderFilas(contenedor, items, renderItem, mensajeVacio, colspan) {
    if (!items.length) {
      contenedor.innerHTML = `
        <tr>
          <td colspan="${Number(colspan || 1)}" class="text-body-secondary">${escapeHtml(mensajeVacio)}</td>
        </tr>
      `;
      return;
    }

    contenedor.innerHTML = items.map(renderItem).join('');
  }
});

async function getJson(url) {
  const respuesta = await window.fetch(url, {
    headers: {
      'X-Requested-With': 'XMLHttpRequest'
    }
  });
  const datos = await respuesta.json().catch(function () {
    return {};
  });

  if (!respuesta.ok || datos.ok === false) {
    throw new Error(datos.mensaje || 'La operación AJAX no pudo completarse.');
  }

  return datos;
}

function escapeHtml(valor) {
  return String(valor)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function mostrarToast(payload) {
  if (window.portalToast?.show) {
    window.portalToast.show(payload);
    return;
  }

  window.alert(payload?.cuerpo || payload?.mensaje || 'Error');
}
