import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones } from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import { RepositorioUsuarios } from '../paquetes/usuarios/src/RepositorioUsuarios.js';
import { Usuario } from '../paquetes/usuarios/src/Usuario.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

const BUZON = 'compartido@example.test';

await main();

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true, '5.30.1a necesita MariaDB real.');

  const administrador = new ClienteSql(configuracion.sql);
  const sufijo = randomBytes(5).toString('hex');
  const baseExistente = `sentinelia_fixture_5301a_existente_${sufijo}`;
  const baseVacia = `sentinelia_fixture_5301a_vacia_${sufijo}`;
  try {
    await verificarInstalacionExistente(administrador, configuracion, baseExistente);
    await verificarInstalacionVacia(administrador, configuracion, baseVacia);
    console.log(
      '[usuarios] OK 5.30.1a: esquema=inicial generacion_inicial=1 reejecucion=estable ' +
      'frontera=completa_sin_paginar collation_usuario=nativa ' +
      'buzon=canonico_exacto bloqueo=id_generacion eliminacion=no_resucita'
    );
  } finally {
    for (const base of [baseExistente, baseVacia]) {
      await administrador.ejecutar(
        `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(base)}`
      ).catch(() => {});
    }
    await administrador.cerrar();
  }
}

async function verificarInstalacionExistente(administrador, configuracion, base) {
  await crearBase(administrador, base);
  const sql = new ClienteSql({ ...configuracion.sql, baseDatos: base });
  try {
    const ejecutor = crearEjecutor(sql);
    await ejecutor.ejecutarPendientes();
    const legadoId = await insertarUsuario(sql, {
      usuario: 'Legado5301a',
      email: BUZON,
      emailValidado: 1,
      activo: 1
    });
    await ejecutor.ejecutarPendientes();
    await ejecutor.ejecutarPendientes();

    const [legado] = await sql.consultar(
      'SELECT CAST(generacion_recuperacion AS CHAR) AS generacion FROM usuarios WHERE id=?',
      [legadoId]
    );
    assert.equal(legado.generacion, '1');
    await verificarEsquema(sql);
    await verificarEntidadYRepositorio(sql, legadoId);
  } finally {
    await sql.cerrar();
  }
}

async function verificarInstalacionVacia(administrador, configuracion, base) {
  await crearBase(administrador, base);
  const sql = new ClienteSql({ ...configuracion.sql, baseDatos: base });
  try {
    const ejecutor = crearEjecutor(sql);
    await ejecutor.ejecutarPendientes();
    await verificarEsquema(sql);
    const id = await insertarUsuario(sql, {
      usuario: 'Nuevo5301a',
      email: 'nuevo@example.test',
      emailValidado: 1,
      activo: 1
    });
    const [fila] = await sql.consultar(
      'SELECT CAST(generacion_recuperacion AS CHAR) AS generacion FROM usuarios WHERE id=?',
      [id]
    );
    assert.equal(fila.generacion, '1');
  } finally {
    await sql.cerrar();
  }
}

async function verificarEsquema(sql) {
  const columnas = await sql.consultar(
    `SELECT COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='usuarios'
        AND COLUMN_NAME='generacion_recuperacion'`
  );
  assert.equal(columnas.length, 1);
  assert.equal(columnas[0].COLUMN_TYPE.toLowerCase(), 'bigint(20) unsigned');
  assert.equal(columnas[0].IS_NULLABLE, 'NO');
  assert.equal(String(columnas[0].COLUMN_DEFAULT), '1');
  const checks = await sql.consultar(
    `SELECT CONSTRAINT_NAME
       FROM information_schema.TABLE_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='usuarios'
        AND CONSTRAINT_TYPE='CHECK'
        AND CONSTRAINT_NAME='chk_usuarios_generacion_recuperacion'`
  );
  assert.equal(checks.length, 1);
  await assert.rejects(
    () => sql.ejecutar(
      `INSERT INTO usuarios
        (usuario,email,hash_password,generacion_recuperacion)
       VALUES ('CheckGeneracion5301a','check-generacion@example.test','hash',0)`
    ),
    /constraint|check/iu
  );
}

async function verificarEntidadYRepositorio(sql, legadoId) {
  for (let indice = 0; indice < 240; indice += 1) {
    await insertarUsuario(sql, {
      usuario: `Compartido5301a${String(indice).padStart(3, '0')}`,
      email: BUZON,
      emailValidado: 1,
      activo: 1
    });
  }
  await insertarUsuario(sql, {
    usuario: 'Inactivo5301a', email: BUZON, emailValidado: 1, activo: 0
  });
  await insertarUsuario(sql, {
    usuario: 'NoValidado5301a', email: BUZON, emailValidado: 0, activo: 1
  });
  await insertarUsuario(sql, {
    usuario: 'BuzonNoCanonico5301a',
    email: 'Compartido@example.test',
    emailValidado: 1,
    activo: 1
  });

  const repositorio = new RepositorioUsuarios(sql);
  const conexion = await sql.obtenerConexion();
  try {
    await conexion.beginTransaction();
    const frontera =
      await repositorio.listarFronteraElegibleRecuperacionPorBuzonEnTransaccion(
        { buzonCanonico: BUZON },
        { conexion }
      );
    assert.equal(frontera.length, 241);
    assert.equal(Object.isFrozen(frontera), true);
    assert.ok(frontera.every((miembro) => Object.isFrozen(miembro)));
    assert.ok(frontera.every((miembro) => miembro.generacionRecuperacion === '1'));
    assert.deepEqual(
      frontera.map(({ usuarioId }) => BigInt(usuarioId)),
      [...frontera].map(({ usuarioId }) => BigInt(usuarioId)).sort((a, b) => a < b ? -1 : 1)
    );

    const porCollation =
      await repositorio.buscarIdentidadElegibleRecuperacionPorUsuarioEnTransaccion(
        { usuario: 'legado5301A', buzonCanonico: BUZON },
        { conexion }
      );
    assert.ok(porCollation instanceof Usuario);
    assert.equal(String(porCollation.id), String(legadoId));
    assert.equal(porCollation.generacionRecuperacion, '1');

    const bloqueada =
      await repositorio.bloquearIdentidadElegibleRecuperacionEnTransaccion(
        {
          idUsuario: legadoId,
          generacionRecuperacionObservada: '1',
          buzonCanonico: BUZON
        },
        { conexion }
      );
    assert.equal(String(bloqueada.id), String(legadoId));
    assert.equal(
      await repositorio.bloquearIdentidadElegibleRecuperacionEnTransaccion(
        {
          idUsuario: legadoId,
          generacionRecuperacionObservada: '2',
          buzonCanonico: BUZON
        },
        { conexion }
      ),
      null
    );
    const sustituida = await repositorio
      .sustituirPasswordPorRecuperacionEnTransaccion({
        idUsuario: legadoId,
        generacionRecuperacionObservada: '1',
        buzonCanonico: BUZON,
        hashPasswordNuevo: '$2b$12$fixture.recuperacion.password'
      }, { conexion });
    assert.equal(sustituida.requiereCambioPassword, false);
    assert.equal(Number(sustituida.versionSesion), 2);
    assert.equal(sustituida.generacionRecuperacion, '2');
    assert.equal(
      await repositorio.sustituirPasswordPorRecuperacionEnTransaccion({
        idUsuario: legadoId,
        generacionRecuperacionObservada: '1',
        buzonCanonico: BUZON,
        hashPasswordNuevo: '$2b$12$fixture.replay'
      }, { conexion }),
      null,
      'la generación anterior no puede repetir la sustitución'
    );
    await conexion.rollback();
  } finally {
    conexion.release();
  }

  await assert.rejects(
    () => insertarUsuario(sql, {
      usuario: 'legado5301a', email: 'otro@example.test', emailValidado: 1, activo: 1
    }),
    /duplicate|duplicada|ER_DUP_ENTRY/iu
  );

  await sql.ejecutar('DELETE FROM usuarios WHERE id=?', [legadoId]);
  const recreadaId = await insertarUsuario(sql, {
    usuario: 'Legado5301a', email: BUZON, emailValidado: 1, activo: 1
  });
  assert.notEqual(String(recreadaId), String(legadoId));
  const conexionRecreada = await sql.obtenerConexion();
  try {
    await conexionRecreada.beginTransaction();
    assert.equal(
      await repositorio.bloquearIdentidadElegibleRecuperacionEnTransaccion(
        {
          idUsuario: legadoId,
          generacionRecuperacionObservada: '1',
          buzonCanonico: BUZON
        },
        { conexion: conexionRecreada }
      ),
      null
    );
    await conexionRecreada.rollback();
  } finally {
    conexionRecreada.release();
  }
}

async function insertarUsuario(sql, { usuario, email, emailValidado, activo }) {
  const [resultado] = await sql.ejecutar(
    `INSERT INTO usuarios
      (usuario,email,email_validado,hash_password,activo)
     VALUES (?,?,?,?,?)`,
    [usuario, email, emailValidado, 'hash-no-utilizable-5.30.1a', activo]
  );
  return String(resultado.insertId);
}

async function crearBase(administrador, base) {
  await administrador.ejecutar(
    `CREATE DATABASE ${administrador.escaparIdentificador(base)} ` +
      'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
  );
}

function crearEjecutor(sql) {
  return new EjecutorMigraciones({
    clienteSql: sql,
    repositorioMigraciones: new RepositorioMigraciones(sql),
    rutaMigraciones: obtenerRutaMigraciones()
  });
}
