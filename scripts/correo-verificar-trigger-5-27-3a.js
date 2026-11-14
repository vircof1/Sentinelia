import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones }
  from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';
import { DENYLIST_TABLAS_SCOPE_ORGANIZATIVO }
  from '../paquetes/jerarquia-organizativa/src/CatalogoScopeOrganizativo.js';

const TABLAS_CORREO = Object.freeze([
  'destinatarios_triggers_correo',
  'notificaciones_triggers_correo',
  'resultados_destinatarios_triggers_correo',
  'capacidades_desuscripcion_correo'
]);

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true, '5.27.3a necesita MariaDB real.');
  const administrador = new ClienteSql(configuracion.sql);
  const nombre = `sentinelia_fixture_5273a_${randomBytes(5).toString('hex')}`;
  let sql;
  try {
    await administrador.ejecutar(
      `CREATE DATABASE ${administrador.escaparIdentificador(nombre)} ` +
        'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
    );
    sql = new ClienteSql({ ...configuracion.sql, baseDatos: nombre });
    const resultadoMigracion = await new EjecutorMigraciones({
      clienteSql: sql,
      repositorioMigraciones: new RepositorioMigraciones(sql),
      rutaMigraciones: obtenerRutaMigraciones()
    }).ejecutarPendientes();
    assert.equal(resultadoMigracion.integridad.ok, true);

    await verificarClasificacionOrganizativa();
    await verificarRevisionYChecks(sql);
    await verificarArbolYForaneas(sql);

    console.log(
      '[correo-trigger] OK 5.27.3a: esquema=inicial revision=durable ' +
        'audiencia=relacional intencion=idempotente resultados=procedencia ' +
        'capacidades=hash_only fk=vivas_anulables_historia_restrictiva'
    );
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(nombre)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

async function verificarClasificacionOrganizativa() {
  for (const tabla of TABLAS_CORREO) {
    assert.ok(
      DENYLIST_TABLAS_SCOPE_ORGANIZATIVO.includes(tabla),
      `${tabla} debe estar clasificada como persistencia protegida.`
    );
  }
}

async function verificarRevisionYChecks(sql) {
  const triggerId = await insertarId(sql, `
    INSERT INTO triggers (nombre, tipo, activo, configuracion)
    VALUES ('revision-5273a', 'api', 0, JSON_OBJECT('url', 'https://example.test'))
  `);
  const [trigger] = await sql.consultar(
    'SELECT revision_declaracion FROM triggers WHERE id = ?',
    [triggerId]
  );
  assert.equal(Number(trigger.revision_declaracion), 1);
  await assert.rejects(
    sql.ejecutar('UPDATE triggers SET revision_declaracion = 0 WHERE id = ?', [triggerId]),
    esErrorIntegridad
  );
  await sql.ejecutar('DELETE FROM triggers WHERE id = ?', [triggerId]);
}

async function verificarArbolYForaneas(sql) {
  const tenantId = await insertarId(sql, `
    INSERT INTO tenants (nombre, alias) VALUES ('Tenant 5273a', 'tenant-5273a')
  `);
  const empresaId = await insertarId(sql, `
    INSERT INTO empresas (tenant_id, nombre, alias)
    VALUES (?, 'Empresa 5273a', 'empresa-5273a')
  `, [tenantId]);
  const monitorId = await insertarId(sql, `
    INSERT INTO monitores (tenant_id, empresa_id, nombre, tipo, activo, configuracion)
    VALUES (?, ?, 'Monitor 5273a', 'http', 1, JSON_OBJECT())
  `, [tenantId, empresaId]);
  const triggerId = await insertarId(sql, `
    INSERT INTO triggers (
      tenant_id, empresa_id, nombre, tipo, activo, configuracion
    ) VALUES (?, ?, 'Correo 5273a', 'correo', 0, JSON_OBJECT(
      'version', 1,
      'asuntoPlantilla', 'Aviso {monitor}',
      'textoIntroduccion', NULL,
      'textoCierre', NULL
    ))
  `, [tenantId, empresaId]);
  const usuarioId = await insertarId(sql, `
    INSERT INTO usuarios (
      usuario, email, email_validado, hash_password, activo,
      tenant_id, empresa_id
    ) VALUES (
      'destinatario-5273a', 'persona@example.test', 1, 'fixture', 1, ?, ?
    )
  `, [tenantId, empresaId]);
  const asignacionId = await insertarId(sql, `
    INSERT INTO asignaciones_triggers_monitores (
      monitor_id, trigger_id, activo
    ) VALUES (?, ?, 1)
  `, [monitorId, triggerId]);
  const ejecucionId = await insertarId(sql, `
    INSERT INTO ejecuciones_triggers (
      asignacion_trigger_monitor_id, trigger_id, monitor_id,
      tenant_id, empresa_id, clave_idempotencia, evento_disparo,
      estado_ejecucion, tipo_trigger, trigger_nombre, monitor_nombre,
      codigo_resultado, iniciado_en_utc, finalizado_en_utc
    ) VALUES (
      ?, ?, ?, ?, ?, REPEAT('a', 64), 'apertura_alerta',
      'ok', 'correo', 'Correo 5273a', 'Monitor 5273a',
      'correo_notificacion_aceptada_parcial', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)
    )
  `, [asignacionId, triggerId, monitorId, tenantId, empresaId]);
  const salidaId = await insertarId(sql, `
    INSERT INTO cola_correos_salida (
      destinatario_email, remitente_email, asunto, cuerpo_texto, estado
    ) VALUES (
      'persona@example.test', 'sentinelia@example.test',
      'Aviso', 'Cuerpo', 'pendiente'
    )
  `);

  const relacionUsuarioId = await insertarId(sql, `
    INSERT INTO destinatarios_triggers_correo (trigger_id, tipo, usuario_id)
    VALUES (?, 'usuario', ?)
  `, [triggerId, usuarioId]);
  const relacionManualId = await insertarId(sql, `
    INSERT INTO destinatarios_triggers_correo (
      trigger_id, tipo, email_manual, email_manual_canonico, nombre_manual
    ) VALUES (?, 'manual', 'Ops@example.test', 'Ops@example.test', 'Operaciones')
  `, [triggerId]);
  await insertarId(sql, `
    INSERT INTO destinatarios_triggers_correo (
      trigger_id, tipo, email_manual, email_manual_canonico
    ) VALUES (?, 'manual', 'ops@example.test', 'ops@example.test')
  `, [triggerId]);
  await assert.rejects(
    sql.ejecutar(`
      INSERT INTO destinatarios_triggers_correo (
        trigger_id, tipo, email_manual, email_manual_canonico
      ) VALUES (?, 'manual', 'Ops@example.test', 'Ops@example.test')
    `, [triggerId]),
    esErrorIntegridad,
    'La identidad manual debe usar unicidad binaria.'
  );
  await assert.rejects(
    sql.ejecutar(`
      INSERT INTO destinatarios_triggers_correo (trigger_id, tipo, usuario_id)
      VALUES (?, 'manual', ?)
    `, [triggerId, usuarioId]),
    esErrorIntegridad,
    'Un destinatario no puede mezclar procedencias.'
  );

  const notificacionId = await insertarId(sql, `
    INSERT INTO notificaciones_triggers_correo (
      ejecucion_trigger_id, clave_idempotencia, revision_declaracion,
      trigger_id, trigger_id_fotografia,
      asignacion_trigger_monitor_id, asignacion_id_fotografia,
      monitor_id, monitor_id_fotografia, alerta_auditoria_id,
      evento_disparo, fecha_ocurrencia_utc, valido_desde_utc,
      nombre_monitor, tipo_monitor, estado_monitor, origen_causal,
      codigo_resultado, mensaje_resultado,
      descripcion_fallo, posible_solucion,
      scope_trigger_nivel, scope_trigger_tenant_id, scope_trigger_empresa_id,
      scope_monitor_nivel, scope_monitor_tenant_id, scope_monitor_empresa_id,
      referencia_estado_url, referencia_historico_url,
      definicion_mensaje_version, asunto_plantilla,
      renderizador_version, asunto, cuerpo_base_texto, origen_publico,
      renderizado_en_utc, aceptada_en_utc
    ) VALUES (
      ?, UNHEX(REPEAT('aa', 32)), 1,
      ?, ?, ?, ?, ?, ?, UNHEX('018F1234567871238123456789ABCDEF'),
      'apertura_alerta', '2026-09-03 10:00:02.000', '2026-09-03 10:00:00.000',
      'Monitor 5273a', 'http', 'indisponible', 'directo',
      'timeout', 'Sin respuesta', 'El servicio no responde', 'Revisar servicio',
      'empresa', ?, ?, 'empresa', ?, ?,
      'https://portal.test/monitores/1',
      'https://portal.test/monitores/historico?monitor_id=1',
      1, 'Aviso {monitor}', 'correo@1', 'Aviso Monitor 5273a',
      'Cuerpo causal', 'https://portal.test',
      '2026-09-03 10:00:03.000', '2026-09-03 10:00:04.000'
    )
  `, [
    ejecucionId, triggerId, triggerId, asignacionId, asignacionId,
    monitorId, monitorId, tenantId, empresaId, tenantId, empresaId
  ]);

  const resultadoUsuarioId = await insertarId(sql, `
    INSERT INTO resultados_destinatarios_triggers_correo (
      ejecucion_trigger_id, notificacion_trigger_correo_id,
      clave_procedencia, relacion_destinatario_id, tipo,
      usuario_id, usuario_id_fotografia, normalizacion_buzon_version,
      estado_observado, email_resuelto_canonico, clave_buzon_sha256,
      codigo_inicial, salida_correo_id
    ) VALUES (
      ?, ?, UNHEX(REPEAT('bb', 32)), ?, 'usuario', ?, ?, 'buzon@1',
      'activa', 'persona@example.test', UNHEX(REPEAT('cc', 32)),
      'aceptado', ?
    )
  `, [ejecucionId, notificacionId, relacionUsuarioId, usuarioId, usuarioId, salidaId]);
  await insertarId(sql, `
    INSERT INTO resultados_destinatarios_triggers_correo (
      ejecucion_trigger_id, notificacion_trigger_correo_id,
      clave_procedencia, relacion_destinatario_id, tipo,
      email_manual, email_manual_canonico, normalizacion_buzon_version,
      estado_observado, codigo_inicial
    ) VALUES (
      ?, ?, UNHEX(REPEAT('dd', 32)), ?, 'manual',
      'Ops@example.test', 'Ops@example.test', 'buzon@1',
      'activa', 'email_invalido'
    )
  `, [ejecucionId, notificacionId, relacionManualId]);
  await assert.rejects(
    sql.ejecutar(`
      INSERT INTO resultados_destinatarios_triggers_correo (
        ejecucion_trigger_id, clave_procedencia, tipo,
        usuario_id_fotografia, normalizacion_buzon_version,
        estado_observado, email_resuelto_canonico, clave_buzon_sha256,
        codigo_inicial, salida_correo_id
      ) VALUES (
        ?, UNHEX(REPEAT('ee', 32)), 'usuario', ?, 'buzon@1', 'activa',
        'persona@example.test', UNHEX(REPEAT('ff', 32)), 'aceptado', ?
      )
    `, [ejecucionId, usuarioId, salidaId]),
    esErrorIntegridad,
    'Un resultado aceptado no puede existir fuera de su intención.'
  );
  await insertarId(sql, `
    INSERT INTO capacidades_desuscripcion_correo (
      salida_correo_id, trigger_id, trigger_id_fotografia,
      token_hash_sha256, ttl_dias
    ) VALUES (?, ?, ?, UNHEX(REPEAT('12', 32)), 30)
  `, [salidaId, triggerId, triggerId]);
  const salidaInvalidaId = await insertarId(sql, `
    INSERT INTO cola_correos_salida (
      destinatario_email, remitente_email, asunto, cuerpo_texto, estado
    ) VALUES (
      'invalida@example.test', 'sentinelia@example.test',
      'Aviso inválido', 'Cuerpo', 'pendiente'
    )
  `);
  await assert.rejects(
    sql.ejecutar(`
      INSERT INTO capacidades_desuscripcion_correo (
        salida_correo_id, trigger_id_fotografia, token_hash_sha256,
        ttl_dias, estado, emitida_en_utc
      ) VALUES (?, ?, UNHEX(REPEAT('34', 32)), 30, 'emitida', UTC_TIMESTAMP(3))
    `, [salidaInvalidaId, triggerId]),
    esCheck('chk_capacidades_correo_estado')
  );

  await sql.ejecutar('DELETE FROM usuarios WHERE id = ?', [usuarioId]);
  assert.equal(await contar(sql,
    'SELECT COUNT(*) total FROM destinatarios_triggers_correo WHERE id = ?',
    [relacionUsuarioId]), 0, 'La audiencia de usuario debe seguir su ciclo vivo.');
  const [resultadoTrasUsuario] = await sql.consultar(`
    SELECT usuario_id, usuario_id_fotografia
      FROM resultados_destinatarios_triggers_correo WHERE id = ?
  `, [resultadoUsuarioId]);
  assert.equal(resultadoTrasUsuario.usuario_id, null);
  assert.equal(Number(resultadoTrasUsuario.usuario_id_fotografia), Number(usuarioId));

  await sql.ejecutar(
    'DELETE FROM asignaciones_triggers_monitores WHERE id = ?',
    [asignacionId]
  );
  await sql.ejecutar('DELETE FROM monitores WHERE id = ?', [monitorId]);
  let [fotografia] = await sql.consultar(`
    SELECT asignacion_trigger_monitor_id, asignacion_id_fotografia,
           monitor_id, monitor_id_fotografia
      FROM notificaciones_triggers_correo WHERE id = ?
  `, [notificacionId]);
  assert.equal(fotografia.asignacion_trigger_monitor_id, null);
  assert.equal(Number(fotografia.asignacion_id_fotografia), Number(asignacionId));
  assert.equal(fotografia.monitor_id, null);
  assert.equal(Number(fotografia.monitor_id_fotografia), Number(monitorId));

  await sql.ejecutar('DELETE FROM triggers WHERE id = ?', [triggerId]);
  assert.equal(await contar(sql,
    'SELECT COUNT(*) total FROM destinatarios_triggers_correo WHERE trigger_id = ?',
    [triggerId]), 0);
  [fotografia] = await sql.consultar(`
    SELECT trigger_id, trigger_id_fotografia
      FROM notificaciones_triggers_correo WHERE id = ?
  `, [notificacionId]);
  assert.equal(fotografia.trigger_id, null);
  assert.equal(Number(fotografia.trigger_id_fotografia), Number(triggerId));
  const [capacidad] = await sql.consultar(`
    SELECT trigger_id, trigger_id_fotografia
      FROM capacidades_desuscripcion_correo WHERE salida_correo_id = ?
  `, [salidaId]);
  assert.equal(capacidad.trigger_id, null);
  assert.equal(Number(capacidad.trigger_id_fotografia), Number(triggerId));

  await assert.rejects(
    sql.ejecutar('DELETE FROM ejecuciones_triggers WHERE id = ?', [ejecucionId]),
    esErrorIntegridad,
    'La ejecución no puede perder una intención aceptada.'
  );
  await assert.rejects(
    sql.ejecutar('DELETE FROM cola_correos_salida WHERE id = ?', [salidaId]),
    esErrorIntegridad,
    'La salida no puede perder resultados ni capacidad sin retención coordinada.'
  );
}

async function insertarId(sql, sentencia, parametros = []) {
  const [resultado] = await sql.ejecutar(sentencia, parametros);
  assert.ok(Number(resultado.insertId) > 0);
  return resultado.insertId;
}

async function contar(sql, sentencia, parametros = []) {
  const [fila] = await sql.consultar(sentencia, parametros);
  return Number(fila.total);
}

function esErrorIntegridad(error) {
  return error?.sqlState === '23000';
}

function esCheck(nombre) {
  return (error) => esErrorIntegridad(error) &&
    String(error.sqlMessage || '').includes(nombre);
}

await main();
