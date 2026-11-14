import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { FronteraTransaccionalLocal } from '../paquetes/persistencia-sql/src/FronteraTransaccionalLocal.js';
import { obtenerConfiguracionAplicacion, obtenerRutaMigraciones } from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones } from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import { RepositorioMonitores } from '../paquetes/monitores/src/RepositorioMonitores.js';
import { RepositorioAlertasActivasMonitor } from '../paquetes/monitores/src/RepositorioAlertasActivasMonitor.js';
import { RepositorioOutboxAuditoriaRuntime } from '../paquetes/auditoria/src/RepositorioOutboxAuditoriaRuntime.js';
import { ServicioCierreAlertasMonitoresInactivos } from '../paquetes/monitores/src/ServicioCierreAlertasMonitoresInactivos.js';
import { GestorAlertasActivasMonitor } from '../apps/sentinelia-runtime/src/alertas/GestorAlertasActivasMonitor.js';
import { CatalogoMonitoresRuntime } from '../apps/sentinelia-runtime/src/catalogo/CatalogoMonitoresRuntime.js';
import { RuntimeSentinelia } from '../apps/sentinelia-runtime/src/RuntimeSentinelia.js';

const configuracion = obtenerConfiguracionAplicacion().sql;
const base = `sentinelia_fixture_inactivacion_${randomBytes(6).toString('hex')}`;
const administrador = new ClienteSql(configuracion);
let sql;
let conexion;
try {
  await administrador.ejecutar(`CREATE DATABASE ${administrador.escaparIdentificador(base)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  sql = new ClienteSql({ ...configuracion, baseDatos: base });
  await new EjecutorMigraciones({ clienteSql: sql,
    repositorioMigraciones: new RepositorioMigraciones(sql),
    rutaMigraciones: obtenerRutaMigraciones() }).ejecutarPendientes();
  await sql.ejecutar("INSERT INTO tenants (id,nombre,alias) VALUES (1,'Prueba inactivación','inactivacion')");
  await sql.ejecutar("INSERT INTO empresas (id,tenant_id,nombre,alias) VALUES (2,1,'Prueba','prueba')");
  const repositorioMonitores = new RepositorioMonitores(sql);
  const repositorioAlertas = new RepositorioAlertasActivasMonitor(sql);
  const frontera = new FronteraTransaccionalLocal(sql);
  const outbox = new RepositorioOutboxAuditoriaRuntime(sql);
  const servicioCierre = new ServicioCierreAlertasMonitoresInactivos({
    repositorioMonitores, repositorioAlertasActivasMonitor: repositorioAlertas,
    fronteraTransaccional: frontera,
    registrarAuditoriaEnTransaccion: (intencion, opciones) =>
      outbox.encolarEnTransaccion([intencion], opciones)
  });
  const gestorAlertas = new GestorAlertasActivasMonitor({
    repositorioAlertasActivasMonitor: repositorioAlertas
  });
  const monitor = await repositorioMonitores.crear({
    tenantId: 1, empresaId: 2, sitioId: null, nombre: 'Carrera de inactivación',
    tipo: 'tcp', activo: true, intervaloEjecucionSegundos: 60,
    desfaseInicialSegundos: 0, interpretacionEstado: 'normal',
    descripcionFallo: 'No responde', posibleSolucion: 'Revisar',
    configuracion: { host: 'example.test', puerto: 443 }
  });
  const catalogo = new CatalogoMonitoresRuntime({
    generadoEn: new Date().toISOString(), monitores: [monitor.serializarDefinicionRuntime()]
  });
  const resultado = {
    monitorId: monitor.id, versionCatalogo: monitor.serializarDefinicionRuntime().version,
    tipoMonitor: 'tcp', nombre: monitor.nombre, scope: { tenantId: 1, empresaId: 2, sitioId: null },
    exito: false, estadoDetectado: 'indisponible', codigoResultado: 'tcp_timeout',
    mensajeResultado: 'No responde', finalizadoEnUtc: new Date().toISOString()
  };

  // El tick conserva el bloqueo hasta persistir. La desactivación debe
  // esperar y cerrar la alerta que acaba de escribir el tick.
  conexion = await sql.obtenerConexion();
  await conexion.beginTransaction();
  await repositorioMonitores.bloquearPorIds([monitor.id], { conexion });
  let desactivacionTerminada = false;
  const desactivar = frontera.ejecutar(async (cx) => {
    await cx.execute('UPDATE monitores SET activo=0 WHERE id=?', [monitor.id]);
    await servicioCierre.cerrarEnTransaccion({ monitorId: monitor.id }, { conexion: cx });
  }).then(() => { desactivacionTerminada = true; });
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(desactivacionTerminada, false);
  await gestorAlertas.aplicarResultados({ catalogoOperativo: catalogo, resultados: [resultado] }, { conexion });
  await conexion.commit();
  conexion.release();
  conexion = null;
  await desactivar;
  assert.equal(await repositorioAlertas.buscarPorMonitorId(monitor.id), null);
  const [obligacion] = await sql.consultar('SELECT tipo_evento,payload FROM outbox_auditoria_runtime');
  assert.equal(obligacion.tipo_evento, 'alerta.cerrada');
  const payload = typeof obligacion.payload === 'string' ? JSON.parse(obligacion.payload) : obligacion.payload;
  assert.deepEqual(payload, { resultado: 'cerrada', causa: 'monitor_desactivado' });

  // En el orden contrario, el runtime espera a la desactivación y filtra
  // el resultado antes de producir estados, alertas o automatizaciones.
  await sql.ejecutar('UPDATE monitores SET activo=1 WHERE id=?', [monitor.id]);
  conexion = await sql.obtenerConexion();
  await conexion.beginTransaction();
  await conexion.execute('UPDATE monitores SET activo=0 WHERE id=?', [monitor.id]);
  const runtime = new RuntimeSentinelia({ configuracion: { runtime: {} } });
  runtime.repositorioMonitores = repositorioMonitores;
  runtime.fronteraTransaccionalMonitores = frontera;
  runtime.catalogoOperativo = catalogo;
  runtime.aplicadorResultadosEstadoActual = {
    aplicar: async ({ resultados }) => {
      assert.deepEqual(resultados, []);
      return { resultadosEstabilizados: resultados };
    }
  };
  runtime.persistidorEventosMonitores = {
    persistirDesdeLote: async ({ loteEjecucion }) => {
      assert.deepEqual(loteEjecucion.resultados, []);
      return {};
    }
  };
  runtime.gestorAlertasActivasMonitor = gestorAlertas;
  runtime.gestorHistoricoMonitores = { aplicarResultados: async () => ({}) };
  let persistenciaTerminada = false;
  const persistir = runtime.persistirNucleoCicloMonitores({
    loteEjecucion: { resultados: [resultado] }
  }).then((valor) => { persistenciaTerminada = true; return valor; });
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(persistenciaTerminada, false);
  await conexion.commit();
  conexion.release();
  conexion = null;
  const descartado = await persistir;
  assert.deepEqual(descartado.resultadosDescartadosAdministracion, [
    { monitorId: monitor.id, motivo: 'monitor_inactivo' }
  ]);
  assert.equal(await repositorioAlertas.buscarPorMonitorId(monitor.id), null);

  // Reactivar no devuelve la ocurrencia cerrada; un fallo nuevo abre otra.
  await sql.ejecutar('UPDATE monitores SET activo=1 WHERE id=?', [monitor.id]);
  await frontera.ejecutar((cx) => gestorAlertas.aplicarResultados({
    catalogoOperativo: catalogo, resultados: [resultado]
  }, { conexion: cx }));
  const nueva = await repositorioAlertas.buscarPorMonitorId(monitor.id);
  assert.ok(nueva);
  const servicioFallido = new ServicioCierreAlertasMonitoresInactivos({
    repositorioMonitores, repositorioAlertasActivasMonitor: repositorioAlertas,
    fronteraTransaccional: frontera,
    registrarAuditoriaEnTransaccion: async (intencion, opciones) => {
      await outbox.encolarEnTransaccion([intencion], opciones);
      throw new Error('fallo después de encolar');
    }
  });
  await assert.rejects(() => frontera.ejecutar(async (cx) => {
    await cx.execute('UPDATE monitores SET activo=0 WHERE id=?', [monitor.id]);
    await servicioFallido.cerrarEnTransaccion({ monitorId: monitor.id }, { conexion: cx });
  }), /fallo después de encolar/);
  assert.equal((await repositorioMonitores.buscarPorId(monitor.id)).activo, true);
  assert.equal((await repositorioAlertas.buscarPorMonitorId(monitor.id)).alertaAuditoriaId, nueva.alertaAuditoriaId);
  assert.equal((await sql.consultar('SELECT id FROM outbox_auditoria_runtime')).length, 1);
  await sql.ejecutar('UPDATE monitores SET activo=0 WHERE id=?', [monitor.id]);
  assert.deepEqual(await servicioCierre.reconciliar(), { totalCierres: 1 });
  assert.deepEqual(await servicioCierre.reconciliar(), { totalCierres: 0 });
  assert.equal(await repositorioAlertas.buscarPorMonitorId(monitor.id), null);
  console.log('[monitores] OK SQL: ambas carreras serializadas, cierre y auditoría atómicos, rollback completo y reconciliación idempotente.');
} finally {
  if (conexion) {
    await conexion.rollback();
    conexion.release();
  }
  await sql?.cerrar();
  await administrador.ejecutar(`DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(base)}`);
  await administrador.cerrar();
}
