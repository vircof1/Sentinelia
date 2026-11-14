import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import { RepositorioAuditoria } from '../paquetes/auditoria/src/RepositorioAuditoria.js';
import { ServicioAuditoriaOperativa }
  from '../paquetes/auditoria/src/ServicioAuditoriaOperativa.js';
import { generarUuidV7Auditoria }
  from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import {
  PERFILES_DDNS_AGENTES,
  VERSION_CONTRATO_DDNS_AGENTES
} from '../paquetes/dns/src/ContratoDdnsAgentes.js';
import { RepositorioConcesionesDdnsAgentes }
  from '../paquetes/dns/src/RepositorioConcesionesDdnsAgentes.js';
import { ServicioAplicacionDdnsAgentes }
  from '../paquetes/dns/src/ServicioAplicacionDdnsAgentes.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones }
  from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import { RepositorioUsuarios } from '../paquetes/usuarios/src/RepositorioUsuarios.js';
import { obtenerConfiguracionAplicacion, obtenerRutaMigraciones }
  from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

await main();

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true, '5.28.10a necesita MariaDB real.');
  const administrador = new ClienteSql(configuracion.sql);
  const base = `sentinelia_fixture_52810a_${randomBytes(5).toString('hex')}`;
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
    await verificarMovimientos(sql);
    console.log(
      '[dns-ddns] OK 5.28.10a: agente+registro fotografiados ' +
      'version+modo+contenido=estables permisos=joins-vivos auditoria=salida+entrada'
    );
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(base)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

async function verificarMovimientos(sql) {
  const a = await crearOrganizacion(sql, 'a');
  const b = await crearOrganizacion(sql, 'b');
  const c = await crearOrganizacion(sql, 'c');
  const usuarioPortal = await crearUsuario(sql, 'portal', {}, [
    'permiso_modificar_agentes', 'permiso_administrar_dns_avanzado'
  ]);
  const usuarioA = await crearUsuario(sql, 'a', a, ['permiso_administrar_dns_avanzado']);
  const usuarioB = await crearUsuario(sql, 'b', b, ['permiso_administrar_dns_avanzado']);
  const agente = await crearAgente(sql, a);
  const [zona] = await sql.ejecutar(
    `INSERT INTO zonas_dns (
       tenant_id,empresa_id,sitio_id,nombre_zona,soa_mname,soa_rname
     ) VALUES (?,?,?,?,?,?)`,
    [b.tenantId, b.empresaId, b.sitioId, 'scope-52810a.example.',
      'ns.example.', 'hostmaster.example.']
  );
  const [registro] = await sql.ejecutar(
    `INSERT INTO registros_dns (
       zona_id,tenant_id,empresa_id,sitio_id,host_relativo,tipo_registro,
       valor_principal,categoria_origen
     ) VALUES (?,?,?,?,'host','A','192.0.2.10','ddns')`,
    [zona.insertId, b.tenantId, b.empresaId, b.sitioId]
  );
  const repositorio = new RepositorioConcesionesDdnsAgentes(sql);
  const servicio = new ServicioAplicacionDdnsAgentes({
    clienteSql: sql,
    repositorioUsuarios: new RepositorioUsuarios(sql),
    repositorioConcesiones: repositorio,
    servicioAuditoria: new ServicioAuditoriaOperativa({
      repositorioAuditoria: new RepositorioAuditoria(sql)
    })
  });
  const concesion = await repositorio.crearConcesion({
    concesionId: generarUuidV7Auditoria(),
    agenteId: agente,
    registroDnsId: registro.insertId
  });

  await transaccion(sql, async (conexion) => {
    await conexion.execute(
      'UPDATE agentes_sentinelia SET tenant_id=?,empresa_id=?,sitio_id=? WHERE id=?',
      [c.tenantId, c.empresaId, c.sitioId, agente]
    );
    await servicio.actualizarScopeAgenteEnTransaccion({
      contextoUsuarioActual: contexto(usuarioPortal, {}, []),
      agenteId: agente,
      scopePosterior: c
    }, { conexion });
  });

  const aceptada = await servicio.aceptarIntencionExplicita({
    contextoSesionTecnica: { sesion: { agenteId: String(agente) } },
    concesionId: concesion.concesionId,
    solicitud: solicitudObservada('0')
  });
  assert.equal(aceptada.resultado, 'aceptada');
  const antesZona = await repositorio.buscarPorConcesionId(concesion.concesionId);

  await transaccion(sql, async (conexion) => {
    await conexion.execute(
      'UPDATE zonas_dns SET tenant_id=?,empresa_id=?,sitio_id=? WHERE id=?',
      [a.tenantId, a.empresaId, a.sitioId, zona.insertId]
    );
    await conexion.execute(
      'UPDATE registros_dns SET tenant_id=?,empresa_id=?,sitio_id=? WHERE zona_id=?',
      [a.tenantId, a.empresaId, a.sitioId, zona.insertId]
    );
    await servicio.actualizarScopeRegistrosZonaEnTransaccion({
      contextoUsuarioActual: contexto(usuarioPortal, {}, []),
      zonaId: zona.insertId,
      scopePosterior: a
    }, { conexion });
  });

  const despues = await repositorio.buscarPorConcesionId(concesion.concesionId);
  assert.deepEqual(despues.scopeAgente, scopeTexto(c));
  assert.deepEqual(despues.scopeRegistro, scopeTexto(a));
  assert.deepEqual(
    [despues.version, despues.modo, despues.contenidoDeseado],
    [antesZona.version, antesZona.modo, antesZona.contenidoDeseado]
  );

  await assert.rejects(
    servicio.revocarDesdeRegistro({
      contextoUsuarioActual: contexto(usuarioB, b, ['administrarDnsAvanzado']),
      registroDnsId: registro.insertId,
      concesionId: concesion.concesionId
    }),
    /autoridad|alcance|concesión/u
  );
  const revocada = await servicio.revocarDesdeRegistro({
    contextoUsuarioActual: contexto(usuarioA, a, ['administrarDnsAvanzado']),
    registroDnsId: registro.insertId,
    concesionId: concesion.concesionId
  });
  assert.equal(revocada.efectuada, true);

  const eventos = await sql.consultar(
    `SELECT tipo_evento,correlacion_id,scope_tenant_id,scope_empresa_id,
            scope_sitio_id,payload
       FROM eventos_auditoria
      WHERE tipo_evento='ddns.concesion_scope_actualizado'
      ORDER BY secuencia`
  );
  assert.equal(eventos.length, 4);
  const grupos = Map.groupBy(eventos, (evento) => Buffer.from(evento.correlacion_id).toString('hex'));
  assert.deepEqual([...grupos.values()].map((grupo) => grupo.length).sort(), [2, 2]);
  assert.deepEqual(
    eventos.map((evento) => String(evento.scope_tenant_id)).sort(),
    [String(a.tenantId), String(a.tenantId), String(b.tenantId), String(c.tenantId)].sort()
  );
  assert.equal(eventos.every((evento) => JSON.stringify(evento.payload).includes('scope_actualizado')), true);
}

function solicitudObservada(versionEsperada) {
  return {
    perfil: PERFILES_DDNS_AGENTES.SOLICITUD,
    versionContrato: VERSION_CONTRATO_DDNS_AGENTES,
    solicitudId: generarUuidV7Auditoria(),
    versionEsperada,
    estadoDeseado: {
      perfil: PERFILES_DDNS_AGENTES.ESTADO_DESEADO,
      versionContrato: VERSION_CONTRATO_DDNS_AGENTES,
      tipo: 'A',
      modo: 'observada',
      valor: null
    }
  };
}

async function crearOrganizacion(sql, sufijo) {
  const [tenant] = await sql.ejecutar(
    'INSERT INTO tenants (nombre,alias) VALUES (?,?)',
    [`Tenant ${sufijo}`, `tenant-52810a-${sufijo}`]
  );
  const [empresa] = await sql.ejecutar(
    'INSERT INTO empresas (tenant_id,nombre,alias) VALUES (?,?,?)',
    [tenant.insertId, `Empresa ${sufijo}`, `empresa-52810a-${sufijo}`]
  );
  const [sitio] = await sql.ejecutar(
    'INSERT INTO sitios (tenant_id,empresa_id,nombre,alias) VALUES (?,?,?,?)',
    [tenant.insertId, empresa.insertId, `Sitio ${sufijo}`, `sitio-52810a-${sufijo}`]
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
    [`usuario-${sufijo}-52810a`, `${sufijo}@example.test`, 'hash',
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
      scope.sitioId, 'Agente 5.28.10a']
  );
  return resultado.insertId;
}

function contexto(idUsuario, scope, permisosActivos) {
  const permisos = Object.fromEntries(permisosActivos.map((permiso) => [permiso, true]));
  const nivelScope = scope.tenantId == null
    ? 'portal'
    : scope.empresaId == null ? 'tenant' : scope.sitioId == null ? 'empresa' : 'sitio';
  return Object.freeze({
    idUsuario,
    idUsuarioReal: idUsuario,
    nivelScope,
    esOperadorSistema: nivelScope === 'portal',
    tenantId: scope.tenantId ?? null,
    empresaId: scope.empresaId ?? null,
    sitioId: scope.sitioId ?? null,
    permisos: Object.freeze(permisos)
  });
}

function scopeTexto(scope) {
  return {
    tenantId: String(scope.tenantId),
    empresaId: String(scope.empresaId),
    sitioId: String(scope.sitioId)
  };
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
