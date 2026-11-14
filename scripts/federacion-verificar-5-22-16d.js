import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { FronteraTransaccionalLocal } from '../paquetes/persistencia-sql/src/FronteraTransaccionalLocal.js';
import { obtenerConfiguracionAplicacion } from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';
import { RepositorioMonitores } from '../paquetes/monitores/src/RepositorioMonitores.js';
import { RepositorioEntradasFederadasMonitoresLogicosSql } from '../paquetes/monitores/src/RepositorioEntradasFederadasMonitoresLogicosSql.js';
import { ServicioMonitores } from '../paquetes/monitores/src/ServicioMonitores.js';
import { ValidadorMonitor } from '../paquetes/monitores/src/ValidadorMonitor.js';
import { normalizarDependenciasMonitorLogico } from '../paquetes/monitores/src/DependenciasMonitorLogico.js';
import { VERSION_CONFIGURACION_MONITOR_LOGICO } from '../paquetes/monitores/src/ConfiguracionMonitorLogico.js';
import { TIPOS_IDENTIDAD_FEDERADA } from '../paquetes/federacion/src/IdentidadFederada.js';
import { id, migrar } from './federacion-verificar-5-22-15g.js';

await main();

async function main() {
  await verificarContrato();
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true);
  const baseDatos = `sentinelia_fixture_52216d_${randomBytes(6).toString('hex')}`;
  const administrador = new ClienteSql(configuracion.sql);
  let sql;
  try {
    await administrador.ejecutar(
      `CREATE DATABASE ${administrador.escaparIdentificador(baseDatos)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    sql = new ClienteSql({ ...configuracion.sql, baseDatos });
    await migrar(sql);
    await verificarConfiguracionDurable(sql);
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(baseDatos)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
  console.log(
    '[federacion] OK 5.22.16d: identidad=por_incorporacion revision=prospectiva ' +
    'estado_inicial=binario inversion=local perdida=por_ultimo_estado'
  );
}

async function verificarContrato() {
  assert.ok(VERSION_CONFIGURACION_MONITOR_LOGICO >= 3);

  const proyeccionId = id(TIPOS_IDENTIDAD_FEDERADA.PROYECCION);
  const [entrada] = normalizarDependenciasMonitorLogico([{
    variable: 'A', fuente: 'monitor_federado', proyeccionId
  }]);
  assert.deepEqual({
    estadoInicial: entrada.estadoInicial,
    inversion: entrada.inversion,
    politicaPerdidaEnFallo: entrada.politicaPerdidaEnFallo,
    politicaPerdidaEnCorrecto: entrada.politicaPerdidaEnCorrecto
  }, {
    estadoInicial: 'correcto',
    inversion: false,
    politicaPerdidaEnFallo: 'conservar',
    politicaPerdidaEnCorrecto: 'conservar'
  });
  assert.throws(
    () => normalizarDependenciasMonitorLogico([{
      variable: 'A', fuente: 'monitor_federado', proyeccionId,
      politicaPerdidaEnFallo: 'inventar_estado'
    }]),
    /política de pérdida|debe ser una de/iu
  );
}

async function verificarConfiguracionDurable(sql) {
  await sql.ejecutar(
    `INSERT INTO tenants (id,nombre,alias) VALUES (1,'Tenant prueba','tenant-prueba')`
  );
  await sql.ejecutar(
    `INSERT INTO empresas (id,tenant_id,nombre,alias) VALUES (10,1,'Empresa A','empresa-a')`
  );
  const proyeccionUno = await insertarProyeccion(sql);
  const proyeccionDos = await insertarProyeccion(sql);
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
    datosMonitor([entrada('A', proyeccionUno, {
      estadoInicial: 'fallo',
      inversion: true,
      politicaPerdidaEnFallo: 'forzar_correcto',
      politicaPerdidaEnCorrecto: 'forzar_fallo'
    }), entrada('B', proyeccionUno)])
  );
  const iniciales = await repositorioEntradas.listarPorMonitorId(monitor.id);
  assert.equal(iniciales.length, 2, 'La misma fuente admite incorporaciones locales independientes.');
  assert.notEqual(iniciales[0].entradaId, iniciales[1].entradaId);
  assert.equal(iniciales[0].revisionConfiguracion, 1);
  assert.equal(iniciales[0].estadoInicial, 'fallo');
  assert.equal(iniciales[0].inversion, true);
  assert.equal(iniciales[0].politicaPerdidaEnFallo, 'forzar_correcto');
  assert.equal(iniciales[0].politicaPerdidaEnCorrecto, 'forzar_fallo');

  await sql.ejecutar(
    `CREATE TRIGGER fixture_rechazar_historial_entrada
       BEFORE INSERT ON historial_configuracion_entradas_federadas_logicas
       FOR EACH ROW
       SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='fixture historial rechazado'`
  );
  await assert.rejects(
    repositorioEntradas.vincular({
      monitorId: monitor.id,
      variable: 'C',
      proyeccionId: proyeccionDos
    }),
    /fixture historial rechazado/iu
  );
  assert.equal(
    await repositorioEntradas.buscarPorMonitorYVariable(monitor.id, 'C'),
    null,
    'El vínculo no puede quedar confirmado si falla su revisión histórica.'
  );
  await sql.ejecutar('DROP TRIGGER fixture_rechazar_historial_entrada');

  await servicio.actualizarMonitor(
    contexto,
    monitor.id,
    datosMonitor([entrada('A', proyeccionUno, {
      estadoInicial: 'fallo',
      inversion: false,
      politicaPerdidaEnFallo: 'forzar_correcto',
      politicaPerdidaEnCorrecto: 'forzar_fallo'
    }), entrada('B', proyeccionUno, { etiqueta: 'Cambio solamente humano' })])
  );
  const revisadas = await repositorioEntradas.listarPorMonitorId(monitor.id);
  assert.equal(revisadas[0].entradaId, iniciales[0].entradaId);
  assert.equal(revisadas[0].revisionConfiguracion, 2);
  assert.equal(revisadas[1].entradaId, iniciales[1].entradaId);
  assert.equal(revisadas[1].revisionConfiguracion, 1);
  const historialRevisado = await repositorioEntradas.listarHistorialPorEntradaId(
    iniciales[0].entradaId
  );
  assert.equal(historialRevisado.length, 2);
  assert.equal(historialRevisado[0].causaCierre, 'configuracion_sustituida');
  assert.equal(historialRevisado[1].vigenteHastaUtc, null);

  await servicio.actualizarMonitor(
    contexto,
    monitor.id,
    datosMonitor([entrada('A', proyeccionDos), entrada('B', proyeccionUno)])
  );
  const sustituidas = await repositorioEntradas.listarPorMonitorId(monitor.id);
  assert.notEqual(sustituidas[0].entradaId, iniciales[0].entradaId);
  assert.equal(sustituidas[0].revisionConfiguracion, 1);
  assert.equal(sustituidas[1].entradaId, iniciales[1].entradaId);
  const historialSustituido = await repositorioEntradas
    .listarHistorialPorEntradaId(iniciales[0].entradaId);
  assert.equal(historialSustituido[1].causaCierre, 'fuente_sustituida');

  await servicio.eliminarMonitor(contexto, monitor.id);
  assert.deepEqual(await repositorioEntradas.listarPorMonitorId(monitor.id), []);
  const historialConservado = await repositorioEntradas
    .listarHistorialPorEntradaId(iniciales[1].entradaId);
  assert.equal(historialConservado[0].causaCierre, 'monitor_eliminado');
}

async function insertarProyeccion(sql) {
  const proyeccionId = id(TIPOS_IDENTIDAD_FEDERADA.PROYECCION);
  await sql.ejecutar(
    `INSERT INTO proyecciones_federacion (
       proyeccion_id,installation_origen_id,familia,elemento_origen_id,
       scope_nivel,scope_tenant_id,scope_empresa_id,scope_sitio_id,creada_en_utc
     ) VALUES (?,?, 'monitores',?,'empresa',1,10,NULL,UTC_TIMESTAMP(3))`,
    [
      proyeccionId,
      id(TIPOS_IDENTIDAD_FEDERADA.INSTALACION),
      id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN)
    ]
  );
  return proyeccionId;
}

function entrada(variable, proyeccionId, sobrescritura = {}) {
  return {
    variable,
    fuente: 'monitor_federado',
    proyeccionId,
    etiqueta: sobrescritura.etiqueta || `Entrada ${variable}`,
    estadoInicial: sobrescritura.estadoInicial ?? 'correcto',
    inversion: sobrescritura.inversion ?? false,
    politicaPerdidaEnFallo:
      sobrescritura.politicaPerdidaEnFallo ?? 'conservar',
    politicaPerdidaEnCorrecto:
      sobrescritura.politicaPerdidaEnCorrecto ?? 'conservar'
  };
}

function datosMonitor(dependencias) {
  return {
    tenant_id: '1', empresa_id: '10', sitio_id: '',
    nivel_pertenencia: 'empresa', nombre: 'Lógico federado configurable',
    tipo: 'booleano', descripcion: 'Prueba 5.22.16d',
    interpretacion_estado: 'normal',
    descripcion_fallo: 'La condición lógica no se cumple',
    posible_solucion: 'Revisar las fuentes remotas', activo: '1',
    intervalo_ejecucion_segundos: '60', desfase_inicial_segundos: '0',
    expresion_logica: 'A AND B', mensaje_fallo_logico: 'Fallo lógico remoto',
    estado_inicial_logico: 'disponible', retardo_senal_segundos_logico: '0',
    dependencias_logicas: JSON.stringify(dependencias)
  };
}
