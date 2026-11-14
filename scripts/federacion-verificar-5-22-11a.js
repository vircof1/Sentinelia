import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import express from 'express';
import { ResolutorRedPublicaFederacion } from '../paquetes/federacion/aplicacion/ResolutorRedPublicaFederacion.js';

await main();

async function main() {
  verificarContratoInicial();
  await verificarCabecerasYRecargaViva();
  await verificarComposicion();
  console.log(
    '[federacion] OK 5.22.11a: origen=canonico proxies=dinamicos ' +
    'cabeceras_no_confiables=ignoradas rutas=protegidas upgrades=protegidos'
  );
}

function verificarContratoInicial() {
  const servicio = crearServicioConfiguracion({
    origenPublico: 'https://sentinelia.example',
    proxiesConfiables: []
  });
  const resolutor = new ResolutorRedPublicaFederacion({
    servicioConfiguracionPortal: servicio
  });
  assert.throws(() => resolutor.obtenerOrigenPublico(), /aún no está inicializado/);
}

async function verificarCabecerasYRecargaViva() {
  const servicio = crearServicioConfiguracion({
    origenPublico: 'https://sentinelia.example',
    proxiesConfiables: ['10.0.0.0/8']
  });
  const resolutor = new ResolutorRedPublicaFederacion({
    servicioConfiguracionPortal: servicio
  });
  await resolutor.inicializar();
  const aplicacion = express();
  resolutor.configurarAplicacionExpress(aplicacion);
  aplicacion.get('/contexto', (requisicion, respuesta) => respuesta.json({
    ipExpress: requisicion.ip,
    protocoloExpress: requisicion.protocol,
    contexto: requisicion.redPublicaFederacion
  }));
  const servidor = http.createServer(aplicacion);
  await escuchar(servidor);
  try {
    const noConfiable = await solicitar(servidor, {
      forwarded: 'for=198.51.100.12;proto=https;host=hostil.example',
      'x-forwarded-for': '198.51.100.12',
      'x-forwarded-host': 'hostil.example',
      'x-forwarded-proto': 'https',
      host: 'hostil.example'
    });
    assert.equal(noConfiable.contexto.saltoConfiable, false);
    assert.equal(noConfiable.contexto.cabecerasReenviadasAceptadas, false);
    assert.equal(noConfiable.contexto.protocoloExterior, 'http');
    assert.equal(noConfiable.contexto.hostReenviadoDiagnostico, null);
    assert.equal(noConfiable.contexto.origenPublico, 'https://sentinelia.example');
    assert.equal(noConfiable.protocoloExpress, 'http');
    assert.notEqual(noConfiable.ipExpress, '198.51.100.12');
    assert.notEqual(noConfiable.contexto.direccionCliente, '198.51.100.12');

    servicio.cambiar({
      origenPublico: 'https://nuevo.example:8443',
      proxiesConfiables: ['127.0.0.1/32']
    });
    const confiable = await solicitar(servidor, {
      'x-forwarded-for': '198.51.100.12',
      'x-forwarded-host': 'diagnostico.example',
      'x-forwarded-proto': 'https',
      host: 'tambien-hostil.example'
    });
    assert.equal(confiable.contexto.saltoConfiable, true);
    assert.equal(confiable.contexto.cabecerasReenviadasAceptadas, true);
    assert.equal(confiable.contexto.direccionCliente, '198.51.100.12');
    assert.equal(confiable.contexto.protocoloExterior, 'https');
    assert.equal(confiable.contexto.hostReenviadoDiagnostico, 'diagnostico.example');
    assert.equal(confiable.contexto.origenPublico, 'https://nuevo.example:8443');
    assert.equal(confiable.ipExpress, '198.51.100.12');
    assert.equal(confiable.protocoloExpress, 'https');

    servicio.cambiar({
      origenPublico: 'https://nuevo.example:8443',
      proxiesConfiables: ['nginx-sin-direccion-resuelta']
    });
    await assert.rejects(
      () => resolutor.asegurarActualizado(),
      /dirección o rango no aplicable/
    );
    assert.equal(
      resolutor.obtenerOrigenPublico(),
      'https://nuevo.example:8443',
      'Una actualización inválida no debe sustituir la última fotografía segura.'
    );
    assert.equal(resolutor.esProxyConfiable('127.0.0.1'), true);

    servicio.cambiar({
      origenPublico: 'https://nuevo.example:8443',
      proxiesConfiables: ['10.0.0.0/8']
    });
    const upgrade = {
      socket: { remoteAddress: '192.0.2.20', encrypted: false },
      headers: {
        forwarded: 'for=198.51.100.12;proto=https',
        'x-forwarded-for': '198.51.100.12',
        'x-forwarded-proto': 'https'
      }
    };
    const contextoUpgrade = await resolutor.prepararUpgrade(upgrade);
    assert.equal(contextoUpgrade.saltoConfiable, false);
    assert.equal(contextoUpgrade.cabecerasReenviadasAceptadas, false);
    assert.equal(contextoUpgrade.direccionCliente, '192.0.2.20');
    assert.equal(contextoUpgrade.protocoloExterior, 'http');
    assert.equal(upgrade.redPublicaFederacion, contextoUpgrade);
  } finally {
    await cerrar(servidor);
  }
}

async function verificarComposicion() {
  const [indice, aplicacion] = await Promise.all([
    leer('../apps/sentinelia-web/src/index.js'),
    leer('../apps/sentinelia-web/src/crearAplicacion.js')
  ]);
  assert.ok(
    indice.indexOf('await resolutorRedPublicaFederacion.inicializar()') <
      indice.indexOf('crearAplicacion({'),
    'El resolutor debe inicializarse antes de montar la aplicación.'
  );
  assert.match(
    indice,
    /await resolutorRedPublicaFederacion\.prepararUpgrade\(requisicion\)[\s\S]*atenderUpgrade/,
    'Cada upgrade debe refrescar la configuración antes de delegarse.'
  );
  assert.ok(
    aplicacion.indexOf('configurarAplicacionExpress(aplicacion)') <
      aplicacion.indexOf('express.urlencoded'),
    'La confianza de proxy debe aplicarse antes de cualquier middleware o ruta.'
  );
}

function crearServicioConfiguracion(inicial) {
  let version = 1;
  let configuracion = congelarConfiguracion(inicial);
  return {
    async asegurarActualizada() {
      return {
        obtenerConfiguracionFederacion() {
          return configuracion;
        }
      };
    },
    obtenerVersionActual() {
      return version;
    },
    cambiar(nueva) {
      configuracion = congelarConfiguracion(nueva);
      version += 1;
    }
  };
}

function congelarConfiguracion(configuracion) {
  return Object.freeze({
    ...configuracion,
    proxiesConfiables: Object.freeze([...configuracion.proxiesConfiables])
  });
}

async function escuchar(servidor) {
  await new Promise((resolve, reject) => {
    servidor.once('error', reject);
    servidor.listen(0, '127.0.0.1', resolve);
  });
}

async function cerrar(servidor) {
  await new Promise((resolve, reject) =>
    servidor.close((error) => error ? reject(error) : resolve())
  );
}

async function solicitar(servidor, headers) {
  const { port } = servidor.address();
  return new Promise((resolve, reject) => {
    const requisicion = http.request({
      hostname: '127.0.0.1',
      port,
      path: '/contexto',
      headers
    }, (respuesta) => {
      const fragmentos = [];
      respuesta.on('data', (fragmento) => fragmentos.push(fragmento));
      respuesta.on('end', () => {
        try {
          assert.equal(respuesta.statusCode, 200);
          resolve(JSON.parse(Buffer.concat(fragmentos).toString('utf8')));
        } catch (error) {
          reject(error);
        }
      });
    });
    requisicion.once('error', reject);
    requisicion.end();
  });
}

function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}
