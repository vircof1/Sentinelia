import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import { RepositorioAudienciaTriggerCorreoSql }
  from '../paquetes/correo/src/RepositorioAudienciaTriggerCorreoSql.js';
import { ServicioReconciliacionBajaUsuarioTriggerCorreo }
  from '../paquetes/correo/src/ServicioReconciliacionBajaUsuarioTriggerCorreo.js';
import { validarEventoAuditableV1 }
  from '../paquetes/auditoria/src/ValidadorContratoAuditoria.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones }
  from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { FronteraTransaccionalLocal }
  from '../paquetes/persistencia-sql/src/FronteraTransaccionalLocal.js';
import { RepositorioMigraciones }
  from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import { RepositorioUsuarios }
  from '../paquetes/usuarios/src/RepositorioUsuarios.js';
import { ServicioUsuarios }
  from '../paquetes/usuarios/src/ServicioUsuarios.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true, '5.27.11a necesita MariaDB real.');
  const administrador = new ClienteSql(configuracion.sql);
  const nombre = `sentinelia_fixture_52711a_${randomBytes(5).toString('hex')}`;
  let sql;
  try {
    await administrador.ejecutar(
      `CREATE DATABASE ${administrador.escaparIdentificador(nombre)} ` +
        'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
    );
    sql = new ClienteSql({ ...configuracion.sql, baseDatos: nombre });
    const migraciones = await new EjecutorMigraciones({
      clienteSql: sql,
      repositorioMigraciones: new RepositorioMigraciones(sql),
      rutaMigraciones: obtenerRutaMigraciones()
    }).ejecutarPendientes();
    assert.equal(migraciones.integridad.ok, true);
    await prepararFixture(sql);
    await verificarReconciliacion(sql);
    await verificarRollback(sql);
    await verificarIntegracionBajaDirecta(sql);
    console.log(
      '[correo-trigger] OK 5.27.11a: baja_usuario=atomica fk=vinculos ' +
        'supervivientes=selectivos revision=avanza auditoria=scope_trigger rollback=integro'
    );
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(nombre)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

async function prepararFixture(sql) {
  await sql.ejecutar(`
    INSERT INTO tenants (id,nombre,alias) VALUES
      (7,'Tenant siete 52711a','tenant-siete-52711a'),
      (8,'Tenant ocho 52711a','tenant-ocho-52711a')
  `);
  await sql.ejecutar(`
    INSERT INTO usuarios (id,usuario,hash_password,activo,email,email_validado)
    VALUES
      (1,'objetivo-52711a','fixture',1,'objetivo@example.test',1),
      (2,'superviviente-52711a','fixture',1,'otro@example.test',1),
      (3,'rollback-52711a','fixture',1,'rollback@example.test',1)
  `);
  await sql.ejecutar(`
    INSERT INTO triggers (
      id,nombre,tipo,activo,revision_declaracion,tenant_id,configuracion
    ) VALUES
      (101,'Único objetivo','correo',1,1,NULL,JSON_OBJECT()),
      (102,'Con otro activo','correo',1,4,7,JSON_OBJECT()),
      (103,'Ya inactivo','correo',0,8,NULL,JSON_OBJECT()),
      (104,'Sólo dormido restante','correo',1,2,8,JSON_OBJECT()),
      (105,'Rollback','correo',1,6,NULL,JSON_OBJECT())
  `);
  await sql.ejecutar(`
    INSERT INTO destinatarios_triggers_correo (
      trigger_id,tipo,usuario_id,email_manual,email_manual_canonico,
      normalizacion_buzon_version,estado_participacion,
      causa_ultima_desuscripcion,desuscrita_en_utc,fecha_creacion_utc
    ) VALUES
      (101,'usuario',1,NULL,NULL,'buzon@1','activa',NULL,NULL,NOW(3)),
      (102,'usuario',1,NULL,NULL,'buzon@1','activa',NULL,NULL,NOW(3)),
      (102,'usuario',2,NULL,NULL,'buzon@1','activa',NULL,NULL,NOW(3)),
      (103,'usuario',1,NULL,NULL,'buzon@1','activa',NULL,NULL,NOW(3)),
      (104,'usuario',1,NULL,NULL,'buzon@1','activa',NULL,NULL,NOW(3)),
      (104,'manual',NULL,'dormido@example.test','dormido@example.test',
        'buzon@1','desuscrita','fixture',NOW(3),NOW(3)),
      (105,'usuario',3,NULL,NULL,'buzon@1','activa',NULL,NULL,NOW(3))
  `);
}

async function verificarReconciliacion(sql) {
  const auditoria = new AuditoriaFake();
  const servicio = crearServicio(auditoria);
  const resultado = await new FronteraTransaccionalLocal(sql).ejecutar(
    async (conexion) => {
      await conexion.execute('SELECT id FROM usuarios WHERE id = 1 FOR UPDATE');
      const preparacion = await servicio.prepararEnTransaccion(1, { conexion });
      assert.deepEqual(preparacion.triggers.map((item) => Number(item.id)),
        [101, 102, 103, 104]);
      await conexion.execute('DELETE FROM usuarios WHERE id = 1');
      return servicio.reconciliarEnTransaccion(
        preparacion,
        contextoOperador(),
        { conexion }
      );
    }
  );
  assert.equal(resultado.totalRelacionesRetiradas, 4);
  assert.equal(resultado.totalTriggersAfectados, 4);
  assert.equal(resultado.totalTriggersDesactivados, 2);
  assert.deepEqual(resultado.triggersDesactivados.map((item) => item.id),
    ['101', '104']);
  assert.deepEqual(await estadosTriggers(sql, [101, 102, 103, 104]), [
    [101, 0, 2],
    [102, 1, 4],
    [103, 0, 8],
    [104, 0, 3]
  ]);
  assert.equal(await escalar(sql,
    'SELECT COUNT(*) total FROM destinatarios_triggers_correo WHERE usuario_id = 1'), 0);
  assert.equal(auditoria.eventos.length, 2);
  assert.deepEqual(auditoria.eventos.map((evento) => evento.scope.tenantId),
    [null, '8']);
  assert.equal(JSON.stringify(auditoria.eventos).includes('objetivo@example.test'), false);
}

async function verificarRollback(sql) {
  const servicio = crearServicio(new AuditoriaFake());
  await assert.rejects(
    new FronteraTransaccionalLocal(sql).ejecutar(async (conexion) => {
      await conexion.execute('SELECT id FROM usuarios WHERE id = 3 FOR UPDATE');
      const preparacion = await servicio.prepararEnTransaccion(3, { conexion });
      await conexion.execute('DELETE FROM usuarios WHERE id = 3');
      await servicio.reconciliarEnTransaccion(
        preparacion,
        contextoOperador(),
        { conexion }
      );
      throw new Error('fallo_inyectado_52711a');
    }),
    /fallo_inyectado_52711a/u
  );
  assert.equal(await escalar(sql, 'SELECT COUNT(*) total FROM usuarios WHERE id = 3'), 1);
  assert.equal(await escalar(sql,
    'SELECT COUNT(*) total FROM destinatarios_triggers_correo WHERE usuario_id = 3'), 1);
  assert.deepEqual(await estadosTriggers(sql, [105]), [[105, 1, 6]]);
}

async function verificarIntegracionBajaDirecta(sql) {
  const auditoria = new AuditoriaFake();
  const repositorioReal = new RepositorioUsuarios(sql);
  const repositorioUsuarios = {
    buscarPorIdParaAdministracion: (_contexto, id) =>
      repositorioReal.buscarPorId(id),
    buscarPorIdEnTransaccion: (...argumentos) =>
      repositorioReal.buscarPorIdEnTransaccion(...argumentos),
    eliminarPorIdEnTransaccion: (...argumentos) =>
      repositorioReal.eliminarPorIdEnTransaccion(...argumentos)
  };
  const servicio = new ServicioUsuarios({
    repositorioUsuarios,
    repositorioTenants: {},
    repositorioEmpresas: {},
    repositorioSitios: {},
    servicioAutenticacion: {},
    servicioAutorizacion: {},
    servicioSesion: {
      async limpiarEstadoUsuario() { return { limpio: true }; }
    },
    resolutorScopeUsuario: {},
    validadorJerarquiaUsuario: { assertNoAutoEliminacion() {} },
    asignadorPermisosUsuario: {},
    servicioEstadoSensibleUsuario: {
      async ejecutarConExclusion(_id, operacion) {
        return { resultado: await operacion(), limpieza: { completa: true } };
      }
    },
    repositorioSesionesWebAuditoria: {
      async invalidarVigentesPorUsuariosEnTransaccion() { return []; }
    },
    fronteraTransaccional: new FronteraTransaccionalLocal(sql),
    servicioAuditoria: auditoria,
    servicioReconciliacionBajaUsuarioTriggerCorreo: crearServicio(auditoria)
  });
  servicio.assertUsuarioConJerarquiaValida = () => {};
  servicio.assertCoberturaAdministrativaCritica = async () => {};
  const resultado = await servicio.eliminarUsuario(contextoOperador(), 3);
  assert.equal(resultado.eliminado, true);
  assert.equal(resultado.reconciliacionCorreo.totalRelacionesRetiradas, 1);
  assert.equal(resultado.reconciliacionCorreo.totalTriggersDesactivados, 1);
  assert.deepEqual(await estadosTriggers(sql, [105]), [[105, 0, 7]]);
  assert.equal(await escalar(sql, 'SELECT COUNT(*) total FROM usuarios WHERE id = 3'), 0);
  const eventoUsuario = auditoria.eventos.find((evento) =>
    evento.tipo === 'usuario.eliminado');
  assert.equal(eventoUsuario.payload.impactoResumen.referenciasDesacopladas, '1');
}

function crearServicio(auditoria) {
  return new ServicioReconciliacionBajaUsuarioTriggerCorreo({
    repositorioAudiencia: new RepositorioAudienciaTriggerCorreoSql(),
    servicioAuditoria: auditoria,
    ahora: () => new Date('2026-09-03T12:00:00.000Z')
  });
}

class AuditoriaFake {
  constructor() { this.eventos = []; }
  async registrarEnTransaccion({ intencion }) {
    validarEventoAuditableV1({
      tipo: intencion.tipo,
      actor: intencion.actorReal.tipo,
      origen: intencion.origen,
      sujeto: intencion.sujeto,
      flujo: intencion.flujo,
      productor: intencion.productor,
      rolEvento: intencion.rolEvento,
      payload: intencion.payload
    });
    this.eventos.push(intencion);
    return { eventoId: intencion.eventoId };
  }
  async registrarMovimientoEnTransaccion() { return null; }
}

function contextoOperador() {
  return { idUsuario: 99, idUsuarioReal: 99, impersonacionActiva: false };
}

async function estadosTriggers(sql, ids) {
  const filas = await sql.consultar(`
    SELECT id, activo, revision_declaracion
      FROM triggers
     WHERE id IN (${ids.map(() => '?').join(',')})
     ORDER BY id ASC
  `, ids);
  return filas.map((fila) => [
    Number(fila.id),
    Number(fila.activo),
    Number(fila.revision_declaracion)
  ]);
}

async function escalar(sql, consulta) {
  return Number((await sql.consultar(consulta))[0]?.total || 0);
}

await main();
