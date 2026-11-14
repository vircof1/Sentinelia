import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { FuenteEntropiaCriptograficaNode } from '../paquetes/federacion/adaptadores/FuenteEntropiaCriptograficaNode.js';
import { RepositorioFlujosFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioFlujosFederacionSql.js';
import { RepositorioOcurrenciasFederacionSql } from '../paquetes/federacion/adaptadores/RepositorioOcurrenciasFederacionSql.js';
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

const USUARIO_FIXTURE = '5221202';
const generador = new GeneradorIdentidadesFederadas({
  fuenteEntropia: new FuenteEntropiaCriptograficaNode()
});

await main();

async function main() {
  await verificarRegistro();
  const configuracion = obtenerConfiguracionAplicacion();
  assert.equal(configuracion.sql.estaCompleta, true);
  const baseDatos = `sentinelia_fixture_52212b_${randomBytes(6).toString('hex')}`;
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
    await limpiarPlanoControl(sql);
    await crearRelacionFixture(sql, ids);
    await crearFlujosFixture(sql, ids);
    await verificarOcurrenciasEnRollback(sql, ids);
    await verificarRollbackSinResiduos(sql, ids);
    await verificarAsignacionConcurrente(sql, ids);
    await limpiarDatosFixture(sql, ids);
    await verificarRollbackSinResiduos(sql, ids);
  } finally {
    await limpiarDatosFixture(sql, ids);
    await limpiarPlanoControl(sql);
    await sql.cerrar();
    await administrador.ejecutar(
      `DROP DATABASE IF EXISTS ${administrador.escaparIdentificador(baseDatos)}`
    ).catch(() => {});
    await administrador.cerrar();
  }
  console.log(
    '[federacion] OK 5.22.12b: ocurrencias=inmutables causalidad=preasignada ' +
    'secuencia=monotona posicion=densa reloj-remoto=no-ordena outbox=ausente'
  );
}

async function verificarRegistro() {
  const [repositorio] = await Promise.all([
    leer('../paquetes/federacion/adaptadores/RepositorioOcurrenciasFederacionSql.js')
  ]);
  assert.doesNotMatch(repositorio, /\.(?:commit|rollback|beginTransaction)\s*\(/u);
}

async function verificarOcurrenciasEnRollback(sql, ids) {
  const conexion = await sql.obtenerConexion();
  const repositorio = new RepositorioOcurrenciasFederacionSql(sql, {
    installationLocalId: String(ids.installationLocalId)
  });
  try {
    await assert.rejects(
      repositorio.registrarOcurrenciaEnTransaccion({
        definicion: definicion(ids, {
          ocurrenciaOrigenId: ids.ocurrenciaPrimeraId,
          tiempoOrigenUtc: '2030-01-01T00:00:00.000Z',
          estado: 'sin-transaccion'
        }),
        destinos: [
          { flujoId: String(ids.flujoPrimarioId), generacionId: String(ids.generacionPrimariaId) }
        ]
      }, { conexion }),
      (error) => error.codigo === 'transaccion_prestada_inactiva'
    );
    await conexion.beginTransaction();
    const primera = definicion(ids, {
      ocurrenciaOrigenId: ids.ocurrenciaPrimeraId,
      tiempoOrigenUtc: '2030-01-01T00:00:00.000Z',
      estado: 'fallo'
    });
    const resultadoPrimero = await repositorio.registrarOcurrenciaEnTransaccion({
      definicion: primera,
      destinos: [
        { flujoId: String(ids.flujoPrimarioId), generacionId: String(ids.generacionPrimariaId) },
        { flujoId: String(ids.flujoSecundarioId), generacionId: String(ids.generacionSecundariaId) }
      ]
    }, { conexion });
    assert.equal(resultadoPrimero.estado, 'creada');
    assert.equal(resultadoPrimero.ocurrencia.toJSON().secuenciaElemento, '1');
    assert.deepEqual(
      resultadoPrimero.posiciones.map((posicion) => posicion.posicionFlujo),
      ['1', '1']
    );

    const resultadoSegundo = await repositorio.registrarOcurrenciaEnTransaccion({
      definicion: definicion(ids, {
        ocurrenciaOrigenId: ids.ocurrenciaSegundaId,
        tiempoOrigenUtc: '2020-01-01T00:00:00.000Z',
        estado: 'correcto'
      }),
      destinos: [
        { flujoId: String(ids.flujoPrimarioId), generacionId: String(ids.generacionPrimariaId) }
      ]
    }, { conexion });
    assert.equal(resultadoSegundo.ocurrencia.toJSON().secuenciaElemento, '2');
    assert.equal(resultadoSegundo.posiciones[0].posicionFlujo, '2');
    assert.ok(
      resultadoSegundo.ocurrencia.toJSON().tiempoOrigenUtc <
      resultadoPrimero.ocurrencia.toJSON().tiempoOrigenUtc,
      'El segundo hecho puede declarar un reloj remoto anterior sin perder orden causal.'
    );

    const resultadoOtroElemento = await repositorio.registrarOcurrenciaEnTransaccion({
      definicion: definicion(ids, {
        elementoOrigenId: ids.elementoAlternativoId,
        ocurrenciaOrigenId: ids.ocurrenciaTerceraId,
        tiempoOrigenUtc: '2010-01-01T00:00:00.000Z',
        estado: 'desconocido'
      }),
      destinos: [
        { flujoId: String(ids.flujoPrimarioId), generacionId: String(ids.generacionPrimariaId) }
      ]
    }, { conexion });
    assert.equal(resultadoOtroElemento.ocurrencia.toJSON().secuenciaElemento, '1');
    assert.equal(resultadoOtroElemento.posiciones[0].posicionFlujo, '3');

    const replay = await repositorio.registrarOcurrenciaEnTransaccion({
      definicion: primera,
      destinos: [
        { flujoId: String(ids.flujoPrimarioId), generacionId: String(ids.generacionPrimariaId) },
        { flujoId: String(ids.flujoSecundarioId), generacionId: String(ids.generacionSecundariaId) }
      ]
    }, { conexion });
    assert.equal(replay.estado, 'yaConocida');
    assert.equal(replay.ocurrencia.toJSON().secuenciaElemento, '1');
    assert.deepEqual(replay.posiciones.map(({ estado, posicionFlujo }) => [
      estado,
      posicionFlujo
    ]), [
      ['yaAsignada', '1'],
      ['yaAsignada', '1']
    ]);

    await assert.rejects(
      repositorio.registrarOcurrenciaEnTransaccion({
        definicion: { ...primera, campos: campos('reinterpretado') },
        destinos: [
          { flujoId: String(ids.flujoPrimarioId), generacionId: String(ids.generacionPrimariaId) }
        ]
      }, { conexion }),
      (error) => error.codigo === 'identidad_causal_divergente'
    );

    const [contadores] = await conexion.execute(
      `SELECT ultima_posicion FROM contadores_posiciones_generaciones_federacion
        WHERE flujo_id=? AND generacion_id=?`,
      [String(ids.flujoPrimarioId), String(ids.generacionPrimariaId)]
    );
    assert.equal(String(contadores[0].ultima_posicion), '3');
    await assert.rejects(
      conexion.execute(
        `UPDATE ocurrencias_federacion SET operacion='retirada'
          WHERE ocurrencia_origen_id=?`,
        [String(ids.ocurrenciaPrimeraId)]
      ),
      (error) => error.sqlState === '45000'
    );
  } finally {
    await conexion.rollback();
    conexion.release();
  }
}

async function verificarRollbackSinResiduos(sql, ids) {
  const [ocurrencias, posiciones, reservas] = await Promise.all([
    sql.consultar(
      'SELECT COUNT(*) AS total FROM ocurrencias_federacion WHERE installation_origen_id=?',
      [String(ids.installationLocalId)]
    ),
    sql.consultar(
      'SELECT COUNT(*) AS total FROM posiciones_ocurrencias_flujos_federacion WHERE flujo_id IN (?,?)',
      [String(ids.flujoPrimarioId), String(ids.flujoSecundarioId)]
    ),
    sql.consultar(
      'SELECT COUNT(*) AS total FROM reservas_identidad_ocurrencias_federacion WHERE installation_origen_id=?',
      [String(ids.installationLocalId)]
    )
  ]);
  assert.deepEqual(
    [ocurrencias[0].total, posiciones[0].total, reservas[0].total].map(Number),
    [0, 0, 0]
  );
}

async function verificarAsignacionConcurrente(sql, ids) {
  const repositorio = new RepositorioOcurrenciasFederacionSql(sql, {
    installationLocalId: String(ids.installationLocalId)
  });
  const primera = await sql.obtenerConexion();
  const segunda = await sql.obtenerConexion();
  let primeraConfirmada = false;
  let segundaConfirmada = false;
  try {
    await primera.beginTransaction();
    await segunda.beginTransaction();
    const resultadoPrimero = await repositorio.registrarOcurrenciaEnTransaccion({
      definicion: definicion(ids, {
        ocurrenciaOrigenId: ids.ocurrenciaConcurrentePrimeraId,
        tiempoOrigenUtc: '2040-01-01T00:00:00.000Z',
        estado: 'primera-concurrente'
      }),
      destinos: [
        { flujoId: String(ids.flujoPrimarioId), generacionId: String(ids.generacionPrimariaId) }
      ]
    }, { conexion: primera });
    const segundaPendiente = repositorio.registrarOcurrenciaEnTransaccion({
      definicion: definicion(ids, {
        ocurrenciaOrigenId: ids.ocurrenciaConcurrenteSegundaId,
        tiempoOrigenUtc: '2000-01-01T00:00:00.000Z',
        estado: 'segunda-concurrente'
      }),
      destinos: [
        { flujoId: String(ids.flujoSecundarioId), generacionId: String(ids.generacionSecundariaId) }
      ]
    }, { conexion: segunda });
    await new Promise((resolver) => setTimeout(resolver, 30));
    await primera.commit();
    primeraConfirmada = true;
    const resultadoSegundo = await segundaPendiente;
    await segunda.commit();
    segundaConfirmada = true;
    assert.deepEqual([
      resultadoPrimero.ocurrencia.toJSON().secuenciaElemento,
      resultadoSegundo.ocurrencia.toJSON().secuenciaElemento
    ], ['1', '2']);
    assert.deepEqual([
      resultadoPrimero.posiciones[0].posicionFlujo,
      resultadoSegundo.posiciones[0].posicionFlujo
    ], ['1', '1']);
    assert.ok(
      resultadoSegundo.ocurrencia.toJSON().tiempoOrigenUtc <
      resultadoPrimero.ocurrencia.toJSON().tiempoOrigenUtc
    );
  } finally {
    if (!primeraConfirmada) await primera.rollback().catch(() => {});
    if (!segundaConfirmada) await segunda.rollback().catch(() => {});
    primera.release();
    segunda.release();
  }
}

async function limpiarDatosFixture(sql, ids) {
  const flujos = [String(ids.flujoPrimarioId), String(ids.flujoSecundarioId)];
  await sql.ejecutar(
    'DELETE FROM posiciones_ocurrencias_flujos_federacion WHERE flujo_id IN (?,?)',
    flujos
  ).catch(() => {});
  await sql.ejecutar(
    'DELETE FROM contadores_posiciones_generaciones_federacion WHERE flujo_id IN (?,?)',
    flujos
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

async function crearFlujosFixture(sql, ids) {
  const repositorio = new RepositorioFlujosFederacionSql(sql, {
    installationLocalId: String(ids.installationLocalId)
  });
  await repositorio.crearFlujoInicial({
    flujo: flujo(ids, ids.flujoPrimarioId, { nivel: 'portal' }),
    generacion: generacion(ids, ids.generacionPrimariaId)
  });
  await repositorio.crearFlujoInicial({
    flujo: flujo(ids, ids.flujoSecundarioId, {
      nivel: 'tenant',
      tenantId: '5221202'
    }),
    generacion: generacion(ids, ids.generacionSecundariaId)
  });
}

function flujo(ids, flujoId, contexto) {
  return {
    flujoId: String(flujoId),
    relacionId: String(ids.relacionId),
    direccion: 'emision',
    familia: 'monitores',
    versionFamilia: 1,
    contexto
  };
}

function generacion(ids, generacionId) {
  return {
    generacionId: String(generacionId),
    clase: 'inicial',
    fronteraInicial: '0',
    propietario: {
      installationId: String(ids.installationLocalId),
      bootId: String(ids.bootId),
      version: 1
    }
  };
}

function definicion(ids, {
  elementoOrigenId = ids.elementoOrigenId,
  ocurrenciaOrigenId,
  tiempoOrigenUtc,
  estado
}) {
  return {
    familia: 'monitores',
    familiaVersion: 1,
    installationOrigenId: ids.installationLocalId,
    elementoOrigenId,
    ocurrenciaOrigenId,
    operacion: 'actualizacion',
    tiempoOrigenUtc,
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
      valor: { estado, contexto: 'fixture 5.22.12b' }
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
       'fixture 5.22.12b',?, ?,NULL,NULL,NULL,1,NULL,?,?,?,1
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
        `DELETE FROM propietarios_emision_flujos_federacion WHERE flujo_id IN (${marcas})`,
        flujoIds
      );
      await sql.ejecutar(
        `UPDATE flujos_federacion SET generacion_activa_id=NULL WHERE flujo_id IN (${marcas})`,
        flujoIds
      );
      await sql.ejecutar(
        `DELETE FROM fronteras_generaciones_federacion WHERE generacion_id IN (
          SELECT generacion_id FROM generaciones_flujos_federacion WHERE flujo_id IN (${marcas})
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
    flujoPrimarioId: generar(TIPOS_IDENTIDAD_FEDERADA.FLUJO),
    flujoSecundarioId: generar(TIPOS_IDENTIDAD_FEDERADA.FLUJO),
    generacionPrimariaId: generar(TIPOS_IDENTIDAD_FEDERADA.GENERACION),
    generacionSecundariaId: generar(TIPOS_IDENTIDAD_FEDERADA.GENERACION),
    elementoOrigenId: generar(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN),
    elementoAlternativoId: generar(TIPOS_IDENTIDAD_FEDERADA.ELEMENTO_ORIGEN),
    ocurrenciaPrimeraId: generar(TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN),
    ocurrenciaSegundaId: generar(TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN),
    ocurrenciaTerceraId: generar(TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN),
    ocurrenciaConcurrentePrimeraId: generar(
      TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN
    ),
    ocurrenciaConcurrenteSegundaId: generar(
      TIPOS_IDENTIDAD_FEDERADA.OCURRENCIA_ORIGEN
    )
  };
}

function leer(ruta) {
  return readFile(new URL(ruta, import.meta.url), 'utf8');
}
