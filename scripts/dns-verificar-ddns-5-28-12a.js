import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import {
  CAPACIDADES_RUNTIME_DDNS_AGENTES,
  CAPACIDADES_WEB_DDNS_AGENTES,
  MIGRACIONES_DDNS_AGENTES,
  PERFIL_DESPLIEGUE_DDNS_AGENTES,
  crearDeclaracionCompatibilidadRuntimeDdnsAgentes,
  evaluarPreparacionLocalDdnsAgentes,
  evaluarUnanimidadDdnsAgentes,
  resolverUnanimidadDdnsAgentes
} from '../paquetes/dns/src/CompatibilidadDespliegueDdnsAgentes.js';

const raiz = fileURLToPath(new URL('../', import.meta.url));

await main();

async function main() {
  verificarDeclaraciones();
  await verificarPresenciasRedis();
  await verificarEnsamblado();
  console.log(
    '[dns-ddns] OK 5.28.12a: perfil=ddns_agentes@1 ' +
    'web=4 runtime=4 empaquetado=mismo_artefacto redis=ttl_autoritativo ' +
    'ausente+caducada+ajena+mixta=cerrado'
  );
}

function verificarDeclaraciones() {
  const preparacionLocal = preparar();
  const declaracion = crearDeclaracionCompatibilidadRuntimeDdnsAgentes({
    instanciaId: 'runtime-a'
  });
  assert.equal(declaracion.perfil, PERFIL_DESPLIEGUE_DDNS_AGENTES);
  assert.deepEqual(declaracion.capacidades, CAPACIDADES_RUNTIME_DDNS_AGENTES);
  assert.deepEqual(
    declaracion.capacidadesWebEmpaquetadas,
    CAPACIDADES_WEB_DDNS_AGENTES
  );
  assert.equal(evaluarUnanimidadDdnsAgentes({
    preparacionLocal,
    instanciasRuntime: [presencia('runtime-a')]
  }).unanimidad, true);

  assertCodigo(() => evaluarPreparacionLocalDdnsAgentes({
    migracionesAplicadas: MIGRACIONES_DDNS_AGENTES.slice(1),
    postcondicionesMigracionesVerificadas: true,
    capacidadesWeb: CAPACIDADES_WEB_DDNS_AGENTES
  }), 'migraciones_ddns_ausentes');
  assertCodigo(() => evaluarPreparacionLocalDdnsAgentes({
    migracionesAplicadas: MIGRACIONES_DDNS_AGENTES,
    postcondicionesMigracionesVerificadas: true,
    capacidadesWeb: CAPACIDADES_WEB_DDNS_AGENTES.slice(1)
  }), 'web_capacidad_ddns_ausente');
  assertCodigo(() => evaluarUnanimidadDdnsAgentes({
    preparacionLocal,
    instanciasRuntime: [presencia('runtime-ajeno', { perfil: 'ddns_agentes@0' })]
  }), 'despliegue_mixto_ddns_rechazado');
  assertCodigo(() => evaluarUnanimidadDdnsAgentes({
    preparacionLocal,
    instanciasRuntime: [presencia('runtime-incompleto', {
      capacidades: CAPACIDADES_RUNTIME_DDNS_AGENTES.slice(1)
    })]
  }), 'runtime_capacidad_ddns_incompleta');
  assertCodigo(() => evaluarUnanimidadDdnsAgentes({
    preparacionLocal,
    instanciasRuntime: [presencia('web-mixta', {
      capacidadesWebEmpaquetadas: CAPACIDADES_WEB_DDNS_AGENTES.slice(1)
    })]
  }), 'web_despliegue_mixto_ddns_rechazado');
}

async function verificarPresenciasRedis() {
  const preparacionLocal = preparar();
  const claveViva = 'sentinelia:runtime:instancias:runtime-vivo:presencia';
  const almacen = new Map([
    [claveViva, JSON.stringify(presencia('runtime-vivo'))],
    ['sentinelia:runtime:instancias:runtime-otro:presencia',
      JSON.stringify(presencia('runtime-otro', {}, 'otro-entorno'))]
  ]);
  const redis = {
    async *scanIterator() { yield [...almacen.keys()]; },
    async get(clave) { return almacen.get(clave) ?? null; }
  };
  const unanimidad = await resolverUnanimidadDdnsAgentes({
    preparacionLocal,
    clienteRedis: redis,
    prefijoRuntime: 'sentinelia:runtime:',
    entorno: 'test'
  });
  assert.equal(unanimidad.instanciasRuntimeCompatibles, 1);

  almacen.delete(claveViva);
  await assert.rejects(
    resolverUnanimidadDdnsAgentes({
      preparacionLocal,
      clienteRedis: redis,
      prefijoRuntime: 'sentinelia:runtime:',
      entorno: 'test'
    }),
    (error) => error.codigo === 'runtime_ddns_compatible_ausente'
  );
}

async function verificarEnsamblado() {
  const [runtime, presenciaRuntime, web] = await Promise.all([
    leer('apps/sentinelia-runtime/src/RuntimeSentinelia.js'),
    leer('apps/sentinelia-runtime/src/redis/PresenciaRuntimeRedis.js'),
    leer('apps/sentinelia-web/src/index.js')
  ]);
  assert.match(runtime, /publicarCapacidadDespliegue\([\s\S]{0,80}'ddnsAgentes'/u);
  assert.match(runtime, /crearDeclaracionCompatibilidadRuntimeDdnsAgentes/u);
  assert.match(presenciaRuntime, /EX: ttl/u);
  assert.match(presenciaRuntime, /capacidadesDespliegue: this\.capacidadesDespliegue/u);
  assert.match(web, /evaluarPreparacionLocalDdnsAgentes/u);
  assert.match(web, /despliegueDdnsAgentes/u);
}

function preparar() {
  return evaluarPreparacionLocalDdnsAgentes({
    migracionesAplicadas: MIGRACIONES_DDNS_AGENTES,
    postcondicionesMigracionesVerificadas: true,
    capacidadesWeb: CAPACIDADES_WEB_DDNS_AGENTES
  });
}

function presencia(instanciaId, cambios = {}, entorno = 'test') {
  const declaracion = {
    ...crearDeclaracionCompatibilidadRuntimeDdnsAgentes({ instanciaId }),
    ...cambios
  };
  return {
    instanciaId,
    entorno,
    capacidadesDespliegue: { ddnsAgentes: declaracion }
  };
}

function assertCodigo(fn, codigo) {
  assert.throws(fn, (error) => error.codigo === codigo);
}

async function leer(ruta) {
  return readFile(new URL(ruta, `file://${raiz}`), 'utf8');
}
