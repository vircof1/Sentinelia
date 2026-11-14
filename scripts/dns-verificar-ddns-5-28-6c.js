import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import { generarUuidV7Auditoria }
  from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import { ErrorComandoBindDns }
  from '../paquetes/dns/src/AdaptadoresProcesoBindDns.js';
import { ErrorActivacionArtefactosBind }
  from '../paquetes/dns/src/ActivadorArtefactosBindDns.js';
import { RepositorioConcesionesDdnsAgentes }
  from '../paquetes/dns/src/RepositorioConcesionesDdnsAgentes.js';
import { RepositorioCoordinacionGeneracionesDns }
  from '../paquetes/dns/src/RepositorioCoordinacionGeneracionesDns.js';
import { ServicioAplicacionDdnsAgentes }
  from '../paquetes/dns/src/ServicioAplicacionDdnsAgentes.js';
import { ServicioRechazosAtribuiblesDdns }
  from '../paquetes/dns/src/ServicioRechazosAtribuiblesDdns.js';
import { RechazoZonaCandidataBindDns }
  from '../paquetes/dns/src/ValidadorCandidataBindDns.js';
import { PERFILES_DDNS_AGENTES, VERSION_CONTRATO_DDNS_AGENTES }
  from '../paquetes/dns/src/ContratoDdnsAgentes.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones } from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import { RepositorioUsuarios } from '../paquetes/usuarios/src/RepositorioUsuarios.js';
import { obtenerConfiguracionAplicacion, obtenerRutaMigraciones }
  from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

await main();

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true, '5.28.6c necesita MariaDB real.');
  const administrador = new ClienteSql(configuracion.sql);
  const base = `sentinelia_fixture_5286c_${randomBytes(5).toString('hex')}`;
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
    await verificarPresupuesto(sql);
    console.log('[dns-ddns] OK 5.28.6c: atribucion=inequivoca intentos=3 demoras=5,30 agotamiento=terminal replay=no_reactiva sucesor=contenido_distinto concurrencia=sin_cuarto');
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(base)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

async function verificarPresupuesto(sql) {
  const fixture = await crearFixture(sql);
  const coordinacion = new RepositorioCoordinacionGeneracionesDns({
    clienteSql: sql,
    bloquearCatalogoEnTransaccion
  });
  const concesion = await new RepositorioConcesionesDdnsAgentes(sql).crearConcesion({
    concesionId: generarUuidV7Auditoria(),
    agenteId: fixture.agenteId,
    registroDnsId: fixture.registroId
  });
  const servicio = new ServicioAplicacionDdnsAgentes({
    clienteSql: sql,
    repositorioUsuarios: new RepositorioUsuarios(sql),
    repositorioCoordinacionGeneracionesDns: coordinacion
  });
  const primera = await servicio.aceptarIntencionExplicita({
    contextoSesionTecnica: { sesion: { agenteId: String(fixture.agenteId) } },
    concesionId: concesion.concesionId,
    solicitud: solicitud('0', '192.0.2.201')
  });
  assert.equal(primera.resultado, 'aceptada');

  let generacion = await generacionIntento(sql, concesion.idInterno, 1);
  let reclamacion = await reclamarEIniciar(coordinacion, generacion, 'runtime-a');
  const entrada = diagnostico(concesion, fixture, '1');
  const atribuidor = new ServicioRechazosAtribuiblesDdns({
    repositorioCoordinacion: coordinacion
  });
  const [resultadoA, resultadoConcurrente] = await Promise.all([
    rechazar(atribuidor, reclamacion, entrada),
    rechazar(atribuidor, reclamacion, entrada)
  ]);
  const primero = [resultadoA, resultadoConcurrente].find((r) => r.atribuido);
  const perdedor = [resultadoA, resultadoConcurrente].find((r) => !r.atribuido);
  assert.deepEqual(
    [primero.numeroIntento, primero.siguienteIntento, primero.demoraSegundos],
    [1, 2, 5]
  );
  assert.equal(perdedor.motivo, 'lease_sin_autoridad');
  assert.equal(await demoraPersistida(sql, concesion.idInterno, 2), 5);

  await hacerElegible(sql, primero.operacion.generacionDns);
  generacion = primero.operacion.generacionDns;
  reclamacion = await reclamarEIniciar(coordinacion, generacion, 'runtime-b');
  const segundo = await rechazar(atribuidor, reclamacion, entrada);
  assert.deepEqual(
    [segundo.numeroIntento, segundo.siguienteIntento, segundo.demoraSegundos],
    [2, 3, 30]
  );
  assert.equal(await demoraPersistida(sql, concesion.idInterno, 3), 30);

  await hacerElegible(sql, segundo.operacion.generacionDns);
  generacion = segundo.operacion.generacionDns;
  reclamacion = await reclamarEIniciar(coordinacion, generacion, 'runtime-c');
  const tercero = await rechazar(atribuidor, reclamacion, entrada);
  assert.deepEqual(
    [tercero.numeroIntento, tercero.siguienteIntento, tercero.agotado],
    [3, null, true]
  );

  const intentos = await sql.consultar(
    `SELECT numero_intento,estado,atribucion,
            codigo_diagnostico,terminada_en_utc
       FROM intentos_publicacion_ddns
      WHERE concesion_interna_id=? ORDER BY numero_intento`,
    [concesion.idInterno]
  );
  assert.equal(intentos.length, 3);
  assert.ok(intentos.every((fila) =>
    fila.estado === 'rechazo_atribuible' && fila.atribucion === 'registro' &&
    fila.codigo_diagnostico === 'bind_zona_rechazo_atribuible' &&
    fila.terminada_en_utc
  ));
  const [agotada] = await sql.consultar(
    `SELECT c.condicion_operativa,i.terminal,o.estado
       FROM concesiones_ddns_agentes c
       JOIN intenciones_ddns_agentes i ON i.id=c.intencion_gobernante_id
       JOIN operaciones_publicacion_dns o ON o.generacion_dns=?
      WHERE c.id=?`,
    [generacion, concesion.idInterno]
  );
  assert.deepEqual(
    [agotada.condicion_operativa, agotada.terminal, agotada.estado],
    ['publicacion_fallida', 'publicacion_fallida', 'recuperacion_bloqueada']
  );

  const replay = await servicio.aceptarIntencionExplicita({
    contextoSesionTecnica: { sesion: { agenteId: String(fixture.agenteId) } },
    concesionId: concesion.concesionId,
    solicitud: solicitud('1', '192.0.2.201')
  });
  assert.deepEqual([replay.resultado, replay.version, replay.terminal],
    ['sin_cambios', '1', 'publicacion_fallida']);
  const sucesora = await servicio.aceptarIntencionExplicita({
    contextoSesionTecnica: { sesion: { agenteId: String(fixture.agenteId) } },
    concesionId: concesion.concesionId,
    solicitud: solicitud('1', '192.0.2.202')
  });
  assert.deepEqual([sucesora.resultado, sucesora.version], ['aceptada', '2']);
  const [conteo] = await sql.consultar(
    'SELECT COUNT(*) total,MAX(numero_intento) maximo FROM intentos_publicacion_ddns WHERE concesion_interna_id=? AND version_ddns=1',
    [concesion.idInterno]
  );
  assert.deepEqual([Number(conteo.total), Number(conteo.maximo)], [3, 3]);
}

async function reclamarEIniciar(coordinacion, generacion, instanciaId) {
  const leaseToken = randomBytes(32);
  const operacion = await coordinacion.reclamarSiguienteConLease({
    instanciaId,
    leaseToken,
    ttlSegundos: 30
  });
  assert.equal(operacion.generacionDns, generacion);
  const lease = {
    generacionDns: generacion,
    instanciaId,
    leaseToken,
    fencingToken: operacion.fencingToken
  };
  const iniciada = await coordinacion.iniciarEfectoConLease(lease, {
    generacionLeida: generacion,
    perfilProyeccion: 'sentinelia-bind-proyeccion-v1',
    hashProyeccion: randomBytes(32)
  });
  assert.equal(iniciada.estado, 'efecto_iniciado');
  return { lease, operacion: iniciada };
}

function rechazar(atribuidor, reclamacion, entrada) {
  const rutaAbsoluta = '/tmp/staging/zonas/ddns.example.zone';
  const causaComando = new ErrorComandoBindDns({
    ejecutable: 'named-checkzone',
    argumentos: ['ddns-5286c.example', rutaAbsoluta],
    causa: {
      code: 1,
      stderr: `${rutaAbsoluta}:14: CNAME and other data`
    }
  });
  const rechazoZona = new RechazoZonaCandidataBindDns({
    nombreZona: 'ddns-5286c.example',
    rutaZona: entrada.rutaZona,
    rutaAbsoluta,
    causa: causaComando
  });
  return atribuidor.resolver({
    lease: reclamacion.lease,
    operacion: reclamacion.operacion,
    fotografia: {
      proyeccion: {
        manifiesto: {
          diagnostico: {
            perfil: 'sentinelia-bind-diagnostico-v1',
            entradas: [entrada]
          }
        }
      }
    },
    error: new ErrorActivacionArtefactosBind(rechazoZona, {
      selectorReemplazado: false
    })
  });
}

function diagnostico(concesion, fixture, versionDdns) {
  return {
    zonaDnsId: String(fixture.zonaId),
    rutaZona: 'zonas/ddns.example.zone',
    linea: 14,
    registroDnsId: String(fixture.registroId),
    concesionId: concesion.concesionId,
    versionDdns
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

async function generacionIntento(sql, concesionId, numero) {
  const [fila] = await sql.consultar(
    `SELECT CAST(generacion_dns AS CHAR) generacion_dns
       FROM intentos_publicacion_ddns
      WHERE concesion_interna_id=? AND numero_intento=?`,
    [concesionId, numero]
  );
  return fila.generacion_dns;
}

async function demoraPersistida(sql, concesionId, numero) {
  const [fila] = await sql.consultar(
    `SELECT TIMESTAMPDIFF(SECOND,creada_en_utc,disponible_en_utc) demora
       FROM intentos_publicacion_ddns
      WHERE concesion_interna_id=? AND numero_intento=?`,
    [concesionId, numero]
  );
  return Number(fila.demora);
}

async function hacerElegible(sql, generacion) {
  await sql.ejecutar(
    `UPDATE operaciones_publicacion_dns
        SET proximo_intento_utc=UTC_TIMESTAMP(3)
      WHERE generacion_dns=?`,
    [generacion]
  );
  await sql.ejecutar(
    `UPDATE intentos_publicacion_ddns
        SET disponible_en_utc=UTC_TIMESTAMP(3)
      WHERE generacion_dns=? AND estado='pendiente'`,
    [generacion]
  );
}

async function bloquearCatalogoEnTransaccion({ conexion }) {
  await conexion.execute('SELECT id FROM zonas_dns ORDER BY id FOR UPDATE');
  await conexion.execute('SELECT id FROM registros_dns ORDER BY zona_id,id FOR UPDATE');
}

async function crearFixture(sql) {
  const [tenant] = await sql.ejecutar(
    "INSERT INTO tenants (nombre,alias) VALUES ('Tenant 5.28.6c','tenant-5286c')"
  );
  const [empresa] = await sql.ejecutar(
    "INSERT INTO empresas (tenant_id,nombre,alias) VALUES (?,'Empresa 5.28.6c','empresa-5286c')",
    [tenant.insertId]
  );
  const [sitio] = await sql.ejecutar(
    "INSERT INTO sitios (tenant_id,empresa_id,nombre,alias) VALUES (?,?,'Sitio 5.28.6c','sitio-5286c')",
    [tenant.insertId, empresa.insertId]
  );
  const [agente] = await sql.ejecutar(
    `INSERT INTO agentes_sentinelia
       (guid,tenant_id,empresa_id,sitio_id,nombre,secreto_hash)
     VALUES (?,?,?,?,?,'hash')`,
    [generarUuidV7Auditoria(), tenant.insertId, empresa.insertId,
      sitio.insertId, 'Agente 5.28.6c']
  );
  const [zona] = await sql.ejecutar(
    `INSERT INTO zonas_dns
       (tenant_id,empresa_id,sitio_id,nombre_zona,soa_mname,soa_rname)
     VALUES (?,?,?,?,?,?)`,
    [tenant.insertId, empresa.insertId, sitio.insertId,
      'ddns-5286c.example.', 'ns.example.', 'hostmaster.example.']
  );
  const [registro] = await sql.ejecutar(
    `INSERT INTO registros_dns
       (zona_id,tenant_id,empresa_id,sitio_id,host_relativo,tipo_registro,
        valor_principal,ttl_segundos,categoria_origen)
     VALUES (?,?,?,?,?,'A','192.0.2.200',300,'ddns')`,
    [zona.insertId, tenant.insertId, empresa.insertId, sitio.insertId, 'host']
  );
  return { agenteId: agente.insertId, zonaId: zona.insertId, registroId: registro.insertId };
}
