import assert from 'node:assert/strict';
import { GestorAlertasActivasMonitor } from '../apps/sentinelia-runtime/src/alertas/GestorAlertasActivasMonitor.js';
import { ServicioGestionAlertasActivasPortal } from '../apps/sentinelia-web/src/servicios/ServicioGestionAlertasActivasPortal.js';
import { AlertaActivaMonitor } from '../paquetes/monitores/src/AlertaActivaMonitor.js';
import {
  generarUuidV7Auditoria,
  uuidV7AuditoriaABytes
} from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import { validarEventoAuditableV1 } from '../paquetes/auditoria/src/ValidadorContratoAuditoria.js';
import { prepararIntencionAuditoriaV1 } from '../paquetes/auditoria/src/HuellaIntencionAuditoria.js';

async function main() {
  await verificarAperturaRuntimeOutbox();
  await verificarCierreRuntimeOutbox();
  await verificarDescarteWebAuditable();
  await verificarReversionWebAuditable();
  await verificarDescarteWebImpersonadoAuditable();

  console.log(
    '[monitores] OK 5.21.10c: alertas=auditable apertura_cierre=outbox descarte=reversion_web payload=minimo impersonacion=contrato'
  );
}

async function verificarAperturaRuntimeOutbox() {
  const repositorio = new RepositorioAlertasMemoria();
  const outbox = new OutboxMemoria();
  const gestor = new GestorAlertasActivasMonitor({
    repositorioAlertasActivasMonitor: repositorio,
    repositorioOutboxAuditoriaRuntime: outbox,
    reloj: () => new Date('2026-07-25T10:00:00.000Z')
  });

  const resumen = await gestor.aplicarResultados({
    catalogoOperativo: catalogoOperativo(),
    resultados: [resultadoMonitor({ exito: false })]
  });

  assert.equal(resumen.totalAperturas, 1);
  assert.equal(repositorio.alertas.size, 1);
  assert.equal(outbox.intenciones.length, 1);
  const intencion = outbox.intenciones[0];
  assert.equal(intencion.tipo, 'alerta.abierta');
  assert.equal(intencion.sujeto.tipo, 'alerta');
  assert.equal(intencion.sujeto.id, repositorio.alertas.get(10).alertaAuditoriaId);
  assert.equal(intencion.claveOperacion, `ciclo:${intencion.sujeto.id}:abierta`);
  assert.deepEqual(intencion.payload, {
    resultado: 'abierta',
    causa: 'monitor_en_fallo'
  });
  assertSinContenidoOperativo(intencion.payload);
}

async function verificarCierreRuntimeOutbox() {
  const alertaAuditoriaId = generarUuidV7Auditoria();
  const repositorio = new RepositorioAlertasMemoria([
    alertaActiva({ alertaAuditoriaId })
  ]);
  const outbox = new OutboxMemoria();
  const gestor = new GestorAlertasActivasMonitor({
    repositorioAlertasActivasMonitor: repositorio,
    repositorioOutboxAuditoriaRuntime: outbox,
    reloj: () => new Date('2026-07-25T10:00:00.000Z')
  });

  const resumen = await gestor.aplicarResultados({
    catalogoOperativo: catalogoOperativo(),
    resultados: [resultadoMonitor({ exito: true, estadoDetectado: 'disponible' })]
  });

  assert.equal(resumen.totalCierres, 1);
  assert.equal(repositorio.alertas.size, 0);
  assert.equal(outbox.intenciones.length, 1);
  const intencion = outbox.intenciones[0];
  assert.equal(intencion.tipo, 'alerta.cerrada');
  assert.equal(intencion.sujeto.id, alertaAuditoriaId);
  assert.equal(intencion.claveOperacion, `ciclo:${alertaAuditoriaId}:cerrada`);
  assert.deepEqual(intencion.payload, {
    resultado: 'cerrada',
    causa: 'monitor_recuperado'
  });
}

async function verificarDescarteWebAuditable() {
  const entorno = crearEntornoPortal();

  const resultado = await entorno.servicio.descartarAlertaActiva(
    contextoPortal(),
    {
      monitorId: 10,
      motivo: 'Mantenimiento aceptado por operaciones.',
      hastaUtc: '2099-01-01T00:00:00.000Z'
    }
  );

  assert.equal(resultado.alerta.descarteOperativo.vigente, true);
  assert.deepEqual(entorno.traza, [
    'begin',
    'sql:descartar',
    'audit:alerta.descarte_aplicado',
    'commit',
    'programar-vencimiento',
    'notificar:descarte_alerta_activa'
  ]);
  assert.deepEqual(entorno.auditoria.eventos[0].payload, {
    resultado: 'aplicado',
    causa: 'operador'
  });
  assertSinContenidoOperativo(entorno.auditoria.eventos[0].payload);
}

async function verificarReversionWebAuditable() {
  const entorno = crearEntornoPortal({
    alerta: alertaActiva({
      descartadaDashboard: true,
      motivoDescarte: 'Mantenimiento aceptado por operaciones.',
      descartadaPorUsuarioId: 7,
      descartadaEnUtc: '2026-07-25 10:00:00',
      descartadaHastaUtc: null
    })
  });

  const resultado = await entorno.servicio.revertirDescarteAlertaActiva(
    contextoPortal(),
    { monitorId: 10 }
  );

  assert.equal(resultado.alerta.descarteOperativo.vigente, false);
  assert.deepEqual(entorno.traza, [
    'begin',
    'sql:revertir',
    'audit:alerta.descarte_revertido',
    'commit',
    'notificar:reversion_descarte_alerta_activa'
  ]);
  assert.deepEqual(entorno.auditoria.eventos[0].payload, {
    resultado: 'revertido',
    causa: 'operador'
  });
}

async function verificarDescarteWebImpersonadoAuditable() {
  const entorno = crearEntornoPortal();

  await entorno.servicio.descartarAlertaActiva(
    contextoPortalImpersonado(),
    {
      monitorId: 10,
      motivo: 'Mantenimiento aceptado por operaciones.',
      hastaUtc: '2099-01-01T00:00:00.000Z'
    }
  );

  const evento = entorno.auditoria.eventos[0];
  assert.equal(evento.tipo, 'alerta.descarte_aplicado');
  assert.equal(evento.modoActuacion, 'impersonado');
  assert.deepEqual(evento.actorReal, { tipo: 'usuario', id: '7' });
  assert.deepEqual(evento.actorEfectivo, { tipo: 'usuario', id: '11' });
}

class RepositorioAlertasMemoria {
  constructor(alertas = []) {
    this.alertas = new Map(alertas.map((alerta) => [Number(alerta.monitorId), alerta]));
  }

  async listarPorMonitorIds(idsMonitor = []) {
    return idsMonitor
      .map((id) => this.alertas.get(Number(id)))
      .filter(Boolean);
  }

  async guardarAlertas(alertas = []) {
    for (const alerta of alertas) {
      this.alertas.set(Number(alerta.monitorId), alerta);
    }
    return alertas.length;
  }

  async eliminarPorMonitorIds(idsMonitor = []) {
    let eliminadas = 0;
    for (const id of idsMonitor) {
      if (this.alertas.delete(Number(id))) {
        eliminadas += 1;
      }
    }
    return eliminadas;
  }
}

class OutboxMemoria {
  constructor() {
    this.intenciones = [];
  }

  async encolarAtomico(intenciones = []) {
    for (const intencion of intenciones) {
      validarEventoAuditableV1(intencion);
      this.intenciones.push(intencion);
    }
    return intenciones.map((intencion, indice) => ({
      id: String(indice + 1),
      eventoId: intencion.eventoId,
      estado: 'pendiente',
      resultadoAlta: 'creada'
    }));
  }
}

function crearEntornoPortal({ alerta = alertaActiva() } = {}) {
  const traza = [];
  const auditoria = {
    eventos: [],
    async registrarEnTransaccion({ intencion }, { conexion } = {}) {
      assert.ok(conexion);
      validarEventoAuditableV1(intencion);
      prepararIntencionAuditoriaV1(intencion);
      traza.push(`audit:${intencion.tipo}`);
      this.eventos.push(intencion);
      return { evento: intencion, estado: 'incorporado' };
    }
  };
  const repositorioAlertasActivasMonitor = {
    alerta,
    async buscarPorMonitorId(id) {
      return Number(id) === Number(this.alerta?.monitorId) ? this.alerta : null;
    },
    async descartarDashboard(_datos, { conexion } = {}) {
      assert.ok(conexion);
      traza.push('sql:descartar');
      this.alerta = alertaActiva({
        alertaAuditoriaId: this.alerta.alertaAuditoriaId,
        descartadaDashboard: true,
        motivoDescarte: 'Mantenimiento aceptado por operaciones.',
        descartadaPorUsuarioId: 7,
        descartadaEnUtc: '2026-07-25 10:00:00',
        descartadaHastaUtc: '2099-01-01 00:00:00'
      });
      return this.alerta;
    },
    async revertirDescarteDashboard(_datos, { conexion } = {}) {
      assert.ok(conexion);
      traza.push('sql:revertir');
      this.alerta = alertaActiva({
        alertaAuditoriaId: this.alerta.alertaAuditoriaId,
        descartadaDashboard: false
      });
      return this.alerta;
    }
  };
  const fronteraTransaccional = {
    async ejecutar(trabajo) {
      traza.push('begin');
      const resultado = await trabajo({ id: 'conexion-fake' });
      traza.push('commit');
      return resultado;
    }
  };
  const difusorWebSocketPortal = {
    emitirDashboardActualizado({ motivoPublicacion }) {
      traza.push(`notificar:${motivoPublicacion}`);
    },
    programarVencimientoDescarteTemporal() {
      traza.push('programar-vencimiento');
    }
  };
  const servicio = new ServicioGestionAlertasActivasPortal({
    repositorioMonitores: {
      async listarVisibles() {
        return [{ id: 10 }];
      }
    },
    repositorioAlertasActivasMonitor,
    servicioAutorizacion: {
      puedeGestionarDescartesAlertasActivas() {
        return true;
      }
    },
    difusorWebSocketPortal,
    fronteraTransaccional,
    servicioAuditoria: auditoria,
    ahora: () => new Date('2026-07-25T10:00:00.000Z')
  });
  return { servicio, traza, auditoria };
}

function alertaActiva({
  alertaAuditoriaId = generarUuidV7Auditoria(),
  descartadaDashboard = false,
  motivoDescarte = '',
  descartadaPorUsuarioId = null,
  descartadaEnUtc = null,
  descartadaHastaUtc = null
} = {}) {
  return new AlertaActivaMonitor({
    monitor_id: 10,
    alerta_auditoria_id: uuidV7AuditoriaABytes(
      alertaAuditoriaId,
      'alertaAuditoriaId'
    ),
    tenant_id: 1,
    empresa_id: 2,
    sitio_id: null,
    version_catalogo: '1',
    tipo_monitor: 'ping',
    estado_alerta: 'activa',
    estado_detectado: 'indisponible',
    codigo_ultimo_resultado: 'ping_fallido',
    mensaje_ultimo_resultado: 'No responde',
    valido_desde_utc: '2026-07-25 10:00:00',
    ultima_confirmacion_utc: '2026-07-25 10:00:00',
    ultima_ejecucion_utc: '2026-07-25 10:00:00',
    contador_repeticiones: 1,
    payload_alerta: JSON.stringify({
      nombreMonitor: 'Ping API',
      detalleHistorico: 'No debe viajar a auditoría'
    }),
    descartada_dashboard: descartadaDashboard ? 1 : 0,
    motivo_descarte: motivoDescarte,
    descartada_por_usuario_id: descartadaPorUsuarioId,
    descartada_en_utc: descartadaEnUtc,
    descartada_hasta_utc: descartadaHastaUtc
  });
}

function catalogoOperativo() {
  return {
    buscarPorId(id) {
      if (Number(id) !== 10) {
        return null;
      }
      return {
        id: 10,
        nombre: 'Ping API',
        tipo: 'ping',
        version: '1',
        descripcionFallo: 'No responde',
        posibleSolucion: 'Revisar conectividad',
        scope: {
          tenantId: 1,
          empresaId: 2,
          sitioId: null,
          nivelPertenencia: 'empresa'
        }
      };
    }
  };
}

function resultadoMonitor({
  exito,
  estadoDetectado = exito ? 'disponible' : 'indisponible'
}) {
  return {
    monitorId: 10,
    tipo: 'ping',
    versionCatalogo: '1',
    exito,
    estadoDetectado,
    codigoResultado: exito ? 'ping_ok' : 'ping_fallido',
    mensajeResultado: exito ? 'Disponible' : 'No responde',
    finalizadoEnUtc: '2026-07-25T10:00:00.000Z',
    scope: {
      tenantId: 1,
      empresaId: 2,
      sitioId: null,
      nivelPertenencia: 'empresa'
    }
  };
}

function contextoPortal() {
  return {
    idUsuario: 7,
    idUsuarioReal: 7,
    nivelScope: 'portal',
    tenantId: 1,
    empresaId: 2,
    sitioId: null
  };
}

function contextoPortalImpersonado() {
  return {
    ...contextoPortal(),
    idUsuario: 11,
    idUsuarioReal: 7,
    impersonacionActiva: true
  };
}

function assertSinContenidoOperativo(payload) {
  const serializado = JSON.stringify(payload);
  for (const prohibido of [
    'motivo',
    'descartadaHastaUtc',
    'monitorId',
    'nombreMonitor',
    'payloadAlerta',
    'historico'
  ]) {
    assert.equal(
      serializado.includes(prohibido),
      false,
      `El payload auditable de alerta no debe contener ${prohibido}.`
    );
  }
}

main().catch((error) => {
  console.error('[monitores] Error verificando alertas auditables 5.21.10c');
  console.error(error);
  process.exit(1);
});
