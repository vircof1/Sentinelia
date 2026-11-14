import assert from 'node:assert/strict';
import {
  ACTORES_AUDITORIA,
  CAUSALIDADES_AUDITORIA,
  FLUJOS_AUDITORIA,
  ORIGENES_AUDITORIA,
  listarTiposEventoAuditoria
} from '../paquetes/auditoria/src/CatalogoAuditoria.js';
import {
  ClienteSqlInstrumentadoAuditoria
} from '../paquetes/auditoria/src/ClienteSqlInstrumentadoAuditoria.js';
import {
  RepositorioLecturaAuditoriaSql
} from '../paquetes/auditoria/src/RepositorioLecturaAuditoriaSql.js';
import {
  TAMANO_CORRELACION_GRANDE_FIXTURE_AUDITORIA,
  VOLUMEN_OBJETIVO_FIXTURE_CONSULTA_AUDITORIA,
  construirMaterializacionSqlFixtureAuditoria,
  crearFixtureConsultaAuditoriaUx,
  filtrarEventosFixtureAuditoriaPorScope,
  ordenarEventosFixtureAuditoria
} from '../paquetes/auditoria/src/fixturesConsultaAuditoriaUx.js';

async function main() {
  const fixture = crearFixtureConsultaAuditoriaUx();
  verificarCoberturaYVolumen(fixture);
  verificarScopes(fixture);
  verificarCorrelaciones(fixture);
  verificarOrdenTotal(fixture);
  verificarCoherenciaParaSql(fixture);
  verificarMaterializacionSql(fixture);
  await verificarInstrumentacionRepositorio();
  await verificarInstrumentacionConsultasYErrores();
  console.log('[auditoria] OK 5.21.16c: fixture=2048 scopes=aislados correlacion_grande=125 instrumentacion=consultas_parametros');
}

function verificarCoberturaYVolumen(fixture) {
  assert.equal(fixture.eventos.length, VOLUMEN_OBJETIVO_FIXTURE_CONSULTA_AUDITORIA);
  assert.equal(fixture.resumen.totalEventos, VOLUMEN_OBJETIVO_FIXTURE_CONSULTA_AUDITORIA);
  assert.equal(fixture.resumen.totalFlujos, FLUJOS_AUDITORIA.length);
  assert.equal(fixture.resumen.totalTiposEvento, listarTiposEventoAuditoria().length);
  assert.equal(fixture.resumen.totalActoresTipo, ACTORES_AUDITORIA.length);
  assert.equal(fixture.resumen.totalOrigenes, ORIGENES_AUDITORIA.length);
  assert.equal(fixture.resumen.totalCausalidadesTipo, CAUSALIDADES_AUDITORIA.length);
  assert.deepEqual(
    [...new Set(fixture.eventos.map((evento) => evento.flujo))].sort(),
    [...FLUJOS_AUDITORIA].sort()
  );
  assert.deepEqual(
    [...new Set(fixture.eventos.map((evento) => evento.tipoEvento))].sort(),
    listarTiposEventoAuditoria().sort()
  );
  assert.ok(fixture.eventos.some((evento) =>
    evento.modoActuacion === 'impersonado' && evento.actorEfectivo?.tipo === 'usuario'
  ));
  assert.ok(maximaRepeticion(fixture.eventos, (evento) => `${evento.sujeto.tipo}:${evento.sujeto.id}`) > 100);
  assert.ok(maximaRepeticion(fixture.eventos, (evento) => `${evento.actorReal.tipo}:${evento.actorReal.id}`) > 10);
  assert.equal(Object.isFrozen(fixture.eventos), true);
  assert.equal(Object.isFrozen(fixture.eventos[0].scope), true);
}

function verificarScopes(fixture) {
  const portal = visibles(fixture, { nivelScope: 'portal' });
  const tenantA = visibles(fixture, { nivelScope: 'tenant', tenantId: '101' });
  const tenantB = visibles(fixture, { nivelScope: 'tenant', tenantId: 202 });
  const empresaA = visibles(fixture, { nivelScope: 'empresa', empresaId: '1001' });
  const sitioA = visibles(fixture, { nivelScope: 'sitio', sitioId: 10001 });
  assert.equal(portal.length, fixture.eventos.length);
  assert.ok(tenantA.length > 0 && tenantB.length > 0);
  assert.ok(empresaA.length > 0 && sitioA.length > 0);
  assert.ok(tenantA.every((evento) => evento.scope.tenantId === '101'));
  assert.ok(tenantB.every((evento) => evento.scope.tenantId === '202'));
  assert.ok(empresaA.every((evento) => evento.scope.empresaId === '1001'));
  assert.ok(sitioA.every((evento) => evento.scope.sitioId === '10001'));
  assert.equal(visibles(fixture, { nivelScope: 'tenant' }).length, 0);
  assert.equal(visibles(fixture, { nivelScope: 'desconocido', tenantId: '101' }).length, 0);
}

function verificarCorrelaciones(fixture) {
  const grande = fixture.eventos.filter((evento) =>
    evento.correlacionId === fixture.ids.correlacionGrande
  );
  assert.equal(grande.length, TAMANO_CORRELACION_GRANDE_FIXTURE_AUDITORIA);
  assert.ok(grande.length > 100);
  assert.ok(grande.every((evento) => evento.scope.sitioId === '10001'));

  const cruzada = fixture.eventos.filter((evento) =>
    evento.correlacionId === fixture.ids.correlacionCruzaScopes
  );
  assert.equal(cruzada.length, 2);
  assert.deepEqual(new Set(cruzada.map((evento) => evento.scope.tenantId)), new Set(['101', '202']));
  assert.equal(visibles(fixture, { nivelScope: 'tenant', tenantId: '101' })
    .filter((evento) => evento.correlacionId === fixture.ids.correlacionCruzaScopes).length, 1);
  assert.equal(visibles(fixture, { nivelScope: 'tenant', tenantId: '202' })
    .filter((evento) => evento.correlacionId === fixture.ids.correlacionCruzaScopes).length, 1);
}

function verificarOrdenTotal(fixture) {
  const empatados = fixture.eventos.filter((evento) =>
    evento.registradoEnUtc === fixture.ids.registradoEmpateUtc &&
    fixture.ids.eventosEmpate.includes(evento.eventoId)
  );
  assert.equal(empatados.length, 2);
  const asc = ordenarEventosFixtureAuditoria(empatados, { orden: 'asc' });
  const desc = ordenarEventosFixtureAuditoria(empatados, { orden: 'desc' });
  assert.deepEqual(desc.map((evento) => evento.eventoId), asc.map((evento) => evento.eventoId).reverse());
  assert.notEqual(asc[0].eventoId, asc[1].eventoId);

  const clavesOrden = new Set(fixture.eventos.map((evento) =>
    `${evento.registradoEnUtc}:${evento.eventoId}`
  ));
  assert.equal(clavesOrden.size, fixture.eventos.length);
  assert.deepEqual(
    ordenarEventosFixtureAuditoria(fixture.eventos, { orden: 'asc' }),
    fixture.eventos
  );
}

function verificarCoherenciaParaSql(fixture) {
  const secuenciasPorCadena = new Map();
  const ids = new Set();
  for (const evento of fixture.eventos) {
    assert.equal(ids.has(evento.eventoId), false);
    ids.add(evento.eventoId);
    const secuencias = secuenciasPorCadena.get(evento.claveCadena) || [];
    secuencias.push({ numero: Number(evento.secuencia), registradoEnUtc: evento.registradoEnUtc });
    secuenciasPorCadena.set(evento.claveCadena, secuencias);
    assert.match(evento.hashActual, /^[0-9a-f]{64}$/);
    assert.equal(
      evento.claveCadena,
      evento.scope.tenantId == null
        ? `${evento.flujo}:portal`
        : `${evento.flujo}:tenant:${evento.scope.tenantId}`
    );
  }
  for (const secuencias of secuenciasPorCadena.values()) {
    secuencias.sort((a, b) => a.numero - b.numero);
    assert.deepEqual(
      secuencias.map(({ numero }) => numero),
      Array.from({ length: secuencias.length }, (_, indice) => indice + 1)
    );
    assert.deepEqual(
      secuencias.map(({ registradoEnUtc }) => registradoEnUtc),
      [...secuencias].map(({ registradoEnUtc }) => registradoEnUtc).sort()
    );
  }
}

function verificarMaterializacionSql(fixture) {
  const materializacion = construirMaterializacionSqlFixtureAuditoria(fixture);
  assert.equal(materializacion.eventos.length, fixture.eventos.length);
  assert.equal(
    materializacion.cadenas.length,
    new Set(fixture.eventos.map((evento) => evento.claveCadena)).size
  );
  assert.ok(materializacion.cadenas.every((cadena) => cadena.ultimoHash.length === 32));
  assert.ok(materializacion.eventos.every((evento) =>
    evento.eventoId.length === 16 &&
    evento.correlacionId.length === 16 &&
    evento.hashActual.length === 32 &&
    evento.claveOperacion.length <= 128 &&
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/.test(evento.registradoEnUtc)
  ));
  assert.ok(materializacion.eventos.every((evento) =>
    materializacion.cadenas.some((cadena) => cadena.claveCadena === evento.cadenaClave)
  ));
  assert.equal(Object.isFrozen(materializacion.eventos), true);
}

async function verificarInstrumentacionRepositorio() {
  const base = new ClienteSqlFixture();
  const instrumentado = new ClienteSqlInstrumentadoAuditoria({ clienteSql: base });
  const repositorio = new RepositorioLecturaAuditoriaSql({ clienteSql: instrumentado });
  const eventos = await repositorio.listarEventos({
    contextoUsuarioActual: { nivelScope: 'tenant', tenantId: '101' },
    filtros: { flujo: 'usuarios' },
    limite: 25,
    orden: 'desc'
  });
  assert.deepEqual(eventos, []);
  const [traza] = instrumentado.obtenerTrazas();
  assert.equal(traza.tipoSql, 'SELECT');
  assert.match(traza.sqlNormalizado, /FROM eventos_auditoria/);
  assert.match(traza.sqlNormalizado, /ORDER BY registrado_en_utc DESC, evento_id DESC/);
  assert.deepEqual(traza.parametros, ['101', 'usuarios', 26]);
  assert.equal(traza.filas, 0);
  assert.equal(base.liberaciones, 1);
}

async function verificarInstrumentacionConsultasYErrores() {
  const base = new ClienteSqlFixture();
  const instrumentado = new ClienteSqlInstrumentadoAuditoria({ clienteSql: base });
  const binario = Buffer.from('a1b2', 'hex');
  const filas = await instrumentado.consultar('SELECT id FROM fixture WHERE id = ?', [binario]);
  assert.equal(filas.length, 2);
  binario[0] = 0xff;
  await instrumentado.ejecutar('UPDATE fixture SET activo = ? WHERE id = ?', [1, 7]);
  await assert.rejects(
    () => instrumentado.ejecutar('DELETE FALLAR FROM fixture WHERE id = ?', [9]),
    /fallo SQL instrumentado/
  );

  const trazas = instrumentado.obtenerTrazas();
  assert.equal(trazas.length, 3);
  assert.equal(trazas[0].parametros[0].toString('hex'), 'a1b2');
  assert.equal(trazas[0].filas, 2);
  assert.equal(trazas[1].filas, 3);
  assert.equal(trazas[2].ok, false);
  assert.equal(trazas[2].codigoError, 'ER_FIXTURE');
  assert.deepEqual(instrumentado.obtenerResumen(), {
    total: 3,
    correctas: 2,
    fallidas: 1,
    porTipoSql: { SELECT: 1, UPDATE: 1, DELETE: 1 }
  });
  assert.equal(base.liberaciones, 3);
  instrumentado.reiniciar();
  assert.equal(instrumentado.obtenerResumen().total, 0);
  await instrumentado.cerrar();
  assert.equal(base.cierres, 1);
}

function visibles(fixture, contexto) {
  return filtrarEventosFixtureAuditoriaPorScope(fixture.eventos, contexto);
}

function maximaRepeticion(eventos, clave) {
  const cantidades = new Map();
  for (const evento of eventos) {
    const valor = clave(evento);
    cantidades.set(valor, (cantidades.get(valor) || 0) + 1);
  }
  return Math.max(...cantidades.values());
}

class ClienteSqlFixture {
  constructor() {
    this.liberaciones = 0;
    this.cierres = 0;
  }

  async obtenerConexion() {
    return {
      execute: async (sql) => {
        if (String(sql).includes('FALLAR')) {
          const error = new Error('fallo SQL instrumentado');
          error.code = 'ER_FIXTURE';
          throw error;
        }
        if (/^\s*UPDATE/i.test(sql)) return [{ affectedRows: 3 }, []];
        if (String(sql).includes('FROM eventos_auditoria')) return [[], []];
        return [[{ id: 1 }, { id: 2 }], []];
      },
      query: async () => [[], []],
      release: () => { this.liberaciones += 1; }
    };
  }

  async cerrar() {
    this.cierres += 1;
  }
}

main().catch((error) => {
  console.error('[auditoria] ERROR 5.21.16c:', error);
  process.exitCode = 1;
});
