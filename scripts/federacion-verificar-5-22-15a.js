import assert from 'node:assert/strict';

import {
  CONTRATOS_ADAPTADORES_FAMILIA_FEDERACION,
  ErrorAdaptadoresFamiliasFederacion,
  ErrorDependenciasFamiliasFederacion,
  GrafoDependenciasFamiliasFederacion,
  PERFIL_GRAFO_DEPENDENCIAS_FAMILIAS_FEDERACION,
  PERFIL_REGISTRO_ADAPTADORES_FAMILIAS_FEDERACION,
  RegistroAdaptadoresFamiliasFederacion,
  VERSION_GRAFO_DEPENDENCIAS_FAMILIAS_FEDERACION,
  VERSION_REGISTRO_ADAPTADORES_FAMILIAS_FEDERACION,
  crearAdaptadorFamiliaFederacion
} from '../paquetes/federacion/src/index.js';
import {
  ejecutarMiniRutaCriticaFamiliaFederacion
} from '../paquetes/federacion/fixtures/HarnessFamiliasFederacion.js';

await main();

async function main() {
  verificarContratosComunes();
  verificarGrafoDependencias();
  verificarRegistroVersionadoYActivacion();
  await verificarMiniRutaCritica();
  console.log(
    '[federacion] OK 5.22.15a: registro=versionado dependencias=cierre_obligatorio ' +
    'opcionales=opacas interfaces=5 mini_ruta=verificada familias_productivas=0'
  );
}

function verificarContratosComunes() {
  assert.equal(VERSION_REGISTRO_ADAPTADORES_FAMILIAS_FEDERACION, 1);
  assert.equal(VERSION_GRAFO_DEPENDENCIAS_FAMILIAS_FEDERACION, 1);
  assert.equal(
    PERFIL_REGISTRO_ADAPTADORES_FAMILIAS_FEDERACION,
    'sentinelia-federacion-adaptadores-familias-v1'
  );
  assert.equal(
    PERFIL_GRAFO_DEPENDENCIAS_FAMILIAS_FEDERACION,
    'sentinelia-federacion-dependencias-familias-v1'
  );
  assert.deepEqual(
    Object.keys(CONTRATOS_ADAPTADORES_FAMILIA_FEDERACION),
    ['captura', 'fotografiaInicial', 'payload', 'retirada', 'materializacion']
  );
  assert.equal(Object.isFrozen(CONTRATOS_ADAPTADORES_FAMILIA_FEDERACION), true);
  assert.equal(
    CONTRATOS_ADAPTADORES_FAMILIA_FEDERACION.captura.transaccion,
    'requerida'
  );
  assert.equal(
    CONTRATOS_ADAPTADORES_FAMILIA_FEDERACION.payload.transaccion,
    'ninguna'
  );
}

function verificarGrafoDependencias() {
  const grafo = crearGrafo();
  assert.deepEqual(
    grafo.resolverCierre(['telemetria']),
    [
      'estructuraOrganizativa',
      'contextoOperativoAgentesSesiones',
      'telemetria'
    ]
  );
  assert.deepEqual(
    grafo.resolverCierre(['telemetria'], { incluirOpcionales: true }),
    [
      'estructuraOrganizativa',
      'contextoOperativoAgentesSesiones',
      'monitores',
      'telemetria'
    ]
  );
  assert.equal(grafo.obtener('auditoria').dependencias.length, 0);
  assert.equal(Object.isFrozen(grafo.toJSON()), true);
  assert.throws(
    () => new GrafoDependenciasFamiliasFederacion({
      declaraciones: [
        declaracion('monitores', [
          dependencia('telemetria', 'obligatoria', ['observable'])
        ]),
        declaracion('telemetria', [
          dependencia('monitores', 'obligatoria', ['observable'])
        ])
      ]
    }),
    (error) => error instanceof ErrorDependenciasFamiliasFederacion &&
      error.codigo === 'ciclo_dependencias_obligatorias'
  );
  const opcionalCiclico = new GrafoDependenciasFamiliasFederacion({
    declaraciones: [
      declaracion('monitores', [
        dependencia('triggersInformativos', 'opcional', ['reconstruible'])
      ]),
      declaracion('triggersInformativos', [
        dependencia('monitores', 'opcional', ['interpretable'])
      ])
    ]
  });
  assert.deepEqual(opcionalCiclico.resolverCierre(['monitores']), ['monitores']);
}

function verificarRegistroVersionadoYActivacion() {
  const parcial = crearAdaptadorFamiliaFederacion({
    familia: 'estructuraOrganizativa',
    versionFamilia: 2,
    perfilPayload: 'fixture-organizacion-v2',
    interfaces: { payload: crearInterfacesFixture().payload }
  });
  assert.equal(parcial.completo, false);
  assert.equal(parcial.productivo, false);
  assert.deepEqual(parcial.interfacesDisponibles, ['payload']);
  assert.throws(
    () => crearAdaptadorFamiliaFederacion({
      familia: 'estructuraOrganizativa',
      versionFamilia: 1,
      perfilPayload: 'fixture-incompleto-v1',
      productivo: true,
      interfaces: { payload: crearInterfacesFixture().payload }
    }),
    (error) => error instanceof ErrorAdaptadoresFamiliasFederacion &&
      error.codigo === 'adaptador_productivo_incompleto'
  );
  const registroParcial = new RegistroAdaptadoresFamiliasFederacion({
    adaptadores: [{
      familia: 'estructuraOrganizativa',
      versionFamilia: 2,
      perfilPayload: 'fixture-organizacion-v2',
      interfaces: { payload: crearInterfacesFixture().payload }
    }]
  });
  assert.equal(
    registroParcial.obtenerEnConstruccion({
      familia: 'estructuraOrganizativa',
      versionFamilia: 2
    }).perfilPayload,
    'fixture-organizacion-v2'
  );
  assert.throws(
    () => registroParcial.obtener({
      familia: 'estructuraOrganizativa',
      versionFamilia: 2,
      exigirProductivo: false
    }),
    (error) => error.codigo === 'adaptador_familia_no_productivo'
  );
  assert.throws(
    () => registroParcial.obtenerEnConstruccion({
      familia: 'estructuraOrganizativa',
      versionFamilia: 1
    }),
    (error) => error.codigo === 'adaptador_familia_no_registrado'
  );
  assert.throws(
    () => new RegistroAdaptadoresFamiliasFederacion({
      grafoDependencias: crearGrafo(),
      adaptadores: [definicionProductiva('telemetria')]
    }),
    (error) => error.codigo === 'dependencia_productiva_ausente'
  );
  const registro = crearRegistroProductivo();
  assert.deepEqual(
    registro.resolverCierreProductivo(['telemetria']).map(
      (adaptador) => adaptador.familia
    ),
    [
      'estructuraOrganizativa',
      'contextoOperativoAgentesSesiones',
      'telemetria'
    ]
  );
  assert.equal(registro.listar({ soloProductivos: true }).length, 3);
  assert.equal(Object.isFrozen(registro.toJSON()), true);
}

async function verificarMiniRutaCritica() {
  const llamadas = [];
  const interfaces = crearInterfacesFixture(llamadas);
  const registro = new RegistroAdaptadoresFamiliasFederacion({
    adaptadores: [definicionProductiva('estructuraOrganizativa', interfaces)]
  });
  const conexion = Object.freeze({ id: 'conexion-compartida-fixture' });
  const resultado = await ejecutarMiniRutaCriticaFamiliaFederacion({
    registro,
    familia: 'estructuraOrganizativa',
    versionFamilia: 1,
    escenario: {
      solicitudFotografia: { scope: 'empresa-a' },
      cambio: { id: 'empresa-a', nombre: 'Empresa A' },
      retirada: { id: 'empresa-a', causa: 'eliminadaEnOrigen' },
      contextoMaterializacion: { proyeccionId: 'remota-empresa-a' },
      contextoTransaccional: { conexion }
    }
  });
  assert.deepEqual(llamadas, [
    ['fotografia', conexion],
    ['captura', conexion],
    ['payload', 'actualizacion'],
    ['materializacion', 'actualizacion', conexion],
    ['retirada', conexion],
    ['materializacion', 'retirada', conexion]
  ]);
  assert.equal(resultado.captura.payload.nombre, 'Empresa A');
  assert.equal(resultado.materializacion.estado, 'materializada');
  assert.equal(resultado.materializacionRetirada.estado, 'retirada');
  assert.equal(Object.isFrozen(resultado), true);
  assert.equal(Object.isFrozen(resultado.payloadActualizacion), true);
}

function crearGrafo() {
  return new GrafoDependenciasFamiliasFederacion({
    declaraciones: [
      declaracion('estructuraOrganizativa', []),
      declaracion('contextoOperativoAgentesSesiones', [
        dependencia('estructuraOrganizativa', 'obligatoria', ['interpretable'])
      ]),
      declaracion('telemetria', [
        dependencia(
          'contextoOperativoAgentesSesiones',
          'obligatoria',
          ['interpretable', 'observable']
        ),
        dependencia('estructuraOrganizativa', 'obligatoria', ['interpretable']),
        dependencia('monitores', 'opcional', ['observable'])
      ])
    ]
  });
}

function crearRegistroProductivo() {
  return new RegistroAdaptadoresFamiliasFederacion({
    grafoDependencias: crearGrafo(),
    adaptadores: [
      definicionProductiva('estructuraOrganizativa'),
      definicionProductiva('contextoOperativoAgentesSesiones'),
      definicionProductiva('telemetria')
    ]
  });
}

function definicionProductiva(familia, interfaces = crearInterfacesFixture()) {
  return {
    familia,
    versionFamilia: 1,
    perfilPayload: `fixture-${familia}-v1`,
    productivo: true,
    interfaces
  };
}

function crearInterfacesFixture(llamadas = []) {
  return {
    captura: {
      marca: 'captura',
      prepararCapturaEnTransaccion(cambio, { conexion }) {
        assert.equal(this.marca, 'captura');
        llamadas.push(['captura', conexion]);
        return { payload: { ...cambio, tipo: 'nodoOrganizativo' } };
      }
    },
    fotografiaInicial: {
      marca: 'fotografia',
      listarCapturasEnTransaccion(solicitud, { conexion }) {
        assert.equal(this.marca, 'fotografia');
        llamadas.push(['fotografia', conexion]);
        return [{ payload: { id: solicitud.scope, nombre: 'Fotografía' } }];
      }
    },
    payload: {
      marca: 'payload',
      validarPayload(payload, { operacion }) {
        assert.equal(this.marca, 'payload');
        llamadas.push(['payload', operacion]);
        assert.ok(payload && typeof payload === 'object');
        return Object.freeze({ ...payload, operacionValidada: operacion });
      }
    },
    retirada: {
      marca: 'retirada',
      prepararRetiradaEnTransaccion(retirada, { conexion }) {
        assert.equal(this.marca, 'retirada');
        llamadas.push(['retirada', conexion]);
        return { ...retirada, operacion: 'retirada' };
      }
    },
    materializacion: {
      marca: 'materializacion',
      materializarEnTransaccion({ operacion, payload }, { conexion }) {
        assert.equal(this.marca, 'materializacion');
        llamadas.push(['materializacion', operacion, conexion]);
        if (operacion === 'actualizacion') {
          assert.equal(payload.operacionValidada, operacion);
        } else {
          assert.equal(payload, null);
        }
        return {
          estado: operacion === 'retirada' ? 'retirada' : 'materializada'
        };
      }
    }
  };
}

function declaracion(familia, dependencias) {
  return { familia, dependencias };
}

function dependencia(familia, tipo, capacidades) {
  return { familia, tipo, capacidades };
}
