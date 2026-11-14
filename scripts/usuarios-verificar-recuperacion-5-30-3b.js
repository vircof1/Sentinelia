import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import { RepositorioAuditoria }
  from '../paquetes/auditoria/src/RepositorioAuditoria.js';
import { generarUuidV7Auditoria, uuidV7AuditoriaABytes }
  from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import { DENYLIST_TABLAS_SCOPE_ORGANIZATIVO }
  from '../paquetes/jerarquia-organizativa/src/CatalogoScopeOrganizativo.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones }
  from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import { construirIntencionAuditoriaEmisionRecuperacionPassword }
  from '../paquetes/usuarios/src/EventosAuditoriaRecuperacionPassword.js';
import { crearProveedorCompatibilidadRecuperacionPasswordEmailCerrado }
  from '../paquetes/usuarios/src/ProveedorCompatibilidadRecuperacionPasswordEmail.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';


await main();

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true, '5.30.3b necesita MariaDB real.');
  assert.ok(DENYLIST_TABLAS_SCOPE_ORGANIZATIVO.includes(
    'identidades_justificantes_correos_recuperacion_password'
  ));
  const administrador = new ClienteSql(configuracion.sql);
  const nombre = `sentinelia_fixture_5303b_${randomBytes(5).toString('hex')}`;
  let sql;
  try {
    await administrador.ejecutar(
      `CREATE DATABASE ${administrador.escaparIdentificador(nombre)} ` +
      'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
    );
    sql = new ClienteSql({ ...configuracion.sql, baseDatos: nombre });
    const ejecutor = crearEjecutor(sql);
    await ejecutor.ejecutarPendientes();
    const historicas = await sembrarHistoricas(sql);
    const antes = await fotografiarHistoricas(sql, historicas);
    await ejecutor.ejecutarPendientes();
    assert.deepEqual(await fotografiarHistoricas(sql, historicas), antes);
    await verificarEsquemaRecuperacion(sql);
    await verificarAuditoriaPersistible(sql);
    await verificarGateCerrado();
    await ejecutarPendientesSinReaplicar(ejecutor);
    console.log(
      '[usuarios] OK 5.30.3b: esquema=inicial reejecucion=estable historico=inalterado ' +
      'preparada=no_reclamable proyeccion=privada_cascade descarte=terminal ' +
      'auditoria=sql_compatible rollback=atomico gate=cerrado'
    );
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(nombre)}`
    ).catch(() => {});
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

async function ejecutarPendientesSinReaplicar(ejecutor) {
  const primera = await ejecutor.ejecutarPendientes();
  assert.equal(primera.integridad.ok, true);
  const segunda = await ejecutor.ejecutarPendientes();
  assert.equal(segunda.integridad.ok, true);
  assert.equal(segunda.pendientesAplicadas, 0);
}

async function sembrarHistoricas(sql) {
  const [legacy] = await sql.ejecutar(
    `INSERT INTO cola_correos_salida (
       destinatario_email,remitente_email,asunto,cuerpo_texto,estado,intentos,
       proximo_intento_en
     ) VALUES (
       'legacy@example.test','sender@example.test','Legacy','Cuerpo legacy',
       'pendiente',0,UTC_TIMESTAMP(3)
     )`
  );
  const [prueba] = await sql.ejecutar(
    `INSERT INTO cola_correos_salida (
       origen_tipo,productor_version,destinatario_email,
       normalizacion_buzon_version,modo_remitente,remitente_email,
       asunto,cuerpo_texto,smtp_message_id,estado,intentos,proximo_intento_en
     ) VALUES (
       'prueba','sql@1','prueba@example.test','buzon@1','fotografiado',
       'sender@example.test','Prueba SQL','Cuerpo prueba',?,'pendiente',0,
       UTC_TIMESTAMP(3)
     )`,
    [`<5303b-${randomBytes(12).toString('hex')}@correo.test>`]
  );
  return [String(legacy.insertId), String(prueba.insertId)];
}

async function fotografiarHistoricas(sql, ids) {
  return sql.consultar(
    `SELECT id,origen_tipo,productor_version,destinatario_email,
            remitente_email,asunto,cuerpo_texto,estado,intentos
       FROM cola_correos_salida WHERE id IN (?,?) ORDER BY id`,
    ids
  );
}

async function verificarEsquemaRecuperacion(sql) {
  const datos = datosSalidaRecuperacion();
  const conexion = await sql.obtenerConexion();
  try {
    await conexion.beginTransaction();
    const salidaId = await insertarPreparada(conexion, datos);
    await conexion.execute(
      `INSERT INTO identidades_justificantes_correos_recuperacion_password
         (salida_correo_id,usuario_id) VALUES (?,530301),(?,530302)`,
      [salidaId, salidaId]
    );
    await conexion.rollback();
    const [ausentes] = await conexion.execute(
      `SELECT COUNT(*) total
         FROM cola_correos_salida
        WHERE solicitud_recuperacion_password_id=?`,
      [datos.solicitudId]
    );
    assert.equal(Number(ausentes[0].total), 0);
  } finally {
    await rollbackSeguro(conexion);
    conexion.release();
  }

  const conexionCommit = await sql.obtenerConexion();
  let id;
  try {
    await conexionCommit.beginTransaction();
    id = await insertarPreparada(conexionCommit, datos);
    await conexionCommit.execute(
      `INSERT INTO identidades_justificantes_correos_recuperacion_password
         (salida_correo_id,usuario_id) VALUES (?,530301),(?,530302)`,
      [id, id]
    );
    await conexionCommit.commit();
  } finally {
    await rollbackSeguro(conexionCommit);
    conexionCommit.release();
  }

  await assert.rejects(
    sql.ejecutar(
      `UPDATE cola_correos_salida
          SET estado='reclamada',estado_previo_reclamacion='pendiente',
              claim_id=UNHEX(REPEAT('11',32)),propietario_claim='fixture',
              lease_token=UNHEX(REPEAT('22',32)),
              lease_expira_utc=TIMESTAMPADD(SECOND,60,UTC_TIMESTAMP(3)),
              reclamada_en_utc=UTC_TIMESTAMP(3)
        WHERE id=?`,
      [id]
    ),
    /CONSTRAINT|recuperacion_preparacion/iu
  );
  await sql.ejecutar(
    `UPDATE cola_correos_salida
        SET estado='pendiente',cuerpo_texto='Cuerpo final con enlace',
            material_preparacion_recuperacion_password=NULL,
            proximo_intento_en=UTC_TIMESTAMP(3)
      WHERE id=?`,
    [id]
  );
  await sql.ejecutar(
    `UPDATE cola_correos_salida
        SET estado='descartada',causa_descarte='autoridad_buzon_retirada',
            codigo_resultado='autoridad_buzon_retirada',
            fecha_terminal_utc=UTC_TIMESTAMP(3),proximo_intento_en=NULL
      WHERE id=?`,
    [id]
  );
  await assert.rejects(
    sql.ejecutar(
      `UPDATE cola_correos_salida
          SET estado='pendiente',causa_descarte=NULL,fecha_terminal_utc=NULL,
              proximo_intento_en=UTC_TIMESTAMP(3) WHERE id=?`,
      [id]
    ),
    /terminal no puede reabrirse/iu
  );
  await assert.rejects(
    sql.ejecutar(
      `INSERT INTO cola_correos_salida (
         origen_tipo,productor_version,destinatario_email,modo_remitente,
         asunto,cuerpo_texto,smtp_message_id,estado,intentos,proximo_intento_en
       ) VALUES (
         'recuperacion_password','sql@1','invalido@example.test',
         'configuracion_actual','Invalida','Cuerpo',?,'pendiente',0,
         UTC_TIMESTAMP(3)
       )`,
      [`<invalido-${randomBytes(8).toString('hex')}@correo.test>`]
    ),
    /CONSTRAINT|chk_cola_correos/iu
  );
  const [antesBorrado] = await sql.consultar(
    `SELECT COUNT(*) total
       FROM identidades_justificantes_correos_recuperacion_password
      WHERE salida_correo_id=?`,
    [id]
  );
  assert.equal(Number(antesBorrado.total), 2);
  await sql.ejecutar('DELETE FROM cola_correos_salida WHERE id=?', [id]);
  const [despuesBorrado] = await sql.consultar(
    `SELECT COUNT(*) total
       FROM identidades_justificantes_correos_recuperacion_password
      WHERE salida_correo_id=?`,
    [id]
  );
  assert.equal(Number(despuesBorrado.total), 0);
}

function datosSalidaRecuperacion() {
  return {
    solicitudId: uuidV7AuditoriaABytes(generarUuidV7Auditoria()),
    eventoEmisionId: uuidV7AuditoriaABytes(generarUuidV7Auditoria()),
    operacion: randomBytes(32),
    buzon: randomBytes(32),
    messageId: `<5303b-${randomBytes(12).toString('hex')}@correo.test>`
  };
}

async function insertarPreparada(conexion, datos) {
  const [resultado] = await conexion.execute(
    `INSERT INTO cola_correos_salida (
       origen_tipo,productor_version,proposito_recuperacion_password,
       solicitud_recuperacion_password_id,
       evento_emision_recuperacion_password_id,
       clave_operacion_recuperacion_password_sha256,direccion_ip_origen,
       material_preparacion_recuperacion_password,destinatario_email,
       normalizacion_buzon_version,clave_buzon_sha256,modo_remitente,
       asunto,cuerpo_texto,smtp_message_id,estado,intentos,proximo_intento_en
     ) VALUES (
       'recuperacion_password','sql@1','transportar_solicitud',?,?,?,?,?,
       'recuperacion@example.test','buzon@1',?,'configuracion_actual',
       'Recuperación',NULL,?,'preparada',0,NULL
     )`,
    [
      datos.solicitudId, datos.eventoEmisionId, datos.operacion, '203.0.113.8',
      JSON.stringify({ token: 'solo-frontera-confiable', plantilla: 'v1' }),
      datos.buzon, datos.messageId
    ]
  );
  return String(resultado.insertId);
}

async function verificarAuditoriaPersistible(sql) {
  const ids = {
    solicitudId: generarUuidV7Auditoria(),
    eventoEmisionId: generarUuidV7Auditoria(),
    eventoConsumoId: generarUuidV7Auditoria()
  };
  const intencion = construirIntencionAuditoriaEmisionRecuperacionPassword({
    ...ids,
    buzonCanonico: 'auditoria@example.test',
    direccionIp: '203.0.113.9',
    efectivoEnUtc: new Date().toISOString()
  });
  const resultado = await new RepositorioAuditoria(sql).incorporarAtomico([intencion]);
  assert.equal(resultado.eventos[0].estado, 'incorporado');
}

async function verificarGateCerrado() {
  const estado = await crearProveedorCompatibilidadRecuperacionPasswordEmailCerrado()
    .evaluarActivacion();
  assert.equal(estado.compatible, false);
}

async function rollbackSeguro(conexion) {
  try {
    await conexion.rollback();
  } catch {
    // Conserva la causa original.
  }
}
