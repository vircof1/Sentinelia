import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import { generarUuidV7Auditoria } from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import {
  ErrorConcesionDdnsAgentes,
  RepositorioConcesionesDdnsAgentes
} from '../paquetes/dns/src/RepositorioConcesionesDdnsAgentes.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones } from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

await main();

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true, '5.28.1a necesita MariaDB real.');
  const administrador = new ClienteSql(configuracion.sql);
  const sufijo = randomBytes(5).toString('hex');
  const bases = [
    `sentinelia_fixture_5281a_vacia_${sufijo}`,
    `sentinelia_fixture_5281a_actualiza_${sufijo}`
  ];
  const clientes = [];

  try {
    for (const base of bases) {
      await administrador.ejecutar(
        `CREATE DATABASE ${administrador.escaparIdentificador(base)} ` +
          'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
      );
      clientes.push(new ClienteSql({ ...configuracion.sql, baseDatos: base }));
    }

    await migrar(clientes[0], obtenerRutaMigraciones());
    await verificarPostcondiciones(clientes[0]);
    await verificarRepositorioYCarrera(clientes[0]);

    await migrar(clientes[1], obtenerRutaMigraciones());
    await crearRegistroLegadoDdns(clientes[1]);
    await migrar(clientes[1], obtenerRutaMigraciones());
    await verificarPostcondiciones(clientes[1]);
    const [sinBackfill] = await clientes[1].consultar(
      'SELECT COUNT(*) AS total FROM concesiones_ddns_agentes'
    );
    assert.equal(Number(sinBackfill.total), 0, 'Reejecutar el esquema no debe inferir concesiones desde datos_auxiliares.');

    console.log(
      '[dns-ddns] OK 5.28.1a: esquema=inicial instalacion+reejecucion=ok ' +
      'tablas=3 uuidv7=binario snapshots=durables cierre=historico ' +
      'exclusividad=concurrente backfill=no'
    );
  } finally {
    for (const cliente of clientes) await cliente.cerrar().catch(() => {});
    for (const base of bases) {
      await administrador.ejecutar(
        `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(base)}`
      ).catch(() => {});
    }
    await administrador.cerrar();
  }
}

async function migrar(cliente, rutaMigraciones) {
  await new EjecutorMigraciones({
    clienteSql: cliente,
    repositorioMigraciones: new RepositorioMigraciones(cliente),
    rutaMigraciones
  }).ejecutarPendientes();
}

async function verificarPostcondiciones(sql) {
  const tablas = await sql.consultar(
    `SELECT TABLE_NAME AS nombre
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA=DATABASE()
        AND TABLE_NAME IN (
          'concesiones_ddns_agentes','solicitudes_ddns_agentes',
          'intenciones_ddns_agentes'
        ) ORDER BY TABLE_NAME`
  );
  assert.deepEqual(tablas.map(({ nombre }) => nombre), [
    'concesiones_ddns_agentes',
    'intenciones_ddns_agentes',
    'solicitudes_ddns_agentes'
  ]);
  const indices = await sql.consultar(
    `SELECT INDEX_NAME AS nombre
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA=DATABASE()
        AND TABLE_NAME='concesiones_ddns_agentes'
        AND NON_UNIQUE=0`
  );
  assert.ok(indices.some(({ nombre }) => nombre === 'uk_concesiones_ddns_registro_vigente'));
  const columnas = await sql.consultar(
    `SELECT COLUMN_NAME AS nombre,DATA_TYPE AS tipo,GENERATION_EXPRESSION AS expresion
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA=DATABASE()
        AND TABLE_NAME='concesiones_ddns_agentes'`
  );
  assert.equal(columnas.find(({ nombre }) => nombre === 'concesion_id').tipo, 'binary');
  assert.match(
    columnas.find(({ nombre }) => nombre === 'registro_dns_id_vigente').expresion,
    /estado.*vigente/iu
  );
}

async function verificarRepositorioYCarrera(sql) {
  const fixture = await crearFixture(sql, 'operativa');
  const repositorio = new RepositorioConcesionesDdnsAgentes(sql);
  const ids = [generarUuidV7Auditoria(), generarUuidV7Auditoria()];
  const resultados = await Promise.allSettled([
    repositorio.crearConcesion({
      concesionId: ids[0],
      agenteId: fixture.agenteA,
      registroDnsId: fixture.registro
    }),
    repositorio.crearConcesion({
      concesionId: ids[1],
      agenteId: fixture.agenteB,
      registroDnsId: fixture.registro
    })
  ]);
  assert.equal(resultados.filter(({ status }) => status === 'fulfilled').length, 1);
  const rechazo = resultados.find(({ status }) => status === 'rejected').reason;
  assert.ok(rechazo instanceof ErrorConcesionDdnsAgentes);
  assert.equal(rechazo.codigo, 'registro_ya_concedido');

  const ganadora = resultados.find(({ status }) => status === 'fulfilled').value;
  assert.equal(ganadora.estado, 'vigente');
  assert.equal(ganadora.version, '0');
  assert.equal(ganadora.decision, 'pendiente_decision_agente');
  assert.equal(ganadora.scopeAgente.sitioId, String(fixture.sitio));
  assert.equal(ganadora.scopeRegistro.tenantId, null);

  const cerrada = await repositorio.cerrarConcesion({
    concesionId: ganadora.concesionId,
    causa: 'revocada_desde_registro'
  });
  assert.equal(cerrada.estado, 'revocada');
  assert.equal(cerrada.causaCierre, 'revocada_desde_registro');
  assert.ok(cerrada.cerradaEnUtc);
  const repetida = await repositorio.cerrarConcesion({
    concesionId: ganadora.concesionId,
    causa: 'revocada_desde_agente'
  });
  assert.equal(repetida.causaCierre, 'revocada_desde_registro');

  const nueva = await repositorio.crearConcesion({
    concesionId: generarUuidV7Auditoria(),
    agenteId: fixture.agenteB,
    registroDnsId: fixture.registro
  });
  assert.equal(nueva.estado, 'vigente', 'cerrar libera la exclusividad sin borrar histórico.');
  const [conteo] = await sql.consultar(
    'SELECT COUNT(*) AS total FROM concesiones_ddns_agentes WHERE registro_dns_id_fotografia=?',
    [fixture.registro]
  );
  assert.equal(Number(conteo.total), 2);

  await repositorio.desacoplarExtremoCerrado({
    concesionId: cerrada.concesionId,
    extremo: 'agente'
  });
  await repositorio.desacoplarExtremoCerrado({
    concesionId: cerrada.concesionId,
    extremo: 'registro'
  });
  const desacoplada = await repositorio.buscarPorConcesionId(cerrada.concesionId);
  assert.equal(desacoplada.agenteId, null);
  assert.equal(desacoplada.registroDnsId, null);
  assert.equal(desacoplada.agenteIdFotografia, cerrada.agenteIdFotografia);
  assert.equal(desacoplada.registroDnsIdFotografia, cerrada.registroDnsIdFotografia);
}

async function crearRegistroLegadoDdns(sql) {
  const fixture = await crearFixture(sql, 'actualizacion');
  await sql.ejecutar(
    `UPDATE registros_dns
        SET datos_auxiliares=JSON_OBJECT('agenteId',?)
      WHERE id=?`,
    [fixture.agenteA, fixture.registro]
  );
}

async function crearFixture(sql, sufijo) {
  const [tenant] = await sql.ejecutar(
    'INSERT INTO tenants (nombre,alias) VALUES (?,?)',
    [`Tenant ${sufijo}`, `tenant-${sufijo}`]
  );
  const [empresa] = await sql.ejecutar(
    'INSERT INTO empresas (tenant_id,nombre,alias) VALUES (?,?,?)',
    [tenant.insertId, `Empresa ${sufijo}`, `empresa-${sufijo}`]
  );
  const [sitio] = await sql.ejecutar(
    'INSERT INTO sitios (tenant_id,empresa_id,nombre,alias) VALUES (?,?,?,?)',
    [tenant.insertId, empresa.insertId, `Sitio ${sufijo}`, `sitio-${sufijo}`]
  );
  const [zona] = await sql.ejecutar(
    `INSERT INTO zonas_dns (
       nombre_zona,soa_mname,soa_rname
     ) VALUES (?,?,?)`,
    [`${sufijo}.example.`, 'ns.example.', 'hostmaster.example.']
  );
  const [registro] = await sql.ejecutar(
    `INSERT INTO registros_dns (
       zona_id,host_relativo,tipo_registro,valor_principal,categoria_origen
     ) VALUES (?,'host','A','192.0.2.1','ddns')`,
    [zona.insertId]
  );
  const agentes = [];
  for (const letra of ['a', 'b']) {
    const [agente] = await sql.ejecutar(
      `INSERT INTO agentes_sentinelia (
         guid,tenant_id,empresa_id,sitio_id,nombre,secreto_hash
       ) VALUES (?,?,?,?,?,?)`,
      [
        generarUuidV7Auditoria(), tenant.insertId, empresa.insertId,
        sitio.insertId, `Agente ${letra} ${sufijo}`, 'hash-fixture'
      ]
    );
    agentes.push(agente.insertId);
  }
  return {
    tenant: tenant.insertId,
    empresa: empresa.insertId,
    sitio: sitio.insertId,
    registro: registro.insertId,
    agenteA: agentes[0],
    agenteB: agentes[1]
  };
}
