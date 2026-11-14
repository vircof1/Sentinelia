import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  ReglaDerivacionTelemetria,
  RevisionReglaDerivacionTelemetria
} from '../paquetes/agentes/src/EventosDerivadosTelemetriaAgentes.js';
import {
  EvaluadorCondicionesDerivacionTelemetria,
  crearCondicionTipadaDerivacionTelemetria
} from '../paquetes/agentes/src/EvaluadorCondicionesDerivacionTelemetria.js';
import {
  RepositorioEstadoActualEvaluacionReglasTelemetria,
  RepositorioEventosDerivadosTelemetria
} from '../paquetes/agentes/src/RepositorioEvaluacionesDerivadasTelemetria.js';

const rutaMigracion = new URL(
  '../migraciones/sql/0001_esquema_inicial.sql',
  import.meta.url
);
const rutaRepositorio = new URL(
  '../paquetes/agentes/src/RepositorioEvaluacionesDerivadasTelemetria.js',
  import.meta.url
);

async function main() {
  await verificarEstructuraPersistente();
  await verificarProyeccionActualOrdenada();
  await verificarEventosAppendOnlyEIdempotentes();

  console.log(
    '[agentes-telemetria] OK estado actual y eventos derivados verificados hasta 5.20a.5'
  );
}

async function verificarEstructuraPersistente() {
  const [migracion, repositorio] = await Promise.all([
    readFile(rutaMigracion, 'utf8').then(normalizarSqlConsolidado),
    readFile(rutaRepositorio, 'utf8')
  ]);
  for (const fragmento of [
    'CREATE TABLE IF NOT EXISTS estado_actual_evaluacion_reglas_telemetria',
    'CREATE TABLE IF NOT EXISTS eventos_derivados_telemetria',
    'UNIQUE KEY uk_estado_evaluacion_regla (regla_id)',
    'UNIQUE KEY uk_eventos_derivados_evaluacion',
    'FOREIGN KEY (regla_id, regla_revision_id)',
    'FOREIGN KEY (observacion_id, agente_id, senal_id)',
    'resultado ENUM(\'coincide\')',
    'ON DELETE CASCADE'
  ]) {
    assert.ok(migracion.includes(fragmento), `La migración debe contener: ${fragmento}`);
  }
  assert.ok(
    repositorio.includes('FROM estado_actual_telemetria_agentes fuente'),
    'El estado evaluado debe comprobar la fotografía cruda vigente.'
  );
  assert.ok(repositorio.includes('fuente.ultima_observacion_id = ?'));
  assert.ok(repositorio.includes(
    'VALUES(observado_en_utc) > ${tablaDestino}.observado_en_utc'
  ));
  assert.ok(repositorio.includes(
    'VALUES(observacion_id) > ${tablaDestino}.observacion_id'
  ));
  assert.ok(repositorio.includes(
    'ELSE ${tablaDestino}.${columna} END'
  ));
  assert.equal(
    /UPDATE\s+eventos_derivados_telemetria/i.test(repositorio),
    false,
    'Los eventos derivados deben permanecer append-only.'
  );
  assert.equal(
    /periodos_vida_pol|ultimo_heartbeat|UPDATE\s+observaciones_telemetria/i.test(
      repositorio
    ),
    false,
    'Persistir evaluaciones no debe modificar POL ni telemetría cruda.'
  );
}

async function verificarProyeccionActualOrdenada() {
  const cliente = new ClienteSqlEvaluacionesFalso();
  const estados = new RepositorioEstadoActualEvaluacionReglasTelemetria(cliente);
  const eventos = new RepositorioEventosDerivadosTelemetria(cliente);

  cliente.fijarFotografiaCruda({
    observacionId: 501,
    observadoEnUtc: '2026-07-20T10:04:58Z'
  });
  const primera = crearResultado({
    observacionId: 501,
    valor: 85,
    observadoEnUtc: '2026-07-20T10:04:58Z',
    umbral: 80
  });
  const aplicada = await estados.aplicarResultado(primera);
  assert.equal(aplicada.actualizado, true);
  assert.equal(aplicada.gobiernaEstadoActual, true);
  assert.equal(aplicada.estado.resultado, 'coincide');
  assert.equal(aplicada.estado.observacionId, 501);
  assert.equal(aplicada.estado.severidadCalculada, 'advertencia');

  cliente.fijarFotografiaCruda({
    observacionId: 502,
    observadoEnUtc: '2026-07-20T10:05:58Z'
  });
  const posterior = crearResultado({
    observacionId: 502,
    revisionId: 102,
    valor: 85,
    observadoEnUtc: '2026-07-20T10:05:58Z',
    umbral: 100
  });
  const actualizada = await estados.aplicarResultado(posterior);
  assert.equal(actualizada.actualizado, true);
  assert.equal(actualizada.estado.observacionId, 502);
  assert.equal(actualizada.estado.resultado, 'no_coincide');
  assert.equal(actualizada.estado.severidadCalculada, null);

  cliente.fijarFotografiaCruda({
    observacionId: 503,
    observadoEnUtc: '2026-07-20T10:05:58Z'
  });
  const mismoInstantePosterior = crearResultado({
    observacionId: 503,
    revisionId: 102,
    valor: 105,
    observadoEnUtc: '2026-07-20T10:05:58Z',
    umbral: 100
  });
  const desempate = await estados.aplicarResultado(mismoInstantePosterior);
  assert.equal(desempate.actualizado, true);
  assert.equal(desempate.estado.observacionId, 503);
  assert.equal(desempate.estado.resultado, 'coincide');

  const diferida = await estados.aplicarResultado(primera);
  assert.equal(diferida.actualizado, false);
  assert.equal(diferida.gobiernaEstadoActual, false);
  assert.equal(diferida.estado.observacionId, 503);

  const eventoHistorico = await eventos.insertarSiCoincide(primera);
  assert.equal(eventoHistorico.creado, true);
  assert.equal(eventoHistorico.evento.observacionId, 501);
  assert.equal((await estados.buscarPorRegla(31)).observacionId, 503);

  const repetida = await estados.aplicarResultado(mismoInstantePosterior);
  assert.equal(repetida.actualizado, false);
  assert.equal(repetida.gobiernaEstadoActual, true);
  assert.equal(cliente.estados.size, 1);
}

async function verificarEventosAppendOnlyEIdempotentes() {
  const cliente = new ClienteSqlEvaluacionesFalso();
  const eventos = new RepositorioEventosDerivadosTelemetria(cliente);
  const coincidente = crearResultado({
    observacionId: 501,
    valor: 85,
    observadoEnUtc: '2026-07-20T10:04:58Z',
    umbral: 80
  });

  const creado = await eventos.insertarSiCoincide(coincidente);
  assert.equal(creado.creado, true);
  assert.equal(creado.motivo, 'evento_creado');
  assert.equal(creado.evento.observacionId, 501);
  assert.equal(creado.evento.condicionCanonica, coincidente.condicionCanonica);
  assert.equal(creado.evento.valorEvaluado, 85);
  assert.equal(creado.evento.severidadCalculada, 'advertencia');

  const duplicado = await eventos.insertarSiCoincide(coincidente);
  assert.equal(duplicado.creado, false);
  assert.equal(duplicado.motivo, 'evento_ya_existente');
  assert.equal(duplicado.evento.id, creado.evento.id);
  assert.equal(cliente.eventos.size, 1);

  const segundo = crearResultado({
    observacionId: 503,
    valor: 90,
    observadoEnUtc: '2026-07-20T10:06:58Z',
    umbral: 80
  });
  const creadoSegundo = await eventos.insertarSiCoincide(segundo);
  assert.equal(creadoSegundo.creado, true);
  assert.equal(cliente.eventos.size, 2);

  const noCoincidente = crearResultado({
    observacionId: 504,
    valor: 70,
    observadoEnUtc: '2026-07-20T10:07:58Z',
    umbral: 80
  });
  const ignorado = await eventos.insertarSiCoincide(noCoincidente);
  assert.deepEqual(ignorado, {
    creado: false,
    motivo: 'resultado_no_coincidente',
    evento: null
  });
  assert.equal(cliente.eventos.size, 2);

  const listado = await eventos.listarPorRegla(31);
  assert.deepEqual(listado.map((evento) => evento.observacionId), [503, 501]);
}

function crearResultado({
  observacionId,
  revisionId = 101,
  valor,
  observadoEnUtc,
  umbral
}) {
  const senal = { id: 23, agenteId: 7, tipoDato: 'numero', unidad: 'ºC' };
  const regla = new ReglaDerivacionTelemetria({
    id: 31,
    agente: { id: 7, tenantId: 1, empresaId: 2, sitioId: 3 },
    senal: { id: 23, agenteId: 7 },
    scope: { tenantId: 1, empresaId: 2, sitioId: 3 },
    revisionVigenteId: revisionId
  });
  const condicion = crearCondicionTipadaDerivacionTelemetria({
    senal,
    tipo: 'numero',
    operador: '>',
    umbral
  });
  const revision = new RevisionReglaDerivacionTelemetria({
    id: revisionId,
    reglaId: 31,
    numero: revisionId === 101 ? 1 : 2,
    condicion,
    severidadCalculada: 'advertencia',
    mensajeOperativo: 'Temperatura fuera del rango configurado.',
    nombre: 'Temperatura elevada',
    vigenteDesdeUtc: '2026-07-20T10:00:00Z'
  });
  return new EvaluadorCondicionesDerivacionTelemetria().evaluar({
    regla,
    revision,
    senal,
    observacion: {
      id: observacionId,
      agenteId: 7,
      senalId: 23,
      valor,
      tipoDato: 'numero',
      unidad: 'ºC',
      calidad: 'valida',
      observadoEnUtc,
      recibidoEnUtc: '2026-07-20T10:10:00Z'
    },
    evaluadoEnUtc: '2026-07-20T10:10:01Z'
  });
}

class ClienteSqlEvaluacionesFalso {
  constructor() {
    this.fotografiaCruda = null;
    this.estados = new Map();
    this.eventos = new Map();
    this.siguienteEstadoId = 1;
    this.siguienteEventoId = 1;
  }

  fijarFotografiaCruda({ observacionId, observadoEnUtc }) {
    this.fotografiaCruda = {
      agenteId: 7,
      senalId: 23,
      observacionId,
      observadoEnUtc: new Date(observadoEnUtc)
    };
  }

  async ejecutar(sql, parametros = []) {
    const sentencia = normalizarSql(sql);
    if (sentencia.startsWith('INSERT INTO estado_actual_evaluacion_reglas_telemetria')) {
      return [this.aplicarEstado(parametros)];
    }
    if (sentencia.startsWith('INSERT INTO eventos_derivados_telemetria')) {
      return [this.insertarEvento(parametros)];
    }
    throw new Error(`Ejecución falsa no contemplada: ${sentencia}`);
  }

  async consultar(sql, parametros = []) {
    const sentencia = normalizarSql(sql);
    if (sentencia.includes('FROM estado_actual_evaluacion_reglas_telemetria e')) {
      const estado = this.estados.get(Number(parametros[0]));
      return estado ? [estado] : [];
    }
    if (sentencia.includes('FROM eventos_derivados_telemetria e')) {
      if (sentencia.includes('e.regla_revision_id = ?')) {
        const clave = construirClaveEvento(...parametros.map(Number));
        const evento = this.eventos.get(clave);
        return evento ? [evento] : [];
      }
      return [...this.eventos.values()]
        .filter((evento) => evento.regla_id === Number(parametros[0]))
        .sort((a, b) =>
          b.observado_en_utc - a.observado_en_utc ||
          b.observacion_id - a.observacion_id ||
          b.id - a.id
        )
        .slice(0, Number(parametros[1]));
    }
    throw new Error(`Consulta falsa no contemplada: ${sentencia}`);
  }

  aplicarEstado(parametros) {
    const candidato = construirFilaEvaluacion(parametros, this.siguienteEstadoId);
    const fotografia = this.fotografiaCruda;
    const coincideFotografia = fotografia &&
      fotografia.agenteId === candidato.agente_id &&
      fotografia.senalId === candidato.senal_id &&
      fotografia.observacionId === candidato.observacion_id &&
      fotografia.observadoEnUtc.getTime() === candidato.observado_en_utc.getTime();
    if (!coincideFotografia) {
      return { affectedRows: 0 };
    }

    const actual = this.estados.get(candidato.regla_id);
    if (!actual) {
      this.siguienteEstadoId += 1;
      this.estados.set(candidato.regla_id, candidato);
      return { affectedRows: 1, insertId: candidato.id };
    }
    const esPosterior = candidato.observado_en_utc > actual.observado_en_utc ||
      (
        candidato.observado_en_utc.getTime() === actual.observado_en_utc.getTime() &&
        candidato.observacion_id > actual.observacion_id
      );
    if (!esPosterior) {
      return { affectedRows: 0 };
    }
    this.estados.set(candidato.regla_id, {
      ...candidato,
      id: actual.id,
      fecha_creacion: actual.fecha_creacion
    });
    return { affectedRows: 2 };
  }

  insertarEvento(parametros) {
    const candidato = construirFilaEvaluacion(parametros, this.siguienteEventoId);
    const clave = construirClaveEvento(
      candidato.regla_id,
      candidato.regla_revision_id,
      candidato.observacion_id
    );
    if (this.eventos.has(clave)) {
      const error = new Error('Duplicate entry');
      error.code = 'ER_DUP_ENTRY';
      error.errno = 1062;
      throw error;
    }
    this.siguienteEventoId += 1;
    this.eventos.set(clave, {
      ...candidato,
      creado_en_utc: new Date('2026-07-20T10:10:02Z')
    });
    return { affectedRows: 1, insertId: candidato.id };
  }
}

function construirFilaEvaluacion(parametros, id) {
  return {
    id,
    regla_id: parametros[0],
    regla_revision_id: parametros[1],
    observacion_id: parametros[2],
    agente_id: parametros[3],
    senal_id: parametros[4],
    tenant_id: parametros[5],
    empresa_id: parametros[6],
    sitio_id: parametros[7],
    resultado: parametros[8],
    codigo_motivo: parametros[9],
    explicacion: parametros[10],
    condicion_canonica: parametros[11],
    valor_evaluado: parametros[12],
    tipo_dato: parametros[13],
    unidad: parametros[14],
    calidad: parametros[15],
    severidad_calculada: parametros[16],
    mensaje_operativo: parametros[17],
    evidencia_contextual: parametros[18],
    observado_en_utc: parametros[19],
    recibido_en_utc: parametros[20],
    evaluado_en_utc: parametros[21],
    fecha_creacion: new Date('2026-07-20T10:10:02Z'),
    fecha_actualizacion: new Date('2026-07-20T10:10:02Z')
  };
}

function construirClaveEvento(reglaId, revisionId, observacionId) {
  return `${reglaId}:${revisionId}:${observacionId}`;
}

function normalizarSql(sql) {
  return String(sql).replace(/\s+/g, ' ').trim();
}

main().catch((error) => {
  console.error('[agentes-telemetria] Error verificando persistencia 5.20a.5');
  console.error(error);
  process.exit(1);
});

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
    );
}
