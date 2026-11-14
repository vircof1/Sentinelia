import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';

import { ServicioLecturaTriggerCorreoPortal }
  from '../apps/sentinelia-web/src/servicios/ServicioLecturaTriggerCorreoPortal.js';
import {
  PERFIL_RESULTADO_DESTINATARIO_TRIGGER_CORREO
} from '../paquetes/correo/src/ContratoTriggerCorreo.js';
import { RepositorioArbolTriggerCorreoSql }
  from '../paquetes/correo/src/RepositorioArbolTriggerCorreoSql.js';
import { RepositorioLecturaTriggerCorreoSql }
  from '../paquetes/correo/src/RepositorioLecturaTriggerCorreoSql.js';
import { ServicioAutorizacion }
  from '../paquetes/autorizacion/src/ServicioAutorizacion.js';
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
  assert.equal(configuracion.sql.estaCompleta, true, '5.27.9a necesita MariaDB real.');
  const administrador = new ClienteSql(configuracion.sql);
  const nombre = `sentinelia_fixture_5279a_${randomBytes(5).toString('hex')}`;
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
    const preparado = await prepararEntorno(sql);
    const entorno = await completarHistorico(sql, preparado);
    await verificarProyecciones(sql, entorno);
    await verificarScopeVigenteUsuario(sql, entorno);
    console.log(
      '[correo-trigger] OK 5.27.9a: autoridades=trigger_monitor_usuario ' +
        'extremos=opacos procedencias=sin_correlacion salidas=detalle_autorizado ' +
        'listados=sin_cuerpo_ni_token scope=vigente api=privada'
    );
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(nombre)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

async function completarHistorico(sql, { salidaIds }) {
  const [base] = await sql.consultar(`
    SELECT e.id AS ejecucion_id,e.trigger_id,e.monitor_id,
           e.asignacion_trigger_monitor_id AS asignacion_id,
           t.tenant_id,t.empresa_id,n.id AS notificacion_id
      FROM ejecuciones_triggers e
      JOIN triggers t ON t.id=e.trigger_id
      JOIN notificaciones_triggers_correo n ON n.ejecucion_trigger_id=e.id
     WHERE e.clave_idempotencia=? LIMIT 1
  `, ['a'.repeat(64)]);
  const empresaBId = await insertarId(sql,
    'INSERT INTO empresas (tenant_id,nombre,alias) VALUES (?,?,?)',
    [base.tenant_id, 'Empresa opaca 5279a', `empresa-opaca-${randomBytes(4).toString('hex')}`]);
  const manualId = await insertarId(sql, `
    INSERT INTO destinatarios_triggers_correo (
      trigger_id,tipo,email_manual,email_manual_canonico,nombre_manual
    ) VALUES (?,'manual','ops0@example.test','ops0@example.test','Operaciones')
  `, [base.trigger_id]);
  const usuarioVisibleId = await crearUsuario(sql, {
    tenantId: base.tenant_id,
    empresaId: base.empresa_id,
    indice: 'visible',
    email: 'ops0@example.test'
  });
  const relacionVisibleId = await crearRelacionUsuario(
    sql, base.trigger_id, usuarioVisibleId
  );
  const usuariosRestringidos = [];
  for (let indice = 0; indice < 5; indice += 1) {
    const usuarioId = await crearUsuario(sql, {
      tenantId: base.tenant_id,
      empresaId: empresaBId,
      indice: `restringido-${indice}`,
      email: `ops${indice}@example.test`
    });
    usuariosRestringidos.push({
      usuarioId,
      relacionId: await crearRelacionUsuario(sql, base.trigger_id, usuarioId),
      salidaId: salidaIds[indice],
      email: `ops${indice}@example.test`
    });
  }
  const arbol = new RepositorioArbolTriggerCorreoSql(sql);
  const frontera = new FronteraTransaccionalLocal(sql);
  await frontera.ejecutar(async (conexion) => {
    await crearResultado(arbol, conexion, base, {
      relacionId: manualId,
      tipo: 'manual',
      usuarioId: null,
      email: 'ops0@example.test',
      salidaId: salidaIds[0],
      clave: 'manual'
    });
    await crearResultado(arbol, conexion, base, {
      relacionId: relacionVisibleId,
      tipo: 'usuario',
      usuarioId: usuarioVisibleId,
      email: 'ops0@example.test',
      salidaId: salidaIds[0],
      clave: 'usuario-visible'
    });
    for (const [indice, item] of usuariosRestringidos.entries()) {
      await crearResultado(arbol, conexion, base, {
        relacionId: item.relacionId,
        tipo: 'usuario',
        usuarioId: item.usuarioId,
        email: item.email,
        salidaId: item.salidaId,
        clave: `usuario-restringido-${indice}`
      });
    }
    await conexion.execute(`
      UPDATE ejecuciones_triggers
         SET estado_ejecucion='ok',
             codigo_resultado='correo_notificacion_aceptada_completa',
             mensaje_resultado='Aceptada para fixture de lectura.',
             payload_respuesta=JSON_OBJECT('detalle_correo_estado','conservado'),
             finalizado_en_utc='2026-09-03 10:00:00.040'
       WHERE id=?
    `, [base.ejecucion_id]);
  });
  await sql.ejecutar('UPDATE monitores SET empresa_id=? WHERE id=?', [
    empresaBId,
    base.monitor_id
  ]);
  return {
    ...base,
    empresaBId,
    usuarioVisibleId,
    salidaIds,
    tokenPrivado: await leerToken(sql, salidaIds[0]),
    servicio: new ServicioLecturaTriggerCorreoPortal({
      repositorio: new RepositorioLecturaTriggerCorreoSql(sql),
      fronteraTransaccional: frontera,
      servicioAutorizacion: new ServicioAutorizacion()
    })
  };
}

async function verificarProyecciones(sql, entorno) {
  const portal = contexto('portal', entorno, {
    verTriggers: true,
    verMonitores: true
  });
  const completo = await entorno.servicio.leerDetalle(portal, entorno.ejecucion_id);
  assert.equal(completo.trigger.visible, true);
  assert.equal(completo.monitor.visible, true);
  assert.equal(completo.correo.procedencias.length, 7);
  assert.equal(completo.correo.salidas.length, 5);

  const empresaA = contexto('empresa', entorno, {
    verTriggers: true,
    verMonitores: true,
    empresaId: entorno.empresa_id
  });
  const triggerSinMonitor = await entorno.servicio.leerDetalle(
    empresaA,
    entorno.ejecucion_id
  );
  assert.equal(triggerSinMonitor.trigger.visible, true);
  assert.equal(triggerSinMonitor.monitor.visible, false);
  assert.deepEqual(triggerSinMonitor.correo.causa, { visible: false });
  assert.equal(triggerSinMonitor.correo.procedencias.length, 2);
  assert.equal(triggerSinMonitor.correo.procedenciasRestringidasResumen.total, 5);
  assert.equal(triggerSinMonitor.correo.salidas.length, 1);
  assert.equal(triggerSinMonitor.correo.salidasRestringidasResumen.total, 4);
  assert.equal(Object.hasOwn(triggerSinMonitor.correo.salidas[0],
    'totalProcedencias'), false);
  assert.equal(triggerSinMonitor.correo.mensaje.asuntoMaterializado, null);
  const serializadoA = JSON.stringify(triggerSinMonitor);
  assert.doesNotMatch(serializadoA, /usuario-restringido/u);
  assert.doesNotMatch(serializadoA, /ops[1-4]@example\.test/u);
  assert.doesNotMatch(serializadoA, new RegExp(entorno.tokenPrivado, 'u'));
  assert.doesNotMatch(serializadoA, /cuerpo(?:Base|Privado|Texto)/u);
  assert.doesNotMatch(serializadoA, /claveBuzon|tokenHash/u);

  const empresaB = contexto('empresa', entorno, {
    verTriggers: true,
    verMonitores: true,
    empresaId: entorno.empresaBId
  });
  const monitorSinTrigger = await entorno.servicio.leerDetalle(
    empresaB,
    entorno.ejecucion_id
  );
  assert.equal(monitorSinTrigger.trigger.visible, false);
  assert.equal(monitorSinTrigger.monitor.visible, true);
  assert.equal(monitorSinTrigger.correo, null);
  assert.doesNotMatch(JSON.stringify(monitorSinTrigger), /ops\d@example\.test/u);

  const listado = await entorno.servicio.listar(empresaA, {
    ejecucionIds: [entorno.ejecucion_id]
  });
  assert.equal(listado.total, 1);
  assert.equal(Object.hasOwn(listado.elementos[0].correo, 'mensaje'), false);
  assert.equal(Object.hasOwn(listado.elementos[0].correo, 'procedencias'), false);
  assert.equal(Object.hasOwn(listado.elementos[0].correo, 'salidas'), false);
  assert.doesNotMatch(JSON.stringify(listado), new RegExp(entorno.tokenPrivado, 'u'));

  const ajeno = {
    nivelScope: 'tenant', tenantId: 999999,
    permisos: { verTriggers: true, verMonitores: true }
  };
  await assert.rejects(
    entorno.servicio.leerDetalle(ajeno, entorno.ejecucion_id),
    (error) => error?.codigo === 'ejecucion_trigger_correo_no_disponible' &&
      error?.statusCode === 404
  );
  assert.equal((await entorno.servicio.listar(ajeno, {
    ejecucionIds: [entorno.ejecucion_id]
  })).total, 0);

  const columnas = await sql.consultar(`
    SELECT column_name FROM information_schema.columns
     WHERE table_schema=DATABASE() AND table_name='capacidades_desuscripcion_correo'
  `);
  assert.ok(columnas.some((fila) => fila.column_name === 'token_hash_sha256'));
}

async function verificarScopeVigenteUsuario(sql, entorno) {
  const empresaA = contexto('empresa', entorno, {
    verTriggers: true,
    verMonitores: false,
    empresaId: entorno.empresa_id
  });
  const antes = await entorno.servicio.leerDetalle(empresaA, entorno.ejecucion_id);
  assert.equal(antes.correo.procedencias.length, 2);
  await sql.ejecutar('UPDATE usuarios SET empresa_id=? WHERE id=?', [
    entorno.empresaBId,
    entorno.usuarioVisibleId
  ]);
  const despues = await entorno.servicio.leerDetalle(empresaA, entorno.ejecucion_id);
  assert.equal(despues.correo.procedencias.length, 1);
  assert.equal(despues.correo.procedencias[0].tipo, 'manual');
  assert.equal(despues.correo.procedenciasRestringidasResumen.total, 6);
  assert.equal(despues.correo.salidas.length, 1,
    'La dirección manual sigue autorizando el detalle de la salida compartida.');
}

async function crearResultado(arbol, conexion, base, entrada) {
  return arbol.crearResultadoEnTransaccion({
    ejecucionTriggerId: String(base.ejecucion_id),
    notificacionId: String(base.notificacion_id),
    resultadoDestinatario: {
      perfil: PERFIL_RESULTADO_DESTINATARIO_TRIGGER_CORREO,
      version: 1,
      claveProcedencia: hash(`5279a:${entrada.clave}`),
      relacionDestinatarioId: String(entrada.relacionId),
      tipo: entrada.tipo,
      usuarioId: entrada.usuarioId == null ? null : String(entrada.usuarioId),
      emailManualPresentacion: entrada.tipo === 'manual' ? entrada.email : null,
      emailManualCanonico: entrada.tipo === 'manual' ? entrada.email : null,
      normalizacionBuzonVersion: 'buzon@1',
      estadoObservado: 'activa',
      emailResueltoCanonico: entrada.email,
      claveBuzonSha256: hash(entrada.email),
      codigoInicial: 'aceptado',
      salidaId: String(entrada.salidaId)
    }
  }, { conexion });
}

async function crearUsuario(sql, { tenantId, empresaId, indice, email }) {
  return insertarId(sql, `
    INSERT INTO usuarios (
      tenant_id,empresa_id,usuario,hash_password,activo,email,email_validado,
      nombre_mostrar
    ) VALUES (?,?,?,'fixture',1,?,1,?)
  `, [
    tenantId,
    empresaId,
    `usuario-${indice}-${randomBytes(3).toString('hex')}`,
    email,
    `Usuario ${indice}`
  ]);
}

function crearRelacionUsuario(sql, triggerId, usuarioId) {
  return insertarId(sql, `
    INSERT INTO destinatarios_triggers_correo (trigger_id,tipo,usuario_id)
    VALUES (?,'usuario',?)
  `, [triggerId, usuarioId]);
}

async function leerToken(sql, salidaId) {
  const [fila] = await sql.consultar(
    'SELECT cuerpo_texto FROM cola_correos_salida WHERE id=?', [salidaId]
  );
  const coincidencia = fila.cuerpo_texto.match(
    /\/correo\/desuscripcion\/([A-Za-z0-9_-]{43})/u
  );
  assert.ok(coincidencia);
  return coincidencia[1];
}

function contexto(nivelScope, entorno, {
  verTriggers,
  verMonitores,
  empresaId = null
}) {
  return {
    nivelScope,
    tenantId: nivelScope === 'portal' ? null : Number(entorno.tenant_id),
    empresaId: nivelScope === 'empresa' ? Number(empresaId) : null,
    sitioId: null,
    permisos: { verTriggers, verMonitores }
  };
}

function hash(valor) {
  return createHash('sha256').update(valor).digest('hex');
}

async function insertarId(sql, sentencia, parametros = []) {
  const [resultado] = await sql.ejecutar(sentencia, parametros);
  return Number(resultado.insertId);
}
