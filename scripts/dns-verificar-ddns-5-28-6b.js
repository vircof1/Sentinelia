import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { generarUuidV7Auditoria } from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import { ConsolidadorPublicacionDdnsSql }
  from '../paquetes/dns/src/ConsolidadorPublicacionDdnsSql.js';
import { PERFILES_DDNS_AGENTES, VERSION_CONTRATO_DDNS_AGENTES }
  from '../paquetes/dns/src/ContratoDdnsAgentes.js';
import { RepositorioConcesionesDdnsAgentes }
  from '../paquetes/dns/src/RepositorioConcesionesDdnsAgentes.js';
import { RepositorioCoordinacionGeneracionesDns }
  from '../paquetes/dns/src/RepositorioCoordinacionGeneracionesDns.js';
import { ServicioAplicacionDdnsAgentes }
  from '../paquetes/dns/src/ServicioAplicacionDdnsAgentes.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones } from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import { RepositorioUsuarios } from '../paquetes/usuarios/src/RepositorioUsuarios.js';
import { obtenerConfiguracionAplicacion, obtenerRutaMigraciones }
  from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

await main();

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true, '5.28.6b necesita MariaDB real.');
  const administrador = new ClienteSql(configuracion.sql);
  const base = `sentinelia_fixture_5286b_${randomBytes(5).toString('hex')}`;
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
    await verificarConsolidacion(sql);
    console.log('[dns-ddns] OK 5.28.6b: vigente=publicada sustituida=efecto_conservado gobernante=no_retrocede revocada=historica mixta=aislada sql=atomico');
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(base)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

async function verificarConsolidacion(sql) {
  const fixture = await crearFixture(sql);
  const concesiones = new RepositorioConcesionesDdnsAgentes(sql);
  const concesion = await concesiones.crearConcesion({
    concesionId: generarUuidV7Auditoria(),
    agenteId: fixture.agenteId,
    registroDnsId: fixture.registroId
  });
  const coordinacion = new RepositorioCoordinacionGeneracionesDns({
    clienteSql: sql,
    bloquearCatalogoEnTransaccion
  });
  const servicio = new ServicioAplicacionDdnsAgentes({
    clienteSql: sql,
    repositorioUsuarios: new RepositorioUsuarios(sql),
    repositorioCoordinacionGeneracionesDns: coordinacion
  });
  await servicio.aceptarIntencionExplicita({
    contextoSesionTecnica: { sesion: { agenteId: String(fixture.agenteId) } },
    concesionId: concesion.concesionId,
    solicitud: solicitud('0', '192.0.2.61')
  });
  await servicio.aceptarIntencionExplicita({
    contextoSesionTecnica: { sesion: { agenteId: String(fixture.agenteId) } },
    concesionId: concesion.concesionId,
    solicitud: solicitud('1', '192.0.2.62')
  });
  const consolidador = new ConsolidadorPublicacionDdnsSql();
  await transaccion(sql, (conexion) => consolidador.consolidarEnTransaccion({
    conexion,
    generacionDns: '41',
    diagnostico: diagnostico(concesion, fixture, '1')
  }));
  let estado = await fotografiar(sql, concesion.idInterno);
  assert.deepEqual(
    [estado.version_ddns, estado.generacion_dns_publicada, estado.valor_publicado],
    ['2', '41', '192.0.2.61']
  );
  assert.deepEqual(
    [estado.hito_v1, estado.terminal_v1, estado.intento_v1,
      estado.hito_v2, estado.terminal_v2],
    ['contenido_publicado', 'sustituida', 'publicada',
      'contenido_deseado_persistido', null]
  );

  await transaccion(sql, (conexion) => consolidador.consolidarEnTransaccion({
    conexion,
    generacionDns: '42',
    diagnostico: diagnostico(concesion, fixture, '2', true)
  }));
  estado = await fotografiar(sql, concesion.idInterno);
  assert.deepEqual(
    [estado.version_ddns, estado.generacion_dns_publicada, estado.valor_publicado,
      estado.terminal_v2, estado.intento_v2],
    ['2', '42', '192.0.2.62', 'publicada', 'publicada']
  );

  await concesiones.cerrarConcesion({
    concesionId: concesion.concesionId,
    causa: 'revocada_desde_registro'
  });
  await transaccion(sql, (conexion) => consolidador.consolidarEnTransaccion({
    conexion,
    generacionDns: '43',
    diagnostico: diagnostico(concesion, fixture, '2')
  }));
  estado = await fotografiar(sql, concesion.idInterno);
  assert.deepEqual(
    [estado.estado, estado.generacion_dns_publicada, estado.terminal_v2],
    ['revocada', '43', 'publicada']
  );
}

function diagnostico(concesion, fixture, versionDdns, incluirNormal = false) {
  return {
    perfil: 'sentinelia-bind-diagnostico-v1',
    entradas: [
      {
        zonaDnsId: String(fixture.zonaId), rutaZona: 'zonas/zona', linea: 14,
        registroDnsId: String(fixture.registroId),
        concesionId: concesion.concesionId, versionDdns
      },
      ...(incluirNormal ? [{
        zonaDnsId: String(fixture.zonaId), rutaZona: 'zonas/zona', linea: 15,
        registroDnsId: String(fixture.registroNormalId),
        concesionId: null, versionDdns: null
      }] : [])
    ]
  };
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

async function fotografiar(sql, concesionId) {
  const [fila] = await sql.consultar(
    `SELECT c.estado,CAST(c.version_ddns AS CHAR) version_ddns,
            CAST(c.generacion_dns_publicada AS CHAR) generacion_dns_publicada,
            JSON_UNQUOTE(JSON_EXTRACT(c.contenido_publicado_canonico,
              '$.valor.direccionIpv4')) valor_publicado,
            MAX(CASE WHEN i.version_ddns=1 THEN i.hito END) hito_v1,
            MAX(CASE WHEN i.version_ddns=1 THEN i.terminal END) terminal_v1,
            MAX(CASE WHEN i.version_ddns=2 THEN i.hito END) hito_v2,
            MAX(CASE WHEN i.version_ddns=2 THEN i.terminal END) terminal_v2,
            (SELECT estado FROM intentos_publicacion_ddns p
              WHERE p.concesion_interna_id=c.id AND p.version_ddns=1
              ORDER BY p.numero_intento DESC LIMIT 1) intento_v1,
            (SELECT estado FROM intentos_publicacion_ddns p
              WHERE p.concesion_interna_id=c.id AND p.version_ddns=2
              ORDER BY p.numero_intento DESC LIMIT 1) intento_v2
       FROM concesiones_ddns_agentes c
       JOIN intenciones_ddns_agentes i ON i.concesion_interna_id=c.id
      WHERE c.id=? GROUP BY c.id`,
    [concesionId]
  );
  return fila;
}

async function transaccion(sql, trabajo) {
  const conexion = await sql.obtenerConexion();
  try {
    await conexion.beginTransaction();
    const resultado = await trabajo(conexion);
    await conexion.commit();
    return resultado;
  } catch (error) {
    await conexion.rollback();
    throw error;
  } finally {
    conexion.release();
  }
}

async function crearFixture(sql) {
  const [tenant] = await sql.ejecutar(
    "INSERT INTO tenants (nombre,alias) VALUES ('Tenant 5.28.6b','tenant-5286b')"
  );
  const [empresa] = await sql.ejecutar(
    "INSERT INTO empresas (tenant_id,nombre,alias) VALUES (?,'Empresa 5.28.6b','empresa-5286b')",
    [tenant.insertId]
  );
  const [sitio] = await sql.ejecutar(
    "INSERT INTO sitios (tenant_id,empresa_id,nombre,alias) VALUES (?,?,'Sitio 5.28.6b','sitio-5286b')",
    [tenant.insertId, empresa.insertId]
  );
  const [agente] = await sql.ejecutar(
    `INSERT INTO agentes_sentinelia
       (guid,tenant_id,empresa_id,sitio_id,nombre,secreto_hash)
     VALUES (?,?,?,?,?,'hash')`,
    [generarUuidV7Auditoria(), tenant.insertId, empresa.insertId,
      sitio.insertId, 'Agente 5.28.6b']
  );
  const [zona] = await sql.ejecutar(
    `INSERT INTO zonas_dns
       (tenant_id,empresa_id,sitio_id,nombre_zona,soa_mname,soa_rname)
     VALUES (?,?,?,?,?,?)`,
    [tenant.insertId, empresa.insertId, sitio.insertId,
      'ddns-5286b.example.', 'ns.example.', 'hostmaster.example.']
  );
  const crearRegistro = (host, categoria) => sql.ejecutar(
    `INSERT INTO registros_dns
       (zona_id,tenant_id,empresa_id,sitio_id,host_relativo,tipo_registro,
        valor_principal,ttl_segundos,categoria_origen)
     VALUES (?,?,?,?,?,'A','192.0.2.60',300,?)`,
    [zona.insertId, tenant.insertId, empresa.insertId, sitio.insertId, host, categoria]
  );
  const [registro] = await crearRegistro('ddns', 'ddns');
  const [normal] = await crearRegistro('normal', 'normal');
  return {
    agenteId: agente.insertId,
    zonaId: zona.insertId,
    registroId: registro.insertId,
    registroNormalId: normal.insertId
  };
}

async function bloquearCatalogoEnTransaccion({ conexion }) {
  await conexion.execute('SELECT id FROM zonas_dns ORDER BY id FOR UPDATE');
  await conexion.execute('SELECT id FROM registros_dns ORDER BY zona_id,id FOR UPDATE');
}
