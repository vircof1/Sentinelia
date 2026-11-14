import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import { generarUuidV7Auditoria } from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import { RepositorioColaCorreo } from '../paquetes/correo/src/RepositorioColaCorreo.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones } from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import {
  ErrorConflictoReinicioPasswordAdministrativo,
  RepositorioReiniciosPasswordAdministrativosSql
} from '../paquetes/usuarios/src/RepositorioReiniciosPasswordAdministrativosSql.js';
import {
  VIAS_REINICIO_PASSWORD_ADMINISTRATIVO
} from '../paquetes/usuarios/src/ContratoReinicioPasswordAdministrativo.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

await main();

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true, '5.30a.2b necesita MariaDB real.');
  const administrador = new ClienteSql(configuracion.sql);
  const base = `sentinelia_fixture_530a2b_${randomBytes(5).toString('hex')}`;
  let sql;

  try {
    await administrador.ejecutar(
      `CREATE DATABASE ${administrador.escaparIdentificador(base)} ` +
        'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
    );
    sql = new ClienteSql({ ...configuracion.sql, baseDatos: base });
    const migraciones = new EjecutorMigraciones({
      clienteSql: sql,
      repositorioMigraciones: new RepositorioMigraciones(sql),
      rutaMigraciones: obtenerRutaMigraciones()
    });
    const instalacionVacia = await migraciones.ejecutarPendientes();
    assert.ok(instalacionVacia.pendientesAplicadas > 0);
    const instalacionActualizada = await migraciones.ejecutarPendientes();
    assert.equal(instalacionActualizada.pendientesAplicadas, 0);
    assert.equal(instalacionActualizada.integridad.ok, true);

    const repositorio = new RepositorioReiniciosPasswordAdministrativosSql(sql);
    await verificarRollback(repositorio, sql);
    await verificarReservaYColisiones(repositorio, sql);
    await verificarConfirmacionManual(repositorio, sql);
    await verificarRetencionSalida(repositorio, sql);
    await verificarAusenciaDeFkUsuario(sql);

    console.log(
      '[usuarios] OK 5.30a.2b: migracion=vacia+actualizada ' +
      'reserva=transaccional replay=compatible colision=cerrada ' +
      'confirmacion=idempotente historico=sin_fk_usuario salida=on_delete_set_null'
    );
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(base)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

async function verificarRollback(repositorio, sql) {
  const reinicioId = generarUuidV7Auditoria();
  const conexion = await sql.obtenerConexion();
  try {
    await conexion.beginTransaction();
    const reserva = await repositorio.reservarEnTransaccion({
      reinicioId,
      usuarioId: '101',
      via: VIAS_REINICIO_PASSWORD_ADMINISTRATIVO.MANUAL
    }, { conexion });
    assert.equal(reserva.creada, true);
    await conexion.rollback();
  } finally {
    conexion.release();
  }
  assert.equal(await repositorio.buscarPorId(reinicioId), null);
}

async function verificarReservaYColisiones(repositorio, sql) {
  const reinicioId = generarUuidV7Auditoria();
  await enTransaccion(sql, async (conexion) => {
    const primera = await repositorio.reservarEnTransaccion({
      reinicioId,
      usuarioId: '201',
      via: VIAS_REINICIO_PASSWORD_ADMINISTRATIVO.MANUAL
    }, { conexion });
    assert.equal(primera.creada, true);
    const repetida = await repositorio.reservarEnTransaccion({
      reinicioId,
      usuarioId: 201,
      via: VIAS_REINICIO_PASSWORD_ADMINISTRATIVO.MANUAL
    }, { conexion });
    assert.equal(repetida.creada, false);
    assert.deepEqual(repetida.operacion, primera.operacion);
  });

  await enTransaccion(sql, async (conexion) => {
    await assert.rejects(
      repositorio.reservarEnTransaccion({
        reinicioId,
        usuarioId: '202',
        via: VIAS_REINICIO_PASSWORD_ADMINISTRATIVO.MANUAL
      }, { conexion }),
      ErrorConflictoReinicioPasswordAdministrativo
    );
    await assert.rejects(
      repositorio.reservarEnTransaccion({
        reinicioId,
        usuarioId: '201',
        via: VIAS_REINICIO_PASSWORD_ADMINISTRATIVO.CORREO
      }, { conexion }),
      ErrorConflictoReinicioPasswordAdministrativo
    );
  });
}

async function verificarConfirmacionManual(repositorio, sql) {
  const reinicioId = generarUuidV7Auditoria();
  const eventoAuditoriaId = generarUuidV7Auditoria();
  const intencion = {
    reinicioId,
    usuarioId: '301',
    via: VIAS_REINICIO_PASSWORD_ADMINISTRATIVO.MANUAL
  };
  const resultado = {
    reinicioId,
    eventoAuditoriaId,
    salidaCorreoId: null,
    versionSesionResultante: '7',
    generacionRecuperacionResultante: '12'
  };
  await enTransaccion(sql, async (conexion) => {
    await repositorio.reservarEnTransaccion(intencion, { conexion });
    const primera = await repositorio.confirmarEnTransaccion(resultado, { conexion });
    assert.equal(primera.confirmado, true);
    assert.equal(primera.operacion.estado, 'confirmado');
    assert.match(primera.operacion.aplicadoEnUtc, /Z$/u);
    const repetida = await repositorio.confirmarEnTransaccion(resultado, { conexion });
    assert.equal(repetida.confirmado, false);
  });
  const ultima = await repositorio.buscarUltimoPorUsuario('301');
  assert.equal(ultima.reinicioId, reinicioId);
  assert.equal(ultima.versionSesionResultante, '7');
  await enTransaccion(sql, async (conexion) => {
    await assert.rejects(
      repositorio.confirmarEnTransaccion({
        ...resultado,
        versionSesionResultante: '8'
      }, { conexion }),
      ErrorConflictoReinicioPasswordAdministrativo
    );
  });
}

async function verificarRetencionSalida(repositorio, sql) {
  const salida = await new RepositorioColaCorreo(sql).crearPendienteLegacy({
    destinatarioEmail: 'destino@example.test',
    destinatarioNombre: null,
    remitenteEmail: 'origen@example.test',
    remitenteNombre: null,
    asunto: 'Verificación 5.30a.2b',
    cuerpoTexto: 'Material desechable.',
    creadoPorUsuarioId: null
  });
  const reinicioId = generarUuidV7Auditoria();
  const resultado = {
    reinicioId,
    eventoAuditoriaId: generarUuidV7Auditoria(),
    salidaCorreoId: String(salida.id),
    versionSesionResultante: '9',
    generacionRecuperacionResultante: '14'
  };
  await enTransaccion(sql, async (conexion) => {
    await repositorio.reservarEnTransaccion({
      reinicioId,
      usuarioId: '401',
      via: VIAS_REINICIO_PASSWORD_ADMINISTRATIVO.CORREO
    }, { conexion });
    await repositorio.confirmarEnTransaccion(resultado, { conexion });
  });
  await sql.ejecutar('DELETE FROM cola_correos_salida WHERE id=?', [salida.id]);
  const retenida = await repositorio.buscarPorId(reinicioId);
  assert.equal(retenida.estado, 'confirmado');
  assert.equal(retenida.salidaCorreoId, null);

  await enTransaccion(sql, async (conexion) => {
    const replay = await repositorio.confirmarEnTransaccion(resultado, { conexion });
    assert.equal(replay.confirmado, false);
    assert.equal(replay.operacion.salidaCorreoId, null);
  });
}

async function verificarAusenciaDeFkUsuario(sql) {
  const filas = await sql.consultar(
    `SELECT COUNT(*) AS total
       FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA=DATABASE()
        AND TABLE_NAME='reinicios_password_administrativos'
        AND COLUMN_NAME='usuario_id'
        AND REFERENCED_TABLE_NAME IS NOT NULL`
  );
  assert.equal(Number(filas[0].total), 0);
}

async function enTransaccion(sql, tarea) {
  const conexion = await sql.obtenerConexion();
  try {
    await conexion.beginTransaction();
    const resultado = await tarea(conexion);
    await conexion.commit();
    return resultado;
  } catch (error) {
    await conexion.rollback();
    throw error;
  } finally {
    conexion.release();
  }
}
