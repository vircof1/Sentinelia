import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const VISTA = '../apps/sentinelia-web/src/views/portal/auditoria-cronologia.ejs';
const CLIENTE = '../apps/sentinelia-web/src/public/js/auditoria-cronologia.js';
const CSS = '../apps/sentinelia-web/src/public/css/portal.css';

async function main() {
  const [vista, cliente, css] = await Promise.all(
    [VISTA, CLIENTE, CSS].map(leer)
  );
  verificarMarcoYTabla(vista);
  verificarNavegacionPorCursores(cliente);
  verificarReemplazoYDetalle(cliente);
  verificarAdaptacion(css);
  console.log('[auditoria] OK 5.21.16k: tabla=compacta paginas=reemplazables cursores=pila controles=primera_anterior_siguiente movil=adaptado');
}

function verificarMarcoYTabla(vista) {
  assert.match(vista, /data-url-eventos="\/auditoria\/api\/eventos"/);
  assert.match(vista, /<table class="auditoria-tabla">/);
  assert.match(vista, /<tbody data-auditoria-tabla-cuerpo><\/tbody>/);
  for (const cabecera of ['Fecha', 'Evento / flujo', 'Sujeto', 'Actor / origen', 'Acciones']) {
    assert.ok(vista.includes(cabecera), `Falta la columna ${cabecera}.`);
  }
  for (const limite of ['10', '25', '50']) {
    assert.match(vista, new RegExp(`<option value="${limite}"`));
  }
  for (const marca of [
    'data-auditoria-primera',
    'data-auditoria-anterior',
    'data-auditoria-siguiente',
    'data-auditoria-pagina'
  ]) {
    assert.ok(vista.includes(marca), `Falta el control ${marca}.`);
  }
  assert.match(vista, /data-auditoria-estado aria-live="polite"/);
  assert.match(vista, /data-auditoria-pagina aria-live="polite"/);
}

function verificarNavegacionPorCursores(cliente) {
  assert.match(cliente, /let cursoresPagina = \[null\]/);
  assert.match(cliente, /let indicePagina = 0/);
  assert.match(cliente, /let siguienteCursor = null/);
  assert.match(cliente, /cursoresPagina\[indiceObjetivo\] \?\? null/);
  assert.match(cliente, /cursoresPagina = cursoresPagina\.slice\(0, indicePagina \+ 1\)/);
  assert.match(cliente, /cursoresPagina\.push\(siguienteCursor\)/);
  assert.match(cliente, /indiceObjetivo: Math\.max\(0, indicePagina - 1\)/);
  assert.match(cliente, /indiceObjetivo: indicePagina \+ 1/);
  assert.match(cliente, /indiceObjetivo: 0/);
  assert.match(cliente, /if \(cursorObjetivo\) parametros\.set\('cursor', cursorObjetivo\)/);
  assert.match(cliente, /consultaAplicada = capturarConsultaAplicada\(\)/);
  assert.match(cliente, /parametros\.set\('limite', datos\.limite\)/);
  assert.doesNotMatch(cliente, /history\.(pushState|replaceState)/);
}

function verificarReemplazoYDetalle(cliente) {
  assert.match(cliente, /cuerpoTabla\.replaceChildren\(fragmento\)/);
  assert.match(cliente, /const idsRenderizados = new Set\(\)/);
  assert.match(cliente, /idsRenderizados\.has\(id\)/);
  assert.match(cliente, /data-auditoria-detalle aria-expanded="false"/);
  assert.match(cliente, /detalle\.hidden = !abrir/);
  assert.match(cliente, /fragmento\.append\(fila, detalle\)/);
  assert.doesNotMatch(cliente, /lista\.appendChild/);
  assert.doesNotMatch(cliente, /cargados \+=/);
  const inicioFila = cliente.indexOf('function renderizarEvento(evento)');
  const finFilaOrdinaria = cliente.indexOf('function renderizarDetalleTecnico', inicioFila);
  const filaOrdinaria = cliente.slice(inicioFila, finFilaOrdinaria);
  assert.doesNotMatch(filaOrdinaria, /hashActual|hashAnterior|claveCadena|secuencia/);
}

function verificarAdaptacion(css) {
  for (const selector of [
    '.auditoria-tabla',
    '.auditoria-tabla__fila',
    '.auditoria-tabla__fila-detalle',
    '.auditoria-tabla__detalle',
    '.auditoria-paginacion__estado'
  ]) {
    assert.ok(css.includes(selector), `Falta estilo ${selector}.`);
  }
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*\.auditoria-tabla,[\s\S]*display: block/);
  assert.match(css, /content: attr\(data-label\)/);
  assert.match(css, /overflow-x: auto/);
}

function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}

main().catch((error) => {
  console.error('[auditoria] ERROR 5.21.16k:', error);
  process.exitCode = 1;
});
