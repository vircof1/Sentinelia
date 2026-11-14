import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  ErrorPuertoFederacion,
  GeneradorIdentidadesFederadas,
  PERFIL_PUERTOS_FEDERACION,
  PUERTO_AUDITORIA_FEDERACION,
  PUERTO_CAPTURA_TRANSACCIONAL_FEDERACION,
  PUERTO_CIFRADO_FEDERACION,
  PUERTO_KEYRING_FEDERACION,
  PUERTO_PUBLICACION_EFIMERA_FEDERACION,
  PUERTO_RELOJ_SQL_FEDERACION,
  PUERTO_REPOSITORIO_DATOS_FEDERACION,
  PUERTOS_FEDERACION,
  TIPOS_IDENTIDAD_FEDERADA,
  VERSION_PUERTOS_FEDERACION,
  crearFachadaPuertoFederacion,
  exigirImplementacionPuertoFederacion,
  obtenerContratoPuertoFederacion
} from '../paquetes/federacion/src/index.js';

await verificarManifiestoCerrado();
verificarFronterasTransaccionales();
verificarSecretosYTiempo();
await verificarFachadasYComposicion();
verificarRechazosEstructurales();

console.log(
  '[federacion] OK 5.22.9f: puertos=12 infraestructura=0 ' +
    'captura=transaccion_prestada auditoria=testimonio publicacion=efimera'
);

async function verificarManifiestoCerrado() {
  assert.equal(VERSION_PUERTOS_FEDERACION, 1);
  assert.equal(PERFIL_PUERTOS_FEDERACION, 'sentinelia-federacion-puertos-v1');
  assert.deepEqual(Object.keys(PUERTOS_FEDERACION), [
    'relojSql',
    'identidades',
    'keyring',
    'cifrado',
    'auditoria',
    'configuracion',
    'repositorioIdentidad',
    'repositorioControl',
    'repositorioDatos',
    'repositorioProyecciones',
    'capturaTransaccional',
    'publicacionEfimera'
  ]);
  assert.equal(Object.isFrozen(PUERTOS_FEDERACION), true);
  const metodosGlobales = new Set();
  for (const [nombre, contrato] of Object.entries(PUERTOS_FEDERACION)) {
    assert.equal(contrato, obtenerContratoPuertoFederacion(nombre));
    assert.equal(contrato.nombre, nombre);
    assert.equal(contrato.version, VERSION_PUERTOS_FEDERACION);
    assert.equal(Object.isFrozen(contrato), true);
    assert.equal(Object.isFrozen(contrato.metodos), true);
    assert.equal(Object.isFrozen(contrato.invariantes), true);
    assert.ok(contrato.metodos.length > 0);
    assert.ok(contrato.invariantes.length > 0);
    for (const entrada of contrato.metodos) {
      assert.equal(Object.isFrozen(entrada), true);
      assert.ok(['sincrono', 'asincrono'].includes(entrada.modo));
      assert.ok(['calculo', 'lectura', 'escritura', 'publicacion'].includes(entrada.efecto));
      assert.ok(['ninguna', 'opcional', 'requerida'].includes(entrada.transaccion));
      assert.ok(['duranteOperacion', 'despuesCommit'].includes(entrada.momento));
      assert.equal(typeof entrada.nombre, 'string');
      assert.equal(metodosGlobales.has(`${nombre}.${entrada.nombre}`), false);
      metodosGlobales.add(`${nombre}.${entrada.nombre}`);
    }
  }
  assert.throws(() => PUERTOS_FEDERACION.nuevo = {});

  const fuente = await readFile(
    new URL('../paquetes/federacion/src/PuertosFederacion.js', import.meta.url),
    'utf8'
  );
  assert.doesNotMatch(fuente, /^\s*import\s/m);
  assert.doesNotMatch(fuente, /from\s+['"](?:mysql2?|redis|express|node:crypto)['"]/);
}
function verificarFronterasTransaccionales() {
  assert.notEqual(
    PUERTO_CAPTURA_TRANSACCIONAL_FEDERACION,
    PUERTO_AUDITORIA_FEDERACION
  );
  assert.deepEqual(
    PUERTO_CAPTURA_TRANSACCIONAL_FEDERACION.metodos.map(({ nombre }) => nombre),
    ['capturarEnTransaccion']
  );
  assert.deepEqual(
    PUERTO_AUDITORIA_FEDERACION.metodos.map(({ nombre }) => nombre),
    ['testimoniarEnTransaccion']
  );
  assert.ok(
    PUERTO_CAPTURA_TRANSACCIONAL_FEDERACION.invariantes.includes(
      'no_reutiliza_outbox_auditoria'
    )
  );
  assert.ok(
    PUERTO_AUDITORIA_FEDERACION.invariantes.includes(
      'auditoria_no_es_outbox_federada'
    )
  );
  for (const contrato of [
    PUERTO_CAPTURA_TRANSACCIONAL_FEDERACION,
    PUERTO_AUDITORIA_FEDERACION,
    PUERTO_REPOSITORIO_DATOS_FEDERACION
  ]) {
    const nombres = contrato.metodos.map(({ nombre }) => nombre);
    assert.equal(
      nombres.some((nombre) => /^(?:begin|commit|rollback|release|execute|query)/i.test(nombre)),
      false,
      `${contrato.nombre} no debe apropiarse de la transacción o del driver.`
    );
    for (const entrada of contrato.metodos.filter(({ efecto }) => efecto === 'escritura')) {
      assert.equal(entrada.transaccion, 'requerida');
    }
  }

  assert.deepEqual(
    PUERTO_PUBLICACION_EFIMERA_FEDERACION.metodos.map(
      ({ nombre, momento, efecto, transaccion }) => ({
        nombre,
        momento,
        efecto,
        transaccion
      })
    ),
    [
      {
        nombre: 'publicarInvalidacion',
        momento: 'despuesCommit',
        efecto: 'publicacion',
        transaccion: 'ninguna'
      },
      {
        nombre: 'publicarDespertar',
        momento: 'despuesCommit',
        efecto: 'publicacion',
        transaccion: 'ninguna'
      }
    ]
  );
  assert.ok(
    PUERTO_PUBLICACION_EFIMERA_FEDERACION.invariantes.includes(
      'nunca_trabajo_recuperable'
    )
  );
}

function verificarSecretosYTiempo() {
  assert.deepEqual(
    PUERTO_RELOJ_SQL_FEDERACION.metodos.map(({ nombre }) => nombre),
    ['obtenerAhoraUtc', 'verificarOperacionUtc']
  );
  assert.ok(
    PUERTO_RELOJ_SQL_FEDERACION.invariantes.includes(
      'sql_es_fuente_temporal_local'
    )
  );
  assert.ok(
    PUERTO_KEYRING_FEDERACION.metodos
      .filter(({ nombre }) => nombre.startsWith('obtenerClave'))
      .every(({ secretos }) => secretos === 'salida_sensible')
  );
  assert.ok(
    PUERTO_CIFRADO_FEDERACION.metodos.every(
      ({ secretos }) => secretos === 'entrada_y_salida_sensibles'
    )
  );
  assert.equal(
    PUERTO_KEYRING_FEDERACION.metodos.some(({ nombre }) => nombre === 'generarIdentidad'),
    false
  );
  const generador = new GeneradorIdentidadesFederadas({
    fuenteEntropia: {
      entropiaBitsPorIdentidad: 128,
      generarBytes: () => Uint8Array.from({ length: 16 }, (_, indice) => indice)
    }
  });
  const fachadaIdentidades = crearFachadaPuertoFederacion('identidades', generador);
  assert.equal(
    fachadaIdentidades.generar(TIPOS_IDENTIDAD_FEDERADA.FLUJO).tipo,
    TIPOS_IDENTIDAD_FEDERADA.FLUJO
  );
}

async function verificarFachadasYComposicion() {
  const trazas = [];
  const implementaciones = Object.fromEntries(
    Object.entries(PUERTOS_FEDERACION).map(([nombre, contrato]) => {
      const implementacion = { nombreInterno: nombre, metodoAjeno() {} };
      for (const { nombre: metodoPuerto } of contrato.metodos) {
        implementacion[metodoPuerto] = function (...argumentos) {
          assert.equal(this.nombreInterno, nombre);
          trazas.push({ puerto: nombre, metodo: metodoPuerto, argumentos });
          return `${nombre}.${metodoPuerto}`;
        };
      }
      return [nombre, implementacion];
    })
  );
  const fachadas = Object.fromEntries(Object.entries(implementaciones).map(
    ([nombre, implementacion]) => [
      nombre,
      crearFachadaPuertoFederacion(nombre, implementacion)
    ]
  ));
  for (const [nombre, fachada] of Object.entries(fachadas)) {
    assert.equal(Object.isFrozen(fachada), true);
    assert.equal('metodoAjeno' in fachada, false);
    const esperados = PUERTOS_FEDERACION[nombre].metodos.map(({ nombre }) => nombre);
    assert.deepEqual(Object.keys(fachada), esperados);
    for (const metodoPuerto of esperados) {
      assert.equal(await fachada[metodoPuerto]({ fixture: true }), `${nombre}.${metodoPuerto}`);
    }
  }

  const implementacionMutable = {
    obtenerAhoraUtc() {
      return 'metodo-validado';
    },
    verificarOperacionUtc() {
      return true;
    }
  };
  const fachadaEstable = crearFachadaPuertoFederacion(
    'relojSql',
    implementacionMutable
  );
  implementacionMutable.obtenerAhoraUtc = () => 'metodo-sustituido';
  assert.equal(fachadaEstable.obtenerAhoraUtc(), 'metodo-validado');

  const transaccionPrestada = Object.freeze({ referencia: 'tx-productor-1' });
  const cambio = Object.freeze({ familia: 'monitores', elementoId: 'monitor-7' });
  fachadas.capturaTransaccional.capturarEnTransaccion({
    transaccion: transaccionPrestada,
    cambio
  });
  fachadas.auditoria.testimoniarEnTransaccion({
    transaccion: transaccionPrestada,
    intenciones: [{ tipo: 'federacion.ocurrencia_capturada' }]
  });
  trazas.push({ puerto: 'fronteraProductora', metodo: 'commit', argumentos: [] });
  fachadas.publicacionEfimera.publicarDespertar({
    tema: 'federacion.outbox',
    referencia: 'flujo-3',
    version: '18'
  });

  const tramo = trazas.slice(-4);
  assert.equal(tramo[0].argumentos[0].transaccion, transaccionPrestada);
  assert.equal(tramo[1].argumentos[0].transaccion, transaccionPrestada);
  assert.deepEqual(tramo.map(({ puerto, metodo }) => `${puerto}.${metodo}`), [
    'capturaTransaccional.capturarEnTransaccion',
    'auditoria.testimoniarEnTransaccion',
    'fronteraProductora.commit',
    'publicacionEfimera.publicarDespertar'
  ]);
  assert.deepEqual(tramo[3].argumentos[0], {
    tema: 'federacion.outbox',
    referencia: 'flujo-3',
    version: '18'
  });
}

function verificarRechazosEstructurales() {
  assert.throws(
    () => obtenerContratoPuertoFederacion('repositorio'),
    (error) =>
      error instanceof ErrorPuertoFederacion &&
      error.codigo === 'puerto_desconocido'
  );
  assert.throws(
    () => exigirImplementacionPuertoFederacion('relojSql', null),
    (error) =>
      error instanceof ErrorPuertoFederacion &&
      error.codigo === 'implementacion_puerto_invalida'
  );
  assert.throws(
    () => crearFachadaPuertoFederacion('relojSql', {
      obtenerAhoraUtc() {}
    }),
    (error) =>
      error instanceof ErrorPuertoFederacion &&
      error.codigo === 'metodo_puerto_ausente' &&
      error.metodo === 'verificarOperacionUtc'
  );

  let accessorMetodoEjecutado = false;
  const implementacionConAccessor = {
    verificarOperacionUtc() {}
  };
  Object.defineProperty(implementacionConAccessor, 'obtenerAhoraUtc', {
    get() {
      accessorMetodoEjecutado = true;
      return () => new Date();
    }
  });
  assert.throws(
    () => crearFachadaPuertoFederacion('relojSql', implementacionConAccessor),
    (error) =>
      error instanceof ErrorPuertoFederacion &&
      error.codigo === 'metodo_puerto_ausente' &&
      error.metodo === 'obtenerAhoraUtc'
  );
  assert.equal(accessorMetodoEjecutado, false);

  let implementacionConPrototipoCiclico;
  implementacionConPrototipoCiclico = new Proxy({}, {
    getPrototypeOf() {
      return implementacionConPrototipoCiclico;
    }
  });
  assert.throws(
    () => crearFachadaPuertoFederacion(
      'relojSql',
      implementacionConPrototipoCiclico
    ),
    (error) =>
      error instanceof ErrorPuertoFederacion &&
      error.codigo === 'metodo_puerto_ausente'
  );
}
