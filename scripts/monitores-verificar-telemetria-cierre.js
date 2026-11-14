import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { EvaluadorMonitorTelemetria } from '../paquetes/monitores/src/EvaluadorMonitorTelemetria.js';

const ejecutarArchivo = promisify(execFile);
const raizProyecto = fileURLToPath(new URL('../', import.meta.url));
const verificadoresPrevios = [
  'monitores-verificar-telemetria-contrato.js',
  'monitores-verificar-telemetria-vinculos.js',
  'monitores-verificar-telemetria-condiciones-directas.js',
  'monitores-verificar-telemetria-ciclo-inmediato.js',
  'monitores-verificar-telemetria-reactiva.js',
  'monitores-verificar-telemetria-retardo.js',
  'monitores-verificar-telemetria-reglas.js',
  'monitores-verificar-telemetria-logica.js',
  'monitores-verificar-telemetria-crud.js'
];

async function main() {
  const fuentes = await cargarFuentesAuditadas();

  verificarMatrizTipadaYVariasTolerancias();
  verificarAislamientoPolYUltimoDato(fuentes);
  verificarSemanticaTemporal(fuentes);
  verificarCicloOperativoComun(fuentes);
  verificarComposicionLogicaGenerica(fuentes);
  verificarPermisosYScope(fuentes);
  verificarCascadaCompleta(fuentes);
  await ejecutarRegresionAcumulada();

  console.log(
    '[monitores-telemetria] OK cierre estructural completo verificado hasta 5.20b.10'
  );
}

async function cargarFuentesAuditadas() {
  const rutas = {
    configuracion: 'paquetes/monitores/src/ConfiguracionMonitorTelemetria.js',
    evaluador: 'paquetes/monitores/src/EvaluadorMonitorTelemetria.js',
    ejecutor:
      'apps/sentinelia-runtime/src/ejecucion/EjecutorMonitorTelemetria.js',
    planificador:
      'paquetes/monitores/src/PlanificadorTransicionesTelemetriaPendientes.js',
    selectorVencidos:
      'apps/sentinelia-runtime/src/scheduler/SelectorMonitoresVencidos.js',
    repositorioEstado:
      'paquetes/agentes/src/RepositorioEstadoActualTelemetriaAgentes.js',
    repositorioVinculos:
      'paquetes/monitores/src/RepositorioVinculosMonitoresTelemetria.js',
    proyector:
      'paquetes/agentes/src/ProyectorEvaluacionesDerivadasTelemetria.js',
    despachador:
      'apps/sentinelia-runtime/src/telemetria/DespachadorEvaluacionesTelemetriaRuntime.js',
    aplicadorEstado:
      'apps/sentinelia-runtime/src/estado/AplicadorResultadosEstadoActual.js',
    gestorAlertas:
      'apps/sentinelia-runtime/src/alertas/GestorAlertasActivasMonitor.js',
    gestorHistorico:
      'apps/sentinelia-runtime/src/historico/GestorHistoricoMonitores.js',
    motorTriggers:
      'apps/sentinelia-runtime/src/triggers/MotorTriggersRuntime.js',
    ejecutorLogico:
      'apps/sentinelia-runtime/src/ejecucion/EjecutorMonitorBooleano.js',
    runtime: 'apps/sentinelia-runtime/src/RuntimeSentinelia.js',
    servicio: 'paquetes/monitores/src/ServicioMonitores.js',
    rutas: 'apps/sentinelia-web/src/rutas/crearRutasPortal.js',
    esquema: 'migraciones/sql/0001_esquema_inicial.sql'
  };
  const entradas = await Promise.all(
    Object.entries(rutas).map(async ([nombre, ruta]) => [
      nombre,
      await readFile(new URL(`../${ruta}`, import.meta.url), 'utf8')
    ])
  );
  const fuentes = Object.fromEntries(entradas);
  const esquema = fuentes.esquema.replaceAll('`', '');
  const tablas = {
    migracionMonitores: 'monitores', migracionEstadoMonitores: 'estado_actual_monitores',
    migracionEventos: 'eventos_monitores', migracionAlertas: 'alertas_activas_monitores',
    migracionHistorico: 'historico_monitores', migracionAsignaciones: 'asignaciones_triggers_monitores',
    migracionAgentes: 'agentes_sentinelia', migracionSenales: 'senales_telemetria_agentes',
    migracionObservaciones: 'observaciones_telemetria_agentes',
    migracionFotografia: 'estado_actual_telemetria_agentes',
    migracionReglas: 'reglas_derivacion_telemetria',
    migracionEvaluaciones: 'evaluaciones_reglas_telemetria',
    migracionOutbox: 'trabajos_evaluacion_telemetria',
    migracionVinculos: 'vinculos_monitores_telemetria'
  };
  for (const [clave, tabla] of Object.entries(tablas)) {
    const definicion = esquema.match(new RegExp('CREATE TABLE ' + tabla + ' \\([\\s\\S]*?\\) ENGINE='));
    assert.ok(definicion, `El esquema inicial debe definir ${tabla}.`);
    fuentes[clave] = definicion[0];
  }
  fuentes.migracionCascada = esquema;
  return fuentes;
}

function verificarMatrizTipadaYVariasTolerancias() {
  const evaluador = new EvaluadorMonitorTelemetria();
  const senalNumero = crearSenal('numero', 'ºC');

  verificarCasos(evaluador, senalNumero, configuracionRango({ minimo: 20 }), [
    [20, 'normal'],
    [19.9, 'fallo'],
    [200, 'normal']
  ]);
  verificarCasos(evaluador, senalNumero, configuracionRango({ maximo: 80 }), [
    [80, 'normal'],
    [80.1, 'fallo'],
    [-200, 'normal']
  ]);
  verificarCasos(
    evaluador,
    senalNumero,
    configuracionRango({ minimo: 20, maximo: 95 }),
    [
      [20, 'normal'],
      [95, 'normal'],
      [19, 'fallo'],
      [96, 'fallo']
    ]
  );

  verificarValorEsperado(evaluador, 'booleano', true, true, false);
  verificarValorEsperado(evaluador, 'estado', 'abierta', 'abierta', 'cerrada');
  verificarValorEsperado(
    evaluador,
    'texto',
    'error',
    'operativo',
    'error',
    'diferente'
  );

  assert.throws(
    () => evaluador.evaluar({
      configuracion: configuracionEsperada('json', {}, 'igual'),
      senal: crearSenal('json'),
      lecturaActual: crearLectura('json', {})
    }),
    /Las señales JSON no son evaluables directamente/
  );

  const mismaLectura = crearLectura('numero', 85, 'ºC');
  const advertencia = evaluador.evaluar({
    configuracion: configuracionRango({ minimo: 20, maximo: 80 }),
    senal: senalNumero,
    lecturaActual: mismaLectura
  });
  const peligro = evaluador.evaluar({
    configuracion: configuracionRango({ minimo: -20, maximo: 90 }),
    senal: senalNumero,
    lecturaActual: mismaLectura
  });
  assert.equal(advertencia.esFallo(), true);
  assert.equal(advertencia.codigoMotivo, 'valor_sobre_maximo');
  assert.equal(peligro.esNormal(), true);
}

function verificarCasos(evaluador, senal, configuracion, casos) {
  for (const [valor, estado] of casos) {
    const resultado = evaluador.evaluar({
      configuracion,
      senal,
      lecturaActual: crearLectura('numero', valor, senal.unidad)
    });
    assert.equal(resultado.estado, estado);
  }
}

function verificarValorEsperado(
  evaluador,
  tipoDato,
  esperado,
  valorNormal,
  valorFallo,
  operador = 'igual'
) {
  const senal = crearSenal(tipoDato);
  const configuracion = configuracionEsperada(tipoDato, esperado, operador);
  assert.equal(
    evaluador.evaluar({
      configuracion,
      senal,
      lecturaActual: crearLectura(tipoDato, valorNormal)
    }).esNormal(),
    true
  );
  assert.equal(
    evaluador.evaluar({
      configuracion,
      senal,
      lecturaActual: crearLectura(tipoDato, valorFallo)
    }).esFallo(),
    true
  );
}

function verificarAislamientoPolYUltimoDato(fuentes) {
  const circuitoMonitor = combinar(
    fuentes.configuracion,
    fuentes.evaluador,
    fuentes.ejecutor,
    fuentes.planificador,
    fuentes.repositorioEstado,
    fuentes.repositorioVinculos
  );
  assert.doesNotMatch(
    circuitoMonitor,
    /periodos_vida_pol_agentes|ultimo_heartbeat|estadoVidaPol|cerrarPeriodoVidaPol/,
    'La pérdida o recuperación de POL no puede invalidar la última fotografía.'
  );
  assert.match(fuentes.repositorioEstado, /FROM estado_actual_telemetria_agentes/);
  assert.doesNotMatch(fuentes.repositorioEstado, /JOIN periodos_vida_pol_agentes/);

  const evaluador = new EvaluadorMonitorTelemetria();
  const entrada = {
    configuracion: configuracionRango({ maximo: 80 }),
    senal: crearSenal('numero', 'ºC'),
    lecturaActual: crearLectura('numero', 85, 'ºC')
  };
  const antesDePerderPol = evaluador.evaluar(entrada).serializar();
  const duranteLaPerdida = evaluador.evaluar(entrada).serializar();
  const trasRecuperarPol = evaluador.evaluar(entrada).serializar();
  assert.deepEqual(duranteLaPerdida, antesDePerderPol);
  assert.deepEqual(trasRecuperarPol, antesDePerderPol);
  assert.equal(antesDePerderPol.estado, 'fallo');
}

function verificarSemanticaTemporal(fuentes) {
  assert.match(fuentes.planificador, /retardoFalloSegundos/);
  assert.match(fuentes.planificador, /recibidoEnUtc/);
  assert.doesNotMatch(fuentes.planificador, /muestras|contadorMuestras/i);
  assert.match(fuentes.selectorVencidos, /retardo_senal_vencido/);
  assert.match(fuentes.proyector, /OBSERVACION_DIFERIDA/);
  assert.match(fuentes.despachador, /sin_estados_actualizados/);
  assert.doesNotMatch(
    fuentes.ejecutor,
    /observaciones_telemetria_agentes/,
    'El monitor debe leer la fotografía vigente y no reprocesar histórico.'
  );
}

function verificarCicloOperativoComun(fuentes) {
  assert.match(fuentes.runtime, /aplicarCicloOperativoMonitores/);
  assert.match(fuentes.gestorAlertas, /aperturasAlerta/);
  assert.match(fuentes.gestorAlertas, /cierresAlerta/);
  assert.match(fuentes.gestorHistorico, /aplicarResultados/);
  assert.match(fuentes.motorTriggers, /resolverDisparosDesdeTransiciones/);
  assert.doesNotMatch(
    fuentes.ejecutor,
    /RepositorioAlertas|GestorAlertas|MotorTriggers|GestorHistorico/,
    'El ejecutor de telemetría no debe crear un ciclo operativo paralelo.'
  );
  assert.match(fuentes.aplicadorEstado, /cambioSalidaEstable/);
}

function verificarComposicionLogicaGenerica(fuentes) {
  assert.doesNotMatch(
    fuentes.ejecutorLogico,
    /tipo\s*===?\s*['"]telemetria['"]/,
    'El monitor lógico debe consumir la salida común, no conocer telemetría.'
  );
  assert.match(fuentes.runtime, /extraerMonitoresConCambioSalidaEstable/);
  assert.doesNotMatch(fuentes.runtime, /propagarCandidatoTelemetria/);
  assert.match(fuentes.servicio, /validarCiclosDependenciasMonitorLogico/);
}

function verificarPermisosYScope(fuentes) {
  for (const ruta of [
    '/monitores/telemetria/api/fuentes',
    '/monitores/crear',
    '/monitores/:id/actualizar'
  ]) {
    const inicio = fuentes.rutas.indexOf(`'${ruta}'`);
    assert.notEqual(inicio, -1, `No se encontró la ruta protegida ${ruta}.`);
    const segmento = fuentes.rutas.slice(inicio, inicio + 350);
    assert.match(segmento, /requerirAutenticacion/);
    assert.match(segmento, /cargarContextoUsuario/);
    assert.match(segmento, /requerirEditar/);
  }
  for (const fragmento of [
    'buscarAgenteTelemetriaVisible',
    'puedeAlcanzarMonitor',
    'tenant_id: seleccionTelemetria.agente.tenantId',
    'empresa_id: seleccionTelemetria.agente.empresaId',
    'sitio_id: seleccionTelemetria.agente.sitioId',
    'La señal seleccionada no pertenece al agente indicado.',
    'La regla seleccionada no pertenece al agente indicado.'
  ]) {
    assert.ok(
      fuentes.servicio.includes(fragmento),
      `La administración debe conservar la barandilla: ${fragmento}`
    );
  }
}

function verificarCascadaCompleta(fuentes) {
  assert.match(
    fuentes.migracionCascada,
    /BEFORE DELETE ON agentes_sentinelia/
  );
  assert.match(
    fuentes.migracionCascada,
    /INNER JOIN vinculos_monitores_telemetria/
  );
  assert.match(fuentes.migracionCascada, /vinculo\.agente_id = OLD\.id/);
  assert.match(fuentes.migracionCascada, /monitor\.tipo = 'telemetria'/);

  for (const [nombre, migracion] of Object.entries({
    monitores: fuentes.migracionMonitores,
    agentes: fuentes.migracionAgentes,
    senales: fuentes.migracionSenales,
    observaciones: fuentes.migracionObservaciones,
    fotografia: fuentes.migracionFotografia,
    reglas: fuentes.migracionReglas,
    evaluaciones: fuentes.migracionEvaluaciones,
    outbox: fuentes.migracionOutbox,
    vinculos: fuentes.migracionVinculos,
    estadoMonitor: fuentes.migracionEstadoMonitores,
    eventos: fuentes.migracionEventos,
    alertas: fuentes.migracionAlertas,
    historico: fuentes.migracionHistorico,
    asignaciones: fuentes.migracionAsignaciones
  })) {
    assert.match(
      migracion,
      /ON DELETE (?:CASCADE|SET NULL)/,
      `La rama subordinada ${nombre} debe declarar su política de borrado.`
    );
  }

  for (const migracion of [
    fuentes.migracionEstadoMonitores,
    fuentes.migracionEventos,
    fuentes.migracionAlertas,
    fuentes.migracionHistorico,
    fuentes.migracionAsignaciones,
    fuentes.migracionVinculos
  ]) {
    assert.match(migracion, /REFERENCES monitores/);
    assert.match(migracion, /ON DELETE CASCADE/);
  }
}

async function ejecutarRegresionAcumulada() {
  for (const archivo of verificadoresPrevios) {
    try {
      await ejecutarArchivo(
        process.execPath,
        [fileURLToPath(new URL(archivo, import.meta.url))],
        {
          cwd: raizProyecto,
          maxBuffer: 4 * 1024 * 1024,
          timeout: 30_000
        }
      );
    } catch (error) {
      const detalle = [error?.stdout, error?.stderr].filter(Boolean).join('\n');
      throw new Error(
        `Falló la regresión acumulada ${archivo}.${detalle ? `\n${detalle}` : ''}`,
        { cause: error }
      );
    }
  }
}

function configuracionRango({ minimo = null, maximo = null }) {
  return {
    version: 1,
    retardoFalloSegundos: 0,
    condicion: {
      tipo: 'rango_numerico',
      tipoDato: 'numero',
      version: 1,
      minimo,
      maximo
    }
  };
}

function configuracionEsperada(tipoDato, valorEsperado, operador = 'igual') {
  return {
    version: 1,
    retardoFalloSegundos: 0,
    condicion: {
      tipo: 'valor_esperado',
      tipoDato,
      version: 1,
      operador,
      valorEsperado
    }
  };
}

function crearSenal(tipoDato, unidad = null) {
  return { id: 47, agenteId: 31, tipoDato, unidad };
}

function crearLectura(tipoDato, valor, unidad = null) {
  return {
    agenteId: 31,
    senalId: 47,
    ultimaObservacionId: 9001,
    tipoDato,
    unidad,
    valorNumero: tipoDato === 'numero' ? valor : null,
    valorBooleano: tipoDato === 'booleano' ? valor : null,
    valorEstado: tipoDato === 'estado' ? valor : null,
    valorTexto: tipoDato === 'texto' ? valor : null,
    valorJson: tipoDato === 'json' ? valor : null,
    calidad: 'valida',
    severidadDeclarada: 'info',
    observadoEnUtc: '2026-07-20T12:00:00.000Z',
    recibidoEnUtc: '2026-07-20T12:00:01.000Z'
  };
}

function combinar(...fuentes) {
  return fuentes.join('\n');
}

main().catch((error) => {
  console.error('[monitores-telemetria] Error en el cierre estructural 5.20b.10');
  console.error(error);
  process.exit(1);
});
