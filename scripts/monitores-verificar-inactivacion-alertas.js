import assert from 'node:assert/strict';
import { ServicioDashboard } from '../apps/sentinelia-web/src/servicios/ServicioDashboard.js';
import { RuntimeSentinelia } from '../apps/sentinelia-runtime/src/RuntimeSentinelia.js';
import { ServicioMonitores } from '../paquetes/monitores/src/ServicioMonitores.js';
import { ServicioCierreAlertasMonitoresInactivos } from '../paquetes/monitores/src/ServicioCierreAlertasMonitoresInactivos.js';
import { RepositorioMonitores } from '../paquetes/monitores/src/RepositorioMonitores.js';
import { Monitor } from '../paquetes/monitores/src/Monitor.js';
import { AlertaActivaMonitor } from '../paquetes/monitores/src/AlertaActivaMonitor.js';
import { generarUuidV7Auditoria, uuidV7AuditoriaABytes } from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import { prepararIntencionAuditoriaV1 } from '../paquetes/auditoria/src/HuellaIntencionAuditoria.js';

const fecha = '2026-10-04T19:00:00.000Z';
const contexto = { nivelScope: 'portal', idUsuario: 7 };

function monitor(activo = true, id = 33) {
  return new Monitor({
    id, nombre: `Monitor ${id}`, tipo: 'tcp', tenant_id: 1, empresa_id: 2,
    sitio_id: null, activo, intervalo_ejecucion_segundos: 60,
    configuracion: { host: 'example.test', puerto: 443 },
    fecha_actualizacion: fecha
  });
}

function alerta(id = 33) {
  return new AlertaActivaMonitor({
    monitor_id: id, tenant_id: 1, empresa_id: 2, sitio_id: null,
    alerta_auditoria_id: uuidV7AuditoriaABytes(generarUuidV7Auditoria()),
    version_catalogo: fecha, tipo_monitor: 'tcp', estado_alerta: 'activa',
    estado_detectado: 'indisponible', codigo_ultimo_resultado: 'tcp_timeout',
    mensaje_ultimo_resultado: 'No responde.', valido_desde_utc: fecha,
    ultima_confirmacion_utc: fecha, ultima_ejecucion_utc: fecha,
    contador_repeticiones: 3, descartada_dashboard: 0
  });
}

async function verificarPanel() {
  const activo = monitor(true, 1);
  const inactivoSinEstado = monitor(false, 33);
  const inactivoConFallo = monitor(false, 34);
  activo.estadoActualRuntime = { ejecutadoTodavia: true, estado: 'disponible' };
  inactivoConFallo.estadoActualRuntime = { ejecutadoTodavia: true, estado: 'indisponible' };
  let visibles = [activo, inactivoSinEstado, inactivoConFallo];
  const servicio = new ServicioDashboard({
    repositorioMonitores: { listarVisibles: async () => visibles },
    repositorioAlertasActivasMonitor: {
      listarPorMonitorIds: async (ids) => {
        assert.deepEqual(ids, visibles.filter((m) => m.activo).map((m) => m.id));
        // También comprueba el filtro defensivo ante una alerta obsoleta.
        return [alerta(33), alerta(34)];
      }
    },
    servicioAutorizacion: {
      puedeVerMonitores: () => true,
      puedeGestionarDescartesAlertasActivas: () => false,
      puedeVerDns: () => false,
      puedeVerAlertasRemotas: () => false
    }
  });
  const resultado = await servicio.construirDashboardBase(contexto);
  assert.equal(resultado.resumenMonitores.totalMonitores, 3);
  assert.equal(resultado.resumenMonitores.totalActivos, 1);
  assert.equal(resultado.resumenMonitores.totalInactivos, 2);
  assert.equal(resultado.resumenMonitores.totalPendientes, 0);
  assert.equal(resultado.resumenMonitores.totalIndisponibles, 0);
  assert.equal(resultado.resumenMonitores.totalConEstado, 1);
  assert.equal(resultado.resumenMonitores.totalAlertasActivas, 0);
  assert.deepEqual(resultado.alertasDestacadas, []);
  assert.deepEqual(resultado.alertasDescartadas, []);
  assert.equal(resultado.resumenSalud.tono, 'ok');
  visibles = [inactivoSinEstado, inactivoConFallo];
  const sinSupervision = await servicio.construirDashboardBase(contexto);
  assert.equal(sinSupervision.resumenSalud.tono, 'neutro');
  assert.equal(sinSupervision.resumenSalud.titulo, 'Sin monitores habilitados');
}

function entornoCierre({ activo = false, fallo = null } = {}) {
  const estado = { monitor: monitor(activo), alerta: alerta(), eventos: [], capturas: [] };
  const conexion = { execute() {} };
  const repositorioMonitores = {
    bloquearPorIds: async (_ids, opciones) => {
      assert.equal(opciones.conexion, conexion);
      return [{ id: 33, activo: estado.monitor.activo }];
    },
    actualizarCompleto: async (definicion, opciones) => {
      assert.equal(opciones.conexion, conexion);
      estado.monitor.activo = definicion.activo;
      return estado.monitor;
    }
  };
  const repositorioAlertas = {
    buscarPorMonitorId: async (_id, opciones) => {
      assert.equal(opciones.conexion, conexion);
      assert.equal(opciones.bloquear, true);
      return estado.alerta;
    },
    eliminarPorMonitorIds: async (_ids, opciones) => {
      assert.equal(opciones.conexion, conexion);
      estado.alerta = null;
      return 1;
    },
    listarMonitorIdsInactivos: async () => estado.alerta ? [33] : []
  };
  const fronteraTransaccional = {
    ejecutar: async (trabajo) => {
      const antes = { activo: estado.monitor.activo, alerta: estado.alerta, eventos: [...estado.eventos], capturas: [...estado.capturas] };
      try { return await trabajo(conexion); }
      catch (error) {
        estado.monitor.activo = antes.activo;
        Object.assign(estado, { alerta: antes.alerta, eventos: antes.eventos, capturas: antes.capturas });
        throw error;
      }
    }
  };
  const registrar = async (intencion, opciones) => {
    assert.equal(opciones.conexion, conexion);
    prepararIntencionAuditoriaV1(intencion);
    if (fallo === 'auditoria') throw new Error('fallo audit');
    estado.eventos.push(intencion);
  };
  const servicio = new ServicioCierreAlertasMonitoresInactivos({
    repositorioMonitores,
    repositorioAlertasActivasMonitor: repositorioAlertas,
    fronteraTransaccional,
    registrarAuditoriaEnTransaccion: registrar,
    capturadorFederacionMonitores: {
      capturarRuntimeEnTransaccion: async (solicitud, opciones) => {
        assert.equal(opciones.conexion, conexion);
        if (fallo === 'federacion') throw new Error('fallo federacion');
        estado.capturas.push(...solicitud.cierresAlerta);
      }
    },
    ahora: () => new Date(fecha)
  });
  return { estado, servicio, fronteraTransaccional, repositorioMonitores, registrar };
}

async function verificarDesactivacionAtomica(fallo = null) {
  const entorno = entornoCierre({ activo: true, fallo });
  const idAlerta = entorno.estado.alerta.alertaAuditoriaId;
  const servicio = new ServicioMonitores({
    repositorioMonitores: entorno.repositorioMonitores,
    fronteraTransaccional: entorno.fronteraTransaccional,
    servicioCierreAlertasMonitoresInactivos: entorno.servicio
  });
  servicio.buscarMonitorVisible = async () => entorno.estado.monitor;
  servicio.resolverOperacionMonitorValida = async () => ({
    definicion: { ...entorno.estado.monitor, activo: false }, entradasFederadas: []
  });
  servicio.sincronizarEntradasFederadasMonitorLogico = async () => {};
  const trabajo = () => servicio.actualizarMonitor(contexto, 33, {});
  if (fallo) {
    await assert.rejects(trabajo, /fallo/);
    assert.equal(entorno.estado.monitor.activo, true);
    assert.equal(entorno.estado.alerta.alertaAuditoriaId, idAlerta);
    assert.deepEqual(entorno.estado.eventos, []);
    assert.deepEqual(entorno.estado.capturas, []);
    return;
  }
  await trabajo();
  assert.equal(entorno.estado.monitor.activo, false);
  assert.equal(entorno.estado.alerta, null);
  const [evento] = entorno.estado.eventos;
  assert.equal(evento.sujeto.id, idAlerta);
  assert.equal(evento.actor, 'usuario');
  assert.deepEqual(evento.payload, { resultado: 'cerrada', causa: 'monitor_desactivado' });
  assert.throws(() => prepararIntencionAuditoriaV1({
    ...evento, payload: { resultado: 'cerrada', causa: 'monitor_recuperado' }
  }), /Ciclo de alerta inválido/, 'el portal no puede simular una recuperación');
  assert.equal(entorno.estado.capturas[0].estadoDetectado, 'indisponible');
  assert.equal(entorno.estado.capturas[0].codigoResultado, 'monitor_desactivado');
  await trabajo();
  assert.equal(entorno.estado.eventos.length, 1, 'el cierre no se repite en un guardado sin cambios');
}

async function verificarReconciliacion() {
  const entorno = entornoCierre();
  assert.deepEqual(await entorno.servicio.reconciliar(), { totalCierres: 1 });
  assert.equal(entorno.estado.eventos[0].actor, 'runtime');
  assert.deepEqual(await entorno.servicio.reconciliar(), { totalCierres: 0 });
  const reactivado = entornoCierre({ activo: true });
  assert.deepEqual(await reactivado.servicio.reconciliar(), { totalCierres: 0 });
  assert.ok(reactivado.estado.alerta, 'una reactivación concurrente impide la limpieza');
}

async function verificarResultadosTardios() {
  const runtime = new RuntimeSentinelia({ configuracion: { runtime: {} } });
  const conexion = { execute() {} };
  const llamadas = [];
  runtime.fronteraTransaccionalMonitores = { ejecutar: (trabajo) => trabajo(conexion) };
  runtime.repositorioMonitores = {
    bloquearPorIds: async (_ids, opciones) => {
      assert.equal(opciones.conexion, conexion);
      llamadas.push('bloqueo');
      return [
        { id: 1, activo: 1, fecha_actualizacion: fecha },
        { id: 33, activo: 0, fecha_actualizacion: fecha },
        { id: 34, activo: 1, fecha_actualizacion: '2026-10-04T19:01:00.000Z' }
      ];
    }
  };
  const resultados = [1, 33, 34, 35].map((monitorId) => ({ monitorId, versionCatalogo: fecha }));
  runtime.aplicadorResultadosEstadoActual = {
    aplicar: async (datos) => {
      llamadas.push('estado');
      assert.deepEqual(datos.resultados.map((r) => r.monitorId), [1]);
      return { resultadosEstabilizados: datos.resultados };
    }
  };
  runtime.persistidorEventosMonitores = {
    persistirDesdeLote: async (datos) => {
      assert.deepEqual(datos.loteEjecucion.resultados.map((r) => r.monitorId), [1]);
      return {};
    }
  };
  runtime.gestorAlertasActivasMonitor = {
    aplicarResultados: async (datos) => {
      assert.deepEqual(datos.resultados.map((r) => r.monitorId), [1]);
      return {};
    }
  };
  runtime.gestorHistoricoMonitores = {
    aplicarResultados: async (datos) => {
      assert.deepEqual(datos.resultados.map((r) => r.monitorId), [1]);
      return {};
    }
  };
  const resultado = await runtime.persistirNucleoCicloMonitores({ loteEjecucion: { resultados } });
  assert.deepEqual(llamadas, ['bloqueo', 'estado']);
  assert.deepEqual(resultado.resultadosDescartadosAdministracion, [
    { monitorId: 33, motivo: 'monitor_inactivo' },
    { monitorId: 34, motivo: 'version_monitor_modificada' },
    { monitorId: 35, motivo: 'monitor_eliminado' }
  ]);
  assert.equal(resultados.length, 4, 'el lote original se conserva para diagnóstico');
}

async function verificarBloqueoSql() {
  const conexion = { execute: async (sql, ids) => {
    assert.match(sql, /ORDER BY id FOR UPDATE/);
    assert.deepEqual(ids, [1, 33]);
    return [[{ id: 33, activo: 0 }]];
  } };
  const repositorio = new RepositorioMonitores({});
  assert.deepEqual(await repositorio.bloquearPorIds([33, 1, 33, null], { conexion }), [{ id: 33, activo: 0 }]);
  await assert.rejects(() => repositorio.bloquearPorIds([33]), /transaccional/);
}

await verificarPanel();
await verificarDesactivacionAtomica();
await verificarDesactivacionAtomica('auditoria');
await verificarDesactivacionAtomica('federacion');
await verificarReconciliacion();
await verificarResultadosTardios();
await verificarBloqueoSql();
console.log('[monitores] OK: inactivos fuera del foco, cierre administrativo atómico, reconciliación idempotente y resultados tardíos descartados.');
