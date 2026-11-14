import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const RUTAS = 'apps/sentinelia-web/src/rutas/crearRutasPortal.js';
const CONTROLADOR = 'apps/sentinelia-web/src/controladores/ControladorAuditoria.js';
const CABECERA = 'apps/sentinelia-web/src/views/parciales/cabecera.ejs';
const VISTA = 'apps/sentinelia-web/src/views/portal/auditoria-cronologia.ejs';
const JS = 'apps/sentinelia-web/src/public/js/auditoria-cronologia.js';
const CSS = 'apps/sentinelia-web/src/public/css/portal.css';
const SERVICIO = 'paquetes/auditoria/src/ServicioLecturaAuditoria.js';
const REPOSITORIO = 'paquetes/auditoria/src/RepositorioLecturaAuditoriaSql.js';

async function main() {
  const archivos = await leerArchivos([
    RUTAS,
    CONTROLADOR,
    CABECERA,
    VISTA,
    JS,
    CSS,
    SERVICIO,
    REPOSITORIO
  ]);

  verificarRutaYPermiso(archivos);
  verificarVistaAjax(archivos);
  verificarComportamientoCliente(archivos);
  verificarFiltrosTemporalesApi(archivos);

  console.log('[auditoria] OK 5.21.14b: cronologia=ajax ventana=7d filtros=uniformes estados=visibles correlacion=agrupada evidencia=minimizada');
}

async function leerArchivos(rutas) {
  const entradas = await Promise.all(
    rutas.map(async (ruta) => [ruta, await readFile(new URL(`../${ruta}`, import.meta.url), 'utf8')])
  );
  return Object.fromEntries(entradas);
}

function verificarRutaYPermiso(archivos) {
  assert.match(archivos[CONTROLADOR], /async mostrarCronologia\(/, 'Falta el controlador HTML de cronología.');
  assert.match(archivos[CONTROLADOR], /portal\/auditoria-cronologia/, 'La cronología debe renderizar su vista dedicada.');
  assert.match(
    archivos[RUTAS],
    /router\.get\(\s*['"]\/auditoria['"][\s\S]*requerirVerAuditoria[\s\S]*mostrarCronologia/,
    'La ruta /auditoria debe exigir verAuditoria antes de mostrar la cronología.'
  );
  assert.match(archivos[CABECERA], /contextoUsuarioActual\.permisos\.verAuditoria/, 'La entrada de cabecera debe depender de verAuditoria.');
  assert.match(archivos[CABECERA], /href="\/auditoria"/, 'Falta la navegación a auditoría.');
}

function verificarVistaAjax(archivos) {
  const vista = archivos[VISTA];
  for (const marca of [
    'data-auditoria-cronologia',
    'data-url-eventos="/auditoria/api/eventos"',
    'data-auditoria-filtros',
    'data-auditoria-estado',
    'data-auditoria-error',
    'data-auditoria-vacio',
    'data-auditoria-lista',
    'data-auditoria-cargar-mas',
    'data-auditoria-fin',
    'data-auditoria-periodo'
  ]) {
    assert.ok(vista.includes(marca), `Falta marca AJAX ${marca}.`);
  }
  for (const nombre of ['name="flujo"', 'name="tipoEvento"', 'name="orden"']) {
    assert.ok(vista.includes(nombre), `Falta filtro uniforme ${nombre}.`);
  }
  assert.match(archivos[CONTROLADOR], /CATALOGO_TIPOS_EVENTO_AUDITORIA\.map/, 'Las sugerencias de tipo deben proceder del catálogo real.');
  assert.match(vista, /data-auditoria-tipos-evento/, 'El tipo de evento debe ofrecer búsqueda sobre el catálogo.');
  assert.match(vista, /data-auditoria-tipo-evento-opciones/, 'La búsqueda por nombre debe mostrar opciones seleccionables.');
  assert.match(vista, /La ventana inicial cubre siete días/, 'La vista debe explicar la ventana inicial de siete días.');
  assert.match(vista, /Los límites de fecha se calculan en UTC; las horas de los eventos se muestran en tu zona local/, 'La interfaz debe aclarar la diferencia entre filtro UTC y hora local.');
  assert.match(vista, /No se puede concluir el estado de integridad/, 'La ausencia de diagnósticos no debe interpretarse como integridad confirmada.');
  for (const ayuda of ['Actor exacto', 'Clave de cadena exacta', 'ID de correlación', 'Causalidad exacta']) {
    assert.ok(vista.includes(ayuda), `Falta ayuda contextual para ${ayuda}.`);
  }
  assert.match(archivos[JS], /actualizarPeriodoHero/, 'El hero debe mostrar el rango temporal aplicado.');
  assert.match(vista, /no hay un filtro global que los mezcle/, 'La vista debe evitar el filtro global por resultado/estado.');
  assert.match(vista, /data-auditoria-integridad-resumen hidden/, 'No se deben mostrar tres ceros mientras faltan diagnósticos.');
  assert.match(archivos[JS], /integridadResumen\.hidden = cadenas\.length === 0/, 'La integridad debe distinguir ausencia de diagnóstico.');
  assert.match(vista, /\/js\/auditoria-cronologia\.js/, 'La vista debe cargar el cliente AJAX dedicado.');
}

function verificarComportamientoCliente(archivos) {
  const js = archivos[JS];
  for (const marca of [
    'fetch(`${urlEventos}',
    "parametros.set('limite', datos.limite)",
    "parametros.set('desdeUtc', `${datos.desde}T00:00:00.000Z`)",
    "parametros.set('hastaUtc', resolverHastaUtc(datos.hasta))",
    'siguienteCursor',
    'renderizarGrupos',
    'data-auditoria-correlacion',
    'grupo.continuacion',
    'resumirPayload',
    'camposCambiados',
    'eventoContraparteId',
    'causalidad',
    'data-auditoria-cargar-mas'
  ]) {
    assert.ok(js.includes(marca), `El cliente de cronología no cubre ${marca}.`);
  }
  assert.match(archivos[VISTA], /<option value="25" selected>/, 'La UX debe conservar 25 como límite inicial.');
  assert.match(js, /fechaUtcDesplazada\(-6\)/, 'La UX debe conservar siete días naturales iniciales.');
  assert.match(js, /etiquetarEvento\(evento\.tipoEvento\)/, 'La lista debe mostrar nombres legibles de evento.');
  assert.match(js, /normalizarBusquedaTipoEvento/, 'La búsqueda debe aceptar nombres legibles y acentos.');
  assert.match(js, /seleccionarTipoEvento/, 'La sugerencia debe convertir el nombre en código exacto.');
  assert.match(js, /etiquetarCampoCambio/, 'El resumen de cambios debe traducir los nombres de campos.');
  assert.match(js, /evento\.eventoId !== panel\.dataset\.eventoId/, 'La correlación no debe presentar el propio evento como uno adicional.');
  assert.match(js, /inicializarTooltipsAuditoria\(cuerpoTabla\)/, 'Las ayudas de los eventos cargados por AJAX deben inicializarse.');
  assert.match(js, /Intl\.DateTimeFormat\('es-ES'/, 'La fecha debe tener formato local explícito en español.');
  const inicioFila = js.indexOf('function renderizarEvento(evento)');
  const finFilaOrdinaria = js.indexOf('function renderizarDetalleTecnico', inicioFila);
  const tramoCronologia = js.slice(inicioFila, finFilaOrdinaria);
  assert.doesNotMatch(
    tramoCronologia,
    /hashActual|hashAnterior|claveCadena|secuencia/,
    'La cronología no debe renderizar evidencia técnica de cadena.'
  );

  const css = archivos[CSS];
  for (const clase of ['.auditoria-filtros', '.auditoria-lista', '.auditoria-grupo', '.auditoria-evento', '.auditoria-cronologia__vacio']) {
    assert.ok(css.includes(clase), `Falta estilo operativo ${clase}.`);
  }
}

function verificarFiltrosTemporalesApi(archivos) {
  assert.match(archivos[SERVICIO], /consulta\.desdeUtc/, 'El servicio debe admitir desdeUtc para la ventana temporal.');
  assert.match(archivos[SERVICIO], /consulta\.hastaUtc/, 'El servicio debe admitir hastaUtc para ventanas explícitas.');
  assert.match(archivos[SERVICIO], /normalizarFechaFiltro/, 'Las fechas de filtro deben normalizarse.');
  assert.match(archivos[REPOSITORIO], /registrado_en_utc >= \?/, 'El repositorio debe aplicar desdeUtc.');
  assert.match(archivos[REPOSITORIO], /registrado_en_utc <= \?/, 'El repositorio debe aplicar hastaUtc.');
}

main().catch((error) => {
  console.error('[auditoria] Falló la verificación 5.21.14b');
  console.error(error);
  process.exitCode = 1;
});
