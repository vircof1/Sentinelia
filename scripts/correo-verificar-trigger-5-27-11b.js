import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import { validarEventoAuditableV1 }
  from '../paquetes/auditoria/src/ValidadorContratoAuditoria.js';
import { generarUuidV7Auditoria }
  from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import { RepositorioAudienciaTriggerCorreoSql }
  from '../paquetes/correo/src/RepositorioAudienciaTriggerCorreoSql.js';
import { ServicioReconciliacionBajaUsuarioTriggerCorreo }
  from '../paquetes/correo/src/ServicioReconciliacionBajaUsuarioTriggerCorreo.js';
import { RepositorioEliminacionesOrganizativas }
  from '../paquetes/jerarquia-organizativa/src/RepositorioEliminacionesOrganizativas.js';
import { RepositorioImpactoEliminacionOrganizacionSql }
  from '../paquetes/jerarquia-organizativa/src/RepositorioImpactoEliminacionOrganizacionSql.js';
import { RepositorioInventarioFinalEliminacionOrganizacionSql }
  from '../paquetes/jerarquia-organizativa/src/RepositorioInventarioFinalEliminacionOrganizacionSql.js';
import { PreparadorEfectosEliminacionOrganizacionEnTransaccion }
  from '../paquetes/jerarquia-organizativa/src/PreparadorEfectosEliminacionOrganizacionEnTransaccion.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones }
  from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { FronteraTransaccionalLocal }
  from '../paquetes/persistencia-sql/src/FronteraTransaccionalLocal.js';
import { RepositorioMigraciones }
  from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true, '5.27.11b necesita MariaDB real.');
  const administrador = new ClienteSql(configuracion.sql);
  const nombre = `sentinelia_fixture_52711b_${randomBytes(5).toString('hex')}`;
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
    const impactoFinal = await verificarConteos(sql);
    await verificarPropagacionPreparacion(sql, impactoFinal);
    await verificarBajaOrganizativa(sql);
    await verificarRollback(sql);
    console.log(
      '[correo-trigger] OK 5.27.11b: inventario=visible_restringido ' +
        'lote=usuarios triggers_externos=reconciliados internos=cascada ' +
        'revision=selectiva auditoria=scope_propio rollback=integro'
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
      (7,'Tenant siete 52711b','tenant-siete-52711b'),
      (8,'Tenant ocho 52711b','tenant-ocho-52711b')
  `);
  await sql.ejecutar(`
    INSERT INTO empresas (id,tenant_id,nombre,alias) VALUES
      (70,7,'Empresa 70','empresa-70-52711b'),
      (80,8,'Empresa 80','empresa-80-52711b')
  `);
  await sql.ejecutar(`
    INSERT INTO sitios (id,tenant_id,empresa_id,nombre,alias) VALUES
      (701,7,70,'Raíz 701','raiz-701-52711b'),
      (702,7,70,'Hermano 702','hermano-702-52711b'),
      (703,7,70,'Rollback 703','rollback-703-52711b')
  `);
  await sql.ejecutar(`
    INSERT INTO usuarios (
      id,usuario,hash_password,activo,email,email_validado,
      tenant_id,empresa_id,sitio_id,permiso_ver_triggers
    ) VALUES
      (1,'objetivo-uno-52711b','fixture',1,'uno@example.test',1,7,70,701,0),
      (2,'externo-52711b','fixture',1,'externo@example.test',1,8,80,NULL,0),
      (5,'rollback-52711b','fixture',1,'rollback@example.test',1,7,70,703,0),
      (99,'actor-52711b','fixture',1,'actor@example.test',1,7,70,NULL,1)
  `);
  await sql.ejecutar(`
    INSERT INTO triggers (
      id,nombre,tipo,activo,revision_declaracion,
      tenant_id,empresa_id,sitio_id,configuracion
    ) VALUES
      (201,'Interno visible','correo',1,1,7,70,701,JSON_OBJECT()),
      (202,'Externo visible','correo',1,3,7,70,702,JSON_OBJECT()),
      (203,'Externo restringido compartido','correo',1,5,8,80,NULL,JSON_OBJECT()),
      (204,'Portal restringido','correo',1,7,NULL,NULL,NULL,JSON_OBJECT()),
      (205,'Externo rollback','correo',1,9,7,70,702,JSON_OBJECT())
  `);
  await sql.ejecutar(`
    INSERT INTO destinatarios_triggers_correo (trigger_id,tipo,usuario_id)
    VALUES
      (201,'usuario',1),(202,'usuario',1),(203,'usuario',1),
      (203,'usuario',2),(204,'usuario',1),(205,'usuario',5)
  `);
}

async function verificarConteos(sql) {
  const sujeto = { tipo: 'sitio', id: '701' };
  const previo = await new RepositorioImpactoEliminacionOrganizacionSql(sql)
    .cargarConteos({ sujeto, actorEfectivoId: '99' });
  assert.equal(conteo(previo, 'audiencia_correo_visible'), '2');
  assert.equal(conteo(previo, 'audiencia_correo_restringida'), '2');
  assert.equal(
    conteo(previo, 'triggers_correo_supervivientes_desactivados'),
    '2'
  );
  await sql.ejecutar('UPDATE usuarios SET permiso_ver_triggers=0 WHERE id=99');
  const sinPermiso = await new RepositorioImpactoEliminacionOrganizacionSql(sql)
    .cargarConteos({ sujeto, actorEfectivoId: '99' });
  assert.equal(conteo(sinPermiso, 'audiencia_correo_visible'), '0');
  assert.equal(conteo(sinPermiso, 'audiencia_correo_restringida'), '4');
  await sql.ejecutar('UPDATE usuarios SET permiso_ver_triggers=1 WHERE id=99');
  const final = await new FronteraTransaccionalLocal(sql).ejecutar(
    (conexion) => new RepositorioInventarioFinalEliminacionOrganizacionSql()
      .cargarConteosFinalesEnTransaccion({
        sujeto,
        operacionId: generarUuidV7Auditoria(),
        actorEfectivoId: '99'
      }, { conexion })
  );
  assert.equal(conteo(final, 'audiencia_correo_visible'), '2');
  assert.equal(conteo(final, 'audiencia_correo_restringida'), '2');
  assert.equal(
    conteo(final, 'triggers_correo_supervivientes_desactivados'),
    '2'
  );
  return {
    perfil: 'sentinelia-eliminacion-organizacion-impacto-v1',
    version: 1,
    clase: 'final',
    conteos: final
  };
}

async function verificarPropagacionPreparacion(sql, impactoFinal) {
  await new FronteraTransaccionalLocal(sql).ejecutar(async (conexion) => {
    await conexion.execute('SELECT id FROM usuarios WHERE id=1 FOR UPDATE');
    const preparacionAudienciaCorreo = await crearServicio(new AuditoriaFake())
      .prepararUsuariosEnTransaccion(['1'], { conexion });
    const preparador = new PreparadorEfectosEliminacionOrganizacionEnTransaccion({
      repositorioDependenciasAgentes: {
        async cargarDependenciasBloqueadasParaAgenteEnTransaccion() { return {}; }
      },
      nucleoPreparacionDependenciasAgente: {
        async prepararEnTransaccion() { return {}; }
      },
      capturadorFederacion: {
        async capturarEnTransaccion() { return {}; }
      },
      repositorioControlFederacion: {
        async cortarDependenciasEnTransaccion() { return []; }
      },
      repositorioSesionesWeb: {
        async invalidarVigentesPorUsuariosEnTransaccion() { return []; }
      },
      repositorioObligacionesOrganizacion: {
        async crearORecuperarVariasEnTransaccion({ obligaciones }) {
          return obligaciones;
        },
        async contarPorOperacionEnTransaccion() { return '1'; }
      }
    });
    const operacionId = generarUuidV7Auditoria();
    const resultado = await preparador.prepararEnTransaccion({
      inventario: {
        comando: {
          tipoOperacion: 'eliminar_organizacion',
          version: 1,
          identidades: { operacionId },
          fotografiaAutorizacion: {
            actorReal: { usuarioId: '99' },
            actorEfectivo: { usuarioId: '99' },
            destinatarioUsuarioId: '99'
          }
        },
        raiz: {
          tipo: 'sitio', id: '701',
          scope: { tenantId: '7', empresaId: '70', sitioId: '701' }
        },
        usuarios: [
          { id: '1', scope: { tenantId: '7', empresaId: '70', sitioId: '701' } },
          { id: '99', scope: { tenantId: '7', empresaId: '70', sitioId: null } }
        ],
        agentes: [],
        preparacionAudienciaCorreo,
        impactoFinal,
        ordenBloqueo: []
      }
    }, { conexion });
    assert.equal(
      resultado.inventario.preparacionAudienciaCorreo.totalRelacionesRetiradas,
      4
    );
  });
}

async function verificarBajaOrganizativa(sql) {
  const auditoria = new AuditoriaFake();
  const servicio = crearServicio(auditoria);
  const resultado = await new FronteraTransaccionalLocal(sql).ejecutar(
    async (conexion) => {
      await conexion.execute(
        'SELECT id FROM usuarios WHERE sitio_id=701 ORDER BY id FOR UPDATE'
      );
      const preparacion = await servicio.prepararUsuariosEnTransaccion(
        ['1'],
        { conexion }
      );
      await new RepositorioEliminacionesOrganizativas().eliminarRaizEnTransaccion(
        { raiz: { tipo: 'sitio', id: '701' } },
        { conexion }
      );
      return servicio.reconciliarEnTransaccion(
        preparacion,
        contextoActor(),
        { conexion }
      );
    }
  );
  assert.equal(resultado.totalRelacionesRetiradas, 4);
  assert.equal(resultado.totalTriggersAfectados, 4);
  assert.equal(resultado.totalTriggersSupervivientes, 3);
  assert.deepEqual(resultado.triggersDesactivados.map((item) => item.id),
    ['202', '204']);
  assert.deepEqual(await estadosTriggers(sql, [201, 202, 203, 204]), [
    [202, 0, 4],
    [203, 1, 5],
    [204, 0, 8]
  ]);
  assert.equal(await contarSql(sql, 'usuarios', 'id=1'), 0);
  assert.equal(auditoria.eventos.length, 2);
  assert.deepEqual(auditoria.eventos.map((evento) => evento.scope), [
    { tenantId: '7', empresaId: '70', sitioId: '702' },
    { tenantId: null, empresaId: null, sitioId: null }
  ]);
}

async function verificarRollback(sql) {
  const servicio = crearServicio(new AuditoriaFake());
  await assert.rejects(
    new FronteraTransaccionalLocal(sql).ejecutar(async (conexion) => {
      await conexion.execute('SELECT id FROM usuarios WHERE id=5 FOR UPDATE');
      const preparacion = await servicio.prepararUsuariosEnTransaccion(
        ['5'],
        { conexion }
      );
      await new RepositorioEliminacionesOrganizativas().eliminarRaizEnTransaccion(
        { raiz: { tipo: 'sitio', id: '703' } },
        { conexion }
      );
      await servicio.reconciliarEnTransaccion(
        preparacion,
        contextoActor(),
        { conexion }
      );
      throw new Error('fallo_inyectado_52711b');
    }),
    /fallo_inyectado_52711b/u
  );
  assert.equal(await contarSql(sql, 'sitios', 'id=703'), 1);
  assert.equal(await contarSql(sql, 'usuarios', 'id=5'), 1);
  assert.deepEqual(await estadosTriggers(sql, [205]), [[205, 1, 9]]);
}

function crearServicio(auditoria) {
  return new ServicioReconciliacionBajaUsuarioTriggerCorreo({
    repositorioAudiencia: new RepositorioAudienciaTriggerCorreoSql(),
    servicioAuditoria: auditoria
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
}

function contextoActor() {
  return { idUsuarioReal: '99', idUsuario: '99', impersonacionActiva: false };
}

function conteo(conteos, categoria) {
  return String(conteos.find((item) => item.categoria === categoria)?.cantidad);
}

async function estadosTriggers(sql, ids) {
  const filas = await sql.consultar(`
    SELECT id,activo,revision_declaracion FROM triggers
     WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY id
  `, ids);
  return filas.map((fila) => [
    Number(fila.id), Number(fila.activo), Number(fila.revision_declaracion)
  ]);
}

async function contarSql(sql, tabla, filtro) {
  return Number((await sql.consultar(
    `SELECT COUNT(*) total FROM ${tabla} WHERE ${filtro}`
  ))[0].total);
}

await main();
