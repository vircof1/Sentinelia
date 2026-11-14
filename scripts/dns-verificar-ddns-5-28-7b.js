import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import { ProcesadorCausasPolDdnsRuntime }
  from '../apps/sentinelia-runtime/src/dns/ProcesadorCausasPolDdnsRuntime.js';
import { generarUuidV7Auditoria }
  from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import { CoordinadorOperacionesDurables }
  from '../paquetes/coordinacion-durable/src/CoordinadorOperacionesDurables.js';
import { PERFILES_DDNS_AGENTES, VERSION_CONTRATO_DDNS_AGENTES }
  from '../paquetes/dns/src/ContratoDdnsAgentes.js';
import { RepositorioCausasPolDdns }
  from '../paquetes/dns/src/RepositorioCausasPolDdns.js';
import { RepositorioConcesionesDdnsAgentes }
  from '../paquetes/dns/src/RepositorioConcesionesDdnsAgentes.js';
import { ServicioAplicacionDdnsAgentes }
  from '../paquetes/dns/src/ServicioAplicacionDdnsAgentes.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { FronteraTransaccionalLocal }
  from '../paquetes/persistencia-sql/src/FronteraTransaccionalLocal.js';
import { RepositorioMigraciones }
  from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import { obtenerConfiguracionAplicacion, obtenerRutaMigraciones }
  from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

await main();

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true, '5.28.7b necesita MariaDB real.');
  const administrador = new ClienteSql(configuracion.sql);
  const base = `sentinelia_fixture_5287b_${randomBytes(5).toString('hex')}`;
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
    await verificarFanout(sql);
    console.log('[dns-ddns] OK 5.28.7b: causas=fencing runtimes=2 candidatas=observadas-aptas fanout=independiente fallo=selectivo-sin_bloqueo reintento=durable reparto=exacto');
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(base)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

async function verificarFanout(sql) {
  const fixture = await crearFixture(sql);
  const repositorioConcesiones = new RepositorioConcesionesDdnsAgentes(sql);
  const servicio = new ServicioAplicacionDdnsAgentes({
    clienteSql: sql,
    repositorioUsuarios: { buscarPorIdEnTransaccion: async () => null }
  });
  const concesiones = [];
  for (const registro of fixture.registros) {
    const concesion = await repositorioConcesiones.crearConcesion({
      concesionId: generarUuidV7Auditoria(),
      agenteId: fixture.agenteId,
      registroDnsId: registro.id
    });
    const aceptada = await servicio.aceptarIntencionExplicita({
      contextoSesionTecnica: { sesion: { agenteId: String(fixture.agenteId) } },
      concesionId: concesion.concesionId,
      solicitud: solicitudObservada(registro.tipo)
    });
    assert.equal(aceptada.resultado, 'aceptada');
    concesiones.push({ ...concesion, registro });
  }
  await sql.ejecutar('UPDATE registros_dns SET activo=FALSE WHERE id=?',
    [fixture.registros[2].id]);
  await sql.ejecutar("UPDATE registros_dns SET categoria_origen='normal' WHERE id=?",
    [fixture.registros[3].id]);

  const aptas = await repositorioConcesiones
    .listarObservadasAptasPorAgente(fixture.agenteId);
  assert.deepEqual(
    aptas.map((item) => item.concesionId),
    concesiones.slice(0, 2).map((item) => item.concesionId)
  );

  const repositorioCausas = new RepositorioCausasPolDdns(sql);
  const causaFallo = await crearCausa(repositorioCausas, fixture, 1, '192.0.2.80');
  const frontera = new FronteraTransaccionalLocal(sql);
  const intentos = [];
  let falloPendiente = true;
  const procesarConcesionEnTransaccion = async ({ causa, concesion }) => {
    intentos.push(`${causa.causaId}:${concesion.concesionId}`);
    return frontera.ejecutar(async (conexion) => {
      await conexion.execute(
        'UPDATE registros_dns SET descripcion=? WHERE id=?',
        [`causa ${causa.causaId}`, concesion.registroDnsId]
      );
      if (falloPendiente && concesion.concesionId === aptas[0].concesionId) {
        falloPendiente = false;
        throw Object.assign(new Error('fallo selectivo'), { codigo: 'registro_selectivo' });
      }
      return { aplicada: true };
    });
  };
  const coordinadorA = crearCoordinador(repositorioCausas, 'runtime-7b-a');
  const procesadorA = crearProcesador({
    coordinador: coordinadorA,
    repositorioConcesiones,
    procesarConcesionEnTransaccion
  });
  const primerResultado = await procesadorA.procesarSiguiente();
  assert.deepEqual(
    [primerResultado.causaId, primerResultado.estado,
      primerResultado.correctos, primerResultado.fallidos],
    [causaFallo, 'reintentable', 1, 1]
  );
  assert.equal((await sql.consultar(
    'SELECT descripcion FROM registros_dns WHERE id=?',
    [aptas[0].registroDnsId]
  ))[0].descripcion, null, 'El fallo de una unidad debe revertir solo su transacción.');
  assert.match((await sql.consultar(
    'SELECT descripcion FROM registros_dns WHERE id=?',
    [aptas[1].registroDnsId]
  ))[0].descripcion, /causa/u, 'El hermano debe confirmar aunque otra unidad falle.');

  const causaDos = await crearCausa(repositorioCausas, fixture, 2, '192.0.2.81');
  const causaTres = await crearCausa(repositorioCausas, fixture, 3, '2001:db8::81', 'ipv6');
  const procesadorB = crearProcesador({
    coordinador: crearCoordinador(repositorioCausas, 'runtime-7b-b'),
    repositorioConcesiones,
    procesarConcesionEnTransaccion
  });
  const primeraCarrera = await Promise.all([
    procesadorA.procesarSiguiente(),
    procesadorB.procesarSiguiente()
  ]);
  const concurrentes = primeraCarrera.filter(Boolean);
  for (let intento = 0; concurrentes.length < 2 && intento < 4; intento += 1) {
    const resultado = await (intento % 2 === 0 ? procesadorA : procesadorB)
      .procesarSiguiente();
    if (resultado) concurrentes.push(resultado);
  }
  assert.equal(concurrentes.length, 2,
    'La cesión concurrente de una reclamación no puede perder una causa durable.');
  assert.deepEqual(
    new Set(concurrentes.map((resultado) => resultado.causaId)),
    new Set([causaDos, causaTres])
  );
  for (const resultado of concurrentes) {
    assert.deepEqual(
      [resultado.estado, resultado.total, resultado.correctos, resultado.fallidos],
      ['completada', 2, 2, 0]
    );
    assert.equal(
      intentos.filter((clave) => clave.startsWith(`${resultado.causaId}:`)).length,
      2,
      'Cada runtime debe repartir su causa exactamente una vez por candidata.'
    );
  }

  await sql.ejecutar(
    'UPDATE causas_pol_ddns SET disponible_en_utc=UTC_TIMESTAMP(3) WHERE causa_id=UNHEX(REPLACE(?,\'-\',\'\'))',
    [causaFallo]
  );
  const reintento = await procesadorB.procesarSiguiente();
  assert.deepEqual(
    [reintento.causaId, reintento.estado, reintento.total, reintento.fallidos],
    [causaFallo, 'completada', 2, 0]
  );
  const estados = await sql.consultar(
    'SELECT estado,intentos FROM causas_pol_ddns ORDER BY secuencia'
  );
  assert.deepEqual(estados.map((fila) => [fila.estado, Number(fila.intentos)]), [
    ['completada', 2], ['completada', 1], ['completada', 1]
  ]);
}

function crearProcesador(argumentos) {
  return new ProcesadorCausasPolDdnsRuntime({
    ...argumentos,
    demoraReintentoSegundos: 5
  });
}

function crearCoordinador(repositorio, instanciaId) {
  return new CoordinadorOperacionesDurables({
    repositorio,
    instanciaId,
    ttlSegundos: 30
  });
}

async function crearCausa(repositorio, fixture, secuencia, direccion, familia = 'ipv4') {
  const causaId = generarUuidV7Auditoria();
  await repositorio.crear({
    causaId,
    agenteId: fixture.agenteId,
    periodoVidaPolId: fixture.periodoId,
    sesionId: 'sesion-7b',
    secuencia,
    aceptadaEnUtc: new Date(Date.now() - 1_000 + secuencia),
    direccionRemota: direccion,
    familiaDireccion: familia
  });
  return causaId;
}

function solicitudObservada(tipo) {
  return {
    perfil: PERFILES_DDNS_AGENTES.SOLICITUD,
    versionContrato: VERSION_CONTRATO_DDNS_AGENTES,
    solicitudId: generarUuidV7Auditoria(),
    versionEsperada: '0',
    estadoDeseado: {
      perfil: PERFILES_DDNS_AGENTES.ESTADO_DESEADO,
      versionContrato: VERSION_CONTRATO_DDNS_AGENTES,
      tipo,
      modo: 'observada',
      valor: null
    }
  };
}

async function crearFixture(sql) {
  const [tenant] = await sql.ejecutar(
    "INSERT INTO tenants (nombre,alias) VALUES ('Tenant 7b','tenant-5287b')"
  );
  const [empresa] = await sql.ejecutar(
    "INSERT INTO empresas (tenant_id,nombre,alias) VALUES (?,'Empresa 7b','empresa-5287b')",
    [tenant.insertId]
  );
  const [sitio] = await sql.ejecutar(
    "INSERT INTO sitios (tenant_id,empresa_id,nombre,alias) VALUES (?,?,'Sitio 7b','sitio-5287b')",
    [tenant.insertId, empresa.insertId]
  );
  const [agente] = await sql.ejecutar(
    `INSERT INTO agentes_sentinelia
       (guid,tenant_id,empresa_id,sitio_id,nombre,secreto_hash)
     VALUES (?,?,?,?,?,'hash')`,
    [generarUuidV7Auditoria(), tenant.insertId, empresa.insertId,
      sitio.insertId, 'Agente 7b']
  );
  const [zona] = await sql.ejecutar(
    `INSERT INTO zonas_dns
       (tenant_id,empresa_id,sitio_id,nombre_zona,soa_mname,soa_rname)
     VALUES (?,?,?,?,?,?)`,
    [tenant.insertId, empresa.insertId, sitio.insertId,
      'fanout.5287b.example.', 'ns.example.', 'hostmaster.example.']
  );
  const definiciones = [
    ['a-uno', 'A', '192.0.2.10'],
    ['aaaa-uno', 'AAAA', '2001:db8::10'],
    ['a-inactivo', 'A', '192.0.2.11'],
    ['a-categoria', 'A', '192.0.2.12']
  ];
  const registros = [];
  for (const [host, tipo, valor] of definiciones) {
    const [registro] = await sql.ejecutar(
      `INSERT INTO registros_dns
         (zona_id,tenant_id,empresa_id,sitio_id,host_relativo,tipo_registro,
          valor_principal,ttl_segundos,categoria_origen)
       VALUES (?,?,?,?,?,?,?,300,'ddns')`,
      [zona.insertId, tenant.insertId, empresa.insertId, sitio.insertId,
        host, tipo, valor]
    );
    registros.push({ id: registro.insertId, tipo });
  }
  const [periodo] = await sql.ejecutar(
    `INSERT INTO periodos_vida_pol_agentes
       (agente_id,inicio_utc,heartbeats_recibidos,ultimo_seq)
     VALUES (?,UTC_TIMESTAMP(3),3,3)`,
    [agente.insertId]
  );
  return {
    agenteId: agente.insertId,
    periodoId: periodo.insertId,
    registros
  };
}
