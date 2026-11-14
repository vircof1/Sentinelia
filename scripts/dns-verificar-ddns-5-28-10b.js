import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import { RepositorioAuditoria } from '../paquetes/auditoria/src/RepositorioAuditoria.js';
import { RepositorioOutboxAuditoriaRuntime }
  from '../paquetes/auditoria/src/RepositorioOutboxAuditoriaRuntime.js';
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
import { RepositorioCoordinacionGeneracionesDns }
  from '../paquetes/dns/src/RepositorioCoordinacionGeneracionesDns.js';
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
  assert.equal(configuracion.sql.estaCompleta, true, '5.28.10b necesita MariaDB real.');
  const administrador = new ClienteSql(configuracion.sql);
  const base = `sentinelia_fixture_52810b_${randomBytes(5).toString('hex')}`;
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
    await verificarCicloObjetivos(sql);
    console.log(
      '[dns-ddns] OK 5.28.10b: incompatibilidad=cierre ' +
      'eliminacion=terminal+desacople zona=sin_cascada_decisoria pausa=reversible'
    );
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(base)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

async function verificarCicloObjetivos(sql) {
  const fixture = await crearFixture(sql);
  const repositorio = new RepositorioConcesionesDdnsAgentes(sql);
  const servicio = new ServicioAplicacionDdnsAgentes({
    clienteSql: sql,
    repositorioUsuarios: new RepositorioUsuarios(sql),
    repositorioConcesiones: repositorio,
    repositorioCoordinacionGeneracionesDns:
      new RepositorioCoordinacionGeneracionesDns({
        clienteSql: sql,
        bloquearCatalogoEnTransaccion
      }),
    servicioAuditoria: new ServicioAuditoriaOperativa({
      repositorioAuditoria: new RepositorioAuditoria(sql)
    }),
    repositorioOutboxAuditoria: new RepositorioOutboxAuditoriaRuntime(sql)
  });
  const contexto = contextoPortal(fixture.usuario);

  const incompatible = await concederYDeclarar({
    servicio, repositorio, fixture, registroId: fixture.registros[0]
  });
  await transaccion(sql, async (conexion) => {
    await servicio.cerrarObjetivoRegistroEnTransaccion({
      contextoUsuarioActual: contexto,
      registroDnsId: fixture.registros[0],
      terminal: 'objetivo_incompatible'
    }, { conexion });
    await conexion.execute(
      "UPDATE registros_dns SET tipo_registro='AAAA' WHERE id=?",
      [fixture.registros[0]]
    );
  });
  await verificarTerminal(sql, incompatible, 'objetivo_incompatible', false);
  await sql.ejecutar(
    "UPDATE registros_dns SET tipo_registro='A',categoria_origen='ddns' WHERE id=?",
    [fixture.registros[0]]
  );
  const historica = await repositorio.buscarPorConcesionId(incompatible.concesionId);
  assert.equal(historica.estado, 'revocada', 'recrear compatibilidad no reabre autoridad');

  const eliminada = await concederYDeclarar({
    servicio, repositorio, fixture, registroId: fixture.registros[1]
  });
  await transaccion(sql, async (conexion) => {
    await servicio.cerrarObjetivoRegistroEnTransaccion({
      contextoUsuarioActual: contexto,
      registroDnsId: fixture.registros[1],
      terminal: 'objetivo_eliminado',
      desacoplar: true
    }, { conexion });
    await conexion.execute('DELETE FROM registros_dns WHERE id=?', [fixture.registros[1]]);
  });
  await verificarTerminal(sql, eliminada, 'objetivo_eliminado', true);

  const porZona = await concederYDeclarar({
    servicio, repositorio, fixture, registroId: fixture.registros[2]
  });
  await transaccion(sql, async (conexion) => {
    await servicio.cerrarObjetivosZonaEnTransaccion({
      contextoUsuarioActual: contexto,
      zonaId: fixture.zonaId
    }, { conexion });
    await conexion.execute('DELETE FROM zonas_dns WHERE id=?', [fixture.zonaId]);
  });
  await verificarTerminal(sql, porZona, 'objetivo_eliminado', true);

  const [pausa] = await sql.ejecutar(
    `INSERT INTO zonas_dns (tenant_id,empresa_id,sitio_id,nombre_zona,soa_mname,soa_rname)
     VALUES (?,?,?,?,?,?)`,
    [fixture.scope.tenantId, fixture.scope.empresaId, fixture.scope.sitioId,
      'pausa-52810b.example.', 'ns.example.', 'hostmaster.example.']
  );
  const [registroPausa] = await sql.ejecutar(
    `INSERT INTO registros_dns (
       zona_id,tenant_id,empresa_id,sitio_id,host_relativo,tipo_registro,
       valor_principal,categoria_origen
     ) VALUES (?,?,?,?,'host','A','192.0.2.40','ddns')`,
    [pausa.insertId, fixture.scope.tenantId, fixture.scope.empresaId,
      fixture.scope.sitioId]
  );
  const concesionPausa = await repositorio.crearConcesion({
    concesionId: generarUuidV7Auditoria(),
    agenteId: fixture.agenteId,
    registroDnsId: registroPausa.insertId
  });
  await transaccion(sql, (conexion) =>
    servicio.sincronizarOperabilidadRegistroEnTransaccion({
      registroDnsId: registroPausa.insertId,
      operable: false
    }, { conexion })
  );
  assert.equal(
    (await repositorio.buscarPorConcesionId(concesionPausa.concesionId)).estado,
    'vigente'
  );

  const outbox = await sql.consultar(
    `SELECT payload FROM outbox_auditoria_runtime
      WHERE tipo_evento = 'ddns.intencion_terminada'`
  );
  assert.equal(outbox.length, 3);
}

async function concederYDeclarar({ servicio, repositorio, fixture, registroId }) {
  const concesion = await repositorio.crearConcesion({
    concesionId: generarUuidV7Auditoria(),
    agenteId: fixture.agenteId,
    registroDnsId: registroId
  });
  const resultado = await servicio.aceptarIntencionExplicita({
    contextoSesionTecnica: { sesion: { agenteId: String(fixture.agenteId) } },
    concesionId: concesion.concesionId,
    solicitud: solicitudDeclarada()
  });
  assert.equal(resultado.resultado, 'aceptada');
  return repositorio.buscarPorConcesionId(concesion.concesionId);
}

async function verificarTerminal(sql, concesion, terminal, desacoplada) {
  const [fila] = await sql.consultar(
    `SELECT c.estado,c.causa_cierre,c.registro_dns_id,
            CAST(c.version_ddns AS CHAR) version_ddns,i.terminal,p.estado intento
       FROM concesiones_ddns_agentes c
       JOIN intenciones_ddns_agentes i ON i.id=c.intencion_gobernante_id
       JOIN intentos_publicacion_ddns p ON p.intencion_interna_id=i.id
      WHERE c.id=?`,
    [concesion.idInterno]
  );
  assert.equal(fila.estado, 'revocada');
  assert.equal(fila.terminal, terminal);
  assert.equal(fila.intento, terminal);
  assert.equal(fila.version_ddns, concesion.version);
  assert.equal(fila.registro_dns_id === null, desacoplada);
}

async function crearFixture(sql) {
  const [tenant] = await sql.ejecutar(
    "INSERT INTO tenants (nombre,alias) VALUES ('Tenant 5.28.10b','tenant-52810b')"
  );
  const [empresa] = await sql.ejecutar(
    "INSERT INTO empresas (tenant_id,nombre,alias) VALUES (?,'Empresa 5.28.10b','empresa-52810b')",
    [tenant.insertId]
  );
  const [sitio] = await sql.ejecutar(
    "INSERT INTO sitios (tenant_id,empresa_id,nombre,alias) VALUES (?,?,'Sitio 5.28.10b','sitio-52810b')",
    [tenant.insertId, empresa.insertId]
  );
  const scope = { tenantId: tenant.insertId, empresaId: empresa.insertId, sitioId: sitio.insertId };
  const [usuario] = await sql.ejecutar(
    `INSERT INTO usuarios (usuario,email,hash_password,permiso_administrar_dns_avanzado)
     VALUES ('portal-52810b','portal@example.test','hash',1)`
  );
  const [agente] = await sql.ejecutar(
    `INSERT INTO agentes_sentinelia (
       guid,tenant_id,empresa_id,sitio_id,nombre,secreto_hash
     ) VALUES (?,?,?,?,?,'hash')`,
    [generarUuidV7Auditoria(), tenant.insertId, empresa.insertId,
      sitio.insertId, 'Agente 5.28.10b']
  );
  const [zona] = await sql.ejecutar(
    `INSERT INTO zonas_dns (
       tenant_id,empresa_id,sitio_id,nombre_zona,soa_mname,soa_rname
     ) VALUES (?,?,?,?,?,?)`,
    [tenant.insertId, empresa.insertId, sitio.insertId,
      'objetivos-52810b.example.', 'ns.example.', 'hostmaster.example.']
  );
  const registros = [];
  for (let indice = 1; indice <= 3; indice += 1) {
    const [registro] = await sql.ejecutar(
      `INSERT INTO registros_dns (
         zona_id,tenant_id,empresa_id,sitio_id,host_relativo,tipo_registro,
         valor_principal,categoria_origen
       ) VALUES (?,?,?,?,?,'A',?,'ddns')`,
      [zona.insertId, tenant.insertId, empresa.insertId, sitio.insertId,
        `host-${indice}`, `192.0.2.${indice}`]
    );
    registros.push(registro.insertId);
  }
  return Object.freeze({
    usuario: usuario.insertId,
    agenteId: agente.insertId,
    zonaId: zona.insertId,
    registros: Object.freeze(registros),
    scope: Object.freeze(scope)
  });
}

function solicitudDeclarada() {
  return {
    perfil: PERFILES_DDNS_AGENTES.SOLICITUD,
    versionContrato: VERSION_CONTRATO_DDNS_AGENTES,
    solicitudId: generarUuidV7Auditoria(),
    versionEsperada: '0',
    estadoDeseado: {
      perfil: PERFILES_DDNS_AGENTES.ESTADO_DESEADO,
      versionContrato: VERSION_CONTRATO_DDNS_AGENTES,
      tipo: 'A',
      modo: 'declarada',
      valor: { direccionIpv4: '192.0.2.100' }
    }
  };
}

function contextoPortal(idUsuario) {
  return Object.freeze({
    idUsuario,
    idUsuarioReal: idUsuario,
    nivelScope: 'portal',
    esOperadorSistema: true,
    tenantId: null,
    empresaId: null,
    sitioId: null,
    permisos: Object.freeze({ administrarDnsAvanzado: true })
  });
}

async function bloquearCatalogoEnTransaccion({ conexion }) {
  await conexion.execute('SELECT id FROM zonas_dns ORDER BY id FOR UPDATE');
  await conexion.execute('SELECT id FROM registros_dns ORDER BY zona_id,id FOR UPDATE');
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
