import assert from 'node:assert/strict';

import {
  ErrorAutoridadFederacion,
  ErrorScopeFederacion,
  TIPOS_IDENTIDAD_FEDERADA,
  calcularConcesionEfectivaFederacion,
  calcularPoliticaRetencionEfectivaFederacion,
  calcularVigenciaEfectivaFederacion,
  crearDeclaracionConcesionFederacion,
  crearLimitesAutoridadActualFederacion,
  crearResponsabilidadFederada,
  crearIdentidadFederada,
  crearScopeFederacion,
  esConcesionEfectivaFederacion,
  esDeclaracionConcesionFederacion,
  esLimiteAutoridadActualFederacion,
  esResponsabilidadFederada,
  esScopeFederacion,
  evaluarAutoridadResponsabilidadFederada,
  evaluarCompletitudFederacion,
  evaluarDimensionesProyeccionFederada,
  evaluarRetencionDatoFederado,
  profundidadFederablePorScope,
  profundidadScopeFederacion,
  puedeMaterializarEnScopeFederacion,
  puedeVerScopeFederacion,
  scopeFederacionCubre
} from '../paquetes/federacion/src/index.js';

const scopes = crearScopesFixture();
const identidadesContribucion = new Map();

verificarTablaProfundidades();
verificarRamasYVisibilidad();
verificarResponsabilidadYAutoridadActual();
verificarMatrizAnclajeLocalYProfundidadRemota();
verificarInterseccionBilateral();
verificarCompletitudOrtogonal();
verificarVigenciaAcumulada();
verificarSoporteYDimensiones();
verificarRetencionEfectiva();

console.log(
  '[federacion] OK 5.22.9e: scope=16_casos autoridad=16_anclajes ' +
    'concesion=interseccion dimensiones=ortogonales retencion=mas_restrictiva'
);

function verificarTablaProfundidades() {
  const niveles = ['portal', 'tenant', 'empresa', 'sitio'];
  const scopesAutoridad = [
    scopes.portal,
    scopes.tenant1,
    scopes.empresa1,
    scopes.sitio1
  ];
  assert.deepEqual(scopesAutoridad.map(profundidadScopeFederacion), [0, 1, 2, 3]);
  for (const [indiceAutoridad, scopeAutoridad] of scopesAutoridad.entries()) {
    for (const [indiceFederado, nivelFederado] of niveles.entries()) {
      assert.equal(
        profundidadFederablePorScope({ scopeAutoridad, nivelFederado }),
        indiceFederado >= indiceAutoridad,
        `${niveles[indiceAutoridad]} -> ${nivelFederado}`
      );
    }
  }
  assert.throws(
    () => crearScopeFederacion({ nivel: 'empresa', tenantId: 't1' }),
    (error) =>
      error instanceof ErrorScopeFederacion &&
      error.codigo === 'identidad_scope_requerida'
  );
  assert.throws(
    () => crearScopeFederacion({ nivel: 'tenant', tenantId: 't1', empresaId: 'e1' }),
    (error) =>
      error instanceof ErrorScopeFederacion &&
      error.codigo === 'identidad_scope_fuera_nivel'
  );
  assert.throws(
    () => crearScopeFederacion({
      nivel: 'tenant',
      tenantId: 't1',
      etiquetaInterpretativa: 'no contractual'
    }),
    (error) =>
      error instanceof ErrorScopeFederacion &&
      error.codigo === 'campo_scope_desconocido'
  );
  assert.throws(
    () => crearScopeFederacion({ nivel: 'tenant', tenantId: '   ' }),
    (error) =>
      error instanceof ErrorScopeFederacion &&
      error.codigo === 'identidad_scope_requerida'
  );

  const scopeFalsificado = Object.create(Object.getPrototypeOf(scopes.portal));
  assert.equal(esScopeFederacion(scopeFalsificado), false);
  assert.throws(
    () => profundidadScopeFederacion(scopeFalsificado),
    (error) =>
      error instanceof ErrorScopeFederacion && error.codigo === 'scope_invalido'
  );
}

function verificarRamasYVisibilidad() {
  const tabla = [
    [scopes.portal, scopes.sitio1, true],
    [scopes.tenant1, scopes.tenant1, true],
    [scopes.tenant1, scopes.empresa1, true],
    [scopes.tenant1, scopes.sitio1, true],
    [scopes.tenant1, scopes.tenant2, false],
    [scopes.empresa1, scopes.sitio1, true],
    [scopes.empresa1, scopes.empresa2, false],
    [scopes.sitio1, scopes.empresa1, false],
    [scopes.sitio1, scopes.sitio1, true]
  ];
  for (const [superior, objetivo, esperado] of tabla) {
    assert.equal(scopeFederacionCubre(superior, objetivo), esperado);
    assert.equal(
      puedeVerScopeFederacion({ scopeUsuario: superior, scopeRecurso: objetivo }),
      esperado
    );
    assert.equal(
      puedeMaterializarEnScopeFederacion({
        scopeAutoridad: superior,
        scopeLocalMaterializado: objetivo
      }),
      esperado
    );
  }
  // La coincidencia de profundidad entre instalaciones no implica misma rama.
  assert.equal(profundidadScopeFederacion(scopes.empresa1), 2);
  assert.equal(profundidadScopeFederacion(scopes.empresa2), 2);
  assert.equal(scopeFederacionCubre(scopes.empresa1, scopes.empresa2), false);
}

function verificarResponsabilidadYAutoridadActual() {
  const responsabilidad = crearResponsabilidadFederada({
    usuarioId: 'usuario-tenant-1',
    scopeActual: scopes.tenant1,
    permisos: ['federacionEmitir']
  });
  assert.equal(esResponsabilidadFederada(responsabilidad), true);
  const casos = [
    {
      responsabilidad,
      scopeLocalMaterializado: scopes.empresa1,
      nivelFederado: 'empresa',
      permisoRequerido: 'federacionEmitir',
      autorizada: true,
      causas: []
    },
    {
      responsabilidad: crearResponsabilidadFederada({
        usuarioId: 'usuario-inactivo',
        activa: false,
        scopeActual: scopes.tenant1,
        permisos: ['federacionEmitir']
      }),
      scopeLocalMaterializado: scopes.empresa1,
      nivelFederado: 'empresa',
      permisoRequerido: 'federacionEmitir',
      autorizada: false,
      causas: ['responsableInactivo']
    },
    {
      responsabilidad,
      scopeLocalMaterializado: scopes.empresa2,
      nivelFederado: 'empresa',
      permisoRequerido: 'federacionEmitir',
      autorizada: false,
      causas: ['scopeLocalFueraDeAutoridad']
    },
    {
      responsabilidad,
      scopeLocalMaterializado: scopes.tenant1,
      nivelFederado: 'portal',
      permisoRequerido: 'federacionEmitir',
      autorizada: false,
      causas: ['profundidadFederadaNoDelegable']
    },
    {
      responsabilidad,
      scopeLocalMaterializado: scopes.tenant1,
      nivelFederado: 'tenant',
      permisoRequerido: 'federacionRecibir',
      autorizada: false,
      causas: ['permisoActualAusente']
    }
  ];
  for (const caso of casos) {
    const resultado = evaluarAutoridadResponsabilidadFederada(caso);
    assert.equal(resultado.autorizada, caso.autorizada);
    assert.deepEqual(resultado.causas, caso.causas);
  }
  assert.equal(responsabilidad.toJSON().scopeActual.nivel, 'tenant');
  assert.throws(() => responsabilidad.toJSON().activa = false);

  let accessorPermisoEjecutado = false;
  const permisosConAccessor = [];
  Object.defineProperty(permisosConAccessor, '0', {
    enumerable: true,
    get() {
      accessorPermisoEjecutado = true;
      return 'federacionEmitir';
    }
  });
  permisosConAccessor.length = 1;
  assert.throws(
    () => crearResponsabilidadFederada({
      usuarioId: 'usuario-accessor',
      scopeActual: scopes.portal,
      permisos: permisosConAccessor
    }),
    (error) =>
      error instanceof ErrorAutoridadFederacion &&
      error.codigo === 'lista_textos_invalida'
  );
  assert.equal(accessorPermisoEjecutado, false);

  const responsabilidadFalsificada = Object.create(
    Object.getPrototypeOf(responsabilidad)
  );
  assert.equal(esResponsabilidadFederada(responsabilidadFalsificada), false);
  assert.throws(
    () => evaluarAutoridadResponsabilidadFederada({
      responsabilidad: responsabilidadFalsificada,
      scopeLocalMaterializado: scopes.portal,
      nivelFederado: 'portal',
      permisoRequerido: 'federacionEmitir'
    }),
    (error) =>
      error instanceof ErrorAutoridadFederacion &&
      error.codigo === 'responsabilidad_invalida'
  );
}

function verificarMatrizAnclajeLocalYProfundidadRemota() {
  const niveles = ['portal', 'tenant', 'empresa', 'sitio'];
  const scopesRama = [
    scopes.portal,
    scopes.tenant1,
    scopes.empresa1,
    scopes.sitio1
  ];
  for (const [indiceResponsable, scopeActual] of scopesRama.entries()) {
    const responsabilidad = crearResponsabilidadFederada({
      usuarioId: `usuario-matriz-${niveles[indiceResponsable]}`,
      scopeActual,
      permisos: ['federacionEmitir']
    });
    for (const scopeLocalConfiguracion of scopesRama) {
      const cubreAnclaje = scopeFederacionCubre(
        scopeActual,
        scopeLocalConfiguracion
      );
      const limitesActuales = crearLimitesAutoridadActualFederacion({
        responsabilidad,
        permisoRequerido: 'federacionEmitir',
        scopeLocalConfiguracion,
        nivelesScope: niveles,
        familias: {
          monitores: limites(['estado'], false, false)
        }
      }).toJSON();
      assert.equal(limitesActuales.activa, cubreAnclaje);
      assert.deepEqual(
        limitesActuales.nivelesScope,
        cubreAnclaje ? niveles.slice(indiceResponsable) : []
      );
    }
  }
}

function verificarInterseccionBilateral() {
  let accessorFamiliaEjecutado = false;
  const familiasConAccessor = {};
  Object.defineProperty(familiasConAccessor, 'monitores', {
    enumerable: true,
    get() {
      accessorFamiliaEjecutado = true;
      return limites(['estado'], false, false);
    }
  });
  assert.throws(
    () => crearDeclaracionConcesionFederacion({
      nivelesScope: ['tenant'],
      familias: familiasConAccessor
    }),
    (error) =>
      error instanceof ErrorAutoridadFederacion &&
      error.codigo === 'familias_invalidas'
  );
  assert.equal(accessorFamiliaEjecutado, false);

  const declaracionValida = declaracion({
    nivelesScope: ['tenant'],
    familias: { monitores: limites(['estado'], false, false) }
  });
  const declaracionFalsificada = Object.create(
    Object.getPrototypeOf(declaracionValida)
  );
  assert.equal(esDeclaracionConcesionFederacion(declaracionFalsificada), false);

  const oferta = declaracion({
    nivelesScope: ['empresa', 'sitio'],
    familias: {
      monitores: limites(['credencial', 'detalle'], true, true),
      telemetria: limites(['historico'], false, true)
    }
  });
  const aceptacion = declaracion({
    nivelesScope: ['empresa', 'sitio'],
    familias: {
      monitores: limites(['credencial', 'detalle', 'etiqueta'], true, false),
      auditoria: limites(['cadena'], false, false)
    }
  });
  const responsabilidadEmisora = crearResponsabilidadFederada({
    usuarioId: 'emisor-tenant',
    scopeActual: scopes.tenant1,
    permisos: ['federacionEmitir']
  });
  const responsabilidadReceptora = crearResponsabilidadFederada({
    usuarioId: 'receptor-empresa',
    scopeActual: scopes.empresa2,
    permisos: ['federacionRecibir']
  });
  const limitesAutoridadEmisora = crearLimitesAutoridadActualFederacion({
    responsabilidad: responsabilidadEmisora,
    permisoRequerido: 'federacionEmitir',
    scopeLocalConfiguracion: scopes.empresa1,
    nivelesScope: ['empresa', 'sitio'],
    familias: {
      monitores: limites(['credencial', 'detalle', 'nuevoPorAmpliacion'], true, true),
      telemetria: limites(['historico'], true, true)
    }
  });
  const limitesAutoridadReceptora = crearLimitesAutoridadActualFederacion({
    responsabilidad: responsabilidadReceptora,
    permisoRequerido: 'federacionRecibir',
    scopeLocalConfiguracion: scopes.empresa2,
    nivelesScope: ['sitio'],
    familias: {
      monitores: limites(['detalle', 'credencial'], false, true)
    }
  });
  const efectiva = calcularConcesionEfectivaFederacion({
    ofertaEmisora: oferta,
    aceptacionReceptora: aceptacion,
    autoridadActualEmisora: limitesAutoridadEmisora,
    autoridadActualReceptora: limitesAutoridadReceptora
  });
  assert.equal(esDeclaracionConcesionFederacion(oferta), true);
  assert.equal(esDeclaracionConcesionFederacion(aceptacion), true);
  assert.equal(esDeclaracionConcesionFederacion(limitesAutoridadEmisora), false);
  assert.equal(esLimiteAutoridadActualFederacion(limitesAutoridadEmisora), true);
  assert.equal(esDeclaracionConcesionFederacion(efectiva), false);
  assert.equal(esConcesionEfectivaFederacion(efectiva), true);
  assert.deepEqual(efectiva.toJSON(), {
    activa: true,
    vacia: false,
    nivelesScope: ['sitio'],
    familias: {
      monitores: {
        campos: ['credencial', 'detalle'],
        permiteContenidoSensible: false,
        permiteRefederacion: false
      }
    }
  });
  assert.equal(
    efectiva.toJSON().familias.monitores.campos.includes('nuevoPorAmpliacion'),
    false
  );
  assert.deepEqual(limitesAutoridadEmisora.toJSON().causas, []);
  assert.deepEqual(
    limitesAutoridadEmisora.toJSON().scopeLocalConfiguracion,
    scopes.empresa1.toJSON()
  );

  const autoridadFueraDeRama = crearLimitesAutoridadActualFederacion({
    responsabilidad: responsabilidadEmisora,
    permisoRequerido: 'federacionEmitir',
    scopeLocalConfiguracion: scopes.empresa2,
    nivelesScope: ['empresa', 'sitio'],
    familias: {
      monitores: limites(['detalle'], false, false)
    }
  });
  assert.equal(autoridadFueraDeRama.toJSON().activa, false);
  assert.deepEqual(autoridadFueraDeRama.toJSON().causas, [
    'scopeLocalFueraDeAutoridad'
  ]);
  assert.deepEqual(autoridadFueraDeRama.toJSON().nivelesScope, []);
  assert.deepEqual(autoridadFueraDeRama.toJSON().familias, {});
  assert.equal(calcularConcesionEfectivaFederacion({
    ofertaEmisora: oferta,
    aceptacionReceptora: aceptacion,
    autoridadActualEmisora: autoridadFueraDeRama,
    autoridadActualReceptora: limitesAutoridadReceptora
  }).toJSON().vacia, true);

  const autoridadAncladaEnSitio = crearLimitesAutoridadActualFederacion({
    responsabilidad: responsabilidadEmisora,
    permisoRequerido: 'federacionEmitir',
    scopeLocalConfiguracion: scopes.sitio1,
    nivelesScope: ['tenant', 'empresa', 'sitio'],
    familias: {
      monitores: limites(['detalle'], false, false)
    }
  });
  assert.equal(autoridadAncladaEnSitio.toJSON().activa, true);
  assert.deepEqual(autoridadAncladaEnSitio.toJSON().nivelesScope, [
    'tenant',
    'empresa',
    'sitio'
  ]);

  assert.throws(
    () => crearLimitesAutoridadActualFederacion({
      responsabilidad: responsabilidadEmisora,
      permisoRequerido: 'federacionEmitir',
      nivelesScope: ['empresa'],
      familias: { monitores: limites(['detalle'], false, false) }
    }),
    (error) => error.codigo === 'scope_configuracion_invalido'
  );
  assert.throws(
    () => calcularConcesionEfectivaFederacion({
      ofertaEmisora: limitesAutoridadEmisora,
      aceptacionReceptora: aceptacion,
      autoridadActualEmisora: limitesAutoridadEmisora,
      autoridadActualReceptora: limitesAutoridadReceptora
    }),
    (error) => error.codigo === 'declaracion_concesion_invalida'
  );
  assert.throws(
    () => calcularConcesionEfectivaFederacion({
      ofertaEmisora: oferta,
      aceptacionReceptora: efectiva,
      autoridadActualEmisora: limitesAutoridadEmisora,
      autoridadActualReceptora: limitesAutoridadReceptora
    }),
    (error) => error.codigo === 'declaracion_concesion_invalida'
  );
  assert.throws(
    () => calcularConcesionEfectivaFederacion({
      ofertaEmisora: oferta,
      aceptacionReceptora: aceptacion,
      autoridadActualEmisora: declaracion({
        nivelesScope: ['portal', 'tenant', 'empresa', 'sitio'],
        familias: { monitores: limites(['credencial'], true, true) }
      }),
      autoridadActualReceptora: limitesAutoridadReceptora
    }),
    (error) => error.codigo === 'autoridad_actual_invalida'
  );

  const reducida = calcularConcesionEfectivaFederacion({
    ofertaEmisora: oferta,
    aceptacionReceptora: declaracion({
      activa: false,
      nivelesScope: ['empresa', 'sitio'],
      familias: { monitores: limites(['detalle'], false, false) }
    }),
    autoridadActualEmisora: limitesAutoridadEmisora,
    autoridadActualReceptora: limitesAutoridadReceptora
  });
  assert.deepEqual(reducida.toJSON(), {
    activa: false,
    vacia: true,
    nivelesScope: [],
    familias: {}
  });
  // La intersección vacía no altera identidad, autenticación ni relación: solo
  // declara que no existe conjunto efectivo; esas dimensiones viven fuera.
  assert.equal(reducida.toJSON().vacia, true);
}

function verificarCompletitudOrtogonal() {
  const completitud = evaluarCompletitudFederacion({
    interpretable: [
      requisito('identidad', 'cumplido'),
      requisito('triggerOpacoPermitido', 'noAplicable')
    ],
    observable: [
      requisito('estadoActual', 'cumplido'),
      requisito('historicoComprometido', 'faltante', 'huecoRetencion')
    ],
    reconstruible: [
      requisito('configuracion', 'cumplido'),
      requisito('credencialSensible', 'faltante', 'omitidaPorSeleccion')
    ]
  });
  assert.equal(completitud.interpretable.estado, 'completa');
  assert.equal(completitud.observable.estado, 'parcial');
  assert.equal(completitud.reconstruible.estado, 'parcial');
  assert.deepEqual(completitud.interpretable.causas, []);
  assert.deepEqual(completitud.reconstruible.causas, [{
    requisitoId: 'credencialSensible',
    condicion: 'faltante',
    causa: 'omitidaPorSeleccion'
  }]);

  const degradada = evaluarCompletitudFederacion({
    interpretable: [requisito('identidad', 'fallido', 'divergencia')],
    observable: [],
    reconstruible: []
  });
  assert.equal(degradada.interpretable.estado, 'degradada');
  assert.equal(degradada.observable.estado, 'completa');
  assert.equal(degradada.reconstruible.estado, 'completa');

  const requisitosA = [
    requisito('zeta', 'faltante', 'ausenteZeta'),
    requisito('alfa', 'fallido', 'divergenciaAlfa'),
    requisito('medio', 'faltante', 'ausenteMedio')
  ];
  const requisitosB = [requisitosA[2], requisitosA[0], requisitosA[1]];
  const resultadoA = evaluarCompletitudFederacion({
    interpretable: requisitosA,
    observable: [],
    reconstruible: []
  });
  const resultadoB = evaluarCompletitudFederacion({
    interpretable: requisitosB,
    observable: [],
    reconstruible: []
  });
  assert.deepEqual(resultadoA, resultadoB);

  const requisitosDispersos = [];
  requisitosDispersos.length = 1;
  assert.throws(
    () => evaluarCompletitudFederacion({
      interpretable: requisitosDispersos,
      observable: [],
      reconstruible: []
    }),
    (error) => error.codigo === 'requisitos_completitud_invalidos'
  );

  let getterEjecutado = false;
  const requisitoConGetter = {
    causa: null,
    estado: 'cumplido'
  };
  Object.defineProperty(requisitoConGetter, 'id', {
    enumerable: true,
    get() {
      getterEjecutado = true;
      return 'no-debe-leerse';
    }
  });
  assert.throws(
    () => evaluarCompletitudFederacion({
      interpretable: [requisitoConGetter],
      observable: [],
      reconstruible: []
    }),
    (error) => error.codigo === 'requisito_invalido'
  );
  assert.equal(getterEjecutado, false);

  const requisitoConSymbol = requisito('identidad', 'cumplido');
  requisitoConSymbol[Symbol('oculto')] = true;
  assert.throws(
    () => evaluarCompletitudFederacion({
      interpretable: [requisitoConSymbol],
      observable: [],
      reconstruible: []
    }),
    (error) => error.codigo === 'requisito_invalido'
  );
}

function verificarVigenciaAcumulada() {
  let accessorSaltoEjecutado = false;
  const vigenciasConAccessor = [];
  Object.defineProperty(vigenciasConAccessor, '0', {
    enumerable: true,
    get() {
      accessorSaltoEjecutado = true;
      return '1000';
    }
  });
  vigenciasConAccessor.length = 1;
  assert.throws(
    () => calcularVigenciaEfectivaFederacion({
      vigenciaOrigenMs: '2000',
      vigenciasSaltosMs: vigenciasConAccessor,
      limiteReceptorMs: '2000'
    }),
    (error) => error.codigo === 'vigencias_saltos_invalidas'
  );
  assert.equal(accessorSaltoEjecutado, false);

  assert.deepEqual(calcularVigenciaEfectivaFederacion({
    vigenciaOrigenMs: '1000',
    vigenciasSaltosMs: ['900', '800'],
    limiteReceptorMs: '700',
    transcurridoDesdeRecepcionMs: '200'
  }), {
    estado: 'vigente',
    vigenciaFronteraMs: '700',
    vigenciaRestanteMs: '500',
    transcurridoDesdeRecepcionMs: '200'
  });
  assert.equal(calcularVigenciaEfectivaFederacion({
    vigenciaOrigenMs: '1000',
    vigenciasSaltosMs: ['800'],
    limiteReceptorMs: '700',
    transcurridoDesdeRecepcionMs: '700'
  }).estado, 'vencida');
  const retirada = calcularVigenciaEfectivaFederacion({
    vigenciaOrigenMs: '1000',
    limiteReceptorMs: '900',
    retiradaExplicita: true
  });
  assert.equal(retirada.estado, 'retirada');
  assert.equal(retirada.vigenciaRestanteMs, '0');
  assert.equal(calcularVigenciaEfectivaFederacion({
    vigenciaOrigenMs: '9007199254740993000',
    vigenciasSaltosMs: ['9007199254740992000'],
    limiteReceptorMs: '9007199254740991000'
  }).vigenciaRestanteMs, '9007199254740991000');
}

function verificarSoporteYDimensiones() {
  const contribucionA = contribucion('ruta-a', true, false, false, ['estado', 'contexto']);
  const contribucionB = contribucion('ruta-b', true, true, false, ['estado']);
  const vigente = evaluarDimensionesProyeccionFederada({
    materializacion: 'materializada',
    autoridadActual: true,
    contribuciones: [contribucionA, contribucionB]
  });
  assert.deepEqual(vigente, {
    materializacion: 'materializada',
    vigencia: 'vigente',
    soporte: 'sostenida',
    autorizacion: 'autorizada',
    soporteCampos: { contexto: 'huerfana', estado: 'sostenida' }
  });

  const sinAutoridad = evaluarDimensionesProyeccionFederada({
    materializacion: 'materializada',
    autoridadActual: false,
    contribuciones: [contribucionB]
  });
  assert.equal(sinAutoridad.vigencia, 'vigente');
  assert.equal(sinAutoridad.soporte, 'sostenida');
  assert.equal(sinAutoridad.autorizacion, 'noAutorizada');

  const sinSoportePeroVigente = evaluarDimensionesProyeccionFederada({
    materializacion: 'materializada',
    autoridadActual: true,
    contribuciones: [contribucion('ruta-no-legitima', false, true, false, ['estado'])]
  });
  assert.equal(sinSoportePeroVigente.vigencia, 'vigente');
  assert.equal(sinSoportePeroVigente.soporte, 'huerfana');
  const contribucionRetirada = evaluarDimensionesProyeccionFederada({
    materializacion: 'materializada',
    autoridadActual: true,
    contribuciones: [contribucion('ruta-retirada', true, true, true, ['estado'])]
  });
  assert.equal(contribucionRetirada.vigencia, 'vigente');
  assert.equal(contribucionRetirada.soporte, 'huerfana');

  const vencida = evaluarDimensionesProyeccionFederada({
    materializacion: 'fallida',
    autoridadActual: true,
    contribuciones: [contribucionA]
  });
  assert.equal(vencida.materializacion, 'fallida');
  assert.equal(vencida.vigencia, 'vencida');
  assert.equal(vencida.soporte, 'huerfana');

  const retirada = evaluarDimensionesProyeccionFederada({
    materializacion: 'materializada',
    autoridadActual: true,
    retiradaOrigen: true,
    contribuciones: [contribucionB]
  });
  assert.equal(retirada.vigencia, 'retirada');
  assert.equal(retirada.soporte, 'huerfana');

  const camposDispersos = [];
  camposDispersos.length = 1;
  assert.throws(
    () => evaluarDimensionesProyeccionFederada({
      materializacion: 'materializada',
      autoridadActual: true,
      contribuciones: [{
        ...contribucionA,
        campos: camposDispersos
      }]
    }),
    (error) => error.codigo === 'campos_contribucion_invalidos'
  );

  const contribucionConSymbol = { ...contribucionA };
  contribucionConSymbol[Symbol('oculto')] = true;
  assert.throws(
    () => evaluarDimensionesProyeccionFederada({
      materializacion: 'materializada',
      autoridadActual: true,
      contribuciones: [contribucionConSymbol]
    }),
    (error) => error.codigo === 'contribucion_invalida'
  );

  assert.throws(
    () => evaluarDimensionesProyeccionFederada({
      materializacion: 'materializada',
      autoridadActual: true,
      contribuciones: [{
        contribucionId: 'no-es-una-identidad-federada',
        legitima: true,
        vigente: true,
        retirada: false,
        campos: ['estado']
      }]
    }),
    (error) => error.codigo === 'instancia_invalida'
  );
}

function verificarRetencionEfectiva() {
  assert.deepEqual(calcularPoliticaRetencionEfectivaFederacion({
    retencionGlobalDias: '30',
    retencionRecepcionDias: '10'
  }), {
    retencionGlobalDias: '30',
    retencionRecepcionDias: '10',
    retencionEfectivaDias: '10'
  });
  assert.equal(calcularPoliticaRetencionEfectivaFederacion({
    retencionGlobalDias: null,
    retencionRecepcionDias: null
  }).retencionEfectivaDias, null);

  const base = {
    retencionGlobalDias: '30',
    retencionRecepcionDias: '10',
    tiempoEfectivoFuenteUtc: '2026-07-21T00:00:00.000Z',
    ahoraUtc: '2026-08-01T00:00:00.000Z'
  };
  const fuera = evaluarRetencionDatoFederado(base);
  assert.equal(fuera.retencionEfectivaDias, '10');
  assert.equal(fuera.fueraVentana, true);
  assert.equal(fuera.decision, 'eliminarContenido');
  assert.equal(fuera.puedeResucitarContenidoEliminado, false);
  assert.equal(evaluarRetencionDatoFederado({
    ...base,
    minimoOperativoProtegido: true
  }).decision, 'conservarMinimoOperativo');
  assert.equal(evaluarRetencionDatoFederado({
    ...base,
    fronteraAntirresurreccion: true
  }).decision, 'compactarEvidencia');
  assert.throws(
    () => evaluarRetencionDatoFederado({
      ...base,
      minimoOperativoProtegido: true,
      fronteraAntirresurreccion: true
    }),
    (error) => error.codigo === 'protecciones_retencion_incompatibles'
  );
  assert.equal(evaluarRetencionDatoFederado({
    ...base,
    tiempoEfectivoFuenteUtc: '2026-07-22T00:00:00.000Z'
  }).decision, 'conservar');
  assert.equal(evaluarRetencionDatoFederado({
    retencionGlobalDias: null,
    retencionRecepcionDias: null,
    tiempoEfectivoFuenteUtc: '2020-01-01T00:00:00.000Z',
    ahoraUtc: '2026-08-01T00:00:00.000Z'
  }).decision, 'conservar');
}

function crearScopesFixture() {
  return {
    portal: crearScopeFederacion({ nivel: 'portal' }),
    tenant1: crearScopeFederacion({ nivel: 'tenant', tenantId: 't1' }),
    tenant2: crearScopeFederacion({ nivel: 'tenant', tenantId: 't2' }),
    empresa1: crearScopeFederacion({
      nivel: 'empresa',
      tenantId: 't1',
      empresaId: 'e1'
    }),
    empresa2: crearScopeFederacion({
      nivel: 'empresa',
      tenantId: 't2',
      empresaId: 'e2'
    }),
    sitio1: crearScopeFederacion({
      nivel: 'sitio',
      tenantId: 't1',
      empresaId: 'e1',
      sitioId: 's1'
    })
  };
}

function declaracion({ activa = true, nivelesScope, familias }) {
  return crearDeclaracionConcesionFederacion({ activa, nivelesScope, familias });
}

function limites(campos, permiteContenidoSensible, permiteRefederacion) {
  return { campos, permiteContenidoSensible, permiteRefederacion };
}

function requisito(id, estado, causa = null) {
  return { id, estado, causa };
}

function contribucion(contribucionId, legitima, vigente, retirada, campos) {
  if (!identidadesContribucion.has(contribucionId)) {
    const material = new Uint8Array(16);
    let valor = BigInt(identidadesContribucion.size + 1);
    for (let indice = material.length - 1; indice >= 0; indice -= 1) {
      material[indice] = Number(valor & 255n);
      valor >>= 8n;
    }
    identidadesContribucion.set(contribucionId, crearIdentidadFederada({
      tipo: TIPOS_IDENTIDAD_FEDERADA.CONTRIBUCION,
      valor: `sfid1.contribucion.${Buffer.from(material).toString('base64url')}`
    }));
  }
  return {
    contribucionId: identidadesContribucion.get(contribucionId),
    legitima,
    vigente,
    retirada,
    campos
  };
}
