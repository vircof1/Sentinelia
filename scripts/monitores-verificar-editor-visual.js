import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  compilarGrafoLogicoAExpresion,
  normalizarGrafoLogicoVisual
} from '../paquetes/monitores/src/ConfiguracionMonitorLogico.js';
import { analizarExpresionMonitorLogico } from '../paquetes/monitores/src/AnalizadorExpresionMonitorLogico.js';
import { ValidadorMonitor } from '../paquetes/monitores/src/ValidadorMonitor.js';

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

function assertNoIncluye(contenido, fragmento, descripcion) {
  assert.ok(
    !contenido.includes(fragmento),
    `${descripcion}: sobra "${fragmento}".`
  );
}

function assertOrden(contenido, primero, segundo, descripcion) {
  const indicePrimero = contenido.indexOf(primero);
  const indiceSegundo = contenido.indexOf(segundo);

  assert.notEqual(indicePrimero, -1, `${descripcion}: falta "${primero}".`);
  assert.notEqual(indiceSegundo, -1, `${descripcion}: falta "${segundo}".`);
  assert.ok(
    indicePrimero < indiceSegundo,
    `${descripcion}: "${primero}" debe aparecer antes que "${segundo}".`
  );
}

function crearGrafoValido() {
  return {
    nodos: [
      { id: 'entrada-a', tipo: 'entrada', variable: 'A' },
      { id: 'entrada-b', tipo: 'entrada', variable: 'B' },
      { id: 'entrada-c', tipo: 'entrada', variable: 'C' },
      { id: 'or-1', tipo: 'or' },
      { id: 'not-1', tipo: 'not' },
      { id: 'and-1', tipo: 'and' },
      { id: 'salida', tipo: 'salida' }
    ],
    conexiones: [
      { desde: 'entrada-a', hasta: 'or-1' },
      { desde: 'entrada-b', hasta: 'or-1' },
      { desde: 'entrada-c', hasta: 'not-1' },
      { desde: 'or-1', hasta: 'and-1' },
      { desde: 'not-1', hasta: 'and-1' },
      { desde: 'and-1', hasta: 'salida' }
    ]
  };
}

function verificarContratoGrafo() {
  const grafo = normalizarGrafoLogicoVisual(crearGrafoValido());

  assert.equal(grafo.valido, true);
  assert.equal(grafo.salidaId, 'salida');
  assert.equal(grafo.expresionCompilada, '(A OR B) AND NOT C');
  assert.deepEqual(grafo.variablesUsadas, ['A', 'B', 'C']);
  assert.deepEqual(
    compilarGrafoLogicoAExpresion(grafo),
    {
      expresion: '(A OR B) AND NOT C',
      variablesUsadas: ['A', 'B', 'C']
    }
  );

  assert.equal(
    analizarExpresionMonitorLogico('NOT ((A AND B OR C))', ['A', 'B', 'C'])
      .expresionNormalizada,
    'NOT (A AND B OR C)'
  );
}

function verificarGuardarrailesGrafo() {
  const dosSalidas = normalizarGrafoLogicoVisual({
    nodos: [
      { id: 'entrada-a', tipo: 'entrada', variable: 'A' },
      { id: 'salida-1', tipo: 'salida' },
      { id: 'salida-2', tipo: 'salida' }
    ],
    conexiones: [
      { desde: 'entrada-a', hasta: 'salida-1' },
      { desde: 'entrada-a', hasta: 'salida-2' }
    ]
  });

  assert.equal(dosSalidas.valido, false);
  assert.ok(
    dosSalidas.errores.some((error) => error.includes('solo puede tener una salida'))
  );

  const puertaIncompleta = normalizarGrafoLogicoVisual({
    nodos: [
      { id: 'entrada-a', tipo: 'entrada', variable: 'A' },
      { id: 'and-1', tipo: 'and' },
      { id: 'salida', tipo: 'salida' }
    ],
    conexiones: [
      { desde: 'entrada-a', hasta: 'and-1' },
      { desde: 'and-1', hasta: 'salida' }
    ]
  });

  assert.equal(puertaIncompleta.valido, false);
  assert.ok(
    puertaIncompleta.errores.some((error) => error.includes('requiere al menos dos entradas'))
  );

  const ciclo = normalizarGrafoLogicoVisual({
    nodos: [
      { id: 'entrada-a', tipo: 'entrada', variable: 'A' },
      { id: 'not-1', tipo: 'not' },
      { id: 'salida', tipo: 'salida' }
    ],
    conexiones: [
      { desde: 'entrada-a', hasta: 'not-1' },
      { desde: 'not-1', hasta: 'entrada-a' },
      { desde: 'not-1', hasta: 'salida' }
    ]
  });

  assert.equal(ciclo.valido, false);
  assert.ok(
    ciclo.errores.some((error) => error.includes('ciclo interno'))
  );
}

function verificarCoherenciaConValidadorMonitor() {
  const validador = new ValidadorMonitor();
  const grafo = crearGrafoValido();
  const grafoNegado = normalizarGrafoLogicoVisual({
    nodos: [
      { id: 'entrada-a', tipo: 'entrada', variable: 'A' },
      { id: 'entrada-b', tipo: 'entrada', variable: 'B' },
      { id: 'and-1', tipo: 'and' },
      { id: 'not-1', tipo: 'not' },
      { id: 'salida', tipo: 'salida' }
    ],
    conexiones: [
      { desde: 'entrada-a', hasta: 'and-1' },
      { desde: 'entrada-b', hasta: 'and-1' },
      { desde: 'and-1', hasta: 'not-1' },
      { desde: 'not-1', hasta: 'salida' }
    ]
  });

  assert.doesNotThrow(() =>
    validador.normalizarConfiguracionTecnica('booleano', {
      expresion: '(A OR B) AND NOT C',
      dependencias: [
        { variable: 'A', fuente: 'monitor', monitorId: 1 },
        { variable: 'B', fuente: 'monitor', monitorId: 2 },
        { variable: 'C', fuente: 'monitor', monitorId: 3 }
      ],
      mensajeFallo: 'La salida lógica simulada no cumple.',
      layoutVisual: { grafoLogico: grafo }
    })
  );

  assert.doesNotThrow(() =>
    validador.normalizarConfiguracionTecnica('booleano', {
      expresion: '((A OR B) AND NOT C)',
      dependencias: [
        { variable: 'A', fuente: 'monitor', monitorId: 1 },
        { variable: 'B', fuente: 'monitor', monitorId: 2 },
        { variable: 'C', fuente: 'monitor', monitorId: 3 }
      ],
      mensajeFallo: 'La salida lógica simulada no cumple.',
      layoutVisual: { grafoLogico: grafo }
    })
  );

  assert.equal(
    validador.normalizarConfiguracionTecnica('booleano', {
      expresion: 'NOT ((A AND B))',
      dependencias: [
        { variable: 'A', fuente: 'monitor', monitorId: 1 },
        { variable: 'B', fuente: 'monitor', monitorId: 2 }
      ],
      mensajeFallo: 'La salida lógica negada no cumple.',
      layoutVisual: { grafoLogico: grafoNegado }
    }).expresion,
    'NOT (A AND B)'
  );

  assert.throws(
    () =>
      validador.normalizarConfiguracionTecnica('booleano', {
        expresion: 'A OR B',
        dependencias: [
          { variable: 'A', fuente: 'monitor', monitorId: 1 },
          { variable: 'B', fuente: 'monitor', monitorId: 2 },
          { variable: 'C', fuente: 'monitor', monitorId: 3 }
        ],
        mensajeFallo: 'La salida lógica simulada no cumple.',
        layoutVisual: { grafoLogico: grafo }
      }),
    /El grafo visual compila/
  );

  assert.doesNotThrow(() =>
    validador.normalizarConfiguracionTecnica('booleano', {
      expresion: 'NOT A',
      dependencias: [{ variable: 'A', fuente: 'monitor', monitorId: 1 }],
      mensajeFallo: 'La expresión textual compatible no cumple.',
      layoutVisual: {
        grafoLogico: {
          nodos: [
            { id: 'entrada-a', tipo: 'entrada', variable: 'A' },
            { id: 'expresion', tipo: 'expresion' },
            { id: 'salida', tipo: 'salida' }
          ],
          conexiones: [
            { desde: 'entrada-a', hasta: 'expresion' },
            { desde: 'expresion', hasta: 'salida' }
          ]
        }
      }
    })
  );
}

function verificarSuperficieUx() {
  const formulario = leer('apps/sentinelia-web/src/views/portal/monitor-formulario.ejs');
  const editorVisual = leer(
    'apps/sentinelia-web/src/views/portal/parciales/monitor-logico-editor-visual.ejs'
  );
  const javascript = leer('apps/sentinelia-web/src/public/js/monitores.js');
  const svgAnd = leer('apps/sentinelia-web/src/public/IMG/logic-gates/and-ansi.svg');
  const svgOr = leer('apps/sentinelia-web/src/public/IMG/logic-gates/or-ansi.svg');
  const svgNot = leer('apps/sentinelia-web/src/public/IMG/logic-gates/not-ansi.svg');

  assertOrden(
    formulario,
    "include('parciales/monitor-logico-editor-visual'",
    '<script src="/js/monitores.js',
    'El partial del editor visual debe renderizarse antes de monitores.js'
  );
  assertIncluye(
    editorVisual,
    'modal-fullscreen',
    'El editor visual debe usar modal full-window'
  );
  assertIncluye(
    editorVisual,
    'monitor-logico-estudio__dialog',
    'El editor visual debe poder ajustar margen exterior del modal fullscreen'
  );
  assertIncluye(
    editorVisual,
    'monitor-logico-canvas__resumen',
    'El partial debe usar una tarjeta de resumen en el formulario'
  );
  assertNoIncluye(
    editorVisual,
    'data-monitor-logico-canvas-lienzo',
    'El partial no debe conservar el canvas pequeño no fiel a la realidad'
  );
  assertIncluye(
    editorVisual,
    'data-monitor-logico-grafo-simulacion',
    'El editor visual debe declarar simulación de grafo'
  );
  assertIncluye(
    editorVisual,
    'Cómo conectar y desconectar nodos',
    'El editor visual debe explicar la semántica de puertos al usuario'
  );
  assertIncluye(
    editorVisual,
    'Desconectar',
    'El editor visual debe hacer descubrible el borrado de enlaces'
  );
  assertIncluye(
    editorVisual,
    'data-monitor-logico-grafo-compilacion',
    'El editor visual debe mostrar la fórmula compilada en vivo'
  );
  assertIncluye(
    editorVisual,
    'data-monitor-logico-canvas-compatibilidad',
    'El editor visual debe declarar fallback textual compatible'
  );
  assertIncluye(
    javascript,
    'valoresSimuladosCanvasFull = {}',
    'La simulación debe reiniciarse en memoria cliente'
  );
  assertIncluye(
    javascript,
    'compilarGrafoCanvasFullAExpresion',
    'El formulario debe compilar el borrador visual antes de aplicarlo'
  );
  assertIncluye(
    javascript,
    'actualizarCompilacionCanvasFull',
    'El editor visual debe refrescar el diagnóstico de compilación mientras se trabaja'
  );
  assertIncluye(
    javascript,
    'simplificarExpresionLogicaCanvasFull',
    'El editor visual debe calcular sugerencias conservadoras de simplificación'
  );
  assertIncluye(
    javascript,
    'Simplificación posible',
    'El editor visual debe mostrar simplificaciones como sugerencias, no como sustitución silenciosa'
  );
  assertIncluye(
    javascript,
    'Aplicar fórmula al formulario',
    'El CTA de aplicar debe distinguir un grafo compilable'
  );
  assertIncluye(
    javascript,
    'Conecta una salida válida',
    'El CTA de aplicar debe avisar cuando el grafo todavía no compila'
  );
  assertIncluye(
    javascript,
    'botonCanvasFullAplicar.disabled = !compilacion.valido',
    'El editor visual no debe aplicar grafos que todavía no compilan'
  );
  assertIncluye(
    javascript,
    'layoutCanvasLogico.grafoLogico = grafoNormalizado',
    'El formulario debe persistir el grafo visual con diagnóstico de compilación'
  );
  assertIncluye(
    javascript,
    'inputLogicoExpresion.value = normalizarExpresionTextoLogico(compilacion.expresion)',
    'Aplicar el estudio visual debe actualizar la expresión operativa del formulario normalizada'
  );
  assertIncluye(
    javascript,
    'window.bootstrap.Modal.getOrCreateInstance(modalCanvasLogico).hide();',
    'El estudio visual debe cerrarse automáticamente cuando se aplica un grafo válido'
  );
  assertIncluye(
    javascript,
    'construirGrafoTrivialDesdeExpresion',
    'El cliente debe poder reconstruir grafos triviales desde texto'
  );
  assertIncluye(
    javascript,
    'nodoCanvasFullArrastrado',
    'El editor visual debe soportar drag and drop de nodos'
  );
  assertIncluye(
    javascript,
    'seleccionarPuertoCanvasFull',
    'El editor visual debe conectar usando puertos explícitos'
  );
  assertIncluye(
    javascript,
    'obtenerPuertosNodoCanvasFull',
    'El editor visual debe declarar puertos por tipo de nodo'
  );
  assertIncluye(
    javascript,
    'renderizarSimboloNodoCanvasFull',
    'El editor visual debe representar puertas lógicas con simbología visual'
  );
  assertIncluye(
    javascript,
    '/IMG/logic-gates/and-ansi.svg',
    'El editor visual debe cargar el SVG local de la puerta AND'
  );
  assertIncluye(
    javascript,
    '/IMG/logic-gates/or-ansi.svg',
    'El editor visual debe cargar el SVG local de la puerta OR'
  );
  assertIncluye(
    javascript,
    '/IMG/logic-gates/not-ansi.svg',
    'El editor visual debe cargar el SVG local de la puerta NOT'
  );
  assertNoIncluye(
    javascript,
    'commons.wikimedia.org',
    'El editor visual no debe depender de CDN ni URLs remotas para las puertas lógicas'
  );
  assertIncluye(svgAnd, '<svg', 'El asset local AND debe ser un SVG válido');
  assertIncluye(svgOr, '<svg', 'El asset local OR debe ser un SVG válido');
  assertIncluye(svgNot, '<svg', 'El asset local NOT debe ser un SVG válido');
  assertIncluye(
    javascript,
    'resolverDetalleSalidaNodoCanvasFull',
    'El editor visual debe mostrar una lectura operativa de salida en vez de IDs técnicos'
  );
  assertIncluye(
    javascript,
    'Salida: ${formatearValorSimulado(valor)}',
    'Las tarjetas del grafo deben explicar disponible/indisponible/sin dato'
  );
  assertIncluye(
    javascript,
    'borrarConexionesPuertoCanvasFull',
    'El editor visual debe permitir borrar enlaces desde un puerto'
  );
  assertIncluye(
    javascript,
    "addEventListener('contextmenu'",
    'El editor visual debe reservar botón derecho para borrar enlaces de puerto'
  );
  assertIncluye(
    javascript,
    'conexionesSinEntradaOcupada',
    'El editor visual debe impedir varias conexiones simultáneas sobre la misma entrada'
  );
  assertIncluye(
    javascript,
    'Entrada reconectada',
    'El editor visual debe explicar cuándo una entrada sustituye su enlace anterior'
  );
  assertIncluye(
    javascript,
    'role="button"',
    'Los nodos visuales deben ser contenedores interactivos sin anidar botones'
  );
  assertIncluye(
    javascript,
    'monitor-logico-estudio__nodo-contenido',
    'El contenido textual del nodo debe quedar encapsulado dentro de la caja'
  );
  assertNoIncluye(
    javascript,
    '<button\n            type="button"\n            class="monitor-logico-estudio__nodo',
    'El editor visual no debe renderizar botones de nodo con puertos-button dentro'
  );
}

verificarContratoGrafo();
verificarGuardarrailesGrafo();
verificarCoherenciaConValidadorMonitor();
verificarSuperficieUx();

console.log(
  '[monitores:logicos:verificar-editor-visual] OK: contrato, guardarraíles, coherencia backend y superficie UX del editor visual verificados.'
);
