import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';

import { generarUuidV7Auditoria } from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import {
  compararDecimalesDdns,
  ErrorRepositorioCausalDdns,
  RepositorioCausalDdnsAgentes
} from '../paquetes/dns/src/RepositorioCausalDdnsAgentes.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones } from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

await main();

async function main() {
  verificarComparacionDecimal();

  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true, '5.28.1c necesita MariaDB real.');
  const administrador = new ClienteSql(configuracion.sql);
  const base = `sentinelia_fixture_5281c_${randomBytes(5).toString('hex')}`;
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
    const raiz = await crearRaiz(sql);
    const repositorio = new RepositorioCausalDdnsAgentes(sql);
    await verificarIdempotencia(sql, repositorio, raiz);
    await verificarBloqueosCausales(sql, repositorio, raiz);
    console.log(
      '[dns-ddns] OK 5.28.1c: esquema=inicial ' +
      'orden=concesion-registro-intencion fotografia=consistente ' +
      'idempotencia=agente-solicitud decimal=sin_number ' +
      'concurrencia=aceptacion-revocacion-edicion-observacion'
    );
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(base)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

function verificarComparacionDecimal() {
  assert.equal(compararDecimalesDdns('0', '0'), 0);
  assert.equal(compararDecimalesDdns('9007199254740992', '9007199254740993'), -1);
  assert.equal(
    compararDecimalesDdns('18446744073709551615', '9999999999999999999'),
    1
  );
  assert.throws(() => compararDecimalesDdns('01', '1'), TypeError);
}

async function verificarIdempotencia(sql, repositorio, raiz) {
  const fixture = await crearObjetivo(sql, raiz, 'idempotencia');
  const solicitudId = generarUuidV7Auditoria();
  const huella = sha256('solicitud-canonica');
  await repositorio.ejecutarConFotografiaBloqueada(
    {
      concesionId: fixture.concesionId,
      agenteId: raiz.agente,
      solicitudId
    },
    async ({ conexion, fotografia }) => {
      assert.equal(fotografia.solicitud, null);
      assert.equal(fotografia.concesion.version, '1');
      assert.equal(fotografia.registro.valorPrincipal, '192.0.2.1');
      assert.equal(fotografia.intencionGobernante.version, '1');
      const primera = await repositorio.registrarSolicitudEnTransaccion({
        solicitudId,
        agenteId: raiz.agente,
        concesionInternaId: fixture.concesionInternaId,
        cuerpoCanonicoSha256: huella,
        intencionInternaId: fixture.intencionInternaId,
        resultado: 'aceptada',
        estadoHttp: 202
      }, { conexion });
      assert.equal(primera.creada, true);
      const repetida = await repositorio.registrarSolicitudEnTransaccion({
        solicitudId,
        agenteId: raiz.agente,
        concesionInternaId: fixture.concesionInternaId,
        cuerpoCanonicoSha256: huella,
        intencionInternaId: fixture.intencionInternaId,
        resultado: 'aceptada',
        estadoHttp: 202
      }, { conexion });
      assert.equal(repetida.creada, false);
      assert.equal(repetida.solicitud.solicitudId, solicitudId);
      await assert.rejects(
        repositorio.registrarSolicitudEnTransaccion({
          solicitudId,
          agenteId: raiz.agente,
          concesionInternaId: fixture.concesionInternaId,
          cuerpoCanonicoSha256: sha256('otra-solicitud'),
          intencionInternaId: fixture.intencionInternaId,
          resultado: 'aceptada',
          estadoHttp: 202
        }, { conexion }),
        (error) => error instanceof ErrorRepositorioCausalDdns &&
          error.codigo === 'solicitud_reutilizada'
      );
    }
  );
}

async function verificarBloqueosCausales(sql, repositorio, raiz) {
  const revocacion = await crearObjetivo(sql, raiz, 'revocacion');
  await verificarMutacionBloqueada({
    sql,
    repositorio,
    fixture: revocacion,
    agenteId: raiz.agente,
    mutar: () => sql.ejecutar(
      `UPDATE concesiones_ddns_agentes
          SET estado='revocada',causa_cierre='revocada_desde_agente',
              cerrada_en_utc=UTC_TIMESTAMP(3)
        WHERE id=?`,
      [revocacion.concesionInternaId]
    )
  });

  const edicion = await crearObjetivo(sql, raiz, 'edicion');
  await verificarMutacionBloqueada({
    sql,
    repositorio,
    fixture: edicion,
    agenteId: raiz.agente,
    mutar: () => sql.ejecutar(
      "UPDATE registros_dns SET valor_principal='192.0.2.20' WHERE id=?",
      [edicion.registroId]
    )
  });

  const observacion = await crearObjetivo(sql, raiz, 'observacion');
  await verificarMutacionBloqueada({
    sql,
    repositorio,
    fixture: observacion,
    agenteId: raiz.agente,
    mutar: () => sql.ejecutar(
      "UPDATE registros_dns SET valor_principal='192.0.2.30' WHERE id=?",
      [observacion.registroId]
    )
  });
}

async function verificarMutacionBloqueada({
  repositorio,
  fixture,
  agenteId,
  mutar
}) {
  let mutacion;
  const fotografia = await repositorio.ejecutarConFotografiaBloqueada(
    { concesionId: fixture.concesionId, agenteId },
    async ({ fotografia: actual }) => {
      mutacion = mutar();
      const estado = await Promise.race([
        mutacion.then(() => 'completada'),
        new Promise((resolver) => setTimeout(() => resolver('bloqueada'), 120))
      ]);
      assert.equal(estado, 'bloqueada', 'La mutación concurrente eludió la fotografía causal.');
      return actual;
    }
  );
  assert.equal(fotografia.registro.valorPrincipal, '192.0.2.1');
  await mutacion;
}

async function crearRaiz(sql) {
  const [tenant] = await sql.ejecutar(
    "INSERT INTO tenants (nombre,alias) VALUES ('Tenant','tenant-5281c')"
  );
  const [empresa] = await sql.ejecutar(
    "INSERT INTO empresas (tenant_id,nombre,alias) VALUES (?,'Empresa','empresa-5281c')",
    [tenant.insertId]
  );
  const [sitio] = await sql.ejecutar(
    "INSERT INTO sitios (tenant_id,empresa_id,nombre,alias) VALUES (?,?,'Sitio','sitio-5281c')",
    [tenant.insertId, empresa.insertId]
  );
  const [zona] = await sql.ejecutar(
    `INSERT INTO zonas_dns (nombre_zona,soa_mname,soa_rname)
     VALUES ('fixture-5281c.example.','ns.example.','hostmaster.example.')`
  );
  const [agente] = await sql.ejecutar(
    `INSERT INTO agentes_sentinelia (
       guid,tenant_id,empresa_id,sitio_id,nombre,secreto_hash
     ) VALUES (?,?,?,?,?,'hash')`,
    [
      generarUuidV7Auditoria(), tenant.insertId, empresa.insertId,
      sitio.insertId, 'Agente 5281c'
    ]
  );
  return {
    tenant: tenant.insertId,
    empresa: empresa.insertId,
    sitio: sitio.insertId,
    zona: zona.insertId,
    agente: agente.insertId
  };
}

async function crearObjetivo(sql, raiz, sufijo) {
  const [registro] = await sql.ejecutar(
    `INSERT INTO registros_dns (
       zona_id,tenant_id,empresa_id,sitio_id,host_relativo,tipo_registro,
       valor_principal,categoria_origen
     ) VALUES (?,?,?,?,?,'A','192.0.2.1','ddns')`,
    [raiz.zona, raiz.tenant, raiz.empresa, raiz.sitio, sufijo]
  );
  const concesionId = generarUuidV7Auditoria();
  const [concesion] = await sql.ejecutar(
    `INSERT INTO concesiones_ddns_agentes (
       concesion_id,agente_id,registro_dns_id,agente_id_fotografia,
       registro_dns_id_fotografia,agente_scope_tenant_id,
       agente_scope_empresa_id,agente_scope_sitio_id,
       registro_scope_tenant_id,registro_scope_empresa_id,
       registro_scope_sitio_id
     ) VALUES (UNHEX(REPLACE(?, '-', '')),?,?,?,?,?,?,?,?,?,?)`,
    [
      concesionId, raiz.agente, registro.insertId, raiz.agente,
      registro.insertId, raiz.tenant, raiz.empresa, raiz.sitio,
      raiz.tenant, raiz.empresa, raiz.sitio
    ]
  );
  const intencionId = generarUuidV7Auditoria();
  const causaId = generarUuidV7Auditoria();
  const estado = '{"modo":"declarada","valor":{"direccionIpv4":"192.0.2.1"}}';
  const [intencion] = await sql.ejecutar(
    `INSERT INTO intenciones_ddns_agentes (
       intencion_id,concesion_interna_id,agente_id_fotografia,
       registro_dns_id_fotografia,origen,version_ddns,modo,
       estado_deseado_canonico,estado_deseado_sha256,causa_tipo,causa_id,
       hito,persistida_en_utc
     ) VALUES (UNHEX(REPLACE(?, '-', '')),?,?,?,'agente_explicita',1,
       'declarada',?,UNHEX(SHA2(?,256)),'solicitud_agente',
       UNHEX(REPLACE(?, '-', '')),'contenido_deseado_persistido',UTC_TIMESTAMP(3))`,
    [
      intencionId, concesion.insertId, raiz.agente, registro.insertId,
      estado, estado, causaId
    ]
  );
  await sql.ejecutar(
    `UPDATE concesiones_ddns_agentes
        SET version_ddns=1,decision='operativa',modo='declarada',
            intencion_gobernante_id=?,contenido_deseado_canonico=?,
            contenido_deseado_sha256=UNHEX(SHA2(?,256)),
            condicion_operativa='operativa'
      WHERE id=?`,
    [intencion.insertId, estado, estado, concesion.insertId]
  );
  return {
    concesionId,
    concesionInternaId: concesion.insertId,
    intencionInternaId: intencion.insertId,
    registroId: registro.insertId
  };
}

function sha256(texto) {
  return createHash('sha256').update(texto).digest();
}
