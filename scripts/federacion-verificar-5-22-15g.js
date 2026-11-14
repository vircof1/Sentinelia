import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import {
  AdaptadorTelemetriaFederacion,
  crearDefinicionAdaptadorTelemetriaFederacion
} from '../paquetes/federacion/adaptadores/AdaptadorTelemetriaFederacion.js';
import { FuenteEntropiaCriptograficaNode } from '../paquetes/federacion/adaptadores/FuenteEntropiaCriptograficaNode.js';
import { RepositorioEstadoProyeccionesFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioEstadoProyeccionesFederacionSql.js';
import { RepositorioFlujosFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioFlujosFederacionSql.js';
import { RepositorioInboxFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioInboxFederacionSql.js';
import { RepositorioMaterializacionFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioMaterializacionFederacionSql.js';
import { RepositorioTelemetriaRemotaSql } from '../paquetes/federacion/adaptadores/RepositorioTelemetriaRemotaSql.js';
import { canonicalizarJsonFederacion } from '../paquetes/federacion/src/CanonicalizadorFederacion.js';
import { crearCampoPresenteFederado } from '../paquetes/federacion/src/EnvolventeFederacion.js';
import { GeneradorIdentidadesFederadas, TIPOS_IDENTIDAD_FEDERADA } from '../paquetes/federacion/src/IdentidadFederada.js';
import { PERFIL_PAYLOAD_TELEMETRIA_FEDERACION } from '../paquetes/federacion/src/PayloadTelemetriaFederacion.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones } from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import { obtenerConfiguracionAplicacion, obtenerRutaMigraciones } from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

const PROPIETARIO = 'worker-telemetria-15g';
const USUARIO_FIXTURE = 5_221_507;
const generador = new GeneradorIdentidadesFederadas({
  fuenteEntropia: new FuenteEntropiaCriptograficaNode()
});

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

async function main() {
  await verificarRegistro();
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true);
  const baseDatos = `sentinelia_fixture_52215g_${randomBytes(6).toString('hex')}`;
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
    '[federacion] OK 5.22.15g: telemetria=remota_inmutable ' +
    'publicacion=frontera_atomica historico=conservado huecos=explicitos ' +
    'estado_actual=seleccionable retirada=no_visible familias_productivas=0'
  );
}

async function verificarRegistro() {
  const [runtime, web] = await Promise.all([
    leer('../apps/sentinelia-runtime/src/BootstrapRuntime.js'),
    leer('../apps/sentinelia-web/src/index.js')
  ]);
  assert.match(runtime, /RepositorioTelemetriaRemotaSql/u);
  assert.doesNotMatch(web, /RepositorioTelemetriaRemotaSql/u);
}

async function verificarMaterializacionYConsulta(sql) {
  const repositorio = new RepositorioTelemetriaRemotaSql(sql);
  const adaptador = new AdaptadorTelemetriaFederacion({ repositorioRemoto: repositorio });
  const definicionParcial = crearDefinicionAdaptadorTelemetriaFederacion({
    repositorioRemoto: repositorio
  });
  assert.equal(definicionParcial.productivo, false);
  assert.deepEqual(Object.keys(definicionParcial.interfaces), ['payload', 'materializacion']);
  const productorFixture = {
    prepararCapturaEnTransaccion() {}, prepararCapturasIngestaEnTransaccion() {},
    listarCapturasEnTransaccion() {}, prepararRetiradaEnTransaccion() {}
  };
  const completa = crearDefinicionAdaptadorTelemetriaFederacion({
    repositorioLocal: productorFixture,
    repositorioRemoto: repositorio
  });
  assert.equal(completa.productivo, true);
  assert.deepEqual(
    Object.keys(completa.interfaces),
    ['payload', 'captura', 'fotografiaInicial', 'retirada', 'materializacion']
  );

  const installationRemotaId = id(TIPOS_IDENTIDAD_FEDERADA.INSTALACION);
  const fuenteOrigenId = id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN);
  const senalOrigenId = id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN);
  const observacionOrigenId = id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN);
  const observacion = payloadObservacion({ fuenteOrigenId, senalOrigenId });
  const elementoObservacion = await crearElemento({
    sql, adaptador, installationRemotaId, elementoOrigenId: observacionOrigenId,
    payload: observacion, publicar: false
  });
  assert.deepEqual(await repositorio.listarObservaciones(), []);
  await publicarHasta(sql, elementoObservacion.ids.proyeccionId, elementoObservacion.ids.generacionId, '1');
  let historico = await repositorio.listarObservaciones({ fuenteOrigenId, senalOrigenId });
  assert.equal(historico.length, 1);
  assert.equal(historico[0].payload.valor, 42);
  assert.equal(historico[0].vigenteHastaOrigenUtc, '2031-01-01T00:05:00.000Z');
  await assert.rejects(
    repositorio.listarObservaciones({
      desdeUtc: '2031-02-01T00:00:00.000Z',
      hastaUtc: '2031-01-01T00:00:00.000Z'
    }),
    (error) => error.codigo === 'rango_consulta_telemetria_invalido'
  );

  const fotografia = payloadFotografia({
    fuenteOrigenId, senalOrigenId, observacionOrigenId, observacion
  });
  const fotografiaElementoOrigenId = id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN);
  const elementoFotografia = await crearElemento({
    sql, adaptador, installationRemotaId,
    elementoOrigenId: fotografiaElementoOrigenId,
    payload: fotografia, finalizar: false, publicar: false
  });
  const replay = await materializar({
    sql, adaptador, trabajo: elementoFotografia.trabajo, payload: fotografia
  });
  assert.equal(replay.yaMaterializada, true);
  await assert.rejects(
    materializar({
      sql, adaptador, trabajo: elementoFotografia.trabajo,
      payload: payloadFotografia({
        fuenteOrigenId, senalOrigenId, observacionOrigenId,
        observacion: { ...observacion, valor: 43 }
      })
    }),
    (error) => error.codigo === 'registro_telemetria_divergente'
  );
  await elementoFotografia.cicloTrabajos.completar(contextoCierre(elementoFotografia.trabajo));
  await publicarHasta(sql, elementoFotografia.ids.proyeccionId, elementoFotografia.ids.generacionId, '1');
  await crearElemento({
    sql, adaptador, installationRemotaId,
    elementoOrigenId: fotografiaElementoOrigenId,
    payload: payloadFotografia({
      fuenteOrigenId,
      senalOrigenId,
      observacionOrigenId: id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN),
      observacion: { ...observacion, valor: 41 }
    }),
    scope: { nivel: 'tenant', tenantId: '10', empresaId: null, sitioId: null }
  });
  const estados = await repositorio.listarEstadosSenalSeleccionables({ senalOrigenId });
  assert.equal(estados.length, 2);
  assert.deepEqual(estados.map(({ payload }) => payload.observacion.valor).sort(), [41, 42]);
  assert.deepEqual(new Set(estados.map(({ scopeRecepcion }) => scopeRecepcion.nivel)), new Set(['empresa', 'tenant']));
  assert.equal(estados[0].completitud.reconstruible, 'parcial');
  assert.equal((await repositorio.listarObservaciones({ senalOrigenId })).length, 1);

  await sql.ejecutar(
    `UPDATE relaciones_federacion
        SET estado_autoridad='sinAutoridad',corte_autoridad_utc=UTC_TIMESTAMP(3),
            version_autoridad=version_autoridad+1,revision=revision+1,
            actualizada_en_utc=UTC_TIMESTAMP(3)
      WHERE relacion_id=?`,
    [elementoFotografia.ids.relacionId]
  );
  const estadosSinAutoridad = await repositorio
    .listarEstadosSenalSeleccionables({ senalOrigenId });
  const fotografiaSinAutoridad = estadosSinAutoridad.find(
    ({ proyeccionId }) => proyeccionId === elementoFotografia.ids.proyeccionId
  );
  assert.equal(fotografiaSinAutoridad.estadoProyeccion.autorizacion, 'noAutorizada');
  assert.equal(fotografiaSinAutoridad.estadoProyeccion.soporte, 'huerfana');
  assert.equal(fotografiaSinAutoridad.fotografiaOperativa.utilizableAhora, false);
  await sql.ejecutar(
    `UPDATE relaciones_federacion
        SET estado_autoridad='autorizada',corte_autoridad_utc=NULL,
            version_autoridad=version_autoridad+1,revision=revision+1,
            actualizada_en_utc=UTC_TIMESTAMP(3)
      WHERE relacion_id=?`,
    [elementoFotografia.ids.relacionId]
  );
  const fotografiaReautorizada = (await repositorio
    .listarEstadosSenalSeleccionables({ senalOrigenId }))
    .find(({ proyeccionId }) => proyeccionId === elementoFotografia.ids.proyeccionId);
  assert.equal(fotografiaReautorizada.estadoProyeccion.autorizacion, 'autorizada');
  assert.equal(fotografiaReautorizada.fotografiaOperativa.utilizableAhora, true);

  const rango = payloadRango({ fuenteOrigenId, senalOrigenId });
  await crearElemento({
    sql, adaptador, installationRemotaId,
    elementoOrigenId: id(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN),
    payload: rango
  });
  const rangos = await repositorio.listarRangosHistoricos({ senalOrigenId });
  assert.equal(rangos.length, 1);
  assert.equal(rangos[0].payload.causa, 'retencionOrigen');

  const retirada = await recibirYReclamar({
    sql,
    contexto: elementoFotografia,
    secuencia: 2,
    operacion: 'retirada',
    payload: null
  });
  await materializar({ sql, adaptador, trabajo: retirada, operacion: 'retirada', payload: null });
  assert.equal((await repositorio.listarEstadosSenalSeleccionables({ senalOrigenId })).length, 2);
  await elementoFotografia.cicloTrabajos.completar(contextoCierre(retirada));
  await publicarHasta(sql, elementoFotografia.ids.proyeccionId, elementoFotografia.ids.generacionId, '2');
  const estadoSuperviviente = await repositorio.listarEstadosSenalSeleccionables({ senalOrigenId });
  assert.equal(estadoSuperviviente.length, 1);
  assert.equal(estadoSuperviviente[0].scopeRecepcion.nivel, 'tenant');
  assert.equal((await repositorio.listarObservaciones({ senalOrigenId })).length, 1);
  assert.equal((await repositorio.listarRangosHistoricos({ senalOrigenId })).length, 1);

  await assert.rejects(
    materializar({
      sql, adaptador, trabajo: { ...retirada, fencingToken: '999999' },
      operacion: 'retirada', payload: null
    }),
    (error) => error.codigo === 'fencing_materializacion_telemetria_obsoleto'
  );
}

export async function crearElemento({
  sql, adaptador, installationRemotaId, elementoOrigenId, payload,
  finalizar = true, publicar = true,
  vigenciaRestanteMs = null,
  scope = { nivel: 'empresa', tenantId: '10', empresaId: '20', sitioId: null },
  familia = 'telemetria', versionFamilia = 1
}) {
  const ids = crearIds({ installationRemotaId, elementoOrigenId });
  await crearRelacion(sql, ids);
  await new RepositorioFlujosFederacionSql(sql, {
    installationLocalId: ids.installationLocalId
  }).crearFlujoInicial({
    flujo: {
      flujoId: ids.flujoId, relacionId: ids.relacionId,
      direccion: 'recepcion', familia, versionFamilia,
      contexto: scope
    },
    generacion: {
      generacionId: ids.generacionId, clase: 'inicial', fronteraInicial: '0',
      propietario: { installationId: ids.installationRemotaId, bootId: ids.bootRemotoId, version: 1 }
    }
  });
  const estadoProyecciones = new RepositorioEstadoProyeccionesFederacionSql(sql);
  const registroTrabajos = new RepositorioMaterializacionFederacionSql(sql, {
    generarProyeccionId: () => ids.proyeccionId,
    repositorioEstadoProyecciones: estadoProyecciones
  });
  const cicloTrabajos = new RepositorioMaterializacionFederacionSql(sql);
  const inbox = new RepositorioInboxFederacionSql(sql);
  const contexto = { ids, inbox, registroTrabajos, cicloTrabajos };
  const trabajo = await recibirYReclamar({
    sql, contexto, secuencia: 1, operacion: 'actualizacion', payload,
    familia, versionFamilia, vigenciaRestanteMs
  });
  await materializar({ sql, adaptador, trabajo, payload });
  if (finalizar) await cicloTrabajos.completar(contextoCierre(trabajo));
  if (publicar) await publicarHasta(sql, ids.proyeccionId, ids.generacionId, '1');
  return { ...contexto, trabajo };
}

export async function recibirYReclamar({
  sql, contexto, secuencia, operacion, payload,
  familia = 'telemetria', versionFamilia = 1, vigenciaRestanteMs = null
}) {
  const { ids, inbox, registroTrabajos, cicloTrabajos } = contexto;
  const ocurrencia = crearOcurrencia(
    ids, secuencia, operacion, payload, familia, versionFamilia,
    vigenciaRestanteMs
  );
  const conexion = await sql.obtenerConexion();
  try {
    await conexion.beginTransaction();
    const recibida = await inbox.recibirEnTransaccion(ocurrencia, { conexion });
    const entregaId = ids.entregas[secuencia - 1];
    const canonico = canonicalizarJsonFederacion(ocurrencia);
    const ahora = await ahoraSql(conexion);
    await conexion.execute(
      `INSERT INTO entregas_recepcion_federacion (
         entrega_id,relacion_id,flujo_id,generacion_id,posicion_flujo,
         ocurrencia_canonica,ocurrencia_sha256,creada_en_utc
       ) VALUES (?,?,?,?,?,?,?,?)`,
      [entregaId, ids.relacionId, ids.flujoId, ids.generacionId, String(secuencia), canonico,
        createHash('sha256').update(canonico, 'utf8').digest(), ahora]
    );
    await registroTrabajos.registrarTrabajoEnTransaccion({
      lote: { relacionId: ids.relacionId, flujoId: ids.flujoId, generacionId: ids.generacionId },
      entrega: { entregaId, posicionFlujo: String(secuencia), ocurrencia },
      inboxId: recibida.inboxId
    }, { conexion });
    await conexion.commit();
  } catch (error) {
    await conexion.rollback().catch(() => {});
    throw error;
  } finally {
    conexion.release();
  }
  const [trabajo] = await cicloTrabajos.reclamarPendientes({
    propietario: PROPIETARIO, limite: 1, leaseMs: 60_000
  });
  assert.ok(trabajo);
  return trabajo;
}

export async function materializar({
  sql, adaptador, trabajo, payload, operacion = 'actualizacion'
}) {
  const conexion = await sql.obtenerConexion();
  try {
    await conexion.beginTransaction();
    const resultado = await adaptador.materializarEnTransaccion({
      operacion, payload,
      contexto: {
        entregaId: trabajo.entregaId,
        propietario: trabajo.propietario,
        fencingToken: trabajo.fencingToken
      }
    }, { conexion });
    await conexion.commit();
    return resultado;
  } catch (error) {
    await conexion.rollback().catch(() => {});
    throw error;
  } finally {
    conexion.release();
  }
}

export async function publicarHasta(sql, proyeccionId, generacionId, secuencia) {
  const conexion = await sql.obtenerConexion();
  try {
    await conexion.beginTransaction();
    const [versiones] = await conexion.execute(
      `SELECT estado_publicacion FROM versiones_proyecciones_federacion
        WHERE proyeccion_id=? AND generacion_id=? FOR UPDATE`,
      [proyeccionId, generacionId]
    );
    const primera = versiones[0].estado_publicacion === 'preparando';
    await conexion.execute(
      `UPDATE versiones_proyecciones_federacion
          SET estado_publicacion='actual',estado_materializacion='materializada',
              completitud_interpretable='completa',completitud_observable='completa',
              completitud_reconstruible='parcial',estado_vigencia='vigente',
              estado_soporte='sostenida',estado_autorizacion='autorizada',
              cierre_operativo_validado=TRUE,recepcion_confirmada=TRUE,
              ultima_secuencia_evaluada=?,version_estado=version_estado+1,
              actualizada_en_utc=UTC_TIMESTAMP(3),
              publicada_en_utc=COALESCE(publicada_en_utc,UTC_TIMESTAMP(3)),
              finalizada_en_utc=NULL
        WHERE proyeccion_id=? AND generacion_id=?`,
      [secuencia, proyeccionId, generacionId]
    );
    const versionPublicacion = await avanzarContador(conexion, proyeccionId);
    if (primera) {
      await conexion.execute(
        `INSERT INTO estados_actuales_proyecciones_federacion (
           proyeccion_id,generacion_actual_id,version_publicacion,publicada_en_utc,actualizada_en_utc
         ) VALUES (?,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
        [proyeccionId, generacionId, versionPublicacion]
      );
    } else {
      await conexion.execute(
        `UPDATE estados_actuales_proyecciones_federacion
            SET version_publicacion=?,publicada_en_utc=UTC_TIMESTAMP(3),actualizada_en_utc=UTC_TIMESTAMP(3)
          WHERE proyeccion_id=? AND generacion_actual_id=?`,
        [versionPublicacion, proyeccionId, generacionId]
      );
    }
    await conexion.commit();
  } catch (error) {
    await conexion.rollback().catch(() => {});
    throw error;
  } finally {
    conexion.release();
  }
}

async function avanzarContador(conexion, proyeccionId) {
  await conexion.execute(
    `INSERT IGNORE INTO contadores_publicacion_proyecciones_federacion (
       proyeccion_id,ultima_version_publicacion,actualizada_en_utc
     ) VALUES (?,0,UTC_TIMESTAMP(3))`, [proyeccionId]
  );
  const [filas] = await conexion.execute(
    `SELECT ultima_version_publicacion FROM contadores_publicacion_proyecciones_federacion
      WHERE proyeccion_id=? FOR UPDATE`, [proyeccionId]
  );
  const anterior = String(filas[0].ultima_version_publicacion);
  const siguiente = (BigInt(anterior) + 1n).toString();
  await conexion.execute(
    `UPDATE contadores_publicacion_proyecciones_federacion
        SET ultima_version_publicacion=?,actualizada_en_utc=UTC_TIMESTAMP(3)
      WHERE proyeccion_id=? AND ultima_version_publicacion=?`,
    [siguiente, proyeccionId, anterior]
  );
  return siguiente;
}

function crearOcurrencia(
  ids,
  secuencia,
  operacion,
  payload,
  familia,
  versionFamilia,
  vigenciaRestanteMs
) {
  return {
    familia, familiaVersion: versionFamilia,
    installationOrigenId: ids.installationRemotaId,
    elementoOrigenId: ids.elementoOrigenId,
    ocurrenciaOrigenId: ids.ocurrencias[secuencia - 1],
    secuenciaElemento: String(secuencia), operacion,
    tiempoOrigenUtc: `2031-01-01T00:00:0${secuencia}.000Z`,
    scopeOrigenDeclarado: {
      nivel: 'empresa', tenantId: 'tenant-remoto', empresaId: 'empresa-remota', sitioId: null
    },
    vigenciaRestanteMs,
    campos: operacion === 'actualizacion'
      ? { [familia]: crearCampoPresenteFederado({ valor: payload }) }
      : {},
    evidenciaIntegridad: []
  };
}

function payloadObservacion({ fuenteOrigenId, senalOrigenId }) {
  return {
    perfil: PERFIL_PAYLOAD_TELEMETRIA_FEDERACION, version: 1, tipoRegistro: 'observacion',
    fuenteOrigenId, senalOrigenId, periodoPolOrigenId: null,
    categoria: 'sistema', clave: 'carga', tag: '', codigoSenal: 'sistema.carga',
    tipoDato: 'numero', unidad: '%', valor: 42, calidad: 'buena',
    severidadDeclarada: 'informativa', origen: 'agente',
    vigenteHastaUtc: '2031-01-01T00:05:00.000Z', detalleHumano: 'Carga remota',
    metadatosContextuales: { nucleo: 'total' }, emitidoEnUtc: '2031-01-01T00:00:00.000Z',
    observadoEnUtc: '2031-01-01T00:00:00.000Z', recibidoEnUtc: '2031-01-01T00:00:01.000Z'
  };
}

function payloadFotografia({ fuenteOrigenId, senalOrigenId, observacionOrigenId, observacion }) {
  const { perfil: _perfil, version: _version, tipoRegistro: _tipo, ...cuerpoObservacion } = observacion;
  return {
    perfil: PERFIL_PAYLOAD_TELEMETRIA_FEDERACION, version: 1,
    tipoRegistro: 'fotografiaSenal', senalOrigenId, observacionOrigenId,
    secuenciaSenal: '7',
    observacion: { ...cuerpoObservacion, fuenteOrigenId, senalOrigenId }
  };
}

function payloadRango({ fuenteOrigenId, senalOrigenId }) {
  return {
    perfil: PERFIL_PAYLOAD_TELEMETRIA_FEDERACION, version: 1,
    tipoRegistro: 'rangoHistorico', fuenteOrigenId, senalOrigenId,
    desdeUtc: '2030-12-01T00:00:00.000Z', hastaUtc: '2030-12-31T00:00:00.000Z',
    causa: 'retencionOrigen'
  };
}

export function contextoCierre(trabajo) {
  return { entregaId: trabajo.entregaId, propietario: trabajo.propietario, fencingToken: trabajo.fencingToken };
}

async function crearRelacion(sql, ids) {
  const ahora = new Date();
  await sql.ejecutar(
    `INSERT INTO relaciones_federacion (
       relacion_id,direccion,estado_ciclo,estado_autoridad,estado_identidad,
       estado_compatibilidad,installation_remota_candidata_id,installation_remota_id,
       nombre_remoto_declarado,responsable_usuario_id,responsable_original_usuario_id,
       scope_tenant_id,scope_empresa_id,scope_sitio_id,version_autoridad,
       corte_autoridad_utc,creada_por_usuario_id,creada_en_utc,actualizada_en_utc,revision
     ) VALUES (?,'recepcion','vinculada','autorizada','valida','compatible',?,?,?,
       ?,?,NULL,NULL,NULL,1,NULL,?,?,?,1)`,
    [ids.relacionId, ids.installationRemotaId, ids.installationRemotaId,
      'instancia remota 15g', USUARIO_FIXTURE, USUARIO_FIXTURE,
      USUARIO_FIXTURE, ahora, ahora]
  );
}

function crearIds({ installationRemotaId, elementoOrigenId }) {
  return Object.freeze({
    installationLocalId: id(TIPOS_IDENTIDAD_FEDERADA.INSTALACION), installationRemotaId,
    bootRemotoId: id(TIPOS_IDENTIDAD_FEDERADA.ARRANQUE),
    relacionId: id(TIPOS_IDENTIDAD_FEDERADA.RELACION),
    flujoId: id(TIPOS_IDENTIDAD_FEDERADA.FLUJO),
    generacionId: id(TIPOS_IDENTIDAD_FEDERADA.GENERACION),
    proyeccionId: id(TIPOS_IDENTIDAD_FEDERADA.PROYECCION), elementoOrigenId,
    ocurrencias: Array.from({ length: 2 }, () => id(TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN)),
    entregas: Array.from({ length: 2 }, () => id(TIPOS_IDENTIDAD_FEDERADA.ENTREGA))
  });
}

export function id(tipo) { return String(generador.generar(tipo)); }

export async function migrar(sql) {
  await new EjecutorMigraciones({
    clienteSql: sql,
    repositorioMigraciones: new RepositorioMigraciones(sql),
    rutaMigraciones: obtenerRutaMigraciones()
  }).ejecutarPendientes();
}

async function ahoraSql(conexion) {
  const [filas] = await conexion.query('SELECT UTC_TIMESTAMP(3) AS ahora');
  return filas[0].ahora;
}

function leer(ruta) { return readFile(new URL(ruta, import.meta.url), 'utf8'); }
