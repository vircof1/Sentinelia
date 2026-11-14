import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';

import { ClienteSmtp, clasificarErrorSmtpTrigger }
  from '../paquetes/correo/src/ClienteSmtp.js';
import { DespachadorCorreoSql }
  from '../paquetes/correo/src/DespachadorCorreoSql.js';
import {
  PERFIL_CAPACIDAD_DESUSCRIPCION_TRIGGER_CORREO,
  PERFIL_FOTOGRAFIA_CAUSAL_TRIGGER_CORREO,
  PERFIL_MENSAJE_MATERIALIZADO_TRIGGER_CORREO
} from '../paquetes/correo/src/ContratoTriggerCorreo.js';
import { prepararDesuscripcionPrivadaTriggerCorreo }
  from '../paquetes/correo/src/PreparadorDesuscripcionTriggerCorreo.js';
import { RepositorioArbolTriggerCorreoSql }
  from '../paquetes/correo/src/RepositorioArbolTriggerCorreoSql.js';
import { RepositorioColaCorreo }
  from '../paquetes/correo/src/RepositorioColaCorreo.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { FronteraTransaccionalLocal }
  from '../paquetes/persistencia-sql/src/FronteraTransaccionalLocal.js';
import { RepositorioMigraciones }
  from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true, '5.27.6c necesita MariaDB real.');
  const administrador = new ClienteSql(configuracion.sql);
  const nombre = `sentinelia_fixture_5276c_${randomBytes(5).toString('hex')}`;
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

    const entorno = await prepararEntorno(sql);
    await verificarClaimSql(sql, entorno);
    await verificarDespachoYClasificacion(sql, entorno);
    verificarClasificadorConservador();
    await verificarGateProductivoCerrado();
    console.log(
      '[correo-trigger] OK 5.27.6c: claim=sql_cas reloj=mariadb ' +
        'intento=durable_antes_red sobre=un_buzon dialogo=uno ' +
        'message_id=estable resultados=cerrados gate_productivo=cerrado'
    );
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(nombre)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

async function verificarClaimSql(sql, { cola, salidaIds }) {
  const frontera = new FronteraTransaccionalLocal(sql);
  const claim = await frontera.ejecutar((conexion) => cola.reclamarSiguienteTrigger({
    propietarioClaim: 'fixture-claim-a', leaseMilisegundos: 120_000
  }, { conexion }));
  assert.equal(String(claim.salida.id), String(salidaIds[0]));
  assert.match(claim.claimId, /^[0-9a-f]{64}$/u);
  assert.equal(claim.fencingToken, '1');
  const [fila] = await sql.consultar(
    `SELECT estado, estado_previo_reclamacion,
            lease_expira_utc > reclamada_en_utc AS lease_positiva,
            ABS(TIMESTAMPDIFF(MICROSECOND, reclamada_en_utc,
              fecha_actualizacion)) < 2000000 AS reloj_sql
       FROM cola_correos_salida WHERE id=?`,
    [salidaIds[0]]
  );
  assert.deepEqual({
    estado: fila.estado,
    previo: fila.estado_previo_reclamacion,
    lease: Number(fila.lease_positiva),
    reloj: Number(fila.reloj_sql)
  }, { estado: 'reclamada', previo: 'pendiente', lease: 1, reloj: 1 });

  const segunda = await frontera.ejecutar((conexion) => cola.reclamarSiguienteTrigger({
    propietarioClaim: 'fixture-claim-b', leaseMilisegundos: 120_000
  }, { conexion }));
  assert.notEqual(String(segunda.salida.id), String(claim.salida.id));
  await frontera.ejecutar((conexion) => cola.liberarReclamacionTrigger({
    ...identidad(claim), codigo: 'fixture_liberada'
  }, { conexion }));
  await frontera.ejecutar((conexion) => cola.liberarReclamacionTrigger({
    ...identidad(segunda), codigo: 'fixture_liberada'
  }, { conexion }));
}

async function verificarDespachoYClasificacion(sql, { cola, salidaIds }) {
  const llamadas = [];
  const comportamientos = [
    { accepted: ['ops0@example.test'], rejected: [], response: '250 aceptado' },
    Object.assign(new Error('421 temporal clave-supersecreta'), {
      responseCode: 421, command: 'RCPT TO', code: 'EENVELOPE'
    }),
    Object.assign(new Error('550 buzón ausente'), {
      responseCode: 550, command: 'RCPT TO', code: 'EENVELOPE'
    }),
    Object.assign(new Error('timeout después de DATA'), {
      code: 'ETIMEDOUT', command: 'DATA'
    }),
    { accepted: ['ops1@example.test'], rejected: [], response: '250 reintento aceptado' },
    Object.assign(new Error('421 temporal final'), {
      responseCode: 421, command: 'RCPT TO', code: 'EENVELOPE'
    })
  ];
  const clienteSmtp = new ClienteSmtp({
    fabricaTransport: () => ({
      async sendMail(mensaje) {
        llamadas.push(structuredClone(mensaje));
        const [intentos] = await sql.consultar(
          `SELECT COUNT(*) AS total FROM intentos_correos_salida
            WHERE estado='en_curso'`
        );
        assert.equal(Number(intentos.total), 1,
          'El intento debe estar committed antes de tocar la red.');
        const comportamiento = comportamientos.shift();
        if (comportamiento instanceof Error) throw comportamiento;
        return { ...comportamiento, messageId: mensaje.messageId };
      },
      close() {}
    })
  });
  const configuracion = configuracionSmtp();
  const autoridad = {
    async evaluarEnTransaccion() {
      return {
        puedeDespachar: true,
        codigo: 'correo_smtp_verificado',
        versionConfiguracion: '7',
        configuracion
      };
    }
  };
  const despachador = new DespachadorCorreoSql({
    fronteraTransaccional: new FronteraTransaccionalLocal(sql),
    repositorioColaCorreo: cola,
    evaluadorAutoridadCorreoSql: autoridad,
    clienteSmtp,
    identificadorInstancia: 'fixture-despachador',
    leaseMilisegundos: 120_000,
    margenConsolidacionMs: 1_000
  });

  const estados = [];
  for (let indice = 0; indice < 4; indice += 1) {
    estados.push((await despachador.despacharSiguiente()).estadoSalida);
  }
  assert.deepEqual(estados, [
    'enviado', 'error_reintentable', 'error_final', 'resultado_ambiguo'
  ]);
  assert.equal(llamadas.length, 4);
  for (const [indice, mensaje] of llamadas.entries()) {
    assert.deepEqual(mensaje.envelope.to, [`ops${indice}@example.test`]);
    assert.deepEqual(mensaje.to, [{ address: `ops${indice}@example.test` }]);
    assert.equal(mensaje.messageId, messageId(indice));
    assert.equal(Object.hasOwn(mensaje, 'cc'), false);
    assert.equal(Object.hasOwn(mensaje, 'bcc'), false);
  }

  await sql.ejecutar(
    `UPDATE cola_correos_salida SET proximo_intento_en=UTC_TIMESTAMP(3)
      WHERE id=? AND estado='error_reintentable'`,
    [salidaIds[1]]
  );
  const reintento = await despachador.despacharSiguiente();
  assert.equal(reintento.estadoSalida, 'enviado');
  assert.equal(llamadas[4].messageId, messageId(1));
  const intentosReintento = await sql.consultar(
    `SELECT numero, smtp_message_id, estado FROM intentos_correos_salida
      WHERE salida_correo_id=? ORDER BY numero`,
    [salidaIds[1]]
  );
  assert.deepEqual(intentosReintento.map((fila) => [
    Number(fila.numero), fila.smtp_message_id, fila.estado
  ]), [
    [1, messageId(1), 'fallido_reintentable'],
    [2, messageId(1), 'aceptado']
  ]);
  const [saneado] = await sql.consultar(
    `SELECT respuesta_saneada FROM intentos_correos_salida
      WHERE salida_correo_id=? AND numero=1`,
    [salidaIds[1]]
  );
  assert.doesNotMatch(saneado.respuesta_saneada, /supersecreta/u);

  const sinAutoridad = new DespachadorCorreoSql({
    fronteraTransaccional: new FronteraTransaccionalLocal(sql),
    repositorioColaCorreo: cola,
    evaluadorAutoridadCorreoSql: {
      async evaluarEnTransaccion() {
        return { puedeDespachar: false, codigo: 'correo_smtp_no_verificado' };
      }
    },
    clienteSmtp,
    identificadorInstancia: 'fixture-sin-autoridad',
    leaseMilisegundos: 120_000
  });
  const llamadasAntes = llamadas.length;
  const omitido = await sinAutoridad.despacharSiguiente();
  assert.equal(omitido.motivo, 'correo_smtp_no_verificado');
  assert.equal(llamadas.length, llamadasAntes);
  assert.equal((await cola.buscarPorId(salidaIds[4])).estado, 'pendiente');

  let evaluacionesCarrera = 0;
  const pierdeAutoridad = new DespachadorCorreoSql({
    fronteraTransaccional: new FronteraTransaccionalLocal(sql),
    repositorioColaCorreo: cola,
    evaluadorAutoridadCorreoSql: {
      async evaluarEnTransaccion() {
        evaluacionesCarrera += 1;
        return evaluacionesCarrera === 1
          ? { puedeDespachar: true, codigo: 'correo_smtp_verificado' }
          : { puedeDespachar: false, codigo: 'correo_smtp_no_verificado' };
      }
    },
    clienteSmtp,
    identificadorInstancia: 'fixture-pierde-autoridad',
    leaseMilisegundos: 120_000
  });
  const carrera = await pierdeAutoridad.despacharSiguiente();
  assert.equal(carrera.motivo, 'correo_smtp_no_verificado');
  assert.equal(evaluacionesCarrera, 2);
  assert.equal(llamadas.length, llamadasAntes);
  assert.equal((await cola.buscarPorId(salidaIds[4])).estado, 'pendiente');

  const falloFinalPendiente = await despachador.despacharSiguiente();
  assert.equal(falloFinalPendiente.estadoSalida, 'error_reintentable');
  await sql.ejecutar(
    `UPDATE cola_correos_salida SET proximo_intento_en=UTC_TIMESTAMP(3)
      WHERE id=?`, [salidaIds[4]]
  );
  configuracion.maxReintentos = 0;
  const agotado = await despachador.despacharSiguiente();
  assert.equal(agotado.estadoSalida, 'error_final');
  assert.equal(agotado.motivo, 'smtp_reintentos_agotados');
  assert.equal(llamadas.length, llamadasAntes + 1,
    'Cerrar por política no puede abrir otra conexión SMTP.');
}

function verificarClasificadorConservador() {
  assert.equal(clasificarErrorSmtpTrigger({
    code: 'ETIMEDOUT', command: 'DATA', message: 'incierto'
  }).estado, 'ambiguo');
  assert.equal(clasificarErrorSmtpTrigger({
    code: 'ECONNECTION', command: 'CONN', message: 'sin conexión'
  }).estado, 'fallido_reintentable');
  assert.equal(clasificarErrorSmtpTrigger({
    responseCode: 535, command: 'AUTH', message: 'credencial rechazada'
  }).estado, 'fallido_final');
}

async function verificarGateProductivoCerrado() {
  const { readFile } = await import('node:fs/promises');
  const [bootstrap, servicio, runtime] = await Promise.all([
    '../apps/sentinelia-runtime/src/BootstrapRuntime.js',
    '../paquetes/correo/src/ServicioCorreoPortal.js',
    '../apps/sentinelia-runtime/src/correo/DespachadorCorreoRuntime.js'
  ].map((ruta) => readFile(new URL(ruta, import.meta.url), 'utf8')));
  assert.match(bootstrap, /DespachadorCorreoSql/u);
  assert.doesNotMatch(servicio, /crearSalidaTriggerEnTransaccion/u);
  assert.match(runtime, /cola_sql_autoritativa/u);
}

export async function prepararEntorno(sql, {
  claveIdempotencia = 'a'.repeat(64),
  prefijoMessageId = '5276c'
} = {}) {
  const sufijo = randomBytes(4).toString('hex');
  const tenantId = await insertarId(sql,
    'INSERT INTO tenants (nombre,alias) VALUES (?,?)',
    ['Tenant 5276c', `tenant-5276c-${sufijo}`]);
  const empresaId = await insertarId(sql,
    'INSERT INTO empresas (tenant_id,nombre,alias) VALUES (?,?,?)',
    [tenantId, 'Empresa 5276c', `empresa-5276c-${sufijo}`]);
  const monitorId = await insertarId(sql,
    `INSERT INTO monitores (tenant_id,empresa_id,nombre,tipo,configuracion)
     VALUES (?,?,'Monitor 5276c','ping',JSON_OBJECT())`, [tenantId, empresaId]);
  const triggerId = await insertarId(sql,
    `INSERT INTO triggers (tenant_id,empresa_id,nombre,tipo,activo,configuracion)
     VALUES (?,?,'Correo 5276c','correo',0,JSON_OBJECT(
       'version',1,'asuntoPlantilla','Aviso {{monitor}}',
       'textoIntroduccion',NULL,'textoCierre',NULL))`, [tenantId, empresaId]);
  const asignacionId = await insertarId(sql,
    `INSERT INTO asignaciones_triggers_monitores (monitor_id,trigger_id,activo)
     VALUES (?,?,1)`, [monitorId, triggerId]);
  const ejecucionId = await insertarId(sql,
    `INSERT INTO ejecuciones_triggers (
       asignacion_trigger_monitor_id,trigger_id,monitor_id,
       tenant_id,empresa_id,trigger_tenant_id,trigger_empresa_id,
       monitor_tenant_id,monitor_empresa_id,clave_idempotencia,
       evento_disparo,estado_ejecucion,tipo_trigger,trigger_nombre,
       monitor_nombre,iniciado_en_utc
     ) VALUES (?,?,?,?,?,?,?,?,?,?,'apertura_alerta','ejecutando',
       'correo','Correo 5276c','Monitor 5276c','2026-09-03 10:00:00.000')`,
    [asignacionId, triggerId, monitorId, tenantId, empresaId, tenantId, empresaId,
      tenantId, empresaId, claveIdempotencia]);
  const ids = { tenantId, empresaId, monitorId, triggerId, asignacionId, ejecucionId };
  const arbol = new RepositorioArbolTriggerCorreoSql(sql);
  const cola = new RepositorioColaCorreo(sql);
  const conexion = await sql.obtenerConexion();
  const salidaIds = [];
  try {
    await conexion.beginTransaction();
    const notificacion = await arbol.crearNotificacionEnTransaccion(
      notificacionEntrada(ids, claveIdempotencia), { conexion });
    for (let indice = 0; indice < 5; indice += 1) {
      const desuscripcion = prepararDesuscripcionPrivadaTriggerCorreo({
        triggerId: String(triggerId),
        ttlDias: 30,
        origenPublico: 'https://portal.test',
        cuerpoBaseTexto: `Cuerpo privado ${indice}`
      });
      const salida = await cola.crearSalidaTriggerEnTransaccion({
        notificacionId: String(notificacion.id),
        ejecucionTriggerId: String(ejecucionId),
        buzonCanonico: `ops${indice}@example.test`,
        normalizacionBuzonVersion: 'buzon@1',
        claveBuzonSha256: randomBytes(32).toString('hex'),
        smtpMessageId: messageId(indice, prefijoMessageId),
        asunto: `Aviso ${indice}`,
        cuerpoPrivadoTexto: desuscripcion.cuerpoPrivadoTexto,
        creadaEnUtc: '2026-09-03T10:00:00.020Z'
      }, { conexion });
      await arbol.crearCapacidadEnTransaccion({
        perfil: PERFIL_CAPACIDAD_DESUSCRIPCION_TRIGGER_CORREO,
        version: 1,
        salidaId: String(salida.id),
        triggerId: String(triggerId),
        tokenHashSha256: desuscripcion.tokenHashSha256,
        ttlDias: desuscripcion.ttlDias,
        estado: 'preparada',
        emitidaEnUtc: null,
        expiraEnUtc: null
      }, { conexion });
      salidaIds.push(salida.id);
    }
    await conexion.commit();
  } catch (error) {
    await conexion.rollback();
    throw error;
  } finally {
    conexion.release();
  }
  return { cola, salidaIds };
}

function notificacionEntrada(ids, claveIdempotencia = 'a'.repeat(64)) {
  return {
    revisionDeclaracion: '1', ejecucionTriggerId: String(ids.ejecucionId),
    claveIdempotencia,
    definicionMensaje: {
      version: 1, asuntoPlantilla: 'Aviso {{monitor}}',
      textoIntroduccion: null, textoCierre: null
    },
    fotografiaCausal: {
      perfil: PERFIL_FOTOGRAFIA_CAUSAL_TRIGGER_CORREO, version: 1,
      ejecucionTriggerId: String(ids.ejecucionId), claveIdempotencia,
      triggerId: String(ids.triggerId), asignacionId: String(ids.asignacionId),
      monitorId: String(ids.monitorId),
      alertaAuditoriaId: '0199a9f0-7b5c-7a55-b32a-222222222222',
      eventoDisparo: 'apertura_alerta', fechaOcurrenciaUtc: '2026-09-03T10:00:00.000Z',
      validoDesdeUtc: '2026-09-03T09:59:59.000Z', nombreMonitor: 'Monitor 5276c',
      tipoMonitor: 'ping', estadoMonitor: 'indisponible', origenCausal: 'directo',
      codigoResultado: 'timeout', mensajeResultado: 'Sin respuesta',
      contextoHumano: { descripcionFallo: 'No responde.', posibleSolucion: null },
      scopeTrigger: scope(ids), scopeMonitor: scope(ids),
      referencias: {
        estadoUrl: `https://portal.test/monitores/${ids.monitorId}`,
        historicoUrl: `https://portal.test/monitores/historico?monitor_id=${ids.monitorId}`
      }
    },
    mensajeMaterializado: {
      perfil: PERFIL_MENSAJE_MATERIALIZADO_TRIGGER_CORREO, version: 1,
      asunto: 'Apertura · Monitor 5276c', cuerpoBaseTexto: 'No responde.',
      origenPublico: 'https://portal.test', renderizadoEnUtc: '2026-09-03T10:00:00.010Z'
    },
    aceptadaEnUtc: '2026-09-03T10:00:00.030Z'
  };
}

export function configuracionSmtp() {
  return {
    smtpHost: 'smtp.example.test', smtpPuerto: 25, smtpSecure: false,
    smtpUsuario: 'operador', smtpPassword: 'clave-supersecreta', smtpAuthMethod: '',
    smtpTimeoutConexionMs: 5_000, smtpTimeoutSaludoMs: 5_000,
    smtpTimeoutSocketMs: 10_000, smtpTlsPermitirInseguro: false,
    remitenteEmail: 'sender@example.test', remitenteNombre: 'Sentinelia',
    maxReintentos: 2, reintentoBaseSegundos: 1
  };
}

function identidad(claim) {
  return {
    reclamacionId: claim.reclamacionId, salidaId: String(claim.salida.id),
    claimId: claim.claimId, leaseToken: claim.leaseToken,
    propietarioClaim: claim.propietarioClaim, fencingToken: claim.fencingToken
  };
}

function messageId(indice, prefijo = '5276c') {
  return `<${prefijo}${String(indice).padStart(27, '0')}@correo.test>`;
}

function scope(ids) {
  return { nivel: 'empresa', tenantId: String(ids.tenantId),
    empresaId: String(ids.empresaId), sitioId: null };
}

async function insertarId(sql, sentencia, parametros = []) {
  const [resultado] = await sql.ejecutar(sentencia, parametros);
  return resultado.insertId;
}
