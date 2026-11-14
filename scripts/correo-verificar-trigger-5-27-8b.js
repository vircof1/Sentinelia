import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';

import { RepositorioArbolTriggerCorreoSql }
  from '../paquetes/correo/src/RepositorioArbolTriggerCorreoSql.js';
import { RepositorioColaCorreo }
  from '../paquetes/correo/src/RepositorioColaCorreo.js';
import { RepositorioFotografiaAdmisionTriggerCorreoSql }
  from '../paquetes/correo/src/RepositorioFotografiaAdmisionTriggerCorreoSql.js';
import {
  ServicioAceptacionTriggerCorreo,
  construirClaveIdempotenciaPlanTriggerCorreo
} from '../paquetes/correo/src/ServicioAceptacionTriggerCorreo.js';
import { ServicioFotografiaAdmisionTriggerCorreo }
  from '../paquetes/correo/src/ServicioFotografiaAdmisionTriggerCorreo.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones }
  from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { FronteraTransaccionalLocal }
  from '../paquetes/persistencia-sql/src/FronteraTransaccionalLocal.js';
import { RepositorioMigraciones }
  from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import { RepositorioEjecucionesTrigger }
  from '../paquetes/triggers/src/RepositorioEjecucionesTrigger.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';
import { prepararEntorno } from './correo-verificar-trigger-5-27-6c.js';

await main();

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true, '5.27.8b necesita MariaDB real.');
  const administrador = new ClienteSql(configuracion.sql);
  const nombre = `sentinelia_fixture_5278b_${randomBytes(5).toString('hex')}`;
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
    await prepararEntorno(sql);
    const entorno = await prepararCaso(sql);
    await verificarAceptacionYReplay(sql, entorno);
    await verificarRechazoAudiencia(sql, entorno);
    await verificarRollbackTotal(sql, entorno);
    await new RepositorioArbolTriggerCorreoSql(sql)
      .exigirIntegridadEjecucionesAceptadas();
    console.log(
      '[correo-trigger] OK 5.27.8b: ejecucion=terminal_mismo_commit ' +
        'intencion=arbol_completo salidas=deduplicadas capacidades=privadas ' +
        'rechazo=solo_ejecucion_y_resultados_saneados replay=sin_escrituras ' +
        'rollback=total gate=sin_integracion_productiva'
    );
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(nombre)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

async function prepararCaso(sql) {
  const [base] = await sql.consultar(`
    SELECT t.id AS trigger_id,t.nombre AS trigger_nombre,t.tenant_id,
           t.empresa_id,a.id AS asignacion_id,a.monitor_id,m.nombre AS monitor_nombre,
           m.tipo AS monitor_tipo,m.sitio_id
      FROM triggers t
      JOIN asignaciones_triggers_monitores a ON a.trigger_id=t.id
      JOIN monitores m ON m.id=a.monitor_id
     ORDER BY t.id ASC LIMIT 1
  `);
  await sql.ejecutar('UPDATE triggers SET activo=1 WHERE id=?', [base.trigger_id]);
  const manualId = await insertarId(sql, `
    INSERT INTO destinatarios_triggers_correo (
      trigger_id,tipo,email_manual,email_manual_canonico,nombre_manual
    ) VALUES (?,'manual','equipo@example.test','equipo@example.test','Equipo')
  `, [base.trigger_id]);
  const usuarioId = await insertarId(sql, `
    INSERT INTO usuarios (
      tenant_id,empresa_id,usuario,hash_password,activo,email,email_validado
    ) VALUES (?,?,?,'fixture',0,'dormido@example.test',1)
  `, [base.tenant_id, base.empresa_id, `correo-5278b-${randomBytes(4).toString('hex')}`]);
  const usuarioRelacionId = await insertarId(sql, `
    INSERT INTO destinatarios_triggers_correo (trigger_id,tipo,usuario_id)
    VALUES (?,'usuario',?)
  `, [base.trigger_id, usuarioId]);
  return {
    ...base,
    manualId,
    usuarioId,
    usuarioRelacionId,
    frontera: new FronteraTransaccionalLocal(sql)
  };
}

async function verificarAceptacionYReplay(sql, entorno) {
  const plan = planPara(entorno, '0199a9f0-7b5c-7a55-b32a-810000000001');
  const clave = construirClaveIdempotenciaPlanTriggerCorreo(plan);
  assert.equal(clave, createHash('sha256').update([
    plan.eventoDisparo, plan.transicion.alertaAuditoriaId,
    plan.asignacionId, plan.triggerId
  ].join(':')).digest('hex'));
  let entropias = 0;
  const servicio = crearServicio(sql, {
    reloj: relojSecuencial(),
    fuenteEntropia: () => Buffer.alloc(32, ++entropias)
  });
  const resultado = await entorno.frontera.ejecutar((conexion) =>
    servicio.aceptarEnTransaccion({ planDisparo: plan, conexion }));
  assert.equal(resultado.creada, true);
  assert.equal(resultado.estadoEjecucion, 'ok');
  assert.equal(resultado.codigoResultado, 'correo_notificacion_aceptada_parcial');
  assert.equal(resultado.resultadosDestinatarios.length, 2);
  assert.equal(resultado.notificacionAceptada.salidas.length, 1);
  assert.equal(resultado.notificacionAceptada.capacidades.length, 1);
  assert.equal(entropias, 1, 'Un buzón deduplicado genera una sola capacidad.');

  const [conteos] = await sql.consultar(`
    SELECT
      (SELECT COUNT(*) FROM ejecuciones_triggers WHERE clave_idempotencia=?) AS ejecuciones,
      (SELECT COUNT(*) FROM notificaciones_triggers_correo WHERE clave_idempotencia=UNHEX(?)) AS notificaciones,
      (SELECT COUNT(*) FROM resultados_destinatarios_triggers_correo r
        JOIN ejecuciones_triggers e ON e.id=r.ejecucion_trigger_id
       WHERE e.clave_idempotencia=?) AS resultados,
      (SELECT COUNT(*) FROM cola_correos_salida s
        JOIN ejecuciones_triggers e ON e.id=s.ejecucion_trigger_id
       WHERE e.clave_idempotencia=?) AS salidas
  `, [clave, clave, clave, clave]);
  assert.deepEqual(Object.values(conteos).map(Number), [1, 1, 2, 1]);
  const [ejecucion] = await sql.consultar(`
    SELECT estado_ejecucion,codigo_resultado,payload_respuesta
      FROM ejecuciones_triggers WHERE clave_idempotencia=?
  `, [clave]);
  assert.equal(ejecucion.estado_ejecucion, 'ok');
  assert.doesNotMatch(JSON.stringify(ejecucion.payload_respuesta), /example\.test/u);

  const replay = await entorno.frontera.ejecutar((conexion) =>
    servicio.aceptarEnTransaccion({ planDisparo: plan, conexion }));
  assert.equal(replay.recuperada, true);
  assert.equal(replay.creada, false);
  assert.equal(entropias, 1, 'El replay no regenera secretos de desuscripción.');
}

async function verificarRechazoAudiencia(sql, entorno) {
  await sql.ejecutar(
    'DELETE FROM destinatarios_triggers_correo WHERE id=?', [entorno.manualId]);
  const plan = planPara(entorno, '0199a9f0-7b5c-7a55-b32a-810000000002');
  const clave = construirClaveIdempotenciaPlanTriggerCorreo(plan);
  const resultado = await entorno.frontera.ejecutar((conexion) =>
    crearServicio(sql, { reloj: relojSecuencial() })
      .aceptarEnTransaccion({ planDisparo: plan, conexion }));
  assert.equal(resultado.estadoEjecucion, 'error');
  assert.equal(resultado.codigoResultado, 'correo_sin_destinatarios_admitidos');
  assert.equal(resultado.notificacionAceptada, null);
  assert.equal(resultado.resultadosDestinatarios.length, 1);
  assert.equal(resultado.resultadosDestinatarios[0].codigoInicial, 'usuario_inactivo');
  const [conteos] = await sql.consultar(`
    SELECT
      (SELECT COUNT(*) FROM notificaciones_triggers_correo n
        JOIN ejecuciones_triggers e ON e.id=n.ejecucion_trigger_id
       WHERE e.clave_idempotencia=?) AS notificaciones,
      (SELECT COUNT(*) FROM resultados_destinatarios_triggers_correo r
        JOIN ejecuciones_triggers e ON e.id=r.ejecucion_trigger_id
       WHERE e.clave_idempotencia=?) AS resultados,
      (SELECT COUNT(*) FROM cola_correos_salida s
        JOIN ejecuciones_triggers e ON e.id=s.ejecucion_trigger_id
       WHERE e.clave_idempotencia=?) AS salidas
  `, [clave, clave, clave]);
  assert.deepEqual(Object.values(conteos).map(Number), [0, 1, 0]);
}

async function verificarRollbackTotal(sql, entorno) {
  await sql.ejecutar(`
    INSERT INTO destinatarios_triggers_correo (
      trigger_id,tipo,email_manual,email_manual_canonico,nombre_manual
    ) VALUES (?,'manual','rollback@example.test','rollback@example.test','Rollback')
  `, [entorno.trigger_id]);
  const plan = planPara(entorno, '0199a9f0-7b5c-7a55-b32a-810000000003');
  const clave = construirClaveIdempotenciaPlanTriggerCorreo(plan);
  const cola = new RepositorioColaCorreo(sql);
  const servicio = crearServicio(sql, {
    reloj: relojSecuencial(),
    repositorioColaCorreo: {
      async crearSalidaTriggerEnTransaccion(entrada, opciones) {
        await cola.crearSalidaTriggerEnTransaccion(entrada, opciones);
        throw new Error('fallo_inyectado_despues_salida');
      }
    }
  });
  await assert.rejects(
    entorno.frontera.ejecutar((conexion) =>
      servicio.aceptarEnTransaccion({ planDisparo: plan, conexion })),
    /fallo_inyectado_despues_salida/u
  );
  const [conteo] = await sql.consultar(
    'SELECT COUNT(*) AS total FROM ejecuciones_triggers WHERE clave_idempotencia=?',
    [clave]
  );
  assert.equal(Number(conteo.total), 0);
}

function crearServicio(sql, {
  reloj,
  fuenteEntropia,
  repositorioColaCorreo = new RepositorioColaCorreo(sql)
} = {}) {
  const valores = new Map([
    ['portal.origen_publico', 'https://sentinelia.example/'],
    ['portal.nombre_visible', 'Sentinelia']
  ]);
  const fotografia = new ServicioFotografiaAdmisionTriggerCorreo({
    repositorio: new RepositorioFotografiaAdmisionTriggerCorreoSql(),
    evaluadorAutoridadCorreoSql: {
      async evaluarEnTransaccion({ conexion }) {
        await conexion.execute(
          'SELECT clave FROM configuracion_portal ORDER BY clave LOCK IN SHARE MODE'
        );
        await conexion.execute(
          'SELECT id FROM estado_verificacion_correo WHERE id=1 LOCK IN SHARE MODE'
        );
        await conexion.execute(
          'SELECT id FROM cabecera_configuracion_portal WHERE id=1 LOCK IN SHARE MODE'
        );
        await conexion.execute(
          'SELECT id FROM estado_despliegue_trigger_correo WHERE id=1 LOCK IN SHARE MODE'
        );
        return {
          puedeDespachar: true,
          codigo: 'fixture_smtp_verificado',
          versionConfiguracion: '1',
          remitenteEmailCanonico: 'avisos@example.test',
          configuracion: { desuscripcionTtlDias: 30 },
          lectura: { valores }
        };
      }
    }
  });
  return new ServicioAceptacionTriggerCorreo({
    servicioFotografiaAdmision: fotografia,
    repositorioEjecucionesTrigger: new RepositorioEjecucionesTrigger(sql),
    repositorioArbolTriggerCorreo: new RepositorioArbolTriggerCorreoSql(sql),
    repositorioColaCorreo,
    reloj,
    fuenteEntropia
  });
}

function planPara(entorno, alertaAuditoriaId) {
  return {
    eventoDisparo: 'apertura_alerta',
    triggerId: Number(entorno.trigger_id),
    asignacionId: Number(entorno.asignacion_id),
    monitorId: Number(entorno.monitor_id),
    tipoTrigger: 'correo',
    nombreTrigger: entorno.trigger_nombre,
    ordenEjecucion: 100,
    transicion: {
      tipoEventoDisparo: 'apertura_alerta',
      alertaAuditoriaId,
      monitorId: Number(entorno.monitor_id),
      tenantId: Number(entorno.tenant_id),
      empresaId: Number(entorno.empresa_id),
      sitioId: entorno.sitio_id == null ? null : Number(entorno.sitio_id),
      tipoMonitor: entorno.monitor_tipo,
      nombreMonitor: entorno.monitor_nombre,
      fechaOcurrenciaUtc: '2026-09-03T10:00:00.000Z',
      validoDesdeUtc: '2026-09-03T09:59:59.000Z',
      codigoResultado: 'timeout',
      mensajeResultado: 'Sin respuesta.',
      payloadAlerta: {
        descripcionFallo: 'El servicio no responde.',
        posibleSolucion: 'Comprueba la red.'
      }
    }
  };
}

function relojSecuencial() {
  let milisegundos = 10;
  return () => {
    const fecha = new Date(`2026-09-03T10:00:00.${String(milisegundos).padStart(3, '0')}Z`);
    milisegundos += 10;
    return fecha;
  };
}

async function insertarId(sql, sentencia, parametros = []) {
  const [resultado] = await sql.ejecutar(sentencia, parametros);
  return Number(resultado.insertId);
}
