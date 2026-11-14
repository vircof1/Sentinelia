import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  ClienteSqlInstrumentadoAuditoria
} from '../paquetes/auditoria/src/ClienteSqlInstrumentadoAuditoria.js';
import {
  construirCondicionesAvanzadasAuditoriaSql,
  resolverCadenaFiltroAuditoriaSql,
  __testablesFiltrosSqlConsultaAuditoria
} from '../paquetes/auditoria/src/FiltrosSqlConsultaAuditoria.js';
import {
  RepositorioLecturaAuditoriaSql,
  __testablesRepositorioLecturaAuditoriaSql
} from '../paquetes/auditoria/src/RepositorioLecturaAuditoriaSql.js';

async function main() {
  verificarActorModoOrigenYCausalidad();
  verificarCombinacionConWhereBase();
  await verificarResolucionCadenaExactaYScope();
  await verificarCadenaAusenteONoVisible();
  await verificarReutilizacionEnConteoYCorrelacion();
  await verificarFronterasDeUnidad();
  console.log('[auditoria] OK 5.21.16e: actor=real_efectivo cadena=id_scope causalidad=exacta sql=parametrizado');
}

function verificarActorModoOrigenYCausalidad() {
  assert.deepEqual(construirCondicionesAvanzadasAuditoriaSql({
    actorRol: 'real',
    actorTipo: 'usuario',
    actorId: '41'
  }), {
    partes: ['actor_real_tipo = ?', 'actor_real_id = ?'],
    parametros: ['usuario', '41']
  });
  assert.deepEqual(construirCondicionesAvanzadasAuditoriaSql({
    actorRol: 'efectivo',
    actorTipo: 'usuario',
    actorId: '77',
    modoActuacion: 'impersonado',
    origen: 'web',
    causalidadTipo: 'evento_monitor',
    causalidadId: '7001'
  }), {
    partes: [
      'actor_efectivo_tipo = ?',
      'actor_efectivo_id = ?',
      'modo_actuacion = ?',
      'origen = ?',
      'causalidad_tipo = ?',
      'causalidad_id = ?'
    ],
    parametros: ['usuario', '77', 'impersonado', 'web', 'evento_monitor', '7001']
  });

  for (const incompleto of [
    { actorRol: 'real' },
    { actorTipo: 'usuario', actorId: '41' },
    { causalidadTipo: 'evento_monitor' },
    { causalidadId: '7001' }
  ]) {
    assert.throws(
      () => construirCondicionesAvanzadasAuditoriaSql(incompleto),
      /deben aparecer juntos/
    );
  }
  assert.throws(
    () => construirCondicionesAvanzadasAuditoriaSql({
      actorRol: 'columna_inyectada', actorTipo: 'usuario', actorId: '41'
    }),
    /real o efectivo/
  );
}

function verificarCombinacionConWhereBase() {
  const actorId = "41' OR 1=1 --";
  const consulta = __testablesRepositorioLecturaAuditoriaSql.construirWhere({
    contextoUsuarioActual: { nivelScope: 'empresa', empresaId: '1001' },
    filtros: {
      flujo: 'usuarios',
      sujetoTipo: 'usuario',
      sujetoId: '42',
      actorRol: 'real',
      actorTipo: 'usuario',
      actorId,
      modoActuacion: 'directo',
      origen: 'web',
      cadenaSolicitada: true,
      cadenaIdResuelta: '77',
      causalidadTipo: 'evento_auditoria',
      causalidadId: EVENTO_A
    }
  });
  for (const condicion of [
    'scope_empresa_id = ?',
    'flujo = ?',
    'sujeto_tipo = ?',
    'sujeto_id = ?',
    'actor_real_tipo = ?',
    'actor_real_id = ?',
    'modo_actuacion = ?',
    'origen = ?',
    'cadena_id = ?',
    'causalidad_tipo = ?',
    'causalidad_id = ?'
  ]) {
    assert.ok(consulta.where.includes(condicion), `Falta ${condicion}`);
  }
  assert.equal(consulta.where.includes(actorId), false);
  assert.deepEqual(consulta.parametros, [
    '1001', 'usuarios', 'usuario', '42',
    'usuario', actorId, 'directo', 'web', '77',
    'evento_auditoria', EVENTO_A
  ]);
  assert.equal(consulta.where.split(' AND ').length >= 10, true);
}

async function verificarResolucionCadenaExactaYScope() {
  const entorno = crearEntorno();
  const pagina = await entorno.repositorio.listarPaginaEventos({
    contextoUsuarioActual: { nivelScope: 'tenant', tenantId: '101' },
    filtros: {
      claveCadena: 'usuarios:tenant:101',
      actorRol: 'efectivo',
      actorTipo: 'usuario',
      actorId: '77',
      modoActuacion: 'impersonado',
      origen: 'web',
      causalidadTipo: 'evento_monitor',
      causalidadId: '7001'
    },
    limite: 25
  });
  assert.deepEqual(pagina, { eventos: [], hayMas: false, siguientePosicion: null });
  const trazas = entorno.instrumentado.obtenerTrazas();
  assert.equal(trazas.length, 2);
  assert.match(trazas[0].sqlNormalizado, /FROM cadenas_auditoria c/);
  assert.match(trazas[0].sqlNormalizado, /c\.clave_cadena = \?/);
  assert.match(trazas[0].sqlNormalizado, /c\.tenant_id = \?/);
  assert.deepEqual(trazas[0].parametros, ['usuarios:tenant:101', '101']);
  assert.match(trazas[1].sqlNormalizado, /cadena_id = \?/);
  assert.match(trazas[1].sqlNormalizado, /actor_efectivo_tipo = \?/);
  assert.match(trazas[1].sqlNormalizado, /causalidad_tipo = \?/);
  assert.equal(trazas[1].parametros.includes('usuarios:tenant:101'), false);
  assert.equal(trazas[1].parametros.includes('77'), true);
  assert.equal(trazas[1].parametros.at(-1), 26);

  const scopeEmpresa = __testablesFiltrosSqlConsultaAuditoria.condicionScopeCadena({
    nivelScope: 'empresa', tenantId: '101', empresaId: '1001'
  }, 'c');
  assert.deepEqual(scopeEmpresa, { condicion: 'c.tenant_id = ?', parametros: ['101'] });
}

async function verificarCadenaAusenteONoVisible() {
  for (const claveCadena of ['usuarios:tenant:999', 'usuarios:tenant:202']) {
    const entorno = crearEntorno();
    const pagina = await entorno.repositorio.listarPaginaEventos({
      contextoUsuarioActual: { nivelScope: 'tenant', tenantId: '101' },
      filtros: { claveCadena },
      limite: 25
    });
    assert.deepEqual(pagina, { eventos: [], hayMas: false, siguientePosicion: null });
    const trazas = entorno.instrumentado.obtenerTrazas();
    assert.equal(trazas.length, 2);
    assert.match(trazas[1].sqlNormalizado, /\(0 = 1\)/);
    assert.equal(trazas[1].parametros.includes(claveCadena), false);
  }
}

async function verificarReutilizacionEnConteoYCorrelacion() {
  const entornoConteo = crearEntorno();
  const total = await entornoConteo.repositorio.contarEventos({
    contextoUsuarioActual: { nivelScope: 'portal' },
    filtros: { claveCadena: 'usuarios:tenant:101', origen: 'web' }
  });
  assert.equal(total, 4);
  const trazasConteo = entornoConteo.instrumentado.obtenerTrazas();
  assert.equal(trazasConteo.length, 2);
  assert.doesNotMatch(trazasConteo[0].sqlNormalizado, /tenant_id = \?/);
  assert.match(trazasConteo[1].sqlNormalizado, /COUNT\(\*\).*origen = \?.*cadena_id = \?/);

  const entornoCorrelacion = crearEntorno();
  const claves = await entornoCorrelacion.repositorio.listarClavesCorrelacion({
    contextoUsuarioActual: { nivelScope: 'tenant', tenantId: '101' },
    filtros: {
      claveCadena: 'usuarios:tenant:101',
      actorRol: 'real',
      actorTipo: 'usuario',
      actorId: '41'
    }
  });
  assert.deepEqual(claves, []);
  const trazasCorrelacion = entornoCorrelacion.instrumentado.obtenerTrazas();
  assert.equal(trazasCorrelacion.length, 2);
  assert.match(trazasCorrelacion[1].sqlNormalizado, /PARTITION BY correlacion_id/);
  assert.match(trazasCorrelacion[1].sqlNormalizado, /cadena_id = \?/);
  assert.match(trazasCorrelacion[1].sqlNormalizado, /actor_real_id = \?/);
}

async function verificarFronterasDeUnidad() {
  const fuente = await readFile(
    new URL('../paquetes/auditoria/src/FiltrosSqlConsultaAuditoria.js', import.meta.url),
    'utf8'
  );
  assert.match(fuente, /WHERE c\.clave_cadena = \?/);
  assert.doesNotMatch(fuente, /LIKE|payload|resultado|estado\s*=/i);
  assert.doesNotMatch(fuente, /\$\{filtros\.(actorRol|actorTipo|actorId|origen|causalidad)/);

  const servicio = await readFile(
    new URL('../paquetes/auditoria/src/ServicioLecturaAuditoria.js', import.meta.url),
    'utf8'
  );
  assert.doesNotMatch(servicio, /FiltrosSqlConsultaAuditoria/);
}

function crearEntorno() {
  const base = new ClienteSqlFiltrosFixture();
  const instrumentado = new ClienteSqlInstrumentadoAuditoria({ clienteSql: base });
  return {
    instrumentado,
    repositorio: new RepositorioLecturaAuditoriaSql({ clienteSql: instrumentado })
  };
}

class ClienteSqlFiltrosFixture {
  async obtenerConexion() {
    return {
      execute: async (sql, parametros) => {
        const sentencia = String(sql);
        if (sentencia.includes('FROM cadenas_auditoria c')) {
          const [claveCadena, tenantId] = parametros;
          const visible = claveCadena === 'usuarios:tenant:101' &&
            (tenantId === undefined || String(tenantId) === '101');
          return [visible ? [{ id: '77' }] : [], []];
        }
        if (sentencia.includes('COUNT(*)')) return [[{ total: 4 }], []];
        return [[], []];
      },
      release() {}
    };
  }
}

const EVENTO_A = '018f8f70-7b5c-7a55-b32a-111111111111';

main().catch((error) => {
  console.error('[auditoria] ERROR 5.21.16e:', error);
  process.exitCode = 1;
});
