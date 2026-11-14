import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones } from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import { RepositorioUsuarios } from '../paquetes/usuarios/src/RepositorioUsuarios.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

await main();

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true, '5.30a.1b necesita MariaDB real.');
  const administrador = new ClienteSql(configuracion.sql);
  const base = `sentinelia_fixture_530a1b_${randomBytes(5).toString('hex')}`;
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

    const jerarquia = await crearJerarquia(sql);
    await verificarLecturaScopedBloqueante(sql, jerarquia);
    await verificarEscritorConConexionPrestada(sql, jerarquia);
    console.log(
      '[usuarios] OK 5.30a.1b: lectura=scoped_for_update ' +
      'traslado=invisible inactivo=invisible inexistente=invisible ' +
      'actor_real_efectivo=excluidos escritor=conexion_prestada generaciones=resultantes'
    );
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(base)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

async function verificarLecturaScopedBloqueante(sql, jerarquia) {
  const repositorio = new RepositorioUsuarios(sql);
  const objetivo = await crearUsuario(repositorio, {
    usuario: 'Objetivo530a1b',
    tenantId: jerarquia.tenantA,
    empresaId: jerarquia.empresaA,
    sitioId: jerarquia.sitioA
  });
  const actorReal = await crearUsuario(repositorio, {
    usuario: 'Real530a1b',
    tenantId: jerarquia.tenantA
  });
  const actorEfectivo = await crearUsuario(repositorio, {
    usuario: 'Efectivo530a1b',
    tenantId: jerarquia.tenantA,
    empresaId: jerarquia.empresaA
  });
  const inactivo = await crearUsuario(repositorio, {
    usuario: 'Inactivo530a1b',
    tenantId: jerarquia.tenantA
  });
  await repositorio.establecerActivoAdministrativo({
    idUsuario: inactivo.id,
    activo: false
  });
  const contextoTenant = {
    nivelScope: 'tenant',
    tenantId: jerarquia.tenantA,
    empresaId: null,
    sitioId: null
  };

  const conexion = await sql.obtenerConexion();
  try {
    await conexion.beginTransaction();
    const visible = await repositorio.buscarPorIdParaAdministracionEnTransaccion(
      contextoTenant,
      objetivo.id,
      { conexion, forUpdate: true }
    );
    assert.equal(visible.id, objetivo.id);
    assert.equal(visible.sitioId, jerarquia.sitioA);
    assert.equal(
      await repositorio.buscarPorIdParaAdministracionEnTransaccion(
        contextoTenant,
        inactivo.id,
        { conexion, forUpdate: true }
      ),
      null
    );
    assert.equal(
      await repositorio.buscarPorIdParaAdministracionEnTransaccion(
        contextoTenant,
        9_999_999,
        { conexion, forUpdate: true }
      ),
      null
    );
    const excluidos = [actorReal.id, actorEfectivo.id];
    for (const id of excluidos) {
      assert.equal(
        await repositorio.buscarPorIdParaAdministracionEnTransaccion(
          contextoTenant,
          id,
          { conexion, forUpdate: true, excluirIds: excluidos }
        ),
        null
      );
    }
    assert.equal(
      (await repositorio.buscarPorIdParaAdministracionEnTransaccion(
        contextoTenant,
        objetivo.id,
        { conexion, forUpdate: true, excluirIds: excluidos }
      )).id,
      objetivo.id
    );
    await conexion.rollback();
  } finally {
    conexion.release();
  }

  await sql.ejecutar(
    'UPDATE usuarios SET tenant_id=?, empresa_id=?, sitio_id=? WHERE id=?',
    [jerarquia.tenantB, jerarquia.empresaB, jerarquia.sitioB, objetivo.id]
  );
  const conexionTraslado = await sql.obtenerConexion();
  try {
    await conexionTraslado.beginTransaction();
    assert.equal(
      await repositorio.buscarPorIdParaAdministracionEnTransaccion(
        contextoTenant,
        objetivo.id,
        { conexion: conexionTraslado, forUpdate: true }
      ),
      null
    );
    await conexionTraslado.rollback();
  } finally {
    conexionTraslado.release();
  }
}

async function verificarEscritorConConexionPrestada(sql, jerarquia) {
  const repositorio = new RepositorioUsuarios(sql);
  const objetivo = await crearUsuario(repositorio, {
    usuario: 'Escritor530a1b',
    tenantId: jerarquia.tenantA
  });
  await assert.rejects(
    repositorio.reiniciarPasswordAdministrativaEnTransaccion({
      idUsuario: objetivo.id,
      hashPasswordNuevo: 'hash-sin-conexion'
    }),
    /conexión SQL prestada/
  );

  const conexion = await sql.obtenerConexion();
  try {
    await conexion.beginTransaction();
    const actualizado = await repositorio.reiniciarPasswordAdministrativaEnTransaccion(
      { idUsuario: objetivo.id, hashPasswordNuevo: 'hash-rollback' },
      { conexion }
    );
    assert.equal(actualizado.versionSesion, objetivo.versionSesion + 1);
    assert.equal(
      actualizado.generacionRecuperacion,
      String(BigInt(objetivo.generacionRecuperacion) + 1n)
    );
    await conexion.rollback();
  } finally {
    conexion.release();
  }
  const trasRollback = await repositorio.buscarPorId(objetivo.id);
  assert.equal(trasRollback.hashPassword, objetivo.hashPassword);
  assert.equal(trasRollback.versionSesion, objetivo.versionSesion);

  const consolidado = await repositorio.reiniciarPasswordAdministrativa({
    idUsuario: objetivo.id,
    hashPasswordNuevo: 'hash-consolidado'
  });
  assert.equal(consolidado.hashPassword, 'hash-consolidado');
  assert.equal(consolidado.versionSesion, objetivo.versionSesion + 1);
  assert.equal(
    consolidado.generacionRecuperacion,
    String(BigInt(objetivo.generacionRecuperacion) + 1n)
  );
}

async function crearJerarquia(sql) {
  const [tenantA] = await sql.ejecutar(
    "INSERT INTO tenants (nombre, alias) VALUES ('Tenant A', 'tenant-a')"
  );
  const [tenantB] = await sql.ejecutar(
    "INSERT INTO tenants (nombre, alias) VALUES ('Tenant B', 'tenant-b')"
  );
  const [empresaA] = await sql.ejecutar(
    "INSERT INTO empresas (tenant_id, nombre, alias) VALUES (?, 'Empresa A', 'empresa-a')",
    [tenantA.insertId]
  );
  const [empresaB] = await sql.ejecutar(
    "INSERT INTO empresas (tenant_id, nombre, alias) VALUES (?, 'Empresa B', 'empresa-b')",
    [tenantB.insertId]
  );
  const [sitioA] = await sql.ejecutar(
    "INSERT INTO sitios (tenant_id, empresa_id, nombre, alias) VALUES (?, ?, 'Sitio A', 'sitio-a')",
    [tenantA.insertId, empresaA.insertId]
  );
  const [sitioB] = await sql.ejecutar(
    "INSERT INTO sitios (tenant_id, empresa_id, nombre, alias) VALUES (?, ?, 'Sitio B', 'sitio-b')",
    [tenantB.insertId, empresaB.insertId]
  );
  return {
    tenantA: Number(tenantA.insertId),
    tenantB: Number(tenantB.insertId),
    empresaA: Number(empresaA.insertId),
    empresaB: Number(empresaB.insertId),
    sitioA: Number(sitioA.insertId),
    sitioB: Number(sitioB.insertId)
  };
}

function crearUsuario(repositorio, {
  usuario,
  tenantId = null,
  empresaId = null,
  sitioId = null
}) {
  return repositorio.crearUsuarioAdministrativo({
    usuario,
    email: `${usuario.toLowerCase()}@example.test`,
    hashPassword: 'hash-inicial',
    nombreMostrar: usuario,
    nombreCompleto: usuario,
    tenantId,
    empresaId,
    sitioId,
    permisos: permisosVacios(),
    requiereCambioPassword: true
  });
}

function permisosVacios() {
  return new Proxy({}, { get: () => false });
}
