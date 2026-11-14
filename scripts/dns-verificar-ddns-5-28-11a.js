import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import { generarUuidV7Auditoria }
  from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import { RepositorioConcesionesDdnsAgentes }
  from '../paquetes/dns/src/RepositorioConcesionesDdnsAgentes.js';
import { ServicioConsultaAdministrativaDdnsAgentes }
  from '../paquetes/dns/src/ServicioConsultaAdministrativaDdnsAgentes.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones }
  from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import { obtenerConfiguracionAplicacion, obtenerRutaMigraciones }
  from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

await main();

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true, '5.28.11a necesita MariaDB real.');
  const administrador = new ClienteSql(configuracion.sql);
  const base = `sentinelia_fixture_52811a_${randomBytes(5).toString('hex')}`;
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
    const servicio = new ServicioConsultaAdministrativaDdnsAgentes({ clienteSql: sql });
    await verificarFichas(servicio, fixture);
    await verificarSelector(servicio, fixture);
    await verificarNoEnumeracion(servicio, fixture);
    console.log(
      '[dns-ddns] OK 5.28.11a: fichas=agente+dns ' +
      'contraparte=completa+restringida selector=doble_autoridad ' +
      'tipos=A+AAAA+CNAME+MX inactivo=no_operable filtros=cerrados no_enumeracion=403'
    );
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(base)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

async function verificarFichas(servicio, fixture) {
  const portal = contexto(fixture.usuarios.portal, fixture.portal, [
    'verAgentes', 'verDns'
  ]);
  const desdeAgentePortal = await servicio.listarPorAgente({
    contextoUsuarioActual: portal,
    agenteId: fixture.agenteA
  });
  assert.equal(desdeAgentePortal.length, 1);
  assert.equal(desdeAgentePortal[0].agente.restringido, false);
  assert.equal(desdeAgentePortal[0].registro.restringido, false);

  const desdeAgenteAcotado = await servicio.listarPorAgente({
    contextoUsuarioActual: contexto(fixture.usuarios.a, fixture.scopeA, ['verAgentes']),
    agenteId: fixture.agenteA
  });
  assert.deepEqual(desdeAgenteAcotado[0].registro, {
    restringido: true,
    tipo: 'registro_dns'
  });

  const desdeRegistroAcotado = await servicio.listarPorRegistro({
    contextoUsuarioActual: contexto(fixture.usuarios.b, fixture.scopeB, ['verDns']),
    registroDnsId: fixture.registroCruzado
  });
  assert.deepEqual(desdeRegistroAcotado[0].agente, {
    restringido: true,
    tipo: 'agente'
  });
}

async function verificarSelector(servicio, fixture) {
  const propios = await servicio.listarCandidatosParaAgente({
    contextoUsuarioActual: contexto(
      fixture.usuarios.a,
      fixture.scopeA,
      ['modificarAgentes', 'administrarDnsAvanzado']
    ),
    agenteId: fixture.agenteA
  });
  assert.deepEqual(propios.map(({ tipoRegistro }) => tipoRegistro).sort(), [
    'A', 'AAAA', 'CNAME', 'MX'
  ]);
  const inactivo = propios.find(({ tipoRegistro }) => tipoRegistro === 'AAAA');
  assert.equal(inactivo.activo, false);
  assert.equal(inactivo.operable, false);
  assert.equal(propios.every(({ scope }) => scope.sitioId === String(fixture.scopeA.sitioId)), true);

  const impersonado = await servicio.listarCandidatosParaAgente({
    contextoUsuarioActual: {
      ...contexto(
        fixture.usuarios.a,
        fixture.scopeA,
        ['modificarAgentes', 'administrarDnsAvanzado']
      ),
      idUsuarioReal: fixture.usuarios.portal
    },
    agenteId: fixture.agenteA
  });
  assert.deepEqual(
    impersonado.map(({ registroDnsId }) => registroDnsId),
    propios.map(({ registroDnsId }) => registroDnsId),
    'la autoridad efectiva acotada limita a la real de portal'
  );
}

async function verificarNoEnumeracion(servicio, fixture) {
  const ajeno = contexto(fixture.usuarios.c, fixture.scopeC, ['verAgentes', 'verDns']);
  for (const agenteId of [fixture.agenteA, '999999']) {
    await assert.rejects(
      servicio.listarPorAgente({ contextoUsuarioActual: ajeno, agenteId }),
      (error) => error.codigo === 'autoridad_insuficiente' && error.statusCode === 403
    );
  }
  await assert.rejects(
    servicio.listarCandidatosParaAgente({
      contextoUsuarioActual: contexto(
        fixture.usuarios.parcial,
        fixture.scopeA,
        ['modificarAgentes']
      ),
      agenteId: fixture.agenteA
    }),
    (error) => error.codigo === 'autoridad_insuficiente'
  );
}

async function crearFixture(sql) {
  const scopeA = await crearOrganizacion(sql, 'a');
  const scopeB = await crearOrganizacion(sql, 'b');
  const scopeC = await crearOrganizacion(sql, 'c');
  const permisosDobles = [
    'permiso_modificar_agentes', 'permiso_administrar_dns_avanzado',
    'permiso_ver_agentes', 'permiso_ver_dns'
  ];
  const usuarios = {
    portal: await crearUsuario(sql, 'portal', {}, permisosDobles),
    a: await crearUsuario(sql, 'a', scopeA, permisosDobles),
    b: await crearUsuario(sql, 'b', scopeB, ['permiso_ver_dns']),
    parcial: await crearUsuario(sql, 'parcial', scopeA, [
      'permiso_modificar_agentes'
    ]),
    c: await crearUsuario(sql, 'c', scopeC, [
      'permiso_ver_agentes', 'permiso_ver_dns'
    ])
  };
  const agenteA = await crearAgente(sql, scopeA);
  const zonaA = await crearZona(sql, scopeA, 'a');
  const zonaB = await crearZona(sql, scopeB, 'b');
  const registroCruzado = await crearRegistro(sql, zonaB, scopeB, {
    host: 'entregado', tipo: 'A', valor: '192.0.2.210'
  });
  await new RepositorioConcesionesDdnsAgentes(sql).crearConcesion({
    concesionId: generarUuidV7Auditoria(),
    agenteId: agenteA,
    registroDnsId: registroCruzado
  });

  for (const entrada of [
    { host: 'a-activo', tipo: 'A', valor: '192.0.2.211' },
    { host: 'aaaa-inactivo', tipo: 'AAAA', valor: '2001:db8::211', activo: false },
    { host: 'alias', tipo: 'CNAME', valor: 'destino.example.' },
    { host: 'correo', tipo: 'MX', valor: 'mail.example.', prioridad: 10 }
  ]) {
    await crearRegistro(sql, zonaA, scopeA, entrada);
  }
  await crearRegistro(sql, zonaB, scopeB, {
    host: 'fuera-scope', tipo: 'A', valor: '192.0.2.212'
  });
  await crearRegistro(sql, zonaA, scopeA, {
    host: 'trigger', tipo: 'A', valor: '192.0.2.213',
    datosAuxiliares: JSON.stringify({ gobernadoPor: 'trigger' })
  });
  await crearRegistro(sql, zonaA, scopeA, {
    host: 'manual', tipo: 'A', valor: '192.0.2.214', categoria: 'manual'
  });
  const zonaInactiva = await crearZona(sql, scopeA, 'inactiva', false);
  await crearRegistro(sql, zonaInactiva, scopeA, {
    host: 'zona-inactiva', tipo: 'A', valor: '192.0.2.215'
  });
  return Object.freeze({
    usuarios: Object.freeze(usuarios),
    agenteA,
    registroCruzado,
    scopeA,
    scopeB,
    scopeC,
    portal: Object.freeze({ tenantId: null, empresaId: null, sitioId: null })
  });
}

async function crearOrganizacion(sql, sufijo) {
  const [tenant] = await sql.ejecutar(
    'INSERT INTO tenants (nombre,alias) VALUES (?,?)',
    [`Tenant ${sufijo} 11a`, `tenant-${sufijo}-52811a`]
  );
  const [empresa] = await sql.ejecutar(
    'INSERT INTO empresas (tenant_id,nombre,alias) VALUES (?,?,?)',
    [tenant.insertId, `Empresa ${sufijo} 11a`, `empresa-${sufijo}-52811a`]
  );
  const [sitio] = await sql.ejecutar(
    'INSERT INTO sitios (tenant_id,empresa_id,nombre,alias) VALUES (?,?,?,?)',
    [tenant.insertId, empresa.insertId, `Sitio ${sufijo} 11a`,
      `sitio-${sufijo}-52811a`]
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
    [`usuario-${sufijo}-52811a`, `${sufijo}@example.test`, 'hash',
      scope.tenantId ?? null, scope.empresaId ?? null, scope.sitioId ?? null]
  );
  return resultado.insertId;
}

async function crearAgente(sql, scope) {
  const [resultado] = await sql.ejecutar(
    `INSERT INTO agentes_sentinelia (
       guid,tenant_id,empresa_id,sitio_id,nombre,secreto_hash
     ) VALUES (?,?,?,?,?,'hash')`,
    [generarUuidV7Auditoria(), scope.tenantId, scope.empresaId,
      scope.sitioId, 'Agente 5.28.11a']
  );
  return resultado.insertId;
}

async function crearZona(sql, scope, sufijo, activa = true) {
  const [resultado] = await sql.ejecutar(
    `INSERT INTO zonas_dns (
       tenant_id,empresa_id,sitio_id,nombre_zona,soa_mname,soa_rname,activo
     ) VALUES (?,?,?,?,?,?,?)`,
    [scope.tenantId, scope.empresaId, scope.sitioId,
      `${sufijo}.52811a.example.`, 'ns.example.', 'hostmaster.example.', activa ? 1 : 0]
  );
  return resultado.insertId;
}

async function crearRegistro(sql, zonaId, scope, {
  host,
  tipo,
  valor,
  activo = true,
  prioridad = null,
  categoria = 'ddns',
  datosAuxiliares = null
}) {
  const [resultado] = await sql.ejecutar(
    `INSERT INTO registros_dns (
       zona_id,tenant_id,empresa_id,sitio_id,host_relativo,tipo_registro,
       valor_principal,prioridad,categoria_origen,datos_auxiliares,activo
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [zonaId, scope.tenantId, scope.empresaId, scope.sitioId,
      host, tipo, valor, prioridad, categoria, datosAuxiliares, activo ? 1 : 0]
  );
  return resultado.insertId;
}

function contexto(idUsuario, scope, permisosActivos) {
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
    permisos: Object.freeze(Object.fromEntries(
      permisosActivos.map((permiso) => [permiso, true])
    ))
  });
}
