import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';

import express from 'express';

import {
  RUTAS_DATOS_FEDERACION,
  crearRutasDatosFederacion
} from '../apps/sentinelia-web/src/rutas/crearRutasDatosFederacion.js';
import {
  atenderUpgradeDatosFederacion
} from '../apps/sentinelia-web/src/rutas/atenderUpgradeDatosFederacion.js';

await main();

async function main() {
  await verificarRegistroYComposicion();
  await verificarOrdenYDespacho();
  await verificarGateSinControlador();
  await verificarFronteraSinRedResuelta();
  verificarUpgradeAislado();
  console.log(
    '[federacion] OK 5.22.13b: rutas=compuestas proxy=canal_configuracion_antes ' +
    'parser=reservado_13c sesion-humana=aislada agentes=aislados ' +
    'gate=503 upgrade=no_humano'
  );
}

async function verificarRegistroYComposicion() {
  const [
    openapi,
    aplicacion,
    rutasDatos,
    rutasFederacion,
    rutasAgentes,
    index
  ] = await Promise.all([
    leer('../openapi/federacion-control.v1.yaml'),
    leer('../apps/sentinelia-web/src/crearAplicacion.js'),
    leer('../apps/sentinelia-web/src/rutas/crearRutasDatosFederacion.js'),
    leer('../apps/sentinelia-web/src/rutas/crearRutasApiFederacion.js'),
    leer('../apps/sentinelia-web/src/rutas/crearRutasApiAgentes.js'),
    leer('../apps/sentinelia-web/src/index.js')
  ]);
  const rutasEsperadas = [
    '/api/federacion/v1/datos/capacidad',
    '/api/federacion/v1/datos/lotes',
    '/api/federacion/v1/datos/flujos/:flujoId/generaciones/:generacionId/progreso',
    '/api/federacion/v1/datos/flujos/:flujoId/generaciones/:generacionId/disponibilidad'
  ];
  assert.deepEqual(Object.values(RUTAS_DATOS_FEDERACION), rutasEsperadas);
  for (const ruta of rutasEsperadas) {
    const rutaOpenApi = ruta
      .replace(':flujoId', '{flujoId}')
      .replace(':generacionId', '{generacionId}');
    assert.ok(openapi.includes(`  ${rutaOpenApi}:`), `OpenAPI no declara ${rutaOpenApi}.`);
  }
  for (const clave of Object.keys(RUTAS_DATOS_FEDERACION)) {
    assert.match(rutasDatos, new RegExp(`RUTAS_DATOS_FEDERACION\\.${clave}`, 'u'));
  }
  assert.doesNotMatch(rutasFederacion, /\/datos(?:\/|')/u);
  assert.doesNotMatch(rutasAgentes, /federacion/iu);
  assert.doesNotMatch(
    rutasDatos,
    /(?:sessionMiddleware|servicioSesion|crearRutasApiAgentes|express\.json|ServicioRecepcionLotesFederacionLocal|Repositorio)/u
  );

  const posiciones = [
    aplicacion.indexOf('crearRutasDatosFederacion({'),
    aplicacion.indexOf('express.urlencoded({ extended: false })'),
    aplicacion.indexOf('express.json()'),
    aplicacion.indexOf('crearRutasApiFederacion({'),
    aplicacion.indexOf('crearRutasApiAgentes({'),
    aplicacion.indexOf('aplicacion.use(sessionMiddleware)')
  ];
  assert.ok(posiciones.every((posicion) => posicion >= 0));
  assert.deepEqual([...posiciones].sort((a, b) => a - b), posiciones);

  const prepararUpgrade = index.indexOf(
    'await resolutorRedPublicaFederacion.prepararUpgrade(requisicion)'
  );
  const fronteraUpgrade = index.indexOf(
    'atenderUpgradeDatosFederacion(requisicion, socket)'
  );
  const websocketHumano = index.indexOf(
    'await difusorWebSocketPortal.atenderUpgrade(requisicion, socket, head)'
  );
  assert.ok(prepararUpgrade >= 0 && prepararUpgrade < fronteraUpgrade);
  assert.ok(fronteraUpgrade < websocketHumano);
}

async function verificarOrdenYDespacho() {
  const orden = [];
  const servicioConfiguracionPortal = {
    async asegurarActualizada() {
      orden.push('configuracion');
      return configuracionFederacionActiva({ fotografia: 'vigente' });
    }
  };
  const controlador = {
    obtenerCapacidad(requisicion, respuesta) {
      registrarFrontera(requisicion, orden, 'capacidad');
      respuesta.json({ operacion: 'capacidad' });
    },
    entregarLote(requisicion, respuesta) {
      registrarFrontera(requisicion, orden, 'lote');
      respuesta.json({ operacion: 'lote', cuerpoInterpretado: requisicion.body !== undefined });
    },
    obtenerProgreso(requisicion, respuesta) {
      registrarFrontera(requisicion, orden, 'progreso');
      respuesta.json({ operacion: 'progreso', parametros: requisicion.params });
    },
    registrarDisponibilidad(requisicion, respuesta) {
      registrarFrontera(requisicion, orden, 'registrar-disponibilidad');
      respuesta.json({
        operacion: 'registrar-disponibilidad',
        cuerpoInterpretado: requisicion.body?.tipo === 'rangoDisponible'
      });
    },
    listarDisponibilidad(requisicion, respuesta) {
      registrarFrontera(requisicion, orden, 'listar-disponibilidad');
      respuesta.json({ operacion: 'listar-disponibilidad' });
    }
  };
  const aplicacion = express();
  aplicacion.use((requisicion, _respuesta, next) => {
    orden.push('proxy');
    requisicion.redPublicaFederacion = Object.freeze({
      saltoConfiable: true,
      cadenaProxiesConfiable: true,
      protocoloExterior: 'https',
      versionConfiguracion: 7
    });
    next();
  });
  aplicacion.use(crearRutasDatosFederacion({
    servicioConfiguracionPortal,
    controladorDatosFederacion: controlador,
    middlewareAutenticacionDatosFederacion: (_requisicion, _respuesta, next) => next(),
    middlewareInterpretacionLoteFederacion: (_requisicion, _respuesta, next) => next()
  }));

  const capacidad = await solicitar(aplicacion, { ruta: '/api/federacion/v1/datos/capacidad' });
  assert.equal(capacidad.statusCode, 200);
  assert.equal(capacidad.json.operacion, 'capacidad');
  assert.deepEqual(orden.splice(0), ['proxy', 'configuracion', 'capacidad']);

  const lote = await solicitar(aplicacion, {
    metodo: 'POST',
    ruta: '/api/federacion/v1/datos/lotes',
    cuerpo: '{"no":"interpretado-en-13b"}'
  });
  assert.equal(lote.statusCode, 200);
  assert.equal(lote.json.cuerpoInterpretado, false);
  assert.deepEqual(orden.splice(0), ['proxy', 'configuracion', 'lote']);

  const progreso = await solicitar(aplicacion, {
    ruta: '/api/federacion/v1/datos/flujos/f1/generaciones/g1/progreso'
  });
  assert.equal(progreso.statusCode, 200);
  assert.deepEqual(progreso.json.parametros, { flujoId: 'f1', generacionId: 'g1' });
  assert.deepEqual(orden.splice(0), ['proxy', 'configuracion', 'progreso']);

  const disponibilidad = await solicitar(aplicacion, {
    metodo: 'POST',
    ruta: '/api/federacion/v1/datos/flujos/f1/generaciones/g1/disponibilidad',
    cuerpo: JSON.stringify({ tipo: 'rangoDisponible' }),
    cabeceras: { 'content-type': 'application/json' }
  });
  assert.equal(disponibilidad.statusCode, 200);
  assert.equal(disponibilidad.json.cuerpoInterpretado, true);
  assert.deepEqual(
    orden.splice(0),
    ['proxy', 'configuracion', 'registrar-disponibilidad']
  );
}

async function verificarGateSinControlador() {
  const aplicacion = express();
  aplicacion.use((requisicion, _respuesta, next) => {
    requisicion.redPublicaFederacion = Object.freeze({
      saltoConfiable: true,
      cadenaProxiesConfiable: true,
      protocoloExterior: 'https'
    });
    next();
  });
  aplicacion.use(crearRutasDatosFederacion({
    servicioConfiguracionPortal: {
      async asegurarActualizada() { return configuracionFederacionActiva(); }
    }
  }));
  const respuesta = await solicitar(aplicacion, {
    metodo: 'POST',
    ruta: '/api/federacion/v1/datos/lotes',
    cuerpo: '{incluso-json-invalido'
  });
  assert.equal(respuesta.statusCode, 503);
  assert.equal(respuesta.json.codigo, 'PLANO_DATOS_FEDERACION_NO_DISPONIBLE');
  assert.equal(respuesta.headers['cache-control'], 'no-store');
}

async function verificarFronteraSinRedResuelta() {
  const aplicacion = express();
  aplicacion.use(crearRutasDatosFederacion({
    servicioConfiguracionPortal: {
      async asegurarActualizada() {
        throw new Error('No debe cargar configuración sin red resuelta.');
      }
    }
  }));
  aplicacion.use((error, _requisicion, respuesta, _next) => {
    respuesta.status(error.statusCode || 500).json({ codigo: error.codigo });
  });
  const respuesta = await solicitar(aplicacion, {
    ruta: '/api/federacion/v1/datos/capacidad'
  });
  assert.equal(respuesta.statusCode, 503);
  assert.equal(respuesta.json.codigo, 'RED_PUBLICA_FEDERADA_NO_RESUELTA');
}

function verificarUpgradeAislado() {
  const escrituras = [];
  const socket = { end(datos) { escrituras.push(datos); } };
  assert.equal(atenderUpgradeDatosFederacion({
    url: '/api/federacion/v1/datos/lotes?canal=accidental'
  }, socket), true);
  assert.equal(escrituras.length, 1);
  assert.match(escrituras[0], /^HTTP\/1\.1 404 Not Found\r\n/u);
  assert.match(escrituras[0], /Connection: close/u);
  assert.equal(atenderUpgradeDatosFederacion({
    url: '/ws/panel-dashboard'
  }, socket), false);
  assert.equal(escrituras.length, 1);
}

function registrarFrontera(requisicion, orden, operacion) {
  assert.equal(requisicion.redPublicaFederacion.saltoConfiable, true);
  assert.equal(
    requisicion.fronteraPlanoDatosFederacion.configuracionPortal.fotografia,
    'vigente'
  );
  orden.push(operacion);
}

function configuracionFederacionActiva(valores = {}) {
  return Object.freeze({
    ...valores,
    obtenerConfiguracionFederacion: () => Object.freeze({
      activacionFederacion: true,
      origenPublico: 'https://receptor.example.invalid',
      proxiesConfiables: ['127.0.0.1/32']
    })
  });
}

function solicitar(aplicacion, {
  metodo = 'GET',
  ruta,
  cuerpo = null
} = {}) {
  return new Promise((resolve, reject) => {
    const servidor = http.createServer(aplicacion);
    servidor.listen(0, '127.0.0.1', () => {
      const direccion = servidor.address();
      const requisicion = http.request({
        host: '127.0.0.1',
        port: direccion.port,
        method: metodo,
        path: ruta,
        headers: cuerpo === null ? {} : {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(cuerpo)
        }
      }, (respuesta) => {
        const fragmentos = [];
        respuesta.on('data', (fragmento) => fragmentos.push(fragmento));
        respuesta.on('end', () => {
          servidor.close();
          const texto = Buffer.concat(fragmentos).toString('utf8');
          resolve({
            statusCode: respuesta.statusCode,
            headers: respuesta.headers,
            json: texto ? JSON.parse(texto) : null
          });
        });
      });
      requisicion.on('error', (error) => {
        servidor.close();
        reject(error);
      });
      if (cuerpo !== null) requisicion.write(cuerpo);
      requisicion.end();
    });
    servidor.on('error', reject);
  });
}

function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}
