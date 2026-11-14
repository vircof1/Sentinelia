import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';

import { generarUuidV7Auditoria }
  from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import { ClienteSql }
  from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones }
  from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones }
  from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';


await main();

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true, '5.30b.1a necesita MariaDB real.');
  const administrador = new ClienteSql(configuracion.sql);
  const baseActualizada = nombreBase('u');
  const baseVacia = nombreBase('v');
  let sqlActualizada;
  let sqlVacia;
  try {
    await crearBase(administrador, baseActualizada);
    sqlActualizada = new ClienteSql({
      ...configuracion.sql,
      baseDatos: baseActualizada
    });
    const ejecutor = crearEjecutor(sqlActualizada);
    await ejecutor.ejecutarPendientes();
    const historicaId = await sembrarSalidaHistorica(sqlActualizada);
    const fotografia = await fotografiarSalida(sqlActualizada, historicaId);
    await ejecutor.ejecutarPendientes();
    assert.deepEqual(
      await fotografiarSalida(sqlActualizada, historicaId),
      fotografia
    );
    await verificarFormaFisica(sqlActualizada);
    await verificarNuevaProcedencia(sqlActualizada);
    const repeticion = await ejecutor.ejecutarPendientes();
    assert.equal(repeticion.pendientesAplicadas, 0);
    assert.equal(repeticion.integridad.ok, true);

    await crearBase(administrador, baseVacia);
    sqlVacia = new ClienteSql({ ...configuracion.sql, baseDatos: baseVacia });
    const instalacion = await crearEjecutor(sqlVacia).ejecutarPendientes();
    assert.ok(instalacion.pendientesAplicadas > 0);
    assert.equal(instalacion.integridad.ok, true);
    await verificarFormaFisica(sqlVacia);

    console.log(
      '[usuarios] OK 5.30b.1a: esquema=inicial instalacion+reejecucion ' +
      'historico=intacto origen=verificacion_email_perfil ' +
      'emision=uuidv7_unica operacion=agrupable preparacion=no_reclamable'
    );
  } finally {
    await sqlActualizada?.cerrar().catch(() => {});
    await sqlVacia?.cerrar().catch(() => {});
    await borrarBase(administrador, baseActualizada);
    await borrarBase(administrador, baseVacia);
    await administrador.cerrar();
  }
}

function crearEjecutor(sql) {
  return new EjecutorMigraciones({
    clienteSql: sql,
    repositorioMigraciones: new RepositorioMigraciones(sql),
    rutaMigraciones: obtenerRutaMigraciones()
  });
}

async function sembrarSalidaHistorica(sql) {
  const [resultado] = await sql.ejecutar(
    `INSERT INTO cola_correos_salida (
       origen_tipo,productor_version,destinatario_email,
       normalizacion_buzon_version,modo_remitente,remitente_email,
       asunto,cuerpo_texto,smtp_message_id,estado,intentos,proximo_intento_en
     ) VALUES (
       'prueba','sql@1','historica@example.test','buzon@1','fotografiado',
       'sender@example.test','Histórica','Cuerpo histórico',?,'pendiente',0,
       UTC_TIMESTAMP(3)
     )`,
    [`<530b1a-historica-${randomBytes(8).toString('hex')}@correo.test>`]
  );
  return String(resultado.insertId);
}

async function fotografiarSalida(sql, id) {
  const [fila] = await sql.consultar(
    `SELECT id,origen_tipo,productor_version,destinatario_email,
            normalizacion_buzon_version,modo_remitente,remitente_email,
            asunto,cuerpo_texto,smtp_message_id,estado,intentos
       FROM cola_correos_salida WHERE id=?`,
    [id]
  );
  return fila;
}

async function verificarFormaFisica(sql) {
  const columnas = await sql.consultar(
    `SELECT COLUMN_NAME,DATA_TYPE,COLUMN_TYPE,IS_NULLABLE
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cola_correos_salida'
        AND COLUMN_NAME IN (
          'operacion_email_perfil_id','emision_email_perfil_id',
          'clase_emision_email_perfil')
      ORDER BY ORDINAL_POSITION`
  );
  assert.deepEqual(columnas.map((fila) => fila.COLUMN_NAME), [
    'operacion_email_perfil_id',
    'emision_email_perfil_id',
    'clase_emision_email_perfil'
  ]);
  assert.equal(columnas[0].DATA_TYPE, 'binary');
  assert.equal(columnas[1].DATA_TYPE, 'binary');
  assert.match(columnas[2].COLUMN_TYPE, /enum\('inicial','reenvio'\)/u);
  assert.ok(columnas.every((fila) => fila.IS_NULLABLE === 'YES'));

  const indices = await sql.consultar(
    `SELECT INDEX_NAME,NON_UNIQUE,GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) columnas
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cola_correos_salida'
        AND INDEX_NAME IN (
          'uk_cola_correos_emision_email_perfil',
          'idx_cola_correos_operacion_email_perfil')
      GROUP BY INDEX_NAME,NON_UNIQUE`
  );
  const porNombre = new Map(indices.map((fila) => [fila.INDEX_NAME, fila]));
  assert.equal(Number(
    porNombre.get('uk_cola_correos_emision_email_perfil')?.NON_UNIQUE
  ), 0);
  assert.equal(
    porNombre.get('idx_cola_correos_operacion_email_perfil')?.columnas,
    'operacion_email_perfil_id,clase_emision_email_perfil,id'
  );
}

async function verificarNuevaProcedencia(sql) {
  const operacionId = randomUUID();
  const emisionInicialId = generarUuidV7Auditoria();
  const emisionReenvioId = generarUuidV7Auditoria();
  const inicialId = await insertarSalida(sql, {
    operacionId,
    emisionId: emisionInicialId,
    clase: 'inicial'
  });
  const reenvioId = await insertarSalida(sql, {
    operacionId,
    emisionId: emisionReenvioId,
    clase: 'reenvio'
  });
  const filas = await sql.consultar(
    `SELECT id,HEX(operacion_email_perfil_id) operacion,
            HEX(emision_email_perfil_id) emision,
            clase_emision_email_perfil clase,estado,proximo_intento_en
       FROM cola_correos_salida WHERE id IN (?,?) ORDER BY id`,
    [inicialId, reenvioId]
  );
  assert.equal(filas.length, 2);
  assert.equal(filas[0].operacion, uuidABytes(operacionId).toString('hex').toUpperCase());
  assert.notEqual(filas[0].emision, filas[1].emision);
  assert.deepEqual(filas.map(({ clase }) => clase), ['inicial', 'reenvio']);
  assert.ok(filas.every(({ estado }) => estado === 'preparada'));
  assert.ok(filas.every(({ proximo_intento_en }) => proximo_intento_en === null));

  await assert.rejects(
    insertarSalida(sql, {
      operacionId,
      emisionId: emisionInicialId,
      clase: 'reenvio'
    }),
    /Duplicate entry|uk_cola_correos_emision_email_perfil/iu
  );
  await assert.rejects(
    insertarSalida(sql, {
      operacionId,
      emisionId: randomUUID(),
      clase: 'inicial'
    }),
    /CONSTRAINT|chk_cola_correos/iu
  );
  await assert.rejects(
    sql.ejecutar(
      `UPDATE cola_correos_salida
          SET clase_emision_email_perfil='reenvio' WHERE id=?`,
      [inicialId]
    ),
    /identidad y el mensaje.*inmutables/iu
  );
  await assert.rejects(
    sql.ejecutar(
      `INSERT INTO cola_correos_salida (
         origen_tipo,productor_version,operacion_email_perfil_id,
         emision_email_perfil_id,clase_emision_email_perfil,
         destinatario_email,modo_remitente,remitente_email,asunto,cuerpo_texto,
         estado,intentos,proximo_intento_en
       ) VALUES (
         'prueba','legacy',?,?,?,'contaminada@example.test','fotografiado',
         'sender@example.test','Inválida','Cuerpo','pendiente',0,UTC_TIMESTAMP(3))`,
      [uuidABytes(operacionId), uuidABytes(generarUuidV7Auditoria()), 'inicial']
    ),
    /CONSTRAINT|chk_cola_correos/iu
  );

  await sql.ejecutar(
    `UPDATE cola_correos_salida
        SET estado='pendiente',proximo_intento_en=UTC_TIMESTAMP(3)
      WHERE id=?`,
    [inicialId]
  );
  const [liberada] = await sql.consultar(
    'SELECT estado,proximo_intento_en FROM cola_correos_salida WHERE id=?',
    [inicialId]
  );
  assert.equal(liberada.estado, 'pendiente');
  assert.ok(liberada.proximo_intento_en);
}

async function insertarSalida(sql, { operacionId, emisionId, clase }) {
  const [resultado] = await sql.ejecutar(
    `INSERT INTO cola_correos_salida (
       origen_tipo,productor_version,operacion_email_perfil_id,
       emision_email_perfil_id,clase_emision_email_perfil,
       destinatario_email,normalizacion_buzon_version,clave_buzon_sha256,
       modo_remitente,asunto,cuerpo_texto,smtp_message_id,estado,intentos,
       proximo_intento_en
     ) VALUES (
       'verificacion_email_perfil','sql@1',?,?,?,
       'candidato@example.test','buzon@1',UNHEX(?),'configuracion_actual',
       'Verifica tu correo','Cuerpo con enlace',?,'preparada',0,NULL
     )`,
    [
      uuidABytes(operacionId),
      uuidABytes(emisionId),
      clase,
      randomBytes(32).toString('hex'),
      `<530b1a-${randomBytes(8).toString('hex')}@correo.test>`
    ]
  );
  return String(resultado.insertId);
}

function uuidABytes(uuid) {
  return Buffer.from(String(uuid).replaceAll('-', ''), 'hex');
}

function nombreBase(sufijo) {
  return `sentinelia_fixture_530b1a_${sufijo}_${randomBytes(5).toString('hex')}`;
}

function crearBase(cliente, nombre) {
  return cliente.ejecutar(
    `CREATE DATABASE ${cliente.escaparIdentificador(nombre)} ` +
      'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
  );
}

function borrarBase(cliente, nombre) {
  return cliente.ejecutar(
    `DROP DATABASE IF EXISTS ${cliente.escaparIdentificador(nombre)}`
  ).catch(() => {});
}
