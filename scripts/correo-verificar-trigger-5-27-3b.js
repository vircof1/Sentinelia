import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import {
  CODIGOS_RESULTADO_DESTINATARIO_TRIGGER_CORREO,
  ESTADOS_CAPACIDAD_DESUSCRIPCION_TRIGGER_CORREO,
  ESTADOS_PARTICIPACION_DESTINATARIO_TRIGGER_CORREO,
  PERFIL_CAPACIDAD_DESUSCRIPCION_TRIGGER_CORREO,
  PERFIL_FOTOGRAFIA_CAUSAL_TRIGGER_CORREO,
  PERFIL_MENSAJE_MATERIALIZADO_TRIGGER_CORREO,
  PERFIL_RESULTADO_DESTINATARIO_TRIGGER_CORREO
} from '../paquetes/correo/src/ContratoTriggerCorreo.js';
import {
  ArbolPersistenciaTriggerCorreo,
  CapacidadDesuscripcionCorreo,
  DestinatarioTriggerCorreo,
  NotificacionTriggerCorreo,
  ResultadoDestinatarioTriggerCorreo
} from '../paquetes/correo/src/EntidadesPersistenciaTriggerCorreo.js';
import { RepositorioArbolTriggerCorreoSql }
  from '../paquetes/correo/src/RepositorioArbolTriggerCorreoSql.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones }
  from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import { ServicioTriggers } from '../paquetes/triggers/src/ServicioTriggers.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true, '5.27.3b necesita MariaDB real.');
  const administrador = new ClienteSql(configuracion.sql);
  const nombre = `sentinelia_fixture_5273b_${randomBytes(5).toString('hex')}`;
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

    const ids = await prepararCausa(sql);
    const repositorio = new RepositorioArbolTriggerCorreoSql(sql);
    await verificarConexionPrestada(sql, repositorio, ids);
    await verificarEscrituraYLecturaAtomica(sql, repositorio, ids);
    await verificarDiagnosticoYPurga(sql, repositorio, ids);
    await verificarRollbackDelLlamador(sql, repositorio, ids);
    await verificarSinSuperficieHttp();

    console.log(
      '[correo-trigger] OK 5.27.3b: entidades=inmutables repositorio=prestado ' +
        'arbol=atomico lectura=privada rollback=llamador ' +
        'integridad=arbol_o_marca_purga arranque=fail_closed'
    );
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(nombre)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

async function verificarConexionPrestada(sql, repositorio, ids) {
  await assert.rejects(
    repositorio.listarAudienciaEnTransaccion({ triggerId: ids.triggerId }),
    /conexión SQL prestada/iu
  );
  const conexion = await sql.obtenerConexion();
  try {
    await assert.rejects(
      repositorio.crearNotificacionEnTransaccion(
        notificacionEntrada(ids),
        { conexion }
      ),
      /transacción SQL activa/iu
    );
  } finally {
    conexion.release();
  }
}

async function verificarEscrituraYLecturaAtomica(sql, repositorio, ids) {
  const conexion = await sql.obtenerConexion();
  try {
    await conexion.beginTransaction();
    const audiencia = await repositorio.listarAudienciaEnTransaccion({
      triggerId: ids.triggerId,
      bloquear: true
    }, { conexion });
    assert.equal(audiencia.length, 2);
    assert.ok(audiencia.every((item) =>
      item instanceof DestinatarioTriggerCorreo && Object.isFrozen(item)));

    const notificacion = await repositorio.crearNotificacionEnTransaccion(
      notificacionEntrada(ids),
      { conexion }
    );
    assert.ok(notificacion instanceof NotificacionTriggerCorreo);
    assert.equal(notificacion.ejecucionTriggerId, String(ids.ejecucionId));
    assert.equal(notificacion.claveIdempotencia, ids.claveIdempotencia);
    assert.equal(notificacion.scopeMonitor.nivel, 'empresa');
    ids.notificacionId = notificacion.id;

    const aceptado = await repositorio.crearResultadoEnTransaccion({
      ejecucionTriggerId: ids.ejecucionId,
      notificacionId: notificacion.id,
      resultadoDestinatario: resultadoManualAceptado(ids)
    }, { conexion });
    assert.ok(aceptado instanceof ResultadoDestinatarioTriggerCorreo);
    const rechazado = await repositorio.crearResultadoEnTransaccion({
      ejecucionTriggerId: ids.ejecucionId,
      notificacionId: notificacion.id,
      resultadoDestinatario: resultadoUsuarioRechazado(ids)
    }, { conexion });
    assert.equal(rechazado.codigoInicial, 'usuario_inactivo');

    const capacidad = await repositorio.crearCapacidadEnTransaccion(
      capacidadEntrada(ids),
      { conexion }
    );
    assert.ok(capacidad instanceof CapacidadDesuscripcionCorreo);
    assert.equal(capacidad.tokenHashSha256, ids.tokenHash);

    await conexion.execute(`
      UPDATE ejecuciones_triggers
         SET estado_ejecucion = 'ok',
             codigo_resultado = 'correo_notificacion_aceptada_parcial',
             finalizado_en_utc = '2026-09-03 10:00:00.040'
       WHERE id = ?
    `, [ids.ejecucionId]);
    const arbol = await repositorio.buscarArbolPorEjecucionEnTransaccion({
      ejecucionTriggerId: ids.ejecucionId,
      bloquear: true
    }, { conexion });
    assert.ok(arbol instanceof ArbolPersistenciaTriggerCorreo);
    assert.equal(arbol.resultados.length, 2);
    assert.equal(arbol.capacidades.length, 1);
    assert.equal(Object.isFrozen(arbol.resultados), true);
    assert.equal(arbol.serializarPrivado().notificacion.mensajeMaterializado.asunto,
      'Apertura · Monitor 5273b');
    await conexion.commit();
  } catch (error) {
    await conexion.rollback();
    throw error;
  } finally {
    conexion.release();
  }
  assert.equal((await repositorio.diagnosticarIntegridadEjecucionesAceptadas()).ok,
    true);
}

async function verificarDiagnosticoYPurga(sql, repositorio, ids) {
  const rotaId = await insertarEjecucion(sql, ids, {
    clave: '9'.repeat(64),
    estado: 'ok',
    codigo: 'correo_notificacion_aceptada_completa'
  });
  let diagnostico = await repositorio.diagnosticarIntegridadEjecucionesAceptadas();
  assert.equal(diagnostico.ok, false);
  assert.deepEqual(diagnostico.ejecuciones.map((item) => item.codigoIntegridad),
    ['notificacion_ausente']);
  await assert.rejects(
    repositorio.exigirIntegridadEjecucionesAceptadas(),
    (error) => error?.codigo === 'ejecucion_correo_aceptada_sin_arbol'
  );
  await sql.ejecutar(`
    UPDATE ejecuciones_triggers
       SET payload_respuesta = JSON_OBJECT(
         'detalle_correo_estado', 'purgado',
         'purgado_en_utc', '2026-09-03T12:00:00.000Z',
         'resumen', JSON_OBJECT('salidas', 1, 'destinatarios', 2)
       )
     WHERE id = ?
  `, [rotaId]);
  diagnostico = await repositorio.exigirIntegridadEjecucionesAceptadas();
  assert.equal(diagnostico.ok, true);
  const servicio = new ServicioTriggers({
    repositorioTriggers: {},
    repositorioAsignacionesTriggerMonitor: {},
    repositorioEjecucionesTrigger: {
      async listarNoTerminalesPorTipos() { return []; }
    },
    repositorioArbolTriggerCorreo: repositorio,
    validadorTrigger: {}
  });
  const integridadArranque =
    await servicio.exigirIntegridadEstrategiasEjecucion();
  assert.equal(integridadArranque.correoAceptado.ok, true);
}

async function verificarRollbackDelLlamador(sql, repositorio, ids) {
  const ejecucionId = await insertarEjecucion(sql, ids, {
    clave: '8'.repeat(64),
    estado: 'ejecutando',
    codigo: null
  });
  const conexion = await sql.obtenerConexion();
  try {
    await conexion.beginTransaction();
    const entrada = notificacionEntrada({
      ...ids,
      ejecucionId,
      claveIdempotencia: '8'.repeat(64)
    });
    const creada = await repositorio.crearNotificacionEnTransaccion(
      entrada,
      { conexion }
    );
    assert.ok(creada.id);
    await conexion.rollback();
  } finally {
    conexion.release();
  }
  const [fila] = await sql.consultar(`
    SELECT COUNT(*) total FROM notificaciones_triggers_correo
     WHERE ejecucion_trigger_id = ?
  `, [ejecucionId]);
  assert.equal(Number(fila.total), 0,
    'El repositorio no puede confirmar la transacción prestada.');
  await sql.ejecutar('DELETE FROM ejecuciones_triggers WHERE id = ?', [ejecucionId]);
}

async function verificarSinSuperficieHttp() {
  const [web, aplicacion] = await Promise.all([
    readFile(new URL('../apps/sentinelia-web/src/index.js', import.meta.url), 'utf8'),
    readFile(new URL(
      '../apps/sentinelia-web/src/crearAplicacion.js',
      import.meta.url
    ), 'utf8')
  ]);
  assert.doesNotMatch(web, /RepositorioArbolTriggerCorreoSql/u);
  assert.doesNotMatch(aplicacion, /destinatarios_triggers_correo/u);
  const bootstrap = await readFile(new URL(
    '../apps/sentinelia-runtime/src/BootstrapRuntime.js',
    import.meta.url
  ), 'utf8');
  assert.match(bootstrap, /RepositorioArbolTriggerCorreoSql/u);
  assert.match(bootstrap, /exigirIntegridadEstrategiasEjecucion/u);
}

async function prepararCausa(sql) {
  const tenantId = await insertarId(sql,
    "INSERT INTO tenants (nombre, alias) VALUES ('Tenant 5273b', 'tenant-5273b')");
  const empresaId = await insertarId(sql, `
    INSERT INTO empresas (tenant_id, nombre, alias)
    VALUES (?, 'Empresa 5273b', 'empresa-5273b')
  `, [tenantId]);
  const monitorId = await insertarId(sql, `
    INSERT INTO monitores (tenant_id, empresa_id, nombre, tipo, configuracion)
    VALUES (?, ?, 'Monitor 5273b', 'http', JSON_OBJECT())
  `, [tenantId, empresaId]);
  const triggerId = await insertarId(sql, `
    INSERT INTO triggers (
      tenant_id, empresa_id, nombre, tipo, activo, configuracion
    ) VALUES (?, ?, 'Correo 5273b', 'correo', 0, JSON_OBJECT(
      'version', 1, 'asuntoPlantilla', 'Aviso {{monitor}}',
      'textoIntroduccion', NULL, 'textoCierre', NULL
    ))
  `, [tenantId, empresaId]);
  const usuarioId = await insertarId(sql, `
    INSERT INTO usuarios (
      usuario, email, email_validado, hash_password, activo,
      tenant_id, empresa_id
    ) VALUES ('dormido-5273b', 'dormido@example.test', 1, 'fixture', 0, ?, ?)
  `, [tenantId, empresaId]);
  const asignacionId = await insertarId(sql, `
    INSERT INTO asignaciones_triggers_monitores (monitor_id, trigger_id, activo)
    VALUES (?, ?, 1)
  `, [monitorId, triggerId]);
  const relacionManualId = await insertarId(sql, `
    INSERT INTO destinatarios_triggers_correo (
      trigger_id, tipo, email_manual, email_manual_canonico
    ) VALUES (?, 'manual', 'ops@example.test', 'ops@example.test')
  `, [triggerId]);
  const relacionUsuarioId = await insertarId(sql, `
    INSERT INTO destinatarios_triggers_correo (trigger_id, tipo, usuario_id)
    VALUES (?, 'usuario', ?)
  `, [triggerId, usuarioId]);
  const claveIdempotencia = 'a'.repeat(64);
  const ejecucionId = await insertarEjecucion(sql, {
    tenantId, empresaId, monitorId, triggerId, asignacionId
  }, {
    clave: claveIdempotencia,
    estado: 'ejecutando',
    codigo: null
  });
  const salidaId = await insertarId(sql, `
    INSERT INTO cola_correos_salida (
      destinatario_email, remitente_email, asunto, cuerpo_texto, estado
    ) VALUES (
      'ops@example.test', 'sentinelia@example.test',
      'Apertura · Monitor 5273b', 'Cuerpo privado', 'pendiente'
    )
  `);
  return {
    tenantId, empresaId, monitorId, triggerId, usuarioId, asignacionId,
    relacionManualId, relacionUsuarioId, ejecucionId, salidaId,
    claveIdempotencia,
    claveBuzon: 'b'.repeat(64),
    tokenHash: 'c'.repeat(64)
  };
}

async function insertarEjecucion(sql, ids, { clave, estado, codigo }) {
  return insertarId(sql, `
    INSERT INTO ejecuciones_triggers (
      asignacion_trigger_monitor_id, trigger_id, monitor_id,
      tenant_id, empresa_id, trigger_tenant_id, trigger_empresa_id,
      monitor_tenant_id, monitor_empresa_id,
      clave_idempotencia, evento_disparo, estado_ejecucion,
      tipo_trigger, trigger_nombre, monitor_nombre, codigo_resultado,
      iniciado_en_utc, finalizado_en_utc
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'apertura_alerta', ?,
      'correo', 'Correo 5273b', 'Monitor 5273b', ?,
      '2026-09-03 10:00:00.000',
      CASE WHEN ? IN ('ok', 'error') THEN '2026-09-03 10:00:00.040' ELSE NULL END
    )
  `, [
    ids.asignacionId, ids.triggerId, ids.monitorId,
    ids.tenantId, ids.empresaId, ids.tenantId, ids.empresaId,
    ids.tenantId, ids.empresaId, clave, estado, codigo, estado
  ]);
}

function notificacionEntrada(ids) {
  return {
    revisionDeclaracion: '1',
    ejecucionTriggerId: String(ids.ejecucionId),
    claveIdempotencia: ids.claveIdempotencia,
    definicionMensaje: {
      version: 1,
      asuntoPlantilla: 'Aviso {{monitor}}',
      textoIntroduccion: null,
      textoCierre: null
    },
    fotografiaCausal: {
      perfil: PERFIL_FOTOGRAFIA_CAUSAL_TRIGGER_CORREO,
      version: 1,
      ejecucionTriggerId: String(ids.ejecucionId),
      claveIdempotencia: ids.claveIdempotencia,
      triggerId: String(ids.triggerId),
      asignacionId: String(ids.asignacionId),
      monitorId: String(ids.monitorId),
      alertaAuditoriaId: '0199a9f0-7b5c-7a55-b32a-111111111111',
      eventoDisparo: 'apertura_alerta',
      fechaOcurrenciaUtc: '2026-09-03T10:00:00.000Z',
      validoDesdeUtc: '2026-09-03T09:59:59.000Z',
      nombreMonitor: 'Monitor 5273b',
      tipoMonitor: 'http',
      estadoMonitor: 'indisponible',
      origenCausal: 'directo',
      codigoResultado: 'timeout',
      mensajeResultado: 'Sin respuesta',
      contextoHumano: {
        descripcionFallo: 'El servicio no responde.',
        posibleSolucion: 'Revisar el proceso.'
      },
      scopeTrigger: scopeEmpresa(ids),
      scopeMonitor: scopeEmpresa(ids),
      referencias: {
        estadoUrl: `https://portal.test/monitores/${ids.monitorId}`,
        historicoUrl: `https://portal.test/monitores/historico?monitor_id=${ids.monitorId}`
      }
    },
    mensajeMaterializado: {
      perfil: PERFIL_MENSAJE_MATERIALIZADO_TRIGGER_CORREO,
      version: 1,
      asunto: 'Apertura · Monitor 5273b',
      cuerpoBaseTexto: 'El servicio no responde.',
      origenPublico: 'https://portal.test',
      renderizadoEnUtc: '2026-09-03T10:00:00.010Z'
    },
    aceptadaEnUtc: '2026-09-03T10:00:00.030Z'
  };
}

function resultadoManualAceptado(ids) {
  return {
    perfil: PERFIL_RESULTADO_DESTINATARIO_TRIGGER_CORREO,
    version: 1,
    claveProcedencia: 'd'.repeat(64),
    relacionDestinatarioId: String(ids.relacionManualId),
    tipo: 'manual',
    usuarioId: null,
    emailManualPresentacion: 'ops@example.test',
    emailManualCanonico: 'ops@example.test',
    normalizacionBuzonVersion: 'buzon@1',
    estadoObservado: ESTADOS_PARTICIPACION_DESTINATARIO_TRIGGER_CORREO.ACTIVA,
    emailResueltoCanonico: 'ops@example.test',
    claveBuzonSha256: ids.claveBuzon,
    codigoInicial: CODIGOS_RESULTADO_DESTINATARIO_TRIGGER_CORREO.ACEPTADO,
    salidaId: String(ids.salidaId)
  };
}

function resultadoUsuarioRechazado(ids) {
  return {
    perfil: PERFIL_RESULTADO_DESTINATARIO_TRIGGER_CORREO,
    version: 1,
    claveProcedencia: 'e'.repeat(64),
    relacionDestinatarioId: String(ids.relacionUsuarioId),
    tipo: 'usuario',
    usuarioId: String(ids.usuarioId),
    emailManualPresentacion: null,
    emailManualCanonico: null,
    normalizacionBuzonVersion: 'buzon@1',
    estadoObservado: ESTADOS_PARTICIPACION_DESTINATARIO_TRIGGER_CORREO.ACTIVA,
    emailResueltoCanonico: null,
    claveBuzonSha256: null,
    codigoInicial:
      CODIGOS_RESULTADO_DESTINATARIO_TRIGGER_CORREO.USUARIO_INACTIVO,
    salidaId: null
  };
}

function capacidadEntrada(ids) {
  return {
    perfil: PERFIL_CAPACIDAD_DESUSCRIPCION_TRIGGER_CORREO,
    version: 1,
    salidaId: String(ids.salidaId),
    triggerId: String(ids.triggerId),
    tokenHashSha256: ids.tokenHash,
    ttlDias: 30,
    estado: ESTADOS_CAPACIDAD_DESUSCRIPCION_TRIGGER_CORREO.PREPARADA,
    emitidaEnUtc: null,
    expiraEnUtc: null
  };
}

function scopeEmpresa(ids) {
  return {
    nivel: 'empresa',
    tenantId: String(ids.tenantId),
    empresaId: String(ids.empresaId),
    sitioId: null
  };
}

async function insertarId(sql, sentencia, parametros = []) {
  const [resultado] = await sql.ejecutar(sentencia, parametros);
  assert.ok(Number(resultado.insertId) > 0);
  return resultado.insertId;
}

await main();
