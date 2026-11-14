import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import { randomBytes } from 'node:crypto';

import { PresenciaRuntimeRedis }
  from '../../apps/sentinelia-runtime/src/redis/PresenciaRuntimeRedis.js';
import { RepositorioAuditoria }
  from '../../paquetes/auditoria/src/RepositorioAuditoria.js';
import { generarUuidV7Auditoria }
  from '../../paquetes/auditoria/src/UuidV7Auditoria.js';
import { DespachadorCorreoSql }
  from '../../paquetes/correo/src/DespachadorCorreoSql.js';
import { RepositorioColaCorreo }
  from '../../paquetes/correo/src/RepositorioColaCorreo.js';
import { RepositorioCoordinacionCorreoRecuperacionPasswordSql }
  from '../../paquetes/correo/src/RepositorioCoordinacionCorreoRecuperacionPasswordSql.js';
import {
  evaluarPreparacionLocalTriggerCorreo,
  RepositorioPreparacionDespliegueTriggerCorreoSql
} from '../../paquetes/correo/src/CompatibilidadDespliegueTriggerCorreo.js';
import { ClienteSql }
  from '../../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones }
  from '../../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { FronteraTransaccionalLocal }
  from '../../paquetes/persistencia-sql/src/FronteraTransaccionalLocal.js';
import { RepositorioConfiguracion }
  from '../../paquetes/configuracion/src/RepositorioConfiguracion.js';
import { ServicioConfiguracionPortal }
  from '../../paquetes/configuracion/src/ServicioConfiguracionPortal.js';
import { VersionadorConfiguracionRedis }
  from '../../paquetes/configuracion/src/VersionadorConfiguracionRedis.js';
import { obtenerDefinicionesConfiguracionPortal }
  from '../../paquetes/configuracion/src/obtenerDefinicionesConfiguracionPortal.js';
import { ServicioAuditoriaOperativa }
  from '../../paquetes/auditoria/src/ServicioAuditoriaOperativa.js';
import { RepositorioMigraciones }
  from '../../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import { RepositorioSesionesWebAuditoria }
  from '../../paquetes/sesiones/src/RepositorioSesionesWebAuditoria.js';
import { ServicioConexionRedis }
  from '../../paquetes/sesiones/src/ServicioConexionRedis.js';
import { RepositorioSolicitudesRecuperacionPasswordRedis }
  from '../../paquetes/usuarios/src/RepositorioSolicitudesRecuperacionPasswordRedis.js';
import { RepositorioUsuarios }
  from '../../paquetes/usuarios/src/RepositorioUsuarios.js';
import { ServicioActivacionEmisionRecuperacionPasswordEmail }
  from '../../paquetes/usuarios/src/ServicioActivacionEmisionRecuperacionPasswordEmail.js';
import { ServicioAutenticacion }
  from '../../paquetes/usuarios/src/ServicioAutenticacion.js';
import { ServicioContinuacionWebRecuperacionPasswordEmail }
  from '../../paquetes/usuarios/src/ServicioContinuacionWebRecuperacionPasswordEmail.js';
import { ServicioConvergenciaConsumoRecuperacionPasswordEmail }
  from '../../paquetes/usuarios/src/ServicioConvergenciaConsumoRecuperacionPasswordEmail.js';
import { ServicioInicioPublicoRecuperacionPasswordEmail }
  from '../../paquetes/usuarios/src/ServicioInicioPublicoRecuperacionPasswordEmail.js';
import { ServicioPreparacionEmisionRecuperacionPasswordEmail }
  from '../../paquetes/usuarios/src/ServicioPreparacionEmisionRecuperacionPasswordEmail.js';
import { ServicioResolucionAgnosticaRecuperacionPasswordEmail }
  from '../../paquetes/usuarios/src/ServicioResolucionAgnosticaRecuperacionPasswordEmail.js';
import { ServicioSustitucionPasswordRecuperacionEmail }
  from '../../paquetes/usuarios/src/ServicioSustitucionPasswordRecuperacionEmail.js';
import {
  CAPACIDADES_WEB_RECUPERACION_PASSWORD_EMAIL,
  evaluarPreparacionLocalRecuperacionPasswordEmail,
  crearDeclaracionCapacidadesRuntimeRecuperacionPasswordEmail,
  resolverUnanimidadRecuperacionPasswordEmail
} from '../../paquetes/usuarios/src/CapacidadesDespliegueRecuperacionPasswordEmail.js';
import { ServicioDisponibilidadRecuperacionPasswordEmail }
  from '../../paquetes/usuarios/src/ServicioDisponibilidadRecuperacionPasswordEmail.js';
import { crearProveedorCompatibilidadRecuperacionPasswordEmail }
  from '../../paquetes/usuarios/src/ProveedorCompatibilidadRecuperacionPasswordEmail.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

export async function verificarRecorridoIntegralReal() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true,
    '5.30.8b necesita MariaDB real para su cierre integral.');
  const sufijo = `${process.pid}_${randomBytes(5).toString('hex')}`;
  const nombreBase = `sentinelia_fixture_5308b_${sufijo}`;
  const prefijoRedis = `sentinelia:fixture:5308b:${sufijo}:`;
  const administrador = new ClienteSql(configuracion.sql);
  const conexionRedis = new ServicioConexionRedis(configuracion.redis);
  let sql;
  let redis;
  let presencia;
  try {
    await administrador.ejecutar(
      `CREATE DATABASE ${administrador.escaparIdentificador(nombreBase)} ` +
      'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
    );
    sql = new ClienteSql({ ...configuracion.sql, baseDatos: nombreBase });
    await new EjecutorMigraciones({
      clienteSql: sql,
      repositorioMigraciones: new RepositorioMigraciones(sql),
      rutaMigraciones: obtenerRutaMigraciones()
    }).ejecutarPendientes();
    await prepararAutoridadCorreoReal(sql);
    redis = await conexionRedis.conectar();
    const configuracionReal = await prepararConfiguracionReal({
      sql,
      redis,
      prefijoRedis,
      configuracionEntorno: configuracion
    });
    const preparacionLocal = await prepararGateReal(
      sql,
      configuracionReal.servicio.obtenerConfiguracionActual()
        .obtenerConfiguracionUsuarios()
    );
    presencia = await publicarPresenciaReal({
      redis, prefijoRedis, preparacionLocal
    });
    configuracionReal.conectarDisponibilidad(
      new ServicioDisponibilidadRecuperacionPasswordEmail({
        servicioConfiguracionPortal: configuracionReal.servicio,
        servicioCorreoPortal: {
          async obtenerEstadoConfiguracionAutoritativo() {
            return { operativo: true };
          }
        },
        presenciaPreparada: async () => {
          await resolverUnanimidadRecuperacionPasswordEmail({
            preparacionLocal,
            clienteRedis: redis,
            prefijoRuntime: prefijoRedis,
            entorno: 'fixture-5308b'
          });
          return true;
        }
      })
    );
    const activacion = await configuracionReal.servicio.actualizarValor({
      clave: 'usuarios.recuperacion_email_activa',
      valor: 'true',
      contextoUsuarioActual: contextoConfiguracion()
    });
    assert.equal(activacion.cambioEfectivo, true);
    await ejecutarFlujoReal({
      sql,
      redis,
      prefijoRedis,
      servicioConfiguracionPortal: configuracionReal.servicio
    });
  } finally {
    await presencia?.detener().catch(() => {});
    if (redis) await eliminarPrefijo(redis, prefijoRedis).catch(() => {});
    await conexionRedis.cerrar().catch(() => {});
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(nombreBase)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

async function prepararAutoridadCorreoReal(sql) {
  await sql.ejecutar(
    `UPDATE estado_despliegue_trigger_correo
        SET estado='activado',tipo_correo_habilitado=0,
            origen_portal_autoritativo=1,cola_sql_autoritativa=1,
            guard_revision_trigger_activo=1,guard_metadatos_activo=1,
            verificacion_smtp_autoritativa=1,
            guard_verificacion_legacy_activo=1,
            cortado_en_utc=UTC_TIMESTAMP(3),
            quietud_iniciada_en_utc=UTC_TIMESTAMP(3),
            quietud_observada_en_utc=UTC_TIMESTAMP(3),
            activado_en_utc=UTC_TIMESTAMP(3)
      WHERE id=1`
  );
}

async function prepararGateReal(sql, configuracionUsuarios) {
  const migracionesAplicadas = await new RepositorioMigraciones(sql)
    .listarNombresAplicados();
  const fotografiaCorreo =
    await new RepositorioPreparacionDespliegueTriggerCorreoSql(sql).fotografiar();
  const preparacionCorreo = evaluarPreparacionLocalTriggerCorreo({
    migracionesAplicadas,
    postcondicionesMigracionesVerificadas: true,
    fotografia: fotografiaCorreo
  });
  assert.equal(preparacionCorreo.gateAbierto, false,
    'el tipo trigger puede seguir cerrado con la cola común autoritativa');
  return evaluarPreparacionLocalRecuperacionPasswordEmail({
    migracionesAplicadas,
    postcondicionesMigracionesVerificadas: true,
    configuracionUsuarios,
    colaCorreoPreparada:
      Number(fotografiaCorreo.estado.cola_sql_autoritativa) === 1,
    keyringTecnicoCorreo: {
      keyIdActiva: 'fixture-5308b',
      listarIds: () => ['fixture-5308b']
    },
    capacidadesWeb: CAPACIDADES_WEB_RECUPERACION_PASSWORD_EMAIL
  });
}

async function prepararConfiguracionReal({
  sql,
  redis,
  prefijoRedis,
  configuracionEntorno
}) {
  await sql.ejecutar(
    `UPDATE configuracion_portal
        SET valor='https://sentinelia-integral.example'
      WHERE clave='portal.origen_publico'`
  );
  const repositorioAuditoria = new RepositorioAuditoria(sql);
  let disponibilidad = null;
  const definiciones = obtenerDefinicionesConfiguracionPortal({
    ...configuracionEntorno,
    portal: {
      ...configuracionEntorno.portal,
      origenPublico: 'https://sentinelia-integral.example'
    }
  });
  const servicio = new ServicioConfiguracionPortal({
    repositorioConfiguracion: new RepositorioConfiguracion(sql),
    versionadorConfiguracionRedis: new VersionadorConfiguracionRedis({
      clienteRedis: redis,
      claveVersion: `${prefijoRedis}configuracion:version`
    }),
    definiciones,
    fronteraTransaccional: new FronteraTransaccionalLocal(sql),
    servicioAuditoria: new ServicioAuditoriaOperativa({ repositorioAuditoria }),
    proveedorCompatibilidadRecuperacionPasswordEmail:
      crearProveedorCompatibilidadRecuperacionPasswordEmail({
        obtenerEstado: async () => disponibilidad?.evaluar?.() || ({
          puedeHabilitar: false,
          dependencias: [{ codigo: 'bootstrap_incompleto', satisfecha: false }]
        })
      })
  });
  await servicio.bootstrapYcargar();
  assert.equal(
    servicio.obtenerConfiguracionActual().obtenerOrigenPublicoPortal(),
    'https://sentinelia-integral.example'
  );
  return {
    servicio,
    conectarDisponibilidad(valor) { disponibilidad = valor; }
  };
}

async function publicarPresenciaReal({ redis, prefijoRedis, preparacionLocal }) {
  const instanciaId = 'runtime-integral-5308b';
  const presencia = new PresenciaRuntimeRedis({
    clienteRedis: redis,
    configuracionRuntime: {
      instanciaId,
      redisPrefijo: prefijoRedis,
      presenciaTtlSegundos: 30,
      latidoIntervaloMs: 20_000
    },
    entorno: 'fixture-5308b'
  });
  const vacio = {
    serializarResumen: () => ({}),
    crearSnapshot: () => ({})
  };
  await presencia.publicarInicio({
    catalogoOperativo: vacio,
    almacenEstadoActual: vacio
  });
  await presencia.publicarCapacidadDespliegue(
    'recuperacionPasswordEmail',
    crearDeclaracionCapacidadesRuntimeRecuperacionPasswordEmail({ instanciaId })
  );
  const unanimidad = await resolverUnanimidadRecuperacionPasswordEmail({
    preparacionLocal,
    clienteRedis: redis,
    prefijoRuntime: prefijoRedis,
    entorno: 'fixture-5308b'
  });
  assert.equal(unanimidad.instanciasRuntimeCompatibles, 1);
  return presencia;
}

async function ejecutarFlujoReal({
  sql,
  redis,
  prefijoRedis,
  servicioConfiguracionPortal
}) {
  const buzon = `compartido-${randomBytes(4).toString('hex')}@example.test`;
  const idsUsuario = await crearUsuarios(sql, buzon);
  const repositorioUsuarios = new RepositorioUsuarios(sql);
  const repositorioAuditoria = new RepositorioAuditoria(sql);
  const repositorioCorreo =
    new RepositorioCoordinacionCorreoRecuperacionPasswordSql(sql, {
      repositorioAuditoria
    });
  const solicitudes = new RepositorioSolicitudesRecuperacionPasswordRedis({
    clienteRedis: redis,
    prefijo: `${prefijoRedis}solicitudes:`
  });
  let tokenEmitido = null;
  const generarTokenReal = solicitudes.generarToken.bind(solicitudes);
  solicitudes.generarToken = () => {
    tokenEmitido = generarTokenReal();
    return tokenEmitido;
  };
  const frontera = new FronteraTransaccionalLocal(sql);
  const preparacion = new ServicioPreparacionEmisionRecuperacionPasswordEmail({
    repositorioUsuarios,
    repositorioSolicitudes: solicitudes,
    repositorioCoordinacionCorreo: repositorioCorreo,
    fronteraTransaccional: frontera,
    servicioConfiguracionPortal,
    propietarioProceso: 'fixture-5308b:web'
  });
  const activacion = new ServicioActivacionEmisionRecuperacionPasswordEmail({
    repositorioSolicitudes: solicitudes,
    repositorioCoordinacionCorreo: repositorioCorreo,
    fronteraTransaccional: frontera
  });
  const inicio = new ServicioInicioPublicoRecuperacionPasswordEmail({
    servicioAdmision: {
      async emitirDesafio() { return { desafio: 'integral-real' }; },
      async admitir() { return { alcanzoAdmision: true, admitida: true }; }
    },
    servicioPreparacion: preparacion,
    servicioActivacion: activacion,
    servicioConfiguracionPortal,
    esperar: async () => {},
    aleatorio: () => 0
  });

  await inicio.iniciar({
    buzon,
    origenRed: '203.0.113.80',
    entregaPow: { valida: true }
  });
  const salidasSolicitud = await sql.consultar(
    `SELECT id,material_preparacion_recuperacion_password
       FROM cola_correos_salida
      WHERE origen_tipo='recuperacion_password'
        AND proposito_recuperacion_password='transportar_solicitud'`
  );
  assert.equal(salidasSolicitud.length, 1,
    'un buzón compartido debe producir un solo enlace y una sola salida');
  const [salidaSolicitud] = salidasSolicitud;
  assert.ok(salidaSolicitud);
  assert.equal(salidaSolicitud.material_preparacion_recuperacion_password, null);
  const token = tokenEmitido;
  assert.ok(token, 'la instrumentación integral debe conservar el bearer emitido');

  const desactivacion = await servicioConfiguracionPortal.actualizarValor({
    clave: 'usuarios.recuperacion_email_activa',
    valor: 'false',
    contextoUsuarioActual: contextoConfiguracion()
  });
  assert.equal(desactivacion.cambioEfectivo, true);
  assert.equal((await solicitudes.inspeccionar(token)).estado, 'activa');
  const sesiones = new RepositorioSesionesWebAuditoria(sql);
  const sesionId = generarUuidV7Auditoria();
  await sesiones.abrirAtomica({
    sesionAuditoriaId: sesionId,
    usuarioRealId: idsUsuario[1],
    usuarioEfectivoId: idsUsuario[1],
    versionSesionReal: 1,
    versionSesionEfectiva: 1,
    scopeApertura: scopePortal(),
    scopeEfectivoActual: scopePortal()
  });
  const resolucion = new ServicioResolucionAgnosticaRecuperacionPasswordEmail({
    repositorioSolicitudes: solicitudes,
    repositorioUsuarios,
    fronteraTransaccional: frontera,
    propietario: 'fixture-5308b:web'
  });
  const sustitucion = new ServicioSustitucionPasswordRecuperacionEmail({
    repositorioSolicitudes: solicitudes,
    repositorioUsuarios,
    repositorioSesionesWeb: sesiones,
    repositorioAuditoria,
    repositorioCoordinacionCorreo: repositorioCorreo,
    servicioAutenticacion: new ServicioAutenticacion({
      repositorioUsuarios,
      servicioConfiguracionPortal
    }),
    servicioConfiguracionPortal,
    fronteraTransaccional: frontera,
    propietario: 'fixture-5308b:web'
  });
  const convergencia = new ServicioConvergenciaConsumoRecuperacionPasswordEmail({
    servicioSustitucion: sustitucion,
    repositorioSolicitudes: solicitudes,
    servicioSesion: {
      async invalidarSesionesUsuario(usuarioId, version) {
        await redis.set(`${prefijoRedis}version-sesion:${usuarioId}`, String(version));
      }
    },
    servicioAvisosPlataforma: {
      async detectar() {},
      async resolver() {}
    },
    actorRuntimeId: 'fixture-5308b:web'
  });
  const continuacion = new ServicioContinuacionWebRecuperacionPasswordEmail({
    repositorioSolicitudes: solicitudes,
    servicioResolucion: resolucion,
    servicioConsumo: convergencia,
    servicioConfiguracionPortal
  });
  assert.equal((await continuacion.inspeccionar(token)).utilizable, true);
  assert.equal((await continuacion.resolver({
    token,
    usuario: 'CuentaB5308b'
  })).estado, 'resuelta');
  const passwordNueva = 'Clave-integral-5308b-segura';
  const consumo = await continuacion.sustituir({
    token,
    passwordNuevo: passwordNueva,
    passwordConfirmacion: passwordNueva
  });
  assert.equal(consumo.sustituida, true);
  assert.equal(consumo.convergencia, 'completa');
  assert.equal((await solicitudes.inspeccionar(token)).estado, 'consumida');

  const usuario = await repositorioUsuarios.buscarPorId(idsUsuario[1]);
  assert.equal(await bcrypt.compare(passwordNueva, usuario.hashPassword), true);
  assert.equal(usuario.requiereCambioPassword, false);
  assert.equal(String(usuario.versionSesion), '2');
  assert.equal(String(usuario.generacionRecuperacion), '2');
  assert.equal((await sesiones.buscarPorId(sesionId)).estado, 'invalidada');

  const propositosAntesDespacho = await sql.consultar(
    `SELECT proposito_recuperacion_password AS proposito,estado
       FROM cola_correos_salida
      WHERE origen_tipo='recuperacion_password'
      ORDER BY id`
  );
  assert.deepEqual(propositosAntesDespacho.map(({ proposito }) => proposito),
    ['transportar_solicitud', 'notificar_cambio']);

  const eventos = await sql.consultar(
    `SELECT tipo_evento,clave_cadena
       FROM eventos_auditoria
      WHERE tipo_evento IN (
        'recuperacion_password.solicitud_emitida','usuario.password_recuperado'
      ) ORDER BY efectivo_en_utc,tipo_evento`
  );
  assert.deepEqual(new Set(eventos.map(({ tipo_evento }) => tipo_evento)),
    new Set(['recuperacion_password.solicitud_emitida', 'usuario.password_recuperado']));
  assert.ok(eventos.some(({ clave_cadena }) => clave_cadena === 'internet:portal'));
  assert.ok(eventos.some(({ clave_cadena }) => clave_cadena === 'usuarios:portal'));

  const smtp = new SmtpControlado();
  const despachador = new DespachadorCorreoSql({
    fronteraTransaccional: frontera,
    repositorioColaCorreo: new RepositorioColaCorreo(sql),
    repositorioRecuperacionPassword: repositorioCorreo,
    evaluadorAutoridadCorreoSql: new AutoridadCorreoControlada(),
    clienteSmtp: smtp,
    identificadorInstancia: 'fixture-5308b:runtime',
    leaseMilisegundos: 10_000,
    margenConsolidacionMs: 100
  });
  assert.equal((await despachador.despacharSiguiente()).despachado, true);
  assert.equal((await despachador.despacharSiguiente()).despachado, true);
  assert.equal(smtp.intentos.length, 2);
  assert.deepEqual((await sql.consultar(
    `SELECT proposito_recuperacion_password AS proposito,estado
       FROM cola_correos_salida
      WHERE origen_tipo='recuperacion_password'
      ORDER BY id`
  )).map(({ proposito, estado }) => [proposito, estado]), [
    ['transportar_solicitud', 'enviado'],
    ['notificar_cambio', 'enviado']
  ]);

  const reactivacion = await servicioConfiguracionPortal.actualizarValor({
    clave: 'usuarios.recuperacion_email_activa',
    valor: 'true',
    contextoUsuarioActual: contextoConfiguracion()
  });
  assert.equal(reactivacion.cambioEfectivo, true);
  await inicio.iniciar({
    buzon,
    origenRed: '203.0.113.81',
    entregaPow: { valida: true }
  });
  await sql.ejecutar('UPDATE usuarios SET email_validado=0 WHERE email=?', [buzon]);
  const descartada = await despachador.despacharSiguiente();
  assert.equal(descartada.despachado, false);
  assert.equal(descartada.estadoSalida, 'descartada');
  assert.equal(smtp.intentos.length, 2,
    'la revalidación previa a SMTP debe impedir el tercer transporte');
}

async function crearUsuarios(sql, buzon) {
  const ids = [];
  for (const usuario of ['CuentaA5308b', 'CuentaB5308b']) {
    const [resultado] = await sql.ejecutar(
      `INSERT INTO usuarios (
         usuario,email,hash_password,nombre_mostrar,activo,email_validado,
         requiere_cambio_password
       ) VALUES (?,?,?, ?,1,1,1)`,
      [usuario, buzon, '$2b$12$inicial.no.utilizable.fixture.5308b', usuario]
    );
    ids.push(String(resultado.insertId));
  }
  return ids;
}

class AutoridadCorreoControlada {
  async evaluarEnTransaccion() {
    return {
      puedeDespachar: true,
      codigo: 'correo_smtp_verificado',
      versionConfiguracion: '1',
      remitenteEmailCanonico: 'sender@example.test',
      configuracion: {
        remitenteEmail: 'sender@example.test',
        remitenteNombre: 'Sentinelia',
        smtpTimeoutConexionMs: 100,
        smtpTimeoutSaludoMs: 100,
        smtpTimeoutSocketMs: 100,
        maxReintentos: 2,
        reintentoBaseSegundos: 1
      }
    };
  }
}

class SmtpControlado {
  constructor() { this.intentos = []; }
  async enviarIntentoTrigger() {
    throw new Error('5.30.8b no debe degradar el despacho a trigger.');
  }
  async enviarIntentoSql(_configuracion, salida, { origenEsperado }) {
    assert.equal(origenEsperado, 'recuperacion_password');
    assert.equal(salida.origenTipo, 'recuperacion_password');
    this.intentos.push(String(salida.id));
    return {
      estado: 'aceptado',
      clasificacion: 'aceptacion_demostrada',
      codigo: 'smtp_aceptado',
      respuestaSaneada: '250 accepted fixture'
    };
  }
}

async function eliminarPrefijo(redis, prefijo) {
  for await (const entrada of redis.scanIterator({ MATCH: `${prefijo}*`, COUNT: 100 })) {
    const claves = Array.isArray(entrada) ? entrada : [entrada];
    if (claves.length > 0) await redis.del(claves);
  }
}

function scopePortal() {
  return { tenantId: null, empresaId: null, sitioId: null };
}

function contextoConfiguracion() {
  return {
    idUsuario: 5308,
    idUsuarioReal: 5308,
    nivelScope: 'portal',
    permisos: { administrarConfiguracion: true }
  };
}
