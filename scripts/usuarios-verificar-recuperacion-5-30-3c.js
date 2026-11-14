import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';

import { RepositorioAuditoria }
  from '../paquetes/auditoria/src/RepositorioAuditoria.js';
import { generarUuidV7Auditoria }
  from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import { RepositorioCoordinacionCorreoRecuperacionPasswordSql }
  from '../paquetes/correo/src/RepositorioCoordinacionCorreoRecuperacionPasswordSql.js';
import { RepositorioColaCorreo }
  from '../paquetes/correo/src/RepositorioColaCorreo.js';
import { FronteraTransaccionalLocal }
  from '../paquetes/persistencia-sql/src/FronteraTransaccionalLocal.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones }
  from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import { construirIntencionAuditoriaEmisionRecuperacionPassword }
  from '../paquetes/usuarios/src/EventosAuditoriaRecuperacionPassword.js';
import { crearProveedorCompatibilidadRecuperacionPasswordEmailCerrado }
  from '../paquetes/usuarios/src/ProveedorCompatibilidadRecuperacionPasswordEmail.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

await main();

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true, '5.30.3c necesita MariaDB real.');
  const administrador = new ClienteSql(configuracion.sql);
  const nombre = `sentinelia_fixture_5303c_${randomBytes(5).toString('hex')}`;
  let sql;
  try {
    await administrador.ejecutar(
      `CREATE DATABASE ${administrador.escaparIdentificador(nombre)} ` +
      'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
    );
    sql = new ClienteSql({ ...configuracion.sql, baseDatos: nombre });
    await new EjecutorMigraciones({
      clienteSql: sql,
      repositorioMigraciones: new RepositorioMigraciones(sql),
      rutaMigraciones: obtenerRutaMigraciones()
    }).ejecutarPendientes();

    const auditoria = new RepositorioAuditoria(sql);
    const repositorio = new RepositorioCoordinacionCorreoRecuperacionPasswordSql(
      sql,
      { repositorioAuditoria: auditoria }
    );
    const cola = new RepositorioColaCorreo(sql);
    const frontera = new FronteraTransaccionalLocal(sql);
    const caso = crearCaso();

    await verificarRollbackPreparacion({ frontera, repositorio, sql, caso });
    const preparada = await frontera.ejecutar((conexion) =>
      repositorio.crearSalidaPreparadaEnTransaccion(caso.preparacion, { conexion })
    );
    assert.equal(preparada.creada, true);
    assert.equal(preparada.salida.estado, 'preparada');
    assert.deepEqual(preparada.salida.materialPreparacionRecuperacionPassword,
      caso.preparacion.materialPreparacion);
    assert.equal('materialPreparacionRecuperacionPassword' in
      preparada.salida.serializarResumen(), false);
    const seleccionada = await frontera.ejecutar((conexion) =>
      repositorio.seleccionarSiguientePreparacionEnTransaccion({ conexion })
    );
    assert.equal(seleccionada.salidaId, String(preparada.salida.id));
    assert.equal(seleccionada.solicitudId, caso.preparacion.solicitudId);
    assert.deepEqual(seleccionada.materialPreparacion,
      caso.preparacion.materialPreparacion);

    const replay = await frontera.ejecutar((conexion) =>
      repositorio.crearSalidaPreparadaEnTransaccion(caso.preparacion, { conexion })
    );
    assert.equal(replay.creada, false);
    assert.equal(String(replay.salida.id), String(preparada.salida.id));
    await verificarColision({ frontera, repositorio, caso });
    assert.equal(await reclamarTriggerSinCapturarRecuperacion({ frontera, cola }), null);

    await verificarRollbackLiberacion({
      frontera, repositorio, sql, caso, salidaId: preparada.salida.id
    });
    const liberada = await frontera.ejecutar((conexion) =>
      repositorio.completarSalidaPreparadaEnTransaccion({
        salidaId: preparada.salida.id,
        solicitudId: caso.preparacion.solicitudId,
        eventoEmisionId: caso.preparacion.eventoEmisionId,
        cuerpoTexto: caso.cuerpo,
        intencionAuditoria: caso.intencionAuditoria
      }, { conexion })
    );
    assert.equal(liberada.salida.estado, 'pendiente');
    assert.equal(liberada.salida.cuerpoTexto, caso.cuerpo);
    assert.equal(liberada.salida.materialPreparacionRecuperacionPassword, null);
    assert.equal(liberada.auditoria.eventos[0].estado, 'incorporado');
    const repetida = await frontera.ejecutar((conexion) =>
      repositorio.completarSalidaPreparadaEnTransaccion({
        salidaId: preparada.salida.id,
        solicitudId: caso.preparacion.solicitudId,
        eventoEmisionId: caso.preparacion.eventoEmisionId,
        cuerpoTexto: caso.cuerpo,
        intencionAuditoria: caso.intencionAuditoria
      }, { conexion })
    );
    assert.equal(repetida.salida.estado, 'pendiente');
    assert.equal(repetida.auditoria.eventos[0].estado, 'existente');
    assert.equal(await reclamarTriggerSinCapturarRecuperacion({ frontera, cola }), null);

    await verificarNotificacionSeguridad({ frontera, repositorio, sql, caso });
    await verificarLimpiezaHuerfana({
      frontera,
      repositorio,
      sql,
      caso,
      salidaLiberadaId: preparada.salida.id
    });
    const compatibilidad =
      await crearProveedorCompatibilidadRecuperacionPasswordEmailCerrado()
        .evaluarActivacion();
    assert.equal(compatibilidad.compatible, false);
    console.log(
      '[usuarios] OK 5.30.3c: preparacion=idempotente rollback=total ' +
      'liberacion=correo_y_auditoria_atomicos replay=estable ' +
      'notificacion_seguridad=transaccional huerfana=eliminada_cascade ' +
      'selector_trigger=aislado gate=cerrado'
    );
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(nombre)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

async function verificarRollbackPreparacion({ frontera, repositorio, sql, caso }) {
  await assert.rejects(
    frontera.ejecutar(async (conexion) => {
      await repositorio.crearSalidaPreparadaEnTransaccion(caso.preparacion, { conexion });
      throw new Error('rollback_intencional_preparacion');
    }),
    /rollback_intencional_preparacion/u
  );
  assert.equal(await contar(sql, 'cola_correos_salida'), 0);
  assert.equal(await contar(sql,
    'identidades_justificantes_correos_recuperacion_password'), 0);
}

async function verificarColision({ frontera, repositorio, caso }) {
  await assert.rejects(
    frontera.ejecutar((conexion) =>
      repositorio.crearSalidaPreparadaEnTransaccion({
        ...caso.preparacion,
        asunto: 'Otra intención'
      }, { conexion })
    ),
    (error) => error?.codigo ===
      'conflicto_idempotencia_correo_recuperacion_password'
  );
}

async function verificarRollbackLiberacion({ frontera, repositorio, sql, caso, salidaId }) {
  await assert.rejects(
    frontera.ejecutar((conexion) =>
      repositorio.completarSalidaPreparadaEnTransaccion({
        salidaId,
        solicitudId: caso.preparacion.solicitudId,
        eventoEmisionId: caso.preparacion.eventoEmisionId,
        cuerpoTexto: caso.cuerpo,
        intencionAuditoria: {
          ...caso.intencionAuditoria,
          correlacionId: generarUuidV7Auditoria()
        }
      }, { conexion })
    ),
    (error) => error?.codigo ===
      'conflicto_idempotencia_correo_recuperacion_password'
  );
  await assert.rejects(
    frontera.ejecutar(async (conexion) => {
      await repositorio.completarSalidaPreparadaEnTransaccion({
        salidaId,
        solicitudId: caso.preparacion.solicitudId,
        eventoEmisionId: caso.preparacion.eventoEmisionId,
        cuerpoTexto: caso.cuerpo,
        intencionAuditoria: caso.intencionAuditoria
      }, { conexion });
      throw new Error('rollback_intencional_liberacion');
    }),
    /rollback_intencional_liberacion/u
  );
  const existentes = await sql.consultar(
    'SELECT estado,cuerpo_texto FROM cola_correos_salida WHERE id=?',
    [String(salidaId)]
  );
  assert.equal(existentes[0].estado, 'preparada');
  assert.equal(existentes[0].cuerpo_texto, null);
  assert.equal(await contar(sql, 'eventos_auditoria'), 0);
}

async function verificarNotificacionSeguridad({ frontera, repositorio, sql, caso }) {
  const entrada = {
    solicitudId: caso.preparacion.solicitudId,
    claveOperacionSha256: sha('operacion-seguridad'),
    buzonCanonico: caso.preparacion.buzonCanonico,
    claveBuzonSha256: caso.preparacion.claveBuzonSha256,
    smtpMessageId: '<seguridad-5303c@correo.sentinelia>',
    asunto: 'Tu contraseña ha cambiado',
    cuerpoTexto: 'La contraseña de tu cuenta ha cambiado.',
    usuariosJustificantesIds: ['41'],
    creadaEnUtc: caso.preparacion.creadaEnUtc
  };
  await assert.rejects(
    frontera.ejecutar(async (conexion) => {
      await repositorio.crearNotificacionSeguridadEnTransaccion(entrada, { conexion });
      throw new Error('rollback_intencional_seguridad');
    }),
    /rollback_intencional_seguridad/u
  );
  const creada = await frontera.ejecutar((conexion) =>
    repositorio.crearNotificacionSeguridadEnTransaccion(entrada, { conexion })
  );
  assert.equal(creada.creada, true);
  assert.equal(creada.salida.propositoRecuperacionPassword, 'notificar_cambio');
  assert.equal(creada.salida.estado, 'pendiente');
  const replay = await frontera.ejecutar((conexion) =>
    repositorio.crearNotificacionSeguridadEnTransaccion(entrada, { conexion })
  );
  assert.equal(replay.creada, false);
  assert.equal(String(replay.salida.id), String(creada.salida.id));
  const filas = await sql.consultar(
    `SELECT usuario_id FROM identidades_justificantes_correos_recuperacion_password
      WHERE salida_correo_id=?`,
    [String(creada.salida.id)]
  );
  assert.deepEqual(filas.map((fila) => String(fila.usuario_id)), ['41']);
}

async function verificarLimpiezaHuerfana({
  frontera,
  repositorio,
  sql,
  caso,
  salidaLiberadaId
}) {
  const otra = crearCaso();
  const creada = await frontera.ejecutar((conexion) =>
    repositorio.crearSalidaPreparadaEnTransaccion(otra.preparacion, { conexion })
  );
  await assert.rejects(
    frontera.ejecutar(async (conexion) => {
      await repositorio.eliminarPreparacionHuerfanaEnTransaccion({
        salidaId: creada.salida.id,
        solicitudId: otra.preparacion.solicitudId
      }, { conexion });
      throw new Error('rollback_intencional_huerfana');
    }),
    /rollback_intencional_huerfana/u
  );
  assert.ok((await sql.consultar(
    'SELECT id FROM cola_correos_salida WHERE id=?', [String(creada.salida.id)]
  ))[0]);
  const eliminada = await frontera.ejecutar((conexion) =>
    repositorio.eliminarPreparacionHuerfanaEnTransaccion({
      salidaId: creada.salida.id,
      solicitudId: otra.preparacion.solicitudId
    }, { conexion })
  );
  assert.deepEqual(eliminada, { eliminada: true, causa: 'preparacion_huerfana' });
  assert.equal((await sql.consultar(
    `SELECT COUNT(*) AS total
       FROM identidades_justificantes_correos_recuperacion_password
      WHERE salida_correo_id=?`, [String(creada.salida.id)]
  ))[0].total, 0);

  const yaLiberada = await frontera.ejecutar((conexion) =>
    repositorio.eliminarPreparacionHuerfanaEnTransaccion({
      salidaId: salidaLiberadaId,
      solicitudId: caso.preparacion.solicitudId
    }, { conexion })
  );
  assert.equal(yaLiberada.eliminada, false);
}

async function reclamarTriggerSinCapturarRecuperacion({ frontera, cola }) {
  return frontera.ejecutar((conexion) => cola.reclamarSiguienteTrigger({
    propietarioClaim: 'fixture-5.30.3c',
    leaseMilisegundos: 30_000
  }, { conexion }));
}

function crearCaso() {
  const solicitudId = generarUuidV7Auditoria();
  const eventoEmisionId = generarUuidV7Auditoria();
  const eventoConsumoId = generarUuidV7Auditoria();
  const creadaEnUtc = new Date().toISOString();
  const buzonCanonico = 'recuperacion@example.test';
  const preparacion = {
    solicitudId,
    eventoEmisionId,
    claveOperacionSha256: sha(`preparacion:${solicitudId}`),
    direccionIpOrigen: '203.0.113.21',
    materialPreparacion: {
      perfil: 'recuperacion_password@1/preparacion_correo',
      token: randomBytes(32).toString('base64url')
    },
    buzonCanonico,
    claveBuzonSha256: sha(buzonCanonico),
    smtpMessageId: `<${sha(solicitudId)}@correo.sentinelia>`,
    asunto: 'Recuperación de contraseña',
    usuariosJustificantesIds: ['41', '7'],
    creadaEnUtc
  };
  return {
    preparacion,
    cuerpo: 'Abre el enlace temporal para recuperar tu contraseña.',
    intencionAuditoria: construirIntencionAuditoriaEmisionRecuperacionPassword({
      solicitudId,
      eventoEmisionId,
      eventoConsumoId,
      efectivoEnUtc: creadaEnUtc,
      buzonCanonico,
      direccionIp: preparacion.direccionIpOrigen
    })
  };
}

async function contar(sql, tabla) {
  return Number((await sql.consultar(`SELECT COUNT(*) AS total FROM ${tabla}`))[0].total);
}

function sha(valor) {
  return createHash('sha256').update(valor, 'utf8').digest('hex');
}
