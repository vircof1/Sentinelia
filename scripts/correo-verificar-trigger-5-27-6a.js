import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import { RepositorioColaCorreo }
  from '../paquetes/correo/src/RepositorioColaCorreo.js';
import { DENYLIST_TABLAS_SCOPE_ORGANIZATIVO }
  from '../paquetes/jerarquia-organizativa/src/CatalogoScopeOrganizativo.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones }
  from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';


await main();

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true, '5.27.6a necesita MariaDB real.');
  for (const tabla of [
    'cola_correos_salida',
    'reclamaciones_correos_salida',
    'intentos_correos_salida'
  ]) assert.equal(DENYLIST_TABLAS_SCOPE_ORGANIZATIVO.includes(tabla), true);
  const administrador = new ClienteSql(configuracion.sql);
  const nombre = `sentinelia_fixture_5276a_${randomBytes(5).toString('hex')}`;
  let sql;
  try {
    await administrador.ejecutar(
      `CREATE DATABASE ${administrador.escaparIdentificador(nombre)} ` +
        'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
    );
    sql = new ClienteSql({ ...configuracion.sql, baseDatos: nombre });
    const ejecutor = crearEjecutor(sql);
    await ejecutor.ejecutarPendientes();
    const legadoId = await sembrarSalidaLegada(sql);

    await verificarConvivenciaLegada(sql, legadoId);
    await verificarSalidaSqlClaimsEIntentos(sql);
    await verificarRestriccionesOrigenYFk(sql);
    await verificarGuardCorte(sql, legadoId);
    await ejecutarPendientesSinReaplicar(ejecutor);

    console.log(
      '[correo-trigger] OK 5.27.6a: esquema=inicial productor_preparacion=aislado ' +
        'cola=origen_remitente_message_id claims=dos_fases_fencing ' +
        'intentos=historico_clasificado fk=restrict guards=inactivos_y_ejercitados'
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

async function sembrarSalidaLegada(sql) {
  const [resultado] = await sql.ejecutar(
    `INSERT INTO cola_correos_salida (
       destinatario_email, destinatario_nombre, remitente_email,
       remitente_nombre, asunto, cuerpo_texto, estado, intentos,
       proximo_intento_en, creado_por_usuario_id
     ) VALUES (
       'legacy@example.test', 'Legacy', 'sender@example.test',
       'Sender', 'Prueba legacy', 'Cuerpo legacy', 'pendiente', 0,
       UTC_TIMESTAMP(), NULL
     )`
  );
  return String(resultado.insertId);
}

async function verificarConvivenciaLegada(sql, legadoId) {
  const [legado] = await sql.consultar(
    `SELECT origen_tipo, productor_version, modo_remitente,
            notificacion_trigger_correo_id, ejecucion_trigger_id,
            clave_buzon_sha256, smtp_message_id, fencing_token
       FROM cola_correos_salida WHERE id=?`,
    [legadoId]
  );
  assert.deepEqual({
    origen: legado.origen_tipo,
    productor: legado.productor_version,
    remitente: legado.modo_remitente,
    notificacion: legado.notificacion_trigger_correo_id,
    ejecucion: legado.ejecucion_trigger_id,
    buzon: legado.clave_buzon_sha256,
    messageId: legado.smtp_message_id,
    fencing: String(legado.fencing_token)
  }, {
    origen: 'prueba', productor: 'legacy', remitente: 'fotografiado',
    notificacion: null, ejecucion: null, buzon: null, messageId: null,
    fencing: '0'
  });
  const [precision] = await sql.consultar(
    `SELECT DATETIME_PRECISION AS precision_fecha
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cola_correos_salida'
        AND COLUMN_NAME='fecha_creacion'`
  );
  assert.equal(Number(precision.precision_fecha), 3);

  const repositorio = new RepositorioColaCorreo(sql);
  const creada = await repositorio.crearPendiente({
    destinatarioEmail: 'otra-legacy@example.test',
    destinatarioNombre: null,
    remitenteEmail: 'sender@example.test',
    remitenteNombre: null,
    asunto: 'Compatibilidad legacy',
    cuerpoTexto: 'El productor antiguo sigue operativo antes del corte.',
    creadoPorUsuarioId: null
  });
  assert.equal(creada.estado, 'pendiente');
  await repositorio.registrarEnvioExitoso({
    idCorreo: creada.id,
    mensajeId: 'respuesta-proveedor',
    respuestaProveedor: '250 accepted'
  });
  const [enviada] = await sql.consultar(
    'SELECT estado,fecha_terminal_utc FROM cola_correos_salida WHERE id=?',
    [creada.id]
  );
  assert.equal(enviada.estado, 'enviado');
  assert.ok(enviada.fecha_terminal_utc instanceof Date);
}

async function verificarSalidaSqlClaimsEIntentos(sql) {
  const smtpMessageId = '<0123456789abcdefghijklmnopqrstuv@correo.test>';
  const [salida] = await sql.ejecutar(
    `INSERT INTO cola_correos_salida (
       origen_tipo, productor_version, destinatario_email,
       normalizacion_buzon_version, clave_buzon_sha256,
       modo_remitente, remitente_email, remitente_nombre,
       asunto, cuerpo_texto, smtp_message_id, estado, intentos,
       proximo_intento_en
     ) VALUES (
       'prueba', 'sql@1', 'sql@example.test', 'buzon@1', NULL,
       'fotografiado', 'sender@example.test', 'Sender',
       'Salida SQL', 'Cuerpo inmutable', ?, 'pendiente', 0,
       UTC_TIMESTAMP(3)
     )`,
    [smtpMessageId]
  );
  const salidaId = String(salida.insertId);
  await sql.ejecutar(
    `UPDATE cola_correos_salida
        SET estado='reclamada', estado_previo_reclamacion='pendiente',
            claim_id=UNHEX(REPEAT('11',32)),
            propietario_claim='runtime:fixture',
            lease_token=UNHEX(REPEAT('22',32)),
            lease_expira_utc=TIMESTAMPADD(SECOND,60,UTC_TIMESTAMP(3)),
            fencing_token=1, reclamada_en_utc=UTC_TIMESTAMP(3)
      WHERE id=?`,
    [salidaId]
  );
  const [reclamacion] = await sql.ejecutar(
    `INSERT INTO reclamaciones_correos_salida (
       salida_correo_id, claim_id, fencing_token, propietario_claim,
       estado_previo, estado, reclamada_en_utc, lease_expira_utc
     ) SELECT id, claim_id, fencing_token, propietario_claim,
              estado_previo_reclamacion, 'reclamada', reclamada_en_utc,
              lease_expira_utc
         FROM cola_correos_salida WHERE id=?`,
    [salidaId]
  );
  const reclamacionId = String(reclamacion.insertId);
  await sql.ejecutar(
    `UPDATE cola_correos_salida
        SET estado='enviando', enviando_en_utc=UTC_TIMESTAMP(3),
            configuracion_version_ultimo_intento=7, intentos=1
      WHERE id=?`,
    [salidaId]
  );
  await sql.ejecutar(
    `UPDATE reclamaciones_correos_salida
        SET estado='enviando', enviando_en_utc=UTC_TIMESTAMP(3)
      WHERE id=?`,
    [reclamacionId]
  );
  const [intento] = await sql.ejecutar(
    `INSERT INTO intentos_correos_salida (
       salida_correo_id, reclamacion_correo_id, numero,
       configuracion_version, smtp_message_id, estado, iniciado_en_utc
     ) VALUES (?, ?, 1, 7, ?, 'en_curso', UTC_TIMESTAMP(3))`,
    [salidaId, reclamacionId, smtpMessageId]
  );
  const intentoId = String(intento.insertId);
  await assert.rejects(
    sql.ejecutar(
      `UPDATE intentos_correos_salida
          SET estado='aceptado', finalizado_en_utc=UTC_TIMESTAMP(3),
              clasificacion='fallo_reintentable', codigo='smtp_aceptado',
              respuesta_saneada='250 accepted'
        WHERE id=?`,
      [intentoId]
    ),
    /CONSTRAINT|chk_intentos_correo_clasificacion/iu
  );
  await sql.ejecutar(
    `UPDATE intentos_correos_salida
        SET estado='aceptado', finalizado_en_utc=UTC_TIMESTAMP(3),
            clasificacion='aceptacion_demostrada', codigo='smtp_aceptado',
            respuesta_saneada='250 accepted'
      WHERE id=?`,
    [intentoId]
  );
  await sql.ejecutar(
    `UPDATE cola_correos_salida
        SET estado='enviado', estado_previo_reclamacion=NULL,
            claim_id=NULL, propietario_claim=NULL, lease_token=NULL,
            lease_expira_utc=NULL, reclamada_en_utc=NULL,
            enviando_en_utc=NULL, codigo_resultado='smtp_aceptado',
            respuesta_saneada='250 accepted',
            fecha_terminal_utc=UTC_TIMESTAMP(3), fecha_envio=UTC_TIMESTAMP(3),
            fecha_ultimo_intento=UTC_TIMESTAMP(3), proximo_intento_en=NULL
      WHERE id=?`,
    [salidaId]
  );
  await sql.ejecutar(
    `UPDATE reclamaciones_correos_salida
        SET estado='finalizada', finalizada_en_utc=UTC_TIMESTAMP(3),
            codigo_resultado='smtp_aceptado'
      WHERE id=?`,
    [reclamacionId]
  );
  await assert.rejects(
    sql.ejecutar(
      `UPDATE cola_correos_salida
          SET destinatario_email='mutado@example.test' WHERE id=?`,
      [salidaId]
    ),
    /identidad y el mensaje.*inmutables/iu
  );
  await assert.rejects(
    sql.ejecutar(
      `UPDATE cola_correos_salida
          SET estado='pendiente', fecha_terminal_utc=NULL WHERE id=?`,
      [salidaId]
    ),
    /terminal no puede reabrirse/iu
  );
  await assert.rejects(
    sql.ejecutar('DELETE FROM cola_correos_salida WHERE id=?', [salidaId]),
    /foreign key constraint/iu
  );
}

async function verificarRestriccionesOrigenYFk(sql) {
  await assert.rejects(
    sql.ejecutar(
      `INSERT INTO cola_correos_salida (
         origen_tipo, productor_version, notificacion_trigger_correo_id,
         ejecucion_trigger_id, destinatario_email,
         normalizacion_buzon_version, clave_buzon_sha256,
         modo_remitente, asunto, cuerpo_texto, smtp_message_id,
         estado, intentos, proximo_intento_en
       ) VALUES (
         'trigger','sql@1',999999,999999,'trigger@example.test',
         'buzon@1',UNHEX(REPEAT('33',32)),'configuracion_actual',
         'Trigger','Cuerpo','<abcdefghijklmnopqrstuvwxyz012345@correo.test>',
         'pendiente',0,UTC_TIMESTAMP(3)
       )`
    ),
    /foreign key constraint/iu
  );
  await assert.rejects(
    sql.ejecutar(
      `INSERT INTO cola_correos_salida (
         origen_tipo, productor_version, destinatario_email,
         modo_remitente, remitente_email, asunto, cuerpo_texto,
         estado, intentos, proximo_intento_en
       ) VALUES (
         'trigger','legacy','invalido@example.test','fotografiado',
         'sender@example.test','Inválido','Cuerpo','pendiente',0,UTC_TIMESTAMP(3)
       )`
    ),
    /CONSTRAINT|chk_cola_correos/iu
  );
}

async function verificarGuardCorte(sql, legadoId) {
  const [antes] = await sql.consultar(
    'SELECT cola_sql_autoritativa FROM estado_despliegue_trigger_correo WHERE id=1'
  );
  assert.equal(Number(antes.cola_sql_autoritativa), 0);
  await sql.ejecutar(
    `UPDATE estado_despliegue_trigger_correo
        SET estado='quietud_cola', cola_sql_autoritativa=1,
            quietud_iniciada_en_utc=UTC_TIMESTAMP(3),
            cortado_en_utc=UTC_TIMESTAMP(3), revision=revision+1
      WHERE id=1`
  );
  const repositorio = new RepositorioColaCorreo(sql);
  await assert.rejects(
    repositorio.crearPendiente({
      destinatarioEmail: 'bloqueado@example.test', destinatarioNombre: null,
      remitenteEmail: 'sender@example.test', remitenteNombre: null,
      asunto: 'Bloqueado', cuerpoTexto: 'Productor antiguo.',
      creadoPorUsuarioId: null
    }),
    /productores legacy/iu
  );
  await assert.rejects(
    repositorio.registrarErrorFinal({ idCorreo: legadoId, error: 'legacy tardío' }),
    /despachadores legacy/iu
  );

  const [nueva] = await sql.ejecutar(
    `INSERT INTO cola_correos_salida (
       origen_tipo, productor_version, destinatario_email,
       modo_remitente, remitente_email, asunto, cuerpo_texto,
       smtp_message_id, estado, intentos, proximo_intento_en
     ) VALUES (
       'prueba','sql@1','posterior@example.test','fotografiado',
       'sender@example.test','Nueva','Productor SQL admitido.',
       '<abcdefghijklmnopqrstuvwxyz012346@correo.test>',
       'pendiente',0,UTC_TIMESTAMP(3)
     )`
  );
  assert.ok(Number(nueva.insertId) > 0);
  await sql.ejecutar('DELETE FROM cola_correos_salida WHERE id=?', [nueva.insertId]);
  await sql.ejecutar(
    `UPDATE estado_despliegue_trigger_correo
        SET estado='preparacion', cola_sql_autoritativa=0,
            quietud_iniciada_en_utc=NULL,
            cortado_en_utc=NULL, revision=revision+1
      WHERE id=1`
  );
}
