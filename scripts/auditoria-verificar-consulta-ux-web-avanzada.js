import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const VISTA = '../apps/sentinelia-web/src/views/portal/auditoria-cronologia.ejs';
const CLIENTE = '../apps/sentinelia-web/src/public/js/auditoria-cronologia.js';
const CSS = '../apps/sentinelia-web/src/public/css/portal.css';

async function main() {
  const [vista, cliente, css] = await Promise.all(
    [VISTA, CLIENTE, CSS].map(leer)
  );
  verificarContratoVista(vista);
  verificarFiltrosAvanzados(vista, cliente);
  verificarDetalleAutorizado(cliente);
  verificarDetalleCambios(cliente);
  verificarCargaBajoDemanda(cliente);
  verificarPaginacionAislada(cliente);
  verificarEstilos({ css, vista, cliente });
  console.log('[auditoria] OK 5.21.16m: detalle=plegado correlacion=bajo_demanda cursor=independiente tabla=inalterada proyeccion=autorizada');
}

function verificarContratoVista(vista) {
  assert.match(vista, /data-url-correlaciones="\/auditoria\/api\/correlaciones"/);
  assert.match(vista, /data-url-actores="\/auditoria\/api\/actores"/);
  assert.match(vista, /data-auditoria-tabla-cuerpo/);
}

function verificarFiltrosAvanzados(vista, cliente) {
  assert.match(vista, /<details class="auditoria-filtros-avanzados"/);
  for (const nombre of [
    'actorRol', 'actorTipo', 'actorId', 'modoActuacion', 'origen',
    'claveCadena', 'correlacionId', 'causalidadTipo', 'causalidadId'
  ]) {
    assert.ok(vista.includes(`name="${nombre}"`), `Falta el filtro ${nombre}.`);
    assert.ok(cliente.includes(`'${nombre}'`), `El cliente no conserva ${nombre}.`);
  }
  assert.match(cliente, /fetch\(`\$\{urlActores\}\?\$\{parametros\.toString\(\)\}`/);
  assert.match(cliente, /Rol, tipo e ID exacto del actor deben aparecer juntos/);
  assert.match(cliente, /El tipo y el ID exacto de causalidad deben aparecer juntos/);
  assert.equal(
    cliente.match(/function validarParejaSujeto\(\)/g)?.length,
    1,
    'La validación cliente debe tener una única declaración ejecutable.'
  );
  assert.match(cliente, /parametros\.set\('actorRol', datos\.actorRol\)/);
  assert.match(cliente, /parametros\.set\('causalidadTipo', datos\.causalidadTipo\)/);
}

function verificarDetalleAutorizado(cliente) {
  assert.match(cliente, /class="auditoria-correlacion__insignia"/);
  assert.match(cliente, /<details class="auditoria-evento__tecnico">/);
  for (const campo of [
    'actorReal', 'actorEfectivo', 'rolEvento', 'origen', 'modoActuacion',
    'claveCadena', 'correlacionId', 'eventoContraparteId', 'causalidad'
  ]) {
    assert.ok(cliente.includes(`evento.${campo}`), `Falta el campo proyectado ${campo}.`);
  }
  assert.match(cliente, /\.filter\(\(\[, valor\]\) => valor != null && valor !== ''\)/);
  assert.match(cliente, /Sin detalle técnico autorizado/);
}

function verificarDetalleCambios(cliente) {
  assert.match(cliente, /renderizarDetalleCambios\(evento\.detalleCambios\)/);
  assert.match(cliente, /detalle\?\.version !== 1/);
  assert.match(cliente, /Cambios realizados/);
  assert.match(cliente, /data-label="Antes"/);
  assert.match(cliente, /data-label="Después"/);
  assert.doesNotMatch(
    cliente.slice(
      cliente.indexOf('function renderizarDetalleCambios'),
      cliente.indexOf('function renderizarPanelCorrelacion')
    ),
    /evento\.payload|camposCambiados/
  );
}

function verificarCargaBajoDemanda(cliente) {
  const inicioArranque = cliente.indexOf("void cargarIntegridad();");
  const finArranque = cliente.indexOf('async function cargarPagina', inicioArranque);
  assert.doesNotMatch(cliente.slice(inicioArranque, finArranque), /cargarCorrelacion/);
  assert.match(cliente, /data-auditoria-correlacion-accion="alternar"/);
  assert.match(cliente, /if \(abrir && !navegacion\.cargada\)/);
  assert.match(cliente, /void cargarCorrelacion\(panel, \{ indiceObjetivo: 0 \}\)/);
  assert.match(
    cliente,
    /`\$\{urlCorrelaciones\}\/\$\{encodeURIComponent\(correlacionId\)\}\/eventos\?\$\{parametros\.toString\(\)\}`/
  );
}

function verificarPaginacionAislada(cliente) {
  assert.match(cliente, /const navegacionCorrelaciones = new WeakMap\(\)/);
  assert.match(cliente, /cursores: \[null\], indice: 0, siguiente: null, cargada: false/);
  assert.match(cliente, /new URLSearchParams\(\{ limite: '10', orden: 'desc' \}\)/);
  assert.match(cliente, /navegacion\.cursores = navegacion\.cursores\.slice/);
  assert.match(cliente, /data-auditoria-correlacion-accion="primera"/);
  assert.match(cliente, /data-auditoria-correlacion-accion="anterior"/);
  assert.match(cliente, /data-auditoria-correlacion-accion="siguiente"/);
  assert.match(cliente, /cancelarCorrelaciones\(\);[\s\S]*controladorCarga\?\.abort\(\)/);
  const principal = cliente.slice(
    cliente.indexOf('function renderizarPagina(eventos)'),
    cliente.indexOf('function renderizarEvento(evento)')
  );
  assert.match(principal, /return idsRenderizados\.size/);
  assert.doesNotMatch(principal, /correlacion/i);
}

function verificarEstilos({ css, vista, cliente }) {
  for (const selector of [
    '.auditoria-correlacion__insignia',
    '.auditoria-evento__tecnico',
    '.auditoria-cambios',
    '.auditoria-cambios__fila',
    '.auditoria-cambios__valor--despues',
    '.auditoria-correlacion__contenido',
    '.auditoria-correlacion__evento',
    '.auditoria-correlacion__paginacion'
  ]) {
    assert.ok(css.includes(selector), `Falta estilo ${selector}.`);
  }
  assert.ok(css.includes('.auditoria-filtros-avanzados'), 'Falta estilo de filtros avanzados.');
  assert.ok(css.includes('.auditoria-filtros__actor'), 'Falta estilo del actor avanzado.');
  assert.match(css, /\.auditoria-accion\s*\{[\s\S]*color: var\(--texto\);[\s\S]*border-color: var\(--borde-fuerte\);/);
  assert.match(css, /\.auditoria-accion:hover,[\s\S]*\.auditoria-accion:focus-visible,[\s\S]*\.auditoria-accion\[aria-expanded="true"\]/);
  assert.doesNotMatch(cliente, /btn-outline-light/);
  assert.equal(
    [...vista.matchAll(/btn-outline-light/g)].length,
    1,
    'Solo el retorno situado dentro del hero puede conservar outline-light.'
  );
  assert.match(vista, /hero-monitores__acciones[\s\S]*btn-outline-light/);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*\.auditoria-correlacion__evento[\s\S]*grid-template-columns: 1fr/);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*\.auditoria-cambios__fila[\s\S]*grid-template-columns: 1fr/);
}

function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}

main().catch((error) => {
  console.error('[auditoria] ERROR 5.21.16m:', error);
  process.exitCode = 1;
});
