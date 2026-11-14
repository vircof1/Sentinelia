import assert from 'node:assert/strict';
import http from 'node:http';
import { randomBytes } from 'node:crypto';

import express from 'express';

import { ControladorApiAgentes }
  from '../apps/sentinelia-web/src/controladores/ControladorApiAgentes.js';
import { crearRutasApiAgentes }
  from '../apps/sentinelia-web/src/rutas/crearRutasApiAgentes.js';
import { RepositorioAgentesSentinelia }
  from '../paquetes/agentes/src/RepositorioAgentesSentinelia.js';
import { RepositorioSesionesAgentesRedis }
  from '../paquetes/agentes/src/RepositorioSesionesAgentesRedis.js';
import { ServicioAutenticacionAgentes }
  from '../paquetes/agentes/src/ServicioAutenticacionAgentes.js';
import { SesionAgenteSentinelia }
  from '../paquetes/agentes/src/SesionAgenteSentinelia.js';
import { calcularHuellaSesionAgente }
  from '../paquetes/agentes/src/GeneradorSesionAgenteSentinelia.js';
import { generarUuidV7Auditoria }
  from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import { RepositorioConcesionesDdnsAgentes }
  from '../paquetes/dns/src/RepositorioConcesionesDdnsAgentes.js';
import { RepositorioCoordinacionGeneracionesDns }
  from '../paquetes/dns/src/RepositorioCoordinacionGeneracionesDns.js';
import { ServicioAplicacionDdnsAgentes }
  from '../paquetes/dns/src/ServicioAplicacionDdnsAgentes.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones }
  from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import { ServicioConexionRedis }
  from '../paquetes/sesiones/src/ServicioConexionRedis.js';
import { obtenerConfiguracionAplicacion, obtenerRutaMigraciones }
  from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

await main();

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true, '5.28.8b necesita MariaDB real.');
  assert.ok(configuracion.redis?.url, '5.28.8b necesita Redis real.');
  const administrador = new ClienteSql(configuracion.sql);
  const base = `sentinelia_fixture_5288b_${randomBytes(5).toString('hex')}`;
  const conexionRedis = new ServicioConexionRedis(configuracion.redis);
  let sql;
  let servidor;
  let sesiones;
  let agenteId;
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
    const redis = await conexionRedis.conectar();
    const fixture = await crearFixture(sql);
    agenteId = fixture.agenteUno;
    sesiones = new RepositorioSesionesAgentesRedis({
      clienteRedis: redis,
      prefijoSesionesAgentes: `sentinelia:test:5288b:${base}:`
    });
    const bearer = await crearBearerReal({ sesiones, fixture });
    servidor = await arrancarServidor({ sql, sesiones });

    await verificarContratoHttp({ servidor, bearer, fixture });
    await sesiones.invalidarSesionActualAgente(fixture.agenteUno);
    const revocada = await post(servidor.puerto, fixture.concesionPropia, bearer,
      solicitud(generarUuidV7Auditoria(), '1', '192.0.2.88'));
    assert.equal(revocada.statusCode, 403);
    assert.equal(revocada.json.code, 'sesion_no_vigente');
    assert.equal(revocada.headers['cache-control'], 'no-store');

    console.log('[dns-ddns] OK 5.28.8b: bearer=real-revocable autoridad=uniforme objetos=exactos idempotencia=durable convergencia=200 errores=404-409-422 saneados agente=no_elegible');
  } finally {
    await servidor?.cerrar().catch(() => {});
    if (sesiones && agenteId) {
      await sesiones.invalidarSesionActualAgente(agenteId).catch(() => {});
    }
    await conexionRedis.cerrar().catch(() => {});
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(base)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

async function verificarContratoHttp({ servidor, bearer, fixture }) {
  const sinBearer = await post(
    servidor.puerto,
    fixture.concesionPropia,
    null,
    solicitud(generarUuidV7Auditoria(), '0', '192.0.2.80')
  );
  assert.equal(sinBearer.statusCode, 401);
  assert.equal(sinBearer.json.code, 'bearer_requerido');

  const id = generarUuidV7Auditoria();
  const aceptada = await post(servidor.puerto, fixture.concesionPropia, bearer,
    solicitud(id, '0', '192.0.2.81'));
  assert.equal(aceptada.statusCode, 202);
  assert.equal(aceptada.json.ok, true);
  assert.equal(aceptada.json.resultado, 'aceptada');
  assert.deepEqual(aceptada.json.estadoDeseado, {
    tipo: 'A', modo: 'declarada', valor: { direccionIpv4: '192.0.2.81' }
  });
  assert.equal(aceptada.headers['cache-control'], 'no-store');

  const repetida = await post(servidor.puerto, fixture.concesionPropia, bearer,
    solicitud(id, '0', '192.0.2.81'));
  assert.equal(repetida.statusCode, 200);
  assert.equal(repetida.json.resultado, 'repetida');

  const convergente = await post(servidor.puerto, fixture.concesionPropia, bearer,
    solicitud(generarUuidV7Auditoria(), '0', '192.0.2.81'));
  assert.equal(convergente.statusCode, 200);
  assert.equal(convergente.json.resultado, 'convergente');

  const obsoleta = await post(servidor.puerto, fixture.concesionPropia, bearer,
    solicitud(generarUuidV7Auditoria(), '0', '192.0.2.82'));
  assert.equal(obsoleta.statusCode, 409);
  assert.deepEqual(claves(obsoleta.json),
    ['code', 'currentVersion', 'message', 'ok', 'requestId']);
  assert.equal(obsoleta.json.code, 'version_obsoleta');
  assert.equal(obsoleta.json.currentVersion, '1');

  const conflictiva = await post(servidor.puerto, fixture.concesionPropia, bearer,
    solicitud(id, '1', '192.0.2.83'));
  assert.equal(conflictiva.statusCode, 409);
  assert.equal(conflictiva.json.code, 'idempotencia_conflictiva');
  assert.equal(Object.hasOwn(conflictiva.json, 'currentVersion'), false);

  for (const concesionId of [fixture.concesionAjena, generarUuidV7Auditoria()]) {
    const respuesta = await post(servidor.puerto, concesionId, bearer,
      solicitud(generarUuidV7Auditoria(), '0', '192.0.2.84'));
    assert.equal(respuesta.statusCode, 404);
    assert.equal(respuesta.json.code, 'sin_autoridad');
    assert.deepEqual(claves(respuesta.json), ['code', 'message', 'ok', 'requestId']);
  }
  const identidadMalformada = await post(servidor.puerto, 'no-es-uuid', bearer,
    solicitud(generarUuidV7Auditoria(), '0', '192.0.2.84'));
  assert.equal(identidadMalformada.statusCode, 404);
  assert.equal(identidadMalformada.json.code, 'sin_autoridad');

  const invalidas = [
    { ...solicitud(generarUuidV7Auditoria(), '1', '192.0.2.85'), agenteId: 1 },
    { ...solicitud(generarUuidV7Auditoria(), '1', '192.0.2.85'), extra: true },
    solicitud(generarUuidV7Auditoria(), '1', 'no-es-ip'),
    {
      solicitudId: generarUuidV7Auditoria(), versionEsperada: '1',
      estadoDeseado: { modo: 'observada', valor: null }
    }
  ];
  for (const cuerpo of invalidas) {
    const respuesta = await post(
      servidor.puerto, fixture.concesionPropia, bearer, cuerpo
    );
    assert.equal(respuesta.statusCode, 422);
    assert.equal(respuesta.json.code, 'valor_no_interpretable');
    assert.deepEqual(claves(respuesta.json), ['code', 'message', 'ok', 'requestId']);
  }

  const observada = await post(servidor.puerto, fixture.concesionPropia, bearer, {
    solicitudId: generarUuidV7Auditoria(), versionEsperada: '1',
    estadoDeseado: { modo: 'observada' }
  });
  assert.equal(observada.statusCode, 202);
  assert.deepEqual(observada.json.estadoDeseado,
    { tipo: 'A', modo: 'observada', valor: null });
}

async function arrancarServidor({ sql, sesiones }) {
  const repositorioAgentes = new RepositorioAgentesSentinelia(sql);
  const autenticacion = new ServicioAutenticacionAgentes({
    repositorioAgentes,
    repositorioSesionesAgentesRedis: sesiones,
    configuracionAgentes: {
      sessionTtlSegundos: 900,
      loginFallosMaximos: 5,
      cuarentenaSegundos: 60
    }
  });
  const aplicacionDdns = new ServicioAplicacionDdnsAgentes({
    clienteSql: sql,
    repositorioUsuarios: { buscarPorIdEnTransaccion: async () => null },
    repositorioCoordinacionGeneracionesDns:
      new RepositorioCoordinacionGeneracionesDns({
        clienteSql: sql,
        bloquearCatalogoEnTransaccion
      })
  });
  const app = express();
  app.use(express.json());
  app.use(crearRutasApiAgentes({
    ddnsAgentesHabilitado: true,
    controladorApiAgentes: new ControladorApiAgentes({
      servicioAutenticacionAgentes: autenticacion,
      servicioAplicacionDdnsAgentes: aplicacionDdns
    })
  }));
  const servidor = http.createServer(app);
  await new Promise((resolve) => servidor.listen(0, '127.0.0.1', resolve));
  return Object.freeze({
    puerto: servidor.address().port,
    cerrar: () => new Promise((resolve, reject) =>
      servidor.close((error) => error ? reject(error) : resolve()))
  });
}

async function crearBearerReal({ sesiones, fixture }) {
  const token = randomBytes(32).toString('base64url');
  const sesion = new SesionAgenteSentinelia({
    agenteId: fixture.agenteUno,
    guid: fixture.guidUno,
    tenantId: fixture.tenantId,
    empresaId: fixture.empresaId,
    sitioId: fixture.sitioId,
    sessionId: generarUuidV7Auditoria(),
    sessionTokenHash: calcularHuellaSesionAgente(token),
    versionSecreto: 1,
    ttlSegundos: 900
  });
  await sesiones.reemplazarSesionActual({ sesion, ttlSegundos: 900 });
  return token;
}

async function crearFixture(sql) {
  const [tenant] = await sql.ejecutar(
    "INSERT INTO tenants (nombre,alias) VALUES ('Tenant 8b','tenant-5288b')"
  );
  const [empresa] = await sql.ejecutar(
    "INSERT INTO empresas (tenant_id,nombre,alias) VALUES (?,'Empresa 8b','empresa-5288b')",
    [tenant.insertId]
  );
  const [sitio] = await sql.ejecutar(
    "INSERT INTO sitios (tenant_id,empresa_id,nombre,alias) VALUES (?,?,'Sitio 8b','sitio-5288b')",
    [tenant.insertId, empresa.insertId]
  );
  const agentes = [];
  for (const nombre of ['Agente 8b uno', 'Agente 8b dos']) {
    const guid = generarUuidV7Auditoria();
    const [agente] = await sql.ejecutar(
      `INSERT INTO agentes_sentinelia
         (guid,tenant_id,empresa_id,sitio_id,nombre,secreto_hash)
       VALUES (?,?,?,?,?,'hash')`,
      [guid, tenant.insertId, empresa.insertId, sitio.insertId, nombre]
    );
    agentes.push({ id: agente.insertId, guid });
  }
  const [zona] = await sql.ejecutar(
    `INSERT INTO zonas_dns
       (tenant_id,empresa_id,sitio_id,nombre_zona,soa_mname,soa_rname)
     VALUES (?,?,?,?,?,?)`,
    [tenant.insertId, empresa.insertId, sitio.insertId,
      'api.5288b.example.', 'ns.example.', 'hostmaster.example.']
  );
  const registros = [];
  for (let indice = 0; indice < 2; indice += 1) {
    const [registro] = await sql.ejecutar(
      `INSERT INTO registros_dns
         (zona_id,tenant_id,empresa_id,sitio_id,host_relativo,tipo_registro,
          valor_principal,ttl_segundos,categoria_origen)
       VALUES (?,?,?,?,?,'A',?,300,'ddns')`,
      [zona.insertId, tenant.insertId, empresa.insertId, sitio.insertId,
        `host-${indice}`, `192.0.2.${70 + indice}`]
    );
    registros.push(registro.insertId);
  }
  const repositorio = new RepositorioConcesionesDdnsAgentes(sql);
  const propia = await repositorio.crearConcesion({
    concesionId: generarUuidV7Auditoria(),
    agenteId: agentes[0].id,
    registroDnsId: registros[0]
  });
  const ajena = await repositorio.crearConcesion({
    concesionId: generarUuidV7Auditoria(),
    agenteId: agentes[1].id,
    registroDnsId: registros[1]
  });
  return Object.freeze({
    tenantId: tenant.insertId,
    empresaId: empresa.insertId,
    sitioId: sitio.insertId,
    agenteUno: agentes[0].id,
    guidUno: agentes[0].guid,
    concesionPropia: propia.concesionId,
    concesionAjena: ajena.concesionId
  });
}

function solicitud(solicitudId, versionEsperada, direccionIpv4) {
  return {
    solicitudId,
    versionEsperada,
    estadoDeseado: {
      modo: 'declarada',
      valor: { direccionIpv4 }
    }
  };
}

async function post(puerto, concesionId, bearer, cuerpo) {
  const contenido = JSON.stringify(cuerpo);
  return new Promise((resolve, reject) => {
    const peticion = http.request({
      hostname: '127.0.0.1', port: puerto, method: 'POST',
      path: `/api/agentes/v1/ddns/${concesionId}/intenciones`,
      headers: {
        ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(contenido)
      }
    }, (respuesta) => {
      const fragmentos = [];
      respuesta.on('data', (fragmento) => fragmentos.push(fragmento));
      respuesta.on('end', () => {
        try {
          resolve({
            statusCode: respuesta.statusCode,
            headers: respuesta.headers,
            json: JSON.parse(Buffer.concat(fragmentos).toString('utf8'))
          });
        } catch (error) { reject(error); }
      });
    });
    peticion.on('error', reject);
    peticion.end(contenido);
  });
}

async function bloquearCatalogoEnTransaccion({ conexion }) {
  await conexion.execute('SELECT id FROM zonas_dns ORDER BY id FOR UPDATE');
  await conexion.execute('SELECT id FROM registros_dns ORDER BY zona_id,id FOR UPDATE');
}

function claves(objeto) {
  return Object.keys(objeto).sort();
}
