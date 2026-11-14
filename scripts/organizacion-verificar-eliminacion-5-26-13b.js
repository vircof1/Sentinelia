import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  CAPACIDADES_RUNTIME_ELIMINACION_ADMINISTRATIVA_ORGANIZACIONES,
  CAPACIDADES_WEB_ELIMINACION_ADMINISTRATIVA_ORGANIZACIONES,
  ErrorCompatibilidadEliminacionAdministrativaOrganizaciones,
  MIGRACIONES_ELIMINACION_ADMINISTRATIVA_ORGANIZACIONES,
  crearDeclaracionCapacidadesRuntimeEliminacionOrganizaciones,
  evaluarActivacionEliminacionAdministrativaOrganizaciones,
  resolverActivacionEliminacionAdministrativaOrganizaciones
} from '../paquetes/jerarquia-organizativa/src/CapacidadesRuntimeEliminacionAdministrativaOrganizaciones.js';
import { obtenerConfiguracionAplicacion }
  from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

await main();

async function main() {
  verificarDominioCompatibilidad();
  await verificarResolucionRedis();
  await verificarEnsambladoProductivo();
  verificarConfiguracion();
  console.log(
    '[organizacion] OK 5.26.13b: contrato=actual_sin_selectores ' +
    'migraciones=esquema_inicial unanimidad=web_runtime despliegue_mixto=rechazado ' +
    'activacion=obligatoria sincronico=retirado ' +
    'operaciones_durables=independientes'
  );
}

function verificarDominioCompatibilidad() {
  assert.deepEqual(MIGRACIONES_ELIMINACION_ADMINISTRATIVA_ORGANIZACIONES,
    ['0001_esquema_inicial.sql']);
  const runtime = presenciaRuntime('runtime-compatible');
  const base = {
    migracionesAplicadas: MIGRACIONES_ELIMINACION_ADMINISTRATIVA_ORGANIZACIONES,
    postcondicionesMigracionesVerificadas: true,
    capacidadesWeb: CAPACIDADES_WEB_ELIMINACION_ADMINISTRATIVA_ORGANIZACIONES,
    instanciasRuntime: [runtime]
  };
  const activa = evaluarActivacionEliminacionAdministrativaOrganizaciones(base);
  assert.equal(activa.habilitada, true);
  assert.equal(activa.codigo, 'capacidades_verificadas');
  assert.equal(Object.hasOwn(activa, 'solicitada'), false);
  assert.equal(Object.hasOwn(activa, 'perfil'), false);
  assert.equal(activa.instanciasRuntimeCompatibles, 1);
  assert.equal(activa.instanciasWebCompatibles, 1);
  assertCodigo({
    ...base,
    migracionesAplicadas: MIGRACIONES_ELIMINACION_ADMINISTRATIVA_ORGANIZACIONES.slice(1)
  }, 'migraciones_requeridas_ausentes');
  assertCodigo({ ...base, postcondicionesMigracionesVerificadas: false },
    'postcondiciones_migraciones_no_verificadas');
  assertCodigo({ ...base, capacidadesWeb: [] }, 'web_capacidad_ausente');
  assertCodigo({ ...base, instanciasRuntime: [] }, 'runtime_compatible_ausente');
  assertCodigo({
    ...base,
    instanciasRuntime: [{
      instanciaId: 'runtime-antiguo',
      capacidadesDespliegue: {}
    }]
  }, 'runtime_capacidad_ausente');
  assertCodigo({
    ...base,
    instanciasRuntime: [presenciaRuntime('runtime-incompleto', {
      capacidades: CAPACIDADES_RUNTIME_ELIMINACION_ADMINISTRATIVA_ORGANIZACIONES.slice(1)
    })]
  }, 'runtime_capacidad_incompleta');
  assertCodigo({
    ...base,
    instanciasRuntime: [presenciaRuntime('web-antigua', {
      capacidadesWebEmpaquetadas:
        CAPACIDADES_WEB_ELIMINACION_ADMINISTRATIVA_ORGANIZACIONES.slice(1)
    })]
  }, 'web_despliegue_mixto_rechazado');
}

async function verificarResolucionRedis() {
  const clave = 'sentinelia:runtime:instancias:runtime-13b:presencia';
  const resultado = await resolverActivacionEliminacionAdministrativaOrganizaciones({
    repositorioMigraciones: {
      async listarNombresAplicados() {
        return new Set(MIGRACIONES_ELIMINACION_ADMINISTRATIVA_ORGANIZACIONES);
      }
    },
    resumenMigraciones: { integridad: { ok: true } },
    clienteRedis: {
      async *scanIterator() { yield clave; },
      async get() { return JSON.stringify(presenciaRuntime('runtime-13b')); }
    },
    prefijoRuntime: 'sentinelia:runtime:',
    entorno: 'test',
    capacidadesWeb: CAPACIDADES_WEB_ELIMINACION_ADMINISTRATIVA_ORGANIZACIONES,
    esperaMaximaMs: 0
  });
  assert.equal(resultado.habilitada, true);
  assert.equal(resultado.instanciasRuntimeCompatibles, 1);
  assert.equal(resultado.instanciasWebCompatibles, 1);
}

async function verificarEnsambladoProductivo() {
  const [desarrollo, productivo, indice, rutas, controladorOrganizacion,
    runtime, supervisor, esquema, aplicacion, tenants, empresas,
    sitios] = await Promise.all([
    leer('../despliegue/docker/node-bind/docker-compose.desarrollo.yml'),
    leer('../despliegue/docker/node-bind/docker-compose.productivo.yml'),
    leer('../apps/sentinelia-web/src/index.js'),
    leer('../apps/sentinelia-web/src/rutas/crearRutasPortal.js'),
    leer('../apps/sentinelia-web/src/controladores/ControladorOrganizacion.js'),
    leer('../apps/sentinelia-runtime/src/RuntimeSentinelia.js'),
    leer('../despliegue/docker/node-bind/supervisor-sentinelia.mjs'),
    leer('../migraciones/sql/0001_esquema_inicial.sql'),
    leer('../apps/sentinelia-web/src/crearAplicacion.js'),
    leer('../apps/sentinelia-web/src/public/js/organizacion-tenants.js'),
    leer('../apps/sentinelia-web/src/public/js/organizacion-empresas.js'),
    leer('../apps/sentinelia-web/src/public/js/organizacion-sitios.js')
  ]);
  const selectoresOrganizacion =
    /ORGANIZACION_ELIMINACION_ADMINISTRATIVA_(?:HTTP_HABILITADA|PERFIL_COMPATIBILIDAD)/u;
  assert.doesNotMatch(desarrollo, selectoresOrganizacion);
  assert.doesNotMatch(productivo, selectoresOrganizacion);
  assert.match(indice, /resolverActivacionEliminacionAdministrativaOrganizaciones/u);
  assert.match(
    indice,
    /eliminacionAdministrativaOrganizacionesHttpHabilitada:[\s\S]{0,100}activacionEliminacionAdministrativaOrganizaciones\.habilitada/u
  );
  assert.match(aplicacion, /resumenArranque\.eliminacionAdministrativaOrganizaciones/u);
  assert.match(runtime,
    /publicarCapacidadDespliegue\([\s\S]{0,100}'eliminacionAdministrativaOrganizaciones'/u);
  assert.match(supervisor, /sentinelia-runtime[\s\S]+sentinelia-web/u);
  for (const tabla of ['operaciones_administrativas',
    'obligaciones_postcommit_operaciones_administrativas']) {
    assert.ok(esquema.includes('CREATE TABLE `' + tabla + '`'),
      `El esquema inicial no incluye ${tabla}.`);
  }
  for (const ruta of [
    '/organizacion/tenants/eliminar',
    '/organizacion/empresas/eliminar',
    '/organizacion/sitios/eliminar',
    '/organizacion/tenants/:id/impacto-eliminacion',
    '/organizacion/empresas/:id/impacto-eliminacion',
    '/organizacion/sitios/:id/impacto-eliminacion'
  ]) assert.equal(rutas.includes(`'${ruta}'`), false, `Persiste la ruta ${ruta}.`);
  assert.doesNotMatch(
    controladorOrganizacion,
    /async (?:eliminar|apiImpactoEliminar)(?:Tenant|Empresa|Sitio)\(/u
  );
  assert.match(rutas, /'\/api\/organizacion\/:tipo\/:id\/eliminacion'/u);
  for (const [fuente, tipo, plural] of [
    [tenants, 'tenant', 'tenants'],
    [empresas, 'empresa', 'empresas'],
    [sitios, 'sitio', 'sitios']
  ]) {
    assert.match(fuente,
      new RegExp(`/api/organizacion/${tipo}/\\$\\{encodeURIComponent\\(item\\.id\\)\\}/eliminacion`, 'u'));
    assert.doesNotMatch(fuente, new RegExp(`/organizacion/${plural}/eliminar`, 'u'));
    assert.doesNotMatch(fuente,
      new RegExp(`${plural}/\\$\\{encodeURIComponent\\(item\\.id\\)\\}/(?:eliminar|impacto-eliminacion)`, 'u'));
    assert.match(fuente, /eliminacionDurable && item\.puedeEliminar/u);
  }
  assert.doesNotMatch(runtime,
    /ORGANIZACION_ELIMINACION_ADMINISTRATIVA_HTTP_HABILITADA/u);
}

function verificarConfiguracion() {
  const configuracion = obtenerConfiguracionAplicacion().organizacion;
  assert.equal(Object.hasOwn(
    configuracion,
    'eliminacionAdministrativaHttpHabilitada'
  ), false);
}

function presenciaRuntime(instanciaId, sobrescritura = {}) {
  return {
    instanciaId,
    entorno: 'test',
    capacidadesDespliegue: {
      eliminacionAdministrativaOrganizaciones: {
        ...crearDeclaracionCapacidadesRuntimeEliminacionOrganizaciones({ instanciaId }),
        ...sobrescritura
      }
    }
  };
}

function assertCodigo(entrada, codigo) {
  assert.throws(
    () => evaluarActivacionEliminacionAdministrativaOrganizaciones(entrada),
    (error) =>
      error instanceof ErrorCompatibilidadEliminacionAdministrativaOrganizaciones &&
      error.codigo === codigo
  );
}

function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}
