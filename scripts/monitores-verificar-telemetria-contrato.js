import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  agruparMonitoresPorTipo,
  existeTipoMonitor,
  listarDefinicionesTiposMonitor,
  obtenerDefinicionTipoMonitor
} from '../paquetes/monitores/src/CatalogoTiposMonitor.js';
import {
  asegurarTipoDatoDirectamenteMonitorizable,
  crearFuenteDirectaMonitorTelemetria,
  crearFuenteReglaMonitorTelemetria,
  esTipoDatoDirectamenteMonitorizable,
  ESTADOS_MONITOR_TELEMETRIA,
  FuenteMonitorTelemetria,
  MonitorTelemetriaAgente,
  ResultadoMonitorTelemetria,
  TIPO_MONITOR_TELEMETRIA_AGENTE,
  TIPOS_FUENTE_MONITOR_TELEMETRIA
} from '../paquetes/monitores/src/MonitorTelemetriaAgente.js';
import {
  normalizarInterpretacionEstadoMonitorPorTipo,
  validarInterpretacionEstadoMonitorPorTipo
} from '../paquetes/monitores/src/SemanticaEstadoMonitor.js';
import { ServicioMonitores } from '../paquetes/monitores/src/ServicioMonitores.js';

function verificarRegistroComoMonitorReal() {
  assert.equal(TIPO_MONITOR_TELEMETRIA_AGENTE, 'telemetria');
  assert.equal(existeTipoMonitor(' TELEMETRIA '), true);

  const definicion = obtenerDefinicionTipoMonitor('telemetria');
  assert.ok(definicion);
  assert.equal(definicion.familiaOperativa, 'telemetria');
  assert.equal(definicion.capacidades.ejecutaSondeoExterno, false);
  assert.equal(definicion.capacidades.evaluaEstadoInterno, true);
  assert.equal(definicion.capacidades.admiteProgramacion, true);
  assert.equal(definicion.capacidades.generaEventos, true);
  assert.equal(definicion.capacidades.generaAlertas, true);
  assert.equal(definicion.capacidades.admiteTriggers, true);
  assert.equal(definicion.capacidades.creableDesdePortal, true);

  const servicio = new ServicioMonitores({});
  assert.deepEqual(
    servicio.construirOpcionesTipoMonitorFormulario().map(({ valor }) => valor),
    ['ping', 'tcp', 'telemetria']
  );
  assert.ok(
    servicio
      .construirOpcionesTipoMonitorFiltro()
      .some(({ valor }) => valor === 'telemetria')
  );
  assert.deepEqual(agruparMonitoresPorTipo([]), {
    ping: 0,
    tcp: 0,
    booleano: 0,
    telemetria: 0
  });
  assert.equal(
    listarDefinicionesTiposMonitor().filter(({ valor }) => valor === 'telemetria')
      .length,
    1
  );
}

function verificarFuentesExcluyentes() {
  const directa = crearFuenteDirectaMonitorTelemetria({
    agenteId: 31,
    senalId: 47
  });
  assert.ok(directa instanceof FuenteMonitorTelemetria);
  assert.equal(directa.esSenalDirecta(), true);
  assert.equal(directa.esReglaDerivacion(), false);
  assert.deepEqual(directa.serializar(), {
    tipo: TIPOS_FUENTE_MONITOR_TELEMETRIA.SENAL_DIRECTA,
    agenteId: 31,
    senalId: 47,
    reglaId: null
  });
  assert.equal(Object.isFrozen(directa), true);

  const derivada = crearFuenteReglaMonitorTelemetria({ reglaId: 73 });
  assert.equal(derivada.esSenalDirecta(), false);
  assert.equal(derivada.esReglaDerivacion(), true);
  assert.deepEqual(derivada.serializar(), {
    tipo: TIPOS_FUENTE_MONITOR_TELEMETRIA.REGLA_DERIVACION,
    agenteId: null,
    senalId: null,
    reglaId: 73
  });

  assert.throws(
    () =>
      new FuenteMonitorTelemetria({
        tipo: TIPOS_FUENTE_MONITOR_TELEMETRIA.SENAL_DIRECTA,
        agenteId: 31,
        senalId: 47,
        reglaId: 73
      }),
    /no puede referenciar una regla/
  );
  assert.throws(
    () =>
      new FuenteMonitorTelemetria({
        tipo: TIPOS_FUENTE_MONITOR_TELEMETRIA.REGLA_DERIVACION,
        reglaId: 73,
        agenteId: 31
      }),
    /no puede declarar además agente o señal/
  );
  assert.throws(() => new FuenteMonitorTelemetria(), /tipo de fuente/);
  assert.throws(
    () => crearFuenteDirectaMonitorTelemetria({ agenteId: true, senalId: 47 }),
    /agente de la fuente directa/
  );
}

function verificarIdentidadYScope() {
  const monitor = new MonitorTelemetriaAgente({
    monitorId: 101,
    scope: { tenantId: 1, empresaId: 2, sitioId: 3 },
    fuente: crearFuenteDirectaMonitorTelemetria({ agenteId: 31, senalId: 47 })
  });

  assert.equal(monitor.tipo, 'telemetria');
  assert.equal(monitor.usaSenalDirecta(), true);
  assert.equal(monitor.usaReglaDerivacion(), false);
  assert.equal(Object.isFrozen(monitor), true);
  assert.equal(Object.isFrozen(monitor.scope), true);
  assert.equal(Object.isFrozen(monitor.fuente), true);
  assert.deepEqual(monitor.serializar(), {
    monitorId: 101,
    tipo: 'telemetria',
    scope: { tenantId: 1, empresaId: 2, sitioId: 3 },
    fuente: {
      tipo: 'senal_directa',
      agenteId: 31,
      senalId: 47,
      reglaId: null
    }
  });

  assert.throws(
    () =>
      new MonitorTelemetriaAgente({
        monitorId: 101,
        scope: { tenantId: 1, empresaId: 2 },
        fuente: crearFuenteReglaMonitorTelemetria({ reglaId: 73 })
      }),
    /sitio del monitor/
  );
}

function verificarEstadosOperativos() {
  const normal = new ResultadoMonitorTelemetria({
    estado: ESTADOS_MONITOR_TELEMETRIA.NORMAL,
    codigoMotivo: 'condicion_no_cumplida'
  });
  const fallo = new ResultadoMonitorTelemetria({
    estado: ESTADOS_MONITOR_TELEMETRIA.FALLO,
    codigoMotivo: 'fuera_de_rango',
    evidencia: { valor: 96, unidad: 'ºC' }
  });
  const pendiente = new ResultadoMonitorTelemetria({
    estado: ESTADOS_MONITOR_TELEMETRIA.PENDIENTE,
    codigoMotivo: 'retardo_sostenido',
    estadoCandidato: ESTADOS_MONITOR_TELEMETRIA.FALLO
  });
  const desconocido = new ResultadoMonitorTelemetria({
    estado: ESTADOS_MONITOR_TELEMETRIA.DESCONOCIDO,
    codigoMotivo: 'sin_observacion'
  });

  assert.equal(normal.esNormal(), true);
  assert.equal(fallo.esFallo(), true);
  assert.equal(pendiente.esPendiente(), true);
  assert.equal(desconocido.esDesconocido(), true);
  assert.equal(normal.esEstable(), true);
  assert.equal(fallo.esEstable(), true);
  assert.equal(pendiente.esEstable(), false);
  assert.equal(desconocido.esEstable(), false);
  assert.equal(Object.isFrozen(fallo.evidencia), true);

  assert.throws(
    () =>
      new ResultadoMonitorTelemetria({
        estado: 'pendiente',
        codigoMotivo: 'retardo_sostenido'
      }),
    /debe identificar un candidato/
  );
  assert.throws(
    () =>
      new ResultadoMonitorTelemetria({
        estado: 'fallo',
        codigoMotivo: 'fuera_de_rango',
        estadoCandidato: 'fallo'
      }),
    /Solo un resultado pendiente/
  );
}

function verificarTiposDirectosYSemantica() {
  for (const tipo of ['numero', 'booleano', 'estado', 'texto']) {
    assert.equal(esTipoDatoDirectamenteMonitorizable(tipo), true);
    assert.equal(asegurarTipoDatoDirectamenteMonitorizable(tipo), tipo);
  }
  assert.equal(esTipoDatoDirectamenteMonitorizable('json'), false);
  assert.throws(
    () => asegurarTipoDatoDirectamenteMonitorizable('json'),
    /JSON no son evaluables directamente/
  );
  assert.equal(esTipoDatoDirectamenteMonitorizable('binario'), false);
  assert.throws(
    () => asegurarTipoDatoDirectamenteMonitorizable('binario'),
    /no es monitorizable directamente/
  );

  assert.equal(
    normalizarInterpretacionEstadoMonitorPorTipo({
      tipo: 'telemetria',
      valor: 'invertida'
    }),
    'normal'
  );
  assert.equal(
    validarInterpretacionEstadoMonitorPorTipo({
      tipo: 'telemetria',
      valor: 'invertida'
    }),
    'normal'
  );
}

async function verificarFronteraDeDominio() {
  const contenido = await readFile(
    new URL('../paquetes/monitores/src/MonitorTelemetriaAgente.js', import.meta.url),
    'utf8'
  );
  const dependenciasProhibidas = [
    'mysql',
    'redis',
    'express',
    'Repositorio',
    'EjecutorMonitorTelemetria',
    'GestorAlertas',
    'MotorTriggers'
  ];

  for (const dependencia of dependenciasProhibidas) {
    assert.equal(
      contenido.includes(dependencia),
      false,
      `El contrato puro no debe depender de ${dependencia}.`
    );
  }
}

async function main() {
  verificarRegistroComoMonitorReal();
  verificarFuentesExcluyentes();
  verificarIdentidadYScope();
  verificarEstadosOperativos();
  verificarTiposDirectosYSemantica();
  await verificarFronteraDeDominio();

  console.log('OK: contrato de dominio del monitor de telemetría verificado.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
