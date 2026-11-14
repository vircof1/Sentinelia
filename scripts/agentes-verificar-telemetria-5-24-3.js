import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';

import {
  crearLecturaTelemetriaAgenteConTiposInternos
} from '../paquetes/agentes/src/TelemetriaAgente.js';
import {
  RepositorioCatalogoSenalesTelemetriaAgentes
} from '../paquetes/agentes/src/RepositorioCatalogoSenalesTelemetriaAgentes.js';
import {
  RepositorioEstadoActualTelemetriaAgentes
} from '../paquetes/agentes/src/RepositorioEstadoActualTelemetriaAgentes.js';
import {
  RepositorioObservacionesTelemetriaAgentes
} from '../paquetes/agentes/src/RepositorioObservacionesTelemetriaAgentes.js';
import {
  AdaptadorTelemetriaFederacion
} from '../paquetes/federacion/adaptadores/AdaptadorTelemetriaFederacion.js';
import {
  FuenteEntropiaCriptograficaNode
} from '../paquetes/federacion/adaptadores/FuenteEntropiaCriptograficaNode.js';
import {
  RepositorioTelemetriaLocalSql
} from '../paquetes/federacion/adaptadores/RepositorioTelemetriaLocalSql.js';
import {
  RepositorioTelemetriaRemotaSql
} from '../paquetes/federacion/adaptadores/RepositorioTelemetriaRemotaSql.js';
import {
  ServicioRefederacionFederacion
} from '../paquetes/federacion/aplicacion/ServicioRefederacionFederacion.js';
import {
  crearCampoPresenteFederado
} from '../paquetes/federacion/src/EnvolventeFederacion.js';
import {
  GeneradorIdentidadesFederadas,
  TIPOS_IDENTIDAD_FEDERADA
} from '../paquetes/federacion/src/IdentidadFederada.js';
import {
  PERFIL_PAYLOAD_TELEMETRIA_FEDERACION,
  VERSION_PAYLOAD_TELEMETRIA_FEDERACION,
  validarPayloadTelemetriaFederacion
} from '../paquetes/federacion/src/PayloadTelemetriaFederacion.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import {
  obtenerConfiguracionAplicacion
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';
import {
  contextoCierre,
  crearElemento,
  materializar,
  migrar,
  publicarHasta,
  recibirYReclamar
} from './federacion-verificar-5-22-15g.js';

const AHORA = new Date('2031-05-06T07:08:09.123Z');
const USUARIO_FIXTURE = 5_243_001;
const generador = new GeneradorIdentidadesFederadas({
  fuenteEntropia: new FuenteEntropiaCriptograficaNode()
});

await main();

async function main() {
  verificarContratoV1Ampliado();
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(
    configuracion.sql.estaCompleta,
    true,
    '5.24.3 necesita SQL real para demostrar captura, snapshot y materialización.'
  );
  const baseDatos = `sentinelia_fixture_5243_${randomBytes(6).toString('hex')}`;
  const administrador = new ClienteSql(configuracion.sql);
  let sql;
  try {
    await administrador.ejecutar(
      `CREATE DATABASE ${administrador.escaparIdentificador(baseDatos)} ` +
      'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
    );
    sql = new ClienteSql({ ...configuracion.sql, baseDatos });
    await migrar(sql);
    await sql.verificarUsoHorarioUtc();
    const base = await crearBaseFederable(sql);
    const snapshot = await verificarCapturaLocal(sql, base);
    await verificarMaterializacionRemota(sql, base, snapshot);
    await verificarRefederacionTransparente(snapshot);
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(baseDatos)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
  console.log(
    '[agentes] OK 5.24.3: protocolo=telemetria_v1 tipos=duracion_momento_utc ' +
    'captura=snapshot_y_cambios materializacion=canonica retirada=secuencia_2 ' +
    'refederacion=transparente condiciones_futuras=reservadas'
  );
}

function verificarContratoV1Ampliado() {
  const identidades = {
    fuente: id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN),
    senal: id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN),
    observacion: id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN),
    regla: id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN),
    revision: id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN)
  };
  const casos = [
    { tipo: 'duracion', valor: 3723.4567 },
    { tipo: 'momento_utc', valor: '2030-01-02T03:04:05Z' }
  ];
  for (const caso of casos) {
    const observacion = payloadObservacion({ ...identidades, ...caso });
    const normalizada = validarPayloadTelemetriaFederacion(observacion);
    assert.equal(normalizada.version, 1);
    assert.equal(normalizada.perfil, PERFIL_PAYLOAD_TELEMETRIA_FEDERACION);
    assert.deepEqual(normalizada.valor, caso.valor);
    assert.equal(normalizada.unidad, '');
    const senal = validarPayloadTelemetriaFederacion(
      payloadSenal({ ...identidades, ...caso })
    );
    assert.equal(senal.tipoDato, caso.tipo);
    assert.equal(senal.unidad, '');
    const fotografia = validarPayloadTelemetriaFederacion(
      payloadFotografia({
        senal: identidades.senal,
        observacionOrigenId: identidades.observacion,
        observacion
      })
    );
    assert.deepEqual(fotografia.observacion.valor, caso.valor);
    const regla = validarPayloadTelemetriaFederacion(
      payloadReglaReservada({ ...identidades, tipo: caso.tipo, valor: caso.valor })
    );
    assert.equal(regla.revisiones[0].condicionTipo, caso.tipo);
    assert.deepEqual(regla.estadoActual.valorEvaluado, caso.valor);
    const evento = validarPayloadTelemetriaFederacion(
      payloadEventoReservado({ ...identidades, tipo: caso.tipo, valor: caso.valor })
    );
    assert.deepEqual(evento.valorEvaluado, caso.valor);
    assert.equal(evento.condicion.tipo, caso.tipo);
  }

  const reglaRegex = validarPayloadTelemetriaFederacion(
    payloadReglaReservada({
      ...identidades,
      tipo: 'texto',
      valor: 'copia completada',
      tipoCondicion: 'texto_regex',
      condicion: condicionRegexConteo()
    })
  );
  assert.deepEqual(
    reglaRegex.revisiones[0].condicion.configuracion.opciones,
    ['i', 'm']
  );

  const legado = payloadObservacion({ ...identidades, tipo: 'numero', valor: 42 });
  legado.unidad = '%';
  assert.deepEqual(validarPayloadTelemetriaFederacion(legado), legado);

  for (const invalido of [
    { tipo: 'duracion', valor: -1 },
    { tipo: 'duracion', valor: 1.12345 },
    { tipo: 'momento_utc', valor: '2030-01-02T03:04:05.000Z' },
    { tipo: 'momento_utc', valor: '2030-01-02T04:04:05+01:00' }
  ]) {
    assert.throws(
      () => validarPayloadTelemetriaFederacion(
        payloadObservacion({ ...identidades, ...invalido })
      ),
      (error) => error?.codigo === 'valor_telemetria_invalido'
    );
  }
  const unidadInvalida = payloadObservacion({
    ...identidades,
    tipo: 'duracion',
    valor: 5
  });
  unidadInvalida.unidad = 's';
  assert.throws(
    () => validarPayloadTelemetriaFederacion(unidadInvalida),
    (error) => error?.codigo === 'unidad_telemetria_invalida'
  );

  const regexNoCanonica = payloadReglaReservada({
    ...identidades,
    tipo: 'texto',
    valor: 'texto',
    tipoCondicion: 'texto_regex',
    condicion: condicionRegexConteo()
  });
  regexNoCanonica.revisiones[0].condicion.configuracion.opciones = ['m', 'i'];
  assert.throws(
    () => validarPayloadTelemetriaFederacion(regexNoCanonica),
    (error) => error?.codigo === 'opciones_condicion_regex_invalidas'
  );
  const existeInvalida = payloadReglaReservada({
    ...identidades,
    tipo: 'texto',
    valor: 'texto',
    tipoCondicion: 'texto_regex',
    condicion: {
      tipo: 'texto_regex',
      version: 1,
      configuracion: {
        modo: 'existe', patron: 'error', opciones: [], operador: '=', umbral: 1
      }
    }
  });
  assert.throws(
    () => validarPayloadTelemetriaFederacion(existeInvalida),
    (error) => error?.codigo === 'forma_condicion_regex_invalida'
  );
}

async function verificarCapturaLocal(sql, base) {
  const catalogo = new RepositorioCatalogoSenalesTelemetriaAgentes(sql);
  const observaciones = new RepositorioObservacionesTelemetriaAgentes(sql);
  const fotografia = new RepositorioEstadoActualTelemetriaAgentes(sql);
  const senales = [];
  for (const definicion of [
    {
      categoria: 'copias', clave: 'duracion', tipoDato: 'duracion', unidad: 's',
      nombreHumano: 'Duración de la copia'
    },
    {
      categoria: 'copias', clave: 'siguiente', tipoDato: 'momento_utc',
      nombreHumano: 'Siguiente copia'
    }
  ]) {
    senales.push(await catalogo.guardarDeclaracionSenal({
      agenteId: base.agenteId,
      definicion
    }));
  }
  const lote = await observaciones.insertarLoteAceptado({
    agenteId: base.agenteId,
    senalesCatalogadas: senales,
    recibidoEnUtc: AHORA,
    observacionesAceptadas: [
      crearLecturaTelemetriaAgenteConTiposInternos({
        categoria: 'copias', clave: 'duracion', tipoDato: 'duracion', unidad: '',
        valorDuracion: 3723.4567, calidad: 'estimada', origen: 'directa',
        observadoEnUtc: '2031-05-06T07:08:00Z'
      }),
      crearLecturaTelemetriaAgenteConTiposInternos({
        categoria: 'copias', clave: 'siguiente', tipoDato: 'momento_utc', unidad: '',
        valorMomentoUtc: '2031-05-07T08:09:10Z', calidad: 'estimada', origen: 'directa',
        observadoEnUtc: '2031-05-06T07:08:01Z'
      })
    ]
  });
  await fotografia.aplicarObservacionesHistoricas(lote.insertadas);
  const reglas = [];
  for (let indice = 0; indice < senales.length; indice += 1) {
    reglas.push(await crearReglaEvaluada(sql, {
      ...base,
      senal: senales[indice],
      observacion: lote.insertadas[indice],
      valor: indice === 0 ? 3723.4567 : '2031-05-07T08:09:10Z'
    }));
  }
  await crearFlujoSnapshot(sql, base);
  const repositorioLocal = new RepositorioTelemetriaLocalSql(sql, {
    installationLocalId: base.installationLocalId,
    generadorIdentidades: generador,
    ahora: () => AHORA
  });
  const snapshot = await transaccion(sql, (conexion) =>
    repositorioLocal.listarCapturasEnTransaccion({
      flujoId: base.flujoId,
      generacionId: base.generacionId
    }, { conexion })
  );
  assert.deepEqual(
    contarTipos(snapshot),
    {
      fuente: 1,
      senal: 2,
      observacion: 2,
      fotografiaSenal: 2,
      fotografiaPol: 1,
      reglaDerivacion: 2,
      eventoDerivado: 2
    }
  );
  assert.equal(
    snapshot.find(({ tipoRegistro }) => tipoRegistro === 'fotografiaPol').payload.estado,
    'nuncaObservado'
  );
  for (const esperado of [
    ['duracion', 3723.4567],
    ['momento_utc', '2031-05-07T08:09:10Z']
  ]) {
    const [tipo, valor] = esperado;
    const observacion = snapshot.find(
      ({ tipoRegistro, payload }) =>
        tipoRegistro === 'observacion' && payload.tipoDato === tipo
    );
    const foto = snapshot.find(
      ({ tipoRegistro, payload }) =>
        tipoRegistro === 'fotografiaSenal' && payload.observacion.tipoDato === tipo
    );
    const regla = snapshot.find(
      ({ tipoRegistro, payload }) =>
        tipoRegistro === 'reglaDerivacion' && payload.estadoActual?.tipoDato === tipo
    );
    const evento = snapshot.find(
      ({ tipoRegistro, payload }) =>
        tipoRegistro === 'eventoDerivado' && payload.tipoDato === tipo
    );
    assert.deepEqual(observacion.payload.valor, valor);
    assert.deepEqual(foto.payload.observacion.valor, valor);
    assert.deepEqual(regla.payload.estadoActual.valorEvaluado, valor);
    assert.deepEqual(evento.payload.valorEvaluado, valor);
    assert.ok([observacion, foto, regla, evento].every(({ payload }) => {
      const cuerpo = payload.observacion || payload.estadoActual || payload;
      return cuerpo.unidad === '';
    }));
  }
  for (const captura of snapshot) {
    assert.equal(captura.payload.version, VERSION_PAYLOAD_TELEMETRIA_FEDERACION);
    assert.equal(captura.payload.perfil, PERFIL_PAYLOAD_TELEMETRIA_FEDERACION);
  }
  const capturaCambio = await transaccion(sql, (conexion) =>
    repositorioLocal.prepararCapturaEnTransaccion({
      tipoRegistro: 'observacion',
      idLocal: lote.insertadas[0].id
    }, { conexion })
  );
  assert.deepEqual(capturaCambio.payload, snapshot.find(
    ({ tipoRegistro, idLocal }) =>
      tipoRegistro === 'observacion' && String(idLocal) === String(lote.insertadas[0].id)
  ).payload);
  assert.equal(reglas.length, 2);
  return snapshot;
}

async function verificarMaterializacionRemota(sql, base, snapshot) {
  const repositorio = new RepositorioTelemetriaRemotaSql(sql);
  const adaptador = new AdaptadorTelemetriaFederacion({ repositorioRemoto: repositorio });
  const candidatos = snapshot.filter(({ tipoRegistro }) => [
    'senal', 'observacion', 'fotografiaSenal', 'reglaDerivacion', 'eventoDerivado'
  ].includes(tipoRegistro));
  const contextos = [];
  for (const captura of candidatos) {
    contextos.push({
      captura,
      contexto: await crearElemento({
        sql,
        adaptador,
        installationRemotaId: base.installationRemotaId,
        elementoOrigenId: captura.elementoOrigenId,
        payload: captura.payload
      })
    });
  }
  const historico = await repositorio.listarObservaciones({ limite: 10 });
  assert.deepEqual(
    historico.map(({ payload }) => [payload.tipoDato, payload.valor]).sort(),
    [
      ['duracion', 3723.4567],
      ['momento_utc', '2031-05-07T08:09:10Z']
    ]
  );
  const estados = await repositorio.listarEstadosSenalSeleccionables();
  assert.deepEqual(
    estados.map(({ payload }) => [
      payload.observacion.tipoDato,
      payload.observacion.valor
    ]).sort(),
    [
      ['duracion', 3723.4567],
      ['momento_utc', '2031-05-07T08:09:10Z']
    ]
  );
  const reglas = await repositorio.listarActuales({ tipoRegistro: 'reglaDerivacion' });
  const eventos = await repositorio.listarActuales({ tipoRegistro: 'eventoDerivado' });
  const senales = await repositorio.listarActuales({ tipoRegistro: 'senal' });
  assert.equal(senales.length, 2);
  assert.deepEqual(senales.map(({ payload }) => payload.tipoDato).sort(), [
    'duracion', 'momento_utc'
  ]);
  assert.equal(reglas.length, 2);
  assert.equal(eventos.length, 2);
  assert.deepEqual(
    eventos.map(({ payload }) => [payload.tipoDato, payload.valorEvaluado]).sort(),
    [
      ['duracion', 3723.4567],
      ['momento_utc', '2031-05-07T08:09:10Z']
    ]
  );

  const versiones = await sql.consultar(
    `SELECT version_familia,COUNT(*) AS total
       FROM flujos_federacion
      WHERE familia='telemetria'
      GROUP BY version_familia`
  );
  assert.deepEqual(
    versiones.map(({ version_familia }) => Number(version_familia)),
    [1]
  );
  const flujosDuplicados = await sql.consultar(
    `SELECT relacion_id,direccion,familia,COUNT(*) AS total
       FROM flujos_federacion
      GROUP BY relacion_id,direccion,familia
     HAVING COUNT(*)>1`
  );
  assert.deepEqual(flujosDuplicados, []);
  const duplicadas = await sql.consultar(
    `SELECT flujo_id,ordinal,COUNT(*) AS total
       FROM generaciones_flujos_federacion
      GROUP BY flujo_id,ordinal
     HAVING COUNT(*)>1`
  );
  assert.deepEqual(duplicadas, []);
  const proyeccionesDuplicadas = await sql.consultar(
    `SELECT installation_origen_id,familia,elemento_origen_id,COUNT(*) AS total
       FROM proyecciones_federacion
      GROUP BY installation_origen_id,familia,elemento_origen_id
     HAVING COUNT(*)>1`
  );
  assert.deepEqual(proyeccionesDuplicadas, []);

  const duracion = contextos.find(({ captura }) =>
    captura.tipoRegistro === 'fotografiaSenal' &&
    captura.payload.observacion.tipoDato === 'duracion'
  );
  const retirada = await recibirYReclamar({
    sql,
    contexto: duracion.contexto,
    secuencia: 2,
    operacion: 'retirada',
    payload: null
  });
  await materializar({
    sql,
    adaptador,
    trabajo: retirada,
    operacion: 'retirada',
    payload: null
  });
  await duracion.contexto.cicloTrabajos.completar(contextoCierre(retirada));
  await publicarHasta(
    sql,
    duracion.contexto.ids.proyeccionId,
    duracion.contexto.ids.generacionId,
    '2'
  );
  const trasRetirada = await repositorio.listarEstadosSenalSeleccionables();
  assert.equal(trasRetirada.length, 1);
  assert.equal(trasRetirada[0].payload.observacion.tipoDato, 'momento_utc');
}

async function verificarRefederacionTransparente(snapshot) {
  const payload = snapshot.find(
    ({ tipoRegistro, payload: valor }) =>
      tipoRegistro === 'observacion' && valor.tipoDato === 'duracion'
  ).payload;
  const ocurrencia = {
    protocoloVersion: 1,
    familia: 'telemetria',
    familiaVersion: 1,
    installationOrigenId: 'instalacion-a',
    elementoOrigenId: 'elemento-temporal',
    ocurrenciaOrigenId: 'ocurrencia-temporal',
    secuenciaElemento: '1',
    operacion: 'actualizacion',
    tiempoOrigenUtc: '2031-05-06T07:08:09.123Z',
    scopeOrigenDeclarado: {
      nivel: 'portal', tenantId: null, empresaId: null, sitioId: null
    },
    vigenciaRestanteMs: null,
    campos: { telemetria: crearCampoPresenteFederado({ valor: payload }) },
    evidenciaIntegridad: []
  };
  const capturas = [];
  const encoladas = [];
  const servicio = new ServicioRefederacionFederacion({
    repositorioOcurrencias: {
      clienteSql: { async obtenerConexion() { throw new Error('No usado.'); } },
      async registrarOcurrenciaRefederadaEnTransaccion(entrada) {
        capturas.push(entrada);
        return {
          estado: 'creada',
          posiciones: entrada.destinos.map((destino) => ({
            ...destino,
            posicionFlujo: '1',
            estado: 'asignada'
          }))
        };
      }
    },
    repositorioOutbox: {
      async encolarPosicionesEnTransaccion(posiciones) {
        encoladas.push(...posiciones);
      }
    }
  });
  const conexion = conexionRefederacion();
  const resultado = await servicio.registrarDesdeRecepcionEnTransaccion({
    lote: { relacionId: 'relacion-entrada' },
    entrega: {
      ocurrencia,
      procedencia: {
        installationEmisoraId: 'instalacion-a',
        bootEmisorId: 'arranque-a',
        recorridoInstalaciones: ['instalacion-a'],
        tiemposSaltosDisponibles: []
      }
    },
    inboxId: '1',
    proyeccionId: 'proyeccion-temporal',
    contribucionId: 'contribucion-temporal'
  }, { conexion });
  assert.equal(resultado.totalDescendientes, 1);
  assert.equal(encoladas.length, 1);
  assert.deepEqual(capturas[0].ocurrencia, ocurrencia);
  const refederado = capturas[0].ocurrencia.campos.telemetria.valor;
  assert.equal(refederado.version, 1);
  assert.equal(refederado.tipoDato, 'duracion');
  assert.equal(refederado.valor, 3723.4567);
  assert.deepEqual(validarPayloadTelemetriaFederacion(refederado), payload);
}

async function crearBaseFederable(sql) {
  const alias = `fixture-5243-${randomBytes(4).toString('hex')}`;
  const [tenant] = await sql.ejecutar(
    'INSERT INTO tenants (nombre,alias) VALUES (?,?)',
    ['Tenant 5.24.3', alias]
  );
  const [empresa] = await sql.ejecutar(
    'INSERT INTO empresas (tenant_id,nombre,alias) VALUES (?,?,?)',
    [tenant.insertId, 'Empresa 5.24.3', alias]
  );
  const [sitio] = await sql.ejecutar(
    'INSERT INTO sitios (tenant_id,empresa_id,nombre,alias) VALUES (?,?,?,?)',
    [tenant.insertId, empresa.insertId, 'Sitio 5.24.3', alias]
  );
  await sql.ejecutar(
    `INSERT INTO usuarios (
       id,usuario,email,hash_password,activo,permiso_configurar_emisiones_federacion
     ) VALUES (?,?,?,?,1,1)`,
    [USUARIO_FIXTURE, 'fixture-5243', 'fixture-5243@invalid.local', 'sin-login']
  );
  const ahoraSql = '2031-05-06 07:08:09.123';
  const identidadesOrg = {
    tenant: id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN),
    empresa: id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN),
    sitio: id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN)
  };
  for (const [tipo, local, nombre, empresaScope, sitioScope] of [
    ['tenant', tenant.insertId, 'Tenant 5.24.3', null, null],
    ['empresa', empresa.insertId, 'Empresa 5.24.3', empresa.insertId, null],
    ['sitio', sitio.insertId, 'Sitio 5.24.3', empresa.insertId, sitio.insertId]
  ]) {
    await sql.ejecutar(
      `INSERT INTO identidades_estructura_organizativa_federacion (
         tipo_nodo,id_local,elemento_origen_id,estado,nombre_ultimo,
         scope_tenant_id,scope_empresa_id,scope_sitio_id,
         creada_en_utc,actualizada_en_utc,retirada_en_utc,version_registro
       ) VALUES (?,?,?,'vigente',?,?,?,?,?,?,NULL,1)`,
      [
        tipo, local, identidadesOrg[tipo], nombre, tenant.insertId,
        empresaScope, sitioScope, ahoraSql, ahoraSql
      ]
    );
  }
  const guid = randomUUID();
  const [agente] = await sql.ejecutar(
    `INSERT INTO agentes_sentinelia (
       guid,tenant_id,empresa_id,sitio_id,nombre,descripcion,secreto_hash
     ) VALUES (?,?,?,?,?,?,?)`,
    [
      guid, tenant.insertId, empresa.insertId, sitio.insertId,
      'Agente temporal 5.24.3', 'Origen federable temporal', 'sin-secreto-utilizable'
    ]
  );
  await sql.ejecutar(
    `INSERT INTO identidades_contexto_operativo_agentes_federacion (
       agente_id_local,elemento_origen_id,guid_ultimo,nombre_ultimo,
       scope_tenant_id,scope_empresa_id,scope_sitio_id,estado,
       creada_en_utc,actualizada_en_utc,retirada_en_utc,version_registro
     ) VALUES (?,?,?,?,?,?,?,'vigente',?,?,NULL,1)`,
    [
      agente.insertId, id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN), guid,
      'Agente temporal 5.24.3', tenant.insertId, empresa.insertId, sitio.insertId,
      ahoraSql, ahoraSql
    ]
  );
  return {
    tenantId: String(tenant.insertId),
    empresaId: String(empresa.insertId),
    sitioId: String(sitio.insertId),
    agenteId: String(agente.insertId),
    installationLocalId: id(TIPOS_IDENTIDAD_FEDERADA.INSTALACION),
    installationRemotaId: id(TIPOS_IDENTIDAD_FEDERADA.INSTALACION),
    flujoId: id(TIPOS_IDENTIDAD_FEDERADA.FLUJO),
    generacionId: id(TIPOS_IDENTIDAD_FEDERADA.GENERACION),
    relacionId: id(TIPOS_IDENTIDAD_FEDERADA.RELACION),
    bootId: id(TIPOS_IDENTIDAD_FEDERADA.ARRANQUE)
  };
}

async function crearReglaEvaluada(sql, { senal, observacion, valor, ...base }) {
  const [regla] = await sql.ejecutar(
    `INSERT INTO reglas_derivacion_telemetria (
       agente_id,senal_id,tenant_id,empresa_id,sitio_id,estado
     ) VALUES (?,?,?,?,?,'activa')`,
    [base.agenteId, senal.id, base.tenantId, base.empresaId, base.sitioId]
  );
  const condicion = JSON.stringify({
    tipo: 'calidad',
    version: 1,
    configuracion: { operador: '=', calidadEsperada: 'estimada' }
  });
  const [revision] = await sql.ejecutar(
    `INSERT INTO revisiones_reglas_derivacion_telemetria (
       regla_id,numero,condicion_tipo,condicion_version,condicion_canonica,
       severidad_calculada,mensaje_operativo,nombre,descripcion,
       metadatos_descriptivos,vigente_desde_utc
     ) VALUES (?,1,'calidad',1,?,'advertencia',?,?,NULL,NULL,
       '2031-05-06 07:00:00')`,
    [regla.insertId, condicion, `Calidad de ${senal.codigoSenal}`, `Regla ${senal.tipoDato}`]
  );
  await sql.ejecutar(
    'UPDATE reglas_derivacion_telemetria SET revision_vigente_id=? WHERE id=?',
    [revision.insertId, regla.insertId]
  );
  const columnas = `regla_id,regla_revision_id,observacion_id,agente_id,senal_id,
    tenant_id,empresa_id,sitio_id,resultado,codigo_motivo,explicacion,
    condicion_canonica,valor_evaluado,tipo_dato,unidad,calidad,severidad_calculada,
    mensaje_operativo,evidencia_contextual,observado_en_utc,recibido_en_utc,evaluado_en_utc`;
  const parametros = [
    regla.insertId, revision.insertId, observacion.id, base.agenteId, senal.id,
    base.tenantId, base.empresaId, base.sitioId, 'coincide', 'calidad_esperada',
    'La calidad coincide.', condicion, JSON.stringify(valor), senal.tipoDato, '',
    'estimada', 'advertencia', `Calidad de ${senal.codigoSenal}`,
    JSON.stringify({ tipoDato: senal.tipoDato }),
    '2031-05-06 07:08:01', '2031-05-06 07:08:09', '2031-05-06 07:08:10'
  ];
  const marcas = Array(parametros.length).fill('?').join(',');
  await sql.ejecutar(
    `INSERT INTO estado_actual_evaluacion_reglas_telemetria (${columnas})
     VALUES (${marcas})`,
    parametros
  );
  const [evento] = await sql.ejecutar(
    `INSERT INTO eventos_derivados_telemetria (${columnas},creado_en_utc)
     VALUES (${marcas},'2031-05-06 07:08:11')`,
    parametros
  );
  return { reglaId: String(regla.insertId), eventoId: String(evento.insertId) };
}

async function crearFlujoSnapshot(sql, base) {
  await sql.ejecutar(
    `INSERT INTO relaciones_federacion (
       relacion_id,direccion,estado_ciclo,estado_autoridad,estado_identidad,
       estado_compatibilidad,installation_remota_candidata_id,installation_remota_id,
       nombre_remoto_declarado,responsable_usuario_id,responsable_original_usuario_id,
       scope_tenant_id,scope_empresa_id,scope_sitio_id,version_autoridad,
       creada_por_usuario_id,creada_en_utc,actualizada_en_utc,revision
     ) VALUES (?,'emision','vinculada','autorizada','valida','compatible',?,?,?,
       ?,?,?,?,?,1,?,?,?,1)`,
    [
      base.relacionId, base.installationRemotaId, base.installationRemotaId,
      'remota 5.24.3', USUARIO_FIXTURE, USUARIO_FIXTURE, base.tenantId,
      base.empresaId, base.sitioId, USUARIO_FIXTURE, AHORA, AHORA
    ]
  );
  await sql.ejecutar(
    `INSERT INTO flujos_federacion (
       flujo_id,relacion_id,direccion,familia,version_familia,estado,
       scope_nivel,scope_tenant_id,scope_empresa_id,scope_sitio_id,
       creada_en_utc,actualizada_en_utc
     ) VALUES (?,?,'emision','telemetria',1,'sinSincronizar','sitio',?,?,?,?,?)`,
    [
      base.flujoId, base.relacionId, base.tenantId, base.empresaId,
      base.sitioId, AHORA, AHORA
    ]
  );
  await sql.ejecutar(
    `INSERT INTO generaciones_flujos_federacion (
       generacion_id,flujo_id,ordinal,clase,estado,installation_propietaria_id,
       boot_propietario_id,version_propietario,creada_en_utc,actualizada_en_utc
     ) VALUES (?,?,1,'inicial','preparada',?,?,1,?,?)`,
    [
      base.generacionId, base.flujoId, base.installationLocalId,
      base.bootId, AHORA, AHORA
    ]
  );
}

function payloadSenal({ fuente, senal, tipo }) {
  return {
    perfil: PERFIL_PAYLOAD_TELEMETRIA_FEDERACION,
    version: VERSION_PAYLOAD_TELEMETRIA_FEDERACION,
    tipoRegistro: 'senal',
    fuenteOrigenId: fuente,
    categoria: 'copias', clave: tipo, tag: '', codigoSenal: `copias.${tipo}`,
    tipoDato: tipo, unidad: '', nombreHumano: tipo, descripcion: '',
    metadatosDescriptivos: null,
    consolidadaEnUtc: '2031-05-06T07:08:00.000Z',
    ultimaDeclaracionUtc: '2031-05-06T07:08:01.000Z'
  };
}

function payloadObservacion({ fuente, senal, tipo, valor }) {
  return {
    perfil: PERFIL_PAYLOAD_TELEMETRIA_FEDERACION,
    version: VERSION_PAYLOAD_TELEMETRIA_FEDERACION,
    tipoRegistro: 'observacion',
    fuenteOrigenId: fuente, senalOrigenId: senal, periodoPolOrigenId: null,
    categoria: 'copias', clave: tipo, tag: '', codigoSenal: `copias.${tipo}`,
    tipoDato: tipo, unidad: '', valor, calidad: 'estimada',
    severidadDeclarada: 'info', origen: 'directa', vigenteHastaUtc: null,
    detalleHumano: null, metadatosContextuales: null, emitidoEnUtc: null,
    observadoEnUtc: '2031-05-06T07:08:00.000Z',
    recibidoEnUtc: '2031-05-06T07:08:09.123Z'
  };
}

function payloadFotografia({ senal, observacionOrigenId, observacion }) {
  const { perfil: _p, version: _v, tipoRegistro: _t, ...cuerpo } = observacion;
  return {
    perfil: PERFIL_PAYLOAD_TELEMETRIA_FEDERACION,
    version: VERSION_PAYLOAD_TELEMETRIA_FEDERACION,
    tipoRegistro: 'fotografiaSenal',
    senalOrigenId: senal,
    observacionOrigenId,
    secuenciaSenal: '1',
    observacion: cuerpo
  };
}

function payloadReglaReservada({
  fuente, senal, observacion, regla, revision, tipo, valor,
  tipoCondicion = tipo,
  condicion = condicionTemporal(tipo)
}) {
  const estadoActual = {
    revisionOrigenId: revision,
    observacionOrigenId: observacion,
    resultado: 'coincide',
    codigoMotivo: 'condicion_cumplida',
    explicacion: 'La condición se cumple.',
    valorEvaluado: valor,
    tipoDato: tipo,
    unidad: tipo === 'numero' ? '%' : '',
    calidad: 'estimada',
    severidadCalculada: 'advertencia',
    mensajeOperativo: 'Condición cumplida.',
    evidenciaContextual: null,
    observadoEnUtc: '2031-05-06T07:08:00.000Z',
    recibidoEnUtc: '2031-05-06T07:08:09.123Z',
    evaluadoEnUtc: '2031-05-06T07:08:10.000Z'
  };
  return {
    perfil: PERFIL_PAYLOAD_TELEMETRIA_FEDERACION,
    version: VERSION_PAYLOAD_TELEMETRIA_FEDERACION,
    tipoRegistro: 'reglaDerivacion',
    fuenteOrigenId: fuente,
    senalOrigenId: senal,
    estado: 'activa',
    revisionVigenteOrigenId: revision,
    revisiones: [{
      revisionOrigenId: revision,
      numero: '1',
      condicionTipo: tipoCondicion,
      condicionVersion: '1',
      condicion,
      severidadCalculada: 'advertencia',
      mensajeOperativo: 'Condición cumplida.',
      nombre: 'Regla temporal',
      descripcion: null,
      metadatosDescriptivos: null,
      vigenteDesdeUtc: '2031-05-06T07:00:00.000Z',
      vigenteHastaUtc: null
    }],
    estadoActual
  };
}

function payloadEventoReservado({
  fuente, senal, observacion, regla, revision, tipo, valor
}) {
  return {
    perfil: PERFIL_PAYLOAD_TELEMETRIA_FEDERACION,
    version: VERSION_PAYLOAD_TELEMETRIA_FEDERACION,
    tipoRegistro: 'eventoDerivado',
    reglaOrigenId: regla,
    revisionOrigenId: revision,
    observacionOrigenId: observacion,
    fuenteOrigenId: fuente,
    senalOrigenId: senal,
    evento: 'coincide',
    codigoMotivo: 'condicion_cumplida',
    explicacion: 'La condición se cumple.',
    condicion: condicionTemporal(tipo),
    valorEvaluado: valor,
    tipoDato: tipo,
    unidad: '',
    calidad: 'estimada',
    severidadCalculada: 'advertencia',
    mensajeOperativo: 'Condición cumplida.',
    evidenciaContextual: null,
    observadoEnUtc: '2031-05-06T07:08:00.000Z',
    recibidoEnUtc: '2031-05-06T07:08:09.123Z',
    evaluadoEnUtc: '2031-05-06T07:08:10.000Z',
    creadoEnUtc: '2031-05-06T07:08:11.000Z'
  };
}

function condicionTemporal(tipo) {
  if (tipo === 'duracion') {
    return {
      tipo, version: 1,
      configuracion: { operador: '>=', umbral: 90.5 }
    };
  }
  return {
    tipo: 'momento_utc', version: 1,
    configuracion: { operador: '<=', umbralUtc: '2031-05-07T08:09:10Z' }
  };
}

function condicionRegexConteo() {
  return {
    tipo: 'texto_regex',
    version: 1,
    configuracion: {
      modo: 'conteo', patron: 'copia', opciones: ['i', 'm'],
      operador: '>=', umbral: 2
    }
  };
}

function contarTipos(capturas) {
  return capturas.reduce((totales, { tipoRegistro }) => {
    totales[tipoRegistro] = (totales[tipoRegistro] || 0) + 1;
    return totales;
  }, {});
}

function conexionRefederacion() {
  return {
    async execute(consulta) {
      if (consulta.includes('SELECT recibida_en_utc FROM inbox_ocurrencias_federacion')) {
        return [[{ recibida_en_utc: AHORA }]];
      }
      if (consulta.includes('EXISTS(SELECT 1 FROM retiradas_origen')) {
        return [[{ retirada: 0, salida: 0 }]];
      }
      if (consulta.includes('FROM proyecciones_federacion p')) {
        return [[{
          flujo_id: 'flujo-temporal',
          generacion_activa_id: 'generacion-temporal',
          relacion_id: 'relacion-temporal',
          installation_remota_id: 'instalacion-b'
        }]];
      }
      if (consulta.includes('INSERT INTO descendientes_refederacion_federacion')) {
        return [{ affectedRows: 1 }];
      }
      throw new Error(`SQL inesperado en refederación 5.24.3: ${consulta}`);
    },
    async query(consulta) {
      if (consulta.includes('UTC_TIMESTAMP')) return [[{ ahora: AHORA }]];
      return this.execute(consulta);
    }
  };
}

async function transaccion(sql, callback) {
  const conexion = await sql.obtenerConexion();
  try {
    await conexion.beginTransaction();
    const resultado = await callback(conexion);
    await conexion.commit();
    return resultado;
  } catch (error) {
    await conexion.rollback().catch(() => {});
    throw error;
  } finally {
    conexion.release();
  }
}

function id(tipo) {
  return String(generador.generar(tipo));
}
