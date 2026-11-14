import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';

import { ServicioRetiradaFederadaAgente }
  from '../paquetes/agentes/src/ServicioRetiradaFederadaAgente.js';
import { AdaptadorCapturaTransaccionalFederacionSql }
  from '../paquetes/federacion/adaptadores/AdaptadorCapturaTransaccionalFederacionSql.js';
import { FuenteEntropiaCriptograficaNode }
  from '../paquetes/federacion/adaptadores/FuenteEntropiaCriptograficaNode.js';
import { RepositorioContextoOperativoAgentesSesionesLocalSql }
  from '../paquetes/federacion/adaptadores/RepositorioContextoOperativoAgentesSesionesLocalSql.js';
import { RepositorioFlujosFederacionSql }
  from '../paquetes/federacion/adaptadores/RepositorioFlujosFederacionSql.js';
import { RepositorioMonitoresLocalSql }
  from '../paquetes/federacion/adaptadores/RepositorioMonitoresLocalSql.js';
import { RepositorioOcurrenciasFederacionSql }
  from '../paquetes/federacion/adaptadores/RepositorioOcurrenciasFederacionSql.js';
import { RepositorioOutboxFederacionSql }
  from '../paquetes/federacion/adaptadores/RepositorioOutboxFederacionSql.js';
import { RepositorioTelemetriaLocalSql }
  from '../paquetes/federacion/adaptadores/RepositorioTelemetriaLocalSql.js';
import { ServicioCapturaIncrementalFamiliasFederacion }
  from '../paquetes/federacion/aplicacion/ServicioCapturaIncrementalFamiliasFederacion.js';
import {
  GeneradorIdentidadesFederadas,
  TIPOS_IDENTIDAD_FEDERADA
} from '../paquetes/federacion/src/IdentidadFederada.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones } from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import {
  obtenerConfiguracionAplicacion,
  obtenerRutaMigraciones
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

const AHORA = new Date('2031-05-06T07:08:09.123Z');
const generador = new GeneradorIdentidadesFederadas({
  fuenteEntropia: new FuenteEntropiaCriptograficaNode()
});

await main();

async function main() {
  await verificarDistribucionPreparadaPorGrupos();
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true, '5.25.6b necesita MySQL real.');
  const baseDatos = `sentinelia_fixture_5256b_${randomBytes(6).toString('hex')}`;
  const administrador = new ClienteSql(configuracion.sql);
  await administrador.ejecutar(
    `CREATE DATABASE ${administrador.escaparIdentificador(baseDatos)} ` +
      'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
  );
  const sql = new ClienteSql({ ...configuracion.sql, baseDatos });
  try {
    await new EjecutorMigraciones({
      clienteSql: sql,
      repositorioMigraciones: new RepositorioMigraciones(sql),
      rutaMigraciones: obtenerRutaMigraciones()
    }).ejecutarPendientes();
    const escenario = await crearEscenario(sql);
    const componentes = crearComponentes(sql, escenario);
    await verificarRetiradaConOutbox(sql, escenario, componentes);
    await verificarIdempotencia(sql, escenario, componentes);
    await verificarRollbackTotal(sql, escenario, componentes);
    await verificarSinDestinoYAgenteNuncaFederado(sql, escenario, componentes);
    await verificarRaizOperativaObligatoria(sql, escenario, componentes);
    console.log(
      '[agentes] OK 5.25.6b: preparacion=unica familias=3 orden=hojas_a_raiz ' +
        'tombstones=operativos historia=local_cerrada outbox=durable ' +
        'sin_destino=no_bloquea nunca_federado=noop raiz_operativa=obligatoria ' +
        'replay=idempotente rollback=atomico'
    );
  } finally {
    await sql.cerrar();
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(baseDatos)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
}

async function verificarDistribucionPreparadaPorGrupos() {
  const persistencias = [];
  const conexion = {
    async query() { return [[{ activa: 1 }]]; },
    async execute(sql) {
      if (sql.includes("clave='federacion.activacion'")) {
        return [[{ valor: 'true' }]];
      }
      if (sql.includes('FROM flujos_federacion f')) {
        return [[
          destinoFixture('a', ['telemetria']),
          destinoFixture('b', ['telemetria', 'detalle'])
        ]];
      }
      throw new Error(`SQL inesperado en distribución preparada: ${sql}`);
    }
  };
  const servicio = new ServicioCapturaIncrementalFamiliasFederacion({
    registroFamilias: { obtenerProductivo() { throw new Error('No debe preparar otra vez.'); } },
    adaptadorCaptura: {
      async capturarEnTransaccion({ definicion, destinos }) {
        persistencias.push({ definicion, destinos });
        return {
          ocurrencia: definicion,
          posiciones: destinos.map((destino) => ({ ...destino, posicionFlujo: '1' }))
        };
      }
    }
  });
  const captura = capturaFixtureRetirada();
  const resultado = await servicio.capturarPreparadasEnTransaccion({
    familia: 'telemetria', capturas: [captura]
  }, { conexion });
  assert.equal(persistencias.length, 2, 'cada grupo recibe la misma retirada ya preparada');
  assert.equal(new Set(persistencias.map(({ definicion }) => definicion)).size, 1);
  assert.equal(resultado.posiciones.length, 2);
}

function destinoFixture(sufijo, campos) {
  return {
    flujo_id: id(TIPOS_IDENTIDAD_FEDERADA.FLUJO),
    generacion_activa_id: id(TIPOS_IDENTIDAD_FEDERADA.GENERACION),
    scope_nivel: 'sitio', scope_tenant_id: 1, scope_empresa_id: 1,
    scope_sitio_id: 1, version_familia: 1, estado_generacion: 'completa',
    niveles_scope: JSON.stringify(['sitio']), campos: JSON.stringify(campos),
    permite_contenido_sensible: 0, permite_refederacion: 0,
    sufijo
  };
}

function capturaFixtureRetirada() {
  return {
    prioridad: 'operativaActual',
    definicion: {
      familia: 'telemetria', familiaVersion: 1,
      installationOrigenId: id(TIPOS_IDENTIDAD_FEDERADA.INSTALACION),
      elementoOrigenId: id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN),
      ocurrenciaOrigenId: id(TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN),
      operacion: 'retirada', tiempoOrigenUtc: AHORA.toISOString(),
      scopeOrigenDeclarado: {
        nivel: 'sitio', tenantId: '1', empresaId: '1', sitioId: '1'
      },
      vigenciaRestanteMs: null, campos: {}, evidenciaIntegridad: []
    }
  };
}

async function crearEscenario(sql) {
  const sufijo = randomBytes(4).toString('hex');
  const [usuario] = await sql.ejecutar(
    'INSERT INTO usuarios (usuario,email,hash_password,nombre_mostrar) VALUES (?,?,?,?)',
    [`fed-${sufijo}`, `fed-${sufijo}@example.invalid`, 'hash', 'Federación 5.25.6b']
  );
  const [tenant] = await sql.ejecutar(
    'INSERT INTO tenants (nombre,alias) VALUES (?,?)',
    ['Tenant 5.25.6b', `t-5256b-${sufijo}`]
  );
  const [empresa] = await sql.ejecutar(
    'INSERT INTO empresas (tenant_id,nombre,alias) VALUES (?,?,?)',
    [tenant.insertId, 'Empresa 5.25.6b', `e-5256b-${sufijo}`]
  );
  const [sitio] = await sql.ejecutar(
    'INSERT INTO sitios (tenant_id,empresa_id,nombre,alias) VALUES (?,?,?,?)',
    [tenant.insertId, empresa.insertId, 'Sitio 5.25.6b', `s-5256b-${sufijo}`]
  );
  const ids = {
    usuarioId: String(usuario.insertId), tenantId: String(tenant.insertId),
    empresaId: String(empresa.insertId), sitioId: String(sitio.insertId),
    installationLocalId: id(TIPOS_IDENTIDAD_FEDERADA.INSTALACION),
    installationRemotaId: id(TIPOS_IDENTIDAD_FEDERADA.INSTALACION),
    bootId: id(TIPOS_IDENTIDAD_FEDERADA.ARRANQUE),
    relacionId: id(TIPOS_IDENTIDAD_FEDERADA.RELACION)
  };
  const agentes = {};
  for (const nombre of ['conectado', 'rollback', 'sinDestino', 'nuncaFederado']) {
    agentes[nombre] = await crearAgente(sql, ids, nombre);
  }
  const flujos = await crearFlujos(sql, ids);
  const datosConectado = await poblarAgenteFederado(sql, ids, agentes.conectado, {
    completo: true
  });
  const datosRollback = await poblarAgenteFederado(sql, ids, agentes.rollback, {
    completo: false
  });
  await poblarAgenteFederado(sql, ids, agentes.sinDestino, { completo: false });
  return { ...ids, agentes, flujos, datosConectado, datosRollback };
}

async function crearAgente(sql, scope, nombre) {
  const guid = randomUUID();
  const [agente] = await sql.ejecutar(
    `INSERT INTO agentes_sentinelia (
       guid,tenant_id,empresa_id,sitio_id,nombre,secreto_hash
     ) VALUES (?,?,?,?,?,?)`,
    [guid, scope.tenantId, scope.empresaId, scope.sitioId,
      `Agente ${nombre}`, 'hash-no-utilizable']
  );
  return { id: String(agente.insertId), guid, nombre: `Agente ${nombre}` };
}

async function crearFlujos(sql, escenario) {
  const ahora = AHORA;
  await sql.ejecutar(
    `INSERT INTO relaciones_federacion (
       relacion_id,direccion,estado_ciclo,estado_autoridad,estado_identidad,
       estado_compatibilidad,installation_remota_candidata_id,installation_remota_id,
       nombre_remoto_declarado,responsable_usuario_id,responsable_original_usuario_id,
       scope_tenant_id,scope_empresa_id,scope_sitio_id,version_autoridad,
       creada_por_usuario_id,creada_en_utc,actualizada_en_utc,revision
     ) VALUES (?,'emision','vinculada','autorizada','valida','compatible',?,?,?,
       ?,?,?,?,?,1,?,?,?,1)`,
    [escenario.relacionId, escenario.installationRemotaId,
      escenario.installationRemotaId, 'Destino 5.25.6b', escenario.usuarioId,
      escenario.usuarioId, escenario.tenantId, escenario.empresaId,
      escenario.sitioId, escenario.usuarioId, ahora, ahora]
  );
  const repositorio = new RepositorioFlujosFederacionSql(sql, {
    installationLocalId: escenario.installationLocalId
  });
  const flujos = {};
  for (const familia of [
    'monitores', 'telemetria', 'contextoOperativoAgentesSesiones'
  ]) {
    const flujoId = id(TIPOS_IDENTIDAD_FEDERADA.FLUJO);
    const generacionId = id(TIPOS_IDENTIDAD_FEDERADA.GENERACION);
    const creado = await repositorio.crearFlujoInicial({
      flujo: {
        flujoId, relacionId: escenario.relacionId, direccion: 'emision',
        familia, versionFamilia: 1,
        contexto: {
          nivel: 'sitio', tenantId: escenario.tenantId,
          empresaId: escenario.empresaId, sitioId: escenario.sitioId
        }
      },
      generacion: {
        generacionId, clase: 'inicial', fronteraInicial: '0',
        propietario: {
          installationId: escenario.installationLocalId,
          bootId: escenario.bootId,
          version: 1
        }
      }
    });
    await repositorio.avanzarGeneracion({
      flujoId,
      propietario: creado.generacion.propietario,
      versionEstadoEsperada: creado.generacion.versionEstado,
      versionFronteraEsperada: creado.generacion.frontera.version,
      estadoGeneracion: 'transfiriendo', estadoFlujo: 'sincronizando',
      frontera: {
        posicionOperativa: null, posicionHistorica: null, sincronizando: true,
        operativamenteCompleta: false, historicamenteCompleta: false,
        parcialPorScope: false, degradada: false
      }
    });
    flujos[familia] = { flujoId, generacionId };
  }
  return flujos;
}

async function poblarAgenteFederado(sql, scope, agente, { completo }) {
  const [senal] = await sql.ejecutar(
    `INSERT INTO senales_telemetria_agentes (
       agente_id,categoria,clave,tag,codigo_senal,tipo_dato,unidad,nombre_humano
     ) VALUES (?,?,?,?,?,'numero','%','CPU')`,
    [agente.id, 'sistema', `cpu-${agente.id}`, '', `sistema.cpu:agente-${agente.id}`]
  );
  const [observacion] = await sql.ejecutar(
    `INSERT INTO observaciones_telemetria_agentes (
       agente_id,senal_id,categoria,clave,tag,codigo_senal,tipo_dato,unidad,
       valor_numero,observado_en_utc,recibido_en_utc
     ) VALUES (?,?,?,?,?,?,'numero','%',50,UTC_TIMESTAMP(),UTC_TIMESTAMP())`,
    [agente.id, senal.insertId, 'sistema', `cpu-${agente.id}`, '',
      `sistema.cpu:agente-${agente.id}`]
  );
  const [fotografia] = await sql.ejecutar(
    `INSERT INTO estado_actual_telemetria_agentes (
       agente_id,senal_id,ultima_observacion_id,categoria,clave,tag,codigo_senal,
       tipo_dato,unidad,valor_numero,observado_en_utc,recibido_en_utc
     ) VALUES (?,?,?,?,?,?,?,'numero','%',50,UTC_TIMESTAMP(),UTC_TIMESTAMP())`,
    [agente.id, senal.insertId, observacion.insertId, 'sistema',
      `cpu-${agente.id}`, '', `sistema.cpu:agente-${agente.id}`]
  );
  const [regla] = await sql.ejecutar(
    `INSERT INTO reglas_derivacion_telemetria (
       agente_id,senal_id,tenant_id,empresa_id,sitio_id,estado
     ) VALUES (?,?,?,?,?,'activa')`,
    [agente.id, senal.insertId, scope.tenantId, scope.empresaId, scope.sitioId]
  );
  const [revision] = await sql.ejecutar(
    `INSERT INTO revisiones_reglas_derivacion_telemetria (
       regla_id,numero,condicion_tipo,condicion_version,condicion_canonica,
       severidad_calculada,mensaje_operativo,nombre,vigente_desde_utc
     ) VALUES (?,1,'numero',1,?,'advertencia','CPU alta','CPU alta',UTC_TIMESTAMP(6))`,
    [regla.insertId, JSON.stringify({ operador: '>', umbral: 90 })]
  );
  const [monitor] = await sql.ejecutar(
    `INSERT INTO monitores (tenant_id,empresa_id,sitio_id,nombre,tipo)
      VALUES (?,?,?,?, 'telemetria')`,
    [scope.tenantId, scope.empresaId, scope.sitioId, `Monitor agente ${agente.id}`]
  );
  await sql.ejecutar(
    `INSERT INTO vinculos_monitores_telemetria (
       monitor_id,tenant_id,empresa_id,sitio_id,tipo_fuente,agente_id,senal_id
     ) VALUES (?,?,?,?,'senal_directa',?,?)`,
    [monitor.insertId, scope.tenantId, scope.empresaId, scope.sitioId,
      agente.id, senal.insertId]
  );
  await insertarContexto(sql, scope, agente);
  const identidadesTelemetria = [
    ['fuente', agente.id],
    ['senal', String(senal.insertId)]
  ];
  if (completo) {
    identidadesTelemetria.push(
      ['observacion', String(observacion.insertId)],
      ['fotografiaSenal', String(fotografia.insertId)],
      ['fotografiaPol', agente.id],
      ['reglaDerivacion', String(regla.insertId)],
      ['revisionReglaDerivacion', String(revision.insertId)]
    );
  }
  const elementos = {};
  for (const [tipo, clave] of identidadesTelemetria) {
    elementos[`${tipo}:${clave}`] = await insertarIdentidadTelemetria(
      sql, scope, agente.id, tipo, clave
    );
  }
  const identidadMonitor = id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN);
  await sql.ejecutar(
    `INSERT INTO identidades_elementos_monitores_federacion (
       tipo_elemento,clave_local,monitor_id_local,elemento_origen_id,
       scope_tenant_id,scope_empresa_id,scope_sitio_id,estado,
       creada_en_utc,actualizada_en_utc,version_registro
     ) VALUES ('definicion',?,?,?, ?,?,?,'vigente',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),1)`,
    [String(monitor.insertId), monitor.insertId, identidadMonitor,
      scope.tenantId, scope.empresaId, scope.sitioId]
  );
  return {
    senalId: String(senal.insertId), observacionId: String(observacion.insertId),
    fotografiaId: String(fotografia.insertId), reglaId: String(regla.insertId),
    revisionId: String(revision.insertId), monitorId: String(monitor.insertId),
    elementos, identidadMonitor
  };
}

async function insertarContexto(sql, scope, agente) {
  await sql.ejecutar(
    `INSERT INTO identidades_contexto_operativo_agentes_federacion (
       agente_id_local,elemento_origen_id,guid_ultimo,nombre_ultimo,
       scope_tenant_id,scope_empresa_id,scope_sitio_id,estado,
       creada_en_utc,actualizada_en_utc,version_registro
     ) VALUES (?,?,?,?,?,?,?,'vigente',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),1)`,
    [agente.id, id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN),
      agente.guid, agente.nombre, scope.tenantId, scope.empresaId, scope.sitioId]
  );
}

async function insertarIdentidadTelemetria(sql, scope, agenteId, tipo, clave) {
  const elemento = id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN);
  await sql.ejecutar(
    `INSERT INTO identidades_elementos_telemetria_federacion (
       tipo_elemento,clave_local,agente_id_local,elemento_origen_id,
       scope_tenant_id,scope_empresa_id,scope_sitio_id,estado,
       creada_en_utc,actualizada_en_utc,version_registro
     ) VALUES (?,?,?,?,?,?,?,'vigente',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),1)`,
    [tipo, clave, agenteId, elemento,
      scope.tenantId, scope.empresaId, scope.sitioId]
  );
  return elemento;
}

function crearComponentes(sql, escenario) {
  const repositorioContextoAgentes =
    new RepositorioContextoOperativoAgentesSesionesLocalSql(sql, {
      installationLocalId: escenario.installationLocalId,
      generadorIdentidades: generador, ahora: () => AHORA
    });
  const repositorioTelemetria = new RepositorioTelemetriaLocalSql(sql, {
    installationLocalId: escenario.installationLocalId,
    generadorIdentidades: generador, ahora: () => AHORA
  });
  const repositorioMonitores = new RepositorioMonitoresLocalSql(sql, {
    installationLocalId: escenario.installationLocalId,
    generadorIdentidades: generador, ahora: () => AHORA,
    resolverVigenciaEstado: () => '2031-05-06T07:13:09.123Z'
  });
  const capturaSql = new AdaptadorCapturaTransaccionalFederacionSql({
    repositorioOcurrencias: new RepositorioOcurrenciasFederacionSql(sql, {
      installationLocalId: escenario.installationLocalId
    }),
    repositorioOutbox: new RepositorioOutboxFederacionSql(sql)
  });
  const distribuidorConectado = distribuidorDirecto(capturaSql, escenario.flujos);
  return {
    repositorioContextoAgentes, repositorioTelemetria, repositorioMonitores,
    capturaSql, distribuidorConectado,
    servicio: crearServicioRetirada({
      distribuidor: distribuidorConectado,
      repositorioContextoAgentes, repositorioTelemetria, repositorioMonitores
    })
  };
}

function crearServicioRetirada({ distribuidor, repositorioContextoAgentes,
  repositorioTelemetria, repositorioMonitores }) {
  return new ServicioRetiradaFederadaAgente({
    capturadorFederacion: distribuidor,
    repositorioContextoAgentes, repositorioTelemetria, repositorioMonitores
  });
}

function distribuidorDirecto(capturaSql, flujos) {
  return {
    async capturarPreparadasEnTransaccion({ familia, capturas }, { conexion }) {
      const ocurrencias = [];
      const posiciones = [];
      for (const captura of capturas) {
        const resultado = await capturaSql.capturarEnTransaccion({
          definicion: captura.definicion,
          destinos: [{
            flujoId: flujos[familia].flujoId,
            generacionId: flujos[familia].generacionId,
            prioridad: captura.prioridad,
            clasePosicion: 'cambioPosterior'
          }]
        }, { conexion });
        ocurrencias.push(resultado.ocurrencia);
        posiciones.push(...resultado.posiciones);
      }
      return Object.freeze({
        estado: posiciones.length ? 'capturada' : 'sinCambiosFederables',
        ocurrencias: Object.freeze(ocurrencias),
        posiciones: Object.freeze(posiciones)
      });
    }
  };
}

async function verificarRetiradaConOutbox(sql, escenario, componentes) {
  const resultado = await transaccion(sql, (conexion) =>
    componentes.servicio.prepararEnTransaccion({
      agenteId: escenario.agentes.conectado.id
    }, { conexion })
  );
  assert.equal(resultado.identidadesRetiradas, 9);
  assert.equal(resultado.tombstones, 7);
  assert.equal(resultado.identidadesHistoricasCerradas, 2);
  assert.equal(resultado.familias.monitores.posiciones, 1);
  assert.equal(resultado.familias.telemetria.posiciones, 5);
  assert.equal(resultado.familias.contextoOperativoAgentesSesiones.posiciones, 1);
  const estados = await estadosIdentidades(sql, escenario.agentes.conectado.id);
  assert.equal(estados.every(({ estado }) => estado === 'retirado'), true);
  const [outbox] = await sql.consultar('SELECT COUNT(*) total FROM outbox_federacion');
  assert.equal(Number(outbox.total), 7);
  const elementosHistoricos = [
    escenario.datosConectado.elementos[
      `observacion:${escenario.datosConectado.observacionId}`
    ],
    escenario.datosConectado.elementos[
      `revisionReglaDerivacion:${escenario.datosConectado.revisionId}`
    ]
  ];
  const [retiradasHistoricas] = await sql.consultar(
    `SELECT COUNT(*) total FROM ocurrencias_federacion
      WHERE operacion='retirada' AND elemento_origen_id IN (?,?)`,
    elementosHistoricos
  );
  assert.equal(Number(retiradasHistoricas.total), 0,
    'la historia se cierra localmente sin ordenar su destrucción remota');
}

async function verificarIdempotencia(sql, escenario, componentes) {
  const [antes] = await sql.consultar('SELECT COUNT(*) total FROM outbox_federacion');
  const repetida = await transaccion(sql, (conexion) =>
    componentes.servicio.prepararEnTransaccion({
      agenteId: escenario.agentes.conectado.id
    }, { conexion })
  );
  const [despues] = await sql.consultar('SELECT COUNT(*) total FROM outbox_federacion');
  assert.equal(repetida.identidadesRetiradas, 0);
  assert.equal(String(despues.total), String(antes.total));
}

async function verificarRollbackTotal(sql, escenario, componentes) {
  const [antes] = await sql.consultar('SELECT COUNT(*) total FROM outbox_federacion');
  let llamadas = 0;
  const distribuidorFallido = {
    async capturarPreparadasEnTransaccion(entrada, opciones) {
      llamadas += 1;
      if (entrada.familia === 'telemetria') throw new Error('fallo_telemetria_5256b');
      return componentes.distribuidorConectado
        .capturarPreparadasEnTransaccion(entrada, opciones);
    }
  };
  const servicio = crearServicioRetirada({
    distribuidor: distribuidorFallido,
    repositorioContextoAgentes: componentes.repositorioContextoAgentes,
    repositorioTelemetria: componentes.repositorioTelemetria,
    repositorioMonitores: componentes.repositorioMonitores
  });
  await assert.rejects(
    transaccion(sql, (conexion) => servicio.prepararEnTransaccion({
      agenteId: escenario.agentes.rollback.id
    }, { conexion })),
    /fallo_telemetria_5256b/u
  );
  assert.equal(llamadas, 2);
  const estados = await estadosIdentidades(sql, escenario.agentes.rollback.id);
  assert.equal(estados.every(({ estado }) => estado === 'vigente'), true);
  const [despues] = await sql.consultar('SELECT COUNT(*) total FROM outbox_federacion');
  assert.equal(String(despues.total), String(antes.total));
}

async function verificarSinDestinoYAgenteNuncaFederado(sql, escenario, componentes) {
  const distribuidorSinDestino = {
    async capturarPreparadasEnTransaccion() {
      return Object.freeze({
        estado: 'sinDestinos', ocurrencias: Object.freeze([]),
        posiciones: Object.freeze([])
      });
    }
  };
  const servicio = crearServicioRetirada({
    distribuidor: distribuidorSinDestino,
    repositorioContextoAgentes: componentes.repositorioContextoAgentes,
    repositorioTelemetria: componentes.repositorioTelemetria,
    repositorioMonitores: componentes.repositorioMonitores
  });
  const [antes] = await sql.consultar('SELECT COUNT(*) total FROM outbox_federacion');
  const sinDestino = await transaccion(sql, (conexion) => servicio.prepararEnTransaccion({
    agenteId: escenario.agentes.sinDestino.id
  }, { conexion }));
  assert.equal(sinDestino.identidadesRetiradas, 4);
  assert.equal(sinDestino.familias.telemetria.posiciones, 0);
  const estados = await estadosIdentidades(sql, escenario.agentes.sinDestino.id);
  assert.equal(estados.every(({ estado }) => estado === 'retirado'), true);
  const nunca = await transaccion(sql, (conexion) => servicio.prepararEnTransaccion({
    agenteId: escenario.agentes.nuncaFederado.id
  }, { conexion }));
  assert.equal(nunca.identidadesRetiradas, 0);
  const [despues] = await sql.consultar('SELECT COUNT(*) total FROM outbox_federacion');
  assert.equal(String(despues.total), String(antes.total));
}

async function verificarRaizOperativaObligatoria(sql, escenario, componentes) {
  const agente = escenario.agentes.nuncaFederado;
  await insertarIdentidadTelemetria(
    sql,
    escenario,
    agente.id,
    'senal',
    '9223372036854775807'
  );
  await assert.rejects(
    transaccion(sql, (conexion) => componentes.servicio.prepararEnTransaccion({
      agenteId: agente.id
    }, { conexion })),
    (error) => error?.codigo === 'identidad_telemetria_operativa_sin_raiz'
  );
  const [identidad] = await sql.consultar(
    `SELECT estado FROM identidades_elementos_telemetria_federacion
      WHERE agente_id_local=? AND tipo_elemento='senal'`,
    [agente.id]
  );
  assert.equal(identidad.estado, 'vigente', 'el fallo de precondición hace rollback');
}

async function estadosIdentidades(sql, agenteId) {
  return sql.consultar(
    `SELECT estado FROM identidades_elementos_telemetria_federacion
      WHERE agente_id_local=?
     UNION ALL
     SELECT estado FROM identidades_contexto_operativo_agentes_federacion
      WHERE agente_id_local=?
     UNION ALL
     SELECT i.estado FROM identidades_elementos_monitores_federacion i
      JOIN vinculos_monitores_telemetria v ON v.monitor_id=i.monitor_id_local
      WHERE v.agente_id=?`,
    [agenteId, agenteId, agenteId]
  );
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
