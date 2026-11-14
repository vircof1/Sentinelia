import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import express from 'express';

import {
  CAPACIDADES_RUNTIME_DDNS_AGENTES,
  CAPACIDADES_WEB_DDNS_AGENTES,
  MIGRACIONES_DDNS_AGENTES,
  crearDeclaracionCompatibilidadRuntimeDdnsAgentes,
  evaluarActivacionDdnsAgentes,
  evaluarPreparacionLocalDdnsAgentes,
  resolverActivacionDdnsAgentes
} from '../paquetes/dns/src/CompatibilidadDespliegueDdnsAgentes.js';
import {
  crearDeclaracionCompatibilidadRuntimePublicadorBindDns
} from '../paquetes/dns/src/CompatibilidadDesplieguePublicadorBindDns.js';
import {
  CAPACIDADES_AGENTES
} from '../paquetes/agentes/src/ConfiguracionEfectivaAgente.js';
import { ServicioAutenticacionAgentes }
  from '../paquetes/agentes/src/ServicioAutenticacionAgentes.js';
import { crearRutasApiAgentes }
  from '../apps/sentinelia-web/src/rutas/crearRutasApiAgentes.js';
import { obtenerConfiguracionAplicacion }
  from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

const raiz = fileURLToPath(new URL('../', import.meta.url));

await main();

async function main() {
  verificarNegacionesYRollback();
  await verificarResolucionYReinicio();
  await verificarConfiguracionEfectiva();
  await verificarHttpCerrado();
  await verificarEnsamblado();
  console.log(
    '[dns-ddns] OK 5.28.12b: default=cerrado precondiciones=exhaustivas ' +
    'unanimidad=bind+ddns reconciliacion=satisfecha HTTP+UI+POL=cerrados ' +
    'dynamic_dns=gate reinicio=idempotente rollback=cerrado'
  );
}

function verificarNegacionesYRollback() {
  const preparacionLocal = preparar();
  const viva = presencia('runtime-a');
  const base = {
    solicitada: true,
    preparacionLocal,
    instanciasRuntime: [viva],
    reconciliacionInicial: { estado: 'satisfecha' }
  };
  assert.equal(evaluarActivacionDdnsAgentes({ ...base, solicitada: false }).codigo,
    'desactivada_por_configuracion');
  assertCodigo(() => evaluarActivacionDdnsAgentes({
    ...base, preparacionLocal: null
  }), 'preparacion_web_ddns_incompleta');
  assertCodigo(() => evaluarActivacionDdnsAgentes({
    ...base, instanciasRuntime: []
  }), 'runtime_ddns_compatible_ausente');
  assertCodigo(() => evaluarActivacionDdnsAgentes({
    ...base,
    instanciasRuntime: [presencia('runtime-a', {
      ddns: { capacidades: CAPACIDADES_RUNTIME_DDNS_AGENTES.slice(1) }
    })]
  }), 'runtime_capacidad_ddns_incompleta');
  assertCodigo(() => evaluarActivacionDdnsAgentes({
    ...base,
    instanciasRuntime: [presencia('runtime-a', { bindActivo: false })]
  }), 'despliegue_mixto_bind_rechazado');
  assertCodigo(() => evaluarActivacionDdnsAgentes({
    ...base, reconciliacionInicial: { estado: 'activa' }
  }), 'reconciliacion_inicial_dns_no_satisfecha');

  const abierta = evaluarActivacionDdnsAgentes(base);
  assert.equal(abierta.habilitada, true);
  assert.equal(abierta.instanciasRuntimeCompatibles, 1);
  const rollback = evaluarActivacionDdnsAgentes({ ...base, solicitada: false });
  assert.equal(rollback.habilitada, false);
}

async function verificarResolucionYReinicio() {
  const clave = 'sentinelia:runtime:instancias:runtime-a:presencia';
  const almacen = new Map([[clave, JSON.stringify(presencia('runtime-a'))]]);
  const redis = {
    async *scanIterator() { yield [...almacen.keys()]; },
    async get(actual) { return almacen.get(actual) ?? null; }
  };
  const repositorioCoordinacion = {
    async obtenerReconciliacion() { return { estado: 'satisfecha' }; }
  };
  const argumentos = {
    solicitada: true,
    preparacionLocal: preparar(),
    clienteRedis: redis,
    prefijoRuntime: 'sentinelia:runtime:',
    entorno: 'test',
    repositorioCoordinacion
  };
  const primera = await resolverActivacionDdnsAgentes(argumentos);
  const reinicio = await resolverActivacionDdnsAgentes(argumentos);
  assert.deepEqual(reinicio, primera);

  let lecturas = 0;
  const convergente = await resolverActivacionDdnsAgentes({
    ...argumentos,
    repositorioCoordinacion: {
      async obtenerReconciliacion() {
        lecturas += 1;
        return { estado: lecturas < 2 ? 'activa' : 'satisfecha' };
      }
    },
    esperaMaximaMs: 100,
    intervaloMs: 10
  });
  assert.equal(convergente.habilitada, true);
  assert.equal(lecturas, 2);
}

async function verificarConfiguracionEfectiva() {
  for (const habilitada of [false, true]) {
    const servicio = new ServicioAutenticacionAgentes({
      repositorioAgentes: {},
      repositorioSesionesAgentesRedis: {},
      ddnsAgentesHabilitado: habilitada
    });
    servicio.inspeccionarSesionViva = async () => ({
      agente: { id: 1 },
      sesion: { sessionId: 's-1' },
      ttlRestanteSegundos: 120
    });
    servicio.obtenerRevisionesActualesAgente = async () => ({
      revisionConfiguracionActual: null,
      revisionPoliticaActual: null
    });
    const resultado = await servicio.obtenerConfiguracionEfectiva({
      sessionToken: 'token'
    });
    const capacidad = resultado.obtenerRespuestaPublica().configuracion.capacidades
      .find(({ codigo }) => codigo === CAPACIDADES_AGENTES.DYNAMIC_DNS);
    assert.equal(capacidad.habilitada, habilitada);
  }
}

async function verificarHttpCerrado() {
  const controlador = new Proxy({}, {
    get: () => (_req, res) => res.status(204).end()
  });
  const app = express();
  app.use(crearRutasApiAgentes({
    controladorApiAgentes: controlador,
    ddnsAgentesHabilitado: false
  }));
  const servidor = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => servidor.once('listening', resolve));
  try {
    const puerto = servidor.address().port;
    assert.equal((await fetch(`http://127.0.0.1:${puerto}/api/agentes/v1/ddns`)).status,
      404);
    assert.equal((await fetch(`http://127.0.0.1:${puerto}/api/agentes/v1/me`)).status,
      204);
  } finally {
    await new Promise((resolve, reject) => servidor.close((error) =>
      error ? reject(error) : resolve()));
  }
}

async function verificarEnsamblado() {
  // Cargar primero el entorno para que .env no reponga la clave al probar su ausencia.
  obtenerConfiguracionAplicacion();
  const anterior = process.env.AGENTES_DDNS_HABILITADO;
  try {
    delete process.env.AGENTES_DDNS_HABILITADO;
    assert.equal(obtenerConfiguracionAplicacion().agentes.ddnsHabilitado, false);
    process.env.AGENTES_DDNS_HABILITADO = 'false';
    assert.equal(obtenerConfiguracionAplicacion().agentes.ddnsHabilitado, false);
    process.env.AGENTES_DDNS_HABILITADO = 'true';
    assert.equal(obtenerConfiguracionAplicacion().agentes.ddnsHabilitado, true);
  } finally {
    if (anterior === undefined) delete process.env.AGENTES_DDNS_HABILITADO;
    else process.env.AGENTES_DDNS_HABILITADO = anterior;
  }

  const [web, runtime, aplicacion, vistaAgente, vistaRegistro,
    composeProductivo, composeDesarrollo] =
    await Promise.all([
      leer('apps/sentinelia-web/src/index.js'),
      leer('apps/sentinelia-runtime/src/RuntimeSentinelia.js'),
      leer('apps/sentinelia-web/src/crearAplicacion.js'),
      leer('apps/sentinelia-web/src/views/portal/agente-formulario.ejs'),
      leer('apps/sentinelia-web/src/views/portal/dns-registro-formulario.ejs'),
      leer('despliegue/docker/node-bind/docker-compose.productivo.yml'),
      leer('despliegue/docker/node-bind/docker-compose.desarrollo.yml')
    ]);
  assert.match(web, /registradorCausaPolDdns: ddnsAgentesHabilitado/u);
  assert.match(runtime, /activacionDdnsAgentes\.habilitada === true/u);
  assert.match(aplicacion, /ddnsAgentesHabilitado/u);
  assert.match(vistaAgente, /capacidadesPortal\?\.ddnsAgentes/u);
  assert.match(vistaRegistro, /capacidadesPortal\?\.ddnsAgentes/u);
  assert.match(composeProductivo, /AGENTES_DDNS_HABILITADO:-true/u);
  assert.match(composeDesarrollo, /AGENTES_DDNS_HABILITADO:-false/u);
}

function preparar() {
  return evaluarPreparacionLocalDdnsAgentes({
    migracionesAplicadas: MIGRACIONES_DDNS_AGENTES,
    postcondicionesMigracionesVerificadas: true,
    capacidadesWeb: CAPACIDADES_WEB_DDNS_AGENTES
  });
}

function presencia(instanciaId, { ddns = {}, bindActivo = true } = {}) {
  return {
    instanciaId,
    entorno: 'test',
    capacidadesDespliegue: {
      ddnsAgentes: {
        ...crearDeclaracionCompatibilidadRuntimeDdnsAgentes({ instanciaId }),
        ...ddns
      },
      publicadorBindDns:
        crearDeclaracionCompatibilidadRuntimePublicadorBindDns({
          instanciaId,
          coordinadoActivo: bindActivo
        })
    }
  };
}

function assertCodigo(fn, codigo) {
  assert.throws(fn, (error) => error.codigo === codigo);
}

async function leer(ruta) {
  return readFile(new URL(ruta, `file://${raiz}`), 'utf8');
}
