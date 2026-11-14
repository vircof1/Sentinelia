import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { MotorTriggersRuntime }
  from '../apps/sentinelia-runtime/src/triggers/MotorTriggersRuntime.js';
import { RepositorioArbolTriggerCorreoSql }
  from '../paquetes/correo/src/RepositorioArbolTriggerCorreoSql.js';
import { RepositorioColaCorreo }
  from '../paquetes/correo/src/RepositorioColaCorreo.js';
import { RepositorioFotografiaAdmisionTriggerCorreoSql }
  from '../paquetes/correo/src/RepositorioFotografiaAdmisionTriggerCorreoSql.js';
import { ServicioAceptacionTriggerCorreo }
  from '../paquetes/correo/src/ServicioAceptacionTriggerCorreo.js';
import { ServicioFotografiaAdmisionTriggerCorreo }
  from '../paquetes/correo/src/ServicioFotografiaAdmisionTriggerCorreo.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones }
  from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { FronteraTransaccionalLocal }
  from '../paquetes/persistencia-sql/src/FronteraTransaccionalLocal.js';
import { RepositorioMigraciones }
  from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import { RepositorioAsignacionesTriggerMonitor }
  from '../paquetes/triggers/src/RepositorioAsignacionesTriggerMonitor.js';
import { RepositorioEjecucionesTrigger }
  from '../paquetes/triggers/src/RepositorioEjecucionesTrigger.js';
import { RepositorioTriggers }
  from '../paquetes/triggers/src/RepositorioTriggers.js';
import { ResolutorEjecutorTrigger }
  from '../paquetes/triggers/src/ResolutorEjecutorTrigger.js';
import { ServicioTriggers } from '../paquetes/triggers/src/ServicioTriggers.js';
import { ValidadorTrigger } from '../paquetes/triggers/src/ValidadorTrigger.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';
import { prepararEntorno } from './correo-verificar-trigger-5-27-6c.js';

await main();

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true, '5.27.8c necesita MariaDB real.');
  const administrador = new ClienteSql(configuracion.sql);
  const nombre = `sentinelia_fixture_5278c_${randomBytes(5).toString('hex')}`;
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
    await verificarRecorridosCausales(sql, entorno);
    await verificarRollbackTrasCadaEscritura(sql, entorno);
    await verificarBootstrapYGate(sql);
    console.log(
      '[correo-trigger] OK 5.27.8c: runtime=productor_atomico ' +
        'origenes=directo_telemetria_logico eventos=apertura_cierre ' +
        'confirmacion=sin_disparo replay=causal rollback=cada_escritura ' +
        'transaccion=nucleo_monitor gate_publico=cerrado'
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
  await sql.ejecutar(`
    UPDATE triggers SET activo=1 WHERE id=?
  `, [base.trigger_id]);
  await sql.ejecutar(`
    UPDATE asignaciones_triggers_monitores
       SET eventos_disparo=JSON_ARRAY('apertura_alerta','cierre_alerta')
     WHERE id=?
  `, [base.asignacion_id]);
  await sql.ejecutar(`
    INSERT INTO destinatarios_triggers_correo (
      trigger_id,tipo,email_manual,email_manual_canonico,nombre_manual
    ) VALUES (?,'manual','runtime@example.test','runtime@example.test','Runtime')
  `, [base.trigger_id]);
  const usuarioId = await insertarId(sql, `
    INSERT INTO usuarios (
      tenant_id,empresa_id,usuario,hash_password,activo,email,email_validado
    ) VALUES (?,?,?,'fixture',0,'dormido@example.test',1)
  `, [base.tenant_id, base.empresa_id, `correo-5278c-${randomBytes(4).toString('hex')}`]);
  await sql.ejecutar(`
    INSERT INTO destinatarios_triggers_correo (trigger_id,tipo,usuario_id)
    VALUES (?,'usuario',?)
  `, [base.trigger_id, usuarioId]);

  const monitores = [{
    monitorId: Number(base.monitor_id),
    asignacionId: Number(base.asignacion_id),
    tipoMonitor: 'ping',
    nombreMonitor: base.monitor_nombre
  }];
  for (const [tipo, nombre] of [
    ['telemetria', 'Monitor telemetría 5278c'],
    ['booleano', 'Monitor lógico 5278c']
  ]) {
    const monitorId = await insertarId(sql, `
      INSERT INTO monitores (tenant_id,empresa_id,nombre,tipo,configuracion)
      VALUES (?,?,?,?,JSON_OBJECT())
    `, [base.tenant_id, base.empresa_id, nombre, tipo]);
    const asignacionId = await insertarId(sql, `
      INSERT INTO asignaciones_triggers_monitores (
        monitor_id,trigger_id,activo,eventos_disparo
      ) VALUES (?,?,1,JSON_ARRAY('apertura_alerta','cierre_alerta'))
    `, [monitorId, base.trigger_id]);
    monitores.push({ monitorId, asignacionId, tipoMonitor: tipo, nombreMonitor: nombre });
  }
  await sql.ejecutar(`
    CREATE TABLE marcadores_5278c (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      etiqueta VARCHAR(80) NOT NULL,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB
  `);
  return {
    ...base,
    monitores,
    frontera: new FronteraTransaccionalLocal(sql),
    reloj: relojMonotono()
  };
}

async function verificarRecorridosCausales(sql, entorno) {
  const { motor } = crearMotor(sql, entorno);
  const aperturasAlerta = entorno.monitores.map((monitor, indice) =>
    transicion(entorno, monitor, {
      evento: 'apertura_alerta',
      uuid: uuid(indice + 1)
    }));
  const cierresAlerta = entorno.monitores.map((monitor, indice) =>
    transicion(entorno, monitor, {
      evento: 'cierre_alerta',
      uuid: uuid(indice + 4)
    }));
  const persistenciaAlertas = { aperturasAlerta, cierresAlerta };
  const resumen = await entorno.frontera.ejecutar((conexion) =>
    motor.planificarDesdePersistenciaAlertas({ persistenciaAlertas, conexion }));
  assert.equal(resumen.totalPlanes, 6);
  assert.equal(resumen.totalNuevos, 6);
  assert.equal(resumen.totalAceptacionesAtomicas, 6);
  assert.equal(resumen.totalAceptacionesAtomicasNuevas, 6);
  assert.equal(resumen.ejecucionIds.length, 6);
  const filas = await sql.consultar(`
    SELECT n.origen_causal,n.evento_disparo,e.estado_ejecucion,
           e.codigo_resultado,COUNT(r.id) AS resultados,COUNT(DISTINCT s.id) AS salidas
      FROM notificaciones_triggers_correo n
      JOIN ejecuciones_triggers e ON e.id=n.ejecucion_trigger_id
      JOIN resultados_destinatarios_triggers_correo r
        ON r.ejecucion_trigger_id=e.id
      LEFT JOIN cola_correos_salida s ON s.ejecucion_trigger_id=e.id
     WHERE HEX(n.alerta_auditoria_id) IN (${Array(6).fill('?').join(',')})
     GROUP BY n.id,n.origen_causal,n.evento_disparo,e.estado_ejecucion,
              e.codigo_resultado
     ORDER BY n.id
  `, Array.from({ length: 6 }, (_, indice) =>
    uuid(indice + 1).replaceAll('-', '').toUpperCase()));
  assert.equal(filas.length, 6);
  assert.deepEqual([...new Set(filas.map((fila) => fila.origen_causal))].sort(),
    ['directo', 'logico', 'telemetria']);
  assert.deepEqual([...new Set(filas.map((fila) => fila.evento_disparo))].sort(),
    ['apertura_alerta', 'cierre_alerta']);
  for (const fila of filas) {
    assert.equal(fila.estado_ejecucion, 'ok');
    assert.equal(fila.codigo_resultado, 'correo_notificacion_aceptada_parcial');
    assert.equal(Number(fila.resultados), 2);
    assert.equal(Number(fila.salidas), 1);
  }

  const replay = await entorno.frontera.ejecutar((conexion) =>
    motor.planificarDesdePersistenciaAlertas({ persistenciaAlertas, conexion }));
  assert.equal(replay.totalPlanes, 6);
  assert.equal(replay.totalNuevos, 0);
  assert.equal(replay.totalAceptacionesAtomicasNuevas, 0);
  assert.equal(replay.ejecucionIds.length, 6);
  const confirmacion = await entorno.frontera.ejecutar((conexion) =>
    motor.planificarDesdePersistenciaAlertas({
      persistenciaAlertas: { confirmacionesAlerta: aperturasAlerta },
      conexion
    }));
  assert.equal(confirmacion.totalPlanes, 0);
  assert.equal(confirmacion.totalNuevos, 0);
}

async function verificarRollbackTrasCadaEscritura(sql, entorno) {
  const monitor = entorno.monitores[0];
  const alerta = transicion(entorno, monitor, {
    evento: 'apertura_alerta',
    uuid: uuid(7)
  });
  const clave = clavePlan({
    evento: 'apertura_alerta',
    alertaId: alerta.alertaAuditoriaId,
    asignacionId: monitor.asignacionId,
    triggerId: entorno.trigger_id
  });
  for (let falloTras = 1; falloTras <= 7; falloTras += 1) {
    const { motor } = crearMotor(sql, entorno);
    await assert.rejects(
      entorno.frontera.ejecutar(async (conexion) => {
        await conexion.execute(
          'INSERT INTO marcadores_5278c (etiqueta) VALUES (?)',
          [`fallo-${falloTras}`]
        );
        return motor.planificarDesdePersistenciaAlertas({
          persistenciaAlertas: { aperturasAlerta: [alerta] },
          conexion: conexionConFallo(conexion, falloTras)
        });
      }),
      (error) => error?.codigo === 'fallo_inyectado_5278c' &&
        error?.numeroEscritura === falloTras
    );
    const [estado] = await sql.consultar(`
      SELECT
        (SELECT COUNT(*) FROM marcadores_5278c) AS marcadores,
        (SELECT COUNT(*) FROM ejecuciones_triggers WHERE clave_idempotencia=?) AS ejecuciones
    `, [clave]);
    assert.deepEqual([Number(estado.marcadores), Number(estado.ejecuciones)], [0, 0]);
  }
}

async function verificarBootstrapYGate(sql) {
  const [bootstrap, runtime] = await Promise.all([
    readFile(new URL('../apps/sentinelia-runtime/src/BootstrapRuntime.js', import.meta.url),
      'utf8'),
    readFile(new URL('../apps/sentinelia-runtime/src/RuntimeSentinelia.js', import.meta.url),
      'utf8')
  ]);
  assert.match(bootstrap, /ServicioAceptacionTriggerCorreo/u);
  assert.match(bootstrap, /RepositorioFotografiaAdmisionTriggerCorreoSql/u);
  assert.match(runtime,
    /planificarDesdePersistenciaAlertas\(\{[\s\S]*?persistenciaAlertas,[\s\S]*?conexion/u);
  const [gate] = await sql.consultar(`
    SELECT tipo_correo_habilitado,cola_sql_autoritativa
      FROM estado_despliegue_trigger_correo WHERE id=1
  `);
  assert.deepEqual([
    Number(gate.tipo_correo_habilitado),
    Number(gate.cola_sql_autoritativa)
  ], [0, 0]);
}

function crearMotor(sql, entorno) {
  const repositorioEjecuciones = new RepositorioEjecucionesTrigger(sql);
  const repositorioArbol = new RepositorioArbolTriggerCorreoSql(sql);
  const servicioAceptacion = new ServicioAceptacionTriggerCorreo({
    servicioFotografiaAdmision: new ServicioFotografiaAdmisionTriggerCorreo({
      repositorio: new RepositorioFotografiaAdmisionTriggerCorreoSql(),
      evaluadorAutoridadCorreoSql: autoridadCorreo()
    }),
    repositorioEjecucionesTrigger: repositorioEjecuciones,
    repositorioArbolTriggerCorreo: repositorioArbol,
    repositorioColaCorreo: new RepositorioColaCorreo(sql),
    reloj: entorno.reloj
  });
  const servicioTriggers = new ServicioTriggers({
    repositorioTriggers: new RepositorioTriggers(sql),
    repositorioAsignacionesTriggerMonitor:
      new RepositorioAsignacionesTriggerMonitor(sql),
    repositorioEjecucionesTrigger: repositorioEjecuciones,
    repositorioArbolTriggerCorreo: repositorioArbol,
    validadorTrigger: new ValidadorTrigger(),
    resolutorEjecutorTrigger: new ResolutorEjecutorTrigger({
      ejecutores: [servicioAceptacion]
    })
  });
  return { motor: new MotorTriggersRuntime({ servicioTriggers }) };
}

function autoridadCorreo() {
  const valores = new Map([
    ['portal.origen_publico', 'https://sentinelia.example'],
    ['portal.nombre_visible', 'Sentinelia']
  ]);
  return {
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
  };
}

function transicion(entorno, monitor, { evento, uuid: alertaAuditoriaId }) {
  return {
    tipoEventoDisparo: evento,
    alertaAuditoriaId,
    monitorId: monitor.monitorId,
    tenantId: Number(entorno.tenant_id),
    empresaId: Number(entorno.empresa_id),
    sitioId: entorno.sitio_id == null ? null : Number(entorno.sitio_id),
    tipoMonitor: monitor.tipoMonitor,
    nombreMonitor: monitor.nombreMonitor,
    fechaOcurrenciaUtc: evento === 'apertura_alerta'
      ? '2026-09-03T10:00:00.000Z'
      : '2026-09-03T10:00:00.005Z',
    validoDesdeUtc: '2026-09-03T10:00:00.000Z',
    codigoResultado: evento === 'apertura_alerta' ? 'timeout' : 'recuperado',
    mensajeResultado: evento === 'apertura_alerta'
      ? 'Sin respuesta.'
      : 'Servicio recuperado.',
    payloadAlerta: {
      descripcionFallo: 'Contexto humano del ciclo.',
      posibleSolucion: 'Revisar el servicio.'
    }
  };
}

function conexionConFallo(conexion, falloTras) {
  let escrituras = 0;
  return {
    async execute(sql, parametros) {
      const resultado = await conexion.execute(sql, parametros);
      if (esEscrituraCorreo(sql)) {
        escrituras += 1;
        if (escrituras === falloTras) {
          throw Object.assign(new Error(`Fallo tras escritura ${falloTras}.`), {
            codigo: 'fallo_inyectado_5278c',
            numeroEscritura: falloTras
          });
        }
      }
      return resultado;
    },
    query: conexion.query.bind(conexion)
  };
}

function esEscrituraCorreo(sql) {
  return /^\s*(?:INSERT\s+INTO|UPDATE)\s+(?:ejecuciones_triggers|notificaciones_triggers_correo|cola_correos_salida|capacidades_desuscripcion_correo|resultados_destinatarios_triggers_correo)/iu.test(
    String(sql)
  );
}

function uuid(indice) {
  return `0199a9f0-7b5c-7a55-b32a-82${String(indice).padStart(10, '0')}`;
}

function clavePlan({ evento, alertaId, asignacionId, triggerId }) {
  return createHash('sha256')
    .update([evento, alertaId, asignacionId, triggerId].join(':'))
    .digest('hex');
}

function relojMonotono() {
  let marca = Date.parse('2026-09-03T10:00:00.100Z');
  return () => new Date(marca++);
}

async function insertarId(sql, sentencia, parametros = []) {
  const [resultado] = await sql.ejecutar(sentencia, parametros);
  return Number(resultado.insertId);
}
