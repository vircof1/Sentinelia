import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import {
  PERFIL_FOTOGRAFIA_CAUSAL_TRIGGER_CORREO,
  PERFIL_MENSAJE_MATERIALIZADO_TRIGGER_CORREO
} from '../paquetes/correo/src/ContratoTriggerCorreo.js';
import { RepositorioArbolTriggerCorreoSql }
  from '../paquetes/correo/src/RepositorioArbolTriggerCorreoSql.js';
import {
  RepositorioColaCorreo,
  VERSION_PRODUCTOR_LEGACY_CORREO,
  VERSION_PRODUCTOR_SQL_CORREO
} from '../paquetes/correo/src/RepositorioColaCorreo.js';
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
  assert.equal(configuracion.sql.estaCompleta, true, '5.27.6b necesita MariaDB real.');
  const administrador = new ClienteSql(configuracion.sql);
  const nombre = `sentinelia_fixture_5276b_${randomBytes(5).toString('hex')}`;
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
    const ids = await crearFixtures(sql);
    const repositorioCola = new RepositorioColaCorreo(sql);
    const repositorioArbol = new RepositorioArbolTriggerCorreoSql(sql);

    await verificarConexionYTransaccion(sql, repositorioCola, ids);
    await verificarInsercionAtomica(sql, repositorioCola, repositorioArbol, ids);
    await verificarRollbackDelLlamador(sql, repositorioCola, repositorioArbol, ids);
    await verificarCompatibilidadAislada(sql, repositorioCola);
    await verificarAusenciaProductorCausal();

    console.log(
      '[correo-trigger] OK 5.27.6b: repositorio=conexion_prestada ' +
        'salida_sql=contrato_atomico rollback=llamador legacy=camino_explicito ' +
        'reclamacion=regimen_aislado productor_trigger=no_registrado'
    );
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(nombre)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

async function verificarConexionYTransaccion(sql, repositorio, ids) {
  const entrada = salidaEntrada(ids, { notificacionId: '1' });
  await assert.rejects(
    repositorio.crearSalidaTriggerEnTransaccion(entrada),
    /conexión prestada/iu
  );
  const conexion = await sql.obtenerConexion();
  try {
    await assert.rejects(
      repositorio.crearSalidaTriggerEnTransaccion(entrada, { conexion }),
      /transacción activa/iu
    );
  } finally {
    conexion.release();
  }
}

async function verificarInsercionAtomica(sql, cola, arbol, ids) {
  const conexion = await sql.obtenerConexion();
  let salida;
  try {
    await conexion.beginTransaction();
    const notificacion = await arbol.crearNotificacionEnTransaccion(
      notificacionEntrada(ids),
      { conexion }
    );
    salida = await cola.crearSalidaTriggerEnTransaccion(
      salidaEntrada(ids, { notificacionId: String(notificacion.id) }),
      { conexion }
    );
    assert.equal(salida.origenTipo, 'trigger');
    assert.equal(salida.productorVersion, VERSION_PRODUCTOR_SQL_CORREO);
    assert.equal(salida.modoRemitente, 'configuracion_actual');
    assert.equal(salida.remitenteEmail, null);
    assert.equal(salida.destinatarioNombre, null);
    assert.equal(salida.claveBuzonSha256, ids.claveBuzon);
    assert.equal(salida.notificacionTriggerCorreoId, notificacion.id);
    assert.equal(salida.ejecucionTriggerId, String(ids.ejecucionId));
    assert.equal(salida.fechaCreacion.toISOString(), '2026-09-03T10:00:00.020Z');
    const leida = await cola.buscarPorId(salida.id, { conexion });
    assert.equal(leida.smtpMessageId, ids.smtpMessageId);
    await assert.rejects(
      cola.crearSalidaTriggerEnTransaccion(
        salidaEntrada(ids, { notificacionId: String(notificacion.id) }),
        { conexion }
      ),
      /Duplicate entry/iu
    );
    await conexion.commit();
  } catch (error) {
    await conexion.rollback();
    throw error;
  } finally {
    conexion.release();
  }
  const persistida = await cola.buscarPorId(salida.id);
  assert.equal(persistida.productorVersion, VERSION_PRODUCTOR_SQL_CORREO);
  await assert.rejects(
    cola.registrarErrorFinal({ idCorreo: salida.id, error: 'ruta equivocada' }),
    /no pertenece al régimen legacy/iu
  );
}

async function verificarRollbackDelLlamador(sql, cola, arbol, idsBase) {
  const ids = await crearEjecucionAdicional(sql, idsBase, {
    clave: 'c'.repeat(64),
    sufijo: 'rollback'
  });
  const conexion = await sql.obtenerConexion();
  let salidaId;
  let notificacionId;
  try {
    await conexion.beginTransaction();
    const notificacion = await arbol.crearNotificacionEnTransaccion(
      notificacionEntrada(ids),
      { conexion }
    );
    notificacionId = notificacion.id;
    const salida = await cola.crearSalidaTriggerEnTransaccion(
      salidaEntrada(ids, { notificacionId: String(notificacion.id) }),
      { conexion }
    );
    salidaId = salida.id;
    await conexion.rollback();
  } finally {
    conexion.release();
  }
  assert.equal(await cola.buscarPorId(salidaId), null);
  const [notificaciones] = await sql.consultar(
    'SELECT COUNT(*) AS total FROM notificaciones_triggers_correo WHERE id=?',
    [notificacionId]
  );
  assert.equal(Number(notificaciones.total), 0);
}

async function verificarCompatibilidadAislada(sql, repositorio) {
  assert.equal(VERSION_PRODUCTOR_LEGACY_CORREO, 'legacy');
  const legacy = await repositorio.crearPendienteLegacy({
    destinatarioEmail: 'legacy@example.test',
    destinatarioNombre: 'Legacy',
    remitenteEmail: 'sender@example.test',
    remitenteNombre: 'Sender',
    asunto: 'Legacy explícito',
    cuerpoTexto: 'El régimen antiguo permanece aislado.',
    creadoPorUsuarioId: null
  });
  const alias = await repositorio.crearPendiente({
    destinatarioEmail: 'alias@example.test',
    destinatarioNombre: null,
    remitenteEmail: 'sender@example.test',
    remitenteNombre: null,
    asunto: 'Alias compatible', cuerpoTexto: 'Compatibilidad temporal.',
    creadoPorUsuarioId: null
  });
  assert.equal(legacy.productorVersion, VERSION_PRODUCTOR_LEGACY_CORREO);
  assert.equal(alias.productorVersion, VERSION_PRODUCTOR_LEGACY_CORREO);
  const reclamables = await repositorio.listarReclamablesLegacy(20);
  assert.equal(reclamables.some((salida) => salida.id === legacy.id), true);
  assert.equal(
    reclamables.some((salida) => salida.productorVersion === VERSION_PRODUCTOR_SQL_CORREO),
    false
  );
  const backlog = await repositorio.resumirBacklogDetenido();
  assert.equal(backlog.porOrigen.some((entrada) => entrada.origen === 'legacy'), true);
  assert.equal(backlog.porOrigen.some((entrada) => entrada.origen === 'trigger'), true);
}

async function verificarAusenciaProductorCausal() {
  const rutas = [
    '../paquetes/correo/src/ServicioCorreoPortal.js',
    '../paquetes/triggers/src/ServicioTriggers.js',
    '../apps/sentinelia-runtime/src/triggers/MotorTriggersRuntime.js',
    '../apps/sentinelia-runtime/src/BootstrapRuntime.js'
  ];
  const fuentes = await Promise.all(rutas.map(async (ruta) => ({
    ruta,
    fuente: await readFile(new URL(ruta, import.meta.url), 'utf8')
  })));
  assert.match(fuentes[0].fuente, /crearPendienteLegacy/u);
  for (const { ruta, fuente } of fuentes) {
    assert.doesNotMatch(fuente, /crearSalidaTriggerEnTransaccion/u,
      `${ruta} registró prematuramente el productor causal.`);
  }
}

async function crearFixtures(sql) {
  const sufijo = randomBytes(4).toString('hex');
  const tenantId = await insertarId(sql,
    'INSERT INTO tenants (nombre,alias) VALUES (?,?)',
    ['Tenant 5276b', `tenant-5276b-${sufijo}`]
  );
  const empresaId = await insertarId(sql,
    'INSERT INTO empresas (tenant_id,nombre,alias) VALUES (?,?,?)',
    [tenantId, 'Empresa 5276b', `empresa-5276b-${sufijo}`]
  );
  const monitorId = await insertarId(sql,
    `INSERT INTO monitores (tenant_id,empresa_id,nombre,tipo,configuracion)
     VALUES (?,?,'Monitor 5276b','ping',JSON_OBJECT())`,
    [tenantId, empresaId]
  );
  const triggerId = await insertarId(sql,
    `INSERT INTO triggers (
       tenant_id,empresa_id,nombre,tipo,activo,configuracion
     ) VALUES (?,?,?,'correo',0,JSON_OBJECT(
       'version',1,'asuntoPlantilla','Aviso {{monitor}}',
       'textoIntroduccion',NULL,'textoCierre',NULL
     ))`,
    [tenantId, empresaId, `Correo 5276b ${sufijo}`]
  );
  const asignacionId = await insertarId(sql,
    `INSERT INTO asignaciones_triggers_monitores (monitor_id,trigger_id,activo)
     VALUES (?,?,1)`,
    [monitorId, triggerId]
  );
  return crearEjecucionAdicional(sql, {
    tenantId, empresaId, monitorId, triggerId, asignacionId
  }, { clave: 'a'.repeat(64), sufijo: 'principal' });
}

async function crearEjecucionAdicional(sql, base, { clave, sufijo }) {
  const ejecucionId = await insertarId(sql,
    `INSERT INTO ejecuciones_triggers (
       asignacion_trigger_monitor_id,trigger_id,monitor_id,
       tenant_id,empresa_id,trigger_tenant_id,trigger_empresa_id,
       monitor_tenant_id,monitor_empresa_id,clave_idempotencia,
       evento_disparo,estado_ejecucion,tipo_trigger,trigger_nombre,
       monitor_nombre,iniciado_en_utc
     ) VALUES (?,?,?,?,?,?,?,?,?,?,'apertura_alerta','ejecutando',
       'correo',?,?,'2026-09-03 10:00:00.000')`,
    [
      base.asignacionId, base.triggerId, base.monitorId,
      base.tenantId, base.empresaId, base.tenantId, base.empresaId,
      base.tenantId, base.empresaId, clave,
      `Correo ${sufijo}`, `Monitor ${sufijo}`
    ]
  );
  return {
    ...base,
    ejecucionId,
    claveIdempotencia: clave,
    claveBuzon: sufijo === 'principal' ? 'b'.repeat(64) : 'd'.repeat(64),
    smtpMessageId: sufijo === 'principal'
      ? '<0123456789abcdefghijklmnopqrstuv@correo.test>'
      : '<0123456789abcdefghijklmnopqrstuw@correo.test>'
  };
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
      nombreMonitor: 'Monitor 5276b',
      tipoMonitor: 'ping',
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
      asunto: 'Apertura · Monitor 5276b',
      cuerpoBaseTexto: 'El servicio no responde.',
      origenPublico: 'https://portal.test',
      renderizadoEnUtc: '2026-09-03T10:00:00.010Z'
    },
    aceptadaEnUtc: '2026-09-03T10:00:00.030Z'
  };
}

function salidaEntrada(ids, { notificacionId }) {
  return {
    notificacionId,
    ejecucionTriggerId: String(ids.ejecucionId),
    buzonCanonico: 'ops@example.test',
    normalizacionBuzonVersion: 'buzon@1',
    claveBuzonSha256: ids.claveBuzon,
    smtpMessageId: ids.smtpMessageId,
    asunto: 'Apertura · Monitor 5276b',
    cuerpoPrivadoTexto: [
      'El servicio no responde.',
      '',
      'Dejar de recibir avisos futuros:',
      'https://portal.test/correo/desuscripcion/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
    ].join('\n'),
    creadaEnUtc: '2026-09-03T10:00:00.020Z'
  };
}

function scopeEmpresa(ids) {
  return {
    nivel: 'empresa', tenantId: String(ids.tenantId),
    empresaId: String(ids.empresaId), sitioId: null
  };
}

async function insertarId(sql, sentencia, parametros = []) {
  const [resultado] = await sql.ejecutar(sentencia, parametros);
  assert.ok(Number(resultado.insertId) > 0);
  return resultado.insertId;
}
