(function () {
  const moduloListado = document.querySelector('[data-monitores-lista]');
  const modulo = document.querySelector('[data-monitor-formulario]');

  if (moduloListado) {
    inicializarListadoMonitores(moduloListado);
  }

  if (!modulo) {
    return;
  }

  const selectorTenant = modulo.querySelector('[data-monitor-tenant]');
  const selectorEmpresa = modulo.querySelector('[data-monitor-empresa]');
  const selectorSitio = modulo.querySelector('[data-monitor-sitio]');
  const inputTenantFijo = modulo.querySelector('input[type="hidden"][name="tenant_id"]');
  const inputEmpresaFija = modulo.querySelector('input[type="hidden"][name="empresa_id"]');
  const inputSitioFijo = modulo.querySelector('input[type="hidden"][name="sitio_id"]');
  const inputPertenenciaFija = modulo.querySelector(
    'input[type="hidden"][name="nivel_pertenencia"]'
  );
  const selectorTipo = modulo.querySelector('[data-monitor-tipo]');
  const formulario = modulo.querySelector('[data-monitor-formulario-submit]');
  const tipoFijoFormulario = String(
    modulo.dataset.monitorTipoFijo || ''
  ).trim().toLowerCase();
  const monitorActualIdFormulario = normalizarNumero(modulo.dataset.monitorId);
  const estadoInicialLogicoFormulario = parsearEstadoInicialLogico(
    modulo.dataset.monitorLogicoInicial
  );
  const selectorPertenencia = modulo.querySelector('[data-monitor-pertenencia]');
  const ayudaScopeEmpresa = modulo.querySelector('[data-monitor-scope-tooltip="empresa"]');
  const ayudaScopeSitio = modulo.querySelector('[data-monitor-scope-tooltip="sitio"]');
  const textoAyudaScopeEmpresa = modulo.querySelector('[data-monitor-scope-ayuda="empresa"]');
  const textoAyudaScopeSitio = modulo.querySelector('[data-monitor-scope-ayuda="sitio"]');
  const bloquesTipo = Array.from(
    modulo.querySelectorAll('[data-monitor-bloque-tipo]')
  );
  const bloqueSondeo = modulo.querySelector('[data-monitor-bloque-sondeo]');
  const camposSondeo = Array.from(
    modulo.querySelectorAll('[data-monitor-campo-sondeo]')
  );
  const camposLogicos = Array.from(
    modulo.querySelectorAll('[data-monitor-campo-logico]')
  );
  const ayudaTipo = modulo.querySelector('[data-monitor-ayuda-tipo]');
  const bloqueSemanticaEstado = modulo.querySelector(
    '[data-monitor-semantica-estado]'
  );
  const selectorInterpretacionEstado = modulo.querySelector(
    '[data-monitor-interpretacion-estado]'
  );
  const ayudaInterpretacionEstado = modulo.querySelector(
    '[data-monitor-interpretacion-ayuda]'
  );
  const selectorUsarTls = modulo.querySelector('#monitor_usar_tls');
  const bloqueVigenciaTls = modulo.querySelector('[data-monitor-campo-tls-vigencia]');
  const inputVigenciaTls = modulo.querySelector(
    '[data-monitor-campo-tls-vigencia-input]'
  );
  const inputNombre = modulo.querySelector('[data-monitor-nombre]');
  const inputHost = modulo.querySelector('[data-monitor-host]');
  const selectorActivo = modulo.querySelector('[data-monitor-activo]');
  const inputIntervalo = modulo.querySelector('[data-monitor-intervalo]');
  const inputDesfase = modulo.querySelector('[data-monitor-desfase]');
  const inputTimeout = modulo.querySelector('[data-monitor-timeout]');
  const inputReintentos = modulo.querySelector('[data-monitor-reintentos]');
  const inputPayload = modulo.querySelector('[data-monitor-payload]');
  const inputTtl = modulo.querySelector('[data-monitor-ttl]');
  const resumenIcmpAvanzado = modulo.querySelector(
    '[data-monitor-icmp-avanzados-resumen]'
  );
  const resumenAlcancePlegable = modulo.querySelector(
    '[data-monitor-alcance-resumen]'
  );
  const inputPuerto = modulo.querySelector('[data-monitor-puerto]');
  const inputVigencia = modulo.querySelector('[data-monitor-vigencia]');
  const inputLogicoDependencia = modulo.querySelector('[data-monitor-logico-dependencia]');
  const inputLogicoExpresion = modulo.querySelector('[data-monitor-logico-expresion]');
  const inputLogicoMensajeFallo = modulo.querySelector('[data-monitor-logico-mensaje-fallo]');
  const selectorLogicoEstadoInicial = modulo.querySelector(
    '[data-monitor-logico-estado-inicial]'
  );
  const inputLogicoRetardo = modulo.querySelector('[data-monitor-logico-retardo]');
  const urlFuentesTelemetria = String(
    modulo.dataset.monitorTelemetriaFuentesUrl || ''
  ).trim();
  const selectorAgenteTelemetria = modulo.querySelector(
    '[data-monitor-telemetria-agente]'
  );
  const selectorTipoFuenteTelemetria = modulo.querySelector(
    '[data-monitor-telemetria-tipo-fuente]'
  );
  const selectorSenalTelemetria = modulo.querySelector(
    '[data-monitor-telemetria-senal]'
  );
  const selectorReglaTelemetria = modulo.querySelector(
    '[data-monitor-telemetria-regla]'
  );
  const bloqueFuenteDirectaTelemetria = modulo.querySelector(
    '[data-monitor-telemetria-fuente-directa]'
  );
  const bloqueFuenteReglaTelemetria = modulo.querySelector(
    '[data-monitor-telemetria-fuente-regla]'
  );
  const bloqueCondicionDirectaTelemetria = modulo.querySelector(
    '[data-monitor-telemetria-condicion-directa]'
  );
  const bloqueCondicionNumericaTelemetria = modulo.querySelector(
    '[data-monitor-telemetria-condicion-numerica]'
  );
  const bloqueCondicionValorTelemetria = modulo.querySelector(
    '[data-monitor-telemetria-condicion-valor]'
  );
  const bloqueOperadorTelemetria = modulo.querySelector(
    '[data-monitor-telemetria-operador-contenedor]'
  );
  const bloqueValorTextoTelemetria = modulo.querySelector(
    '[data-monitor-telemetria-valor-texto]'
  );
  const bloqueValorBooleanoTelemetria = modulo.querySelector(
    '[data-monitor-telemetria-valor-booleano]'
  );
  const inputTipoDatoTelemetria = modulo.querySelector(
    '[data-monitor-telemetria-tipo-dato]'
  );
  const inputUnidadTelemetria = modulo.querySelector(
    '[data-monitor-telemetria-unidad]'
  );
  const inputMinimoTelemetria = modulo.querySelector(
    '[data-monitor-telemetria-minimo]'
  );
  const inputMaximoTelemetria = modulo.querySelector(
    '[data-monitor-telemetria-maximo]'
  );
  const selectorOperadorTelemetria = modulo.querySelector(
    '[data-monitor-telemetria-operador]'
  );
  const inputValorTextoTelemetria = modulo.querySelector(
    '[data-monitor-telemetria-valor-esperado-texto]'
  );
  const selectorValorBooleanoTelemetria = modulo.querySelector(
    '[data-monitor-telemetria-valor-esperado-booleano]'
  );
  const contextoNombreTelemetria = modulo.querySelector(
    '[data-monitor-telemetria-contexto-nombre]'
  );
  const contextoTipoTelemetria = modulo.querySelector(
    '[data-monitor-telemetria-contexto-tipo]'
  );
  const contextoUnidadTelemetria = modulo.querySelector(
    '[data-monitor-telemetria-contexto-unidad]'
  );
  const contextoValorTelemetria = modulo.querySelector(
    '[data-monitor-telemetria-contexto-valor]'
  );
  const contextoFechaTelemetria = modulo.querySelector(
    '[data-monitor-telemetria-contexto-fecha]'
  );
  const resumenNombre = modulo.querySelector('[data-monitor-resumen-nombre]');
  const resumenScope = modulo.querySelector('[data-monitor-resumen-scope]');
  const resumenScopeDetalle = modulo.querySelector(
    '[data-monitor-resumen-scope-detalle]'
  );
  const resumenCadencia = modulo.querySelector('[data-monitor-resumen-cadencia]');
  const resumenCadenciaDetalle = modulo.querySelector(
    '[data-monitor-resumen-cadencia-detalle]'
  );
  const resumenObjetivo = modulo.querySelector('[data-monitor-resumen-objetivo]');
  const resumenObjetivoDetalle = modulo.querySelector(
    '[data-monitor-resumen-objetivo-detalle]'
  );
  const resumenAgenteTelemetriaDetalle = modulo.querySelector(
    '[data-monitor-resumen-agente-detalle]'
  );
  const resumenScopeCaja = modulo.querySelector('[data-monitor-scope-resumen]');
  const impactoFrecuencia = modulo.querySelector('[data-monitor-impacto-frecuencia]');
  const impactoCadencia = modulo.querySelector('[data-monitor-impacto-cadencia]');
  const impactoScope = modulo.querySelector('[data-monitor-impacto-scope]');
  const impactoScopeDetalle = modulo.querySelector(
    '[data-monitor-impacto-scope-detalle]'
  );
  const impactoDestino = modulo.querySelector('[data-monitor-impacto-destino]');
  const impactoDestinoDetalle = modulo.querySelector(
    '[data-monitor-impacto-destino-detalle]'
  );
  const alertasContenedor = modulo.querySelector('[data-monitor-alertas]');
  const alertasLista = modulo.querySelector('[data-monitor-alertas-lista]');
  const estadoAyuda = modulo.querySelector('[data-monitor-estado-ayuda]');
  const estadoResumen = modulo.querySelector('[data-monitor-estado-resumen]');
  const cambiosPendientes = modulo.querySelector('[data-monitor-cambios-pendientes]');
  const estadoTitulo = modulo.querySelector('[data-monitor-estado-titulo]');
  const accionesFormulario = modulo.querySelector('.acciones-formulario--sticky');
  const ayudaIntervalo = modulo.querySelector('[data-monitor-tiempo-ayuda="intervalo"]');
  const ayudaDesfase = modulo.querySelector('[data-monitor-tiempo-ayuda="desfase"]');
  const ayudaTimeout = modulo.querySelector('[data-monitor-tiempo-ayuda="timeout"]');
  const ayudaReintentos = modulo.querySelector('[data-monitor-reintentos-ayuda]');
  const ayudaPayload = modulo.querySelector('[data-monitor-payload-ayuda]');
  const ayudaTtl = modulo.querySelector('[data-monitor-ttl-ayuda]');
  const ayudaPuerto = modulo.querySelector('[data-monitor-puerto-ayuda]');
  const ayudaVigencia = modulo.querySelector('[data-monitor-vigencia-ayuda]');
  const botonesAbrirSelectorLogico = Array.from(
    modulo.querySelectorAll('[data-monitor-logico-abrir-selector]')
  );
  const tarjetaEntradaLogica = modulo.querySelector(
    '[data-monitor-logico-entrada-card]'
  );
  const entradaLogicaNombre = modulo.querySelector(
    '[data-monitor-logico-entrada-nombre]'
  );
  const entradaLogicaDetalle = modulo.querySelector(
    '[data-monitor-logico-entrada-detalle]'
  );
  const entradaLogicaContador = modulo.querySelector(
    '[data-monitor-logico-entrada-contador]'
  );
  const inputLogicoDependenciasJson = modulo.querySelector(
    '[data-monitor-logico-dependencias-json]'
  );
  const listaTraduccionLogica = modulo.querySelector(
    '[data-monitor-logico-traduccion-lista]'
  );
  const botonesInsertarTokenLogico = Array.from(
    modulo.querySelectorAll('[data-monitor-logico-insertar-token]')
  );
  const variableLogicaANombre = modulo.querySelector(
    '[data-monitor-logico-variable-a]'
  );
  const variableLogicaADetalle = modulo.querySelector(
    '[data-monitor-logico-variable-a-detalle]'
  );
  const expresionLogicaPreview = modulo.querySelector(
    '[data-monitor-logico-expresion-preview]'
  );
  const planLogico = modulo.querySelector('[data-monitor-logico-plan]');
  const planLogicoEstado = modulo.querySelector('[data-monitor-logico-plan-estado]');
  const planLogicoDependencia = modulo.querySelector(
    '[data-monitor-logico-plan-dependencia]'
  );
  const planLogicoDependenciaDetalle = modulo.querySelector(
    '[data-monitor-logico-plan-dependencia-detalle]'
  );
  const planLogicoVariableA = modulo.querySelector(
    '[data-monitor-logico-plan-variable-a]'
  );
  const planLogicoVariableADetalle = modulo.querySelector(
    '[data-monitor-logico-plan-variable-a-detalle]'
  );
  const planLogicoResultado = modulo.querySelector(
    '[data-monitor-logico-plan-resultado]'
  );
  const planLogicoResultadoDetalle = modulo.querySelector(
    '[data-monitor-logico-plan-resultado-detalle]'
  );
  const planLogicoRetardo = modulo.querySelector('[data-monitor-logico-plan-retardo]');
  const planLogicoRetardoDetalle = modulo.querySelector(
    '[data-monitor-logico-plan-retardo-detalle]'
  );
  const planLogicoImpacto = modulo.querySelector('[data-monitor-logico-plan-impacto]');
  const planLogicoAvisos = modulo.querySelector('[data-monitor-logico-plan-avisos]');
  const canvasLogico = modulo.querySelector('[data-monitor-logico-canvas]');
  const inputLayoutLogico = modulo.querySelector('[data-monitor-logico-layout]');
  const botonAbrirCanvasFull = modulo.querySelector('[data-monitor-logico-canvas-abrir-full]');
  const canvasLogicoEntrada = modulo.querySelector('[data-monitor-logico-canvas-entrada]');
  const canvasLogicoExpresion = modulo.querySelector('[data-monitor-logico-canvas-expresion]');
  const canvasLogicoCompilada = modulo.querySelector('[data-monitor-logico-canvas-compilada]');
  const canvasLogicoCompatibilidad = modulo.querySelector(
    '[data-monitor-logico-canvas-compatibilidad]'
  );
  const modalCanvasLogico = document.querySelector('[data-monitor-logico-canvas-modal]');
  const canvasFullLienzo = modalCanvasLogico?.querySelector('[data-monitor-logico-canvas-full-lienzo]');
  const canvasFullSvg = modalCanvasLogico?.querySelector('[data-monitor-logico-canvas-full-svg]');
  const canvasFullNodos = modalCanvasLogico?.querySelector('[data-monitor-logico-canvas-full-nodos]');
  const canvasFullStatus = modalCanvasLogico?.querySelector('[data-monitor-logico-grafo-status]');
  const canvasFullCompilacion = modalCanvasLogico?.querySelector('[data-monitor-logico-grafo-compilacion]');
  const botonesCanvasFullAdd = Array.from(
    modalCanvasLogico?.querySelectorAll('[data-monitor-logico-grafo-add]') || []
  );
  const botonCanvasFullConectar = modalCanvasLogico?.querySelector('[data-monitor-logico-grafo-conectar]');
  const botonCanvasFullDesconectar = modalCanvasLogico?.querySelector(
    '[data-monitor-logico-grafo-desconectar]'
  );
  const botonesCanvasFullBorrar = Array.from(
    modalCanvasLogico?.querySelectorAll(
      '[data-monitor-logico-grafo-borrar], [data-monitor-logico-grafo-borrar-inspector]'
    ) || []
  );
  const botonCanvasFullAplicar = modalCanvasLogico?.querySelector('[data-monitor-logico-grafo-aplicar]');
  const botonesCanvasFullZoom = Array.from(
    modalCanvasLogico?.querySelectorAll('[data-monitor-logico-grafo-zoom]') || []
  );
  const canvasFullSimulacionEntradas = modalCanvasLogico?.querySelector(
    '[data-monitor-logico-grafo-simulacion-entradas]'
  );
  const canvasFullSimulacionResultado = modalCanvasLogico?.querySelector(
    '[data-monitor-logico-grafo-simulacion-resultado]'
  );
  const canvasFullInspectorTitulo = modalCanvasLogico?.querySelector(
    '[data-monitor-logico-grafo-inspector-titulo]'
  );
  const canvasFullInspectorDetalle = modalCanvasLogico?.querySelector(
    '[data-monitor-logico-grafo-inspector-detalle]'
  );
  const canvasFullInspectorTipo = modalCanvasLogico?.querySelector(
    '[data-monitor-logico-grafo-inspector-tipo]'
  );
  const canvasFullInspectorConexiones = modalCanvasLogico?.querySelector(
    '[data-monitor-logico-grafo-inspector-conexiones]'
  );
  const canvasFullInspectorEstado = modalCanvasLogico?.querySelector(
    '[data-monitor-logico-grafo-inspector-estado]'
  );
  const impactoLogico = modulo.querySelector('[data-monitor-logico-impacto]');
  const impactoLogicoEstado = modulo.querySelector('[data-monitor-logico-impacto-estado]');
  const impactoLogicoTriggers = modulo.querySelector('[data-monitor-logico-impacto-triggers]');
  const impactoLogicoDescendientes = modulo.querySelector(
    '[data-monitor-logico-impacto-descendientes]'
  );
  const impactoLogicoDependencias = modulo.querySelector(
    '[data-monitor-logico-impacto-dependencias]'
  );
  const impactoLogicoDependenciasDetalle = modulo.querySelector(
    '[data-monitor-logico-impacto-dependencias-detalle]'
  );
  const impactoLogicoCambios = modulo.querySelector('[data-monitor-logico-impacto-cambios]');
  const impactoLogicoAvisos = modulo.querySelector('[data-monitor-logico-impacto-avisos]');
  const modalSelectorLogico = document.querySelector(
    '[data-monitor-logico-selector-modal]'
  );
  const contadoresHeroEntradasLogicas = Array.from(
    modulo.querySelectorAll('[data-monitor-hero-entradas-contador]')
  );
  const detallesHeroEntradasLogicas = Array.from(
    modulo.querySelectorAll('[data-monitor-hero-entradas-detalle]')
  );
  const enlacesIrEntradasLogicas = Array.from(
    modulo.querySelectorAll('[data-monitor-logico-ir-entradas]')
  );

  if (!selectorTenant || !selectorEmpresa || !selectorSitio) {
    return;
  }

  const opcionesEmpresa = Array.from(selectorEmpresa.querySelectorAll('option'))
    .map((opcion) => opcion.cloneNode(true));
  const opcionesSitio = Array.from(selectorSitio.querySelectorAll('option'))
    .map((opcion) => opcion.cloneNode(true));
  const empresaBloqueadaPorScope = selectorEmpresa.disabled;
  const sitioBloqueadoPorScope = selectorSitio.disabled;
  let estadoSucio = false;
  let claveAlertasMostrada = '';
  let renderInicialCompletado = false;
  let entradasLogicasSeleccionadas = [];
  let layoutCanvasLogico = null;
  let grafoCanvasFullBorrador = null;
  let nodoCanvasFullSeleccionado = null;
  let puertoCanvasFullOrigenConexion = null;
  let modoConectarCanvasFull = false;
  let modoDesconectarCanvasFull = false;
  let zoomCanvasFull = 1;
  const punterosZoomCanvasFull = new Map();
  let gestoZoomCanvasFull = null;
  let nodoCanvasFullArrastrado = null;
  let valoresSimuladosCanvasFull = {};
  let resultadoSimulacionCanvasFull = {
    valoresPorNodo: new Map(),
    salida: null,
    detalle: 'Sin simulación'
  };
  const anchoNodoCanvasFull = 230;
  const radioPuertoCanvasFull = 8;

  function normalizarNumero(valor) {
    const numero = Number.parseInt(String(valor ?? '').trim(), 10);
    return Number.isFinite(numero) ? numero : null;
  }

  function parsearEstadoInicialLogico(valor) {
    try {
      return JSON.parse(decodeURIComponent(String(valor || '{}')));
    } catch (_error) {
      return {};
    }
  }

  function pluralizar(valor, singular, plural) {
    return `${valor} ${valor === 1 ? singular : plural}`;
  }

  function formatearSegundos(segundos) {
    const formatoComun = window.portalDuraciones?.formatearSegundos?.(segundos);
    if (formatoComun) return formatoComun;

    if (!Number.isFinite(segundos) || segundos < 0) {
      return 'sin valor válido';
    }

    if (segundos < 60) {
      return pluralizar(segundos, 'segundo', 'segundos');
    }

    if (segundos < 3600) {
      const minutos = segundos / 60;
      return Number.isInteger(minutos)
        ? pluralizar(minutos, 'minuto', 'minutos')
        : `${minutos.toFixed(1).replace('.', ',')} min`;
    }

    if (segundos < 86400) {
      const horas = segundos / 3600;
      return Number.isInteger(horas)
        ? pluralizar(horas, 'hora', 'horas')
        : `${horas.toFixed(1).replace('.', ',')} h`;
    }

    const dias = segundos / 86400;
    return Number.isInteger(dias)
      ? pluralizar(dias, 'día', 'días')
      : `${dias.toFixed(1).replace('.', ',')} días`;
  }

  function formatearMilisegundos(ms) {
    if (!Number.isFinite(ms) || ms < 0) {
      return 'sin valor válido';
    }

    if (ms < 1000) {
      return pluralizar(ms, 'ms', 'ms');
    }

    const segundos = ms / 1000;
    return Number.isInteger(segundos)
      ? pluralizar(segundos, 'segundo', 'segundos')
      : `${segundos.toFixed(1).replace('.', ',')} s`;
  }

  function obtenerTipoActual() {
    return selectorTipo
      ? selectorTipo.value || tipoFijoFormulario || 'ping'
      : tipoFijoFormulario || 'ping';
  }

  function obtenerValorScope(selector, inputFijo) {
    return String(selector?.value || inputFijo?.value || '').trim();
  }

  function obtenerTextoScope(selector, inputFijo) {
    if (selector?.value) {
      return selector.options[selector.selectedIndex]?.text?.trim() || '';
    }

    return String(inputFijo?.dataset.scopeEtiqueta || '').trim();
  }

  function obtenerScopeActual() {
    const sitioId = obtenerValorScope(selectorSitio, inputSitioFijo);
    const pertenencia = selectorPertenencia
      ? selectorPertenencia.value || inputPertenenciaFija?.value || 'empresa'
      : (inputPertenenciaFija?.value || (sitioId ? 'sitio' : 'empresa'));
    const tenantTexto = obtenerTextoScope(selectorTenant, inputTenantFijo);
    const empresaTexto = obtenerTextoScope(selectorEmpresa, inputEmpresaFija);
    const sitioTexto = obtenerTextoScope(selectorSitio, inputSitioFijo);

    return {
      pertenencia,
      tenantId: obtenerValorScope(selectorTenant, inputTenantFijo),
      empresaId: obtenerValorScope(selectorEmpresa, inputEmpresaFija),
      sitioId,
      tenantTexto,
      empresaTexto,
      sitioTexto
    };
  }

  function construirDescripcionScope(scope) {
    if (!scope.tenantId) {
      return 'Selecciona tenant para completar el alcance.';
    }

    if (!scope.empresaId) {
      return `Tenant ${scope.tenantTexto} seleccionado. Falta concretar empresa.`;
    }

    if (scope.pertenencia !== 'sitio') {
      return `Monitor de empresa dentro de ${scope.empresaTexto} (${scope.tenantTexto}).`;
    }

    if (!scope.sitioId) {
      return `Monitor de sitio pendiente dentro de ${scope.empresaTexto}.`;
    }

    return `Monitor de sitio ${scope.sitioTexto} dentro de ${scope.empresaTexto}.`;
  }

  function actualizarAyudasTemporales() {
    const intervalo = normalizarNumero(inputIntervalo?.value);
    const desfase = normalizarNumero(inputDesfase?.value);
    const timeout = normalizarNumero(inputTimeout?.value);
    const reintentos = normalizarNumero(inputReintentos?.value);
    const payload = normalizarNumero(inputPayload?.value);
    const ttl = normalizarNumero(inputTtl?.value);
    const puerto = normalizarNumero(inputPuerto?.value);
    const vigencia = normalizarNumero(inputVigencia?.value);

    if (ayudaIntervalo) {
      ayudaIntervalo.textContent = Number.isFinite(intervalo)
        ? `${intervalo} s = ${formatearSegundos(intervalo)}.`
        : '';
    }

    if (ayudaDesfase) {
      ayudaDesfase.textContent = Number.isFinite(desfase)
        ? `${desfase} s = ${formatearSegundos(desfase)}.`
        : '';
    }

    if (ayudaTimeout) {
      ayudaTimeout.textContent = Number.isFinite(timeout)
        ? `${timeout} ms = ${formatearMilisegundos(timeout)}.`
        : '';
    }

    if (ayudaReintentos) {
      ayudaReintentos.textContent = Number.isFinite(reintentos)
        ? reintentos === 0
          ? 'Se hará un único intento por ejecución.'
          : `Se harán ${reintentos + 1} intentos como máximo contando el inicial.`
        : '';
    }

    if (ayudaPayload) {
      ayudaPayload.textContent = Number.isFinite(payload)
        ? payload <= 64
          ? 'Carga ligera, adecuada para salud básica.'
          : (payload > 1400
              ? 'Carga alta: puede ser útil para pruebas exigentes, pero genera más peso por ejecución.'
              : 'Carga intermedia, razonable para validación operativa.')
        : '';
    }

    if (ayudaTtl) {
      ayudaTtl.textContent = Number.isFinite(ttl)
        ? ttl <= 4
          ? 'TTL muy corto: úsalo solo si buscas limitar mucho el alcance de la prueba.'
          : 'TTL dentro de un rango operativo habitual.'
        : '';
    }

    if (resumenIcmpAvanzado) {
      const carga = Number.isFinite(payload) ? `${payload} B` : 'pendiente';
      const limiteSaltos = Number.isFinite(ttl) ? ttl : 'pendiente';
      resumenIcmpAvanzado.textContent = `Carga ${carga} · TTL ${limiteSaltos}`;
    }

    if (ayudaPuerto) {
      ayudaPuerto.textContent = Number.isFinite(puerto)
        ? `El monitor intentará abrir TCP contra el puerto ${puerto}.`
        : '';
    }

    if (ayudaVigencia) {
      ayudaVigencia.textContent = Number.isFinite(vigencia)
        ? vigencia === 0
          ? 'Solo se exigirá que el certificado siga siendo válido hoy.'
          : `Fallará si el certificado caduca antes de ${formatearSegundos(vigencia * 86400)}.`
        : '';
    }
  }

  function actualizarAyudaInterpretacionEstado() {
    if (!ayudaInterpretacionEstado) {
      return;
    }

    const interpretacion = String(
      selectorInterpretacionEstado?.value || 'normal'
    ).trim();

    ayudaInterpretacionEstado.textContent = interpretacion === 'invertida'
      ? 'Si el destino responde, el motor de supervisión abrirá un fallo operativo conservando el resultado técnico real.'
      : 'Si la prueba responde correctamente, el monitor quedará disponible.';
  }

  function recopilarAlertas() {
    const alertas = [];
    const tipo = obtenerTipoActual();
    const scope = obtenerScopeActual();
    const intervalo = normalizarNumero(inputIntervalo?.value);
    const timeout = normalizarNumero(inputTimeout?.value);
    const reintentos = normalizarNumero(inputReintentos?.value);
    const payload = normalizarNumero(inputPayload?.value);
    const ttl = normalizarNumero(inputTtl?.value);
    const puerto = normalizarNumero(inputPuerto?.value);
    const vigencia = normalizarNumero(inputVigencia?.value);
    const host = String(inputHost?.value || '').trim();
    const expresionLogica = String(inputLogicoExpresion?.value || '').trim();
    const mensajeFalloLogico = String(inputLogicoMensajeFallo?.value || '').trim();
    const tlsActivo = Boolean(selectorUsarTls?.checked);

    if (!scope.tenantId) {
      alertas.push('Falta seleccionar un tenant.');
    }

    if (!scope.empresaId) {
      alertas.push('Falta seleccionar una empresa.');
    }

    if (scope.pertenencia === 'sitio' && !scope.sitioId) {
      alertas.push('La pertenencia es de sitio, pero todavía no has elegido un sitio.');
    }

    if (['ping', 'tcp'].includes(tipo) && !host) {
      alertas.push('Falta indicar el host o la IP de destino.');
    }

    if (tipo === 'telemetria') {
      if (!selectorAgenteTelemetria?.value) {
        alertas.push('Falta seleccionar el agente que declara la telemetría.');
      }
      if (
        selectorTipoFuenteTelemetria?.value === 'regla_derivacion'
          ? !selectorReglaTelemetria?.value
          : !selectorSenalTelemetria?.value
      ) {
        alertas.push('Falta seleccionar la señal o la regla de interpretación que quieres vigilar.');
      }
      const fuente = obtenerFuenteTelemetriaSeleccionada();
      const senal = extraerSenalFuenteTelemetria(fuente);
      if (
        selectorTipoFuenteTelemetria?.value !== 'regla_derivacion' &&
        senal?.tipoDato === 'numero' &&
        !String(inputMinimoTelemetria?.value || '').trim() &&
        !String(inputMaximoTelemetria?.value || '').trim()
      ) {
        alertas.push('La tolerancia numérica necesita un mínimo, un máximo o ambos.');
      }
    }

    if (Number.isFinite(intervalo) && intervalo < 30) {
      alertas.push('El intervalo es muy bajo y puede generar bastante carga y ruido operativo.');
    }

    if (
      Number.isFinite(intervalo) &&
      Number.isFinite(timeout) &&
      timeout >= intervalo * 1000
    ) {
      alertas.push('El timeout es igual o mayor que el intervalo: el scheduler podría solaparse con facilidad.');
    }

    if (Number.isFinite(reintentos) && reintentos >= 5) {
      alertas.push('El número de reintentos es alto: el veredicto final puede tardar bastante en llegar.');
    }

    if (tipo === 'ping' && Number.isFinite(payload) && payload > 1400) {
      alertas.push('El payload ICMP es alto para una comprobación rutinaria.');
    }

    if (tipo === 'ping' && Number.isFinite(ttl) && ttl <= 3) {
      alertas.push('El TTL ICMP es muy corto y podría cortar rutas legítimas enseguida.');
    }

    if (
      tipo === 'tcp' &&
      tlsActivo &&
      Number.isFinite(puerto) &&
      ![443, 465, 587, 993, 995, 8443].includes(puerto)
    ) {
      alertas.push('TLS está activo sobre un puerto poco habitual: revisa que sea intencional.');
    }

    if (tipo === 'tcp' && tlsActivo && Number.isFinite(vigencia) && vigencia > 365) {
      alertas.push('La vigencia mínima del certificado es muy exigente y puede provocar fallos tempranos.');
    }

    if (tipo === 'booleano') {
      if (entradasLogicasSeleccionadas.length === 0) {
        alertas.push('Añade al menos un monitor de entrada para completar la regla.');
      }

      if (
        Number.isFinite(monitorActualIdFormulario) &&
        entradasLogicasSeleccionadas.some((entrada) => entrada.monitorId === monitorActualIdFormulario)
      ) {
        alertas.push('Un monitor lógico no puede usar como entrada el propio monitor que estás editando.');
      }

      if (!expresionLogica) {
        alertas.push('Falta conectar entradas hasta la salida en el estudio visual.');
      }

      if (!mensajeFalloLogico) {
        alertas.push('Falta indicar el mensaje humano para la salida indisponible.');
      }
    }

    return alertas;
  }

  function actualizarAlertas() {
    const alertas = recopilarAlertas();
    const claveActual = alertas.join('|');
    const habiaAlertasAntes = Boolean(claveAlertasMostrada);

    if (alertasContenedor && alertasLista) {
      alertasLista.innerHTML = alertas
        .map((alerta) => `<li>${escapeHtml(alerta)}</li>`)
        .join('');
      alertasContenedor.hidden = alertas.length === 0;
    }

    if (
      renderInicialCompletado &&
      estadoSucio &&
      alertas.length > 0 &&
      claveActual &&
      !habiaAlertasAntes
    ) {
      window.portalToast?.show?.({
        tipo: 'advertencia',
        titulo: 'Monitor',
        cuerpo: 'Hay ajustes que conviene revisar antes de guardar.'
      });
    }

    claveAlertasMostrada = claveActual;
    return alertas;
  }

  function actualizarResumenVivo() {
    const tipo = obtenerTipoActual();
    const scope = obtenerScopeActual();
    const nombre = String(inputNombre?.value || '').trim();
    const host = String(inputHost?.value || '').trim();
    const intervalo = normalizarNumero(inputIntervalo?.value);
    const timeout = normalizarNumero(inputTimeout?.value);
    const reintentos = normalizarNumero(inputReintentos?.value);
    const puerto = normalizarNumero(inputPuerto?.value);
    const tlsActivo = Boolean(selectorUsarTls?.checked);
    const expresionLogica = String(inputLogicoExpresion?.value || '').trim();
    const estadoInicialLogico = String(
      selectorLogicoEstadoInicial?.value || 'disponible'
    ).trim();
    const retardoLogico = normalizarNumero(inputLogicoRetardo?.value);
    const activo = String(selectorActivo?.value || '1') !== '0';
    const descripcionScope = construirDescripcionScope(scope);
    const ejecucionesHora = Number.isFinite(intervalo) && intervalo > 0
      ? Math.max(1, Math.round(3600 / intervalo))
      : null;

    if (resumenNombre) {
      resumenNombre.textContent = nombre || 'Sin nombre todavía';
    }

    actualizarPreviewExpresionLogica(expresionLogica);

    if (resumenScope) {
      resumenScope.textContent = scope.pertenencia === 'sitio' ? 'Sitio' : 'Empresa';
    }

    if (resumenScopeDetalle) {
      resumenScopeDetalle.textContent = scope.pertenencia === 'sitio'
        ? `Sitio · ${scope.sitioTexto || 'Pendiente'}`
        : `Empresa · ${scope.empresaTexto || 'Pendiente'}`;
    }

    if (resumenCadencia) {
      resumenCadencia.textContent = Number.isFinite(intervalo)
        ? formatearSegundos(intervalo)
        : 'Pendiente';
    }

    if (resumenCadenciaDetalle) {
      const partes = [];
      if (Number.isFinite(intervalo)) {
        partes.push(`Equivale a ${formatearSegundos(intervalo)}`);
      }
      if (tipo !== 'booleano' && Number.isFinite(timeout)) {
        partes.push(`timeout ${formatearMilisegundos(timeout)}`);
      }
      if (tipo !== 'booleano' && Number.isFinite(reintentos)) {
        partes.push(`${reintentos} ${reintentos === 1 ? 'reintento' : 'reintentos'}`);
      }
      if (tipo === 'booleano') {
        partes.push(`salida inicial ${estadoInicialLogico}`);
        partes.push(
          Number.isFinite(retardoLogico) && retardoLogico > 0
            ? `retardo ${formatearSegundos(retardoLogico)}`
            : 'sin retardo'
        );
      }
      resumenCadenciaDetalle.textContent = partes.length > 0
        ? `${partes.join(' · ')}.`
        : 'El motor de supervisión repetirá la comprobación con esta periodicidad.';
    }

    const fuenteTelemetria = obtenerFuenteTelemetriaSeleccionada();
    const senalTelemetria = extraerSenalFuenteTelemetria(fuenteTelemetria);
    const etiquetaFuenteTelemetria = fuenteTelemetria
      ? (fuenteTelemetria.nombre || senalTelemetria?.nombreHumano ||
          senalTelemetria?.codigoSenal || 'Fuente seleccionada')
      : 'Fuente pendiente';

    if (resumenObjetivo) {
      resumenObjetivo.textContent = tipo === 'booleano'
        ? (
            entradasLogicasSeleccionadas.length === 1
              ? '1 entrada'
              : entradasLogicasSeleccionadas.length === 0
                ? 'Sin entradas'
                : `${entradasLogicasSeleccionadas.length} entradas`
          )
        : tipo === 'telemetria'
          ? etiquetaFuenteTelemetria
          : (host || nombre || 'Pendiente');
    }

    if (resumenObjetivoDetalle) {
      if (tipo === 'booleano') {
        const detalleEntradas = entradasLogicasSeleccionadas
          .map((entrada) => `${entrada.variable}: ${resolverEtiquetaEntradaLogica(entrada)}`)
          .join(' · ');
        resumenObjetivoDetalle.textContent = entradasLogicasSeleccionadas.length > 0
          ? `Regla: ${expresionLogica || 'pendiente'} · ${detalleEntradas}`
          : 'Añade monitores de entrada para definir la regla lógica.';
      } else if (tipo === 'telemetria') {
        resumenObjetivoDetalle.textContent = senalTelemetria
          ? `${senalTelemetria.tipoDato}${senalTelemetria.unidad ? ` · ${senalTelemetria.unidad}` : ''} · salida operativa estable.`
          : 'Selecciona una señal o una regla de interpretación existente.';
      } else if (tipo === 'tcp') {
        const destinoTcp = [];
        if (Number.isFinite(puerto)) {
          destinoTcp.push(`puerto ${puerto}`);
        }
        if (tlsActivo) {
          destinoTcp.push('TLS exigido');
        }
        resumenObjetivoDetalle.textContent = destinoTcp.length > 0
          ? `Destino TCP con ${destinoTcp.join(' · ')}.`
          : 'Destino TCP con puerto y TLS opcional.';
      } else {
        resumenObjetivoDetalle.textContent = 'Destino ICMP con payload y TTL configurables.';
      }
    }

    if (tipo === 'telemetria') {
      const agenteSeleccionado = selectorAgenteTelemetria?.options?.[
        selectorAgenteTelemetria.selectedIndex
      ] || null;
      const etiquetaAgente = String(agenteSeleccionado?.textContent || '')
        .trim() || 'Agente pendiente';
      const observacion = senalTelemetria?.ultimaObservacion || null;

      if (resumenScope) {
        resumenScope.textContent = etiquetaAgente;
      }
      if (resumenAgenteTelemetriaDetalle) {
        const valor = formatearValorTelemetria(
          observacion?.valor,
          senalTelemetria?.unidad || ''
        );
        const recibida = observacion?.recibidoEnUtc
          ? new Date(observacion.recibidoEnUtc).toLocaleString()
          : '';
        resumenAgenteTelemetriaDetalle.textContent = recibida
          ? `Última lectura: ${valor} · recibida ${recibida}`
          : `Última lectura: ${valor}`;
      }
    }

    if (tipo === 'booleano') {
      actualizarRelacionHeroEntradasLogicas();
    }

    if (resumenScopeCaja) {
      resumenScopeCaja.textContent = descripcionScope;
    }

    if (resumenAlcancePlegable) {
      const nombres = [scope.tenantTexto, scope.empresaTexto];
      if (scope.pertenencia === 'sitio') nombres.push(scope.sitioTexto);
      resumenAlcancePlegable.textContent =
        `${scope.pertenencia === 'sitio' ? 'Sitio' : 'Empresa'} · ` +
        nombres.filter(Boolean).join(' / ');
    }

    if (impactoFrecuencia) {
      impactoFrecuencia.textContent = Number.isFinite(ejecucionesHora)
        ? `Cada ${formatearSegundos(intervalo)}`
        : 'Se calculará al completar el intervalo.';
    }

    if (impactoCadencia) {
      impactoCadencia.textContent = Number.isFinite(intervalo)
        ? `Cadencia base: ${formatearSegundos(intervalo)}${activo ? '' : '. El monitor seguirá inactivo al guardarlo.'}`
        : 'La periodicidad real se ajustará con tu intervalo y desfase.';
    }

    if (impactoScope) {
      impactoScope.textContent = scope.empresaId
        ? (scope.pertenencia === 'sitio'
            ? (scope.sitioTexto || 'Sitio pendiente')
            : (scope.empresaTexto || 'Empresa pendiente'))
        : 'Todavía incompleto';
    }

    if (impactoScopeDetalle) {
      impactoScopeDetalle.textContent = descripcionScope;
    }

    if (impactoDestino) {
      impactoDestino.textContent = tipo === 'booleano'
        ? `${entradasLogicasSeleccionadas.length} ${entradasLogicasSeleccionadas.length === 1 ? 'entrada' : 'entradas'} · ${expresionLogica || 'regla pendiente'}`
        : tipo === 'telemetria'
          ? etiquetaFuenteTelemetria
          : (host || 'Pendiente');
    }

    if (impactoDestinoDetalle) {
      if (tipo === 'booleano') {
        impactoDestinoDetalle.textContent = entradasLogicasSeleccionadas.length > 0
          ? entradasLogicasSeleccionadas
              .map((entrada) => `${entrada.variable}: ${resolverEtiquetaEntradaLogica(entrada)}`)
              .join(' · ')
          : 'Añade al menos una entrada para definir la regla.';
      } else if (tipo === 'telemetria') {
        impactoDestinoDetalle.textContent = senalTelemetria
          ? `Fuente ${senalTelemetria.codigoSenal || senalTelemetria.id}; alertas y automatizaciones reaccionarán solo a cambios estables.`
          : 'Se mostrará la fuente de telemetría efectiva.';
      } else if (tipo === 'tcp') {
        impactoDestinoDetalle.textContent = Number.isFinite(puerto)
          ? `Conectará por TCP al puerto ${puerto}${tlsActivo ? ' verificando TLS' : ''}.`
          : 'Se mostrará el objetivo real del monitor.';
      } else {
        impactoDestinoDetalle.textContent = 'Comprobación ICMP simple contra el objetivo indicado.';
      }
    }

    if (estadoAyuda) {
      estadoAyuda.textContent = activo
        ? 'El motor de supervisión podrá planificarlo al publicar el catálogo.'
        : 'Queda guardado sin ejecución operativa.';
    }
  }

  function actualizarEstadoFormulario() {
    const alertas = actualizarAlertas();
    const tipo = obtenerTipoActual();
    const activo = String(selectorActivo?.value || '1') !== '0';

    if (!estadoResumen || !estadoTitulo || !accionesFormulario) {
      return;
    }

    if (alertas.length > 0) {
      accionesFormulario.dataset.monitorEstado = 'error';
      estadoTitulo.textContent = 'Revisa la definición';
      estadoResumen.textContent = `Hay ${alertas.length} punto${alertas.length === 1 ? '' : 's'} a revisar antes de guardar.`;
      estadoResumen.hidden = false;
      return;
    }

    if (estadoSucio) {
      accionesFormulario.dataset.monitorEstado = 'pendiente';
      estadoTitulo.textContent = 'Cambios sin guardar';
      estadoResumen.textContent = `Cambios pendientes en identidad, alcance y configuración ${tipo.toUpperCase()}.`;
      estadoResumen.hidden = false;
      return;
    }

    accionesFormulario.dataset.monitorEstado = 'coherente';
    estadoTitulo.textContent = activo
      ? 'Edición coherente'
      : 'Edición coherente · inactiva';
    estadoResumen.textContent = '';
    estadoResumen.hidden = true;
  }

  function marcarFormularioComoSucio() {
    estadoSucio = true;

    if (cambiosPendientes) actualizarEstadoFormulario();
  }

  function refrescarVistaFormulario() {
    actualizarAyudasTemporales();
    actualizarTelemetriaFormulario();
    actualizarResumenVivo();
    actualizarPlanEvaluacionLogica();
    actualizarImpactoEdicionLogica();
    actualizarTextoCanvasLogico();
    actualizarEstadoFormulario();
  }

  function parsearFuenteTelemetria(opcion) {
    const valor = String(opcion?.dataset?.fuente || '').trim();
    if (!valor) {
      return null;
    }
    try {
      return JSON.parse(decodeURIComponent(valor));
    } catch (_errorCodificado) {
      try {
        return JSON.parse(valor);
      } catch (_errorPlano) {
        return null;
      }
    }
  }

  function obtenerFuenteTelemetriaSeleccionada() {
    const usaRegla = selectorTipoFuenteTelemetria?.value === 'regla_derivacion';
    const selector = usaRegla ? selectorReglaTelemetria : selectorSenalTelemetria;
    const opcion = selector?.options?.[selector.selectedIndex] || null;
    const fuente = parsearFuenteTelemetria(opcion);
    return usaRegla && fuente ? { ...fuente, senal: fuente.senal || null } : fuente;
  }

  function extraerSenalFuenteTelemetria(fuente) {
    return selectorTipoFuenteTelemetria?.value === 'regla_derivacion'
      ? fuente?.senal || null
      : fuente;
  }

  function formatearValorTelemetria(valor, unidad = '') {
    if (valor === null || valor === undefined || valor === '') {
      return 'sin dato';
    }
    const texto = typeof valor === 'boolean'
      ? (valor ? 'verdadero' : 'falso')
      : String(valor);
    return unidad ? `${texto} ${unidad}` : texto;
  }

  function actualizarContextoTelemetria(fuente, senal) {
    const observacion = senal?.ultimaObservacion || null;
    if (contextoNombreTelemetria) {
      contextoNombreTelemetria.textContent = fuente
        ? (fuente.nombre || senal?.nombreHumano || senal?.codigoSenal || 'Fuente seleccionada')
        : 'Selecciona una fuente';
    }
    if (contextoTipoTelemetria) {
      contextoTipoTelemetria.textContent = `Tipo: ${senal?.tipoDato || 'sin seleccionar'}`;
    }
    if (contextoUnidadTelemetria) {
      contextoUnidadTelemetria.textContent = `Unidad: ${senal?.unidad || 'sin unidad'}`;
    }
    if (contextoValorTelemetria) {
      contextoValorTelemetria.textContent = `Última observación: ${formatearValorTelemetria(
        observacion?.valor,
        senal?.unidad || ''
      )}`;
    }
    if (contextoFechaTelemetria) {
      contextoFechaTelemetria.textContent = observacion?.recibidoEnUtc
        ? `Recibida por Sentinelia: ${new Date(observacion.recibidoEnUtc).toLocaleString()}. Contexto no editable.`
        : 'Todavía no existe una observación vigente. El monitor comenzará como desconocido.';
    }
  }

  function actualizarTelemetriaFormulario() {
    if (!selectorAgenteTelemetria) {
      return;
    }
    const activo = obtenerTipoActual() === 'telemetria';
    const usaRegla = selectorTipoFuenteTelemetria?.value === 'regla_derivacion';
    const fuente = obtenerFuenteTelemetriaSeleccionada();
    const senal = extraerSenalFuenteTelemetria(fuente);
    const tipoDato = String(senal?.tipoDato || '').trim().toLowerCase();
    const esNumero = tipoDato === 'numero';
    const esBooleano = tipoDato === 'booleano';
    const usaCondicionDirecta = activo && !usaRegla;

    selectorAgenteTelemetria.disabled = !activo;
    selectorAgenteTelemetria.required = activo;
    selectorTipoFuenteTelemetria.disabled = !activo;
    selectorTipoFuenteTelemetria.required = activo;
    bloqueFuenteDirectaTelemetria.hidden = !activo || usaRegla;
    bloqueFuenteReglaTelemetria.hidden = !activo || !usaRegla;
    selectorSenalTelemetria.disabled = !usaCondicionDirecta;
    selectorSenalTelemetria.required = usaCondicionDirecta;
    selectorReglaTelemetria.disabled = !activo || !usaRegla;
    selectorReglaTelemetria.required = activo && usaRegla;

    bloqueCondicionDirectaTelemetria.hidden = !usaCondicionDirecta || !senal;
    bloqueCondicionNumericaTelemetria.hidden = !usaCondicionDirecta || !esNumero;
    bloqueCondicionValorTelemetria.hidden = !usaCondicionDirecta || esNumero || !senal;
    inputMinimoTelemetria.disabled = !usaCondicionDirecta || !esNumero;
    inputMaximoTelemetria.disabled = !usaCondicionDirecta || !esNumero;
    selectorOperadorTelemetria.disabled = !usaCondicionDirecta || esNumero || esBooleano;
    bloqueOperadorTelemetria.hidden = esBooleano;
    bloqueValorTextoTelemetria.hidden = esBooleano;
    bloqueValorBooleanoTelemetria.hidden = !esBooleano;
    inputValorTextoTelemetria.disabled = !usaCondicionDirecta || esNumero || esBooleano;
    inputValorTextoTelemetria.required = usaCondicionDirecta && !esNumero && !esBooleano;
    selectorValorBooleanoTelemetria.disabled = !usaCondicionDirecta || !esBooleano;
    selectorValorBooleanoTelemetria.required = usaCondicionDirecta && esBooleano;

    if (inputTipoDatoTelemetria) {
      inputTipoDatoTelemetria.value = tipoDato;
    }
    if (inputUnidadTelemetria) {
      inputUnidadTelemetria.value = senal?.unidad || '';
    }
    actualizarContextoTelemetria(fuente, senal);
  }

  function crearOpcionFuenteTelemetria(fuente, tipo) {
    const opcion = document.createElement('option');
    opcion.value = String(fuente.id);
    opcion.dataset.fuente = JSON.stringify(fuente);
    if (tipo === 'regla') {
      opcion.textContent = `${fuente.nombre} (#${fuente.id}) · ${fuente.estado}`;
    } else {
      const nombre = fuente.nombreHumano || fuente.codigoSenal || `Señal #${fuente.id}`;
      opcion.textContent = `${nombre} · ${fuente.tipoDato}${fuente.unidad ? ` · ${fuente.unidad}` : ''}`;
    }
    return opcion;
  }

  function reemplazarFuentesTelemetria(datos) {
    const seleccionSenal = selectorSenalTelemetria?.value || '';
    const seleccionRegla = selectorReglaTelemetria?.value || '';
    if (selectorSenalTelemetria) {
      selectorSenalTelemetria.replaceChildren(new Option(
        'Selecciona una señal',
        ''
      ));
      for (const senal of datos?.senales || []) {
        selectorSenalTelemetria.appendChild(
          crearOpcionFuenteTelemetria(senal, 'senal')
        );
      }
      selectorSenalTelemetria.value = Array.from(selectorSenalTelemetria.options)
        .some((opcion) => opcion.value === seleccionSenal)
        ? seleccionSenal
        : '';
    }
    if (selectorReglaTelemetria) {
      selectorReglaTelemetria.replaceChildren(new Option(
        'Selecciona una regla de interpretación',
        ''
      ));
      for (const regla of datos?.reglas || []) {
        selectorReglaTelemetria.appendChild(
          crearOpcionFuenteTelemetria(regla, 'regla')
        );
      }
      selectorReglaTelemetria.value = Array.from(selectorReglaTelemetria.options)
        .some((opcion) => opcion.value === seleccionRegla)
        ? seleccionRegla
        : '';
    }
  }

  async function cargarFuentesTelemetria() {
    const agenteId = String(selectorAgenteTelemetria?.value || '').trim();
    reemplazarFuentesTelemetria({ senales: [], reglas: [] });
    if (!agenteId || !urlFuentesTelemetria) {
      actualizarTelemetriaFormulario();
      return;
    }
    const url = new URL(urlFuentesTelemetria, window.location.origin);
    url.searchParams.set('agente_id', agenteId);
    try {
      const respuesta = await fetch(url, {
        headers: { Accept: 'application/json' }
      });
      const datos = await respuesta.json();
      if (!respuesta.ok) {
        throw new Error(datos?.error || 'No se pudieron cargar las fuentes.');
      }
      reemplazarFuentesTelemetria(datos);
      actualizarTelemetriaFormulario();
      refrescarVistaFormulario();
    } catch (error) {
      window.portalToast?.show?.({
        tipo: 'error',
        titulo: 'Fuentes de telemetría',
        cuerpo: error.message
      });
    }
  }

  function escapeHtml(valor) {
    return String(valor)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function obtenerVariablePorIndice(indice) {
    return String.fromCharCode(65 + indice);
  }

  function normalizarEntradaLogica(entrada, indice = 0) {
    const variable = String(
      entrada?.variable || obtenerVariablePorIndice(indice)
    ).trim().toUpperCase();
    const monitorId = normalizarNumero(
      entrada?.monitorId ?? entrada?.monitor_id ?? entrada?.id
    );

    if (!/^[A-Z]$/.test(variable) || !Number.isFinite(monitorId) || monitorId <= 0) {
      return null;
    }

    const monitor = entrada?.monitor && typeof entrada.monitor === 'object'
      ? entrada.monitor
      : null;

    return {
      variable,
      fuente: 'monitor',
      monitorId,
      etiqueta: String(
        entrada?.etiqueta ||
          entrada?.nombre ||
          monitor?.nombre ||
          `Monitor #${monitorId}`
      ).trim(),
      monitor
    };
  }

  function cargarEntradasLogicasIniciales() {
    const entradas = [];
    const texto = String(inputLogicoDependenciasJson?.value || '').trim();

    if (texto) {
      try {
        const dependencias = JSON.parse(texto);
        if (Array.isArray(dependencias)) {
          for (const [indice, dependencia] of dependencias.entries()) {
            const entrada = normalizarEntradaLogica(dependencia, indice);
            if (entrada) {
              entradas.push(entrada);
            }
          }
        }
      } catch (_error) {
        // Si el JSON viene corrupto, caemos al campo legacy para no bloquear la UI.
      }
    }

    if (entradas.length === 0) {
      const monitorIdLegacy = normalizarNumero(inputLogicoDependencia?.value);
      if (Number.isFinite(monitorIdLegacy) && monitorIdLegacy > 0) {
        entradas.push({
          variable: 'A',
          fuente: 'monitor',
          monitorId: monitorIdLegacy,
          etiqueta: `Monitor #${monitorIdLegacy}`,
          monitor: null
        });
      }
    }

    return entradas.sort((a, b) => a.variable.localeCompare(b.variable));
  }

  function normalizarDependenciasInicialesLogicas() {
    const texto = String(estadoInicialLogicoFormulario?.dependencias || '').trim();

    if (texto) {
      try {
        const dependencias = JSON.parse(texto);
        if (Array.isArray(dependencias)) {
          return dependencias
            .map((dependencia, indice) => normalizarEntradaLogica(dependencia, indice))
            .filter(Boolean)
            .sort((a, b) => a.variable.localeCompare(b.variable));
        }
      } catch (_error) {
        // Compatibilidad con monitores previos a dependencias_logicas.
      }
    }

    const monitorId = normalizarNumero(estadoInicialLogicoFormulario?.dependenciaMonitorId);
    return Number.isFinite(monitorId) && monitorId > 0
      ? [
          {
            variable: 'A',
            fuente: 'monitor',
            monitorId,
            etiqueta: `Monitor #${monitorId}`,
            monitor: null
          }
        ]
      : [];
  }

  function obtenerEntradaLogica(variable) {
    return entradasLogicasSeleccionadas.find(
      (entrada) => entrada.variable === variable
    ) || null;
  }

  function obtenerSiguienteVariableLogica() {
    const usadas = new Set(entradasLogicasSeleccionadas.map((entrada) => entrada.variable));
    for (let indice = 0; indice < 26; indice += 1) {
      const variable = obtenerVariablePorIndice(indice);
      if (!usadas.has(variable)) {
        return variable;
      }
    }
    return null;
  }

  function sincronizarEntradasLogicas() {
    entradasLogicasSeleccionadas = entradasLogicasSeleccionadas
      .map((entrada, indice) => normalizarEntradaLogica(entrada, indice))
      .filter(Boolean)
      .sort((a, b) => a.variable.localeCompare(b.variable));

    const entradaA = obtenerEntradaLogica('A') || entradasLogicasSeleccionadas[0] || null;
    if (inputLogicoDependencia) {
      inputLogicoDependencia.value = entradaA ? String(entradaA.monitorId) : '';
    }

    if (inputLogicoDependenciasJson) {
      inputLogicoDependenciasJson.value = JSON.stringify(
        entradasLogicasSeleccionadas.map((entrada) => ({
          variable: entrada.variable,
          fuente: 'monitor',
          monitorId: entrada.monitorId,
          etiqueta: entrada.etiqueta
        }))
      );
    }
  }

  function resolverEtiquetaEntradaLogica(entrada) {
    if (!entrada) {
      return 'Ningún monitor seleccionado';
    }

    return entrada.monitor?.nombre || entrada.etiqueta || `Monitor #${entrada.monitorId}`;
  }

  function resolverDetalleEntradaLogica(entrada) {
    if (!entrada) {
      return 'Elige un monitor dentro de tu alcance. Si está disponible, esta entrada se considera correcta; si no, se considera en fallo.';
    }

    if (entrada.monitor) {
      const partes = [
        entrada.monitor.tipo ? String(entrada.monitor.tipo).toUpperCase() : null,
        entrada.monitor.alcanceDescripcion || entrada.monitor.empresaNombre || null
      ].filter(Boolean);

      return `${partes.join(' · ') || 'Monitor visible'} se usa como entrada ${entrada.variable}. Disponible equivale a correcto; indisponible equivale a fallo.`;
    }

    return `Monitor #${entrada.monitorId} se usará como entrada ${entrada.variable}. Confirmaremos que sigue dentro de tu alcance al guardar.`;
  }

  function resolverEtiquetaMonitorLogico() {
    return resolverEtiquetaEntradaLogica(obtenerEntradaLogica('A'));
  }

  function resolverDetalleMonitorLogico() {
    return resolverDetalleEntradaLogica(obtenerEntradaLogica('A'));
  }

  function renderizarTraduccionLogica() {
    if (!listaTraduccionLogica) {
      return;
    }

    const filas = entradasLogicasSeleccionadas.map((entrada) => `
      <div>
        <dt>${escapeHtml(entrada.variable)}</dt>
        <dd>
          <span class="monitor-logico-traduccion__contenido">
            <strong>${escapeHtml(resolverEtiquetaEntradaLogica(entrada))}</strong>
            <span>${escapeHtml(resolverDetalleEntradaLogica(entrada))}</span>
          </span>
          <button
            type="button"
            class="btn btn-outline-danger btn-sm"
            data-monitor-logico-quitar-entrada="${escapeHtml(entrada.variable)}"
          >
            Quitar
          </button>
        </dd>
      </div>
    `);
    const siguiente = obtenerSiguienteVariableLogica();

    if (filas.length === 0) {
      filas.push(`
        <div class="monitor-logico-traduccion__fila--reservada">
          <dt>A</dt>
          <dd><strong>Sin monitor seleccionado</strong><span>Añade una entrada para activar la primera letra de la regla.</span></dd>
        </div>
      `);
    }

    if (siguiente && filas.length < 4) {
      filas.push(`
        <div class="monitor-logico-traduccion__fila--reservada">
          <dt>${escapeHtml(siguiente)}</dt>
          <dd><strong>Siguiente entrada</strong><span>Se asignará automáticamente al añadir otro monitor.</span></dd>
        </div>
      `);
    }

    listaTraduccionLogica.innerHTML = filas.join('');
  }

  function actualizarBotonesVariablesLogicas() {
    const variablesActivas = new Set(
      entradasLogicasSeleccionadas.map((entrada) => entrada.variable)
    );
    const esLogico = obtenerTipoActual() === 'booleano';

    for (const boton of botonesInsertarTokenLogico) {
      const variable = boton.dataset.monitorLogicoVariableToken;
      if (!variable) {
        continue;
      }

      const activa = variablesActivas.has(variable);
      boton.disabled = !esLogico || !activa;
      boton.classList.toggle('btn-outline-primary', activa);
      boton.classList.toggle('btn-outline-secondary', !activa);
      boton.title = activa
        ? `Insertar variable ${variable}`
        : `Añade una entrada ${variable} desde el selector para activar esta variable.`;
    }
  }

  function actualizarTarjetaEntradaLogica() {
    sincronizarEntradasLogicas();

    const totalEntradas = entradasLogicasSeleccionadas.length;
    const entradaA = obtenerEntradaLogica('A') || entradasLogicasSeleccionadas[0] || null;
    const etiqueta = totalEntradas > 1
      ? `${totalEntradas} entradas conectadas`
      : resolverEtiquetaEntradaLogica(entradaA);
    const detalle = totalEntradas > 1
      ? entradasLogicasSeleccionadas
          .map((entrada) => `${entrada.variable}: ${resolverEtiquetaEntradaLogica(entrada)}`)
          .join(' · ')
      : resolverDetalleEntradaLogica(entradaA);

    if (entradaLogicaContador) {
      entradaLogicaContador.textContent =
        totalEntradas === 1 ? '1 entrada lógica' : `${totalEntradas} entradas lógicas`;
    }

    if (entradaLogicaNombre) {
      entradaLogicaNombre.textContent = etiqueta;
    }

    if (entradaLogicaDetalle) {
      entradaLogicaDetalle.textContent = detalle;
    }

    if (variableLogicaANombre) {
      variableLogicaANombre.textContent = resolverEtiquetaEntradaLogica(entradaA);
    }

    if (variableLogicaADetalle) {
      variableLogicaADetalle.textContent = entradaA
        ? resolverDetalleEntradaLogica(entradaA)
        : 'Añade un monitor para activar esta entrada.';
    }

    if (tarjetaEntradaLogica) {
      tarjetaEntradaLogica.classList.toggle(
        'monitor-logico-entrada--seleccionada',
        totalEntradas > 0
      );
    }

    actualizarRelacionHeroEntradasLogicas();

    renderizarTraduccionLogica();
    actualizarBotonesVariablesLogicas();
  }

  function actualizarRelacionHeroEntradasLogicas() {
    const totalEntradas = entradasLogicasSeleccionadas.length;
    const detalleEntradas = entradasLogicasSeleccionadas
      .map((entrada) => `${entrada.variable}: ${resolverEtiquetaEntradaLogica(entrada)}`)
      .join(' · ');
    const detalle = totalEntradas > 0
      ? `Regla: ${String(inputLogicoExpresion?.value || '').trim() || 'pendiente'} · ${detalleEntradas}`
      : 'Aún no recibe datos. Añade un monitor de entrada para poder definir la regla lógica.';

    for (const contador of contadoresHeroEntradasLogicas) {
      contador.textContent = String(totalEntradas);
    }
    for (const detalleElemento of detallesHeroEntradasLogicas) {
      detalleElemento.textContent = detalle;
    }
  }

  function seleccionarMonitorLogico(monitor) {
    if (!monitor) {
      return;
    }

    const monitorId = normalizarNumero(monitor.id);
    if (!Number.isFinite(monitorId) || monitorId <= 0) {
      return;
    }

    const entradaExistente = entradasLogicasSeleccionadas.find(
      (entrada) => entrada.monitorId === monitorId
    );
    const variable = entradaExistente?.variable || obtenerSiguienteVariableLogica();

    if (!variable) {
      window.portalToast?.show?.({
        tipo: 'warning',
        titulo: 'Monitor lógico',
        cuerpo: 'Ya se han usado todas las variables A-Z disponibles para esta fase.'
      });
      return;
    }

    const entrada = {
      variable,
      fuente: 'monitor',
      monitorId,
      etiqueta: monitor.nombre || `Monitor #${monitorId}`,
      monitor
    };

    if (entradaExistente) {
      Object.assign(entradaExistente, entrada);
    } else {
      entradasLogicasSeleccionadas.push(entrada);
    }

    actualizarTarjetaEntradaLogica();
    marcarFormularioComoSucio();
    refrescarVistaFormulario();
  }

  function limpiarEntradaEnGrafoLogico(variable) {
    const idNodo = `entrada-${String(variable || '').toLowerCase()}`;
    if (!idNodo || idNodo === 'entrada-') {
      return;
    }

    const limpiarGrafo = function (grafo) {
      if (!grafo || typeof grafo !== 'object') {
        return grafo;
      }

      return {
        ...grafo,
        nodos: (grafo.nodos || []).filter((nodo) => nodo.id !== idNodo),
        conexiones: (grafo.conexiones || []).filter((conexion) =>
          conexion.desde !== idNodo && conexion.hasta !== idNodo
        ),
        expresionCompilada: null,
        variablesUsadas: [],
        valido: false,
        errores: [`Entrada ${variable} eliminada; recompila el grafo visual.`],
        modoCompatibilidad: 'visual'
      };
    };

    if (layoutCanvasLogico?.grafoLogico) {
      layoutCanvasLogico.grafoLogico = limpiarGrafo(layoutCanvasLogico.grafoLogico);
    }

    if (grafoCanvasFullBorrador) {
      grafoCanvasFullBorrador = limpiarGrafo(grafoCanvasFullBorrador);
      if (nodoCanvasFullSeleccionado === idNodo) {
        nodoCanvasFullSeleccionado = null;
      }
      renderizarCanvasFull();
    }

    guardarLayoutCanvasLogico();
  }

  function quitarEntradaMonitorLogico(variable) {
    const variableNormalizada = String(variable || '').trim().toUpperCase();
    const entrada = obtenerEntradaLogica(variableNormalizada);

    if (!entrada) {
      return;
    }

    entradasLogicasSeleccionadas = entradasLogicasSeleccionadas.filter(
      (item) => item.variable !== variableNormalizada
    );

    limpiarEntradaEnGrafoLogico(variableNormalizada);

    const expresion = String(inputLogicoExpresion?.value || '');

    if (inputLogicoExpresion && expresion.trim() === variableNormalizada) {
      inputLogicoExpresion.value = '';
    }

    const expresionUsaVariable = new RegExp(`\\b${variableNormalizada}\\b`).test(
      String(inputLogicoExpresion?.value || '')
    );

    actualizarTarjetaEntradaLogica();
    marcarFormularioComoSucio();
    refrescarVistaFormulario();

    window.portalToast?.show?.({
      tipo: expresionUsaVariable ? 'warning' : 'info',
      titulo: 'Monitor lógico',
      cuerpo: expresionUsaVariable
        ? `Entrada ${variableNormalizada} eliminada. Revisa la fórmula: todavía menciona esa variable.`
        : `Entrada ${variableNormalizada} eliminada del monitor lógico.`
    });
  }

  function construirExpresionConToken(expresionActual, token, inicio, fin) {
    const izquierda = expresionActual.slice(0, inicio).trimEnd();
    const derecha = expresionActual.slice(fin).trimStart();
    const separadorIzquierda = izquierda ? ' ' : '';
    const separadorDerecha = derecha ? ' ' : '';

    return `${izquierda}${separadorIzquierda}${token}${separadorDerecha}${derecha}`;
  }

  function insertarTokenExpresionLogica(token) {
    if (!inputLogicoExpresion || inputLogicoExpresion.disabled || !token) {
      return;
    }

    const expresionActual = String(inputLogicoExpresion.value || '');
    const inicio = Number.isFinite(inputLogicoExpresion.selectionStart)
      ? inputLogicoExpresion.selectionStart
      : expresionActual.length;
    const fin = Number.isFinite(inputLogicoExpresion.selectionEnd)
      ? inputLogicoExpresion.selectionEnd
      : inicio;
    const nuevaExpresion = construirExpresionConToken(
      expresionActual,
      token,
      inicio,
      fin
    );
    const posicion = nuevaExpresion.indexOf(token, Math.max(0, inicio - 1)) + token.length;

    inputLogicoExpresion.value = nuevaExpresion;
    inputLogicoExpresion.focus();
    inputLogicoExpresion.setSelectionRange(posicion, posicion);
    marcarFormularioComoSucio();
    refrescarVistaFormulario();
  }

  function actualizarPreviewExpresionLogica(expresion) {
    if (!expresionLogicaPreview) {
      return;
    }

    const valor = String(expresion || '').trim();

    if (!valor) {
      expresionLogicaPreview.textContent =
        'Sin fórmula definida. Conecta entradas hasta la salida en el estudio visual.';
      return;
    }

    expresionLogicaPreview.textContent =
      `El runtime evaluará: ${valor}. Variables: ${
        entradasLogicasSeleccionadas.length > 0
          ? entradasLogicasSeleccionadas
              .map((entrada) => `${entrada.variable} = ${resolverEtiquetaEntradaLogica(entrada)}`)
              .join(' · ')
          : 'sin entradas seleccionadas'
      }.`;
  }

  function tokenizarExpresionLogicaCliente(expresion) {
    const tokens = [];
    const texto = String(expresion || '');
    let indice = 0;

    while (indice < texto.length) {
      const caracter = texto[indice];

      if (/\s/.test(caracter)) {
        indice += 1;
        continue;
      }

      if (['(', ')', '!', '+', '*'].includes(caracter)) {
        tokens.push(caracter);
        indice += 1;
        continue;
      }

      if (/[a-z]/i.test(caracter)) {
        let palabra = '';
        while (indice < texto.length && /[a-z]/i.test(texto[indice])) {
          palabra += texto[indice];
          indice += 1;
        }
        tokens.push(palabra.toUpperCase());
        continue;
      }

      return { error: `Token no reconocido: ${caracter}`, tokens: [] };
    }

    return { tokens, error: null };
  }

  function extraerVariablesExpresionLogicaCliente(expresion) {
    const { tokens, error } = tokenizarExpresionLogicaCliente(expresion);

    if (error) {
      return { variables: [], error };
    }

    return {
      variables: [...new Set(tokens.filter((token) => /^[A-Z]$/.test(token)))].sort(),
      error: null
    };
  }

  function evaluarExpresionLogicaCliente(expresion, variables) {
    const { tokens, error } = tokenizarExpresionLogicaCliente(expresion);

    if (error) {
      return { valor: null, error };
    }

    let indice = 0;

    const leer = () => tokens[indice] || null;
    const consumir = () => tokens[indice++] || null;

    const parsearPrimario = function () {
      const token = consumir();

      if (!token) {
        throw new Error('Expresión incompleta.');
      }

      if (token === '(') {
        const valor = parsearOr();
        if (consumir() !== ')') {
          throw new Error('Falta cerrar un paréntesis.');
        }
        return valor;
      }

      if (/^[A-Z]$/.test(token)) {
        if (!(token in variables)) {
          throw new Error(`La variable ${token} todavía no tiene una entrada observable.`);
        }
        return variables[token];
      }

      throw new Error(`Token inesperado: ${token}.`);
    };

    const parsearNot = function () {
      if (leer() === 'NOT' || leer() === '!') {
        consumir();
        return !parsearNot();
      }

      return parsearPrimario();
    };

    const parsearAnd = function () {
      let valor = parsearNot();

      while (leer() === 'AND' || leer() === '*') {
        consumir();
        const derecha = parsearNot();
        valor = Boolean(valor && derecha);
      }

      return valor;
    };

    const parsearOr = function () {
      let valor = parsearAnd();

      while (leer() === 'OR' || leer() === '+') {
        consumir();
        const derecha = parsearAnd();
        valor = Boolean(valor || derecha);
      }

      return valor;
    };

    try {
      if (tokens.length === 0) {
        return { valor: null, error: 'Falta expresión lógica.' };
      }

      const valor = parsearOr();

      if (indice < tokens.length) {
        return { valor: null, error: `Token sobrante: ${tokens[indice]}.` };
      }

      return { valor, error: null };
    } catch (err) {
      return { valor: null, error: err.message };
    }
  }

  function obtenerEstadoVariableLogica(entrada) {
    if (!entrada) {
      return {
        conocido: false,
        valor: null,
        etiqueta: 'Sin dato',
        detalle: 'El estado observado se mostrará al seleccionar un monitor desde el buscador.'
      };
    }

    const runtime = entrada.monitor?.estadoRuntime || null;

    if (!runtime || runtime.ejecutadoTodavia === false) {
      return {
        conocido: false,
        valor: null,
        etiqueta: 'Pendiente',
        detalle: 'El monitor origen todavía no tiene una ejecución observable.'
      };
    }

    const disponible = String(runtime.estado || '').toLowerCase() === 'disponible';
    const codigo = runtime.codigoResultado || runtime.mensajeResultado || '';

    return {
      conocido: true,
      valor: disponible,
      etiqueta: disponible ? 'true · disponible' : 'false · indisponible',
      detalle: codigo
        ? `Último resultado: ${codigo}.`
        : 'Estado observado desde el runtime.'
    };
  }

  function actualizarPlanEvaluacionLogica() {
    if (!planLogico) {
      return;
    }

    const tipo = obtenerTipoActual();
    const expresion = String(inputLogicoExpresion?.value || '').trim();
    const retardo = normalizarNumero(inputLogicoRetardo?.value);
    const mensajeFallo = String(inputLogicoMensajeFallo?.value || '').trim();
    const entradaA = obtenerEntradaLogica('A') || entradasLogicasSeleccionadas[0] || null;
    const variableA = obtenerEstadoVariableLogica(entradaA);
    const avisos = [];
    const variables = {};
    const variablesSeleccionadas = new Set(
      entradasLogicasSeleccionadas.map((entrada) => entrada.variable)
    );
    const analisisVariables = extraerVariablesExpresionLogicaCliente(expresion);
    const variablesUsadas = new Set(analisisVariables.variables);

    planLogico.hidden = tipo !== 'booleano';

    if (tipo !== 'booleano') {
      return;
    }

    if (planLogicoDependencia) {
      planLogicoDependencia.textContent =
        entradasLogicasSeleccionadas.length > 0
          ? pluralizar(entradasLogicasSeleccionadas.length, 'entrada', 'entradas')
          : 'Sin entradas';
    }

    if (planLogicoDependenciaDetalle) {
      planLogicoDependenciaDetalle.textContent = entradasLogicasSeleccionadas.length > 0
        ? entradasLogicasSeleccionadas
            .map((entrada) => `${entrada.variable}: ${resolverEtiquetaEntradaLogica(entrada)}`)
            .join(' · ')
        : 'Selecciona al menos una entrada para completar el plan.';
    }

    if (planLogicoVariableA) {
      planLogicoVariableA.textContent = variableA.etiqueta;
    }

    if (planLogicoVariableADetalle) {
      planLogicoVariableADetalle.textContent = variableA.detalle;
    }

    if (planLogicoRetardo) {
      planLogicoRetardo.textContent =
        Number.isFinite(retardo) && retardo > 0
          ? formatearSegundos(retardo)
          : 'Sin retardo';
    }

    if (planLogicoRetardoDetalle) {
      planLogicoRetardoDetalle.textContent =
        Number.isFinite(retardo) && retardo > 0
          ? 'La salida candidata deberá permanecer estable antes de mutar la salida real.'
          : 'La salida cambiará inmediatamente cuando pueda evaluarse.';
    }

    if (entradasLogicasSeleccionadas.length === 0) {
      avisos.push('Falta seleccionar al menos un monitor origen.');
    }

    if (!expresion) {
      avisos.push('Falta escribir la expresión lógica.');
    }

    if (analisisVariables.error && expresion) {
      avisos.push(`La expresión contiene un token que no se puede interpretar: ${analisisVariables.error}`);
    }

    for (const entrada of entradasLogicasSeleccionadas) {
      const estado = obtenerEstadoVariableLogica(entrada);
      if (!estado.conocido) {
        avisos.push(`Aún no hay estado observado para ${entrada.variable}; se conservará la salida estable inicial hasta poder evaluar.`);
      } else {
        variables[entrada.variable] = estado.valor;
      }

      if (entrada.monitor && entrada.monitor.activo === false) {
        avisos.push(`La dependencia ${entrada.variable} está inactiva; puede bloquear la evaluación real.`);
      }

      if (expresion && !variablesUsadas.has(entrada.variable)) {
        avisos.push(`La entrada ${entrada.variable} está seleccionada, pero la fórmula no la usa.`);
      }
    }

    for (const variable of variablesUsadas) {
      if (!variablesSeleccionadas.has(variable)) {
        avisos.push(`La fórmula usa ${variable}, pero no hay monitor asignado a esa variable.`);
      }
    }

    if (!mensajeFallo) {
      avisos.push('Falta el mensaje humano que explicará la salida indisponible.');
    }

    const resultado = expresion
      ? evaluarExpresionLogicaCliente(expresion, variables)
      : { valor: null, error: 'Falta expresión lógica.' };

    if (planLogicoResultado) {
      planLogicoResultado.textContent = resultado.error
        ? 'No calculable'
        : (resultado.valor ? 'Disponible' : 'Indisponible');
    }

    if (planLogicoResultadoDetalle) {
      planLogicoResultadoDetalle.textContent = resultado.error
        ? resultado.error
        : (
            resultado.valor
              ? 'Con los datos observados ahora, el monitor lógico saldría disponible.'
              : `Con los datos observados ahora, saldría indisponible: ${mensajeFallo || 'mensaje pendiente'}.`
          );
    }

    if (planLogicoEstado) {
      planLogicoEstado.textContent = resultado.error
        ? 'Plan parcial'
        : (resultado.valor ? 'Salida disponible' : 'Salida indisponible');
      planLogicoEstado.classList.toggle('monitor-logico-plan__estado--ok', !resultado.error && resultado.valor);
      planLogicoEstado.classList.toggle('monitor-logico-plan__estado--alerta', !resultado.error && !resultado.valor);
    }

    if (planLogicoImpacto) {
      planLogicoImpacto.textContent = resultado.error
        ? 'El impacto sobre triggers y monitores descendientes se concretará cuando la expresión pueda evaluarse.'
        : (
            resultado.valor
              ? 'Si se guarda así, no debería abrir alerta por esta evaluación actual; los triggers de cierre podrían reaccionar si existía alerta previa.'
              : 'Si se guarda así y queda en alerta, los triggers vinculados a apertura podrán reaccionar según sus bindings.'
          );
    }

    if (planLogicoAvisos) {
      const lista = avisos.length > 0
        ? avisos
        : ['Plan completo con los datos visibles en esta sesión.'];
      planLogicoAvisos.innerHTML = lista
        .map((aviso) => `<li>${escapeHtml(aviso)}</li>`)
        .join('');
    }

  }

  function construirImpactoEdicionLogica() {
    const tipo = obtenerTipoActual();
    const expresion = String(inputLogicoExpresion?.value || '').trim();
    const dependenciasActuales = entradasLogicasSeleccionadas
      .map((entrada) => `${entrada.variable}:${entrada.monitorId}`)
      .join('|');
    const dependenciasIniciales = normalizarDependenciasInicialesLogicas()
      .map((entrada) => `${entrada.variable}:${entrada.monitorId}`)
      .join('|');
    const estadoInicial = String(selectorLogicoEstadoInicial?.value || '').trim();
    const retardo = String(inputLogicoRetardo?.value || '').trim();
    const cambios = [];
    const avisos = [
      {
        nivel: 'info',
        texto: 'Ciclos de dependencias y alcance completo se validarán en servidor al guardar.'
      }
    ];
    const esEdicion = estadoInicialLogicoFormulario?.modo === 'editar';
    const esLogicoInicial = estadoInicialLogicoFormulario?.tipo === 'booleano';

    if (tipo !== 'booleano') {
      return { tipo, cambios, avisos, severidad: 'info', esEdicion, esLogicoInicial };
    }

    if (!esEdicion) {
      cambios.push({
        nivel: 'info',
        texto: 'Alta nueva: esta definición empezará sin descendientes conocidos hasta que otros monitores o triggers la referencien.'
      });
    }

    if (expresion !== String(estadoInicialLogicoFormulario.expresion || '').trim()) {
      cambios.push({
        nivel: 'warning',
        texto: `Cambia la expresión lógica de "${estadoInicialLogicoFormulario.expresion || 'vacía'}" a "${expresion || 'vacía'}".`
      });
      avisos.push({
        nivel: 'warning',
        texto: 'Cambiar la expresión puede invertir la salida y disparar triggers vinculados en la próxima evaluación real.'
      });
    }

    if (dependenciasActuales !== dependenciasIniciales) {
      cambios.push({
        nivel: 'warning',
        texto: `Cambia las entradas lógicas a: ${dependenciasActuales || 'ninguna'}.`
      });
      avisos.push({
        nivel: 'warning',
        texto: 'Cambiar dependencias modifica las señales de entrada; los monitores lógicos descendientes verán otro origen de verdad.'
      });
    }

    if (estadoInicial !== String(estadoInicialLogicoFormulario.estadoInicial || 'disponible').trim()) {
      cambios.push({
        nivel: 'info',
        texto: `Cambia la salida inicial a "${estadoInicial || 'pendiente'}".`
      });
    }

    if (retardo !== String(estadoInicialLogicoFormulario.retardoSenalSegundos || '0').trim()) {
      cambios.push({
        nivel: 'info',
        texto: `Cambia el retardo de señal de ${estadoInicialLogicoFormulario.retardoSenalSegundos || 0} s a ${retardo || 0} s.`
      });
      avisos.push({
        nivel: 'info',
        texto: 'El retardo puede demorar aperturas/cierres de alerta aunque la expresión ya haya cambiado.'
      });
    }

    if (
      Number.isFinite(monitorActualIdFormulario) &&
      entradasLogicasSeleccionadas.some((entrada) => entrada.monitorId === monitorActualIdFormulario)
    ) {
      avisos.push({
        nivel: 'error',
        texto: 'Autorreferencia detectada: este monitor no puede alimentarse a sí mismo.'
      });
    }

    if (entradasLogicasSeleccionadas.length === 0) {
      avisos.push({
        nivel: 'error',
        texto: 'Falta al menos una entrada; el monitor lógico no puede evaluarse sin dependencias.'
      });
    }

    if (!expresion) {
      avisos.push({
        nivel: 'error',
        texto: 'Falta la expresión lógica; el backend rechazará la definición.'
      });
    }

    const niveles = [...cambios, ...avisos].map((item) => item.nivel);
    const severidad = niveles.includes('error')
      ? 'error'
      : (niveles.includes('warning') ? 'warning' : 'info');

    return { tipo, cambios, avisos, severidad, esEdicion, esLogicoInicial };
  }

  function renderizarListaImpactoLogico(contenedor, elementos, vacio) {
    if (!contenedor) {
      return;
    }

    const lista = elementos.length > 0 ? elementos : [{ nivel: 'info', texto: vacio }];
    contenedor.innerHTML = lista
      .map((item) => `
        <li class="monitor-logico-impacto__item monitor-logico-impacto__item--${escapeHtml(item.nivel || 'info')}">
          ${escapeHtml(item.texto)}
        </li>
      `)
      .join('');
  }

  function actualizarImpactoEdicionLogica() {
    if (!impactoLogico) {
      return;
    }

    const impacto = construirImpactoEdicionLogica();
    const visible = impacto.tipo === 'booleano';
    impactoLogico.hidden = !visible;

    if (!visible) {
      return;
    }

    impactoLogico.classList.toggle('monitor-logico-impacto--warning', impacto.severidad === 'warning');
    impactoLogico.classList.toggle('monitor-logico-impacto--error', impacto.severidad === 'error');

    if (impactoLogicoEstado) {
      impactoLogicoEstado.textContent = impacto.severidad === 'error'
        ? 'Error bloqueante'
        : (impacto.severidad === 'warning' ? 'Revisión seria' : 'Impacto controlado');
    }

    if (impactoLogicoTriggers) {
      impactoLogicoTriggers.textContent = impacto.esEdicion
        ? 'Posible reacción'
        : 'Sin vínculos aún';
    }

    if (impactoLogicoDescendientes) {
      impactoLogicoDescendientes.textContent = impacto.esEdicion
        ? 'Posible cascada'
        : 'Sin cascada inicial';
    }

    if (impactoLogicoDependencias) {
      impactoLogicoDependencias.textContent =
        entradasLogicasSeleccionadas.length > 0
          ? pluralizar(entradasLogicasSeleccionadas.length, 'entrada', 'entradas')
          : 'Pendiente';
    }

    if (impactoLogicoDependenciasDetalle) {
      impactoLogicoDependenciasDetalle.textContent = impacto.avisos.some(
        (aviso) => aviso.nivel === 'error'
      )
        ? 'Hay errores en dependencias que impedirán guardar.'
        : 'Las dependencias visibles se revalidarán en servidor.';
    }

    renderizarListaImpactoLogico(
      impactoLogicoCambios,
      impacto.cambios,
      'No hay cambios sensibles en la lógica.'
    );
    renderizarListaImpactoLogico(
      impactoLogicoAvisos,
      impacto.avisos,
      'Sin avisos operativos.'
    );
  }

  function obtenerLayoutCanvasLogicoPorDefecto() {
    return {
      version: 1,
      nodos: [
        { id: 'salida', tipo: 'salida', x: 70, y: 32 }
      ],
      conexiones: []
    };
  }

  function normalizarLayoutCanvasLogico(layout) {
    const base = obtenerLayoutCanvasLogicoPorDefecto();
    const nodosEntrada = Array.isArray(layout?.nodos) ? layout.nodos : [];
    const nodosPorId = new Map(nodosEntrada.map((nodo) => [nodo.id, nodo]));
    const grafoLogico = layout?.grafoLogico && typeof layout.grafoLogico === 'object'
      ? layout.grafoLogico
      : null;

    return {
      version: 1,
      nodos: base.nodos.map((nodoBase) => {
        const nodoEntrada = nodosPorId.get(nodoBase.id) || {};
        const x = Number(nodoEntrada.x);
        const y = Number(nodoEntrada.y);

        return {
          ...nodoBase,
          x: Number.isFinite(x) ? Math.min(82, Math.max(2, x)) : nodoBase.x,
          y: Number.isFinite(y) ? Math.min(76, Math.max(4, y)) : nodoBase.y
        };
      }),
      conexiones: base.conexiones,
      ...(grafoLogico ? { grafoLogico } : {})
    };
  }

  function cargarLayoutCanvasLogico() {
    if (!inputLayoutLogico) {
      return obtenerLayoutCanvasLogicoPorDefecto();
    }

    try {
      return normalizarLayoutCanvasLogico(
        JSON.parse(String(inputLayoutLogico.value || '{}'))
      );
    } catch (_error) {
      return obtenerLayoutCanvasLogicoPorDefecto();
    }
  }

  function guardarLayoutCanvasLogico() {
    if (!inputLayoutLogico || !layoutCanvasLogico) {
      return;
    }

    inputLayoutLogico.value = JSON.stringify(layoutCanvasLogico);
  }

  function obtenerNodoLayoutCanvasLogico(idNodo) {
    return layoutCanvasLogico?.nodos?.find((nodo) => nodo.id === idNodo) || null;
  }

  function clonarObjetoPlano(valor) {
    try {
      return JSON.parse(JSON.stringify(valor || {}));
    } catch (_error) {
      return {};
    }
  }

  function construirGrafoCanvasFullInicialVacio() {
    const entradas = entradasLogicasSeleccionadas
      .map((entrada, indice) => normalizarEntradaLogica(entrada, indice))
      .filter(Boolean);
    const totalEntradas = Math.max(entradas.length, 1);

    return {
      version: 1,
      modoCompatibilidad: 'visual',
      nodos: [
        ...entradas.map((entrada, indice) => ({
          id: `entrada-${entrada.variable.toLowerCase()}`,
          tipo: 'entrada',
          variable: entrada.variable,
          etiqueta: `${entrada.variable}: ${resolverEtiquetaEntradaLogica(entrada)}`,
          x: 120,
          y: 120 + indice * 130
        })),
        {
          id: 'salida',
          tipo: 'salida',
          etiqueta: 'Salida única',
          x: 980,
          y: 120 + Math.floor((totalEntradas - 1) / 2) * 130
        }
      ],
      conexiones: []
    };
  }

  function sincronizarEntradasEnGrafoCanvasFull(grafo) {
    const base = grafo && typeof grafo === 'object'
      ? clonarObjetoPlano(grafo)
      : construirGrafoCanvasFullInicialVacio();
    const entradas = entradasLogicasSeleccionadas
      .map((entrada, indice) => normalizarEntradaLogica(entrada, indice))
      .filter(Boolean);
    const nodos = Array.isArray(base.nodos) ? base.nodos : [];
    const ids = new Set(nodos.map((nodo) => nodo.id));
    const totalEntradas = Math.max(entradas.length, 1);

    for (const [indice, entrada] of entradas.entries()) {
      const id = `entrada-${entrada.variable.toLowerCase()}`;
      if (!ids.has(id)) {
        nodos.push({
          id,
          tipo: 'entrada',
          variable: entrada.variable,
          etiqueta: `${entrada.variable}: ${resolverEtiquetaEntradaLogica(entrada)}`,
          x: 120,
          y: 120 + indice * 130
        });
        ids.add(id);
      }
    }

    if (!nodos.some((nodo) => nodo.tipo === 'salida')) {
      nodos.push({
        id: 'salida',
        tipo: 'salida',
        etiqueta: 'Salida única',
        x: 980,
        y: 120 + Math.floor((totalEntradas - 1) / 2) * 130
      });
    }

    return {
      ...base,
      version: base.version || 1,
      modoCompatibilidad: base.modoCompatibilidad || 'visual',
      nodos,
      conexiones: Array.isArray(base.conexiones) ? base.conexiones : []
    };
  }

  function normalizarExpresionTextoLogico(valor) {
    let texto = String(valor || '')
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/^!\s*([A-Z])$/i, 'NOT $1')
      .toUpperCase();

    let anterior = '';
    while (texto !== anterior) {
      anterior = texto;
      texto = texto
        .replace(/\(\s*\(([^()]+)\)\s*\)/g, '($1)')
        .replace(/\bNOT\s+\(\s*\(([^()]+)\)\s*\)/g, 'NOT ($1)');
    }

    return texto;
  }

  function construirGrafoTrivialDesdeExpresion(expresion) {
    const normalizada = normalizarExpresionTextoLogico(expresion);
    const coincidenciaVariable = normalizada.match(/^([A-Z])$/);
    const coincidenciaNot = normalizada.match(/^NOT ([A-Z])$/);
    const variable = coincidenciaVariable?.[1] || coincidenciaNot?.[1] || null;

    if (!variable) {
      return null;
    }

    const entrada = {
      id: `entrada-${variable.toLowerCase()}`,
      tipo: 'entrada',
      variable,
      etiqueta: `Entrada ${variable}`,
      x: 140,
      y: 180
    };
    const salida = {
      id: 'salida',
      tipo: 'salida',
      etiqueta: 'Salida',
      x: coincidenciaNot ? 650 : 430,
      y: 180
    };

    if (coincidenciaNot) {
      return {
        version: 1,
        modoCompatibilidad: 'reconstruido_trivial',
        nodos: [
          entrada,
          { id: 'not-1', tipo: 'not', etiqueta: 'NOT', x: 390, y: 180 },
          salida
        ],
        conexiones: [
          { desde: entrada.id, hasta: 'not-1' },
          { desde: 'not-1', hasta: salida.id }
        ]
      };
    }

    return {
      version: 1,
      modoCompatibilidad: 'reconstruido_trivial',
      nodos: [entrada, salida],
      conexiones: [{ desde: entrada.id, hasta: salida.id }]
    };
  }

  function enriquecerGrafoCompatibilidadTextual(grafo) {
    const texto = normalizarExpresionTextoLogico(inputLogicoExpresion?.value);
    const compilada = normalizarExpresionTextoLogico(grafo?.expresionCompilada);
    const tieneNodoLegacy = Array.isArray(grafo?.nodos) &&
      grafo.nodos.some((nodo) => nodo.tipo === 'expresion');

    return {
      ...grafo,
      modoCompatibilidad: tieneNodoLegacy || (texto && compilada && texto !== compilada)
        ? 'texto_operativo'
        : (grafo?.modoCompatibilidad || 'visual'),
      expresionTextual: texto || null
    };
  }

  function obtenerGrafoCanvasFullBase() {
    const grafo = layoutCanvasLogico?.grafoLogico;
    const tieneGrafo = grafo &&
      typeof grafo === 'object' &&
      Array.isArray(grafo.nodos) &&
      grafo.nodos.length > 0;

    if (tieneGrafo) {
      return enriquecerGrafoCompatibilidadTextual(
        sincronizarEntradasEnGrafoCanvasFull(grafo)
      );
    }

    return construirGrafoTrivialDesdeExpresion(inputLogicoExpresion?.value) ||
      sincronizarEntradasEnGrafoCanvasFull(construirGrafoCanvasFullInicialVacio());
  }

  function obtenerSiguienteIdGrafo(prefijo) {
    const ids = new Set((grafoCanvasFullBorrador?.nodos || []).map((nodo) => nodo.id));
    let indice = 1;
    let id = `${prefijo}-${indice}`;

    while (ids.has(id)) {
      indice += 1;
      id = `${prefijo}-${indice}`;
    }

    return id;
  }

  function obtenerSiguienteVariableCanvasFull() {
    const usadas = new Set(
      (grafoCanvasFullBorrador?.nodos || [])
        .filter((nodo) => nodo.tipo === 'entrada')
        .map((nodo) => String(nodo.variable || '').trim().toUpperCase())
        .filter(Boolean)
    );

    for (let indice = 0; indice < 26; indice += 1) {
      const variable = obtenerVariablePorIndice(indice);
      if (!usadas.has(variable)) {
        return variable;
      }
    }

    return null;
  }

  function resolverEtiquetaNodoCanvasFull(nodo) {
    if (nodo.tipo === 'entrada') {
      const variable = String(nodo.variable || '').trim().toUpperCase();
      const entrada = obtenerEntradaLogica(variable);
      return entrada
        ? `${variable}: ${resolverEtiquetaEntradaLogica(entrada)}`
        : `${variable || '?'}: entrada pendiente`;
    }

    if (nodo.tipo === 'salida') {
      return 'Salida única';
    }

    if (nodo.tipo === 'expresion') {
      return 'Expresión textual';
    }

    return String(nodo.tipo || '').toUpperCase();
  }

  function resolverTipoNodoCanvasFull(nodo) {
    const tipo = String(nodo?.tipo || '').toLowerCase();

    if (tipo === 'entrada') return 'Entrada';
    if (tipo === 'salida') return 'Salida';
    if (tipo === 'and') return 'Puerta AND';
    if (tipo === 'or') return 'Puerta OR';
    if (tipo === 'not') return 'Puerta NOT';
    if (tipo === 'expresion') return 'Expresión textual';
    return tipo || 'Nodo';
  }

  function renderizarSimboloNodoCanvasFull(nodo) {
    const tipo = String(nodo?.tipo || '').toLowerCase();
    const simbolos = {
      and: {
        ruta: '/IMG/logic-gates/and-ansi.svg',
        etiqueta: 'Símbolo ANSI de puerta AND'
      },
      or: {
        ruta: '/IMG/logic-gates/or-ansi.svg',
        etiqueta: 'Símbolo ANSI de puerta OR'
      },
      not: {
        ruta: '/IMG/logic-gates/not-ansi.svg',
        etiqueta: 'Símbolo ANSI de puerta NOT'
      }
    };
    const simbolo = simbolos[tipo];

    if (simbolo) {
      return `
        <span class="monitor-logico-estudio__simbolo monitor-logico-estudio__simbolo--${tipo}" aria-hidden="true">
          <img src="${simbolo.ruta}" alt="" loading="lazy" title="${simbolo.etiqueta}">
        </span>
      `;
    }

    return '';
  }

  function resolverDetalleSalidaNodoCanvasFull(valor) {
    return `Salida: ${formatearValorSimulado(valor)}`;
  }

  function obtenerEntradasCanvasFull() {
    return (grafoCanvasFullBorrador?.nodos || [])
      .filter((nodo) => nodo.tipo === 'entrada')
      .map((nodo) => ({
        ...nodo,
        variable: String(nodo.variable || '').trim().toUpperCase()
      }))
      .filter((nodo) => nodo.variable)
      .sort((a, b) => a.variable.localeCompare(b.variable));
  }

  function formatearValorSimulado(valor) {
    if (valor === true) return 'disponible';
    if (valor === false) return 'indisponible';
    return 'sin dato';
  }

  function evaluarGrafoCanvasFull() {
    const valoresPorNodo = new Map();
    const errores = [];

    if (!grafoCanvasFullBorrador) {
      return {
        valoresPorNodo,
        salida: null,
        detalle: 'Abre el estudio visual para preparar una simulación.'
      };
    }

    const nodos = new Map(
      (grafoCanvasFullBorrador.nodos || []).map((nodo) => [nodo.id, nodo])
    );
    const entradasPorDestino = new Map();

    for (const conexion of grafoCanvasFullBorrador.conexiones || []) {
      if (!entradasPorDestino.has(conexion.hasta)) {
        entradasPorDestino.set(conexion.hasta, []);
      }
      entradasPorDestino.get(conexion.hasta).push(conexion.desde);
    }

    const evaluarNodo = function (idNodo, ruta = []) {
      if (valoresPorNodo.has(idNodo)) {
        return valoresPorNodo.get(idNodo);
      }

      const nodo = nodos.get(idNodo);
      if (!nodo) {
        errores.push(`Nodo inexistente: ${idNodo}.`);
        return null;
      }

      if (ruta.includes(idNodo)) {
        errores.push(`Ciclo detectado: ${[...ruta, idNodo].join(' -> ')}.`);
        return null;
      }

      let valor = null;
      const entradas = entradasPorDestino.get(idNodo) || [];

      if (nodo.tipo === 'entrada') {
        const variable = String(nodo.variable || '').trim().toUpperCase();
        valor = Object.hasOwn(valoresSimuladosCanvasFull, variable)
          ? valoresSimuladosCanvasFull[variable]
          : null;
      } else if (nodo.tipo === 'salida' || nodo.tipo === 'expresion') {
        valor = entradas.length === 1
          ? evaluarNodo(entradas[0], [...ruta, idNodo])
          : null;
        if (entradas.length !== 1) {
          errores.push(`El nodo ${nodo.tipo} "${idNodo}" necesita exactamente una entrada.`);
        }
      } else if (nodo.tipo === 'not') {
        const hijo = entradas.length === 1
          ? evaluarNodo(entradas[0], [...ruta, idNodo])
          : null;
        valor = hijo == null ? null : !hijo;
        if (entradas.length !== 1) {
          errores.push(`La puerta NOT "${idNodo}" necesita exactamente una entrada.`);
        }
      } else if (nodo.tipo === 'and') {
        const valores = entradas.map((entrada) => evaluarNodo(entrada, [...ruta, idNodo]));
        valor = valores.includes(false)
          ? false
          : (valores.length >= 2 && valores.every((item) => item === true) ? true : null);
        if (entradas.length < 2) {
          errores.push(`La puerta AND "${idNodo}" necesita al menos dos entradas.`);
        }
      } else if (nodo.tipo === 'or') {
        const valores = entradas.map((entrada) => evaluarNodo(entrada, [...ruta, idNodo]));
        valor = valores.includes(true)
          ? true
          : (valores.length >= 2 && valores.every((item) => item === false) ? false : null);
        if (entradas.length < 2) {
          errores.push(`La puerta OR "${idNodo}" necesita al menos dos entradas.`);
        }
      }

      valoresPorNodo.set(idNodo, valor);
      return valor;
    };

    const salida = (grafoCanvasFullBorrador.nodos || []).find((nodo) => nodo.tipo === 'salida');
    const valorSalida = salida ? evaluarNodo(salida.id) : null;
    const entradasSinDato = obtenerEntradasCanvasFull()
      .filter((entrada) => !Object.hasOwn(valoresSimuladosCanvasFull, entrada.variable))
      .map((entrada) => entrada.variable);

    return {
      valoresPorNodo,
      salida: valorSalida,
      detalle: errores[0] ||
        (
          entradasSinDato.length > 0
            ? `Faltan valores simulados para: ${entradasSinDato.join(', ')}.`
            : `Salida simulada: ${formatearValorSimulado(valorSalida)}.`
        )
    };
  }

  function renderizarSimulacionCanvasFull() {
    if (!canvasFullSimulacionEntradas || !canvasFullSimulacionResultado) {
      return;
    }

    const entradas = obtenerEntradasCanvasFull();
    canvasFullSimulacionEntradas.innerHTML = entradas.length > 0
      ? entradas
          .map((entrada) => {
            const variable = entrada.variable;
            const valor = Object.hasOwn(valoresSimuladosCanvasFull, variable)
              ? valoresSimuladosCanvasFull[variable]
              : null;

            return `
              <div class="monitor-logico-estudio__simulacion-entrada">
                <strong>${escapeHtml(variable)}</strong>
                <span>${escapeHtml(resolverEtiquetaNodoCanvasFull(entrada))}</span>
                <div class="btn-group btn-group-sm" role="group" aria-label="Simular ${escapeHtml(variable)}">
                  <button
                    type="button"
                    class="btn btn-outline-success ${valor === true ? 'active' : ''}"
                    data-monitor-logico-simulacion-variable="${escapeHtml(variable)}"
                    data-monitor-logico-simulacion-valor="true"
                  >Disponible</button>
                  <button
                    type="button"
                    class="btn btn-outline-danger ${valor === false ? 'active' : ''}"
                    data-monitor-logico-simulacion-variable="${escapeHtml(variable)}"
                    data-monitor-logico-simulacion-valor="false"
                  >Indisponible</button>
                  <button
                    type="button"
                    class="btn btn-outline-secondary"
                    data-monitor-logico-simulacion-variable="${escapeHtml(variable)}"
                    data-monitor-logico-simulacion-valor="clear"
                  >Limpiar</button>
                </div>
              </div>
            `;
          })
          .join('')
      : '<p class="text-body-secondary mb-0">Añade entradas al grafo para simular comportamiento.</p>';

    const etiqueta = canvasFullSimulacionResultado.querySelector('strong');
    const detalle = canvasFullSimulacionResultado.querySelector('small');
    const salida = resultadoSimulacionCanvasFull.salida;

    canvasFullSimulacionResultado.classList.toggle(
      'monitor-logico-estudio__simulacion-resultado--ok',
      salida === true
    );
    canvasFullSimulacionResultado.classList.toggle(
      'monitor-logico-estudio__simulacion-resultado--alerta',
      salida === false
    );

    if (etiqueta) {
      etiqueta.textContent = salida == null
        ? 'No calculable'
        : (salida ? 'Disponible' : 'Indisponible');
    }

    if (detalle) {
      const retardo = normalizarNumero(inputLogicoRetardo?.value);
      const detalleRetardo = Number.isFinite(retardo) && retardo > 0
        ? ` Retardo configurado: ${formatearSegundos(retardo)} antes de mutar salida real.`
        : ' Sin retardo configurado.';
      detalle.textContent = `${resultadoSimulacionCanvasFull.detalle}${detalleRetardo}`;
    }
  }

  function obtenerNodoCanvasFull(idNodo) {
    return (grafoCanvasFullBorrador?.nodos || [])
      .find((nodo) => nodo.id === idNodo) || null;
  }

  function obtenerPuertosNodoCanvasFull(nodo) {
    const tipo = String(nodo?.tipo || '').toLowerCase();

    if (tipo === 'entrada') {
      return { entradas: [], salidas: ['out'] };
    }

    if (tipo === 'and' || tipo === 'or') {
      return { entradas: ['in-1', 'in-2', 'in-3'], salidas: ['out'] };
    }

    if (tipo === 'not' || tipo === 'salida' || tipo === 'expresion') {
      return {
        entradas: ['in-1'],
        salidas: tipo === 'salida' ? [] : ['out']
      };
    }

    return { entradas: [], salidas: [] };
  }

  function renderizarPuertosNodoCanvasFull(nodo) {
    const puertos = obtenerPuertosNodoCanvasFull(nodo);
    const entradas = puertos.entradas
      .map((puerto, indice) => {
        const conectable = puertoEsConectableCanvasFull(nodo, puerto, 'entrada');
        return `
        <button
          type="button"
          class="monitor-logico-estudio__puerto monitor-logico-estudio__puerto--entrada ${conectable ? 'monitor-logico-estudio__puerto--conectable' : ''} ${modoDesconectarCanvasFull && puertoTieneConexionCanvasFull(nodo.id, puerto, 'entrada') ? 'monitor-logico-estudio__puerto--desconectable' : ''}"
          style="top: ${obtenerOffsetPuertoCanvasFull(nodo, 'entrada', indice)}px;"
          data-monitor-logico-grafo-puerto
          data-monitor-logico-grafo-puerto-tipo="entrada"
          data-monitor-logico-grafo-puerto-nodo="${escapeHtml(nodo.id)}"
          data-monitor-logico-grafo-puerto-id="${escapeHtml(puerto)}"
          aria-label="Entrada ${escapeHtml(puerto)} de ${escapeHtml(nodo.id)}${conectable ? ', disponible para conectar' : ''}"
          title="${conectable ? 'Entrada disponible: pulsa aquí para completar el enlace.' : 'Entrada: acepta una sola conexión desde una salida roja. Botón derecho para borrar sus enlaces.'}"
        ></button>
      `;
      })
      .join('');
    const salidas = puertos.salidas
      .map((puerto, indice) => {
        const conectable = puertoEsConectableCanvasFull(nodo, puerto, 'salida');
        return `
        <button
          type="button"
          class="monitor-logico-estudio__puerto monitor-logico-estudio__puerto--salida ${conectable ? 'monitor-logico-estudio__puerto--conectable' : ''} ${modoDesconectarCanvasFull && puertoTieneConexionCanvasFull(nodo.id, puerto, 'salida') ? 'monitor-logico-estudio__puerto--desconectable' : ''}"
          style="top: ${obtenerOffsetPuertoCanvasFull(nodo, 'salida', indice)}px;"
          data-monitor-logico-grafo-puerto
          data-monitor-logico-grafo-puerto-tipo="salida"
          data-monitor-logico-grafo-puerto-nodo="${escapeHtml(nodo.id)}"
          data-monitor-logico-grafo-puerto-id="${escapeHtml(puerto)}"
          aria-label="Salida ${escapeHtml(puerto)} de ${escapeHtml(nodo.id)}${conectable ? ', disponible para conectar' : ''}"
          title="${conectable ? 'Salida disponible: pulsa aquí para iniciar el enlace.' : 'Salida: inicia enlaces hacia entradas verdes. Botón derecho para borrar sus enlaces.'}"
        ></button>
      `;
      })
      .join('');

    return `${entradas}${salidas}`;
  }

  function puertoEsConectableCanvasFull(nodo, puertoId, tipoPuerto) {
    if (!modoConectarCanvasFull) {
      return false;
    }

    if (!puertoCanvasFullOrigenConexion) {
      return tipoPuerto === 'salida';
    }

    return tipoPuerto === 'entrada' && nodo.id !== puertoCanvasFullOrigenConexion.nodoId;
  }

  function esPuertaMultiEntradaCanvasFull(nodo) {
    const tipo = String(nodo?.tipo || '').toLowerCase();
    return tipo === 'and' || tipo === 'or';
  }

  function obtenerOffsetPuertoCanvasFull(nodo, tipoPuerto, indice) {
    if (tipoPuerto === 'entrada' && esPuertaMultiEntradaCanvasFull(nodo)) {
      return 28 + (indice * 64);
    }

    return (tipoPuerto === 'entrada' ? 28 : 38) + (indice * 22);
  }

  function obtenerCentroPuertoCanvasFull(nodo, tipoPuerto, puertoId) {
    const puertos = obtenerPuertosNodoCanvasFull(nodo);
    const lista = tipoPuerto === 'entrada' ? puertos.entradas : puertos.salidas;
    const indice = Math.max(0, lista.indexOf(puertoId));
    const x = Number(nodo.x || 0) + (
      tipoPuerto === 'entrada'
        ? 0
        : anchoNodoCanvasFull
    );
    const y = Number(nodo.y || 0) + (
      obtenerOffsetPuertoCanvasFull(nodo, tipoPuerto, indice)
    ) + radioPuertoCanvasFull;

    return { x, y };
  }

  function normalizarPuertoConexionCanvasFull(conexion, tipoPuerto) {
    const valor = String(
      tipoPuerto === 'salida'
        ? (conexion.puertoDesde || conexion.salida || 'out')
        : (conexion.puertoHasta || conexion.entrada || 'in-1')
    ).trim();

    return valor || (tipoPuerto === 'salida' ? 'out' : 'in-1');
  }

  function envolverExpresionCanvasFull(compilada, prioridadPadre) {
    if (!compilada) {
      return '';
    }

    return compilada.prioridad < prioridadPadre
      ? `(${compilada.expresion})`
      : compilada.expresion;
  }

  function compilarGrafoCanvasFullAExpresion(grafo) {
    const nodosLista = Array.isArray(grafo?.nodos) ? grafo.nodos : [];
    const conexiones = Array.isArray(grafo?.conexiones) ? grafo.conexiones : [];
    const nodos = new Map(nodosLista.map((nodo) => [nodo.id, nodo]));
    const entradasPorDestino = new Map();
    const errores = [];

    for (const conexion of conexiones) {
      if (!nodos.has(conexion.desde) || !nodos.has(conexion.hasta)) {
        errores.push(`Hay una conexión con nodos inexistentes: ${conexion.desde} -> ${conexion.hasta}.`);
        continue;
      }

      if (!entradasPorDestino.has(conexion.hasta)) {
        entradasPorDestino.set(conexion.hasta, []);
      }
      entradasPorDestino.get(conexion.hasta).push(conexion.desde);
    }

    const salidas = nodosLista.filter((nodo) => nodo.tipo === 'salida');
    if (salidas.length !== 1) {
      errores.push('El grafo debe tener exactamente una salida.');
    }

    const compilarNodo = function (idNodo, ruta = []) {
      const nodo = nodos.get(idNodo);

      if (!nodo) {
        errores.push(`Nodo inexistente: ${idNodo}.`);
        return null;
      }

      if (ruta.includes(idNodo)) {
        errores.push(`Ciclo detectado: ${[...ruta, idNodo].join(' -> ')}.`);
        return null;
      }

      const tipo = String(nodo.tipo || '').toLowerCase();
      const entradas = entradasPorDestino.get(idNodo) || [];

      if (tipo === 'entrada') {
        const variable = String(nodo.variable || '').trim().toUpperCase();
        if (!/^[A-Z]$/.test(variable)) {
          errores.push(`La entrada ${idNodo} no tiene variable válida.`);
          return null;
        }
        return { expresion: variable, prioridad: 3 };
      }

      if (tipo === 'salida' || tipo === 'expresion') {
        if (entradas.length !== 1) {
          errores.push(`El nodo ${tipo} "${idNodo}" necesita exactamente una entrada.`);
          return null;
        }
        return compilarNodo(entradas[0], [...ruta, idNodo]);
      }

      if (tipo === 'not') {
        if (entradas.length !== 1) {
          errores.push(`La puerta NOT "${idNodo}" necesita exactamente una entrada.`);
          return null;
        }

        const hijo = compilarNodo(entradas[0], [...ruta, idNodo]);
        if (!hijo) {
          return null;
        }

        return {
          expresion: `NOT ${envolverExpresionCanvasFull(hijo, 2)}`,
          prioridad: 2
        };
      }

      if (tipo === 'and' || tipo === 'or') {
        if (entradas.length < 2) {
          errores.push(`La puerta ${tipo.toUpperCase()} "${idNodo}" necesita al menos dos entradas.`);
          return null;
        }

        const prioridad = tipo === 'and' ? 1 : 0;
        const operador = tipo === 'and' ? ' AND ' : ' OR ';
        const hijos = entradas
          .map((entrada) => compilarNodo(entrada, [...ruta, idNodo]))
          .filter(Boolean);

        if (hijos.length !== entradas.length) {
          return null;
        }

        return {
          expresion: hijos
            .map((hijo) => envolverExpresionCanvasFull(hijo, prioridad))
            .join(operador),
          prioridad
        };
      }

      errores.push(`Tipo de nodo no soportado en el grafo visual: ${tipo || idNodo}.`);
      return null;
    };

    const resultado = salidas[0] ? compilarNodo(salidas[0].id) : null;
    const variablesUsadas = Array.from(
      new Set(
        String(resultado?.expresion || '').match(/\b[A-Z]\b/g) || []
      )
    ).sort((a, b) => a.localeCompare(b));

    return {
      valido: errores.length === 0 && Boolean(resultado?.expresion),
      expresion: resultado?.expresion || '',
      variablesUsadas,
      errores
    };
  }

  function simplificarExpresionLogicaCanvasFull(expresion) {
    let simplificada = normalizarExpresionTextoLogico(expresion);

    if (!simplificada) {
      return null;
    }

    for (let iteracion = 0; iteracion < 4; iteracion += 1) {
      const anterior = simplificada;

      simplificada = simplificada
        .replace(/\bNOT\s+NOT\s+([A-Z])\b/g, '$1')
        .replace(/\bNOT\s+\(\s*NOT\s+([A-Z])\s*\)/g, '$1');

      const demorganOr = simplificada.match(/^NOT\s+\((NOT\s+[A-Z](?:\s+OR\s+NOT\s+[A-Z])*)\)$/);
      if (demorganOr) {
        simplificada = demorganOr[1]
          .split(/\s+OR\s+/)
          .map((parte) => parte.replace(/^NOT\s+/, '').trim())
          .join(' AND ');
      }

      const demorganAnd = simplificada.match(/^NOT\s+\((NOT\s+[A-Z](?:\s+AND\s+NOT\s+[A-Z])*)\)$/);
      if (demorganAnd) {
        simplificada = demorganAnd[1]
          .split(/\s+AND\s+/)
          .map((parte) => parte.replace(/^NOT\s+/, '').trim())
          .join(' OR ');
      }

      for (const operador of ['AND', 'OR']) {
        const partes = simplificada.split(new RegExp(`\\s+${operador}\\s+`));
        if (
          partes.length > 1 &&
          partes.every((parte) => /^[A-Z]$/.test(parte.trim()))
        ) {
          simplificada = Array.from(new Set(partes.map((parte) => parte.trim())))
            .join(` ${operador} `);
        }
      }

      if (simplificada === anterior) {
        break;
      }
    }

    return simplificada && simplificada !== normalizarExpresionTextoLogico(expresion)
      ? simplificada
      : null;
  }

  function moverNodoCanvasFull(evento) {
    if (!nodoCanvasFullArrastrado || !canvasFullLienzo) {
      return;
    }

    const nodo = obtenerNodoCanvasFull(nodoCanvasFullArrastrado.id);
    if (!nodo) {
      return;
    }

    const distancia = Math.hypot(
      evento.clientX - nodoCanvasFullArrastrado.inicioX,
      evento.clientY - nodoCanvasFullArrastrado.inicioY
    );
    if (!nodoCanvasFullArrastrado.movido && distancia < 6) {
      return;
    }

    const caja = canvasFullLienzo.getBoundingClientRect();
    const x = (
      evento.clientX -
      caja.left +
      canvasFullLienzo.scrollLeft -
      nodoCanvasFullArrastrado.offsetX
    ) / zoomCanvasFull;
    const y = (
      evento.clientY -
      caja.top +
      canvasFullLienzo.scrollTop -
      nodoCanvasFullArrastrado.offsetY
    ) / zoomCanvasFull;

    nodo.x = Math.max(24, Math.min(2920, x));
    nodo.y = Math.max(24, Math.min(1700, y));
    nodoCanvasFullArrastrado.movido = true;
    grafoCanvasFullBorrador.modoCompatibilidad = 'visual';

    const elemento = canvasFullNodos?.querySelector(
      `[data-monitor-logico-grafo-nodo="${escapeHtml(nodo.id)}"]`
    );
    if (elemento) {
      elemento.style.left = `${nodo.x}px`;
      elemento.style.top = `${nodo.y}px`;
    }
    dibujarConexionesCanvasFull();
  }

  function puertoTieneConexionCanvasFull(nodoId, puertoId, tipo) {
    return (grafoCanvasFullBorrador?.conexiones || []).some((conexion) =>
      tipo === 'salida'
        ? conexion.desde === nodoId &&
          normalizarPuertoConexionCanvasFull(conexion, 'salida') === puertoId
        : conexion.hasta === nodoId &&
          normalizarPuertoConexionCanvasFull(conexion, 'entrada') === puertoId
    );
  }

  function nodoTieneConexionesCanvasFull(nodoId) {
    return (grafoCanvasFullBorrador?.conexiones || []).some(
      (conexion) => conexion.desde === nodoId || conexion.hasta === nodoId
    );
  }

  function actualizarStatusCanvasFull(mensaje = '') {
    if (!canvasFullStatus || !grafoCanvasFullBorrador) {
      return;
    }

    const totalNodos = grafoCanvasFullBorrador.nodos?.length || 0;
    const totalConexiones = grafoCanvasFullBorrador.conexiones?.length || 0;
    const modo = grafoCanvasFullBorrador.modoCompatibilidad === 'texto_operativo'
      ? 'modo textual compatible'
      : (grafoCanvasFullBorrador.modoCompatibilidad === 'reconstruido_trivial'
          ? 'grafo trivial reconstruido'
          : 'borrador visual');
    canvasFullStatus.dataset.mensajeActivo = mensaje ? 'true' : 'false';
    canvasFullStatus.textContent = mensaje ||
      `${pluralizar(totalNodos, 'nodo', 'nodos')} · ${pluralizar(totalConexiones, 'conexión', 'conexiones')} · ${modo}`;
  }

  function actualizarInspectorCanvasFull(valores = new Map()) {
    const nodo = (grafoCanvasFullBorrador?.nodos || []).find(
      (item) => item.id === nodoCanvasFullSeleccionado
    );

    if (!nodo) {
      if (canvasFullInspectorTitulo) {
        canvasFullInspectorTitulo.textContent = 'Selecciona una pieza';
      }
      if (canvasFullInspectorDetalle) {
        canvasFullInspectorDetalle.textContent =
          'Haz clic sobre una entrada, operador o salida para revisar su papel en la regla.';
      }
      if (canvasFullInspectorTipo) canvasFullInspectorTipo.textContent = '—';
      if (canvasFullInspectorConexiones) canvasFullInspectorConexiones.textContent = '—';
      if (canvasFullInspectorEstado) canvasFullInspectorEstado.textContent = '—';
      return;
    }

    const conexiones = (grafoCanvasFullBorrador?.conexiones || []).filter(
      (conexion) => conexion.desde === nodo.id || conexion.hasta === nodo.id
    );
    const valor = valores.get(nodo.id);

    if (canvasFullInspectorTitulo) {
      canvasFullInspectorTitulo.textContent = resolverEtiquetaNodoCanvasFull(nodo);
    }
    if (canvasFullInspectorDetalle) {
      canvasFullInspectorDetalle.textContent = nodo.tipo === 'salida'
        ? 'Esta es la salida única de la regla. Recibe el resultado que se aplicará al monitor.'
        : nodo.tipo === 'entrada'
          ? 'Esta pieza representa el estado de uno de los monitores que has añadido.'
          : 'Este operador combina o transforma las señales que recibe antes de pasarlas al siguiente paso.';
    }
    if (canvasFullInspectorTipo) {
      canvasFullInspectorTipo.textContent = resolverTipoNodoCanvasFull(nodo);
    }
    if (canvasFullInspectorConexiones) {
      canvasFullInspectorConexiones.textContent = conexiones.length === 1
        ? '1 enlace'
        : `${conexiones.length} enlaces`;
    }
    if (canvasFullInspectorEstado) {
      canvasFullInspectorEstado.textContent = resolverDetalleSalidaNodoCanvasFull(valor);
    }
  }

  function actualizarCompilacionCanvasFull() {
    if (!grafoCanvasFullBorrador) {
      return null;
    }

    const compilacion = compilarGrafoCanvasFullAExpresion(grafoCanvasFullBorrador);

    if (canvasFullCompilacion) {
      const simplificacion = compilacion.valido
        ? simplificarExpresionLogicaCanvasFull(compilacion.expresion)
        : null;
      canvasFullCompilacion.innerHTML = compilacion.valido
        ? `
          <span class="monitor-logico-estudio__compilacion-pill">
            Fórmula: ${escapeHtml(compilacion.expresion)}
          </span>
          ${
            simplificacion
              ? `<span class="monitor-logico-estudio__compilacion-pill monitor-logico-estudio__compilacion-pill--sugerencia">Simplificación posible: ${escapeHtml(simplificacion)}</span>`
              : ''
          }
        `
        : `
          <span class="monitor-logico-estudio__compilacion-pill monitor-logico-estudio__compilacion-pill--error">
            Pendiente: ${escapeHtml(compilacion.errores[0] || 'grafo incompleto')}
          </span>
        `;
      canvasFullCompilacion.title = compilacion.valido
        ? `Fórmula: ${compilacion.expresion}${simplificacion ? ` · Simplificación posible: ${simplificacion}` : ''}`
        : `Pendiente: ${compilacion.errores[0] || 'grafo incompleto'}`;
      canvasFullCompilacion.classList.toggle(
        'monitor-logico-estudio__compilacion--error',
        !compilacion.valido
      );
    }

    if (botonCanvasFullAplicar) {
      botonCanvasFullAplicar.textContent = compilacion.valido
        ? 'Aplicar fórmula al formulario'
        : 'Conecta una salida válida';
      botonCanvasFullAplicar.disabled = !compilacion.valido;
      botonCanvasFullAplicar.classList.toggle('btn-primary', compilacion.valido);
      botonCanvasFullAplicar.classList.toggle('btn-warning', !compilacion.valido);
    }

    return compilacion;
  }

  function aplicarZoomCanvasFull() {
    if (!canvasFullNodos || !canvasFullSvg) {
      return;
    }

    canvasFullNodos.style.transform = `scale(${zoomCanvasFull})`;
    canvasFullSvg.style.transform = `scale(${zoomCanvasFull})`;
    canvasFullSvg.style.transformOrigin = '0 0';

    for (const boton of botonesCanvasFullZoom) {
      if (boton.dataset.monitorLogicoGrafoZoom === 'reset') {
        boton.textContent = `${Math.round(zoomCanvasFull * 100)}%`;
      }
    }
  }

  function limiteMinimoZoomCanvasFull() {
    return window.matchMedia?.('(max-width: 720px)').matches ? 0.35 : 0.6;
  }

  function distanciaEntrePunterosCanvasFull(punteros) {
    const [primero, segundo] = [...punteros.values()];
    if (!primero || !segundo) return 0;
    return Math.hypot(segundo.x - primero.x, segundo.y - primero.y);
  }

  function dibujarConexionesCanvasFull() {
    if (!canvasFullSvg || !grafoCanvasFullBorrador) {
      return;
    }

    const nodos = new Map(
      (grafoCanvasFullBorrador.nodos || []).map((nodo) => [nodo.id, nodo])
    );

    const valores = resultadoSimulacionCanvasFull.valoresPorNodo || new Map();

    canvasFullSvg.innerHTML = (grafoCanvasFullBorrador.conexiones || [])
      .map((conexion) => {
        const origen = nodos.get(conexion.desde);
        const destino = nodos.get(conexion.hasta);

        if (!origen || !destino) {
          return '';
        }

        const puntoOrigen = obtenerCentroPuertoCanvasFull(
          origen,
          'salida',
          normalizarPuertoConexionCanvasFull(conexion, 'salida')
        );
        const puntoDestino = obtenerCentroPuertoCanvasFull(
          destino,
          'entrada',
          normalizarPuertoConexionCanvasFull(conexion, 'entrada')
        );
        const x1 = puntoOrigen.x;
        const y1 = puntoOrigen.y;
        const x2 = puntoDestino.x;
        const y2 = puntoDestino.y;
        const curva = Math.max(54, Math.abs(x2 - x1) / 2);
        const valorOrigen = valores.get(conexion.desde);
        const clase = valorOrigen === true
          ? 'monitor-logico-estudio__conexion--ok'
          : (valorOrigen === false
              ? 'monitor-logico-estudio__conexion--alerta'
              : 'monitor-logico-estudio__conexion--desconocida');

        return `<path class="${clase}" d="M ${x1} ${y1} C ${x1 + curva} ${y1}, ${x2 - curva} ${y2}, ${x2} ${y2}" />`;
      })
      .join('');
  }

  function renderizarCanvasFull() {
    if (!canvasFullNodos || !grafoCanvasFullBorrador) {
      return;
    }

    resultadoSimulacionCanvasFull = evaluarGrafoCanvasFull();
    const valores = resultadoSimulacionCanvasFull.valoresPorNodo || new Map();

    canvasFullNodos.innerHTML = (grafoCanvasFullBorrador.nodos || [])
      .map((nodo) => {
        const tipo = String(nodo.tipo || 'entrada').toLowerCase();
        const seleccionado = nodo.id === nodoCanvasFullSeleccionado;
        const origen = puertoCanvasFullOrigenConexion?.nodoId === nodo.id;
        const valor = valores.get(nodo.id);
        const simbolo = renderizarSimboloNodoCanvasFull(nodo);
        const claseValor = valor === true
          ? 'monitor-logico-estudio__nodo--ok'
          : (valor === false
              ? 'monitor-logico-estudio__nodo--alerta'
              : 'monitor-logico-estudio__nodo--desconocido');
        return `
          <div
            role="button"
            tabindex="0"
            class="monitor-logico-estudio__nodo ${esPuertaMultiEntradaCanvasFull(nodo) ? 'monitor-logico-estudio__nodo--multientrada' : ''} ${claseValor} ${seleccionado ? 'monitor-logico-estudio__nodo--seleccionado' : ''} ${origen ? 'monitor-logico-estudio__nodo--origen' : ''} ${modoDesconectarCanvasFull && nodoTieneConexionesCanvasFull(nodo.id) ? 'monitor-logico-estudio__nodo--desconectable' : ''}"
            style="left: ${Number(nodo.x || 0)}px; top: ${Number(nodo.y || 0)}px;"
            data-monitor-logico-grafo-nodo="${escapeHtml(nodo.id)}"
            aria-label="${escapeHtml(resolverEtiquetaNodoCanvasFull(nodo))}"
            title="Arrastra para mover. Click para seleccionar o conectar."
          >
            ${renderizarPuertosNodoCanvasFull(nodo)}
            <div class="monitor-logico-estudio__nodo-contenido">
              <span>${escapeHtml(resolverTipoNodoCanvasFull(nodo))}</span>
              <div class="monitor-logico-estudio__nodo-principal">
                ${simbolo}
                <strong>${escapeHtml(resolverEtiquetaNodoCanvasFull(nodo))}</strong>
              </div>
              <small class="text-body-secondary">${escapeHtml(resolverDetalleSalidaNodoCanvasFull(valor))}</small>
            </div>
          </div>
        `;
      })
      .join('');

    aplicarZoomCanvasFull();
    dibujarConexionesCanvasFull();
    renderizarSimulacionCanvasFull();
    actualizarStatusCanvasFull();
    actualizarCompilacionCanvasFull();

    for (const botonCanvasFullBorrar of botonesCanvasFullBorrar) {
      const nodo = (grafoCanvasFullBorrador.nodos || []).find(
        (item) => item.id === nodoCanvasFullSeleccionado
      );
      botonCanvasFullBorrar.disabled = !nodo || ['entrada', 'salida'].includes(nodo.tipo);
    }

    botonCanvasFullConectar?.classList.toggle('active', modoConectarCanvasFull);
    botonCanvasFullDesconectar?.classList.toggle('active', modoDesconectarCanvasFull);
    botonCanvasFullDesconectar?.classList.toggle(
      'monitor-logico-estudio__desconectar-activo',
      modoDesconectarCanvasFull
    );
    actualizarInspectorCanvasFull(valores);
  }

  function abrirCanvasFull() {
    if (!modalCanvasLogico || !window.bootstrap?.Modal) {
      window.portalToast?.show?.({
        tipo: 'error',
        titulo: 'Canvas lógico',
        cuerpo: 'No se pudo abrir el estudio visual porque Bootstrap Modal no está disponible.'
      });
      return;
    }

    grafoCanvasFullBorrador = obtenerGrafoCanvasFullBase();
    nodoCanvasFullSeleccionado = null;
    puertoCanvasFullOrigenConexion = null;
    modoConectarCanvasFull = false;
    modoDesconectarCanvasFull = false;
    nodoCanvasFullArrastrado = null;
    zoomCanvasFull = 1;
    punterosZoomCanvasFull.clear();
    gestoZoomCanvasFull = null;
    valoresSimuladosCanvasFull = {};
    renderizarCanvasFull();
    window.bootstrap.Modal.getOrCreateInstance(modalCanvasLogico).show();
  }

  function agregarNodoCanvasFull(tipo) {
    if (!grafoCanvasFullBorrador) {
      return;
    }

    const nodos = grafoCanvasFullBorrador.nodos || [];
    const variable = tipo === 'entrada' ? obtenerSiguienteVariableCanvasFull() : null;

    if (tipo === 'entrada' && !variable) {
      actualizarStatusCanvasFull('No quedan variables A-Z disponibles para añadir otra entrada.');
      return;
    }

    if (tipo === 'salida' && nodos.some((nodo) => nodo.tipo === 'salida')) {
      actualizarStatusCanvasFull('La salida es única; ya existe una salida en el grafo.');
      return;
    }

    const id = tipo === 'entrada'
      ? `entrada-${String(variable).toLowerCase()}`
      : obtenerSiguienteIdGrafo(tipo);

    nodos.push({
      id,
      tipo,
      variable,
      etiqueta: tipo === 'entrada' ? `Entrada ${variable}` : String(tipo).toUpperCase(),
      x: 120 + (nodos.length % 5) * 230,
      y: 120 + Math.floor(nodos.length / 5) * 150
    });

    grafoCanvasFullBorrador.nodos = nodos;
    grafoCanvasFullBorrador.modoCompatibilidad = 'visual';
    nodoCanvasFullSeleccionado = id;
    renderizarCanvasFull();
  }

  function seleccionarNodoCanvasFull(idNodo) {
    if (!grafoCanvasFullBorrador) {
      return;
    }

    if (modoDesconectarCanvasFull) {
      borrarConexionesNodoCanvasFull(idNodo);
      return;
    }

    if (modoConectarCanvasFull) {
      if (!puertoCanvasFullOrigenConexion) {
        nodoCanvasFullSeleccionado = idNodo;
        renderizarCanvasFull();
        actualizarStatusCanvasFull('Selecciona una salida roja para iniciar la conexión.');
        return;
      }
      return;
    }

    nodoCanvasFullSeleccionado = idNodo;
    renderizarCanvasFull();
  }

  function crearConexionCanvasFull(origen, destino) {
    if (!grafoCanvasFullBorrador || !origen || !destino) {
      return false;
    }

    if (
      origen.tipo !== 'salida' ||
      destino.tipo !== 'entrada' ||
      origen.nodoId === destino.nodoId
    ) {
      actualizarStatusCanvasFull('Conexión inválida: solo rojo salida -> verde entrada.');
      return false;
    }

    const conexiones = grafoCanvasFullBorrador.conexiones || [];
    const conexionesPrevias = conexiones.length;
    const existeMismoEnlace = conexiones.some((conexion) =>
      conexion.desde === origen.nodoId &&
      conexion.hasta === destino.nodoId &&
      normalizarPuertoConexionCanvasFull(conexion, 'salida') === origen.puertoId &&
      normalizarPuertoConexionCanvasFull(conexion, 'entrada') === destino.puertoId
    );
    const conexionesSinEntradaOcupada = conexiones.filter((conexion) =>
      !(
        conexion.hasta === destino.nodoId &&
        normalizarPuertoConexionCanvasFull(conexion, 'entrada') === destino.puertoId
      )
    );
    const habiaEntradaOcupada = conexionesSinEntradaOcupada.length !== conexionesPrevias;
    let mensajeEstado = '';

    conexionesSinEntradaOcupada.push({
      desde: origen.nodoId,
      hasta: destino.nodoId,
      puertoDesde: origen.puertoId,
      puertoHasta: destino.puertoId
    });
    grafoCanvasFullBorrador.conexiones = conexionesSinEntradaOcupada;
    grafoCanvasFullBorrador.modoCompatibilidad = 'visual';

    if (existeMismoEnlace && habiaEntradaOcupada && conexionesPrevias === conexionesSinEntradaOcupada.length) {
      mensajeEstado = 'Ese enlace ya existía.';
    } else if (habiaEntradaOcupada) {
      mensajeEstado = 'Entrada reconectada: se sustituyó el enlace anterior de ese punto verde.';
    } else {
      mensajeEstado = 'Enlace creado: salida roja conectada con entrada verde.';
    }

    puertoCanvasFullOrigenConexion = null;
    modoConectarCanvasFull = false;
    renderizarCanvasFull();
    actualizarStatusCanvasFull(mensajeEstado);
    return true;
  }

  function borrarConexionesPuertoCanvasFull(datosPuerto) {
    if (!grafoCanvasFullBorrador || !datosPuerto) {
      return;
    }

    const conexiones = grafoCanvasFullBorrador.conexiones || [];
    const filtradas = conexiones.filter((conexion) => {
      if (datosPuerto.tipo === 'salida') {
        return !(
          conexion.desde === datosPuerto.nodoId &&
          normalizarPuertoConexionCanvasFull(conexion, 'salida') === datosPuerto.puertoId
        );
      }

      if (datosPuerto.tipo === 'entrada') {
        return !(
          conexion.hasta === datosPuerto.nodoId &&
          normalizarPuertoConexionCanvasFull(conexion, 'entrada') === datosPuerto.puertoId
        );
      }

      return true;
    });

    const borradas = conexiones.length - filtradas.length;
    grafoCanvasFullBorrador.conexiones = filtradas;
    grafoCanvasFullBorrador.modoCompatibilidad = 'visual';
    puertoCanvasFullOrigenConexion = null;
    modoConectarCanvasFull = false;
    renderizarCanvasFull();
    actualizarStatusCanvasFull(
      borradas > 0
        ? `${pluralizar(borradas, 'enlace borrado', 'enlaces borrados')} desde el puerto seleccionado.`
        : 'Ese puerto no tenía enlaces que borrar.'
    );
  }

  function borrarConexionesNodoCanvasFull(idNodo) {
    if (!grafoCanvasFullBorrador || !idNodo) {
      return;
    }

    const conexiones = grafoCanvasFullBorrador.conexiones || [];
    const filtradas = conexiones.filter(
      (conexion) => conexion.desde !== idNodo && conexion.hasta !== idNodo
    );
    const borradas = conexiones.length - filtradas.length;

    if (borradas === 0) {
      actualizarStatusCanvasFull('Esta pieza no tiene enlaces que desconectar.');
      return;
    }

    grafoCanvasFullBorrador.conexiones = filtradas;
    grafoCanvasFullBorrador.modoCompatibilidad = 'visual';
    puertoCanvasFullOrigenConexion = null;
    modoConectarCanvasFull = false;
    nodoCanvasFullSeleccionado = idNodo;
    renderizarCanvasFull();
    actualizarStatusCanvasFull(
      `${pluralizar(borradas, 'enlace desconectado', 'enlaces desconectados')} de esta pieza.`
    );
  }

  function seleccionarPuertoCanvasFull(datosPuerto) {
    if (!grafoCanvasFullBorrador) {
      return;
    }

    nodoCanvasFullSeleccionado = datosPuerto.nodoId;

    if (modoDesconectarCanvasFull) {
      borrarConexionesPuertoCanvasFull(datosPuerto);
      return;
    }

    if (!puertoCanvasFullOrigenConexion) {
      if (datosPuerto.tipo !== 'salida') {
        actualizarStatusCanvasFull('Pulsa una salida iluminada para iniciar el enlace.');
        renderizarCanvasFull();
        return;
      }

      puertoCanvasFullOrigenConexion = datosPuerto;
      modoConectarCanvasFull = true;
      renderizarCanvasFull();
      actualizarStatusCanvasFull('Salida elegida: pulsa ahora una entrada iluminada para completar el enlace.');
      return;
    }

    if (datosPuerto.tipo === 'salida') {
      puertoCanvasFullOrigenConexion = datosPuerto;
      renderizarCanvasFull();
      actualizarStatusCanvasFull('Salida cambiada: pulsa ahora una entrada iluminada para completar el enlace.');
      return;
    }

    if (datosPuerto.tipo !== 'entrada' || datosPuerto.nodoId === puertoCanvasFullOrigenConexion.nodoId) {
      actualizarStatusCanvasFull('Elige una entrada iluminada de otra pieza para completar el enlace.');
      return;
    }

    crearConexionCanvasFull(puertoCanvasFullOrigenConexion, datosPuerto);
  }

  function cancelarConexionPendienteCanvasFull() {
    const habiaConexionPendiente = modoConectarCanvasFull || puertoCanvasFullOrigenConexion;
    modoConectarCanvasFull = false;
    puertoCanvasFullOrigenConexion = null;
    return habiaConexionPendiente;
  }

  function borrarNodoCanvasFullSeleccionado() {
    if (!grafoCanvasFullBorrador || !nodoCanvasFullSeleccionado) {
      return;
    }

    const nodo = (grafoCanvasFullBorrador.nodos || []).find(
      (item) => item.id === nodoCanvasFullSeleccionado
    );

    if (!nodo || ['entrada', 'salida'].includes(nodo.tipo)) {
      actualizarStatusCanvasFull(
        nodo?.tipo === 'entrada'
          ? 'Las entradas se gestionan desde los vínculos del formulario y no se borran desde el lienzo.'
          : 'La salida única no se puede borrar desde esta fase.'
      );
      return;
    }

    grafoCanvasFullBorrador.nodos = (grafoCanvasFullBorrador.nodos || [])
      .filter((item) => item.id !== nodoCanvasFullSeleccionado);
    grafoCanvasFullBorrador.conexiones = (grafoCanvasFullBorrador.conexiones || [])
      .filter((conexion) =>
        conexion.desde !== nodoCanvasFullSeleccionado &&
        conexion.hasta !== nodoCanvasFullSeleccionado
      );
    grafoCanvasFullBorrador.modoCompatibilidad = 'visual';
    nodoCanvasFullSeleccionado = null;
    puertoCanvasFullOrigenConexion = null;
    renderizarCanvasFull();
  }

  function aplicarCanvasFullAlFormulario() {
    if (!layoutCanvasLogico || !grafoCanvasFullBorrador) {
      return;
    }

    const compilacion = compilarGrafoCanvasFullAExpresion(grafoCanvasFullBorrador);
    const grafoNormalizado = {
      ...clonarObjetoPlano(grafoCanvasFullBorrador),
      expresionCompilada: compilacion.expresion || null,
      variablesUsadas: compilacion.variablesUsadas,
      valido: compilacion.valido,
      errores: compilacion.errores
    };

    layoutCanvasLogico.grafoLogico = grafoNormalizado;

    if (compilacion.valido && inputLogicoExpresion) {
      inputLogicoExpresion.value = normalizarExpresionTextoLogico(compilacion.expresion);
    }

    guardarLayoutCanvasLogico();
    actualizarTextoCanvasLogico();
    marcarFormularioComoSucio();
    refrescarVistaFormulario();
    window.portalToast?.show?.({
      tipo: compilacion.valido ? 'info' : 'warning',
      titulo: 'Canvas lógico',
      cuerpo: compilacion.valido
        ? `Grafo aplicado al formulario como: ${compilacion.expresion}.`
        : `Borrador visual aplicado, pero no se pudo compilar la fórmula: ${compilacion.errores[0] || 'grafo incompleto'}.`
    });

    if (compilacion.valido && modalCanvasLogico && window.bootstrap?.Modal) {
      window.bootstrap.Modal.getOrCreateInstance(modalCanvasLogico).hide();
    }
  }

  function actualizarTextoCanvasLogico() {
    if (canvasLogicoEntrada) {
      canvasLogicoEntrada.textContent = resolverEtiquetaMonitorLogico();
    }

    if (canvasLogicoExpresion) {
      canvasLogicoExpresion.textContent =
        String(inputLogicoExpresion?.value || '').trim() || 'Sin definir';
    }

    if (canvasLogicoCompilada) {
      const expresionCompilada = String(
        layoutCanvasLogico?.grafoLogico?.expresionCompilada || ''
      ).trim();
      const errores = Array.isArray(layoutCanvasLogico?.grafoLogico?.errores)
        ? layoutCanvasLogico.grafoLogico.errores
        : [];

      canvasLogicoCompilada.textContent =
        expresionCompilada ||
          (errores.length > 0 ? errores[0] : 'pendiente de grafo lógico');
      canvasLogicoCompilada.classList.toggle('text-danger', !expresionCompilada && errores.length > 0);
    }

    if (canvasLogicoCompatibilidad) {
      const grafo = layoutCanvasLogico?.grafoLogico || null;
      const texto = normalizarExpresionTextoLogico(inputLogicoExpresion?.value);
      const compilada = normalizarExpresionTextoLogico(grafo?.expresionCompilada);
      const tieneNodoLegacy = Array.isArray(grafo?.nodos) &&
        grafo.nodos.some((nodo) => nodo.tipo === 'expresion');
      const mostrar = Boolean(
        texto &&
          (
            !grafo ||
            tieneNodoLegacy ||
            (compilada && texto !== compilada)
          )
      );

      canvasLogicoCompatibilidad.hidden = !mostrar;
      if (mostrar) {
        const textoMensaje = canvasLogicoCompatibilidad.querySelector('span');
        if (textoMensaje) {
          textoMensaje.textContent = compilada && texto !== compilada
            ? `Expresión textual activa: ${texto}. Grafo compilado: ${compilada}.`
            : `Expresión textual activa: ${texto}. Puedes abrir el estudio visual para reconstruir un grafo si es trivial.`;
        }
      }
    }
  }

  function aplicarLayoutCanvasLogico() {
    actualizarTextoCanvasLogico();
    guardarLayoutCanvasLogico();
  }

  function inicializarCanvasLogico() {
    if (!canvasLogico) {
      return;
    }

    layoutCanvasLogico = normalizarLayoutCanvasLogico(cargarLayoutCanvasLogico());
    aplicarLayoutCanvasLogico();
  }

  function actualizarTooltipScope(contenedor, mensaje) {
    if (!contenedor || !window.bootstrap?.Tooltip) {
      return;
    }

    const instanciaExistente = window.bootstrap.Tooltip.getInstance(contenedor);

    if (!mensaje) {
      contenedor.removeAttribute('data-bs-toggle');
      contenedor.removeAttribute('data-bs-trigger');
      contenedor.removeAttribute('data-bs-placement');
      contenedor.removeAttribute('data-bs-title');
      contenedor.removeAttribute('title');
      contenedor.classList.remove('scope-select-ayuda--bloqueado');
      contenedor.setAttribute('tabindex', '-1');
      instanciaExistente?.dispose();
      return;
    }

    contenedor.dataset.bsToggle = 'tooltip';
    contenedor.dataset.bsTrigger = 'hover focus click';
    contenedor.dataset.bsPlacement = 'top';
    contenedor.dataset.bsTitle = mensaje;
    contenedor.setAttribute('title', mensaje);
    contenedor.classList.add('scope-select-ayuda--bloqueado');
    contenedor.setAttribute('tabindex', '0');

    if (instanciaExistente) {
      instanciaExistente.dispose();
    }

    new window.bootstrap.Tooltip(contenedor);
  }

  function inicializarSelectorMonitorLogico() {
    for (const enlaceIrEntradasLogicas of enlacesIrEntradasLogicas) {
      enlaceIrEntradasLogicas.addEventListener('click', function (evento) {
        evento.preventDefault();
        const destino = document.getElementById('monitor-logica-operativa');

        destino?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }

    if (!modalSelectorLogico || botonesAbrirSelectorLogico.length === 0) {
      actualizarTarjetaEntradaLogica();
      return;
    }

    const urlListado = modalSelectorLogico.dataset.urlListado || '/monitores/api/listado';
    const monitorActualId = normalizarNumero(
      modalSelectorLogico.dataset.monitorActualId
    );
    const inputBusqueda = modalSelectorLogico.querySelector(
      '[data-monitor-logico-selector-q]'
    );
    const selectorTipoModal = modalSelectorLogico.querySelector(
      '[data-monitor-logico-selector-tipo]'
    );
    const selectorActivoModal = modalSelectorLogico.querySelector(
      '[data-monitor-logico-selector-activo]'
    );
    const selectorPageSizeModal = modalSelectorLogico.querySelector(
      '[data-monitor-logico-selector-page-size]'
    );
    const selectorSortByModal = modalSelectorLogico.querySelector(
      '[data-monitor-logico-selector-sort-by]'
    );
    const botonAplicar = modalSelectorLogico.querySelector(
      '[data-monitor-logico-selector-aplicar]'
    );
    const botonLimpiar = modalSelectorLogico.querySelector(
      '[data-monitor-logico-selector-limpiar]'
    );
    const resumen = modalSelectorLogico.querySelector(
      '[data-monitor-logico-selector-resumen]'
    );
    const estadoModal = modalSelectorLogico.querySelector(
      '[data-monitor-logico-selector-estado]'
    );
    const filas = modalSelectorLogico.querySelector(
      '[data-monitor-logico-selector-filas]'
    );
    const paginaActual = modalSelectorLogico.querySelector(
      '[data-monitor-logico-selector-pagina]'
    );
    const botonesPagina = Array.from(
      modalSelectorLogico.querySelectorAll('[data-monitor-logico-selector-page-action]')
    );
    const estadoModalSelector = {
      q: '',
      tipo: '',
      activo: 'solo_activos',
      page: 1,
      pageSize: Number(selectorPageSizeModal?.value || 10),
      sortBy: selectorSortByModal?.value || 'nombre',
      sortDir: 'asc',
      totalPaginas: 1
    };
    let cargadoAlgunaVez = false;
    let temporizadorBusqueda = null;
    const monitoresSelectorPorId = new Map();

    let instanciaModal = null;

    const obtenerInstanciaModal = function () {
      if (!window.bootstrap?.Modal) {
        return null;
      }

      instanciaModal = window.bootstrap.Modal.getOrCreateInstance(
        modalSelectorLogico
      );
      return instanciaModal;
    };

    const aplicarControles = function ({ resetearPagina = false } = {}) {
      estadoModalSelector.q = inputBusqueda?.value.trim() || '';
      estadoModalSelector.tipo = selectorTipoModal?.value || '';
      estadoModalSelector.activo = selectorActivoModal?.value || 'solo_activos';
      estadoModalSelector.pageSize = Number(selectorPageSizeModal?.value || 10);
      estadoModalSelector.sortBy = selectorSortByModal?.value || 'nombre';

      if (resetearPagina) {
        estadoModalSelector.page = 1;
      }
    };

    const construirQuerySelector = function () {
      const parametros = new URLSearchParams();
      parametros.set('q', estadoModalSelector.q);
      parametros.set('tipo', estadoModalSelector.tipo);
      parametros.set('tenant_id', '');
      parametros.set('empresa_id', '');
      parametros.set('nivel_pertenencia', '');
      parametros.set('activo', estadoModalSelector.activo);
      parametros.set('page', String(estadoModalSelector.page));
      parametros.set('page_size', String(estadoModalSelector.pageSize));
      parametros.set('sort_by', estadoModalSelector.sortBy);
      parametros.set('sort_dir', estadoModalSelector.sortDir);
      return parametros.toString();
    };

    const actualizarPaginacionSelector = function () {
      if (paginaActual) {
        paginaActual.textContent =
          `Página ${estadoModalSelector.page} de ${estadoModalSelector.totalPaginas}`;
      }

      for (const boton of botonesPagina) {
        const accion = boton.dataset.monitorLogicoSelectorPageAction;

        boton.disabled =
          (accion === 'first' || accion === 'prev')
            ? estadoModalSelector.page <= 1
            : estadoModalSelector.page >= estadoModalSelector.totalPaginas;
      }
    };

    const renderizarFilasSelector = function (monitores) {
      const monitoresVisibles = (Array.isArray(monitores) ? monitores : [])
        .filter((monitor) => Number(monitor.id) !== monitorActualId);
      monitoresSelectorPorId.clear();

      if (!filas) {
        return;
      }

      if (monitoresVisibles.length === 0) {
        filas.innerHTML = `
          <tr>
            <td colspan="5" class="text-body-secondary">
              <div class="py-3 d-inline-flex align-items-center gap-2">
                <i class="bi bi-inbox" aria-hidden="true"></i>
                <span>No hay monitores seleccionables con estos filtros.</span>
              </div>
            </td>
          </tr>
        `;
        return;
      }

      filas.innerHTML = monitoresVisibles
        .map((monitor) => {
          const idMonitor = normalizarNumero(monitor.id);
          if (Number.isFinite(idMonitor) && idMonitor > 0) {
            monitoresSelectorPorId.set(String(idMonitor), monitor);
          }

          const runtime = monitor.estadoRuntime || null;
          const runtimeEtiqueta = runtime?.estado || 'sin estado';
          const tipo = String(monitor.tipo || '').toUpperCase();
          const alcance = monitor.alcanceDescripcion ||
            monitor.sitioNombre ||
            monitor.empresaNombre ||
            '-';
          const entradaSeleccionada = entradasLogicasSeleccionadas.find(
            (entrada) => entrada.monitorId === idMonitor
          );
          const estaSeleccionado = Boolean(entradaSeleccionada);

          return `
            <tr class="${estaSeleccionado ? 'monitor-logico-selector__fila--seleccionada' : ''}">
              <td>
                <div class="organizacion-entidad">
                  <span class="organizacion-entidad__titulo">
                    <span class="organizacion-entidad__icono" aria-hidden="true">
                      <i class="bi bi-hdd-network"></i>
                    </span>
                    <span>${escapeHtml(monitor.nombre || `Monitor #${monitor.id}`)}</span>
                    ${estaSeleccionado ? `
                      <span class="insignia-monitor insignia-monitor--ok monitor-logico-selector__seleccion">
                        Variable ${escapeHtml(entradaSeleccionada.variable)}
                      </span>
                    ` : ''}
                  </span>
                  <span class="organizacion-entidad__meta">
                    <span>#${escapeHtml(String(monitor.id))}</span>
                    <span class="organizacion-meta-separador" aria-hidden="true">•</span>
                    <span>${escapeHtml(monitor.descripcion || 'Sin descripción')}</span>
                  </span>
                </div>
              </td>
              <td><span class="insignia-monitor insignia-monitor--suave">${escapeHtml(tipo || 'MONITOR')}</span></td>
              <td>${escapeHtml(alcance)}</td>
              <td><span class="insignia-monitor ${runtime ? 'insignia-monitor--ok' : 'insignia-monitor--suave'}">${escapeHtml(runtimeEtiqueta)}</span></td>
              <td class="text-end">
                ${estaSeleccionado ? `
                  <div class="btn-group btn-group-sm" role="group" aria-label="Entrada lógica seleccionada">
                    <button type="button" class="btn btn-outline-success" disabled>
                      Ya seleccionado
                    </button>
                    <button
                      type="button"
                      class="btn btn-outline-danger"
                      data-monitor-logico-selector-quitar
                      data-monitor-variable="${escapeHtml(entradaSeleccionada.variable)}"
                    >
                      Quitar entrada
                    </button>
                  </div>
                ` : `
                  <button
                    type="button"
                    class="btn btn-primary btn-sm"
                    data-monitor-logico-selector-usar
                    data-monitor-id="${escapeHtml(String(monitor.id))}"
                  >
                    Añadir entrada
                  </button>
                `}
              </td>
            </tr>
          `;
        })
        .join('');
    };

    const cargarSelector = async function () {
      if (estadoModal) {
        estadoModal.textContent = 'Cargando monitores...';
      }

      try {
        const datos = await fetchJson(`${urlListado}?${construirQuerySelector()}`);
        estadoModalSelector.totalPaginas = datos.paginacion?.totalPaginas || 1;
        renderizarFilasSelector(datos.monitores || []);

        if (resumen) {
          const paginacion = datos.paginacion || {};
          resumen.textContent = paginacion.totalFiltrado > 0
            ? `Mostrando ${paginacion.desde}-${paginacion.hasta} de ${paginacion.totalFiltrado} monitores filtrados.`
            : 'No hay monitores con estos filtros.';
        }

        if (estadoModal) {
          estadoModal.textContent = '';
        }

        actualizarPaginacionSelector();
        cargadoAlgunaVez = true;
      } catch (error) {
        if (estadoModal) {
          estadoModal.textContent = error.message;
        }
        window.portalToast?.show?.({
          tipo: 'error',
          titulo: 'Selector de monitor',
          cuerpo: error.message
        });
      }
    };

    const abrirSelector = async function () {
      const modal = obtenerInstanciaModal();

      if (!modal) {
        window.portalToast?.show?.({
          tipo: 'error',
          titulo: 'Selector de monitor',
          cuerpo: 'No se pudo abrir el selector porque Bootstrap Modal no está disponible.'
        });
        return;
      }

      modal.show();

      if (!cargadoAlgunaVez) {
        aplicarControles({ resetearPagina: true });
        await cargarSelector();
      }
    };

    for (const botonAbrirSelectorLogico of botonesAbrirSelectorLogico) {
      botonAbrirSelectorLogico.addEventListener('click', abrirSelector);
    }

    botonAplicar?.addEventListener('click', async function () {
      aplicarControles({ resetearPagina: true });
      await cargarSelector();
    });

    botonLimpiar?.addEventListener('click', async function () {
      if (inputBusqueda) inputBusqueda.value = '';
      if (selectorTipoModal) selectorTipoModal.value = '';
      if (selectorActivoModal) selectorActivoModal.value = 'solo_activos';
      if (selectorPageSizeModal) selectorPageSizeModal.value = '10';
      if (selectorSortByModal) selectorSortByModal.value = 'nombre';
      aplicarControles({ resetearPagina: true });
      await cargarSelector();
    });

    inputBusqueda?.addEventListener('input', function () {
      window.clearTimeout(temporizadorBusqueda);
      temporizadorBusqueda = window.setTimeout(async function () {
        aplicarControles({ resetearPagina: true });
        await cargarSelector();
      }, 300);
    });

    for (const control of [
      selectorTipoModal,
      selectorActivoModal,
      selectorPageSizeModal,
      selectorSortByModal
    ]) {
      control?.addEventListener('change', async function () {
        aplicarControles({ resetearPagina: true });
        await cargarSelector();
      });
    }

    for (const boton of botonesPagina) {
      boton.addEventListener('click', async function () {
        const accion = boton.dataset.monitorLogicoSelectorPageAction;

        if (accion === 'first') estadoModalSelector.page = 1;
        if (accion === 'prev') {
          estadoModalSelector.page = Math.max(1, estadoModalSelector.page - 1);
        }
        if (accion === 'next') {
          estadoModalSelector.page = Math.min(
            estadoModalSelector.totalPaginas,
            estadoModalSelector.page + 1
          );
        }
        if (accion === 'last') {
          estadoModalSelector.page = estadoModalSelector.totalPaginas;
        }

        await cargarSelector();
      });
    }

    filas?.addEventListener('click', function (evento) {
      const botonQuitar = evento.target.closest('[data-monitor-logico-selector-quitar]');
      if (botonQuitar) {
        quitarEntradaMonitorLogico(botonQuitar.dataset.monitorVariable);
        cargarSelector();
        return;
      }

      const boton = evento.target.closest('[data-monitor-logico-selector-usar]');

      if (!boton) {
        return;
      }

      const monitor = monitoresSelectorPorId.get(String(boton.dataset.monitorId || ''));

      if (monitor) {
        seleccionarMonitorLogico(monitor);
        cargarSelector();
        return;
      }

      window.portalToast?.show?.({
        tipo: 'error',
        titulo: 'Selector de monitor',
        cuerpo: 'No se encontró el monitor seleccionado en la página actual. Recarga el selector y vuelve a intentarlo.'
      });
    });

    actualizarTarjetaEntradaLogica();
  }

  function reconstruirEmpresas() {
    const seleccionActual = selectorEmpresa.value || inputEmpresaFija?.value || '';
    const tenantId = obtenerValorScope(selectorTenant, inputTenantFijo);

    selectorEmpresa.innerHTML = '';

    for (const opcion of opcionesEmpresa) {
      const tenantOpcion = opcion.dataset.tenantId || '';

      if (!opcion.value || !tenantId || tenantOpcion === tenantId) {
        selectorEmpresa.appendChild(opcion.cloneNode(true));
      }
    }

    if (
      Array.from(selectorEmpresa.options).some(
        (opcion) => opcion.value === seleccionActual
      )
    ) {
      selectorEmpresa.value = seleccionActual;
    } else if (seleccionActual) {
      selectorEmpresa.value = '';
    }
  }

  function reconstruirSitios() {
    const seleccionActual = selectorSitio.value || inputSitioFijo?.value || '';
    const tenantId = obtenerValorScope(selectorTenant, inputTenantFijo);
    const empresaId = obtenerValorScope(selectorEmpresa, inputEmpresaFija);

    selectorSitio.innerHTML = '';

    for (const opcion of opcionesSitio) {
      const tenantOpcion = opcion.dataset.tenantId || '';
      const empresaOpcion = opcion.dataset.empresaId || '';

      if (
        !opcion.value ||
        (
          tenantId &&
          empresaId &&
          tenantOpcion === tenantId &&
          empresaOpcion === empresaId
        )
      ) {
        selectorSitio.appendChild(opcion.cloneNode(true));
      }
    }

    if (
      Array.from(selectorSitio.options).some(
        (opcion) => opcion.value === seleccionActual
      )
    ) {
      selectorSitio.value = seleccionActual;
    } else if (seleccionActual) {
      selectorSitio.value = '';
    }
  }

  function actualizarBloquesTipo() {
    const tipoActual = obtenerTipoActual();
    const esLogico = tipoActual === 'booleano';
    const esTelemetria = tipoActual === 'telemetria';
    const esInterno = esLogico || esTelemetria;

    if (bloqueSondeo) {
      bloqueSondeo.hidden = esInterno;
    }

    for (const campo of camposSondeo) {
      campo.disabled = esInterno;
      campo.required = !esInterno;
    }

    for (const bloque of bloquesTipo) {
      const activo = bloque.dataset.monitorBloqueTipo === tipoActual;
      bloque.hidden = !activo;

      for (const campo of bloque.querySelectorAll('[data-monitor-campo-tipo]')) {
        campo.disabled = !activo;
      }
    }

    for (const campo of camposLogicos) {
      campo.required = esLogico;
    }

    if (bloqueSemanticaEstado) {
      bloqueSemanticaEstado.hidden = esInterno;
    }

    if (selectorInterpretacionEstado) {
      selectorInterpretacionEstado.disabled = esInterno;

      if (esInterno) {
        selectorInterpretacionEstado.value = 'normal';
      }
    }

    for (const botonAbrirSelectorLogico of botonesAbrirSelectorLogico) {
      botonAbrirSelectorLogico.disabled = !esLogico;
    }

    for (const boton of botonesInsertarTokenLogico) {
      boton.disabled = !esLogico;
    }
    actualizarBotonesVariablesLogicas();

    if (botonAbrirCanvasFull) {
      botonAbrirCanvasFull.disabled = !esLogico;
    }

    if (ayudaTipo) {
      ayudaTipo.textContent = tipoActual === 'booleano'
          ? 'Combina el estado de otros monitores para obtener una única disponibilidad.'
        : tipoActual === 'telemetria'
          ? 'Elige el dato que alimenta el monitor y define cuándo una lectura requiere atención.'
        : (
            tipoActual === 'tcp'
              ? 'TCP exige destino, puerto, timeout, reintentos, validación TLS opcional y vigencia mínima del certificado cuando aplique.'
              : 'Ping exige destino, timeout, reintentos, payload y TTL.'
          );
    }

    actualizarCampoVigenciaTls(tipoActual);
    actualizarAyudaInterpretacionEstado();
    actualizarTelemetriaFormulario();
    ordenarSeccionesFormulario(tipoActual);
  }

  function ordenarSeccionesFormulario(tipoActual = obtenerTipoActual()) {
    const rejilla = formulario?.querySelector(':scope > .d-grid');

    if (!rejilla) return;

    const secciones = Object.fromEntries(
      Array.from(rejilla.querySelectorAll(':scope > [data-monitor-form-seccion]'))
        .map((seccion) => [seccion.dataset.monitorFormSeccion, seccion])
    );
    const acciones = rejilla.querySelector(':scope > .acciones-formulario');
    const orden = tipoActual === 'ping'
      ? ['identidad', 'comprobacion', 'programacion', 'contexto', 'alcance', 'impacto']
      : tipoActual === 'booleano'
        ? ['identidad', 'alcance', 'comprobacion', 'programacion', 'contexto', 'impacto']
      : ['identidad', 'contexto', 'alcance', 'programacion', 'comprobacion', 'impacto'];

    for (const clave of orden) {
      if (secciones[clave]) rejilla.append(secciones[clave]);
    }

    if (acciones) rejilla.append(acciones);
  }

  function actualizarCampoVigenciaTls(tipoActual = null) {
    if (!bloqueVigenciaTls || !inputVigenciaTls) {
      return;
    }

    const tipoActivo = tipoActual || (
      selectorTipo
        ? selectorTipo.value || tipoFijoFormulario || 'ping'
        : tipoFijoFormulario || 'ping'
    );
    const tlsActivo = Boolean(selectorUsarTls?.checked);
    const visible = tipoActivo === 'tcp' && tlsActivo;

    bloqueVigenciaTls.hidden = !visible;
    inputVigenciaTls.disabled = !visible;
  }

  function actualizarPertenencia() {
    const scopeActual = obtenerScopeActual();
    const pertenencia = selectorPertenencia
      ? selectorPertenencia.value || inputPertenenciaFija?.value || 'empresa'
      : (scopeActual.sitioId ? 'sitio' : 'empresa');
    const esSitio = pertenencia === 'sitio';
    const tenantSeleccionado = Boolean(scopeActual.tenantId);
    const empresaSeleccionada = Boolean(scopeActual.empresaId);
    const empresaBloqueada = !tenantSeleccionado && !empresaBloqueadaPorScope;
    const sitioBloqueadoPorDependencia = (!empresaSeleccionada || !esSitio) && !sitioBloqueadoPorScope;

    if (!empresaBloqueadaPorScope) {
      selectorEmpresa.disabled = !tenantSeleccionado;
    }

    if (!sitioBloqueadoPorScope) {
      selectorSitio.disabled = !empresaSeleccionada || !esSitio;
    }

    if (!empresaSeleccionada && !sitioBloqueadoPorScope) {
      selectorSitio.value = '';
    }

    if (!esSitio && !sitioBloqueadoPorScope) {
      selectorSitio.value = '';
    }

    actualizarTooltipScope(
      ayudaScopeEmpresa,
      empresaBloqueadaPorScope
        ? 'Tu alcance actual no permite cambiar la empresa desde aquí.'
        : (empresaBloqueada ? 'Selecciona antes un tenant para habilitar la empresa.' : '')
    );
    actualizarTooltipScope(
      ayudaScopeSitio,
      sitioBloqueadoPorScope
        ? 'Tu alcance actual no permite cambiar el sitio desde aquí.'
        : (
            !esSitio
              ? 'Selecciona "Monitor de sitio" para habilitar este selector.'
              : (sitioBloqueadoPorDependencia
                  ? 'Selecciona antes una empresa para habilitar el sitio.'
                  : '')
          )
    );

    if (textoAyudaScopeEmpresa) {
      textoAyudaScopeEmpresa.hidden = !(empresaBloqueada && !empresaBloqueadaPorScope);
    }

    if (textoAyudaScopeSitio) {
      const mostrarAyudaSitio = !sitioBloqueadoPorScope && (!esSitio || !empresaSeleccionada);
      textoAyudaScopeSitio.hidden = !mostrarAyudaSitio;
      if (mostrarAyudaSitio) {
        textoAyudaScopeSitio.textContent = !esSitio
          ? 'Selecciona "Monitor de sitio" para habilitar este selector.'
          : 'Selecciona antes una empresa para habilitar el sitio.';
      }
    }

    actualizarResumenVivo();
    actualizarEstadoFormulario();
  }

  selectorTenant.addEventListener('change', function () {
    reconstruirEmpresas();
    reconstruirSitios();
    actualizarPertenencia();
  });

  selectorEmpresa.addEventListener('change', function () {
    reconstruirSitios();
    actualizarPertenencia();
  });

  if (selectorTipo) {
    selectorTipo.addEventListener('change', actualizarBloquesTipo);
  }

  if (selectorUsarTls) {
    selectorUsarTls.addEventListener('change', function () {
      actualizarCampoVigenciaTls();
      marcarFormularioComoSucio();
      refrescarVistaFormulario();
    });
  }

  if (selectorPertenencia) {
    selectorPertenencia.addEventListener('change', actualizarPertenencia);
  }

  for (const boton of botonesInsertarTokenLogico) {
    boton.addEventListener('click', function () {
      insertarTokenExpresionLogica(boton.dataset.monitorLogicoInsertarToken);
    });
  }

  listaTraduccionLogica?.addEventListener('click', function (evento) {
    const boton = evento.target.closest('[data-monitor-logico-quitar-entrada]');

    if (!boton || obtenerTipoActual() !== 'booleano') {
      return;
    }

    quitarEntradaMonitorLogico(boton.dataset.monitorLogicoQuitarEntrada);
  });

  botonAbrirCanvasFull?.addEventListener('click', abrirCanvasFull);

  for (const boton of botonesCanvasFullAdd) {
    boton.addEventListener('click', function () {
      cancelarConexionPendienteCanvasFull();
      modoDesconectarCanvasFull = false;
      agregarNodoCanvasFull(boton.dataset.monitorLogicoGrafoAdd);
    });
  }

  botonCanvasFullConectar?.addEventListener('click', function () {
    const estabaActivo = Boolean(modoConectarCanvasFull || puertoCanvasFullOrigenConexion);
    cancelarConexionPendienteCanvasFull();
    modoDesconectarCanvasFull = false;
    modoConectarCanvasFull = !estabaActivo;
    renderizarCanvasFull();
    actualizarStatusCanvasFull(
      modoConectarCanvasFull
        ? 'Conectar activo: pulsa una salida iluminada.'
        : 'Conexión cancelada.'
    );
  });

  botonCanvasFullDesconectar?.addEventListener('click', function () {
    modoDesconectarCanvasFull = !modoDesconectarCanvasFull;
    cancelarConexionPendienteCanvasFull();
    renderizarCanvasFull();
    actualizarStatusCanvasFull(
      modoDesconectarCanvasFull
        ? 'Desconectar activo: pulsa una pieza para soltar todos sus enlaces o un punto para soltar solo ese enlace.'
        : ''
    );
  });

  for (const botonCanvasFullBorrar of botonesCanvasFullBorrar) {
    botonCanvasFullBorrar.addEventListener('click', function () {
      cancelarConexionPendienteCanvasFull();
      borrarNodoCanvasFullSeleccionado();
    });
  }

  botonCanvasFullAplicar?.addEventListener('click', function () {
    cancelarConexionPendienteCanvasFull();
    aplicarCanvasFullAlFormulario();
  });

  canvasFullNodos?.addEventListener('pointerdown', function (evento) {
    if (evento.target.closest('[data-monitor-logico-grafo-puerto]')) {
      return;
    }

    const nodo = evento.target.closest('[data-monitor-logico-grafo-nodo]');

    if (!nodo || !canvasFullLienzo) {
      return;
    }

    const cajaNodo = nodo.getBoundingClientRect();
    nodoCanvasFullArrastrado = {
      id: nodo.dataset.monitorLogicoGrafoNodo,
      offsetX: (evento.clientX - cajaNodo.left) / zoomCanvasFull,
      offsetY: (evento.clientY - cajaNodo.top) / zoomCanvasFull,
      inicioX: evento.clientX,
      inicioY: evento.clientY,
      movido: false
    };
    nodo.setPointerCapture(evento.pointerId);
    nodo.classList.add('monitor-logico-estudio__nodo--arrastrando');
  });

  canvasFullNodos?.addEventListener('pointermove', function (evento) {
    if (!nodoCanvasFullArrastrado) {
      return;
    }

    moverNodoCanvasFull(evento);
  });

  canvasFullNodos?.addEventListener('pointerup', function (evento) {
    if (evento.target.closest('[data-monitor-logico-grafo-puerto]')) {
      return;
    }

    const nodo = evento.target.closest('[data-monitor-logico-grafo-nodo]');

    if (!nodo || !nodoCanvasFullArrastrado) {
      return;
    }

    const idNodo = nodo.dataset.monitorLogicoGrafoNodo;
    const fueDrag = nodoCanvasFullArrastrado.movido;
    nodo.releasePointerCapture(evento.pointerId);
    nodo.classList.remove('monitor-logico-estudio__nodo--arrastrando');
    nodoCanvasFullArrastrado = null;

    if (fueDrag) {
      renderizarCanvasFull();
      return;
    }

    seleccionarNodoCanvasFull(idNodo);
  });

  canvasFullNodos?.addEventListener('pointercancel', function () {
    nodoCanvasFullArrastrado = null;
    renderizarCanvasFull();
  });

  canvasFullNodos?.addEventListener('click', function (evento) {
    const puerto = evento.target.closest('[data-monitor-logico-grafo-puerto]');

    if (!puerto) {
      return;
    }

    evento.stopPropagation();
    seleccionarPuertoCanvasFull({
      nodoId: puerto.dataset.monitorLogicoGrafoPuertoNodo,
      puertoId: puerto.dataset.monitorLogicoGrafoPuertoId,
      tipo: puerto.dataset.monitorLogicoGrafoPuertoTipo
    });
  });

  canvasFullNodos?.addEventListener('contextmenu', function (evento) {
    const puerto = evento.target.closest('[data-monitor-logico-grafo-puerto]');

    if (!puerto) {
      return;
    }

    evento.preventDefault();
    evento.stopPropagation();
    borrarConexionesPuertoCanvasFull({
      nodoId: puerto.dataset.monitorLogicoGrafoPuertoNodo,
      puertoId: puerto.dataset.monitorLogicoGrafoPuertoId,
      tipo: puerto.dataset.monitorLogicoGrafoPuertoTipo
    });
  });

  canvasFullSimulacionEntradas?.addEventListener('click', function (evento) {
    const boton = evento.target.closest('[data-monitor-logico-simulacion-variable]');

    if (!boton) {
      return;
    }

    const variable = String(boton.dataset.monitorLogicoSimulacionVariable || '')
      .trim()
      .toUpperCase();
    const valor = boton.dataset.monitorLogicoSimulacionValor;

    if (!variable) {
      return;
    }

    cancelarConexionPendienteCanvasFull();

    if (valor === 'clear') {
      delete valoresSimuladosCanvasFull[variable];
    } else {
      valoresSimuladosCanvasFull[variable] = valor === 'true';
    }

    renderizarCanvasFull();
  });

  for (const boton of botonesCanvasFullZoom) {
    boton.addEventListener('click', function () {
      const seCanceloConexion = cancelarConexionPendienteCanvasFull();
      const accion = boton.dataset.monitorLogicoGrafoZoom;
      if (accion === 'in') {
        zoomCanvasFull = Math.min(1.6, zoomCanvasFull + 0.1);
      }
      if (accion === 'out') {
        zoomCanvasFull = Math.max(limiteMinimoZoomCanvasFull(), zoomCanvasFull - 0.1);
      }
      if (accion === 'reset') {
        zoomCanvasFull = 1;
      }
      if (seCanceloConexion) {
        renderizarCanvasFull();
      } else {
        aplicarZoomCanvasFull();
      }
    });
  }

  canvasFullLienzo?.addEventListener('pointerdown', function (evento) {
    if (evento.pointerType !== 'touch') return;
    punterosZoomCanvasFull.set(evento.pointerId, { x: evento.clientX, y: evento.clientY });

    if (punterosZoomCanvasFull.size === 2) {
      gestoZoomCanvasFull = {
        distanciaInicial: distanciaEntrePunterosCanvasFull(punterosZoomCanvasFull),
        zoomInicial: zoomCanvasFull
      };
    }
  });

  canvasFullLienzo?.addEventListener('pointermove', function (evento) {
    if (!punterosZoomCanvasFull.has(evento.pointerId)) return;
    punterosZoomCanvasFull.set(evento.pointerId, { x: evento.clientX, y: evento.clientY });

    if (!gestoZoomCanvasFull || punterosZoomCanvasFull.size !== 2) return;

    const distanciaActual = distanciaEntrePunterosCanvasFull(punterosZoomCanvasFull);
    if (gestoZoomCanvasFull.distanciaInicial <= 0 || distanciaActual <= 0) return;

    evento.preventDefault();
    const escala = distanciaActual / gestoZoomCanvasFull.distanciaInicial;
    zoomCanvasFull = Math.min(
      1.6,
      Math.max(limiteMinimoZoomCanvasFull(), gestoZoomCanvasFull.zoomInicial * escala)
    );
    aplicarZoomCanvasFull();
  });

  for (const tipoEvento of ['pointerup', 'pointercancel']) {
    canvasFullLienzo?.addEventListener(tipoEvento, function (evento) {
      punterosZoomCanvasFull.delete(evento.pointerId);
      if (punterosZoomCanvasFull.size < 2) {
        gestoZoomCanvasFull = null;
      }
    });
  }

  function aplicarScopeAgenteTelemetria() {
    const opcion = selectorAgenteTelemetria?.options?.[
      selectorAgenteTelemetria.selectedIndex
    ];
    if (!opcion?.value) {
      return;
    }
    const tenantId = opcion.dataset.tenantId || '';
    const empresaId = opcion.dataset.empresaId || '';
    const sitioId = opcion.dataset.sitioId || '';

    if (!selectorTenant.disabled) {
      selectorTenant.value = tenantId;
    }
    reconstruirEmpresas();
    if (!selectorEmpresa.disabled) {
      selectorEmpresa.value = empresaId;
    }
    reconstruirSitios();
    if (!selectorSitio.disabled) {
      selectorSitio.value = sitioId;
    }
    if (selectorPertenencia && !selectorPertenencia.disabled) {
      selectorPertenencia.value = 'sitio';
    }
    actualizarPertenencia();
  }

  selectorAgenteTelemetria?.addEventListener('change', async function () {
    aplicarScopeAgenteTelemetria();
    marcarFormularioComoSucio();
    await cargarFuentesTelemetria();
  });
  selectorTipoFuenteTelemetria?.addEventListener('change', function () {
    actualizarTelemetriaFormulario();
    refrescarVistaFormulario();
  });
  selectorSenalTelemetria?.addEventListener('change', function () {
    actualizarTelemetriaFormulario();
    refrescarVistaFormulario();
  });
  selectorReglaTelemetria?.addEventListener('change', function () {
    actualizarTelemetriaFormulario();
    refrescarVistaFormulario();
  });

  if (formulario) {
    formulario.addEventListener('submit', function (evento) {
      const impacto = construirImpactoEdicionLogica();

      if (obtenerTipoActual() !== 'booleano' || impacto.severidad !== 'error') {
        return;
      }

      evento.preventDefault();
      actualizarImpactoEdicionLogica();

      window.portalToast?.show?.({
        tipo: 'error',
        titulo: 'Monitor lógico',
        cuerpo: 'Hay errores bloqueantes en la lógica antes de guardar.'
      });
    });

    for (const campo of formulario.querySelectorAll('input, select, textarea')) {
      const evento = campo.tagName === 'SELECT' ? 'change' : 'input';
      campo.addEventListener(evento, function () {
        marcarFormularioComoSucio();
        refrescarVistaFormulario();
      });
    }
  }

  entradasLogicasSeleccionadas = cargarEntradasLogicasIniciales();
  sincronizarEntradasLogicas();
  reconstruirEmpresas();
  reconstruirSitios();
  inicializarSelectorMonitorLogico();
  inicializarCanvasLogico();
  actualizarBloquesTipo();
  actualizarPertenencia();
  actualizarTarjetaEntradaLogica();
  refrescarVistaFormulario();
  renderInicialCompletado = true;
})();

function inicializarListadoMonitores(modulo) {
  const parametrosIniciales = new URLSearchParams(window.location.search);
  const urlListado = modulo.dataset.urlListado;
  const puedeEditar = modulo.dataset.puedeEditar === '1';
  const tipoFijo = String(modulo.dataset.tipoFijo || '').trim().toLowerCase();
  const contextoInterpretacion = {
    agenteId: String(modulo.dataset.agenteTelemetriaId || '').trim(),
    senalId: String(modulo.dataset.senalTelemetriaId || '').trim(),
    reglaId: String(modulo.dataset.reglaTelemetriaId || '').trim()
  };
  const catalogoTiposMonitor = parsearCatalogoTiposMonitor(
    modulo.dataset.catalogoTipos || ''
  );
  const inputBusqueda = modulo.querySelector('[data-monitores-busqueda]');
  const selectorTipo = modulo.querySelector('[data-monitores-tipo]');
  const selectorTenant = modulo.querySelector('[data-monitores-tenant]');
  const selectorEmpresa = modulo.querySelector('[data-monitores-empresa]');
  const selectorSitio = modulo.querySelector('[data-monitores-sitio]');
  const selectorPertenencia = modulo.querySelector('[data-monitores-pertenencia]');
  const selectorActivo = modulo.querySelector('[data-monitores-activo]');
  const selectorPageSize = modulo.querySelector('[data-monitores-page-size]');
  const botonesOrden = Array.from(modulo.querySelectorAll('[data-monitores-sort-by]'));
  const botonLimpiar = modulo.querySelector('[data-monitores-limpiar]');
  const filtrosActivos = modulo.querySelector('[data-monitores-filtros-activos]');
  const enlaceNuevo = modulo.querySelector('[data-monitores-nuevo]');
  const contenedorEstado = modulo.querySelector('[data-monitores-estado]');
  const contenedorFilas = modulo.querySelector('[data-monitores-filas]');
  const resumenListado = modulo.querySelector('[data-monitores-resumen-listado]');
  const etiquetaPaginaActual = modulo.querySelector('[data-monitores-pagina-actual]');
  const botonesPaginacion = Array.from(
    modulo.querySelectorAll('[data-page-action]')
  );
  const kpiTotalMonitores = document.querySelector('[data-kpi-total-monitores]');
  const kpiTotalHabilitados = document.querySelector('[data-kpi-total-habilitados]');
  const kpiTotalDeshabilitados = document.querySelector('[data-kpi-total-deshabilitados]');
  const etiquetaTipoHero = document.querySelector('[data-hero-monitores-tipo]');
  const enlacesTipoHero = Array.from(
    document.querySelectorAll('[data-hero-monitores-enlace-tipo]')
  );
  const opcionesEmpresa = Array.from(selectorEmpresa?.querySelectorAll('option') || [])
    .map((opcion) => opcion.cloneNode(true));
  const opcionesSitio = Array.from(selectorSitio?.querySelectorAll('option') || [])
    .map((opcion) => opcion.cloneNode(true));

  let temporizadorBusqueda = null;
  let solicitudActual = 0;
  const estado = {
    q: inputBusqueda?.value.trim() || '',
    tipo: tipoFijo || selectorTipo?.value || '',
    tenantId: selectorTenant?.value || '',
    empresaId: selectorEmpresa?.value || '',
    sitioId: selectorSitio?.value || parametrosIniciales.get('sitio_id') || '',
    nivelPertenencia: selectorPertenencia?.value || '',
    activo: selectorActivo?.value || 'todos',
    entradaMonitorId: parametrosIniciales.get('entrada_monitor_id') || '',
    page: Number.parseInt(parametrosIniciales.get('page') || '1', 10) || 1,
    pageSize: Number(selectorPageSize?.value || 10),
    sortBy: botonesOrden.some((boton) => boton.dataset.monitoresSortBy === parametrosIniciales.get('sort_by'))
      ? parametrosIniciales.get('sort_by')
      : 'nombre',
    sortDir: parametrosIniciales.get('sort_dir') === 'desc' ? 'desc' : 'asc',
    totalPaginas: 1
  };

  const aplicarEstadoDesdeControles = function ({ resetearPagina = false } = {}) {
    estado.q = inputBusqueda?.value.trim() || '';
    estado.tipo = tipoFijo || selectorTipo?.value || '';
    estado.tenantId = selectorTenant?.value || '';
    estado.empresaId = selectorEmpresa?.value || '';
    estado.sitioId = selectorSitio?.value || '';
    estado.nivelPertenencia = selectorPertenencia?.value || '';
    estado.activo = selectorActivo?.value || 'todos';
    estado.pageSize = Number(selectorPageSize?.value || 10);

    if (resetearPagina) {
      estado.page = 1;
    }
  };

  const reconstruirEmpresas = function () {
    if (!selectorEmpresa) {
      return;
    }

    const seleccionActual = selectorEmpresa.value;
    const tenantId = selectorTenant?.value || '';
    selectorEmpresa.innerHTML = '';

    for (const opcion of opcionesEmpresa) {
      const tenantOpcion = opcion.dataset.tenantId || '';

      if (!opcion.value || !tenantId || tenantOpcion === tenantId) {
        selectorEmpresa.appendChild(opcion.cloneNode(true));
      }
    }

    if (
      Array.from(selectorEmpresa.options).some(
        (opcion) => opcion.value === seleccionActual
      )
    ) {
      selectorEmpresa.value = seleccionActual;
    } else if (seleccionActual) {
      selectorEmpresa.value = '';
    }
    selectorEmpresa.disabled = !tenantId;
  };

  const reconstruirSitios = function () {
    if (!selectorSitio) return;
    const seleccionActual = selectorSitio.value;
    const tenantId = selectorTenant?.value || '';
    const empresaId = selectorEmpresa?.value || '';
    selectorSitio.innerHTML = '';
    for (const opcion of opcionesSitio) {
      if (!opcion.value || (tenantId && empresaId &&
          opcion.dataset.tenantId === tenantId &&
          opcion.dataset.empresaId === empresaId)) {
        selectorSitio.appendChild(opcion.cloneNode(true));
      }
    }
    selectorSitio.value = Array.from(selectorSitio.options)
      .some((opcion) => opcion.value === seleccionActual) ? seleccionActual : '';
    selectorSitio.disabled = !tenantId || !empresaId;
    if (selectorPertenencia) {
      if (selectorSitio.value) selectorPertenencia.value = '';
      selectorPertenencia.disabled = Boolean(selectorSitio.value);
    }
  };

  const restaurarJerarquiaInicial = function () {
    const sitio = opcionesSitio.find((opcion) => opcion.value === estado.sitioId);
    const empresa = opcionesEmpresa.find((opcion) => opcion.value === estado.empresaId);
    if (sitio) {
      selectorTenant.value = sitio.dataset.tenantId || '';
      reconstruirEmpresas();
      selectorEmpresa.value = sitio.dataset.empresaId || '';
    } else if (empresa && !selectorTenant.value) {
      selectorTenant.value = empresa.dataset.tenantId || '';
    }
    reconstruirEmpresas();
    reconstruirSitios();
  };

  const construirQuery = function () {
    const parametros = new URLSearchParams();
    parametros.set('q', estado.q);
    parametros.set('tipo', estado.tipo);
    parametros.set('tenant_id', estado.tenantId);
    parametros.set('empresa_id', estado.empresaId);
    parametros.set('sitio_id', estado.sitioId);
    parametros.set('nivel_pertenencia', estado.nivelPertenencia);
    parametros.set('activo', estado.activo);
    parametros.set('entrada_monitor_id', estado.entradaMonitorId);
    parametros.set('page', String(estado.page));
    parametros.set('page_size', String(estado.pageSize));
    parametros.set('sort_by', estado.sortBy);
    parametros.set('sort_dir', estado.sortDir);
    if (contextoInterpretacion.reglaId) {
      parametros.set('agente_id', contextoInterpretacion.agenteId);
      parametros.set('senal_id', contextoInterpretacion.senalId);
      parametros.set('regla_id', contextoInterpretacion.reglaId);
    }
    return parametros.toString();
  };

  const sincronizarUrl = function () {
    const url = new URL(window.location.href);

    actualizarParametro(url.searchParams, 'q', estado.q);
    actualizarParametro(url.searchParams, 'tipo', estado.tipo);
    actualizarParametro(url.searchParams, 'tenant_id', estado.tenantId);
    actualizarParametro(url.searchParams, 'empresa_id', estado.empresaId);
    actualizarParametro(url.searchParams, 'sitio_id', estado.sitioId);
    actualizarParametro(
      url.searchParams,
      'nivel_pertenencia',
      estado.nivelPertenencia
    );
    actualizarParametro(url.searchParams, 'activo', estado.activo, 'todos');
    actualizarParametro(url.searchParams, 'entrada_monitor_id', estado.entradaMonitorId);
    actualizarParametro(url.searchParams, 'page', String(estado.page), '1');
    actualizarParametro(
      url.searchParams,
      'page_size',
      String(estado.pageSize),
      '10'
    );
    actualizarParametro(url.searchParams, 'sort_by', estado.sortBy, 'nombre');
    actualizarParametro(url.searchParams, 'sort_dir', estado.sortDir, 'asc');
    if (contextoInterpretacion.reglaId) {
      url.searchParams.set('agente_id', contextoInterpretacion.agenteId);
      url.searchParams.set('senal_id', contextoInterpretacion.senalId);
      url.searchParams.set('regla_id', contextoInterpretacion.reglaId);
    }

    window.history.replaceState({}, '', url);
  };

  const actualizarFiltrosActivos = function () {
    if (!filtrosActivos) return;
    const filtros = [
      ['q', estado.q && `Búsqueda: ${estado.q}`],
      ['tipo', selectorTipo && estado.tipo && `Tipo: ${selectorTipo.selectedOptions[0]?.textContent.trim()}`],
      ['tenant', estado.tenantId && `Tenant: ${selectorTenant.selectedOptions[0]?.textContent.trim()}`],
      ['empresa', estado.empresaId && `Empresa: ${selectorEmpresa.selectedOptions[0]?.textContent.trim()}`],
      ['sitio', estado.sitioId && `Sitio: ${selectorSitio.selectedOptions[0]?.textContent.trim()}`],
      ['pertenencia', estado.nivelPertenencia && `Pertenencia: ${selectorPertenencia.selectedOptions[0]?.textContent.trim()}`],
      ['activo', estado.activo !== 'todos' && `Estado: ${selectorActivo.selectedOptions[0]?.textContent.trim()}`],
      ['entrada', estado.entradaMonitorId && `Entrada: monitor #${estado.entradaMonitorId}`]
    ].filter(([, etiqueta]) => Boolean(etiqueta));
    filtrosActivos.replaceChildren();
    filtrosActivos.hidden = filtros.length === 0;
    for (const [clave, etiqueta] of filtros) {
      const boton = document.createElement('button');
      boton.type = 'button';
      boton.className = 'monitores-filtro-activo';
      boton.dataset.quitarFiltro = clave;
      boton.setAttribute('aria-label', `Quitar filtro ${etiqueta}`);
      boton.append(document.createTextNode(etiqueta));
      const icono = document.createElement('i');
      icono.className = 'bi bi-x-lg';
      icono.setAttribute('aria-hidden', 'true');
      boton.append(icono);
      filtrosActivos.append(boton);
    }
  };

  const actualizarEnlacesTipoHero = function () {
    for (const enlace of enlacesTipoHero) {
      const tipoEnlace = enlace.dataset.heroMonitoresEnlaceTipo || '';
      const parametros = new URLSearchParams();
      if (estado.tenantId) parametros.set('tenant_id', estado.tenantId);
      if (estado.empresaId) parametros.set('empresa_id', estado.empresaId);
      if (estado.sitioId) parametros.set('sitio_id', estado.sitioId);
      if (tipoEnlace) parametros.set('tipo', tipoEnlace);
      enlace.href = `/monitores${parametros.size ? `?${parametros.toString()}` : ''}`;

      const activo = tipoEnlace === estado.tipo;
      enlace.classList.toggle('btn-light', activo);
      enlace.classList.toggle('btn-outline-light', !activo);
      if (activo) enlace.setAttribute('aria-current', 'page');
      else enlace.removeAttribute('aria-current');
    }
  };

  const actualizarResumen = function (datos) {
    const { resumen, paginacion } = datos;

    if (kpiTotalMonitores) {
      kpiTotalMonitores.textContent = String(resumen.totalMonitores);
    }

    if (kpiTotalHabilitados) {
      kpiTotalHabilitados.textContent = String(resumen.totalActivos);
    }

    if (kpiTotalDeshabilitados) {
      kpiTotalDeshabilitados.textContent = String(resumen.totalInactivos);
    }

    if (etiquetaTipoHero && selectorTipo) {
      etiquetaTipoHero.textContent =
        selectorTipo.selectedOptions?.[0]?.textContent?.trim() || 'Todos';
    }

    if (resumenListado) {
      resumenListado.textContent =
        paginacion.totalFiltrado > 0
          ? `Mostrando ${paginacion.desde}-${paginacion.hasta} de ${paginacion.totalFiltrado} monitores filtrados.`
          : 'No hay monitores para los filtros actuales.';
    }

    if (etiquetaPaginaActual) {
      etiquetaPaginaActual.textContent =
        `Página ${paginacion.pagina} de ${paginacion.totalPaginas}`;
    }

  };

  const actualizarPaginacionVisual = function () {
    for (const boton of botonesPaginacion) {
      const accion = boton.dataset.pageAction;
      let disabled = false;

      if (accion === 'first' || accion === 'prev') {
        disabled = estado.page <= 1;
      }

      if (accion === 'next' || accion === 'last') {
        disabled = estado.page >= estado.totalPaginas;
      }

      boton.disabled = disabled;
    }
  };

  const actualizarOrdenVisual = function () {
    for (const boton of botonesOrden) {
      const activo = boton.dataset.monitoresSortBy === estado.sortBy;
      boton.classList.toggle('activo', activo);
      boton.dataset.sortDir = activo ? (estado.sortDir === 'asc' ? '↑' : '↓') : '';
      boton.closest('th')?.setAttribute(
        'aria-sort',
        activo ? (estado.sortDir === 'asc' ? 'ascending' : 'descending') : 'none'
      );
    }
  };

  const renderizarFilas = function (monitores) {
    if (!monitores.length) {
      contenedorFilas.innerHTML = `
        <tr>
          <td colspan="7" class="text-body-secondary">
            <div class="py-3 d-inline-flex align-items-center gap-2">
              <i class="bi bi-inbox" aria-hidden="true"></i>
              <span>No hay monitores visibles con el filtro actual.</span>
            </div>
          </td>
        </tr>
      `;
      return;
    }

    contenedorFilas.innerHTML = monitores
      .map((monitor) => {
        const retorno = construirUrlRetorno();
        const actividadUrl =
          `/monitores/${encodeURIComponent(monitor.id)}?return_to=${encodeURIComponent(retorno)}`;
        const editarUrl =
          `/monitores/editar/${encodeURIComponent(monitor.id)}?return_to=${encodeURIComponent(retorno)}`;
        const tipoMonitor = String(monitor.tipo || '').toLowerCase();
        const definicionTipo = resolverDefinicionTipoMonitor(
          catalogoTiposMonitor,
          tipoMonitor
        );
        const claseTipoMonitor = normalizarClaseTipoMonitor(
          definicionTipo.claseCss || tipoMonitor || 'base'
        );
        const etiquetaTipoMonitor = definicionTipo.etiqueta || (
          tipoMonitor ? tipoMonitor.toUpperCase() : 'Monitor'
        );
        const iconoTipoMonitor = definicionTipo.icono || 'hdd-network';
        const metricasTecnicas = Array.isArray(monitor.resumenTecnico?.metricas)
          ? monitor.resumenTecnico.metricas
          : [];
        const metricasTecnicasVisibles = metricasTecnicas.filter((metrica) => {
          const valor = String(metrica?.valor ?? '').trim();
          return valor && valor !== '-' && valor !== '- ms';
        });
        const resumenLogico = monitor.resumenTecnico?.logica || null;
        const estadoRuntime = monitor.estadoRuntime || null;
        const resumenRuntime = estadoRuntime?.resumenHumano || null;
        const chipsTecnicos = metricasTecnicasVisibles
          .map((metrica) => `
            <span class="chip-monitor ${metrica.destacada ? 'chip-monitor--primario' : ''}">
              <small>${escapeHtml(metrica.etiqueta || '')}</small>
              <strong>${escapeHtml(metrica.valor || '-')}</strong>
            </span>
          `)
          .join('');
        const runtimeEtiqueta = estadoRuntime
          ? (resumenRuntime?.etiquetaEstado || estadoRuntime.estado || 'desconocido')
          : 'No materializado';
        const runtimeEstadoNormalizado = String(
          estadoRuntime?.estado || runtimeEtiqueta || ''
        ).trim().toLowerCase();
        const runtimeClase = !estadoRuntime
          ? 'suave'
          : ['indisponible', 'fallo', 'error', 'critico', 'crítico'].includes(runtimeEstadoNormalizado)
            ? 'alerta'
            : ['disponible', 'ok', 'normal', 'operativo', 'operativocompleto'].includes(runtimeEstadoNormalizado)
              ? 'ok'
              : 'suave';
        const runtimeTecnico = estadoRuntime
          ? (resumenRuntime?.etiquetaTecnica || estadoRuntime.codigoResultado || 'sin_resultado')
          : 'Sin estado';
        const codigoResultado = String(runtimeTecnico).trim().toLowerCase();
        const runtimeTecnicoHumano = {
          valor_en_tolerancia: 'Valor dentro de la tolerancia',
          valor_esperado: 'Valor esperado',
          booleano_false: 'Condición no satisfecha',
          booleano_true: 'Condición satisfecha',
          respuesta_icmp: 'Respuesta ICMP recibida',
          sin_resultado: 'Sin resultado'
        }[codigoResultado] || codigoResultado
          .replaceAll('_', ' ')
          .replace(/\bicmp\b/gi, 'ICMP')
          .replace(/\btcp\b/gi, 'TCP')
          .replace(/^./, (letra) => letra.toUpperCase());
        const ambitoMonitor = {
          tenant: 'Tenant',
          empresa: 'Empresa',
          sitio: 'Sitio'
        }[String(monitor.nivelPertenencia || '').trim().toLowerCase()] ||
          monitor.nivelPertenencia || '-';
        const runtimeDetalle = estadoRuntime
          ? (resumenRuntime?.detalle || estadoRuntime.mensajeResultado || 'Sin detalle operativo adicional.')
          : 'Todavía no hay estado actual materializado para este monitor.';
        const ultimaEjecucion = estadoRuntime?.fechaUltimaEjecucionUtc || '';
        const dependenciasLogicas = Array.isArray(resumenLogico?.dependencias)
          ? resumenLogico.dependencias
          : [];
        const detalleLogico = resumenLogico
          ? `
            <div class="monitor-tooltip-denso__grid monitor-tooltip-denso__grid--logico">
              <span>Expresión</span><strong>${escapeHtml(resumenLogico.expresion || 'Pendiente')}</strong>
              <span>Entrada A</span><strong>${escapeHtml(
                dependenciasLogicas[0]?.monitorId
                  ? `Monitor #${dependenciasLogicas[0].monitorId}`
                  : 'Sin dependencia visible'
              )}</strong>
              <span>Retardo</span><strong>${escapeHtml(
                Number(resumenLogico.retardoSenalSegundos || 0) > 0
                  ? `${resumenLogico.retardoSenalSegundos} s`
                  : 'sin retardo'
              )}</strong>
              <span>Estado inicial de la salida</span><strong>${escapeHtml(resumenLogico.estadoInicial || 'disponible')}</strong>
            </div>
          `
          : '';
        const scopeTexto = [
          monitor.tenantNombre || '-',
          monitor.empresaNombre || '-',
          monitor.sitioNombre || null
        ].filter(Boolean).join(' / ');
        const tooltipTecnico = chipsTecnicos
          ? `<div class="monitor-tooltip-denso__chips">${chipsTecnicos}</div>`
          : '';
        const acciones = puedeEditar
          ? `
            <div class="dropup monitores-tabla__acciones">
              <button
                type="button"
                class="btn btn-outline-secondary btn-sm monitores-tabla__acciones-toggle"
                data-bs-toggle="dropdown"
                data-bs-auto-close="outside"
                aria-expanded="false"
                aria-label="Acciones de ${escapeHtml(monitor.nombre)}"
              >
                <i class="bi bi-gear" aria-hidden="true"></i>
              </button>
              <div class="dropdown-menu dropdown-menu-end monitores-tabla__acciones-menu">
                <a href="${escapeHtml(actividadUrl)}" class="dropdown-item d-flex align-items-center gap-2">
                  <i class="bi bi-activity" aria-hidden="true"></i>
                  <span>Ver actividad operativa</span>
                </a>
                <a href="${escapeHtml(editarUrl)}" class="dropdown-item d-flex align-items-center gap-2">
                  <i class="bi bi-pencil-square" aria-hidden="true"></i>
                  <span>Gestionar monitor</span>
                </a>
                <button type="button" class="dropdown-item dropdown-item--danger d-flex align-items-center gap-2" data-monitores-eliminar="${escapeHtml(String(monitor.id))}" data-monitores-eliminar-nombre="${escapeHtml(monitor.nombre)}">
                  <i class="bi bi-trash3" aria-hidden="true"></i>
                  <span>Eliminar…</span>
                </button>
              </div>
            </div>
          `
          : `
            <div class="monitores-tabla__acciones">
              <a href="${escapeHtml(actividadUrl)}" class="btn btn-outline-secondary btn-sm monitores-tabla__acciones-toggle" aria-label="Ver actividad de ${escapeHtml(monitor.nombre)}">
                <i class="bi bi-activity" aria-hidden="true"></i>
              </a>
            </div>
          `;

        return `
          <tr class="monitores-tabla__fila">
            <td class="monitores-tabla__monitor">
              <div class="organizacion-entidad monitores-tabla__entidad" tabindex="0">
                <span class="organizacion-entidad__titulo">
                  <span class="organizacion-entidad__icono" aria-hidden="true">
                    <i class="bi bi-${escapeHtml(iconoTipoMonitor)}"></i>
                  </span>
                  <span title="${escapeHtml(monitor.nombre)}">${escapeHtml(monitor.nombre)}</span>
                </span>
                <span class="organizacion-entidad__meta">
                  <span>#${escapeHtml(String(monitor.id))}</span>
                  <span class="organizacion-meta-separador" aria-hidden="true">•</span>
                  <span>${escapeHtml(monitor.descripcion || 'Sin descripción')}</span>
                </span>
                <small class="monitores-tabla__cadencia-movil">Cadencia: ${escapeHtml(String(monitor.intervaloEjecucionSegundos))} s</small>
                <div class="monitor-tooltip-denso" role="tooltip">
                  <div class="monitor-tooltip-denso__cabecera">
                    <strong>${escapeHtml(monitor.nombre)}</strong>
                    <span class="insignia-monitor insignia-monitor--${escapeHtml(claseTipoMonitor)}">${escapeHtml(etiquetaTipoMonitor)}</span>
                  </div>
                  <div class="monitor-tooltip-denso__grid">
                    <span>ID</span><strong>#${escapeHtml(String(monitor.id))}</strong>
                    <span>Tenant</span><strong>${escapeHtml(monitor.tenantNombre || '-')}</strong>
                    <span>Empresa</span><strong>${escapeHtml(monitor.empresaNombre || '-')}</strong>
                    <span>Sitio</span><strong>${escapeHtml(monitor.sitioNombre || 'No aplica')}</strong>
                    <span>Ámbito</span><strong>${escapeHtml(ambitoMonitor)}</strong>
                    <span>Cadencia</span><strong>${escapeHtml(String(monitor.intervaloEjecucionSegundos))} s</strong>
                    <span>Desfase</span><strong>${escapeHtml(String(monitor.desfaseInicialSegundos))} s</strong>
                    <span>Estado operativo</span><strong>${escapeHtml(runtimeEtiqueta)}</strong>
                    <span>Resultado</span><strong>${escapeHtml(runtimeTecnicoHumano)}</strong>
                    <span>Última ejecución</span><strong><time data-fecha-utc="${escapeHtml(ultimaEjecucion)}">${escapeHtml(ultimaEjecucion || 'No ejecutado')}</time></strong>
                  </div>
                  ${tooltipTecnico}
                  ${detalleLogico}
                  <p>${escapeHtml(runtimeDetalle)}</p>
                </div>
              </div>
            </td>
            <td class="monitores-tabla__tipo">
              <span class="insignia-monitor insignia-monitor--${escapeHtml(claseTipoMonitor)}">${escapeHtml(etiquetaTipoMonitor)}</span>
              ${resumenLogico ? '<small class="monitores-tabla__tipo-detalle">Derivado</small>' : ''}
            </td>
            <td>
              <span class="monitores-tabla__scope" title="${escapeHtml(scopeTexto || '-')}">${escapeHtml(scopeTexto || '-')}</span>
              <small>${escapeHtml(monitor.nivelPertenencia || '-')}</small>
            </td>
            <td class="monitores-tabla__estado">
              <span class="insignia-monitor ${monitor.activo ? 'insignia-monitor--ok' : 'insignia-monitor--advertencia'}">${monitor.activo ? 'Habilitado' : 'Deshabilitado'}</span>
            </td>
            <td class="monitores-tabla__runtime">
              <span class="insignia-monitor insignia-monitor--${runtimeClase}">${escapeHtml(runtimeEtiqueta)}</span>
              <small>${escapeHtml(runtimeTecnicoHumano)}</small>
            </td>
            <td>
              <span class="organizacion-celda-fecha">
                <i class="bi bi-clock-history" aria-hidden="true"></i>
                <time data-fecha-utc="${escapeHtml(monitor.fechaActualizacion || '')}">${escapeHtml(monitor.fechaActualizacion || '')}</time>
              </span>
            </td>
            <td class="text-center">${acciones}</td>
          </tr>
        `;
      })
      .join('');

    window.portalFechas?.hidratar?.();
  };

  const cargar = async function () {
    const numeroSolicitud = ++solicitudActual;
    actualizarFiltrosActivos();
    contenedorEstado.textContent = 'Cargando monitores...';
    contenedorFilas.innerHTML = '';

    try {
      const datos = await fetchJson(`${urlListado}?${construirQuery()}`);
      if (numeroSolicitud !== solicitudActual) return;
      estado.totalPaginas = datos.paginacion.totalPaginas;
      renderizarFilas(datos.monitores || []);
      actualizarResumen(datos);
      actualizarPaginacionVisual();
      actualizarOrdenVisual();
      sincronizarUrl();
      actualizarEnlacesTipoHero();
      actualizarEnlaceNuevo();

      contenedorEstado.textContent =
        (datos.monitores || []).length > 0
          ? ''
          : 'No hay monitores visibles con el filtro actual.';
    } catch (error) {
      if (numeroSolicitud !== solicitudActual) return;
      contenedorEstado.textContent = error.message;
      window.portalToast?.show({
        tipo: 'error',
        titulo: 'No se pudo cargar el catálogo',
        cuerpo: error.message
      });
    }
  };

  const construirUrlRetorno = function () {
    const url = new URL(window.location.href);

    actualizarParametro(url.searchParams, 'q', estado.q);
    actualizarParametro(url.searchParams, 'tipo', estado.tipo);
    actualizarParametro(url.searchParams, 'tenant_id', estado.tenantId);
    actualizarParametro(url.searchParams, 'empresa_id', estado.empresaId);
    actualizarParametro(url.searchParams, 'sitio_id', estado.sitioId);
    actualizarParametro(
      url.searchParams,
      'nivel_pertenencia',
      estado.nivelPertenencia
    );
    actualizarParametro(url.searchParams, 'activo', estado.activo, 'todos');
    actualizarParametro(url.searchParams, 'page', String(estado.page), '1');
    actualizarParametro(
      url.searchParams,
      'page_size',
      String(estado.pageSize),
      '10'
    );
    actualizarParametro(url.searchParams, 'sort_by', estado.sortBy, 'nombre');
    actualizarParametro(url.searchParams, 'sort_dir', estado.sortDir, 'asc');
    if (contextoInterpretacion.reglaId) {
      url.searchParams.set('agente_id', contextoInterpretacion.agenteId);
      url.searchParams.set('senal_id', contextoInterpretacion.senalId);
      url.searchParams.set('regla_id', contextoInterpretacion.reglaId);
    }

    return `${url.pathname}${url.search}`;
  };

  const modalEliminacionNodo = document.querySelector('[data-monitores-modal-eliminacion]');
  if (puedeEditar && modalEliminacionNodo) {
    const identidad = modalEliminacionNodo.querySelector('[data-monitores-eliminacion-identidad]');
    const cargando = modalEliminacionNodo.querySelector('[data-monitores-eliminacion-cargando]');
    const errorNodo = modalEliminacionNodo.querySelector('[data-monitores-eliminacion-error]');
    const contenido = modalEliminacionNodo.querySelector('[data-monitores-eliminacion-impacto]');
    const dependientes = modalEliminacionNodo.querySelector('[data-monitores-eliminacion-dependientes]');
    const descripcionDependientes = modalEliminacionNodo.querySelector('[data-monitores-dependientes-descripcion]');
    const ejecucionesConservadas = modalEliminacionNodo.querySelector('[data-monitores-ejecuciones-conservadas]');
    const confirmar = modalEliminacionNodo.querySelector('[data-monitores-eliminacion-confirmar]');
    const inputId = modalEliminacionNodo.querySelector('[data-monitores-eliminacion-id]');
    const inputRetorno = modalEliminacionNodo.querySelector('[data-monitores-eliminacion-retorno]');
    const formatoCantidad = new Intl.NumberFormat('es-ES');
    let solicitudImpacto = 0;

    document.addEventListener('click', async function (evento) {
      const boton = evento.target.closest('[data-monitores-eliminar]');
      if (!boton) return;

      const idMonitor = Number(boton.dataset.monitoresEliminar);
      if (!Number.isSafeInteger(idMonitor) || idMonitor <= 0) return;
      for (const toggle of document.querySelectorAll('.monitores-tabla__acciones-toggle.show')) {
        window.bootstrap.Dropdown.getInstance(toggle)?.hide();
      }
      const solicitudActualImpacto = ++solicitudImpacto;
      inputId.value = String(idMonitor);
      inputRetorno.value = construirUrlRetorno();
      identidad.textContent = `#${idMonitor} · ${boton.dataset.monitoresEliminarNombre || 'Monitor'}`;
      confirmar.disabled = true;
      cargando.classList.remove('d-none');
      errorNodo.classList.add('d-none');
      contenido.classList.add('d-none');
      dependientes.classList.add('d-none');
      window.bootstrap.Modal.getOrCreateInstance(modalEliminacionNodo).show();

      try {
        const datos = await fetchJson(`/monitores/${idMonitor}/impacto-eliminacion`);
        if (solicitudActualImpacto !== solicitudImpacto) return;
        const impacto = datos.impacto || {};
        for (const nodo of modalEliminacionNodo.querySelectorAll('[data-monitores-impacto]')) {
          const cantidad = Number(impacto[nodo.dataset.monitoresImpacto] || 0);
          nodo.textContent = formatoCantidad.format(cantidad);
        }
        const totalEjecuciones = Number(impacto.ejecucionesTriggersConservadas || 0);
        ejecucionesConservadas.textContent = totalEjecuciones === 0
          ? 'No hay ejecuciones de triggers asociadas a este monitor.'
          : `${formatoCantidad.format(totalEjecuciones)} ${totalEjecuciones === 1 ? 'ejecución' : 'ejecuciones'} de triggers ya ${totalEjecuciones === 1 ? 'registrada' : 'registradas'}. ${totalEjecuciones === 1 ? 'Perderá' : 'Perderán'} la referencia directa al monitor.`;
        const totalDependientes = Number(impacto.monitoresLogicosDependientes || 0);
        descripcionDependientes.textContent = totalDependientes === 1
          ? 'monitor lógico usa este monitor como entrada. Seguirá existiendo, pero perderá esa señal.'
          : 'monitores lógicos usan este monitor como entrada. Seguirán existiendo, pero perderán esa señal.';
        dependientes.classList.toggle(
          'd-none',
          totalDependientes === 0
        );
        cargando.classList.add('d-none');
        contenido.classList.remove('d-none');
        confirmar.disabled = false;
      } catch (error) {
        if (solicitudActualImpacto !== solicitudImpacto) return;
        cargando.classList.add('d-none');
        errorNodo.textContent = error.message || 'No se pudo calcular el impacto.';
        errorNodo.classList.remove('d-none');
      }
    });

    modalEliminacionNodo.addEventListener('hidden.bs.modal', function () {
      solicitudImpacto += 1;
      confirmar.disabled = true;
      inputId.value = '';
      inputRetorno.value = '';
    });
  }

  const actualizarEnlaceNuevo = function () {
    if (!enlaceNuevo) {
      return;
    }

    const parametros = new URLSearchParams();

    if (estado.tipo) {
      parametros.set('tipo', estado.tipo);
    }
    if (contextoInterpretacion.reglaId) {
      parametros.set('agente_id', contextoInterpretacion.agenteId);
      parametros.set('senal_id', contextoInterpretacion.senalId);
      parametros.set('regla_id', contextoInterpretacion.reglaId);
    }

    parametros.set('return_to', construirUrlRetorno());
    enlaceNuevo.href = `/monitores/nuevo?${parametros.toString()}`;
  };

  const programarCarga = function () {
    window.clearTimeout(temporizadorBusqueda);
    temporizadorBusqueda = window.setTimeout(async function () {
      aplicarEstadoDesdeControles({ resetearPagina: true });
      await cargar();
    }, 240);
  };

  if (inputBusqueda) {
    inputBusqueda.addEventListener('input', programarCarga);
  }

  if (selectorTipo) {
    selectorTipo.addEventListener('change', async function () {
      aplicarEstadoDesdeControles({ resetearPagina: true });
      await cargar();
    });
  }

  if (selectorTenant) {
    selectorTenant.addEventListener('change', async function () {
      reconstruirEmpresas();
      reconstruirSitios();
      aplicarEstadoDesdeControles({ resetearPagina: true });
      await cargar();
    });
  }

  if (selectorEmpresa) {
    selectorEmpresa.addEventListener('change', async function () {
      reconstruirSitios();
      aplicarEstadoDesdeControles({ resetearPagina: true });
      await cargar();
    });
  }

  if (selectorSitio) {
    selectorSitio.addEventListener('change', async function () {
      if (selectorPertenencia && selectorSitio.value) selectorPertenencia.value = '';
      if (selectorPertenencia) selectorPertenencia.disabled = Boolean(selectorSitio.value);
      aplicarEstadoDesdeControles({ resetearPagina: true });
      await cargar();
    });
  }

  if (selectorPertenencia) {
    selectorPertenencia.addEventListener('change', async function () {
      if (selectorPertenencia.value === 'empresa' && selectorSitio) selectorSitio.value = '';
      aplicarEstadoDesdeControles({ resetearPagina: true });
      await cargar();
    });
  }

  if (selectorActivo) {
    selectorActivo.addEventListener('change', async function () {
      aplicarEstadoDesdeControles({ resetearPagina: true });
      await cargar();
    });
  }

  if (selectorPageSize) {
    selectorPageSize.addEventListener('change', async function () {
      aplicarEstadoDesdeControles({ resetearPagina: true });
      await cargar();
    });
  }

  for (const boton of botonesOrden) {
    boton.addEventListener('click', async function () {
      const columna = boton.dataset.monitoresSortBy;
      if (estado.sortBy === columna) {
        estado.sortDir = estado.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        estado.sortBy = columna;
        estado.sortDir = 'asc';
      }
      estado.page = 1;
      await cargar();
    });
  }

  if (botonLimpiar) {
    botonLimpiar.addEventListener('click', async function () {
      if (inputBusqueda) inputBusqueda.value = '';
      if (selectorTipo) selectorTipo.value = tipoFijo;
      if (selectorTenant) selectorTenant.value = '';
      reconstruirEmpresas();
      if (selectorEmpresa) selectorEmpresa.value = '';
      reconstruirSitios();
      if (selectorSitio) selectorSitio.value = '';
      estado.sitioId = '';
      estado.entradaMonitorId = '';
      if (selectorPertenencia) selectorPertenencia.value = '';
      if (selectorActivo) selectorActivo.value = 'todos';
      if (selectorPageSize) selectorPageSize.value = '10';
      estado.sortBy = 'nombre';
      estado.sortDir = 'asc';
      aplicarEstadoDesdeControles({ resetearPagina: true });
      await cargar();
    });
  }

  filtrosActivos?.addEventListener('click', async function (evento) {
    const boton = evento.target.closest('[data-quitar-filtro]');
    if (!boton) return;
    const clave = boton.dataset.quitarFiltro;
    if (clave === 'q') inputBusqueda.value = '';
    if (clave === 'tipo' && selectorTipo) selectorTipo.value = '';
    if (clave === 'tenant') {
      selectorTenant.value = '';
      reconstruirEmpresas();
      selectorEmpresa.value = '';
      reconstruirSitios();
      selectorSitio.value = '';
    }
    if (clave === 'empresa') {
      selectorEmpresa.value = '';
      reconstruirSitios();
      selectorSitio.value = '';
    }
    if (clave === 'sitio') {
      selectorSitio.value = '';
      if (selectorPertenencia) selectorPertenencia.disabled = false;
    }
    if (clave === 'pertenencia') selectorPertenencia.value = '';
    if (clave === 'activo') selectorActivo.value = 'todos';
    if (clave === 'entrada') estado.entradaMonitorId = '';
    aplicarEstadoDesdeControles({ resetearPagina: true });
    await cargar();
  });

  for (const boton of botonesPaginacion) {
    boton.addEventListener('click', async function () {
      const accion = boton.dataset.pageAction;

      if (accion === 'first') estado.page = 1;
      if (accion === 'prev') estado.page = Math.max(1, estado.page - 1);
      if (accion === 'next') estado.page = Math.min(estado.totalPaginas, estado.page + 1);
      if (accion === 'last') estado.page = estado.totalPaginas;

      await cargar();
    });
  }

  (async function init() {
    restaurarJerarquiaInicial();
    aplicarEstadoDesdeControles({ resetearPagina: false });
    actualizarEnlaceNuevo();
    await cargar();
  })().catch(function (error) {
    window.portalToast?.show({
      tipo: 'error',
      titulo: 'Error al preparar el catálogo',
      cuerpo: error.message
    });
  });
}

function actualizarParametro(searchParams, clave, valor, porDefecto = '') {
  const normalizado = String(valor ?? '');

  if (!normalizado || normalizado === String(porDefecto)) {
    searchParams.delete(clave);
    return;
  }

  searchParams.set(clave, normalizado);
}

async function fetchJson(url, opciones = {}) {
  const respuesta = await window.fetch(url, {
    headers: {
      accept: 'application/json',
      ...(opciones.headers || {})
    },
    ...opciones
  });

  const texto = await respuesta.text();
  let datos = null;

  try {
    datos = texto ? JSON.parse(texto) : {};
  } catch (_error) {
    throw new Error(texto || 'La respuesta del servidor no es válida.');
  }

  if (!respuesta.ok || datos.ok === false) {
    throw new Error(datos.mensaje || 'La operación no se ha podido completar.');
  }

  return datos;
}

function parsearCatalogoTiposMonitor(valor) {
  try {
    const catalogo = valor ? JSON.parse(valor) : {};
    const tipos = Array.isArray(catalogo.tipos) ? catalogo.tipos : [];
    const fallback = catalogo.fallback && typeof catalogo.fallback === 'object'
      ? catalogo.fallback
      : {};

    return {
      fallback: {
        valor: 'base',
        etiqueta: 'Monitor',
        descripcion: 'Tipo de monitor sin visual específica.',
        icono: 'hdd-network',
        claseCss: 'base',
        ...fallback
      },
      tipos: tipos.map((tipo) => ({
        valor: String(tipo?.valor || '').trim().toLowerCase(),
        etiqueta: String(tipo?.etiqueta || tipo?.valor || 'Monitor').trim(),
        descripcion: String(tipo?.descripcion || '').trim(),
        icono: String(tipo?.icono || 'hdd-network').trim(),
        claseCss: String(tipo?.claseCss || tipo?.valor || 'base').trim()
      }))
    };
  } catch (_error) {
    return {
      fallback: {
        valor: 'base',
        etiqueta: 'Monitor',
        descripcion: 'Tipo de monitor sin visual específica.',
        icono: 'hdd-network',
        claseCss: 'base'
      },
      tipos: []
    };
  }
}

function resolverDefinicionTipoMonitor(catalogo, tipoMonitor) {
  const tipoNormalizado = String(tipoMonitor || '').trim().toLowerCase();
  const definicion = catalogo.tipos.find((tipo) => tipo.valor === tipoNormalizado);

  if (definicion) {
    return definicion;
  }

  return {
    ...catalogo.fallback,
    etiqueta: tipoNormalizado ? tipoNormalizado.toUpperCase() : catalogo.fallback.etiqueta,
    claseCss: catalogo.fallback.claseCss
  };
}

function normalizarClaseTipoMonitor(valor) {
  const normalizada = String(valor || 'base')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalizada || 'base';
}

function escapeHtml(texto) {
  return String(texto)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
