import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import { generarUuidV7Auditoria } from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import { RepositorioUsuarios } from '../paquetes/usuarios/src/RepositorioUsuarios.js';
import { RepositorioConcesionesDdnsAgentes } from '../paquetes/dns/src/RepositorioConcesionesDdnsAgentes.js';
import { RepositorioCoordinacionGeneracionesDns } from '../paquetes/dns/src/RepositorioCoordinacionGeneracionesDns.js';
import { ServicioAplicacionDdnsAgentes } from '../paquetes/dns/src/ServicioAplicacionDdnsAgentes.js';
import {
  PERFILES_DDNS_AGENTES,
  VERSION_CONTRATO_DDNS_AGENTES
} from '../paquetes/dns/src/ContratoDdnsAgentes.js';
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
  assert.equal(configuracion.sql.estaCompleta, true, '5.28.4a necesita MariaDB real.');
  const administrador = new ClienteSql(configuracion.sql);
  const base = `sentinelia_fixture_5284a_${randomBytes(5).toString('hex')}`;
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
    const fixture = await crearFixture(sql);
    const repositorio = new RepositorioConcesionesDdnsAgentes(sql);
    const servicioA = servicio(sql);
    const servicioB = servicio(sql);
    const concesion = await repositorio.crearConcesion({
      concesionId: generarUuidV7Auditoria(),
      agenteId: fixture.agenteA,
      registroDnsId: fixture.registroA
    });

    const peticion = solicitud('0', '192.0.2.41');
    const aceptada = await servicioA.aceptarIntencionExplicita({
      contextoSesionTecnica: contexto(fixture.agenteA),
      concesionId: concesion.concesionId,
      solicitud: peticion
    });
    assert.equal(aceptada.resultado, 'aceptada');
    assert.equal(aceptada.version, '1');
    assert.ok(['intencion_aceptada', 'contenido_deseado_persistido'].includes(aceptada.hito));

    const repetida = await servicioB.aceptarIntencionExplicita({
      contextoSesionTecnica: contexto(fixture.agenteA),
      concesionId: concesion.concesionId,
      solicitud: peticion
    });
    assert.equal(repetida.resultado, 'repetida');
    assert.equal(repetida.version, '1');

    const conflictiva = await servicioA.aceptarIntencionExplicita({
      contextoSesionTecnica: contexto(fixture.agenteA),
      concesionId: concesion.concesionId,
      solicitud: { ...peticion, versionEsperada: '1' }
    });
    assert.equal(conflictiva.error, 'idempotencia_conflictiva');

    const convergente = await servicioA.aceptarIntencionExplicita({
      contextoSesionTecnica: contexto(fixture.agenteA),
      concesionId: concesion.concesionId,
      solicitud: solicitud('0', '192.0.2.41')
    });
    assert.equal(convergente.resultado, 'convergente',
      'la igualdad debe preceder a la versión obsoleta');
    await publicarIntencion(sql, concesion.idInterno);
    const sinCambios = await servicioA.aceptarIntencionExplicita({
      contextoSesionTecnica: contexto(fixture.agenteA),
      concesionId: concesion.concesionId,
      solicitud: solicitud('0', '192.0.2.41')
    });
    assert.equal(sinCambios.resultado, 'sin_cambios');

    const ajena = await servicioA.aceptarIntencionExplicita({
      contextoSesionTecnica: contexto(fixture.agenteB),
      concesionId: concesion.concesionId,
      solicitud: solicitud('1', '192.0.2.42')
    });
    const ausente = await servicioA.aceptarIntencionExplicita({
      contextoSesionTecnica: contexto(fixture.agenteB),
      concesionId: generarUuidV7Auditoria(),
      solicitud: solicitud('1', '192.0.2.42')
    });
    assert.deepEqual(ajena, ausente, 'autoridad ajena y concesión ausente deben ser uniformes');
    assert.equal(ajena.error, 'sin_autoridad');

    const basura = await servicioA.aceptarIntencionExplicita({
      contextoSesionTecnica: contexto(fixture.agenteA),
      concesionId: concesion.concesionId,
      solicitud: solicitud('1', '999.2.3.4')
    });
    assert.equal(basura.error, 'valor_no_interpretable');

    const concesionCarrera = await repositorio.crearConcesion({
      concesionId: generarUuidV7Auditoria(),
      agenteId: fixture.agenteA,
      registroDnsId: fixture.registroB
    });
    const [carreraA, carreraB] = await Promise.all([
      servicioA.aceptarIntencionExplicita({
        contextoSesionTecnica: contexto(fixture.agenteA),
        concesionId: concesionCarrera.concesionId,
        solicitud: solicitud('0', '198.51.100.10')
      }),
      servicioB.aceptarIntencionExplicita({
        contextoSesionTecnica: contexto(fixture.agenteA),
        concesionId: concesionCarrera.concesionId,
        solicitud: solicitud('0', '198.51.100.11')
      })
    ]);
    assert.deepEqual(
      [carreraA, carreraB].map((r) => r.resultado === 'aceptada' ? 'aceptada' : r.error).sort(),
      ['aceptada', 'version_obsoleta']
    );
    const [registro] = await sql.consultar(
      'SELECT valor_principal FROM registros_dns WHERE id=?', [fixture.registroA]
    );
    assert.equal(registro.valor_principal, '192.0.2.41');
    const [conteo] = await sql.consultar(
      `SELECT COUNT(*) total FROM solicitudes_ddns_agentes
        WHERE concesion_interna_id=?`, [concesion.idInterno]
    );
    assert.equal(Number(conteo.total), 3,
      'solo aceptación y convergencias deben quedar registradas');

    console.log(
      '[dns-ddns] OK 5.28.4a: sesion=resuelta autoridad=uniforme ' +
      'idempotencia=durable convergencia=antes_version carrera=serializada'
    );
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(base)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

function servicio(sql) {
  return new ServicioAplicacionDdnsAgentes({
    clienteSql: sql,
    repositorioUsuarios: new RepositorioUsuarios(sql),
    repositorioCoordinacionGeneracionesDns: new RepositorioCoordinacionGeneracionesDns({
      clienteSql: sql,
      bloquearCatalogoEnTransaccion
    })
  });
}

async function bloquearCatalogoEnTransaccion({ conexion }) {
  await conexion.execute('SELECT id FROM zonas_dns ORDER BY id FOR UPDATE');
  await conexion.execute('SELECT id FROM registros_dns ORDER BY zona_id,id FOR UPDATE');
}

function contexto(agenteId) {
  return Object.freeze({ sesion: Object.freeze({ agenteId: String(agenteId) }) });
}

function solicitud(versionEsperada, direccionIpv4) {
  return {
    perfil: PERFILES_DDNS_AGENTES.SOLICITUD,
    versionContrato: VERSION_CONTRATO_DDNS_AGENTES,
    solicitudId: generarUuidV7Auditoria(),
    versionEsperada,
    estadoDeseado: {
      perfil: PERFILES_DDNS_AGENTES.ESTADO_DESEADO,
      versionContrato: VERSION_CONTRATO_DDNS_AGENTES,
      tipo: 'A',
      modo: 'declarada',
      valor: { direccionIpv4 }
    }
  };
}

async function publicarIntencion(sql, concesionInternaId) {
  await sql.ejecutar(
    `UPDATE intenciones_ddns_agentes
        SET hito='contenido_publicado',persistida_en_utc=UTC_TIMESTAMP(3),
            publicada_en_utc=UTC_TIMESTAMP(3),terminal='publicada',
            terminada_en_utc=UTC_TIMESTAMP(3)
      WHERE concesion_interna_id=? AND terminal IS NULL`,
    [concesionInternaId]
  );
}

async function crearFixture(sql) {
  const [tenant] = await sql.ejecutar(
    "INSERT INTO tenants (nombre,alias) VALUES ('Tenant 5.28.4a','tenant-5284a')"
  );
  const [empresa] = await sql.ejecutar(
    "INSERT INTO empresas (tenant_id,nombre,alias) VALUES (?,'Empresa 5.28.4a','empresa-5284a')",
    [tenant.insertId]
  );
  const [sitio] = await sql.ejecutar(
    "INSERT INTO sitios (tenant_id,empresa_id,nombre,alias) VALUES (?,?,'Sitio 5.28.4a','sitio-5284a')",
    [tenant.insertId, empresa.insertId]
  );
  const agentes = [];
  for (const nombre of ['Agente A 5.28.4a', 'Agente B 5.28.4a']) {
    const [agente] = await sql.ejecutar(
      `INSERT INTO agentes_sentinelia (
         guid,tenant_id,empresa_id,sitio_id,nombre,secreto_hash
       ) VALUES (?,?,?,?,?,'hash')`,
      [generarUuidV7Auditoria(), tenant.insertId, empresa.insertId, sitio.insertId, nombre]
    );
    agentes.push(agente.insertId);
  }
  const [zona] = await sql.ejecutar(
    `INSERT INTO zonas_dns (
       tenant_id,empresa_id,sitio_id,nombre_zona,soa_mname,soa_rname
     ) VALUES (?,?,?,?,?,?)`,
    [tenant.insertId, empresa.insertId, sitio.insertId,
      'ddns-5284a.example.', 'ns.example.', 'hostmaster.example.']
  );
  const registros = [];
  for (const [host, valor] of [['host-a', '192.0.2.10'], ['host-b', '192.0.2.20']]) {
    const [registro] = await sql.ejecutar(
      `INSERT INTO registros_dns (
         zona_id,tenant_id,empresa_id,sitio_id,host_relativo,tipo_registro,
         valor_principal,ttl_segundos,categoria_origen
       ) VALUES (?,?,?,?,?,'A',?,300,'ddns')`,
      [zona.insertId, tenant.insertId, empresa.insertId, sitio.insertId, host, valor]
    );
    registros.push(registro.insertId);
  }
  return Object.freeze({
    agenteA: agentes[0], agenteB: agentes[1],
    registroA: registros[0], registroB: registros[1]
  });
}
