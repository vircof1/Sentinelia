import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ejs from 'ejs';

import { ServicioSesion } from '../paquetes/sesiones/src/ServicioSesion.js';
import {
  AlegacionWebRecuperacionPasswordInvalida,
  ServicioContinuacionWebRecuperacionPasswordEmail
} from '../paquetes/usuarios/src/ServicioContinuacionWebRecuperacionPasswordEmail.js';
import { ControladorRecuperacionPassword }
  from '../apps/sentinelia-web/src/controladores/ControladorRecuperacionPassword.js';

const TOKEN = 'a'.repeat(43);
const EXPIRA_EN_UTC = new Date(Date.now() + 600_000).toISOString();

await main();

async function main() {
  await verificarPuertoWeb();
  await verificarContinuacionSesion();
  await verificarGetPasivoYRedaccion();
  await verificarResolucionYFallos();
  await verificarComposicion();
  console.log('[usuarios] OK 5.30.7b: bearer=pasivo url=redactada sesion=efimera csrf=obligatorio alegacion=acotada dominio=generico infraestructura=visible');
}

async function verificarPuertoWeb() {
  let inspecciones = 0;
  let resoluciones = 0;
  const servicio = new ServicioContinuacionWebRecuperacionPasswordEmail({
    repositorioSolicitudes: {
      async inspeccionar() {
        inspecciones += 1;
        return { estado: 'activa', solicitud: {
          expiraEnUtc: EXPIRA_EN_UTC,
          frontera: { miembros: [{ usuarioId: 'secreto' }] }
        } };
      }
    },
    servicioResolucion: {
      async resolver(entrada) {
        resoluciones += 1;
        assert.equal(entrada.leaseSegundos, 17);
        return { estado: 'resuelta', utilizable: true,
          alegacion: { usuarioIdResuelto: '99' } };
      }
    },
    servicioConsumo: {
      async sustituirYConverger() {
        return { estado: 'sustituida', sustituida: true,
          convergencia: 'completa' };
      }
    },
    servicioConfiguracionPortal: configuracionFixture()
  });
  assert.deepEqual(await servicio.inspeccionar('mal'), {
    estado: 'ausente', utilizable: false
  });
  assert.equal(inspecciones, 0);
  const inspeccion = await servicio.inspeccionar(TOKEN);
  assert.deepEqual(inspeccion, {
    estado: 'activa', utilizable: true, expiraEnUtc: EXPIRA_EN_UTC
  });
  assert.equal(JSON.stringify(inspeccion).includes('secreto'), false);
  assert.deepEqual(await servicio.resolver({ token: TOKEN, usuario: 'Javier' }), {
    estado: 'resuelta', utilizable: true, resuelta: true
  });
  assert.equal(resoluciones, 1);
  await assert.rejects(
    () => servicio.resolver({ token: TOKEN, usuario: 'x' }),
    AlegacionWebRecuperacionPasswordInvalida
  );
  assert.equal(resoluciones, 1);
}

async function verificarContinuacionSesion() {
  const servicio = Object.create(ServicioSesion.prototype);
  const requisicion = crearRequisicion();
  await servicio.guardarContinuacionRecuperacionPassword(requisicion, {
    token: TOKEN,
    expiraEnUtc: EXPIRA_EN_UTC
  });
  const guardada = servicio.obtenerContinuacionRecuperacionPassword(requisicion);
  assert.equal(guardada.token, TOKEN);
  assert.equal(guardada.identidadResuelta, false);
  await servicio.marcarIdentidadResueltaRecuperacionPassword(requisicion);
  assert.equal(
    servicio.obtenerContinuacionRecuperacionPassword(requisicion).identidadResuelta,
    true
  );
  assert.ok(requisicion.guardados >= 2);
  await servicio.limpiarContinuacionRecuperacionPassword(requisicion);
  assert.equal(servicio.obtenerContinuacionRecuperacionPassword(requisicion), null);
}

async function verificarGetPasivoYRedaccion() {
  const estado = crearEstadoControlador();
  const controlador = crearControlador(estado);
  const respuesta = crearRespuesta();
  await controlador.recibirEnlace(
    crearRequisicion({ query: { token: TOKEN } }), respuesta
  );
  assert.deepEqual(estado.llamadas, [['inspeccionar', TOKEN], ['guardar', TOKEN]]);
  assert.equal(respuesta.estadoHttp, 303);
  assert.equal(respuesta.destino, '/recuperacion-password/continuar');
  assert.equal(respuesta.destino.includes(TOKEN), false);
  comprobarCabecerasPrivadas(respuesta);

  estado.continuacion = { token: TOKEN, expiraEnUtc: EXPIRA_EN_UTC,
    identidadResuelta: false };
  estado.llamadas.length = 0;
  const limpia = crearRespuesta();
  await controlador.mostrarResolucion(crearRequisicion(), limpia);
  assert.deepEqual(estado.llamadas, [['inspeccionar', TOKEN]]);
  assert.equal(limpia.vista, 'recuperacion-password-resolucion');
  assert.equal(limpia.datos.disponible, true);
  comprobarCabecerasPrivadas(limpia);
}

async function verificarResolucionYFallos() {
  const estado = crearEstadoControlador();
  estado.continuacion = { token: TOKEN, expiraEnUtc: EXPIRA_EN_UTC,
    identidadResuelta: false };
  const controlador = crearControlador(estado);
  const respuesta = crearRespuesta();
  await controlador.resolverIdentidad(
    crearRequisicion({ body: { usuario: 'Javier' } }), respuesta
  );
  assert.deepEqual(estado.llamadas, [['resolver', TOKEN, 'Javier'], ['resuelta']]);
  assert.equal(respuesta.datos.resuelta, true);
  assert.equal(JSON.stringify(respuesta.datos).includes(TOKEN), false);

  estado.llamadas.length = 0;
  estado.resultadoResolucion = {
    estado: 'no_resuelta', utilizable: true, resuelta: false
  };
  const noResuelta = crearRespuesta();
  await controlador.resolverIdentidad(
    crearRequisicion({ body: { usuario: 'nadie' } }), noResuelta
  );
  assert.equal(noResuelta.estadoHttp, 200);
  assert.match(noResuelta.datos.error, /No se ha podido/u);

  estado.falloInspeccion = new Error('redis caído');
  const tecnica = crearRespuesta();
  await controlador.mostrarResolucion(crearRequisicion(), tecnica);
  assert.equal(tecnica.estadoHttp, 503);
  assert.equal(tecnica.datos.disponible, false);
}

async function verificarComposicion() {
  const [rutas, index, vista] = await Promise.all([
    leer('../apps/sentinelia-web/src/rutas/crearRutasPortal.js'),
    leer('../apps/sentinelia-web/src/index.js'),
    leer('../apps/sentinelia-web/src/views/recuperacion-password-resolucion.ejs')
  ]);
  assert.match(rutas, /router\.get\(\s*'\/recuperacion-password'/u);
  assert.match(rutas,
    /router\.post\(\s*'\/recuperacion-password\/continuar',\s*validarCsrfPortal/u);
  assert.match(index, /ServicioResolucionAgnosticaRecuperacionPasswordEmail/u);
  assert.match(index, /ServicioContinuacionWebRecuperacionPasswordEmail/u);
  assert.doesNotMatch(vista, /name="token"/u);
  ejs.compile(vista, {
    filename: new URL('../apps/sentinelia-web/src/views/recuperacion-password-resolucion.ejs', import.meta.url).pathname
  });
}

function crearControlador(estado) {
  return new ControladorRecuperacionPassword({
    servicioInicio: { emitirDesafio: async () => ({}), iniciar: async () => ({}) },
    servicioContinuacion: {
      async inspeccionar(token) {
        estado.llamadas.push(['inspeccionar', token]);
        if (estado.falloInspeccion) throw estado.falloInspeccion;
        return { estado: 'activa', utilizable: true, expiraEnUtc: EXPIRA_EN_UTC };
      },
      async resolver({ token, usuario }) {
        estado.llamadas.push(['resolver', token, usuario]);
        return estado.resultadoResolucion;
      },
      async sustituir() { return { estado: 'sustituida', sustituida: true }; }
    },
    servicioSesion: {
      asegurarTokenCsrfPublico: async () => 'csrf-publico',
      async guardarContinuacionRecuperacionPassword(_req, { token }) {
        estado.llamadas.push(['guardar', token]);
      },
      obtenerContinuacionRecuperacionPassword: () => estado.continuacion,
      async marcarIdentidadResueltaRecuperacionPassword() {
        estado.llamadas.push(['resuelta']);
      },
      async limpiarContinuacionRecuperacionPassword() {
        estado.llamadas.push(['limpiar']);
      }
    },
    superficiePublicaHabilitada: () => false
  });
}

function crearEstadoControlador() {
  return {
    llamadas: [], continuacion: null, falloInspeccion: null,
    resultadoResolucion: { estado: 'resuelta', utilizable: true, resuelta: true }
  };
}

function crearRequisicion(sobrescribir = {}) {
  const session = sobrescribir.session || {};
  const requisicion = { query: {}, body: {}, session, guardados: 0,
    ...sobrescribir };
  requisicion.session.save = (callback) => {
    requisicion.guardados += 1;
    callback();
  };
  return requisicion;
}

function crearRespuesta() {
  return {
    locals: {}, cabeceras: {}, estadoHttp: 200,
    status(valor) { this.estadoHttp = valor; return this; },
    set(clave, valor) { this.cabeceras[clave] = valor; return this; },
    render(vista, datos) { this.vista = vista; this.datos = datos; return this; },
    redirect(estado, destino) {
      this.estadoHttp = estado; this.destino = destino; return this;
    }
  };
}

function comprobarCabecerasPrivadas(respuesta) {
  assert.match(respuesta.cabeceras['Cache-Control'], /no-store/u);
  assert.equal(respuesta.cabeceras['Referrer-Policy'], 'no-referrer');
  assert.match(respuesta.cabeceras['X-Robots-Tag'], /noindex/u);
}

function configuracionFixture() {
  return {
    async asegurarActualizada() {},
    obtenerConfiguracionActual: () => ({
      obtenerConfiguracionUsuarios: () => ({
        recuperacionEmailLeaseAlegacionSegundos: 17
      })
    })
  };
}

function leer(relativa) {
  return readFile(new URL(relativa, import.meta.url), 'utf8');
}
