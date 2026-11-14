import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { AdaptadorCapturaTransaccionalFederacionSql } from '../paquetes/federacion/adaptadores/AdaptadorCapturaTransaccionalFederacionSql.js';
import { FuenteEntropiaCriptograficaNode } from '../paquetes/federacion/adaptadores/FuenteEntropiaCriptograficaNode.js';
import { RepositorioFlujosFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioFlujosFederacionSql.js';
import { RepositorioOcurrenciasFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioOcurrenciasFederacionSql.js';
import { RepositorioOutboxFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioOutboxFederacionSql.js';
import { ServicioCapturaFederadaProductorRuntime } from '../paquetes/federacion/aplicacion/ServicioCapturaFederadaProductorRuntime.js';
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

const USUARIO_FIXTURE = '5221206';
const TABLA_FIXTURE = 'fixture_runtime_federacion_52212f';
const INSTANCIA_RUNTIME = 'runtime-fixture-52212f';
const generador = new GeneradorIdentidadesFederadas({
  fuenteEntropia: new FuenteEntropiaCriptograficaNode()
});

async function main() {
  await verificarRegistro();
  await verificarCausalidadAntesDeSql();
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true);
  const baseDatos = `sentinelia_fixture_52212f_${randomBytes(6).toString('hex')}`;
  const administrador = new ClienteSql(configuracion.sql);
  await administrador.ejecutar(
    `CREATE DATABASE ${administrador.escaparIdentificador(baseDatos)} ` +
    'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
  );
  const sql = new ClienteSql({ ...configuracion.sql, baseDatos });
  const ids = crearIdentidades();
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
    await crearOperacionesFixture(sql, ids);
    const auditoriaAntes = await contarOutboxAuditoria(sql);
    await verificarCommitConLease(sql, ids);
    await verificarAutoridadRechazada(sql, ids);
    await verificarVencimientoDuranteCaptura(sql, ids);
    await verificarRollbackCaptura(sql, ids);
    assert.equal(await contarOutboxAuditoria(sql), auditoriaAntes);
  } finally {
    await limpiarDatosFixture(sql, ids);
    await limpiarPlanoControl(sql);
    await sql.ejecutar(`DROP TABLE IF EXISTS ${TABLA_FIXTURE}`).catch(() => {});
    await sql.cerrar();
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(baseDatos)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
  console.log(
    '[federacion] OK 5.22.12f: runtime=fixture lease=bloqueado fencing=exacto ' +
    'causalidad=preasignada rollback=atomico auditoria-outbox=aislada'
  );
}

async function verificarRegistro() {
  const [servicio] = await Promise.all([
    leer('../paquetes/federacion/aplicacion/ServicioCapturaFederadaProductorRuntime.js')
  ]);
  assert.match(servicio, /bloquearLeaseVigenteEnTransaccion/u);
  assert.match(servicio, /ocurrenciaOrigenId/u);
  assert.match(servicio, /fencingToken/u);
  assert.doesNotMatch(
    servicio,
    /(?:RepositorioOutboxAuditoriaRuntime|outbox_auditoria_runtime)/u
  );
}

async function verificarCausalidadAntesDeSql() {
  let conexiones = 0;
  let autoridad = 0;
  const servicio = new ServicioCapturaFederadaProductorRuntime({
    clienteSql: {
      async obtenerConexion() {
        conexiones += 1;
        throw new Error('No debe obtener conexión.');
      }
    },
    puertoCaptura: { async capturarEnTransaccion() {} },
    repositorioAutoridadRuntime: {
      async bloquearLeaseVigenteEnTransaccion() { autoridad += 1; },
      async revalidarLeaseVigenteEnTransaccion() { autoridad += 1; }
    }
  });
  await assert.rejects(
    servicio.ejecutar({
      lease: lease('causalidad', Buffer.alloc(32, 1), '1'),
      captura: { definicion: { ocurrenciaOrigenId: 'no-canonica' } },
      persistirEnTransaccion: async () => {}
    }),
    (error) => error.codigo === 'causalidad_no_preasignada'
  );
  assert.deepEqual([conexiones, autoridad], [0, 0]);
}

async function verificarCommitConLease(sql, ids) {
  const orden = [];
  const servicio = crearServicio(sql, ids, orden);
  const capturaPreparada = captura(
    ids,
    ids.ocurrenciaConfirmadaId,
    'resultado-runtime-confirmado'
  );
  const resultado = await servicio.ejecutar({
    lease: lease(ids.operacionConfirmadaId, ids.tokenConfirmado, '7'),
    captura: capturaPreparada,
    persistirEnTransaccion: async ({
      conexion,
      ocurrenciaOrigenId,
      lease: leaseValidado
    }) => {
      orden.push('mutacion-runtime');
      assert.equal(ocurrenciaOrigenId, String(ids.ocurrenciaConfirmadaId));
      assert.equal(leaseValidado.fencingToken, '7');
      return consolidarOperacion(conexion, {
        operacionId: ids.operacionConfirmadaId,
        ocurrenciaOrigenId,
        resultado: 'confirmado'
      });
    }
  });
  assert.equal(resultado.autoridad.fencingToken, '7');
  assert.equal(resultado.captura.estadoOcurrencia, 'creada');
  assert.deepEqual(orden, [
    'begin', 'lease-bloqueado', 'mutacion-runtime', 'captura',
    'lease-revalidado', 'commit', 'release'
  ]);
  const [operacion, outbox] = await Promise.all([
    sql.consultar(
      `SELECT estado,ocurrencia_origen_id,resultado FROM ${TABLA_FIXTURE}
        WHERE operacion_id=?`,
      [ids.operacionConfirmadaId]
    ),
    sql.consultar(
      `SELECT COUNT(*) AS total FROM outbox_federacion o
        JOIN posiciones_ocurrencias_flujos_federacion p
          ON p.flujo_id=o.flujo_id AND p.generacion_id=o.generacion_id
         AND p.posicion_flujo=o.posicion_flujo
       WHERE p.ocurrencia_origen_id=?`,
      [String(ids.ocurrenciaConfirmadaId)]
    )
  ]);
  assert.deepEqual(operacion[0], {
    estado: 'completada',
    ocurrencia_origen_id: String(ids.ocurrenciaConfirmadaId),
    resultado: 'confirmado'
  });
  assert.equal(Number(outbox[0].total), 1);
}

async function verificarAutoridadRechazada(sql, ids) {
  const casos = [
    {
      operacionId: ids.operacionFencingId,
      token: ids.tokenFencing,
      fencing: '7',
      ocurrenciaId: ids.ocurrenciaFencingId
    },
    {
      operacionId: ids.operacionVencidaId,
      token: ids.tokenVencido,
      fencing: '9',
      ocurrenciaId: ids.ocurrenciaVencidaId
    }
  ];
  for (const caso of casos) {
    const orden = [];
    let mutaciones = 0;
    const servicio = crearServicio(sql, ids, orden);
    await assert.rejects(
      servicio.ejecutar({
        lease: lease(caso.operacionId, caso.token, caso.fencing),
        captura: captura(ids, caso.ocurrenciaId, 'no-autorizado'),
        persistirEnTransaccion: async () => { mutaciones += 1; }
      }),
      (error) => error.codigo === 'lease_runtime_perdido'
    );
    assert.equal(mutaciones, 0);
    assert.deepEqual(orden, ['begin', 'rollback', 'release']);
  }
  const ocurrencias = await sql.consultar(
    `SELECT COUNT(*) AS total FROM ocurrencias_federacion
      WHERE ocurrencia_origen_id IN (?,?)`,
    [String(ids.ocurrenciaFencingId), String(ids.ocurrenciaVencidaId)]
  );
  assert.equal(Number(ocurrencias[0].total), 0);
}

async function verificarVencimientoDuranteCaptura(sql, ids) {
  const orden = [];
  const servicio = crearServicio(sql, ids, orden);
  await assert.rejects(
    servicio.ejecutar({
      lease: lease(ids.operacionVenceDuranteId, ids.tokenVenceDurante, '11'),
      captura: captura(ids, ids.ocurrenciaVenceDuranteId, 'vence-durante'),
      persistirEnTransaccion: async ({ conexion, ocurrenciaOrigenId }) => {
        orden.push('mutacion-runtime');
        await consolidarOperacion(conexion, {
          operacionId: ids.operacionVenceDuranteId,
          ocurrenciaOrigenId,
          resultado: 'no-debe-confirmarse'
        });
        await conexion.execute(
          `UPDATE ${TABLA_FIXTURE}
              SET lease_expira_utc=TIMESTAMPADD(SECOND,-1,UTC_TIMESTAMP(3))
            WHERE operacion_id=?`,
          [ids.operacionVenceDuranteId]
        );
      }
    }),
    (error) => error.codigo === 'lease_runtime_perdido'
  );
  assert.deepEqual(orden, [
    'begin', 'lease-bloqueado', 'mutacion-runtime', 'captura', 'rollback', 'release'
  ]);
  const [operacion, ocurrencia] = await Promise.all([
    sql.consultar(
      `SELECT estado,ocurrencia_origen_id,resultado,
              lease_expira_utc>UTC_TIMESTAMP(3) AS vigente
         FROM ${TABLA_FIXTURE} WHERE operacion_id=?`,
      [ids.operacionVenceDuranteId]
    ),
    sql.consultar(
      'SELECT COUNT(*) AS total FROM ocurrencias_federacion WHERE ocurrencia_origen_id=?',
      [String(ids.ocurrenciaVenceDuranteId)]
    )
  ]);
  assert.deepEqual({
    estado: operacion[0].estado,
    ocurrenciaOrigenId: operacion[0].ocurrencia_origen_id,
    resultado: operacion[0].resultado,
    vigente: Boolean(operacion[0].vigente)
  }, {
    estado: 'procesando',
    ocurrenciaOrigenId: null,
    resultado: null,
    vigente: true
  });
  assert.equal(Number(ocurrencia[0].total), 0);
}

async function verificarRollbackCaptura(sql, ids) {
  const orden = [];
  const servicio = crearServicio(sql, ids, orden);
  await assert.rejects(
    servicio.ejecutar({
      lease: lease(ids.operacionRollbackId, ids.tokenRollback, '10'),
      captura: {
        ...captura(ids, ids.ocurrenciaRollbackId, 'debe-revertirse'),
        destinos: [{
          flujoId: String(ids.flujoId),
          generacionId: String(ids.generacionInexistenteId)
        }]
      },
      persistirEnTransaccion: ({ conexion, ocurrenciaOrigenId }) => {
        orden.push('mutacion-runtime');
        return consolidarOperacion(conexion, {
          operacionId: ids.operacionRollbackId,
          ocurrenciaOrigenId,
          resultado: 'no-debe-sobrevivir'
        });
      }
    })
  );
  assert.deepEqual(orden, [
    'begin', 'lease-bloqueado', 'mutacion-runtime', 'captura', 'rollback', 'release'
  ]);
  const [operacion, ocurrencia] = await Promise.all([
    sql.consultar(
      `SELECT estado,ocurrencia_origen_id,resultado FROM ${TABLA_FIXTURE}
        WHERE operacion_id=?`,
      [ids.operacionRollbackId]
    ),
    sql.consultar(
      'SELECT COUNT(*) AS total FROM ocurrencias_federacion WHERE ocurrencia_origen_id=?',
      [String(ids.ocurrenciaRollbackId)]
    )
  ]);
  assert.deepEqual(operacion[0], {
    estado: 'procesando',
    ocurrencia_origen_id: null,
    resultado: null
  });
  assert.equal(Number(ocurrencia[0].total), 0);
}

function crearServicio(sql, ids, orden) {
  const repositorioOcurrencias = new RepositorioOcurrenciasFederacionSql(sql, {
    installationLocalId: String(ids.installationLocalId)
  });
  const capturaSql = new AdaptadorCapturaTransaccionalFederacionSql({
    repositorioOcurrencias,
    repositorioOutbox: new RepositorioOutboxFederacionSql(sql)
  });
  const clienteSql = clienteSqlObservado(sql, orden);
  return new ServicioCapturaFederadaProductorRuntime({
    clienteSql,
    repositorioAutoridadRuntime: new RepositorioAutoridadRuntimeFixture(orden),
    puertoCaptura: {
      async capturarEnTransaccion(solicitud, opciones) {
        orden.push('captura');
        return capturaSql.capturarEnTransaccion(solicitud, opciones);
      }
    }
  });
}

class RepositorioAutoridadRuntimeFixture {
  constructor(orden) {
    this.orden = orden;
  }

  async bloquearLeaseVigenteEnTransaccion(leaseEsperado, { conexion }) {
    const [filas] = await conexion.execute(
      `SELECT operacion_id,instancia_id,HEX(lease_token) AS lease_token,
              fencing_token
         FROM ${TABLA_FIXTURE}
        WHERE operacion_id=? AND estado='procesando' AND instancia_id=?
          AND lease_token=UNHEX(?) AND fencing_token=?
          AND lease_expira_utc>UTC_TIMESTAMP(3)
        FOR UPDATE`,
      [
        leaseEsperado.operacionId,
        leaseEsperado.instanciaId,
        leaseEsperado.leaseToken,
        leaseEsperado.fencingToken
      ]
    );
    if (filas.length !== 1) {
      const error = new Error('El runtime perdió lease o fencing.');
      error.codigo = 'lease_runtime_perdido';
      throw error;
    }
    this.orden.push('lease-bloqueado');
    return {
      operacionId: filas[0].operacion_id,
      instanciaId: filas[0].instancia_id,
      leaseToken: filas[0].lease_token.toLowerCase(),
      fencingToken: String(filas[0].fencing_token)
    };
  }

  async revalidarLeaseVigenteEnTransaccion(leaseEsperado, { conexion }) {
    const [filas] = await conexion.execute(
      `SELECT operacion_id,instancia_id,HEX(lease_token) AS lease_token,
              fencing_token
         FROM ${TABLA_FIXTURE}
        WHERE operacion_id=? AND instancia_id=? AND lease_token=UNHEX(?)
          AND fencing_token=? AND lease_expira_utc>UTC_TIMESTAMP(3)
        FOR UPDATE`,
      [
        leaseEsperado.operacionId,
        leaseEsperado.instanciaId,
        leaseEsperado.leaseToken,
        leaseEsperado.fencingToken
      ]
    );
    if (filas.length !== 1) {
      const error = new Error('El lease dejó de estar vigente antes del commit.');
      error.codigo = 'lease_runtime_perdido';
      throw error;
    }
    this.orden.push('lease-revalidado');
    return {
      operacionId: filas[0].operacion_id,
      instanciaId: filas[0].instancia_id,
      leaseToken: filas[0].lease_token.toLowerCase(),
      fencingToken: String(filas[0].fencing_token)
    };
  }
}

async function consolidarOperacion(conexion, {
  operacionId,
  ocurrenciaOrigenId,
  resultado
}) {
  const [actualizacion] = await conexion.execute(
    `UPDATE ${TABLA_FIXTURE}
        SET estado='completada',ocurrencia_origen_id=?,resultado=?
      WHERE operacion_id=? AND estado='procesando'`,
    [ocurrenciaOrigenId, resultado, operacionId]
  );
  assert.equal(Number(actualizacion.affectedRows), 1);
  return Object.freeze({ operacionId, ocurrenciaOrigenId, resultado });
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
          orden.push('commit');
          return real.commit();
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

function lease(operacionId, token, fencingToken) {
  return {
    operacionId: String(operacionId),
    instanciaId: INSTANCIA_RUNTIME,
    leaseToken: token,
    fencingToken
  };
}

function captura(ids, ocurrenciaOrigenId, estado) {
  return {
    definicion: {
      familia: 'triggersInformativos',
      familiaVersion: 2,
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
        ejecucionTerminada: crearCampoPresenteFederado({
          valor: { estado, contexto: 'runtime fixture 5.22.12f' }
        })
      },
      evidenciaIntegridad: []
    },
    destinos: [{
      flujoId: String(ids.flujoId),
      generacionId: String(ids.generacionId)
    }]
  };
}

async function crearTablaFixture(sql) {
  await sql.ejecutar(
    `CREATE TABLE IF NOT EXISTS ${TABLA_FIXTURE} (
       operacion_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
       estado ENUM('procesando','completada') NOT NULL,
       instancia_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
       lease_token BINARY(32) NOT NULL,
       fencing_token BIGINT UNSIGNED NOT NULL,
       lease_expira_utc DATETIME(3) NOT NULL,
       ocurrencia_origen_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
       resultado VARCHAR(255) NULL,
       PRIMARY KEY (operacion_id)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`
  );
  await sql.ejecutar(`DELETE FROM ${TABLA_FIXTURE}`);
}

async function crearOperacionesFixture(sql, ids) {
  const operaciones = [
    [ids.operacionConfirmadaId, ids.tokenConfirmado, '7', 300],
    [ids.operacionFencingId, ids.tokenFencing, '8', 300],
    [ids.operacionVencidaId, ids.tokenVencido, '9', -300],
    [ids.operacionRollbackId, ids.tokenRollback, '10', 300],
    [ids.operacionVenceDuranteId, ids.tokenVenceDurante, '11', 300]
  ];
  for (const [operacionId, token, fencing, ttl] of operaciones) {
    await sql.ejecutar(
      `INSERT INTO ${TABLA_FIXTURE} (
         operacion_id,estado,instancia_id,lease_token,fencing_token,
         lease_expira_utc,ocurrencia_origen_id,resultado
       ) VALUES (?,'procesando',?,?,?,TIMESTAMPADD(SECOND,?,UTC_TIMESTAMP(3)),NULL,NULL)`,
      [operacionId, INSTANCIA_RUNTIME, token, fencing, ttl]
    );
  }
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
      familia: 'triggersInformativos',
      versionFamilia: 2,
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
       'fixture 5.22.12f',?,?,NULL,NULL,NULL,1,NULL,?,?,?,1
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
    ocurrenciaConfirmadaId: generar(TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN),
    ocurrenciaFencingId: generar(TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN),
    ocurrenciaVencidaId: generar(TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN),
    ocurrenciaRollbackId: generar(TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN),
    ocurrenciaVenceDuranteId: generar(TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN),
    operacionConfirmadaId: 'operacion-runtime-confirmada',
    operacionFencingId: 'operacion-runtime-fencing',
    operacionVencidaId: 'operacion-runtime-vencida',
    operacionRollbackId: 'operacion-runtime-rollback',
    operacionVenceDuranteId: 'operacion-runtime-vence-durante',
    tokenConfirmado: Buffer.alloc(32, 0x11),
    tokenFencing: Buffer.alloc(32, 0x22),
    tokenVencido: Buffer.alloc(32, 0x33),
    tokenRollback: Buffer.alloc(32, 0x44),
    tokenVenceDurante: Buffer.alloc(32, 0x55)
  };
}

function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}

await main();
