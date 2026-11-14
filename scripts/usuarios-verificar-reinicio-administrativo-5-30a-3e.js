import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';

import { GestorRetencionCorreoRuntime }
  from '../apps/sentinelia-runtime/src/correo/GestorRetencionCorreoRuntime.js';
import { generarUuidV7Auditoria }
  from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import { ClienteSmtp } from '../paquetes/correo/src/ClienteSmtp.js';
import { crearMensajeReinicioPasswordAdministrativo }
  from '../paquetes/correo/src/CodecMensajeReinicioPasswordAdministrativo.js';
import { DespachadorCorreoSql }
  from '../paquetes/correo/src/DespachadorCorreoSql.js';
import { RepositorioColaCorreo }
  from '../paquetes/correo/src/RepositorioColaCorreo.js';
import { RepositorioCoordinacionCorreoReinicioPasswordAdministrativoSql }
  from '../paquetes/correo/src/RepositorioCoordinacionCorreoReinicioPasswordAdministrativoSql.js';
import { RepositorioRetencionTriggerCorreoSql }
  from '../paquetes/correo/src/RepositorioRetencionTriggerCorreoSql.js';
import { ServicioRetencionTriggerCorreo }
  from '../paquetes/correo/src/ServicioRetencionTriggerCorreo.js';
import { RepositorioCorteAutoridadColaCorreoSql }
  from '../paquetes/correo/src/ServicioCorteAutoridadColaCorreo.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones }
  from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { FronteraTransaccionalLocal }
  from '../paquetes/persistencia-sql/src/FronteraTransaccionalLocal.js';
import { RepositorioMigraciones }
  from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import {
  ESTADOS_PROYECCION_REINICIO_PASSWORD_ADMINISTRATIVO,
  VIAS_REINICIO_PASSWORD_ADMINISTRATIVO
} from '../paquetes/usuarios/src/ContratoReinicioPasswordAdministrativo.js';
import { RepositorioReiniciosPasswordAdministrativosSql }
  from '../paquetes/usuarios/src/RepositorioReiniciosPasswordAdministrativosSql.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true, '5.30a.3e necesita MariaDB real.');
  const administrador = new ClienteSql(configuracion.sql);
  const base = `sentinelia_fixture_530a3e_${randomBytes(5).toString('hex')}`;
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
    await sql.ejecutar(
      `INSERT INTO usuarios (
         id,usuario,email,hash_password,activo,email_validado
       ) VALUES (1,'operador-530a3e','operador@example.test','hash',1,1)`
    );
    const frontera = new FronteraTransaccionalLocal(sql);
    const cola = new RepositorioColaCorreo(sql);
    const operaciones = new RepositorioReiniciosPasswordAdministrativosSql(sql);
    const coordinacion =
      new RepositorioCoordinacionCorreoReinicioPasswordAdministrativoSql(sql);
    const creada = await crearSalida({ frontera, operaciones, coordinacion });

    const backlog = await cola.resumirBacklogDetenido();
    assert.deepEqual(backlog.porOrigen.map(({ origen, total }) => ({ origen, total })), [
      { origen: 'reinicio_password_administrativo', total: 1 }
    ]);
    assert.ok((await cola.resumirCicloSql()).some((item) =>
      item.origen === 'reinicio_password_administrativo' &&
      item.estado === 'pendiente' && item.total === 1));
    assert.equal(
      (await operaciones.buscarUltimoProyectadoPorUsuario(creada.usuarioId)).estado,
      ESTADOS_PROYECCION_REINICIO_PASSWORD_ADMINISTRATIVO.PENDIENTE_ENVIO
    );

    const retencion = new RepositorioRetencionTriggerCorreoSql(sql);
    let candidatos = await retencion.listarCandidatosTerminales({
      retencionDias: 1, limite: 20
    });
    assert.equal(candidatos.reiniciosAdministrativos.length, 0,
      'Una salida no terminal jamás puede purgarse.');
    const corte = new RepositorioCorteAutoridadColaCorreoSql();
    assert.deepEqual(
      await frontera.ejecutar((conexion) =>
        corte.fotografiarEnTransaccion({ conexion })),
      { legacyActivas: 0, sqlAnticipadas: 0, propietariosCola: 0,
        reclamacionesActivas: 0 },
      'El corte histórico de triggers no debe absorber la nueva procedencia.'
    );

    const smtp = new SmtpAceptado();
    const despachador = new DespachadorCorreoSql({
      fronteraTransaccional: frontera,
      repositorioColaCorreo: cola,
      repositorioReinicioPasswordAdministrativo: coordinacion,
      evaluadorAutoridadCorreoSql: new AutoridadCorreoFixture(),
      clienteSmtp: new ClienteSmtp({ fabricaTransport: () => smtp }),
      identificadorInstancia: 'fixture-5.30a.3e',
      leaseMilisegundos: 120_000,
      margenConsolidacionMs: 1_000
    });
    assert.equal((await despachador.despacharSiguiente()).estadoSalida, 'enviado');
    assert.equal(
      (await operaciones.buscarUltimoProyectadoPorUsuario(creada.usuarioId)).estado,
      ESTADOS_PROYECCION_REINICIO_PASSWORD_ADMINISTRATIVO.ACEPTADO_SMTP,
      '`enviado` significa aceptación SMTP, nunca entrega.'
    );
    await sql.ejecutar(
      `UPDATE cola_correos_salida
          SET fecha_terminal_utc='2026-07-01 00:00:00.000'
        WHERE id=?`,
      [creada.salidaId]
    );
    assert.equal(
      (await retencion.diagnosticarIntegridadReinicioPasswordAdministrativo({
        limite: 20
      })).ok,
      true
    );
    candidatos = await retencion.listarCandidatosTerminales({
      retencionDias: 1, limite: 20
    });
    assert.deepEqual(candidatos.reiniciosAdministrativos.map((item) => item.id), [
      creada.salidaId
    ]);

    const servicio = new ServicioRetencionTriggerCorreo({
      repositorio: retencion,
      fronteraTransaccional: frontera
    });
    const gestor = new GestorRetencionCorreoRuntime({
      servicioRetencionCorreo: servicio,
      servicioConfiguracionPortal: {
        async asegurarActualizada() {
          return { obtenerConfiguracionCorreo: () => ({
            retencionSalidasDias: 1,
            runtimeLoteMaximo: 20
          }) };
        }
      },
      repositorioArbolTriggerCorreo: {
        async diagnosticarIntegridadEjecucionesAceptadas() {
          return { ok: true, totalIncompatibles: 0, limite: 20, ejecuciones: [] };
        }
      }
    });
    const resumen = await gestor.ejecutarSiProcede({ forzar: true });
    assert.equal(resumen.reiniciosAdministrativosPurgados, 1);
    assert.equal(resumen.recuperacionesPurgadas, 0);
    assert.equal(resumen.ejecucionesPurgadas, 0);
    assert.equal(resumen.pruebasPurgadas, 0);
    assert.equal(resumen.diagnostico.ok, true);
    assert.equal(await contar(sql, 'cola_correos_salida', 'id=?', [creada.salidaId]), 0);
    assert.equal(await contar(sql, 'intentos_correos_salida',
      'salida_correo_id=?', [creada.salidaId]), 0);
    const operacion = await operaciones.buscarPorId(creada.reinicioId);
    assert.equal(operacion.estado, 'confirmado');
    assert.equal(operacion.salidaCorreoId, null);
    assert.equal(operacion.eventoAuditoriaId, creada.eventoAuditoriaId);
    assert.equal(
      (await operaciones.buscarUltimoProyectadoPorUsuario(creada.usuarioId)).estado,
      ESTADOS_PROYECCION_REINICIO_PASSWORD_ADMINISTRATIVO.DETALLE_RETENIDO
    );

    console.log(
      '[usuarios] OK 5.30a.3e: backlog=origen_aislado corte=solo_trigger ' +
      'proyeccion=pendiente+aceptado_smtp+detalle_retenido ' +
      'retencion=solo_terminal+operacion_auditable metricas=origen_separado'
    );
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(base)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

async function crearSalida({ frontera, operaciones, coordinacion }) {
  const reinicioId = generarUuidV7Auditoria();
  const eventoAuditoriaId = generarUuidV7Auditoria();
  const usuarioId = '5303';
  const aplicadaEnUtc = new Date().toISOString();
  const buzonCanonico = 'destino-530a3e@example.test';
  const mensaje = crearMensajeReinicioPasswordAdministrativo({
    nombrePortal: 'Sentinelia fixture',
    passwordProvisional: 'Provisional_530a3e_segura',
    aplicadoEnUtc: aplicadaEnUtc
  });
  const salida = await frontera.ejecutar(async (conexion) => {
    await operaciones.reservarEnTransaccion({
      reinicioId, usuarioId,
      via: VIAS_REINICIO_PASSWORD_ADMINISTRATIVO.CORREO
    }, { conexion });
    const creada = await coordinacion.crearSalidaEnTransaccion({
      reinicioId,
      buzonCanonico,
      destinatarioNombre: 'Persona objetivo',
      claveBuzonSha256: sha(buzonCanonico),
      smtpMessageId: `<${reinicioId}@correo.sentinelia>`,
      asunto: mensaje.asunto,
      cuerpoTexto: mensaje.cuerpoTexto,
      creadoPorUsuarioId: '1',
      creadaEnUtc: aplicadaEnUtc
    }, { conexion });
    await operaciones.confirmarEnTransaccion({
      reinicioId,
      eventoAuditoriaId,
      salidaCorreoId: String(creada.salida.id),
      versionSesionResultante: '2',
      generacionRecuperacionResultante: '2'
    }, { conexion });
    return creada.salida;
  });
  return { reinicioId, eventoAuditoriaId, usuarioId, salidaId: String(salida.id) };
}

class AutoridadCorreoFixture {
  async evaluarEnTransaccion() {
    return {
      puedeDespachar: true,
      codigo: 'correo_operativo',
      versionConfiguracion: '1',
      remitenteEmailCanonico: 'smtp@example.test',
      configuracion: {
        smtpHost: 'smtp.example.test', smtpPuerto: 587, smtpSecure: false,
        smtpUsuario: 'usuario', smtpPassword: 'secreto', smtpAuthMethod: '',
        smtpTimeoutConexionMs: 1_000, smtpTimeoutSaludoMs: 1_000,
        smtpTimeoutSocketMs: 1_000, smtpTlsPermitirInseguro: false,
        remitenteEmail: 'smtp@example.test', remitenteNombre: 'Sentinelia',
        maxReintentos: 2, reintentoBaseSegundos: 1
      }
    };
  }
}

class SmtpAceptado {
  async sendMail(mensaje) {
    return { accepted: [mensaje.to[0].address], rejected: [],
      response: '250 accepted', messageId: mensaje.messageId };
  }
  close() {}
}

async function contar(sql, tabla, condicion, parametros) {
  const [fila] = await sql.consultar(
    `SELECT COUNT(*) AS total FROM ${tabla} WHERE ${condicion}`, parametros
  );
  return Number(fila.total);
}

function sha(valor) {
  return createHash('sha256').update(valor, 'utf8').digest('hex');
}

await main();
