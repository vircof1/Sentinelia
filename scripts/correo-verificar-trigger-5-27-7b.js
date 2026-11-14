import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import { ControladorDesuscripcionTriggerCorreo }
  from '../apps/sentinelia-web/src/controladores/ControladorDesuscripcionTriggerCorreo.js';
import { RepositorioAuditoria }
  from '../paquetes/auditoria/src/RepositorioAuditoria.js';
import { ServicioAuditoriaOperativa }
  from '../paquetes/auditoria/src/ServicioAuditoriaOperativa.js';
import { RepositorioDesuscripcionTriggerCorreoSql }
  from '../paquetes/correo/src/RepositorioDesuscripcionTriggerCorreoSql.js';
import { ServicioDesuscripcionTriggerCorreo }
  from '../paquetes/correo/src/ServicioDesuscripcionTriggerCorreo.js';
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
  assert.equal(configuracion.sql.estaCompleta, true, '5.27.7b necesita MariaDB real.');
  const administrador = new ClienteSql(configuracion.sql);
  const nombre = `sentinelia_fixture_5277b_${randomBytes(5).toString('hex')}`;
  let sql;
  try {
    await administrador.ejecutar(
      `CREATE DATABASE ${administrador.escaparIdentificador(nombre)} ` +
        'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
    );
    sql = new ClienteSql({ ...configuracion.sql, baseDatos: nombre });
    await new EjecutorMigraciones({
      clienteSql: sql,
      repositorioMigraciones: new RepositorioMigraciones(sql),
      rutaMigraciones: obtenerRutaMigraciones()
    }).ejecutarPendientes();
    const { salidaIds } = await prepararEntorno(sql);
    const servicio = new ServicioDesuscripcionTriggerCorreo({
      repositorio: new RepositorioDesuscripcionTriggerCorreoSql(sql),
      fronteraTransaccional: new FronteraTransaccionalLocal(sql),
      servicioAuditoria: new ServicioAuditoriaOperativa({
        repositorioAuditoria: new RepositorioAuditoria(sql)
      })
    });
    await verificarAutoridadDurable(sql, servicio, salidaIds[0]);
    await verificarSuperficieGenerica(servicio);
    await verificarControladorEndurecido(servicio);
    console.log(
      '[correo-trigger] OK 5.27.7b: GET=sin_efecto POST=idempotente ' +
        'locks=trigger_capacidad_relaciones identidad=entrega ' +
        'revision=consumida auditoria=atomica respuesta=generica headers=endurecidos'
    );
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(nombre)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

async function verificarAutoridadDurable(sql, servicio, salidaId) {
  const [arbol] = await sql.consultar(`
    SELECT s.id AS salida_id, s.cuerpo_texto, s.ejecucion_trigger_id,
           s.notificacion_trigger_correo_id AS notificacion_id,
           c.id AS capacidad_id, c.trigger_id
      FROM cola_correos_salida s
      JOIN capacidades_desuscripcion_correo c ON c.salida_correo_id=s.id
     WHERE s.id=?
  `, [salidaId]);
  const token = extraerToken(arbol.cuerpo_texto);
  await sql.ejecutar(`
    UPDATE capacidades_desuscripcion_correo
       SET estado='emitida', emitida_en_utc=UTC_TIMESTAMP(3),
           expira_en_utc=DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 30 DAY)
     WHERE id=?
  `, [arbol.capacidad_id]);
  await sql.ejecutar('UPDATE triggers SET activo=1 WHERE id=?', [arbol.trigger_id]);

  const manualId = await insertarId(sql, `
    INSERT INTO destinatarios_triggers_correo (
      trigger_id,tipo,email_manual,email_manual_canonico,nombre_manual
    ) VALUES (?,'manual','ops0@example.test','ops0@example.test','Operaciones')
  `, [arbol.trigger_id]);
  const usuarioId = await insertarId(sql, `
    INSERT INTO usuarios (
      tenant_id,empresa_id,usuario,hash_password,
      activo,email,email_validado
    ) SELECT tenant_id,empresa_id,CONCAT('correo-5277b-',?),
             'fixture',1,'ops0@example.test',1
        FROM triggers WHERE id=?
  `, [randomBytes(4).toString('hex'), arbol.trigger_id]);
  const usuarioRelacionId = await insertarId(sql, `
    INSERT INTO destinatarios_triggers_correo (trigger_id,tipo,usuario_id)
    VALUES (?,'usuario',?)
  `, [arbol.trigger_id, usuarioId]);
  await insertarResultado(sql, arbol, salidaId, {
    relacionId: manualId,
    tipo: 'manual',
    usuarioId: null,
    emailManual: 'ops0@example.test'
  });
  await insertarResultado(sql, arbol, salidaId, {
    relacionId: usuarioRelacionId,
    tipo: 'usuario',
    usuarioId,
    emailManual: null
  });
  await sql.ejecutar(
    `UPDATE usuarios SET email='nuevo@example.test' WHERE id=?`,
    [usuarioId]
  );

  assert.equal((await servicio.comprobar(token)).vigente, true);
  const revisionAntes = await revision(sql, arbol.trigger_id);
  await servicio.comprobar(token);
  assert.equal(await revision(sql, arbol.trigger_id), revisionAntes,
    'GET no puede mutar la declaración.');
  assert.equal((await servicio.retirar(token)).procesada, true);
  const relaciones = await sql.consultar(`
    SELECT id,estado_participacion,causa_ultima_desuscripcion
      FROM destinatarios_triggers_correo WHERE id IN (?,?) ORDER BY id
  `, [manualId, usuarioRelacionId]);
  assert.deepEqual(relaciones.map((fila) => fila.estado_participacion),
    ['desuscrita', 'desuscrita']);
  assert.ok(relaciones.every((fila) =>
    fila.causa_ultima_desuscripcion === 'capacidad_enlace_correo'));
  const [trigger] = await sql.consultar(
    'SELECT activo,revision_declaracion FROM triggers WHERE id=?',
    [arbol.trigger_id]
  );
  assert.equal(Number(trigger.activo), 0);
  assert.equal(Number(trigger.revision_declaracion), revisionAntes + 1);
  const eventos = await sql.consultar(`
    SELECT tipo_evento AS tipo FROM eventos_auditoria
     WHERE sujeto_id IN (?,?,?) ORDER BY secuencia
  `, [String(manualId), String(usuarioRelacionId), String(arbol.trigger_id)]);
  assert.deepEqual(eventos.map((fila) => fila.tipo), [
    'trigger.audiencia_destinatario_desuscrito',
    'trigger.audiencia_destinatario_desuscrito',
    'trigger.audiencia_vacia_desactivado'
  ]);

  await servicio.retirar(token);
  assert.equal(await revision(sql, arbol.trigger_id), revisionAntes + 1,
    'Repetir POST sin cambio debe ser idempotente.');
  await sql.ejecutar(`
    UPDATE destinatarios_triggers_correo
       SET estado_participacion='activa', causa_ultima_desuscripcion=NULL,
           desuscrita_en_utc=NULL, reincorporada_en_utc=UTC_TIMESTAMP(3)
     WHERE id=?
  `, [usuarioRelacionId]);
  await servicio.retirar(token);
  assert.equal(await revision(sql, arbol.trigger_id), revisionAntes + 2,
    'La capacidad vigente debe retirar una relación reincorporada.');

  await sql.ejecutar('DELETE FROM destinatarios_triggers_correo WHERE id=?', [manualId]);
  await sql.ejecutar(`
    INSERT INTO destinatarios_triggers_correo (
      trigger_id,tipo,email_manual,email_manual_canonico,nombre_manual
    ) VALUES (?,'manual','sustituto@example.test','sustituto@example.test','Sustituto')
  `, [arbol.trigger_id]);
  const revisionSustitucion = await revision(sql, arbol.trigger_id);
  await servicio.retirar(token);
  assert.equal(await revision(sql, arbol.trigger_id), revisionSustitucion,
    'Una identidad manual sustituida no hereda una capacidad anterior.');
}

async function verificarSuperficieGenerica(servicio) {
  const invalido = await servicio.comprobar('no-es-un-token');
  const ausente = await servicio.retirar('A'.repeat(43));
  assert.deepEqual(Object.keys(invalido), ['procesada', 'vigente']);
  assert.equal(invalido.procesada, true);
  assert.equal(invalido.vigente, false);
  assert.deepEqual(ausente, invalido);
}

async function verificarControladorEndurecido(servicio) {
  const controlador = new ControladorDesuscripcionTriggerCorreo({
    servicioDesuscripcion: servicio
  });
  const respuesta = respuestaFalsa();
  await controlador.mostrarConfirmacion(
    { params: { token: 'invalido' } },
    respuesta
  );
  assert.equal(respuesta.estado, 200);
  assert.equal(respuesta.vista, 'correo-desuscripcion');
  assert.equal(respuesta.headers['Cache-Control'], 'no-store');
  assert.equal(respuesta.headers['Referrer-Policy'], 'no-referrer');
  assert.match(respuesta.headers['Content-Security-Policy'], /default-src 'none'/u);
}

async function insertarResultado(sql, arbol, salidaId, identidad) {
  await sql.ejecutar(`
    INSERT INTO resultados_destinatarios_triggers_correo (
      ejecucion_trigger_id,notificacion_trigger_correo_id,clave_procedencia,
      relacion_destinatario_id,tipo,usuario_id,usuario_id_fotografia,
      email_manual,email_manual_canonico,normalizacion_buzon_version,
      estado_observado,email_resuelto_canonico,clave_buzon_sha256,
      codigo_inicial,salida_correo_id
    ) VALUES (?,?,?,?,?,?,?,?,?,'buzon@1','activa','ops0@example.test',?,
              'aceptado',?)
  `, [
    arbol.ejecucion_trigger_id,
    arbol.notificacion_id,
    randomBytes(32),
    identidad.relacionId,
    identidad.tipo,
    identidad.usuarioId,
    identidad.usuarioId,
    identidad.emailManual,
    identidad.emailManual,
    randomBytes(32),
    salidaId
  ]);
}

function extraerToken(cuerpo) {
  const coincidencia = String(cuerpo).match(/\/correo\/desuscripcion\/([A-Za-z0-9_-]{43})/u);
  assert.ok(coincidencia);
  return coincidencia[1];
}

async function revision(sql, triggerId) {
  const [fila] = await sql.consultar(
    'SELECT revision_declaracion FROM triggers WHERE id=?', [triggerId]
  );
  return Number(fila.revision_declaracion);
}

async function insertarId(sql, sentencia, parametros) {
  const [resultado] = await sql.ejecutar(sentencia, parametros);
  return Number(resultado.insertId);
}

function respuestaFalsa() {
  return {
    headers: {}, estado: null, vista: null,
    set(nombre, valor) { this.headers[nombre] = valor; return this; },
    status(valor) { this.estado = valor; return this; },
    render(vista, datos) { this.vista = vista; this.datos = datos; return this; }
  };
}
