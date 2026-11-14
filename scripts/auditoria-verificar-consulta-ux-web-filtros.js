import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const VISTA = '../apps/sentinelia-web/src/views/portal/auditoria-cronologia.ejs';
const CLIENTE = '../apps/sentinelia-web/src/public/js/auditoria-cronologia.js';
const CSS = '../apps/sentinelia-web/src/public/css/portal.css';

async function main() {
  const [vista, cliente, css] = await Promise.all(
    [VISTA, CLIENTE, CSS].map(leer)
  );
  verificarFiltrosVisibles(vista);
  verificarSujetoTipado(vista, cliente);
  verificarUrlEHistoria(cliente);
  verificarCancelacionYRestauracion(cliente);
  verificarEstilos(css);
  console.log('[auditoria] OK 5.21.16l: fechas=visibles sujeto=tipado url=filtros history=cursores abort=obsoletas popstate=restaurado');
}

function verificarFiltrosVisibles(vista) {
  for (const marca of [
    'name="desde"',
    'name="hasta"',
    'name="flujo"',
    'name="tipoEvento"',
    'name="orden"',
    'name="limite"'
  ]) {
    assert.ok(vista.includes(marca), `Falta el filtro ${marca}.`);
  }
  assert.match(vista, /data-auditoria-desde/);
  assert.match(vista, /data-auditoria-hasta/);
  assert.match(vista, /ventana inicial cubre siete días/i);
}

function verificarSujetoTipado(vista, cliente) {
  assert.match(vista, /data-url-sujetos="\/auditoria\/api\/sujetos"/);
  for (const marca of [
    'name="sujetoTipo"',
    'name="sujetoId"',
    'data-auditoria-sujeto-busqueda',
    'data-auditoria-sujeto-opciones',
    'data-auditoria-sujeto-estado'
  ]) {
    assert.ok(vista.includes(marca), `Falta ${marca}.`);
  }
  assert.match(cliente, /new URLSearchParams\(\{ tipo, texto, pagina: '1', limite: '10' \}\)/);
  assert.match(cliente, /fetch\(`\$\{urlSujetos\}\?\$\{parametros\.toString\(\)\}`/);
  assert.match(cliente, /parametros\.set\('sujetoTipo', datos\.sujetoTipo\)/);
  assert.match(cliente, /parametros\.set\('sujetoId', datos\.sujetoId\)/);
  assert.match(cliente, /El tipo y el ID exacto del sujeto deben aparecer juntos/);
}

function verificarUrlEHistoria(cliente) {
  const inicioGuardar = cliente.indexOf('function guardarNavegacion');
  const finGuardar = cliente.indexOf('function consultaDesdeUrl', inicioGuardar);
  const guardar = cliente.slice(inicioGuardar, finGuardar);
  for (const campo of [
    'desde', 'hasta', 'flujo', 'tipoEvento', 'sujetoTipo', 'sujetoId', 'orden', 'limite'
  ]) {
    assert.ok(guardar.includes(`'${campo}'`), `La URL no conserva ${campo}.`);
  }
  assert.doesNotMatch(guardar, /searchParams\.(set|append)\(['"]cursor/);
  assert.match(guardar, /cursoresPagina: \[\.\.\.cursoresPagina\]/);
  assert.match(guardar, /indicePagina/);
  assert.match(guardar, /siguienteCursor/);
  assert.match(guardar, /limiteSuperiorUtc/);
  assert.match(guardar, /history\[metodo\]\(estadoGuardado, '', url\)/);
  assert.match(cliente, /tipoNavegacion === 'back_forward' \? history\.state : null/);
}

function verificarCancelacionYRestauracion(cliente) {
  assert.match(cliente, /controladorCarga\?\.abort\(\)/);
  assert.match(cliente, /const controladorActual = new AbortController\(\)/);
  assert.match(cliente, /signal: controladorActual\.signal/);
  assert.match(cliente, /versionActual !== versionCarga/);
  assert.match(cliente, /controladorSujetos\?\.abort\(\)/);
  assert.match(cliente, /window\.addEventListener\('popstate'/);
  assert.match(cliente, /restaurarNavegacion\(evento\.state\)/);
  assert.match(cliente, /aplicarConsultaAlFormulario\(consultaAplicada\)/);
  assert.match(cliente, /cursoresPagina = \[null\]/);
  assert.match(cliente, /indicePagina = 0/);
  assert.match(cliente, /fechaUtcDesplazada\(-6\)/);
  assert.match(cliente, /resolverHastaUtc\(datos\.hasta\)/);
}

function verificarEstilos(css) {
  for (const selector of [
    '.auditoria-filtros__sujeto',
    '.auditoria-sujeto__busqueda',
    '.auditoria-sujeto__opciones',
    '.auditoria-sujeto__opcion',
    '.auditoria-sujeto__estado'
  ]) {
    assert.ok(css.includes(selector), `Falta estilo ${selector}.`);
  }
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*\.auditoria-filtros__sujeto[\s\S]*grid-template-columns: 1fr/);
}

function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}

main().catch((error) => {
  console.error('[auditoria] ERROR 5.21.16l:', error);
  process.exitCode = 1;
});
