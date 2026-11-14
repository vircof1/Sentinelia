import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { DespachadorCorreoRuntime }
  from '../apps/sentinelia-runtime/src/correo/DespachadorCorreoRuntime.js';
import { RepositorioColaCorreo }
  from '../paquetes/correo/src/RepositorioColaCorreo.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { FronteraTransaccionalLocal }
  from '../paquetes/persistencia-sql/src/FronteraTransaccionalLocal.js';
import { RepositorioMigraciones }
  from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';
import { configuracionSmtp, prepararEntorno }
  from './correo-verificar-trigger-5-27-6c.js';

await main();

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true, '5.27.6d necesita MariaDB real.');
  const administrador = new ClienteSql(configuracion.sql);
  const nombre = `sentinelia_fixture_5276d_${randomBytes(5).toString('hex')}`;
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
    const entorno = await prepararEntorno(sql);
    await verificarReconciliacion(sql, entorno);
    await verificarDobleRegimen();
    await verificarCableadoPreparado();
    console.log(
      '[correo-trigger] OK 5.27.6d: reconciliacion=reclamada_restaurada+' +
        'enviando_ambigua fencing=respeta_autoridad regimen=gate_durable ' +
        'legacy=redis_antes_corte sql=preparado_post_corte'
    );
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(nombre)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

async function verificarReconciliacion(sql, { cola, salidaIds }) {
  const frontera = new FronteraTransaccionalLocal(sql);
  const reclamado = await frontera.ejecutar((conexion) =>
    cola.reclamarSiguienteTrigger({
      propietarioClaim: 'fixture-reconciliar-reclamada', leaseMilisegundos: 60_000
    }, { conexion })
  );
  const enviando = await frontera.ejecutar((conexion) =>
    cola.reclamarSiguienteTrigger({
      propietarioClaim: 'fixture-reconciliar-enviando', leaseMilisegundos: 60_000
    }, { conexion })
  );
  const inicio = await frontera.ejecutar((conexion) => cola.iniciarIntentoTrigger({
    ...identidad(enviando), configuracionVersion: '7', maxReintentos: 2,
    margenMinimoLeaseMs: 1_000
  }, { conexion }));
  assert.equal(inicio.iniciado, true);

  for (const claim of [reclamado, enviando]) {
    await sql.ejecutar(
      `UPDATE cola_correos_salida
          SET reclamada_en_utc='2026-09-03 09:00:00.000',
              lease_expira_utc='2026-09-03 09:00:01.000'
        WHERE id=?`, [claim.salida.id]
    );
    await sql.ejecutar(
      `UPDATE reclamaciones_correos_salida
          SET reclamada_en_utc='2026-09-03 09:00:00.000',
              lease_expira_utc='2026-09-03 09:00:01.000'
        WHERE id=?`, [claim.reclamacionId]
    );
  }
  const resumen = await frontera.ejecutar((conexion) =>
    cola.reconciliarLeasesExpiradasTrigger({ limite: 10 }, { conexion })
  );
  assert.equal(resumen.total, 2);
  assert.deepEqual(resumen.restauradas, [String(salidaIds[0])]);
  assert.deepEqual(resumen.ambiguas, [String(salidaIds[1])]);
  assert.equal((await cola.buscarPorId(salidaIds[0])).estado, 'pendiente');
  assert.equal((await cola.buscarPorId(salidaIds[1])).estado, 'resultado_ambiguo');
  const [intento] = await sql.consultar(
    `SELECT estado, clasificacion, codigo FROM intentos_correos_salida
      WHERE id=?`, [inicio.intento.intentoId]
  );
  assert.deepEqual([intento.estado, intento.clasificacion, intento.codigo], [
    'ambiguo', 'resultado_ambiguo', 'smtp_resultado_ambiguo_lease_expirada'
  ]);
  await assert.rejects(
    frontera.ejecutar((conexion) => cola.finalizarIntentoTrigger({
      ...identidad(enviando), intentoId: inicio.intento.intentoId,
      resultadoIntento: {
        estado: 'aceptado', clasificacion: 'aceptacion_demostrada',
        codigo: 'smtp_aceptado', respuestaSaneada: '250 demasiado tarde'
      }, reintentoBaseSegundos: 15
    }, { conexion })),
    /autoridad SQL del claim/iu
  );
  assert.equal((await cola.buscarPorId(salidaIds[1])).estado, 'resultado_ambiguo');
}

async function verificarDobleRegimen() {
  const estadoDespliegue = { cola_sql_autoritativa: 0 };
  const llamadas = { actualizar: 0, legacy: 0, sql: 0, reconciliar: 0 };
  const configuracion = { ...configuracionSmtp(), runtimeLoteMaximo: 1 };
  const servicioCorreoPortal = {
    obtenerEstadoConfiguracion() {
      return { activa: true, puedeDespachar: true, configurado: true,
        errores: [], advertencias: [] };
    },
    obtenerConfiguracionCorreoActual() { return configuracion; },
    async despacharSiguientePendiente() {
      llamadas.legacy += 1;
      return { despachado: false, correo: null };
    }
  };
  const servicioConfiguracionPortal = {
    async asegurarActualizada() { llamadas.actualizar += 1; },
    obtenerEstadoDespliegueCorreoActual() { return estadoDespliegue; }
  };
  const despachadorCorreoSql = {
    async reconciliarLeasesExpiradas() {
      llamadas.reconciliar += 1;
      return { total: 0, restauradas: [], ambiguas: [] };
    },
    async despacharSiguiente() {
      llamadas.sql += 1;
      return { despachado: false, motivo: 'sin_salidas_reclamables' };
    }
  };
  const runtime = new DespachadorCorreoRuntime({
    servicioCorreoPortal, servicioConfiguracionPortal, despachadorCorreoSql
  });
  const legacy = await runtime.despacharPendientes({ numeroTick: 1 });
  assert.equal(legacy.regimen, 'legacy');
  assert.deepEqual(llamadas, { actualizar: 1, legacy: 1, sql: 0, reconciliar: 0 });

  estadoDespliegue.cola_sql_autoritativa = 1;
  const sql = await runtime.despacharPendientes({ numeroTick: 2 });
  assert.equal(sql.regimen, 'sql@1');
  assert.deepEqual(llamadas, { actualizar: 2, legacy: 1, sql: 1, reconciliar: 1 });
  assert.equal(sql.reconciliacion.total, 0);
}

async function verificarCableadoPreparado() {
  const [bootstrap, runtime] = await Promise.all([
    readFile(new URL('../apps/sentinelia-runtime/src/BootstrapRuntime.js',
      import.meta.url), 'utf8'),
    readFile(new URL('../apps/sentinelia-runtime/src/RuntimeSentinelia.js',
      import.meta.url), 'utf8')
  ]);
  assert.match(bootstrap, /new DespachadorCorreoSql/u);
  assert.match(runtime, /despachadorCorreoSql:\s*contextoBootstrap\.despachadorCorreoSql/u);
}

function identidad(claim) {
  return {
    reclamacionId: claim.reclamacionId,
    salidaId: String(claim.salida.id),
    claimId: claim.claimId,
    leaseToken: claim.leaseToken,
    propietarioClaim: claim.propietarioClaim,
    fencingToken: claim.fencingToken
  };
}
