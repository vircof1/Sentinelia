import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const ejecutarArchivo = promisify(execFile);
const raizProyecto = fileURLToPath(new URL('../', import.meta.url));
const verificadoresPrevios = [
  'agentes-verificar-eventos-derivados-dominio.js',
  'agentes-verificar-eventos-derivados-condiciones.js',
  'agentes-verificar-eventos-derivados-persistencia-reglas.js',
  'agentes-verificar-eventos-derivados-persistencia-resultados.js',
  'agentes-verificar-eventos-derivados-outbox.js',
  'agentes-verificar-eventos-derivados-runtime.js',
  'agentes-verificar-eventos-derivados-proyeccion.js',
  'agentes-verificar-eventos-derivados-administracion.js',
  'agentes-verificar-eventos-derivados-ui.js'
];

async function main() {
  const fuentes = await cargarFuentesAuditadas();

  verificarTelemetriaCrudaInmutable(fuentes);
  verificarPolAislado(fuentes);
  verificarEventosSeparadosDeAlertas(fuentes);
  verificarIdentidadExplicitaDeEventos(fuentes);
  verificarInmutabilidadYConcurrenciaDeRevisiones(fuentes);
  verificarResolucionTemporalPorRecepcion(fuentes);
  verificarCondicionesEstrictamenteTipadas(fuentes);
  verificarEstadoTernarioYOrdenTemporal(fuentes);
  verificarOutboxErroresEIdempotencia(fuentes);
  verificarAdministracionSinReprocesado(fuentes);
  verificarScopeYAusenciaDeTriggers(fuentes);
  await ejecutarRegresionAcumulada();

  console.log(
    '[gate:eventos-derivados] OK: dominio, persistencia, runtime, proyección, administración y UI verificados.'
  );
}

async function cargarFuentesAuditadas() {
  const rutas = {
    dominio: 'paquetes/agentes/src/EventosDerivadosTelemetriaAgentes.js',
    evaluador: 'paquetes/agentes/src/EvaluadorCondicionesDerivacionTelemetria.js',
    reglas: 'paquetes/agentes/src/RepositorioReglasDerivacionTelemetria.js',
    evaluaciones: 'paquetes/agentes/src/RepositorioEvaluacionesDerivadasTelemetria.js',
    trabajos: 'paquetes/agentes/src/RepositorioTrabajosEvaluacionTelemetria.js',
    ingesta: 'paquetes/agentes/src/ServicioIngestaTelemetriaAgentes.js',
    procesador: 'paquetes/agentes/src/ProcesadorTrabajosEvaluacionTelemetria.js',
    proyector: 'paquetes/agentes/src/ProyectorEvaluacionesDerivadasTelemetria.js',
    administracion:
      'paquetes/agentes/src/ServicioAdministracionReglasDerivacionTelemetria.js',
    permisos: 'paquetes/agentes/src/PoliticaPermisosAgentes.js',
    controlador:
      'apps/sentinelia-web/src/controladores/ControladorReglasDerivacionTelemetria.js',
    vistaReglas:
      'apps/sentinelia-web/src/views/portal/agente-reglas.ejs',
    despachador:
      'apps/sentinelia-runtime/src/telemetria/DespachadorEvaluacionesTelemetriaRuntime.js',
    bootstrapRuntime: 'apps/sentinelia-runtime/src/BootstrapRuntime.js',
    migracionReglas: 'migraciones/sql/0001_esquema_inicial.sql',
    migracionEvaluaciones: 'migraciones/sql/0001_esquema_inicial.sql',
    migracionOutbox: 'migraciones/sql/0001_esquema_inicial.sql'
  };
  const entradas = await Promise.all(
    Object.entries(rutas).map(async ([nombre, ruta]) => [
      nombre,
      await readFile(new URL(`../${ruta}`, import.meta.url), 'utf8')
    ])
  );
  return Object.fromEntries(entradas.map(([nombre, contenido]) => [
    nombre,
    nombre.startsWith('migracion') ? normalizarSqlConsolidado(contenido) : contenido
  ]));
}

function verificarTelemetriaCrudaInmutable(fuentes) {
  const circuitoDerivado = combinar(
    fuentes.evaluaciones,
    fuentes.trabajos,
    fuentes.procesador,
    fuentes.proyector,
    fuentes.administracion,
    fuentes.controlador,
    fuentes.despachador
  );
  assert.doesNotMatch(
    circuitoDerivado,
    /(?:UPDATE|DELETE\s+FROM|REPLACE\s+INTO)\s+observaciones_telemetria_agentes/i,
    'El circuito derivado no puede reescribir ni borrar observaciones crudas.'
  );
  assert.doesNotMatch(
    circuitoDerivado,
    /(?:UPDATE|DELETE\s+FROM|REPLACE\s+INTO)\s+estado_actual_telemetria_agentes/i,
    'El circuito derivado no puede reescribir la fotografía cruda.'
  );
  assert.match(
    fuentes.evaluaciones,
    /FROM estado_actual_telemetria_agentes fuente/,
    'La fotografía cruda solo debe consultarse para gobernar la proyección.'
  );
}

function verificarPolAislado(fuentes) {
  const circuitoDerivado = combinarFuentesDerivadas(fuentes);
  assert.doesNotMatch(
    circuitoDerivado,
    /periodos_vida_pol|ultimo_heartbeat|cerrarPeriodoVidaPol|registrarLatido/i,
    'Evaluar telemetría no puede alterar la prueba de vida POL.'
  );
}

function verificarEventosSeparadosDeAlertas(fuentes) {
  const circuitoDerivado = combinarFuentesDerivadas(fuentes);
  assert.doesNotMatch(
    circuitoDerivado,
    /alertas_activas_monitores|RepositorioAlertasActivas|ServicioEventosMonitores/i,
    'Los eventos derivados no pueden persistirse como alertas o eventos de monitor.'
  );
  assert.match(
    fuentes.migracionEvaluaciones,
    /CREATE TABLE IF NOT EXISTS eventos_derivados_telemetria/,
    'Los eventos derivados deben conservar almacenamiento propio.'
  );
  assert.doesNotMatch(
    extraerTablaEventos(fuentes.migracionEvaluaciones),
    /alerta|monitor_id/i,
    'La tabla de eventos derivados no debe asumir identidad de alerta o monitor.'
  );
}

function verificarIdentidadExplicitaDeEventos(fuentes) {
  const tablaEventos = extraerTablaEventos(fuentes.migracionEvaluaciones);
  for (const fragmento of [
    'regla_id BIGINT UNSIGNED NOT NULL',
    'regla_revision_id BIGINT UNSIGNED NOT NULL',
    'observacion_id BIGINT UNSIGNED NOT NULL',
    'FOREIGN KEY (regla_id, regla_revision_id)',
    'FOREIGN KEY (observacion_id, agente_id, senal_id)'
  ]) {
    assert.ok(
      tablaEventos.includes(fragmento),
      `La identidad del evento debe contener: ${fragmento}`
    );
  }
  assert.match(
    fuentes.proyector,
    /asegurarIdentidadEvaluacion\(resultado, respuesta\.evento, 'evento derivado'\)/,
    'La proyección debe verificar la identidad devuelta por el evento.'
  );
}

function verificarInmutabilidadYConcurrenciaDeRevisiones(fuentes) {
  const actualizaciones =
    fuentes.reglas.match(/UPDATE\s+revisiones_reglas_derivacion_telemetria/gi) || [];
  assert.equal(
    actualizaciones.length,
    1,
    'La única actualización permitida sobre una revisión debe cerrar su vigencia.'
  );
  assert.match(fuentes.reglas, /SET vigente_hasta_utc = \?/);
  assert.doesNotMatch(
    fuentes.reglas,
    /UPDATE\s+revisiones_reglas_derivacion_telemetria[\s\S]{0,180}SET\s+(?:condicion|severidad|mensaje|nombre|descripcion|metadatos)/i,
    'La configuración de una revisión anterior debe permanecer inmutable.'
  );
  for (const fragmento of [
    'UNIQUE KEY uk_revisiones_derivacion_regla_numero (regla_id, numero)',
    'UNIQUE KEY uk_revisiones_derivacion_una_abierta (regla_abierta_id)',
    'AND rv.vigente_hasta_utc IS NULL',
    'FOR UPDATE',
    'La revisión vigente cambió durante la edición de la regla.'
  ]) {
    assert.ok(
      combinar(fuentes.migracionReglas, fuentes.reglas).includes(fragmento),
      `El versionado concurrente debe conservar: ${fragmento}`
    );
  }
}

function verificarResolucionTemporalPorRecepcion(fuentes) {
  for (const fragmento of [
    'rv.vigente_desde_utc <= ?',
    'OR ? < rv.vigente_hasta_utc',
    'recibidoEnUtc: observacion.recibidoEnUtc',
    'revision: aplicable.revisionAplicable'
  ]) {
    assert.ok(
      combinar(fuentes.reglas, fuentes.ingesta).includes(fragmento),
      `La revisión aplicable debe resolverse por recepción: ${fragmento}`
    );
  }
  assert.match(
    fuentes.procesador,
    /buscarRevisionPorId\(trabajo\.reglaRevisionId\)/,
    'El Runtime debe recuperar la revisión ya fijada por la outbox.'
  );
  assert.doesNotMatch(
    fuentes.procesador,
    /revisionVigente(?!Id)/,
    'El Runtime no debe sustituir la revisión fijada por la revisión vigente actual.'
  );
}

function verificarCondicionesEstrictamenteTipadas(fuentes) {
  for (const fragmento of [
    "typeof valor === 'number' && Number.isFinite(valor)",
    "typeof valor === 'boolean'",
    "typeof valor === 'string'",
    'valor === esperado',
    'valor !== esperado',
    'No se admiten condiciones directas sobre señales JSON.',
    'debe coincidir exactamente con el tipo catalogado'
  ]) {
    assert.ok(
      fuentes.evaluador.includes(fragmento),
      `El evaluador estricto debe conservar: ${fragmento}`
    );
  }
  assert.doesNotMatch(
    fuentes.evaluador,
    /parseFloat|parseInt|Boolean\(|String\(valor\)|Number\(valor\)/,
    'El evaluador no puede coaccionar el valor observado.'
  );
}

function verificarEstadoTernarioYOrdenTemporal(fuentes) {
  for (const resultado of ['COINCIDE', 'NO_COINCIDE', 'NO_EVALUABLE']) {
    assert.match(
      fuentes.dominio,
      new RegExp(`${resultado}:`),
      `Debe existir el resultado de evaluación ${resultado}.`
    );
  }
  assert.match(
    fuentes.migracionEvaluaciones,
    /resultado ENUM\('coincide', 'no_coincide', 'no_evaluable'\) NOT NULL/,
    'El estado actual debe persistir el resultado ternario completo.'
  );
  const evaluacionesSinCalificador = fuentes.evaluaciones.replaceAll(
    'estado_actual_evaluacion_reglas_telemetria.',
    ''
  ).replaceAll('${tablaDestino}.', '');
  for (const fragmento of [
    'VALUES(observado_en_utc) > observado_en_utc',
    'VALUES(observado_en_utc) = observado_en_utc',
    'VALUES(observacion_id) > observacion_id',
    'fuente.ultima_observacion_id = ?'
  ]) {
    assert.ok(
      evaluacionesSinCalificador.includes(fragmento),
      `El orden vigente debe conservar: ${fragmento}`
    );
  }
}

function verificarOutboxErroresEIdempotencia(fuentes) {
  for (const fragmento of [
    'CREATE TABLE IF NOT EXISTS trabajos_evaluacion_telemetria',
    'UNIQUE KEY uk_trabajos_evaluacion_huella_causal (huella_causal_sha256)',
    "estado ENUM('pendiente', 'procesando', 'completado', 'error', 'neutralizado')",
    'clave_causal_canonica',
    'ultimo_codigo_error',
    'ultimo_mensaje_error',
    'FOREIGN KEY (regla_id, regla_revision_id)'
  ]) {
    assert.ok(
      fuentes.migracionOutbox.includes(fragmento),
      `La outbox durable debe conservar: ${fragmento}`
    );
  }
  assert.match(fuentes.procesador, /return this\.registrarFallo/);
  assert.match(fuentes.procesador, /registrarErrorTecnico/);
  assert.match(fuentes.procesador, /await conexion\.rollback\(\)/);
  assert.match(fuentes.procesador, /await conexion\.commit\(\)/);
  assert.match(
    fuentes.migracionEvaluaciones,
    /UNIQUE KEY uk_eventos_derivados_evaluacion/
  );
  assert.match(fuentes.evaluaciones, /esErrorClaveDuplicada/);
  assert.match(fuentes.evaluaciones, /evento_ya_existente/);
  assert.doesNotMatch(
    fuentes.procesador,
    /insertarObservacion|guardarObservacion|ingestarLote/,
    'Un error o reintento del evaluador no debe volver a ejecutar la ingesta.'
  );
}

function verificarAdministracionSinReprocesado(fuentes) {
  const inicioReconciliacion = fuentes.administracion.indexOf(
    'async reconciliarAutoridadRelativa'
  );
  const finReconciliacion = fuentes.administracion.indexOf(
    '\n  capturarRegla',
    inicioReconciliacion
  );
  assert.ok(inicioReconciliacion > 0 && finReconciliacion > inicioReconciliacion);
  const reconciliacionRelativa = fuentes.administracion.slice(
    inicioReconciliacion,
    finReconciliacion
  );
  const administracionLegacy = fuentes.administracion.slice(0, inicioReconciliacion) +
    fuentes.administracion.slice(finReconciliacion);
  const edicionAdministrativa = combinar(
    administracionLegacy,
    fuentes.controlador
  );
  assert.match(edicionAdministrativa, /crearNuevaRevision/);
  assert.doesNotMatch(
    edicionAdministrativa,
    /encolar|reclamarSiguientes|procesarPendientes|listarObservaciones|buscarHistorico/i,
    'Editar una regla no puede encolar ni recorrer observaciones históricas.'
  );
  assert.match(reconciliacionRelativa, /TIPO_CONDICION_MOMENTO_UTC_RELATIVO/);
  assert.match(reconciliacionRelativa, /encolarAutoridadActualEnTransaccion/);
  assert.doesNotMatch(reconciliacionRelativa, /listarObservaciones|buscarHistorico/i);
  assert.match(
    fuentes.vistaReglas,
    /evaluará nuevas lecturas/,
    'La intención temporal de la edición debe quedar explícita en la UI.'
  );
}

function verificarScopeYAusenciaDeTriggers(fuentes) {
  for (const fragmento of [
    'assertPuedeVer',
    'assertPuedeModificar',
    'puedeAlcanzarAgente'
  ]) {
    assert.ok(
      combinar(fuentes.administracion, fuentes.permisos).includes(fragmento),
      `La lectura administrativa debe conservar el control de scope: ${fragmento}`
    );
  }
  const circuitoDerivado = combinarFuentesDerivadas(fuentes);
  assert.doesNotMatch(
    circuitoDerivado,
    /RepositorioTriggers|ServicioTriggers|MotorTriggersRuntime|EjecutorTrigger|dispararTrigger/i,
    'La fase 5.20a no puede disparar triggers.'
  );
  const cableadoDerivado = fuentes.bootstrapRuntime.slice(
    fuentes.bootstrapRuntime.indexOf(
      'const repositorioEstadoActualEvaluacionTelemetria'
    ),
    fuentes.bootstrapRuntime.indexOf('this.servicioMonitores =')
  );
  assert.doesNotMatch(
    cableadoDerivado,
    /repositorioAlertas|repositorioTriggers|servicioEventosMonitores/i,
    'El cableado del evaluador debe terminar antes del circuito de monitores.'
  );
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

function combinarFuentesDerivadas(fuentes) {
  return combinar(
    fuentes.dominio,
    fuentes.evaluador,
    fuentes.reglas,
    fuentes.evaluaciones,
    fuentes.trabajos,
    fuentes.procesador,
    fuentes.proyector,
    fuentes.administracion,
    fuentes.controlador,
    fuentes.despachador
  );
}

function extraerTablaEventos(migracion) {
  const inicio = migracion.indexOf(
    'CREATE TABLE IF NOT EXISTS eventos_derivados_telemetria'
  );
  const fin = migracion.indexOf(';', migracion.indexOf('\n) ENGINE=', inicio));
  assert.notEqual(inicio, -1, 'No se encontró la tabla de eventos derivados.');
  assert.notEqual(fin, -1, 'No se encontró el final de la tabla de eventos derivados.');
  return migracion.slice(inicio, fin + 1);
}

function combinar(...fuentes) {
  return fuentes.join('\n');
}

function normalizarSqlConsolidado(contenido) {
  return contenido
    .replaceAll('`', '')
    .replace(/^CREATE TABLE /gm, 'CREATE TABLE IF NOT EXISTS ')
    .replace(/,(?!\s)/g, ', ')
    .replace(/\benum\(/g, 'ENUM(')
    .replace(/bigint\(20\) unsigned/g, 'BIGINT UNSIGNED')
    .replace(
      /ENUM\('coincide','no_coincide','no_evaluable'\)/g,
      "ENUM('coincide', 'no_coincide', 'no_evaluable')"
    )
    .replace(
      /ENUM\('pendiente','procesando','completado','error'\)/g,
      "ENUM('pendiente', 'procesando', 'completado', 'error')"
    );
}

main().catch((error) => {
  console.error('[agentes-telemetria] Error en el cierre estructural 5.20a.11');
  console.error(error);
  process.exit(1);
});
