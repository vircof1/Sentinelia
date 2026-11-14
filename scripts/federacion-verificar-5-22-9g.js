import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  BLOQUEOS_CAPACIDADES_CONFIGURACION_FEDERACION,
  CONFIGURACIONES_GLOBALES_FEDERACION,
  ErrorConfiguracionFederacion,
  FAMILIAS_FEDERACION,
  LIMITES_DUROS_RECURSOS_FEDERACION,
  PERFIL_CONFIGURACION_FEDERACION,
  VERSION_CONFIGURACION_FEDERACION,
  VERSION_PROTOCOLO_FEDERACION,
  VERSIONES_FAMILIA_FEDERACION,
  crearDeclaracionCapacidadReceptoraFederacion,
  medirRecursosCanonicosFederacion,
  normalizarConfiguracionFederacion,
  proyectarCapacidadesConfiguracionFederacion,
  validarRecursosLoteFederacion
} from '../paquetes/federacion/src/index.js';
import {
  crearFixtureCapacidadReceptoraFederacion,
  crearFixtureConfiguracionFederacion,
  crearFixtureEnvolventeFederacion
} from '../paquetes/federacion/fixtures/ContratoFederacionFixtures.js';

await verificarManifiestoConfiguracion();
verificarNormalizacionYRechazos();
verificarCapacidadReceptora();
verificarRecursosAcotados();
verificarRecorridoSinLimiteSemantico();

console.log(
  '[federacion] OK 5.22.9g: configuracion=13 limites=3 ' +
    'fixtures=3 recorrido=sin_limite_semantico'
);

async function verificarManifiestoConfiguracion() {
  assert.equal(VERSION_CONFIGURACION_FEDERACION, 1);
  assert.equal(
    PERFIL_CONFIGURACION_FEDERACION,
    'sentinelia-federacion-configuracion-v1'
  );
  assert.deepEqual(Object.keys(CONFIGURACIONES_GLOBALES_FEDERACION), [
    'activacionFederacion',
    'origenPublico',
    'proxiesConfiables',
    'toleranciaTemporalMs',
    'loteMaximoOcurrencias',
    'loteMaximoBytes',
    'ocurrenciaMaximaBytes',
    'capacidadReceptoraOcurrencias',
    'ttlEstadoOperativoMs',
    'silencioRelacionMs',
    'consolidacionReinicioMs',
    'retencionMaximaDias',
    'keyringReferenciaDespliegue'
  ]);
  assert.equal(Object.isFrozen(CONFIGURACIONES_GLOBALES_FEDERACION), true);
  assert.equal(Object.isFrozen(CONFIGURACIONES_GLOBALES_FEDERACION.origenPublico), true);
  assert.equal(
    CONFIGURACIONES_GLOBALES_FEDERACION.ttlEstadoOperativoMs.defecto,
    15 * 60 * 1000
  );
  assert.deepEqual(LIMITES_DUROS_RECURSOS_FEDERACION, {
    loteMaximoOcurrencias: 5000,
    loteMaximoBytes: 16777216,
    ocurrenciaMaximaBytes: 2097152
  });
  assert.throws(() => CONFIGURACIONES_GLOBALES_FEDERACION.nueva = {});

  const fuente = await readFile(
    new URL('../paquetes/federacion/src/ConfiguracionFederacion.js', import.meta.url),
    'utf8'
  );
  assert.doesNotMatch(fuente, /from\s+['"](?:mysql2?|redis|express|node:crypto|node:fs)/);
}
function verificarNormalizacionYRechazos() {
  const configuracion = crearFixtureConfiguracionFederacion({
    origenPublico: 'https://sentinelia.example:8443/'
  });
  assert.equal(configuracion.perfil, PERFIL_CONFIGURACION_FEDERACION);
  assert.equal(configuracion.version, VERSION_CONFIGURACION_FEDERACION);
  assert.equal(configuracion.origenPublico, 'https://sentinelia.example:8443');
  assert.deepEqual(configuracion.proxiesConfiables, [
    '10.0.0.10/32',
    'nginx-federacion'
  ]);
  assert.equal(Object.isFrozen(configuracion.proxiesConfiables), true);
  assert.equal(
    normalizarConfiguracionFederacion(configuracion).origenPublico,
    configuracion.origenPublico
  );

  const configuracionSoloEmision = normalizarConfiguracionFederacion({
    activacionFederacion: true,
    origenPublico: null,
    proxiesConfiables: []
  });
  const capacidadesSoloEmision = proyectarCapacidadesConfiguracionFederacion(
    configuracionSoloEmision
  );
  assert.equal(capacidadesSoloEmision.activacionGlobal, true);
  assert.equal(capacidadesSoloEmision.emisionDisponible, true);
  assert.equal(capacidadesSoloEmision.recepcionPreparada, false);
  assert.deepEqual(capacidadesSoloEmision.bloqueos.emision, []);
  assert.deepEqual(capacidadesSoloEmision.bloqueos.recepcion, [
    BLOQUEOS_CAPACIDADES_CONFIGURACION_FEDERACION.ORIGEN_PUBLICO_AUSENTE,
    BLOQUEOS_CAPACIDADES_CONFIGURACION_FEDERACION.PROXIES_CONFIABLES_AUSENTES
  ]);
  assert.throws(
    () => crearFixtureConfiguracionFederacion({
      origenPublico: 'http://sentinelia.example'
    }),
    (error) =>
      error instanceof ErrorConfiguracionFederacion &&
      error.codigo === 'origen_publico_invalido'
  );
  assert.throws(
    () => crearFixtureConfiguracionFederacion({
      proxiesConfiables: ['*']
    }),
    (error) =>
      error instanceof ErrorConfiguracionFederacion &&
      error.codigo === 'proxy_confiable_invalido'
  );
  assert.throws(
    () => crearFixtureConfiguracionFederacion({
      keyringReferenciaDespliegue: 'token=valor-secreto'
    }),
    (error) =>
      error instanceof ErrorConfiguracionFederacion &&
      error.codigo === 'referencia_keyring_invalida'
  );
  assert.throws(
    () => crearFixtureConfiguracionFederacion({
      loteMaximoBytes: 1024,
      ocurrenciaMaximaBytes: 2048
    }),
    (error) =>
      error instanceof ErrorConfiguracionFederacion &&
      error.codigo === 'limites_recursos_incoherentes'
  );

  let accessorConfiguracionEjecutado = false;
  const configuracionConAccessor = {};
  Object.defineProperty(configuracionConAccessor, 'activacionFederacion', {
    enumerable: true,
    get() {
      accessorConfiguracionEjecutado = true;
      return false;
    }
  });
  assert.throws(
    () => normalizarConfiguracionFederacion(configuracionConAccessor),
    (error) =>
      error instanceof ErrorConfiguracionFederacion &&
      error.codigo === 'configuracion_invalida'
  );
  assert.equal(accessorConfiguracionEjecutado, false);
}

function verificarCapacidadReceptora() {
  const capacidad = crearFixtureCapacidadReceptoraFederacion();
  assert.equal(
    capacidad.perfil,
    'sentinelia-federacion-capacidad-receptora-v1'
  );
  assert.equal(capacidad.protocoloVersion, VERSION_PROTOCOLO_FEDERACION);
  assert.equal(capacidad.disponible, true);
  assert.equal(capacidad.prioridadOperativaActual, true);
  assert.equal(
    capacidad.maximoBytesPorOcurrencia,
    crearFixtureConfiguracionFederacion().ocurrenciaMaximaBytes
  );
  assert.deepEqual(capacidad.familiasSoportadas, FAMILIAS_FEDERACION.valores);
  assert.deepEqual(capacidad.versionesFamilia, VERSIONES_FAMILIA_FEDERACION);

  const capacidadReordenada = crearDeclaracionCapacidadReceptoraFederacion({
    configuracion: crearFixtureConfiguracionFederacion({
      proxiesConfiables: ['nginx-federacion', '10.0.0.10/32']
    }),
    familiasSoportadas: [...FAMILIAS_FEDERACION.valores].reverse(),
    versionesFamilia: Object.fromEntries(
      Object.entries(VERSIONES_FAMILIA_FEDERACION).reverse()
    ),
    protocoloVersion: VERSION_PROTOCOLO_FEDERACION
  });
  assert.deepEqual(capacidadReordenada.familiasSoportadas, capacidad.familiasSoportadas);
  assert.deepEqual(capacidadReordenada.versionesFamilia, capacidad.versionesFamilia);

  const capacidadDesactivada = crearDeclaracionCapacidadReceptoraFederacion({
    configuracion: normalizarConfiguracionFederacion({}),
    familiasSoportadas: ['monitores'],
    versionesFamilia: { monitores: 1 },
    protocoloVersion: VERSION_PROTOCOLO_FEDERACION,
    disponible: true
  });
  assert.equal(capacidadDesactivada.disponible, false);

  assert.throws(
    () => crearDeclaracionCapacidadReceptoraFederacion({
      configuracion: crearFixtureConfiguracionFederacion(),
      familiasSoportadas: [],
      versionesFamilia: VERSIONES_FAMILIA_FEDERACION,
      protocoloVersion: VERSION_PROTOCOLO_FEDERACION
    }),
    (error) =>
      error instanceof ErrorConfiguracionFederacion &&
      error.codigo === 'familias_soportadas_invalidas'
  );
  assert.throws(
    () => crearDeclaracionCapacidadReceptoraFederacion({
      configuracion: crearFixtureConfiguracionFederacion(),
      familiasSoportadas: ['inventada'],
      versionesFamilia: { inventada: 1 },
      protocoloVersion: VERSION_PROTOCOLO_FEDERACION
    }),
    (error) => error.codigo === 'valor_catalogo_desconocido'
  );
  assert.throws(
    () => crearDeclaracionCapacidadReceptoraFederacion({
      configuracion: crearFixtureConfiguracionFederacion(),
      familiasSoportadas: ['monitores'],
      versionesFamilia: {},
      protocoloVersion: VERSION_PROTOCOLO_FEDERACION
    }),
    (error) =>
      error instanceof ErrorConfiguracionFederacion &&
      error.codigo === 'versiones_familia_incoherentes'
  );
  assert.throws(
    () => crearDeclaracionCapacidadReceptoraFederacion({
      configuracion: crearFixtureConfiguracionFederacion(),
      familiasSoportadas: ['monitores'],
      versionesFamilia: { monitores: 2 },
      protocoloVersion: VERSION_PROTOCOLO_FEDERACION
    }),
    (error) =>
      error instanceof ErrorConfiguracionFederacion &&
      error.codigo === 'version_familia_incompatible'
  );
  assert.throws(
    () => crearDeclaracionCapacidadReceptoraFederacion({
      configuracion: crearFixtureConfiguracionFederacion(),
      familiasSoportadas: ['monitores'],
      versionesFamilia: { monitores: 1 },
      protocoloVersion: 2
    }),
    (error) =>
      error instanceof ErrorConfiguracionFederacion &&
      error.codigo === 'version_protocolo_incompatible'
  );

  let accessorFamiliaEjecutado = false;
  const familiasConAccessor = [];
  Object.defineProperty(familiasConAccessor, '0', {
    enumerable: true,
    get() {
      accessorFamiliaEjecutado = true;
      return 'monitores';
    }
  });
  familiasConAccessor.length = 1;
  assert.throws(
    () => crearDeclaracionCapacidadReceptoraFederacion({
      configuracion: crearFixtureConfiguracionFederacion(),
      familiasSoportadas: familiasConAccessor,
      versionesFamilia: { monitores: 1 },
      protocoloVersion: VERSION_PROTOCOLO_FEDERACION
    }),
    (error) =>
      error instanceof ErrorConfiguracionFederacion &&
      error.codigo === 'familias_soportadas_invalidas'
  );
  assert.equal(accessorFamiliaEjecutado, false);

  let accessorVersionEjecutado = false;
  const versionesConAccessor = {};
  Object.defineProperty(versionesConAccessor, 'monitores', {
    enumerable: true,
    get() {
      accessorVersionEjecutado = true;
      return 1;
    }
  });
  assert.throws(
    () => crearDeclaracionCapacidadReceptoraFederacion({
      configuracion: crearFixtureConfiguracionFederacion(),
      familiasSoportadas: ['monitores'],
      versionesFamilia: versionesConAccessor,
      protocoloVersion: VERSION_PROTOCOLO_FEDERACION
    }),
    (error) =>
      error instanceof ErrorConfiguracionFederacion &&
      error.codigo === 'versiones_familia_invalidas'
  );
  assert.equal(accessorVersionEjecutado, false);
}

function verificarRecursosAcotados() {
  const envolvente = crearFixtureEnvolventeFederacion();
  const medida = medirRecursosCanonicosFederacion(envolvente.toJSON());
  assert.ok(medida.bytesCanonicos > 0);
  const resumen = validarRecursosLoteFederacion({
    ocurrencias: [envolvente],
    configuracion: crearFixtureConfiguracionFederacion()
  });
  assert.equal(resumen.ocurrencias, 1);
  assert.equal(resumen.detalle.length, 1);
  assert.ok(resumen.bytesCanonicos >= resumen.detalle[0].bytesCanonicos);

  let materializaciones = 0;
  const ocurrenciaConToJson = {
    toJSON() {
      materializaciones += 1;
      return {
        contenido: 'x'.repeat(materializaciones === 1 ? 10 : 2048)
      };
    }
  };
  const resumenEstable = validarRecursosLoteFederacion({
    ocurrencias: [ocurrenciaConToJson],
    configuracion: crearFixtureConfiguracionFederacion({
      ocurrenciaMaximaBytes: 512,
      loteMaximoBytes: 4096
    })
  });
  assert.equal(materializaciones, 1);
  assert.equal(
    resumenEstable.detalle[0].bytesCanonicos,
    resumenEstable.bytesCanonicos - 2
  );

  const materializacionesIncrementales = [0, 0, 0];
  const ocurrenciasIncrementales = materializacionesIncrementales.map(
    (_contador, indice) => ({
      toJSON() {
        materializacionesIncrementales[indice] += 1;
        return { contenido: 'x'.repeat(600) };
      }
    })
  );
  assert.throws(
    () => validarRecursosLoteFederacion({
      ocurrencias: ocurrenciasIncrementales,
      configuracion: crearFixtureConfiguracionFederacion({
        ocurrenciaMaximaBytes: 1024,
        loteMaximoBytes: 1024
      })
    }),
    (error) =>
      error instanceof ErrorConfiguracionFederacion &&
      error.codigo === 'lote_excede_limites'
  );
  assert.deepEqual(materializacionesIncrementales, [1, 1, 0]);

  const loteMultibyte = [
    { contenido: 'ámbito' },
    { contenido: 'telemetría', estado: null }
  ];
  const resumenMultibyte = validarRecursosLoteFederacion({
    ocurrencias: loteMultibyte,
    configuracion: crearFixtureConfiguracionFederacion()
  });
  assert.equal(
    resumenMultibyte.bytesCanonicos,
    medirRecursosCanonicosFederacion(loteMultibyte).bytesCanonicos
  );

  let accessorLoteEjecutado = false;
  const loteConAccessor = [];
  Object.defineProperty(loteConAccessor, '0', {
    enumerable: true,
    get() {
      accessorLoteEjecutado = true;
      return envolvente;
    }
  });
  loteConAccessor.length = 1;
  assert.throws(
    () => validarRecursosLoteFederacion({
      ocurrencias: loteConAccessor,
      configuracion: crearFixtureConfiguracionFederacion()
    }),
    (error) =>
      error instanceof ErrorConfiguracionFederacion &&
      error.codigo === 'lote_invalido'
  );
  assert.equal(accessorLoteEjecutado, false);

  let accessorToJsonEjecutado = false;
  const ocurrenciaConAccessorToJson = {};
  Object.defineProperty(ocurrenciaConAccessorToJson, 'toJSON', {
    enumerable: true,
    get() {
      accessorToJsonEjecutado = true;
      return () => ({ contenido: true });
    }
  });
  assert.throws(
    () => validarRecursosLoteFederacion({
      ocurrencias: [ocurrenciaConAccessorToJson],
      configuracion: crearFixtureConfiguracionFederacion()
    }),
    (error) =>
      error instanceof ErrorConfiguracionFederacion &&
      error.codigo === 'ocurrencia_invalida'
  );
  assert.equal(accessorToJsonEjecutado, false);

  let ocurrenciaConPrototipoCiclico;
  ocurrenciaConPrototipoCiclico = new Proxy({}, {
    getPrototypeOf() {
      return ocurrenciaConPrototipoCiclico;
    }
  });
  assert.throws(
    () => validarRecursosLoteFederacion({
      ocurrencias: [ocurrenciaConPrototipoCiclico],
      configuracion: crearFixtureConfiguracionFederacion()
    }),
    (error) =>
      error instanceof ErrorConfiguracionFederacion &&
      error.codigo === 'ocurrencia_invalida'
  );

  assert.throws(
    () => validarRecursosLoteFederacion({
      ocurrencias: [
        crearFixtureEnvolventeFederacion({
          campoGrande: 'x'.repeat(2048)
        })
      ],
      configuracion: crearFixtureConfiguracionFederacion({
        ocurrenciaMaximaBytes: 1024,
        loteMaximoBytes: 4096
      })
    }),
    (error) =>
      error instanceof ErrorConfiguracionFederacion &&
      error.codigo === 'ocurrencia_excede_limite'
  );
  assert.throws(
    () => validarRecursosLoteFederacion({
      ocurrencias: [envolvente, crearFixtureEnvolventeFederacion()],
      configuracion: crearFixtureConfiguracionFederacion({
        loteMaximoOcurrencias: 1
      })
    }),
    (error) =>
      error instanceof ErrorConfiguracionFederacion &&
      error.codigo === 'lote_excede_limites'
  );
}

function verificarRecorridoSinLimiteSemantico() {
  const envolventeLarga = crearFixtureEnvolventeFederacion({
    instalacionesEnRecorrido: 300
  });
  assert.equal(envolventeLarga.toJSON().recorridoInstalaciones.length, 300);
  const resumen = validarRecursosLoteFederacion({
    ocurrencias: [envolventeLarga],
    configuracion: crearFixtureConfiguracionFederacion({
      loteMaximoBytes: LIMITES_DUROS_RECURSOS_FEDERACION.loteMaximoBytes,
      ocurrenciaMaximaBytes:
        LIMITES_DUROS_RECURSOS_FEDERACION.ocurrenciaMaximaBytes
    })
  });
  assert.equal(resumen.ocurrencias, 1);
  assert.ok(resumen.detalle[0].bytesCanonicos > 10000);
}
