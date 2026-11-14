import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import { FronteraTransaccionalLocal } from '../paquetes/persistencia-sql/src/FronteraTransaccionalLocal.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { obtenerConfiguracionAplicacion } from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';
import { RepositorioMonitores } from '../paquetes/monitores/src/RepositorioMonitores.js';
import { RepositorioEntradasFederadasMonitoresLogicosSql } from '../paquetes/monitores/src/RepositorioEntradasFederadasMonitoresLogicosSql.js';
import { ServicioMonitores } from '../paquetes/monitores/src/ServicioMonitores.js';
import { ValidadorMonitor } from '../paquetes/monitores/src/ValidadorMonitor.js';
import { normalizarDependenciasMonitorLogico } from '../paquetes/monitores/src/DependenciasMonitorLogico.js';
import { VERSION_CONFIGURACION_MONITOR_LOGICO } from '../paquetes/monitores/src/ConfiguracionMonitorLogico.js';
import { TIPOS_IDENTIDAD_FEDERADA } from '../paquetes/federacion/src/IdentidadFederada.js';
import { EjecutorMonitorBooleano } from '../apps/sentinelia-runtime/src/ejecucion/EjecutorMonitorBooleano.js';
import { id, migrar } from './federacion-verificar-5-22-15g.js';

await main();

async function main() {
  await verificarContratoYRegistro();
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true);
  const baseDatos = `sentinelia_fixture_52216c_${randomBytes(6).toString('hex')}`;
  const administrador = new ClienteSql(configuracion.sql);
  let sql;
  try {
    await administrador.ejecutar(
      `CREATE DATABASE ${administrador.escaparIdentificador(baseDatos)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    sql = new ClienteSql({ ...configuracion.sql, baseDatos });
    await migrar(sql);
    await verificarVinculoExplicitoYServicio(sql);
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(baseDatos)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
  console.log(
    '[federacion] OK 5.22.16c: entrada=monitor_federado referencia=proyeccion_explicita ' +
    'scope=visible persistencia=atomica interpretacion=bloqueada'
  );
}

async function verificarContratoYRegistro() {
  assert.ok(VERSION_CONFIGURACION_MONITOR_LOGICO >= 2);

  const proyeccionId = id(TIPOS_IDENTIDAD_FEDERADA.PROYECCION);
  assert.deepEqual(
    normalizarDependenciasMonitorLogico([{
      variable: 'REMOTA_A',
      fuente: 'monitor_federado',
      proyeccionId,
      etiqueta: 'Estado operativo remoto'
    }]),
    [{
      variable: 'REMOTA_A',
      fuente: 'monitor_federado',
      proyeccionId,
      estadoInicial: 'correcto',
      inversion: false,
      retardoCambioSegundos: 0,
      politicaPerdidaEnFallo: 'conservar',
      politicaPerdidaEnCorrecto: 'conservar',
      etiqueta: 'Estado operativo remoto'
    }]
  );
  assert.throws(
    () => normalizarDependenciasMonitorLogico([{
      variable: 'A', fuente: 'monitor_federado', referencia: proyeccionId
    }]),
    /proyeccionId explícita/iu
  );
  assert.equal(normalizarDependenciasMonitorLogico([
    { variable: 'A', fuente: 'monitor_federado', proyeccionId },
    { variable: 'B', fuente: 'monitor_federado', proyeccionId }
  ]).length, 2);
}

async function verificarVinculoExplicitoYServicio(sql) {
  await sql.ejecutar(
    `INSERT INTO tenants (id,nombre,alias) VALUES
       (1,'Tenant prueba','tenant-prueba')`
  );
  await sql.ejecutar(
    `INSERT INTO empresas (id,tenant_id,nombre,alias) VALUES
       (10,1,'Empresa A','empresa-a'),(20,1,'Empresa B','empresa-b')`
  );
  const proyeccionValida = await insertarProyeccion(sql, {
    tenantId: 1,
    empresaId: 10
  });
  const proyeccionOtroScope = await insertarProyeccion(sql, {
    tenantId: 1,
    empresaId: 20
  });
  const proyeccionOtraFamilia = await insertarProyeccion(sql, {
    tenantId: 1,
    empresaId: 10,
    familia: 'telemetria'
  });

  const repositorioMonitores = new RepositorioMonitores(sql);
  const repositorioEntradas =
    new RepositorioEntradasFederadasMonitoresLogicosSql(sql);
  const servicio = new ServicioMonitores({
    repositorioMonitores,
    repositorioTenants: { buscarPorId: async (valor) => ({ id: Number(valor) }) },
    repositorioEmpresas: {
      buscarPorId: async (valor) => ({ id: Number(valor), tenantId: 1 })
    },
    repositorioSitios: { buscarPorId: async () => null },
    repositorioEntradasFederadasMonitoresLogicos: repositorioEntradas,
    resolutorScopeUsuario: {
      puedeAlcanzarEmpresa: () => true,
      puedeAlcanzarSitio: () => false
    },
    validadorMonitor: new ValidadorMonitor(),
    fronteraTransaccional: new FronteraTransaccionalLocal(sql)
  });
  const contexto = { nivelScope: 'tenant', tenantId: 1 };
  const monitor = await servicio.crearMonitor(
    contexto,
    datosMonitorLogico(proyeccionValida)
  );
  const [vinculo] = await repositorioEntradas.listarPorMonitorId(monitor.id);
  assert.equal(vinculo.variable, 'REMOTA');
  assert.equal(vinculo.proyeccionId, proyeccionValida);
  assert.deepEqual(vinculo.scope, {
    tenantId: '1', empresaId: '10', sitioId: null
  });
  assert.equal(monitor.configuracion.version, VERSION_CONFIGURACION_MONITOR_LOGICO);
  assert.equal(monitor.configuracion.dependencias[0].fuente, 'monitor_federado');

  const resultadoSinLectorRemoto = await new EjecutorMonitorBooleano().ejecutar(monitor);
  assert.equal(resultadoSinLectorRemoto.codigoResultado, 'booleano_inicializando');
  assert.equal(resultadoSinLectorRemoto.metricaPrincipal.bloqueaEvaluacion, true);
  assert.equal(
    resultadoSinLectorRemoto.intentos[0].detalle.entradas[0].proyeccionId,
    proyeccionValida,
    'El diagnóstico conserva la identidad explícita sin inventar un valor remoto.'
  );

  const cruzado = await servicio.crearMonitor(
    contexto,
    datosMonitorLogico(proyeccionOtroScope, 'Scope cruzado visible')
  );
  assert.equal(
    (await repositorioEntradas.listarPorMonitorId(cruzado.id))[0].proyeccionId,
    proyeccionOtroScope,
    'Un responsable de tenant puede enlazar dos scopes que están dentro de su alcance.'
  );
  const totalAntes = await contarMonitores(sql);
  await assert.rejects(
    servicio.crearMonitor(
      { nivelScope: 'empresa', tenantId: 1, empresaId: 10 },
      datosMonitorLogico(proyeccionOtroScope, 'Fuera de alcance')
    ),
    /fuera del alcance visible/iu
  );
  await assert.rejects(
    servicio.crearMonitor(contexto, datosMonitorLogico(proyeccionOtraFamilia, 'Familia')),
    /no son monitores/iu
  );
  assert.equal(await contarMonitores(sql), totalAntes, 'El alta incompatible revierte el monitor.');

  const segundaIncorporacion = await repositorioEntradas.vincular({
    monitorId: monitor.id,
    variable: 'OTRA',
    proyeccionId: proyeccionValida
  });
  assert.notEqual(segundaIncorporacion.entradaId, vinculo.entradaId);
  await assert.rejects(
    sql.ejecutar('DELETE FROM proyecciones_federacion WHERE proyeccion_id=?', [proyeccionValida]),
    (error) => error.code === 'ER_ROW_IS_REFERENCED_2'
  );
  const convertido = await servicio.actualizarMonitor(
    contexto,
    monitor.id,
    datosMonitorPing()
  );
  assert.equal(convertido.tipo, 'ping');
  assert.deepEqual(await repositorioEntradas.listarPorProyeccionId(proyeccionValida), []);
  await sql.ejecutar(
    'DELETE FROM proyecciones_federacion WHERE proyeccion_id=?',
    [proyeccionValida]
  );
  await repositorioMonitores.eliminar(monitor.id);
  await repositorioMonitores.eliminar(cruzado.id);
}

async function insertarProyeccion(sql, {
  tenantId,
  empresaId,
  familia = 'monitores'
}) {
  const proyeccionId = id(TIPOS_IDENTIDAD_FEDERADA.PROYECCION);
  await sql.ejecutar(
    `INSERT INTO proyecciones_federacion (
       proyeccion_id,installation_origen_id,familia,elemento_origen_id,
       scope_nivel,scope_tenant_id,scope_empresa_id,scope_sitio_id,creada_en_utc
     ) VALUES (?,?,?,?,'empresa',?,?,NULL,UTC_TIMESTAMP(3))`,
    [
      proyeccionId,
      id(TIPOS_IDENTIDAD_FEDERADA.INSTALACION),
      familia,
      id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN),
      tenantId,
      empresaId
    ]
  );
  return proyeccionId;
}

function datosMonitorLogico(proyeccionId, sufijo = 'Principal') {
  return {
    tenant_id: '1',
    empresa_id: '10',
    sitio_id: '',
    nivel_pertenencia: 'empresa',
    nombre: `Lógico federado ${sufijo}`,
    tipo: 'booleano',
    descripcion: 'Monitor local con entrada remota explícita',
    interpretacion_estado: 'normal',
    descripcion_fallo: 'La condición lógica no se cumple',
    posible_solucion: 'Revisar la fuente remota',
    activo: '1',
    intervalo_ejecucion_segundos: '60',
    desfase_inicial_segundos: '0',
    expresion_logica: 'REMOTA',
    mensaje_fallo_logico: 'La entrada remota indica fallo',
    estado_inicial_logico: 'disponible',
    retardo_senal_segundos_logico: '0',
    dependencias_logicas: JSON.stringify([{
      variable: 'REMOTA',
      fuente: 'monitor_federado',
      proyeccionId,
      etiqueta: 'Monitor federado de origen'
    }])
  };
}

function datosMonitorPing() {
  return {
    tenant_id: '1',
    empresa_id: '10',
    sitio_id: '',
    nivel_pertenencia: 'empresa',
    nombre: 'Ping convertido',
    tipo: 'ping',
    descripcion: 'Conversión explícita del monitor local',
    interpretacion_estado: 'normal',
    descripcion_fallo: 'El destino no responde',
    posible_solucion: 'Revisar conectividad',
    activo: '1',
    intervalo_ejecucion_segundos: '60',
    desfase_inicial_segundos: '0',
    host: '127.0.0.1',
    timeout_ms: '1200',
    reintentos: '1',
    tamano_paquete_bytes: '56',
    ttl: '64'
  };
}

async function contarMonitores(sql) {
  const [fila] = await sql.consultar('SELECT COUNT(*) AS total FROM monitores');
  return Number(fila.total);
}
