import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  CondicionRangoNumericoTelemetria,
  CondicionValorEsperadoTelemetria,
  crearConfiguracionMonitorTelemetria
} from '../paquetes/monitores/src/ConfiguracionMonitorTelemetria.js';
import { EvaluadorMonitorTelemetria } from '../paquetes/monitores/src/EvaluadorMonitorTelemetria.js';
import {
  RepositorioEstadoActualTelemetriaAgentes
} from '../paquetes/agentes/src/RepositorioEstadoActualTelemetriaAgentes.js';
import {
  VinculoMonitorTelemetriaPersistido
} from '../paquetes/monitores/src/RepositorioVinculosMonitoresTelemetria.js';
import { EjecutorMonitorTelemetria } from '../apps/sentinelia-runtime/src/ejecucion/EjecutorMonitorTelemetria.js';
import { RegistroEjecutoresMonitor } from '../apps/sentinelia-runtime/src/ejecucion/RegistroEjecutoresMonitor.js';
import { MotorMonitores } from '../apps/sentinelia-runtime/src/ejecucion/MotorMonitores.js';

const evaluador = new EvaluadorMonitorTelemetria();

function verificarConfiguracionTipada() {
  const rango = crearConfiguracionMonitorTelemetria(
    configuracionRango({ minimo: 20, maximo: 95 }),
    { senal: senalCatalogada({ tipoDato: 'numero', unidad: 'ºC' }) }
  );
  assert.ok(rango.condicion instanceof CondicionRangoNumericoTelemetria);
  assert.deepEqual(rango.serializar(), configuracionRango({
    minimo: 20,
    maximo: 95,
    completa: true
  }));
  assert.equal(Object.isFrozen(rango), true);
  assert.equal(Object.isFrozen(rango.condicion), true);

  const booleana = crearConfiguracionMonitorTelemetria(
    configuracionEsperada({ tipoDato: 'booleano', valorEsperado: true }),
    { senal: senalCatalogada({ tipoDato: 'booleano' }) }
  );
  assert.ok(booleana.condicion instanceof CondicionValorEsperadoTelemetria);
  assert.equal(booleana.condicion.operador, 'igual');

  assert.throws(
    () => crearConfiguracionMonitorTelemetria(configuracionRango({})),
    /al menos un límite/
  );
  assert.throws(
    () => crearConfiguracionMonitorTelemetria(
      configuracionRango({ minimo: 10, maximo: 5 })
    ),
    /mínimo no puede ser mayor/
  );
  assert.throws(
    () => crearConfiguracionMonitorTelemetria(
      configuracionEsperada({ tipoDato: 'booleano', valorEsperado: 'true' })
    ),
    /debe ser booleano/
  );
  assert.throws(
    () => crearConfiguracionMonitorTelemetria(
      configuracionEsperada({
        tipoDato: 'booleano',
        valorEsperado: true,
        operador: 'diferente'
      })
    ),
    /únicamente el valor normal esperado/
  );
  assert.throws(
    () => crearConfiguracionMonitorTelemetria(
      configuracionEsperada({ tipoDato: 'json', valorEsperado: {} })
    ),
    /solo admite booleano, estado o texto/
  );
  assert.throws(
    () => crearConfiguracionMonitorTelemetria(
      { ...configuracionRango({ maximo: 90 }), identificadorSenal: 47 }
    ),
    /campos no admitidos/
  );
  assert.throws(
    () => crearConfiguracionMonitorTelemetria(
      configuracionRango({ maximo: 90 }),
      { senal: senalCatalogada({ tipoDato: 'texto' }) }
    ),
    /coincidir exactamente/
  );
}

function verificarRangosInclusivos() {
  const senal = senalCatalogada({ tipoDato: 'numero', unidad: 'ºC' });
  const configuracion = configuracionRango({ minimo: 20, maximo: 95 });
  for (const valor of [20, 50, 95]) {
    const resultado = evaluador.evaluar({
      configuracion,
      senal,
      lecturaActual: lecturaActual({ tipoDato: 'numero', unidad: 'ºC', valor })
    });
    assert.equal(resultado.esNormal(), true);
    assert.equal(resultado.codigoMotivo, 'valor_en_tolerancia');
  }
  const baja = evaluador.evaluar({
    configuracion,
    senal,
    lecturaActual: lecturaActual({ tipoDato: 'numero', unidad: 'ºC', valor: 19.9 })
  });
  const alta = evaluador.evaluar({
    configuracion,
    senal,
    lecturaActual: lecturaActual({ tipoDato: 'numero', unidad: 'ºC', valor: 95.1 })
  });
  assert.equal(baja.esFallo(), true);
  assert.equal(baja.codigoMotivo, 'valor_bajo_minimo');
  assert.equal(alta.esFallo(), true);
  assert.equal(alta.codigoMotivo, 'valor_sobre_maximo');

  assert.equal(
    evaluador.evaluar({
      configuracion: configuracionRango({ minimo: 0 }),
      senal,
      lecturaActual: lecturaActual({ tipoDato: 'numero', unidad: 'ºC', valor: 100 })
    }).esNormal(),
    true
  );
  assert.equal(
    evaluador.evaluar({
      configuracion: configuracionRango({ maximo: 100 }),
      senal,
      lecturaActual: lecturaActual({ tipoDato: 'numero', unidad: 'ºC', valor: -100 })
    }).esNormal(),
    true
  );
}

function verificarValoresEsperados() {
  verificarComparacion({
    tipoDato: 'booleano',
    valorEsperado: true,
    valorNormal: true,
    valorFallo: false
  });
  verificarComparacion({
    tipoDato: 'estado',
    valorEsperado: 'abierta',
    valorNormal: 'abierta',
    valorFallo: 'cerrada'
  });
  verificarComparacion({
    tipoDato: 'texto',
    operador: 'diferente',
    valorEsperado: 'error',
    valorNormal: 'operativo',
    valorFallo: 'error'
  });
}

function verificarComparacion({
  tipoDato,
  operador = 'igual',
  valorEsperado,
  valorNormal,
  valorFallo
}) {
  const senal = senalCatalogada({ tipoDato });
  const configuracion = configuracionEsperada({
    tipoDato,
    operador,
    valorEsperado
  });
  const normal = evaluador.evaluar({
    configuracion,
    senal,
    lecturaActual: lecturaActual({ tipoDato, valor: valorNormal })
  });
  const fallo = evaluador.evaluar({
    configuracion,
    senal,
    lecturaActual: lecturaActual({ tipoDato, valor: valorFallo })
  });
  assert.equal(normal.esNormal(), true);
  assert.equal(normal.codigoMotivo, 'valor_esperado');
  assert.equal(fallo.esFallo(), true);
  assert.equal(fallo.codigoMotivo, 'valor_inesperado');
}

function verificarDesconocidos() {
  const senal = senalCatalogada({ tipoDato: 'numero', unidad: 'bar' });
  const configuracion = configuracionRango({ maximo: 10 });
  const ausente = evaluador.evaluar({ configuracion, senal });
  assert.equal(ausente.esDesconocido(), true);
  assert.equal(ausente.codigoMotivo, 'sin_observacion_actual');

  const unidadDistinta = evaluador.evaluar({
    configuracion,
    senal,
    lecturaActual: lecturaActual({ tipoDato: 'numero', unidad: 'BAR', valor: 4 })
  });
  assert.equal(unidadDistinta.esDesconocido(), true);
  assert.equal(unidadDistinta.codigoMotivo, 'unidad_fotografia_incompatible');

  const identidadDistinta = evaluador.evaluar({
    configuracion,
    senal,
    lecturaActual: {
      ...lecturaActual({ tipoDato: 'numero', unidad: 'bar', valor: 4 }),
      senalId: 999
    }
  });
  assert.equal(identidadDistinta.codigoMotivo, 'identidad_fotografia_incompatible');
}

async function verificarLecturaSqlDirigida() {
  const cliente = {
    ultima: null,
    async consultar(sql, parametros) {
      this.ultima = { sql, parametros };
      return [];
    }
  };
  const repositorio = new RepositorioEstadoActualTelemetriaAgentes(cliente);
  assert.equal(
    await repositorio.buscarPorSenalId({ agenteId: 31, senalId: 47 }),
    null
  );
  assert.deepEqual(cliente.ultima.parametros, [31, 47]);
  assert.match(cliente.ultima.sql, /e\.agente_id = \?/);
  assert.match(cliente.ultima.sql, /e\.senal_id = \?/);
  assert.doesNotMatch(cliente.ultima.sql, /observaciones_telemetria_agentes/);
}

async function verificarEjecutorProgramado() {
  const vinculo = crearVinculoDirecto();
  const lectura = lecturaActual({ tipoDato: 'numero', unidad: 'ºC', valor: 42 });
  const ejecutor = new EjecutorMonitorTelemetria({
    repositorioVinculos: {
      async buscarPorMonitorId() { return vinculo; }
    },
    repositorioEstadoActualTelemetria: {
      async buscarPorSenalId() { return lectura; }
    },
    reloj: () => new Date('2026-07-20T12:00:00Z')
  });
  const registro = new RegistroEjecutoresMonitor({ ejecutores: [ejecutor] });
  const motor = new MotorMonitores({ registroEjecutores: registro });
  const monitor = crearMonitorRuntime();
  const lote = await motor.ejecutarMonitores({
    catalogoOperativo: { buscarPorId: () => monitor },
    candidatos: [{
      monitorId: 101,
      tipo: 'telemetria',
      proximoIntentoEn: '2026-07-20T12:00:00Z',
      retrasoSegundos: 0,
      motivoProgramacion: 'intervalo_desde_ultima_ejecucion'
    }]
  });
  assert.equal(lote.totalEjecutados, 1);
  assert.equal(lote.totalExitosos, 1);
  assert.equal(lote.resultados[0].estadoDetectado, 'disponible');
  assert.equal(lote.resultados[0].codigoResultado, 'valor_en_tolerancia');
  assert.equal(lote.resultados[0].protocolo.nombre, 'telemetria');
  assert.equal(lote.resultados[0].metricaPrincipal.evidencia.observacion.valor, 42);

  const sinLectura = new EjecutorMonitorTelemetria({
    repositorioVinculos: { async buscarPorMonitorId() { return vinculo; } },
    repositorioEstadoActualTelemetria: {
      async buscarPorSenalId() { return null; }
    },
    reloj: () => new Date('2026-07-20T12:00:00Z')
  });
  const desconocido = await sinLectura.ejecutar(monitor);
  assert.equal(desconocido.estadoDetectado, 'desconocido');
  assert.equal(desconocido.codigoResultado, 'sin_observacion_actual');
  assert.equal(desconocido.intentoExitoso, null);

  const derivado = new EjecutorMonitorTelemetria({
    repositorioVinculos: {
      async buscarPorMonitorId() { return crearVinculoDerivado(); }
    },
    repositorioEstadoActualTelemetria: {},
    reloj: () => new Date('2026-07-20T12:00:00Z')
  });
  const reservado = await derivado.ejecutar(monitor);
  assert.equal(reservado.estadoDetectado, 'desconocido');
  assert.equal(reservado.codigoResultado, 'regla_derivacion_sin_estado_actual');
}

async function verificarFronterasDeFase() {
  const [evaluadorFuente, ejecutorFuente, bootstrapFuente, runtimeFuente] =
    await Promise.all([
      readFile(new URL('../paquetes/monitores/src/EvaluadorMonitorTelemetria.js', import.meta.url), 'utf8'),
      readFile(new URL('../apps/sentinelia-runtime/src/ejecucion/EjecutorMonitorTelemetria.js', import.meta.url), 'utf8'),
      readFile(new URL('../apps/sentinelia-runtime/src/BootstrapRuntime.js', import.meta.url), 'utf8'),
      readFile(new URL('../apps/sentinelia-runtime/src/RuntimeSentinelia.js', import.meta.url), 'utf8')
    ]);
  for (const fuente of [evaluadorFuente, ejecutorFuente]) {
    assert.equal(
      /\b(?:INSERT\s+INTO|UPDATE\s+[a-z_]|DELETE\s+FROM)\b/iu.test(fuente),
      false
    );
    assert.equal(fuente.includes('periodos_vida_pol_agentes'), false);
    assert.equal(fuente.includes('alertas_activas_monitores'), false);
    assert.equal(fuente.includes('triggers'), false);
  }
  assert.ok(bootstrapFuente.includes('RepositorioEstadoActualTelemetriaAgentes'));
  assert.ok(bootstrapFuente.includes('RepositorioVinculosMonitoresTelemetria'));
  assert.ok(
    runtimeFuente.includes("import { EjecutorMonitorTelemetria }"),
    'La activación productiva debe conservar el ejecutor construido en 5.20b.3.'
  );
}

function configuracionRango({ minimo = null, maximo = null, completa = false } = {}) {
  const condicion = {
    tipo: 'rango_numerico',
    version: 1,
    minimo,
    maximo
  };
  if (completa) {
    condicion.tipoDato = 'numero';
  }
  return {
    version: 1,
    ...(completa ? { retardoFalloSegundos: 0 } : {}),
    condicion
  };
}

function configuracionEsperada({
  tipoDato,
  valorEsperado,
  operador = 'igual'
}) {
  return {
    version: 1,
    condicion: {
      tipo: 'valor_esperado',
      tipoDato,
      version: 1,
      operador,
      valorEsperado
    }
  };
}

function senalCatalogada({ tipoDato, unidad = null }) {
  return { id: 47, agenteId: 31, tipoDato, unidad };
}

function lecturaActual({ tipoDato, unidad = null, valor }) {
  return {
    agenteId: 31,
    senalId: 47,
    ultimaObservacionId: 501,
    tipoDato,
    unidad,
    valorNumero: tipoDato === 'numero' ? valor : null,
    valorBooleano: tipoDato === 'booleano' ? valor : null,
    valorEstado: tipoDato === 'estado' ? valor : null,
    valorTexto: tipoDato === 'texto' ? valor : null,
    calidad: 'valida',
    severidadDeclarada: 'info',
    observadoEnUtc: '2026-07-20T11:59:00Z',
    recibidoEnUtc: '2026-07-20T11:59:01Z'
  };
}

function crearVinculoDirecto() {
  return new VinculoMonitorTelemetriaPersistido({
    monitor_id: 101,
    tipo_fuente: 'senal_directa',
    tenant_id: 1,
    empresa_id: 2,
    sitio_id: 3,
    agente_id: 31,
    senal_id: 47,
    regla_id: null,
    senal_origen_id: 47,
    senal_origen_tipo_dato: 'numero',
    senal_origen_unidad: 'ºC',
    regla_estado: null,
    fecha_creacion: new Date('2026-07-20T10:00:00Z'),
    fecha_actualizacion: new Date('2026-07-20T10:00:00Z')
  });
}

function crearVinculoDerivado() {
  return new VinculoMonitorTelemetriaPersistido({
    monitor_id: 101,
    tipo_fuente: 'regla_derivacion',
    tenant_id: 1,
    empresa_id: 2,
    sitio_id: 3,
    agente_id: 31,
    senal_id: null,
    regla_id: 73,
    senal_origen_id: 47,
    senal_origen_tipo_dato: 'numero',
    senal_origen_unidad: 'ºC',
    regla_estado: 'activa',
    fecha_creacion: new Date('2026-07-20T10:00:00Z'),
    fecha_actualizacion: new Date('2026-07-20T10:00:00Z')
  });
}

function crearMonitorRuntime() {
  return {
    id: 101,
    nombre: 'Temperatura cámara',
    tipo: 'telemetria',
    interpretacionEstado: 'normal',
    descripcionFallo: 'Temperatura fuera de tolerancia.',
    posibleSolucion: 'Revisar la refrigeración.',
    version: 'v-101',
    scope: { tenantId: 1, empresaId: 2, sitioId: 3 },
    configuracion: configuracionRango({ minimo: 20, maximo: 95 })
  };
}

async function main() {
  verificarConfiguracionTipada();
  verificarRangosInclusivos();
  verificarValoresEsperados();
  verificarDesconocidos();
  await verificarLecturaSqlDirigida();
  await verificarEjecutorProgramado();
  await verificarFronterasDeFase();

  console.log('OK: condiciones directas y ejecutor programado de telemetría verificados.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
