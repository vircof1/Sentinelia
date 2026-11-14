import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';

import express from 'express';

import {
  ClienteHttpControlFederacion
} from '../paquetes/federacion/adaptadores/ClienteHttpControlFederacion.js';
import {
  ClienteHttpDatosFederacion
} from '../paquetes/federacion/adaptadores/ClienteHttpDatosFederacion.js';
import {
  FuenteEntropiaCriptograficaNode
} from '../paquetes/federacion/adaptadores/FuenteEntropiaCriptograficaNode.js';
import {
  RepositorioDestinosEmisionFederacionSql
} from '../paquetes/federacion/adaptadores/RepositorioDestinosEmisionFederacionSql.js';
import {
  ResolutorRedPublicaFederacion
} from '../paquetes/federacion/aplicacion/ResolutorRedPublicaFederacion.js';
import {
  GeneradorIdentidadesFederadas,
  TIPOS_IDENTIDAD_FEDERADA
} from '../paquetes/federacion/src/IdentidadFederada.js';
import {
  crearRutasApiFederacion
} from '../apps/sentinelia-web/src/rutas/crearRutasApiFederacion.js';

const TOKEN = `sfop1_${'T'.repeat(64)}`;
const generador = new GeneradorIdentidadesFederadas({
  fuenteEntropia: new FuenteEntropiaCriptograficaNode()
});

await main();

async function main() {
  await verificarFronteraEntranteAdversaria();
  await verificarTransporteSalienteAdversario();
  await verificarEstablecimientoRepresentado();
  await verificarDestinoSqlAprobado();
  console.log(
    '[federacion] OK 5.22.19b: proxy=cadena_completa https=externo ' +
    'origen=canonico host=no_autoritativo redirecciones=bloqueadas ' +
    'destino=sql_o_representacion cabeceras_hostiles=rechazadas'
  );
}

async function verificarFronteraEntranteAdversaria() {
  const { aplicacion, cerrar } = await crearAplicacionFrontera([
    '127.0.0.1/32', '10.0.0.0/8'
  ]);
  try {
    let respuesta = await solicitar(aplicacion, {
      'x-forwarded-for': '198.51.100.7, 10.2.3.4',
      'x-forwarded-host': 'diagnostico.example:8443',
      'x-forwarded-proto': 'https',
      host: 'host-controlado-por-cliente.example'
    });
    assert.equal(respuesta.statusCode, 200);
    assert.equal(respuesta.json.origenPublico, 'https://publico.example');
    assert.equal(respuesta.json.hostReenviadoDiagnostico, 'diagnostico.example:8443');
    assert.equal(respuesta.json.cadenaProxiesConfiable, true);
    assert.equal(respuesta.json.direccionCliente, '198.51.100.7');

    respuesta = await solicitar(aplicacion, {
      'x-forwarded-for': '198.51.100.7, 192.0.2.44',
      'x-forwarded-proto': 'https'
    });
    assert.equal(respuesta.statusCode, 403);
    assert.equal(respuesta.json.codigo, 'CANAL_FEDERADO_NO_CONFIABLE');
    assert.equal(respuesta.cacheControl, 'no-store');

    for (const cabeceras of [
      { 'x-forwarded-proto': 'https, http' },
      { forwarded: 'for=198.51.100.7;proto=https;host=hostil.example' },
      {
        forwarded: 'for=198.51.100.7;proto=http',
        'x-forwarded-proto': 'https'
      },
      {
        'x-forwarded-for': 'direccion[malformada',
        'x-forwarded-proto': 'https'
      },
      { 'x-forwarded-proto': 'javascript' }
    ]) {
      respuesta = await solicitar(aplicacion, cabeceras);
      assert.equal(respuesta.statusCode, 403);
      assert.equal(respuesta.json.codigo, 'CANAL_FEDERADO_NO_CONFIABLE');
    }
  } finally {
    await cerrar();
  }

  const noConfiable = await crearAplicacionFrontera(['10.0.0.0/8']);
  try {
    const respuesta = await solicitar(noConfiable.aplicacion, {
      'x-forwarded-for': '198.51.100.7',
      'x-forwarded-proto': 'https'
    });
    assert.equal(respuesta.statusCode, 403);
  } finally {
    await noConfiable.cerrar();
  }
}

async function verificarTransporteSalienteAdversario() {
  const ids = crearIds();
  const destino = {
    relacionId: ids.relacionId,
    installationRemotaId: ids.installationId,
    endpoint: 'https://receptor.example/prefijo'
  };
  let solicitudes = 0;
  const cliente = new ClienteHttpDatosFederacion({
    fetchImpl: async (url, opciones) => {
      solicitudes += 1;
      assert.equal(url, 'https://receptor.example/prefijo/api/federacion/v1/datos/capacidad');
      assert.equal(opciones.redirect, 'error');
      assert.deepEqual(Object.keys(opciones.headers).sort(), ['accept', 'authorization']);
      assert.equal(opciones.headers.authorization, `Bearer ${TOKEN}`);
      return respuestaJson({ ok: true });
    }
  });
  await cliente.obtenerCapacidad({ destino, token: TOKEN });
  assert.equal(solicitudes, 1);

  for (const endpoint of [
    'http://receptor.example',
    'https://usuario:secreto@receptor.example',
    'https://receptor.example?destino=otro',
    'https://receptor.example/#fragmento'
  ]) {
    await assert.rejects(
      cliente.obtenerCapacidad({ destino: { ...destino, endpoint }, token: TOKEN })
    );
  }
  assert.equal(solicitudes, 1, 'Un endpoint inválido no debe alcanzar la red.');

  const clienteRedireccion = new ClienteHttpDatosFederacion({
    fetchImpl: async (_url, opciones) => {
      assert.equal(opciones.redirect, 'error');
      throw new TypeError('redirect mode is set to error');
    }
  });
  await assert.rejects(
    clienteRedireccion.obtenerCapacidad({ destino, token: TOKEN }),
    (error) => error.codigo === 'transporte_federado_no_disponible'
  );
}

async function verificarEstablecimientoRepresentado() {
  const ids = crearIds();
  const origen = 'https://establecimiento.example';
  let solicitudCapturada = null;
  const cliente = new ClienteHttpControlFederacion({
    fetchImpl: async (url, opciones) => {
      solicitudCapturada = { url, opciones };
      return respuestaJson(
        { ok: true },
        url.endsWith('/establecimiento/canje') ? 201 : 200
      );
    }
  });
  const invitacion = {
    destino: {
      origenPublico: origen,
      installationId: ids.installationId,
      relacionId: ids.relacionId
    }
  };
  await cliente.canjearInvitacion({
    destino: origen,
    solicitud: { invitacion }
  });
  assert.equal(
    solicitudCapturada.url,
    `${origen}/api/federacion/v1/establecimiento/canje`
  );
  assert.equal(solicitudCapturada.opciones.redirect, 'error');
  assert.equal(solicitudCapturada.opciones.headers.authorization, undefined);

  await cliente.canjearRecuperacion({
    destino: origen,
    solicitud: { recuperacion: { destino: invitacion.destino } }
  });
  assert.equal(
    solicitudCapturada.url,
    `${origen}/api/federacion/v1/continuidad/recuperacion/canje`
  );

  await assert.rejects(
    async () => cliente.canjearInvitacion({
      destino: 'https://sustituto-hostil.example',
      solicitud: { invitacion }
    }),
    /debe coincidir con su representación validada/
  );
}

async function verificarDestinoSqlAprobado() {
  const ids = crearIds();
  let consulta = null;
  const repositorio = new RepositorioDestinosEmisionFederacionSql({
    async consultar(sql, parametros) {
      consulta = { sql, parametros };
      return [{
        relacion_id: ids.relacionId,
        installation_remota_id: ids.installationId,
        version_autoridad: 3,
        estado_compatibilidad: 'compatible',
        endpoint_https: 'https://aprobado.example'
      }];
    }
  });
  const destino = await repositorio.obtenerAprobadoOperativo({
    relacionId: ids.relacionId
  });
  assert.equal(destino.endpoint, 'https://aprobado.example');
  assert.deepEqual(consulta.parametros, [ids.relacionId]);
  for (const condicion of [
    "r.direccion='emision'", "r.estado_ciclo='vinculada'",
    "r.estado_autoridad='autorizada'", "r.estado_identidad='valida'",
    "l.estado='activa'"
  ]) assert.ok(consulta.sql.includes(condicion));
}

async function crearAplicacionFrontera(proxiesConfiables) {
  const resolutor = new ResolutorRedPublicaFederacion({
    servicioConfiguracionPortal: {
      async asegurarActualizada() {
        return {
          obtenerConfiguracionFederacion() {
            return {
              origenPublico: 'https://publico.example',
              proxiesConfiables
            };
          }
        };
      },
      obtenerVersionActual() { return 1; }
    }
  });
  await resolutor.inicializar();
  const controlador = Object.fromEntries([
    'canjearInvitacion', 'login', 'refresh', 'heartbeat',
    'recuperarCredencial', 'rotarCredencialPersistente',
    'publicarDeclaracionConcesion', 'consultarConfirmacionConcesion',
    'publicarManifiestoFlujoInicial', 'consultarManifiestosFlujosIniciales'
  ].map((metodo) => [metodo, (requisicion, respuesta) => respuesta.json({
    ok: true,
    metodo,
    ...requisicion.redPublicaFederacion
  })]));
  const aplicacion = express();
  resolutor.configurarAplicacionExpress(aplicacion);
  aplicacion.use(crearRutasApiFederacion({
    controladorApiFederacion: controlador,
    guardiaRecepcionFederacion: {
      async exigirPreparada() { return Object.freeze({}); }
    }
  }));
  aplicacion.use((error, _requisicion, respuesta, _next) => respuesta
    .status(error.statusCode || 500)
    .json({ codigo: error.codigo || 'ERROR_INTERNO' }));
  const servidor = http.createServer(aplicacion);
  await new Promise((resolve, reject) => {
    servidor.once('error', reject);
    servidor.listen(0, '127.0.0.1', resolve);
  });
  return {
    aplicacion: servidor,
    cerrar: () => new Promise((resolve, reject) =>
      servidor.close((error) => error ? reject(error) : resolve()))
  };
}

function solicitar(servidor, cabeceras) {
  const { port } = servidor.address();
  return new Promise((resolve, reject) => {
    const requisicion = http.request({
      hostname: '127.0.0.1',
      port,
      method: 'POST',
      path: '/api/federacion/v1/establecimiento/canje',
      headers: cabeceras
    }, (respuesta) => {
      const fragmentos = [];
      respuesta.on('data', (fragmento) => fragmentos.push(fragmento));
      respuesta.on('end', () => {
        try {
          resolve({
            statusCode: respuesta.statusCode,
            cacheControl: respuesta.headers['cache-control'],
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
}

function respuestaJson(cuerpo, status = 200) {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function crearIds() {
  return {
    relacionId: String(generador.generar(TIPOS_IDENTIDAD_FEDERADA.RELACION)),
    installationId: String(generador.generar(TIPOS_IDENTIDAD_FEDERADA.INSTALACION))
  };
}

function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}
