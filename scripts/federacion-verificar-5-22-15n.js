import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { RepositorioAuditoria } from '../paquetes/auditoria/src/RepositorioAuditoria.js';
import { AdaptadorAuditoriaTransporteFederacion } from '../paquetes/federacion/adaptadores/AdaptadorAuditoriaTransporteFederacion.js';
import { ServicioRecepcionLotesFederacionLocal } from '../paquetes/federacion/aplicacion/ServicioRecepcionLotesFederacionLocal.js';
import { TIPOS_IDENTIDAD_FEDERADA } from '../paquetes/federacion/src/IdentidadFederada.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { obtenerConfiguracionAplicacion } from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';
import { crearElemento, id, migrar } from './federacion-verificar-5-22-15g.js';

await main();

async function main() {
  await verificarRegistro();
  await verificarIntegracionServicio();
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true);
  const baseDatos = `sentinelia_fixture_52215n_${randomBytes(6).toString('hex')}`;
  const administrador = new ClienteSql(configuracion.sql);
  let sql;
  try {
    await administrador.ejecutar(
      `CREATE DATABASE ${administrador.escaparIdentificador(baseDatos)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    sql = new ClienteSql({ ...configuracion.sql, baseDatos });
    await migrar(sql);
    await verificarTestimonio(sql);
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(baseDatos)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
  console.log(
    '[federacion] OK 5.22.15n: testimonio=por_intento_durable ' +
    'ocurrencias=no_auditadas_individualmente replay_terminal=omitido ' +
    'transaccion=compartida rango_y_conteos=consolidados'
  );
}

async function verificarIntegracionServicio() {
  const orden = [];
  const entrega = Object.freeze({ entregaId: 'entrega-fixture' });
  const preparacion = Object.freeze({
    lote: Object.freeze({
      loteId: 'lote-fixture', flujoId: 'flujo-fixture',
      generacionId: 'generacion-fixture', entregas: Object.freeze([entrega])
    }),
    numeroIntento: '1', clase: 'inicial',
    terminalesPrevios: new Map([[
      entrega.entregaId,
      Object.freeze({ clasificacion: 'terminal', resultado: 'aceptada' })
    ]]),
    entregasExcedidas: Object.freeze([]),
    capacidad: Object.freeze({ disponible: true, capacidadTemporalOcurrencias: 1 })
  });
  const durable = Object.freeze({
    loteId: preparacion.lote.loteId,
    numeroIntento: preparacion.numeroIntento,
    clase: preparacion.clase,
    estado: 'terminal',
    intentoId: '1',
    resultados: Object.freeze([Object.freeze({
      resultadoId: '1', inboxId: '1', clasificacion: 'terminal',
      resultado: 'aceptada', confirmada: true
    })])
  });
  let activa = false;
  const conexion = {
    async beginTransaction() { activa = true; orden.push('begin'); },
    async commit() { assert.equal(activa, true); orden.push('commit'); activa = false; },
    async rollback() { orden.push('rollback'); activa = false; },
    release() { orden.push('release'); },
    async execute() {},
    async query() {}
  };
  const servicio = new ServicioRecepcionLotesFederacionLocal({
    clienteSql: { async obtenerConexion() { return conexion; } },
    repositorioEntregas: {
      async prepararIntentoEnTransaccion() { orden.push('preparar'); return preparacion; },
      async guardarIntentoEnTransaccion() { orden.push('guardar'); return durable; }
    },
    repositorioInbox: { async recibirEnTransaccion() { throw new Error('No debe ejecutarse.'); } },
    repositorioCursores: {
      async aplicarResultadosEnTransaccion() { orden.push('cursor'); return Object.freeze({}); }
    },
    testimoniadorRecepcion: {
      async registrarRecepcionEnTransaccion(entrada, { conexion: recibida }) {
        assert.equal(recibida, conexion);
        assert.equal(activa, true);
        assert.equal(entrada.preparacion, preparacion);
        assert.equal(entrada.resultadoDurable, durable);
        orden.push('testimonio');
      }
    }
  });
  await servicio.entregarLote({});
  assert.deepEqual(orden, [
    'begin', 'preparar', 'guardar', 'cursor', 'testimonio', 'commit', 'release'
  ]);

  orden.length = 0;
  servicio.testimoniadorRecepcion = {
    async registrarRecepcionEnTransaccion() {
      orden.push('testimonio');
      throw new Error('fallo-testimonio');
    }
  };
  await assert.rejects(servicio.entregarLote({}), /fallo-testimonio/u);
  assert.deepEqual(orden, [
    'begin', 'preparar', 'guardar', 'cursor', 'testimonio', 'rollback', 'release'
  ]);
}

async function verificarRegistro() {
  const [servicio, web] = await Promise.all([
    leer('../paquetes/federacion/aplicacion/ServicioRecepcionLotesFederacionLocal.js'),
    leer('../apps/sentinelia-web/src/index.js')
  ]);
  assert.match(servicio, /registrarRecepcionEnTransaccion/u);
  assert.match(web, /AdaptadorAuditoriaTransporteFederacion/u);
}

async function verificarTestimonio(sql) {
  const contexto = await crearElemento({
    sql,
    adaptador: {
      async materializarEnTransaccion() {
        return Object.freeze({ estado: 'materializada' });
      }
    },
    installationRemotaId: id(TIPOS_IDENTIDAD_FEDERADA.INSTALACION),
    elementoOrigenId: id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN),
    payload: { fixture: '15n' },
    familia: 'telemetria'
  });
  const adaptador = new AdaptadorAuditoriaTransporteFederacion({
    repositorioAuditoria: new RepositorioAuditoria(sql)
  });
  const loteId = id(TIPOS_IDENTIDAD_FEDERADA.LOTE);
  const preparacion = crearPreparacion(contexto.ids, loteId, '1', 'inicial');
  const durable = crearResultado(preparacion, [
    resultado('aceptada'),
    resultado('aplazadaCapacidad', 'temporal'),
    resultado('divergente')
  ]);
  const incorporado = await enTransaccion(sql, (conexion) =>
    adaptador.registrarRecepcionEnTransaccion({
      preparacion, resultadoDurable: durable
    }, { conexion })
  );
  assert.equal(incorporado.estado, 'incorporado');
  assert.deepEqual(incorporado.rango, { desde: '10', hasta: '14' });
  assert.deepEqual(incorporado.conteos, {
    ocurrencias: '3', aceptadas: '1', rechazadas: '1', bytes: '24'
  });

  const replay = await enTransaccion(sql, (conexion) =>
    adaptador.registrarRecepcionEnTransaccion({
      preparacion: { ...preparacion, clase: 'replayTerminal' },
      resultadoDurable: durable
    }, { conexion })
  );
  assert.deepEqual(replay, { estado: 'omitido', causa: 'replayTerminalExacto' });

  const antesRollback = await contarTestimonios(sql);
  const conexion = await sql.obtenerConexion();
  try {
    await conexion.beginTransaction();
    const intento2 = crearPreparacion(contexto.ids, loteId, '2', 'reintento');
    const segundo = await adaptador.registrarRecepcionEnTransaccion({
      preparacion: intento2,
      resultadoDurable: crearResultado(intento2, [
        { ...resultado('aceptada'), reutilizado: true },
        resultado('aceptada'),
        resultado('aceptada')
      ])
    }, { conexion });
    assert.deepEqual(segundo.rango, { desde: '12', hasta: '14' });
    assert.deepEqual(segundo.conteos, {
      ocurrencias: '2', aceptadas: '2', rechazadas: '0', bytes: '17'
    });
    await conexion.rollback();
  } finally {
    conexion.release();
  }
  assert.equal(await contarTestimonios(sql), antesRollback);

  const filas = await sql.consultar(
    `SELECT tipo_evento,actor_real_tipo,actor_real_id,sujeto_id,
            scope_tenant_id,scope_empresa_id,scope_sitio_id,payload
       FROM eventos_auditoria
      WHERE tipo_evento='federacion.lote_recibido'`
  );
  assert.equal(filas.length, 1);
  assert.equal(filas[0].actor_real_tipo, 'instancia_remota');
  assert.equal(filas[0].actor_real_id, contexto.ids.installationRemotaId);
  assert.equal(filas[0].sujeto_id, loteId);
  assert.equal(String(filas[0].scope_tenant_id), '10');
  assert.equal(String(filas[0].scope_empresa_id), '20');
  assert.equal(filas[0].scope_sitio_id, null);
  const payload = typeof filas[0].payload === 'string'
    ? JSON.parse(filas[0].payload)
    : filas[0].payload;
  assert.equal(payload.loteId, loteId);
  assert.equal(payload.generacionId, contexto.ids.generacionId);
  assert.deepEqual(payload.conteos, incorporado.conteos);
}

function crearPreparacion(ids, loteId, numeroIntento, clase) {
  const ocurrencias = ['{"a":1}', '{"bb":2}', '{"ccc":3}'];
  return Object.freeze({
    numeroIntento,
    clase,
    lote: Object.freeze({
      loteId,
      relacionId: ids.relacionId,
      flujoId: ids.flujoId,
      generacionId: ids.generacionId,
      entregas: Object.freeze(ocurrencias.map((canonico, indice) => Object.freeze({
        posicionFlujo: ['10', '12', '14'][indice],
        ocurrenciaPersistibleCanonica: canonico
      })))
    })
  });
}

function crearResultado(preparacion, resultados) {
  return Object.freeze({
    loteId: preparacion.lote.loteId,
    numeroIntento: preparacion.numeroIntento,
    resultados: Object.freeze(resultados)
  });
}

function resultado(valor, clasificacion = 'terminal') {
  return Object.freeze({ clasificacion, resultado: valor });
}

async function enTransaccion(sql, operacion) {
  const conexion = await sql.obtenerConexion();
  try {
    await conexion.beginTransaction();
    const salida = await operacion(conexion);
    await conexion.commit();
    return salida;
  } catch (error) {
    await conexion.rollback().catch(() => {});
    throw error;
  } finally {
    conexion.release();
  }
}

async function contarTestimonios(sql) {
  const [fila] = await sql.consultar(
    "SELECT COUNT(*) AS total FROM eventos_auditoria WHERE tipo_evento='federacion.lote_recibido'"
  );
  return Number(fila.total);
}

function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}
