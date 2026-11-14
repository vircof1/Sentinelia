import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import { RepositorioRetencionTriggerCorreoSql }
  from '../paquetes/correo/src/RepositorioRetencionTriggerCorreoSql.js';
import { ServicioRetencionTriggerCorreo }
  from '../paquetes/correo/src/ServicioRetencionTriggerCorreo.js';
import { RepositorioColaCorreo }
  from '../paquetes/correo/src/RepositorioColaCorreo.js';
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
  assert.equal(configuracion.sql.estaCompleta, true, '5.27.10a necesita MariaDB real.');
  const administrador = new ClienteSql(configuracion.sql);
  const nombre = `sentinelia_fixture_52710a_${randomBytes(5).toString('hex')}`;
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
    const base = await prepararEntorno(sql);
    const entorno = await prepararCasos(sql, base);
    const repositorio = new RepositorioRetencionTriggerCorreoSql(sql);
    const servicio = new ServicioRetencionTriggerCorreo({
      repositorio,
      fronteraTransaccional: new FronteraTransaccionalLocal(sql)
    });

    await verificarProtecciones(sql, repositorio, entorno);
    await verificarRollbackYOrden(sql, repositorio, entorno);
    await verificarPurga(sql, servicio, repositorio, entorno);
    console.log(
      '[correo-trigger] OK 5.27.10a: seleccion=terminal ' +
        'backlog=protegido capacidades=vigentes_protegidas conjunto=integro ' +
        'locks=ejecucion_primero marca=atomica resumen=sin_buzones ' +
        'rechazo=desde_ejecucion prueba=terminal rollback=total'
    );
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(nombre)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

async function prepararCasos(sql, { salidaIds }) {
  const [salidaBase] = await sql.consultar(`
    SELECT ejecucion_trigger_id,notificacion_trigger_correo_id
      FROM cola_correos_salida WHERE id=?
  `, [salidaIds[0]]);
  for (const [indice, salidaId] of salidaIds.entries()) {
    await sql.ejecutar(`
      INSERT INTO resultados_destinatarios_triggers_correo (
        ejecucion_trigger_id,notificacion_trigger_correo_id,clave_procedencia,
        tipo,email_manual,email_manual_canonico,normalizacion_buzon_version,
        estado_observado,email_resuelto_canonico,clave_buzon_sha256,
        codigo_inicial,salida_correo_id,creada_en_utc
      ) SELECT ?,?,UNHEX(SHA2(?,256)),'manual',destinatario_email,
               destinatario_email,'buzon@1','activa',destinatario_email,
               clave_buzon_sha256,'aceptado',id,'2026-07-01 00:00:00.000'
          FROM cola_correos_salida WHERE id=?
    `, [salidaBase.ejecucion_trigger_id, salidaBase.notificacion_trigger_correo_id,
      `procedencia-${indice}`, salidaId]);
  }
  await sql.ejecutar(`
    UPDATE ejecuciones_triggers
       SET estado_ejecucion='ok',
           codigo_resultado='correo_notificacion_aceptada_completa',
           payload_respuesta=JSON_OBJECT('resultado','aceptada'),
           finalizado_en_utc='2026-07-01 00:00:00.000'
     WHERE id=?
  `, [salidaBase.ejecucion_trigger_id]);

  const rechazoId = await insertarId(sql, `
    INSERT INTO ejecuciones_triggers (
      evento_disparo,estado_ejecucion,tipo_trigger,trigger_nombre,
      codigo_resultado,mensaje_resultado,payload_respuesta,
      iniciado_en_utc,finalizado_en_utc
    ) VALUES ('apertura_alerta','error','correo','Rechazo 52710a',
      'correo_sin_destinatarios_admitidos','Sin destinatarios',
      JSON_OBJECT('resultado','rechazado'),
      '2026-07-01 00:00:00','2026-07-01 00:00:01')
  `);
  await sql.ejecutar(`
    INSERT INTO resultados_destinatarios_triggers_correo (
      ejecucion_trigger_id,clave_procedencia,tipo,email_manual,
      email_manual_canonico,normalizacion_buzon_version,estado_observado,
      codigo_inicial,creada_en_utc
    ) VALUES (?,UNHEX(SHA2('rechazo-52710a',256)),'manual',
      'rechazado@example.test','rechazado@example.test','buzon@1','activa',
      'email_invalido','2026-07-01 00:00:00.000')
  `, [rechazoId]);

  const cola = new RepositorioColaCorreo(sql);
  const prueba = await cola.crearPendienteLegacy({
    destinatarioEmail: 'prueba@example.test',
    destinatarioNombre: null,
    remitenteEmail: 'sender@example.test',
    remitenteNombre: 'Sentinelia',
    asunto: 'Prueba',
    cuerpoTexto: 'Contenido privado',
    creadoPorUsuarioId: null
  });
  await cola.registrarEnvioExitoso({
    idCorreo: prueba.id,
    mensajeId: '<prueba-52710a@example.test>',
    respuestaProveedor: '250 aceptado'
  });
  const [pruebaTerminal] = await sql.consultar(
    'SELECT fecha_terminal_utc FROM cola_correos_salida WHERE id=?',
    [prueba.id]
  );
  assert.ok(pruebaTerminal.fecha_terminal_utc,
    'El productor legacy debe fotografiar desde ahora su terminación.');
  await sql.ejecutar(`
    UPDATE cola_correos_salida
       SET fecha_ultimo_intento='2026-07-01 00:00:00.000',
           fecha_envio='2026-07-01 00:00:00.000',
           fecha_terminal_utc='2026-07-01 00:00:00.000',
           fecha_creacion='2026-07-01 00:00:00.000'
     WHERE id=?
  `, [prueba.id]);
  return {
    ejecucionId: String(salidaBase.ejecucion_trigger_id),
    notificacionId: String(salidaBase.notificacion_trigger_correo_id),
    salidaIds: salidaIds.map(String),
    rechazoId: String(rechazoId),
    pruebaId: String(prueba.id)
  };
}

async function verificarProtecciones(sql, repositorio, entorno) {
  await sql.ejecutar(`
    UPDATE cola_correos_salida
       SET estado='pendiente',fecha_terminal_utc=NULL,fecha_envio=NULL
     WHERE id=?
  `, [entorno.salidaIds.at(-1)]);
  let resultado = await new FronteraTransaccionalLocal(sql).ejecutar((conexion) =>
    repositorio.purgarCandidatoEnTransaccion(
      { tipo: 'ejecucion', id: entorno.ejecucionId },
      { conexion, retencionDias: 1 }
    ));
  assert.deepEqual(
    { estado: resultado.estado, causa: resultado.causa },
    { estado: 'protegido', causa: 'backlog_no_terminal' }
  );

  await hacerTerminales(sql, entorno.salidaIds);
  await sql.ejecutar(`
    UPDATE capacidades_desuscripcion_correo
       SET estado='emitida',emitida_en_utc='2026-09-01 00:00:00.000',
           expira_en_utc='2099-01-01 00:00:00.000'
     WHERE salida_correo_id=?
  `, [entorno.salidaIds[0]]);
  resultado = await new FronteraTransaccionalLocal(sql).ejecutar((conexion) =>
    repositorio.purgarCandidatoEnTransaccion(
      { tipo: 'ejecucion', id: entorno.ejecucionId },
      { conexion, retencionDias: 1 }
    ));
  assert.deepEqual(
    { estado: resultado.estado, causa: resultado.causa },
    { estado: 'protegido', causa: 'capacidad_vigente_o_no_emitida' }
  );
  assert.equal((await repositorio.listarCandidatosTerminales({
    retencionDias: 1,
    limite: 20
  })).ejecuciones.some((item) => item.id === entorno.ejecucionId), false);

  await sql.ejecutar(`
    UPDATE capacidades_desuscripcion_correo
       SET emitida_en_utc='2026-07-01 00:00:00.000',
           expira_en_utc='2026-08-01 00:00:00.000'
     WHERE salida_correo_id=?
  `, [entorno.salidaIds[0]]);
}

async function verificarRollbackYOrden(sql, repositorio, entorno) {
  const sentencias = [];
  await assert.rejects(
    new FronteraTransaccionalLocal(sql).ejecutar(async (conexion) => {
      const instrumentada = new Proxy(conexion, {
        get(objetivo, propiedad) {
          if (propiedad === 'execute') {
            return async (sentencia, parametros) => {
              sentencias.push(String(sentencia).replace(/\s+/gu, ' ').trim());
              return objetivo.execute(sentencia, parametros);
            };
          }
          const valor = Reflect.get(objetivo, propiedad, objetivo);
          return typeof valor === 'function' ? valor.bind(objetivo) : valor;
        }
      });
      const purga = await repositorio.purgarCandidatoEnTransaccion(
        { tipo: 'ejecucion', id: entorno.ejecucionId },
        { conexion: instrumentada, retencionDias: 1 }
      );
      assert.equal(purga.estado, 'purgado');
      throw new Error('rollback-retencion-52710a');
    }),
    /rollback-retencion-52710a/u
  );
  assert.match(sentencias[0], /FROM ejecuciones_triggers/u);
  assert.match(sentencias[0], /FOR UPDATE/u);
  assert.equal(await contar(sql, 'notificaciones_triggers_correo'), 1);
  const [ejecucion] = await sql.consultar(
    'SELECT payload_respuesta FROM ejecuciones_triggers WHERE id=?',
    [entorno.ejecucionId]
  );
  assert.notEqual(parsear(ejecucion.payload_respuesta).detalle_correo_estado, 'purgado');
}

async function verificarPurga(sql, servicio, repositorio, entorno) {
  const candidatos = await servicio.listarCandidatos({ retencionDias: 1, limite: 20 });
  assert.deepEqual(
    candidatos.ejecuciones.map((item) => item.id),
    [entorno.ejecucionId, entorno.rechazoId].sort((a, b) => Number(a) - Number(b))
  );
  assert.deepEqual(candidatos.pruebas.map((item) => item.id), [entorno.pruebaId]);

  const operacional = await servicio.purgarCandidato(
    { tipo: 'ejecucion', id: entorno.ejecucionId },
    { retencionDias: 1 }
  );
  assert.equal(operacional.estado, 'purgado');
  assert.equal(operacional.resumen.salidas.total, entorno.salidaIds.length);
  assert.equal(operacional.resumen.resultados.porCodigoInicial.aceptado,
    entorno.salidaIds.length);
  assert.doesNotMatch(JSON.stringify(operacional.resumen), /example\.test/u);

  const rechazo = await servicio.purgarCandidato(
    { tipo: 'ejecucion', id: entorno.rechazoId },
    { retencionDias: 1 }
  );
  assert.equal(rechazo.estado, 'purgado');
  assert.equal(rechazo.resumen.resultados.porCodigoInicial.email_invalido, 1);
  const prueba = await servicio.purgarCandidato(
    { tipo: 'prueba', id: entorno.pruebaId },
    { retencionDias: 1 }
  );
  assert.equal(prueba.estado, 'purgado');

  for (const tabla of [
    'notificaciones_triggers_correo',
    'resultados_destinatarios_triggers_correo',
    'capacidades_desuscripcion_correo',
    'cola_correos_salida'
  ]) {
    assert.equal(await contar(sql, tabla), 0, `${tabla} debe quedar purgada.`);
  }
  const filas = await sql.consultar(`
    SELECT id,payload_respuesta FROM ejecuciones_triggers WHERE id IN (?,?) ORDER BY id
  `, [entorno.ejecucionId, entorno.rechazoId]);
  for (const fila of filas) {
    const payload = parsear(fila.payload_respuesta);
    assert.equal(payload.detalle_correo_estado, 'purgado');
    assert.match(payload.detalle_correo_purgado_en_utc,
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u);
    assert.doesNotMatch(JSON.stringify(payload), /example\.test/u);
  }
  const repetida = await servicio.purgarCandidato(
    { tipo: 'ejecucion', id: entorno.ejecucionId },
    { retencionDias: 1 }
  );
  assert.equal(repetida.estado, 'ya_purgado');
  assert.equal((await repositorio.listarCandidatosTerminales({
    retencionDias: 1,
    limite: 20
  })).ejecuciones.length, 0);
}

async function hacerTerminales(sql, ids) {
  await sql.ejecutar(`
    UPDATE cola_correos_salida
       SET estado='enviado',intentos=1,proximo_intento_en=NULL,
           fecha_ultimo_intento='2026-07-01 00:00:00.000',
           fecha_envio='2026-07-01 00:00:00.000',
           fecha_terminal_utc='2026-07-01 00:00:00.000'
     WHERE id IN (${ids.map(() => '?').join(',')})
  `, ids);
  await sql.ejecutar(`
    UPDATE capacidades_desuscripcion_correo
       SET estado='emitida',emitida_en_utc='2026-07-01 00:00:00.000',
           expira_en_utc='2026-08-01 00:00:00.000'
     WHERE salida_correo_id IN (${ids.map(() => '?').join(',')})
  `, ids);
}

async function insertarId(sql, sentencia, parametros = []) {
  const [resultado] = await sql.ejecutar(sentencia, parametros);
  return String(resultado.insertId);
}

async function contar(sql, tabla) {
  const [fila] = await sql.consultar(`SELECT COUNT(*) AS total FROM ${tabla}`);
  return Number(fila.total);
}

function parsear(valor) {
  return typeof valor === 'string' ? JSON.parse(valor) : valor;
}
