import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { ControladorApiAgentes } from '../apps/sentinelia-web/src/controladores/ControladorApiAgentes.js';
import { crearAplicacionTelemetriaFixture } from './fixtureAplicacionTelemetriaHttp.js';

import {
  generarUuidV7Auditoria,
  uuidV7AuditoriaABytes
} from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import {
  crearLecturaTelemetriaAgenteConTiposInternos
} from '../paquetes/agentes/src/TelemetriaAgente.js';
import { RepositorioCatalogoSenalesTelemetriaAgentes } from '../paquetes/agentes/src/RepositorioCatalogoSenalesTelemetriaAgentes.js';
import { RepositorioObservacionesTelemetriaAgentes } from '../paquetes/agentes/src/RepositorioObservacionesTelemetriaAgentes.js';
import { RepositorioEstadoActualTelemetriaAgentes } from '../paquetes/agentes/src/RepositorioEstadoActualTelemetriaAgentes.js';
import { RepositorioIdempotenciaLotesTelemetriaAgentes } from '../paquetes/agentes/src/RepositorioIdempotenciaLotesTelemetriaAgentes.js';
import { ServicioIngestaTelemetriaAgentes } from '../paquetes/agentes/src/ServicioIngestaTelemetriaAgentes.js';
import {
  crearEjecutorTelemetriaEnTransaccion
} from '../paquetes/agentes/src/InfraestructuraTransaccionalTelemetriaAgentes.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones } from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

await main();

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(
    configuracion.sql.estaCompleta,
    true,
    '5.24.1 necesita una conexión SQL real para verificar la migración.'
  );
  const baseDatos = `sentinelia_fixture_5241_${randomBytes(6).toString('hex')}`;
  const administrador = new ClienteSql(configuracion.sql);
  await administrador.ejecutar(
    `CREATE DATABASE ${administrador.escaparIdentificador(baseDatos)} ` +
    'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
  );
  const sql = new ClienteSql({ ...configuracion.sql, baseDatos });

  try {
    await new EjecutorMigraciones({
      clienteSql: sql,
      repositorioMigraciones: new RepositorioMigraciones(sql),
      rutaMigraciones: obtenerRutaMigraciones()
    }).ejecutarPendientes();
    await sql.verificarUsoHorarioUtc();

    const agenteId = await crearAgente(sql);
    await verificarFormaFisica(sql);
    await verificarRoundTripTemporal(sql, agenteId);
    await verificarChecksExclusivos(sql, agenteId);
    await verificarIdempotenciaConcurrente(sql, agenteId);
    await verificarRollbackIdempotenteAtomico(sql, agenteId);
    await verificarIdempotenciaServicio(sql, agenteId);

    console.log(
      '[agentes] OK 5.24.1: migracion=0210 tipos_sql=7 ' +
      'roundtrip=duracion_momento_utc fotografia=observado_en_utc ' +
      'idempotencia=sql_concurrente_expirable'
    );
  } finally {
    await sql.cerrar();
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(baseDatos)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

async function crearAgente(sql) {
  const alias = `fixture-5241-${randomBytes(4).toString('hex')}`;
  const [tenant] = await sql.ejecutar(
    'INSERT INTO tenants (nombre, alias) VALUES (?, ?)',
    ['Tenant 5.24.1', alias]
  );
  const [empresa] = await sql.ejecutar(
    'INSERT INTO empresas (tenant_id, nombre, alias) VALUES (?, ?, ?)',
    [tenant.insertId, 'Empresa 5.24.1', alias]
  );
  const [sitio] = await sql.ejecutar(
    'INSERT INTO sitios (tenant_id, empresa_id, nombre, alias) VALUES (?, ?, ?, ?)',
    [tenant.insertId, empresa.insertId, 'Sitio 5.24.1', alias]
  );
  const [agente] = await sql.ejecutar(
    `INSERT INTO agentes_sentinelia (
       guid, tenant_id, empresa_id, sitio_id, nombre, secreto_hash
     ) VALUES (?, ?, ?, ?, ?, ?)`,
    [
      randomUUID(),
      tenant.insertId,
      empresa.insertId,
      sitio.insertId,
      'Agente temporal 5.24.1',
      'hash-no-utilizable'
    ]
  );
  return Number(agente.insertId);
}

async function verificarFormaFisica(sql) {
  const tablasEnum = [
    'senales_telemetria_agentes',
    'observaciones_telemetria_agentes',
    'estado_actual_telemetria_agentes',
    'estado_actual_evaluacion_reglas_telemetria',
    'eventos_derivados_telemetria'
  ];
  const enums = await sql.consultar(
    `SELECT table_name, column_type
       FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND column_name = 'tipo_dato'
        AND table_name IN (${tablasEnum.map(() => '?').join(', ')})`,
    tablasEnum
  );
  assert.equal(enums.length, 5);
  for (const fila of enums) {
    assert.match(fila.column_type, /'duracion'/u);
    assert.match(fila.column_type, /'momento_utc'/u);
  }

  const columnas = await sql.consultar(
    `SELECT table_name, column_name, data_type
       FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name IN (
          'observaciones_telemetria_agentes',
          'estado_actual_telemetria_agentes'
        )
        AND column_name IN ('valor_duracion', 'valor_momento_utc')`
  );
  assert.equal(columnas.length, 4);
  assert.equal(
    columnas.filter((fila) => fila.column_name === 'valor_duracion')
      .every((fila) => fila.data_type === 'double'),
    true
  );
  assert.equal(
    columnas.filter((fila) => fila.column_name === 'valor_momento_utc')
      .every((fila) => fila.data_type === 'datetime'),
    true
  );

  const indices = await sql.consultar(
    `SELECT index_name
       FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name = 'lotes_idempotentes_telemetria_agentes'
        AND index_name = 'idx_lotes_idempotentes_telemetria_purga'`
  );
  assert.ok(indices.length >= 1);
}

async function verificarRoundTripTemporal(sql, agenteId) {
  const catalogo = new RepositorioCatalogoSenalesTelemetriaAgentes(sql);
  const historico = new RepositorioObservacionesTelemetriaAgentes(sql);
  const fotografia = new RepositorioEstadoActualTelemetriaAgentes(sql);
  const senalDuracion = await catalogo.guardarDeclaracionSenal({
    agenteId,
    definicion: {
      categoria: 'copias',
      clave: 'duracion',
      tipoDato: 'duracion',
      unidad: 's'
    }
  });
  const senalMomento = await catalogo.guardarDeclaracionSenal({
    agenteId,
    definicion: {
      categoria: 'copias',
      clave: 'siguiente',
      tipoDato: 'momento_utc'
    }
  });
  assert.equal(senalDuracion.unidad, null);
  assert.equal(senalMomento.unidad, null);

  const lecturas = [
    lecturaTemporal({
      clave: 'duracion',
      tipoDato: 'duracion',
      observadoEnUtc: '2026-08-25T10:00:00Z',
      valorDuracion: Number.MAX_VALUE
    }),
    lecturaTemporal({
      clave: 'duracion',
      tipoDato: 'duracion',
      observadoEnUtc: '2026-08-25T09:00:00Z',
      valorDuracion: 0
    }),
    lecturaTemporal({
      clave: 'siguiente',
      tipoDato: 'momento_utc',
      observadoEnUtc: '2026-08-25T10:00:00Z',
      valorMomentoUtc: '9999-12-31T23:59:59Z'
    }),
    lecturaTemporal({
      clave: 'siguiente',
      tipoDato: 'momento_utc',
      observadoEnUtc: '2026-08-25T09:00:00Z',
      valorMomentoUtc: '1000-01-01T00:00:00Z'
    })
  ];
  const insertadas = await historico.insertarLoteAceptado({
    agenteId,
    senalesCatalogadas: [senalDuracion, senalMomento],
    recibidoEnUtc: '2026-08-25T10:00:01Z',
    observacionesAceptadas: lecturas
  });
  assert.equal(insertadas.totalInsertadas, 4);
  assert.equal(insertadas.insertadas[0].valorDuracion, Number.MAX_VALUE);
  assert.equal(insertadas.insertadas[1].valorDuracion, 0);
  assert.equal(insertadas.insertadas[2].valorMomentoUtc, '9999-12-31T23:59:59Z');
  assert.equal(insertadas.insertadas[3].valorMomentoUtc, '1000-01-01T00:00:00Z');
  assert.doesNotMatch(insertadas.insertadas[2].valorMomentoUtc, /\.000Z$/u);

  await fotografia.aplicarObservacionesHistoricas(insertadas.insertadas);
  const duracionActual = await fotografia.buscarPorSenalId({
    agenteId,
    senalId: senalDuracion.id
  });
  const momentoActual = await fotografia.buscarPorSenalId({
    agenteId,
    senalId: senalMomento.id
  });
  assert.equal(duracionActual.valorDuracion, Number.MAX_VALUE);
  assert.equal(momentoActual.valorMomentoUtc, '9999-12-31T23:59:59Z');
  assert.equal(duracionActual.observadoEnUtc, '2026-08-25T10:00:00.000Z');

  const historicoOrdenado = await historico.listarPorSenalYRango({
    agenteId,
    senalId: senalDuracion.id,
    orden: 'asc'
  });
  assert.deepEqual(
    historicoOrdenado.map((lectura) => lectura.valorDuracion),
    [0, Number.MAX_VALUE]
  );

  const antigua = await historico.insertarLoteAceptado({
    agenteId,
    observacionesAceptadas: [{
      categoria: 'compatibilidad',
      clave: 'numero',
      tipoDato: 'numero',
      observadoEnUtc: '2026-08-25T11:00:00Z',
      valorNumero: 1
    }]
  });
  const [filaAntigua] = await sql.consultar(
    `SELECT valor_duracion, valor_momento_utc
       FROM observaciones_telemetria_agentes WHERE id = ?`,
    [antigua.insertadas[0].id]
  );
  assert.equal(filaAntigua.valor_duracion, null);
  assert.equal(filaAntigua.valor_momento_utc, null);
}

function lecturaTemporal(datos) {
  return crearLecturaTelemetriaAgenteConTiposInternos({
    categoria: 'copias',
    ...datos
  });
}

async function verificarChecksExclusivos(sql, agenteId) {
  await assert.rejects(
    sql.ejecutar(
      `INSERT INTO observaciones_telemetria_agentes (
         agente_id, categoria, clave, codigo_senal, tipo_dato,
         valor_duracion, observado_en_utc
       ) VALUES (?, 'checks', 'negativa', 'checks.negativa', 'duracion', -1,
         '2026-08-25 12:00:00')`,
      [agenteId]
    ),
    esErrorCheckSql
  );
  await assert.rejects(
    sql.ejecutar(
      `INSERT INTO observaciones_telemetria_agentes (
         agente_id, categoria, clave, codigo_senal, tipo_dato,
         valor_numero, valor_duracion, observado_en_utc
       ) VALUES (?, 'checks', 'doble', 'checks.doble', 'duracion', 1, 1,
         '2026-08-25 12:00:00')`,
      [agenteId]
    ),
    esErrorCheckSql
  );
}

function esErrorCheckSql(error) {
  return error?.code === 'ER_CHECK_CONSTRAINT_VIOLATED' ||
    error?.errno === 3819 ||
    /constraint|check/iu.test(error?.message || '');
}

async function verificarIdempotenciaConcurrente(sql, agenteId) {
  const telemetriaRequestId = generarUuidV7Auditoria();
  const huella = randomBytes(32);
  const conexion1 = await sql.obtenerConexion();
  const conexion2 = await sql.obtenerConexion();

  try {
    await conexion1.beginTransaction();
    await conexion2.beginTransaction();
    const repositorio1 = new RepositorioIdempotenciaLotesTelemetriaAgentes(
      crearEjecutorTelemetriaEnTransaccion(conexion1),
      { generarTokenReserva: () => Buffer.alloc(16, 1) }
    );
    const repositorio2 = new RepositorioIdempotenciaLotesTelemetriaAgentes(
      crearEjecutorTelemetriaEnTransaccion(conexion2),
      { generarTokenReserva: () => Buffer.alloc(16, 2) }
    );
    const primera = await repositorio1.reservar({
      agenteId,
      telemetriaRequestId,
      huellaSha256: huella
    });
    assert.equal(primera.nueva, true);

    let segundaResuelta = false;
    const segundaPendiente = repositorio2.reservar({
      agenteId,
      telemetriaRequestId,
      huellaSha256: huella
    }).then((resultado) => {
      segundaResuelta = true;
      return resultado;
    });
    await new Promise((resolver) => setImmediate(resolver));
    assert.equal(segundaResuelta, false);

    const estable = {
      ok: true,
      resultado: 'aceptado',
      recibidoEnUtc: '2026-08-25T12:00:00.000Z',
      aceptadas: 2,
      rechazadas: 0,
      errores: []
    };
    await repositorio1.confirmar({
      agenteId,
      telemetriaRequestId,
      tokenReserva: primera.tokenReserva,
      resultadoEstable: estable,
      recibidoEnUtc: estable.recibidoEnUtc
    });
    await conexion1.commit();

    const segunda = await segundaPendiente;
    assert.equal(segunda.replay, true);
    assert.deepEqual(segunda.resultadoEstable, estable);
    await conexion2.commit();
  } catch (error) {
    await conexion1.rollback().catch(() => {});
    await conexion2.rollback().catch(() => {});
    throw error;
  } finally {
    conexion1.release();
    conexion2.release();
  }

  await sql.ejecutar(
    `UPDATE lotes_idempotentes_telemetria_agentes
        SET expira_en_utc = TIMESTAMPADD(SECOND, -1, UTC_TIMESTAMP(6))
      WHERE agente_id = ? AND telemetria_request_id = ?`,
    [agenteId, uuidV7AuditoriaABytes(telemetriaRequestId)]
  );
  const conexion = await sql.obtenerConexion();
  try {
    await conexion.beginTransaction();
    const repositorio = new RepositorioIdempotenciaLotesTelemetriaAgentes(
      crearEjecutorTelemetriaEnTransaccion(conexion),
      { generarTokenReserva: () => Buffer.alloc(16, 3) }
    );
    const nuevaHuella = randomBytes(32);
    const reemplazo = await repositorio.reservar({
      agenteId,
      telemetriaRequestId,
      huellaSha256: nuevaHuella
    });
    assert.equal(reemplazo.nueva, true);
    await repositorio.confirmar({
      agenteId,
      telemetriaRequestId,
      tokenReserva: reemplazo.tokenReserva,
      resultadoEstable: {
        ok: true,
        resultado: 'aceptado',
        recibidoEnUtc: '2026-08-25T12:01:00.000Z',
        aceptadas: 1,
        rechazadas: 0,
        errores: []
      },
      recibidoEnUtc: '2026-08-25T12:01:00.000Z'
    });
    await conexion.commit();
    const fila = await new RepositorioIdempotenciaLotesTelemetriaAgentes(sql)
      .buscar({ agenteId, telemetriaRequestId });
    assert.equal(fila.huellaSha256, nuevaHuella.toString('hex'));
  } catch (error) {
    await conexion.rollback().catch(() => {});
    throw error;
  } finally {
    conexion.release();
  }
}

async function verificarIdempotenciaServicio(sql, agenteId) {
  const servicio = new ServicioIngestaTelemetriaAgentes({
    repositorioCatalogoSenales:
      new RepositorioCatalogoSenalesTelemetriaAgentes(sql),
    repositorioObservaciones:
      new RepositorioObservacionesTelemetriaAgentes(sql),
    repositorioEstadoActual:
      new RepositorioEstadoActualTelemetriaAgentes(sql),
    repositorioIdempotenciaLotes:
      new RepositorioIdempotenciaLotesTelemetriaAgentes(sql),
    generarRequestId: (() => {
      let secuencia = 0;
      return () => `req_fixture_${++secuencia}`;
    })(),
    reloj: () => new Date('2026-08-25T13:00:00Z')
  });
  const telemetriaRequestId = generarUuidV7Auditoria();
  const huellaLoteSha256 = randomBytes(32);
  const lote = {
    emitidoEnUtc: '2026-08-25T12:59:59Z',
    observaciones: [{
      categoria: 'compatibilidad',
      clave: 'idempotente',
      tipoDato: 'numero',
      observadoEnUtc: '2026-08-25T12:59:58Z',
      valorNumero: 7
    }]
  };
  const primera = await servicio.ingestarLote({
    agenteId,
    lote,
    telemetriaRequestId,
    huellaLoteSha256
  });
  const segunda = await servicio.ingestarLote({
    agenteId,
    lote,
    telemetriaRequestId,
    huellaLoteSha256
  });
  assert.equal(primera.idempotencia.replay, false);
  assert.equal(segunda.idempotencia.replay, true);
  assert.equal(primera.resultado.requestId, 'req_fixture_1');
  assert.equal(segunda.resultado.requestId, 'req_fixture_2');
  assert.equal(segunda.resultado.recibidoEnUtc, primera.resultado.recibidoEnUtc);
  await assert.rejects(
    servicio.ingestarLote({
      agenteId,
      lote,
      telemetriaRequestId,
      huellaLoteSha256: randomBytes(32)
    }),
    (error) => error?.codigo === 'telemetria_request_id_divergente' &&
      error?.statusCode === 409
  );
  const [conteo] = await sql.consultar(
    `SELECT COUNT(*) AS total
       FROM observaciones_telemetria_agentes
      WHERE agente_id = ? AND categoria = 'compatibilidad'
        AND clave = 'idempotente'`,
    [agenteId]
  );
  assert.equal(Number(conteo.total), 1);
  await verificarLoteGrandeHttpSql(servicio, sql, agenteId);
}

async function verificarLoteGrandeHttpSql(servicio, sql, agenteId) {
  // Autenticación aislada; HTTP, contrato, ingesta, transacción y replay SQL reales.
  const app = crearAplicacionTelemetriaFixture(new ControladorApiAgentes({
    servicioIngestaTelemetriaAgentes: servicio,
    servicioAutenticacionAgentes: {
      async obtenerContextoIngestaTelemetria() {
        return { sesion: { agenteId }, coordinacion: {} };
      }
    }
  }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}/api/agentes/v1/telemetria`;
  const lote = { telemetriaRequestId: generarUuidV7Auditoria(),
    emitidoEnUtc: new Date().toISOString(),
    observaciones: Array.from({ length: 500 }, (_, i) => ({
      categoria: i === 0 ? 'compatibilidad' : 'http_grande',
      clave: i === 0 ? 'idempotente' : 'texto',
      // La primera señal ya está consolidada como número: aceptación parcial.
      tipoDato: 'texto', valorTexto: '😀'.repeat(2048),
      observadoEnUtc: new Date(Date.now() + i).toISOString(),
      metadatos: { prueba: 'cuerpo-grande-original' }
    })) };
  const bodyOriginal = JSON.stringify(lote);
  assert.ok(Buffer.byteLength(bodyOriginal) > 102400);
  async function enviar(body) {
    const respuesta = await fetch(url, { method: 'POST', body,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fixture-local' } });
    return { status: respuesta.status, json: await respuesta.json() };
  }
  try {
    const primera = await enviar(bodyOriginal);
    assert.equal(primera.status, 200);
    assert.equal(primera.json.resultado, 'parcial');
    assert.equal(primera.json.aceptadas, 499);
    assert.equal(primera.json.rechazadas, 1);
    const repetida = await enviar(bodyOriginal);
    assert.equal(repetida.status, 200);
    assert.equal(repetida.json.recibidoEnUtc, primera.json.recibidoEnUtc);
    assert.equal(repetida.json.aceptadas, primera.json.aceptadas);
    assert.deepEqual(repetida.json.errores, primera.json.errores);
    const distinta = structuredClone(lote);
    distinta.observaciones[1].valorTexto = 'otro contenido';
    const conflicto = await enviar(JSON.stringify(distinta));
    assert.equal(conflicto.status, 409);
    assert.equal(conflicto.json.code, 'telemetria_request_id_divergente');
    const [conteo] = await sql.consultar(
      "SELECT COUNT(*) total FROM observaciones_telemetria_agentes WHERE agente_id=? AND categoria='http_grande'",
      [agenteId]
    );
    assert.equal(Number(conteo.total), 499, 'Replay y divergencia no duplican efectos');
    const durable = await new RepositorioIdempotenciaLotesTelemetriaAgentes(sql)
      .buscar({ agenteId, telemetriaRequestId: lote.telemetriaRequestId });
    assert.ok(durable);
    const completo = structuredClone(lote);
    completo.telemetriaRequestId = generarUuidV7Auditoria();
    completo.observaciones.forEach((o) => { o.categoria = 'http_500'; });
    const bodyCompleto = JSON.stringify(completo);
    const aceptado = await enviar(bodyCompleto);
    assert.equal(aceptado.status, 200);
    assert.equal(aceptado.json.aceptadas, 500);
    assert.equal(aceptado.json.rechazadas, 0);
    const replayCompleto = await enviar(bodyCompleto);
    assert.equal(replayCompleto.status, 200);
    assert.equal(replayCompleto.json.recibidoEnUtc, aceptado.json.recibidoEnUtc);
    const [persistidas] = await sql.consultar(
      "SELECT COUNT(*) total FROM observaciones_telemetria_agentes WHERE agente_id=? AND categoria='http_500'",
      [agenteId]
    );
    assert.equal(Number(persistidas.total), 500);
    console.log(`[telemetria HTTP+SQL] ${Buffer.byteLength(bodyOriginal)} bytes, 499 aceptadas, 1 rechazada, replay estable y conflicto 409.`);
    console.log('[telemetria HTTP+SQL] Lote completo: 500 aceptadas; replay conserva exactamente 500 filas.');
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

async function verificarRollbackIdempotenteAtomico(sql, agenteId) {
  const telemetriaRequestId = generarUuidV7Auditoria();
  const conexion = await sql.obtenerConexion();
  const ejecutor = crearEjecutorTelemetriaEnTransaccion(conexion);
  try {
    await conexion.beginTransaction();
    const repositorioIdempotencia =
      new RepositorioIdempotenciaLotesTelemetriaAgentes(ejecutor);
    const reserva = await repositorioIdempotencia.reservar({
      agenteId,
      telemetriaRequestId,
      huellaSha256: randomBytes(32)
    });
    assert.equal(reserva.nueva, true);
    await new RepositorioObservacionesTelemetriaAgentes(ejecutor)
      .insertarLoteAceptado({
        agenteId,
        observacionesAceptadas: [{
          categoria: 'compatibilidad',
          clave: 'rollback_idempotente',
          tipoDato: 'numero',
          observadoEnUtc: '2026-08-25T12:30:00Z',
          valorNumero: 1
        }]
      });
    await conexion.rollback();
  } catch (error) {
    await conexion.rollback().catch(() => {});
    throw error;
  } finally {
    conexion.release();
  }

  const fila = await new RepositorioIdempotenciaLotesTelemetriaAgentes(sql)
    .buscar({ agenteId, telemetriaRequestId });
  assert.equal(fila, null);
  const [conteo] = await sql.consultar(
    `SELECT COUNT(*) AS total
       FROM observaciones_telemetria_agentes
      WHERE agente_id = ? AND categoria = 'compatibilidad'
        AND clave = 'rollback_idempotente'`,
    [agenteId]
  );
  assert.equal(Number(conteo.total), 0);
}
