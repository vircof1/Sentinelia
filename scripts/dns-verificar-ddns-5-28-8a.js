import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import express from 'express';

import { ControladorApiAgentes }
  from '../apps/sentinelia-web/src/controladores/ControladorApiAgentes.js';
import { crearRutasApiAgentes }
  from '../apps/sentinelia-web/src/rutas/crearRutasApiAgentes.js';
import { generarUuidV7Auditoria } from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import { PERFILES_DDNS_AGENTES, VERSION_CONTRATO_DDNS_AGENTES }
  from '../paquetes/dns/src/ContratoDdnsAgentes.js';
import { RepositorioConcesionesDdnsAgentes }
  from '../paquetes/dns/src/RepositorioConcesionesDdnsAgentes.js';
import { RepositorioCoordinacionGeneracionesDns }
  from '../paquetes/dns/src/RepositorioCoordinacionGeneracionesDns.js';
import { ServicioAplicacionDdnsAgentes }
  from '../paquetes/dns/src/ServicioAplicacionDdnsAgentes.js';
import { ServicioConsultaDdnsAgentes }
  from '../paquetes/dns/src/ServicioConsultaDdnsAgentes.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones }
  from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import { obtenerConfiguracionAplicacion, obtenerRutaMigraciones }
  from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

await main();

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true, '5.28.8a necesita MariaDB real.');
  const administrador = new ClienteSql(configuracion.sql);
  const base = `sentinelia_fixture_5288a_${randomBytes(5).toString('hex')}`;
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
    await verificarConsulta(sql);
    console.log('[dns-ddns] OK 5.28.8a: GET=privado bearer=vigente paginacion=opaca-100-500 aislamiento=agente fotografia=actual diagnostico=saneado cache=no-store');
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(base)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

async function verificarConsulta(sql) {
  const fixture = await crearFixture(sql);
  const repositorio = new RepositorioConcesionesDdnsAgentes(sql);
  const aplicacion = new ServicioAplicacionDdnsAgentes({
    clienteSql: sql,
    repositorioUsuarios: { buscarPorIdEnTransaccion: async () => null },
    repositorioCoordinacionGeneracionesDns:
      new RepositorioCoordinacionGeneracionesDns({
        clienteSql: sql,
        bloquearCatalogoEnTransaccion
      })
  });
  const propias = [];
  for (const registro of fixture.registrosPropios) {
    propias.push(await repositorio.crearConcesion({
      concesionId: generarUuidV7Auditoria(),
      agenteId: fixture.agenteUno,
      registroDnsId: registro.id
    }));
  }
  const ajena = await repositorio.crearConcesion({
    concesionId: generarUuidV7Auditoria(),
    agenteId: fixture.agenteDos,
    registroDnsId: fixture.registroAjeno.id
  });

  await aceptar(aplicacion, fixture.agenteUno, propias[1], observada('0'));
  await aceptar(aplicacion, fixture.agenteUno, propias[2], declarada('0', '192.0.2.203'));
  await aceptar(aplicacion, fixture.agenteUno, propias[3], declarada('0', '192.0.2.204'));
  await marcarPublicada(sql, propias[2].idInterno);
  await marcarFallida(sql, propias[3].idInterno);

  const consulta = new ServicioConsultaDdnsAgentes({
    clienteSql: sql,
    secretoCursores: randomBytes(32)
  });
  const primera = await consulta.listar({ agenteId: fixture.agenteUno, limite: 2 });
  assert.equal(primera.concesiones.length, 2);
  assert.equal(primera.paginacion.limite, 2);
  assert.ok(primera.paginacion.siguienteCursor);
  const segunda = await consulta.listar({
    agenteId: fixture.agenteUno,
    limite: 2,
    cursor: primera.paginacion.siguienteCursor
  });
  assert.equal(segunda.concesiones.length, 2);
  assert.equal(segunda.paginacion.siguienteCursor, null);
  const ids = [...primera.concesiones, ...segunda.concesiones]
    .map((concesion) => concesion.concesionId);
  assert.equal(new Set(ids).size, 4);
  assert.ok(!ids.includes(ajena.concesionId));
  assert.deepEqual(
    (await consulta.listar({ agenteId: fixture.agenteDos })).concesiones
      .map((concesion) => concesion.concesionId),
    [ajena.concesionId]
  );
  assert.equal(
    (await consulta.listar({ agenteId: fixture.agenteUno, limite: 9999 }))
      .paginacion.limite,
    500
  );
  const texto = JSON.stringify([...primera.concesiones, ...segunda.concesiones]);
  for (const prohibido of [
    'tenantId', 'empresaId', 'sitioId', 'registroDnsId',
    'mensaje_diagnostico', 'detalle-interno-que-no-debe-salir'
  ]) assert.ok(!texto.includes(prohibido), `La proyección filtró ${prohibido}.`);
  assert.ok(texto.includes('publicacion_fallida'));
  assert.ok(texto.includes('esperando_observacion'));

  const servidor = await arrancarServidor(consulta, fixture);
  try {
    const sinBearer = await fetch(`${servidor.origen}/api/agentes/v1/ddns`);
    assert.equal(sinBearer.status, 401);
    assert.equal(sinBearer.headers.get('cache-control'), 'no-store');

    const respuesta = await fetch(
      `${servidor.origen}/api/agentes/v1/ddns?limit=2`,
      { headers: { authorization: 'Bearer token-uno' } }
    );
    assert.equal(respuesta.status, 200);
    assert.equal(respuesta.headers.get('cache-control'), 'no-store');
    const cuerpo = await respuesta.json();
    assert.equal(cuerpo.ok, true);
    assert.equal(cuerpo.concesiones.length, 2);
    const alterado = `${cuerpo.paginacion.siguienteCursor.slice(0, -1)}x`;
    const invalido = await fetch(
      `${servidor.origen}/api/agentes/v1/ddns?limit=2&cursor=${encodeURIComponent(alterado)}`,
      { headers: { authorization: 'Bearer token-uno' } }
    );
    assert.equal(invalido.status, 400);
    assert.equal((await invalido.json()).code, 'cursor_ddns_invalido');
  } finally {
    await servidor.cerrar();
  }
}

async function arrancarServidor(servicioConsultaDdnsAgentes, fixture) {
  const controlador = new ControladorApiAgentes({
    servicioAutenticacionAgentes: {
      async inspeccionarSesionViva(token) {
        if (!['token-uno', 'token-dos'].includes(token)) {
          throw Object.assign(new Error('Sesión no vigente.'), {
            statusCode: 401,
            codigo: 'sesion_no_vigente'
          });
        }
        return {
          sesion: {
            agenteId: token === 'token-uno' ? fixture.agenteUno : fixture.agenteDos
          }
        };
      }
    },
    servicioConsultaDdnsAgentes
  });
  const app = express();
  app.use(crearRutasApiAgentes({
    controladorApiAgentes: controlador,
    ddnsAgentesHabilitado: true
  }));
  const servidor = await new Promise((resolver) => {
    const instancia = app.listen(0, '127.0.0.1', () => resolver(instancia));
  });
  const direccion = servidor.address();
  return {
    origen: `http://127.0.0.1:${direccion.port}`,
    cerrar: () => new Promise((resolver, rechazar) =>
      servidor.close((error) => error ? rechazar(error) : resolver()))
  };
}

function aceptar(servicio, agenteId, concesion, solicitud) {
  return servicio.aceptarIntencionExplicita({
    contextoSesionTecnica: { sesion: { agenteId: String(agenteId) } },
    concesionId: concesion.concesionId,
    solicitud
  });
}

function observada(versionEsperada) {
  return solicitud('observada', null, versionEsperada);
}

function declarada(versionEsperada, direccionIpv4) {
  return solicitud('declarada', { direccionIpv4 }, versionEsperada);
}

function solicitud(modo, valor, versionEsperada) {
  return {
    perfil: PERFILES_DDNS_AGENTES.SOLICITUD,
    versionContrato: VERSION_CONTRATO_DDNS_AGENTES,
    solicitudId: generarUuidV7Auditoria(),
    versionEsperada,
    estadoDeseado: {
      perfil: PERFILES_DDNS_AGENTES.ESTADO_DESEADO,
      versionContrato: VERSION_CONTRATO_DDNS_AGENTES,
      tipo: 'A',
      modo,
      valor
    }
  };
}

async function marcarPublicada(sql, concesionId) {
  await sql.ejecutar(
    `UPDATE intenciones_ddns_agentes i
       JOIN concesiones_ddns_agentes c ON c.intencion_gobernante_id=i.id
        SET i.hito='contenido_publicado',i.publicada_en_utc=UTC_TIMESTAMP(3),
            i.terminal='publicada',i.terminada_en_utc=UTC_TIMESTAMP(3)
      WHERE c.id=?`,
    [concesionId]
  );
  await sql.ejecutar(
    `UPDATE concesiones_ddns_agentes c
       JOIN intenciones_ddns_agentes i ON i.id=c.intencion_gobernante_id
        SET c.contenido_publicado_canonico=c.contenido_deseado_canonico,
            c.contenido_publicado_sha256=c.contenido_deseado_sha256,
            c.generacion_dns_publicada=1
      WHERE c.id=?`,
    [concesionId]
  );
  await sql.ejecutar(
    `UPDATE intentos_publicacion_ddns p
       JOIN concesiones_ddns_agentes c ON c.intencion_gobernante_id=p.intencion_interna_id
        SET p.estado='publicada',p.terminada_en_utc=UTC_TIMESTAMP(3)
      WHERE c.id=?`,
    [concesionId]
  );
}

async function marcarFallida(sql, concesionId) {
  const [fila] = await sql.consultar(
    `SELECT c.intencion_gobernante_id,CAST(c.version_ddns AS CHAR) version_ddns,
            p.generacion_dns
       FROM concesiones_ddns_agentes c
       JOIN intentos_publicacion_ddns p ON p.intencion_interna_id=c.intencion_gobernante_id
      WHERE c.id=?`,
    [concesionId]
  );
  await sql.ejecutar(
    `UPDATE intentos_publicacion_ddns
        SET estado='rechazo_atribuible',atribucion='registro',
            codigo_diagnostico='zona_rechazada',
            mensaje_diagnostico='detalle-interno-que-no-debe-salir',
            terminada_en_utc=UTC_TIMESTAMP(3)
      WHERE intencion_interna_id=?`,
    [fila.intencion_gobernante_id]
  );
  for (const numero of [2, 3]) {
    await sql.ejecutar(
      `INSERT INTO intentos_publicacion_ddns (
         concesion_interna_id,intencion_interna_id,version_ddns,numero_intento,
         generacion_dns,estado,atribucion,disponible_en_utc,
         codigo_diagnostico,mensaje_diagnostico,terminada_en_utc
       ) VALUES (?,?,?,?,?,'rechazo_atribuible','registro',NULL,
                 'zona_rechazada','detalle-interno-que-no-debe-salir',UTC_TIMESTAMP(3))`,
      [concesionId, fila.intencion_gobernante_id, fila.version_ddns,
        numero, fila.generacion_dns]
    );
  }
  await sql.ejecutar(
    `UPDATE intenciones_ddns_agentes
        SET terminal='publicacion_fallida',terminada_en_utc=UTC_TIMESTAMP(3)
      WHERE id=?`,
    [fila.intencion_gobernante_id]
  );
  await sql.ejecutar(
    `UPDATE concesiones_ddns_agentes SET condicion_operativa='publicacion_fallida'
      WHERE id=?`,
    [concesionId]
  );
}

async function bloquearCatalogoEnTransaccion({ conexion }) {
  await conexion.execute('SELECT id FROM zonas_dns ORDER BY id FOR UPDATE');
  await conexion.execute('SELECT id FROM registros_dns ORDER BY zona_id,id FOR UPDATE');
}

async function crearFixture(sql) {
  const [tenant] = await sql.ejecutar(
    "INSERT INTO tenants (nombre,alias) VALUES ('Tenant 8a','tenant-5288a')"
  );
  const [empresa] = await sql.ejecutar(
    "INSERT INTO empresas (tenant_id,nombre,alias) VALUES (?,'Empresa 8a','empresa-5288a')",
    [tenant.insertId]
  );
  const [sitio] = await sql.ejecutar(
    "INSERT INTO sitios (tenant_id,empresa_id,nombre,alias) VALUES (?,?,'Sitio 8a','sitio-5288a')",
    [tenant.insertId, empresa.insertId]
  );
  const agentes = [];
  for (const nombre of ['Agente 8a uno', 'Agente 8a dos']) {
    const [agente] = await sql.ejecutar(
      `INSERT INTO agentes_sentinelia
         (guid,tenant_id,empresa_id,sitio_id,nombre,secreto_hash)
       VALUES (?,?,?,?,?,'hash')`,
      [generarUuidV7Auditoria(), tenant.insertId, empresa.insertId,
        sitio.insertId, nombre]
    );
    agentes.push(agente.insertId);
  }
  const [zona] = await sql.ejecutar(
    `INSERT INTO zonas_dns
       (tenant_id,empresa_id,sitio_id,nombre_zona,soa_mname,soa_rname)
     VALUES (?,?,?,?,?,?)`,
    [tenant.insertId, empresa.insertId, sitio.insertId,
      'estado.5288a.example.', 'ns.example.', 'hostmaster.example.']
  );
  const registros = [];
  for (let indice = 0; indice < 5; indice += 1) {
    const [registro] = await sql.ejecutar(
      `INSERT INTO registros_dns
         (zona_id,tenant_id,empresa_id,sitio_id,host_relativo,tipo_registro,
          valor_principal,ttl_segundos,categoria_origen)
       VALUES (?,?,?,?,?,'A',?,300,'ddns')`,
      [zona.insertId, tenant.insertId, empresa.insertId, sitio.insertId,
        `host-${indice}`, `192.0.2.${100 + indice}`]
    );
    registros.push({ id: registro.insertId });
  }
  return Object.freeze({
    agenteUno: agentes[0],
    agenteDos: agentes[1],
    registrosPropios: Object.freeze(registros.slice(0, 4)),
    registroAjeno: Object.freeze(registros[4])
  });
}
