import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import { generarUuidV7Auditoria } from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import { RepositorioUsuarios } from '../paquetes/usuarios/src/RepositorioUsuarios.js';
import { RepositorioConcesionesDdnsAgentes } from '../paquetes/dns/src/RepositorioConcesionesDdnsAgentes.js';
import {
  ErrorAplicacionDdnsAgentes,
  ServicioAplicacionDdnsAgentes
} from '../paquetes/dns/src/ServicioAplicacionDdnsAgentes.js';
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
  assert.equal(configuracion.sql.estaCompleta, true, '5.28.3b necesita MariaDB real.');
  const administrador = new ClienteSql(configuracion.sql);
  const base = `sentinelia_fixture_5283b_${randomBytes(5).toString('hex')}`;
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
    const servicio = new ServicioAplicacionDdnsAgentes({
      clienteSql: sql,
      repositorioUsuarios: new RepositorioUsuarios(sql),
      repositorioConcesiones: repositorio
    });
    const concesionInicial = await repositorio.crearConcesion({
      concesionId: generarUuidV7Auditoria(),
      agenteId: fixture.agenteA,
      registroDnsId: fixture.registro
    });

    await verificarProyecciones(servicio, fixture, concesionInicial.concesionId);
    await verificarRevocacionesYReasignacion({
      servicio,
      repositorio,
      fixture,
      concesionInicial
    });
    await verificarSinMutacionDns(sql, fixture);
    console.log(
      '[dns-ddns] OK 5.28.3b: vistas=completa+agente+registro+ninguna ' +
      'restringido=sin_metadatos revocacion=unilateral_dos_extremos ' +
      'corte=irrevocable reasignacion=revocar-luego-crear dns=inalterado'
    );
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(base)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

async function verificarProyecciones(servicio, fixture, concesionId) {
  const completa = await servicio.proyectarConcesion(
    contexto(fixture.usuarioPortal, fixture.portal, ['verAgentes', 'verDns']),
    concesionId
  );
  assert.equal(completa.agente.restringido, false);
  assert.equal(completa.registro.restringido, false);
  assert.equal(completa.agente.id, String(fixture.agenteA));
  assert.equal(completa.registro.id, String(fixture.registro));

  const soloAgente = await servicio.proyectarConcesion(
    contexto(fixture.usuarioA, fixture.scopeA, ['verAgentes', 'verDns']),
    concesionId
  );
  assert.equal(soloAgente.agente.restringido, false);
  assert.deepEqual(soloAgente.registro, {
    restringido: true,
    tipo: 'registro_dns'
  });
  assert.equal(JSON.stringify(soloAgente.registro).includes(String(fixture.registro)), false);

  const soloRegistro = await servicio.proyectarConcesion(
    contexto(fixture.usuarioB, fixture.scopeB, ['verAgentes', 'verDns']),
    concesionId
  );
  assert.deepEqual(soloRegistro.agente, { restringido: true, tipo: 'agente' });
  assert.equal(soloRegistro.registro.restringido, false);
  assert.equal(JSON.stringify(soloRegistro.agente).includes(String(fixture.agenteA)), false);

  const ninguna = await servicio.proyectarConcesion(
    contexto(fixture.usuarioC, fixture.scopeC, ['verAgentes', 'verDns']),
    concesionId
  );
  assert.equal(ninguna, null);
}

async function verificarRevocacionesYReasignacion({
  servicio,
  repositorio,
  fixture,
  concesionInicial
}) {
  await assert.rejects(
    servicio.crearConcesion({
      contextoUsuarioActual: contexto(
        fixture.usuarioPortal,
        fixture.portal,
        ['modificarAgentes', 'administrarDnsAvanzado']
      ),
      agenteId: fixture.agenteB,
      registroDnsId: fixture.registro
    }),
    (error) => error instanceof ErrorAplicacionDdnsAgentes &&
      error.codigo === 'registro_no_elegible'
  );

  const desdeAgente = await servicio.revocarDesdeAgente({
    contextoUsuarioActual: contexto(
      fixture.usuarioA,
      fixture.scopeA,
      ['modificarAgentes']
    ),
    agenteId: fixture.agenteA,
    concesionId: concesionInicial.concesionId
  });
  assert.equal(desdeAgente.efectuada, true);
  assert.equal(desdeAgente.revocadaDesde, 'agente');
  assert.equal(desdeAgente.concesion.causaCierre, 'revocada_desde_agente');
  assert.equal(desdeAgente.concesion.estado, 'revocada');

  const repetida = await servicio.revocarDesdeAgente({
    contextoUsuarioActual: contexto(
      fixture.usuarioA,
      fixture.scopeA,
      ['modificarAgentes']
    ),
    agenteId: fixture.agenteA,
    concesionId: concesionInicial.concesionId
  });
  assert.equal(repetida.efectuada, false);
  assert.equal(repetida.revocadaDesde, 'agente');
  assert.equal(repetida.actorRealId, null);

  const segunda = await servicio.crearConcesion({
    contextoUsuarioActual: contexto(
      fixture.usuarioPortal,
      fixture.portal,
      ['modificarAgentes', 'administrarDnsAvanzado']
    ),
    agenteId: fixture.agenteB,
    registroDnsId: fixture.registro
  });
  assert.notEqual(segunda.concesionId, concesionInicial.concesionId);

  const desdeRegistro = await servicio.revocarDesdeRegistro({
    contextoUsuarioActual: contexto(
      fixture.usuarioB,
      fixture.scopeB,
      ['administrarDnsAvanzado']
    ),
    registroDnsId: fixture.registro,
    concesionId: segunda.concesionId
  });
  assert.equal(desdeRegistro.efectuada, true);
  assert.equal(desdeRegistro.revocadaDesde, 'registro');
  assert.equal(desdeRegistro.concesion.causaCierre, 'revocada_desde_registro');

  const tercera = await servicio.crearConcesion({
    contextoUsuarioActual: contexto(
      fixture.usuarioPortal,
      fixture.portal,
      ['modificarAgentes', 'administrarDnsAvanzado']
    ),
    agenteId: fixture.agenteA,
    registroDnsId: fixture.registro
  });
  assert.equal(tercera.estado, 'vigente');
  const [conteo] = await fixture.sql.consultar(
    `SELECT COUNT(*) AS total FROM concesiones_ddns_agentes
      WHERE registro_dns_id_fotografia=?`,
    [fixture.registro]
  );
  assert.equal(Number(conteo.total), 3);
  assert.equal((await repositorio.buscarPorConcesionId(
    concesionInicial.concesionId
  )).estado, 'revocada');
}

async function verificarSinMutacionDns(sql, fixture) {
  const [registro] = await sql.consultar(
    'SELECT valor_principal,prioridad FROM registros_dns WHERE id=?',
    [fixture.registro]
  );
  assert.equal(registro.valor_principal, '192.0.2.53');
  assert.equal(registro.prioridad, null);
  const [cabecera] = await sql.consultar(
    `SELECT CAST(ultima_generacion_dns AS CHAR) AS ultima
       FROM cabecera_generacion_dns WHERE id=1`
  );
  assert.equal(cabecera.ultima, '0');
}

async function crearFixture(sql) {
  const organizacionA = await crearOrganizacion(sql, 'a');
  const organizacionB = await crearOrganizacion(sql, 'b');
  const organizacionC = await crearOrganizacion(sql, 'c');
  const usuarioPortal = await crearUsuario(sql, 'portal', {}, [
    'permiso_modificar_agentes', 'permiso_administrar_dns_avanzado',
    'permiso_ver_agentes', 'permiso_ver_dns'
  ]);
  const usuarioA = await crearUsuario(sql, 'a', organizacionA, [
    'permiso_modificar_agentes', 'permiso_ver_agentes', 'permiso_ver_dns'
  ]);
  const usuarioB = await crearUsuario(sql, 'b', organizacionB, [
    'permiso_administrar_dns_avanzado', 'permiso_ver_agentes', 'permiso_ver_dns'
  ]);
  const usuarioC = await crearUsuario(sql, 'c', organizacionC, [
    'permiso_ver_agentes', 'permiso_ver_dns'
  ]);
  const agenteA = await crearAgente(sql, organizacionA, 'a');
  const agenteB = await crearAgente(sql, organizacionA, 'b');
  const [zona] = await sql.ejecutar(
    `INSERT INTO zonas_dns (
       tenant_id,empresa_id,sitio_id,nombre_zona,soa_mname,soa_rname
     ) VALUES (?,?,?,?,?,?)`,
    [
      organizacionB.tenantId, organizacionB.empresaId, organizacionB.sitioId,
      'cross-5283b.example.', 'ns.example.', 'hostmaster.example.'
    ]
  );
  const [registro] = await sql.ejecutar(
    `INSERT INTO registros_dns (
       zona_id,tenant_id,empresa_id,sitio_id,host_relativo,tipo_registro,
       valor_principal,categoria_origen
     ) VALUES (?,?,?,?,'host','A','192.0.2.53','ddns')`,
    [zona.insertId, organizacionB.tenantId, organizacionB.empresaId, organizacionB.sitioId]
  );
  return Object.freeze({
    sql,
    usuarioPortal,
    usuarioA,
    usuarioB,
    usuarioC,
    agenteA,
    agenteB,
    registro: registro.insertId,
    portal: { tenantId: null, empresaId: null, sitioId: null },
    scopeA: organizacionA,
    scopeB: organizacionB,
    scopeC: organizacionC
  });
}

async function crearOrganizacion(sql, sufijo) {
  const [tenant] = await sql.ejecutar(
    'INSERT INTO tenants (nombre,alias) VALUES (?,?)',
    [`Tenant ${sufijo}`, `tenant-5283b-${sufijo}`]
  );
  const [empresa] = await sql.ejecutar(
    'INSERT INTO empresas (tenant_id,nombre,alias) VALUES (?,?,?)',
    [tenant.insertId, `Empresa ${sufijo}`, `empresa-5283b-${sufijo}`]
  );
  const [sitio] = await sql.ejecutar(
    'INSERT INTO sitios (tenant_id,empresa_id,nombre,alias) VALUES (?,?,?,?)',
    [tenant.insertId, empresa.insertId, `Sitio ${sufijo}`, `sitio-5283b-${sufijo}`]
  );
  return Object.freeze({
    tenantId: tenant.insertId,
    empresaId: empresa.insertId,
    sitioId: sitio.insertId
  });
}

async function crearUsuario(sql, sufijo, scope, permisos) {
  const columnas = permisos.length ? `,${permisos.join(',')}` : '';
  const valores = permisos.length ? `,${permisos.map(() => '1').join(',')}` : '';
  const [resultado] = await sql.ejecutar(
    `INSERT INTO usuarios (
       usuario,email,hash_password,tenant_id,empresa_id,sitio_id${columnas}
     ) VALUES (?,?,?,?,?,?${valores})`,
    [
      `usuario-${sufijo}-5283b`, `${sufijo}@example.test`, 'hash',
      scope.tenantId ?? null, scope.empresaId ?? null, scope.sitioId ?? null
    ]
  );
  return resultado.insertId;
}

async function crearAgente(sql, scope, sufijo) {
  const [resultado] = await sql.ejecutar(
    `INSERT INTO agentes_sentinelia (
       guid,tenant_id,empresa_id,sitio_id,nombre,secreto_hash
     ) VALUES (?,?,?,?,?,'hash')`,
    [
      generarUuidV7Auditoria(), scope.tenantId, scope.empresaId,
      scope.sitioId, `Agente ${sufijo}`
    ]
  );
  return resultado.insertId;
}

function contexto(idUsuario, scope, permisosActivos) {
  const permisos = Object.fromEntries(permisosActivos.map((permiso) => [permiso, true]));
  const nivelScope = scope.tenantId == null
    ? 'portal'
    : scope.empresaId == null
      ? 'tenant'
      : scope.sitioId == null ? 'empresa' : 'sitio';
  return Object.freeze({
    idUsuario,
    idUsuarioReal: idUsuario,
    nivelScope,
    esOperadorSistema: nivelScope === 'portal',
    tenantId: scope.tenantId,
    empresaId: scope.empresaId,
    sitioId: scope.sitioId,
    permisos: Object.freeze(permisos)
  });
}
