import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';

import express from 'express';

import { ControladorDatosFederacion } from '../apps/sentinelia-web/src/controladores/ControladorDatosFederacion.js';
import { crearMiddlewareAutenticarPlanoDatosFederacion } from '../apps/sentinelia-web/src/middleware/autenticarPlanoDatosFederacion.js';
import { crearMiddlewareInterpretarLoteDatosFederacion } from '../apps/sentinelia-web/src/middleware/interpretarLoteDatosFederacion.js';
import { responderErrorDatosFederacion } from '../apps/sentinelia-web/src/middleware/responderErrorDatosFederacion.js';
import { crearRutasDatosFederacion } from '../apps/sentinelia-web/src/rutas/crearRutasDatosFederacion.js';
import { FuenteEntropiaCriptograficaNode } from '../paquetes/federacion/adaptadores/FuenteEntropiaCriptograficaNode.js';
import { RepositorioCursoresRecepcionFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioCursoresRecepcionFederacionSql.js';
import { RepositorioEntregasFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioEntregasFederacionSql.js';
import { ResolutorCapacidadRecepcionFederacion } from '../paquetes/federacion/aplicacion/ResolutorCapacidadRecepcionFederacion.js';
import { crearFixtureConfiguracionFederacion } from '../paquetes/federacion/fixtures/ContratoFederacionFixtures.js';
import {
  GeneradorIdentidadesFederadas,
  TIPOS_IDENTIDAD_FEDERADA
} from '../paquetes/federacion/src/IdentidadFederada.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import {
  obtenerConfiguracionAplicacion
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

const TOKEN = `sfop1_${'A'.repeat(64)}`;
const generador = new GeneradorIdentidadesFederadas({
  fuenteEntropia: new FuenteEntropiaCriptograficaNode()
});

await main();

async function main() {
  await verificarRegistro();
  await verificarFronterasHttp();
  await verificarConsultasSqlAcotadas();
  console.log(
    '[federacion] OK 5.22.13c: canal=proxy_https auth=sesion_viva ' +
    'limites=pre-reserva replay=recuperable relacion=aislada ' +
    'ack=post-durable errores=saneados'
  );
}

async function verificarConsultasSqlAcotadas() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true);
  const sql = new ClienteSql(configuracion.sql);
  const ids = crearIds();
  try {
    assert.equal(
      await new RepositorioEntregasFederacionSql(sql)
        .esReplayTerminalExacto(lote(ids, 1)),
      false
    );
    assert.equal(
      await new RepositorioCursoresRecepcionFederacionSql(sql)
        .obtenerProgresoParaRelacion({
          relacionId: ids.relacionId,
          flujoId: ids.flujoId,
          generacionId: ids.generacionId
        }),
      null
    );
  } finally {
    await sql.cerrar();
  }
}

async function verificarRegistro() {
  const [indice, rutas, cursores, entregas] = await Promise.all([
    leer('../apps/sentinelia-web/src/index.js'),
    leer('../apps/sentinelia-web/src/rutas/crearRutasDatosFederacion.js'),
    leer('../paquetes/federacion/adaptadores/RepositorioCursoresRecepcionFederacionSql.js'),
    leer('../paquetes/federacion/adaptadores/RepositorioEntregasFederacionSql.js')
  ]);
  assert.match(indice, /new ControladorDatosFederacion/u);
  assert.match(indice, /ProtectorContenidoSensibleFederacion|protectorContenidoSensible/u);
  assert.match(rutas, /autenticar,[\s\S]*interpretarLote,[\s\S]*controlador\.entregarLote/u);
  assert.match(cursores, /f\.relacion_id=\?[\s\S]*f\.direccion='recepcion'/u);
  assert.match(entregas, /esReplayTerminalExacto/u);
}

async function verificarFronterasHttp() {
  const ids = crearIds();
  const orden = [];
  let redConfiable = true;
  let replayTerminal = false;
  let errorInterno = false;
  let progresoSolicitado = null;
  let llamadasPersistencia = 0;
  const configuracion = crearFixtureConfiguracionFederacion({
    loteMaximoOcurrencias: 1,
    loteMaximoBytes: 1024 * 1024,
    ocurrenciaMaximaBytes: 512 * 1024
  });
  const portal = Object.freeze({
    obtenerConfiguracionFederacion() { return configuracion; }
  });
  const servicioConfiguracionPortal = {
    async asegurarActualizada() {
      orden.push('configuracion');
      return portal;
    },
    obtenerVersionActual() { return 7; }
  };
  const resolutorCapacidad = new ResolutorCapacidadRecepcionFederacion({
    servicioConfiguracionPortal
  });
  const servicioSesionesFederacion = {
    async validarBearer(token) {
      orden.push('autenticacion');
      assert.equal(token, TOKEN);
      return Object.freeze({ relacionId: ids.relacionId });
    }
  };
  const servicioRecepcionLotes = {
    async esReplayTerminalExacto() { return replayTerminal; },
    async entregarLote(entrada, { capacidad }) {
      orden.push('persistencia');
      llamadasPersistencia += 1;
      if (errorInterno) throw new Error('SQL_PASSWORD=secreto-no-publicable');
      assert.equal(capacidad.versionConfiguracion, '7');
      await new Promise((resolve) => setImmediate(resolve));
      return {
        loteId: entrada.loteId,
        persistidoDurablemente: true,
        capacidad
      };
    }
  };
  const repositorioCursores = {
    async obtenerProgresoParaRelacion(entrada) {
      progresoSolicitado = entrada;
      return null;
    }
  };
  const servicioDisponibilidad = {
    async registrar() { return Object.freeze({}); }
  };
  const repositorioDisponibilidad = {
    async listarParaRelacion() { return Object.freeze([]); }
  };
  const controlador = new ControladorDatosFederacion({
    servicioRecepcionLotes,
    repositorioCursores,
    servicioDisponibilidad,
    repositorioDisponibilidad,
    resolutorCapacidad
  });
  const aplicacion = express();
  aplicacion.use((requisicion, _respuesta, next) => {
    orden.push('proxy');
    requisicion.redPublicaFederacion = Object.freeze({
      saltoConfiable: redConfiable,
      cadenaProxiesConfiable: redConfiable,
      protocoloExterior: 'https'
    });
    next();
  });
  aplicacion.use(crearRutasDatosFederacion({
    servicioConfiguracionPortal,
    controladorDatosFederacion: controlador,
    middlewareAutenticacionDatosFederacion:
      crearMiddlewareAutenticarPlanoDatosFederacion({ servicioSesionesFederacion }),
    middlewareInterpretacionLoteFederacion:
      crearMiddlewareInterpretarLoteDatosFederacion({ resolutorCapacidad })
  }));
  aplicacion.use((error, requisicion, respuesta, _next) =>
    responderErrorDatosFederacion(error, requisicion, respuesta));

  let respuesta = await solicitar(aplicacion, {
    ruta: '/api/federacion/v1/datos/capacidad'
  });
  assert.equal(respuesta.statusCode, 401);
  assert.deepEqual(orden.splice(0), ['proxy', 'configuracion']);

  redConfiable = false;
  respuesta = await solicitar(aplicacion, {
    ruta: '/api/federacion/v1/datos/capacidad',
    bearer: true
  });
  assert.equal(respuesta.statusCode, 403);
  assert.deepEqual(
    orden.splice(0),
    ['proxy'],
    'Un canal hostil debe rechazarse antes de consultar la preparación receptora.'
  );
  redConfiable = true;

  respuesta = await solicitar(aplicacion, {
    ruta: '/api/federacion/v1/datos/capacidad',
    bearer: true
  });
  assert.equal(respuesta.statusCode, 200);
  assert.equal(respuesta.json.maximoOcurrenciasPorLote, 1);
  assert.deepEqual(orden.splice(0), ['proxy', 'configuracion', 'autenticacion']);

  respuesta = await solicitar(aplicacion, {
    metodo: 'POST',
    ruta: '/api/federacion/v1/datos/lotes',
    cuerpo: '{json-roto',
    bearer: true
  });
  assert.equal(respuesta.statusCode, 400);
  assert.equal(llamadasPersistencia, 0);
  orden.splice(0);

  respuesta = await solicitar(aplicacion, {
    metodo: 'POST',
    ruta: '/api/federacion/v1/datos/lotes',
    cuerpo: JSON.stringify(lote(ids, 2)),
    bearer: true
  });
  assert.equal(respuesta.statusCode, 413);
  assert.equal(respuesta.json.capacidad.maximoOcurrenciasPorLote, 1);
  assert.equal(llamadasPersistencia, 0);
  orden.splice(0);

  replayTerminal = true;
  respuesta = await solicitar(aplicacion, {
    metodo: 'POST',
    ruta: '/api/federacion/v1/datos/lotes',
    cuerpo: JSON.stringify(lote(ids, 2)),
    bearer: true
  });
  assert.equal(respuesta.statusCode, 200);
  assert.equal(respuesta.json.persistidoDurablemente, true);
  assert.equal(llamadasPersistencia, 1);
  assert.deepEqual(orden.splice(0), [
    'proxy', 'configuracion', 'autenticacion', 'persistencia'
  ]);
  replayTerminal = false;

  const ajeno = lote(ids, 1);
  ajeno.relacionId = generar(TIPOS_IDENTIDAD_FEDERADA.RELACION);
  respuesta = await solicitar(aplicacion, {
    metodo: 'POST',
    ruta: '/api/federacion/v1/datos/lotes',
    cuerpo: JSON.stringify(ajeno),
    bearer: true
  });
  assert.equal(respuesta.statusCode, 403);
  assert.equal(llamadasPersistencia, 1);
  orden.splice(0);

  respuesta = await solicitar(aplicacion, {
    ruta: `/api/federacion/v1/datos/flujos/${ids.flujoId}` +
      `/generaciones/${ids.generacionId}/progreso`,
    bearer: true
  });
  assert.equal(respuesta.statusCode, 404);
  assert.equal(progresoSolicitado.relacionId, ids.relacionId);
  orden.splice(0);

  errorInterno = true;
  const consoleError = console.error;
  try {
    console.error = () => {};
    respuesta = await solicitar(aplicacion, {
      metodo: 'POST',
      ruta: '/api/federacion/v1/datos/lotes',
      cuerpo: JSON.stringify(lote(ids, 1)),
      bearer: true
    });
  } finally {
    console.error = consoleError;
  }
  assert.equal(respuesta.statusCode, 503);
  assert.doesNotMatch(JSON.stringify(respuesta.json), /secreto-no-publicable|SQL_PASSWORD/u);
  assert.equal(respuesta.headers['cache-control'], 'no-store');
}

function lote(ids, cantidad) {
  return {
    loteId: ids.loteId,
    relacionId: ids.relacionId,
    flujoId: ids.flujoId,
    generacionId: ids.generacionId,
    entregas: Array.from({ length: cantidad }, (_, indice) => ({
      entregaId: ids.entregas[indice],
      posicionFlujo: String(indice + 1),
      ocurrencia: { fixture: true, indice }
    }))
  };
}

function crearIds() {
  return {
    relacionId: generar(TIPOS_IDENTIDAD_FEDERADA.RELACION),
    flujoId: generar(TIPOS_IDENTIDAD_FEDERADA.FLUJO),
    generacionId: generar(TIPOS_IDENTIDAD_FEDERADA.GENERACION),
    loteId: generar(TIPOS_IDENTIDAD_FEDERADA.LOTE),
    entregas: [
      generar(TIPOS_IDENTIDAD_FEDERADA.ENTREGA),
      generar(TIPOS_IDENTIDAD_FEDERADA.ENTREGA)
    ]
  };
}

function generar(tipo) {
  return String(generador.generar(tipo));
}

function solicitar(aplicacion, {
  metodo = 'GET', ruta, cuerpo = null, bearer = false
} = {}) {
  return new Promise((resolve, reject) => {
    const servidor = http.createServer(aplicacion);
    servidor.listen(0, '127.0.0.1', () => {
      const headers = {};
      if (bearer) headers.authorization = `Bearer ${TOKEN}`;
      if (cuerpo !== null) {
        headers['content-type'] = 'application/json';
        headers['content-length'] = Buffer.byteLength(cuerpo);
      }
      const requisicion = http.request({
        host: '127.0.0.1',
        port: servidor.address().port,
        method: metodo,
        path: ruta,
        headers
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
      requisicion.once('error', (error) => {
        servidor.close();
        reject(error);
      });
      if (cuerpo !== null) requisicion.write(cuerpo);
      requisicion.end();
    });
    servidor.once('error', reject);
  });
}

function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}
