import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  ErrorEmisionFederacionNoDisponible,
  GuardiaEmisionFederacion
} from '../paquetes/federacion/aplicacion/GuardiaEmisionFederacion.js';
import {
  ServicioImportacionFederacionPortal
} from '../paquetes/federacion/aplicacion/ServicioImportacionFederacionPortal.js';
import {
  ServicioSincronizacionConcesionFederacionPortal
} from '../paquetes/federacion/aplicacion/ServicioSincronizacionConcesionFederacionPortal.js';
import {
  normalizarEndpointFederacion
} from '../paquetes/federacion/src/RelacionFederacion.js';

await main();

async function main() {
  await verificarGuardiaEmisoraViva();
  await verificarServiciosSalientes();
  verificarDestinoHttps();
  await verificarComposicionProductiva();
  console.log(
    '[federacion] OK 5.22.22d: guardia=emisora_viva ' +
    'entrada_local=no_requerida keyring=obligatorio destino_remoto=https_aprobado ' +
    'runtime=capacidad_emisora'
  );
}

async function verificarGuardiaEmisoraViva() {
  const estado = crearConfiguracionViva({ activacionFederacion: false });
  const guardia = new GuardiaEmisionFederacion({
    servicioConfiguracionPortal: estado.servicio
  });
  await assert.rejects(
    guardia.exigirDisponible('prueba_emision'),
    (error) => error instanceof ErrorEmisionFederacionNoDisponible &&
      error.codigo === 'EMISION_FEDERACION_NO_DISPONIBLE' &&
      error.statusCode === 503 &&
      error.operacion === 'prueba_emision' &&
      error.bloqueos.join(',') === 'federacionDesactivada'
  );
  estado.cambiar({
    activacionFederacion: true,
    origenPublico: null,
    proxiesConfiables: []
  });
  const evaluacion = await guardia.exigirDisponible('prueba_solo_salida');
  assert.equal(evaluacion.capacidades.emisionDisponible, true);
  assert.equal(evaluacion.capacidades.recepcionPreparada, false);
  assert.equal(await guardia.estaDisponible(), true);
  assert.equal(estado.actualizaciones, 3);
}

async function verificarServiciosSalientes() {
  const guardia = crearGuardiaContada();
  let preparaciones = 0;
  const importacion = new ServicioImportacionFederacionPortal({
    repositorioImportaciones: {
      async prepararEmision() { preparaciones += 1; },
      async consolidarInvitacion() {},
      async validarRecuperacion() {},
      async aplicarRecuperacion() {}
    },
    clienteHttp: {
      async canjearInvitacion() {},
      async canjearRecuperacion() {}
    },
    installationLocalId: `sfid1.instalacion.${'A'.repeat(22)}`,
    bootLocalId: `sfid1.arranque.${'B'.repeat(21)}A`,
    resolverNombreLocal: () => 'Emisora LAN',
    productoVersion: '1.0.0',
    guardiaEmision: guardia
  });
  await assert.rejects(importacion.importarInvitacion({ representacion: {} }));
  assert.deepEqual(guardia.operaciones, ['importar_invitacion']);
  assert.equal(preparaciones, 0);

  const sincronizacion = new ServicioSincronizacionConcesionFederacionPortal({
    repositorioIntercambios: {
      async prepararSalida() { preparaciones += 1; return null; },
      async confirmarSalida() {},
      async recibir() {}
    },
    repositorioDestinos: { async obtenerAprobadoOperativo() {} },
    custodiaSecretoEmision: { async obtenerParaLoginTecnico() {} },
    clienteHttp: {
      async iniciarSesion() {},
      async publicarDeclaracionConcesion() {},
      async publicarManifiestoFlujoInicial() {}
    },
    servicioConsolidacion: { async consolidarRelacion() {} },
    servicioReconciliacion: {
      async listarManifiestosPreparados() {},
      async confirmarManifiestoPublicado() {}
    },
    guardiaEmision: guardia,
    installationLocalId: `sfid1.instalacion.${'A'.repeat(22)}`,
    bootLocalId: `sfid1.arranque.${'B'.repeat(21)}A`
  });
  await assert.rejects(
    sincronizacion.sincronizar({ relacionId: `sfid1.relacion.${'C'.repeat(22)}` }),
    (error) => error.codigo === 'OFERTA_LOCAL_NO_DISPONIBLE'
  );
  assert.deepEqual(guardia.operaciones, [
    'importar_invitacion', 'sincronizar_concesion_desde_portal'
  ]);
  assert.equal(preparaciones, 1);
}

function verificarDestinoHttps() {
  assert.equal(
    normalizarEndpointFederacion('https://receptor.example.test'),
    'https://receptor.example.test'
  );
  assert.throws(
    () => normalizarEndpointFederacion('http://receptor.example.test'),
    /debe usar HTTPS/u
  );
}

async function verificarComposicionProductiva() {
  const [plano, web, runtime, destinos, importacion, sincronizacion] = await Promise.all([
    leer('../paquetes/federacion/aplicacion/crearPlanoControlFederacionLocal.js'),
    leer('../apps/sentinelia-web/src/index.js'),
    leer('../apps/sentinelia-runtime/src/BootstrapRuntime.js'),
    leer('../paquetes/federacion/adaptadores/RepositorioDestinosEmisionFederacionSql.js'),
    leer('../paquetes/federacion/aplicacion/ServicioImportacionFederacionPortal.js'),
    leer('../paquetes/federacion/aplicacion/ServicioSincronizacionConcesionFederacionPortal.js')
  ]);
  assert.match(plano, /new GuardiaEmisionFederacion/u);
  assert.match(web, /ServicioImportacionFederacionPortal[\s\S]{0,1800}guardiaEmision:/u);
  assert.match(web, /ServicioSincronizacionConcesionFederacionPortal[\s\S]{0,1200}guardiaEmision:/u);
  assert.match(web, /protectorSecretoPersistente[\s\S]{0,120}ServicioImportacion/u);
  assert.match(runtime, /resolverActivacion:[\s\S]{0,180}guardiaEmision\.estaDisponible/u);
  assert.match(destinos, /direccion='emision'/u);
  assert.match(destinos, /obtenerAprobadoOperativo/u);
  assert.match(destinos, /normalizarEndpointFederacion/u);
  assert.doesNotMatch(importacion, /GuardiaRecepcionFederacion/u);
  assert.doesNotMatch(sincronizacion, /GuardiaRecepcionFederacion/u);
}

function crearGuardiaContada() {
  return {
    operaciones: [],
    async exigirDisponible(operacion) { this.operaciones.push(operacion); }
  };
}

function crearConfiguracionViva(inicial) {
  let configuracion = inicial;
  let actualizaciones = 0;
  const portal = Object.freeze({
    obtenerConfiguracionFederacion() { return configuracion; }
  });
  return {
    servicio: {
      async asegurarActualizada() { actualizaciones += 1; return portal; }
    },
    cambiar(siguiente) { configuracion = siguiente; },
    get actualizaciones() { return actualizaciones; }
  };
}

async function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}
