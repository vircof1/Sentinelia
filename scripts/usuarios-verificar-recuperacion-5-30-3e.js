import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';

import { DespachadorCorreoRuntime }
  from '../apps/sentinelia-runtime/src/correo/DespachadorCorreoRuntime.js';
import { RepositorioAuditoria }
  from '../paquetes/auditoria/src/RepositorioAuditoria.js';
import { generarUuidV7Auditoria }
  from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import { RepositorioCoordinacionCorreoRecuperacionPasswordSql }
  from '../paquetes/correo/src/RepositorioCoordinacionCorreoRecuperacionPasswordSql.js';
import { RepositorioColaCorreo }
  from '../paquetes/correo/src/RepositorioColaCorreo.js';
import { RepositorioCorteAutoridadColaCorreoSql }
  from '../paquetes/correo/src/ServicioCorteAutoridadColaCorreo.js';
import { RepositorioRetencionTriggerCorreoSql }
  from '../paquetes/correo/src/RepositorioRetencionTriggerCorreoSql.js';
import { ServicioRetencionTriggerCorreo }
  from '../paquetes/correo/src/ServicioRetencionTriggerCorreo.js';
import { construirIntencionAuditoriaEmisionRecuperacionPassword }
  from '../paquetes/usuarios/src/EventosAuditoriaRecuperacionPassword.js';
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
import { prepararEntorno } from './correo-verificar-trigger-5-27-6c.js';

await main();

async function main() {
  await verificarResumenRuntimeDescartado();
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true, '5.30.3e necesita MariaDB real.');
  const administrador = new ClienteSql(configuracion.sql);
  const nombre = `sentinelia_fixture_5303e_${randomBytes(5).toString('hex')}`;
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
    const frontera = new FronteraTransaccionalLocal(sql);
    const cola = new RepositorioColaCorreo(sql);
    const recuperacion = new RepositorioCoordinacionCorreoRecuperacionPasswordSql(
      sql, { repositorioAuditoria: new RepositorioAuditoria(sql) }
    );
    const { salidaIds } = await prepararEntorno(sql);
    const usuarioId = await crearUsuario(sql);
    const { salidaId, eventoEmisionId } = await crearSalidaRecuperacion({
      frontera, recuperacion, usuarioId
    });

    const backlog = await cola.resumirBacklogDetenido();
    assert.ok(backlog.porOrigen.some((item) =>
      item.origen === 'recuperacion_password' &&
      item.proposito === 'transportar_solicitud' && item.total === 1));
    const ciclo = await cola.resumirCicloSql();
    assert.ok(ciclo.some((item) => item.origen === 'recuperacion_password' &&
      item.proposito === 'transportar_solicitud' && item.estado === 'pendiente'));

    const corte = new RepositorioCorteAutoridadColaCorreoSql();
    let fotografia = await frontera.ejecutar((conexion) =>
      corte.fotografiarEnTransaccion({ conexion }));
    assert.ok(fotografia.sqlAnticipadas > 0, 'El trigger activo aún impide el corte.');
    await sql.ejecutar(`
      UPDATE cola_correos_salida
         SET estado='enviado',intentos=1,fecha_ultimo_intento=UTC_TIMESTAMP(3),
             fecha_envio=UTC_TIMESTAMP(3),fecha_terminal_utc=UTC_TIMESTAMP(3)
       WHERE id IN (${salidaIds.map(() => '?').join(',')})
    `, salidaIds);
    fotografia = await frontera.ejecutar((conexion) =>
      corte.fotografiarEnTransaccion({ conexion }));
    assert.deepEqual(fotografia, {
      legacyActivas: 0,
      sqlAnticipadas: 0,
      propietariosCola: 0,
      reclamacionesActivas: 0
    }, 'Ni recuperación ni un trigger terminal aparentan trabajo de corte.');
    const reclamacionRecuperacion = await frontera.ejecutar((conexion) =>
      cola.reclamarSiguienteSql({
        propietarioClaim: 'fixture-quietud-5303e',
        leaseMilisegundos: 30_000,
        origenesTipo: ['recuperacion_password']
      }, { conexion }));
    assert.ok(reclamacionRecuperacion);
    fotografia = await frontera.ejecutar((conexion) =>
      corte.fotografiarEnTransaccion({ conexion }));
    assert.deepEqual(fotografia, {
      legacyActivas: 0,
      sqlAnticipadas: 0,
      propietariosCola: 0,
      reclamacionesActivas: 0
    }, 'Una lease de recuperación tampoco pertenece al corte de triggers.');
    await frontera.ejecutar((conexion) => cola.liberarReclamacionSql({
      salidaId,
      reclamacionId: reclamacionRecuperacion.reclamacionId,
      claimId: reclamacionRecuperacion.claimId,
      leaseToken: reclamacionRecuperacion.leaseToken,
      propietarioClaim: reclamacionRecuperacion.propietarioClaim,
      fencingToken: reclamacionRecuperacion.fencingToken,
      codigo: 'fixture_fin_quietud'
    }, { conexion }));

    await sql.ejecutar(`
      UPDATE cola_correos_salida
         SET estado='descartada',causa_descarte='autoridad_buzon_retirada',
             fecha_terminal_utc='2026-07-01 00:00:00.000'
       WHERE id=?
    `, [salidaId]);
    const retencion = new RepositorioRetencionTriggerCorreoSql(sql);
    assert.equal((await retencion.diagnosticarIntegridadRecuperacionPassword({
      limite: 20
    })).ok, true);
    const candidatos = await retencion.listarCandidatosTerminales({
      retencionDias: 1,
      limite: 20
    });
    assert.deepEqual(candidatos.recuperaciones.map((item) => ({
      id: item.id,
      estado: item.estado,
      causa: item.causaDescarte
    })), [{
      id: salidaId,
      estado: 'descartada',
      causa: 'autoridad_buzon_retirada'
    }]);
    const servicio = new ServicioRetencionTriggerCorreo({
      repositorio: retencion,
      fronteraTransaccional: frontera
    });
    const purga = await servicio.purgarCandidato(candidatos.recuperaciones[0], {
      retencionDias: 1
    });
    assert.equal(purga.estado, 'purgado');
    assert.equal(purga.resumen.identidadesJustificantes, 1);
    assert.equal(await contar(sql, 'cola_correos_salida', 'id=?', [salidaId]), 0);
    assert.equal(await contar(sql,
      'identidades_justificantes_correos_recuperacion_password',
      'salida_correo_id=?', [salidaId]), 0);
    assert.equal(await contar(sql, 'eventos_auditoria', 'evento_id=?', [
      Buffer.from(eventoEmisionId.replaceAll('-', ''), 'hex')
    ]), 1, 'La retención operacional no borra auditoría.');

    console.log(
      '[usuarios] OK 5.30.3e: backlog=origen+proposito metricas=descartada ' +
      'quietud=solo_trigger_activo retencion=salida+proyeccion ' +
      'auditoria=conservada integridad=recuperacion regresion=5.27_compatible'
    );
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(nombre)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

async function crearSalidaRecuperacion({ frontera, recuperacion, usuarioId }) {
  const solicitudId = generarUuidV7Auditoria();
  const eventoEmisionId = generarUuidV7Auditoria();
  const creadaEnUtc = new Date().toISOString();
  const buzon = 'retencion@example.test';
  const preparada = await frontera.ejecutar((conexion) =>
    recuperacion.crearSalidaPreparadaEnTransaccion({
      solicitudId,
      eventoEmisionId,
      claveOperacionSha256: sha(`operacion:${solicitudId}`),
      direccionIpOrigen: '203.0.113.53',
      materialPreparacion: {
        perfil: 'recuperacion_password@1/preparacion_correo',
        token: randomBytes(32).toString('base64url')
      },
      buzonCanonico: buzon,
      claveBuzonSha256: sha(buzon),
      smtpMessageId: `<${sha(`mensaje:${solicitudId}`)}@correo.sentinelia>`,
      asunto: 'Recuperación de contraseña',
      usuariosJustificantesIds: [usuarioId],
      creadaEnUtc
    }, { conexion })
  );
  await frontera.ejecutar((conexion) =>
    recuperacion.completarSalidaPreparadaEnTransaccion({
      salidaId: preparada.salida.id,
      solicitudId,
      eventoEmisionId,
      cuerpoTexto: 'Enlace temporal de recuperación.',
      intencionAuditoria: construirIntencionAuditoriaEmisionRecuperacionPassword({
        solicitudId,
        eventoEmisionId,
        eventoConsumoId: generarUuidV7Auditoria(),
        efectivoEnUtc: creadaEnUtc,
        buzonCanonico: buzon,
        direccionIp: '203.0.113.53'
      })
    }, { conexion })
  );
  return { salidaId: String(preparada.salida.id), eventoEmisionId };
}

async function crearUsuario(sql) {
  const [resultado] = await sql.ejecutar(`
    INSERT INTO usuarios (usuario,email,hash_password,activo,email_validado)
    VALUES (?,?,?,1,1)
  `, [`fixture-5303e-${randomBytes(3).toString('hex')}`,
    'retencion@example.test', 'hash']);
  return String(resultado.insertId);
}

async function verificarResumenRuntimeDescartado() {
  let llamadas = 0;
  const runtime = new DespachadorCorreoRuntime({
    servicioCorreoPortal: {
      obtenerConfiguracionCorreoActual() {
        return {
          runtimeLoteMaximo: 2,
          smtpTimeoutConexionMs: 1,
          smtpTimeoutSaludoMs: 1,
          smtpTimeoutSocketMs: 1
        };
      }
    },
    servicioConfiguracionPortal: {
      async asegurarActualizada() {},
      obtenerEstadoDespliegueCorreoActual() {
        return { cola_sql_autoritativa: 1 };
      }
    },
    despachadorCorreoSql: {
      async reconciliarLeasesExpiradas() {
        return { total: 0, restauradas: [], ambiguas: [] };
      },
      async despacharSiguiente() {
        llamadas += 1;
        return llamadas === 1
          ? { salidaId: '1', estadoSalida: 'descartada', motivo: 'autoridad_buzon_retirada' }
          : { motivo: 'sin_salidas_reclamables' };
      }
    }
  });
  const resumen = await runtime.despacharPendientes();
  assert.equal(resumen.totalIntentados, 1);
  assert.equal(resumen.totalDescartados, 1);
  assert.equal(resumen.totalFallosFinales, 0);
}

async function contar(sql, tabla, condicion = '1=1', parametros = []) {
  const [fila] = await sql.consultar(
    `SELECT COUNT(*) AS total FROM ${tabla} WHERE ${condicion}`,
    parametros
  );
  return Number(fila.total);
}

function sha(valor) {
  return createHash('sha256').update(valor).digest('hex');
}
