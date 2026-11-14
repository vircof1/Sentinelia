import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  CondicionDerivacionTelemetria,
  TIPOS_CONDICION_DERIVACION_TELEMETRIA
} from '../paquetes/agentes/src/EventosDerivadosTelemetriaAgentes.js';
import {
  CAUSALIDAD_REVISION_MOMENTO_UTC_RELATIVO,
  CAUSAS_EVALUACION_MOMENTO_UTC_RELATIVO,
  CondicionMomentoUtcRelativo,
  crearCondicionMomentoUtcRelativo,
  evaluarMomentoUtcRelativo
} from '../paquetes/agentes/src/EvaluadorMomentoUtcRelativoTelemetria.js';

const AHORA = '2026-09-04T10:00:00Z';

verificarContratoCanonico();
verificarRechazosDelContrato();
verificarLimiteInferiorSegundoASegundo();
verificarLimiteSuperiorSegundoASegundo();
verificarIntervaloEHistéresis();
verificarProgramacionYRecuperacionTardia();
verificarHorizonteYNoEvaluable();
verificarCausalidadYCorreccionDeReloj();
await verificarPurezaYCatalogoCerrado();

console.log(
  '[agentes] OK 5.24a.0: contrato=momento_utc_relativo@1 formas=3 ' +
  'desplazamientos=bigint_unsigned histeresis=por_lado limites=inclusivos ' +
  'evaluador=puro reloj=inyectado proxima_frontera=exacta catalogo_publico=cerrado'
);

function verificarContratoCanonico() {
  const condicion = crearCondicionMomentoUtcRelativo({
    forma: 'fuera_intervalo',
    limiteInferior: { direccion: 'pasado', segundos: '43200' },
    limiteSuperior: { direccion: 'futuro', segundos: '86400' },
    histeresisInferiorSegundos: '3600',
    histeresisSuperiorSegundos: '3600'
  });
  assert.ok(condicion instanceof CondicionMomentoUtcRelativo);
  assert.deepEqual(condicion.serializar(), {
    tipo: 'momento_utc_relativo',
    version: 1,
    configuracion: {
      forma: 'fuera_intervalo',
      limiteInferior: { direccion: 'pasado', segundos: '43200' },
      limiteSuperior: { direccion: 'futuro', segundos: '86400' },
      histeresisInferiorSegundos: '3600',
      histeresisSuperiorSegundos: '3600'
    }
  });
  assert.equal(
    condicion.obtenerCanonica(),
    '{"configuracion":{"forma":"fuera_intervalo","histeresisInferiorSegundos":"3600","histeresisSuperiorSegundos":"3600","limiteInferior":{"direccion":"pasado","segundos":"43200"},"limiteSuperior":{"direccion":"futuro","segundos":"86400"}},"tipo":"momento_utc_relativo","version":1}'
  );
  assert.equal(Object.isFrozen(condicion.configuracion.limiteInferior), true);
}

function verificarRechazosDelContrato() {
  for (const segundos of [0, 1, -1, '01', '-1', '+1', '1e3', ' 1', '']) {
    assert.throws(
      () => limiteInferior({ direccion: 'pasado', segundos }),
      /cadena decimal canónica|ahora exige cero/iu
    );
  }
  assert.throws(
    () => limiteInferior({ direccion: 'ahora', segundos: '1' }),
    /ahora exige cero/iu
  );
  assert.throws(
    () => limiteInferior({ direccion: 'pasado', segundos: '18446744073709551616' }),
    /BIGINT UNSIGNED/u
  );
  assert.throws(
    () => crearCondicionMomentoUtcRelativo({
      forma: 'fuera_intervalo',
      limiteInferior: { direccion: 'ahora', segundos: '0' },
      limiteSuperior: { direccion: 'futuro', segundos: '1' },
      histeresisInferiorSegundos: '0',
      histeresisSuperiorSegundos: '0'
    }),
    /al menos un segundo/iu
  );
  assert.throws(
    () => intervalo(-10, 10, 11, 10),
    /vaciar la región/iu
  );
  assert.throws(
    () => new CondicionMomentoUtcRelativo({
      tipo: 'momento_utc_relativo',
      version: 2,
      configuracion: configuracionInferior(-10, 0)
    }),
    /versión/iu
  );
}

function verificarLimiteInferiorSegundoASegundo() {
  const condicion = limiteInferior(desplazamiento(-10), 2);
  assert.deepEqual(
    [-11, -10, -9, -8].map((desviacion) =>
      evaluar(condicion, desviacion).resultado
    ),
    ['coincide', 'coincide', 'no_coincide', 'no_coincide']
  );
  const anterior = { resultado: 'coincide', ladoAtencion: 'inferior' };
  assert.equal(evaluar(condicion, -9, anterior).resultado, 'coincide');
  assert.equal(evaluar(condicion, -8, anterior).resultado, 'no_coincide');

  const sinHisteresis = limiteInferior(desplazamiento(-10), 0);
  assert.equal(evaluar(sinHisteresis, -10, anterior).resultado, 'coincide');
  assert.equal(evaluar(sinHisteresis, -9, anterior).resultado, 'no_coincide');
}

function verificarLimiteSuperiorSegundoASegundo() {
  const condicion = limiteSuperior(desplazamiento(10), 2);
  assert.deepEqual(
    [11, 10, 9, 8].map((desviacion) => evaluar(condicion, desviacion).resultado),
    ['coincide', 'coincide', 'no_coincide', 'no_coincide']
  );
  const anterior = { resultado: 'coincide', ladoAtencion: 'superior' };
  assert.equal(evaluar(condicion, 9, anterior).resultado, 'coincide');
  assert.equal(evaluar(condicion, 8, anterior).resultado, 'no_coincide');

  const sinHisteresis = limiteSuperior(desplazamiento(10), 0);
  assert.equal(evaluar(sinHisteresis, 10, anterior).resultado, 'coincide');
  assert.equal(evaluar(sinHisteresis, 9, anterior).resultado, 'no_coincide');
}

function verificarIntervaloEHistéresis() {
  const condicion = intervalo(-10, 10, 2, 2);
  assert.deepEqual(
    [-11, -10, -9, 0, 9, 10, 11].map((desviacion) => {
      const resultado = evaluar(condicion, desviacion);
      return [resultado.resultado, resultado.ladoAtencion];
    }),
    [
      ['coincide', 'inferior'],
      ['coincide', 'inferior'],
      ['no_coincide', null],
      ['no_coincide', null],
      ['no_coincide', null],
      ['coincide', 'superior'],
      ['coincide', 'superior']
    ]
  );

  const inferior = { resultado: 'coincide', ladoAtencion: 'inferior' };
  const superior = { resultado: 'coincide', ladoAtencion: 'superior' };
  assert.equal(evaluar(condicion, -9, inferior).ladoAtencion, 'inferior');
  assert.equal(evaluar(condicion, -8, inferior).resultado, 'no_coincide');
  assert.equal(evaluar(condicion, 9, superior).ladoAtencion, 'superior');
  assert.equal(evaluar(condicion, 8, superior).resultado, 'no_coincide');

  assert.deepEqual(
    seleccionar(evaluar(condicion, 11, inferior), ['resultado', 'ladoAtencion']),
    { resultado: 'coincide', ladoAtencion: 'superior' }
  );
  assert.deepEqual(
    seleccionar(evaluar(condicion, -11, superior), ['resultado', 'ladoAtencion']),
    { resultado: 'coincide', ladoAtencion: 'inferior' }
  );

  assert.equal(
    evaluar(condicion, -9, null).resultado,
    'no_coincide',
    'la primera evaluación dentro de histéresis no inventa atención'
  );
}

function verificarProgramacionYRecuperacionTardia() {
  const inferior = evaluar(limiteInferior(desplazamiento(-10), 2), 0);
  assert.equal(inferior.proximaReevaluacionUtc, '2026-09-04T10:00:10Z');

  const superior = evaluar(
    limiteSuperior(desplazamiento(10), 2),
    12,
    { resultado: 'coincide', ladoAtencion: 'superior' }
  );
  assert.equal(superior.proximaReevaluacionUtc, '2026-09-04T10:00:04Z');

  const exterior = intervalo(-10, 10, 2, 2);
  const recuperado = evaluar(
    exterior,
    8,
    { resultado: 'coincide', ladoAtencion: 'superior' }
  );
  assert.equal(recuperado.resultado, 'no_coincide');
  assert.equal(recuperado.proximaReevaluacionUtc, '2026-09-04T10:00:18Z');

  const saltoDosFronteras = evaluar(
    exterior,
    -11,
    { resultado: 'coincide', ladoAtencion: 'superior' }
  );
  assert.equal(saltoDosFronteras.resultado, 'coincide');
  assert.equal(saltoDosFronteras.ladoAtencion, 'inferior');
  assert.equal(saltoDosFronteras.proximaReevaluacionUtc, null);
}

function verificarHorizonteYNoEvaluable() {
  const horizonte = evaluarMomentoUtcRelativo({
    condicion: limiteInferior(desplazamiento(-1), 0),
    momentoUtc: '9999-12-31T23:59:59Z',
    ahoraUtc: '1000-01-01T00:00:00Z'
  });
  assert.equal(horizonte.resultado, 'no_coincide');
  assert.equal(horizonte.proximaReevaluacionUtc, null);
  assert.equal(horizonte.motivoProgramacion, 'frontera_fuera_horizonte_representable');

  const invalido = evaluarMomentoUtcRelativo({
    condicion: limiteInferior(desplazamiento(-1), 0),
    momentoUtc: '2026-09-04T10:00:00.000Z',
    ahoraUtc: AHORA
  });
  assert.equal(invalido.resultado, 'no_evaluable');
  assert.equal(invalido.proximaReevaluacionUtc, null);
  assert.throws(
    () => evaluarMomentoUtcRelativo({
      condicion: limiteInferior(desplazamiento(-1), 0),
      momentoUtc: AHORA,
      ahoraUtc: 'fecha-inválida'
    }),
    /autoritativo/iu
  );
}

function verificarCausalidadYCorreccionDeReloj() {
  const normal = evaluar(limiteInferior(desplazamiento(-10), 0), 0);
  assert.equal(normal.causalidadRevision, CAUSALIDAD_REVISION_MOMENTO_UTC_RELATIVO);
  assert.equal(normal.causa, CAUSAS_EVALUACION_MOMENTO_UTC_RELATIVO.OBSERVACION);
  assert.equal(normal.temporal.correccionReloj, null);

  const corregido = evaluarMomentoUtcRelativo({
    condicion: limiteSuperior(desplazamiento(10), 0),
    momentoUtc: momentoDesdeDesviacion(20),
    ahoraUtc: AHORA,
    causa: 'reconciliacion_reloj',
    correccionReloj: {
      generacionCorreccion: '2',
      relojAnteriorUtc: '2026-09-04T10:00:01Z',
      relojCorregidoUtc: AHORA
    }
  });
  assert.equal(corregido.temporal.correccionReloj.generacionCorreccion, '2');
  assert.throws(
    () => evaluarMomentoUtcRelativo({
      condicion: limiteSuperior(desplazamiento(10), 0),
      momentoUtc: AHORA,
      ahoraUtc: AHORA,
      causa: 'reconciliacion_reloj'
    }),
    /exige evidencia/iu
  );
  assert.throws(
    () => evaluarMomentoUtcRelativo({
      condicion: limiteSuperior(desplazamiento(10), 0),
      momentoUtc: AHORA,
      ahoraUtc: AHORA,
      correccionReloj: {
        generacionCorreccion: '1',
        relojAnteriorUtc: '2026-09-04T10:00:01Z',
        relojCorregidoUtc: AHORA
      }
    }),
    /Solo una reconciliación/iu
  );
}

async function verificarPurezaYCatalogoCerrado() {
  const fuente = await readFile(
    new URL('../paquetes/agentes/src/EvaluadorMomentoUtcRelativoTelemetria.js', import.meta.url),
    'utf8'
  );
  assert.doesNotMatch(fuente, /Date\.now\s*\(/u);
  assert.equal(
    Object.values(TIPOS_CONDICION_DERIVACION_TELEMETRIA)
      .includes('momento_utc_relativo'),
    false
  );
  assert.throws(
    () => new CondicionDerivacionTelemetria({
      tipo: 'momento_utc_relativo',
      version: 1,
      configuracion: configuracionInferior(-10, 0)
    }),
    /tipo de condición/iu
  );
}

function evaluar(condicion, desviacion, estadoAnteriorCompatible = null) {
  return evaluarMomentoUtcRelativo({
    condicion,
    momentoUtc: momentoDesdeDesviacion(desviacion),
    ahoraUtc: AHORA,
    estadoAnteriorCompatible
  });
}

function momentoDesdeDesviacion(segundos) {
  return new Date(Date.parse(AHORA) + segundos * 1000)
    .toISOString()
    .replace(/\.000Z$/u, 'Z');
}

function limiteInferior(limite, histeresis = 0) {
  return crearCondicionMomentoUtcRelativo({
    forma: 'limite_inferior',
    limite,
    histeresisSegundos: String(histeresis)
  });
}

function limiteSuperior(limite, histeresis = 0) {
  return crearCondicionMomentoUtcRelativo({
    forma: 'limite_superior',
    limite,
    histeresisSegundos: String(histeresis)
  });
}

function intervalo(inferior, superior, histeresisInferior, histeresisSuperior) {
  return crearCondicionMomentoUtcRelativo({
    forma: 'fuera_intervalo',
    limiteInferior: desplazamiento(inferior),
    limiteSuperior: desplazamiento(superior),
    histeresisInferiorSegundos: String(histeresisInferior),
    histeresisSuperiorSegundos: String(histeresisSuperior)
  });
}

function configuracionInferior(limite, histeresis) {
  return {
    forma: 'limite_inferior',
    limite: desplazamiento(limite),
    histeresisSegundos: String(histeresis)
  };
}

function desplazamiento(segundos) {
  if (segundos === 0) return { direccion: 'ahora', segundos: '0' };
  return {
    direccion: segundos < 0 ? 'pasado' : 'futuro',
    segundos: String(Math.abs(segundos))
  };
}

function seleccionar(objeto, claves) {
  return Object.fromEntries(claves.map((clave) => [clave, objeto[clave]]));
}
