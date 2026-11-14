import assert from 'node:assert/strict';

import {
  ErrorCanonicalizacionFederacion,
  ErrorEnvolventeFederacion,
  PERFIL_CANONICO_FEDERACION,
  PROFUNDIDAD_MAXIMA_JSON_FEDERACION,
  TIPOS_IDENTIDAD_FEDERADA,
  canonicalizarJsonFederacion,
  codificarUtf8CanonicoFederacion,
  crearCampoOmitidoFederado,
  crearCampoPresenteFederado,
  crearCampoRetiradoFederado,
  crearEvidenciaDisponibleFederacion,
  crearEnvolventeFederacion,
  crearIdentidadFederada,
  crearOcurrenciaOrigenFederada,
  crearVistaAutorizadaFederacion,
  esEnvolventeFederacion,
  esOcurrenciaOrigenFederada,
  esVistaAutorizadaFederacion,
  exigirDestinoNoVisitadoFederacion
} from '../paquetes/federacion/src/index.js';

const ids = crearFixtureIdentidades();

verificarCanonicalizacionByteAByte();
verificarArbolJsonHostil();
const fixture = verificarOcurrenciaYVistaAutorizada();
verificarEnvolventeYRecorrido(fixture);
verificarOperacionesTerminales(fixture);
verificarRechazosContractuales(fixture);

console.log(
  '[federacion] OK 5.22.9d: envolvente=v1 vista=autorizada ' +
    'campos=omitido|null|retirado canonico=estable_utf8'
);

function verificarCanonicalizacionByteAByte() {
  const valorA = { z: -0, a: [3.5, { b: true, a: 'ñ' }] };
  const valorB = { a: [3.5, { a: 'ñ', b: true }], z: 0 };
  const esperado = '{"a":[3.5,{"a":"ñ","b":true}],"z":0}';
  assert.equal(canonicalizarJsonFederacion(valorA), esperado);
  assert.equal(canonicalizarJsonFederacion(valorB), esperado);
  assert.deepEqual(
    [...codificarUtf8CanonicoFederacion(valorA)],
    [...new TextEncoder().encode(esperado)]
  );
}

function verificarArbolJsonHostil() {
  const circular = {};
  circular.el = circular;
  const arrayConHueco = [];
  arrayConHueco.length = 1;
  const conAccessor = {};
  Object.defineProperty(conAccessor, 'dato', {
    enumerable: true,
    get() {
      throw new Error('El canonicalizador no debe ejecutar accessors.');
    }
  });
  const conSymbol = { dato: true };
  conSymbol[Symbol('oculto')] = true;
  let accessorEvidenciaEjecutado = false;
  const evidenciasConAccessor = [];
  Object.defineProperty(evidenciasConAccessor, '0', {
    enumerable: true,
    get() {
      accessorEvidenciaEjecutado = true;
      return { tipo: 'no-debe-leerse' };
    }
  });
  evidenciasConAccessor.length = 1;
  let demasiadoProfundo = null;
  for (
    let profundidad = 0;
    profundidad <= PROFUNDIDAD_MAXIMA_JSON_FEDERACION;
    profundidad += 1
  ) {
    demasiadoProfundo = [demasiadoProfundo];
  }

  for (const [valor, codigo] of [
    [undefined, 'tipo_no_representable'],
    [1n, 'tipo_no_representable'],
    [NaN, 'numero_no_finito'],
    [Infinity, 'numero_no_finito'],
    [new Date(), 'objeto_no_plano'],
    [circular, 'referencia_circular'],
    [arrayConHueco, 'array_con_huecos'],
    [conAccessor, 'propiedad_no_json'],
    [conSymbol, 'clave_no_representable'],
    [demasiadoProfundo, 'profundidad_json_excedida'],
    ['\ud800', 'unicode_invalido']
  ]) {
    assert.throws(
      () => canonicalizarJsonFederacion(valor),
      (error) =>
        error instanceof ErrorCanonicalizacionFederacion &&
        error.codigo === codigo
    );
  }
  assert.throws(
    () => crearVistaAutorizadaFederacion({
      ocurrenciaOrigen: crearOcurrenciaOrigenFederada({
        ...datosBaseOcurrencia(),
        campos: {
          estado: crearCampoPresenteFederado({ valor: true })
        }
      }),
      entregaId: ids.entrega,
      revisionConcesionId: ids.revision,
      campos: {},
      evidenciaDisponible: evidenciasConAccessor
    }),
    (error) =>
      error instanceof ErrorCanonicalizacionFederacion &&
      error.codigo === 'propiedad_no_json'
  );
  assert.equal(accessorEvidenciaEjecutado, false);
}

function verificarOcurrenciaYVistaAutorizada() {
  const configuracionMutable = {
    timeoutMs: '5000',
    destinos: ['10.0.0.1', '10.0.0.2']
  };
  const campos = {
    nombre: crearCampoPresenteFederado({ valor: 'Monitor principal' }),
    descripcion: crearCampoPresenteFederado({ valor: null }),
    configuracion: crearCampoPresenteFederado({
      valor: configuracionMutable
    }),
    secreto: crearCampoPresenteFederado({
      valor: 'ultrasecreto',
      sensibilidad: 'sensible'
    }),
    credencialAnterior: crearCampoRetiradoFederado(),
    comentario: crearCampoOmitidoFederado({ causa: 'ausenteEnOrigen' })
  };
  const ocurrencia = crearOcurrenciaOrigenFederada({
    familia: 'monitores',
    familiaVersion: 1,
    installationOrigenId: ids.installationA,
    elementoOrigenId: ids.elemento,
    ocurrenciaOrigenId: ids.ocurrencia,
    secuenciaElemento: '9007199254740993',
    operacion: 'actualizacion',
    tiempoOrigenUtc: '2026-08-01T08:30:00.000Z',
    scopeOrigenDeclarado: {
      sitioId: null,
      tenantId: 'tenant-origen',
      empresaId: 'empresa-origen',
      nivel: 'empresa'
    },
    vigenciaRestanteMs: '30000',
    campos,
    evidenciaIntegridad: [{ tipo: 'cadenaOrigen', valor: 'solo-origen' }]
  });

  configuracionMutable.timeoutMs = '1';
  configuracionMutable.destinos.push('host-inyectado');
  assert.equal(esOcurrenciaOrigenFederada(ocurrencia), true);
  assert.equal(Object.isFrozen(ocurrencia), true);
  assert.equal(Object.isFrozen(ocurrencia.toJSON()), true);
  assert.equal(
    ocurrencia.toJSON().campos.configuracion.valor.timeoutMs,
    '5000'
  );
  assert.deepEqual(
    ocurrencia.toJSON().campos.configuracion.valor.destinos,
    ['10.0.0.1', '10.0.0.2']
  );
  assert.throws(() => ocurrencia.toJSON().familia = 'telemetria');

  const ocurrenciaReordenada = crearOcurrenciaOrigenFederada({
    evidenciaIntegridad: [{ valor: 'solo-origen', tipo: 'cadenaOrigen' }],
    campos: Object.fromEntries(Object.entries(campos).reverse()),
    vigenciaRestanteMs: '30000',
    scopeOrigenDeclarado: {
      nivel: 'empresa',
      empresaId: 'empresa-origen',
      tenantId: 'tenant-origen',
      sitioId: null
    },
    tiempoOrigenUtc: '2026-08-01T08:30:00.000Z',
    operacion: 'actualizacion',
    secuenciaElemento: '9007199254740993',
    ocurrenciaOrigenId: ids.ocurrencia,
    elementoOrigenId: ids.elemento,
    installationOrigenId: ids.installationA,
    familiaVersion: 1,
    familia: 'monitores'
  });
  assert.equal(ocurrenciaReordenada.canonicalizar(), ocurrencia.canonicalizar());
  assert.deepEqual(
    [...ocurrenciaReordenada.codificarUtf8()],
    [...ocurrencia.codificarUtf8()]
  );

  const camposVista = {
    comentario: campos.comentario,
    configuracion: campos.configuracion,
    credencialAnterior: campos.credencialAnterior,
    descripcion: campos.descripcion,
    nombre: campos.nombre,
    secreto: crearCampoOmitidoFederado({ causa: 'protegido' })
  };
  const vista = crearVistaAutorizadaFederacion({
    ocurrenciaOrigen: ocurrencia,
    entregaId: ids.entrega,
    revisionConcesionId: ids.revision,
    campos: camposVista,
    evidenciaDisponible: [
      crearEvidenciaDisponibleFederacion({
        tipo: 'hashCampos',
        alcance: 'camposAutorizados',
        campos: ['nombre', 'configuracion'],
        contenido: { algoritmo: 'sha256', valor: 'hash-vista-autorizada' }
      }),
      crearEvidenciaDisponibleFederacion({
        tipo: 'cadenaRuta',
        alcance: 'metadatos',
        contenido: { posicion: '7' }
      })
    ]
  });
  assert.equal(esVistaAutorizadaFederacion(vista), true);
  assert.equal(vista.toJSON().ocurrencia.ocurrenciaOrigenId, ids.ocurrencia.toString());
  assert.equal(vista.toJSON().ocurrencia.campos.descripcion.valor, null);
  assert.equal(vista.toJSON().ocurrencia.campos.secreto.estado, 'omitido');
  assert.equal('valor' in vista.toJSON().ocurrencia.campos.secreto, false);
  assert.doesNotMatch(vista.canonicalizar(), /ultrasecreto|solo-origen/);
  assert.match(ocurrencia.canonicalizar(), /ultrasecreto|solo-origen/);

  const vistaReordenada = crearVistaAutorizadaFederacion({
    evidenciaDisponible: [
      crearEvidenciaDisponibleFederacion({
        contenido: { posicion: '7' },
        campos: [],
        alcance: 'metadatos',
        tipo: 'cadenaRuta'
      }),
      crearEvidenciaDisponibleFederacion({
        contenido: { valor: 'hash-vista-autorizada', algoritmo: 'sha256' },
        campos: ['configuracion', 'nombre'],
        alcance: 'camposAutorizados',
        tipo: 'hashCampos'
      })
    ],
    campos: Object.fromEntries(Object.entries(camposVista).reverse()),
    revisionConcesionId: ids.revision,
    entregaId: ids.entrega,
    ocurrenciaOrigen: ocurrencia
  });
  assert.equal(vistaReordenada.canonicalizar(), vista.canonicalizar());
  assert.deepEqual(
    [...vistaReordenada.codificarUtf8()],
    [...vista.codificarUtf8()]
  );

  const vistaAlternativa = crearVistaAutorizadaFederacion({
    ocurrenciaOrigen: ocurrencia,
    entregaId: ids.entregaAlternativa,
    revisionConcesionId: ids.revision,
    campos: {
      credencialAnterior: campos.credencialAnterior,
      descripcion: campos.descripcion,
      nombre: campos.nombre,
      secreto: crearCampoOmitidoFederado({ causa: 'noAutorizado' })
    }
  });
  assert.notEqual(vistaAlternativa.canonicalizar(), vista.canonicalizar());
  assert.equal(
    vistaAlternativa.toJSON().ocurrencia.ocurrenciaOrigenId,
    vista.toJSON().ocurrencia.ocurrenciaOrigenId
  );

  const ocurrenciaSinRetiradas = crearOcurrenciaOrigenFederada({
    ...datosBaseOcurrencia(),
    ocurrenciaOrigenId: ids.ocurrenciaOpaca,
    secuenciaElemento: '9007199254740994',
    campos: {
      nombre: campos.nombre,
      secreto: campos.secreto
    }
  });
  const vistaOpaca = crearVistaAutorizadaFederacion({
    ocurrenciaOrigen: ocurrenciaSinRetiradas,
    entregaId: ids.entregaOpaca,
    revisionConcesionId: ids.revision,
    campos: {}
  });
  assert.deepEqual(vistaOpaca.toJSON().ocurrencia.campos, {});
  assert.equal(
    vistaOpaca.toJSON().ocurrencia.ocurrenciaOrigenId,
    ids.ocurrenciaOpaca.toString()
  );

  const nulo = canonicalizarJsonFederacion(crearCampoPresenteFederado({ valor: null }));
  const omitido = canonicalizarJsonFederacion(
    crearCampoOmitidoFederado({ causa: 'ausenteEnOrigen' })
  );
  const retirado = canonicalizarJsonFederacion(crearCampoRetiradoFederado());
  assert.notEqual(nulo, omitido);
  assert.notEqual(nulo, retirado);
  assert.notEqual(omitido, retirado);

  const ocurrenciaFalsificada = Object.create(
    Object.getPrototypeOf(ocurrencia)
  );
  assert.equal(esOcurrenciaOrigenFederada(ocurrenciaFalsificada), false);
  assert.throws(
    () => crearVistaAutorizadaFederacion({
      ocurrenciaOrigen: ocurrenciaFalsificada
    }),
    (error) => exigirErrorEnvolvente(error, 'ocurrencia_origen_invalida')
  );

  const vistaFalsificada = Object.create(Object.getPrototypeOf(vista));
  assert.equal(esVistaAutorizadaFederacion(vistaFalsificada), false);
  assert.throws(
    () => crearEnvolventeFederacion({ vistaAutorizada: vistaFalsificada }),
    (error) => exigirErrorEnvolvente(error, 'vista_autorizada_invalida')
  );

  return { ocurrencia, vista, campos };
}

function verificarEnvolventeYRecorrido({ vista }) {
  const saltos = [
    {
      installationId: ids.installationA,
      bootId: ids.bootA,
      recibidoUtc: null,
      emitidoUtc: '2026-08-01T08:30:01.000Z'
    },
    {
      installationId: ids.installationB,
      bootId: ids.bootB,
      recibidoUtc: '2026-08-01T08:30:02.000Z',
      emitidoUtc: '2026-08-01T08:30:03.000Z'
    }
  ];
  const envolvente = crearEnvolventeFederacion({
    vistaAutorizada: vista,
    installationEmisoraId: ids.installationB,
    bootEmisorId: ids.bootB,
    recorridoInstalaciones: [ids.installationA, ids.installationB],
    tiemposSaltosDisponibles: saltos
  });
  assert.equal(esEnvolventeFederacion(envolvente), true);
  const envolventeFalsificada = Object.create(
    Object.getPrototypeOf(envolvente)
  );
  assert.equal(esEnvolventeFederacion(envolventeFalsificada), false);
  assert.throws(
    () => exigirDestinoNoVisitadoFederacion({
      envolvente: envolventeFalsificada,
      installationDestinoId: ids.installationC
    }),
    (error) => exigirErrorEnvolvente(error, 'envolvente_invalida')
  );
  assert.equal(envolvente.toJSON().perfilCanonico, PERFIL_CANONICO_FEDERACION);
  assert.deepEqual(envolvente.toJSON().recorridoInstalaciones, [
    ids.installationA.toString(),
    ids.installationB.toString()
  ]);
  assert.equal(
    envolvente.toJSON().emisorInmediato.installationId,
    ids.installationB.toString()
  );
  assert.equal(
    canonicalizarJsonFederacion(JSON.parse(envolvente.canonicalizar())),
    envolvente.canonicalizar()
  );
  assert.deepEqual(
    [...envolvente.codificarUtf8()],
    [...new TextEncoder().encode(envolvente.canonicalizar())]
  );
  assert.equal(
    exigirDestinoNoVisitadoFederacion({
      envolvente,
      installationDestinoId: ids.installationC
    }),
    ids.installationC.toString()
  );
  assert.throws(
    () => exigirDestinoNoVisitadoFederacion({
      envolvente,
      installationDestinoId: ids.installationA
    }),
    (error) => exigirErrorEnvolvente(error, 'recorrido_ciclico_destino')
  );

  const envolventeSaltosReordenados = crearEnvolventeFederacion({
    vistaAutorizada: vista,
    installationEmisoraId: ids.installationB,
    bootEmisorId: ids.bootB,
    recorridoInstalaciones: [ids.installationA, ids.installationB],
    tiemposSaltosDisponibles: [...saltos].reverse()
  });
  assert.equal(
    envolventeSaltosReordenados.canonicalizar(),
    envolvente.canonicalizar()
  );

  assert.throws(
    () => crearEnvolventeFederacion({
      vistaAutorizada: vista,
      installationEmisoraId: ids.installationB,
      bootEmisorId: ids.bootB,
      recorridoInstalaciones: [ids.installationB]
    }),
    (error) => exigirErrorEnvolvente(error, 'recorrido_sin_origen')
  );
  assert.throws(
    () => crearEnvolventeFederacion({
      vistaAutorizada: vista,
      installationEmisoraId: ids.installationA,
      bootEmisorId: ids.bootA,
      recorridoInstalaciones: [ids.installationA, ids.installationB]
    }),
    (error) => exigirErrorEnvolvente(error, 'recorrido_sin_emisor')
  );
  assert.throws(
    () => crearEnvolventeFederacion({
      vistaAutorizada: vista,
      installationEmisoraId: ids.installationB,
      bootEmisorId: ids.bootB,
      recorridoInstalaciones: [
        ids.installationA,
        ids.installationB,
        ids.installationA,
        ids.installationB
      ]
    }),
    (error) =>
      exigirErrorEnvolvente(error, 'recorrido_con_instalacion_repetida')
  );
  assert.throws(
    () => crearEnvolventeFederacion({
      vistaAutorizada: vista,
      installationEmisoraId: ids.installationB,
      bootEmisorId: ids.bootB,
      recorridoInstalaciones: [ids.installationA, ids.installationB],
      tiemposSaltosDisponibles: [{
        installationId: ids.installationB,
        bootId: null,
        recibidoUtc: '2026-08-01T08:30:02.000Z',
        emitidoUtc: '2026-08-01T08:30:03.000Z'
      }]
    }),
    (error) => exigirErrorEnvolvente(error, 'boot_emisor_incoherente')
  );
  assert.throws(
    () => crearEnvolventeFederacion({
      vistaAutorizada: vista,
      installationEmisoraId: ids.installationB,
      bootEmisorId: ids.bootB,
      recorridoInstalaciones: [ids.installationA, ids.installationB],
      tiemposSaltosDisponibles: [{
        installationId: ids.installationB,
        bootId: ids.bootB,
        recibidoUtc: '2026-08-01T08:30:04.000Z',
        emitidoUtc: '2026-08-01T08:30:03.000Z'
      }]
    }),
    (error) => exigirErrorEnvolvente(error, 'cronologia_salto_invalida')
  );

  let accessorRecorridoEjecutado = false;
  const recorridoConAccessor = [ids.installationA, ids.installationB];
  Object.defineProperty(recorridoConAccessor, '1', {
    enumerable: true,
    get() {
      accessorRecorridoEjecutado = true;
      return ids.installationB;
    }
  });
  assert.throws(
    () => crearEnvolventeFederacion({
      vistaAutorizada: vista,
      installationEmisoraId: ids.installationB,
      bootEmisorId: ids.bootB,
      recorridoInstalaciones: recorridoConAccessor
    }),
    (error) => exigirErrorEnvolvente(error, 'recorrido_invalido')
  );
  assert.equal(accessorRecorridoEjecutado, false);

  let accessorSaltoEjecutado = false;
  const saltosConAccessor = [];
  Object.defineProperty(saltosConAccessor, '0', {
    enumerable: true,
    get() {
      accessorSaltoEjecutado = true;
      return saltos[0];
    }
  });
  saltosConAccessor.length = 1;
  assert.throws(
    () => crearEnvolventeFederacion({
      vistaAutorizada: vista,
      installationEmisoraId: ids.installationB,
      bootEmisorId: ids.bootB,
      recorridoInstalaciones: [ids.installationA, ids.installationB],
      tiemposSaltosDisponibles: saltosConAccessor
    }),
    (error) => exigirErrorEnvolvente(error, 'tiempos_saltos_invalidos')
  );
  assert.equal(accessorSaltoEjecutado, false);
}

function verificarOperacionesTerminales({ ocurrencia }) {
  for (const operacion of ['retirada', 'salidaProyeccion']) {
    const terminal = crearOcurrenciaOrigenFederada({
      familia: 'monitores',
      familiaVersion: 1,
      installationOrigenId: ids.installationA,
      elementoOrigenId: ids.elemento,
      ocurrenciaOrigenId: operacion === 'retirada'
        ? ids.ocurrenciaRetirada
        : ids.ocurrenciaSalida,
      secuenciaElemento: operacion === 'retirada' ? '11' : '12',
      operacion,
      tiempoOrigenUtc: '2026-08-01T09:00:00.000Z',
      scopeOrigenDeclarado: ocurrencia.toJSON().scopeOrigenDeclarado,
      campos: {}
    });
    const vista = crearVistaAutorizadaFederacion({
      ocurrenciaOrigen: terminal,
      entregaId: operacion === 'retirada' ? ids.entregaRetirada : ids.entregaSalida,
      revisionConcesionId: ids.revision,
      campos: {}
    });
    assert.deepEqual(vista.toJSON().ocurrencia.campos, {});
    assert.equal(vista.toJSON().ocurrencia.operacion, operacion);
  }
}

function verificarRechazosContractuales({ ocurrencia, campos }) {
  assert.throws(
    () => crearCampoPresenteFederado({ valor: undefined }),
    (error) => error instanceof ErrorCanonicalizacionFederacion
  );
  assert.throws(
    () => crearOcurrenciaOrigenFederada({
      ...datosBaseOcurrencia(),
      protocoloVersion: 2,
      campos: { nombre: campos.nombre }
    }),
    (error) => exigirErrorEnvolvente(error, 'version_protocolo_incompatible')
  );
  assert.throws(
    () => crearOcurrenciaOrigenFederada({
      ...datosBaseOcurrencia(),
      familiaVersion: 2,
      campos: { nombre: campos.nombre }
    }),
    (error) => exigirErrorEnvolvente(error, 'version_familia_incompatible')
  );
  assert.throws(
    () => crearOcurrenciaOrigenFederada({
      ...datosBaseOcurrencia(),
      operacion: 'retirada',
      campos: { nombre: campos.nombre }
    }),
    (error) => exigirErrorEnvolvente(error, 'operacion_terminal_con_campos')
  );
  assert.throws(
    () => crearOcurrenciaOrigenFederada({
      ...datosBaseOcurrencia(),
      familia: 'auditoria',
      familiaVersion: 1,
      operacion: 'retirada',
      campos: {}
    }),
    (error) => exigirErrorEnvolvente(error, 'operacion_familia_incompatible')
  );
  const salidaAuditoria = crearOcurrenciaOrigenFederada({
    ...datosBaseOcurrencia(),
    familia: 'auditoria',
    familiaVersion: 1,
    operacion: 'salidaProyeccion',
    campos: {}
  });
  assert.equal(salidaAuditoria.toJSON().operacion, 'salidaProyeccion');
  assert.throws(
    () => crearOcurrenciaOrigenFederada({
      ...datosBaseOcurrencia(),
      operacion: 'retirada',
      vigenciaRestanteMs: '1000',
      campos: {}
    }),
    (error) => exigirErrorEnvolvente(error, 'operacion_terminal_con_vigencia')
  );
  assert.throws(
    () => crearOcurrenciaOrigenFederada({
      ...datosBaseOcurrencia(),
      familia: 'auditoria',
      familiaVersion: 1,
      vigenciaRestanteMs: '1000',
      campos: { nombre: campos.nombre }
    }),
    (error) => exigirErrorEnvolvente(error, 'vigencia_familia_incompatible')
  );
  assert.throws(
    () => crearOcurrenciaOrigenFederada({
      ...datosBaseOcurrencia(),
      scopeOrigenDeclarado: { cualquier: 'cosa' },
      campos: { nombre: campos.nombre }
    }),
    (error) => exigirErrorEnvolvente(error, 'scope_origen_invalido')
  );
  assert.throws(
    () => crearVistaAutorizadaFederacion({
      ocurrenciaOrigen: ocurrencia,
      entregaId: ids.entregaAlternativa,
      revisionConcesionId: ids.revision,
      campos: {
        nombre: crearCampoPresenteFederado({ valor: 'Nombre reinterpretado' })
      }
    }),
    (error) => exigirErrorEnvolvente(error, 'campo_reinterpretado_en_vista')
  );
  assert.throws(
    () => crearVistaAutorizadaFederacion({
      ocurrenciaOrigen: ocurrencia,
      entregaId: ids.entregaAlternativa,
      revisionConcesionId: ids.revision,
      campos: {
        nombre: crearCampoOmitidoFederado({ causa: 'ausenteEnOrigen' })
      }
    }),
    (error) => exigirErrorEnvolvente(error, 'ausencia_origen_inventada')
  );
  assert.throws(
    () => crearVistaAutorizadaFederacion({
      ocurrenciaOrigen: ocurrencia,
      entregaId: ids.entregaAlternativa,
      revisionConcesionId: ids.revision,
      campos: {
        comentario: crearCampoOmitidoFederado({ causa: 'protegido' })
      }
    }),
    (error) => exigirErrorEnvolvente(error, 'causa_omision_reinterpretada')
  );
  assert.throws(
    () => crearVistaAutorizadaFederacion({
      ocurrenciaOrigen: ocurrencia,
      entregaId: ids.entregaAlternativa,
      revisionConcesionId: ids.revision,
      campos: {
        inventado: crearCampoPresenteFederado({ valor: true })
      }
    }),
    (error) => exigirErrorEnvolvente(error, 'campo_inventado_en_vista')
  );
  assert.throws(
    () => crearVistaAutorizadaFederacion({
      ocurrenciaOrigen: ocurrencia,
      entregaId: ids.entregaAlternativa,
      revisionConcesionId: ids.revision,
      campos: {
        nombre: campos.nombre,
        credencialAnterior: crearCampoOmitidoFederado({
          causa: 'omitidoPorSeleccion'
        })
      }
    }),
    (error) => exigirErrorEnvolvente(error, 'retirada_campo_ocultada')
  );
  assert.throws(
    () => crearVistaAutorizadaFederacion({
      ocurrenciaOrigen: ocurrencia,
      entregaId: ids.entregaAlternativa,
      revisionConcesionId: ids.revision,
      campos: {
        credencialAnterior: campos.credencialAnterior,
        descripcion: crearCampoOmitidoFederado({
          causa: 'omitidoPorSeleccion'
        }),
        nombre: campos.nombre
      }
    }),
    (error) => exigirErrorEnvolvente(error, 'vaciado_campo_ocultado')
  );
  assert.throws(
    () => crearVistaAutorizadaFederacion({
      ocurrenciaOrigen: ocurrencia,
      entregaId: ids.entregaAlternativa,
      revisionConcesionId: ids.revision,
      campos: {
        credencialAnterior: campos.credencialAnterior,
        nombre: campos.nombre
      }
    }),
    (error) => exigirErrorEnvolvente(error, 'vaciado_campo_ocultado')
  );
  assert.throws(
    () => crearVistaAutorizadaFederacion({
      ocurrenciaOrigen: ocurrencia,
      entregaId: ids.entregaAlternativa,
      revisionConcesionId: ids.revision,
      campos: { nombre: campos.nombre }
    }),
    (error) => exigirErrorEnvolvente(error, 'retirada_campo_ocultada')
  );
  assert.throws(
    () => crearVistaAutorizadaFederacion({
      ocurrenciaOrigen: ocurrencia,
      entregaId: ids.entregaAlternativa,
      revisionConcesionId: ids.revision,
      campos: {
        credencialAnterior: campos.credencialAnterior,
        descripcion: campos.descripcion,
        nombre: campos.nombre,
        secreto: crearCampoOmitidoFederado({ causa: 'protegido' })
      },
      evidenciaDisponible: [
        crearEvidenciaDisponibleFederacion({
          tipo: 'hashCampo',
          alcance: 'camposAutorizados',
          campos: ['secreto'],
          contenido: { valor: 'huella-reconocible-prohibida' }
        })
      ]
    }),
    (error) => exigirErrorEnvolvente(error, 'evidencia_sobre_campo_no_expuesto')
  );
}

function datosBaseOcurrencia() {
  return {
    familia: 'monitores',
    familiaVersion: 1,
    installationOrigenId: ids.installationA,
    elementoOrigenId: ids.elemento,
    ocurrenciaOrigenId: ids.ocurrencia,
    secuenciaElemento: '1',
    operacion: 'actualizacion',
    tiempoOrigenUtc: '2026-08-01T08:30:00.000Z',
    scopeOrigenDeclarado: { nivel: 'tenant', tenantId: 'tenant-origen' }
  };
}

function crearFixtureIdentidades() {
  let semilla = 0;
  const crear = (tipo) => {
    const material = Buffer.alloc(16, semilla);
    semilla += 1;
    return crearIdentidadFederada({
      tipo,
      valor: `sfid1.${tipo}.${material.toString('base64url')}`
    });
  };
  return {
    installationA: crear(TIPOS_IDENTIDAD_FEDERADA.INSTALACION),
    installationB: crear(TIPOS_IDENTIDAD_FEDERADA.INSTALACION),
    installationC: crear(TIPOS_IDENTIDAD_FEDERADA.INSTALACION),
    bootA: crear(TIPOS_IDENTIDAD_FEDERADA.ARRANQUE),
    bootB: crear(TIPOS_IDENTIDAD_FEDERADA.ARRANQUE),
    elemento: crear(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN),
    ocurrencia: crear(TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN),
    ocurrenciaOpaca: crear(TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN),
    ocurrenciaRetirada: crear(TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN),
    ocurrenciaSalida: crear(TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN),
    entrega: crear(TIPOS_IDENTIDAD_FEDERADA.ENTREGA),
    entregaAlternativa: crear(TIPOS_IDENTIDAD_FEDERADA.ENTREGA),
    entregaOpaca: crear(TIPOS_IDENTIDAD_FEDERADA.ENTREGA),
    entregaRetirada: crear(TIPOS_IDENTIDAD_FEDERADA.ENTREGA),
    entregaSalida: crear(TIPOS_IDENTIDAD_FEDERADA.ENTREGA),
    revision: crear(TIPOS_IDENTIDAD_FEDERADA.REVISION_CONCESION)
  };
}

function exigirErrorEnvolvente(error, codigo) {
  return error instanceof ErrorEnvolventeFederacion && error.codigo === codigo;
}
