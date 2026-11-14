import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ClienteSql } from '../paquetes/persistencia-sql/src/ClienteSql.js';
import {
  construirMaterializacionSqlFixtureAuditoria,
  crearFixtureConsultaAuditoriaUx,
  VOLUMEN_OBJETIVO_FIXTURE_CONSULTA_AUDITORIA
} from '../paquetes/auditoria/src/fixturesConsultaAuditoriaUx.js';
import {
  obtenerConfiguracionAplicacion
} from '../paquetes/utilidades/src/configuracion/obtenerConfiguracionAplicacion.js';

const TABLA_PLAN = 'eventos_auditoria_plan_52116f';
const INDICES_NUEVOS = Object.freeze({
  idx_eventos_auditoria_scope_empresa_cronologia:
    ['scope_empresa_id', 'registrado_en_utc', 'evento_id'],
  idx_eventos_auditoria_scope_sitio_cronologia:
    ['scope_sitio_id', 'registrado_en_utc', 'evento_id'],
  idx_eventos_auditoria_flujo_cronologia:
    ['flujo', 'registrado_en_utc', 'evento_id'],
  idx_eventos_auditoria_cadena_cronologia:
    ['cadena_id', 'registrado_en_utc', 'evento_id'],
  idx_eventos_auditoria_actor_real_cronologia:
    ['actor_real_tipo', 'actor_real_id', 'registrado_en_utc', 'evento_id'],
  idx_eventos_auditoria_actor_efectivo_cronologia:
    ['actor_efectivo_tipo', 'actor_efectivo_id', 'registrado_en_utc', 'evento_id'],
  idx_eventos_auditoria_causalidad_cronologia:
    ['causalidad_tipo', 'causalidad_id', 'registrado_en_utc', 'evento_id']
});

async function main() {
  const migracion = await cargarMigracion();
  verificarMigracion(migracion);
  const capturarSql = process.argv.includes('--capturar-planes-sql');
  if (capturarSql) {
    const resumen = await capturarPlanesSql(migracion);
    verificarPlanesPosteriores(resumen);
    console.log(`[auditoria] PLANES 5.21.16f ${JSON.stringify(resumen)}`);
  }
  console.log(`[auditoria] OK 5.21.16f: indices=7 ddl=sin_datos planes=${capturarSql ? 'sql_real' : 'estructura'}`);
}

async function cargarMigracion() {
  const esquema = await readFile(new URL('../migraciones/sql/0001_esquema_inicial.sql', import.meta.url), 'utf8');
  const tabla = esquema.match(/CREATE TABLE `eventos_auditoria` \([\s\S]*?\) ENGINE=/u)?.[0];
  assert.ok(tabla, 'El esquema consolidado debe definir eventos_auditoria.');
  const indices = Object.keys(INDICES_NUEVOS).map((nombre) => {
    const definicion = tabla.match(new RegExp('KEY `' + nombre + '` \\(([^)]+)\\)'));
    assert.ok(definicion, `El esquema consolidado debe definir ${nombre}.`);
    return `ADD INDEX IF NOT EXISTS ${nombre} (${definicion[1].replaceAll('`', '')})`;
  });
  return 'ALTER TABLE eventos_auditoria ' + indices.join(', ');
}

function verificarMigracion(sql) {
  assert.match(sql, /^ALTER TABLE eventos_auditoria\s/i);
  assert.equal((sql.match(/ADD INDEX IF NOT EXISTS/gi) || []).length, 7);
  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|REPLACE|DROP|TRUNCATE)\b/i);
  for (const [nombre, columnas] of Object.entries(INDICES_NUEVOS)) {
    const patron = new RegExp(
      `ADD INDEX IF NOT EXISTS ${nombre}\\s*\\(\\s*${columnas.join('\\s*,\\s*')}\\s*\\)`,
      'i'
    );
    assert.match(sql, patron, `La migración no define correctamente ${nombre}.`);
  }
}

async function capturarPlanesSql(migracion) {
  const configuracion = obtenerConfiguracionAplicacion().sql;
  if (!configuracion.estaCompleta) {
    throw new Error('La captura real de EXPLAIN requiere configuración SQL completa.');
  }
  const clienteSql = new ClienteSql(configuracion);
  const conexion = await clienteSql.obtenerConexion();
  try {
    await crearTablaTemporal(conexion);
    const fixture = crearFixtureConsultaAuditoriaUx();
    assert.equal(fixture.eventos.length, VOLUMEN_OBJETIVO_FIXTURE_CONSULTA_AUDITORIA);
    await insertarFixture(conexion, fixture);
    await conexion.query(`ANALYZE TABLE ${TABLA_PLAN}`);
    const filasAntes = await contarFilas(conexion);
    const casos = construirCasos(fixture);
    const antes = await explicarCasos(conexion, casos);
    const sqlTemporal = migracion.replace(
      /^ALTER TABLE eventos_auditoria/i,
      `ALTER TABLE ${TABLA_PLAN}`
    );
    await conexion.query(sqlTemporal);
    await conexion.query(sqlTemporal);
    await conexion.query(`ANALYZE TABLE ${TABLA_PLAN}`);
    const filasDespues = await contarFilas(conexion);
    assert.equal(filasAntes, fixture.eventos.length);
    assert.equal(filasDespues, filasAntes);
    const despues = await explicarCasos(conexion, casos);
    return Object.freeze({
      motor: await leerVersionMotor(conexion),
      filasFixture: fixture.eventos.length,
      filasAntes,
      filasDespues,
      antes,
      despues
    });
  } finally {
    try {
      await conexion.query(`DROP TEMPORARY TABLE IF EXISTS ${TABLA_PLAN}`);
    } finally {
      conexion.release();
      await clienteSql.cerrar();
    }
  }
}

async function crearTablaTemporal(conexion) {
  await conexion.query(`
    CREATE TEMPORARY TABLE ${TABLA_PLAN} (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      evento_id BINARY(16) NOT NULL,
      cadena_id BIGINT UNSIGNED NOT NULL,
      tipo_evento VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      flujo VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      actor_real_tipo VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      actor_real_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      actor_efectivo_tipo VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
      actor_efectivo_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
      sujeto_tipo VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      sujeto_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      scope_tenant_id BIGINT UNSIGNED NULL,
      scope_empresa_id BIGINT UNSIGNED NULL,
      scope_sitio_id BIGINT UNSIGNED NULL,
      correlacion_id BINARY(16) NOT NULL,
      causalidad_tipo VARCHAR(48) CHARACTER SET ascii COLLATE ascii_bin NULL,
      causalidad_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
      registrado_en_utc DATETIME(3) NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uk_eventos_auditoria_evento (evento_id),
      KEY idx_eventos_auditoria_cronologia (registrado_en_utc, evento_id),
      KEY idx_eventos_auditoria_correlacion
        (correlacion_id, registrado_en_utc, evento_id),
      KEY idx_eventos_auditoria_sujeto
        (sujeto_tipo, sujeto_id, registrado_en_utc, evento_id),
      KEY idx_eventos_auditoria_scope
        (scope_tenant_id, scope_empresa_id, scope_sitio_id, registrado_en_utc, evento_id),
      KEY idx_eventos_auditoria_tipo
        (tipo_evento, registrado_en_utc, evento_id)
    ) ENGINE=InnoDB
  `);
}

async function insertarFixture(conexion, fixture) {
  const materializacion = construirMaterializacionSqlFixtureAuditoria(fixture);
  const cadenas = new Map();
  const columnas = [
    'evento_id', 'cadena_id', 'tipo_evento', 'flujo',
    'actor_real_tipo', 'actor_real_id', 'actor_efectivo_tipo', 'actor_efectivo_id',
    'sujeto_tipo', 'sujeto_id', 'scope_tenant_id', 'scope_empresa_id',
    'scope_sitio_id', 'correlacion_id', 'causalidad_tipo', 'causalidad_id',
    'registrado_en_utc'
  ];
  for (let inicio = 0; inicio < materializacion.eventos.length; inicio += 200) {
    const lote = materializacion.eventos.slice(inicio, inicio + 200);
    const parametros = [];
    const valores = lote.map((evento) => {
      if (!cadenas.has(evento.cadenaClave)) cadenas.set(evento.cadenaClave, cadenas.size + 1);
      parametros.push(
        evento.eventoId,
        cadenas.get(evento.cadenaClave),
        evento.tipoEvento,
        evento.flujo,
        evento.actorRealTipo,
        evento.actorRealId,
        evento.actorEfectivoTipo,
        evento.actorEfectivoId,
        evento.sujetoTipo,
        evento.sujetoId,
        evento.scopeTenantId,
        evento.scopeEmpresaId,
        evento.scopeSitioId,
        evento.correlacionId,
        evento.causalidadTipo,
        evento.causalidadId,
        evento.registradoEnUtc
      );
      return `(${columnas.map(() => '?').join(', ')})`;
    });
    await conexion.query(
      `INSERT INTO ${TABLA_PLAN} (${columnas.join(', ')}) VALUES ${valores.join(', ')}`,
      parametros
    );
  }
}

function construirCasos(fixture) {
  const eventos = fixture.eventos;
  const primero = eventos[0];
  const empresa = eventos.find((evento) => evento.scope.empresaId != null);
  const sitio = eventos.find((evento) => evento.scope.sitioId != null);
  const efectivo = eventos.find((evento) => evento.actorEfectivo != null);
  const causal = eventos.find((evento) => evento.causalidadTipo != null);
  const mitad = eventos[Math.floor(eventos.length / 2)];
  const fechaDesde = eventos[0].registradoEnUtc.replace('T', ' ').replace('Z', '');
  const fechaHasta = eventos.at(-1).registradoEnUtc.replace('T', ' ').replace('Z', '');
  const fechaCursor = mitad.registradoEnUtc.replace('T', ' ').replace('Z', '');
  const cursor = [fechaDesde, fechaHasta, fechaCursor, fechaCursor, uuidABytes(mitad.eventoId)];
  const cadenaId = new Set(eventos.slice(0, eventos.indexOf(primero) + 1)
    .map((evento) => evento.claveCadena)).size;
  return [
    caso('portal', '1 = 1', [], 'idx_eventos_auditoria_cronologia', cursor),
    caso('tenant', 'scope_tenant_id = ?', [empresa.scope.tenantId], 'idx_eventos_auditoria_scope', cursor),
    caso('empresa', 'scope_empresa_id = ?', [empresa.scope.empresaId], 'idx_eventos_auditoria_scope_empresa_cronologia', cursor),
    caso('sitio', 'scope_sitio_id = ?', [sitio.scope.sitioId], 'idx_eventos_auditoria_scope_sitio_cronologia', cursor),
    caso('tipo', 'tipo_evento = ?', [primero.tipoEvento], 'idx_eventos_auditoria_tipo', cursor),
    caso('sujeto', 'sujeto_tipo = ? AND sujeto_id = ?', [primero.sujeto.tipo, primero.sujeto.id], 'idx_eventos_auditoria_sujeto', cursor),
    caso('flujo', 'flujo = ?', [primero.flujo], 'idx_eventos_auditoria_flujo_cronologia', cursor),
    caso('cadena', 'cadena_id = ?', [cadenaId], 'idx_eventos_auditoria_cadena_cronologia', cursor),
    caso('actor_real', 'actor_real_tipo = ? AND actor_real_id = ?', [primero.actorReal.tipo, primero.actorReal.id], 'idx_eventos_auditoria_actor_real_cronologia', cursor),
    caso('actor_efectivo', 'actor_efectivo_tipo = ? AND actor_efectivo_id = ?', [efectivo.actorEfectivo.tipo, efectivo.actorEfectivo.id], 'idx_eventos_auditoria_actor_efectivo_cronologia', cursor),
    caso('correlacion', 'correlacion_id = ?', [uuidABytes(primero.correlacionId)], 'idx_eventos_auditoria_correlacion', cursor),
    caso('causalidad', 'causalidad_tipo = ? AND causalidad_id = ?', [causal.causalidadTipo, causal.causalidadId], 'idx_eventos_auditoria_causalidad_cronologia', cursor)
  ];
}

function caso(nombre, condicion, parametros, indiceEsperado, cursor) {
  return Object.freeze({ nombre, condicion, parametros: [...parametros, ...cursor], indiceEsperado });
}

async function explicarCasos(conexion, casos) {
  const resumen = [];
  for (const actual of casos) {
    const [filas] = await conexion.execute(
      `EXPLAIN SELECT evento_id FROM ${TABLA_PLAN}
        WHERE ${actual.condicion}
          AND registrado_en_utc BETWEEN ? AND ?
          AND (registrado_en_utc < ? OR (registrado_en_utc = ? AND evento_id < ?))
        ORDER BY registrado_en_utc DESC, evento_id DESC
        LIMIT 26`,
      actual.parametros
    );
    const plan = filas[0];
    resumen.push(Object.freeze({
      caso: actual.nombre,
      acceso: String(plan.type),
      indice: plan.key == null ? null : String(plan.key),
      indicesPosibles: plan.possible_keys == null
        ? []
        : String(plan.possible_keys).split(','),
      filasEstimadas: Number(plan.rows),
      indiceEsperado: actual.indiceEsperado
    }));
  }
  return Object.freeze(resumen);
}

function verificarPlanesPosteriores({ filasFixture, despues: planes }) {
  const casosNuevos = new Set([
    'empresa', 'sitio', 'flujo', 'cadena',
    'actor_real', 'actor_efectivo', 'causalidad'
  ]);
  for (const plan of planes) {
    assert.notEqual(plan.acceso.toUpperCase(), 'ALL', `${plan.caso} degeneró en barrido completo.`);
    assert.ok(
      plan.indice === plan.indiceEsperado || plan.indicesPosibles.includes(plan.indiceEsperado),
      `${plan.caso} no reconoce el recorrido cronológico previsto.`
    );
    if (casosNuevos.has(plan.caso)) {
      assert.ok(
        plan.filasEstimadas < filasFixture / 2,
        `${plan.caso} conserva un recorrido insuficientemente selectivo.`
      );
    }
  }
}

async function contarFilas(conexion) {
  const [filas] = await conexion.query(`SELECT COUNT(*) AS total FROM ${TABLA_PLAN}`);
  return Number(filas[0].total);
}

async function leerVersionMotor(conexion) {
  const [filas] = await conexion.query('SELECT VERSION() AS version');
  return String(filas[0].version).replace(/[^0-9A-Za-z._-]/g, '_');
}

function uuidABytes(uuid) {
  return Buffer.from(String(uuid).replaceAll('-', ''), 'hex');
}

main().catch((error) => {
  console.error('[auditoria] ERROR 5.21.16f:', error);
  process.exitCode = 1;
});
