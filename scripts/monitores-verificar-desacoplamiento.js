import assert from 'node:assert/strict';

import {
  agruparMonitoresPorTipo,
  listarDefinicionesTiposMonitor
} from '../paquetes/monitores/src/CatalogoTiposMonitor.js';
import { PermisosUsuario } from '../paquetes/autorizacion/src/PermisosUsuario.js';
import { ServicioAutorizacion } from '../paquetes/autorizacion/src/ServicioAutorizacion.js';
import { AlertaActivaMonitor } from '../paquetes/monitores/src/AlertaActivaMonitor.js';
import { RepositorioAlertasActivasMonitor } from '../paquetes/monitores/src/RepositorioAlertasActivasMonitor.js';
import { RepositorioEventosMonitor } from '../paquetes/monitores/src/RepositorioEventosMonitor.js';
import { RepositorioHistoricoMonitores } from '../paquetes/monitores/src/RepositorioHistoricoMonitores.js';
import { RepositorioMonitores } from '../paquetes/monitores/src/RepositorioMonitores.js';
import { ServicioMonitores } from '../paquetes/monitores/src/ServicioMonitores.js';
import {
  crearConfiguracionMonitorLogicoBase,
  FUENTES_SENAL_MONITOR_LOGICO,
  compilarGrafoLogicoAExpresion,
  normalizarGrafoLogicoVisual,
  VERSION_CONFIGURACION_MONITOR_LOGICO,
  VERSION_GRAFO_LOGICO_MONITOR_LOGICO,
  VERSION_LAYOUT_VISUAL_MONITOR_LOGICO
} from '../paquetes/monitores/src/ConfiguracionMonitorLogico.js';
import { analizarExpresionMonitorLogico } from '../paquetes/monitores/src/AnalizadorExpresionMonitorLogico.js';
import {
  normalizarDependenciasMonitorLogico,
  resumirDependenciasMonitorLogico
} from '../paquetes/monitores/src/DependenciasMonitorLogico.js';
import { ValidadorMonitor } from '../paquetes/monitores/src/ValidadorMonitor.js';
import { CatalogoMonitoresRuntime } from '../apps/sentinelia-runtime/src/catalogo/CatalogoMonitoresRuntime.js';
import { AlmacenEstadoActual } from '../apps/sentinelia-runtime/src/estado/AlmacenEstadoActual.js';
import { AplicadorResultadosEstadoActual } from '../apps/sentinelia-runtime/src/estado/AplicadorResultadosEstadoActual.js';
import { RegistroEjecutoresMonitor } from '../apps/sentinelia-runtime/src/ejecucion/RegistroEjecutoresMonitor.js';
import { MotorMonitores } from '../apps/sentinelia-runtime/src/ejecucion/MotorMonitores.js';
import { EjecutorMonitorBooleano } from '../apps/sentinelia-runtime/src/ejecucion/EjecutorMonitorBooleano.js';
import { RuntimeSentinelia } from '../apps/sentinelia-runtime/src/RuntimeSentinelia.js';
import { ServicioGestionAlertasActivasPortal } from '../apps/sentinelia-web/src/servicios/ServicioGestionAlertasActivasPortal.js';
import { ServicioDashboard } from '../apps/sentinelia-web/src/servicios/ServicioDashboard.js';
import { DifusorWebSocketPortal } from '../apps/sentinelia-web/src/realtime/DifusorWebSocketPortal.js';
import { ControladorPortal } from '../apps/sentinelia-web/src/controladores/ControladorPortal.js';
import { SelectorMonitoresVencidos } from '../apps/sentinelia-runtime/src/scheduler/SelectorMonitoresVencidos.js';
import { PlanificadorMonitoresLogicosReactivos } from '../apps/sentinelia-runtime/src/scheduler/PlanificadorMonitoresLogicosReactivos.js';
import { ServicioEventosMonitores } from '../apps/sentinelia-runtime/src/eventos/ServicioEventosMonitores.js';
import { PersistidorEventosMonitores } from '../apps/sentinelia-runtime/src/eventos/PersistidorEventosMonitores.js';
import { GestorAlertasActivasMonitor } from '../apps/sentinelia-runtime/src/alertas/GestorAlertasActivasMonitor.js';
import { MotorTriggersRuntime } from '../apps/sentinelia-runtime/src/triggers/MotorTriggersRuntime.js';
import { GestorHistoricoMonitores } from '../apps/sentinelia-runtime/src/historico/GestorHistoricoMonitores.js';
import { CompactadorHistorico } from '../apps/sentinelia-runtime/src/historico/CompactadorHistorico.js';
import { DiagnosticoRuntime } from '../apps/sentinelia-runtime/src/DiagnosticoRuntime.js';
import { PresenciaRuntimeRedis } from '../apps/sentinelia-runtime/src/redis/PresenciaRuntimeRedis.js';

function crearDefinicionMonitor({ id, tipo, nombre }) {
  return {
    id,
    nombre,
    tipo,
    interpretacionEstado: id % 2 === 0 ? 'invertida' : 'normal',
    descripcionFallo: `Fallo operativo de ${nombre}`,
    posibleSolucion: `Accion sugerida para ${nombre}`,
    activo: true,
    version: `v-${id}`,
    scope: {
      tenantId: 1,
      empresaId: 10,
      sitioId: id % 2 === 0 ? 20 : null,
      nivelPertenencia: id % 2 === 0 ? 'sitio' : 'empresa'
    },
    programacion: {
      intervaloEjecucionSegundos: 60,
      desfaseInicialSegundos: 0
    },
    configuracion: {
      host: `${nombre}.example.local`
    }
  };
}

function crearResumenScheduler() {
  return {
    activo: true,
    intervaloTickMs: 1000,
    ticksEjecutados: 1,
    totalConsiderados: 3,
    totalVencidos: 0,
    totalPendientesFuturos: 3,
    proximoIntentoGlobalEn: null
  };
}

function verificarCatalogoRuntime() {
  const catalogo = new CatalogoMonitoresRuntime({
    generadoEn: '2026-01-01T00:00:00.000Z',
    monitores: [
      crearDefinicionMonitor({ id: 1, tipo: 'ping', nombre: 'ping-a' }),
      crearDefinicionMonitor({ id: 2, tipo: 'tcp', nombre: 'tcp-a' }),
      {
        ...crearDefinicionMonitor({ id: 4, tipo: 'booleano', nombre: 'booleano-a' }),
        interpretacionEstado: 'invertida'
      }
    ]
  });
  const resumenCatalogo = catalogo.serializarResumen();
  const almacen = new AlmacenEstadoActual({ catalogoOperativo: catalogo });
  const resumenEstado = almacen.serializarResumen();

  assert.equal(resumenCatalogo.total, 3);
  assert.deepEqual(resumenCatalogo.porTipo, {
    ping: 1,
    tcp: 1,
    booleano: 1,
    telemetria: 0
  });
  assert.equal(resumenCatalogo.totalPing, 1);
  assert.equal(resumenCatalogo.totalTcp, 1);
  assert.deepEqual(resumenEstado.porTipo, {
    ping: 1,
    tcp: 1,
    booleano: 1,
    telemetria: 0
  });
  assert.equal(catalogo.buscarPorId(1)?.interpretacionEstado, 'normal');
  assert.equal(catalogo.buscarPorId(2)?.interpretacionEstado, 'invertida');
  assert.equal(catalogo.buscarPorId(4)?.interpretacionEstado, 'normal');
  assert.equal(
    catalogo.buscarPorId(1)?.descripcionFallo,
    'Fallo operativo de ping-a'
  );
  assert.equal(
    catalogo.buscarPorId(2)?.posibleSolucion,
    'Accion sugerida para tcp-a'
  );

  return { catalogo, almacen, resumenCatalogo, resumenEstado };
}

function verificarAutorizacionDescartesAlertasActivas() {
  const servicioAutorizacion = new ServicioAutorizacion();
  const contextoConMonitores = {
    permisos: new PermisosUsuario({
      ver: true,
      verMonitores: true
    })
  };
  const contextoSoloPanel = {
    permisos: new PermisosUsuario({
      ver: true,
      verMonitores: false
    })
  };

  assert.equal(
    servicioAutorizacion.puedeGestionarDescartesAlertasActivas(
      contextoConMonitores
    ),
    true
  );
  assert.equal(
    servicioAutorizacion.resolverPermiso(
      'gestionar_descartes_alertas_activas',
      contextoConMonitores
    ),
    true
  );
  assert.equal(
    servicioAutorizacion.puedeGestionarDescartesAlertasActivas(contextoSoloPanel),
    false
  );
  assert.equal(
    servicioAutorizacion.resolverPermiso(
      'gestionar_descartes_alertas_activas',
      contextoSoloPanel
    ),
    false
  );
}

async function verificarGestionPortalDescartesAlertasActivas() {
  const servicioAutorizacion = new ServicioAutorizacion();
  const contextoUsuarioActual = {
    idUsuario: 12,
    permisos: new PermisosUsuario({
      ver: true,
      verMonitores: true
    })
  };
  const filaAlertaBase = {
    monitor_id: 77,
    tenant_id: 1,
    empresa_id: 10,
    sitio_id: null,
    version_catalogo: 'v-77',
    tipo_monitor: 'tcp',
    estado_alerta: 'activa',
    estado_detectado: 'indisponible',
    codigo_ultimo_resultado: 'tcp_timeout',
    mensaje_ultimo_resultado: 'No responde.',
    valido_desde_utc: '2026-01-01 00:00:00',
    ultima_confirmacion_utc: '2026-01-01 00:05:00',
    ultima_ejecucion_utc: '2026-01-01 00:05:00',
    contador_repeticiones: 2,
    payload_alerta: JSON.stringify({
      nombreMonitor: 'tcp-gestion-descarte',
      codigoResultado: 'tcp_timeout',
      mensajeResultado: 'No responde.'
    }),
    descartada_dashboard: 0,
    motivo_descarte: '',
    descartada_por_usuario_id: null,
    descartada_en_utc: null,
    descartada_hasta_utc: null
  };
  let descarteSolicitado = null;
  let reversionSolicitada = null;
  const repositorioAlertasActivasMonitor = {
    async buscarPorMonitorId() {
      return new AlertaActivaMonitor(filaAlertaBase);
    },
    async descartarDashboard(datos) {
      descarteSolicitado = datos;
      return new AlertaActivaMonitor({
        ...filaAlertaBase,
        descartada_dashboard: 1,
        motivo_descarte: datos.motivo,
        descartada_por_usuario_id: datos.usuarioId,
        descartada_en_utc: '2026-01-01 00:06:00',
        descartada_hasta_utc: datos.descartadaHastaUtc
      });
    },
    async revertirDescarteDashboard(datos) {
      reversionSolicitada = datos;
      return new AlertaActivaMonitor(filaAlertaBase);
    }
  };
  const repositorioMonitores = {
    async listarVisibles() {
      return [{ id: 77 }];
    }
  };
  const eventosDashboard = [];
  const vencimientosProgramados = [];
  const servicio = new ServicioGestionAlertasActivasPortal({
    repositorioMonitores,
    repositorioAlertasActivasMonitor,
    servicioAutorizacion,
    difusorWebSocketPortal: {
      emitirDashboardActualizado(payload) {
        eventosDashboard.push(payload);
      },
      programarVencimientoDescarteTemporal(vencimientoUtc, opciones = {}) {
        vencimientosProgramados.push({ vencimientoUtc, opciones });
      }
    }
  });
  const hastaUtc = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const resultadoDescarte = await servicio.descartarAlertaActiva(
    contextoUsuarioActual,
    {
      monitorId: 77,
      motivo: '  Ventana aceptada por operaciones.  ',
      hastaUtc
    }
  );

  assert.equal(descarteSolicitado.monitorId, 77);
  assert.equal(descarteSolicitado.motivo, 'Ventana aceptada por operaciones.');
  assert.equal(descarteSolicitado.usuarioId, 12);
  assert.equal(descarteSolicitado.descartadaHastaUtc, hastaUtc);
  assert.equal(resultadoDescarte.alerta.descarteOperativo.descartada, true);
  assert.equal(
    resultadoDescarte.alerta.descarteOperativo.motivo,
    'Ventana aceptada por operaciones.'
  );
  assert.equal(resultadoDescarte.alerta.descarteOperativo.usuarioId, 12);
  assert.equal(eventosDashboard.length, 1);
  assert.equal(eventosDashboard[0].motivoPublicacion, 'descarte_alerta_activa');
  assert.equal(eventosDashboard[0].monitorId, 77);
  assert.ok(eventosDashboard[0].sincronizadoEn);
  assert.deepEqual(vencimientosProgramados, [
    {
      vencimientoUtc: hastaUtc,
      opciones: { monitorId: 77 }
    }
  ]);

  const resultadoReversion = await servicio.revertirDescarteAlertaActiva(
    contextoUsuarioActual,
    {
      monitorId: 77
    }
  );

  assert.deepEqual(reversionSolicitada, { monitorId: 77 });
  assert.equal(resultadoReversion.alerta.descarteOperativo.descartada, false);
  assert.equal(resultadoReversion.alerta.descarteOperativo.motivo, '');
  assert.equal(eventosDashboard.length, 2);
  assert.equal(
    eventosDashboard[1].motivoPublicacion,
    'reversion_descarte_alerta_activa'
  );
  assert.equal(eventosDashboard[1].monitorId, 77);

  const servicioFueraDeAlcance = new ServicioGestionAlertasActivasPortal({
    repositorioMonitores: {
      async listarVisibles() {
        return [{ id: 88 }];
      }
    },
    repositorioAlertasActivasMonitor,
    servicioAutorizacion
  });

  await assert.rejects(
    () =>
      servicioFueraDeAlcance.descartarAlertaActiva(contextoUsuarioActual, {
        monitorId: 77,
        motivo: 'Fuera de alcance.',
        hastaUtc: null
      }),
    /alcance operativo/
  );

  const servicioAlertaYaDescartada = new ServicioGestionAlertasActivasPortal({
    repositorioMonitores,
    repositorioAlertasActivasMonitor: {
      ...repositorioAlertasActivasMonitor,
      async buscarPorMonitorId() {
        return new AlertaActivaMonitor({
          ...filaAlertaBase,
          descartada_dashboard: 1,
          motivo_descarte: 'Descarte vigente.',
          descartada_por_usuario_id: 12,
          descartada_en_utc: '2026-01-01 00:06:00',
          descartada_hasta_utc: null
        });
      }
    },
    servicioAutorizacion
  });

  await assert.rejects(
    () =>
      servicioAlertaYaDescartada.descartarAlertaActiva(contextoUsuarioActual, {
        monitorId: 77,
        motivo: 'Intento de cambiar el descarte.',
        hastaUtc: null
      }),
    /ya está inhibida/
  );

  const eventosDashboardCarrera = [];
  const servicioCarrera = new ServicioGestionAlertasActivasPortal({
    repositorioMonitores,
    repositorioAlertasActivasMonitor: {
      ...repositorioAlertasActivasMonitor,
      async descartarDashboard() {
        return null;
      }
    },
    servicioAutorizacion,
    difusorWebSocketPortal: {
      emitirDashboardActualizado(payload) {
        eventosDashboardCarrera.push(payload);
      }
    }
  });

  await assert.rejects(
    () =>
      servicioCarrera.descartarAlertaActiva(contextoUsuarioActual, {
        monitorId: 77,
        motivo: 'Llegó tarde por concurrencia.',
        hastaUtc: null
      }),
    /ya está inhibida/
  );
  assert.equal(eventosDashboardCarrera.length, 0);
}

async function verificarRepositorioDescartesEvitaSobrescrituraConcurrente() {
  let sqlActualizacion = '';
  let parametrosActualizacion = [];
  let totalConsultas = 0;
  const repositorioSinActualizacion = new RepositorioAlertasActivasMonitor({
    async ejecutar(sql, parametros) {
      sqlActualizacion = sql;
      parametrosActualizacion = parametros;
      return [{ affectedRows: 0 }];
    },
    async consultar() {
      totalConsultas += 1;
      return [];
    }
  });
  const resultadoSinActualizacion =
    await repositorioSinActualizacion.descartarDashboard({
      monitorId: 77,
      motivo: 'Motivo concurrente.',
      usuarioId: 12,
      descartadaHastaUtc: null
    });

  assert.equal(resultadoSinActualizacion, null);
  assert.equal(totalConsultas, 0);
  assert.match(sqlActualizacion, /estado_alerta = 'activa'/);
  assert.match(sqlActualizacion, /descartada_dashboard = 0/);
  assert.match(sqlActualizacion, /descartada_hasta_utc <= UTC_TIMESTAMP\(\)/);
  assert.deepEqual(parametrosActualizacion, [
    'Motivo concurrente.',
    12,
    null,
    77
  ]);

  const repositorioActualizado = new RepositorioAlertasActivasMonitor({
    async ejecutar() {
      return [{ affectedRows: 1 }];
    },
    async consultar() {
      return [
        {
          monitor_id: 77,
          tenant_id: 1,
          empresa_id: 10,
          sitio_id: null,
          version_catalogo: 'v-77',
          tipo_monitor: 'tcp',
          estado_alerta: 'activa',
          estado_detectado: 'indisponible',
          codigo_ultimo_resultado: 'tcp_timeout',
          mensaje_ultimo_resultado: 'No responde.',
          valido_desde_utc: '2026-01-01 00:00:00',
          ultima_confirmacion_utc: '2026-01-01 00:05:00',
          ultima_ejecucion_utc: '2026-01-01 00:05:00',
          contador_repeticiones: 2,
          payload_alerta: '{}',
          descartada_dashboard: 1,
          motivo_descarte: 'Motivo concurrente.',
          descartada_por_usuario_id: 12,
          descartada_en_utc: '2026-01-01 00:06:00',
          descartada_hasta_utc: null
        }
      ];
    }
  });
  const resultadoActualizado = await repositorioActualizado.descartarDashboard({
    monitorId: 77,
    motivo: 'Motivo concurrente.',
    usuarioId: 12,
    descartadaHastaUtc: null
  });

  assert.equal(resultadoActualizado.monitorId, 77);
  assert.equal(resultadoActualizado.obtenerDescarteOperativo().vigente, true);
}

function verificarDifusorProgramaVencimientosDescartesTemporales() {
  const setTimeoutOriginal = globalThis.setTimeout;
  const clearTimeoutOriginal = globalThis.clearTimeout;
  const eventosDashboard = [];
  let temporizadorProgramado = null;
  let temporizadorLimpiado = null;

  globalThis.setTimeout = (callback, retrasoMs) => {
    temporizadorProgramado = {
      callback,
      retrasoMs,
      unrefLlamado: false,
      unref() {
        this.unrefLlamado = true;
      }
    };
    return temporizadorProgramado;
  };
  globalThis.clearTimeout = (temporizador) => {
    temporizadorLimpiado = temporizador;
  };

  try {
    const difusor = new DifusorWebSocketPortal({
      sessionMiddleware() {},
      servicioSesion: {},
      servicioContextoUsuario: {},
      servicioAutorizacion: {}
    });
    difusor.emitirDashboardActualizado = (payload) => {
      eventosDashboard.push(payload);
    };
    const hastaUtc = new Date(Date.now() + 60 * 1000).toISOString();

    assert.equal(
      difusor.sincronizarVencimientoDescarteTemporalDesdeDashboard({
        alertasDescartadas: [
          {
            monitorId: 77,
            descarteOperativo: {
              vigente: true,
              descartadaHastaUtc: hastaUtc
            }
          }
        ]
      }),
      true
    );
    assert.ok(temporizadorProgramado);
    assert.equal(temporizadorProgramado.unrefLlamado, true);
    assert.equal(temporizadorProgramado.retrasoMs >= 1000, true);

    const hastaMasTardeUtc = new Date(Date.now() + 120 * 1000).toISOString();
    assert.equal(
      difusor.programarVencimientoDescarteTemporal(hastaMasTardeUtc, {
        monitorId: 88
      }),
      false
    );
    assert.equal(temporizadorLimpiado, null);

    temporizadorProgramado.callback();
    assert.equal(eventosDashboard.length, 1);
    assert.equal(
      eventosDashboard[0].motivoPublicacion,
      'vencimiento_descarte_alerta_activa'
    );
    assert.equal(eventosDashboard[0].monitorId, 77);
    assert.ok(eventosDashboard[0].sincronizadoEn);
  } finally {
    globalThis.setTimeout = setTimeoutOriginal;
    globalThis.clearTimeout = clearTimeoutOriginal;
  }
}

function prepararMonitorDashboard(monitor) {
  return {
    ...monitor,
    serializarEstadoActualRuntimeVisible() {
      return null;
    },
    resolverNivelPertenencia() {
      return monitor.scope.nivelPertenencia;
    },
    obtenerDestinoPrincipal() {
      return `${monitor.nombre}.local`;
    },
    estadoActualRuntime: {
      ejecutadoTodavia: true,
      estado: 'indisponible'
    }
  };
}

async function verificarDashboardSeparaAlertasDescartadas() {
  const monitorVisible = crearDefinicionMonitor({
    id: 90,
    tipo: 'ping',
    nombre: 'ping-visible'
  });
  const monitorDescartado = crearDefinicionMonitor({
    id: 91,
    tipo: 'tcp',
    nombre: 'tcp-descartado-dashboard'
  });
  const crearAlerta = ({ monitor, descartada = false }) =>
    new AlertaActivaMonitor({
      monitor_id: monitor.id,
      tenant_id: monitor.scope.tenantId,
      empresa_id: monitor.scope.empresaId,
      sitio_id: monitor.scope.sitioId,
      version_catalogo: monitor.version,
      tipo_monitor: monitor.tipo,
      estado_alerta: 'activa',
      estado_detectado: 'indisponible',
      codigo_ultimo_resultado: `${monitor.tipo}_timeout`,
      mensaje_ultimo_resultado: 'No responde.',
      valido_desde_utc: '2026-01-01 00:00:00',
      ultima_confirmacion_utc: descartada
        ? '2026-01-01 00:04:00'
        : '2026-01-01 00:05:00',
      ultima_ejecucion_utc: descartada
        ? '2026-01-01 00:04:00'
        : '2026-01-01 00:05:00',
      contador_repeticiones: descartada ? 7 : 3,
      payload_alerta: JSON.stringify({
        nombreMonitor: monitor.nombre,
        codigoResultado: `${monitor.tipo}_timeout`,
        mensajeResultado: 'No responde.'
      }),
      descartada_dashboard: descartada ? 1 : 0,
      motivo_descarte: descartada ? 'Ventana operativa aceptada.' : '',
      descartada_por_usuario_id: descartada ? 12 : null,
      descartada_en_utc: descartada ? '2026-01-01 00:02:00' : null,
      descartada_hasta_utc: null
    });
  const servicioDashboard = new ServicioDashboard({
    repositorioMonitores: {
      async listarVisibles() {
        return [
          prepararMonitorDashboard(monitorVisible),
          prepararMonitorDashboard(monitorDescartado)
        ];
      }
    },
    repositorioAlertasActivasMonitor: {
      async listarPorMonitorIds() {
        return [
          crearAlerta({ monitor: monitorVisible }),
          crearAlerta({ monitor: monitorDescartado, descartada: true })
        ];
      }
    },
    repositorioUsuarios: {
      async buscarPorId(idUsuario) {
        assert.equal(idUsuario, 12);
        return {
          id: 12,
          usuario: 'hector',
          nombreMostrar: 'Hector',
          nombreCompleto: 'Hector Operaciones',
          obtenerNombreVisible() {
            return this.nombreMostrar;
          }
        };
      }
    },
    repositorioZonasDns: null,
    repositorioRegistrosDns: null,
    servicioAutorizacion: new ServicioAutorizacion()
  });
  const dashboard = await servicioDashboard.construirDashboardBase(
    {
      permisos: new PermisosUsuario({
        ver: true,
        verMonitores: true
      })
    },
    { limiteAlertasDestacadas: 8 }
  );

  assert.equal(dashboard.resumenMonitores.totalAlertasActivas, 2);
  assert.equal(dashboard.resumenMonitores.totalAlertasVisibles, 1);
  assert.equal(dashboard.resumenMonitores.totalAlertasDescartadas, 1);
  assert.equal(dashboard.alertasActivas.length, 1);
  assert.equal(dashboard.alertasActivas[0].monitorId, 90);
  assert.equal(dashboard.alertasDestacadas.length, 1);
  assert.equal(dashboard.alertasDestacadas[0].monitorId, 90);
  assert.equal(dashboard.alertasDescartadas.length, 1);
  assert.equal(dashboard.alertasDescartadas[0].monitorId, 91);
  assert.equal(
    dashboard.alertasDescartadas[0].descarteOperativo.motivo,
    'Ventana operativa aceptada.'
  );
  assert.deepEqual(dashboard.alertasDescartadas[0].descarteOperativo.usuario, {
    id: 12,
    usuario: 'hector',
    nombreVisible: 'Hector',
    nombreMostrar: 'Hector',
    nombreCompleto: 'Hector Operaciones'
  });
  assert.equal(dashboard.resumenSalud.titulo, '1 alertas visibles');
}

async function verificarDescartesTemporalesEnDashboard() {
  const ahora = Date.now();
  const descarteVigenteHasta = new Date(ahora + 60 * 60 * 1000).toISOString();
  const descarteVencidoHasta = new Date(ahora - 60 * 60 * 1000).toISOString();
  const monitorTemporalVigente = crearDefinicionMonitor({
    id: 92,
    tipo: 'tcp',
    nombre: 'tcp-temporal-vigente'
  });
  const monitorTemporalVencido = crearDefinicionMonitor({
    id: 93,
    tipo: 'tcp',
    nombre: 'tcp-temporal-vencido'
  });
  const crearAlertaTemporal = ({ monitor, hastaUtc }) =>
    new AlertaActivaMonitor({
      monitor_id: monitor.id,
      tenant_id: monitor.scope.tenantId,
      empresa_id: monitor.scope.empresaId,
      sitio_id: monitor.scope.sitioId,
      version_catalogo: monitor.version,
      tipo_monitor: monitor.tipo,
      estado_alerta: 'activa',
      estado_detectado: 'indisponible',
      codigo_ultimo_resultado: 'tcp_timeout',
      mensaje_ultimo_resultado: 'No responde.',
      valido_desde_utc: '2026-01-01 00:00:00',
      ultima_confirmacion_utc: '2026-01-01 00:05:00',
      ultima_ejecucion_utc: '2026-01-01 00:05:00',
      contador_repeticiones: 2,
      payload_alerta: JSON.stringify({
        nombreMonitor: monitor.nombre,
        codigoResultado: 'tcp_timeout',
        mensajeResultado: 'No responde.'
      }),
      descartada_dashboard: 1,
      motivo_descarte: `Descarte temporal de ${monitor.nombre}.`,
      descartada_por_usuario_id: 12,
      descartada_en_utc: '2026-01-01 00:02:00',
      descartada_hasta_utc: hastaUtc
    });
  const alertaVigente = crearAlertaTemporal({
    monitor: monitorTemporalVigente,
    hastaUtc: descarteVigenteHasta
  });
  const alertaVencida = crearAlertaTemporal({
    monitor: monitorTemporalVencido,
    hastaUtc: descarteVencidoHasta
  });

  assert.equal(alertaVigente.obtenerDescarteOperativo().descartada, true);
  assert.equal(alertaVigente.obtenerDescarteOperativo().vigente, true);
  assert.equal(alertaVigente.obtenerDescarteOperativo().indefinida, false);
  assert.equal(alertaVencida.obtenerDescarteOperativo().descartada, true);
  assert.equal(alertaVencida.obtenerDescarteOperativo().vigente, false);
  assert.equal(alertaVencida.obtenerDescarteOperativo().indefinida, false);

  const servicioDashboard = new ServicioDashboard({
    repositorioMonitores: {
      async listarVisibles() {
        return [
          prepararMonitorDashboard(monitorTemporalVigente),
          prepararMonitorDashboard(monitorTemporalVencido)
        ];
      }
    },
    repositorioAlertasActivasMonitor: {
      async listarPorMonitorIds() {
        return [alertaVigente, alertaVencida];
      }
    },
    repositorioZonasDns: null,
    repositorioRegistrosDns: null,
    servicioAutorizacion: new ServicioAutorizacion()
  });
  const dashboard = await servicioDashboard.construirDashboardBase(
    {
      permisos: new PermisosUsuario({
        ver: true,
        verMonitores: true
      })
    },
    { limiteAlertasDestacadas: 8 }
  );

  assert.equal(dashboard.resumenMonitores.totalAlertasActivas, 2);
  assert.equal(dashboard.resumenMonitores.totalAlertasVisibles, 1);
  assert.equal(dashboard.resumenMonitores.totalAlertasDescartadas, 1);
  assert.equal(dashboard.alertasActivas.length, 1);
  assert.equal(dashboard.alertasActivas[0].monitorId, 93);
  assert.equal(dashboard.alertasActivas[0].descarteOperativo.descartada, true);
  assert.equal(dashboard.alertasActivas[0].descarteOperativo.vigente, false);
  assert.equal(dashboard.alertasDescartadas.length, 1);
  assert.equal(dashboard.alertasDescartadas[0].monitorId, 92);
  assert.equal(dashboard.alertasDescartadas[0].descarteOperativo.vigente, true);
}

async function verificarInterpretacionEstadoRuntime() {
  const validador = new ValidadorMonitor();
  const definicionLogicaNormalizada = validador.normalizarDefinicionBase({
    tenantId: 1,
    empresaId: 10,
    sitioId: null,
    nombre: 'booleano-a',
    tipo: 'booleano',
    interpretacionEstado: 'invertida',
    configuracionLogica: crearConfiguracionMonitorLogicoBase({
      expresion: 'A',
      dependencias: [{ variable: 'A', fuente: 'monitor', monitorId: 10 }],
      mensajeFallo: 'La condición lógica no se cumple.'
    })
  });

  assert.equal(definicionLogicaNormalizada.interpretacionEstado, 'normal');
  assert.throws(
    () => validador.normalizarDefinicionBase({
      tenantId: 1,
      empresaId: 10,
      sitioId: null,
      nombre: 'ping-invalido',
      tipo: 'ping',
      interpretacionEstado: 'rara',
      host: 'ping.example.local'
    }),
    /interpretación del estado/
  );

  const catalogo = new CatalogoMonitoresRuntime({
    generadoEn: '2026-01-01T00:00:00.000Z',
    monitores: [
      {
        ...crearDefinicionMonitor({ id: 101, tipo: 'tcp', nombre: 'tcp-abierto' }),
        interpretacionEstado: 'invertida'
      },
      {
        ...crearDefinicionMonitor({ id: 102, tipo: 'tcp', nombre: 'tcp-cerrado' }),
        interpretacionEstado: 'invertida'
      }
    ]
  });
  const motor = new MotorMonitores({
    registroEjecutores: {
      obtener() {
        return {
          async ejecutar(monitor) {
            if (monitor.id === 101) {
              return {
                monitorId: monitor.id,
                nombre: monitor.nombre,
                tipo: monitor.tipo,
                ejecutadoEnUtc: '2026-01-01T00:00:00.000Z',
                finalizadoEnUtc: '2026-01-01T00:00:01.000Z',
                duracionTotalMs: 1000,
                exito: true,
                estadoDetectado: 'disponible',
                codigoResultado: 'conexion_tcp_ok',
                mensajeResultado: 'Conexión TCP establecida.',
                detalleError: null,
                metricaPrincipal: {},
                intentos: []
              };
            }

            return {
              monitorId: monitor.id,
              nombre: monitor.nombre,
              tipo: monitor.tipo,
              ejecutadoEnUtc: '2026-01-01T00:00:00.000Z',
              finalizadoEnUtc: '2026-01-01T00:00:01.000Z',
              duracionTotalMs: 1000,
              exito: false,
              estadoDetectado: 'indisponible',
              codigoResultado: 'timeout_tcp',
              mensajeResultado: 'Timeout durante la conexión TCP.',
              detalleError: {
                codigo: 'TIMEOUT',
                mensaje: 'El socket agotó el tiempo máximo configurado.'
              },
              metricaPrincipal: {},
              intentos: []
            };
          }
        };
      }
    }
  });
  const lote = await motor.ejecutarMonitores({
    catalogoOperativo: catalogo,
    candidatos: [
      { monitorId: 101 },
      { monitorId: 102 }
    ]
  });
  const falloPorqueRespondio = lote.resultados.find(
    (resultado) => resultado.monitorId === 101
  );
  const disponiblePorqueNoRespondio = lote.resultados.find(
    (resultado) => resultado.monitorId === 102
  );

  assert.equal(lote.totalExitosos, 1);
  assert.equal(lote.totalFallidos, 1);
  assert.equal(falloPorqueRespondio.estadoDetectado, 'indisponible');
  assert.equal(falloPorqueRespondio.estadoTecnicoDetectado, 'disponible');
  assert.equal(falloPorqueRespondio.exito, false);
  assert.equal(falloPorqueRespondio.exitoTecnico, true);
  assert.equal(falloPorqueRespondio.codigoResultado, 'fallo_por_respuesta');
  assert.equal(falloPorqueRespondio.codigoResultadoTecnico, 'conexion_tcp_ok');
  assert.equal(falloPorqueRespondio.mensajeResultado, 'Falló porque respondió.');
  assert.equal(
    falloPorqueRespondio.interpretacionResultado.mensajeInterpretacion,
    'Falló porque respondió.'
  );
  assert.equal(disponiblePorqueNoRespondio.estadoDetectado, 'disponible');
  assert.equal(
    disponiblePorqueNoRespondio.estadoTecnicoDetectado,
    'indisponible'
  );
  assert.equal(disponiblePorqueNoRespondio.exito, true);
  assert.equal(disponiblePorqueNoRespondio.exitoTecnico, false);
  assert.equal(
    disponiblePorqueNoRespondio.codigoResultadoTecnico,
    'timeout_tcp'
  );
  assert.equal(disponiblePorqueNoRespondio.detalleError, null);
  assert.equal(disponiblePorqueNoRespondio.detalleErrorTecnico.codigo, 'TIMEOUT');

  const almacen = new AlmacenEstadoActual({ catalogoOperativo: catalogo });
  const estadosGuardados = [];
  const aplicadorEstado = new AplicadorResultadosEstadoActual({
    repositorioEstadoActualMonitores: {
      async guardarEstadosActuales(estados) {
        estadosGuardados.push(...estados.map((estado) => estado.serializar()));
        return estados.length;
      }
    }
  });
  const persistenciaEstado = await aplicadorEstado.aplicar({
    almacenEstadoActual: almacen,
    resultados: lote.resultados
  });
  const estadoInvertido = almacen.buscarPorMonitorId(101);

  assert.equal(persistenciaEstado.totalPersistidos, 2);
  assert.equal(estadoInvertido.estado, 'indisponible');
  assert.equal(estadoInvertido.resultadoActual.exitoTecnico, true);
  assert.equal(estadoInvertido.resultadoActual.estadoTecnicoDetectado, 'disponible');
  assert.equal(estadoInvertido.resultadoActual.codigoResultadoTecnico, 'conexion_tcp_ok');
  assert.equal(
    estadoInvertido.resultadoActual.interpretacionResultado.mensajeInterpretacion,
    'Falló porque respondió.'
  );
  assert.equal(estadosGuardados[0].resultadoActual.resultadoInterpretado, true);

  const servicioEventos = new ServicioEventosMonitores({
    repositorioEventosMonitor: {
      async listarUltimosPorMonitorIds() {
        return [];
      },
      async guardarEventosDetallado(eventos) {
        return {
          totalPersistidos: eventos.length,
          eventosPersistidos: eventos
        };
      }
    },
    servicioConfiguracionPortal: null
  });
  const persistenciaEventos = await servicioEventos.guardarResultadosEjecucion({
    catalogoOperativo: catalogo,
    resultados: lote.resultados
  });
  const eventoInvertido = persistenciaEventos.eventosPersistidos.find(
    (evento) => evento.monitorId === 101
  );
  const eventoInvertidoSerializado = eventoInvertido.serializarResumen();

  assert.equal(eventoInvertido.estadoDetectado, 'indisponible');
  assert.equal(eventoInvertido.exito, false);
  assert.equal(eventoInvertidoSerializado.exitoTecnico, true);
  assert.equal(eventoInvertido.payloadEvento.estadoTecnicoDetectado, 'disponible');
  assert.equal(eventoInvertido.payloadEvento.exitoTecnico, true);
  assert.equal(eventoInvertido.payloadEvento.codigoResultadoTecnico, 'conexion_tcp_ok');
  assert.equal(
    eventoInvertido.payloadEvento.descripcionFallo,
    'Fallo operativo de tcp-abierto'
  );
  assert.equal(
    eventoInvertidoSerializado.posibleSolucion,
    'Accion sugerida para tcp-abierto'
  );

  const gestorAlertas = new GestorAlertasActivasMonitor({
    repositorioAlertasActivasMonitor: {
      async listarPorMonitorIds() {
        return [];
      },
      async guardarAlertas(alertas) {
        return alertas.length;
      },
      async eliminarPorMonitorIds(idsMonitor) {
        return idsMonitor.length;
      }
    }
  });
  const persistenciaAlertas = await gestorAlertas.aplicarResultados({
    catalogoOperativo: catalogo,
    resultados: lote.resultados
  });

  assert.equal(persistenciaAlertas.totalAperturas, 1);
  assert.equal(persistenciaAlertas.totalCierres, 0);
  assert.equal(
    persistenciaAlertas.alertasPersistidas[0].payloadAlerta.codigoResultadoTecnico,
    'conexion_tcp_ok'
  );
  assert.equal(
    persistenciaAlertas.alertasPersistidas[0].payloadAlerta.exitoTecnico,
    true
  );
  assert.equal(persistenciaAlertas.alertasPersistidas[0].exitoTecnico, true);
  assert.equal(
    persistenciaAlertas.alertasPersistidas[0].payloadAlerta.descripcionFallo,
    'Fallo operativo de tcp-abierto'
  );
  assert.equal(
    persistenciaAlertas.alertasPersistidas[0].posibleSolucion,
    'Accion sugerida para tcp-abierto'
  );

  const tramosGuardados = [];
  const gestorHistorico = new GestorHistoricoMonitores({
    repositorioHistoricoMonitores: {
      async listarUltimosPorMonitorIds() {
        return [];
      },
      async guardarTramos(tramos) {
        tramosGuardados.push(...tramos.map((tramo) => tramo.serializarResumen()));
        return tramos.length;
      },
      async actualizarTramo() {
        return 1;
      }
    },
    servicioConfiguracionPortal: {
      async asegurarActualizada() {
        return {
          obtenerConfiguracionMonitores() {
            return {};
          }
        };
      }
    }
  });
  const persistenciaHistorico = await gestorHistorico.aplicarResultados({
    catalogoOperativo: catalogo,
    resultados: lote.resultados,
    persistenciaEventos
  });

  assert.equal(persistenciaHistorico.totalPersistidos, 2);
  assert.equal(
    tramosGuardados.find((tramo) => tramo.monitorId === 101)
      .payloadTramo.codigoResultadoTecnico,
    'conexion_tcp_ok'
  );
  assert.equal(
    tramosGuardados.find((tramo) => tramo.monitorId === 101)
      .payloadTramo.exitoTecnico,
    true
  );
  assert.equal(
    tramosGuardados.find((tramo) => tramo.monitorId === 101).exitoTecnico,
    true
  );
  assert.equal(
    tramosGuardados.find((tramo) => tramo.monitorId === 101)
      .payloadTramo.descripcionFallo,
    'Fallo operativo de tcp-abierto'
  );
  assert.equal(
    tramosGuardados.find((tramo) => tramo.monitorId === 101).posibleSolucion,
    'Accion sugerida para tcp-abierto'
  );

  const compactador = new CompactadorHistorico();
  assert.equal(
    compactador.normalizarFamiliaResultado({
      tipoMonitor: 'tcp',
      codigoResultado: 'fallo_por_respuesta'
    }),
    'interpretacion_fallo_por_respuesta'
  );
}

async function verificarDescarteOperativoAlertaActiva() {
  const alertaExistente = new AlertaActivaMonitor({
    monitor_id: 55,
    tenant_id: 1,
    empresa_id: 10,
    sitio_id: 20,
    version_catalogo: 'v-55',
    tipo_monitor: 'tcp',
    estado_alerta: 'activa',
    estado_detectado: 'indisponible',
    codigo_ultimo_resultado: 'tcp_timeout',
    mensaje_ultimo_resultado: 'No se pudo abrir el puerto.',
    valido_desde_utc: '2026-01-01 00:00:00',
    ultima_confirmacion_utc: '2026-01-01 00:00:00',
    ultima_ejecucion_utc: '2026-01-01 00:00:00',
    contador_repeticiones: 2,
    payload_alerta: JSON.stringify({
      nombreMonitor: 'tcp-descartado',
      codigoResultado: 'tcp_timeout',
      mensajeResultado: 'No se pudo abrir el puerto.'
    }),
    descartada_dashboard: 1,
    motivo_descarte: 'El proveedor ya confirmó ventana de mantenimiento.',
    descartada_por_usuario_id: 7,
    descartada_en_utc: '2026-01-01 00:05:00',
    descartada_hasta_utc: null
  });
  const alertasGuardadas = [];
  const gestorAlertas = new GestorAlertasActivasMonitor({
    repositorioAlertasActivasMonitor: {
      async listarPorMonitorIds() {
        return [alertaExistente];
      },
      async guardarAlertas(alertas) {
        alertasGuardadas.push(
          ...alertas.map((alerta) => alerta.serializarResumen())
        );
        return alertas.length;
      },
      async eliminarPorMonitorIds() {
        throw new Error('No debe cerrarse una alerta que sigue fallando.');
      }
    }
  });
  const catalogo = {
    buscarPorId() {
      return crearDefinicionMonitor({
        id: 55,
        tipo: 'tcp',
        nombre: 'tcp-descartado'
      });
    }
  };
  const resumen = await gestorAlertas.aplicarResultados({
    catalogoOperativo: catalogo,
    resultados: [
      {
        monitorId: 55,
        nombre: 'tcp-descartado',
        tipo: 'tcp',
        versionCatalogo: 'v-55',
        scope: {
          tenantId: 1,
          empresaId: 10,
          sitioId: 20,
          nivelPertenencia: 'sitio'
        },
        estadoDetectado: 'indisponible',
        exito: false,
        codigoResultado: 'tcp_timeout',
        mensajeResultado: 'El puerto sigue sin responder.',
        finalizadoEnUtc: '2026-01-01T00:10:00.000Z'
      }
    ]
  });

  assert.equal(resumen.totalConfirmaciones, 1);
  assert.equal(resumen.totalAperturas, 0);
  assert.equal(alertasGuardadas.length, 1);
  assert.equal(alertasGuardadas[0].contadorRepeticiones, 3);
  assert.equal(alertasGuardadas[0].descarteOperativo.descartada, true);
  assert.equal(alertasGuardadas[0].descarteOperativo.vigente, true);
  assert.equal(alertasGuardadas[0].descarteOperativo.indefinida, true);
  assert.equal(
    alertasGuardadas[0].descarteOperativo.motivo,
    'El proveedor ya confirmó ventana de mantenimiento.'
  );
  assert.equal(alertasGuardadas[0].descarteOperativo.usuarioId, 7);
  assert.equal(
    alertasGuardadas[0].descarteOperativo.descartadaEnUtc,
    '2026-01-01T00:05:00.000Z'
  );
}

async function verificarRearmeYRecaidaAlertaDescartada() {
  const alertaDescartada = new AlertaActivaMonitor({
    monitor_id: 56,
    tenant_id: 1,
    empresa_id: 10,
    sitio_id: null,
    version_catalogo: 'v-56',
    tipo_monitor: 'ping',
    estado_alerta: 'activa',
    estado_detectado: 'indisponible',
    codigo_ultimo_resultado: 'ping_timeout',
    mensaje_ultimo_resultado: 'No responde ICMP.',
    valido_desde_utc: '2026-01-01 00:00:00',
    ultima_confirmacion_utc: '2026-01-01 00:05:00',
    ultima_ejecucion_utc: '2026-01-01 00:05:00',
    contador_repeticiones: 4,
    payload_alerta: JSON.stringify({
      nombreMonitor: 'ping-rearme',
      codigoResultado: 'ping_timeout',
      mensajeResultado: 'No responde ICMP.'
    }),
    descartada_dashboard: 1,
    motivo_descarte: 'Mantenimiento aceptado por operaciones.',
    descartada_por_usuario_id: 9,
    descartada_en_utc: '2026-01-01 00:06:00',
    descartada_hasta_utc: null
  });
  const catalogo = {
    buscarPorId() {
      return crearDefinicionMonitor({
        id: 56,
        tipo: 'ping',
        nombre: 'ping-rearme'
      });
    }
  };
  const idsEliminados = [];
  const gestorCierre = new GestorAlertasActivasMonitor({
    repositorioAlertasActivasMonitor: {
      async listarPorMonitorIds() {
        return [alertaDescartada];
      },
      async guardarAlertas() {
        throw new Error('No debe persistirse una alerta cuando recupera.');
      },
      async eliminarPorMonitorIds(idsMonitor) {
        idsEliminados.push(...idsMonitor);
        return idsMonitor.length;
      }
    }
  });
  const resumenCierre = await gestorCierre.aplicarResultados({
    catalogoOperativo: catalogo,
    resultados: [
      {
        monitorId: 56,
        nombre: 'ping-rearme',
        tipo: 'ping',
        versionCatalogo: 'v-56',
        scope: {
          tenantId: 1,
          empresaId: 10,
          sitioId: null,
          nivelPertenencia: 'empresa'
        },
        estadoDetectado: 'disponible',
        exito: true,
        codigoResultado: 'ping_ok',
        mensajeResultado: 'El host responde.',
        finalizadoEnUtc: '2026-01-01T00:10:00.000Z'
      }
    ]
  });

  assert.equal(resumenCierre.totalCierres, 1);
  assert.equal(resumenCierre.totalEliminadas, 1);
  assert.deepEqual(idsEliminados, [56]);
  assert.deepEqual(resumenCierre.monitorIdsCerrados, [56]);
  assert.equal(resumenCierre.alertasPersistidas.length, 0);
  assert.equal(
    resumenCierre.cierresAlerta[0].descarteOperativo.descartada,
    true
  );
  assert.equal(
    resumenCierre.cierresAlerta[0].descarteOperativo.motivo,
    'Mantenimiento aceptado por operaciones.'
  );

  const alertasNuevas = [];
  const gestorRecaida = new GestorAlertasActivasMonitor({
    repositorioAlertasActivasMonitor: {
      async listarPorMonitorIds() {
        return [];
      },
      async guardarAlertas(alertas) {
        alertasNuevas.push(...alertas.map((alerta) => alerta.serializarResumen()));
        return alertas.length;
      },
      async eliminarPorMonitorIds() {
        throw new Error('No debe cerrarse una alerta nueva en fallo.');
      }
    }
  });
  const resumenRecaida = await gestorRecaida.aplicarResultados({
    catalogoOperativo: catalogo,
    resultados: [
      {
        monitorId: 56,
        nombre: 'ping-rearme',
        tipo: 'ping',
        versionCatalogo: 'v-56',
        scope: {
          tenantId: 1,
          empresaId: 10,
          sitioId: null,
          nivelPertenencia: 'empresa'
        },
        estadoDetectado: 'indisponible',
        exito: false,
        codigoResultado: 'ping_timeout',
        mensajeResultado: 'Vuelve a no responder.',
        finalizadoEnUtc: '2026-01-01T00:15:00.000Z'
      }
    ]
  });

  assert.equal(resumenRecaida.totalAperturas, 1);
  assert.equal(resumenRecaida.totalConfirmaciones, 0);
  assert.equal(alertasNuevas.length, 1);
  assert.equal(alertasNuevas[0].contadorRepeticiones, 1);
  assert.equal(alertasNuevas[0].descarteOperativo.descartada, false);
  assert.equal(alertasNuevas[0].descarteOperativo.vigente, false);
  assert.equal(alertasNuevas[0].descarteOperativo.indefinida, false);
  assert.equal(alertasNuevas[0].descarteOperativo.motivo, '');
  assert.equal(alertasNuevas[0].descarteOperativo.usuarioId, null);
}

function verificarDistribucionTipoFuturo() {
  const definicionesTipo = listarDefinicionesTiposMonitor();
  for (const definicion of definicionesTipo) {
    assert.ok(definicion.valor, 'Cada tipo de monitor debe declarar valor.');
    assert.ok(definicion.etiqueta, 'Cada tipo de monitor debe declarar etiqueta.');
    assert.ok(definicion.icono, 'Cada tipo de monitor debe declarar icono.');
    assert.ok(
      definicion.ui?.ayudaFormulario,
      `El tipo ${definicion.valor} debe declarar ayuda de formulario.`
    );
    assert.ok(
      definicion.ui?.etiquetaNuevaEntidad,
      `El tipo ${definicion.valor} debe declarar etiqueta de alta.`
    );
  }

  const porTipo = agruparMonitoresPorTipo([
    { tipo: 'ping' },
    { tipo: 'tcp' },
    { tipo: 'booleano' }
  ]);

  assert.equal(porTipo.ping, 1);
  assert.equal(porTipo.tcp, 1);
  assert.equal(porTipo.booleano, 1);

  const repositorioMonitores = new RepositorioMonitores({});
  assert.deepEqual(
    repositorioMonitores.construirDistribucionTipos([
      { tipo: 'ping', total: 1 },
      { tipo: 'tcp', total: 1 },
      { tipo: 'booleano', total: 2 }
    ]),
    { ping: 1, tcp: 1, booleano: 2 }
  );
}

function verificarEjecutoresExtensibles() {
  const registro = new RegistroEjecutoresMonitor({
    ejecutores: [
      {
        tipoMonitor: 'booleano',
        async ejecutar() {
          return { exito: true };
        }
      }
    ]
  });

  assert.deepEqual(registro.serializarTiposRegistrados(), ['booleano']);
  assert.equal(registro.tieneEjecutor('booleano'), true);
  assert.equal(registro.tieneEjecutor('ping'), false);
}

function verificarCompactacionEventosUsaExitoTecnico() {
  const servicioEventos = new ServicioEventosMonitores({
    repositorioEventosMonitor: null,
    servicioConfiguracionPortal: null
  });
  const valorReferencia = servicioEventos.resolverValorReferenciaMs({
    tipoMonitor: 'ping',
    exito: false,
    exitoTecnico: true,
    duracionTotalMs: 950,
    payloadEvento: {
      metricaPrincipal: { rttMs: 42 },
      protocolo: { timeoutMs: 1200 }
    }
  });

  assert.equal(
    valorReferencia,
    42,
    'La compactacion debe usar RTT tecnico aunque el estado operativo sea fallo.'
  );
}

function verificarContratoMonitorLogico() {
  const configuracion = crearConfiguracionMonitorLogicoBase({
    estadoInicial: 'indisponible',
    layoutVisual: {
      nodos: [
        { id: 'entrada-a', tipo: 'entrada', x: 8, y: 32 },
        { id: 'expresion', tipo: 'operador', x: 39, y: 32 },
        { id: 'salida', tipo: 'salida', x: 70, y: 32 }
      ],
      conexiones: [
        { desde: 'entrada-a', hasta: 'expresion' },
        { desde: 'expresion', hasta: 'salida' }
      ],
      escenarios: [{ A: true }]
    }
  });

  assert.equal(configuracion.version, VERSION_CONFIGURACION_MONITOR_LOGICO);
  assert.equal(configuracion.expresion, '');
  assert.deepEqual(configuracion.variables, []);
  assert.deepEqual(configuracion.dependencias, []);
  assert.equal(configuracion.mensajeFallo, '');
  assert.equal(configuracion.estadoInicial, 'indisponible');
  assert.equal(configuracion.retardoSenalSegundos, 0);
  assert.equal(configuracion.politicaEntradasIncompletas, 'conservar_salida');
  assert.equal(configuracion.layoutVisual.version, VERSION_LAYOUT_VISUAL_MONITOR_LOGICO);
  assert.equal(
    configuracion.layoutVisual.grafoLogico.version,
    VERSION_GRAFO_LOGICO_MONITOR_LOGICO
  );
  assert.equal(configuracion.layoutVisual.nodos.length, 3);
  assert.equal(configuracion.layoutVisual.conexiones.length, 2);
  assert.equal(configuracion.layoutVisual.grafoLogico.salidaId, 'salida');
  assert.equal(configuracion.layoutVisual.grafoLogico.valido, true);
  assert.equal(configuracion.layoutVisual.grafoLogico.expresionCompilada, 'A');
  assert.deepEqual(configuracion.layoutVisual.grafoLogico.variablesUsadas, ['A']);
  assert.equal(Object.hasOwn(configuracion.layoutVisual, 'escenarios'), false);
  assert.deepEqual(FUENTES_SENAL_MONITOR_LOGICO, [
    'monitor',
    'monitor_federado',
    'agente',
    'alerta_agente',
    'evento_plataforma'
  ]);

  const configuracionDefensiva = crearConfiguracionMonitorLogicoBase({
    estadoInicial: 'oscuro',
    politicaEntradasIncompletas: 'inventada',
    variables: 'A',
    dependencias: { monitorId: 1 },
    layoutVisual: null
  });

  assert.equal(configuracionDefensiva.estadoInicial, 'disponible');
  assert.equal(configuracionDefensiva.retardoSenalSegundos, 0);
  assert.equal(
    configuracionDefensiva.politicaEntradasIncompletas,
    'conservar_salida'
  );
  assert.deepEqual(configuracionDefensiva.variables, []);
  assert.deepEqual(configuracionDefensiva.dependencias, []);
  assert.deepEqual(configuracionDefensiva.layoutVisual.nodos, []);
  assert.deepEqual(configuracionDefensiva.layoutVisual.conexiones, []);
  assert.deepEqual(configuracionDefensiva.layoutVisual.grafoLogico.nodos, []);
  assert.deepEqual(configuracionDefensiva.layoutVisual.grafoLogico.conexiones, []);

  const grafoActualCompatible = normalizarGrafoLogicoVisual({
    nodos: [
      { id: 'entrada-a', tipo: 'entrada', x: 8, y: 32 },
      { id: 'expresion', tipo: 'operador', x: 39, y: 32 },
      { id: 'salida', tipo: 'salida', x: 70, y: 32 }
    ],
    conexiones: [
      { desde: 'entrada-a', hasta: 'expresion' },
      { desde: 'expresion', hasta: 'salida' }
    ]
  });

  assert.equal(grafoActualCompatible.valido, true);
  assert.equal(grafoActualCompatible.expresionCompilada, 'A');
  assert.deepEqual(
    grafoActualCompatible.nodos.map((nodo) => nodo.tipo),
    ['entrada', 'expresion', 'salida']
  );
  assert.equal(grafoActualCompatible.salidaId, 'salida');

  const grafoCompuesto = normalizarGrafoLogicoVisual({
    nodos: [
      { id: 'entrada-a', tipo: 'entrada', variable: 'A' },
      { id: 'entrada-b', tipo: 'entrada', variable: 'B' },
      { id: 'entrada-c', tipo: 'entrada', variable: 'C' },
      { id: 'or-1', tipo: 'or' },
      { id: 'not-1', tipo: 'not' },
      { id: 'and-1', tipo: 'and' },
      { id: 'salida', tipo: 'salida' }
    ],
    conexiones: [
      { desde: 'entrada-a', hasta: 'or-1' },
      { desde: 'entrada-b', hasta: 'or-1' },
      { desde: 'entrada-c', hasta: 'not-1' },
      { desde: 'or-1', hasta: 'and-1' },
      { desde: 'not-1', hasta: 'and-1' },
      { desde: 'and-1', hasta: 'salida' }
    ]
  });

  assert.equal(grafoCompuesto.valido, true);
  assert.equal(grafoCompuesto.expresionCompilada, '(A OR B) AND NOT C');
  assert.deepEqual(grafoCompuesto.variablesUsadas, ['A', 'B', 'C']);
  assert.deepEqual(
    compilarGrafoLogicoAExpresion(grafoCompuesto),
    {
      expresion: '(A OR B) AND NOT C',
      variablesUsadas: ['A', 'B', 'C']
    }
  );

  const grafoInvalido = normalizarGrafoLogicoVisual({
    nodos: [
      { id: 'A', tipo: 'entrada' },
      { id: 'salida-1', tipo: 'salida' },
      { id: 'salida-2', tipo: 'salida' },
      { id: 'and-1', tipo: 'and' }
    ],
    conexiones: [
      { desde: 'A', hasta: 'and-1' },
      { desde: 'and-1', hasta: 'A' },
      { desde: 'fantasma', hasta: 'salida-1' }
    ]
  });

  assert.equal(grafoInvalido.valido, false);
  assert.ok(
    grafoInvalido.errores.some((error) =>
      error.includes('solo puede tener una salida')
    )
  );
  assert.ok(
    grafoInvalido.errores.some((error) =>
      error.includes('nodo inexistente')
    )
  );
  assert.ok(
    grafoInvalido.errores.some((error) =>
      error.includes('requiere al menos dos entradas')
    )
  );
  assert.ok(
    grafoInvalido.errores.some((error) =>
      error.includes('ciclo interno')
    )
  );
  assert.equal(grafoInvalido.expresionCompilada, null);
  assert.throws(
    () => compilarGrafoLogicoAExpresion(grafoInvalido),
    /no puede compilarse/
  );
}

function verificarParserMonitorLogico() {
  const analisis = analizarExpresionMonitorLogico('(!A + B)*(C*D)', [
    'A',
    'B',
    'C',
    'D'
  ]);

  assert.equal(analisis.expresionNormalizada, '(NOT A OR B) AND (C AND D)');
  assert.deepEqual(analisis.variablesUsadas, ['A', 'B', 'C', 'D']);
  assert.throws(
    () => analizarExpresionMonitorLogico('', ['A']),
    /expresión lógica no puede estar vacía/
  );
  assert.throws(
    () => analizarExpresionMonitorLogico('(A OR B', ['A', 'B']),
    /Falta cerrar un paréntesis/
  );
  assert.throws(
    () => analizarExpresionMonitorLogico('A AND OR B', ['A', 'B']),
    /Operador duplicado/
  );
  assert.throws(
    () => analizarExpresionMonitorLogico('A OR Z', ['A']),
    /Variable no definida/
  );

  const validadorMonitor = new ValidadorMonitor();
  const configuracion = validadorMonitor.normalizarConfiguracionTecnica(
    'booleano',
    {
      expresion: '!A + B',
      dependencias: [
        { variable: 'A', fuente: 'monitor', monitorId: 10 },
        { variable: 'B', fuente: 'monitor', monitorId: 11 }
      ],
      mensajeFallo: 'La salida lógica no cumple la condición definida.',
      retardoSenalSegundos: '300'
    }
  );

  assert.equal(configuracion.expresion, 'NOT A OR B');
  assert.deepEqual(configuracion.variables, ['A', 'B']);
  assert.deepEqual(configuracion.variablesUsadas, ['A', 'B']);
  assert.equal(configuracion.resumenDependencias.totalMonitores, 2);
  assert.equal(
    configuracion.mensajeFallo,
    'La salida lógica no cumple la condición definida.'
  );
  assert.equal(configuracion.estadoInicial, 'disponible');
  assert.equal(configuracion.retardoSenalSegundos, 300);
  const configuracionDesdeGrafo = validadorMonitor.normalizarConfiguracionTecnica(
    'booleano',
    {
      expresion: '(A OR B) AND NOT C',
      dependencias: [
        { variable: 'A', fuente: 'monitor', monitorId: 10 },
        { variable: 'B', fuente: 'monitor', monitorId: 11 },
        { variable: 'C', fuente: 'monitor', monitorId: 12 }
      ],
      mensajeFallo: 'El grafo lógico no cumple la condición definida.',
      layoutVisual: {
        grafoLogico: {
          nodos: [
            { id: 'entrada-a', tipo: 'entrada', variable: 'A' },
            { id: 'entrada-b', tipo: 'entrada', variable: 'B' },
            { id: 'entrada-c', tipo: 'entrada', variable: 'C' },
            { id: 'or-1', tipo: 'or' },
            { id: 'not-1', tipo: 'not' },
            { id: 'and-1', tipo: 'and' },
            { id: 'salida', tipo: 'salida' }
          ],
          conexiones: [
            { desde: 'entrada-a', hasta: 'or-1' },
            { desde: 'entrada-b', hasta: 'or-1' },
            { desde: 'entrada-c', hasta: 'not-1' },
            { desde: 'or-1', hasta: 'and-1' },
            { desde: 'not-1', hasta: 'and-1' },
            { desde: 'and-1', hasta: 'salida' }
          ]
        }
      }
    }
  );

  assert.equal(configuracionDesdeGrafo.expresion, '(A OR B) AND NOT C');
  assert.equal(
    configuracionDesdeGrafo.layoutVisual.grafoLogico.expresionCompilada,
    '(A OR B) AND NOT C'
  );
  assert.throws(
    () =>
      validadorMonitor.normalizarConfiguracionTecnica('booleano', {
        expresion: 'A OR B',
        dependencias: [
          { variable: 'A', fuente: 'monitor', monitorId: 10 },
          { variable: 'B', fuente: 'monitor', monitorId: 11 },
          { variable: 'C', fuente: 'monitor', monitorId: 12 }
        ],
        mensajeFallo: 'El grafo lógico no cumple la condición definida.',
        layoutVisual: configuracionDesdeGrafo.layoutVisual
      }),
    /El grafo visual compila/
  );
  assert.doesNotThrow(() =>
    validadorMonitor.normalizarConfiguracionTecnica('booleano', {
      expresion: 'NOT A',
      dependencias: [{ variable: 'A', fuente: 'monitor', monitorId: 10 }],
      mensajeFallo: 'La fórmula manual no cumple la condición definida.',
      layoutVisual: {
        grafoLogico: {
          nodos: [
            { id: 'entrada-a', tipo: 'entrada', variable: 'A' },
            { id: 'expresion', tipo: 'expresion' },
            { id: 'salida', tipo: 'salida' }
          ],
          conexiones: [
            { desde: 'entrada-a', hasta: 'expresion' },
            { desde: 'expresion', hasta: 'salida' }
          ]
        }
      }
    })
  );
  assert.throws(
    () =>
      validadorMonitor.normalizarConfiguracionTecnica('booleano', {
        expresion: 'A',
        dependencias: [{ variable: 'A', fuente: 'monitor', monitorId: 10 }],
        mensajeFallo: 'La salida lógica no cumple la condición definida.',
        retardoSenalSegundos: '90000'
      }),
    /retardo de señal/
  );
  assert.throws(
    () =>
      validadorMonitor.normalizarConfiguracionTecnica('booleano', {
        expresion: 'A',
        dependencias: [{ variable: 'A', fuente: 'monitor', monitorId: 10 }]
      }),
    /mensaje humano de fallo/
  );
  assert.throws(
    () =>
      validadorMonitor.normalizarConfiguracionTecnica('booleano', {
        expresion: 'A',
        dependencias: [
          { variable: 'A', fuente: 'monitor', monitorId: 10 },
          { variable: 'B', fuente: 'monitor', monitorId: 11 }
        ],
        mensajeFallo: 'La salida lógica no cumple la condición definida.'
      }),
    /no usa las dependencias declaradas: B/
  );
  assert.throws(
    () =>
      validadorMonitor.normalizarConfiguracionTecnica('booleano', {
        expresion: 'AGENTE_1',
        dependencias: [
          {
            variable: 'AGENTE_1',
            fuente: 'alerta_agente',
            referencia: 'temperatura_critica'
          }
        ],
        mensajeFallo: 'La telemetría del agente no cumple la condición definida.'
      }),
    /solo puede usar monitores locales o entradas federadas explícitas/
  );
}

async function verificarDependenciasMonitorLogico() {
  const dependencias = normalizarDependenciasMonitorLogico([
    { variable: 'a', monitorId: '10', etiqueta: 'Ping principal' },
    {
      variable: 'agente_1',
      fuente: 'alerta_agente',
      referencia: 'temperatura_critica'
    }
  ]);
  const resumen = resumirDependenciasMonitorLogico(dependencias);

  assert.deepEqual(dependencias, [
    {
      variable: 'A',
      fuente: 'monitor',
      monitorId: 10,
      etiqueta: 'Ping principal'
    },
    {
      variable: 'AGENTE_1',
      fuente: 'alerta_agente',
      referencia: 'temperatura_critica',
      etiqueta: null
    }
  ]);
  assert.equal(resumen.total, 2);
  assert.equal(resumen.totalMonitores, 1);
  assert.equal(resumen.totalReservadas, 1);
  assert.deepEqual(resumen.variables, ['A', 'AGENTE_1']);
  assert.deepEqual(resumen.monitores, [10]);
  assert.throws(
    () =>
      normalizarDependenciasMonitorLogico([
        { variable: 'A', monitorId: 1 },
        { variable: 'A', monitorId: 2 }
      ]),
    /duplicada/
  );
  assert.throws(
    () =>
      normalizarDependenciasMonitorLogico([
        { variable: 'A', monitorId: 1 },
        { variable: 'B', monitorId: 1 }
      ]),
    /duplicado/
  );

  const servicio = new ServicioMonitores({
    repositorioMonitores: {
      async listarPorIds(ids) {
        return ids.map((id) => ({
          id,
          tenantId: id === 1 ? 1 : 2,
          empresaId: id === 1 ? 10 : 20,
          sitioId: null
        }));
      }
    },
    resolutorScopeUsuario: {
      puedeAlcanzarEmpresa(contexto, empresaId, tenantId) {
        return (
          Number(contexto.tenantId) === Number(tenantId) &&
          Number(contexto.empresaId) === Number(empresaId)
        );
      },
      puedeAlcanzarSitio() {
        return false;
      }
    }
  });
  const configuracionDesdeFormulario =
    servicio.construirConfiguracionLogicaDesdeEntrada({
      expresion_logica: 'A OR B',
      mensaje_fallo_logico: 'La composición lógica no cumple.',
      dependencias_logicas: JSON.stringify([
        { variable: 'A', monitorId: 1, etiqueta: 'Ping principal' },
        { variable: 'B', monitorId: 2, etiqueta: 'TCP respaldo' }
      ])
    });

  assert.deepEqual(configuracionDesdeFormulario.dependencias, [
    {
      variable: 'A',
      fuente: 'monitor',
      monitorId: '1',
      etiqueta: 'Ping principal'
    },
    {
      variable: 'B',
      fuente: 'monitor',
      monitorId: '2',
      etiqueta: 'TCP respaldo'
    }
  ]);
  assert.throws(
    () =>
      servicio.construirConfiguracionLogicaDesdeEntrada({
        dependencias_logicas: '{no-json'
      }),
    /JSON válido/
  );

  await servicio.validarDependenciasMonitorLogicoSegunScope(
    { nivelScope: 'empresa', tenantId: 1, empresaId: 10 },
    {
      tipo: 'booleano',
      configuracion: {
        dependencias: [{ variable: 'A', fuente: 'monitor', monitorId: 1 }]
      }
    }
  );

  await assert.rejects(
    () =>
      servicio.validarDependenciasMonitorLogicoSegunScope(
        { nivelScope: 'empresa', tenantId: 1, empresaId: 10 },
        {
          tipo: 'booleano',
          configuracion: {
            dependencias: [{ variable: 'A', fuente: 'monitor', monitorId: 2 }]
          }
        }
      ),
    /fuera de tu alcance visible/
  );

  await assert.rejects(
    () =>
      servicio.validarDependenciasMonitorLogicoSegunScope(
        { nivelScope: 'empresa', tenantId: 1, empresaId: 10 },
        {
          tipo: 'booleano',
          configuracion: {
            dependencias: [{ variable: 'A', fuente: 'monitor', monitorId: 1 }]
          }
        },
        { idMonitorActual: 1 }
      ),
    /no puede depender de sí mismo/
  );

  const servicioCiclos = new ServicioMonitores({
    repositorioMonitores: {
      async listarPorIds(ids) {
        const catalogo = new Map([
          [
            2,
            {
              id: 2,
              tipo: 'booleano',
              tenantId: 1,
              empresaId: 10,
              sitioId: null,
              configuracion: {
                dependencias: [
                  { variable: 'B', fuente: 'monitor', monitorId: 3 }
                ]
              }
            }
          ],
          [
            3,
            {
              id: 3,
              tipo: 'booleano',
              tenantId: 1,
              empresaId: 10,
              sitioId: null,
              configuracion: {
                dependencias: [
                  { variable: 'C', fuente: 'monitor', monitorId: 5 }
                ]
              }
            }
          ]
        ]);

        return ids
          .map((id) => catalogo.get(Number(id)))
          .filter(Boolean);
      }
    },
    resolutorScopeUsuario: {
      puedeAlcanzarEmpresa(contexto, empresaId, tenantId) {
        return (
          Number(contexto.tenantId) === Number(tenantId) &&
          Number(contexto.empresaId) === Number(empresaId)
        );
      },
      puedeAlcanzarSitio() {
        return false;
      }
    }
  });

  await assert.rejects(
    () =>
      servicioCiclos.validarDependenciasMonitorLogicoSegunScope(
        { nivelScope: 'empresa', tenantId: 1, empresaId: 10 },
        {
          tipo: 'booleano',
          configuracion: {
            dependencias: [{ variable: 'A', fuente: 'monitor', monitorId: 2 }]
          }
        },
        { idMonitorActual: 5 }
      ),
    /ciclo de dependencias/
  );
}

async function verificarEjecutorMonitorLogico() {
  const catalogo = new CatalogoMonitoresRuntime({
    generadoEn: '2026-01-01T00:00:00.000Z',
    monitores: [
      crearDefinicionMonitor({ id: 1, tipo: 'ping', nombre: 'ping-a' }),
      crearDefinicionMonitor({ id: 2, tipo: 'tcp', nombre: 'tcp-a' }),
      {
        ...crearDefinicionMonitor({
          id: 3,
          tipo: 'booleano',
          nombre: 'logico-a'
        }),
        configuracion: {
          expresion: 'A AND B',
          dependencias: [
            { variable: 'A', fuente: 'monitor', monitorId: 1 },
            { variable: 'B', fuente: 'monitor', monitorId: 2 }
          ],
          mensajeFallo: 'Alguna entrada lógica no está disponible.',
          estadoInicial: 'disponible'
        }
      },
      {
        ...crearDefinicionMonitor({
          id: 4,
          tipo: 'booleano',
          nombre: 'logico-retardado'
        }),
        configuracion: {
          expresion: 'A',
          dependencias: [
            { variable: 'A', fuente: 'monitor', monitorId: 1 }
          ],
          mensajeFallo: 'La entrada A no está disponible.',
          estadoInicial: 'disponible',
          retardoSenalSegundos: 300
        }
      },
      {
        ...crearDefinicionMonitor({
          id: 5,
          tipo: 'booleano',
          nombre: 'logico-hijo-retardado'
        }),
        configuracion: {
          expresion: 'A',
          dependencias: [
            { variable: 'A', fuente: 'monitor', monitorId: 4 }
          ],
          mensajeFallo: 'El lógico padre no está disponible.',
          estadoInicial: 'indisponible',
          retardoSenalSegundos: 120
        }
      }
    ]
  });
  const almacen = new AlmacenEstadoActual({ catalogoOperativo: catalogo });
  const ejecutor = new EjecutorMonitorBooleano();
  const ahoraRetardo = '2026-01-01T00:10:00.000Z';
  const retardoIniciadoHace60s = '2026-01-01T00:09:00.000Z';
  const retardoIniciadoHace301s = '2026-01-01T00:04:59.000Z';

  almacen.actualizarEstadoMonitor(1, {
    estado: 'disponible',
    ejecutadoTodavia: true
  });
  almacen.actualizarEstadoMonitor(2, {
    estado: 'disponible',
    ejecutadoTodavia: true
  });

  const resultadoOk = await ejecutor.ejecutar(catalogo.buscarPorId(3), {
    almacenEstadoActual: almacen
  });

  assert.equal(resultadoOk.estadoDetectado, 'disponible');
  assert.equal(resultadoOk.codigoResultado, 'booleano_ok');
  assert.equal(resultadoOk.metricaPrincipal.resultadoLogico, true);

  almacen.actualizarEstadoMonitor(2, {
    estado: 'indisponible',
    ejecutadoTodavia: true
  });

  const resultadoFalse = await ejecutor.ejecutar(catalogo.buscarPorId(3), {
    almacenEstadoActual: almacen
  });

  assert.equal(resultadoFalse.estadoDetectado, 'indisponible');
  assert.equal(resultadoFalse.codigoResultado, 'booleano_false');
  assert.equal(
    resultadoFalse.mensajeResultado,
    'Alguna entrada lógica no está disponible.'
  );
  assert.equal(resultadoFalse.metricaPrincipal.dependenciaCausante, 'B');

  almacen.actualizarEstadoMonitor(2, {
    estado: 'desconocido',
    ejecutadoTodavia: false
  });

  const resultadoInicializando = await ejecutor.ejecutar(
    catalogo.buscarPorId(3),
    { almacenEstadoActual: almacen }
  );

  assert.equal(resultadoInicializando.estadoDetectado, 'disponible');
  assert.equal(resultadoInicializando.codigoResultado, 'booleano_inicializando');
  assert.equal(resultadoInicializando.metricaPrincipal.bloqueaEvaluacion, true);

  almacen.actualizarEstadoMonitor(1, {
    estado: 'indisponible',
    ejecutadoTodavia: true
  });
  almacen.actualizarEstadoMonitor(4, {
    estado: 'disponible',
    ejecutadoTodavia: true
  });

  const resultadoRetardoPendiente = await ejecutor.ejecutar(
    catalogo.buscarPorId(4),
    { almacenEstadoActual: almacen, ejecutadoEnUtc: ahoraRetardo }
  );

  assert.equal(resultadoRetardoPendiente.estadoDetectado, 'disponible');
  assert.equal(resultadoRetardoPendiente.codigoResultado, 'booleano_retardo_pendiente');
  assert.equal(resultadoRetardoPendiente.metricaPrincipal.resultadoLogico, true);
  assert.equal(
    resultadoRetardoPendiente.metricaPrincipal.retardoSenal.pendiente,
    true
  );
  assert.equal(
    resultadoRetardoPendiente.metricaPrincipal.retardoSenal.salidaCandidata,
    false
  );
  assert.equal(
    resultadoRetardoPendiente.metricaPrincipal.retardoSenal.evento.tipo,
    'retardo_senal_iniciado'
  );
  assert.equal(
    resultadoRetardoPendiente.metricaPrincipal.retardoSenal.evento
      .resultadoAnterior,
    true
  );
  assert.equal(
    resultadoRetardoPendiente.metricaPrincipal.retardoSenal.evento
      .resultadoNuevo,
    false
  );
  assert.equal(
    resultadoRetardoPendiente.metricaPrincipal.retardoSenal.evento
      .duracionExigidaSegundos,
    300
  );
  assert.equal(
    resultadoRetardoPendiente.metricaPrincipal.retardoSenal.iniciadoEnUtc,
    ahoraRetardo
  );
  assert.equal(
    resultadoRetardoPendiente.metricaPrincipal.retardoSenal.venceEnUtc,
    '2026-01-01T00:15:00.000Z'
  );
  assert.equal(
    resultadoRetardoPendiente.metricaPrincipal.retardoSenal.restanteSegundos,
    300
  );

  almacen.actualizarEstadoMonitor(4, {
    estado: 'disponible',
    ejecutadoTodavia: true,
    resultadoActual: {
      metricaPrincipal: {
        retardoSenal: {
          pendiente: true,
          salidaCandidata: false,
          iniciadoEnUtc: retardoIniciadoHace60s
        }
      }
    }
  });

  const resultadoRetardoSiguePendiente = await ejecutor.ejecutar(
    catalogo.buscarPorId(4),
    { almacenEstadoActual: almacen, ejecutadoEnUtc: ahoraRetardo }
  );

  assert.equal(resultadoRetardoSiguePendiente.estadoDetectado, 'disponible');
  assert.equal(
    resultadoRetardoSiguePendiente.codigoResultado,
    'booleano_retardo_pendiente'
  );
  assert.equal(
    resultadoRetardoSiguePendiente.metricaPrincipal.retardoSenal.evento.tipo,
    'retardo_senal_pendiente'
  );
  assert.equal(
    resultadoRetardoSiguePendiente.metricaPrincipal.retardoSenal
      .transcurridoSegundos,
    60
  );
  assert.equal(
    resultadoRetardoSiguePendiente.metricaPrincipal.retardoSenal
      .restanteSegundos,
    240
  );
  assert.equal(
    resultadoRetardoSiguePendiente.metricaPrincipal.retardoSenal.venceEnUtc,
    '2026-01-01T00:14:00.000Z'
  );

  almacen.actualizarEstadoMonitor(4, {
    estado: 'disponible',
    ejecutadoTodavia: true,
    resultadoActual: {
      metricaPrincipal: {
        retardoSenal: {
          pendiente: true,
          salidaCandidata: false,
          iniciadoEnUtc: retardoIniciadoHace60s
        }
      }
    }
  });
  almacen.actualizarEstadoMonitor(1, {
    estado: 'disponible',
    ejecutadoTodavia: true
  });

  const resultadoRetardoCancelado = await ejecutor.ejecutar(
    catalogo.buscarPorId(4),
    { almacenEstadoActual: almacen, ejecutadoEnUtc: ahoraRetardo }
  );

  assert.equal(resultadoRetardoCancelado.estadoDetectado, 'disponible');
  assert.equal(resultadoRetardoCancelado.codigoResultado, 'booleano_ok');
  assert.equal(
    resultadoRetardoCancelado.metricaPrincipal.retardoSenal.evento.tipo,
    'retardo_senal_cancelado'
  );
  assert.equal(
    resultadoRetardoCancelado.metricaPrincipal.retardoSenal.evento
      .resultadoAnterior,
    true
  );
  assert.equal(
    resultadoRetardoCancelado.metricaPrincipal.retardoSenal.evento
      .resultadoNuevo,
    false
  );
  assert.equal(
    resultadoRetardoCancelado.metricaPrincipal.retardoSenal.evento
      .duracionObservadaSegundos,
    60
  );
  assert.equal(resultadoRetardoCancelado.metricaPrincipal.retardoSenal.pendiente, false);

  almacen.actualizarEstadoMonitor(1, {
    estado: 'indisponible',
    ejecutadoTodavia: true
  });
  almacen.actualizarEstadoMonitor(4, {
    estado: 'disponible',
    ejecutadoTodavia: true,
    resultadoActual: {
      metricaPrincipal: {
        retardoSenal: {
          pendiente: true,
          salidaCandidata: false,
          iniciadoEnUtc: retardoIniciadoHace301s
        }
      }
    }
  });

  const resultadoRetardoCumplido = await ejecutor.ejecutar(
    catalogo.buscarPorId(4),
    { almacenEstadoActual: almacen, ejecutadoEnUtc: ahoraRetardo }
  );

  assert.equal(resultadoRetardoCumplido.estadoDetectado, 'indisponible');
  assert.equal(resultadoRetardoCumplido.codigoResultado, 'booleano_false');
  assert.equal(resultadoRetardoCumplido.metricaPrincipal.resultadoLogico, false);
  assert.equal(
    resultadoRetardoCumplido.metricaPrincipal.retardoSenal.pendiente,
    false
  );
  assert.equal(
    resultadoRetardoCumplido.metricaPrincipal.retardoSenal.aplicado,
    true
  );
  assert.equal(
    resultadoRetardoCumplido.metricaPrincipal.retardoSenal.evento.tipo,
    'retardo_senal_aplicado'
  );
  assert.equal(
    resultadoRetardoCumplido.metricaPrincipal.retardoSenal.evento
      .resultadoAnterior,
    true
  );
  assert.equal(
    resultadoRetardoCumplido.metricaPrincipal.retardoSenal.evento
      .resultadoNuevo,
    false
  );
  assert.equal(
    resultadoRetardoCumplido.metricaPrincipal.retardoSenal.evento
      .duracionExigidaSegundos,
    300
  );
  assert.ok(
    resultadoRetardoCumplido.metricaPrincipal.retardoSenal.evento
      .duracionObservadaSegundos >= 300
  );
  assert.equal(
    resultadoRetardoCumplido.metricaPrincipal.retardoSenal.evento
      .duracionObservadaSegundos,
    301
  );
  assert.equal(
    resultadoRetardoCumplido.metricaPrincipal.retardoSenal.venceEnUtc,
    '2026-01-01T00:09:59.000Z'
  );

  almacen.actualizarEstadoMonitor(4, {
    estado: 'disponible',
    ejecutadoTodavia: true,
    resultadoActual: {
      metricaPrincipal: {
        retardoSenal: {
          activo: true,
          pendiente: true,
          retardoSegundos: 300,
          salidaEstable: true,
          salidaCandidata: false,
          iniciadoEnUtc: retardoIniciadoHace60s,
          venceEnUtc: '2026-01-01T00:14:00.000Z',
          restanteSegundos: 240
        }
      }
    }
  });
  almacen.actualizarEstadoMonitor(5, {
    estado: 'indisponible',
    ejecutadoTodavia: true
  });

  const resultadoRetardoEncadenado = await ejecutor.ejecutar(
    catalogo.buscarPorId(5),
    { almacenEstadoActual: almacen, ejecutadoEnUtc: ahoraRetardo }
  );

  assert.equal(resultadoRetardoEncadenado.estadoDetectado, 'indisponible');
  assert.equal(
    resultadoRetardoEncadenado.codigoResultado,
    'booleano_retardo_pendiente'
  );
  assert.equal(
    resultadoRetardoEncadenado.intentos[0].detalle.entradas[0].valor,
    true
  );
  assert.equal(
    resultadoRetardoEncadenado.intentos[0].detalle.entradas[0]
      .retardoSenalDependencia.pendiente,
    true
  );
  assert.equal(
    resultadoRetardoEncadenado.intentos[0].detalle.entradas[0]
      .retardoSenalDependencia.salidaCandidata,
    false
  );
  assert.equal(
    resultadoRetardoEncadenado.metricaPrincipal.retardoSenal.salidaCandidata,
    true
  );
  assert.equal(
    resultadoRetardoEncadenado.metricaPrincipal.retardoSenal.pendiente,
    true
  );
  assert.equal(
    resultadoRetardoEncadenado.metricaPrincipal.retardoSenal.evento.tipo,
    'retardo_senal_iniciado'
  );

  const motor = new MotorMonitores();
  assert.equal(motor.registroEjecutores.tieneEjecutor('booleano'), true);
}

async function verificarPersistenciaComunMonitorLogico() {
  const catalogo = new CatalogoMonitoresRuntime({
    generadoEn: '2026-01-01T00:00:00.000Z',
    monitores: [
      crearDefinicionMonitor({ id: 1, tipo: 'ping', nombre: 'ping-a' }),
      crearDefinicionMonitor({ id: 2, tipo: 'tcp', nombre: 'tcp-a' }),
      {
        ...crearDefinicionMonitor({
          id: 3,
          tipo: 'booleano',
          nombre: 'logico-a'
        }),
        configuracion: {
          expresion: 'A AND B',
          dependencias: [
            { variable: 'A', fuente: 'monitor', monitorId: 1 },
            { variable: 'B', fuente: 'monitor', monitorId: 2 }
          ],
          mensajeFallo: 'Alguna entrada lógica no está disponible.',
          estadoInicial: 'disponible'
        }
      }
    ]
  });
  const almacen = new AlmacenEstadoActual({ catalogoOperativo: catalogo });
  const ejecutor = new EjecutorMonitorBooleano();

  almacen.actualizarEstadoMonitor(1, {
    estado: 'disponible',
    ejecutadoTodavia: true
  });
  almacen.actualizarEstadoMonitor(2, {
    estado: 'indisponible',
    ejecutadoTodavia: true
  });

  const resultado = {
    ...(await ejecutor.ejecutar(catalogo.buscarPorId(3), {
      almacenEstadoActual: almacen
    })),
    versionCatalogo: catalogo.buscarPorId(3).version,
    scope: { ...catalogo.buscarPorId(3).scope }
  };
  const estadosGuardados = [];
  const aplicadorEstado = new AplicadorResultadosEstadoActual({
    repositorioEstadoActualMonitores: {
      async guardarEstadosActuales(estados) {
        estadosGuardados.push(...estados.map((estado) => estado.serializar()));
        return estados.length;
      }
    }
  });
  const persistenciaEstado = await aplicadorEstado.aplicar({
    almacenEstadoActual: almacen,
    resultados: [resultado]
  });

  assert.equal(persistenciaEstado.totalPersistidos, 1);
  assert.equal(almacen.buscarPorMonitorId(3).estado, 'indisponible');
  assert.equal(
    almacen.buscarPorMonitorId(3).resultadoActual.codigoResultado,
    'booleano_false'
  );
  assert.equal(estadosGuardados[0].tipo, 'booleano');

  const repositorioEventosFake = {
    async listarUltimosPorMonitorIds() {
      return [];
    },
    async guardarEventosDetallado(eventos) {
      return {
        totalPersistidos: eventos.length,
        eventosPersistidos: eventos
      };
    }
  };
  const persistidorEventos = new PersistidorEventosMonitores({
    servicioEventosMonitores: new ServicioEventosMonitores({
      repositorioEventosMonitor: repositorioEventosFake,
      servicioConfiguracionPortal: null
    })
  });
  const persistenciaEventos = await persistidorEventos.persistirDesdeLote({
    catalogoOperativo: catalogo,
    loteEjecucion: { resultados: [resultado] }
  });

  assert.equal(persistenciaEventos.totalPersistidos, 1);
  assert.equal(persistenciaEventos.eventosPersistidos[0].tipoMonitor, 'booleano');
  assert.equal(
    persistenciaEventos.eventosPersistidos[0].codigoResultado,
    'booleano_false'
  );
  assert.equal(
    persistenciaEventos.eventosPersistidos[0].payloadEvento.metricaPrincipal
      .dependenciaCausante,
    'B'
  );

  const alertasGuardadas = [];
  const gestorAlertas = new GestorAlertasActivasMonitor({
    repositorioAlertasActivasMonitor: {
      async listarPorMonitorIds() {
        return [];
      },
      async guardarAlertas(alertas) {
        alertasGuardadas.push(...alertas.map((alerta) => alerta.serializarResumen()));
        return alertas.length;
      },
      async eliminarPorMonitorIds() {
        return 0;
      }
    }
  });
  const persistenciaAlertas = await gestorAlertas.aplicarResultados({
    catalogoOperativo: catalogo,
    resultados: [resultado]
  });

  assert.equal(persistenciaAlertas.totalAperturas, 1);
  assert.equal(alertasGuardadas[0].tipoMonitor, 'booleano');
  assert.equal(alertasGuardadas[0].codigoUltimoResultado, 'booleano_false');
  assert.equal(
    alertasGuardadas[0].payloadAlerta.metricaPrincipal.dependenciaCausante,
    'B'
  );

  const tramosGuardados = [];
  const gestorHistorico = new GestorHistoricoMonitores({
    repositorioHistoricoMonitores: {
      async listarUltimosPorMonitorIds() {
        return [];
      },
      async guardarTramos(tramos) {
        tramosGuardados.push(...tramos.map((tramo) => tramo.serializarResumen()));
        return tramos.length;
      },
      async actualizarTramo() {
        return 0;
      }
    },
    servicioConfiguracionPortal: {
      async asegurarActualizada() {
        return {
          obtenerConfiguracionMonitores() {
            return {
              compactacionCercaFalloPorcentaje: 0
            };
          }
        };
      }
    }
  });
  const persistenciaHistorico = await gestorHistorico.aplicarResultados({
    catalogoOperativo: catalogo,
    resultados: [resultado],
    persistenciaEventos
  });

  assert.equal(persistenciaHistorico.totalPersistidos, 1);
  assert.equal(tramosGuardados[0].tipoMonitor, 'booleano');
  assert.equal(tramosGuardados[0].estadoTramo, 'indisponible');
  assert.equal(
    tramosGuardados[0].payloadTramo.compactacion.familiaResultado,
    'resultado:booleano_false'
  );

  almacen.actualizarEstadoMonitor(2, {
    estado: 'disponible',
    ejecutadoTodavia: true
  });

  const resultadoRecuperado = {
    ...(await ejecutor.ejecutar(catalogo.buscarPorId(3), {
      almacenEstadoActual: almacen
    })),
    versionCatalogo: catalogo.buscarPorId(3).version,
    scope: { ...catalogo.buscarPorId(3).scope }
  };
  const idsEliminadosPorCierre = [];
  const gestorCierreAlertas = new GestorAlertasActivasMonitor({
    repositorioAlertasActivasMonitor: {
      async listarPorMonitorIds() {
        return [alertasGuardadas[0]];
      },
      async guardarAlertas() {
        throw new Error('No se deben guardar alertas cuando el lógico recupera.');
      },
      async eliminarPorMonitorIds(idsMonitor) {
        idsEliminadosPorCierre.push(...idsMonitor);
        return idsMonitor.length;
      }
    }
  });
  const persistenciaCierreAlertas = await gestorCierreAlertas.aplicarResultados({
    catalogoOperativo: catalogo,
    resultados: [resultadoRecuperado]
  });

  assert.equal(resultadoRecuperado.estadoDetectado, 'disponible');
  assert.equal(resultadoRecuperado.codigoResultado, 'booleano_ok');
  assert.equal(persistenciaCierreAlertas.totalCierres, 1);
  assert.equal(persistenciaCierreAlertas.totalEliminadas, 1);
  assert.deepEqual(idsEliminadosPorCierre, [3]);
  assert.equal(
    persistenciaCierreAlertas.cierresAlerta[0].tipoEventoDisparo,
    'cierre_alerta'
  );
  assert.equal(
    persistenciaCierreAlertas.cierresAlerta[0].tipoMonitor,
    'booleano'
  );
  assert.equal(
    persistenciaCierreAlertas.cierresAlerta[0].payloadAlerta.metricaPrincipal
      .dependenciaCausante,
    'B'
  );
}

function verificarPlanificadorMonitoresLogicosReactivos() {
  const catalogo = new CatalogoMonitoresRuntime({
    generadoEn: '2026-01-01T00:00:00.000Z',
    monitores: [
      crearDefinicionMonitor({ id: 1, tipo: 'ping', nombre: 'ping-a' }),
      crearDefinicionMonitor({ id: 2, tipo: 'tcp', nombre: 'tcp-a' }),
      {
        ...crearDefinicionMonitor({
          id: 3,
          tipo: 'booleano',
          nombre: 'logico-a'
        }),
        configuracion: {
          expresion: 'A',
          dependencias: [
            { variable: 'A', fuente: 'monitor', monitorId: 1 }
          ]
        }
      },
      {
        ...crearDefinicionMonitor({
          id: 4,
          tipo: 'booleano',
          nombre: 'logico-b'
        }),
        configuracion: {
          expresion: 'A',
          dependencias: [
            { variable: 'A', fuente: 'monitor', monitorId: 3 }
          ]
        }
      },
      {
        ...crearDefinicionMonitor({
          id: 5,
          tipo: 'booleano',
          nombre: 'logico-inactivo'
        }),
        activo: false,
        configuracion: {
          expresion: 'A',
          dependencias: [
            { variable: 'A', fuente: 'monitor', monitorId: 1 }
          ]
        }
      }
    ]
  });
  const planificador = new PlanificadorMonitoresLogicosReactivos({
    profundidadMaxima: 2
  });

  const seleccionInicial = planificador.seleccionarDependientes({
    catalogoOperativo: catalogo,
    monitorIdsOrigen: [1],
    monitoresYaEjecutados: [1],
    fechaReferenciaUtc: '2026-01-01T00:00:10.000Z',
    profundidad: 1
  });

  assert.equal(seleccionInicial.totalCandidatos, 1);
  assert.equal(seleccionInicial.candidatos[0].monitorId, 3);
  assert.equal(
    seleccionInicial.candidatos[0].motivoProgramacion,
    'dependencia_logica_actualizada'
  );
  assert.equal(
    seleccionInicial.candidatos[0].origenReactivo.tipo,
    'monitor_logico_dependiente'
  );

  const seleccionEncadenada = planificador.seleccionarDependientes({
    catalogoOperativo: catalogo,
    monitorIdsOrigen: [3],
    monitoresYaEjecutados: [1, 3],
    profundidad: 2
  });

  assert.equal(seleccionEncadenada.totalCandidatos, 1);
  assert.equal(seleccionEncadenada.candidatos[0].monitorId, 4);

  const seleccionRepetida = planificador.seleccionarDependientes({
    catalogoOperativo: catalogo,
    monitorIdsOrigen: [3],
    monitoresYaEjecutados: [1, 3, 4],
    profundidad: 2
  });

  assert.equal(seleccionRepetida.totalCandidatos, 0);

  const seleccionFueraDeProfundidad = planificador.seleccionarDependientes({
    catalogoOperativo: catalogo,
    monitorIdsOrigen: [4],
    monitoresYaEjecutados: [1, 3, 4],
    profundidad: 3
  });

  assert.equal(seleccionFueraDeProfundidad.totalCandidatos, 0);
}

function verificarSelectorVenceRetardoSenalPendiente() {
  const catalogo = new CatalogoMonitoresRuntime({
    generadoEn: '2026-01-01T00:00:00.000Z',
    monitores: [
      {
        ...crearDefinicionMonitor({
          id: 3,
          tipo: 'booleano',
          nombre: 'logico-retardado'
        }),
        programacion: {
          intervaloEjecucionSegundos: 3600,
          desfaseInicialSegundos: 0
        },
        configuracion: {
          expresion: 'A',
          dependencias: [
            { variable: 'A', fuente: 'monitor', monitorId: 1 }
          ],
          retardoSenalSegundos: 300
        }
      }
    ]
  });
  const almacen = new AlmacenEstadoActual({ catalogoOperativo: catalogo });
  const selector = new SelectorMonitoresVencidos();

  almacen.actualizarEstadoMonitor(3, {
    estado: 'disponible',
    ejecutadoTodavia: true,
    fechaUltimaEjecucionUtc: '2026-01-01T00:00:00.000Z',
    resultadoActual: {
      metricaPrincipal: {
        retardoSenal: {
          activo: true,
          pendiente: true,
          salidaEstable: true,
          salidaCandidata: false,
          iniciadoEnUtc: '2026-01-01T00:00:00.000Z',
          venceEnUtc: '2026-01-01T00:05:00.000Z'
        }
      }
    }
  });

  const seleccionAntes = selector.seleccionar({
    catalogoOperativo: catalogo,
    almacenEstadoActual: almacen,
    fechaEvaluacionUtc: '2026-01-01T00:04:59.000Z'
  });

  assert.equal(seleccionAntes.totalVencidos, 0);
  assert.equal(
    seleccionAntes.proximoIntentoGlobalEn,
    '2026-01-01T00:05:00.000Z'
  );
  assert.equal(
    seleccionAntes.programaciones[0].motivoProgramacion,
    'retardo_senal_vencido'
  );

  const seleccionVencida = selector.seleccionar({
    catalogoOperativo: catalogo,
    almacenEstadoActual: almacen,
    fechaEvaluacionUtc: '2026-01-01T00:05:00.000Z'
  });

  assert.equal(seleccionVencida.totalVencidos, 1);
  assert.equal(
    seleccionVencida.monitoresVencidos[0].motivoProgramacion,
    'retardo_senal_vencido'
  );
}

async function verificarCascadaReactivaRespetaBloqueoRedis() {
  const catalogo = new CatalogoMonitoresRuntime({
    generadoEn: '2026-01-01T00:00:00.000Z',
    monitores: [
      crearDefinicionMonitor({ id: 1, tipo: 'ping', nombre: 'ping-a' }),
      {
        ...crearDefinicionMonitor({
          id: 3,
          tipo: 'booleano',
          nombre: 'logico-a'
        }),
        configuracion: {
          expresion: 'A',
          dependencias: [
            { variable: 'A', fuente: 'monitor', monitorId: 1 }
          ]
        }
      }
    ]
  });
  const almacen = new AlmacenEstadoActual({ catalogoOperativo: catalogo });
  let motorInvocado = false;
  let liberarInvocado = false;

  const runtime = {
    catalogoOperativo: catalogo,
    estadoVivo: almacen,
    instanciaId: 'runtime-test',
    planificadorMonitoresLogicosReactivos:
      new PlanificadorMonitoresLogicosReactivos(),
    bloqueadorEjecucionMonitorRedis: {
      async bloquearCandidatos({ candidatos }) {
        return {
          resumen: {
            totalCandidatos: candidatos.length,
            totalBloqueados: 0,
            totalSaltados: candidatos.length,
            monitorIdsBloqueados: [],
            monitorIdsSaltados: candidatos.map((candidato) => candidato.monitorId)
          },
          candidatosBloqueados: [],
          candidatosSaltados: candidatos,
          bloqueos: []
        };
      },
      async liberarBloqueos() {
        liberarInvocado = true;
        return { totalBloqueos: 0, totalNoLiberados: 0 };
      }
    },
    motorMonitores: {
      async ejecutarMonitores() {
        motorInvocado = true;
        return { resultados: [] };
      }
    },
    aplicadorResultadosEstadoActual: {},
    persistidorEventosMonitores: {},
    gestorAlertasActivasMonitor: {},
    gestorHistoricoMonitores: {},
    motorTriggersRuntime: null,
    actualizarEstadoAlertasActivas() {},
    extraerMonitoresConCambioSalidaEstable:
      RuntimeSentinelia.prototype.extraerMonitoresConCambioSalidaEstable
  };

  const resumen =
    await RuntimeSentinelia.prototype.ejecutarCascadaMonitoresLogicosReactivos
      .call(runtime, {
        persistenciaEstadoActual: {
          monitoresActualizados: [
            {
              monitorId: 1,
              cambioEstado: true,
              cambioSalidaEstable: true
            }
          ]
        },
        origen: 'test',
        numeroTick: 1,
        fechaReferenciaUtc: '2026-01-01T00:00:00.000Z',
        monitoresYaEjecutados: [1]
      });

  assert.equal(resumen, null);
  assert.equal(motorInvocado, false);
  assert.equal(liberarInvocado, false);
  assert.equal(
    almacen.buscarPorMonitorId(3).motivoProgramacion,
    'bloqueado_por_runtime_externo'
  );
  assert.equal(almacen.buscarPorMonitorId(3).pendienteScheduler, true);
}

async function verificarTriggersDesdeMonitorLogico() {
  const transicionBooleano = {
    tipoEventoDisparo: 'apertura_alerta',
    monitorId: 3,
    tenantId: 1,
    empresaId: 10,
    sitioId: null,
    versionCatalogo: 'v-3',
    tipoMonitor: 'booleano',
    nombreMonitor: 'logico-a',
    fechaOcurrenciaUtc: '2026-01-01T00:00:00.000Z',
    estadoDetectado: 'indisponible',
    codigoResultado: 'booleano_false',
    mensajeResultado: 'Alguna entrada lógica no está disponible.',
    validoDesdeUtc: '2026-01-01T00:00:00.000Z',
    contadorRepeticiones: 1,
    payloadAlerta: {
      metricaPrincipal: {
        resultadoLogico: false,
        dependenciaCausante: 'B'
      },
      protocolo: {
        nombre: 'booleano',
        expresion: 'A AND B',
        totalDependencias: 2
      },
      intentos: [
        {
          detalle: {
            entradas: [
              { variable: 'A', monitorId: 1, valorLogico: true },
              { variable: 'B', monitorId: 2, valorLogico: false }
            ]
          }
        }
      ]
    }
  };
  const llamadas = [];
  const servicioTriggers = {
    async resolverDisparosDesdeTransiciones({ aperturasAlerta, cierresAlerta }) {
      assert.equal(aperturasAlerta.length, 1);
      assert.equal(cierresAlerta.length, 0);
      assert.equal(aperturasAlerta[0].tipoMonitor, 'booleano');
      assert.equal(
        aperturasAlerta[0].payloadAlerta.metricaPrincipal.dependenciaCausante,
        'B'
      );

      const planDisparo = {
        eventoDisparo: 'apertura_alerta',
        monitorId: transicionBooleano.monitorId,
        triggerId: 7,
        asignacionId: 70,
        tipoTrigger: 'api',
        nombreTrigger: 'Aviso logico',
        ordenEjecucion: 100,
        configuracionEfectiva: { url: 'https://example.local/hook' },
        trigger: {
          tenantId: null,
          empresaId: null,
          sitioId: null,
          nivelPertenencia: 'portal'
        },
        transicion: aperturasAlerta[0]
      };

      return {
        totalDisparos: 2,
        disparos: [planDisparo, { ...planDisparo }]
      };
    },
    async registrarEjecucionPendiente({ planDisparo }) {
      llamadas.push(['pendiente', planDisparo.eventoDisparo]);
      assert.equal(planDisparo.transicion.tipoMonitor, 'booleano');
      return { id: 501 };
    },
    async marcarEjecucionEjecutando(idEjecucion) {
      llamadas.push(['ejecutando', idEjecucion]);
      return { id: idEjecucion, estadoEjecucion: 'ejecutando' };
    },
    resolverEjecutorParaPlanDisparo(planDisparo) {
      assert.equal(planDisparo.monitorId, 3);
      return {
        async ejecutar({ transicion, eventoDisparo }) {
          llamadas.push(['ejecutor', eventoDisparo]);
          assert.equal(transicion.tipoMonitor, 'booleano');
          assert.equal(transicion.payloadAlerta.protocolo.nombre, 'booleano');
          return {
            estadoEjecucion: 'ok',
            codigoResultado: 'trigger_ejecutado',
            mensajeResultado: 'Trigger ejecutado desde monitor lógico.',
            payloadRespuesta: {
              tipoMonitorOrigen: transicion.tipoMonitor,
              dependenciaCausante:
                transicion.payloadAlerta.metricaPrincipal.dependenciaCausante
            }
          };
        }
      };
    },
    async finalizarEjecucionTrigger({ idEjecucion, estadoEjecucion, payloadRespuesta }) {
      llamadas.push(['final', estadoEjecucion]);
      return {
        id: idEjecucion,
        estadoEjecucion,
        payloadRespuesta
      };
    }
  };
  const motorTriggers = new MotorTriggersRuntime({ servicioTriggers });
  const resumen = await motorTriggers.ejecutarDesdePersistenciaAlertas({
    persistenciaAlertas: {
      aperturasAlerta: [transicionBooleano],
      cierresAlerta: []
    },
    origen: 'test',
    numeroTick: 17
  });

  assert.equal(resumen.omitido, false);
  assert.equal(resumen.totalTransiciones, 1);
  assert.equal(resumen.totalPlanes, 2);
  assert.equal(resumen.totalPlanesUnicos, 1);
  assert.equal(resumen.totalEjecutados, 1);
  assert.equal(resumen.totalOk, 1);
  assert.equal(resumen.totalError, 0);
  assert.equal(
    resumen.ejecuciones[0].ejecucion.payloadRespuesta.tipoMonitorOrigen,
    'booleano'
  );
  assert.deepEqual(llamadas, [
    ['pendiente', 'apertura_alerta'],
    ['ejecutando', 501],
    ['ejecutor', 'apertura_alerta'],
    ['final', 'ok']
  ]);
}

function verificarEventosHistoricoExtensibles() {
  const repositorioEventos = new RepositorioEventosMonitor({});
  const repositorioHistorico = new RepositorioHistoricoMonitores({});
  const compactador = new CompactadorHistorico();

  assert.equal(repositorioEventos.normalizarTipoMonitor(' Booleano '), 'booleano');
  assert.equal(
    repositorioHistorico.normalizarTipoMonitor(' Booleano '),
    'booleano'
  );
  assert.equal(
    repositorioEventos.normalizarEventoPersistible({
      monitorId: 3,
      tenantId: 1,
      empresaId: 10,
      sitioId: null,
      versionCatalogo: 'v-3',
      tipoMonitor: 'booleano'.repeat(8),
      estadoDetectado: 'disponible',
      codigoResultado: 'estado_booleano_ok',
      mensajeResultado: 'OK',
      exito: true,
      duracionTotalMs: 0,
      ejecutadoEnUtc: '2026-01-01T00:00:00.000Z',
      payloadEvento: {}
    })?.tipoMonitor.length,
    40
  );

  const firmaOk = compactador.normalizarFamiliaResultado({
    tipoMonitor: 'booleano',
    codigoResultado: 'estado_booleano_ok'
  });
  const firmaError = compactador.normalizarFamiliaResultado({
    tipoMonitor: 'booleano',
    codigoResultado: 'estado_booleano_error'
  });

  assert.equal(firmaOk, 'resultado:estado_booleano_ok');
  assert.equal(firmaError, 'resultado:estado_booleano_error');
  assert.notEqual(firmaOk, firmaError);
}

function verificarDiagnosticoYRedisConTipoFuturo() {
  const resumenCatalogo = {
    total: 3,
    porTipo: { ping: 1, tcp: 1, booleano: 1 },
    totalEmpresa: 2,
    totalSitio: 1
  };
  const resumenEstado = {
    total: 3,
    porTipo: { booleano: 1, tcp: 1, ping: 1 }
  };
  const resumenScheduler = crearResumenScheduler();
  const sincronizacionRedis = {
    ultimaPublicacionEn: '2026-01-01T00:00:00.000Z',
    porTipo: { tcp: 1, booleano: 1, ping: 1 },
    proximoIntentoGlobalEn: null,
    totalMonitoresVencidos: 0
  };
  const diagnostico = new DiagnosticoRuntime({
    runtime: {
      contexto: {},
      configuracion: { entorno: 'test' }
    }
  });
  const resultado = diagnostico.validarCoherencia({
    resumenCatalogo,
    resumenEstado,
    resumenRehidratacion: {
      rehidratados: 3,
      sinEstadoPrevio: 0,
      versionIncompatible: 0
    },
    resumenScheduler,
    sincronizacionRedis
  });
  const checksClave = new Map(resultado.checks.map((check) => [check.clave, check]));

  assert.equal(checksClave.get('catalogo_tipos')?.ok, true);
  assert.equal(checksClave.get('estado_vs_catalogo_tipos')?.ok, true);
  assert.equal(checksClave.get('redis_tipos_alineado')?.ok, true);

  const presencia = new PresenciaRuntimeRedis({
    clienteRedis: null,
    entorno: 'test',
    configuracionRuntime: {
      redisPrefijo: 'sentinelia:test',
      presenciaTtlSegundos: 30,
      latidoIntervaloMs: 1000,
      instanciaId: 'test'
    }
  });
  const almacenEstadoActual = {
    listar: () => [
      { tipo: 'ping', estado: 'disponible', activoCatalogo: true, ejecutadoTodavia: true },
      { tipo: 'tcp', estado: 'disponible', activoCatalogo: true, ejecutadoTodavia: true },
      { tipo: 'booleano', estado: 'desconocido', activoCatalogo: true, ejecutadoTodavia: false }
    ],
    serializarResumen: () => ({
      total: 3,
      porTipo: { ping: 1, tcp: 1, booleano: 1 },
      totalPing: 1,
      totalTcp: 1,
      totalPendientesScheduler: 1,
      totalVencidosParaEjecucion: 0,
      proximoIntentoGlobalEn: null
    })
  };

  presencia.actualizarPayload({
    catalogoOperativo: { total: 3, generadoEn: '2026-01-01T00:00:00.000Z' },
    almacenEstadoActual,
    resumenScheduler,
    versionCatalogoMonitores: 1,
    versionOperativa: 1
  });

  const resumenRedis = presencia.serializarResumen();
  assert.deepEqual(resumenRedis.porTipo, { ping: 1, tcp: 1, booleano: 1 });
  assert.deepEqual(resumenRedis.dashboardResumen.porTipo, {
    ping: 1,
    tcp: 1,
    booleano: 1
  });
}

function verificarPortalPreparado() {
  const servicio = new ServicioMonitores({});
  const catalogoPortal = servicio.construirCatalogoTiposMonitorPortal();
  const opcionesFormulario = servicio.construirOpcionesTipoMonitorFormulario();
  const opcionesFiltro = servicio.construirOpcionesTipoMonitorFiltro();
  const tiposCatalogo = listarDefinicionesTiposMonitor().map((tipo) => tipo.valor);
  const definicionBooleano = listarDefinicionesTiposMonitor()
    .find((tipo) => tipo.valor === 'booleano');

  assert.deepEqual(
    catalogoPortal.tipos.map((tipo) => tipo.valor),
    tiposCatalogo
  );
  assert.ok(definicionBooleano, 'El tipo booleano debe estar declarado.');
  assert.equal(definicionBooleano.etiqueta, 'Monitor lógico');
  assert.equal(definicionBooleano.familiaOperativa, 'derivado');
  assert.equal(definicionBooleano.capacidades.evaluaEstadoInterno, true);
  assert.equal(definicionBooleano.capacidades.ejecutaSondeoExterno, false);
  assert.equal(definicionBooleano.capacidades.admiteTriggers, true);
  assert.equal(definicionBooleano.capacidades.creableDesdePortal, false);
  assert.deepEqual(
    opcionesFormulario.map((tipo) => tipo.valor),
    ['ping', 'tcp', 'telemetria']
  );
  assert.equal(opcionesFiltro[0].valor, '');
  assert.deepEqual(
    opcionesFiltro.slice(1).map((tipo) => tipo.valor),
    tiposCatalogo
  );
  assert.equal(catalogoPortal.fallback.claseCss, 'base');
}

async function verificarFormularioMonitorCompletaScopeSitio() {
  const tenant = { id: 100, nombre: 'Tenant humano' };
  const empresa = { id: 20, tenantId: 100, nombre: 'Empresa humana' };
  const sitio = {
    id: 11,
    tenantId: 100,
    empresaId: 20,
    nombre: 'Sitio humano'
  };
  const contextoSitioSinTenant = {
    nivelScope: 'sitio',
    empresaId: 20,
    sitioId: 11
  };
  const servicio = new ServicioMonitores({
    repositorioMonitores: {
      async listarPorIds() {
        return [];
      }
    },
    repositorioTenants: {
      async listarVisibles(contexto) {
        return Number(contexto.tenantId) === tenant.id ? [tenant] : [];
      },
      async buscarPorId(idTenant) {
        return Number(idTenant) === tenant.id ? tenant : null;
      }
    },
    repositorioEmpresas: {
      async listarVisibles(contexto) {
        return Number(contexto.empresaId) === empresa.id ? [empresa] : [];
      },
      async buscarPorId(idEmpresa) {
        return Number(idEmpresa) === empresa.id ? empresa : null;
      }
    },
    repositorioSitios: {
      async listarVisibles(contexto) {
        return Number(contexto.sitioId) === sitio.id ? [sitio] : [];
      },
      async buscarPorId(idSitio) {
        return Number(idSitio) === sitio.id ? sitio : null;
      }
    },
    resolutorScopeUsuario: {
      describirScope(contexto) {
        return `Alcance sitio ${contexto.sitioId}.`;
      },
      puedeAlcanzarEmpresa(contexto, empresaId, tenantId) {
        return (
          Number(contexto.tenantId) === Number(tenantId) &&
          Number(contexto.empresaId) === Number(empresaId)
        );
      },
      puedeAlcanzarSitio(contexto, sitioId, empresaId, tenantId) {
        return (
          Number(contexto.tenantId) === Number(tenantId) &&
          Number(contexto.empresaId) === Number(empresaId) &&
          Number(contexto.sitioId) === Number(sitioId)
        );
      }
    },
    validadorMonitor: new ValidadorMonitor()
  });
  const vista = await servicio.construirVistaFormulario(
    contextoSitioSinTenant
  );

  assert.equal(vista.formulario.tenantId, tenant.id);
  assert.equal(vista.formulario.empresaId, empresa.id);
  assert.equal(vista.formulario.sitioId, sitio.id);
  assert.equal(vista.restriccionesScope.tenantBloqueado, true);
  assert.equal(vista.restriccionesScope.nivelPertenenciaFijo, 'sitio');
  assert.equal(vista.opcionesTenants[0].valor, tenant.id);

  const definicion = await servicio.resolverDefinicionBaseValida(
    contextoSitioSinTenant,
    {
      tenant_id: '',
      empresa_id: '',
      sitio_id: '',
      nivel_pertenencia: 'empresa',
      nombre: 'Monitor de sitio',
      tipo: 'ping',
      host: '192.0.2.10',
      intervalo_ejecucion_segundos: '60',
      timeout_ms: '1200',
      reintentos: '1',
      tamano_paquete_bytes: '56',
      ttl: '64'
    }
  );

  assert.equal(definicion.tenantId, tenant.id);
  assert.equal(definicion.empresaId, empresa.id);
  assert.equal(definicion.sitioId, sitio.id);
}

async function verificarPanelUsaAlcanceHumano() {
  const controlador = new ControladorPortal({
    resolutorScopeUsuario: {
      describirScope() {
        return 'Fallback tecnico.';
      }
    },
    resumenArranque: {},
    servicioAutorizacion: new ServicioAutorizacion(),
    servicioConfiguracionPortal: null,
    servicioCorreoPortal: null,
    servicioDashboard: null,
    servicioGestionAlertasActivasPortal: null,
    repositorioTenants: {
      async buscarPorId(idTenant) {
        assert.equal(idTenant, 55);
        return { id: 55, nombre: 'Cliente humano' };
      }
    }
  });
  const alcance = await controlador.construirAlcancePanel({
    tenantId: 55,
    empresaId: null,
    sitioId: null,
    nivelScope: 'tenant',
    esOperadorSistema: false
  });

  assert.equal(alcance.descripcion, 'Alcance acotado a Cliente humano.');
  assert.equal(
    alcance.cobertura,
    'Cliente humano · Todas las empresas · Todos los sitios'
  );
}

async function main() {
  verificarCatalogoRuntime();
  verificarAutorizacionDescartesAlertasActivas();
  await verificarGestionPortalDescartesAlertasActivas();
  await verificarRepositorioDescartesEvitaSobrescrituraConcurrente();
  verificarDifusorProgramaVencimientosDescartesTemporales();
  await verificarDashboardSeparaAlertasDescartadas();
  await verificarDescartesTemporalesEnDashboard();
  await verificarInterpretacionEstadoRuntime();
  await verificarDescarteOperativoAlertaActiva();
  await verificarRearmeYRecaidaAlertaDescartada();
  verificarDistribucionTipoFuturo();
  verificarEjecutoresExtensibles();
  verificarCompactacionEventosUsaExitoTecnico();
  verificarContratoMonitorLogico();
  verificarParserMonitorLogico();
  await verificarDependenciasMonitorLogico();
  await verificarEjecutorMonitorLogico();
  await verificarPersistenciaComunMonitorLogico();
  verificarPlanificadorMonitoresLogicosReactivos();
  verificarSelectorVenceRetardoSenalPendiente();
  await verificarCascadaReactivaRespetaBloqueoRedis();
  await verificarTriggersDesdeMonitorLogico();
  verificarEventosHistoricoExtensibles();
  verificarDiagnosticoYRedisConTipoFuturo();
  verificarPortalPreparado();
  await verificarFormularioMonitorCompletaScopeSitio();
  await verificarPanelUsaAlcanceHumano();

  console.log(
    '[monitores:verificar-desacoplamiento] OK: catálogo, runtime, Redis, diagnóstico, eventos, histórico y portal no dependen de total = ping + tcp.'
  );
}

await main();
