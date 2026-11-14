import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { CoordinadorEmisionFederacionRuntime } from '../apps/sentinelia-runtime/src/federacion/CoordinadorEmisionFederacionRuntime.js';
import { AdaptadorCapturaTransaccionalFederacionSql } from '../paquetes/federacion/adaptadores/AdaptadorCapturaTransaccionalFederacionSql.js';
import { FuenteEntropiaCriptograficaNode } from '../paquetes/federacion/adaptadores/FuenteEntropiaCriptograficaNode.js';
import { RepositorioCoordinacionEmisionFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioCoordinacionEmisionFederacionSql.js';
import { RepositorioFlujosFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioFlujosFederacionSql.js';
import { RepositorioOcurrenciasFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioOcurrenciasFederacionSql.js';
import { RepositorioOutboxFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioOutboxFederacionSql.js';
import { crearCampoPresenteFederado } from '../paquetes/federacion/src/EnvolventeFederacion.js';
import { GeneradorIdentidadesFederadas, TIPOS_IDENTIDAD_FEDERADA } from '../paquetes/federacion/src/IdentidadFederada.js';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import { EjecutorMigraciones } from '../paquetes/persistencia-sql/src/EjecutorMigraciones.js';
import { RepositorioMigraciones } from '../paquetes/persistencia-sql/src/RepositorioMigraciones.js';
import { obtenerConfiguracionAplicacion, obtenerRutaMigraciones } from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

const USUARIO_FIXTURE = '5221305';
const generador = new GeneradorIdentidadesFederadas({
  fuenteEntropia: new FuenteEntropiaCriptograficaNode()
});

await main();

async function main() {
  await verificarRegistro();
  await verificarSchedulerSinSolape();
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true);
  const baseDatos = `sentinelia_fixture_52213e_${randomBytes(6).toString('hex')}`;
  const administrador = new ClienteSql(configuracion.sql);
  await administrador.ejecutar(`CREATE DATABASE ${administrador.escaparIdentificador(baseDatos)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  const sql = new ClienteSql({ ...configuracion.sql, baseDatos });
  const ids = crearIds();
  try {
    await new EjecutorMigraciones({
      clienteSql: sql,
      repositorioMigraciones: new RepositorioMigraciones(sql),
      rutaMigraciones: obtenerRutaMigraciones()
    }).ejecutarPendientes();
    await limpiar(sql, ids);
    await preparar(sql, ids);
    await verificarLeaseFencingYRecuperacion(sql, ids);
  } finally {
    await limpiar(sql, ids);
    await sql.cerrar();
    await administrador.ejecutar(`DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(baseDatos)}`).catch(() => {});
    await administrador.cerrar();
  }
  console.log(
    '[federacion] OK 5.22.13e: scheduler=sin_solape lease=sql ' +
    'fencing=monotono recuperacion=vencimiento sustitucion=cercada lotes=diferidos'
  );
}

async function verificarRegistro() {
  const [repositorio, coordinador, runtime] =
    await Promise.all([
      leer('../paquetes/federacion/adaptadores/RepositorioCoordinacionEmisionFederacionSql.js'),
      leer('../apps/sentinelia-runtime/src/federacion/CoordinadorEmisionFederacionRuntime.js'),
      leer('../apps/sentinelia-runtime/src/RuntimeSentinelia.js')
    ]);
  assert.match(repositorio, /FOR UPDATE SKIP LOCKED/u);
  assert.match(repositorio, /lease_expira_utc>UTC_TIMESTAMP\(3\)/u);
  assert.match(runtime, /coordinadorEmisionFederacionRuntime\.procesarPendientes/u);
  assert.doesNotMatch(`${repositorio}\n${coordinador}`, /(?:fetch\s*\(|node:https|entregarLote|obtenerCapacidad)/u);
}

async function verificarSchedulerSinSolape() {
  let resolver;
  let reclamaciones = 0;
  const lease = {
    propietarioId: '1', instanciaId: 'runtime-a',
    leaseToken: 'ab'.repeat(32), fencingToken: '1'
  };
  const repositorio = {
    async reclamarSiguiente() {
      reclamaciones += 1;
      return reclamaciones === 1 ? {
        lease, intentos: 1,
        flujo: { flujoId: 'flujo-a', generacionId: 'gen-a', relacionId: 'rel-a' }
      } : null;
    },
    async renovarLease() { return true; },
    async comprobarLeaseVigente() { return true; },
    async liberarLease() { return true; }
  };
  const coordinador = new CoordinadorEmisionFederacionRuntime({
    repositorioCoordinacion: repositorio,
    instanciaId: 'runtime-a',
    concurrencia: 1,
    procesarFlujo: () => new Promise((resolve) => { resolver = resolve; })
  });
  const primera = coordinador.procesarPendientes({ origen: 'fixture' });
  await esperar(() => typeof resolver === 'function');
  const segunda = coordinador.procesarPendientes({ origen: 'solape' });
  resolver();
  const [resultado, resultadoSolapado] = await Promise.all([primera, segunda]);
  assert.equal(resultadoSolapado, resultado);
  assert.equal(resultado.totalCompletados, 1);
  assert.equal(reclamaciones, 1);

  const inerte = new CoordinadorEmisionFederacionRuntime({
    repositorioCoordinacion: repositorio,
    instanciaId: 'runtime-inerte'
  });
  assert.equal((await inerte.procesarPendientes()).omitido, true);
  assert.equal(reclamaciones, 1, 'Sin procesador no debe consumir outbox.');

  const falloAislado = new CoordinadorEmisionFederacionRuntime({
    repositorioCoordinacion: {
      ...repositorio,
      async reclamarSiguiente() {
        const error = new Error('SQL host secreto no disponible');
        error.codigo = 'almacen_emision_no_disponible';
        throw error;
      }
    },
    instanciaId: 'runtime-fallo',
    procesarFlujo: async () => {}
  });
  assert.deepEqual((await falloAislado.procesarPendientes()).error, {
    codigo: 'almacen_emision_no_disponible'
  });
}

async function verificarLeaseFencingYRecuperacion(sql, ids) {
  const repositorio = new RepositorioCoordinacionEmisionFederacionSql(sql);
  assert.equal(await repositorio.reclamarSiguiente({
    instanciaId: 'runtime-prematuro',
    leaseToken: Buffer.alloc(32, 9),
    ttlSegundos: 30
  }), null, 'Una generacion preparada no puede emitirse antes de publicar su manifiesto.');
  const flujos = new RepositorioFlujosFederacionSql(sql, {
    installationLocalId: ids.installationLocalId
  });
  const preparado = await flujos.obtener(ids.flujoId);
  await flujos.avanzarGeneracion({
    flujoId: ids.flujoId,
    propietario: preparado.generacion.propietario,
    versionEstadoEsperada: preparado.generacion.versionEstado,
    versionFronteraEsperada: preparado.generacion.frontera.version,
    estadoGeneracion: 'transfiriendo',
    estadoFlujo: 'sincronizando',
    frontera: {
      posicionOperativa: null,
      posicionHistorica: null,
      sincronizando: true,
      operativamenteCompleta: false,
      historicamenteCompleta: false,
      parcialPorScope: false,
      degradada: false
    }
  });
  const primero = await repositorio.reclamarSiguiente({
    instanciaId: 'runtime-a', leaseToken: Buffer.alloc(32, 1), ttlSegundos: 30
  });
  assert.equal(primero.lease.fencingToken, '1');
  assert.equal(primero.flujo.flujoId, ids.flujoId);
  assert.equal(await repositorio.comprobarLeaseVigente(primero.lease), true);
  assert.equal(await repositorio.reclamarSiguiente({
    instanciaId: 'runtime-b', leaseToken: Buffer.alloc(32, 2), ttlSegundos: 30
  }), null);

  await sql.ejecutar(`
    UPDATE propietarios_emision_flujos_federacion
       SET lease_expira_utc=TIMESTAMPADD(SECOND,-1,UTC_TIMESTAMP(3))
     WHERE flujo_id=? AND estado='vigente'
  `, [ids.flujoId]);
  const segundo = await repositorio.reclamarSiguiente({
    instanciaId: 'runtime-b', leaseToken: Buffer.alloc(32, 2), ttlSegundos: 30
  });
  assert.equal(segundo.lease.fencingToken, '2');
  assert.equal(await repositorio.comprobarLeaseVigente(primero.lease), false);
  assert.equal(await repositorio.liberarLease(primero.lease), false);
  assert.equal(await repositorio.renovarLease(segundo.lease, { ttlSegundos: 30 }), true);

  await flujos.reemplazarPropietario({
    flujoId: ids.flujoId,
    propietarioEsperado: {
      installationId: ids.installationLocalId, bootId: ids.bootId, version: 1
    },
    nuevoPropietario: {
      installationId: ids.installationLocalId, bootId: ids.bootNuevoId, version: 2
    }
  });
  assert.equal(await repositorio.comprobarLeaseVigente(segundo.lease), false);
  const tercero = await repositorio.reclamarSiguiente({
    instanciaId: 'runtime-c', leaseToken: Buffer.alloc(32, 3), ttlSegundos: 30
  });
  assert.equal(tercero.lease.fencingToken, '3');
  assert.notEqual(tercero.lease.propietarioId, segundo.lease.propietarioId);
  assert.equal(await repositorio.liberarLease(tercero.lease), true);
}

async function preparar(sql, ids) {
  const ahora = new Date();
  await sql.ejecutar(`
    INSERT INTO relaciones_federacion (
      relacion_id,direccion,estado_ciclo,estado_autoridad,estado_identidad,
      estado_compatibilidad,installation_remota_candidata_id,
      installation_remota_id,nombre_remoto_declarado,responsable_usuario_id,
      responsable_original_usuario_id,scope_tenant_id,scope_empresa_id,
      scope_sitio_id,version_autoridad,corte_autoridad_utc,
      creada_por_usuario_id,creada_en_utc,actualizada_en_utc,revision
    ) VALUES (?,'emision','vinculada','autorizada','valida','compatible',?,?,
      'fixture 5.22.13e',?,?,NULL,NULL,NULL,1,NULL,?,?,?,1)
  `, [ids.relacionId, ids.installationRemotaId, ids.installationRemotaId,
    USUARIO_FIXTURE, USUARIO_FIXTURE, USUARIO_FIXTURE, ahora, ahora]);
  await new RepositorioFlujosFederacionSql(sql, {
    installationLocalId: ids.installationLocalId
  }).crearFlujoInicial({
    flujo: {
      flujoId: ids.flujoId, relacionId: ids.relacionId, direccion: 'emision',
      familia: 'monitores', versionFamilia: 1, contexto: { nivel: 'portal' }
    },
    generacion: {
      generacionId: ids.generacionId, clase: 'inicial', fronteraInicial: '0',
      propietario: {
        installationId: ids.installationLocalId, bootId: ids.bootId, version: 1
      }
    }
  });
  const adaptador = new AdaptadorCapturaTransaccionalFederacionSql({
    repositorioOcurrencias: new RepositorioOcurrenciasFederacionSql(sql, {
      installationLocalId: ids.installationLocalId
    }),
    repositorioOutbox: new RepositorioOutboxFederacionSql(sql)
  });
  const conexion = await sql.obtenerConexion();
  try {
    await conexion.beginTransaction();
    await adaptador.capturarEnTransaccion({
      definicion: {
        familia: 'monitores', familiaVersion: 1,
        installationOrigenId: ids.installationLocal,
        elementoOrigenId: ids.elemento,
        ocurrenciaOrigenId: ids.ocurrencia,
        operacion: 'actualizacion', tiempoOrigenUtc: '2030-01-01T00:00:00.000Z',
        scopeOrigenDeclarado: { nivel: 'portal', tenantId: null, empresaId: null, sitioId: null },
        vigenciaRestanteMs: '300000',
        campos: { estadoOperativo: crearCampoPresenteFederado({ valor: { estado: true } }) },
        evidenciaIntegridad: []
      },
      destinos: [{ flujoId: ids.flujoId, generacionId: ids.generacionId }]
    }, { conexion });
    await conexion.commit();
  } catch (error) {
    await conexion.rollback();
    throw error;
  } finally {
    conexion.release();
  }
}

async function limpiar(sql, ids) {
  const relaciones = await sql.consultar(
    'SELECT relacion_id FROM relaciones_federacion WHERE creada_por_usuario_id=?',
    [USUARIO_FIXTURE]
  ).catch(() => []);
  for (const { relacion_id: relacionId } of relaciones) {
    const filas = await sql.consultar(
      'SELECT flujo_id FROM flujos_federacion WHERE relacion_id=?', [relacionId]
    ).catch(() => []);
    for (const { flujo_id: flujoId } of filas) {
      await sql.ejecutar('DELETE FROM outbox_federacion WHERE flujo_id=?', [flujoId]).catch(() => {});
      await sql.ejecutar('DELETE FROM posiciones_ocurrencias_flujos_federacion WHERE flujo_id=?', [flujoId]).catch(() => {});
      await sql.ejecutar('DELETE FROM contadores_posiciones_generaciones_federacion WHERE flujo_id=?', [flujoId]).catch(() => {});
      await sql.ejecutar('DELETE FROM propietarios_emision_flujos_federacion WHERE flujo_id=?', [flujoId]).catch(() => {});
      await sql.ejecutar('UPDATE flujos_federacion SET generacion_activa_id=NULL WHERE flujo_id=?', [flujoId]).catch(() => {});
      await sql.ejecutar(`DELETE FROM fronteras_generaciones_federacion WHERE generacion_id IN
        (SELECT generacion_id FROM generaciones_flujos_federacion WHERE flujo_id=?)`, [flujoId]).catch(() => {});
      await sql.ejecutar('DELETE FROM generaciones_flujos_federacion WHERE flujo_id=?', [flujoId]).catch(() => {});
      await sql.ejecutar('DELETE FROM flujos_federacion WHERE flujo_id=?', [flujoId]).catch(() => {});
    }
    await sql.ejecutar('DELETE FROM relaciones_federacion WHERE relacion_id=?', [relacionId]).catch(() => {});
  }
  await sql.ejecutar(
    'DELETE FROM ocurrencias_federacion WHERE installation_origen_id=?',
    [ids.installationLocalId]
  ).catch(() => {});
  await sql.ejecutar(
    'DELETE FROM reservas_identidad_ocurrencias_federacion WHERE installation_origen_id=?',
    [ids.installationLocalId]
  ).catch(() => {});
  await sql.ejecutar(
    'DELETE FROM contadores_secuencia_elementos_federacion WHERE installation_origen_id=?',
    [ids.installationLocalId]
  ).catch(() => {});
}

function crearIds() {
  const opaca = (tipo) => generador.generar(tipo);
  const installationLocal = opaca(TIPOS_IDENTIDAD_FEDERADA.INSTALACION);
  const elemento = opaca(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN);
  const ocurrencia = opaca(TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN);
  const id = (tipo) => String(opaca(tipo));
  return {
    installationLocal,
    installationLocalId: String(installationLocal),
    installationRemotaId: id(TIPOS_IDENTIDAD_FEDERADA.INSTALACION),
    bootId: id(TIPOS_IDENTIDAD_FEDERADA.ARRANQUE),
    bootNuevoId: id(TIPOS_IDENTIDAD_FEDERADA.ARRANQUE),
    relacionId: id(TIPOS_IDENTIDAD_FEDERADA.RELACION),
    flujoId: id(TIPOS_IDENTIDAD_FEDERADA.FLUJO),
    generacionId: id(TIPOS_IDENTIDAD_FEDERADA.GENERACION),
    elemento,
    elementoId: String(elemento),
    ocurrencia,
    ocurrenciaId: String(ocurrencia)
  };
}

async function esperar(condicion) {
  for (let intento = 0; intento < 100; intento += 1) {
    if (condicion()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error('Timeout esperando el fixture concurrente.');
}

function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}
