import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  CALIDADES_TELEMETRIA_AGENTE,
  TIPOS_DATO_TELEMETRIA_AGENTE
} from '../paquetes/agentes/src/TelemetriaAgente.js';
import {
  CondicionDerivacionTelemetria,
  OPERADORES_CONDICION_DERIVACION_TELEMETRIA,
  RESULTADOS_EVALUACION_REGLA_TELEMETRIA,
  ReglaDerivacionTelemetria,
  RevisionReglaDerivacionTelemetria,
  TIPOS_CONDICION_DERIVACION_TELEMETRIA
} from '../paquetes/agentes/src/EventosDerivadosTelemetriaAgentes.js';
import {
  CODIGOS_MOTIVO_EVALUACION_TELEMETRIA,
  EvaluadorCondicionesDerivacionTelemetria,
  crearCondicionTipadaDerivacionTelemetria
} from '../paquetes/agentes/src/EvaluadorCondicionesDerivacionTelemetria.js';

const evaluador = new EvaluadorCondicionesDerivacionTelemetria();

await verificarAislamientoDeInfraestructura();
verificarCreacionConGuardrailCatalogado();
verificarOperadoresNumericos();
verificarBooleanosEstrictos();
verificarEstadoYTextoExactos();
verificarCondicionDeCalidad();
verificarResultadosNoEvaluables();
verificarRechazosDeConfiguracion();

console.log(
  '[agentes-telemetria] OK condiciones tipadas y evaluador puro verificados hasta 5.20a.3'
);

async function verificarAislamientoDeInfraestructura() {
  const fuente = await readFile(
    new URL(
      '../paquetes/agentes/src/EvaluadorCondicionesDerivacionTelemetria.js',
      import.meta.url
    ),
    'utf8'
  );
  for (const nombre of ['ClienteSql', 'ServicioConexionRedis', 'express', 'mysql2', 'redis']) {
    assert.equal(
      fuente.includes(nombre),
      false,
      `El evaluador puro no debe depender de ${nombre}.`
    );
  }
}

function verificarCreacionConGuardrailCatalogado() {
  const condicion = crearCondicionNumerica({ operador: '>', umbral: 80 });

  assert.deepEqual(condicion.serializar(), {
    tipo: 'numero',
    version: 1,
    configuracion: {
      operador: '>',
      umbral: 80,
      unidad: 'ºC'
    }
  });
  assert.equal(Object.isFrozen(condicion.configuracion), true);

  assert.throws(
    () => crearCondicionTipadaDerivacionTelemetria({
      senal: crearSenal({ tipoDato: 'texto', unidad: null }),
      tipo: 'numero',
      operador: '>',
      umbral: 80
    }),
    /coincidir exactamente/
  );
  assert.throws(
    () => crearCondicionTipadaDerivacionTelemetria({
      senal: crearSenal({ tipoDato: 'json', unidad: null }),
      tipo: 'json',
      operador: '=',
      valorEsperado: {}
    }),
    /JSON/
  );
}

function verificarOperadoresNumericos() {
  const casos = [
    ['>', 21, true],
    ['>', 20, false],
    ['>=', 20, true],
    ['<', 19, true],
    ['<', 20, false],
    ['<=', 20, true],
    ['=', 20, true],
    ['=', 20.01, false],
    ['!=', 20.01, true],
    ['!=', 20, false]
  ];

  for (const [operador, valor, coincide] of casos) {
    const resultado = evaluar({
      condicion: crearCondicionNumerica({ operador, umbral: 20 }),
      observacion: crearObservacion({ valor })
    });
    assert.equal(
      resultado.resultado,
      coincide ? 'coincide' : 'no_coincide',
      `La comparación ${valor} ${operador} 20 debe resolverse sin coerción.`
    );
    assert.equal(
      resultado.codigoMotivo,
      coincide
        ? CODIGOS_MOTIVO_EVALUACION_TELEMETRIA.CONDICION_CUMPLIDA
        : CODIGOS_MOTIVO_EVALUACION_TELEMETRIA.CONDICION_NO_CUMPLIDA
    );
  }

  const cero = evaluar({
    condicion: crearCondicionNumerica({ operador: '=', umbral: -0 }),
    observacion: crearObservacion({ valor: 0 })
  });
  assert.equal(cero.resultado, 'coincide');
}

function verificarBooleanosEstrictos() {
  const condicion = crearCondicionTipadaDerivacionTelemetria({
    senal: crearSenal({ tipoDato: 'booleano', unidad: null }),
    tipo: TIPOS_CONDICION_DERIVACION_TELEMETRIA.BOOLEANO,
    operador: OPERADORES_CONDICION_DERIVACION_TELEMETRIA.IGUAL,
    valorEsperado: false
  });
  const resultado = evaluar({
    condicion,
    senal: crearSenal({ tipoDato: 'booleano', unidad: null }),
    observacion: crearObservacion({
      tipoDato: 'booleano',
      unidad: null,
      valor: false
    })
  });
  assert.equal(resultado.resultado, 'coincide');

  const diferencia = crearCondicionTipadaDerivacionTelemetria({
    senal: crearSenal({ tipoDato: 'booleano', unidad: null }),
    tipo: TIPOS_CONDICION_DERIVACION_TELEMETRIA.BOOLEANO,
    operador: OPERADORES_CONDICION_DERIVACION_TELEMETRIA.DISTINTO,
    valorEsperado: true
  });
  assert.equal(
    evaluar({
      condicion: diferencia,
      senal: crearSenal({ tipoDato: 'booleano', unidad: null }),
      observacion: crearObservacion({
        tipoDato: 'booleano',
        unidad: null,
        valor: false
      })
    }).resultado,
    'coincide'
  );

  const sinCoercion = evaluar({
    condicion,
    senal: crearSenal({ tipoDato: 'booleano', unidad: null }),
    observacion: crearObservacion({
      tipoDato: 'booleano',
      unidad: null,
      valor: 'false'
    })
  });
  assert.equal(sinCoercion.resultado, 'no_evaluable');
  assert.equal(sinCoercion.codigoMotivo, 'valor_no_evaluable');
}

function verificarEstadoYTextoExactos() {
  const casos = [
    {
      tipo: 'estado',
      esperado: 'abierta',
      observado: 'Abierta'
    },
    {
      tipo: 'texto',
      esperado: 'Refrigeración activa',
      observado: 'refrigeración activa'
    }
  ];

  for (const caso of casos) {
    const senal = crearSenal({ tipoDato: caso.tipo, unidad: null });
    const condicion = crearCondicionTipadaDerivacionTelemetria({
      senal,
      tipo: caso.tipo,
      operador: '=',
      valorEsperado: caso.esperado
    });
    const resultado = evaluar({
      condicion,
      senal,
      observacion: crearObservacion({
        tipoDato: caso.tipo,
        unidad: null,
        valor: caso.observado
      })
    });
    assert.equal(resultado.resultado, 'no_coincide');

    const diferencia = crearCondicionTipadaDerivacionTelemetria({
      senal,
      tipo: caso.tipo,
      operador: '!=',
      valorEsperado: caso.esperado
    });
    assert.equal(
      evaluar({
        condicion: diferencia,
        senal,
        observacion: crearObservacion({
          tipoDato: caso.tipo,
          unidad: null,
          valor: caso.observado
        })
      }).resultado,
      'coincide'
    );
  }
}

function verificarCondicionDeCalidad() {
  const senalJson = crearSenal({ tipoDato: 'json', unidad: null });
  const condicion = crearCondicionTipadaDerivacionTelemetria({
    senal: senalJson,
    tipo: TIPOS_CONDICION_DERIVACION_TELEMETRIA.CALIDAD,
    operador: '=',
    calidadEsperada: CALIDADES_TELEMETRIA_AGENTE.ERROR_LECTURA
  });
  const resultado = evaluar({
    condicion,
    senal: senalJson,
    observacion: crearObservacion({
      tipoDato: 'json',
      unidad: null,
      valor: { codigo: 'sensor_fuera_linea' },
      calidad: CALIDADES_TELEMETRIA_AGENTE.ERROR_LECTURA
    })
  });

  assert.equal(resultado.resultado, 'coincide');
  assert.equal(resultado.tipoDato, 'json');
  assert.deepEqual(resultado.valorEvaluado, { codigo: 'sensor_fuera_linea' });

  const distinta = crearCondicionTipadaDerivacionTelemetria({
    senal: senalJson,
    tipo: TIPOS_CONDICION_DERIVACION_TELEMETRIA.CALIDAD,
    operador: '!=',
    calidadEsperada: CALIDADES_TELEMETRIA_AGENTE.VALIDA
  });
  assert.equal(
    evaluar({
      condicion: distinta,
      senal: senalJson,
      observacion: crearObservacion({
        tipoDato: 'json',
        unidad: null,
        valor: { codigo: 'sensor_fuera_linea' },
        calidad: CALIDADES_TELEMETRIA_AGENTE.ERROR_LECTURA
      })
    }).resultado,
    'coincide'
  );
}

function verificarResultadosNoEvaluables() {
  const condicion = crearCondicionNumerica({ operador: '>', umbral: 80 });
  const casos = [
    {
      senal: crearSenal(),
      observacion: crearObservacion({ tipoDato: 'texto', valor: '85' }),
      codigo: 'tipo_observacion_incompatible'
    },
    {
      senal: crearSenal(),
      observacion: crearObservacion({ unidad: 'C' }),
      codigo: 'unidad_observacion_incompatible'
    },
    {
      senal: crearSenal({ unidad: 'C' }),
      observacion: crearObservacion({ unidad: 'C' }),
      codigo: 'unidad_senal_incompatible'
    },
    {
      senal: crearSenal(),
      observacion: crearObservacion({ valor: '85' }),
      codigo: 'valor_no_evaluable'
    }
  ];

  for (const caso of casos) {
    const resultado = evaluar({ condicion, ...caso });
    assert.equal(resultado.resultado, 'no_evaluable');
    assert.equal(resultado.codigoMotivo, caso.codigo);
    assert.equal(resultado.severidadCalculada, null);
  }

  const senal = crearSenal({ tipoDato: 'booleano', unidad: null });
  const calidad = crearCondicionTipadaDerivacionTelemetria({
    senal,
    tipo: 'calidad',
    operador: '=',
    calidadEsperada: 'valida'
  });
  const desconocida = evaluar({
    condicion: calidad,
    senal,
    observacion: crearObservacion({
      tipoDato: 'booleano',
      unidad: null,
      valor: true,
      calidad: 'inventada'
    })
  });
  assert.equal(desconocida.resultado, 'no_evaluable');
  assert.equal(desconocida.codigoMotivo, 'calidad_no_evaluable');
}

function verificarRechazosDeConfiguracion() {
  assert.throws(
    () => crearCondicionNumerica({ operador: 'entre', umbral: 20 }),
    /operador.*no es válido/i
  );
  assert.throws(
    () => crearCondicionNumerica({ operador: '>', umbral: '20' }),
    /número finito/
  );
  assert.throws(
    () => crearCondicionTipadaDerivacionTelemetria({
      senal: crearSenal({ tipoDato: 'booleano', unidad: null }),
      tipo: 'booleano',
      operador: '=',
      valorEsperado: 'true'
    }),
    /debe ser booleano/
  );
  assert.throws(
    () => new CondicionDerivacionTelemetria({
      tipo: 'numero',
      configuracion: {
        operador: '>',
        umbral: 20,
        unidad: 'ºC',
        condiciones: []
      }
    }),
    /exactamente/
  );
  assert.throws(
    () => new CondicionDerivacionTelemetria({
      tipo: 'json',
      configuracion: {
        operador: '=',
        valorEsperado: {}
      }
    }),
    /tipo.*no es válido/i
  );

  const condicion = crearCondicionNumerica({ operador: '>', umbral: 20 });
  const reglaDeshabilitada = new ReglaDerivacionTelemetria({
    id: 31,
    agente: { id: 7, tenantId: 1, empresaId: 2, sitioId: 3 },
    senal: { id: 23, agenteId: 7 },
    scope: { tenantId: 1, empresaId: 2, sitioId: 3 },
    estado: 'deshabilitada',
    revisionVigenteId: 101
  });
  assert.throws(
    () => evaluador.evaluar({
      regla: reglaDeshabilitada,
      revision: crearRevision(condicion),
      senal: crearSenal(),
      observacion: crearObservacion(),
      evaluadoEnUtc: '2026-07-20T10:05:01Z'
    }),
    /deshabilitada no puede evaluarse/
  );
}

function evaluar({ condicion, senal = crearSenal(), observacion = crearObservacion() }) {
  const regla = crearRegla();
  const revision = crearRevision(condicion);
  return evaluador.evaluar({
    regla,
    revision,
    senal,
    observacion,
    evaluadoEnUtc: '2026-07-20T10:05:01Z'
  });
}

function crearCondicionNumerica({ operador, umbral }) {
  return crearCondicionTipadaDerivacionTelemetria({
    senal: crearSenal(),
    tipo: TIPOS_CONDICION_DERIVACION_TELEMETRIA.NUMERO,
    operador,
    umbral
  });
}

function crearRegla() {
  return new ReglaDerivacionTelemetria({
    id: 31,
    agente: { id: 7, tenantId: 1, empresaId: 2, sitioId: 3 },
    senal: { id: 23, agenteId: 7 },
    scope: { tenantId: 1, empresaId: 2, sitioId: 3 },
    revisionVigenteId: 101
  });
}

function crearRevision(condicion) {
  return new RevisionReglaDerivacionTelemetria({
    id: 101,
    reglaId: 31,
    numero: 1,
    condicion,
    severidadCalculada: 'advertencia',
    mensajeOperativo: 'Condición de telemetría detectada.',
    nombre: 'Condición tipada',
    vigenteDesdeUtc: '2026-07-20T10:00:00Z'
  });
}

function crearSenal(cambios = {}) {
  return {
    id: 23,
    agenteId: 7,
    tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.NUMERO,
    unidad: 'ºC',
    ...cambios
  };
}

function crearObservacion(cambios = {}) {
  return {
    id: 501,
    agenteId: 7,
    senalId: 23,
    valor: 85,
    tipoDato: TIPOS_DATO_TELEMETRIA_AGENTE.NUMERO,
    unidad: 'ºC',
    calidad: CALIDADES_TELEMETRIA_AGENTE.VALIDA,
    observadoEnUtc: '2026-07-20T10:04:58Z',
    recibidoEnUtc: '2026-07-20T10:05:00Z',
    ...cambios
  };
}
