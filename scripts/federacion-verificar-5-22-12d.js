import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createClient } from 'redis';

import { AdaptadorCapturaTransaccionalFederacionSql } from '../paquetes/federacion/adaptadores/AdaptadorCapturaTransaccionalFederacionSql.js';
import { FuenteEntropiaCriptograficaNode } from '../paquetes/federacion/adaptadores/FuenteEntropiaCriptograficaNode.js';
import { PublicadorDisponibilidadOutboxFederacionRedis } from '../paquetes/federacion/adaptadores/PublicadorDisponibilidadOutboxFederacionRedis.js';
import { RepositorioFlujosFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioFlujosFederacionSql.js';
import { RepositorioOcurrenciasFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioOcurrenciasFederacionSql.js';
import { RepositorioOutboxFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioOutboxFederacionSql.js';
import {
  ErrorPublicacionPostcommitFederacion,
  ServicioCapturaFederadaProductorWeb
} from '../paquetes/federacion/aplicacion/ServicioCapturaFederadaProductorWeb.js';
import { crearCampoPresenteFederado } from '../paquetes/federacion/src/EnvolventeFederacion.js';
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

const USUARIO_FIXTURE = '5221204';
const TABLA_FIXTURE = 'fixture_productor_web_federacion_52212d';
const CANAL = `sentinelia:fixture:52212d:${Date.now()}:${process.pid}`;
const generador = new GeneradorIdentidadesFederadas({
  fuenteEntropia: new FuenteEntropiaCriptograficaNode()
});

await main();

async function main() {
  await verificarRegistro();
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true);
  const baseDatos = `sentinelia_fixture_52212d_${randomBytes(6).toString('hex')}`;
  const administrador = new ClienteSql(configuracion.sql);
  await administrador.ejecutar(
    `CREATE DATABASE ${administrador.escaparIdentificador(baseDatos)} ` +
    'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
  );
  const sql = new ClienteSql({ ...configuracion.sql, baseDatos });
  const redis = createClient({ url: configuracion.redis.url });
  const suscriptor = redis.duplicate();
  redis.on('error', () => {});
  suscriptor.on('error', () => {});
  const ids = crearIdentidades();
  const mensajes = [];
  await redis.connect();
  await suscriptor.connect();
  await suscriptor.subscribe(CANAL, (mensaje) => mensajes.push(JSON.parse(mensaje)));
  try {
    await new EjecutorMigraciones({
      clienteSql: sql,
      repositorioMigraciones: new RepositorioMigraciones(sql),
      rutaMigraciones: obtenerRutaMigraciones()
    }).ejecutarPendientes();
    await crearTablaFixture(sql);
    await limpiarPlanoControl(sql);
    await crearRelacionFixture(sql, ids);
    await crearFlujoFixture(sql, ids);
    await verificarRollbackNoPublica(sql, redis, ids, mensajes);
    await verificarCommitAntesDeRedis(sql, redis, ids, mensajes);
    await verificarFalloRedisNoRevierte(sql, ids, mensajes);
  } finally {
    await limpiarDatosFixture(sql, ids);
    await limpiarPlanoControl(sql);
    await sql.ejecutar(`DROP TABLE IF EXISTS ${TABLA_FIXTURE}`).catch(() => {});
    await suscriptor.unsubscribe(CANAL).catch(() => {});
    await suscriptor.quit().catch(() => {});
    await redis.quit().catch(() => {});
    await sql.cerrar();
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(baseDatos)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
  console.log(
    '[federacion] OK 5.22.12d: productor=web-fixture captura=misma-transaccion ' +
    'redis=postcommit rollback=no-publica fallo-redis=sql-confirmado'
  );
}

async function verificarRegistro() {
  const [servicio, publicador] = await Promise.all([
    leer('../paquetes/federacion/aplicacion/ServicioCapturaFederadaProductorWeb.js'),
    leer('../paquetes/federacion/adaptadores/PublicadorDisponibilidadOutboxFederacionRedis.js')
  ]);
  assert.match(servicio, /mutarEnTransaccion/u);
  assert.match(servicio, /puertoCaptura\.capturarEnTransaccion/u);
  assert.ok(
    servicio.indexOf('await conexion.commit()') <
      servicio.indexOf('publicadorDisponibilidad.publicar'),
    'La publicación debe aparecer después del commit en el servicio.'
  );
  assert.match(publicador, /clienteRedis\.publish/u);
  assert.doesNotMatch(publicador, /(?:payload_canonico|campos|evidenciaIntegridad)/u);
}

async function verificarRollbackNoPublica(sql, redis, ids, mensajes) {
  const orden = [];
  const servicio = crearServicio({ sql, redis, ids, orden });
  const mensajesAntes = mensajes.length;
  await assert.rejects(
    servicio.ejecutar({
      captura: {
        definicion: definicion(ids, ids.ocurrenciaRollbackId, 'rollback'),
        destinos: [{
          flujoId: String(ids.flujoId),
          generacionId: String(ids.generacionInexistenteId)
        }]
      },
      mutarEnTransaccion: ({ conexion }) => mutarFixture(
        conexion,
        'rollback',
        'no debe sobrevivir'
      )
    })
  );
  await esperarMensajes();
  assert.equal(mensajes.length, mensajesAntes);
  assert.equal(orden.includes('redis'), false);
  const [negocio, ocurrencia, outbox] = await Promise.all([
    sql.consultar(`SELECT COUNT(*) AS total FROM ${TABLA_FIXTURE} WHERE id='rollback'`),
    sql.consultar(
      'SELECT COUNT(*) AS total FROM ocurrencias_federacion WHERE ocurrencia_origen_id=?',
      [String(ids.ocurrenciaRollbackId)]
    ),
    sql.consultar(
      'SELECT COUNT(*) AS total FROM outbox_federacion WHERE flujo_id=?',
      [String(ids.flujoId)]
    )
  ]);
  assert.deepEqual([negocio[0].total, ocurrencia[0].total, outbox[0].total].map(Number), [0, 0, 0]);
}

async function verificarCommitAntesDeRedis(sql, redis, ids, mensajes) {
  const orden = [];
  const servicio = crearServicio({ sql, redis, ids, orden, comprobarCommit: true });
  const resultado = await servicio.ejecutar({
    captura: {
      definicion: definicion(ids, ids.ocurrenciaConfirmadaId, 'correcto'),
      destinos: [destino(ids)]
    },
    mutarEnTransaccion: async ({ conexion, captura }) => {
      assert.equal(
        String(captura.definicion.ocurrenciaOrigenId),
        String(ids.ocurrenciaConfirmadaId)
      );
      orden.push('mutacion');
      return mutarFixture(conexion, 'confirmada', 'cambio web confirmado');
    }
  });
  await esperarHasta(() => mensajes.length === 1);
  assert.deepEqual(orden, [
    'begin', 'mutacion', 'captura', 'commit-inicio', 'commit-fin', 'release',
    'redis'
  ]);
  assert.equal(resultado.captura.estadoOcurrencia, 'creada');
  assert.equal(resultado.publicacion.publicado, true);
  assert.equal(resultado.publicacion.receptores, 1);
  assert.deepEqual(mensajes[0], {
    perfil: 'sentinelia-federacion-outbox-disponible-v1',
    version: 1,
    publicadoEnUtc: '2031-02-03T04:05:06.000Z',
    prefijos: [{
      flujoId: String(ids.flujoId),
      generacionId: String(ids.generacionId),
      posicionMinimaObservada: '1',
      posicionMaximaObservada: '1',
      totalPosiciones: 1
    }]
  });
}

async function verificarFalloRedisNoRevierte(sql, ids, mensajes) {
  const orden = [];
  const base = crearServicio({
    sql,
    redis: {
      async publish() {
        throw new Error('Redis fixture no disponible.');
      }
    },
    ids,
    orden
  });
  let capturado;
  try {
    await base.ejecutar({
      captura: {
        definicion: definicion(ids, ids.ocurrenciaRedisFallidoId, 'fallo-redis'),
        destinos: [destino(ids)]
      },
      mutarEnTransaccion: ({ conexion }) => {
        orden.push('mutacion');
        return mutarFixture(conexion, 'redis-fallido', 'sobrevive al fallo Redis');
      }
    });
  } catch (error) {
    capturado = error;
  }
  assert.ok(capturado instanceof ErrorPublicacionPostcommitFederacion);
  assert.equal(capturado.codigo, 'publicacion_postcommit_fallida');
  assert.equal(capturado.cambioConfirmado, true);
  assert.equal(capturado.resultadoConfirmado.captura.estadoOcurrencia, 'creada');
  assert.deepEqual(orden, [
    'begin', 'mutacion', 'captura', 'commit-inicio', 'commit-fin', 'release',
    'redis-fallido'
  ]);
  assert.equal(mensajes.length, 1);
  const [negocio, outbox] = await Promise.all([
    sql.consultar(
      `SELECT valor FROM ${TABLA_FIXTURE} WHERE id='redis-fallido'`
    ),
    sql.consultar(
      `SELECT COUNT(*) AS total FROM outbox_federacion o
        JOIN posiciones_ocurrencias_flujos_federacion p
          ON p.flujo_id=o.flujo_id AND p.generacion_id=o.generacion_id
         AND p.posicion_flujo=o.posicion_flujo
       WHERE p.ocurrencia_origen_id=?`,
      [String(ids.ocurrenciaRedisFallidoId)]
    )
  ]);
  assert.equal(negocio[0].valor, 'sobrevive al fallo Redis');
  assert.equal(Number(outbox[0].total), 1);
}

function crearServicio({ sql, redis, ids, orden, comprobarCommit = false }) {
  const repositorioOcurrencias = new RepositorioOcurrenciasFederacionSql(sql, {
    installationLocalId: String(ids.installationLocalId)
  });
  const repositorioOutbox = new RepositorioOutboxFederacionSql(sql);
  const capturaSql = new AdaptadorCapturaTransaccionalFederacionSql({
    repositorioOcurrencias,
    repositorioOutbox
  });
  const puertoCaptura = {
    async capturarEnTransaccion(solicitud, opciones) {
      orden.push('captura');
      return capturaSql.capturarEnTransaccion(solicitud, opciones);
    }
  };
  const clienteSql = clienteSqlObservado(sql, orden);
  const clienteRedis = {
    async publish(canal, mensaje) {
      if (comprobarCommit) {
        assert.equal(orden.at(-1), 'release');
        const [negocio, outbox] = await Promise.all([
          sql.consultar(`SELECT COUNT(*) AS total FROM ${TABLA_FIXTURE} WHERE id='confirmada'`),
          sql.consultar(
            'SELECT COUNT(*) AS total FROM outbox_federacion WHERE flujo_id=?',
            [String(ids.flujoId)]
          )
        ]);
        assert.deepEqual([Number(negocio[0].total), Number(outbox[0].total)], [1, 1]);
      }
      orden.push(comprobarCommit ? 'redis' : 'redis-fallido');
      return redis.publish(canal, mensaje);
    }
  };
  const publicadorDisponibilidad = new PublicadorDisponibilidadOutboxFederacionRedis({
    clienteRedis,
    canal: CANAL,
    reloj: () => new Date('2031-02-03T04:05:06.000Z')
  });
  return new ServicioCapturaFederadaProductorWeb({
    clienteSql,
    puertoCaptura,
    publicadorDisponibilidad
  });
}

function clienteSqlObservado(sql, orden) {
  return {
    async obtenerConexion() {
      const real = await sql.obtenerConexion();
      return {
        execute: real.execute.bind(real),
        query: real.query.bind(real),
        async beginTransaction() {
          orden.push('begin');
          return real.beginTransaction();
        },
        async commit() {
          orden.push('commit-inicio');
          const resultado = await real.commit();
          orden.push('commit-fin');
          return resultado;
        },
        async rollback() {
          orden.push('rollback');
          return real.rollback();
        },
        release() {
          orden.push('release');
          real.release();
        }
      };
    }
  };
}

async function mutarFixture(conexion, id, valor) {
  await conexion.execute(
    `INSERT INTO ${TABLA_FIXTURE} (id,valor) VALUES (?,?)`,
    [id, valor]
  );
  return Object.freeze({ id, valor });
}

async function crearTablaFixture(sql) {
  await sql.ejecutar(
    `CREATE TABLE IF NOT EXISTS ${TABLA_FIXTURE} (
       id VARCHAR(64) NOT NULL,
       valor VARCHAR(255) NOT NULL,
       PRIMARY KEY (id)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`
  );
  await sql.ejecutar(`DELETE FROM ${TABLA_FIXTURE}`);
}

async function crearFlujoFixture(sql, ids) {
  const repositorio = new RepositorioFlujosFederacionSql(sql, {
    installationLocalId: String(ids.installationLocalId)
  });
  await repositorio.crearFlujoInicial({
    flujo: {
      flujoId: String(ids.flujoId),
      relacionId: String(ids.relacionId),
      direccion: 'emision',
      familia: 'monitores',
      versionFamilia: 1,
      contexto: { nivel: 'portal' }
    },
    generacion: {
      generacionId: String(ids.generacionId),
      clase: 'inicial',
      fronteraInicial: '0',
      propietario: {
        installationId: String(ids.installationLocalId),
        bootId: String(ids.bootId),
        version: 1
      }
    }
  });
}

function destino(ids) {
  return {
    flujoId: String(ids.flujoId),
    generacionId: String(ids.generacionId)
  };
}

function definicion(ids, ocurrenciaOrigenId, estado) {
  return {
    familia: 'monitores',
    familiaVersion: 1,
    installationOrigenId: ids.installationLocalId,
    elementoOrigenId: ids.elementoOrigenId,
    ocurrenciaOrigenId,
    operacion: 'actualizacion',
    tiempoOrigenUtc: '2030-01-01T00:00:00.000Z',
    scopeOrigenDeclarado: {
      nivel: 'portal',
      tenantId: null,
      empresaId: null,
      sitioId: null
    },
    vigenciaRestanteMs: '300000',
    campos: {
      estadoOperativo: crearCampoPresenteFederado({
        valor: { estado, contexto: 'productor web fixture 5.22.12d' }
      })
    },
    evidenciaIntegridad: []
  };
}

async function crearRelacionFixture(sql, ids) {
  const ahora = new Date();
  await sql.ejecutar(
    `INSERT INTO relaciones_federacion (
       relacion_id,direccion,estado_ciclo,estado_autoridad,estado_identidad,
       estado_compatibilidad,installation_remota_candidata_id,
       installation_remota_id,nombre_remoto_declarado,responsable_usuario_id,
       responsable_original_usuario_id,scope_tenant_id,scope_empresa_id,
       scope_sitio_id,version_autoridad,corte_autoridad_utc,
       creada_por_usuario_id,creada_en_utc,actualizada_en_utc,revision
     ) VALUES (
       ?,'emision','vinculada','autorizada','valida','compatible',?,?,
       'fixture 5.22.12d',?,?,NULL,NULL,NULL,1,NULL,?,?,?,1
     )`,
    [
      String(ids.relacionId),
      String(ids.installationRemotaId),
      String(ids.installationRemotaId),
      USUARIO_FIXTURE,
      USUARIO_FIXTURE,
      USUARIO_FIXTURE,
      ahora,
      ahora
    ]
  );
}

async function limpiarDatosFixture(sql, ids) {
  const flujoId = String(ids.flujoId);
  await sql.ejecutar('DELETE FROM outbox_federacion WHERE flujo_id=?', [flujoId])
    .catch(() => {});
  await sql.ejecutar(
    'DELETE FROM posiciones_ocurrencias_flujos_federacion WHERE flujo_id=?',
    [flujoId]
  ).catch(() => {});
  await sql.ejecutar(
    'DELETE FROM contadores_posiciones_generaciones_federacion WHERE flujo_id=?',
    [flujoId]
  ).catch(() => {});
  await sql.ejecutar(
    'DELETE FROM ocurrencias_federacion WHERE installation_origen_id=?',
    [String(ids.installationLocalId)]
  ).catch(() => {});
  await sql.ejecutar(
    'DELETE FROM reservas_identidad_ocurrencias_federacion WHERE installation_origen_id=?',
    [String(ids.installationLocalId)]
  ).catch(() => {});
  await sql.ejecutar(
    'DELETE FROM contadores_secuencia_elementos_federacion WHERE installation_origen_id=?',
    [String(ids.installationLocalId)]
  ).catch(() => {});
}

async function limpiarPlanoControl(sql) {
  const relaciones = await sql.consultar(
    'SELECT relacion_id FROM relaciones_federacion WHERE creada_por_usuario_id=?',
    [USUARIO_FIXTURE]
  ).catch(() => []);
  for (const { relacion_id: relacionId } of relaciones) {
    const flujos = await sql.consultar(
      'SELECT flujo_id FROM flujos_federacion WHERE relacion_id=?',
      [relacionId]
    ).catch(() => []);
    const flujoIds = flujos.map(({ flujo_id: flujoId }) => flujoId);
    if (flujoIds.length) {
      const marcas = flujoIds.map(() => '?').join(',');
      await sql.ejecutar(`DELETE FROM outbox_federacion WHERE flujo_id IN (${marcas})`, flujoIds)
        .catch(() => {});
      await sql.ejecutar(
        `DELETE FROM posiciones_ocurrencias_flujos_federacion WHERE flujo_id IN (${marcas})`,
        flujoIds
      ).catch(() => {});
      await sql.ejecutar(
        `DELETE FROM contadores_posiciones_generaciones_federacion WHERE flujo_id IN (${marcas})`,
        flujoIds
      ).catch(() => {});
      await sql.ejecutar(
        `DELETE FROM propietarios_emision_flujos_federacion WHERE flujo_id IN (${marcas})`,
        flujoIds
      );
      await sql.ejecutar(
        `UPDATE flujos_federacion SET generacion_activa_id=NULL WHERE flujo_id IN (${marcas})`,
        flujoIds
      );
      await sql.ejecutar(
        `DELETE FROM fronteras_generaciones_federacion WHERE generacion_id IN (
          SELECT generacion_id FROM generaciones_flujos_federacion
           WHERE flujo_id IN (${marcas})
        )`,
        flujoIds
      );
      await sql.ejecutar(
        `DELETE FROM generaciones_flujos_federacion WHERE flujo_id IN (${marcas})`,
        flujoIds
      );
      await sql.ejecutar(`DELETE FROM flujos_federacion WHERE flujo_id IN (${marcas})`, flujoIds);
    }
    await sql.ejecutar('DELETE FROM relaciones_federacion WHERE relacion_id=?', [relacionId]);
  }
}

function crearIdentidades() {
  const generar = (tipo) => generador.generar(tipo);
  return {
    installationLocalId: generar(TIPOS_IDENTIDAD_FEDERADA.INSTALACION),
    installationRemotaId: generar(TIPOS_IDENTIDAD_FEDERADA.INSTALACION),
    bootId: generar(TIPOS_IDENTIDAD_FEDERADA.ARRANQUE),
    relacionId: generar(TIPOS_IDENTIDAD_FEDERADA.RELACION),
    flujoId: generar(TIPOS_IDENTIDAD_FEDERADA.FLUJO),
    generacionId: generar(TIPOS_IDENTIDAD_FEDERADA.GENERACION),
    generacionInexistenteId: generar(TIPOS_IDENTIDAD_FEDERADA.GENERACION),
    elementoOrigenId: generar(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN),
    ocurrenciaRollbackId: generar(TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN),
    ocurrenciaConfirmadaId: generar(TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN),
    ocurrenciaRedisFallidoId: generar(TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN)
  };
}

async function esperarHasta(condicion) {
  const limite = Date.now() + 2000;
  while (!condicion() && Date.now() < limite) {
    await new Promise((resolver) => setTimeout(resolver, 10));
  }
  assert.equal(condicion(), true, 'No llegó la publicación Redis esperada.');
}

async function esperarMensajes() {
  await new Promise((resolver) => setTimeout(resolver, 30));
}

function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}
