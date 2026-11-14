import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { AdaptadorCapturaTransaccionalFederacionSql } from '../paquetes/federacion/adaptadores/AdaptadorCapturaTransaccionalFederacionSql.js';
import { FuenteEntropiaCriptograficaNode } from '../paquetes/federacion/adaptadores/FuenteEntropiaCriptograficaNode.js';
import { RepositorioFlujosFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioFlujosFederacionSql.js';
import { RepositorioOcurrenciasFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioOcurrenciasFederacionSql.js';
import { RepositorioOutboxFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioOutboxFederacionSql.js';
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

const USUARIO_FIXTURE = '5221203';
const generador = new GeneradorIdentidadesFederadas({
  fuenteEntropia: new FuenteEntropiaCriptograficaNode()
});

await main();

async function main() {
  await verificarRegistro();
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true);
  const baseDatos = `sentinelia_fixture_52212c_${randomBytes(6).toString('hex')}`;
  const administrador = new ClienteSql(configuracion.sql);
  await administrador.ejecutar(`CREATE DATABASE ${administrador.escaparIdentificador(baseDatos)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  const sql = new ClienteSql({ ...configuracion.sql, baseDatos });
  const ids = crearIdentidades();
  try {
    await new EjecutorMigraciones({
      clienteSql: sql,
      repositorioMigraciones: new RepositorioMigraciones(sql),
      rutaMigraciones: obtenerRutaMigraciones()
    }).ejecutarPendientes();
    await limpiarPlanoControl(sql);
    await crearRelacionFixture(sql, ids);
    await crearFlujoFixture(sql, ids);
    await verificarIndices(sql);
    await verificarCapturaYRollback(sql, ids);
    await verificarSinResiduos(sql, ids);
    await verificarCommitReplayYAislamiento(sql, ids);
  } finally {
    await limpiarDatosFixture(sql, ids);
    await limpiarPlanoControl(sql);
    await sql.cerrar();
    await administrador.ejecutar(`DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(baseDatos)}`).catch(() => {});
    await administrador.cerrar();
  }
  console.log(
    '[federacion] OK 5.22.12c: outbox=propia captura=atomica replay=idempotente ' +
    'conexion=prestada reclamacion=indexada auditoria=aislada red=ausente'
  );
}

async function verificarRegistro() {
  const [repositorio, adaptador] = await Promise.all([
    leer('../paquetes/federacion/adaptadores/RepositorioOutboxFederacionSql.js'),
    leer('../paquetes/federacion/adaptadores/AdaptadorCapturaTransaccionalFederacionSql.js')
  ]);
  assert.doesNotMatch(repositorio, /outbox_auditoria_runtime/u);
  assert.doesNotMatch(adaptador, /outbox_auditoria_runtime/u);
  assert.doesNotMatch(
    `${repositorio}\n${adaptador}`,
    /\.(?:commit|rollback|beginTransaction)\s*\(/u
  );
  assert.doesNotMatch(
    `${repositorio}\n${adaptador}`,
    /(?:redis|fetch\s*\(|https?:|node:https|node:http)/iu
  );
}

async function verificarIndices(sql) {
  const filas = await sql.consultar(
    `SELECT index_name,seq_in_index,column_name
       FROM information_schema.statistics
      WHERE table_schema=DATABASE() AND table_name='outbox_federacion'
        AND index_name IN (
          'uk_outbox_federacion_posicion',
          'idx_outbox_federacion_reclamacion',
          'idx_outbox_federacion_prefijo'
        )
      ORDER BY index_name,seq_in_index`
  );
  const columnas = (indice) => filas
    .filter((fila) => fila.index_name === indice)
    .map((fila) => fila.column_name);
  assert.deepEqual(columnas('uk_outbox_federacion_posicion'), [
    'flujo_id', 'generacion_id', 'posicion_flujo'
  ]);
  const columnasReclamacionBase = [
    'estado', 'disponible_desde_utc', 'flujo_id', 'generacion_id', 'posicion_flujo'
  ];
  assert.deepEqual(
    columnas('idx_outbox_federacion_reclamacion')
      .filter((columna) => columnasReclamacionBase.includes(columna)),
    columnasReclamacionBase
  );
  assert.deepEqual(columnas('idx_outbox_federacion_prefijo'), [
    'flujo_id', 'generacion_id', 'estado', 'posicion_flujo'
  ]);
}

async function verificarCapturaYRollback(sql, ids) {
  const { adaptador, repositorioOutbox } = crearCaptura(sql, ids);
  const conexion = await sql.obtenerConexion();
  try {
    await assert.rejects(
      adaptador.capturarEnTransaccion({
        definicion: definicion(ids, ids.ocurrenciaRollbackId, 'rollback'),
        destinos: [destino(ids)]
      }, { conexion }),
      (error) => error.codigo === 'transaccion_prestada_inactiva'
    );
    await assert.rejects(
      repositorioOutbox.encolarPosicionesEnTransaccion([], { conexion }),
      (error) => error.codigo === 'transaccion_prestada_inactiva'
    );

    await conexion.beginTransaction();
    const resultado = await adaptador.capturarEnTransaccion({
      definicion: definicion(ids, ids.ocurrenciaRollbackId, 'rollback'),
      destinos: [destino(ids)]
    }, { conexion });
    assert.equal(resultado.estadoOcurrencia, 'creada');
    assert.equal(resultado.posiciones[0].posicionFlujo, '1');
    assert.equal(resultado.obligaciones[0].resultadoAlta, 'creada');
    const [totales] = await conexion.query(
      `SELECT
         (SELECT COUNT(*) FROM ocurrencias_federacion
           WHERE ocurrencia_origen_id=?) AS ocurrencias,
         (SELECT COUNT(*) FROM posiciones_ocurrencias_flujos_federacion
           WHERE flujo_id=?) AS posiciones,
         (SELECT COUNT(*) FROM outbox_federacion
           WHERE flujo_id=?) AS obligaciones`,
      [
        String(ids.ocurrenciaRollbackId),
        String(ids.flujoId),
        String(ids.flujoId)
      ]
    );
    assert.deepEqual([
      Number(totales[0].ocurrencias),
      Number(totales[0].posiciones),
      Number(totales[0].obligaciones)
    ], [1, 1, 1]);
  } finally {
    await conexion.rollback();
    conexion.release();
  }
}

async function verificarSinResiduos(sql, ids) {
  const [filas] = await Promise.all([
    sql.consultar(
      `SELECT
         (SELECT COUNT(*) FROM ocurrencias_federacion
           WHERE installation_origen_id=?) AS ocurrencias,
         (SELECT COUNT(*) FROM posiciones_ocurrencias_flujos_federacion
           WHERE flujo_id=?) AS posiciones,
         (SELECT COUNT(*) FROM outbox_federacion
           WHERE flujo_id=?) AS obligaciones`,
      [String(ids.installationLocalId), String(ids.flujoId), String(ids.flujoId)]
    )
  ]);
  assert.deepEqual([
    Number(filas[0].ocurrencias),
    Number(filas[0].posiciones),
    Number(filas[0].obligaciones)
  ], [0, 0, 0]);
}

async function verificarCommitReplayYAislamiento(sql, ids) {
  const { adaptador, repositorioOutbox } = crearCaptura(sql, ids);
  const auditoriaAntes = await contarOutboxAuditoria(sql);
  const primeraDefinicion = definicion(ids, ids.ocurrenciaPrimeraId, 'fallo');
  const segundaDefinicion = definicion(ids, ids.ocurrenciaSegundaId, 'correcto');

  const conexion = await sql.obtenerConexion();
  try {
    await conexion.beginTransaction();
    const primera = await adaptador.capturarEnTransaccion({
      definicion: primeraDefinicion,
      destinos: [destino(ids)]
    }, { conexion });
    const segunda = await adaptador.capturarEnTransaccion({
      definicion: segundaDefinicion,
      destinos: [destino(ids)]
    }, { conexion });
    assert.deepEqual(
      [primera.posiciones[0].posicionFlujo, segunda.posiciones[0].posicionFlujo],
      ['1', '2']
    );
    await conexion.commit();
  } catch (error) {
    await conexion.rollback();
    throw error;
  } finally {
    conexion.release();
  }

  const pendientes = await repositorioOutbox.listarPendientes({ limite: 10 });
  const propias = pendientes.filter((item) => item.flujoId === String(ids.flujoId));
  assert.deepEqual(propias.map((item) => [
    item.posicionFlujo,
    item.estado,
    item.ocurrencia.ocurrenciaOrigenId
  ]), [
    ['1', 'pendiente', String(ids.ocurrenciaPrimeraId)],
    ['2', 'pendiente', String(ids.ocurrenciaSegundaId)]
  ]);

  const replayConexion = await sql.obtenerConexion();
  try {
    await replayConexion.beginTransaction();
    const replay = await adaptador.capturarEnTransaccion({
      definicion: primeraDefinicion,
      destinos: [destino(ids)]
    }, { conexion: replayConexion });
    assert.equal(replay.estadoOcurrencia, 'yaConocida');
    assert.equal(replay.posiciones[0].estado, 'yaAsignada');
    assert.equal(replay.obligaciones[0].resultadoAlta, 'yaEncolada');
    await assert.rejects(
      adaptador.capturarEnTransaccion({
        definicion: {
          ...primeraDefinicion,
          campos: campos('reinterpretado')
        },
        destinos: [destino(ids)]
      }, { conexion: replayConexion }),
      (error) => error.codigo === 'identidad_causal_divergente'
    );
    await replayConexion.commit();
  } catch (error) {
    await replayConexion.rollback();
    throw error;
  } finally {
    replayConexion.release();
  }

  const obligaciones = await sql.consultar(
    `SELECT id,posicion_flujo FROM outbox_federacion
      WHERE flujo_id=? ORDER BY posicion_flujo`,
    [String(ids.flujoId)]
  );
  assert.deepEqual(obligaciones.map((fila) => String(fila.posicion_flujo)), ['1', '2']);
  await assert.rejects(
    sql.ejecutar(
      'UPDATE outbox_federacion SET posicion_flujo=3 WHERE id=?',
      [obligaciones[0].id]
    ),
    (error) => error.sqlState === '45000'
  );
  assert.equal(await contarOutboxAuditoria(sql), auditoriaAntes);
}

function crearCaptura(sql, ids) {
  const repositorioOcurrencias = new RepositorioOcurrenciasFederacionSql(sql, {
    installationLocalId: String(ids.installationLocalId)
  });
  const repositorioOutbox = new RepositorioOutboxFederacionSql(sql);
  return {
    repositorioOutbox,
    adaptador: new AdaptadorCapturaTransaccionalFederacionSql({
      repositorioOcurrencias,
      repositorioOutbox
    })
  };
}

async function contarOutboxAuditoria(sql) {
  const filas = await sql.consultar(
    'SELECT COUNT(*) AS total FROM outbox_auditoria_runtime'
  );
  return Number(filas[0].total);
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
    campos: campos(estado),
    evidenciaIntegridad: []
  };
}

function campos(estado) {
  return {
    estadoOperativo: crearCampoPresenteFederado({
      valor: { estado, contexto: 'fixture 5.22.12c' }
    })
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
       'fixture 5.22.12c',?,?,NULL,NULL,NULL,1,NULL,?,?,?,1
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
      await sql.ejecutar(
        `DELETE FROM outbox_federacion WHERE flujo_id IN (${marcas})`,
        flujoIds
      ).catch(() => {});
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
      await sql.ejecutar(
        `DELETE FROM flujos_federacion WHERE flujo_id IN (${marcas})`,
        flujoIds
      );
    }
    await sql.ejecutar(
      'DELETE FROM relaciones_federacion WHERE relacion_id=?',
      [relacionId]
    );
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
    elementoOrigenId: generar(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN),
    ocurrenciaRollbackId: generar(TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN),
    ocurrenciaPrimeraId: generar(TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN),
    ocurrenciaSegundaId: generar(TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN)
  };
}

function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}
