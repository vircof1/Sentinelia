import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ServicioLimpiezaTecnicaAuditoria } from '../paquetes/auditoria/src/ServicioLimpiezaTecnicaAuditoria.js';
import {
  __testablesRepositorioLimpiezaTecnicaAuditoriaSql
} from '../paquetes/auditoria/src/RepositorioLimpiezaTecnicaAuditoriaSql.js';

async function main() {
  await verificarBloqueoOcupado();
  await verificarEjecucionCoordinada();
  await verificarBacklog();
  await verificarContratoSql();
  await verificarCableadoRuntime();
  console.log('[auditoria] OK 5.21.13c: limpieza_tecnica=coordinada evidencia=intacta terminales=seguros backlog=presupuestado');
}

async function verificarBloqueoOcupado() {
  const entorno = crearEntorno({ bloqueoOcupado: true });
  const resultado = await entorno.servicio.ejecutar();
  assert.equal(resultado.omitida, true);
  assert.equal(resultado.bloqueada, true);
  assert.equal(resultado.motivo, 'bloqueo_limpieza_tecnica_ocupado');
  assert.equal(resultado.totalEliminadas, 0);
}

async function verificarEjecucionCoordinada() {
  const entorno = crearEntorno();
  const resultado = await entorno.servicio.ejecutar({
    limitePorTabla: 25,
    graciasSegundos: {
      sesionesWeb: 10,
      operacionesDns: 20,
      outboxAuditoria: 30,
      ejecucionesVerificacion: 40,
      incidentesIntegridad: 50
    }
  });
  assert.equal(resultado.motivo, 'limpieza_tecnica_ejecutada');
  assert.equal(resultado.totalEliminadas, 15);
  assert.equal(resultado.tablas.sesionesWeb.eliminadas, 2);
  assert.equal(resultado.tablas.operacionesDns.eliminadas, 3);
  assert.equal(resultado.tablas.outboxAuditoria.eliminadas, 4);
  assert.equal(resultado.tablas.ejecucionesVerificacion.eliminadas, 5);
  assert.equal(resultado.tablas.incidentesIntegridad.eliminadas, 1);
  assert.deepEqual(entorno.repositorio.traza, [
    'bloqueo_global',
    'sesiones_web',
    'outbox_auditoria',
    'ejecuciones_verificacion',
    'incidentes_integridad'
  ]);
  assert.deepEqual(entorno.dns.llamadas, [
    { graciaSegundos: 20, lote: 25 }
  ]);
}

async function verificarBacklog() {
  const entorno = crearEntorno({ eliminadas: { sesionesWeb: 25 } });
  const resultado = await entorno.servicio.ejecutar({ limitePorTabla: 25 });
  assert.equal(resultado.backlogPosible, true);
}

async function verificarContratoSql() {
  assert.equal(
    __testablesRepositorioLimpiezaTecnicaAuditoriaSql
      .NOMBRE_BLOQUEO_LIMPIEZA_TECNICA,
    'sentinelia:auditoria:limpieza-tecnica'
  );
  const fuente = await readFile(
    new URL('../paquetes/auditoria/src/RepositorioLimpiezaTecnicaAuditoriaSql.js', import.meta.url),
    'utf8'
  );
  assert.match(fuente, /GET_LOCK/);
  assert.match(fuente, /RELEASE_LOCK/);
  assert.match(fuente, /FOR UPDATE SKIP LOCKED/);
  assert.match(fuente, /estado = 'completada'/);
  assert.match(fuente, /evento_incorporado_id = evento_id/);
  assert.match(fuente, /NOT EXISTS[\s\S]*operaciones_publicacion_dns/);
  assert.match(fuente, /estado_deteccion = 'resuelto'/);
  assert.doesNotMatch(fuente, /DELETE FROM eventos_auditoria/);
  assert.doesNotMatch(fuente, /DELETE FROM cadenas_auditoria/);
  assert.doesNotMatch(fuente, /DELETE FROM identidades_idempotentes_auditoria/);

  const dns = await readFile(
    new URL('../paquetes/dns/src/RepositorioCoordinacionGeneracionesDns.js', import.meta.url),
    'utf8'
  );
  assert.match(dns, /limpiarTerminales/);
  assert.match(dns, /evento_resultado_id IS NOT NULL/);
  assert.match(dns, /estado IN \(\s*'consolidada', 'sin_cambios', 'superada'/);
}

async function verificarCableadoRuntime() {
  const bootstrap = await readFile(
    new URL('../apps/sentinelia-runtime/src/BootstrapRuntime.js', import.meta.url),
    'utf8'
  );
  assert.match(bootstrap, /ServicioLimpiezaTecnicaAuditoria/);
  assert.match(bootstrap, /RepositorioLimpiezaTecnicaAuditoriaSql/);
  assert.match(bootstrap, /servicioLimpiezaTecnicaAuditoria/);

  const runtime = await readFile(
    new URL('../apps/sentinelia-runtime/src/RuntimeSentinelia.js', import.meta.url),
    'utf8'
  );
  assert.match(runtime, /ejecutarLimpiezaTecnicaAuditoriaDiaria/);
  assert.match(runtime, /Limpieza técnica auditoría tick/);
  assert.match(runtime, /ultimaClaveLimpiezaTecnicaAuditoriaEjecutada/);
}

function crearEntorno({ bloqueoOcupado = false, eliminadas = {} } = {}) {
  const repositorio = new RepositorioFixture({ bloqueoOcupado, eliminadas });
  const dns = new DnsFixture();
  const servicio = new ServicioLimpiezaTecnicaAuditoria({
    repositorioLimpieza: repositorio,
    repositorioOperacionesDns: dns
  });
  return { servicio, repositorio, dns };
}

class RepositorioFixture {
  constructor({ bloqueoOcupado, eliminadas }) {
    this.bloqueoOcupado = bloqueoOcupado;
    this.eliminadas = {
      sesionesWeb: 2,
      outboxAuditoria: 4,
      ejecucionesVerificacion: 5,
      incidentesIntegridad: 1,
      ...eliminadas
    };
    this.traza = [];
  }

  async ejecutarConBloqueoGlobal(_opciones, tarea) {
    this.traza.push('bloqueo_global');
    if (this.bloqueoOcupado) {
      return { adquirido: false, motivo: 'bloqueo_limpieza_tecnica_ocupado' };
    }
    return { adquirido: true, resultado: await tarea() };
  }

  async limpiarSesionesWeb() {
    this.traza.push('sesiones_web');
    return { eliminadas: this.eliminadas.sesionesWeb };
  }

  async limpiarOutboxAuditoriaCompletada() {
    this.traza.push('outbox_auditoria');
    return { eliminadas: this.eliminadas.outboxAuditoria };
  }

  async limpiarEjecucionesVerificacionHistoricas() {
    this.traza.push('ejecuciones_verificacion');
    return { eliminadas: this.eliminadas.ejecucionesVerificacion };
  }

  async limpiarIncidentesIntegridadResueltos() {
    this.traza.push('incidentes_integridad');
    return { eliminadas: this.eliminadas.incidentesIntegridad };
  }
}

class DnsFixture {
  constructor() {
    this.llamadas = [];
  }

  async limpiarTerminales(entrada) {
    this.llamadas.push(entrada);
    return { eliminadas: 3 };
  }
}

main().catch((error) => {
  console.error('[auditoria] Falló la verificación 5.21.13c');
  console.error(error);
  process.exitCode = 1;
});
