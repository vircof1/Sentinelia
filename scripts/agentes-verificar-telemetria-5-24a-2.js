import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';

import {
  crearLecturaTelemetriaAgenteConTiposInternos
} from '../paquetes/agentes/src/TelemetriaAgente.js';
import {
  crearCondicionMomentoUtcRelativo
} from '../paquetes/agentes/src/EvaluadorMomentoUtcRelativoTelemetria.js';
import {
  RepositorioEstadoActualEvaluacionReglasTelemetria,
  RepositorioEvaluacionesReglasTelemetria,
  RepositorioEventosDerivadosTelemetria
} from '../paquetes/agentes/src/RepositorioEvaluacionesDerivadasTelemetria.js';
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
  CAUSAS_TRABAJO_EVALUACION_TELEMETRIA,
  RepositorioTrabajosEvaluacionTelemetria
} from '../paquetes/agentes/src/RepositorioTrabajosEvaluacionTelemetria.js';
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
  validarPayloadTelemetriaFederacion
} from '../paquetes/federacion/src/PayloadTelemetriaFederacion.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import {
  obtenerConfiguracionAplicacion
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';
import {
  crearElemento,
  migrar
} from './federacion-verificar-5-22-15g.js';

const AHORA = new Date('2032-01-02T03:04:05.000Z');
const USUARIO = 5_242_001;
const generador = new GeneradorIdentidadesFederadas({
  fuenteEntropia: new FuenteEntropiaCriptograficaNode()
});

await main();

async function main() {
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true, '5.24a.2 necesita MariaDB real.');
  const administrador = new ClienteSql(configuracion.sql);
  const nombre = `sentinelia_fixture_524a2_${randomBytes(5).toString('hex')}`;
  let sql;
  try {
    await administrador.ejecutar(
      `CREATE DATABASE ${administrador.escaparIdentificador(nombre)} ` +
      'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
    );
    sql = new ClienteSql({ ...configuracion.sql, baseDatos: nombre });
    await migrar(sql);
    await sql.verificarUsoHorarioUtc();
    const base = await crearBase(sql);
    const agregado = await crearAgregadoRelativo(sql, base);
    const capturas = await verificarCapturaPreparada(sql, base, agregado);
    await verificarMaterializacionPreparada(sql, base, capturas);
    await verificarRefederacion(capturas);
    await verificarRetiradaPreparada(sql, base, agregado);
    console.log(
      '[agentes] OK 5.24a.2: federacion=relativa_preparada compuerta=cerrada ' +
      'payload=estricto evaluacion=opaca evidencia=temporal ' +
      'snapshot=regla_evento materializacion=canonica refederacion=transparente'
    );
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(nombre)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

async function crearBase(sql) {
  const alias = `f524a2-${randomBytes(4).toString('hex')}`;
  const [tenant] = await sql.ejecutar('INSERT INTO tenants (nombre,alias) VALUES (?,?)',
    ['Tenant 5.24a.2', alias]);
  const [empresa] = await sql.ejecutar(
    'INSERT INTO empresas (tenant_id,nombre,alias) VALUES (?,?,?)',
    [tenant.insertId, 'Empresa 5.24a.2', alias]
  );
  const [sitio] = await sql.ejecutar(
    'INSERT INTO sitios (tenant_id,empresa_id,nombre,alias) VALUES (?,?,?,?)',
    [tenant.insertId, empresa.insertId, 'Sitio 5.24a.2', alias]
  );
  await sql.ejecutar(
    `INSERT INTO usuarios
      (id,usuario,email,hash_password,activo,permiso_configurar_emisiones_federacion)
     VALUES (?,?,?,?,1,1)`,
    [USUARIO, 'fixture-524a2', 'fixture-524a2@invalid.local', 'sin-login']
  );
  const scope = {
    tenantId: String(tenant.insertId), empresaId: String(empresa.insertId),
    sitioId: String(sitio.insertId)
  };
  const ahoraSql = '2032-01-02 03:04:05.000';
  for (const [tipo, local, empresaScope, sitioScope] of [
    ['tenant', scope.tenantId, null, null],
    ['empresa', scope.empresaId, scope.empresaId, null],
    ['sitio', scope.sitioId, scope.empresaId, scope.sitioId]
  ]) {
    await sql.ejecutar(
      `INSERT INTO identidades_estructura_organizativa_federacion (
         tipo_nodo,id_local,elemento_origen_id,estado,nombre_ultimo,
         scope_tenant_id,scope_empresa_id,scope_sitio_id,
         creada_en_utc,actualizada_en_utc,retirada_en_utc,version_registro
       ) VALUES (?,?,?,'vigente',?,?,?,?,?,?,NULL,1)`,
      [tipo, local, id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN), tipo,
        scope.tenantId, empresaScope, sitioScope, ahoraSql, ahoraSql]
    );
  }
  const guid = randomUUID();
  const [agente] = await sql.ejecutar(
    `INSERT INTO agentes_sentinelia
      (guid,tenant_id,empresa_id,sitio_id,nombre,secreto_hash)
     VALUES (?,?,?,?,?,?)`,
    [guid, scope.tenantId, scope.empresaId, scope.sitioId,
      'Agente relativo federado', 'sin-secreto-utilizable']
  );
  await sql.ejecutar(
    `INSERT INTO identidades_contexto_operativo_agentes_federacion (
       agente_id_local,elemento_origen_id,guid_ultimo,nombre_ultimo,
       scope_tenant_id,scope_empresa_id,scope_sitio_id,estado,
       creada_en_utc,actualizada_en_utc,retirada_en_utc,version_registro
     ) VALUES (?,?,?,?,?,?,?,'vigente',?,?,NULL,1)`,
    [agente.insertId, id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN), guid,
      'Agente relativo federado', scope.tenantId, scope.empresaId, scope.sitioId,
      ahoraSql, ahoraSql]
  );
  const base = {
    ...scope,
    agenteId: String(agente.insertId),
    installationLocalId: id(TIPOS_IDENTIDAD_FEDERADA.INSTALACION),
    installationRemotaId: id(TIPOS_IDENTIDAD_FEDERADA.INSTALACION),
    flujoId: id(TIPOS_IDENTIDAD_FEDERADA.FLUJO),
    generacionId: id(TIPOS_IDENTIDAD_FEDERADA.GENERACION),
    relacionId: id(TIPOS_IDENTIDAD_FEDERADA.RELACION),
    bootId: id(TIPOS_IDENTIDAD_FEDERADA.ARRANQUE)
  };
  await crearFlujo(sql, base);
  return base;
}

async function crearAgregadoRelativo(sql, base) {
  const catalogo = new RepositorioCatalogoSenalesTelemetriaAgentes(sql);
  const senal = await catalogo.guardarDeclaracionSenal({
    agenteId: base.agenteId,
    definicion: {
      categoria: 'copias', clave: 'proxima', tipoDato: 'momento_utc',
      nombreHumano: 'Próxima copia'
    }
  });
  const observaciones = new RepositorioObservacionesTelemetriaAgentes(sql);
  const lote = await observaciones.insertarLoteAceptado({
    agenteId: base.agenteId,
    senalesCatalogadas: [senal],
    recibidoEnUtc: '2032-01-02T03:04:00Z',
    observacionesAceptadas: [crearLecturaTelemetriaAgenteConTiposInternos({
      categoria: 'copias', clave: 'proxima', tipoDato: 'momento_utc',
      valorMomentoUtc: '2032-01-02T01:00:00Z', calidad: 'valida',
      observadoEnUtc: '2032-01-02T03:03:59Z'
    })]
  });
  const observacion = lote.insertadas[0];
  await new RepositorioEstadoActualTelemetriaAgentes(sql)
    .aplicarObservacionesHistoricas([observacion]);
  const condicion = crearCondicionMomentoUtcRelativo({
    forma: 'limite_inferior',
    limite: { direccion: 'pasado', segundos: '3600' },
    histeresisSegundos: '60'
  });
  const [reglaFila] = await sql.ejecutar(
    `INSERT INTO reglas_derivacion_telemetria
      (agente_id,senal_id,tenant_id,empresa_id,sitio_id,estado,generacion_autoridad)
     VALUES (?,?,?,?,?,'activa',1)`,
    [base.agenteId, senal.id, base.tenantId, base.empresaId, base.sitioId]
  );
  const [revisionFila] = await sql.ejecutar(
    `INSERT INTO revisiones_reglas_derivacion_telemetria
      (regla_id,numero,condicion_tipo,condicion_version,condicion_canonica,
       severidad_calculada,mensaje_operativo,nombre,vigente_desde_utc)
     VALUES (?,1,'momento_utc_relativo',1,?,'advertencia',?,?,?)`,
    [reglaFila.insertId, condicion.obtenerCanonica(),
      'La copia está demasiado atrás.', 'Próxima copia relativa',
      '2032-01-02 03:00:00']
  );
  await sql.ejecutar(
    'UPDATE reglas_derivacion_telemetria SET revision_vigente_id=? WHERE id=?',
    [revisionFila.insertId, reglaFila.insertId]
  );
  const regla = {
    id: Number(reglaFila.insertId), agenteId: Number(base.agenteId),
    senalId: Number(senal.id), tenantId: Number(base.tenantId),
    empresaId: Number(base.empresaId), sitioId: Number(base.sitioId),
    generacionAutoridad: 1
  };
  const revision = {
    id: Number(revisionFila.insertId), reglaId: regla.id,
    vigenteDesdeUtc: '2032-01-02T03:00:00Z', vigenteHastaUtc: null
  };
  const trabajo = (await new RepositorioTrabajosEvaluacionTelemetria(sql).encolar({
    observacion, regla, revision,
    causa: CAUSAS_TRABAJO_EVALUACION_TELEMETRIA.RECONCILIACION_ADMINISTRATIVA
  })).trabajo;
  const evaluacion = (await new RepositorioEvaluacionesReglasTelemetria(sql).registrar({
    trabajo,
    evaluacion: {
      reglaId: regla.id, revisionId: revision.id, observacionId: observacion.id,
      agenteId: regla.agenteId, senalId: regla.senalId,
      tenantId: regla.tenantId, empresaId: regla.empresaId, sitioId: regla.sitioId,
      generacionAutoridad: 1, causalidadRevision: 'autoridad_actual',
      resultado: 'coincide', ladoAtencion: 'inferior',
      resultadoAnterior: null, ladoAnterior: null,
      momentoUtc: '2032-01-02T01:00:00Z', ahoraUtc: AHORA.toISOString(),
      desviacionSegundos: '-7445', proximaReevaluacionUtc: null,
      codigoMotivo: 'condicion_temporal_relativa_cumplida',
      explicacion: 'La fecha comunicada queda por debajo del límite relativo.',
      condicionCanonica: condicion.obtenerCanonica(),
      valorEvaluado: '2032-01-02T01:00:00Z', tipoDato: 'momento_utc',
      unidad: null, calidad: 'valida', severidadCalculada: 'advertencia',
      mensajeOperativo: 'La copia está demasiado atrás.',
      evidenciaContextual: { temporal: { forma: 'limite_inferior' } },
      observadoEnUtc: observacion.observadoEnUtc,
      recibidoEnUtc: observacion.recibidoEnUtc,
      evaluadoEnUtc: AHORA.toISOString()
    }
  })).evaluacion;
  const estado = await new RepositorioEstadoActualEvaluacionReglasTelemetria(sql)
    .aplicarResultado(evaluacion);
  const evento = await new RepositorioEventosDerivadosTelemetria(sql)
    .insertarSiCoincide(evaluacion);
  assert.equal(estado.actualizado, true);
  assert.equal(evento.creado, true);
  return { reglaId: regla.id, eventoId: evento.evento.id, evaluacionId: evaluacion.id };
}

async function verificarCapturaPreparada(sql, base, agregado) {
  const cerrado = new RepositorioTelemetriaLocalSql(sql, {
    installationLocalId: base.installationLocalId,
    generadorIdentidades: generador,
    ahora: () => AHORA
  });
  await assert.rejects(
    transaccion(sql, (conexion) => cerrado.prepararCapturaEnTransaccion({
      tipoRegistro: 'reglaDerivacion', idLocal: agregado.reglaId
    }, { conexion })),
    (error) => error?.codigo === 'capacidad_momento_utc_relativo_cerrada'
  );
  const preparado = new RepositorioTelemetriaLocalSql(sql, {
    installationLocalId: base.installationLocalId,
    generadorIdentidades: generador,
    ahora: () => AHORA,
    permitirMomentoUtcRelativo: true
  });
  const snapshot = await transaccion(sql, (conexion) =>
    preparado.listarCapturasEnTransaccion({
      flujoId: base.flujoId, generacionId: base.generacionId
    }, { conexion })
  );
  const regla = snapshot.find(
    ({ tipoRegistro, idLocal }) => tipoRegistro === 'reglaDerivacion' &&
      String(idLocal) === String(agregado.reglaId)
  );
  const evento = snapshot.find(
    ({ tipoRegistro, idLocal }) => tipoRegistro === 'eventoDerivado' &&
      String(idLocal) === String(agregado.eventoId)
  );
  assert.ok(regla && evento);
  for (const captura of [regla, evento]) {
    assert.deepEqual(captura.definicion.scopeOrigenDeclarado, {
      nivel: 'sitio', tenantId: base.tenantId,
      empresaId: base.empresaId, sitioId: base.sitioId
    });
    assert.equal(JSON.stringify(captura.payload).includes(`"evaluacionOrigenId":${agregado.evaluacionId}`), false);
  }
  assert.equal(regla.payload.generacionAutoridad, '1');
  assert.equal(regla.payload.revisiones[0].condicionTipo, 'momento_utc_relativo');
  assert.equal(regla.payload.estadoActual.causa, 'reconciliacion_administrativa');
  assert.equal(regla.payload.estadoActual.ladoAtencion, 'inferior');
  assert.match(regla.payload.estadoActual.evaluacionOrigenId,
    /^sfid1\.elemento_origen\./u);
  assert.equal(evento.payload.evaluacionOrigenId,
    regla.payload.estadoActual.evaluacionOrigenId);
  assert.deepEqual(evento.payload.evidenciaTemporal, {
    momentoUtc: '2032-01-02T01:00:00.000Z',
    ahoraUtc: AHORA.toISOString(),
    desviacionSegundos: '-7445',
    resultadoAnterior: null,
    ladoAnterior: null,
    programadoParaUtc: null,
    proximaReevaluacionUtc: null,
    correccionReloj: null
  });
  assert.throws(
    () => validarPayloadTelemetriaFederacion(regla.payload),
    (error) => error?.codigo === 'capacidad_momento_utc_relativo_cerrada'
  );
  assert.deepEqual(
    validarPayloadTelemetriaFederacion(regla.payload, {
      permitirMomentoUtcRelativo: true
    }),
    regla.payload
  );
  const vocabularioDesconocido = structuredClone(regla.payload);
  vocabularioDesconocido.revisiones[0].condicionTipo = 'momento_utc_calendario';
  vocabularioDesconocido.revisiones[0].condicion.tipo = 'momento_utc_calendario';
  assert.throws(
    () => validarPayloadTelemetriaFederacion(vocabularioDesconocido, {
      permitirMomentoUtcRelativo: true
    }),
    (error) => [
      'forma_payload_telemetria_invalida',
      'tipo_condicion_regla_invalido'
    ].includes(error?.codigo)
  );
  return { regla, evento };
}

async function verificarMaterializacionPreparada(sql, base, capturas) {
  const repositorio = new RepositorioTelemetriaRemotaSql(sql, {
    permitirMomentoUtcRelativo: true
  });
  const adaptador = new AdaptadorTelemetriaFederacion({
    repositorioRemoto: repositorio,
    permitirMomentoUtcRelativo: true
  });
  for (const captura of [capturas.regla, capturas.evento]) {
    await crearElemento({
      sql,
      adaptador,
      installationRemotaId: base.installationRemotaId,
      elementoOrigenId: captura.elementoOrigenId,
      payload: captura.payload
    });
  }
  const reglas = await repositorio.listarActuales({ tipoRegistro: 'reglaDerivacion' });
  const eventos = await repositorio.listarActuales({ tipoRegistro: 'eventoDerivado' });
  assert.equal(reglas.length, 1);
  assert.equal(eventos.length, 1);
  assert.deepEqual(reglas[0].payload, capturas.regla.payload);
  assert.deepEqual(eventos[0].payload, capturas.evento.payload);

  const adaptadorCerrado = new AdaptadorTelemetriaFederacion({
    repositorioRemoto: new RepositorioTelemetriaRemotaSql(sql)
  });
  assert.throws(
    () => adaptadorCerrado.validarPayload(capturas.regla.payload),
    (error) => error?.codigo === 'capacidad_momento_utc_relativo_cerrada'
  );
}

async function verificarRefederacion(capturas) {
  const ocurrencia = {
    protocoloVersion: 1,
    familia: 'telemetria',
    familiaVersion: 1,
    installationOrigenId: 'instalacion-a',
    elementoOrigenId: 'regla-relativa',
    ocurrenciaOrigenId: 'ocurrencia-relativa',
    secuenciaElemento: '1',
    operacion: 'actualizacion',
    tiempoOrigenUtc: AHORA.toISOString(),
    scopeOrigenDeclarado: {
      nivel: 'sitio', tenantId: '1', empresaId: '2', sitioId: '3'
    },
    vigenciaRestanteMs: null,
    campos: {
      telemetria: crearCampoPresenteFederado({ valor: capturas.regla.payload })
    },
    evidenciaIntegridad: []
  };
  const registradas = [];
  const servicio = new ServicioRefederacionFederacion({
    repositorioOcurrencias: {
      clienteSql: { async obtenerConexion() { throw new Error('No usado.'); } },
      async registrarOcurrenciaRefederadaEnTransaccion(entrada) {
        registradas.push(entrada);
        return {
          estado: 'creada',
          posiciones: entrada.destinos.map((destino) => ({
            ...destino, posicionFlujo: '1', estado: 'asignada'
          }))
        };
      }
    },
    repositorioOutbox: {
      async encolarPosicionesEnTransaccion() {}
    }
  });
  await servicio.registrarDesdeRecepcionEnTransaccion({
    lote: { relacionId: 'relacion-entrada' },
    entrega: {
      ocurrencia,
      procedencia: {
        installationEmisoraId: 'instalacion-a', bootEmisorId: 'arranque-a',
        recorridoInstalaciones: ['instalacion-a'], tiemposSaltosDisponibles: []
      }
    },
    inboxId: '1', proyeccionId: 'proyeccion-relativa',
    contribucionId: 'contribucion-relativa'
  }, { conexion: conexionRefederacion() });
  assert.equal(registradas.length, 1);
  assert.deepEqual(
    registradas[0].ocurrencia.campos.telemetria.valor,
    capturas.regla.payload
  );
}

async function verificarRetiradaPreparada(sql, base, agregado) {
  const repositorio = new RepositorioTelemetriaLocalSql(sql, {
    installationLocalId: base.installationLocalId,
    generadorIdentidades: generador,
    ahora: () => new Date(AHORA.getTime() + 1000),
    permitirMomentoUtcRelativo: true
  });
  const retirada = await transaccion(sql, (conexion) =>
    repositorio.prepararRetiradaEnTransaccion({
      tipoRegistro: 'reglaDerivacion', idLocal: agregado.reglaId
    }, { conexion })
  );
  assert.equal(retirada.tipoRegistro, 'reglaDerivacion');
  assert.equal(retirada.definicion.operacion, 'retirada');
  assert.deepEqual(retirada.definicion.campos, {});
}

async function crearFlujo(sql, base) {
  await sql.ejecutar(
    `INSERT INTO relaciones_federacion (
       relacion_id,direccion,estado_ciclo,estado_autoridad,estado_identidad,
       estado_compatibilidad,installation_remota_candidata_id,installation_remota_id,
       nombre_remoto_declarado,responsable_usuario_id,responsable_original_usuario_id,
       scope_tenant_id,scope_empresa_id,scope_sitio_id,version_autoridad,
       creada_por_usuario_id,creada_en_utc,actualizada_en_utc,revision
     ) VALUES (?,'emision','vinculada','autorizada','valida','compatible',?,?,?,
       ?,?,?,?,?,1,?,?,?,1)`,
    [base.relacionId, base.installationRemotaId, base.installationRemotaId,
      'remota 5.24a.2', USUARIO, USUARIO, base.tenantId, base.empresaId,
      base.sitioId, USUARIO, AHORA, AHORA]
  );
  await sql.ejecutar(
    `INSERT INTO flujos_federacion (
       flujo_id,relacion_id,direccion,familia,version_familia,estado,
       scope_nivel,scope_tenant_id,scope_empresa_id,scope_sitio_id,
       creada_en_utc,actualizada_en_utc
     ) VALUES (?,?,'emision','telemetria',1,'sinSincronizar','sitio',?,?,?,?,?)`,
    [base.flujoId, base.relacionId, base.tenantId, base.empresaId,
      base.sitioId, AHORA, AHORA]
  );
  await sql.ejecutar(
    `INSERT INTO generaciones_flujos_federacion (
       generacion_id,flujo_id,ordinal,clase,estado,installation_propietaria_id,
       boot_propietario_id,version_propietario,creada_en_utc,actualizada_en_utc
     ) VALUES (?,?,1,'inicial','preparada',?,?,1,?,?)`,
    [base.generacionId, base.flujoId, base.installationLocalId,
      base.bootId, AHORA, AHORA]
  );
}

async function transaccion(sql, trabajo) {
  const conexion = await sql.obtenerConexion();
  try {
    await conexion.beginTransaction();
    const resultado = await trabajo(conexion);
    await conexion.commit();
    return resultado;
  } catch (error) {
    await conexion.rollback();
    throw error;
  } finally {
    conexion.release();
  }
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
          flujo_id: 'flujo-salida', generacion_activa_id: 'generacion-salida',
          relacion_id: 'relacion-salida', installation_remota_id: 'instalacion-b'
        }]];
      }
      if (consulta.includes('INSERT INTO descendientes_refederacion_federacion')) {
        return [{ affectedRows: 1 }];
      }
      throw new Error(`SQL inesperado en refederación 5.24a.2: ${consulta}`);
    },
    async query(consulta) {
      if (consulta.includes('UTC_TIMESTAMP')) return [[{ ahora: AHORA }]];
      return this.execute(consulta);
    }
  };
}

function id(tipo) {
  return String(generador.generar(tipo));
}
