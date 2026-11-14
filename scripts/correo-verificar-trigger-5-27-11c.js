import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import { RepositorioPreparacionBajaEjecucionesTriggerCorreoSql }
  from '../paquetes/correo/src/RepositorioPreparacionBajaEjecucionesTriggerCorreoSql.js';
import { RepositorioEliminacionAdministrativaAgentesSql }
  from '../paquetes/agentes/src/RepositorioEliminacionAdministrativaAgentesSql.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones }
  from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { FronteraTransaccionalLocal }
  from '../paquetes/persistencia-sql/src/FronteraTransaccionalLocal.js';
import { RepositorioMigraciones }
  from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';
import { prepararEntorno } from './correo-verificar-trigger-5-27-6c.js';

await main();

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true, '5.27.11c necesita MariaDB real.');
  const administrador = new ClienteSql(configuracion.sql);
  const nombre = `sentinelia_fixture_52711c_${randomBytes(5).toString('hex')}`;
  let sql;
  try {
    await administrador.ejecutar(
      `CREATE DATABASE ${administrador.escaparIdentificador(nombre)} ` +
        'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
    );
    sql = new ClienteSql({ ...configuracion.sql, baseDatos: nombre });
    const migraciones = await new EjecutorMigraciones({
      clienteSql: sql,
      repositorioMigraciones: new RepositorioMigraciones(sql),
      rutaMigraciones: obtenerRutaMigraciones()
    }).ejecutarPendientes();
    assert.equal(migraciones.integridad.ok, true);

    await verificarBajaTrigger(sql);
    await verificarBajaAsignacion(sql);
    await verificarBajaMonitor(sql);
    await verificarFronteraAgente(sql);
    await verificarCorrupcionBloquea(sql);
    console.log(
      '[correo-trigger] OK 5.27.11c: aceptadas=preservadas ' +
        'rechazadas=eliminadas purgadas=preservadas referencias=set_null ' +
        'trigger=integrado monitor=integrado agente=frontera_compartida ' +
        'clasificacion=bajo_lock corrupcion=rollback'
    );
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(nombre)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

async function verificarBajaTrigger(sql) {
  const ids = await prepararCaso(sql);
  const repositorio = new RepositorioPreparacionBajaEjecucionesTriggerCorreoSql();
  const resultado = await new FronteraTransaccionalLocal(sql).ejecutar(
    async (conexion) => {
      const preparado = await repositorio.prepararPorTriggerEnTransaccion(
        ids.triggerId,
        { conexion }
      );
      assert.deepEqual(resumen(preparado), {
        eliminadas: '1', correoAceptadoPreservadas: '2'
      });
      await conexion.execute('DELETE FROM triggers WHERE id=?', [ids.triggerId]);
      return preparado;
    }
  );
  await verificarPreservadas(sql, resultado.idsCorreoAceptadoPreservadas, {
    triggerNulo: true,
    monitorNulo: false
  });
  assert.equal(await contarId(sql, 'ejecuciones_triggers', ids.rechazoId), 0);
  assert.equal(await contarId(sql, 'resultados_destinatarios_triggers_correo',
    ids.resultadoRechazoId), 0);
  assert.equal(await contarId(sql, 'notificaciones_triggers_correo',
    ids.notificacionId), 1);
}

async function verificarBajaMonitor(sql) {
  const ids = await prepararCaso(sql);
  const repositorio = new RepositorioPreparacionBajaEjecucionesTriggerCorreoSql();
  const resultado = await new FronteraTransaccionalLocal(sql).ejecutar(
    async (conexion) => {
      const preparado = await repositorio.prepararPorMonitorEnTransaccion(
        ids.monitorId,
        { conexion }
      );
      await conexion.execute('DELETE FROM monitores WHERE id=?', [ids.monitorId]);
      return preparado;
    }
  );
  await verificarPreservadas(sql, resultado.idsCorreoAceptadoPreservadas, {
    triggerNulo: false,
    monitorNulo: true
  });
  assert.equal(await contarId(sql, 'ejecuciones_triggers', ids.rechazoId), 0);
}

async function verificarBajaAsignacion(sql) {
  const ids = await prepararCaso(sql);
  const repositorio = new RepositorioPreparacionBajaEjecucionesTriggerCorreoSql();
  const resultado = await new FronteraTransaccionalLocal(sql).ejecutar(
    async (conexion) => {
      const preparado = await repositorio.prepararPorAsignacionEnTransaccion(
        ids.asignacionId,
        { conexion }
      );
      await conexion.execute(
        'DELETE FROM asignaciones_triggers_monitores WHERE id=?',
        [ids.asignacionId]
      );
      return preparado;
    }
  );
  await verificarPreservadas(sql, resultado.idsCorreoAceptadoPreservadas, {
    triggerNulo: false,
    monitorNulo: false
  });
  assert.equal(await contarId(sql, 'ejecuciones_triggers', ids.rechazoId), 0);
}

async function verificarFronteraAgente(sql) {
  const ids = await prepararCaso(sql);
  const repositorio = new RepositorioEliminacionAdministrativaAgentesSql(sql, {
    autoridadReservasJerarquicas: {
      exigirDisponibilidadEnTransaccion() {}
    }
  });
  const resultado = await new FronteraTransaccionalLocal(sql).ejecutar(
    async (conexion) => {
      const preparado = await repositorio.eliminarEjecucionesTriggersEnTransaccion({
        monitorIds: [ids.monitorId],
        cantidadEsperada: '1',
        cantidadCorreoAceptadoEsperada: '2'
      }, { conexion });
      await conexion.execute('DELETE FROM monitores WHERE id=?', [ids.monitorId]);
      return preparado;
    }
  );
  assert.deepEqual(resumen(resultado), {
    eliminadas: '1', correoAceptadoPreservadas: '2'
  });
  await verificarPreservadas(sql, resultado.idsCorreoAceptadoPreservadas, {
    triggerNulo: false,
    monitorNulo: true
  });
}

async function verificarCorrupcionBloquea(sql) {
  const ids = await prepararCaso(sql);
  const corruptaId = await insertarId(sql, `
    INSERT INTO ejecuciones_triggers (
      asignacion_trigger_monitor_id,trigger_id,monitor_id,
      evento_disparo,estado_ejecucion,tipo_trigger,trigger_nombre,
      codigo_resultado,payload_respuesta,iniciado_en_utc,finalizado_en_utc
    ) VALUES (?,?,?,'apertura_alerta','ok','correo','Corrupta 52711c',
      'correo_notificacion_aceptada_completa',JSON_OBJECT('resultado','aceptada'),
      UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))
  `, [ids.asignacionId, ids.triggerId, ids.monitorId]);
  const frontera = new FronteraTransaccionalLocal(sql);
  await assert.rejects(
    frontera.ejecutar(async (conexion) => {
      const repositorio = new RepositorioPreparacionBajaEjecucionesTriggerCorreoSql();
      await repositorio.prepararPorMonitorEnTransaccion(ids.monitorId, { conexion });
      await conexion.execute('DELETE FROM monitores WHERE id=?', [ids.monitorId]);
    }),
    (error) => error.codigo === 'ejecucion_correo_aceptada_sin_arbol'
  );
  assert.equal(await contarId(sql, 'monitores', ids.monitorId), 1);
  assert.equal(await contarId(sql, 'ejecuciones_triggers', corruptaId), 1);
  assert.equal(await contarId(sql, 'ejecuciones_triggers', ids.rechazoId), 1,
    'El rechazo eliminable debe reaparecer tras el rollback completo.');
}

async function prepararCaso(sql) {
  const claveCaso = randomBytes(32).toString('hex');
  const { salidaIds } = await prepararEntorno(sql, {
    claveIdempotencia: claveCaso,
    prefijoMessageId: randomBytes(4).toString('hex')
  });
  const [fila] = await sql.consultar(`
    SELECT c.ejecucion_trigger_id,n.id notificacion_id,
           e.trigger_id,e.monitor_id,e.asignacion_trigger_monitor_id
      FROM cola_correos_salida c
      INNER JOIN notificaciones_triggers_correo n
        ON n.id=c.notificacion_trigger_correo_id
      INNER JOIN ejecuciones_triggers e ON e.id=c.ejecucion_trigger_id
     WHERE c.id=?
  `, [salidaIds[0]]);
  const rechazoId = await insertarId(sql, `
    INSERT INTO ejecuciones_triggers (
      asignacion_trigger_monitor_id,trigger_id,monitor_id,
      evento_disparo,estado_ejecucion,tipo_trigger,trigger_nombre,
      codigo_resultado,payload_respuesta,iniciado_en_utc,finalizado_en_utc
    ) VALUES (?,?,?,'apertura_alerta','error','correo','Rechazo 52711c',
      'correo_sin_destinatarios_admitidos',JSON_OBJECT('resultado','rechazado'),
      UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))
  `, [fila.asignacion_trigger_monitor_id, fila.trigger_id, fila.monitor_id]);
  const resultadoRechazoId = await insertarId(sql, `
    INSERT INTO resultados_destinatarios_triggers_correo (
      ejecucion_trigger_id,clave_procedencia,tipo,email_manual,
      email_manual_canonico,normalizacion_buzon_version,estado_observado,
      codigo_inicial,creada_en_utc
    ) VALUES (?,UNHEX(SHA2(UUID(),256)),'manual','malo@example.test',
      'malo@example.test','buzon@1','activa','email_invalido',UTC_TIMESTAMP(3))
  `, [rechazoId]);
  const purgadaId = await insertarId(sql, `
    INSERT INTO ejecuciones_triggers (
      asignacion_trigger_monitor_id,trigger_id,monitor_id,
      evento_disparo,estado_ejecucion,tipo_trigger,trigger_nombre,
      codigo_resultado,payload_respuesta,iniciado_en_utc,finalizado_en_utc
    ) VALUES (?,?,?,'apertura_alerta','ok','correo','Purgada 52711c',
      'correo_notificacion_aceptada_completa',
      JSON_OBJECT('detalle_correo_estado','purgado'),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))
  `, [fila.asignacion_trigger_monitor_id, fila.trigger_id, fila.monitor_id]);
  return {
    triggerId: String(fila.trigger_id),
    monitorId: String(fila.monitor_id),
    asignacionId: String(fila.asignacion_trigger_monitor_id),
    ejecucionAceptadaId: String(fila.ejecucion_trigger_id),
    notificacionId: String(fila.notificacion_id),
    rechazoId: String(rechazoId),
    resultadoRechazoId: String(resultadoRechazoId),
    purgadaId: String(purgadaId)
  };
}

async function verificarPreservadas(sql, ids, { triggerNulo, monitorNulo }) {
  assert.equal(ids.length, 2);
  const marcadores = ids.map(() => '?').join(',');
  const filas = await sql.consultar(`
    SELECT id,trigger_id,monitor_id,asignacion_trigger_monitor_id
      FROM ejecuciones_triggers WHERE id IN (${marcadores}) ORDER BY id
  `, ids);
  assert.equal(filas.length, 2);
  for (const fila of filas) {
    assert.equal(fila.trigger_id === null, triggerNulo);
    assert.equal(fila.monitor_id === null, monitorNulo);
    assert.equal(fila.asignacion_trigger_monitor_id, null);
  }
}

function resumen(resultado) {
  return {
    eliminadas: resultado.eliminadas,
    correoAceptadoPreservadas: resultado.correoAceptadoPreservadas
  };
}

async function contarId(sql, tabla, id) {
  const [fila] = await sql.consultar(
    `SELECT COUNT(*) total FROM ${tabla} WHERE id=?`,
    [id]
  );
  return Number(fila.total);
}

async function insertarId(sql, sentencia, parametros = []) {
  const [resultado] = await sql.ejecutar(sentencia, parametros);
  return String(resultado.insertId);
}
