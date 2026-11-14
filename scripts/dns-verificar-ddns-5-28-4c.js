import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import { generarUuidV7Auditoria } from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import { RepositorioUsuarios } from '../paquetes/usuarios/src/RepositorioUsuarios.js';
import { RepositorioConcesionesDdnsAgentes } from '../paquetes/dns/src/RepositorioConcesionesDdnsAgentes.js';
import { RepositorioCoordinacionGeneracionesDns } from '../paquetes/dns/src/RepositorioCoordinacionGeneracionesDns.js';
import { ServicioAplicacionDdnsAgentes } from '../paquetes/dns/src/ServicioAplicacionDdnsAgentes.js';
import { PERFILES_DDNS_AGENTES, VERSION_CONTRATO_DDNS_AGENTES }
  from '../paquetes/dns/src/ContratoDdnsAgentes.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones } from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import { obtenerConfiguracionAplicacion, obtenerRutaMigraciones }
  from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

await main();

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true, '5.28.4c necesita MariaDB real.');
  const administrador = new ClienteSql(configuracion.sql);
  const base = `sentinelia_fixture_5284c_${randomBytes(5).toString('hex')}`;
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
    const coordinacion = new RepositorioCoordinacionGeneracionesDns({
      clienteSql: sql,
      bloquearCatalogoEnTransaccion
    });
    const servicio = new ServicioAplicacionDdnsAgentes({
      clienteSql: sql,
      repositorioUsuarios: new RepositorioUsuarios(sql),
      repositorioCoordinacionGeneracionesDns: coordinacion
    });
    const concesion = await new RepositorioConcesionesDdnsAgentes(sql).crearConcesion({
      concesionId: generarUuidV7Auditoria(),
      agenteId: fixture.agente,
      registroDnsId: fixture.registro
    });

    const primeraSolicitud = solicitud('0', '192.0.2.101');
    assert.equal((await aceptar(servicio, fixture, concesion, primeraSolicitud)).version, '1');
    await ponerGobernanteEnProceso(sql, concesion.idInterno, 'publicador-a');

    const humana = await servicio.editarValorGobernado({
      contextoUsuarioActual: contextoUsuario(fixture),
      registroDnsId: fixture.registro,
      valorPrincipal: '192.0.2.102'
    });
    assert.equal(humana.version, '2');
    await ponerGobernanteEnProceso(sql, concesion.idInterno, 'publicador-b');

    const tercera = await aceptar(
      servicio,
      fixture,
      concesion,
      solicitud('2', '192.0.2.103')
    );
    assert.equal(tercera.version, '3');

    const fotografia = await fotografiar(sql, concesion.idInterno);
    assert.deepEqual(fotografia.intenciones.map((fila) => [fila.version, fila.origen, fila.terminal]), [
      ['1', 'agente_explicita', 'sustituida'],
      ['2', 'usuario', 'sustituida'],
      ['3', 'agente_explicita', null]
    ]);
    assert.deepEqual(fotografia.intentos.map((fila) => [fila.version, fila.estado]), [
      ['1', 'procesando'],
      ['2', 'procesando'],
      ['3', 'pendiente']
    ], 'los efectos en curso deben conservarse para poder acreditar su desenlace');

    await confirmarIntentoAntiguo(sql, concesion.idInterno, '2');
    await confirmarIntentoAntiguo(sql, concesion.idInterno, '1');
    const trasConfirmaciones = await fotografiar(sql, concesion.idInterno);
    assert.equal(trasConfirmaciones.concesion.version, '3');
    assert.equal(trasConfirmaciones.concesion.valor, '192.0.2.103');
    assert.equal(trasConfirmaciones.concesion.intencionGobernante,
      trasConfirmaciones.intenciones[2].id);

    const repetidaAntigua = await aceptar(servicio, fixture, concesion, primeraSolicitud);
    assert.equal(repetidaAntigua.resultado, 'repetida');
    assert.equal(repetidaAntigua.terminal, 'sustituida',
      'el replay debe recuperar su intención causal aunque ya no gobierne');

    const generacionAntes = trasConfirmaciones.concesion.generacion;
    const versionModeloAntes = trasConfirmaciones.concesion.versionModelo;
    const convergente = await aceptar(
      servicio,
      fixture,
      concesion,
      solicitud('0', '192.0.2.103')
    );
    assert.equal(convergente.resultado, 'convergente');
    const final = await fotografiar(sql, concesion.idInterno);
    assert.equal(final.concesion.version, '3');
    assert.equal(final.concesion.generacion, generacionAntes);
    assert.equal(final.concesion.versionModelo, versionModeloAntes);

    console.log(
      '[dns-ddns] OK 5.28.4c: decisiones=agente-usuario-agente ' +
      'anteriores=sustituidas efectos_en_curso=conservados ' +
      'confirmacion_fuera_orden=no_gobierna replay=causal noop=sin_catalogo'
    );
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(base)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

function aceptar(servicio, fixture, concesion, peticion) {
  return servicio.aceptarIntencionExplicita({
    contextoSesionTecnica: { sesion: { agenteId: String(fixture.agente) } },
    concesionId: concesion.concesionId,
    solicitud: peticion
  });
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
      tipo: 'A', modo: 'declarada', valor: { direccionIpv4 }
    }
  };
}

async function ponerGobernanteEnProceso(sql, concesionId, instancia) {
  await sql.ejecutar(
    `UPDATE intentos_publicacion_ddns p
       JOIN concesiones_ddns_agentes c ON c.intencion_gobernante_id=p.intencion_interna_id
        SET p.estado='procesando',p.instancia_id=?,p.lease_token=?,
            p.lease_expira_utc=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 1 MINUTE),
            p.fencing_token=p.fencing_token+1
      WHERE c.id=? AND p.estado='pendiente'`,
    [instancia, randomBytes(32), concesionId]
  );
}

async function confirmarIntentoAntiguo(sql, concesionId, version) {
  await sql.ejecutar(
    `UPDATE intentos_publicacion_ddns
        SET estado='publicada',instancia_id=NULL,lease_token=NULL,
            lease_expira_utc=NULL,terminada_en_utc=UTC_TIMESTAMP(3)
      WHERE concesion_interna_id=? AND version_ddns=? AND estado='procesando'`,
    [concesionId, version]
  );
}

async function fotografiar(sql, concesionId) {
  const [concesion] = await sql.consultar(
    `SELECT CAST(c.version_ddns AS CHAR) version,c.intencion_gobernante_id,
            r.valor_principal,CAST(h.ultima_generacion_dns AS CHAR) generacion,
            CAST(z.version_modelo AS CHAR) version_modelo
       FROM concesiones_ddns_agentes c
       JOIN registros_dns r ON r.id=c.registro_dns_id
       JOIN zonas_dns z ON z.id=r.zona_id
       JOIN cabecera_generacion_dns h ON h.id=1 WHERE c.id=?`,
    [concesionId]
  );
  const intenciones = await sql.consultar(
    `SELECT CAST(id AS CHAR) id,CAST(version_ddns AS CHAR) version,origen,terminal
       FROM intenciones_ddns_agentes WHERE concesion_interna_id=? ORDER BY version_ddns`,
    [concesionId]
  );
  const intentos = await sql.consultar(
    `SELECT CAST(version_ddns AS CHAR) version,estado
       FROM intentos_publicacion_ddns WHERE concesion_interna_id=? ORDER BY version_ddns`,
    [concesionId]
  );
  return {
    concesion: {
      version: concesion.version,
      intencionGobernante: String(concesion.intencion_gobernante_id),
      valor: concesion.valor_principal,
      generacion: concesion.generacion,
      versionModelo: concesion.version_modelo
    },
    intenciones: intenciones.map((f) => ({
      id: f.id, version: f.version, origen: f.origen, terminal: f.terminal
    })),
    intentos: intentos.map((f) => ({ version: f.version, estado: f.estado }))
  };
}

function contextoUsuario(fixture) {
  return {
    idUsuario: fixture.usuario,
    idUsuarioReal: fixture.usuario,
    nivelScope: 'sitio',
    tenantId: fixture.tenant,
    empresaId: fixture.empresa,
    sitioId: fixture.sitio,
    permisos: { administrarDnsAvanzado: true }
  };
}

async function bloquearCatalogoEnTransaccion({ conexion }) {
  await conexion.execute('SELECT id FROM zonas_dns ORDER BY id FOR UPDATE');
  await conexion.execute('SELECT id FROM registros_dns ORDER BY zona_id,id FOR UPDATE');
}

async function crearFixture(sql) {
  const [tenant] = await sql.ejecutar(
    "INSERT INTO tenants (nombre,alias) VALUES ('Tenant 5.28.4c','tenant-5284c')"
  );
  const [empresa] = await sql.ejecutar(
    "INSERT INTO empresas (tenant_id,nombre,alias) VALUES (?,'Empresa 5.28.4c','empresa-5284c')",
    [tenant.insertId]
  );
  const [sitio] = await sql.ejecutar(
    "INSERT INTO sitios (tenant_id,empresa_id,nombre,alias) VALUES (?,?,'Sitio 5.28.4c','sitio-5284c')",
    [tenant.insertId, empresa.insertId]
  );
  const [usuario] = await sql.ejecutar(
    `INSERT INTO usuarios (
       usuario,email,hash_password,tenant_id,empresa_id,sitio_id,
       permiso_administrar_dns_avanzado
     ) VALUES ('usuario-5284c','usuario@example.test','hash',?,?,?,1)`,
    [tenant.insertId, empresa.insertId, sitio.insertId]
  );
  const [agente] = await sql.ejecutar(
    `INSERT INTO agentes_sentinelia (
       guid,tenant_id,empresa_id,sitio_id,nombre,secreto_hash
     ) VALUES (?,?,?,?,?,'hash')`,
    [generarUuidV7Auditoria(), tenant.insertId, empresa.insertId, sitio.insertId, 'Agente 5.28.4c']
  );
  const [zona] = await sql.ejecutar(
    `INSERT INTO zonas_dns (
       tenant_id,empresa_id,sitio_id,nombre_zona,soa_mname,soa_rname
     ) VALUES (?,?,?,?,?,?)`,
    [tenant.insertId, empresa.insertId, sitio.insertId,
      'ddns-5284c.example.', 'ns.example.', 'hostmaster.example.']
  );
  const [registro] = await sql.ejecutar(
    `INSERT INTO registros_dns (
       zona_id,tenant_id,empresa_id,sitio_id,host_relativo,tipo_registro,
       valor_principal,ttl_segundos,categoria_origen
     ) VALUES (?,?,?,?,'host','A','192.0.2.100',300,'ddns')`,
    [zona.insertId, tenant.insertId, empresa.insertId, sitio.insertId]
  );
  return {
    tenant: tenant.insertId, empresa: empresa.insertId, sitio: sitio.insertId,
    usuario: usuario.insertId, agente: agente.insertId, registro: registro.insertId
  };
}
