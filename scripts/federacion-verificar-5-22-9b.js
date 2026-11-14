import assert from 'node:assert/strict';

import {
  BYTES_IDENTIDAD_FEDERADA,
  ENTROPIA_MINIMA_IDENTIDAD_FEDERADA_BITS,
  ErrorIdentidadFederada,
  GeneradorIdentidadesFederadas,
  TIPOS_IDENTIDAD_FEDERADA,
  crearIdentidadFederada,
  esIdentidadFederada,
  exigirIdentidadFederada
} from '../paquetes/federacion/src/index.js';

async function main() {
  verificarCatalogoYGeneracion();
  verificarRehidratacionYOpacidad();
  verificarMezclaDeTipos();
  verificarFormatosInvalidos();
  verificarEntropiaInsuficiente();
  verificarMaterialEntropiaNoEjecutaIteradoresAjenos();
  console.log(
    '[federacion] OK 5.22.9b: identidades=12 formato=sfid1 ' +
    'entropia=128bits tipos=no_mezclables generador=inyectable'
  );
}

function verificarCatalogoYGeneracion() {
  assert.equal(BYTES_IDENTIDAD_FEDERADA, 16);
  assert.equal(ENTROPIA_MINIMA_IDENTIDAD_FEDERADA_BITS, 128);
  assert.equal(Object.isFrozen(TIPOS_IDENTIDAD_FEDERADA), true);
  assert.deepEqual(Object.values(TIPOS_IDENTIDAD_FEDERADA), [
    'instalacion',
    'arranque',
    'relacion',
    'revision_concesion',
    'flujo',
    'generacion',
    'lote',
    'elemento_origen',
    'ocurrencia_origen',
    'entrega',
    'contribucion',
    'proyeccion'
  ]);

  const fuente = new FuenteEntropiaFixture();
  const generador = new GeneradorIdentidadesFederadas({ fuenteEntropia: fuente });
  const identidades = Object.values(TIPOS_IDENTIDAD_FEDERADA).map((tipo) =>
    generador.generar(tipo)
  );
  assert.equal(new Set(identidades.map(String)).size, identidades.length);
  assert.deepEqual(
    fuente.solicitudes.map(({ cantidadBytes }) => cantidadBytes),
    Array(12).fill(16)
  );
  assert.deepEqual(
    fuente.solicitudes.map(({ tipo }) => tipo),
    Object.values(TIPOS_IDENTIDAD_FEDERADA)
  );
  for (const identidad of identidades) {
    assert.match(
      identidad.serializar(),
      new RegExp(`^sfid1\\.${identidad.tipo}\\.[A-Za-z0-9_-]{22}$`)
    );
    assert.equal(esIdentidadFederada(identidad, identidad.tipo), true);
  }
}

function verificarRehidratacionYOpacidad() {
  const generadorVector = new GeneradorIdentidadesFederadas({
    fuenteEntropia: {
      entropiaBitsPorIdentidad: 128,
      generarBytes: ({ cantidadBytes }) => Uint8Array.from(
        { length: cantidadBytes },
        (_valor, indice) => indice
      )
    }
  });
  const identidad = generadorVector.generar(
    TIPOS_IDENTIDAD_FEDERADA.INSTALACION
  );
  assert.equal(
    identidad.serializar(),
    'sfid1.instalacion.AAECAwQFBgcICQoLDA0ODw'
  );
  const rehidratada = crearIdentidadFederada({
    tipo: TIPOS_IDENTIDAD_FEDERADA.INSTALACION,
    valor: identidad.serializar()
  });
  assert.notEqual(rehidratada, identidad);
  assert.equal(rehidratada.esIgual(identidad), true);
  assert.equal(identidad.esIgual(rehidratada), true);
  assert.equal(String(identidad), identidad.serializar());
  assert.equal(JSON.stringify(identidad), JSON.stringify(identidad.serializar()));
  assert.equal(identidad.valor, undefined);
  assert.deepEqual(Object.keys(identidad), []);
  assert.equal(Object.isFrozen(identidad), true);
  assert.throws(() => {
    identidad.tipo = TIPOS_IDENTIDAD_FEDERADA.RELACION;
  }, TypeError);

  const identidadFalsificada = Object.create(Object.getPrototypeOf(identidad));
  assert.equal(esIdentidadFederada(identidadFalsificada), false);
  assert.equal(identidad.esIgual(identidadFalsificada), false);
  exigirError(
    () => exigirIdentidadFederada(identidadFalsificada, {
      tipo: TIPOS_IDENTIDAD_FEDERADA.INSTALACION
    }),
    'instancia_invalida'
  );
}

function verificarMezclaDeTipos() {
  const instalacion = crearGeneradorFixture().generar(
    TIPOS_IDENTIDAD_FEDERADA.INSTALACION
  );
  assert.equal(
    exigirIdentidadFederada(instalacion, {
      tipo: TIPOS_IDENTIDAD_FEDERADA.INSTALACION,
      campo: 'installationId'
    }),
    instalacion
  );
  exigirError(
    () => exigirIdentidadFederada(instalacion, {
      tipo: TIPOS_IDENTIDAD_FEDERADA.RELACION,
      campo: 'relacionId'
    }),
    'tipo_mezclado'
  );
  exigirError(
    () => crearIdentidadFederada({
      tipo: TIPOS_IDENTIDAD_FEDERADA.RELACION,
      valor: instalacion.serializar()
    }),
    'tipo_mezclado'
  );
  exigirError(
    () => exigirIdentidadFederada(instalacion.serializar(), {
      tipo: TIPOS_IDENTIDAD_FEDERADA.INSTALACION
    }),
    'instancia_invalida'
  );
  assert.equal(esIdentidadFederada(instalacion, TIPOS_IDENTIDAD_FEDERADA.RELACION), false);
}

function verificarFormatosInvalidos() {
  const tipo = TIPOS_IDENTIDAD_FEDERADA.FLUJO;
  const valida = crearGeneradorFixture().generar(tipo).serializar();
  for (const valor of [
    '',
    ` ${valida}`,
    `${valida} `,
    valida.replace('sfid1.', 'sfid2.'),
    `${valida}=`,
    valida.replace(/.$/, '!'),
    'sfid1.flujo.AA'
  ]) {
    exigirError(() => crearIdentidadFederada({ tipo, valor }), 'formato');
  }
  const residualNoCanonico = valida.slice(0, -1) + 'B';
  exigirError(
    () => crearIdentidadFederada({ tipo, valor: residualNoCanonico }),
    'formato_no_canonico'
  );
  exigirError(
    () => crearIdentidadFederada({ tipo: 'usuario', valor: valida }),
    'tipo_invalido'
  );
  exigirError(() => crearGeneradorFixture().generar('usuario'), 'tipo_invalido');
}

function verificarEntropiaInsuficiente() {
  exigirError(
    () => new GeneradorIdentidadesFederadas({
      fuenteEntropia: {
        entropiaBitsPorIdentidad: 127,
        generarBytes: () => new Uint8Array(16)
      }
    }),
    'entropia_insuficiente'
  );
  exigirError(
    () => new GeneradorIdentidadesFederadas(),
    'fuente_entropia_invalida'
  );
  const fuenteCorta = {
    entropiaBitsPorIdentidad: 128,
    generarBytes: () => new Uint8Array(15)
  };
  exigirError(
    () => new GeneradorIdentidadesFederadas({
      fuenteEntropia: fuenteCorta
    }).generar(TIPOS_IDENTIDAD_FEDERADA.LOTE),
    'entropia_insuficiente'
  );
  const fuenteAsincrona = {
    entropiaBitsPorIdentidad: 128,
    generarBytes: async () => new Uint8Array(16)
  };
  exigirError(
    () => new GeneradorIdentidadesFederadas({
      fuenteEntropia: fuenteAsincrona
    }).generar(TIPOS_IDENTIDAD_FEDERADA.LOTE),
    'entropia_insuficiente'
  );
}

function verificarMaterialEntropiaNoEjecutaIteradoresAjenos() {
  let iteradorAjenoEjecutado = false;
  const material = Uint8Array.from(
    { length: BYTES_IDENTIDAD_FEDERADA },
    (_valor, indice) => indice
  );
  Object.defineProperty(material, Symbol.iterator, {
    value: function* () {
      iteradorAjenoEjecutado = true;
      yield 255;
    }
  });
  const identidad = new GeneradorIdentidadesFederadas({
    fuenteEntropia: {
      entropiaBitsPorIdentidad: ENTROPIA_MINIMA_IDENTIDAD_FEDERADA_BITS,
      generarBytes: () => material
    }
  }).generar(TIPOS_IDENTIDAD_FEDERADA.INSTALACION);
  assert.equal(iteradorAjenoEjecutado, false);
  assert.equal(
    identidad.serializar(),
    'sfid1.instalacion.AAECAwQFBgcICQoLDA0ODw'
  );
}

function crearGeneradorFixture() {
  return new GeneradorIdentidadesFederadas({
    fuenteEntropia: new FuenteEntropiaFixture()
  });
}

function exigirError(tarea, codigoEsperado) {
  assert.throws(tarea, (error) => {
    assert.equal(error instanceof ErrorIdentidadFederada, true);
    if (codigoEsperado === 'formato') {
      assert.match(error.codigo, /^formato_/);
    } else {
      assert.equal(error.codigo, codigoEsperado);
    }
    return true;
  });
}

class FuenteEntropiaFixture {
  constructor() {
    this.entropiaBitsPorIdentidad = 128;
    this.solicitudes = [];
    this.secuencia = 0;
  }

  generarBytes({ cantidadBytes, tipo }) {
    this.solicitudes.push({ cantidadBytes, tipo });
    this.secuencia += 1;
    return Uint8Array.from(
      { length: cantidadBytes },
      (_valor, indice) => (this.secuencia * 17 + indice * 29) & 255
    );
  }
}

await main();
