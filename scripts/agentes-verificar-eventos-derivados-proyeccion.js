import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  ReglaDerivacionTelemetria,
  ResultadoEvaluacionRegla,
  RevisionReglaDerivacionTelemetria
} from '../paquetes/agentes/src/EventosDerivadosTelemetriaAgentes.js';
import {
  EstadoActualEvaluacionReglaPersistido
} from '../paquetes/agentes/src/RepositorioEvaluacionesDerivadasTelemetria.js';
import {
  MOTIVOS_PROYECCION_ESTADO_TELEMETRIA,
  ProyectorEvaluacionesDerivadasTelemetria,
  ResultadoProyeccionEvaluacionTelemetria
} from '../paquetes/agentes/src/ProyectorEvaluacionesDerivadasTelemetria.js';

const rutaMigracion = new URL(
  '../migraciones/sql/0001_esquema_inicial.sql',
  import.meta.url
);
const rutaRepositorio = new URL(
  '../paquetes/agentes/src/RepositorioEvaluacionesDerivadasTelemetria.js',
  import.meta.url
);
const rutaProcesador = new URL(
  '../paquetes/agentes/src/ProcesadorTrabajosEvaluacionTelemetria.js',
  import.meta.url
);

async function main() {
  await verificarBarrerasSqlYContratoRuntime();
  await verificarOrdenTemporalEIdempotencia();
  verificarContratoVigenteReutilizable();
  await verificarPrecondicionesDelProyector();

  console.log(
    '[agentes-telemetria] OK proyección vigente e idempotencia verificadas hasta 5.20a.8'
  );
}

async function verificarBarrerasSqlYContratoRuntime() {
  const [migracion, repositorio, procesador] = await Promise.all([
    readFile(rutaMigracion, 'utf8').then(normalizarSqlConsolidado),
    readFile(rutaRepositorio, 'utf8'),
    readFile(rutaProcesador, 'utf8')
  ]);

  assert.ok(migracion.includes('UNIQUE KEY uk_estado_evaluacion_regla (regla_id)'));
  assert.ok(migracion.includes('UNIQUE KEY uk_eventos_derivados_evaluacion'));
  assert.ok(migracion.includes('FOREIGN KEY (regla_id, regla_revision_id)'));
  assert.ok(migracion.includes('FOREIGN KEY (observacion_id, agente_id, senal_id)'));
  assert.ok(repositorio.includes('FROM estado_actual_telemetria_agentes fuente'));
  assert.ok(repositorio.includes('fuente.ultima_observacion_id = ?'));
  assert.ok(repositorio.includes('fuente.observado_en_utc = ?'));
  assert.ok(repositorio.includes(
    'VALUES(observado_en_utc) > ${tablaDestino}.observado_en_utc'
  ));
  assert.ok(repositorio.includes(
    'VALUES(observacion_id) > ${tablaDestino}.observacion_id'
  ));
  assert.ok(repositorio.includes(
    'ELSE ${tablaDestino}.${columna} END'
  ));
  assert.equal(/UPDATE\s+eventos_derivados_telemetria/i.test(repositorio), false);
  assert.ok(procesador.includes('proyectorEvaluaciones.proyectar('));
  assert.ok(
    procesador.indexOf('proyectorEvaluaciones.proyectar(') <
      procesador.indexOf('marcarCompletado(')
  );
}

async function verificarOrdenTemporalEIdempotencia() {
  const estado = new RepositorioEstadoMemoria();
  const eventos = new RepositorioEventosMemoria();
  const proyector = new ProyectorEvaluacionesDerivadasTelemetria({
    repositorioEstadoActual: estado,
    repositorioEventosDerivados: eventos
  });
  const conexion = { transaccion: 'evaluacion' };

  estado.fijarFotografia({
    observacionId: 501,
    observadoEnUtc: '2026-07-20T10:00:00.000Z'
  });
  const primera = crearResultado({
    observacionId: 501,
    observadoEnUtc: '2026-07-20T10:00:00.000Z',
    resultado: 'coincide'
  });
  const proyectada = await proyector.proyectar(primera, { conexion });

  assert.ok(proyectada instanceof ResultadoProyeccionEvaluacionTelemetria);
  assert.equal(proyectada.cambioEstadoActual(), true);
  assert.equal(proyectada.motivoEstadoActual, 'estado_actual_actualizado');
  assert.equal(proyectada.generoEvento(), true);
  assert.equal(proyectada.eventoDerivado.observacionId, 501);

  const reintento = await proyector.proyectar(primera, { conexion });
  assert.equal(reintento.cambioEstadoActual(), false);
  assert.equal(reintento.gobiernaEstadoActual, true);
  assert.equal(
    reintento.motivoEstadoActual,
    MOTIVOS_PROYECCION_ESTADO_TELEMETRIA.YA_VIGENTE
  );
  assert.equal(reintento.eventoCreado, false);
  assert.equal(reintento.motivoEvento, 'evento_ya_existente');
  assert.equal(reintento.eventoDerivado.id, proyectada.eventoDerivado.id);
  assert.equal(eventos.total(), 1, 'Reintentar no debe duplicar el evento.');

  estado.fijarFotografia({
    observacionId: 503,
    observadoEnUtc: '2026-07-20T10:02:00.000Z'
  });
  const diferidaCoincidente = crearResultado({
    observacionId: 502,
    observadoEnUtc: '2026-07-20T10:01:00.000Z',
    resultado: 'coincide'
  });
  const historica = await proyector.proyectar(diferidaCoincidente, { conexion });
  assert.equal(historica.estadoActualizado, false);
  assert.equal(historica.gobiernaEstadoActual, false);
  assert.equal(
    historica.motivoEstadoActual,
    MOTIVOS_PROYECCION_ESTADO_TELEMETRIA.OBSERVACION_DIFERIDA
  );
  assert.equal(historica.eventoCreado, true);
  assert.equal(estado.actual.observacionId, 501);

  const vigenteNormal = crearResultado({
    observacionId: 503,
    observadoEnUtc: '2026-07-20T10:02:00.000Z',
    resultado: 'no_coincide'
  });
  const normal = await proyector.proyectar(vigenteNormal, { conexion });
  assert.equal(normal.cambioEstadoActual(), true);
  assert.equal(normal.estadoActual.resultado, 'no_coincide');
  assert.equal(normal.eventoCreado, false);
  assert.equal(normal.motivoEvento, 'resultado_no_coincidente');

  estado.fijarFotografia({
    observacionId: 504,
    observadoEnUtc: '2026-07-20T10:02:00.000Z'
  });
  const mismoInstantePosterior = crearResultado({
    observacionId: 504,
    observadoEnUtc: '2026-07-20T10:02:00.000Z',
    resultado: 'no_evaluable'
  });
  const desempate = await proyector.proyectar(
    mismoInstantePosterior,
    { conexion }
  );
  assert.equal(desempate.cambioEstadoActual(), true);
  assert.equal(desempate.estadoActual.observacionId, 504);
  assert.equal(desempate.estadoActual.resultado, 'no_evaluable');
  assert.equal(desempate.eventoDerivado, null);

  const anteriorMismoInstante = await proyector.proyectar(
    vigenteNormal,
    { conexion }
  );
  assert.equal(anteriorMismoInstante.estadoActualizado, false);
  assert.equal(anteriorMismoInstante.gobiernaEstadoActual, false);
  assert.equal(estado.actual.observacionId, 504);
  assert.equal(eventos.total(), 2);

  const serializada = historica.serializar();
  serializada.eventoDerivado.valorEvaluado = 999;
  assert.notEqual(historica.eventoDerivado.valorEvaluado, 999);
  assert.ok(Object.isFrozen(historica));
  assert.ok(Object.isFrozen(historica.eventoDerivado));
}

function verificarContratoVigenteReutilizable() {
  const estado = new EstadoActualEvaluacionReglaPersistido({
    id: 1,
    regla_id: 31,
    regla_revision_id: 101,
    observacion_id: 504,
    agente_id: 7,
    senal_id: 23,
    tenant_id: 1,
    empresa_id: 2,
    sitio_id: 3,
    resultado: 'no_evaluable',
    codigo_motivo: 'calidad_no_evaluable',
    explicacion: 'La calidad no permite evaluar la condición.',
    condicion_canonica: JSON.stringify({ tipo: 'numero', version: 1 }),
    valor_evaluado: '85',
    tipo_dato: 'numero',
    unidad: 'ºC',
    calidad: 'invalida',
    severidad_calculada: null,
    mensaje_operativo: 'Temperatura elevada.',
    evidencia_contextual: null,
    observado_en_utc: new Date('2026-07-20T10:02:00.000Z'),
    recibido_en_utc: new Date('2026-07-20T10:02:01.000Z'),
    evaluado_en_utc: new Date('2026-07-20T10:02:02.000Z'),
    fecha_creacion: new Date('2026-07-20T10:02:02.000Z'),
    fecha_actualizacion: new Date('2026-07-20T10:02:02.000Z')
  });

  assert.ok(Object.isFrozen(estado));
  assert.equal(estado.coincide(), false);
  assert.equal(estado.noCoincide(), false);
  assert.equal(estado.esNoEvaluable(), true);
  assert.equal(estado.serializar().observacionId, 504);
}

async function verificarPrecondicionesDelProyector() {
  const resultado = crearResultado({
    observacionId: 501,
    observadoEnUtc: '2026-07-20T10:00:00.000Z',
    resultado: 'coincide'
  });
  const proyector = new ProyectorEvaluacionesDerivadasTelemetria({
    repositorioEstadoActual: new RepositorioEstadoMemoria(),
    repositorioEventosDerivados: new RepositorioEventosMemoria()
  });

  await assert.rejects(
    () => proyector.proyectar(resultado),
    /conexión transaccional/
  );
  await assert.rejects(
    () => proyector.proyectar({}, { conexion: {} }),
    /resultado de evaluación válido/
  );
}

function crearResultado({ observacionId, observadoEnUtc, resultado }) {
  const regla = new ReglaDerivacionTelemetria({
    id: 31,
    agente: { id: 7, tenantId: 1, empresaId: 2, sitioId: 3 },
    senal: { id: 23, agenteId: 7 },
    scope: { tenantId: 1, empresaId: 2, sitioId: 3 },
    revisionVigenteId: 101
  });
  const revision = new RevisionReglaDerivacionTelemetria({
    id: 101,
    reglaId: 31,
    numero: 1,
    condicion: {
      tipo: 'numero',
      version: 1,
      configuracion: { operador: '>', umbral: 80, unidad: 'ºC' }
    },
    severidadCalculada: 'advertencia',
    mensajeOperativo: 'Temperatura fuera del rango operativo.',
    nombre: 'Temperatura elevada',
    vigenteDesdeUtc: '2026-07-01T00:00:00.000Z'
  });
  return new ResultadoEvaluacionRegla({
    regla,
    revision,
    observacion: {
      id: observacionId,
      agenteId: 7,
      senalId: 23,
      valor: 85,
      tipoDato: 'numero',
      unidad: 'ºC',
      calidad: resultado === 'no_evaluable' ? 'invalida' : 'valida',
      observadoEnUtc,
      recibidoEnUtc: '2026-07-20T10:05:00.000Z'
    },
    resultado,
    codigoMotivo: resultado === 'coincide'
      ? 'condicion_cumplida'
      : resultado === 'no_coincide'
        ? 'condicion_no_cumplida'
        : 'calidad_no_evaluable',
    explicacion: `Resultado ${resultado}.`,
    evaluadoEnUtc: '2026-07-20T10:05:01.000Z'
  });
}

class RepositorioEstadoMemoria {
  constructor() {
    this.fotografia = null;
    this.actual = null;
  }

  fijarFotografia({ observacionId, observadoEnUtc }) {
    this.fotografia = { observacionId, observadoEnUtc };
  }

  async aplicarResultado(resultado, { conexion }) {
    assert.ok(conexion);
    const candidato = resultado.serializar();
    const gobiernaFotografia = this.fotografia &&
      this.fotografia.observacionId === candidato.observacionId &&
      Date.parse(this.fotografia.observadoEnUtc) ===
        Date.parse(candidato.observadoEnUtc);
    const esPosterior = !this.actual ||
      Date.parse(candidato.observadoEnUtc) >
        Date.parse(this.actual.observadoEnUtc) ||
      (
        Date.parse(candidato.observadoEnUtc) ===
          Date.parse(this.actual.observadoEnUtc) &&
        candidato.observacionId > this.actual.observacionId
      );
    const actualizado = Boolean(gobiernaFotografia && esPosterior);
    if (actualizado) {
      this.actual = { id: this.actual?.id || 1, ...candidato };
    }

    return {
      actualizado,
      gobiernaEstadoActual:
        this.actual?.observacionId === candidato.observacionId &&
        this.actual?.revisionId === candidato.revisionId,
      estado: this.actual
    };
  }
}

class RepositorioEventosMemoria {
  constructor() {
    this.eventos = new Map();
  }

  async insertarSiCoincide(resultado, { conexion }) {
    assert.ok(conexion);
    if (!resultado.coincide()) {
      return {
        creado: false,
        motivo: 'resultado_no_coincidente',
        evento: null
      };
    }

    const evaluacion = resultado.serializar();
    const clave = [
      evaluacion.reglaId,
      evaluacion.revisionId,
      evaluacion.observacionId
    ].join(':');
    const existente = this.eventos.get(clave);
    if (existente) {
      return {
        creado: false,
        motivo: 'evento_ya_existente',
        evento: existente
      };
    }

    const evento = { id: this.eventos.size + 1, ...evaluacion };
    this.eventos.set(clave, evento);
    return { creado: true, motivo: 'evento_creado', evento };
  }

  total() {
    return this.eventos.size;
  }
}

main().catch((error) => {
  console.error('[agentes-telemetria] Error verificando proyección 5.20a.8');
  console.error(error);
  process.exit(1);
});

function normalizarSqlConsolidado(contenido) {
  return contenido
    .replaceAll('`', '')
    .replace(/^CREATE TABLE /gm, 'CREATE TABLE IF NOT EXISTS ')
    .replace(/,(?!\s)/g, ', ')
    .replace(/\benum\(/g, 'ENUM(')
    .replace(/bigint\(20\) unsigned/g, 'BIGINT UNSIGNED');
}
