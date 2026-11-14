import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';

import express from 'express';

import {
  responderErrorDatosFederacion
} from '../apps/sentinelia-web/src/middleware/responderErrorDatosFederacion.js';
import {
  crearRutasApiFederacion
} from '../apps/sentinelia-web/src/rutas/crearRutasApiFederacion.js';
import {
  crearRutasDatosFederacion
} from '../apps/sentinelia-web/src/rutas/crearRutasDatosFederacion.js';
import {
  ErrorRecepcionFederacionNoPreparada,
  GuardiaRecepcionFederacion
} from '../paquetes/federacion/aplicacion/GuardiaRecepcionFederacion.js';
import {
  ServicioContinuidadFederacion
} from '../paquetes/federacion/aplicacion/ServicioContinuidadFederacion.js';
import {
  ServicioInvitacionesFederacion
} from '../paquetes/federacion/aplicacion/ServicioInvitacionesFederacion.js';

await main();

async function main() {
  await verificarGuardiaViva();
  await verificarAprovisionamientoProtegido();
  await verificarFronteraControl();
  await verificarFronteraDatos();
  await verificarAlcanceYRegistro();
  console.log(
    '[federacion] OK 5.22.22c: guardia=receptora_viva ' +
    'control=antes_de_controlador datos=antes_de_auth ' +
    'canal=antes_de_preparacion emision=no_afectada'
  );
}

async function verificarAprovisionamientoProtegido() {
  let secretosGenerados = 0;
  let escrituras = 0;
  const guardiaRecepcion = {
    async exigirPreparada(operacion) {
      throw new ErrorRecepcionFederacionNoPreparada({
        operacion,
        bloqueos: ['origenPublicoAusente']
      });
    }
  };
  const invitaciones = new ServicioInvitacionesFederacion({
    repositorioInvitaciones: {
      async emitir() { escrituras += 1; },
      async revocar() {}
    },
    generadorCredencial: {
      generar() { secretosGenerados += 1; return {}; }
    },
    resolverOrigenPublico: () => null,
    installationReceptoraId: `sfid1.instalacion.${'A'.repeat(22)}`,
    guardiaRecepcion
  });
  await assert.rejects(
    invitaciones.emitir(),
    (error) => error.codigo === 'RECEPCION_FEDERACION_NO_PREPARADA' &&
      error.operacion === 'emitir_invitacion'
  );

  const repositorioContinuidad = Object.fromEntries([
    'emitirRecuperacion', 'canjearRecuperacion', 'rotarCredencial',
    'proponerLocalizacion', 'aprobarLocalizacion'
  ].map((metodo) => [metodo, async () => { escrituras += 1; }]));
  const continuidad = new ServicioContinuidadFederacion({
    repositorio: repositorioContinuidad,
    servicioSesiones: { async validarBearer() {} },
    repositorioSesionesRedis: { async revocar() {} },
    generadorRecuperacion: {
      generar() { secretosGenerados += 1; return {}; }
    },
    generadorSecretoPersistente: { generar() { return {}; } },
    installationLocalId: `sfid1.instalacion.${'A'.repeat(22)}`,
    resolverOrigenPublico: () => null,
    guardiaRecepcion
  });
  await assert.rejects(
    continuidad.emitirRecuperacion(),
    (error) => error.codigo === 'RECEPCION_FEDERACION_NO_PREPARADA' &&
      error.operacion === 'emitir_recuperacion'
  );
  assert.equal(secretosGenerados, 0);
  assert.equal(escrituras, 0);
}

async function verificarGuardiaViva() {
  const estado = crearConfiguracionViva({ activacionFederacion: false });
  const guardia = new GuardiaRecepcionFederacion({
    servicioConfiguracionPortal: estado.servicio
  });
  await assert.rejects(
    guardia.exigirPreparada('prueba_inactiva'),
    (error) => error instanceof ErrorRecepcionFederacionNoPreparada &&
      error.codigo === 'RECEPCION_FEDERACION_NO_PREPARADA' &&
      error.statusCode === 503 &&
      error.operacion === 'prueba_inactiva' &&
      error.bloqueos.includes('federacionDesactivada') &&
      Object.isFrozen(error.bloqueos)
  );
  estado.cambiar({ activacionFederacion: true });
  await assert.rejects(
    guardia.exigirPreparada('prueba_sin_entrada'),
    (error) => error.bloqueos.join(',') ===
      'origenPublicoAusente,proxiesConfiablesAusentes'
  );
  estado.cambiar(configuracionReceptora());
  const evaluacion = await guardia.exigirPreparada('prueba_preparada');
  assert.equal(evaluacion.capacidades.emisionDisponible, true);
  assert.equal(evaluacion.capacidades.recepcionPreparada, true);
  assert.equal(estado.actualizaciones, 3);
}

async function verificarFronteraControl() {
  const estado = crearConfiguracionViva({ activacionFederacion: true });
  const guardia = new GuardiaRecepcionFederacion({
    servicioConfiguracionPortal: estado.servicio
  });
  let canalConfiable = true;
  let llamadasControlador = 0;
  const controlador = crearControladorApi(() => { llamadasControlador += 1; });
  const aplicacion = express();
  aplicacion.use((requisicion, _respuesta, next) => {
    requisicion.redPublicaFederacion = contextoRed(canalConfiable);
    next();
  });
  aplicacion.use(crearRutasApiFederacion({
    controladorApiFederacion: controlador,
    guardiaRecepcionFederacion: guardia
  }));

  let respuesta = await solicitar(aplicacion, {
    metodo: 'POST',
    ruta: '/api/federacion/v1/establecimiento/canje'
  });
  assert.equal(respuesta.statusCode, 503);
  assert.equal(respuesta.json.codigo, 'RECEPCION_FEDERACION_NO_PREPARADA');
  assert.equal(respuesta.headers['cache-control'], 'no-store');
  assert.equal(llamadasControlador, 0);

  estado.cambiar(configuracionReceptora());
  respuesta = await solicitar(aplicacion, {
    metodo: 'POST',
    ruta: '/api/federacion/v1/establecimiento/canje'
  });
  assert.equal(respuesta.statusCode, 200);
  assert.equal(llamadasControlador, 1);

  const actualizacionesAntes = estado.actualizaciones;
  canalConfiable = false;
  respuesta = await solicitar(aplicacion, {
    metodo: 'POST',
    ruta: '/api/federacion/v1/establecimiento/canje'
  });
  assert.equal(respuesta.statusCode, 403);
  assert.equal(respuesta.json.codigo, 'CANAL_FEDERADO_NO_CONFIABLE');
  assert.equal(estado.actualizaciones, actualizacionesAntes);
  assert.equal(llamadasControlador, 1);
}

async function verificarFronteraDatos() {
  const estado = crearConfiguracionViva({ activacionFederacion: true });
  let autenticaciones = 0;
  let controladores = 0;
  const aplicacion = express();
  aplicacion.use((requisicion, _respuesta, next) => {
    requisicion.redPublicaFederacion = contextoRed(true);
    next();
  });
  aplicacion.use(crearRutasDatosFederacion({
    servicioConfiguracionPortal: estado.servicio,
    controladorDatosFederacion: crearControladorDatos(() => {
      controladores += 1;
    }),
    middlewareAutenticacionDatosFederacion: (_requisicion, _respuesta, next) => {
      autenticaciones += 1;
      next();
    },
    middlewareInterpretacionLoteFederacion: (_requisicion, _respuesta, next) =>
      next()
  }));
  aplicacion.use((error, requisicion, respuesta, _next) =>
    responderErrorDatosFederacion(error, requisicion, respuesta));

  let respuesta = await solicitar(aplicacion, {
    ruta: '/api/federacion/v1/datos/capacidad'
  });
  assert.equal(respuesta.statusCode, 503);
  assert.equal(respuesta.json.codigo, 'RECEPCION_FEDERACION_NO_PREPARADA');
  assert.equal(autenticaciones, 0);
  assert.equal(controladores, 0);

  estado.cambiar(configuracionReceptora());
  respuesta = await solicitar(aplicacion, {
    ruta: '/api/federacion/v1/datos/capacidad'
  });
  assert.equal(respuesta.statusCode, 200);
  assert.equal(autenticaciones, 1);
  assert.equal(controladores, 1);
}

async function verificarAlcanceYRegistro() {
  const [aplicacion, rutasControl, rutasDatos, importacion, sincronizacion] = await Promise.all([
    leer('../apps/sentinelia-web/src/crearAplicacion.js'),
    leer('../apps/sentinelia-web/src/rutas/crearRutasApiFederacion.js'),
    leer('../apps/sentinelia-web/src/rutas/crearRutasDatosFederacion.js'),
    leer('../paquetes/federacion/aplicacion/ServicioImportacionFederacionPortal.js'),
    leer('../paquetes/federacion/aplicacion/ServicioSincronizacionConcesionFederacionPortal.js')
  ]);
  assert.ok(
    aplicacion.indexOf("'/api/federacion/v1/openapi.yaml'") <
      aplicacion.indexOf('crearRutasApiFederacion({')
  );
  assert.ok(
    aplicacion.indexOf('crearRutasApiFederacion({') <
      aplicacion.indexOf('aplicacion.use(sessionMiddleware)')
  );
  assert.match(
    rutasControl,
    /exigirCanalPublicoFederacion[\s\S]*crearMiddlewareExigirRecepcionFederacion/u
  );
  assert.match(
    rutasDatos,
    /exigirCanalPublicoFederacion,[\s\S]*preparar/u
  );
  assert.doesNotMatch(importacion, /GuardiaRecepcionFederacion/u);
  assert.doesNotMatch(sincronizacion, /GuardiaRecepcionFederacion/u);
}

function crearConfiguracionViva(inicial) {
  let configuracion = inicial;
  let actualizaciones = 0;
  const portal = Object.freeze({
    obtenerConfiguracionFederacion() { return configuracion; }
  });
  return {
    servicio: {
      async asegurarActualizada() {
        actualizaciones += 1;
        return portal;
      }
    },
    cambiar(nueva) { configuracion = nueva; },
    get actualizaciones() { return actualizaciones; }
  };
}

function configuracionReceptora() {
  return {
    activacionFederacion: true,
    origenPublico: 'https://receptor.example.invalid',
    proxiesConfiables: ['127.0.0.1/32']
  };
}

function contextoRed(confiable) {
  return Object.freeze({
    saltoConfiable: confiable,
    cadenaProxiesConfiable: confiable,
    protocoloExterior: confiable ? 'https' : 'http'
  });
}

function crearControladorApi(alEjecutar) {
  return Object.fromEntries([
    'canjearInvitacion', 'login', 'refresh', 'heartbeat',
    'recuperarCredencial', 'rotarCredencialPersistente',
    'publicarDeclaracionConcesion', 'consultarConfirmacionConcesion',
    'publicarManifiestoFlujoInicial', 'consultarManifiestosFlujosIniciales'
  ].map((metodo) => [metodo, (_requisicion, respuesta) => {
    alEjecutar();
    respuesta.json({ ok: true, metodo });
  }]));
}

function crearControladorDatos(alEjecutar) {
  return Object.fromEntries([
    'obtenerCapacidad', 'entregarLote', 'obtenerProgreso',
    'registrarDisponibilidad', 'listarDisponibilidad'
  ].map((metodo) => [metodo, (_requisicion, respuesta) => {
    alEjecutar();
    respuesta.json({ ok: true, metodo });
  }]));
}

function solicitar(aplicacion, { metodo = 'GET', ruta } = {}) {
  return new Promise((resolve, reject) => {
    const servidor = http.createServer(aplicacion);
    servidor.listen(0, '127.0.0.1', () => {
      const direccion = servidor.address();
      const requisicion = http.request({
        host: '127.0.0.1',
        port: direccion.port,
        method: metodo,
        path: ruta
      }, (respuesta) => {
        const fragmentos = [];
        respuesta.on('data', (fragmento) => fragmentos.push(fragmento));
        respuesta.on('end', () => {
          servidor.close();
          try {
            resolve({
              statusCode: respuesta.statusCode,
              headers: respuesta.headers,
              json: JSON.parse(Buffer.concat(fragmentos).toString('utf8'))
            });
          } catch (error) {
            reject(error);
          }
        });
      });
      requisicion.once('error', reject);
      requisicion.end();
    });
  });
}

function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}
