import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import { FronteraTransaccionalLocal }
  from '../paquetes/persistencia-sql/src/FronteraTransaccionalLocal.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones }
  from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import { RepositorioAudienciaTriggerCorreoSql }
  from '../paquetes/correo/src/RepositorioAudienciaTriggerCorreoSql.js';
import { ServicioAudienciaTriggerCorreo }
  from '../paquetes/correo/src/ServicioAudienciaTriggerCorreo.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true, '5.27.4a necesita MariaDB real.');
  const administrador = new ClienteSql(configuracion.sql);
  const nombre = `sentinelia_fixture_5274a_${randomBytes(5).toString('hex')}`;
  let sql;
  try {
    await administrador.ejecutar(
      `CREATE DATABASE ${administrador.escaparIdentificador(nombre)} ` +
        'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
    );
    sql = new ClienteSql({ ...configuracion.sql, baseDatos: nombre });
    const migracion = await new EjecutorMigraciones({
      clienteSql: sql,
      repositorioMigraciones: new RepositorioMigraciones(sql),
      rutaMigraciones: obtenerRutaMigraciones()
    }).ejecutarPendientes();
    assert.equal(migracion.integridad.ok, true);

    const repositorio = new RepositorioAudienciaTriggerCorreoSql();
    const servicio = new ServicioAudienciaTriggerCorreo({
      repositorioAudiencia: repositorio,
      fronteraTransaccional: new FronteraTransaccionalLocal(sql)
    });
    await assert.rejects(
      repositorio.listarEnTransaccion({ triggerId: 1 }),
      /conexión SQL prestada/iu
    );
    await verificarAltasDeduplicacionYDormancia(sql, servicio);
    await verificarAltaInicialDormida(sql, servicio);
    await verificarRevisionRetiradaYReincorporacion(sql, servicio);
    await verificarLoteYLimite(sql, servicio);

    console.log(
      '[correo-trigger] OK 5.27.4a: altas=manual_usuario buzon=buzon@1 ' +
        'deduplicacion=destino_con_procedencias dormancia=derivada ' +
        'reincorporacion=explicita ultima_relacion=desactiva revision=una_por_lote'
    );
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(nombre)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

async function verificarAltasDeduplicacionYDormancia(sql, servicio) {
  const triggerId = await insertarTrigger(sql, 'Audiencia deduplicada 5274a', true);
  const usuarioId = await insertarUsuario(sql, {
    usuario: 'destino-deduplicado-5274a',
    email: 'Ops@xn--bcher-kva.example'
  });
  const manual = await servicio.agregarManual({
    triggerId,
    revisionDeclaracion: 1,
    email: ' Ops@BÜCHER.example ',
    nombre: 'Guardia externa'
  });
  assert.equal(manual.revisionDeclaracion, 2);
  assert.equal(manual.relacionesCreadas[0].emailManualPresentacion,
    'Ops@BÜCHER.example');
  assert.equal(manual.relacionesCreadas[0].emailManualCanonico,
    'Ops@xn--bcher-kva.example');

  const interna = await servicio.agregarUsuario({
    triggerId,
    revisionDeclaracion: 2,
    usuarioId
  });
  assert.equal(interna.revisionDeclaracion, 3);
  const efectiva = await servicio.proyectarEfectiva({ triggerId });
  assert.equal(efectiva.totalRelaciones, 2);
  assert.equal(efectiva.totalEntregables, 2);
  assert.equal(efectiva.totalBuzones, 1);
  assert.deepEqual(
    efectiva.destinos[0].relaciones.map((item) => item.tipo),
    ['manual', 'usuario']
  );

  await assert.rejects(
    servicio.agregarManual({
      triggerId,
      revisionDeclaracion: 3,
      email: 'Ops@bücher.example'
    }),
    (error) => error?.codigo === 'destinatario_trigger_correo_duplicado' &&
      error?.statusCode === 409
  );
  assert.equal(await revisionTrigger(sql, triggerId), 3);

  await sql.ejecutar('UPDATE usuarios SET activo = 0 WHERE id = ?', [usuarioId]);
  const dormida = await servicio.proyectarEfectiva({ triggerId });
  assert.equal(dormida.totalEntregables, 1);
  assert.equal(dormida.totalBuzones, 1);
  assert.equal(
    dormida.procedencias.find((item) => item.tipo === 'usuario').codigo,
    'usuario_inactivo'
  );
  assert.equal((await estadoTrigger(sql, triggerId)).activo, 1,
    'La dormancia temporal del usuario no desactiva el trigger.');

  await assert.rejects(
    servicio.agregarManual({
      triggerId,
      revisionDeclaracion: 2,
      email: 'otro@example.test'
    }),
    (error) => error?.codigo === 'trigger_revision_obsoleta' &&
      error?.statusCode === 409
  );
}

async function verificarAltaInicialDormida(sql, servicio) {
  const triggerId = await insertarTrigger(sql, 'Audiencia dormida 5274a', false);
  const usuarioInvalidoId = await insertarUsuario(sql, {
    usuario: 'destino-invalido-inicial-5274a',
    email: 'correo-invalido',
    validado: 1
  });
  const usuarioNoValidadoId = await insertarUsuario(sql, {
    usuario: 'destino-no-validado-inicial-5274a',
    email: 'novalidado-inicial@example.test',
    validado: 0
  });

  await servicio.agregarUsuario({
    triggerId,
    revisionDeclaracion: 1,
    usuarioId: usuarioInvalidoId
  });
  await servicio.agregarUsuario({
    triggerId,
    revisionDeclaracion: 2,
    usuarioId: usuarioNoValidadoId
  });

  const efectiva = await servicio.proyectarEfectiva({ triggerId });
  assert.equal(efectiva.totalRelaciones, 2);
  assert.equal(efectiva.totalEntregables, 0);
  assert.deepEqual(
    efectiva.procedencias.map((item) => item.codigo).sort(),
    ['email_invalido', 'email_no_validado']
  );
  assert.equal((await estadoTrigger(sql, triggerId)).activo, 0,
    'Añadir relaciones dormidas no debe reactivar el trigger.');
}

async function verificarRevisionRetiradaYReincorporacion(sql, servicio) {
  const triggerId = await insertarTrigger(sql, 'Última relación 5274a', true);
  const alta = await servicio.agregarManual({
    triggerId,
    revisionDeclaracion: 1,
    email: 'ultima@example.test'
  });
  const relacionId = alta.relacionesCreadas[0].id;
  const retirada = await servicio.retirar({
    triggerId,
    revisionDeclaracion: 2,
    relacionId
  });
  assert.equal(retirada.revisionDeclaracion, 3);
  assert.equal(retirada.desactivadoAutomaticamente, true);
  assert.equal(retirada.activo, false);
  assert.equal((await estadoTrigger(sql, triggerId)).activo, 0);

  const triggerReincorporacion = await insertarTrigger(
    sql,
    'Reincorporación explícita 5274a',
    false
  );
  const creada = await servicio.agregarManual({
    triggerId: triggerReincorporacion,
    revisionDeclaracion: 1,
    email: 'volver@example.test'
  });
  assert.equal(creada.activo, false, 'Añadir audiencia no reactiva el trigger.');
  const relacionReincorporada = creada.relacionesCreadas[0].id;
  await sql.ejecutar(`
    UPDATE destinatarios_triggers_correo
       SET estado_participacion = 'desuscrita',
           causa_ultima_desuscripcion = 'fixture_capacidad',
           desuscrita_en_utc = UTC_TIMESTAMP(3),
           cambiada_en_utc = UTC_TIMESTAMP(3)
     WHERE id = ?
  `, [relacionReincorporada]);
  await sql.ejecutar(
    'UPDATE triggers SET revision_declaracion = revision_declaracion + 1 WHERE id = ?',
    [triggerReincorporacion]
  );
  const reincorporada = await servicio.reincorporar({
    triggerId: triggerReincorporacion,
    revisionDeclaracion: 3,
    relacionId: relacionReincorporada
  });
  assert.equal(reincorporada.revisionDeclaracion, 4);
  assert.equal(reincorporada.reincorporadas, 1);
  assert.equal(reincorporada.activo, false,
    'Reincorporar audiencia nunca reactiva el trigger.');
  assert.equal(reincorporada.audiencia[0].estadoParticipacion, 'activa');
}

async function verificarLoteYLimite(sql, servicio) {
  const triggerId = await insertarTrigger(sql, 'Reemplazo atómico 5274a', true);
  const alta = await servicio.agregarManual({
    triggerId,
    revisionDeclaracion: 1,
    email: 'anterior@example.test'
  });
  const reemplazo = await servicio.mutar({
    triggerId,
    revisionDeclaracion: 2,
    retiradasIds: [alta.relacionesCreadas[0].id],
    altasManuales: [{ email: 'nueva@example.test', nombre: null }]
  });
  assert.equal(reemplazo.revisionDeclaracion, 3);
  assert.equal(reemplazo.activo, true);
  assert.equal(reemplazo.audiencia.length, 1);
  assert.equal(reemplazo.audiencia[0].emailManualCanonico, 'nueva@example.test');

  await sql.ejecutar(`
    UPDATE configuracion_portal
       SET valor = '1'
     WHERE clave = 'correo.destinatarios_trigger_maximos'
  `);
  await assert.rejects(
    servicio.agregarManual({
      triggerId,
      revisionDeclaracion: 3,
      email: 'exceso@example.test'
    }),
    (error) => error?.codigo === 'audiencia_trigger_correo_sobre_limite' &&
      error?.statusCode === 409
  );
  assert.equal(await revisionTrigger(sql, triggerId), 3);

  const heredadoId = await insertarTrigger(sql, 'Sobre límite heredado 5274a', true);
  await sql.ejecutar(`
    UPDATE configuracion_portal
       SET valor = '2'
     WHERE clave = 'correo.destinatarios_trigger_maximos'
  `);
  const dos = await servicio.mutar({
    triggerId: heredadoId,
    revisionDeclaracion: 1,
    altasManuales: [
      { email: 'uno@example.test' },
      { email: 'dos@example.test' }
    ]
  });
  await sql.ejecutar(`
    UPDATE configuracion_portal
       SET valor = '1'
     WHERE clave = 'correo.destinatarios_trigger_maximos'
  `);
  const reduccion = await servicio.retirar({
    triggerId: heredadoId,
    revisionDeclaracion: 2,
    relacionId: dos.relacionesCreadas[0].id
  });
  assert.equal(reduccion.audiencia.length, 1,
    'Reducir una audiencia heredada debe seguir siendo posible.');
  assert.equal(reduccion.revisionDeclaracion, 3);

  await sql.ejecutar(`
    UPDATE estado_despliegue_trigger_correo
       SET estado = 'corte_origen',
           cortado_en_utc = UTC_TIMESTAMP(3),
           guard_revision_trigger_activo = 1,
           revision = revision + 1
     WHERE id = 1
  `);
  const protegidoId = await insertarTrigger(sql, 'Audiencia bajo guard 5274a', false);
  const protegida = await servicio.agregarManual({
    triggerId: protegidoId,
    revisionDeclaracion: 1,
    email: 'guard@example.test'
  });
  assert.equal(protegida.revisionDeclaracion, 2,
    'La audiencia debe atravesar el primitivo común admitido por el guard.');
}

async function insertarTrigger(sql, nombre, activo) {
  const [resultado] = await sql.ejecutar(`
    INSERT INTO triggers (nombre, tipo, descripcion, activo, configuracion)
    VALUES (?, 'correo', 'fixture 5.27.4a', ?, JSON_OBJECT(
      'version', 1,
      'asuntoPlantilla', 'Aviso {{monitor}}',
      'textoIntroduccion', NULL,
      'textoCierre', NULL
    ))
  `, [nombre, activo ? 1 : 0]);
  return Number(resultado.insertId);
}

async function insertarUsuario(sql, {
  usuario,
  email,
  activo = 1,
  validado = 1
}) {
  const [resultado] = await sql.ejecutar(`
    INSERT INTO usuarios (
      usuario, email, email_validado, hash_password, activo
    ) VALUES (?, ?, ?, 'fixture', ?)
  `, [usuario, email, validado, activo]);
  return Number(resultado.insertId);
}

async function revisionTrigger(sql, triggerId) {
  return (await estadoTrigger(sql, triggerId)).revision_declaracion;
}

async function estadoTrigger(sql, triggerId) {
  const [fila] = await sql.consultar(`
    SELECT activo, revision_declaracion
      FROM triggers
     WHERE id = ?
  `, [triggerId]);
  return {
    activo: Number(fila.activo),
    revision_declaracion: Number(fila.revision_declaracion)
  };
}

await main();
