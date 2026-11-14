import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  CondicionDerivacionTelemetria,
  ESTADOS_REGLA_DERIVACION_TELEMETRIA,
  RESULTADOS_EVALUACION_REGLA_TELEMETRIA,
  ReglaDerivacionTelemetria,
  RevisionReglaDerivacionTelemetria,
  crearResultadoEvaluacionRegla
} from '../paquetes/agentes/src/EventosDerivadosTelemetriaAgentes.js';

const RUTA_DOMINIO = new URL(
  '../paquetes/agentes/src/EventosDerivadosTelemetriaAgentes.js',
  import.meta.url
);
const IMPORTS_INFRAESTRUCTURA_PROHIBIDOS = Object.freeze([
  'ClienteSql',
  'ServicioConexionRedis',
  'express',
  'mysql2',
  'redis'
]);

await verificarDominioPuro();
verificarReglaYObjetivoEstables();
verificarRevisionInmutableYVigencia();
verificarCondicionCanonica();
verificarResultadoTernario();
verificarInvariantesInvalidas();

console.log(
  '[agentes-telemetria] OK dominio puro de eventos derivados verificado hasta 5.20a.2'
);

async function verificarDominioPuro() {
  const fuente = await readFile(RUTA_DOMINIO, 'utf8');
  const imports = fuente
    .split(/\r?\n/)
    .filter((linea) => linea.trim().startsWith('import '))
    .join('\n');

  for (const importProhibido of IMPORTS_INFRAESTRUCTURA_PROHIBIDOS) {
    assert.equal(
      imports.includes(importProhibido),
      false,
      `El dominio de eventos derivados no debe importar ${importProhibido}.`
    );
  }
}

function verificarReglaYObjetivoEstables() {
  const regla = crearRegla();

  assert.deepEqual(regla.serializar(), {
    id: 31,
    agenteId: 7,
    senalId: 23,
    tenantId: 1,
    empresaId: 2,
    sitioId: 3,
    estado: 'activa',
    revisionVigenteId: 101,
    generacionAutoridad: 1
  });
  assert.equal(regla.estaActiva(), true);
  assert.equal(Object.isFrozen(regla), true);

  const deshabilitada = crearRegla({
    estado: ESTADOS_REGLA_DERIVACION_TELEMETRIA.DESHABILITADA,
    revisionVigenteId: null
  });
  assert.equal(deshabilitada.estaActiva(), false);
}

function verificarRevisionInmutableYVigencia() {
  const revision = crearRevision();
  const regla = crearRegla();

  assert.equal(regla.admiteRevision(revision), true);
  assert.equal(revision.estaAbierta(), false);
  assert.equal(revision.esAplicableEn('2026-07-20T09:59:59.999Z'), false);
  assert.equal(revision.esAplicableEn('2026-07-20T10:00:00Z'), true);
  assert.equal(revision.esAplicableEn('2026-07-21T09:59:59.999Z'), true);
  assert.equal(revision.esAplicableEn('2026-07-21T10:00:00Z'), false);
  assert.equal(Object.isFrozen(revision), true);
  assert.equal(Object.isFrozen(revision.condicion), true);
  assert.equal(Object.isFrozen(revision.condicion.configuracion), true);

  assert.throws(() => {
    revision.numero = 2;
  }, TypeError);
  assert.throws(() => {
    revision.condicion.configuracion.umbral = 95;
  }, TypeError);

  const abierta = crearRevision({
    id: 102,
    numero: 2,
    vigenteDesdeUtc: '2026-07-21T10:00:00Z',
    vigenteHastaUtc: null
  });
  assert.equal(abierta.estaAbierta(), true);
  assert.equal(abierta.esAplicableEn('2030-01-01T00:00:00Z'), true);
}

function verificarCondicionCanonica() {
  const configuracion = {
    unidad: 'ºC',
    umbral: 80,
    operador: '>'
  };
  const condicion = new CondicionDerivacionTelemetria({
    tipo: 'numero',
    configuracion
  });
  configuracion.umbral = 95;

  const equivalente = new CondicionDerivacionTelemetria({
    tipo: 'numero',
    version: 1,
    configuracion: {
      operador: '>',
      umbral: 80,
      unidad: 'ºC'
    }
  });

  assert.equal(condicion.configuracion.umbral, 80);
  assert.equal(condicion.obtenerCanonica(), equivalente.obtenerCanonica());
  assert.equal(
    condicion.obtenerCanonica(),
    '{"configuracion":{"operador":">","umbral":80,"unidad":"ºC"},"tipo":"numero","version":1}'
  );

  const serializada = condicion.serializar();
  serializada.configuracion.umbral = 120;
  assert.equal(condicion.configuracion.umbral, 80);
}

function verificarResultadoTernario() {
  const regla = crearRegla();
  const revision = crearRevision();
  const coincide = crearResultadoEvaluacionRegla({
    regla,
    revision,
    observacion: crearObservacion(),
    resultado: RESULTADOS_EVALUACION_REGLA_TELEMETRIA.COINCIDE,
    codigoMotivo: 'umbral_superado',
    explicacion: 'La temperatura supera el umbral configurado.',
    evaluadoEnUtc: '2026-07-20T10:05:01Z',
    evidenciaContextual: {
      origen: 'agente'
    }
  });

  assert.equal(coincide.coincide(), true);
  assert.equal(coincide.severidadCalculada, 'advertencia');
  assert.equal(coincide.mensajeOperativo, 'Temperatura fuera de tolerancia.');
  assert.deepEqual(
    {
      reglaId: coincide.reglaId,
      revisionId: coincide.revisionId,
      agenteId: coincide.agenteId,
      senalId: coincide.senalId,
      observacionId: coincide.observacionId
    },
    {
      reglaId: 31,
      revisionId: 101,
      agenteId: 7,
      senalId: 23,
      observacionId: 501
    }
  );
  assert.equal(Object.isFrozen(coincide), true);
  assert.equal(Object.isFrozen(coincide.evidenciaContextual), true);

  for (const resultado of [
    RESULTADOS_EVALUACION_REGLA_TELEMETRIA.NO_COINCIDE,
    RESULTADOS_EVALUACION_REGLA_TELEMETRIA.NO_EVALUABLE
  ]) {
    const evaluacion = crearResultadoEvaluacionRegla({
      regla,
      revision,
      observacion: crearObservacion(),
      resultado,
      codigoMotivo: resultado,
      explicacion: `Resultado ${resultado}.`,
      evaluadoEnUtc: '2026-07-20T10:05:01Z'
    });
    assert.equal(evaluacion.coincide(), false);
    assert.equal(evaluacion.severidadCalculada, null);
  }
}

function verificarInvariantesInvalidas() {
  assert.throws(
    () => crearRegla({ senal: { id: 23, agenteId: 8 } }),
    /no pertenece al agente/
  );
  assert.throws(
    () => crearRegla({ scope: { tenantId: 1, empresaId: 2, sitioId: 4 } }),
    /scope.*coincidir exactamente/i
  );
  assert.throws(
    () => crearRegla({ estado: 'borrada' }),
    /estado.*no es válido/i
  );
  assert.throws(
    () => crearRevision({ reglaId: 0 }),
    /regla.*obligatoria/i
  );
  assert.throws(
    () => crearRevision({ vigenteHastaUtc: '2026-07-20T10:00:00Z' }),
    /posterior/
  );
  assert.throws(
    () => crearRevision({ severidadCalculada: '' }),
    /severidad calculada.*obligatoria/i
  );
  assert.throws(
    () => new CondicionDerivacionTelemetria({ tipo: 'numero', configuracion: {} }),
    /configuración.*exactamente/i
  );
  assert.throws(
    () => new CondicionDerivacionTelemetria({
      tipo: 'numero',
      configuracion: { umbral: Number.NaN }
    }),
    /exactamente|número finito/
  );

  const regla = crearRegla();
  assert.throws(
    () => crearResultadoEvaluacionRegla({
      regla,
      revision: crearRevision({ reglaId: 99 }),
      observacion: crearObservacion(),
      resultado: 'coincide',
      codigoMotivo: 'coincide',
      explicacion: 'Coincide.',
      evaluadoEnUtc: '2026-07-20T10:05:01Z'
    }),
    /no pertenece a la regla/
  );
  assert.throws(
    () => crearResultadoEvaluacionRegla({
      regla,
      revision: crearRevision(),
      observacion: crearObservacion({ senalId: 24 }),
      resultado: 'coincide',
      codigoMotivo: 'coincide',
      explicacion: 'Coincide.',
      evaluadoEnUtc: '2026-07-20T10:05:01Z'
    }),
    /no pertenece al objetivo/
  );
  assert.throws(
    () => crearResultadoEvaluacionRegla({
      regla,
      revision: crearRevision(),
      observacion: crearObservacion({ recibidoEnUtc: '2026-07-21T10:00:00Z' }),
      resultado: 'coincide',
      codigoMotivo: 'coincide',
      explicacion: 'Coincide.',
      evaluadoEnUtc: '2026-07-21T10:00:01Z'
    }),
    /no estaba vigente/
  );
  assert.throws(
    () => crearResultadoEvaluacionRegla({
      regla,
      revision: crearRevision(),
      observacion: crearObservacion(),
      resultado: 'error_tecnico',
      codigoMotivo: 'error_tecnico',
      explicacion: 'No debe degradarse a resultado de dominio.',
      evaluadoEnUtc: '2026-07-20T10:05:01Z'
    }),
    /resultado.*no es válido/i
  );
  assert.throws(
    () => crearResultadoEvaluacionRegla({
      regla,
      revision: crearRevision(),
      observacion: crearObservacion(),
      resultado: 'coincide',
      codigoMotivo: 'coincide',
      explicacion: 'Coincide.',
      evaluadoEnUtc: '2026-07-20T10:04:59Z'
    }),
    /anterior a la recepción/
  );
}

function crearRegla(cambios = {}) {
  return new ReglaDerivacionTelemetria({
    id: 31,
    agente: {
      id: 7,
      tenantId: 1,
      empresaId: 2,
      sitioId: 3
    },
    senal: {
      id: 23,
      agenteId: 7
    },
    scope: {
      tenantId: 1,
      empresaId: 2,
      sitioId: 3
    },
    estado: ESTADOS_REGLA_DERIVACION_TELEMETRIA.ACTIVA,
    revisionVigenteId: 101,
    ...cambios
  });
}

function crearRevision(cambios = {}) {
  return new RevisionReglaDerivacionTelemetria({
    id: 101,
    reglaId: 31,
    numero: 1,
    condicion: {
      tipo: 'numero',
      version: 1,
      configuracion: {
        operador: '>',
        umbral: 80,
        unidad: 'ºC'
      }
    },
    severidadCalculada: 'advertencia',
    mensajeOperativo: 'Temperatura fuera de tolerancia.',
    nombre: 'Temperatura elevada',
    descripcion: 'Detecta temperaturas superiores al umbral.',
    metadatos: {
      causaProbable: 'Refrigeración insuficiente.'
    },
    vigenteDesdeUtc: '2026-07-20T10:00:00Z',
    vigenteHastaUtc: '2026-07-21T10:00:00Z',
    ...cambios
  });
}

function crearObservacion(cambios = {}) {
  return {
    id: 501,
    agenteId: 7,
    senalId: 23,
    valor: 85.4,
    tipoDato: 'numero',
    unidad: 'ºC',
    calidad: 'valida',
    observadoEnUtc: '2026-07-20T10:04:58Z',
    recibidoEnUtc: '2026-07-20T10:05:00Z',
    ...cambios
  };
}
