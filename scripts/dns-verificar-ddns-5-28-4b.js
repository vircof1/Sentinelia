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
  assert.equal(configuracion.sql.estaCompleta, true, '5.28.4b necesita MariaDB real.');
  const administrador = new ClienteSql(configuracion.sql);
  const base = `sentinelia_fixture_5284b_${randomBytes(5).toString('hex')}`;
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
    const concesiones = new RepositorioConcesionesDdnsAgentes(sql);
    const coordinacion = crearCoordinacion(sql);
    let invalidaciones = 0;
    const servicio = crearServicio(sql, coordinacion, {
      async invalidarCatalogoDns() {
        invalidaciones += 1;
        throw new Error('Redis no disponible');
      }
    });
    const concesionA = await concesiones.crearConcesion({
      concesionId: generarUuidV7Auditoria(), agenteId: fixture.agente,
      registroDnsId: fixture.registroA
    });

    const aceptada = await servicio.aceptarIntencionExplicita({
      contextoSesionTecnica: contexto(fixture.agente),
      concesionId: concesionA.concesionId,
      solicitud: solicitud('0', 'A', 'declarada', { direccionIpv4: '192.0.2.81' })
    });
    assert.equal(aceptada.resultado, 'aceptada');
    assert.equal(aceptada.hito, 'contenido_deseado_persistido');
    assert.equal(invalidaciones, 1, 'la invalidación posterior al commit debe intentarse');
    await verificarProyeccionA(sql, fixture, concesionA);
    const generacionTrasA = await ultimaGeneracion(sql);

    const convergente = await servicio.aceptarIntencionExplicita({
      contextoSesionTecnica: contexto(fixture.agente),
      concesionId: concesionA.concesionId,
      solicitud: solicitud('0', 'A', 'declarada', { direccionIpv4: '192.0.2.81' })
    });
    assert.equal(convergente.resultado, 'convergente');
    assert.equal(await ultimaGeneracion(sql), generacionTrasA,
      'convergencia no puede publicar de forma redundante');

    const observada = await servicio.aceptarIntencionExplicita({
      contextoSesionTecnica: contexto(fixture.agente),
      concesionId: concesionA.concesionId,
      solicitud: solicitud('1', 'A', 'observada', null)
    });
    assert.equal(observada.hito, 'intencion_aceptada');
    assert.equal(observada.condicion, 'esperando_observacion');
    assert.equal(await ultimaGeneracion(sql), generacionTrasA);
    const [trasObservada] = await sql.consultar(
      `SELECT r.valor_principal,c.contenido_deseado_canonico
         FROM registros_dns r JOIN concesiones_ddns_agentes c
           ON c.registro_dns_id=r.id WHERE c.id=?`, [concesionA.idInterno]
    );
    assert.equal(trasObservada.valor_principal, '192.0.2.81');
    assert.ok(JSON.stringify(trasObservada.contenido_deseado_canonico).includes('192.0.2.81'));

    const concesionMx = await concesiones.crearConcesion({
      concesionId: generarUuidV7Auditoria(), agenteId: fixture.agente,
      registroDnsId: fixture.registroMx
    });
    await servicio.aceptarIntencionExplicita({
      contextoSesionTecnica: contexto(fixture.agente),
      concesionId: concesionMx.concesionId,
      solicitud: solicitud('0', 'MX', 'declarada', {
        prioridad: 30, destino: 'Mail.Nuevo.Example'
      })
    });
    const [mx] = await sql.consultar(
      'SELECT valor_principal,prioridad FROM registros_dns WHERE id=?',
      [fixture.registroMx]
    );
    assert.deepEqual([mx.valor_principal, Number(mx.prioridad)],
      ['mail.nuevo.example.', 30]);

    for (const [clave, tipo, valor, esperado] of [
      ['registroAaaa', 'AAAA', { direccionIpv6: '2001:0DB8::81' },
        ['2001:db8::81', null]],
      ['registroCname', 'CNAME', { destino: 'Destino.Nuevo.Example' },
        ['destino.nuevo.example.', null]],
      ['registroNullMx', 'MX', { prioridad: 0, destino: '.' }, ['.', 0]]
    ]) {
      const concesion = await concesiones.crearConcesion({
        concesionId: generarUuidV7Auditoria(), agenteId: fixture.agente,
        registroDnsId: fixture[clave]
      });
      const resultado = await servicio.aceptarIntencionExplicita({
        contextoSesionTecnica: contexto(fixture.agente),
        concesionId: concesion.concesionId,
        solicitud: solicitud('0', tipo, 'declarada', valor)
      });
      assert.equal(resultado.resultado, 'aceptada');
      const [registro] = await sql.consultar(
        'SELECT valor_principal,prioridad FROM registros_dns WHERE id=?',
        [fixture[clave]]
      );
      assert.deepEqual(
        [registro.valor_principal,
          registro.prioridad === null ? null : Number(registro.prioridad)],
        esperado
      );
    }

    const concesionRollback = await concesiones.crearConcesion({
      concesionId: generarUuidV7Auditoria(), agenteId: fixture.agente,
      registroDnsId: fixture.registroRollback
    });
    const coordinacionFallida = {
      async crearGeneracionPorMutacionEnTransaccion({ conexion }) {
        await coordinacion.crearGeneracionPorMutacionEnTransaccion({ conexion });
        throw new Error('fallo inyectado tras crear generación');
      }
    };
    await assert.rejects(
      crearServicio(sql, coordinacionFallida).aceptarIntencionExplicita({
        contextoSesionTecnica: contexto(fixture.agente),
        concesionId: concesionRollback.concesionId,
        solicitud: solicitud('0', 'A', 'declarada', { direccionIpv4: '203.0.113.99' })
      }),
      /fallo inyectado/u
    );
    const [rollback] = await sql.consultar(
      `SELECT r.valor_principal,CAST(c.version_ddns AS CHAR) version_ddns,
              c.intencion_gobernante_id
         FROM registros_dns r JOIN concesiones_ddns_agentes c
           ON c.registro_dns_id=r.id WHERE c.id=?`, [concesionRollback.idInterno]
    );
    assert.deepEqual(
      [rollback.valor_principal, rollback.version_ddns, rollback.intencion_gobernante_id],
      ['203.0.113.10', '0', null]
    );
    const pendientes = await sql.consultar(
      "SELECT generacion_dns FROM operaciones_publicacion_dns WHERE estado='pendiente'"
    );
    assert.ok(pendientes.length >= 1,
      'el barrido SQL debe poder recuperar trabajo aunque se pierda Redis');

    console.log(
      '[dns-ddns] OK 5.28.4b: proyeccion=transaccional mx=indivisible ' +
      'tipos=A+AAAA+CNAME+MX+NullMX ' +
      'observada=conserva_contenido redundancia=sin_generacion rollback=total ' +
      'redis=aviso barrido=sql'
    );
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(base)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

function crearCoordinacion(sql) {
  return new RepositorioCoordinacionGeneracionesDns({
    clienteSql: sql,
    bloquearCatalogoEnTransaccion
  });
}

function crearServicio(sql, coordinacion, servicioDns = null) {
  return new ServicioAplicacionDdnsAgentes({
    clienteSql: sql,
    repositorioUsuarios: new RepositorioUsuarios(sql),
    repositorioCoordinacionGeneracionesDns: coordinacion,
    servicioDns
  });
}

function contexto(agenteId) {
  return { sesion: { agenteId: String(agenteId) } };
}

function solicitud(versionEsperada, tipo, modo, valor) {
  return {
    perfil: PERFILES_DDNS_AGENTES.SOLICITUD,
    versionContrato: VERSION_CONTRATO_DDNS_AGENTES,
    solicitudId: generarUuidV7Auditoria(),
    versionEsperada,
    estadoDeseado: {
      perfil: PERFILES_DDNS_AGENTES.ESTADO_DESEADO,
      versionContrato: VERSION_CONTRATO_DDNS_AGENTES,
      tipo, modo, valor
    }
  };
}

async function verificarProyeccionA(sql, fixture, concesion) {
  const [fila] = await sql.consultar(
    `SELECT r.valor_principal,r.prioridad,c.contenido_deseado_canonico,
            i.hito,i.persistida_en_utc,p.numero_intento,p.estado
       FROM concesiones_ddns_agentes c
       JOIN registros_dns r ON r.id=c.registro_dns_id
       JOIN intenciones_ddns_agentes i ON i.id=c.intencion_gobernante_id
       JOIN intentos_publicacion_ddns p ON p.intencion_interna_id=i.id
      WHERE c.id=?`, [concesion.idInterno]
  );
  assert.equal(fila.valor_principal, '192.0.2.81');
  assert.equal(fila.prioridad, null);
  assert.ok(JSON.stringify(fila.contenido_deseado_canonico).includes('192.0.2.81'));
  assert.equal(fila.hito, 'contenido_deseado_persistido');
  assert.ok(fila.persistida_en_utc);
  assert.deepEqual([Number(fila.numero_intento), fila.estado], [1, 'pendiente']);
}

async function ultimaGeneracion(sql) {
  const [fila] = await sql.consultar(
    'SELECT CAST(ultima_generacion_dns AS CHAR) valor FROM cabecera_generacion_dns WHERE id=1'
  );
  return fila.valor;
}

async function bloquearCatalogoEnTransaccion({ conexion }) {
  await conexion.execute('SELECT id FROM zonas_dns ORDER BY id FOR UPDATE');
  await conexion.execute('SELECT id FROM registros_dns ORDER BY zona_id,id FOR UPDATE');
}

async function crearFixture(sql) {
  const [tenant] = await sql.ejecutar(
    "INSERT INTO tenants (nombre,alias) VALUES ('Tenant 5.28.4b','tenant-5284b')"
  );
  const [empresa] = await sql.ejecutar(
    "INSERT INTO empresas (tenant_id,nombre,alias) VALUES (?,'Empresa 5.28.4b','empresa-5284b')",
    [tenant.insertId]
  );
  const [sitio] = await sql.ejecutar(
    "INSERT INTO sitios (tenant_id,empresa_id,nombre,alias) VALUES (?,?,'Sitio 5.28.4b','sitio-5284b')",
    [tenant.insertId, empresa.insertId]
  );
  const [agente] = await sql.ejecutar(
    `INSERT INTO agentes_sentinelia (
       guid,tenant_id,empresa_id,sitio_id,nombre,secreto_hash
     ) VALUES (?,?,?,?,?,'hash')`,
    [generarUuidV7Auditoria(), tenant.insertId, empresa.insertId, sitio.insertId, 'Agente 5.28.4b']
  );
  const [zona] = await sql.ejecutar(
    `INSERT INTO zonas_dns (
       tenant_id,empresa_id,sitio_id,nombre_zona,soa_mname,soa_rname
     ) VALUES (?,?,?,?,?,?)`,
    [tenant.insertId, empresa.insertId, sitio.insertId,
      'ddns-5284b.example.', 'ns.example.', 'hostmaster.example.']
  );
  const ids = {};
  for (const [clave, host, tipo, valor, prioridad] of [
    ['registroA', 'host-a', 'A', '192.0.2.10', null],
    ['registroMx', '@', 'MX', 'mail.inicial.example.', 10],
    ['registroAaaa', 'host-aaaa', 'AAAA', '2001:db8::10', null],
    ['registroCname', 'alias', 'CNAME', 'destino.inicial.example.', null],
    ['registroNullMx', 'sin-correo', 'MX', '.', 0],
    ['registroRollback', 'rollback', 'A', '203.0.113.10', null]
  ]) {
    const [registro] = await sql.ejecutar(
      `INSERT INTO registros_dns (
         zona_id,tenant_id,empresa_id,sitio_id,host_relativo,tipo_registro,
         valor_principal,prioridad,ttl_segundos,categoria_origen
       ) VALUES (?,?,?,?,?,?,?,?,300,'ddns')`,
      [zona.insertId, tenant.insertId, empresa.insertId, sitio.insertId,
        host, tipo, valor, prioridad]
    );
    ids[clave] = registro.insertId;
  }
  return Object.freeze({ agente: agente.insertId, ...ids });
}
