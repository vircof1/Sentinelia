import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { ClienteSmtp } from '../paquetes/correo/src/ClienteSmtp.js';
import { DespachadorCorreoSql }
  from '../paquetes/correo/src/DespachadorCorreoSql.js';
import { EvaluadorAutoridadCorreoSql }
  from '../paquetes/correo/src/EvaluadorAutoridadCorreoSql.js';
import { KeyringTecnicoCorreo }
  from '../paquetes/correo/src/KeyringTecnicoCorreo.js';
import { PerfilSmtpCorreo } from '../paquetes/correo/src/PerfilSmtpCorreo.js';
import { RepositorioArbolTriggerCorreoSql }
  from '../paquetes/correo/src/RepositorioArbolTriggerCorreoSql.js';
import { RepositorioAudienciaTriggerCorreoSql }
  from '../paquetes/correo/src/RepositorioAudienciaTriggerCorreoSql.js';
import { RepositorioColaCorreo }
  from '../paquetes/correo/src/RepositorioColaCorreo.js';
import { RepositorioDesuscripcionTriggerCorreoSql }
  from '../paquetes/correo/src/RepositorioDesuscripcionTriggerCorreoSql.js';
import { RepositorioFotografiaAdmisionTriggerCorreoSql }
  from '../paquetes/correo/src/RepositorioFotografiaAdmisionTriggerCorreoSql.js';
import { ServicioAceptacionTriggerCorreo }
  from '../paquetes/correo/src/ServicioAceptacionTriggerCorreo.js';
import { ServicioActivacionTriggerCorreo }
  from '../paquetes/correo/src/ServicioActivacionTriggerCorreo.js';
import { ServicioAudienciaTriggerCorreo }
  from '../paquetes/correo/src/ServicioAudienciaTriggerCorreo.js';
import { ServicioCorteAutoridadColaCorreo }
  from '../paquetes/correo/src/ServicioCorteAutoridadColaCorreo.js';
import { ServicioCorteAutoridadOrigenCorreo }
  from '../paquetes/correo/src/ServicioCorteAutoridadOrigenCorreo.js';
import { ServicioCorteRevisionTriggersCorreo }
  from '../paquetes/correo/src/ServicioCorteRevisionTriggersCorreo.js';
import { ServicioCorteVerificacionSmtpCorreo }
  from '../paquetes/correo/src/ServicioCorteVerificacionSmtpCorreo.js';
import { ServicioDesuscripcionTriggerCorreo }
  from '../paquetes/correo/src/ServicioDesuscripcionTriggerCorreo.js';
import { ServicioFotografiaAdmisionTriggerCorreo }
  from '../paquetes/correo/src/ServicioFotografiaAdmisionTriggerCorreo.js';
import { ValidadorConfiguracionCorreo }
  from '../paquetes/correo/src/ValidadorConfiguracionCorreo.js';
import {
  CAPACIDADES_RUNTIME_TRIGGER_CORREO,
  CAPACIDADES_WEB_TRIGGER_CORREO,
  PERFIL_DESPLIEGUE_TRIGGER_CORREO,
  RepositorioPreparacionDespliegueTriggerCorreoSql,
  crearDeclaracionCompatibilidadRuntimeTriggerCorreo,
  evaluarPreparacionLocalTriggerCorreo,
  evaluarUnanimidadPreparacionTriggerCorreo
} from '../paquetes/correo/src/CompatibilidadDespliegueTriggerCorreo.js';
import { RepositorioAuditoria }
  from '../paquetes/auditoria/src/RepositorioAuditoria.js';
import { ServicioAuditoriaOperativa }
  from '../paquetes/auditoria/src/ServicioAuditoriaOperativa.js';
import { RepositorioConfiguracion }
  from '../paquetes/configuracion/src/RepositorioConfiguracion.js';
import { ServicioConfiguracionPortal }
  from '../paquetes/configuracion/src/ServicioConfiguracionPortal.js';
import { obtenerDefinicionesConfiguracionPortal }
  from '../paquetes/configuracion/src/obtenerDefinicionesConfiguracionPortal.js';
import { RepositorioMonitores }
  from '../paquetes/monitores/src/RepositorioMonitores.js';
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
import { ServicioTriggers } from '../paquetes/triggers/src/ServicioTriggers.js';
import { ValidadorTrigger } from '../paquetes/triggers/src/ValidadorTrigger.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

const ADMIN = Object.freeze({
  idUsuario: 1,
  idUsuarioReal: 1,
  nivelScope: 'portal',
  permisos: Object.freeze({ administrarConfiguracion: true, verAuditoria: true })
});

await main();

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true, '5.27.14b necesita MariaDB real.');
  const administrador = new ClienteSql(configuracion.sql);
  const nombre = `sentinelia_fixture_52714b_${randomBytes(5).toString('hex')}`;
  let sql;
  try {
    await administrador.ejecutar(
      `CREATE DATABASE ${administrador.escaparIdentificador(nombre)} ` +
        'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
    );
    sql = new ClienteSql({ ...configuracion.sql, baseDatos: nombre });
    const repositorioMigraciones = new RepositorioMigraciones(sql);
    const migraciones = await new EjecutorMigraciones({
      clienteSql: sql,
      repositorioMigraciones,
      rutaMigraciones: obtenerRutaMigraciones()
    }).ejecutarPendientes();
    assert.equal(migraciones.integridad.ok, true);
    const contexto = await prepararAutoridad(sql, configuracion);
    const dominio = await prepararDominio(sql, contexto);
    await verificarCicloProductivo(sql, contexto, dominio);
    await verificarReinicioPublicable(sql, contexto, repositorioMigraciones,
      migraciones.integridad.ok);
    console.log(
      '[correo-trigger] OK 5.27.14b: gate=apertura_conjunta ' +
        'trigger=creado_y_activado ciclo=apertura_cierre entregas=2 ' +
        'smtp=aceptado desuscripcion=durable consumidor=continua ' +
        'reinicio=compatible ciclo_productivo=verificado'
    );
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(nombre)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

async function prepararAutoridad(sql, configuracionAplicacion) {
  const frontera = new FronteraTransaccionalLocal(sql);
  const repositorioConfiguracion = new RepositorioConfiguracion(sql);
  const perfil = new PerfilSmtpCorreo({
    keyringTecnicoCorreo: new KeyringTecnicoCorreo({
      keyring: { activa: Buffer.alloc(32, 0x7b).toString('base64') },
      keyIdActiva: 'activa'
    })
  });
  let versionRedis = null;
  const versionador = {
    async obtenerVersionActual() { return versionRedis; },
    async publicarVersion(version) {
      versionRedis = Number(version);
      return versionRedis;
    }
  };
  const servicioConfiguracion = new ServicioConfiguracionPortal({
    repositorioConfiguracion,
    versionadorConfiguracionRedis: versionador,
    definiciones: obtenerDefinicionesConfiguracionPortal(configuracionAplicacion),
    fronteraTransaccional: frontera,
    servicioAuditoria: { async registrarEnTransaccion() {} },
    perfilSmtpCorreo: perfil
  });
  await servicioConfiguracion.bootstrapYcargar();
  await configurarCanal(sql);
  await sql.ejecutar(
    `UPDATE estado_despliegue_trigger_correo
        SET estado='activado', guard_metadatos_activo=1,
            origen_portal_autoritativo=1, verificacion_smtp_autoritativa=1,
            guard_verificacion_legacy_activo=1,
            guard_revision_trigger_activo=1, cola_sql_autoritativa=1,
            tipo_correo_habilitado=0, cortado_en_utc=UTC_TIMESTAMP(3),
            quietud_iniciada_en_utc=UTC_TIMESTAMP(3),
            quietud_observada_en_utc=UTC_TIMESTAMP(3),
            activado_en_utc=UTC_TIMESTAMP(3), revision=7
      WHERE id=1`
  );
  await sql.ejecutar('UPDATE cabecera_configuracion_portal SET version=version+1 WHERE id=1');
  const [cabecera] = await sql.consultar(
    'SELECT CAST(version AS CHAR) AS version FROM cabecera_configuracion_portal WHERE id=1'
  );
  await versionador.publicarVersion(cabecera.version);
  await servicioConfiguracion.cargarDesdePersistencia(cabecera.version);
  const evaluador = new EvaluadorAutoridadCorreoSql({
    repositorioConfiguracion,
    perfilSmtpCorreo: perfil,
    validadorConfiguracionCorreo: new ValidadorConfiguracionCorreo()
  });
  const lectura = await frontera.ejecutar((conexion) =>
    repositorioConfiguracion.bloquearAutoridadCorreoEnTransaccion({
      conexion, modo: 'compartido'
    }));
  const prueba = perfil.crearPrueba(lectura.valores);
  await servicioConfiguracion.promoverCorreoSmtpVerificado({
    pruebaToken: {
      perfilSmtp: prueba.perfilVersion,
      perfilBuzon: prueba.perfilBuzon,
      keyId: prueba.keyId,
      huellaConfiguracion: prueba.huellaHmac.toString('hex')
    },
    contextoUsuarioActual: ADMIN
  });
  const unanimidad = {
    unanimidad: true,
    gateAbierto: false,
    perfil: PERFIL_DESPLIEGUE_TRIGGER_CORREO
  };
  const activador = new ServicioActivacionTriggerCorreo({
    repositorioConfiguracion,
    evaluadorAutoridadCorreoSql: evaluador,
    fronteraTransaccional: frontera,
    versionadorConfiguracionRedis: versionador
  });
  return {
    frontera, repositorioConfiguracion, servicioConfiguracion, evaluador,
    versionador, unanimidad, activador
  };
}

async function prepararDominio(sql, contexto) {
  const repositorioTriggers = new RepositorioTriggers(sql);
  const repositorioAsignaciones = new RepositorioAsignacionesTriggerMonitor(sql);
  const servicioTriggers = new ServicioTriggers({
    repositorioTriggers,
    repositorioAsignacionesTriggerMonitor: repositorioAsignaciones,
    repositorioMonitores: new RepositorioMonitores(sql),
    validadorTrigger: new ValidadorTrigger(),
    servicioConfiguracionPortal: contexto.servicioConfiguracion
  });
  const sufijo = randomBytes(4).toString('hex');
  const tenantId = await insertarId(sql,
    'INSERT INTO tenants (nombre,alias) VALUES (?,?)',
    ['Tenant 52714b', `tenant-52714b-${sufijo}`]);
  const empresaId = await insertarId(sql,
    'INSERT INTO empresas (tenant_id,nombre,alias) VALUES (?,?,?)',
    [tenantId, 'Empresa 52714b', `empresa-52714b-${sufijo}`]);
  const monitorId = await insertarId(sql,
    `INSERT INTO monitores (tenant_id,empresa_id,nombre,tipo,configuracion)
     VALUES (?,?,'Monitor controlado 52714b','ping',JSON_OBJECT())`,
    [tenantId, empresaId]);
  const definicion = {
    nombre: 'Correo controlado 52714b',
    tipo: 'correo',
    descripcion: 'Cierre productivo de la serie.',
    activo: false,
    nivelPertenencia: 'empresa',
    tenantId,
    empresaId,
    sitioId: null,
    configuracion: {
      version: 1,
      asuntoPlantilla: '[Sentinelia] {{estado}} · {{monitor}}',
      textoIntroduccion: 'Contexto controlado',
      textoCierre: 'Fin del aviso'
    }
  };
  await assert.rejects(
    servicioTriggers.crearTrigger(definicion),
    (error) => error?.codigo === 'trigger_correo_no_habilitado'
  );
  assert.equal((await sql.consultar("SELECT id FROM triggers WHERE tipo='correo'")).length, 0);
  const activada = await contexto.activador.activar({
    preparacionUnanime: contexto.unanimidad
  });
  assert.deepEqual([activada.fase, activada.cambioEfectivo], ['publicada', true]);
  await contexto.servicioConfiguracion.asegurarActualizada();
  const triggerInicial = await servicioTriggers.crearTrigger(definicion);
  const servicioAudiencia = new ServicioAudienciaTriggerCorreo({
    repositorioAudiencia: new RepositorioAudienciaTriggerCorreoSql(),
    fronteraTransaccional: contexto.frontera
  });
  const audiencia = await servicioAudiencia.agregarManual({
    triggerId: triggerInicial.id,
    revisionDeclaracion: triggerInicial.revisionDeclaracion,
    email: 'destino@example.test',
    nombre: 'Destino controlado'
  });
  const asignacion = await servicioTriggers.crearAsignacionMonitorTrigger({
    monitorId,
    triggerId: triggerInicial.id,
    activo: true,
    ordenEjecucion: 10,
    eventosDisparo: ['apertura_alerta', 'cierre_alerta'],
    configuracionOverride: null
  });
  const trigger = await servicioTriggers.actualizarTrigger(triggerInicial.id, {
    ...definicion,
    activo: true,
    revisionDeclaracion: audiencia.revisionDeclaracion
  });
  assert.equal(trigger.activo, true);
  return { tenantId, empresaId, monitorId, trigger, asignacion };
}

async function verificarCicloProductivo(sql, contexto, dominio) {
  let entropia = 1;
  const repositorioCola = new RepositorioColaCorreo(sql);
  const aceptador = new ServicioAceptacionTriggerCorreo({
    servicioFotografiaAdmision: new ServicioFotografiaAdmisionTriggerCorreo({
      repositorio: new RepositorioFotografiaAdmisionTriggerCorreoSql(),
      evaluadorAutoridadCorreoSql: contexto.evaluador
    }),
    repositorioEjecucionesTrigger: new RepositorioEjecucionesTrigger(sql),
    repositorioArbolTriggerCorreo: new RepositorioArbolTriggerCorreoSql(sql),
    repositorioColaCorreo: repositorioCola,
    reloj: relojMonotono(),
    fuenteEntropia: () => Buffer.alloc(32, entropia++)
  });
  const alertaId = '0199a9f0-7b5c-7a55-b32a-141414141414';
  for (const [indice, evento] of ['apertura_alerta', 'cierre_alerta'].entries()) {
    const resultado = await contexto.frontera.ejecutar((conexion) =>
      aceptador.aceptarEnTransaccion({
        planDisparo: plan(dominio, evento, alertaId, indice),
        conexion
      }));
    assert.equal(resultado.estadoEjecucion, 'ok');
  }
  const notificaciones = await sql.consultar(
    'SELECT evento_disparo FROM notificaciones_triggers_correo ORDER BY id'
  );
  assert.deepEqual(notificaciones.map((fila) => fila.evento_disparo),
    ['apertura_alerta', 'cierre_alerta']);

  const mensajes = [];
  const clienteSmtp = new ClienteSmtp({ fabricaTransport: () => ({
    async sendMail(mensaje) {
      mensajes.push(mensaje);
      return {
        accepted: ['destino@example.test'],
        rejected: [],
        response: '250 accepted',
        messageId: mensaje.messageId
      };
    },
    close() {}
  }) });
  const despachador = new DespachadorCorreoSql({
    fronteraTransaccional: contexto.frontera,
    repositorioColaCorreo: repositorioCola,
    evaluadorAutoridadCorreoSql: contexto.evaluador,
    clienteSmtp,
    identificadorInstancia: 'fixture-52714b'
  });
  assert.equal((await despachador.despacharSiguiente()).estadoSalida, 'enviado');
  const token = extraerToken(mensajes[0].text);
  const desuscripcion = new ServicioDesuscripcionTriggerCorreo({
    repositorio: new RepositorioDesuscripcionTriggerCorreoSql(sql),
    fronteraTransaccional: contexto.frontera,
    servicioAuditoria: new ServicioAuditoriaOperativa({
      repositorioAuditoria: new RepositorioAuditoria(sql)
    })
  });
  assert.equal((await desuscripcion.retirar(token)).procesada, true);
  assert.equal((await despachador.despacharSiguiente()).estadoSalida, 'enviado');
  assert.equal(mensajes.length, 2,
    'Cerrar audiencia no puede cancelar una salida aceptada previamente.');
  const [estado] = await sql.consultar(`
    SELECT
      (SELECT activo FROM triggers WHERE id=?) AS trigger_activo,
      (SELECT estado_participacion FROM destinatarios_triggers_correo
        WHERE trigger_id=? LIMIT 1) AS audiencia_estado,
      (SELECT COUNT(*) FROM cola_correos_salida WHERE estado='enviado') AS enviadas
  `, [dominio.trigger.id, dominio.trigger.id]);
  assert.deepEqual([
    Number(estado.trigger_activo), estado.audiencia_estado, Number(estado.enviadas)
  ], [0, 'desuscrita', 2]);
}

async function verificarReinicioPublicable(sql, contexto, repositorioMigraciones,
  postcondicionesOk) {
  const fotografia = await new RepositorioPreparacionDespliegueTriggerCorreoSql(sql)
    .fotografiar();
  const local = evaluarPreparacionLocalTriggerCorreo({
    migracionesAplicadas: await repositorioMigraciones.listarNombresAplicados(),
    postcondicionesMigracionesVerificadas: postcondicionesOk,
    fotografia
  });
  assert.equal(local.gateAbierto, true);
  assert.ok(local.filasCorreoProductivas > 0);
  const declaracion = crearDeclaracionCompatibilidadRuntimeTriggerCorreo({
    instanciaId: 'runtime-52714b', preparacionLocal: local
  });
  assert.deepEqual(declaracion.capacidades, CAPACIDADES_RUNTIME_TRIGGER_CORREO);
  const unanimidad = evaluarUnanimidadPreparacionTriggerCorreo({
    preparacionLocal: local,
    capacidadesWeb: CAPACIDADES_WEB_TRIGGER_CORREO,
    instanciasRuntime: [{
      instanciaId: 'runtime-52714b',
      capacidadesDespliegue: { triggerCorreo: declaracion }
    }]
  });
  assert.equal(unanimidad.gateAbierto, true);
  const entrada = { preparacionUnanime: unanimidad };
  assert.equal((await new ServicioCorteAutoridadOrigenCorreo({
    repositorioConfiguracion: contexto.repositorioConfiguracion,
    fronteraTransaccional: contexto.frontera,
    versionadorConfiguracionRedis: contexto.versionador
  }).ejecutar(entrada)).cambioEfectivo, false);
  assert.equal((await new ServicioCorteRevisionTriggersCorreo({
    repositorioConfiguracion: contexto.repositorioConfiguracion,
    fronteraTransaccional: contexto.frontera
  }).ejecutar(entrada)).cambioEfectivo, false);
  assert.equal((await new ServicioCorteVerificacionSmtpCorreo({
    repositorioConfiguracion: contexto.repositorioConfiguracion,
    fronteraTransaccional: contexto.frontera,
    versionadorConfiguracionRedis: contexto.versionador
  }).ejecutar(entrada)).cambioEfectivo, false);
  assert.equal((await new ServicioCorteAutoridadColaCorreo({
    repositorioConfiguracion: contexto.repositorioConfiguracion,
    evaluadorAutoridadCorreoSql: contexto.evaluador,
    fronteraTransaccional: contexto.frontera,
    versionadorConfiguracionRedis: contexto.versionador
  }).avanzar(entrada)).fase, 'activada');
  assert.equal((await contexto.activador.activar(entrada)).cambioEfectivo, false);
}

function plan(dominio, eventoDisparo, alertaAuditoriaId, indice) {
  return {
    triggerId: Number(dominio.trigger.id),
    asignacionId: Number(dominio.asignacion.id),
    monitorId: Number(dominio.monitorId),
    tipoTrigger: 'correo',
    eventoDisparo,
    trigger: dominio.trigger,
    asignacion: dominio.asignacion,
    transicion: {
      tipoEventoDisparo: eventoDisparo,
      alertaAuditoriaId,
      monitorId: Number(dominio.monitorId),
      tenantId: Number(dominio.tenantId),
      empresaId: Number(dominio.empresaId),
      sitioId: null,
      tipoMonitor: 'ping',
      nombreMonitor: 'Monitor controlado 52714b',
      fechaOcurrenciaUtc: `2026-09-03T10:00:00.00${indice}Z`,
      validoDesdeUtc: '2026-09-03T10:00:00.000Z',
      codigoResultado: eventoDisparo === 'apertura_alerta' ? 'timeout' : 'recuperado',
      mensajeResultado: eventoDisparo === 'apertura_alerta'
        ? 'Sin respuesta.' : 'Servicio recuperado.',
      payloadAlerta: {
        descripcionFallo: 'Contexto humano controlado.',
        posibleSolucion: 'Revisar el servicio.'
      }
    }
  };
}

async function configurarCanal(sql) {
  const valores = new Map([
    ['portal.origen_publico', 'https://sentinelia.example.test'],
    ['portal.nombre_visible', 'Sentinelia'],
    ['correo.activo', 'true'],
    ['correo.smtp_host', 'smtp.example.test'],
    ['correo.smtp_puerto', '587'],
    ['correo.smtp_secure', 'false'],
    ['correo.smtp_usuario', 'sentinelia'],
    ['correo.smtp_password', 'secreto-14b'],
    ['correo.smtp_auth_method', 'PLAIN'],
    ['correo.smtp_timeout_conexion_ms', '1000'],
    ['correo.smtp_timeout_saludo_ms', '1000'],
    ['correo.smtp_timeout_socket_ms', '1000'],
    ['correo.smtp_tls_permitir_inseguro', 'false'],
    ['correo.remitente_email', 'alertas@example.test'],
    ['correo.remitente_nombre', 'Sentinelia'],
    ['correo.operativo_verificado', 'false']
  ]);
  for (const [clave, valor] of valores) {
    await sql.ejecutar('UPDATE configuracion_portal SET valor=? WHERE clave=?', [valor, clave]);
  }
}

function extraerToken(cuerpo) {
  const coincidencia = String(cuerpo).match(
    /\/correo\/desuscripcion\/([A-Za-z0-9_-]{43})/u
  );
  assert.ok(coincidencia, 'La entrega debe contener su capacidad privada.');
  return coincidencia[1];
}

async function insertarId(sql, sentencia, parametros = []) {
  const [resultado] = await sql.ejecutar(sentencia, parametros);
  return Number(resultado.insertId);
}

function relojMonotono() {
  let marca = Date.parse('2026-09-03T10:00:00.100Z');
  return () => new Date(marca++);
}
