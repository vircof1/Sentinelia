import assert from 'node:assert/strict';
import {
  CAUSAS_OMISION_CAMPO_FEDERADO,
  CATALOGOS_FEDERACION,
  DECISIONES_RETENCION_FEDERACION,
  DIRECCIONES_FEDERACION,
  ERRORES_TEMPORALES_FEDERACION,
  ERRORES_TERMINALES_FEDERACION,
  ErrorCatalogoFederacion,
  ESTADOS_CAMPO_FEDERADO,
  ESTADOS_REQUISITO_COMPLETITUD_FEDERACION,
  FAMILIAS_FEDERACION,
  NIVELES_SCOPE_FEDERACION,
  PERFIL_CATALOGOS_FEDERACION,
  SENSIBILIDADES_CAMPO_FEDERADO,
  VERSION_CATALOGOS_FEDERACION,
  VERSION_PROTOCOLO_FEDERACION,
  VERSIONES_FAMILIA_FEDERACION,
  exigirValorCatalogoFederacion,
  obtenerCatalogoFederacion
} from '../paquetes/federacion/src/index.js';

await verificarPerfilVersionado();
verificarCatalogosCerrados();
verificarRechazos();
verificarClasificacionErrores();

console.log(
  '[federacion] OK 5.22.9c: perfil=v1 catalogos=' +
    `${Object.keys(CATALOGOS_FEDERACION).length} ` +
    `familias=${FAMILIAS_FEDERACION.valores.length} desconocidos=rechazados`
);

async function verificarPerfilVersionado() {
  assert.equal(VERSION_PROTOCOLO_FEDERACION, 1);
  assert.equal(VERSION_CATALOGOS_FEDERACION, 1);
  assert.equal(
    PERFIL_CATALOGOS_FEDERACION,
    'sentinelia-federacion-catalogos-v1'
  );
  assert.ok(Object.isFrozen(CATALOGOS_FEDERACION));
  assert.ok(Object.isFrozen(VERSIONES_FAMILIA_FEDERACION));
  assert.deepEqual(Object.keys(VERSIONES_FAMILIA_FEDERACION), [
    'estructuraOrganizativa',
    'monitores',
    'telemetria',
    'triggersInformativos',
    'auditoria',
    'avisosFederados',
    'contextoOperativoAgentesSesiones'
  ]);
  assert.equal(VERSIONES_FAMILIA_FEDERACION.triggersInformativos, 2);
  assert.ok(Object.entries(VERSIONES_FAMILIA_FEDERACION).every(
    ([familia, version]) => version === (
      familia === 'triggersInformativos' ? 2 : 1
    )
  ));
}
function verificarCatalogosCerrados() {
  assert.equal(Object.keys(CATALOGOS_FEDERACION).length, 27);
  for (const [nombre, catalogo] of Object.entries(CATALOGOS_FEDERACION)) {
    assert.equal(catalogo, obtenerCatalogoFederacion(nombre));
    assert.equal(catalogo.nombre, nombre);
    assert.equal(catalogo.version, VERSION_CATALOGOS_FEDERACION);
    assert.ok(Object.isFrozen(catalogo));
    assert.ok(Object.isFrozen(catalogo.valores));
    assert.equal(new Set(catalogo.valores).size, catalogo.valores.length);
    for (const valor of catalogo.valores) {
      assert.equal(catalogo.contiene(valor), true);
      assert.equal(catalogo.exigir(valor), valor);
    }
    assert.deepEqual(catalogo.toJSON(), {
      nombre,
      version: VERSION_CATALOGOS_FEDERACION,
      valores: catalogo.valores
    });
  }

  assert.throws(() => CATALOGOS_FEDERACION.nuevo = DIRECCIONES_FEDERACION);
  assert.throws(() => DIRECCIONES_FEDERACION.valores.push('ambas'));
  assert.deepEqual(DIRECCIONES_FEDERACION.valores, ['emision', 'recepcion']);
  assert.deepEqual(ESTADOS_CAMPO_FEDERADO.valores, [
    'presente',
    'omitido',
    'retirado'
  ]);
  assert.deepEqual(CAUSAS_OMISION_CAMPO_FEDERADO.valores, [
    'omitidoPorSeleccion',
    'protegido',
    'noAutorizado',
    'ausenteEnOrigen'
  ]);
  assert.deepEqual(SENSIBILIDADES_CAMPO_FEDERADO.valores, [
    'ordinario',
    'sensible'
  ]);
  assert.deepEqual(NIVELES_SCOPE_FEDERACION.valores, [
    'portal',
    'tenant',
    'empresa',
    'sitio'
  ]);
  assert.deepEqual(ESTADOS_REQUISITO_COMPLETITUD_FEDERACION.valores, [
    'cumplido',
    'noAplicable',
    'faltante',
    'fallido'
  ]);
  assert.deepEqual(DECISIONES_RETENCION_FEDERACION.valores, [
    'conservar',
    'conservarMinimoOperativo',
    'eliminarContenido',
    'compactarEvidencia'
  ]);
}

function verificarRechazos() {
  const casosDesconocidos = [
    'Emision',
    'emisión',
    ' emision',
    'emision ',
    '',
    null,
    1,
    {}
  ];
  for (const valor of casosDesconocidos) {
    assert.equal(DIRECCIONES_FEDERACION.contiene(valor), false);
    assert.throws(
      () => DIRECCIONES_FEDERACION.exigir(valor, { campo: 'direccion' }),
      (error) =>
        error instanceof ErrorCatalogoFederacion &&
        error.codigo === 'valor_catalogo_desconocido' &&
        error.catalogo === 'direcciones' &&
        error.valor === valor
    );
  }

  assert.equal(
    exigirValorCatalogoFederacion('direcciones', 'emision'),
    'emision'
  );
  assert.throws(
    () => obtenerCatalogoFederacion('familia'),
    (error) =>
      error instanceof ErrorCatalogoFederacion &&
      error.codigo === 'catalogo_desconocido'
  );

  // Un valor legítimo no puede cruzar otra frontera semántica por ser texto.
  assert.throws(
    () => FAMILIAS_FEDERACION.exigir('emision'),
    (error) => error.codigo === 'valor_catalogo_desconocido'
  );
  assert.throws(
    () => DIRECCIONES_FEDERACION.exigir('telemetria'),
    (error) => error.codigo === 'valor_catalogo_desconocido'
  );
  assert.throws(
    () => obtenerCatalogoFederacion('estadosGeneracion').exigir('degradado'),
    (error) => error.codigo === 'valor_catalogo_desconocido'
  );
  assert.equal(
    obtenerCatalogoFederacion('estadosGeneracion').exigir('degradada'),
    'degradada'
  );
}

function verificarClasificacionErrores() {
  const terminales = new Set(ERRORES_TERMINALES_FEDERACION.valores);
  const temporales = new Set(ERRORES_TEMPORALES_FEDERACION.valores);
  assert.equal(
    [...terminales].some((codigo) => temporales.has(codigo)),
    false
  );
  assert.ok(terminales.has('versionProtocoloIncompatible'));
  assert.ok(terminales.has('versionFamiliaIncompatible'));
  assert.ok(terminales.has('recorridoCiclicoDestino'));
  assert.ok(temporales.has('capacidadTemporalAgotada'));
  assert.ok(temporales.has('dependenciaValidacionTemporal'));
}
