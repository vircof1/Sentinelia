import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { AdaptadorCapturaTransaccionalFederacionSql } from '../paquetes/federacion/adaptadores/AdaptadorCapturaTransaccionalFederacionSql.js';
import { FuenteEntropiaCriptograficaNode } from '../paquetes/federacion/adaptadores/FuenteEntropiaCriptograficaNode.js';
import { RepositorioFlujosFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioFlujosFederacionSql.js';
import { RepositorioOcurrenciasFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioOcurrenciasFederacionSql.js';
import { RepositorioOutboxFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioOutboxFederacionSql.js';
import { ServicioCapturaFederadaProductorTecnico } from '../paquetes/federacion/aplicacion/ServicioCapturaFederadaProductorTecnico.js';
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

const USUARIO_FIXTURE = '5221205';
const TABLA_FIXTURE = 'fixture_ingesta_tecnica_federacion_52212e';
const generador = new GeneradorIdentidadesFederadas({
  fuenteEntropia: new FuenteEntropiaCriptograficaNode()
});

async function main() {
  await verificarRegistro();
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true);
  const baseDatos = `sentinelia_fixture_52212e_${randomBytes(6).toString('hex')}`;
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
    await crearTablaFixture(sql);
    await limpiarPlanoControl(sql);
    await crearRelacionFixture(sql, ids);
    await crearFlujoFixture(sql, ids);
    await verificarRechazoSinTransaccion(sql, ids);
    await verificarCommitCompartido(sql, ids);
    await verificarRollbackTotal(sql, ids);
  } finally {
    await limpiarDatosFixture(sql, ids);
    await limpiarPlanoControl(sql);
    await sql.ejecutar(`DROP TABLE IF EXISTS ${TABLA_FIXTURE}`).catch(() => {});
    await sql.cerrar();
    await administrador.ejecutar(`DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(baseDatos)}`).catch(() => {});
    await administrador.cerrar();
  }
  console.log(
    '[federacion] OK 5.22.12e: ingesta=tecnica-fixture conexion=unica ' +
    'commit=compartido lote=ordenado rollback=total redis=fuera'
  );
}

async function verificarRechazoSinTransaccion(sql, ids) {
  const conexion = await sql.obtenerConexion();
  const orden = [];
  try {
    const integrador = crearIntegrador(sql, ids, conexion, orden);
    await assert.rejects(
      integrador.capturarLoteEnTransaccion({
        capturas: [captura(ids, ids.ocurrenciaRollbackPrimeraId, 'inactiva')]
      }, { conexion }),
      (error) => error.codigo === 'transaccion_prestada_inactiva'
    );
    assert.deepEqual(orden, []);
  } finally {
    conexion.release();
  }
}

async function verificarRegistro() {
  const [servicio] = await Promise.all([
    leer('../paquetes/federacion/aplicacion/ServicioCapturaFederadaProductorTecnico.js')
  ]);
  assert.match(servicio, /capturarLoteEnTransaccion/u);
  assert.match(servicio, /puertoCaptura\.capturarEnTransaccion/u);
  assert.doesNotMatch(
    servicio,
    /(?:beginTransaction|\.commit\s*\(|\.rollback\s*\(|redis|\.publish\s*\()/iu
  );
}

async function verificarCommitCompartido(sql, ids) {
  const orden = [];
  const resultado = await ingestarFixture({
    sql,
    ids,
    loteId: 'confirmado',
    orden,
    capturas: [
      captura(ids, ids.ocurrenciaPrimeraId, 'historico-confirmado'),
      captura(ids, ids.ocurrenciaSegundaId, 'estado-actual-confirmado')
    ]
  });
  assert.equal(resultado.captura.totalCapturas, 2);
  assert.deepEqual(
    resultado.captura.posiciones.map((posicion) => posicion.posicionFlujo),
    ['1', '2']
  );
  assert.deepEqual(orden, [
    'begin',
    'repositorio:historico',
    'repositorio:fotografia',
    'captura:1',
    'captura:2',
    'commit',
    'release'
  ]);
  const [filas, ocurrencias, outbox] = await Promise.all([
    sql.consultar(
      `SELECT clase,valor FROM ${TABLA_FIXTURE}
        WHERE lote_id='confirmado' ORDER BY clase`
    ),
    sql.consultar(
      `SELECT ocurrencia_origen_id,secuencia_elemento
         FROM ocurrencias_federacion
        WHERE ocurrencia_origen_id IN (?,?) ORDER BY secuencia_elemento`,
      [String(ids.ocurrenciaPrimeraId), String(ids.ocurrenciaSegundaId)]
    ),
    sql.consultar(
      'SELECT posicion_flujo FROM outbox_federacion WHERE flujo_id=? ORDER BY posicion_flujo',
      [String(ids.flujoId)]
    )
  ]);
  assert.deepEqual(filas.map(({ clase, valor }) => [clase, valor]), [
    ['historico', 'historico-confirmado'],
    ['fotografia', 'estado-actual-confirmado']
  ]);
  assert.deepEqual(
    ocurrencias.map((fila) => [fila.ocurrencia_origen_id, String(fila.secuencia_elemento)]),
    [
      [String(ids.ocurrenciaPrimeraId), '1'],
      [String(ids.ocurrenciaSegundaId), '2']
    ]
  );
  assert.deepEqual(outbox.map((fila) => String(fila.posicion_flujo)), ['1', '2']);
}

async function verificarRollbackTotal(sql, ids) {
  const orden = [];
  const contadorAntes = await leerContadores(sql, ids);
  await assert.rejects(
    ingestarFixture({
      sql,
      ids,
      loteId: 'revertido',
      orden,
      capturas: [
        captura(ids, ids.ocurrenciaRollbackPrimeraId, 'historico-revertido'),
        {
          ...captura(ids, ids.ocurrenciaRollbackSegundaId, 'estado-revertido'),
          destinos: [{
            flujoId: String(ids.flujoId),
            generacionId: String(ids.generacionInexistenteId)
          }]
        }
      ]
    })
  );
  assert.deepEqual(orden, [
    'begin',
    'repositorio:historico',
    'repositorio:fotografia',
    'captura:1',
    'captura:2',
    'rollback',
    'release'
  ]);
  const [filas, ocurrencias, posiciones, outbox] = await Promise.all([
    sql.consultar(
      `SELECT COUNT(*) AS total FROM ${TABLA_FIXTURE} WHERE lote_id='revertido'`
    ),
    sql.consultar(
      `SELECT COUNT(*) AS total FROM ocurrencias_federacion
        WHERE ocurrencia_origen_id IN (?,?)`,
      [
        String(ids.ocurrenciaRollbackPrimeraId),
        String(ids.ocurrenciaRollbackSegundaId)
      ]
    ),
    sql.consultar(
      `SELECT COUNT(*) AS total FROM posiciones_ocurrencias_flujos_federacion p
        WHERE p.ocurrencia_origen_id IN (?,?)`,
      [
        String(ids.ocurrenciaRollbackPrimeraId),
        String(ids.ocurrenciaRollbackSegundaId)
      ]
    ),
    sql.consultar(
      `SELECT COUNT(*) AS total FROM outbox_federacion o
        JOIN posiciones_ocurrencias_flujos_federacion p
          ON p.flujo_id=o.flujo_id AND p.generacion_id=o.generacion_id
         AND p.posicion_flujo=o.posicion_flujo
       WHERE p.ocurrencia_origen_id IN (?,?)`,
      [
        String(ids.ocurrenciaRollbackPrimeraId),
        String(ids.ocurrenciaRollbackSegundaId)
      ]
    )
  ]);
  assert.deepEqual(
    [filas[0].total, ocurrencias[0].total, posiciones[0].total, outbox[0].total]
      .map(Number),
    [0, 0, 0, 0]
  );
  assert.deepEqual(await leerContadores(sql, ids), contadorAntes);
}

async function ingestarFixture({ sql, ids, loteId, orden, capturas }) {
  const conexion = await sql.obtenerConexion();
  const ejecutorPrestado = crearEjecutorPrestado(conexion);
  const repositorioBase = new RepositorioIngestaTecnicaFixture(sql);
  const repositorioHistorico = clonarRepositorio(
    repositorioBase,
    ejecutorPrestado,
    'historico',
    orden
  );
  const repositorioFotografia = clonarRepositorio(
    repositorioBase,
    ejecutorPrestado,
    'fotografia',
    orden
  );
  const integrador = crearIntegrador(sql, ids, conexion, orden);
  try {
    orden.push('begin');
    await conexion.beginTransaction();
    await repositorioHistorico.persistir({
      loteId,
      valor: capturas[0].definicion.campos.observacion.valor.estado
    });
    await repositorioFotografia.persistir({
      loteId,
      valor: capturas[1].definicion.campos.observacion.valor.estado
    });
    const capturaLote = await integrador.capturarLoteEnTransaccion(
      { capturas },
      { conexion }
    );
    orden.push('commit');
    await conexion.commit();
    return Object.freeze({ loteId, captura: capturaLote });
  } catch (error) {
    orden.push('rollback');
    await conexion.rollback();
    throw error;
  } finally {
    orden.push('release');
    conexion.release();
  }
}

function crearIntegrador(sql, ids, conexionEsperada, orden) {
  const repositorioOcurrencias = new RepositorioOcurrenciasFederacionSql(sql, {
    installationLocalId: String(ids.installationLocalId)
  });
  const repositorioOutbox = new RepositorioOutboxFederacionSql(sql);
  const capturaSql = new AdaptadorCapturaTransaccionalFederacionSql({
    repositorioOcurrencias,
    repositorioOutbox
  });
  let numero = 0;
  return new ServicioCapturaFederadaProductorTecnico({
    puertoCaptura: {
      async capturarEnTransaccion(solicitud, { conexion }) {
        numero += 1;
        orden.push(`captura:${numero}`);
        assert.equal(conexion, conexionEsperada);
        const [estado] = await conexion.query('SELECT @@in_transaction AS activa');
        assert.equal(Boolean(estado[0].activa), true);
        return capturaSql.capturarEnTransaccion(solicitud, { conexion });
      }
    }
  });
}

class RepositorioIngestaTecnicaFixture {
  constructor(clienteSql, clase = null, orden = []) {
    this.clienteSql = clienteSql;
    this.clase = clase;
    this.orden = orden;
  }

  async persistir({ loteId, valor }) {
    this.orden.push(`repositorio:${this.clase}`);
    const estado = await this.clienteSql.consultar(
      'SELECT @@in_transaction AS activa'
    );
    assert.equal(Boolean(estado[0].activa), true);
    await this.clienteSql.ejecutar(
      `INSERT INTO ${TABLA_FIXTURE} (lote_id,clase,valor) VALUES (?,?,?)`,
      [loteId, this.clase, valor]
    );
  }
}

function clonarRepositorio(repositorio, clienteSql, clase, orden) {
  return Object.assign(Object.create(Object.getPrototypeOf(repositorio)), {
    ...repositorio,
    clienteSql,
    clase,
    orden
  });
}

function crearEjecutorPrestado(conexion) {
  return {
    async ejecutar(sql, parametros = []) {
      return conexion.execute(sql, parametros);
    },
    async consultar(sql, parametros = []) {
      const [filas] = await conexion.execute(sql, parametros);
      return filas;
    }
  };
}

async function leerContadores(sql, ids) {
  const [elemento, posicion] = await Promise.all([
    sql.consultar(
      `SELECT ultima_secuencia FROM contadores_secuencia_elementos_federacion
        WHERE installation_origen_id=? AND familia='telemetria'
          AND elemento_origen_id=?`,
      [String(ids.installationLocalId), String(ids.elementoOrigenId)]
    ),
    sql.consultar(
      `SELECT ultima_posicion FROM contadores_posiciones_generaciones_federacion
        WHERE flujo_id=? AND generacion_id=?`,
      [String(ids.flujoId), String(ids.generacionId)]
    )
  ]);
  return Object.freeze({
    secuenciaElemento: elemento[0] ? String(elemento[0].ultima_secuencia) : null,
    posicionFlujo: posicion[0] ? String(posicion[0].ultima_posicion) : null
  });
}

function captura(ids, ocurrenciaOrigenId, estado) {
  return {
    definicion: {
      familia: 'telemetria',
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
        observacion: crearCampoPresenteFederado({
          valor: { estado, contexto: 'ingesta técnica fixture 5.22.12e' }
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
       lote_id VARCHAR(64) NOT NULL,
       clase ENUM('historico','fotografia') NOT NULL,
       valor VARCHAR(255) NOT NULL,
       PRIMARY KEY (lote_id,clase)
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
      familia: 'telemetria',
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
       'fixture 5.22.12e',?,?,NULL,NULL,NULL,1,NULL,?,?,?,1
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
    ocurrenciaPrimeraId: generar(TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN),
    ocurrenciaSegundaId: generar(TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN),
    ocurrenciaRollbackPrimeraId: generar(TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN),
    ocurrenciaRollbackSegundaId: generar(TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN)
  };
}

function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}

await main();
