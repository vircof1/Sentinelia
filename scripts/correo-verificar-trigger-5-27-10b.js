import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import { GestorRetencionCorreoRuntime }
  from '../apps/sentinelia-runtime/src/correo/GestorRetencionCorreoRuntime.js';
import { RepositorioArbolTriggerCorreoSql }
  from '../paquetes/correo/src/RepositorioArbolTriggerCorreoSql.js';
import { RepositorioRetencionTriggerCorreoSql }
  from '../paquetes/correo/src/RepositorioRetencionTriggerCorreoSql.js';
import { ServicioRetencionTriggerCorreo }
  from '../paquetes/correo/src/ServicioRetencionTriggerCorreo.js';
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

await main();

async function main() {
  await verificarReentradaEnMemoria();
  await verificarAislamientoErroresEnMemoria();
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true, '5.27.10b necesita MariaDB real.');
  const administrador = new ClienteSql(configuracion.sql);
  const nombre = `sentinelia_fixture_52710b_${randomBytes(5).toString('hex')}`;
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
    const ids = await prepararCasos(sql);
    await verificarTickDiario(sql, ids);
    console.log(
      '[correo-trigger] OK 5.27.10b: runtime=diario lote=acotado ' +
        'reentrada=una_ejecucion errores=aislados backlog=visible ' +
        'diagnostico=agregado_sin_detalle scheduler=integrado'
    );
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(nombre)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

async function verificarAislamientoErroresEnMemoria() {
  let lectura = 0;
  const gestor = new GestorRetencionCorreoRuntime({
    servicioRetencionCorreo: {
      async listarCandidatos() {
        lectura += 1;
        return lectura === 1
          ? {
              ejecuciones: [
                { tipo: 'ejecucion', id: '1' },
                { tipo: 'ejecucion', id: '2' }
              ],
              pruebas: []
            }
          : { ejecuciones: [], pruebas: [] };
      },
      async purgarCandidato(candidato) {
        if (candidato.id === '1') {
          throw Object.assign(new Error('fallo aislado'), {
            codigo: 'fallo_fixture_retencion'
          });
        }
        return { estado: 'purgado', tipo: 'ejecucion', id: candidato.id };
      }
    },
    servicioConfiguracionPortal: configuracionFalsa(2),
    repositorioArbolTriggerCorreo: {
      async diagnosticarIntegridadEjecucionesAceptadas({ limit }) {
        return { ok: true, totalIncompatibles: 0, limite: limit, ejecuciones: [] };
      }
    }
  });
  const resumen = await gestor.ejecutarSiProcede({
    fechaReferenciaUtc: '2026-09-03T00:00:00.000Z'
  });
  assert.equal(resumen.errores, 1);
  assert.equal(resumen.purgados, 1);
  assert.deepEqual(resumen.erroresPorCodigo, { fallo_fixture_retencion: 1 });
}

async function verificarReentradaEnMemoria() {
  let liberar;
  const barrera = new Promise((resolve) => { liberar = resolve; });
  let selecciones = 0;
  const gestor = new GestorRetencionCorreoRuntime({
    servicioRetencionCorreo: {
      async listarCandidatos() {
        selecciones += 1;
        if (selecciones === 1) await barrera;
        return { ejecuciones: [], pruebas: [] };
      },
      async purgarCandidato() {
        throw new Error('No debe purgar sin candidatos.');
      }
    },
    servicioConfiguracionPortal: configuracionFalsa(1),
    repositorioArbolTriggerCorreo: {
      async diagnosticarIntegridadEjecucionesAceptadas({ limit }) {
        return { ok: true, totalIncompatibles: 0, limite: limit, ejecuciones: [] };
      }
    }
  });
  const primera = gestor.ejecutarSiProcede({
    fechaReferenciaUtc: '2026-09-03T00:00:00.000Z'
  });
  const concurrente = gestor.ejecutarSiProcede({
    fechaReferenciaUtc: '2026-09-03T00:00:01.000Z'
  });
  assert.equal(primera, concurrente, 'La reentrada debe compartir una sola promesa.');
  liberar();
  const resumen = await primera;
  assert.equal(resumen.omitida, false);
  assert.equal(selecciones, 2, 'Una selección inicial y otra para medir backlog.');
  const mismoDia = await gestor.ejecutarSiProcede({
    fechaReferenciaUtc: '2026-09-03T23:59:59.000Z'
  });
  assert.equal(mismoDia.motivo, 'retencion_ya_ejecutada_hoy');
  assert.equal(selecciones, 2);
}

async function prepararCasos(sql) {
  const rechazos = [];
  for (let indice = 0; indice < 2; indice += 1) {
    const id = await insertarId(sql, `
      INSERT INTO ejecuciones_triggers (
        evento_disparo,estado_ejecucion,tipo_trigger,trigger_nombre,
        codigo_resultado,payload_respuesta,iniciado_en_utc,finalizado_en_utc
      ) VALUES ('apertura_alerta','error','correo',?,
        'correo_sin_destinatarios_admitidos',JSON_OBJECT('resultado','rechazado'),
        '2026-07-01 00:00:00','2026-07-01 00:00:01')
    `, [`Rechazo runtime ${indice}`]);
    await sql.ejecutar(`
      INSERT INTO resultados_destinatarios_triggers_correo (
        ejecucion_trigger_id,clave_procedencia,tipo,email_manual,
        email_manual_canonico,normalizacion_buzon_version,estado_observado,
        codigo_inicial,creada_en_utc
      ) VALUES (?,UNHEX(SHA2(?,256)),'manual',?,?,'buzon@1','activa',
        'email_invalido','2026-07-01 00:00:00.000')
    `, [id, `rechazo-runtime-${indice}`, `privado${indice}@example.test`,
      `privado${indice}@example.test`]);
    rechazos.push(String(id));
  }
  const inconsistenteId = await insertarId(sql, `
    INSERT INTO ejecuciones_triggers (
      evento_disparo,estado_ejecucion,tipo_trigger,trigger_nombre,
      codigo_resultado,payload_respuesta,iniciado_en_utc,finalizado_en_utc
    ) VALUES ('apertura_alerta','ok','correo','Inconsistente runtime',
      'correo_notificacion_aceptada_completa',JSON_OBJECT('resultado','aceptada'),
      '2026-07-01 00:00:00','2026-07-01 00:00:01')
  `);
  return { rechazos, inconsistenteId: String(inconsistenteId) };
}

async function verificarTickDiario(sql, ids) {
  const repositorio = new RepositorioRetencionTriggerCorreoSql(sql);
  const gestor = new GestorRetencionCorreoRuntime({
    servicioRetencionCorreo: new ServicioRetencionTriggerCorreo({
      repositorio,
      fronteraTransaccional: new FronteraTransaccionalLocal(sql)
    }),
    servicioConfiguracionPortal: configuracionFalsa(1),
    repositorioArbolTriggerCorreo: new RepositorioArbolTriggerCorreoSql(sql)
  });
  const primero = await gestor.ejecutarSiProcede({
    fechaReferenciaUtc: '2026-09-03T10:00:00.000Z'
  });
  assert.deepEqual({
    candidatos: primero.candidatos,
    purgados: primero.purgados,
    backlog: primero.backlogPosible,
    incompatibles: primero.diagnostico.totalIncompatibles
  }, { candidatos: 1, purgados: 1, backlog: true, incompatibles: 1 });
  assert.deepEqual(primero.diagnostico.porCodigo, { notificacion_ausente: 1 });
  assert.doesNotMatch(JSON.stringify(primero), /privado|example\.test/u);

  const mismoDia = await gestor.ejecutarSiProcede({
    fechaReferenciaUtc: '2026-09-03T11:00:00.000Z'
  });
  assert.equal(mismoDia.omitida, true);
  assert.equal(await contarResultados(sql), 1,
    'El segundo candidato espera al siguiente día UTC.');

  const segundo = await gestor.ejecutarSiProcede({
    fechaReferenciaUtc: '2026-09-04T00:00:00.000Z'
  });
  assert.equal(segundo.purgados, 1);
  assert.equal(segundo.backlogPosible, false);
  assert.equal(segundo.diagnostico.ok, false,
    'La retención no disfraza una aceptación sin árbol como purga.');
  assert.equal(await contarResultados(sql), 0);
  const [inconsistente] = await sql.consultar(`
    SELECT payload_respuesta FROM ejecuciones_triggers WHERE id=?
  `, [ids.inconsistenteId]);
  const payload = typeof inconsistente.payload_respuesta === 'string'
    ? JSON.parse(inconsistente.payload_respuesta)
    : inconsistente.payload_respuesta;
  assert.notEqual(payload.detalle_correo_estado, 'purgado');
}

function configuracionFalsa(limite) {
  return {
    async asegurarActualizada() {
      return {
        obtenerConfiguracionCorreo() {
          return { retencionSalidasDias: 1, runtimeLoteMaximo: limite };
        }
      };
    }
  };
}

async function insertarId(sql, sentencia, parametros = []) {
  const [resultado] = await sql.ejecutar(sentencia, parametros);
  return String(resultado.insertId);
}

async function contarResultados(sql) {
  const [fila] = await sql.consultar(
    'SELECT COUNT(*) AS total FROM resultados_destinatarios_triggers_correo'
  );
  return Number(fila.total);
}
