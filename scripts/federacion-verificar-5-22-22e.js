import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ejs from 'ejs';

import {
  crearDeclaracionCapacidadReceptoraFederacion
} from '../paquetes/federacion/src/ConfiguracionFederacion.js';
import {
  FAMILIAS_FEDERACION,
  VERSION_PROTOCOLO_FEDERACION,
  VERSIONES_FAMILIA_FEDERACION
} from '../paquetes/federacion/src/CatalogosFederacion.js';
import {
  ServicioDiagnosticoFederacionPortal
} from '../paquetes/federacion/aplicacion/ServicioDiagnosticoFederacionPortal.js';
import {
  ServicioPresentacionRedPublicaFederacion
} from '../apps/sentinelia-web/src/servicios/ServicioPresentacionRedPublicaFederacion.js';

await main();

async function main() {
  verificarCapacidadReceptoraReal();
  await verificarPresentacionDirigida();
  await verificarDiagnosticoDirigido();
  await verificarComposicionYRegistro();
  console.log(
    '[federacion] OK 5.22.22e: presentacion=3_capacidades ' +
    'diagnostico=configuracion_viva capacidad_receptora=preparacion_real ' +
    'emisor_lan=no_incompleto'
  );
}

function verificarCapacidadReceptoraReal() {
  const base = {
    familiasSoportadas: FAMILIAS_FEDERACION.valores,
    versionesFamilia: VERSIONES_FAMILIA_FEDERACION,
    protocoloVersion: VERSION_PROTOCOLO_FEDERACION
  };
  assert.equal(crearDeclaracionCapacidadReceptoraFederacion({
    ...base,
    configuracion: configuracionEmisora()
  }).disponible, false);
  assert.equal(crearDeclaracionCapacidadReceptoraFederacion({
    ...base,
    configuracion: configuracionReceptora()
  }).disponible, true);
  assert.equal(crearDeclaracionCapacidadReceptoraFederacion({
    ...base,
    configuracion: configuracionReceptora(),
    disponible: false
  }).disponible, false);
}

async function verificarPresentacionDirigida() {
  const estado = crearConfiguracionViva(configuracionEmisora());
  const servicio = new ServicioPresentacionRedPublicaFederacion({
    servicioConfiguracionPortal: estado.servicio,
    resolutorRedPublicaFederacion: estado.resolutor
  });
  const emisora = await servicio.construir();
  assert.equal(emisora.estado, 'solo-emision');
  assert.equal(emisora.etiquetaEstado, 'Emisión disponible · recepción no preparada');
  assert.equal(emisora.capacidades.activacion.etiqueta, 'Activa');
  assert.equal(emisora.capacidades.emision.etiqueta, 'Disponible');
  assert.equal(emisora.capacidades.recepcion.etiqueta, 'No preparada');
  assert.deepEqual(
    emisora.advertencias.map(({ codigo }) => codigo),
    ['origen_publico_ausente', 'proxies_confiables_ausentes']
  );
  assert.match(emisora.advertencias[0].mensaje, /recepción federada/u);

  estado.cambiar(configuracionReceptora());
  const receptora = await servicio.construir();
  assert.equal(receptora.estado, 'activa');
  assert.equal(receptora.etiquetaEstado, 'Emisión y recepción disponibles');
  assert.equal(receptora.recepcionPreparada, true);
}

async function verificarDiagnosticoDirigido() {
  const estado = crearConfiguracionViva(configuracionEmisora());
  const servicio = new ServicioDiagnosticoFederacionPortal({
    repositorio: {
      async obtener() { return { relaciones: [], detalle: null }; }
    },
    servicioAutorizacion: {
      puedeVerDiagnosticoFederacion() { return true; }
    },
    servicioConfiguracionPortal: estado.servicio
  });
  const diagnostico = await servicio.obtener({ nivelScope: 'portal' });
  assert.equal(diagnostico.capacidadesConfiguracion.activacionGlobal, true);
  assert.equal(diagnostico.capacidadesConfiguracion.emisionDisponible, true);
  assert.equal(diagnostico.capacidadesConfiguracion.recepcionPreparada, false);
  assert.deepEqual(diagnostico.capacidadesConfiguracion.bloqueos.emision, []);
  assert.deepEqual(diagnostico.capacidadesConfiguracion.bloqueos.recepcion, [
    'origenPublicoAusente', 'proxiesConfiablesAusentes'
  ]);
}

async function verificarComposicionYRegistro() {
  const [configuracion, presentacion, diagnostico, index, vistaConfiguracion,
    vistaDiagnostico, javascript, estilos] = await Promise.all([
    leer('../paquetes/federacion/src/ConfiguracionFederacion.js'),
    leer('../apps/sentinelia-web/src/servicios/ServicioPresentacionRedPublicaFederacion.js'),
    leer('../paquetes/federacion/aplicacion/ServicioDiagnosticoFederacionPortal.js'),
    leer('../apps/sentinelia-web/src/index.js'),
    leer('../apps/sentinelia-web/src/views/portal/configuracion.ejs'),
    leer('../apps/sentinelia-web/src/views/portal/federacion-diagnostico.ejs'),
    leer('../apps/sentinelia-web/src/public/js/configuracion.js'),
    leer('../apps/sentinelia-web/src/public/css/portal.css')
  ]);
  assert.match(configuracion, /disponible: capacidades\.recepcionPreparada/u);
  assert.match(presentacion, /proyectarCapacidadesConfiguracionFederacion/u);
  assert.match(diagnostico, /capacidadesConfiguracion/u);
  assert.match(index, /ServicioDiagnosticoFederacionPortal[\s\S]{0,500}servicioConfiguracionPortal/u);
  for (const texto of ['Activación global', 'Emisión saliente', 'Recepción pública']) {
    assert.match(vistaConfiguracion, new RegExp(texto, 'u'));
    assert.match(vistaDiagnostico, new RegExp(texto, 'u'));
  }
  assert.match(vistaDiagnostico, /Bloqueos de emisión/u);
  assert.match(vistaDiagnostico, /Bloqueos de recepción/u);
  assert.match(javascript, /data-red-publica-capacidad-emision/u);
  assert.match(estilos, /data-estado="solo-emision"/u);
  ejs.compile(vistaConfiguracion, {
    filename: new URL('../apps/sentinelia-web/src/views/portal/configuracion.ejs', import.meta.url).pathname
  });
  ejs.compile(vistaDiagnostico, {
    filename: new URL('../apps/sentinelia-web/src/views/portal/federacion-diagnostico.ejs', import.meta.url).pathname
  });
}

function crearConfiguracionViva(inicial) {
  let configuracion = inicial;
  let version = 1;
  const portal = {
    obtenerConfiguracionFederacion() { return configuracion; }
  };
  return {
    servicio: {
      async asegurarActualizada() { return portal; },
      async listarConfiguraciones() { return []; },
      obtenerVersionActual() { return version; }
    },
    resolutor: {
      async asegurarActualizado() {},
      construirResumen() {
        return {
          origenPublico: configuracion.origenPublico,
          proxiesConfiables: [...configuracion.proxiesConfiables],
          totalProxiesConfiables: configuracion.proxiesConfiables.length,
          advertencias: [],
          versionConfiguracion: version
        };
      },
      validarProxiesConfiables() { return { advertencias: [] }; }
    },
    cambiar(siguiente) { configuracion = siguiente; version += 1; }
  };
}

function configuracionEmisora() {
  return { activacionFederacion: true, origenPublico: null, proxiesConfiables: [] };
}

function configuracionReceptora() {
  return {
    activacionFederacion: true,
    origenPublico: 'https://receptor.example.test',
    proxiesConfiables: ['127.0.0.1/32']
  };
}

async function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}
