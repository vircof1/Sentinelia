import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';

import { generarUuidV7Auditoria, uuidV7AuditoriaABytes }
  from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import { crearMensajeReinicioPasswordAdministrativo }
  from '../paquetes/correo/src/CodecMensajeReinicioPasswordAdministrativo.js';
import {
  ErrorConflictoCorreoReinicioPasswordAdministrativo,
  RepositorioCoordinacionCorreoReinicioPasswordAdministrativoSql
} from '../paquetes/correo/src/RepositorioCoordinacionCorreoReinicioPasswordAdministrativoSql.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { FronteraTransaccionalLocal }
  from '../paquetes/persistencia-sql/src/FronteraTransaccionalLocal.js';
import { RepositorioMigraciones }
  from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import { VIAS_REINICIO_PASSWORD_ADMINISTRATIVO }
  from '../paquetes/usuarios/src/ContratoReinicioPasswordAdministrativo.js';
import { RepositorioReiniciosPasswordAdministrativosSql }
  from '../paquetes/usuarios/src/RepositorioReiniciosPasswordAdministrativosSql.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

await main();

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true, '5.30a.3c necesita MariaDB real.');
  const administrador = new ClienteSql(configuracion.sql);
  const base = `sentinelia_fixture_530a3c_${randomBytes(5).toString('hex')}`;
  let sql;
  try {
    await administrador.ejecutar(
      `CREATE DATABASE ${administrador.escaparIdentificador(base)} ` +
      'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
    );
    sql = new ClienteSql({ ...configuracion.sql, baseDatos: base });
    await new EjecutorMigraciones({
      clienteSql: sql,
      repositorioMigraciones: new RepositorioMigraciones(sql),
      rutaMigraciones: obtenerRutaMigraciones()
    }).ejecutarPendientes();
    await sql.ejecutar(
      `INSERT INTO usuarios (
         id,usuario,email,hash_password,activo,email_validado
       ) VALUES (1,'operador-530a3c','operador@example.test','hash',1,1)`
    );
    const frontera = new FronteraTransaccionalLocal(sql);
    const operaciones = new RepositorioReiniciosPasswordAdministrativosSql(sql);
    const repositorio =
      new RepositorioCoordinacionCorreoReinicioPasswordAdministrativoSql(sql);

    await verificarConexionYRollback({ sql, frontera, operaciones, repositorio });
    const principal = await verificarCreacionIdempotente({
      sql, frontera, operaciones, repositorio
    });
    await verificarInicio({ sql, frontera, operaciones, repositorio, caso: principal });
    await verificarLeaseYReintentos({ sql, frontera, operaciones, repositorio });
    await verificarAislamientoDeProcedencia({ sql, principal });

    console.log(
      '[usuarios] OK 5.30a.3c: salida=idempotente rollback=total ' +
      'fotografia=inmutable remitente=dinamico mensaje=privado ' +
      'claim=validado lease=cercada reintentos=terminales locks=operacion_antes_salida ' +
      'usuario=no_releido procedencias=aisladas'
    );
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(base)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

async function verificarConexionYRollback({ sql, frontera, operaciones, repositorio }) {
  const caso = crearCaso();
  await reservar(frontera, operaciones, caso);
  await assert.rejects(
    repositorio.crearSalidaEnTransaccion(caso.salida),
    /conexión SQL prestada/iu
  );
  await assert.rejects(
    frontera.ejecutar(async (conexion) => {
      await repositorio.crearSalidaEnTransaccion(caso.salida, { conexion });
      throw new Error('rollback_intencional_530a3c');
    }),
    /rollback_intencional_530a3c/u
  );
  assert.equal(await contarSalida(sql, caso.reinicioId), 0);
}

async function verificarCreacionIdempotente({ sql, frontera, operaciones, repositorio }) {
  const caso = crearCaso();
  await reservar(frontera, operaciones, caso);
  const conexion = await sql.obtenerConexion();
  const executeOriginal = conexion.execute.bind(conexion);
  const traza = [];
  conexion.execute = async (sentencia, parametros) => {
    traza.push(String(sentencia).replace(/\s+/gu, ' ').trim());
    return executeOriginal(sentencia, parametros);
  };
  let creada;
  try {
    await conexion.beginTransaction();
    creada = await repositorio.crearSalidaEnTransaccion(caso.salida, { conexion });
    await conexion.commit();
  } finally {
    await conexion.rollback().catch(() => {});
    conexion.execute = executeOriginal;
    conexion.release();
  }
  assert.equal(creada.creada, true);
  assert.equal(creada.salida.reinicioPasswordAdministrativoId, caso.reinicioId);
  assert.equal(creada.salida.destinatarioEmail, caso.salida.buzonCanonico);
  assert.equal(creada.salida.destinatarioNombre, caso.salida.destinatarioNombre);
  assert.equal(creada.salida.modoRemitente, 'configuracion_actual');
  assert.equal(creada.salida.remitenteEmail, null);
  assert.equal(creada.salida.estado, 'pendiente');
  const lockOperacion = traza.findIndex((sqlTraza) =>
    sqlTraza.includes('FROM reinicios_password_administrativos') &&
    sqlTraza.includes('FOR UPDATE')
  );
  const lockSalida = traza.findIndex((sqlTraza) =>
    sqlTraza.includes('FROM cola_correos_salida') && sqlTraza.includes('FOR UPDATE')
  );
  assert.ok(lockOperacion >= 0 && lockSalida > lockOperacion);

  const replay = await frontera.ejecutar((conexionReplay) =>
    repositorio.crearSalidaEnTransaccion(caso.salida, { conexion: conexionReplay })
  );
  assert.equal(replay.creada, false);
  assert.equal(String(replay.salida.id), String(creada.salida.id));
  await assert.rejects(
    frontera.ejecutar((conexionColision) =>
      repositorio.crearSalidaEnTransaccion({
        ...caso.salida,
        destinatarioNombre: 'Otra persona'
      }, { conexion: conexionColision })
    ),
    (error) => error instanceof ErrorConflictoCorreoReinicioPasswordAdministrativo
  );
  return { ...caso, salidaId: String(creada.salida.id) };
}

async function verificarInicio({ sql, frontera, operaciones, repositorio, caso }) {
  await confirmar(frontera, operaciones, caso);
  const claim = await reclamar(frontera, caso.salidaId);
  const conexion = await sql.obtenerConexion();
  const executeOriginal = conexion.execute.bind(conexion);
  const traza = [];
  conexion.execute = async (sentencia, parametros) => {
    traza.push(String(sentencia).replace(/\s+/gu, ' ').trim());
    return executeOriginal(sentencia, parametros);
  };
  let inicio;
  try {
    await conexion.beginTransaction();
    inicio = await repositorio.iniciarIntentoEnTransaccion({
      ...claim,
      configuracionVersion: '7',
      maxReintentos: 2,
      margenMinimoLeaseMs: 5_000
    }, { conexion });
    await conexion.commit();
  } finally {
    await conexion.rollback().catch(() => {});
    conexion.execute = executeOriginal;
    conexion.release();
  }
  assert.equal(inicio.iniciado, true);
  assert.equal(inicio.passwordProvisional, caso.passwordProvisional);
  assert.equal(inicio.salida.estado, 'enviando');
  assert.equal(inicio.salida.intentos, 1);
  assert.equal(inicio.intento.numero, 1);
  assert.equal(inicio.intento.versionConfiguracion, '7');
  const lockOperacion = traza.findIndex((sqlTraza) =>
    sqlTraza.includes('FROM reinicios_password_administrativos') &&
    sqlTraza.includes('FOR UPDATE')
  );
  const lockSalida = traza.findIndex((sqlTraza) =>
    sqlTraza.startsWith('SELECT * FROM cola_correos_salida') &&
    sqlTraza.includes('FOR UPDATE')
  );
  assert.ok(lockOperacion >= 0 && lockSalida > lockOperacion);
}

async function verificarLeaseYReintentos({ sql, frontera, operaciones, repositorio }) {
  const lease = await crearConfirmada({ frontera, operaciones, repositorio });
  const claimLease = await reclamar(frontera, lease.salidaId, { leaseMs: 1_000 });
  await assert.rejects(
    frontera.ejecutar((conexion) => repositorio.iniciarIntentoEnTransaccion({
      ...claimLease,
      configuracionVersion: '8',
      maxReintentos: 1,
      margenMinimoLeaseMs: 2_000
    }, { conexion })),
    /lease SQL no cubre/iu
  );
  assert.equal((await sql.consultar(
    'SELECT estado,intentos FROM cola_correos_salida WHERE id=?', [lease.salidaId]
  ))[0].estado, 'reclamada');

  const agotada = await crearConfirmada({ frontera, operaciones, repositorio });
  await sql.ejecutar(
    'UPDATE cola_correos_salida SET intentos=1 WHERE id=?',
    [agotada.salidaId]
  );
  const claimAgotada = await reclamar(frontera, agotada.salidaId);
  const cierre = await frontera.ejecutar((conexion) =>
    repositorio.iniciarIntentoEnTransaccion({
      ...claimAgotada,
      configuracionVersion: '9',
      maxReintentos: 0,
      margenMinimoLeaseMs: 1_000
    }, { conexion })
  );
  assert.deepEqual(cierre, {
    iniciado: false,
    estadoSalida: 'error_final',
    codigo: 'smtp_reintentos_agotados'
  });
}

async function verificarAislamientoDeProcedencia({ sql, principal }) {
  await assert.rejects(
    sql.ejecutar(
      `INSERT INTO cola_correos_salida (
         origen_tipo,productor_version,reinicio_password_administrativo_id,
         solicitud_recuperacion_password_id,
         clave_operacion_recuperacion_password_sha256,destinatario_email,
         normalizacion_buzon_version,clave_buzon_sha256,modo_remitente,
         asunto,cuerpo_texto,smtp_message_id,estado,intentos
       ) VALUES (
         'recuperacion_password','sql@1',?,?,UNHEX(?),'aislado@example.test',
         'buzon@1',UNHEX(?),'configuracion_actual','Inválido','Inválido',?,
         'pendiente',0)`,
      [
        uuidV7AuditoriaABytes(principal.reinicioId),
        uuidV7AuditoriaABytes(generarUuidV7Auditoria()),
        sha('operacion-invalida'),
        sha('aislado@example.test'),
        `<aislado-${randomBytes(8).toString('hex')}@correo.sentinelia>`
      ]
    ),
    /CONSTRAINT|chk_cola_correos/iu
  );
}

async function crearConfirmada({ frontera, operaciones, repositorio }) {
  const caso = crearCaso();
  await reservar(frontera, operaciones, caso);
  const creada = await frontera.ejecutar((conexion) =>
    repositorio.crearSalidaEnTransaccion(caso.salida, { conexion })
  );
  const completa = { ...caso, salidaId: String(creada.salida.id) };
  await confirmar(frontera, operaciones, completa);
  return completa;
}

function reservar(frontera, operaciones, caso) {
  return frontera.ejecutar((conexion) => operaciones.reservarEnTransaccion({
    reinicioId: caso.reinicioId,
    usuarioId: caso.usuarioId,
    via: VIAS_REINICIO_PASSWORD_ADMINISTRATIVO.CORREO
  }, { conexion }));
}

function confirmar(frontera, operaciones, caso) {
  return frontera.ejecutar((conexion) => operaciones.confirmarEnTransaccion({
    reinicioId: caso.reinicioId,
    eventoAuditoriaId: generarUuidV7Auditoria(),
    salidaCorreoId: caso.salidaId,
    versionSesionResultante: '2',
    generacionRecuperacionResultante: '2'
  }, { conexion }));
}

async function reclamar(frontera, salidaId, { leaseMs = 60_000 } = {}) {
  const claimId = randomBytes(32).toString('hex');
  const leaseToken = randomBytes(32).toString('hex');
  const propietarioClaim = `fixture-530a3c-${randomBytes(4).toString('hex')}`;
  return frontera.ejecutar(async (conexion) => {
    const [actualizada] = await conexion.execute(
      `UPDATE cola_correos_salida
          SET estado_previo_reclamacion=estado,estado='reclamada',
              claim_id=UNHEX(?),propietario_claim=?,lease_token=UNHEX(?),
              reclamada_en_utc=UTC_TIMESTAMP(3),
              lease_expira_utc=TIMESTAMPADD(MICROSECOND,? * 1000,UTC_TIMESTAMP(3)),
              fencing_token=fencing_token+1
        WHERE id=? AND estado IN ('pendiente','error_reintentable')`,
      [claimId, propietarioClaim, leaseToken, leaseMs, salidaId]
    );
    assert.equal(Number(actualizada.affectedRows), 1);
    const [fila] = await conexion.execute(
      'SELECT fencing_token FROM cola_correos_salida WHERE id=?', [salidaId]
    );
    const fencingToken = String(fila[0].fencing_token);
    const [reclamacion] = await conexion.execute(
      `INSERT INTO reclamaciones_correos_salida (
         salida_correo_id,claim_id,fencing_token,propietario_claim,
         estado_previo,estado,reclamada_en_utc,lease_expira_utc
       ) SELECT id,claim_id,fencing_token,propietario_claim,
                estado_previo_reclamacion,'reclamada',reclamada_en_utc,lease_expira_utc
           FROM cola_correos_salida WHERE id=?`,
      [salidaId]
    );
    return {
      reclamacionId: String(reclamacion.insertId),
      salidaId,
      claimId,
      leaseToken,
      propietarioClaim,
      fencingToken
    };
  });
}

function crearCaso() {
  const reinicioId = generarUuidV7Auditoria();
  const passwordProvisional = 'A'.repeat(24);
  const mensaje = crearMensajeReinicioPasswordAdministrativo({
    nombrePortal: 'Sentinelia fixture',
    passwordProvisional,
    aplicadoEnUtc: new Date().toISOString()
  });
  const buzonCanonico = `objetivo-${randomBytes(5).toString('hex')}@example.test`;
  return {
    reinicioId,
    usuarioId: String(100 + randomBytes(1)[0]),
    passwordProvisional,
    salida: {
      reinicioId,
      buzonCanonico,
      destinatarioNombre: 'Persona objetivo',
      claveBuzonSha256: sha(buzonCanonico),
      smtpMessageId: `<${reinicioId}@correo.sentinelia>`,
      asunto: mensaje.asunto,
      cuerpoTexto: mensaje.cuerpoTexto,
      creadoPorUsuarioId: '1',
      creadaEnUtc: new Date().toISOString()
    }
  };
}

async function contarSalida(sql, reinicioId) {
  return Number((await sql.consultar(
    `SELECT COUNT(*) total FROM cola_correos_salida
      WHERE reinicio_password_administrativo_id=?`,
    [uuidV7AuditoriaABytes(reinicioId)]
  ))[0].total);
}

function sha(valor) {
  return createHash('sha256').update(valor, 'utf8').digest('hex');
}
