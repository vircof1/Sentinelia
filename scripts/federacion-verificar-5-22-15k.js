import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import {
  AdaptadorMonitoresFederacion,
  crearDefinicionAdaptadorMonitoresFederacion
} from '../paquetes/federacion/adaptadores/AdaptadorMonitoresFederacion.js';
import { RepositorioMonitoresRemotoSql } from '../paquetes/federacion/adaptadores/RepositorioMonitoresRemotoSql.js';
import { generarUuidV7Auditoria } from '../paquetes/auditoria/src/UuidV7Auditoria.js';
import { TIPOS_IDENTIDAD_FEDERADA } from '../paquetes/federacion/src/IdentidadFederada.js';
import { PERFIL_PAYLOAD_MONITORES_FEDERACION } from '../paquetes/federacion/src/PayloadMonitoresFederacion.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { obtenerConfiguracionAplicacion } from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';
import {
  contextoCierre,
  crearElemento,
  id,
  materializar,
  migrar,
  publicarHasta,
  recibirYReclamar
} from './federacion-verificar-5-22-15g.js';

await main();

async function main() {
  await verificarRegistro();
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true);
  const baseDatos = `sentinelia_fixture_52215k_${randomBytes(6).toString('hex')}`;
  const administrador = new ClienteSql(configuracion.sql);
  let sql;
  try {
    await administrador.ejecutar(
      `CREATE DATABASE ${administrador.escaparIdentificador(baseDatos)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    sql = new ClienteSql({ ...configuracion.sql, baseDatos });
    await migrar(sql);
    await verificarMaterializacionYConsulta(sql);
  } finally {
    await sql?.cerrar().catch(() => {});
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(baseDatos)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
  console.log(
    '[federacion] OK 5.22.15k: monitor=remoto_tipado publicacion=frontera_atomica ' +
    'rutas=coexistentes retirada=selectiva historico=conservado local=intacto'
  );
}

async function verificarRegistro() {
  const [runtime, web] = await Promise.all([
    leer('../apps/sentinelia-runtime/src/BootstrapRuntime.js'),
    leer('../apps/sentinelia-web/src/index.js')
  ]);
  assert.match(runtime, /RepositorioMonitoresRemotoSql/u);
  assert.match(runtime, /ProcesadorTiempoEstadosRemotos/u);
  assert.match(web, /new ServicioBorradoresLocalesFederacion/u);
  assert.match(web, /repositorioMonitoresRemotos: new RepositorioMonitoresRemotoSql/u);
  assert.doesNotMatch(web, /\.materializarEnTransaccion\s*\(/u);
}

async function verificarMaterializacionYConsulta(sql) {
  const repositorio = new RepositorioMonitoresRemotoSql(sql);
  const adaptador = new AdaptadorMonitoresFederacion({ repositorioRemoto: repositorio });
  const remota = crearDefinicionAdaptadorMonitoresFederacion({ repositorioRemoto: repositorio });
  assert.equal(remota.productivo, false);
  assert.deepEqual(Object.keys(remota.interfaces), ['payload', 'materializacion']);
  const completa = crearDefinicionAdaptadorMonitoresFederacion({
    repositorioLocal: productorLocalFixture(), repositorioRemoto: repositorio
  });
  assert.equal(completa.productivo, true);
  assert.deepEqual(
    Object.keys(completa.interfaces),
    ['payload', 'captura', 'fotografiaInicial', 'retirada', 'materializacion']
  );

  const installationRemotaId = id(TIPOS_IDENTIDAD_FEDERADA.INSTALACION);
  const monitorOrigenId = id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN);
  await crearElementoMonitor({
    sql, adaptador, installationRemotaId,
    elementoOrigenId: monitorOrigenId,
    payload: payloadDefinicion()
  });
  assert.equal((await repositorio.listarDefiniciones({ monitorOrigenId })).length, 1);

  const estadoElementoOrigenId = id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN);
  const estado = payloadEstado({ monitorOrigenId, estado: 'fallo' });
  const elementoEstado = await crearElementoMonitor({
    sql, adaptador, installationRemotaId,
    elementoOrigenId: estadoElementoOrigenId,
    payload: estado, finalizar: false, publicar: false
  });
  assert.deepEqual(await repositorio.listarEstadosActualesSeleccionables({ monitorOrigenId }), []);
  const replay = await materializar({ sql, adaptador, trabajo: elementoEstado.trabajo, payload: estado });
  assert.equal(replay.yaMaterializada, true);
  await assert.rejects(
    materializar({
      sql, adaptador, trabajo: elementoEstado.trabajo,
      payload: payloadEstado({ monitorOrigenId, estado: 'vivo' })
    }),
    (error) => error.codigo === 'registro_monitor_remoto_divergente'
  );
  await elementoEstado.cicloTrabajos.completar(contextoCierre(elementoEstado.trabajo));
  await publicarHasta(sql, elementoEstado.ids.proyeccionId, elementoEstado.ids.generacionId, '1');

  await crearElementoMonitor({
    sql, adaptador, installationRemotaId,
    elementoOrigenId: id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN),
    payload: payloadEstado({ monitorOrigenId, estado: 'vivo' }),
    scope: { nivel: 'tenant', tenantId: '10', empresaId: null, sitioId: null }
  });
  const estados = await repositorio.listarEstadosActualesSeleccionables({ monitorOrigenId });
  assert.equal(estados.length, 2);
  assert.deepEqual(new Set(estados.map((entrada) => entrada.estadoOperativo)), new Set(['fallo', 'vivo']));
  assert.deepEqual(new Set(estados.map((entrada) => entrada.scopeRecepcion.nivel)), new Set(['empresa', 'tenant']));
  assert.ok(estados.every((entrada) => entrada.completitud.reconstruible === 'parcial'));

  const evento = await crearElementoMonitor({
    sql, adaptador, installationRemotaId,
    elementoOrigenId: id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN),
    payload: payloadEvento({ monitorOrigenId })
  });
  await crearElementoMonitor({
    sql, adaptador, installationRemotaId,
    elementoOrigenId: id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN),
    payload: payloadTramo({
      monitorOrigenId,
      ultimoEventoOrigenId: evento.ids.elementoOrigenId
    })
  });
  await crearElementoMonitor({
    sql, adaptador, installationRemotaId,
    elementoOrigenId: id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN),
    payload: payloadRango({ monitorOrigenId })
  });
  const alertaAuditoriaId = generarUuidV7Auditoria();
  await crearElementoMonitor({
    sql, adaptador, installationRemotaId,
    elementoOrigenId: id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN),
    payload: payloadAlerta({ monitorOrigenId, alertaAuditoriaId })
  });
  const triggerOrigenId = id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN);
  await crearElementoMonitor({
    sql, adaptador, installationRemotaId,
    elementoOrigenId: id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN),
    payload: payloadReferenciaTrigger({ monitorOrigenId, triggerOrigenId })
  });
  assert.equal((await repositorio.listarEventos({ monitorOrigenId })).length, 1);
  assert.equal((await repositorio.listarTramosHistoricos({ monitorOrigenId })).length, 1);
  assert.equal((await repositorio.listarRangosHistoricos({ monitorOrigenId })).length, 1);
  assert.equal((await repositorio.listarAlertasSeleccionables({
    estadoAlerta: 'activa', alertaAuditoriaId
  })).length, 1);
  assert.equal((await repositorio.listarReferenciasTriggers({ referenciaOrigenId: triggerOrigenId })).length, 1);
  assert.throws(
    () => repositorio.listarEventos({
      desdeUtc: '2031-02-01T00:00:00.000Z',
      hastaUtc: '2031-01-01T00:00:00.000Z'
    }),
    (error) => error.codigo === 'rango_consulta_monitores_invalido'
  );

  const retirada = await recibirYReclamar({
    sql, contexto: elementoEstado, secuencia: 2,
    operacion: 'retirada', payload: null, familia: 'monitores'
  });
  await materializar({ sql, adaptador, trabajo: retirada, operacion: 'retirada', payload: null });
  assert.equal((await repositorio.listarEstadosActualesSeleccionables({ monitorOrigenId })).length, 2);
  await elementoEstado.cicloTrabajos.completar(contextoCierre(retirada));
  await publicarHasta(sql, elementoEstado.ids.proyeccionId, elementoEstado.ids.generacionId, '2');
  const supervivientes = await repositorio.listarEstadosActualesSeleccionables({ monitorOrigenId });
  assert.equal(supervivientes.length, 1);
  assert.equal(supervivientes[0].scopeRecepcion.nivel, 'tenant');
  assert.equal((await repositorio.listarEventos({ monitorOrigenId })).length, 1);
  assert.equal((await repositorio.listarTramosHistoricos({ monitorOrigenId })).length, 1);
  assert.equal((await repositorio.listarRangosHistoricos({ monitorOrigenId })).length, 1);
  assert.equal((await repositorio.listarActuales({ proyeccionId: evento.ids.proyeccionId })).length, 1);

  await assert.rejects(
    materializar({
      sql, adaptador, trabajo: { ...retirada, fencingToken: '999999' },
      operacion: 'retirada', payload: null
    }),
    (error) => error.codigo === 'fencing_materializacion_monitor_obsoleto'
  );
  const [conteosLocales] = await sql.consultar(
    `SELECT
       (SELECT COUNT(*) FROM monitores) AS monitores,
       (SELECT COUNT(*) FROM estado_actual_monitores) AS estados,
       (SELECT COUNT(*) FROM eventos_monitores) AS eventos,
       (SELECT COUNT(*) FROM historico_monitores) AS historico,
       (SELECT COUNT(*) FROM alertas_activas_monitores) AS alertas`
  );
  assert.deepEqual(
    Object.fromEntries(Object.entries(conteosLocales).map(([clave, valor]) => [clave, Number(valor)])),
    { monitores: 0, estados: 0, eventos: 0, historico: 0, alertas: 0 }
  );
}

function crearElementoMonitor(opciones) {
  return crearElemento({ ...opciones, familia: 'monitores', versionFamilia: 1 });
}

function base(tipoRegistro) {
  return { perfil: PERFIL_PAYLOAD_MONITORES_FEDERACION, version: 1, tipoRegistro };
}

function contextoHumano() {
  return { descripcionFallo: 'Servicio remoto no disponible', posibleSolucion: 'Revisar el origen' };
}

function payloadDefinicion() {
  return {
    ...base('definicion'), nombre: 'Monitor remoto', tipo: 'tcp', descripcion: 'Definición federada',
    activo: true, intervaloEjecucionSegundos: 60, desfaseInicialSegundos: 0,
    interpretacionEstado: 'normal', configuracionOperativa: { host: 'service.internal', puerto: 443 },
    contextoHumano: contextoHumano(),
    scopeOrganizativo: {
      tenantElementoOrigenId: id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN),
      empresaElementoOrigenId: id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN),
      sitioElementoOrigenId: null
    },
    credencialPropia: { estado: 'omitida', causa: 'noSeleccionada' }, referenciasOperativas: []
  };
}

function payloadEstado({ monitorOrigenId, estado }) {
  return {
    ...base('estadoActual'), monitorOrigenId, versionCatalogo: 'beta-1', estado,
    ejecutadoTodavia: true, fechaUltimaEjecucionUtc: '2031-01-01T00:00:00.000Z',
    fechaUltimoCambioUtc: '2031-01-01T00:00:00.000Z', motivoInicial: 'ejecutado',
    resultadoActual: { codigo: estado }, contextoHumano: contextoHumano(),
    vigenteHastaOrigenUtc: '2031-01-01T00:05:00.000Z'
  };
}

function payloadEvento({ monitorOrigenId }) {
  return {
    ...base('evento'), monitorOrigenId, versionCatalogo: 'beta-1', tipoMonitor: 'tcp',
    estadoDetectado: 'fallo', codigoResultado: 'timeout', mensajeResultado: 'Tiempo agotado',
    exito: false, duracionTotalMs: 1200, ejecutadoEnUtc: '2031-01-01T00:00:00.000Z',
    payloadEvento: { intento: 1 }, contextoHumano: contextoHumano()
  };
}

function payloadTramo({ monitorOrigenId, ultimoEventoOrigenId }) {
  return {
    ...base('tramoHistorico'), monitorOrigenId, versionCatalogo: 'beta-1',
    tipoMonitor: 'tcp', estadoTramo: 'fallo', codigoUltimoResultado: 'timeout',
    mensajeUltimoResultado: 'Tiempo agotado',
    validoDesdeUtc: '2031-01-01T00:00:00.000Z',
    validoHastaUtc: '2031-01-01T00:02:00.000Z', contadorRepeticiones: 2,
    ultimoEventoOrigenId, payloadTramo: { intentos: 2 }, contextoHumano: contextoHumano()
  };
}

function payloadRango({ monitorOrigenId }) {
  return {
    ...base('rangoHistorico'), monitorOrigenId,
    desdeUtc: '2030-12-01T00:00:00.000Z', hastaUtc: '2030-12-31T00:00:00.000Z',
    causa: 'retencionOrigen'
  };
}

function payloadAlerta({ monitorOrigenId, alertaAuditoriaId }) {
  return {
    ...base('alerta'), monitorOrigenId, alertaAuditoriaId, versionCatalogo: 'beta-1',
    tipoMonitor: 'tcp', estadoAlerta: 'activa', estadoDetectado: 'fallo',
    codigoUltimoResultado: 'timeout', mensajeUltimoResultado: 'Tiempo agotado',
    validoDesdeUtc: '2031-01-01T00:00:00.000Z',
    ultimaConfirmacionUtc: '2031-01-01T00:00:01.000Z',
    ultimaEjecucionUtc: '2031-01-01T00:00:01.000Z', cerradaEnUtc: null,
    vigenteHastaOrigenUtc: '2031-01-01T00:05:00.000Z', contadorRepeticiones: 1,
    payloadAlerta: { codigo: 'timeout' },
    descarteOrigen: {
      descartada: false, motivo: '', descartadaEnUtc: null,
      descartadaHastaUtc: null, actorReferencia: { estado: 'omitida' }
    },
    contextoHumano: contextoHumano()
  };
}

function payloadReferenciaTrigger({ monitorOrigenId, triggerOrigenId }) {
  return {
    ...base('referenciaTrigger'), monitorOrigenId, triggerOrigenId,
    visibilidad: 'opaca', activo: true, ordenEjecucion: 0,
    eventosDisparo: ['fallo'], configuracionOverride: null
  };
}

function productorLocalFixture() {
  return {
    prepararCapturaEnTransaccion() {},
    prepararCapturasAdministracionEnTransaccion() {},
    prepararCapturasRuntimeEnTransaccion() {},
    listarCapturasEnTransaccion() {},
    prepararRetiradaEnTransaccion() {}
  };
}

function leer(ruta) { return readFile(new URL(ruta, import.meta.url), 'utf8'); }
