import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  ClienteHttpDatosFederacion,
  ErrorClienteHttpFederacion
} from '../paquetes/federacion/adaptadores/ClienteHttpDatosFederacion.js';
import {
  RepositorioDestinosEmisionFederacionSql
} from '../paquetes/federacion/adaptadores/RepositorioDestinosEmisionFederacionSql.js';
import {
  ServicioClienteEmisionFederacion
} from '../paquetes/federacion/aplicacion/ServicioClienteEmisionFederacion.js';
import { FuenteEntropiaCriptograficaNode } from '../paquetes/federacion/adaptadores/FuenteEntropiaCriptograficaNode.js';
import {
  GeneradorIdentidadesFederadas,
  TIPOS_IDENTIDAD_FEDERADA
} from '../paquetes/federacion/src/IdentidadFederada.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import {
  obtenerConfiguracionAplicacion
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

const TOKEN = `sfop1_${'B'.repeat(64)}`;
const generador = new GeneradorIdentidadesFederadas({
  fuenteEntropia: new FuenteEntropiaCriptograficaNode()
});

await main();

async function main() {
  await verificarRegistroYSeparacionProcesos();
  await verificarOperacionesYDestinoAprobado();
  await verificarTimeoutCotasYErrores();
  await verificarConsultaSqlReal();
  console.log(
    '[federacion] OK 5.22.13d: cliente=runtime destino=sql_aprobado ' +
    'operaciones=capacidad_lote_progreso_disponibilidad timeout=integral redirects=bloqueados ' +
    'bearer=solo_header errores=saneados web=sin_red'
  );
}

async function verificarRegistroYSeparacionProcesos() {
  const [bootstrap, runtime, webIndex, aplicacionWeb] =
    await Promise.all([
      leer('../apps/sentinelia-runtime/src/BootstrapRuntime.js'),
      leer('../apps/sentinelia-runtime/src/RuntimeSentinelia.js'),
      leer('../apps/sentinelia-web/src/index.js'),
      leer('../apps/sentinelia-web/src/crearAplicacion.js')
    ]);
  assert.match(bootstrap, /new ServicioClienteEmisionFederacion/u);
  assert.match(bootstrap, /servicioClienteEmisionFederacion:/u);
  assert.doesNotMatch(`${webIndex}\n${aplicacionWeb}`, /ClienteHttpDatosFederacion|ServicioClienteEmisionFederacion/u);
  assert.doesNotMatch(runtime, /servicioClienteEmisionFederacion\.(?:entregarLote|obtenerCapacidad|obtenerProgreso)/u);
}

async function verificarOperacionesYDestinoAprobado() {
  const ids = crearIds();
  const solicitudes = [];
  let resoluciones = 0;
  const destino = Object.freeze({
    relacionId: ids.relacionId,
    installationRemotaId: ids.installationRemotaId,
    endpoint: 'https://receptor.example/prefijo',
    versionAutoridad: '4',
    estadoCompatibilidad: 'compatible'
  });
  const repositorioDestinos = {
    async obtenerAprobadoOperativo({ relacionId }) {
      resoluciones += 1;
      assert.equal(relacionId, ids.relacionId);
      return destino;
    }
  };
  const fetchImpl = async (url, opciones) => {
    solicitudes.push({ url, opciones });
    return respuestaJson({ ok: true, operacion: solicitudes.length });
  };
  const servicio = new ServicioClienteEmisionFederacion({
    repositorioDestinos,
    clienteHttp: new ClienteHttpDatosFederacion({ fetchImpl, timeoutMs: 500 })
  });

  assert.equal((await servicio.obtenerCapacidad({
    relacionId: ids.relacionId,
    token: TOKEN
  })).operacion, 1);
  assert.equal((await servicio.entregarLote({
    relacionId: ids.relacionId,
    token: TOKEN,
    lote: lote(ids)
  })).operacion, 2);
  assert.equal((await servicio.obtenerProgreso({
    relacionId: ids.relacionId,
    token: TOKEN,
    flujoId: ids.flujoId,
    generacionId: ids.generacionId
  })).operacion, 3);
  const disponibilidad = {
    relacionId: ids.relacionId,
    flujoId: ids.flujoId,
    generacionId: ids.generacionId
  };
  assert.equal((await servicio.registrarDisponibilidad({
    relacionId: ids.relacionId,
    token: TOKEN,
    flujoId: ids.flujoId,
    generacionId: ids.generacionId,
    declaracion: disponibilidad
  })).operacion, 4);
  assert.equal((await servicio.listarDisponibilidad({
    relacionId: ids.relacionId,
    token: TOKEN,
    flujoId: ids.flujoId,
    generacionId: ids.generacionId
  })).operacion, 5);

  assert.equal(resoluciones, 5, 'Cada operación debe releer el destino durable vigente.');
  assert.deepEqual(solicitudes.map(({ url }) => url), [
    'https://receptor.example/prefijo/api/federacion/v1/datos/capacidad',
    'https://receptor.example/prefijo/api/federacion/v1/datos/lotes',
    `https://receptor.example/prefijo/api/federacion/v1/datos/flujos/${ids.flujoId}` +
      `/generaciones/${ids.generacionId}/progreso`,
    `https://receptor.example/prefijo/api/federacion/v1/datos/flujos/${ids.flujoId}` +
      `/generaciones/${ids.generacionId}/disponibilidad`,
    `https://receptor.example/prefijo/api/federacion/v1/datos/flujos/${ids.flujoId}` +
      `/generaciones/${ids.generacionId}/disponibilidad`
  ]);
  for (const { opciones } of solicitudes) {
    assert.equal(opciones.headers.authorization, `Bearer ${TOKEN}`);
    assert.equal(opciones.redirect, 'error');
    assert.equal(opciones.cache, 'no-store');
    assert.ok(opciones.signal instanceof AbortSignal);
    assert.doesNotMatch(String(opciones.body || ''), /sfop1_/u);
  }
  assert.equal(solicitudes[0].opciones.method, 'GET');
  assert.equal(solicitudes[1].opciones.method, 'POST');
  assert.equal(solicitudes[3].opciones.method, 'POST');
  assert.equal(solicitudes[4].opciones.method, 'GET');
  assert.deepEqual(JSON.parse(solicitudes[1].opciones.body), lote(ids));
  assert.deepEqual(JSON.parse(solicitudes[3].opciones.body), disponibilidad);

  await assert.rejects(
    servicio.entregarLote({
      relacionId: ids.relacionId,
      token: TOKEN,
      lote: { ...lote(ids), relacionId: generar(TIPOS_IDENTIDAD_FEDERADA.RELACION) }
    }),
    /no pertenece a la relación/u
  );
  assert.equal(resoluciones, 5, 'Un lote ajeno debe fallar antes de resolver o usar red.');

  let consulta = null;
  const repositorio = new RepositorioDestinosEmisionFederacionSql({
    async consultar(sql, parametros) {
      consulta = { sql, parametros };
      return [];
    }
  });
  await assert.rejects(
    repositorio.obtenerAprobadoOperativo({ relacionId: ids.relacionId }),
    (error) => error.codigo === 'destino_emision_no_operativo'
  );
  assert.deepEqual(consulta.parametros, [ids.relacionId]);
  for (const condicion of [
    "r.direccion='emision'",
    "r.estado_ciclo='vinculada'",
    "r.estado_autoridad='autorizada'",
    "r.estado_identidad='valida'",
    "l.estado='activa'"
  ]) assert.ok(consulta.sql.includes(condicion), `Falta condición durable ${condicion}.`);
}

async function verificarTimeoutCotasYErrores() {
  const ids = crearIds();
  const destino = {
    relacionId: ids.relacionId,
    installationRemotaId: ids.installationRemotaId,
    endpoint: 'https://receptor.example'
  };
  const clienteTimeout = new ClienteHttpDatosFederacion({
    timeoutMs: 10,
    fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        const error = new Error('abortado con secreto interno');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    })
  });
  await assert.rejects(
    clienteTimeout.obtenerCapacidad({ destino, token: TOKEN }),
    (error) => error.codigo === 'timeout_transporte_federado' && error.reintentable
  );

  const clienteCuerpoLento = new ClienteHttpDatosFederacion({
    timeoutMs: 10,
    fetchImpl: async (_url, { signal }) => ({
      ok: true,
      status: 200,
      headers: { get: (nombre) => nombre === 'content-type' ? 'application/json' : null },
      body: {
        getReader() {
          return {
            read: () => new Promise((_resolve, reject) => {
              signal.addEventListener('abort', () => reject(new Error('body abortado')), {
                once: true
              });
            }),
            async cancel() {}
          };
        }
      }
    })
  });
  await assert.rejects(
    clienteCuerpoLento.obtenerCapacidad({ destino, token: TOKEN }),
    (error) => error.codigo === 'timeout_transporte_federado'
  );

  const clienteRed = new ClienteHttpDatosFederacion({
    fetchImpl: async () => {
      throw new Error(`falló usando ${TOKEN}`);
    }
  });
  await assert.rejects(
    clienteRed.obtenerCapacidad({ destino, token: TOKEN }),
    (error) => {
      assert.equal(error.codigo, 'transporte_federado_no_disponible');
      assert.doesNotMatch(`${error.message} ${JSON.stringify(error)}`, /sfop1_/u);
      return true;
    }
  );

  const capacidad = {
    capacidadTemporalOcurrencias: 1,
    disponible: true,
    familiasSoportadas: null,
    maximoBytesPorLote: 1024,
    maximoBytesPorOcurrencia: 512,
    maximoOcurrenciasPorLote: 1,
    versionConfiguracion: '1',
    versionesFamilia: null
  };
  const clienteRechazo = new ClienteHttpDatosFederacion({
    fetchImpl: async () => respuestaJson({
      ok: false,
      codigo: 'lote_excede_limites',
      mensaje: `mensaje remoto hostil ${TOKEN}`,
      capacidad
    }, 413)
  });
  await assert.rejects(
    clienteRechazo.entregarLote({ destino, token: TOKEN, lote: lote(ids) }),
    (error) => {
      assert.ok(error instanceof ErrorClienteHttpFederacion);
      assert.equal(error.statusCode, 413);
      assert.equal(error.codigoRemoto, 'lote_excede_limites');
      assert.deepEqual(error.capacidad, capacidad);
      assert.doesNotMatch(error.message, /hostil|sfop1_/u);
      return true;
    }
  );

  const clienteRespuestaGrande = new ClienteHttpDatosFederacion({
    fetchImpl: async () => new Response('{}', {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'content-length': String(2 * 1024 * 1024)
      }
    })
  });
  await assert.rejects(
    clienteRespuestaGrande.obtenerCapacidad({ destino, token: TOKEN }),
    (error) => error.codigo === 'respuesta_federada_invalida'
  );
}

async function verificarConsultaSqlReal() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true);
  const sql = new ClienteSql(configuracion.sql);
  try {
    await assert.rejects(
      new RepositorioDestinosEmisionFederacionSql(sql)
        .obtenerAprobadoOperativo({
          relacionId: generar(TIPOS_IDENTIDAD_FEDERADA.RELACION)
        }),
      (error) => error.codigo === 'destino_emision_no_operativo'
    );
  } finally {
    await sql.cerrar();
  }
}

function respuestaJson(cuerpo, status = 200) {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function lote(ids) {
  return {
    loteId: ids.loteId,
    relacionId: ids.relacionId,
    flujoId: ids.flujoId,
    generacionId: ids.generacionId,
    entregas: [{
      entregaId: ids.entregaId,
      posicionFlujo: '1',
      ocurrencia: { fixture: true }
    }]
  };
}

function crearIds() {
  return {
    relacionId: generar(TIPOS_IDENTIDAD_FEDERADA.RELACION),
    installationRemotaId: generar(TIPOS_IDENTIDAD_FEDERADA.INSTALACION),
    flujoId: generar(TIPOS_IDENTIDAD_FEDERADA.FLUJO),
    generacionId: generar(TIPOS_IDENTIDAD_FEDERADA.GENERACION),
    loteId: generar(TIPOS_IDENTIDAD_FEDERADA.LOTE),
    entregaId: generar(TIPOS_IDENTIDAD_FEDERADA.ENTREGA)
  };
}

function generar(tipo) {
  return String(generador.generar(tipo));
}

function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}
