import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import { generarUuidV7Auditoria }
  from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import { AutoridadPublicacionBindPerdida }
  from '../paquetes/dns/src/PublicadorCoordinadoBindDns.js';
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
import { ServicioBloqueosPublicacionDdns }
  from '../paquetes/dns/src/ServicioBloqueosPublicacionDdns.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones } from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import { RepositorioUsuarios } from '../paquetes/usuarios/src/RepositorioUsuarios.js';
import { obtenerConfiguracionAplicacion, obtenerRutaMigraciones }
  from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

await main();

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true, '5.28.6d necesita MariaDB real.');
  const administrador = new ClienteSql(configuracion.sql);
  const base = `sentinelia_fixture_5286d_${randomBytes(5).toString('hex')}`;
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
    await verificarBloqueoGlobal(sql);
    await verificarPausaReanudacion(sql);
    await verificarPerdidaLeaseNoBloquea();
    console.log('[dns-ddns] OK 5.28.6d: global=bloqueado presupuesto=conservado backoff=5-300 reinicio=sql_autoritativo recuperacion=publicada pausa=durable reanudacion=gobernante lease=cede');
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(base)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

async function verificarBloqueoGlobal(sql) {
  const caso = await prepararCaso(sql, 'global', '192.0.2.211');
  let coordinacion = caso.coordinacion;
  const bloqueos = new ServicioBloqueosPublicacionDdns({
    repositorioCoordinacion: coordinacion
  });
  let reclamacion = await reclamarEIniciar(coordinacion, caso.generacion, 'runtime-1');
  let bloqueo = await bloqueos.resolver({
    lease: reclamacion.lease,
    operacion: reclamacion.operacion,
    error: Object.assign(new Error('named-checkconf rechazó la configuración.'), {
      codigo: 'bind_checkconf_rechazado'
    })
  });
  assert.deepEqual(
    [bloqueo.bloqueado, bloqueo.demoraSegundos, bloqueo.intentosDdns],
    [true, 5, 1]
  );
  let estado = await estadoCaso(sql, caso.concesion.idInterno);
  assert.deepEqual(
    [estado.condicion_operativa, estado.estado_intento,
      estado.numero_intento, estado.terminal],
    ['publicacion_bloqueada', 'bloqueada', 1, null]
  );

  // Un runtime nuevo recupera exclusivamente desde SQL; Redis no contiene
  // ninguna autoridad necesaria para conservar presupuesto ni backoff.
  coordinacion = crearCoordinacion(sql);
  const demorasEsperadas = [10, 20, 40, 80, 160, 300, 300];
  for (let indice = 0; indice < demorasEsperadas.length; indice += 1) {
    await hacerElegible(sql, caso.generacion);
    reclamacion = await reclamarExistente(coordinacion, caso.generacion, `runtime-${indice + 2}`);
    bloqueo = await new ServicioBloqueosPublicacionDdns({
      repositorioCoordinacion: coordinacion
    }).resolver({
      lease: reclamacion.lease,
      operacion: reclamacion.operacion,
      error: new Error('BIND continúa temporalmente indisponible.')
    });
    assert.equal(bloqueo.demoraSegundos, demorasEsperadas[indice]);
  }
  estado = await estadoCaso(sql, caso.concesion.idInterno);
  assert.deepEqual([estado.numero_intento, estado.total_intentos], [1, 1]);

  await transaccion(sql, (conexion) => new ConsolidadorPublicacionDdnsSql()
    .consolidarEnTransaccion({
      conexion,
      generacionDns: caso.generacion,
      diagnostico: manifiesto(caso, '1')
    }));
  estado = await estadoCaso(sql, caso.concesion.idInterno);
  assert.deepEqual(
    [estado.condicion_operativa, estado.estado_intento, estado.terminal],
    ['operativa', 'publicada', 'publicada']
  );
}

async function verificarPausaReanudacion(sql) {
  const caso = await prepararCaso(sql, 'pausa', '192.0.2.221');
  const servicio = caso.servicio;
  const pausada = await transaccion(sql, async (conexion) => {
    const resultado = await servicio.sincronizarOperabilidadRegistroEnTransaccion({
      registroDnsId: caso.fixture.registroId,
      operable: false
    }, { conexion });
    await conexion.execute('UPDATE registros_dns SET activo=FALSE WHERE id=?',
      [caso.fixture.registroId]);
    return resultado;
  });
  assert.equal(pausada.pausado, true);
  let estado = await estadoCaso(sql, caso.concesion.idInterno);
  assert.deepEqual(
    [estado.condicion_operativa, estado.estado_intento,
      estado.disponible_en_utc],
    ['registro_no_operable', 'bloqueada', null]
  );

  // Otra instancia de servicio reanuda la misma versión e intento; no fabrica
  // una declaración ni recupera una intención sustituida.
  const servicioTrasReinicio = crearServicio(sql, crearCoordinacion(sql));
  const reanudada = await transaccion(sql, async (conexion) => {
    const resultado = await servicioTrasReinicio
      .sincronizarOperabilidadRegistroEnTransaccion({
        registroDnsId: caso.fixture.registroId,
        operable: true
      }, { conexion });
    await conexion.execute('UPDATE registros_dns SET activo=TRUE WHERE id=?',
      [caso.fixture.registroId]);
    return resultado;
  });
  assert.equal(reanudada.pausado, false);
  estado = await estadoCaso(sql, caso.concesion.idInterno);
  assert.deepEqual(
    [estado.version_ddns, estado.condicion_operativa, estado.estado_intento,
      estado.numero_intento, estado.generacion_dns],
    ['1', 'operativa', 'pendiente', 1, reanudada.generacionDns]
  );
}

async function verificarPerdidaLeaseNoBloquea() {
  let llamadas = 0;
  const servicio = new ServicioBloqueosPublicacionDdns({
    repositorioCoordinacion: {
      registrarBloqueoGlobalDdnsConLease: async () => { llamadas += 1; }
    }
  });
  const resultado = await servicio.resolver({
    lease: {},
    operacion: {},
    error: new AutoridadPublicacionBindPerdida()
  });
  assert.equal(resultado, null);
  assert.equal(llamadas, 0);
}

async function prepararCaso(sql, sufijo, direccion) {
  const fixture = await crearFixture(sql, sufijo);
  const coordinacion = crearCoordinacion(sql);
  const concesion = await new RepositorioConcesionesDdnsAgentes(sql).crearConcesion({
    concesionId: generarUuidV7Auditoria(),
    agenteId: fixture.agenteId,
    registroDnsId: fixture.registroId
  });
  const servicio = crearServicio(sql, coordinacion);
  const resultado = await servicio.aceptarIntencionExplicita({
    contextoSesionTecnica: { sesion: { agenteId: String(fixture.agenteId) } },
    concesionId: concesion.concesionId,
    solicitud: solicitud('0', direccion)
  });
  assert.equal(resultado.resultado, 'aceptada');
  const [intento] = await sql.consultar(
    `SELECT CAST(generacion_dns AS CHAR) generacion_dns
       FROM intentos_publicacion_ddns WHERE concesion_interna_id=?`,
    [concesion.idInterno]
  );
  return { fixture, coordinacion, concesion, servicio, generacion: intento.generacion_dns };
}

function crearCoordinacion(sql) {
  return new RepositorioCoordinacionGeneracionesDns({
    clienteSql: sql,
    bloquearCatalogoEnTransaccion
  });
}

function crearServicio(sql, coordinacion) {
  return new ServicioAplicacionDdnsAgentes({
    clienteSql: sql,
    repositorioUsuarios: new RepositorioUsuarios(sql),
    repositorioCoordinacionGeneracionesDns: coordinacion
  });
}

async function reclamarEIniciar(coordinacion, generacion, instanciaId) {
  const reclamada = await reclamarExistente(coordinacion, generacion, instanciaId);
  const operacion = await coordinacion.iniciarEfectoConLease(reclamada.lease, {
    generacionLeida: generacion,
    perfilProyeccion: 'sentinelia-bind-proyeccion-v1',
    hashProyeccion: randomBytes(32)
  });
  return { ...reclamada, operacion };
}

async function reclamarExistente(coordinacion, generacion, instanciaId) {
  const leaseToken = randomBytes(32);
  const operacion = await coordinacion.reclamarSiguienteConLease({
    instanciaId, leaseToken, ttlSegundos: 30
  });
  assert.equal(operacion.generacionDns, generacion);
  return {
    operacion,
    lease: {
      generacionDns: generacion,
      instanciaId,
      leaseToken,
      fencingToken: operacion.fencingToken
    }
  };
}

async function estadoCaso(sql, concesionId) {
  const [fila] = await sql.consultar(
    `SELECT CAST(c.version_ddns AS CHAR) version_ddns,c.condicion_operativa,
            i.terminal,p.estado estado_intento,p.numero_intento,
            CAST(p.generacion_dns AS CHAR) generacion_dns,p.disponible_en_utc,
            (SELECT COUNT(*) FROM intentos_publicacion_ddns px
              WHERE px.concesion_interna_id=c.id) total_intentos
       FROM concesiones_ddns_agentes c
       JOIN intenciones_ddns_agentes i ON i.id=c.intencion_gobernante_id
       JOIN intentos_publicacion_ddns p ON p.intencion_interna_id=i.id
      WHERE c.id=? ORDER BY p.numero_intento DESC LIMIT 1`,
    [concesionId]
  );
  return { ...fila, numero_intento: Number(fila.numero_intento),
    total_intentos: Number(fila.total_intentos) };
}

function manifiesto(caso, versionDdns) {
  return {
    perfil: 'sentinelia-bind-diagnostico-v1',
    entradas: [{
      zonaDnsId: String(caso.fixture.zonaId),
      rutaZona: 'zonas/ddns.zone', linea: 14,
      registroDnsId: String(caso.fixture.registroId),
      concesionId: caso.concesion.concesionId,
      versionDdns
    }]
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

async function hacerElegible(sql, generacion) {
  await sql.ejecutar(
    'UPDATE operaciones_publicacion_dns SET proximo_intento_utc=UTC_TIMESTAMP(3) WHERE generacion_dns=?',
    [generacion]
  );
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

async function bloquearCatalogoEnTransaccion({ conexion }) {
  await conexion.execute('SELECT id FROM zonas_dns ORDER BY id FOR UPDATE');
  await conexion.execute('SELECT id FROM registros_dns ORDER BY zona_id,id FOR UPDATE');
}

async function crearFixture(sql, sufijo) {
  const alias = `t-5286d-${sufijo}`;
  const [tenant] = await sql.ejecutar(
    'INSERT INTO tenants (nombre,alias) VALUES (?,?)', [`Tenant ${sufijo}`, alias]
  );
  const [empresa] = await sql.ejecutar(
    'INSERT INTO empresas (tenant_id,nombre,alias) VALUES (?,?,?)',
    [tenant.insertId, `Empresa ${sufijo}`, `e-5286d-${sufijo}`]
  );
  const [sitio] = await sql.ejecutar(
    'INSERT INTO sitios (tenant_id,empresa_id,nombre,alias) VALUES (?,?,?,?)',
    [tenant.insertId, empresa.insertId, `Sitio ${sufijo}`, `s-5286d-${sufijo}`]
  );
  const [agente] = await sql.ejecutar(
    `INSERT INTO agentes_sentinelia
       (guid,tenant_id,empresa_id,sitio_id,nombre,secreto_hash)
     VALUES (?,?,?,?,?,'hash')`,
    [generarUuidV7Auditoria(), tenant.insertId, empresa.insertId,
      sitio.insertId, `Agente ${sufijo}`]
  );
  const [zona] = await sql.ejecutar(
    `INSERT INTO zonas_dns
       (tenant_id,empresa_id,sitio_id,nombre_zona,soa_mname,soa_rname)
     VALUES (?,?,?,?,?,?)`,
    [tenant.insertId, empresa.insertId, sitio.insertId,
      `${sufijo}.5286d.example.`, 'ns.example.', 'hostmaster.example.']
  );
  const [registro] = await sql.ejecutar(
    `INSERT INTO registros_dns
       (zona_id,tenant_id,empresa_id,sitio_id,host_relativo,tipo_registro,
        valor_principal,ttl_segundos,categoria_origen)
     VALUES (?,?,?,?,?,'A','192.0.2.210',300,'ddns')`,
    [zona.insertId, tenant.insertId, empresa.insertId, sitio.insertId, 'host']
  );
  return { agenteId: agente.insertId, zonaId: zona.insertId, registroId: registro.insertId };
}
