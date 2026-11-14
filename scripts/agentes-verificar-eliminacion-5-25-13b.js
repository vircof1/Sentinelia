import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ejs from 'ejs';

import { ControladorEliminacionAdministrativaAgentes }
  from '../apps/sentinelia-web/src/controladores/ControladorEliminacionAdministrativaAgentes.js';

const OPERACION_ID = '018f7f40-1111-7111-8111-111111111111';

async function main() {
  await verificarAdaptadorHtmlYContratoHttp();
  await verificarVistasDestructivas();
  await verificarCampanaYRecuperacion();
  await verificarEntradaYGate();
  console.log(
    '[agentes] OK 5.25.13b: confirmacion=exacta_accesible ' +
    'aceptacion=303_encolada seguimiento=fases_sin_porcentajes ' +
    'buzon=personal_scope_actual fecha=local ws=invalida http=recupera ' +
    'foco=restaurado tema=variables gate=apagado'
  );
}

async function verificarAdaptadorHtmlYContratoHttp() {
  const llamadas = [];
  const controlador = crearControlador({ llamadas });
  const requisicion = crearRequisicion({ accept: 'text/html' });
  const impacto = crearRespuesta();
  await controlador.obtenerImpacto(requisicion, impacto, assert.ifError);
  assert.equal(impacto.statusCode, 303);
  assert.equal(impacto.redireccion, '/agentes');
  assert.equal(llamadas.length, 0);

  const impactoJson = crearRespuesta();
  await controlador.obtenerImpacto(
    crearRequisicion({ accept: 'application/json', ajax: true }),
    impactoJson,
    assert.ifError
  );
  assert.equal(impactoJson.statusCode, 200);
  assert.equal(impactoJson.cuerpo.impacto.sujeto.nombre, 'Montessori');
  assert.equal(impactoJson.cabeceras['Cache-Control'], 'no-store');

  const aceptada = crearRespuesta();
  await controlador.aceptar(requisicion, aceptada, assert.ifError);
  assert.equal(aceptada.statusCode, 303);
  assert.equal(aceptada.redireccion, `/agentes?operacion_id=${OPERACION_ID}`);
  assert.match(requisicion.session.flashAgentes.mensaje, /todavía|seguir/u);

  const detalle = crearRespuesta();
  await controlador.mostrarOperacion({
    ...requisicion,
    params: { operacionId: OPERACION_ID }
  }, detalle, assert.ifError);
  assert.equal(detalle.vista, 'portal/operacion-administrativa');

  const expirada = crearControlador({
    errorAceptacion: Object.assign(new Error('caducada'), {
      name: 'ErrorConfirmacionEliminacionAgente',
      codigo: 'agente_eliminacion_confirmacion_expirada'
    })
  });
  const respuestaJson = crearRespuesta();
  await expirada.aceptar(
    crearRequisicion({ accept: 'application/json', ajax: true }),
    respuestaJson,
    assert.ifError
  );
  assert.equal(respuestaJson.statusCode, 410);
  assert.equal(respuestaJson.cuerpo.codigo, 'agente_eliminacion_confirmacion_expirada');

  const respuestaHtml = crearRespuesta();
  const requisicionHtml = crearRequisicion({ accept: 'text/html' });
  await expirada.aceptar(requisicionHtml, respuestaHtml, assert.ifError);
  assert.equal(respuestaHtml.statusCode, 303);
  assert.equal(respuestaHtml.redireccion, '/agentes');
  assert.match(requisicionHtml.session.flashAgentes.mensaje, /caducad/u);
}

async function verificarVistasDestructivas() {
  const rutas = [
    '../apps/sentinelia-web/src/views/portal/agentes.ejs',
    '../apps/sentinelia-web/src/views/portal/operacion-administrativa.ejs'
  ];
  const fuentes = await Promise.all(rutas.map(async (ruta) => {
    const url = new URL(ruta, import.meta.url);
    const fuente = await readFile(url, 'utf8');
    ejs.compile(fuente, { filename: url.pathname });
    return fuente;
  }));
  const [catalogo, operacion] = fuentes;
  assert.match(catalogo, /data-agentes-modal-eliminar/u);
  assert.match(catalogo, /data-agentes-eliminar-formulario/u);
  assert.match(catalogo, /data-agentes-eliminar-estado/u);
  assert.match(catalogo, /aria-live="polite"/u);
  assert.doesNotMatch(catalogo, /Abrir la página de revisión/u);
  for (const fase of ['preparacion', 'validacion', 'eliminacion', 'commit', 'limpieza']) {
    assert.ok(operacion.includes(`'${fase}'`));
  }
  assert.match(operacion, /No representa porcentajes ni calcula tiempos restantes/u);
  assert.equal(operacion.includes('data-operacion-porcentaje'), false);
}

async function verificarCampanaYRecuperacion() {
  const [cabecera, portal, dashboard, seguimiento, css, servicioBuzon, resolutorAgente] =
    await Promise.all([
      leer('../apps/sentinelia-web/src/views/parciales/cabecera.ejs'),
      leer('../apps/sentinelia-web/src/public/js/portal.js'),
      leer('../apps/sentinelia-web/src/public/js/panel-dashboard.js'),
      leer('../apps/sentinelia-web/src/public/js/eliminacion-agentes.js'),
      leer('../apps/sentinelia-web/src/public/css/portal.css'),
      leer('../paquetes/agentes/src/ServicioBuzonNotificacionesUsuario.js'),
      leer('../paquetes/agentes/src/ResolutorSujetosAgenteNotificaciones.js')
    ]);
  assert.match(cabecera, /capacidadesPortal\?\.eliminacionAdministrativaAgentes/u);
  assert.match(cabecera, /Abrir buzón personal/u);
  assert.match(cabecera, /Buzón personal/u);
  assert.notEqual(cabecera.indexOf('Buzón personal'), cabecera.indexOf('Avisos de plataforma'));
  assert.equal((portal.match(/new WebSocket/gu) || []).length, 1);
  assert.match(portal, /portal:buzon-usuario-actualizado/u);
  assert.match(dashboard, /portal:buzon-usuario-actualizado/u);
  assert.match(portal, /setInterval\(refrescarContador, 30000\)/u);
  assert.match(portal, /visibilitychange/u);
  assert.match(portal, /window\.addEventListener\('focus'/u);
  assert.match(portal, /evento\.key === 'Escape'/u);
  assert.match(portal, /\.focus\(\)/u);
  assert.match(portal, /textContent/u);
  assert.match(portal, /portalFechas\?\.formatear/u);
  assert.match(servicioBuzon, /etiquetaEmisor/u);
  assert.match(servicioBuzon, /\/operaciones-administrativas\//u);
  assert.match(servicioBuzon, /catalogoResolutoresSujetos/u);
  assert.match(resolutorAgente, /String\(agente\.guid\).*String\(referencia\.guid\)/u);
  assert.match(seguimiento, /respuesta\.status === 404/u);
  assert.match(seguimiento, /alcance actual/u);
  assert.equal(seguimiento.includes('ultimoError.codigo'), false);
  assert.match(css, /\.buzon-personal-notificacion--no-leida/u);
  assert.match(css, /var\(--superficie\)/u);
}

async function verificarEntradaYGate() {
  const [agentes, agentesJs, rutas, aplicacion, inyeccion] = await Promise.all([
    leer('../apps/sentinelia-web/src/views/portal/agentes.ejs'),
    leer('../apps/sentinelia-web/src/public/js/agentes.js'),
    leer('../apps/sentinelia-web/src/rutas/crearRutasPortal.js'),
    leer('../apps/sentinelia-web/src/crearAplicacion.js'),
    leer('../apps/sentinelia-web/src/middleware/inyectarSesionVista.js')
  ]);
  assert.match(agentes, /data-puede-eliminar/u);
  assert.match(agentes, /data-operacion-eliminacion/u);
  assert.match(agentesJs, /Eliminar agente/u);
  assert.match(rutas, /\/operaciones-administrativas\/:operacionId/u);
  assert.match(rutas, /requerirEliminacionAdministrativaAgentesHttp/u);
  assert.match(aplicacion, /eliminacionAdministrativaAgentesHttpHabilitada/u);
  assert.match(inyeccion, /eliminacionAdministrativaAgentes:\s*\n?\s*eliminacionAdministrativaAgentesHttpHabilitada === true/u);
}

function crearControlador({ llamadas = [], errorAceptacion = null } = {}) {
  return new ControladorEliminacionAdministrativaAgentes({
    servicioImpacto: {
      async preparar(entrada) {
        llamadas.push(['impacto', entrada]);
        return {
          sujeto: { tipo: 'agente', id: '9', guid: '01234567-89ab-4def-8abc-0123456789ab', nombre: 'Montessori' },
          resumenImpacto: { conteos: [{ categoria: 'agente', cantidad: '1', precision: 'exacta' }] },
          fraseConfirmacion: 'Montessori 3456789ab'.slice(0, -1),
          tokenConfirmacion: 'token-opaco',
          expiraEnUtc: '2026-08-30T12:10:00.000Z'
        };
      }
    },
    servicioAceptacion: {
      async aceptar(entrada) {
        llamadas.push(['aceptar', entrada]);
        if (errorAceptacion) throw errorAceptacion;
        return { codigo: 'agente_eliminacion_encolada', repetida: false, operacionId: OPERACION_ID, estado: 'encolada' };
      }
    },
    servicioConsultaOperaciones: {
      async obtener() { return { operacionId: OPERACION_ID, estado: 'encolada', sujeto: { id: '9', guid: 'guid' } }; }
    },
    servicioBuzon: {
      async listar() { return { notificaciones: [], paginacion: {}, noLeidas: 0 }; },
      async resumir() { return { noLeidas: 0 }; },
      async marcarLeida() { return { cambioEfectivo: false }; }
    }
  });
}

function crearRequisicion({ accept, ajax = false } = {}) {
  return {
    params: { id: '9' },
    body: { tokenConfirmacion: 'token-opaco', fraseConfirmacion: 'Montessori 3456789a' },
    query: {},
    session: { usuarioAutenticado: { tokenCSRF: 'csrf-seguro' } },
    contextoUsuarioActual: { idUsuario: 4, idUsuarioReal: 3 },
    get(nombre) {
      if (nombre === 'accept') return accept;
      if (nombre === 'x-requested-with') return ajax ? 'XMLHttpRequest' : '';
      return '';
    }
  };
}

function crearRespuesta() {
  return {
    statusCode: 200,
    cabeceras: {},
    status(codigo) { this.statusCode = codigo; return this; },
    set(nombre, valor) { this.cabeceras[nombre] = valor; return this; },
    json(cuerpo) { this.cuerpo = cuerpo; return this; },
    render(vista, datos) { this.vista = vista; this.datos = datos; return this; },
    redirect(codigo, ruta) { this.statusCode = codigo; this.redireccion = ruta; return this; },
    locals: { usuarioActual: { nombreVisible: 'Fixture' } }
  };
}

async function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}

await main();
