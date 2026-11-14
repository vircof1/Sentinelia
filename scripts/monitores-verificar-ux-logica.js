import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const raiz = resolve(import.meta.dirname, '..');

function leer(rutaRelativa) {
  return readFileSync(resolve(raiz, rutaRelativa), 'utf8');
}

function assertIncluye(contenido, fragmento, descripcion) {
  assert.ok(
    contenido.includes(fragmento),
    `${descripcion}: falta "${fragmento}".`
  );
}

function assertOrden(contenido, primero, segundo, descripcion) {
  const indicePrimero = contenido.indexOf(primero);
  const indiceSegundo = contenido.indexOf(segundo);

  assert.notEqual(
    indicePrimero,
    -1,
    `${descripcion}: falta primer fragmento "${primero}".`
  );
  assert.notEqual(
    indiceSegundo,
    -1,
    `${descripcion}: falta segundo fragmento "${segundo}".`
  );
  assert.ok(
    indicePrimero < indiceSegundo,
    `${descripcion}: "${primero}" debe aparecer antes que "${segundo}".`
  );
}

function assertNoIncluye(contenido, fragmento, descripcion) {
  assert.ok(
    !contenido.includes(fragmento),
    `${descripcion}: no debe aparecer "${fragmento}".`
  );
}

function verificarFormularioSinIdsManuales(vista) {
  assertIncluye(
    vista,
    'data-monitor-logico-abrir-selector',
    'El formulario lógico debe abrir selector humano de monitor origen'
  );
  assertIncluye(
    vista,
    'Añadir entrada',
    'El CTA principal debe evitar pedir una ID técnica'
  );
  assertIncluye(
    vista,
    '<div class="col-12 col-lg-4" hidden>',
    'La ID técnica de dependencia debe quedar oculta'
  );
  assertIncluye(
    vista,
    'name="dependencia_monitor_id_logica"',
    'La dependencia técnica debe seguir enviándose al backend'
  );
  assertIncluye(
    vista,
    'name="dependencias_logicas"',
    'El formulario debe enviar la lista rica de entradas lógicas'
  );
  assertIncluye(
    vista,
    'data-monitor-logico-dependencias-json',
    'El cliente debe mantener sincronizado el JSON de dependencias lógicas'
  );
  assertIncluye(
    vista,
    'data-monitor-logico-selector-modal',
    'Debe existir modal AJAX para buscar monitores'
  );
  assertIncluye(
    vista,
    'data-url-listado="/monitores/api/listado"',
    'El modal debe consumir el endpoint AJAX paginado de monitores'
  );
  assertIncluye(
    javascriptMonitores,
    'monitor-logico-selector__fila--seleccionada',
    'El selector debe marcar visualmente los monitores ya usados como entradas'
  );
  assertIncluye(
    javascriptMonitores,
    'Ya seleccionado',
    'El selector debe evitar añadir dos veces el mismo monitor sin contexto'
  );
  assertIncluye(
    javascriptMonitores,
    'Quitar entrada',
    'El selector debe permitir retirar una entrada lógica ya seleccionada'
  );
  assertIncluye(
    javascriptMonitores,
    'data-monitor-logico-selector-quitar',
    'El selector debe exponer una acción específica para quitar entradas'
  );
  assertIncluye(
    javascriptMonitores,
    'seleccionarMonitorLogico(monitor);\n        cargarSelector();',
    'Seleccionar un monitor debe refrescar el selector sin cerrar el modal'
  );
  assertNoIncluye(
    javascriptMonitores,
    'seleccionarMonitorLogico(monitor);\n        obtenerInstanciaModal()?.hide();',
    'El selector múltiple no debe cerrarse al añadir una entrada'
  );
  assertIncluye(
    javascriptMonitores,
    'data-monitor-logico-quitar-entrada',
    'La traducción de variables debe permitir quitar entradas sin reabrir el selector'
  );
  assertIncluye(
    javascriptMonitores,
    'Variable ${escapeHtml(entradaSeleccionada.variable)}',
    'El selector debe mostrar qué variable ocupa cada monitor seleccionado'
  );
  assertOrden(
    vista,
    'data-monitor-logico-selector-modal',
    '<script src="/js/monitores.js',
    'El modal debe estar renderizado antes del JavaScript que lo inicializa'
  );
  assertNoIncluye(
    vista,
    '5.17b.1',
    'La UI no debe filtrar referencias internas del roadmap al usuario'
  );
}

function verificarTablaVariablesSiempreVisible(vista) {
  assertIncluye(
    vista,
    'Entradas de la regla',
    'El formulario debe mostrar tabla de traducción de variables'
  );
  assertIncluye(vista, '<dt>A</dt>', 'La variable A debe ser visible');
  assertIncluye(vista, '<dt>B</dt>', 'La variable B reservada debe ser visible');
  assertIncluye(vista, '<dt>C</dt>', 'La variable C reservada debe ser visible');
  assertIncluye(
    vista,
    'monitor-logico-traduccion__fila--reservada',
    'Las variables futuras deben mostrarse como reservadas, no desaparecer'
  );
  assertNoIncluye(
    vista,
    'data-monitor-logico-variable-token',
    'El formulario ya no debe mostrar botones redundantes para insertar variables'
  );
  assertNoIncluye(
    vista,
    'Equivalencias rápidas',
    'La ayuda de sintaxis debe vivir fuera del formulario principal cuando manda el estudio visual'
  );
  assertNoIncluye(
    vista,
    'data-monitor-logico-insertar-token',
    'El usuario no debe escribir la fórmula desde el formulario principal'
  );
  assertNoIncluye(
    vista,
    'data-monitor-logico-mini-simulador',
    'La simulación debe permanecer en el estudio visual y no duplicarse en el formulario'
  );
}

function verificarCanvasYSimulacionNoPersistenRuntime(vista, editorVisual, javascript) {
  assertIncluye(
    vista,
    "include('parciales/monitor-logico-editor-visual'",
    'El formulario debe delegar el editor visual en un EJS dedicado'
  );
  assertIncluye(
    editorVisual,
    'name="layout_visual_logico"',
    'El layout visual debe persistirse en un campo propio'
  );
  assertIncluye(
    editorVisual,
    'Regla visual',
    'El formulario debe mostrar un resumen del estudio visual, no un canvas pequeño no fiel'
  );
  assertIncluye(
    editorVisual,
    'data-monitor-logico-canvas-abrir-full',
    'El resumen debe abrir el estudio visual real'
  );
  assertIncluye(
    editorVisual,
    'Abrir editor lógico',
    'El CTA del estudio visual debe expresar la tarea, no el tamaño del modal'
  );
  assertNoIncluye(
    editorVisual,
    'Diseñar en grande',
    'El CTA del estudio visual no debe sonar a simple zoom'
  );
  assertIncluye(
    editorVisual,
    'monitor-logico-canvas__resumen',
    'El formulario debe resumir la expresión aplicada sin pintar un grafo falso'
  );
  assertNoIncluye(
    editorVisual,
    'Entrada principal',
    'El resumen visual no debe sugerir una entrada principal falsa'
  );
  assertNoIncluye(
    editorVisual,
    'Disponible / indisponible',
    'El resumen visual no debe explicar una salida evidente'
  );
  assertNoIncluye(
    editorVisual,
    'data-monitor-logico-canvas-lienzo',
    'El formulario no debe renderizar el canvas pequeño legacy'
  );
  assertNoIncluye(
    editorVisual,
    'data-monitor-logico-canvas-nodo',
    'El formulario no debe renderizar nodos arrastrables legacy fuera del estudio visual'
  );
  assertNoIncluye(
    editorVisual,
    'La simulación vive dentro del estudio visual',
    'La tarjeta compacta no debe repetir una explicación evidente sobre simulación'
  );
  assertIncluye(
    editorVisual,
    'data-monitor-logico-canvas-compilada',
    'El canvas debe mostrar la expresión compilada cuando exista diagnóstico de grafo'
  );
  assertIncluye(
    editorVisual,
    'data-monitor-logico-canvas-compatibilidad',
    'El canvas debe avisar cuando trabaja en modo textual compatible'
  );
  assertIncluye(
    editorVisual,
    'data-monitor-logico-canvas-modal',
    'El editor visual debe exponer un modal full-window para diseñar el grafo'
  );
  assertIncluye(
    editorVisual,
    'modal-fullscreen',
    'El estudio visual debe abrirse en un modal de pantalla completa'
  );
  assertIncluye(
    editorVisual,
    'data-monitor-logico-grafo-add="and"',
    'La paleta del estudio visual debe permitir añadir una puerta AND'
  );
  assertIncluye(
    editorVisual,
    'data-monitor-logico-grafo-conectar',
    'El estudio visual debe declarar un modo de conexión entre nodos'
  );
  assertIncluye(
    editorVisual,
    'data-monitor-logico-grafo-aplicar',
    'El borrador visual debe aplicarse explícitamente al formulario'
  );
  assertIncluye(
    editorVisual,
    'data-monitor-logico-grafo-simulacion',
    'El estudio visual debe tener zona de simulación de grafo'
  );
  assertIncluye(
    editorVisual,
    'data-monitor-logico-grafo-simulacion-entradas',
    'La simulación debe renderizar controles por entrada'
  );
  assertIncluye(
    javascript,
    'valoresSimuladosCanvasFull = {}',
    'La simulación del estudio visual debe vivir en estado cliente no persistente'
  );
  assertIncluye(
    javascript,
    'La entrada ${entrada.variable} está seleccionada, pero la fórmula no la usa.',
    'El plan debe avisar cuando una entrada seleccionada no participa en la fórmula'
  );
  assertIncluye(
    javascript,
    'La fórmula usa ${variable}, pero no hay monitor asignado a esa variable.',
    'El plan debe avisar cuando la fórmula referencia variables sin monitor'
  );
  assertIncluye(
    javascript,
    'monitoresSelectorPorId',
    'El selector AJAX debe resolver el monitor seleccionado desde memoria y no desde JSON embebido en HTML'
  );
  assertIncluye(
    javascript,
    'data-monitor-id=',
    'El selector AJAX debe transportar solo el identificador del monitor seleccionado'
  );
  assertNoIncluye(
    javascript,
    "data-monitor='${escapeHtml(JSON.stringify(monitor))}'",
    'El selector AJAX no debe serializar monitores completos dentro de atributos HTML'
  );
  assertNoIncluye(
    javascript,
    'data-monitor-logico-simulacion-a',
    'El formulario no debe conservar la simulación legacy limitada a la variable A'
  );
  assertNoIncluye(
    editorVisual,
    'monitor-logico-simulacion',
    'El formulario no debe duplicar la simulación fuera del estudio visual'
  );
  assertIncluye(
    javascript,
    'layoutCanvasLogico = normalizarLayoutCanvasLogico(cargarLayoutCanvasLogico())',
    'El canvas debe cargar layout visual sin recalcular comportamiento'
  );
  assertIncluye(
    javascript,
    'inputLayoutLogico.value = JSON.stringify(layoutCanvasLogico);',
    'Solo el layout visual normalizado debe escribirse en el campo oculto'
  );
  assertIncluye(
    javascript,
    '...(grafoLogico ? { grafoLogico } : {})',
    'El canvas debe preservar el grafo lógico contractual si ya existe'
  );
  assertIncluye(
    javascript,
    'layoutCanvasLogico?.grafoLogico?.expresionCompilada',
    'La UX debe leer la expresión compilada del contrato visual'
  );
  assertIncluye(
    javascript,
    'grafoCanvasFullBorrador',
    'El canvas full-window debe trabajar sobre un borrador antes de persistir'
  );
  assertIncluye(
    javascript,
    'modoConectarCanvasFull',
    'El canvas full-window debe soportar interacción básica de conexión'
  );
  assertIncluye(
    javascript,
    'nodoCanvasFullArrastrado',
    'El canvas full-window debe permitir arrastrar nodos'
  );
  assertIncluye(
    javascript,
    'moverNodoCanvasFull',
    'El drag del canvas full-window debe actualizar coordenadas del grafo'
  );
  assertIncluye(
    javascript,
    'seleccionarPuertoCanvasFull',
    'El canvas full-window debe conectar desde puertos explícitos'
  );
  assertIncluye(
    javascript,
    'puertoDesde: origen.puertoId',
    'Las conexiones deben persistir el puerto rojo de salida'
  );
  assertIncluye(
    javascript,
    'puertoHasta: destino.puertoId',
    'Las conexiones deben persistir el puerto verde de entrada'
  );
  assertIncluye(
    javascript,
    'compilarGrafoCanvasFullAExpresion',
    'Aplicar el estudio visual debe compilar el grafo antes de persistirlo'
  );
  assertIncluye(
    javascript,
    'layoutCanvasLogico.grafoLogico = grafoNormalizado',
    'Aplicar el estudio visual debe persistir el grafo normalizado en el layout del formulario'
  );
  assertIncluye(
    javascript,
    'inputLogicoExpresion.value = normalizarExpresionTextoLogico(compilacion.expresion)',
    'Aplicar el estudio visual debe actualizar la expresión operativa del formulario normalizada'
  );
  assertNoIncluye(
    javascript,
    'dependenciaLogica',
    'La UX de monitores lógicos no debe conservar referencias legacy a una única dependencia'
  );
  assertIncluye(
    javascript,
    'construirGrafoTrivialDesdeExpresion',
    'La UX debe reconstruir grafos simples desde expresiones triviales'
  );
  assertIncluye(
    javascript,
    "modoCompatibilidad: 'reconstruido_trivial'",
    'La reconstrucción trivial debe quedar marcada en el contrato visual'
  );
  assertIncluye(
    javascript,
    "'texto_operativo'",
    'Los grafos legacy deben exponer modo textual compatible'
  );
  assertIncluye(
    javascript,
    'valoresSimuladosCanvasFull = {}',
    'La simulación visual debe vivir solo en memoria cliente'
  );
  assertIncluye(
    javascript,
    'evaluarGrafoCanvasFull',
    'El cliente debe poder propagar estados simulados por el grafo'
  );
  assertIncluye(
    javascript,
    'monitor-logico-estudio__conexion--ok',
    'La simulación debe colorear caminos activos del grafo'
  );
}

function verificarEdicionSegura(vista, javascript, servicio) {
  assertIncluye(
    vista,
    'Comprobaciones antes de guardar',
    'La edición lógica debe mostrar impacto antes de guardar'
  );
  assertIncluye(
    javascript,
    'actualizarImpactoEdicionLogica();',
    'El impacto debe refrescarse con el formulario'
  );
  assertIncluye(
    javascript,
    'Hay errores bloqueantes en la lógica antes de guardar.',
    'El cliente debe bloquear errores locales obvios'
  );
  assertIncluye(
    servicio,
    'validarDependenciasMonitorLogicoSegunScope',
    'El backend debe validar dependencias lógicas por alcance'
  );
  assertIncluye(
    servicio,
    'parsearDependenciasLogicasDesdeEntrada',
    'El backend debe aceptar el contrato de múltiples entradas desde formulario'
  );
  assertIncluye(
    servicio,
    'Las dependencias lógicas deben enviarse como JSON válido.',
    'El backend debe rechazar dependencias múltiples mal serializadas'
  );
  assertIncluye(
    servicio,
    'queda fuera de tu alcance visible',
    'El backend debe impedir editar dependencias fuera de alcance'
  );
  assertIncluye(
    servicio,
    'El monitor lógico no puede crear un ciclo de dependencias',
    'El backend debe bloquear ciclos lógicos'
  );
}

function verificarEnriquecimientoOperativoMonitor({
  vistaFormulario,
  vistaDetalle,
  vistaContextoOperativo,
  javascriptMonitores,
  javascriptComparador,
  javascriptDetalleEventos,
  servicioMonitores
}) {
  assertIncluye(
    vistaFormulario,
    'name="interpretacion_estado"',
    'El formulario debe permitir persistir la lectura del resultado'
  );
  assertIncluye(
    vistaFormulario,
    'Falló porque respondió',
    'La UX debe usar el copy humano acordado para inversión'
  );
  assertIncluye(
    vistaFormulario,
    'name="descripcion_fallo"',
    'El formulario debe exponer el motivo humano del fallo'
  );
  assertIncluye(
    vistaFormulario,
    'name="posible_solucion"',
    'El formulario debe exponer la posible solución'
  );
  assertIncluye(
    vistaFormulario,
    'maxlength="512"',
    'La UI debe aplicar el mismo límite de metadatos que backend/SQL'
  );
  assertIncluye(
    vistaFormulario,
    'data-monitor-semantica-estado',
    'La semántica de estado debe tener bloque controlable por tipo'
  );
  assertIncluye(
    javascriptMonitores,
    'bloqueSemanticaEstado.hidden = esInterno',
    'La inversión debe ocultarse en monitores booleanos y de telemetría'
  );
  assertIncluye(
    javascriptMonitores,
    "selectorInterpretacionEstado.value = 'normal'",
    'Al pasar a booleano la UI debe forzar lectura normal'
  );
  assertIncluye(
    vistaDetalle,
    "include('parciales/monitor-contexto-operativo'",
    'El detalle debe mostrar los metadatos humanos del monitor'
  );
  assertIncluye(
    vistaContextoOperativo,
    'Motivo humano del fallo',
    'El detalle debe mostrar descripcionFallo'
  );
  assertIncluye(
    vistaContextoOperativo,
    'Posible solución',
    'El detalle debe mostrar posibleSolucion'
  );
  assertIncluye(
    javascriptComparador,
    'construirContextoOperativoMonitor',
    'El comparador debe mostrar metainformación operativa'
  );
  assertIncluye(
    javascriptComparador,
    'resolverExitoTecnicoEvento',
    'El comparador debe calcular métricas con éxito técnico, no operativo'
  );
  assertIncluye(
    javascriptDetalleEventos,
    'resolverExitoTecnicoEvento',
    'El detalle de eventos debe calcular métricas con éxito técnico, no operativo'
  );
  assertIncluye(
    servicioMonitores,
    'descripcionFallo: monitor.descripcionFallo',
    'El servicio debe entregar descripcionFallo al comparador'
  );
  assertIncluye(
    servicioMonitores,
    'normalizarInterpretacionEstadoMonitorPorTipo',
    'El servidor debe normalizar la lectura del resultado según el tipo de monitor'
  );
  assertIncluye(
    servicioMonitores,
    'exito: serializada.exitoTecnico == null',
    'resultadoTecnico.exito debe ser null explicito si falta dato tecnico'
  );
}

function verificarTemaVinculosTrigger(css) {
  const inicio = css.indexOf('.monitor-trigger-card {');
  const fin = css.indexOf('@media (max-width: 991.98px)', inicio);
  const estilos = css.slice(inicio, fin);

  assert.ok(inicio >= 0 && fin > inicio, 'Faltan los estilos de vínculos monitor-trigger.');
  assertIncluye(
    estilos,
    'color-mix(in srgb, var(--estado-positivo) 7%, var(--superficie-2))',
    'La tarjeta del vínculo debe adaptar su superficie al tema activo'
  );
  assertIncluye(
    estilos,
    'color: var(--texto)',
    'El flujo del vínculo debe conservar contraste en ambos temas'
  );
  assert.doesNotMatch(
    estilos,
    /rgba\(255,\s*255,\s*255|rgba\(236,\s*247,\s*242|--texto-principal/u,
    'La tarjeta del vínculo no debe conservar colores claros ni variables inexistentes.'
  );
}

function verificarDropdownAccionesFueraDelRecorte(portal, monitores) {
  assertIncluye(
    monitores,
    'class="btn btn-outline-secondary btn-sm monitores-tabla__acciones-toggle"',
    'El listado debe conservar un dropdown de acciones identificable'
  );
  assertIncluye(
    portal,
    '.table-responsive [data-bs-toggle="dropdown"]',
    'Los dropdowns de tablas responsive deben recibir posicionamiento propio'
  );
  assertIncluye(
    portal,
    "boundary: 'viewport'",
    'El menú de tabla debe calcular su posición contra el viewport'
  );
  assertIncluye(
    portal,
    'document.body.appendChild(menu)',
    'El menú de tabla debe escapar físicamente del contenedor con scroll horizontal'
  );
  assertIncluye(
    portal,
    "window.getComputedStyle(tablaResponsive).overflowX !== 'visible'",
    'El menú flotante debe limitarse a tablas cuyo contenedor recorta horizontalmente'
  );
  assertIncluye(
    portal,
    'window.bootstrap.Dropdown.getInstance(boton)?.update()',
    'El menú flotante debe recalcular su posición junto al botón de acciones'
  );
}

const vistaFormulario = leer('apps/sentinelia-web/src/views/portal/monitor-formulario.ejs');
const vistaDetalle = leer('apps/sentinelia-web/src/views/portal/monitor-detalle.ejs');
const vistaContextoOperativo = leer(
  'apps/sentinelia-web/src/views/portal/parciales/monitor-contexto-operativo.ejs'
);
const editorVisualLogico = leer(
  'apps/sentinelia-web/src/views/portal/parciales/monitor-logico-editor-visual.ejs'
);
const javascriptMonitores = leer('apps/sentinelia-web/src/public/js/monitores.js');
const javascriptPortal = leer('apps/sentinelia-web/src/public/js/portal.js');
const javascriptComparador = leer(
  'apps/sentinelia-web/src/public/js/monitores-comparar-eventos.js'
);
const javascriptDetalleEventos = leer(
  'apps/sentinelia-web/src/public/js/monitor-detalle-eventos.js'
);
const servicioMonitores = leer('paquetes/monitores/src/ServicioMonitores.js');
const cssPortal = leer('apps/sentinelia-web/src/public/css/portal.css');

verificarFormularioSinIdsManuales(vistaFormulario);
verificarTablaVariablesSiempreVisible(vistaFormulario);
verificarCanvasYSimulacionNoPersistenRuntime(
  vistaFormulario,
  editorVisualLogico,
  javascriptMonitores
);
verificarEdicionSegura(vistaFormulario, javascriptMonitores, servicioMonitores);
verificarEnriquecimientoOperativoMonitor({
  vistaFormulario,
  vistaDetalle,
  vistaContextoOperativo,
  javascriptMonitores,
  javascriptComparador,
  javascriptDetalleEventos,
  servicioMonitores
});
verificarTemaVinculosTrigger(cssPortal);
verificarDropdownAccionesFueraDelRecorte(javascriptPortal, javascriptMonitores);

console.log(
  '[monitores:logicos:verificar-ux] OK: formulario lógico usable sin IDs manuales, variables visibles, simulación sin persistencia, edición protegida y enriquecimiento operativo visible.'
);
