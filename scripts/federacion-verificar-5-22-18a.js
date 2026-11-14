import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { ServicioPresentacionRedPublicaFederacion } from
  '../apps/sentinelia-web/src/servicios/ServicioPresentacionRedPublicaFederacion.js';
import { obtenerDefinicionesConfiguracionPortal } from
  '../paquetes/configuracion/src/obtenerDefinicionesConfiguracionPortal.js';
import { ResolutorRedPublicaFederacion } from
  '../paquetes/federacion/aplicacion/ResolutorRedPublicaFederacion.js';
import { obtenerConfiguracionAplicacion } from
  '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

await main();

async function main() {
  verificarEntradaDesdeEntorno();
  await verificarPresentacionYActualizacionViva();
  await verificarComposicionPortal();
  console.log(
    '[federacion] OK 5.22.18a: configuracion=entorno_a_SQL ' +
    'proxy=aplicable advertencias=visibles actualizacion=viva navegador=sin_autoridad'
  );
}

function verificarEntradaDesdeEntorno() {
  process.env.PORTAL_ORIGEN_PUBLICO = 'https://federacion.example:8443';
  process.env.PORTAL_PROXIES_REVERSOS_CONFIABLES =
    '127.0.0.1/32, 10.20.0.0/16';
  const entorno = obtenerConfiguracionAplicacion();
  assert.equal(
    entorno.federacion.origenPublico,
    'https://federacion.example:8443'
  );
  assert.deepEqual(
    entorno.federacion.proxiesConfiables,
    ['127.0.0.1/32', '10.20.0.0/16']
  );
  const definiciones = obtenerDefinicionesConfiguracionPortal(entorno);
  const origen = definiciones.find(({ clave }) =>
    clave === 'federacion.origen_publico'
  );
  const proxies = definiciones.find(({ clave }) =>
    clave === 'federacion.proxies_confiables'
  );
  assert.equal(origen.valorPorDefecto, 'https://federacion.example:8443');
  assert.equal(proxies.valorPorDefecto, '127.0.0.1/32\n10.20.0.0/16');
  assert.equal(proxies.tipoEntrada, 'textarea');
}

async function verificarPresentacionYActualizacionViva() {
  const servicioConfiguracionPortal = crearServicioConfiguracion();
  const resolutorRedPublicaFederacion = new ResolutorRedPublicaFederacion({
    servicioConfiguracionPortal
  });
  await resolutorRedPublicaFederacion.inicializar();
  const presentador = new ServicioPresentacionRedPublicaFederacion({
    servicioConfiguracionPortal,
    resolutorRedPublicaFederacion
  });
  const inicial = await presentador.construir();
  assert.equal(inicial.estado, 'desactivada');
  assert.equal(inicial.etiquetaEstado, 'Federación desactivada');
  assert.equal(inicial.origenPublico, 'https://sentinelia.example');
  assert.equal(inicial.totalProxiesConfiables, 1);
  assert.equal(inicial.advertencias.length, 0);
  assert.equal(Object.isFrozen(inicial), true);

  servicioConfiguracionPortal.cambiar({
    activacionFederacion: true,
    origenPublico: 'https://nueva.example:9443',
    proxiesConfiables: ['0.0.0.0/0']
  });
  const actualizado = await presentador.construir();
  assert.equal(actualizado.versionConfiguracion, 2);
  assert.equal(actualizado.origenPublico, 'https://nueva.example:9443');
  assert.equal(actualizado.estado, 'advertencia');
  assert.deepEqual(
    actualizado.advertencias.map(({ codigo }) => codigo),
    ['proxy_excesivamente_amplio']
  );
  assert.equal(
    resolutorRedPublicaFederacion.esProxyConfiable('198.51.100.20'),
    true,
    'La advertencia sobre /0 no puede convertir la política elegida en inoperante.'
  );
  assert.deepEqual(
    resolutorRedPublicaFederacion
      .validarProxiesConfiables(['::/0']).advertencias.length,
    1
  );
  assert.throws(
    () => presentador.validarCambio({
      clave: 'federacion.proxies_confiables',
      valor: 'proxy-no-resoluble'
    }),
    /dirección o rango no aplicable/
  );
  assert.equal(
    resolutorRedPublicaFederacion.construirResumen().versionConfiguracion,
    2,
    'Validar una candidata no debe mutar la fotografía aplicada.'
  );
}

async function verificarComposicionPortal() {
  const [
    controlador, vista, javascript, repositorio, presentador
  ] =
    await Promise.all([
      leer('../apps/sentinelia-web/src/controladores/ControladorPortal.js'),
      leer('../apps/sentinelia-web/src/views/portal/configuracion.ejs'),
      leer('../apps/sentinelia-web/src/public/js/configuracion.js'),
      leer('../paquetes/configuracion/src/RepositorioConfiguracion.js'),
      leer('../apps/sentinelia-web/src/servicios/ServicioPresentacionRedPublicaFederacion.js')
    ]);
  assert.match(vista, /id="configuracion-red-federada"/u);
  assert.match(presentador, /PORTAL_ORIGEN_PUBLICO/u);
  assert.match(presentador, /PORTAL_PROXIES_REVERSOS_CONFIABLES/u);
  assert.match(javascript, /aplicarEstadoRedPublica/u);
  assert.doesNotMatch(
    javascript,
    /function aplicarEstadoRedPublica[\s\S]{0,2500}innerHTML/u,
    'La actualización viva de la frontera no debe interpretar HTML configurado.'
  );
  assert.ok(
    controlador.indexOf('validarCambio({') <
      controlador.indexOf('servicioConfiguracionPortal.actualizarValor({'),
    'Una política de proxy inaplicable debe rechazarse antes de persistirla.'
  );
  assert.match(
    repositorio,
    /UPDATE configuracion_portal[\s\S]*SET valor = \?[\s\S]*WHERE clave = \?/u
  );
}

function crearServicioConfiguracion() {
  let version = 1;
  let configuracion = congelarConfiguracion({
    activacionFederacion: false,
    origenPublico: 'https://sentinelia.example',
    proxiesConfiables: ['127.0.0.1/32']
  });
  return {
    async asegurarActualizada() {
      return {
        obtenerConfiguracionFederacion() {
          return configuracion;
        }
      };
    },
    async listarConfiguraciones() {
      return [
        { clave: 'federacion.origen_publico', valorBruto: configuracion.origenPublico },
        {
          clave: 'federacion.proxies_confiables',
          valorBruto: configuracion.proxiesConfiables.join('\n')
        }
      ];
    },
    obtenerDefinicion(clave) {
      return {
        clave,
        valorPorDefecto: clave === 'federacion.proxies_confiables'
          ? '127.0.0.1/32'
          : 'https://sentinelia.example'
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

function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}
