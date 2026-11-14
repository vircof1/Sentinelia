import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  bytesAUuidV7Auditoria,
  generarUuidV7Auditoria,
  uuidV7AuditoriaABytes
} from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import { RepositorioAlertasActivasMonitor } from '../paquetes/monitores/src/RepositorioAlertasActivasMonitor.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones } from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

const configuracion = obtenerConfiguracionAplicacion();
const nombreBase = `sentinelia_alertas521_${Date.now()}_${process.pid}`;

async function main() {
  assert.equal(
    configuracion.sql.estaCompleta,
    true,
    'La verificación 5.21.4i requiere SQL local.'
  );
  let clienteSql = null;
  let errorPrincipal = null;
  try {
    clienteSql = await prepararBaseTemporal();
    const fixture = await crearAlertasIniciales(clienteSql);
    const eventosAntes = await contarEventosAuditoria(clienteSql);
    const identidadesAntes = await clienteSql.consultar(
      'SELECT monitor_id, alerta_auditoria_id FROM alertas_activas_monitores ORDER BY monitor_id'
    );
    await ejecutarMigraciones(clienteSql);
    assert.deepEqual(await clienteSql.consultar(
      'SELECT monitor_id, alerta_auditoria_id FROM alertas_activas_monitores ORDER BY monitor_id'
    ), identidadesAntes, 'El segundo arranque conserva las identidades existentes.');
    await verificarIdentidadesYVencimientos(clienteSql, fixture, eventosAntes);
    await verificarIdentidadDeCiclo(clienteSql, fixture);
    await verificarProgramaciones(clienteSql, fixture);
  } catch (error) {
    errorPrincipal = error;
  } finally {
    try {
      await clienteSql?.cerrar();
      await eliminarBaseTemporal();
    } catch (errorLimpieza) {
      if (!errorPrincipal) throw errorLimpieza;
      console.error('[alertas] Error adicional limpiando la verificación 5.21.4i');
      console.error(errorLimpieza);
    }
  }
  if (errorPrincipal) throw errorPrincipal;
  console.log(
    '[alertas] OK 5.21.4i: esquema=inicial identidad=uuidv7 reinicio=sin_eventos ' +
    'vencimientos=fuera_outbox leases=recuperables neutralizacion=idempotente'
  );
}

async function prepararBaseTemporal() {
  validarNombreBase(nombreBase);
  const clienteSql = new ClienteSql({
    ...configuracion.sql,
    baseDatos: nombreBase
  });
  await clienteSql.crearBaseDatosSiNoExiste();
  await ejecutarMigraciones(clienteSql);
  const segunda = await ejecutarMigraciones(clienteSql);
  assert.equal(segunda.pendientesAplicadas, 0);
  return clienteSql;
}

async function ejecutarMigraciones(clienteSql) {
  return new EjecutorMigraciones({
    clienteSql,
    repositorioMigraciones: new RepositorioMigraciones(clienteSql),
    rutaMigraciones: obtenerRutaMigraciones()
  }).ejecutarPendientes();
}

async function crearAlertasIniciales(clienteSql) {
  const alias = `alertas-${Date.now()}-${process.pid}`.slice(0, 120);
  const [tenant] = await clienteSql.ejecutar(
    'INSERT INTO tenants (nombre, alias) VALUES (?, ?)',
    ['Tenant alertas 5.21', alias]
  );
  const [empresa] = await clienteSql.ejecutar(
    'INSERT INTO empresas (tenant_id, nombre, alias) VALUES (?, ?, ?)',
    [tenant.insertId, 'Empresa alertas 5.21', alias]
  );
  const [sitio] = await clienteSql.ejecutar(
    'INSERT INTO sitios (tenant_id, empresa_id, nombre, alias) VALUES (?, ?, ?, ?)',
    [tenant.insertId, empresa.insertId, 'Sitio alertas 5.21', alias]
  );
  const monitores = [];
  for (const nombre of ['Futura', 'Vencida', 'Sin descarte', 'Recaída']) {
    const [monitor] = await clienteSql.ejecutar(
      `INSERT INTO monitores (
         tenant_id, empresa_id, sitio_id, nombre, tipo, activo, configuracion
       ) VALUES (?, ?, ?, ?, 'tcp', 1, JSON_OBJECT())`,
      [tenant.insertId, empresa.insertId, sitio.insertId, `Monitor ${nombre}`]
    );
    monitores.push(monitor.insertId);
  }
  const ahora = Date.now();
  const futura = fechaSql(new Date(ahora + 60 * 60 * 1000));
  const vencida = fechaSql(new Date(ahora - 60 * 60 * 1000));
  await insertarAlertaInicial(clienteSql, {
    monitorId: monitores[0], tenantId: tenant.insertId, empresaId: empresa.insertId,
    sitioId: sitio.insertId, descartadaHastaUtc: futura
  });
  await insertarAlertaInicial(clienteSql, {
    monitorId: monitores[1], tenantId: tenant.insertId, empresaId: empresa.insertId,
    sitioId: sitio.insertId, descartadaHastaUtc: vencida
  });
  await insertarAlertaInicial(clienteSql, {
    monitorId: monitores[2], tenantId: tenant.insertId, empresaId: empresa.insertId,
    sitioId: sitio.insertId, descartada: false
  });
  return Object.freeze({
    tenantId: tenant.insertId,
    empresaId: empresa.insertId,
    sitioId: sitio.insertId,
    monitorFuturo: monitores[0],
    monitorVencido: monitores[1],
    monitorSinDescarte: monitores[2],
    monitorRecaida: monitores[3],
    futura,
    vencida
  });
}

async function insertarAlertaInicial(clienteSql, {
  monitorId,
  tenantId,
  empresaId,
  sitioId,
  descartada = true,
  descartadaHastaUtc = null
}) {
  const identidad = uuidV7AuditoriaABytes(generarUuidV7Auditoria());
  await clienteSql.ejecutar(
    `INSERT INTO alertas_activas_monitores (
       alerta_auditoria_id, monitor_id, tenant_id, empresa_id, sitio_id, version_catalogo,
       tipo_monitor, estado_alerta, estado_detectado,
       codigo_ultimo_resultado, mensaje_ultimo_resultado,
       valido_desde_utc, ultima_confirmacion_utc, ultima_ejecucion_utc,
       contador_repeticiones, payload_alerta, descartada_dashboard,
       motivo_descarte, descartada_por_usuario_id,
       descartada_en_utc, descartada_hasta_utc
     ) VALUES (
       ?, ?, ?, ?, ?, 'actual-v1', 'tcp', 'activa', 'fallo',
       'timeout', 'Sin respuesta.', UTC_TIMESTAMP(), UTC_TIMESTAMP(),
       UTC_TIMESTAMP(), 1, NULL, ?, ?, NULL,
       ${descartada ? 'UTC_TIMESTAMP()' : 'NULL'}, ?
     )`,
    [
      identidad, monitorId, tenantId, empresaId, sitioId,
      descartada ? 1 : 0,
      descartada ? 'Descarte adoptado.' : '',
      descartadaHastaUtc
    ]
  );
  if (descartada && descartadaHastaUtc) {
    await clienteSql.ejecutar(
      `INSERT INTO vencimientos_descarte_alertas (
         alerta_auditoria_id, monitor_id, descartada_hasta_utc, estado,
         proximo_intento_utc, creada_en_utc, actualizada_en_utc
       ) VALUES (?, ?, ?, 'pendiente', ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [identidad, monitorId, descartadaHastaUtc, descartadaHastaUtc]
    );
  }
}

async function verificarIdentidadesYVencimientos(clienteSql, fixture, eventosAntes) {
  const alertas = await clienteSql.consultar(
    `SELECT monitor_id, alerta_auditoria_id
     FROM alertas_activas_monitores ORDER BY monitor_id`
  );
  assert.equal(alertas.length, 3);
  const ids = alertas.map(({ alerta_auditoria_id: id }) => bytesAUuidV7Auditoria(id));
  assert.equal(new Set(ids).size, 3, 'Cada ciclo necesita una identidad distinta.');
  assert.equal(await contarEventosAuditoria(clienteSql), eventosAntes, 'El reinicio no inventa aperturas.');

  const programaciones = await clienteSql.consultar(
    `SELECT monitor_id, alerta_auditoria_id, descartada_hasta_utc,
            proximo_intento_utc, estado
     FROM vencimientos_descarte_alertas ORDER BY monitor_id`
  );
  assert.equal(programaciones.length, 2, 'Solo se programan descartes temporales.');
  assert.equal(programaciones.every(({ estado }) => estado === 'pendiente'), true);
  assert.equal(
    programaciones.every(({ alerta_auditoria_id: id }) =>
      ids.includes(bytesAUuidV7Auditoria(id))
    ),
    true
  );
  const vencida = programaciones.find(({ monitor_id: id }) => Number(id) === fixture.monitorVencido);
  assert.ok(new Date(vencida.proximo_intento_utc).getTime() <= Date.now());

  const foraneas = await clienteSql.consultar(
    `SELECT CONSTRAINT_NAME
     FROM information_schema.REFERENTIAL_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE()
       AND TABLE_NAME = 'vencimientos_descarte_alertas'`
  );
  assert.equal(foraneas.length, 0, 'El vencimiento conserva ids escalares sin FK destructiva.');
  assert.equal(
    (await clienteSql.consultar('SELECT COUNT(*) total FROM outbox_auditoria_runtime'))[0].total,
    0,
    'Una fecha futura no ocupa el FIFO outbox.'
  );
}

async function verificarIdentidadDeCiclo(clienteSql, fixture) {
  const repositorio = new RepositorioAlertasActivasMonitor(clienteSql);
  const entrada = alertaNueva(fixture);
  await repositorio.guardarAlertas([entrada]);
  const primera = await repositorio.buscarPorMonitorId(fixture.monitorRecaida);
  assert.ok(primera.alertaAuditoriaId);
  assert.equal(primera.serializarResumen().alertaAuditoriaId, primera.alertaAuditoriaId);

  await repositorio.guardarAlertas([{ ...entrada, contadorRepeticiones: 2 }]);
  const confirmada = await repositorio.buscarPorMonitorId(fixture.monitorRecaida);
  assert.equal(confirmada.alertaAuditoriaId, primera.alertaAuditoriaId, 'Una confirmación conserva el ciclo.');

  await assert.rejects(
    () => clienteSql.ejecutar(
      `UPDATE alertas_activas_monitores SET alerta_auditoria_id = ?
       WHERE monitor_id = ?`,
      [uuidV7AuditoriaABytes(generarUuidV7Auditoria()), fixture.monitorRecaida]
    ),
    /inmutable durante todo el ciclo/
  );

  await repositorio.eliminarPorMonitorIds([fixture.monitorRecaida]);
  await repositorio.guardarAlertas([entrada]);
  const recaida = await repositorio.buscarPorMonitorId(fixture.monitorRecaida);
  assert.notEqual(recaida.alertaAuditoriaId, primera.alertaAuditoriaId, 'Una recaída abre otra identidad.');

  const uuidInvalido = Buffer.alloc(16, 0);
  await assert.rejects(
    () => clienteSql.ejecutar(
      `UPDATE alertas_activas_monitores SET alerta_auditoria_id = ?
       WHERE monitor_id = ?`,
      [uuidInvalido, fixture.monitorRecaida]
    ),
    /CONSTRAINT|inmutable/
  );
}

async function verificarProgramaciones(clienteSql, fixture) {
  await crearSegundoVencimientoElegible(clienteSql, fixture);
  await verificarReclamacionConcurrente(clienteSql);

  const [programacionVencida] = await clienteSql.consultar(
    `SELECT id, alerta_auditoria_id
     FROM vencimientos_descarte_alertas
     WHERE monitor_id = ? AND estado = 'pendiente'`,
    [fixture.monitorVencido]
  );
  await reclamarYRecuperarLease(clienteSql, programacionVencida.id);
  await consolidarVencimiento(clienteSql, fixture.monitorVencido, programacionVencida.id);
  await assert.rejects(
    () => clienteSql.ejecutar(
      `DELETE FROM vencimientos_descarte_alertas WHERE id = ?`,
      [programacionVencida.id]
    ),
    /incorporarse antes de limpiar/
  );
  const eventoId = uuidV7AuditoriaABytes(generarUuidV7Auditoria());
  await clienteSql.ejecutar(
    `UPDATE vencimientos_descarte_alertas
     SET evento_resultado_id = ?, actualizada_en_utc = UTC_TIMESTAMP(3)
     WHERE id = ?`,
    [eventoId, programacionVencida.id]
  );
  await verificarDeleteReversible(clienteSql, programacionVencida.id);

  const [programacionFutura] = await clienteSql.consultar(
    `SELECT id FROM vencimientos_descarte_alertas
     WHERE monitor_id = ? AND estado = 'pendiente'`,
    [fixture.monitorFuturo]
  );
  await neutralizarConAlerta(clienteSql, {
    monitorId: fixture.monitorFuturo,
    programacionId: programacionFutura.id,
    causa: 'reversion'
  });
  const [neutralizada] = await clienteSql.consultar(
    'SELECT estado, causa_terminal, obligacion_outbox_id FROM vencimientos_descarte_alertas WHERE id = ?',
    [programacionFutura.id]
  );
  assert.deepEqual(
    { estado: neutralizada.estado, causa: neutralizada.causa_terminal, outbox: neutralizada.obligacion_outbox_id },
    { estado: 'neutralizada', causa: 'reversion', outbox: null }
  );

  const [ausente] = await clienteSql.consultar(
    `SELECT id FROM vencimientos_descarte_alertas
     WHERE monitor_id = ? AND estado = 'pendiente'`,
    [fixture.monitorSinDescarte]
  );
  await clienteSql.ejecutar(
    'DELETE FROM alertas_activas_monitores WHERE monitor_id = ?',
    [fixture.monitorSinDescarte]
  );
  await clienteSql.ejecutar(
    `UPDATE vencimientos_descarte_alertas
     SET estado = 'neutralizada', causa_terminal = 'ciclo_ausente',
         proximo_intento_utc = NULL, terminada_en_utc = UTC_TIMESTAMP(3),
         actualizada_en_utc = UTC_TIMESTAMP(3)
     WHERE id = ? AND estado = 'pendiente'`,
    [ausente.id]
  );
  assert.equal(
    (await clienteSql.consultar(
      'SELECT estado FROM vencimientos_descarte_alertas WHERE id = ?',
      [ausente.id]
    ))[0].estado,
    'neutralizada'
  );
}

async function crearSegundoVencimientoElegible(clienteSql, fixture) {
  const hasta = fechaSql(new Date(Date.now() - 30 * 60 * 1000));
  await clienteSql.ejecutar(
    `UPDATE alertas_activas_monitores
     SET descartada_dashboard = 1, motivo_descarte = 'Descarte para recuperación.',
         descartada_en_utc = UTC_TIMESTAMP(), descartada_hasta_utc = ?
     WHERE monitor_id = ?`,
    [hasta, fixture.monitorSinDescarte]
  );
  const [alerta] = await clienteSql.consultar(
    'SELECT alerta_auditoria_id FROM alertas_activas_monitores WHERE monitor_id = ?',
    [fixture.monitorSinDescarte]
  );
  await clienteSql.ejecutar(
    `INSERT INTO vencimientos_descarte_alertas (
       alerta_auditoria_id, monitor_id, descartada_hasta_utc, estado,
       proximo_intento_utc, creada_en_utc, actualizada_en_utc
     ) VALUES (?, ?, ?, 'pendiente', ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
    [alerta.alerta_auditoria_id, fixture.monitorSinDescarte, hasta, hasta]
  );
  await assert.rejects(
    () => clienteSql.ejecutar(
      `INSERT INTO vencimientos_descarte_alertas (
         alerta_auditoria_id, monitor_id, descartada_hasta_utc, estado,
         proximo_intento_utc, creada_en_utc, actualizada_en_utc
       ) VALUES (?, ?, ?, 'pendiente', ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [alerta.alerta_auditoria_id, fixture.monitorSinDescarte, hasta, hasta]
    ),
    /Duplicate entry/
  );
}

async function verificarReclamacionConcurrente(clienteSql) {
  const candidatas = await clienteSql.consultar(
    `SELECT id FROM vencimientos_descarte_alertas
     WHERE estado = 'pendiente' AND proximo_intento_utc <= UTC_TIMESTAMP(3)
     ORDER BY proximo_intento_utc, id LIMIT 2`
  );
  assert.equal(candidatas.length, 2);
  const primera = await clienteSql.obtenerConexion();
  const segunda = await clienteSql.obtenerConexion();
  try {
    await primera.beginTransaction();
    await segunda.beginTransaction();
    const [fila1] = await primera.execute(
      `SELECT id FROM vencimientos_descarte_alertas
       WHERE id = ? AND estado = 'pendiente'
       FOR UPDATE SKIP LOCKED`,
      [candidatas[0].id]
    );
    const [fila2] = await segunda.execute(
      `SELECT id FROM vencimientos_descarte_alertas
       WHERE id IN (?, ?) AND estado = 'pendiente'
       ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED`,
      [candidatas[0].id, candidatas[1].id]
    );
    assert.equal(fila1.length, 1);
    assert.equal(fila2.length, 1);
    assert.notEqual(String(fila1[0].id), String(fila2[0].id));
    await primera.rollback();
    await segunda.rollback();
  } finally {
    primera.release();
    segunda.release();
  }
}

async function reclamarYRecuperarLease(clienteSql, id) {
  await clienteSql.ejecutar(
    `UPDATE vencimientos_descarte_alertas
     SET instancia_id = 'worker-caido', lease_token = ?,
         lease_expira_utc = TIMESTAMPADD(SECOND, -1, UTC_TIMESTAMP(3)),
         fencing_token = 1, intentos = 1, actualizada_en_utc = UTC_TIMESTAMP(3)
     WHERE id = ?`,
    [randomBytes(32), id]
  );
  await clienteSql.ejecutar(
    `UPDATE vencimientos_descarte_alertas
     SET instancia_id = 'worker-recuperado', lease_token = ?,
         lease_expira_utc = TIMESTAMPADD(SECOND, 30, UTC_TIMESTAMP(3)),
         fencing_token = 2, intentos = 2, actualizada_en_utc = UTC_TIMESTAMP(3)
     WHERE id = ? AND lease_expira_utc <= UTC_TIMESTAMP(3)`,
    [randomBytes(32), id]
  );
  const [fila] = await clienteSql.consultar(
    'SELECT instancia_id, fencing_token, intentos FROM vencimientos_descarte_alertas WHERE id = ?',
    [id]
  );
  assert.equal(fila.instancia_id, 'worker-recuperado');
  assert.equal(String(fila.fencing_token), '2');
  assert.equal(Number(fila.intentos), 2);
}

async function consolidarVencimiento(clienteSql, monitorId, programacionId) {
  const conexion = await clienteSql.obtenerConexion();
  try {
    await conexion.beginTransaction();
    const [alerta] = await conexion.execute(
      `UPDATE alertas_activas_monitores
       SET descartada_dashboard = 0, motivo_descarte = '',
           descartada_por_usuario_id = NULL, descartada_en_utc = NULL,
           descartada_hasta_utc = NULL
       WHERE monitor_id = ? AND descartada_dashboard = 1`,
      [monitorId]
    );
    assert.equal(alerta.affectedRows, 1);
    await conexion.execute(
      `UPDATE vencimientos_descarte_alertas
       SET estado = 'consolidada', causa_terminal = 'vencimiento',
           proximo_intento_utc = NULL, instancia_id = NULL, lease_token = NULL,
           lease_expira_utc = NULL, obligacion_outbox_id = 5001,
           terminada_en_utc = UTC_TIMESTAMP(3), actualizada_en_utc = UTC_TIMESTAMP(3)
       WHERE id = ? AND estado = 'pendiente'`,
      [programacionId]
    );
    await conexion.commit();
  } catch (error) {
    await rollbackSeguro(conexion);
    throw error;
  } finally {
    conexion.release();
  }
}

async function neutralizarConAlerta(clienteSql, { monitorId, programacionId, causa }) {
  const conexion = await clienteSql.obtenerConexion();
  try {
    await conexion.beginTransaction();
    await conexion.execute(
      `UPDATE alertas_activas_monitores
       SET descartada_dashboard = 0, motivo_descarte = '',
           descartada_por_usuario_id = NULL, descartada_en_utc = NULL,
           descartada_hasta_utc = NULL
       WHERE monitor_id = ?`,
      [monitorId]
    );
    await conexion.execute(
      `UPDATE vencimientos_descarte_alertas
       SET estado = 'neutralizada', causa_terminal = ?,
           proximo_intento_utc = NULL, instancia_id = NULL, lease_token = NULL,
           lease_expira_utc = NULL, terminada_en_utc = UTC_TIMESTAMP(3),
           actualizada_en_utc = UTC_TIMESTAMP(3)
       WHERE id = ? AND estado = 'pendiente'`,
      [causa, programacionId]
    );
    await conexion.commit();
  } catch (error) {
    await rollbackSeguro(conexion);
    throw error;
  } finally {
    conexion.release();
  }
}

async function verificarDeleteReversible(clienteSql, id) {
  const conexion = await clienteSql.obtenerConexion();
  try {
    await conexion.beginTransaction();
    const [resultado] = await conexion.execute(
      'DELETE FROM vencimientos_descarte_alertas WHERE id = ?',
      [id]
    );
    assert.equal(resultado.affectedRows, 1);
    await conexion.rollback();
  } catch (error) {
    await rollbackSeguro(conexion);
    throw error;
  } finally {
    conexion.release();
  }
}

function alertaNueva(fixture) {
  const ahora = new Date().toISOString();
  return {
    monitorId: fixture.monitorRecaida,
    tenantId: fixture.tenantId,
    empresaId: fixture.empresaId,
    sitioId: fixture.sitioId,
    versionCatalogo: 'ciclo-v1',
    tipoMonitor: 'tcp',
    estadoAlerta: 'activa',
    estadoDetectado: 'fallo',
    codigoUltimoResultado: 'timeout',
    mensajeUltimoResultado: 'Sin respuesta.',
    validoDesdeUtc: ahora,
    ultimaConfirmacionUtc: ahora,
    ultimaEjecucionUtc: ahora,
    contadorRepeticiones: 1,
    payloadAlerta: null
  };
}

async function contarEventosAuditoria(clienteSql) {
  const [fila] = await clienteSql.consultar('SELECT COUNT(*) total FROM eventos_auditoria');
  return Number(fila.total);
}

function fechaSql(fecha) {
  return fecha.toISOString().slice(0, 19).replace('T', ' ');
}

async function eliminarBaseTemporal() {
  validarNombreBase(nombreBase);
  const clienteSql = new ClienteSql(configuracion.sql);
  try {
    await clienteSql.ejecutar(`DROP DATABASE IF EXISTS \`${nombreBase}\``);
  } finally {
    await clienteSql.cerrar();
  }
}

function validarNombreBase(nombre) {
  if (!/^sentinelia_alertas521_[0-9_]{1,40}$/.test(nombre)) {
    throw new Error('El nombre de base temporal de alertas 5.21 no es seguro.');
  }
}

async function rollbackSeguro(conexion) {
  try {
    await conexion.rollback();
  } catch {
    // La excepción original conserva prioridad.
  }
}

main().catch((error) => {
  console.error('[alertas] Falló la verificación de identidad y vencimientos 5.21.4i');
  console.error(error);
  process.exitCode = 1;
});
